import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, realpath, writeFile, rename } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { performance } from "node:perf_hooks";
import { Type } from "typebox";
import { createAgentSession, DefaultResourceLoader, getAgentDir, ModelRuntime, SessionManager, SettingsManager, type ExtensionAPI, type ExtensionUIContext, type Skill } from "@earendil-works/pi-coding-agent";
import { materialize, workflows, skillSpecs, toolSpecs, paymentDecisionProfile, type WorkflowId } from "./fixtures.ts";
import { grade } from "./grade.ts";
import { sandboxTools } from "./sandbox.ts";
import { addUsage, armConfig, LIMITS, newStage, sanitize, VERSIONS, RETRIEVAL_COMMIT, RETRIEVAL_QUERIES, SCORING_COMMIT, type Arm, type Run, type Stage } from "./metrics.ts";
import { commandHash, decisionHash, decisionPrompt, failureKind } from "./decisions.ts";
const require = createRequire(import.meta.url);
const sievePath = join(require.resolve("pi-sieve/package.json"), "..", "src", "index.ts");
const retrievalPath = join(require.resolve("pi-sieve-retrieval/package.json"), "..", "src", "index.ts");
const scoringPath = resolve("../pi-sieve/src/index.ts");
const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const BUILTINS = ["read", "bash", "edit", "write"];
export async function treeHash(root: string): Promise<string> {
    const hash = createHash("sha256");
    async function visit(path: string, prefix = ""): Promise<void> { for (const entry of (await readdir(path, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
        const rel = prefix + entry.name;
        if (entry.isDirectory())
            await visit(join(path, entry.name), rel + "/");
        else if (entry.isFile()) {
            hash.update(rel + "\0");
            hash.update(await readFile(join(path, entry.name)));
        }
        else
            throw new Error("Fixture links are unsupported.");
    } }
    await visit(root);
    return hash.digest("hex");
}
export async function atomicJson(path: string, value: unknown): Promise<void> { await mkdir(join(path, ".."), { recursive: true }); await writeFile(path + ".tmp", JSON.stringify(value, null, 2) + "\n"); await rename(path + ".tmp", path); }
export async function preserveExistingRun(path: string): Promise<boolean> {
    let prior: Run;
    try { prior = JSON.parse(await readFile(path, "utf8")); }
    catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
        throw error;
    }
    if (prior.status === "running") {
        prior.status = "interrupted";
        prior.success = false;
        await atomicJson(path, prior);
    }
    return true;
}
export async function runWorkflow(options: {
    root: string;
    record: string;
    batch: string;
    kind: Run["kind"];
    workflow: WorkflowId;
    arm: Arm;
    repeat: number;
    harnessCommit: string;
    fixtureHash: string;
    modelRuntime?: ModelRuntime;
    offline?: boolean;
    onReady?: (session: Awaited<ReturnType<typeof createAgentSession>>["session"]) => void | Promise<void>;
}): Promise<Run> {
    const initStart = performance.now();
    const variant = armConfig(options.arm);
    const retrieval = options.arm.startsWith("retrieval-");
    const scoring = options.arm.startsWith("score-");
    await materialize(options.root, options.workflow, scoring);
    const root = await realpath(options.root);
    const initialHash = await treeHash(root);
    const run: Run = { id: `${options.workflow}-${options.repeat}-${options.arm}`, batch: options.batch, kind: options.kind, workflow: options.workflow, arm: options.arm, repeat: options.repeat, startedAt: new Date().toISOString(), status: "running", success: false, initialHash, fixtureHash: options.fixtureHash, harnessCommit: options.harnessCommit, versions: { ...VERSIONS, model: variant.model, sieve: scoring ? SCORING_COMMIT : retrieval ? RETRIEVAL_COMMIT : VERSIONS.sieve }, node: process.version, initMs: 0, elapsedMs: 0, gradeMs: 0, stages: [] };
    await atomicJson(options.record, run);
    const agentDir = resolve(root, "..", "agent-" + run.id);
    await mkdir(agentDir, { recursive: true });
    const modelRuntime = options.modelRuntime ?? await ModelRuntime.create({ authPath: join(getAgentDir(), "auth.json"), modelsPath: null, modelsStorePath: join(agentDir, "models-cache.json"), refreshOnCreate: false });
    const model = modelRuntime.getModel(VERSIONS.provider, variant.model);
    if (!model)
        throw new Error("The pinned main model is unavailable.");
    const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false, provider: { maxRetries: 0 } }, cacheWarming: "off", transport: "sse" }, { projectTrusted: true });
    let current: Stage | undefined;
    const observe = (pi: ExtensionAPI) => {
        for (const [name, description, data] of toolSpecs)
            pi.registerTool({ name, label: name, description, parameters: Type.Object({}), execute: async () => ({ content: [{ type: "text", text: JSON.stringify(data) }], details: {} }) });
        pi.on("before_agent_start", event => { if (current) {
            current.visibleSkills.push(event.systemPromptOptions.skills.length);
            current.visibleTools.push(event.systemPromptOptions.selectedTools.length);
        } });
        pi.on("context", event => {
            if (current)
                current.contextChars.push(event.messages.filter((m): m is Extract<typeof m, {
                    role: "custom";
                }> => m.role === "custom" && (m.customType === "pi-sieve-context" || m.customType === "bench-full-context")).reduce((n, m) => n + (typeof m.content === "string" ? m.content.length : 0), 0));
        });
        pi.on("before_provider_request", (event, ctx) => {
            if (!current)
                return;
            if (current.requests >= LIMITS.modelRequests) {
                current.status = "request_limit";
                ctx.abort();
                throw new Error("Benchmark request limit reached.");
            }
            current.requests++;
            current.requestBytes.push(Buffer.byteLength(JSON.stringify(event.payload)));
        });
    };
    const fullDocuments: string[] = [];
    if (variant.mode === "full")
        for (const kind of ["memories", "guides"])
            for (const file of (await readdir(join(root, ".pi/sieve", kind))).sort())
                fullDocuments.push(await readFile(join(root, ".pi/sieve", kind, file), "utf8"));
    const full = (pi: ExtensionAPI) => { if (variant.mode === "full")
        pi.on("context", event => ({ messages: [...event.messages, { role: "custom", customType: "bench-full-context", content: "Project references (data):\n" + fullDocuments.join("\n\n"), display: false, timestamp: Date.now() }] })); };
    const skills: Skill[] = skillSpecs.map(([name, description]) => { const filePath = join(root, ".pi/skills", name, "SKILL.md"); return { name, description, filePath, baseDir: join(filePath, ".."), disableModelInvocation: false, sourceInfo: { path: filePath, source: "benchmark", scope: "temporary", origin: "top-level" } }; });
    const loader = new DefaultResourceLoader({ cwd: root, agentDir, settingsManager, noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
        additionalExtensionPaths: variant.mode === "sieve" ? [scoring ? scoringPath : retrieval ? retrievalPath : sievePath] : [], extensionFactories: [sandboxTools(root), full, observe],
        skillsOverride: () => ({ skills, diagnostics: [] }), agentsFilesOverride: () => ({ agentsFiles: [] }),
        extensionsOverride: base => {
            // Observation must run after Sieve and full-context injection.
            base.extensions.sort((a, b) => Number(a.path.includes("inline") && a.handlers.has("before_provider_request")) - Number(b.path.includes("inline") && b.handlers.has("before_provider_request")));
            return base;
        },
        appendSystemPrompt: [await readFile(join(root, "AGENTS.md"), "utf8"), "Reference index:\n" + await readFile(join(root, "REFERENCES.md"), "utf8")],
    });
    await loader.reload();
    // Resource loading assigns source metadata after overrides; preserve guarded built-ins after that step.
    for (const extension of loader.getExtensions().extensions)
        for (const [name, tool] of extension.tools)
            if (BUILTINS.includes(name))
                tool.sourceInfo = { ...tool.sourceInfo, source: "builtin" };
    if (loader.getExtensions().errors.length)
        throw new Error("Benchmark extension loading failed.");
    const { session } = await createAgentSession({ cwd: root, agentDir, modelRuntime, model, thinkingLevel: VERSIONS.thinking, settingsManager, resourceLoader: loader, sessionManager: SessionManager.inMemory(root), tools: [...BUILTINS, ...toolSpecs.map(x => x[0]), ...(variant.mode === "sieve" ? [scoring ? "sieve_score" : "sieve_search"] : [])] });
    await session.bindExtensions({ onError: () => { if (current && current.status === "running")
            current.status = "extension_error"; }, uiContext: { notify: (message: string) => { if (current && message.startsWith("{"))
                try {
                    const parsed = JSON.parse(message);
                    if (typeof parsed.reason === "string")
                        current.sieve = Object.fromEntries(Object.entries(parsed).filter(([, v]) => ["string", "number", "boolean"].includes(typeof v))) as Stage["sieve"];
                }
                catch { } } } as ExtensionUIContext });
    const queryMatches = new Map<string, boolean>();
    const scoreInputs = new Map<string, { inputHash: string; options: number; levels: number; candidates: { id: string; content: string }[] }>();
    type Selection = NonNullable<Stage["scoring"]>[number];
    let assistantSequence = 0;
    let awaitingCommand: { selection: Selection; returnedAt: number; assistantSequence: number } | undefined;
    const pendingCommands = new Map<string, Selection>();
    const unsubscribe = session.subscribe(event => {
        if (!current)
            return;
        if (event.type === "tool_execution_start") {
            current.toolCalls++;
            if (scoring && event.toolName === "bash" && awaitingCommand) {
                const { selection, returnedAt } = awaitingCommand;
                selection.nextCommandMatched = isRecord(event.args) && typeof event.args.command === "string" && commandHash(event.args.command) === selection.selectedCommandHash;
                selection.commandGeneratedAfterResponse = assistantSequence > awaitingCommand.assistantSequence;
                selection.dispatchMs = Math.round(performance.now() - returnedAt);
                pendingCommands.set(event.toolCallId, selection);
                awaitingCommand = undefined;
            }
            if (scoring && event.toolName === "sieve_score" && isRecord(event.args)) {
                const args = event.args.profile === "payment-diagnostic" ? paymentDecisionProfile : event.args;
                scoreInputs.set(event.toolCallId, { inputHash: decisionHash(event.args), options: Array.isArray(args.options) ? args.options.length : 0, levels: Array.isArray(args.criteria) ? args.criteria.length : 0, candidates: Array.isArray(args.options) ? args.options.filter(isRecord).flatMap(option => typeof option.id === "string" && typeof option.content === "string" ? [{ id: option.id, content: option.content }] : []) : [] });
            }
            if (event.toolName === "sieve_search" && retrieval) queryMatches.set(event.toolCallId, isRecord(event.args) && event.args.query === RETRIEVAL_QUERIES[current.stage - 1]);
            if (event.toolName === "sieve_search" && !retrieval)
                current.recoveries++;
        }
        if (event.type === "tool_execution_end" && event.toolName === "bash") {
            const selection = pendingCommands.get(event.toolCallId);
            if (selection) { selection.executionCompleted = true; selection.executionError = event.isError; }
            pendingCommands.delete(event.toolCallId);
        }
        if (event.type === "tool_execution_end" && event.toolName === "sieve_score" && scoring) {
            const result: unknown = event.result;
            const details = isRecord(result) && isRecord(result.details) ? result.details : {};
            const shape = scoreInputs.get(event.toolCallId) ?? { inputHash: "", options: 0, levels: 0, candidates: [] };
            current.scoring ??= [];
            const reasons = ["none", "disabled", "missing_key", "invalid_input", "invalid_config", "untrusted_project", "request_too_large", "timeout", "cancelled", "service_error", "invalid_response"];
            const selected = isRecord(details.selected) ? details.selected : {};
            const results = Array.isArray(details.results) ? details.results.filter(isRecord).flatMap(item => typeof item.id === "string" && typeof item.score === "number" && typeof item.confidence === "number" ? [{ id: sanitize(item.id, root), score: item.score, confidence: item.confidence }] : []) : [];
            const winner = results.reduce<typeof results[number] | undefined>((best, item) => !best || item.score > best.score ? item : best, undefined);
            const selection: Selection = { inputHash: shape.inputHash, options: shape.options, levels: shape.levels,
                selectedId: typeof selected.id === "string" ? sanitize(selected.id, root) : null,
                selectedCommandHash: typeof selected.content === "string" ? commandHash(selected.content) : null,
                selectionValid: details.available === true && winner !== undefined && winner.id === selected.id && shape.candidates.some(option => option.id === selected.id && option.content === selected.content),
                nextCommandMatched: null, commandGeneratedAfterResponse: null, executionCompleted: false, executionError: null, dispatchMs: null, reason: typeof details.reason === "string" && reasons.includes(details.reason) ? details.reason : "unknown",
                elapsedMs: typeof details.elapsedMs === "number" ? details.elapsedMs : null,
                results };
            current.scoring.push(selection);
            if (selection.selectionValid) awaitingCommand = { selection, returnedAt: performance.now(), assistantSequence };
            scoreInputs.delete(event.toolCallId);
        }
        if (event.type === "tool_execution_end" && event.toolName === "sieve_search" && retrieval) {
            const result: unknown = event.result;
            const details = isRecord(result) && isRecord(result.details) ? result.details : {};
            const text = isRecord(result) && Array.isArray(result.content) ? result.content.filter(isRecord).filter(p => p.type === "text").map(p => typeof p.text === "string" ? p.text : "").join("\n") : "";
            let names: string[] = [];
            try {
                const parsed: unknown = JSON.parse(text.slice(text.indexOf("\n[") + 1));
                if (Array.isArray(parsed)) names = parsed.filter(isRecord).flatMap(item => typeof item.name === "string" ? [sanitize(item.name, root)] : []);
            } catch { /* Empty or failed searches have no reference array. */ }
            const reasons = ["none", "missing_key", "no_candidates", "empty_query", "input_too_large", "request_too_large", "timeout", "cancelled", "service_error", "invalid_response", "invalid_config", "untrusted_project", "disabled", "not_run"];
            current.retrievals ??= [];
            current.retrievals.push({ queryMatched: queryMatches.get(event.toolCallId) ?? false, reason: typeof details.reason === "string" && reasons.includes(details.reason) ? details.reason : "unknown",
                elapsedMs: typeof details.elapsedMs === "number" ? details.elapsedMs : null,
                selected: typeof details.selected === "number" ? details.selected : null, resultChars: text.length, names });
            queryMatches.delete(event.toolCallId);
        }
        if (event.type === "tool_execution_end" && event.isError)
            current.toolErrors++;
        if (event.type === "message_end" && event.message.role === "assistant") {
            assistantSequence++;
            const msg = event.message;
            // Providers may emit all-zero placeholders when a request fails without usage.
            if (!["error", "aborted"].includes(msg.stopReason) || Object.values(msg.usage).some(v => typeof v === "number" && v > 0))
                addUsage(current.usage, msg.usage);
            if (msg.stopReason === "error" && current.status === "running") {
                current.status = "provider_error";
                current.failure = { source: "assistant_error", kind: failureKind(msg.errorMessage) };
            }
            if (msg.stopReason === "aborted" && current.status === "running")
                current.status = "aborted";
            if (msg.stopReason === "length" && current.status === "running")
                current.status = "output_limit";
            const answer = msg.content.filter(part => part.type === "text").map(part => part.text).join("\n");
            if (answer)
                current.answer = sanitize(answer, root);
        }
    });
    const originalFetch = globalThis.fetch;
    const pending: Set<Promise<void>> = new Set();
    globalThis.fetch = async (input, init) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        const observed = current;
        if (url !== "https://api.typesafe.ai/v1/systemone" || !observed)
            return originalFetch(input, init);
        observed.jev.requests++;
        const started = performance.now();
        let response: Response;
        observed.jev.responses ??= [];
        try {
            response = await originalFetch(input, init);
            observed.jev.responses.push({ httpStatus: response.status, headersMs: Math.round(performance.now() - started), errorKind: null });
        } catch (error) {
            observed.jev.responses.push({ httpStatus: null, headersMs: Math.round(performance.now() - started), errorKind: init?.signal?.aborted ? "aborted" : "network_error" });
            throw error;
        }
        if (response.ok) {
            const read = response.clone().json().then((body: unknown) => {
                const usage = isRecord(body) && isRecord(body.usage) ? body.usage : {};
                if (typeof usage.input_tokens === "number" && Number.isSafeInteger(usage.input_tokens) && usage.input_tokens >= 0)
                    observed.jev.inputTokens = (observed.jev.inputTokens ?? 0) + usage.input_tokens;
                if (typeof usage.output_tokens === "number" && Number.isSafeInteger(usage.output_tokens) && usage.output_tokens >= 0)
                    observed.jev.outputTokens = (observed.jev.outputTokens ?? 0) + usage.output_tokens;
            }).catch(() => { });
            pending.add(read);
            void read.finally(() => pending.delete(read));
        }
        return response;
    };
    try {
    if (retrieval || scoring) await session.prompt(options.arm === "retrieval-local" || options.arm === "score-self" ? "/sieve off" : "/sieve on");
    await options.onReady?.(session);
    run.initMs = Math.round(performance.now() - initStart);
        for (let index = 0; index < 5; index++) {
            current = newStage(index + 1);
            if (retrieval) current.retrievals = [];
            if (scoring) { current.scoring = []; awaitingCommand = undefined; scoreInputs.clear(); pendingCommands.clear(); }
            run.stages.push(current);
            await atomicJson(options.record, run);
            const start = performance.now();
            const timer = setTimeout(() => { if (current) {
                current.status = "timeout";
                void session.abort();
            } }, LIMITS.stageMs);
            try {
                const prompt = workflows[options.workflow].stages[index];
                await session.prompt(scoring ? decisionPrompt(options.arm === "score-jev", prompt) : retrieval ? `First call sieve_search with this exact query: ${JSON.stringify(RETRIEVAL_QUERIES[index])}. Then complete the task below. You may read additional references if needed.\n\n${prompt}` : prompt);
                await session.waitForIdle();
                if (current.status === "running")
                    current.status = "completed";
            }
            catch (error) {
                if (current.status === "running") {
                    current.failure = { source: "session_exception", kind: failureKind(error) };
                    current.status = current.failure.kind === "unknown" ? "runner_error" : "provider_error";
                }
            }
            finally {
                clearTimeout(timer);
                current.elapsedMs = Math.round(performance.now() - start);
            }
            if (variant.mode === "sieve")
                await session.prompt("/sieve status");
            await Promise.allSettled([...pending]);
            const grading = performance.now();
            current.checks = await grade(root, options.workflow, index + 1, options.offline);
            current.gradeMs = Math.round(performance.now() - grading);
            run.elapsedMs += current.elapsedMs;
            run.gradeMs += current.gradeMs;
            await atomicJson(options.record, run);
            console.log(`${run.id} stage ${index + 1}/5: ${current.status}; checks ${current.checks.filter(c => c.passed).length}/${current.checks.length}; ${current.elapsedMs} ms`);
            if (current.status !== "completed")
                break;
        }
        run.status = run.stages.length === 5 && run.stages.every(s => s.status === "completed") ? "completed" : run.stages.at(-1)?.status ?? "not_run";
        run.success = run.status === "completed" && run.stages[4].checks.length > 0 && run.stages[4].checks.every(c => c.passed);
    }
    catch (error) {
        run.status = run.stages.length ? "runner_error" : "initialization_error";
        run.success = false;
        throw error;
    }
    finally {
        globalThis.fetch = originalFetch;
        unsubscribe();
        session.dispose();
        await atomicJson(options.record, run);
    }
    return run;
}

import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, realpath, writeFile, rename } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { performance } from "node:perf_hooks";
import { Type } from "typebox";
import { createAgentSession, DefaultResourceLoader, getAgentDir, ModelRuntime, SessionManager, SettingsManager, type ExtensionAPI, type ExtensionUIContext, type Skill } from "@earendil-works/pi-coding-agent";
import { materialize, workflows, skillSpecs, toolSpecs, type WorkflowId } from "./fixtures.ts";
import { grade } from "./grade.ts";
import { sandboxTools } from "./sandbox.ts";
import { addUsage, armConfig, LIMITS, newStage, sanitize, VERSIONS, type Arm, type Run, type Stage } from "./metrics.ts";
const require = createRequire(import.meta.url);
const sievePath = join(require.resolve("pi-sieve/package.json"), "..", "src", "index.ts");
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
    await materialize(options.root, options.workflow);
    const root = await realpath(options.root);
    const initialHash = await treeHash(root);
    const run: Run = { id: `${options.workflow}-${options.repeat}-${options.arm}`, batch: options.batch, kind: options.kind, workflow: options.workflow, arm: options.arm, repeat: options.repeat, startedAt: new Date().toISOString(), status: "running", success: false, initialHash, fixtureHash: options.fixtureHash, harnessCommit: options.harnessCommit, versions: { ...VERSIONS, model: variant.model }, node: process.version, initMs: 0, elapsedMs: 0, gradeMs: 0, stages: [] };
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
        additionalExtensionPaths: variant.mode === "sieve" ? [sievePath] : [], extensionFactories: [sandboxTools(root), full, observe],
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
    const { session } = await createAgentSession({ cwd: root, agentDir, modelRuntime, model, thinkingLevel: VERSIONS.thinking, settingsManager, resourceLoader: loader, sessionManager: SessionManager.inMemory(root), tools: [...BUILTINS, ...toolSpecs.map(x => x[0]), ...(variant.mode === "sieve" ? ["sieve_search"] : [])] });
    await session.bindExtensions({ onError: () => { if (current && current.status === "running")
            current.status = "extension_error"; }, uiContext: { notify: (message: string) => { if (current && message.startsWith("{"))
                try {
                    const parsed = JSON.parse(message);
                    if (typeof parsed.reason === "string")
                        current.sieve = Object.fromEntries(Object.entries(parsed).filter(([, v]) => ["string", "number", "boolean"].includes(typeof v))) as Stage["sieve"];
                }
                catch { } } } as ExtensionUIContext });
    const unsubscribe = session.subscribe(event => {
        if (!current)
            return;
        if (event.type === "tool_execution_start") {
            current.toolCalls++;
            if (event.toolName === "sieve_search")
                current.recoveries++;
        }
        if (event.type === "tool_execution_end" && event.isError)
            current.toolErrors++;
        if (event.type === "message_end" && event.message.role === "assistant") {
            const msg = event.message;
            addUsage(current.usage, msg.usage);
            if (msg.stopReason === "error" && current.status === "running")
                current.status = "provider_error";
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
        const response = await originalFetch(input, init);
        if (response.ok) {
            const read = response.clone().json().then((body: any) => { if (Number.isSafeInteger(body.usage?.input_tokens))
                observed.jev.inputTokens = (observed.jev.inputTokens ?? 0) + body.usage.input_tokens; if (Number.isSafeInteger(body.usage?.output_tokens))
                observed.jev.outputTokens = (observed.jev.outputTokens ?? 0) + body.usage.output_tokens; }).catch(() => { });
            pending.add(read);
            void read.finally(() => pending.delete(read));
        }
        return response;
    };
    await options.onReady?.(session);
    run.initMs = Math.round(performance.now() - initStart);
    try {
        for (let index = 0; index < 5; index++) {
            current = newStage(index + 1);
            run.stages.push(current);
            await atomicJson(options.record, run);
            const start = performance.now();
            const timer = setTimeout(() => { if (current) {
                current.status = "timeout";
                void session.abort();
            } }, LIMITS.stageMs);
            try {
                await session.prompt(workflows[options.workflow].stages[index]);
                await session.waitForIdle();
                if (current.status === "running")
                    current.status = "completed";
            }
            catch {
                if (current.status === "running")
                    current.status = "provider_error";
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
    finally {
        globalThis.fetch = originalFetch;
        unsubscribe();
        session.dispose();
        await atomicJson(options.record, run);
    }
    return run;
}

import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { Type } from "typebox";
import { createAgentSession, DefaultResourceLoader, getAgentDir, ModelRuntime, SessionManager, SettingsManager, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { atomicJson } from "./runner.ts";
import { addUsage, emptyUsage, median, RETRIEVAL_MODEL, SCORING_COMMIT, VERSIONS } from "./metrics.ts";
import { failureKind } from "./decisions.ts";
import { DECISION_PROFILE, decisionCases, decisionProfile, type DecisionCase } from "./decision-cases.ts";
import { installPiJevProbe, PI_JEV_ENTRY, PI_JEV_TOOL, piJevRequest, piJevSelection, type PiJevMode } from "./pi-jev-probe.ts";

const ARMS = ["direct", "delegated"] as const;
type Arm = typeof ARMS[number];
const LIMITS = { trialMs: 90_000, mainRequests: 4, jevTimeoutMs: 10_000 };
const EXECUTE = "bench_execute";
const EXPERIMENT = "reused-profile-decision-probe-v0.5";
const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
export const probeSchedule = () => [1, 2, 3].flatMap(repeat => decisionCases.flatMap((item, index) =>
    ((repeat + index) % 2 ? [...ARMS] : [...ARMS].reverse()).map(arm => ({ caseId: item.id, repeat, arm }))));

export async function probeDecision(root: string, item: DecisionCase, arm: Arm, repeat: number, providedRuntime?: ModelRuntime, piJevMode?: PiJevMode) {
    const record = { id: `${item.id}-${repeat}-${arm}`, caseId: item.id, category: item.category, arm, repeat,
        status: "running", correct: false, selectedId: null as string | null, optionMatched: false,
        contextMatched: null as boolean | null, followedSelection: null as boolean | null,
        selectionMs: null as number | null, requests: 0, toolCalls: 0, requestBytes: [] as number[],
        scoreArgumentChars: 0, executionArgumentChars: 0, usage: emptyUsage(),
        jev: { calls: 0, reason: null as string | null, elapsedMs: null as number | null, dispatchMs: null as number | null, inputTokens: null as number | null, outputTokens: null as number | null },
        failure: null as ReturnType<typeof failureKind> | null };
    const agentDir = join(root, "agent");
    await mkdir(join(root, ".pi/sieve/decisions"), { recursive: true });
    await mkdir(agentDir, { recursive: true });
    await writeFile(join(root, ".pi/sieve/decisions", `${DECISION_PROFILE}.json`), JSON.stringify(decisionProfile));
    await writeFile(join(root, ".pi/sieve.json"), JSON.stringify({ timeoutMs: LIMITS.jevTimeoutMs }));
    const runtime = providedRuntime ?? await ModelRuntime.create({ authPath: join(getAgentDir(), "auth.json"), modelsPath: null, modelsStorePath: join(agentDir, "models.json"), refreshOnCreate: false });
    const model = runtime.getModel(VERSIONS.provider, RETRIEVAL_MODEL);
    if (!model) throw new Error("The pinned main model is unavailable.");
    const native = piJevMode ? await installPiJevProbe(runtime, item.context, piJevMode) : undefined;
    const decisionTool = native ? PI_JEV_TOOL : "sieve_score";
    try {
    const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false, provider: { maxRetries: 0 } }, cacheWarming: "off", transport: "sse" }, { projectTrusted: true });
    let started = 0, done = false, assistantSequence = 0, returnedAt = 0, selectionSequence = 0;
    let selected: { id: string; content: string } | undefined;
    const observe = (pi: ExtensionAPI) => {
        pi.registerTool({ name: EXECUTE, label: "Record action", description: "Submit one chosen candidate's exact ID and content. This measurement sink records the intended action without running a shell command.",
            parameters: Type.Object({ id: Type.String(), content: Type.String() }, { additionalProperties: false }),
            execute: async (_id, input, _signal, _update, ctx) => {
                if (done) return { content: [{ type: "text", text: "Already recorded." }], details: {} };
                done = true;
                record.selectionMs = Math.round(performance.now() - started);
                const candidate = decisionProfile.options.find(option => option.id === input.id);
                record.selectedId = candidate?.id ?? null;
                record.optionMatched = candidate?.content === input.content;
                record.executionArgumentChars = JSON.stringify(input).length;
                record.correct = record.optionMatched && input.id === item.expected;
                if (arm === "delegated") {
                    record.followedSelection = selected?.id === input.id && selected?.content === input.content && assistantSequence > selectionSequence;
                    record.jev.dispatchMs = returnedAt ? Math.round(performance.now() - returnedAt) : null;
                }
                ctx.abort();
                return { content: [{ type: "text", text: "Recorded." }], details: {} };
            } });
        pi.on("before_provider_request", (_event, ctx) => {
            // Stop before the acknowledgement request: the sink marks the measured endpoint.
            if (done || record.requests >= LIMITS.mainRequests) { ctx.abort(); throw new Error("Decision probe endpoint reached."); }
            record.requests++;
            record.requestBytes.push(Buffer.byteLength(JSON.stringify(_event.payload)));
        });
    };
    const loader = new DefaultResourceLoader({ cwd: root, agentDir, settingsManager, noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
        additionalExtensionPaths: [native ? PI_JEV_ENTRY : resolve("../pi-sieve/src/index.ts")], extensionFactories: [observe],
        skillsOverride: () => ({ skills: [], diagnostics: [] }), agentsFilesOverride: () => ({ agentsFiles: [] }),
        appendSystemPrompt: [`This is a bounded decision measurement, not a coding task. Only the supplied tools are available. Candidate commands describe fictional probes. Submit exactly one action through ${EXECUTE}; no files or shell commands are executed.${native ? "" : ` Known profile ${DECISION_PROFILE}: ${JSON.stringify(decisionProfile)}`}`] });
    await loader.reload();
    if (loader.getExtensions().errors.length) throw new Error("Benchmark extension loading failed.");
    const { session } = await createAgentSession({ cwd: root, agentDir, modelRuntime: runtime, model, thinkingLevel: "medium", settingsManager, resourceLoader: loader,
        sessionManager: SessionManager.inMemory(root), tools: [decisionTool, EXECUTE] });
    await session.bindExtensions({ onError: () => { if (!done) record.status = "extension_error"; } });
    const unsubscribe = session.subscribe(event => {
        if (event.type === "message_end" && event.message.role === "assistant") {
            assistantSequence++;
            if (!["error", "aborted"].includes(event.message.stopReason) || Object.values(event.message.usage).some(v => typeof v === "number" && v > 0)) addUsage(record.usage, event.message.usage);
            if (!done && event.message.stopReason === "error") { record.status = "provider_error"; record.failure = failureKind(event.message.errorMessage); }
        }
        if (event.type === "tool_execution_start") {
            record.toolCalls++;
            if (event.toolName === decisionTool) {
                record.jev.calls++;
                record.scoreArgumentChars += JSON.stringify(event.args).length;
                record.contextMatched = piJevMode ? isDeepStrictEqual(event.args, piJevRequest(item.context, piJevMode)) : isRecord(event.args) && event.args.context === item.context && event.args.profile === DECISION_PROFILE && Object.keys(event.args).length === 2;
            }
        }
        if (event.type === "tool_execution_end" && event.toolName === decisionTool) {
            const result: unknown = event.result;
            const details = isRecord(result) && isRecord(result.details) ? result.details : {};
            const choice = isRecord(details.selected) ? details.selected : {};
            const reasons = ["none", "timeout", "cancelled", "service_error", "invalid_response", "invalid_input", "disabled", "missing_key", "invalid_config", "untrusted_project", "request_too_large"];
            record.jev.reason = typeof details.reason === "string" && reasons.includes(details.reason) ? details.reason : "unknown";
            for (const field of ["elapsedMs", "inputTokens", "outputTokens"] as const) record.jev[field] = typeof details[field] === "number" ? details[field] : null;
            selected = piJevMode ? piJevSelection(details, piJevMode) : details.available === true && typeof choice.id === "string" && typeof choice.content === "string" ? { id: choice.id, content: choice.content } : undefined;
            if (native) {
                record.jev.reason = native.diagnostics.reason;
                record.jev.inputTokens = native.diagnostics.inputTokens;
                record.jev.outputTokens = native.diagnostics.outputTokens;
                if (!native.diagnostics.responseValid) selected = undefined;
            }
            returnedAt = performance.now(); selectionSequence = assistantSequence;
        }
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        if (!native) await session.prompt(arm === "direct" ? "/sieve off" : "/sieve on");
        if (!native && !providedRuntime && !await session.extensionRunner!.createContext().modelRegistry.getApiKeyForProvider("typesafe")) throw new Error("The pinned TypeSafe credential is unavailable.");
        const instruction = piJevMode
            ? `Call ${PI_JEV_TOOL} once with exactly this JSON argument: ${JSON.stringify(piJevRequest(item.context, piJevMode))}. Do not change the supplied facts, candidates, or rubric, or perform your own semantic ranking. ${piJevMode === "choice" ? "Use next_action.value as the selected candidate ID; criteria maps IDs to command contents." : "Select the candidate whose q-index answer has the highest numeric value; break exact ties by the original candidate order. Each question's instructions contains its candidate ID and content."} Then call ${EXECUTE} with that candidate's exact id and content. If the evaluation fails, report no choice.`
            : arm === "direct"
            ? `Use your own judgment to choose the best profile option, then call ${EXECUTE} with its exact id and content. Do not call sieve_score. No written ranking or explanation is needed.`
            : `Call sieve_score once with profile ${DECISION_PROFILE} and the exact context string below. Do not write candidates, a rubric, or your own ranking. Then call ${EXECUTE} with selected.id and selected.content unchanged. If unavailable, report no choice.`;
        started = performance.now();
        timer = setTimeout(() => { if (!done) { record.status = "timeout"; void session.abort(); } }, LIMITS.trialMs);
        try { await session.prompt(piJevMode ? instruction : `${instruction}\nContext: ${JSON.stringify(item.context)}`); await session.waitForIdle(); }
        catch (error) { if (!done && record.status === "running") { record.status = "session_error"; record.failure = failureKind(error); } }
        if (record.status === "running") record.status = done ? "completed" : "no_selection";
    } finally { clearTimeout(timer); unsubscribe(); session.dispose(); }
    return { ...record, ...(native ? { piJev: { ...native.diagnostics } } : {}) };
    } finally { native?.cleanup(); }
}
export type ProbeResult = Awaited<ReturnType<typeof probeDecision>>;
export function summarizeProbe(rows: ProbeResult[]) {
    const valid = (r: ProbeResult) => r.status === "completed" && r.optionMatched && (r.arm === "direct" ? r.jev.calls === 0 : r.jev.calls === 1 && r.jev.reason === "none" && r.contextMatched && r.followedSelection);
    const pairs = rows.filter(r => r.arm === "delegated").map(jev => {
        const direct = rows.find(r => r.caseId === jev.caseId && r.repeat === jev.repeat && r.arm === "direct");
        const paired = !!direct && valid(direct) && valid(jev) && direct.correct && jev.correct;
        return { caseId: jev.caseId, category: jev.category, repeat: jev.repeat, valid: paired, directMs: direct?.selectionMs ?? null, delegatedMs: jev.selectionMs,
            ratio: paired && direct.selectionMs && jev.selectionMs ? direct.selectionMs / jev.selectionMs : null };
    });
    const groups = ["routine", "evidence"].flatMap(category => ARMS.map(arm => {
        const samples = rows.filter(r => r.category === category && r.arm === arm), usage = emptyUsage();
        for (const r of samples) addUsage(usage, r.usage);
        return { category, arm, n: samples.length, valid: samples.filter(valid).length, correct: samples.filter(r => valid(r) && r.correct).length,
            medianMs: median(samples.flatMap(r => r.selectionMs === null ? [] : [r.selectionMs])), requests: samples.reduce((n, r) => n + r.requests, 0), usage };
    }));
    const evidence = pairs.filter(p => p.category === "evidence");
    const enough = rows.length === probeSchedule().length && evidence.length === 12 && evidence.every(p => p.valid);
    const medianRatio = median(evidence.flatMap(p => p.ratio === null ? [] : [p.ratio]));
    return { experiment: EXPERIMENT, groups, pairs, actualCostUsd: null,
        gate: { fullWorkflowRecommended: enough && medianRatio !== null && medianRatio >= 1 / 0.9,
            completeValidEvidencePairs: evidence.filter(p => p.valid).length, medianDirectOverDelegated: medianRatio,
            rule: "All 12 evidence pairs must be correct and valid; median paired delegated selection-to-dispatch time must be at least 10 percent lower. Routine cases are negative controls. This exploratory gate is not proof of general benefit." } };
}

export async function runDecisionProbe(batch: string, sourceHash: string, harnessCommit: string): Promise<void> {
    const head = execFileSync("git", ["-C", "../pi-sieve", "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    if (head !== SCORING_COMMIT || execFileSync("git", ["-C", "../pi-sieve", "status", "--porcelain"], { encoding: "utf8" }).trim()) throw new Error("The pinned scoring plugin must be a clean adjacent checkout.");
    const directory = join("reports", batch), manifestPath = join(directory, "manifest.json");
    const manifest = { experiment: EXPERIMENT, sourceHash, harnessCommit, sieveCommit: SCORING_COMMIT, createdAt: new Date().toISOString(), versions: { ...VERSIONS, model: RETRIEVAL_MODEL, sieve: SCORING_COMMIT }, limits: LIMITS, schedule: probeSchedule(),
        method: "Both arms see identical fixed profile candidates and facts; fresh Pi SDK sessions with identical tools. Direct Sol chooses an action; delegated Sol sends the existing profile and supplied facts to real Jev then submits the selection. Timing stops at the action sink, including handoff but excluding initialization and any later acknowledgement. No shell execution or task-success claim. Answers are hidden from model inputs. No selective reruns.",
        gate: summarizeProbe([]).gate.rule, cachePolicy: "Serial alternating order; provider caches cannot be reset.", publication: "Local only; historical batches excluded." };
    try { const prior = JSON.parse(await readFile(manifestPath, "utf8")); if (prior.sourceHash !== sourceHash || prior.sieveCommit !== head) throw new Error("Cannot resume a batch with changed experiment code."); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; await atomicJson(manifestPath, manifest); }
    const rows: ProbeResult[] = [];
    let errors = 0;
    for (const scheduled of probeSchedule()) {
        const item = decisionCases.find(c => c.id === scheduled.caseId)!;
        const id = `${item.id}-${scheduled.repeat}-${scheduled.arm}`, path = join(directory, "runs", `${id}.json`);
        let record: ProbeResult | undefined;
        try { record = JSON.parse(await readFile(path, "utf8")); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
        if (!record) {
            if (errors >= 3) { console.log("Paused after three consecutive provider failures."); break; }
            const root = resolve(".work", batch, id);
            await mkdir(resolve(".work", batch), { recursive: true });
            await mkdir(root);
            // Preserve a started attempt on interruption instead of silently repeating a paid call.
            await atomicJson(path, { id, caseId: item.id, category: item.category, arm: scheduled.arm, repeat: scheduled.repeat, status: "interrupted", correct: false, optionMatched: false, contextMatched: null, followedSelection: null, selectedId: null, selectionMs: null, requests: 0, toolCalls: 0, requestBytes: [], scoreArgumentChars: 0, executionArgumentChars: 0, usage: emptyUsage(), jev: { calls: 0, reason: null, elapsedMs: null, dispatchMs: null, inputTokens: null, outputTokens: null }, failure: null } satisfies ProbeResult);
            record = await probeDecision(root, item, scheduled.arm, scheduled.repeat);
            await atomicJson(path, record);
        }
        rows.push(record);
        errors = record.status === "provider_error" || record.status === "session_error" ? errors + 1 : 0;
        await atomicJson(join(directory, "summary.json"), summarizeProbe(rows));
        console.log(`${id}: ${record.status}; correct ${record.correct}; ${record.selectionMs ?? "unknown"} ms; ${record.requests} model requests`);
    }
    await writeFile(join(directory, "runs.jsonl"), rows.map(r => JSON.stringify(r)).join("\n") + "\n");
    console.log(`Saved decision probe: ${directory}/summary.json`);
}

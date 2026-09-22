import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { createAgentSession, DefaultResourceLoader, getAgentDir, ModelRuntime, SessionManager, SettingsManager, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { addUsage, emptyUsage, median, RETRIEVAL_MODEL, VERSIONS, type Usage } from "./metrics.ts";
import { atomicJson } from "./runner.ts";
import { failureKind } from "./decisions.ts";
import { expectedLabels, gradeLabels, observationBatch, SEMANTIC_CRITERIA, semanticWorkflows, type SemanticWorkflow } from "./semantic-cases.ts";

export const SEMANTIC_EXPERIMENT = "semantic-observation-batches-v0.6";
export const SEMANTIC_ARMS = ["main", "jev"] as const;
type Arm = typeof SEMANTIC_ARMS[number];
const TOOL = "sieve_inspect";
const ENDPOINT = "https://api.typesafe.ai/v1/systemone";
const LIMITS = { stageMs: 90_000, mainRequests: 3, jevTimeoutMs: 10_000 };
const recordLike = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const numeric = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
const SIEVE_ROOT = resolve("../pi-sieve");

export const semanticSchedule = () => [1, 2, 3].flatMap(repeat => semanticWorkflows.flatMap((workflow, i) =>
    ((repeat + i) % 2 ? [...SEMANTIC_ARMS] : [...SEMANTIC_ARMS].reverse()).map(arm => ({ workflow: workflow.id, repeat, arm }))));

export interface SemanticStageResult {
    stage: number; status: string; elapsedMs: number; gradeMs: number; requests: number; assistantMessages: number;
    requestBytes: number[]; prefixPreserved: boolean; toolDefinitionsStable: boolean;
    inspections: number; argumentChars: number; resultChars: number; protocolValid: boolean; outputValid: boolean;
    predictions: Record<string, string>; correct: number; total: number; exact: boolean; followedJudgments: boolean | null;
    usage: Usage; failure: ReturnType<typeof failureKind> | null;
    jev: { calls: number; reason: string | null; elapsedMs: number | null; requestMatched: boolean; inputTokens: number | null; outputTokens: number | null; predictions: Record<string, string>; correct: number | null };
}
export interface SemanticRun {
    id: string; workflow: string; repeat: number; arm: Arm; startedAt: string; status: string; success: boolean;
    fixtureHash: string; initMs: number; elapsedMs: number; stages: SemanticStageResult[];
}

export function parseLabels(text: string): unknown {
    try { return JSON.parse(text.trim().replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "")); }
    catch { return null; }
}

export async function semanticRun(root: string, workflow: SemanticWorkflow, arm: Arm, repeat: number, providedRuntime?: ModelRuntime,
    save?: (row: SemanticRun) => Promise<void>): Promise<SemanticRun> {
    const initStart = performance.now();
    const row: SemanticRun = { id: `${workflow.id}-${repeat}-${arm}`, workflow: workflow.id, repeat, arm, startedAt: new Date().toISOString(),
        status: "running", success: false, fixtureHash: hash(workflow.stages.map(observationBatch)), initMs: 0, elapsedMs: 0, stages: [] };
    await save?.(row);
    const agentDir = join(root, "agent");
    await mkdir(agentDir, { recursive: true });
    await mkdir(join(root, ".pi/sieve/observations"), { recursive: true });
    for (const [i, stage] of workflow.stages.entries()) await writeFile(join(root, `.pi/sieve/observations/batch-${i + 1}.json`), JSON.stringify(observationBatch(stage)));
    await writeFile(join(root, ".pi/sieve.json"), JSON.stringify({ enabled: arm === "jev", timeoutMs: LIMITS.jevTimeoutMs }));
    const runtime = providedRuntime ?? await ModelRuntime.create({ authPath: join(getAgentDir(), "auth.json"), modelsPath: null, modelsStorePath: join(agentDir, "models.json"), refreshOnCreate: false });
    const model = runtime.getModel(VERSIONS.provider, RETRIEVAL_MODEL);
    if (!model) throw new Error("The pinned main model is unavailable.");
    const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false, provider: { maxRetries: 0 } }, cacheWarming: "off", transport: "sse" }, { projectTrusted: true });
    let current: SemanticStageResult | undefined;
    let finalText = "";
    let previousInput: string[] = [], initialSettings: string | undefined;
    const observer = (pi: ExtensionAPI) => {
        pi.on("before_provider_request", (event, ctx) => {
            if (!current) return;
            if (current.requests >= LIMITS.mainRequests) { current.status = "request_limit"; ctx.abort(); throw new Error("Semantic probe request limit reached."); }
            current.requests++;
            current.requestBytes.push(Buffer.byteLength(JSON.stringify(event.payload)));
            if (recordLike(event.payload)) {
                const payload = event.payload;
                const settings = hash([payload.model, payload.instructions, payload.tools, payload.reasoning, payload.text]);
                initialSettings ??= settings;
                current.toolDefinitionsStable &&= initialSettings === settings;
                if (Array.isArray(payload.input)) {
                    const input = payload.input.map(hash);
                    current.prefixPreserved &&= previousInput.every((digest, i) => input[i] === digest);
                    previousInput = input;
                }
            }
        });
        pi.on("tool_call", event => {
            if (!current) return;
            current.inspections++;
            current.argumentChars += JSON.stringify(event.input).length;
            if (event.toolName !== TOOL || current.inspections !== 1 || !isDeepStrictEqual(event.input, { source: `batch-${current.stage}`, mode: workflow.id })) {
                current.protocolValid = false;
                return { block: true, reason: "Use the current batch exactly once." };
            }
        });
    };
    const loader = new DefaultResourceLoader({ cwd: root, agentDir, settingsManager,
        noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
        additionalExtensionPaths: [join(SIEVE_ROOT, "src/index.ts")], extensionFactories: [observer],
        skillsOverride: () => ({ skills: [], diagnostics: [] }), agentsFilesOverride: () => ({ agentsFiles: [] }),
        appendSystemPrompt: [`This is a bounded semantic interpretation workflow. Interpret only supplied observations; no coding or shell execution is required. The upload-approved batches were produced before this session. Each observation concerns an independent case: do not combine evidence across items. The rubric is ${JSON.stringify(SEMANTIC_CRITERIA[workflow.id])}. Call sieve_inspect once for the batch named in each user task. When available, use its judgments unchanged. Otherwise classify its raw observations using the same rubric. Finish with only a JSON object mapping every item ID to one rubric label. Do not write reasoning or explanations. Do not read future batches.`],
    });
    await loader.reload();
    if (loader.getExtensions().errors.length) throw new Error("Benchmark extension loading failed.");
    const { session } = await createAgentSession({ cwd: root, agentDir, modelRuntime: runtime, model, thinkingLevel: "medium", settingsManager,
        resourceLoader: loader, sessionManager: SessionManager.inMemory(root), tools: [TOOL] });
    await session.bindExtensions({ onError: () => { if (current) current.status = "extension_error"; } });
    if (!providedRuntime && arm === "jev" && !await session.extensionRunner!.createContext().modelRegistry.getApiKeyForProvider("typesafe")) {
        session.dispose(); throw new Error("The pinned TypeSafe credential is unavailable.");
    }
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (url !== ENDPOINT) return originalFetch(input, init);
        if (!current || arm !== "jev" || current.jev.calls) throw new Error("Unexpected Jev request blocked.");
        const stage = workflow.stages[current.stage - 1];
        let request: unknown;
        try { request = JSON.parse(String(init?.body)); } catch { /* Invalid requests are blocked before transmission. */ }
        const questions = recordLike(request) && recordLike(request.questions) ? request.questions : {};
        const matched = recordLike(request) && request.model === VERSIONS.jev && isDeepStrictEqual(request.state, { objective: stage.objective }) &&
            Object.keys(questions).length === stage.samples.length && stage.samples.every((sample, i) => {
                const question = questions[`q${i}`];
                return recordLike(question) && question.type === "choice" && isDeepStrictEqual(question.criteria, SEMANTIC_CRITERIA[workflow.id]) &&
                    recordLike(question.instructions) && question.instructions.observation === sample.text;
            });
        if (!matched) { current.jev.requestMatched = false; throw new Error("The Jev request differs from the frozen observations."); }
        current.jev.calls++;
        return originalFetch(input, init);
    };
    const unsubscribe = session.subscribe(event => {
        if (!current) return;
        if (event.type === "message_end" && event.message.role === "assistant") {
            current.assistantMessages++;
            if (!["error", "aborted"].includes(event.message.stopReason) || Object.values(event.message.usage).some(value => typeof value === "number" && value > 0)) addUsage(current.usage, event.message.usage);
            if (event.message.stopReason === "error") { current.status = "provider_error"; current.failure = failureKind(event.message.errorMessage); }
            if (event.message.stopReason === "stop") finalText = event.message.content.flatMap(content => content.type === "text" ? [content.text] : []).join("\n");
        }
        if (event.type === "tool_execution_end" && event.toolName === TOOL && recordLike(event.result)) {
            const result = event.result;
            const details = recordLike(result.details) ? result.details : {};
            const reasons = ["none", "disabled", "missing_key", "timeout", "cancelled", "service_error", "invalid_response", "invalid_input", "request_too_large", "invalid_config", "untrusted_project"];
            current.jev.reason = typeof details.reason === "string" && reasons.includes(details.reason) ? details.reason : "unknown";
            for (const key of ["elapsedMs", "inputTokens", "outputTokens"] as const) current.jev[key] = numeric(details[key]);
            const content = Array.isArray(result.content) ? result.content.flatMap(item => recordLike(item) && item.type === "text" && typeof item.text === "string" ? [item.text] : []).join("\n") : "";
            current.resultChars += content.length;
            const parsed = parseLabels(content);
            if (recordLike(parsed) && parsed.available === true && Array.isArray(parsed.judgments)) {
                const allowedIds = Object.keys(expectedLabels(workflow.stages[current.stage - 1]));
                for (const item of parsed.judgments) if (recordLike(item) && typeof item.id === "string" && allowedIds.includes(item.id) &&
                    typeof item.label === "string" && Object.hasOwn(SEMANTIC_CRITERIA[workflow.id], item.label)) current.jev.predictions[item.id] = item.label;
            }
        }
    });
    row.initMs = Math.round(performance.now() - initStart);
    try {
        for (const [index, stage] of workflow.stages.entries()) {
            current = { stage: index + 1, status: "running", elapsedMs: 0, gradeMs: 0, requests: 0, assistantMessages: 0,
                requestBytes: [], prefixPreserved: true, toolDefinitionsStable: true, inspections: 0, argumentChars: 0, resultChars: 0,
                protocolValid: true, outputValid: false, predictions: {}, correct: 0, total: stage.samples.length, exact: false, followedJudgments: null,
                usage: emptyUsage(), failure: null,
                jev: { calls: 0, reason: null, elapsedMs: null, requestMatched: true, inputTokens: null, outputTokens: null, predictions: {}, correct: null } };
            finalText = "";
            row.stages.push(current);
            await save?.(row);
            const start = performance.now();
            const timer = setTimeout(() => { if (current) current.status = "timeout"; void session.abort(); }, LIMITS.stageMs);
            try {
                await session.prompt(`Interpret batch-${index + 1} using mode ${workflow.id}. Return one label for every item as the required JSON object.`);
                await session.waitForIdle();
            } catch (error) { if (current.status === "running") { current.status = "session_error"; current.failure = failureKind(error); } }
            finally { clearTimeout(timer); }
            current.elapsedMs = Math.round(performance.now() - start);
            row.elapsedMs += current.elapsedMs;
            const gradeStart = performance.now();
            const parsed = parseLabels(finalText);
            const expected = expectedLabels(stage);
            current.outputValid = recordLike(parsed) && Object.keys(parsed).length === stage.samples.length &&
                Object.entries(parsed).every(([id, value]) => Object.hasOwn(expected, id) && typeof value === "string" && Object.hasOwn(SEMANTIC_CRITERIA[workflow.id], value));
            if (recordLike(parsed)) for (const [id, value] of Object.entries(parsed)) if (Object.hasOwn(expected, id) && typeof value === "string" && Object.hasOwn(SEMANTIC_CRITERIA[workflow.id], value)) current.predictions[id] = value;
            const grade = gradeLabels(stage, parsed);
            current.correct = grade.correct;
            current.exact = grade.exact && current.outputValid;
            current.protocolValid &&= current.inspections === 1 && current.jev.requestMatched;
            if (arm === "jev" && current.jev.reason === "none") {
                current.followedJudgments = isDeepStrictEqual(current.predictions, current.jev.predictions);
                current.jev.correct = gradeLabels(stage, current.jev.predictions).correct;
                current.protocolValid &&= current.followedJudgments && current.jev.calls === 1;
            } else if (arm === "main") current.protocolValid &&= current.jev.calls === 0 && current.jev.reason === "disabled";
            if (current.status === "running") current.status = current.protocolValid && current.outputValid ? "completed" : "invalid_output";
            current.gradeMs = Math.round(performance.now() - gradeStart);
            await save?.(row);
            if (!providedRuntime) console.log(`${row.id} stage ${index + 1}: ${current.status}; ${current.correct}/${current.total}; ${current.elapsedMs} ms; Jev ${current.jev.reason}`);
            if (["provider_error", "session_error", "extension_error", "timeout", "request_limit"].includes(current.status)) break;
        }
        row.status = row.stages.length === workflow.stages.length && row.stages.every(stage => stage.status === "completed") ? "completed" : "incomplete";
        row.success = row.status === "completed" && row.stages.every(stage => stage.exact && stage.protocolValid);
        return row;
    } finally { globalThis.fetch = originalFetch; unsubscribe(); session.dispose(); }
}

export function summarizeSemantic(rows: SemanticRun[]) {
    const groups = semanticWorkflows.flatMap(workflow => SEMANTIC_ARMS.map(arm => {
        const samples = rows.filter(row => row.workflow === workflow.id && row.arm === arm);
        const stages = samples.flatMap(row => row.stages);
        const usage = emptyUsage();
        for (const stage of stages) addUsage(usage, stage.usage);
        const times = samples.map(row => row.elapsedMs);
        return { workflow: workflow.id, arm, n: samples.length, success: samples.filter(row => row.success).length,
            correct: stages.reduce((sum, stage) => sum + stage.correct, 0), total: samples.length * workflow.stages.reduce((sum, stage) => sum + stage.samples.length, 0),
            medianMs: median(times), minMs: times.length ? Math.min(...times) : null, maxMs: times.length ? Math.max(...times) : null,
            requests: stages.reduce((sum, stage) => sum + stage.requests, 0), usage,
            resultChars: stages.reduce((sum, stage) => sum + stage.resultChars, 0),
            prefixChanges: stages.filter(stage => !stage.prefixPreserved || !stage.toolDefinitionsStable).length,
            jevCalls: stages.reduce((sum, stage) => sum + stage.jev.calls, 0),
            jevFallbacks: arm === "jev" ? stages.filter(stage => stage.jev.reason !== "none").length : 0,
            jevInputTokens: arm === "jev" ? stages.reduce<number | null>((sum, stage) => stage.jev.inputTokens === null ? sum : (sum ?? 0) + stage.jev.inputTokens, null) : null,
            jevOutputTokens: arm === "jev" ? stages.reduce<number | null>((sum, stage) => stage.jev.outputTokens === null ? sum : (sum ?? 0) + stage.jev.outputTokens, null) : null };
    }));
    const pairs = rows.filter(row => row.arm === "jev").map(jev => {
        const main = rows.find(row => row.arm === "main" && row.workflow === jev.workflow && row.repeat === jev.repeat);
        const eligible = !!main?.success && jev.success && jev.stages.every(stage => stage.jev.reason === "none" && stage.jev.requestMatched);
        return { workflow: jev.workflow, repeat: jev.repeat, eligible, ratio: eligible && jev.elapsedMs > 0 ? main!.elapsedMs / jev.elapsedMs : null };
    });
    return { experiment: SEMANTIC_EXPERIMENT, groups, pairs, actualCostUsd: null };
}

export async function reportSemantic(directory: string): Promise<void> {
    const rows: SemanticRun[] = [];
    for (const step of semanticSchedule()) {
        try { rows.push(JSON.parse(await readFile(join(directory, "runs", `${step.workflow}-${step.repeat}-${step.arm}.json`), "utf8"))); }
        catch (error) { if (!recordLike(error) || error.code !== "ENOENT") throw error; }
    }
    await atomicJson(join(directory, "summary.json"), summarizeSemantic(rows));
    await writeFile(join(directory, "runs.jsonl"), rows.map(row => JSON.stringify(row)).join("\n") + "\n");
    const columns = ["run", "workflow", "arm", "repeat", "stage", "status", "correct", "total", "elapsed_ms", "requests", "input", "cache_read", "output", "jev_calls", "jev_reason", "jev_input", "jev_output"];
    await writeFile(join(directory, "stages.csv"), [columns.join(","), ...rows.flatMap(row => row.stages.map(stage => [row.id, row.workflow, row.arm, row.repeat, stage.stage, stage.status, stage.correct, stage.total, stage.elapsedMs, stage.requests,
        stage.usage.input, stage.usage.cacheRead, stage.usage.output, stage.jev.calls, stage.jev.reason, stage.jev.inputTokens, stage.jev.outputTokens].map(value => value ?? "").join(",")))].join("\n") + "\n");
}

export async function runSemanticBatch(batch: string, sourceHash: string, harnessCommit: string): Promise<void> {
    const git = (args: string[], cwd?: string) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
    if (git(["status", "--porcelain", "--", "src", "package.json", "package-lock.json"]) || git(["status", "--porcelain", "--", "src", "package.json", "package-lock.json"], SIEVE_ROOT)) throw new Error("The pinned source must be committed.");
    const sieveCommit = git(["rev-parse", "HEAD"], SIEVE_ROOT);
    const directory = join("reports", batch), manifestPath = join(directory, "manifest.json");
    const manifest = { experiment: SEMANTIC_EXPERIMENT, createdAt: new Date().toISOString(), sourceHash, harnessCommit, sieveCommit,
        versions: { pi: VERSIONS.pi, provider: VERSIONS.provider, model: RETRIEVAL_MODEL, thinking: "medium", jev: VERSIONS.jev }, limits: LIMITS, schedule: semanticSchedule(),
        method: "Two fictional workflows, three sequential batches of eight independent observations each, two arms, three repetitions. Same plugin, tool schema, questions, evidence, permissions, prompts, and session history policy. Main arm uses /sieve off behavior to read raw observations; Jev arm returns labels from one real batch request inside that same tool. Main model classifies raw observations or forwards supplied labels unchanged. No extra score handoff round. Independent reference labels remain outside workspaces and prompts. Score exact label agreement, not real coding completion.",
        timing: "First prompt through final assistant response per stage, including inspection, Jev, and response generation. Initialization and external grading excluded and recorded. Same session within each run, isolated sessions between runs. Serial rotated arm order. No automatic retry. A 10-second Jev timeout is an explicit diagnostic override of the 1.5-second production default.",
        cache: "Record uncached/cache input, output, request bytes, and hashes of prior input messages and fixed request settings. Do not store payloads or reasoning. No cache warming or reset; routing, cache boundaries, history differences, and provider variability remain. Never interpret prefix equality as guaranteed cache hits.",
        publication: "Local only; no chart, public README performance claim, push, or release." };
    try { const prior = JSON.parse(await readFile(manifestPath, "utf8")); if (prior.sourceHash !== sourceHash || prior.sieveCommit !== sieveCommit) throw new Error("Cannot resume with changed source."); }
    catch (error) { if (!recordLike(error) || error.code !== "ENOENT") throw error; await atomicJson(manifestPath, manifest); }
    let providerFailures = 0;
    for (const step of semanticSchedule()) {
        const id = `${step.workflow}-${step.repeat}-${step.arm}`, path = join(directory, "runs", `${id}.json`);
        try {
            const prior: SemanticRun = JSON.parse(await readFile(path, "utf8"));
            if (prior.status === "running") { prior.status = "interrupted"; prior.success = false; await atomicJson(path, prior); }
            console.log(`Preserved ${id}`); continue;
        } catch (error) { if (!recordLike(error) || error.code !== "ENOENT") throw error; }
        if (providerFailures >= 3) { console.log("Paused after three consecutive provider failures."); break; }
        const root = resolve(".work", batch, id);
        await mkdir(resolve(".work", batch), { recursive: true }); await mkdir(root);
        const workflow = semanticWorkflows.find(workflow => workflow.id === step.workflow)!;
        const row = await semanticRun(root, workflow, step.arm, step.repeat, undefined, row => atomicJson(path, row));
        await atomicJson(path, row);
        providerFailures = row.stages.some(stage => ["provider_error", "session_error"].includes(stage.status) || stage.jev.reason === "service_error") ? providerFailures + 1 : 0;
        await reportSemantic(directory);
    }
    await reportSemantic(directory);
}

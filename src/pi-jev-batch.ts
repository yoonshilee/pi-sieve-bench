import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { decisionCases } from "./decision-cases.ts";
import { probeDecision, type ProbeResult } from "./decision-probe.ts";
import { PI_JEV_COMMIT, PI_JEV_MODES, type PiJevMode } from "./pi-jev-probe.ts";
import { addUsage, emptyUsage, median, RETRIEVAL_MODEL, VERSIONS } from "./metrics.ts";
import { atomicJson } from "./runner.ts";

export const PI_JEV_EXPERIMENT = "pi-jev-native-decision-probe";
const BASELINE = "profile-probe-20260921-sol-v05";
type Result = ProbeResult & { variant: PiJevMode };
export const piJevSchedule = () => [1, 2, 3].flatMap(repeat => decisionCases.flatMap((item, index) =>
    ((repeat + index) % 2 ? [...PI_JEV_MODES] : [...PI_JEV_MODES].reverse()).map(variant => ({ caseId: item.id, repeat, variant }))));
const valid = (r: ProbeResult) => r.status === "completed" && r.optionMatched && (r.arm === "direct" ? r.jev.calls === 0 :
    r.jev.calls === 1 && r.jev.reason === "none" && r.contextMatched && r.followedSelection &&
    (!r.piJev || (r.piJev.wireRequests === 1 && r.piJev.blockedRetries === 0 && r.piJev.modelMatched && r.piJev.responseValid && r.piJev.requestMatched)));

export function summarizePiJev(rows: Result[], baseline: ProbeResult[]) {
    const combined = [...baseline.map(r => ({ ...r, variant: r.arm === "direct" ? "direct" : "sieve-score" })), ...rows.map(r => ({ ...r, variant: `pi-jev-${r.variant}` }))];
    const groups = ["all", "routine", "evidence"].flatMap(category => ["direct", "sieve-score", "pi-jev-score", "pi-jev-choice"].map(variant => {
        const samples = combined.filter(r => r.variant === variant && (category === "all" || r.category === category)), usage = emptyUsage();
        for (const sample of samples) addUsage(usage, sample.usage);
        const times = samples.flatMap(r => r.selectionMs === null ? [] : [r.selectionMs]);
        const jevValues = (field: "elapsedMs" | "dispatchMs" | "inputTokens" | "outputTokens") => samples.flatMap(r => r.jev[field] === null ? [] : [r.jev[field]!]);
        const sum = (values: number[]) => values.length ? values.reduce((a, b) => a + b, 0) : null;
        return { category, variant, n: samples.length, valid: samples.filter(valid).length, correct: samples.filter(r => valid(r) && r.correct).length,
            timed: times.length, medianMs: median(times), minMs: times.length ? Math.min(...times) : null, maxMs: times.length ? Math.max(...times) : null,
            requests: samples.reduce((n, r) => n + r.requests, 0), usage, usageComplete: samples.length > 0 && samples.every(r => Object.values(r.usage).every(v => v !== null)),
            medianArgumentChars: median(samples.map(r => r.scoreArgumentChars)), medianRequestBytes: median(samples.flatMap(r => r.requestBytes)),
            jevCalls: samples.reduce((n, r) => n + r.jev.calls, 0), jevSuccessful: samples.filter(r => r.jev.reason === "none").length,
            jevMedianMs: median(jevValues("elapsedMs")), handoffMedianMs: median(jevValues("dispatchMs")),
            jevInputTokens: sum(jevValues("inputTokens")), jevOutputTokens: sum(jevValues("outputTokens")),
            failures: Object.fromEntries([...new Set(samples.filter(r => !valid(r)).map(r => r.status === "completed" ? "protocol_invalid" : r.status))].map(status => [status, samples.filter(r => !valid(r) && (r.status === "completed" ? "protocol_invalid" : r.status) === status).length])) };
    }));
    const comparisons = ["all", "routine", "evidence"].flatMap(category => PI_JEV_MODES.flatMap(variant => ["direct", "delegated"].map(arm => {
        const ratios = rows.filter(r => r.variant === variant && (category === "all" || r.category === category)).flatMap(r => {
            const prior = baseline.find(p => p.caseId === r.caseId && p.repeat === r.repeat && p.arm === arm);
            return prior && valid(prior) && prior.correct && valid(r) && r.correct && prior.selectionMs && r.selectionMs ? [prior.selectionMs / r.selectionMs] : [];
        });
        return { category, variant, baseline: arm, correctValidPairs: ratios.length, medianHistoricalOverCurrent: median(ratios) };
    })));
    return { experiment: PI_JEV_EXPERIMENT, currentTrials: rows.length, historicalTrials: baseline.length, groups, comparisons, actualCostUsd: null,
        limitation: "Historical controls ran in a different time block. Score serializes the shared rubric and options through pi-jev's native interface; Choice changes the decision primitive. This compares native workflows, not isolated plugin overhead. Selection agreement is not coding-task success. Failed attempts remain; medians include only attempts reaching the sink, with timed counts shown. No release claims." };
}

export async function reportPiJev(directory: string): Promise<void> {
    const manifest = JSON.parse(await readFile(join(directory, "manifest.json"), "utf8"));
    const historical = await readFile(join("reports", BASELINE, "runs.jsonl"));
    if (createHash("sha256").update(historical).digest("hex") !== manifest.baselineDataHash) throw new Error("Historical comparison data changed.");
    const baseline = historical.toString().trim().split("\n").map(line => JSON.parse(line) as ProbeResult);
    const rows: Result[] = [];
    for (const item of piJevSchedule()) {
        try { rows.push(JSON.parse(await readFile(join(directory, "runs", `${item.caseId}-${item.repeat}-pi-jev-${item.variant}.json`), "utf8"))); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    }
    await atomicJson(join(directory, "summary.json"), summarizePiJev(rows, baseline));
    await writeFile(join(directory, "runs.jsonl"), rows.map(r => JSON.stringify(r)).join("\n") + "\n");
    const fields = ["id", "caseId", "repeat", "variant", "status", "valid", "correct", "selectionMs", "requests", "input", "cacheRead", "output", "reasoning", "totalTokens", "jevCalls", "jevInput", "jevOutput", "jevMs", "handoffMs", "argumentChars"];
    await writeFile(join(directory, "runs.csv"), [fields.join(","), ...rows.map(r => [r.id, r.caseId, r.repeat, r.variant, r.status, valid(r), valid(r) && r.correct, r.selectionMs, r.requests, r.usage.input, r.usage.cacheRead, r.usage.output, r.usage.reasoning, r.usage.totalTokens, r.jev.calls, r.jev.inputTokens, r.jev.outputTokens, r.jev.elapsedMs, r.jev.dispatchMs, r.scoreArgumentChars].join(","))].join("\n") + "\n");
}

export async function runPiJevBatch(batch: string, sourceHash: string, harnessCommit: string): Promise<void> {
    if (execFileSync("git", ["status", "--porcelain", "--", "src", "package.json", "package-lock.json"], { encoding: "utf8" }).trim()) throw new Error("The pinned benchmark source must be committed.");
    const directory = join("reports", batch), manifestPath = join(directory, "manifest.json");
    const baselineDataHash = createHash("sha256").update(await readFile(join("reports", BASELINE, "runs.jsonl"))).digest("hex");
    const manifest = { experiment: PI_JEV_EXPERIMENT, sourceHash, harnessCommit, createdAt: new Date().toISOString(), piJevCommit: PI_JEV_COMMIT,
        versions: { pi: VERSIONS.pi, provider: VERSIONS.provider, model: RETRIEVAL_MODEL, thinking: VERSIONS.thinking, jev: VERSIONS.jev, piJev: "0.5.0", typesafeSdk: "0.6.0" },
        baselineBatch: BASELINE, baselineDataHash, limits: { trialMs: 90_000, mainRequests: 4, jevTimeoutMs: 10_000, outboundJevRequests: 1 }, schedule: piJevSchedule(),
        method: "Same frozen six cases, eight candidates, rubric, medium reasoning, and action sink as the historical probe. Native pinned pi-jev extension; only jev_evaluate and the sink are exposed. Auto routing, guards, agents, and compaction disabled. Score uses eight ordered questions; Choice uses one question with all options. Supplied arguments must be copied exactly. Main model dispatches the selected candidate without semantic reranking. No shell execution.",
        instrumentation: "Pi native credentials passed through an ephemeral environment key; official API root forced and SDK logging disabled. Observer validates exact outbound arguments and response, records whitelisted usage, blocks additional outbound attempts, and applies the same 10-second deadline. Native SDK may internally back off on an error; blocked retries are recorded. No changes to pi-jev source.",
        timing: "First prompt through action-sink entry, including argument generation, Jev, and main-model handoff. Initialization and final acknowledgement excluded. Native Jev elapsed includes response parsing; observer clones response for validation and usage. Cases and repeats alternate modes, serially, fresh sessions. Historical controls are not contemporaneous; caches cannot be reset.",
        publication: "Local only. No charts, remote push, or release performance claims." };
    try { const prior = JSON.parse(await readFile(manifestPath, "utf8")); if (prior.sourceHash !== sourceHash || prior.piJevCommit !== PI_JEV_COMMIT || prior.baselineDataHash !== baselineDataHash) throw new Error("Cannot resume a batch with changed experiment inputs."); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; await atomicJson(manifestPath, manifest); }
    let errors = 0;
    for (const step of piJevSchedule()) {
        const item = decisionCases.find(c => c.id === step.caseId)!;
        const id = `${item.id}-${step.repeat}-pi-jev-${step.variant}`, path = join(directory, "runs", `${id}.json`);
        let record: Result | undefined;
        try { record = JSON.parse(await readFile(path, "utf8")); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
        if (!record) {
            if (errors >= 3) { console.log("Paused after three consecutive provider failures."); break; }
            const root = resolve(".work", batch, id);
            await mkdir(resolve(".work", batch), { recursive: true }); await mkdir(root);
            await atomicJson(path, { id, caseId: item.id, category: item.category, arm: "delegated", repeat: step.repeat, variant: step.variant,
                status: "interrupted", correct: false, optionMatched: false, contextMatched: null, followedSelection: null, selectedId: null, selectionMs: null,
                requests: 0, toolCalls: 0, requestBytes: [], scoreArgumentChars: 0, executionArgumentChars: 0, usage: emptyUsage(),
                jev: { calls: 0, reason: null, elapsedMs: null, dispatchMs: null, inputTokens: null, outputTokens: null }, failure: null } satisfies Result);
            record = { ...await probeDecision(root, item, "delegated", step.repeat, undefined, step.variant), id, variant: step.variant };
            await atomicJson(path, record);
        }
        errors = ["provider_error", "session_error"].includes(record.status) || ["service_error", "request_error"].includes(record.jev.reason ?? "") ? errors + 1 : 0;
        await reportPiJev(directory);
        console.log(`${id}: ${record.status}; valid ${valid(record)}; correct ${record.correct}; ${record.selectionMs ?? "unknown"} ms; ${record.requests} model requests`);
    }
}

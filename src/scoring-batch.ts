import { execFileSync } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { atomicJson, preserveExistingRun, runWorkflow } from "./runner.ts";
import { addUsage, emptyUsage, LIMITS, median, RETRIEVAL_MODEL, SCORING_ARMS, SCORING_COMMIT, score, VERSIONS, type Run } from "./metrics.ts";
import { SIEVE_CONFIG } from "./fixtures.ts";

export const scoringSchedule = () => [1, 2, 3].flatMap(repeat => (repeat % 2 ? [...SCORING_ARMS] : [...SCORING_ARMS].reverse()).map(arm => ({ repeat, arm })));

export function scoringSummary(rows: Run[]) {
    const runs = rows.map(run => {
        const usage = emptyUsage();
        for (const stage of run.stages) addUsage(usage, stage.usage);
        const selections = run.stages.flatMap(stage => stage.scoring ?? []);
        const validDecisions = run.stages.length === 5 && (run.arm === "score-self" || run.stages.every(stage => (stage.scoring ?? []).every(call => call.selectionValid && call.nextCommandMatched && call.commandGeneratedAfterResponse && call.executionCompleted)));
        const validScoring = run.stages.every(stage => stage.jev.requests === (stage.scoring ?? []).length) &&
            (run.arm === "score-self" ? selections.length === 0 : run.stages.length === 5 && run.stages.every(stage => (stage.scoring ?? []).every(call => call.reason === "none")));
        const jevTokens = (field: "inputTokens" | "outputTokens") => {
            const values = run.stages.flatMap(stage => stage.jev[field] === null ? [] : [stage.jev[field]]);
            return values.length ? values.reduce((sum, value) => sum + value, 0) : null;
        };
        return { id: run.id, arm: run.arm, repeat: run.repeat, status: run.status, success: run.success,
            seconds: run.elapsedMs / 1000, stageScore: score(run), requests: run.stages.reduce((sum, s) => sum + s.requests, 0),
            toolCalls: run.stages.reduce((sum, s) => sum + s.toolCalls, 0), toolErrors: run.stages.reduce((sum, s) => sum + s.toolErrors, 0),
            validDecisions, validScoring, validComparison: validDecisions && validScoring, decisionsDelegated: selections.length, usage,
            jevRequests: run.stages.reduce((sum, s) => sum + s.jev.requests, 0),
            jevInput: jevTokens("inputTokens"), jevOutput: jevTokens("outputTokens"),
            unavailableScores: selections.filter(s => s.reason !== "none").length,
            scoringMs: selections.reduce((sum, s) => sum + (s.elapsedMs ?? 0), 0) };
    });
    const groups = SCORING_ARMS.map(arm => {
        const samples = runs.filter(run => run.arm === arm);
        const times = samples.map(run => run.seconds);
        return { arm, n: samples.length, successes: samples.filter(run => run.success).length, validComparisons: samples.filter(run => run.validComparison).length,
            medianSeconds: median(times), minSeconds: times.length ? Math.min(...times) : null, maxSeconds: times.length ? Math.max(...times) : null,
            meanStageScore: samples.length ? samples.reduce((sum, run) => sum + run.stageScore, 0) / samples.length : null,
            medianRequests: median(samples.map(run => run.requests)), medianInput: median(samples.flatMap(run => run.usage.input === null ? [] : [run.usage.input])),
            medianCached: median(samples.flatMap(run => run.usage.cacheRead === null ? [] : [run.usage.cacheRead])),
            medianOutput: median(samples.flatMap(run => run.usage.output === null ? [] : [run.usage.output])),
            medianTokens: median(samples.flatMap(run => run.usage.totalTokens === null ? [] : [run.usage.totalTokens])),
            jevRequests: samples.reduce((sum, run) => sum + run.jevRequests, 0), unavailableScores: samples.reduce((sum, run) => sum + run.unavailableScores, 0) };
    });
    const pairedRatios = runs.filter(run => run.arm === "score-jev" && run.success && run.validComparison).flatMap(run => {
        const baseline = runs.find(other => other.arm === "score-self" && other.repeat === run.repeat && other.success && other.validComparison);
        return baseline && run.seconds > 0 ? [baseline.seconds / run.seconds] : [];
    });
    return { experiment: "adaptive-command-choice-v0.5", runs, groups, matchedSuccessPairs: pairedRatios.length,
        medianBaselineOverJev: median(pairedRatios), actualCostUsd: null };
}

export async function runScoringBatch(batch: string, sourceHash: string, harnessCommit: string): Promise<void> {
    const pluginHead = execFileSync("git", ["-C", "../pi-sieve", "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    const dirty = execFileSync("git", ["-C", "../pi-sieve", "status", "--porcelain"], { encoding: "utf8" }).trim();
    if (pluginHead !== SCORING_COMMIT || dirty) throw new Error("The pinned scoring plugin must be a clean adjacent checkout.");
    const directory = join("reports", batch);
    const manifestPath = join(directory, "manifest.json");
    try {
        const prior = JSON.parse(await readFile(manifestPath, "utf8"));
        if (prior.sourceHash !== sourceHash || prior.sieveCommit !== SCORING_COMMIT) throw new Error("Cannot resume a batch with changed experiment code.");
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        await atomicJson(manifestPath, { experiment: "adaptive-command-choice-v0.5", batch, createdAt: new Date().toISOString(), sourceHash, harnessCommit,
            sieveCommit: SCORING_COMMIT, versions: { ...VERSIONS, model: RETRIEVAL_MODEL, sieve: SCORING_COMMIT }, sieveConfig: SIEVE_CONFIG, limits: LIMITS,
            schedule: scoringSchedule(), workflow: "payments", fixtureRevision: "explicit-nonblank-callback-ids", node: process.version,
            method: "Direct Sol handles actions itself; the adaptive arm delegates only substantial comparisons and prefers a known reusable profile. Zero scoring calls is allowed and reported. No candidate quota or decision files. An observer checks the first subsequent bash command. Same fixed tool schemas in both arms, not unmodified native Pi. Candidates may differ. Five continuous stages; no grading feedback or selective reruns.",
            cachePolicy: "Serial alternating pair order; native server caches cannot be cleared. Three repeats do not establish statistical significance.",
            publication: "Local only. No charts or public performance report." });
    }
    const rows: Run[] = [];
    let providerErrors = 0;
    for (const item of scoringSchedule()) {
        const record = join(directory, "runs", `payments-${item.repeat}-${item.arm}.json`);
        if (await preserveExistingRun(record)) rows.push(JSON.parse(await readFile(record, "utf8")) as Run);
        else {
            if (providerErrors >= 3) { console.log("Paused after three consecutive provider failures."); break; }
            const root = resolve(".work", batch, `payments-${item.repeat}-${item.arm}`);
            await mkdir(resolve(".work", batch), { recursive: true });
            await mkdir(root, { recursive: false });
            console.log(`Starting ${item.arm}, repeat ${item.repeat}/3`);
            const run = await runWorkflow({ root, record, batch, kind: "pilot", workflow: "payments", ...item, harnessCommit, fixtureHash: sourceHash,
                onReady: async session => {
                    if (!await session.extensionRunner!.createContext().modelRegistry.getApiKeyForProvider("typesafe")) throw new Error("The pinned TypeSafe credential is unavailable.");
                } });
            rows.push(run);
            providerErrors = run.status === "provider_error" ? providerErrors + 1 : 0;
        }
        if (new Set(rows.map(run => run.initialHash)).size !== 1) throw new Error("Benchmark initial files differ.");
        await atomicJson(join(directory, "summary.json"), scoringSummary(rows));
    }
    console.log(`Saved local scoring data: ${directory}/summary.json`);
}

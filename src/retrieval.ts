import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { atomicJson, preserveExistingRun, runWorkflow } from "./runner.ts";
import { addUsage, emptyUsage, LIMITS, median, REQUIRED_REFERENCES, RETRIEVAL_ARMS, RETRIEVAL_COMMIT, RETRIEVAL_QUERIES, score, stageScore, VERSIONS, type Run } from "./metrics.ts";
import { SIEVE_CONFIG } from "./fixtures.ts";

export function retrievalSummary(rows: Run[]) {
    const groups = rows.map(run => {
        const usage = emptyUsage();
        for (const stage of run.stages) addUsage(usage, stage.usage);
        const calls = run.stages.flatMap(stage => stage.retrievals ?? []);
        const jevUsage = (field: "inputTokens" | "outputTokens") => {
            const values = run.stages.flatMap(stage => stage.jev[field] === null ? [] : [stage.jev[field]]);
            return values.length ? values.reduce((n, value) => n + value, 0) : null;
        };
        const recalls = Array.from({ length: 5 }, (_, index) => {
            const names = new Set(run.stages[index]?.retrievals?.[0]?.names ?? []);
            const required = REQUIRED_REFERENCES[index];
            return required.filter(name => names.has(name)).length / required.length;
        });
        const fallbackCalls = calls.filter(call => run.arm === "retrieval-jev" && call.reason !== "none");
        return { arm: run.arm, workflow: run.workflow, model: run.versions.model, status: run.status, success: run.success,
            n: 1, successes: Number(run.success), medianSeconds: run.elapsedMs / 1000, initMs: run.initMs, gradeMs: run.gradeMs,
            meanScore: score(run), stageScores: Array.from({ length: 5 }, (_, i) => run.stages[i] ? stageScore(run, run.stages[i]) : 0),
            requiredRecallByStage: recalls, meanRequiredRecall: recalls.reduce((sum, value) => sum + value, 0) / 5,
            requests: run.stages.reduce((sum, stage) => sum + stage.requests, 0), retrievalCalls: calls.length,
            retrievedChars: calls.reduce((sum, call) => sum + call.resultChars, 0), retrievalMedianMs: median(calls.flatMap(call => call.elapsedMs === null ? [] : [call.elapsedMs])),
            validRetrieval: run.stages.length === 5 && run.stages.every(stage => (stage.retrievals?.length ?? 0) > 0 && stage.retrievals?.[0].queryMatched === true && stage.retrievals.every(call => call.reason === (run.arm === "retrieval-local" ? "disabled" : "none"))),
            fallbacks: fallbackCalls.length, fallbackReasons: fallbackCalls.map(call => call.reason),
            jevRequests: run.stages.reduce((sum, stage) => sum + stage.jev.requests, 0), jevInputTokens: jevUsage("inputTokens"), jevOutputTokens: jevUsage("outputTokens"),
            usage, medianInput: usage.input, medianCached: usage.cacheRead, medianOutput: usage.output,
            cacheReadShare: usage.input !== null && usage.cacheRead !== null && usage.input + usage.cacheRead > 0 ? usage.cacheRead / (usage.input + usage.cacheRead) : null };
    });
    const baseline = groups.find(group => group.arm === "retrieval-local");
    const treatment = groups.find(group => group.arm === "retrieval-jev");
    const matched = baseline?.success && treatment?.success && baseline.validRetrieval && treatment.validRetrieval;
    return { experiment: "on-demand-retrieval-v0.2", groups, reviewedChecks: 0,
        matchedSuccessPairs: matched ? 1 : 0,
        baselineOverJevSeconds: matched && treatment.medianSeconds > 0 ? baseline.medianSeconds / treatment.medianSeconds : null,
        actualCostUsd: null };
}

export async function reportRetrieval(directory: string, rows: Run[], plots = true): Promise<void> {
    rows = RETRIEVAL_ARMS.flatMap(arm => rows.filter(run => run.arm === arm));
    const summary = retrievalSummary(rows);
    await atomicJson(join(directory, "summary.json"), summary);
    await writeFile(join(directory, "runs.jsonl"), rows.map(run => JSON.stringify(run)).join("\n") + "\n");
    const fields = ["arm", "success", "seconds", "stageScore", "requiredRecall", "requests", "retrievalCalls", "retrievedChars", "input", "cacheRead", "output", "totalTokens", "jevRequests", "jevInput", "jevOutput", "fallbacks"];
    const csv = [fields.join(","), ...summary.groups.map(g => [g.arm, g.success, g.medianSeconds, g.meanScore, g.meanRequiredRecall, g.requests, g.retrievalCalls, g.retrievedChars, g.usage.input, g.usage.cacheRead, g.usage.output, g.usage.totalTokens, g.jevRequests, g.jevInputTokens, g.jevOutputTokens, g.fallbacks].join(","))].join("\n") + "\n";
    await writeFile(join(directory, "runs.csv"), csv);
    const fmt = (value: number | null, digits = 0) => value === null ? "N/A" : value.toFixed(digits);
    let markdown = `# On-demand retrieval comparison\n\nOne payments workflow per condition, five consecutive stages. Pi ${VERSIONS.pi}; ${VERSIONS.provider}/${VERSIONS.model}; ${VERSIONS.thinking}; Jev ${VERSIONS.jev}; Sieve ${RETRIEVAL_COMMIT}.\n\nRun dates (UTC): ${[...new Set(rows.map(run => run.startedAt.slice(0, 10)))].join(", ")}. [Frozen manifest](manifest.json).\n\n`;
    markdown += "Both conditions load the same plugin and fixed tool schema. Local uses /sieve off; Jev uses /sieve on. Each stage explicitly requests the same fixed retrieval query before the same coding task; additional reads are allowed. The query requirement measures a controlled retrieval workflow, not spontaneous tool adoption. The shared project config uses a 10-second Jev timeout, not the 1.5-second production default. Initial file hashes must match.\n\n";
    try { markdown += (await readFile(join(directory, "notes.md"), "utf8")).trim() + "\n\n"; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    markdown += "| Condition | Success | Stage checks | Seconds | Main requests | Retrieval calls | Main tokens | Jev fallbacks / requests |\n| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |\n";
    for (const g of summary.groups) markdown += `| ${g.arm} | ${g.successes}/1 | ${fmt(g.meanScore * 100, 1)}% | ${fmt(g.medianSeconds, 3)} | ${g.requests} | ${g.retrievalCalls} | ${fmt(g.usage.totalTokens)} | ${g.fallbacks}/${g.jevRequests} |\n`;
    markdown += "\n## Usage and retrieval\n\n| Condition | Uncached input | Cached input | Output | Cache share of input | Jev input / output | First-search required recall | Returned characters |\n| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |\n";
    for (const g of summary.groups) markdown += `| ${g.arm} | ${fmt(g.usage.input)} | ${fmt(g.usage.cacheRead)} | ${fmt(g.usage.output)} | ${g.cacheReadShare === null ? "N/A" : fmt(g.cacheReadShare * 100, 1) + "%"} | ${fmt(g.jevInputTokens)} / ${fmt(g.jevOutputTokens)} | ${fmt(g.meanRequiredRecall * 100, 1)}% | ${g.retrievedChars} |\n`;
    markdown += `\nSuccessful matched pairs with valid retrieval: ${summary.matchedSuccessPairs}. Local/Jev duration ratio: ${fmt(summary.baselineOverJevSeconds, 3)}. Ratios are not reported for failed workflows, missing or nonmatching first retrieval, or Jev fallback.\n\n`;
    markdown += "## Stage outcomes\n\n| Condition | Stage | Status | Checks | Seconds | Search reasons |\n| --- | ---: | --- | ---: | ---: | --- |\n";
    for (const run of rows) for (const stage of run.stages) markdown += `| ${run.arm} | ${stage.stage} | ${stage.status} | ${stage.checks.filter(check => check.passed).length}/${stage.checks.length} | ${fmt(stage.elapsedMs / 1000, 3)} | ${(stage.retrievals ?? []).map(call => call.reason).join(", ") || "not_run"} |\n`;
    markdown += "\n## Interpretation limits\n\nThis is one paired observation on a fictional payments project, not statistical evidence of a repeatable gain. Local runs first; order, provider cache reuse, service load, and model trajectories are uncontrolled. A new session does not clear server caches. Timing includes retrieval, model work, and tools; initialization and independent grading are excluded. Both modes retain stable tools and ordinary append-only results. Reported cache tokens are not direct measurements of KV-cache internals.\n\nRequired-reference recall is the mean of five stage recalls from the first search result, based on frozen reference names. It measures returned references, not whether the model used them or read them later. Independent hidden checks determine task correctness. Missing stages score zero; failures and fallback are retained without selective reruns. Characters are not tokens. Reasoning tokens are included in output. Usage not returned by a provider is null; partial totals may undercount failed requests. Actual monetary charges are unknown.\n\n[CSV](runs.csv) · [JSONL](runs.jsonl) · [Summary](summary.json)\n";
    if (plots) {
        const result = spawnSync(process.env.BENCH_PYTHON ?? ".venv/bin/python3", ["scripts/plot.py", directory], { stdio: "pipe", env: { ...process.env, MPLCONFIGDIR: resolve(".local/matplotlib") } });
        if (result.status !== 0) throw new Error("Plot generation failed.");
        markdown += "\n![Paired on-demand retrieval observations](benchmark.png)\n";
    }
    await writeFile(join(directory, "README.md"), markdown);
}

export async function compareRetrieval(batch: string, sourceHash: string, harnessCommit: string): Promise<void> {
    const directory = join("reports", batch);
    const manifestPath = join(directory, "manifest.json");
    try {
        const prior = JSON.parse(await readFile(manifestPath, "utf8"));
        if (prior.sourceHash !== sourceHash || prior.experiment !== "on-demand-retrieval-v0.2") throw new Error("Cannot resume a batch with changed experiment code.");
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        await atomicJson(manifestPath, { batch, experiment: "on-demand-retrieval-v0.2", kind: "pilot", createdAt: new Date().toISOString(), sourceHash, harnessCommit,
            versions: { ...VERSIONS, sieve: RETRIEVAL_COMMIT }, sieveConfig: SIEVE_CONFIG, limits: LIMITS,
            schedule: RETRIEVAL_ARMS, queries: RETRIEVAL_QUERIES, requiredReferences: REQUIRED_REFERENCES,
            node: process.version, cachePolicy: "Local first, Jev second. No explicit warming. Provider caches cannot be cleared. Prior experiments may affect caching." });
    }
    const rows: Run[] = [];
    for (const arm of RETRIEVAL_ARMS) {
        const record = join(directory, "runs", `payments-1-${arm}.json`);
        if (await preserveExistingRun(record)) rows.push(JSON.parse(await readFile(record, "utf8")) as Run);
        else {
            const root = resolve(".work", batch, arm);
            await mkdir(resolve(".work", batch), { recursive: true });
            await mkdir(root, { recursive: false });
            console.log(`Starting ${arm}`);
            rows.push(await runWorkflow({ root, record, batch, kind: "pilot", workflow: "payments", arm, repeat: 1, harnessCommit, fixtureHash: sourceHash,
                onReady: async session => {
                    const key = await session.extensionRunner!.createContext().modelRegistry.getApiKeyForProvider("typesafe");
                    if (!key) throw new Error("The pinned TypeSafe credential is unavailable.");
                } }));
        }
    }
    if (new Set(rows.map(run => run.initialHash)).size !== 1) throw new Error("Benchmark initial files differ.");
    await reportRetrieval(directory, rows);
    console.log(`Saved retrieval comparison: ${directory}/README.md`);
}

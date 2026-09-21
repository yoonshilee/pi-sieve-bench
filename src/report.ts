import { readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { ARMS, armConfig, emptyUsage, addUsage, median, pairedSpeedup, score, stageScore, stageChecks, isSuccessful, hasValidSelection, type Run } from "./metrics.ts";
export async function loadRuns(directory: string): Promise<Run[]> {
    const files = (await readdir(join(directory, "runs"))).filter(x => x.endsWith(".json")).sort();
    return await Promise.all(files.map(async file => JSON.parse(await readFile(join(directory, "runs", file), "utf8")) as Run));
}
export function summarize(rows: Run[]) {
    const groups = [...new Set(rows.map(r => r.workflow))].flatMap(workflow => ARMS.flatMap(arm => {
        const runs = rows.filter(r => r.workflow === workflow && r.arm === arm);
        if (!runs.length) return [];
        const tokens = runs.map(r => { const u = emptyUsage(); for (const s of r.stages) addUsage(u, s.usage); return u; });
        const times = runs.map(r => r.elapsedMs / 1000), stages = runs.flatMap(r => r.stages);
        const tokenMedian = (field: keyof typeof tokens[number]) => median(tokens.flatMap(u => u[field] === null ? [] : [u[field]]));
        const jevSum = (field: "inputTokens" | "outputTokens") => {
            const values = stages.flatMap(s => s.jev[field] === null ? [] : [s.jev[field]]);
            return values.length ? values.reduce((n, v) => n + v, 0) : null;
        };
        return [{ workflow, arm, model: runs[0].versions.model, n: runs.length,
            successes: runs.filter(isSuccessful).length, rawSuccesses: runs.filter(r => r.success).length,
            validSelectionRuns: armConfig(arm).mode === "sieve" ? runs.filter(hasValidSelection).length : null,
            meanScore: runs.reduce((n, r) => n + score(r), 0) / runs.length,
            rawMeanScore: runs.reduce((n, r) => n + score(r, false), 0) / runs.length,
            stageScores: Array.from({ length: 5 }, (_, index) => runs.reduce((n, r) => { const s = r.stages.find(s => s.stage === index + 1); return n + (s ? stageScore(r, s) : 0); }, 0) / runs.length),
            medianSeconds: median(times), minSeconds: Math.min(...times), maxSeconds: Math.max(...times),
            medianTokens: tokenMedian("totalTokens"), medianInput: tokenMedian("input"), medianOutput: tokenMedian("output"), medianCached: tokenMedian("cacheRead"), medianReasoning: tokenMedian("reasoning"), medianCacheWrite: tokenMedian("cacheWrite"),
            medianRequestBytes: median(stages.flatMap(s => s.requestBytes)), medianInjectedChars: median(stages.flatMap(s => s.contextChars)),
            medianVisibleSkills: median(stages.flatMap(s => s.visibleSkills)), medianVisibleTools: median(stages.flatMap(s => s.visibleTools)),
            medianHiddenTools: median(stages.map(s => typeof s.sieve?.hidden === "number" ? s.sieve.hidden : 0)),
            jevMedianMs: median(stages.flatMap(s => typeof s.sieve?.elapsedMs === "number" ? [s.sieve.elapsedMs] : [])),
            recoveries: stages.reduce((n, s) => n + s.recoveries, 0), toolErrors: stages.reduce((n, s) => n + s.toolErrors, 0),
            jevRequests: stages.reduce((n, s) => n + s.jev.requests, 0), jevInputTokens: jevSum("inputTokens"), jevOutputTokens: jevSum("outputTokens"),
            fallbacks: stages.filter(s => s.sieve && s.sieve.reason !== "none").length,
            fallbackReasons: Object.fromEntries([...new Set(stages.flatMap(s => s.sieve && s.sieve.reason !== "none" ? [String(s.sieve.reason)] : []))].map(reason => [reason, stages.filter(s => s.sieve?.reason === reason).length])),
        }];
    }));
    const complete = rows.filter(r => r.status !== "running"), usage = emptyUsage();
    for (const r of complete) for (const s of r.stages) addUsage(usage, s.usage);
    const seconds = complete.reduce((n, r) => n + r.elapsedMs / 1000, 0);
    const jevStages = complete.flatMap(r => r.stages).filter(s => s.jev.requests > 0);
    const jevRequests = jevStages.reduce((n, s) => n + s.jev.requests, 0);
    const jevUsage = {
        inputTokens: jevStages.some(s => s.jev.inputTokens !== null) ? jevStages.reduce((n, s) => n + (s.jev.inputTokens ?? 0), 0) : null,
        outputTokens: jevStages.some(s => s.jev.outputTokens !== null) ? jevStages.reduce((n, s) => n + (s.jev.outputTokens ?? 0), 0) : null,
        complete: jevStages.length > 0 && jevStages.every(s => s.jev.inputTokens !== null && s.jev.outputTokens !== null),
    };
    return { kind: rows[0]?.kind ?? "offline", runs: rows.length, groups,
        reviewedChecks: rows.reduce((n, r) => n + (r.checkReviews?.filter(c => c.passed !== c.originalPassed).length ?? 0), 0),
        pairedSpeedups: { native: pairedSpeedup(rows, "native"), full: pairedSpeedup(rows, "full"), luna: pairedSpeedup(rows, "luna-native", "luna-sieve"), lunaVsAstra: pairedSpeedup(rows, "native", "luna-sieve") },
        totals: { seconds, usage, jevRequests, jevUsage, actualCostUsd: null },
        projection: rows[0]?.kind === "pilot" && complete.length === 5 ? { formalRuns: 60, multiplier: 12, seconds: seconds * 12, totalTokens: usage.totalTokens === null ? null : usage.totalTokens * 12, jevRequests: jevRequests * 12, jevInputTokens: jevUsage.complete ? jevUsage.inputTokens! * 12 : null, jevOutputTokens: jevUsage.complete ? jevUsage.outputTokens! * 12 : null, note: "Linear estimate from one payment attempt per arm. Early failures shorten the pilot; other workflows and service conditions may differ." } : null,
    };
}
const format = (value: number | null, digits = 0) => value === null ? "N/A" : value.toFixed(digits);
export async function report(directory: string, plots = true): Promise<void> {
    const rows = await loadRuns(directory), summary = summarize(rows);
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, "runs.jsonl"), rows.map(r => JSON.stringify({ ...r, reviewedSuccess: isSuccessful(r) })).join("\n") + "\n");
    await writeFile(join(directory, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
    const fields = ["run", "workflow", "arm", "repeat", "status", "rawSuccess", "reviewedSuccess", "rawScore", "reviewedScore", "seconds", "input", "output", "cacheRead", "cacheWrite", "reasoning", "totalTokens", "jevRequests", "initMs", "gradeMs", "medianRequestBytes", "medianInjectedChars", "medianVisibleSkills", "medianVisibleTools", "medianHiddenTools", "jevMedianMs", "recoveries", "toolErrors"];
    const csv = [fields.join(","), ...rows.map(r => {
        const u = emptyUsage(); for (const s of r.stages) addUsage(u, s.usage);
        const g = summarize([r]).groups[0];
        return [r.id, r.workflow, r.arm, r.repeat, r.status, r.success, isSuccessful(r), score(r, false), score(r), r.elapsedMs / 1000, u.input, u.output, u.cacheRead, u.cacheWrite, u.reasoning, u.totalTokens, r.stages.reduce((n, s) => n + s.jev.requests, 0), r.initMs, r.gradeMs, g.medianRequestBytes, g.medianInjectedChars, g.medianVisibleSkills, g.medianVisibleTools, g.medianHiddenTools, g.jevMedianMs, g.recoveries, g.toolErrors].join(",");
    })].join("\n") + "\n";
    await writeFile(join(directory, "runs.csv"), csv);
    let markdown = `# ${summary.kind === "pilot" ? "Pilot observations — not a performance conclusion" : "Workflow benchmark results"}\n\nModels: gpt-6-astra and gpt-5.6-luna, medium. Pi: 0.86.1. Jev: 1.13.0. Sieve: 7d54c8f.\n\nRun dates (UTC): ${rows.map(r => r.startedAt.slice(0, 10)).filter((v, i, a) => a.indexOf(v) === i).join(", ")}. See the [frozen manifest](manifest.json) for settings and source identity.\n\n`;
    markdown += "**Historical v0.1 context-filtering experiment. These measurements do not evaluate v0.2 on-demand retrieval.**\n\n";
    try { markdown += (await readFile(join(directory, "notes.md"), "utf8")).trim() + "\n\n"; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    markdown += "| Workflow | Arm | Success | Stage score | Median seconds (range) | Median total tokens | Jev fallbacks / calls |\n| --- | --- | ---: | ---: | ---: | ---: | ---: |\n";
    for (const g of summary.groups)
        markdown += `| ${g.workflow} | ${g.arm} | ${g.successes}/${g.n} | ${format(g.meanScore * 100, 1)}% | ${format(g.medianSeconds, 1)} (${format(g.minSeconds, 1)}–${format(g.maxSeconds, 1)}) | ${format(g.medianTokens)} | ${g.fallbacks}/${g.jevRequests} |\n`;
    markdown += "\nDurations include selection, the main model, and tool execution; setup and external grading are excluded and recorded separately. A fast failed run is not a speedup. Scores weight five stages equally; unrun stages score zero. A provider-error stage can have passing artifact checks without completing the workflow. Speedup ratios additionally require all five Sieve selections to succeed without fallback.\n";
    if (summary.reviewedChecks)
        markdown += `\n**Post-pilot grading correction:** ${summary.reviewedChecks} verdicts were corrected for undocumented representation constraints. Original checks and success flags remain in each run record; checkReviews supplies an auditable overlay. Tables and figures use reviewed scores. [Review evidence and provenance](grading-review.json). Raw scores remain in CSV and summary JSON.\n`;
    const comparisons = { native: "Astra Sieve vs Astra Native", full: "Astra Sieve vs Astra Full Context", luna: "Luna Sieve vs Luna Native", lunaVsAstra: "Luna Sieve vs Astra Native (model tradeoff, not isolated Jev effect)" };
    markdown += "\n";
    for (const [key, pair] of Object.entries(summary.pairedSpeedups))
        markdown += `- ${comparisons[key as keyof typeof comparisons]}: ${pair.n} successful matched pairs; median baseline/Sieve duration ratio ${format(pair.ratio, 2)}.\n`;
    if (summary.groups.some(g => g.fallbacks))
        markdown += "\n**Jev availability limitation:** fallback stages used local keyword selection. These observations cannot establish the benefit of Jev semantic selection. Separate service probes, if present, are excluded from all workflow measurements.\n";
    markdown += "\n## Token accounting\n\n| Arm | Uncached input | Cached input | Output | Reasoning subset | Jev input / output (observed only) |\n| --- | ---: | ---: | ---: | ---: | ---: |\n";
    for (const g of summary.groups)
        markdown += `| ${g.arm} | ${format(g.medianInput)} | ${format(g.medianCached)} | ${format(g.medianOutput)} | ${format(g.medianReasoning)} | ${format(g.jevInputTokens)} / ${format(g.jevOutputTokens)} |\n`;
    markdown += "\nMain-model components are medians; Jev values are sums of available responses. Reasoning is included in output, not added again. Missing usage stays null (shown as N/A); errored requests can leave usage unreported. These are reported token quantities, not a bill. Actual dollar cost is unknown; no subscription-token price is invented.\n";
    markdown += "\n## Context and selection diagnostics\n\n| Arm | Request bytes | Injected characters | Visible skills / tools | Hidden tools | Jev milliseconds | Recovery calls | Tool errors |\n| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |\n";
    for (const g of summary.groups)
        markdown += `| ${g.arm} | ${format(g.medianRequestBytes)} | ${format(g.medianInjectedChars)} | ${format(g.medianVisibleSkills)} / ${format(g.medianVisibleTools)} | ${format(g.medianHiddenTools)} | ${format(g.jevMedianMs)} | ${g.recoveries} | ${g.toolErrors} |\n`;
    markdown += "\nRequest bytes and injected characters are medians across model requests; capability counts and Jev latency are medians across recorded stages. Recovery calls and errors are totals. Native has zero temporary reference injection but can read the same references through tools. Bytes and characters are not token counts. Per-stage observations remain in JSONL.\n";
    if (summary.projection)
        markdown += `\n## Formal-batch estimate\n\nLinear projection: ${format(summary.projection.seconds / 3600, 2)} hours and ${format(summary.projection.totalTokens)} main-model tokens for 60 workflows (12 times the five-arm payment pilot). Jev: ${summary.projection.jevRequests} requests, ${format(summary.projection.jevInputTokens)} input and ${format(summary.projection.jevOutputTokens)} output tokens; token projection is unavailable when pilot usage is incomplete. This is not a bound or a bill. Early failures shorten the pilot; other workflows, cache behavior, and Jev availability may change usage substantially. Formal execution requires user confirmation.\n`;
    markdown += "\n## Outcomes and failures\n\n";
    for (const r of rows) {
        const failed = r.stages.flatMap(s => stageChecks(r, s).filter(c => !c.passed).map(c => `stage ${s.stage}: ${c.id}`));
        const fallback = r.stages.flatMap(s => s.sieve && s.sieve.reason !== "none" ? [`stage ${s.stage}: ${s.sieve.reason}`] : []);
        markdown += `- ${r.id}: ${r.status}; ${failed.length ? failed.join("; ") : "no failed reviewed checks"}; ${r.stages.filter(s => s.status === "completed").length}/5 stages completed. Jev fallbacks: ${fallback.join("; ") || "none"}.\n`;
    }
    markdown += "\n## Limitations\n\nFictional tasks, two main models, one machine, and a small sample. Server caching and service load are not controlled. Full Context is an explicit all-documents baseline, not native Pi behavior. The added-test check verifies extra passing tests, not test quality; hidden behavioral checks determine functional correctness. No synthetic response is included in live measurements.\n\n[Run-level CSV](runs.csv) · [Structured results](runs.jsonl) · [Summary](summary.json)\n";
    if (plots) {
        const python = process.env.BENCH_PYTHON ?? join(process.cwd(), ".venv/bin/python3");
        const result = spawnSync(python, ["scripts/plot.py", directory], { stdio: "pipe", env: { ...process.env, MPLCONFIGDIR: join(process.cwd(), ".local/matplotlib") } });
        if (result.status !== 0) throw new Error("Plot generation failed. Install the pinned Python requirements.");
        markdown += "\n![Measured latency, correctness, and token usage](benchmark.png)\n";
    }
    await writeFile(join(directory, "README.md"), markdown);
}

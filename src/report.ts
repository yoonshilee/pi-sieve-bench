import { readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { ARMS, emptyUsage, addUsage, median, pairedSpeedup, score, type Run } from "./metrics.ts";
export async function loadRuns(directory: string): Promise<Run[]> {
    const files = (await readdir(join(directory, "runs"))).filter(x => x.endsWith(".json")).sort();
    return await Promise.all(files.map(async (file) => JSON.parse(await readFile(join(directory, "runs", file), "utf8")) as Run));
}
export function summarize(rows: Run[]) {
    const groups = [...new Set(rows.map(r => r.workflow))].flatMap(workflow => ARMS.flatMap(arm => {
        const runs = rows.filter(r => r.workflow === workflow && r.arm === arm);
        if (!runs.length)
            return [];
        const tokens = runs.map(r => { const u = emptyUsage(); for (const s of r.stages)
            addUsage(u, s.usage); return u; });
        const times = runs.map(r => r.elapsedMs / 1000);
        return [{ workflow, arm, model: runs[0].versions.model, n: runs.length, successes: runs.filter(r => r.success).length, meanScore: runs.reduce((n, r) => n + score(r), 0) / runs.length, medianSeconds: median(times), minSeconds: Math.min(...times), maxSeconds: Math.max(...times), medianTokens: median(tokens.flatMap(u => u.totalTokens === null ? [] : [u.totalTokens])), medianInput: median(tokens.flatMap(u => u.input === null ? [] : [u.input])), medianOutput: median(tokens.flatMap(u => u.output === null ? [] : [u.output])), medianCached: median(tokens.flatMap(u => u.cacheRead === null ? [] : [u.cacheRead])), jevRequests: runs.reduce((n, r) => n + r.stages.reduce((n, s) => n + s.jev.requests, 0), 0), fallbacks: runs.flatMap(r => r.stages).filter(s => s.sieve && s.sieve.reason !== "none").length }];
    }));
    const complete = rows.filter(r => r.status !== "running");
    const usage = emptyUsage();
    for (const r of complete)
        for (const s of r.stages)
            addUsage(usage, s.usage);
    return { kind: rows[0]?.kind ?? "offline", runs: rows.length, groups, pairedSpeedups: { native: pairedSpeedup(rows, "native"), full: pairedSpeedup(rows, "full"), luna: pairedSpeedup(rows, "luna-native", "luna-sieve"), lunaVsAstra: pairedSpeedup(rows, "native", "luna-sieve") }, totals: { seconds: complete.reduce((n, r) => n + r.elapsedMs / 1000, 0), usage, jevRequests: complete.reduce((n, r) => n + r.stages.reduce((n, s) => n + s.jev.requests, 0), 0) }, projection: rows[0]?.kind === "pilot" && complete.length === 5 ? { formalRuns: 60, multiplier: 12, seconds: complete.reduce((n, r) => n + r.elapsedMs / 1000, 0) * 12, totalTokens: usage.totalTokens === null ? null : usage.totalTokens * 12, note: "Linear estimate from one payment workflow per arm (two main models); other workflows and service conditions may differ." } : null };
}
const format = (value: number | null, digits = 0) => value === null ? "N/A" : value.toFixed(digits);
export async function report(directory: string, plots = true): Promise<void> {
    const rows = await loadRuns(directory), summary = summarize(rows);
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, "runs.jsonl"), rows.map(r => JSON.stringify(r)).join("\n") + "\n");
    await writeFile(join(directory, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
    const fields = ["run", "workflow", "arm", "repeat", "status", "success", "score", "seconds", "input", "output", "cacheRead", "totalTokens", "jevRequests"];
    const csv = [fields.join(","), ...rows.map(r => { const u = emptyUsage(); for (const s of r.stages)
            addUsage(u, s.usage); return [r.id, r.workflow, r.arm, r.repeat, r.status, r.success, score(r), r.elapsedMs / 1000, u.input, u.output, u.cacheRead, u.totalTokens, r.stages.reduce((n, s) => n + s.jev.requests, 0)].join(","); })].join("\n") + "\n";
    await writeFile(join(directory, "runs.csv"), csv);
    let markdown = `# ${summary.kind === "pilot" ? "Pilot observations — not a performance conclusion" : "Workflow benchmark results"}\n\nModels: gpt-6-astra and gpt-5.6-luna, medium. Pi: 0.86.1. Jev: 1.13.0. Sieve: 7d54c8f.\n\n`;
    markdown += "| Workflow | Arm | Success | Stage score | Median seconds (range) | Median total tokens | Jev fallbacks / calls |\n| --- | --- | ---: | ---: | ---: | ---: | ---: |\n";
    for (const g of summary.groups)
        markdown += `| ${g.workflow} | ${g.arm} | ${g.successes}/${g.n} | ${format(g.meanScore * 100, 1)}% | ${format(g.medianSeconds, 1)} (${format(g.minSeconds, 1)}–${format(g.maxSeconds, 1)}) | ${format(g.medianTokens)} | ${g.fallbacks}/${g.jevRequests} |\n`;
    markdown += "\nDurations include selection, the main model, and tool execution; setup and external grading are excluded and recorded separately. A fast failed run is not a speedup. Scores weight the five stages equally; unrun stages score zero.\n\n";
    for (const [arm, pair] of Object.entries(summary.pairedSpeedups))
        markdown += `- Comparison ${arm}: ${pair.n} successful matched pairs; median baseline/Sieve duration ratio ${format(pair.ratio, 2)}.\n`;
    if (summary.projection)
        markdown += `\n## Formal-batch estimate\n\nThe payment pilot projects approximately ${format(summary.projection.seconds / 3600, 2)} hours and ${format(summary.projection.totalTokens)} main-model tokens for 60 workflows (12 times the pilot totals). This is a planning estimate, not a bound or a bill. Different task difficulty and cache behavior can change it substantially. Formal execution requires user confirmation.\n`;
    markdown += "\n## Outcomes and failures\n\n";
    for (const r of rows) {
        const failed = r.stages.flatMap(s => s.checks.filter(c => !c.passed).map(c => `stage ${s.stage}: ${c.id}`));
        markdown += `- ${r.id}: ${r.status}; ${failed.length ? failed.join("; ") : "no failed recorded checks"}.\n`;
    }
    markdown += "\n## Limitations\n\nThese are fictional tasks, one model, and a small sample. Server caching and service load are not controlled. Full Context is an explicit all-documents baseline, not native Pi behavior. Token usage is reported usage, not actual subscription charges. Jev usage may be missing on failed requests. No synthetic response is included in live measurements.\n\n[Run-level CSV](runs.csv) · [Structured results](runs.jsonl) · [Summary](summary.json)\n";
    if (plots) {
        const python = process.env.BENCH_PYTHON ?? join(process.cwd(), ".venv/bin/python3");
        const result = spawnSync(python, ["scripts/plot.py", directory], { stdio: "pipe", env: { ...process.env, MPLCONFIGDIR: join(process.cwd(), ".local/matplotlib") } });
        if (result.status !== 0)
            throw new Error("Plot generation failed. Install the pinned Python requirements.");
        markdown += "\n![Measured latency, correctness, and token usage](benchmark.png)\n";
    }
    await writeFile(join(directory, "README.md"), markdown);
}

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { schedule, armConfig, VERSIONS, LIMITS } from "./metrics.ts";
import { atomicJson, preserveExistingRun, runWorkflow } from "./runner.ts";
import { report } from "./report.ts";
import { compareRetrieval } from "./retrieval.ts";
import { SIEVE_CONFIG } from "./fixtures.ts";
import { runScoringBatch } from "./scoring-batch.ts";
import { runDecisionProbe } from "./decision-probe.ts";
export async function sourceHash(): Promise<string> { const hash = createHash("sha256"); for (const path of ["package-lock.json", ...(await readdir("src")).filter(x => x.endsWith(".ts")).sort().map(x => `src/${x}`)])
    hash.update(path + "\0").update(await readFile(path)); return hash.digest("hex"); }
async function exists(path: string) { try {
    await stat(path);
    return true;
}
catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
        return false;
    throw error;
} }
async function main(): Promise<void> {
    const [command, ...args] = process.argv.slice(2);
    if (command === "probe") {
        const batch = args[0];
        if (!batch || !/^[a-z0-9][a-z0-9-]*$/.test(batch)) throw new Error("Provide a batch identifier.");
        await runDecisionProbe(batch, await sourceHash(), execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim());
        return;
    }
    if (command === "score") {
        if (process.platform !== "darwin") throw new Error("Live runs currently require macOS sandbox-exec.");
        const batch = args[0];
        if (!batch || !/^[a-z0-9][a-z0-9-]*$/.test(batch)) throw new Error("Provide a batch identifier.");
        await runScoringBatch(batch, await sourceHash(), execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim());
        return;
    }
    if (command === "report") {
        const batch = args[0];
        if (!batch || !/^[a-z0-9][a-z0-9-]*$/.test(batch))
            throw new Error("Provide a batch identifier.");
        await report(join("reports", batch));
        console.log(`Report generated: reports/${batch}/README.md`);
        return;
    }
    if (command === "compare") {
        if (process.platform !== "darwin") throw new Error("Live runs currently require macOS sandbox-exec.");
        const batch = args[0];
        if (!batch || !/^[a-z0-9][a-z0-9-]*$/.test(batch)) throw new Error("Provide a batch identifier.");
        await compareRetrieval(batch, await sourceHash(), execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim());
        return;
    }
    if (command !== "pilot" && command !== "run")
        throw new Error("Use probe, score, compare, pilot, run, or report.");
    const kind = command === "pilot" ? "pilot" : "formal";
    if (kind === "formal" && !args.includes("--confirmed"))
        throw new Error("Formal execution requires user confirmation after the pilot. Pass --confirmed only after receiving it.");
    if (process.platform !== "darwin")
        throw new Error("Live runs currently require macOS sandbox-exec.");
    const index = args.indexOf("--batch");
    const batch = index < 0 ? `${kind}-${new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14)}` : args[index + 1];
    if (!batch || !/^[a-z0-9][a-z0-9-]*$/.test(batch))
        throw new Error("Invalid batch identifier.");
    const output = join("reports", batch), fingerprint = await sourceHash();
    const commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    const manifestPath = join(output, "manifest.json");
    if (await exists(manifestPath)) {
        const prior = JSON.parse(await readFile(manifestPath, "utf8"));
        if (prior.sourceHash !== fingerprint || prior.kind !== kind)
            throw new Error("Cannot resume a batch with changed experiment code.");
    }
    else
        await atomicJson(manifestPath, { batch, kind, createdAt: new Date().toISOString(), sourceHash: fingerprint, harnessCommit: commit, versions: VERSIONS, sieveConfig: SIEVE_CONFIG, limits: LIMITS, schedule: schedule(kind).map(item => ({...item, ...armConfig(item.arm)})), node: process.version, platform: process.platform, arch: process.arch, cachePolicy: "No explicit cache warming in the runner. Provider caches cannot be cleared. Prior experiments and diagnostic probes may affect caching; record reported usage and batch-specific notes.", compaction: false, retries: false, formalAuthorized: kind === "formal" });
    await mkdir(join(output, "runs"), { recursive: true });
    let errors = 0;
    for (const item of schedule(kind)) {
        const id = `${item.workflow}-${item.repeat}-${item.arm}`, record = join(output, "runs", id + ".json");
        if (await preserveExistingRun(record)) {
            console.log(`Preserved existing run: ${id}`);
            continue;
        }
        if (errors >= 3) {
            console.log("Paused after three consecutive provider failures. Resume later with the same batch ID.");
            break;
        }
        const root = resolve(".work", batch, id);
        if (await exists(root))
            throw new Error("Unrecorded workspace exists; refusing to overwrite it.");
        console.log(`Starting ${id}`);
        const run = await runWorkflow({ root, record, batch, kind, ...item, harnessCommit: commit, fixtureHash: fingerprint });
        errors = run.status === "provider_error" ? errors + 1 : 0;
    }
    await report(output);
    console.log(`Saved ${kind} report: ${output}/README.md`);
}
if (process.argv[1]?.endsWith("/cli.ts"))
    main().catch(error => { console.error(error instanceof Error && /^(Use |Provide |Formal |Live |Invalid batch|Cannot resume|Unrecorded|Plot generation|The pinned|Benchmark extension)/.test(error.message) ? error.message : "Benchmark could not complete; recorded results were preserved. No provider error body was logged."); process.exitCode = 1; });

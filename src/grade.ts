import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import { execute } from "./sandbox.ts";
import type { WorkflowId } from "./fixtures.ts";
export type Check = {
    id: string;
    passed: boolean;
};
export async function grade(root: string, workflow: WorkflowId, stage: number, offlineTest = false): Promise<Check[]> {
    const input = stripTypeScriptTypes(await readFile(new URL("./grade-worker.ts", import.meta.url), "utf8"));
    const result = await execute(root, [process.execPath, "--input-type=module", "-", workflow, String(stage)], { input, timeoutMs: 30000, offlineTest });
    const line = result.output.split("\n").findLast(x => x.startsWith("BENCH_GRADE="));
    if (result.code !== 0 || !line)
        return [{ id: "grader-process", passed: false }];
    try {
        const value: unknown = JSON.parse(line.slice("BENCH_GRADE=".length));
        if (!Array.isArray(value) || !value.length || value.some(x => typeof x.id !== "string" || typeof x.passed !== "boolean"))
            throw new Error();
        return value;
    }
    catch {
        return [{ id: "grader-output", passed: false }];
    }
}

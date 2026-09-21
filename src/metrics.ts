import type { WorkflowId } from "./fixtures.ts";
import type { Check } from "./grade.ts";
export const ARMS = ["native", "full", "sieve", "luna-native", "luna-sieve"] as const;
export type Arm = typeof ARMS[number];
export const VERSIONS = { pi: "0.86.1", provider: "openai-codex", model: "gpt-6-astra", thinking: "medium", jev: "jev-1.13.0", sieve: "7d54c8f2865d81113688e40b79abcef2956f6a32" } as const;
export function armConfig(arm: Arm): {
    model: string;
    mode: "native" | "full" | "sieve";
} { return { model: arm.startsWith("luna-") ? "gpt-5.6-luna" : VERSIONS.model, mode: arm.endsWith("sieve") ? "sieve" : arm === "full" ? "full" : "native" }; }
export const LIMITS = { stageMs: 300000, modelRequests: 30 } as const;
export type Usage = {
    input: number | null;
    output: number | null;
    cacheRead: number | null;
    cacheWrite: number | null;
    reasoning: number | null;
    totalTokens: number | null;
};
export const emptyUsage = (): Usage => ({ input: null, output: null, cacheRead: null, cacheWrite: null, reasoning: null, totalTokens: null });
export function addUsage(sum: Usage, next: Partial<Usage>): void { for (const key of Object.keys(sum) as (keyof Usage)[])
    if (typeof next[key] === "number" && Number.isFinite(next[key]) && next[key]! >= 0)
        sum[key] = (sum[key] ?? 0) + next[key]!; }
export type Stage = {
    stage: number;
    status: string;
    elapsedMs: number;
    gradeMs: number;
    checks: Check[];
    requests: number;
    requestBytes: number[];
    contextChars: number[];
    visibleSkills: number[];
    visibleTools: number[];
    toolCalls: number;
    toolErrors: number;
    recoveries: number;
    usage: Usage;
    jev: {
        requests: number;
        inputTokens: number | null;
        outputTokens: number | null;
    };
    sieve: Record<string, string | number | boolean> | null;
    answer: string;
};
export type Run = {
    id: string;
    batch: string;
    kind: "pilot" | "formal" | "offline";
    workflow: WorkflowId;
    arm: Arm;
    repeat: number;
    startedAt: string;
    status: string;
    success: boolean;
    initialHash: string;
    fixtureHash: string;
    harnessCommit: string;
    versions: Omit<typeof VERSIONS, "model"> & {
        model: string;
    };
    node: string;
    initMs: number;
    elapsedMs: number;
    gradeMs: number;
    stages: Stage[];
};
export function newStage(stage: number): Stage { return { stage, status: "running", elapsedMs: 0, gradeMs: 0, checks: [], requests: 0, requestBytes: [], contextChars: [], visibleSkills: [], visibleTools: [], toolCalls: 0, toolErrors: 0, recoveries: 0, usage: emptyUsage(), jev: { requests: 0, inputTokens: null, outputTokens: null }, sieve: null, answer: "" }; }
export function schedule(kind: "pilot" | "formal"): {
    workflow: WorkflowId;
    arm: Arm;
    repeat: number;
}[] {
    const workflows: WorkflowId[] = kind === "pilot" ? ["payments"] : ["payments", "tenant-api", "reconciliation", "incident"];
    const result = [];
    for (let repeat = 1; repeat <= (kind === "pilot" ? 1 : 3); repeat++)
        for (const workflow of workflows)
            for (let offset = 0; offset < ARMS.length; offset++)
                result.push({ workflow, arm: ARMS[(offset + (repeat - 1) * workflows.length + workflows.indexOf(workflow)) % ARMS.length], repeat });
    return result;
}
export function score(run: Run): number { return run.stages.reduce((total, s) => total + (s.checks.length ? s.checks.filter(c => c.passed).length / s.checks.length : 0), 0) / 5; }
export function median(values: number[]): number | null { if (!values.length)
    return null; const ordered = [...values].sort((a, b) => a - b), mid = Math.floor(ordered.length / 2); return ordered.length % 2 ? ordered[mid] : (ordered[mid - 1] + ordered[mid]) / 2; }
export function pairedSpeedup(rows: Run[], baseline: Arm, treatment: Arm = "sieve"): {
    n: number;
    ratio: number | null;
} {
    const ratios = rows.filter(r => r.arm === treatment && r.success).flatMap(r => { const b = rows.find(b => b.workflow === r.workflow && b.repeat === r.repeat && b.arm === baseline && b.success); return b && r.elapsedMs > 0 ? [b.elapsedMs / r.elapsedMs] : []; });
    return { n: ratios.length, ratio: median(ratios) };
}
export function sanitize(text: string, root: string): string {
    return text.replaceAll(root, "<workspace>").replace(/\/(?:Users|home)\/[^\s"'<>`\])]+/g, "<private-path>").replace(/[A-Z]:[\\/]Users[\\/][^\s"'<>]+/g, "<private-path>");
}

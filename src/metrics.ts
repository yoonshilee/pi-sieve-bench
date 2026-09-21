import type { WorkflowId } from "./fixtures.ts";
import type { Check } from "./grade.ts";
export const ARMS = ["native", "full", "sieve", "luna-native", "luna-sieve"] as const;
export const RETRIEVAL_ARMS = ["retrieval-local", "retrieval-jev"] as const;
export const RETRIEVAL_COMMIT = "ba996c7bfceddbee6fa75e03a8f4a323052e8d3c";
export const RETRIEVAL_MODEL = "gpt-5.6-sol";
export const SCORING_ARMS = ["score-self", "score-jev"] as const;
export const SCORING_COMMIT = "1620906181b8a96501a277becc8e56ff837e56f8";
export type Arm = typeof ARMS[number] | typeof RETRIEVAL_ARMS[number] | typeof SCORING_ARMS[number];
export const RETRIEVAL_QUERIES = [
    "duplicate payment charges after timeout and retry active idempotency contract",
    "sequential payment retries request validation gateway failure retry eligibility",
    "concurrent payment requests in-flight sharing conflicts independent keys failed reservations",
    "callback event validation duplicate delivery distinct events receipt uniqueness",
    "payment regression idempotency validation failures concurrency callback events receipts",
] as const;
export const REQUIRED_REFERENCES = [
    ["payment-idempotency"],
    ["payment-idempotency", "payment-validation", "gateway-failures"],
    ["payment-idempotency", "payment-concurrency", "gateway-failures"],
    ["webhook-events", "webhook-receipts"],
    ["payment-idempotency", "payment-validation", "gateway-failures", "payment-concurrency", "webhook-events", "webhook-receipts"],
] as const;
export const VERSIONS = { pi: "0.86.1", provider: "openai-codex", model: "gpt-6-astra", thinking: "medium", jev: "jev-1.13.0", sieve: "7d54c8f2865d81113688e40b79abcef2956f6a32" } as const;
export function armConfig(arm: Arm): {
    model: string;
    mode: "native" | "full" | "sieve";
} { return { model: arm.startsWith("retrieval-") || arm.startsWith("score-") ? RETRIEVAL_MODEL : arm.startsWith("luna-") ? "gpt-5.6-luna" : VERSIONS.model, mode: (arm.endsWith("sieve") || arm.startsWith("retrieval-") || arm.startsWith("score-")) ? "sieve" : arm === "full" ? "full" : "native" }; }
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
        responses?: { httpStatus: number | null; headersMs: number; errorKind: "aborted" | "network_error" | null }[];
    };
    retrievals?: { queryMatched: boolean; reason: string; elapsedMs: number | null; selected: number | null; resultChars: number; names: string[] }[];
    scoring?: { inputHash: string; reason: string; options: number; levels: number; elapsedMs: number | null; results: { id: string; score: number; confidence: number }[] }[];
    decision?: { inputHash: string | null; scoringAvailable: boolean; valid: boolean; executedSelection: boolean; options: number; levels: number; selectedId: string | null; selectedScore: number | null };
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
    versions: Omit<typeof VERSIONS, "model" | "sieve"> & {
        model: string;
        sieve: string;
    };
    node: string;
    initMs: number;
    elapsedMs: number;
    gradeMs: number;
    stages: Stage[];
    checkReviews?: {
        stage: number;
        id: string;
        originalPassed: boolean;
        passed: boolean;
        reason: string;
        artifactSha256: string;
    }[];
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
export function stageChecks(run: Run, stage: Stage, reviewed = true): Check[] {
    return stage.checks.map(check => {
        const review = reviewed ? run.checkReviews?.find(r => r.stage === stage.stage && r.id === check.id && r.originalPassed === check.passed) : undefined;
        return review ? { ...check, passed: review.passed } : check;
    });
}
export function stageScore(run: Run, stage: Stage, reviewed = true): number {
    const checks = stageChecks(run, stage, reviewed);
    return checks.length ? checks.filter(c => c.passed).length / checks.length : 0;
}
export function score(run: Run, reviewed = true): number { return run.stages.reduce((total, s) => total + stageScore(run, s, reviewed), 0) / 5; }
export function isSuccessful(run: Run): boolean {
    if (!run.checkReviews?.length) return run.success;
    const final = run.stages.find(s => s.stage === 5);
    return run.status === "completed" && run.stages.length === 5 && run.stages.every(s => s.status === "completed") && !!final?.checks.length && stageChecks(run, final).every(c => c.passed);
}
export function hasValidSelection(run: Run): boolean {
    return armConfig(run.arm).mode !== "sieve" || (run.stages.length === 5 && run.stages.every(s => s.sieve?.reason === "none"));
}
export function median(values: number[]): number | null { if (!values.length)
    return null; const ordered = [...values].sort((a, b) => a - b), mid = Math.floor(ordered.length / 2); return ordered.length % 2 ? ordered[mid] : (ordered[mid - 1] + ordered[mid]) / 2; }
export function pairedSpeedup(rows: Run[], baseline: Arm, treatment: Arm = "sieve"): {
    n: number;
    ratio: number | null;
} {
    const ratios = rows.filter(r => r.arm === treatment && isSuccessful(r) && hasValidSelection(r)).flatMap(r => { const b = rows.find(b => b.workflow === r.workflow && b.repeat === r.repeat && b.arm === baseline && isSuccessful(b) && hasValidSelection(b)); return b && r.elapsedMs > 0 ? [b.elapsedMs / r.elapsedMs] : []; });
    return { n: ratios.length, ratio: median(ratios) };
}
export function sanitize(text: string, root: string): string {
    return text.replaceAll(root, "<workspace>").replace(/\/(?:Users|home)\/[^\s"'<>`\])]+/g, "<private-path>").replace(/[A-Z]:[\\/]Users[\\/][^\s"'<>]+/g, "<private-path>");
}

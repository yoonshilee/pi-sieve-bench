import { createHash } from "node:crypto";
import type { Stage } from "./metrics.ts";
const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);

export function decisionHash(value: Record<string, unknown>): string {
    const options = Array.isArray(value.options) ? value.options.filter(isRecord).map(option => ({ id: option.id, content: option.content })) : [];
    return createHash("sha256").update(JSON.stringify({ question: value.question, criteria: value.criteria, options })).digest("hex");
}

export const commandHash = (command: string): string => createHash("sha256").update(command).digest("hex");

export function decisionPrompt(delegated: boolean, task: string): string {
    const method = delegated
        ? "Propose 3-5 distinct eligible shell commands, with each option content containing only its exact command. Define one neutral evaluation question and 3-5 shared ordered scoring levels. Supply concise facts, without choosing a winner or scoring the options yourself. Call sieve_score exactly once. Execute its selected.content unchanged as your next bash command, without reranking or substituting. If unavailable, report that no Jev decision was made; do not invent one."
        : "Choose a useful next shell command using your own judgment and execute it. Do not call sieve_score; it is disabled in this condition. No explicit candidate list, rubric, or ranking is required.";
    return `Complete the task below. After reading enough current project information, and before your first production-code change in this stage, choose and execute one useful next shell command. ${method}
Only local, authorized, non-destructive commands are eligible: no network, installation, deployment, or cleanup. Do not execute every candidate to compare them. After this decision, finish the stage normally. Do not write benchmark decision files or extra scoring explanations.

Task:
${task}`;
}

export function failureKind(value: unknown): NonNullable<Stage["failure"]>["kind"] {
    const message = value instanceof Error ? value.message : typeof value === "string" ? value : "";
    if (/rate.?limit|quota|429|usage.?limit/i.test(message)) return "rate_limit";
    if (/unauthori[sz]ed|authentication|401|403|invalid.*(?:key|token)/i.test(message)) return "authentication";
    if (/context.*(?:limit|length|window)|too many tokens/i.test(message)) return "context_limit";
    if (/ECONN|ENOTFOUND|ETIMEDOUT|fetch failed|network|socket/i.test(message)) return "network";
    return "unknown";
}

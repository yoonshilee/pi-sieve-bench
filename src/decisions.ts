import { createHash } from "node:crypto";
import type { Stage } from "./metrics.ts";
const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);

export function decisionHash(value: Record<string, unknown>): string {
    const options = Array.isArray(value.options) ? value.options.filter(isRecord).map(option => ({ id: option.id, content: option.content })) : [];
    return createHash("sha256").update(JSON.stringify({ ...(typeof value.profile === "string" ? { profile: value.profile } : {}), question: value.question, criteria: value.criteria, options })).digest("hex");
}

export const commandHash = (command: string): string => createHash("sha256").update(command).digest("hex");

export function decisionPrompt(delegated: boolean, task: string): string {
    const method = delegated
        ? "Use sieve_score only when multiple plausible actions require substantial evidence comparison or a wrong choice would cause significant rework. Skip obvious next steps, explicit commands, and routine tests. There is no scoring quota. A known reusable payment-diagnostic profile is listed in REFERENCES.md; inspect it if applicable and send concise current facts instead of rewriting its candidates and rubric. If no profile applies and a substantial decision warrants delegation, use inline options. Follow selected.content exactly without reranking. If unavailable, report no decision."
        : "Use your own judgment for next actions. Do not call sieve_score; it is disabled in this condition.";
    return `Complete the task below. ${method}
Only local, authorized, non-destructive commands are eligible: no network, installation, deployment, or cleanup. Do not invent alternatives merely for scoring or write benchmark decision files.

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

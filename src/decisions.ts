import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Stage } from "./metrics.ts";
const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);

export function decisionHash(value: Record<string, unknown>): string {
    const options = Array.isArray(value.options) ? value.options.filter(isRecord).map(option => ({ id: option.id, content: option.content })) : [];
    return createHash("sha256").update(JSON.stringify({ question: value.question, criteria: value.criteria, options })).digest("hex");
}

export function decisionPrompt(stage: number, delegated: boolean, task: string): string {
    const method = delegated
        ? "Call sieve_score exactly once for this decision, supplying your concise factual context, question, criteria, and options. Do not score the options yourself before calling it. Use its returned scores to inform your choice; the final decision remains yours. If unavailable, reason directly and record that fact."
        : "Evaluate the options yourself against your rubric and assign each a score. Do not call sieve_score; it is disabled in this condition.";
    return `Complete the task below. After reading enough current project information, and before your first production-code change in this stage, choose one useful next shell command using this procedure:
1. Propose 3-5 distinct, currently applicable command options. Each option has a short stable id and content containing ONLY the exact shell command, at most 300 characters. Do not execute every candidate to compare them. This is a local project: no network, installation, deployment, or destructive cleanup.
2. Define one evaluation question about the value of executing the command now, and a shared ordered rubric of 3-5 concrete levels. Prepare necessary factual context without completing the evaluation yet.
3. ${method}
4. Write decision-${stage}.json with {question, criteria, options: [{id,content}], scores: [{id,score}], selectedId, command, scoringAvailable}. Scores use zero to criteria.length - 1. command must exactly equal the selected option's content. scoringAvailable is true only for an available Jev response; otherwise false.
5. Execute that exact command through bash, then finish the stage normally. You may do other necessary work afterward. Make only this one recorded comparison per stage. Do not generate extra rankings or long explanations merely for the benchmark.

Task:
${task}`;
}

export async function inspectDecision(root: string, stage: number, commands: ReadonlySet<string>): Promise<NonNullable<Stage["decision"]>> {
    const invalid = { valid: false, executedSelection: false, options: 0, levels: 0, selectedId: null, selectedScore: null, inputHash: null, scoringAvailable: false };
    try {
        const raw = await readFile(join(root, `decision-${stage}.json`), "utf8");
        if (raw.length > 32_000) return invalid;
        const value: unknown = JSON.parse(raw);
        if (!isRecord(value) || typeof value.question !== "string" || !value.question.trim() || !Array.isArray(value.criteria) ||
            value.criteria.length < 3 || value.criteria.length > 5 || value.criteria.some(level => typeof level !== "string" || !level.trim()) ||
            !Array.isArray(value.options) || value.options.length < 3 || value.options.length > 5 || !Array.isArray(value.scores) ||
            typeof value.selectedId !== "string" || typeof value.command !== "string" || typeof value.scoringAvailable !== "boolean") return invalid;
        const options = value.options.filter(isRecord);
        if (options.length !== value.options.length || options.some(option => typeof option.id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(option.id) ||
            typeof option.content !== "string" || !option.content.trim() || option.content.length > 300) || new Set(options.map(option => option.id)).size !== options.length) return invalid;
        const levels = value.criteria.length;
        const scores = value.scores.filter(isRecord);
        if (scores.length !== options.length || new Set(scores.map(score => score.id)).size !== scores.length || scores.some(score =>
            !options.some(option => option.id === score.id) || typeof score.score !== "number" || !Number.isFinite(score.score) || score.score < 0 || score.score > levels - 1)) return invalid;
        const selected = options.find(option => option.id === value.selectedId);
        const chosenScore = scores.find(score => score.id === value.selectedId);
        if (!selected || selected.content !== value.command || typeof chosenScore?.score !== "number") return invalid;
        return { valid: true, executedSelection: commands.has(value.command), options: options.length, levels: value.criteria.length,
            selectedId: value.selectedId, selectedScore: chosenScore.score, inputHash: decisionHash(value), scoringAvailable: value.scoringAvailable };
    } catch { return invalid; }
}

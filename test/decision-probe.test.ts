import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { fauxAssistantMessage, fauxProvider, fauxToolCall, getCurrentTools } from "@earendil-works/pi-ai";
import { DECISION_PROFILE, decisionCases, decisionProfile } from "../src/decision-cases.ts";
import { probeDecision, probeSchedule, summarizeProbe, type ProbeResult } from "../src/decision-probe.ts";
import { RETRIEVAL_MODEL, VERSIONS } from "../src/metrics.ts";
import { decisionPrompt } from "../src/decisions.ts";
import { scoringSummary } from "../src/scoring-batch.ts";

test("the real SDK probe measures decision handoff, hides labels, and excludes acknowledgements", { skip: !existsSync(new URL("../../pi-sieve/src/scoring.ts", import.meta.url)) }, async t => {
    const root = await mkdtemp(join(tmpdir(), "sieve-probe-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    const rows: ProbeResult[] = [], tools: string[] = [];
    const item = decisionCases[2], selected = decisionProfile.options.find(option => option.id === item.expected)!;
    let jevRequests = 0, unexpectedResponses = 0;
    t.mock.method(globalThis, "fetch", async (_url: unknown, init?: RequestInit) => {
        jevRequests++;
        const body = JSON.parse(String(init?.body));
        assert.deepEqual(body.state, { context: item.context });
        assert(!String(init?.body).includes(root));
        assert(!String(init?.body).includes('"expected"'));
        return Response.json({ model: VERSIONS.jev, usage: { input_tokens: 80, output_tokens: 10 }, answers: Object.fromEntries(Object.entries(body.questions).map(([id, value]) => {
            const score = (value as { instructions: { option: { id: string } } }).instructions.option.id === item.expected ? 2 : 0;
            return [id, { type: "score", score, confidence: 1, probabilities: { "0": score ? 0 : 1, "1": 0, "2": score ? 1 : 0 } }];
        })) });
    });
    for (const arm of ["direct", "delegated"] as const) {
        const auth = join(root, `${arm}-auth`); await mkdir(auth);
        const runtime = await ModelRuntime.create({ authPath: join(auth, "auth.json"), modelsPath: null, modelsStorePath: join(auth, "models.json"), refreshOnCreate: false });
        await runtime.setRuntimeApiKey("typesafe", "fixture-only");
        const faux = fauxProvider({ provider: VERSIONS.provider, models: [{ id: RETRIEVAL_MODEL, reasoning: true }], tokensPerSecond: Infinity });
        runtime.registerNativeProvider(faux.provider);
        faux.setResponses([
            ...(arm === "delegated" ? [() => fauxAssistantMessage(fauxToolCall("sieve_score", { profile: DECISION_PROFILE, context: item.context }), { stopReason: "toolUse" })] : []),
            context => {
                tools.push(JSON.stringify(getCurrentTools(context.messages)));
                assert(!JSON.stringify(context.messages).includes('"expected"'));
                return fauxAssistantMessage(fauxToolCall("bench_execute", selected), { stopReason: "toolUse" });
            },
            () => { unexpectedResponses++; throw new Error("The unmeasured acknowledgement must not call the model."); },
        ]);
        const result = await probeDecision(join(root, arm), item, arm, 1, runtime);
        assert.equal(result.status, "completed"); assert(result.correct && result.optionMatched);
        // Faux does not emit the provider payload hook; the unused response below detects an extra round.
        assert.equal(result.toolCalls, arm === "direct" ? 1 : 2);
        rows.push(result);
    }
    assert.equal(unexpectedResponses, 0);
    assert.equal(jevRequests, 1); assert.equal(tools[0], tools[1]);
    assert(rows[1].followedSelection && rows[1].contextMatched);
    assert.equal(rows[1].jev.inputTokens, 80);
    assert(summarizeProbe(rows).pairs[0].valid);
    assert(!summarizeProbe(rows).gate.fullWorkflowRecommended);
    for (const field of ["correct", "optionMatched", "contextMatched", "followedSelection"] as const) {
        const invalid = structuredClone(rows); invalid[1][field] = false;
        assert(!summarizeProbe(invalid).pairs[0].valid);
    }
    const complete = probeSchedule().map(step => ({ ...structuredClone(rows[step.arm === "direct" ? 0 : 1]), ...step,
        id: `${step.caseId}-${step.repeat}-${step.arm}`, category: decisionCases.find(c => c.id === step.caseId)!.category,
        selectionMs: step.arm === "direct" ? 100 : 80 }));
    assert(summarizeProbe(complete).gate.fullWorkflowRecommended);
    complete.find(row => row.category === "evidence" && row.arm === "delegated")!.correct = false;
    assert(!summarizeProbe(complete).gate.fullWorkflowRecommended);
    assert(!JSON.stringify(rows).includes(item.context));
});

test("adaptive workflow prompts have no quota and zero delegation is not a protocol failure", () => {
    const prompt = decisionPrompt(true, "Run the tests.");
    assert(prompt.includes("There is no scoring quota"));
    assert(!prompt.includes("exactly once"));
    assert(!prompt.includes("Propose 3-5"));
    assert.equal(probeSchedule().length, 36);
    assert.equal(scoringSummary([]).experiment, "adaptive-command-choice-v0.5");
});

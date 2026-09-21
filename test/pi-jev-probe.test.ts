import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { fauxAssistantMessage, fauxProvider, fauxToolCall, getCurrentTools } from "@earendil-works/pi-ai";
import { decisionCases, decisionProfile } from "../src/decision-cases.ts";
import { probeDecision } from "../src/decision-probe.ts";
import { PI_JEV_MODES, PI_JEV_TOOL, installPiJevProbe, piJevRequest, validPiJevResponse, type PiJevMode } from "../src/pi-jev-probe.ts";
import { piJevSchedule, summarizePiJev } from "../src/pi-jev-batch.ts";
import { RETRIEVAL_MODEL, VERSIONS } from "../src/metrics.ts";

function response(mode: PiJevMode, chosen: string) {
    return { model: VERSIONS.jev, usage: { input_tokens: 80, output_tokens: 10 }, answers: mode === "choice"
        ? { next_action: { type: "choice", choice: chosen, confidence: 1, probabilities: Object.fromEntries(decisionProfile.options.map(o => [o.id, o.id === chosen ? 1 : 0])) } }
        : Object.fromEntries(decisionProfile.options.map((o, i) => [`q${i}`, { type: "score", score: o.id === chosen ? 2 : 0, confidence: 1, probabilities: { "0": o.id === chosen ? 0 : 1, "1": 0, "2": o.id === chosen ? 1 : 0 } }])) };
}

test("the pinned native extension runs both decision modes through the real Pi SDK", async t => {
    const root = await mkdtemp(join(tmpdir(), "pi-jev-probe-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    const item = decisionCases[2], selected = decisionProfile.options.find(o => o.id === item.expected)!;
    const beforeEnv = { ...process.env };
    let requests = 0, acknowledgements = 0;
    let mode: PiJevMode = "score";
    const mockFetch = t.mock.method(globalThis, "fetch", async (_url: unknown, init?: RequestInit) => {
        requests++;
        assert.deepEqual(JSON.parse(String(init?.body)), piJevRequest(item.context, mode));
        assert(!String(init?.body).includes('"expected"'));
        assert(!String(init?.body).includes(root));
        return Response.json(response(mode, item.expected));
    });
    const fetchBefore = globalThis.fetch;
    for (mode of PI_JEV_MODES) {
        const runtime = await ModelRuntime.create({ authPath: join(root, `${mode}-auth.json`), modelsPath: null, modelsStorePath: join(root, `${mode}-models.json`), refreshOnCreate: false });
        runtime.setRuntimeApiKey("typesafe", "fixture-only");
        const faux = fauxProvider({ provider: VERSIONS.provider, models: [{ id: RETRIEVAL_MODEL, reasoning: true }], tokensPerSecond: Infinity });
        runtime.registerNativeProvider(faux.provider);
        faux.setResponses([
            context => {
                assert(!JSON.stringify(context.messages).includes('"expected"'));
                const toolNames = getCurrentTools(context.messages).map(tool => tool.name).sort();
                assert.deepEqual(toolNames, ["bench_execute", PI_JEV_TOOL]);
                return fauxAssistantMessage(fauxToolCall(PI_JEV_TOOL, piJevRequest(item.context, mode)), { stopReason: "toolUse" });
            },
            () => fauxAssistantMessage(fauxToolCall("bench_execute", selected), { stopReason: "toolUse" }),
            () => { acknowledgements++; throw new Error("Unexpected acknowledgement."); },
        ]);
        const record = await probeDecision(join(root, mode), item, "delegated", 1, runtime, mode);
        assert.equal(record.status, "completed"); assert(record.correct && record.contextMatched && record.followedSelection);
        assert.equal(record.toolCalls, 2); assert.equal(record.jev.reason, "none");
        assert.equal(record.jev.inputTokens, 80); assert.equal(record.jev.outputTokens, 10);
        assert.equal(record.piJev?.wireRequests, 1); assert.equal(record.piJev?.blockedRetries, 0);
        assert.equal(record.piJev?.modelMatched, true); assert.equal(record.piJev?.responseValid, true);
        assert(!JSON.stringify(record).includes(item.context)); assert(!JSON.stringify(record).includes("fixture-only"));
        assert(Object.keys(process.env).length === Object.keys(beforeEnv).length, "Environment keys were not restored.");
        for (const [name, value] of Object.entries(beforeEnv)) assert(process.env[name] === value, "An environment value was not restored.");
        assert.equal(globalThis.fetch, fetchBefore);
        const summary = summarizePiJev([{ ...record, variant: mode }], []);
        assert.equal(summary.groups.find(g => g.category === "all" && g.variant === `pi-jev-${mode}`)?.correct, 1);
        record.contextMatched = false;
        assert.equal(summarizePiJev([{ ...record, variant: mode }], []).groups.find(g => g.category === "all" && g.variant === `pi-jev-${mode}`)?.correct, 0);
    }
    assert.equal(requests, 2); assert.equal(acknowledgements, 0);
    mockFetch.mock.restore();
    assert.equal(piJevSchedule().length, 36);
    assert.equal(new Set(piJevSchedule().map(r => `${r.caseId}-${r.repeat}-${r.variant}`)).size, 36);
});

test("the observer rejects changed inputs, extra requests, and malformed service answers", async t => {
    const root = await mkdtemp(join(tmpdir(), "pi-jev-boundary-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    const runtime = await ModelRuntime.create({ authPath: join(root, "auth.json"), modelsPath: null, modelsStorePath: join(root, "models.json"), refreshOnCreate: false });
    runtime.setRuntimeApiKey("typesafe", "fixture-only");
    let sent = 0;
    t.mock.method(globalThis, "fetch", async () => { sent++; return Response.json(response("choice", "tests")); });
    const observer = await installPiJevProbe(runtime, "Test context.", "choice");
    try {
        await assert.rejects(fetch("https://api.typesafe.ai/v1/systemone", { body: JSON.stringify(piJevRequest("Changed context.", "choice")) }), /frozen question/);
        assert.equal(sent, 0); assert.equal(observer.diagnostics.requestMatched, false);
        await fetch("https://api.typesafe.ai/v1/systemone", { body: JSON.stringify(piJevRequest("Test context.", "choice")) });
        await assert.rejects(fetch("https://api.typesafe.ai/v1/systemone", { body: JSON.stringify(piJevRequest("Test context.", "choice")) }), /one Jev request/);
        assert.equal(sent, 1); assert.equal(observer.diagnostics.blockedRetries, 1);
    } finally { observer.cleanup(); }
    for (const mode of PI_JEV_MODES) {
        assert(validPiJevResponse(response(mode, "tests"), mode));
        assert(!validPiJevResponse({ ...response(mode, "tests"), model: "wrong-model" }, mode));
        assert(!validPiJevResponse({ model: VERSIONS.jev, answers: {} }, mode));
        const invalid = JSON.parse(JSON.stringify(response(mode, "tests")));
        Object.values(invalid.answers).forEach((a: unknown) => { assert(a && typeof a === "object" && "confidence" in a); a.confidence = NaN; });
        assert(!validPiJevResponse(invalid, mode));
    }
});

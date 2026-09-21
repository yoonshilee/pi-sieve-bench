import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { fauxAssistantMessage, fauxProvider, fauxToolCall, getCurrentTools } from "@earendil-works/pi-ai";
import { runWorkflow } from "../src/runner.ts";
import { armConfig, SCORING_ARMS, SCORING_COMMIT, VERSIONS, type Run } from "../src/metrics.ts";
import { scoringSchedule, scoringSummary } from "../src/scoring-batch.ts";
import { failureKind } from "../src/decisions.ts";
import { installSolution } from "./solutions.ts";

const decision = {
    question: "Which command best verifies the available local runtime?",
    criteria: ["Unrelated", "Indirect evidence", "Direct evidence"],
    options: [{ id: "runtime", content: "node --version" }, { id: "files", content: "rg --files" }, { id: "location", content: "pwd" }],
};

test("scoring pairs preserve inputs and tools, measure real SDK calls, and reject invalid comparisons", { skip: !existsSync(new URL("../../pi-sieve/src/scoring.ts", import.meta.url)) }, async t => {
    const temporary = await mkdtemp(join(tmpdir(), "sieve-score-pair-"));
    t.after(() => rm(temporary, { recursive: true, force: true }));
    const rows: Run[] = [], toolNames: string[][] = [];
    let calls = 0;
    t.mock.method(globalThis, "fetch", async (_url: unknown, options?: RequestInit) => {
        const body = JSON.parse(String(options?.body));
        calls++;
        assert.deepEqual(body.state, { context: "A local Node project is available." });
        assert.equal(Object.keys(body.questions).length, 3);
        return Response.json({ model: VERSIONS.jev, usage: { input_tokens: 100, output_tokens: 10 },
            answers: Object.fromEntries(Object.keys(body.questions).map(id => [id, { type: "score", score: 2, confidence: 1, probabilities: { "0": 0, "1": 0, "2": 1 } }])) });
    });
    for (const [index, arm] of [...SCORING_ARMS, "score-jev" as const].entries()) {
        const root = join(temporary, arm + index), authDir = join(temporary, "auth-" + arm + index);
        await mkdir(authDir);
        const runtime = await ModelRuntime.create({ authPath: join(authDir, "auth.json"), modelsPath: null, modelsStorePath: join(authDir, "models.json"), refreshOnCreate: false });
        const faux = fauxProvider({ provider: VERSIONS.provider, models: [{ id: armConfig(arm).model, reasoning: true }], tokensPerSecond: Infinity });
        runtime.registerNativeProvider(faux.provider);
        faux.setResponses([1, 2, 3, 4, 5].flatMap(stage => [
            ...(arm === "score-jev" ? [() => fauxAssistantMessage(fauxToolCall("sieve_score", { ...decision, context: "A local Node project is available." }), { stopReason: "toolUse" })] : []),
            async context => {
                toolNames.push(getCurrentTools(context.messages).map(tool => tool.name));
                return fauxAssistantMessage(fauxToolCall("bash", { command: index === 2 && stage === 2 ? "pwd" : "node --version" }), { stopReason: "toolUse" });
            },
            async () => {
                if (stage === 1) {
                    await mkdir(join(root, "scripts"));
                    await writeFile(join(root, "scripts/reproduce.ts"), "import {pay} from '../src/payments.ts'; import {createStore} from '../src/store.ts'; import {Gateway} from '../src/gateway.ts'; const store=createStore(), gateway=new Gateway(), request={key:'demo',customerId:'shopper',amountCents:1200}; await pay(store,gateway,request); await pay(store,gateway,request); console.log(JSON.stringify({charges:gateway.calls.length}));\n");
                    await writeFile(join(root, "diagnosis.json"), JSON.stringify({ issue: "duplicate-charge", operation: "pay", observedCharges: 2, evidence: "Two identical keys created two charges." }));
                } else await installSolution(root, "payments");
                return fauxAssistantMessage("Offline fixture finished.");
            },
        ]));
        rows.push(await runWorkflow({ root, record: join(temporary, "runs", arm + ".json"), batch: "offline", kind: "offline", workflow: "payments", arm, repeat: 1,
            harnessCommit: "offline", fixtureHash: "offline", modelRuntime: runtime, offline: true,
            onReady: async () => runtime.setRuntimeApiKey("typesafe", "fixture-only") }));
        assert(!existsSync(join(root, "decision-1.json")));
        assert((await readFile(join(root, ".pi/sieve/memories/webhook-events.md"), "utf8")).includes("nonempty after trimming"));
    }
    assert.equal(new Set(rows.map(row => row.initialHash)).size, 1);
    assert(rows.every(row => row.success && row.versions.sieve === SCORING_COMMIT && row.versions.model === "gpt-5.6-sol" && row.versions.thinking === "medium"));
    assert.equal(calls, 10);
    const wrongCommand = rows.pop()!;
    assert.equal(wrongCommand.stages[1].scoring![0].nextCommandMatched, false);
    assert.equal(wrongCommand.stages[1].scoring![0].executionCompleted, true);
    assert.equal(scoringSummary([rows[0], wrongCommand]).matchedSuccessPairs, 0);
    assert(toolNames.every(names => JSON.stringify(names) === JSON.stringify(toolNames[0])));
    assert(toolNames[0].includes("sieve_score") && !toolNames[0].includes("sieve_search"));
    assert(rows[0].stages.every(stage => stage.jev.requests === 0 && stage.scoring?.length === 0));
    const summary = scoringSummary(rows);
    assert.equal(summary.matchedSuccessPairs, 1);
    assert.equal(summary.runs[1].jevInput, 500);
    assert.equal(summary.runs[0].jevInput, null);
    assert(summary.runs.every(run => run.validComparison));
    for (const failure of ["failed-task", "timeout", "wrong-selection", "no-execution", "wrong-command", "preselected-command"]) {
        const invalid = structuredClone(rows);
        const stage = invalid[1].stages[0];
        if (failure === "failed-task") invalid[1].success = false;
        if (failure === "timeout") stage.scoring![0].reason = "timeout";
        if (failure === "wrong-selection") stage.scoring![0].selectionValid = false;
        if (failure === "no-execution") stage.scoring![0].executionCompleted = false;
        if (failure === "preselected-command") stage.scoring![0].commandGeneratedAfterResponse = false;
        if (failure === "wrong-command") stage.scoring![0].nextCommandMatched = false;
        assert.equal(scoringSummary(invalid).matchedSuccessPairs, 0, failure);
    }
    assert.deepEqual(scoringSchedule().map(item => item.arm), ["score-self", "score-jev", "score-jev", "score-self", "score-self", "score-jev"]);
    assert(!JSON.stringify(summary).includes(temporary));
    assert(!JSON.stringify(summary).includes("local Node project"));
});

test("failure classification keeps only fixed categories", () => {
    for (const [message, category] of [["HTTP 429 private body", "rate_limit"], ["authentication private token", "authentication"], ["context length exceeded", "context_limit"], ["fetch failed private host", "network"], ["private unknown body", "unknown"]])
        assert.equal(failureKind(new Error(message)), category);
});

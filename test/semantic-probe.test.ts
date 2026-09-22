import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { fauxAssistantMessage, fauxProvider, fauxToolCall, getCurrentTools, type Context } from "@earendil-works/pi-ai";
import { expectedLabels, gradeLabels, observationBatch, SEMANTIC_CRITERIA, semanticWorkflows } from "../src/semantic-cases.ts";
import { parseLabels, semanticRun, semanticSchedule, summarizeSemantic, type SemanticRun } from "../src/semantic-probe.ts";
import { RETRIEVAL_MODEL, VERSIONS } from "../src/metrics.ts";

test("semantic fixtures keep gold labels out of observations and scoring rejects incomplete or extra output", () => {
    assert.equal(semanticSchedule().length, 12);
    for (const workflow of semanticWorkflows) for (const stage of workflow.stages) {
        const batch = observationBatch(stage);
        assert(!JSON.stringify(batch).includes('"expected"'));
        assert.equal(batch.observations.length, 8);
        assert(stage.samples.every(sample => Object.hasOwn(SEMANTIC_CRITERIA[workflow.id], sample.expected)));
        const right = expectedLabels(stage);
        assert(gradeLabels(stage, right).exact);
        const wrong = { ...right, "item-1": "invented" };
        assert.equal(gradeLabels(stage, wrong).correct, 7);
        assert(!gradeLabels(stage, wrong).exact);
        assert(!gradeLabels(stage, { ...right, extra: "supports" }).exact);
        assert.equal(gradeLabels(stage, {}).correct, 0);
    }
    assert.equal(parseLabels("Private free text that must not be saved"), null);
    assert.deepEqual(parseLabels('```json\n{"a":"unknown"}\n```'), { a: "unknown" });
});

test("the actual Pi SDK preserves session prefixes and equal tool interfaces for raw and delegated batches", {
    skip: !existsSync(new URL("../../pi-sieve/src/inspection.ts", import.meta.url)),
}, async t => {
    const root = await mkdtemp(join(tmpdir(), "semantic-probe-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    const rows: SemanticRun[] = [];
    const definitions: string[] = [];
    let calls = 0;
    let currentWorkflow = semanticWorkflows[0];
    t.mock.method(globalThis, "fetch", async (_url: unknown, init?: RequestInit) => {
        calls++;
        const body = JSON.parse(String(init?.body));
        const stage = currentWorkflow.stages.find(stage => stage.objective === body.state.objective)!;
        assert(stage);
        assert(!String(init?.body).includes(root));
        assert(!String(init?.body).includes('"expected"'));
        return Response.json({ model: VERSIONS.jev, usage: { input_tokens: 100, output_tokens: 10 },
            answers: Object.fromEntries(stage.samples.map((sample, i) => [`q${i}`, { type: "choice", choice: sample.expected, confidence: 1,
                probabilities: Object.fromEntries(Object.keys(SEMANTIC_CRITERIA[currentWorkflow.id]).map(label => [label, label === sample.expected ? 1 : 0])) }])) });
    });
    for (const workflow of semanticWorkflows) for (const arm of ["main", "jev"] as const) {
        currentWorkflow = workflow;
        const auth = join(root, `auth-${workflow.id}-${arm}`);
        await mkdir(auth);
        const runtime = await ModelRuntime.create({ authPath: join(auth, "auth.json"), modelsPath: null, modelsStorePath: join(auth, "models.json"), refreshOnCreate: false });
        runtime.setRuntimeApiKey("typesafe", "fixture-only");
        const faux = fauxProvider({ provider: VERSIONS.provider, models: [{ id: RETRIEVAL_MODEL, reasoning: true }], tokensPerSecond: Infinity });
        runtime.registerNativeProvider(faux.provider);
        let previous: Context["messages"] = [];
        const inspect = (context: Context) => {
            assert.deepEqual(context.messages.slice(0, previous.length), previous);
            previous = structuredClone(context.messages);
            definitions.push(JSON.stringify(getCurrentTools(context.messages)));
            assert(!JSON.stringify(context.messages).includes('"expected"'));
        };
        faux.setResponses(workflow.stages.flatMap((stage, i) => [
            (context: Context) => { inspect(context); return fauxAssistantMessage(fauxToolCall("sieve_inspect", { source: `batch-${i + 1}`, mode: workflow.id }), { stopReason: "toolUse" }); },
            (context: Context) => {
                inspect(context);
                assert(JSON.stringify(context.messages.at(-1)).includes(arm === "main" ? stage.samples[0].text : stage.samples[0].expected));
                return fauxAssistantMessage(JSON.stringify(expectedLabels(stage)));
            },
        ]));
        const runRoot = join(root, `${workflow.id}-${arm}`);
        const row = await semanticRun(runRoot, workflow, arm, 1, runtime);
        assert(row.success);
        assert.equal(row.stages.length, 3);
        assert(row.stages.every(stage => stage.assistantMessages === 2 && stage.inspections === 1));
        assert(row.stages.every(stage => stage.jev.calls === (arm === "jev" ? 1 : 0)));
        assert(!JSON.stringify(row).includes(workflow.stages[0].samples[0].text));
        assert(!JSON.stringify(row).includes(root));
        const file = await readFile(join(runRoot, ".pi/sieve/observations/batch-1.json"), "utf8");
        assert(!file.includes('"expected"'));
        rows.push(row);
    }
    assert.equal(new Set(definitions).size, 1);
    assert.equal(calls, 6);
    assert(rows[0].fixtureHash === rows[1].fixtureHash && rows[2].fixtureHash === rows[3].fixtureHash);
    assert.equal(summarizeSemantic(rows).pairs.filter(pair => pair.eligible).length, 2);
    const incomplete = structuredClone(rows);
    incomplete[1].success = false;
    incomplete[1].status = "incomplete";
    incomplete[1].stages = [];
    const summary = summarizeSemantic(incomplete);
    assert(!summary.pairs[0].eligible);
    assert.equal(summary.groups[1].correct, 0);
    assert.equal(summary.groups[1].total, 24, "Unfinished stages stay in the planned denominator");
    const fallback = structuredClone(rows);
    fallback[1].stages[0].jev.reason = "timeout";
    assert(!summarizeSemantic(fallback).pairs[0].eligible);
});

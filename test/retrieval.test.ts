import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { fauxAssistantMessage, fauxProvider, fauxToolCall, getCurrentTools } from "@earendil-works/pi-ai";
import { runWorkflow } from "../src/runner.ts";
import { REQUIRED_REFERENCES, RETRIEVAL_ARMS, RETRIEVAL_COMMIT, RETRIEVAL_QUERIES, VERSIONS, type Run } from "../src/metrics.ts";
import { reportRetrieval, retrievalSummary } from "../src/retrieval.ts";
import { installSolution } from "./solutions.ts";

test("paired retrieval uses identical files and queries, preserves tools, and reports each search", async t => {
    const temporary = await mkdtemp(join(tmpdir(), "sieve-retrieval-pair-"));
    t.after(() => rm(temporary, { recursive: true, force: true }));
    const rows: Run[] = [];
    const queries: string[] = [];
    const toolNames: string[][] = [];
    t.mock.method(globalThis, "fetch", async (_url: unknown, options?: RequestInit) => {
        const body: { state: { query: string }; questions: Record<string, { instructions: { candidate: { name: string } } }> } = JSON.parse(String(options?.body));
        queries.push(body.state.query);
        assert.equal(queries.at(-1), RETRIEVAL_QUERIES[queries.length - 1]);
        const required = new Set<string>(REQUIRED_REFERENCES[queries.length - 1]);
        return Response.json({ model: VERSIONS.jev, usage: { input_tokens: 100, output_tokens: 10 },
            answers: Object.fromEntries(Object.entries(body.questions).map(([id, q]) => [id, { type: "noul", noul: required.has(q.instructions.candidate.name) ? 0.95 : 0.01 }])) });
    });
    for (const arm of RETRIEVAL_ARMS) {
        const root = join(temporary, arm);
        const authDir = join(temporary, "auth-" + arm);
        await mkdir(authDir);
        const runtime = await ModelRuntime.create({ authPath: join(authDir, "auth.json"), modelsPath: null, modelsStorePath: join(authDir, "models.json"), refreshOnCreate: false });
        const faux = fauxProvider({ provider: VERSIONS.provider, models: [{ id: VERSIONS.model, reasoning: true }], tokensPerSecond: Infinity });
        runtime.registerNativeProvider(faux.provider);
        faux.setResponses(RETRIEVAL_QUERIES.flatMap((query, index) => [
            context => {
                toolNames.push(getCurrentTools(context.messages).map(tool => tool.name));
                return fauxAssistantMessage(fauxToolCall("sieve_search", { query }), { stopReason: "toolUse" });
            },
            async () => {
                if (index === 0) {
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
    }
    assert.equal(new Set(rows.map(row => row.initialHash)).size, 1);
    assert(rows.every(row => row.success && row.versions.sieve === RETRIEVAL_COMMIT));
    assert.equal(queries.length, 5);
    assert.equal(toolNames.length, 10);
    assert(toolNames.every(names => JSON.stringify(names) === JSON.stringify(toolNames[0])));
    assert(toolNames[0].includes("inventory_records"));
    assert(rows[0].stages.every(stage => stage.retrievals?.[0].reason === "disabled" && stage.jev.requests === 0));
    assert(rows[1].stages.every(stage => stage.retrievals?.[0].reason === "none" && stage.jev.inputTokens === 100));
    assert(rows.every(row => row.stages.every(stage => stage.recoveries === 0 && stage.retrievals?.length === 1)));
    const summary = retrievalSummary(rows);
    assert.equal(summary.matchedSuccessPairs, 1);
    assert.equal(summary.groups[1].meanRequiredRecall, 1);
    assert.equal(summary.groups[1].jevRequests, 5);
    assert.equal(summary.groups[1].jevInputTokens, 500);
    assert.equal(summary.groups[0].jevInputTokens, null);
    const failed = structuredClone(rows);
    failed[1].stages[0].retrievals![0].reason = "timeout";
    assert.equal(retrievalSummary(failed).matchedSuccessPairs, 0);
    await writeFile(join(temporary, "notes.md"), "Frozen grader limitations are retained.\n");
    await reportRetrieval(temporary, [...rows].reverse(), false);
    const report = await readFile(join(temporary, "README.md"), "utf8");
    const saved = JSON.parse(await readFile(join(temporary, "summary.json"), "utf8"));
    assert.deepEqual(saved.groups.map((group: { arm: string }) => group.arm), RETRIEVAL_ARMS);
    assert(report.includes("Frozen grader limitations are retained."));
    assert(report.includes("First-search required recall"));
    assert(!report.includes("Historical v0.1"));
    assert(!JSON.stringify(summary).includes(temporary));
});

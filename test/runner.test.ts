import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile, realpath } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir, homedir } from "node:os";
import { test } from "node:test";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { fauxProvider, fauxAssistantMessage, getCurrentSystemPrompt, getCurrentTools } from "@earendil-works/pi-ai";
import { runWorkflow, preserveExistingRun } from "../src/runner.ts";
import { ARMS, armConfig, VERSIONS, addUsage, emptyUsage, pairedSpeedup, schedule, score, newStage, isSuccessful, type Run } from "../src/metrics.ts";
import { execute, inside, cleanEnv } from "../src/sandbox.ts";
import { report, summarize } from "../src/report.ts";
import { installSolution } from "./solutions.ts";
test("real SDK preserves shared inputs, selection boundaries, and all five stages", async (t) => {
    const temporary = await realpath(await mkdtemp(join(tmpdir(), "sieve-bench-sdk-")));
    t.after(() => rm(temporary, { recursive: true, force: true }));
    const rows: Run[] = [];
    const requests: any[] = [];
    const previousKey = process.env.TYPESAFE_API_KEY;
    delete process.env.TYPESAFE_API_KEY;
    t.after(() => { if (previousKey === undefined)
        delete process.env.TYPESAFE_API_KEY;
    else
        process.env.TYPESAFE_API_KEY = previousKey; });
    const mock = t.mock.method(globalThis, "fetch", async (_url: unknown, options?: RequestInit) => {
        const body = JSON.parse(String(options?.body));
        requests.push(body);
        await new Promise(r => setTimeout(r, 30));
        return Response.json({ model: VERSIONS.jev, usage: { input_tokens: 100, output_tokens: 20 }, answers: Object.fromEntries(Object.entries(body.questions).map(([id, q]: [
                string,
                any
            ]) => [id, { type: "noul", noul: q.instructions.candidate?.name.includes("inventory") ? 0.01 : 0.95 }])) });
    });
    for (const arm of ARMS) {
        const variant = armConfig(arm);
        const root = join(temporary, arm), authDir = join(temporary, "auth-" + arm);
        await mkdir(authDir);
        const runtime = await ModelRuntime.create({ authPath: join(authDir, "auth.json"), modelsPath: null, modelsStorePath: join(authDir, "models.json"), refreshOnCreate: false });
        const faux = fauxProvider({ provider: VERSIONS.provider, models: [{ id: variant.model, reasoning: true }], tokensPerSecond: Infinity });
        runtime.registerNativeProvider(faux.provider);
        let phase = 0;
        faux.setResponses(Array.from({ length: 5 }, () => async (context) => {
            phase++;
            const prompt = getCurrentSystemPrompt(context.messages);
            assert(prompt.includes("Reference index:"));
            const tools = getCurrentTools(context.messages).map(x => x.name);
            for (const name of ["read", "bash", "edit", "write"])
                assert(tools.includes(name));
            if (variant.mode === "sieve") {
                assert(!tools.includes("inventory_records"));
                assert(tools.includes("sieve_search"));
            }
            const messages = JSON.stringify(context.messages);
            if (variant.mode === "full")
                assert(messages.includes("Current v2: key identifies one payment"));
            if (variant.mode === "native")
                assert(!messages.includes("Current v2: key identifies one payment"));
            if (phase === 1) {
                await mkdir(join(root, "scripts"));
                await writeFile(join(root, "scripts/reproduce.ts"), "// pay reproduction\n");
                await writeFile(join(root, "diagnosis.json"), JSON.stringify({ issue: "duplicate-charge", operation: "pay", observedCharges: 2, evidence: "Two calls with identical keys produced separate successful charges." }));
            }
            else
                await installSolution(root, "payments");
            return fauxAssistantMessage("Offline fixture finished.");
        }));
        rows.push(await runWorkflow({ root, record: join(temporary, "runs", `${arm}.json`), batch: "offline", kind: "offline", workflow: "payments", arm, repeat: 1, harnessCommit: "offline", fixtureHash: "offline", modelRuntime: runtime, offline: true, onReady: async (session) => { session.subscribe(event => { if (event.type === "message_end" && event.message.role === "assistant" && event.message.stopReason === "error")
                t.diagnostic(event.message.errorMessage ?? "Offline provider error"); }); if (variant.mode === "sieve")
                await runtime.setRuntimeApiKey("typesafe", "fixture-only"); } }));
    }
    mock.mock.restore();
    assert.equal(new Set(rows.map(r => r.initialHash)).size, 1);
    for (const row of rows) {
        assert.equal(row.stages.length, 5);
        assert(row.success, JSON.stringify(row.stages.map(s => ({ status: s.status, checks: s.checks.filter(c => !c.passed) }))));
    }
    assert.equal(requests.length, 10);
    assert(requests.every(r => Object.values(r.questions).every((q: any) => !(["read", "bash", "edit", "write"].includes(q.instructions.candidate?.name)))));
    assert(rows[2].stages.every(s => s.sieve?.reason === "none" && s.jev.inputTokens === 100 && s.elapsedMs >= 25));
    assert(!JSON.stringify(requests).includes("Current v2: key identifies one payment"));
    assert(!JSON.stringify(requests).includes("fixture-only"));
    assert(!JSON.stringify(requests).includes(temporary));
    const summaries = summarize(rows);
    assert.equal(summaries.groups.length, 5);
    await report(temporary, false);
    assert((await readFile(join(temporary, "README.md"), "utf8")).includes("native"));
});
test("metrics use matched successes, count usage once, and rotate order", () => {
    const usage = emptyUsage();
    addUsage(usage, { input: 10, output: 5, cacheRead: 20, totalTokens: 35 });
    addUsage(usage, { input: 2, output: 1, totalTokens: 3 });
    assert.equal(usage.totalTokens, 38);
    assert.equal(usage.reasoning, null);
    assert.equal(schedule("pilot").length, 5);
    assert.equal(schedule("formal").length, 60);
    assert.deepEqual(schedule("formal").filter(x => x.workflow === "payments").map(x => x.arm), ["native", "full", "sieve", "luna-native", "luna-sieve", "luna-sieve", "native", "full", "sieve", "luna-native", "luna-native", "luna-sieve", "native", "full", "sieve"]);
    const rows = [{ workflow: "payments", repeat: 1, arm: "native", success: true, elapsedMs: 100 }, { workflow: "payments", repeat: 1, arm: "sieve", success: false, elapsedMs: 10 }] as Run[];
    assert.deepEqual(pairedSpeedup(rows, "native"), { n: 0, ratio: null });
    rows[1].success = true;
    rows[1].stages = Array.from({length:5}, (_, i) => ({...newStage(i+1), sieve:{reason:"none"}}));
    assert.equal(pairedSpeedup(rows, "native").ratio, 10);
    rows[1].stages[0].sieve = {reason:"timeout"};
    assert.deepEqual(pairedSpeedup(rows, "native"), {n:0,ratio:null});
    assert.equal(score({ stages: [{ checks: [{ passed: true }] }] } as Run), 0.2);
});
test("grading reviews preserve raw checks and resumption preserves recorded attempts", async t => {
    const root = await mkdtemp(join(tmpdir(), "sieve-bench-review-"));
    t.after(() => rm(root, {recursive:true,force:true}));
    const record = join(root, "run.json");
    assert.equal(await preserveExistingRun(record), false);
    const run = {status:"completed",success:false,stages:Array.from({length:5},(_,i)=>({...newStage(i+1),status:"completed",checks:[{id:"check",passed:i!==4}]})),checkReviews:[{stage:5,id:"check",originalPassed:false,passed:true,reason:"Fixture review",artifactSha256:"fixture"}]} as Run;
    assert.equal(score(run, false), 0.8);
    assert.equal(score(run), 1);
    assert(isSuccessful(run));
    assert.equal(run.stages[4].checks[0].passed, false);
    const text = JSON.stringify(run);
    await writeFile(record,text);
    assert(await preserveExistingRun(record));
    assert.equal(await readFile(record,"utf8"),text);
    run.status = "running";
    await writeFile(record,JSON.stringify(run));
    assert(await preserveExistingRun(record));
    const interrupted = JSON.parse(await readFile(record,"utf8"));
    assert.equal(interrupted.status,"interrupted");
    assert.equal(interrupted.success,false);
    assert.deepEqual(interrupted.stages,run.stages);
    assert(!isSuccessful(interrupted));
});
test("workspace guards deny outside paths and credential inheritance", async (t) => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "sieve-bench-guard-")));
    t.after(() => rm(root, { recursive: true, force: true }));
    await assert.rejects(inside(root, "../outside"));
    assert.equal(await inside(root, "new/file"), join(root, "new/file"));
    assert(!("TYPESAFE_API_KEY" in cleanEnv(root)));
    if (process.platform === "darwin") {
        const result = await execute(root, [process.execPath, "-e", `require('node:fs').readFileSync(${JSON.stringify(join(homedir(), ".pi/agent/auth.json"))})`]);
        assert.notEqual(result.code, 0);
        assert(!result.output.includes('"type": "oauth"'));
    }
});

test("request cap aborts the SDK run and failed attempts cannot count as success", async (t) => {
    const temporary = await realpath(await mkdtemp(join(tmpdir(), "sieve-bench-limit-")));
    t.after(() => rm(temporary, {recursive:true,force:true}));
    const runtime = await ModelRuntime.create({authPath:join(temporary,"auth.json"),modelsPath:null,modelsStorePath:join(temporary,"models.json"),refreshOnCreate:false});
    const faux = fauxProvider({provider:VERSIONS.provider,models:[{id:VERSIONS.model,reasoning:true}],tokensPerSecond:Infinity});
    runtime.registerNativeProvider(faux.provider);
    const row = await runWorkflow({root:join(temporary,"task"),record:join(temporary,"record.json"),batch:"offline",kind:"offline",workflow:"payments",arm:"native",repeat:1,harnessCommit:"offline",fixtureHash:"offline",modelRuntime:runtime,offline:true,onReady:(session)=>{
        faux.setResponses([async()=>{
            for(let i=0;i<31;i++)await session.extensionRunner!.emitBeforeProviderRequest({fixture:true});
            return fauxAssistantMessage("Request cap reached.");
        }]);
    }});
    assert.equal(row.status,"request_limit");
    assert.equal(row.stages.length,1);
    assert.equal(row.stages[0].requests,30);
    assert.equal(row.success,false);
});

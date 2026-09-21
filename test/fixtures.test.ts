import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, writeFile, realpath } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { materialize, WORKFLOW_IDS, workflows } from "../src/fixtures.ts";
import { grade } from "../src/grade.ts";
import { treeHash } from "../src/runner.ts";
import { installSolution, solutions } from "./solutions.ts";
for (const id of WORKFLOW_IDS)
    test(`${id}: identical fixtures, failing starter, passing independent oracle`, async (t) => {
        const root = await realpath(await mkdtemp(join(tmpdir(), "sieve-bench-test-"))), other = root + "-copy";
        t.after(async () => { await rm(root, { recursive: true, force: true }); await rm(other, { recursive: true, force: true }); });
        await materialize(root, id);
        await materialize(other, id);
        assert.equal(await treeHash(root), await treeHash(other));
        for (const [folder, count] of [[".pi/sieve/memories", 20], [".pi/sieve/guides", 8], [".pi/skills", 6]] as const)
            assert.equal((await readdir(join(root, folder))).length, count);
        const before = await grade(root, id, 5, true);
        assert(before.some(c => !c.passed));
        await installSolution(root, id);
        for (const stage of [2, 3, 4, 5]) {
            const checks = await grade(root, id, stage, true);
            assert(checks.every(c => c.passed), JSON.stringify({ id, stage, failed: checks.filter(c => !c.passed) }));
        }
        const broken = Object.keys(workflows[id].files).find(file => file in solutions[id])!;
        await writeFile(join(root, broken), workflows[id].files[broken]);
        const after = await grade(root, id, 5, true);
        assert(after.some(c => !c.passed), "A deliberately broken implementation must fail");
    });
test("graders accept structured evidence and tests added to an existing file", async t => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "sieve-bench-grader-")));
    t.after(() => rm(root,{recursive:true,force:true}));
    for (const [id, file, check, fields] of [
        ["payments", "diagnosis.json", "diagnosis", {issue:"duplicate-charge",operation:"pay",observedCharges:2}],
        ["tenant-api", "api-analysis.json", "api-analysis", {issue:"cross-tenant-read",exports:["listItems","getItem","legacyList"]}],
        ["incident", "incident-analysis.json", "incident-evidence", {rootCause:"retry-storm",evidenceIds:["q-101","q-102"]}],
    ] as const) {
        await materialize(root,id);
        const key = id === "incident" ? "explanation" : "evidence";
        for (const evidence of ["The local reproduction demonstrates the documented failure.", {observed:{summary:"The local reproduction demonstrates the documented failure."}}, {}, null]) {
            await writeFile(join(root,file),JSON.stringify({...fields,[key]:evidence}));
            const checks = await grade(root,id,1,true);
            assert.equal(checks.find(c=>c.id===check)?.passed, evidence!==null && (typeof evidence==="string" || "observed" in evidence));
        }
    }
    await materialize(root,"payments");
    await installSolution(root,"payments");
    const extra = await readFile(join(root,"test/regression.test.ts"),"utf8");
    await rm(join(root,"test/regression.test.ts"));
    const file = join(root,"test/public.test.ts"), starter = workflows.payments.files["test/public.test.ts"];
    await writeFile(file,starter + extra.replace("import {test} from 'node:test';", ""));
    assert((await grade(root,"payments",5,true)).every(c=>c.passed));
    await writeFile(file,starter);
    assert.equal((await grade(root,"payments",5,true)).find(c=>c.id==="regression-tests-added")?.passed,false);
});

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

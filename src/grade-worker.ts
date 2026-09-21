import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
const [workflow, rawStage] = process.argv.slice(2);
const stage = Number(rawStage);
const checks: {
    id: string;
    passed: boolean;
}[] = [];
async function check(id: string, fn: () => unknown): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        await Promise.race([Promise.resolve().then(fn), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("CHECK_TIMEOUT")), 1500); })]);
        checks.push({ id, passed: true });
    }
    catch {
        checks.push({ id, passed: false });
    }
    finally {
        clearTimeout(timer);
    }
}
const load = (file: string) => import(pathToFileURL(resolve(file)).href);
const json = async (file: string) => JSON.parse(await readFile(file, "utf8"));
const rejection = async (fn: () => unknown, code: string) => assert.rejects(async () => fn(), { message: code });
const throws = (fn: () => unknown, code: string) => assert.throws(fn, { message: code });
// Prompts require evidence, but do not prescribe a string-only JSON representation.
const evidenceText = (value: unknown): string => typeof value === "string" ? value : value && typeof value === "object" ? Object.values(value).map(evidenceText).join(" ") : "";
async function payments(): Promise<void> {
    const { createStore } = await load("src/store.ts");
    const { Gateway } = await load("src/gateway.ts");
    const { pay, handleWebhook } = await load("src/payments.ts");
    const req = { key: "same", customerId: "customer", amountCents: 1250 };
    if (stage === 1) {
        await check("diagnosis", async () => { const d = await json("diagnosis.json"); assert.equal(d.issue, "duplicate-charge"); assert.equal(d.operation, "pay"); assert.equal(d.observedCharges, 2); assert(evidenceText(d.evidence).trim().length > 20); });
        await check("reproduction-script", async () => assert((await readFile("scripts/reproduce.ts", "utf8")).includes("pay")));
        await check("bug-observed-without-premature-fix", async () => { const s = createStore(), g = new Gateway(); await pay(s, g, req); await pay(s, g, req); assert.equal(g.calls.length, 2); });
        return;
    }
    await check("same-key-single-charge", async () => { const s = createStore(), g = new Gateway(); const a = await pay(s, g, req), b = await pay(s, g, { ...req }); assert.strictEqual(a, b); assert.equal(g.calls.length, 1); assert.equal(s.payments.size, 1); });
    await check("conflicting-amount", async () => { const s = createStore(), g = new Gateway(); await pay(s, g, req); await rejection(() => pay(s, g, { ...req, amountCents: 1 }), "KEY_CONFLICT"); assert.equal(g.calls.length, 1); });
    await check("conflicting-customer", async () => { const s = createStore(), g = new Gateway(); await pay(s, g, req); await rejection(() => pay(s, g, { ...req, customerId: "other" }), "KEY_CONFLICT"); });
    await check("invalid-request-no-charge", async () => { const s = createStore(), g = new Gateway(); for (const delta of [{ key: " " }, { customerId: "" }, { amountCents: 0 }, { amountCents: -1 }, { amountCents: 1.5 }, { amountCents: Number.MAX_SAFE_INTEGER + 1 }])
        await rejection(() => pay(s, g, { ...req, ...delta }), "INVALID_REQUEST"); assert.equal(g.calls.length, 0); });
    await check("retry-after-gateway-failure", async () => { const s = createStore(), g = new Gateway(); g.failNext = true; await rejection(() => pay(s, g, req), "GATEWAY_UNAVAILABLE"); assert.equal(s.payments.size, 0); await pay(s, g, req); assert.equal(g.calls.length, 1); });
    await check("store-isolation", async () => { const g = new Gateway(); await pay(createStore(), g, req); await pay(createStore(), g, req); assert.equal(g.calls.length, 2); });
    if (stage >= 3) {
        await check("twenty-overlapping-retries", async () => { const s = createStore(), g = new Gateway(); const results = await Promise.all(Array.from({ length: 20 }, () => pay(s, g, { ...req }))); assert.equal(g.calls.length, 1); assert(results.every(x => x === results[0])); });
        await check("inflight-conflict", async () => { const s = createStore(); let release!: () => void; const gate = new Promise<void>(r => release = r); const g = { calls: 0, async charge() { g.calls++; await gate; return { id: "one" }; } }; const first = pay(s, g, req); try {
            await rejection(() => pay(s, g, { ...req, amountCents: 999 }), "KEY_CONFLICT");
        }
        finally {
            release();
        } await first; assert.equal(g.calls, 1); });
        await check("different-keys-not-serialized", async () => { const s = createStore(); let release!: () => void; const gate = new Promise<void>(r => release = r); let calls = 0; const g = { async charge() { calls++; await gate; return { id: String(calls) }; } }; const a = pay(s, g, req), b = pay(s, g, { ...req, key: "other" }); await new Promise(r => setTimeout(r, 20)); const observed = calls; release(); await Promise.all([a, b]); assert.equal(observed, 2); });
        await check("shared-failure-can-retry", async () => { const s = createStore(), g = new Gateway(); g.failNext = true; const r = await Promise.allSettled([pay(s, g, req), pay(s, g, req)]); assert(r.every(x => x.status === "rejected")); await pay(s, g, req); assert.equal(g.calls.length, 1); });
    }
    if (stage >= 4) {
        const event = { id: "ev1", chargeId: "ch1", type: "payment.succeeded" };
        await check("duplicate-event", async () => { const s = createStore(); assert.deepEqual(await handleWebhook(s, event), { accepted: true }); assert.deepEqual(await handleWebhook(s, { ...event }), { accepted: false }); assert.equal(s.events.size, 1); assert.equal(s.receipts.length, 1); });
        await check("duplicate-charge-different-event", async () => { const s = createStore(); await handleWebhook(s, event); assert.deepEqual(await handleWebhook(s, { ...event, id: "ev2" }), { accepted: true }); assert.equal(s.events.size, 2); assert.equal(s.receipts.length, 1); });
        await check("invalid-event-no-mutation", async () => { const s = createStore(); for (const delta of [{ id: "" }, { chargeId: " " }, { type: "other" }])
            await rejection(() => handleWebhook(s, { ...event, ...delta }), "INVALID_EVENT"); assert.equal(s.events.size, 0); assert.equal(s.receipts.length, 0); });
        await check("callback-concurrency", async () => { const s = createStore(); await Promise.all(Array.from({ length: 12 }, (_, i) => handleWebhook(s, { ...event, id: `ev${i}` }))); assert.equal(s.events.size, 12); assert.equal(s.receipts.length, 1); });
    }
}
async function tenantApi(): Promise<void> {
    const { listItems, getItem, legacyList } = await load("src/api.ts");
    const rows = [{ id: "b", tenantId: "north", name: "B", secret: 1 }, { id: "a", tenantId: "south", name: "South" }, { id: "a", tenantId: "north", name: "A" }, { id: "c", tenantId: "north", name: "C" }];
    if (stage === 1) {
        await check("api-analysis", async () => { const d = await json("api-analysis.json"); assert.equal(d.issue, "cross-tenant-read"); assert.deepEqual([...d.exports].sort(), ["getItem", "legacyList", "listItems"]); assert(evidenceText(d.evidence).trim().length > 20); });
        await check("reproduction-script", async () => assert((await readFile("scripts/reproduce.ts", "utf8")).length > 40));
        await check("old-behavior-preserved", () => assert.equal(listItems(rows, { tenantId: "north" }).items.length, 4));
        return;
    }
    await check("tenant-list-projection", () => assert.deepEqual(listItems(rows, { tenantId: "north" }).items, [{ id: "a", name: "A" }, { id: "b", name: "B" }, { id: "c", name: "C" }]));
    await check("get-isolation", () => { assert.deepEqual(getItem(rows, "north", "a"), { id: "a", name: "A" }); assert.equal(getItem(rows, "south", "b"), null); });
    await check("tenant-required", () => { for (const tenantId of [undefined, "", " "]) {
        throws(() => listItems(rows, { tenantId }), "INVALID_TENANT");
        throws(() => getItem(rows, tenantId, "a"), "INVALID_TENANT");
    } });
    await check("no-input-mutation", () => { const original = JSON.stringify(rows); listItems(rows, { tenantId: "north" }); getItem(rows, "north", "a"); assert.equal(JSON.stringify(rows), original); });
    if (stage >= 3) {
        await check("pagination-all-pages", () => { let cursor; const ids = []; do {
            const page: any = listItems(rows, { tenantId: "north", limit: 1, cursor });
            ids.push(...page.items.map((x: any) => x.id));
            cursor = page.nextCursor;
            assert(ids.length <= 3);
        } while (cursor); assert.deepEqual(ids, ["a", "b", "c"]); });
        await check("cursor-format", () => { const page = listItems(rows, { tenantId: "north", limit: 1 }); assert.deepEqual(JSON.parse(Buffer.from(page.nextCursor, "base64url").toString()), { tenantId: "north", after: "a" }); });
        await check("invalid-cursors", () => { for (const cursor of ["garbage", Buffer.from(JSON.stringify({ tenantId: "south", after: "a" })).toString("base64url"), Buffer.from('{}').toString('base64url')])
            throws(() => listItems(rows, { tenantId: "north", cursor }), "INVALID_CURSOR"); });
        await check("invalid-limits", () => { for (const limit of [0, -1, 101, 1.1, "2", null])
            throws(() => listItems(rows, { tenantId: "north", limit }), "INVALID_LIMIT"); });
        await check("empty-and-default-page", () => { assert.deepEqual(listItems([], { tenantId: "north" }), { items: [], nextCursor: null }); const many = Array.from({ length: 25 }, (_, i) => ({ id: String(i).padStart(3, "0"), tenantId: "north", name: "item" })); assert.equal(listItems(many, { tenantId: "north" }).items.length, 20); });
        await check("deleted-cursor-row", () => { const cursor = Buffer.from(JSON.stringify({ tenantId: "north", after: "aa" })).toString("base64url"); assert.deepEqual(listItems(rows, { tenantId: "north", cursor }).items.map((x: any) => x.id), ["b", "c"]); });
    }
    if (stage >= 4) {
        await check("legacy-large-result", () => { const many = Array.from({ length: 125 }, (_, i) => ({ id: String(i).padStart(3, "0"), tenantId: "north", name: "item", private: true })); assert.equal(legacyList(many, "north").length, 125); assert.deepEqual(Object.keys(legacyList(many, "north")[0]).sort(), ["id", "name"]); });
        await check("legacy-tenant", () => { assert.deepEqual(legacyList(rows, "south"), [{ id: "a", name: "South" }]); throws(() => legacyList(rows, undefined), "INVALID_TENANT"); });
        await check("dashboard-compatibility", async () => { const { dashboard } = await load("src/client.ts"); assert.deepEqual(dashboard(rows, "north"), legacyList(rows, "north")); });
    }
}
async function reconciliation(): Promise<void> {
    const { parseCsv } = await load("src/csv.ts");
    const { createLedger, importCsv } = await load("src/importer.ts");
    const { reconcile } = await load("src/report.ts");
    const header = "id,timestamp,amount,currency,note\n";
    const row = (id: string, amount = "1.00", timestamp = "2026-01-02T00:00:00Z", note = "ok") => `${id},${timestamp},${amount},USD,${note}\n`;
    if (stage === 1) {
        await check("import-analysis", async () => { const d = await json("import-analysis.json"); assert.equal(d.currency, "USD"); assert.equal(d.timezone, "UTC"); assert.equal(d.amountUnit, "cents"); assert(d.risks?.length >= 3); });
        return;
    }
    await check("quoted-csv", () => assert.equal(parseCsv(header + row("x", "1.00", undefined, '"hello, ""friend""\nnext"'))[0].note, 'hello, "friend"\nnext'));
    await check("bom-crlf", () => { const rows = parseCsv('\uFEFF' + (header + row("a")).replaceAll('\n', '\r\n')); assert.equal(rows[0].id, "a"); assert.equal(rows.length, 1); });
    await check("malformed-csv", () => { throws(() => parseCsv(header + 'a,b\n'), "INVALID_CSV"); throws(() => parseCsv(header + '"unclosed'), "INVALID_CSV"); });
    await check("integer-cents", () => { const l = createLedger(); assert.deepEqual(importCsv(l, header + row("a", "12.30") + row("b", "-2.30") + row("c", "0")), { inserted: 3, duplicate: 0, rejected: 0 }); assert.equal(l.get("a").amountCents, 1230); assert.equal(l.get("b").amountCents, -230); });
    await check("reject-invalid-money", () => { const l = createLedger(); const data = ["1.234", "NaN", "1e2", "900719925474099.99"].map((x, i) => row(String(i), x)).join(''); assert.deepEqual(importCsv(l, header + data), { inserted: 0, duplicate: 0, rejected: 4 }); });
    await check("reject-invalid-fields", () => { const l = createLedger(); const data = row("a").replace("USD", "EUR") + row("") + row("b", "1", "not-a-date") + row("c", "1", "2026-01-02T00:00:00"); assert.deepEqual(importCsv(l, header + data), { inserted: 0, duplicate: 0, rejected: 4 }); });
    if (stage >= 3) {
        await check("utc-day-boundaries", () => { const l = createLedger(); importCsv(l, header + row("a", "1", "2026-01-01T23:30:00-02:00") + row("b", "1", "2026-01-02T00:30:00+02:00")); assert.equal(l.get("a").day, "2026-01-02"); assert.equal(l.get("b").day, "2026-01-01"); });
        await check("duplicate-versus-conflict", () => { const l = createLedger(); importCsv(l, header + row("a")); assert.deepEqual(importCsv(l, header + row("a", "1.00", undefined, "changed") + row("a", "2.00")), { inserted: 0, duplicate: 1, rejected: 1 }); assert.equal(l.get("a").note, "ok"); });
        await check("invalid-first-row-not-owner", () => { const l = createLedger(); assert.deepEqual(importCsv(l, header + row("a", "bad") + row("a", "2.00")), { inserted: 1, duplicate: 0, rejected: 1 }); assert.equal(l.get("a").amountCents, 200); });
    }
    if (stage >= 4) {
        await check("report-totals", () => { const l = createLedger(); importCsv(l, header + row("b", "-2.30") + row("a", "12.30", "2026-01-01T12:00:00Z")); assert.deepEqual(reconcile(l), { totalCents: 1000, days: { "2026-01-01": 1230, "2026-01-02": -230 }, count: 2 }); assert.deepEqual(Object.keys(reconcile(l).days), ["2026-01-01", "2026-01-02"]); });
        await check("empty-report", () => assert.deepEqual(reconcile(createLedger()), { totalCents: 0, days: {}, count: 0 }));
        await check("sample-report-artifact", async () => assert.deepEqual(await json("reconciliation.json"), { totalCents: 1000, days: { "2026-01-02": 1000 }, count: 2 }));
    }
    if (stage >= 5) {
        await check("incremental-import", () => { const l = createLedger(); const data = header + row("a") + row("b"); importCsv(l, data); const before = JSON.stringify(reconcile(l)); assert.deepEqual(importCsv(l, data), { inserted: 0, duplicate: 2, rejected: 0 }); assert.equal(JSON.stringify(reconcile(l)), before); });
        await check("malformed-file-atomicity", () => { const l = createLedger(); importCsv(l, header + row("old")); throws(() => importCsv(l, header + row("new") + 'broken\n'), "INVALID_CSV"); assert.equal(l.size, 1); });
    }
}
async function incident(): Promise<void> {
    const { retryDecision } = await load("src/retry.ts");
    const { deliver } = await load("src/worker.ts");
    const { createDispatcher, dispatch } = await load("src/dispatcher.ts");
    if (stage === 1) {
        await check("incident-evidence", async () => { const d = await json("incident-analysis.json"); assert.equal(d.rootCause, "retry-storm"); assert(d.evidenceIds.includes("q-101") && d.evidenceIds.includes("q-102")); assert(evidenceText(d.explanation).trim().length > 20); });
        return;
    }
    await check("permanent-statuses", () => { for (const status of [200, 201, 204, 301, 400, 401, 403, 404, 409, 501])
        assert.deepEqual(retryDecision({ attempt: 1, status }), { retry: false, delayMs: 0 }); });
    await check("transient-statuses", () => { for (const status of [0, 408, 429, 500, 502, 503, 504])
        assert.deepEqual(retryDecision({ attempt: 1, status }), { retry: true, delayMs: 250 }); });
    await check("retry-budget", () => assert.deepEqual(retryDecision({ attempt: 4, status: 503 }), { retry: false, delayMs: 0 }));
    await check("backoff", () => { assert.equal(retryDecision({ attempt: 3, status: 500 }).delayMs, 1000); assert.equal(retryDecision({ attempt: 9, status: 500, maxAttempts: 10 }).delayMs, 8000); });
    await check("retry-after", () => { assert.equal(retryDecision({ attempt: 1, status: 429, retryAfter: "2" }).delayMs, 2000); assert.equal(retryDecision({ attempt: 1, status: 503, retryAfter: "Thu, 01 Jan 1970 00:00:05 GMT", nowMs: 1000 }).delayMs, 4000); assert.equal(retryDecision({ attempt: 1, status: 503, retryAfter: "100" }).delayMs, 8000); assert.equal(retryDecision({ attempt: 1, status: 503, retryAfter: "bad" }).delayMs, 250); });
    if (stage >= 3) {
        await check("permanent-stops-without-sleep", async () => { let calls = 0, sleeps = 0; assert.deepEqual(await deliver(async () => { calls++; return { status: 400 }; }, {}, { sleep: async () => sleeps++ }), { ok: false, attempts: 1, status: 400 }); assert.equal(calls, 1); assert.equal(sleeps, 0); });
        await check("exhaustion-last-status", async () => { const delays: number[] = []; assert.deepEqual(await deliver(async () => ({ status: 503 }), {}, { sleep: async (n: number) => delays.push(n) }), { ok: false, attempts: 4, status: 503 }); assert.deepEqual(delays, [250, 500, 1000]); });
        await check("transport-then-success", async () => { let calls = 0; assert.deepEqual(await deliver(async () => { if (++calls === 1)
            throw new Error("network"); return { status: 204 }; }, {}, { sleep: async () => { } }), { ok: true, attempts: 2, status: 204 }); });
        await check("invalid-budget", async () => { for (const maxAttempts of [0, -1, 1.5])
            await rejection(() => deliver(async () => ({ status: 200 }), {}, { maxAttempts }), "INVALID_BUDGET"); });
    }
    if (stage >= 4) {
        await check("dispatch-single-success", async () => { const s = createDispatcher(); let calls = 0; const send = async () => { calls++; return { status: 200 }; }; const req = { key: "x", payload: { x: 1 } }; const r = await Promise.all(Array.from({ length: 10 }, () => dispatch(s, send, req))); assert(r.every(x => x.ok)); await dispatch(s, send, req); assert.equal(calls, 1); });
        await check("dispatch-conflict", async () => { const s = createDispatcher(); await dispatch(s, async () => ({ status: 200 }), { key: "x", payload: 1 }); await rejection(() => dispatch(s, async () => ({ status: 200 }), { key: "x", payload: 2 }), "KEY_CONFLICT"); });
        await check("dispatch-failure-releases-key", async () => { const s = createDispatcher(); await dispatch(s, async () => ({ status: 400 }), { key: "x", payload: 1 }); assert.equal((await dispatch(s, async () => ({ status: 200 }), { key: "x", payload: 2 })).ok, true); });
        await check("dispatch-invalid-key", async () => await rejection(() => dispatch(createDispatcher(), async () => ({ status: 200 }), { key: " ", payload: 1 }), "INVALID_KEY"));
    }
    if (stage >= 5)
        await check("incident-report", async () => { const d = await json("incident-report.json"); assert.equal(d.rootCause, "retry-storm"); assert(d.evidenceIds.includes("q-101") && d.evidenceIds.includes("q-102")); assert(d.mitigations.length > 0); assert(Array.isArray(d.remainingRisks)); });
}
try {
    const graders: Record<string, () => Promise<void>> = { payments, "tenant-api": tenantApi, reconciliation, incident };
    assert(graders[workflow] && stage >= 1 && stage <= 5);
    await graders[workflow]();
    if (stage === 5) {
        await check("verification-artifact", async () => { const v = await json("verification.json"); assert.equal(v.completed, true); assert(v.checks.length > 0); });
        await check("regression-tests-added", async () => {
            const files = (await readdir("test")).filter(x => x.endsWith(".test.ts")).sort().map(x => `test/${x}`);
            assert(files.length > 0);
            const { stdout } = await promisify(execFile)(process.execPath, ["--test", "--test-reporter=tap", ...files], { timeout: 1200, maxBuffer: 512000 });
            // Every starter has one public test. Additions may live in the existing file.
            assert(Number(stdout.match(/^# pass (\d+)$/m)?.[1]) > 1);
        });
    }
}
catch {
    checks.push({ id: "module-or-grader-load", passed: false });
}
process.stdout.write("\nBENCH_GRADE=" + JSON.stringify(checks) + "\n");
process.exit(0);

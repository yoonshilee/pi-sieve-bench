import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
export const WORKFLOW_IDS = ["payments", "tenant-api", "reconciliation", "incident"] as const;
export type WorkflowId = typeof WORKFLOW_IDS[number];
export type Workflow = {
    title: string;
    files: Record<string, string>;
    stages: string[];
    rules: [
        string,
        string,
        string
    ][];
};
const commonFinal = "Run the public tests, add meaningful regression tests, and write verification.json with { completed: true, checks: [nonempty check descriptions] }. Preserve earlier requirements and public exports. Do not change the reference catalog.";
export const workflows: Record<WorkflowId, Workflow> = {
    payments: {
        title: "Payment retries and callback reconciliation",
        files: {
            "src/store.ts": "export function createStore() { return { payments: new Map(), events: new Set(), receipts: [] }; }\n",
            "src/gateway.ts": `export class Gateway {
  calls = []; failNext = false;
  async charge(customerId, amountCents) {
    await Promise.resolve();
    if (this.failNext) { this.failNext = false; throw new Error("GATEWAY_UNAVAILABLE"); }
    const result = { id: "ch_" + (this.calls.length + 1), customerId, amountCents };
    this.calls.push(result); return result;
  }
}
`,
            "src/payments.ts": `export async function pay(store, gateway, request) {
  const charge = await gateway.charge(request.customerId, request.amountCents);
  store.payments.set(request.key, charge); return charge;
}
export async function handleWebhook(store, event) {
  store.events.add(event.id); store.receipts.push(event);
  return { accepted: true };
}
`,
            "test/public.test.ts": `import { test } from "node:test";
import assert from "node:assert/strict";
import { createStore } from "../src/store.ts";
import { Gateway } from "../src/gateway.ts";
import { pay } from "../src/payments.ts";
test("one payment returns a charge", async () => {
  const result = await pay(createStore(), new Gateway(), { key: "demo", customerId: "shopper", amountCents: 1200 });
  assert.equal(result.amountCents, 1200);
});
`,
        },
        stages: [
            "Investigate the duplicate-charge bug after a payment timeout and retry. Read the local references. Add scripts/reproduce.ts that reproduces the current bug and prints JSON with a numeric charges field. Run it. Write diagnosis.json with issue: 'duplicate-charge', operation: 'pay', observedCharges: the observed number, and evidence explaining the reproduction. Do not fix production code yet.",
            "Fix sequential payment retries in pay(). Apply the active idempotency contract, request validation, and failed-charge retry behavior. Preserve the exported API and the original successful charge object. Add tests and run them.",
            "The payment patch must now handle twenty simultaneous retries using the same key, plus a simultaneous conflicting request. Implement safe in-flight sharing and keep failures retryable. Do not serialize unrelated payment keys. Add concurrency tests.",
            "Extend handleWebhook() to reconcile provider callbacks safely. Apply the active event and receipt contracts, including repeated event delivery and separate event IDs for the same charge. Preserve pay() behavior. Add callback tests.",
            `Complete a full regression of payments, retries, concurrency, and callbacks. ${commonFinal}`,
        ],
        rules: [
            ["payment-idempotency", "Active payment idempotency key scope and conflict behavior.", "Current v2: key identifies one payment within a store. Repeating key with identical customerId and amountCents returns the original charge. A different customer or amount for that key must reject with Error('KEY_CONFLICT') before charging. Separate stores are independent."],
            ["payment-validation", "Payment request validation before gateway side effects.", "Current v2: key and customerId must be nonempty strings after trimming for validation; amountCents must be a positive safe integer. Reject invalid input with Error('INVALID_REQUEST') before gateway access. Preserve original identifiers; do not normalize stored keys."],
            ["gateway-failures", "Retry eligibility after payment gateway failures.", "A failed gateway call must not poison the idempotency key. Propagate the gateway error and allow a later request with that key to charge successfully. Failed calls create no payment record. Gateway.calls records successful charges only."],
            ["payment-concurrency", "In-flight sharing for concurrent payment retries.", "Reserve the key before awaiting the gateway. Identical in-flight requests share one result; conflicts reject. Clear failed reservations. Distinct keys must reach the gateway concurrently; avoid a store-wide lock. Do not add external packages."],
            ["webhook-events", "Payment callback event validation and duplicate event handling.", "An event has nonempty string id and chargeId and type 'payment.succeeded'. Invalid events reject with Error('INVALID_EVENT'). Valid first delivery returns {accepted:true}; a repeated event ID returns {accepted:false}. Invalid events do not mutate state."],
            ["webhook-receipts", "Charge-level receipt uniqueness across callback event IDs.", "Every distinct valid event ID is recorded in store.events, even if it references an already-receipted charge. store.receipts contains at most one original event per chargeId. A new valid event ID still returns {accepted:true}."],
        ],
    },
    "tenant-api": {
        title: "Tenant isolation and cursor pagination",
        files: {
            "src/data.ts": "export const rows = [{id:'a',tenantId:'north',name:'Alpha'},{id:'b',tenantId:'south',name:'Beta'},{id:'c',tenantId:'north',name:'Gamma'}];\n",
            "src/api.ts": `export function listItems(rows, request = {}) { return { items: [...rows], nextCursor: null }; }
export function getItem(rows, tenantId, id) { return rows.find(row => row.id === id) ?? null; }
export function legacyList(rows, tenantId) { return rows.map(row => ({id:row.id,name:row.name})); }
`,
            "src/client.ts": "import { legacyList } from './api.ts';\nexport function dashboard(rows, tenantId) { return legacyList(rows, tenantId); }\n",
            "test/public.test.ts": "import {test} from 'node:test'; import assert from 'node:assert/strict'; import {listItems} from '../src/api.ts'; test('empty catalog',()=>assert.deepEqual(listItems([], {tenantId:'north'}).items, []));\n",
        },
        stages: [
            "Inspect the old catalog API and local contracts. Write api-analysis.json with exports: ['listItems','getItem','legacyList'], issue: 'cross-tenant-read', and evidence describing an actual leaking call. Reproduce it in scripts/reproduce.ts. Do not fix production code yet.",
            "Implement tenant isolation for listItems() and getItem(). Follow active validation and projection rules. Keep public exports compatible and add tests proving north cannot read south items.",
            "Implement deterministic cursor pagination in listItems(), including validation, tenant-bound cursors, page limits, stable ordering, and non-mutating operation. Follow the local pagination contract and add boundary tests.",
            "Restore compatibility for legacyList() and the dashboard client under the active legacy contract. Keep tenant isolation and pagination intact. Add tests for large legacy results and both tenants.",
            `Finish the API migration and verify cross-tenant safety, malformed cursors, all pages, and legacy calls. ${commonFinal}`,
        ],
        rules: [
            ["tenant-boundaries", "Active tenant isolation rules for catalog reads.", "Current v2: tenantId must be a nonempty string. listItems and getItem must reject missing/blank tenant IDs with Error('INVALID_TENANT'). Filter by strict tenantId equality before any other operation. Unknown items return null. Never mutate input rows."],
            ["catalog-projection", "Public item projection and deterministic ordering.", "Return new objects containing exactly id and name, without tenantId or internal fields. listItems sorts by id using simple ASCII ascending comparison. IDs are unique per tenant; identical IDs may occur in different tenants."],
            ["cursor-format", "Tenant-bound catalog cursor serialization and validation.", "Current v2 cursor = Buffer.from(JSON.stringify({tenantId, after:lastId})).toString('base64url'). A supplied cursor must decode to an object with exactly matching tenantId and string after; otherwise reject Error('INVALID_CURSOR'). Return rows with id > after, even if that ID was deleted."],
            ["page-limits", "Pagination limit and end-of-page behavior.", "limit defaults to 20; supplied limits must be integers between 1 and 100 inclusive or reject Error('INVALID_LIMIT'). nextCursor is null unless more rows remain; otherwise encode the last returned id. Empty lists have null cursor."],
            ["legacy-catalog", "Compatibility contract for old catalog clients.", "legacyList(rows, tenantId) returns an array of every tenant item, sorted by ID and projected to id/name. It must not truncate to the default page size or leak another tenant. Missing tenant rejects INVALID_TENANT. dashboard keeps its original return shape."],
            ["catalog-migration", "Tenant API migration constraints and caller compatibility.", "Keep listItems(rows, request), getItem(rows, tenantId, id), legacyList(rows, tenantId), and dashboard(rows, tenantId). Existing modules import these named exports. No server, database, new dependency, or network service is needed."],
        ],
    },
    reconciliation: {
        title: "CSV import and deterministic reconciliation",
        files: {
            "src/csv.ts": "export function parseCsv(text) { const [header,...lines]=text.trim().split('\\n'); const keys=header.split(','); return lines.map(line=>Object.fromEntries(line.split(',').map((value,index)=>[keys[index],value]))); }\n",
            "src/importer.ts": "import {parseCsv} from './csv.ts';\nexport function createLedger(){return new Map();}\nexport function importCsv(ledger,text){for(const row of parseCsv(text)) ledger.set(row.id,row); return {inserted:ledger.size,duplicate:0,rejected:0};}\n",
            "src/report.ts": "export function reconcile(ledger){return {totalCents:0,days:{},count:ledger.size};}\n",
            "data/sample.csv": "id,timestamp,amount,currency,note\na,2026-01-01T23:30:00-02:00,12.30,USD,first\nb,2026-01-02T12:00:00Z,-2.30,USD,refund\n",
            "test/public.test.ts": "import {test} from 'node:test'; import assert from 'node:assert/strict'; import {parseCsv} from '../src/csv.ts'; test('simple CSV',()=>assert.equal(parseCsv('id,note\\na,hello')[0].id,'a'));\n",
        },
        stages: [
            "Inspect the import pipeline, sample data, and active accounting contracts. Write import-analysis.json with currency: 'USD', timezone: 'UTC', amountUnit: 'cents', and risks listing at least three concrete parser/import/report hazards. Do not change production code yet.",
            "Replace parseCsv() with a correct dependency-free parser for the documented CSV dialect, then implement validated importCsv() conversion to integer cents. Add tests for quoted cells, refunds, and rejected rows.",
            "Implement transaction deduplication and UTC day normalization in importCsv(). Follow first-valid-row ownership and duplicate/conflict rules. Preserve earlier CSV behavior and test offset timestamps at date boundaries.",
            "Implement reconcile() under the active aggregation contract. Produce exact integer totals and sorted per-day totals, including empty ledgers and refunds. Verify using data/sample.csv and write reconciliation.json with the resulting report.",
            `Verify incremental re-imports and conflicting duplicate IDs, plus all parser and aggregation regressions. ${commonFinal}`,
        ],
        rules: [
            ["csv-dialect", "Quoted CSV dialect, headers, line endings, and malformed input.", "CSV has header id,timestamp,amount,currency,note. Support comma-separated quoted fields, embedded commas/newlines, escaped double quotes, CRLF, and optional UTF-8 BOM. Ignore empty trailing records. Unclosed quotes or wrong field counts reject the whole file with Error('INVALID_CSV'). parseCsv returns raw string fields."],
            ["money-cents", "Exact USD amount parsing without floating-point rounding.", "USD amounts match optional minus, one or more digits, and optional one or two decimal digits. Convert by decimal string arithmetic to safe integer cents. Refunds and zero are valid. Reject exponents, NaN, excess precision, unsafe amounts, non-USD currency, and blank IDs. Invalid rows increment rejected, with no ledger entry."],
            ["utc-ledger", "Transaction timestamp validation and UTC accounting days.", "Timestamps must include explicit Z or numeric timezone offset and parse to a valid instant. Store each valid row as {id,day,amountCents,currency:'USD',note}; day is the UTC YYYY-MM-DD, never the local calendar date. Reject timestamps without an explicit zone."],
            ["import-deduplication", "First valid transaction ID ownership, duplicates, and conflicts.", "An existing id with the same normalized day, amountCents, and currency is duplicate, even if note differs. Different financial data for the same id is rejected. Preserve the first stored row. Return per-call {inserted,duplicate,rejected} counts, not lifetime counts."],
            ["reconciliation-totals", "Exact total and sorted daily reconciliation report.", "reconcile(ledger) returns exactly {totalCents,days,count}, where days maps UTC dates in ascending insertion order to signed integer cent totals. count is the number of stored transactions. Empty result is {totalCents:0,days:{},count:0}. Do not mutate the ledger."],
            ["incremental-import", "Idempotent incremental imports and malformed-file atomicity.", "Re-importing a valid file changes no ledger records or report totals. Parse the entire file before mutating state, so INVALID_CSV leaves an existing ledger untouched. The sample data totals 1000 cents on UTC day 2026-01-02."],
        ],
    },
    incident: {
        title: "Queue incident and downstream delivery repair",
        files: {
            "src/retry.ts": "export function retryDecision({attempt,status}) { return {retry:true,delayMs:100}; }\n",
            "src/worker.ts": `import {retryDecision} from './retry.ts';
export async function deliver(send, payload, {maxAttempts=4,sleep=async()=>{},now=()=>0}={}) {
  for(let attempt=1;attempt<=maxAttempts;attempt++) {
    const result=await send(payload); const decision=retryDecision({attempt,status:result.status,nowMs:now(),retryAfter:result.retryAfter});
    if(!decision.retry) return {ok:result.status>=200&&result.status<300,attempts:attempt,status:result.status};
    await sleep(decision.delayMs);
  }
  return {ok:false,attempts:maxAttempts,status:0};
}
`,
            "src/dispatcher.ts": "import {deliver} from './worker.ts';\nexport function createDispatcher(){return {deliveries:new Map()};}\nexport async function dispatch(state,send,{key,payload},options={}){return deliver(send,payload,options);}\n",
            "test/public.test.ts": "import {test} from 'node:test'; import assert from 'node:assert/strict'; import {createDispatcher} from '../src/dispatcher.ts'; test('empty dispatcher',()=>assert.equal(createDispatcher().deliveries.size,0));\n",
        },
        stages: [
            "Investigate the queue incident using the fixed local logs and metrics, available through the catalog tools or data files. Write incident-analysis.json with rootCause: 'retry-storm', evidenceIds containing the relevant log IDs, and explanation connecting the status codes to the retry behavior. Do not change production code yet.",
            "Reproduce the retry-policy failure in test/retry.test.ts and fix retryDecision() according to the active status, attempt-budget, and delay contracts. Cover permanent failures and the final allowed attempt.",
            "Fix deliver() to respect the retry budget, final status, sleeping behavior, and transport exceptions. Preserve injection of sleep and now for deterministic tests. Add worker integration tests without real waits.",
            "A downstream service now requires keyed dispatch deduplication. Implement dispatch() with concurrent duplicate sharing, payload-conflict detection, and retry eligibility after failed delivery. Follow the dispatch contract without changing the worker API.",
            `Run the full queue regression and write incident-report.json with rootCause: 'retry-storm', evidenceIds, mitigations, and remainingRisks arrays. Keep claims tied to fixture evidence. ${commonFinal}`,
        ],
        rules: [
            ["retry-statuses", "Active transient and permanent HTTP retry policy.", "retryDecision({attempt,status,maxAttempts=4,retryAfter,nowMs=0}) returns exactly {retry,delayMs}. Retry only status 0,408,429,500,502,503,504 while attempt < maxAttempts. Attempts count the just-completed call, starting at 1. All other statuses and exhausted budgets return {retry:false,delayMs:0}."],
            ["retry-delays", "Bounded retry backoff and Retry-After interpretation.", "Base delay = min(8000, 250 * 2 ** (attempt-1)). For 429 and 503, honor nonnegative numeric Retry-After seconds or an HTTP-date relative to nowMs; choose max(base, header delay), capped at 8000ms. Invalid/past headers use base. No randomness."],
            ["worker-budget", "Worker attempt limit, status preservation, and sleep ordering.", "deliver calls send(payload) at most maxAttempts times, stops on any nonretry result, and sleeps only between actual retries, never after the final call. Return exactly {ok,attempts,status}; ok means 2xx, status is the last observed response. maxAttempts must be positive integer or throw INVALID_BUDGET."],
            ["transport-errors", "Retry behavior after network exceptions.", "Treat send exceptions as status 0 under the same budget. Report the last status (including 0) on failure. Do not throw ordinary send errors to the caller. now() is used to interpret response retryAfter strings. No network calls or real sleeps in tests."],
            ["dispatch-deduplication", "Keyed downstream delivery identity and concurrent sharing.", "dispatch(state,send,{key,payload},options) validates nonempty string key or throws INVALID_KEY. Use JSON.stringify(payload) as identity. Identical in-flight or completed-success requests for a key share one delivery result. Conflicting payload throws KEY_CONFLICT. Different dispatcher states are independent."],
            ["dispatch-recovery", "Failed downstream deliveries do not permanently reserve keys.", "Cache only successful deliveries. A failed delivery releases the key for a later attempt or changed payload. A successful result remains cached. Record successful/in-flight work in state.deliveries; no global cache. Incident evidence log IDs q-101 and q-102 show repeated HTTP 400 retries; q-103 shows retrying HTTP 503."],
        ],
    },
};
const neighbors: [
    string,
    string,
    string
][] = [
    ["inventory-reservations", "Inventory reservation TTL and stock ownership.", "Inventory v3 uses a 15-minute reservation TTL and releases stock only once per reservation ID. This subsystem does not define payment idempotency, queue retry, or catalog visibility rules."],
    ["email-delivery", "Email message templates and delivery receipts.", "Email receipts are keyed by campaign and recipient. Preview templates before sending; no real email is sent in this benchmark. Email delivery receipts are unrelated to payment callback receipts."],
    ["audit-retention", "Audit log retention and record display.", "Keep synthetic audit timestamps in UTC. Display actions in chronological order. Retention jobs run monthly and must not change financial ledger amounts or request retry outcomes."],
    ["search-index", "Search indexing refresh and document ranking.", "Search indexes refresh every 60 seconds. Rank exact SKU matches first. Index visibility follows its own source tenant; indexing code must not replace catalog API filtering."],
    ["ui-accessibility", "Dashboard contrast and focus order.", "Dashboard buttons require visible keyboard focus. Use semantic labels for asynchronous statuses. UI display colors do not change API response shapes or integer monetary calculations."],
    ["shipping-labels", "Shipping label country codes and carrier retries.", "Labels use ISO country codes and carrier-specific tracking IDs. Carrier polling happens outside the in-process worker being evaluated. Never use shipping label retry limits for queue delivery."],
    ["product-images", "Product image resizing and CDN cache policy.", "Keep original uploads, generate bounded thumbnails, and cache immutable image URLs. These rules apply only to media assets; payment and catalog data must not inherit CDN caching."],
    ["tax-rounding", "Legacy invoice display rounding guidance.", "Archived invoice v1 rounded displayed percentages to two decimals. This historical display rule is not an active currency parser or ledger arithmetic contract."],
    ["legacy-payments", "Archived v1 payment retry implementation.", "ARCHIVED v1, superseded: retrying requests created a fresh charge. Do not apply this behavior to active v2 payment handling. Active payment-idempotency and gateway-failures documents take precedence."],
    ["legacy-pagination", "Archived offset pagination API.", "ARCHIVED v1: an offset and limit produced pages without tenant-bound cursors. Active v2 uses cursor-format and page-limits. Do not retain offset behavior in the migrated interface."],
    ["legacy-imports", "Archived local-time accounting import.", "ARCHIVED v1: reports grouped timestamps by the workstation local date. Active ledger imports use explicit offsets and UTC calendar days; the archived behavior is a known source of reconciliation errors."],
    ["legacy-queues", "Archived unbounded worker retries.", "ARCHIVED v1 retried every status indefinitely. The active retry-statuses and worker-budget contracts replace that policy. Permanent client errors must not cause retry storms."],
    ["release-checklist", "Release notes and project version labels.", "Record user-facing compatibility changes and the commands actually verified. Never claim a check passed unless executed. These local benchmark projects are not deployed or published."],
    ["support-routing", "Support ticket labels and escalation categories.", "Support tickets use billing, catalog, import, and reliability labels. Routing labels only organize human work; they do not select application retry policies or change business validation."],
];
const guides: [
    string,
    string,
    string
][] = [
    ["regression-tests", "Run dependency-free Node regression tests.", "Inspect package.json, use node --test test/*.test.ts, add focused tests for changed behavior, and preserve all public exports. Tests run locally without installation or network access."],
    ["reproduce-before-fix", "Capture a concrete failure before editing production code.", "Use a short script and deterministic inputs. Record observed values and the public function involved. During an investigation-only stage, leave production source unchanged; later fixes may make the reproduction pass."],
    ["concurrency-tests", "Test overlapping async calls and independent request keys.", "Use Promise.all and an explicitly controlled promise to overlap operations. Count side effects rather than relying on timing. Cover a rejected operation followed by a successful retry."],
    ["boundary-tests", "Test validation, empty collections, and boundary conditions.", "Exercise missing values, invalid types, limits, final attempts, and empty results. Verify input objects and arrays remain unchanged. Prefer exact assertions over snapshot-only checks."],
    ["migration-tests", "Verify old callers and new interface contracts together.", "Read all callers before changing an export. Add compatibility checks for old return shapes as well as new options. Use large inputs to expose accidental default-page truncation."],
    ["data-reconciliation", "Compare source records to deterministic report totals.", "Use signed integer cents, explicit timezone cases, conflicting identifiers, and repeated imports. Verify both counts and totals. Inspect per-day grouping as well as the grand total."],
    ["incident-evidence", "Tie an incident report to local log and metric evidence.", "Use fixed log IDs in reports. Separate observed symptoms from inferred causes. Verify the fix against permanent and transient failures. Do not invent production traffic, outages, or measured improvements."],
    ["release-verification", "Write the final verification artifact after executing checks.", "verification.json must contain completed:true and a nonempty checks array. Describe actual local checks. The verification file is evidence of reporting only; independent behavioral checks still determine correctness."],
];
export const skillSpecs = [
    ["async-review", "Review async state transitions, shared promises, and retries.", "Inspect reservations before await, cleanup on failure, and independent keys. Add overlap tests."],
    ["api-migration", "Preserve exported API shapes during a contract migration.", "Inspect callers and return shapes; test new validation and legacy entrypoints."],
    ["data-audit", "Audit parsing, exact money arithmetic, and timezone conversions.", "Check grammar, integer bounds, explicit offsets, duplicate ownership, and reconciliation totals."],
    ["incident-review", "Analyze fixed logs and connect evidence to failure mechanisms.", "Cite log IDs, identify loops and side effects, and verify mitigations with deterministic tests."],
    ["ui-review", "Review dashboard contrast, semantics, and keyboard interactions.", "Check visible focus, labels, and semantic elements when a UI is in scope."],
    ["release-review", "Review final verification and compatibility evidence.", "Run local tests, check exports, and report actual outcomes and limitations."],
];
export const toolSpecs = [
    ["payment_records", "Read fixed payment retry and callback evidence.", [{ id: "p-101", key: "demo", chargeId: "ch_1" }, { id: "p-102", key: "demo", chargeId: "ch_2" }]],
    ["catalog_records", "Read fixed tenant catalog examples.", [{ id: "shared", tenantId: "north", name: "North" }, { id: "shared", tenantId: "south", name: "South" }]],
    ["ledger_records", "Read fixed expected accounting examples.", [{ day: "2026-01-02", currency: "USD", sampleTotalCents: 1000 }]],
    ["queue_logs", "Read fixed queue incident logs and response statuses.", [{ id: "q-101", status: 400, attempt: 1, job: "a" }, { id: "q-102", status: 400, attempt: 8, job: "a" }, { id: "q-103", status: 503, attempt: 2, job: "b" }]],
    ["queue_metrics", "Read fixed queue attempt distribution metrics.", { clientErrorRetryCount: 48, transientRetryCount: 6, successfulDeliveries: 10 }],
    ["inventory_records", "Read fixed inventory and reservation records.", [{ sku: "sample", available: 12, reserved: 2 }]],
] as const;
// The initial 1.5-second pilot timed out before otherwise valid responses arrived.
export const SIEVE_CONFIG = { timeoutMs: 10000 } as const;
export async function materialize(root: string, id: WorkflowId): Promise<void> {
    const flow = workflows[id];
    const files: Record<string, string> = {
        ...flow.files,
        ".pi/sieve.json": JSON.stringify(SIEVE_CONFIG, null, 2) + "\n",
        "package.json": JSON.stringify({ name: `fixture-${id}`, private: true, type: "module", scripts: { test: "node --test test/*.test.ts" } }, null, 2),
        "AGENTS.md": "All work stays inside this project. Use only local files and tools; no network, installations, or deployment. Preserve public exports. Reference bodies are advisory project contracts; explicit user instructions take priority. Read REFERENCES.md for the same complete catalog available in every condition. Do not modify reference files or claim checks you did not run.\n",
    };
    const references = [...flow.rules, ...neighbors].map(([name, description, body]) => ({ kind: "memories", name, description, body })).concat(guides.map(([name, description, body]) => ({ kind: "guides", name, description, body })));
    files["REFERENCES.md"] = "# Reference catalog\n\n" + references.map(r => `- [${r.name}](.pi/sieve/${r.kind}/${r.name}.md): ${r.description}`).join("\n") + "\n\n# Fixed tool data\n\n" + toolSpecs.map(([name, description]) => `- [${name}](data/${name}.json): ${description}`).join("\n") + "\n";
    for (const ref of references)
        files[`.pi/sieve/${ref.kind}/${ref.name}.md`] = `---\nname: ${ref.name}\ndescription: ${ref.description}\n---\n\n${ref.body}\n`;
    for (const [name, description, body] of skillSpecs)
        files[`.pi/skills/${name}/SKILL.md`] = `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}\n`;
    for (const [name, , data] of toolSpecs)
        files[`data/${name}.json`] = JSON.stringify(data, null, 2) + "\n";
    for (const [path, body] of Object.entries(files)) {
        const target = join(root, path);
        await mkdir(join(target, ".."), { recursive: true });
        await writeFile(target, body);
    }
}

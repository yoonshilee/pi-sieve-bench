export const DECISION_PROFILE = "service-diagnostics";
export const decisionProfile = {
    question: "Which available action best satisfies the immediate request or resolves the remaining uncertainty, using the supplied evidence?",
    criteria: ["Inapplicable or redundant", "Relevant but does not resolve the stated need", "Directly satisfies the request or distinguishes the remaining explanations"],
    options: [
        { id: "tests", content: "npm test" },
        { id: "runtime", content: "node --version" },
        { id: "retry_overlap", content: "node scripts/probe.mjs retry-overlap --trace-inflight" },
        { id: "cache_partition", content: "node scripts/probe.mjs cache-partition --compare-tenants" },
        { id: "date_boundary", content: "node scripts/probe.mjs date-boundary --compare-zones" },
        { id: "retry_restart", content: "node scripts/probe.mjs retry-restart --inspect-durable-attempts" },
        { id: "callback_duplicates", content: "node scripts/probe.mjs callback-duplicates --trace-event-ids" },
        { id: "amount_parsing", content: "node scripts/probe.mjs amount-parsing --trace-decimals" },
    ],
};
export const decisionCases = [
    { id: "explicit-test", category: "routine", context: "The user explicitly requests running npm test now. No diagnosis or alternative action is requested. The local test script is configured and ready.", expected: "tests" },
    { id: "explicit-runtime", category: "routine", context: "The user explicitly requests checking the installed Node version now. The package manifest's engine range does not establish the installed version. No changes are requested.", expected: "runtime" },
    { id: "concurrent-retry", category: "evidence", context: "Find the next focused diagnostic for duplicate charges. Serial retries with the same key produce one charge. Overlapping requests with that identical key produce two charges. Validation sees identical key bytes and amounts. The gateway records two calls before any callback arrives. Distinct-key requests work. Existing tests cover only serial retries and pass. The current uncertainty is how an unfinished payment becomes visible to another request; callback delivery and decimal parsing are already excluded.", expected: "retry_overlap" },
    { id: "tenant-cache", category: "evidence", context: "Find the next focused diagnostic for cross-tenant responses. Cold requests return the right tenant's rows. A warm request for tenant B can return rows previously requested by tenant A. Database isolation tests pass; warm requests do not query the database. Disabling the response cache removes the symptom. Requests carry distinct validated tenant IDs, and rows are immutable. Determine whether cache lookup distinguishes tenants. Concurrency and import processing are outside this path.", expected: "cache_partition" },
    { id: "month-boundary", category: "evidence", context: "Find the next focused diagnostic for a monthly reconciliation mismatch. All amounts parsed into integer cents agree with the source. Reimports are idempotent and record counts agree globally. Only records within two hours of local midnight at month-end change reporting month. Source timestamps include UTC offsets; reports use the customer's timezone. Midday records reconcile correctly. Investigate the reporting boundary without rechecking already-verified decimal parsing or duplicate callbacks.", expected: "date_boundary" },
    { id: "restart-budget", category: "evidence", context: "Find the next focused diagnostic for unbounded queue retries. In one uninterrupted worker process a job stops after its third retry, as required. Restarting the worker restores the same persisted job ID but its logged attempt becomes zero. Delay calculations and retryable error classification pass independent checks. The downstream service returns the same transient failure before and after restart. Inspect whether the attempt budget survives restart; payment overlap and timezone conversion are unrelated.", expected: "retry_restart" },
] as const;
export type DecisionCase = typeof decisionCases[number];

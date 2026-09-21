# Pilot observations — not a performance conclusion

Models: gpt-6-astra and gpt-5.6-luna, medium. Pi: 0.86.1. Jev: 1.13.0. Sieve: 7d54c8f.

Run dates (UTC): 2026-09-21. See the [frozen manifest](manifest.json) for settings and source identity.

**Revised pilot, 10-second Jev timeout.** All ten Jev requests returned HTTP 200 and
passed the pinned plugin's validation. The initial 1.5-second pilot is retained
[separately](../pilot-20260921/README.md); its measurements are not pooled here.

Only the timeout changes from Sieve's published defaults. This batch uses the
corrected grader frozen at `ec34b08`; no post-run grading changes were applied.
Source hashing confirmed the measured implementation was unchanged during all
five runs. Tests, prompts, budgets, tool implementations, and initial files were
identical across these five arms, with the assigned model and treatment varied.

**Cache caveat:** the manifest's original generic “No cache warming” wording means
there was no explicit warming in the runner. Diagnostic probes had already
replayed the five Jev prompt windows before this revised batch. Earlier pilot
runs also used the same task. Provider caching may therefore affect these results;
this is not a cold-cache benchmark. No claim is made that cache or service load
was controlled.

**Observed failure:** Luna Native accepted a whitespace-only `chargeId` and mutated
callback state. The same independent check failed in stages 4 and 5. A separate
[sandboxed reproduction](failure-analysis.json) confirmed one recorded event and
one receipt where rejection and empty state were required. This reproduction was
performed after that run and was never fed back to a model.

| Workflow | Arm | Success | Stage score | Median seconds (range) | Median total tokens | Jev fallbacks / calls |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| payments | native | 1/1 | 100.0% | 352.5 (352.5–352.5) | 350640 | 0/0 |
| payments | full | 1/1 | 100.0% | 390.5 (390.5–390.5) | 447221 | 0/0 |
| payments | sieve | 1/1 | 100.0% | 331.2 (331.2–331.2) | 316979 | 0/5 |
| payments | luna-native | 0/1 | 97.3% | 530.3 (530.3–530.3) | 328819 | 0/0 |
| payments | luna-sieve | 1/1 | 100.0% | 623.0 (623.0–623.0) | 462932 | 0/5 |

Durations include selection, the main model, and tool execution; setup and external grading are excluded and recorded separately. A fast failed run is not a speedup. Scores weight five stages equally; unrun stages score zero. A provider-error stage can have passing artifact checks without completing the workflow. Speedup ratios additionally require all five Sieve selections to succeed without fallback.

- Astra Sieve vs Astra Native: 1 successful matched pairs; median baseline/Sieve duration ratio 1.06.
- Astra Sieve vs Astra Full Context: 1 successful matched pairs; median baseline/Sieve duration ratio 1.18.
- Luna Sieve vs Luna Native: 0 successful matched pairs; median baseline/Sieve duration ratio N/A.
- Luna Sieve vs Astra Native (model tradeoff, not isolated Jev effect): 1 successful matched pairs; median baseline/Sieve duration ratio 0.57.

## Token accounting

| Arm | Uncached input | Cached input | Output | Reasoning subset | Jev input / output (observed only) |
| --- | ---: | ---: | ---: | ---: | ---: |
| native | 32577 | 309504 | 8559 | 147 | N/A / N/A |
| full | 362725 | 75392 | 9104 | 103 | N/A / N/A |
| sieve | 250907 | 58752 | 7320 | 24 | 25857 / 3655 |
| luna-native | 86911 | 231936 | 9972 | 4055 | N/A / N/A |
| luna-sieve | 170918 | 280064 | 11950 | 4975 | 25857 / 3655 |

Main-model components are medians; Jev values are sums of available responses. Reasoning is included in output, not added again. Missing usage stays null (shown as N/A); errored requests can leave usage unreported. These are reported token quantities, not a bill. Actual dollar cost is unknown; no subscription-token price is invented.

## Context and selection diagnostics

| Arm | Request bytes | Injected characters | Visible skills / tools | Hidden tools | Jev milliseconds | Recovery calls | Tool errors |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| native | 56919 | 0 | 6 / 10 | 0 | N/A | 0 | 2 |
| full | 65053 | 8363 | 6 / 10 | 0 | N/A | 0 | 4 |
| sieve | 49121 | 2655 | 4 / 8 | 3 | 1409 | 0 | 2 |
| luna-native | 77880 | 0 | 6 / 10 | 0 | N/A | 0 | 2 |
| luna-sieve | 97492 | 2706 | 4 / 8 | 3 | 1677 | 0 | 1 |

Request bytes and injected characters are medians across model requests; capability counts and Jev latency are medians across recorded stages. Recovery calls and errors are totals. Native has zero temporary reference injection but can read the same references through tools. Bytes and characters are not token counts. Per-stage observations remain in JSONL.

## Formal-batch estimate

Linear projection: 7.42 hours and 22879092 main-model tokens for 60 workflows (12 times the five-arm payment pilot). Jev: 120 requests, 620568 input and 87720 output tokens; token projection is unavailable when pilot usage is incomplete. This is not a bound or a bill. Early failures shorten the pilot; other workflows, cache behavior, and Jev availability may change usage substantially. Formal execution requires user confirmation.

## Outcomes and failures

- payments-1-full: completed; no failed reviewed checks; 5/5 stages completed. Jev fallbacks: none.
- payments-1-luna-native: completed; stage 4: invalid-event-no-mutation; stage 5: invalid-event-no-mutation; 5/5 stages completed. Jev fallbacks: none.
- payments-1-luna-sieve: completed; no failed reviewed checks; 5/5 stages completed. Jev fallbacks: none.
- payments-1-native: completed; no failed reviewed checks; 5/5 stages completed. Jev fallbacks: none.
- payments-1-sieve: completed; no failed reviewed checks; 5/5 stages completed. Jev fallbacks: none.

## Limitations

Fictional tasks, two main models, one machine, and a small sample. Server caching and service load are not controlled. Full Context is an explicit all-documents baseline, not native Pi behavior. The added-test check verifies extra passing tests, not test quality; hidden behavioral checks determine functional correctness. No synthetic response is included in live measurements.

[Run-level CSV](runs.csv) · [Structured results](runs.jsonl) · [Summary](summary.json)

![Measured latency, correctness, and token usage](benchmark.png)

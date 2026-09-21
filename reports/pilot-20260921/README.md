# Pilot observations — not a performance conclusion

Models: gpt-6-astra and gpt-5.6-luna, medium. Pi: 0.86.1. Jev: 1.13.0. Sieve: 7d54c8f.

Run dates (UTC): 2026-09-21. See the [frozen manifest](manifest.json) for settings and source identity.

| Workflow | Arm | Success | Stage score | Median seconds (range) | Median total tokens | Jev fallbacks / calls |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| payments | native | 1/1 | 100.0% | 369.3 (369.3–369.3) | 343184 | 0/0 |
| payments | full | 1/1 | 100.0% | 391.2 (391.2–391.2) | 439193 | 0/0 |
| payments | sieve | 1/1 | 100.0% | 357.4 (357.4–357.4) | 352118 | 5/5 |
| payments | luna-native | 0/1 | 80.0% | 214.6 (214.6–214.6) | 190624 | 0/0 |
| payments | luna-sieve | 1/1 | 100.0% | 333.5 (333.5–333.5) | 498612 | 4/5 |

Durations include selection, the main model, and tool execution; setup and external grading are excluded and recorded separately. A fast failed run is not a speedup. Scores weight five stages equally; unrun stages score zero. A provider-error stage can have passing artifact checks without completing the workflow. Speedup ratios additionally require all five Sieve selections to succeed without fallback.

**Post-pilot grading correction:** 4 verdicts were corrected for undocumented representation constraints. Original checks and success flags remain in each run record; checkReviews supplies an auditable overlay. Tables and figures use reviewed scores. [Review evidence and provenance](grading-review.json). Raw scores remain in CSV and summary JSON.

- Astra Sieve vs Astra Native: 0 successful matched pairs; median baseline/Sieve duration ratio N/A.
- Astra Sieve vs Astra Full Context: 0 successful matched pairs; median baseline/Sieve duration ratio N/A.
- Luna Sieve vs Luna Native: 0 successful matched pairs; median baseline/Sieve duration ratio N/A.
- Luna Sieve vs Astra Native (model tradeoff, not isolated Jev effect): 0 successful matched pairs; median baseline/Sieve duration ratio N/A.

**Jev availability limitation:** fallback stages used local keyword selection. These observations cannot establish the benefit of Jev semantic selection. Separate service probes, if present, are excluded from all workflow measurements.

## Token accounting

| Arm | Uncached input | Cached input | Output | Reasoning subset | Jev input / output (observed only) |
| --- | ---: | ---: | ---: | ---: | ---: |
| native | 41294 | 293504 | 8386 | 121 | N/A / N/A |
| full | 357236 | 72960 | 8997 | 116 | N/A / N/A |
| sieve | 276183 | 68096 | 7839 | 54 | N/A / N/A |
| luna-native | 41502 | 140800 | 8322 | 3075 | N/A / N/A |
| luna-sieve | 161775 | 324096 | 12741 | 5409 | 5184 / 731 |

Main-model components are medians; Jev values are sums of available responses. Reasoning is included in output, not added again. Missing usage stays null (shown as N/A); errored requests can leave usage unreported. These are reported token quantities, not a bill. Actual dollar cost is unknown; no subscription-token price is invented.

## Formal-batch estimate

Linear projection: 5.55 hours and 21884772 main-model tokens for 60 workflows (12 times the five-arm payment pilot). This is not a bound or a bill. Early failures shorten the pilot; other workflows, cache behavior, and Jev availability may change usage substantially. Formal execution requires user confirmation.

## Outcomes and failures

- payments-1-full: completed; no failed reviewed checks; 5/5 stages completed. Jev fallbacks: none.
- payments-1-luna-native: provider_error; no failed reviewed checks; 3/5 stages completed. Jev fallbacks: none.
- payments-1-luna-sieve: completed; no failed reviewed checks; 5/5 stages completed. Jev fallbacks: stage 1: timeout; stage 2: timeout; stage 3: timeout; stage 4: timeout.
- payments-1-native: completed; no failed reviewed checks; 5/5 stages completed. Jev fallbacks: none.
- payments-1-sieve: completed; no failed reviewed checks; 5/5 stages completed. Jev fallbacks: stage 1: timeout; stage 2: service_error; stage 3: timeout; stage 4: timeout; stage 5: timeout.

## Limitations

Fictional tasks, two main models, one machine, and a small sample. Server caching and service load are not controlled. Full Context is an explicit all-documents baseline, not native Pi behavior. The added-test check verifies extra passing tests, not test quality; hidden behavioral checks determine functional correctness. No synthetic response is included in live measurements.

[Run-level CSV](runs.csv) · [Structured results](runs.jsonl) · [Summary](summary.json)

![Measured latency, correctness, and token usage](benchmark.png)

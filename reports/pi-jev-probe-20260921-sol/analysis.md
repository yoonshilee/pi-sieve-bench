# Native pi-jev decision comparison

Local exploratory results, 2026-09-21 UTC. Six frozen cases, three repetitions
per mode: 36 new trials compared with 36 preserved historical observations.
Main model: openai-codex/gpt-5.6-sol, medium; Pi 0.86.1; Jev 1.13.0.
Native pi-jev v0.5.0 is pinned at `549c2bf`; harness at `383876a`.
Historical Sieve used the reused-profile implementation at `5031c1a`.
All 36 new Jev requests succeeded, with no fallback, retries, protocol violations,
or selective reruns. All main-model and Jev usage fields were available.

Sources: [manifest](manifest.json), [individual observations](runs.jsonl),
[CSV](runs.csv), [summary](summary.json), and [integrity audit](audit.json).
The historical batch is [preserved separately](../profile-probe-20260921-sol-v05/summary.json).

## Observations

Each row contains 18 trials. Timing starts at the first prompt and ends at the
action sink, including Jev and the main-model handoff. No shell commands execute.
Agreement means matching the authored reference choice, not completing a coding task.

| Workflow | Correct / valid trials | Median seconds (range) | Main-model requests | Main-model total tokens | Jev input / output tokens |
| --- | ---: | ---: | ---: | ---: | ---: |
| Direct Sol, historical | 18/18 | 3.62 (2.63–7.22) | 18 | 24,554 | Not called |
| Sieve profile Score, historical | 18/18 | 10.32 (8.53–17.31) | 36 | 53,096 | 29,016 / 2,088 |
| Native pi-jev Score | 18/18 | 28.05 (26.05–34.93) | 36 | 130,031 | 26,568 / 2,088 |
| Native pi-jev Choice | 18/18 | 13.81 (11.62–21.29) | 36 | 54,472 | 11,070 / 1,470 |

Excluding the two explicit-command negative controls does not change the ordering.
Across the 12 evidence-case trials per group, all choices remain correct and the
median times are 3.75, 10.87, 28.12, and 13.81 seconds respectively.

| Workflow | Uncached input | Cached input | Output | Reasoning subset |
| --- | ---: | ---: | ---: | ---: |
| Direct Sol | 23,850 | 0 | 704 | 102 |
| Sieve profile Score | 43,426 | 7,296 | 2,374 | 145 |
| Native pi-jev Score | 88,454 | 21,504 | 20,073 | 136 |
| Native pi-jev Choice | 41,373 | 7,168 | 5,931 | 0 |

Totals include cached input. Reasoning is already included in output. No cache
writes were reported. These quantities are not a bill; actual dollar cost is
unknown. Main-model and Jev tokens are kept separate because they do not imply
the same price, latency, or computational work.

## Where time went

| Delegated workflow | Jev median seconds | Post-Jev handoff median seconds | Remaining median seconds | Median argument characters |
| --- | ---: | ---: | ---: | ---: |
| Sieve profile Score | 1.74 | 3.27 | 4.48 | 539 |
| Native pi-jev Score | 1.98 | 3.25 | 22.13 | 5,827 |
| Native pi-jev Choice | 2.29 | 3.37 | 8.04 | 1,524 |

The remainder is computed per trial by subtracting Jev and handoff durations
before taking the median. It includes the first main-model request and other
unseparated orchestration. It is not a direct generation-time or reasoning-time
measurement. The three column medians need not add to the overall median.

1. Native Score makes Sol emit eight questions and their repeated rubric. Its
   arguments are about 10.8 times the length of Sieve's profile call, and its
   main-model output is about 8.5 times larger. Jev and handoff durations are
   much closer. This points to the calling interface and argument generation
   as the main source of the observed Score overhead, rather than a uniquely
   slow Sieve implementation.
2. Native Choice is the better fit for this single-choice task. Its matched
   Score/Choice duration ratio has a median of 1.99 across 18 pairs. It uses
   58.1% fewer main-model tokens than native Score. Compared with historical
   Sieve, it sends much less input to Jev, but main-model token totals are
   similar and observed overall latency is higher. This is not a demonstrated
   dollar-cost improvement.
3. Every delegated path still requires Sol to prepare a tool call, wait for
   Jev, and make another request to submit the result. The roughly 3.3-second
   handoff remains even when the main model only forwards the chosen action.
   Swapping plugins does not remove that round trip.
4. Direct Sol already matches every reference answer. These short, authored
   cases offer no observed accuracy headroom. They do not establish whether
   delegation helps a harder classification task, a larger candidate set, or
   a controller that constructs and dispatches decisions without an LLM round trip.

## Limits

Historical controls ran in a different time block. Provider load and cache state
were not controlled. Tool schemas, result payloads, and initial prompt layout
differ: Sieve can refer to a reusable profile; native pi-jev must receive questions
inline. Native Score serializes the same instructions as strings instead of
Sieve's structured objects. Choice changes the decision primitive as well.
These are native workflow comparisons, not isolated plugin overhead measurements.

This only tests `jev_evaluate`; automatic routing, guards, compaction, and agents
were disabled. Arguments were supplied and checked exactly, and the main model
was required to forward the result without semantic reranking. Internal cognition
was not measured. No production 1.5-second timeout claim follows from the shared
10-second benchmark deadline. No full workflow, new chart, public README
performance update, push, or release follows from these local observations.

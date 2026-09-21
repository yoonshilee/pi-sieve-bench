# On-demand retrieval comparison

One payments workflow per condition, five consecutive stages. Pi 0.86.1; openai-codex/gpt-6-astra; medium; Jev jev-1.13.0; Sieve ba996c7bfceddbee6fa75e03a8f4a323052e8d3c.

Run dates (UTC): 2026-09-21. [Frozen manifest](manifest.json).

Both conditions load the same plugin and fixed tool schema. Local uses /sieve off; Jev uses /sieve on. Each stage explicitly requests the same fixed retrieval query before the same coding task; additional reads are allowed. The query requirement measures a controlled retrieval workflow, not spontaneous tool adoption. The shared project config uses a 10-second Jev timeout, not the 1.5-second production default. Initial file hashes must match.

## Observed result and failure review

This pair did not show a speed or quality benefit from Jev. Local retrieval took
350.412 seconds and Jev retrieval took 390.522 seconds (+11.4%). Main requests
were 33 and 34; total main tokens were 487,245 and 488,855 (+0.3%). Jev reduced
returned search-result characters (including headings and formatting) by 14.2%
and uncached main input by 20.6%, while
adding 17,453 input and 2,490 output Jev tokens. Actual charges are unknown.

All five Jev responses had HTTP 200 and valid selections, without fallback. The
median search duration was 2,318 ms, compared with 36 ms locally. Total search
duration was 13,622 ms versus 168 ms; the full 40.110-second workflow difference
cannot be attributed to retrieval alone. No extra live attempts were run.
Response-header latencies were 1,520-4,668 ms in this batch; these successful
10-second-timeout observations do not establish availability at the 1.5-second
production timeout.

Local returned all frozen necessary references. Jev omitted `gateway-failures`
at stages 3 and 5, yielding 90% mean first-search recall. Related retry checks
still passed. These recall observations do not prove which references the model
used or whether later reads compensated.

Jev failed `invalid-event-no-mutation` at stages 4 and 5. The final implementation
accepted a whitespace-only callback charge ID and added an event and receipt;
the local implementation rejected it without mutation. Both necessary callback
references were returned in stage 4. The fixture says **nonempty** without
explicitly requiring trimming, while the frozen grader expects **nonblank**.
This is a benchmark specification ambiguity, not evidence that Jev caused the
defect. The recorded checks are unchanged. The [offline reproduction](failure-analysis.json)
includes the probe, source hashes, and observed state; it made no model calls.

The experiment source hash was verified unchanged after both runs. The recorded
harness commit is `e632afd`; subsequent changes only stabilize report row order
and include these interpretation notes. No task, model output, scorer, or raw
measurement was altered. This is one pair on one fictional project, with local
first, uncontrolled service conditions, and no successful pair for a speedup
ratio. It does not establish statistical significance or general performance.

| Condition | Success | Stage checks | Seconds | Main requests | Retrieval calls | Main tokens | Jev fallbacks / requests |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| retrieval-local | 1/1 | 100.0% | 350.412 | 33 | 5 | 487245 | 0/0 |
| retrieval-jev | 0/1 | 97.3% | 390.522 | 34 | 5 | 488855 | 0/5 |

## Usage and retrieval

| Condition | Uncached input | Cached input | Output | Cache share of input | Jev input / output | First-search required recall | Returned characters |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| retrieval-local | 38539 | 440704 | 8002 | 92.0% | N/A / N/A | 100.0% | 13223 |
| retrieval-jev | 30615 | 449536 | 8704 | 93.6% | 17453 / 2490 | 90.0% | 11350 |

Successful matched pairs with valid retrieval: 0. Local/Jev duration ratio: N/A. Ratios are not reported for failed workflows, missing or nonmatching first retrieval, or Jev fallback.

## Stage outcomes

| Condition | Stage | Status | Checks | Seconds | Search reasons |
| --- | ---: | --- | ---: | ---: | --- |
| retrieval-local | 1 | completed | 3/3 | 54.030 | disabled |
| retrieval-local | 2 | completed | 6/6 | 73.915 | disabled |
| retrieval-local | 3 | completed | 10/10 | 80.159 | disabled |
| retrieval-local | 4 | completed | 14/14 | 69.412 | disabled |
| retrieval-local | 5 | completed | 16/16 | 72.896 | disabled |
| retrieval-jev | 1 | completed | 3/3 | 69.014 | none |
| retrieval-jev | 2 | completed | 6/6 | 81.242 | none |
| retrieval-jev | 3 | completed | 10/10 | 89.178 | none |
| retrieval-jev | 4 | completed | 13/14 | 78.280 | none |
| retrieval-jev | 5 | completed | 15/16 | 72.808 | none |

## Interpretation limits

This is one paired observation on a fictional payments project, not statistical evidence of a repeatable gain. Local runs first; order, provider cache reuse, service load, and model trajectories are uncontrolled. A new session does not clear server caches. Timing includes retrieval, model work, and tools; initialization and independent grading are excluded. Both modes retain stable tools and ordinary append-only results. Reported cache tokens are not direct measurements of KV-cache internals.

Required-reference recall is the mean of five stage recalls from the first search result, based on frozen reference names. It measures returned references, not whether the model used them or read them later. Independent hidden checks determine task correctness. Missing stages score zero; failures and fallback are retained without selective reruns. Characters are not tokens. Reasoning tokens are included in output. Usage not returned by a provider is null; partial totals may undercount failed requests. Actual monetary charges are unknown.

[CSV](runs.csv) · [JSONL](runs.jsonl) · [Summary](summary.json)

![Paired on-demand retrieval observations](benchmark.png)

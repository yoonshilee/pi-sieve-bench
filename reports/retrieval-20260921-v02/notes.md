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

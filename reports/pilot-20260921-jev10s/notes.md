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

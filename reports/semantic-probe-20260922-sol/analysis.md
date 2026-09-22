# Semantic observation comparison

Exploratory experiment, originally run locally and subsequently approved for
GitHub publication with sanitized results. No established performance claim or
new chart accompanies publication. The frozen manifest retains the publication
policy that applied when the experiment was executed.

## Frozen method

Compare two uses of the same real `sieve_inspect` extension tool:

- **Main:** inspection returns original observations without calling Jev. Sol applies the rubric.
- **Jev:** inspection reads the same observations and makes one real Choice batch internally. Sol returns the resulting labels unchanged.

Both arms use Pi 0.86.1, `openai-codex/gpt-5.6-sol`, medium reasoning, identical
tool definitions, system instructions, task prompts, files, and label criteria.
The only treatment is enabled semantic inspection. Jev is `jev-1.13.0`.
The main model supplies only the source name and mode; it does not rewrite source
text or generate repeated question definitions. Neither arm uses keyword rules
as a substitute for semantic interpretation.

There are two fictional workflows: operation outcomes and evidence relationships.
Each has three sequential stages with eight independent observations, including
unresolved outcomes, partial effects, complete rollbacks, notification failures,
duplicate notifications without duplicate writes, speculation, and irrelevant
evidence. This gives 48 distinct authored observations, 12 workflow runs, 36
stages, and 288 label judgments across both arms. Three repetitions do not create
new independent tasks. Exact reference labels are stored only in the external
scorer; workspaces, main-model prompts, and Jev requests contain no answer key.

The questions classify each observation independently. They do not infer a
global root cause, combine evidence across records, execute commands, or prove
that a coding task is complete. "Workflow success" here means all 24 labels
match the authored references with valid protocol and output across all three
stages. Missing stages remain in the planned accuracy denominator. A fallback
can produce correct main-model labels but is not a successful Jev comparison pair.

Each run starts a new isolated in-memory Pi session and preserves it between
stages. No user extensions, skills, memories, project instructions, or unrelated
tools load. Credentials use Pi's resolver and are not copied into workspaces.
Runs execute serially with arm order alternating by workflow and repetition.
Provider caches and service load cannot be reset or controlled.

Timing includes each user prompt, main-model tool argument generation, file
reading, Jev evaluation when enabled, and the final main-model JSON response.
Initialization and independent grading are recorded separately. Expected topology
is two main-model calls per stage in both arms. This tests avoided interpretation
and input volume, not removal of a model round trip.

Limits are 90 seconds and three main-model requests per stage, one inspection per
stage, and no automatic retry. Jev uses an explicitly disclosed 10-second timeout
to measure completed semantic judgments; the plugin's production default remains
1.5 seconds. Model failures stop the run; existing completed or interrupted runs
are never overwritten. Three consecutive provider-failed runs pause the batch.

Request measurement stores byte counts and prefix/settings equality only, never
provider payloads or reasoning. Input-message hashes stay in memory. Record
uncached input, cached input, output and available reasoning tokens separately;
reasoning is already part of output. Missing usage stays null. Jev tokens remain
separate from main-model tokens. Actual monetary charges are unknown.

## Reproduction

Use the local Sieve checkout at the exact commit in `manifest.json`, alongside
this repository. Both recorded commits are available in their GitHub histories.
With Pi credentials already configured, use a new batch name for a live rerun:

```sh
npm run check
npm run probe:semantic -- semantic-probe-new-001
npm run report -- semantic-probe-20260922-sol
```

The same batch name resumes only unstarted runs with unchanged source. The report
command regenerates JSON and CSV solely from stored records, without model calls.
`manifest.json` pins code, versions, limits, schedule, and source fingerprint;
`runs.jsonl` and `stages.csv` retain individual sanitized measurements.

## Interpretation limits

This is a small semantic-component experiment on authored English observations,
not an end-to-end coding benchmark. All observations have a narrow interpretation
contract; the benchmark does not charge for constructing that contract or an
upstream tool that produces the JSON files. Both costs would matter in adoption.
Cases are balanced across labels and have not been independently human-adjudicated.
No performance conclusion transfers automatically to arbitrary logs, longer
histories, another model, the production deadline, or open-ended planning.

The post-run results and failure analysis below do not change the
frozen tasks, reference labels, protocol, or implementation.

## Observed results

All 12 runs and 36 stages completed with valid protocol and output. All 18 real
Jev requests succeeded without fallback or retry. Every stage used exactly two
main-model requests. Sieve was pinned to `7388f9f`; harness to `f4559a2`.
The measured run time totaled 342.385 seconds, with 136 ms of separate initialization.

| Workflow | Arm | Strict workflow success | Label agreement | Median seconds (range) | Main requests | Main total tokens |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| Operation outcomes | Main interpretation | 3/3 | 72/72 | 28.50 (23.47–28.93) | 18 | 31,668 |
| Operation outcomes | Jev inspection | 3/3 | 72/72 | 28.13 (26.45–29.12) | 18 | 25,270 |
| Evidence relationships | Main interpretation | 3/3 | 72/72 | 30.71 (28.06–34.08) | 18 | 32,092 |
| Evidence relationships | Jev inspection | 0/3 | 69/72 | 28.64 (25.35–30.95) | 18 | 25,458 |

Main-model token totals include cached input. Values are totals across three runs,
not per-run averages. Strict success requires all 24 labels in a run to match.

| Workflow / arm | Uncached input | Cached input | Output | Reported reasoning subset | Jev input / output |
| --- | ---: | ---: | ---: | ---: | ---: |
| Operation outcomes / Main interpretation | 15,531 | 15,104 | 1,033 | 265 | Not called / Not called |
| Operation outcomes / Jev inspection | 11,330 | 13,184 | 756 | 0 | 21366 / 3393 |
| Evidence relationships / Main interpretation | 19,013 | 11,776 | 1,303 | 493 | Not called / Not called |
| Evidence relationships / Jev inspection | 12,634 | 12,032 | 792 | 0 | 20739 / 3756 |

### What improved

Across both workflows, main-model total tokens fell from 63,760 to 50,728
(**20.4% lower**). Uncached input fell from 34,544 to 23,964 (**30.6% lower**),
and output from 2,336 to 1,548 (**33.7% lower**). Reported reasoning tokens were
758 versus zero, already included in output; this is usage metadata, not a
measurement of private cognition. Tool-result characters fell from 33,951 to
10,508 (**69.0% lower**), and aggregate main-model request bytes from 380,364 to
259,447 (**31.8% lower**). These are observable reductions in material processed
by the main model, without introducing an extra main-model turn.

Jev separately consumed **42,105 input and 7,149 output tokens**. Different
providers' tokens are not interchangeable prices. No reduction in actual charges
is established, especially for a subscription-backed main model.

### Why this is not an established speed improvement

For operation outcomes, all three pairs are correct. Their direct/Jev timing
ratios are 0.806, 1.094, and 1.013: the paired median is **1.013x** (n=3).
Jev was slower in the first repetition and faster in the next two. Median
workflow time is only 1.3% lower; total time across those three repetitions is
actually 3.5% higher. This small, variable result does not establish a useful
latency gain.

Evidence inspection has a lower observed median time but zero strictly successful
Jev runs, so there are **no eligible successful timing pairs** for that workflow.
Do not describe its timing difference as equivalent-accuracy acceleration.

Jev evaluation had a median of 1,165 ms and added 22,362 ms across 18 calls.
The main model still needs its ordinary tool request and final response in both
arms. The raw observations are short enough for Sol to classify accurately;
reducing their interpretation and input costs has not consistently outweighed
the additional Jev wait and provider variability. Subtracting Jev duration would
be a counterfactual arithmetic exercise, not a measurement of another design.

### Repeated evidence-label boundary disagreement

All three strict errors concern the same tutorial observation in stage 3, item 7.
It explains idempotency in general without reporting what this operation actually
did. The frozen reference is `unrelated`; Jev returns `insufficient`. Sol forwards
that result unchanged. Every other Jev label matches its reference.

The rubric distinguishes a different subject from insufficient evidence about
the subject, but does not fully define whether subject means the general topic
or the particular operation. Jev's alternative is defensible under the topical
reading. This exposes a contract/annotation boundary, not a fabricated support
claim or a demonstrated inability to recognize missing proof. The strict 69/72
and 0/3 scores remain unchanged. No incorrect support or contradiction label
occurred. As a post-hoc sensitivity check only, merging the two non-decisive
labels yields 72/72; this does not replace the frozen scoring or admit timing pairs.
See [failure analysis](failure-analysis.json).

### Cache and deadline observations

All observed earlier input-message prefixes and fixed request settings remained
unchanged within their sessions. Both arms reported cached input. The records
provide no evidence that the new tool disrupted existing request prefixes; they
do not prove cache hits were optimal or eliminate provider routing variation.

One Jev evaluation took 2,561 ms, above the production 1,500 ms deadline; the
other 17 were below it. The zero-fallback result under the disclosed 10-second
limit must not be presented as zero fallback under default production settings.

### Decision

The new interface removes the old unnecessary scoring handoff and demonstrates
that batch semantic interpretation can reduce main-model input and reported
output use. It does not yet establish a meaningful speed or monetary-cost gain.
Keep this capability opt-in for existing approved observation batches. Clarify
subject scope before a future evidence experiment, then freeze new cases rather
than changing this batch's labels after seeing the answers.

[Summary JSON](summary.json), [individual JSONL](runs.jsonl), [stage CSV](stages.csv),
and [integrity audit](audit.json) retain the measurements. Offline tests passed;
resume verification preserved all 12 run files and made zero network requests.

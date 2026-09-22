# Pi Sieve Bench

A public collection of workflow and semantic-component comparisons for
[Pi Sieve](https://github.com/yoonshilee/pi-sieve).
All projects and reference data are fictional. This repository contains no shared
credentials. Live runs consume the operator's own model and TypeSafe allowance.

This repository contains the complete experimental setup, results, failure
analysis, and sanitized run data. **All results are exploratory; the planned formal
long-workflow batch has not been run.** The latest experiment evaluates v0.6
semantic inspection at `7388f9f`. Earlier decision, retrieval, and five-arm context
filtering experiments retain their original protocols and are kept separate.
Historical visualizations remain archived diagnostics.

[Latest semantic comparison](#semantic-observation-comparison-v06) · [Native pi-jev comparison](#native-pi-jev-comparison) · [Historical setup](#historical-five-arm-experiment) · [Reproduction](#setup-and-commands)

New on-demand experiments use **openai-codex/gpt-5.6-sol, medium**. Saved Astra
and Luna measurements retain their original model identities. Changing the model
requires a new batch ID. Earlier experiments are archival diagnostics, excluded
from future release performance claims. Publishing the saved results does not
establish a speed or cost benefit. No new charts or live runs accompany publication.
Frozen manifests retain their execution-time publication policy; the saved code
and sanitized results were subsequently approved for GitHub publication.

## Semantic observation comparison (v0.6)

The latest experiment compares two modes of the same `sieve_inspect` tool. In
**Main interpretation**, the tool returns raw observations and Sol labels them.
In **Jev inspection**, the tool sends one Choice batch and Sol forwards its labels
unchanged. Both modes use identical files, prompts, label criteria, permissions,
and fixed tool definitions. Neither mode changes earlier messages or capabilities.

Pi is pinned to 0.86.1, the main model to `openai-codex/gpt-5.6-sol` with medium
reasoning, and Jev to `jev-1.13.0`. The measured plugin commit is `7388f9f` and
the harness commit is `f4559a2`. Two fictional workflows each contain three
sequential batches of eight observations. Three alternating, serial repetitions
per arm yield **12 runs, 36 stages, and 288 judgments over 48 distinct cases**.
Each run has a fresh session, retained across its three stages. Reference labels
stay outside the model workspace; failures remain in the saved results.

| Workflow | Arm | Strict run success | Label agreement | Median seconds (range) | Main requests | Main total tokens |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| Operation outcomes | Main interpretation | 3/3 | 72/72 | 28.50 (23.47–28.93) | 18 | 31,668 |
| Operation outcomes | Jev inspection | 3/3 | 72/72 | 28.13 (26.45–29.12) | 18 | 25,270 |
| Evidence relationships | Main interpretation | 3/3 | 72/72 | 30.71 (28.06–34.08) | 18 | 32,092 |
| Evidence relationships | Jev inspection | 0/3 | 69/72 | 28.64 (25.35–30.95) | 18 | 25,458 |

Strict success requires all 24 labels in a run to match. Token and request counts
are totals across three runs, including cached input. Main-model tokens fell
from **63,760 to 50,728 (20.4%)**, while Jev added **42,105 input and 7,149 output
tokens**. Actual charges are unknown, so this is not evidence of monetary savings.
Both arms still used two main-model requests per stage. Outcome paired speedup
was only **1.013x (n=3)**, with mixed per-repeat results and a 3.5% increase in
aggregate time. Evidence has no strictly successful matched timing pairs.
**No stable latency benefit was established.**

All three evidence disagreements concern the same tutorial observation:
`unrelated` in the reference versus Jev's `insufficient`. The rubric leaves the
subject boundary ambiguous; strict scores remain unchanged. No erroneous support
or contradiction label occurred. All 18 real Jev calls completed without fallback
under a **10-second experimental timeout**. One took 2.561 seconds, exceeding the
unchanged 1.5-second production default. Earlier message prefixes and fixed request
settings remained unchanged in observed sessions; provider cache behavior is not
fully controlled.

This measures a semantic component, not completed coding work. Observation-file
production and rubric authoring are excluded. Small authored cases, repeated
inputs, a single main model, label ambiguity, and provider variability limit
generalization. Time includes the prompt, tool invocation, Jev, and final response;
initialization and independent grading are separate. Limits are 90 seconds and
three main requests per stage, with no automatic retries or selective reruns.

Read the [full method and failure analysis](reports/semantic-probe-20260922-sol/analysis.md).
Saved data: [manifest](reports/semantic-probe-20260922-sol/manifest.json),
[per-run JSONL](reports/semantic-probe-20260922-sol/runs.jsonl),
[stage CSV](reports/semantic-probe-20260922-sol/stages.csv),
[summary](reports/semantic-probe-20260922-sol/summary.json), and
[integrity audit](reports/semantic-probe-20260922-sol/audit.json).

```sh
# Regenerate the published report offline; no model credentials are needed.
npm run report -- semantic-probe-20260922-sol
# Start a new live batch only after configuring Pi credentials and ../pi-sieve.
npm run probe:semantic -- semantic-probe-new-001
```

Keep a clean Sieve checkout beside this repository. The harness records both
commits and its source fingerprint; resume preserves existing attempts. Use the
recorded commits to reproduce the measured implementation. Offline CI checks the
real Pi SDK with mocked responses; those tests are not live performance evidence.

## Native pi-jev comparison

`npm run probe:pi-jev -- pi-jev-probe-local-001` runs the same six frozen
decision cases three times per native mode: **36 new trials**. It loads the
unmodified [pi-jev extension](https://github.com/TheoOliveira/pi-jev/tree/549c2bfa249269d0f5590658b5743801c47af369)
at `549c2bf` (v0.5.0, TypeSafe SDK 0.6.0), using Pi 0.86.1 and Sol medium.
Only `jev_evaluate` and the same action sink are available. Automatic routing,
tool guarding, agents, and compaction are disabled.

- **Score:** eight native Score questions reuse the exact candidate commands,
  question, and three-level rubric. The main model copies the frozen arguments,
  then forwards the maximum-score candidate; ties follow input order.
- **Choice:** one native Choice question contains the same options and rubric.
  The main model forwards the returned ID and command without semantic reranking.

Neither native mode has Sieve's profile shortcut. Questions are supplied once in
the initial prompt and must be emitted as tool arguments. Native pi-jev returns
full answer objects; Sieve returns a selected candidate. These are comparisons of
native calling workflows, **not isolated plugin speed**. Choice also changes the
decision primitive. The shared cases, factual context, correct answers, main model,
reasoning level, three repeats, 90-second limit, four-request cap, and action-sink
timing match the previous probe. Commands are recorded, not executed.

The observer checks outbound arguments exactly, pins `jev-1.13.0`, validates
responses, captures only usage and timing, applies the same 10-second Jev deadline,
and blocks additional outbound attempts. Native SDK error backoff may still occur
and is counted; no source patch disables it. Native Pi credentials are passed to
pi-jev through an ephemeral environment key. SDK logging is disabled and the API
root is fixed. The observer restores the environment and fetch on exit. This
process-wide observer requires serial runs.

The new batch is compared with the preserved `profile-probe-20260921-sol-v05`
direct and Sieve trials. Controls ran in a **different time block**; service load
and provider caching cannot be controlled or inferred away. The manifest records
their data hash. All failed and interrupted attempts remain; resume never repeats
them. `npm run report -- <batch>` generates JSON/CSV offline without charts or
model calls. Comparisons require correct, protocol-valid matched cases; missing
usage stays null, reasoning is a subset of output, and actual dollar cost remains
unknown. Published results are archival diagnostics, not release performance claims.

## Reused-profile decision probe (v0.5)

The first gate isolates one decision instead of rerunning long workflows. Six
fictional cases use the same frozen eight-option profile and rubric. Two routine
cases explicitly request a command; four evidence cases distinguish payment
concurrency, tenant caching, date boundaries, and retry persistence. They each
run three times with direct Sol and Sol delegating to Jev: **36 trials**.

Both arms use Pi 0.86.1, openai-codex/gpt-5.6-sol, medium reasoning, identical
fixed tool definitions, candidates, and facts. The direct arm selects an option.
The delegated arm calls the real plugin with a profile name and supplied facts,
then submits the returned ID and content unchanged. Candidates and rubric are
not regenerated. One-time human profile authoring is outside the measurement; this
probe represents reuse, not creation of a new profile for every task. Expected IDs are authored synthetic reference choices, excluded
from model inputs; correctness is selection agreement, not solved coding tasks.

The action sink validates the chosen command but **does not execute a shell
command**. Time runs from the first prompt to that sink, including Jev and the
main-model handoff. Initialization and a final acknowledgement are excluded; the
session aborts at the measured endpoint. Main-model tokens, request counts, Jev
usage, selection latency, handoff delay, protocol violations, and errors are saved.
Raw prompts, model reasoning, and provider error bodies are not saved. Token
counts are not charges; actual USD cost remains unknown.

Routine cases are negative controls: forcing delegation in this probe measures
its floor cost, not the production calling policy. The four evidence cases still
have short, authored facts and cannot establish general decision quality. Every
trial uses a fresh session; pairs alternate order, serially, with no retries.
Provider cache state cannot be reset. Each trial is limited to 90 seconds and four
main-model requests. Jev has a 10-second deadline; production remains at 1.5 seconds.

**Frozen exploratory gate:** all 12 evidence pairs must produce correct, valid
choices, and the median paired delegated time must be at least 10% lower than
direct Sol. Otherwise do not spend on another full workflow batch. Passing this
gate only warrants a workflow trial; it does not prove speed or cost savings.

```sh
npm run check
npm run probe -- profile-probe-local-001
```

Keep the exact clean plugin commit pinned by `SCORING_COMMIT` adjacent at
`../pi-sieve`. Native Pi credentials resolve normally. Results and the frozen
manifest go to `reports/<batch>/`; resumption preserves all existing attempts,
including failed or interrupted ones. Published results preserve the original
protocol and do not establish a release performance claim.

## Adaptive workflow comparison (v0.5)

The workflow entry point now allows zero Jev calls. Sol delegates only substantial
comparisons and prefers the known payment-diagnostic profile when applicable.
Explicit commands, routine tests, and obvious steps execute directly. Both arms
have the same files, references, tools, and profile. The benchmark reports the
actual delegation count; zero calls do not demonstrate Jev benefit. Selected
commands are checked against the first subsequent Bash call and must have been
generated after the Jev response. Hidden stage grading remains unchanged.

Run `npm run score -- adaptive-local-001` only after the decision gate warrants a
full batch. It retains five continuous payment stages, three alternating paired
repeats, 5-minute/30-request stage limits, and no grading feedback or selective
reruns. Results from v0.3 advisory scoring and v0.4 forced per-stage delegation
remain archival, with their original manifests and source commits; current
summaries must not be used to reinterpret those historical protocols.

## Historical five-arm experiment

| Setting | Fixed value |
| --- | --- |
| Pi SDK | 0.86.1 |
| Main models | openai-codex / gpt-6-astra and gpt-5.6-luna |
| Reasoning | medium |
| Sieve commit | 7d54c8f2865d81113688e40b79abcef2956f6a32 |
| Jev | jev-1.13.0 |
| Sieve settings | 10-second timeout; published defaults for 40 candidates, 6 documents, 8,000 characters, and thresholds |
| Limits | 5 minutes and 30 main-model requests per stage |
| Formal design | 4 workflows × 5 arms × 3 repetitions = 60 runs / 300 stages |
| Pilot | Payments only, one complete run per arm; excluded from formal results |

| Arm | References | Skills and extension tools |
| --- | --- | --- |
| Native | Shared index; read bodies on demand | All available |
| Full | All 28 memory/guide bodies temporarily injected on every model turn | All available; skill bodies remain on demand |
| Sieve (Astra) | Real pinned plugin and real Jev selection | Real filtering and `sieve_search` recovery |
| Luna Native | Same on-demand baseline with gpt-5.6-luna | All available |
| Luna Sieve | Same real Sieve treatment with gpt-5.6-luna | Real filtering and recovery |

Each fixture has 20 memories, 8 command guides, 6 skills, and 6 read-only tools.
All arms receive the same index, starting files, user instructions, credentials,
reasoning settings (with model identity explicitly varied by arm), deterministic tool data, and sandboxed built-in tools. Mandatory
project instructions are never filtered. Full is an explicit all-context
baseline, not a claim about default Pi behavior. Only the Sieve arms have their recovery tool;
that is part of the treatment being measured.

## Workflows

| Workflow | Five stages | Independent acceptance |
| --- | --- | --- |
| Payments | Reproduce → sequential idempotency → concurrency → callbacks → regression | No duplicate charges, conflict rejection, recoverable failures, receipt uniqueness |
| Tenant API | Inspect → isolation → cursors → legacy compatibility → regression | Tenant boundaries, stable pages, projection, complete legacy results |
| Reconciliation | Inspect → CSV/money → UTC/deduplication → reporting → incremental re-import | Exact cents, CSV dialect, date boundaries, deterministic counts and totals |
| Incident | Evidence → retry policy → worker → downstream deduplication → report | Bounded retries, permanent errors, actual evidence IDs, independent request keys |

The agent keeps the same session and changes through all five stages. Hidden
behavioral checks run after each stage without exposing results to the agent.
The last stage repeats all relevant behavioral checks. A workflow succeeds only
if all five stages finish normally and every final check passes. Stage scores are
averaged with equal weight; missing stages score zero. Reference solutions and
intentionally broken starters validate the graders offline; they are never given
to the live model.

## Setup and commands

Live execution currently requires macOS, `sandbox-exec`, Node 22.19+, Python 3.9+,
Pi credentials for the pinned main model, and TypeSafe configured through Pi's
`/login typesafe` or `TYPESAFE_API_KEY`. Existing native Pi credential resolution is
reused; do not copy auth files into this repository. Other user packages, skills,
context files, and model configuration are not loaded.

```sh
npm ci --ignore-scripts
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
npm run check
npm run pilot -- --batch pilot-001
npm run report -- pilot-001
```

Inspect the five-run pilot and its projected use before authorizing formal work.
**The implementation does not launch the formal batch automatically.** After the
user explicitly confirms it:

```sh
npm run run -- --confirmed --batch formal-001
npm run report -- formal-001
```

Use the same batch ID to resume unstarted runs. Recorded attempts are preserved,
including failures. An interrupted in-progress attempt is marked interrupted,
not silently retried. Source changes invalidate resumption; use a separately
identified experiment for revised code. Three consecutive main-model provider
failures pause a batch. Jev failures remain ordinary Sieve fallback observations.
No automatic model retries or context compaction are enabled. Server-side cache
behavior cannot be reset; order rotates all five arms across the twelve workflow/repetition blocks. Runs are serial.

## Measurements and saved data

Every batch has a frozen manifest, one JSON record per run, generated JSONL/CSV,
a summary, a Markdown report, and PNG/SVG plots. Request payloads are measured in
bytes and discarded; reference context is measured in characters. Neither measure
is labeled as tokens. Model usage is accumulated only from completed assistant
messages, with reasoning treated as a subset of output, not added twice. Missing
usage is null. Jev usage is observed from a response clone; its request is neither
modified nor retried. `/sieve status` supplies fallback and selection diagnostics.

Measured stage time includes selection, model work, and tools. Initialization,
external grading, and between-stage reporting are recorded separately or excluded.
All run times are shown with success counts. Speedup ratios use successful matched
workflow/repetition pairs only, with all five Jev selections successful in the Sieve arm; fallback runs cannot become Jev speedup claims.
Small sample ranges and individual points are shown, without a statistical
significance claim. Token quantities are not invoices; subscription pricing and
missing Jev usage prevent a trustworthy dollar total.

The Pi Sieve README shows a compact, explicitly preliminary pilot figure and links
here for methods, results, and limitations. Figures and sanitized data are public
in this repository. Pilot observations remain separate from any future confirmed
formal batch and do not establish general performance gains.

Charts use Matplotlib's sketch styling, bundled Caveat titles, and Comic Neue
labels, legends, and numbers. The fonts are distributed under the SIL Open Font
License: [Caveat](assets/fonts/OFL.txt) and [Comic Neue](assets/fonts/ComicNeue-OFL.txt).
Comic Neue Regular and Bold are unmodified files from
[Google Fonts at e44c4b0](https://github.com/google/fonts/tree/e44c4b011a820c2cbe2fd2cfa8052037d7edb571/ofl/comicneue);
Caveat comes from [5571d84](https://github.com/google/fonts/tree/5571d84c0d8c70ec1af4f64072d8c5cf1e4e9643/ofl/caveat).
Rendering is offline. Heatmap cells use pale green for all checks passed, amber
for partial passes, and pink for zero or unrun stages. Styling does not change
any measurements.

## On-demand retrieval comparison

The historical runner and five arms remain pinned to v0.1. A separate comparison
loads v0.2 at `ba996c7` under both conditions: `retrieval-local` uses `/sieve off`,
and `retrieval-jev` uses `/sieve on`. Both retain the same tool definition, initial
files, six skills, six extension tools, and 28 references. The main model is
`openai-codex/gpt-5.6-sol` with medium reasoning for new batches. The saved
2026-09-21 pair used Astra.
The historical `pilot` and `run` commands retain the original Astra/Luna design
for reproduction and are separate from this current comparison.

```sh
npm run compare -- retrieval-001
npm run report -- retrieval-001
```

This command makes **two live five-stage payments runs**, local first and Jev
second. Each stage explicitly requests a frozen query before the original task;
additional reads remain available. This measures a controlled retrieval workflow,
not whether the model spontaneously chooses the tool. It uses the shared 10-second
benchmark timeout, not the 1.5-second production default. It does not launch a
formal batch or retry failed workflows. Existing run records are preserved.

The manifest freezes queries and necessary-reference names before execution.
Search results record reason codes, counts, duration, names, and character volume;
no reference body or raw request is saved. Query equality is recorded as a boolean.
First-search recall is measured against stage-specific necessary references and
is separate from independent task correctness. Reports include main requests,
uncached/cached input, output, Jev usage, and complete workflow time. A successful
speed pair requires both tasks to pass and every stage to retrieve successfully.
Provider caches and execution order remain uncontrolled. One pair cannot establish
statistical significance; tokens are not actual monetary charges.

## Privacy and repository checks

The SDK reads native credentials in the controller. Agent shell processes receive
an allowlisted environment, no model credentials, no network access, and no access
to home-directory files outside their own workspace or the Node runtime. File tools
reject paths outside the workspace. References are read-only. The external grader
is sent to a separate process after agent work; it is not placed in the task files.

`.work/`, `.local/`, `.venv/`, environment files, and raw logs are ignored. Saved
records contain allowlisted metrics, check IDs, and final text only; private paths
are replaced. Requests, provider error bodies, authentication headers, and thinking
content are never saved. PNG files are generated plots; textual records and Git
history are scanned for secrets and private identity. This benchmark does not
perform deployments or external tool actions.

Configure repository-local public Git identity and enable `.githooks` before
committing. Run `npm run check`, `node scripts/check-privacy.mjs --history`, and
`gitleaks git --log-opts=--all --redact --no-banner --log-level error .`.
CI performs offline checks and plot generation without real credentials.

## File map

- `src/fixtures.ts`: starting projects, fixed prompts, references, and tool data.
- `src/runner.ts`, `sandbox.ts`, `grade*.ts`: real sessions, guarded tools, and independent graders.
- `src/metrics.ts`, `report.ts`, `cli.ts`: records, summaries, batch execution, and resumption.
- `test/`: known-good and broken implementations, SDK checks, and measurement checks.
- `reports/`: sanitized measured outputs; no live workspace copies.

## Results

No formal benchmark has been run. The v0.2 pair and historical v0.1 pilots below
are separate experiments and must not be pooled.

### On-demand retrieval: 2026-09-21, v0.2

**This pair did not show a speed or task-quality gain from Jev selection.** Both
conditions used Astra medium, identical starting files and fixed queries, five
stages, and the same Sieve tool. All five Jev calls returned HTTP 200 and valid
selections, with zero fallbacks. The benchmark used a 10-second timeout; the
production default remains 1.5 seconds.

| Metric | Local retrieval | Jev retrieval |
| --- | ---: | ---: |
| Workflow success under frozen grader | 1/1 | 0/1 |
| Mean stage acceptance | 100.0% | 97.3% |
| Workflow seconds | 350.412 | 390.522 |
| Main-model requests | 33 | 34 |
| First-search required-reference recall | 100.0% | 90.0% |
| Returned search-result characters | 13,223 | 11,350 |
| Median retrieval milliseconds | 36 | 2,318 |
| Uncached main input tokens | 38,539 | 30,615 |
| Cached main input tokens | 440,704 | 449,536 |
| Main output tokens | 8,002 | 8,704 |
| Total main tokens | 487,245 | 488,855 |
| Jev input / output tokens | N/A | 17,453 / 2,490 |

Jev took 40.110 seconds longer (+11.4%), returned 14.2% fewer search-result characters
(including headings and formatting), and
used 20.6% less uncached main input. It did not reduce main requests or total main
tokens (+0.3%). Retrieval added about 13.5 seconds in total; the remaining elapsed
difference includes different model/tool trajectories and service variation.
Both conditions retained high reported input cache shares (92.0% and 93.6%);
this is not a direct KV-cache measurement or evidence of a causal cache benefit.
Actual dollar charges are unavailable, and the extra Jev use prevents treating
reduced uncached input alone as a cost-saving result.

The Jev run failed `invalid-event-no-mutation` in stages 4 and 5: it accepted a
whitespace-only callback charge ID and mutated state. Both required callback
references were returned. **The reference says "nonempty" without explicitly
requiring trimming, while the frozen grader expects "nonblank".** This ambiguity
limits the quality comparison; original verdicts are retained, and the failure
cannot be attributed to Jev from this pair. The `gateway-failures` reference was
omitted at stages 3 and 5, although related retry checks passed.

There is no successful matched pair for a speedup ratio. One pair, local first,
cannot establish statistical significance; provider caches, order, and model
trajectories were not controlled. This result suggests that the already effective
local retrieval in this small fixture left little room for Jev to save work.
No additional model runs were used to select a better outcome.

[Complete retrieval report](reports/retrieval-20260921-v02/README.md) · [CSV](reports/retrieval-20260921-v02/runs.csv) · [JSONL](reports/retrieval-20260921-v02/runs.jsonl) · [Failure reproduction](reports/retrieval-20260921-v02/failure-analysis.json)

![One v0.2 local versus Jev retrieval pair](reports/retrieval-20260921-v02/benchmark.png)

### Historical v0.1 revised pilot: 2026-09-21, 10-second timeout

**Jev returned valid selections for all 10 calls, with zero fallbacks.** Each arm has one payment workflow; this is preliminary evidence, not a general performance claim.

| Arm | Workflow success | Stage checks | Seconds | Main-model tokens | Jev success / calls |
| --- | ---: | ---: | ---: | ---: | ---: |
| Astra Native | 1/1 | 100.0% | 352.544 | 350,640 | N/A |
| Astra Full Context | 1/1 | 100.0% | 390.525 | 447,221 | N/A |
| Astra Sieve | 1/1 | 100.0% | 331.159 | 316,979 | 5/5 |
| Luna Native | 0/1 | 97.3% | 530.273 | 328,819 | N/A |
| Luna Sieve | 1/1 | 100.0% | 622.971 | 462,932 | 5/5 |

Astra Sieve used 6.1% less workflow time and 9.6% fewer total main-model tokens than Astra Native in their one successful matched pair (1.06× duration ratio). Against Astra Full Context, time was 15.2% lower and tokens 29.1% lower (1.18×; one pair). These differences are observations, not estimates of a repeatable causal effect.

Luna Sieve passed all final checks but took 622.971 seconds and 462,932 tokens. Luna Native took 530.273 seconds and 328,819 tokens, but accepted a whitespace-only callback charge ID and failed final acceptance. There is no successful Luna-to-Luna pair for a speedup calculation. Against successful Astra Native, Luna Sieve was 1.77 times as slow and used 32.0% more total main-model tokens. This small-model configuration did not deliver a speed or token reduction in this sample.

**Cache matters:** Astra Native reported 32,577 uncached input tokens; Astra Sieve reported 250,907, despite fewer total tokens. Their cached input was 309,504 and 58,752 respectively. Fewer total tokens cannot be translated directly into lower monetary cost. Prior pilot runs and Jev diagnostic replays may affect server caching; service load was not controlled.

**Recorded use:** 1,906,591 main-model tokens across this batch (904,038 uncached input, 955,648 cached input, 46,905 output; 9,304 reasoning tokens are already inside output). Jev reported 51,714 input and 7,310 output tokens. Workflow execution totaled 37.12 minutes, excluding setup and independent grading. Actual dollar charges are unknown. Across both pilot batches, reported main-model usage totals 3,730,322 tokens; diagnostic probes are separate from workflow results.

**Formal estimate:** 60 workflows / 300 stages project to approximately 7.42 hours, 22,879,092 main-model tokens, and 120 Jev requests with approximately 620,568 input plus 87,720 output tokens. This extrapolates one payment workflow per arm; different workflows and service conditions can change it substantially. Formal execution has not started and requires user confirmation.

[Complete revised report](reports/pilot-20260921-jev10s/README.md) · [CSV](reports/pilot-20260921-jev10s/runs.csv) · [JSONL](reports/pilot-20260921-jev10s/runs.jsonl) · [Failure reproduction](reports/pilot-20260921-jev10s/failure-analysis.json)

![Revised pilot with all ten Jev selections successful](reports/pilot-20260921-jev10s/benchmark.png)

### Historical v0.1 initial pilot: 2026-09-21, 1.5-second timeout

| Arm | Task success | Stage checks | Workflow seconds | Main-model tokens | Jev success / calls |
| --- | ---: | ---: | ---: | ---: | ---: |
| Astra Native | 1/1 | 100% | 369.254 | 343,184 | N/A |
| Astra Full Context | 1/1 | 100% | 391.248 | 439,193 | N/A |
| Astra Sieve | 1/1 | 100% | 357.435 | 352,118 | 0/5 |
| Luna Native | 0/1 | 80% | 214.568 | 190,624 | N/A |
| Luna Sieve | 1/1 | 100% | 333.530 | 498,612 | 1/5 |

The Luna Native attempt stopped on a provider error in stage 4; stage 5 was not
run. Its shorter duration is not evidence of superior speed. There were eight
Jev timeouts, one service error, and one successful selection. No valid Jev
speedup pairs remain. Total reported main-model use: **1,823,731 tokens**;
workflow execution: **27.77 minutes**. Missing usage on failed requests is unknown,
not zero. Actual dollar charges are not available.

The initial grader incorrectly required string-only evidence and a new test
filename. Uniform review accepted structured evidence and tests added to the
existing file, correcting three stage-one checks and one final artifact check.
Original verdicts, including Luna Sieve's original failed success flag, are retained.
Timing and token measurements are unchanged. See the
[complete report](reports/pilot-20260921/README.md) and
[review artifacts](reports/pilot-20260921/grading-review.json).

![Initial pilot; 9 of 10 Jev requests fell back](reports/pilot-20260921/benchmark.png)

### Why the timeout changed

The pinned selector starts `AbortSignal.timeout(config.timeoutMs)` before `fetch`
and applies it to the whole response. Five separate fresh-process probes using
the original payment prompts and candidate catalog all returned HTTP 200 under a
10-second limit: **1,608, 1,522, 1,552, 1,384, and 1,396 ms**. Three would exceed the
original 1,500 ms deadline. Almost all elapsed time preceded the response headers.
Five probes in one process also succeeded (448–1,361 ms). Connection reuse, service
load, and server caching are not isolated by this small diagnosis. Credentials and
request schema worked; the earlier generic service error cannot be reconstructed
because its HTTP status was not recorded.

[Fresh-process measurements](reports/pilot-20260921/jev-fresh-process-diagnostic.json)
and [same-process measurements](reports/pilot-20260921/jev-workflow-diagnostic.json)
are separate from workflow metrics. The benchmark now materializes the following
project configuration identically for every arm:

```json
{ "timeoutMs": 10000 }
```

This changes the maximum wait, not a fixed sleep. Sieve's production commit and
selection thresholds stay pinned, with no retries. Future observations record
HTTP status and header latency without response bodies. The original batch is
preserved; a new batch ID is required for the revised settings.

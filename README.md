# Pi Sieve Bench

A private, reproducible comparison of Native Pi, full reference injection, and
[Pi Sieve](https://github.com/yoonshilee/pi-sieve) on five-stage development workflows.
All projects and reference data are fictional. This repository contains no shared
credentials. Live runs consume the operator's own model and TypeSafe allowance.

## Experiment

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

Only aggregate tables, figures, versions, sample sizes, and limitations will be
copied to the public Pi Sieve README after a confirmed formal batch. Public figures
must be stored publicly rather than linked to private repository assets.

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

No formal benchmark has been run. The revised five-arm pilot below uses a 10-second
Jev timeout and the corrected grader, frozen before execution. The original pilot
is retained separately as an availability finding.

### Revised pilot: 2026-09-21, 10-second timeout

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


### Initial pilot: 2026-09-21, 1.5-second timeout

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

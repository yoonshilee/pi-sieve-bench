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
| Sieve settings | Published defaults: 1.5 seconds, 40 candidates, 6 documents, 8,000 characters |
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
workflow/repetition pairs only; faster failures cannot become speedup claims.
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

No formal benchmark has been run. Pilot observations will be linked here when
complete and must not be interpreted as a general speed or accuracy claim.

# Semantic observation comparison

Local exploratory experiment. No public performance claim, chart, push, or release.

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
this repository. These commits have not been pushed. With Pi credentials already
configured, run:

```sh
npm run check
npm run probe:semantic -- semantic-probe-20260922-sol
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

Post-run results and failure analysis will be added below without changing the
frozen tasks, reference labels, protocol, or implementation.

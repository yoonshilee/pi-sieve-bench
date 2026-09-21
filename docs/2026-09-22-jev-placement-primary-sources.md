# Jev placement: primary-source review

Reviewed on September 22, 2026. This note inspects current official documentation and its embedded implementations. No external example code or paid model request was executed. Published demonstrations below generally use `jev-1.12`; they are architectural evidence, not measurements for our current Pi/Sol/Jev versions.

## 1. Closed-set function dispatch: replace a decision and its handoff

**Flow:** reusable typed functions and specifications -> code builds questions -> user request -> Jev -> code constructs arguments and invokes the selected function.

The official dispatcher derives candidate values from Python `Literal`, `list[Literal]`, and `bool` parameters. A reusable specification supplies their meanings. An LLM may author that specification during setup; no runtime LLM is required before or after Jev in the shown execution path. One request asks 54 questions covering ten functions: a function `Choice`, argument `Choice` questions, and `Noul` membership/presence questions. Code consumes only the selected function's answers.

This can replace both function selection and closed-set argument filling. It does **not** generate arbitrary shell commands: free text, numbers, and dates retain function defaults. Jev receives the command and decision specification. Network latency and question tokens remain real costs. A separate LLM may still be necessary when an application needs open-ended arguments or prose; that is additional architecture, not demonstrated savings.

Source: [Function calling](https://docs.typesafe.ai/cookbooks/function_calling).

## 2. Retrieval reranking: operate inside an existing tool

**Flow:** existing query -> BM25 shortlist -> Jev relevance judgments -> code sorts -> retrieval results.

Code produces candidates and a reusable `Noul` proposition. The official example evaluates whether a candidate passage supplies the particular precedent sought by a legal query. It sends the query and **candidate passage text**, not merely metadata. It has no main LLM in its measured retrieval pipeline.

The implementation makes 30 independent requests per query using a thread pool: 40 queries produce 1,200 calls. It is not a demonstrated one-request, 30-question batch. Reranking can reorder only recalled passages; it cannot recover omitted ones.

Integration inference: placing this work inside a search tool need not add another main-model turn. It still adds work relative to keyword retrieval. A speed/cost case requires replacing an existing expensive reranker, avoiding subsequent searches/reads, or improving downstream outcomes enough to justify the added work. The example measures retrieval accuracy, not complete agent speed. Evidence-rich reranking expands the data sent externally beyond Sieve's description-only retrieval boundary.

Source: [Re-ranking](https://docs.typesafe.ai/cookbooks/rerank_typesafe).

## 3. Skill suggestion: quality assistance, not removed main-model planning

**Flow:** fixed roster + user request -> Jev ranks and gates -> code reads shortlisted skills -> Jev reranks -> suggestion -> main LLM chooses whether to load a skill.

The first request combines a `Choice` over 182 skills with three `Noul` questions. A conditional second request receives the top three full descriptions and 700-character instruction excerpts; it combines `Choice` with independent fit checks. Code builds both requests. The main LLM neither authors options nor copies all skill text to Jev.

The roster stays fixed. A changing suggestion is appended after an Anthropic cache breakpoint. The measured harness has one user turn per sample: this establishes a reusable roster prefix, **not** preservation of an entire multi-turn conversation prefix when a system suffix changes. It adds up to two Jev calls and retains the LLM's skill-selection action.

The 488-request demonstration measures first-response skill loading. It reports fewer errors overall, but also seven previously correct covered requests made wrong by suggestions. It does not demonstrate faster complete tasks. Jev receives request text and skill content.

Source: [Skill suggestion](https://docs.typesafe.ai/cookbooks/skill_suggestion).

## 4. Validation after generation: replace a separate semantic judge

**Flow:** existing answer and citations -> code locates quotes -> Jev checks semantic support -> code accepts, rejects, or flags for review.

The citation cookbook first uses normalized string matching to reject missing quotes without a model. For surviving citations, a fixed `Choice` asks whether the relevant source section supports, contradicts, or does not address a claim. Code constructs state from the already-existing claim and source section, then maps the returned label to a verdict. The sample citations were generated previously; a live generator is not part of its measured loop.

This is a plausible replacement for an existing LLM judge or repeated manual semantic checks. Adding it where there was no validation adds latency; correcting a failure may require another main-model turn. A pass need not alter a prompt or tool definition. A repair request should append evidence normally rather than rewrite earlier messages. Jev receives the claim and source text. The demonstration is eight citations with deliberately inserted failures, not proof of broad factual-verification reliability.

Source: [Double-checking citations](https://docs.typesafe.ai/cookbooks/citation_check).

## 5. Code-owned triage: batch independent facts, route without another LLM

**Flow:** incoming record -> fixed question battery -> one Jev batch -> deterministic branching or weighted priority -> an existing handler.

The fan-out pattern asks category `Choice`, relevant `Noul` flags, and severity/frustration `Score` questions against the same ticket before knowing which branch applies. Code ignores irrelevant answers and routes directly. No general-purpose LLM is needed to author each question or interpret each result. This replaces repeated semantic classification calls if those existed; deterministic policy checks should remain ordinary code.

Source: [Speculative fan-out](https://docs.typesafe.ai/patterns/fan-out).

For multi-dimensional prioritization, the composite-scoring pattern normalizes separate ordinal scores and combines them using application-controlled weights. One assessment can support different policies without re-querying Jev. It does not establish that weighted scores are calibrated utilities or that independent questions solve long-horizon planning. The example is a workflow pattern, not an agent benchmark.

Source: [Composite scoring](https://docs.typesafe.ai/patterns/composite-scoring).

## Constraints that determine whether these placements help

- **Real dependencies still need serial work.** Questions in one request do not see each other's answers. A second request is necessary when an answer determines which evidence to fetch or which options exist. Skill shortlisting is such a dependency; function dispatch can ask every closed-set branch speculatively and ignore the unused answers. [Question dependencies](https://docs.typesafe.ai/primitives#when-one-question-depends-on-another).
- **The relevant baseline is the work being replaced.** The parallel-questions cookbook compares batched Jev with repeated Jev calls over the same large document. It does not compare Jev with an LLM that already answers all questions in one call. Its gain must not be attributed to an arbitrary agent integration. [Parallel questions](https://docs.typesafe.ai/cookbooks/parallel_questions).
- **A gate is not a planner.** The guardrails cookbook batches hazard `Noul` questions and a severity `Score`, then applies policy in code. This can replace an existing screening model; adding it to every command cannot inherently accelerate a previously unchecked path. Its sample screening is not proof that arbitrary shell effects can be judged safely from command text. [Guardrails](https://docs.typesafe.ai/cookbooks/llm_guardrails).
- **Confidence is not permission or guaranteed correctness.** Choice/Score confidence is derived from the returned probability distribution. Domain thresholds need empirical validation; a confident label cannot authorize an action or establish complete evidence. [Confidence](https://docs.typesafe.ai/confidence).
- **Evidence and privacy are linked.** Jev only receives supplied text/structured state. It does not automatically inherit the main model's reasoning or environmental observations. Code-owned evidence collection avoids asking the main model to summarize everything, but payloads can still contain private document or tool-result text. [State](https://docs.typesafe.ai/concepts/state).

## Implication for the next Sieve design

The strongest placement is a narrow, repeated semantic decision whose candidates and evidence already exist in code, and whose result code can consume directly. Preserve the main model for open-ended generation and unfamiliar reasoning. This follows TypeSafe's own code-owned, atomic-decision design guidance; the speed claim remains a hypothesis until measured against the actual displaced work. [Design guidance](https://docs.typesafe.ai/concepts/how-to-build-with-system-one).

A main model that invents options, serializes its evidence, calls Jev, reads all scores, and emits another action has not necessarily delegated substantial work. Neither changing Score to Choice nor calling that step a decision layer proves otherwise. Candidate construction, evidence retrieval, retries, and downstream repair must count in the experiment. None of the inspected examples demonstrates direct modification of another model's internal KV cache: cache effects arise through the main model's request construction, which requires separate host/provider inspection.

## Current Sieve: what the local evidence supports

Source inspected at Sieve `e3ecbdd` with Pi 0.86.1. The scoring implementation is unchanged from the measured `5031c1a` implementation; the intervening change updates dependency lock metadata.

- `src/index.ts` registers fixed `sieve_search` and `sieve_score` tools. It does not automatically filter skills, change the tool roster, or rebuild conversation context. Retrieval happens within the search tool and returns ordinary tool messages.
- `src/scoring.ts` batches independent ordinal `Score` questions, selects the highest score in code, and returns the selected option. `sieve_score` does not execute it. Profiles reduce repeated argument generation but retain the main-model request needed to forward the answer. Valid scores always yield a winner, even when all options score poorly; a production action dispatcher would need an explicit unavailable/escalation policy.
- The existing offline SDK test in `test/integration.test.ts` verifies stable tools, rules, skills, and previous messages across retrieval and consecutive tasks. This verifies a local transcript invariant, not a provider cache hit.

The [preserved comparison](../reports/pi-jev-probe-20260921-sol/analysis.md) reports:

| Mode | Reference agreement | Median seconds | Main-model requests per trial |
| --- | ---: | ---: | ---: |
| Direct Sol, historical | 18/18 | 3.62 | 1 |
| Sieve profile Score, historical | 18/18 | 10.32 | 2 |
| Native pi-jev Score | 18/18 | 28.05 | 2 |
| Native pi-jev Choice | 18/18 | 13.81 | 2 |

These are short decision probes ending at an action sink, not completed coding workflows. Historical controls ran in another time block. Fresh sessions and differing prompts/tool schemas cannot isolate long-session cache behavior. All modes already matched the reference choices, so these cases exposed overhead without demonstrated quality gain. Internal cognition was not measured: argument preparation is observable; whether Sol privately completed the decision first is not.

The strongest supported diagnosis is an unfavorable workflow boundary: a cheap direct choice became main-model preparation, Jev waiting, and another main-model handoff. Even eliminating the handoff would not prove a benefit; the remaining work still needs comparison with the original direct decision.

## Cache and host integration

Jev runs separately; it cannot directly edit the main model's server-side KV state. The plugin controls requests and thus affects reuse opportunities. OpenAI documents reuse of matching rendered prefixes, subject to cache boundaries and request settings. Stable prefixes improve eligibility, not guaranteed hits. Changes to earlier instructions, tool declarations, or messages can reduce reuse after the changed position. New messages still require processing. See [prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching).

Installed Pi source adds two qualifications:

- `pi-ai/dist/api/openai-codex-responses.js` supplies a session-derived `prompt_cache_key`; this is not a local KV-cache implementation. Its provider path does not establish support for every option in the public Responses API.
- `pi-ai/dist/utils/transcript.js` and `openai-responses-shared.js` can preserve tool additions in the transcript when model compatibility enables that path. Removal/redefinition can instead change the request's tool set. Therefore, neither "all tool changes flush the cache" nor "Pi patches always preserve the cache" is a reliable general rule. Inspect the actual provider projection.

Use reported cached and uncached input counts, output tokens, request count, and latency together. A higher cache-hit fraction can coexist with more total work. OpenAI offers cache diagnostics on supported Responses paths; availability on Pi's Codex transport has not been verified here. See [cache diagnostics](https://developers.openai.com/api/docs/guides/prompt-caching/diagnostics).

Practical constraints:

1. Keep the outer tool interface and normal system instructions stable. Construct dynamic candidates inside code/Jev state, not a new main-model tool schema each step.
2. Process a new tool result before its first delivery if needed. Append its result normally; do not repeatedly remove, rewrite, or move previous tool messages. Preserve access to original evidence and mandatory error facts.
3. An additional tool has a fixed schema/guideline cost even when unused. Calling it adds argument/result text and may add a main-model round trip. Cache reuse does not remove those costs.
4. Switching main models changes the cache domain. Routing each step between models is not a transparent cache optimization.
5. Jev has no access to the main model's hidden reasoning or unprovided observations. Small structured state is useful only when it retains the evidence required for the decision. Sending real logs or document bodies would expand Sieve's current external-data boundary and must be an explicit design choice.

Pi supports `tool_call` before execution and `tool_result` after execution; the latter can process a newly produced result before the next model request. A command gate at `tool_call` runs after the main model has already chosen the command. It adds review, not a substitute for that selection. See [Pi extension events](https://pi.dev/docs/latest/extensions).

The installed extension API exposes `pi.exec`, but no general public `executeRegisteredTool` method was found. A composite executor must not assume a subprocess call reproduces another tool's hooks, permissions, cancellation, or audit behavior. Retaining those contracts is implementation work, not a free optimization.

## Placement decisions

| Placement | What it can replace | Effect on the main loop | Assessment |
| --- | --- | --- | --- |
| Existing semantic classifier or judge | An existing model call with the same narrow input/output contract | No additional main-model turn; no prompt mutation required | Best-defined substitution, if such a step actually exists |
| Inside an already-needed retrieval or diagnostic tool | Repeated reading, classification, or follow-up searches | Same outer call; adds Jev wait and potentially reduces returned material | Conditional; compare with strong local/rule baselines |
| A bounded subtask with code-owned candidates and direct dispatch | Several intermediate main-model decisions and answer-forwarding steps | One outer delegation and final result; internal Jev calls remain | Most structural potential, but requires a real bounded task and preserved execution contracts |
| Closed-set request handler before the main model | Main-model routing and closed-set argument filling | Can avoid invoking the main model for supported requests | Useful only when rules are insufficient; unknown requests still escalate |
| Semantic command gate | An existing separate reviewer, if present | Passing can stay within the existing tool call; blocking may trigger another turn | Quality/control feature; not inherently a speed optimization |
| Generic score tool returning a choice to the main model | Unproven reduction of internal deliberation | Preparation, Jev wait, and result handoff remain | Current evidence does not justify it as the default optimization |

`Noul` fits independent applicability checks; `Choice` fits a mutually exclusive route; `Score` fits ordered degree or prioritization. Changing primitives does not repair a misplaced boundary. Exact exit codes, permissions, arithmetic, and schema validation remain code.

The bounded-subtask shape would be:

```text
Main model delegates one concrete goal and scope
  -> code obtains real observations and enumerates eligible actions
  -> Jev selects among those actions using a reusable criterion
  -> code validates and dispatches the selected action
  -> bounded continuation on new observations, or explicit escalation
  -> one result containing actual outcomes and supporting evidence
```

This is a placement hypothesis, not a proposal to build a general agent framework. It is worthwhile only if several intermediate decisions naturally belong together. Wrapping a single easy command in this shape can still be slower than direct execution. A browser can enumerate visible controls; a general coding task often cannot enumerate all useful fixes without the main model. That difference limits how far the pattern transfers to Pi.

## Recommended next decision

Do not add another universal judgment step or reinterpret the old probes as evidence of cache failure. Keep generic scoring experimental. The current optional retrieval tool is a structurally reasonable place for reranking, but existing negative results still stand and do not justify making Jev mandatory there.

First identify one real, frequent semantic classification already performed by a separate model call, or one bounded tool workflow that currently needs repeated main-model interpretation. If neither exists, there is no demonstrated step to optimize and no reason to add a new one for Jev.

Before any paid experiment, draw the baseline and replacement calls and identify exactly which work disappears. Compare the direct workflow, the same bounded tool with ordinary code/local selection, and the same bounded tool with Jev. Keep model, outer schema, permissions, evidence, scoring, and failure handling comparable. Test a long shared conversation as well as fresh sessions; record cache counts and prefix changes without saving private payloads. Measure task correctness, missing required evidence, recovery calls, main-model requests and usage, Jev usage, and end-to-end latency. Judge net benefit after candidate construction, cancellation, timeouts, fallback, and repair; do not estimate savings from Jev latency alone.

This review changes no production code, runs no paid experiment, and publishes no performance claim.

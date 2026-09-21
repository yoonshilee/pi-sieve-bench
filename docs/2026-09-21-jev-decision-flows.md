# Public Jev decision flows

Reviewed on September 21, 2026. This is a source inspection, not a reproduction of the projects' live results. No external repository code was executed. Revisions below fix what was inspected; later versions may differ.

## Three concrete implementations

| Project and revision | Source of options | Judgment and execution | What it establishes |
| --- | --- | --- | --- |
| Browser Use `jev-ultrafast`, `1231850a0bf1a0c0341fe408ef1668dbbfdfac46` | Code builds options from currently observed DOM elements | Batched Choice questions select operation and compatible target; code executes the selected observed action | Dynamic options can be produced without a generative model on each decision |
| `vinilana/jev-eval-agent`, `037de1120c84b4b63cdf748e2acf258ff66d7731` | A predefined catalog of 100 tools plus a response option | Jev selects the tool before the LLM request; the LLM receives one tool and generates arguments | A router can remove tool selection from the LLM request, while retaining generation |
| `TheoOliveira/pi-jev`, `549c2bfa249269d0f5590658b5743801c47af369` | The active LLM can generate question types, criteria, and evidence | A command calls the LLM designer, calls Jev, and displays answers; the separate evaluation tool returns answers to the calling agent | Dynamic LLM-authored questions exist, but this path does not demonstrate faster command execution |

### Browser Use: observed candidates, direct execution

The snapshot's actions are converted into indexed elements and operation-specific candidate maps. One API request contains a Choice for the operation and speculative Choice questions for each supported target group. Code uses only the target answer matching the selected operation. These are alternatives in Choice distributions, not independently scored command options. See [`model.py`, lines 44–143](https://github.com/browser-use/jev-ultrafast/blob/1231850a0bf1a0c0341fe408ef1668dbbfdfac46/jev_ultrafast/model.py#L44-L143).

```text
Observe page -> code enumerates actions -> Jev selects operation and target
    -> code validates and executes action -> observe again
    -> only TYPE_TEXT needs a small LLM to generate a field value
```

The loop calls `choose`, resolves the selected ID to an observed action, and invokes `browser.act`. There is no general-purpose LLM handoff between a click decision and its execution. Text generation is conditional on the selected action being a fill operation. See [`agent.py`, lines 73–117](https://github.com/browser-use/jev-ultrafast/blob/1231850a0bf1a0c0341fe408ef1668dbbfdfac46/jev_ultrafast/agent.py#L73-L117).

Its published 25% median improvement compares an original and optimized **Jev-based runtime**, with the same Jev and text-helper models. It is not Jev versus a conventional LLM agent. The report contains three pairs on one Flights task and reports 178 ms median Jev latency in the recorded run. It also separates helper charges from total task cost. These source-reported timings are not measurements from our environment. See [`docs/performance.md`, lines 5–23](https://github.com/browser-use/jev-ultrafast/blob/1231850a0bf1a0c0341fe408ef1668dbbfdfac46/docs/performance.md#L5-L23).

### Personal assistant: router before argument generation

The router constructs a fixed Choice catalog from tool descriptions plus `respond_to_user`. Its changing state is built from user requests, performed actions/results, and assistant text. It batches that Choice with a completion Noul; code can reject premature completion using the second answer. See [`jev-router.ts`, lines 33–44 and 59–138](https://github.com/vinilana/jev-eval-agent/blob/037de1120c84b4b63cdf748e2acf258ff66d7731/agent/lib/jev-router.ts#L33-L138).

```text
Conversation state -> Jev selects one catalog tool -> expose that tool
    -> LLM generates arguments -> executor -> next step
```

The `step.started` hook performs routing before the model call and returns only the chosen tool. Unlike an LLM calling a scoring tool and subsequently calling an execution tool, this does not require an initial LLM request solely to ask Jev to decide. It still requires an LLM for arguments. See [`agent/tools/catalog.ts`, lines 24–50](https://github.com/vinilana/jev-eval-agent/blob/037de1120c84b4b63cdf748e2acf258ff66d7731/agent/tools/catalog.ts#L24-L50).

The comparison changes more than the decision component: the LLM sees 100 tools versus one, and Jev mode reduces reasoning effort. For example, the source configures Sol and Luna as medium in direct mode and none in Jev mode. This is a combined architecture comparison, not an isolated Jev substitution. See [`models.ts`, lines 48–65](https://github.com/vinilana/jev-eval-agent/blob/037de1120c84b4b63cdf748e2acf258ff66d7731/agent/lib/models.ts#L48-L65).

Treat its evaluation claims carefully. The scorer's completion metric covers required tool-name families; `succeeded` means the framework status was not `failed`. Neither alone proves semantic correctness of arguments or final world state. Its estimated cost uses main-model input/output rates and does not add Jev charges. See [`evals/shared.ts`, lines 154–185](https://github.com/vinilana/jev-eval-agent/blob/037de1120c84b4b63cdf748e2acf258ff66d7731/evals/shared.ts#L154-L185).

### Pi: genuinely dynamic questions, no demonstrated execution shortcut

`/jev test <prompt>` calls the active Pi model using a dedicated system prompt that requests state and typed questions. The model can author Choice options, Score levels, or Noul propositions. The extension parses and validates the generated structure. See [`designer.ts`, lines 5–15 and 76–109](https://github.com/TheoOliveira/pi-jev/blob/549c2bfa249269d0f5590658b5743801c47af369/src/designer.ts#L5-L109).

```text
/jev test prompt -> active LLM designs questions -> Jev evaluates
    -> extension displays answers to the user
```

The command handler sends the designed request to Jev and displays answer values through UI notifications. It does not resolve the answer into a shell command and execute it. See [`commands.ts`, lines 65–126](https://github.com/TheoOliveira/pi-jev/blob/549c2bfa249269d0f5590658b5743801c47af369/src/commands.ts#L65-L126).

Its separate `jev_evaluate` tool accepts caller-supplied state and questions, calls Jev, and returns answers as a tool result. A surrounding agent can continue afterward, so this tool boundary alone does not remove a model round trip. No end-to-end speed conclusion follows from the existence of this feature. See [`tools.ts`, lines 113–175](https://github.com/TheoOliveira/pi-jev/blob/549c2bfa249269d0f5590658b5743801c47af369/src/tools.ts#L113-L175).

## Interpretation of these examples

Dynamic options describe where candidates come from, not how many LLM calls the architecture saves. Browser options come from observations; the assistant router uses a known catalog; the Pi evaluation command lets an LLM author a question. These are different execution graphs.

The clearest execution shortcut in the inspected code is a bounded action that code can execute directly after Jev chooses it. A generic evaluation tool instead returns a judgment to its caller. Whether that extra call pays for itself depends on the judgment cost it replaces, the number of batched decisions, service latency, and any downstream mistakes avoided. None of these repositories establishes that inserting Jev between two general-purpose LLM calls always improves latency or cost.

## Official examples and the command-gate distinction

TypeSafe's [Function Calling cookbook](https://docs.typesafe.ai/cookbooks/function_calling) derives closed argument sets from function signatures and a reusable specification. An LLM may author the specification during setup. At runtime, the dispatcher batches function selection and potential argument questions in one request, reads only the selected function's answers, and invokes the function through code. The example has ten functions and 54 questions per request. Open-ended arguments retain defaults; this is not arbitrary code or shell-command generation. Its embedded demonstration uses `jev-1.12`, so it is architectural evidence rather than a comparable v1.13 timing measurement.

```text
Function signatures + reusable descriptions -> generated typed questions
User request -> one Jev batch -> code assembles arguments -> function.run()
```

LangChain's experimental AutoMode middleware inspects a tool call that the LLM has already proposed. It asks a Noul risk question, blocks above its configured policy boundary, or invokes the tool handler directly. Successful passage does not require a second model call before execution. This replaces or adds a risk-review step; it does not replace the original choice of command. Source: [`auto_mode.py`, lines 169–265](https://github.com/langchain-ai/langchain/blob/115dbbd158c95044c2a2281e326dc8e6a44a3c23/libs/partners/typesafe/langchain_typesafe/experimental/middleware/auto_mode.py#L169-L265), also documented in the [maintainer's package description](https://pypi.org/project/langchain-typesafe/0.0.1a3/).

```text
LLM proposes tool call -> Jev risk judgment -> code allows or blocks execution
```

Consequently, a social demo of scoring every command may be demonstrating a permission or risk gate, not faster next-action planning. Adding a gate cannot be assumed to speed up an agent that previously had no equivalent review step.

## What the local experiment establishes

The [frozen probe](../reports/profile-probe-20260921-sol-v05/manifest.json) used Sol medium and real Jev, with a shared eight-option profile, six short fictional cases, and three paired repeats. Profile authoring and evidence collection were excluded. Both conditions saw the candidates; the delegated condition additionally had to reproduce the supplied context inside the scoring call. Commands were recorded at a sink, not executed.

For the 12 evidence comparisons in each arm:

| Metric | Direct Sol | Sol delegates to Jev |
| --- | ---: | ---: |
| Correct selections | 12/12 | 12/12 |
| Median selection-to-dispatch time | 3,745 ms | 10,865 ms |
| Main-model requests | 12 | 24 |
| Main-model total tokens | 16,688 | 36,418 |

Sources: [summary](../reports/profile-probe-20260921-sol-v05/summary.json), [audit](../reports/profile-probe-20260921-sol-v05/audit.json), and [individual records](../reports/profile-probe-20260921-sol-v05/runs.jsonl). All 18 Jev calls, including routine controls, succeeded; lack of service responses does not explain this batch.

Within the evidence arm, median Jev elapsed time was 1,569 ms and median post-response handoff was 3,228 ms. Score arguments had a median of 550.5 characters versus 90.5 characters for a direct action. These are characters, not tokens. The median remaining time was 4,931.5 ms; it includes the first model call and local overhead and is not an isolated model measurement. Medians of components must not be added to reconstruct the total median.

Subtracting each trial's entire post-response handoff gives an idealized median of 7,485 ms. This is arithmetic on existing records, not a tested fused executor, and it assumes all other timings stay unchanged. It shows why removing the second model call alone is not evidence of a positive outcome: the first call still constructs a delegation request, Jev still takes time, and the baseline judgment is already inexpensive.

The current source at plugin commit `e3ecbddf73c5a4b8dc131bd4280714114fc8a19e` exposes a scoring tool that returns the selected option to the main model. `src/index.ts` does not execute it. `src/scoring.ts` submits one independent Score per candidate and selects the maximum. A valid service response always produces a winner, even if every score is poor; equal scores use input order. That is a design limitation for autonomous action selection, but it did not produce an observed wrong answer in this probe.

## Implications for Pi Sieve

The evidence rejects an unconditional speed claim for this scoring-tool workflow on these cases. It does not establish that Jev cannot replace a decision model, and it does not establish that a different architecture will help general coding tasks.

There are three separate questions:

1. **Can the candidate set be obtained cheaply?** DOM controls, registered tools, discovered test targets, and retrieved records can come from code. Inventing several plausible shell commands and summarizing all evidence can already require much of the original reasoning. Dynamic candidates do not have to be LLM-generated every time.
2. **Does the delegation remove model work?** Returning a winner to a model solely to copy it into another tool call preserves an avoidable handoff. A bounded executor or subtask loop can consume the decision directly, while preserving the host's authorization, tool hooks, cancellation, and audit behavior. It must not bypass these by silently using a raw subprocess helper.
3. **Is the judgment a good fit?** The official [design guide](https://docs.typesafe.ai/concepts/how-to-build-with-system-one) recommends narrow decisions with supplied evidence. Making examples require deeper reasoning is not automatically a better test. Better candidates involve many repeated semantic checks or a costly separate judge call, while code supplies the observable facts.

For choosing one action, [Choice](https://docs.typesafe.ai/primitives/choice) expresses the contract directly. A no-match or escalation option is needed when no action applies. For independent relevance or several decision dimensions, [Score](https://docs.typesafe.ai/primitives/score) remains appropriate; code can combine atomic scores. Switching primitive does not itself prove faster or more accurate behavior. Confidence is not proof of correctness or permission.

The most defensible next architectural experiment would be one bounded subtask: the main model supplies the goal and constraints once, code derives current eligible actions and evidence, Jev chooses, and code executes under existing policies until completion, a fixed budget, or escalation. Results return to the main model at that boundary. If code cannot cheaply construct the candidates, or direct Sol already handles the subtask in one cheap request, retain the native path.

This is a proposal, not an implemented change or a promise of benefit. Future comparisons should hold candidate generation, tools, reasoning effort, and grading constant, include real execution and all Jev overhead, and verify final state. No additional paid experiment, production change, or public performance publication was made during this research.

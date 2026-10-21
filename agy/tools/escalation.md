# Escalation rules: when a step needs the deep-reasoning model (level = "deep")

Default model for every step is Gemini 3.8 Flash (high). It matches or beats Gemini 3.1 Pro on
coding and agentic benchmarks (SWE-bench, LiveCodeBench, Terminal-Bench). Pro is only better at
open-ended/abstract reasoning, expert knowledge, synthesis over very long context (100k+ tokens),
and robustness when Flash already failed a check. Therefore: escalate for REASONING, never for
"the code is hard to write".

## Global triggers (any escalable layer: architect, research, review, verify)
- G1 Repeated failure: a second `verify` FAIL or a second `review` NEEDS_FIX in this task.
  (Also detected automatically by the tool; you may still cite it.)
- G2 Design ambiguity: two or more reasonable options with hard-to-reverse consequences
  (data schema, public API, architecture).
- G3 Cross-cutting scope: more than 8 files or more than 3 modules/packages, or the step must
  synthesize more than ~100k tokens of code/docs.
- G4 Correctness-critical domain (closed list): concurrency, auth/permissions/crypto, data
  migrations, money/billing, non-trivial algorithms, numerics/precision, parsers/protocols.
- G5 Open-ended reasoning: no known procedure, root cause not evident, intermittent behavior,
  performance without a clear profile.

## Never deep
- `implement` and `fix` never escalate. If an implementation is hard, put an `architect` deep step
  BEFORE it that produces exact, file-level instructions Flash can follow ("Pro thinks, Flash types").
- Any layer: boilerplate, well-specified changes with clear acceptance criteria, tests, renames,
  formatting, docs, or the FIRST attempt at something covered by tests.

## Per layer
- architect: normal when extending an existing pattern ("another endpoint like the others").
  Deep with G2, G3, G4 or G5.
- research: normal to locate/explain ("where is X?", "what does Y do?"). Deep with G1, G3 or G5.
- review: normal for small or mechanical diffs, tests, docs. Deep with G3, G4 or G1.
- verify: normal almost always (running tests is mechanical). Deep only if there are no
  automatable tests and the acceptance criteria are qualitative, or with G1.

## level = "light" (any layer)
Rename, one-line change, config value, formatting, a comment, a single isolated test case.

## deep_orchestration_reason (about THIS planning, not the steps)
Set it (trigger id + one sentence) only if the request combines two or more of G2–G5, or your
plan would exceed 6 steps. Otherwise leave it empty. Never for a request naming an exact file and
an exact change.

When you set level = "deep", `reason` must start with the trigger id (e.g. "G4: concurrent counter")

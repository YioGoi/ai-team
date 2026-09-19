AI Team v0.1 — Build Procedure and Runtime Loop

Revision: 2026-09-19.

This document deliberately separates two different loops:

Part I: bootstrap — the present Codex session builds the AI Team application.

Part II: runtime — the built TypeScript controller later runs teams on target projects.

Do not use one loop's status file or counters for the other. Runtime limits must be enforced in application code. Bootstrap limits are instructions plus a persistent build ledger until a real external watchdog exists.

Part I — Build AI Team in the current workspace

B.1 Read, inspect and reconcile

Read AGENTS.md, GOAL, SPEC, WORKFLOW and STATUS completely. The product requirements and scope are already filled. The current standalone ai-team workspace is the application repository; no separate target project must be supplied to begin.

Inspect actual Git root/status, files, OS, Node/npm/Git and provider executables. An empty source tree is expected for this build. Do not initialize or modify a parent repository. Preserve user changes and any genuine implementation history.

Reconcile the old empty-template BLOCKED status separately from real code failures. If a prior status backup exists, preserve actual counters/decisions. If there was only a missing-spec preflight, document that fact and start the application build. A replaced Markdown file is not permission to reset genuine consumed budgets.

Update .ai/STATUS.md with what is observed, not assumed versions or fabricated checks. Keep the five instruction files at their existing paths. Generate ordinary source/tests/assets/README as implementation proceeds.

B.2 Bootstrap limits

Budget

Ceiling

Accounting rule

Failed meaningful repairs for one root build problem

3

Same symptom/root issue retains identity across phases/resume

Implementation/validation rounds per build milestone

4

Initial round plus at most three correction rounds

Failed repair interventions across this build assignment

18

A failed intervention is counted even when it addresses several issues

Real model-consuming CHILD invocations

12

Delegated build workers, live probes and every app-created live worker count

A read/help/version command or fake subprocess test is not a model-consuming child invocation. The parent Codex conversation's internal model calls cannot be hard counted or stopped by software that is not built yet; do not claim the 12-child cap is a total-token cap for the parent conversation.

Before a repair, record issue ID, evidence, hypothesis, planned intervention and check. After validation, record the result. After three failed meaningful repairs on the same issue, stop working on it. No fourth autonomous repair, phase renaming, issue alias, provider change or fresh task used to escape the limit.

Before a real child dispatch, reserve its call budget in STATUS. App live runs must receive a LOWERED invocation cap equal to the remaining build allowance, not their normal default. Count their actual downstream calls in the same build ledger. An interrupted/indeterminate child reservation is conservatively consumed.

Use fake providers until offline mechanics work. Do not consume the live budget to discover syntax errors in normal application code. A missing login or OS permission is a human dependency, not something to “repair” three times.

When a live credential/capability dependency blocks one milestone, finish only independent safe offline work. A global failed-repair/live-call cap prevents more operations in that class; do not start replacement loops. If a required code defect remains exhausted, hand off the partial result with the exact evidence.

B.3 Build milestones and exit evidence

B0 — Reconciliation, runnable skeleton and contracts

Inspect boundaries/history. Create the local package, lockfile, strict ESM TypeScript, test/lint configuration, CLI entrypoint and actual package scripts. Implement TaskSpec, config, role result and public error schemas. Add real --help, input errors and command scaffolding without fake success behavior.

Exit: actual install in the authorized environment, build/help/typecheck and schema-negative tests. No live providers yet.

B1 — State, budgets and readiness

Implement the pure reducer, append-only journal, atomic snapshots, durable reservations, issue registry and pure readiness predicate. Cover aliases/reopened issues, candidate-bound evidence, nonwaivable required criteria and frozen input snapshots.

Exit: deterministic tests for the third repair, fourth round, total calls and recovery pass. No model needed.

B2 — Processes, fake workers and ownership

Implement shell-free argv/stdin spawning, child environment construction, bounded decoders, deadlines, process-group termination, run/repository locks and interrupted-run reconciliation. Create real fake CLI executables that emit valid/invalid streams, report auth failure and spawn grandchildren.

Exit: subprocess tests show actual termination, bounded memory/output and no duplicate/unowned process actions. Mark any host-specific limitation rather than claiming a Linux test proves macOS behavior.

B3 — Git workspaces and validation evidence

Implement canonical path checks, protected files/refs, managed implementation branch/worktree, separate frozen observer copies, scope audits, checkpoint commits and controller-run setup/validators. Build the disposable TypeScript fixture using controlled local test tooling.

Exit: original source checkout/ref unchanged; actual new files and cumulative diff captured; stale/mutated candidate evidence rejected; real nonzero validator exits block readiness.

B4 — Complete offline team loop

Connect planning, QA PLAN, sequential milestone rounds, one Implementer, deterministic checks, Reviewer/QA CHECK and bounded decisions. Generate useful persisted status and final artifacts. Implement one bounded context/approved-check refill rather than unbounded conversational loops.

Exit: mock workers run as separate processes, implement a real fixture change, and pass the fixed external oracle. A lying mock without edits fails. Exhausted budgets stop dispatch and preserve evidence.

B5 — Codex and Claude adapters

Implement BOTH real adapters with capability probing, exact argv/environment contracts, stream/result extraction and normalized failures. Check actual installed help, not guessed options. Implement the saved-login safety boundary and the Claude bare/ambient-configuration distinction described in SPEC.

Exit: both adapters have substantive code and offline parser/command tests. Missing live login is recorded as such, not implemented as a permanent stub or silently substituted provider. No hidden API auth or unrestricted permission fallback.

B6 — Operational commands and Markdown integration

Finish doctor/init/run/status/resume/cancel/export, their JSON/human output and actual error exit codes. Ensure the same application can target multiple registered repositories and task files outside them. Implement explicit, nonoverwriting report export to a chosen directory; no Obsidian plugin or vault scan.

Create a usage README and the filled smoke example from SPEC. Distinguish app build instructions, runtime task contract and generated run status. Verify every documented package script/command against the built CLI.

Exit: command-level integration tests, path-with-spaces tests, input snapshot tests, export tests and the complete offline gate pass. A user can follow the documented post-build terminal workflow without copying app code into a target project.

B7 — Bounded live proof and engineering handoff

Only after the offline gate passes, use already-authorized intended CLI logins and verified permission profiles for tiny live probes. Select an available real profile explicitly. Run the disposable task with the remaining build live budget enforced in the child controller. No production project is the proving fixture.

Record host, executable/provider versions, auth-route evidence without secrets, role/session identities, actual candidate SHA, full diff, command results and external oracle. At least one real complete profile on the Mac is required for the live-working-team claim. A mixed-profile run is separate optional evidence at this stage.

An unavailable second provider must not invalidate already completed offline work, but must remain unverified. Missing the required first live proof yields overall BLOCKED with a precise human setup action, not fabricated readiness.

Review the application's complete diff against all product acceptance criteria. An independent fresh reviewer process is valuable if safely available within budget; label self-review honestly when it is the only review performed. Runtime worker independence is tested separately from review of the orchestrator's own code.

Exit: evidence-backed AC table, actual usage commands, candidate/code handoff, remaining limits and Yiğit's focused review checklist. No automatic merge, push, deploy or human approval.

B.4 Build checkpoint and stopping

After every milestone or meaningful interruption, update .ai/STATUS.md with:

current build state/milestone and rounds consumed;

completed code and actual command outputs/log references;

acceptance evidence and missing tests;

stable issues, repair intervention history, failed-repair total and live-child reservations;

material decisions, risks, verified provider/host status and exact next action.

Do not write “100%” or “all tests passed” without supporting checks. A resolved missing-spec preflight is not a continuing blocker once these files are read.

Stop with READY_FOR_HUMAN_REVIEW only when the required product proof exists. Otherwise stop BLOCKED with a precise bounded reason, or PAUSED at the user's request. Provide useful completed code and evidence even for a blocked outcome. No promises of continuing in the background.

Part II — Runtime controlled by the built application

R.1 Authoritative default limits

Resolve these into the immutable run configuration. A human may choose lower ceilings before starting. Runtime workers cannot raise them.

Key

Default

Meaning

maxMilestones

4

Maximum accepted architect plan size

maxRoundsPerMilestone

4

Initial implementation plus at most three correction rounds

maxRepairInvocationsPerIssue

3

Lifetime controller-reserved repair invocations for the issue

maxAgentInvocationsPerRun

24

All role, context-refill, retry and repair worker calls combined

maxConcurrentAgents

2

Only independent nonwriting work can overlap

maxConcurrentWriters

1

One source-writing role at a time

agentTimeoutMs

600000

Hard deadline per supervised worker: 10 minutes

validatorTimeoutMs

180000

Default per validator: 3 minutes

setupTimeoutMs

600000

Bound for an approved setup command

maxActiveRuntimeMs

5400000

Accumulated active elapsed time: 90 minutes

terminationGraceMs

5000

Grace before forced owned-group termination

maxTransportRetriesPerInvocation

1

Only clearly nonmutating/pre-execution transient failures

maxContextRefillsPerRoleStep

1

One additional fresh call with requested safe context/evidence

maxInputBytesPerInvocation

262144

Explicit bounded context packet

maxStdoutBytesPerInvocation

5242880

Abort on excess; do not silently lose the final result

maxStderrBytesPerInvocation

1048576

Abort on excess

maxArtifactBytesPerRun

104857600

Controller-written journal/reports/logs/packets; stop at 100 MiB

The artifact limit applies to controller-written records, not Git object storage, source checkouts or installed node_modules. Do not claim it bounds all filesystem growth by repository scripts; restrict setup/output paths and expose that limitation. All caps are ceilings, not expected completion times or guaranteed task sizes.

An invocation is one supervised provider process. That process may make several internal model/tool calls. The controller's cap is NOT a fixed token/currency budget or a count of private reasoning steps. Provider-internal nesting/teams must not be enabled by this workflow.

R.2 Repair and issue accounting

A repair attempt is a controller-authorized Implementer invocation aimed at one or more registered defects after failed validation/review/QA. Reserve a repair credit for EACH targeted issue before dispatch. Interrupted, malformed and unsuccessful repair calls still consume reservations.

Initial implementation is round 1 and not a repair. Diagnostics without a new intervention are not repair credits, but any new model process still counts against the global invocation ceiling.

Controller issue IDs survive phases, sessions and resumption. Match deterministic keys such as validator/test ID or criterion/path/symptom; keep aliases and union reservation IDs on merge. Reopened issues retain consumed attempts. A model cannot obtain fresh credit by changing a finding title.

Natural-language duplicate detection is imperfect. Ambiguous matches to an exhausted issue require human resolution; round/call/time caps remain independent backstops. Do not claim perfect semantic root-cause detection.

The hard guarantee is at most three dispatched repair calls per issue. Role prompts request one focused intervention; the supervisor cannot count every small edit/hypothesis inside a CLI call.

R.3 Start, baseline and plan

Validate target/task/config/profile, explicit trusted-local/live flags and command approvals. Acquire exclusive run and repository ownership.

Freeze input snapshots and hashes. Validate clean target/base commit and protected source. Probe required provider capabilities/auth route without reading credentials. Missing capability/approval blocks before a live worker.

Create managed worktrees; execute only approved setup commands. Run required baseline checks on the base SHA. Unexpected failures block; explicitly listed expected failures remain mandatory to fix by final validation.

Reserve and dispatch Architect and QA PLAN on separate baseline observer copies, at most two processes. Fresh sessions only.

Validate plan shape, scope, all required criterion coverage, earlier dependencies and milestone cap. One bounded context refill may resolve missing context. Do not start a recursive planning loop; a material unresolved ambiguity or invalid plan then blocks.

R.4 One milestone round

For each milestone in order:

Check stops, all remaining budgets, actual process/workspace integrity and milestone prerequisites. Persist the opened round.

Reserve one fresh Implementer invocation. Round 1 implements the milestone; later rounds target registered findings and reserve repair credits. No second writer.

Wait for full process exit. Audit actual files/refs/scope and compare declarations with evidence. On unknown process state, pause and reconcile; do not start another writer.

Controller checkpoints a valid candidate and records its SHA/digest. Run required applicable candidate validators on that exact candidate.

If a required check fails, register/deduplicate defects and move to decision. Normally avoid spending Reviewer/QA calls on a known failing deterministic gate.

If checks pass, reserve Reviewer and QA CHECK on separate frozen copies of the SAME candidate. They receive spec/diff/relevant source/checks, not the Implementer's transcript. Writer remains idle.

Validate result envelopes and assessed criteria. Execute requested approved check IDs only through the controller and within the bounded refill/remaining budgets. Unapproved essential checks become a precise human dependency.

Aggregate evidence and record a round decision durably. At the last milestone, assess all required criteria and the full base-to-candidate change.

The final milestone round is the final cumulative review; do not duplicate it with unlimited extra “one more final review” calls. Any additional invocation must have a reason and consume the same global budget.

R.5 Round decision and mandatory exit

Condition

Action

Assessed required criteria and validators pass; no unresolved critical/major issue

Complete milestone; proceed to next, or final handoff

Blocking finding has issue credit and another milestone round fits all caps

Begin one correction round with existing issue IDs/evidence

Third repair fails, round 4 fails, or global call/time/artifact cap prevents required work

BLOCKED; stop launching agents and preserve evidence

Auth or rate/quota condition

PAUSED; no code-repair attempt and no automatic provider/account switch

Essential missing context after allowed refill, missing safe capability or command approval

BLOCKED with precise reason

Optional minor concern that violates no required gate

Document in handoff; do not weaken a required check

For v0.1 an exhausted required runtime issue stops the whole runtime. Do not burn more calls on unrelated milestones after completion is blocked. This differs from the builder being allowed to finish independent offline components when live login is missing.

Budget stop is an acceptable bounded outcome, not permission to open another run automatically. Only an explicit human decision can begin genuinely new work; the stopped run's consumed history remains intact.

R.6 Error retries

No adapter-local hidden retry loop. At most one outer transport retry may occur when evidence shows no mutating work started. Reserve a new global invocation first. A timeout/disconnection of a writer is NOT evidence that no work occurred.

Auth, quota, permission and policy denials are not transient code defects to repair repeatedly. Pause or block immediately according to the error. A malformed output is INVALID_RESULT; one safe reissue may use the transport allowance only if it was demonstrably nonmutating. Otherwise preserve partial work and reconcile/block.

Unknown errors are not assumed harmless. Do not parse success from optimistic prose while protocol/process evidence shows failure.

R.7 Pause, cancel and resume

Ctrl+C requests PAUSED; cancel requests CANCELLED. During active operations the owner observes the request, terminates owned process groups, confirms exit where possible, persists results and stops. Failure to confirm termination is explicit and prevents a replacement writer.

Resume uses the immutable internal task/config snapshots. Rebuild state from the journal, verify ownership/process identities, base/candidate/protected-file hashes and budgets. Original task-note edits are visible as divergence but are not silently loaded. Internal snapshot tampering blocks.

A possibly interrupted writer's filesystem changes remain unverified until reconciled; do not discard them, assume rollback or replay the invocation automatically. Reservations stay consumed. Re-probe changed provider versions before further calls.

State

Resume policy

PAUSED

Explicit resume after resolving auth/interruption and reconciling state

BLOCKED: missing install/capability/setup

Resume only after external blocker resolved without altering frozen permissions/inputs

BLOCKED: exhausted budget

No budget reset or automatic continuation in this run

BLOCKED: scope/input/state problem

Human resolution required; never silently replace immutable evidence

FAILED: unrecoverable state corruption

No blind replay

CANCELLED

Not resumable

READY_FOR_HUMAN_REVIEW

Autonomous work is finished; no automatic continuation

Changing approved command definitions, role bindings, scope or limits requires a human-controlled new input/run, not an invisible edit during resume. The controller never performs final approval.

R.8 Final readiness predicate

Only application code may set READY_FOR_HUMAN_REVIEW. All must hold:

all required acceptance criteria have PASS assessments with evidence for the final candidate;

all required final validators have actual passing exit records on that same candidate;

independent Reviewer and QA CHECK results refer to that final SHA;

no unresolved critical/major finding, mandatory NOT_VERIFIED result or scope/permission violation;

cumulative diff/source digest/protected-file audit and internal input hashes are consistent;

no worker is running or uncertain; all reservations/limits/stop requests were respected;

handoff, acceptance records and human-readable status are durably written.

SIMULATION readiness remains SIMULATION. Code without qualifying review/QA/validation cannot reach readiness. A pending human code review is expected; a required automated check that was never run is not excused by that human boundary.

R.9 Handoff and export

Produce the exact candidate worktree path, branch, base/final SHA, cumulative diff, task/profile/verification mode, criterion evidence, actual commands/results, findings/attempts, consumed budgets, auth/setup limitations and focused review areas.

Separate executed sanity/smoke evidence from supplementary manual procedures for Yiğit. No unsupported “production ready” claim.

export creates a nonoverwriting Markdown snapshot in the explicit destination, without model calls or authority changes. It does not initiate a run, approve code, ingest the rest of a vault, upload source or reset state. Editing the export never changes this state machine.
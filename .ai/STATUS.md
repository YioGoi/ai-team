Build Status — AI Team v0.1

Revision: 2026-09-19. This is the BUILD ledger for the AI Team application, not a runtime task journal.

Current state

State: NOT_RECONCILED

Current milestone: B0 — inspect existing workspace, reconcile history, create runnable skeleton.

Next action: read the five build documents, inspect actual files/Git/tools, reconcile previous execution evidence, then begin the first uncompleted build step.

Product specification: FILLED in .ai/SPEC.md.

Host/tool availability: NOT_VERIFIED by this document package.

Application source/tests: NOT_VERIFIED; generated specification files are not implementation proof.

Last actual implementation checkpoint: not established.

Known legacy context

The supplied screenshot showed the existing ai-team workspace with AGENTS.md and four .ai documents. Its old SPEC was a generic blank feature template, and Codex stopped requesting feature requirements and a target project. This replacement defines the product itself and confirms the current application workspace as the build target.

Archive/preserve any old status evidence before replacement. During B0 distinguish an old missing-spec preflight stop from actual implementation attempts. Preserve all genuine counters, code and logs. Do not reset real history just because this file was replaced. If inspection confirms no implementation had begun, record that evidence and initialize the implementation counters then.

Milestone ledger

Milestone

Purpose

State

Rounds consumed

Actual evidence

B0

Reconciliation, skeleton, contracts

NOT_RECONCILED

Unverified

None supplied in this package

B1

State, budgets, issue registry

NOT_VERIFIED

Unverified

None

B2

Process supervision, fake workers, locks

NOT_VERIFIED

Unverified

None

B3

Worktrees, candidate identity, validation

NOT_VERIFIED

Unverified

None

B4

Complete offline workflow and independent oracle

NOT_VERIFIED

Unverified

None

B5

Codex and Claude adapters

NOT_VERIFIED

Unverified

None

B6

User commands, report export, usage documentation

NOT_VERIFIED

Unverified

None

B7

Bounded live proof and engineering handoff

NOT_VERIFIED

Unverified

None

Bootstrap budgets — reconcile before incrementing

Limits are defined in .ai/WORKFLOW.md, Part I. They are NOT the application's runtime counters.

Counter

Consumed

Ceiling

Failed repair interventions across this build

Not established

18

Real model-consuming CHILD invocations (including app live workers)

Not established

12

Failed repairs for one root build issue

Per-issue ledger below

3

Rounds for one build milestone

Milestone ledger above

4

Before an intervention/child call, record a reservation and its purpose. Afterwards record the outcome. A context reset or restart does not erase reservations.

Issue and intervention ledger

No new implementation failure has been established by this package. For each observed issue record:

stable issue ID, symptom, evidence and affected acceptance criteria;

prior aliases/related issue IDs, without granting new repair credit;

intervention number, hypothesis, actual change and validation command;

result and remaining budget;

exact next safe action or required human decision.

Do not insert invented sample failures as real execution history.

Live-child ledger

No live evidence is supplied. Reconcile any actual prior calls. For each authorized model-consuming child invocation record reservation ID, purpose, provider, profile, maximum permitted downstream calls, actual result and cumulative consumption. A live app run consumes one reservation per real child worker, not one reservation for the whole team.

Verification matrix

Check

Outcome

Evidence

Local dependency install / lockfile

NOT_VERIFIED

Inspect workspace

Typecheck / lint / build

NOT_VERIFIED

No commands run by this package

Unit tests

NOT_VERIFIED

No execution evidence

Actual subprocess and Git integration tests

NOT_VERIFIED

No execution evidence

Offline smoke with fixed external behavioral oracle

NOT_VERIFIED

No execution evidence

macOS process-tree cleanup / recovery

NOT_VERIFIED

Host not inspected

Codex CLI version, safe profile, intended login

NOT_VERIFIED

Inspect without reading credentials

Claude CLI version, safe profile, intended login

NOT_VERIFIED

Inspect without reading credentials

Codex live adapter

NOT_RUN

Requires authorized opt-in check

Claude live adapter

NOT_RUN

Requires authorized opt-in check

One complete real-provider workflow on Mac

NOT_RUN

Application and live proof required

Mixed-provider live workflow

NOT_RUN

Separate verification, not assumed

Obsidian-compatible selected task / Markdown export

NOT_VERIFIED

Use temporary directories in tests

Independent review of built application

NOT_RUN

Must not relabel self-review

Decisions

Selected architecture and numeric policies are in SPEC and WORKFLOW. Record material implementation decisions here with reason, evidence, tradeoff and reversibility. Do not silently weaken an acceptance criterion or expand provider/billing permissions.

Current human dependencies

None confirmed yet. Product requirements are not missing. Possible future dependencies include a missing CLI installation, direct provider login, OS/network permission, command approval or live quota. Report only those actually observed, with the precise action required; never request tokens or passwords in chat.

Final handoff record

Not ready by evidence in this package. Populate after implementation with: exact runnable commands, cumulative diff, AC-by-AC outcomes, actual validator results, current host and provider proof, unresolved risks, consumed budgets and focused human spec/code-smell/sanity/smoke checks.

A stopped BLOCKED build may still contain useful completed code. A simulation or Markdown checklist must never be presented as proof of a working live team.
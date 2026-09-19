AI Team v0.1 — Build Instructions

Revision: 2026-09-19. This is the instruction file for building the AI Team application itself.

1. The actual assignment

Build a reusable, local macOS command-line application that coordinates four independent software-engineering agents: Architect, Implementer, Reviewer and QA. The controller is ordinary TypeScript code. Roles use interchangeable Codex / Claude Code CLI adapters.

The current ai-team workspace IS the application repository. An initially empty source tree is expected. Do not ask for another application's path or for a missing feature specification: the full product specification is .ai/SPEC.md. Do not substitute role-playing prompts or a mock-only demonstration for runnable software.

Preserve this instruction layout:

AGENTS.md
.ai/GOAL.md
.ai/SPEC.md
.ai/WORKFLOW.md
.ai/STATUS.md

Do not migrate instructions to a docs/MANIFEST.md structure. Source, tests, package files, a usage README and runtime role assets will of course be created while implementing the application; the five-file rule concerns these build instructions, not the application's source layout.

2. Read before implementation

Read ALL five files, in this order:

AGENTS.md

.ai/GOAL.md

.ai/SPEC.md

.ai/WORKFLOW.md

.ai/STATUS.md

Continue partial file reads until complete. On resume, verify recorded progress against actual files and test evidence. Do not reread every generated log or unrelated Markdown file into every worker's context.

Authority: platform rules and explicit human instructions first; mandatory permission/human-review boundaries cannot be weakened. SPEC defines product behavior and contracts. WORKFLOW defines bootstrap and runtime budgets separately. STATUS records facts, not permission to change either specification. Document contradictions and choose the narrower permission; ask only for a genuinely missing consequential decision.

3. Existing workspace and legacy status

The screenshot showed old generic .ai templates and a Codex stop caused by missing requirements. These replacement specifications resolve that design-input problem. A prior BLOCKED: missing feature spec is not evidence that this new product goal is undefined.

Before writing code, inspect the actual workspace, Git root/status and local tools. Preserve user code and genuine execution history. Reconcile any previous STATUS or backup; do not silently reset real repair/call counters. If the only previous activity was an unfilled-template preflight, record that and begin the new implementation ledger with evidence. Do not invent historical tests or claim zero previous work without inspection.

Work only in this standalone application and disposable test repositories. Do not alter Mind Palace, work repositories, a parent Git repository, personal vaults or global provider settings. A fresh standalone directory may be initialized with local Git after checking its boundaries. No remote is needed.

4. Invariants

Each role invocation is a separate OS process, fresh provider session, input packet and result artifact. A single conversation switching roles is not an independent team.

The core workflow depends on role contracts, not provider names or model IDs.

Only Implementer edits target candidate source. Reviewer and QA inspect the same frozen candidate after the writer exits.

The controller owns dispatch, checkpoints, state transitions, issue IDs, budgets, real validation evidence and the readiness decision.

Reserve budgets durably BEFORE dispatch. No fourth autonomous repair invocation for a root issue; no reset by resume, renaming, provider switch or replacement run.

A worktree separates working copies; it is not an OS security sandbox. State the trusted-local limitation.

Use official CLI authentication directly. Never collect login tokens, read credential stores, proxy subscription credentials, silently choose API billing or bypass permissions.

No recursive worker teams, automatic merge/push/deploy, subscription purchase or final human approval.

A simulation PASS is not a live-provider PASS. Self-review is not independent review.

5. Implementation discipline

Use the filled specification, small verifiable milestones and actual repository conventions. Prefer Node built-ins and a small dependency set. Avoid speculative frameworks and unrelated cleanup. Runtime-schema definitions must drive both TypeScript types and provider JSON schemas.

First prove the core with deterministic tests, real fake subprocesses and temporary Git repositories. Then implement BOTH real adapters, and finally run bounded opt-in live verification using an already-authorized intended CLI login. Missing Claude access does not justify a Claude stub or prevent independent offline development.

Check actual installed CLI versions, help, authentication route and supported permissions. In particular, do not use Claude --bare for a saved-subscription profile merely to avoid ambient configuration; consult the provider section of SPEC. Do not guess flags, fall back to API credits or rewrite global configuration.

Local application dependencies and disposable fixture setup are in scope, subject to actual environment approvals. Global npm/Homebrew installs, browser login, OS prompts, account/billing changes and unrelated filesystem access require the human. Do not ask for secrets in chat.

6. Stop and handoff

Follow the bootstrap limits in WORKFLOW while building. These are instructions and a persistent ledger for the parent Codex session, not an already-existing hard watchdog. The product's separate runtime limits must be enforced by tested application code.

After each milestone or interruption update .ai/STATUS.md: evidence, exact checks, issue/round/call counters, decisions, next action and human dependencies. Stop at a justified READY_FOR_HUMAN_REVIEW, BLOCKED or human-requested PAUSED outcome. Do not continue indefinitely to obtain a green label.

The handoff includes runnable usage, actual tests, unverified providers/platform behavior, cumulative diff, risks, and Yiğit's spec/code-smell/sanity/smoke review focus. Never imply that files alone installed the application, that unrun tests passed, or that the human has approved it.
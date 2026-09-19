Product Goal — AI Team v0.1

Revision: 2026-09-19. Filled product goal, not a future-feature template.

The product we are building now

A reusable local macOS CLI that accepts a trusted local Git repository and a defined engineering task, coordinates independent model-agnostic agents, validates the candidate, stops within explicit budgets and gives Yiğit an evidence-backed human-review handoff.

Yiğit: task + target repository + approved profile/commands
                        |
             TypeScript controller
                        |
       Architect + QA plan (separate sessions)
                        |
          Implementer (one source writer)
                        |
        controller validation on candidate SHA
                        |
       Reviewer + QA check (separate sessions)
                        |
          bounded repair or final handoff
                        |
              Yiğit's final review

The workflow does not require a fifth manager model. Provider independence means changing a role's binding in configuration rather than rewriting orchestration. It does not promise identical features or identical quality from every provider.

Two different operations

A. Build this application once

Codex, opened in the existing ai-team VS Code workspace, reads these five documents and creates the application, tests and usage documentation. This is the current task. No other application path is missing.

B. Use the built application on a project

Later, Yiğit opens a target project in VS Code, starts AI Team from the integrated terminal, supplies the target path, a task Markdown file and a profile, and follows its progress. The application launches official CLI subprocesses itself. He does not manually open four chat panels or copy the AI Team implementation into every project.

The v0.1 target has a minimal scaffold, a local Git initial commit and approved setup/test commands. A completely blank greenfield product is first scaffolded by the human or a separately authorized coding task. AI Team does not silently choose its stack, invent product requirements or initialize an unrelated repository. A GitHub or GitLab remote is unnecessary.

Keep these three locations separate:

application repository: source for AI Team, including these build documents;

target repository: the user's product, unchanged in its original checkout during a run;

runtime state/worktrees: controller-owned data outside the target repository.

Required user experience

The built CLI must let Yiğit:

inspect local dependencies and provider capabilities without spending model calls;

register a local target and review proposed setup/validation commands;

select codex-only, claude-only or mixed (and mock for tests);

run one bounded task, see actual phase/agent/round/issue state, and pause/cancel;

explicitly resume eligible stopped work without gaining new retry credit;

open the exact candidate worktree and inspect the cumulative diff, requirements, tests and findings;

export a read-only Markdown summary into an explicitly selected folder, including an Obsidian vault folder.

All tasks, commands and reports must have meaningful IDs and real evidence. No invented completion percentages or remaining subscription quotas.

v0.1 scope

Node.js/TypeScript, Git worktrees, child-process adapters, explicit structured contracts, local event journal and artifacts, deterministic validation, bounded repair loops and human handoff. One code writer; at most two concurrent independent readers.

No dashboard, VS Code extension, MCP server, remote API agent engine, database, cloud deployment, job queue, always-on daemon or automatic merge. A future screen can reuse the same application services/events. Obsidian support initially uses selected Markdown task files and an explicit one-way report export, not a plugin or two-way state synchronization.

“Local” refers to orchestration, files and tests. Codex/Claude model calls normally reach their provider over the internet. This is not an offline/local-model product.

Definition of a truthful delivery

Separate four claims:

Core verified: deterministic unit, subprocess, Git and meaningful offline smoke tests passed.

Adapter implemented: both real adapter implementations and offline contract tests exist; no stubs.

Local live workflow verified: at least one actual provider profile completed the disposable fixture on the target Mac with separate roles and an independently checked code change.

Mixed profile verified: Codex and Claude were actually used together. Leave this unverified until tested; it is not a prerequisite for finishing all independent development.

Without required live proof, deliver the completed code with a precise BLOCKED live-verification reason, not “the team is running on your Mac.” Availability of a subscription and remaining quota must be discovered, not assumed.

Human boundary

The successful runtime state is READY_FOR_HUMAN_REVIEW, never DONE or HUMAN_APPROVED.

Yiğit checks specification compliance, architecture, code smells, unnecessary complexity, regression risk, sanity, smoke behavior and the final diff. Supplementary manual review steps remain explicitly unexecuted until he performs them. The application does not merge, push, deploy or convert an edited note/report into approval.
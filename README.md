# AI Team

A local macOS command-line application that coordinates four independent software-engineering roles: Architect, Implementer, Reviewer and QA.

The **Orchestrator** is the TypeScript controller directly below the human. It starts separate provider processes, records validation evidence, enforces repair budgets and decides when a candidate is ready for human review. Final code review and integration belong to you.

Both Codex and Claude Code adapters are implemented. Codex has completed live workflows on macOS; Claude and mixed-provider live use remain unverified. See [verification evidence and limitations](docs/VERIFICATION.md). Mock runs are always labelled `SIMULATION`.

## Build and check

Requirements: macOS, Git and Node.js 24 recommended (package minimum 22; only the recorded host is verified).

```sh
npm ci
npm run check
npm run ai -- --help
npm run ai -- doctor
```

`check` runs formatting, type checking, lint, unit/integration tests, build and smoke tests with an external behavioral oracle. Default tests use temporary Git repositories and real fake subprocesses; they make no model calls. `npm run format` formats maintained files. `npm run build` creates `dist/cli.js` and runtime assets; it does not globally install the command.

For machine-readable output, use `node dist/cli.js doctor --json`; npm adds its own banner. `doctor` checks local versions, capabilities and authentication status without inference. Install and sign in to the official provider CLI yourself. The configured route uses its saved subscription login; AI Team neither collects credentials nor silently falls back to API billing. Provider usage limits still apply.

An optional diagnostic spends at most one read-only provider invocation:

```sh
npm run ai -- doctor --live --provider codex --allow-provider-calls
```

A diagnostic PASS is not a complete team proof. One CLI invocation may make several internal model/tool calls; invocation limits are not token or currency caps.

## Register a target

Keep three locations separate: this application checkout, your target checkout, and controller state. The target needs a minimal scaffold, an initial Git commit and a clean checkout. No remote is required.

From your target terminal, set the actual application path:

```sh
AI_TEAM_APP="/absolute/path/to/ai-team"
npm --prefix "$AI_TEAM_APP" run ai -- init --repo "$PWD" --profile codex-only
```

Profiles: `codex-only`, `claude-only`, `mixed` (Claude Architect/Reviewer, Codex Implementer/QA), and test-only `mock`. Every invocation has a fresh process/session. An unavailable provider never silently substitutes another profile.

`init` prints the config path under `~/Library/Application Support/AI Team/projects/`. An absolute `AI_TEAM_HOME` overrides this state root; use the same value for later commands. It must be outside target repositories. Repeated initialization refuses to overwrite an existing config.

Review the generated config before running:

- Confirm repository, profile and model bindings. `null` uses the CLI default.
- Inspect each setup/validator executable, argument array and working directory. Discovered commands start with `approved: false`.
- Approve only trusted commands and require at least one candidate validator. Declare generated output paths, such as `build/`, explicitly. Tracked files remain audited.
- Dependency installation and lifecycle scripts require a separately approved setup command.
- Set `approval.reviewedAt` to the actual ISO UTC review timestamp. Limits may be lowered before a run, never raised above built-in ceilings.

Credentials, provider configuration, Git state, package scripts, lockfiles and instruction files are protected. Tasks needing execution-surface changes require human resolution.

## Run and observe

A task is a selected Markdown file containing exactly one fenced JSON block. [examples/SMOKE_TASK.md](examples/SMOKE_TASK.md) is a complete contract for the disposable `normalizeTitle` fixture; replace its requirements, criteria, scope and validator IDs for another project. The build specification in `.ai/SPEC.md` is not a runtime task.

Set `CONFIG` to the printed config path and `TASK` to your selected task path:

```sh
npm --prefix "$AI_TEAM_APP" run ai -- run \
  --config "$CONFIG" --task "$TASK" \
  --ack-trusted-local --allow-provider-calls
```

Omit the provider-call flag only for an explicitly selected mock profile. Mock's patch behavior supports the proving fixture, not arbitrary projects. Task files may be outside the target, including a chosen vault file; there is no vault scan or linked-note ingestion.

The foreground process prints actual phases, counters, agent activity and the candidate path. Human progress goes to stderr. Task/config/role inputs are frozen. Closing the terminal or putting the machine to sleep does not guarantee continued work.

Use the printed run ID in another terminal:

```sh
node "$AI_TEAM_APP/dist/cli.js" status "$RUN_ID"
node "$AI_TEAM_APP/dist/cli.js" status "$RUN_ID" --json
```

`status` is a snapshot and makes no model call. The foreground run provides live progress; there is no monitoring daemon or dashboard.

## Pause and recover

Ctrl+C requests a resumable pause and waits for owned children to stop. Explicit cancellation is terminal:

```sh
node "$AI_TEAM_APP/dist/cli.js" cancel "$RUN_ID"
node "$AI_TEAM_APP/dist/cli.js" resume "$RUN_ID" \
  --ack-trusted-local --allow-provider-calls
```

Resume preserves calls, rounds, repair credits and active time. It rechecks ownership, frozen inputs, candidate/source identity and provider capabilities. External task/config edits produce a notice; the immutable internal snapshots remain authoritative. Revised scope or bindings require explicit new work, never a replacement run to evade exhausted budgets. Cancelled and ready runs cannot resume.

Auth/quota pauses require external action. Unknown process ownership, interrupted validators, incomplete checkpoints, changed source/refs or internal snapshot tampering stop recovery. Partial code and evidence remain available. Do not delete locks or edit the journal to force success. An interrupted ownership guard is not automatically stolen, and a recorded PID alone never authorizes killing a process.

Two explicit reconciliation paths are available:

- `--reconcile-context`: for a repair that exited without edits while requesting its current validator log. It verifies unchanged inputs/candidate, process exits, failure evidence and budgets, then closes that failed round. The next repair consumes another credit.
- `--reconcile-writer TOKEN`: for a confirmed exited Implementer stopped by an output limit or deadline before a result/checkpoint. Inspect the current files before selecting them for recovery:

```sh
node "$AI_TEAM_APP/dist/cli.js" status "$RUN_ID" --recovery --json
# Review changedPaths and all changed/new files at candidateWorktree.
# Set REVIEW_TOKEN to the exact reviewToken from that inspection.
node "$AI_TEAM_APP/dist/cli.js" resume "$RUN_ID" \
  --ack-trusted-local --allow-provider-calls --reconcile-writer "$REVIEW_TOKEN"
```

Inspection makes no model call or journal/source write. The token binds the run, invocation, frozen inputs and candidate content. Recovery rejects stale content, staged edits, ref or mode changes, protected/out-of-scope files, submodules and exhausted budgets. The two reconciliation flags cannot be combined.

Writer recovery checkpoints reviewed edits without inventing a successful worker result or refunding credits. Actual validators and fresh Reviewer/QA still run. A crash between checkpoint and durable reconciliation remains a manual recovery boundary; a hard crash has no exactly-once guarantee. After a recorded reconciliation, use normal resume. Output caps remain enforced; use a compatible provider CLI.

## Review and export

Open the printed candidate worktree after the run stops. Read `artifacts/HANDOFF.md`, `artifacts/acceptance.json`, validator records and `artifacts/candidate.patch`. Checkpoint commits can leave the editor's Changes panel empty: review the complete base-to-candidate diff. Do not edit a running candidate.

For an explicit Markdown export, select an existing absolute directory outside targets and authoritative state:

```sh
node "$AI_TEAM_APP/dist/cli.js" export "$RUN_ID" --dir "$REPORTS"
```

Export creates a new subdirectory containing `SUMMARY.md`; it excludes raw transcripts/logs and source diff bodies. Names, paths and SHAs may still be sensitive. Editing exported notes cannot approve, resume or change a run.

## Limits and trust

Default ceilings: 4 milestones, 4 rounds per milestone, 3 repairs per issue, 24 worker invocations, 90 minutes active time, 10 minutes per agent, 3 minutes per validator and 100 MiB of controller artifacts. One writer and at most two readers are allowed; the current implementation schedules roles sequentially. Artifact limits do not bound Git objects or dependencies.

Worktrees separate working copies; they are not an OS sandbox for hostile repositories. Approved scripts and same-user provider tools can access local resources. Worktrees, branches and evidence are retained for review. There is no automatic merge, push, deployment, final approval or target cleanup.

Exit codes: 0 informational success/readiness, 2 invalid input, 3 blocked, 4 paused, 5 state failure, 130 cancelled.

## Repository layout

- `src/`: application services, controller, domain contracts, provider adapters and infrastructure.
- `assets/roles/`: the four runtime role instructions.
- `tests/`: deterministic contracts, subprocess/Git integration and external-oracle smoke tests.
- `examples/`: the filled proving task.
- `scripts/`: asset packaging and the optional live proving harness. `live-proof.mjs` requires an explicit provider-call flag and creates disposable targets; default checks never invoke it.
- `AGENTS.md` and `.ai/`: persistent build instructions and the current execution ledger.

Local execution logs, presentation files and historical snapshots belong under ignored `review/` or `.local/`, not in a pushed source tree. Local cleanup preserves genuine execution history; it does not rewrite completed target runs.

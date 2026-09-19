AI Team v0.1 — Product and Technical Specification

Revision: 2026-09-19. This specification is complete enough to start implementation.

Build target: the current standalone ai-team repository. The product is a reusable local CLI, not a feature in an unspecified existing app. This document replaces the earlier blank feature template and consolidates the previous expanded specification into the existing five-document structure.

Numeric budgets and exact round/stop semantics are authoritative in .ai/WORKFLOW.md. These are chosen product policies, not provider guarantees. Installation, account access and successful tests must be established on the real host.

1. Scope, stack and package

1.1 Required implementation

One npm package using TypeScript strict mode, ESM, Node.js and Git. Prefer Node 24 LTS for the development host; Node 22 is an acceptable minimum only when the resolved dependencies and tests support it. Pin resolved versions in package-lock.json. Use Node built-ins for processes, filesystem, paths, hashing, argument parsing and timing; use one schema library such as Zod, Vitest and normal TypeScript/ESLint tooling.

The application starts unmodified official codex and claude CLI executables through separate adapters. No direct model API client or agent SDK is required by this v0.1 design. A CLI provider's internal model calls are still remote calls and use that provider's account limits.

Use a compiled entrypoint, for example dist/cli.js, and these actual package scripts:

Script

Required behavior

build

Compile the app and package required role/schema assets

typecheck

TypeScript checking without misleading success on missing sources

lint

Validate application and test code

test

Unit and integration tests; no live inference by default

smoke

Disposable, deterministic end-to-end workflow with an external behavioral oracle

check

Run the full offline quality gate with failures propagated

ai

Start the compiled CLI; forward arguments correctly

Produce a README with the commands actually implemented, local dependency setup and failure recovery. Merely listing scripts without implementation is insufficient.

1.2 Outside v0.1

No React/Next dashboard, VS Code extension, MCP server, Desktop Commander bridge, database, Redis/queue, GitHub/GitLab requirement, Docker requirement, hosted backend, cron/daemon, automatic remote repository creation, deployment or merge. No provider-native team feature is required. Do not add LangChain/CrewAI/LangGraph simply because this is an agent application.

Expose ordinary typed application services and normalized events so a later screen can reuse them. Do not build an unused web API now.

1.3 Supported initial targets

Trusted local Git repositories on macOS, initially proved with a small Node/TypeScript project. Other project stacks may work through approved executable commands, but do not advertise them as tested until verified.

A runtime target must have a clean source checkout, an initial commit, explicit task criteria and at least one required candidate validator. A brand-new product is minimally scaffolded first. An empty folder produces an actionable explanation, not invented requirements or an unauthorized scaffold. This target precondition does NOT prevent the builder from creating AI Team itself from the present specification-only workspace.

2. User workflow and CLI contract

2.1 Three distinct locations

~/Projects/ai-team/                       application source; build docs live here
~/Projects/example-product/               user's target project; opened in VS Code
~/Library/Application Support/AI Team/     controller state and managed worktrees

The paths above illustrate roles, not facts about Yiğit's machine. Resolve actual paths, including spaces and symlinks. The state root must not be inside a registered target repository. AI_TEAM_HOME may override the state root for tests or an explicit user configuration.

The five build documents belong only to the application repository. Do not copy them into every target. A target's own AGENTS.md remains its own guidance; it must not accidentally trigger rebuilding the orchestrator.

2.2 Required commands

All commands are required behavior to implement, not claims that they already exist.

Command after npm run ai --

Required behavior

doctor [--json]

Local-only Node/Git/CLI availability, versions and option/capability checks; no inference, purchase or installation

doctor --live --provider codex|claude --allow-provider-calls

Explicit small bounded capability/auth probe, read-only by default; report real invocation use

init --repo <absolute-path> --profile mock|codex-only|claude-only|mixed

Register a target; propose config and print its exact path; no target-source edit or model call

run --config <absolute-path> --task <absolute-md-path> --ack-trusted-local [--allow-provider-calls]

Start one bounded foreground run from validated inputs; live providers require the extra flag

status <run-id> [--json]

Show persisted phase, role activity, counters, candidate and evidence paths; zero model calls

resume <run-id> --ack-trusted-local [--allow-provider-calls]

Continue only an eligible stopped run after reconciliation; preserve inputs and all counters

cancel <run-id>

Request cancellation from the live owner or cancel eligible stopped work; preserve evidence

export <run-id> --dir <absolute-directory>

Explicit one-way Markdown report export; no model call, approval, resume or raw-log dump

--help works without credentials or a Git repository. Unknown flags/commands and invalid inputs fail before any inference. Machine output is valid structured JSON, not JSON mixed with progress text. Send human progress to the appropriate stream.

The application is a foreground process, not a background service. Ctrl+C requests a resumable pause. Closing the process, sleep or a network loss does not guarantee continued work; recovery must be explicit and truthful.

2.3 Typical VS Code use AFTER the application is built

From a terminal in the target repository, a user can call the single installed application by its path:

AI_TEAM_APP="$HOME/Projects/ai-team"
npm --prefix "$AI_TEAM_APP" run ai -- doctor
npm --prefix "$AI_TEAM_APP" run ai -- init --repo "$PWD" --profile mixed

init prints a config path. The user reviews the role bindings, allowed setup/validation commands and limits. Discovered commands start UNAPPROVED. After review, the user supplies that actual config and their task path:

npm --prefix "$AI_TEAM_APP" run ai -- run \
  --config "/actual/path/printed/by/init/config.json" \
  --task "/actual/path/to/task.md" \
  --ack-trusted-local --allow-provider-calls

These /actual/... paths are syntax examples; the app must print usable real paths in its operational README/example output. Do not bake guessed user paths into source or claim this illustrative command has run.

The app starts workers, not VS Code chat panels. It prints the run ID, phase/round, agent lifecycle and candidate worktree path. Yiğit can open the candidate worktree in a separate VS Code window, inspect the full base-to-candidate diff, test and review it. Do not edit an actively running candidate manually. Controller checkpoints may mean the candidate has no uncommitted Changes in VS Code; review the report's base-to-candidate comparison, not just the uncommitted-files panel. Final integration is a human Git action, never an automatic side effect of readiness.

2.4 Profiles

Profile

Architect

Implementer

Reviewer

QA

mock

mock

mock

mock

mock

codex-only

codex

codex

codex

codex

claude-only

claude

claude

claude

claude

mixed

claude

codex

claude

codex

One provider can serve all four roles, but every invocation must still use a separate process/session. Only providers in the selected profile must be available for that run. Missing Claude must not silently turn mixed into another profile. A user may explicitly choose a different profile for a new run.

Model IDs are optional per-role configuration, not hardcoded current names. Null means the configured CLI default. Record requested versus actually reported model; absent metadata remains unknown. Shared provider accounts do not gain extra quotas because processes have different role names.

3. Module and data boundaries

Suggested implementation layout, not an instruction-layout migration:

src/
  cli.ts
  application/       doctor/init/start/resume/status/cancel/export services
  domain/            schemas, reducer, budgets, issues, readiness predicate
  orchestration/     bounded scheduler and role-packet assembly
  providers/         port, codex, claude, mock, stream decoders
  process/           spawning, environments, timeouts, cancellation
  workspace/         Git operations, path policy, candidate identity
  validation/        approved setup/validator execution and evidence
  persistence/       journal, locks, snapshots, artifacts
  reporting/         terminal/status/handoff/export rendering
assets/roles/        four actual runtime role prompts
examples/           filled smoke task and sample configuration
tests/              normal unit/integration fixtures

Consolidate directories when useful; preserve responsibility boundaries. Domain code does not import provider SDKs, provider CLI flags or terminal rendering. Adapters cannot make workflow decisions or implement hidden retry loops.

3.1 Shared vocabulary

type Role = 'architect' | 'implementer' | 'reviewer' | 'qa';
type ProviderId = 'codex' | 'claude' | 'mock';
type RunStatus = 'RUNNING' | 'PAUSED' | 'BLOCKED' | 'FAILED'
  | 'CANCELLED' | 'READY_FOR_HUMAN_REVIEW';
type Phase = 'PREFLIGHT' | 'BASELINE' | 'PLANNING' | 'IMPLEMENTING'
  | 'VALIDATING' | 'REVIEW_QA' | 'DECIDING' | 'HANDOFF';
type CheckOutcome = 'PASS' | 'FAIL' | 'NOT_VERIFIED' | 'NOT_APPLICABLE';
type Severity = 'CRITICAL' | 'MAJOR' | 'MINOR' | 'NOTE';
type VerificationMode = 'SIMULATION' | 'LIVE';

Keep status and phase separate. A paused run retains its phase. Never infer LIVE from a successful status. There is no DONE/HUMAN_APPROVED state in v0.1.

3.2 Task input

A runtime task is one Markdown file containing exactly one fenced JSON block matching TaskSpec. Surrounding prose is context; authority-bearing executable commands are never extracted from prose. Implement schema validation and clear location-aware error messages.

interface TaskSpec {
  schemaVersion: 1;
  id: string;
  title: string;
  objective: string;
  requirements: Array<{ id: string; text: string }>;
  acceptanceCriteria: Array<{
    id: string;
    requirementIds: string[];
    text: string;
    required: boolean;
    validatorIds: string[];
    humanReview: string;
  }>;
  scope: { allowedPaths: string[]; forbiddenPaths: string[] };
  constraints: string[];
  nonGoals: string[];
  expectedBaselineFailures: string[];
}

Require nonempty objective/requirements/criteria; unique IDs; valid requirement/validator references; at least one required criterion; no arbitrary extra authority fields. expectedBaselineFailures contains approved validator IDs, not reasons to waive final checks.

Path rules are repo-relative exact files or directory prefixes ending in /. V1 has no executable expressions or globs. Forbidden/protected rules win. Reject absolute source paths, .. and escaping symlinks; component boundaries matter (src/ must not match src-other/).

A task file may be outside the repository, including inside an Obsidian vault. The user supplies that exact file. Snapshot its contents/hash at run creation. No vault scan, backlinks traversal or automatic transclusion. .ai/SPEC.md is the application's BUILD specification, not a runtime TaskSpec to pass to run.

3.3 Project configuration

The generated schema-versioned config contains projectId, canonical repositoryPath, stateRoot, profile, four roleBindings, setupCommands, validators, protectedPaths, authPolicy, limits and approval metadata. Store it under the application state root, not in the target checkout.

interface RoleBinding { provider: ProviderId; model: string | null }
interface ApprovedCommand {
  id: string;
  executable: string;
  args: string[];
  cwd: string; // worktree-relative; usually '.'
  approved: boolean;
  timeoutMs: number;
}
interface Validator extends ApprovedCommand {
  required: boolean;
  stages: Array<'baseline' | 'candidate'>;
  allowedOutputPaths: string[];
}

init may inspect package scripts and suggest command definitions. It sets approved: false and no approval timestamp. A human explicitly marks reviewed commands approved before they run. Merely finding npm test is not permission to execute arbitrary repository code. Dependency installation/lifecycle scripts are setup commands and also require approval.

Require at least one approved required candidate validator. Store no API keys or login tokens. Initial authPolicy is the intended saved official CLI login, with API-key/cloud-endpoint fallback disallowed. Limits may be lowered before a run; agents cannot increase them. Inputs and resolved limits are frozen when the run starts.

3.4 Provider port and process boundary

interface ProviderCapabilities {
  provider: ProviderId;
  executablePath: string | null;
  version: string | null;
  available: boolean;
  freshSession: boolean;
  structuredResult: boolean;
  readOnlyProfile: boolean;
  workspaceWriteProfile: boolean;
  configuredAuth: 'saved-cli-login' | 'other' | 'unknown';
  limitations: string[];
}
interface InvocationSpec {
  executable: string;
  args: string[];
  cwd: string;
  stdin: string;
  env: Record<string, string>;
}
interface ProviderAdapter {
  probe(): Promise<ProviderCapabilities>;
  buildInvocation(request: AgentRequest): InvocationSpec;
  createDecoder(): ProviderEventDecoder;
  extractResult(events: NormalizedProviderEvent[]): unknown;
}

Implement AgentRequest/ProviderEventDecoder/NormalizedProviderEvent as real schema-checked types. The shared supervisor owns execution. One reserved invocation corresponds to one spawned worker process. The adapter cannot grant a second attempt internally.

Normalize lifecycle/metadata/final-result/error events, preserve bounded unknown diagnostics, and parse arbitrary UTF-8 chunks/JSONL boundaries incrementally. Do not buffer unbounded output just because the method above is illustrative; decoder storage must honor the WORKFLOW byte caps. Unknown terminal semantics fail closed.

3.5 Request and result contracts

AgentRequest includes schemaVersion, runId, invocationId, role, rolePromptHash, taskId/hash, phase, milestoneId, round, baseSha, basisSha, scope, assignedIssueIds, model request, workspace path, structured output schema and a bounded context manifest.

Context lists safe relevant files with hashes and excerpts/line ranges, task/criterion IDs, applicable repository guidance, approved validator evidence and explicit omissions. Do not feed whole repositories, dependencies, credentials, all vault notes or another role's raw transcript. A worker needing more context requests specific safe paths; context refill has a budget.

All role results share this required envelope:

schemaVersion 1; echoed runId, invocationId, taskId, role and input basisSha;

outcome OK, NEEDS_CONTEXT or BLOCKED;

concise ordinary summary; evidence references; requested safe context paths;

findings; role-specific payload as defined in Section 4.

A finding has localId, optional existingIssueId, severity, title, criterionIds, relative file/line references when known, observable symptom, evidence and suggested next action. It has no model-controlled budget, authorization or final state field.

Validate the schema, cross-field identities, known paths/evidence references and required payload. Process exit zero, a provider success event and a valid final result are separate checks. Missing/invalid/wrong-role/wrong-candidate output is not success even when the model writes “done.” Implementer echoes the INPUT basisSha; the controller computes the new post-edit candidate after that process exits.

4. Independent role contracts

Generate four runtime prompt assets from these instructions. These are actual product worker roles, not permission for the builder to pretend a single session is four agents.

4.1 Architect

Read the task, selected baseline code, invariants, baseline checks and scope. Do not edit code, run setup, change Git refs, launch agents or authorize commands. Propose a minimal plan of at most the runtime milestone cap.

Payload: milestones {id, objective, criterionIds, allowedPaths, dependsOn, validatorIds}, invariants, risks and explicit reversible assumptions. Milestones must cover all required criteria, depend only on earlier milestones and narrow the task scope. The controller rejects invalid IDs, cycles, scope expansion and uncovered criteria.

A consequential missing product choice produces BLOCKED; missing safe source can produce NEEDS_CONTEXT. Ordinary small implementation decisions do not require repeatedly asking the human.

4.2 Implementer

The only target-source writer. Inspect relevant code and implement one assigned milestone or one focused repair. Include necessary regression tests within scope. Preserve unrelated behavior and avoid speculative abstractions, dependency changes, test weakening and unrelated refactors.

No agent/provider recursion, commits, ref changes, journals, quota changes, push/deploy or approval. Request human intervention for missing permissions rather than bypassing them. Return one intervention to the controller; do not begin an independent endless repair loop.

Payload: changeSummary, declaredChangedPaths, addressedCriterionIds, addressedIssueIds, testChanges, diagnosticClaims, limitations. DiagnosticClaims are not authoritative validator records. The controller audits the actual filesystem rather than trusting declaredChangedPaths.

4.3 Reviewer

Independently examine the task, cumulative diff, relevant call sites, known issues and controller-produced checks on a frozen candidate. Do not receive the Implementer's transcript or persuasive self-review. Do not edit the code being reviewed.

Check missed requirements, wrong assumptions, regressions, state/concurrency correctness, error handling, types, duplicated logic, code smells and unnecessary abstraction. Evaluate performance, security and accessibility where actually relevant; report concrete evidence instead of generic warnings.

Payload: mode MILESTONE or FULL, assessments {criterionId, outcome, evidenceReferences, rationale}, advisory verdict, humanReviewFocus and limitations. Concrete defects go in findings with severity. Reuse existing issue IDs for the same defect. The controller, not the verdict, decides readiness.

4.4 QA

Each mode starts a fresh independent session:

PLAN: derive happy-path, edge, regression, sanity and smoke checks from expected behavior BEFORE implementation.

CHECK: evaluate the frozen candidate's coverage and actual runner evidence. Do not merely trust new tests or the Implementer's narrative.

QA does not edit production source or execute arbitrary proposed commands. It may request already approved validator IDs; the controller decides whether to run them and can return evidence through the single bounded refill path.

Payload: mode, testPlan {criterionId, kind, description, validatorIds}, assessments, requestedValidatorIds, manualSmokeSteps, limitations. Separate executed automated checks from suggested human smoke steps. Never claim browser/device behavior was tested just because steps were written down.

4.5 Scheduling and assessments

Architect and QA PLAN may run in parallel on the baseline. After each implementation process exits and controller validation passes, Reviewer and QA CHECK may run in parallel on the same candidate. No writer runs while those results are being produced.

Interim assessments cover the current and previously completed criteria, not unimplemented future milestones. The final round assesses ALL required criteria on the final cumulative candidate. Any further source change invalidates earlier review/test evidence for final readiness.

5. Official CLI integrations and authentication

Sources were checked on 2026-09-19; the user's installed CLI versions and account access remain unverified. Confirm relevant options using actual local help before building an invocation. References are in Section 12.

5.1 Codex

Use a fresh noninteractive codex exec invocation. Official documentation provides JSONL event output, final structured-output schemas, stdin input and saved CLI authentication [S1, S2]. Capability-check exec, --json, --output-schema, final output file options, stdin - and explicit sandbox selection.

Use read-only permissions for nonwriters and workspace-write for Implementer. Never choose unrestricted/danger-full-access or permission-bypass options. Do not rely on deprecated convenience flags. Use a supported restrictive configuration for this invocation without rewriting the user's global settings or administrator policy.

No resume --last, shared provider conversation or nested goal inside a worker. Record actual reported session/thread IDs when supplied, with null/unknown when not available. Audit ambient project/user rules, hooks, MCP servers and recursive features before enabling the profile.

5.2 Claude Code

Use a fresh official print-mode claude -p invocation with verified structured output and tool/permission settings [S3, S4]. Parse the actual result envelope: structured output is not necessarily the entire JSON response. Do not treat --allowedTools as an exclusive inventory; available tools and permission preapproval are distinct controls.

Subscription-specific caveat: current documentation says --bare does not read subscription OAuth/keychain credentials and instead requires another supported authentication route [S3]. Therefore do NOT select --bare in the initial saved-subscription adapter just to suppress ambient configuration. The docs also say bare may become a future print-mode default: probe actual behavior rather than assuming an eternal default.

Normal print mode can load hooks, project/user configuration and MCP automatically. Before a live call, use supported invocation-scoped controls to disable unneeded hooks/integrations and recursive agent tools while preserving official login and mandatory organizational policy. Do not clone credentials into a fake HOME or weaken policy to make it run. If the installed version cannot provide the required saved-login/permission combination, report UNSUPPORTED_CAPABILITY instead of switching to API billing.

For nonwriters use a verified read-only or tools-disabled context-packet profile. For Implementer allow only required workspace editing/diagnostics through supported permissions. Do not use --dangerously-skip-permissions or unrestricted modes. Provider turn caps, where supported, supplement but do not replace external process timeouts.

5.3 Authentication, quota and cost

Initial profiles use the human's intended already-authorized direct login to the official CLI, not extracted OAuth tokens or API keys. Codex supports subscription and API authentication; Claude Code supports subscription use and can select API billing when configured with API credentials [S2, S5]. These are different routes, not interchangeable free fallbacks.

Build a child-scoped environment that does not silently inherit API keys, cloud routing or custom endpoint overrides. Do not print environment secrets or modify the user's shell configuration. Use official nonsecret status/help and observed protocol evidence to check auth; never read auth JSON contents, Keychain entries or tokens into app storage or prompts. If the intended route cannot be verified, block the live binding with a precise explanation.

Interactive login, browser/2FA, installation and billing changes are human operations. An existing VS Code provider panel does not establish that the separate CLI binary is on PATH or logged in.

Auth or quota denial is not a code defect: pause, preserve evidence and await explicit human action. No busy polling, auto-resume schedule, provider/account rotation, hidden fallback or quota bypass. Separate sessions share the underlying account's applicable limits. Unknown remaining usage stays unknown.

Do not assert that call limits impose an exact token/currency cap. Provider-reported cost may be an estimate, and account-level extra usage is outside this app's accounting. Report actual metadata with provenance, otherwise null. The app never purchases credits or enables extra usage.

This v0.1 is a personal local CLI coordinator. It must not implement its own subscription login flow or proxy subscriber credentials. Turning it into a hosted/multiuser product requires a separately reviewed authentication/billing design and current provider terms [S6].

5.4 Adapter tests and mock mode

Both real adapters must have real invocation construction, decoder/result extraction, capability checks and normalized errors. Missing login is not permission to return a permanent “not implemented” stub.

Use labeled synthetic transcripts plus real fake executable processes for offline integration. Cover malformed/truncated output, arbitrary chunking, explicit provider failure, unknown terminal behavior, auth denial, quota limits, permission rejection, wrong identity and safe environment construction. Do not fabricate transcripts labeled as observed live.

Mock runs are always verificationMode: SIMULATION. The mock worker must edit a real disposable fixture in end-to-end tests; it is never substituted for a requested real provider.

6. Workspaces, commands and actual validation

6.1 Candidate isolation

Create a unique managed branch ai-team/<run-id> and implementation worktree from the recorded base commit. Preserve the original target checkout, its current ref and user files. Worktree/managed-branch metadata is the intended Git metadata change; Git worktrees still share objects and some references [S7]. This is working-copy separation, not hostile-code confinement.

Only the controller makes local checkpoint commits on its managed branch, after auditing changed and untracked files. Stage only allowed nonsecret paths, not a blanket unknown-file add. Use command-scoped commit identity/hook settings if needed; do not modify global Git configuration or accidentally run unreviewed hooks. Agents may not change refs/HEAD/commits.

After the writer exits, audit scope, snapshot changed files including new files, checkpoint the candidate, then validate that exact SHA. Observer worktrees/snapshots are detached at that SHA. Each concurrently active observer has its own working copy to avoid tool-cache collisions.

Verify tracked source hashes and allowed output paths before and after read-only/check phases. A new writer invalidates all prior final-readiness evidence. Handoff includes the cumulative base-to-final diff, not just the most recent repair.

6.2 Controller command runner

Use spawn(executable, args, {shell: false, ...}) with validated cwd and explicit argument arrays [S9]. Model output, task text and file names must not become shell syntax. Never execute an agent-proposed command string without finding an identical already approved command definition.

Only approved setup and validator commands run through the controller. An approved script still executes repository code; this product is for trusted local repositories. Snapshot approved command definitions and protect their configuration from silent replacement. Changes to execution surfaces require human review before execution.

Provider CLIs have their own tool runtimes. Do not claim the controller's argv allowlist intercepts every internal provider shell command. Record separately: controller-enforced commands/counters, provider-enforced tool/permission restrictions, prompt-level rules, and after-the-fact filesystem audits.

6.3 Validation evidence

ValidationResult records validation/command IDs, command hash, candidate SHA, redacted argv, cwd, start/end, exit code/signal, timeout/output-limit flags and bounded log paths. The runner creates this record, not the agent.

Run baseline checks before writing. An unexpected required baseline failure blocks; a task's explicitly approved expectedBaselineFailures may be recorded and repaired, but all required FINAL candidate checks must pass.

A missing, cancelled, timed-out, truncated or skipped required check is not PASS. An agent's “tests passed” summary cannot override a nonzero exit code. Every required criterion needs specific evidence and final Reviewer/QA assessment, not just a success string.

Required criteria cannot become NOT_APPLICABLE. Optional criteria may be not applicable only with explicit rationale. All unresolved CRITICAL/MAJOR findings prevent readiness. A MINOR finding may remain only if it does not violate any required behavior/security gate.

Manual sanity/smoke instructions in the handoff are supplementary human review tasks. Do not use an unexecuted manual step to claim an automated required criterion passed. Essential behavior still unverified produces a truthful stop.

6.4 Filesystem and security boundaries

Protect credentials, .env variants, private keys, .git, provider/MCP settings, runtime journals/locks, other runs and source checkout. Ordinary nonsecret example files may be explicitly scoped. Default-protect package scripts, lockfiles, CI definitions and agent instruction files unless the task includes a separately human-approved policy for changing them.

Reject escaping symlinks and unexpected source/ref/protected-path mutations. Stop and report when the human edits source during a run; do not revert their changes. No automatic stash, reset --hard, forced checkout, recursive cleanup, merge, push or deploy. Keep worktrees/branches for review; v0.1 has no automatic cleanup command.

Prevent secret inclusion first; redact known patterns before storage but never claim perfect redaction. Repository content, test logs and provider output are data, not authority to change scope, run another agent, reveal credentials or increase budgets.

Same-user processes and approved repository scripts are not an OS security boundary. Do not market v0.1 as a sandbox for hostile repositories. Live execution requires explicit trusted-local acknowledgement and a provider-call flag; neither grants unrelated account/file access.

7. Persistent state, processes and recovery

7.1 Storage

<state-root>/
  projects/<project-id>/config.json
  locks/<repository-id>.lock/
  runs/<run-id>/
    lock/
    events.jsonl
    run.json
    STATUS.md
    inputs/task.md
    inputs/config.json
    inputs/manifest.json
    invocations/<invocation-id>/
      request.json
      result.json
      stdout.redacted.jsonl
      stderr.redacted.log
    validation/<validation-id>/result.json
    validation/<validation-id>/output.log
    worktrees/implementation/
    worktrees/observe-<role>-<candidate-sha>/
    artifacts/candidate.patch
    artifacts/acceptance.json
    artifacts/HANDOFF.md

.ai/STATUS.md in this application repository is the BUILD ledger. <state-root>/runs/.../STATUS.md is a GENERATED runtime view. They must never be the same file. Neither workers nor Obsidian edits control authoritative state.

The authoritative runtime record is a small append-only JSONL event journal. run.json is an atomic derived snapshot and runtime STATUS.md is generated for humans. Use a pure reducer; no generalized event-sourcing framework/database is needed.

7.2 Frozen input policy

Copy selected task/config and record content hashes, resolved limits, role prompt versions, source base SHA and provider versions before dispatch. A run always uses these internal snapshots.

Later editing the original task note or project config does not alter an active/resumed run; show an input-divergence notice and continue with the frozen snapshot unless the human pauses. Applying revised scope/config requires explicit new work with a new input snapshot, never an agent-created replacement to evade exhausted limits. Internal snapshot tampering/corruption blocks recovery.

Selected safe repository files carry hashes and context-omission metadata. On resume, recheck actual candidate/base identity, protected source and process ownership. A changed provider executable/version requires an explicit capability re-probe and a recorded event before further calls; do not overwrite prior evidence.

7.3 Durable accounting and locks

Journal events carry schemaVersion, eventId, runId, monotonic seq, UTC timestamp, type and validated payload. Flush reservations BEFORE starting side effects. A crash between reservation and completion consumes the reservation conservatively; do not grant a free extra attempt.

Use exclusive per-run and per-target-repository locks. Record owner nonce, PID, process-start identity and heartbeat. A PID alone is not proof of ownership or a stale lock. A second controller may request cancellation, not take over and start a duplicate writer.

Recover state by replay. Exact duplicate event IDs may be ignored only if content is identical. Quarantine an incomplete trailing record with an audit notice; conflicting duplicates/interior corruption block. Do not claim exactly-once execution across a hard process/machine crash.

7.4 Supervision

Supervise worker and validator process groups on macOS with bounded streams, deadlines and cancellation. Terminate owned child/grandchild processes on pause, cancel, timeout and output-limit failure, with a grace interval before forced termination. Test actual subprocess trees, not just mocked promises.

A controller killed externally may not clean up. On resume detect uncertain children and unverified writer changes; never blindly replay a possibly mutating invocation or kill an unrelated reused PID. Preserve partial work and require reconciliation. Do not claim readiness while a worker is still running or termination is unknown.

WORKFLOW owns numeric time/size limits. Account active wall time across resumes; paused time is excluded, sleep while running counts toward the deadline on wake. These are bounds, not unattended scheduling promises.

7.5 Errors and output

Normalize AUTH_REQUIRED, RATE_LIMITED, UNSUPPORTED_CAPABILITY, PERMISSION_DENIED, INVALID_RESULT, PROCESS_TIMEOUT, OUTPUT_LIMIT, VALIDATION_FAILED, SCOPE_VIOLATION, INPUT_CHANGED, STATE_CORRUPT, BUDGET_EXHAUSTED, CANCELLED and UNKNOWN from actual protocol/process evidence.

CLI exit mapping: 0 informational success or READY_FOR_HUMAN_REVIEW; 2 invalid input/config; 3 BLOCKED; 4 PAUSED; 5 FAILED; 130 CANCELLED. SIMULATION remains explicit even on exit zero.

Show actual completed/total milestones, role state, round, issue attempts, checks and artifact paths. No fictional percent-complete, ETA, token savings or remaining subscription balance.

8. Obsidian-compatible integration

8.1 v0.1 file-based scope

Obsidian uses local Markdown files [S10]. No plugin, MCP, Obsidian Sync subscription, database or external API is needed for these operations:

read the exact selected task .md supplied with --task, even outside the target repository;

freeze its contents in the run's input snapshot;

explicitly export a human-readable run summary with the export command.

The user chooses an output folder, for example a visible AI Team/Reports folder inside their vault. Do not assume the hidden .ai build folder should be the vault's navigation surface. Obsidian's own indexing/UI behavior is not a runtime dependency.

8.2 Export contract

Create a uniquely named subdirectory for the run/export, never overwrite existing notes silently. Require an explicit absolute destination and verify canonical path boundaries/symlinks. Reject destinations inside registered target repositories, managed worktrees or the authoritative state root. A failed export leaves runtime state unchanged and reports the failure. Export after a stopped run or from a consistent persisted snapshot; never read half-written artifacts.

Export only SUMMARY.md plus optional human-readable acceptance/findings Markdown. Include project/task/run ID, verification mode, snapshot time, status, base/candidate SHA, checks, open risks, consumed counters and supplemental human smoke steps. Exclude credentials, raw provider logs, implementation transcripts and source diffs by default. Mention that SHA/paths/project names may still be sensitive in a synced vault.

Editing exported notes does NOT approve code, resume work, reset a counter or change the task. Do not watch the vault, execute note commands, follow links or implement two-way sync. The controller remains the single state authority.

A later optional Obsidian plugin could call status/start interfaces, but that is a separate feature and not necessary for v0.1. Browser-based webviews, API keys and plugins are not prerequisites for selected-file integration.

9. Product acceptance criteria

These criteria assess AI Team itself. The runtime smoke task has separate SMOKE-* IDs. A criterion needs execution evidence, not merely matching documentation.

ID

Required behavior

Minimum evidence

AC-01

Runnable local package, scripts and CLI

Install/build/help/typecheck/lint/test/check/smoke evidence on actual host

AC-02

Truly separate role invocations

Actual subprocess/session/role identity records; no single-chat roleplay

AC-03

Provider-independent core and both real adapters

Codex/Claude invocation/parser contracts; changing config does not alter engine

AC-04

Single writer and isolated candidate

Temporary Git tests; original checkout/ref preserved

AC-05

Candidate-bound review and validation

Stale SHA rejection and mutation detection tests

AC-06

Durable repair/round/global limits

Boundary tests refuse extra dispatch across resume/alias merges

AC-07

Pause/cancel/timeout clean up owned children

Real child+grandchild tests on macOS; uncertainty handled

AC-08

State recovery and controller exclusion

Journal/lock/crash integration tests

AC-09

Actual validator truth and traceability

Optimistic-agent/failing-command negative tests; criterion evidence

AC-10

Scope, command, auth and permission boundaries

Negative tests plus explicit same-user/trusted-local limitations

AC-11

Useful status and human handoff

Cumulative diff, checks/findings/counters/manual steps and exact paths

AC-12

No merge/push/deploy/approval or hidden fallback

Forbidden-operation tests and managed-branch review

AC-13

Meaningful offline team smoke

Real fixture modification and fixed external behavioral oracle

AC-14

At least one real complete provider workflow on the Mac

Opt-in run using available explicit profile; four roles, real diff, oracle passes

AC-15

Provider/live/simulation claims are honest

Independent proof columns; unavailable evidence not PASS; both adapters implemented

AC-16

Reusable VS Code terminal use across projects

Registration/config/run command integration tests; no copying app into target

AC-17

Exact external Markdown task input and safe snapshot

Task in temporary vault-like folder; edits do not silently change run

AC-18

One-way Obsidian-compatible export

Temporary-folder tests for content, no overwrite, no secrets/raw logs, no state mutation

AC-14 is required to claim the live team works on Yiğit's Mac. If live access is unavailable, finish safe independent development and report overall build BLOCKED with exact missing evidence; do not downgrade the criterion. A full mixed-provider live run is additional evidence, not a prerequisite for completing the first single-provider proof.

10. Required deterministic tests

Use injected clock/ID factories for pure tests and real temporary repos/processes for lifecycle tests. No real inference in default tests. The test runner must fail when assertions fail.

Test

Required scenario

T-01

Task/config reject empty criteria, duplicate IDs, unknown references and authority-bearing extras

T-02

Each role/repair starts a fresh process/session; no latest-session resume

T-03

Same workflow works with all adapter contracts, with no provider branches in core

T-04

Concurrent controller/target lock contention allows only one owner

T-05

Writer count never exceeds one; reader concurrency respects the cap

T-06

Candidate edits preserve source checkout/ref; new files and cumulative diff are captured

T-07

Review/QA/check result for candidate A cannot approve candidate B

T-08

Observer/validator source mutation or unauthorized ref change stops the run

T-09

Failed third issue repair prevents a fourth repair dispatch

T-10

Reopened/aliased issues and restarts retain unioned consumed repair reservations

T-11

Round four failure prevents round five, even with a differently named new issue

T-12

Concurrent reservations at 23/24 calls allow only one remaining dispatch

T-13

Context refill/transport retry consume global budget; unsafe writer replay is denied

T-14

Timeout/output cap terminates actual owned child+grandchild; unowned PIDs are not killed

T-15

Ctrl+C pause/cancel preserve evidence and budgets; no replacement writer races

T-16

Crash after reservation does not grant new credit; uncertain writer output is reconciled

T-17

Torn final journal record is handled; interior corruption/conflicting events fail closed

T-18

PID reuse/unknown lock ownership does not trigger unsafe kill or takeover

T-19

Agent says PASS but required validator exits nonzero: readiness is impossible

T-20

Missing required review/check/criterion evidence cannot become PASS or NOT_APPLICABLE

T-21

Invalid/wrong-identity/truncated structured result fails even with process exit zero

T-22

Chunked UTF-8/JSONL and oversized streams are bounded correctly

T-23

Spaces and shell-looking text in paths/tasks remain data, not shell execution

T-24

Escaping symlinks, protected credentials and out-of-scope edits are rejected

T-25

Changed approved script/internal input snapshot blocks; external note changes use frozen input visibly

T-26

Missing provider/capability never chooses another provider or mock silently

T-27

No live flag means zero real inference; API/endpoint overrides are not silently inherited

T-28

Saved-subscription Claude profile does not use incompatible bare/API auth or unreviewed ambient tools

T-29

Auth/quota denial pauses once; no code-repair loop or account rotation

T-30

Minor optional finding may be documented; major/required failure blocks readiness

T-31

Expected baseline failure must still pass in the final candidate

T-32

status/export use persisted evidence without model calls, fabricated usage or human approval

T-33

Active-time/call/output/artifact caps survive resume and interrupted execution

T-34

Lying mock worker without actual fixture edit fails the external behavioral oracle

T-35

No nested orchestration, remote operations or global provider configuration writes

T-36

Two registered target repos have separate config/state; empty unscaffolded target errors clearly

T-37

Selected vault task only: no vault traversal or linked-note ingestion; snapshots are immutable

T-38

Export handles spaced paths, symlink escape, existing files and redaction; never mutates run authority

11. Filled proving task and independent oracle

Create a disposable TypeScript Git fixture with a baseline commit and a named export normalizeTitle(input: unknown): string. Initially it returns string inputs unchanged and throws TypeError on nonstrings. Existing baseline tests pass for ordinary strings, empty string and type rejection, but do not cover whitespace normalization.

The builder must create examples/SMOKE_TASK.md from the COMPLETE JSON block below (the surrounding explanation may also be included). This is a ready task, not a blank template.

{
  "schemaVersion": 1,
  "id": "normalize-title-v1",
  "title": "Normalize title whitespace without changing case",
  "objective": "Trim and collapse JavaScript whitespace in normalizeTitle(input: unknown): string while preserving non-whitespace characters and TypeError behavior for nonstrings.",
  "requirements": [
    {"id": "SMOKE-FR-1", "text": "For string input trim both ends and replace each remaining run matched by /\\s+/gu with one ASCII space. Preserve non-whitespace characters and case."},
    {"id": "SMOKE-FR-2", "text": "Empty or whitespace-only string returns empty string. Every nonstring throws TypeError without coercion."},
    {"id": "SMOKE-FR-3", "text": "Add focused regression tests without dependencies, script changes or unrelated refactors."}
  ],
  "acceptanceCriteria": [
    {"id": "SMOKE-AC-1", "requirementIds": ["SMOKE-FR-1"], "text": "'  Hello   Team  ' becomes 'Hello Team'; 'MiXeD Case' is unchanged.", "required": true, "validatorIds": ["unit", "build"], "humanReview": "Confirm case and other non-whitespace characters are preserved."},
    {"id": "SMOKE-AC-2", "requirementIds": ["SMOKE-FR-1"], "text": "Tabs, newlines, carriage returns and non-breaking spaces are trimmed/collapsed according to JavaScript whitespace semantics.", "required": true, "validatorIds": ["unit", "build"], "humanReview": "Inspect mixed-whitespace implementation and assertions."},
    {"id": "SMOKE-AC-3", "requirementIds": ["SMOKE-FR-2"], "text": "Empty and whitespace-only strings return ''; null, undefined, 42, [], and {} each throw TypeError.", "required": true, "validatorIds": ["unit", "typecheck"], "humanReview": "Check unknown-input signature and absence of String() coercion."},
    {"id": "SMOKE-AC-4", "requirementIds": ["SMOKE-FR-3"], "text": "Only scoped source/tests change, regression tests cover expected behavior and all required checks pass.", "required": true, "validatorIds": ["typecheck", "unit", "build"], "humanReview": "Review the full diff and fixed external smoke oracle."}
  ],
  "scope": {
    "allowedPaths": ["src/normalizeTitle.ts", "tests/normalizeTitle.test.ts"],
    "forbiddenPaths": ["package.json", "package-lock.json", ".git/", ".env"]
  },
  "constraints": [
    "Keep the named export and unknown-input public signature.",
    "No dependency/script changes, unrelated transformations, logging or network work.",
    "Do not commit, merge, push, deploy or edit controller state.",
    "Do not weaken existing tests or claim unexecuted checks passed."
  ],
  "nonGoals": ["Slug generation, lowercasing, transliteration, UI, database and deployment."],
  "expectedBaselineFailures": []
}

The fixture harness supplies trusted, predeclared typecheck, unit and build validators. Their command IDs match the task. Offline tests use already installed application test tooling or a controlled local fixture dependency strategy; do not hide network installs inside the default test suite.

Mock workers are real separate processes. The mock Implementer edits the fixture and returns structured output. After candidate creation, a fixed external harness OUTSIDE agent-editable scope imports the candidate's compiled function and asserts:

"  Hello   Team  " => "Hello Team";

"\tHello\n\nTeam\r\n" => "Hello Team";

"\u00a0Hello\u00a0\u00a0Team\u00a0" => "Hello Team";

"MiXeD Case" unchanged; "" and " \t\n " => "";

null, undefined, 42, [], {} => TypeError.

Also verify the actual diff is nonempty and the original source checkout remains unchanged. A mock that only claims success must fail this oracle. A live run uses the same fixture/task/oracle but must not inject the mock patch into a real provider response.

12. Official references and verification boundaries

Checked on 2026-09-19. Re-check installed CLI help/version and actual account access. Sources support integration facts; architecture/limits/test contracts above are this product's chosen design.

[S1] OpenAI, noninteractive Codex: https://developers.openai.com/codex/noninteractive (redirects to ChatGPT Learn). Official script interface, structured output and saved CLI login.

[S2] OpenAI, authentication: https://developers.openai.com/codex/auth. Subscription and API routes are distinct.

[S3] Anthropic, programmatic Claude Code: https://code.claude.com/docs/en/headless. Print mode, structured result envelope, ambient configuration and bare-mode authentication caveat.

[S4] Anthropic, CLI reference/permissions: https://code.claude.com/docs/en/cli-reference and https://code.claude.com/docs/en/permissions. Verify version-specific tool and permission controls.

[S5] Anthropic, subscription use: https://support.claude.com/en/articles/11145838-use-claude-code-with-your-pro-or-max-plan and https://code.claude.com/docs/en/authentication. Shared account usage and authentication precedence.

[S6] Anthropic, legal/compliance: https://code.claude.com/docs/en/legal-and-compliance. Direct official CLI login is not permission to proxy subscription credentials or invent a third-party login route.

[S7] Git, worktree: https://git-scm.com/docs/git-worktree. Multiple working copies and shared repository metadata.

[S8] Node.js release lifecycle: https://nodejs.org/en/about/previous-releases. Node 24 LTS choice as of this revision.

[S9] Node.js child processes: https://nodejs.org/api/child_process.html. Argument-based process execution and lifecycle primitives.

[S10] Obsidian, introduction/import: https://obsidian.md/help/obsidian and https://obsidian.md/help/import. Local Markdown interoperability; the export design is ours.

[S11] VS Code integrated terminal: https://code.visualstudio.com/docs/terminal/basics. The planned user entry point is an ordinary local terminal command, not a custom extension.

No source proves that these specs have been implemented, either CLI is installed on Yiğit's Mac, a subscription has enough quota, every future CLI version remains compatible, or hostile-code containment is achieved.
# Build status — AI Team

Updated: 2026-09-28. This is application build state, separate from runtime journals.

## Current checkpoint

State: READY_FOR_HUMAN_REVIEW — CLEANUP-01 validated; autonomous work stops for human review.

The cleaned application passed its full offline gate and final CLI/documentation/Git checks. The earlier live demo remains separate evidence; no new provider calls were made during cleanup. No push or final human approval is authorized.

Plan: inspect → plan → format/trim/translate → validate → review/QA → final validation → human handoff. Stop and consult on any new problem. At most three meaningful repairs per root; counters below and archived history remain authoritative.

## Preserved history and counters

- Known live child invocations: **41 consumed**, all exited; no active allocation. The human removed the cumulative bootstrap call ceiling on 2026-09-25. Product runtime caps remain unchanged.
- Failed build/QA interventions: **12/18**. Preserve the diagnostic-harness failure and the subsequent smoke-discovery failure; no new live call.
- Original milestone rounds: B0=2, B1=3, B2=3, B3=2, B4=4, B5=4, B6=4, B7=4. Supplemental authorized fixes did not reset those rounds.
- The exact prior ledger is preserved at `.local/history/pre-cleanup/STATUS.md`; its original SHA is in `.local/cleanup/before-manifest.json`. Full history was archived, not discarded or rewritten.
- All 168 prior review artifacts are preserved under `.local/history/pre-cleanup/review/`, with byte hashes in `.local/cleanup/archive-manifest.json`. Original relative evidence references in the historical ledger resolve there.
- Pre-cleanup maintained files are backed up under `.local/cleanup/before/`. Runtime target repositories, immutable inputs and journals remain in their original external locations.
- The old build goal was marked achieved after verified live readiness; the explicit cleanup scope has now passed validation and is handed off for human review. This is goal bookkeeping, not a reset of engineering counters or human approval.

## Root issue ledger

All listed roots are resolved unless explicitly noted. Full evidence, initial failures and reservations remain in the archived ledger.

| Root                                             | Resolution / consumed attempts                                                                                         |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| Original bootstrap roots                         | Detailed B0–B7 entries retained verbatim in archived STATUS; initial failed interventions total 3                      |
| BUILD-B5-PROBE-1                                 | Intervention 1                                                                                                         |
| BUILD-B5-STDERR-1                                | Intervention 2                                                                                                         |
| BUILD-B6-CONTRACT-1                              | Intervention 3; no fourth intervention                                                                                 |
| BUILD-B6-BOUNDARY-1 / EXCLUSION-1 / PROBE-STOP-1 | Intervention 1 each                                                                                                    |
| REVIEW-01                                        | Intervention 2; 1 failed                                                                                               |
| REVIEW-02 / REVIEW-03 / REVIEW-05                | Intervention 1 each                                                                                                    |
| REVIEW-04 / REVIEW-06                            | Intervention 2 each; 1 failed each                                                                                     |
| REVIEW07                                         | Intervention 2; 1 failed                                                                                               |
| REVIEW08                                         | Intervention 1                                                                                                         |
| CODEX-CATALOG-01                                 | Isolated CLI 0.157.0 probe and subsequent real workflow passed; global installation unchanged                          |
| TEST-DISCOVERY-01                                | Intervention 2 passed: both test and smoke discovery restricted to tests/                                              |
| ENGINE-TEST-TIMEOUT-01                           | Intervention 2 passed after concurrency-only intervention 1 failed; scoped 120s integration deadline approved by human |
| WRITER-RECOVERY-01                               | Offline tests and actual interrupted run recovery passed; initial failed broad gate remains counted                    |
| BROWSER-TAB-01                                   | Human-approved harness repair 1 passed; initial QA failure remains counted                                             |
| CLEANUP-01                                       | Formatting, documentation, English text and publication scope validated                                                |

## Established verification

- Final cleanup gate: `npm run check`, session 80771, exit 0; formatting, typecheck, lint, 125 tests across 12 files (113.26s), build and 2 smoke tests (9.61s) passed. Evidence: `.local/cleanup/validation.log`. Previous pre-cleanup gate session 22871 also passed.
- Real Codex bill-splitter run: `run-cd14610b-cbda-4a38-883e-5d3c4d5cb3f3`; final SHA `ba35383c9cc9e8cdf5209c2327835c62e9f81693`; READY_FOR_HUMAN_REVIEW, 8/16 calls, round 2, one repair. All ten issue records closed while preserving consumed credit.
- Candidate checks: 8 unit tests, 3 fixed acceptance tests and 2 syntax checks passed. Independent final Reviewer and QA each assessed all four criteria PASS on the same SHA.
- Actual Chrome: 3 valid and 8 invalid input cases, reset/default/focus, forward/reverse Tab with visible focus, desktop/375px layout, no external HTTP requests or runtime errors. Screen-reader speech and other browsers unverified.
- Original source, candidate, frozen inputs, journal prefix, prior reservations and all eight worker exits audited successfully. Parent browser evidence remains supplementary; it was not falsely imported into role packets.
- The text-counter and earlier proving-task live histories remain archived, including failures and consumed repairs. No stopped run was replaced to reset limits.

## Cleanup decisions and evidence

- Preserve `AGENTS.md`, `.ai/GOAL.md`, `.ai/SPEC.md`, `.ai/WORKFLOW.md` at their required paths and verbatim. Replace only this status view with a concise current ledger and explicit archival references.
- Archive obsolete presentations, repeated handoffs, diagnostics, local paths and source copies rather than publishing them. Archive `scripts/review-probes.mjs`, an obsolete counterexample harness superseded by regression tests.
- Retain the local bill-splitter opener under ignored `review/split-lab/`. It is a local convenience, not a portable public example.
- Add pinned Prettier development tooling and a format check to the existing full gate. Preserve runtime logic, assertions, limits and authentication behavior.
- Replace Turkish place-name Unicode fixtures with an English string retaining multibyte characters and emoji. Keep behavioral Unicode/chunking coverage.
- Maintain README usage, one verification summary, the filled smoke task and four runtime role assets. All maintained prose is English; historical raw evidence is preserved unchanged in the ignored archive.
- Completed: formatting, structural comparison of 43 code files, archive integrity, full offline gate, CLI/example/role-asset smoke checks, Markdown links and final Git/diff review. Final inventory and cumulative cleanup diff: `.local/cleanup/final-manifest.json` and `.local/cleanup/cleanup.patch`.

## Limits and human review

Claude/mixed live and non-macOS behavior remain unverified. Node 24.13.0 is the tested host; the declared minimum is not independent Node 22 proof. Worktrees are trusted-local isolation, not a hostile-code sandbox. Application code review is self-review; independent runtime Reviewer/QA applies to target candidates.

Inspect the formatting diff, simplified documentation, permanent repair accounting and recovery boundaries. The human performs final engineering review. No merge, push, deployment or final approval has occurred.

## CLEANUP-AST-01 validation pause

- Source formatting completed with pinned Prettier3.9.9. The new syntax-tree comparison (session25047) failed for42/43 files before the full gate. It incorrectly included SourceFile.text, the entire raw source, in each AST signature; read-only inspection confirmed this. Formatting necessarily changes that field. This failure does not establish a behavioral change.
- No repair or repeat comparison attempted. Proposed repair1: include text only for semantic leaf literals/identifiers, exclude raw SourceFile.text, rebuild the expected signatures from the preserved pre-cleanup source plus the explicitly approved Unicode text substitution, then compare the current parsed trees and run the full gate. Do not overwrite baseline from the already-formatted files.
- Count this unsuccessful cleanup validation conservatively as cumulative failed intervention11/18, retaining prior10. New root CLEANUP-AST-01 has0 repair attempts. User requires consultation on any problem, so further formatting/test work is paused pending decision. No READY or push-ready claim.
- Independent archive audit PASS:168 review artifacts retain exact SHA256 bytes; original full STATUS preserved; AGENTS/GOAL/SPEC/WORKFLOW unchanged. package.json now includes formatting commands/check; code/docs cleanup is prepared, not fully validated. Full npm run check, CLI/package smoke and final cleanup review remain NOT_RUN. Known live calls41, no allocation or active process.

## CLEANUP-AST-01 repair 1 authorized

- Human requests completing the checks after the explained diagnostic false alarm. Reserve repair 1/3 before changing the helper. Reconstruct expected parsed trees from the preserved pre-cleanup files, allowing only the documented Unicode fixture substitution. Exclude raw SourceFile.text; keep semantic node text and child structure. No production code change, test expectation relaxation or baseline generated from formatted output.
- Failed interventions remain 11/18; known live calls remain 41. No live dispatch. Complete one structural audit and full offline gate; stop and consult on any new failure.

## CLEANUP-AST-01 repair 1 PASS

- Corrected comparison verifies preserved-source hashes and ignores only raw SourceFile.text plus formatting-only parentheses. All 43 maintained code-file syntax trees match the original snapshot after the three explicit Unicode fixture substitutions. No production behavior or test assertions changed.
- Repository audit PASS: 168 archived artifacts unchanged; four authority files and role instruction words preserved; maintained Markdown links resolve; 62 public files exclude local history and review artifacts. Dependency inspection PASS; lockfile adds only pinned Prettier. No Turkish prose or user-specific machine paths found in maintained source/tests/README/verification/current status.

## TEST-DISCOVERY-01 reopened at smoke / PAUSED

- Full npm run check session8244 exited1: formatting/typecheck/lint PASS,125/125 application tests across12 files PASS (112.14s),build PASS. Smoke selected both tests/smoke.test.ts and .local/cleanup/before/tests/smoke.test.ts because its positional filter is substring-based and the script lacks --dir tests. Actual current smoke tests2/2 PASS; the archived suite had1 PASS and1 baseline-build FAIL. Overall smoke3/4 and full gate FAIL.
- This is the existing TEST-DISCOVERY-01 root, not a fresh repair budget. Earlier intervention1 scoped npm test only. Proposed intervention2: add --dir tests to npm run smoke as well, preserving both real smoke tests and all assertions. No change or rerun applied; user requires consultation on a problem. Failed intervention total12/18 retains previous11. No new live call (41 consumed).
- Evidence .local/cleanup/validation-attempt1.log and review/smoke-discovery-proposal.patch. Product formatting/AST and ordinary tests passed, but push readiness is not established until the complete gate passes. Final CLI smoke and human handoff remain pending.

## TEST-DISCOVERY-01 intervention 2 authorized

- Human approved adding --dir tests to the smoke command and completing the full gate. Reserve intervention 2/3 for the existing discovery root before applying the reviewed one-line patch. Both current smoke tests, test assertions and deadlines remain unchanged. Failed interventions remain 12/18; live calls remain 41 with no allocation.

## Final validation and handoff — 2026-09-28

- TEST-DISCOVERY-01 intervention 2 PASS: full gate session 80771 exited 0. Only the intended tests/ smoke suite was selected; both tests passed. No expectations, assertions or deadlines were weakened.
- CLI help exits 0 and lists the documented commands; unknown command/flag exit 2. The example task parses against the compiled schema and all four packaged role assets match source exactly. Evidence: `.local/cleanup/cli-audit.json`.
- Final self-review: runtime code structure matches the preserved source after the explicit Unicode fixture replacement. Formatting and package tooling changes are within cleanup scope. The existing WORKFLOW diff is the previously authorized bootstrap call-budget amendment, unchanged by cleanup. No unresolved cleanup finding.
- QA: full offline gate and additional command-level checks PASS. No new live/provider/browser claim is made. Earlier actual Codex and Chrome results remain recorded above; Claude/mixed live, other platforms and screen-reader speech remain unverified.
- Acceptance: maintained JS/TS formatted; obsolete Markdown/publication artifacts archived; maintained prose English; source tree prepared for human review before push. Historical records remain unchanged locally. Required build instructions remain at their original paths.
- Assumptions: generated files/dependencies and archived evidence are outside maintained-code formatting; original authority documents and historical evidence are preserved verbatim. Local history is excluded from publication, not deleted.
- Review README.md, docs/VERIFICATION.md, package.json, formatting/ignore configuration and the cumulative cleanup patch. Confirm publication exclusions, revised test-discovery commands and documentation of Orchestrator authority/recovery before committing. Most implementation files are still untracked relative to the original repository baseline; no commit or push was performed.
- Counters remain 12/18 failed interventions and 41 consumed live child invocations. CLEANUP-AST-01 repair 1 and TEST-DISCOVERY-01 intervention 2 passed; no active repair or child allocation. Final human engineering approval remains pending.

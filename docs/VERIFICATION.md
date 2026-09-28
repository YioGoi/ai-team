# Verification record

This is an evidence summary, not final human approval. The terminal application state is `READY_FOR_HUMAN_REVIEW`.

| Area                      | Evidence                                                                                                                                       | Boundary                                                                                   |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Offline application       | 2026-09-28 cleanup gate: 125 unit/integration tests and 2 smoke tests; formatting, typecheck, lint and build passed                            | Node 24.13.0/macOS; exact evidence recorded in `.ai/STATUS.md`                             |
| Codex live workflow       | Complete macOS runs using separate role processes and official saved CLI login                                                                 | Original versions 0.135.0 and isolated 0.157.0; installed capabilities are checked per run |
| Bill-splitter recovery    | Same interrupted run recovered, repaired once and reached readiness at 8/16 calls in round 2                                                   | Existing calls, inputs and issue credits were preserved                                    |
| Candidate validation      | 8 unit tests, 3 fixed acceptance tests and 2 syntax checks passed                                                                              | Final Reviewer and QA each assessed 4/4 criteria PASS on the same SHA                      |
| Browser QA                | Actual Chrome: 3 valid and 8 invalid cases, reset/focus, forward/reverse Tab, desktop/375px layout; no external requests or runtime exceptions | Parent browser evidence is supplementary, not automatically imported into reader packets   |
| Claude and mixed profiles | Both adapters implemented and offline contracts tested                                                                                         | Live use unverified                                                                        |

## Review focus

Review Orchestrator authority and transitions in `src/orchestration/engine.ts`, permanent repair accounting in `src/domain/state.ts`, source/ref isolation in `src/workspace/git.ts`, and explicit recovery guards in `src/application/`. Provider adapters must preserve official login and permissions without hidden fallback. The application code review to date is self-review; independent runtime Reviewer/QA assessment applies to target candidates.

Run `npm ci` and `npm run check` to reproduce the offline gate. Live calls are opt-in and account limits remain provider-controlled. A successful diagnostic or simulation is not a complete live workflow.

Unverified: spoken screen-reader announcements, browsers other than Chrome, Claude/mixed live use, and operating systems other than the recorded macOS host. Node 24.13.0 was used; the package declares Node >=22, but this is not a claim of separate Node 22 verification.

## Preserved history

The original detailed build ledger and 168 local review artifacts were preserved byte-for-byte under `.local/history/pre-cleanup/` during cleanup. They are deliberately excluded from Git. Archive hashes and the pre-cleanup source snapshot are under `.local/cleanup/`. Completed target worktrees and authoritative journals remain at their original external runtime paths.

The latest bill-splitter run is `run-cd14610b-cbda-4a38-883e-5d3c4d5cb3f3`, candidate `ba35383c9cc9e8cdf5209c2327835c62e9f81693`. In the development checkout, `bash review/split-lab/open-candidate.sh` still opens it. That local convenience command and temporary paths are not portable installation instructions.

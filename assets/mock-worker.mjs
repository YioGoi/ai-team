import process from 'node:process';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
let input = '';
for await (const chunk of process.stdin) input += chunk;
const r = JSON.parse(input);
const task = r.context.task;
const mode = process.argv[2] || 'normal';
const emit = (value) => process.stdout.write(JSON.stringify(value) + '\n');
emit({ type: 'metadata', sessionId: randomUUID(), model: 'deterministic-fixture-worker' });
if (mode === 'auth') {
  emit({ type: 'error', code: 'AUTH_REQUIRED', message: 'Synthetic login denial' });
  process.exit(1);
}
const result = {
  schemaVersion: 1,
  runId: r.runId,
  invocationId: r.invocationId,
  taskId: r.taskId,
  role: r.role,
  basisSha: r.basisSha,
  outcome: 'OK',
  summary: 'SIMULATION fixture result',
  evidenceReferences: [],
  requestedContextPaths: [],
  findings: [],
  payload: {},
};
const criterionIds = task.acceptanceCriteria.map((c) => c.id);
const validatorIds = [...new Set(task.acceptanceCriteria.flatMap((c) => c.validatorIds))];
const evidenceReferences = Object.keys(r.context.evidence).filter((k) =>
  k.startsWith('validation:'),
);
const assessments = task.acceptanceCriteria.map((c) => ({
  criterionId: c.id,
  outcome: 'PASS',
  evidenceReferences,
  rationale: 'Synthetic assessment; independent external oracle verifies actual fixture behavior',
}));
if (r.role === 'architect')
  result.payload = {
    milestones: [
      {
        id: 'normalize',
        objective: task.objective,
        criterionIds,
        allowedPaths: task.scope.allowedPaths,
        dependsOn: [],
        validatorIds,
      },
    ],
    invariants: ['TypeError on nonstrings'],
    risks: [],
    assumptions: [],
  };
if (r.role === 'architect' && mode.startsWith('milestones'))
  result.payload.milestones = [
    {
      id: 'source',
      objective: 'Implement behavior',
      criterionIds: criterionIds.slice(0, 3),
      allowedPaths: ['src/normalizeTitle.ts'],
      dependsOn: [],
      validatorIds,
    },
    {
      id: 'tests',
      objective: 'Add regression coverage',
      criterionIds,
      allowedPaths: ['tests/normalizeTitle.test.ts'],
      dependsOn: ['source'],
      validatorIds,
    },
  ];
if (r.role === 'implementer') {
  if (task.id !== 'normalize-title-v1') {
    result.outcome = 'BLOCKED';
    result.summary = 'Mock only supports the explicitly labeled proving fixture';
  }
  const changed = [];
  if (mode !== 'lying' && result.outcome === 'OK') {
    const sourcePath = 'src/normalizeTitle.ts';
    const testsPath = 'tests/normalizeTitle.test.ts';
    const allowed = (path) =>
      r.scope.allowedPaths.some(
        (rule) => rule === path || (rule.endsWith('/') && path.startsWith(rule)),
      );
    const source = await readFile(sourcePath, 'utf8');
    const next = source.replace('return input;', 'return input.trim().replace(/\\s+/gu, " ");');
    if (allowed(sourcePath) && next !== source) {
      await writeFile(sourcePath, next);
      changed.push(sourcePath);
    }
    const tests = await readFile(testsPath, 'utf8');
    const marker = '// AI Team whitespace regression';
    if (allowed(testsPath) && !tests.includes(marker)) {
      await writeFile(
        testsPath,
        tests +
          '\n' +
          marker +
          '\nassert.equal(normalizeTitle("  Hello   Team  "), "Hello Team");\nassert.equal(normalizeTitle("\\tHello\\nTeam\\r\\n"), "Hello Team");\nassert.equal(normalizeTitle("\\u00a0Hello\\u00a0\\u00a0Team\\u00a0"), "Hello Team");\nassert.equal(normalizeTitle(" \\t\\n "), "");\nassert.equal(normalizeTitle("MiXeD Case"), "MiXeD Case");\nfor (const value of [null, undefined, 42, [], {}]) assert.throws(() => normalizeTitle(value), TypeError);\n',
      );
      changed.push(testsPath);
    }
  }
  result.payload = {
    changeSummary: 'Fixture whitespace normalization',
    declaredChangedPaths: changed,
    addressedCriterionIds: criterionIds,
    addressedIssueIds: r.assignedIssueIds,
    testChanges: changed.includes('tests/normalizeTitle.test.ts') ? ['Whitespace regressions'] : [],
    diagnosticClaims: [],
    limitations: ['SIMULATION'],
  };
}
if (r.role === 'implementer' && mode.startsWith('repair-evidence') && r.round > 1) {
  if (mode === 'repair-evidence-context' && r.round === 3) {
    result.outcome = 'NEEDS_CONTEXT';
    result.summary = 'Need the current failed unit output';
    result.requestedContextPaths = [
      Object.values(r.context.evidence).find((v) => v?.commandId === 'unit').logPath,
    ];
  } else if (mode === 'repair-evidence' || r.round > 3) {
    const failure = Object.values(r.context.evidence).find(
      (v) => v?.commandId === 'unit' && v.candidateSha === r.basisSha,
    );
    if (!failure?.outputExcerpt?.includes('Missing evidence-guided regression')) {
      result.outcome = 'BLOCKED';
      result.summary = 'Actual failure output missing from packet';
    } else {
      const path = 'tests/normalizeTitle.test.ts';
      const source = await readFile(path, 'utf8');
      await writeFile(
        path,
        source +
          '\n// evidence-guided regression\nassert.equal(normalizeTitle("  proof   evidence  "), "proof evidence");\n',
      );
      result.payload.declaredChangedPaths.push(path);
    }
  }
}
if (r.role === 'reviewer')
  result.payload = {
    mode: 'FULL',
    assessments,
    verdict: 'Synthetic pass',
    humanReviewFocus: ['Inspect normalization and tests'],
    limitations: ['SIMULATION'],
  };
if (r.role === 'qa')
  result.payload = {
    mode: r.phase === 'PLANNING' ? 'PLAN' : 'CHECK',
    testPlan: task.acceptanceCriteria.map((c) => ({
      criterionId: c.id,
      kind: 'edge',
      description: c.text,
      validatorIds: c.validatorIds,
    })),
    assessments: r.phase === 'PLANNING' ? [] : assessments,
    requestedValidatorIds: [],
    manualSmokeSteps: ['Human: inspect Unicode whitespace behavior'],
    limitations: ['SIMULATION'],
  };
if (r.role === 'qa' && mode === 'requested-checks')
  result.payload.requestedValidatorIds = validatorIds;
if (r.role === 'qa' && mode === 'extra-check' && r.phase !== 'PLANNING')
  result.payload.requestedValidatorIds = ['extra'];
if (r.role === 'qa' && mode === 'unapproved-check')
  result.payload.requestedValidatorIds = ['unapproved'];
if (
  r.role === 'qa' &&
  mode.startsWith('milestones') &&
  (r.milestoneId === 'source' || (mode === 'milestones-persistent' && r.milestoneId === 'tests'))
) {
  result.findings = [
    {
      localId: 'coverage',
      existingIssueId: null,
      severity: mode === 'milestones' ? 'MINOR' : 'MAJOR',
      title: 'Regression coverage is incomplete',
      criterionIds: [criterionIds[3]],
      locations: [{ path: 'tests/normalizeTitle.test.ts', line: 1 }],
      symptom: 'Required whitespace regression coverage is pending in the next milestone',
      evidenceReferences: ['candidate:diff'],
      suggestedNextAction: 'Add scoped regression tests',
    },
  ];
  if (mode === 'milestones-current') result.findings[0].criterionIds.push(criterionIds[0]);
  const prior = r.context.evidence['controller:issues'].find(
    (i) => i.title === result.findings[0].title,
  );
  if (prior) result.findings[0].existingIssueId = prior.id;
  result.payload.assessments.find((a) => a.criterionId === criterionIds[3]).outcome = 'FAIL';
}
if (
  r.role === 'implementer' &&
  mode.startsWith('milestones') &&
  r.milestoneId === 'source' &&
  r.round > 1
) {
  result.outcome = 'NEEDS_CONTEXT';
  result.summary = 'Assigned test repair is outside the source-only milestone scope';
}
if (mode === 'wrong-sha') result.basisSha = 'wrong';
if (
  mode === 'context' &&
  r.role === 'architect' &&
  !r.context.instructions.includes('Single bounded')
) {
  result.outcome = 'NEEDS_CONTEXT';
  result.requestedContextPaths = ['src/normalizeTitle.ts'];
}
emit({ type: 'result', value: result });
emit({ type: 'success' });

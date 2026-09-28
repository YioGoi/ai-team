# Normalize title whitespace

```json
{
  "schemaVersion": 1,
  "id": "normalize-title-v1",
  "title": "Normalize title whitespace without changing case",
  "objective": "Trim and collapse JavaScript whitespace in normalizeTitle(input: unknown): string while preserving non-whitespace characters and TypeError behavior for nonstrings.",
  "requirements": [
    {
      "id": "SMOKE-FR-1",
      "text": "For string input trim both ends and replace each remaining run matched by /\\s+/gu with one ASCII space. Preserve non-whitespace characters and case."
    },
    {
      "id": "SMOKE-FR-2",
      "text": "Empty or whitespace-only string returns empty string. Every nonstring throws TypeError without coercion."
    },
    {
      "id": "SMOKE-FR-3",
      "text": "Add focused regression tests without dependencies, script changes or unrelated refactors."
    }
  ],
  "acceptanceCriteria": [
    {
      "id": "SMOKE-AC-1",
      "requirementIds": ["SMOKE-FR-1"],
      "text": "'  Hello   Team  ' becomes 'Hello Team'; 'MiXeD Case' is unchanged.",
      "required": true,
      "validatorIds": ["unit", "build"],
      "humanReview": "Confirm case and other non-whitespace characters are preserved."
    },
    {
      "id": "SMOKE-AC-2",
      "requirementIds": ["SMOKE-FR-1"],
      "text": "Tabs, newlines, carriage returns and non-breaking spaces are trimmed/collapsed according to JavaScript whitespace semantics.",
      "required": true,
      "validatorIds": ["unit", "build"],
      "humanReview": "Inspect mixed-whitespace implementation and assertions."
    },
    {
      "id": "SMOKE-AC-3",
      "requirementIds": ["SMOKE-FR-2"],
      "text": "Empty and whitespace-only strings return ''; null, undefined, 42, [], and {} each throw TypeError.",
      "required": true,
      "validatorIds": ["unit", "typecheck"],
      "humanReview": "Check unknown-input signature and absence of String() coercion."
    },
    {
      "id": "SMOKE-AC-4",
      "requirementIds": ["SMOKE-FR-3"],
      "text": "Only scoped source/tests change, regression tests cover expected behavior and all required checks pass.",
      "required": true,
      "validatorIds": ["typecheck", "unit", "build"],
      "humanReview": "Review the full diff and fixed external smoke oracle."
    }
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
```

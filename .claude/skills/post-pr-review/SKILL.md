---
name: post-pr-review
description: >
  Post-PR review loop — monitor DeepSeek Code Review comments, classify
  issues vs false positives, ensure CI passes, iterate fixes. Invoke
  after a PR is pushed or when the user says "review the PR," "check
  CI," "handle DeepSeek comments," "PR review loop."
---

# Post-PR Review Loop

After a PR is pushed, two things must happen before merge:
(1) the **DeepSeek Code Review** GitHub Action posts review comments, and
(2) all required **CI checks** must pass.

## The Loop

```
┌─────────────────────────────────────────────────┐
│  1. Wait for DeepSeek CR check to complete       │
│  2. Fetch all PR review comments                  │
│  3. Classify each: relevant / false-positive      │
│  4. Fix real issues, reply to false positives     │
│  5. Check CI — all required checks green?         │
│  6. If issues remain or CI red → loop to step 1   │
│  7. PR is ready to merge                          │
└─────────────────────────────────────────────────┘
```

### Step 1 — Wait for DeepSeek CR

Use `mcp__plugin_github_github__pull_request_read` with `method=get_check_runs`.
Wait until "deepseek-code-review" is `completed`.

### Step 2 — Fetch Review Comments

Fetch both review comments and issue comments from the PR, filtering to
the `github-actions[bot]` author.

### Step 3 — Classify Each Finding

For each DeepSeek comment:
1. **Read the actual code** at the flagged line — never trust the comment alone
2. **Check against known false-positive patterns** from `AGENTS.md` and the
   `deepseek-cr.yml` system prompt
3. **Classify**: Real issue / False positive / Style nit

Known false positives for this project:
- `||` in `asNumber()` patterns in `src/usage.ts` — intentional ccusage fallback
- `createElement` string children — not innerHTML, these are text nodes
- Duplicate types in `client.ts` vs `usage.ts` — separate bundles, intentional
- No Zod validation for usage data — `usage.ts` parses external ccusage data

### Step 4 — Address Findings

**Real issues**: Fix, commit, push.
**False positives**: Reply explaining why, resolve thread.
**Style nits**: Skip unless contradicting `AGENTS.md`.

### Step 5 — Check CI

Required checks:
| Check | Source |
|-------|--------|
| **Type check and unit tests** | `test.yml` |
| **DeepSeek CR** | `deepseek-cr.yml` |

All must be green. If `Type check and unit tests` fails, investigate the build
logs. Assume it's your fault until proven otherwise.

### Step 6 — Loop or Finish

- Pushed fixes → go back to Step 1
- CI red → investigate, fix, push
- All green, all comments resolved → **merge**

## Analysis Heuristics

1. **Does the code actually do what the comment claims?** Read the file.
2. **Would fixing this break an established project convention?** Check `AGENTS.md`.
3. **Is the flagged line reachable?** DeepSeek sometimes flags test fixtures.
4. **Does the fix make the code objectively better?** Skip neutral changes.

## Gotchas

- DeepSeek comments arrive after the check completes — wait 30s before fetching
- Force-pushing after review creates stale line references — add new commits instead
- `continue-on-error: true` on DeepSeek job means green check ≠ no errors

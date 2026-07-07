---
name: post-pr-review
description: >
  Post-PR review loop — monitor DeepSeek Code Review comments, classify
  issues vs false positives, ensure CI passes, iterate fixes. Invoke
  after a PR is pushed or when the user says "review the PR," "check
  CI," "handle DeepSeek comments," "PR review loop."
---

# Post-PR Review Loop

After a PR is pushed in this project, two things must happen before
merge: (1) the **DeepSeek Code Review** GitHub Action posts inline
review comments, and (2) all required **CI checks** must pass.

This skill walks through fetching those comments, analyzing them for
relevance, addressing real issues, dismissing false positives, and
monitoring CI — in a loop until the PR is clean.

## Prerequisites

- GitHub MCP tools available (the `mcp__plugin_github_github__*` namespace).
- The PR number and repo (`danielcg-net/claude_status_dashboard`).

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

The DeepSeek review runs as a GitHub Actions check named **"DeepSeek CR"**
(workflow: `DeepSeek Code Review`, file: `.github/workflows/deepseek-cr.yml`).

Use `mcp__plugin_github_github__pull_request_read` with method `get_check_runs`
to list checks. Wait until the DeepSeek CR check is `completed` (not
`in_progress` or `queued`). Use `ScheduleWakeup` with a 60–120s delay to
poll — do not busy-wait.

If the DeepSeek check **failed** (conclusion ≠ `success`), check for a bot
comment on the PR saying "⚠️ DeepSeek Code Review encountered an error."
If found and the PR is non-trivial, ask the user whether to re-run or
proceed with manual review.

If the check **succeeded** or **completed with neutral**, proceed to step 2.

### Step 2 — Fetch Review Comments

The DeepSeek action posts review comments via the GitHub API. These can be:

- **PR review comments** (attached to specific diff lines/threads), or
- **Issue comments** (on the PR conversation, not attached to code)

Fetch both:

```
pull_request_read  method=get_review_comments  → review threads + comments
issue_read         method=get_comments         → PR conversation comments
```

Filter to comments authored by the DeepSeek bot (username: `github-actions[bot]`
or the bot account that posted them — check the comment `author.login`).

### Step 3 — Classify Each Finding

For each DeepSeek comment:

1. **Read the code context** — the file and line(s) the comment references.
   Use `Read` to get the actual code. Don't trust the comment's summary alone.

2. **Check against the known false-positive list** in the workflow config
   (`.github/workflows/deepseek-cr.yml` lines 60–77). The system prompt
   explicitly lists patterns that should NOT be flagged:

   | Pattern | What DeepSeek sometimes gets wrong |
   |---------|-----------------------------------|
   | `const` defined later in the same file | Not a bug — module scope is hoisted |
   | `escapeAttr` / `escapeHtml` helpers | These exist in `main.js` — not missing |
   | `\|\|` after `clean()` | Intentional empty-string guard, not a `??` violation |
   | Cache-control on routes using shared `json()` | The `json()` helper already sets it |
   | Missing cache-busting version bumps | `build.mjs` handles this automatically |

3. **Classify**:
   - **Real issue** — the code actually has the bug/defect described. Fix it.
   - **False positive** — matches a known FP pattern or the comment is
     factually wrong about the code. Reply to the thread explaining why it's
     not an issue, then resolve the thread.
   - **Style nit** — subjective preference that doesn't match project
     conventions. Note it but don't change unless it contradicts `AGENTS.md`
     or `CLAUDE.md`.

### Step 4 — Address Findings

**For real issues:**
- Fix in the working tree.
- Commit with `--amend` if the PR hasn't been reviewed by a human yet, or
  as a new commit if reviews are in flight.
- Push.

**For false positives:**
- Use `mcp__plugin_github_github__add_reply_to_pull_request_comment` to
  reply with a brief explanation of why it's not applicable.
- Use `mcp__plugin_github_github__pull_request_review_write` with
  `method=resolve_thread` to resolve the thread.

### Step 5 — Check CI Status

Use `pull_request_read` with `method=get_check_runs` to list all checks.
Required checks for this project (from the `Web` workflow and branch
protection):

| Check | Source |
|-------|--------|
| **Type check and unit tests** | `Test` workflow — `test.yml` |
| **DeepSeek CR** | `deepseek-cr.yml` |

All three must show conclusion `success`. If any is `failure` or `timed_out`,
investigate the logs. For the Web workflow, use
`mcp__plugin_github_github__get_commit` with the PR head SHA and
`detail=full_patch` to surface failures.

**🚨 NEVER merge with a failing Build website or Deploy check.** A failing
Build means E2E tests didn't pass, and the root cause could be a runtime
error in your code — not a flake. Investigate every failure. Look at the
build logs with `gh run view <id> --log-failed`. If the failure is in a test
file you didn't touch, check whether your changes could have caused it
indirectly (e.g. a JS runtime error on a shared page). Assume it's your
fault until proven otherwise.

If DeepSeek CR is the only failing check and all its findings are false
positives, it's safe to note this and proceed — but the branch protection
rules may still block merge. Ask the user if needed.

### Step 6 — Loop or Finish

- If you pushed fixes → go back to Step 1 (DeepSeek re-runs on push).
- If CI is red → investigate, fix, push, loop. **Do not merge.**
- If all checks green and all DeepSeek comments resolved → **PR is ready.**

## Pre-Merge Checklist

Before merging, verify these common failure modes in `src/dashboard/main.js`:

1. **Scope bugs** — `main.js` has many functions sharing global state. If you
   add code to a page function (e.g. `renderHomePage`, `renderCatalogList`),
   verify every variable you reference is either:
   - Defined locally in that function, OR
   - A globally-available function (e.g. `isAdmin()`, `hasAction()`,
     `escapeHtml()`, `api()`), OR
   - A property of the global `state` object
   - Never reference a `const` from another function's body.
2. **`isUserAdmin`** is local to `renderLayout()`. Use `isAdmin()` elsewhere.
3. **E2E test selectors** — if you change a form input to a `<select>`,
   update E2E tests from `.fill()` to `.selectOption()`.
4. **API paths** — the `api()` helper prepends `/api/dashboard`. Pass
   `/crm/catalog`, not `/api/dashboard/crm/catalog`.

## Analysis Heuristics

When deciding whether a finding is real, ask:

1. **Does the code actually do what the comment claims?** Read the file.
   DeepSeek sometimes misidentifies a function's behavior from its name alone.
2. **Would fixing this break an established project convention?** Check
   `AGENTS.md` and `CLAUDE.md` before applying style changes.
3. **Is the flagged line reachable?** DeepSeek sometimes flags dead code
   paths or test fixtures.
4. **Does the fix make the code objectively better?** If the change is
   neutral (equivalent behavior, different style), skip it.

## Gotchas

- **DeepSeek comments can arrive in batches.** The check may show `completed`
  but comments are still being posted (the action posts them after the
  analysis step). Wait 30s after the check completes, then fetch comments.
- **The bot may reference non-existent line numbers** if the PR was force-pushed
  after the review ran. If a comment's line doesn't match the current diff,
  note it as stale and resolve.
- **`continue-on-error: true`** means the DeepSeek job can show green even
  when the analysis step itself errored. Always check for the error comment
  on the PR.
- **Required checks can be skipped** via `if:` conditions (e.g., the Web
  workflow skips build/deploy when no `**` files changed). A skipped
  check reports `success` and satisfies branch protection.

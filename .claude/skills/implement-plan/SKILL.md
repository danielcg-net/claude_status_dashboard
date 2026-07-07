---
name: implement-plan
description: >
  Fully implement a plan from docs/plans/ — break into sequential PRs,
  resolve open questions, implement each PR, run post-pr-review loop,
  merge when green, repeat until done. Never asks for user approval.
  Invoke with "/implement-plan <plan-file>" or when the user says
  "implement the plan," "develop the plan," "ship the plan," "execute
  the plan," "build out the plan."
---

# Implement Plan — Fully Autonomous Development

This skill reads a plan from `docs/plans/`, breaks it into sequential PRs,
resolves all open questions ahead of time, then implements each PR one at a
time — pushing, reviewing, iterating on DeepSeek feedback, and merging —
without ever asking the user for approval.

## Prerequisites

- Serena project "bizyeet" activated (`mcp__plugin_serena_serena__activate_project`)
- GitHub MCP tools available
- Plan file exists in `docs/plans/`

## The Loop (per PR)

```
┌──────────────────────────────────────────────────────────┐
│  FOR EACH PR in the plan's breakdown:                     │
│    1. Create branch from main, pull latest                │
│    2. Implement the PR changes (code + tests)             │
│    3. Run tests locally, verify nothing broken            │
│    4. Commit (GPG-signed), push, create PR on GitHub      │
│    5. Invoke /post-pr-review skill → wait for DeepSeek CR │
│    6. Classify & address findings, push fixes if needed   │
│    7. Loop on review until all comments resolved, CI green│
│    8. Merge PR, delete branch, pull main                  │
│    9. Apply DB migrations if PR included schema changes   │
│  NEXT PR                                                  │
└──────────────────────────────────────────────────────────┘
```

---

## Phase 0 — Understand the Plan

### 0.1 Locate the plan

Plans live in `docs/plans/`. Some plans are a single file; others are a pair:

```
docs/plans/<plan-name>.md          ← high-level plan (objectives, phases, criteria)
docs/plans/<plan-name>-prs.md      ← PR breakdown (optional, but preferred)
```

If the user names a specific plan, use it. If ambiguous, list the plans
directory and ask the user to pick — this is the **one and only** question
you may ask. Everything after this is autonomous.

### 0.2 Read and internalize

Read the plan file(s) thoroughly. You must understand:

- **What** is being built (the objective)
- **Why** (the motivation, what problem it solves)
- **Current state** vs **target state**
- **Acceptance criteria** — what "done" means
- **Rollout notes** — ordering constraints, migration steps, monitoring

### 0.3 Assess the PR breakdown

**If the plan already has a PR breakdown** (like `catalog-backed-chatbot-pricing-prs.md`):
- Verify each PR is independently reviewable, mergeable, and shippable
- Check that dependencies between PRs form a linear chain (no cycles)
- Confirm that the breakdown covers all acceptance criteria

**If the plan has no PR breakdown**, create one. Follow these rules:

1. **Schema first** — database changes, new tables, migrations always go first
2. **Library/API next** — repositories, endpoints, adapters with no UI
3. **UI after API** — dashboard pages, forms that consume the new endpoints
4. **Integration last** — wiring that changes existing behavior
5. **E2E tests final** — end-to-end validation after everything works

Each PR must be:
- **Independently reviewable** — a reviewer can understand it in isolation
- **Mergeable** — merging it doesn't break main
- **Shippable** — it leaves the codebase in a working state
- **Small** — no more than ~5 files, ~300 lines of new code

### 0.4 Resolve open questions BEFORE coding

This is the most important step. Scan the plan for:

| Ambiguity Type | How to Resolve |
|---|---|
| **Design decisions** marked as "TBD" or "decision TBD during implementation" | Read the existing code patterns, pick the one that fits, document your choice |
| **File paths** described vaguely ("or as a top-level section — decision TBD") | Look at the existing directory structure, choose the path that matches conventions |
| **API shapes** not fully specified | Look at existing analogous endpoints, mirror their patterns exactly |
| **Naming** (routes, columns, functions) not finalized | Follow existing naming conventions in the codebase |
| **Dependencies** between PRs not clarified | Trace the import/call graph to confirm ordering |
| **Feature flags or env vars** mentioned but not defined | Define them following the existing pattern |

**How to resolve**: Don't guess. Read the relevant source files. Find the
existing pattern. Apply it. If there are genuinely two valid approaches and
no existing convention to break the tie, pick the simpler one and note why.

**Document your decisions** as a short comment at the top of the first
relevant file or in the PR description.

---

## Phase 1 — Implement Each PR

### 1.1 Branch setup

For EVERY shell command, use `mcp__plugin_serena_serena__execute_shell_command`
with `cwd: "/home/dcgomes/claude_status_dashboard"`. Never use the native `Bash` tool.

```bash
# Pull latest main
git -C /home/dcgomes/claude_status_dashboard checkout main
git -C /home/dcgomes/claude_status_dashboard pull origin main

# Create branch (name: plan-<short-name>-pr<N>, e.g. plan-catalog-pr1)
git -C /home/dcgomes/claude_status_dashboard checkout -b plan-<slug>-pr<N>
```

### 1.2 Implementation

Follow ALL project conventions from `AGENTS.md` and `CLAUDE.md`:

- **JavaScript only** in `` — no TypeScript
- **`const` by default, `let` when needed, never `var`**
- **JSDoc on all exported functions**
- **Colocated unit tests** (`*.test.js` alongside source)
- **All string inputs through `clean()`**
- **No Node.js built-ins in `functions/`** — Workers runtime only
- **Playwright E2E tests** for user-facing changes (use `getByRole`/`getByTestId`, never `waitForTimeout`)
- **Multi-tenant scoping** — every query must filter by `tenant_id`

Implement the changes file by file. Write tests alongside code. Keep each
commit focused — don't mix unrelated changes.

### 1.3 Pre-push verification

Before pushing, run the relevant tests:

```bash
# Unit tests (Vitest)
npm --prefix /home/dcgomes/claude_status_dashboard/apps/web test -- <test-file>

# Full unit test suite (when touching shared code)
npm --prefix /home/dcgomes/claude_status_dashboard/apps/web test

# E2E tests (if the PR touches user-facing flows)
npm --prefix /home/dcgomes/claude_status_dashboard/apps/web run test:e2e -- <spec-file>.spec.js

# Verify GPG signing
git -C /home/dcgomes/claude_status_dashboard log --show-signature -1
```

If tests fail, fix them before pushing. Never push broken code.

### 1.4 Commit and push

```bash
git -C /home/dcgomes/claude_status_dashboard add -A
git -C /home/dcgomes/claude_status_dashboard commit -m "<conventional-commit-message>"
git -C /home/dcgomes/claude_status_dashboard push origin <branch-name>
```

Commit messages follow conventional commits: `feat:`, `fix:`, `test:`, `chore:`.

### 1.5 Create the PR

Use `mcp__plugin_github_github__create_pull_request`:
- **owner**: `danielcg-net`
- **repo**: `bizyeet`
- **head**: `<branch-name>`
- **base**: `main`
- **title**: Descriptive, matches the plan's PR title
- **body**: Include:
  - What this PR does (1-2 sentences)
  - Which plan it belongs to (link to plan file)
  - Files changed (list)
  - Testing done (what you ran)
  - Any open questions resolved in this PR

---

## Phase 2 — Review Loop (per PR)

After pushing and creating the PR, immediately invoke the `/post-pr-review`
skill. Its full instructions are in `.claude/skills/post-pr-review/SKILL.md`.
The short version:

### 2.1 Wait for DeepSeek CR

The DeepSeek Code Review GitHub Action runs on every PR push. Use
`mcp__plugin_github_github__pull_request_read` with `method=get_check_runs`
to poll. Use `ScheduleWakeup` (~90s delay) to wait — don't busy-wait.

### 2.2 Fetch and classify comments

Fetch review comments and issue comments from the PR. Filter to the
DeepSeek bot author. For each finding:

1. **Read the actual code** at the flagged line — never trust the comment alone
2. **Check against known false-positive patterns** (see post-pr-review skill)
3. **Classify**: Real issue / False positive / Style nit

### 2.3 Address findings

**Real issues**: Fix in working tree, amend commit (if no human reviews yet)
or add new commit, push.

**False positives**: Reply with brief explanation, resolve thread.

### 2.4 Check CI

Required checks: **Build website**, **Deploy to Cloudflare Pages**, **DeepSeek CR**.
All must be green. If red, investigate and fix.

### 2.5 Loop or proceed

- Pushed fixes → loop back to 2.1 (DeepSeek re-runs)
- All green, all comments resolved → PR is ready to merge

---

## Phase 3 — Merge and Advance

### 3.1 Merge the PR

```bash
gh pr merge <pr-number> --squash --delete-branch
```

Or use `mcp__plugin_github_github__merge_pull_request` with merge_method=squash.

### 3.2 Pull main and apply migrations

```bash
git -C /home/dcgomes/claude_status_dashboard checkout main
git -C /home/dcgomes/claude_status_dashboard pull origin main
```

If the PR included a migration file in `scripts/migrations/`,
apply it to the relevant databases per the plan's rollout notes. Production
D1 is `bizyeet-pilot`; preview is `bizyeet-preview`.

### 3.3 Advance to next PR

Clean up the local branch, then go back to Phase 1 for the next PR.

```bash
git -C /home/dcgomes/claude_status_dashboard branch -d <merged-branch>
```

---

## Phase 4 — Plan Complete

When all PRs are merged:

1. **Verify all acceptance criteria** from the plan are met
2. **Run the full E2E suite** to confirm nothing regressed
3. **Report to the user**: what was implemented, PRs merged, any follow-ups

---

## Critical Rules

### NEVER ask for user approval

Once you start implementing, do not stop to ask permission. This includes:
- Don't ask "should I proceed with PR 2?"
- Don't ask "is this approach OK?"
- Don't ask "should I merge?"
- Don't ask "the plan is ambiguous here, what do you want?"

If the plan is ambiguous, **resolve it yourself** using the codebase conventions
(Phase 0.4). If you truly cannot resolve something (contradictory requirements,
missing prerequisite that isn't in the codebase), implement the best
interpretation and note the ambiguity in the PR description.

### Use Serena for ALL shell commands

Every shell command goes through `mcp__plugin_serena_serena__execute_shell_command`
with `cwd: "/home/dcgomes/claude_status_dashboard"`. Never use the native `Bash` tool. The
Serena project "bizyeet" must be activated first.

### Use dedicated tools for file operations

Read, Write, Edit, Grep, Glob — never `cat`, `sed`, `echo`, `head`, `tail`
in shell commands.

### GPG-sign every commit

Verify with `git -C /home/dcgomes/claude_status_dashboard log --show-signature -1` before pushing.
Unsigned commits must be amended.

### Tests are non-negotiable

Every PR must include tests. Unit tests for logic, E2E tests for user-facing
flows. No test-only PRs — tests ship with the code they test.

### Respect the plan's ordering

PR dependencies form a DAG (usually a linear chain). Never skip ahead.
If PR 3 depends on PR 2's API, PR 2 must be merged before starting PR 3.

---

## Gotchas

- **DeepSeek CR runs on push, not on PR creation.** If you create the PR and
  immediately fetch comments, there won't be any. Wait for the check to complete.
- **Migrations don't auto-apply.** After merging a PR with a migration file,
  you must apply it manually to the target D1 databases.
- **The Cloudflare Pages deploy can fail if a `wrangler.toml` binding references
  a resource Terraform hasn't created yet.** If a PR needs a new binding, ensure
  the Terraform resource already exists (merged previously) or add both in the
  same PR only if the resource is simple (KV, R2 bucket already created).
- **Force-pushing after a review runs can produce stale line references.**
  Prefer `--amend` only before the DeepSeek check completes; after that,
  add new commits.
- **Branch protection requires all checks to pass.** A skipped check reports
  as `success` and satisfies protection. A `neutral` conclusion also passes.
- **`continue-on-error: true` on the DeepSeek job** means the check can show
  green even when the analysis errored. Always check for the error comment.

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `git push` rejected (non-fast-forward) | Someone pushed to your branch. `git pull --rebase` first |
| Tests fail locally but pass on CI | Check for environment differences (Node version, env vars) |
| DeepSeek CR never completes | Check the Actions tab — the job may have crashed. Re-run manually |
| PR can't merge (conflicts) | `git checkout main && git pull && git checkout - && git rebase main` |
| E2E tests flake | Re-run once. If still failing, investigate — don't ignore |
| `wrangler.toml` binding fails deploy | The resource doesn't exist yet. Merge Terraform first |

---
name: implement-plan
description: >
  Fully implement a plan from docs/plans/ — break into sequential PRs,
  resolve open questions, implement each PR, run post-pr-review loop,
  merge when green, repeat until done. Never asks for user approval.
  Invoke with "/implement-plan <plan-file>" or when the user says
  "implement the plan," "develop the plan," "ship the plan."
---

# Implement Plan — Fully Autonomous Development

This skill reads a plan from `docs/plans/`, breaks it into sequential PRs,
resolves all open questions ahead of time, then implements each PR one at a
time — pushing, reviewing, iterating on DeepSeek feedback, and merging —
without ever asking the user for approval.

## Prerequisites

- GitHub MCP tools available
- Plan file exists in `docs/plans/`

## The Loop (per PR)

```
┌──────────────────────────────────────────────────────────┐
│  FOR EACH PR in the plan's breakdown:                     │
│    1. Create branch from main, pull latest                │
│    2. Implement the PR changes (code + tests)             │
│    3. Run tests locally (`npm test`), verify nothing broken│
│    4. Commit, push, create PR on GitHub                   │
│    5. Invoke /post-pr-review skill → wait for DeepSeek CR │
│    6. Classify & address findings, push fixes if needed   │
│    7. Loop on review until all comments resolved, CI green│
│    8. Merge PR, delete branch, pull main                  │
│  NEXT PR                                                  │
└──────────────────────────────────────────────────────────┘
```

---

## Phase 0 — Understand the Plan

### 0.1 Locate the plan

Plans live in `docs/plans/`. If the user names a specific plan, use it.
If ambiguous, list the plans directory and ask the user to pick.

### 0.2 Read and internalize

Read the plan file(s) thoroughly. Understand: what is being built, why,
current state vs target state, acceptance criteria.

### 0.3 Assess the PR breakdown

If the plan has a PR breakdown, verify each PR is independently reviewable.
If not, create one following these rules:

1. **Backend first** — types, parsing, API endpoints
2. **Frontend after API** — UI changes that consume new endpoints
3. **Tests with code** — unit tests ship with the code they test
4. **E2E last** — end-to-end validation after everything works

Each PR must be small (~5 files, ~300 lines max), independently reviewable,
mergeable without breaking main.

### 0.4 Resolve open questions BEFORE coding

Read the relevant source files. Find existing patterns. Apply them.
Document decisions in the PR description.

---

## Phase 1 — Implement Each PR

### 1.1 Branch setup

```bash
git -C /home/dcgomes/claude_status_dashboard checkout main
git -C /home/dcgomes/claude_status_dashboard pull origin main
git -C /home/dcgomes/claude_status_dashboard checkout -b <branch-name>
```

### 1.2 Implementation

Follow ALL project conventions from `AGENTS.md`:

- **TypeScript everywhere** — strict mode, `readonly` types
- **Use `??` for null/undefined defaults**
- **`createElement` helper** in client.ts — never `innerHTML`
- **Zod schemas** for API validation in domain.ts
- **Functional style** — pure functions, immutable data
- **CSS custom properties** from `:root`, dark theme

### 1.3 Pre-push verification

```bash
npm test                           # All unit + integration tests
npm run build                      # TypeScript compilation + client bundle
npm run test:e2e                   # E2E tests (if touching user-facing flows)
```

If tests fail, fix before pushing. Never push broken code.

### 1.4 Commit and push

```bash
git -C /home/dcgomes/claude_status_dashboard add -A
git -C /home/dcgomes/claude_status_dashboard commit -m "<conventional-commit>"
git -C /home/dcgomes/claude_status_dashboard push origin <branch-name>
```

### 1.5 Create the PR

Use `mcp__plugin_github_github__create_pull_request`:
- **owner**: `danielcg-net`, **repo**: `claude_status_dashboard`
- **base**: `main`
- **body**: Include what it does, which plan it belongs to, files changed, testing done

---

## Phase 2 — Review Loop (per PR)

After creating the PR, invoke `/post-pr-review`. See `.claude/skills/post-pr-review/SKILL.md`.

---

## Phase 3 — Merge and Advance

```bash
gh pr merge <pr-number> --squash --delete-branch
git -C /home/dcgomes/claude_status_dashboard checkout main
git -C /home/dcgomes/claude_status_dashboard pull origin main
git -C /home/dcgomes/claude_status_dashboard branch -d <merged-branch>
```

---

## Phase 4 — Plan Complete

When all PRs are merged:
1. Verify all acceptance criteria are met
2. Run full test suite to confirm nothing regressed
3. Report to the user

---

## Critical Rules

### NEVER ask for user approval

Don't ask permission. Resolve ambiguities yourself using codebase conventions.

### Use Read/Write/Edit/Grep/Glob for file operations

Never `cat`, `sed`, `echo`, `head`, `tail` in shell commands.

### Tests are non-negotiable

Every PR must include tests. Unit tests for logic, E2E for user-facing flows.

### Respect the plan's ordering

PR dependencies form a DAG. Never skip ahead.

# Claude Status Dashboard — Claude Code specific instructions

> General project rules live in [`AGENTS.md`](AGENTS.md) — both Claude Code and
> Codex read it. This file only covers Claude Code-specific tool behavior.

## Shell command rules

Use the dedicated tools (**Read / Write / Edit / Glob / Grep**) for all file
work. Use `git -C` for Git operations with absolute paths.

## Post-PR workflow

After pushing a PR branch, invoke `/post-pr-review` to enter the review
loop: monitor the DeepSeek Code Review check, fetch and classify its
comments (real issue vs false positive), address findings, and verify all
CI checks pass before merging. See `.claude/skills/post-pr-review/SKILL.md`.

## Skills

This project includes Claude Code skills that auto-trigger based on context.
They live in `.claude/skills/` and are loaded automatically — you don't need
to invoke them explicitly.

| Skill | Triggers When |
|-------|---------------|
| `post-pr-review` | After pushing a PR — run `/post-pr-review` to enter the DeepSeek review loop |
| `implement-plan` | Implementing a plan from `docs/plans/` — run `/implement-plan <plan-file>` |
| `playwright-best-practices` | Writing or improving Playwright E2E tests |
| `playwright-page-objects` | Structuring Playwright tests with POM |
| `testing-patterns` | Writing Vitest unit tests, mock strategies, coverage |

All code written in this project should conform to the standards in these skills
and in [`AGENTS.md`](AGENTS.md).

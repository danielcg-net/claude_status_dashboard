---
description: Always apply this rule to prevent tool call failures due to missing
  or empty parameters.
alwaysApply: false
---

Every tool call MUST include ALL required parameters as specified in the tool's parameter schema. Never make a tool call with empty or missing parameters. Always double-check that each parameter name is spelled correctly and has a non-empty value before invoking the tool.
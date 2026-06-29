---
description: Always apply this rule when making any tool calls to ensure all
  required parameters are provided.
alwaysApply: false
---

When calling tools, always provide ALL required parameters for each tool. Never call a tool with empty or missing parameters. Each tool call must be a valid JSON object with all required fields populated. If you're unsure about the required parameters, check the tool's parameter schema in the system prompt before making the call.
---
name: weeek-context
description: Use when the user mentions a WEEEK task ID without an action verb — "/weeek-context 1234", "tell me about WEEEK-1234", "что это за задача". Read-only summary of a task and its column. Useful when SessionStart auto-detection didn't fire.
---

# weeek-context

Use this skill when the user wants to read about a specific task without doing anything to it. READ-ONLY. Never call any `weeek_*` write tool from this skill.

## Steps

1. Resolve the task ID from the user's message (they passed it explicitly, or mentioned `WEEEK-<n>` / `task-<n>`).

2. Call `weeek_get_task({ task_id })`.

3. If the task has a `boardId`, call `weeek_list_board_columns({ board_id })` to translate its `boardColumnId` into a human column name.

4. Render the summary as compact markdown:

   ```markdown
   ### WEEEK-<id> <title>
   **Status:** <column-name> · **Assignee:** <name> · **Due:** <date>

   <description first paragraph or two>
   ```

## What this skill does NOT do

- Does not call any write tool. If the user asks to do something, route to the appropriate skill (`weeek-start`, `weeek-advance`).

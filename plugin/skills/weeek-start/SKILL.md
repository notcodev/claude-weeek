---
name: weeek-start
description: Use when the user wants to start work on a WEEEK task — by ID ("/weeek-start 1234") or natural language ("начни задачу WEEEK-1234", "start task 1234"). Loads the task, suggests a branch name from .weeek.json, and offers to move the task into the In Progress column.
---

# weeek-start

Use this skill when the user explicitly wants to begin work on a specific WEEEK task. Triggers include `/weeek-start <id>`, "start task X", "начни задачу X", "let's pick up WEEEK-1234".

## Steps

1. Resolve the task ID. If the user passed a number, use it. If they passed `WEEEK-1234`, strip the prefix. If unclear, ask once.

2. Call `weeek_get_task({ task_id: "<id>" })`. Show a short summary to the user: title, current status (column), assignee, due date, priority. Quote the description's first 1–2 paragraphs only — do not dump the full body.

3. Read `.weeek.json` from the repo root (walk up from cwd if needed). If it has a `branchTemplate`, render it with `{id}` and `{slug}` (slug = lowercase kebab from the title, max 5 words). Compare with the current git branch:
   - If the current branch matches the template → skip the branch suggestion.
   - Otherwise, suggest `git switch -c <rendered>` and wait for confirmation before running it.

4. If the task has a `boardId`, call `weeek_list_board_columns({ board_id: "<boardId>" })`. Try to match the current column against `.weeek.json`'s `statusHints.inProgress` (case-insensitive substring match). If exactly one column matches and the task is not already in it, ask: "Move the task to the **<column-name>** column?". On yes → `weeek_move_task`. If 0 or >1 matches, present the full ordered column list and ask the user to pick.

5. Never call any write tool (`weeek_move_task`, `weeek_update_task`, etc.) without explicit user confirmation in the same turn.

## What this skill does NOT do

- Does not create branches without confirmation.
- Does not assume "In Progress" maps to a specific column without `statusHints` or user confirmation.

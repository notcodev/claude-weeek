/**
 * weeek_move_task — TASK-06
 *
 * Moves a task to a different board column. In WEEEK, changing a task's column
 * IS the status change — there is no separate "status" field on tasks. This is
 * why move_task is a dedicated tool, distinct from update_task (field edits)
 * and complete_task (done/undone toggle).
 *
 * Write tool: MCP clients may prompt for confirmation.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { WeeekApiClient } from "../../client/weeek-api-client.js";
import { toMcpError } from "../../errors.js";
import { logger } from "../../logger.js";
import { jsonContent } from "../read/_helpers.js";

function unwrapTask(raw: unknown): unknown {
  if (raw && typeof raw === "object" && "task" in (raw as object)) {
    return (raw as Record<string, unknown>).task;
  }
  return raw;
}

const inputSchema = {
  task_id: z
    .string()
    .min(1)
    .describe(
      "WEEEK task ID to move. Required. Obtain from weeek_list_tasks."
    ),
  board_column_id: z
    .string()
    .min(1)
    .describe(
      "Destination column ID. Required. Obtain from weeek_list_board_columns. Moving a task to a new column IS the status change in WEEEK."
    ),
  board_id: z
    .string()
    .min(1)
    .describe(
      "Destination board ID. Optional — only needed when moving the task to a column on a DIFFERENT board than its current one."
    )
    .optional(),
};

export function registerMoveTask(
  server: McpServer,
  client: WeeekApiClient
): void {
  server.registerTool(
    "weeek_move_task",
    {
      description:
        "Move a WEEEK task to a different board column. This IS how you change a task's status in WEEEK — columns ARE the status mechanism. WRITE OPERATION — the MCP client may prompt for confirmation. Required: task_id and board_column_id. Optional: board_id (only when moving across boards). Returns the updated task. DISTINCT from weeek_update_task: use update for field edits (title, description, priority, assignee, due date); use move for column/status changes. DISTINCT from weeek_complete_task: use complete for the done/undone toggle even though 'completed' is visually similar to a 'Done' column. board_column_id must come from weeek_list_board_columns — do not guess.",
      inputSchema,
    },
    async (args: {
      task_id: string;
      board_column_id: string;
      board_id?: string;
    }) => {
      try {
        const body: Record<string, unknown> = {
          boardColumnId: args.board_column_id,
        };
        if (args.board_id !== undefined) body.boardId = args.board_id;

        const raw = await client.put<unknown>(
          `/tm/tasks/${encodeURIComponent(args.task_id)}`,
          body
        );
        const task = unwrapTask(raw);
        return jsonContent(task);
      } catch (err) {
        return toMcpError(err);
      }
    }
  );
  logger.info("Registered tool: weeek_move_task");
}

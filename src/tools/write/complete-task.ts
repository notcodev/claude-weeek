/**
 * weeek_complete_task — TASK-07
 *
 * Marks a task complete or reopens it. Distinct from move_task (which changes
 * column) and update_task (which edits fields). Default is to mark complete;
 * pass completed=false to reopen.
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
      "WEEEK task ID to complete or reopen. Required. Obtain from weeek_list_tasks."
    ),
  completed: z
    .boolean()
    .default(true)
    .describe(
      "Whether to mark the task as completed. Default: true (mark done). Pass false to REOPEN a previously-completed task."
    )
    .optional(),
};

export function registerCompleteTask(
  server: McpServer,
  client: WeeekApiClient
): void {
  server.registerTool(
    "weeek_complete_task",
    {
      description:
        "Mark a WEEEK task as COMPLETE or REOPEN a completed task. WRITE OPERATION — the MCP client may prompt for confirmation. Required: task_id. Optional: completed (default true). Pass completed=false to reopen. Returns the updated task. DISTINCT from weeek_move_task: completing a task is a done/undone toggle, independent of which column it lives in. DISTINCT from weeek_update_task: completion is not an editable field — it has its own dedicated semantics in WEEEK. Use this tool when the user says 'mark done', 'complete', 'finish', 'close', 'reopen', or 'uncomplete'. task_id must come from weeek_list_tasks.",
      inputSchema,
    },
    async (args: { task_id: string; completed?: boolean }) => {
      try {
        const completed = args.completed ?? true;
        const body = { isCompleted: completed };
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
  logger.info("Registered tool: weeek_complete_task");
}

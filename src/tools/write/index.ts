/**
 * Write tool group for WEEEK MCP server.
 *
 * INFRA-06: Write tools live in this group separate from read tools so MCP
 * clients (Claude Desktop, Cursor) can require user confirmation for mutations
 * while auto-approving reads.
 *
 * Phase 3 in progress:
 *   Plan 03-01 (this file): create_task, update_task
 *   Plan 03-02 (next):      move_task, complete_task, create_task_comment
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { WeeekApiClient } from "../../client/weeek-api-client.js";
import { logger } from "../../logger.js";
import { registerCreateTask } from "./create-task.js";
import { registerUpdateTask } from "./update-task.js";

export function registerWriteTools(
  server: McpServer,
  client: WeeekApiClient
): void {
  // Task authoring (Plan 03-01)
  registerCreateTask(server, client);
  registerUpdateTask(server, client);

  logger.info("registerWriteTools: 2 write tools registered (Phase 3 Plan 01)");
}

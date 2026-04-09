# Changelog

All notable changes to `weeek-mcp-server` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-04-09

Initial release. MCP server for the WEEEK task tracker.

### Added

- Stdio MCP server entry point (`weeek-mcp-server` bin).
- Bearer token auth via `WEEEK_API_TOKEN` environment variable.
- Centralized `WeeekApiClient` with 30s timeout, error normalization, and stderr-only logging.
- 7 read tools: `weeek_list_projects`, `weeek_get_project`, `weeek_list_boards`, `weeek_list_board_columns`, `weeek_list_tasks`, `weeek_get_task`, `weeek_list_task_comments`.
- 5 write tools: `weeek_create_task`, `weeek_update_task`, `weeek_move_task`, `weeek_complete_task`, `weeek_create_task_comment`.
- Read/write tool group split for MCP client auto-approve configuration.
- Default pagination (20, max 50) on list tools to stay under the 25k token MCP response limit.
- Structured error responses (`isError: true`) — the server process never crashes on API failures.
- README with Claude Desktop + Cursor config examples and the NVM absolute-path workaround.

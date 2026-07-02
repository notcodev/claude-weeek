## [1.2.2](https://github.com/notcodev/claude-weeek/compare/v1.2.1...v1.2.2) (2026-07-02)


### Bug Fixes

* **tools:** shape task responses to strip workspace-schema bloat ([0f88d67](https://github.com/notcodev/claude-weeek/commit/0f88d676be1373922f067eb98a745eb02e535ca5))

## [1.2.1](https://github.com/notcodev/claude-weeek/compare/v1.2.0...v1.2.1) (2026-07-02)


### Bug Fixes

* **setup:** note MCP config step is already done for plugin installs ([28f36e1](https://github.com/notcodev/claude-weeek/commit/28f36e1b0e372b65b33ab74930857113e9bd0cfa))

# [1.2.0](https://github.com/notcodev/claude-weeek/compare/v1.1.1...v1.2.0) (2026-07-01)


### Bug Fixes

* **tools:** use WEEEK wire names perPage/completed/dueDate (drift fix) ([c742c58](https://github.com/notcodev/claude-weeek/commit/c742c58c3b42c29035fb5caf6209732f0169bf26))


### Features

* **spec-sync:** allowlist for verified WEEEK spec gaps; spec:check green ([9c88655](https://github.com/notcodev/claude-weeek/commit/9c88655a5e151fb5b44460bcc8d1255e4fc537e7))
* **spec-sync:** check-drift CLI comparing tools to the snapshot ([242b763](https://github.com/notcodev/claude-weeek/commit/242b763ba3330e62220a1d4b1c9d5ce30a22d594))
* **spec-sync:** drift report formatting and error gate ([9998d24](https://github.com/notcodev/claude-weeek/commit/9998d24980f1be411025fb1163e5873015067da5))
* **spec-sync:** fetch-spec CLI and committed OpenAPI snapshot ([89236cc](https://github.com/notcodev/claude-weeek/commit/89236cc5b108b9db7d24d4a8b65f785a10073afb))
* **spec-sync:** fixtures and runtime contract-capture harness ([37490fb](https://github.com/notcodev/claude-weeek/commit/37490fb5c4791013a8c0a381b77f1ccfd30ae1b9))
* **spec-sync:** OpenAPI operation index and path matcher ([cfde08d](https://github.com/notcodev/claude-weeek/commit/cfde08d7f86261309c03ac7f79819aad5bb086f4))
* **spec-sync:** portal discovery and live OpenAPI chunk loader ([a4c588a](https://github.com/notcodev/claude-weeek/commit/a4c588a66efa1bfb2d17e0ecd87893db341b7132))
* **spec-sync:** recording client for runtime request capture ([a746458](https://github.com/notcodev/claude-weeek/commit/a7464589338594ff32288b4317cd34cfdd29ae62))
* **spec-sync:** request-vs-spec comparison rules ([63b36f7](https://github.com/notcodev/claude-weeek/commit/63b36f7ef33ecf1e954471411cda92da0aae656a))

## [1.1.1](https://github.com/notcodev/claude-weeek/compare/v1.1.0...v1.1.1) (2026-06-30)


### Bug Fixes

* **tools:** align task write tools with WEEEK API spec ([d3417da](https://github.com/notcodev/claude-weeek/commit/d3417da92e9a38c86d4cc5aca57140b4e9d1b7a3))

# [1.1.0](https://github.com/notcodev/claude-weeek/compare/v1.0.0...v1.1.0) (2026-06-26)


### Features

* add weeek_list_workspaces tool ([b66528e](https://github.com/notcodev/claude-weeek/commit/b66528ee8dcedfd152337c59167d69a0081a6d69))
* add WorkspaceNotFoundError and toMcpError mapping ([112ad9e](https://github.com/notcodev/claude-weeek/commit/112ad9e71d6543a3f88692d108ea4594aa43d42b))
* interactive setup wizard with token validation ([24f1eef](https://github.com/notcodev/claude-weeek/commit/24f1eef28100c036da51703aa439acd1e058ac26))
* multi-workspace config loader with file + env fallback ([9c37a74](https://github.com/notcodev/claude-weeek/commit/9c37a7481bf42b663820dd521a1df352380950e6))
* route read tools through WorkspaceRegistry with optional workspace arg ([227283e](https://github.com/notcodev/claude-weeek/commit/227283ea3a71ddb6b932ec009648bc64938b6cd8))
* route write tools through WorkspaceRegistry with optional workspace arg ([b4b4a8d](https://github.com/notcodev/claude-weeek/commit/b4b4a8dd3cb730d28a18d79b0919cfa6d647f70f))
* shared workspace param schema and client resolver ([caaf3b5](https://github.com/notcodev/claude-weeek/commit/caaf3b523c1d10ab18c438b7fe48e933335d5e51))
* WorkspaceRegistry and createRegistry factory ([0568075](https://github.com/notcodev/claude-weeek/commit/0568075020221391043e0fe37ea9b5fa283ed6f6))

# Changelog

All notable changes to `claude-weeek` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-04-09

Initial release. MCP server for the WEEEK task tracker.

### Added

- Stdio MCP server entry point (`claude-weeek` bin).
- Bearer token auth via `WEEEK_API_TOKEN` environment variable.
- Centralized `WeeekApiClient` with 30s timeout, error normalization, and stderr-only logging.
- 7 read tools: `weeek_list_projects`, `weeek_get_project`, `weeek_list_boards`, `weeek_list_board_columns`, `weeek_list_tasks`, `weeek_get_task`, `weeek_list_task_comments`.
- 5 write tools: `weeek_create_task`, `weeek_update_task`, `weeek_move_task`, `weeek_complete_task`, `weeek_create_task_comment`.
- Read/write tool group split for MCP client auto-approve configuration.
- Default pagination (20, max 50) on list tools to stay under the 25k token MCP response limit.
- Structured error responses (`isError: true`) — the server process never crashes on API failures.
- README with Claude Desktop + Cursor config examples and the NVM absolute-path workaround.

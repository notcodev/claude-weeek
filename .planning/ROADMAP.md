# Roadmap: WEEEK MCP Server

## Overview

Four phases take the project from zero to a published npm package. Phase 1 establishes a rock-solid foundation — server boots, auth works, logging is stderr-only, errors never crash the process. Phase 2 delivers all read tools so agents can navigate workspaces and fetch task context. Phase 3 adds write tools so agents can act — creating, updating, moving, and commenting on tasks. Phase 4 packages everything for public distribution with proper docs and test coverage.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Foundation** - Server boots, auth validated, API client ready, logging and error handling established (completed 2026-04-09)
- [ ] **Phase 2: Read Tools** - All navigation and read tools working — agents can fetch projects, boards, tasks, and comments
- [ ] **Phase 3: Write Tools** - All mutation tools working — agents can create, update, move, complete tasks and post comments
- [ ] **Phase 4: Distribution & Quality** - npm package published, README complete, tests in place

## Phase Details

### Phase 1: Foundation
**Goal**: The server infrastructure is correct and safe — it starts cleanly, validates the API token, routes all logging to stderr, and returns structured errors without crashing
**Depends on**: Nothing (first phase)
**Requirements**: INFRA-01, INFRA-02, INFRA-03, INFRA-04, INFRA-05, INFRA-06, INFRA-07
**Success Criteria** (what must be TRUE):
  1. Running `WEEEK_API_TOKEN=test npx weeek-mcp-server` starts the server and blocks on stdin with zero bytes written to stdout
  2. Running `npx weeek-mcp-server` without the env var exits immediately with a clear error message (not a silent crash)
  3. An invalid API token causes all tool calls to return `isError: true` with a human-readable message — the server process does not exit
  4. Read tools and write tools are registered in separate groups, observable via MCP Inspector's tool list
  5. List tool responses include a default limit parameter — raw list calls do not return unlimited records
**Plans**: 3 plans
Plans:
- [ ] 01-foundation/01-01-PLAN.md — Bootstrap npm package (package.json, tsconfig, eslint, ignores)
- [ ] 01-foundation/01-02-PLAN.md — Core infra modules (logger, config, errors, WeeekApiClient)
- [ ] 01-foundation/01-03-PLAN.md — MCP server entry point + empty read/write tool groups

### Phase 2: Read Tools
**Goal**: Agents can fully navigate a WEEEK workspace — listing projects and boards, exploring columns, fetching task lists with filters, reading task details, and viewing comments
**Depends on**: Phase 1
**Requirements**: NAV-01, NAV-02, NAV-03, NAV-04, TASK-01, TASK-02, TASK-03, CMNT-01
**Success Criteria** (what must be TRUE):
  1. Agent can list all projects in a workspace and retrieve details for a specific project by ID
  2. Agent can list boards within a project and list columns within a board (prerequisite for understanding task statuses)
  3. Agent can list tasks filtered by project, board, column, or assignee — with pagination returning at most 20 by default
  4. Agent can retrieve full details of a single task by ID
  5. Agent can list comments on a task
**Plans**: TBD

### Phase 3: Write Tools
**Goal**: Agents can take action — creating tasks, updating task fields, moving tasks between columns, completing or reopening tasks, and posting comments
**Depends on**: Phase 2
**Requirements**: TASK-04, TASK-05, TASK-06, TASK-07, CMNT-02
**Success Criteria** (what must be TRUE):
  1. Agent can create a task with title, description, project, board, priority, and assignee — the created task is returned in the response
  2. Agent can update a task's title, description, priority, or assignee — the updated task state is returned
  3. Agent can move a task to a different board column — status change is reflected when task is fetched afterwards
  4. Agent can mark a task complete or reopen a completed task
  5. Agent can post a comment on a task — the created comment is returned in the response
**Plans**: TBD

### Phase 4: Distribution & Quality
**Goal**: The server is published to npm, installable via `npx weeek-mcp-server`, documented with working config examples, and covered by tests
**Depends on**: Phase 3
**Requirements**: DIST-01, DIST-02, DIST-03, DIST-04, DIST-05, QUAL-01, QUAL-02, QUAL-03
**Success Criteria** (what must be TRUE):
  1. `npx weeek-mcp-server` on a machine with no prior installation starts the server successfully (ESM resolution works, shebang is present)
  2. README contains copy-paste configs for Claude Desktop and Cursor, including the NVM absolute-path workaround
  3. Every tool has a description that answers "when to use this vs. similar tools" — validated by asking an agent to select the right tool for common scenarios
  4. All tool input parameters are validated by Zod schemas — invalid inputs return descriptive errors, not crashes
  5. Integration or mocked tests cover the happy path and error path for at least the core task read/write tools
**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation | 3/3 | Complete   | 2026-04-09 |
| 2. Read Tools | 0/? | Not started | - |
| 3. Write Tools | 0/? | Not started | - |
| 4. Distribution & Quality | 0/? | Not started | - |

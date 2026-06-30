/**
 * Maximal argument fixtures per tool: every optional parameter populated so
 * the captured request surfaces every body field / query key the tool can
 * emit. ID-like values are sentinels — the path matcher treats any single
 * segment as a {param} match. Each tool maps to an ARRAY of arg sets so tools
 * with mutually-exclusive branches (complete vs un-complete) are fully covered.
 */

export const toolFixtures: Record<string, Record<string, unknown>[]> =
  {
    // Read tools
    weeek_list_projects: [{ limit: 50, offset: 0 }],
    weeek_get_project: [{ project_id: 'PID' }],
    weeek_list_boards: [{ project_id: 'PID', limit: 50, offset: 0 }],
    weeek_list_board_columns: [
      { board_id: 'BID', limit: 50, offset: 0 },
    ],
    weeek_list_tasks: [
      {
        project_id: 'PID',
        board_id: 'BID',
        column_id: 'CID',
        assignee_id: 'UID',
        is_completed: true,
        limit: 50,
        offset: 0,
      },
    ],
    weeek_get_task: [{ task_id: 'TID' }],
    weeek_list_workspace_members: [{ limit: 50, offset: 0 }],
    weeek_list_workspaces: [{}], // no API call — reads the local registry

    // Write tools
    weeek_create_task: [
      {
        title: 'Fixture task',
        project_id: 'PID',
        description: 'desc',
        board_id: 'BID',
        board_column_id: 'CID',
        priority: 1,
        assignee_id: 'UID',
        date_end: '2026-01-01',
      },
    ],
    weeek_update_task: [
      {
        task_id: 'TID',
        title: 'Fixture task',
        description: 'desc',
        priority: 1,
        assignee_id: 'UID',
        date_end: '2026-01-01',
      },
    ],
    weeek_move_task: [
      { task_id: 'TID', board_column_id: 'CID', board_id: 'BID' },
    ],
    weeek_complete_task: [
      { task_id: 'TID', completed: true },
      { task_id: 'TID', completed: false },
    ],
  }

import { describe, it, expect, vi, beforeEach } from "vitest";
import { registerListBoards } from "../../src/tools/read/list-boards.js";
import { WeeekApiError } from "../../src/errors.js";

type Handler = (args: {
  project_id: string;
  limit?: number;
  offset?: number;
}) => Promise<{
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}>;

function makeFakeServer() {
  let capturedName = "";
  let capturedDescription = "";
  let capturedHandler: Handler | null = null;
  const server = {
    registerTool: vi.fn(
      (name: string, meta: { description: string }, handler: Handler) => {
        capturedName = name;
        capturedDescription = meta.description;
        capturedHandler = handler;
      }
    ),
  };
  return {
    server: server as unknown as Parameters<typeof registerListBoards>[0],
    getName: () => capturedName,
    getDescription: () => capturedDescription,
    getHandler: () => {
      if (!capturedHandler) throw new Error("no handler captured");
      return capturedHandler;
    },
  };
}

function makeFakeClient(getImpl: (path: string, query?: unknown) => Promise<unknown>) {
  return {
    get: vi.fn(getImpl),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
  } as unknown as Parameters<typeof registerListBoards>[1];
}

describe("weeek_list_boards tool", () => {
  let fake: ReturnType<typeof makeFakeServer>;

  beforeEach(() => {
    fake = makeFakeServer();
  });

  it("registers under the weeek_list_boards name", () => {
    const client = makeFakeClient(async () => ({ boards: [] }));
    registerListBoards(fake.server, client);
    expect(fake.getName()).toBe("weeek_list_boards");
  });

  it("description references navigation context tools", () => {
    const client = makeFakeClient(async () => ({ boards: [] }));
    registerListBoards(fake.server, client);
    const desc = fake.getDescription();
    expect(desc).toMatch(/weeek_list_projects/);
    expect(desc).toMatch(/weeek_list_board_columns/);
  });

  it("GETs /tm/boards with projectId query and shapes boards", async () => {
    const getFn = vi.fn(async (_path: string, _query?: unknown) => ({
      boards: [
        { id: 10, name: "Sprint Board", projectId: "proj-1", type: "kanban" },
        { id: "b2", title: "Backlog", projectId: "proj-1", type: null },
      ],
    }));
    const client = {
      get: getFn,
      post: vi.fn(),
      put: vi.fn(),
      patch: vi.fn(),
    } as unknown as Parameters<typeof registerListBoards>[1];
    registerListBoards(fake.server, client);

    const res = await fake.getHandler()({ project_id: "proj-1" });
    expect(res.isError).toBeUndefined();

    const [path, query] = getFn.mock.calls[0]!;
    expect(path).toBe("/tm/boards");
    expect((query as Record<string, unknown>).projectId).toBe("proj-1");

    const payload = JSON.parse(res.content[0]!.text) as {
      boards: Array<{ id: string; name: string; projectId: string; type: string | null }>;
      count: number;
    };
    expect(payload.count).toBe(2);
    expect(payload.boards[0]).toEqual({ id: "10", name: "Sprint Board", projectId: "proj-1", type: "kanban" });
    expect(payload.boards[1]).toEqual({ id: "b2", name: "Backlog", projectId: "proj-1", type: null });
  });

  it("forwards limit and offset to the query", async () => {
    const getFn = vi.fn(async () => ({ boards: [] }));
    const client = {
      get: getFn,
      post: vi.fn(),
      put: vi.fn(),
      patch: vi.fn(),
    } as unknown as Parameters<typeof registerListBoards>[1];
    registerListBoards(fake.server, client);

    await fake.getHandler()({ project_id: "p1", limit: 10, offset: 5 });
    const query = getFn.mock.calls[0]![1] as Record<string, unknown>;
    expect(query.limit).toBe(10);
    expect(query.offset).toBe(5);
  });

  it("returns isError:true on WeeekApiError, does not throw", async () => {
    const client = makeFakeClient(async () => {
      throw new WeeekApiError(403, "forbidden");
    });
    registerListBoards(fake.server, client);

    const res = await fake.getHandler()({ project_id: "p1" });
    expect(res.isError).toBe(true);
    expect(res.content[0]?.text).toContain("403");
  });
});

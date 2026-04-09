import { describe, it, expect, vi, beforeEach } from "vitest";
import { registerListTaskComments } from "../../src/tools/read/list-task-comments.js";
import { WeeekApiError } from "../../src/errors.js";

type Handler = (args: {
  task_id: string;
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
    server: server as unknown as Parameters<typeof registerListTaskComments>[0],
    getName: () => capturedName,
    getDescription: () => capturedDescription,
    getHandler: () => {
      if (!capturedHandler) throw new Error("no handler captured");
      return capturedHandler;
    },
  };
}

describe("weeek_list_task_comments tool", () => {
  let fake: ReturnType<typeof makeFakeServer>;

  beforeEach(() => {
    fake = makeFakeServer();
  });

  it("registers under the weeek_list_task_comments name", () => {
    const client = {
      get: vi.fn(async () => ({ comments: [] })),
      post: vi.fn(),
      put: vi.fn(),
      patch: vi.fn(),
    } as unknown as Parameters<typeof registerListTaskComments>[1];
    registerListTaskComments(fake.server, client);
    expect(fake.getName()).toBe("weeek_list_task_comments");
  });

  it("description references weeek_get_task as the predecessor step", () => {
    const client = {
      get: vi.fn(async () => ({ comments: [] })),
      post: vi.fn(),
      put: vi.fn(),
      patch: vi.fn(),
    } as unknown as Parameters<typeof registerListTaskComments>[1];
    registerListTaskComments(fake.server, client);
    const desc = fake.getDescription();
    expect(desc).toMatch(/weeek_get_task/);
    expect(desc).toMatch(/weeek_list_tasks/);
  });

  it("GETs /tm/tasks/{id}/comments and shapes comments", async () => {
    const getFn = vi.fn(async (path: string) => {
      expect(path).toBe("/tm/tasks/t1/comments");
      return {
        comments: [
          { id: "c1", text: "Great work!", authorId: "u1", createdAt: "2026-01-01" },
          { id: "c2", body: "Nice.", userId: "u2" },
        ],
      };
    });
    const client = {
      get: getFn,
      post: vi.fn(),
      put: vi.fn(),
      patch: vi.fn(),
    } as unknown as Parameters<typeof registerListTaskComments>[1];
    registerListTaskComments(fake.server, client);

    const res = await fake.getHandler()({ task_id: "t1" });
    expect(res.isError).toBeUndefined();

    const payload = JSON.parse(res.content[0]!.text) as {
      comments: Array<{ id: string; text: string; authorId: string | null; createdAt: string | null }>;
      count: number;
    };
    expect(payload.count).toBe(2);
    expect(payload.comments[0]).toEqual({
      id: "c1",
      text: "Great work!",
      authorId: "u1",
      createdAt: "2026-01-01",
    });
    // body field fallback and userId fallback
    expect(payload.comments[1]!.text).toBe("Nice.");
    expect(payload.comments[1]!.authorId).toBe("u2");
    expect(payload.comments[1]!.createdAt).toBeNull();
  });

  it("falls back to embedded task.comments on 404 from primary endpoint", async () => {
    let callCount = 0;
    const getFn = vi.fn(async (path: string) => {
      callCount++;
      if (callCount === 1) {
        // Primary comments endpoint returns 404
        throw new WeeekApiError(404, "not found");
      }
      // Fallback: get-task endpoint with embedded comments
      expect(path).toBe("/tm/tasks/t2");
      return {
        task: {
          id: "t2",
          title: "Task with embedded comments",
          comments: [{ id: "c9", text: "Embedded comment", authorId: "u5", createdAt: "2026-03-01" }],
        },
      };
    });
    const client = {
      get: getFn,
      post: vi.fn(),
      put: vi.fn(),
      patch: vi.fn(),
    } as unknown as Parameters<typeof registerListTaskComments>[1];
    registerListTaskComments(fake.server, client);

    const res = await fake.getHandler()({ task_id: "t2" });
    expect(res.isError).toBeUndefined();

    const payload = JSON.parse(res.content[0]!.text) as {
      comments: Array<{ id: string; text: string }>;
      count: number;
      note?: string;
    };
    expect(payload.count).toBe(1);
    expect(payload.comments[0]!.text).toBe("Embedded comment");
    expect(payload.note).toMatch(/fallback/);
  });

  it("returns isError:true on non-404 WeeekApiError, does not throw", async () => {
    const client = {
      get: vi.fn(async () => {
        throw new WeeekApiError(500, "internal server error");
      }),
      post: vi.fn(),
      put: vi.fn(),
      patch: vi.fn(),
    } as unknown as Parameters<typeof registerListTaskComments>[1];
    registerListTaskComments(fake.server, client);

    const res = await fake.getHandler()({ task_id: "t1" });
    expect(res.isError).toBe(true);
  });
});

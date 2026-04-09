import { describe, it, expect, vi, beforeEach } from "vitest";
import { registerCreateTaskComment } from "../../src/tools/write/create-task-comment.js";
import { WeeekApiError } from "../../src/errors.js";

type CommentArgs = {
  task_id: string;
  text: string;
};

type Handler = (args: CommentArgs) => Promise<{
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
    server: server as unknown as Parameters<typeof registerCreateTaskComment>[0],
    getName: () => capturedName,
    getDescription: () => capturedDescription,
    getHandler: () => {
      if (!capturedHandler) throw new Error("no handler captured");
      return capturedHandler;
    },
  };
}

describe("weeek_create_task_comment tool", () => {
  let fake: ReturnType<typeof makeFakeServer>;

  beforeEach(() => {
    fake = makeFakeServer();
  });

  it("registers under the weeek_create_task_comment name", () => {
    const client = {
      get: vi.fn(),
      post: vi.fn(async () => ({ comment: { id: "c1" } })),
      put: vi.fn(),
      patch: vi.fn(),
    } as unknown as Parameters<typeof registerCreateTaskComment>[1];
    registerCreateTaskComment(fake.server, client);
    expect(fake.getName()).toBe("weeek_create_task_comment");
  });

  it("description references weeek_list_task_comments as the read counterpart", () => {
    const client = {
      get: vi.fn(),
      post: vi.fn(),
      put: vi.fn(),
      patch: vi.fn(),
    } as unknown as Parameters<typeof registerCreateTaskComment>[1];
    registerCreateTaskComment(fake.server, client);
    const desc = fake.getDescription();
    expect(desc).toMatch(/weeek_list_task_comments/);
    expect(desc).toMatch(/weeek_list_tasks/);
  });

  it("POSTs to /tm/tasks/{id}/comments with text body", async () => {
    const postFn = vi.fn(async () => ({ comment: { id: "c1", text: "Looks good!" } }));
    const client = {
      get: vi.fn(),
      post: postFn,
      put: vi.fn(),
      patch: vi.fn(),
    } as unknown as Parameters<typeof registerCreateTaskComment>[1];
    registerCreateTaskComment(fake.server, client);

    await fake.getHandler()({ task_id: "task-77", text: "Looks good!" });

    expect(postFn).toHaveBeenCalledTimes(1);
    const [path, body] = postFn.mock.calls[0]!;
    expect(path).toBe("/tm/tasks/task-77/comments");
    expect(body).toEqual({ text: "Looks good!" });
  });

  it("unwraps the comment envelope in the response", async () => {
    const client = {
      get: vi.fn(),
      post: vi.fn(async () => ({
        comment: { id: "c1", text: "Done", authorId: "u1", createdAt: "2026-04-01" },
      })),
      put: vi.fn(),
      patch: vi.fn(),
    } as unknown as Parameters<typeof registerCreateTaskComment>[1];
    registerCreateTaskComment(fake.server, client);

    const res = await fake.getHandler()({ task_id: "t1", text: "Done" });
    expect(res.isError).toBeUndefined();
    const payload = JSON.parse(res.content[0]!.text) as Record<string, unknown>;
    expect(payload).toEqual({ id: "c1", text: "Done", authorId: "u1", createdAt: "2026-04-01" });
  });

  it("handles raw (non-enveloped) comment response", async () => {
    const client = {
      get: vi.fn(),
      post: vi.fn(async () => ({ id: "c2", text: "raw response" })),
      put: vi.fn(),
      patch: vi.fn(),
    } as unknown as Parameters<typeof registerCreateTaskComment>[1];
    registerCreateTaskComment(fake.server, client);

    const res = await fake.getHandler()({ task_id: "t1", text: "raw response" });
    const payload = JSON.parse(res.content[0]!.text) as Record<string, unknown>;
    expect(payload.id).toBe("c2");
  });

  it("returns isError:true on WeeekApiError, does not throw", async () => {
    const client = {
      get: vi.fn(),
      post: vi.fn(async () => { throw new WeeekApiError(404, "task not found"); }),
      put: vi.fn(),
      patch: vi.fn(),
    } as unknown as Parameters<typeof registerCreateTaskComment>[1];
    registerCreateTaskComment(fake.server, client);

    const res = await fake.getHandler()({ task_id: "missing", text: "hello" });
    expect(res.isError).toBe(true);
    expect(res.content[0]?.text).toContain("Resource not found");
  });
});

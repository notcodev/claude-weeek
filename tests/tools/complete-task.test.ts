import { describe, it, expect, vi, beforeEach } from "vitest";
import { registerCompleteTask } from "../../src/tools/write/complete-task.js";
import { WeeekApiError } from "../../src/errors.js";

type CompleteArgs = {
  task_id: string;
  completed?: boolean;
};

type Handler = (args: CompleteArgs) => Promise<{
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
    server: server as unknown as Parameters<typeof registerCompleteTask>[0],
    getName: () => capturedName,
    getDescription: () => capturedDescription,
    getHandler: () => {
      if (!capturedHandler) throw new Error("no handler captured");
      return capturedHandler;
    },
  };
}

describe("weeek_complete_task tool", () => {
  let fake: ReturnType<typeof makeFakeServer>;

  beforeEach(() => {
    fake = makeFakeServer();
  });

  it("registers under the weeek_complete_task name", () => {
    const client = {
      get: vi.fn(),
      post: vi.fn(),
      put: vi.fn(async () => ({ task: { id: "t1", isCompleted: true } })),
      patch: vi.fn(),
    } as unknown as Parameters<typeof registerCompleteTask>[1];
    registerCompleteTask(fake.server, client);
    expect(fake.getName()).toBe("weeek_complete_task");
  });

  it("description distinguishes itself from move_task and update_task", () => {
    const client = {
      get: vi.fn(),
      post: vi.fn(),
      put: vi.fn(),
      patch: vi.fn(),
    } as unknown as Parameters<typeof registerCompleteTask>[1];
    registerCompleteTask(fake.server, client);
    const desc = fake.getDescription();
    expect(desc).toMatch(/weeek_move_task/);
    expect(desc).toMatch(/weeek_update_task/);
    expect(desc).toMatch(/weeek_list_tasks/);
  });

  it("PUTs isCompleted:true by default when completed is not provided", async () => {
    const putFn = vi.fn(async () => ({ task: { id: "t1", isCompleted: true } }));
    const client = {
      get: vi.fn(),
      post: vi.fn(),
      put: putFn,
      patch: vi.fn(),
    } as unknown as Parameters<typeof registerCompleteTask>[1];
    registerCompleteTask(fake.server, client);

    await fake.getHandler()({ task_id: "t1" });

    const [path, body] = putFn.mock.calls[0]!;
    expect(path).toBe("/tm/tasks/t1");
    expect(body).toEqual({ isCompleted: true });
  });

  it("PUTs isCompleted:false when completed=false to reopen a task", async () => {
    const putFn = vi.fn(async () => ({ task: { id: "t1", isCompleted: false } }));
    const client = {
      get: vi.fn(),
      post: vi.fn(),
      put: putFn,
      patch: vi.fn(),
    } as unknown as Parameters<typeof registerCompleteTask>[1];
    registerCompleteTask(fake.server, client);

    await fake.getHandler()({ task_id: "t1", completed: false });
    const body = putFn.mock.calls[0]![1] as Record<string, unknown>;
    expect(body.isCompleted).toBe(false);
  });

  it("returns isError:true on WeeekApiError, does not throw", async () => {
    const client = {
      get: vi.fn(),
      post: vi.fn(),
      put: vi.fn(async () => { throw new WeeekApiError(404, "task not found"); }),
      patch: vi.fn(),
    } as unknown as Parameters<typeof registerCompleteTask>[1];
    registerCompleteTask(fake.server, client);

    const res = await fake.getHandler()({ task_id: "missing" });
    expect(res.isError).toBe(true);
    expect(res.content[0]?.text).toContain("Resource not found");
  });
});

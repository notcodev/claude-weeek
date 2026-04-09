import { describe, it, expect, vi, beforeEach } from "vitest";
import { registerGetProject } from "../../src/tools/read/get-project.js";
import { WeeekApiError } from "../../src/errors.js";

type Handler = (args: { project_id: string }) => Promise<{
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
    server: server as unknown as Parameters<typeof registerGetProject>[0],
    getName: () => capturedName,
    getDescription: () => capturedDescription,
    getHandler: () => {
      if (!capturedHandler) throw new Error("no handler captured");
      return capturedHandler;
    },
  };
}

function makeFakeClient(getImpl: (path: string) => Promise<unknown>) {
  return {
    get: vi.fn(getImpl),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
  } as unknown as Parameters<typeof registerGetProject>[1];
}

describe("weeek_get_project tool", () => {
  let fake: ReturnType<typeof makeFakeServer>;

  beforeEach(() => {
    fake = makeFakeServer();
  });

  it("registers under the weeek_get_project name", () => {
    const client = makeFakeClient(async () => ({ project: { id: "p1" } }));
    registerGetProject(fake.server, client);
    expect(fake.getName()).toBe("weeek_get_project");
  });

  it("description references sibling tools for navigation context", () => {
    const client = makeFakeClient(async () => ({ project: {} }));
    registerGetProject(fake.server, client);
    const desc = fake.getDescription();
    expect(desc).toMatch(/weeek_list_projects/);
    expect(desc).toMatch(/weeek_list_boards/);
  });

  it("GETs /tm/projects/{id} and unwraps the project envelope", async () => {
    const getFn = vi.fn(async (path: string) => {
      expect(path).toBe("/tm/projects/proj-42");
      return { success: true, project: { id: "proj-42", title: "My Project", description: "desc" } };
    });
    const client = {
      get: getFn,
      post: vi.fn(),
      put: vi.fn(),
      patch: vi.fn(),
    } as unknown as Parameters<typeof registerGetProject>[1];
    registerGetProject(fake.server, client);

    const res = await fake.getHandler()({ project_id: "proj-42" });
    expect(res.isError).toBeUndefined();
    const payload = JSON.parse(res.content[0]!.text) as Record<string, unknown>;
    expect(payload).toEqual({ id: "proj-42", title: "My Project", description: "desc" });
  });

  it("returns raw response when no project envelope present", async () => {
    const client = makeFakeClient(async () => ({ id: "p99", title: "Raw" }));
    registerGetProject(fake.server, client);

    const res = await fake.getHandler()({ project_id: "p99" });
    expect(res.isError).toBeUndefined();
    const payload = JSON.parse(res.content[0]!.text) as Record<string, unknown>;
    expect(payload.id).toBe("p99");
    expect(payload.title).toBe("Raw");
  });

  it("returns isError:true on WeeekApiError, does not throw", async () => {
    const client = makeFakeClient(async () => {
      throw new WeeekApiError(404, "project not found");
    });
    registerGetProject(fake.server, client);

    const res = await fake.getHandler()({ project_id: "missing" });
    expect(res.isError).toBe(true);
    expect(res.content[0]?.text).toContain("Resource not found");
  });
});

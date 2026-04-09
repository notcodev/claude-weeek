import { describe, it, expect } from "vitest";
import {
  toMcpError,
  WeeekApiError,
  WeeekTimeoutError,
} from "../src/errors.js";

describe("toMcpError", () => {
  it("maps 400 to Bad Request message", () => {
    const res = toMcpError(new WeeekApiError(400, "invalid field"));
    expect(res.isError).toBe(true);
    expect(res.content[0]?.type).toBe("text");
    expect(res.content[0]?.text).toContain("400");
    expect(res.content[0]?.text).toContain("Bad Request");
  });

  it("maps 401 to Invalid WEEEK_API_TOKEN message without leaking the token", () => {
    const res = toMcpError(new WeeekApiError(401, "unauthorized"));
    expect(res.content[0]?.text).toContain("Invalid WEEEK_API_TOKEN");
    expect(res.content[0]?.text).not.toContain("unauthorized");
  });

  it("maps 403 to Forbidden message", () => {
    const res = toMcpError(new WeeekApiError(403, "no access"));
    expect(res.content[0]?.text).toContain("403");
    expect(res.content[0]?.text).toContain("Forbidden");
  });

  it("maps 404 to Resource not found message", () => {
    const res = toMcpError(new WeeekApiError(404, "missing"));
    expect(res.content[0]?.text).toContain("Resource not found");
  });

  it("maps 429 to rate limit message", () => {
    const res = toMcpError(new WeeekApiError(429, "slow down"));
    expect(res.content[0]?.text).toContain("rate limit");
  });

  it.each([500, 502, 503, 504])(
    "maps %i to server error message",
    (status) => {
      const res = toMcpError(new WeeekApiError(status, "boom"));
      expect(res.content[0]?.text).toContain("server error");
      expect(res.content[0]?.text).toContain(String(status));
    }
  );

  it("maps WeeekTimeoutError to its own message", () => {
    const res = toMcpError(new WeeekTimeoutError(30000));
    expect(res.content[0]?.text).toContain("timed out");
    expect(res.content[0]?.text).toContain("30000");
  });

  it("maps generic Error to Unexpected error", () => {
    const res = toMcpError(new Error("boom"));
    expect(res.content[0]?.text).toBe("Unexpected error: boom");
  });

  it("maps unknown thrown value to Unknown error", () => {
    const res = toMcpError("string value");
    expect(res.content[0]?.text).toBe("Unknown error: string value");
  });

  it("always returns isError:true with text content shape", () => {
    const res = toMcpError(new WeeekApiError(500, ""));
    expect(res.isError).toBe(true);
    expect(Array.isArray(res.content)).toBe(true);
    expect(res.content[0]?.type).toBe("text");
    expect(typeof res.content[0]?.text).toBe("string");
  });
});

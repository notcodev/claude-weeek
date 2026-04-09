import { describe, it, expect } from "vitest";
import {
  loadConfig,
  MissingConfigError,
  DEFAULT_BASE_URL,
  DEFAULT_LIST_LIMIT,
  DEFAULT_REQUEST_TIMEOUT_MS,
} from "../src/config.js";

describe("loadConfig", () => {
  it("throws MissingConfigError when WEEEK_API_TOKEN is undefined", () => {
    expect(() => loadConfig({})).toThrow(MissingConfigError);
  });

  it("throws MissingConfigError when WEEEK_API_TOKEN is empty string", () => {
    expect(() => loadConfig({ WEEEK_API_TOKEN: "" })).toThrow(MissingConfigError);
  });

  it("throws MissingConfigError when WEEEK_API_TOKEN is only whitespace", () => {
    expect(() => loadConfig({ WEEEK_API_TOKEN: "   " })).toThrow(MissingConfigError);
  });

  it("error message never contains the token value", () => {
    try {
      loadConfig({ WEEEK_API_TOKEN: "   " });
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(MissingConfigError);
      expect((err as Error).message).not.toContain("   ");
      expect((err as Error).message).toContain("WEEEK_API_TOKEN");
    }
  });

  it("returns config with defaults when token is provided", () => {
    const cfg = loadConfig({ WEEEK_API_TOKEN: "tok_123" });
    expect(cfg.token).toBe("tok_123");
    expect(cfg.baseUrl).toBe(DEFAULT_BASE_URL);
    expect(cfg.defaultListLimit).toBe(DEFAULT_LIST_LIMIT);
    expect(cfg.requestTimeoutMs).toBe(DEFAULT_REQUEST_TIMEOUT_MS);
  });

  it("honors WEEEK_API_BASE_URL override", () => {
    const cfg = loadConfig({
      WEEEK_API_TOKEN: "tok",
      WEEEK_API_BASE_URL: "https://staging.weeek.example/v1",
    });
    expect(cfg.baseUrl).toBe("https://staging.weeek.example/v1");
  });
});

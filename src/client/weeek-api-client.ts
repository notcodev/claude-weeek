/**
 * Centralized WEEEK Public API v1 client.
 *
 * INFRA-03: All HTTP calls to WEEEK go through this class. Tools never call
 * fetch directly. This isolates auth, timeout, base URL, and error handling
 * in one place.
 *
 * Uses native Node 20 fetch — no axios or other HTTP libraries.
 */

import {
  DEFAULT_BASE_URL,
  DEFAULT_REQUEST_TIMEOUT_MS,
} from "../config.js";
import { WeeekApiError, WeeekTimeoutError } from "../errors.js";
import { logger } from "../logger.js";

export type QueryParams = Record<
  string,
  string | number | boolean | undefined | null
>;

export interface WeeekApiClientOptions {
  baseUrl?: string;
  timeoutMs?: number;
}

export class WeeekApiClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(
    private readonly token: string,
    options: WeeekApiClientOptions = {}
  ) {
    if (!token || token.trim() === "") {
      throw new Error("WeeekApiClient: token must be a non-empty string");
    }
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    this.timeoutMs = options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  }

  async get<T>(path: string, query?: QueryParams): Promise<T> {
    return this.request<T>("GET", path, { query });
  }

  async post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>("POST", path, { body });
  }

  async put<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>("PUT", path, { body });
  }

  async patch<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>("PATCH", path, { body });
  }

  private async request<T>(
    method: "GET" | "POST" | "PUT" | "PATCH",
    path: string,
    opts: { query?: QueryParams; body?: unknown } = {}
  ): Promise<T> {
    const url = this.buildUrl(path, opts.query);
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
      Accept: "application/json",
    };

    const init: RequestInit = { method, headers };

    if (opts.body !== undefined) {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(opts.body);
    }

    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), this.timeoutMs);
    init.signal = controller.signal;

    // NOTE: logger.info writes to stderr — safe for stdio transport.
    // We intentionally do NOT log the Authorization header or request body.
    logger.info(`${method} ${this.redactPath(path)}`);

    try {
      const res = await fetch(url, init);
      const text = await res.text();

      if (!res.ok) {
        throw new WeeekApiError(res.status, text);
      }

      if (text === "") {
        return undefined as T;
      }

      try {
        return JSON.parse(text) as T;
      } catch (parseErr) {
        throw new WeeekApiError(
          res.status,
          `Invalid JSON from WEEEK API: ${(parseErr as Error).message}`
        );
      }
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        throw new WeeekTimeoutError(this.timeoutMs);
      }
      throw err;
    } finally {
      clearTimeout(timeoutHandle);
    }
  }

  private buildUrl(path: string, query?: QueryParams): string {
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    const url = new URL(`${this.baseUrl}${normalizedPath}`);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined && value !== null) {
          url.searchParams.set(key, String(value));
        }
      }
    }
    return url.toString();
  }

  private redactPath(path: string): string {
    // Defensive: strip query strings from log lines so we never accidentally
    // emit IDs or filters that may contain sensitive data.
    const qIdx = path.indexOf("?");
    return qIdx === -1 ? path : path.slice(0, qIdx);
  }
}

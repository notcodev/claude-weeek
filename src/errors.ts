/**
 * Error normalization for WEEEK MCP server.
 *
 * Contract (INFRA-05): Tool handlers NEVER throw. Every error — API failure,
 * validation mismatch, network timeout — is caught and converted to an
 * `{ isError: true, content: [...] }` response via `toMcpError`.
 *
 * This lets the LLM agent see a human-readable error message and self-correct
 * rather than the server process crashing (Pitfall 6).
 */

import { logger } from "./logger.js";

export class WeeekApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string,
    message?: string
  ) {
    super(message ?? `WEEEK API error ${status}: ${body.slice(0, 200)}`);
    this.name = "WeeekApiError";
  }
}

export class WeeekTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`WEEEK API request timed out after ${timeoutMs}ms`);
    this.name = "WeeekTimeoutError";
  }
}

/**
 * Maps HTTP status codes to human-readable, actionable messages.
 * Never includes the API token or sensitive request details.
 */
function humanMessage(err: WeeekApiError): string {
  switch (err.status) {
    case 400:
      return `WEEEK API rejected the request (400 Bad Request): ${err.body.slice(0, 300)}`;
    case 401:
      return "Invalid WEEEK_API_TOKEN — check the token in your WEEEK workspace settings and restart the MCP server.";
    case 403:
      return "WEEEK API returned 403 Forbidden — the token does not have access to this resource.";
    case 404:
      return `Resource not found (404). Verify the ID exists in the WEEEK workspace. Details: ${err.body.slice(0, 200)}`;
    case 429:
      return "WEEEK API rate limit reached (429). Wait a few seconds before retrying.";
    case 500:
    case 502:
    case 503:
    case 504:
      return `WEEEK API server error (${err.status}). This is a transient failure on WEEEK's side — retry shortly.`;
    default:
      return `WEEEK API error (${err.status}): ${err.body.slice(0, 300)}`;
  }
}

export interface McpErrorResponse {
  content: Array<{ type: "text"; text: string }>;
  isError: true;
}

/**
 * Converts any thrown error into a structured MCP error response.
 * Tool handlers should wrap their body in try/catch and return toMcpError(err)
 * on any failure. Never re-throws.
 */
export function toMcpError(err: unknown): McpErrorResponse {
  let text: string;

  if (err instanceof WeeekApiError) {
    text = humanMessage(err);
    logger.error("WeeekApiError", { status: err.status, body: err.body.slice(0, 200) });
  } else if (err instanceof WeeekTimeoutError) {
    text = err.message;
    logger.error("WeeekTimeoutError", { message: err.message });
  } else if (err instanceof Error) {
    text = `Unexpected error: ${err.message}`;
    logger.error("UnexpectedError", { name: err.name, message: err.message });
  } else {
    text = `Unknown error: ${String(err)}`;
    logger.error("UnknownError", { value: String(err) });
  }

  return {
    content: [{ type: "text", text }],
    isError: true,
  };
}

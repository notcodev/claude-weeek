/**
 * Environment configuration loader for WEEEK MCP server.
 *
 * Fails fast at startup if WEEEK_API_TOKEN is missing (Pitfall 7 mitigation:
 * no silent 401s, no logging the token value itself).
 */

export const DEFAULT_LIST_LIMIT = 20;
export const MAX_LIST_LIMIT = 50;
export const DEFAULT_BASE_URL = "https://api.weeek.net/public/v1";
export const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

export interface WeeekConfig {
  token: string;
  baseUrl: string;
  defaultListLimit: number;
  maxListLimit: number;
  requestTimeoutMs: number;
}

export class MissingConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MissingConfigError";
  }
}

/**
 * Loads configuration from environment variables.
 * Throws MissingConfigError with a clear, actionable message if required vars are missing.
 * NEVER logs or includes the token value in error messages.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): WeeekConfig {
  const token = env.WEEEK_API_TOKEN;
  if (!token || token.trim() === "") {
    throw new MissingConfigError(
      "WEEEK_API_TOKEN environment variable is required. " +
        "Obtain a token from WEEEK workspace settings and pass it via the MCP client's env config block. " +
        "Example: { \"env\": { \"WEEEK_API_TOKEN\": \"<your-token>\" } }"
    );
  }

  return {
    token,
    baseUrl: env.WEEEK_API_BASE_URL ?? DEFAULT_BASE_URL,
    defaultListLimit: DEFAULT_LIST_LIMIT,
    maxListLimit: MAX_LIST_LIMIT,
    requestTimeoutMs: DEFAULT_REQUEST_TIMEOUT_MS,
  };
}

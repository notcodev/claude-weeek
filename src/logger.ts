/**
 * stderr-only logger for WEEEK MCP server.
 *
 * CRITICAL: MCP stdio transport uses stdout for JSON-RPC. ANY write to stdout
 * corrupts the protocol stream and breaks the client connection silently.
 * All logging MUST go to stderr via console.error — never console.log.
 *
 * The ESLint `no-console` rule (configured in .eslintrc.json) enforces this
 * at the tooling layer: console.log is a lint error, console.error/warn are allowed.
 */

const PREFIX = "[weeek-mcp]";

function format(level: string, message: string, meta?: unknown): string {
  const ts = new Date().toISOString();
  const base = `${PREFIX} ${ts} [${level}] ${message}`;
  if (meta === undefined) return base;
  try {
    return `${base} ${JSON.stringify(meta)}`;
  } catch {
    return `${base} [unserializable meta]`;
  }
}

export const logger = {
  info(message: string, meta?: unknown): void {
    console.error(format("info", message, meta));
  },
  warn(message: string, meta?: unknown): void {
    console.warn(format("warn", message, meta));
  },
  error(message: string, meta?: unknown): void {
    console.error(format("error", message, meta));
  },
};

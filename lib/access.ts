// Who may reach the app. The server listens on 127.0.0.1 only. Without
// MCP_TOKEN everything is as on a laptop: local use, no login. With MCP_TOKEN
// set (to connect claude.ai through a tunnel), /api/mcp needs
// "Authorization: Bearer <token>" from everyone, and every other page and API
// answers only on this machine. Other websites open in the same browser can
// never change anything (lib/csrf.ts).
import crypto from "node:crypto";

export function mcpToken(): string | undefined {
  return process.env.MCP_TOKEN?.trim() || undefined;
}

/** Constant-time check of the bearer token. True when no token is configured. */
export function mcpAuthorized(req: Request): boolean {
  const token = mcpToken();
  if (!token) return true;
  const m = (req.headers.get("authorization") ?? "").match(/^Bearer\s+(\S+)\s*$/i);
  if (!m) return false;
  const a = crypto.createHash("sha256").update(m[1]).digest();
  const b = crypto.createHash("sha256").update(token).digest();
  return crypto.timingSafeEqual(a, b);
}


// Two guards, before any route runs:
// - Other websites open in the same browser cannot change anything here
//   (a form or no-cors POST to localhost); see crossSiteWrite.
// - With MCP_TOKEN set the app may sit behind a tunnel for claude.ai. Then
//   only /api/mcp (which checks the token) answers from outside; every page
//   and the other APIs answer only on this machine.
// The tunnel must front `next start`: Next's dev server answers some of its
// own endpoints before middleware runs (scripts/tunnel.sh checks this).
import { NextResponse, type NextRequest } from "next/server";
import { crossSiteWrite } from "./lib/csrf.ts";

const LOCAL = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
const deny = (msg: string) => new NextResponse(msg, { status: 403, headers: { "content-type": "text/plain; charset=utf-8" } });

export function middleware(req: NextRequest) {
  const mcp = req.nextUrl.pathname === "/api/mcp";
  if (!mcp && crossSiteWrite(req)) return deny("Changes come only from this app's own pages.");
  if (!process.env.MCP_TOKEN?.trim() || mcp) return NextResponse.next();
  const host = (req.headers.get("host") ?? "").replace(/:\d+$/, "");
  // Cloudflare's tunnel adds these. The server listens on 127.0.0.1 only, so
  // anything else reaching it came through a proxy on this machine.
  const proxied = req.headers.has("cf-connecting-ip") || req.headers.has("cf-ray");
  if (LOCAL.has(host) && !proxied) return NextResponse.next();
  return deny("Warm Paths answers only on this machine. Through the tunnel, only /api/mcp is open, with the token.");
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg).*)"] };

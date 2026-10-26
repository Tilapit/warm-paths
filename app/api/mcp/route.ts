// Streamable HTTP MCP endpoint, stateless: a fresh server and transport per
// request. With MCP_TOKEN set, every request needs the bearer token (for a
// tunnel to claude.ai); without it the endpoint is for this machine only.
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { buildMcpServer } from "@/lib/mcp.ts";
import { mcpAuthorized } from "@/lib/access.ts";

export const dynamic = "force-dynamic";

async function handle(req: Request): Promise<Response> {
  if (!mcpAuthorized(req)) {
    console.log(`[mcp] ${new Date().toISOString()} 401`);
    return Response.json({ jsonrpc: "2.0", error: { code: -32001, message: "Unauthorized: send Authorization: Bearer <MCP_TOKEN>" }, id: null }, { status: 401, headers: { "WWW-Authenticate": 'Bearer realm="warm-paths"' } });
  }
  const server = buildMcpServer();
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  return transport.handleRequest(req);
}

export { handle as GET, handle as POST, handle as DELETE };

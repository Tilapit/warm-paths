import { test } from "node:test";
import assert from "node:assert/strict";

const { mcpAuthorized } = await import("../lib/access.ts");
const req = (auth?: string) => new Request("http://localhost:3310/api/mcp", { method: "POST", headers: auth ? { authorization: auth } : {} });

test("MCP token: without MCP_TOKEN the connector is open on this machine", () => {
  delete process.env.MCP_TOKEN;
  assert.equal(mcpAuthorized(req()), true);
});

test("MCP token: with MCP_TOKEN only the exact bearer token passes", () => {
  process.env.MCP_TOKEN = "s3cret-token";
  assert.equal(mcpAuthorized(req()), false);
  assert.equal(mcpAuthorized(req("Bearer nope")), false);
  assert.equal(mcpAuthorized(req("Bearer s3cret-token-and-more")), false);
  assert.equal(mcpAuthorized(req("Basic s3cret-token")), false);
  assert.equal(mcpAuthorized(req("Bearer s3cret-token")), true);
  assert.equal(mcpAuthorized(req("bearer   s3cret-token ")), true);
  delete process.env.MCP_TOKEN;
});

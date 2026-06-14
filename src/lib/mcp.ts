import { MCPClient } from '@mastra/mcp';

// Neon's hosted docs MCP server gives the assistant tools to search the Neon
// documentation so it can answer support questions accurately.
const mcp = new MCPClient({
  id: 'neon-docs',
  servers: {
    neonDocs: {
      url: new URL('https://mcp.neon.tech/mcp?category=docs'),
    },
  },
});

// Toolsets are fetched per request (lazy connect). Returns undefined on failure
// so the assistant can still answer without docs tools.
export async function neonDocsToolsets() {
  try {
    return await mcp.listToolsets();
  } catch (error) {
    console.error('[mcp] neon docs toolsets failed:', error);
    return undefined;
  }
}

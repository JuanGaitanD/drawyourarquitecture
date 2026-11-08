// Función de Vercel (Node): Streamable HTTP del SDK oficial de MCP, sin estado.
// El código vive en src/server y se empaqueta en _mcp.mjs (node scripts/bundle-mcp.mjs): ver docs/mcp.md.
import handler from './_mcp.mjs';

export default handler;

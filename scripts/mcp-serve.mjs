// Levanta el endpoint MCP empaquetado (api/_mcp.mjs) en un servidor HTTP de Node, sin Vercel.
// Sirve para probarlo de extremo a extremo contra los emuladores:
//   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 OWNER_UID=owner-test node scripts/mcp-serve.mjs [puerto]
// y conectar un cliente MCP a http://127.0.0.1:<puerto>/api/mcp con `Authorization: Bearer <token>`.
import { createServer } from 'node:http';
import handler from '../api/_mcp.mjs';

const port = Number(process.argv[2] ?? process.env.PORT ?? 3977);
const server = createServer((req, res) => void handler(req, res));
server.listen(port, '127.0.0.1', () =>
  console.log(`MCP escuchando en http://127.0.0.1:${server.address().port}/api/mcp`),
);

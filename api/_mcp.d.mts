import type { IncomingMessage, ServerResponse } from 'node:http';
declare const handler: (req: IncomingMessage & { body?: unknown }, res: ServerResponse) => Promise<void>;
export default handler;

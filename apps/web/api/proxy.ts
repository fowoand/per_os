import type { IncomingMessage, ServerResponse } from 'node:http';

type VercelRequest = IncomingMessage & { body?: unknown };

export default async function handler(request: VercelRequest, response: ServerResponse): Promise<void> {
  const secret = process.env.API_PROTECTION_BYPASS;
  if (!secret) {
    response.writeHead(503).end('API proxy unavailable');
    return;
  }
  const incoming = new URL(request.url ?? '/', 'http://localhost');
  const path = incoming.searchParams.get('path');
  if (!path) {
    response.writeHead(404).end();
    return;
  }
  const target = new URL('https://personal-os-api-dev.vercel.app');
  target.pathname = `/api/${path}`;
  incoming.searchParams.delete('path');
  target.search = incoming.searchParams.toString();
  try {
    // ponytail: V001 forwards JSON only; add streaming when backups exceed Vercel request limits.
    const upstream = await fetch(target, {
      method: request.method,
      headers: { 'content-type': 'application/json', 'x-vercel-protection-bypass': secret },
      body: request.method === 'GET' || request.method === 'HEAD' ? undefined : JSON.stringify(request.body),
    });
    response.writeHead(upstream.status, {
      'content-type': upstream.headers.get('content-type') ?? 'application/json',
      'cache-control': 'no-store',
    });
    response.end(Buffer.from(await upstream.arrayBuffer()));
  } catch {
    response.writeHead(502).end('API unavailable');
  }
}

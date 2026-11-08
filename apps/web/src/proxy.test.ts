import { afterEach, expect, it, vi } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'node:http';
import handler from '../api/proxy.js';

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.API_PROTECTION_BYPASS;
});

it('forwards nested API path and query without exposing bypass token to browser', async () => {
  process.env.API_PROTECTION_BYPASS = 'test-secret';
  const fetchMock = vi.fn(async () => new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } }));
  vi.stubGlobal('fetch', fetchMock);
  let status = 0;
  let headers: Record<string, string> = {};
  let body: Buffer | undefined;
  const response = {
    writeHead(code: number, values: Record<string, string>) { status = code; headers = values; return this; },
    end(value: Buffer) { body = value; return this; },
  } as unknown as ServerResponse;
  await handler({ url: '/api/proxy?path=months%2F2026-11%2Fsummary&view=full', method: 'GET' } as IncomingMessage, response);
  expect(fetchMock).toHaveBeenCalledWith(new URL('https://personal-os-api-dev.vercel.app/api/months/2026-11/summary?view=full'),
    expect.objectContaining({ headers: expect.objectContaining({ 'x-vercel-protection-bypass': 'test-secret' }) }));
  expect(status).toBe(200);
  expect(headers['cache-control']).toBe('no-store');
  expect(body?.toString()).toBe('{"ok":true}');
});

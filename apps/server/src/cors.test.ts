import Fastify from 'fastify';
import { expect, it } from 'vitest';
import { registerCors } from './cors.js';

it('allows protected web origin to preflight API requests', async () => {
  const app = Fastify();
  registerCors(app);
  const response = await app.inject({ method: 'OPTIONS', url: '/api/goals', headers: {
    origin: 'https://personal-os-web-dev.vercel.app',
    'access-control-request-method': 'POST',
    'access-control-request-headers': 'content-type',
  } });
  expect(response.statusCode).toBe(204);
  expect(response.headers['access-control-allow-origin']).toBe('https://personal-os-web-dev.vercel.app');
  expect(response.headers['access-control-allow-credentials']).toBe('true');
  await app.close();
});

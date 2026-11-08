import type { FastifyInstance } from 'fastify';

const webOrigins = new Set([
  'https://personal-os-web-dev.vercel.app',
  'https://personal-os-web-fawn.vercel.app',
]);

export function registerCors(app: FastifyInstance): void {
  app.addHook('onRequest', async (request, reply) => {
    const origin = request.headers.origin;
    if (origin && webOrigins.has(origin)) {
      reply.header('Access-Control-Allow-Origin', origin);
      reply.header('Access-Control-Allow-Credentials', 'true');
      reply.header('Access-Control-Allow-Methods', 'GET, POST, PATCH, PUT, DELETE, OPTIONS');
      reply.header('Access-Control-Allow-Headers', 'Content-Type');
      reply.header('Vary', 'Origin');
    }
    if (request.method === 'OPTIONS') return reply.code(204).send();
  });
  app.options('/api/*', async (_request, reply) => reply.code(204).send());
}

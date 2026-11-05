import Fastify from 'fastify';
import { openDatabase, schemaVersion } from './db.js';

const app = Fastify();
let dbPromise: ReturnType<typeof openDatabase> | undefined;

function database(): ReturnType<typeof openDatabase> {
  return dbPromise ??= openDatabase().catch((error: unknown) => {
    dbPromise = undefined;
    throw error;
  });
}

app.get('/health', async () => {
  return { status: 'ok', schemaVersion: await schemaVersion(await database()) };
});

void app.listen({ host: '0.0.0.0', port: Number(process.env.PORT ?? 3000) }).catch((error: unknown) => {
  app.log.error(error);
  process.exitCode = 1;
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void app.close().then(async () => { await (await dbPromise)?.end(); });
  });
}

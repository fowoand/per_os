import Fastify from 'fastify';
import { openDatabase, schemaVersion } from './db.js';

const db = await openDatabase();
const app = Fastify();
app.get('/health', async () => ({ status: 'ok', schemaVersion: await schemaVersion(db) }));
export default app;

if (!process.env.VERCEL) {
  try {
    await app.listen({ host: '0.0.0.0', port: Number(process.env.PORT ?? 3000) });
  } catch (error) {
    app.log.error(error);
    await db.end();
    process.exitCode = 1;
  }

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => { void app.close().then(() => db.end()); });
  }
}

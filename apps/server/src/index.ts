import Fastify from 'fastify';
import { openDatabase, schemaVersion } from './db.js';
import { monthRoutes } from './routes/months.js';
import { transactionRoutes } from './routes/transactions.js';
import { plannedItemRoutes } from './routes/planned-items.js';
import { balancesRoutes } from './routes/balances.js';
import { configRoutes } from './routes/config.js';
import { targetRoutes } from './routes/targets.js';
import { incomeSourceRoutes } from './routes/income-sources.js';
import { dashboardRoutes } from './routes/dashboard.js';
import { lifeRoutes } from './routes/life.js';
import { backupRoutes } from './routes/backup.js';

const app = Fastify();
const db = await openDatabase().catch((error: unknown) => {
  console.error('DB connection failed:', error);
  process.exit(1);
});

app.get('/health', async () => {
  return { status: 'ok', schemaVersion: await schemaVersion(db) };
});

await monthRoutes(app, db);
await transactionRoutes(app, db);
await plannedItemRoutes(app, db);
await balancesRoutes(app, db);
await configRoutes(app, db);
await targetRoutes(app, db);
await incomeSourceRoutes(app, db);
await dashboardRoutes(app, db);
await lifeRoutes(app, db);
await backupRoutes(app, db);

void app.listen({ host: '0.0.0.0', port: Number(process.env.PORT ?? 3000) }).catch((error: unknown) => {
  app.log.error(error);
  process.exitCode = 1;
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void app.close().then(async () => { await db.end(); });
  });
}

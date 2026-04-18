import { initClickHouse, closeClickHouse } from './clickhouse.js';
import { initPostgres, closePostgres } from './postgres.js';

async function migrate() {
  console.log('🔄 Running database migrations...');

  try {
    await initPostgres();
    await initClickHouse();
    console.log('✅ All migrations complete');
  } catch (err) {
    console.error('❌ Migration failed:', err);
    process.exit(1);
  } finally {
    await closePostgres();
    await closeClickHouse();
  }
}

migrate();

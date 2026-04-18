import postgres from 'postgres';

let sql: ReturnType<typeof postgres> | null = null;

/** Get or create the Postgres client singleton */
export function getPostgres(): ReturnType<typeof postgres> {
  if (!sql) {
    sql = postgres(process.env.DATABASE_URL ?? 'postgresql://panopticon:panopticon@localhost:5432/panopticon');
  }
  return sql;
}

/** Initialize Postgres schema */
export async function initPostgres(): Promise<void> {
  const db = getPostgres();

  await db`
    CREATE TABLE IF NOT EXISTS projects (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      api_key     TEXT NOT NULL UNIQUE,
      settings    JSONB NOT NULL DEFAULT '{}',
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await db`
    CREATE TABLE IF NOT EXISTS mcp_servers (
      id            TEXT PRIMARY KEY,
      project_id    TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name          TEXT NOT NULL,
      transport     TEXT NOT NULL DEFAULT 'stdio',
      endpoint      TEXT,
      status        TEXT NOT NULL DEFAULT 'unknown',
      last_seen     TIMESTAMPTZ,
      capabilities  JSONB NOT NULL DEFAULT '{}',
      tools         JSONB NOT NULL DEFAULT '[]',
      resources     JSONB NOT NULL DEFAULT '[]',
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await db`
    CREATE TABLE IF NOT EXISTS alert_rules (
      id                TEXT PRIMARY KEY,
      project_id        TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name              TEXT NOT NULL,
      condition         JSONB NOT NULL,
      channels          JSONB NOT NULL DEFAULT '[]',
      enabled           BOOLEAN NOT NULL DEFAULT true,
      cooldown_seconds  INTEGER NOT NULL DEFAULT 300,
      last_fired_at     TIMESTAMPTZ,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await db`
    CREATE INDEX IF NOT EXISTS idx_mcp_servers_project ON mcp_servers(project_id)
  `;

  await db`
    CREATE INDEX IF NOT EXISTS idx_alert_rules_project ON alert_rules(project_id)
  `;

  console.log('✅ Postgres schema initialized');
}

/** Close the Postgres client */
export async function closePostgres(): Promise<void> {
  if (sql) {
    await sql.end();
    sql = null;
  }
}

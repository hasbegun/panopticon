import postgres from 'postgres';

let sql: ReturnType<typeof postgres> | null = null;

/** Get or create the Postgres client singleton */
export function getPostgres(): ReturnType<typeof postgres> {
  if (!sql) {
    sql = postgres(process.env.DATABASE_URL ?? 'postgresql://panopticon:panopticon@localhost:5432/panopticon');
  }
  return sql;
}

/** Initialize auth-related Postgres tables */
export async function initAuthSchema(): Promise<void> {
  const db = getPostgres();

  await db`
    CREATE TABLE IF NOT EXISTS users (
      id            TEXT PRIMARY KEY,
      email         TEXT NOT NULL UNIQUE,
      name          TEXT NOT NULL DEFAULT '',
      password_hash TEXT NOT NULL,
      avatar_url    TEXT,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await db`
    CREATE TABLE IF NOT EXISTS project_members (
      project_id  TEXT NOT NULL,
      user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role        TEXT NOT NULL DEFAULT 'viewer'
                  CHECK (role IN ('owner', 'admin', 'member', 'viewer')),
      invited_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (project_id, user_id)
    )
  `;

  await db`
    CREATE INDEX IF NOT EXISTS idx_project_members_user ON project_members(user_id)
  `;

  console.log('✅ Auth schema initialized');
}

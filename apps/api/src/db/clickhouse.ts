import { createClient, type ClickHouseClient } from '@clickhouse/client';

let client: ClickHouseClient | null = null;

/** Get or create the ClickHouse client singleton */
export function getClickHouse(): ClickHouseClient {
  if (!client) {
    client = createClient({
      url: process.env.CLICKHOUSE_URL ?? 'http://localhost:8123',
      username: process.env.CLICKHOUSE_USER ?? 'default',
      password: process.env.CLICKHOUSE_PASSWORD ?? '',
      database: process.env.CLICKHOUSE_DB ?? 'panopticon',
    });
  }
  return client;
}

/** Initialize ClickHouse schema */
export async function initClickHouse(): Promise<void> {
  const ch = getClickHouse();

  await ch.command({
    query: `
      CREATE DATABASE IF NOT EXISTS panopticon
    `,
  });

  await ch.command({
    query: `
      CREATE TABLE IF NOT EXISTS panopticon.spans (
        trace_id        String,
        span_id         String,
        parent_span_id  String DEFAULT '',
        project_id      String,
        agent_id        String,
        span_type       Enum8(
          'agent_step' = 1,
          'llm_call' = 2,
          'mcp_request' = 3,
          'tool_call' = 4,
          'resource_read' = 5
        ),
        name            String,
        status          Enum8('ok' = 1, 'error' = 2, 'timeout' = 3),
        start_time      DateTime64(3),
        end_time        DateTime64(3) DEFAULT '1970-01-01 00:00:00.000',
        duration_ms     UInt32 DEFAULT 0,
        input           String DEFAULT '',
        output          String DEFAULT '',
        metadata        String DEFAULT '{}',
        security_flags  Array(String) DEFAULT []
      )
      ENGINE = MergeTree()
      PARTITION BY toYYYYMM(start_time)
      ORDER BY (project_id, trace_id, start_time, span_id)
      TTL toDateTime(start_time) + INTERVAL 30 DAY
    `,
  });

  await ch.command({
    query: `
      CREATE TABLE IF NOT EXISTS panopticon.audit_log (
        id            String,
        project_id    String,
        event_type    String,
        actor          String DEFAULT '',
        target_type   String DEFAULT '',
        target_id     String DEFAULT '',
        details       String DEFAULT '{}',
        timestamp     DateTime64(3) DEFAULT now64(3)
      )
      ENGINE = MergeTree()
      PARTITION BY toYYYYMM(timestamp)
      ORDER BY (project_id, timestamp, id)
      TTL toDateTime(timestamp) + INTERVAL 365 DAY
    `,
  });

  await ch.command({
    query: `
      CREATE TABLE IF NOT EXISTS panopticon.trace_analysis (
        trace_id        String,
        project_id      String,
        summary         String DEFAULT '',
        root_cause      String DEFAULT '',
        impact          String DEFAULT '',
        recommendation  String DEFAULT '',
        severity        String DEFAULT 'info',
        model           String DEFAULT '',
        created_at      DateTime64(3) DEFAULT now64(3)
      )
      ENGINE = ReplacingMergeTree(created_at)
      ORDER BY (project_id, trace_id)
      TTL toDateTime(created_at) + INTERVAL 30 DAY
    `,
  });

  console.log('✅ ClickHouse schema initialized');
}

/** Close the ClickHouse client */
export async function closeClickHouse(): Promise<void> {
  if (client) {
    await client.close();
    client = null;
  }
}

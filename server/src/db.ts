import { Pool, type PoolClient } from "pg";
import type { Config } from "./config.js";

let db: Pool | null = null;

function resolveSsl(config: Config): { rejectUnauthorized: boolean } | undefined {
  if (config.DATABASE_SSL === false) return undefined;
  if (config.DATABASE_SSL === true || config.NODE_ENV === "production") {
    return {
      rejectUnauthorized: config.DATABASE_SSL_REJECT_UNAUTHORIZED ?? false,
    };
  }
  return undefined;
}

function hasDiscretePgConfig(config: Config): boolean {
  return Boolean(config.PGHOST && config.PGPORT && config.PGDATABASE && config.PGUSER);
}

function normalizeConnectionString(raw: string): string {
  try {
    const url = new URL(raw);
    // Prefer explicit ssl settings from env/config over sslmode query semantics in the URL.
    url.searchParams.delete("sslmode");
    url.searchParams.delete("uselibpqcompat");
    url.searchParams.delete("sslcert");
    url.searchParams.delete("sslkey");
    url.searchParams.delete("sslrootcert");
    url.searchParams.delete("sslcrl");
    return url.toString();
  } catch {
    return raw;
  }
}

async function initSchema(client: PoolClient) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      created_at BIGINT NOT NULL
    );

    ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS free_calls_used BIGINT NOT NULL DEFAULT 0;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS free_calls_limit BIGINT NOT NULL DEFAULT 25;

    -- One-time data cleanup before constraints are enforced.
    UPDATE users
    SET role = CASE
      WHEN role IN ('user', 'admin') THEN role
      ELSE 'user'
    END;

    UPDATE users
    SET free_calls_used = GREATEST(COALESCE(free_calls_used, 0), 0),
        free_calls_limit = GREATEST(COALESCE(free_calls_limit, 25), 0);

    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_users_role'
      ) THEN
        ALTER TABLE users
          ADD CONSTRAINT chk_users_role CHECK (role IN ('user', 'admin'));
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_users_free_calls_used_nonnegative'
      ) THEN
        ALTER TABLE users
          ADD CONSTRAINT chk_users_free_calls_used_nonnegative CHECK (free_calls_used >= 0);
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_users_free_calls_limit_nonnegative'
      ) THEN
        ALTER TABLE users
          ADD CONSTRAINT chk_users_free_calls_limit_nonnegative CHECK (free_calls_limit >= 0);
      END IF;
    END $$;

    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_lower ON users (LOWER(email));

    CREATE TABLE IF NOT EXISTS interviews (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      resume TEXT NOT NULL,
      job_description TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('active', 'completed')),
      outcome_summary TEXT,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      interview_id TEXT NOT NULL REFERENCES interviews(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK (role IN ('system', 'user', 'assistant')),
      content TEXT NOT NULL,
      created_at BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS call_sessions (
      call_sid TEXT PRIMARY KEY,
      interview_id TEXT NOT NULL REFERENCES interviews(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      from_number TEXT,
      to_number TEXT,
      call_status TEXT NOT NULL,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS usage_events (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      interview_id TEXT REFERENCES interviews(id) ON DELETE SET NULL,
      event_type TEXT NOT NULL,
      billable_units INTEGER NOT NULL DEFAULT 1,
      included_in_quota BOOLEAN NOT NULL DEFAULT true,
      created_at BIGINT NOT NULL
    );

    -- One-time data cleanup before constraints are enforced.
    UPDATE usage_events
    SET event_type = CASE
      WHEN event_type IN ('session_start', 'message_turn', 'session_complete') THEN event_type
      ELSE 'message_turn'
    END,
    billable_units = GREATEST(COALESCE(billable_units, 1), 1),
    included_in_quota = COALESCE(included_in_quota, true),
    created_at = COALESCE(created_at, 0);

    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_usage_events_event_type'
      ) THEN
        ALTER TABLE usage_events
          ADD CONSTRAINT chk_usage_events_event_type
          CHECK (event_type IN ('session_start', 'message_turn', 'session_complete'));
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_usage_events_billable_units_positive'
      ) THEN
        ALTER TABLE usage_events
          ADD CONSTRAINT chk_usage_events_billable_units_positive CHECK (billable_units > 0);
      END IF;
    END $$;

    CREATE INDEX IF NOT EXISTS idx_interviews_user ON interviews(user_id);
    CREATE INDEX IF NOT EXISTS idx_interviews_user_updated ON interviews(user_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_messages_interview ON messages(interview_id);
    CREATE INDEX IF NOT EXISTS idx_messages_interview_created_at ON messages(interview_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_call_sessions_interview ON call_sessions(interview_id);
    CREATE INDEX IF NOT EXISTS idx_usage_events_user ON usage_events(user_id);
    CREATE INDEX IF NOT EXISTS idx_usage_events_created_at ON usage_events(created_at);
    CREATE INDEX IF NOT EXISTS idx_usage_events_user_created_at ON usage_events(user_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_usage_events_in_quota_created_at ON usage_events(created_at)
      WHERE included_in_quota = true;
  `);
}

export async function getDb(config: Config): Promise<Pool> {
  if (db) return db;

  if (!config.DATABASE_URL && !hasDiscretePgConfig(config)) {
    throw new Error(
      "Set DATABASE_URL or PGHOST/PGPORT/PGDATABASE/PGUSER/PGPASSWORD to connect to PostgreSQL."
    );
  }

  if (config.DATABASE_URL) {
    const raw = config.DATABASE_URL;
    if (raw.includes("show-password")) {
      throw new Error(
        "DATABASE_URL still contains the 'show-password' placeholder. Use the real database password from DigitalOcean."
      );
    }
  }

  const commonPoolOptions = {
    ssl: resolveSsl(config),
    max: config.DATABASE_POOL_MAX,
    idleTimeoutMillis: config.DATABASE_IDLE_TIMEOUT_MS,
    connectionTimeoutMillis: config.DATABASE_CONNECTION_TIMEOUT_MS,
  };

  const normalizedConnectionString = config.DATABASE_URL
    ? normalizeConnectionString(config.DATABASE_URL)
    : undefined;

  const instance = normalizedConnectionString
    ? new Pool({
        connectionString: normalizedConnectionString,
        ...commonPoolOptions,
      })
    : new Pool({
        host: config.PGHOST,
        port: config.PGPORT,
        database: config.PGDATABASE,
        user: config.PGUSER,
        password: config.PGPASSWORD,
        ...commonPoolOptions,
      });

  const client = await instance.connect();
  try {
    await initSchema(client);
  } finally {
    client.release();
  }

  db = instance;
  return instance;
}

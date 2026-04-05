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

    CREATE INDEX IF NOT EXISTS idx_interviews_user ON interviews(user_id);
    CREATE INDEX IF NOT EXISTS idx_messages_interview ON messages(interview_id);
    CREATE INDEX IF NOT EXISTS idx_call_sessions_interview ON call_sessions(interview_id);
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

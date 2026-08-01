/**
 * Database client.
 *
 * Two modes, selected purely by whether DATABASE_URL is set:
 *
 *  - DATABASE_URL unset  -> embedded PGlite (a real, WASM-compiled Postgres
 *    engine, not a mock). Used for local development and the test suite, so
 *    every code path — including the daterange exclusion constraint that
 *    prevents double-booking — runs against genuine Postgres semantics with
 *    zero external setup.
 *  - DATABASE_URL set    -> a normal Postgres connection via `pg`, exactly
 *    as it would run against Supabase/production. Nothing in application
 *    code changes between the two; only this file differs.
 */
import { drizzle as drizzlePg, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { drizzle as drizzlePglite, type PgliteDatabase } from "drizzle-orm/pglite";
import { Pool } from "pg";
import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import * as schema from "./schema";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

type Db = NodePgDatabase<typeof schema> | PgliteDatabase<typeof schema>;

let dbInstance: Db | null = null;
let migrated = false;

function runInitialMigrationSql(): string {
  return readFileSync(join(__dirname, "migrations", "0001_init.sql"), "utf-8");
}

async function migrateEmbedded(client: PGlite) {
  if (migrated) return;
  const sql = runInitialMigrationSql();
  await client.exec(sql);
  migrated = true;
}

/** Create a fresh, isolated embedded database — used by the test suite so
 * each test gets its own clean instance rather than sharing state. Returns
 * the raw PGlite client alongside the Drizzle wrapper so callers can
 * `close()` it in an afterEach — each instance holds real WASM linear
 * memory that is not reclaimed until closed, and a large test suite that
 * never closes any of them will exhaust the worker process. */
export async function createTestDb(): Promise<{
  db: PgliteDatabase<typeof schema>;
  client: PGlite;
}> {
  const client = new PGlite({ extensions: { btree_gist } });
  await client.exec(runInitialMigrationSql());
  return { db: drizzlePglite(client, { schema }), client };
}

export async function getDb(): Promise<Db> {
  if (dbInstance) return dbInstance;

  const url = process.env.DATABASE_URL;
  if (url) {
    const pool = new Pool({ connectionString: url });
    dbInstance = drizzlePg(pool, { schema });
    return dbInstance;
  }

  // File-backed, not in-memory: without this, every `npm run dev` restart
  // (and every separate `npm run seed` invocation, which is its own
  // process) would start from an empty database. createTestDb() above is
  // deliberately the in-memory variant — tests want a guaranteed-clean
  // slate every time, not this persistence.
  const dataDir = process.env.PGLITE_DATA_DIR ?? join(__dirname, "..", ".pglite-data");
  const client = new PGlite(dataDir, { extensions: { btree_gist } });
  await migrateEmbedded(client);
  dbInstance = drizzlePglite(client, { schema });
  return dbInstance;
}

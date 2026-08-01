/**
 * Migration runner for a real Postgres target (e.g. Supabase), invoked via
 * `npm run migrate` with DATABASE_URL set. Applies every .sql file in
 * db/migrations in filename order, tracked in a schema_migrations table so
 * re-running is a no-op once a migration has been applied — matching the
 * migration strategy described in the implementation plan (section 3.5).
 */
import { Pool } from "pg";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set. Nothing to migrate against.");
    process.exit(1);
  }

  const pool = new Pool({ connectionString: url });
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    );
  `);

  const dir = join(__dirname, "migrations");
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();

  for (const file of files) {
    const { rows } = await pool.query(
      "SELECT 1 FROM schema_migrations WHERE filename = $1",
      [file]
    );
    if (rows.length > 0) {
      console.log(`skip  ${file} (already applied)`);
      continue;
    }
    const sql = readFileSync(join(dir, file), "utf-8");
    console.log(`apply ${file}`);
    await pool.query("BEGIN");
    try {
      await pool.query(sql);
      await pool.query("INSERT INTO schema_migrations (filename) VALUES ($1)", [file]);
      await pool.query("COMMIT");
    } catch (err) {
      await pool.query("ROLLBACK");
      console.error(`Migration ${file} failed:`, err);
      process.exit(1);
    }
  }

  console.log("Migrations complete.");
  await pool.end();
}

main();

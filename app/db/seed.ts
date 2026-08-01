/**
 * Seeds a first login so the app is usable immediately after checkout.
 * Run with `npm run seed`. Uses DATABASE_URL if set (real Postgres),
 * otherwise seeds the embedded PGlite store used by `npm run dev`.
 */
import { getDb } from "./client";
import { createUser } from "../lib/services/authService";
import { eq } from "drizzle-orm";
import { appUser } from "./schema";

async function main() {
  const db = await getDb();

  const existing = await db.select().from(appUser).where(eq(appUser.email, "owner@example.com"));
  if (existing.length > 0) {
    console.log("Demo owner account already exists (owner@example.com). Nothing to do.");
    return;
  }

  await createUser(db, {
    email: "owner@example.com",
    name: "Demo Owner",
    password: "changeme123",
    role: "owner",
  });

  console.log("Seeded demo account:");
  console.log("  email:    owner@example.com");
  console.log("  password: changeme123");
  console.log("Log in and change this before using the system for real.");
}

main().then(() => process.exit(0)).catch((err) => {
  console.error(err);
  process.exit(1);
});

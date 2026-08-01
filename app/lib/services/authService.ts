import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import type { AppDb } from "./types";
import { appUser } from "../../db/schema";
import type { Role } from "../authz";

/**
 * Minimal credentials-based auth used for local dev/test in this
 * environment. The implementation plan specifies Supabase Auth in
 * production (section 2.1) — swap this module for Supabase's session
 * helpers at deploy time; the rest of the app depends only on the
 * `CurrentUser { id, role }` shape, not on how it was obtained, so the
 * swap does not touch service or page code.
 */

export async function createUser(db: AppDb, input: { email: string; name: string; password: string; role: Role }) {
  const passwordHash = await bcrypt.hash(input.password, 10);
  const [created] = await db.insert(appUser).values({
    email: input.email.toLowerCase(),
    name: input.name,
    passwordHash,
    role: input.role,
  }).returning();
  return created;
}

export async function verifyLogin(db: AppDb, email: string, password: string) {
  const [user] = await db.select().from(appUser).where(eq(appUser.email, email.toLowerCase()));
  if (!user || !user.active) return null;
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return null;
  return { id: user.id, role: user.role as Role, name: user.name, email: user.email };
}

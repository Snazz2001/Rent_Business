import { eq } from "drizzle-orm";
import { createTestDb } from "../../db/client";
import type { CurrentUser, Role } from "../authz";
import { property, owner, guest, appUser } from "../../db/schema";
import type { PGlite } from "@electric-sql/pglite";

const activeClients: PGlite[] = [];

/** Each call spins up a genuine, isolated embedded Postgres instance
 * (PGlite) with the full migration applied — not a mock. The instance is
 * tracked and closed automatically after the current test (see
 * lib/__tests__/setup.ts) so a large suite doesn't accumulate WASM
 * instances and exhaust the worker process. */
export async function freshDb() {
  const { db, client } = await createTestDb();
  activeClients.push(client);
  return db;
}

/** Closes every PGlite instance created via freshDb() since the last call.
 * Invoked from a global afterEach in setup.ts. */
export async function closeAllTestClients() {
  while (activeClients.length > 0) {
    const client = activeClients.pop()!;
    await client.close();
  }
}

type Db = Awaited<ReturnType<typeof createTestDb>>["db"];

function roleDigit(role: Role): number {
  const order: Role[] = ["owner", "manager", "finance", "housekeeping", "maintenance", "readonly"];
  return order.indexOf(role) + 1;
}

/** Creates (or reuses) a real app_user row for the given role and returns
 * it as a CurrentUser. Several tables (document.uploaded_by,
 * booking.compliance_override_by) have a real foreign key to app_user, so
 * tests need a genuine row to reference — this is intentional: it proves
 * the FK integrity that protects the audit trail actually holds, rather
 * than testing against IDs that only work because nothing checks them. */
export async function userWithRole(db: Db, role: Role): Promise<CurrentUser> {
  const id = `00000000-0000-0000-0000-00000000000${roleDigit(role)}`;
  const existing = await db.select().from(appUser).where(eq(appUser.id, id));
  if (existing.length === 0) {
    await db.insert(appUser).values({
      id,
      email: `${role}@test.local`,
      name: `Test ${role}`,
      passwordHash: "x",
      role,
    });
  }
  return { id, role };
}

export async function seedOwner(db: Db) {
  const [o] = await db.insert(owner).values({ name: "Test Owner", email: "owner@example.com" }).returning();
  return o;
}

export async function seedProperty(db: Db, overrides: Partial<{
  referenceCode: string; name: string; bedrooms: number; bathrooms: number; maxOccupancy: number;
}> = {}) {
  const [p] = await db.insert(property).values({
    referenceCode: overrides.referenceCode ?? `P-${Math.random().toString(36).slice(2, 8)}`,
    name: overrides.name ?? "Marina Loft",
    bedrooms: overrides.bedrooms ?? 2,
    bathrooms: overrides.bathrooms ?? 2,
    maxOccupancy: overrides.maxOccupancy ?? 4,
  }).returning();
  return p;
}

export async function seedGuest(db: Db, overrides: Partial<{ fullName: string; mobile: string; blocked: boolean }> = {}) {
  const [g] = await db.insert(guest).values({
    fullName: overrides.fullName ?? "Jane Traveller",
    mobile: overrides.mobile ?? "+971500000000",
    blocked: overrides.blocked ?? false,
  }).returning();
  return g;
}

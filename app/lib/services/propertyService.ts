import { eq } from "drizzle-orm";
import type { AppDb } from "./types";
import { property, owner, booking } from "../../db/schema";
import { propertyInputSchema, type PropertyInput } from "../validation";
import { assertCan, type CurrentUser } from "../authz";
import { writeAudit } from "./auditService";

export class ValidationError extends Error {
  issues: string[];
  constructor(issues: string[]) {
    super(issues.join("; "));
    this.name = "ValidationError";
    this.issues = issues;
  }
}

function parseOrThrow(input: unknown) {
  const result = propertyInputSchema.safeParse(input);
  if (!result.success) {
    throw new ValidationError(result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`));
  }
  return result.data;
}

export async function createProperty(db: AppDb, user: CurrentUser, input: PropertyInput) {
  assertCan(user.role, "property:write");
  const data = parseOrThrow(input);

  if (data.ownerId) {
    const existingOwner = await db.select().from(owner).where(eq(owner.id, data.ownerId));
    if (existingOwner.length === 0) {
      throw new ValidationError(["ownerId: referenced owner does not exist"]);
    }
  }

  const [created] = await db.insert(property).values({
    referenceCode: data.referenceCode,
    name: data.name,
    unitNumber: data.unitNumber,
    building: data.building,
    community: data.community,
    area: data.area,
    emirate: data.emirate,
    bedrooms: data.bedrooms,
    bathrooms: data.bathrooms,
    maxOccupancy: data.maxOccupancy,
    sizeSqft: data.sizeSqft?.toString(),
    floor: data.floor,
    view: data.view,
    furnishingStatus: data.furnishingStatus,
    classification: data.classification,
    status: data.status,
    ownerId: data.ownerId,
    doorAccessNote: data.doorAccessNote,
    wifiNetwork: data.wifiNetwork,
    wifiPassword: data.wifiPassword,
    amenities: data.amenities,
  }).returning();

  await writeAudit(db, user, "create", "property", created.id, null, created);
  return created;
}

/** DB rows use `null` for "not set"; the input schema's optional fields
 * accept `undefined` but not `null`. Converts before re-validating a
 * merged (existing + partial update) record. */
function nullToUndefined<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) out[k] = v === null ? undefined : v;
  return out as T;
}

export async function updateProperty(db: AppDb, user: CurrentUser, id: string, input: Partial<PropertyInput>) {
  assertCan(user.role, "property:write");
  const [existing] = await db.select().from(property).where(eq(property.id, id));
  if (!existing) throw new ValidationError(["id: property not found"]);

  const existingClean = nullToUndefined({
    ...existing,
    sizeSqft: existing.sizeSqft ? Number(existing.sizeSqft) : undefined,
    amenities: existing.amenities as string[],
  });
  const merged = parseOrThrow({ ...existingClean, ...input });

  const [updated] = await db.update(property).set({
    referenceCode: merged.referenceCode,
    name: merged.name,
    unitNumber: merged.unitNumber,
    building: merged.building,
    community: merged.community,
    area: merged.area,
    emirate: merged.emirate,
    bedrooms: merged.bedrooms,
    bathrooms: merged.bathrooms,
    maxOccupancy: merged.maxOccupancy,
    sizeSqft: merged.sizeSqft?.toString(),
    floor: merged.floor,
    view: merged.view,
    furnishingStatus: merged.furnishingStatus,
    classification: merged.classification,
    status: merged.status,
    ownerId: merged.ownerId,
    doorAccessNote: merged.doorAccessNote,
    wifiNetwork: merged.wifiNetwork,
    wifiPassword: merged.wifiPassword,
    amenities: merged.amenities,
    updatedAt: new Date(),
  }).where(eq(property.id, id)).returning();

  await writeAudit(db, user, "update", "property", id, existing, updated);
  return updated;
}

/**
 * Hard-deletes a property. Deliberately restricted to the owner role
 * (property:delete, separate from property:write) since it's the one
 * destructive, hard-to-undo action in the property module.
 *
 * Blocks deletion if any booking — including past/cancelled ones — still
 * references the property: booking history is the guest-facing and
 * financial record of a stay and must never silently disappear because a
 * property was deleted. The database's own foreign key (booking.property_id
 * has no ON DELETE clause, i.e. RESTRICT) would reject this at the SQL
 * layer regardless, but checking here first gives a clear, actionable error
 * instead of a raw constraint-violation message. Property-scoped records
 * that are administrative rather than historical — photos, utility
 * accounts, documents, compliance tasks — cascade-delete automatically via
 * their own ON DELETE CASCADE foreign keys.
 */
export async function deleteProperty(db: AppDb, user: CurrentUser, id: string) {
  assertCan(user.role, "property:delete");
  const [existing] = await db.select().from(property).where(eq(property.id, id));
  if (!existing) throw new ValidationError(["id: property not found"]);

  const bookings = await db.select({ id: booking.id }).from(booking).where(eq(booking.propertyId, id));
  if (bookings.length > 0) {
    throw new ValidationError([
      `Cannot delete this property — it has ${bookings.length} booking${bookings.length === 1 ? "" : "s"} on record. ` +
      `Set its status to "inactive" instead if it's no longer being let.`,
    ]);
  }

  await db.delete(property).where(eq(property.id, id));
  await writeAudit(db, user, "delete", "property", id, existing, null);
}

export async function listProperties(db: AppDb, user: CurrentUser) {
  assertCan(user.role, "property:read");
  return db.select().from(property).orderBy(property.name);
}

export async function getProperty(db: AppDb, user: CurrentUser, id: string) {
  assertCan(user.role, "property:read");
  const [row] = await db.select().from(property).where(eq(property.id, id));
  return row ?? null;
}

import { eq, or, ilike } from "drizzle-orm";
import type { AppDb } from "./types";
import { guest, booking, property } from "../../db/schema";
import { guestInputSchema, type GuestInput } from "../validation";
import { assertCan, type CurrentUser } from "../authz";
import { writeAudit } from "./auditService";
import { ValidationError } from "./propertyService";

function parseOrThrow(input: unknown) {
  const result = guestInputSchema.safeParse(input);
  if (!result.success) {
    throw new ValidationError(result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`));
  }
  return result.data;
}

export async function createGuest(db: AppDb, user: CurrentUser, input: GuestInput, consentVersion?: string) {
  assertCan(user.role, "guest:write");
  const data = parseOrThrow(input);

  const [created] = await db.insert(guest).values({
    fullName: data.fullName,
    nationality: data.nationality,
    dob: data.dob,
    gender: data.gender,
    documentType: data.documentType,
    documentNumber: data.documentNumber,
    documentIssuingCountry: data.documentIssuingCountry,
    documentExpiry: data.documentExpiry,
    documentFileUrl: data.documentFileUrl || null,
    mobile: data.mobile,
    email: data.email || null,
    whatsapp: data.whatsapp,
    address: data.address,
    notes: data.notes,
    consentGivenAt: consentVersion ? new Date() : undefined,
    consentVersion: consentVersion,
  }).returning();

  await writeAudit(db, user, "create", "guest", created.id, null, { ...created, documentFileUrl: "[redacted in audit log]" });
  return created;
}

/**
 * Lists guests, optionally filtered by a free-text search across name,
 * mobile, and email — the lookup a front-desk user needs when a returning
 * guest calls to rebook and gives their phone number or name rather than
 * their internal guest ID. Matching is case-insensitive and substring-based
 * (ILIKE '%query%'), so a partial number or name still finds them.
 *
 * The ID-document number is only searchable by roles with identity-read
 * access — otherwise a role that can't normally see document numbers could
 * still confirm one exists by trying it in the search box.
 */
export async function listGuests(db: AppDb, user: CurrentUser, query?: string) {
  assertCan(user.role, "guest:read");
  const q = query?.trim();

  let rows;
  if (q) {
    const pattern = `%${q}%`;
    const conditions = [ilike(guest.fullName, pattern), ilike(guest.mobile, pattern), ilike(guest.email, pattern)];
    if (can_read_identity(user)) conditions.push(ilike(guest.documentNumber, pattern));
    rows = await db.select().from(guest).where(or(...conditions)).orderBy(guest.fullName);
  } else {
    rows = await db.select().from(guest).orderBy(guest.fullName);
  }

  // Identity document fields are stripped unless the caller has explicit
  // identity-read permission — mirrors the RLS policy this maps to in
  // production (plan section 3.3: housekeeping/maintenance never see IDs).
  if (can_read_identity(user)) return rows;
  return rows.map(stripIdentity);
}

export async function getGuest(db: AppDb, user: CurrentUser, id: string) {
  assertCan(user.role, "guest:read");
  const [row] = await db.select().from(guest).where(eq(guest.id, id));
  if (!row) return null;
  return can_read_identity(user) ? row : stripIdentity(row);
}

function can_read_identity(user: CurrentUser): boolean {
  try {
    assertCan(user.role, "guest:read_identity");
    return true;
  } catch {
    return false;
  }
}

function stripIdentity<T extends { documentNumber: string | null; documentFileUrl: string | null; documentIssuingCountry: string | null }>(g: T): T {
  return { ...g, documentNumber: null, documentFileUrl: null, documentIssuingCountry: null };
}

export async function guestBookingHistory(db: AppDb, user: CurrentUser, guestId: string) {
  assertCan(user.role, "guest:read");
  const rows = await db
    .select({
      id: booking.id,
      bookingNumber: booking.bookingNumber,
      checkIn: booking.checkIn,
      checkOut: booking.checkOut,
      status: booking.status,
      propertyReferenceCode: property.referenceCode,
      propertyName: property.name,
    })
    .from(booking)
    .leftJoin(property, eq(booking.propertyId, property.id))
    .where(eq(booking.leadGuestId, guestId))
    .orderBy(booking.checkIn);
  return rows;
}

import { and, eq, ne, gt, lt, inArray, sql } from "drizzle-orm";
import type { AppDb } from "./types";
import { booking, bookingOccupant, property, guest, complianceTask } from "../../db/schema";
import { bookingInputSchema, type BookingInput } from "../validation";
import { assertCan, type CurrentUser } from "../authz";
import { writeAudit } from "./auditService";
import { ValidationError } from "./propertyService";
import { propertyComplianceStatus, permitBlocksBooking } from "./documentService";

export class BookingOverlapError extends Error {
  constructor() {
    super("These dates are no longer available for this property — another confirmed booking overlaps them.");
    this.name = "BookingOverlapError";
  }
}

export class ComplianceBlockedError extends Error {
  constructor(reason: string) {
    super(`Booking blocked by compliance status: ${reason}. Provide an override reason to proceed anyway.`);
    this.name = "ComplianceBlockedError";
  }
}

export class InvalidTransitionError extends Error {
  constructor(from: string, to: string) {
    super(`Cannot move a booking from "${from}" to "${to}"`);
    this.name = "InvalidTransitionError";
  }
}

export type BookingStatus =
  | "enquiry" | "tentative" | "confirmed" | "checked_in" | "checked_out" | "cancelled" | "no_show";

/** Statuses that occupy the calendar and are covered by the database
 * exclusion constraint (see db/migrations/0001_init.sql). Kept in sync
 * with the WHERE clause of that constraint. */
const OCCUPYING_STATUSES = ["confirmed", "checked_in"] as const;

const ALLOWED_TRANSITIONS: Record<BookingStatus, BookingStatus[]> = {
  enquiry: ["tentative", "confirmed", "cancelled"],
  tentative: ["confirmed", "cancelled"],
  confirmed: ["checked_in", "cancelled", "no_show"],
  checked_in: ["checked_out"],
  checked_out: [],
  cancelled: [],
  no_show: [],
};

function isExclusionViolation(err: unknown): boolean {
  const e = err as { code?: string; message?: string };
  return e?.code === "23P01" || /exclusion constraint/i.test(e?.message ?? "");
}

function generateBookingNumber(): string {
  const stamp = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `BK-${stamp}-${rand}`;
}

function parseOrThrow(input: unknown) {
  const result = bookingInputSchema.safeParse(input);
  if (!result.success) {
    throw new ValidationError(result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`));
  }
  return result.data;
}

/** Friendly pre-check for a nicer error message; the database exclusion
 * constraint is the actual source of truth and is re-checked on write, so
 * this cannot be bypassed by a race between two concurrent requests. */
async function hasOverlap(db: AppDb, propertyId: string, checkIn: string, checkOut: string, excludeBookingId?: string) {
  const rows = await db.select({ id: booking.id }).from(booking).where(
    and(
      eq(booking.propertyId, propertyId),
      inArray(booking.status, [...OCCUPYING_STATUSES]),
      lt(booking.checkIn, checkOut),
      gt(booking.checkOut, checkIn),
      excludeBookingId ? ne(booking.id, excludeBookingId) : sql`true`
    )
  );
  return rows.length > 0;
}

export async function createBooking(db: AppDb, user: CurrentUser, input: BookingInput) {
  assertCan(user.role, "booking:write");
  const data = parseOrThrow(input);

  const [prop] = await db.select().from(property).where(eq(property.id, data.propertyId));
  if (!prop) throw new ValidationError(["propertyId: property not found"]);

  const [leadGuest] = await db.select().from(guest).where(eq(guest.id, data.leadGuestId));
  if (!leadGuest) throw new ValidationError(["leadGuestId: guest not found"]);
  if (leadGuest.blocked) throw new ValidationError(["leadGuestId: this guest is blocked and cannot be booked"]);

  const totalGuests = data.adults + data.children;
  if (totalGuests > prop.maxOccupancy) {
    throw new ValidationError([`party size: ${totalGuests} guests exceeds this property's maximum occupancy of ${prop.maxOccupancy}`]);
  }
  if (data.occupiedBedrooms > prop.bedrooms && prop.bedrooms > 0) {
    throw new ValidationError([`occupiedBedrooms: cannot exceed the property's ${prop.bedrooms} bedrooms`]);
  }

  const [created] = await db.insert(booking).values({
    bookingNumber: generateBookingNumber(),
    propertyId: data.propertyId,
    leadGuestId: data.leadGuestId,
    sourceChannel: data.sourceChannel,
    checkIn: data.checkIn,
    checkOut: data.checkOut,
    adults: data.adults,
    children: data.children,
    infants: data.infants,
    occupiedBedrooms: data.occupiedBedrooms,
    status: "enquiry",
    notes: data.notes,
  }).returning();

  await db.insert(bookingOccupant).values({ bookingId: created.id, guestId: data.leadGuestId, isLead: true });
  for (const gId of data.additionalGuestIds) {
    await db.insert(bookingOccupant).values({ bookingId: created.id, guestId: gId, isLead: false });
  }

  await writeAudit(db, user, "create", "booking", created.id, null, created);
  return created;
}

export interface ConfirmOptions {
  override?: boolean;
  overrideReason?: string;
  /** Hours after check-in the DET guest-registration task falls due.
   * Spec section 3.1 flags published guidance as inconsistent (3h vs 24h)
   * — configurable rather than hard-coded, per section 3.2's design
   * consequence and the plan's decision #4. */
  guestRegistrationDeadlineHours?: number;
}

export async function confirmBooking(db: AppDb, user: CurrentUser, bookingId: string, opts: ConfirmOptions = {}) {
  assertCan(user.role, "booking:confirm");
  const [existing] = await db.select().from(booking).where(eq(booking.id, bookingId));
  if (!existing) throw new ValidationError(["id: booking not found"]);
  assertTransition(existing.status, "confirmed");

  const compliance = await propertyComplianceStatus(db, user, existing.propertyId);
  if (permitBlocksBooking(compliance.permitStatus)) {
    if (!opts.override) {
      throw new ComplianceBlockedError(`property permit is ${compliance.permitStatus}`);
    }
    assertCan(user.role, "booking:override_compliance");
    if (!opts.overrideReason) {
      throw new ValidationError(["overrideReason: required when overriding a compliance block"]);
    }
  }

  if (await hasOverlap(db, existing.propertyId, existing.checkIn, existing.checkOut, existing.id)) {
    throw new BookingOverlapError();
  }

  let updated;
  try {
    [updated] = await db.update(booking).set({
      status: "confirmed",
      complianceOverrideBy: opts.override ? user.id : null,
      complianceOverrideReason: opts.override ? opts.overrideReason : null,
      updatedAt: new Date(),
    }).where(eq(booking.id, bookingId)).returning();
  } catch (err) {
    if (isExclusionViolation(err)) throw new BookingOverlapError();
    throw err;
  }

  await writeAudit(db, user, "confirm", "booking", bookingId, existing, updated);

  // Spec section 3.2: every confirmed booking automatically creates a
  // guest-registration compliance task with a hard deadline.
  const deadlineHours = opts.guestRegistrationDeadlineHours ?? 3;
  const dueAt = new Date(new Date(existing.checkIn).getTime() + deadlineHours * 60 * 60 * 1000);
  const [task] = await db.insert(complianceTask).values({
    type: "guest_registration",
    bookingId: bookingId,
    propertyId: existing.propertyId,
    dueAt,
    status: "pending",
  }).returning();

  return { booking: updated, complianceTask: task };
}

function assertTransition(from: BookingStatus, to: BookingStatus) {
  const allowed = ALLOWED_TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) throw new InvalidTransitionError(from, to);
}

export async function updateBookingStatus(db: AppDb, user: CurrentUser, bookingId: string, newStatus: BookingStatus) {
  assertCan(user.role, "booking:write");
  const [existing] = await db.select().from(booking).where(eq(booking.id, bookingId));
  if (!existing) throw new ValidationError(["id: booking not found"]);
  assertTransition(existing.status, newStatus);

  if (OCCUPYING_STATUSES.includes(newStatus as (typeof OCCUPYING_STATUSES)[number])) {
    if (await hasOverlap(db, existing.propertyId, existing.checkIn, existing.checkOut, existing.id)) {
      throw new BookingOverlapError();
    }
  }

  let updated;
  try {
    [updated] = await db.update(booking).set({ status: newStatus, updatedAt: new Date() }).where(eq(booking.id, bookingId)).returning();
  } catch (err) {
    if (isExclusionViolation(err)) throw new BookingOverlapError();
    throw err;
  }
  await writeAudit(db, user, `status:${newStatus}`, "booking", bookingId, existing, updated);
  return updated;
}

/** Releases tentative holds past their expiry window (spec 4.4's booking
 * rules: "tentative holds expire automatically and release the dates").
 * Intended to run on a schedule (plan section 2.1, Vercel Cron/Inngest);
 * exposed as a plain function here so it is directly unit-testable. */
export async function releaseExpiredHolds(db: AppDb, now: Date = new Date()) {
  const expired = await db.select().from(booking).where(
    and(eq(booking.status, "tentative"), lt(booking.holdExpiresAt, now))
  );
  for (const b of expired) {
    await db.update(booking).set({
      status: "cancelled",
      notes: [b.notes, "Auto-cancelled: tentative hold expired."].filter(Boolean).join(" "),
      updatedAt: new Date(),
    }).where(eq(booking.id, b.id));
  }
  return expired.map((b) => b.id);
}

export async function listBookingsForProperty(db: AppDb, user: CurrentUser, propertyId: string) {
  assertCan(user.role, "booking:read");
  return db.select().from(booking).where(eq(booking.propertyId, propertyId));
}

export async function listAllBookings(db: AppDb, user: CurrentUser) {
  assertCan(user.role, "booking:read");
  return db.select().from(booking);
}

function icsEscape(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

function toIcsDate(isoDate: string): string {
  return isoDate.replace(/-/g, "");
}

/** Read-only iCal feed per property (spec 4.4 / plan P1-25), for a channel
 * such as Airbnb to import and treat as blocked dates. Guest names are
 * deliberately omitted from the feed — only the fact that the unit is
 * booked, matching common channel-manager privacy practice. */
export function bookingsToIcs(propertyRef: string, bookings: Array<{ id: string; checkIn: string; checkOut: string; status: string }>): string {
  const occupying = bookings.filter((b) => (OCCUPYING_STATUSES as readonly string[]).includes(b.status));
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Holiday Rental System//Phase 1//EN",
    "CALSCALE:GREGORIAN",
  ];
  for (const b of occupying) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${b.id}@holiday-rental-system`,
      `DTSTART;VALUE=DATE:${toIcsDate(b.checkIn)}`,
      `DTEND;VALUE=DATE:${toIcsDate(b.checkOut)}`,
      `SUMMARY:${icsEscape(`Booked — ${propertyRef}`)}`,
      "END:VEVENT"
    );
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}

export async function icalExportForProperty(db: AppDb, user: CurrentUser, propertyId: string) {
  assertCan(user.role, "booking:read");
  const [prop] = await db.select().from(property).where(eq(property.id, propertyId));
  if (!prop) throw new ValidationError(["propertyId: property not found"]);
  const bookings = await db.select().from(booking).where(eq(booking.propertyId, propertyId));
  return bookingsToIcs(prop.referenceCode, bookings);
}

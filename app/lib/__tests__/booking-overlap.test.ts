import { describe, it, expect } from "vitest";
import { freshDb, userWithRole, seedProperty, seedGuest } from "./helpers";
import { createBooking, confirmBooking, updateBookingStatus, BookingOverlapError } from "../services/bookingService";
import { createDocument } from "../services/documentService";
import { toIsoDateLocal } from "../calendarGrid";

function daysFromNow(days: number): string {
  // Uses local calendar fields, not toISOString() (which converts through
  // UTC and would shift the date near midnight in Asia/Dubai, UTC+4).
  const d = new Date();
  d.setDate(d.getDate() + days);
  return toIsoDateLocal(d);
}

/** Every scenario below needs a property with a valid, far-future DET
 * permit so the compliance block (tested separately) never interferes —
 * these tests are purely about the overlap guarantee. */
async function givePermit(db: any, user: any, propertyId: string) {
  await createDocument(db, user, {
    type: "det_permit", ownerType: "property", propertyId, expiryDate: daysFromNow(300),
  } as any);
}

describe("booking overlap prevention — the core guarantee", () => {
  it("rejects a second confirmed booking that overlaps an existing confirmed booking on the same property", async () => {
    const db = await freshDb();
    const manager = await userWithRole(db, "manager");
    const p = await seedProperty(db);
    await givePermit(db, manager, p.id);
    const g1 = await seedGuest(db, { fullName: "Guest One" });
    const g2 = await seedGuest(db, { fullName: "Guest Two" });

    const b1 = await createBooking(db, manager, {
      propertyId: p.id, leadGuestId: g1.id, checkIn: "2026-08-01", checkOut: "2026-08-05",
      adults: 2, additionalGuestIds: [],
    } as any);
    await confirmBooking(db, manager, b1.id);

    const b2 = await createBooking(db, manager, {
      propertyId: p.id, leadGuestId: g2.id, checkIn: "2026-08-03", checkOut: "2026-08-07",
      adults: 2, additionalGuestIds: [],
    } as any);

    await expect(confirmBooking(db, manager, b2.id)).rejects.toBeInstanceOf(BookingOverlapError);
  });

  it("allows a back-to-back booking starting the day the previous one checks out", async () => {
    const db = await freshDb();
    const manager = await userWithRole(db, "manager");
    const p = await seedProperty(db);
    await givePermit(db, manager, p.id);
    const g1 = await seedGuest(db);
    const g2 = await seedGuest(db);

    const b1 = await createBooking(db, manager, {
      propertyId: p.id, leadGuestId: g1.id, checkIn: "2026-08-01", checkOut: "2026-08-05", additionalGuestIds: [],
    } as any);
    await confirmBooking(db, manager, b1.id);

    const b2 = await createBooking(db, manager, {
      propertyId: p.id, leadGuestId: g2.id, checkIn: "2026-08-05", checkOut: "2026-08-10", additionalGuestIds: [],
    } as any);
    const result = await confirmBooking(db, manager, b2.id);
    expect(result.booking.status).toBe("confirmed");
  });

  it("allows the same dates on a different property", async () => {
    const db = await freshDb();
    const manager = await userWithRole(db, "manager");
    const p1 = await seedProperty(db, { referenceCode: "P-A" });
    const p2 = await seedProperty(db, { referenceCode: "P-B" });
    await givePermit(db, manager, p1.id);
    await givePermit(db, manager, p2.id);
    const g1 = await seedGuest(db);
    const g2 = await seedGuest(db);

    const b1 = await createBooking(db, manager, {
      propertyId: p1.id, leadGuestId: g1.id, checkIn: "2026-08-01", checkOut: "2026-08-05", additionalGuestIds: [],
    } as any);
    await confirmBooking(db, manager, b1.id);

    const b2 = await createBooking(db, manager, {
      propertyId: p2.id, leadGuestId: g2.id, checkIn: "2026-08-01", checkOut: "2026-08-05", additionalGuestIds: [],
    } as any);
    const result = await confirmBooking(db, manager, b2.id);
    expect(result.booking.status).toBe("confirmed");
  });

  it("does not block on an overlapping tentative (unconfirmed) booking", async () => {
    const db = await freshDb();
    const manager = await userWithRole(db, "manager");
    const p = await seedProperty(db);
    await givePermit(db, manager, p.id);
    const g1 = await seedGuest(db);
    const g2 = await seedGuest(db);

    const b1 = await createBooking(db, manager, {
      propertyId: p.id, leadGuestId: g1.id, checkIn: "2026-08-01", checkOut: "2026-08-05", additionalGuestIds: [],
    } as any);
    await updateBookingStatus(db, manager, b1.id, "tentative");

    const b2 = await createBooking(db, manager, {
      propertyId: p.id, leadGuestId: g2.id, checkIn: "2026-08-03", checkOut: "2026-08-07", additionalGuestIds: [],
    } as any);
    const result = await confirmBooking(db, manager, b2.id);
    expect(result.booking.status).toBe("confirmed");
  });

  it("allows re-booking dates that were freed by cancelling the original booking", async () => {
    const db = await freshDb();
    const manager = await userWithRole(db, "manager");
    const p = await seedProperty(db);
    await givePermit(db, manager, p.id);
    const g1 = await seedGuest(db);
    const g2 = await seedGuest(db);

    const b1 = await createBooking(db, manager, {
      propertyId: p.id, leadGuestId: g1.id, checkIn: "2026-08-01", checkOut: "2026-08-05", additionalGuestIds: [],
    } as any);
    await confirmBooking(db, manager, b1.id);
    await updateBookingStatus(db, manager, b1.id, "cancelled");

    const b2 = await createBooking(db, manager, {
      propertyId: p.id, leadGuestId: g2.id, checkIn: "2026-08-02", checkOut: "2026-08-06", additionalGuestIds: [],
    } as any);
    const result = await confirmBooking(db, manager, b2.id);
    expect(result.booking.status).toBe("confirmed");
  });

  it("still rejects overlap even at the database layer directly (race-safety guarantee)", async () => {
    // Bypasses the service's friendly pre-check to prove the database
    // exclusion constraint itself — not just application logic — is what
    // stops the double-booking. This is what makes it race-safe.
    const db = await freshDb();
    const manager = await userWithRole(db, "manager");
    const p = await seedProperty(db);
    await givePermit(db, manager, p.id);
    const g1 = await seedGuest(db);
    const g2 = await seedGuest(db);

    const b1 = await createBooking(db, manager, {
      propertyId: p.id, leadGuestId: g1.id, checkIn: "2026-09-01", checkOut: "2026-09-05", additionalGuestIds: [],
    } as any);
    await confirmBooking(db, manager, b1.id);

    const b2 = await createBooking(db, manager, {
      propertyId: p.id, leadGuestId: g2.id, checkIn: "2026-09-02", checkOut: "2026-09-04", additionalGuestIds: [],
    } as any);

    const { booking } = await import("../../db/schema.js");
    const { eq } = await import("drizzle-orm");
    await expect(
      db.update(booking).set({ status: "confirmed" as const }).where(eq(booking.id, b2.id))
    ).rejects.toThrow();
  });
});

import { describe, it, expect } from "vitest";
import { freshDb, userWithRole, seedProperty, seedGuest } from "./helpers";
import { toIsoDateLocal } from "../calendarGrid";
import {
  createBooking, confirmBooking, updateBookingStatus, releaseExpiredHolds,
  InvalidTransitionError, ComplianceBlockedError,
} from "../services/bookingService";
import { createDocument } from "../services/documentService";
import { ValidationError } from "../services/propertyService";
import { ForbiddenError } from "../authz";
import { booking } from "../../db/schema";
import { eq } from "drizzle-orm";

function daysFromNow(days: number): string {
  // Uses local calendar fields, not toISOString() (which converts through
  // UTC and would shift the date near midnight in Asia/Dubai, UTC+4).
  const d = new Date();
  d.setDate(d.getDate() + days);
  return toIsoDateLocal(d);
}

describe("booking creation validation", () => {
  it("rejects a party size larger than the property's max occupancy", async () => {
    const db = await freshDb();
    const manager = await userWithRole(db, "manager");
    const p = await seedProperty(db, { maxOccupancy: 2 });
    const g = await seedGuest(db);
    await expect(createBooking(db, manager, {
      propertyId: p.id, leadGuestId: g.id, checkIn: "2026-08-01", checkOut: "2026-08-03",
      adults: 3, additionalGuestIds: [],
    } as any)).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects occupiedBedrooms greater than the property's bedroom count", async () => {
    const db = await freshDb();
    const manager = await userWithRole(db, "manager");
    const p = await seedProperty(db, { bedrooms: 1, maxOccupancy: 4 });
    const g = await seedGuest(db);
    await expect(createBooking(db, manager, {
      propertyId: p.id, leadGuestId: g.id, checkIn: "2026-08-01", checkOut: "2026-08-03",
      occupiedBedrooms: 3, additionalGuestIds: [],
    } as any)).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects check-out on or before check-in", async () => {
    const db = await freshDb();
    const manager = await userWithRole(db, "manager");
    const p = await seedProperty(db);
    const g = await seedGuest(db);
    await expect(createBooking(db, manager, {
      propertyId: p.id, leadGuestId: g.id, checkIn: "2026-08-05", checkOut: "2026-08-05",
      additionalGuestIds: [],
    } as any)).rejects.toBeInstanceOf(ValidationError);
  });

  it("refuses to book a blocked guest", async () => {
    const db = await freshDb();
    const manager = await userWithRole(db, "manager");
    const p = await seedProperty(db);
    const g = await seedGuest(db, { blocked: true });
    await expect(createBooking(db, manager, {
      propertyId: p.id, leadGuestId: g.id, checkIn: "2026-08-01", checkOut: "2026-08-03",
      additionalGuestIds: [],
    } as any)).rejects.toBeInstanceOf(ValidationError);
  });

  it("prevents housekeeping from creating a booking", async () => {
    const db = await freshDb();
    const hk = await userWithRole(db, "housekeeping");
    const p = await seedProperty(db);
    const g = await seedGuest(db);
    await expect(createBooking(db, hk, {
      propertyId: p.id, leadGuestId: g.id, checkIn: "2026-08-01", checkOut: "2026-08-03",
      additionalGuestIds: [],
    } as any)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("booking status transitions", () => {
  it("follows the allowed path: enquiry -> tentative -> confirmed -> checked_in -> checked_out", async () => {
    const db = await freshDb();
    const manager = await userWithRole(db, "manager");
    const p = await seedProperty(db);
    await createDocument(db, manager, { type: "det_permit", ownerType: "property", propertyId: p.id, expiryDate: daysFromNow(300) } as any);
    const g = await seedGuest(db);
    const b = await createBooking(db, manager, {
      propertyId: p.id, leadGuestId: g.id, checkIn: "2026-08-01", checkOut: "2026-08-03", additionalGuestIds: [],
    } as any);
    expect(b.status).toBe("enquiry");

    await updateBookingStatus(db, manager, b.id, "tentative");
    const { booking: confirmed } = await confirmBooking(db, manager, b.id);
    expect(confirmed.status).toBe("confirmed");

    const checkedIn = await updateBookingStatus(db, manager, b.id, "checked_in");
    expect(checkedIn.status).toBe("checked_in");

    const checkedOut = await updateBookingStatus(db, manager, b.id, "checked_out");
    expect(checkedOut.status).toBe("checked_out");
  });

  it("rejects an illegal transition (checked_out back to confirmed)", async () => {
    const db = await freshDb();
    const manager = await userWithRole(db, "manager");
    const p = await seedProperty(db);
    await createDocument(db, manager, { type: "det_permit", ownerType: "property", propertyId: p.id, expiryDate: daysFromNow(300) } as any);
    const g = await seedGuest(db);
    const b = await createBooking(db, manager, {
      propertyId: p.id, leadGuestId: g.id, checkIn: "2026-08-01", checkOut: "2026-08-03", additionalGuestIds: [],
    } as any);
    await confirmBooking(db, manager, b.id);
    await updateBookingStatus(db, manager, b.id, "checked_in");
    await updateBookingStatus(db, manager, b.id, "checked_out");

    await expect(updateBookingStatus(db, manager, b.id, "confirmed")).rejects.toBeInstanceOf(InvalidTransitionError);
  });

  it("rejects skipping straight from enquiry to checked_in", async () => {
    const db = await freshDb();
    const manager = await userWithRole(db, "manager");
    const p = await seedProperty(db);
    const g = await seedGuest(db);
    const b = await createBooking(db, manager, {
      propertyId: p.id, leadGuestId: g.id, checkIn: "2026-08-01", checkOut: "2026-08-03", additionalGuestIds: [],
    } as any);
    await expect(updateBookingStatus(db, manager, b.id, "checked_in")).rejects.toBeInstanceOf(InvalidTransitionError);
  });
});

describe("compliance blocking rule (spec 4.2)", () => {
  it("blocks confirmation when the property has no DET permit", async () => {
    const db = await freshDb();
    const manager = await userWithRole(db, "manager");
    const p = await seedProperty(db);
    const g = await seedGuest(db);
    const b = await createBooking(db, manager, {
      propertyId: p.id, leadGuestId: g.id, checkIn: "2026-08-01", checkOut: "2026-08-03", additionalGuestIds: [],
    } as any);
    await expect(confirmBooking(db, manager, b.id)).rejects.toBeInstanceOf(ComplianceBlockedError);
  });

  it("blocks confirmation when the DET permit has expired", async () => {
    const db = await freshDb();
    const manager = await userWithRole(db, "manager");
    const p = await seedProperty(db);
    await createDocument(db, manager, { type: "det_permit", ownerType: "property", propertyId: p.id, expiryDate: daysFromNow(-3) } as any);
    const g = await seedGuest(db);
    const b = await createBooking(db, manager, {
      propertyId: p.id, leadGuestId: g.id, checkIn: "2026-08-01", checkOut: "2026-08-03", additionalGuestIds: [],
    } as any);
    await expect(confirmBooking(db, manager, b.id)).rejects.toBeInstanceOf(ComplianceBlockedError);
  });

  it("allows an explicit, reasoned override by an owner", async () => {
    const db = await freshDb();
    const owner = await userWithRole(db, "owner");
    const p = await seedProperty(db);
    const g = await seedGuest(db);
    const b = await createBooking(db, owner, {
      propertyId: p.id, leadGuestId: g.id, checkIn: "2026-08-01", checkOut: "2026-08-03", additionalGuestIds: [],
    } as any);
    const { booking: confirmed } = await confirmBooking(db, owner, b.id, {
      override: true, overrideReason: "Permit renewal submitted, DET confirmed verbally pending paperwork",
    });
    expect(confirmed.status).toBe("confirmed");
    expect(confirmed.complianceOverrideReason).toContain("Permit renewal");
  });

  it("requires an override reason, not just the override flag", async () => {
    const db = await freshDb();
    const owner = await userWithRole(db, "owner");
    const p = await seedProperty(db);
    const g = await seedGuest(db);
    const b = await createBooking(db, owner, {
      propertyId: p.id, leadGuestId: g.id, checkIn: "2026-08-01", checkOut: "2026-08-03", additionalGuestIds: [],
    } as any);
    await expect(confirmBooking(db, owner, b.id, { override: true })).rejects.toBeInstanceOf(ValidationError);
  });

  it("does not allow a manager to override (owner/manager-only action per authz, but override itself needs owner)", async () => {
    const db = await freshDb();
    const manager = await userWithRole(db, "manager");
    const p = await seedProperty(db);
    const g = await seedGuest(db);
    const b = await createBooking(db, manager, {
      propertyId: p.id, leadGuestId: g.id, checkIn: "2026-08-01", checkOut: "2026-08-03", additionalGuestIds: [],
    } as any);
    await expect(confirmBooking(db, manager, b.id, { override: true, overrideReason: "trust me" }))
      .rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("auto-created guest registration compliance task (spec 3.2)", () => {
  it("creates a task due 3 hours after check-in by default", async () => {
    const db = await freshDb();
    const manager = await userWithRole(db, "manager");
    const p = await seedProperty(db);
    await createDocument(db, manager, { type: "det_permit", ownerType: "property", propertyId: p.id, expiryDate: daysFromNow(300) } as any);
    const g = await seedGuest(db);
    const b = await createBooking(db, manager, {
      propertyId: p.id, leadGuestId: g.id, checkIn: "2026-08-01", checkOut: "2026-08-03", additionalGuestIds: [],
    } as any);
    const { complianceTask } = await confirmBooking(db, manager, b.id);
    expect(complianceTask.type).toBe("guest_registration");
    expect(complianceTask.status).toBe("pending");
    const expected = new Date("2026-08-01T03:00:00.000Z").getTime();
    expect(new Date(complianceTask.dueAt).getTime()).toBe(expected);
  });

  it("honours a configured deadline instead of the 3-hour default", async () => {
    const db = await freshDb();
    const manager = await userWithRole(db, "manager");
    const p = await seedProperty(db);
    await createDocument(db, manager, { type: "det_permit", ownerType: "property", propertyId: p.id, expiryDate: daysFromNow(300) } as any);
    const g = await seedGuest(db);
    const b = await createBooking(db, manager, {
      propertyId: p.id, leadGuestId: g.id, checkIn: "2026-08-01", checkOut: "2026-08-03", additionalGuestIds: [],
    } as any);
    const { complianceTask } = await confirmBooking(db, manager, b.id, { guestRegistrationDeadlineHours: 24 });
    const expected = new Date("2026-08-02T00:00:00.000Z").getTime();
    expect(new Date(complianceTask.dueAt).getTime()).toBe(expected);
  });
});

describe("releaseExpiredHolds", () => {
  it("auto-cancels tentative holds past their expiry and leaves others untouched", async () => {
    const db = await freshDb();
    const manager = await userWithRole(db, "manager");
    const p = await seedProperty(db);
    const g1 = await seedGuest(db);
    const g2 = await seedGuest(db);

    const expired = await createBooking(db, manager, {
      propertyId: p.id, leadGuestId: g1.id, checkIn: "2026-08-01", checkOut: "2026-08-03", additionalGuestIds: [],
    } as any);
    await updateBookingStatus(db, manager, expired.id, "tentative");
    await db.update(booking).set({ holdExpiresAt: new Date(Date.now() - 60_000) }).where(eq(booking.id, expired.id));

    const stillValid = await createBooking(db, manager, {
      propertyId: p.id, leadGuestId: g2.id, checkIn: "2026-08-10", checkOut: "2026-08-12", additionalGuestIds: [],
    } as any);
    await updateBookingStatus(db, manager, stillValid.id, "tentative");
    await db.update(booking).set({ holdExpiresAt: new Date(Date.now() + 60 * 60_000) }).where(eq(booking.id, stillValid.id));

    const releasedIds = await releaseExpiredHolds(db);
    expect(releasedIds).toEqual([expired.id]);

    const [expiredRow] = await db.select().from(booking).where(eq(booking.id, expired.id));
    const [validRow] = await db.select().from(booking).where(eq(booking.id, stillValid.id));
    expect(expiredRow.status).toBe("cancelled");
    expect(validRow.status).toBe("tentative");
  });
});

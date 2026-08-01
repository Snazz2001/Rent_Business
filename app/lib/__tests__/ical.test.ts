import { describe, it, expect } from "vitest";
import { bookingsToIcs } from "../services/bookingService";
import { freshDb, userWithRole, seedProperty, seedGuest } from "./helpers";
import { createBooking, confirmBooking, icalExportForProperty } from "../services/bookingService";
import { createDocument } from "../services/documentService";
import { toIsoDateLocal } from "../calendarGrid";

function daysFromNow(days: number): string {
  // Uses local calendar fields, not toISOString() (which converts through
  // UTC and would shift the date near midnight in Asia/Dubai, UTC+4).
  const d = new Date();
  d.setDate(d.getDate() + days);
  return toIsoDateLocal(d);
}

describe("bookingsToIcs", () => {
  it("produces a valid VCALENDAR wrapper", () => {
    const ics = bookingsToIcs("P-001", []);
    expect(ics).toMatch(/^BEGIN:VCALENDAR/);
    expect(ics).toMatch(/END:VCALENDAR$/);
  });

  it("includes one VEVENT per occupying booking, with correct dates", () => {
    const ics = bookingsToIcs("P-001", [
      { id: "abc", checkIn: "2026-08-01", checkOut: "2026-08-05", status: "confirmed" },
    ]);
    expect(ics).toContain("BEGIN:VEVENT");
    expect(ics).toContain("DTSTART;VALUE=DATE:20260801");
    expect(ics).toContain("DTEND;VALUE=DATE:20260805");
    expect(ics).toContain("UID:abc@holiday-rental-system");
  });

  it("excludes bookings that are not occupying (enquiry, tentative, cancelled)", () => {
    const ics = bookingsToIcs("P-001", [
      { id: "a", checkIn: "2026-08-01", checkOut: "2026-08-02", status: "enquiry" },
      { id: "b", checkIn: "2026-08-03", checkOut: "2026-08-04", status: "tentative" },
      { id: "c", checkIn: "2026-08-05", checkOut: "2026-08-06", status: "cancelled" },
    ]);
    expect(ics).not.toContain("BEGIN:VEVENT");
  });

  it("does not include guest names in the feed (privacy)", () => {
    const ics = bookingsToIcs("P-001", [
      { id: "a", checkIn: "2026-08-01", checkOut: "2026-08-02", status: "confirmed" },
    ]);
    expect(ics.toLowerCase()).not.toContain("guest");
    expect(ics).toContain("Booked");
  });
});

describe("icalExportForProperty (integration)", () => {
  it("exports only the confirmed booking for that property", async () => {
    const db = await freshDb();
    const manager = await userWithRole(db, "manager");
    const p = await seedProperty(db, { referenceCode: "P-EXPORT" });
    await createDocument(db, manager, { type: "det_permit", ownerType: "property", propertyId: p.id, expiryDate: daysFromNow(300) } as any);
    const g = await seedGuest(db);
    const b = await createBooking(db, manager, {
      propertyId: p.id, leadGuestId: g.id, checkIn: "2026-08-01", checkOut: "2026-08-03", additionalGuestIds: [],
    } as any);
    await confirmBooking(db, manager, b.id);

    const ics = await icalExportForProperty(db, manager, p.id);
    expect(ics).toContain("BEGIN:VEVENT");
    expect(ics).toContain(`UID:${b.id}@holiday-rental-system`);
    expect(ics).toContain("P-EXPORT");
  });
});

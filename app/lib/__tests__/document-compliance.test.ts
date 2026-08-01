import { describe, it, expect } from "vitest";
import { freshDb, userWithRole, seedProperty } from "./helpers";
import { toIsoDateLocal } from "../calendarGrid";
import {
  trafficLightForExpiry, nextAlertThreshold, createDocument,
  propertyComplianceStatus, permitBlocksBooking,
} from "../services/documentService";

function daysFromNow(days: number): string {
  // Uses local calendar fields, not toISOString() (which converts through
  // UTC and would shift the date near midnight in Asia/Dubai, UTC+4).
  const d = new Date();
  d.setDate(d.getDate() + days);
  return toIsoDateLocal(d);
}

describe("trafficLightForExpiry", () => {
  it("is green with no expiry date", () => {
    expect(trafficLightForExpiry(null)).toBe("green");
  });
  it("is green with 91+ days remaining", () => {
    expect(trafficLightForExpiry(daysFromNow(91))).toBe("green");
  });
  it("is amber at the 90-day boundary", () => {
    expect(trafficLightForExpiry(daysFromNow(90))).toBe("amber");
  });
  it("is amber at 30 and 8 days remaining", () => {
    expect(trafficLightForExpiry(daysFromNow(30))).toBe("amber");
    expect(trafficLightForExpiry(daysFromNow(8))).toBe("amber");
  });
  it("is red at 7 days remaining", () => {
    expect(trafficLightForExpiry(daysFromNow(7))).toBe("red");
  });
  it("is red once expired", () => {
    expect(trafficLightForExpiry(daysFromNow(-5))).toBe("red");
  });
});

describe("nextAlertThreshold", () => {
  it("matches the 90/60/30/7 day cadence from the spec", () => {
    expect(nextAlertThreshold(daysFromNow(120))).toBeNull();
    expect(nextAlertThreshold(daysFromNow(90))).toBe(90);
    expect(nextAlertThreshold(daysFromNow(75))).toBe(90);
    expect(nextAlertThreshold(daysFromNow(60))).toBe(60);
    expect(nextAlertThreshold(daysFromNow(30))).toBe(30);
    expect(nextAlertThreshold(daysFromNow(7))).toBe(7);
    expect(nextAlertThreshold(daysFromNow(0))).toBe(7);
    expect(nextAlertThreshold(daysFromNow(-1))).toBe(7);
  });
});

describe("propertyComplianceStatus", () => {
  it("flags a property with no DET permit as red / missing", async () => {
    const db = await freshDb();
    const owner = await userWithRole(db, "owner");
    const p = await seedProperty(db);
    const status = await propertyComplianceStatus(db, owner, p.id);
    expect(status.permitStatus).toBe("missing");
    expect(status.status).toBe("red");
    expect(permitBlocksBooking(status.permitStatus)).toBe(true);
  });

  it("is green when the permit is valid and far from expiry", async () => {
    const db = await freshDb();
    const owner = await userWithRole(db, "owner");
    const p = await seedProperty(db);
    await createDocument(db, owner, {
      type: "det_permit", ownerType: "property", propertyId: p.id,
      expiryDate: daysFromNow(200),
    } as any);
    const status = await propertyComplianceStatus(db, owner, p.id);
    expect(status.permitStatus).toBe("valid");
    expect(status.status).toBe("green");
    expect(permitBlocksBooking(status.permitStatus)).toBe(false);
  });

  it("is expiring_soon inside 30 days and does not block booking", async () => {
    const db = await freshDb();
    const owner = await userWithRole(db, "owner");
    const p = await seedProperty(db);
    await createDocument(db, owner, {
      type: "det_permit", ownerType: "property", propertyId: p.id,
      expiryDate: daysFromNow(20),
    } as any);
    const status = await propertyComplianceStatus(db, owner, p.id);
    expect(status.permitStatus).toBe("expiring_soon");
    expect(permitBlocksBooking(status.permitStatus)).toBe(false);
  });

  it("is expired and blocks booking once past the expiry date", async () => {
    const db = await freshDb();
    const owner = await userWithRole(db, "owner");
    const p = await seedProperty(db);
    await createDocument(db, owner, {
      type: "det_permit", ownerType: "property", propertyId: p.id,
      expiryDate: daysFromNow(-1),
    } as any);
    const status = await propertyComplianceStatus(db, owner, p.id);
    expect(status.permitStatus).toBe("expired");
    expect(status.status).toBe("red");
    expect(permitBlocksBooking(status.permitStatus)).toBe(true);
  });

  it("takes the worst status across multiple documents", async () => {
    const db = await freshDb();
    const owner = await userWithRole(db, "owner");
    const p = await seedProperty(db);
    await createDocument(db, owner, {
      type: "det_permit", ownerType: "property", propertyId: p.id, expiryDate: daysFromNow(200),
    } as any);
    await createDocument(db, owner, {
      type: "insurance_policy", ownerType: "property", propertyId: p.id, expiryDate: daysFromNow(5),
    } as any);
    const status = await propertyComplianceStatus(db, owner, p.id);
    expect(status.status).toBe("red"); // insurance about to expire, even though permit is fine
    expect(status.permitStatus).toBe("valid");
  });
});

import { describe, it, expect } from "vitest";
import { freshDb, userWithRole, seedOwner, seedGuest } from "./helpers";
import { createProperty, updateProperty, deleteProperty, listProperties, getProperty, ValidationError } from "../services/propertyService";
import { createBooking } from "../services/bookingService";
import { ForbiddenError } from "../authz";

describe("propertyService", () => {
  it("creates a property with valid input", async () => {
    const db = await freshDb();
    const owner = await userWithRole(db, "owner");
    const p = await createProperty(db, owner, {
      referenceCode: "P-001",
      name: "Marina Loft",
      emirate: "Dubai",
      bedrooms: 2,
      bathrooms: 2,
      maxOccupancy: 4,
      classification: "standard",
      status: "active",
      amenities: ["pool", "gym"],
    } as any);
    expect(p.referenceCode).toBe("P-001");
    expect(p.status).toBe("active");
    expect(p.amenities).toEqual(["pool", "gym"]);
  });

  it("rejects negative bedrooms", async () => {
    const db = await freshDb();
    const user = await userWithRole(db, "owner");
    await expect(createProperty(db, user, {
      referenceCode: "P-002", name: "Bad Unit", emirate: "Dubai",
      bedrooms: -1, bathrooms: 1, maxOccupancy: 2, classification: "standard", status: "active", amenities: [],
    } as any)).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects maxOccupancy of 0", async () => {
    const db = await freshDb();
    const user = await userWithRole(db, "owner");
    await expect(createProperty(db, user, {
      referenceCode: "P-003", name: "Bad Unit 2", emirate: "Dubai",
      bedrooms: 1, bathrooms: 1, maxOccupancy: 0, classification: "standard", status: "active", amenities: [],
    } as any)).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects an ownerId that does not exist", async () => {
    const db = await freshDb();
    const user = await userWithRole(db, "owner");
    await expect(createProperty(db, user, {
      referenceCode: "P-004", name: "Orphan Unit", emirate: "Dubai",
      bedrooms: 1, bathrooms: 1, maxOccupancy: 2, classification: "standard", status: "active", amenities: [],
      ownerId: "00000000-0000-0000-0000-000000000000",
    } as any)).rejects.toBeInstanceOf(ValidationError);
  });

  it("accepts a real ownerId", async () => {
    const db = await freshDb();
    const user = await userWithRole(db, "owner");
    const o = await seedOwner(db);
    const p = await createProperty(db, user, {
      referenceCode: "P-005", name: "Owned Unit", emirate: "Dubai",
      bedrooms: 1, bathrooms: 1, maxOccupancy: 2, classification: "standard", status: "active", amenities: [],
      ownerId: o.id,
    } as any);
    expect(p.ownerId).toBe(o.id);
  });

  it("prevents housekeeping from writing a property", async () => {
    const db = await freshDb();
    const hk = await userWithRole(db, "housekeeping");
    await expect(createProperty(db, hk, {
      referenceCode: "P-006", name: "Nope", emirate: "Dubai",
      bedrooms: 1, bathrooms: 1, maxOccupancy: 2, classification: "standard", status: "active", amenities: [],
    } as any)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("allows housekeeping to read properties", async () => {
    const db = await freshDb();
    const owner = await userWithRole(db, "owner");
    await createProperty(db, owner, {
      referenceCode: "P-007", name: "Readable", emirate: "Dubai",
      bedrooms: 1, bathrooms: 1, maxOccupancy: 2, classification: "standard", status: "active", amenities: [],
    } as any);
    const hk = await userWithRole(db, "housekeeping");
    const rows = await listProperties(db, hk);
    expect(rows.length).toBe(1);
  });

  it("updates a property and preserves unspecified fields", async () => {
    const db = await freshDb();
    const owner = await userWithRole(db, "owner");
    const created = await createProperty(db, owner, {
      referenceCode: "P-008", name: "Original Name", emirate: "Dubai",
      bedrooms: 2, bathrooms: 2, maxOccupancy: 4, classification: "standard", status: "active", amenities: [],
    } as any);
    const updated = await updateProperty(db, owner, created.id, { name: "Renamed" } as any);
    expect(updated.name).toBe("Renamed");
    expect(updated.bedrooms).toBe(2); // preserved
    expect(updated.referenceCode).toBe("P-008"); // preserved
  });

  it("returns null from getProperty for an unknown id", async () => {
    const db = await freshDb();
    const owner = await userWithRole(db, "owner");
    const row = await getProperty(db, owner, "00000000-0000-0000-0000-000000000000");
    expect(row).toBeNull();
  });

  it("lets the owner delete a property with no bookings", async () => {
    const db = await freshDb();
    const owner = await userWithRole(db, "owner");
    const created = await createProperty(db, owner, {
      referenceCode: "P-009", name: "Deletable", emirate: "Dubai",
      bedrooms: 1, bathrooms: 1, maxOccupancy: 2, classification: "standard", status: "active", amenities: [],
    } as any);
    await deleteProperty(db, owner, created.id);
    const row = await getProperty(db, owner, created.id);
    expect(row).toBeNull();
  });

  it("blocks deleting a property that has a booking on record", async () => {
    const db = await freshDb();
    const owner = await userWithRole(db, "owner");
    const created = await createProperty(db, owner, {
      referenceCode: "P-010", name: "Booked Unit", emirate: "Dubai",
      bedrooms: 1, bathrooms: 1, maxOccupancy: 2, classification: "standard", status: "active", amenities: [],
    } as any);
    const guest = await seedGuest(db, { fullName: "Booked Guest" });
    await createBooking(db, owner, {
      propertyId: created.id, leadGuestId: guest.id, checkIn: "2026-08-01", checkOut: "2026-08-05",
      adults: 2, additionalGuestIds: [],
    } as any);

    await expect(deleteProperty(db, owner, created.id)).rejects.toBeInstanceOf(ValidationError);
    const row = await getProperty(db, owner, created.id);
    expect(row).not.toBeNull(); // still exists — deletion was blocked, not silently partial
  });

  it("prevents a manager from deleting a property even though they can edit one", async () => {
    const db = await freshDb();
    const owner = await userWithRole(db, "owner");
    const created = await createProperty(db, owner, {
      referenceCode: "P-011", name: "Manager Cannot Delete", emirate: "Dubai",
      bedrooms: 1, bathrooms: 1, maxOccupancy: 2, classification: "standard", status: "active", amenities: [],
    } as any);
    const manager = await userWithRole(db, "manager");
    await expect(updateProperty(db, manager, created.id, { name: "Edited by manager" } as any)).resolves.toBeTruthy();
    await expect(deleteProperty(db, manager, created.id)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("deleteProperty throws ValidationError for an unknown id", async () => {
    const db = await freshDb();
    const owner = await userWithRole(db, "owner");
    await expect(deleteProperty(db, owner, "00000000-0000-0000-0000-000000000000")).rejects.toBeInstanceOf(ValidationError);
  });
});

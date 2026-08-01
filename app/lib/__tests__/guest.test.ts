import { describe, it, expect } from "vitest";
import { freshDb, userWithRole } from "./helpers";
import { createGuest, listGuests, getGuest } from "../services/guestService";
import { ValidationError } from "../services/propertyService";
import { ForbiddenError } from "../authz";

describe("guestService", () => {
  it("creates a guest with required fields", async () => {
    const db = await freshDb();
    const manager = await userWithRole(db, "manager");
    const g = await createGuest(db, manager, {
      fullName: "Jane Traveller",
      mobile: "+971500000001",
    } as any);
    expect(g.fullName).toBe("Jane Traveller");
  });

  it("rejects a guest without a mobile number", async () => {
    const db = await freshDb();
    const manager = await userWithRole(db, "manager");
    await expect(createGuest(db, manager, { fullName: "No Phone" } as any)).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects an invalid email", async () => {
    const db = await freshDb();
    const manager = await userWithRole(db, "manager");
    await expect(createGuest(db, manager, {
      fullName: "Bad Email", mobile: "+971500000002", email: "not-an-email",
    } as any)).rejects.toBeInstanceOf(ValidationError);
  });

  it("prevents housekeeping from creating guests", async () => {
    const db = await freshDb();
    const hk = await userWithRole(db, "housekeeping");
    await expect(createGuest(db, hk, {
      fullName: "Nope", mobile: "+971500000003",
    } as any)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("redacts identity document fields for a role without identity-read access (finance)", async () => {
    // Housekeeping/maintenance have no general guest:read at all per the
    // RBAC table (plan section 3.3) — they only see cleaning-relevant
    // booking info, not the guest list. Finance *can* read guests (for
    // invoicing) but explicitly should not see passport/Emirates ID
    // details — that's the redaction this test is really about.
    const db = await freshDb();
    const manager = await userWithRole(db, "manager");
    await createGuest(db, manager, {
      fullName: "Full Guest", mobile: "+971500000004",
      documentType: "passport", documentNumber: "P1234567", documentIssuingCountry: "GB",
    } as any);

    const finance = await userWithRole(db, "finance");
    const rows = await listGuests(db, finance);
    expect(rows).toHaveLength(1);
    expect(rows[0].documentNumber).toBeNull();
    expect(rows[0].documentIssuingCountry).toBeNull();
  });

  it("housekeeping has no guest read access at all", async () => {
    const db = await freshDb();
    const manager = await userWithRole(db, "manager");
    await createGuest(db, manager, { fullName: "Someone", mobile: "+971500000009" } as any);
    const hk = await userWithRole(db, "housekeeping");
    await expect(listGuests(db, hk)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("does not redact identity document fields for the owner", async () => {
    const db = await freshDb();
    const owner = await userWithRole(db, "owner");
    await createGuest(db, owner, {
      fullName: "Full Guest 2", mobile: "+971500000005",
      documentType: "passport", documentNumber: "P7654321",
    } as any);

    const rows = await listGuests(db, owner);
    expect(rows[0].documentNumber).toBe("P7654321");
  });

  it("getGuest returns null for an unknown id", async () => {
    const db = await freshDb();
    const owner = await userWithRole(db, "owner");
    const row = await getGuest(db, owner, "00000000-0000-0000-0000-000000000000");
    expect(row).toBeNull();
  });

  it("finds a returning guest by a partial, case-insensitive mobile number match", async () => {
    const db = await freshDb();
    const owner = await userWithRole(db, "owner");
    await createGuest(db, owner, { fullName: "Alice Renter", mobile: "+971501234567", email: "alice@example.com" } as any);
    await createGuest(db, owner, { fullName: "Bob Traveller", mobile: "+971509999999", email: "bob@example.com" } as any);

    const byMobile = await listGuests(db, owner, "1234567");
    expect(byMobile.map((g) => g.fullName)).toEqual(["Alice Renter"]);

    const byEmailCaseInsensitive = await listGuests(db, owner, "ALICE@");
    expect(byEmailCaseInsensitive.map((g) => g.fullName)).toEqual(["Alice Renter"]);

    const byName = await listGuests(db, owner, "traveller");
    expect(byName.map((g) => g.fullName)).toEqual(["Bob Traveller"]);
  });

  it("search matches an ID document number only for a role with identity-read access", async () => {
    const db = await freshDb();
    const owner = await userWithRole(db, "owner");
    await createGuest(db, owner, {
      fullName: "Passport Guest", mobile: "+971502222222",
      documentType: "passport", documentNumber: "PA9988776",
    } as any);

    const ownerResult = await listGuests(db, owner, "PA9988776");
    expect(ownerResult).toHaveLength(1);

    const finance = await userWithRole(db, "finance");
    const financeResult = await listGuests(db, finance, "PA9988776");
    expect(financeResult).toHaveLength(0); // finance lacks guest:read_identity — the number isn't a valid search term for them
  });

  it("returns the full list when no search query is given", async () => {
    const db = await freshDb();
    const owner = await userWithRole(db, "owner");
    await createGuest(db, owner, { fullName: "Guest A", mobile: "+971501111111" } as any);
    await createGuest(db, owner, { fullName: "Guest B", mobile: "+971502222222" } as any);
    const rows = await listGuests(db, owner);
    expect(rows).toHaveLength(2);
  });
});

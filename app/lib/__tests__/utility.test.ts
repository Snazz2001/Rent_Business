import { describe, it, expect } from "vitest";
import { freshDb, userWithRole, seedProperty } from "./helpers";
import { createUtilityAccount, listUtilityAccounts } from "../services/utilityService";
import { ValidationError } from "../services/propertyService";
import { ForbiddenError } from "../authz";

describe("utilityService", () => {
  it("creates a utility account for a property", async () => {
    const db = await freshDb();
    const manager = await userWithRole(db, "manager");
    const p = await seedProperty(db);
    const u = await createUtilityAccount(db, manager, {
      propertyId: p.id, type: "dewa", accountNumber: "DEWA-123", premiseNumber: "PR-9",
    } as any);
    expect(u.type).toBe("dewa");
    expect(u.accountNumber).toBe("DEWA-123");
  });

  it("rejects an unknown utility type", async () => {
    const db = await freshDb();
    const manager = await userWithRole(db, "manager");
    const p = await seedProperty(db);
    await expect(createUtilityAccount(db, manager, {
      propertyId: p.id, type: "electricity-but-wrong-key",
    } as any)).rejects.toBeInstanceOf(ValidationError);
  });

  it("prevents housekeeping from adding utility accounts", async () => {
    const db = await freshDb();
    const hk = await userWithRole(db, "housekeeping");
    const p = await seedProperty(db);
    await expect(createUtilityAccount(db, hk, { propertyId: p.id, type: "dewa" } as any))
      .rejects.toBeInstanceOf(ForbiddenError);
  });

  it("lists utility accounts scoped to the correct property", async () => {
    const db = await freshDb();
    const manager = await userWithRole(db, "manager");
    const p1 = await seedProperty(db, { referenceCode: "P-U1" });
    const p2 = await seedProperty(db, { referenceCode: "P-U2" });
    await createUtilityAccount(db, manager, { propertyId: p1.id, type: "dewa" } as any);
    await createUtilityAccount(db, manager, { propertyId: p2.id, type: "internet" } as any);

    const forP1 = await listUtilityAccounts(db, manager, p1.id);
    expect(forP1).toHaveLength(1);
    expect(forP1[0].type).toBe("dewa");
  });
});

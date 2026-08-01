import { describe, it, expect } from "vitest";
import { can, assertCan, ForbiddenError, type Role, type Action } from "../authz";

const ROLES: Role[] = ["owner", "manager", "finance", "housekeeping", "maintenance", "readonly"];

describe("authz policy table (implementation plan section 3.3)", () => {
  it("gives the owner every permission", () => {
    const ALL_ACTIONS: Action[] = [
      "property:read", "property:write", "property:delete", "owner:read", "owner:write",
      "document:read", "document:write", "guest:read", "guest:read_identity", "guest:write",
      "booking:read", "booking:write", "booking:confirm", "booking:override_compliance",
      "compliance:read", "compliance:write", "audit:read",
    ];
    for (const a of ALL_ACTIONS) expect(can("owner", a)).toBe(true);
  });

  it("only the owner can delete a property — managers can edit but not delete", () => {
    for (const role of ROLES) {
      expect(can(role, "property:delete")).toBe(role === "owner");
    }
    expect(can("manager", "property:write")).toBe(true);
    expect(can("manager", "property:delete")).toBe(false);
  });

  it("housekeeping can read properties and bookings, nothing else", () => {
    expect(can("housekeeping", "property:read")).toBe(true);
    expect(can("housekeeping", "booking:read")).toBe(true);
    expect(can("housekeeping", "guest:read_identity")).toBe(false);
    expect(can("housekeeping", "property:write")).toBe(false);
    expect(can("housekeeping", "booking:write")).toBe(false);
  });

  it("maintenance cannot see guest identity documents or financials", () => {
    expect(can("maintenance", "guest:read_identity")).toBe(false);
    expect(can("maintenance", "guest:read")).toBe(false);
  });

  it("finance can read compliance and audit but cannot write bookings", () => {
    expect(can("finance", "compliance:read")).toBe(true);
    expect(can("finance", "audit:read")).toBe(true);
    expect(can("finance", "booking:write")).toBe(false);
  });

  it("only the owner can override a compliance block", () => {
    for (const role of ROLES) {
      expect(can(role, "booking:override_compliance")).toBe(role === "owner");
    }
  });

  it("readonly can read across modules but cannot write anything", () => {
    expect(can("readonly", "property:read")).toBe(true);
    expect(can("readonly", "guest:read")).toBe(true);
    expect(can("readonly", "booking:read")).toBe(true);
    expect(can("readonly", "property:write")).toBe(false);
    expect(can("readonly", "guest:write")).toBe(false);
    expect(can("readonly", "booking:write")).toBe(false);
  });

  it("assertCan throws ForbiddenError with the role and action named", () => {
    try {
      assertCan("housekeeping", "guest:read_identity");
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ForbiddenError);
      expect((e as Error).message).toContain("housekeeping");
      expect((e as Error).message).toContain("guest:read_identity");
    }
  });

  it("assertCan does not throw for a permitted action", () => {
    expect(() => assertCan("manager", "property:write")).not.toThrow();
  });
});

/**
 * Role-based access control — application-level enforcement.
 *
 * The implementation plan (section 3.3) specifies Supabase Row-Level
 * Security as the production enforcement point, so the restriction holds
 * even if application code forgets to check. That requires a live Supabase
 * project, which isn't available in this environment. This module is the
 * same policy table expressed as plain functions, enforced at the top of
 * every service call — the same rule set, checked in code instead of in
 * the database. When the project is deployed to Supabase, mirror this
 * table into RLS policies per the plan; do not remove these checks, since
 * defence-in-depth (both layers) is the point.
 */

export type Role = "owner" | "manager" | "finance" | "housekeeping" | "maintenance" | "readonly";

export type Action =
  | "property:read" | "property:write" | "property:delete"
  | "owner:read" | "owner:write"
  | "document:read" | "document:write"
  | "guest:read" | "guest:read_identity" | "guest:write"
  | "booking:read" | "booking:write" | "booking:confirm" | "booking:override_compliance"
  | "compliance:read" | "compliance:write"
  | "audit:read";

const POLICY: Record<Role, Action[]> = {
  owner: [
    "property:read", "property:write", "property:delete",
    "owner:read", "owner:write",
    "document:read", "document:write",
    "guest:read", "guest:read_identity", "guest:write",
    "booking:read", "booking:write", "booking:confirm", "booking:override_compliance",
    "compliance:read", "compliance:write",
    "audit:read",
  ],
  manager: [
    "property:read", "property:write",
    "document:read", "document:write",
    "guest:read", "guest:read_identity", "guest:write",
    "booking:read", "booking:write", "booking:confirm",
    "compliance:read", "compliance:write",
  ],
  finance: [
    "property:read",
    "document:read",
    "guest:read",
    "booking:read",
    "compliance:read",
    "audit:read",
  ],
  housekeeping: [
    "property:read",
    "booking:read",
  ],
  maintenance: [
    "property:read",
    "booking:read",
  ],
  readonly: [
    "property:read",
    "document:read",
    "guest:read",
    "booking:read",
    "compliance:read",
  ],
};

export class ForbiddenError extends Error {
  constructor(action: Action, role: Role) {
    super(`Role "${role}" is not permitted to perform "${action}"`);
    this.name = "ForbiddenError";
  }
}

export function can(role: Role, action: Action): boolean {
  return POLICY[role]?.includes(action) ?? false;
}

/** Throws ForbiddenError if the role lacks the action. Call at the top of
 * every service function that touches sensitive or write data. */
export function assertCan(role: Role, action: Action): void {
  if (!can(role, action)) {
    throw new ForbiddenError(action, role);
  }
}

export interface CurrentUser {
  id: string;
  role: Role;
}

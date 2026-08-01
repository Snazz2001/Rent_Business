import { and, eq } from "drizzle-orm";
import type { AppDb } from "./types";
import { document, property } from "../../db/schema";
import { documentInputSchema, type DocumentInput } from "../validation";
import { assertCan, type CurrentUser } from "../authz";
import { writeAudit } from "./auditService";
import { ValidationError } from "./propertyService";

export type TrafficLight = "green" | "amber" | "red";

/** Alert thresholds from spec section 4.2. Exposed as a named export so
 * tests (and, later, the notification scheduler) reference the same single
 * source of truth rather than duplicating magic numbers. */
export const EXPIRY_ALERT_THRESHOLDS_DAYS = [90, 60, 30, 7] as const;

/** Days between `today` and `expiryDate` (positive = still valid). */
export function daysUntil(expiryDate: string | Date, today: Date = new Date()): number {
  const expiry = typeof expiryDate === "string" ? new Date(expiryDate) : expiryDate;
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const startOfExpiry = new Date(expiry.getFullYear(), expiry.getMonth(), expiry.getDate());
  return Math.round((startOfExpiry.getTime() - startOfToday.getTime()) / (1000 * 60 * 60 * 24));
}

/** Three-state traffic light for the compliance dashboard (spec 4.2).
 * green: no deadline pressure. amber: inside the 90-day alert window.
 * red: inside 7 days, or already expired. */
export function trafficLightForExpiry(expiryDate: string | Date | null, today: Date = new Date()): TrafficLight {
  if (!expiryDate) return "green"; // undated documents (e.g. title deed) carry no expiry pressure
  const days = daysUntil(expiryDate, today);
  if (days <= 7) return "red";
  if (days <= 90) return "amber";
  return "green";
}

/** Which of the 90/60/30/7-day alert thresholds this document has just
 * crossed (or is inside), used by the notification scheduler to decide
 * whether to fire an alert on a given day. Returns null once beyond the
 * outermost threshold. */
export function nextAlertThreshold(expiryDate: string | Date, today: Date = new Date()): number | null {
  const days = daysUntil(expiryDate, today);
  // Smallest threshold still >= days remaining, i.e. the most recent
  // 90/60/30/7-day marker the document has crossed. Thresholds are
  // declared descending for readability, so scan ascending here.
  const ascending = [...EXPIRY_ALERT_THRESHOLDS_DAYS].sort((a, b) => a - b);
  for (const t of ascending) {
    if (days <= t) return t;
  }
  return null;
}

function parseOrThrow(input: unknown) {
  const result = documentInputSchema.safeParse(input);
  if (!result.success) {
    throw new ValidationError(result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`));
  }
  return result.data;
}

export async function createDocument(db: AppDb, user: CurrentUser, input: DocumentInput) {
  assertCan(user.role, "document:write");
  const data = parseOrThrow(input);

  const [created] = await db.insert(document).values({
    type: data.type,
    ownerType: data.ownerType,
    propertyId: data.propertyId,
    ownerRecordId: data.ownerRecordId,
    guestId: data.guestId,
    bookingId: data.bookingId,
    referenceNumber: data.referenceNumber,
    issuer: data.issuer,
    issueDate: data.issueDate,
    expiryDate: data.expiryDate,
    fileUrl: data.fileUrl || null,
    uploadedBy: user.id,
  }).returning();

  await writeAudit(db, user, "create", "document", created.id, null, created);
  return created;
}

export async function listDocumentsForProperty(db: AppDb, user: CurrentUser, propertyId: string) {
  assertCan(user.role, "document:read");
  return db.select().from(document).where(and(eq(document.ownerType, "property"), eq(document.propertyId, propertyId)));
}

export interface PropertyComplianceStatus {
  propertyId: string;
  status: TrafficLight;
  permitStatus: "valid" | "expiring_soon" | "expired" | "missing";
  documents: Array<{ id: string; type: string; expiryDate: string | null; light: TrafficLight }>;
}

const LIGHT_SEVERITY: Record<TrafficLight, number> = { green: 0, amber: 1, red: 2 };

/** Aggregates every document on a property into the single traffic-light
 * status shown on the compliance dashboard (spec 4.2) — the worst status
 * among its documents. Also derives permit-specific status, used by the
 * booking-blocking rule (spec 4.2's "blocking rule"). */
export async function propertyComplianceStatus(
  db: AppDb,
  user: CurrentUser,
  propertyId: string,
  today: Date = new Date()
): Promise<PropertyComplianceStatus> {
  assertCan(user.role, "compliance:read");
  const docs = await db.select().from(document).where(and(eq(document.ownerType, "property"), eq(document.propertyId, propertyId)));

  const withLights = docs.map((d) => ({
    id: d.id,
    type: d.type,
    expiryDate: d.expiryDate,
    light: trafficLightForExpiry(d.expiryDate, today),
  }));

  const worst = withLights.reduce<TrafficLight>((acc, d) => (
    LIGHT_SEVERITY[d.light] > LIGHT_SEVERITY[acc] ? d.light : acc
  ), "green");

  const permit = docs.find((d) => d.type === "det_permit");
  let permitStatus: PropertyComplianceStatus["permitStatus"];
  if (!permit) {
    permitStatus = "missing";
  } else if (!permit.expiryDate) {
    permitStatus = "valid";
  } else {
    const days = daysUntil(permit.expiryDate, today);
    permitStatus = days < 0 ? "expired" : days <= 30 ? "expiring_soon" : "valid";
  }

  return {
    propertyId,
    status: permitStatus === "missing" || permitStatus === "expired" ? "red" : worst,
    permitStatus,
    documents: withLights,
  };
}

/** The blocking rule itself: is this property allowed to take a new
 * confirmed booking right now? */
export function permitBlocksBooking(permitStatus: PropertyComplianceStatus["permitStatus"]): boolean {
  return permitStatus === "expired" || permitStatus === "missing";
}

export async function portfolioComplianceOverview(db: AppDb, user: CurrentUser) {
  assertCan(user.role, "compliance:read");
  const properties = await db.select({ id: property.id, name: property.name }).from(property);
  const rows = [];
  for (const p of properties) {
    rows.push(await propertyComplianceStatus(db, user, p.id));
  }
  return rows.map((r, i) => ({ ...r, propertyName: properties[i].name }));
}

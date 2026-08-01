/**
 * Drizzle schema — Phase 1 (core) entities from the specification, section 5.
 *
 * Kept deliberately close to the spec's data model. Fields for Phase 2/3
 * (pricing, payments, work orders, etc.) are intentionally left out — they
 * belong to later phases per the implementation plan.
 */
import {
  pgTable, uuid, text, integer, boolean, timestamp, date, numeric,
  pgEnum, jsonb,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const roleEnum = pgEnum("app_role", [
  "owner", "manager", "finance", "housekeeping", "maintenance", "readonly",
]);

export const propertyStatusEnum = pgEnum("property_status", [
  "active", "inactive", "maintenance", "being_sold",
]);

export const classificationEnum = pgEnum("det_classification", ["standard", "deluxe"]);

export const documentTypeEnum = pgEnum("document_type", [
  "title_deed", "tenancy_contract", "ejari", "landlord_noc", "building_noc",
  "det_permit", "trade_licence", "insurance_policy", "utility_contract",
  "inspection_certificate", "owner_id", "other",
]);

export const documentOwnerTypeEnum = pgEnum("document_owner_type", [
  "property", "owner", "guest", "booking",
]);

export const guestDocumentTypeEnum = pgEnum("guest_document_type", [
  "passport", "emirates_id", "gcc_national_id",
]);

export const bookingStatusEnum = pgEnum("booking_status", [
  "enquiry", "tentative", "confirmed", "checked_in", "checked_out",
  "cancelled", "no_show",
]);

export const complianceTaskTypeEnum = pgEnum("compliance_task_type", [
  "guest_registration", "permit_renewal",
]);

export const complianceTaskStatusEnum = pgEnum("compliance_task_status", [
  "pending", "done", "overdue",
]);

export const appUser = pgTable("app_user", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  role: roleEnum("role").notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
});

export const owner = pgTable("owner", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  idType: text("id_type"),
  idNumber: text("id_number"),
  nationality: text("nationality"),
  mobile: text("mobile"),
  email: text("email"),
  address: text("address"),
  bankDetails: text("bank_details"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
});

export const property = pgTable("property", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  referenceCode: text("reference_code").notNull().unique(),
  name: text("name").notNull(),
  unitNumber: text("unit_number"),
  building: text("building"),
  community: text("community"),
  area: text("area"),
  emirate: text("emirate").notNull().default("Dubai"),
  bedrooms: integer("bedrooms").notNull(),
  bathrooms: integer("bathrooms").notNull(),
  maxOccupancy: integer("max_occupancy").notNull(),
  sizeSqft: numeric("size_sqft"),
  floor: text("floor"),
  view: text("view"),
  furnishingStatus: text("furnishing_status"),
  classification: classificationEnum("classification").notNull().default("standard"),
  status: propertyStatusEnum("status").notNull().default("active"),
  ownerId: uuid("owner_id").references(() => owner.id),
  doorAccessNote: text("door_access_note"),
  wifiNetwork: text("wifi_network"),
  wifiPassword: text("wifi_password"),
  amenities: jsonb("amenities").notNull().default(sql`'[]'::jsonb`),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
});

export const propertyPhoto = pgTable("property_photo", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  propertyId: uuid("property_id").notNull().references(() => property.id, { onDelete: "cascade" }),
  url: text("url").notNull(),
  caption: text("caption"),
  roomTag: text("room_tag"),
  sortOrder: integer("sort_order").notNull().default(0),
  isCover: boolean("is_cover").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
});

export const utilityAccount = pgTable("utility_account", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  propertyId: uuid("property_id").notNull().references(() => property.id, { onDelete: "cascade" }),
  type: text("type").notNull(), // dewa | district_cooling | internet | gas | service_charge | insurance
  provider: text("provider"),
  accountNumber: text("account_number"),
  premiseNumber: text("premise_number"),
  billingCycle: text("billing_cycle"),
  avgMonthlyCost: numeric("avg_monthly_cost"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
});

export const document = pgTable("document", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  type: documentTypeEnum("type").notNull(),
  ownerType: documentOwnerTypeEnum("owner_type").notNull(),
  propertyId: uuid("property_id").references(() => property.id, { onDelete: "cascade" }),
  ownerRecordId: uuid("owner_record_id").references(() => owner.id, { onDelete: "cascade" }),
  guestId: uuid("guest_id"),
  bookingId: uuid("booking_id"),
  referenceNumber: text("reference_number"),
  issuer: text("issuer"),
  issueDate: date("issue_date"),
  expiryDate: date("expiry_date"),
  fileUrl: text("file_url"),
  uploadedBy: uuid("uploaded_by").references(() => appUser.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
});

export const guest = pgTable("guest", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  fullName: text("full_name").notNull(),
  nationality: text("nationality"),
  dob: date("dob"),
  gender: text("gender"),
  documentType: guestDocumentTypeEnum("document_type"),
  documentNumber: text("document_number"),
  documentIssuingCountry: text("document_issuing_country"),
  documentExpiry: date("document_expiry"),
  documentFileUrl: text("document_file_url"),
  mobile: text("mobile"),
  email: text("email"),
  whatsapp: text("whatsapp"),
  address: text("address"),
  notes: text("notes"),
  verified: boolean("verified").notNull().default(false),
  vip: boolean("vip").notNull().default(false),
  blocked: boolean("blocked").notNull().default(false),
  blockedReason: text("blocked_reason"),
  consentGivenAt: timestamp("consent_given_at", { withTimezone: true }),
  consentVersion: text("consent_version"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
});

export const booking = pgTable("booking", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  bookingNumber: text("booking_number").notNull().unique(),
  propertyId: uuid("property_id").notNull().references(() => property.id),
  leadGuestId: uuid("lead_guest_id").notNull().references(() => guest.id),
  sourceChannel: text("source_channel").notNull().default("direct"),
  checkIn: date("check_in").notNull(),
  checkOut: date("check_out").notNull(),
  adults: integer("adults").notNull().default(1),
  children: integer("children").notNull().default(0),
  infants: integer("infants").notNull().default(0),
  occupiedBedrooms: integer("occupied_bedrooms").notNull().default(1),
  status: bookingStatusEnum("status").notNull().default("enquiry"),
  holdExpiresAt: timestamp("hold_expires_at", { withTimezone: true }),
  detRegistrationStatus: text("det_registration_status").notNull().default("not_required"),
  notes: text("notes"),
  complianceOverrideBy: uuid("compliance_override_by").references(() => appUser.id),
  complianceOverrideReason: text("compliance_override_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
});

export const bookingOccupant = pgTable("booking_occupant", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  bookingId: uuid("booking_id").notNull().references(() => booking.id, { onDelete: "cascade" }),
  guestId: uuid("guest_id").notNull().references(() => guest.id),
  isLead: boolean("is_lead").notNull().default(false),
  detSubmissionStatus: text("det_submission_status").notNull().default("pending"),
});

export const complianceTask = pgTable("compliance_task", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  type: complianceTaskTypeEnum("type").notNull(),
  propertyId: uuid("property_id").references(() => property.id, { onDelete: "cascade" }),
  bookingId: uuid("booking_id").references(() => booking.id, { onDelete: "cascade" }),
  dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
  status: complianceTaskStatusEnum("status").notNull().default("pending"),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  reference: text("reference"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
});

export const auditLog = pgTable("audit_log", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  actorId: uuid("actor_id"),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id"),
  before: jsonb("before"),
  after: jsonb("after"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
});

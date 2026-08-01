import { z } from "zod";

export const propertyInputSchema = z.object({
  referenceCode: z.string().min(1, "Reference code is required"),
  name: z.string().min(1, "Name is required"),
  unitNumber: z.string().optional(),
  building: z.string().optional(),
  community: z.string().optional(),
  area: z.string().optional(),
  emirate: z.string().min(1).default("Dubai"),
  bedrooms: z.number().int().min(0, "Bedrooms cannot be negative"),
  bathrooms: z.number().int().min(0, "Bathrooms cannot be negative"),
  maxOccupancy: z.number().int().min(1, "Maximum occupancy must be at least 1"),
  sizeSqft: z.number().positive().optional(),
  floor: z.string().optional(),
  view: z.string().optional(),
  furnishingStatus: z.string().optional(),
  classification: z.enum(["standard", "deluxe"]).default("standard"),
  status: z.enum(["active", "inactive", "maintenance", "being_sold"]).default("active"),
  ownerId: z.string().uuid().optional(),
  doorAccessNote: z.string().optional(),
  wifiNetwork: z.string().optional(),
  wifiPassword: z.string().optional(),
  amenities: z.array(z.string()).default([]),
});
export type PropertyInput = z.infer<typeof propertyInputSchema>;

export const ownerInputSchema = z.object({
  name: z.string().min(1, "Owner name is required"),
  idType: z.string().optional(),
  idNumber: z.string().optional(),
  nationality: z.string().optional(),
  mobile: z.string().optional(),
  email: z.string().email().optional().or(z.literal("")),
  address: z.string().optional(),
  bankDetails: z.string().optional(),
});
export type OwnerInput = z.infer<typeof ownerInputSchema>;

export const documentInputSchema = z.object({
  type: z.enum([
    "title_deed", "tenancy_contract", "ejari", "landlord_noc", "building_noc",
    "det_permit", "trade_licence", "insurance_policy", "utility_contract",
    "inspection_certificate", "owner_id", "other",
  ]),
  ownerType: z.enum(["property", "owner", "guest", "booking"]),
  propertyId: z.string().uuid().optional(),
  ownerRecordId: z.string().uuid().optional(),
  guestId: z.string().uuid().optional(),
  bookingId: z.string().uuid().optional(),
  referenceNumber: z.string().optional(),
  issuer: z.string().optional(),
  issueDate: z.string().optional(), // ISO date
  expiryDate: z.string().optional(), // ISO date
  fileUrl: z.string().url().optional().or(z.literal("")),
}).refine(
  (d) => {
    if (d.ownerType === "property") return !!d.propertyId;
    if (d.ownerType === "owner") return !!d.ownerRecordId;
    if (d.ownerType === "guest") return !!d.guestId;
    if (d.ownerType === "booking") return !!d.bookingId;
    return false;
  },
  { message: "A document must be linked to the matching record for its owner type" }
);
export type DocumentInput = z.infer<typeof documentInputSchema>;

export const guestInputSchema = z.object({
  fullName: z.string().min(1, "Full name is required"),
  nationality: z.string().optional(),
  dob: z.string().optional(),
  gender: z.string().optional(),
  documentType: z.enum(["passport", "emirates_id", "gcc_national_id"]).optional(),
  documentNumber: z.string().optional(),
  documentIssuingCountry: z.string().optional(),
  documentExpiry: z.string().optional(),
  documentFileUrl: z.string().url().optional().or(z.literal("")),
  mobile: z.string().min(1, "Mobile number is required"),
  email: z.string().email("Enter a valid email").optional().or(z.literal("")),
  whatsapp: z.string().optional(),
  address: z.string().optional(),
  notes: z.string().optional(),
});
export type GuestInput = z.infer<typeof guestInputSchema>;

export const bookingInputSchema = z.object({
  propertyId: z.string().uuid(),
  leadGuestId: z.string().uuid(),
  additionalGuestIds: z.array(z.string().uuid()).default([]),
  sourceChannel: z.string().default("direct"),
  checkIn: z.string(), // ISO date, e.g. 2026-08-10
  checkOut: z.string(),
  adults: z.number().int().min(0).default(1),
  children: z.number().int().min(0).default(0),
  infants: z.number().int().min(0).default(0),
  occupiedBedrooms: z.number().int().min(1).default(1),
  notes: z.string().optional(),
}).refine((b) => b.checkOut > b.checkIn, {
  message: "Check-out must be after check-in",
  path: ["checkOut"],
});
export type BookingInput = z.infer<typeof bookingInputSchema>;

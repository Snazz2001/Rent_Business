import { eq } from "drizzle-orm";
import { z } from "zod";
import type { AppDb } from "./types";
import { utilityAccount } from "../../db/schema";
import { assertCan, type CurrentUser } from "../authz";
import { ValidationError } from "./propertyService";

export const UTILITY_TYPES = ["dewa", "district_cooling", "internet", "gas", "service_charge", "insurance"] as const;

const utilityInputSchema = z.object({
  propertyId: z.string().uuid(),
  type: z.enum(UTILITY_TYPES),
  provider: z.string().optional(),
  accountNumber: z.string().optional(),
  premiseNumber: z.string().optional(),
  billingCycle: z.string().optional(),
  avgMonthlyCost: z.number().nonnegative().optional(),
  notes: z.string().optional(),
});
export type UtilityInput = z.infer<typeof utilityInputSchema>;

export async function createUtilityAccount(db: AppDb, user: CurrentUser, input: UtilityInput) {
  assertCan(user.role, "property:write");
  const result = utilityInputSchema.safeParse(input);
  if (!result.success) {
    throw new ValidationError(result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`));
  }
  const data = result.data;
  const [created] = await db.insert(utilityAccount).values({
    propertyId: data.propertyId,
    type: data.type,
    provider: data.provider,
    accountNumber: data.accountNumber,
    premiseNumber: data.premiseNumber,
    billingCycle: data.billingCycle,
    avgMonthlyCost: data.avgMonthlyCost?.toString(),
    notes: data.notes,
  }).returning();
  return created;
}

export async function listUtilityAccounts(db: AppDb, user: CurrentUser, propertyId: string) {
  assertCan(user.role, "property:read");
  return db.select().from(utilityAccount).where(eq(utilityAccount.propertyId, propertyId));
}

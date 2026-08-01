import { createTestDb } from "./db/client.ts";
import { property } from "./db/schema.ts";

const db = await createTestDb();
const [p] = await db.insert(property).values({
  referenceCode: "P-001",
  name: "Marina Loft",
  bedrooms: 2,
  bathrooms: 2,
  maxOccupancy: 4,
}).returning();
console.log("inserted:", p.id, p.referenceCode, p.status, p.classification);

const rows = await db.select().from(property);
console.log("count:", rows.length);

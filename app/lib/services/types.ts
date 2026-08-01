import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { PgliteDatabase } from "drizzle-orm/pglite";
import type * as schema from "../../db/schema";

/** Either backend, indistinguishable to service code — see db/client.ts. */
export type AppDb = NodePgDatabase<typeof schema> | PgliteDatabase<typeof schema>;

import type { AppDb } from "./types";
import { auditLog } from "../../db/schema";
import type { CurrentUser } from "../authz";

/** Best-effort audit write. Per spec section 6.4, every sensitive action
 * (price change, deposit refund, document/identity access) must leave a
 * trail. Failures here are logged but never block the primary operation —
 * losing an audit row is bad, but blocking a guest check-in over it would
 * be worse. */
export async function writeAudit(
  db: AppDb,
  user: CurrentUser,
  action: string,
  entityType: string,
  entityId: string | null,
  before: unknown,
  after: unknown
) {
  try {
    await db.insert(auditLog).values({
      actorId: user.id,
      action,
      entityType,
      entityId,
      before: before === undefined ? null : (before as object),
      after: after === undefined ? null : (after as object),
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("audit log write failed", { action, entityType, entityId, err });
  }
}

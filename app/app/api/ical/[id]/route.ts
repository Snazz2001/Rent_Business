import { NextResponse } from "next/server";
import { getDb } from "../../../../db/client";
import { getSession } from "../../../../lib/session";
import { icalExportForProperty } from "../../../../lib/services/bookingService";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Route handlers can't use next/navigation's redirect() the way pages
  // can — return a plain 401 instead of a redirect for API consumers
  // (e.g. a channel manager's iCal importer), which is also the more
  // correct HTTP semantics for an unauthenticated feed request.
  const user = await getSession();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const db = await getDb();
  const ics = await icalExportForProperty(db, user, id);
  return new NextResponse(ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="${id}.ics"`,
    },
  });
}

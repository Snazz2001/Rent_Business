import { redirect } from "next/navigation";
import { getDb } from "../../db/client";
import { requireUser } from "../../lib/requireUser";
import { listProperties } from "../../lib/services/propertyService";
import { listGuests } from "../../lib/services/guestService";
import {
  createBooking, confirmBooking, updateBookingStatus, listAllBookings,
  ComplianceBlockedError, BookingOverlapError,
} from "../../lib/services/bookingService";
import { ValidationError } from "../../lib/services/propertyService";
import { ForbiddenError, can } from "../../lib/authz";
import { buildCalendarGrid, dateRange } from "../../lib/calendarGrid";

const CALENDAR_DAYS = 21;

async function createBookingAction(formData: FormData) {
  "use server";
  const user = await requireUser();
  const db = await getDb();
  try {
    await createBooking(db, user, {
      propertyId: String(formData.get("propertyId") ?? ""),
      leadGuestId: String(formData.get("leadGuestId") ?? ""),
      checkIn: String(formData.get("checkIn") ?? ""),
      checkOut: String(formData.get("checkOut") ?? ""),
      adults: Number(formData.get("adults") ?? 1),
      children: Number(formData.get("children") ?? 0),
      occupiedBedrooms: Number(formData.get("occupiedBedrooms") ?? 1),
      sourceChannel: String(formData.get("sourceChannel") ?? "direct"),
      additionalGuestIds: [],
    } as any);
  } catch (err) {
    if (err instanceof ValidationError) redirect(`/bookings?error=${encodeURIComponent(err.message)}`);
    if (err instanceof ForbiddenError) redirect(`/bookings?error=${encodeURIComponent("You do not have permission to create bookings.")}`);
    throw err;
  }
  redirect("/bookings");
}

async function confirmAction(bookingId: string) {
  "use server";
  const user = await requireUser();
  const db = await getDb();
  try {
    await confirmBooking(db, user, bookingId);
  } catch (err) {
    if (err instanceof ComplianceBlockedError) {
      redirect(`/bookings?error=${encodeURIComponent(err.message + " Use \"Override and confirm\" below if you are authorised to proceed anyway.")}`);
    }
    if (err instanceof BookingOverlapError) redirect(`/bookings?error=${encodeURIComponent(err.message)}`);
    if (err instanceof ForbiddenError) redirect(`/bookings?error=${encodeURIComponent(err.message)}`);
    throw err;
  }
  redirect("/bookings");
}

async function overrideConfirmAction(bookingId: string, formData: FormData) {
  "use server";
  const user = await requireUser();
  const db = await getDb();
  const reason = String(formData.get("reason") ?? "");
  try {
    await confirmBooking(db, user, bookingId, { override: true, overrideReason: reason });
  } catch (err) {
    if (err instanceof ValidationError) redirect(`/bookings?error=${encodeURIComponent(err.message)}`);
    if (err instanceof ForbiddenError) redirect(`/bookings?error=${encodeURIComponent(err.message)}`);
    if (err instanceof BookingOverlapError) redirect(`/bookings?error=${encodeURIComponent(err.message)}`);
    throw err;
  }
  redirect("/bookings");
}

async function statusAction(bookingId: string, status: "tentative" | "checked_in" | "checked_out" | "cancelled" | "no_show") {
  "use server";
  const user = await requireUser();
  const db = await getDb();
  try {
    await updateBookingStatus(db, user, bookingId, status);
  } catch (err) {
    if (err instanceof Error) redirect(`/bookings?error=${encodeURIComponent(err.message)}`);
    throw err;
  }
  redirect("/bookings");
}

export default async function BookingsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; guestId?: string }>;
}) {
  const user = await requireUser();
  const { error, guestId } = await searchParams;
  const db = await getDb();

  const [properties, guests, bookings] = await Promise.all([
    listProperties(db, user),
    can(user.role, "guest:read") ? listGuests(db, user) : Promise.resolve([]),
    listAllBookings(db, user),
  ]);

  const days = dateRange(new Date(), CALENDAR_DAYS);
  const grid = buildCalendarGrid(properties.map((p) => p.id), days, bookings);
  const todayStr = days[0];

  const propertyById = Object.fromEntries(properties.map((p) => [p.id, p]));
  const guestById = Object.fromEntries(guests.map((g) => [g.id, g]));
  const canWrite = can(user.role, "booking:write");
  const canOverride = can(user.role, "booking:override_compliance");

  return (
    <div>
      <h1>Bookings</h1>
      <p className="subtitle">Next {CALENDAR_DAYS} days, all properties.</p>
      {error && <div className="error-box">{error}</div>}

      <div className="card" style={{ overflowX: "auto" }}>
        <table className="calendar">
          <thead>
            <tr>
              <th className="propcol">Property</th>
              {days.map((d) => <th key={d}>{d.slice(8, 10)}</th>)}
            </tr>
          </thead>
          <tbody>
            {properties.map((p) => (
              <tr key={p.id}>
                <td className="propcol">{p.referenceCode}</td>
                {days.map((d) => {
                  const cell = grid[p.id]?.[d];
                  const cls = cell?.state === "occupied" ? "occ" : cell?.state === "tentative" ? "tentative" : "";
                  return <td key={d} className={`${cls} ${d === todayStr ? "today" : ""}`}>{cell?.state === "occupied" ? "●" : cell?.state === "tentative" ? "?" : ""}</td>;
                })}
              </tr>
            ))}
            {properties.length === 0 && (
              <tr><td colSpan={CALENDAR_DAYS + 1} style={{ color: "#888" }}>Add a property first.</td></tr>
            )}
          </tbody>
        </table>
        <p className="hint">● confirmed / checked-in &nbsp; ? tentative hold &nbsp; blank = free</p>
      </div>

      <h2>All bookings</h2>
      <table>
        <thead>
          <tr><th>Booking #</th><th>Property</th><th>Guest</th><th>Dates</th><th>Party</th><th>Status</th><th>Actions</th></tr>
        </thead>
        <tbody>
          {bookings.map((b) => (
            <tr key={b.id}>
              <td>{b.bookingNumber}</td>
              <td>{propertyById[b.propertyId]?.referenceCode ?? "—"}</td>
              <td>{guestById[b.leadGuestId]?.fullName ?? "—"}</td>
              <td>{b.checkIn} → {b.checkOut}</td>
              <td>{b.adults + b.children}</td>
              <td>{b.status}</td>
              <td>
                {canWrite && (
                  <div className="actions">
                    {b.status === "enquiry" && (
                      <form action={statusAction.bind(null, b.id, "tentative")}><button className="secondary" type="submit">Hold</button></form>
                    )}
                    {(b.status === "enquiry" || b.status === "tentative") && (
                      <form action={confirmAction.bind(null, b.id)}><button className="primary" type="submit">Confirm</button></form>
                    )}
                    {b.status === "confirmed" && (
                      <form action={statusAction.bind(null, b.id, "checked_in")}><button className="secondary" type="submit">Check in</button></form>
                    )}
                    {b.status === "checked_in" && (
                      <form action={statusAction.bind(null, b.id, "checked_out")}><button className="secondary" type="submit">Check out</button></form>
                    )}
                    {["enquiry", "tentative", "confirmed"].includes(b.status) && (
                      <form action={statusAction.bind(null, b.id, "cancelled")}><button className="danger" type="submit">Cancel</button></form>
                    )}
                  </div>
                )}
                {canOverride && (b.status === "enquiry" || b.status === "tentative") && (
                  <details style={{ marginTop: "0.4rem" }}>
                    <summary style={{ cursor: "pointer", fontSize: "0.8rem" }}>Override and confirm</summary>
                    <form action={overrideConfirmAction.bind(null, b.id)} style={{ marginTop: "0.4rem" }}>
                      <input name="reason" placeholder="Reason for override (required)" style={{ marginBottom: "0.4rem" }} />
                      <button className="secondary" type="submit">Confirm anyway</button>
                    </form>
                  </details>
                )}
              </td>
            </tr>
          ))}
          {bookings.length === 0 && (
            <tr><td colSpan={7} style={{ color: "#888" }}>No bookings yet.</td></tr>
          )}
        </tbody>
      </table>

      {canWrite && (
        <div className="card" style={{ marginTop: "1.5rem" }}>
          <h2 style={{ marginTop: 0 }}>Create a booking</h2>
          <form className="stack" action={createBookingAction}>
            <div className="row">
              <div>
                <label htmlFor="propertyId">Property</label>
                <select id="propertyId" name="propertyId" required>
                  {properties.map((p) => <option key={p.id} value={p.id}>{p.referenceCode} — {p.name}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="leadGuestId">Lead guest</label>
                <select id="leadGuestId" name="leadGuestId" required defaultValue={guestId ?? ""}>
                  <option value="" disabled>— select a guest —</option>
                  {guests.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.fullName}{g.mobile ? ` — ${g.mobile}` : ""}{g.blocked ? " (BLOCKED)" : ""}
                    </option>
                  ))}
                </select>
                <p className="hint"><a href="/guests">Search guests</a> to find a returning guest by name, mobile, or email.</p>
              </div>
            </div>
            <div className="row">
              <div>
                <label htmlFor="checkIn">Check-in</label>
                <input id="checkIn" name="checkIn" type="date" required />
              </div>
              <div>
                <label htmlFor="checkOut">Check-out</label>
                <input id="checkOut" name="checkOut" type="date" required />
              </div>
            </div>
            <div className="row">
              <div>
                <label htmlFor="adults">Adults</label>
                <input id="adults" name="adults" type="number" min={0} defaultValue={2} />
              </div>
              <div>
                <label htmlFor="children">Children</label>
                <input id="children" name="children" type="number" min={0} defaultValue={0} />
              </div>
              <div>
                <label htmlFor="occupiedBedrooms">Occupied bedrooms</label>
                <input id="occupiedBedrooms" name="occupiedBedrooms" type="number" min={1} defaultValue={1} />
                <p className="hint">Drives Tourism Dirham — see spec 3.1</p>
              </div>
            </div>
            <div>
              <label htmlFor="sourceChannel">Source</label>
              <select id="sourceChannel" name="sourceChannel" defaultValue="direct">
                <option value="direct">Direct</option>
                <option value="airbnb">Airbnb</option>
                <option value="booking.com">Booking.com</option>
                <option value="other">Other</option>
              </select>
            </div>
            {guests.length === 0 && <p className="hint">Add a guest first before creating a booking.</p>}
            <button className="primary" type="submit" disabled={guests.length === 0 || properties.length === 0}>Create booking</button>
          </form>
        </div>
      )}
    </div>
  );
}

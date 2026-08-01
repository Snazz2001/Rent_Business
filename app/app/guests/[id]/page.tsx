import { notFound } from "next/navigation";
import { getDb } from "../../../db/client";
import { requireUser } from "../../../lib/requireUser";
import { getGuest, guestBookingHistory } from "../../../lib/services/guestService";
import { can } from "../../../lib/authz";
import { toIsoDateLocal } from "../../../lib/calendarGrid";

export default async function GuestDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const db = await getDb();
  const guest = await getGuest(db, user, id);
  if (!guest) notFound();
  const bookings = await guestBookingHistory(db, user, id);
  const seesIdentity = can(user.role, "guest:read_identity");
  const canBook = can(user.role, "booking:write");

  // Split into "still to come" (checkout hasn't happened yet — covers
  // upcoming and currently in-house stays) vs "previous stays" (checked
  // out, or the checkout date has already passed), so front-desk staff can
  // answer "does this guest have anything booked?" and "what did they book
  // before?" without scanning one long mixed table.
  const todayStr = toIsoDateLocal(new Date());
  const upcomingBookings = bookings.filter((b) => b.checkOut >= todayStr);
  const pastBookings = bookings.filter((b) => b.checkOut < todayStr);

  return (
    <div>
      <p><a href="/guests">&larr; All guests</a></p>
      <h1>{guest.fullName}</h1>
      <p className="subtitle">
        {guest.mobile ?? "no mobile"} · {guest.email ?? "no email"} · {guest.nationality ?? "nationality unknown"}
        {guest.blocked && <span className="badge red" style={{ marginLeft: "0.5rem" }}>BLOCKED</span>}
        {guest.vip && !guest.blocked && <span className="badge amber" style={{ marginLeft: "0.5rem" }}>VIP</span>}
      </p>

      {canBook && !guest.blocked && (
        <p><a href={`/bookings?guestId=${id}`} className="secondary" style={{ padding: "0.4rem 0.8rem", textDecoration: "none" }}>
          + Create a new booking for {guest.fullName}
        </a></p>
      )}

      {seesIdentity && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Identity document</h2>
          <p>{guest.documentType ? `${guest.documentType.replace("_", " ")} — ${guest.documentNumber ?? "no number on file"}` : "No document on file yet."}</p>
          {guest.documentExpiry && <p className="hint">Expires {guest.documentExpiry}</p>}
        </div>
      )}

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Upcoming &amp; current bookings</h2>
        <table>
          <thead><tr><th>Booking #</th><th>Property</th><th>Check-in</th><th>Check-out</th><th>Status</th></tr></thead>
          <tbody>
            {upcomingBookings.map((b) => (
              <tr key={b.id}>
                <td>{b.bookingNumber}</td>
                <td>{b.propertyReferenceCode ? `${b.propertyReferenceCode} — ${b.propertyName}` : "—"}</td>
                <td>{b.checkIn}</td>
                <td>{b.checkOut}</td>
                <td>{b.status}</td>
              </tr>
            ))}
            {upcomingBookings.length === 0 && (
              <tr><td colSpan={5} style={{ color: "#888" }}>Nothing booked yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Previous stays</h2>
        <table>
          <thead><tr><th>Booking #</th><th>Property</th><th>Check-in</th><th>Check-out</th><th>Status</th></tr></thead>
          <tbody>
            {pastBookings.map((b) => (
              <tr key={b.id}>
                <td>{b.bookingNumber}</td>
                <td>{b.propertyReferenceCode ? `${b.propertyReferenceCode} — ${b.propertyName}` : "—"}</td>
                <td>{b.checkIn}</td>
                <td>{b.checkOut}</td>
                <td>{b.status}</td>
              </tr>
            ))}
            {pastBookings.length === 0 && (
              <tr><td colSpan={5} style={{ color: "#888" }}>No previous stays on file.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

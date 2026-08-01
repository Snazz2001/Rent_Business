import { redirect } from "next/navigation";
import { getDb } from "../../db/client";
import { requireUser } from "../../lib/requireUser";
import { createGuest, listGuests } from "../../lib/services/guestService";
import { can } from "../../lib/authz";
import { ValidationError } from "../../lib/services/propertyService";
import { ForbiddenError } from "../../lib/authz";

async function createGuestAction(formData: FormData) {
  "use server";
  const user = await requireUser();
  const db = await getDb();
  try {
    await createGuest(db, user, {
      fullName: String(formData.get("fullName") ?? ""),
      mobile: String(formData.get("mobile") ?? ""),
      email: String(formData.get("email") ?? "") || undefined,
      nationality: String(formData.get("nationality") ?? "") || undefined,
      documentType: (String(formData.get("documentType") ?? "") || undefined) as any,
      documentNumber: String(formData.get("documentNumber") ?? "") || undefined,
      documentExpiry: String(formData.get("documentExpiry") ?? "") || undefined,
    } as any, "v1");
  } catch (err) {
    if (err instanceof ValidationError) {
      redirect(`/guests?error=${encodeURIComponent(err.message)}`);
    }
    if (err instanceof ForbiddenError) {
      redirect(`/guests?error=${encodeURIComponent("You do not have permission to add guests.")}`);
    }
    throw err;
  }
  redirect("/guests");
}

export default async function GuestsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; q?: string }>;
}) {
  const user = await requireUser();
  const { error, q } = await searchParams;
  const db = await getDb();
  const guests = await listGuests(db, user, q);
  const seesIdentity = can(user.role, "guest:read_identity");

  return (
    <div>
      <h1>Guests</h1>
      <p className="subtitle">
        {guests.length} guest{guests.length === 1 ? "" : "s"}{q ? ` matching "${q}"` : " on file"}.
      </p>
      {error && <div className="error-box">{error}</div>}

      <form method="GET" className="row" style={{ maxWidth: 480, marginBottom: "1rem" }}>
        <div>
          <label htmlFor="q">Search by name, mobile, or email{seesIdentity ? ", or ID number" : ""}</label>
          <input id="q" name="q" defaultValue={q ?? ""} placeholder="e.g. +9715, alice@, or Alice" />
        </div>
        <button className="secondary" type="submit" style={{ alignSelf: "flex-end" }}>Search</button>
        {q && <a href="/guests" className="secondary" style={{ alignSelf: "flex-end", padding: "0.4rem 0.8rem", textDecoration: "none" }}>Clear</a>}
      </form>

      <table>
        <thead>
          <tr>
            <th>Name</th><th>Mobile</th><th>Email</th>
            {seesIdentity && <th>ID document</th>}
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {guests.map((g) => (
            <tr key={g.id}>
              <td><a href={`/guests/${g.id}`}>{g.fullName}</a></td>
              <td>{g.mobile ?? "—"}</td>
              <td>{g.email ?? "—"}</td>
              {seesIdentity && <td>{g.documentType ? `${g.documentType} ${g.documentNumber ?? ""}` : "—"}</td>}
              <td>
                {g.blocked && <span className="badge red">BLOCKED</span>}
                {!g.blocked && g.vip && <span className="badge amber">VIP</span>}
                {!g.blocked && !g.vip && <span className="badge grey">OK</span>}
              </td>
            </tr>
          ))}
          {guests.length === 0 && (
            <tr><td colSpan={seesIdentity ? 5 : 4} style={{ color: "#888" }}>No guests yet — add the first one below.</td></tr>
          )}
        </tbody>
      </table>

      {can(user.role, "guest:write") && (
        <div className="card" style={{ marginTop: "1.5rem" }}>
          <h2 style={{ marginTop: 0 }}>Add a guest</h2>
          <form className="stack" action={createGuestAction}>
            <div className="row">
              <div>
                <label htmlFor="fullName">Full name (as on travel document)</label>
                <input id="fullName" name="fullName" required />
              </div>
              <div>
                <label htmlFor="mobile">Mobile</label>
                <input id="mobile" name="mobile" required placeholder="+971500000000" />
              </div>
            </div>
            <div className="row">
              <div>
                <label htmlFor="email">Email</label>
                <input id="email" name="email" type="email" />
              </div>
              <div>
                <label htmlFor="nationality">Nationality</label>
                <input id="nationality" name="nationality" />
              </div>
            </div>
            <div className="row">
              <div>
                <label htmlFor="documentType">ID document type</label>
                <select id="documentType" name="documentType" defaultValue="">
                  <option value="">— none yet —</option>
                  <option value="passport">Passport</option>
                  <option value="emirates_id">Emirates ID</option>
                  <option value="gcc_national_id">GCC national ID</option>
                </select>
              </div>
              <div>
                <label htmlFor="documentNumber">Document number</label>
                <input id="documentNumber" name="documentNumber" />
              </div>
              <div>
                <label htmlFor="documentExpiry">Document expiry</label>
                <input id="documentExpiry" name="documentExpiry" type="date" />
              </div>
            </div>
            <button className="primary" type="submit">Add guest</button>
          </form>
        </div>
      )}
    </div>
  );
}

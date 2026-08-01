import { redirect } from "next/navigation";
import { getDb } from "../../db/client";
import { requireUser } from "../../lib/requireUser";
import { createProperty, listProperties } from "../../lib/services/propertyService";
import { can } from "../../lib/authz";
import { ValidationError } from "../../lib/services/propertyService";
import { ForbiddenError } from "../../lib/authz";

async function createPropertyAction(formData: FormData) {
  "use server";
  const user = await requireUser();
  const db = await getDb();
  try {
    await createProperty(db, user, {
      referenceCode: String(formData.get("referenceCode") ?? ""),
      name: String(formData.get("name") ?? ""),
      unitNumber: String(formData.get("unitNumber") ?? "") || undefined,
      building: String(formData.get("building") ?? "") || undefined,
      community: String(formData.get("community") ?? "") || undefined,
      area: String(formData.get("area") ?? "") || undefined,
      emirate: String(formData.get("emirate") ?? "Dubai"),
      bedrooms: Number(formData.get("bedrooms") ?? 0),
      bathrooms: Number(formData.get("bathrooms") ?? 0),
      maxOccupancy: Number(formData.get("maxOccupancy") ?? 1),
      classification: (String(formData.get("classification") ?? "standard") as "standard" | "deluxe"),
      status: "active",
      amenities: [],
    } as any);
  } catch (err) {
    if (err instanceof ValidationError) {
      redirect(`/properties?error=${encodeURIComponent(err.message)}`);
    }
    if (err instanceof ForbiddenError) {
      redirect(`/properties?error=${encodeURIComponent("You do not have permission to add properties.")}`);
    }
    throw err;
  }
  redirect("/properties");
}

export default async function PropertiesPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; deleted?: string }>;
}) {
  const user = await requireUser();
  const { error, deleted } = await searchParams;
  const db = await getDb();
  const properties = await listProperties(db, user);

  return (
    <div>
      <h1>Properties</h1>
      <p className="subtitle">{properties.length} propert{properties.length === 1 ? "y" : "ies"} in the portfolio.</p>

      {error && <div className="error-box">{error}</div>}
      {deleted && <p className="hint" style={{ marginTop: "-0.5rem", marginBottom: "1rem" }}>Property {deleted} was deleted.</p>}

      <table>
        <thead>
          <tr>
            <th>Reference</th><th>Name</th><th>Unit #</th><th>Building</th><th>Area</th><th>Bed / Bath</th>
            <th>Max occ.</th><th>Class</th><th>Status</th>
          </tr>
        </thead>
        <tbody>
          {properties.map((p) => (
            <tr key={p.id}>
              <td><a href={`/properties/${p.id}`}>{p.referenceCode}</a></td>
              <td>{p.name}</td>
              <td>{p.unitNumber ?? "—"}</td>
              <td>{p.building ?? "—"}</td>
              <td>{p.area ?? "—"}</td>
              <td>{p.bedrooms} / {p.bathrooms}</td>
              <td>{p.maxOccupancy}</td>
              <td>{p.classification}</td>
              <td>{p.status}</td>
            </tr>
          ))}
          {properties.length === 0 && (
            <tr><td colSpan={9} style={{ color: "#888" }}>No properties yet — add the first one below.</td></tr>
          )}
        </tbody>
      </table>

      {can(user.role, "property:write") && (
        <div className="card" style={{ marginTop: "1.5rem" }}>
          <h2 style={{ marginTop: 0 }}>Add a property</h2>
          <form className="stack" action={createPropertyAction}>
            <div className="row">
              <div>
                <label htmlFor="referenceCode">Reference code</label>
                <input id="referenceCode" name="referenceCode" required placeholder="P-001" />
              </div>
              <div>
                <label htmlFor="name">Name</label>
                <input id="name" name="name" required placeholder="Marina Loft" />
              </div>
            </div>
            <div className="row">
              <div>
                <label htmlFor="unitNumber">Unit / room number</label>
                <input id="unitNumber" name="unitNumber" placeholder="e.g. 1502 or Room 3" />
              </div>
              <div>
                <label htmlFor="building">Building</label>
                <input id="building" name="building" />
              </div>
              <div>
                <label htmlFor="community">Community</label>
                <input id="community" name="community" />
              </div>
              <div>
                <label htmlFor="area">Area</label>
                <input id="area" name="area" placeholder="Dubai Marina" />
              </div>
            </div>
            <div className="row">
              <div>
                <label htmlFor="bedrooms">Bedrooms</label>
                <input id="bedrooms" name="bedrooms" type="number" min={0} required defaultValue={1} />
              </div>
              <div>
                <label htmlFor="bathrooms">Bathrooms</label>
                <input id="bathrooms" name="bathrooms" type="number" min={0} required defaultValue={1} />
              </div>
              <div>
                <label htmlFor="maxOccupancy">Max occupancy</label>
                <input id="maxOccupancy" name="maxOccupancy" type="number" min={1} required defaultValue={2} />
              </div>
            </div>
            <div className="row">
              <div>
                <label htmlFor="classification">DET classification</label>
                <select id="classification" name="classification" defaultValue="standard">
                  <option value="standard">Standard</option>
                  <option value="deluxe">Deluxe</option>
                </select>
              </div>
              <div>
                <label htmlFor="emirate">Emirate</label>
                <input id="emirate" name="emirate" defaultValue="Dubai" />
              </div>
            </div>
            <button className="primary" type="submit">Add property</button>
          </form>
        </div>
      )}
    </div>
  );
}

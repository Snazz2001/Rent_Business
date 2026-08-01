import { notFound, redirect } from "next/navigation";
import { getDb } from "../../../db/client";
import { requireUser } from "../../../lib/requireUser";
import { getProperty, updateProperty, deleteProperty } from "../../../lib/services/propertyService";
import { createDocument, listDocumentsForProperty, propertyComplianceStatus, trafficLightForExpiry } from "../../../lib/services/documentService";
import { createUtilityAccount, listUtilityAccounts, UTILITY_TYPES } from "../../../lib/services/utilityService";
import { can, ForbiddenError } from "../../../lib/authz";
import { ValidationError } from "../../../lib/services/propertyService";

const DOCUMENT_TYPES = [
  "title_deed", "tenancy_contract", "ejari", "landlord_noc", "building_noc",
  "det_permit", "trade_licence", "insurance_policy", "utility_contract",
  "inspection_certificate", "owner_id", "other",
] as const;

async function addDocumentAction(propertyId: string, formData: FormData) {
  "use server";
  const user = await requireUser();
  const db = await getDb();
  try {
    await createDocument(db, user, {
      type: formData.get("type"),
      ownerType: "property",
      propertyId,
      referenceNumber: String(formData.get("referenceNumber") ?? "") || undefined,
      issuer: String(formData.get("issuer") ?? "") || undefined,
      issueDate: String(formData.get("issueDate") ?? "") || undefined,
      expiryDate: String(formData.get("expiryDate") ?? "") || undefined,
      fileUrl: String(formData.get("fileUrl") ?? "") || undefined,
    } as any);
  } catch (err) {
    if (err instanceof ValidationError) {
      redirect(`/properties/${propertyId}?error=${encodeURIComponent(err.message)}`);
    }
    throw err;
  }
  redirect(`/properties/${propertyId}`);
}

async function updatePropertyAction(propertyId: string, formData: FormData) {
  "use server";
  const user = await requireUser();
  const db = await getDb();
  try {
    await updateProperty(db, user, propertyId, {
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
      status: (String(formData.get("status") ?? "active") as "active" | "inactive" | "maintenance" | "being_sold"),
      doorAccessNote: String(formData.get("doorAccessNote") ?? "") || undefined,
      wifiNetwork: String(formData.get("wifiNetwork") ?? "") || undefined,
      wifiPassword: String(formData.get("wifiPassword") ?? "") || undefined,
    } as any);
  } catch (err) {
    if (err instanceof ValidationError) {
      redirect(`/properties/${propertyId}?error=${encodeURIComponent(err.message)}`);
    }
    if (err instanceof ForbiddenError) {
      redirect(`/properties/${propertyId}?error=${encodeURIComponent("You do not have permission to edit properties.")}`);
    }
    throw err;
  }
  redirect(`/properties/${propertyId}`);
}

async function deletePropertyAction(propertyId: string, referenceCode: string, formData: FormData) {
  "use server";
  const user = await requireUser();
  const db = await getDb();
  const typed = String(formData.get("confirmReferenceCode") ?? "");
  if (typed !== referenceCode) {
    redirect(`/properties/${propertyId}?error=${encodeURIComponent("Reference code did not match — property was not deleted.")}`);
  }
  try {
    await deleteProperty(db, user, propertyId);
  } catch (err) {
    if (err instanceof ValidationError) {
      redirect(`/properties/${propertyId}?error=${encodeURIComponent(err.message)}`);
    }
    if (err instanceof ForbiddenError) {
      redirect(`/properties/${propertyId}?error=${encodeURIComponent("You do not have permission to delete properties.")}`);
    }
    throw err;
  }
  redirect(`/properties?deleted=${encodeURIComponent(referenceCode)}`);
}

async function addUtilityAction(propertyId: string, formData: FormData) {
  "use server";
  const user = await requireUser();
  const db = await getDb();
  try {
    await createUtilityAccount(db, user, {
      propertyId,
      type: formData.get("type"),
      provider: String(formData.get("provider") ?? "") || undefined,
      accountNumber: String(formData.get("accountNumber") ?? "") || undefined,
      premiseNumber: String(formData.get("premiseNumber") ?? "") || undefined,
      billingCycle: String(formData.get("billingCycle") ?? "") || undefined,
    } as any);
  } catch (err) {
    if (err instanceof ValidationError) {
      redirect(`/properties/${propertyId}?error=${encodeURIComponent(err.message)}`);
    }
    throw err;
  }
  redirect(`/properties/${propertyId}`);
}

function Light({ status }: { status: "green" | "amber" | "red" }) {
  return <span className={`badge ${status}`}>{status.toUpperCase()}</span>;
}

export default async function PropertyDetailPage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { id } = await params;
  const { error } = await searchParams;
  const user = await requireUser();
  const db = await getDb();

  const property = await getProperty(db, user, id);
  if (!property) notFound();

  const [documents, utilities, compliance] = await Promise.all([
    listDocumentsForProperty(db, user, id),
    listUtilityAccounts(db, user, id),
    propertyComplianceStatus(db, user, id),
  ]);

  const canWrite = can(user.role, "property:write");
  const canDelete = can(user.role, "property:delete");

  return (
    <div>
      <p><a href="/properties">&larr; All properties</a></p>
      <h1>{property.name} <span style={{ fontWeight: 400, color: "#888" }}>({property.referenceCode})</span></h1>
      <p className="subtitle">
        {property.unitNumber && <>Unit {property.unitNumber}{property.building ? `, ${property.building}` : ""} · </>}
        {!property.unitNumber && property.building && <>{property.building} · </>}
        {property.bedrooms} bed · {property.bathrooms} bath · max {property.maxOccupancy} guests ·{" "}
        {property.classification} · {property.area ?? property.emirate}
        {"  "}<Light status={compliance.status} />
      </p>

      {error && <div className="error-box">{error}</div>}

      {canWrite && (
        <div className="card">
          <details>
            <summary style={{ cursor: "pointer", fontWeight: 600 }}>Edit property details</summary>
            <form className="stack" action={updatePropertyAction.bind(null, id)} style={{ marginTop: "0.75rem" }}>
              <div className="row">
                <div>
                  <label htmlFor="e-referenceCode">Reference code</label>
                  <input id="e-referenceCode" name="referenceCode" required defaultValue={property.referenceCode} />
                </div>
                <div>
                  <label htmlFor="e-name">Name</label>
                  <input id="e-name" name="name" required defaultValue={property.name} />
                </div>
              </div>
              <div className="row">
                <div>
                  <label htmlFor="e-unitNumber">Unit / room number</label>
                  <input id="e-unitNumber" name="unitNumber" defaultValue={property.unitNumber ?? ""} />
                </div>
                <div>
                  <label htmlFor="e-building">Building</label>
                  <input id="e-building" name="building" defaultValue={property.building ?? ""} />
                </div>
                <div>
                  <label htmlFor="e-community">Community</label>
                  <input id="e-community" name="community" defaultValue={property.community ?? ""} />
                </div>
              </div>
              <div className="row">
                <div>
                  <label htmlFor="e-area">Area</label>
                  <input id="e-area" name="area" defaultValue={property.area ?? ""} />
                </div>
                <div>
                  <label htmlFor="e-emirate">Emirate</label>
                  <input id="e-emirate" name="emirate" defaultValue={property.emirate} />
                </div>
              </div>
              <div className="row">
                <div>
                  <label htmlFor="e-bedrooms">Bedrooms</label>
                  <input id="e-bedrooms" name="bedrooms" type="number" min={0} required defaultValue={property.bedrooms} />
                </div>
                <div>
                  <label htmlFor="e-bathrooms">Bathrooms</label>
                  <input id="e-bathrooms" name="bathrooms" type="number" min={0} required defaultValue={property.bathrooms} />
                </div>
                <div>
                  <label htmlFor="e-maxOccupancy">Max occupancy</label>
                  <input id="e-maxOccupancy" name="maxOccupancy" type="number" min={1} required defaultValue={property.maxOccupancy} />
                </div>
              </div>
              <div className="row">
                <div>
                  <label htmlFor="e-classification">DET classification</label>
                  <select id="e-classification" name="classification" defaultValue={property.classification}>
                    <option value="standard">Standard</option>
                    <option value="deluxe">Deluxe</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="e-status">Status</label>
                  <select id="e-status" name="status" defaultValue={property.status}>
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                    <option value="maintenance">Maintenance</option>
                    <option value="being_sold">Being sold</option>
                  </select>
                  <p className="hint">Set to inactive to retire a property without deleting its history.</p>
                </div>
              </div>
              <div className="row">
                <div>
                  <label htmlFor="e-wifiNetwork">Wifi network</label>
                  <input id="e-wifiNetwork" name="wifiNetwork" defaultValue={property.wifiNetwork ?? ""} />
                </div>
                <div>
                  <label htmlFor="e-wifiPassword">Wifi password</label>
                  <input id="e-wifiPassword" name="wifiPassword" defaultValue={property.wifiPassword ?? ""} />
                </div>
              </div>
              <div>
                <label htmlFor="e-doorAccessNote">Door access note</label>
                <input id="e-doorAccessNote" name="doorAccessNote" defaultValue={property.doorAccessNote ?? ""} />
              </div>
              <button className="primary" type="submit">Save changes</button>
            </form>
          </details>
        </div>
      )}

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Compliance status</h2>
        <p>
          DET permit: <strong>{compliance.permitStatus.replace("_", " ")}</strong>
          {compliance.permitStatus === "expired" || compliance.permitStatus === "missing" ? (
            <span style={{ color: "var(--red)", marginLeft: "0.5rem" }}>
              — new confirmed bookings are blocked until this is resolved.
            </span>
          ) : null}
        </p>
        <table>
          <thead><tr><th>Document</th><th>Expiry</th><th>Status</th></tr></thead>
          <tbody>
            {compliance.documents.map((d) => (
              <tr key={d.id}>
                <td>{d.type.replace(/_/g, " ")}</td>
                <td>{d.expiryDate ?? "—"}</td>
                <td><Light status={d.light} /></td>
              </tr>
            ))}
            {compliance.documents.length === 0 && (
              <tr><td colSpan={3} style={{ color: "#888" }}>No documents on file yet.</td></tr>
            )}
          </tbody>
        </table>

        {canWrite && (
          <details style={{ marginTop: "1rem" }}>
            <summary style={{ cursor: "pointer", fontWeight: 600 }}>Add a document</summary>
            <form className="stack" action={addDocumentAction.bind(null, id)} style={{ marginTop: "0.75rem" }}>
              <div className="row">
                <div>
                  <label htmlFor="type">Type</label>
                  <select id="type" name="type" required>
                    {DOCUMENT_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, " ")}</option>)}
                  </select>
                </div>
                <div>
                  <label htmlFor="referenceNumber">Reference number</label>
                  <input id="referenceNumber" name="referenceNumber" />
                </div>
              </div>
              <div className="row">
                <div>
                  <label htmlFor="issueDate">Issue date</label>
                  <input id="issueDate" name="issueDate" type="date" />
                </div>
                <div>
                  <label htmlFor="expiryDate">Expiry date</label>
                  <input id="expiryDate" name="expiryDate" type="date" />
                </div>
              </div>
              <div>
                <label htmlFor="issuer">Issuer</label>
                <input id="issuer" name="issuer" placeholder="Dubai Department of Economy and Tourism" />
              </div>
              <div>
                <label htmlFor="fileUrl">File URL</label>
                <input id="fileUrl" name="fileUrl" placeholder="https://…" />
                <p className="hint">Phase 1 stores a link; direct upload to storage arrives in a later phase.</p>
              </div>
              <button className="primary" type="submit">Save document</button>
            </form>
          </details>
        )}
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Utility accounts</h2>
        <table>
          <thead><tr><th>Type</th><th>Provider</th><th>Account #</th><th>Premise #</th><th>Billing cycle</th></tr></thead>
          <tbody>
            {utilities.map((u) => (
              <tr key={u.id}>
                <td>{u.type.replace(/_/g, " ")}</td>
                <td>{u.provider ?? "—"}</td>
                <td>{u.accountNumber ?? "—"}</td>
                <td>{u.premiseNumber ?? "—"}</td>
                <td>{u.billingCycle ?? "—"}</td>
              </tr>
            ))}
            {utilities.length === 0 && (
              <tr><td colSpan={5} style={{ color: "#888" }}>No utility accounts recorded yet.</td></tr>
            )}
          </tbody>
        </table>

        {canWrite && (
          <details style={{ marginTop: "1rem" }}>
            <summary style={{ cursor: "pointer", fontWeight: 600 }}>Add a utility account</summary>
            <form className="stack" action={addUtilityAction.bind(null, id)} style={{ marginTop: "0.75rem" }}>
              <div className="row">
                <div>
                  <label htmlFor="utype">Type</label>
                  <select id="utype" name="type" required>
                    {UTILITY_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, " ")}</option>)}
                  </select>
                </div>
                <div>
                  <label htmlFor="provider">Provider</label>
                  <input id="provider" name="provider" placeholder="DEWA / Empower / Etisalat…" />
                </div>
              </div>
              <div className="row">
                <div>
                  <label htmlFor="accountNumber">Account number</label>
                  <input id="accountNumber" name="accountNumber" />
                </div>
                <div>
                  <label htmlFor="premiseNumber">Premise number</label>
                  <input id="premiseNumber" name="premiseNumber" />
                </div>
              </div>
              <button className="primary" type="submit">Save utility account</button>
            </form>
          </details>
        )}
      </div>

      <p><a href={`/api/ical/${id}`}>iCal feed for this property &rarr;</a></p>

      {canDelete && (
        <div className="card" style={{ border: "1px solid var(--red)" }}>
          <h2 style={{ marginTop: 0 }}>Delete this property</h2>
          <p className="hint">
            Permanently removes the property and its photos, utility accounts, and documents.
            Blocked if any bookings exist for this property — set status to inactive instead if you just want to retire it.
          </p>
          <form action={deletePropertyAction.bind(null, id, property.referenceCode)} className="stack">
            <div>
              <label htmlFor="confirmReferenceCode">
                Type the reference code (<strong>{property.referenceCode}</strong>) to confirm
              </label>
              <input id="confirmReferenceCode" name="confirmReferenceCode" required placeholder={property.referenceCode} />
            </div>
            <button className="danger" type="submit">Delete property</button>
          </form>
        </div>
      )}
    </div>
  );
}

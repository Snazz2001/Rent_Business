import { getDb } from "../../db/client";
import { requireUser } from "../../lib/requireUser";
import { portfolioComplianceOverview } from "../../lib/services/documentService";

function Light({ status }: { status: "green" | "amber" | "red" }) {
  return <span className={`badge ${status}`}>{status.toUpperCase()}</span>;
}

export default async function CompliancePage() {
  const user = await requireUser();
  const db = await getDb();
  const overview = await portfolioComplianceOverview(db, user);

  const atRisk = overview.filter((o) => o.status !== "green");

  return (
    <div>
      <h1>Compliance dashboard</h1>
      <p className="subtitle">
        Traffic-light status per property (spec 4.2). {atRisk.length} of {overview.length} propert{overview.length === 1 ? "y needs" : "ies need"} attention.
      </p>

      <table>
        <thead>
          <tr><th>Property</th><th>Overall</th><th>DET permit</th><th>Documents on file</th></tr>
        </thead>
        <tbody>
          {overview.map((o) => (
            <tr key={o.propertyId}>
              <td><a href={`/properties/${o.propertyId}`}>{o.propertyName}</a></td>
              <td><Light status={o.status} /></td>
              <td>{o.permitStatus.replace("_", " ")}</td>
              <td>{o.documents.length}</td>
            </tr>
          ))}
          {overview.length === 0 && (
            <tr><td colSpan={4} style={{ color: "#888" }}>No properties yet.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

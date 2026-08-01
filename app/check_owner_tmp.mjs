import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import bcrypt from "bcryptjs";

const client = new PGlite("/sessions/sharp-pensive-brown/mnt/Rent_Business/app/.pglite-data", { extensions: { btree_gist } });
const res = await client.query("select id, email, role, active, password_hash from app_user");
console.log("users:", JSON.stringify(res.rows, null, 2));

for (const u of res.rows) {
  if (u.email === "owner@example.com") {
    const ok = await bcrypt.compare("changeme123", u.password_hash);
    console.log("bcrypt.compare('changeme123', stored hash) =>", ok);
  }
}
await client.close();

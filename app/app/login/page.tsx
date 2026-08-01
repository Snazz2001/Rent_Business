import { redirect } from "next/navigation";
import { getDb } from "../../db/client";
import { verifyLogin } from "../../lib/services/authService";
import { setSessionCookie } from "../../lib/session";

async function loginAction(formData: FormData) {
  "use server";
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const db = await getDb();
  const user = await verifyLogin(db, email, password);
  if (!user) {
    redirect("/login?error=1");
  }
  await setSessionCookie(user);
  redirect("/properties");
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  return (
    <div className="card" style={{ maxWidth: 420, margin: "3rem auto" }}>
      <h1>Log in</h1>
      <p className="subtitle">Holiday Rental Management System — Phase 1</p>
      {error && <div className="error-box">Incorrect email or password.</div>}
      <form className="stack" action={loginAction}>
        <div>
          <label htmlFor="email">Email</label>
          <input id="email" name="email" type="email" required />
        </div>
        <div>
          <label htmlFor="password">Password</label>
          <input id="password" name="password" type="password" required />
        </div>
        <button className="primary" type="submit">Log in</button>
      </form>
      <p className="hint" style={{ marginTop: "1rem" }}>
        First run? Seed a demo account with <code>npm run seed</code> — see the README.
      </p>
    </div>
  );
}

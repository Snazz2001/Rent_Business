import "./globals.css";
import type { ReactNode } from "react";
import { getSession, clearSessionCookie } from "../lib/session";
import { redirect } from "next/navigation";

export const metadata = {
  title: "Holiday Rental System",
  description: "Phase 1 core — properties, guests, bookings, compliance",
};

async function logoutAction() {
  "use server";
  await clearSessionCookie();
  redirect("/login");
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const user = await getSession();

  return (
    <html lang="en">
      <body>
        <nav className="nav">
          <div>
            <span className="brand">Holiday Rental System</span>
            {user && (
              <>
                <a href="/properties" style={{ marginLeft: "1.5rem" }}>Properties</a>
                <a href="/guests">Guests</a>
                <a href="/bookings">Bookings</a>
                <a href="/compliance">Compliance</a>
              </>
            )}
          </div>
          <div>
            {user ? (
              <>
                <span style={{ marginRight: "1rem", fontSize: "0.85rem" }}>
                  {user.name} · {user.role}
                </span>
                <form action={logoutAction}>
                  <button type="submit">Log out</button>
                </form>
              </>
            ) : (
              <a href="/login">Log in</a>
            )}
          </div>
        </nav>
        <main>{children}</main>
      </body>
    </html>
  );
}

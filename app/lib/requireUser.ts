import { redirect } from "next/navigation";
import { getSession, type SessionUser } from "./session";

export async function requireUser(): Promise<SessionUser> {
  const user = await getSession();
  if (!user) redirect("/login");
  return user;
}

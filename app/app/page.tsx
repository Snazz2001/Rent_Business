import { redirect } from "next/navigation";
import { getSession } from "../lib/session";

export default async function HomePage() {
  const user = await getSession();
  redirect(user ? "/properties" : "/login");
}

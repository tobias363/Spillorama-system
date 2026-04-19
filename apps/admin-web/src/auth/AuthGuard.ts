import { fetchMe } from "../api/auth.js";
import { getToken } from "../api/client.js";
import { setSession } from "./Session.js";

export type AuthState = "authenticated" | "unauthenticated" | "loading";

export async function bootstrapAuth(): Promise<AuthState> {
  const token = getToken();
  if (!token) {
    setSession(null);
    return "unauthenticated";
  }
  try {
    const session = await fetchMe();
    setSession(session);
    return "authenticated";
  } catch {
    setSession(null);
    return "unauthenticated";
  }
}

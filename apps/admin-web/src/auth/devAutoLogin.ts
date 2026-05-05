/**
 * apps/admin-web/src/auth/devAutoLogin.ts
 *
 * Dev-only auto-login: les `?dev-user=email@example.com` fra URL og kall
 * backend `/api/dev/auto-login`-route som setter et access-token i
 * localStorage og redirecter til ren URL (uten ?dev-user=).
 *
 * Backend-routen er gated bak `NODE_ENV !== "production"` + localhost-only +
 * email-allowlist (se `apps/backend/src/dev/devAutoLoginRoute.ts`). Klient-
 * siden er gated bak `import.meta.env.DEV` så koden tree-shakes ut av
 * prod-bundle.
 *
 * Returnerer `true` hvis vi initierer en redirect-flyt — kalleren skal
 * da abort'e videre bootstrap. `false` betyr at det ikke var noe `?dev-user`
 * og bootstrap kan fortsette som normalt.
 */

import { setToken } from "../api/client.js";

const TOKEN_KEY_FALLBACK = "spillorama.dev.lastAutoUser";

export async function maybeAutoLoginFromQueryParam(): Promise<boolean> {
  if (!import.meta.env.DEV) return false;
  if (typeof window === "undefined") return false;

  const params = new URLSearchParams(window.location.search);
  const devUser = params.get("dev-user");
  if (!devUser) return false;

  // eslint-disable-next-line no-console
  console.log(`[dev:auto-login] forsøker å auto-logge inn som ${devUser}`);

  try {
    const res = await fetch(
      `/api/dev/auto-login?email=${encodeURIComponent(devUser)}`,
      { method: "GET", headers: { Accept: "application/json" } },
    );
    const body = await res.json().catch(() => null);
    if (!res.ok || !body?.ok || !body.data?.accessToken) {
      console.error("[dev:auto-login] backend returnerte ikke ok:", body);
      return false;
    }
    setToken(body.data.accessToken);
    sessionStorage.setItem(TOKEN_KEY_FALLBACK, devUser);
    // eslint-disable-next-line no-console
    console.log("[dev:auto-login] OK — fjerner ?dev-user= og reloader");
    const url = new URL(window.location.href);
    url.searchParams.delete("dev-user");
    window.location.replace(url.toString());
    return true;
  } catch (err) {
    console.error("[dev:auto-login] feil:", err);
    return false;
  }
}

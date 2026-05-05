import { GameApp, type GameMountConfig } from "./core/GameApp.js";

let currentApp: GameApp | null = null;

/**
 * Mount the web game client into a container element.
 * Called by the web shell (lobby.js) when a player selects a game.
 */
export async function mountGame(
  container: HTMLElement,
  config: GameMountConfig,
): Promise<void> {
  // Tear down previous game if any
  if (currentApp) {
    currentApp.destroy();
    currentApp = null;
  }

  currentApp = new GameApp();
  await currentApp.init(container, config);
}

/**
 * Unmount the current game and clean up resources.
 * Called by the web shell when navigating back to lobby.
 */
export function unmountGame(): void {
  if (currentApp) {
    currentApp.destroy();
    currentApp = null;
  }
}

// Expose on window for dynamic import from lobby.js
(window as unknown as Record<string, unknown>).__spilloramaGameClient = {
  mountGame,
  unmountGame,
};

// Dev mode: auto-mount is handled by the dev lobby in index.html.
// The lobby logs in via /api/auth/login, gets a real accessToken,
// and calls mountGame() with correct hallId and credentials.

// Dev-only: load the performance HUD when URL contains `?perfhud=1`.
// Dynamic import keeps the module out of the prod bundle — Vite tree-shakes
// the branch under `import.meta.env.DEV === false` and the ES-module loader
// never resolves it when DEV is false.
if (
  import.meta.env.DEV &&
  typeof window !== "undefined" &&
  new URLSearchParams(window.location.search).get("perfhud") === "1"
) {
  void import("./diagnostics/PerfHud.js").then(({ PerfHud }) => {
    const hud = new PerfHud();
    hud.mount();
    (window as unknown as Record<string, unknown>).__perfhud = hud;
  });
}

// ── Dev-only: Vite HMR + auto-login support (Tobias 2026-05-05) ──────────
//
// To bevarings-mekanismer for å unngå å miste state ved hver code-edit:
//
//   1) `?dev-user=email@example.com` i URL: ved første mount kaller vi
//      backend `GET /api/dev/auto-login?email=...` (gated bak NODE_ENV!=
//      production + localhost-only + email-allowlist) og lagrer access-
//      token i sessionStorage. Etterpå er du auto-innlogget på reload.
//
//   2) Vite HMR: hvis Vite hot-replacer denne modulen, lagrer vi gjeldende
//      mount-config i hot-data slik at den kan re-mountes på neste runde
//      uten å gå gjennom login-flyten igjen. Hvis komponenten ikke har en
//      måte å re-mountes på (currentApp er null, ingen container kjent),
//      faller vi tilbake til full reload.
//
// Begge mekanismene tre kun i kraft når `import.meta.env.DEV === true`,
// så prod-bundle blir ikke berørt (Vite tree-shaker import-greinen ut).

if (import.meta.env.DEV && typeof window !== "undefined") {
  // (1) Auto-login via ?dev-user=
  const devUser = new URLSearchParams(window.location.search).get("dev-user");
  const tokenKey = "spillorama.dev.accessToken";
  const userKey = "spillorama.dev.user";
  if (devUser && !sessionStorage.getItem(tokenKey)) {
    void fetch(`/api/dev/auto-login?email=${encodeURIComponent(devUser)}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(res.statusText)))
      .then((body) => {
        if (body?.ok && body.data?.accessToken) {
          sessionStorage.setItem(tokenKey, body.data.accessToken);
          sessionStorage.setItem(userKey, JSON.stringify(body.data.user));
          // eslint-disable-next-line no-console
          console.log(
            `[dev:auto-login] success — ${devUser}. Reloading uten ?dev-user=…`,
          );
          // Fjern ?dev-user= fra URL og reload — gir en ren state hvor
          // shell-en kan fortsette med token i sessionStorage.
          const url = new URL(window.location.href);
          url.searchParams.delete("dev-user");
          window.location.replace(url.toString());
        } else {
          console.error("[dev:auto-login] failed:", body);
        }
      })
      .catch((err) => {
        console.error("[dev:auto-login] error:", err);
      });
  }

  // (2) HMR state-preservation. ImportMeta.hot er kun definert under Vite-dev.
  if (import.meta.hot) {
    import.meta.hot.accept((newModule) => {
      // Selv om Vite kaller accept(), trenger vi mer enn å bare bytte
      // modulen — vi må re-mounte spillet med samme config. Sender
      // signal til shell via custom event så lobby.js kan ta over.
      // eslint-disable-next-line no-console
      console.log("[hmr] main.ts hot-replaced — emit dev-game-hmr");
      window.dispatchEvent(
        new CustomEvent("dev:game-hmr", { detail: { newModule } }),
      );
    });
  }
}

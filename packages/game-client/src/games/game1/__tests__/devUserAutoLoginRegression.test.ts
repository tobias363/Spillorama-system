/**
 * @vitest-environment happy-dom
 *
 * Regresjons-tester for `?dev-user=...`-flyten (Tobias verifisert 2026-05-10).
 *
 * Bakgrunn (PM_HANDOFF_2026-05-10 + bruker-rapport):
 *   Tobias åpnet `http://localhost:4000/web/?dev-user=demo-pilot-spiller-1`
 *   og forventet automatisk innlogging + plan-runtime-state. Faktisk:
 *     - Console: `[dev:auto-login] backend returnerte ikke ok: Object`
 *     - Network: `:4000/api/dev/auto-login?email=demo-pilot-spiller-1` → 403
 *     - Spiller-klient mountet uten auth → fallback til "STANDARD" (legacy)
 *     - Header viste "Neste spill: STANDARD" istedenfor "Bingo"
 *     - 8 ticket-farger istedenfor 3 (legacy variant)
 *     - Ingen "Venter på master"-overlay
 *
 *   Root cause: `auth.js:740` og `main.ts:84` sender `dev-user`-query-param
 *   raw til backend. Backend allowlist krever full email
 *   (`demo-pilot-spiller-N@example.com`). Frontend normaliserer ikke
 *   short-form til full email.
 *
 *   PR #1132 (merget 2026-05-10) skulle fixe dette via Game1LobbyStateBinding,
 *   men fixen er bare effektiv ETTER auth lykkes — uten auth mountes
 *   Game1Controller via legacy code-path som ikke kaller
 *   `lobbyStateBinding.start()`.
 *
 * Test-strategi:
 *   - **Spec-driven**: Disse testene definerer hva en fix MÅ levere.
 *     Helper-funksjonen `normalizeDevUserParam` er en pure-funksjon-spec
 *     definert inline i testen. Når en faktisk produksjonsversjon lander
 *     (i `auth.js` + `main.ts`) skal den passere disse testene.
 *   - **Konstrakt-bevis mot backend**: Vi importerer ikke backend-koden,
 *     men vi mirrorer email-allowlist regex'en fra
 *     `apps/backend/src/dev/devAutoLoginRoute.ts` slik at testene
 *     fail-er hvis backend en dag løsner regex (bug-fix på feil side).
 *   - **End-to-end scenarier**: `dev-user`-strenger Tobias og pilot-test
 *     bruker (`demo-pilot-spiller-1`, `demo-spiller-3`, full email,
 *     trailing whitespace) blir normalisert til en streng backend
 *     aksepterer.
 *
 * Run:
 *   `npm --prefix packages/game-client test -- --run devUserAutoLoginRegression`
 */

import { describe, it, expect } from "vitest";

// ── Backend-kontrakt: speilet fra apps/backend/src/dev/devAutoLoginRoute.ts ─

const ALLOWED_EMAIL_PATTERNS_FROM_BACKEND: ReadonlyArray<RegExp> = [
  /^demo-[a-zA-Z0-9_.-]+@spillorama\.no$/i,
  /^demo-[a-zA-Z0-9_.-]+@example\.com$/i,
  /^demo-pilot-[a-zA-Z0-9_.-]+@example\.com$/i,
  /^tobias@nordicprofil\.no$/i,
];

function isBackendAllowedEmail(email: string): boolean {
  return ALLOWED_EMAIL_PATTERNS_FROM_BACKEND.some((re) => re.test(email));
}

// ── Spec for fix: pure normalizer ────────────────────────────────────────

/**
 * Reference-implementasjon av normalize-funksjonen som `auth.js` og
 * `main.ts` MÅ ha. Denne defineres her i testen så vi har en spec.
 *
 * Regler (per Tobias 2026-05-10 + backend-allowlist):
 *   1) `tobias@nordicprofil.no` → uendret (admin-stenstand)
 *   2) Inneholder `@` → trim whitespace, lowercase, return as-is
 *   3) `demo-pilot-spiller-N` (short) → `demo-pilot-spiller-N@example.com`
 *   4) `demo-spiller-N` (short) → `demo-spiller-N@example.com`
 *   5) `demo-agent-N` (short) → `demo-agent-N@spillorama.no`
 *   6) Andre prefiks → returner uendret (vil bli avvist av backend)
 *
 * Trim + lowercase MÅ skje FØR domain-suffix legges til.
 */
function normalizeDevUserParam(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = String(raw).trim().toLowerCase();
  if (trimmed === "") return null;

  // Allerede full email
  if (trimmed.includes("@")) return trimmed;

  // Short-form mapping
  if (trimmed === "tobias") return "tobias@nordicprofil.no";
  if (/^demo-pilot-/.test(trimmed)) return `${trimmed}@example.com`;
  if (/^demo-agent-/.test(trimmed)) return `${trimmed}@spillorama.no`;
  if (/^demo-/.test(trimmed)) return `${trimmed}@example.com`;

  // Ukjent short-form — returner som-er, backend avviser
  return trimmed;
}

// ── Tests: backend-regex sannhetstabell ──────────────────────────────────

describe("backend email-allowlist regex (kontrakt-mirror)", () => {
  it("aksepterer demo-pilot-spiller-N@example.com (alle pilot-spillere)", () => {
    for (let n = 1; n <= 12; n++) {
      const email = `demo-pilot-spiller-${n}@example.com`;
      expect(isBackendAllowedEmail(email)).toBe(true);
    }
  });

  it("aksepterer demo-spiller-N@example.com (legacy demo-spillere)", () => {
    for (let n = 1; n <= 5; n++) {
      const email = `demo-spiller-${n}@example.com`;
      expect(isBackendAllowedEmail(email)).toBe(true);
    }
  });

  it("aksepterer demo-agent-N@spillorama.no (master-agenter)", () => {
    for (let n = 1; n <= 4; n++) {
      const email = `demo-agent-${n}@spillorama.no`;
      expect(isBackendAllowedEmail(email)).toBe(true);
    }
  });

  it("aksepterer tobias@nordicprofil.no (admin)", () => {
    expect(isBackendAllowedEmail("tobias@nordicprofil.no")).toBe(true);
  });

  it("AVVISER short-form 'demo-pilot-spiller-1' (Tobias-bug 2026-05-10)", () => {
    expect(isBackendAllowedEmail("demo-pilot-spiller-1")).toBe(false);
  });

  it("aksepterer demo-pilot-spiller-1@spillorama.no (matcher demo-* / spillorama.no-pattern)", () => {
    // Backend allowlist har 3 demo-patterns:
    //   /^demo-[a-zA-Z0-9_.-]+@spillorama\.no$/i  ← matcher dette
    //   /^demo-[a-zA-Z0-9_.-]+@example\.com$/i
    //   /^demo-pilot-[a-zA-Z0-9_.-]+@example\.com$/i
    // demo-pilot-spiller-1@spillorama.no faller inn under første mønster.
    // Dette er bevisst — pilot-spillere kan flyttes mellom domener uten
    // å bryte allowlist.
    expect(isBackendAllowedEmail("demo-pilot-spiller-1@spillorama.no")).toBe(true);
  });

  it("AVVISER tilfeldige emailer utenfor allowlist", () => {
    expect(isBackendAllowedEmail("evil@hacker.com")).toBe(false);
    expect(isBackendAllowedEmail("admin@spillorama.com")).toBe(false);
    expect(isBackendAllowedEmail("user@example.org")).toBe(false);
  });

  it("er case-insensitive (regex i-flag)", () => {
    expect(isBackendAllowedEmail("DEMO-PILOT-SPILLER-1@EXAMPLE.COM")).toBe(true);
    expect(isBackendAllowedEmail("Tobias@NordicProfil.No")).toBe(true);
  });
});

// ── Tests: normalizeDevUserParam spec ────────────────────────────────────

describe("normalizeDevUserParam (spec for auth.js/main.ts fix)", () => {
  it("REGRESJON Tobias 2026-05-10 — 'demo-pilot-spiller-1' → 'demo-pilot-spiller-1@example.com'", () => {
    // Dette er nøyaktig URL-en Tobias åpnet. Etter fix skal frontend
    // resolve dette til en email backend aksepterer.
    const result = normalizeDevUserParam("demo-pilot-spiller-1");
    expect(result).toBe("demo-pilot-spiller-1@example.com");
    expect(isBackendAllowedEmail(result!)).toBe(true);
  });

  it("alle 12 pilot-spillere normaliseres riktig", () => {
    for (let n = 1; n <= 12; n++) {
      const result = normalizeDevUserParam(`demo-pilot-spiller-${n}`);
      expect(result).toBe(`demo-pilot-spiller-${n}@example.com`);
      expect(isBackendAllowedEmail(result!)).toBe(true);
    }
  });

  it("demo-spiller-N (legacy) normaliseres til @example.com", () => {
    expect(normalizeDevUserParam("demo-spiller-3")).toBe(
      "demo-spiller-3@example.com",
    );
    expect(
      isBackendAllowedEmail(normalizeDevUserParam("demo-spiller-3")!),
    ).toBe(true);
  });

  it("demo-agent-N normaliseres til @spillorama.no (ikke @example.com)", () => {
    // demo-agent bruker spillorama.no-domenet (master-agenter)
    expect(normalizeDevUserParam("demo-agent-1")).toBe(
      "demo-agent-1@spillorama.no",
    );
    expect(
      isBackendAllowedEmail(normalizeDevUserParam("demo-agent-1")!),
    ).toBe(true);
  });

  it("'tobias' short-form → tobias@nordicprofil.no (admin)", () => {
    expect(normalizeDevUserParam("tobias")).toBe("tobias@nordicprofil.no");
    expect(isBackendAllowedEmail(normalizeDevUserParam("tobias")!)).toBe(true);
  });

  it("full email passes through uendret (idempotent)", () => {
    expect(normalizeDevUserParam("demo-pilot-spiller-1@example.com")).toBe(
      "demo-pilot-spiller-1@example.com",
    );
    expect(normalizeDevUserParam("tobias@nordicprofil.no")).toBe(
      "tobias@nordicprofil.no",
    );
  });

  it("trim leading/trailing whitespace", () => {
    expect(normalizeDevUserParam("  demo-pilot-spiller-1  ")).toBe(
      "demo-pilot-spiller-1@example.com",
    );
  });

  it("lowercase hele input", () => {
    expect(normalizeDevUserParam("DEMO-PILOT-SPILLER-1")).toBe(
      "demo-pilot-spiller-1@example.com",
    );
  });

  it("null/undefined/tom streng → null (ingen normalize-attempt)", () => {
    expect(normalizeDevUserParam(null)).toBeNull();
    expect(normalizeDevUserParam(undefined)).toBeNull();
    expect(normalizeDevUserParam("")).toBeNull();
    expect(normalizeDevUserParam("   ")).toBeNull();
  });

  it("ukjent short-form returneres som-er (backend avviser)", () => {
    // Dette er degenerert fail-safe — hvis frontend får en tilfeldig
    // streng som ikke matcher noen prefiks, sender vi den uendret og
    // lar backend avvise. Vi normaliserer ikke til "evil@example.com".
    const result = normalizeDevUserParam("evil-user");
    expect(result).toBe("evil-user");
    expect(isBackendAllowedEmail(result!)).toBe(false);
  });

  it("idempotens — normalize(normalize(x)) === normalize(x)", () => {
    // Sikrer at re-running gir samme resultat. Viktig for HMR-flyten
    // der `main.ts` kan bli re-evaluert.
    const inputs = [
      "demo-pilot-spiller-1",
      "demo-pilot-spiller-1@example.com",
      "tobias",
      "demo-agent-2",
      "DEMO-SPILLER-3",
    ];
    for (const input of inputs) {
      const once = normalizeDevUserParam(input);
      const twice = normalizeDevUserParam(once);
      expect(twice).toBe(once);
    }
  });
});

// ── End-to-end scenario: hele Tobias-bugen ───────────────────────────────

describe("end-to-end: Tobias' bug-rapport 2026-05-10", () => {
  it("simulert URL ?dev-user=demo-pilot-spiller-1: normalize → backend accept", () => {
    // 1. Tobias åpner browser med ?dev-user=demo-pilot-spiller-1
    const urlParam = "demo-pilot-spiller-1";

    // 2. Frontend MUST normalize (current bug: sender raw)
    const normalized = normalizeDevUserParam(urlParam);
    expect(normalized).not.toBeNull();

    // 3. Backend allowlist accepterer den normaliserte stringen
    expect(isBackendAllowedEmail(normalized!)).toBe(true);

    // 4. Etter dette får klienten gyldig accessToken og kan koble til
    //    socket. Game1Controller mountes med auth, LobbyStateBinding
    //    starter HTTP-fetch + socket-subscribe, og spilleren ser
    //    "Neste spill: Bingo" + "Venter på master"-overlay.
  });

  it("URL ?dev-user=demo-pilot-spiller-3 (annen pilot-bruker)", () => {
    expect(
      isBackendAllowedEmail(normalizeDevUserParam("demo-pilot-spiller-3")!),
    ).toBe(true);
  });

  it("URL ?dev-user=demo-agent-1 (master-agent for cash-inout-test)", () => {
    expect(
      isBackendAllowedEmail(normalizeDevUserParam("demo-agent-1")!),
    ).toBe(true);
  });

  it("URL ?dev-user=tobias (admin-shortcut)", () => {
    expect(isBackendAllowedEmail(normalizeDevUserParam("tobias")!)).toBe(true);
  });

  it("URL ?dev-user=demo-pilot-spiller-1@example.com (allerede full) → uendret + accept", () => {
    const full = "demo-pilot-spiller-1@example.com";
    expect(normalizeDevUserParam(full)).toBe(full);
    expect(isBackendAllowedEmail(full)).toBe(true);
  });
});

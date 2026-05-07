/**
 * Fase 3 (2026-05-07): enkel feature-flag-helper for admin-web.
 *
 * Lar oss rolle ut nye flyter bak en flag uten å bryte produksjon. Flag-
 * verdien leses fra localStorage på frontend (utviklere/QA kan toggle i
 * devtools-konsollen):
 *
 *   ```js
 *   localStorage.setItem("ff:useNewGamePlan", "true");
 *   ```
 *
 * For server-side default kan en backend-rute returnere "default
 * verdier", men i Fase 3 holder localStorage-only siden ingen master-
 * dashbord-brukere har dette enabled før Tobias selv skrur det på.
 *
 * Default for ALLE flags er `false` så behavior er backwards-compatible.
 *
 * Bruk:
 *   if (isFeatureEnabled("useNewGamePlan")) { ... }
 *
 * Fjerne en flag senere: bare slett `setItem`-callsiten, så faller alle
 * tilbake til default `false`.
 */

const STORAGE_PREFIX = "ff:";

const KNOWN_FEATURE_FLAGS = ["useNewGamePlan"] as const;

export type FeatureFlag = (typeof KNOWN_FEATURE_FLAGS)[number];

/**
 * Sjekk om en feature er på. Defaulter til `false` for ukjente verdier.
 *
 * Edge-cases:
 *   - localStorage utilgjengelig (incognito-restriksjoner, SSR) → false.
 *   - Verdien er noe annet enn "true" → false.
 */
export function isFeatureEnabled(flag: FeatureFlag): boolean {
  try {
    if (typeof window === "undefined" || !window.localStorage) return false;
    const raw = window.localStorage.getItem(`${STORAGE_PREFIX}${flag}`);
    return raw === "true";
  } catch {
    return false;
  }
}

/**
 * Sett en feature-flag programmatisk. Brukes av tester / dev-konsollen
 * ikke av produksjons-kode (kunder ser ikke disse). Returnerer false
 * hvis localStorage er utilgjengelig.
 */
export function setFeatureFlag(flag: FeatureFlag, enabled: boolean): boolean {
  try {
    if (typeof window === "undefined" || !window.localStorage) return false;
    if (enabled) {
      window.localStorage.setItem(`${STORAGE_PREFIX}${flag}`, "true");
    } else {
      window.localStorage.removeItem(`${STORAGE_PREFIX}${flag}`);
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Hent alle feature-flags som key→bool. Brukes av admin-debug-panel når
 * vi senere bygger en "feature toggle"-side. I Fase 3 ikke aktivt brukt,
 * men eksportert for completeness.
 */
export function getAllFeatureFlags(): Record<FeatureFlag, boolean> {
  const out = {} as Record<FeatureFlag, boolean>;
  for (const flag of KNOWN_FEATURE_FLAGS) {
    out[flag] = isFeatureEnabled(flag);
  }
  return out;
}

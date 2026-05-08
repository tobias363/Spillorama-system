/**
 * Feature-flag-helper for admin-web.
 *
 * Lar oss rolle ut nye flyter bak en flag uten å bryte produksjon. Flag-
 * verdien leses fra localStorage på frontend (utviklere/QA kan toggle i
 * devtools-konsollen):
 *
 *   ```js
 *   localStorage.setItem("ff:<navn>", "true");
 *   ```
 *
 * For server-side default kan en backend-rute returnere "default
 * verdier", men i nåværende oppsett holder localStorage-only.
 *
 * Default for ALLE flags er `false` så behavior er backwards-compatible.
 *
 * Bruk:
 *   if (isFeatureEnabled("<navn>")) { ... }
 *
 * Fjerne en flag senere: bare slett `setItem`-callsiten, så faller alle
 * tilbake til default `false`.
 *
 * Status 2026-05-08: ingen aktive feature-flags. `useNewGamePlan` ble
 * fjernet da ny spilleplan-flyt ble standard. Helperen beholdes som
 * infrastruktur for fremtidige flagger.
 */

const STORAGE_PREFIX = "ff:";

const KNOWN_FEATURE_FLAGS = [] as const;

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
 * vi senere bygger en "feature toggle"-side. Eksportert for completeness.
 *
 * Når `KNOWN_FEATURE_FLAGS` er tom (cleanup 2026-05-08) returnerer
 * funksjonen et tomt objekt. Loop-body er strukturelt unreachable, men
 * beholdes så funksjonen virker når et nytt flag legges til.
 */
export function getAllFeatureFlags(): Record<FeatureFlag, boolean> {
  const out = {} as Record<FeatureFlag, boolean>;
  for (const flag of KNOWN_FEATURE_FLAGS) {
    (out as Record<string, boolean>)[flag] = isFeatureEnabled(flag);
  }
  return out;
}

/**
 * REQ-130: norsk telefonnummer-validering for Phone+PIN-login.
 *
 * Aksepterer:
 *   - +47XXXXXXXX (8 siffer etter +47)
 *   - 0047XXXXXXXX
 *   - XXXXXXXX (8-sifret nasjonalt format — antas norsk)
 *   - Mellomrom og bindestrek tillatt i input, fjernes før validering
 *
 * Returnerer normalisert form `+47XXXXXXXX` eller kaster DomainError.
 */

import { DomainError } from "../game/BingoEngine.js";

/**
 * Normaliser et norsk telefonnummer til kanonisk +47XXXXXXXX-form.
 * Strenger som allerede starter med +47 eller 0047 godtas. Hvis input
 * er 8 siffer antas det å være norsk.
 *
 * Kaster DomainError("INVALID_PHONE") hvis input ikke er gyldig.
 */
export function normalizeNorwegianPhone(input: unknown): string {
  if (typeof input !== "string") {
    throw new DomainError("INVALID_PHONE", "Telefonnummer er påkrevd.");
  }
  // Fjern alt whitespace + bindestrek + parens.
  const stripped = input.replace(/[\s\-()]/g, "");
  if (!stripped) {
    throw new DomainError("INVALID_PHONE", "Telefonnummer er påkrevd.");
  }

  let digits = stripped;
  if (digits.startsWith("+47")) {
    digits = digits.slice(3);
  } else if (digits.startsWith("0047")) {
    digits = digits.slice(4);
  } else if (digits.startsWith("47") && digits.length === 10) {
    // Tolket som +47 uten plus-prefix (mindre vanlig, men tillat).
    digits = digits.slice(2);
  }

  if (!/^\d{8}$/.test(digits)) {
    throw new DomainError(
      "INVALID_PHONE",
      "Ugyldig norsk telefonnummer. Bruk +47XXXXXXXX (8 siffer)."
    );
  }
  // Norske mobilnummer starter på 4 eller 9; fasttelefon starter på 2/3/5/6/7.
  // Vi godtar alle siden brukeren kan ha registrert et fast-nummer.
  return `+47${digits}`;
}

/**
 * True hvis input er en gyldig norsk telefonnummer-streng (uten å kaste).
 */
export function isValidNorwegianPhone(input: unknown): boolean {
  try {
    normalizeNorwegianPhone(input);
    return true;
  } catch {
    return false;
  }
}

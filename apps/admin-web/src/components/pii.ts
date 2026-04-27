// REQ-005 / REQ-125: PII phone-number masking i admin-grids.
//
// Spill 1 / Wireframe Catalog krever at telefonnummer skal være maskert
// i listing-grids (Players-Approved, -Pending, -Rejected, Agents osv.).
// Detail-views skal vise full phone, og CSV-eksport skal også beholde
// full phone (regulatorisk dokumentasjon).
//
// Mapping:
//   "+4798765432"  → "+47 98** 5432"
//   "98765432"     → "**** 5432"
//   "+4790123456"  → "+47 90** 3456"
//   "90123456"     → "**** 3456"
//   tomt/null      → "—"
//
// Backend-helper `maskPhone()` finnes i SveveSmsService for SMS-logging,
// men formatet der er `+47****5432` (uten mellomrom). Denne grid-versjonen
// er optimert for menneskelig lesing, der mellomrom-grupperingen følger
// norsk telefon-praksis.

/**
 * Masker et telefonnummer for visning i admin-/agent-grids.
 *
 * Regel: behold landskode + de første 2 sifre etter landskode + de siste 4
 * sifre. Maks 4 maskerte sifre i midten. Tomt input → "—".
 *
 * Eksempler:
 *   "+4798765432"  → "+47 98** 5432"
 *   "+47 987 65 432" → "+47 98** 5432"
 *   "98765432"     → "**** 5432"
 *   "12345"        → "* 2345"     (få sifre — masker ett, vis siste 4)
 */
export function maskPhoneForGrid(raw: unknown): string {
  if (raw === null || raw === undefined) return "—";
  if (typeof raw !== "string") return "—";
  const cleaned = raw.replace(/\s+/g, "").trim();
  if (!cleaned) return "—";

  // +47-prefix (norsk landskode er 2-sifret). Andre 2-sifrede landskoder
  // matches også; ikke-greedy så vi ikke "spiser" inn i selve nummeret.
  // Default er 2-sifret cc; hvis flere enn 10 sifre etter `+` antar vi
  // 3-sifret cc.
  const ccMatch = cleaned.match(/^\+(\d+)$/);
  if (ccMatch) {
    const all = ccMatch[1]!;
    const ccLen = all.length >= 11 ? 3 : 2;
    const cc = `+${all.slice(0, ccLen)}`;
    const rest = all.slice(ccLen);
    if (rest.length <= 4) {
      return `${cc} ${"*".repeat(rest.length)} `.trim();
    }
    const head = rest.slice(0, 2);
    const tail = rest.slice(-4);
    const middleLen = Math.max(0, rest.length - head.length - tail.length);
    const middle = "*".repeat(Math.min(2, middleLen));
    return `${cc} ${head}${middle} ${tail}`.trim();
  }

  // Norsk 8-sifret uten landskode
  const digits = cleaned.replace(/\D/g, "");
  if (digits.length <= 4) {
    return `${"*".repeat(Math.max(1, digits.length - 4))} ${digits}`.trim();
  }
  const tail = digits.slice(-4);
  const middleLen = Math.max(0, digits.length - 4);
  const middle = "*".repeat(Math.min(4, middleLen));
  return `${middle} ${tail}`;
}

/**
 * Masker en e-postadresse for visning. Behold første tegn + domene.
 *
 * Eksempler:
 *   "tobias@nordic.no"  → "t****@nordic.no"
 *   "a@x.no"            → "a@x.no"  (for kort, men ingen lekke)
 */
export function maskEmailForGrid(raw: unknown): string {
  if (raw === null || raw === undefined) return "—";
  if (typeof raw !== "string") return "—";
  const trimmed = raw.trim();
  if (!trimmed.includes("@")) return "—";
  const [local, domain] = trimmed.split("@", 2);
  if (!local || !domain) return "—";
  if (local.length <= 1) return `${local}@${domain}`;
  return `${local[0]}****@${domain}`;
}

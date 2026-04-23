// ── Date helpers ─────────────────────────────────────────────────
//
// Pure funksjoner for dato-beregning brukt av ComplianceManager for å bestemme
// dag/måned-starter i lokal tidssone. Kritiske for regulatorisk grense-kalkyle
// (dag- og månedsvinduer i §11 pengespillforskriften). Ikke endre uten å
// verifisere ComplianceManager.test.ts og compliance-suite.

export function startOfLocalDayMs(referenceMs: number): number {
  const reference = new Date(referenceMs);
  return new Date(reference.getFullYear(), reference.getMonth(), reference.getDate()).getTime();
}

export function startOfNextLocalDayMs(referenceMs: number): number {
  const reference = new Date(referenceMs);
  return new Date(reference.getFullYear(), reference.getMonth(), reference.getDate() + 1).getTime();
}

export function startOfLocalMonthMs(referenceMs: number): number {
  const reference = new Date(referenceMs);
  return new Date(reference.getFullYear(), reference.getMonth(), 1).getTime();
}

export function startOfNextLocalMonthMs(referenceMs: number): number {
  const reference = new Date(referenceMs);
  return new Date(reference.getFullYear(), reference.getMonth() + 1, 1).getTime();
}

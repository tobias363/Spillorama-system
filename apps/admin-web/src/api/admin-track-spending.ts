// PR-B2: admin-track-spending API — STUB (fail-closed).
//
// REGULATORISK KONTEKST (pengespillforskriften + Spillvett-memory):
//   GET /api/admin/track-spending aggregat-endpoint EKSISTERER IKKE ennå.
//   Se [BIN-628](https://linear.app/bingosystem/issue/BIN-628).
//
// Denne wrapper-en returnerer IKKE fake-data. Den kaster en eksplisitt
// `NotImplementedError` slik at siden viser fail-closed-banner og admin
// ikke blir villedet til å tro at rapporten er tilgjengelig.
//
// Når BIN-628 lander: bytt implementasjonen av funksjonene under til
// ekte apiRequest-calls mot backend.

export class NotImplementedError extends Error {
  readonly issue: string;
  constructor(issue: string, message: string) {
    super(message);
    this.name = "NotImplementedError";
    this.issue = issue;
  }
}

export interface TrackSpendingRow {
  userId: string;
  customerNumber: string;
  username: string;
  totalDeposit: number;
  totalBet: number;
  betPercentage: number;
  hallId: string | null;
  hallName: string | null;
}

export interface TrackSpendingParams {
  dateFrom?: string;
  dateTo?: string;
  minDeposit?: number;
  minBetPct?: number;
  hallId?: string;
  limit?: number;
  offset?: number;
}

/**
 * Aggregat over spillere for regulatorisk oppfølging (pengespillforskriften §11).
 * **STUB:** Kaster NotImplementedError fram til BIN-628 lander. Viser fail-closed
 * banner i UI-et framfor å returnere tom/fake-data.
 */
export async function fetchTrackSpending(_params: TrackSpendingParams): Promise<TrackSpendingRow[]> {
  throw new NotImplementedError(
    "BIN-628",
    "GET /api/admin/track-spending aggregat-endpoint er ikke implementert. Regulatorisk rapport kommer."
  );
}

export interface TrackSpendingTransactionsResult {
  player: {
    id: string;
    customerNumber: string;
    username: string;
  };
  summary: {
    totalDeposit: number;
    totalBet: number;
    betPercentage: number;
  };
  transactions: Array<{
    id: string;
    type: string;
    amount: number;
    createdAt: string;
  }>;
}

/**
 * Per-spiller drill-down. **STUB** — dekkes av BIN-628 (samme endpoint-familie).
 */
export async function fetchTrackSpendingTransactions(
  _userId: string,
  _params: { dateFrom?: string; dateTo?: string }
): Promise<TrackSpendingTransactionsResult> {
  throw new NotImplementedError(
    "BIN-628",
    "GET /api/admin/track-spending/:userId/transactions er ikke implementert."
  );
}

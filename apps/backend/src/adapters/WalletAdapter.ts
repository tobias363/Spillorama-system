export type WalletTransactionType =
  | "DEBIT"
  | "CREDIT"
  | "TOPUP"
  | "WITHDRAWAL"
  | "TRANSFER_OUT"
  | "TRANSFER_IN";

/**
 * PR-W1 wallet-split: hvilken logisk konto ("side") en credit-operasjon
 * målretter, eller en debit-entry trakk fra.
 *
 * - `deposit`  — brukerens innskudd. Målet for topup, refund, admin-correction.
 *                Eneste konto som teller mot Spillvett-tapsgrense.
 * - `winnings` — gevinster fra spill (payout). Trekkes først ved kjøp
 *                (winnings-first-policy). Admin-credit IKKE TILLATT —
 *                regulatorisk forbud: eneste credit-kilde er game-engine.
 */
export type WalletAccountSide = "deposit" | "winnings";

export interface WalletAccount {
  id: string;
  /**
   * Sum av deposit + winnings. Bakoverkompatibel total-saldo.
   *
   * For split-bevisst kode, bruk `depositBalance` / `winningsBalance` eller
   * `getBothBalances(walletId)`.
   */
  balance: number;
  /** PR-W1: brukerens innskudd. Loss-limit teller kun trekk herfra. */
  depositBalance: number;
  /** PR-W1: gevinster fra spill. Trekkes først ved kjøp. */
  winningsBalance: number;
  createdAt: string;
  updatedAt: string;
}

export class WalletError extends Error {
  public readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export interface WalletTransaction {
  id: string;
  accountId: string;
  type: WalletTransactionType;
  amount: number;
  reason: string;
  createdAt: string;
  relatedAccountId?: string;
  /**
   * PR-W1 wallet-split: hvordan beløpet fordelte seg mellom deposit- og
   * winnings-siden. Satt på DEBIT-transaksjoner etter winnings-first-splitt,
   * og på CREDIT-transaksjoner for å markere målkonto.
   *
   * Eksempel: debit kr 150 der winnings hadde kr 50 →
   *   `{ fromWinnings: 50, fromDeposit: 100 }`.
   *
   * `undefined` på legacy-transaksjoner fra før split-aktivering (backward-compat).
   */
  split?: WalletTransactionSplit;
}

/**
 * PR-W1 wallet-split: beskriver hvordan en transaksjon fordelte seg mellom
 * deposit- og winnings-siden av en wallet. Alltid kroner (major-units), aldri
 * cents — matcher `amount`-kontrakten ellers i interfacet.
 */
export interface WalletTransactionSplit {
  /** Beløp trukket fra / kreditert til winnings-siden. 0 hvis kun deposit. */
  fromWinnings: number;
  /** Beløp trukket fra / kreditert til deposit-siden. 0 hvis kun winnings. */
  fromDeposit: number;
}

export interface CreateWalletAccountInput {
  accountId?: string;
  initialBalance?: number;
  allowExisting?: boolean;
}

export interface WalletTransferResult {
  fromTx: WalletTransaction;
  toTx: WalletTransaction;
}

/** BIN-162: Options for wallet operations — supports idempotency. */
export interface TransactionOptions {
  /** If provided, duplicate calls with the same key return the original result. */
  idempotencyKey?: string;
}

/**
 * PR-W1 wallet-split: options for `credit()` — target account side.
 *
 * `to` styrer hvilken side en credit lander på:
 * - `"deposit"`  — topup, refund, manuell innskudd-korrigering (default).
 * - `"winnings"` — gevinst fra spill (Game1PayoutService, BingoEngine payout).
 *
 * Hvis ikke angitt: `"deposit"` (bakoverkompat — eksisterende callers som
 * ikke vet om split treffer samme konto som før split-aktivering).
 *
 * **Regulatorisk:** `to: "winnings"` skal KUN brukes av game-engine.
 * Admin-routes, topup-endepunkt og refund-flyt må aldri sende `"winnings"` —
 * det ville tilsvare admin-bonus, som er forbudt per pengespillforskriften.
 */
export interface CreditOptions extends TransactionOptions {
  to?: WalletAccountSide;
}

/**
 * CRIT-5 (SPILL1_CASINO_GRADE_REVIEW_2026-04-26): options for
 * `creditWithClient()` — credit-flyt som kjører i en allerede-åpen
 * transaksjon kontrollert av caller.
 *
 * Brukes av Game1MiniGameOrchestrator slik at wallet-credit + UPDATE av
 * `app_game1_mini_game_results.completed_at` skjer i samme atomiske
 * transaksjon. Uten dette: hvis credit committet og UPDATE feilet, var
 * payout betalt ut men `completed_at` var fortsatt NULL → audit-trail
 * divergerte (RNG ble kalt på nytt ved retry og loggboken viste siste
 * resultat, men payout hadde første resultat).
 *
 * Implementasjons-krav (per adapter):
 * - PostgresWalletAdapter bruker passed client uten å åpne ny BEGIN/COMMIT.
 * - InMemoryWalletAdapter ignorerer client (single-threaded JS, ingen tx-grenser).
 * - File/Http-adaptere kan implementere som alias for `credit` (best-effort).
 *
 * `client` er `unknown` siden PoolClient er Postgres-spesifikk; konkrete
 * adaptere narrower til riktig type.
 */
export interface CreditWithClientOptions extends CreditOptions {
  /** Postgres PoolClient (eller equivalent). Adapter narrower til konkret type. */
  client: unknown;
}

/**
 * PR-W3 wallet-split: options for `transfer()` — target account-side for
 * CREDIT-siden av transferen (mottaker-kontoen).
 *
 * `targetSide` styrer hvilken side mottakeren får beløpet på:
 * - `"deposit"`  — refund (house → player refund), default-oppførsel.
 * - `"winnings"` — payout (house → player gevinst), brukes av BingoEngine,
 *                  Game2Engine, Game3Engine når de gjør `transfer(house → player)`
 *                  for premier.
 *
 * System-kontoer (`is_system=true`) ignorerer `targetSide` og lander alltid på
 * deposit-siden — systemkontoer har ingen winnings-saldo (CHECK-constraint i
 * wallet_accounts.winnings_balance = 0 for system-kontoer).
 *
 * Default: `"deposit"` for bakover-kompat — eksisterende callers som ikke vet
 * om split treffer samme konto som før PR-W3.
 *
 * **Regulatorisk:** `targetSide: "winnings"` skal KUN brukes av game-engine
 * for payout. Admin-ruter for manuelle korrigeringer må aldri sende `"winnings"` —
 * samme prinsipp som `CreditOptions.to`. Se adminWallet.ts for gate-implementasjon.
 */
export interface TransferOptions extends TransactionOptions {
  targetSide?: WalletAccountSide;
}

/**
 * PR-W1 wallet-split: saldo-breakdown for split-bevisst kode.
 *
 * `total = deposit + winnings`. Bakover-kompatibelt med `WalletAccount.balance`.
 */
export interface WalletBalance {
  deposit: number;
  winnings: number;
  total: number;
}

/**
 * BIN-693 Option B: Wallet-reservasjon for pre-round bong-kjøp.
 *
 * Mønster: kredittkort-autorisasjon. Reservasjonen holder beløpet "låst"
 * uten at wallet_accounts.deposit_balance/winnings_balance endres. Ved
 * commit konverteres reservasjonen til en faktisk wallet-transfer
 * (samme kode-path som før — ingen endring i compliance-ledger).
 *
 * Lifecycle:
 *   active → committed (startGame)
 *   active → released (cancel / game-abort)
 *   active → expired (TTL passert + bakgrunns-tick)
 */
export interface WalletReservation {
  id: string;
  walletId: string;
  amount: number;
  idempotencyKey: string;
  status: "active" | "released" | "committed" | "expired";
  roomCode: string;
  gameSessionId: string | null;
  createdAt: string;
  releasedAt: string | null;
  committedAt: string | null;
  expiresAt: string;
}

export interface ReserveOptions {
  idempotencyKey: string;
  roomCode: string;
  /** Default 30 min hvis ikke satt. Ikke brukt for InMemory-adapter (TTL enforced av expiry-tick-service). */
  expiresAt?: string;
}

export interface CommitReservationOptions extends TransferOptions {
  gameSessionId?: string;
}

export interface WalletAdapter {
  createAccount(input?: CreateWalletAccountInput): Promise<WalletAccount>;
  ensureAccount(accountId: string): Promise<WalletAccount>;
  getAccount(accountId: string): Promise<WalletAccount>;
  listAccounts(): Promise<WalletAccount[]>;
  /** Total-saldo (deposit + winnings). Bakover-kompatibelt. */
  getBalance(accountId: string): Promise<number>;
  /** PR-W1: kun innskudd-siden. Brukes for loss-limit-beregning. */
  getDepositBalance(accountId: string): Promise<number>;
  /** PR-W1: kun gevinst-siden. */
  getWinningsBalance(accountId: string): Promise<number>;
  /** PR-W1: både sider + total i én spørring (unngår dobbel-roundtrip mot DB). */
  getBothBalances(accountId: string): Promise<WalletBalance>;
  /**
   * Debit — trekker fra wallet med winnings-first-policy.
   *
   * Implementasjon aktiveres i PR-W2. I PR-W1 trekker debit fortsatt fra
   * deposit-siden (samme netto-oppførsel som før split for eksisterende
   * testsuiter). Returverdien inkluderer `split`-feltet så kall-sites kan
   * forberede loss-limit-integrasjon i PR-W5.
   */
  debit(accountId: string, amount: number, reason: string, options?: TransactionOptions): Promise<WalletTransaction>;
  /**
   * Credit — kreder wallet. `options.to` velger målkonto (`"deposit"` default).
   *
   * **Regulatorisk-krav:** `to: "winnings"` er kun tillatt fra game-engine
   * (payout-flyt). Admin-routes kan aldri sende `"winnings"` — se
   * CreditOptions-JSDoc.
   */
  credit(accountId: string, amount: number, reason: string, options?: CreditOptions): Promise<WalletTransaction>;
  /**
   * CRIT-5 (SPILL1_CASINO_GRADE_REVIEW_2026-04-26): credit som deltar i
   * caller's allerede-åpne transaksjon. Optional — adaptere som ikke
   * støtter dette kan utelate, og caller faller tilbake til `credit()`.
   *
   * Når implementert: skal IKKE åpne ny BEGIN/COMMIT — kall direkte mot
   * den passede client. Idempotency-key respekteres som vanlig.
   *
   * Bruk-mønster (Game1MiniGameOrchestrator):
   *
   * ```ts
   * await pool.connect().then(async (client) => {
   *   await client.query("BEGIN");
   *   await walletAdapter.creditWithClient?.(account, amount, reason, {
   *     client,
   *     idempotencyKey,
   *     to: "winnings",
   *   });
   *   await client.query("UPDATE ... SET completed_at = now() ...");
   *   await client.query("COMMIT");
   * });
   * ```
   */
  creditWithClient?(accountId: string, amount: number, reason: string, options: CreditWithClientOptions): Promise<WalletTransaction>;
  /** Topup — alltid til deposit-siden (PM-beslutning, ikke overstyrbar). */
  topUp(accountId: string, amount: number, reason?: string, options?: TransactionOptions): Promise<WalletTransaction>;
  /** Withdraw — winnings-first-policy (PM-beslutning). */
  withdraw(accountId: string, amount: number, reason?: string, options?: TransactionOptions): Promise<WalletTransaction>;
  /**
   * Transfer — flytter beløp mellom to wallets.
   *
   * Avsender-siden bruker winnings-first-policy (som debit). Mottaker-siden
   * lander som default på deposit-konto. `options.targetSide` kan overstyre
   * til winnings — brukes av game-engine for payout-transfer (house → player).
   *
   * System-kontoer ignorerer `targetSide` (systemkontoer har ingen winnings).
   *
   * **Regulatorisk:** `targetSide: "winnings"` er kun tillatt fra game-engine
   * (payout-flyt). Admin-routes kan aldri sende `"winnings"` — se
   * TransferOptions-JSDoc.
   */
  transfer(fromAccountId: string, toAccountId: string, amount: number, reason?: string, options?: TransferOptions): Promise<WalletTransferResult>;
  listTransactions(accountId: string, limit?: number): Promise<WalletTransaction[]>;

  // ── BIN-693 Option B: Wallet-reservasjon (optional per adapter) ───────────
  //
  // Alle metoder er optional så test-lokale minimal-adaptere slipper å
  // implementere dem når de kun tester eksisterende wallet-funksjonalitet.
  // Produksjons-adaptere (InMemory, File, Postgres, Http) impl-erer dem.
  //
  // Callers som bruker reserve-flyten (bet:arm, ticket:cancel, startGame)
  // må kaste eksplisitt feil hvis `adapter.reserve` er undefined — det
  // betyr at deploye-t adapter ikke støtter Option B-flyten og admin må
  // velge en annen adapter (fail-fast framfor silent downgrade).

  /** BIN-693: tilgjengelig saldo = total − sum(active reservations). */
  getAvailableBalance?: (accountId: string) => Promise<number>;

  /** Opprett reservasjon. Kaster INSUFFICIENT_FUNDS / IDEMPOTENCY_MISMATCH. */
  reserve?: (accountId: string, amount: number, options: ReserveOptions) => Promise<WalletReservation>;

  /**
   * Øk eksisterende aktiv reservasjon med `extraAmount`. Additive bet:arm-
   * flyt bruker dette når spiller kjøper flere bonger enn allerede reservert
   * for rommet. Kaster INSUFFICIENT_FUNDS hvis tilgjengelig saldo er for lav.
   */
  increaseReservation?: (reservationId: string, extraAmount: number) => Promise<WalletReservation>;

  /** Frigi reservasjon. Full (amount omitted) eller partial prorata. */
  releaseReservation?: (reservationId: string, amount?: number) => Promise<WalletReservation>;

  /** Konverter aktiv reservasjon til faktisk transfer. Status → 'committed'. */
  commitReservation?: (
    reservationId: string,
    toAccountId: string,
    reason: string,
    options?: CommitReservationOptions,
  ) => Promise<WalletTransferResult>;

  /** Aktive reservasjoner tilhørende en wallet. */
  listActiveReservations?: (accountId: string) => Promise<WalletReservation[]>;

  /** Reservasjoner i ett rom (for game-abort release-all). */
  listReservationsByRoom?: (roomCode: string) => Promise<WalletReservation[]>;

  /** Bakgrunns-tick: marker stale reservations som expired. */
  expireStaleReservations?: (nowMs: number) => Promise<number>;
}

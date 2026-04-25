/**
 * Kanoniske idempotency-keys for wallet-operasjoner (PR-N1).
 *
 * Forhindrer format-drift og kollisjoner. Alle idempotency-keys som skal
 * sendes til WalletAdapter.debit / credit / transfer bør genereres via
 * denne modulen. Call-sites importerer `IdempotencyKeys.<type>({...})`
 * heller enn å konstruere template-strings inline.
 *
 * ## Format-invarianter
 *
 * - Prefix per domene:
 *     - `g1-`     — Spill 1 scheduled games
 *     - `g2-` / `g3-` — Spill 2/3 ad-hoc rooms
 *     - `adhoc-`  — Generiske BingoEngine ad-hoc rooms
 *     - `buyin-`, `phase-`, `line-prize-`, `bingo-prize-`, `jackpot-`,
 *       `minigame-`, `extra-prize-`, `refund-`, `ticket-replace-` —
 *       ad-hoc room-livssyklus (BingoEngine)
 *     - `game1-purchase:` / `game1-refund:` — Spill 1 ticket purchase-flyt
 *     - `payment-request:` — Manuelt innskudd/uttak (BIN-586)
 *     - `agent-tx:` / `agent-ticket:` / `agent-shift:` — Agent-operasjoner
 *     - `product-sale:` — Kioskvare-salg i hall
 *     - `okbingo:` / `metronia:` — Automat-ticket-integrasjoner
 * - Kebab-case / colon-separert struktur
 * - Ingen spaces, ingen special chars utover `-` og `:`
 *
 * ## Byte-identitet-krav (KRITISK)
 *
 * Idempotency-keys som allerede finnes i wallet_ledger i produksjon
 * MÅ ikke endres i format, ellers vil retry av en eksisterende operasjon
 * produsere et nytt ledger-entry istedenfor å hit'e den eksisterende og
 * returnere den forrige transaksjonen. Dvs. helper-funksjonene her
 * returnerer NØYAKTIG samme streng som de tidligere inline template-
 * literals gjorde.
 *
 * ## Hvordan legge til ny type
 *
 * 1. Bekreft med PM at du har et nytt key-scope (ikke bruk eksisterende
 *    hvis det matcher et eksisterende scope).
 * 2. Legg til en ny builder-funksjon her, med JSDoc som peker til call-
 *    site(ene).
 * 3. Legg til en enhetstest i idempotency.test.ts som verifiserer
 *    determinisme og format.
 */

export const IdempotencyKeys = {
  // === Spill 1 scheduled-games =================================================

  /**
   * Game1PayoutService.payoutPhase — én per (scheduledGameId, phase, assignmentId).
   * Se apps/backend/src/game/Game1PayoutService.ts.
   */
  game1Phase: (params: {
    scheduledGameId: string;
    phase: string | number;
    assignmentId: string;
  }): string =>
    `g1-phase-${params.scheduledGameId}-${params.phase}-${params.assignmentId}`,

  /**
   * Game1DrawEngineService jackpott-pot-evaluator — én per (hallId, scheduledGameId).
   * Se apps/backend/src/game/Game1DrawEngineService.ts.
   */
  game1Jackpot: (params: { hallId: string; scheduledGameId: string }): string =>
    `g1-jackpot-${params.hallId}-${params.scheduledGameId}`,

  /**
   * PotEvaluator (Innsatsen + Jackpott + generiske pots) — én per (potId, scheduledGameId).
   * Se apps/backend/src/game/pot/PotEvaluator.ts.
   */
  game1Pot: (params: { potId: string; scheduledGameId: string }): string =>
    `g1-pot-${params.potId}-${params.scheduledGameId}`,

  /**
   * Game1LuckyBonusService — én per (scheduledGameId, winnerId) for lucky
   * number bonus-credit. Se apps/backend/src/game/Game1LuckyBonusService.ts
   * + kall-sted i Game1DrawEngineService.payoutLuckyBonusForFullHouseWinners.
   * Format: `g1-lucky-bonus-{scheduledGameId}-{winnerId}`
   * (byte-identisk mot PM-spec fra K1-C-task).
   */
  game1LuckyBonus: (params: {
    scheduledGameId: string;
    winnerId: string;
  }): string =>
    `g1-lucky-bonus-${params.scheduledGameId}-${params.winnerId}`,

  /**
   * Game1TicketPurchaseService.purchase — én per purchaseIdempotencyKey fra klient.
   * Se apps/backend/src/game/Game1TicketPurchaseService.ts.
   */
  game1PurchaseDebit: (params: { clientIdempotencyKey: string }): string =>
    `game1-purchase:${params.clientIdempotencyKey}:debit`,

  /**
   * Game1TicketPurchaseService.purchase — kompensasjons-credit ved feilet INSERT
   * (ikke-23505). Brukes til å rulle tilbake wallet-debit når INSERT av
   * purchase-rad feiler etter wallet er debitert (FK-violation, transient
   * connection-død, etc). Idempotent: ved retry treffer wallet-adapterens
   * dedup på samme key og dobbel-kreditering forhindres.
   * Se apps/backend/src/game/Game1TicketPurchaseService.ts (issue 2 fra
   * Spill 1 review #499).
   */
  game1PurchaseCompensate: (params: { clientIdempotencyKey: string }): string =>
    `game1-purchase:${params.clientIdempotencyKey}:compensate`,

  /**
   * Game1TicketPurchaseService.refundPurchase — én per purchaseId.
   * Se apps/backend/src/game/Game1TicketPurchaseService.ts.
   */
  game1RefundCredit: (params: { purchaseId: string }): string =>
    `game1-refund:${params.purchaseId}:credit`,

  // === Spill 1 mini-games ======================================================

  /**
   * Game1MiniGameOrchestrator — én per resultId (cross-minigame key, satt av
   * orchestrator for alle mini-game-typer: Wheel, Chest, Colordraft).
   * Se apps/backend/src/game/minigames/Game1MiniGameOrchestrator.ts.
   */
  game1MiniGame: (params: { resultId: string }): string =>
    `g1-minigame-${params.resultId}`,

  /**
   * MiniGameOddsenEngine.resolveForGame — én per oddsenStateId (cross-round).
   * Skiller seg fra game1MiniGame fordi Oddsen har flere round-trigger over
   * samme mini-game-state.
   * Se apps/backend/src/game/minigames/MiniGameOddsenEngine.ts.
   */
  game1Oddsen: (params: { stateId: string }): string =>
    `g1-oddsen-${params.stateId}`,

  // === Spill 2 / Spill 3 =======================================================

  /**
   * Game2Engine jackpot prize — én per (gameId, claimId).
   * Se apps/backend/src/game/Game2Engine.ts.
   */
  game2Jackpot: (params: { gameId: string; claimId: string }): string =>
    `g2-jackpot-${params.gameId}-${params.claimId}`,

  /**
   * Game2Engine lucky prize — én per (gameId, claimId).
   * Se apps/backend/src/game/Game2Engine.ts.
   */
  game2Lucky: (params: { gameId: string; claimId: string }): string =>
    `g2-lucky-${params.gameId}-${params.claimId}`,

  /**
   * Game3Engine pattern prize — én per (gameId, claimId).
   * Se apps/backend/src/game/Game3Engine.ts.
   */
  game3Pattern: (params: { gameId: string; claimId: string }): string =>
    `g3-pattern-${params.gameId}-${params.claimId}`,

  /**
   * Game3Engine lucky prize — én per (gameId, claimId).
   * Se apps/backend/src/game/Game3Engine.ts.
   */
  game3Lucky: (params: { gameId: string; claimId: string }): string =>
    `g3-lucky-${params.gameId}-${params.claimId}`,

  // === BingoEngine (ad-hoc rooms — Spill 2/3 + Spillorama) =====================

  /**
   * BingoEngine start-game buy-in transfer — én per (gameId, playerId).
   * Se apps/backend/src/game/BingoEngine.ts (startGame).
   */
  adhocBuyIn: (params: { gameId: string; playerId: string }): string =>
    `buyin-${params.gameId}-${params.playerId}`,

  /**
   * BingoEngine phase-prize payout (ad-hoc) — én per (patternId, gameId, playerId).
   * Se apps/backend/src/game/BingoEngine.ts.
   */
  adhocPhase: (params: {
    patternId: string;
    gameId: string;
    playerId: string;
  }): string =>
    `phase-${params.patternId}-${params.gameId}-${params.playerId}`,

  /**
   * BingoEngine line-prize payout — én per (gameId, claimId).
   * Se apps/backend/src/game/BingoEngine.ts.
   */
  adhocLinePrize: (params: { gameId: string; claimId: string }): string =>
    `line-prize-${params.gameId}-${params.claimId}`,

  /**
   * BingoEngine bingo-prize (full house) payout — én per (gameId, claimId).
   * Se apps/backend/src/game/BingoEngine.ts.
   */
  adhocBingoPrize: (params: { gameId: string; claimId: string }): string =>
    `bingo-prize-${params.gameId}-${params.claimId}`,

  /**
   * BingoEngine jackpot spin payout — én per (gameId, playedSpins).
   * Se apps/backend/src/game/BingoEngine.ts.
   */
  adhocJackpot: (params: {
    gameId: string;
    playedSpins: number | string;
  }): string => `jackpot-${params.gameId}-spin-${params.playedSpins}`,

  /**
   * BingoEngine mini-game prize (ad-hoc, inline minigame-flyt) —
   * én per (gameId, miniGameType).
   * Se apps/backend/src/game/BingoEngine.ts.
   */
  adhocMiniGame: (params: { gameId: string; miniGameType: string }): string =>
    `minigame-${params.gameId}-${params.miniGameType}`,

  /**
   * BingoEngine extra-prize payout — én per extraPrizeId.
   * Se apps/backend/src/game/BingoEngine.ts.
   */
  adhocExtraPrize: (params: { extraPrizeId: string }): string =>
    `extra-prize-${params.extraPrizeId}`,

  /**
   * BingoEngine start-failure refund — én per (gameId, playerId).
   * Se apps/backend/src/game/BingoEngine.ts.
   */
  adhocRefund: (params: { gameId: string; playerId: string }): string =>
    `refund-${params.gameId}-${params.playerId}`,

  /**
   * sockets/gameEvents ticket:replace — én per (roomCode, playerId, ticketId).
   * Se apps/backend/src/sockets/gameEvents.ts.
   */
  adhocTicketReplace: (params: {
    roomCode: string;
    playerId: string;
    ticketId: string;
  }): string =>
    `ticket-replace-${params.roomCode}-${params.playerId}-${params.ticketId}`,

  // === Payment-requests (BIN-586 manuell deposit/withdraw) =====================

  /**
   * PaymentRequestService.accept — én per (kind, requestId).
   * Se apps/backend/src/payments/PaymentRequestService.ts.
   */
  paymentRequest: (params: {
    kind: "deposit" | "withdraw" | string;
    requestId: string;
  }): string => `payment-request:${params.kind}:${params.requestId}`,

  // === Agent-operasjoner (B3.x) ================================================

  /**
   * AgentTransactionService cash-in/cash-out wallet-delta — én per txId.
   * Se apps/backend/src/agent/AgentTransactionService.ts.
   */
  agentTxWallet: (params: { txId: string }): string =>
    `agent-tx:${params.txId}:wallet`,

  /**
   * AgentTransactionService cancel — én per originalTxId.
   * Se apps/backend/src/agent/AgentTransactionService.ts.
   */
  agentTxCancel: (params: { originalTxId: string }): string =>
    `agent-tx:${params.originalTxId}:cancel`,

  /**
   * AgentTransactionService physical-ticket sale (WALLET payment) —
   * én per ticketUniqueId.
   * Se apps/backend/src/agent/AgentTransactionService.ts.
   */
  agentPhysicalSell: (params: { ticketUniqueId: string }): string =>
    `agent-ticket:${params.ticketUniqueId}:sell:wallet`,

  /**
   * AgentTransactionService digital-ticket register — én per
   * (gameId, playerUserId, clientRequestId).
   * Se apps/backend/src/agent/AgentTransactionService.ts.
   */
  agentDigitalTicket: (params: {
    gameId: string;
    playerUserId: string;
    clientRequestId: string;
  }): string =>
    `agent-ticket:digital:${params.gameId}:${params.playerUserId}:${params.clientRequestId}`,

  /**
   * AgentProductSaleService.sell (WALLET/CUSTOMER_NUMBER payment) —
   * én per cartId.
   * Se apps/backend/src/agent/AgentProductSaleService.ts.
   */
  agentProductSale: (params: { cartId: string }): string =>
    `product-sale:${params.cartId}:wallet`,

  // === Eksterne ticket-integrasjoner ===========================================
  //
  // OK Bingo og Metronia bruker et `uniqueTransaction`-prefix med form
  // `{machine}:{action}:{ticketId}:{clientReq}` eller `{machine}:void:{ticketId}`.
  // Wallet-idempotency-keys legger til suffix `:credit` eller `:refund`.
  // Disse er allerede byte-identiske mot legacy-kode via template-literals;
  // helperne her kapsler bare suffix-konkateneringen.

  /**
   * OK Bingo / Metronia refund etter feilet create/topup — suffix `:refund`
   * på `uniqueTransaction`.
   * Se apps/backend/src/agent/OkBingoTicketService.ts +
   * apps/backend/src/agent/MetroniaTicketService.ts.
   */
  machineRefund: (params: { uniqueTransaction: string }): string =>
    `${params.uniqueTransaction}:refund`,

  /**
   * OK Bingo / Metronia payout credit ved close/void — suffix `:credit`
   * på `uniqueTransaction`.
   * Se apps/backend/src/agent/OkBingoTicketService.ts +
   * apps/backend/src/agent/MetroniaTicketService.ts.
   */
  machineCredit: (params: { uniqueTransaction: string }): string =>
    `${params.uniqueTransaction}:credit`,
} as const;

/**
 * Regex som matcher alle gyldige idempotency-keys generert av
 * `IdempotencyKeys`. Brukes av enhetstesten for å forhindre at nye
 * format-variasjoner sniker seg inn uten review.
 *
 * Tillatt: a-z, A-Z, 0-9, `-`, `:`. Må ikke være tom. Ingen spaces.
 */
export const IDEMPOTENCY_KEY_FORMAT = /^[A-Za-z0-9][A-Za-z0-9:\-]*$/;

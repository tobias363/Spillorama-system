/**
 * Bingo scheduler settings helpers.
 * Extracted from index.ts — holds no mutable state itself; mutable
 * state is the BingoSchedulerSettings object owned by index.ts.
 */
import { DomainError } from "../game/BingoEngine.js";
import {
  parseOptionalBooleanInput,
  parseOptionalPositiveInteger,
  parseOptionalNonNegativeNumber,
} from "./httpHelpers.js";

export interface BingoSchedulerSettings {
  autoRoundStartEnabled: boolean;
  autoRoundStartIntervalMs: number;
  autoRoundMinPlayers: number;
  autoRoundTicketsPerPlayer: number;
  autoRoundEntryFee: number;
  payoutPercent: number;
  autoDrawEnabled: boolean;
  autoDrawIntervalMs: number;
}

export interface BingoSettingsConstraints {
  fixedAutoDrawIntervalMs: number;
  bingoMinRoundIntervalMs: number;
  bingoMinPlayersToStart: number;
  autoplayAllowed: boolean;
  forceAutoStart: boolean;
  forceAutoDraw: boolean;
}

export function parseBingoSettingsPatch(
  value: unknown,
  constraints: BingoSettingsConstraints
): Partial<BingoSchedulerSettings> {
  if (value === undefined || value === null) {
    return {};
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new DomainError("INVALID_INPUT", "Payload må være et objekt.");
  }

  const payload = value as Record<string, unknown>;
  const patch: Partial<BingoSchedulerSettings> = {};

  const autoRoundStartEnabled = parseOptionalBooleanInput(payload.autoRoundStartEnabled, "autoRoundStartEnabled");
  if (autoRoundStartEnabled !== undefined) patch.autoRoundStartEnabled = autoRoundStartEnabled;

  const autoRoundStartIntervalMs = parseOptionalPositiveInteger(payload.autoRoundStartIntervalMs, "autoRoundStartIntervalMs");
  if (autoRoundStartIntervalMs !== undefined) patch.autoRoundStartIntervalMs = autoRoundStartIntervalMs;

  const autoRoundMinPlayers = parseOptionalPositiveInteger(payload.autoRoundMinPlayers, "autoRoundMinPlayers");
  if (autoRoundMinPlayers !== undefined) patch.autoRoundMinPlayers = autoRoundMinPlayers;

  const autoRoundTicketsPerPlayer = parseOptionalPositiveInteger(payload.autoRoundTicketsPerPlayer, "autoRoundTicketsPerPlayer");
  if (autoRoundTicketsPerPlayer !== undefined) patch.autoRoundTicketsPerPlayer = autoRoundTicketsPerPlayer;

  const autoRoundEntryFee = parseOptionalNonNegativeNumber(payload.autoRoundEntryFee, "autoRoundEntryFee");
  if (autoRoundEntryFee !== undefined) patch.autoRoundEntryFee = autoRoundEntryFee;

  const payoutPercent = parseOptionalNonNegativeNumber(payload.payoutPercent, "payoutPercent");
  if (payoutPercent !== undefined) {
    if (payoutPercent > 100) {
      throw new DomainError("INVALID_INPUT", "payoutPercent må være mellom 0 og 100.");
    }
    patch.payoutPercent = payoutPercent;
  }

  const autoDrawEnabled = parseOptionalBooleanInput(payload.autoDrawEnabled, "autoDrawEnabled");
  if (autoDrawEnabled !== undefined) patch.autoDrawEnabled = autoDrawEnabled;

  const autoDrawIntervalMs = parseOptionalPositiveInteger(payload.autoDrawIntervalMs, "autoDrawIntervalMs");
  if (autoDrawIntervalMs !== undefined && autoDrawIntervalMs !== constraints.fixedAutoDrawIntervalMs) {
    throw new DomainError("INVALID_INPUT", `autoDrawIntervalMs er låst til ${constraints.fixedAutoDrawIntervalMs} ms.`);
  }
  if (autoDrawIntervalMs !== undefined) patch.autoDrawIntervalMs = constraints.fixedAutoDrawIntervalMs;

  return patch;
}

export function normalizeBingoSchedulerSettings(
  current: BingoSchedulerSettings,
  patch: Partial<BingoSchedulerSettings>,
  constraints: BingoSettingsConstraints
): BingoSchedulerSettings {
  const next: BingoSchedulerSettings = {
    autoRoundStartEnabled: patch.autoRoundStartEnabled !== undefined ? patch.autoRoundStartEnabled : current.autoRoundStartEnabled,
    autoRoundStartIntervalMs: patch.autoRoundStartIntervalMs !== undefined ? patch.autoRoundStartIntervalMs : current.autoRoundStartIntervalMs,
    autoRoundMinPlayers: patch.autoRoundMinPlayers !== undefined ? patch.autoRoundMinPlayers : current.autoRoundMinPlayers,
    autoRoundTicketsPerPlayer: patch.autoRoundTicketsPerPlayer !== undefined ? patch.autoRoundTicketsPerPlayer : current.autoRoundTicketsPerPlayer,
    autoRoundEntryFee: patch.autoRoundEntryFee !== undefined ? patch.autoRoundEntryFee : current.autoRoundEntryFee,
    payoutPercent: patch.payoutPercent !== undefined ? patch.payoutPercent : current.payoutPercent,
    autoDrawEnabled: patch.autoDrawEnabled !== undefined ? patch.autoDrawEnabled : current.autoDrawEnabled,
    autoDrawIntervalMs: patch.autoDrawIntervalMs !== undefined ? patch.autoDrawIntervalMs : current.autoDrawIntervalMs
  };

  const { fixedAutoDrawIntervalMs, bingoMinRoundIntervalMs, bingoMinPlayersToStart, autoplayAllowed, forceAutoStart, forceAutoDraw } = constraints;

  next.autoRoundStartIntervalMs = Math.max(bingoMinRoundIntervalMs, Math.floor(next.autoRoundStartIntervalMs));
  if (forceAutoStart) next.autoRoundStartEnabled = true;
  if (forceAutoDraw) next.autoDrawEnabled = true;
  next.autoRoundMinPlayers = Math.max(bingoMinPlayersToStart, Math.floor(next.autoRoundMinPlayers));
  next.autoRoundTicketsPerPlayer = Math.min(30, Math.max(1, Math.floor(next.autoRoundTicketsPerPlayer)));
  next.autoRoundEntryFee = Math.max(0, Math.round(next.autoRoundEntryFee * 100) / 100);
  next.payoutPercent = Math.min(100, Math.max(0, Math.round(next.payoutPercent * 100) / 100));
  next.autoDrawIntervalMs = fixedAutoDrawIntervalMs;

  if (
    !autoplayAllowed &&
    ((next.autoRoundStartEnabled && !forceAutoStart) || (next.autoDrawEnabled && !forceAutoDraw))
  ) {
    throw new DomainError(
      "INVALID_INPUT",
      "Autoplay er deaktivert i production. Sett BINGO_ALLOW_AUTOPLAY_IN_PRODUCTION=true for aa aktivere autoStart/autoDraw."
    );
  }

  return next;
}

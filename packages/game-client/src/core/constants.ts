/**
 * Shared layout and sizing constants.
 * Centralizes magic numbers that were previously hardcoded across components.
 *
 * Values are in logical pixels (CSS pixels). Components should use these
 * as defaults and adapt based on actual screen dimensions where needed.
 */

// ── Layout spacing ──────────────────────────────────────────────────────────

/** Standard padding from screen edge to content */
export const SCREEN_PADDING = 20;

/** Gap between scrollable ticket cards */
export const TICKET_GAP = 12;

// ── Info bar ────────────────────────────────────────────────────────────────

/** Height of the PlayerInfoBar across all games */
export const INFO_BAR_HEIGHT = 40;

/** Font size for info bar text labels */
export const INFO_BAR_FONT_SIZE = 14;

// ── Drawn balls ─────────────────────────────────────────────────────────────

/** Default ball diameter for drawn-ball panels (Game 2) */
export const DRAWN_BALL_SIZE = 40;

/** Ball size for animated ball queue (Game 3) */
export const ANIMATED_BALL_SIZE = 52;

/** Default ball size for NumberBall component */
export const NUMBER_BALL_SIZE = 44;

/** Gap between drawn balls */
export const DRAWN_BALL_GAP = 4;

// ── Bingo grid ──────────────────────────────────────────────────────────────

/** Default cell size for 3×5 grids (Game 2, Game 5) */
export const CELL_SIZE_3x5 = 44;

/** Default cell size for 5×5 grids (Game 1, Game 3) */
export const CELL_SIZE_5x5 = 36;

/** Gap between grid cells */
export const CELL_GAP = 4;

// ── Chat panel ──────────────────────────────────────────────────────────────

/** Width of the chat sidebar panel */
export const CHAT_PANEL_WIDTH = 280;

/** Height of the chat input field */
export const CHAT_INPUT_HEIGHT = 40;

// ── Popups & overlays ───────────────────────────────────────────────────────

/** Default width for BuyPopup */
export const BUY_POPUP_WIDTH = 320;

/** Default height for BuyPopup */
export const BUY_POPUP_HEIGHT = 220;

/** Max width for EndScreen results dialog */
export const END_DIALOG_MAX_WIDTH = 400;

/** Height for EndScreen results dialog */
export const END_DIALOG_HEIGHT = 280;

// ── Claim buttons ───────────────────────────────────────────────────────────

/** Default width for claim buttons */
export const CLAIM_BUTTON_WIDTH = 140;

/** Height for claim buttons */
export const CLAIM_BUTTON_HEIGHT = 50;

/** Gap between paired claim buttons */
export const CLAIM_BUTTON_GAP = 10;

// ── Timing ──────────────────────────────────────────────────────────────────

/** Auto-dismiss delay for EndScreen (ms) */
export const END_SCREEN_AUTO_DISMISS_MS = 8000;

/** Auto-spin countdown for jackpot/mini-game overlays (seconds) */
export const AUTO_SPIN_COUNTDOWN_S = 10;

/** Spin animation duration (seconds) */
export const SPIN_DURATION_S = 5;

/** Number of full rotations during wheel spin */
export const SPIN_ROTATIONS = 5;

// ── Wheel ───────────────────────────────────────────────────────────────────

/** Number of segments on roulette/jackpot wheels */
export const WHEEL_SEGMENTS = 8;

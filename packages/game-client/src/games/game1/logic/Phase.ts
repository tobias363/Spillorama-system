/**
 * Game 1-fasemaskinen har 5 tilstander.
 *
 * - `LOADING`: før snapshot er applied + loader-sync (BIN-500).
 * - `WAITING`: ingen aktiv runde — countdown mot neste, buy-popup tilgjengelig.
 * - `PLAYING`: aktiv runde, spilleren har billetter.
 * - `SPECTATING` (BIN-507): aktiv runde, spilleren har 0 billetter — ser
 *   live trekning + kan kjøpe for neste runde.
 * - `ENDED`: runde avsluttet, resultater vises før auto-dismiss til WAITING.
 *
 * Sentralisert i denne filen så både Game1Controller og logic/-modulene
 * importerer samme definisjon (hindrer fremtidig drift).
 */
export type Phase = "LOADING" | "WAITING" | "PLAYING" | "SPECTATING" | "ENDED";

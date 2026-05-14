/**
 * 2026-05-14 (Tobias-direktiv) — "Dump State"-knapp for debug-HUD.
 *
 * Plasserer en knapp i HUD-en (eller en standalone DOM-host) som ved
 * klikk kaller `dumpState()` og oppdaterer en liten status-tekst med
 * resultatet ("✓ dumpet" eller "⚠ feil"). Samme stil som "Rapporter
 * bug"-knappen — gull-aksent på mørk bakgrunn.
 *
 * Designvalg:
 *   - DOM-only — ingen Pixi-avhengighet. Funker både i debug-HUD og i
 *     standalone test-pages.
 *   - Kun signatur-overflate: `mountStateDumpButton(host, providers, options)`.
 *     `providers` videresendes 1:1 til `dumpState()`.
 *   - Idempotent — flere mount-kall på samme host gir flere knapper
 *     (caller har ansvar for ikke å multi-mounte uten å fjerne første).
 *   - Tilgjengelighet — knappen har `aria-label`, status-tekst er
 *     `aria-live="polite"`.
 */

import {
  dumpState,
  type StateDumpProviders,
  type DumpStateOptions,
  type FrontendStateDump,
} from "./StateDumpTool.js";

export interface MountStateDumpButtonOptions extends DumpStateOptions {
  /** Etikett på knappen. Default "Dump State". */
  label?: string;
  /** Callback etter vellykket dump (tester). */
  onDumped?: (dump: FrontendStateDump) => void;
  /** Callback ved feil (tester). */
  onError?: (err: unknown) => void;
}

/**
 * Mount-result. Caller kan kalle `unmount()` for å fjerne både knapp og
 * status-tekst.
 */
export interface MountedStateDumpButton {
  /** Selve knapp-DOM-elementet. */
  button: HTMLButtonElement;
  /** Status-linjen under knappen. */
  status: HTMLDivElement;
  /** Wrapper-container som inneholder begge. */
  container: HTMLDivElement;
  /** Fjern wrapper fra DOM. */
  unmount: () => void;
  /** Programmatisk trigger (tester). */
  trigger: () => Promise<FrontendStateDump>;
}

/**
 * Mounter "Dump State"-knapp og tilhørende status-tekst i `host`.
 * Returnerer kontrollere for testing + unmount.
 */
export function mountStateDumpButton(
  host: HTMLElement,
  providers: StateDumpProviders,
  options: MountStateDumpButtonOptions = {},
): MountedStateDumpButton {
  const container = document.createElement("div");
  Object.assign(container.style, {
    display: "flex",
    flexDirection: "column",
    gap: "4px",
    padding: "6px 0",
    borderTop: "1px solid #4a3a14",
    marginTop: "6px",
  });
  container.setAttribute("data-testid", "state-dump-button-container");

  const button = document.createElement("button");
  button.setAttribute("type", "button");
  button.setAttribute("data-testid", "state-dump-button");
  button.setAttribute("aria-label", "Dump frontend-state til log og server");
  button.textContent = options.label ?? "Dump State";
  Object.assign(button.style, {
    background: "rgba(212, 175, 55, 0.15)",
    color: "#d4af37",
    border: "1px solid #d4af37",
    borderRadius: "4px",
    padding: "6px 10px",
    cursor: "pointer",
    fontFamily: "inherit",
    fontSize: "11px",
    fontWeight: "600",
    letterSpacing: "0.04em",
    textTransform: "uppercase",
  });

  const status = document.createElement("div");
  status.setAttribute("data-testid", "state-dump-status");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  Object.assign(status.style, {
    fontSize: "10px",
    color: "#9aa0a6",
    minHeight: "12px",
  });

  let inFlight = false;

  const doDump = async (): Promise<FrontendStateDump> => {
    if (inFlight) {
      // Multi-klikk fail-safe: tillat ny dump kun når forrige er ferdig
      throw new Error("Dump already in progress");
    }
    inFlight = true;
    button.disabled = true;
    status.textContent = "Dumper...";
    status.style.color = "#9aa0a6";
    try {
      const dump = await dumpState({ providers, ...options });
      status.textContent = `✓ Dump #${dump.dumpId.slice(0, 8)} (${new Date(
        dump.timestamp,
      ).toISOString().slice(11, 19)})`;
      status.style.color = "#3ddc84";
      options.onDumped?.(dump);
      return dump;
    } catch (err) {
      status.textContent = `⚠ Feil: ${String((err as Error).message ?? err).slice(0, 100)}`;
      status.style.color = "#ff5c5c";
      options.onError?.(err);
      throw err;
    } finally {
      inFlight = false;
      button.disabled = false;
    }
  };

  button.addEventListener("click", () => {
    void doDump().catch(() => {
      /* swallowed — status-line viser feilen */
    });
  });

  container.appendChild(button);
  container.appendChild(status);
  host.appendChild(container);

  return {
    button,
    status,
    container,
    unmount: () => {
      container.remove();
    },
    trigger: doDump,
  };
}

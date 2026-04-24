/**
 * Dev-only diagnostic for hunting residual "blinking" in the Game 1
 * overlay DOM. Kombinerer fire signal-kilder:
 *   1. MutationObserver — hvilken sub-tree + hva endret (childList/attr/text)
 *   2. animationstart / transitionstart — hvilken CSS-animasjon trigges
 *   3. Re-render-counter per komponent-class (g1-*, ticket-*, prize-pill, ...)
 *   4. Visuell flash-outline på muterende noder så Tobias ser hvor det blinker
 *
 * Aktivert kun når URL-en har `?diag=blink`-query-param. Når aktiv vises et
 * fixed-position panel øverst-til-høyre med top-noder per sekund + rullende
 * event-log (siste 40). Klikk i panelet for å toggle flash-highlight.
 */

interface BlinkEvent {
  t: number;
  label: string;
  kind: string;
  node: HTMLElement | null;
}

export function shouldInstallBlinkDiagnostic(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const params = new URLSearchParams(window.location.search);
    return params.get("diag") === "blink";
  } catch {
    return false;
  }
}

function labelFor(node: Node): { label: string; element: HTMLElement | null } {
  let el: HTMLElement | null =
    node.nodeType === 1 ? (node as HTMLElement) : node.parentElement;
  while (el) {
    if (el.classList && el.classList.length > 0) {
      const recognised = Array.from(el.classList).find(
        (x) =>
          x.startsWith("g1-") ||
          x.startsWith("ticket-") ||
          x.startsWith("prize-") ||
          x.startsWith("pattern-") ||
          x.startsWith("wp-") ||
          x.startsWith("bong-") ||
          x.startsWith("buy-") ||
          x.startsWith("win-"),
      );
      if (recognised) return { label: recognised, element: el };
    }
    if (el.id) return { label: `#${el.id}`, element: el };
    el = el.parentElement;
  }
  return { label: "(unknown)", element: null };
}

function ensurePanel(): {
  host: HTMLDivElement;
  countsEl: HTMLDivElement;
  logEl: HTMLDivElement;
  highlightToggle: HTMLButtonElement;
} {
  const existing = document.getElementById("blink-diag-panel") as HTMLDivElement | null;
  if (existing) {
    return {
      host: existing,
      countsEl: existing.querySelector(".blink-counts") as HTMLDivElement,
      logEl: existing.querySelector(".blink-log") as HTMLDivElement,
      highlightToggle: existing.querySelector(".blink-highlight-toggle") as HTMLButtonElement,
    };
  }

  const host = document.createElement("div");
  host.id = "blink-diag-panel";
  Object.assign(host.style, {
    position: "fixed",
    top: "8px",
    right: "8px",
    width: "360px",
    maxHeight: "70vh",
    background: "rgba(10, 4, 4, 0.92)",
    color: "#f4e8d0",
    font: "11px ui-monospace, Menlo, monospace",
    border: "1px solid rgba(245,184,65,0.4)",
    borderRadius: "6px",
    zIndex: "2147483647",
    pointerEvents: "auto",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
  });

  const header = document.createElement("div");
  Object.assign(header.style, {
    padding: "6px 10px",
    background: "linear-gradient(180deg, #3a1418 0%, #1d0a0a 100%)",
    fontWeight: "700",
    letterSpacing: "0.05em",
    borderBottom: "1px solid rgba(245,184,65,0.3)",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  });
  header.innerHTML = `<span>BLINK DIAGNOSTIC</span>`;

  const highlightToggle = document.createElement("button");
  highlightToggle.className = "blink-highlight-toggle";
  highlightToggle.textContent = "◉ flash";
  Object.assign(highlightToggle.style, {
    background: "rgba(245,184,65,0.2)",
    border: "1px solid rgba(245,184,65,0.5)",
    color: "#f5c842",
    borderRadius: "3px",
    padding: "2px 6px",
    cursor: "pointer",
    fontSize: "10px",
    fontFamily: "inherit",
  });
  header.appendChild(highlightToggle);
  host.appendChild(header);

  const countsEl = document.createElement("div");
  countsEl.className = "blink-counts";
  Object.assign(countsEl.style, {
    padding: "6px 10px",
    borderBottom: "1px solid rgba(255,255,255,0.1)",
    maxHeight: "150px",
    overflowY: "auto",
  });
  countsEl.textContent = "Venter på mutasjoner…";
  host.appendChild(countsEl);

  const logEl = document.createElement("div");
  logEl.className = "blink-log";
  Object.assign(logEl.style, {
    padding: "6px 10px",
    overflowY: "auto",
    flex: "1 1 auto",
    fontSize: "10px",
    lineHeight: "1.4",
  });
  host.appendChild(logEl);

  document.body.appendChild(host);
  return { host, countsEl, logEl, highlightToggle };
}

function flashOutline(el: HTMLElement): void {
  const prev = el.style.outline;
  const prevOffset = el.style.outlineOffset;
  el.style.outline = "2px solid rgba(255,80,80,0.9)";
  el.style.outlineOffset = "-2px";
  setTimeout(() => {
    el.style.outline = prev;
    el.style.outlineOffset = prevOffset;
  }, 220);
}

/**
 * Observer DOM-mutasjoner i `overlayRoot` og rendre et diagnostikk-panel.
 * Returnerer en cleanup-funksjon som stopper observeren og fjerner panelet.
 */
export function installBlinkDiagnostic(overlayRoot: HTMLElement): () => void {
  const { host, countsEl, logEl, highlightToggle } = ensurePanel();
  let highlightEnabled = false;
  highlightToggle.addEventListener("click", () => {
    highlightEnabled = !highlightEnabled;
    highlightToggle.style.background = highlightEnabled
      ? "rgba(245,184,65,0.5)"
      : "rgba(245,184,65,0.2)";
  });

  const perSecond: Record<string, number> = {};
  const recentLog: BlinkEvent[] = [];
  let rafScheduled = false;

  const render = (): void => {
    rafScheduled = false;

    // Topp-5 muterende labels siste sekund.
    const topEntries = Object.entries(perSecond)
      .filter(([, n]) => n > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8);
    if (topEntries.length === 0) {
      countsEl.textContent = "Stille — ingen mutasjoner siste sekund.";
    } else {
      countsEl.innerHTML = topEntries
        .map(
          ([k, n]) =>
            `<div style="display:flex;justify-content:space-between;gap:8px;">` +
            `<span style="color:${n > 30 ? "#ff8080" : n > 10 ? "#f5c842" : "#a8c8f0"}">${k}</span>` +
            `<span style="color:#a8c8f0;font-variant-numeric:tabular-nums;">${n}</span>` +
            `</div>`,
        )
        .join("");
    }

    // Rullende log: siste 40 events.
    const tail = recentLog.slice(-40);
    logEl.innerHTML = tail
      .map((e) => {
        const tStr = `${(e.t / 1000).toFixed(2)}s`;
        return `<div style="display:flex;gap:6px;opacity:0.85;">` +
          `<span style="color:#888;width:46px;">${tStr}</span>` +
          `<span style="color:#f5c842;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${e.label}</span>` +
          `<span style="color:#a8c8f0;">${e.kind}</span>` +
          `</div>`;
      })
      .join("");
    logEl.scrollTop = logEl.scrollHeight;
  };

  const resetCounts = (): void => {
    for (const k of Object.keys(perSecond)) perSecond[k] = 0;
  };
  const countsInterval = window.setInterval(resetCounts, 1000);

  const pushEvent = (label: string, kind: string, element: HTMLElement | null): void => {
    const key = `${label}[${kind}]`;
    perSecond[key] = (perSecond[key] ?? 0) + 1;
    recentLog.push({ t: performance.now(), label, kind, node: element });
    if (recentLog.length > 200) recentLog.splice(0, recentLog.length - 200);
    if (highlightEnabled && element) flashOutline(element);
    if (!rafScheduled) {
      rafScheduled = true;
      requestAnimationFrame(render);
    }
  };

  const mutationObs = new MutationObserver((mutations) => {
    for (const m of mutations) {
      const { label, element } = labelFor(m.target);
      const kind =
        m.type === "childList"
          ? "childList"
          : m.type === "characterData"
            ? "text"
            : `attr:${m.attributeName}`;
      pushEvent(label, kind, element);
    }
  });

  mutationObs.observe(overlayRoot, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: ["style", "class", "disabled", "hidden"],
  });

  // CSS-animasjoner og transitions er ofte den egentlige blink-kilden.
  const onAnim = (e: Event): void => {
    const target = e.target as HTMLElement | null;
    if (!target) return;
    const { label, element } = labelFor(target);
    const animName =
      (e as AnimationEvent).animationName ||
      (e as TransitionEvent).propertyName ||
      "?";
    pushEvent(label, `${e.type}:${animName}`, element);
  };
  overlayRoot.addEventListener("animationstart", onAnim, true);
  overlayRoot.addEventListener("transitionstart", onAnim, true);

  // Logg også de eksisterende [blink] console.debug-entries via hook.
  const origDebug = console.debug.bind(console);
  console.debug = ((...args: unknown[]) => {
    if (typeof args[0] === "string" && args[0].startsWith("[blink] ")) {
      const text = args[0].slice(8);
      pushEvent(text, "console.debug", null);
    }
    origDebug(...args);
  }) as typeof console.debug;

  console.log("[DIAG blink] Panel mounted — topp-noder per sekund + rullende log. Klikk ◉ flash for visuell outline.");

  return () => {
    window.clearInterval(countsInterval);
    mutationObs.disconnect();
    overlayRoot.removeEventListener("animationstart", onAnim, true);
    overlayRoot.removeEventListener("transitionstart", onAnim, true);
    console.debug = origDebug;
    host.remove();
  };
}

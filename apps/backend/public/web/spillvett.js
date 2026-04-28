(function () {
  const storageKeys = {
    token: "spillvett.token",
    hallId: "spillvett.hallId",
    hallName: "spillvett.hallName",
    approvedHalls: "spillvett.approvedHalls",
    drawerOpen: "spillvett.drawerOpen",
    period: "spillvett.period"
  };

  const state = {
    token: "",
    hallId: "",
    hallName: "",
    approvedHalls: [],
    reportPeriod: "last7",
    drawerOpen: false,
    isLoading: false,
    error: "",
    report: null,
    compliance: null,
    pendingHostHallId: "",
    syncTimer: null,
    refreshIntervalId: null,
    candyEmbedOrigin: ""
  };

  const els = {};

  function updateHostChrome() {
    if (els.hostHallName) {
      els.hostHallName.textContent = state.hallName || "Velg hall i Spillorama";
    }

    if (els.hostSessionState) {
      if (!state.token) {
        els.hostSessionState.textContent = "Logg inn i Spillorama for å se grenser og spillregnskap i shellen.";
      } else if (!state.hallId) {
        els.hostSessionState.textContent = "Velg en aktiv hall i Spillorama-lobbyen for å synkronisere riktig kundeflate.";
      } else {
        els.hostSessionState.textContent = "Spillvett er aktivt for valgt hall.";
      }
    }
  }

  function getSelectedHallEntry() {
    return (state.approvedHalls || []).find((hall) => hall && hall.hallId === state.hallId) || null;
  }

  function renderHallSelector() {
    if (!els.hostHallSelect) {
      return;
    }

    const halls = Array.isArray(state.approvedHalls) ? state.approvedHalls : [];
    els.hostHallSelect.innerHTML = "";

    if (!halls.length) {
      const option = document.createElement("option");
      option.textContent = state.token ? "Venter på haller fra Spillorama" : "Logg inn for å hente haller";
      option.value = "";
      els.hostHallSelect.appendChild(option);
      els.hostHallSelect.disabled = true;
      if (els.hostHallNote) {
        els.hostHallNote.textContent = "Hallvelgeren blir aktiv når Spillorama har sendt godkjente haller til shellen.";
      }
      return;
    }

    halls.forEach((hall) => {
      const option = document.createElement("option");
      option.value = hall.hallId || "";
      option.textContent = `${hall.hallName || hall.hallId} (${formatCurrency(hall.totalLimitAvailable || 0)} igjen)`;
      option.selected = option.value === state.hallId;
      els.hostHallSelect.appendChild(option);
    });

    els.hostHallSelect.disabled = false;
    if (state.hallId) {
      els.hostHallSelect.value = state.hallId;
    }

    if (els.hostHallNote) {
      const selectedHall = getSelectedHallEntry();
      if (selectedHall) {
        els.hostHallNote.textContent = `Godkjent hall med tilgjengelig tapsgrense: ${formatCurrency(selectedHall.totalLimitAvailable || 0)}.`;
      } else {
        els.hostHallNote.textContent = "Velg hvilken hall shellen skal bruke som aktiv kontekst.";
      }
    }
  }

  function complianceAllowsPlay() {
    if (!state.token || !state.hallId) return false;
    // Compliance not yet fetched or fetch failed → fail-closed
    if (state.compliance === null || state.error) return false;
    // restrictions.isBlocked covers all block types: MANDATORY_PAUSE, TIMED_PAUSE, SELF_EXCLUDED
    const r = state.compliance.restrictions;
    if (r && r.isBlocked) return false;
    return true;
  }

  function renderGameButtons() {
    if (!els.hostGameButtons || !els.hostGameButtons.length) {
      return;
    }

    const allowed = complianceAllowsPlay();
    els.hostGameButtons.forEach((button) => {
      button.disabled = !allowed;
    });
  }

  function normalizeApprovedHallsPayload(raw) {
    const payload = typeof raw === "string" ? safeJsonParse(raw, null) : raw;
    if (!payload || !Array.isArray(payload.halls)) {
      return null;
    }
    return payload;
  }

  function getElement(id) {
    return document.getElementById(id);
  }

  function safeStorageGet(key) {
    try {
      return window.sessionStorage.getItem(key) || "";
    } catch (error) {
      return "";
    }
  }

  function safeStorageSet(key, value) {
    try {
      if (!value) {
        window.sessionStorage.removeItem(key);
      } else {
        window.sessionStorage.setItem(key, value);
      }
    } catch (error) {
      // ignore
    }
  }

  function safeJsonParse(value, fallback) {
    if (!value) {
      return fallback;
    }
    try {
      return JSON.parse(value);
    } catch (error) {
      return fallback;
    }
  }

  function formatCurrency(value) {
    const number = Number(value || 0);
    return new Intl.NumberFormat("nb-NO", {
      style: "currency",
      currency: "NOK",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(number);
  }

  function formatSignedCurrency(value) {
    const number = Number(value || 0);
    if (number > 0) {
      return `+${formatCurrency(number)}`;
    }
    return formatCurrency(number);
  }

  function formatDateTime(value) {
    if (!value) {
      return "Ingen aktivitet";
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return value;
    }
    return new Intl.DateTimeFormat("nb-NO", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    }).format(date);
  }

  function formatDuration(ms) {
    const totalMinutes = Math.max(0, Math.round((Number(ms) || 0) / 60000));
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (hours > 0) {
      return `${hours} t ${String(minutes).padStart(2, "0")} min`;
    }
    return `${minutes} min`;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function usedLoss(limit, netLoss) {
    const normalizedLimit = Number(limit || 0);
    const normalizedLoss = Math.max(0, Number(netLoss || 0));
    if (normalizedLimit <= 0) {
      return 0;
    }
    return clamp(normalizedLoss, 0, normalizedLimit);
  }

  function remainingLoss(limit, netLoss) {
    const normalizedLimit = Number(limit || 0);
    return Math.max(0, normalizedLimit - usedLoss(normalizedLimit, netLoss));
  }

  function toneForLimit(remaining, total) {
    if (total <= 0) {
      return "is-safe";
    }
    const ratio = remaining / total;
    if (ratio <= 0.25) {
      return "is-danger";
    }
    if (ratio <= 0.6) {
      return "is-warning";
    }
    return "is-safe";
  }

  function normalizeApiError(error) {
    if (error instanceof Error && error.message) {
      return error.message;
    }
    return "Kunne ikke hente Spillvett-data akkurat nå.";
  }

  async function apiRequest(url, options) {
    if (!state.token) {
      throw new Error("Mangler spiller-token for å hente Spillvett-data.");
    }

    const requestOptions = options || {};
    const headers = new Headers(requestOptions.headers || {});
    headers.set("Authorization", `Bearer ${state.token}`);
    headers.set("Accept", "application/json");
    if (requestOptions.body && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }

    const response = await fetch(url, {
      method: requestOptions.method || "GET",
      headers,
      body: requestOptions.body
    });

    const responseType = response.headers.get("content-type") || "";
    if (responseType.includes("application/pdf")) {
      return response.blob();
    }

    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload || payload.ok !== true) {
      throw new Error(
        payload && payload.error && payload.error.message
          ? payload.error.message
          : "Fikk ikke gyldig svar fra serveren."
      );
    }
    return payload.data;
  }

  function openProfilePanel() {
    if (els.profileOverlay) els.profileOverlay.classList.add('is-open');
  }

  function closeProfilePanel() {
    if (els.profileOverlay) els.profileOverlay.classList.remove('is-open');
  }

  window.ShowSpillvettPanel = function ShowSpillvettPanel() {
    openProfilePanel();
  };

  window.HideSpillvettPanel = function HideSpillvettPanel() {
    closeProfilePanel();
  };

  function closeCandyOverlay() {
    if (!els.candyOverlay) return;
    if (state.candyEmbedOrigin && els.candyIframeEl && els.candyIframeEl.contentWindow) {
      try {
        els.candyIframeEl.contentWindow.postMessage({ type: 'host:closeGame' }, state.candyEmbedOrigin);
      } catch (_) {}
    }
    els.candyOverlay.classList.remove('is-open');
    state.candyEmbedOrigin = '';
    window.setTimeout(function () {
      if (els.candyIframeEl && !els.candyOverlay.classList.contains('is-open')) {
        els.candyIframeEl.src = '';
        els.candyIframeEl.hidden = true;
      }
    }, 100);
  }

  function scheduleSync() {
    if (state.syncTimer) {
      window.clearTimeout(state.syncTimer);
    }
    state.syncTimer = window.setTimeout(() => {
      void refreshData();
    }, 250);
  }

  function ensureRefreshLoop() {
    if (state.refreshIntervalId) {
      window.clearInterval(state.refreshIntervalId);
    }
    state.refreshIntervalId = window.setInterval(() => {
      if (state.token && state.hallId) {
        void refreshData({ silent: true });
      }
    }, 15000);
  }

  function buildStatusPills(compliance) {
    const pills = [];
    if (!compliance) {
      return pills;
    }

    const r = compliance.restrictions;
    const p = compliance.pause;

    if (r && r.selfExclusion && r.selfExclusion.isActive) {
      pills.push({
        tone: "is-danger",
        label: `Selvutestengt til ${formatDateTime(r.selfExclusion.minimumUntil)}`
      });
    } else if (r && r.isBlocked && r.blockedBy === "MANDATORY_PAUSE") {
      pills.push({
        tone: "is-warning",
        label: `Obligatorisk pause til ${formatDateTime(r.blockedUntil)} (§ 66)`
      });
    } else if (r && r.timedPause && r.timedPause.isActive) {
      pills.push({
        tone: "is-warning",
        label: `Frivillig pause til ${formatDateTime(r.timedPause.pauseUntil)}`
      });
    } else {
      pills.push({
        tone: "is-safe",
        label: "Spilling tillatt i valgt hall"
      });
      if (p && p.playSessionLimitMs > 0) {
        const ratio = p.accumulatedPlayMs / p.playSessionLimitMs;
        if (ratio >= 0.8) {
          const remainingMin = Math.max(1, Math.round((p.playSessionLimitMs - p.accumulatedPlayMs) / 60000));
          pills.push({
            tone: "is-warning",
            label: `${remainingMin} min igjen til obligatorisk pause (§ 66)`
          });
        }
      }
    }

    if (compliance.pendingLossLimits) {
      if (compliance.pendingLossLimits.daily) {
        pills.push({
          tone: "is-info",
          label: `Ny dagsgrense ${formatCurrency(compliance.pendingLossLimits.daily.value)} fra ${formatDateTime(compliance.pendingLossLimits.daily.effectiveFrom)}`
        });
      }
      if (compliance.pendingLossLimits.monthly) {
        pills.push({
          tone: "is-info",
          label: `Ny månedsgrense ${formatCurrency(compliance.pendingLossLimits.monthly.value)} fra ${formatDateTime(compliance.pendingLossLimits.monthly.effectiveFrom)}`
        });
      }
    }

    return pills;
  }

  function renderPills(pills) {
    if (!els.statusRow) {
      return;
    }
    els.statusRow.innerHTML = pills
      .map((pill) => `<span class="spillvett-pill ${pill.tone}">${pill.label}</span>`)
      .join("");
  }

  function renderLimitCard(prefix, label, limitTotal, netLoss, resetText) {
    const used = usedLoss(limitTotal, netLoss);
    const remaining = remainingLoss(limitTotal, netLoss);
    const tone = toneForLimit(remaining, Number(limitTotal || 0));
    const percentage = limitTotal > 0 ? (used / limitTotal) * 100 : 0;

    const labelElement = els[`${prefix}Label`];
    const valueElement = els[`${prefix}Value`];
    const fillElement = els[`${prefix}Fill`];
    const usedElement = els[`${prefix}Used`];
    const remainingElement = els[`${prefix}Remaining`];
    const resetElement = els[`${prefix}Reset`];

    if (!labelElement || !valueElement || !fillElement || !usedElement || !remainingElement || !resetElement) {
      return;
    }

    labelElement.textContent = label;
    valueElement.textContent = `${formatCurrency(remaining)} igjen`;
    fillElement.style.width = `${clamp(percentage, 0, 100)}%`;
    fillElement.className = `spillvett-meter-fill ${tone}`;
    usedElement.textContent = `Brukt: ${formatCurrency(used)}`;
    remainingElement.textContent = `Grense: ${formatCurrency(limitTotal)}`;
    resetElement.textContent = resetText;
  }

  function renderSummary(compliance) {
    const hallName = state.hallName || "Aktiv hall";
    updateHostChrome();
    els.hallName.textContent = hallName;

    if (!compliance) {
      renderPills([]);
      renderLimitCard("daily", "Dagsgrense", 0, 0, "Venter på data");
      renderLimitCard("monthly", "Månedsgrense", 0, 0, "Venter på data");
      els.note.textContent = state.token
        ? "Velg hall i lobbyen for å vise riktige grenser og riktig spillregnskap i shellen."
        : "Logg inn i Spillorama for å hente Spillvett-data i shellen.";
      return;
    }

    renderPills(buildStatusPills(compliance));

    renderLimitCard(
      "daily",
      "Dagsgrense",
      compliance.personalLossLimits.daily,
      compliance.netLoss.daily,
      "Nullstilles ved lokal midnatt"
    );
    renderLimitCard(
      "monthly",
      "Månedsgrense",
      compliance.personalLossLimits.monthly,
      compliance.netLoss.monthly,
      "Nullstilles ved ny kalendermåned"
    );

    const noteParts = [];
    if (compliance.pause && compliance.pause.lastMandatoryBreak) {
      noteParts.push(`Siste pålagte pause: ${formatDateTime(compliance.pause.lastMandatoryBreak.triggeredAt)}`);
    }
    noteParts.push(`Akkumulert spilletid: ${formatDuration(compliance.pause.accumulatedPlayMs)}`);
    els.note.textContent = noteParts.join(" • ");
  }

  function formatGameType(gameType) {
    switch (gameType) {
      case "DATABINGO":
        return "Databingo";
      case "MAIN_GAME":
        return "Hovedspill";
      default:
        return gameType || "Ukjent spill";
    }
  }

  function formatChannel(channel) {
    switch (channel) {
      case "INTERNET":
        return "På nett";
      case "HALL":
        return "I hall";
      default:
        return channel || "Ukjent kanal";
    }
  }

  function formatEventType(eventType) {
    switch (eventType) {
      case "STAKE":
        return "Innsats";
      case "PRIZE":
        return "Premie";
      case "EXTRA_PRIZE":
        return "Ekstrapremie";
      case "ORG_DISTRIBUTION":
        return "Fordeling";
      default:
        return eventType || "Hendelse";
    }
  }

  function renderReport(report) {
    if (!state.drawerOpen) {
      return;
    }

    if (state.isLoading && !report) {
      els.reportContent.innerHTML = '<div class="spillvett-loading">Henter spillregnskap...</div>';
      return;
    }

    if (state.error && !report) {
      els.reportContent.innerHTML = `<div class="spillvett-error">${state.error}</div>`;
      return;
    }

    if (!report) {
      els.reportContent.innerHTML = '<div class="spillvett-empty">Ingen spillregnskapsdata tilgjengelig ennå.</div>';
      return;
    }

    const summary = report.summary || {};
    const netClass = Number(summary.netResult || 0) < 0
      ? "is-negative"
      : Number(summary.netResult || 0) > 0
        ? "is-positive"
        : "";
    const breakdownRows = (report.breakdown || [])
      .slice(0, 6)
      .map((row) => `
        <tr>
          <td>
            ${formatGameType(row.gameType)}
            <span class="spillvett-table-meta">${formatChannel(row.channel)}</span>
          </td>
          <td>${formatCurrency(row.stakeTotal)}</td>
          <td>${formatCurrency(row.prizeTotal)}</td>
          <td>${formatSignedCurrency(row.netResult)}</td>
        </tr>
      `)
      .join("");

    const playRows = (report.plays || [])
      .slice(0, 6)
      .map((row) => `
        <tr>
          <td>
            ${formatDateTime(row.lastActivityAt)}
            <span class="spillvett-table-meta">${formatGameType(row.gameType)}${row.roomCode ? ` • ${row.roomCode}` : ""}</span>
          </td>
          <td>${formatCurrency(row.stakeTotal)}</td>
          <td>${formatCurrency(row.prizeTotal)}</td>
          <td>${formatSignedCurrency(row.netResult)}</td>
        </tr>
      `)
      .join("");

    const eventRows = (report.events || [])
      .slice(0, 8)
      .map((row) => `
        <tr>
          <td>
            ${formatDateTime(row.createdAt)}
            <span class="spillvett-table-meta">${formatEventType(row.eventType)} • ${formatGameType(row.gameType)}</span>
          </td>
          <td>${formatSignedCurrency(row.eventType === "STAKE" ? -Math.abs(row.amount) : Math.abs(row.amount))}</td>
        </tr>
      `)
      .join("");

    els.reportContent.innerHTML = `
      <div class="spillvett-summary-grid">
        <article class="spillvett-summary-tile">
          <p class="spillvett-summary-tile-label">Periode</p>
          <p class="spillvett-summary-tile-value">${report.range ? report.range.label : "Valgt periode"}</p>
        </article>
        <article class="spillvett-summary-tile">
          <p class="spillvett-summary-tile-label">Antall spill</p>
          <p class="spillvett-summary-tile-value">${summary.totalPlays || 0}</p>
        </article>
        <article class="spillvett-summary-tile">
          <p class="spillvett-summary-tile-label">Innsats</p>
          <p class="spillvett-summary-tile-value">${formatCurrency(summary.stakeTotal)}</p>
        </article>
        <article class="spillvett-summary-tile">
          <p class="spillvett-summary-tile-label">Premier</p>
          <p class="spillvett-summary-tile-value">${formatCurrency(summary.prizeTotal)}</p>
        </article>
        <article class="spillvett-summary-tile">
          <p class="spillvett-summary-tile-label">Netto resultat</p>
          <p class="spillvett-summary-tile-value ${netClass}">${formatSignedCurrency(summary.netResult)}</p>
        </article>
        <article class="spillvett-summary-tile">
          <p class="spillvett-summary-tile-label">Bokførte hendelser</p>
          <p class="spillvett-summary-tile-value">${summary.totalEvents || 0}</p>
        </article>
      </div>

      <h3 class="spillvett-section-title" style="margin-top:16px">Per spilltype</h3>
      ${breakdownRows
        ? `<table class="spillvett-table">
             <thead>
               <tr>
                 <th>Spill</th>
                 <th>Innsats</th>
                 <th>Premier</th>
                 <th>Netto</th>
               </tr>
             </thead>
             <tbody>${breakdownRows}</tbody>
           </table>`
        : '<div class="spillvett-empty">Ingen spill registrert i valgt periode.</div>'}

      <h3 class="spillvett-section-title" style="margin-top:16px">Siste spill</h3>
      ${playRows
        ? `<table class="spillvett-table">
             <thead>
               <tr>
                 <th>Spill</th>
                 <th>Innsats</th>
                 <th>Premier</th>
                 <th>Netto</th>
               </tr>
             </thead>
             <tbody>${playRows}</tbody>
           </table>`
        : '<div class="spillvett-empty">Ingen enkelspill registrert i valgt periode.</div>'}

      <h3 class="spillvett-section-title" style="margin-top:16px">Siste bokførte hendelser</h3>
      ${eventRows
        ? `<table class="spillvett-table">
             <thead>
               <tr>
                 <th>Hendelse</th>
                 <th>Beløp</th>
               </tr>
             </thead>
             <tbody>${eventRows}</tbody>
           </table>`
        : '<div class="spillvett-empty">Ingen hendelser registrert i valgt periode.</div>'}

      <div class="spillvett-export">
        <button class="spillvett-button" type="button" id="spillvett-download-report">Last ned PDF</button>
        <button class="spillvett-button is-secondary" type="button" id="spillvett-email-report">Send PDF på e-post</button>
        <button class="spillvett-button is-ghost" type="button" id="spillvett-refresh-report">Oppdater</button>
      </div>
      <div class="spillvett-footnote">
        Aktiv hall: ${state.hallName || report.hallName || state.hallId || "Ukjent hall"}.
        Spillregnskapet bygger på bokførte innsatser og premier i denne hallen.
      </div>
    `;

    getElement("spillvett-download-report").addEventListener("click", onDownloadReport);
    getElement("spillvett-email-report").addEventListener("click", onEmailReport);
    getElement("spillvett-refresh-report").addEventListener("click", () => {
      void refreshData();
    });
  }

  async function refreshData(options) {
    if (!state.token || !state.hallId) {
      render();
      return;
    }

    const silent = Boolean(options && options.silent);
    if (!silent) {
      state.isLoading = true;
      state.error = "";
      render();
    }

    try {
      const hallQuery = `hallId=${encodeURIComponent(state.hallId)}`;
      const [compliance, report] = await Promise.all([
        apiRequest(`/api/wallet/me/compliance?${hallQuery}`),
        apiRequest(`/api/spillevett/report?${hallQuery}&period=${encodeURIComponent(state.reportPeriod)}`)
      ]);
      state.compliance = compliance;
      state.report = report;
      state.error = "";
    } catch (error) {
      state.error = normalizeApiError(error);
    } finally {
      state.isLoading = false;
      render();
    }
  }

  async function onDownloadReport() {
    try {
      const blob = await apiRequest("/api/spillevett/report/export", {
        method: "POST",
        body: JSON.stringify({
          hallId: state.hallId,
          period: state.reportPeriod,
          delivery: "download"
        })
      });

      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `spillregnskap-${state.hallId || "hall"}-${state.reportPeriod}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      state.error = normalizeApiError(error);
      render();
    }
  }

  async function onEmailReport() {
    try {
      await apiRequest("/api/spillevett/report/export", {
        method: "POST",
        body: JSON.stringify({
          hallId: state.hallId,
          period: state.reportPeriod,
          delivery: "email"
        })
      });
      state.error = "";
      render();
      window.alert("Spillregnskapet ble sendt på e-post til registrert adresse.");
    } catch (error) {
      state.error = normalizeApiError(error);
      render();
    }
  }

  function setDrawerOpen(next) {
    state.drawerOpen = Boolean(next);
    safeStorageSet(storageKeys.drawerOpen, state.drawerOpen ? "1" : "");
    render();
    if (state.drawerOpen && !state.report && state.token && state.hallId) {
      void refreshData();
    }
  }

  // ── Obligatorisk pause modal ──────────────────────────────────────────
  //
  // Blink-elimination runde 7 (2026-04-27):
  // - Memoize textContent-writes (countdown, loss, playtime, gamecount) — skip
  //   write hvis verdien er uendret. Gjør at de 12+ render()-call-paths ikke
  //   trigger composite-restart på modalen.
  // - Skip restart av setInterval når blockedUntil er uendret. Tidligere ble
  //   intervallet clearet og restartet på hver render(), som ga timing-jitter
  //   som landet textContent-write mid-frame relativt til Pixi-render.
  // - Drop tick-frekvens fra 500ms → 1000ms (countdown viser kun sekunder, så
  //   2× ticks/sekund var sløsing — halver DOM-mutasjon-frekvens).
  // Se docs/engineering/SPILL1_BLINK_ELIMINATION_RUNDE_7_2026-04-27.md.

  let _pauseCountdownInterval = null;
  let _pauseLastBlockedUntilEpoch = 0;
  let _pauseLastCountdownText = null;
  let _pauseLastLossText = null;
  let _pauseLastPlaytimeText = null;
  let _pauseLastGamecountText = null;

  function _setIfChanged(el, nextText, lastValue) {
    if (!el) return lastValue;
    if (lastValue === nextText) return lastValue;
    el.textContent = nextText;
    return nextText;
  }

  function renderMandatoryPauseModal(compliance) {
    if (!els.mandatoryPauseModal) return;

    const r = compliance && compliance.restrictions;
    const isOnMandatoryPause = r && r.isBlocked && r.blockedBy === "MANDATORY_PAUSE";

    if (!isOnMandatoryPause) {
      els.mandatoryPauseModal.hidden = true;
      if (_pauseCountdownInterval) {
        clearInterval(_pauseCountdownInterval);
        _pauseCountdownInterval = null;
      }
      _pauseLastBlockedUntilEpoch = 0;
      _pauseLastCountdownText = null;
      _pauseLastLossText = null;
      _pauseLastPlaytimeText = null;
      _pauseLastGamecountText = null;
      return;
    }

    els.mandatoryPauseModal.hidden = false;

    // Fill in activity stats from lastMandatoryBreak — memoized.
    const brk = compliance.pause && compliance.pause.lastMandatoryBreak;
    if (brk) {
      const loss = brk.netLoss && typeof brk.netLoss.daily === "number" ? brk.netLoss.daily : 0;
      _pauseLastLossText = _setIfChanged(
        els.mandatoryPauseLoss,
        formatCurrency(loss),
        _pauseLastLossText
      );
      _pauseLastPlaytimeText = _setIfChanged(
        els.mandatoryPausePlaytime,
        formatDuration(brk.totalPlayMs),
        _pauseLastPlaytimeText
      );
      const count = typeof brk.gamesPlayed === "number" ? brk.gamesPlayed : 0;
      const gamecountText = count === 1 ? "1 spill" : `${count} spill`;
      _pauseLastGamecountText = _setIfChanged(
        els.mandatoryPauseGamecount,
        gamecountText,
        _pauseLastGamecountText
      );
    }

    // Live countdown — start interval kun når blockedUntil endrer seg.
    const blockedUntilEpoch = r.blockedUntil ? new Date(r.blockedUntil).getTime() : 0;
    const tickCountdown = function () {
      const remaining = Math.max(0, blockedUntilEpoch - Date.now());
      const totalSec = Math.ceil(remaining / 1000);
      const min = Math.floor(totalSec / 60);
      const sec = totalSec % 60;
      const text =
        String(min).padStart(2, "0") + ":" + String(sec).padStart(2, "0");
      _pauseLastCountdownText = _setIfChanged(
        els.mandatoryPauseCountdown,
        text,
        _pauseLastCountdownText
      );
      if (remaining <= 0) {
        if (_pauseCountdownInterval) {
          clearInterval(_pauseCountdownInterval);
          _pauseCountdownInterval = null;
        }
        // Refresh compliance once pause expires
        void refreshData({ silent: true });
      }
    };

    if (blockedUntilEpoch !== _pauseLastBlockedUntilEpoch) {
      _pauseLastBlockedUntilEpoch = blockedUntilEpoch;
      if (_pauseCountdownInterval) {
        clearInterval(_pauseCountdownInterval);
        _pauseCountdownInterval = null;
      }
      // Synkron tick først så countdown ikke blinker mellom forrige verdi og
      // første interval-fyring.
      tickCountdown();
      if (blockedUntilEpoch > Date.now()) {
        _pauseCountdownInterval = setInterval(tickCountdown, 1000);
      }
    }
  }

  function render() {
    if (!els.shell) {
      return;
    }

    els.shell.classList.add("is-visible");
    if (els.spillvettFab) {
      els.spillvettFab.hidden = !state.token;
    }
    renderMandatoryPauseModal(state.compliance);
    renderHallSelector();
    renderGameButtons();
    renderSummary(state.compliance);

    const isReady = Boolean(state.token);
    els.toggle.disabled = !isReady;
    // Drawer is hidden — full-page view is used instead
    if (els.drawer) els.drawer.hidden = true;

    if (state.error && els.inlineError) {
      els.inlineError.textContent = state.error;
      els.inlineError.hidden = false;
    } else if (els.inlineError) {
      els.inlineError.hidden = true;
      els.inlineError.textContent = "";
    }
  }

  function initDom() {
    els.shell = getElement("spillvett-shell");
    els.hostHallName = getElement("host-active-hall");
    els.hostSessionState = getElement("host-session-state");
    els.hostHallSelect = getElement("host-hall-select");
    els.hostHallNote = getElement("host-hall-note");
    els.hostGameButtons = Array.from(document.querySelectorAll("[data-host-game]"));
    els.hallName = getElement("spillvett-hall-name");
    els.statusRow = getElement("spillvett-status-row");
    els.note = getElement("spillvett-note");
    els.toggle = getElement("spillvett-toggle");
    els.drawer = getElement("spillvett-drawer");
    els.inlineError = getElement("spillvett-inline-error");
    els.reportContent = getElement("spillvett-report-content");
    els.periodButtons = Array.from(document.querySelectorAll("[data-period]"));

    els.dailyLabel = getElement("spillvett-daily-label");
    els.dailyValue = getElement("spillvett-daily-value");
    els.dailyFill = getElement("spillvett-daily-fill");
    els.dailyUsed = getElement("spillvett-daily-used");
    els.dailyRemaining = getElement("spillvett-daily-remaining");
    els.dailyReset = getElement("spillvett-daily-reset");

    els.monthlyLabel = getElement("spillvett-monthly-label");
    els.monthlyValue = getElement("spillvett-monthly-value");
    els.monthlyFill = getElement("spillvett-monthly-fill");
    els.monthlyUsed = getElement("spillvett-monthly-used");
    els.monthlyRemaining = getElement("spillvett-monthly-remaining");
    els.monthlyReset = getElement("spillvett-monthly-reset");

    els.mandatoryPauseModal = getElement("mandatory-pause-modal");
    els.mandatoryPauseCountdown = getElement("mandatory-pause-countdown");
    els.mandatoryPauseLoss = getElement("mandatory-pause-loss");
    els.mandatoryPausePlaytime = getElement("mandatory-pause-playtime");
    els.mandatoryPauseGamecount = getElement("mandatory-pause-gamecount");

    if (els.toggle) {
      els.toggle.addEventListener("click", () => {
        if (window.Spillregnskap) {
          window.Spillregnskap.show({ token: state.token, hallId: state.hallId });
        }
      });
    }

    if (els.hostHallSelect) {
      els.hostHallSelect.addEventListener("change", (event) => {
        const nextHallId = event.target.value || "";
        if (!nextHallId || nextHallId === state.hallId) {
          return;
        }
        state.pendingHostHallId = nextHallId;
        if (typeof window.SwitchActiveHallFromHost === "function") {
          window.SwitchActiveHallFromHost(nextHallId);
        }
      });
    }

    if (els.hostGameButtons && els.hostGameButtons.length) {
      els.hostGameButtons.forEach((button) => {
        button.addEventListener("click", () => {
          const gameNumber = button.getAttribute("data-host-game");
          if (typeof window.NavigateSpilloramaGame === "function" && gameNumber) {
            window.NavigateSpilloramaGame(gameNumber);
          }
        });
      });
    }

    for (const button of els.periodButtons) {
      button.addEventListener("click", () => {
        const nextPeriod = button.getAttribute("data-period");
        if (!nextPeriod || nextPeriod === state.reportPeriod) {
          return;
        }
        state.reportPeriod = nextPeriod;
        safeStorageSet(storageKeys.period, nextPeriod);
        void refreshData();
      });
    }

    els.profileOverlay = getElement('profile-overlay');
    els.spillvettFab = getElement('spillvett-fab');
    const profileCloseBtn = getElement('profile-close');
    const profileBackdrop = getElement('profile-backdrop');
    if (profileCloseBtn) {
      profileCloseBtn.addEventListener('click', closeProfilePanel);
    }
    if (profileBackdrop) {
      profileBackdrop.addEventListener('click', closeProfilePanel);
    }
    if (els.spillvettFab) {
      els.spillvettFab.addEventListener('click', openProfilePanel);
    }

    els.candyOverlay = getElement('candy-overlay');
    els.candyIframeEl = getElement('candy-iframe');
    els.candyLoading = getElement('candy-loading');
    els.candyOverlayError = getElement('candy-overlay-error');
    const candyCloseBtn = getElement('candy-close');
    if (candyCloseBtn) {
      candyCloseBtn.addEventListener('click', closeCandyOverlay);
    }

    window.addEventListener('message', function (event) {
      if (!state.candyEmbedOrigin || event.origin !== state.candyEmbedOrigin) return;
      const msg = event.data;
      if (!msg || typeof msg.type !== 'string') return;
      switch (msg.type) {
        case 'candy:gameEnded':
        case 'candy:balanceChanged':
          void refreshData({ silent: true });
          break;
        case 'candy:error':
          if (els.candyOverlayError) {
            els.candyOverlayError.textContent = (msg.payload && msg.payload.message) || 'Feil i Candy-spillet.';
            els.candyOverlayError.hidden = false;
          }
          break;
      }
    });

    state.token = safeStorageGet(storageKeys.token);
    state.hallId = safeStorageGet(storageKeys.hallId);
    state.hallName = safeStorageGet(storageKeys.hallName);
    state.approvedHalls = safeJsonParse(safeStorageGet(storageKeys.approvedHalls), []);
    state.drawerOpen = safeStorageGet(storageKeys.drawerOpen) === "1";
    state.reportPeriod = safeStorageGet(storageKeys.period) || "last7";
    ensureRefreshLoop();
    render();

    if (state.token && state.hallId) {
      scheduleSync();
    }
  }

  window.launchCandyOverlay = async function launchCandyOverlay() {
    if (!els.candyOverlay || !state.token || !state.hallId) return;
    els.candyOverlay.classList.add('is-open');
    if (els.candyLoading) els.candyLoading.hidden = false;
    if (els.candyOverlayError) els.candyOverlayError.hidden = true;
    if (els.candyIframeEl) els.candyIframeEl.hidden = true;

    try {
      const data = await apiRequest('/api/games/candy/launch', {
        method: 'POST',
        body: JSON.stringify({ hallId: state.hallId })
      });
      const parsedUrl = new URL(data.embedUrl);
      state.candyEmbedOrigin = parsedUrl.origin;
      if (els.candyIframeEl) {
        els.candyIframeEl.src = data.embedUrl;
        els.candyIframeEl.hidden = false;
      }
      if (els.candyLoading) els.candyLoading.hidden = true;
    } catch (error) {
      if (els.candyLoading) els.candyLoading.hidden = true;
      if (els.candyOverlayError) {
        els.candyOverlayError.textContent = normalizeApiError(error);
        els.candyOverlayError.hidden = false;
      }
    }
  };

  // SetShellToken — kalles av auth.js etter web-login (BIN-262).
  window.SetShellToken = function SetShellToken(token) {
    state.token = token || "";
    safeStorageSet(storageKeys.token, state.token);
    scheduleSync();
    render();
  };

  window.ClearPlayerToken = function ClearPlayerToken() {
    state.token = "";
    state.hallId = "";
    state.hallName = "";
    state.approvedHalls = [];
    state.compliance = null;
    state.report = null;
    state.error = "";
    state.pendingHostHallId = "";
    safeStorageSet(storageKeys.token, "");
    safeStorageSet(storageKeys.hallId, "");
    safeStorageSet(storageKeys.hallName, "");
    safeStorageSet(storageKeys.approvedHalls, "");
    render();
  };

  window.SetActiveHall = function SetActiveHall(hallId, hallName) {
    if (!hallId) {
      return;
    }
    state.hallId = hallId;
    state.hallName = hallName || hallId;
    state.pendingHostHallId = "";
    safeStorageSet(storageKeys.hallId, state.hallId);
    safeStorageSet(storageKeys.hallName, state.hallName);
    scheduleSync();
    render();
  };

  window.SetApprovedHalls = function SetApprovedHalls(rawPayload) {
    const payload = normalizeApprovedHallsPayload(rawPayload);
    if (!payload) {
      return;
    }

    state.approvedHalls = payload.halls;
    safeStorageSet(storageKeys.approvedHalls, JSON.stringify(state.approvedHalls));

    if (payload.activeHallId) {
      state.hallId = payload.activeHallId;
      state.hallName = payload.activeHallName || state.hallName || payload.activeHallId;
      safeStorageSet(storageKeys.hallId, state.hallId);
      safeStorageSet(storageKeys.hallName, state.hallName);
    } else if (!state.hallId) {
      const selectedHall = state.approvedHalls.find((hall) => hall && hall.isSelected) || state.approvedHalls[0];
      if (selectedHall) {
        state.hallId = selectedHall.hallId || "";
        state.hallName = selectedHall.hallName || state.hallId;
        safeStorageSet(storageKeys.hallId, state.hallId);
        safeStorageSet(storageKeys.hallName, state.hallName);
      }
    }

    render();
  };

  window.ClearApprovedHalls = function ClearApprovedHalls() {
    state.approvedHalls = [];
    state.pendingHostHallId = "";
    safeStorageSet(storageKeys.approvedHalls, "");
    render();
  };

  document.addEventListener("DOMContentLoaded", initDom);
})();

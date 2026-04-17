/**
 * Spillregnskap — full-page visualization
 * Opened from the Spillvett profile panel.
 *
 * Exposes:  window.Spillregnskap = { show, hide }
 */
(function () {
  "use strict";

  // ── State ─────────────────────────────────────────────────────────────────

  const SECTIONS   = ["innsats", "premier", "forbruk"];
  const GAME_TYPES = ["DATABINGO", "MAIN_GAME"];

  function defaultSectionCards() {
    const cards = {};
    SECTIONS.forEach(section => {
      cards[section] = {};
      GAME_TYPES.forEach(gameType => {
        cards[section][gameType] = { periodType: "week", offset: 0, customFrom: "", customTo: "" };
      });
    });
    return cards;
  }

  const state = {
    token: "",
    hallId: "",
    report: null,        // full year report from API
    loading: false,
    error: "",
    // Per-section-per-game-card state
    sectionCards: defaultSectionCards(),
    // Other sections
    forbrukHall:   { hallIndex: 0, periodType: "week", offset: 0 },
    totalForbruk:  { days: 1 },
    // Ditt forbruk / innsats / premier chart sections
    // offset unit: weeks for "dag" (window = 7 days), 4-week blocks for "uke"; no offset for "måned"
    dittForbruk:   { periodType: "dag", offset: 0 },
    dittInnsats:   { periodType: "dag", offset: 0 },
    dittPremier:   { periodType: "dag", offset: 0 }
  };

  // ── Helpers ───────────────────────────────────────────────────────────────

  function escHtml(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function fmt(v) {
    const kr = v || 0;
    const abs = Math.abs(kr);
    const sign = kr < 0 ? "−" : "";
    return sign + abs.toLocaleString("nb-NO", { maximumFractionDigits: 0 }) + " kr";
  }

  function fmtShort(v) {
    const kr = v || 0;
    const abs = Math.abs(kr);
    const sign = kr < 0 ? "−" : "";
    if (abs >= 1000) return sign + Math.round(abs / 100) / 10 + "k kr";
    return sign + Math.round(abs) + " kr";
  }

  function gameLabel(gameType) {
    if (gameType === "DATABINGO") return "Databingo";
    if (gameType === "MAIN_GAME") return "Bingo";
    return gameType || "Ukjent";
  }

  const GAME_COLORS = {
    DATABINGO: "#6366f1",
    MAIN_GAME: "#e85d5d",
    _default:  "#52b8c8"
  };

  function gameColor(gameType) {
    return GAME_COLORS[gameType] || GAME_COLORS._default;
  }

  // ── Data helpers (client-side aggregation) ─────────────────────────────────

  function isoWeekKey(date) {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const w = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
    return `${d.getUTCFullYear()}-W${String(w).padStart(2, "0")}`;
  }

  function weekLabel(key) {
    const [year, w] = key.split("-W");
    return `Uke ${parseInt(w)}, ${year}`;
  }

  function monthLabel(key) {
    const months = ["Jan","Feb","Mar","Apr","Mai","Jun","Jul","Aug","Sep","Okt","Nov","Des"];
    const [y, m] = key.split("-");
    return `${months[parseInt(m)-1]} ${y}`;
  }

  function getPeriodRange(periodType, offset) {
    const now = new Date();
    if (periodType === "week") {
      const dow = now.getDay() || 7;
      const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dow + 1 + offset * 7);
      const from = monday.toISOString().slice(0, 10);
      const sun = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6);
      const to = sun.toISOString().slice(0, 10);
      const weekNum = parseInt(isoWeekKey(monday).split("-W")[1]);
      return { from, to, label: `Uke ${weekNum}, ${monday.getFullYear()}` };
    }
    if (periodType === "month") {
      const ref = new Date(now.getFullYear(), now.getMonth() + offset, 1);
      const from = `${ref.getFullYear()}-${String(ref.getMonth()+1).padStart(2,"0")}-01`;
      const last = new Date(ref.getFullYear(), ref.getMonth() + 1, 0);
      const to = last.toISOString().slice(0, 10);
      const MONTHS = ["Januar","Februar","Mars","April","Mai","Juni","Juli","August","September","Oktober","November","Desember"];
      return { from, to, label: `${MONTHS[ref.getMonth()]} ${ref.getFullYear()}` };
    }
    // year: rolling 12 months
    const start = new Date(now.getFullYear()-1, now.getMonth(), now.getDate()+1);
    return { from: start.toISOString().slice(0,10), to: now.toISOString().slice(0,10), label: "Siste 12 måneder" };
  }

  function filterDailyGame(entries, gameType, periodType, offset) {
    const { from, to } = getPeriodRange(periodType, offset);
    return entries.filter(e => e.gameType === gameType && e.date >= from && e.date <= to);
  }

  function filterDailyGameByHall(entries, hallId, periodType, offset) {
    const { from, to } = getPeriodRange(periodType, offset);
    return entries.filter(e => e.hallId === hallId && e.date >= from && e.date <= to);
  }

  function filterDaily(entries, periodType, offset) {
    const { from, to } = getPeriodRange(periodType, offset);
    return entries.filter(e => e.date >= from && e.date <= to);
  }

  function aggregateByGran(entries, gran) {
    const map = new Map();
    for (const e of entries) {
      let key;
      const d = new Date(e.date + "T00:00:00");
      if (gran === "day") key = e.date;
      else if (gran === "week") key = isoWeekKey(d);
      else key = e.date.slice(0, 7);
      const item = map.get(key) ?? { date: key, wagered: 0, won: 0, net: 0 };
      item.wagered += (e.wagered || 0);
      item.won += (e.won || 0);
      item.net = item.won - item.wagered;
      map.set(key, item);
    }
    return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
  }

  // ── SVG chart primitives ──────────────────────────────────────────────────

  function buildBarChart(entries, { width = 480, height = 120, labelFn, showValueLabels = false, darkBg = true, positiveOnly = false, barColor = null } = {}) {
    if (!entries || entries.length === 0) {
      return `<p class="sr-empty">Ingen data for perioden.</p>`;
    }

    const PAD_L = 48;
    const PAD_R = 8;
    const PAD_T = showValueLabels ? 18 : 8;
    const PAD_B = 24;
    const chartW = width - PAD_L - PAD_R;
    const chartH = height - PAD_T - PAD_B;

    const values = entries.map((e) => e.net || 0);
    const maxAbs = positiveOnly
      ? Math.max(1, ...values)
      : Math.max(1, ...values.map(Math.abs));

    const barW   = Math.max(2, chartW / entries.length - 2);
    const barGap = chartW / entries.length;

    // Zero line: middle for net (pos+neg), bottom for positive-only
    const zeroY = positiveOnly ? PAD_T + chartH : PAD_T + chartH / 2;

    const axisColor = darkBg ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.1)";
    const textColor = darkBg ? "rgba(255,255,255,0.45)" : "rgba(0,0,0,0.4)";
    const zeroColor = darkBg ? "rgba(80,220,120,0.5)"   : "rgba(0,150,80,0.5)";

    let bars = "";
    let xLabels = "";
    let valLabels = "";
    const labelStep  = Math.max(1, Math.ceil(entries.length / 8));
    const doValLabels = showValueLabels && entries.length <= 16;

    entries.forEach((entry, i) => {
      const val = entry.net || 0;
      const x = PAD_L + i * barGap + (barGap - barW) / 2;

      let barH, y, fill;
      if (positiveOnly) {
        barH = (Math.max(0, val) / maxAbs) * chartH;
        y    = zeroY - barH;
        fill = barColor || "#6366f1";
      } else {
        barH = (Math.abs(val) / maxAbs) * (chartH / 2);
        y    = val >= 0 ? zeroY - barH : zeroY;
        fill = barColor || (val >= 0 ? "#42c471" : "#e85d5d");
      }

      bars += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(1, barH).toFixed(1)}" fill="${fill}" rx="2"/>`;

      // Value label above bar
      if (doValLabels && val !== 0) {
        const cx = (x + barW / 2).toFixed(1);
        const ly = positiveOnly
          ? (y - 4).toFixed(1)
          : val >= 0
            ? (zeroY - barH - 4).toFixed(1)
            : (zeroY + barH + 11).toFixed(1);
        valLabels += `<text x="${cx}" y="${ly}" text-anchor="middle" font-size="8" fill="${fill}" font-weight="700">${escHtml(fmtShort(Math.abs(val)))}</text>`;
      }

      // X-axis date label
      if (i % labelStep === 0) {
        let label = entry.date ? entry.date.slice(5) : "";
        if (labelFn) {
          label = labelFn(entry.date);
        } else if (entry.date && entry.date.includes("-W")) {
          label = weekLabel(entry.date).split(",")[0];
        } else if (entry.date && entry.date.length === 7) {
          label = monthLabel(entry.date).split(" ")[0];
        }
        xLabels += `<text x="${(x + barW / 2).toFixed(1)}" y="${(height - 4).toFixed(1)}" text-anchor="middle" font-size="9" fill="${textColor}">${escHtml(label)}</text>`;
      }
    });

    const topLabel = fmtShort(maxAbs);
    const botLabel = positiveOnly ? "0" : fmtShort(-maxAbs);
    const botLabelY = positiveOnly
      ? (PAD_T + chartH + 2).toFixed(1)
      : (height - PAD_B - 2).toFixed(1);

    return `<svg viewBox="0 0 ${width} ${height}" width="100%" style="max-width:${width}px;display:block;" aria-hidden="true">
  <line x1="${PAD_L}" y1="${zeroY.toFixed(1)}" x2="${width - PAD_R}" y2="${zeroY.toFixed(1)}" stroke="${zeroColor}" stroke-width="1.5"/>
  ${bars}
  ${valLabels}
  ${xLabels}
  <text x="${PAD_L - 4}" y="${(PAD_T + 6).toFixed(1)}" text-anchor="end" font-size="9" fill="${textColor}">${topLabel}</text>
  <text x="${PAD_L - 4}" y="${botLabelY}" text-anchor="end" font-size="9" fill="${textColor}">${botLabel}</text>
</svg>`;
  }

  // ── DOM helper ────────────────────────────────────────────────────────────

  function el(id) {
    return document.getElementById(id);
  }

  // ── Section renderers ─────────────────────────────────────────────────────

  function renderMiniSummary(containerId, filtered) {
    const container = el(containerId);
    if (!container) return;
    const wagered = filtered.reduce((s, e) => s + (e.wagered || 0), 0);
    const won = filtered.reduce((s, e) => s + (e.won || 0), 0);
    const net = won - wagered;
    const netClass = net < 0 ? "is-negative" : net > 0 ? "is-positive" : "";
    container.innerHTML = `
      <div class="sr-mini-tile"><p class="sr-mini-label">Innsats</p><p class="sr-mini-value">${fmt(wagered)}</p></div>
      <div class="sr-mini-tile"><p class="sr-mini-label">Gevinst</p><p class="sr-mini-value">${fmt(won)}</p></div>
      <div class="sr-mini-tile"><p class="sr-mini-label">Netto</p><p class="sr-mini-value ${netClass}">${fmt(net)}</p></div>
    `;
  }

  function updateOffsetNav(offsetLabelId, offsetPrevId, offsetNextId, periodType, offset) {
    const labelEl = el(offsetLabelId);
    const prevBtn = el(offsetPrevId);
    const nextBtn = el(offsetNextId);
    if (periodType === "year") {
      if (labelEl) labelEl.textContent = "Siste 12 måneder";
      if (prevBtn) prevBtn.disabled = true;
      if (nextBtn) nextBtn.disabled = true;
    } else {
      const { label } = getPeriodRange(periodType, offset);
      if (labelEl) labelEl.textContent = label;
      if (prevBtn) prevBtn.disabled = false;
      if (nextBtn) nextBtn.disabled = offset >= 0;
    }
  }

  function getCardRange(cardState) {
    const { periodType, offset, customFrom, customTo } = cardState;
    if (periodType === "custom") {
      if (customFrom && customTo) return { from: customFrom, to: customTo };
      return null; // not yet applied
    }
    return getPeriodRange(periodType, offset);
  }

  function renderSectionCard(section, gameType) {
    const report = state.report;
    if (!report) return;

    const cardState = state.sectionCards[section][gameType];
    const { periodType, offset } = cardState;

    // ── Tabs active state ────────────────────────────────────────────────
    document.querySelectorAll(`[data-section="${section}"][data-card="${gameType}"][data-cperiod]`).forEach(t => {
      t.classList.toggle("is-active", t.dataset.cperiod === periodType);
    });

    // ── Period nav visibility ─────────────────────────────────────────────
    const pfx      = `sr-${section}-${gameType}`;
    const navEl    = el(`${pfx}-nav`);
    const customEl = el(`${pfx}-custom`);
    const isCustom = periodType === "custom";
    const isYear   = periodType === "year";
    if (navEl)    navEl.hidden    = isCustom;
    if (customEl) customEl.hidden = !isCustom;

    // ── Period nav label + arrows ─────────────────────────────────────────
    if (!isCustom) {
      const labelEl = el(`${pfx}-label`);
      const prevBtn = el(`${pfx}-prev`);
      const nextBtn = el(`${pfx}-next`);
      if (isYear) {
        if (labelEl) labelEl.textContent = "Siste 12 måneder";
        if (prevBtn) prevBtn.disabled = true;
        if (nextBtn) nextBtn.disabled = true;
      } else {
        const { label } = getPeriodRange(periodType, offset);
        if (labelEl) labelEl.textContent = label;
        if (prevBtn) prevBtn.disabled = false;
        if (nextBtn) nextBtn.disabled = offset >= 0;
      }
    }

    // ── Filter daily data ─────────────────────────────────────────────────
    const range = getCardRange(cardState);
    const dailyGame = report.dailyGameBreakdown || [];
    const filtered = range
      ? dailyGame.filter(e => e.gameType === gameType && e.date >= range.from && e.date <= range.to)
      : [];

    const wagered = filtered.reduce((s, e) => s + (e.wagered || 0), 0);
    const won     = filtered.reduce((s, e) => s + (e.won    || 0), 0);
    const net     = won - wagered;   // negative = loss

    // ── Main metric ───────────────────────────────────────────────────────
    const metricEl = el(`${pfx}-metric`);
    if (metricEl) {
      if (section === "innsats") {
        metricEl.textContent = fmt(wagered);
        metricEl.className = "sr-metric-value";
      } else if (section === "premier") {
        metricEl.textContent = fmt(won);
        metricEl.className = "sr-metric-value";
      } else {
        // forbruk
        metricEl.textContent = fmt(net);
        metricEl.className = "sr-metric-value" + (net < 0 ? " is-negative" : net > 0 ? " is-positive" : " is-zero");
      }
    }

    // ── Mini stats (Innsats / Gevinst / Netto) ────────────────────────────
    const statsEl = el(`${pfx}-stats`);
    if (statsEl) {
      const netClass = net < 0 ? " is-negative" : net > 0 ? " is-positive" : "";
      statsEl.innerHTML = `
        <div class="sr-stat-tile"><p class="sr-stat-label">Innsats</p><p class="sr-stat-value">${fmt(wagered)}</p></div>
        <div class="sr-stat-tile"><p class="sr-stat-label">Gevinst</p><p class="sr-stat-value">${fmt(won)}</p></div>
        <div class="sr-stat-tile"><p class="sr-stat-label">Netto</p><p class="sr-stat-value${netClass}">${fmt(net)}</p></div>
      `;
    }

    // ── Bar chart ─────────────────────────────────────────────────────────
    const chartEl = el(`${pfx}-chart`);
    if (chartEl) {
      const gran = periodType === "year" ? "month"
        : periodType === "month" ? "week"
        : "day";
      const rawChart = aggregateByGran(filtered, gran);
      // Remap .net to the metric relevant for this section
      const chartEntries = rawChart.map(e => ({
        date: e.date,
        net:  section === "innsats"  ? (e.wagered || 0)
            : section === "premier"  ? (e.won     || 0)
            :                          (e.won || 0) - (e.wagered || 0)
      }));
      const SECTION_BAR_COLOR = {
        innsats: "#6366f1",
        premier: "#42c471",
        forbruk: null  // auto red/green
      };
      const DOW = ["", "Man", "Tir", "Ons", "Tor", "Fre", "Lør", "Søn"];
      const labelFn = periodType === "year"
        ? k => monthLabel(k).split(" ")[0]
        : periodType === "month"
          ? k => weekLabel(k).split(",")[0]
          : k => DOW[new Date(k + "T12:00:00").getDay() || 7] || k.slice(5);
      chartEl.innerHTML = buildBarChart(chartEntries, {
        width: 460,
        height: 130,
        labelFn,
        showValueLabels: chartEntries.length <= 14,
        darkBg: false,
        positiveOnly: section !== "forbruk",
        barColor: SECTION_BAR_COLOR[section] || null
      });
    }
  }

  function renderAllSectionCards() {
    SECTIONS.forEach(section => {
      GAME_TYPES.forEach(gameType => renderSectionCard(section, gameType));
    });
  }

  function renderForbrukHall() {
    const report = state.report;
    if (!report) return;

    const halls = report.hallBreakdown || [];
    const { hallIndex, periodType, offset } = state.forbrukHall;

    // Hall navigation
    const prevBtn = el("sr-hall-prev");
    const nextBtn = el("sr-hall-next");
    const navLabel = el("sr-hall-nav-label");
    if (halls.length === 0) {
      if (navLabel) navLabel.textContent = "Ingen hall";
      if (prevBtn) prevBtn.disabled = true;
      if (nextBtn) nextBtn.disabled = true;
      const chart = el("sr-hall-chart");
      if (chart) chart.innerHTML = `<p class="sr-empty">Ingen halldata i perioden.</p>`;
      return;
    }

    const clampedIndex = Math.min(hallIndex, halls.length - 1);
    if (clampedIndex !== hallIndex) state.forbrukHall.hallIndex = clampedIndex;
    const currentHall = halls[clampedIndex];

    if (navLabel) navLabel.textContent = `${escHtml(currentHall.hallName)} (${clampedIndex + 1}/${halls.length})`;
    if (prevBtn) prevBtn.disabled = clampedIndex === 0;
    if (nextBtn) nextBtn.disabled = clampedIndex >= halls.length - 1;

    // Period tabs
    const tabs = document.querySelectorAll("[data-hall-period]");
    tabs.forEach(t => {
      t.classList.toggle("is-active", t.dataset.hallPeriod === periodType);
    });

    // Offset nav
    updateOffsetNav("sr-hall-offset-label", "sr-hall-offset-prev", "sr-hall-offset-next", periodType, offset);

    // Filter and aggregate
    const dailyGame = report.dailyGameBreakdown || [];
    const filtered = filterDailyGameByHall(dailyGame, currentHall.hallId, periodType, offset);
    const aggregated = aggregateByGran(filtered, periodType === "year" ? "month" : periodType === "month" ? "week" : "day");

    // Mini summary
    renderMiniSummary("sr-hall-summary", filtered);

    // Chart
    const chart = el("sr-hall-chart");
    if (chart) {
      const labelFn = periodType === "year"
        ? (k) => monthLabel(k)
        : periodType === "month"
          ? (k) => weekLabel(k)
          : null;
      chart.innerHTML = buildBarChart(aggregated, { width: 480, height: 120, labelFn });
    }
  }

  function renderTotalForbruk() {
    const report = state.report;
    if (!report) return;

    const daily = report.dailyBreakdown || [];
    const now   = new Date();
    const today = now.toISOString().slice(0, 10);
    const days  = state.totalForbruk.days;

    // Active tab
    document.querySelectorAll("[data-days]").forEach(btn => {
      btn.classList.toggle("is-active", Number(btn.dataset.days) === days);
    });

    // Period label
    const labelEl = el("sr-total-period-label");
    if (labelEl) {
      if (days === 1) {
        labelEl.textContent = "I dag";
      } else {
        const from = new Date(now);
        from.setDate(from.getDate() - (days - 1));
        const opts = { day: "numeric", month: "short" };
        labelEl.textContent = `${from.toLocaleDateString("nb-NO", opts)} – ${now.toLocaleDateString("nb-NO", opts)}`;
      }
    }

    // Filter entries
    const filtered = (() => {
      if (days === 1) return daily.filter(e => e.date === today);
      const from = new Date(now);
      from.setDate(from.getDate() - (days - 1));
      const fromStr = from.toISOString().slice(0, 10);
      return daily.filter(e => e.date >= fromStr && e.date <= today);
    })();

    const wagered = filtered.reduce((s, e) => s + (e.wagered || 0), 0);
    const won     = filtered.reduce((s, e) => s + (e.won    || 0), 0);
    const net     = won - wagered;

    // Main metric
    const metricEl = el("sr-total-forbruk-metric");
    if (metricEl) {
      metricEl.textContent = fmt(net);
      metricEl.className = "sr-metric-value" +
        (net < 0 ? " is-negative" : net > 0 ? " is-positive" : " is-zero");
    }

    // Stats
    const statsEl = el("sr-total-forbruk-stats");
    if (statsEl) {
      const netClass = net < 0 ? " is-negative" : net > 0 ? " is-positive" : "";
      statsEl.innerHTML = `
        <div class="sr-stat-tile"><p class="sr-stat-label">Innsats</p><p class="sr-stat-value">${fmt(wagered)}</p></div>
        <div class="sr-stat-tile"><p class="sr-stat-label">Gevinst</p><p class="sr-stat-value">${fmt(won)}</p></div>
        <div class="sr-stat-tile"><p class="sr-stat-label">Netto</p><p class="sr-stat-value${netClass}">${fmt(net)}</p></div>
      `;
    }
  }

  // ── Ditt forbruk chart ────────────────────────────────────────────────────

  // Max offset limits (going back in time; offset is <= 0)
  const DITT_DAG_MIN_OFFSET   = -51;  // 52 weeks back
  const DITT_UKE_MIN_OFFSET   = -12;  // 13 × 4 weeks = 52 weeks back

  function getDittDagRange(offset) {
    // offset 0 = current week (Mon–Sun), -1 = last week, etc.
    const now = new Date();
    const dow = now.getDay() || 7; // Mon=1 … Sun=7
    const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dow + 1 + offset * 7);
    const sunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6);
    const from = monday.toISOString().slice(0, 10);
    const to   = sunday.toISOString().slice(0, 10);
    const fmtDate = d => `${String(d.getDate()).padStart(2,"0")}.${String(d.getMonth()+1).padStart(2,"0")}`;
    return { from, to, label: `${fmtDate(monday)} - ${fmtDate(sunday)}` };
  }

  function getDittUkeRange(offset) {
    // offset 0 = last 4 full weeks up to today's week, -1 = previous 4 weeks, etc.
    const now = new Date();
    const dow = now.getDay() || 7;
    // Sunday of current week
    const thisSunday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dow + 7);
    // End of window = thisSunday + offset*28 days
    const endDay = new Date(thisSunday.getFullYear(), thisSunday.getMonth(), thisSunday.getDate() + offset * 28);
    // Start = 28 days before end (exclusive start = end - 27 days)
    const startDay = new Date(endDay.getFullYear(), endDay.getMonth(), endDay.getDate() - 27);
    const from = startDay.toISOString().slice(0, 10);
    const to   = endDay.toISOString().slice(0, 10);
    // Week numbers for label
    const startWeek = parseInt(isoWeekKey(startDay).split("-W")[1]);
    const endWeek   = parseInt(isoWeekKey(endDay).split("-W")[1]);
    const label = `Uke ${startWeek} - ${endWeek}`;
    return { from, to, label };
  }

  // Config per section: metric to display, bar colour, text labels
  const DITT_SECTION_CFG = {
    forbruk: {
      stateKey:     "dittForbruk",
      metric:       "net",          // won - wagered
      barColor:     null,           // auto red/green based on sign
      positiveOnly: false,
      chartLabels:  { dag: "Ditt forbruk de siste 7 dagene", uke: "Ditt forbruk de siste 4 ukene", måned: "Ditt forbruk de siste 12 månedene" }
    },
    innsats: {
      stateKey:     "dittInnsats",
      metric:       "wagered",
      barColor:     "#6366f1",
      positiveOnly: true,
      chartLabels:  { dag: "Din innsats de siste 7 dagene", uke: "Din innsats de siste 4 ukene", måned: "Din innsats de siste 12 månedene" }
    },
    premier: {
      stateKey:     "dittPremier",
      metric:       "won",
      barColor:     "#42c471",
      positiveOnly: true,
      chartLabels:  { dag: "Dine premier de siste 7 dagene", uke: "Dine premier de siste 4 ukene", måned: "Dine premier de siste 12 månedene" }
    }
  };

  function renderDittSection(sectionKey) {
    const report = state.report;
    if (!report) return;

    const cfg = DITT_SECTION_CFG[sectionKey];
    const daily = report.dailyBreakdown || [];
    const { periodType, offset } = state[cfg.stateKey];
    const pfx = `sr-ditt-${sectionKey}`;

    // ── Active tab ────────────────────────────────────────────────────────
    document.querySelectorAll(`[data-ditt-section="${sectionKey}"]`).forEach(btn => {
      btn.classList.toggle("is-active", btn.dataset.dittPeriod === periodType);
    });

    // ── Period nav visibility ─────────────────────────────────────────────
    const navEl  = el(`${pfx}-nav`);
    const prevEl = el(`${pfx}-prev`);
    const nextEl = el(`${pfx}-next`);
    const navLbl = el(`${pfx}-nav-label`);

    if (navEl) navEl.hidden = periodType === "måned";

    // ── Compute date range ────────────────────────────────────────────────
    let from, to, navLabel, gran, labelFn;

    if (periodType === "dag") {
      const r = getDittDagRange(offset);
      from = r.from; to = r.to; navLabel = r.label;
      gran = "day";
      const DOW = ["", "Man", "Tir", "Ons", "Tor", "Fre", "Lør", "Søn"];
      labelFn = k => DOW[new Date(k + "T12:00:00").getDay() || 7] || k.slice(5);
      if (prevEl) prevEl.disabled = offset <= DITT_DAG_MIN_OFFSET;
      if (nextEl) nextEl.disabled = offset >= 0;
    } else if (periodType === "uke") {
      const r = getDittUkeRange(offset);
      from = r.from; to = r.to; navLabel = r.label;
      gran = "week";
      labelFn = k => weekLabel(k).split(",")[0];
      if (prevEl) prevEl.disabled = offset <= DITT_UKE_MIN_OFFSET;
      if (nextEl) nextEl.disabled = offset >= 0;
    } else {
      const now  = new Date();
      to   = now.toISOString().slice(0, 10);
      from = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate() + 1).toISOString().slice(0, 10);
      navLabel = "";
      gran = "month";
      labelFn = k => monthLabel(k).split(" ")[0];
    }

    if (navLbl) navLbl.textContent = navLabel;

    // ── Filter + aggregate ────────────────────────────────────────────────
    const filtered   = daily.filter(e => e.date >= from && e.date <= to);
    const raw        = aggregateByGran(filtered, gran);

    // Remap to .net so buildBarChart can use a common key
    const aggregated = raw.map(e => ({
      date: e.date,
      net:  cfg.metric === "net"     ? (e.won || 0) - (e.wagered || 0)
          : cfg.metric === "wagered" ? (e.wagered || 0)
          :                            (e.won     || 0)
    }));

    // ── Summary value ─────────────────────────────────────────────────────
    const total = filtered.reduce((s, e) => {
      if (cfg.metric === "net")     return s + (e.won || 0) - (e.wagered || 0);
      if (cfg.metric === "wagered") return s + (e.wagered || 0);
      return s + (e.won || 0);
    }, 0);

    const summaryEl = el(`${pfx}-label`);
    if (summaryEl) {
      summaryEl.textContent = fmt(total);
      if (cfg.metric === "net") {
        summaryEl.className = total < 0 ? "is-negative" : total > 0 ? "is-positive" : "";
      } else {
        summaryEl.className = "";
      }
    }

    // ── Chart title ───────────────────────────────────────────────────────
    const titleEl = el(`${pfx}-chart-title`);
    if (titleEl) titleEl.textContent = cfg.chartLabels[periodType];

    // ── Chart ─────────────────────────────────────────────────────────────
    const chartEl = el(`${pfx}-chart`);
    if (chartEl) {
      chartEl.innerHTML = buildBarChart(aggregated, {
        width:             700,
        height:            180,
        labelFn,
        showValueLabels:   aggregated.length <= 14,
        darkBg:            false,
        positiveOnly:      cfg.positiveOnly,
        barColor:          cfg.barColor
      });
    }
  }

  function renderAllDittSections() {
    renderDittSection("forbruk");
    // "innsats" and "premier" charts are now rendered inline in each game card
    // via renderSectionCard() — no standalone "ditt" sections needed.
  }

  // ── Render ────────────────────────────────────────────────────────────────

  function renderLoadingState() {
    const loading = el("sr-loading");
    const content = el("sr-content");
    if (loading) loading.hidden = false;
    if (content) content.hidden = true;
  }

  function renderAll() {
    const loading = el("sr-loading");
    const content = el("sr-content");
    const errBox  = el("sr-error");

    if (loading) loading.hidden = true;

    if (state.error) {
      if (errBox) { errBox.textContent = state.error; errBox.hidden = false; }
      if (content) content.hidden = true;
      return;
    }
    if (errBox) errBox.hidden = true;

    if (!state.report) {
      if (content) content.hidden = true;
      return;
    }

    if (content) content.hidden = false;

    renderTotalForbruk();
    renderAllDittSections();
    renderAllSectionCards();
    renderForbrukHall();
    renderExportSection();
  }

  function renderExportSection() {
    const emailBtn = el("sr-email-btn");
    if (emailBtn) emailBtn.disabled = false;
  }

  // ── Export ────────────────────────────────────────────────────────────────

  async function requestEmailExport() {
    const btn = el("sr-email-btn");
    const msg = el("sr-export-msg");
    if (btn) btn.disabled = true;
    if (msg) { msg.textContent = "Sender..."; msg.hidden = false; }

    const body = {
      period: "year",
      offset: 0,
      hallId: state.hallId || undefined,
      delivery: "email"
    };

    try {
      const res = await fetch("/api/spillevett/report/export", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${state.token}`
        },
        body: JSON.stringify(body)
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message || "Feil.");
      if (msg) msg.textContent = "Spillregnskap er sendt til din e-postadresse.";
    } catch (err) {
      if (msg) msg.textContent = "Kunne ikke sende: " + err.message;
      if (btn) btn.disabled = false;
    }
  }

  // ── Fetch ─────────────────────────────────────────────────────────────────

  async function fetchReport() {
    if (!state.token) return;
    state.loading = true;
    state.error = "";
    renderLoadingState();

    const params = new URLSearchParams({ period: "year", offset: "0" });
    if (state.hallId) params.set("hallId", state.hallId);

    try {
      const res = await fetch(`/api/spillevett/report?${params.toString()}`, {
        headers: { Authorization: `Bearer ${state.token}` }
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message || "Feil ved henting av spillregnskap.");
      state.report = json.data || json;
    } catch (err) {
      state.error = err.message || "Nettverksfeil.";
      state.report = null;
    } finally {
      state.loading = false;
      renderAll();
    }
  }

  // ── View show/hide ────────────────────────────────────────────────────────

  function show(opts) {
    state.token  = opts?.token  || state.token;
    state.hallId = opts?.hallId || state.hallId;

    const view = el("spillregnskap-view");
    if (view) {
      view.hidden = false;
      view.scrollTop = 0;
    }

    // Reset state
    state.report = null;
    state.error  = "";
    state.sectionCards = defaultSectionCards();
    state.forbrukHall  = { hallIndex: 0, periodType: "week", offset: 0 };
    state.totalForbruk = { days: 1 };
    state.dittForbruk  = { periodType: "dag", offset: 0 };
    state.dittInnsats  = { periodType: "dag", offset: 0 };
    state.dittPremier  = { periodType: "dag", offset: 0 };

    void fetchReport();
  }

  function hide() {
    const view = el("spillregnskap-view");
    if (view) view.hidden = true;
  }

  // ── Init ──────────────────────────────────────────────────────────────────

  function init() {
    // Back button
    const backBtn = el("sr-back-btn");
    if (backBtn) backBtn.addEventListener("click", () => hide());

    // ── Section cards (Innsats / Premier / Forbruk per spill) ────────────

    SECTIONS.forEach(section => {
      GAME_TYPES.forEach(gameType => {
        // Period tabs
        document.querySelectorAll(`[data-section="${section}"][data-card="${gameType}"][data-cperiod]`).forEach(btn => {
          btn.addEventListener("click", () => {
            state.sectionCards[section][gameType].periodType = btn.dataset.cperiod;
            state.sectionCards[section][gameType].offset = 0;
            renderSectionCard(section, gameType);
          });
        });

        // Prev period
        const prevBtn = el(`sr-${section}-${gameType}-prev`);
        if (prevBtn) {
          prevBtn.addEventListener("click", () => {
            state.sectionCards[section][gameType].offset--;
            renderSectionCard(section, gameType);
          });
        }

        // Next period
        const nextBtn = el(`sr-${section}-${gameType}-next`);
        if (nextBtn) {
          nextBtn.addEventListener("click", () => {
            if (state.sectionCards[section][gameType].offset < 0) {
              state.sectionCards[section][gameType].offset++;
              renderSectionCard(section, gameType);
            }
          });
        }

        // Custom date range apply
        const applyBtn = document.querySelector(`[data-section-apply="${section}"][data-card-apply="${gameType}"]`);
        if (applyBtn) {
          applyBtn.addEventListener("click", () => {
            const fromInput = el(`sr-${section}-${gameType}-from`);
            const toInput   = el(`sr-${section}-${gameType}-to`);
            if (fromInput?.value && toInput?.value) {
              state.sectionCards[section][gameType].customFrom = fromInput.value;
              state.sectionCards[section][gameType].customTo   = toInput.value;
              renderSectionCard(section, gameType);
            }
          });
        }
      });
    });

    // ── Forbruk per hall ───────────────────────────────────────────────────

    const hallPrev = el("sr-hall-prev");
    if (hallPrev) {
      hallPrev.addEventListener("click", () => {
        if (state.forbrukHall.hallIndex > 0) {
          state.forbrukHall.hallIndex--;
          renderForbrukHall();
        }
      });
    }

    const hallNext = el("sr-hall-next");
    if (hallNext) {
      hallNext.addEventListener("click", () => {
        const halls = state.report?.hallBreakdown || [];
        if (state.forbrukHall.hallIndex < halls.length - 1) {
          state.forbrukHall.hallIndex++;
          renderForbrukHall();
        }
      });
    }

    document.querySelectorAll("[data-hall-period]").forEach(btn => {
      btn.addEventListener("click", () => {
        state.forbrukHall.periodType = btn.dataset.hallPeriod;
        state.forbrukHall.offset = 0;
        renderForbrukHall();
      });
    });

    const hallOffsetPrev = el("sr-hall-offset-prev");
    if (hallOffsetPrev) {
      hallOffsetPrev.addEventListener("click", () => {
        state.forbrukHall.offset--;
        renderForbrukHall();
      });
    }

    const hallOffsetNext = el("sr-hall-offset-next");
    if (hallOffsetNext) {
      hallOffsetNext.addEventListener("click", () => {
        if (state.forbrukHall.offset < 0) {
          state.forbrukHall.offset++;
          renderForbrukHall();
        }
      });
    }

    // ── Totalt forbruk period tabs ─────────────────────────────────────────

    document.querySelectorAll("[data-days]").forEach(btn => {
      btn.addEventListener("click", () => {
        state.totalForbruk.days = Number(btn.dataset.days);
        renderTotalForbruk();
      });
    });

    // ── Ditt forbruk / innsats / premier chart tabs + nav ─────────────────

    ["forbruk", "innsats", "premier"].forEach(sectionKey => {
      const cfg = DITT_SECTION_CFG[sectionKey];
      const stateRef = state[cfg.stateKey];
      const pfx = `sr-ditt-${sectionKey}`;

      // Period tabs
      document.querySelectorAll(`[data-ditt-section="${sectionKey}"]`).forEach(btn => {
        btn.addEventListener("click", () => {
          stateRef.periodType = btn.dataset.dittPeriod;
          stateRef.offset = 0;
          renderDittSection(sectionKey);
        });
      });

      // Prev nav
      const prevBtn = el(`${pfx}-prev`);
      if (prevBtn) {
        prevBtn.addEventListener("click", () => {
          const min = stateRef.periodType === "dag" ? DITT_DAG_MIN_OFFSET : DITT_UKE_MIN_OFFSET;
          if (stateRef.offset > min) {
            stateRef.offset--;
            renderDittSection(sectionKey);
          }
        });
      }

      // Next nav
      const nextBtn = el(`${pfx}-next`);
      if (nextBtn) {
        nextBtn.addEventListener("click", () => {
          if (stateRef.offset < 0) {
            stateRef.offset++;
            renderDittSection(sectionKey);
          }
        });
      }
    });

    // Email export
    const emailBtn = el("sr-email-btn");
    if (emailBtn) emailBtn.addEventListener("click", () => requestEmailExport());
  }

  document.addEventListener("DOMContentLoaded", init);

  // ── Public API ────────────────────────────────────────────────────────────

  window.Spillregnskap = { show, hide };
})();

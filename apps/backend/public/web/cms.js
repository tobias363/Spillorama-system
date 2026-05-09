// cms.js — Public CMS player-shell wiring (BIN-777 A10).
//
// Henter publisert innhold fra `/api/cms/*` (un-authenticated endpoints)
// og rendrer det enten i den eksisterende `info-overlay`-modalen eller i
// en ny full-side-vy som matcher player-shell-designet. Footer-lenker fra
// både login-overlay (pre-login) og lobby (post-login) routes hit.
//
// SPA-routes støttes via `pathname`:
//   /web/faq                 → CMS FAQ-liste
//   /web/terms               → CMS terms (alias for `terms-of-service`)
//   /web/responsible-gaming  → CMS responsible-gaming (regulatorisk slug)
//   /web/about               → CMS aboutus
//
// Server-route fallback (apps/backend/src/index.ts:4349) sender alle
// /web/*-paths til index.html, så routing skjer client-side ved
// DOMContentLoaded (history.pushState og popstate).
//
// Markdown-rendering:
//   Innholdet kan være ren tekst, lett markdown, eller HTML. For å unngå
//   XSS-risiko escapes vi alle tegn først, deretter konverterer vi en
//   smal whitelist av markdown-konstrukter til strukturert HTML. Faktiske
//   `<script>`-tags eller andre farlige HTML-fragmenter blir derfor
//   rendret som tekst, ikke kjørt.
//
// Cache:
//   Backend setter `Cache-Control: public, max-age=300` på 200-svar.
//   Vi legger på en 5-min in-memory-cache i klienten i tillegg så
//   panel-toggle ikke trigger nye HTTP-kall. 404 cache-es ikke.

(function () {
  'use strict';

  // ── Konstanter ───────────────────────────────────────────────────────
  // Mapping fra `key` brukt av footer-lenker / SPA-routes til CMS-slug
  // brukt av backend. Holdes eksplisitt så vi har én sannhetskilde.
  var CMS_KEYS = {
    faq:           { slug: null,                 title: 'Ofte stilte spørsmål', kind: 'faq' },
    terms:         { slug: 'terms',              title: 'Vilkår og betingelser', kind: 'text' },
    responsible:   { slug: 'responsible-gaming', title: 'Ansvarlig spill',       kind: 'text' },
    support:       { slug: 'support',            title: 'Kundeservice',          kind: 'text' },
    about:         { slug: 'aboutus',            title: 'Om Spillorama',         kind: 'text' }
  };

  // /web/<path> → key i CMS_KEYS. Behold i samme rekkefølge som
  // CMS_KEYS for å gjøre det lett å skanne.
  var ROUTE_TO_KEY = {
    '/web/faq':                'faq',
    '/web/terms':              'terms',
    '/web/responsible-gaming': 'responsible',
    '/web/about':              'about'
  };

  // 5-min in-memory-cache. Speiler backendens max-age så vi unngår
  // dobbel-fetch når brukeren toggler mellom panel-modus og full-page.
  var CACHE_TTL_MS = 5 * 60 * 1000;
  var cache = Object.create(null);

  // ── Cache-helpers ────────────────────────────────────────────────────
  function cacheGet(key) {
    var entry = cache[key];
    if (!entry) return null;
    if (Date.now() - entry.t > CACHE_TTL_MS) {
      delete cache[key];
      return null;
    }
    return entry.v;
  }

  function cacheSet(key, value) {
    cache[key] = { t: Date.now(), v: value };
  }

  // ── Sanitization + minimal Markdown ──────────────────────────────────
  // Først escape ALL HTML, deretter konverter et begrenset sett av
  // markdown-konstrukter. Aldri kjør innkommende HTML direkte.
  function escapeHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // Tillatte protokoller for autolinks. Filtrer ut javascript:, data:, vbs:
  function isSafeUrl(url) {
    var trimmed = String(url || '').trim().toLowerCase();
    if (!trimmed) return false;
    if (trimmed.indexOf('javascript:') === 0) return false;
    if (trimmed.indexOf('data:') === 0) return false;
    if (trimmed.indexOf('vbscript:') === 0) return false;
    return /^(https?:|mailto:|tel:|\/|#)/.test(trimmed);
  }

  // Konverter inline markdown (bold/italic/code/links). Inputtet er
  // ALLEREDE escapet, så vi opererer på `&lt;`/`&gt;` etc. Vi ser ikke
  // etter <a>-tags i input — kun markdown-syntaks.
  function renderInline(escaped) {
    // Code first, så bold/italic ikke spiser tegn inni `code`.
    var out = escaped.replace(/`([^`]+?)`/g, function (_, m) {
      return '<code>' + m + '</code>';
    });

    // [text](url) — kun trygge protokoller. URL har ikke vært inn i
    // escapeHtml-loopen for `&` siden det ble erstattet til `&amp;` —
    // det er OK for href siden brukere kan bruke `&` i URL-er.
    out = out.replace(/\[([^\]]+?)\]\(([^)\s]+?)\)/g, function (_, text, url) {
      // URL ble escapet sammen med resten av strengen, så `&amp;` er
      // forventet i href. Det bryter ikke nettleseren.
      var unescapedForCheck = url.replace(/&amp;/g, '&');
      if (!isSafeUrl(unescapedForCheck)) {
        return text;
      }
      return '<a href="' + url + '" target="_blank" rel="noopener noreferrer">' + text + '</a>';
    });

    // **bold** (må stå før *italic*)
    out = out.replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>');
    // *italic* — utelat enkelte ord-grenser
    out = out.replace(/(^|[\s(])\*(?!\s)([^*\n]+?)(?<!\s)\*/g, '$1<em>$2</em>');

    return out;
  }

  // Block-level markdown: # heading, ## sub-heading, lister, paragrafer.
  // Skiller på blanke linjer.
  function renderMarkdown(content) {
    if (!content) return '';
    var escaped = escapeHtml(content);
    var lines = escaped.split(/\r?\n/);

    var html = [];
    var i = 0;
    while (i < lines.length) {
      var line = lines[i];

      // Skip blank lines
      if (!line.trim()) { i++; continue; }

      // ATX heading: # Title, ## Sub
      var headingMatch = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
      if (headingMatch) {
        var level = Math.min(6, headingMatch[1].length + 2); // h3, h4, h5...
        // Capping: # → h3 (h2 er reservert for panel-tittel), ## → h4
        var tag = 'h' + level;
        html.push('<' + tag + '>' + renderInline(headingMatch[2]) + '</' + tag + '>');
        i++;
        continue;
      }

      // Unordered list: -, *, eller +
      if (/^\s*[-*+]\s+/.test(line)) {
        html.push('<ul>');
        while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
          var itemText = lines[i].replace(/^\s*[-*+]\s+/, '');
          html.push('<li>' + renderInline(itemText) + '</li>');
          i++;
        }
        html.push('</ul>');
        continue;
      }

      // Ordered list: 1. 2. 3.
      if (/^\s*\d+\.\s+/.test(line)) {
        html.push('<ol>');
        while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
          var orderedText = lines[i].replace(/^\s*\d+\.\s+/, '');
          html.push('<li>' + renderInline(orderedText) + '</li>');
          i++;
        }
        html.push('</ol>');
        continue;
      }

      // Paragraph — slå sammen linjer til neste blanke
      var paragraph = [];
      while (i < lines.length && lines[i].trim() &&
             !/^(#{1,6})\s+/.test(lines[i]) &&
             !/^\s*[-*+]\s+/.test(lines[i]) &&
             !/^\s*\d+\.\s+/.test(lines[i])) {
        paragraph.push(lines[i]);
        i++;
      }
      if (paragraph.length) {
        html.push('<p>' + renderInline(paragraph.join(' ')) + '</p>');
      }
    }

    return html.join('\n');
  }

  // ── Backend fetch ────────────────────────────────────────────────────
  // Bruk un-authenticated fetch — ingen Bearer-header, så endpointet
  // kan kalles før innlogging. 404 propageres som null så caller kan
  // vise "ikke publisert"-melding.
  async function fetchCmsContent(slug) {
    var cacheKey = 'slug:' + slug;
    var cached = cacheGet(cacheKey);
    if (cached !== null) return cached;

    var res;
    try {
      res = await fetch('/api/cms/' + encodeURIComponent(slug), {
        method: 'GET',
        headers: { 'Accept': 'application/json' }
      });
    } catch (err) {
      throw new Error('NETWORK_ERROR');
    }
    if (res.status === 404) return null;
    if (!res.ok) throw new Error('HTTP_' + res.status);
    var body = await res.json();
    if (!body.ok || !body.data) throw new Error('INVALID_RESPONSE');
    cacheSet(cacheKey, body.data);
    return body.data;
  }

  async function fetchCmsFaq() {
    var cacheKey = 'faq';
    var cached = cacheGet(cacheKey);
    if (cached !== null) return cached;

    var res;
    try {
      res = await fetch('/api/cms/faq', {
        method: 'GET',
        headers: { 'Accept': 'application/json' }
      });
    } catch (err) {
      throw new Error('NETWORK_ERROR');
    }
    if (res.status === 404) return { faqs: [], count: 0 };
    if (!res.ok) throw new Error('HTTP_' + res.status);
    var body = await res.json();
    if (!body.ok || !body.data) throw new Error('INVALID_RESPONSE');
    cacheSet(cacheKey, body.data);
    return body.data;
  }

  // ── Render-hjelpere ──────────────────────────────────────────────────
  function renderFaqHtml(data) {
    if (!data || !data.faqs || data.faqs.length === 0) {
      return '<div class="cms-empty">Ingen ofte stilte spørsmål er publisert ennå.</div>';
    }
    var parts = ['<dl class="cms-faq-list">'];
    data.faqs.forEach(function (entry) {
      parts.push(
        '<dt class="cms-faq-q">' + escapeHtml(entry.question) + '</dt>' +
        '<dd class="cms-faq-a">' + renderMarkdown(entry.answer) + '</dd>'
      );
    });
    parts.push('</dl>');
    return parts.join('');
  }

  function renderTextHtml(data) {
    if (!data || !data.content) {
      return '<div class="cms-empty">Innholdet er ikke publisert ennå.</div>';
    }
    return renderMarkdown(data.content);
  }

  function renderError(err) {
    var msg = err && err.message ? err.message : 'UKJENT_FEIL';
    if (msg === 'NETWORK_ERROR') {
      return '<div class="cms-error">Kunne ikke kontakte serveren. Sjekk internett-tilkoblingen og prøv igjen.</div>';
    }
    return '<div class="cms-error">Kunne ikke laste innhold (' + escapeHtml(msg) + ').</div>';
  }

  // ── Panel-modus (modal overlay i lobbyen) ────────────────────────────
  // Speiler den gamle `showInfoPanel`-API-en, men henter nå fra backend.
  async function showCmsPanel(key) {
    var entry = CMS_KEYS[key];
    if (!entry) return;

    var titleEl = document.getElementById('info-panel-title');
    var bodyEl = document.getElementById('info-panel-body');
    var overlayEl = document.getElementById('info-overlay');
    if (!titleEl || !bodyEl || !overlayEl) return;

    titleEl.textContent = entry.title;
    bodyEl.innerHTML = '<div class="cms-loading">Laster ' + escapeHtml(entry.title.toLowerCase()) + '...</div>';
    overlayEl.classList.add('is-visible');

    try {
      if (entry.kind === 'faq') {
        var faqData = await fetchCmsFaq();
        bodyEl.innerHTML = renderFaqHtml(faqData);
      } else {
        var data = await fetchCmsContent(entry.slug);
        bodyEl.innerHTML = renderTextHtml(data);
      }
    } catch (err) {
      bodyEl.innerHTML = renderError(err);
    }
  }

  // ── Full-page mode (SPA route /web/<key>) ────────────────────────────
  // Når brukeren navigerer direkte til /web/faq, /web/terms etc. skal
  // vi vise en fullside-vy. Vi gjenbruker den eksisterende lobby-shellen
  // og bytter ut `lobby-screen` med en dedikert `cms-page-view`.
  function ensureCmsPageView() {
    var view = document.getElementById('cms-page-view');
    if (view) return view;

    view = document.createElement('section');
    view.id = 'cms-page-view';
    view.setAttribute('aria-label', 'Informasjon');
    view.hidden = true;
    view.innerHTML =
      '<div class="cms-page-topbar">' +
        '<button id="cms-page-back-btn" class="cms-page-back-btn" type="button" aria-label="Tilbake">' +
          '<span aria-hidden="true">&larr;</span> Tilbake' +
        '</button>' +
        '<h1 id="cms-page-title" class="cms-page-title">Informasjon</h1>' +
      '</div>' +
      '<main id="cms-page-body" class="cms-page-body">' +
        '<div class="cms-loading">Laster...</div>' +
      '</main>' +
      '<footer id="cms-page-footer" class="cms-page-footer"></footer>';

    document.body.appendChild(view);

    var backBtn = view.querySelector('#cms-page-back-btn');
    if (backBtn) {
      backBtn.addEventListener('click', function () {
        // Hvis vi har historie, gå tilbake; ellers naviger til /web/.
        if (window.history.length > 1 && document.referrer && document.referrer.indexOf(window.location.origin) === 0) {
          window.history.back();
        } else {
          navigate('/web/');
        }
      });
    }

    // Render footer-lenker (samme som lobby-footer, men route via SPA).
    renderCmsFooter(view.querySelector('#cms-page-footer'));

    return view;
  }

  function renderCmsFooter(container) {
    if (!container) return;
    container.innerHTML =
      '<a href="/web/faq"                data-cms-link="faq">FAQ</a>' +
      '<a href="/web/terms"              data-cms-link="terms">Vilkår</a>' +
      '<a href="/web/responsible-gaming" data-cms-link="responsible">Ansvarlig spill</a>' +
      '<a href="/web/about"              data-cms-link="about">Om Spillorama</a>';

    // Intercept kliks og bruk SPA-routing (history.pushState) når
    // tilgjengelig. Behold middle-click / ctrl-click default-oppførsel.
    container.addEventListener('click', function (e) {
      var link = e.target.closest('a[data-cms-link]');
      if (!link) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return;
      e.preventDefault();
      navigate(link.getAttribute('href'));
    });
  }

  function showOnlyCmsView() {
    // Skjul alle hoved-skjermer; vis kun CMS-page-view.
    var hide = ['login-overlay', 'lobby-screen', 'web-game-container', 'spillregnskap-view'];
    hide.forEach(function (id) {
      var el = document.getElementById(id);
      if (el) {
        el.classList.remove('is-visible');
        el.hidden = true;
      }
    });
    var view = ensureCmsPageView();
    view.hidden = false;
  }

  function hideCmsView() {
    var view = document.getElementById('cms-page-view');
    if (view) view.hidden = true;
  }

  async function showCmsFullPage(key) {
    var entry = CMS_KEYS[key];
    if (!entry) {
      // Ukjent key — naviger tilbake til lobby.
      navigate('/web/');
      return;
    }

    showOnlyCmsView();
    document.title = entry.title + ' — Spillorama';

    var titleEl = document.getElementById('cms-page-title');
    var bodyEl = document.getElementById('cms-page-body');
    if (titleEl) titleEl.textContent = entry.title;
    if (bodyEl) bodyEl.innerHTML = '<div class="cms-loading">Laster ' + escapeHtml(entry.title.toLowerCase()) + '...</div>';

    try {
      if (entry.kind === 'faq') {
        var faqData = await fetchCmsFaq();
        if (bodyEl) bodyEl.innerHTML = renderFaqHtml(faqData);
      } else {
        var data = await fetchCmsContent(entry.slug);
        if (bodyEl) bodyEl.innerHTML = renderTextHtml(data);
      }
    } catch (err) {
      if (bodyEl) bodyEl.innerHTML = renderError(err);
    }
  }

  // ── Routing ──────────────────────────────────────────────────────────
  // history.pushState-basert SPA-routing. Backend-fallback (index.ts:4349)
  // sender `/web/*` til index.html, så denne logikken tar over når DOM er
  // klar.
  function pathToKey(pathname) {
    var clean = String(pathname || '').replace(/\/+$/, '');
    return ROUTE_TO_KEY[clean] || null;
  }

  function navigate(href) {
    if (!href || typeof href !== 'string') return;
    if (href.indexOf('http') === 0 && href.indexOf(window.location.origin) !== 0) {
      // Eksterne lenker — la nettleseren håndtere det.
      window.location.href = href;
      return;
    }
    var url;
    try {
      url = new URL(href, window.location.origin);
    } catch (e) {
      return;
    }
    window.history.pushState({}, '', url.toString());
    handleRoute();
  }

  function handleRoute() {
    var key = pathToKey(window.location.pathname);
    if (key) {
      showCmsFullPage(key);
    } else {
      hideCmsView();
      // La index.html sin egen lobby/login-flyt ta over
      // (auth.js + lobby.js håndterer login-overlay vs lobby-screen).
      // Sett title tilbake.
      document.title = 'SPILLORAMA';
    }
  }

  function mountRouter() {
    // Lytt på SPA-navigasjon
    window.addEventListener('popstate', handleRoute);

    // Intercept kliks på <a href="/web/...">-lenker fra hvor som helst
    // i player-shellen (inkl. footer-lenker i lobby + login-overlay).
    document.addEventListener('click', function (e) {
      var link = e.target.closest('a[href^="/web/"]');
      if (!link) return;
      // Tillat default for nye-fane og last-meny.
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return;
      var href = link.getAttribute('href');
      if (!pathToKey(href.replace(/\/+$/, ''))) return; // bare våre 4 ruter
      e.preventDefault();
      navigate(href);
    });

    // Initial route on first load
    handleRoute();
  }

  // ── Footer-injeksjon (pre-login overlay) ─────────────────────────────
  // Login-overlay har historisk ikke hatt footer-lenker. Per
  // pengespillforskriften skal spilleren kunne lese ansvarlig-spill og
  // vilkår FØR konto-oppretting, så vi monterer en mini-footer i
  // login-card-en.
  function injectLoginFooter() {
    var card = document.querySelector('#login-overlay .login-card');
    if (!card) return;
    if (card.querySelector('.cms-login-footer')) return; // idempotent

    var footer = document.createElement('div');
    footer.className = 'cms-login-footer';
    footer.innerHTML =
      '<a href="/web/faq"                data-cms-link="faq">FAQ</a>' +
      '<span class="cms-sep">·</span>' +
      '<a href="/web/terms"              data-cms-link="terms">Vilkår</a>' +
      '<span class="cms-sep">·</span>' +
      '<a href="/web/responsible-gaming" data-cms-link="responsible">Ansvarlig spill</a>' +
      '<span class="cms-sep">·</span>' +
      '<a href="/web/about"              data-cms-link="about">Om Spillorama</a>';

    card.appendChild(footer);
  }

  // ── Public API ───────────────────────────────────────────────────────
  // Bevarer `showInfoPanel`-navnet så footer-onclicks fortsatt fungerer
  // uten å endre `index.html` mer enn nødvendig. Den gamle `INFO_CONTENT`-
  // dictionaryen blir overflødig — vi overstyrer funksjonen her.
  window.showInfoPanel = showCmsPanel;

  window.SpilloramaCms = {
    showPanel: showCmsPanel,
    showFullPage: showCmsFullPage,
    navigate: navigate,
    fetchSlug: fetchCmsContent,
    fetchFaq: fetchCmsFaq,
    renderMarkdown: renderMarkdown,
    escapeHtml: escapeHtml
  };

  // ── Init ─────────────────────────────────────────────────────────────
  function init() {
    injectLoginFooter();
    mountRouter();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

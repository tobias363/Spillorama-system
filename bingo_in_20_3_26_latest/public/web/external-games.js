/**
 * Full HTML Game Grid — 3x2 CSS Grid over Unity-canvasen.
 * DEBUG VERSION — visuell diagnostikk for å finne alignment-problemer.
 *
 * Alle 6 tiles har identisk design. Unity-spill har pointer-events:none
 * slik at klikk passerer gjennom HTML-overlayet til Unity-canvasen.
 * Candy Mania har pointer-events:auto og åpner via iframe.
 */
(function () {
  'use strict';

  // ── Debug Logger ──────────────────────────────────────────────
  var DEBUG = true;
  var debugLog = [];
  function dlog(msg, level) {
    var ts = new Date().toISOString().substr(11, 12);
    var entry = '[EXT-DBG ' + ts + '] ' + (level ? '[' + level + '] ' : '') + msg;
    debugLog.push(entry);
    if (level === 'ERR') console.error(entry);
    else if (level === 'WARN') console.warn(entry);
    else console.log(entry);
    // Oppdater debug-panel live
    var logEl = document.getElementById('dbg-log');
    if (logEl) {
      logEl.textContent = debugLog.slice(-30).join('\n');
      logEl.scrollTop = logEl.scrollHeight;
    }
  }

  // ── Spillkatalog ──────────────────────────────────────────────
  var GAMES = [
    {
      id: 'papir-bingo', name: 'Papir bingo',
      image: '/web/assets/games/papirbingo.png',
      status: 'Stengt', statusColor: '#5bbf72', closedColor: '#e74c3c',
      type: 'unity'
    },
    {
      id: 'lynbingo', name: 'Lynbingo',
      image: '/web/assets/games/bingo_1.png',
      status: 'Åpen', statusColor: '#5bbf72',
      btnText: 'Spill nå', type: 'unity'
    },
    {
      id: 'bingo-bonanza', name: 'BingoBonanza',
      image: '/web/assets/games/bingo_3.png',
      status: 'Åpen', statusColor: '#5bbf72',
      btnText: 'Spill nå', type: 'unity'
    },
    {
      id: 'turbomania', name: 'Turbomania',
      image: '/web/assets/games/bingo_4.png',
      status: 'Åpen', statusColor: '#5bbf72',
      btnText: 'Spill nå', type: 'unity'
    },
    {
      id: 'spinngo', name: 'SpinnGo',
      image: '/web/assets/games/gold-digger.png',
      status: 'Åpen', statusColor: '#5bbf72',
      btnText: 'Spill nå', type: 'unity'
    },
    {
      id: 'candy-mania', name: 'Candy Mania',
      image: '/web/assets/games/candy.png',
      status: 'Åpen', statusColor: '#5bbf72',
      badge: 'NYTT!', badgeColor: '#ff4444',
      btnText: 'Spill nå',
      type: 'external', url: '/candy/'
    }
  ];

  // ── Debug-farger for hver tile ────────────────────────────────
  var TILE_COLORS = [
    'rgba(255,0,0,0.4)',     // rød - Papir bingo
    'rgba(0,255,0,0.4)',     // grønn - Lynbingo
    'rgba(0,0,255,0.4)',     // blå - BingoBonanza
    'rgba(255,255,0,0.4)',   // gul - Turbomania
    'rgba(255,0,255,0.4)',   // magenta - SpinnGo
    'rgba(0,255,255,0.4)'    // cyan - Candy Mania
  ];
  var TILE_BORDER_COLORS = [
    '#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff', '#00ffff'
  ];

  // ── CSS ────────────────────────────────────────────────────────
  var css = document.createElement('style');
  css.textContent = '\
#ext-games-wrap {\
  position: fixed;\
  z-index: 100;\
  top: 12%;\
  left: 0; right: 0; bottom: 0;\
  display: grid;\
  grid-template-columns: 1fr 1fr 1fr;\
  grid-template-rows: 1fr 1fr;\
  gap: 10px 0;\
  padding: 10px 5%;\
  pointer-events: none;\
  background: url("TemplateData/bg.png") center / cover no-repeat fixed;\
}\
\
/* DEBUG: Gjør bakgrunn semi-transparent slik at vi ser Unity under */\
#ext-games-wrap.dbg-transparent {\
  background: rgba(20, 20, 50, 0.3) !important;\
}\
#ext-games-wrap.dbg-hidden {\
  opacity: 0 !important;\
}\
\
.ext-cell {\
  display: flex;\
  align-items: center;\
  justify-content: center;\
  pointer-events: none;\
}\
\
.ext-tile {\
  width: 80%;\
  max-width: 300px;\
  text-align: center;\
  color: #fff;\
  position: relative;\
  font-family: "Segoe UI", Arial, sans-serif;\
  pointer-events: none;\
}\
\
/* Bare external-tiles (Candy) fanger klikk */\
.ext-tile[data-type="external"] {\
  pointer-events: auto;\
  cursor: pointer;\
}\
\
.ext-tile-name {\
  font-size: clamp(14px, 1.5vw, 22px);\
  font-weight: 700;\
  margin-bottom: 0.3em;\
  text-shadow: 0 2px 8px rgba(0,0,0,0.6);\
  letter-spacing: 0.5px;\
}\
\
.ext-tile-img-wrap {\
  position: relative;\
  width: 100%;\
  aspect-ratio: 16 / 10;\
  overflow: hidden;\
  border-radius: 10px;\
  margin-bottom: 0.5em;\
  box-shadow: 0 4px 16px rgba(0,0,0,0.35);\
}\
.ext-tile-img {\
  width: 100%; height: 100%;\
  object-fit: cover;\
  display: block;\
}\
\
.ext-tile-status {\
  position: absolute;\
  top: 6px; left: 6px;\
  z-index: 2;\
  padding: 2px 14px;\
  border-radius: 20px;\
  font-size: clamp(10px, 0.9vw, 13px);\
  font-weight: 600;\
  box-shadow: 0 2px 6px rgba(0,0,0,0.3);\
  color: #fff;\
}\
\
.ext-tile-badge {\
  position: absolute;\
  top: -6px; right: 0;\
  padding: 2px 10px;\
  border-radius: 6px;\
  font-size: clamp(8px, 0.7vw, 11px);\
  font-weight: 700;\
  text-transform: uppercase;\
  box-shadow: 0 2px 6px rgba(0,0,0,0.4);\
  z-index: 3;\
  color: #fff;\
}\
\
.ext-tile-btn {\
  display: block;\
  width: 100%;\
  padding: clamp(6px, 0.8vw, 14px) 0;\
  border: none;\
  border-radius: 30px;\
  background: linear-gradient(135deg, #5bc4ac 0%, #4aad96 100%);\
  color: #fff;\
  font-size: clamp(12px, 1.2vw, 17px);\
  font-weight: 700;\
  letter-spacing: 0.5px;\
  box-shadow: 0 4px 15px rgba(91,196,172,0.35);\
  pointer-events: none;\
}\
\
/* Bare external-tiles har klikkbar knapp */\
.ext-tile[data-type="external"] .ext-tile-btn {\
  pointer-events: auto;\
  cursor: pointer;\
  transition: background 0.15s, transform 0.1s;\
}\
.ext-tile[data-type="external"] .ext-tile-btn:hover {\
  background: linear-gradient(135deg, #6bd4bc 0%, #5cc8ae 100%);\
  transform: translateY(-1px);\
}\
.ext-tile[data-type="external"] .ext-tile-btn:active { transform: translateY(1px); }\
.ext-tile-btn:disabled {\
  background: #666;\
  box-shadow: none;\
}\
\
/* ═══ DEBUG PANEL ═══ */\
#dbg-panel {\
  position: fixed;\
  top: 4px; right: 4px;\
  z-index: 9999;\
  background: rgba(0,0,0,0.88);\
  color: #0f0;\
  font-family: "Consolas", "Monaco", monospace;\
  font-size: 11px;\
  padding: 8px 10px;\
  border-radius: 8px;\
  max-width: 420px;\
  pointer-events: auto;\
  border: 1px solid #0f0;\
  box-shadow: 0 0 20px rgba(0,255,0,0.15);\
}\
#dbg-panel h3 {\
  margin: 0 0 6px; font-size: 13px; color: #0f0;\
  border-bottom: 1px solid #0f04;\
  padding-bottom: 4px;\
}\
#dbg-panel button {\
  margin: 2px;\
  padding: 4px 10px;\
  font-size: 11px;\
  font-family: inherit;\
  cursor: pointer;\
  border: 1px solid #0f0;\
  border-radius: 4px;\
  background: #111;\
  color: #0f0;\
  pointer-events: auto;\
}\
#dbg-panel button:hover { background: #0f0; color: #000; }\
#dbg-panel button.active { background: #0f0; color: #000; font-weight: bold; }\
#dbg-info {\
  margin-top: 6px;\
  padding: 4px;\
  background: rgba(0,0,0,0.4);\
  border-radius: 4px;\
  line-height: 1.5;\
  white-space: pre-wrap;\
  word-break: break-all;\
}\
#dbg-log {\
  margin-top: 6px;\
  max-height: 150px;\
  overflow-y: auto;\
  padding: 4px;\
  background: rgba(0,0,0,0.4);\
  border-radius: 4px;\
  line-height: 1.4;\
  white-space: pre-wrap;\
  word-break: break-all;\
  font-size: 10px;\
  color: #8f8;\
}\
#dbg-crosshair {\
  position: fixed;\
  z-index: 9998;\
  pointer-events: none;\
  display: none;\
}\
#dbg-crosshair .h {\
  position: fixed; left: 0; right: 0; height: 1px; background: red;\
}\
#dbg-crosshair .v {\
  position: fixed; top: 0; bottom: 0; width: 1px; background: red;\
}\
#dbg-coord-label {\
  position: fixed;\
  z-index: 9998;\
  pointer-events: none;\
  font-family: monospace;\
  font-size: 12px;\
  color: #ff0;\
  background: rgba(0,0,0,0.7);\
  padding: 2px 6px;\
  border-radius: 3px;\
  display: none;\
}\
/* DEBUG: tile fargeoverlegg */\
.ext-cell.dbg-borders {\
  outline-width: 3px;\
  outline-style: dashed;\
  outline-offset: -2px;\
  position: relative;\
}\
.ext-cell .dbg-label {\
  display: none;\
  position: absolute;\
  bottom: 2px; left: 2px;\
  font-family: monospace;\
  font-size: 9px;\
  background: rgba(0,0,0,0.8);\
  color: #fff;\
  padding: 1px 4px;\
  border-radius: 2px;\
  z-index: 5;\
  pointer-events: none;\
}\
.ext-cell.dbg-borders .dbg-label { display: block; }\
';
  document.head.appendChild(css);

  // ── Bygg grid ─────────────────────────────────────────────────
  var wrap = document.createElement('div');
  wrap.id = 'ext-games-wrap';

  GAMES.forEach(function (game, idx) {
    var isOpen = game.status === 'Åpen';
    var statusBg = isOpen ? game.statusColor : (game.closedColor || '#e74c3c');
    var btnLabel = game.btnText || (isOpen ? 'Spill nå' : game.status);

    var cell = document.createElement('div');
    cell.className = 'ext-cell';
    cell.setAttribute('data-dbg-index', idx);

    var tile = document.createElement('div');
    tile.className = 'ext-tile';
    tile.setAttribute('data-game-id', game.id);
    tile.setAttribute('data-type', game.type);

    var h = '';
    if (game.badge) {
      h += '<div class="ext-tile-badge" style="background:' + (game.badgeColor || '#ff4444') + '">' + game.badge + '</div>';
    }
    h += '<div class="ext-tile-name">' + game.name + '</div>';
    h += '<div class="ext-tile-img-wrap">';
    h += '  <div class="ext-tile-status" style="background:' + statusBg + '">' + game.status + '</div>';
    h += '  <img class="ext-tile-img" src="' + game.image + '" alt="' + game.name + '" />';
    h += '</div>';
    h += '<button class="ext-tile-btn"' + (isOpen ? '' : ' disabled') + '>' + btnLabel + '</button>';
    // Debug-etikett med posisjon (oppdateres dynamisk)
    h += '<div class="dbg-label" id="dbg-lbl-' + idx + '" style="color:' + TILE_BORDER_COLORS[idx] + '">…</div>';
    tile.innerHTML = h;

    // Bare external-spill (Candy) håndteres i JS
    if (game.type === 'external' && isOpen) {
      tile.addEventListener('click', function () {
        dlog('CLICK → external tile: ' + game.id + ' → openGameInIframe(' + game.url + ')');
        if (typeof openGameInIframe === 'function') openGameInIframe(game.url);
        else window.open(game.url, '_blank');
      });
    }

    cell.appendChild(tile);
    wrap.appendChild(cell);
  });

  document.body.appendChild(wrap);

  // ══════════════════════════════════════════════════════════════
  // ██  DEBUG PANEL  ██
  // ══════════════════════════════════════════════════════════════
  if (DEBUG) {
    dlog('Debug modus AKTIVERT');

    // ── Crosshair elementer ──
    var crosshair = document.createElement('div');
    crosshair.id = 'dbg-crosshair';
    crosshair.innerHTML = '<div class="h"></div><div class="v"></div>';
    document.body.appendChild(crosshair);

    var coordLabel = document.createElement('div');
    coordLabel.id = 'dbg-coord-label';
    document.body.appendChild(coordLabel);

    // ── Panel ──
    var panel = document.createElement('div');
    panel.id = 'dbg-panel';
    panel.innerHTML = '\
      <h3>🔧 EXT-GAMES DEBUG</h3>\
      <div>\
        <button id="dbg-btn-transparent">Gjennomsiktig BG</button>\
        <button id="dbg-btn-hide">Skjul overlay</button>\
        <button id="dbg-btn-borders">Vis cellegrenser</button>\
        <button id="dbg-btn-crosshair">Crosshair</button>\
        <button id="dbg-btn-snapshot">📸 Snapshot</button>\
      </div>\
      <div id="dbg-info">Laster…</div>\
      <div id="dbg-log"></div>\
    ';
    document.body.appendChild(panel);

    // ── Knappstatus ──
    var dbgState = {
      transparent: false,
      hidden: false,
      borders: false,
      crosshair: false
    };

    function toggleBtn(id, key) {
      dbgState[key] = !dbgState[key];
      var btn = document.getElementById(id);
      if (btn) btn.classList.toggle('active', dbgState[key]);
    }

    // Gjennomsiktig bakgrunn
    document.getElementById('dbg-btn-transparent').addEventListener('click', function () {
      toggleBtn('dbg-btn-transparent', 'transparent');
      wrap.classList.toggle('dbg-transparent', dbgState.transparent);
      dlog('Bakgrunn: ' + (dbgState.transparent ? 'GJENNOMSIKTIG (ser Unity under)' : 'SOLID (skjuler Unity)'));
    });

    // Skjul overlay helt
    document.getElementById('dbg-btn-hide').addEventListener('click', function () {
      toggleBtn('dbg-btn-hide', 'hidden');
      wrap.classList.toggle('dbg-hidden', dbgState.hidden);
      dlog('Overlay: ' + (dbgState.hidden ? 'SKJULT (kun Unity synlig)' : 'SYNLIG'));
    });

    // Vis cellegrenser
    document.getElementById('dbg-btn-borders').addEventListener('click', function () {
      toggleBtn('dbg-btn-borders', 'borders');
      var cells = wrap.querySelectorAll('.ext-cell');
      cells.forEach(function (cell, i) {
        cell.classList.toggle('dbg-borders', dbgState.borders);
        if (dbgState.borders) {
          cell.style.outlineColor = TILE_BORDER_COLORS[i] || '#fff';
          cell.style.background = TILE_COLORS[i] || 'rgba(255,255,255,0.1)';
        } else {
          cell.style.outlineColor = '';
          cell.style.background = '';
        }
      });
      dlog('Cellegrenser: ' + (dbgState.borders ? 'PÅ' : 'AV'));
      if (dbgState.borders) updateCellLabels();
    });

    // Crosshair
    document.getElementById('dbg-btn-crosshair').addEventListener('click', function () {
      toggleBtn('dbg-btn-crosshair', 'crosshair');
      crosshair.style.display = dbgState.crosshair ? 'block' : 'none';
      coordLabel.style.display = dbgState.crosshair ? 'block' : 'none';
      dlog('Crosshair: ' + (dbgState.crosshair ? 'PÅ' : 'AV'));
    });

    // Snapshot — dump alle posisjoner til konsoll
    document.getElementById('dbg-btn-snapshot').addEventListener('click', function () {
      dlog('=== SNAPSHOT START ===');
      dumpPositions();
      dlog('=== SNAPSHOT END (se console for detaljer) ===');
    });

    // ── Crosshair: følg musen ──
    document.addEventListener('mousemove', function (e) {
      if (!dbgState.crosshair) return;
      crosshair.querySelector('.h').style.top = e.clientY + 'px';
      crosshair.querySelector('.v').style.left = e.clientX + 'px';
      coordLabel.style.left = (e.clientX + 12) + 'px';
      coordLabel.style.top = (e.clientY + 12) + 'px';
      coordLabel.textContent = 'X:' + e.clientX + ' Y:' + e.clientY +
        ' (' + (e.clientX / window.innerWidth * 100).toFixed(1) + '%, ' +
        (e.clientY / window.innerHeight * 100).toFixed(1) + '%)';
    });

    // ── Klikk-logger: registrer ALLE klikk ──
    document.addEventListener('click', function (e) {
      var target = e.target;
      // Ikke logg klikk på debug-panel
      if (target.closest && target.closest('#dbg-panel')) return;

      var tagInfo = target.tagName;
      if (target.id) tagInfo += '#' + target.id;
      if (target.className && typeof target.className === 'string') tagInfo += '.' + target.className.split(' ')[0];

      var gameId = '';
      var tileEl = target.closest ? target.closest('.ext-tile') : null;
      if (tileEl) gameId = ' game=' + tileEl.getAttribute('data-game-id');

      var onCanvas = target.id === 'unity-canvas' || target.tagName === 'CANVAS';
      var passedThrough = !target.closest || !target.closest('#ext-games-wrap');

      dlog('CLICK ' + e.clientX + ',' + e.clientY +
        ' → ' + tagInfo + gameId +
        (onCanvas ? ' [UNITY CANVAS!]' : '') +
        (passedThrough ? ' [PASSTHROUGH ✓]' : ' [CAUGHT BY HTML]') +
        ' isTrusted=' + e.isTrusted,
        onCanvas ? 'OK' : 'INFO'
      );
    }, true); // capture fase — fanger ALT

    // ── Celle-etiketter: vis posisjon per tile ──
    function updateCellLabels() {
      var cells = wrap.querySelectorAll('.ext-cell');
      cells.forEach(function (cell, i) {
        var lbl = document.getElementById('dbg-lbl-' + i);
        if (!lbl) return;
        var r = cell.getBoundingClientRect();
        lbl.textContent = GAMES[i].name + '\n' +
          'L:' + Math.round(r.left) + ' T:' + Math.round(r.top) +
          ' W:' + Math.round(r.width) + ' H:' + Math.round(r.height) +
          '\n→ center: (' + Math.round(r.left + r.width / 2) + ', ' + Math.round(r.top + r.height / 2) + ')';
      });
    }

    // ── Info-panel: vis status hvert sekund ──
    function updateInfo() {
      var canvas = document.getElementById('unity-canvas');
      var wrapEl = document.getElementById('ext-games-wrap');
      var info = '';

      // Viewport
      info += '🖥 Viewport: ' + window.innerWidth + 'x' + window.innerHeight + '\n';

      // Canvas
      if (canvas) {
        var cr = canvas.getBoundingClientRect();
        info += '🎮 Unity canvas: ' +
          Math.round(cr.left) + ',' + Math.round(cr.top) +
          ' → ' + Math.round(cr.right) + ',' + Math.round(cr.bottom) +
          ' (' + Math.round(cr.width) + 'x' + Math.round(cr.height) + ')\n';
        var cs = window.getComputedStyle(canvas);
        info += '   z-index: ' + cs.zIndex + ', position: ' + cs.position + '\n';
      } else {
        info += '🎮 Unity canvas: IKKE FUNNET!\n';
      }

      // Container
      var container = document.getElementById('unity-container');
      if (container) {
        var ccr = container.getBoundingClientRect();
        info += '📦 Unity container: ' +
          Math.round(ccr.left) + ',' + Math.round(ccr.top) +
          ' → ' + Math.round(ccr.right) + ',' + Math.round(ccr.bottom) + '\n';
      }

      // Overlay
      if (wrapEl) {
        var wr = wrapEl.getBoundingClientRect();
        info += '🔲 HTML overlay: ' +
          Math.round(wr.left) + ',' + Math.round(wr.top) +
          ' → ' + Math.round(wr.right) + ',' + Math.round(wr.bottom) +
          ' (' + Math.round(wr.width) + 'x' + Math.round(wr.height) + ')\n';
        var ws = window.getComputedStyle(wrapEl);
        info += '   z-index: ' + ws.zIndex + ', top: ' + ws.top + ', display: ' + ws.display + '\n';
        info += '   pointer-events: ' + ws.pointerEvents + '\n';
        info += '   bg: ' + (ws.background.substring(0, 60)) + '…\n';
      }

      // Tile-posisjoner
      info += '\n── Tile-posisjoner (HTML) ──\n';
      var cells = wrap.querySelectorAll('.ext-cell');
      cells.forEach(function (cell, i) {
        var r = cell.getBoundingClientRect();
        var pe = window.getComputedStyle(cell.querySelector('.ext-tile') || cell).pointerEvents;
        info += (TILE_BORDER_COLORS[i] ? '■' : '□') + ' ' +
          GAMES[i].id.padEnd(15) +
          'L:' + String(Math.round(r.left)).padStart(4) +
          ' T:' + String(Math.round(r.top)).padStart(4) +
          ' W:' + String(Math.round(r.width)).padStart(4) +
          ' H:' + String(Math.round(r.height)).padStart(4) +
          ' pe:' + pe + '\n';
      });

      // Auth/login status
      info += '\n── Status ──\n';
      info += 'body.player-authenticated: ' + document.body.classList.contains('player-authenticated') + '\n';
      info += 'overlay display: ' + (wrapEl ? window.getComputedStyle(wrapEl).display : 'N/A') + '\n';

      var el = document.getElementById('dbg-info');
      if (el) el.textContent = info;

      if (dbgState.borders) updateCellLabels();
    }

    // ── Dump full posisjon-info til console.table ──
    function dumpPositions() {
      var canvas = document.getElementById('unity-canvas');
      var canvasRect = canvas ? canvas.getBoundingClientRect() : null;

      console.group('🔧 EXT-GAMES DEBUG SNAPSHOT');

      console.log('Viewport:', window.innerWidth, 'x', window.innerHeight);
      console.log('Canvas:', canvasRect);
      console.log('Overlay:', wrap.getBoundingClientRect());

      var table = [];
      var cells = wrap.querySelectorAll('.ext-cell');
      cells.forEach(function (cell, i) {
        var r = cell.getBoundingClientRect();
        var tile = cell.querySelector('.ext-tile');
        var tr = tile ? tile.getBoundingClientRect() : null;
        table.push({
          '#': i,
          game: GAMES[i].id,
          type: GAMES[i].type,
          'cell.left': Math.round(r.left),
          'cell.top': Math.round(r.top),
          'cell.width': Math.round(r.width),
          'cell.height': Math.round(r.height),
          'cell.centerX': Math.round(r.left + r.width / 2),
          'cell.centerY': Math.round(r.top + r.height / 2),
          'tile.left': tr ? Math.round(tr.left) : '-',
          'tile.top': tr ? Math.round(tr.top) : '-',
          'tile.width': tr ? Math.round(tr.width) : '-',
          'tile.height': tr ? Math.round(tr.height) : '-',
          pointerEvents: tile ? window.getComputedStyle(tile).pointerEvents : '-',
          // Canvas-relative koord (hvor klikket treffer Unity)
          'canvasRelX': canvasRect ? Math.round(r.left + r.width / 2 - canvasRect.left) : '-',
          'canvasRelY': canvasRect ? Math.round(r.top + r.height / 2 - canvasRect.top) : '-'
        });
      });
      console.table(table);

      // z-index stack
      console.log('z-index stack:');
      ['unity-canvas', 'unity-container', 'ext-games-wrap', 'game-overlay'].forEach(function (id) {
        var el = document.getElementById(id);
        if (el) {
          var s = window.getComputedStyle(el);
          console.log('  #' + id + ': z-index=' + s.zIndex + ', position=' + s.position +
            ', display=' + s.display + ', pointer-events=' + s.pointerEvents);
        }
      });

      console.groupEnd();
    }

    // Start info-oppdatering
    setInterval(updateInfo, 1000);
    setTimeout(function () {
      updateInfo();
      dlog('Initial info oppdatert');
    }, 500);

    dlog('Debug panel klart. Bruk knappene øverst til høyre.');
    dlog('HINT: Klikk "Gjennomsiktig BG" for å se Unity under HTML-overlay');
    dlog('HINT: Klikk "Vis cellegrenser" for å se nøyaktig hvor HTML-tiles er');
    dlog('HINT: Klikk "Skjul overlay" for å se ren Unity-visning');
    dlog('HINT: Klikk "Crosshair" for pixel-nøyaktig posisjonering');
  }
})();

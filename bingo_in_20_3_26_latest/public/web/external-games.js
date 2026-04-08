/**
 * External Games Overlay — dynamisk posisjonert i Unity-lobbyens 3x2 grid.
 *
 * Leser Unity-canvasens posisjon/størrelse og beregner nøyaktig
 * kolonne 3, rad 2. Skalerer med canvasen ved resize.
 */
(function () {
  'use strict';

  var EXTERNAL_GAMES = [
    {
      id: 'candy-mania',
      name: 'Candy Mania',
      url: '/candy/',
      status: 'Åpen',
      statusColor: '#5bbf72',
      closedColor: '#e74c3c',
      badge: 'NYTT!',
      badgeColor: '#ff4444',
      image: '/web/assets/games/candy.png'
    }
  ];

  // Unity grid-koordinater (prosent av canvas-størrelse).
  // Estimert fra de 5 eksisterende tilene:
  //   Rad 1: Papir bingo(28%) | Lynbingo(52%)    | BingoBonanza(78%)
  //   Rad 2: Turbomania(28%)  | SpinnGo(52%)     | Candy Mania(78%)
  var GRID = {
    centerX: 0.78,    // kolonne 3 horisontalt senter
    topY:    0.585,   // rad 2 topp (der tittel starter)
    tileW:   0.195    // tile-bredde som andel av canvas
  };

  var style = document.createElement('style');
  style.textContent = [
    '#ext-games-wrap {',
    '  position: fixed;',
    '  z-index: 100;',
    '  pointer-events: none;',
    '  display: flex;',
    '  flex-direction: column;',
    '  align-items: center;',
    '  justify-content: flex-start;',
    '}',
    '.ext-tile {',
    '  pointer-events: auto;',
    '  width: 100%;',
    '  text-align: center;',
    '  color: #fff;',
    '  cursor: pointer;',
    '  position: relative;',
    '  font-family: "Segoe UI", Arial, sans-serif;',
    '}',
    '.ext-tile-name {',
    '  font-weight: 700;',
    '  margin-bottom: 0.3em;',
    '  text-shadow: 0 2px 8px rgba(0,0,0,0.6);',
    '  letter-spacing: 0.5px;',
    '}',
    '.ext-tile-img-wrap {',
    '  position: relative;',
    '  width: 100%;',
    '  aspect-ratio: 16 / 10;',
    '  overflow: hidden;',
    '  border-radius: 8px;',
    '  margin: 0 auto 0.4em;',
    '  box-shadow: 0 4px 16px rgba(0,0,0,0.3);',
    '}',
    '.ext-tile-img {',
    '  width: 100%;',
    '  height: 100%;',
    '  object-fit: cover;',
    '  display: block;',
    '}',
    '.ext-tile-status {',
    '  position: absolute;',
    '  top: 6px; left: 6px;',
    '  z-index: 2;',
    '  padding: 2px 12px;',
    '  border-radius: 20px;',
    '  font-weight: 600;',
    '  box-shadow: 0 2px 6px rgba(0,0,0,0.3);',
    '}',
    '.ext-tile-badge {',
    '  position: absolute;',
    '  top: -6px; right: 0;',
    '  padding: 2px 8px;',
    '  border-radius: 6px;',
    '  font-weight: 700;',
    '  text-transform: uppercase;',
    '  box-shadow: 0 2px 6px rgba(0,0,0,0.4);',
    '  z-index: 3;',
    '}',
    '.ext-tile-btn {',
    '  display: block;',
    '  width: 100%;',
    '  border: none;',
    '  border-radius: 30px;',
    '  background: linear-gradient(135deg, #5bc4ac 0%, #4aad96 100%);',
    '  color: #fff;',
    '  font-weight: 700;',
    '  cursor: pointer;',
    '  letter-spacing: 0.5px;',
    '  transition: background 0.15s, transform 0.1s;',
    '  box-shadow: 0 4px 15px rgba(91,196,172,0.35);',
    '}',
    '.ext-tile-btn:hover {',
    '  background: linear-gradient(135deg, #6bd4bc 0%, #5cc8ae 100%);',
    '  transform: translateY(-1px);',
    '}',
    '.ext-tile-btn:active { transform: translateY(1px); }',
    '.ext-tile-btn:disabled { background:#555; cursor:not-allowed; box-shadow:none; }'
  ].join('\n');
  document.head.appendChild(style);

  // ── Bygg tile-HTML ────────────────────────────────────────────
  var wrap = document.createElement('div');
  wrap.id = 'ext-games-wrap';

  EXTERNAL_GAMES.forEach(function (game) {
    var isOpen = game.status === 'Åpen';
    var tile = document.createElement('div');
    tile.className = 'ext-tile';
    tile.setAttribute('data-game-id', game.id);
    var statusBg = isOpen ? game.statusColor : (game.closedColor || '#e74c3c');

    var html = '';
    if (game.badge) html += '<div class="ext-tile-badge" style="background:' + game.badgeColor + '">' + game.badge + '</div>';
    html += '<div class="ext-tile-name">' + game.name + '</div>';
    if (game.image) {
      html += '<div class="ext-tile-img-wrap">';
      html += '<div class="ext-tile-status" style="background:' + statusBg + '">' + game.status + '</div>';
      html += '<img class="ext-tile-img" src="' + game.image + '" alt="' + game.name + '" />';
      html += '</div>';
    }
    html += '<button class="ext-tile-btn"' + (isOpen ? '' : ' disabled') + '>' + (isOpen ? 'Spill nå' : game.status) + '</button>';
    tile.innerHTML = html;

    if (isOpen) {
      tile.addEventListener('click', function () {
        if (typeof openGameInIframe === 'function') openGameInIframe(game.url);
        else window.open(game.url, '_blank');
      });
    }
    wrap.appendChild(tile);
  });

  document.body.appendChild(wrap);

  // ── Dynamisk posisjonering — leser Unity-canvas og beregner ───
  function reposition() {
    var canvas = document.getElementById('unity-canvas');
    if (!canvas) return;
    var r = canvas.getBoundingClientRect();
    if (r.width === 0) return;

    var tilePxW = r.width * GRID.tileW;
    var centerX = r.left + r.width * GRID.centerX;
    var topY    = r.top  + r.height * GRID.topY;

    wrap.style.left   = (centerX - tilePxW / 2) + 'px';
    wrap.style.top    = topY + 'px';
    wrap.style.width  = tilePxW + 'px';

    // Skaler fonter og padding proporsjonalt med tile-bredden
    var s = tilePxW / 280;
    var els = {
      '.ext-tile-name':   { fontSize: Math.max(12, 22 * s) },
      '.ext-tile-status': { fontSize: Math.max(9, 13 * s) },
      '.ext-tile-badge':  { fontSize: Math.max(8, 11 * s) },
      '.ext-tile-btn':    { fontSize: Math.max(11, 17 * s), padding: Math.max(6, 12 * s) + 'px 0' }
    };
    for (var sel in els) {
      var nodes = wrap.querySelectorAll(sel);
      for (var i = 0; i < nodes.length; i++) {
        for (var prop in els[sel]) {
          nodes[i].style[prop] = typeof els[sel][prop] === 'number' ? els[sel][prop] + 'px' : els[sel][prop];
        }
      }
    }
  }

  // Kjør ved resize og når canvas er klar
  window.addEventListener('resize', reposition);
  var poll = setInterval(function () {
    var c = document.getElementById('unity-canvas');
    if (c && c.getBoundingClientRect().width > 0) { clearInterval(poll); reposition(); }
  }, 200);
  if (typeof ResizeObserver !== 'undefined') {
    var roWait = setInterval(function () {
      var c = document.getElementById('unity-canvas');
      if (c) { clearInterval(roWait); new ResizeObserver(reposition).observe(c); }
    }, 200);
  }
})();

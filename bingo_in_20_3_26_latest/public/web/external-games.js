/**
 * External Games Overlay — config-drevet integrasjon av eksterne spill i lobbyen.
 *
 * Bruk:
 *   1. Inkluder denne filen i lobby-HTML
 *   2. Definer spill i EXTERNAL_GAMES-arrayen
 *   3. Kall openGameInIframe(url) for å åpne et spill
 *
 * Gjenbrukbar på tvers av systemer — ingen Unity-avhengighet.
 */
(function () {
  'use strict';

  // ── Konfigurasjon ─────────────────────────────────────────────
  // Legg til flere spill her etter hvert som de integreres.
  var EXTERNAL_GAMES = [
    {
      id: 'candy-mania',
      name: 'Candy Mania',
      url: '/candy/',
      status: 'Åpen',
      statusColor: '#5bbf72',
      badge: 'Nytt!',
      badgeColor: '#ff6b6b'
    }
  ];

  // ── CSS ──────────────────────────────────────────────────
  var style = document.createElement('style');
  style.textContent = [
    '#ext-games-wrap {',
    '  position: fixed;',
    '  z-index: 100;',
    '  pointer-events: none;',
    '  bottom: 0; right: 0;',
    '  width: 33.3%;',
    '  height: 50%;',
    '  display: flex;',
    '  align-items: center;',
    '  justify-content: center;',
    '}',
    '.ext-tile {',
    '  pointer-events: auto;',
    '  width: 260px;',
    '  background: linear-gradient(145deg, rgba(40,15,60,0.92) 0%, rgba(25,8,45,0.95) 100%);',
    '  border-radius: 18px;',
    '  text-align: center;',
    '  padding: 18px 16px 14px;',
    '  color: #fff;',
    '  cursor: pointer;',
    '  box-shadow: 0 6px 30px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.08);',
    '  border: 1px solid rgba(255,255,255,0.06);',
    '  transition: transform 0.18s ease, box-shadow 0.18s ease;',
    '  position: relative;',
    '  font-family: "Segoe UI", Arial, sans-serif;',
    '}',
    '.ext-tile:hover {',
    '  transform: translateY(-4px) scale(1.02);',
    '  box-shadow: 0 10px 40px rgba(0,0,0,0.65), inset 0 1px 0 rgba(255,255,255,0.12);',
    '}',
    '.ext-tile:active {',
    '  transform: translateY(0) scale(0.98);',
    '}',
    '.ext-tile-badge {',
    '  position: absolute;',
    '  top: -10px;',
    '  right: -10px;',
    '  padding: 4px 12px;',
    '  border-radius: 20px;',
    '  font-size: 11px;',
    '  font-weight: 700;',
    '  letter-spacing: 0.5px;',
    '  text-transform: uppercase;',
    '  box-shadow: 0 2px 8px rgba(0,0,0,0.3);',
    '}',
    '.ext-tile-name {',
    '  font-size: 20px;',
    '  font-weight: 700;',
    '  margin-bottom: 6px;',
    '  text-shadow: 0 2px 4px rgba(0,0,0,0.3);',
    '}',
    '.ext-tile-status {',
    '  display: inline-block;',
    '  padding: 3px 16px;',
    '  border-radius: 20px;',
    '  font-size: 12px;',
    '  font-weight: 600;',
    '  margin-bottom: 12px;',
    '}',
    '.ext-tile-icon {',
    '  width: 80px;',
    '  height: 80px;',
    '  margin: 4px auto 14px;',
    '  position: relative;',
    '}',
    '.ext-tile-icon svg {',
    '  width: 100%;',
    '  height: 100%;',
    '  animation: ext-spin 3s linear infinite;',
    '}',
    '@keyframes ext-spin {',
    '  from { transform: rotate(0deg); }',
    '  to { transform: rotate(360deg); }',
    '}',
    '.ext-tile-btn {',
    '  display: block;',
    '  width: 100%;',
    '  padding: 12px 0;',
    '  border: none;',
    '  border-radius: 12px;',
    '  background: linear-gradient(135deg, #5bc4ac 0%, #4db89e 100%);',
    '  color: #fff;',
    '  font-size: 16px;',
    '  font-weight: 700;',
    '  cursor: pointer;',
    '  letter-spacing: 0.5px;',
    '  transition: background 0.15s;',
    '  box-shadow: 0 3px 12px rgba(91, 196, 172, 0.3);',
    '}',
    '.ext-tile-btn:hover {',
    '  background: linear-gradient(135deg, #6bd4bc 0%, #5cc8ae 100%);',
    '}',
    '.ext-tile-btn:disabled {',
    '  background: #666;',
    '  cursor: not-allowed;',
    '  box-shadow: none;',
    '}',
    '@media (max-width: 1100px) {',
    '  #ext-games-wrap { width: 40%; }',
    '  .ext-tile { width: 220px; }',
    '}',
    '@media (max-width: 768px) {',
    '  #ext-games-wrap { width: 50%; height: 40%; }',
    '  .ext-tile { width: 180px; padding: 12px 10px 10px; }',
    '  .ext-tile-name { font-size: 16px; }',
    '  .ext-tile-icon { width: 60px; height: 60px; }',
    '}'
  ].join('\n');
  document.head.appendChild(style);

  // ── Spinner SVG (matcher Unity-lobbyen sine ikoner) ──────────
  var spinnerSVG = [
    '<svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">',
    '  <g stroke="white" stroke-width="6" stroke-linecap="round" opacity="0.85">',
    '    <line x1="50" y1="8"  x2="50" y2="28"/>',
    '    <line x1="50" y1="72" x2="50" y2="92"/>',
    '    <line x1="8"  y1="50" x2="28" y2="50"/>',
    '    <line x1="72" y1="50" x2="92" y2="50"/>',
    '    <line x1="20" y1="20" x2="35" y2="35"/>',
    '    <line x1="65" y1="65" x2="80" y2="80"/>',
    '    <line x1="80" y1="20" x2="65" y2="35"/>',
    '    <line x1="35" y1="65" x2="20" y2="80"/>',
    '  </g>',
    '</svg>'
  ].join('\n');

  // ── Render ───────────────────────────────────────────────
  var wrap = document.createElement('div');
  wrap.id = 'ext-games-wrap';

  EXTERNAL_GAMES.forEach(function (game) {
    var isOpen = game.status === 'Åpen';
    var tile = document.createElement('div');
    tile.className = 'ext-tile';
    tile.setAttribute('data-game-id', game.id);

    var html = '';
    if (game.badge) {
      html += '<div class="ext-tile-badge" style="background:' + game.badgeColor + '">' + game.badge + '</div>';
    }
    html += '<div class="ext-tile-name">' + game.name + '</div>';
    html += '<div class="ext-tile-status" style="background:' + game.statusColor + '">' + game.status + '</div>';
    html += '<div class="ext-tile-icon">' + spinnerSVG + '</div>';
    html += '<button class="ext-tile-btn"' + (isOpen ? '' : ' disabled') + '>' + (isOpen ? 'Spill nå' : game.status) + '</button>';
    tile.innerHTML = html;

    if (isOpen) {
      tile.addEventListener('click', function () {
        if (typeof openGameInIframe === 'function') {
          openGameInIframe(game.url);
        } else {
          window.open(game.url, '_blank');
        }
      });
    }
    wrap.appendChild(tile);
  });

  document.body.appendChild(wrap);
})();

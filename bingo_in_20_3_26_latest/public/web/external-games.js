/**
 * Full HTML Game Grid — erstatter Unity-canvasens spillkort med
 * identisk-designede HTML-tiles i et 3x2 CSS Grid.
 *
 * Unity-header (logo, wallet, nav) forblir synlig over gridet.
 * Unity-spill åpnes ved syntetisk klikk på canvasen.
 * Candy Mania åpnes via iframe.
 */
(function () {
  'use strict';

  // ── Spillkatalog ──────────────────────────────────────────────
  // type: 'unity'    → klikk sendes til Unity-canvas
  // type: 'external' → openGameInIframe()
  var GAMES = [
    {
      id: 'papir-bingo', name: 'Papir bingo',
      image: '/web/assets/games/papirbingo.png',
      status: 'Stengt', statusColor: '#5bbf72', closedColor: '#e74c3c',
      type: 'unity', canvasXY: [0.28, 0.42]
    },
    {
      id: 'lynbingo', name: 'Lynbingo',
      image: '/web/assets/games/bingo_1.png',
      status: 'Åpen', statusColor: '#5bbf72',
      btnText: 'Spill nå',
      type: 'unity', canvasXY: [0.52, 0.42]
    },
    {
      id: 'bingo-bonanza', name: 'BingoBonanza',
      image: '/web/assets/games/bingo_3.png',
      status: 'Åpen', statusColor: '#5bbf72',
      btnText: 'Spill nå',
      type: 'unity', canvasXY: [0.78, 0.42]
    },
    {
      id: 'turbomania', name: 'Turbomania',
      image: '/web/assets/games/bingo_4.png',
      status: 'Åpen', statusColor: '#5bbf72',
      btnText: 'Spill nå',
      type: 'unity', canvasXY: [0.28, 0.85]
    },
    {
      id: 'spinngo', name: 'SpinnGo',
      image: '/web/assets/games/gold-digger.png',
      status: 'Åpen', statusColor: '#5bbf72',
      btnText: 'Spill nå',
      type: 'unity', canvasXY: [0.52, 0.85]
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
.ext-cell {\
  display: flex;\
  align-items: center;\
  justify-content: center;\
  pointer-events: none;\
}\
\
.ext-tile {\
  pointer-events: auto;\
  width: 80%;\
  max-width: 300px;\
  text-align: center;\
  color: #fff;\
  cursor: pointer;\
  position: relative;\
  font-family: "Segoe UI", Arial, sans-serif;\
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
  cursor: pointer;\
  letter-spacing: 0.5px;\
  transition: background 0.15s, transform 0.1s;\
  box-shadow: 0 4px 15px rgba(91,196,172,0.35);\
}\
.ext-tile-btn:hover {\
  background: linear-gradient(135deg, #6bd4bc 0%, #5cc8ae 100%);\
  transform: translateY(-1px);\
}\
.ext-tile-btn:active { transform: translateY(1px); }\
.ext-tile-btn:disabled {\
  background: #666;\
  cursor: not-allowed;\
  box-shadow: none;\
}\
';
  document.head.appendChild(css);

  // ── Syntetisk klikk på Unity-canvas ───────────────────────────
  function clickUnityCanvas(normX, normY) {
    var canvas = document.getElementById('unity-canvas');
    if (!canvas) return;
    var r = canvas.getBoundingClientRect();
    var cx = r.left + r.width * normX;
    var cy = r.top + r.height * normY;
    var opts = { bubbles: true, cancelable: true, clientX: cx, clientY: cy };

    // Fjern pointer-events midlertidig slik at canvas mottar klikket
    wrap.style.pointerEvents = 'none';
    var tiles = wrap.querySelectorAll('.ext-tile');
    for (var i = 0; i < tiles.length; i++) tiles[i].style.pointerEvents = 'none';

    canvas.dispatchEvent(new PointerEvent('pointerdown', opts));
    setTimeout(function () {
      canvas.dispatchEvent(new PointerEvent('pointerup', opts));
      canvas.dispatchEvent(new MouseEvent('click', opts));
      setTimeout(function () {
        wrap.style.pointerEvents = '';
        for (var j = 0; j < tiles.length; j++) tiles[j].style.pointerEvents = '';
      }, 100);
    }, 50);
  }

  // ── Bygg grid ─────────────────────────────────────────────────
  var wrap = document.createElement('div');
  wrap.id = 'ext-games-wrap';

  GAMES.forEach(function (game) {
    var isOpen = game.status === 'Åpen';
    var statusBg = isOpen ? game.statusColor : (game.closedColor || '#e74c3c');
    var btnLabel = game.btnText || (isOpen ? 'Spill nå' : game.status);

    var cell = document.createElement('div');
    cell.className = 'ext-cell';

    var tile = document.createElement('div');
    tile.className = 'ext-tile';
    tile.setAttribute('data-game-id', game.id);

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
    tile.innerHTML = h;

    if (isOpen) {
      (function (g) {
        tile.addEventListener('click', function () {
          if (g.type === 'external') {
            if (typeof openGameInIframe === 'function') openGameInIframe(g.url);
            else window.open(g.url, '_blank');
          } else if (g.type === 'unity' && g.canvasXY) {
            clickUnityCanvas(g.canvasXY[0], g.canvasXY[1]);
          }
        });
      })(game);
    }

    cell.appendChild(tile);
    wrap.appendChild(cell);
  });

  document.body.appendChild(wrap);
})();

// content/content.js
(() => {
  if (window.__pkWalkerMounted) return;
  window.__pkWalkerMounted = true;

  const STATE = {
    x: 20,
    yBottom: 8,
    dir: 1,            // 1 = moving RIGHT, -1 = LEFT
    speed: 60,
    lastTs: 0,
    running: true,
    currentSrc: null
  };

  const root = document.createElement('div');
  root.id = 'pk-walker-root';

  const walker = document.createElement('div');
  walker.id = 'pk-walker';

  const bob = document.createElement('div');
  bob.className = 'pk-sprite-bob';

  const img = document.createElement('img');
  img.alt = 'pokemon-walker';

  bob.appendChild(img);
  walker.appendChild(bob);
  root.appendChild(walker);
  document.documentElement.appendChild(root);

  const bestSprite = (p) => p?.base_image || p?.shiny_image || null;

  // ✅ Flip mapping: art faces LEFT by default, so when moving RIGHT (dir=1) mirror it
  function applyFlip() {
    img.style.transform = STATE.dir === 1 ? 'scaleX(-1)' : 'scaleX(1)';
  }

  function randomizeSpeed() {
    STATE.speed = 60 + Math.random() * 30;
  }

  async function loadPicked() {
    try {
      const { pickedPokemon } = await browser.storage.local.get('pickedPokemon');
      const src = bestSprite(pickedPokemon);
      if (src && src !== STATE.currentSrc) { STATE.currentSrc = src; img.src = src; }
      img.title = pickedPokemon?.name
        ? pickedPokemon.name.replace(/\b\w/g, m => m.toUpperCase())
        : 'Pokémon';
    } catch {}
  }

  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.pickedPokemon) return;
    const p = changes.pickedPokemon.newValue;
    const src = bestSprite(p);
    if (src && src !== STATE.currentSrc) { STATE.currentSrc = src; img.src = src; }
    img.title = p?.name ? p.name.replace(/\b\w/g, m => m.toUpperCase()) : 'Pokémon';
  });

  function tick(ts) {
    if (!STATE.running) return;
    if (!STATE.lastTs) STATE.lastTs = ts;
    const dt = (ts - STATE.lastTs) / 1000;
    STATE.lastTs = ts;

    const vw = Math.max(document.documentElement.clientWidth, window.innerWidth || 0);
    const spriteW = img.width || 64;

    STATE.x += STATE.dir * STATE.speed * dt;

    const leftLimit = 8;
    const rightLimit = vw - spriteW - 8;
    if (STATE.x <= leftLimit) {
      STATE.x = leftLimit;
      STATE.dir = 1;
      randomizeSpeed();
      applyFlip();                // will face RIGHT (mirrored)
    } else if (STATE.x >= rightLimit) {
      STATE.x = rightLimit;
      STATE.dir = -1;
      randomizeSpeed();
      applyFlip();                // face LEFT (normal)
    }

    root.style.left = `${STATE.x}px`;
    root.style.bottom = `${STATE.yBottom}px`;

    requestAnimationFrame(tick);
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      STATE.running = false;
    } else {
      STATE.running = true;
      STATE.lastTs = 0;
      requestAnimationFrame(tick);
    }
  });

  (async () => {
    await loadPicked();
    randomizeSpeed();
    applyFlip();                  // ✅ face RIGHT before first frame
    requestAnimationFrame(tick);
  })();
})();

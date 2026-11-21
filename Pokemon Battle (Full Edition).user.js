// ==UserScript==
// @name        Pokemon Battle (Full Edition)
// @author      JellxWrld(@diedrchr), DStokesNCStudio9@esrobbie)
// @connect     pokeapi.co
// @connect     dstokesncstudio.com
// @namespace   dstokesncstudio.com
// @version     4.6.0.1
// @updateURL   https://raw.githubusercontent.com/D-Stokes-NC-Gaming-Studio/pokemon-tampermonkey/main/Pokemon%20Battle%20(Full%20Edition).user.js
// @downloadURL https://raw.githubusercontent.com/D-Stokes-NC-Gaming-Studio/pokemon-tampermonkey/main/Pokemon%20Battle%20(Full%20Edition).user.js
// @description Full version with XP, evolution, stats, sound, shop, battles, and walking partner — persistent across sites.
// @include     *
// @grant       GM.xmlHttpRequest
// @grant       unsafeWindow
// @grant       GM_getValue
// @grant       GM_setValue
// @grant       GM_xmlhttpRequest
// @grant       GM_addStyle
// @grant       GM_deleteValue
// @grant       GM_listValues
// @grant       GM_registerMenuCommand
// @grant       GM_addValueChangeListener
// @connect     github.com
// @connect     raw.githubusercontent.com
// @connect     play.pokemonshowdown.com
// @connect     cdn.jsdelivr.net
// @noframes
// ==/UserScript==
/*
How to use the request:
GM.xmlHttpRequest({
    method: 'GET',
    url: `https://dstokesncstudio.com/pokeapi/pokeapi.php?action=getPokemon&name=3`,
    onload: async res => {
        const d = JSON.parse(res.responseText);
        // build your entry
        console.log(d);
    },
    onerror: err => {
        console.error("Failed to fetch partner:", err);
    }
});
// form images https://raw.githubusercontent.com/HybridShivam/Pokemon/refs/heads/master/assets/imagesHQ/003-Gmax.png
// https://raw.githubusercontent.com/HybridShivam/Pokemon/refs/heads/master/assets/images/003-Gmax.png
*/

(function () {
  "use strict";
  // Only the top page gets the game. Without this it also ran inside frames - e.g. ServiceNow's
  // OTS Assist side panel - so the partner/HUD showed up in the frame instead of the page.
  if (window.top !== window.self) return;

  // ===== Everything the game shows lives in ONE shadow root =====
  // Site CSS can't break the game, and the game's CSS (incl. Bootstrap) never leaks into the site.
  const PKM_HOST = document.createElement("pkm-game");
  // Full-viewport and click-through: if a page (or the SOW Theme dark mode) puts a CSS filter on the host,
  // fixed panels are still placed against the whole screen instead of a 0x0 box.
  PKM_HOST.style.cssText = "all:initial;position:fixed;inset:0;pointer-events:none;z-index:2147483000;";
  const PKM_SHADOW = PKM_HOST.attachShadow({ mode: "open" });
  // Bootstrap 5 keeps its variables on :root / [data-bs-theme]; inside a shadow root :root matches
  // nothing, so everything is mounted inside this themed layer instead.
  const PKM = document.createElement("div");
  PKM.className = "pkm-layer";
  PKM.setAttribute("data-bs-theme", "light");
  PKM_SHADOW.appendChild(PKM);
  // Query helpers scoped to the game's shadow root (replaces document.getElementById / querySelector)
  PKM.getElementById = (id) => PKM_SHADOW.getElementById(id);
  let pkmUsed = false;
  function pkmEnsureHost() {
    pkmUsed = true;
    const parent = document.documentElement;
    if (!PKM_HOST.isConnected || PKM_HOST.parentNode !== parent) parent.appendChild(PKM_HOST);
  }
  /** Add a game element (panel, HUD, popup) to the shadow root. */
  function pkmMount(el) { pkmEnsureHost(); PKM.appendChild(el); return el; }
  /** Add CSS to the shadow root (instead of the page's <head>). */
  function pkmStyle(css, id) {
    const s = document.createElement("style");
    if (id) s.id = id;
    s.textContent = css;
    PKM_SHADOW.insertBefore(s, PKM);
    return s;
  }
  // Single-page sites (ServiceNow, YouTube...) sometimes rebuild <body>: put the game back.
  new MutationObserver(() => { if (pkmUsed && !PKM_HOST.isConnected) pkmEnsureHost(); }).observe(document.documentElement, { childList: true, subtree: false });
  setInterval(() => { if (pkmUsed && !PKM_HOST.isConnected) pkmEnsureHost(); }, 3000);

  // ===== PokeAPI cache =====
  // Battles, evolutions, the Pokedex and the starter list used to call PokeAPI every time.
  // GET responses from pokeapi.co are kept in GM storage: the big list for 1 day, single
  // Pokemon / species / evolution data for 30 days. Pokemon JSON is slimmed first (moves etc.
  // are ~95% of the size and unused). At most 500 entries; the oldest are dropped.
  const PKM_CACHE_PREFIX = "pkm_cache:";
  const PKM_CACHE_IDX = "pkm_cache_idx";
  const PKM_CACHE_MAX = 1500; // Pokémon + species + moves
  function pkmCacheTtl(url) { return /[?&]limit=/.test(url) ? 864e5 : 30 * 864e5; }
  function pkmCacheable(method, url) { return (!method || method.toUpperCase() === "GET") && /^https:\/\/pokeapi\.co\//.test(url); }
  function pkmCacheGet(url) {
    try {
      const raw = GM_getValue(PKM_CACHE_PREFIX + url, "");
      if (!raw) return null;
      const e = JSON.parse(raw);
      // Pokémon cached before 3.5 have no level-up move list: fetch them again once.
      if (/\/api\/v2\/pokemon\/[^/?]+\/?$/.test(url) && (e.body.indexOf('"_lv"') < 0 || e.body.indexOf('"_egg"') < 0 || e.body.indexOf('"_tm"') < 0)) return null;
      // Moves cached before 3.8 lack stat changes, targets and hit counts: fetch them again once.
      if (/\/api\/v2\/move\/[^/?]+\/?$/.test(url) && e.body.indexOf('"stat_changes"') < 0) return null;
      // Species cached before 3.7 lack egg groups and forms (daycare, Mega Evolution): fetch them again once.
      if (/\/api\/v2\/pokemon-species\/[^/?]+\/?$/.test(url) && (e.body.indexOf('"egg_groups"') < 0 || e.body.indexOf('"gender_rate"') < 0)) return null;
      return Date.now() - e.t < pkmCacheTtl(url) ? e.body : null;
    } catch { return null; }
  }
  /** Names of the moves a Pokémon can only get by breeding. */
  function m_eggMoves(moves) {
    return (moves || []).filter((m) => (m.version_group_details || []).some((v) => v.move_learn_method && v.move_learn_method.name === "egg")).map((m) => m.move.name);
  }
  function pkmSlim(text) {
    try {
      const d = JSON.parse(text);
      if (!d || typeof d !== "object") return text;
      if (Array.isArray(d.moves) && d.stats) {
        // /pokemon/{id}: keep only the level-up learnset as [move, level]
        const lv = [];
        for (const m of d.moves) {
          const det = (m.version_group_details || []).filter((v) => v.move_learn_method && v.move_learn_method.name === "level-up");
          if (det.length) lv.push([m.move.name, Math.max(1, det[det.length - 1].level_learned_at || 1)]);
        }
        d._lv = lv;
        d._egg = m_eggMoves(d.moves);
        d._tm = (d.moves || []).filter((m) => (m.version_group_details || []).some((v) => v.move_learn_method && v.move_learn_method.name === "machine")).map((m) => m.move.name);
        delete d.moves; delete d.game_indices; delete d.held_items; delete d.past_types; delete d.past_abilities; delete d.cries;
        if (d.sprites) { delete d.sprites.versions; if (d.sprites.other) d.sprites.other = { "official-artwork": d.sprites.other["official-artwork"] }; }
        return JSON.stringify(d);
      }
      if (d.capture_rate !== undefined && d.evolution_chain) {
        // /pokemon-species/{id}
        const def = (d.varieties || []).find((v) => v.is_default);
        return JSON.stringify({ id: d.id, name: d.name, capture_rate: d.capture_rate, evolution_chain: d.evolution_chain, is_legendary: d.is_legendary,
          is_mythical: d.is_mythical, growth_rate: d.growth_rate, default_variety: def && def.pokemon ? def.pokemon.name : d.name,
          egg_groups: (d.egg_groups || []).map((g) => g.name), hatch_counter: d.hatch_counter, is_baby: !!d.is_baby, gender_rate: d.gender_rate,
          evolves_from: d.evolves_from_species ? d.evolves_from_species.name : null,
          varieties: (d.varieties || []).map((v) => v.pokemon && v.pokemon.name).filter(Boolean) });
      }
      if (d.damage_class && d.pp !== undefined && d.type) {
        // /move/{name}
        const meta = d.meta || {};
        return JSON.stringify({ name: d.name, power: d.power, accuracy: d.accuracy, pp: d.pp, priority: d.priority, type: d.type, damage_class: d.damage_class,
          target: d.target ? { name: d.target.name } : null,
          stat_changes: (d.stat_changes || []).map((s) => ({ change: s.change, stat: s.stat && s.stat.name })),
          meta: { drain: meta.drain, healing: meta.healing, crit_rate: meta.crit_rate, flinch_chance: meta.flinch_chance, ailment: meta.ailment, ailment_chance: meta.ailment_chance,
            min_hits: meta.min_hits, max_hits: meta.max_hits, stat_chance: meta.stat_chance } });
      }
      return text;
    } catch { return text; }
  }
  function pkmCachePut(url, text) {
    try {
      const body = pkmSlim(text);
      GM_setValue(PKM_CACHE_PREFIX + url, JSON.stringify({ t: Date.now(), body }));
      let idx = []; try { idx = JSON.parse(GM_getValue(PKM_CACHE_IDX, "[]")); } catch {}
      idx = idx.filter((u) => u !== url); idx.push(url);
      while (idx.length > PKM_CACHE_MAX) { const old = idx.shift(); try { GM_deleteValue(PKM_CACHE_PREFIX + old); } catch {} }
      GM_setValue(PKM_CACHE_IDX, JSON.stringify(idx));
      return body;
    } catch { return text; }
  }
  function pkmCacheClear() {
    let idx = []; try { idx = JSON.parse(GM_getValue(PKM_CACHE_IDX, "[]")); } catch {}
    idx.forEach((u) => { try { GM_deleteValue(PKM_CACHE_PREFIX + u); } catch {} });
    GM_setValue(PKM_CACHE_IDX, "[]");
    return idx.length;
  }
  /** GM.xmlHttpRequest with the PokeAPI cache in front. Same options / callbacks. */
  function pkmXhr(opts) {
    if (!pkmCacheable(opts.method, opts.url)) return GM.xmlHttpRequest(opts);
    const hit = pkmCacheGet(opts.url);
    if (hit != null) {
      setTimeout(() => opts.onload && opts.onload({ status: 200, responseText: hit, finalUrl: opts.url, fromCache: true }), 0);
      return;
    }
    return GM.xmlHttpRequest({
      ...opts,
      onload: (res) => {
        let text = res.responseText;
        if (res.status === 200 && text) text = pkmCachePut(opts.url, text);
        opts.onload && opts.onload({ status: res.status, responseText: text, finalUrl: res.finalUrl });
      },
    });
  }
  /** fetch() replacement: cached, and goes through GM so strict site CSPs can't block PokeAPI. */
  function pkmFetch(url, init = {}) {
    url = String(url);
    const wrap = (status, text) => ({ ok: status >= 200 && status < 300, status, text: async () => text, json: async () => JSON.parse(text) });
    if (!pkmCacheable(init.method, url)) return fetch(url, init);
    const hit = pkmCacheGet(url);
    if (hit != null) return Promise.resolve(wrap(200, hit));
    return new Promise((resolve, reject) => {
      GM.xmlHttpRequest({
        method: "GET", url,
        onload: (res) => resolve(wrap(res.status, res.status === 200 ? pkmCachePut(url, res.responseText) : res.responseText)),
        onerror: (e) => reject(new TypeError("Network error: " + url)),
        ontimeout: () => reject(new TypeError("Timeout: " + url)),
      });
    });
  }

  // Bootstrap CSS, fetched once (bypasses site CSP) and cached, applied ONLY inside the shadow root.
  const BS_URL = "https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css";
  const BS_KEY = "pkm_bootstrap_css_5.3.3";
  const bsStyle = pkmStyle(GM_getValue(BS_KEY, ""), "pkm-bootstrap");
  if (!bsStyle.textContent) {
    GM_xmlhttpRequest({
      method: "GET", url: BS_URL,
      onload: (r) => { if (r.status === 200 && r.responseText.length > 10000) { GM_setValue(BS_KEY, r.responseText); bsStyle.textContent = r.responseText; } },
      onerror: () => { const l = document.createElement("link"); l.rel = "stylesheet"; l.href = BS_URL; PKM_SHADOW.insertBefore(l, bsStyle); },
    });
  }
  // Base text styles that Bootstrap normally puts on <body>
  pkmStyle(`
    :host { all: initial; }
    .pkm-layer { font-family: system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif; font-size: 14px; line-height: 1.4;
      color: #212529; -webkit-font-smoothing: antialiased; text-align: left; }
    .pkm-layer *, .pkm-layer *::before, .pkm-layer *::after { box-sizing: border-box; }
    .pkm-layer > * { pointer-events: auto; }
    /* Buttons that reset their styles with all:unset would inherit the host's click-through; keep them clickable */
    .pkm-layer > .pkm-launcher, .pkm-layer > .pkm-menu { pointer-events: auto !important; }
  `, "pkm-base");

  pkmStyle(`
/* (keep your existing animations & small styles you had) */
@keyframes pulseBadge { 0%,100%{ transform: translateY(-50%) scale(1) } 50%{ transform: translateY(-50%) scale(1.15) } }
button .badge.bg-danger { animation: pulseBadge 1.2s infinite; position: relative; top: -2px; margin-left: 6px; }
@keyframes shake { 0%{transform:translate(1px,0)}25%{transform:translate(-1px,0)}50%{transform:translate(2px,0)}75%{transform:translate(-2px,0)}100%{transform:translate(1px,0)} }
@keyframes flash { 0%,100%{opacity:1} 50%{opacity:0} }
@keyframes bobWalk { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-3px)} }
#pkm-partner-sprite { transform-origin:center; }
.pixel-frame{border:24px solid transparent;border-image:url('https://raw.githubusercontent.com/D-Stokes-NC-Gaming-Studio/pokemon-tampermonkey/refs/heads/main/Windowskins/choice%20ug.png') 23 stretch;width:280px;margin:auto;padding:16px;color:#fff;box-sizing:content-box}

/* ===== Pokédex styles (Firefox extension look) ===== */
.dex-title{font-size:1.1rem;margin:0 0 8px 0}
.dex-search{width:100%;padding:8px;border-radius:8px;border:1px solid #2b2b3d;background:#10101a;color:#fff;outline:none;margin-bottom:10px}
.pkm-dex-panel .dex-grid{flex:1 1 auto;max-height:none !important;min-height:0;}
.pkm-dex-panel .dex-title,.pkm-dex-panel .dex-search,.pkm-dex-panel .dex-footer{flex:0 0 auto;}
.dex-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px;max-height:60vh;overflow-y:auto;padding-right:2px}
.dex-entry{position:relative;background:#1a1a2a;border:1px solid #2b2b3d;border-radius:12px;padding:12px;text-align:center;color:#e9e7ff;transition:transform .15s ease, box-shadow .15s ease}
.dex-entry:hover{transform:translateY(-2px);box-shadow:0 6px 16px rgba(0,0,0,.35)}
.dex-entry.owned{border-color:#3c7cff}
.dex-number{font-size:.85rem;opacity:.7;margin-bottom:4px;text-align:left}
.dex-sprite img{width:64px;height:64px;image-rendering:pixelated;filter:drop-shadow(0 0 6px rgba(255,255,255,.2))}
.dex-name{margin-top:6px;font-weight:700;letter-spacing:.3px}

/* Detail panel */
.pokedex-detail{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:#1e1e2f;color:#fff;padding:20px 16px 16px;border:2px solid #ff4b4b;border-radius:14px;width:320px;z-index:11000;max-height:80vh;overflow-y:auto;box-shadow:0 0 24px rgba(255,75,75,.35)}
.detail-close{position:absolute;top:6px;right:8px;background:transparent;border:none;color:#fff;font-size:18px;cursor:pointer}
.detail-title{margin:0 0 8px 0}
.detail-title small{opacity:.8;font-weight:400}
.detail-sprite{display:block;margin:8px auto;width:96px;height:96px;image-rendering:pixelated}
.detail-section{background:#141428;border:1px solid #2b2b3d;border-radius:10px;padding:8px;margin:8px 0;line-height:1.5}
.detail-stats{width:100%;border-collapse:collapse;margin-top:6px}
.detail-stats th,.detail-stats td{padding:6px;border-bottom:1px solid rgba(255,255,255,.15);text-align:left}
/* === BAG / PARTY LAYOUT (final polished) === */

.party-storage-panel {
  background: #0c0c1b;
  color: #fff;
  border-radius: 10px;
  padding: 16px;
  font-family: "Segoe UI", sans-serif;
  max-width: 800px;
  margin: 20px auto;
  box-sizing: border-box;
}

.party-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
}

.party-header .name {
  font-weight: 600;
  font-size: 1.1em;
}

.box-nav {
  display: flex;
  align-items: center;
  gap: 6px;
}

/* === GRID WRAPPERS === */
.party-grid,
.storage-grid {
  display: grid;
  justify-content: center;
  gap: 8px;
  margin: 35px 0;
}

.party-grid {
  grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
  grid-auto-rows: 180px;
}

.storage-grid {
  grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
  grid-auto-rows: 210px;
}

/* === INDIVIDUAL SLOTS === */
.slot {
  background: #161633;
  border: 1px solid #333;
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 200px;
  transition: transform 0.15s ease, background 0.15s;
}

.slot.empty {
  opacity: 0.15;
}

.slot:hover:not(.empty) {
  transform: scale(1.05);
  background: #1d1d3a;
}

/* === MON CARD CONTENT === */
.mon-card {
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: space-between;
  height: 100%;
  padding: 6px 2px;
  box-sizing: border-box;
}

.mon-sprite img {
  width: 60px;
  height: 60px;
  image-rendering: pixelated;
}

.mon-meta {
  margin-top: 4px;
  font-size: 0.85em;
}

.mon-name {
  font-weight: bold;
  font-size: 0.85em;
  line-height: 1.1em;
}

.mon-sub {
  font-size: 0.75em;
  opacity: 0.8;
}

/* === BUTTON GROUP === */
.mon-buttons {
  margin-top: 4px;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.btn-xs {
  font-size: 0.7em !important;
  padding: 3px 6px !important;
  line-height: 1.2;
}

/* === DIVIDERS & NOTES === */
.sep {
  border: none;
  border-top: 1px solid #333;
  margin: 10px 0;
}

.tiny.muted {
  font-size: 0.8em;
  opacity: 0.6;
  text-align: center;
  margin-bottom: 6px;
}

/* === RESPONSIVE FIX === */
@media (max-width: 640px) {
  .party-grid,
  .storage-grid {
    grid-template-columns: repeat(auto-fill, minmax(80px, 1fr));
    grid-auto-rows: 110px;
  }
  .slot {
    height: 110px;
  }
  .mon-sprite img {
    width: 48px;
    height: 48px;
  }
}
.slot.drop-ok {
  outline: 2px solid #4caf50;
  box-shadow: 0 0 6px #4caf50;
}
.mon-card.dragging {
  opacity: 0.5;
  transform: scale(1.05);
}
  /* === Rarity glow on slots === */
.slot.rarity-common { box-shadow: 0 0 0 1px #2c2c2c inset; }
.slot.rarity-uncommon { box-shadow: 0 0 8px 0 rgba(60, 179, 113, .65); }  /* green-ish */
.slot.rarity-rare { box-shadow: 0 0 10px 0 rgba(66, 153, 225, .85); }    /* blue glow */
.slot.rarity-legendary { box-shadow: 0 0 12px 0 rgba(255, 215, 0, .95); } /* gold glow */

/* === Tooltip bubble === */
.pk-tip {
  position: absolute;
  z-index: 99999;
  left: 50%;
  bottom: 100%;
  transform: translate(-50%, -6px) scale(.98);
  padding: 6px 8px;
  background: rgba(12,12,27,.98);
  color: #fff;
  border: 1px solid #333;
  border-radius: 6px;
  font-size: 12px;
  line-height: 1.25;
  white-space: nowrap;
  opacity: 0;
  pointer-events: none;
  transition: opacity .12s ease, transform .12s ease;
  box-shadow: 0 4px 14px rgba(0,0,0,.35);
}
.slot:hover .pk-tip { opacity: 1; transform: translate(-50%, -10px) scale(1); }
.pk-tip .pk-tip-title { font-weight: 700; margin-bottom: 2px; }
.pk-tip .pk-tip-line { opacity: .9; }

.pk-types { display: inline-flex; gap: 4px; align-items: center; margin-top: 2px; }
.pk-type {
  display: inline-block;
  padding: 2px 6px;
  border-radius: 9999px;
  font-size: 11px;
  color: #fff;
}

/* === Type chip colors (simple set) === */
.pk-type.normal{background:#A8A77A}
.pk-type.fire{background:#EE8130}
.pk-type.water{background:#6390F0}
.pk-type.electric{background:#F7D02C;color:#111}
.pk-type.grass{background:#7AC74C}
.pk-type.ice{background:#96D9D6;color:#111}
.pk-type.fighting{background:#C22E28}
.pk-type.poison{background:#A33EA1}
.pk-type.ground{background:#E2BF65;color:#111}
.pk-type.flying{background:#A98FF3}
.pk-type.psychic{background:#F95587}
.pk-type.bug{background:#A6B91A;color:#111}
.pk-type.rock{background:#B6A136}
.pk-type.ghost{background:#735797}
.pk-type.dragon{background:#6F35FC}
.pk-type.dark{background:#705746}
.pk-type.steel{background:#B7B7CE;color:#111}
.pk-type.fairy{background:#D685AD}
/* === Extended rarity classes === */
.slot.rarity-sublegendary {
  box-shadow: 0 0 12px 0 rgba(138, 43, 226, 0.85); /* purple glow */
}

.slot.rarity-mythical {
  position: relative;
  box-shadow: 0 0 14px 0 rgba(255, 105, 180, 0.9); /* pink glow */
  overflow: visible;
}

/* === Sparkle animation for Mythical Pokémon === */
@keyframes sparkle {
  0% { opacity: 0; transform: translateY(0) scale(1); }
  50% { opacity: 1; transform: translateY(-3px) scale(1.1); }
  100% { opacity: 0; transform: translateY(0) scale(1); }
}
.slot.rarity-mythical::after {
  content: "✨";
  position: absolute;
  top: -10px;
  right: -8px;
  font-size: 14px;
  animation: sparkle 1.8s infinite ease-in-out;
  pointer-events: none;
}

/* === Slight color refinement === */
.pk-tip .pk-tip-line strong {
  color: #ffd700; /* golden highlight for rarity */
}
`, "pkm-main");
  // 🔥 --- Custom Pokemon Logger (paste the whole code here) ---
  (function attachPokemonLogger(global = window) {
    const LEVELS = ["debug", "log", "info", "warn", "error"];
    const DEFAULT_COLOR = "#ff4b2b";

    function fmtNow() {
      const d = new Date();
      return (
        d.toLocaleTimeString(undefined, { hour12: false }) +
        "." +
        String(d.getMilliseconds()).padStart(3, "0")
      );
    }

    function makePrinter(
      scope,
      color = DEFAULT_COLOR,
      enabled = true,
      minLevel = "debug"
    ) {
      const minIdx = Math.max(0, LEVELS.indexOf(minLevel));

      function style(labelColor) {
        return [
          `%c${fmtNow()} %c${scope}%c`,
          "opacity:.7",
          `background:${labelColor}; color:#fff; padding:2px 6px; border-radius:6px; font-weight:700`,
          "color:inherit",
        ];
      }

      const api = {
        scope,
        enabled,
        color,
        level: minLevel,
        setEnabled(v) {
          api.enabled = !!v;
          return api;
        },
        setLevel(lvl) {
          api.level = lvl;
          return api;
        },
        setColor(c) {
          api.color = c;
          return api;
        },

        child(subScope, subColor) {
          return makePrinter(
            `${scope}.${subScope}`,
            subColor || color,
            api.enabled,
            api.level
          );
        },

        _buffer: [],
        get history() {
          return api._buffer.slice();
        },
        clearHistory() {
          api._buffer.length = 0;
        },

        debug(...args) {
          return _print("debug", args);
        },
        log(...args) {
          return _print("log", args);
        },
        info(...args) {
          return _print("info", args);
        },
        warn(...args) {
          return _print("warn", args);
        },
        error(...args) {
          return _print("error", args);
        },
        success(...args) {
          return _print("log", args, "#2e7d32");
        },
      };

      function _print(level, args, forceColor) {
        if (!api.enabled) return api;
        const idx = LEVELS.indexOf(level);
        if (idx < LEVELS.indexOf(api.level)) return api;

        const col = forceColor || api.color;
        const head = style(col);
        const fn = console[level] || console.log;
        api._buffer.push({ t: Date.now(), scope, level, args });
        try {
          fn.apply(console, head.concat(args));
        } catch {
          console.log(`[${scope}]`, ...args);
        }
        return api;
      }

      return api;
    }

    const pokemon = makePrinter("pokemon", DEFAULT_COLOR);
    pokemon.configs = pokemon.child("configs", "#00bcd4");
    pokemon.net = pokemon.child("net", "#9c27b0");
    pokemon.ui = pokemon.child("ui", "#ff9800");

    Object.defineProperty(global, "pokemon", {
      value: pokemon,
      writable: false,
    });
  })(typeof unsafeWindow !== "undefined" ? unsafeWindow : window);

  pokemon.log("Pokemon script started ✅");
  // --- Configs class (example usage) ---
  // Update settings only. Storage keys, helpers, forms, sprite fixes and sounds live in ONE place
  // further down (STORAGE / getInt / setObj ...). This class used to keep a second, out-of-date copy.
  class Configs {
    constructor(
      url = "https://raw.githubusercontent.com/D-Stokes-NC-Gaming-Studio/pokemon-tampermonkey/main/Pokemon%20Battle%20(Full%20Edition).user.js",
      currentVersion = typeof GM_info !== "undefined" && GM_info?.script?.version ? GM_info.script.version : "0.0.0"
    ) {
      this.DOWNLOAD_URL = url;
      this.CURRENT_VERSION = currentVersion;
      this._updateChecking = false;
      this.POKE_CENTER_COST = 250; // coins
      pokemon.configs.info("Loading configs...");
    }
    logInfo() {
      pokemon.configs.info("Config ready:", "Starting to check for updates...");
      this.checkUpdates();
    }
    checkUpdates() {
      if (this._updateChecking) return;
      this._updateChecking = true;
      pokemon.configs.info("Checking for updates...");
    }
  }
  class CheckUpdate {
    constructor(configs) {
      this.configs = configs; // ✅ FIX: store reference
    }

    async check() {
      const remoteVersion = await this.fetchRemoteVersion(
        this.configs.DOWNLOAD_URL
      );
      pokemon.configs.info("Remote Version:", remoteVersion || "Unknown");
      pokemon.configs.info("Current Version:", this.configs.CURRENT_VERSION);

      if (!remoteVersion) {
        pokemon.configs.warn("⚠️ Could not fetch remote version.");
        return;
      }

      const cmp = this.compareVersions(
        remoteVersion,
        this.configs.CURRENT_VERSION
      );
      if (cmp > 0) {
        pokemon.configs.warn("⚠️ Update available:", remoteVersion);
        this.promptUpdate(remoteVersion);
      } else if (cmp === 0) {
        pokemon.configs.success("✅ Up to date!");
      } else {
        pokemon.configs.log("📦 Local version is newer (dev build).");
      }
    }

    promptUpdate(remoteVersion) {
      // A banner in the game (set up later, once the UI exists) instead of a blocking confirm() box.
      GM_setValue("pkm_update_remote", remoteVersion);
      if (typeof pkmUpdateNotice === "function") pkmUpdateNotice(remoteVersion);
    }

    async needsUpdate() {
      const remoteVersion = await this.fetchRemoteVersion(
        this.configs.DOWNLOAD_URL
      );
      if (!remoteVersion) return false;
      return (
        this.compareVersions(remoteVersion, this.configs.CURRENT_VERSION) > 0
      );
    }

    async fetchRemoteVersion(url, force = false) {
      // Cached for 1 hour: this used to download the whole script on every HUD redraw. "force" skips the cache (Check now button).
      // The cache is tied to the installed version, so installing a new build never trusts an answer saved by an older one.
      const cur = (typeof GM_info !== "undefined" && GM_info?.script?.version) || "";
      try { const c = JSON.parse(GM_getValue("pkm_update_cache", "{}")); if (!force && c.url === url && c.cur === cur && Date.now() - c.t < 3600e3) return c.v; } catch {}
      const v = await this._fetchRemoteVersion(url);
      if (v) GM_setValue("pkm_update_cache", JSON.stringify({ url, t: Date.now(), v, cur }));
      return v;
    }
    async _fetchRemoteVersion(url) {
      return new Promise((resolve) => {
        GM_xmlhttpRequest({
          method: "GET",
          url: url + "?_=" + Date.now(),
          headers: { "Cache-Control": "no-cache", Pragma: "no-cache" },
          responseType: "text",
          onload: (res) => {
            if (res.status >= 200 && res.status < 300 && res.responseText) {
              const m = res.responseText.match(/@version\s+([^\s]+)/i);
              resolve(m ? m[1].trim() : null);
            } else {
              resolve(null);
            }
          },
          onerror: () => resolve(null),
          ontimeout: () => resolve(null),
        });
      });
    }

    normalizeVersion(v, length = 4) {
      if (!v) return Array.from({ length }, () => 0);
      v = String(v).trim().replace(/^v/i, "");
      const parts = v.split(/[.\-]/).map((seg) => {
        const m = String(seg).match(/^\d+/);
        return m ? parseInt(m[0], 10) : 0;
      });
      while (parts.length < length) parts.push(0);
      if (parts.length > length) parts.length = length;
      return parts;
    }

    compareVersions(a, b) {
      const A = this.normalizeVersion(a);
      const B = this.normalizeVersion(b);
      for (let i = 0; i < A.length; i++) {
        if (A[i] > B[i]) return 1;
        if (A[i] < B[i]) return -1;
      }
      return 0;
    }
  }

  // ✅ Usage example:
  const cfg = new Configs();
  cfg.logInfo(); // optional

  const updater = new CheckUpdate(cfg);
  updater.check(); // runs full check
  const POKE_CENTER_COST = cfg.POKE_CENTER_COST;
  // --- Blocklist: Add domains or paths you want to skip ---
  const BLOCKLIST = [
    /:\/\/www\.facebook\.com\/adsmanager\//, // Example: Facebook ads manager
    /:\/\/ads\.google\./, // Google Ads
    /:\/\/doubleclick\.net\//,
    // Password sites are always off. Work sites moved to the editable "Sites" list in Settings.
    /:\/\/password-v2\.corp\.amazon\.com/,
    /:\/\/password\.amazon\.com/,

    /// DoubleClick ad domains
    // Add more patterns as needed
  ];


  // Check if current URL matches any blocklist rule
  if (BLOCKLIST.some((rx) => rx.test(location.href))) return;

  // --- Per-site on/off list (Settings > Sites, or the Tampermonkey menu) ---
  const PKM_SITES_KEY = "pkm_disabled_sites";
  const PKM_DEFAULT_OFF = [
    "chatgpt.com", "github.com", "ithelp.corp.amazon.com",
    "prod.dscs.opstechit.amazon.dev", "apxprod.dscs.opstechit.amazon.dev",
    "zebratool.corp.amazon.com", "t.corp.amazon.com",
  ];
  // 3.3.1: ServiceNow (SOW) is no longer off by default. Remove it once from lists saved by 3.3.0.
  if (!GM_getValue("pkm_sites_v331", false)) {
    GM_setValue("pkm_sites_v331", true);
    try {
      const v = GM_getValue(PKM_SITES_KEY, null);
      if (v != null) GM_setValue(PKM_SITES_KEY, JSON.stringify(JSON.parse(v).filter((s) => s !== "amazonots.service-now.com")));
    } catch {}
  }
  function pkmDisabledSites() {
    try {
      const v = GM_getValue(PKM_SITES_KEY, null);
      if (v == null) return PKM_DEFAULT_OFF.slice();
      const a = JSON.parse(v);
      return Array.isArray(a) ? a : [];
    } catch { return []; }
  }
  function pkmSetDisabledSites(list) {
    const clean = list.map((s) => String(s).trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "")).filter(Boolean);
    GM_setValue(PKM_SITES_KEY, JSON.stringify([...new Set(clean)]));
  }
  function pkmSiteOff(host = location.hostname) {
    host = host.toLowerCase();
    return pkmDisabledSites().some((s) => host === s || host.endsWith("." + s));
  }
  if (typeof GM_registerMenuCommand === "function") {
    const off = pkmSiteOff();
    GM_registerMenuCommand(
      off ? `▶ Turn Pokémon ON for ${location.hostname}` : `⏸ Turn Pokémon OFF for ${location.hostname}`,
      () => {
        const h = location.hostname.toLowerCase();
        const rest = pkmDisabledSites().filter((s) => !(h === s || h.endsWith("." + s)));
        pkmSetDisabledSites(off ? rest : rest.concat(h));
        location.reload();
      }
    );
  }
  if (pkmSiteOff()) return;

  // In addition to the above blocklist:
  if (
    ["youtube.com", "www.youtube.com"].includes(window.location.hostname) &&
    (window.location.pathname.startsWith("/live_chat") ||
      window.location.pathname.startsWith("/embed/"))
  ) {
    return;
  }
  // If running inside an iframe (ads commonly do this)
  if (window !== window.top) {
    // Optionally, only block on specific domains
    if (
      /youtube\.com|doubleclick\.net|ads\.google\./.test(
        window.location.hostname
      )
    )
      return;
  }

  // --- Storage and helpers ---
  const STORAGE = {
    coins: "pkm_coins",
    balls: "pkm_balls",
    greatBalls: "pkm_great_balls",
    ultraBalls: "pkm_ultra_balls",
    potions: "pkm_potions",
    party: "pkm_party",
    starter: "pkm_starter",
    xp: "pkm_xp",
    level: "pkm_level",
    soundOn: "pkm_sound_on",
    stats: "pkm_stats",
    masterBalls: "pkm_master_balls",
    pokestopCooldown: "pkm_pokestop_cooldown",
    volume: "pkm_volume",
    pokedex: "pkm_pokedex",
    BOX_ID: "BOX_ID",
  };
  const POKEAPI_VALID_FORMS = {
    // only include forms that PokéAPI has sprites for
    mega: [
      "charizard-megax",
      "charizard-megay",
      "mewtwo-megax",
      "mewtwo-megay",
      "lucario-mega",
      "gyarados-mega",
    ],
    alolan: [
      "raichu-alola",
      "marowak-alola",
      "vulpix-alola",
      "ninetales-alola",
    ],
    galarian: ["zigzagoon-galar", "slowpoke-galar", "rapidash-galar"],
    hisuian: ["zoroark-hisui", "braviary-hisui", "growlithe-hisui"],
    paldean: ["wooper-paldea"],
  };
  const SPRITE_NAME_FIXES = {
    "shaymin-land": "shaymin",
    "giratina-altered": "giratina",
    "tornadus-incarnate": "tornadus",
    "thundurus-incarnate": "thundurus",
    "landorus-incarnate": "landorus",
    "keldeo-ordinary": "keldeo",
    "meloetta-aria": "meloetta",
    "lycanroc-midday": "lycanroc",
    "zygarde-50": "zygarde",
    "wishiwashi-solo": "wishiwashi",
    "ho-ho": "hooh",
    "porygon-z": "porygonz",
    "type-null": "typenull",
    "jangmo-o": "jangmoo",
    "hakamo-o": "hakamoo",
    "kommo-o": "kommoo",
    farfetchd: "farfetchd",
    "mr-mime": "mrmime",
    "mr-rime": "mrrime",
    "mime-jr": "mimejr",
    flabebe: "flabebe",
    "nidoran-f": "nidoranf",
    "nidoran-m": "nidoranm",
    "tapu-koko": "tapukoko",
    "tapu-lele": "tapulele",
    "tapu-bulu": "tapubulu",
    "tapu-fini": "tapufini",
    "charizard-mega-x": "charizard-megax",
    "charizard-mega-y": "charizard-megay",
    "mewtwo-mega-x": "mewtwo-megax",
    "mewtwo-mega-y": "mewtwo-megay",
    // Add more as needed
  };
  function getRandomForm(baseName) {
    const isShiny = Math.random() < 0.05;
    const allForms = Object.entries(POKEAPI_VALID_FORMS).flatMap(
      ([formType, names]) => names.map((name) => ({ formType, name }))
    );

    const possibleForms = allForms.filter((f) =>
      f.name.startsWith(baseName.toLowerCase())
    );

    let form = null;
    if (possibleForms.length && Math.random() < 0.12) {
      form = possibleForms[Math.floor(Math.random() * possibleForms.length)];
    }

    const formName = form ? form.name : baseName.toLowerCase();
    const displayName = `${baseName}`;

    return { isShiny, formName, displayName };
  }
  function getStats(name) {
    const allStats = getObj(STORAGE.stats);
    return (
      allStats[name.toLowerCase()] || { xp: 0, level: 1, hp: 100, atk: 15 }
    );
  }

  /** Stats of the Pokémon you're actually using (per-instance, same as the HUD), with HP always defined. */
  function activeStats() {
    const id = GM_getValue("pkm_starter_id");
    const party = getObj(STORAGE.party) || {};
    const s = id && party[id] ? getStatsForInstance(id, party[id].name) : getStats(starterName || "unknown");
    if (!Number.isFinite(s.hp) || s.hp <= 0) s.hp = 100;
    if (!Number.isFinite(s.currentHP)) s.currentHP = s.hp;
    return s;
  }
  function setActiveStats(stats) {
    const id = GM_getValue("pkm_starter_id");
    const party = getObj(STORAGE.party) || {};
    if (id && party[id]) setStatsForInstance(id, stats); else setStats(starterName || "unknown", stats);
  }
  function setStats(name, stats) {
    const allStats = getObj(STORAGE.stats);
    allStats[name.toLowerCase()] = stats;
    setObj(STORAGE.stats, allStats);
  }

  const getInt = (k, d = 0) => {
    const v = parseInt(GM_getValue(k, d), 10);
    return isNaN(v) ? d : v;
  };
  // Every game setter tells the HUD to refresh, so coins / HP / XP / items update right away.
  const setInt = (k, v) => { GM_setValue(k, parseInt(v, 10)); pkmNotify(k); };

  const getBool = (k) => GM_getValue(k, "false") === "true";
  const setBool = (k, v) => { GM_setValue(k, v ? "true" : "false"); pkmNotify(k); };

  const getObj = (k) => {
    try {
      return JSON.parse(GM_getValue(k, "{}")) || {};
    } catch {
      return {};
    }
  };
  const setObj = (k, o) => { GM_setValue(k, JSON.stringify(o)); pkmNotify(k); };

  const getStr = (k, d = "") => GM_getValue(k, d);
  const setStr = (k, v) => { GM_setValue(k, v); pkmNotify(k); };
  const getArr = (k) => {
    try {
      return JSON.parse(GM_getValue(k, "[]")) || [];
    } catch {
      return [];
    }
  };
  const setArr = (k, a) => { GM_setValue(k, JSON.stringify(a)); pkmNotify(k); };
  /** Debounced live refresh of the HUD and coin labels after a game value changes. */
  function pkmNotify(k) {
    if (!/^pkm_(sound_on|coins|balls|great_balls|ultra_balls|master_balls|potions|xattack|revive|stats|party|starter|starter_id|pokedex|pokestop_cooldown)$/.test(k)) return;
    if (pkmNotify.t) return;
    pkmNotify.t = setTimeout(() => {
      pkmNotify.t = 0;
      try { pkmLiveRefresh(); } catch (e) { console.warn("Pokémon HUD refresh failed:", e); }
    }, 60);
  }

  // Initialize defaults if needed
  if (!GM_getValue(STORAGE.coins)) setInt(STORAGE.coins, 100);
  if (!GM_getValue(STORAGE.balls)) setInt(STORAGE.balls, 5);
  if (!GM_getValue(STORAGE.potions)) setInt(STORAGE.potions, 2);
  if (!GM_getValue(STORAGE.greatBalls)) setInt(STORAGE.greatBalls, 0);
  if (!GM_getValue(STORAGE.ultraBalls)) setInt(STORAGE.ultraBalls, 0);
  if (!GM_getValue(STORAGE.masterBalls)) setInt(STORAGE.masterBalls, 0);
  if (!GM_getValue(STORAGE.pokestopCooldown))
    setInt(STORAGE.pokestopCooldown, 0);
  if (!GM_getValue(STORAGE.pokedex)) setArr(STORAGE.pokedex, []);
  if (!GM_getValue(STORAGE.party)) {
    setObj(STORAGE.party, {});
  } else {
    // Migration from old array party format
    const val = GM_getValue(STORAGE.party);
    try {
      const parsed = JSON.parse(val);
      if (Array.isArray(parsed)) {
        const objParty = {};
        for (const name of parsed) {
          const key = name.toLowerCase();
          objParty[key] = (objParty[key] || 0) + 1;
        }
        setObj(STORAGE.party, objParty);
      }
    } catch {}
  }
  // New players start with sound off (the mute button on the HUD turns it on)
  if (GM_getValue(STORAGE.soundOn) == null) setBool(STORAGE.soundOn, false);
  if (!GM_getValue(STORAGE.xp)) setInt(STORAGE.xp, 0);
  if (!GM_getValue(STORAGE.level)) setInt(STORAGE.level, 1);
  if (!GM_getValue(STORAGE.stats)) setObj(STORAGE.stats, { hp: 100, atk: 15 });

  const XP_TO_LEVEL = (lvl) => 50 + lvl * 25;
  const MAX_LEVEL = 100;

  // --- Sounds ---
  const SOUNDS = {
    hit: new Audio(
      "https://github.com/jellowrld/pokemon-tampermonkey/raw/refs/heads/main/hit.mp3"
    ),
    ball: new Audio(
      "https://github.com/jellowrld/pokemon-tampermonkey/raw/refs/heads/main/Throw.mp3"
    ),
    catch: new Audio(
      "https://github.com/jellowrld/pokemon-tampermonkey/raw/refs/heads/main/06-caught-a-pokemon.mp3"
    ),
    faint: new Audio(
      "https://github.com/jellowrld/pokemon-tampermonkey/raw/refs/heads/main/faint.mp3"
    ),
    run: new Audio(
      "https://github.com/jellowrld/pokemon-tampermonkey/raw/refs/heads/main/runaway.mp3"
    ),
    start: new Audio(
      "https://github.com/jellowrld/pokemon-tampermonkey/raw/refs/heads/main/wildbattle.mp3"
    ),
    victory: new Audio(
      "https://github.com/jellowrld/pokemon-tampermonkey/raw/refs/heads/main/victory.mp3"
    ),
    lose: new Audio(
      "https://github.com/jellowrld/pokemon-tampermonkey/raw/refs/heads/main/lose.mp3"
    ),
    stop: new Audio(""),
    battleSound: new Audio(
      "https://github.com/jellowrld/pokemon-tampermonkey/raw/refs/heads/main/wildbattle.mp3"
    ),
  };
  const parsedVol = parseFloat(getStr(STORAGE.volume, "0.4"));
  const savedVolume = isNaN(parsedVol) ? 0.4 : parsedVol;

  Object.entries(SOUNDS).forEach(([key, audio]) => {
    if (audio instanceof Audio) {
      audio.volume = savedVolume;
    }
  });

  function playSound(key) {
    const audio = SOUNDS[key];
    if (getBool(STORAGE.soundOn) && audio instanceof Audio) {
      // Clone to allow overlapping sound if called in quick succession
      const clone = audio.cloneNode();
      clone.volume = audio.volume;
      clone
        .play()
        .catch((err) => console.warn("Audio play failed or blocked:", err));
    }
  }

  // --- Global vars ---
  let partnerName = null,
    partnerSpriteUrl = null,
    starterName = null;
  let spriteEl = null,
    walkInterval = null,
    walkDirection = -1;
  let wrap = document.createElement("div");
  let wildSleepTurns = 0;
  let randomBattleEnabled = getBool("pkm_random_battles");
  let randomBattleTimer = null;
  let nextBattleTime = null;
  SOUNDS.battleSound.loop = true;
  function loadPokedex() {
    let raw = GM_getValue(STORAGE.pokedex, "[]");
    try {
      return JSON.parse(raw);
    } catch {
      return [];
    }
  }
  function recordPokedex(entry) {
    // STORAGE.pokedex will hold a JSON array of {id,name,spriteUrl,types,…}
    let raw = GM_getValue(STORAGE.pokedex, "[]");
    let arr;
    try {
      arr = JSON.parse(raw);
    } catch {
      arr = [];
    }
    if (!arr.some((e) => e.name.toLowerCase() === entry.name.toLowerCase())) {
      arr.push(entry);
      GM_setValue(STORAGE.pokedex, JSON.stringify(arr));
    }
  }
  // PokeDex Class //
  class Pokedex {
    constructor(entries) {
      this.entries = entries;
    }
    static async load() {
      const raw = await getArr(STORAGE.pokedex);
      return new Pokedex(raw);
    }
    render(container) {
      const GENS = [[1, 151], [152, 251], [252, 386], [387, 493], [494, 649], [650, 721], [722, 809], [810, 905], [906, 1010]];
      const TYPES = ["normal", "fire", "water", "grass", "electric", "ice", "fighting", "poison", "ground", "flying", "psychic", "bug", "rock", "ghost", "dragon", "dark", "steel", "fairy"];
      const SIL = "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/";
      container.innerHTML = `
    <div class="dex-head">
      <h2 class="dex-title">📖 Pokédex</h2>
      <button type="button" class="pkm-x dex-x" aria-label="Close Pokédex" title="Close (Esc)">✕</button>
    </div>
    <div class="dex-progress" aria-live="polite">
      <div class="dex-progress-bar"><span></span></div>
      <div class="dex-progress-txt"><span class="dex-caught">Loading…</span><span class="dex-shown"></span></div>
    </div>
    <div class="dex-extra"></div>
    <div class="dex-filters">
      <input type="search" class="dex-search" placeholder="Search name or #..." aria-label="Search Pokédex" />
      <select class="dex-f-status" aria-label="Caught filter"><option value="">All</option><option value="caught">Caught</option><option value="missing">Not caught</option></select>
      <select class="dex-f-type" aria-label="Type filter" title="Types are only known for Pokémon you've caught"><option value="">Any type</option>${TYPES.map((t) => `<option value="${t}">${t[0].toUpperCase() + t.slice(1)}</option>`).join("")}</select>
      <select class="dex-f-gen" aria-label="Generation filter"><option value="">All gens</option>${GENS.map((g, i) => `<option value="${i + 1}">Gen ${i + 1} (#${g[0]}–${g[1]})</option>`).join("")}</select>
    </div>
    <div class="dex-grid"><div class="dex-empty">Loading Pokédex…</div></div>
    <div class="dex-footer"></div>
  `;
      const $ = (s) => container.querySelector(s);
      const dexGrid = $(".dex-grid");
      const byName = new Map(this.entries.map((e) => [String(e.name).toLowerCase(), e]));
      const genOf = (id) => GENS.findIndex(([a, b]) => id >= a && id <= b) + 1;
      $(".dex-x").onclick = () => closePokedex();
      pkmDexExtra($(".dex-extra"));

      // The 1010-name list comes from the PokeAPI cache (refreshed once a day)
      pkmFetch("https://pokeapi.co/api/v2/pokemon?limit=1010")
        .then((res) => res.json())
        .then((data) => {
          if (!dexGrid.isConnected) return;
          const total = data.results.length;
          let caught = 0;
          const meta = [];
          const html = data.results.map((poke, index) => {
            const id = index + 1;
            const own = byName.get(poke.name);
            if (own) caught++;
            const types = own && Array.isArray(own.types) ? own.types.map((t) => String((t && t.type && t.type.name) || t).toLowerCase()) : [];
            meta.push({ id, name: poke.name, own, types, gen: genOf(id) });
            // Unknown Pokémon show as a black silhouette of the real sprite
            const sprite = (own && own.spriteUrl) || `${SIL}${id}.png`;
            const label = own ? pkmEsc(own.name) : "Unknown Pokémon";
            return `<div class="dex-entry ${own ? "owned" : "missing"}" data-i="${index}" tabindex="0" role="button" aria-label="${label}, number ${id}">
          <div class="dex-number">#${id}</div>
          <div class="dex-sprite"><img src="${pkmEsc(sprite)}" alt="" loading="lazy" decoding="async"/></div>
          <div class="dex-name">${own ? pkmEsc(own.name) : "???"}</div></div>`;
          });
          dexGrid.innerHTML = html.join("") + `<div class="dex-empty" hidden>No Pokémon match these filters.</div>`;
          const pct = total ? (caught / total) * 100 : 0;
          $(".dex-progress-bar span").style.width = pct.toFixed(1) + "%";
          $(".dex-caught").textContent = `Caught ${caught} / ${total} (${pct.toFixed(1)}%)`;

          const cards = [...dexGrid.querySelectorAll(".dex-entry")];
          const empty = dexGrid.querySelector(".dex-empty");
          const apply = () => {
            const q = $(".dex-search").value.trim().toLowerCase().replace(/^#/, "");
            const st = $(".dex-f-status").value;
            const ty = $(".dex-f-type").value;
            const gen = +$(".dex-f-gen").value || 0;
            const isNum = /^\d+$/.test(q);
            let shown = 0;
            cards.forEach((card, i) => {
              const m = meta[i];
              // Names of uncaught Pokémon stay secret: they only match by number
              const okQ = !q || (isNum ? String(m.id).startsWith(q) : !!m.own && m.name.includes(q));
              const ok = okQ && (!st || (st === "caught") === !!m.own) && (!ty || m.types.includes(ty)) && (!gen || m.gen === gen);
              card.hidden = !ok;
              if (ok) shown++;
            });
            empty.hidden = shown > 0;
            $(".dex-shown").textContent = shown === total ? "" : `Showing ${shown}`;
          };
          const openCard = (card) => {
            const m = meta[+card.dataset.i];
            pkmOpenDexEntry(m.id, m.name, !!m.own);
          };
          dexGrid.onclick = (e) => { const c = e.target.closest(".dex-entry"); if (c) openCard(c); };
          dexGrid.onkeydown = (e) => {
            if ((e.key === "Enter" || e.key === " ") && e.target.classList.contains("dex-entry")) { e.preventDefault(); openCard(e.target); }
          };
          const filters = $(".dex-filters");
          filters.addEventListener("input", apply);
          filters.addEventListener("change", apply);
          apply();
        })
        .catch((err) => {
          dexGrid.innerHTML = `<div class="dex-empty">Couldn't load the Pokédex list (${pkmEsc((err && err.message) || err)}). Try again later.</div>`;
        });

      $(".dex-footer").appendChild(createButton("Close Pokédex", closePokedex, "btn btn-light mt-3 w-100"));
    }
    getOwnedCount() {
      return this.entries.length;
    }

    getCompletionRate(total = 1010) {
      return ((this.getOwnedCount() / total) * 100).toFixed(2) + "%";
    }

    hasPokemon(name) {
      return this.entries.some(
        (e) => e.name.toLowerCase() === name.toLowerCase()
      );
    }

    getEntry(name) {
      return (
        this.entries.find((e) => e.name.toLowerCase() === name.toLowerCase()) ||
        null
      );
    }

    listAllOwned() {
      return this.entries.map((e) => e.name);
    }
  }

  // panel handle
  let pokedexPanel = null;
  async function openPokedex() {
    if (pokedexPanel) return;
    pokedexPanel = document.createElement("div");
    Object.assign(pokedexPanel.style, {
      position: "fixed",
      top: "50%",
      left: "50%",
      transform: "translate(-50%,-50%)",
      background: "#222",
      color: "#fff",
      padding: "12px",
      border: "2px solid #fff",
      zIndex: 10000,
      width: "min(860px, 96vw)",
      height: "min(92vh, 1000px)",
      display: "flex",
      flexDirection: "column",
      overflow: "hidden",
      borderRadius: "12px",
      boxShadow: "0 20px 60px rgba(0,0,0,.5)",
    });
    pokedexPanel.classList.add("pkm-dex-panel");
    pkmMount(pokedexPanel);
    const dex = await Pokedex.load();
    dex.render(pokedexPanel);
  }
  function closePokedex() {
    if (!pokedexPanel) return;
    pokedexPanel.remove();
    pokedexPanel = null;
    renderHeader();
  }

  // --- UI and rendering ---
  Object.assign(wrap.style, {
    position: "fixed",
    bottom: "0",
    left: "0",
    color: "#fff",
    padding: "8px",
    fontFamily: "sans-serif",
    fontSize: "14px",
    zIndex: "9999",
    display: "flex",
    flexDirection: "column",
    gap: "4px",
  });
  wrap.className = "pkm-hud";
  if (getBool("pkm_hud_hidden")) wrap.classList.add("pkm-hud-hidden");

  pkmMount(wrap);
  makeDraggable(wrap);
  function makeDraggable(el, storageKey = "pkm_wrap_pos") {
    // Restore saved position (if any)
    const saved = getStr(storageKey, "");
    if (saved) {
      try {
        const { x, y } = JSON.parse(saved);
        el.style.left = x + "px";
        el.style.bottom = "";
        el.style.top = y + "px";
        el.style.position = "fixed";
      } catch {}
      // A position saved on a bigger screen could leave the HUD off-screen: pull it back in.
      requestAnimationFrame(() => pkmClampHud());
    }

    // Ensure a persistent BODY container for content that renderHeader() will manage
    let body = el.querySelector("[data-hud-body]");
    if (!body) {
      body = document.createElement("div");
      body.setAttribute("data-hud-body", "");
      el.appendChild(body);
    }

    // Insert a slim titlebar (persistent, not wiped by renderHeader)
    let bar = el.querySelector("[data-hud-bar]");
    if (!bar) {
      bar = document.createElement("div");
      bar.setAttribute("data-hud-bar", "");
      bar.innerHTML =
        '<span class="pkm-bar-title">≡ Pokémon</span>' +
        '<button type="button" class="pkm-bar-btn" data-hud="mute" title="Sound on/off" aria-label="Sound on or off">🔊</button>' +
        '<button type="button" class="pkm-bar-btn" data-hud="reset" title="Reset position" aria-label="Reset HUD position">⟲</button>' +
        '<button type="button" class="pkm-bar-btn" data-hud="min" title="Hide HUD (the Poké Ball on the left brings it back)" aria-label="Hide HUD">▁</button>';
      bar.addEventListener("click", (e) => {
        const a = e.target.closest("[data-hud]")?.dataset.hud;
        if (a === "min") pkmSetHudHidden(true, true);
        if (a === "reset") pkmResetHud();
        if (a === "mute") pkmToggleMute();
      });
      Object.assign(bar.style, {
        cursor: "move",
        background: "#0008",
        color: "#fff",
        padding: "2px 6px",
        fontSize: "12px",
        userSelect: "none",
      });
      el.insertBefore(bar, body);
    }

    // Drag logic
    let dragging = false,
      offX = 0,
      offY = 0;
    function down(e) {
      if (e.target.closest && e.target.closest("button")) return;
      dragging = true;
      const r = el.getBoundingClientRect();
      offX = (e.touches?.[0]?.clientX ?? e.clientX) - r.left;
      offY = (e.touches?.[0]?.clientY ?? e.clientY) - r.top;
      e.preventDefault();
    }
    function move(e) {
      if (!dragging) return;
      const x = (e.touches?.[0]?.clientX ?? e.clientX) - offX;
      const y = (e.touches?.[0]?.clientY ?? e.clientY) - offY;
      el.style.left =
        Math.max(0, Math.min(window.innerWidth - el.offsetWidth, x)) + "px";
      el.style.top =
        Math.max(0, Math.min(window.innerHeight - el.offsetHeight, y)) + "px";
      el.style.bottom = "";
      el.style.position = "fixed";
    }
    function up() {
      if (!dragging) return;
      dragging = false;
      setStr(
        storageKey,
        JSON.stringify({
          x: parseInt(el.style.left) || 0,
          y: parseInt(el.style.top) || 0,
        })
      );
    }

    bar.addEventListener("mousedown", down);
    bar.addEventListener("touchstart", down, { passive: false });
    window.addEventListener("mousemove", move);
    window.addEventListener("touchmove", move, { passive: false });
    window.addEventListener("mouseup", up);
    window.addEventListener("touchend", up);
  }

  function createButton(label, onClick, customClass = "", hasUpdate = false) {
    const btn = document.createElement("button");
    btn.className = customClass;
    btn.style.border = "1px solid black";
    btn.style.padding = "4px 8px";
    btn.style.color = "black";
    btn.onclick = onClick;

    // Wrap label in a span so we can attach badge
    const span = document.createElement("span");
    span.textContent = label;
    btn.appendChild(span);

    // Add badge if update is available
    if (hasUpdate) {
      const badge = document.createElement("span");
      badge.className =
        "badge rounded-pill bg-danger top-0 translate-middle position-relative";
      badge.textContent = "!"; // or "?" or number
      btn.appendChild(badge);
    }

    return btn;
  }
  const XP_CURVE = "smooth"; // 'linear' | 'smooth' | 'fast' | 'slow' | 'mediumFast'
  const XP_SCALE = 25; // global multiplier (raise to require more XP)
  function xpThreshold(level) {
    const L = Math.max(1, level | 0);

    switch (XP_CURVE) {
      case "linear":
        // ~ your old 50 + 25*L
        return Math.max(1, 50 + 25 * L);

      case "fast":
        // gentler growth
        return Math.max(1, Math.round(30 + XP_SCALE * Math.pow(L, 1.2)));

      case "slow":
        // steeper growth
        return Math.max(1, Math.round(60 + XP_SCALE * Math.pow(L, 1.6)));

      case "mediumFast":
        // Pokémon-style "medium fast": total XP ≈ n^3. Per-level increment is Δ(n^3) = 3n^2+3n+1.
        // Scaled so numbers stay in your existing range.
        return Math.max(
          1,
          Math.round((3 * L * L + 3 * L + 1) * (XP_SCALE / 2))
        );

      case "smooth":
      default:
        // Nice S-curve feel; default
        return Math.max(1, Math.round(40 + XP_SCALE * Math.pow(L, 1.4)));
    }
  }

  /** Progress helper for HUD bars (level-local). */
  function xpProgress(level, xpInLevel) {
    const need = xpThreshold(level);
    const have = Math.max(0, Math.min(need, Number(xpInLevel) || 0));
    const pct = Math.min(100, Math.round((have / need) * 100));
    return { need, have, pct };
  }
  /**
   * Give XP to the ACTIVE Pokémon (the same per-instance stats the HUD and battles use).
   * It used to write to species stats, so the HUD's XP bar never moved after a win.
   */
  function addXP(name, amount, { autoLevel = true } = {}) {
    const s = activeStats();
    s.level = Math.min(MAX_LEVEL, Math.max(1, Number(s.level) || 1));
    s.xp = Math.max(0, Number(s.xp) || 0);
    let gained = Math.max(0, Math.floor(Number(amount) || 0));
    let leveled = 0;
    if (autoLevel) {
      while (gained > 0 && s.level < MAX_LEVEL) {
        const space = Math.max(0, xpThreshold(s.level) - s.xp);
        if (gained < space) { s.xp += gained; gained = 0; break; }
        gained -= space;
        s.level += 1;
        leveled += 1;
        s.xp = 0;
        // HP / ATK are recalculated from the species' base stats (pkmSyncStats) like the games
      }
    }
    if (s.level >= MAX_LEVEL || !autoLevel) s.xp = Math.min(xpThreshold(s.level), s.xp + gained);
    setActiveStats(s);
    if (leveled) {
      const nm = partnerName || name || "Your partner";
      pkmToast(`🎉 ${nm} grew to Lv ${s.level}!`, 3500);
      playSound("level");
      pkmReact("happy");
      const aid = GM_getValue("pkm_starter_id");
      const amon = (getObj(STORAGE.party) || {})[aid];
      pkmSyncStats(aid, amon ? amon.name : name).then(() => { evolvePartner(); pkmCheckAch(); });
    }
    const prog = xpProgress(s.level, s.xp);
    pkmLiveRefresh();
    return { leveled, newLevel: s.level, xpInLevel: s.xp, need: prog.need, pct: prog.pct };
  }
  /** Set a Pokémon's XP to the maximum for its current level (fills the bar). */
  function setXPToMax(name) {
    const s = activeStats();
    const need = xpThreshold(s.level);
    const before = Number(s.xp) || 0;
    s.xp = need;
    setActiveStats(s);
    return Math.max(0, need - before); // amount filled
  }
  async function renderHeader() {
    const root = wrap.querySelector("[data-hud-body]") || wrap;
    root.innerHTML = "";

    // --- Active Pokémon lookup ---
    const starterId = GM_getValue("pkm_starter_id");
    const party = getObj(STORAGE.party) || {};
    const starterEntry = starterId ? party[starterId] : null;
    console.log(starterEntry);

    // ✅ Determine current Pokémon name
    const name = starterEntry?.name || getStr(STORAGE.starter) || null;

    // --- Fetch stats ---
    let stats;
    if (starterId && starterEntry) {
      // ✅ Load instance stats first
      stats = getStatsForInstance(starterId, starterEntry.name);

      console.log(
        "Stats for instance: " +
          starterId +
          " Stats: " +
          JSON.stringify(stats, null, 2)
      );
    } else if (name) {
      // 🧩 Legacy fallback
      stats = getStats(name);
    } else {
      // ❌ No Pokémon found — show empty UI
      stats = { xp: 0, level: 1, hp: 100, atk: 15, currentHP: 100 };
    }
    function getMaxLevel(currentLevel) {
      return Math.min(MAX_LEVEL, currentLevel || 1);
    }
    // --- Safe defaults and clamping ---
    const lvl = Math.max(1, getMaxLevel(stats.level) ?? 1);

    let xp = stats.xp ?? 0;
    const maxHp = Math.max(1, stats.hp ?? 100);
    const curHp = Math.min(maxHp, stats.currentHP ?? maxHp);
    const atk = stats.atk ?? 15;

    // ✅ Prevent NaN in progress calculations
    let { need: nextXp, pct: xpPct } = xpProgress(lvl, xp);
    if (lvl >= MAX_LEVEL) {
      xp = nextXp;
    }
    // --- Partner card: sprite, name, HP and XP ---
    const cap1 = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
    const sprite = partnerSpriteUrl || (spriteEl && spriteEl.src) || "";
    const hpPct = Math.round((curHp / maxHp) * 100);
    const top = document.createElement("div");
    top.className = "pkm-hud-top";
    top.innerHTML = `
      <div class="pkm-hud-avatar">${sprite ? `<img src="${pkmEsc(sprite)}" alt="">` : "❔"}</div>
      <div class="pkm-hud-main">
        <div class="pkm-hud-name" id="pkm-partner">${
          name ? `${pkmEsc(cap1(name))} <span class="pkm-hud-sub">Lv ${lvl} · ATK ${atk}</span>` : "Choose your starter!"
        }</div>
        <div class="pkm-hud-bars">
          <div><small id="pkm-hp-label">HP: ${curHp}/${maxHp}</small>
            <div id="pkm-hp-bar" class="progress"><div class="progress-bar bg-danger" role="progressbar" style="width:${hpPct}%" aria-valuenow="${hpPct}" aria-valuemin="0" aria-valuemax="100"></div></div></div>
          <div><small id="pkm-xp-label">XP: ${xp}/${nextXp}</small>
            <div class="progress"><div class="progress-bar bg-info" role="progressbar" style="width:${xpPct}%" aria-valuenow="${xpPct}" aria-valuemin="0" aria-valuemax="100"></div></div></div>
        </div>
      </div>`;

    // --- Items and timers ---
    const chips = document.createElement("div");
    chips.className = "pkm-hud-chips";
    chips.innerHTML = `
      <span class="pkm-chip" id="pk-header-coins">💰 Coins: ${getInt(STORAGE.coins)}</span>
      <span class="pkm-chip" title="Poké Balls">⭕ ${getInt(STORAGE.balls)}</span>
      <span class="pkm-chip" title="Potions">💉 ${getInt(STORAGE.potions)}</span>
      <span class="pkm-chip" id="nextBattleStatus">Next Battle: —</span>
      <span class="pkm-chip" id="pokeStopStatus">PokéStop</span>${pkmEventChip()}`;

    // --- Icon buttons ---
    const grid = document.createElement("div");
    grid.className = "pkm-hud-grid";
    const hb = (ico, label, fn, title) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "pkm-hud-btn";
      b.innerHTML = `<span class="ico" aria-hidden="true">${ico}</span><span>${label}</span>`;
      b.title = title || label;
      b.onclick = () => fn();
      return b;
    };
    const setBtn = hb("⚙️", "Settings", () => openSettings());
    grid.append(
      hb("⚔️", "Battle", () => openBattle(), "Start a wild battle"),
      hb("🧢", "Trainer", () => pkmOpenTrainers(), "Trainer battles and Gym Leaders"),
      hb("❤️", "Center", () => pokeCenter(), `Pokémon Center: heal your party (${POKE_CENTER_COST} coins)`),
      hb("📍", "PokéStop", () => openPokeStop(), "Collect PokéStop rewards"),
      hb("🛒", "Shop", () => openShop()),
      hb("🎒", "Bag", () => openBag(), "Party & storage"),
      hb("📖", "Pokédex", () => openPokedex()),
      hb("🏅", "Card", () => pkmOpenBadges(), "Trainer card: daily quests, badges, achievements, weekly stats, Hall of Fame"),
      setBtn,
      hb("🐞", "Debug", () => openDebugPanel(), "Logs and save tools")
    );
    root.append(top, chips, grid);

    updater
      .needsUpdate()
      .then((u) => {
        if (!u) return;
        const d = document.createElement("span");
        d.className = "pkm-dot";
        d.title = "Update available";
        setBtn.appendChild(d);
      })
      .catch(() => {});

    updatePokeStopTimer();
    updateNextBattleTimer();
  }
  function updateHeaderHP() {
    const hpLabel = PKM.querySelector("#pkm-hp-label");
    const hpBar = PKM.querySelector("#pkm-hp-bar");
    if (!GM_getValue("pkm_starter_id") && !getStr(STORAGE.starter)) return;
    const stats = activeStats(); // same per-Pokémon stats the battle uses
    const maxHp = stats.hp;
    const curHp = stats.currentHP != null ? stats.currentHP : maxHp;
    console.log("your current HP is: " + curHp);
    const hpPct = Math.round((curHp / maxHp) * 100);
    if (hpLabel) hpLabel.textContent = `HP: ${curHp}/${maxHp}`;
    if (hpBar)
      hpBar.innerHTML = `
    <div class="progress-bar bg-danger"
         role="progressbar"
         style="width: ${hpPct}%;"
         aria-valuenow="${hpPct}"
         aria-valuemin="0"
          aria-valuemax="100"></div>
  `;
  }
  // --- Partner setup ---
  async function initPartner() {
    // 1️⃣ Always migrate first
    await migratePartyToInstancesIfNeeded();

    // 2️⃣ Reload updated party
    const party = getObj(STORAGE.party) || {};
    const starterId = GM_getValue("pkm_starter_id");

    // 3️⃣ Load active Pokémon if instance ID exists
    if (starterId && party[starterId]) {
      const entry = party[starterId];
      console.log(
        `🎮 Loading active Pokémon: ${entry.name} (#${starterId.slice(-6)})`
      );
      await fetchPartner(starterId); // ✅ Use ID
      return;
    }

    // 4️⃣ Fallback: handle legacy starter name
    const legacyStarter = getStr(STORAGE.starter);
    if (legacyStarter) {
      const found = Object.entries(party).find(
        ([, p]) => p.name?.toLowerCase() === legacyStarter.toLowerCase()
      );
      if (found) {
        const [id, entry] = found;
        GM_setValue("pkm_starter_id", id);
        console.log(`🕹️ Migrated legacy starter: ${legacyStarter} → ${id}`);
        await fetchPartner(id);
        return;
      }
    }

    // 5️⃣ No Pokémon found — open starter selection
    console.log("🔰 No active Pokémon found. Opening starter menu...");
    renderHeader();
    setTimeout(openStarter, 300);
  }

  function updatePokeStopTimer() {
    const status = PKM.querySelector("#pokeStopStatus");
    if (!status) return;

    const psCd = getInt(STORAGE.pokestopCooldown);
    let text = "";
    if (psCd > Date.now()) {
      const r = psCd - Date.now();
      text = `PokéStop: ${Math.floor(r / 60000)}m ${Math.floor(
        (r % 60000) / 1000
      )}s`;
    } else {
      text = "PokéStop: Ready!";
    }
    status.textContent = text;
  }
  function updateNextBattleTimer() {
    const el = PKM.querySelector("#nextBattleStatus");
    if (!el) return;

    if (randomBattleEnabled && nextBattleTime) {
      const d = Math.max(0, nextBattleTime - Date.now());
      el.textContent = `Next Battle: ${Math.floor(d / 60000)}m ${Math.floor(
        (d % 60000) / 1000
      )}s`;
    } else {
      el.textContent = "Next Battle: —";
    }
  }

  let detailPanel = null;
  function openDetail(p) {
    if (detailPanel) return;

    detailPanel = document.createElement("div");
    detailPanel.className = "pokedex-detail";
    detailPanel.innerHTML = `
    <button class="detail-close" aria-label="Close">✕</button>
    <h3 class="detail-title">${p.name} <small>#${p.id}</small></h3>
    <img src="${p.spriteBlobUrl || p.spriteUrl}" class="detail-sprite" alt="${
      p.name
    }"/>
    <div class="detail-section">
      <div><strong>Level:</strong> ${p.level}</div>
      <div><strong>XP:</strong> ${p.xp} / ${p.level * 100}</div>
      <div><strong>HP:</strong> ${p.currentHP} / ${p.maxHp}</div>
    </div>
    <div class="detail-section">
      <div><strong>Types:</strong> ${(p.types || []).join(", ")}</div>
      <div><strong>Abilities:</strong> ${(p.abilities || []).join(", ") || "—"}</div>
    </div>
    <table class="detail-stats">
      <thead><tr><th>Stat</th><th>Base</th></tr></thead>
      <tbody>
        ${(p.stats || [])
          .map((s) => `<tr><td>${s.name}</td><td>${s.value}</td></tr>`)
          .join("")}
      </tbody>
    </table>
    <button class="btn btn-danger w-100 mt-3" id="closeDetail">Close</button>
  `;
    pkmMount(detailPanel);

    const close = () => {
      detailPanel.remove();
      detailPanel = null;
    };
    detailPanel.querySelector("#closeDetail").onclick = close;
    detailPanel.querySelector(".detail-close").onclick = close;
  }

  function toggleRandomBattles() {
    randomBattleEnabled = !randomBattleEnabled;
    setBool("pkm_random_battles", randomBattleEnabled);
    if (randomBattleEnabled) {
      scheduleRandomBattle();
      pkmToast("Random battles enabled!");
    } else {
      clearTimeout(randomBattleTimer);
      pkmToast("Random battles disabled!");
    }
    renderSettings(); // Refresh UI
  }
  function scheduleRandomBattle() {
    if (!randomBattleEnabled) return;
    const delay = (60 + Math.random() * 540) * 1000; // 1–10 min
    nextBattleTime = Date.now() + delay;

    randomBattleTimer = setTimeout(() => {
      // Don't pop a battle over another open panel, while typing, or in a background tab
      if (randomBattleEnabled && !pkmOpenPanel() && !pkmTyping && !document.hidden) openBattle({ auto: true });
      scheduleRandomBattle(); // Schedule next
    }, delay);
  }
  async function fetchPartner(identifier) {
    if (!identifier) return;

    const party = getObj(STORAGE.party) || {};
    let id = identifier;
    let name = null;

    // 🧠 Determine if identifier is ID or name
    if (!party[id]) {
      const match = Object.entries(party).find(
        ([, entry]) => entry.name?.toLowerCase() === identifier.toLowerCase()
      );
      if (match) {
        id = match[0];
        name = match[1].name;
      } else {
        name = identifier; // still fallback
      }
    } else {
      name = party[id].name;
    }
    console.log(id);
    // 💾 Remember current active Pokémon instance
    GM_setValue("pkm_starter_id", id);
    setStr(STORAGE.starter, id);

    starterName = name;
    partnerName = name[0].toUpperCase() + name.slice(1);

    // Normalize sprite name
    const rawName = name.toLowerCase().replace("shiny ", "");
    const fixedName = SPRITE_NAME_FIXES[rawName] || rawName;

    const pokedex = getArr(STORAGE.pokedex);
    let dexEntry = pokedex.find((p) => p.name.toLowerCase() === fixedName);

    // ✅ Choose best available sprite
    const showdownGif = `https://play.pokemonshowdown.com/sprites/ani/${fixedName}.gif`;
    const bwGif = `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/versions/generation-v/black-white/animated/${fixedName}.gif`;
    const staticPng = `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${fixedName}.png`;

    partnerSpriteUrl = dexEntry?.spriteUrl || showdownGif;
    if (!(await imageExists(partnerSpriteUrl))) {
      partnerSpriteUrl = (await imageExists(bwGif)) ? bwGif : staticPng;
    }

    // ✅ Load per-instance stats
    let currentStats = getStatsForInstance(id, name);

    const missingCoreStats = [
      "hp",
      "atk",
      "def",
      "spAtk",
      "spDef",
      "speed",
    ].some((k) => currentStats[k] == null);

    // ✅ Fetch PokéAPI stats if missing
    if (missingCoreStats) {
      console.log(`📡 Fetching ${name} stats from PokéAPI (missing data)...`);

      await new Promise((resolve) => {
        pkmXhr({
          method: "GET",
          url: `https://pokeapi.co/api/v2/pokemon/${encodeURIComponent(
            fixedName
          )}`,
          onload: (res) => {
            try {
              const d = JSON.parse(res.responseText);
              const partial = extractStatsFromPokeApi(d);

              // Merge without losing currentHP or XP
              const merged = { ...currentStats };
              for (const k in partial) {
                if (merged[k] == null) merged[k] = partial[k];
              }

              // Clamp HP if it changed
              if (partial.hp) {
                merged.currentHP = Math.min(
                  merged.currentHP ?? partial.hp,
                  partial.hp
                );
                merged.hp = partial.hp;
              }

              setStatsForInstance(id, merged);

              // ✅ Update Pokédex entry
              const entry = {
                id: d.id,
                name: d.name[0].toUpperCase() + d.name.slice(1),
                spriteUrl: d.sprites.front_default || partnerSpriteUrl,
                types: partial.types || [],
                abilities: partial.abilities || [],
                stats: d.stats.map((s) => ({
                  name: s.stat.name,
                  value: s.base_stat,
                })),
                hp: partial.hp,
                level: merged.level || 1,
                xp: merged.xp || 0,
                currentHP: merged.currentHP,
              };

              recordPokedex(entry);
              dexEntry = entry;
              partnerSpriteUrl = entry.spriteUrl;
            } catch (err) {
              console.error("❌ Failed to parse PokéAPI:", err);
            }
            resolve();
          },
          onerror: (err) => {
            console.error("❌ Failed to fetch partner:", err);
            resolve();
          },
        });
      });
    } else {
      console.log(`✅ Loaded ${name} from storage (no API call needed).`);
    }

    // Real stats from base stats + level (like the games)
    await pkmSyncStats(id, name);
    // ✅ Render UI for current partner
    renderHeader();
    spawnWalkingSprite(partnerSpriteUrl);
  }

  function extractStatsFromPokeApi(d) {
    if (!d || !Array.isArray(d.stats)) return {};

    const get = (n) => {
      const v = d.stats.find((s) => s?.stat?.name === n)?.base_stat;
      return Number.isFinite(v) ? Number(v) : undefined;
    };

    const partial = {};
    if (get("hp") !== undefined) partial.hp = get("hp");
    if (get("attack") !== undefined) partial.atk = get("attack");
    if (get("defense") !== undefined) partial.def = get("defense");
    if (get("special-attack") !== undefined)
      partial.spAtk = get("special-attack");
    if (get("special-defense") !== undefined)
      partial.spDef = get("special-defense");
    if (get("speed") !== undefined) partial.speed = get("speed");

    // optional extras
    if (d.types) partial.types = d.types.map((t) => t.type.name);
    if (d.abilities) partial.abilities = d.abilities.map((a) => a.ability.name);

    return partial; // may be empty if API had nothing
  }

  function mergeStatsPartial(name, partial) {
    const key = String(name || "").toLowerCase();
    const old = getStats(key) || {
      level: 1,
      xp: 0,
      hp: 100,
      atk: 15,
      currentHP: 100,
    };

    const out = { ...old };

    // Only replace values if present in partial
    for (const k of Object.keys(partial)) {
      out[k] = partial[k];
    }

    // Clamp currentHP if hp changed
    if (partial.hp !== undefined) {
      if (out.currentHP == null) out.currentHP = out.hp;
      out.currentHP = Math.min(out.hp, out.currentHP);
    }

    setStats(key, out);
    return out;
  }

  function imageExists(url) {
    return new Promise((resolve) => {
      pkmXhr({
        method: "HEAD",
        url,
        onload: (res) => resolve(res.status >= 200 && res.status < 300),
        onerror: () => resolve(false),
      });
    });
  }

  // --- Walking sprite ---

  let spriteWrapperEl = null;
  let hpFillEl = null;
  let currentHP = 0;
  let maxHP = 100;
  function spawnWalkingSprite(spriteUrl) {
    // Clean up existing
    if (spriteWrapperEl) spriteWrapperEl.remove();
    if (walkInterval) clearInterval(walkInterval);

    const wrapper = document.createElement("div");
    wrapper.className = "pkm-partner";
    spriteWrapperEl = wrapper;

    const starterId = GM_getValue("pkm_starter_id");
    const party = getObj(STORAGE.party) || {};
    const starter = party[starterId];
    const starterName = starter.name;
    const stats =
      getStatsForInstance(starterId, starterName) || getStats(partnerName);

    currentHP = stats.currentHP || 0;
    maxHP = stats.hp || 100;

    // Wrapper
    Object.assign(wrapper.style, {
      position: "fixed",
      bottom: "64px",
      left: "0px",
      width: "64px",
      zIndex: "9999",
      pointerEvents: "none",
      overflow: "visible",
    });

    // Inner container (flips)
    const inner = document.createElement("div");
    Object.assign(inner.style, {
      position: "relative",
      width: "64px",
      height: "80px",
    });

    // HP bar wrapper
    const progressWrapper = document.createElement("div");
    Object.assign(progressWrapper.style, {
      position: "absolute",
      top: "-12px",
      left: "8px",
      width: "48px",
      height: "6px",
      backgroundColor: "#333",
      border: "1px solid #888",
      borderRadius: "3px",
      overflow: "hidden",
      transform: "scaleX(1)",
    });

    // HP fill (animate this!)
    hpFillEl = document.createElement("div");
    const hpPercent = Math.max(0, Math.min(100, (currentHP / maxHP) * 100));
    Object.assign(hpFillEl.style, {
      width: `${hpPercent}%`,
      height: "100%",
      backgroundColor:
        hpPercent > 50 ? "#4caf50" : hpPercent > 25 ? "#ff9800" : "#f44336",
      transition: "width 0.5s ease-in-out",
    });

    progressWrapper.appendChild(hpFillEl);

    // Sprite image
    spriteEl = document.createElement("img");
    spriteEl.id = "pkm-partner-sprite";
    spriteEl.src = spriteUrl;
    spriteEl.alt = partnerName || "partner";
    Object.assign(spriteEl.style, {
      width: "64px",
      height: "64px",
      imageRendering: "pixelated",
      animation: "bobWalk 0.6s infinite",
      display: "block",
      marginTop: "16px",
    });

    inner.appendChild(progressWrapper);
    inner.appendChild(spriteEl);
    if (starter && starter.costume) {
      const cos = document.createElement("span");
      cos.className = "pkm-costume";
      cos.textContent = starter.costume;
      inner.appendChild(cos);
    }
    wrapper.appendChild(inner);
    pkmMount(wrapper);

    // Walk animation
    let posX = 0;
    let dir = 1;
    const speed = 2;

    // Reduced motion (Windows "Animation effects" off): partner sits still in the corner.
    if (pkmReducedMotion()) {
      wrapper.style.left = "8px";
      spriteEl.style.animation = "none";
      return;
    }
    walkInterval = setInterval(() => {
      if (document.hidden || pkmNapping) return; // no work in background tabs, or while napping
      const maxX = window.innerWidth - 64;
      posX += dir * speed;

      if (posX >= maxX) {
        posX = maxX;
        dir = -1;
      } else if (posX <= 0) {
        posX = 0;
        dir = 1;
      }

      wrapper.style.left = `${posX}px`;
      inner.style.transform = `scaleX(${dir === 1 ? -1 : 1})`;
      progressWrapper.style.transform = "scaleX(1)"; // keep HP bar forward
    }, 30);
  }

  function setHP(newHP) {
    const clamped = Math.max(0, Math.min(maxHP, newHP));
    const diff = clamped - currentHP;
    if (diff !== 0) {
      showFloatingHPChange(diff);
    }

    currentHP = clamped;
    const percent = (currentHP / maxHP) * 100;

    if (hpFillEl) {
      hpFillEl.style.width = `${percent}%`;
      hpFillEl.style.backgroundColor =
        percent > 50 ? "#4caf50" : percent > 25 ? "#ff9800" : "#f44336";
    }
  }

  function showFloatingHPChange(amount) {
    const floatText = document.createElement("div");
    floatText.innerText = amount > 0 ? `+${amount}` : `${amount}`;

    // Style it
    Object.assign(floatText.style, {
      position: "absolute",
      top: "-28px",
      left: "0px",
      width: "64px",
      textAlign: "center",
      fontWeight: "bold",
      fontSize: "14px",
      fontFamily: "monospace",
      color: amount > 0 ? "#00ff66" : "#ff4444",
      textShadow: "0 0 2px black, 1px 1px 2px black",
      pointerEvents: "none",
      opacity: "1",
      transform: "translateY(0)",
      zIndex: "10000",
      transition: "transform 1s ease-out, opacity 1s ease-out",
    });

    // Append it FIRST, then trigger animation
    spriteWrapperEl?.appendChild(floatText);

    // Delay the animation trigger to ensure browser registers initial styles
    setTimeout(() => {
      floatText.style.transform = "translateY(-30px)";
      floatText.style.opacity = "0";
    }, 50); // 1 frame (~16ms) might work, but 50ms is safer

    // Remove after animation completes
    setTimeout(() => {
      floatText.remove();
    }, 1050);
  }
  // === Function to update old data Selection ===
  async function upgradeOldPokedexEntries() {
    let raw = GM_getValue(STORAGE.pokedex, "[]");
    let entries;
    try {
      entries = JSON.parse(raw);
    } catch {
      entries = [];
    }

    // Filter entries missing abilities or stats
    const missingData = entries.filter((p) => !p.abilities || !p.stats);

    for (const entry of missingData) {
      try {
        const res = await pkmFetch(
          `https://pokeapi.co/api/v2/pokemon/${entry.name.toLowerCase()}`
        );
        const data = await res.json();

        // Patch entry
        entry.abilities = data.abilities.map((a) => a.ability.name);
        entry.stats = data.stats.map((s) => ({
          name: s.stat.name,
          value: s.base_stat,
        }));
        if (!entry.level) entry.level = 5; // Default level if missing
      } catch (err) {
        console.warn(`Failed to update ${entry.name}`, err);
      }
    }

    // Save updated entries
    GM_setValue(STORAGE.pokedex, JSON.stringify(entries));
    console.log("✅ Pokédex upgrade complete");
  }
  // The 27 starters from the main-series games (Gen 1-9). Each player is offered 3 of them, once.
  const PKM_STARTER_POOL = [
    "bulbasaur", "charmander", "squirtle", "chikorita", "cyndaquil", "totodile", "treecko", "torchic", "mudkip",
    "turtwig", "chimchar", "piplup", "snivy", "tepig", "oshawott", "chespin", "fennekin", "froakie",
    "rowlet", "litten", "popplio", "grookey", "scorbunny", "sobble", "sprigatito", "fuecoco", "quaxly",
  ];
  const PKM_STARTER_DEX = { bulbasaur: 1, charmander: 4, squirtle: 7, chikorita: 152, cyndaquil: 155, totodile: 158, treecko: 252, torchic: 255, mudkip: 258, turtwig: 387, chimchar: 390, piplup: 393, snivy: 495, tepig: 498, oshawott: 501, chespin: 650, fennekin: 653, froakie: 656, rowlet: 722, litten: 725, popplio: 728, grookey: 810, scorbunny: 813, sobble: 816, sprigatito: 906, fuecoco: 909, quaxly: 912 };
  const pkmStarterOk = (a) => Array.isArray(a) && a.length === 3 && new Set(a).size === 3 && a.every((n) => PKM_STARTER_POOL.includes(n));
  function pkmLocalTrio() {
    const pool = PKM_STARTER_POOL.slice();
    const out = [];
    while (out.length < 3) out.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
    return out;
  }
  /** The player's 3 starters. Saved on first roll so closing the menu never re-rolls. The server (if reachable) decides it by connection, so reinstalling gives the same three. */
  async function pkmGetStarterTrio() {
    let trio = null;
    try { trio = JSON.parse(GM_getValue("pkm_starter_trio", "null")); } catch {}
    if (pkmStarterOk(trio)) return { trio, chosen: "" };
    let chosen = "";
    try {
      const r = await Promise.race([pkmApi("starter_get", {}, {}), new Promise((_, rej) => setTimeout(() => rej(new Error("slow")), 6000))]);
      if (pkmStarterOk(r.trio)) { trio = r.trio; if (PKM_STARTER_POOL.includes(r.chosen)) chosen = r.chosen; }
    } catch {}
    if (!pkmStarterOk(trio)) trio = pkmLocalTrio();
    GM_setValue("pkm_starter_trio", JSON.stringify(trio));
    return { trio, chosen };
  }
  const pkmHasStarter = () => { const id = GM_getValue("pkm_starter_id"); const p = getObj(STORAGE.party) || {}; return !!(id && p[id]); };

  // === Starter Selection ===
  const pkmStarterCap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
  let starterPanel;
  async function openStarter() {
    if (starterPanel) return;
    if (pkmHasStarter()) { pkmToast("You already chose your starter. It can't be changed."); return; }
    const P = (starterPanel = document.createElement("div"));
    P.className = "pkm-panel pkm-modal pkm-set pkm-starter";
    P.setAttribute("role", "dialog");
    P.setAttribute("aria-label", "Choose your starter");
    P.innerHTML = `
      <div class="pkm-set-head st-head"><span>🔰 Choose your starter</span><button type="button" class="pkm-x" data-a="close" aria-label="Close" title="Close (Esc)">✕</button></div>
      <div class="st-body"><div class="st-grid st-three"><div class="pkm-dim st-note">Finding your starters…</div></div></div>`;
    const grid = P.querySelector(".st-grid");
    P.onclick = (e) => {
      if (e.target.closest('[data-a="close"]')) return closeStarter();
      const card = e.target.closest(".st-card");
      if (card) pickStarter(card.dataset.n);
    };
    pkmMount(P);
    const { trio, chosen } = await pkmGetStarterTrio();
    if (starterPanel !== P) return;
    if (chosen) { // this connection already picked one before (for example the script was reinstalled)
      pkmToast(`Welcome back! Your starter is ${pkmStarterCap(chosen)}.`);
      return pickStarter(chosen, true);
    }
    const SIL = "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/";
    grid.innerHTML =
      trio.map((n) => `<button type="button" class="st-card" data-n="${pkmEsc(n)}" aria-label="${pkmEsc(pkmStarterCap(n))}"><span class="st-num">#${PKM_STARTER_DEX[n]}</span><img src="${SIL}${PKM_STARTER_DEX[n]}.png" alt="" decoding="async"/><span class="st-name">${pkmEsc(pkmStarterCap(n))}</span></button>`).join("") +
      `<div class="pkm-dim st-note st-more">These three were picked for you. Your choice is final, so choose carefully.</div>`;
    grid.querySelector(".st-card")?.focus({ preventScroll: true });
  }

  let settingsPanel;
  function openSettings() {
    if (settingsPanel) return;
    settingsPanel = document.createElement("div");
    settingsPanel.className = "pkm-panel pkm-set pkm-modal";
    settingsPanel.setAttribute("role", "dialog");
    settingsPanel.setAttribute("aria-label", "Pokémon settings");
    pkmMount(settingsPanel);
    renderSettings();
  }
  function closeSettings() {
    if (settingsPanel) settingsPanel.remove();
    settingsPanel = null;
  }
  async function renderSettings() {
    const P = settingsPanel;
    if (!P) return;
    const host = location.hostname;
    const backups = pkmBackups();
    let cached = 0;
    try { cached = (JSON.parse(GM_getValue(PKM_CACHE_IDX, "[]")) || []).length; } catch {}
    const bkHtml = backups.length
      ? backups
          .map((b, i) => {
            const s = pkmSaveSummary(b.data);
            return `<div class="pkm-row"><span>${pkmEsc(new Date(b.t).toLocaleString())} <span class="pkm-dim">· ${pkmEsc(b.reason)} · 💰${s.coins} · ${s.party} Pokémon</span></span><button type="button" class="pkm-btn2" data-a="restore" data-i="${i}">Restore…</button></div>`;
          })
          .reverse()
          .join("")
      : `<div class="pkm-dim">No backups yet.</div>`;
    const sw = (a, on) => `<input type="checkbox" class="pkm-sw" data-a="${a}" ${on ? "checked" : ""}>`;
    P.innerHTML = `
      <div class="pkm-set-head"><span>⚙️ Settings</span><button type="button" class="pkm-x" data-a="close" title="Close (Esc)" aria-label="Close">✕</button></div>
      <div class="pkm-set-sec"><h4>Sound</h4>
        <label class="pkm-row"><span>Sound effects</span>${sw("sound", getBool(STORAGE.soundOn))}</label>
        <label class="pkm-row"><span>Volume</span><input type="range" min="0" max="1" step="0.01" data-a="vol" value="${pkmEsc(getStr(STORAGE.volume, "0.4"))}"></label>
      </div>
      <div class="pkm-set-sec"><h4>Game</h4>
        <label class="pkm-row"><span>Random wild battles</span>${sw("random", randomBattleEnabled)}</label>
        <div class="pkm-btns"><button type="button" class="pkm-btn2" data-a="upgradeDex">📖 Upgrade Pokédex data</button></div>
      </div>
      <div class="pkm-set-sec"><h4>Display</h4>
        <label class="pkm-row"><span>Show HUD <span class="pkm-dim">(partner keeps walking either way)</span></span>${sw("hud", !wrap.classList.contains("pkm-hud-hidden"))}</label>
        <label class="pkm-row"><span>Hide while I'm typing in a field</span>${sw("autohide", pkmAutoHideOn())}</label>
        <div class="pkm-btns"><button type="button" class="pkm-btn2" data-a="resetpos">📌 Reset HUD position</button></div>
      </div>
      <div class="pkm-set-sec"><h4>Sites</h4>
        <label class="pkm-row"><span>Play on <b>${pkmEsc(host)}</b></span>${sw("thissite", true)}</label>
        <div class="pkm-dim" style="margin:6px 0 4px">The game is off on these sites (one per line, subdomains included):</div>
        <textarea data-a="sites" spellcheck="false" aria-label="Sites where the game is off">${pkmEsc(pkmDisabledSites().join("\n"))}</textarea>
        <div class="pkm-btns" style="margin-top:6px"><button type="button" class="pkm-btn2 primary" data-a="savesites">Save list</button></div>
      </div>
      <div class="pkm-set-sec"><h4>Save data</h4>
        <div class="pkm-dim" style="margin-bottom:6px">Backed up automatically every 7 days. The last 4 backups are kept.</div>
        ${bkHtml}
        <div class="pkm-btns" style="margin-top:8px">
          <button type="button" class="pkm-btn2" data-a="backup">💾 Back up now</button>
          <button type="button" class="pkm-btn2" data-a="export">⬇️ Export file</button>
          <button type="button" class="pkm-btn2" data-a="import">⬆️ Import file…</button>
          <button type="button" class="pkm-btn2" data-a="clearcache" title="PokéAPI responses saved so battles and the Pokédex load fast">🧹 Clear cache (${cached})</button>
        </div>
      </div>
      <div class="pkm-set-sec"><h4>About</h4>
        <div class="pkm-row"><span class="pkm-upd">Checking for updates…</span></div>
        <div class="pkm-btns"><button type="button" class="pkm-btn2 danger" data-a="reset">🗑️ Reset game</button></div>
      </div>`;

    P.onclick = async (e) => {
      const el = e.target.closest("button[data-a]");
      if (!el) return;
      const a = el.dataset.a;
      if (a === "close") return closeSettings();
      if (a === "upgradeDex") {
        el.disabled = true;
        el.textContent = "Upgrading…";
        try { await upgradeOldPokedexEntries(); pkmToast("Pokédex data upgraded"); } finally { renderSettings(); }
        return;
      }
      if (a === "resetpos") { pkmResetHud(); return pkmToast("HUD moved back to the bottom-left corner"); }
      if (a === "savesites") {
        pkmSetDisabledSites(P.querySelector('textarea[data-a="sites"]').value.split(/[\s,]+/));
        pkmToast("Site list saved");
        if (pkmSiteOff()) pkmTurnOffHere(true);
        else renderSettings();
        return;
      }
      if (a === "backup") { pkmBackupNow("manual"); pkmToast("Backup saved"); return renderSettings(); }
      if (a === "restore") {
        const b = pkmBackups()[+el.dataset.i];
        if (b) pkmPreviewSave(b.data, `Backup from ${new Date(b.t).toLocaleString()} (${b.reason})`);
        return;
      }
      if (a === "export") return exportSave();
      if (a === "import") {
        const inp = document.createElement("input");
        inp.type = "file";
        inp.accept = ".json,application/json";
        inp.onchange = () => importSave(inp.files[0]);
        inp.click();
        return;
      }
      if (a === "clearcache") { const n = pkmCacheClear(); pkmToast(`Cleared ${n} cached PokéAPI responses`); return renderSettings(); }
      if (a === "reset") return resetGameData();
    };
    P.onchange = (e) => {
      const el = e.target;
      const a = el.dataset && el.dataset.a;
      if (a === "sound") {
        setBool(STORAGE.soundOn, el.checked);
        if (!el.checked) Object.values(SOUNDS).forEach((au) => { if (au instanceof Audio) { au.pause(); au.currentTime = 0; } });
      }
      if (a === "random") {
        randomBattleEnabled = el.checked;
        setBool("pkm_random_battles", el.checked);
        clearTimeout(randomBattleTimer);
        nextBattleTime = null;
        if (el.checked) scheduleRandomBattle();
        updateNextBattleTimer();
        pkmToast(el.checked ? "Random battles on" : "Random battles off");
      }
      if (a === "hud") pkmSetHudHidden(!el.checked, false);
      if (a === "autohide") { setBool("pkm_autohide_typing", el.checked); if (!el.checked) pkmSetTyping(false); }
      if (a === "thissite" && !el.checked && !pkmTurnOffHere()) el.checked = true;
    };
    P.querySelector('[data-a="vol"]').oninput = (e) => {
      const vol = parseFloat(e.target.value);
      setStr(STORAGE.volume, e.target.value);
      Object.values(SOUNDS).forEach((au) => { if (au instanceof Audio) au.volume = vol; });
    };

    // Update status (cached for 6 hours by CheckUpdate)
    const box = P.querySelector(".pkm-upd");
    try {
      const has = await updater.needsUpdate();
      if (!box.isConnected) return;
      if (has) {
        const remote = await updater.fetchRemoteVersion(cfg.DOWNLOAD_URL);
        const b = document.createElement("button");
        b.type = "button";
        b.className = "pkm-btn2 primary";
        b.textContent = `⬆️ Update available (v${remote || "?"})`;
        b.title = `Current: ${cfg.CURRENT_VERSION}`;
        b.onclick = () => window.open(cfg.DOWNLOAD_URL, "_blank");
        box.replaceChildren(b);
      } else {
        box.textContent = `✅ Up to date (v${cfg.CURRENT_VERSION})`;
      }
    } catch (err) {
      box.textContent = "⚠️ Update check failed.";
      console.warn(err);
    }
  }
  function pickStarter(name, restored) {
    if (!PKM_STARTER_POOL.includes(name) || pkmHasStarter()) return closeStarter();
    // Unique instance ID for this starter
    const id = generateUniqueId(name);
    const party = getObj(STORAGE.party) || {};
    if (!party[id]) {
      party[id] = { name, caughtAt: Date.now() };
      setObj(STORAGE.party, party);
    }
    // Set as active Pokémon (instance-based) and load it
    GM_setValue("pkm_starter_id", id);
    GM_setValue(STORAGE.starter, name);
    fetchPartner(id);
    closeStarter();
    renderHeader();
    // Tell the server so reinstalling the script gives the same starter back
    if (!restored) pkmApi("starter_pick", { species: name }, {}).catch(() => {});
  }

  function closeStarter() {
    if (starterPanel) starterPanel.remove();
    starterPanel = null;
    renderHeader();
  }

  // === CSS Animations ===
  const style = document.createElement("style");
  style.textContent = `
  @keyframes pulseBadge {
  0%,100% { transform: translateY(-50%) scale(1); }
  50%     { transform: translateY(-50%) scale(1.15); }
}
button .badge.bg-danger {
  animation: pulseBadge 1.2s infinite;
  position: relative;
  top: -2px;
  margin-left: 6px;
}
@keyframes shake {
  0% { transform: translate(1px, 0); }
  25% { transform: translate(-1px, 0); }
  50% { transform: translate(2px, 0); }
  75% { transform: translate(-2px, 0); }
  100% { transform: translate(1px, 0); }
}

@keyframes flash {
  0%, 100% { opacity: 1; }
  50% { opacity: 0; }
}

@keyframes bobWalk {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-3px); }
}

#pkm-partner-sprite {
  transform-origin: center;
}
.pixel-frame {
  border: 24px solid transparent; /* thickness of the border you want */
  border-image: url('https://raw.githubusercontent.com/D-Stokes-NC-Gaming-Studio/pokemon-tampermonkey/refs/heads/main/Windowskins/choice%20ug.png') 23 stretch;
  width: 280px;
  margin: auto;
  padding: 16px;
  color: white;
  box-sizing: content-box;
}
`;
  PKM_SHADOW.insertBefore(style, PKM);

  // === Evolution & XP ===
  function gainXP(amount) {
    const stats = activeStats();
    if (stats == null) return;
    if (stats.level > MAX_LEVEL) stats.level = MAX_LEVEL;
    if (stats.level >= MAX_LEVEL) return; // No XP gain at max level

    stats.xp += amount;
    let leveledUp = false;

    while (stats.xp >= XP_TO_LEVEL(stats.level)) {
      stats.xp -= XP_TO_LEVEL(stats.level);
      stats.level++;
      stats.hp += 10;
      stats.atk += 5;
      leveledUp = true;
      pkmToast(
        `🎉 ${partnerName} leveled up to ${stats.level}! HP and ATK increased.`
      );
    }

    setActiveStats( stats);
    if (leveledUp) evolvePartner();
    updateHeaderHP();
    renderHeader();
  }
  async function evolvePartner() {
    const starterId = GM_getValue("pkm_starter_id");
    const party = getObj(STORAGE.party) || {};
    const starter = party[starterId];

    if (!starter) {
      pkmToast("⚠️ No active Pokémon selected!");
      return;
    }

    const starterName = starter.name;
    const stats = getStatsForInstance(starterId, starterName);

    try {
      // --- Fetch species data ---
      const speciesRes = await pkmFetch(
        `https://pokeapi.co/api/v2/pokemon-species/${starterName.toLowerCase()}`
      );
      const species = await speciesRes.json();

      // --- Fetch evolution chain ---
      const evoRes = await pkmFetch(species.evolution_chain.url);
      const evoData = await evoRes.json();
      const chain = evoData.chain;

      // --- Find the current Pokémon in the chain ---
      let current = chain;
      let found = false;

      while (current && !found) {
        if (current.species.name === starterName.toLowerCase()) {
          found = true;
          break;
        }
        if (current.evolves_to.length) {
          current = current.evolves_to[0];
        } else break;
      }

      // --- Stop if final evolution ---
      if (!found || current.evolves_to.length === 0) {
        console.info(`${starterName} cannot evolve further!`);
        return;
      }

      const nextForm = current.evolves_to[0];
      const nextName = nextForm.species.name;
      const evoDetails = nextForm.evolution_details[0];

      // --- Evolve only if triggered by level-up and has a min_level ---
      if (
        evoDetails?.trigger?.name === "level-up" &&
        typeof evoDetails.min_level === "number"
      ) {
        const requiredLevel = evoDetails.min_level;

        if (stats.level >= requiredLevel) {
          console.log(`🧬 Evolution triggered! ${starterName} → ${nextName}`);

          // --- Update stats dynamically ---
          const evolvedStats = { ...stats };
          // New HP / ATK come from the evolved species' base stats (pkmSyncStats in fetchPartner)

          // --- Update the party entry (keep same ID) ---
          party[starterId].name = nextName;
          setObj(STORAGE.party, party);

          // --- Save evolved stats ---
          setStatsForInstance(starterId, evolvedStats);

          // --- Update starter and HUD ---
          GM_setValue(STORAGE.starter, nextName);
          fetchPartner(starterId);
          renderHeader();

          pkmOnEvolve();
          pkmToast(
            `✨ Your ${starterName} evolved into ${
              nextName[0].toUpperCase() + nextName.slice(1)
            }!`
          );
        } else {
          console.info(`${starterName} needs to reach Lv ${requiredLevel} to evolve.`);
        }
      } else {
        console.info(`${starterName} cannot evolve by level-up.`);
      }
    } catch (err) {
      console.error("❌ Evolution failed:", err);
      pkmToast("Evolution failed — check console for details.");
    }
  }

  // === Status Effects ===
  let wildStatus = { poison: 0, burn: 0, sleep: 0 };
  let playerStatus = { poison: 0, burn: 0, sleep: 0 };
  function applyEndOfTurnDOT() {
    console.log(wildStatus.poison);
    console.log(wildStatus.burn);
    // Wild
    if (wildStatus.poison > 0) {
      const d = Math.max(1, Math.floor(wMaxHP * 0.05));
      wHP = Math.max(0, wHP - d);
      wildStatus.poison--;
    }
    if (wildStatus.burn > 0) {
      const d = Math.max(1, Math.floor(wMaxHP * 0.04));
      wHP = Math.max(0, wHP - d);
      console.log(`Wild ? is Burn for ${d}!`);
      drawBattle(`Wild ? is Burn for ${d}!`);
      wildStatus.burn--;
    }

    // Player
    const stats = activeStats();
    if (playerStatus.poison > 0) {
      const d = Math.max(1, Math.floor(stats.hp * 0.04));
      pHP = Math.max(0, pHP - d);
      playerStatus.poison--;
    }
    if (playerStatus.burn > 0) {
      const d = Math.max(1, Math.floor(stats.hp * 0.03));
      pHP = Math.max(0, pHP - d);
      playerStatus.burn--;
    }

    setActiveStats({ ...activeStats(), currentHP: pHP });
    setHP(pHP);
  }
  // === Battle System ===
  // --- Battle styles (inject once) ---
  (function injectBattleStyles() {
    if (PKM.getElementById("pk-battle-styles")) return;
    const css = `
  :host, .pkm-layer{
    --pk-bg:#1a1333;
    --pk-accent:#ffd166;
    --pk-text:#e9e7ff;
    --pk-muted:#c6c2ee;
    --pk-glass: rgba(255,255,255,0.06);
  }
  .pk-card{
    position:relative;
    background: linear-gradient(180deg, rgba(255,255,255,0.04), var(--pk-glass)), var(--pk-bg);
    color:var(--pk-text);
    border: 2px solid var(--pk-accent);
    border-radius: 18px;
    padding: 12px;
    box-shadow: 0 12px 30px rgba(0,0,0,0.45), inset 0 0 0 1px rgba(255,255,255,0.05);
    backdrop-filter: blur(6px);
  }
  .pk-header{ display:grid; grid-template-columns:72px 1fr; gap:10px; align-items:center; margin-bottom:8px; }
  .pk-sprite{ width:72px; height:72px; display:flex; align-items:center; justify-content:center; border-radius:12px;
              background: radial-gradient(ellipse at 50% 60%, rgba(255,255,255,0.12), transparent 60%); }
  .pk-title{ font-weight:700; line-height:1.2; }
  .pk-sub{ color:var(--pk-muted); font-size:12px; }
  .pk-hp{ margin-top:6px; }
  .pk-hpbar{ position:relative; height:10px; border-radius:999px; overflow:hidden;
             background: linear-gradient(90deg, rgba(255,255,255,0.08), rgba(255,255,255,0.02));
             box-shadow: inset 0 1px 2px rgba(0,0,0,0.5); }
  .pk-hpfill{ height:100%; background: linear-gradient(90deg, #27e3b1, #35c1ff); width:0%; transition: width .35s ease; }
  .pk-hptext{ font-size:12px; margin-top:4px; color:var(--pk-muted); }
  .pk-chips{ display:flex; gap:6px; margin:8px 0 2px; flex-wrap:wrap; }
  .pk-chip{ font-size:11px; padding:2px 8px; border-radius:999px; background:rgba(255,255,255,0.07); border:1px solid rgba(255,255,255,0.08); }
  .pk-chip.sleep { background:rgba(76,201,240,0.18);  border-color:#4cc9f040; }
  .pk-chip.poison{ background:rgba(146,205,91,0.18); border-color:#92cd5b40; }
  .pk-chip.burn  { background:rgba(255,102,71,0.18); border-color:#ff664740; }
  .pk-controls{ display:grid; grid-template-columns: repeat(4, minmax(0,1fr)); gap:8px; margin-top:10px; }
  .pk-btn{ position: relative; background: linear-gradient(180deg, rgba(255,255,255,0.06), rgba(255,255,255,0.03));
           border:1px solid rgba(255,255,255,0.10); border-radius:12px; padding:10px 8px;
           display:flex; flex-direction:column; align-items:center; gap:6px; color:var(--pk-text);
           text-align:center; font-size:13px; cursor:pointer; box-shadow: 0 4px 12px rgba(0,0,0,0.25);
           transition: transform .06s ease, box-shadow .12s ease, border-color .12s ease; }
  .pk-btn:hover{ transform: translateY(-1px); border-color:rgba(255,255,255,0.2); box-shadow:0 8px 20px rgba(0,0,0,0.35); }
  .pk-btn:active{ transform: translateY(0); }
  .pk-btn.disabled{ opacity:.45; cursor:not-allowed; filter:grayscale(.2); }
  .pk-ico{ font-size:20px; line-height:1; }
  .pk-label{ font-size:12px; }
  .pk-badge{ position:absolute; top:6px; right:6px; background:#2b214f; color:#fff; border:1px solid rgba(255,255,255,0.15);
             padding:2px 6px; border-radius:999px; font-size:11px; }
  .pk-catch{ margin-top:4px; font-size:12px; color:var(--pk-muted); }
  `;
    const style = document.createElement("style");
    style.id = "pk-battle-styles";
    style.textContent = css;
    PKM_SHADOW.insertBefore(style, PKM);
  })();

  // --- Small helpers ---
  function buildHPBar(idPrefix, current, max) {
    const wrap = document.createElement("div");
    wrap.className = "pk-hp";
    wrap.innerHTML = `
    <div class="pk-hpbar"><div id="${idPrefix}-fill" class="pk-hpfill"></div></div>
    <div id="${idPrefix}-text" class="pk-hptext"></div>
  `;
    updateHPBar(idPrefix, current, max);
    return wrap;
  }
  function updateHPBar(idPrefix, current, max) {
    const pct = Math.max(
      0,
      Math.min(100, Math.round((current / Math.max(1, max)) * 100))
    );
    const fill = PKM.getElementById(`${idPrefix}-fill`);
    const text = PKM.getElementById(`${idPrefix}-text`);
    if (fill) fill.style.width = pct + "%";
    if (text) text.textContent = `${current}/${max} HP (${pct}%)`;
  }
  function makeChip(text, type) {
    const c = document.createElement("span");
    c.className = `pk-chip ${type || ""}`;
    c.textContent = text;
    return c;
  }
  function makePkButton(onClick, opts = {}) {
    const {
      icon = "🎯",
      label = "Action",
      count = null,
      disabled = false,
    } = opts;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "pk-btn";
    btn.innerHTML = `<div class="pk-ico">${icon}</div><div class="pk-label">${label}</div>`;
    if (count !== null) {
      const b = document.createElement("div");
      b.className = "pk-badge";
      b.textContent = count;
      btn.appendChild(b);
    }
    if (disabled) {
      btn.classList.add("disabled");
      btn.disabled = true;
    }
    btn.onclick = disabled ? null : onClick;
    return btn;
  }

  let battlePanel, wild, pHP, wHP, wMaxHP;
  function openBattle() {
    if (battlePanel) return;
    battlePanel = document.createElement("div");
    Object.assign(battlePanel.style, {
      position: "fixed",
      top: "50%",
      left: "50%",
      transform: "translate(-50%,-50%)",
      color: "#fff",
      padding: "12px",
      zIndex: "10000",
      width: "340px", // a bit wider for the grid
      maxWidth: "92vw",
    });
    pkmMount(battlePanel);

    if (getBool(STORAGE.soundOn)) {
      try {
        SOUNDS.battleSound.play();
      } catch {}
    }
    startBattle(); // this should call drawBattle() initially
  }
  function updateHeaderCoins() {
    const coins = getInt(STORAGE.coins, 0);
    const coinBtn = PKM.getElementById("pk-header-coins");
    if (coinBtn) {
      coinBtn.textContent = `💰 Coins: ${coins}`;
    }
  }
  /** Party instances that are hurt. Stats are stored per Pokémon instance (party id). */
  function pkmHurtParty() {
    const party = getObj(STORAGE.party) || {};
    return Object.entries(party).filter(([id, mon]) => {
      const s = getStatsForInstance(id, mon.name);
      return (s.currentHP ?? s.hp ?? 100) < (s.hp ?? 100);
    });
  }
  function pokeCenter() {
    const coins = getInt(STORAGE.coins, 0);
    if (!pkmHurtParty().length) return pkmToast("💚 Your Pokémon are already at full health.");
    if (coins < POKE_CENTER_COST) return pkmToast(`❌ Healing costs ${POKE_CENTER_COST} coins. You have ${coins}.`);
    setInt(STORAGE.coins, coins - POKE_CENTER_COST);
    healPokemon();
    playSound("heal");
  }
  function healPokemon() {
    const hurt = pkmHurtParty();
    const all = getObj(STORAGE.stats) || {};
    for (const [id, mon] of hurt) {
      const s = all[id] || getStatsForInstance(id, mon.name);
      s.hp = s.hp || 100;
      s.currentHP = s.hp;
      all[id] = s;
    }
    if (hurt.length) setObj(STORAGE.stats, all);
    pkmLiveRefresh();
    if (hurt.length) pkmReact("heart");
    if (hurt.length) pkmToast(`✨ Healed ${hurt.length} Pokémon to full HP!`);
    return hurt.length;
  }
  function startBattle() {
    const id = Math.floor(Math.random() * 649) + 1;

    pkmXhr({
      method: "GET",
      url: `https://pokeapi.co/api/v2/pokemon/${id}`,
      onload(res) {
        const d = JSON.parse(res.responseText);
        const baseName = d.name[0].toUpperCase() + d.name.slice(1);

        const { isShiny, formName, displayName } = getRandomForm(baseName);

        // Use Showdown sprite URLs with form-safe names
        let showdownName = formName.toLowerCase().replace(/[^a-z0-9-]/g, "");
        showdownName = SPRITE_NAME_FIXES[showdownName] || showdownName;

        const sprite = isShiny
          ? `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/shiny/${d.id}.png`
          : d.sprites.front_default;

        wild = {
          name: displayName,
          baseName: d.name,
          sprite: sprite,
          formName: formName,
          isShiny: isShiny,
        };

        const baseHP = d.stats.find((s) => s.stat.name === "hp").base_stat;
        const baseAtk =
          d.stats.find((s) => s.stat.name === "attack")?.base_stat || 10;

        const myStats = activeStats();
        const myLevel = myStats.level;

        const hpMultiplier = 8;
        wMaxHP = Math.floor(baseHP + myLevel * hpMultiplier);
        pHP = myStats.currentHP;
        wHP = wMaxHP;

        // ✅ Save scaled wild attack stat
        wild.baseAtk = Math.floor(baseAtk + myLevel * 1.0);

        drawBattle();
      },
    });
  }
  function drawBattle(msg) {
    battlePanel.innerHTML = "";
    battlePanel.classList.add("pk-card"); // style the panel

    // optional message line
    if (msg) {
      const msgDiv = document.createElement("div");
      msgDiv.textContent = msg;
      msgDiv.style.marginBottom = "6px";
      battlePanel.appendChild(msgDiv);
    }

    // ----- HEADER (sprite + info + hp + status chips)
    const header = document.createElement("div");
    header.className = "pk-header";

    // left sprite
    const spriteBox = document.createElement("div");
    spriteBox.className = "pk-sprite";
    const img = document.createElement("img");
    img.src = wild.sprite;
    img.alt = wild.name;
    img.style.width = "72px";
    img.style.height = "72px";
    img.style.animation = "bobWalk 1.2s infinite";
    img.style.transformOrigin = "center";
    spriteBox.appendChild(img);
    header.appendChild(spriteBox);

    // right info
    const right = document.createElement("div");
    const title = document.createElement("div");
    title.className = "pk-title";
    title.textContent = `Wild ${wild.name}`;

    // compute catch chance like your original
    const partnerLevel = activeStats().level;
    const rarity = getRarity(wild.name);
    const rarityPenalty = { common: 1, uncommon: 1.2, rare: 1.5, legendary: 2 }[
      rarity
    ];
    let chance = (wMaxHP - wHP) / wMaxHP / rarityPenalty + partnerLevel * 0.01;
    if (wildSleepTurns > 0) chance += 0.2;
    chance = Math.min(0.95, Math.max(0.1, chance));

    const sub = document.createElement("div");
    sub.className = "pk-sub";
    sub.innerHTML = `
    You HP: ${pHP}<br>
    ${wild.name} HP: ${wHP}/${wMaxHP}<br>
    Form: ${wild.form || "Normal"} | Shiny: ${wild.isShiny ? "Yes" : "No"}
  `;

    const wildHP = buildHPBar("hp-wild", wHP, wMaxHP);
    const youHP = buildHPBar("hp-you", pHP, activeStats().hp);

    const chips = document.createElement("div");
    chips.className = "pk-chips";
    if (typeof wildSleepTurns === "number" && wildSleepTurns > 0)
      chips.appendChild(makeChip(`Sleep ${wildSleepTurns}`, "sleep"));
    if (wildStatus && wildStatus.poison)
      chips.appendChild(makeChip(`Poison ${wildStatus.poison}`, "poison"));
    if (wildStatus && wildStatus.burn)
      chips.appendChild(makeChip(`Burn ${wildStatus.burn}`, "burn"));

    right.append(title, sub, wildHP, youHP, chips);
    header.appendChild(right);
    battlePanel.appendChild(header);

    const catchTxt = document.createElement("div");
    catchTxt.className = "pk-catch";
    catchTxt.textContent = `Catch Chance: ${(chance * 100).toFixed(1)}%`;
    battlePanel.appendChild(catchTxt);

    // ----- CONTROLS (grid)
    const ctl = document.createElement("div");
    ctl.className = "pk-controls";

    // main actions
    ctl.append(
      makePkButton(playerAttack, { icon: "🗡️", label: "Attack" }),
      makePkButton(throwBall, {
        icon: "⭕",
        label: "Ball",
        count: getInt(STORAGE.balls),
      }),
      makePkButton(usePotion, {
        icon: "💉",
        label: "Potion",
        count: getInt(STORAGE.potions),
        disabled: getInt(STORAGE.potions) <= 0,
      }),
      makePkButton(runAway, { icon: "🏃", label: "Run" })
    );

    // items / specials
    ctl.append(
      makePkButton(useXAttack, {
        icon: "🧪",
        label: "X-Atk",
        count: getInt("pkm_xattack"),
        disabled: getInt("pkm_xattack") <= 0,
      }),
      makePkButton(useRevive, {
        icon: "✨",
        label: "Revive",
        count: getInt("pkm_revive"),
        disabled: getInt("pkm_revive") <= 0,
      }),
      makePkButton(
        () => {
          // Sleep Powder
          // set random sleep turns between 1-3
          let turns = 1 + Math.floor(Math.random() * 5);
          wildSleepTurns = turns;
          drawBattle(`${wild.name} fell asleep for ${turns}!`);
          setTimeout(wildAttack, 900);
        },
        { icon: "🌙", label: "Sleep Powder" }
      ),
      makePkButton(
        () => {
          // Poison Sting
          const dmg = Math.max(
            1,
            Math.floor(
              activeStats().atk *
                0.6 *
                (activeStats().atkBuff || 1)
            )
          );
          wHP = Math.max(0, wHP - dmg);
          if (typeof wildStatus === "object") wildStatus.poison = 3;
          drawBattle(`You used Poison Sting! ${wild.name} is poisoned.`);
          setTimeout(wildAttack, 500);
        },
        { icon: "☠️", label: "Poison Sting" }
      ),
      makePkButton(
        () => {
          // Ember
          const dmg = Math.max(
            1,
            Math.floor(
              activeStats().atk *
                0.7 *
                (activeStats().atkBuff || 1)
            )
          );
          wHP = Math.max(0, wHP - dmg);
          if (typeof wildStatus === "object") wildStatus.burn = 2;
          drawBattle(`You used Ember! ${wild.name} is burned.`);
          setTimeout(wildAttack, 500);
        },
        { icon: "🔥", label: "Ember" }
      )
    );

    battlePanel.appendChild(ctl);
    pkmBattleKeys(ctl); // arrow keys / Enter / 1-9

    // keep HP bars in sync if anything changed mid-draw
    updateHPBar("hp-wild", wHP, wMaxHP);
    updateHPBar("hp-you", pHP, activeStats().hp);
  }

  function animateHit() {
    const el = PKM.getElementById("wild-img");
    if (el) {
      el.style.animation = "none"; // Clear all animations
      el.offsetHeight; // Force reflow
      el.style.animation = "shake 0.3s, bobWalk 1.2s infinite"; // Apply shake + bob
    }
  }
  function animatePartnerHit() {
    if (!spriteEl) return;

    spriteEl.style.animation = "none"; // Reset
    spriteEl.offsetHeight; // Force reflow
    spriteEl.style.animation = "shake 0.3s, flash 0.3s, bobWalk 0.6s infinite";
  }
  function playerAttack() {
    const st = activeStats();
    const atk = (st.atk || 10) * (st.atkBuff || 1);
    const dmg = Math.floor(atk * (0.8 + Math.random() * 0.4));
    wHP = Math.max(0, wHP - dmg);
    animateHit();
    playSound("hit");
    if (wHP <= 0) winBattle();
    else {
      drawBattle(`You hit for ${dmg}!`);
      setTimeout(wildAttack, 800);
    }
  }

  function wildAttack() {
    if (wildSleepTurns > 0) {
      wildSleepTurns--;
      drawBattle(`Wild ${wild.name} is asleep and didn't attack!`);
      return;
    }

    const myLevel = activeStats().level;
    const stats = activeStats();
    const baseDmg = 5 + Math.random() * 10;
    const dmg = Math.floor(baseDmg + myLevel * 0.5);

    pHP = Math.max(0, pHP - dmg);
    stats.currentHP = pHP;
    setActiveStats( stats);

    animatePartnerHit();
    playSound("hit");
    setHP(pHP); // partner's HP bar + floating damage number
    updateHeaderHP();
    renderHeader();

    // === NEW: end-of-turn damage over time
    applyEndOfTurnDOT();

    if (wHP <= 0) return winBattle();
    if (pHP <= 0) {
      SOUNDS.battleSound.pause();
      SOUNDS.battleSound.currentTime = 0;
      playSound("lose");
      drawBattle(`You were knocked out...`);
      return setTimeout(closeBattle, 1500);
    } else {
      drawBattle(`Wild ${wild.name} hit for ${dmg}!`);
    }
  }

  function winBattle() {
    const rarity = getRarity(wild.name);
    const myLevel = activeStats().level;
    let xp = Math.floor(wMaxHP * (1 + myLevel * 0.05)); // XP scales with level
    let reward = Math.floor((20 + wMaxHP / 10) * (1 + myLevel * 0.03)); // Coin reward scaling

    // Boost rewards based on rarity
    if (rarity === "uncommon") {
      xp *= 1.2;
      reward = Math.floor(reward * 1.3);
    } else if (rarity === "rare") {
      xp *= 1.5;
      reward = Math.floor(reward * 1.6);
    } else if (rarity === "legendary") {
      xp *= 2.5;
      reward = Math.floor(reward * 3);
    }

    setInt(STORAGE.coins, getInt(STORAGE.coins) + reward);
    //gainXP(Math.floor(xp));
    console.log(`Gained ${Math.floor(xp)} XP for winning battle.`);
    addXP(starterName, Math.floor(xp));

    SOUNDS.battleSound.pause();
    SOUNDS.battleSound.currentTime = 0;
    playSound("victory");
    drawBattle(`You defeated ${wild.name}! +${reward} coins, +${Math.floor(xp)} XP`);
    setTimeout(closeBattle, 1500);
  }
  function throwBall(useBall) {
    // The old prompt() crashed on Cancel; now the Ball button opens a picker in the battle card.
    if (typeof useBall !== "string") return pkmBallPicker();

    let key,
      bonus,
      isMaster = false;
    if (useBall === "great") {
      key = STORAGE.greatBalls;
      bonus = 0.15;
    } else if (useBall === "ultra") {
      key = STORAGE.ultraBalls;
      bonus = 0.3;
    } else if (useBall === "master") {
      key = STORAGE.masterBalls;
      isMaster = true;
      bonus = 0;
    } else {
      key = STORAGE.balls;
      bonus = 0;
    }

    if (getInt(key) <= 0) return drawBattle(`No ${useBall} balls left!`);
    setInt(key, getInt(key) - 1);
    playSound("ball");

    const partnerLevel = activeStats().level;
    const rarity = getRarity(wild.name);
    const rarityPenalty = { common: 1, uncommon: 1.2, rare: 1.5, legendary: 2 }[
      rarity
    ];
    let chance =
      (wMaxHP - wHP) / wMaxHP / rarityPenalty + partnerLevel * 0.01 + bonus;
    if (wildSleepTurns > 0) chance += 0.2;
    chance = Math.min(0.95, Math.max(0.1, chance));

    if (isMaster || Math.random() < chance) catchIt();
    else {
      drawBattle(`It broke free from the ${useBall} ball!`);
      setTimeout(wildAttack, 500);
    }
  }
  function catchIt() {
    if (!wild || !wild.name) return;

    // --- 1) Add unique Pokémon instance ---
    const party = getObj(STORAGE.party) || {};
    const id = generateUniqueId(wild.name); // e.g. "charmeleon_lsn3do_9q8"

    // Preserve shiny + sprite info if available
    party[id] = {
      name: wild.name,
      caughtAt: Date.now(),
      isShiny: wild.isShiny || (wild.sprite?.includes("/shiny/") ?? false),
      spriteUrl: wild.sprite || null,
    };
    setObj(STORAGE.party, party);

    // --- 2) Initialize stats for this new Pokémon ---
    const allStats = getObj(STORAGE.stats) || {};
    const baseStats = getStats(wild.name); // species base
    allStats[id] = { ...baseStats }; // clone species stats into instance
    setObj(STORAGE.stats, allStats);

    // --- 3) Record in Pokédex (if missing) ---
    const pokedex = getArr(STORAGE.pokedex);
    const alreadyInDex = pokedex.some(
      (p) => p.name.toLowerCase() === wild.name.toLowerCase()
    );

    if (!alreadyInDex) {
      pkmXhr({
        method: "GET",
        url: `https://pokeapi.co/api/v2/pokemon/${encodeURIComponent(
          wild.name.toLowerCase()
        )}`,
        onload(res) {
          try {
            const d = JSON.parse(res.responseText);
            recordPokedex({
              id: d.id,
              name: d.name[0].toUpperCase() + d.name.slice(1),
              spriteUrl: wild.sprite || d.sprites.front_default,
              types: d.types.map((t) => t.type.name),
              abilities: d.abilities.map((a) => a.ability.name),
            });
          } catch (err) {
            console.warn("Pokédex record failed:", err);
          }

          finishCatch(wild.name);
        },
        onerror(err) {
          console.warn("Pokédex fetch failed:", err);
          finishCatch(wild.name);
        },
      });
    } else {
      finishCatch(wild.name);
    }
  }

  // --- Helper to finish catch animation/sound ---
  function finishCatch(name) {
    SOUNDS.battleSound.pause();
    SOUNDS.battleSound.currentTime = 0;
    playSound("catch");
    drawBattle(`Caught ${name}!`);
    setTimeout(closeBattle, 1500);
  }

  function usePotion() {
    if (getInt(STORAGE.potions) <= 0) return drawBattle("No Potions!");

    setInt(STORAGE.potions, getInt(STORAGE.potions) - 1);

    const stats = activeStats();
    const newHP = Math.min(stats.hp, pHP + 30); // Don't exceed max HP
    setHP(newHP); // ✅ This triggers the animation too
    pHP = newHP; // ✅ Update your local HP value
    stats.currentHP = newHP; // and save it (it used to be lost when the battle ended)
    setActiveStats(stats);
    updateHeaderHP();
    drawBattle("You used a Potion.");
    renderHeader();

    setTimeout(wildAttack, 500);
  }
  function useXAttack() {
    if (getInt("pkm_xattack") <= 0) return drawBattle("No X-Attack!");
    setInt("pkm_xattack", getInt("pkm_xattack") - 1);
    const s = activeStats();
    s.atkBuff = Math.max(s.atkBuff || 1, 1.5); // +50% atk for this battle
    setActiveStats( s);
    drawBattle("Your attack rose!");
  }

  function useRevive() {
    if (getInt("pkm_revive") <= 0) return drawBattle("No Revive!");
    if (pHP > 0) return drawBattle("You are not fainted.");
    setInt("pkm_revive", getInt("pkm_revive") - 1);
    const s = activeStats();
    pHP = Math.floor(s.hp * 0.5);
    s.currentHP = pHP;
    setActiveStats( s);
    setHP(pHP);
    updateHeaderHP();
    drawBattle("You revived to 50% HP!");
  }

  function runAway() {
    SOUNDS.battleSound.pause();
    SOUNDS.battleSound.currentTime = 0;
    playSound("run");
    drawBattle("You ran away!");
    setTimeout(closeBattle, 500);
  }
  function closeBattle() {
    if (battlePanel) battlePanel.remove();
    battlePanel = null;
    // Reset temporary buffs
    const s = activeStats();
    if (s.atkBuff) {
      delete s.atkBuff;
      setActiveStats( s);
    }
    wildStatus = { poison: 0, burn: 0, sleep: 0 };
    playerStatus = { poison: 0, burn: 0, sleep: 0 };
    renderHeader();
  }

  // === Items (shared by the shop, the bag and the battle ball picker) ===
  const PKM_ITEM_IMG = "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/";
  const PKM_ITEMS = [
    { img: "poke-ball", name: "Poké Ball", key: STORAGE.balls, price: 20, cat: "balls", desc: "The standard ball for catching wild Pokémon." },
    { img: "great-ball", name: "Great Ball", key: STORAGE.greatBalls, price: 50, cat: "balls", desc: "+15% catch chance." },
    { img: "ultra-ball", name: "Ultra Ball", key: STORAGE.ultraBalls, price: 100, cat: "balls", desc: "+30% catch chance." },
    { img: "master-ball", name: "Master Ball", key: STORAGE.masterBalls, price: 0, cat: "balls", desc: "Never fails. Only found at PokéStops." },
    { img: "potion", name: "Potion", key: STORAGE.potions, price: 10, cat: "medicine", desc: "Restores 35% of max HP (at least 20).", use: "potion" },
    { img: "revive", name: "Revive", key: "pkm_revive", price: 120, cat: "medicine", desc: "Revives a fainted partner to 50% HP.", use: "revive" },
    { img: "x-attack", name: "X Attack", key: "pkm_xattack", price: 60, cat: "battle", desc: "+50% attack for one battle." },
  ];

  // === Shop (PokéMart) ===
  let shopPanel;
  const pkmShop = { cat: "all", qty: {}, flash: null };
  function openShop() {
    if (shopPanel) return;
    shopPanel = document.createElement("div");
    shopPanel.className = "pkm-panel pkm-modal pkm-set pkm-shop";
    shopPanel.setAttribute("role", "dialog");
    shopPanel.setAttribute("aria-label", "PokéMart");
    pkmMount(shopPanel);
    pkmShop.qty = {};
    drawShop();
  }
  function drawShop(msg) {
    if (!shopPanel) return;
    const coins = getInt(STORAGE.coins);
    const cats = [["all", "All"], ["balls", "Poké Balls"], ["medicine", "Medicine"], ["battle", "Battle"], ["held", "Held items"], ["evolution", "Evolution"], ["tm", "TMs"], ["key", "Key items"]];
    const items = PKM_ITEMS.filter((it) => it.price > 0 && (pkmShop.cat === "all" || it.cat === pkmShop.cat));
    shopPanel.innerHTML = `
      <div class="pkm-set-head shop-head"><span>🛒 PokéMart</span><span class="bag-head-r"><span class="pkm-chip" data-coins>💰 ${coins}</span><button type="button" class="pkm-x" data-a="close" aria-label="Close" title="Close (Esc)">✕</button></span></div>
      <div class="bag-tabs" role="tablist">${cats.map(([k, l]) => `<button type="button" role="tab" data-cat="${k}" aria-selected="${pkmShop.cat === k}">${l}</button>`).join("")}</div>
      ${msg ? `<div class="bag-msg">${pkmEsc(msg)}</div>` : ""}
      <div class="shop-grid">${items
        .map((it) => {
          const q = pkmShop.qty[it.img] || 1;
          const total = q * it.price;
          return `<div class="shop-card${pkmShop.flash === it.img ? " bought" : ""}" data-k="${it.img}">
            <div class="shop-img"><img src="${PKM_ITEM_IMG}${it.img}.png" alt=""></div>
            <div class="shop-info"><div class="shop-name">${it.name}</div><div class="pkm-dim">${it.desc}</div><div class="shop-own">In bag: <b>${getInt(it.key)}</b></div></div>
            <div class="shop-buy">
              <div class="shop-price">💰 ${it.price}</div>
              <div class="shop-qty"><button type="button" data-a="minus" aria-label="Buy fewer">−</button><span aria-live="polite">${q}</span><button type="button" data-a="plus" aria-label="Buy more">+</button></div>
              <button type="button" class="pkm-btn2 primary shop-btn" data-a="buy" ${total <= coins ? "" : "disabled"} title="${total <= coins ? "" : "Not enough coins"}">Buy${q > 1 ? ` ×${q}` : ""} · ${total}</button>
            </div></div>`;
        })
        .join("")}</div>
      <div class="shop-foot pkm-dim">Tip: PokéStops give free balls and coins, and are the only place to find Master Balls.</div>`;
    pkmShop.flash = null;
    shopPanel.onclick = (e) => {
      const cat = e.target.closest("[data-cat]");
      if (cat) { pkmShop.cat = cat.dataset.cat; return drawShop(); }
      const b = e.target.closest("button[data-a]");
      if (!b) return;
      if (b.dataset.a === "close") return closeShop();
      const it = PKM_ITEMS.find((x) => x.img === b.closest(".shop-card")?.dataset.k);
      if (!it) return;
      const q = pkmShop.qty[it.img] || 1;
      if (b.dataset.a === "minus") { pkmShop.qty[it.img] = Math.max(1, q - 1); return drawShop(); }
      if (b.dataset.a === "plus") { pkmShop.qty[it.img] = Math.min(99, q + 1); return drawShop(); }
      if (b.dataset.a === "buy") {
        const total = q * it.price;
        if (it.max && getInt(it.key) + q > it.max) return drawShop(`You can only have ${it.max} ${it.name}.`);
        if (getInt(STORAGE.coins) < total) return drawShop(`Not enough coins for ${q} × ${it.name}.`);
        setInt(STORAGE.coins, getInt(STORAGE.coins) - total);
        setInt(it.key, getInt(it.key) + q);
        pkmShop.qty[it.img] = 1;
        pkmShop.flash = it.img;
        pkmToast(`🛍️ Bought ${q} × ${it.name} for ${total} coins`);
        playSound("buy");
        drawShop();
        shopPanel.querySelector(`.shop-card[data-k="${it.img}"] [data-a="buy"]`)?.focus();
      }
    };
  }
  function closeShop() {
    if (shopPanel) shopPanel.remove();
    shopPanel = null;
    renderHeader();
  }

  // === Bag: Pokémon (party + storage boxes) and Items ===
  let bagPanel;
  const pkmBag = { tab: "pokemon", sel: null, q: "", confirmSell: null };
  const PKM_PARTY_SIZE = 6;
  const PKM_BOX_SIZE = 30;
  function openBag() {
    if (bagPanel) return;
    bagPanel = document.createElement("div");
    bagPanel.className = "pkm-panel pkm-modal pkm-set pkm-bag";
    bagPanel.setAttribute("role", "dialog");
    bagPanel.setAttribute("aria-label", "Bag");
    pkmMount(bagPanel);
    pkmBag.sel = null;
    pkmBag.confirmSell = null;
    drawBag();
  }

  function openPokeStop() {
    const now = Date.now();
    const cooldownEnd = getInt(STORAGE.pokestopCooldown);

    if (now < cooldownEnd) {
      const remaining = cooldownEnd - now;
      const mins = Math.floor(remaining / 60000);
      const secs = Math.floor((remaining % 60000) / 1000);
      pkmToast(`🕒 PokéStop will be ready in ${mins}m ${secs}s`);
      return;
    }

    const ballTypes = [
      { name: "Poké Ball", key: STORAGE.balls },
      { name: "Great Ball", key: "pkm_great_balls" },
      { name: "Ultra Ball", key: "pkm_ultra_balls" },
    ];

    const randBall = ballTypes[Math.floor(Math.random() * ballTypes.length)];
    const ballAmount = Math.floor(Math.random() * 5) + 1; // 1–5
    const coinAmount = Math.floor(Math.random() * 91) + 10; // 10–100

    setInt(randBall.key, getInt(randBall.key) + ballAmount);
    setInt(STORAGE.coins, getInt(STORAGE.coins) + coinAmount);
    pkmTrack("coins", coinAmount);
    pkmQuest("stop");

    let msg = `🪙 +${coinAmount} Coins\n🎁 +${ballAmount} ${randBall.name}`;

    if (Math.random() < 0.025) {
      setInt(STORAGE.masterBalls, getInt(STORAGE.masterBalls) + 1);
      msg += `\n🎱 +1 Master Ball!`;
    }

    // Set new cooldown (1–5 mins)
    const cooldownMs = (1 + Math.floor(Math.random() * 5)) * 60 * 1000;
    setInt(STORAGE.pokestopCooldown, now + cooldownMs);

    pkmToast(`📍 PokéStop Reward:\n\n${msg}`);
    renderHeader();
  }
  function drawBagSorted(_sortBy, msg) { drawBag(msg); } // old name, still used in a few places
  const PKM_LIST_URL = "https://pokeapi.co/api/v2/pokemon?limit=1010";
  const PKM_SPRITES = "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/";
  let pkmDexIds = null;
  let pkmDexIdsLoading = false;
  /** National Dex number from the cached Pokémon list (0 if unknown). */
  function pkmDexId(name) {
    if (!pkmDexIds) {
      try {
        const raw = GM_getValue(PKM_CACHE_PREFIX + PKM_LIST_URL, "");
        if (raw) {
          const m = new Map();
          JSON.parse(JSON.parse(raw).body).results.forEach((p, i) => m.set(p.name, i + 1));
          pkmDexIds = m;
        }
      } catch { pkmDexIds = null; }
      if (!pkmDexIds && !pkmDexIdsLoading) {
        pkmDexIdsLoading = true;
        pkmFetch(PKM_LIST_URL).then(() => { pkmDexIdsLoading = false; if (bagPanel) drawBag(); }).catch(() => {});
      }
    }
    const n = String(name || "").toLowerCase();
    return (pkmDexIds && (pkmDexIds.get(n) || pkmDexIds.get(n.split("-")[0]))) || 0;
  }
  /** Sprite for a party Pokémon. The old bag guessed a URL by name, which doesn't exist on PokeAPI. */
  function pkmMonSprite(mon, dexArr) {
    if (mon.spriteUrl) return mon.spriteUrl;
    const d = (dexArr || []).find((p) => String(p.name).toLowerCase() === String(mon.name).toLowerCase());
    if (d && d.spriteUrl) return d.spriteUrl;
    const id = pkmDexId(mon.name);
    return id ? `${PKM_SPRITES}${mon.isShiny ? "shiny/" : ""}${id}.png` : `${PKM_ITEM_IMG}poke-ball.png`;
  }
  const PKM_SELL = { common: 10, uncommon: 30, rare: 100, sublegendary: 200, legendary: 300, mythical: 500 };
  function pkmMonValue(id, mon) {
    const st = (getObj(STORAGE.stats) || {})[id] || {};
    const lvl = Math.min(MAX_LEVEL, st.level || 1);
    return (PKM_SELL[getRarity(mon.name)] || 10) * (lvl + 1);
  }
  const pkmBagList = () => Object.entries(getObj(STORAGE.party) || {});
  function pkmBagSave(list) {
    const o = {};
    for (const [id, m] of list) o[id] = m;
    setObj(STORAGE.party, o);
  }
  /** Party slot 1 is the active partner. */
  function pkmMakeActive(id) {
    const list = pkmBagList();
    const i = list.findIndex(([x]) => x === id);
    if (i < 0) return;
    if (i > 0) { [list[0], list[i]] = [list[i], list[0]]; pkmBagSave(list); }
    GM_setValue("pkm_starter_id", id);
    setStr(STORAGE.starter, list[0][1].name);
    fetchPartner(id);
  }
  function pkmUseItem(kind) {
    const s = activeStats();
    if (kind === "potion") {
      if (getInt(STORAGE.potions) <= 0) return pkmToast("No Potions left");
      if (s.currentHP >= s.hp) return pkmToast("Your partner already has full HP");
      if (s.currentHP <= 0) return pkmToast("Your partner fainted. Use a Revive first.");
      setInt(STORAGE.potions, getInt(STORAGE.potions) - 1);
      pkmQuest("potion");
      s.currentHP = Math.min(s.hp, s.currentHP + Math.max(20, Math.round(s.hp * 0.35)));
    } else if (kind === "revive") {
      if (getInt("pkm_revive") <= 0) return pkmToast("No Revives left");
      if (s.currentHP > 0) return pkmToast("Your partner hasn't fainted");
      setInt("pkm_revive", getInt("pkm_revive") - 1);
      s.currentHP = Math.floor(s.hp * 0.5);
    } else return;
    setActiveStats(s);
    setHP(s.currentHP);
    pkmToast(`💚 HP is now ${s.currentHP}/${s.hp}`);
    pkmReact("heart");
    playSound("heal");
  }

  function drawBag(msg) {
    if (!bagPanel) return;
    const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : "");
    let list = pkmBagList();
    // Keep the active partner in party slot 1 (it used to be overwritten by whatever was first)
    const activeId = GM_getValue("pkm_starter_id");
    const ai = list.findIndex(([x]) => x === activeId);
    if (ai > 0) { [list[0], list[ai]] = [list[ai], list[0]]; pkmBagSave(list); }
    else if (ai < 0 && list[0]) { GM_setValue("pkm_starter_id", list[0][0]); setStr(STORAGE.starter, list[0][1].name); }

    const dexArr = getArr(STORAGE.pokedex) || [];
    const statsAll = getObj(STORAGE.stats) || {};
    const party = list.slice(0, PKM_PARTY_SIZE);
    const storage = list.slice(PKM_PARTY_SIZE);
    const boxes = Math.max(1, Math.ceil(storage.length / PKM_BOX_SIZE));
    const box = Math.min(Math.max(0, getInt(STORAGE.BOX_ID) || 0), boxes - 1);
    const scroll = bagPanel.querySelector(".bag-body")?.scrollTop || 0;
    const q = pkmBag.q.trim().toLowerCase();
    const lvlOf = (id) => Math.min(MAX_LEVEL, (statsAll[id] && statsAll[id].level) || 1);
    const hpOf = (id) => {
      const st = statsAll[id] || {};
      const hp = st.hp || 100;
      return { hp, cur: Math.max(0, Math.min(hp, st.currentHP ?? hp)) };
    };

    const card = (entry, zone, i) => {
      if (!entry) return `<div class="bag-slot empty" data-zone="${zone}" data-i="${i}" aria-hidden="true"></div>`;
      const [id, mon] = entry;
      const { hp, cur } = hpOf(id);
      const pct = Math.round((cur / hp) * 100);
      const rar = getRarity(mon.name) || "common";
      const dim = q && !String(mon.name).toLowerCase().includes(q);
      return `<div class="bag-slot r-${rar}${id === pkmBag.sel ? " sel" : ""}${dim ? " dim" : ""}" data-zone="${zone}" data-i="${i}" data-id="${pkmEsc(id)}" draggable="true" tabindex="0" role="button" aria-label="${pkmEsc(cap(mon.name))}, level ${lvlOf(id)}, ${rar}" title="${pkmEsc(cap(mon.name))} · ${cap(rar)} · HP ${cur}/${hp}">
        ${zone === "party" && i === 0 ? '<span class="bag-active" title="Active partner">★</span>' : ""}${mon.isShiny ? '<span class="bag-shiny" title="Shiny">✨</span>' : ""}${mon.costume ? `<span class="bag-costume">${mon.costume}</span>` : ""}${mon.held ? `<img class="bag-heldi" src="${PKM_ITEM_IMG}${mon.held}.png" alt="" title="Holding ${pkmEsc(pkmCap(mon.held))}">` : ""}
        <img src="${pkmEsc(pkmMonSprite(mon, dexArr))}" alt="" loading="lazy" draggable="false">
        <div class="bag-nm">${pkmEsc(cap(mon.name))}</div>
        <div class="bag-lv">Lv ${lvlOf(id)}</div>
        <div class="bag-hp"><span style="width:${pct}%;background:${pct > 50 ? "#2fbf71" : pct > 25 ? "#ffb020" : "#ff4d4f"}"></span></div>
      </div>`;
    };

    // Selected Pokémon details + actions
    let detail = `<div class="bag-detail empty pkm-dim">Click a Pokémon for details and actions. Drag it to move between your party and storage.</div>`;
    const selIdx = list.findIndex(([id]) => id === pkmBag.sel);
    if (selIdx >= 0) {
      const [id, mon] = list[selIdx];
      const st = statsAll[id] || {};
      const { hp, cur } = hpOf(id);
      const lvl = lvlOf(id);
      const rar = getRarity(mon.name) || "common";
      const types = getTypesForName(mon.name, dexArr);
      const value = pkmMonValue(id, mon);
      const canSell = selIdx !== 0 && list.length > 1;
      detail = `<div class="bag-detail">
        <img src="${pkmEsc(pkmMonSprite(mon, dexArr))}" alt="">
        <div class="bag-d-main">
          <div class="bag-d-name">${pkmEsc(cap(mon.name))} <span class="pkm-dim">Lv ${lvl}</span>${mon.isShiny ? " ✨" : ""}</div>
          <div class="bag-d-tags"><span class="bag-rar r-${rar}">${cap(rar)}</span>${types.map((t) => `<span class="pk-type ${pkmEsc(t)}">${pkmEsc(t)}</span>`).join("")}${selIdx === 0 ? '<span class="pkm-chip">★ Active</span>' : ""}</div>
          <div class="pkm-dim">HP ${cur}/${hp} · ATK ${st.atk || 15} · XP ${st.xp || 0}/${xpThreshold(lvl)}${mon.caughtAt ? ` · Caught ${pkmEsc(new Date(mon.caughtAt).toLocaleDateString())}` : ""}</div>
          ${pkmBagTraits(id, mon, st)}
        </div>
        <div class="bag-d-actions">
          <button type="button" class="pkm-btn2" data-a="moves">📜 Moves${(st.movesPending || []).length ? ' <b class="bag-new">NEW</b>' : ""}</button>
          ${selIdx !== 0 ? '<button type="button" class="pkm-btn2 primary" data-a="active">★ Make active</button>' : ""}
          ${selIdx >= PKM_PARTY_SIZE ? '<button type="button" class="pkm-btn2" data-a="toparty" title="Swaps with party slot 6">⬆ Into party</button>' : ""}
          ${selIdx > 0 && selIdx < PKM_PARTY_SIZE && list.length > PKM_PARTY_SIZE ? '<button type="button" class="pkm-btn2" data-a="tostorage">⬇ To storage</button>' : ""}
          ${canSell ? `<button type="button" class="pkm-btn2 danger" data-a="sell">${pkmBag.confirmSell === id ? `Sure? Sell for ${value}` : `💰 Sell · ${value}`}</button>` : ""}
        </div></div>`;
    }

    let found = "";
    if (q) {
      const where = new Set();
      list.forEach(([, m], i) => {
        if (!String(m.name).toLowerCase().includes(q)) return;
        where.add(i < PKM_PARTY_SIZE ? "party" : `box ${Math.floor((i - PKM_PARTY_SIZE) / PKM_BOX_SIZE) + 1}`);
      });
      found = `<div class="pkm-dim bag-found">${where.size ? `“${pkmEsc(pkmBag.q)}” found in ${[...where].join(", ")}` : `No “${pkmEsc(pkmBag.q)}” in your bag`}</div>`;
    }

    const itemsHtml = PKM_ITEMS.filter((it) => !["evolution", "held", "key", "tm", "medicine", "battle"].includes(it.cat) || getInt(it.key) > 0 || ["potion", "revive", "x-attack"].includes(it.img)).map(
      (it) => `<div class="bag-item"><img src="${PKM_ITEM_IMG}${it.img}.png" alt="">
        <div class="bag-item-txt"><div class="bag-nm">${it.name}</div><div class="pkm-dim">${it.desc}</div></div>
        <div class="bag-qty">×${getInt(it.key)}</div>
        ${it.use ? `<button type="button" class="pkm-btn2" data-a="use" data-k="${it.use}" ${getInt(it.key) <= 0 ? "disabled" : ""}>Use</button>` : "<span></span>"}</div>`
    ).join("");

    bagPanel.innerHTML = `
      <div class="pkm-set-head bag-head"><span>🎒 Bag</span><span class="bag-head-r"><span class="pkm-chip" data-coins>💰 ${getInt(STORAGE.coins)}</span><button type="button" class="pkm-x" data-a="close" aria-label="Close" title="Close (Esc)">✕</button></span></div>
      <div class="bag-tabs" role="tablist">
        <button type="button" role="tab" data-tab="pokemon" aria-selected="${pkmBag.tab === "pokemon"}">Pokémon <span class="bag-count">${list.length}</span></button>
        <button type="button" role="tab" data-tab="items" aria-selected="${pkmBag.tab === "items"}">Items</button>
      </div>
      ${msg ? `<div class="bag-msg">${pkmEsc(msg)}</div>` : ""}
      <div class="bag-body">${
        pkmBag.tab === "items"
          ? `<div class="bag-items">${itemsHtml}</div><div class="pkm-btns" style="margin-top:10px"><button type="button" class="pkm-btn2" data-a="shop">🛒 Go to PokéMart</button></div>`
          : `<div class="bag-sec"><span>Party <span class="pkm-dim">${party.length}/${PKM_PARTY_SIZE}</span></span><span class="pkm-dim">★ = active partner</span></div>
        <div class="bag-party">${Array.from({ length: PKM_PARTY_SIZE }, (_, i) => card(party[i], "party", i)).join("")}</div>
        ${detail}
        <div class="bag-sec"><span>Storage <span class="pkm-dim">${storage.length}</span></span>
          <span class="bag-tools">
            <input type="search" class="bag-q" placeholder="Find…" value="${pkmEsc(pkmBag.q)}" aria-label="Find a Pokémon">
            <select class="bag-sort" aria-label="Sort storage"><option value="">Sort storage…</option><option value="name">Name</option><option value="level">Level</option><option value="rarity">Rarity</option><option value="new">Newest</option></select>
            <button type="button" class="pkm-btn2" data-a="prev" ${box === 0 ? "disabled" : ""} aria-label="Previous box">⟨</button>
            <span class="bag-boxn">Box ${box + 1}/${boxes}</span>
            <button type="button" class="pkm-btn2" data-a="next" ${box >= boxes - 1 ? "disabled" : ""} aria-label="Next box">⟩</button>
          </span></div>
        ${found}
        <div class="bag-box">${Array.from({ length: PKM_BOX_SIZE }, (_, i) => card(storage[box * PKM_BOX_SIZE + i], "storage", i)).join("")}</div>`
      }</div>`;
    const body = bagPanel.querySelector(".bag-body");
    if (body) body.scrollTop = scroll;

    bagPanel.onclick = (e) => {
      const tab = e.target.closest("[data-tab]");
      if (tab) { pkmBag.tab = tab.dataset.tab; return drawBag(); }
      const b = e.target.closest("button[data-a]");
      if (b) return pkmBagAction(b.dataset.a, b, box);
      const slot = e.target.closest(".bag-slot[data-id]");
      if (slot) {
        pkmBag.sel = pkmBag.sel === slot.dataset.id ? null : slot.dataset.id;
        pkmBag.confirmSell = null;
        drawBag();
      }
    };
    bagPanel.onkeydown = (e) => {
      const slot = e.target.closest && e.target.closest(".bag-slot[data-id]");
      if (!slot || (e.key !== "Enter" && e.key !== " ")) return;
      e.preventDefault();
      pkmBag.sel = slot.dataset.id;
      drawBag();
      bagPanel.querySelector(`.bag-slot[data-id="${CSS.escape(slot.dataset.id)}"]`)?.focus();
    };
    const qi = bagPanel.querySelector(".bag-q");
    if (qi) qi.oninput = () => {
      pkmBag.q = qi.value;
      drawBag();
      const n = bagPanel.querySelector(".bag-q");
      n.focus();
      n.setSelectionRange(n.value.length, n.value.length);
    };
    const so = bagPanel.querySelector(".bag-sort");
    if (so) so.onchange = () => {
      const by = so.value;
      if (!by) return;
      const st = getObj(STORAGE.stats) || {};
      const rank = { common: 0, uncommon: 1, rare: 2, sublegendary: 3, legendary: 4, mythical: 5 };
      const cur = pkmBagList();
      const head = cur.slice(0, PKM_PARTY_SIZE);
      const rest = cur.slice(PKM_PARTY_SIZE);
      const cmp = {
        name: (a, b) => String(a[1].name).localeCompare(String(b[1].name)),
        level: (a, b) => ((st[b[0]] || {}).level || 1) - ((st[a[0]] || {}).level || 1),
        rarity: (a, b) => (rank[getRarity(b[1].name)] || 0) - (rank[getRarity(a[1].name)] || 0),
        new: (a, b) => (b[1].caughtAt || 0) - (a[1].caughtAt || 0),
      }[by];
      rest.sort(cmp);
      pkmBagSave(head.concat(rest));
      drawBag(`Storage sorted by ${so.options[so.selectedIndex].text.toLowerCase()}.`);
    };

    // Drag and drop between party and storage (swap)
    bagPanel.ondragstart = (e) => {
      const s = e.target.closest && e.target.closest(".bag-slot[data-id]");
      if (!s) return;
      e.dataTransfer.setData("text/plain", s.dataset.id);
      e.dataTransfer.effectAllowed = "move";
      s.classList.add("dragging");
    };
    bagPanel.ondragend = () => bagPanel.querySelectorAll(".dragging,.drop-ok").forEach((x) => x.classList.remove("dragging", "drop-ok"));
    bagPanel.ondragover = (e) => {
      const s = e.target.closest && e.target.closest(".bag-slot");
      if (!s) return;
      e.preventDefault();
      bagPanel.querySelectorAll(".drop-ok").forEach((x) => x !== s && x.classList.remove("drop-ok"));
      s.classList.add("drop-ok");
    };
    bagPanel.ondrop = (e) => {
      const s = e.target.closest && e.target.closest(".bag-slot");
      if (!s) return;
      e.preventDefault();
      const id = e.dataTransfer.getData("text/plain");
      const cur = pkmBagList();
      const from = cur.findIndex(([x]) => x === id);
      if (from < 0) return;
      const to = s.dataset.zone === "party" ? +s.dataset.i : PKM_PARTY_SIZE + box * PKM_BOX_SIZE + +s.dataset.i;
      if (to === from) return drawBag();
      if (cur[to]) [cur[from], cur[to]] = [cur[to], cur[from]];
      else { const [m] = cur.splice(from, 1); cur.splice(Math.min(to, cur.length), 0, m); }
      pkmBagSave(cur);
      if (cur[0][0] !== GM_getValue("pkm_starter_id")) pkmMakeActive(cur[0][0]);
      drawBag();
    };
  }
  function pkmBagAction(a, btn, box) {
    const list = pkmBagList();
    const idx = list.findIndex(([id]) => id === pkmBag.sel);
    const sel = idx >= 0 ? list[idx] : null;
    if (a === "close") return closeBag();
    if (a === "shop") return openShop();
    if (a === "use") { pkmUseItem(btn.dataset.k); return drawBag(); }
    if (a === "prev" || a === "next") { setInt(STORAGE.BOX_ID, box + (a === "next" ? 1 : -1)); return drawBag(); }
    if (!sel) return;
    const [id, mon] = sel;
    if (a === "active") { pkmMakeActive(id); pkmToast(`★ ${mon.name} is now your partner`); return drawBag(); }
    if (a === "toparty") {
      const t = Math.min(PKM_PARTY_SIZE - 1, list.length - 1);
      [list[idx], list[t]] = [list[t], list[idx]];
      pkmBagSave(list);
      return drawBag(`${mon.name} joined your party.`);
    }
    if (a === "tostorage") {
      list.splice(idx, 1);
      list.push(sel);
      pkmBagSave(list);
      return drawBag(`${mon.name} went to storage.`);
    }
    if (a === "sell") {
      if (pkmBag.confirmSell !== id) { pkmBag.confirmSell = id; return drawBag(); }
      const value = pkmMonValue(id, mon);
      const party = getObj(STORAGE.party) || {};
      delete party[id];
      setObj(STORAGE.party, party);
      const st = getObj(STORAGE.stats) || {};
      delete st[id];
      setObj(STORAGE.stats, st);
      setInt(STORAGE.coins, getInt(STORAGE.coins) + value);
      pkmTrack("coins", value);
      pkmBag.sel = null;
      pkmBag.confirmSell = null;
      pkmToast(`💰 Sold ${mon.name} for ${value} coins`);
      return drawBag();
    }
  }
  // --- Fetch Pokémon ID by name ---
  function getPokeIdByName(name) {
    return new Promise((resolve) => {
      console.log("Fetching Pokémon ID for:", name);
      pkmXhr({
        method: "GET",
        url: `https://pokeapi.co/api/v2/pokemon/${name.toLowerCase()}`,
        onload(res) {
          try {
            const d = JSON.parse(res.responseText);
            resolve(d.id);
          } catch (err) {
            console.warn("Failed to fetch Pokémon ID:", err);
            resolve(null);
          }
        },
        onerror(err) {
          console.warn("Failed to fetch Pokémon ID:", err);
          resolve(null);
        },
      });
    });
  }

  // === Rarity helpers ===
  const RARITY = {
    common: 10,
    uncommon: 30,
    rare: 100,
    legendary: 300,
  };

  function getRarity(name) {
    name = name.toLowerCase();

    // === Mythical Pokémon (Highest tier) ===
    const mythicals = [
      "mew",
      "celebi",
      "jirachi",
      "deoxys",
      "phione",
      "manaphy",
      "darkrai",
      "shaymin",
      "arceus",
      "victini",
      "keldeo",
      "meloetta",
      "genesect",
      "diancie",
      "hoopa",
      "volcanion",
      "magearna",
      "marshadow",
      "zeraora",
      "meltan",
      "melmetal",
      "zarude",
      "pecharunt",
    ];

    // === Legendary Pokémon ===
    const legendaries = [
      "mewtwo",
      "lugia",
      "ho-oh",
      "kyogre",
      "groudon",
      "rayquaza",
      "dialga",
      "palkia",
      "giratina",
      "reshiram",
      "zekrom",
      "kyurem",
      "xerneas",
      "yveltal",
      "zygarde",
      "solgaleo",
      "lunala",
      "necrozma",
      "zacian",
      "zamazenta",
      "eternatus",
      "calyrex",
      "koraidon",
      "miraidon",
      "terapagos",
    ];

    // === Sub-Legendary Pokémon ===
    const subLegendaries = [
      "articuno",
      "zapdos",
      "moltres",
      "raikou",
      "entei",
      "suicune",
      "regirock",
      "regice",
      "registeel",
      "latias",
      "latios",
      "uxie",
      "mesprit",
      "azelf",
      "heatran",
      "regigigas",
      "cresselia",
      "cobalion",
      "terrakion",
      "virizion",
      "tornadus",
      "thundurus",
      "landorus",
      "type: null",
      "silvally",
      "tapu koko",
      "tapu lele",
      "tapu bulu",
      "tapu fini",
      "nihilego",
      "buzzwole",
      "pheromosa",
      "xurkitree",
      "celesteela",
      "kartana",
      "guzzlord",
      "poipole",
      "naganadel",
      "stakataka",
      "blacephalon",
      "kubfu",
      "urshifu",
      "regieleki",
      "regidrago",
      "glastrier",
      "spectrier",
      "enamorus",
      "wo-chien",
      "chien-pao",
      "ting-lu",
      "chi-yu",
      "okidogi",
      "munkidori",
      "fezandipiti",
      "ogerpon",
    ];

    // === Rare + Uncommon ===
    const rares = [
      "dragonite",
      "tyranitar",
      "salamence",
      "metagross",
      "garchomp",
      "hydreigon",
      "goodra",
      "dragapult",
    ];
    const uncommons = ["pikachu", "eevee", "lucario", "snorlax", "gengar"];

    if (mythicals.includes(name)) return "mythical";
    if (legendaries.includes(name)) return "legendary";
    if (subLegendaries.includes(name)) return "sublegendary";
    if (rares.includes(name)) return "rare";
    if (uncommons.includes(name)) return "uncommon";
    return "common";
  }

  function getTypesForName(name, pokedexArr) {
    const fixed = String(name || "").toLowerCase();
    const d = (pokedexArr || []).find(
      (p) => String(p.name || "").toLowerCase() === fixed
    );
    return Array.isArray(d?.types) ? d.types : [];
  }

  // --- Unique IDs --------------------------------------------------------------
  function generateUniqueId(baseName) {
    const base = String(baseName || "")
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "");
    const t = Date.now().toString(36);
    const r = Math.floor(Math.random() * 1e6).toString(36);
    return `${base}_${t}_${r}`;
  }

  // (Optional) where to remember the exact active instance
  const STARTER_ID_KEY = "pkm_starter_id";

  // --- Instance-aware Stats ----------------------------------------------------
  // Stats per unique instance (fallback to species-by-name if not present)
  function getStatsForInstance(id, speciesName) {
    const all = getObj(STORAGE.stats);
    if (all[id]) return all[id];
    // fallback to species stats, then clone into instance key
    const base = getStats(speciesName);
    all[id] = { ...base };
    setObj(STORAGE.stats, all);
    return all[id];
  }

  function setStatsForInstance(id, stats) {
    const all = getObj(STORAGE.stats);
    all[id] = stats;
    setObj(STORAGE.stats, all);
  }

  function listDuplicateIds() {
    const party = getObj(STORAGE.party) || {};
    const nameCount = {};
    for (const id in party) {
      const name = party[id].name;
      nameCount[name] = (nameCount[name] || 0) + 1;
    }
    console.log("📜 Pokémon counts:", nameCount);
  }
  function migrateLegacyStarter() {
    const starter = getStr(STORAGE.starter);
    const starterId = GM_getValue("pkm_starter_id");
    const party = getObj(STORAGE.party);

    if (!starter || !Array.isArray(party)) return;

    // If no ID yet, link the first matching Pokémon instance
    if (!starterId) {
      const found = party.find(
        (p) => p.name.toLowerCase() === starter.toLowerCase()
      );
      if (found) {
        GM_setValue("pkm_starter_id", found.id);
        console.log(`🧬 Migrated starter ${starter} → ${found.id}`);
      } else {
        console.warn(`⚠️ Starter ${starter} not found in party.`);
      }
    }
  }

  async function migratePartyToInstancesIfNeeded() {
    const party = getObj(STORAGE.party);
    if (!party || typeof party !== "object") return;

    const alreadyInstance =
      Array.isArray(party) ||
      Object.values(party).some(
        (v) => v && typeof v === "object" && v.name && v.caughtAt
      );
    if (alreadyInstance) {
      console.log("🟢 Party already in instance format.");
      return;
    }

    console.log("⚙️ Migrating legacy party → instance format...");
    const newParty = {};
    const oldStats = getObj(STORAGE.stats) || {};
    const newStats = { ...oldStats };

    for (const [speciesName, count] of Object.entries(party)) {
      const qty = Math.max(0, parseInt(count, 10) || 0);
      for (let i = 0; i < qty; i++) {
        const id = generateUniqueId(speciesName);
        newParty[id] = { name: speciesName, caughtAt: Date.now() + i };
        const base = getStats(speciesName) || {
          level: 1,
          xp: 0,
          hp: 100,
          atk: 15,
        };
        newStats[id] = { ...base };
      }
    }

    // ✅ Ensure legacy starter (pignite) exists in new party
    const oldStarter = getStr(STORAGE.starter);
    if (
      oldStarter &&
      !Object.values(newParty).some(
        (p) => p.name?.toLowerCase() === oldStarter.toLowerCase()
      )
    ) {
      const id = generateUniqueId(oldStarter);
      newParty[id] = { name: oldStarter, caughtAt: Date.now() };
      const base = getStats(oldStarter) || {
        level: 1,
        xp: 0,
        hp: 100,
        atk: 15,
      };
      newStats[id] = { ...base };
      GM_setValue("pkm_starter_id", id);
      console.log(`🔥 Added missing legacy starter '${oldStarter}' → ${id}`);
    }

    // ✅ Commit migration
    setObj(STORAGE.party, newParty);
    setObj(STORAGE.stats, newStats);
    console.log("✅ Party migrated to instance format:", newParty);

    // ✅ Fallback: choose first Pokémon if none linked
    let starterId = GM_getValue("pkm_starter_id");
    if (!starterId && Object.keys(newParty).length > 0) {
      const firstId = Object.keys(newParty)[0];
      GM_setValue("pkm_starter_id", firstId);
      setStr(STORAGE.starter, newParty[firstId].name);
      console.log(
        `🌟 Auto-selected starter '${newParty[firstId].name}' (${firstId})`
      );
    }
  }

  function closeBag() {
    if (bagPanel) bagPanel.remove();
    bagPanel = null;
    renderHeader();
  }
  function resetGameData() {
    if (
      !confirm(
        "⚠️ Are you sure you want to reset your game? This cannot be undone."
      )
    )
      return;

    const keys = Object.values(STORAGE).concat([
      "pkm_great_balls",
      "pkm_ultra_balls",
      "pkm_random_battles",
    ]);

    for (const key of keys) {
      GM_setValue(key, null);
    }

    alert("Game reset complete. Reloading...");
    location.reload();
  }
  // === Debug & Save Utilities ===
  const LOG_KEY = "pkm_logs";

  function pushLog(entry) {
    const logs = getArr(LOG_KEY);
    logs.push({ t: new Date().toISOString(), ...entry });
    setArr(LOG_KEY, logs.slice(-500)); // cap to last 500
  }

  // Global error hooks
  window.addEventListener("error", (e) => {
    pushLog({
      type: "error",
      msg: String(e.message || e.error || "Unknown error"),
      url: e.filename,
      line: e.lineno,
      col: e.colno,
      stack: (e.error && e.error.stack) || "",
    });
  });
  window.addEventListener("unhandledrejection", (e) => {
    pushLog({
      type: "unhandledrejection",
      msg: String(e.reason),
      stack: (e.reason && e.reason.stack) || "",
    });
  });

  // Export/Import save
  function exportSave() {
    const bundle = pkmCollectSave(); // every game key, same as the automatic backups
    const blob = new Blob([JSON.stringify(bundle, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement("a"), {
      href: url,
      download: `pokemon_save_${new Date().toISOString().slice(0, 10)}.json`,
    });
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  /** Read a save file and show a preview first; nothing changes until you press "Load this save". */
  function importSave(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      let obj;
      try { obj = JSON.parse(reader.result); } catch { return pkmToast("Import failed: that isn't a valid save file"); }
      if (!obj || typeof obj !== "object" || Array.isArray(obj)) return pkmToast("Import failed: that isn't a save file");
      const clean = {};
      for (const [k, v] of Object.entries(obj)) if (pkmIsSaveKey(k)) clean[k] = v;
      if (!Object.keys(clean).length) return pkmToast("That file has no Pokémon save data");
      pkmPreviewSave(clean, `File: ${file.name}`);
    };
    reader.readAsText(file);
  }
  let debugPanel = null;
  function closeDebug() {
    if (debugPanel) debugPanel.remove();
    debugPanel = null;
  }
  function openDebugPanel() {
    if (debugPanel) return;
    const panel = (debugPanel = document.createElement("div"));
    Object.assign(panel.style, {
      position: "fixed",
      top: "50%",
      left: "50%",
      transform: "translate(-50%,-50%)",
      zIndex: 11000,
      background: "#111",
      color: "#fff",
      padding: "12px",
      border: "2px solid #fff",
      width: "520px",
      maxHeight: "80vh",
      overflowY: "auto",
      fontFamily: "monospace",
    });
    const logs = getArr(LOG_KEY);
    const pre = document.createElement("pre");
    pre.textContent = (
      logs.length
        ? logs
        : [{ t: new Date().toISOString(), type: "info", msg: "No logs yet" }]
    )
      .map(
        (l) =>
          `[${l.t}] ${l.type || "info"}: ${l.msg}${
            l.stack ? "\n" + l.stack : ""
          }`
      )
      .join("\n\n");

    const btns = document.createElement("div");
    btns.style.marginTop = "8px";
    const copyBtn = createButton(
      "Copy Logs",
      () => {
        navigator.clipboard.writeText(pre.textContent);
        alert("Copied.");
      },
      "btn btn-success btn-sm"
    );
    const clearBtn = createButton(
      "Clear Logs",
      () => {
        setArr(LOG_KEY, []);
        closeDebug();
        openDebugPanel();
      },
      "btn btn-warning btn-sm"
    );
    const closeBtn = createButton(
      "Close",
      () => closeDebug(),
      "btn btn-success btn-sm"
    );

    const exportBtn = createButton(
      "Export Save",
      exportSave,
      "btn btn-success btn-sm"
    );
    const importLbl = document.createElement("label");
    importLbl.textContent = " Import Save: ";
    const importInput = document.createElement("input");
    importInput.type = "file";
    importInput.accept = ".json,application/json";
    importInput.onchange = () => importSave(importInput.files[0]);

    btns.append(
      copyBtn,
      document.createTextNode(" "),
      clearBtn,
      document.createTextNode("  |  "),
      exportBtn,
      importLbl,
      importInput,
      document.createTextNode("  "),
      closeBtn
    );

    panel.append("Debug Panel", document.createElement("hr"), pre, btns);
    pkmMount(panel);
  }
  // Added //
  function syncCSS(url, id) {
    const ex = [
      ...document.head.querySelectorAll('link[rel="stylesheet"]'),
    ].find((l) => l.href.includes(id));
    if (ex) ex.href = url;
    else {
      const l = document.createElement("link");
      l.rel = "stylesheet";
      l.href = url;
      document.head.appendChild(l);
    }
  }
  function syncJS(url, id) {
    const ex = [...document.head.querySelectorAll("script[src]")].find((s) =>
      s.src.includes(id)
    );
    if (ex) ex.src = url;
    else {
      const s = document.createElement("script");
      s.src = url;
      document.head.appendChild(s);
    }
  }

  // =====================================================================
  //  3.3: menus, launcher, one-panel-at-a-time, Esc, typing auto-hide,
  //       backups with preview, keyboard battles, reduced motion
  // =====================================================================
  function pkmEsc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function pkmToast(msg, ms = 2800) {
    const t = document.createElement("div");
    t.className = "pkm-toast";
    t.setAttribute("role", "status");
    t.textContent = msg;
    pkmMount(t);
    requestAnimationFrame(() => t.classList.add("show"));
    setTimeout(() => { t.classList.remove("show"); setTimeout(() => t.remove(), 300); }, ms);
  }
  function pkmReducedMotion() {
    try { return matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; }
  }
  try {
    matchMedia("(prefers-reduced-motion: reduce)").addEventListener("change", () => {
      if (spriteEl && spriteEl.src) spawnWalkingSprite(spriteEl.src);
    });
  } catch {}

  // ---------- Focus / typing helpers (see through other shadow roots) ----------
  function pkmDeepActive() {
    let a = document.activeElement;
    while (a && a.shadowRoot && a.shadowRoot.activeElement) a = a.shadowRoot.activeElement;
    return a;
  }
  function pkmIsEditable(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.isContentEditable) return true;
    if (el.tagName === "TEXTAREA") return !el.readOnly;
    if (el.tagName === "INPUT") return !el.readOnly && !/^(button|submit|reset|checkbox|radio|range|color|file|image|hidden)$/i.test(el.type);
    return false;
  }
  const pkmAutoHideOn = () => GM_getValue("pkm_autohide_typing", "true") === "true";
  let pkmTyping = false;
  function pkmSetTyping(on) {
    pkmTyping = on;
    PKM.classList.toggle("pkm-typing", on);
  }
  // Hide only while keys are actually being pressed in a page field, then come back 2.5 s later.
  // (Hiding on focus kept the game hidden on ServiceNow, which keeps a field focused all the time.)
  let pkmTypingTimer = 0;
  document.addEventListener("keydown", (e) => {
    if (!pkmAutoHideOn()) return;
    const path = e.composedPath();
    if (path.includes(PKM_HOST) || !pkmIsEditable(path[0])) return;
    if (e.key === "Escape" || e.key === "Tab" || e.ctrlKey || e.altKey || e.metaKey) return;
    pkmSetTyping(true);
    clearTimeout(pkmTypingTimer);
    pkmTypingTimer = setTimeout(() => pkmSetTyping(false), 2500);
  }, true);
  // ---------- HUD visibility / position ----------
  function pkmClampHud() {
    if (!wrap.isConnected || wrap.classList.contains("pkm-hud-hidden") || !wrap.style.top) return;
    const r = wrap.getBoundingClientRect();
    if (!r.width) return;
    const x = Math.max(0, Math.min(window.innerWidth - r.width, r.left));
    const y = Math.max(0, Math.min(window.innerHeight - r.height, r.top));
    if (x !== r.left) wrap.style.left = x + "px";
    if (y !== r.top) wrap.style.top = y + "px";
  }
  function pkmSetHudHidden(hidden, hint) {
    setBool("pkm_hud_hidden", hidden);
    wrap.classList.toggle("pkm-hud-hidden", hidden);
    if (!hidden) requestAnimationFrame(pkmClampHud);
    if (hidden && hint) pkmToast("HUD hidden. Click the Poké Ball on the left edge to bring it back.");
  }
  function pkmResetHud() {
    setStr("pkm_wrap_pos", "");
    Object.assign(wrap.style, { left: "0px", top: "", bottom: "0px" });
    pkmSetHudHidden(false, false);
  }
  window.addEventListener("resize", () => requestAnimationFrame(pkmClampHud));
  {
    const rh = renderHeader;
    renderHeader = async function (...a) {
      const r = await rh.apply(this, a);
      requestAnimationFrame(pkmClampHud);
      return r;
    };
  }

  // ---------- Save data: collect / backups / preview / apply ----------
  const PKM_NOSAVE = /^(pkm_cache:|pkm_cache_idx$|pkm_bootstrap_css|pkm_backups$|pkm_logs$|pkm_battle_logs$|pkm_update_|pkm_disabled_sites$|pkm_wrap_pos$|pkm_hud_hidden$)/;
  const pkmIsSaveKey = (k) => /^(pkm_|BOX_ID$)/.test(k) && !PKM_NOSAVE.test(k);
  function pkmCollectSave() {
    let keys = [];
    try { keys = GM_listValues() || []; } catch {}
    if (!keys.length) {
      keys = Object.values(STORAGE).concat(["pkm_great_balls", "pkm_ultra_balls", "pkm_master_balls", "pkm_random_battles", "pkm_starter_id", "pkm_xattack", "pkm_revive"]);
    }
    const out = {};
    for (const k of keys) {
      if (!pkmIsSaveKey(k)) continue;
      const v = GM_getValue(k);
      if (v !== undefined && v !== null) out[k] = v;
    }
    return out;
  }
  const PKM_BACKUP_KEY = "pkm_backups";
  function pkmBackups() {
    try { const a = JSON.parse(GM_getValue(PKM_BACKUP_KEY, "[]")); return Array.isArray(a) ? a : []; } catch { return []; }
  }
  function pkmBackupNow(reason = "manual") {
    const list = pkmBackups();
    list.push({ t: Date.now(), reason, data: pkmCollectSave() });
    while (list.length > 4) list.shift();
    GM_setValue(PKM_BACKUP_KEY, JSON.stringify(list));
  }
  function pkmSaveSummary(d) {
    const j = (k, def) => { try { const v = d[k]; return typeof v === "string" ? JSON.parse(v) : v == null ? def : v; } catch { return def; } };
    const party = j("pkm_party", {}) || {};
    const dex = j("pkm_pokedex", []);
    const sid = d.pkm_starter_id;
    return {
      coins: parseInt(d.pkm_coins, 10) || 0,
      balls: parseInt(d.pkm_balls, 10) || 0,
      party: typeof party === "object" ? Object.keys(party).length : 0,
      dex: Array.isArray(dex) ? dex.length : 0,
      starter: (sid && party[sid] && party[sid].name) || d.pkm_starter || "—",
    };
  }
  let pkmPreviewPanel = null;
  function pkmClosePreview() {
    if (pkmPreviewPanel) pkmPreviewPanel.remove();
    pkmPreviewPanel = null;
  }
  function pkmPreviewSave(data, source) {
    pkmClosePreview();
    const now = pkmSaveSummary(pkmCollectSave());
    const nxt = pkmSaveSummary(data);
    const row = (label, k) => `<tr><td>${label}</td><td>${pkmEsc(now[k])}</td><td${now[k] !== nxt[k] ? ' class="pkm-chg"' : ""}>${pkmEsc(nxt[k])}</td></tr>`;
    const p = (pkmPreviewPanel = document.createElement("div"));
    p.className = "pkm-panel pkm-set pkm-modal pkm-preview";
    p.setAttribute("role", "dialog");
    p.setAttribute("aria-label", "Load save");
    p.innerHTML = `
      <div class="pkm-set-head"><span>📦 Load this save?</span><button type="button" class="pkm-x" data-a="cancel" aria-label="Close">✕</button></div>
      <div class="pkm-set-sec">
        <div class="pkm-dim">${pkmEsc(source)}</div>
        <table class="pkm-cmp"><tr><th></th><th>Now</th><th>After loading</th></tr>
          ${row("Partner", "starter")}${row("Coins", "coins")}${row("Poké Balls", "balls")}${row("Pokémon owned", "party")}${row("Pokédex entries", "dex")}
        </table>
        <div class="pkm-dim">Your current save is backed up first, so you can undo this in Settings → Save data.</div>
      </div>
      <div class="pkm-set-sec pkm-btns" style="justify-content:flex-end">
        <button type="button" class="pkm-btn2" data-a="cancel">Cancel</button>
        <button type="button" class="pkm-btn2 primary" data-a="apply">Load this save</button>
      </div>`;
    p.onclick = (e) => {
      const a = e.target.closest("[data-a]")?.dataset.a;
      if (a === "cancel") pkmClosePreview();
      if (a === "apply") { pkmClosePreview(); pkmApplySave(data); }
    };
    pkmMount(p);
    p.querySelector('[data-a="apply"]').focus();
  }
  function pkmApplySave(data) {
    pkmBackupNow("before loading a save");
    for (const [k, v] of Object.entries(data)) {
      if (!pkmIsSaveKey(k)) continue;
      if (v === null || v === undefined) GM_deleteValue(k);
      else GM_setValue(k, v);
    }
    pkmRefreshAll();
    pkmToast("Save loaded ✓");
  }
  /** Re-read everything from storage without reloading the page. */
  function pkmRefreshAll() {
    for (const [n, get, close] of PKM_PANELS) {
      if (!get()) continue;
      try { n === "battle" ? closeBattle() : close(); } catch {}
    }
    SOUNDS.battleSound.pause();
    randomBattleEnabled = getBool("pkm_random_battles");
    clearTimeout(randomBattleTimer);
    nextBattleTime = null;
    if (randomBattleEnabled) scheduleRandomBattle();
    const vol = parseFloat(getStr(STORAGE.volume, "0.4"));
    if (!isNaN(vol)) Object.values(SOUNDS).forEach((a) => { if (a instanceof Audio) a.volume = vol; });
    wrap.classList.toggle("pkm-hud-hidden", getBool("pkm_hud_hidden"));
    if (walkInterval) clearInterval(walkInterval);
    if (spriteWrapperEl) spriteWrapperEl.remove();
    spriteWrapperEl = null;
    partnerSpriteUrl = null;
    renderHeader();
    initPartner();
  }
  // Weekly automatic backup
  try {
    const list = pkmBackups();
    const last = list.length ? list[list.length - 1].t : 0;
    if (Date.now() - last > 7 * 864e5) pkmBackupNow("weekly");
  } catch (e) {
    console.warn("Pokémon weekly backup failed:", e);
  }

  // ---------- Turn the game off on this site ----------
  function pkmTurnOffHere(skipConfirm) {
    const h = location.hostname.toLowerCase();
    if (!skipConfirm && !confirm(`Turn the Pokémon game off on ${h}?\n\nTurn it back on from the Tampermonkey menu on this site, or in Settings > Sites on any other site.`)) return false;
    if (!pkmSiteOff()) pkmSetDisabledSites(pkmDisabledSites().concat(h));
    for (const [, get, close] of PKM_PANELS) if (get()) try { close(); } catch {}
    randomBattleEnabled = false;
    clearTimeout(randomBattleTimer);
    if (walkInterval) clearInterval(walkInterval);
    try { SOUNDS.battleSound.pause(); } catch {}
    pkmUsed = false;
    PKM_HOST.remove();
    return true;
  }

  // ---------- One panel at a time + Esc ----------
  // Order matters for Esc: the top-most panel closes first.
  let pkmBattleLeaving = false;
  const PKM_PANELS = [
    ["detail", () => detailPanel, () => { detailPanel.remove(); detailPanel = null; }],
    ["preview", () => pkmPreviewPanel, () => pkmClosePreview()],
    ["starter", () => starterPanel, () => closeStarter()],
    ["battle", () => battlePanel, () => { if (!pkmBattleLeaving) { pkmBattleLeaving = true; runAway(); } }],
    ["dex", () => pokedexPanel, () => closePokedex()],
    ["settings", () => settingsPanel, () => closeSettings()],
    ["shop", () => shopPanel, () => closeShop()],
    ["bag", () => bagPanel, () => closeBag()],
    ["debug", () => debugPanel, () => closeDebug()],
  ];
  function pkmOpenPanel() {
    const p = PKM_PANELS.find(([, get]) => get());
    return p ? p[0] : null;
  }
  function pkmExclusive(name, fn, after) {
    return function (...args) {
      if (name === "battle" && battlePanel) return;
      if (name !== "battle" && battlePanel) { pkmToast("Finish the battle first (Esc runs away)"); return; }
      for (const [n, get, close] of PKM_PANELS) if (n !== name && get()) try { close(); } catch {}
      const r = fn.apply(this, args);
      try { after && after(args); } catch (e) { console.warn(e); }
      return r;
    };
  }
  let pkmBattleKbd = false;
  let pkmBattleIdx = 0;
  openBattle = pkmExclusive("battle", openBattle, (args) => {
    const auto = !!(args[0] && args[0].auto);
    pkmBattleLeaving = false;
    pkmBattleIdx = 0;
    // Random battles never grab the keyboard (you might be typing); battles you start do.
    pkmBattleKbd = !auto && !pkmIsEditable(pkmDeepActive());
    if (battlePanel) battlePanel.addEventListener("pointerdown", () => (pkmBattleKbd = true));
  });
  openShop = pkmExclusive("shop", openShop, () => shopPanel && shopPanel.classList.add("pkm-panel"));
  openBag = pkmExclusive("bag", openBag);
  openPokedex = pkmExclusive("dex", openPokedex);
  openSettings = pkmExclusive("settings", openSettings);
  openStarter = pkmExclusive("starter", openStarter, () => starterPanel && starterPanel.classList.add("pkm-panel"));
  openDebugPanel = pkmExclusive("debug", openDebugPanel, () => debugPanel && debugPanel.classList.add("pkm-panel"));

  document.addEventListener("keydown", (e) => {
    const path = e.composedPath();
    const inGame = path.includes(PKM_HOST);
    const target = path[0];
    if (!inGame && pkmIsEditable(pkmDeepActive())) return; // the page's own typing is never touched
    if (e.key === "Escape") {
      if (pkmLauncherOpen) { e.preventDefault(); e.stopPropagation(); pkmLauncherMenu(false); pkmLauncher.focus(); return; }
      const p = PKM_PANELS.find(([, get]) => get());
      if (!p) return;
      e.preventDefault();
      e.stopPropagation();
      p[2]();
      return;
    }
    // Battle shortcuts 1-9 (the number is shown on each move)
    if (battlePanel && /^[1-9]$/.test(e.key) && !e.ctrlKey && !e.altKey && !e.metaKey && !pkmIsEditable(target)) {
      const b = battlePanel.querySelectorAll(".pk-controls button")[+e.key - 1];
      if (b && !b.disabled) { e.preventDefault(); e.stopPropagation(); pkmBattleKbd = true; b.click(); }
    }
  }, true);

  // ---------- Keyboard battle moves ----------
  function pkmBattleKeys(ctl) {
    const all = [...ctl.querySelectorAll("button")];
    ctl.setAttribute("role", "toolbar");
    ctl.setAttribute("aria-label", "Battle moves. Arrow keys move, Enter uses, 1 to 9 are shortcuts");
    all.forEach((b, i) => {
      const lbl = b.querySelector(".pk-label")?.textContent || "";
      const cnt = b.querySelector(".pk-badge")?.textContent;
      b.setAttribute("aria-label", cnt != null ? `${lbl}, ${cnt} left` : lbl);
      if (i < 9) {
        b.title = `${lbl} (key ${i + 1})`;
        const k = document.createElement("span");
        k.className = "pk-key";
        k.setAttribute("aria-hidden", "true");
        k.textContent = i + 1;
        b.appendChild(k);
      }
      b.tabIndex = -1;
      b.addEventListener("focus", () => (pkmBattleIdx = i));
    });
    const enabled = all.filter((b) => !b.disabled);
    const start = all[pkmBattleIdx] && !all[pkmBattleIdx].disabled ? all[pkmBattleIdx] : enabled[0];
    if (start) start.tabIndex = 0;
    ctl.addEventListener("keydown", (e) => {
      const cur = all.indexOf(e.target.closest ? e.target.closest("button") : null);
      if (cur < 0 || !enabled.length) return;
      pkmBattleKbd = true;
      let n = null;
      const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 4, ArrowUp: -4 }[e.key];
      if (step) {
        n = cur;
        for (let t = 0; t < all.length; t++) { n = (n + step + all.length) % all.length; if (!all[n].disabled) break; }
      } else if (e.key === "Home") n = all.indexOf(enabled[0]);
      else if (e.key === "End") n = all.indexOf(enabled[enabled.length - 1]);
      if (n === null) return;
      e.preventDefault();
      all.forEach((b) => (b.tabIndex = -1));
      all[n].tabIndex = 0;
      all[n].focus();
    });
    if (pkmBattleKbd && start) start.focus({ preventScroll: true });
  }

  // ---------- Side launcher (Poké Ball on the left edge) + quick menu ----------
  const pkmLauncher = document.createElement("button");
  pkmLauncher.type = "button";
  pkmLauncher.className = "pkm-launcher";
  pkmLauncher.title = "Pokémon menu (right-click: show/hide HUD)";
  pkmLauncher.setAttribute("aria-label", "Pokémon menu");
  pkmLauncher.setAttribute("aria-haspopup", "menu");
  pkmLauncher.setAttribute("aria-expanded", "false");
  pkmLauncher.innerHTML = '<span class="pkm-ball" aria-hidden="true"></span>';
  const pkmMenu = document.createElement("div");
  pkmMenu.className = "pkm-menu";
  pkmMenu.setAttribute("role", "menu");
  pkmMenu.hidden = true;
  let pkmLauncherOpen = false;
  function pkmLauncherMenu(open) {
    pkmLauncherOpen = open;
    pkmLauncher.setAttribute("aria-expanded", String(open));
    if (!open) { pkmMenu.hidden = true; return; }
    const hudHidden = wrap.classList.contains("pkm-hud-hidden");
    // 4.1: the menu is a side panel with groups and a search box, so it fits on small screens.
    const groups = [
      ["⚔️ Play", [
        ["⚔️", "Battle", () => openBattle()],
        ["🏅", "Trainers & Gyms", () => pkmOpenTrainers()],
        ["🗺️", "World map", () => pkmOpenMap()],
        ["🦒", "Safari Zone", () => pkmOpenSafari()],
        ["🗺️", "Habitat map", () => pkmOpenHabitats()],
        ["🌀", "Ultra Wormholes", () => pkmOpenWormholes()],
        ["🦹", "Villain teams", () => pkmOpenVillains()],
        ["🕳️", "Mystery Dungeon", () => pkmOpenDungeon()],
        ["🔥", "Raid den", () => pkmOpenRaids()],
        ["📖", "Story", () => pkmOpenStory()],
      ]],
      ["🎒 Pokémon", [
        ["🎒", "Bag", () => openBag()],
        ["📕", "Pokédex", () => openPokedex()],
        ["🏥", `Pokémon Center (${POKE_CENTER_COST})`, () => pokeCenter()],
        ["🥚", "Daycare & Eggs", () => pkmOpenDaycare()],
        ["⛺", "Pokémon Camp", () => pkmOpenCamp()],
        ["🏋️", "Training center", () => pkmOpenTraining()],
        ["💿", "Move tutor & TMs", () => pkmOpenTutor()],
        ["📦", "Box tools", () => pkmOpenBox()],
        ["🪦", "Nuzlocke & graveyard", () => pkmOpenNuzlocke()],
      ]],
      ["🏆 Challenges", [
        ["🗼", "Battle Tower", () => pkmOpenTower()],
        ["🏟️", "Battle Frontier", () => pkmOpenFrontier()],
        ["📈", "Weekly ladder", () => pkmOpenLadder()],
        ["🎯", "Type specialist", () => pkmOpenTypeChal()],
        ["🌟", "Legendary hunt", () => pkmOpenLegends()],
        ["🎀", "Contests", () => pkmOpenContests()],
      ]],
      ["🛒 Shop & rewards", [
        ["🛒", "Shop", () => openShop()],
        ["📍", "PokéStop", () => openPokeStop()],
        ["🎁", "Daily reward", () => pkmOpenDaily()],
        ["📋", "Daily quests", () => pkmOpenBadges("quests")],
        ["🏵️", "Pokédex prizes", () => pkmOpenBadges("dex")],
        ["🛠️", "Crafting bench", () => pkmOpenCraft()],
        ["🫐", "Berry garden", () => pkmOpenGarden()],
        ["🎟️", "Season pass", () => pkmOpenSeason()],
      ]],
      ["👥 You & friends", [
        ["🪪", "Badges & stats", () => pkmOpenBadges()],
        ["🌐", "Online: GTS, Home, Wonder", () => pkmOpenOnline()],
        ["⚔️", "Live battle", () => pkmOpenOnline("live")],
        ["💬", "Trade chat", () => pkmOpenOnline("chat")],
        ["🛡️", "Guild", () => pkmOpenOnline("guild")],
        ["🧾", "Trade history", () => pkmOpenOnline("history")],
        ["👥", "Friends & gifts", () => pkmOpenOnline("friends")],
        ["🏆", "Leaderboards", () => pkmOpenOnline("ranks")],
        ["🎉", "Events & shared raid", () => pkmOpenOnline("events")],
        ["🎀", "Online contest", () => pkmOpenOnline("contest")],
        ["🔗", "Link & gifts", () => pkmOpenLink()],
        ["🧢", "Trainer look", () => pkmOpenLook()],
        ["📊", "Species progress", () => pkmOpenBadges("species")],
        ["💾", "Save code", () => pkmOpenSaveCode()],
      ]],
      ["⚙️ Settings", [
        [hudHidden ? "👁️" : "🙈", hudHidden ? "Show HUD" : "Hide HUD", () => pkmSetHudHidden(!hudHidden, false)],
        ["📌", "Reset HUD position", () => pkmResetHud()],
        ["🛠️", "Options & tools", () => pkmOpenOptions()],
        ["🆕", "What's new & updates", () => pkmOpenOptions("new")],
        ["⚙️", "Settings", () => openSettings()],
        ["🚫", `Turn off on ${location.hostname}`, () => pkmTurnOffHere()],
      ]],
    ];
    const upd = GM_getValue("pkm_update_remote", "");
    const hasUpd = !!upd && updater.compareVersions(upd, cfg.CURRENT_VERSION) > 0;
    pkmMenu.innerHTML = `<div class="pkm-menu-head"><span>Pokémon</span><span class="pkm-dim">💰 ${getInt(STORAGE.coins)}</span><button type="button" class="pkm-x pkm-menu-x" aria-label="Close menu" title="Close (Esc)">✕</button></div>
      ${hasUpd ? `<button type="button" class="pkm-menu-upd">⬆️ Update ${pkmEsc(upd)} is ready. Install it</button>` : ""}
      <input type="search" class="pkm-menu-q" placeholder="Find…" aria-label="Find a menu item">
      <div class="pkm-menu-list"></div>`;
    const list = pkmMenu.querySelector(".pkm-menu-list");
    for (const [title, items] of groups) {
      const sec = document.createElement("div");
      sec.className = "pkm-menu-grp";
      sec.innerHTML = `<div class="pkm-menu-gt">${pkmEsc(title)}</div><div class="pkm-menu-grid"></div>`;
      const grid = sec.querySelector(".pkm-menu-grid");
      for (const it of items) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "pkm-menu-item";
        b.setAttribute("role", "menuitem");
        b.dataset.q = it[1].toLowerCase();
        b.innerHTML = `<span class="ico" aria-hidden="true">${it[0]}</span><span>${pkmEsc(it[1])}</span>`;
        b.onclick = () => { pkmLauncherMenu(false); try { it[2](); } catch (err) { console.warn(err); pkmToast("That isn't ready yet. Try again in a moment."); } };
        grid.appendChild(b);
      }
      list.appendChild(sec);
    }
    pkmMenu.querySelector(".pkm-menu-x").onclick = () => { pkmLauncherMenu(false); pkmLauncher.focus(); };
    const ub = pkmMenu.querySelector(".pkm-menu-upd");
    if (ub) ub.onclick = () => { pkmLauncherMenu(false); window.open(cfg.DOWNLOAD_URL, "_blank"); };
    const q = pkmMenu.querySelector(".pkm-menu-q");
    q.oninput = () => {
      const s = q.value.trim().toLowerCase();
      pkmMenu.querySelectorAll(".pkm-menu-item").forEach((b) => { b.hidden = !!s && !b.dataset.q.includes(s); });
      pkmMenu.querySelectorAll(".pkm-menu-grp").forEach((g) => { g.hidden = ![...g.querySelectorAll(".pkm-menu-item")].some((b) => !b.hidden); });
    };
    q.onkeydown = (e) => { if (e.key === "Enter") { const first = pkmMenu.querySelector(".pkm-menu-item:not([hidden])"); if (first) first.click(); } else if (e.key === "ArrowDown") { e.preventDefault(); pkmMenu.querySelector(".pkm-menu-item:not([hidden])")?.focus(); } };
    pkmMenu.hidden = false;
    pkmMenu.querySelector(".pkm-menu-item").focus({ preventScroll: true });
  }
  pkmLauncher.onclick = () => pkmLauncherMenu(!pkmLauncherOpen);
  pkmLauncher.oncontextmenu = (e) => {
    e.preventDefault();
    pkmLauncherMenu(false);
    pkmSetHudHidden(!wrap.classList.contains("pkm-hud-hidden"), false);
  };
  pkmMenu.addEventListener("keydown", (e) => {
    const items = [...pkmMenu.querySelectorAll(".pkm-menu-item:not([hidden])")];
    const i = items.indexOf(e.target);
    let n = null;
    if (e.key === "ArrowDown") n = (i + 1) % items.length;
    else if (e.key === "ArrowUp") n = (i - 1 + items.length) % items.length;
    else if (e.key === "Home") n = 0;
    else if (e.key === "End") n = items.length - 1;
    if (n === null) return;
    e.preventDefault();
    items[n].focus();
  });
  document.addEventListener("pointerdown", (e) => {
    if (!pkmLauncherOpen) return;
    const path = e.composedPath();
    if (!path.includes(pkmMenu) && !path.includes(pkmLauncher)) pkmLauncherMenu(false);
  }, true);
  pkmMount(pkmLauncher);
  pkmMount(pkmMenu);
  if (typeof GM_registerMenuCommand === "function") {
    GM_registerMenuCommand("📌 Show the Pokémon HUD (reset position)", () => pkmResetHud());
  }

  // ---------- Live HUD refresh (coins, HP, XP, items) ----------
  let pkmRefreshing = false;
  function pkmLiveRefresh() {
    if (pkmRefreshing || !wrap.isConnected) return;
    pkmRefreshing = true;
    try {
      renderHeader();
      const c = getInt(STORAGE.coins);
      PKM.querySelectorAll("[data-coins]").forEach((el) => (el.textContent = `💰 ${c}`));
      if (hpFillEl && (GM_getValue("pkm_starter_id") || getStr(STORAGE.starter))) {
        const s = activeStats();
        maxHP = s.hp;
        currentHP = Math.max(0, Math.min(s.hp, s.currentHP));
        const p = (currentHP / maxHP) * 100;
        hpFillEl.style.width = `${p}%`;
        hpFillEl.style.backgroundColor = p > 50 ? "#4caf50" : p > 25 ? "#ff9800" : "#f44336";
      }
    } finally {
      pkmRefreshing = false;
    }
  }
  // Other tabs playing at the same time: keep this tab's HUD in sync too.
  if (typeof GM_addValueChangeListener === "function") {
    ["pkm_coins", "pkm_balls", "pkm_great_balls", "pkm_ultra_balls", "pkm_master_balls", "pkm_potions", "pkm_xattack", "pkm_revive", "pkm_stats", "pkm_party", "pkm_pokedex", "pkm_pokestop_cooldown"].forEach((k) =>
      GM_addValueChangeListener(k, (_n, _o, _v, remote) => { if (remote) pkmNotify(k); })
    );
    GM_addValueChangeListener("pkm_starter_id", (_n, _o, v, remote) => { if (remote && v) fetchPartner(v); });
  }

  // ---------- Battle ball picker ----------
  function pkmBallPicker() {
    if (!battlePanel) return;
    battlePanel.querySelector(".pk-ballpick")?.remove();
    const balls = [["poke", "poke-ball", "Poké", STORAGE.balls], ["great", "great-ball", "Great", STORAGE.greatBalls], ["ultra", "ultra-ball", "Ultra", STORAGE.ultraBalls], ["master", "master-ball", "Master", STORAGE.masterBalls]];
    const row = document.createElement("div");
    row.className = "pk-ballpick";
    row.setAttribute("role", "group");
    row.setAttribute("aria-label", "Choose a ball");
    row.innerHTML =
      balls.map(([k, img, n, key]) => `<button type="button" class="pk-ball-opt" data-b="${k}" ${getInt(key) <= 0 ? "disabled" : ""}><img src="${PKM_ITEM_IMG}${img}.png" alt=""><span>${n}</span><b>×${getInt(key)}</b></button>`).join("") +
      `<button type="button" class="pk-ball-opt cancel" data-b="" aria-label="Cancel">✕</button>`;
    row.onclick = (e) => {
      const b = e.target.closest("button");
      if (!b || b.disabled) return;
      row.remove();
      if (b.dataset.b) throwBall(b.dataset.b);
    };
    row.onkeydown = (e) => { if (e.key === "Escape") { e.stopPropagation(); row.remove(); } };
    (battlePanel.querySelector(".pk-controls") || battlePanel.lastChild).before(row);
    row.querySelector("button:not([disabled])")?.focus();
  }

  pkmStyle(`
    /* Bag + Shop */
    .pkm-set.pkm-bag{width:min(900px,96vw);height:min(88vh,860px);display:flex;flex-direction:column;overflow:hidden}
    .pkm-set.pkm-shop{width:min(700px,96vw)}
    .bag-head{background:linear-gradient(90deg,#c46b12,#8a4a06)!important}
    .shop-head{background:linear-gradient(90deg,#1f6fe0,#1747a6)!important}
    .bag-head-r{display:flex;align-items:center;gap:8px}
    .bag-head-r .pkm-chip{background:rgba(0,0,0,.25);font-size:12.5px;padding:3px 10px}
    .bag-tabs{display:flex;gap:4px;padding:8px 14px 0;border-bottom:1px solid rgba(255,255,255,.08);flex:0 0 auto}
    .bag-tabs button{all:unset;cursor:pointer;padding:7px 12px;border-radius:9px 9px 0 0;font-size:13px;opacity:.7;border-bottom:2px solid transparent}
    .bag-tabs button:hover{opacity:1;background:rgba(255,255,255,.05)}
    .bag-tabs button[aria-selected="true"]{opacity:1;border-bottom-color:#ffcb05;font-weight:700}
    .bag-tabs button:focus-visible{outline:2px solid #ffcb05}
    .bag-count{background:rgba(255,255,255,.12);border-radius:999px;padding:0 7px;font-size:11px;margin-left:4px}
    .bag-msg{margin:8px 14px 0;padding:7px 10px;border-radius:9px;background:rgba(47,191,113,.15);border:1px solid rgba(47,191,113,.4);font-size:12.5px}
    .bag-body{flex:1 1 auto;overflow:auto;padding:10px 14px 14px}
    .bag-sec{display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin:6px 0;font-weight:700;font-size:13px}
    .bag-tools{display:flex;align-items:center;gap:6px;font-weight:400}
    .bag-tools input,.bag-tools select{background:#0f1220;color:#e8eaf6;border:1px solid #2c3350;border-radius:8px;padding:5px 8px;font-size:12.5px}
    .bag-tools input{width:130px}
    .bag-boxn{font-size:12.5px;min-width:70px;text-align:center}
    .bag-party,.bag-box{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:8px}
    .bag-party{padding:8px;border-radius:12px;background:rgba(255,203,5,.06);border:1px solid rgba(255,203,5,.18)}
    .bag-slot{position:relative;min-height:112px;border-radius:11px;background:#1b1f33;border:1px solid #2c3350;display:flex;flex-direction:column;align-items:center;
      justify-content:center;gap:1px;padding:6px 4px 8px;cursor:pointer;transition:transform .12s,border-color .12s,opacity .12s;user-select:none}
    .bag-slot:hover{transform:translateY(-2px);border-color:#4a5585}
    .bag-slot:focus-visible{outline:2px solid #ffcb05;outline-offset:1px}
    .bag-slot.empty{background:rgba(255,255,255,.025);border-style:dashed;cursor:default}
    .bag-slot.empty:hover{transform:none}
    .bag-slot.sel{border-color:#ffcb05;box-shadow:0 0 0 2px rgba(255,203,5,.35)}
    .bag-slot.dim{opacity:.25}
    .bag-slot.dragging{opacity:.4}
    .bag-slot.drop-ok{border-color:#2fbf71;box-shadow:0 0 0 2px rgba(47,191,113,.5)}
    .bag-slot img{width:56px;height:56px;object-fit:contain;image-rendering:pixelated;pointer-events:none}
    .bag-nm{font-weight:700;font-size:12px;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .bag-lv{font-size:11px;opacity:.7}
    .bag-hp{width:80%;height:4px;border-radius:4px;background:rgba(255,255,255,.1);overflow:hidden;margin-top:3px}
    .bag-hp span{display:block;height:100%}
    .bag-active{position:absolute;top:4px;left:6px;color:#ffcb05;font-size:13px}
    .bag-shiny{position:absolute;top:3px;right:5px;font-size:12px}
    .bag-slot.r-uncommon{border-color:rgba(60,179,113,.55)}
    .bag-slot.r-rare{border-color:rgba(66,153,225,.7)}
    .bag-slot.r-sublegendary{border-color:rgba(160,90,240,.8)}
    .bag-slot.r-legendary{border-color:rgba(255,215,0,.85);box-shadow:0 0 10px rgba(255,215,0,.25)}
    .bag-slot.r-mythical{border-color:rgba(255,105,180,.9);box-shadow:0 0 12px rgba(255,105,180,.3)}
    .bag-detail{display:flex;align-items:center;gap:12px;margin:10px 0;padding:10px 12px;border-radius:12px;background:#1b1f33;border:1px solid #2c3350;flex-wrap:wrap}
    .bag-detail.empty{display:block;text-align:center}
    .bag-detail img{width:72px;height:72px;object-fit:contain;image-rendering:pixelated}
    .bag-d-main{flex:1 1 220px;min-width:0;display:grid;gap:4px}
    .bag-d-name{font-weight:800;font-size:15px}
    .bag-d-tags{display:flex;gap:4px;flex-wrap:wrap;align-items:center}
    .bag-d-actions{display:flex;gap:6px;flex-wrap:wrap}
    .bag-rar{font-size:11px;padding:2px 8px;border-radius:999px;background:#3a3f55;text-transform:capitalize}
    .bag-rar.r-uncommon{background:#2e7d4f}.bag-rar.r-rare{background:#2b6cb0}.bag-rar.r-sublegendary{background:#6b3fb8}
    .bag-rar.r-legendary{background:#b8860b}.bag-rar.r-mythical{background:#c2407e}
    .bag-found{margin:2px 0 6px}
    .bag-items{display:grid;gap:8px}
    .bag-item{display:grid;grid-template-columns:44px 1fr auto auto;align-items:center;gap:12px;padding:8px 12px;border-radius:12px;background:#1b1f33;border:1px solid #2c3350}
    .bag-item img{width:36px;height:36px;image-rendering:pixelated;justify-self:center}
    .bag-qty{font-weight:800;font-size:15px;min-width:44px;text-align:right}
    .shop-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(290px,1fr));gap:10px;padding:12px 14px}
    .shop-card{display:grid;grid-template-columns:56px 1fr;grid-template-rows:auto auto;gap:6px 12px;padding:12px;border-radius:14px;
      background:linear-gradient(180deg,#1d2238,#171b2d);border:1px solid #2c3350;transition:transform .12s,border-color .12s}
    .shop-card:hover{transform:translateY(-2px);border-color:#4a5585}
    .shop-card.bought{animation:pkmBought .6s ease-out}
    @keyframes pkmBought{0%{box-shadow:0 0 0 0 rgba(47,191,113,.8)}100%{box-shadow:0 0 0 14px rgba(47,191,113,0)}}
    .shop-img{grid-row:1/3;width:56px;height:56px;border-radius:50%;background:radial-gradient(circle at 50% 40%,#2c3458,#151a2c);display:grid;place-items:center}
    .shop-img img{width:40px;height:40px;image-rendering:pixelated}
    .shop-name{font-weight:800;font-size:14px}
    .shop-own{font-size:12px;margin-top:2px;opacity:.85}
    .shop-buy{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
    .shop-price{font-weight:800;color:#ffcb05;font-size:13px;margin-right:auto}
    .shop-qty{display:flex;align-items:center;border:1px solid #2c3350;border-radius:8px;overflow:hidden}
    .shop-qty button{all:unset;cursor:pointer;width:26px;height:26px;display:grid;place-items:center;background:rgba(255,255,255,.06)}
    .shop-qty button:hover{background:rgba(255,255,255,.14)}
    .shop-qty button:focus-visible{outline:2px solid #ffcb05}
    .shop-qty span{min-width:28px;text-align:center;font-weight:700;font-size:13px}
    .shop-btn[disabled]{background:#3a3f55!important;border-color:#3a3f55!important;opacity:.6;cursor:not-allowed}
    .shop-foot{padding:0 14px 14px}
    /* Battle ball picker */
    .pk-ballpick{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;padding:8px;border-radius:12px;background:rgba(0,0,0,.25);border:1px solid rgba(255,255,255,.1)}
    .pk-ball-opt{all:unset;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:1px;padding:6px 8px;border-radius:9px;background:rgba(255,255,255,.06);
      border:1px solid rgba(255,255,255,.1);font-size:11px;min-width:52px;color:#fff}
    .pk-ball-opt:hover{background:rgba(255,255,255,.14)}
    .pk-ball-opt:focus-visible{outline:2px solid #ffcb05}
    .pk-ball-opt[disabled]{opacity:.35;cursor:not-allowed}
    .pk-ball-opt img{width:28px;height:28px;image-rendering:pixelated}
    .pk-ball-opt.cancel{justify-content:center;min-width:32px;font-size:14px}
    @media (max-width:640px){.bag-party,.bag-box{grid-template-columns:repeat(3,minmax(0,1fr))}}
  `, "pkm-bag-shop");
  // =====================================================================
  //  3.5: battle engine like the games (stats from base stats + level,
  //  real level-up moves, type chart, STAB, crits, status), trainers and
  //  gyms, badges + achievements, daily streak, weekly stats, stones,
  //  synth sounds, partner reactions
  // =====================================================================
  const PKM_TRAINER_IMG = "https://play.pokemonshowdown.com/sprites/trainers/";
  const pkmCap = (s) => String(s || "").split("-").map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(" ");
  const pkmRand = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
  const pkmPick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const pkmWait = (ms) => {
    const sp = Math.max(1, Number(GM_getValue("pkm_battle_speed", 1)) || 1);
    const skip = GM_getValue("pkm_skip_anim", "false") === "true";
    return new Promise((r) => setTimeout(r, skip ? 0 : (pkmReducedMotion() ? Math.min(ms, 300) : ms) / sp));
  };
  const pkmJSON = (k, d) => { try { const v = GM_getValue(k, null); return v == null ? d : (typeof v === "string" ? JSON.parse(v) : v); } catch { return d; } };
  const pkmSave = (k, v) => GM_setValue(k, JSON.stringify(v));

  // ---------- Type chart (attacking type -> defending type multipliers that aren't 1) ----------
  const PKM_TYPE_CHART = {
    normal: { rock: 0.5, ghost: 0, steel: 0.5 },
    fire: { fire: 0.5, water: 0.5, grass: 2, ice: 2, bug: 2, rock: 0.5, dragon: 0.5, steel: 2 },
    water: { fire: 2, water: 0.5, grass: 0.5, ground: 2, rock: 2, dragon: 0.5 },
    electric: { water: 2, electric: 0.5, grass: 0.5, ground: 0, flying: 2, dragon: 0.5 },
    grass: { fire: 0.5, water: 2, grass: 0.5, poison: 0.5, ground: 2, flying: 0.5, bug: 0.5, rock: 2, dragon: 0.5, steel: 0.5 },
    ice: { fire: 0.5, water: 0.5, grass: 2, ice: 0.5, ground: 2, flying: 2, dragon: 2, steel: 0.5 },
    fighting: { normal: 2, ice: 2, poison: 0.5, flying: 0.5, psychic: 0.5, bug: 0.5, rock: 2, ghost: 0, dark: 2, steel: 2, fairy: 0.5 },
    poison: { grass: 2, poison: 0.5, ground: 0.5, rock: 0.5, ghost: 0.5, steel: 0, fairy: 2 },
    ground: { fire: 2, electric: 2, grass: 0.5, poison: 2, flying: 0, bug: 0.5, rock: 2, steel: 2 },
    flying: { electric: 0.5, grass: 2, fighting: 2, bug: 2, rock: 0.5, steel: 0.5 },
    psychic: { fighting: 2, poison: 2, psychic: 0.5, dark: 0, steel: 0.5 },
    bug: { fire: 0.5, grass: 2, fighting: 0.5, poison: 0.5, flying: 0.5, psychic: 2, ghost: 0.5, dark: 2, steel: 0.5, fairy: 0.5 },
    rock: { fire: 2, ice: 2, fighting: 0.5, ground: 0.5, flying: 2, bug: 2, steel: 0.5 },
    ghost: { normal: 0, psychic: 2, ghost: 2, dark: 0.5 },
    dragon: { dragon: 2, steel: 0.5, fairy: 0 },
    dark: { fighting: 0.5, psychic: 2, ghost: 2, dark: 0.5, fairy: 0.5 },
    steel: { fire: 0.5, water: 0.5, electric: 0.5, ice: 2, rock: 2, steel: 0.5, fairy: 2 },
    fairy: { fire: 0.5, fighting: 2, poison: 0.5, dragon: 2, dark: 2, steel: 0.5 },
  };
  function pkmEff(moveType, defTypes) {
    let m = 1;
    for (const t of defTypes || []) { const r = (PKM_TYPE_CHART[moveType] || {})[t]; if (r !== undefined) m *= r; }
    return m;
  }

  // ---------- PokeAPI data (all cached) ----------
  async function pkmPokemonData(nameOrId) {
    const key = String(nameOrId).toLowerCase().replace(/^shiny /, "");
    let r = await pkmFetch(`https://pokeapi.co/api/v2/pokemon/${encodeURIComponent(key)}`).catch(() => null);
    if (r && r.ok) return r.json();
    // Names like "giratina" need the default form: ask the species
    const sp = await pkmSpeciesData(key);
    if (sp && sp.default_variety && sp.default_variety !== key) {
      r = await pkmFetch(`https://pokeapi.co/api/v2/pokemon/${encodeURIComponent(sp.default_variety)}`).catch(() => null);
      if (r && r.ok) return r.json();
    }
    return null;
  }
  async function pkmSpeciesData(nameOrId) {
    const key = String(nameOrId).toLowerCase().split("-mega")[0];
    const r = await pkmFetch(`https://pokeapi.co/api/v2/pokemon-species/${encodeURIComponent(key)}`).catch(() => null);
    return r && r.ok ? r.json() : null;
  }
  async function pkmMoveData(name) {
    const r = await pkmFetch(`https://pokeapi.co/api/v2/move/${encodeURIComponent(name)}`).catch(() => null);
    return r && r.ok ? r.json() : null;
  }
  function pkmBase(d) {
    const g = (n) => ((d.stats || []).find((s) => s.stat && s.stat.name === n) || {}).base_stat || 50;
    return { hp: g("hp"), atk: g("attack"), def: g("defense"), spa: g("special-attack"), spd: g("special-defense"), spe: g("speed") };
  }
  // ---------- Natures, abilities, held items ----------
  const PKM_NATURES = {
    hardy: [], lonely: ["atk", "def"], brave: ["atk", "spe"], adamant: ["atk", "spa"], naughty: ["atk", "spd"], bold: ["def", "atk"], docile: [],
    relaxed: ["def", "spe"], impish: ["def", "spa"], lax: ["def", "spd"], timid: ["spe", "atk"], hasty: ["spe", "def"], serious: [], jolly: ["spe", "spa"],
    naive: ["spe", "spd"], modest: ["spa", "atk"], mild: ["spa", "def"], quiet: ["spa", "spe"], bashful: [], rash: ["spa", "spd"], calm: ["spd", "atk"],
    gentle: ["spd", "def"], sassy: ["spd", "spe"], careful: ["spd", "spa"], quirky: [],
  };
  const PKM_STAT_LABEL = { atk: "Attack", def: "Defense", spa: "Sp. Atk", spd: "Sp. Def", spe: "Speed", acc: "Accuracy", eva: "Evasion" };
  const PKM_ABILITY_INFO = {
    intimidate: "Lowers the foe's Attack when it enters battle", blaze: "Fire moves ×1.5 at low HP", torrent: "Water moves ×1.5 at low HP",
    overgrow: "Grass moves ×1.5 at low HP", swarm: "Bug moves ×1.5 at low HP", "huge-power": "Doubles Attack", "pure-power": "Doubles Attack",
    guts: "Attack ×1.5 when it has a status problem", technician: "Weak moves (60 power or less) ×1.5", adaptability: "Same-type moves ×2 instead of ×1.5",
    levitate: "Immune to Ground moves", "flash-fire": "Immune to Fire; boosts its own Fire moves", "water-absorb": "Water moves heal it instead",
    "volt-absorb": "Electric moves heal it instead", "thick-fat": "Takes half damage from Fire and Ice", sturdy: "Survives a one-hit KO from full HP",
    static: "May paralyze on contact", "flame-body": "May burn on contact", "poison-point": "May poison on contact", "rough-skin": "Hurts attackers on contact",
    "speed-boost": "Speed rises every turn", "shed-skin": "May cure its status each turn", "compound-eyes": "Accuracy ×1.3", hustle: "Attack ×1.5, accuracy ×0.8",
    "natural-cure": "Status is cured when it switches out",
  };
  const PKM_TYPE_BOOST = { charcoal: "fire", "mystic-water": "water", "miracle-seed": "grass", magnet: "electric", "silk-scarf": "normal" };
  const PKM_HELD = [
    ["leftovers", "Leftovers", 1500, "Restores 1/16 of max HP every turn."],
    ["oran-berry", "Oran Berry", 50, "Restores 10 HP when HP drops below half. Used up."],
    ["sitrus-berry", "Sitrus Berry", 200, "Restores 25% HP when HP drops below half. Used up."],
    ["lum-berry", "Lum Berry", 250, "Cures any status problem once. Used up."],
    ["focus-sash", "Focus Sash", 800, "From full HP, survives a knockout hit with 1 HP. Used up."],
    ["choice-band", "Choice Band", 1500, "Physical moves ×1.5."],
    ["choice-specs", "Choice Specs", 1500, "Special moves ×1.5."],
    ["quick-claw", "Quick Claw", 700, "20% chance to move first."],
    ["lucky-egg", "Lucky Egg", 2000, "×1.5 XP for the holder."],
    ["exp-share", "Exp. Share", 1500, "Holder gets half XP even when it didn't battle."],
    ["amulet-coin", "Amulet Coin", 2000, "Double coins from battles when a party member holds it."],
    ["charcoal", "Charcoal", 500, "Fire moves ×1.2."],
    ["mystic-water", "Mystic Water", 500, "Water moves ×1.2."],
    ["miracle-seed", "Miracle Seed", 500, "Grass moves ×1.2."],
    ["magnet", "Magnet", 500, "Electric moves ×1.2."],
    ["silk-scarf", "Silk Scarf", 500, "Normal moves ×1.2."],
  ];
  for (const [img, name, price, desc] of PKM_HELD) PKM_ITEMS.push({ img, name, key: `pkm_item_${img}`, price, cat: "held", desc: `${desc} Give it to a Pokémon in the Bag.` });
  PKM_ITEMS.push({ img: "shiny-charm", name: "Shiny Charm", key: "pkm_item_shiny-charm", price: 20000, cat: "key", max: 1, desc: "Doubles your chance of meeting shiny Pokémon. Works from the Bag." });

  // =====================================================================
  //  3.7: more held items and abilities, weather + terrain, Mega Evolution
  //  and Z-moves, day and night
  // =====================================================================
  Object.assign(PKM_TYPE_BOOST, {
    "black-belt": "fighting", "black-glasses": "dark", "dragon-fang": "dragon", "hard-stone": "rock", "metal-coat": "steel", "never-melt-ice": "ice",
    "poison-barb": "poison", "sharp-beak": "flying", "silver-powder": "bug", "soft-sand": "ground", "spell-tag": "ghost", "twisted-spoon": "psychic", "fairy-feather": "fairy",
  });
  const PKM_HELD2 = [
    ["life-orb", "Life Orb", 3000, "Attacks do ×1.3 damage, but the holder loses 10% of its max HP after each attack."],
    ["expert-belt", "Expert Belt", 1500, "Super effective moves ×1.2."],
    ["muscle-band", "Muscle Band", 800, "Physical moves ×1.1."],
    ["wise-glasses", "Wise Glasses", 800, "Special moves ×1.1."],
    ["choice-scarf", "Choice Scarf", 1500, "Speed ×1.5."],
    ["assault-vest", "Assault Vest", 1500, "Sp. Def ×1.5."],
    ["rocky-helmet", "Rocky Helmet", 1200, "Attackers that use physical moves lose 1/6 of their max HP."],
    ["shell-bell", "Shell Bell", 1200, "Restores 1/8 of the damage the holder deals."],
    ["scope-lens", "Scope Lens", 800, "Raises the critical-hit chance one stage."],
    ["razor-claw", "Razor Claw", 800, "Raises the critical-hit chance one stage."],
    ["air-balloon", "Air Balloon", 600, "Immune to Ground moves until it is hit once. Used up."],
    ["weakness-policy", "Weakness Policy", 1500, "Attack and Sp. Atk rise by 2 stages when hit by a super effective move. Used up."],
    ["light-ball", "Light Ball", 2000, "Doubles Pikachu's Attack and Sp. Atk."],
    ["heat-rock", "Heat Rock", 600, "Sunlight set by the holder lasts 8 turns."],
    ["damp-rock", "Damp Rock", 600, "Rain set by the holder lasts 8 turns."],
    ["smooth-rock", "Smooth Rock", 600, "A sandstorm set by the holder lasts 8 turns."],
    ["icy-rock", "Icy Rock", 600, "Hail set by the holder lasts 8 turns."],
    ["terrain-extender", "Terrain Extender", 600, "Terrain set by the holder lasts 8 turns."],
    ["everstone", "Everstone", 500, "At the Daycare, the Egg inherits this Pokémon's Nature."],
    ["black-belt", "Black Belt", 500, "Fighting moves ×1.2."], ["black-glasses", "Black Glasses", 500, "Dark moves ×1.2."],
    ["dragon-fang", "Dragon Fang", 500, "Dragon moves ×1.2."], ["hard-stone", "Hard Stone", 500, "Rock moves ×1.2."],
    ["metal-coat", "Metal Coat", 500, "Steel moves ×1.2."], ["never-melt-ice", "Never-Melt Ice", 500, "Ice moves ×1.2."],
    ["poison-barb", "Poison Barb", 500, "Poison moves ×1.2."], ["sharp-beak", "Sharp Beak", 500, "Flying moves ×1.2."],
    ["silver-powder", "Silver Powder", 500, "Bug moves ×1.2."], ["soft-sand", "Soft Sand", 500, "Ground moves ×1.2."],
    ["spell-tag", "Spell Tag", 500, "Ghost moves ×1.2."], ["twisted-spoon", "Twisted Spoon", 500, "Psychic moves ×1.2."],
    ["fairy-feather", "Fairy Feather", 500, "Fairy moves ×1.2."],
  ];
  for (const [img, name, price, desc] of PKM_HELD2) PKM_ITEMS.push({ img, name, key: `pkm_item_${img}`, price, cat: "held", desc: `${desc} Give it to a Pokémon in the Bag.` });
  PKM_ITEMS.push(
    { img: "mega-bracelet", name: "Mega Ring", key: "pkm_item_mega-bracelet", price: 12000, cat: "key", max: 1, desc: "Lets a Pokémon that has a Mega form Mega Evolve once per battle (instead of a Z-Move)." },
    { img: "tera-orb", name: "Tera Orb", key: "pkm_item_tera-orb", price: 15000, cat: "key", max: 1, desc: "Lets a Pokémon Terastallize once per battle: it becomes its Tera type, and moves of that type get a STAB boost (instead of Mega, Z or Dynamax)." },
    { img: "dynamax-band", name: "Dynamax Band", key: "pkm_item_dynamax-band", price: 15000, cat: "key", max: 1, desc: "Lets a Pokémon Dynamax for 3 turns once per battle: double HP and Max Moves (instead of Mega, Z or Tera)." },
    { img: "z-power-ring", name: "Z-Ring", key: "pkm_item_z-power-ring", price: 12000, cat: "key", max: 1, desc: "Lets you turn one move into a powerful Z-Move once per battle (instead of Mega Evolving)." }
  );
  Object.assign(PKM_ABILITY_INFO, {
    drizzle: "Makes it rain when it enters battle", drought: "Turns the sunlight harsh when it enters battle", "sand-stream": "Whips up a sandstorm when it enters battle",
    "snow-warning": "Makes it hail when it enters battle", "electric-surge": "Creates Electric Terrain on entry", "grassy-surge": "Creates Grassy Terrain on entry",
    "psychic-surge": "Creates Psychic Terrain on entry", "misty-surge": "Creates Misty Terrain on entry",
    "swift-swim": "Speed ×2 in rain", chlorophyll: "Speed ×2 in harsh sunlight", "sand-rush": "Speed ×2 in a sandstorm", "slush-rush": "Speed ×2 in hail",
    "rain-dish": "Restores a little HP each turn in rain", "ice-body": "Restores a little HP each turn in hail", "dry-skin": "Water heals it, Fire hurts more. Rain heals, sun hurts",
    "solar-power": "Sp. Atk ×1.5 in sunlight, but it loses HP each turn", "sand-veil": "Harder to hit in a sandstorm", "snow-cloak": "Harder to hit in hail",
    overcoat: "Immune to weather damage", "magic-guard": "Only takes damage from attacks", "iron-fist": "Punching moves ×1.2", "sheer-force": "Moves with extra effects ×1.3, but lose those effects",
    "tinted-lens": "Not very effective moves do double damage", sniper: "Critical hits do more damage", "super-luck": "Higher critical-hit chance", reckless: "Recoil moves ×1.2",
    "rock-head": "No recoil damage", "no-guard": "Every attack hits, both ways", "mold-breaker": "Ignores the target's defensive abilities", teravolt: "Ignores the target's defensive abilities",
    turboblaze: "Ignores the target's defensive abilities", scrappy: "Hits Ghost types with Normal and Fighting moves", multiscale: "Takes half damage at full HP",
    "solid-rock": "Super effective hits do less damage", filter: "Super effective hits do less damage", "marvel-scale": "Defense ×1.5 with a status problem",
    "wonder-guard": "Only super effective moves hit it", "lightning-rod": "Immune to Electric, which raises Sp. Atk", "storm-drain": "Immune to Water, which raises Sp. Atk",
    "motor-drive": "Immune to Electric, which raises Speed", "sap-sipper": "Immune to Grass, which raises Attack", heatproof: "Takes half damage from Fire",
    unaware: "Ignores the opponent's stat changes", "battle-armor": "Can't be hit by critical hits", "shell-armor": "Can't be hit by critical hits",
    "serene-grace": "Extra effects happen twice as often", protean: "Changes type to match each move it uses", libero: "Changes type to match each move it uses",
    limber: "Can't be paralyzed", insomnia: "Can't fall asleep", "vital-spirit": "Can't fall asleep", "water-veil": "Can't be burned", immunity: "Can't be poisoned",
    "magma-armor": "Can't be frozen", synchronize: "Passes burn, poison and paralysis back", "effect-spore": "May cause a status problem on contact",
    "poison-heal": "Heals when poisoned", "iron-barbs": "Hurts attackers on contact", "quick-feet": "Speed ×1.5 with a status problem", regenerator: "Heals a little when it switches out",
    defiant: "Attack rises sharply when its stats are lowered", competitive: "Sp. Atk rises sharply when its stats are lowered", "clear-body": "Its stats can't be lowered",
    "hyper-cutter": "Its Attack can't be lowered", "white-smoke": "Its stats can't be lowered", "inner-focus": "Immune to Intimidate", moxie: "Attack rises after it knocks out a Pokémon",
  });

  // ---------- Weather and terrain ----------
  const PKM_WEATHER = {
    rain: { icon: "🌧️", name: "Rain", on: "It started to rain!", off: "The rain stopped.", rock: "damp-rock", up: "water", down: "fire" },
    sun: { icon: "☀️", name: "Harsh sunlight", on: "The sunlight turned harsh!", off: "The sunlight faded.", rock: "heat-rock", up: "fire", down: "water" },
    sand: { icon: "🏜️", name: "Sandstorm", on: "A sandstorm kicked up!", off: "The sandstorm subsided.", rock: "smooth-rock" },
    hail: { icon: "❄️", name: "Hail", on: "It started to hail!", off: "The hail stopped.", rock: "icy-rock" },
  };
  const PKM_TERRAIN = {
    electric: { icon: "⚡", name: "Electric Terrain", type: "electric", on: "An electric current runs across the battlefield!", off: "The electricity disappeared." },
    grassy: { icon: "🌿", name: "Grassy Terrain", type: "grass", on: "Grass grew to cover the battlefield!", off: "The grass disappeared." },
    psychic: { icon: "🔮", name: "Psychic Terrain", type: "psychic", on: "The battlefield got weird!", off: "The weirdness disappeared." },
    misty: { icon: "🌫️", name: "Misty Terrain", type: null, on: "Mist swirled around the battlefield!", off: "The mist disappeared." },
  };
  const PKM_WEATHER_AB = { drizzle: "rain", drought: "sun", "sand-stream": "sand", "snow-warning": "hail" };
  const PKM_TERRAIN_AB = { "electric-surge": "electric", "grassy-surge": "grassy", "psychic-surge": "psychic", "misty-surge": "misty" };
  const PKM_WEATHER_SPEED = { "swift-swim": "rain", chlorophyll: "sun", "sand-rush": "sand", "slush-rush": "hail" };
  /** A random field effect for battles that don't set their own (about 3 in 10 have weather, 1 in 10 a terrain). */
  function pkmRandomField(b, chance = 0.3) {
    if (Math.random() < chance) b.weather = { id: pkmPick(Object.keys(PKM_WEATHER)), turns: 8, env: true };
    if (Math.random() < chance / 3) b.terrain = { id: pkmPick(Object.keys(PKM_TERRAIN)), turns: 8, env: true };
  }
  const pkmGrounded = (m) => !m.types.includes("flying") && m.ability !== "levitate" && m.held !== "air-balloon";
  async function pkmSetWeather(b, id, src) {
    if (!pkmAlive(b) || (b.weather && b.weather.id === id)) return;
    b.weather = { id, turns: src && src.held === PKM_WEATHER[id].rock ? 8 : 5 };
    await pkmSay(b, PKM_WEATHER[id].on, 900);
  }
  async function pkmSetTerrain(b, id, src) {
    if (!pkmAlive(b) || (b.terrain && b.terrain.id === id)) return;
    b.terrain = { id, turns: src && src.held === "terrain-extender" ? 8 : 5 };
    await pkmSay(b, PKM_TERRAIN[id].on, 900);
  }
  const pkmWeatherId = (b) => (b && b.weather ? b.weather.id : null);
  /** Chips like "🌧️ Rain (4)" shown above the battlefield. */
  function pkmFieldChips(b) {
    const out = [];
    if (b.weather) out.push(`<span class="pkb-env-chip w-${b.weather.id}" title="${pkmEsc(PKM_WEATHER[b.weather.id].name)}">${PKM_WEATHER[b.weather.id].icon} ${pkmEsc(PKM_WEATHER[b.weather.id].name)}${Number.isFinite(b.weather.turns) ? ` (${b.weather.turns})` : ""}</span>`);
    if (b.terrain) out.push(`<span class="pkb-env-chip t-${b.terrain.id}" title="${pkmEsc(PKM_TERRAIN[b.terrain.id].name)}">${PKM_TERRAIN[b.terrain.id].icon} ${pkmEsc(PKM_TERRAIN[b.terrain.id].name)}${Number.isFinite(b.terrain.turns) ? ` (${b.terrain.turns})` : ""}</span>`);
    if (b.foe && b.foe.raid) out.push(`<span class="pkb-env-chip w-sun">💥 Raid ${"★".repeat(b.foe.raid)} · turn ${Math.min(b.turns || 0, PKM_RAID_TURNS)}/${PKM_RAID_TURNS}</span>`);
    for (const side of ["me", "foe"]) {
      const h = (b.hazards || {})[side] || {};
      const bits = [h.rock ? "🪨 Rocks" : "", h.spikes ? `📌 Spikes ×${h.spikes}` : "", h.tspikes ? `☠️ Toxic Spikes ×${h.tspikes}` : "", (b.screens[side] || {}).reflect > 0 ? "🛡️ Reflect" : "", (b.screens[side] || {}).light > 0 ? "✨ Light Screen" : ""].filter(Boolean);
      if (bits.length) out.push(`<span class="pkb-env-chip">${side === "me" ? "Your side" : "Foe side"}: ${bits.join(" · ")}</span>`);
    }
    out.push(`<span class="pkb-env-chip">${b.night ? "🌙 Night" : "🌞 Day"}</span>`);
    return `<div class="pkb-env">${out.join("")}</div>`;
  }

  // ---------- Day and night ----------
  const pkmIsNight = () => {
    const f = GM_getValue("pkm_time_force", "");
    if (f === "night") return true;
    if (f === "day") return false;
    const h = new Date().getHours();
    return h >= 20 || h < 6;
  };
  const PKM_NIGHT_POOL = ["zubat", "golbat", "crobat", "hoothoot", "noctowl", "spinarak", "ariados", "gastly", "haunter", "gengar", "murkrow", "honchkrow", "misdreavus", "mismagius",
    "umbreon", "sneasel", "weavile", "houndour", "houndoom", "duskull", "dusclops", "shuppet", "banette", "absol", "sableye", "poochyena", "mightyena", "venonat", "venomoth", "drowzee",
    "hypno", "stunky", "skuntank", "purrloin", "liepard", "litwick", "lampent", "yamask", "deino", "zorua", "pawniard", "vullaby", "mandibuzz", "clefairy", "jigglypuff", "cleffa", "lunatone",
    "nincada", "gligar", "sentret", "furret", "teddiursa", "ursaring", "phantump", "pumpkaboo", "inkay", "noibat"];
  const PKM_DAY_POOL = ["pidgey", "pidgeotto", "spearow", "fearow", "butterfree", "bellsprout", "weepinbell", "oddish", "gloom", "hoppip", "skiploom", "sunkern", "sunflora", "combee",
    "ledyba", "ledian", "espeon", "taillow", "swellow", "wingull", "pelipper", "solrock", "numel", "cherubi", "cherrim", "lillipup", "sewaddle", "swadloon", "petilil", "cottonee",
    "deerling", "ducklett", "emolga", "flabebe", "fletchling", "scatterbug", "bunnelby", "buneary", "pikachu", "growlithe", "ponyta", "mareep", "flaaffy", "skitty", "azurill", "marill",
    "pachirisu", "aipom", "girafarig", "tauros", "miltank", "vulpix", "eevee", "meowth", "togepi", "pidove", "swablu", "ralts", "spheal", "plusle", "minun", "roselia"];

  // ---------- Z-Moves and Mega Evolution ----------
  const PKM_Z_NAMES = {
    normal: "Breakneck Blitz", fire: "Inferno Overdrive", water: "Hydro Vortex", electric: "Gigavolt Havoc", grass: "Bloom Doom", ice: "Subzero Slammer",
    fighting: "All-Out Pummeling", poison: "Acid Downpour", ground: "Tectonic Rage", flying: "Supersonic Skystrike", psychic: "Shattered Psyche", bug: "Savage Spin-Out",
    rock: "Continental Crush", ghost: "Never-Ending Nightmare", dragon: "Devastating Drake", dark: "Black Hole Eclipse", steel: "Corkscrew Crash", fairy: "Twinkle Tackle",
  };
  function pkmZPower(p) {
    return p >= 140 ? 200 : p >= 130 ? 195 : p >= 120 ? 190 : p >= 110 ? 185 : p >= 100 ? 180 : p >= 90 ? 175 : p >= 80 ? 160 : p >= 70 ? 140 : p >= 60 ? 120 : 100;
  }
  /** The Z-Move version of a damaging move: never misses, no side effects. */
  function pkmZMove(mv) {
    return { ...mv, name: `z-${mv.name}`, display: PKM_Z_NAMES[mv.type] || "Z-Power", power: pkmZPower(mv.power), acc: null, crit: 0, drain: 0, flinch: 0, ailment: null, ailmentChance: 0, stats: [], statChance: 0, minHits: 0, maxHits: 0, twoTurn: null, recharge: false, selfKO: false, fixed: null, z: true, srcMove: mv };
  }
  /** Names of this species' Mega forms (empty when it has none). Only called when the player owns a Mega Ring. */
  async function pkmMegaForms(m) {
    const sp = await pkmSpeciesData(m.name);
    return ((sp && sp.varieties) || []).filter((n) => /-mega(-[xy])?$/.test(n));
  }
  async function pkmMegaEvolve(b) {
    const m = b.me;
    const forms = m.megaForms || [];
    let best = null;
    for (const f of forms) {
      const d = await pkmPokemonData(f);
      if (!d) continue;
      const types = d.types.map((t) => t.type.name);
      const score = m.moves.filter((x) => types.includes(x.type)).length;
      if (!best || score > best.score) best = { d, types, score, form: f };
    }
    b.specialUsed = true;
    if (!best) return;
    const d = best.d;
    const base = pkmBase(d);
    const stats = pkmCalcStats(base, m.level, m.iv, m.nature, m.ev);
    stats.hp = m.maxHP;
    const orig = m.display;
    m.mega = true;
    m.base = base;
    m.stats = stats;
    m.types = best.types;
    const ab = (d.abilities || []).find((a) => !a.is_hidden) || (d.abilities || [])[0];
    if (ab) m.ability = ab.ability.name;
    const xy = (best.form.match(/-mega-([xy])$/) || [])[1];
    m.display = `Mega ${orig}${xy ? ` ${xy.toUpperCase()}` : ""}`;
    const sp = d.sprites || {};
    if (m.shiny ? sp.back_shiny : sp.back_default) m.back = m.shiny ? sp.back_shiny : sp.back_default;
    if (m.shiny ? sp.front_shiny : sp.front_default) { m.front = m.shiny ? sp.front_shiny : sp.front_default; m.frontAlt = m.front; }
    m.stages = { ...m.stages };
    pkmTrack("megas");
    playSound("evolve");
    await pkmSay(b, `💠 ${orig} Mega Evolved into ${m.display}!`, 1500);
    await pkmOnEntry(b, m, b.foe);
  }

  /** The games' stat formulas (no EVs) with nature ±10%. */
  function pkmCalcStats(b, L, iv = 15, nature, ev) {
    const [up, down] = PKM_NATURES[nature] || [];
    const e = (k) => Math.floor(((ev && ev[k]) || 0) / 4);
    const o = (k) => Math.floor((Math.floor(((2 * b[k] + iv + e(k)) * L) / 100) + 5) * (k === up ? 1.1 : k === down ? 0.9 : 1));
    return { hp: Math.floor(((2 * b.hp + iv + e("hp")) * L) / 100) + L + 10, atk: o("atk"), def: o("def"), spa: o("spa"), spd: o("spd"), spe: o("spe") };
  }
  const PKM_STAT_KEY = { attack: "atk", defense: "def", "special-attack": "spa", "special-defense": "spd", speed: "spe", accuracy: "acc", evasion: "eva" };
  const pkmDifficulty = () => GM_getValue("pkm_difficulty", "normal");
  // ---------- Moves: damaging moves and the status moves the battle engine understands ----------
  const PKM_FIXED = { "seismic-toss": { kind: "level" }, "night-shade": { kind: "level" }, "dragon-rage": { kind: "flat", n: 40 }, "sonic-boom": { kind: "flat", n: 20 }, "super-fang": { kind: "half" }, "nature-s-madness": { kind: "half" } };
  const PKM_TWO_TURN = {
    "solar-beam": { msg: "is absorbing sunlight!", skipSun: true }, "solar-blade": { msg: "is absorbing sunlight!", skipSun: true }, "sky-attack": { msg: "is glowing!" },
    "razor-wind": { msg: "whipped up a whirlwind!" }, "skull-bash": { msg: "tucked in its head!" }, "meteor-beam": { msg: "is overflowing with space power!" },
    "freeze-shock": { msg: "became cloaked in a freezing light!" }, "ice-burn": { msg: "became cloaked in freezing air!" },
    fly: { msg: "flew up high!", invuln: true }, dig: { msg: "burrowed underground!", invuln: true }, dive: { msg: "hid underwater!", invuln: true },
    bounce: { msg: "sprang up!", invuln: true }, "phantom-force": { msg: "vanished instantly!", invuln: true }, "shadow-force": { msg: "vanished instantly!", invuln: true },
  };
  const PKM_RECHARGE = new Set(["hyper-beam", "giga-impact", "blast-burn", "frenzy-plant", "hydro-cannon", "rock-wrecker", "roar-of-time", "prismatic-laser", "eternabeam", "meteor-assault"]);
  /** Attacks whose stat drops hit the user (the data does not say who is affected). */
  const PKM_SELF_DEBUFF = new Set(["close-combat", "superpower", "overheat", "draco-meteor", "leaf-storm", "psycho-boost", "fleur-cannon", "v-create", "hammer-arm", "ice-hammer", "clanging-scales", "dragon-ascent", "hyperspace-fury", "make-it-rain", "armor-cannon", "headlong-rush", "spin-out", "scale-shot", "shell-side-arm", "mind-blown"]);
  const PKM_SELF_KO = new Set(["explosion", "self-destruct", "misty-explosion"]);
  const PKM_WEATHER_MV = { "rain-dance": "rain", "sunny-day": "sun", sandstorm: "sand", hail: "hail", snowscape: "hail" };
  const PKM_TERRAIN_MV = { "electric-terrain": "electric", "grassy-terrain": "grassy", "psychic-terrain": "psychic", "misty-terrain": "misty" };
  const PKM_PROTECT = new Set(["max-guard", "protect", "detect", "spiky-shield", "king-s-shield", "baneful-bunker", "obstruct", "silk-trap", "burning-bulwark"]);
  const PKM_HAZARD = { "stealth-rock": "rock", spikes: "spikes", "toxic-spikes": "tspikes" };
  const PKM_SCREEN = { reflect: "reflect", "light-screen": "light" };
  const PKM_SPECIAL_STATUS = new Set(["substitute", "rest", "defog"]);
  /** Status moves that need rules this engine doesn't have: they are never loaded. */
  const PKM_NO_STATUS = new Set(["belly-drum", "curse", "psych-up", "haze", "heart-swap", "power-trick", "transform", "mimic", "sketch", "metronome", "mirror-move", "copycat", "me-first", "assist", "sleep-talk",
    "nature-power", "encore", "taunt", "torment", "disable", "baton-pass", "teleport", "roar", "whirlwind", "perish-song", "destiny-bond", "counter", "mirror-coat", "bide", "pain-split", "leech-seed", "ingrain",
    "aqua-ring", "wish", "trick", "switcheroo", "role-play", "skill-swap", "worry-seed", "simple-beam", "entrainment", "gastro-acid", "magic-coat", "snatch", "spite", "imprison", "foresight", "odor-sleuth", "miracle-eye",
    "lock-on", "mind-reader", "nightmare", "mean-look", "block", "spider-web", "trick-room", "magic-room", "wonder-room", "gravity", "tailwind", "safeguard", "mist", "lucky-chant", "heal-block", "embargo",
    "healing-wish", "lunar-dance", "memento", "final-gambit", "endure", "follow-me", "rage-powder", "helping-hand", "ally-switch", "after-you", "quash", "stockpile", "swallow", "spit-up", "focus-energy", "conversion",
    "conversion-2", "camouflage", "reflect-type", "soak", "magnet-rise", "telekinesis", "charge", "grudge", "uproar", "lock-on", "teeter-dance", "attract", "captivate", "poison-gas"]);
  const PKM_SELF_TARGETS = /^(user|users-field|entire-field|all-pokemon|opponents-field)/;
  /** Does the battle engine know how to run this move? */
  function pkmMoveUsable(m) {
    if (!m) return false;
    const cls = m.damage_class && m.damage_class.name;
    if (cls !== "status") return !!(m.power || PKM_FIXED[m.name]);
    if (PKM_NO_STATUS.has(m.name)) return false;
    const meta = m.meta || {};
    const n = m.name;
    if (PKM_WEATHER_MV[n] || PKM_TERRAIN_MV[n] || PKM_PROTECT.has(n) || PKM_HAZARD[n] || PKM_SCREEN[n] || PKM_SPECIAL_STATUS.has(n)) return true;
    const self = !m.target || PKM_SELF_TARGETS.test(m.target.name);
    if (meta.healing > 0) return self;
    const ail = meta.ailment && meta.ailment.name;
    const okAil = ["burn", "poison", "paralysis", "sleep", "freeze", "confusion"].includes(ail);
    if ((m.stat_changes || []).length) return !(ail && ail !== "none" && !okAil);
    return !!okAil && !self;
  }
  function pkmMoveObj(m) {
    const meta = m.meta || {};
    const cls = m.damage_class && m.damage_class.name === "special" ? "special" : m.damage_class && m.damage_class.name === "status" ? "status" : "physical";
    const fixed = PKM_FIXED[m.name] || null;
    const ail = meta.ailment && meta.ailment.name !== "none" ? meta.ailment.name : null;
    return {
      name: m.name, display: pkmCap(m.name), type: (m.type && m.type.name) || "normal", power: cls === "status" ? 0 : (m.power || (fixed ? 1 : 40)), acc: m.accuracy || null,
      pp: m.pp || 10, maxPP: m.pp || 10, cls, prio: m.priority || 0, drain: meta.drain || 0, crit: meta.crit_rate || 0, flinch: meta.flinch_chance || 0,
      ailment: ail, ailmentChance: cls === "status" ? 100 : meta.ailment_chance || 0,
      stats: (m.stat_changes || []).map((s) => [PKM_STAT_KEY[s.stat], Math.max(-3, Math.min(3, s.change))]).filter((x) => x[0]), statChance: meta.stat_chance || 0,
      healing: meta.healing || 0, target: (m.target && m.target.name) || (cls === "status" ? "user" : "selected-pokemon"),
      minHits: meta.min_hits || 0, maxHits: meta.max_hits || 0, fixed, twoTurn: PKM_TWO_TURN[m.name] || null, recharge: PKM_RECHARGE.has(m.name), selfKO: PKM_SELF_KO.has(m.name),
    };
  }
  const PKM_TACKLE = { name: "tackle", display: "Tackle", type: "normal", power: 40, acc: 100, pp: 35, maxPP: 35, cls: "physical", prio: 0, drain: 0, crit: 0, flinch: 0, ailment: null, ailmentChance: 0, stats: [], statChance: 0, healing: 0, target: "selected-pokemon", minHits: 0, maxHits: 0, fixed: null, twoTurn: null, recharge: false, selfKO: false };
  /** Move objects for these names (damaging moves and the status moves the engine supports). */
  async function pkmMovesByNames(names) {
    const data = await Promise.all((names || []).map((n) => pkmMoveData(n).catch(() => null)));
    return data.filter(pkmMoveUsable).map(pkmMoveObj);
  }
  /** Four moves from the last ones learned by level-up: mostly attacks, with up to two status moves mixed in. */
  async function pkmPickMoves(d, level) {
    const cand = [];
    const seen = new Set();
    for (const [n] of (d._lv || []).filter(([, l]) => l <= level).sort((a, b) => b[1] - a[1])) {
      if (seen.has(n)) continue;
      seen.add(n);
      cand.push(n);
      if (cand.length >= 14) break;
    }
    const all = await pkmMovesByNames(cand);
    const dmg = all.filter((m) => m.cls !== "status");
    const st = all.filter((m) => m.cls === "status");
    const nSt = Math.min(st.length, 2, 4 - Math.min(dmg.length, 2));
    // Attacks first (oldest first), then the status moves
    const out = [...dmg.slice(0, 4 - nSt).reverse(), ...st.slice(0, nSt).reverse()];
    if (!out.length) out.push({ ...PKM_TACKLE });
    return out;
  }

  /** Recalculate the instance's stats from base stats + level + nature, and fill in nature / ability / friendship. */
  async function pkmSyncStats(id, name) {
    if (!id || !name) return;
    try {
      const d = await pkmPokemonData(name);
      if (!d) return;
      const all = getObj(STORAGE.stats) || {};
      const s = all[id] || {};
      const lvl = Math.min(MAX_LEVEL, Math.max(1, Number(s.level) || 1));
      if (s.iv == null) s.iv = 15;
      if (!s.nature || !PKM_NATURES[s.nature]) s.nature = pkmPick(Object.keys(PKM_NATURES));
      if (!s.ability) {
        const ab = (d.abilities || []).filter((a) => !a.is_hidden).map((a) => a.ability.name);
        s.ability = ab.length ? pkmPick(ab) : ((d.abilities || [])[0] || { ability: { name: "none" } }).ability.name;
      }
      if (s.friendship == null) s.friendship = 70;
      const c = pkmCalcStats(pkmBase(d), lvl, s.iv, s.nature, s.ev);
      const oldMax = Number(s.hp) || c.hp;
      const oldCur = Number.isFinite(s.currentHP) ? s.currentHP : oldMax;
      let cur;
      if (s._v !== 2) cur = Math.round(c.hp * Math.max(0, Math.min(1, oldCur / oldMax)));
      else cur = Math.min(c.hp, oldCur + Math.max(0, c.hp - oldMax));
      Object.assign(s, { level: lvl, hp: c.hp, atk: c.atk, def: c.def, spAtk: c.spa, spDef: c.spd, speed: c.spe, types: d.types.map((t) => t.type.name), dexId: d.id, currentHP: Math.max(0, cur), _v: 2 });
      all[id] = s;
      setObj(STORAGE.stats, all);
    } catch (e) {
      console.warn("Pokémon stat sync failed:", e);
    }
  }
  function pkmFriend(id, n) {
    if (!id) return;
    const all = getObj(STORAGE.stats) || {};
    if (!all[id]) return;
    const mult = n > 0 && (pkmCurrentEvent() || {}).id === "valentine" ? 2 : 1;
    all[id].friendship = Math.max(0, Math.min(255, (all[id].friendship == null ? 70 : all[id].friendship) + n * mult));
    setObj(STORAGE.stats, all);
  }

  // ---------- Shiny chain + charm ----------
  const pkmChain = () => pkmJSON("pkm_chain", { n: 0 }).n || 0;
  function pkmChainAdd() {
    const n = pkmChain() + 1;
    pkmSave("pkm_chain", { n });
    const p = pkmJSON("pkm_progress", {});
    if (n > (p.maxChain || 0)) { p.maxChain = n; pkmSave("pkm_progress", p); }
  }
  function pkmChainReset() {
    const n = pkmChain();
    if (n) pkmSave("pkm_chain", { n: 0 });
    if (n >= 5) pkmToast(`🔗 Your shiny chain of ${n} was broken.`, 3000);
  }
  /** Chance that a wild Pokémon is shiny: 1/100, up to ×4 with a chain, ×2 with the Shiny Charm, ×2 at Halloween. */
  function pkmShinyRate(mult = 1) {
    let r = (1 / 100) * (1 + Math.min(pkmChain(), 30) / 10) * mult;
    if (getInt("pkm_item_shiny-charm") > 0) r *= 2;
    if ((pkmCurrentEvent() || {}).id === "halloween") r *= 2;
    return Math.min(0.5, r);
  }

  function pkmMonFromData(d, level, opt = {}) {
    const iv = opt.iv != null ? opt.iv : pkmRand(0, 31);
    const nature = opt.nature && PKM_NATURES[opt.nature] ? opt.nature : pkmPick(Object.keys(PKM_NATURES));
    const abs = (d.abilities || []).filter((a) => !a.is_hidden).map((a) => a.ability.name);
    const hid = (d.abilities || []).find((a) => a.is_hidden);
    const ability = opt.ability || (hid && Math.random() < (opt.hidden != null ? opt.hidden : 0.04) ? hid.ability.name : abs.length ? pkmPick(abs) : "none");
    const base = pkmBase(d);
    const stats = pkmCalcStats(base, level, iv, nature, opt.ev);
    const shiny = opt.shiny != null ? opt.shiny : Math.random() < pkmShinyRate(opt.shinyMult || 1);
    return {
      name: d.name, display: pkmCap(d.name), dexId: d.id, level, iv, nature, ability, types: d.types.map((t) => t.type.name), base, stats, ev: opt.ev || null,
      evYield: Object.fromEntries((d.stats || []).filter((x) => x.effort > 0 && PKM_EV_FROM_API[x.stat.name]).map((x) => [PKM_EV_FROM_API[x.stat.name], x.effort])),
      maxHP: stats.hp, hp: stats.hp, moves: [], baseExp: d.base_experience || 60, shiny, status: null, sleep: 0, held: opt.held || null, costume: opt.costume || null,
      stages: { atk: 0, def: 0, spa: 0, spd: 0, spe: 0, acc: 0, eva: 0 },
      front: shiny ? `${PKM_SPRITES}shiny/${d.id}.png` : (d.sprites && d.sprites.front_default) || `${PKM_SPRITES}${d.id}.png`,
      back: `${PKM_SPRITES}back/${shiny ? "shiny/" : ""}${d.id}.png`,
    };
  }
  async function pkmBuildMon(nameOrId, level, opt = {}) {
    const d = await pkmPokemonData(nameOrId);
    if (!d) return null;
    const m = pkmMonFromData(d, level, opt);
    m.moves = await pkmPickMoves(d, level);
    return m;
  }
  /** One trainer team entry: [species, level, heldItem] or, for friend teams, an object with its own moves, nature, IVs and ability. */
  async function pkmBuildTrainerMon(e) {
    if (Array.isArray(e)) return pkmBuildMon(e[0], e[1], { shiny: false, held: e[2] });
    const d = await pkmPokemonData(e.sp);
    if (!d) return null;
    const okAbility = e.ability && (d.abilities || []).some((a) => a.ability.name === e.ability) ? e.ability : undefined;
    const m = pkmMonFromData(d, e.lv, { shiny: !!e.shiny, held: e.held || null, nature: e.nature, iv: e.iv, ability: okAbility });
    m.moves = await pkmPickMoves(d, e.lv);
    if (e.moves && e.moves.length) { const mv = await pkmMovesByNames(e.moves); if (mv.length) m.moves = mv; }
    return m;
  }
  /** A battle copy of one of YOUR Pokémon (party instance), with its saved moves, nature, ability and held item. */
  async function pkmBuildInstance(id) {
    const party = getObj(STORAGE.party) || {};
    const pm = party[id];
    if (!pm) return null;
    await pkmSyncStats(id, pm.name);
    const s = (getObj(STORAGE.stats) || {})[id] || {};
    const d = await pkmPokemonData(pm.name);
    if (!d) return null;
    const m = pkmMonFromData(d, s.level || 1, { iv: s.iv, nature: s.nature, ability: s.ability, shiny: !!pm.isShiny, held: pm.held, costume: pm.costume, ev: s.ev });
    const learned = [];
    const pending = [];
    let names = Array.isArray(s.moves) && s.moves.length ? s.moves.slice(0, 4) : null;
    if (!names) {
      m.moves = await pkmPickMoves(d, m.level);
    } else {
      const fresh = [...new Set((d._lv || []).filter(([n, l]) => l > (s.movesLv || 0) && l <= m.level && !names.includes(n)).map(([n]) => n))];
      for (const mv of await pkmMovesByNames(fresh)) {
        if (names.length < 4) { names.push(mv.name); learned.push(mv.name); } else pending.push(mv.name);
      }
      m.moves = await pkmMovesByNames(names);
      if (!m.moves.length) m.moves = [{ ...PKM_TACKLE }];
    }
    const all = getObj(STORAGE.stats) || {};
    const s2 = all[id] || s;
    s2.moves = m.moves.map((x) => x.name);
    s2.movesLv = m.level;
    if (pending.length) s2.movesPending = [...new Set([...(s2.movesPending || []), ...pending])];
    all[id] = s2;
    setObj(STORAGE.stats, all);
    m.hp = Math.max(0, Math.min(m.maxHP, Number.isFinite(s.currentHP) ? s.currentHP : m.maxHP));
    m.instanceId = id;
    m.learned = learned;
    m.pending = pending;
    if (getInt("pkm_item_mega-bracelet") > 0) m.megaForms = await pkmMegaForms(m).catch(() => []);
    m.teraType = s.teraType || m.types[0];
    if (getInt("pkm_item_dynamax-band") > 0) m.gmaxForm = await pkmGmaxForm(m).catch(() => null);
    if (id === GM_getValue("pkm_starter_id") && partnerSpriteUrl) m.frontAlt = partnerSpriteUrl;
    return m;
  }

  // ---------- Seasonal events (costume Pokémon) ----------
  const PKM_EVENTS = [
    { id: "valentine", name: "Valentine's Week", icon: "💘", from: [2, 7], to: [2, 14], costume: "💘", perk: "Friendship grows twice as fast",
      pool: ["luvdisc", "clefairy", "alomomola", "skitty", "togepi", "happiny", "snubbull", "spritzee", "swirlix", "igglybuff"] },
    { id: "spring", name: "Spring Festival", icon: "🌸", from: [3, 25], to: [4, 15], costume: "🐰", perk: "+50% coins from wild battles",
      pool: ["buneary", "bunnelby", "azurill", "cherubi", "combee", "flabebe", "hoppip", "sunkern", "cottonee", "exeggcute"] },
    { id: "summer", name: "Summer Splash", icon: "🏖️", from: [7, 1], to: [8, 15], costume: "🕶️", perk: "Safari Zone entry is half price",
      pool: ["squirtle", "psyduck", "wingull", "buizel", "lapras", "corsola", "mantine", "totodile", "piplup", "popplio", "wailmer"] },
    { id: "halloween", name: "Halloween", icon: "🎃", from: [10, 20], to: [11, 2], costume: "🎃", perk: "Shiny odds ×2",
      pool: ["gastly", "haunter", "pumpkaboo", "litwick", "duskull", "misdreavus", "shuppet", "drifloon", "phantump", "sableye", "yamask", "zorua"] },
    { id: "holiday", name: "Holiday Snow", icon: "🎄", from: [12, 10], to: [1, 2], costume: "🎅", perk: "Daily reward coins ×2",
      pool: ["delibird", "snover", "swinub", "snorunt", "spheal", "vanillite", "cubchoo", "bergmite", "sneasel", "jynx", "stantler"] },
  ];
  function pkmCurrentEvent(d = new Date()) {
    const forced = GM_getValue("pkm_event_force", "");
    if (forced) return PKM_EVENTS.find((e) => e.id === forced) || null;
    const md = (d.getMonth() + 1) * 100 + d.getDate();
    return PKM_EVENTS.find((e) => { const a = e.from[0] * 100 + e.from[1], b = e.to[0] * 100 + e.to[1]; return a <= b ? md >= a && md <= b : md >= a || md <= b; }) || null;
  }
  function pkmEventChip() {
    try {
      const e = pkmCurrentEvent();
      return e ? `<span class="pkm-chip pkm-ev-chip" title="${pkmEsc(e.name)}: event Pokémon in costumes appear more often. ${pkmEsc(e.perk)}.">${e.icon} ${pkmEsc(e.name)}</span>` : "";
    } catch { return ""; }
  }

  // ---------- Battle state ----------
  let pkb = null;
  let pkmNextTrainer = null;
  const pkmAlive = (b) => b && pkb === b && !b.over && !!battlePanel;
  const pkmMine = (b, m) => (b.foes ? !b.foes.includes(m) : m !== b.foe);
  const pkmWho = (b, m) => (pkmMine(b, m) ? m.display : b.kind === "trainer" ? `The foe's ${m.display}` : `The wild ${m.display}`);
  const pkmStage = (s) => (s >= 0 ? (2 + s) / 2 : 2 / (2 - s));

  let pkmForcedWild = null; // { name, level }: set by the Legendary hunt panel for the next wild battle
  async function pkmWildFrom(d, lvl, opt = {}) {
    const m = pkmMonFromData(d, lvl, opt);
    m.moves = await pkmPickMoves(d, lvl);
    const sp = await pkmSpeciesData(d.name);
    m.captureRate = sp && sp.capture_rate != null ? sp.capture_rate : 45;
    m.rarity = getRarity(d.name);
    return m;
  }
  async function pkmPickWild(L) {
    const forced = pkmForcedWild;
    pkmForcedWild = null;
    if (forced) {
      const d = await pkmPokemonData(forced.name);
      if (d) {
        const m = await pkmWildFrom(d, Math.max(2, Math.min(MAX_LEVEL, forced.level)));
        if (forced.raid) {
          m.raid = forced.raid;
          m.maxHP = Math.floor(m.maxHP * (2 + forced.raid * 1.5));
          m.hp = m.maxHP;
          m.stats = { ...m.stats, atk: Math.floor(m.stats.atk * 1.15), spa: Math.floor(m.stats.spa * 1.15) };
          m.captureRate = 120;
        } else m.legend = forced.name;
        return m;
      }
    }
    const lvl = pkmWildLevel(L);
    const ev = pkmCurrentEvent();
    const night = pkmIsNight();
    for (let t = 0; t < 5; t++) {
      const fromEvent = ev && Math.random() < 0.4;
      const fromTime = !fromEvent && Math.random() < 0.35;
      const lg = !fromEvent && !fromTime && t === 0 && Math.random() < 0.012 ? pkmRandomLegend() : null;
      const d = await pkmPokemonData(fromEvent ? pkmPick(ev.pool) : fromTime ? pkmPick(night ? PKM_NIGHT_POOL : PKM_DAY_POOL) : lg ? lg.name : pkmRand(1, 649));
      if (!d) continue;
      const r = getRarity(d.name);
      if (!fromEvent && !lg && ["legendary", "mythical", "sublegendary"].includes(r) && t < 4 && Math.random() < 0.85) continue;
      const m = await pkmWildFrom(d, lg ? Math.max(lg.lv, lvl) : lvl, { costume: fromEvent && Math.random() < 0.5 ? ev.costume : null });
      if (lg) m.legend = lg.name;
      return m;
    }
    return null;
  }

  function pkmSyncGlobals(b) {
    wild = { name: b.foe.display, baseName: b.foe.name, sprite: b.foe.front, isShiny: b.foe.shiny, form: "Normal" };
    wHP = b.foe.hp;
    wMaxHP = b.foe.maxHP;
    pHP = b.me.hp;
  }
  function pkmSaveMonHP(m) {
    if (!m || !m.instanceId) return;
    const all = getObj(STORAGE.stats) || {};
    if (!all[m.instanceId]) return;
    const hpNow = m.dynamax && m.dynaBase ? Math.ceil((m.hp * m.dynaBase) / m.maxHP) : m.hp;
    all[m.instanceId].currentHP = Math.max(0, hpNow);
    setObj(STORAGE.stats, all);
    if (m.instanceId === GM_getValue("pkm_starter_id")) setHP(Math.max(0, hpNow));
  }
  const pkmSaveMeHP = (b) => pkmSaveMonHP(b.me);
  function pkmRosterHP(r) {
    if (r.mon) return { hp: r.mon.hp, max: r.mon.maxHP, lv: r.mon.level };
    const s = (getObj(STORAGE.stats) || {})[r.id] || {};
    return { hp: Number.isFinite(s.currentHP) ? s.currentHP : s.hp || 1, max: s.hp || 1, lv: s.level || 1 };
  }

  const PKM_NO_DROP = ["clear-body", "white-smoke", "hyper-cutter", "inner-focus"];
  async function pkmOnEntry(b, m, other) {
    if (!m.entered) { m.entered = true; await pkmHazards(b, m); }
    if (m.hp <= 0) return;
    if (PKM_WEATHER_AB[m.ability]) await pkmSetWeather(b, PKM_WEATHER_AB[m.ability], m);
    if (PKM_TERRAIN_AB[m.ability]) await pkmSetTerrain(b, PKM_TERRAIN_AB[m.ability], m);
    if (m.ability === "intimidate" && other && other.hp > 0) {
      if (PKM_NO_DROP.includes(other.ability)) {
        await pkmSay(b, `${pkmWho(b, other)}'s ${pkmCap(other.ability)} stopped its Attack from being lowered!`, 900);
        return;
      }
      other.stages.atk = Math.max(-6, other.stages.atk - 1);
      await pkmSay(b, `${pkmWho(b, m)}'s Intimidate cut ${pkmWho(b, other)}'s Attack!`, 900);
      if (other.ability === "defiant") { other.stages.atk = Math.min(6, other.stages.atk + 2); await pkmSay(b, `${pkmWho(b, other)}'s Defiant sharply raised its Attack!`, 800); }
      if (other.ability === "competitive") { other.stages.spa = Math.min(6, other.stages.spa + 2); await pkmSay(b, `${pkmWho(b, other)}'s Competitive sharply raised its Sp. Atk!`, 800); }
    }
  }

  let pkmNextRoster = null; // a ready-made team of battle Pokémon (Battle Factory rentals)
  let pkmLastResult = "";
  async function pkmStartBattle() {
    const trainer = pkmNextTrainer;
    pkmNextTrainer = null;
    const customRoster = pkmNextRoster;
    pkmNextRoster = null;
    const b = (pkb = { kind: trainer ? "trainer" : "wild", trainer, busy: true, over: false, msg: "", shown: {}, night: pkmIsNight(), arm: null, specialUsed: false, hazards: { me: {}, foe: {} }, screens: { me: {}, foe: {} }, log: [], zone: null });
    if (battlePanel) {
      battlePanel.classList.add("pk-card", "pkb-card");
      battlePanel.innerHTML = `<div class="pkb-loading">${trainer ? `🧢 ${pkmEsc(trainer.title)} ${pkmEsc(trainer.name)} is getting ready…` : "🌿 Something is moving in the grass…"}</div>`;
    }
    try {
      const activeId = GM_getValue("pkm_starter_id");
      let lead;
      if (customRoster) {
        b.roster = customRoster.map((m, i) => ({ id: `rental${i}`, name: m.name, mon: m }));
        lead = b.roster[0];
        b.me = lead.mon;
      } else {
        const party = getObj(STORAGE.party) || {};
        const list = Object.entries(party);
        if (!list.length) { pkmToast("Choose a starter first"); return closeBattle(); }
        let ids = list.slice(0, PKM_PARTY_SIZE).map(([i]) => i);
        if (activeId && party[activeId]) ids = [activeId, ...ids.filter((i) => i !== activeId)].slice(0, PKM_PARTY_SIZE);
        await Promise.all(ids.map((i) => pkmSyncStats(i, party[i].name)));
        const st = getObj(STORAGE.stats) || {};
        b.roster = ids.map((i) => ({ id: i, name: party[i].name, mon: null }));
        const healthy = (r) => ((st[r.id] || {}).currentHP == null ? 1 : st[r.id].currentHP) > 0;
        lead = b.roster.find(healthy);
        if (!lead) {
          pkmToast("💤 All your Pokémon have fainted. Heal them at the Pokémon Center first.", 4000);
          SOUNDS.battleSound.pause();
          return closeBattle();
        }
        lead.mon = await pkmBuildInstance(lead.id);
        if (!lead.mon) throw new Error("partner data");
        b.me = lead.mon;
      }
      if (trainer) {
        b.team = [];
        for (const e of trainer.team) { const m = await pkmBuildTrainerMon(e); if (m) b.team.push(m); }
        if (!b.team.length) throw new Error("trainer team");
        b.foeIdx = 0;
        b.foe = b.team[0];
      } else {
        b.foe = await pkmPickWild(b.me.level);
      }
      if (!b.foe) throw new Error("no wild Pokémon");
      if (trainer && trainer.double) await pkmDblSetup(b, trainer.triple ? 3 : 2);
      else if (!trainer && pkmWildDoubleNext && b.foe.zone === pkmWildDoubleNext) {
        pkmWildDoubleNext = false;
        const f2 = await pkmZoneWild(pkmZoneById(b.foe.zone));
        if (f2) { b.team = [b.foe, f2]; b.foeIdx = 0; await pkmDblSetup(b); if (!b.double) delete b.team; }
      } else if (!trainer && pkmHordeNext && b.foe.zone === pkmHordeNext) {
        pkmHordeNext = false;
        if (!(await pkmHordeSetup(b))) { delete b.team; b.double = false; b.horde = false; }
      }
      if (pkb !== b || !battlePanel) return;
      pkmSyncGlobals(b);
      pkmTrack("battles");
      b.zone = (b.foe && b.foe.zone) || (trainer && trainer.zone) || null;
      if (trainer && trainer.weather) b.weather = { id: trainer.weather, turns: Infinity };
      else if (!trainer || !(trainer.gym || trainer.league != null || trainer.pvp || trainer.arcade || trainer.facility)) pkmRandomField(b, trainer && trainer.tower ? 0.4 : 0.3);
      const arcadeTxt = trainer && trainer.arcade ? pkmArcadeApply(b, trainer.arcade) : "";
      if (b.zone && !(trainer && trainer.weather)) { const zw = pkmZoneWeather(b.zone); if (zw) b.weather = { id: zw, turns: Infinity, env: true }; }
      let intro = b.foe.legend ? `✨ A legendary aura fills the air… ${b.foe.display} appeared!` : trainer ? `${trainer.title} ${trainer.name} wants to battle! They sent out ${b.foe.display}!` : `A wild ${b.foe.shiny ? "✨ shiny " : ""}${b.foe.display} appeared!`;
      if (b.foe.raid) intro = `💥 RAID BATTLE! A ${"★".repeat(b.foe.raid)} ${b.foe.display} towers over the field!`;
      if (b.weather) intro += ` ${PKM_WEATHER[b.weather.id].on}`;
      if (b.terrain) intro += ` ${PKM_TERRAIN[b.terrain.id].on}`;
      if (arcadeTxt) intro += ` ${arcadeTxt}`;
      if (b.double && !trainer) intro = `Two wild Pokémon appeared: ${b.foes.map((m) => m.display).join(" and ")}! Go, ${b.mine.map((m) => m.display).join(" and ")}!`;
      else if (b.double) intro = `${trainer.title} ${trainer.name} wants a double battle! They sent out ${b.foes.map((m) => m.display).join(" and ")}! Go, ${b.mine.map((m) => m.display).join(" and ")}!`;
      if (b.foe.costume) intro += ` It's wearing a costume!`;
      if (lead.id !== activeId) intro += ` Go, ${b.me.display}!`;
      if ((b.me.learned || []).length) intro += ` ${b.me.display} learned ${b.me.learned.map(pkmCap).join(", ")}!`;
      if ((b.me.pending || []).length) intro += ` (${b.me.display} wants to learn ${b.me.pending.map(pkmCap).join(", ")}: Bag → Moves)`;
      await pkmSay(b, intro, 1200);
      if (b.double) await pkmDblEntries(b);
      else { await pkmOnEntry(b, b.me, b.foe); await pkmOnEntry(b, b.foe, b.me); }
      if (b.double) { pkmDblNewTurn(b); return; }
      b.busy = false;
      drawBattle(`What will ${b.me.display} do?`);
    } catch (e) {
      console.warn("Battle start failed:", e);
      if (pkb === b) { pkmToast("Couldn't start the battle (PokéAPI didn't answer). Try again in a moment."); SOUNDS.battleSound.pause(); closeBattle(); }
    }
  }

  function pkmCatchChance(b, ball) {
    if (ball === "master") return 1;
    const M = b.foe.maxHP, H = Math.max(1, b.foe.hp);
    const bonus = { poke: 1, great: 1.5, ultra: 2, safari: 1.5 }[ball] || 1;
    const st = { slp: 2.5, frz: 2.5, par: 1.5, psn: 1.5, brn: 1.5 }[b.foe.status] || 1;
    const a = (((3 * M - 2 * H) * (b.foe.captureRate || 45) * bonus) / (3 * M)) * st * (b.catchMod || 1);
    return Math.min(1, Math.pow(Math.max(1, a) / 255, 0.75));
  }

  function pkmDrawBattle(msg) {
    const b = pkb;
    if (!battlePanel) return;
    if (!b || !b.me || !b.foe) {
      if (msg) battlePanel.innerHTML = `<div class="pkb-loading">${pkmEsc(msg)}</div>`;
      return;
    }
    if (b.double) return pkmDrawDouble(msg);
    if (msg != null) b.msg = msg;
    const me = b.me, foe = b.foe;
    const pct = (m) => Math.max(0, Math.round((m.hp / m.maxHP) * 100));
    const hpCol = (p) => (p > 50 ? "#2fbf71" : p > 20 ? "#ffb020" : "#ff4d4f");
    const hpBar = (m, side) => {
      const p = pct(m);
      const from = b.shown[side] != null ? b.shown[side] : p;
      b.shown[side] = p;
      return `<div class="pkb-hp"><span data-to="${p}" style="width:${from}%;background:${hpCol(p)}"></span></div>`;
    };
    const st = (m) => (m.status ? `<span class="pkb-st st-${m.status}">${m.status.toUpperCase()}</span>` : "") + (m.dynamax > 0 ? `<span class="pkb-st st-dyn">DYNAMAX</span>` : "") + (m.tera ? `<span class="pkb-st st-tera">TERA</span>` : "") + (m.confused > 0 ? `<span class="pkb-st st-cnf">CNF</span>` : "") + (m.sub > 0 ? `<span class="pkb-st st-sub" title="Substitute">🛡️</span>` : "");
    const stages = (m) => Object.entries(m.stages).filter(([, v]) => v).map(([k, v]) => `<span class="pkb-stage ${v > 0 ? "up" : "down"}">${PKM_STAT_LABEL[k]} ${v > 0 ? "↑".repeat(Math.min(3, v)) : "↓".repeat(Math.min(3, -v))}</span>`).join("");
    const types = (m) => m.types.map((t) => `<span class="pk-type ${t}">${t}</span>`).join("");
    const heldTag = (m) => (m.held ? `<img class="pkb-held" src="${PKM_ITEM_IMG}${m.held}.png" alt="" title="Holding ${pkmEsc(pkmCap(m.held))}">` : "");
    const ab = (m) => `<span class="pkb-ab" title="${pkmEsc(PKM_ABILITY_INFO[m.ability] || "")}">${pkmEsc(pkmCap(m.ability))}</span>`;
    const xpS = (getObj(STORAGE.stats) || {})[me.instanceId] || {};
    const xp = xpProgress(me.level, xpS.xp || 0);
    const tr = b.trainer;
    const trainerBar = tr
      ? `<div class="pkb-trainer"><img class="pkb-tr-img" src="${pkmEsc(tr.sprite)}" alt=""><div><b>${pkmEsc(tr.title)} ${pkmEsc(tr.name)}</b>
         <div class="pkb-balls">${b.team.map((m, i) => `<span class="${m.hp <= 0 ? "out" : i === b.foeIdx ? "cur" : ""}" title="${pkmEsc(m.display)}"></span>`).join("")}</div></div>
         ${tr.gym ? `<span class="pkb-gym">${PKM_GYMS[tr.gym - 1].icon} Gym battle</span>` : tr.league != null ? `<span class="pkb-gym">🏆 ${pkmEsc(pkmRegion(tr.region).name)} League ${tr.league + 1}/${pkmLeagueOf(pkmRegion(tr.region).id).length}</span>`
           : tr.tower ? `<span class="pkb-gym">🗼 Tower · streak ${tr.streak}${tr.boss ? " · BOSS" : ""}</span>` : tr.rival ? `<span class="pkb-gym">😤 Rival</span>` : tr.pvp ? `<span class="pkb-gym">🔗 Friend battle</span>` : ""}</div>`
      : "";
    const myBalls = `<div class="pkb-mine">${b.roster.map((r) => { const h = pkmRosterHP(r); return `<span class="${h.hp <= 0 ? "out" : r.mon === me ? "cur" : ""}" title="${pkmEsc(pkmCap(r.name))} ${h.hp}/${h.max}"></span>`; }).join("")}</div>`;
    const busy = b.busy || b.over;
    let controls;
    if (b.awaitSwitch) {
      controls = pkmSwitchButtons(b, true) + (getInt("pkm_revive") > 0 ? `<button type="button" class="pk-btn pkb-act" data-act="revive"><div class="pk-ico">✨</div><div class="pk-label">Revive ${pkmEsc(me.display)}</div><div class="pk-badge">${getInt("pkm_revive")}</div></button>` : "");
    } else if (b.awaitRevive) {
      controls = `<button type="button" class="pk-btn pkb-act" data-act="revive"><div class="pk-ico">✨</div><div class="pk-label">Use Revive</div><div class="pk-badge">${getInt("pkm_revive")}</div></button>
        <button type="button" class="pk-btn pkb-act" data-act="giveup"><div class="pk-ico">🏳️</div><div class="pk-label">Give up</div></button>`;
    } else {
      const mv = me.moves.map((m, i) => {
        const zm = b.arm === "z" && m.cls !== "status" ? pkmZMove(m) : null;
        const mx = me.dynamax > 0 ? pkmMaxMove(m, me) : null;
        const shown = zm || mx || m;
        const e = m.cls === "status" ? 1 : pkmMoveEff(me, foe, shown);
        const hint = e === 0 ? "No effect" : e > 1 ? "Super effective" : e < 1 ? "Not very effective" : "";
        return `<button type="button" class="pk-btn pkb-move t-${m.type}${zm ? " pkb-z" : ""}${m.cls === "status" ? " pkb-status" : ""}" data-mv="${i}" ${busy || m.pp <= 0 ? "disabled" : ""}>
          <div class="pk-label">${pkmEsc(shown.display)}</div>
          <div class="pkb-mv-sub"><span class="pk-type ${m.type}">${m.type}</span><span title="${m.cls}">${m.cls === "status" ? "◌ Status" : `${m.cls === "special" ? "✦" : "✊"} ${m.fixed ? "—" : shown.power}`}</span><span>PP ${m.pp}/${m.maxPP}</span></div>
          ${hint ? `<div class="pkb-eff e-${e > 1 ? "up" : e === 0 ? "no" : "down"}">${hint}</div>` : ""}</button>`;
      });
      while (mv.length < 4) mv.push(`<button type="button" class="pk-btn pkb-move empty" disabled><div class="pk-label">—</div></button>`);
      const balls = getInt(STORAGE.balls) + getInt(STORAGE.greatBalls) + getInt(STORAGE.ultraBalls) + getInt(STORAGE.masterBalls);
      const items = getInt(STORAGE.potions) + getInt("pkm_xattack");
      const others = b.roster.filter((r) => r.mon !== me && pkmRosterHP(r).hp > 0).length;
      const act = (id, ico, label, count, dis, title) =>
        `<button type="button" class="pk-btn pkb-act" data-act="${id}" ${dis ? "disabled" : ""} title="${pkmEsc(title || label)}"><div class="pk-ico">${ico}</div><div class="pk-label">${label}</div>${count != null ? `<div class="pk-badge">${count}</div>` : ""}</button>`;
      controls =
        mv.join("") +
        act("ball", "⭕", "Ball", balls, busy || !!tr || balls <= 0, tr ? "You can't catch a trainer's Pokémon" : "Throw a ball") +
        act("items", "🎒", "Items", items, busy || items <= 0, "Potion or X Attack") +
        act("switch", "🔄", "Switch", others, busy || others <= 0, "Send out another party Pokémon") +
        act("run", tr ? "🏳️" : "🏃", tr ? "Forfeit" : "Run", null, b.over, tr ? "Give up this trainer battle" : "Run away");
    }
    const chain = pkmChain();
    const ring = getInt("pkm_item_mega-bracelet") > 0, zring = getInt("pkm_item_z-power-ring") > 0;
    const canMega = ring && !b.specialUsed && !me.mega && !!(me.megaForms && me.megaForms.length);
    const canZ = zring && !b.specialUsed;
    const canTera = getInt("pkm_item_tera-orb") > 0 && !b.specialUsed;
    const canDyna = getInt("pkm_item_dynamax-band") > 0 && !b.specialUsed;
    const special = !busy && !b.awaitSwitch && !b.awaitRevive && (canMega || canZ || canTera || canDyna)
      ? `<div class="pkb-special">${canMega ? `<button type="button" class="pkm-btn2${b.arm === "mega" ? " primary" : ""}" data-sp="mega" aria-pressed="${b.arm === "mega"}" title="Mega Evolve before your move (once per battle, instead of a Z-Move)">💠 Mega Evolve</button>` : ""}${canZ ? `<button type="button" class="pkm-btn2${b.arm === "z" ? " primary" : ""}" data-sp="z" aria-pressed="${b.arm === "z"}" title="Turn your next move into a Z-Move (once per battle, instead of Mega Evolving)">Ⓩ Z-Move</button>` : ""}${canTera ? `<button type="button" class="pkm-btn2${b.arm === "tera" ? " primary" : ""}" data-sp="tera" aria-pressed="${b.arm === "tera"}" title="Terastallize into the ${pkmEsc(pkmCap(me.teraType || me.types[0]))} type (once per battle)">💎 Terastallize</button>` : ""}${canDyna ? `<button type="button" class="pkm-btn2${b.arm === "dyna" ? " primary" : ""}" data-sp="dyna" aria-pressed="${b.arm === "dyna"}" title="Dynamax for 3 turns: double HP and Max Moves (once per battle)">🔴 Dynamax</button>` : ""}<span class="pkm-dim">${b.arm ? "Now pick a move" : "One use per battle"}</span></div>` : "";
    const fieldCls = `${b.night ? " night" : ""}${b.weather ? ` w-${b.weather.id}` : ""}${b.terrain ? ` t-${b.terrain.id}` : ""}`;
    battlePanel.classList.add("pk-card", "pkb-card");
    battlePanel.innerHTML = `${trainerBar}${pkmFieldChips(b)}
      <div class="pkb-field${fieldCls}"${b.zone && pkmZoneById(b.zone) ? ` style="background:${PKM_ZONE_THEME[pkmZoneById(b.zone).theme]}"` : ""}>
        <div class="pkb-row foe">
          <div class="pkb-info"><div class="pkb-name">${foe.shiny ? "✨ " : ""}${pkmEsc(foe.display)} <span>Lv ${foe.level}</span>${st(foe)}${heldTag(foe)}</div><div class="pkb-types">${types(foe)}${ab(foe)}${stages(foe)}</div>${hpBar(foe, "foe")}</div>
          <div class="pkb-spr"><img id="wild-img" class="pkb-sprite foe" src="${pkmEsc(foe.front)}" alt="${pkmEsc(foe.display)}">${foe.costume ? `<span class="pkb-costume">${foe.costume}</span>` : ""}</div>
        </div>
        <div class="pkb-row me">
          <div class="pkb-spr"><img id="pkb-me-img" class="pkb-sprite me" src="${pkmEsc(me.back)}" alt="${pkmEsc(me.display)}">${me.costume ? `<span class="pkb-costume">${me.costume}</span>` : ""}</div>
          <div class="pkb-info"><div class="pkb-name">${pkmEsc(me.display)} <span>Lv ${me.level}</span>${st(me)}${heldTag(me)}</div><div class="pkb-types">${types(me)}${ab(me)}${stages(me)}</div>${hpBar(me, "me")}
            <div class="pkb-hpnum">${myBalls}<span>${Math.max(0, me.hp)}/${me.maxHP} HP</span></div><div class="pkb-xp" title="XP ${xp.have}/${xp.need}"><span style="width:${xp.pct}%"></span></div></div>
        </div>
      </div>
      <div class="pkb-msg" aria-live="polite">${pkmEsc(b.msg || `What will ${me.display} do?`)}</div>
      ${b.kind === "wild" && !b.over ? `<div class="pkb-catch">Catch chance with a Poké Ball ≈ ${Math.round(pkmCatchChance(b, "poke") * 100)}%${foe.rarity && foe.rarity !== "common" ? ` · ${pkmCap(foe.rarity)}` : ""} · 🔗 Chain ${chain} · ✨ 1 in ${Math.round(1 / pkmShinyRate())}</div>` : ""}
      ${special}
      <div class="pk-controls pkb-controls${b.awaitSwitch ? " pkb-switching" : ""}">${controls}</div>`;
    const tImg = battlePanel.querySelector(".pkb-tr-img");
    if (tImg) pkmTrainerImg(tImg);
    const meImg = battlePanel.querySelector("#pkb-me-img");
    meImg.onerror = () => { meImg.onerror = null; meImg.src = me.frontAlt || me.front; meImg.classList.add("flip"); };
    requestAnimationFrame(() => battlePanel && battlePanel.querySelectorAll(".pkb-hp span[data-to]").forEach((s) => (s.style.width = s.dataset.to + "%")));
    battlePanel.onclick = (e) => {
      const sp = e.target.closest("[data-sp]");
      if (sp && !sp.disabled) { b.arm = b.arm === sp.dataset.sp ? null : sp.dataset.sp; return drawBattle(); }
      const m = e.target.closest("[data-mv]");
      if (m && !m.disabled) return pkmTurn({ type: "move", idx: +m.dataset.mv });
      const sw = e.target.closest("[data-sw]");
      if (sw && !sw.disabled) return pkmPickSwitch(sw.dataset.sw);
      const it = e.target.closest("[data-item]");
      if (it && !it.disabled) { it.closest(".pk-ballpick")?.remove(); return pkmBattleAct(it.dataset.item); }
      const a = e.target.closest("[data-act]");
      if (a && !a.disabled) pkmBattleAct(a.dataset.act);
    };
    pkmBattleKeys(battlePanel.querySelector(".pk-controls"));
  }
  function pkmSwitchButtons(b, forced) {
    const party = getObj(STORAGE.party) || {};
    const dexArr = getArr(STORAGE.pokedex) || [];
    return b.roster.map((r) => {
      const h = pkmRosterHP(r);
      const cur = r.mon === b.me;
      const p = Math.max(0, Math.round((h.hp / h.max) * 100));
      return `<button type="button" class="pk-btn pkb-sw" data-sw="${pkmEsc(r.id)}" ${h.hp <= 0 || cur ? "disabled" : ""}>
        <img src="${pkmEsc(pkmMonSprite(party[r.id] || { name: r.name }, dexArr))}" alt=""><div class="pk-label">${pkmEsc(pkmCap(r.name))}</div>
        <div class="pkb-sw-sub">Lv ${Math.min(MAX_LEVEL, h.lv)} · ${Math.max(0, h.hp)}/${h.max}</div><div class="pkb-hp mini"><span style="width:${p}%;background:${p > 50 ? "#2fbf71" : p > 20 ? "#ffb020" : "#ff4d4f"}"></span></div></button>`;
    }).join("") + (forced ? "" : `<button type="button" class="pk-btn pkb-act" data-act="cancel"><div class="pk-ico">✕</div><div class="pk-label">Cancel</div></button>`);
  }
  function pkmPickSwitch(id) {
    const b = pkb;
    if (!b) return;
    if (b.awaitSwitch) {
      b.awaitSwitch = false;
      b.busy = true;
      return pkmDoSwitch(b, id).then(async () => {
        if (!pkmAlive(b)) return;
        if (b.me.hp <= 0) { await pkmCheckFaint(b); return; }
        b.busy = false;
        drawBattle(`What will ${b.me.display} do?`);
      });
    }
    b.choosing = null;
    pkmTurn({ type: "item", run: (bb) => pkmDoSwitch(bb, id) });
  }
  async function pkmDoSwitch(b, id) {
    const r = b.roster.find((x) => x.id === id);
    if (!r) return;
    if (!r.mon) r.mon = await pkmBuildInstance(id);
    if (!r.mon || r.mon.hp <= 0 || !pkmAlive(b)) return;
    const old = b.me;
    old.stages = { atk: 0, def: 0, spa: 0, spd: 0, spe: 0, acc: 0, eva: 0 };
    pkmEndDynamax(old);
    old.confused = 0; old.charging = null; old.invuln = false; old.sub = 0; old.mustRecharge = false; old.flinched = false; old.entered = false;
    old.flashFire = false;
    if (old.ability === "natural-cure") old.status = null;
    if (old.ability === "regenerator" && old.hp > 0) { old.hp = Math.min(old.maxHP, old.hp + Math.floor(old.maxHP / 3)); pkmSaveMonHP(old); }
    b.me = r.mon;
    b.shown.me = null;
    pkmSyncGlobals(b);
    pkmQuest("switch");
    await pkmSay(b, old.hp > 0 ? `Come back, ${old.display}! Go, ${b.me.display}!` : `Go, ${b.me.display}!`, 900);
    if (b.me.learned && b.me.learned.length) { await pkmSay(b, `${b.me.display} learned ${b.me.learned.map(pkmCap).join(", ")}!`, 900); b.me.learned = []; }
    await pkmOnEntry(b, b.me, b.foe);
  }

  async function pkmSay(b, msg, ms = 800, float) {
    if (b && b.log && msg) b.log.push(msg);
    if (!pkmAlive(b) && !(b && b.over && pkb === b)) return;
    drawBattle(msg);
    if (float && battlePanel) {
      const row = battlePanel.querySelector(`.pkb-row.${float.side}`);
      if (row) { const f = document.createElement("div"); f.className = "pkb-dmg"; f.textContent = float.text; row.appendChild(f); }
    }
    await pkmWait(ms);
  }

  /** Type effectiveness of a move, with abilities (Levitate, Scrappy, Wonder Guard...) and Air Balloon. */
  const PKM_MOLD = ["mold-breaker", "teravolt", "turboblaze"];
  function pkmMoveEff(att, def, mv) {
    const ig = PKM_MOLD.includes(att.ability);
    let types = def.types;
    if (att.ability === "scrappy" && (mv.type === "normal" || mv.type === "fighting")) types = types.filter((t) => t !== "ghost");
    let e = pkmEff(mv.type, types);
    if (mv.type === "ground" && ((!ig && def.ability === "levitate") || def.held === "air-balloon")) e = 0;
    if (!ig && def.ability === "wonder-guard" && e <= 1) e = 0;
    return e;
  }
  function pkmSpeed(m, b) {
    let s = m.stats.spe * pkmStage(m.stages.spe);
    const w = pkmWeatherId(b);
    if (w && PKM_WEATHER_SPEED[m.ability] === w) s *= 2;
    if (m.held === "choice-scarf") s *= 1.5;
    if (m.ability === "quick-feet" && m.status) s *= 1.5;
    else if (m.status === "par") s *= 0.5;
    return s;
  }

  function pkmDamage(att, def, mv, b) {
    if (mv.fixed) {
      const fe = pkmMoveEff(att, def, mv);
      const fd = fe === 0 ? 0 : mv.fixed.kind === "level" ? att.level : mv.fixed.kind === "flat" ? mv.fixed.n : Math.max(1, Math.floor(def.hp / 2));
      return { dmg: fd, eff: fe === 0 ? 0 : 1, crit: false };
    }
    const phys = mv.cls === "physical";
    const ig = PKM_MOLD.includes(att.ability);
    const dAb = ig ? "" : def.ability;
    const w = pkmWeatherId(b);
    const terrain = b && b.terrain ? b.terrain.id : null;
    let A = (phys ? att.stats.atk : att.stats.spa) * pkmStage(dAb === "unaware" ? 0 : phys ? att.stages.atk : att.stages.spa);
    let D = (phys ? def.stats.def : def.stats.spd) * pkmStage(att.ability === "unaware" ? 0 : phys ? def.stages.def : def.stages.spd);
    const ab = att.ability;
    if (phys && (ab === "huge-power" || ab === "pure-power")) A *= 2;
    if (phys && ab === "hustle") A *= 1.5;
    if (phys && ab === "guts" && att.status) A *= 1.5;
    else if (phys && att.status === "brn") A *= 0.5;
    if (!phys && ab === "solar-power" && w === "sun") A *= 1.5;
    if (phys && att.held === "choice-band") A *= 1.5;
    if (!phys && att.held === "choice-specs") A *= 1.5;
    if (phys && att.held === "muscle-band") A *= 1.1;
    if (!phys && att.held === "wise-glasses") A *= 1.1;
    if (att.held === "light-ball" && att.name === "pikachu") A *= 2;
    if (phys && dAb === "marvel-scale" && def.status) D *= 1.5;
    if (!phys && def.held === "assault-vest") D *= 1.5;
    if (!phys && w === "sand" && def.types.includes("rock")) D *= 1.5;
    let power = mv.power;
    if (ab === "technician" && power <= 60) power *= 1.5;
    const pinch = { blaze: "fire", torrent: "water", overgrow: "grass", swarm: "bug" }[ab];
    if (pinch === mv.type && att.hp <= att.maxHP / 3) power *= 1.5;
    if (att.flashFire && mv.type === "fire") power *= 1.5;
    if (PKM_TYPE_BOOST[att.held] === mv.type) power *= 1.2;
    if (dAb === "thick-fat" && (mv.type === "fire" || mv.type === "ice")) power *= 0.5;
    if (ab === "iron-fist" && /punch|mash|uppercut/.test(mv.name)) power *= 1.2;
    if (ab === "reckless" && mv.drain < 0) power *= 1.2;
    if (ab === "sheer-force" && (mv.ailmentChance > 0 || mv.flinch > 0)) power *= 1.3;
    const eff = pkmMoveEff(att, def, mv);
    let stab = att.types.includes(mv.type) ? (ab === "adaptability" ? 2 : 1.5) : 1;
    if (att.tera === "stellar") stab = (att.origTypes || []).includes(mv.type) ? 2 : 1.2;
    else if (att.tera) stab = mv.type === att.tera ? ((att.origTypes || []).includes(mv.type) ? 2 : 1.5) : (att.origTypes || []).includes(mv.type) ? 1.5 : 1;
    const critStage = (mv.crit || 0) + (ab === "super-luck" ? 1 : 0) + (att.held === "scope-lens" || att.held === "razor-claw" ? 1 : 0);
    const crit = !["battle-armor", "shell-armor"].includes(dAb) && Math.random() < [1 / 24, 1 / 8, 1 / 2, 1][Math.min(3, critStage)];
    // Field and item multipliers
    let mod = 1;
    const wx = w && PKM_WEATHER[w];
    if (wx && wx.up === mv.type) mod *= 1.5;
    if (wx && wx.down === mv.type) mod *= 0.5;
    if (terrain && pkmGrounded(att) && PKM_TERRAIN[terrain].type === mv.type) mod *= 1.3;
    if (terrain === "misty" && mv.type === "dragon" && pkmGrounded(def)) mod *= 0.5;
    const sc = b && b.screens ? b.screens[pkmMine(b, def) ? "me" : "foe"] : null;
    if (sc && !crit && ((phys && sc.reflect > 0) || (!phys && sc.light > 0))) mod *= 0.5;
    if (mv.spread) mod *= mv.spread;
    if (att.held === "life-orb") mod *= 1.3;
    if (att.held === "expert-belt" && eff > 1) mod *= 1.2;
    if (ab === "tinted-lens" && eff < 1) mod *= 2;
    if (dAb === "multiscale" && def.hp === def.maxHP) mod *= 0.5;
    if ((dAb === "solid-rock" || dAb === "filter") && eff > 1) mod *= 0.75;
    if (dAb === "heatproof" && mv.type === "fire") mod *= 0.5;
    if (dAb === "dry-skin" && mv.type === "fire") mod *= 1.25;
    const base = Math.floor(Math.floor((Math.floor((2 * att.level) / 5 + 2) * power * A) / Math.max(1, D)) / 50) + 2;
    const critMult = crit ? (ab === "sniper" ? 2.25 : 1.5) : 1;
    const dmg = eff === 0 ? 0 : Math.max(1, Math.floor(base * stab * eff * critMult * mod * (0.85 + Math.random() * 0.15)));
    return { dmg, eff, crit };
  }

  const PKM_AIL = { burn: "brn", poison: "psn", paralysis: "par", sleep: "slp", freeze: "frz" };
  const PKM_AIL_IMMUNE = { brn: ["fire"], psn: ["poison", "steel"], par: ["electric"], frz: ["ice"], slp: [] };
  const PKM_AIL_TXT = { brn: "was burned", psn: "was poisoned", par: "is paralyzed! It may be unable to move", slp: "fell asleep", frz: "was frozen solid" };
  const PKM_AB_STATUS = { limber: ["par"], insomnia: ["slp"], "vital-spirit": ["slp"], "water-veil": ["brn"], immunity: ["psn"], "magma-armor": ["frz"] };
  const PKM_ABSORB = { "water-absorb": ["water", "heal"], "volt-absorb": ["electric", "heal"], "dry-skin": ["water", "heal"], "lightning-rod": ["electric", "spa"], "storm-drain": ["water", "spa"], "motor-drive": ["electric", "spe"], "sap-sipper": ["grass", "atk"] };
  const PKM_ALWAYS_HIT = { rain: ["thunder", "hurricane"], hail: ["blizzard"] };

  async function pkmSetStatus(b, m, ail, src) {
    if (!ail || m.hp <= 0 || m.status || m.types.some((t) => PKM_AIL_IMMUNE[ail].includes(t))) return;
    if ((PKM_AB_STATUS[m.ability] || []).includes(ail)) return;
    if (b.terrain && pkmGrounded(m) && (b.terrain.id === "misty" || (b.terrain.id === "electric" && ail === "slp"))) return;
    if (ail === "frz" && pkmWeatherId(b) === "sun") return;
    m.status = ail;
    if (ail === "slp") m.sleep = pkmRand(1, 3);
    await pkmSay(b, `${pkmWho(b, m)} ${PKM_AIL_TXT[ail]}!`, 750);
    if (m.held === "lum-berry") {
      m.status = null;
      m.held = null;
      m.consumed = true;
      await pkmSay(b, `${pkmWho(b, m)}'s Lum Berry cured it!`, 750);
    }
    if (m.status && m.ability === "synchronize" && src && src !== m && src.hp > 0 && !src.status && ["brn", "psn", "par"].includes(ail)) {
      await pkmSay(b, `${pkmWho(b, m)}'s Synchronize passed it back!`, 700);
      await pkmSetStatus(b, src, ail);
    }
  }
  async function pkmBerry(b, m) {
    if (m.hp <= 0 || m.hp > m.maxHP / 2) return;
    let heal = 0;
    if (m.held === "oran-berry") heal = 10;
    if (m.held === "sitrus-berry") heal = Math.floor(m.maxHP / 4);
    if (!heal) return;
    const name = pkmCap(m.held);
    m.held = null;
    m.consumed = true;
    heal = Math.min(heal, m.maxHP - m.hp);
    m.hp += heal;
    if (pkmMine(b, m)) pkmSaveMonHP(m);
    pkmSyncGlobals(b);
    await pkmSay(b, `${pkmWho(b, m)} ate its ${name} and restored ${heal} HP!`, 850, { side: pkmMine(b, m) ? "me" : "foe", text: `+${heal}` });
  }
  /** Lose HP outside of an attack (ignored by Magic Guard). */
  async function pkmHurt(b, m, amount, text) {
    if (m.hp <= 0 || m.ability === "magic-guard") return;
    const d = Math.max(1, Math.floor(amount));
    m.hp = Math.max(0, m.hp - d);
    if (pkmMine(b, m)) pkmSaveMonHP(m);
    pkmSyncGlobals(b);
    await pkmSay(b, text, 700, { side: pkmMine(b, m) ? "me" : "foe", text: `-${d}` });
  }
  async function pkmHeal(b, m, amount, text) {
    if (m.hp <= 0 || m.hp >= m.maxHP) return;
    const h = Math.min(m.maxHP - m.hp, Math.max(1, Math.floor(amount)));
    m.hp += h;
    if (pkmMine(b, m)) pkmSaveMonHP(m);
    pkmSyncGlobals(b);
    await pkmSay(b, text, 650, { side: pkmMine(b, m) ? "me" : "foe", text: `+${h}` });
  }

  // ---------- Terastallization and Dynamax (Gen 9 / Gen 8) ----------
  const PKM_MAX_NAMES = { normal: "Max Strike", fire: "Max Flare", water: "Max Geyser", electric: "Max Lightning", grass: "Max Overgrowth", ice: "Max Hailstorm", fighting: "Max Knuckle", poison: "Max Ooze", ground: "Max Quake", flying: "Max Airstream", psychic: "Max Mindstorm", bug: "Max Flutterby", rock: "Max Rockfall", ghost: "Max Phantasm", dragon: "Max Wyrmwind", dark: "Max Darkness", steel: "Max Steelspike", fairy: "Max Starfall" };
  const PKM_MAX_FX = {
    fire: { w: "sun" }, water: { w: "rain" }, rock: { w: "sand" }, ice: { w: "hail" }, electric: { t: "electric" }, grass: { t: "grassy" }, psychic: { t: "psychic" }, fairy: { t: "misty" },
    fighting: { self: [["atk", 1]] }, poison: { self: [["spa", 1]] }, ground: { self: [["spd", 1]] }, flying: { self: [["spe", 1]] }, steel: { self: [["def", 1]] },
    normal: { foe: [["spe", -1]] }, bug: { foe: [["spa", -1]] }, ghost: { foe: [["def", -1]] }, dragon: { foe: [["atk", -1]] }, dark: { foe: [["spd", -1]] },
  };
  function pkmMaxPower(mv) {
    const p = mv.fixed ? 100 : mv.power;
    const low = mv.type === "fighting" || mv.type === "poison";
    const tiers = low ? [[40, 70], [50, 75], [60, 80], [70, 85], [100, 90], [140, 95]] : [[40, 90], [50, 100], [60, 110], [70, 120], [100, 130], [140, 140]];
    for (const [lim, v] of tiers) if (p <= lim) return v;
    return low ? 100 : 150;
  }
  /** The Max Move version of a move (status moves become Max Guard). */
  function pkmMaxMove(mv) {
    if (mv.cls === "status") return { ...mv, name: "max-guard", display: "Max Guard", prio: 4, acc: null, stats: [], healing: 0, ailment: null, target: "user", max: true, srcMove: mv.srcMove || mv };
    return { ...mv, name: `max-${mv.type}`, display: PKM_MAX_NAMES[mv.type] || "Max Strike", power: pkmMaxPower(mv), acc: null, crit: 0, drain: 0, flinch: 0, ailment: null, ailmentChance: 0, stats: [], statChance: 0, minHits: 0, maxHits: 0, twoTurn: null, recharge: false, selfKO: false, fixed: null, max: true, srcMove: mv.srcMove || mv };
  }
  async function pkmMaxEffect(b, att, def, mv) {
    const fx = PKM_MAX_FX[mv.type];
    if (!fx || !pkmAlive(b)) return;
    if (fx.w) await pkmSetWeather(b, fx.w, att);
    if (fx.t) await pkmSetTerrain(b, fx.t, att);
    if (fx.self && att.hp > 0) await pkmApplyStages(b, att, fx.self, att);
    if (fx.foe && def.hp > 0) await pkmApplyStages(b, def, fx.foe, att);
  }
  async function pkmGmaxForm(m) {
    const sp = await pkmSpeciesData(m.name);
    return ((sp && sp.varieties) || []).find((n) => /-gmax$/.test(n)) || null;
  }
  async function pkmTerastallize(b) {
    const m = b.me;
    b.specialUsed = true;
    const tt = m.teraType || m.types[0];
    m.origTypes = m.types.slice();
    m.tera = tt;
    m.types = [tt];
    playSound("evolve");
    pkmTrack("teras");
    await pkmSay(b, `💎 ${m.display} Terastallized into the ${pkmCap(tt)} type!`, 1400);
  }
  async function pkmDynamax(b) {
    const m = b.me;
    b.specialUsed = true;
    m.dynaBase = m.maxHP;
    m.maxHP *= 2;
    m.hp *= 2;
    m.dynamax = 3;
    if (m.gmaxForm) {
      const d = await pkmPokemonData(m.gmaxForm).catch(() => null);
      const sp = (d && d.sprites) || {};
      m.gmaxOrig = { front: m.front, back: m.back, display: m.display };
      if (m.shiny ? sp.back_shiny : sp.back_default) m.back = m.shiny ? sp.back_shiny : sp.back_default;
      if (m.shiny ? sp.front_shiny : sp.front_default) m.front = m.shiny ? sp.front_shiny : sp.front_default;
      m.display = `G-Max ${m.display}`;
    }
    pkmSyncGlobals(b);
    playSound("evolve");
    pkmTrack("dynamaxes");
    await pkmSay(b, `🔴 ${m.display} ${m.gmaxOrig ? "Gigantamaxed" : "Dynamaxed"}!`, 1500);
  }
  /** Back to normal size, keeping the same share of HP. */
  function pkmEndDynamax(m) {
    if (!m.dynaBase || !m.maxHP) { m.dynamax = 0; return; }
    const ratio = m.hp / m.maxHP;
    m.maxHP = m.dynaBase;
    m.hp = m.hp > 0 ? Math.max(1, Math.ceil(m.maxHP * ratio)) : 0;
    m.dynamax = 0;
    m.dynaBase = 0;
    if (m.gmaxOrig) { m.front = m.gmaxOrig.front; m.back = m.gmaxOrig.back; m.display = m.gmaxOrig.display; m.gmaxOrig = null; }
  }

  // ---------- Stat stages, status moves, hazards, screens ----------
  const PKM_STAGE_TXT = { 1: "rose", 2: "sharply rose", 3: "drastically rose", "-1": "fell", "-2": "harshly fell", "-3": "severely fell" };
  const PKM_HAZARD_TXT = { rock: "Pointed stones float in the air around", spikes: "Spikes were scattered on the ground around", tspikes: "Poison spikes were scattered on the ground around" };
  /** Accuracy and evasion stages: 3/3 at 0, up to 9/3 at +6, down to 3/9 at -6. */
  const pkmAccStage = (s) => (s >= 0 ? (3 + s) / 3 : 3 / (3 - s));
  /** changes = [[stageKey, +/-n], ...]. src is the Pokémon causing them (a foe's drop can be blocked). */
  async function pkmApplyStages(b, m, changes, src) {
    for (const [k, n] of changes) {
      if (!pkmAlive(b) || m.hp <= 0) return;
      const who = pkmWho(b, m);
      if (n < 0 && src && src !== m && (["clear-body", "white-smoke"].includes(m.ability) || (m.ability === "hyper-cutter" && k === "atk"))) {
        await pkmSay(b, `${who}'s ${pkmCap(m.ability)} prevents stat loss!`, 700);
        continue;
      }
      const cur = m.stages[k] || 0;
      const nv = Math.max(-6, Math.min(6, cur + n));
      if (nv === cur) { await pkmSay(b, `${who}'s ${PKM_STAT_LABEL[k]} won't go any ${n > 0 ? "higher" : "lower"}!`, 650); continue; }
      m.stages[k] = nv;
      await pkmSay(b, `${who}'s ${PKM_STAT_LABEL[k]} ${PKM_STAGE_TXT[Math.max(-3, Math.min(3, n))]}!`, 700);
      if (n < 0 && src && src !== m) {
        if (m.ability === "defiant") { m.stages.atk = Math.min(6, m.stages.atk + 2); await pkmSay(b, `${who}'s Defiant sharply raised its Attack!`, 700); }
        if (m.ability === "competitive") { m.stages.spa = Math.min(6, m.stages.spa + 2); await pkmSay(b, `${who}'s Competitive sharply raised its Sp. Atk!`, 700); }
      }
    }
  }
  const pkmSelfMove = (mv) => mv.cls === "status" && PKM_SELF_TARGETS.test(mv.target || "user");
  const pkmSide = (b, m) => (pkmMine(b, m) ? "me" : "foe");
  async function pkmUseStatus(b, att, def, mv) {
    const who = pkmWho(b, att);
    const mine = pkmMine(b, att);
    const fail = () => pkmSay(b, "But it failed!", 800);
    if (PKM_WEATHER_MV[mv.name]) return pkmWeatherId(b) === PKM_WEATHER_MV[mv.name] ? fail() : pkmSetWeather(b, PKM_WEATHER_MV[mv.name], att);
    if (PKM_TERRAIN_MV[mv.name]) return b.terrain && b.terrain.id === PKM_TERRAIN_MV[mv.name] ? fail() : pkmSetTerrain(b, PKM_TERRAIN_MV[mv.name], att);
    if (PKM_PROTECT.has(mv.name)) {
      const n = att.protectCount || 0;
      if (Math.random() < 1 / Math.pow(3, n)) { att.protectedNow = true; att.protectCount = n + 1; return pkmSay(b, `${who} protected itself!`, 800); }
      att.protectCount = 0;
      return fail();
    }
    if (PKM_HAZARD[mv.name]) {
      const key = PKM_HAZARD[mv.name];
      const h = b.hazards[mine ? "foe" : "me"];
      if ((h[key] || 0) >= (key === "spikes" ? 3 : key === "tspikes" ? 2 : 1)) return fail();
      h[key] = (h[key] || 0) + 1;
      return pkmSay(b, `${PKM_HAZARD_TXT[key]} ${mine ? "the foe's side" : "your side"}!`, 900);
    }
    if (PKM_SCREEN[mv.name]) {
      const k = PKM_SCREEN[mv.name];
      const sc = b.screens[pkmSide(b, att)];
      if (sc[k] > 0) return fail();
      sc[k] = 5;
      return pkmSay(b, `${k === "reflect" ? "Reflect raised" : "Light Screen raised"} ${mine ? "your" : "the foe's"} team's ${k === "reflect" ? "Defense" : "Sp. Def"}!`, 900);
    }
    if (mv.name === "substitute") {
      const cost = Math.floor(att.maxHP / 4);
      if (att.sub > 0 || att.hp <= cost) return fail();
      att.hp -= cost;
      att.sub = cost;
      if (mine) pkmSaveMonHP(att);
      pkmSyncGlobals(b);
      return pkmSay(b, `${who} put in a substitute!`, 800);
    }
    if (mv.name === "rest") {
      if (att.hp >= att.maxHP || att.status === "slp") return fail();
      att.hp = att.maxHP;
      att.status = "slp";
      att.sleep = 2;
      if (mine) pkmSaveMonHP(att);
      pkmSyncGlobals(b);
      return pkmSay(b, `${who} slept and became healthy!`, 900, { side: pkmSide(b, att), text: "Full" });
    }
    if (mv.name === "defog") { b.hazards = { me: {}, foe: {} }; await pkmSay(b, `${who} blew away the hazards!`, 800); }
    let did = false;
    const self = pkmSelfMove(mv);
    if (mv.healing > 0) {
      if (att.hp >= att.maxHP) return fail();
      await pkmHeal(b, att, (att.maxHP * mv.healing) / 100, `${who} regained health!`);
      did = true;
    }
    if (mv.stats.length) {
      const tgt = self ? att : def;
      if (tgt !== att && def.sub > 0) return fail();
      await pkmApplyStages(b, tgt, mv.stats, att);
      did = true;
    }
    const ail = PKM_AIL[mv.ailment];
    if ((ail || mv.ailment === "confusion") && !self) {
      if (def.sub > 0 || def.hp <= 0) return did ? undefined : fail();
      if (mv.name === "thunder-wave" && pkmMoveEff(att, def, mv) === 0) return pkmSay(b, `It doesn't affect ${pkmWho(b, def)}…`, 800);
      if (mv.ailment === "confusion") {
        if (def.confused > 0) return did ? undefined : fail();
        def.confused = pkmRand(2, 5);
        await pkmSay(b, `${pkmWho(b, def)} became confused!`, 750);
      } else {
        if (def.status || def.types.some((t) => PKM_AIL_IMMUNE[ail].includes(t)) || (PKM_AB_STATUS[def.ability] || []).includes(ail)) return did ? undefined : fail();
        await pkmSetStatus(b, def, ail, att);
      }
      did = true;
    }
    if (!did) await fail();
  }
  /** Spikes, Stealth Rock and Toxic Spikes when a Pokémon enters the field. */
  async function pkmHazards(b, m) {
    const h = b.hazards && b.hazards[pkmSide(b, m)];
    if (!h) return;
    const who = pkmWho(b, m);
    if (h.rock) await pkmHurt(b, m, (m.maxHP * pkmEff("rock", m.types)) / 8, `Pointed stones dug into ${who}!`);
    if (h.spikes && pkmGrounded(m) && m.hp > 0) await pkmHurt(b, m, m.maxHP / { 1: 8, 2: 6, 3: 4 }[h.spikes], `${who} was hurt by the spikes!`);
    if (h.tspikes && pkmGrounded(m) && m.hp > 0) {
      if (m.types.includes("poison")) { h.tspikes = 0; await pkmSay(b, `${who} absorbed the poison spikes!`, 800); }
      else await pkmSetStatus(b, m, "psn");
    }
  }
  function pkmHitCount(att, mv) {
    if (!mv.maxHits || mv.maxHits < 2 || mv.z) return 1;
    if (mv.minHits === mv.maxHits) return mv.maxHits;
    if (att.ability === "skill-link") return mv.maxHits;
    const r = Math.random();
    return Math.min(r < 0.35 ? 2 : r < 0.7 ? 3 : r < 0.85 ? 4 : 5, mv.maxHits);
  }
  /** Is a status move worth using right now? (the foe's choice) */
  function pkmAiStatusOk(foe, me, m, b) {
    const self = pkmSelfMove(m);
    if (PKM_WEATHER_MV[m.name]) return pkmWeatherId(b) !== PKM_WEATHER_MV[m.name];
    if (PKM_TERRAIN_MV[m.name]) return !b.terrain || b.terrain.id !== PKM_TERRAIN_MV[m.name];
    if (PKM_PROTECT.has(m.name) || m.name === "substitute" || m.name === "rest" || m.name === "defog") return false;
    if (PKM_HAZARD[m.name]) { const h = b.hazards[pkmMine(b, foe) ? "foe" : "me"]; return (h[PKM_HAZARD[m.name]] || 0) < 1; }
    if (PKM_SCREEN[m.name]) return !(b.screens[pkmSide(b, foe)][PKM_SCREEN[m.name]] > 0);
    if (m.healing > 0) return foe.hp < foe.maxHP * 0.5;
    if (m.stats.length) { const t = self ? foe : me; return foe.hp > foe.maxHP * 0.5 && m.stats.every(([k, n]) => (t.stages[k] || 0) + n <= 3 && (t.stages[k] || 0) + n >= -3 && !(n > 0 && !self)); }
    if (m.ailment === "confusion") return !me.confused;
    const ail = PKM_AIL[m.ailment];
    return !!ail && !me.status && !me.types.some((t) => PKM_AIL_IMMUNE[ail].includes(t));
  }
  function pkmAiMove(foe, me, b) {
    const diff = pkmDifficulty();
    const dmg = foe.moves.filter((m) => m.cls !== "status");
    const st = foe.moves.filter((m) => m.cls === "status" && pkmAiStatusOk(foe, me, m, b || {}));
    if (st.length && Math.random() < (diff === "easy" ? 0.15 : diff === "hard" ? 0.45 : 0.3)) return pkmPick(st);
    if (!dmg.length) return st.length ? pkmPick(st) : foe.moves[0];
    if (Math.random() < (diff === "easy" ? 0.5 : diff === "hard" ? 0.08 : 0.3)) return pkmPick(dmg);
    let best = dmg[0], bv = -1;
    for (const m of dmg) {
      const e = pkmMoveEff(foe, me, m);
      const v = (m.fixed ? 50 : m.power) * e * (foe.types.includes(m.type) ? 1.5 : 1) * ((m.acc || 100) / 100) * (m.maxHits > 1 ? 2.5 : 1);
      if (v > bv) { bv = v; best = m; }
    }
    return best;
  }

  async function pkmUseMove(b, att, def, mv) {
    if (!pkmAlive(b) || att.hp <= 0) return;
    const who = pkmWho(b, att);
    const mine = pkmMine(b, att);
    if (att.status === "slp") {
      if (att.sleep > 0) { att.sleep--; att.charging = null; att.invuln = false; return pkmSay(b, `${who} is fast asleep.`); }
      att.status = null;
      await pkmSay(b, `${who} woke up!`, 600);
    }
    if (att.status === "frz") {
      if (Math.random() < 0.2) { att.status = null; await pkmSay(b, `${who} thawed out!`, 600); }
      else return pkmSay(b, `${who} is frozen solid!`);
    }
    if (att.flinched) { att.flinched = false; att.charging = null; att.invuln = false; return pkmSay(b, `${who} flinched and couldn't move!`); }
    if (att.status === "par" && Math.random() < 0.25) return pkmSay(b, `${who} is paralyzed! It can't move!`);
    if (att.mustRecharge) { att.mustRecharge = false; att.moved = true; return pkmSay(b, `${who} must recharge!`); }
    if (att.confused > 0) {
      att.confused--;
      if (att.confused === 0) await pkmSay(b, `${who} snapped out of its confusion!`, 650);
      else {
        await pkmSay(b, `${who} is confused!`, 600);
        if (Math.random() < 1 / 3) {
          const hit = Math.max(1, Math.floor(Math.floor((Math.floor((2 * att.level) / 5 + 2) * 40 * att.stats.atk) / Math.max(1, att.stats.def)) / 50) + 2);
          att.hp = Math.max(0, att.hp - hit);
          if (mine) pkmSaveMonHP(att);
          pkmSyncGlobals(b);
          att.charging = null; att.invuln = false;
          return pkmSay(b, "It hurt itself in its confusion!", 800, { side: pkmSide(b, att), text: `-${hit}` });
        }
      }
    }
    att.moved = true;
    const second = !!att.charging;
    const ppMove = mv.srcMove || mv;
    if (mine && !second && !mv.noPP) ppMove.pp = Math.max(0, ppMove.pp - 1);
    if (mv.cls !== "status" && (att.ability === "protean" || att.ability === "libero") && (att.types.length !== 1 || att.types[0] !== mv.type)) att.types = [mv.type];
    if (!mv.quiet) await pkmSay(b, mv.z ? `${who} unleashed its full Z-Power! ${mv.display}!` : `${who} used ${mv.display}!`, mv.z || mv.max ? 1100 : 650);
    if (!pkmAlive(b)) return;
    // Two-turn moves charge first
    if (mv.twoTurn && !second && !(mv.twoTurn.skipSun && pkmWeatherId(b) === "sun")) {
      att.charging = mv;
      att.invuln = !!mv.twoTurn.invuln;
      return pkmSay(b, `${who} ${mv.twoTurn.msg}`, 800);
    }
    att.charging = null;
    att.invuln = false;
    const ig = PKM_MOLD.includes(att.ability);
    const w = pkmWeatherId(b);
    const self = pkmSelfMove(mv);
    if (!self) {
      if (def.protectedNow && !(att.ability === "unseen-fist")) return pkmSay(b, `${pkmWho(b, def)} protected itself!`, 800);
      if (def.invuln && att.ability !== "no-guard") return pkmSay(b, `${pkmWho(b, def)} avoided the attack!`, 800);
    }
    let acc = mv.acc;
    if (acc && att.ability === "compound-eyes") acc *= 1.3;
    if (acc && att.ability === "hustle" && mv.cls === "physical") acc *= 0.8;
    if (acc && w && (PKM_ALWAYS_HIT[w] || []).includes(mv.name)) acc = null;
    if (acc && !ig && ((def.ability === "sand-veil" && w === "sand") || (def.ability === "snow-cloak" && w === "hail"))) acc *= 0.8;
    if (acc && (att.ability === "no-guard" || def.ability === "no-guard")) acc = null;
    if (acc && !self) acc *= pkmAccStage((att.stages.acc || 0) - (def.stages.eva || 0));
    if (acc && !self && Math.random() * 100 >= acc) return pkmSay(b, `${who}'s attack missed!`);
    if (mv.cls === "status") return pkmUseStatus(b, att, def, mv);
    // Absorb abilities (heal, or raise a stat)
    const absorb = !ig && PKM_ABSORB[def.ability];
    if (absorb && absorb[0] === mv.type) {
      if (absorb[1] === "heal") {
        const h = Math.min(def.maxHP - def.hp, Math.floor(def.maxHP / 4));
        def.hp += h;
        if (pkmMine(b, def)) pkmSaveMonHP(def);
        pkmSyncGlobals(b);
        return pkmSay(b, `${pkmWho(b, def)}'s ${pkmCap(def.ability)} absorbed the attack${h ? ` and restored ${h} HP` : ""}!`, 900);
      }
      def.stages[absorb[1]] = Math.min(6, def.stages[absorb[1]] + 1);
      return pkmSay(b, `${pkmWho(b, def)}'s ${pkmCap(def.ability)} raised its ${PKM_STAT_LABEL[absorb[1]]}!`, 900);
    }
    if (!ig && def.ability === "flash-fire" && mv.type === "fire") {
      def.flashFire = true;
      return pkmSay(b, `${pkmWho(b, def)}'s Flash Fire powered up its Fire moves!`, 900);
    }
    // One or more hits
    const hits = pkmHitCount(att, mv);
    let total = 0, hitsDone = 0, r = null, anyCrit = false;
    for (let i = 0; i < hits; i++) {
      const rr = pkmDamage(att, def, mv, b);
      if (!r) r = rr;
      anyCrit = anyCrit || rr.crit;
      total += rr.dmg;
      hitsDone++;
      if (rr.eff === 0 || total >= def.hp + (def.sub || 0)) break;
    }
    let dmg = total;
    let subHit = false;
    let subTxt = "";
    if (def.sub > 0 && dmg > 0) {
      subHit = true;
      def.sub = Math.max(0, def.sub - dmg);
      subTxt = def.sub > 0 ? `${pkmWho(b, def)}'s substitute took the damage!` : `${pkmWho(b, def)}'s substitute faded!`;
      dmg = 0;
    }
    let endured = "";
    if (dmg >= def.hp && def.hp === def.maxHP) {
      if (def.ability === "sturdy" && !ig) { dmg = def.hp - 1; endured = `${pkmWho(b, def)} endured the hit with Sturdy!`; }
      else if (def.held === "focus-sash") { dmg = def.hp - 1; def.held = null; def.consumed = true; endured = `${pkmWho(b, def)} hung on using its Focus Sash!`; }
    }
    def.hp = Math.max(0, def.hp - dmg);
    pkmSyncGlobals(b);
    if (pkmMine(b, def)) { pkmSaveMonHP(def); animatePartnerHit(); } else animateHit();
    playSound("hit");
    if (mine) { b.lastType = mv.type; if (r.eff > 1) pkmQuest("super"); }
    let txt = r.eff === 0 ? `It doesn't affect ${pkmWho(b, def)}…` : (anyCrit ? "A critical hit! " : "") + (r.eff > 1 ? "It's super effective!" : r.eff < 1 ? "It's not very effective…" : "");
    if (hitsDone > 1) txt += ` Hit ${hitsDone} times!`;
    if (subTxt) txt = subTxt;
    const shown = subHit ? total : dmg;
    await pkmSay(b, txt || `${pkmWho(b, def)} took ${dmg} damage.`, 850, shown ? { side: pkmSide(b, def), text: `-${shown}` } : null);
    if (endured) await pkmSay(b, endured, 800);
    if (mv.drain && dmg && att.hp > 0 && !(mv.drain < 0 && (att.ability === "rock-head" || att.ability === "magic-guard"))) {
      const amt = Math.max(1, Math.floor((dmg * Math.abs(mv.drain)) / 100));
      att.hp = mv.drain > 0 ? Math.min(att.maxHP, att.hp + amt) : Math.max(0, att.hp - amt);
      if (mine) pkmSaveMonHP(att);
      pkmSyncGlobals(b);
      await pkmSay(b, mv.drain > 0 ? `${pkmWho(b, def)} had its energy drained!` : `${who} is damaged by recoil!`, 650);
    }
    if (dmg > 0 && att.hp > 0) {
      if (att.held === "life-orb") await pkmHurt(b, att, att.maxHP / 10, `${who} lost some of its HP to its Life Orb!`);
      if (att.hp > 0 && att.held === "shell-bell") await pkmHeal(b, att, dmg / 8, `${who} restored HP with its Shell Bell!`);
    }
    // Held items and abilities that react to being hit
    if (dmg > 0 && def.hp > 0) {
      if (def.held === "air-balloon") { def.held = null; def.consumed = true; await pkmSay(b, `${pkmWho(b, def)}'s Air Balloon popped!`, 750); }
      if (def.held === "weakness-policy" && r.eff > 1) {
        def.held = null; def.consumed = true;
        def.stages.atk = Math.min(6, def.stages.atk + 2);
        def.stages.spa = Math.min(6, def.stages.spa + 2);
        await pkmSay(b, `${pkmWho(b, def)}'s Weakness Policy sharply raised its Attack and Sp. Atk!`, 850);
      }
    }
    // Contact effects
    if (mv.cls === "physical" && dmg && att.hp > 0) {
      const ca = { static: "par", "flame-body": "brn", "poison-point": "psn" }[def.ability];
      if (ca && Math.random() < 0.3) await pkmSetStatus(b, att, ca, def);
      if (def.ability === "effect-spore" && Math.random() < 0.3) await pkmSetStatus(b, att, pkmPick(["psn", "par", "slp"]), def);
      if (def.ability === "rough-skin") await pkmHurt(b, att, att.maxHP / 8, `${who} was hurt by ${pkmWho(b, def)}'s Rough Skin!`);
      if (def.ability === "iron-barbs") await pkmHurt(b, att, att.maxHP / 8, `${who} was hurt by ${pkmWho(b, def)}'s Iron Barbs!`);
      if (def.held === "rocky-helmet") await pkmHurt(b, att, att.maxHP / 6, `${who} was hurt by ${pkmWho(b, def)}'s Rocky Helmet!`);
    }
    // Secondary effects (blocked by a Substitute, removed by Sheer Force)
    const selfDebuff = PKM_SELF_DEBUFF.has(mv.name);
    const sf = att.ability === "sheer-force" && (mv.ailmentChance > 0 || mv.flinch > 0 || (mv.stats.length && !selfDebuff));
    const grace = att.ability === "serene-grace" ? 2 : 1;
    if (!subHit && !sf && def.hp > 0) {
      const ail = PKM_AIL[mv.ailment];
      if (ail && Math.random() * 100 < (mv.ailmentChance || 0) * grace) await pkmSetStatus(b, def, ail, att);
      else if (mv.ailment === "confusion" && !def.confused && Math.random() * 100 < (mv.ailmentChance || 0) * grace) { def.confused = pkmRand(2, 5); await pkmSay(b, `${pkmWho(b, def)} became confused!`, 700); }
      if (mv.flinch > 0 && !def.moved && def.hp > 0 && def.ability !== "inner-focus" && Math.random() * 100 < mv.flinch * grace) def.flinched = true;
    }
    if (mv.stats.length && (selfDebuff || !sf)) {
      const chance = selfDebuff ? 100 : (mv.statChance || 100) * grace;
      if (Math.random() * 100 < chance) {
        const toSelf = mv.stats.filter(([, n]) => n > 0 || selfDebuff);
        const toFoe = mv.stats.filter(([, n]) => n < 0 && !selfDebuff);
        if (toSelf.length && att.hp > 0) await pkmApplyStages(b, att, toSelf, att);
        if (!subHit && toFoe.length && def.hp > 0) await pkmApplyStages(b, def, toFoe, att);
      }
    }
    if (def.hp <= 0 && att.hp > 0 && att.ability === "moxie" && att.stages.atk < 6) {
      att.stages.atk++;
      await pkmSay(b, `${who}'s Moxie raised its Attack!`, 700);
    }
    if (mv.max) await pkmMaxEffect(b, att, def, mv);
    if (mv.name === "rapid-spin") b.hazards[pkmSide(b, att)] = {};
    if (mv.recharge && def.hp > 0 && dmg > 0) att.mustRecharge = true;
    if (mv.selfKO && att.hp > 0) { att.hp = 0; if (mine) pkmSaveMonHP(att); pkmSyncGlobals(b); }
    await pkmBerry(b, def);
  }

  async function pkmEndOfTurn(b) {
    const w = pkmWeatherId(b);
    for (const m of pkmActive(b)) {
      if (!pkmAlive(b) || m.hp <= 0) continue;
      const who = pkmWho(b, m);
      if (m.status === "psn" && m.ability === "poison-heal") await pkmHeal(b, m, m.maxHP / 8, `${who} is healed by its poison!`);
      else if (m.status === "psn" || m.status === "brn") await pkmHurt(b, m, m.maxHP / (m.status === "psn" ? 8 : 16), `${who} is hurt by its ${m.status === "psn" ? "poison" : "burn"}!`);
      if (w === "sand" && !["overcoat", "sand-veil", "sand-rush"].includes(m.ability) && !m.types.some((t) => ["rock", "ground", "steel"].includes(t)))
        await pkmHurt(b, m, m.maxHP / 16, `${who} is buffeted by the sandstorm!`);
      if (w === "hail" && !["overcoat", "snow-cloak", "ice-body", "slush-rush"].includes(m.ability) && !m.types.includes("ice"))
        await pkmHurt(b, m, m.maxHP / 16, `${who} is pelted by hail!`);
      if (m.hp > 0) {
        if (w === "rain" && m.ability === "rain-dish") await pkmHeal(b, m, m.maxHP / 16, `${who} restored HP with Rain Dish!`);
        if (w === "hail" && m.ability === "ice-body") await pkmHeal(b, m, m.maxHP / 16, `${who} restored HP with Ice Body!`);
        if (m.ability === "dry-skin" && w === "rain") await pkmHeal(b, m, m.maxHP / 8, `${who} restored HP with Dry Skin!`);
        if (m.ability === "dry-skin" && w === "sun") await pkmHurt(b, m, m.maxHP / 8, `${who} was hurt by the sunlight!`);
        if (m.ability === "solar-power" && w === "sun") await pkmHurt(b, m, m.maxHP / 8, `${who} was hurt by Solar Power!`);
        if (b.terrain && b.terrain.id === "grassy" && pkmGrounded(m)) await pkmHeal(b, m, m.maxHP / 16, `${who} was healed by the grass!`);
      }
      if (m.hp > 0 && m.held === "leftovers") await pkmHeal(b, m, m.maxHP / 16, `${who} restored a little HP using its Leftovers!`);
      if (m.hp > 0 && m.ability === "speed-boost" && m.stages.spe < 6) { m.stages.spe++; await pkmSay(b, `${who}'s Speed Boost raised its Speed!`, 650); }
      if (m.hp > 0 && m.ability === "shed-skin" && m.status && Math.random() < 0.3) { m.status = null; await pkmSay(b, `${who} shed its skin and cured its status!`, 650); }
      await pkmBerry(b, m);
    }
    if (!pkmAlive(b)) return;
    for (const m of pkmActive(b)) {
      if (m.dynamax > 0 && --m.dynamax === 0) {
        const who = pkmWho(b, m);
        pkmEndDynamax(m);
        if (pkmMine(b, m)) pkmSaveMonHP(m);
        pkmSyncGlobals(b);
        await pkmSay(b, `${who} returned to its normal size.`, 900);
      }
    }
    for (const side of ["me", "foe"]) {
      for (const k of ["reflect", "light"]) {
        const sc = b.screens[side];
        if (sc[k] > 0 && --sc[k] === 0) await pkmSay(b, `${side === "me" ? "Your" : "The foe's"} ${k === "reflect" ? "Reflect" : "Light Screen"} wore off!`, 700);
      }
    }
    for (const key of ["weather", "terrain"]) {
      const f = b[key];
      if (!f || !Number.isFinite(f.turns)) continue;
      if (--f.turns <= 0) {
        const txt = (key === "weather" ? PKM_WEATHER : PKM_TERRAIN)[f.id].off;
        b[key] = null;
        await pkmSay(b, txt, 700);
      }
    }
  }

  async function pkmGiveXP(b, mon, xp, quiet) {
    const id = mon.instanceId;
    let leveled = 0;
    let newLevel = mon.level;
    if (id === GM_getValue("pkm_starter_id")) {
      const r = addXP(mon.name, xp);
      leveled = r.leveled;
      newLevel = r.newLevel;
      if (leveled) pkmFriend(id, 3);
    } else {
      const all = getObj(STORAGE.stats) || {};
      const s = all[id] || {};
      s.level = Math.min(MAX_LEVEL, Math.max(1, s.level || 1));
      s.xp = Math.max(0, s.xp || 0);
      let g = xp;
      while (g > 0 && s.level < MAX_LEVEL) {
        const space = Math.max(0, xpThreshold(s.level) - s.xp);
        if (g < space) { s.xp += g; g = 0; break; }
        g -= space; s.level++; leveled++; s.xp = 0;
      }
      if (s.level >= MAX_LEVEL) s.xp = Math.min(xpThreshold(s.level), s.xp + g);
      if (leveled) s.friendship = Math.min(255, (s.friendship == null ? 70 : s.friendship) + 3);
      all[id] = s;
      setObj(STORAGE.stats, all);
      newLevel = s.level;
      if (leveled) { await pkmSyncStats(id, mon.name); playSound("level"); if (quiet) pkmToast(`🎉 ${pkmCap(mon.name)} grew to Lv ${newLevel}!`); }
    }
    pkmTrack("xp", xp);
    if (leveled && mon.stats && mon.base) {
      mon.level = newLevel;
      mon.stats = pkmCalcStats(mon.base, newLevel, mon.iv, mon.nature, mon.ev);
      const gain = mon.stats.hp - mon.maxHP;
      mon.maxHP = mon.stats.hp;
      mon.hp = Math.min(mon.maxHP, mon.hp + Math.max(0, gain));
    }
    if (!quiet) await pkmSay(b, `${pkmCap(mon.name)} gained ${xp} XP!${leveled ? ` It grew to Lv ${newLevel}!` : ""}`, leveled ? 1300 : 900);
    return leveled;
  }

  /** Returns true when the turn must stop (someone fainted). */
  async function pkmCheckFaint(b) {
    if (!pkmAlive(b)) return true;
    if (b.foe.hp <= 0) {
      await pkmSay(b, `${pkmWho(b, b.foe)} fainted!`, 750);
      const base = pkmXpFor(b.foe, b.me, b.kind === "trainer");
      const noXp = !!(b.trainer && (b.trainer.pvp || b.trainer.noXp));
      if (!noXp) { await pkmGiveXP(b, b.me, Math.max(1, Math.floor(base * (b.me.held === "lucky-egg" ? 1.5 : 1)))); pkmGainEV(b.me, b.foe); }
      const party = getObj(STORAGE.party) || {};
      for (const r of noXp ? [] : b.roster) {
        if (r.mon === b.me || (party[r.id] || {}).held !== "exp-share" || pkmRosterHP(r).hp <= 0) continue;
        await pkmGiveXP(b, r.mon || { instanceId: r.id, name: r.name, level: pkmRosterHP(r).lv }, Math.max(1, Math.floor(base / 2)), true);
      }
      if (b.kind === "trainer" && b.foeIdx < b.team.length - 1) {
        b.foeIdx++;
        b.foe = b.team[b.foeIdx];
        b.shown.foe = null;
        pkmSyncGlobals(b);
        await pkmSay(b, `${b.trainer.name} sent out ${b.foe.display}!`, 900);
        await pkmOnEntry(b, b.foe, b.me);
        if (b.foe.hp <= 0) return pkmCheckFaint(b);
        return true;
      }
      await pkmWin(b);
      return true;
    }
    if (b.me.hp <= 0) {
      pkmSaveMonHP(b.me);
      pkmFriend(b.me.instanceId, -3);
      playSound("faint");
      if (b.me.instanceId === GM_getValue("pkm_starter_id")) pkmReact("sad");
      await pkmSay(b, `${b.me.display} fainted!`, 900);
      const others = b.roster.filter((r) => r.mon !== b.me && pkmRosterHP(r).hp > 0);
      if (others.length) {
        b.awaitSwitch = true;
        b.busy = false;
        drawBattle(`Choose your next Pokémon!`);
        return true;
      }
      if (getInt("pkm_revive") > 0) {
        b.awaitRevive = true;
        b.busy = false;
        drawBattle(`${b.me.display} fainted! Use a Revive to keep fighting?`);
        return true;
      }
      await pkmLose(b);
      return true;
    }
    return false;
  }

  async function pkmTurn(myAction) {
    const b = pkb;
    if (!pkmAlive(b) || b.busy || b.awaitRevive || b.awaitSwitch) return;
    b.busy = true;
    for (const m of [b.me, b.foe]) { m.moved = false; m.flinched = false; if (!m.protectedNow) m.protectCount = 0; m.protectedNow = false; }
    // Mega Evolution happens before the move; a Z-Move replaces it. Either one uses up the battle's single special action.
    let mineMv = myAction.type === "move" ? b.me.moves[myAction.idx] : null;
    if (mineMv && b.me.charging) mineMv = b.me.charging; // a charged move goes off whatever you pick
    else if (mineMv && b.me.encore && b.me.encore.turns > 0) mineMv = b.me.moves.find((x) => x.name === b.me.encore.name) || mineMv;
    if (mineMv && b.arm === "mega" && !b.specialUsed) { b.arm = null; drawBattle(); await pkmMegaEvolve(b); if (!pkmAlive(b)) return; }
    else if (mineMv && b.arm === "z" && !b.specialUsed && mineMv.cls !== "status" && !mineMv.srcMove) { b.specialUsed = true; mineMv = pkmZMove(mineMv); pkmTrack("zmoves"); }
    else if (mineMv && b.arm === "tera" && !b.specialUsed) { b.arm = null; drawBattle(); await pkmTerastallize(b); if (!pkmAlive(b)) return; }
    else if (mineMv && b.arm === "dyna" && !b.specialUsed) { b.arm = null; drawBattle(); await pkmDynamax(b); if (!pkmAlive(b)) return; }
    b.arm = null;
    if (mineMv && b.me.dynamax > 0 && !mineMv.max) mineMv = pkmMaxMove(mineMv, b.me);
    drawBattle();
    const foeMove = b.foe.charging || (b.foe.encore && b.foe.encore.turns > 0 && b.foe.moves.find((x) => x.name === b.foe.encore.name)) || pkmAiMove(b.foe, b.me, b);
    let meFirst = true;
    if (mineMv) {
      const qc = (m) => m.held === "quick-claw" && Math.random() < 0.2;
      const mq = qc(b.me), fq = qc(b.foe);
      meFirst = mineMv.prio !== foeMove.prio ? mineMv.prio > foeMove.prio : mq !== fq ? mq : pkmSpeed(b.me, b) !== pkmSpeed(b.foe, b) ? pkmSpeed(b.me, b) > pkmSpeed(b.foe, b) : Math.random() < 0.5;
    }
    const done = () => { if (pkmAlive(b) && !b.awaitRevive && !b.awaitSwitch) { b.busy = false; drawBattle(`What will ${b.me.display} do?`); } };
    for (const who of meFirst ? ["me", "foe"] : ["foe", "me"]) {
      if (!pkmAlive(b)) return;
      if (who === "me") {
        if (mineMv) await pkmUseMove(b, b.me, b.foe, mineMv);
        else await myAction.run(b);
      } else await pkmUseMove(b, b.foe, b.me, foeMove);
      if (!pkmAlive(b)) return;
      if (await pkmCheckFaint(b)) return done();
    }
    await pkmEndOfTurn(b);
    if (b.foe.raid && pkmAlive(b)) await pkmRaidRound(b);
    if (await pkmCheckFaint(b)) return done();
    done();
  }

  function pkmBattleAct(a) {
    const b = pkb;
    if (!b) return;
    if (a === "run") return runAway();
    if (a === "cancel") return drawBattle();
    if (a === "giveup") { b.awaitRevive = false; return pkmLose(b); }
    if (a === "revive") {
      if (getInt("pkm_revive") <= 0) return;
      setInt("pkm_revive", getInt("pkm_revive") - 1);
      b.me.hp = Math.floor(b.me.maxHP / 2);
      b.me.status = null;
      b.awaitRevive = false;
      b.awaitSwitch = false;
      b.shown.me = 0;
      pkmSaveMonHP(b.me);
      pkmSyncGlobals(b);
      pkmReact("heart");
      playSound("heal");
      return drawBattle(`${b.me.display} was revived with ${b.me.hp} HP!`);
    }
    if (a === "ball") return throwBall();
    if (a === "switch") {
      if (!pkmAlive(b) || b.busy) return;
      const ctl = battlePanel.querySelector(".pk-controls");
      ctl.classList.add("pkb-switching");
      ctl.innerHTML = pkmSwitchButtons(b, false);
      pkmBattleKeys(ctl);
      return;
    }
    if (a === "items") {
      if (!pkmAlive(b) || b.busy) return;
      battlePanel.querySelector(".pk-ballpick")?.remove();
      const row = document.createElement("div");
      row.className = "pk-ballpick";
      row.setAttribute("role", "group");
      row.setAttribute("aria-label", "Choose an item");
      const p = getInt(STORAGE.potions), x = getInt("pkm_xattack");
      row.innerHTML = `<button type="button" class="pk-ball-opt" data-item="potion" ${p <= 0 || b.me.hp >= b.me.maxHP ? "disabled" : ""}><img src="${PKM_ITEM_IMG}potion.png" alt=""><span>Potion</span><b>×${p}</b></button>
        <button type="button" class="pk-ball-opt" data-item="xatk" ${x <= 0 || b.me.stages.atk >= 6 ? "disabled" : ""}><img src="${PKM_ITEM_IMG}x-attack.png" alt=""><span>X Attack</span><b>×${x}</b></button>
        <button type="button" class="pk-ball-opt cancel" data-item="cancel" aria-label="Cancel">✕</button>`;
      battlePanel.querySelector(".pk-controls").before(row);
      row.querySelector("button:not([disabled])")?.focus();
      return;
    }
    if (a === "potion") {
      return pkmTurn({ type: "item", run: async (bb) => {
        if (getInt(STORAGE.potions) <= 0) return;
        setInt(STORAGE.potions, getInt(STORAGE.potions) - 1);
        pkmQuest("potion");
        const heal = Math.min(bb.me.maxHP - bb.me.hp, Math.max(20, Math.round(bb.me.maxHP * 0.35)));
        bb.me.hp += heal;
        pkmSaveMonHP(bb.me);
        pkmSyncGlobals(bb);
        pkmReact("heart");
        playSound("heal");
        await pkmSay(bb, `You used a Potion. ${bb.me.display} recovered ${heal} HP!`, 900, { side: "me", text: `+${heal}` });
      } });
    }
    if (a === "xatk") {
      return pkmTurn({ type: "item", run: async (bb) => {
        if (getInt("pkm_xattack") <= 0) return;
        setInt("pkm_xattack", getInt("pkm_xattack") - 1);
        bb.me.stages.atk = Math.min(6, bb.me.stages.atk + 1);
        await pkmSay(bb, `You used an X Attack. ${bb.me.display}'s Attack rose!`, 900);
      } });
    }
  }

  async function pkmThrow(b, ball) {
    const info = { poke: [STORAGE.balls, "Poké Ball"], great: [STORAGE.greatBalls, "Great Ball"], ultra: [STORAGE.ultraBalls, "Ultra Ball"], master: [STORAGE.masterBalls, "Master Ball"] }[ball];
    if (!info || getInt(info[0]) <= 0) return pkmSay(b, "You don't have any of those balls!");
    setInt(info[0], getInt(info[0]) - 1);
    playSound("ball");
    const p = pkmCatchChance(b, ball);
    await pkmSay(b, `You threw a ${info[1]}!`, 700);
    const shake = Math.pow(p, 1 / 3);
    for (let i = 0; i < 3; i++) {
      if (!pkmAlive(b)) return;
      if (Math.random() >= shake) return pkmSay(b, ["Oh no! The Pokémon broke free!", "Aww! It appeared to be caught!", "Aargh! Almost had it!"][i], 900);
      await pkmSay(b, ["The ball wobbles…", "The ball wobbles… wobbles…", "The ball wobbles… wobbles… wobbles…"][i], 550);
    }
    await pkmCaught(b);
  }

  /** Save a caught Pokémon (battle or Safari) to the Bag, Pokédex, stats, quests and achievements. */
  function pkmStoreCaught(f, source) {
    const id = generateUniqueId(f.name);
    const party = getObj(STORAGE.party) || {};
    party[id] = { name: f.name, caughtAt: Date.now(), isShiny: !!f.shiny, spriteUrl: f.front };
    if (f.costume) party[id].costume = f.costume;
    setObj(STORAGE.party, party);
    const all = getObj(STORAGE.stats) || {};
    all[id] = { level: f.level, xp: 0, iv: f.iv, nature: f.nature, ability: f.ability, friendship: 70, hp: f.maxHP, currentHP: Math.max(1, f.hp),
      atk: f.stats.atk, def: f.stats.def, spAtk: f.stats.spa, spDef: f.stats.spd, speed: f.stats.spe, types: f.types, dexId: f.dexId,
      moves: (f.moves || []).map((m) => m.name), movesLv: f.level, _v: 2 };
    setObj(STORAGE.stats, all);
    recordPokedex({ id: f.dexId, name: pkmCap(f.name), spriteUrl: f.front, types: f.types, abilities: [f.ability], stats: [] });
    pkmTrack("caught");
    pkmTrackTypes(f.types);
    if (f.shiny) pkmTrack("shinies");
    if (source === "safari") { pkmTrack("safariCaught"); pkmQuest("safari"); }
    pkmQuest("catch");
    pkmQuest("catchType", 1, { types: f.types });
    return id;
  }
  async function pkmCaught(b) {
    b.over = true;
    SOUNDS.battleSound.pause();
    SOUNDS.battleSound.currentTime = 0;
    playSound("catch");
    b.result = "Caught";
    pkmStoreCaught(b.foe, "battle");
    if (b.foe.legend) pkmLegendCaught(b.foe.legend);
    pkmChainAdd();
    pkmReact("happy");
    await pkmSay(b, `Gotcha! ${b.foe.display} was caught!${b.foe.shiny ? " ✨ It's shiny!" : ""} It was sent to your Bag.`, 1600);
    closeBattle();
  }

  async function pkmWin(b) {
    b.over = true;
    SOUNDS.battleSound.pause();
    SOUNDS.battleSound.currentTime = 0;
    playSound("victory");
    b.result = "Won";
    pkmReact("happy");
    const party = getObj(STORAGE.party) || {};
    const amulet = b.roster.some((r) => (party[r.id] || {}).held === "amulet-coin");
    let coins;
    let extra = "";
    if (b.kind === "wild") {
      const mult = { uncommon: 1.3, rare: 1.6, sublegendary: 2.5, legendary: 3, mythical: 3 }[b.foe.rarity] || 1;
      coins = Math.floor((8 + b.foe.level * 3) * mult * ((pkmCurrentEvent() || {}).id === "spring" ? 1.5 : 1));
      pkmChainAdd();
      if (b.foe.raid) extra += await pkmRaidWin(b);
    } else {
      const tr = b.trainer;
      const top = Math.max(...b.team.map((m) => m.level));
      const mult = tr.coinMult || 1;
      coins = tr.pvp || tr.facility ? 0 : tr.tower ? pkmTowerCoins(tr) : tr.rival ? Math.floor(70 * top * (tr.rematch ? 0.5 : 1))
        : tr.league != null ? Math.floor(150 * top * mult) : tr.gym ? Math.floor(120 * top * mult * (tr.rematch ? 0.5 : 1)) : 30 * top;
      extra = ` ${tr.name}: “${tr.lose}”`;
      if (!tr.pvp) { pkmTrack("trainerWins"); pkmQuest("trainer"); }
      if (tr.gym) extra += pkmAwardBadge(tr.gym);
      if (tr.league != null) extra += pkmLeagueWin(b);
      if (tr.tower) extra += pkmTowerWin(b);
      if (tr.facility) extra += pkmFacilityWin(b);
      if (tr.rival) extra += pkmRivalWin(b);
    }
    if (amulet) coins *= 2;
    const pvp = !!(b.trainer && b.trainer.pvp);
    for (const r of b.roster) if (r.mon && r.mon.hp > 0) pkmFriend(r.id, 2);
    setInt(STORAGE.coins, getInt(STORAGE.coins) + coins);
    if (!pvp) {
      pkmTrack("coins", coins);
      pkmTrack("wins");
      pkmQuest("win");
      pkmQuest("winType", 1, { type: b.lastType });
    }
    await pkmSay(b, pvp ? `You won the friend battle! ${b.trainer.name}: “${b.trainer.lose}” (Friend battles give no coins or XP.)` : `You won! +${coins} coins${amulet ? " (Amulet Coin ×2)" : ""}.${extra}`, b.kind === "trainer" ? 2600 : 1500);
    closeBattle();
  }

  async function pkmLose(b, forfeit) {
    if (!b) return;
    b.over = true;
    SOUNDS.battleSound.pause();
    SOUNDS.battleSound.currentTime = 0;
    playSound("lose");
    b.result = "Lost";
    if (b.kind === "wild") pkmChainReset();
    let msg = forfeit ? "You forfeited the battle." : "You have no Pokémon left that can fight…";
    if (b.kind === "trainer") {
      const lost = b.trainer.pvp || b.trainer.tower || b.trainer.facility ? 0 : Math.min(500, Math.floor(getInt(STORAGE.coins) * 0.05));
      if (lost > 0) { setInt(STORAGE.coins, getInt(STORAGE.coins) - lost); msg += ` You paid ${lost} coins to ${b.trainer.name}.`; }
      if (b.trainer.league != null) { pkmSave("pkm_league", { stage: 0, active: false, region: b.trainer.region }); msg += " Your League run is over."; }
      if (b.trainer.tower) msg += pkmTowerLose(b);
      if (b.trainer.facility) msg += pkmFacilityLose(b);
      if (b.trainer.rival) pkmRivalLose(b);
    }
    if (b.raidTimeout) msg = "Time's up! The raid boss got away…";
    else if (b.foe && b.foe.raid) msg = "Your team was overwhelmed by the raid boss…";
    msg += (b.trainer && (b.trainer.tower || b.trainer.facility)) || (b.foe && b.foe.raid) ? "" : " Heal up at the Pokémon Center.";
    await pkmSay(b, msg, 2200);
    closeBattle();
  }

  // Hook the engine into the existing battle panel
  startBattle = pkmStartBattle;
  drawBattle = pkmDrawBattle;
  throwBall = function (ball) {
    const b = pkb;
    if (typeof ball !== "string") return pkmBallPicker();
    if (!pkmAlive(b) || b.busy) return;
    if (b.kind === "trainer") return drawBattle("The trainer blocked the ball! Don't be a thief!");
    pkmTurn({ type: "item", run: async (bb) => { await pkmThrow(bb, ball); } });
  };
  let pkmForfeitAsk = 0;
  runAway = function () {
    const b = pkb;
    if (!battlePanel) return;
    if (b && b.kind === "trainer" && !b.over) {
      pkmBattleLeaving = false;
      if (Date.now() - pkmForfeitAsk < 4000) { pkmForfeitAsk = 0; return pkmLose(b, true); }
      pkmForfeitAsk = Date.now();
      pkmToast("There's no running from a trainer battle! Press Forfeit (or Esc) again to give up.", 3500);
      return;
    }
    if (b && b.me) pkmChainReset();
    if (b) { b.over = true; b.result = "Fled"; }
    SOUNDS.battleSound.pause();
    SOUNDS.battleSound.currentTime = 0;
    playSound("run");
    drawBattle("Got away safely!");
    setTimeout(closeBattle, 700);
  };
  {
    const cb = closeBattle;
    closeBattle = function (...a) {
      const b = pkb;
      // Used-up berries / sashes leave the Pokémon's hands for good
      if (b && b.roster) {
        const party = getObj(STORAGE.party) || {};
        let ch = false;
        for (const r of b.roster) if (r.mon && r.mon.consumed && party[r.id]) { party[r.id].held = r.mon.held || null; ch = true; }
        if (ch) setObj(STORAGE.party, party);
      }
      pkb = null;
      pkmBattleLeaving = false;
      const after = pkmPostBattle;
      pkmPostBattle = null;
      const res = cb.apply(this, a);
      if (after) setTimeout(() => { try { after(); } catch (e) { console.warn(e); } }, 300);
      return res;
    };
  }
  let pkmPostBattle = null; // runs once after the battle panel closes (Tower panel, Rival panel...)
  function pkmStartTrainer(t) {
    if (battlePanel) return;
    pkmNextTrainer = t;
    openBattle();
    if (!battlePanel) pkmNextTrainer = null;
  }
  // ---------- Trainers & Gyms ----------
  const PKM_TRAINER_CLASSES = [
    { title: "Youngster", sprite: "youngster", names: ["Joey", "Ben", "Calvin", "Mikey", "Tommy"], pool: ["rattata", "pidgey", "spearow", "sentret", "zigzagoon", "bidoof", "lillipup", "patrat"], lose: "My Rattata is in the top percentage… I swear!" },
    { title: "Bug Catcher", sprite: "bugcatcher", names: ["Rick", "Doug", "Wade", "Don"], pool: ["caterpie", "weedle", "metapod", "kakuna", "venonat", "wurmple", "nincada", "sewaddle"], lose: "My bugs need more training…" },
    { title: "Lass", sprite: "lass", names: ["Iris", "Dana", "Haley", "Crissy"], pool: ["clefairy", "jigglypuff", "marill", "snubbull", "skitty", "azurill", "pachirisu"], lose: "That was fun anyway!" },
    { title: "Swimmer", sprite: "swimmer", names: ["Luis", "Kirk", "Alice", "Wendy"], pool: ["tentacool", "horsea", "goldeen", "shellder", "krabby", "wingull", "buizel", "staryu"], lose: "I'm all washed up!" },
    { title: "Hiker", sprite: "hiker", names: ["Anthony", "Russell", "Daniel", "Eric"], pool: ["geodude", "onix", "sandshrew", "diglett", "machop", "nosepass", "roggenrola", "phanpy"], lose: "Rocks can't win every time." },
    { title: "Black Belt", sprite: "blackbelt", names: ["Kenji", "Koichi", "Nob", "Lao"], pool: ["mankey", "machop", "makuhita", "meditite", "timburr", "tyrogue", "throh", "sawk"], lose: "Hiyaah… I lost!" },
    { title: "Psychic", sprite: "psychic", names: ["Mark", "Herman", "Fidel", "Greg"], pool: ["abra", "drowzee", "natu", "ralts", "spoink", "slowpoke", "munna", "elgyem"], lose: "I didn't foresee that!" },
    { title: "Ace Trainer", sprite: "acetrainer", names: ["Sara", "Jake", "Quinn", "Mira"], pool: ["growlithe", "eevee", "dratini", "larvitar", "bagon", "gible", "riolu", "axew"], lose: "You're the real ace!" },
  ];
  const PKM_GYMS_KANTO = [
    { n: 1, leader: "Brock", badge: "Boulder Badge", type: "rock", icon: "🪨", color: "#a8a29e", sprite: "brock", lvl: 12, team: ["geodude", "onix"], lose: "I took you for granted. Take the Boulder Badge!" },
    { n: 2, leader: "Misty", badge: "Cascade Badge", type: "water", icon: "💧", color: "#4fa3ff", sprite: "misty", lvl: 18, team: ["staryu", "psyduck", "starmie"], lose: "Wow! You're too much! Take the Cascade Badge." },
    { n: 3, leader: "Lt. Surge", badge: "Thunder Badge", type: "electric", icon: "⚡", color: "#ffcb05", sprite: "ltsurge", lvl: 24, team: ["voltorb", "pikachu", "raichu"], lose: "Whoa! You're the real deal, kid!" },
    { n: 4, leader: "Erika", badge: "Rainbow Badge", type: "grass", icon: "🌈", color: "#6dd36d", sprite: "erika", lvl: 29, team: ["tangela", "weepinbell", "vileplume"], lose: "Oh! I concede defeat. You are remarkably strong." },
    { n: 5, leader: "Koga", badge: "Soul Badge", type: "poison", icon: "💜", color: "#b05fd6", sprite: "koga", lvl: 37, team: ["koffing", "muk", "weezing"], lose: "Humph! You have proven your worth!" },
    { n: 6, leader: "Sabrina", badge: "Marsh Badge", type: "psychic", icon: "🔮", color: "#ff6fae", sprite: "sabrina", lvl: 43, team: ["kadabra", "mr-mime", "alakazam"], lose: "I'm shocked! But a loss is a loss." },
    { n: 7, leader: "Blaine", badge: "Volcano Badge", type: "fire", icon: "🌋", color: "#ff7a2f", sprite: "blaine", lvl: 47, team: ["growlithe", "ponyta", "arcanine"], lose: "I have burned down to nothing!" },
    { n: 8, leader: "Giovanni", badge: "Earth Badge", type: "ground", icon: "🌍", color: "#c9a14a", sprite: "giovanni", lvl: 50, team: ["dugtrio", "nidoking", "rhydon"], lose: "Ha! That was a truly intense fight. You have won!" },
  ];
  // ---------- More regions: 8 Gyms each (badge numbers continue after Kanto: Johto 9-16, Hoenn 17-24, ...) ----------
  const pkmG = (n, leader, badge, type, icon, color, sprite, lvl, team, lose, x = {}) => ({ n, leader, badge, type, icon, color, sprite, lvl, team, lose, ...x });
  const PKM_GYMS_MORE = [
    // Johto
    pkmG(9, "Falkner", "Zephyr Badge", "flying", "🕊️", "#8ec5ff", "falkner", 50, ["pidgeot", "fearow", "dodrio"], "Shot down! My father's flying Pokémon taught me nothing about this. The Zephyr Badge is yours."),
    pkmG(10, "Bugsy", "Hive Badge", "bug", "🐝", "#a6c13a", "bugsy", 53, ["butterfree", "beedrill", "ariados", "scyther"], "Whoa, amazing! Research is nothing next to your skill. Take the Hive Badge."),
    pkmG(11, "Whitney", "Plain Badge", "normal", "🎀", "#f4a6c0", "whitney", 56, ["clefable", "granbull", "wigglytuff", "miltank"], "Waaah! That's not fair! …Fine. Take the Plain Badge."),
    pkmG(12, "Morty", "Fog Badge", "ghost", "👻", "#7a5fb0", "morty", 59, ["haunter", "misdreavus", "mismagius", "gengar"], "I'm not good enough yet. The Fog Badge is yours."),
    pkmG(13, "Chuck", "Storm Badge", "fighting", "🥋", "#c8553d", "chuck", 62, ["primeape", "hitmonlee", "hitmonchan", "poliwrath"], "Wahahah! You beat me fair and square. Here, the Storm Badge."),
    pkmG(14, "Jasmine", "Mineral Badge", "steel", "🔩", "#9aa7b8", "jasmine", 65, ["magneton", "skarmory", "scizor", "steelix"], "…You are stronger than I expected. Please take the Mineral Badge."),
    pkmG(15, "Pryce", "Glacier Badge", "ice", "❄️", "#9fe3ff", "pryce", 68, ["dewgong", "cloyster", "piloswine", "lapras"], "I have seen a lot of battles, but yours was something special. The Glacier Badge!", { weather: "hail" }),
    pkmG(16, "Clair", "Rising Badge", "dragon", "🐲", "#4a63d9", "clair", 72, ["dragonair", "dragonair", "kingdra", "dragonite"], "I lost?! I can't believe it. Take the Rising Badge."),
    // Hoenn
    pkmG(17, "Roxanne", "Stone Badge", "rock", "🗿", "#b59e7b", "roxanne", 62, ["nosepass", "golem", "aerodactyl"], "So, I lost. The Stone Badge is yours."),
    pkmG(18, "Brawly", "Knuckle Badge", "fighting", "👊", "#d0693c", "brawly", 64, ["hariyama", "medicham", "machamp"], "Whoa, wow! You surfed right over me. Take the Knuckle Badge."),
    pkmG(19, "Wattson", "Dynamo Badge", "electric", "🔋", "#ffd93a", "wattson-gen3", 66, ["magneton", "manectric", "electrode", "ampharos"], "Wahahahah! Fine, fine! The Dynamo Badge is yours."),
    pkmG(20, "Flannery", "Heat Badge", "fire", "🔥", "#ff6b3d", "flannery", 68, ["magcargo", "camerupt", "arcanine", "torkoal"], "Oh… I guess I was trying too hard. Here, the Heat Badge.", { weather: "sun" }),
    pkmG(21, "Norman", "Balance Badge", "normal", "⚖️", "#cfcfcf", "norman", 70, ["spinda", "vigoroth", "linoone", "slaking"], "…I see. You've earned the Balance Badge."),
    pkmG(22, "Winona", "Feather Badge", "flying", "🪶", "#8fd0ff", "winona", 72, ["swellow", "pelipper", "skarmory", "altaria"], "Never before have I seen a trainer command Pokémon so well. The Feather Badge!"),
    pkmG(23, "Tate & Liza", "Mind Badge", "psychic", "🧠", "#d96fd0", "tateandliza-gen3", 74, ["claydol", "xatu", "lunatone", "solrock"], "What? Our combination was beaten? The Mind Badge is yours."),
    pkmG(24, "Juan", "Rain Badge", "water", "🌧️", "#3b8ae6", "juan-gen3", 77, ["luvdisc", "whiscash", "sealeo", "crawdaunt", "kingdra"], "Ahahaha, excellent! You have the Rain Badge.", { weather: "rain" }),
    // Sinnoh
    pkmG(25, "Roark", "Coal Badge", "rock", "⛏️", "#a38a5f", "roark", 74, ["onix", "golem", "rampardos"], "Whoa, you crushed me! Here is the Coal Badge."),
    pkmG(26, "Gardenia", "Forest Badge", "grass", "🌳", "#59b95a", "gardenia", 76, ["cherrim", "tangrowth", "roserade"], "Oh, I lost… The Forest Badge is yours."),
    pkmG(27, "Maylene", "Cobble Badge", "fighting", "🥊", "#d0553d", "maylene", 78, ["medicham", "machamp", "lucario"], "I admit it, you are strong. The Cobble Badge!"),
    pkmG(28, "Crasher Wake", "Fen Badge", "water", "🌊", "#3d89d6", "crasherwake", 80, ["gyarados", "quagsire", "floatzel"], "Gwah! You've got the Fen Badge!", { weather: "rain" }),
    pkmG(29, "Fantina", "Relic Badge", "ghost", "🎭", "#7b52a8", "fantina", 82, ["drifblim", "gengar", "mismagius"], "You are strong! I give you the Relic Badge."),
    pkmG(30, "Byron", "Mine Badge", "steel", "⚙️", "#a0a8b8", "byron", 84, ["bronzong", "steelix", "bastiodon"], "Hmm, my steel was beaten. Take the Mine Badge."),
    pkmG(31, "Candice", "Icicle Badge", "ice", "🧊", "#8fe0f5", "candice", 86, ["sneasel", "piloswine", "abomasnow", "froslass"], "You're good! Here's the Icicle Badge.", { weather: "hail" }),
    pkmG(32, "Volkner", "Beacon Badge", "electric", "💡", "#ffd321", "volkner", 88, ["raichu", "ambipom", "octillery", "luxray"], "That was shocking. The Beacon Badge is yours."),
    // Unova
    pkmG(33, "Cilan", "Trio Badge", "grass", "🌿", "#6bc16b", "cilan", 82, ["simisage", "lilligant", "leavanny"], "A fine battle indeed. Please take the Trio Badge."),
    pkmG(34, "Lenora", "Basic Badge", "normal", "📚", "#d7b98e", "lenora", 84, ["watchog", "stoutland", "bouffalant"], "I see… The Basic Badge is yours."),
    pkmG(35, "Burgh", "Insect Badge", "bug", "🐞", "#a4cf3a", "burgh", 86, ["leavanny", "crustle", "galvantula"], "Even my art couldn't stop you. Take the Insect Badge."),
    pkmG(36, "Elesa", "Bolt Badge", "electric", "⚡", "#ffe14a", "elesa", 88, ["emolga", "emolga", "zebstrika"], "It's over, but you shine! The Bolt Badge."),
    pkmG(37, "Clay", "Quake Badge", "ground", "⛰️", "#c9a14a", "clay", 90, ["krookodile", "excadrill", "palpitoad", "seismitoad"], "Dug up some skill, did ya! The Quake Badge is yours.", { weather: "sand" }),
    pkmG(38, "Skyla", "Jet Badge", "flying", "✈️", "#7ec8ff", "skyla", 92, ["swanna", "sigilyph", "unfezant"], "You flew past me! The Jet Badge."),
    pkmG(39, "Brycen", "Freeze Badge", "ice", "☃️", "#9fe3ff", "brycen", 94, ["vanilluxe", "cryogonal", "beartic"], "Your heart is stronger than ice. The Freeze Badge.", { weather: "hail" }),
    pkmG(40, "Drayden", "Legend Badge", "dragon", "🐉", "#4a63d9", "drayden", 96, ["druddigon", "flygon", "haxorus"], "You earned the Legend Badge. Well fought!"),
    // Kalos
    pkmG(41, "Viola", "Bug Badge", "bug", "📷", "#a4cf3a", "viola", 90, ["masquerain", "vivillon", "galvantula"], "You and your Pokémon were wonderful! The Bug Badge."),
    pkmG(42, "Grant", "Cliff Badge", "rock", "🧗", "#b59e7b", "grant", 92, ["aurorus", "tyrantrum", "carracosta"], "You've cleared the cliff. Take the Cliff Badge."),
    pkmG(43, "Korrina", "Rumble Badge", "fighting", "🛼", "#d0553d", "korrina", 93, ["mienshao", "hawlucha", "lucario"], "Amazing! The Rumble Badge is yours."),
    pkmG(44, "Ramos", "Plant Badge", "grass", "🌱", "#59b95a", "ramos", 94, ["jumpluff", "victreebel", "gogoat"], "Ho ho! You've grown strong. The Plant Badge."),
    pkmG(45, "Clemont", "Voltage Badge", "electric", "🔌", "#ffe14a", "clemont", 96, ["emolga", "magnezone", "heliolisk"], "I need to rebuild my machines! Here, the Voltage Badge."),
    pkmG(46, "Valerie", "Fairy Badge", "fairy", "🧚", "#f7a6d8", "valerie", 97, ["mawile", "mr-mime", "sylveon"], "Oh, you're lovely! The Fairy Badge is yours."),
    pkmG(47, "Olympia", "Psychic Badge", "psychic", "🔮", "#d96fd0", "olympia", 98, ["sigilyph", "slowking", "meowstic"], "The future shows your victory. The Psychic Badge."),
    pkmG(48, "Wulfric", "Iceberg Badge", "ice", "🏔️", "#8fe0f5", "wulfric", 100, ["abomasnow", "cryogonal", "avalugg"], "A fine battle! The Iceberg Badge.", { weather: "hail" }),
  ];
  /** Every Gym in the game. A Gym's number (n) is also its position in this list + 1. */
  const PKM_GYMS = [...PKM_GYMS_KANTO, ...PKM_GYMS_MORE];
  if (PKM_GYMS.some((g, i) => g.n !== i + 1)) console.warn("Pokémon: gym numbers are out of order");
  const pkmBadges = () => pkmJSON("pkm_badges", []);
  /** Showdown names some trainer sprites by generation (lorelei-gen3...). Try those, then hide the image. */
  function pkmTrainerImg(img) {
    const tries = ["-gen3", "-lgpe", "-gen1"];
    let i = 0;
    img.onerror = () => {
      const base = img.src.replace(/(-gen3|-lgpe|-gen1)?\.png$/, "");
      if (i < tries.length) img.src = `${base}${tries[i++]}.png`;
      else img.remove();
    };
  }
  function pkmRandomTrainer() {
    const c = pkmPick(PKM_TRAINER_CLASSES);
    const L = pkmTrainerBase();
    const n = Math.random() < 0.45 ? 3 : 2;
    return { title: c.title, name: pkmPick(c.names), sprite: `${PKM_TRAINER_IMG}${c.sprite}.png`, lose: c.lose,
      team: Array.from({ length: n }, () => [pkmPick(c.pool), Math.max(2, Math.min(MAX_LEVEL, L + pkmRand(-2, 1)))]), gym: 0 };
  }
  function pkmGymTrainer(g) {
    const last = g.team.length - 1;
    const reg = pkmRegionOfGym(g.n);
    return { title: "Gym Leader", name: g.leader, sprite: `${PKM_TRAINER_IMG}${g.sprite}.png`, lose: g.lose, gym: g.n, rematch: pkmBadges().includes(g.n),
      region: reg.id, coinMult: reg.coin, weather: g.weather || null,
      team: g.team.map((sp, i) => (i === last ? [sp, g.lvl, g.item || "oran-berry"] : [sp, g.lvl - 2 - (last - 1 - i)])) };
  }
  function pkmAwardBadge(n) {
    const bs = pkmBadges();
    if (bs.includes(n)) return "";
    bs.push(n);
    pkmSave("pkm_badges", bs);
    const dates = pkmJSON("pkm_badge_dates", {});
    dates[n] = Date.now();
    pkmSave("pkm_badge_dates", dates);
    const g = PKM_GYMS[n - 1];
    setTimeout(() => { playSound("badge"); pkmToast(`${g.icon} You earned the ${g.badge}!`, 5000); pkmCheckAch(); }, 300);
    return ` You earned the ${g.badge}!`;
  }

  // ---------- Pokémon League (after 8 badges) ----------
  const PKM_LEAGUE = [
    { title: "Elite Four", name: "Lorelei", sprite: "lorelei", type: "ice", lose: "…Things shouldn't be this way!",
      team: [["dewgong", 54], ["cloyster", 53], ["slowbro", 54], ["jynx", 56], ["lapras", 56, "sitrus-berry"]] },
    { title: "Elite Four", name: "Bruno", sprite: "bruno", type: "fighting", lose: "Why? How could I lose?",
      team: [["onix", 53], ["hitmonchan", 55], ["hitmonlee", 55], ["onix", 56], ["machamp", 58, "sitrus-berry"]] },
    { title: "Elite Four", name: "Agatha", sprite: "agatha", type: "ghost", lose: "Oh ho! You're something special, child!",
      team: [["gengar", 56], ["golbat", 56], ["haunter", 55], ["arbok", 58], ["gengar", 60, "sitrus-berry"]] },
    { title: "Elite Four", name: "Lance", sprite: "lance", type: "dragon", lose: "I still can't believe my dragons lost to you!",
      team: [["gyarados", 58], ["dragonair", 56], ["dragonair", 56], ["aerodactyl", 60], ["dragonite", 62, "sitrus-berry"]] },
    { title: "Champion", name: "Blue", sprite: "blue", type: "normal", lose: "NO! That can't be! You beat my best!",
      team: [["pidgeot", 61], ["alakazam", 59], ["rhydon", 61], ["gyarados", 61], ["arcanine", 63], ["venusaur", 65, "sitrus-berry"]] },
  ];
  // Elite Four + Champion of the other regions (levels continue where the previous region ends)
  const pkmL = (name, sprite, type, lose, team, title = "Elite Four") => ({ title, name, sprite, type, lose, team });
  const PKM_LEAGUES = {
    kanto: PKM_LEAGUE,
    johto: [
      pkmL("Will", "will", "psychic", "Even my psychic power failed. Go on to the next one.", [["xatu", 70], ["jynx", 70], ["exeggutor", 71], ["slowbro", 71], ["espeon", 73, "sitrus-berry"]]),
      pkmL("Koga", "koga-gen2", "poison", "Fwahahah! You have the skill of a ninja!", [["ariados", 71], ["forretress", 71], ["crobat", 72], ["venomoth", 72], ["muk", 74, "sitrus-berry"]]),
      pkmL("Bruno", "bruno-gen2", "fighting", "Hm! Your spirit is strong. Go on!", [["hitmontop", 72], ["hitmonlee", 72], ["hitmonchan", 73], ["onix", 73], ["machamp", 75, "sitrus-berry"]]),
      pkmL("Karen", "karen", "dark", "Strong Pokémon. Weak Pokémon. That is only the opinion of people. You are an excellent trainer.", [["umbreon", 73], ["vileplume", 73], ["gengar", 74], ["honchkrow", 74], ["houndoom", 76, "sitrus-berry"]]),
      pkmL("Lance", "lance-gen2", "dragon", "That's it! I hand the Johto title to you.", [["gyarados", 75], ["dragonite", 75], ["aerodactyl", 75], ["charizard", 76], ["dragonite", 77], ["dragonite", 80, "sitrus-berry"]], "Champion"),
    ],
    hoenn: [
      pkmL("Sidney", "sidney-gen3", "dark", "Well, how do you like that? I lost.", [["mightyena", 78], ["shiftry", 78], ["cacturne", 79], ["crawdaunt", 79], ["absol", 81, "sitrus-berry"]]),
      pkmL("Phoebe", "phoebe-gen3", "ghost", "Oh, darn. I've gone and lost.", [["dusclops", 79], ["banette", 79], ["sableye", 80], ["banette", 80], ["dusclops", 82, "sitrus-berry"]]),
      pkmL("Glacia", "glacia-gen3", "ice", "You and your Pokémon… how hot your spirits burn!", [["glalie", 80], ["froslass", 80], ["sealeo", 81], ["glalie", 81], ["walrein", 83, "sitrus-berry"]]),
      pkmL("Drake", "drake-gen3", "dragon", "Superb, it should be said.", [["shelgon", 82], ["altaria", 82], ["flygon", 83], ["flygon", 83], ["salamence", 85, "sitrus-berry"]]),
      pkmL("Steven", "steven", "steel", "I, the Champion, fall in defeat. You are the new Champion!", [["skarmory", 84], ["claydol", 83], ["aggron", 84], ["cradily", 84], ["armaldo", 84], ["metagross", 87, "sitrus-berry"]], "Champion"),
    ],
    sinnoh: [
      pkmL("Aaron", "aaron", "bug", "Your strength is real. Go on.", [["dustox", 88], ["heracross", 88], ["vespiquen", 89], ["beautifly", 89], ["drapion", 91, "sitrus-berry"]]),
      pkmL("Bertha", "bertha", "ground", "Well, dear, I was swept away by the power of your battling.", [["whiscash", 89], ["gliscor", 89], ["hippowdon", 90], ["golem", 90], ["rhyperior", 92, "sitrus-berry"]]),
      pkmL("Flint", "flint", "fire", "Incredible! That was a hot battle!", [["houndoom", 90], ["rapidash", 90], ["flareon", 91], ["drifblim", 91], ["infernape", 93, "sitrus-berry"]]),
      pkmL("Lucian", "lucian", "psychic", "I see. You are a fine trainer.", [["mr-mime", 91], ["espeon", 91], ["bronzong", 92], ["alakazam", 92], ["gallade", 94, "sitrus-berry"]]),
      pkmL("Cynthia", "cynthia", "dragon", "That was a truly great battle. Thank you.", [["spiritomb", 92], ["roserade", 92], ["togekiss", 93], ["lucario", 93], ["milotic", 93], ["garchomp", 96, "sitrus-berry"]], "Champion"),
    ],
    unova: [
      pkmL("Shauntal", "shauntal", "ghost", "Excellent! I'll write a story about this.", [["cofagrigus", 94], ["jellicent", 94], ["drifblim", 95], ["golurk", 95], ["chandelure", 97, "sitrus-berry"]]),
      pkmL("Grimsley", "grimsley", "dark", "Win or lose, there's always a next game.", [["liepard", 95], ["scrafty", 95], ["krookodile", 96], ["bisharp", 96], ["hydreigon", 98, "sitrus-berry"]]),
      pkmL("Caitlin", "caitlin", "psychic", "My heart and mind rest easy now.", [["musharna", 95], ["sigilyph", 95], ["gothitelle", 96], ["reuniclus", 96], ["alakazam", 98, "sitrus-berry"]]),
      pkmL("Marshal", "marshal", "fighting", "Whew! Your strength is first-rate.", [["throh", 95], ["sawk", 95], ["mienshao", 96], ["conkeldurr", 96], ["machamp", 98, "sitrus-berry"]]),
      pkmL("Alder", "alder", "bug", "Ah, what a battle! You are the new Champion.", [["accelgor", 97], ["vespiquen", 97], ["escavalier", 97], ["bouffalant", 98], ["druddigon", 98], ["volcarona", 100, "sitrus-berry"]], "Champion"),
    ],
    kalos: [
      pkmL("Malva", "malva", "fire", "I'm burning with admiration!", [["pyroar", 98], ["torkoal", 98], ["chandelure", 99], ["talonflame", 99], ["delphox", 100, "sitrus-berry"]]),
      pkmL("Siebold", "siebold", "water", "Splendid. Cooking and battling are both an art.", [["clawitzer", 98], ["gyarados", 98], ["starmie", 99], ["barbaracle", 99], ["blastoise", 100, "sitrus-berry"]]),
      pkmL("Wikstrom", "wikstrom", "steel", "Glorious! You've shown honor in battle!", [["klefki", 98], ["probopass", 98], ["scizor", 99], ["bisharp", 99], ["aegislash", 100, "sitrus-berry"]]),
      pkmL("Drasna", "drasna", "dragon", "Oh, dear me, you're so strong!", [["dragalge", 98], ["altaria", 98], ["druddigon", 99], ["noivern", 99], ["goodra", 100, "sitrus-berry"]]),
      pkmL("Diantha", "diantha", "fairy", "Witnessing the noble spirits of you and your Pokémon in battle has really touched my heart.", [["hawlucha", 99], ["tyrantrum", 99], ["aurorus", 99], ["gourgeist", 100], ["goodra", 100], ["gardevoir", 100, "sitrus-berry"]], "Champion"),
    ],
  };
  /** One entry per region. gyms = first and last badge number, dex = first and last Pokédex number, coin = payout multiplier, bonus = Champion prize. */
  const PKM_REGIONS = [
    { id: "kanto", name: "Kanto", icon: "🗻", gyms: [1, 8], dex: [1, 151], coin: 1, bonus: 10000 },
    { id: "johto", name: "Johto", icon: "🍂", gyms: [9, 16], dex: [152, 251], coin: 0.6, bonus: 15000 },
    { id: "hoenn", name: "Hoenn", icon: "🌴", gyms: [17, 24], dex: [252, 386], coin: 0.5, bonus: 20000 },
    { id: "sinnoh", name: "Sinnoh", icon: "❄️", gyms: [25, 32], dex: [387, 493], coin: 0.4, bonus: 25000 },
    { id: "unova", name: "Unova", icon: "🏙️", gyms: [33, 40], dex: [494, 649], coin: 0.35, bonus: 30000 },
    { id: "kalos", name: "Kalos", icon: "🗼", gyms: [41, 48], dex: [650, 721], coin: 0.3, bonus: 40000 },
  ];
  const pkmRegion = (id) => PKM_REGIONS.find((r) => r.id === id) || PKM_REGIONS[0];
  const pkmRegionOfGym = (n) => PKM_REGIONS.find((r) => n >= r.gyms[0] && n <= r.gyms[1]) || PKM_REGIONS[0];
  /** Times each region's Champion was beaten. Hall of Fame entries from before regions existed count as Kanto. */
  function pkmChamps() {
    const c = pkmJSON("pkm_champs", {});
    if (!c.kanto && pkmJSON("pkm_hof", []).some((h) => !h.region)) c.kanto = 1;
    return c;
  }
  const pkmRegionDone = (id) => (pkmChamps()[id] || 0) > 0;
  /** A region opens after the Champion of the one before it was beaten. */
  const pkmRegionOpen = (i) => i <= 0 || pkmRegionDone(PKM_REGIONS[i - 1].id);
  const pkmRegionBadges = (r, bs = pkmBadges()) => bs.filter((n) => n >= r.gyms[0] && n <= r.gyms[1]);
  const pkmLeague = () => { const s = pkmJSON("pkm_league", { stage: 0, active: false }); if (!s.region) s.region = "kanto"; return s; };
  const pkmLeagueOf = (id) => PKM_LEAGUES[id] || PKM_LEAGUE;
  function pkmLeagueTrainer(stage, regionId, rematch) {
    const reg = pkmRegion(regionId);
    const L = pkmLeagueOf(reg.id)[stage];
    return { title: L.title, name: L.name, sprite: `${PKM_TRAINER_IMG}${L.sprite}.png`, lose: L.lose, team: rematch ? pkmRematchTeam(L.team) : L.team, gym: 0, league: stage, region: reg.id, coinMult: reg.coin * (rematch ? 1.5 : 1), rematchRun: !!rematch };
  }
  function pkmLeagueWin(b) {
    const stage = b.trainer.league;
    const reg = pkmRegion(b.trainer.region);
    const list = pkmLeagueOf(reg.id);
    if (stage < list.length - 1) {
      pkmSave("pkm_league", { stage: stage + 1, active: true, region: reg.id, rematch: !!b.trainer.rematchRun });
      return ` Next up: ${list[stage + 1].title} ${list[stage + 1].name}!`;
    }
    pkmSave("pkm_league", { stage: 0, active: false, region: reg.id });
    if (b.trainer.rematchRun) {
      const prize = Math.floor(reg.bonus / 2);
      const items = [[pkmRandomStone(), 1, "Evolution stone"], [pkmRandomHeld().key, 1, "a held item"]];
      setInt(STORAGE.coins, getInt(STORAGE.coins) + prize);
      pkmGive(items);
      pkmTrack("leagueRematches");
      setTimeout(() => { playSound("badge"); pkmToast(`🏆 ${reg.name} League rematch won! +${prize.toLocaleString()} coins and ${pkmItemsText(items)}.`, 7000); }, 500);
      return ` 🏆 You beat the ${reg.name} League again!`;
    }
    const party = getObj(STORAGE.party) || {};
    const stats = getObj(STORAGE.stats) || {};
    const hof = pkmJSON("pkm_hof", []);
    hof.push({ t: Date.now(), region: reg.id, team: b.roster.map((r) => ({ name: (party[r.id] || { name: r.name }).name, level: (stats[r.id] || {}).level || 1, shiny: !!(party[r.id] || {}).isShiny, sprite: pkmMonSprite(party[r.id] || { name: r.name }, getArr(STORAGE.pokedex) || []) })) });
    pkmSave("pkm_hof", hof.slice(-30));
    const champs = pkmJSON("pkm_champs", {});
    const before = pkmChamps();
    Object.assign(champs, before);
    champs[reg.id] = (champs[reg.id] || 0) + 1;
    pkmSave("pkm_champs", champs);
    setInt(STORAGE.coins, getInt(STORAGE.coins) + reg.bonus);
    pkmTrack("champion");
    const idx = PKM_REGIONS.indexOf(reg);
    const next = PKM_REGIONS[idx + 1];
    const unlockMsg = next && !before[reg.id] ? ` ${next.icon} ${next.name} is now open: see Trainers & Gyms.` : "";
    setTimeout(() => { playSound("badge"); pkmToast(`🏆 You are the new ${reg.name} Champion! +${reg.bonus.toLocaleString()} coins. Your team joined the Hall of Fame!${unlockMsg}`, 8000); }, 500);
    return ` 🏆 You're the ${reg.name} Champion!`;
  }
  {
    const pc = pokeCenter;
    pokeCenter = function () {
      if (pkmLeague().active) return pkmToast("🏆 You're in the middle of a League run! The Pokémon Center opens again when you finish or quit the run (Trainers panel).", 4500);
      const r = pc.apply(this, arguments);
      pkmFriend(GM_getValue("pkm_starter_id"), 1);
      return r;
    };
  }

  let pkmTrainersPanel = null;
  let pkmTrRegion = null;
  function pkmCloseTrainers() { if (pkmTrainersPanel) pkmTrainersPanel.remove(); pkmTrainersPanel = null; }
  function pkmOpenTrainers(region) {
    if (typeof region === "string") pkmTrRegion = region;
    if (pkmTrainersPanel) pkmTrainersPanel.remove();
    const p = (pkmTrainersPanel = document.createElement("div"));
    p.className = "pkm-panel pkm-modal pkm-set pkm-trainers";
    p.setAttribute("role", "dialog");
    p.setAttribute("aria-label", "Trainers and Gyms");
    const L = activeStats().level || 1;
    const bs = pkmBadges();
    const lg = pkmLeague();
    // Start on the first region that is open and not finished yet
    if (!pkmTrRegion || !PKM_REGIONS.some((r) => r.id === pkmTrRegion)) {
      let i = PKM_REGIONS.findIndex((r, ix) => pkmRegionOpen(ix) && !pkmRegionDone(r.id));
      if (i < 0) i = PKM_REGIONS.length - 1;
      pkmTrRegion = PKM_REGIONS[i].id;
    }
    const ri = PKM_REGIONS.findIndex((r) => r.id === pkmTrRegion);
    const reg = PKM_REGIONS[ri];
    const open = pkmRegionOpen(ri);
    const rb = pkmRegionBadges(reg, bs);
    const leagueList = pkmLeagueOf(reg.id);
    const leagueOpen = open && rb.length >= 8;
    const runHere = lg.active && lg.region === reg.id;
    const champs = pkmChamps()[reg.id] || 0;
    const tower = pkmTower();
    const rival = pkmRival();
    const rivalDone = rival.stage >= PKM_RIVAL_STAGES.length;
    const rivalNeed = PKM_RIVAL_STAGES[Math.min(rival.stage, PKM_RIVAL_STAGES.length - 1)].need;
    const rivalReady = pkmRivalReady();
    const gyms = PKM_GYMS.filter((g) => g.n >= reg.gyms[0] && g.n <= reg.gyms[1]);
    p.innerHTML = `
      <div class="pkm-set-head tr-head"><span>🧢 Trainers & Gyms</span><button type="button" class="pkm-x" data-a="close" aria-label="Close" title="Close (Esc)">✕</button></div>
      <div class="tr-cards">
        <div class="tr-random">
          <div><div class="tr-t">⚔️ Random trainer</div><div class="pkm-dim">2–3 Pokémon around Lv ${pkmTrainerBase()}. Pays about ${30 * (pkmTrainerBase() + 1)} coins. No catching, no running.</div></div>
          <button type="button" class="pkm-btn2 primary" data-a="random">Find a trainer</button>
        </div>
        <div class="tr-random">
          <div><div class="tr-t">👥 Double battle</div><div class="pkm-dim">2 vs 2 against a trainer with 4 Pokémon. You need at least 2 healthy Pokémon.</div></div>
          <button type="button" class="pkm-btn2 primary" data-a="double">Find a duo</button>
        </div>
        <div class="tr-random">
          <div><div class="tr-t">👥 Triple and rotation battles</div><div class="pkm-dim">Triple: 3 vs 3 against a trainer with 6 Pokémon (you need 3 healthy Pokémon). Rotation: your first 3 Pokémon take turns up front, and rotating is free once per turn.</div></div>
          <div class="pkm-btns"><button type="button" class="pkm-btn2 primary" data-a="triple">Find a trio</button><button type="button" class="pkm-btn2" data-a="rotation">Rotation battle</button></div>
        </div>
        <div class="tr-random tr-safari">
          <div><div class="tr-t">🌴 Safari Zone</div><div class="pkm-dim">10 minutes, 30 Safari Balls, rare Pokémon. Entry ${pkmSafariCost()} coins.</div></div>
          <button type="button" class="pkm-btn2 primary" data-a="safari">Enter</button>
        </div>
        <div class="tr-random tr-tower">
          <div><div class="tr-t">🗼 Battle Tower</div><div class="pkm-dim">Endless win streak with coin and item prizes. Best streak: ${tower.best}.${tower.active ? ` Run in progress: ${tower.streak}.` : ""}</div></div>
          <button type="button" class="pkm-btn2 primary" data-a="tower">${tower.active ? "Continue" : "Enter"}</button>
        </div>
        <div class="tr-random tr-rival">
          <div><div class="tr-t">😤 Rival <input class="rv-name" maxlength="12" value="${pkmEsc(rival.name)}" aria-label="Rival's name"></div>
            <div class="pkm-dim">${rivalDone ? `Rematch at your level (half pay). Record: ${rival.wins}W ${rival.losses}L.` : rivalReady ? `Battle ${rival.stage + 1} of ${PKM_RIVAL_STAGES.length}. Record: ${rival.wins}W ${rival.losses}L.` : `Battle ${rival.stage + 1} of ${PKM_RIVAL_STAGES.length} needs ${rivalNeed} badges (you have ${bs.length}).`}</div></div>
          <button type="button" class="pkm-btn2 primary" data-a="rival" ${rivalReady ? "" : "disabled"}>${rivalReady ? (rivalDone ? "Rematch" : "Battle") : "🔒 Locked"}</button>
        </div>
      </div>
      <div class="tr-regions" role="tablist" aria-label="Regions">${PKM_REGIONS.map((r, i) => `<button type="button" role="tab" data-region="${r.id}" aria-selected="${r.id === reg.id}">${r.icon} ${r.name} ${pkmRegionDone(r.id) ? "🏆" : pkmRegionOpen(i) ? `${pkmRegionBadges(r, bs).length}/8` : "🔒"}</button>`).join("")}</div>
      ${open ? "" : `<div class="pkm-dim" style="padding:0 16px 8px">🔒 Beat the ${PKM_REGIONS[ri - 1].name} Champion to open ${reg.name}.</div>`}
      <div class="bag-sec" style="padding:0 16px"><span>${reg.name} Gyms</span><span class="pkm-dim">${rb.length}/8 badges</span></div>
      <div class="tr-gyms">${gyms.map((g) => {
        const earned = bs.includes(g.n);
        const locked = !open || (g.n > reg.gyms[0] && !bs.includes(g.n - 1));
        return `<div class="tr-gym${earned ? " earned" : ""}${locked ? " locked" : ""}" style="--gc:${g.color}">
          <div class="tr-top"><img class="tr-img" src="${PKM_TRAINER_IMG}${g.sprite}.png" alt=""><div class="tr-badge" title="${g.badge}">${g.icon}</div></div>
          <div class="tr-name">${pkmEsc(g.leader)}</div><div class="pkm-dim">${g.badge}</div>
          <div class="tr-meta"><span class="pk-type ${g.type}">${g.type}</span><span class="pkm-dim">Lv ${g.lvl}</span></div>
          <button type="button" class="pkm-btn2 ${earned ? "" : "primary"}" data-gym="${g.n}" ${locked ? "disabled" : ""}>${locked ? "🔒 Locked" : earned ? "Rematch" : "Challenge"}</button>
        </div>`;
      }).join("")}</div>
      <div class="bag-sec" style="padding:0 16px"><span>🏆 ${reg.name} League</span><span class="pkm-dim">${leagueOpen ? (champs ? `Champion ×${champs}` : `Beat all ${leagueList.length} in a row`) : "Earn all 8 badges to enter"}</span></div>
      <div class="tr-league${leagueOpen ? "" : " locked"}">${leagueList.map((x, i) => `<div class="tr-lg${i < lg.stage && runHere ? " done" : ""}${i === lg.stage && leagueOpen && runHere ? " next" : ""}">
          <img class="tr-img" src="${PKM_TRAINER_IMG}${x.sprite}.png" alt=""><div class="tr-name">${pkmEsc(x.name)}</div><div class="pkm-dim">${x.title}</div>
          <span class="pk-type ${x.type}">${x.type}</span><div class="pkm-dim">Lv ${x.team[x.team.length - 1][1]}</div></div>`).join("")}</div>
      <div class="pkm-btns" style="padding:0 16px 8px">
        <button type="button" class="pkm-btn2 primary" data-a="league" ${leagueOpen && (!lg.active || runHere) ? "" : "disabled"}>${runHere ? `Continue: ${leagueList[lg.stage].name}` : lg.active && lg.region !== reg.id ? `Finish the ${pkmRegion(lg.region).name} run first` : "Start a League run"}</button>
        ${champs && !lg.active ? '<button type="button" class="pkm-btn2" data-a="rematch" title="Stronger teams (10 levels higher) for half the Champion prize">Rematch run (stronger teams)</button>' : ""}
        ${lg.active ? '<button type="button" class="pkm-btn2 danger" data-a="quit">Quit the run</button>' : ""}
      </div>
      <div class="pkm-dim" style="padding:0 16px 14px">Gyms unlock one after another and pay 120 × their level (×${reg.coin} in ${reg.name}, half on rematches). Beat a region's Champion to open the next region (Champion prize: ${reg.bonus.toLocaleString()} coins). During a League run the Pokémon Center is closed, so bring Potions and Revives. Losing any trainer battle costs 5% of your coins.</div>`;
    p.querySelectorAll(".tr-img").forEach(pkmTrainerImg);
    p.onchange = (e) => {
      if (e.target.matches(".rv-name")) {
        const r = pkmRival();
        r.name = pkmSafeName(e.target.value, 12) || "Silver";
        pkmSave("pkm_rival", r);
        pkmToast(`Your rival is now called ${r.name}.`);
      }
    };
    p.onclick = (e) => {
      const rg = e.target.closest("[data-region]");
      if (rg) return pkmOpenTrainers(rg.dataset.region);
      const a = e.target.closest("[data-a]")?.dataset.a;
      if (a === "close") return pkmCloseTrainers();
      if (a === "random") return pkmStartTrainer(pkmRandomTrainer());
      if (a === "double") return pkmStartTrainer(pkmDoubleTrainer());
      if (a === "triple") return pkmStartTrainer(pkmTripleTrainer());
      if (a === "rotation") return pkmStartTrainer(pkmRotationTrainer());
      if (a === "safari") return pkmOpenSafari();
      if (a === "tower") return pkmOpenTower();
      if (a === "rival") return pkmStartTrainer(pkmRivalTrainer());
      if (a === "quit") { pkmSave("pkm_league", { stage: 0, active: false, region: pkmLeague().region }); pkmToast("League run ended. The Pokémon Center is open again."); return pkmOpenTrainers(); }
      if (a === "league") {
        const cur = pkmLeague();
        if (cur.active && cur.region !== reg.id) return pkmToast(`Finish or quit your ${pkmRegion(cur.region).name} League run first.`);
        if (!cur.active) pkmSave("pkm_league", { stage: 0, active: true, region: reg.id });
        return pkmStartTrainer(pkmLeagueTrainer(cur.active ? cur.stage : 0, reg.id, cur.active ? cur.rematch : false));
      }
      if (a === "rematch") {
        if (!pkmRegionDone(reg.id) || pkmLeague().active) return;
        pkmSave("pkm_league", { stage: 0, active: true, region: reg.id, rematch: true });
        return pkmStartTrainer(pkmLeagueTrainer(0, reg.id, true));
      }
      const g = e.target.closest("[data-gym]");
      if (g && !g.disabled) {
        const gym = PKM_GYMS[+g.dataset.gym - 1];
        if (L < gym.lvl - 6) pkmToast(`⚠️ ${gym.leader}'s Pokémon are around Lv ${gym.lvl}. Yours is Lv ${L}. Good luck!`, 3500);
        pkmGymGate(gym, () => pkmStartTrainer(pkmGymTrainer(gym)));
      }
    };
    pkmMount(p);
  }
  // ---------- Progress, achievements, weekly stats ----------
  function pkmWeekId(d = new Date()) {
    const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    const day = t.getUTCDay() || 7;
    t.setUTCDate(t.getUTCDate() + 4 - day);
    const y = t.getUTCFullYear();
    const w = Math.ceil(((t - Date.UTC(y, 0, 1)) / 864e5 + 1) / 7);
    return `${y}-W${String(w).padStart(2, "0")}`;
  }
  let pkmWeekRolled = null;
  function pkmWeek() {
    let w = pkmJSON("pkm_week", null);
    const id = pkmWeekId();
    if (!w || w.id !== id) {
      if (w && w.id) { pkmSave("pkm_week_prev", w); pkmWeekRolled = w; }
      w = { id };
      pkmSave("pkm_week", w);
    }
    return w;
  }
  function pkmTrack(field, n = 1) {
    const p = pkmJSON("pkm_progress", {});
    p[field] = (p[field] || 0) + n;
    pkmSave("pkm_progress", p);
    const w = pkmWeek();
    w[field] = (w[field] || 0) + n;
    pkmSave("pkm_week", w);
    if (field === "coins") pkmQuest("coins", n);
    if (field !== "xp" && field !== "battles") pkmCheckAch();
  }
  function pkmTrackTypes(types) {
    const p = pkmJSON("pkm_progress", {});
    p.byType = p.byType || {};
    for (const t of types || []) p.byType[t] = (p.byType[t] || 0) + 1;
    pkmSave("pkm_progress", p);
    pkmCheckAch();
  }
  function pkmOnEvolve() {
    pkmTrack("evolutions");
    playSound("evolve");
    pkmReact("happy");
  }
  function pkmProgressView() {
    const p = pkmJSON("pkm_progress", {});
    const stats = getObj(STORAGE.stats) || {};
    const party = getObj(STORAGE.party) || {};
    p._maxLv = Math.max(1, ...Object.keys(party).map((id) => Math.min(MAX_LEVEL, (stats[id] && stats[id].level) || 1)));
    p._dex = (getArr(STORAGE.pokedex) || []).length;
    p._badges = pkmBadges().length;
    p._streak = (pkmJSON("pkm_daily", {}).best) || 0;
    p._coins = getInt(STORAGE.coins);
    p.byType = p.byType || {};
    return p;
  }
  const PKM_TYPE_ICON = { water: "💧", fire: "🔥", grass: "🌿", electric: "⚡", bug: "🐛", psychic: "🔮", dragon: "🐉", ghost: "👻" };
  const PKM_ACH = [
    ["catch1", "⭕", "First catch", "Catch a Pokémon", (p) => p.caught || 0, 1],
    ["catch10", "🎒", "Collector", "Catch 10 Pokémon", (p) => p.caught || 0, 10],
    ["catch50", "📦", "Hoarder", "Catch 50 Pokémon", (p) => p.caught || 0, 50],
    ["catch150", "🏆", "Gotta catch 'em all", "Catch 150 Pokémon", (p) => p.caught || 0, 150],
    ["dex100", "📖", "Researcher", "Have 100 Pokédex entries", (p) => p._dex, 100],
    ...Object.keys(PKM_TYPE_ICON).map((t) => [`type_${t}`, PKM_TYPE_ICON[t], `${pkmCap(t)} specialist`, `Catch 10 ${pkmCap(t)}-type Pokémon`, (p) => p.byType[t] || 0, 10]),
    ["lv25", "⭐", "Rising star", "Get a Pokémon to Lv 25", (p) => p._maxLv, 25],
    ["lv50", "🌟", "Veteran", "Get a Pokémon to Lv 50", (p) => p._maxLv, 50],
    ["lv100", "💫", "Champion", "Get a Pokémon to Lv 100", (p) => p._maxLv, 100],
    ["win10", "⚔️", "Battler", "Win 10 battles", (p) => p.wins || 0, 10],
    ["win100", "🗡️", "Battle master", "Win 100 battles", (p) => p.wins || 0, 100],
    ["trainer10", "🧢", "Trainer tamer", "Beat 10 trainers", (p) => p.trainerWins || 0, 10],
    ["badge1", "🪨", "First badge", "Earn a Gym badge", (p) => p._badges, 1],
    ["badges8", "🏅", "Kanto champion", "Earn all 8 Gym badges", (p) => p._badges, 8],
    ["shiny1", "✨", "Shiny hunter", "Catch a shiny Pokémon", (p) => p.shinies || 0, 1],
    ["shiny5", "💎", "Sparkle squad", "Catch 5 shiny Pokémon", (p) => p.shinies || 0, 5],
    ["evolve1", "🧬", "What? It's evolving!", "Evolve a Pokémon", (p) => p.evolutions || 0, 1],
    ["evolve10", "🦋", "Metamorphosis", "Evolve 10 times", (p) => p.evolutions || 0, 10],
    ["streak7", "📅", "Dedicated", "Play 7 days in a row", (p) => p._streak, 7],
    ["streak30", "🗓️", "Unstoppable", "Play 30 days in a row", (p) => p._streak, 30],
    ["rich", "💰", "Saver", "Hold 10,000 coins", (p) => p._coins, 10000],
  ];
  let pkmAchBusy = false;
  function pkmCheckAch() {
    if (pkmAchBusy) return;
    pkmAchBusy = true;
    try {
      const got = pkmJSON("pkm_ach", {});
      const p = pkmProgressView();
      const fresh = PKM_ACH.filter(([id, , , , val, goal]) => !got[id] && val(p) >= goal);
      if (!fresh.length) return;
      fresh.forEach(([id]) => (got[id] = Date.now()));
      pkmSave("pkm_ach", got);
      setInt(STORAGE.coins, getInt(STORAGE.coins) + 100 * fresh.length);
      fresh.forEach(([, icon, name], i) => setTimeout(() => { playSound("badge"); pkmToast(`🏆 Achievement: ${icon} ${name} (+100 coins)`, 4000); }, 600 + i * 1800));
    } finally {
      pkmAchBusy = false;
    }
  }

  // ---------- Trainer card (quests / badges / achievements / this week / Hall of Fame) ----------
  let pkmBadgesPanel = null;
  let pkmBadgesTab = "quests";
  function pkmCloseBadges() { if (pkmBadgesPanel) pkmBadgesPanel.remove(); pkmBadgesPanel = null; }
  function pkmOpenBadges(tab) {
    if (typeof tab === "string") pkmBadgesTab = tab;
    if (!pkmBadgesPanel) {
      pkmBadgesPanel = document.createElement("div");
      pkmBadgesPanel.className = "pkm-panel pkm-modal pkm-set pkm-badges";
      pkmBadgesPanel.setAttribute("role", "dialog");
      pkmBadgesPanel.setAttribute("aria-label", "Trainer card");
      pkmMount(pkmBadgesPanel);
    }
    const P = pkmBadgesPanel;
    const bs = pkmBadges();
    const dates = pkmJSON("pkm_badge_dates", {});
    const got = pkmJSON("pkm_ach", {});
    const pv = pkmProgressView();
    let body = "";
    if (pkmBadgesTab === "quests") {
      const q = pkmQuests();
      body = `<div class="pkm-dim" style="margin-bottom:8px">New quests every day at midnight. Finish all three for a bonus of 500 coins and 2 Ultra Balls.</div>
        <div class="bc-ach">${q.list.map((it) => `<div class="bc-row${it.done ? " on" : ""}"><div class="bc-ico">${it.done ? "✅" : "📋"}</div>
          <div class="bc-txt"><b>${pkmEsc(it.text)}</b><div class="pkm-dim">Reward: 💰 ${it.reward[0]} + ${it.reward[2]} × ${pkmEsc(it.reward[3])}</div>
          <div class="bc-bar"><span style="width:${Math.round((it.have / it.n) * 100)}%"></span></div></div><div class="bc-val">${it.done ? "✓" : `${it.have}/${it.n}`}</div></div>`).join("")}
          <div class="bc-row${q.bonus ? " on" : ""}"><div class="bc-ico">🎁</div><div class="bc-txt"><b>Daily bonus</b><div class="pkm-dim">Finish all three quests</div></div><div class="bc-val">${q.bonus ? "✓" : `${q.list.filter((x) => x.done).length}/3`}</div></div>
        </div>`;
    } else if (pkmBadgesTab === "badges") {
      body = PKM_REGIONS.map((r, ri) => `<div class="bag-sec"><span>${r.icon} ${r.name}${pkmRegionDone(r.id) ? " 🏆" : ""}</span><span class="pkm-dim">${pkmRegionBadges(r, bs).length}/8${pkmRegionOpen(ri) ? "" : " · 🔒"}</span></div>
        <div class="bc-case">${PKM_GYMS.filter((g) => g.n >= r.gyms[0] && g.n <= r.gyms[1]).map((g) => `<div class="bc-badge${bs.includes(g.n) ? " on" : ""}" style="--gc:${g.color}" title="${g.badge} · ${g.leader}${dates[g.n] ? " · " + new Date(dates[g.n]).toLocaleDateString() : ""}">
          <div class="bc-medal">${g.icon}</div><div class="bc-name">${g.badge}</div><div class="pkm-dim">${bs.includes(g.n) ? "Earned" : g.leader}</div></div>`).join("")}</div>`).join("") +
        `<div class="pkm-dim" style="text-align:center;margin-top:10px">Challenge Gym Leaders from 🧢 Trainers. All 8 badges of a region open its League, and its Champion opens the next region.</div>`;
    } else if (pkmBadgesTab === "dex") {
      const claims = pkmDexDone();
      const prizeTxt = (k, pct) => ({ 25: `💰 ${500 * k} + 5 Great Balls`, 50: `💰 ${1000 * k} + 3 Ultra Balls`, 75: `💰 ${2000 * k} + 2 Revives + a stone`, 100: `💰 ${5000 * k} + Master Ball + a held item` }[pct]);
      body = `<div class="pkm-dim" style="margin-bottom:8px">Register Pokémon in your Pokédex (catch, hatch or trade for them) to earn prizes in each region.</div>` + PKM_REGIONS.map((r, ri) => {
        const d = pkmDexRegion(r);
        const pct = Math.floor((d.have * 100) / d.total);
        return `<div class="dx-reg"><div class="bag-sec"><span>${r.icon} ${r.name}</span><span class="pkm-dim">${d.have}/${d.total} (${pct}%)</span></div><div class="bc-bar"><span style="width:${pct}%"></span></div>
          <div class="dx-steps">${PKM_DEX_STEPS.map((s) => {
            const got = (claims[r.id] || []).includes(s);
            const can = !got && d.have >= Math.ceil((d.total * s) / 100);
            return `<div class="dx-step${got ? " got" : ""}"><b>${s}%</b><span class="pkm-dim">${prizeTxt(ri + 1, s)}</span><button type="button" class="pkm-btn2 ${can ? "primary" : ""}" data-dex="${r.id}:${s}" ${can ? "" : "disabled"}>${got ? "Claimed ✓" : can ? "Claim" : `${Math.ceil((d.total * s) / 100)} needed`}</button></div>`;
          }).join("")}</div></div>`;
      }).join("");
    } else if (pkmBadgesTab === "ach") {
      const done = PKM_ACH.filter(([id]) => got[id]).length;
      body = `<div class="pkm-dim" style="margin-bottom:8px">${done}/${PKM_ACH.length} unlocked · each one pays 100 coins</div><div class="bc-ach">${PKM_ACH.map(([id, icon, name, desc, val, goal]) => {
        const v = Math.min(goal, val(pv));
        return `<div class="bc-row${got[id] ? " on" : ""}"><div class="bc-ico">${icon}</div><div class="bc-txt"><b>${name}</b><div class="pkm-dim">${desc}</div>
          <div class="bc-bar"><span style="width:${Math.round((v / goal) * 100)}%"></span></div></div><div class="bc-val">${got[id] ? "✓" : `${v}/${goal}`}</div></div>`;
      }).join("")}</div>`;
    } else if (pkmBadgesTab === "hof") {
      const hof = pkmJSON("pkm_hof", []);
      body = hof.length
        ? `<div class="bc-hof">${hof.slice().reverse().map((h, i) => `<div class="bc-hof-e"><div class="bc-hof-h"><b>🏆 ${pkmEsc(pkmRegion(h.region || "kanto").name)} Champion #${hof.length - i}</b><span class="pkm-dim">${pkmEsc(new Date(h.t).toLocaleDateString())}</span></div>
            <div class="bc-hof-team">${h.team.map((m) => `<div title="${pkmEsc(pkmCap(m.name))} Lv ${m.level}"><img src="${pkmEsc(m.sprite)}" alt="">${m.shiny ? "<i>✨</i>" : ""}<span>${pkmEsc(pkmCap(m.name))}</span><span class="pkm-dim">Lv ${m.level}</span></div>`).join("")}</div></div>`).join("")}</div>`
        : `<div class="pkm-dim" style="text-align:center;padding:30px">Beat the Elite Four and the Champion to enter the Hall of Fame.</div>`;
    } else {
      const w = pkmWeek();
      const prev = pkmJSON("pkm_week_prev", {});
      const tile = (k, icon, label) => {
        const a = w[k] || 0, b = prev[k] || 0;
        const diff = a - b;
        return `<div class="bc-tile"><div class="bc-ti">${icon}</div><div class="bc-tv">${a.toLocaleString()}</div><div class="pkm-dim">${label}</div>
          ${prev.id ? `<div class="bc-td ${diff > 0 ? "up" : diff < 0 ? "down" : ""}">${diff > 0 ? "▲" : diff < 0 ? "▼" : "="} ${Math.abs(diff).toLocaleString()} vs last week</div>` : ""}</div>`;
      };
      body = `<div class="bc-week-h"><b>Week ${pkmEsc(w.id.split("-W")[1])}</b> <span class="pkm-dim">${pkmEsc(w.id.split("-W")[0])}</span></div>
        <div class="bc-tiles">${tile("wins", "⚔️", "Battles won")}${tile("trainerWins", "🧢", "Trainers beaten")}${tile("caught", "⭕", "Pokémon caught")}
        ${tile("shinies", "✨", "Shinies caught")}${tile("coins", "💰", "Coins earned")}${tile("xp", "📈", "XP gained")}${tile("quests", "📋", "Quests done")}${tile("evolutions", "🧬", "Evolutions")}</div>`;
    }
    const q = pkmQuests();
    P.innerHTML = `
      <div class="pkm-set-head bc-head"><span>🏅 Trainer card</span><button type="button" class="pkm-x" data-a="close" aria-label="Close" title="Close (Esc)">✕</button></div>
      <div class="bag-tabs" role="tablist">
        <button type="button" role="tab" data-tab="quests" aria-selected="${pkmBadgesTab === "quests"}">Quests <span class="bag-count">${q.list.filter((x) => x.done).length}/3</span></button>
        <button type="button" role="tab" data-tab="badges" aria-selected="${pkmBadgesTab === "badges"}">Badges <span class="bag-count">${bs.length}/${PKM_GYMS.length}</span></button>
        <button type="button" role="tab" data-tab="dex" aria-selected="${pkmBadgesTab === "dex"}">Dex prizes</button>
        <button type="button" role="tab" data-tab="ach" aria-selected="${pkmBadgesTab === "ach"}">Achievements</button>
        <button type="button" role="tab" data-tab="week" aria-selected="${pkmBadgesTab === "week"}">This week</button>
        <button type="button" role="tab" data-tab="hof" aria-selected="${pkmBadgesTab === "hof"}">Hall of Fame</button>
      </div>
      <div class="bc-body">${body}</div>`;
    P.onclick = (e) => {
      const dx = e.target.closest("[data-dex]");
      if (dx && !dx.disabled) { const [rid, pct] = dx.dataset.dex.split(":"); pkmDexClaim(rid, +pct); return pkmOpenBadges(); }
      const t = e.target.closest("[data-tab]");
      if (t) return pkmOpenBadges(t.dataset.tab);
      if (e.target.closest("[data-a='close']")) pkmCloseBadges();
    };
  }
  // ---------- Daily login reward (bigger every day in a row) ----------
  const pkmDay = (off = 0) => { const d = new Date(); d.setDate(d.getDate() + off); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
  const PKM_STONES = ["fire-stone", "water-stone", "thunder-stone", "leaf-stone", "moon-stone", "sun-stone", "shiny-stone", "dusk-stone", "dawn-stone", "ice-stone"];
  function pkmDailyRewards(streak) {
    const day = ((streak - 1) % 7) + 1;
    const weeks = Math.floor((streak - 1) / 7);
    const coins = Math.round([100, 150, 200, 250, 300, 350, 500][day - 1] * (1 + 0.1 * Math.min(5, weeks)));
    const items = [];
    if (day === 2) items.push([STORAGE.balls, 5, "Poké Balls"]);
    if (day === 3) items.push([STORAGE.greatBalls, 3, "Great Balls"]);
    if (day === 4) items.push([STORAGE.potions, 3, "Potions"]);
    if (day === 5) items.push([STORAGE.ultraBalls, 2, "Ultra Balls"]);
    if (day === 6) items.push(["pkm_revive", 1, "Revive"]);
    if (day === 7) items.push([`pkm_item_${pkmPick(PKM_STONES)}`, 1, "Evolution stone"], [STORAGE.ultraBalls, 3, "Ultra Balls"]);
    return { day, coins, items };
  }
  let pkmDailyPanel = null;
  function pkmCloseDaily() { if (pkmDailyPanel) pkmDailyPanel.remove(); pkmDailyPanel = null; }
  /** Claims today's reward if it wasn't claimed yet; returns what was given (or null). */
  function pkmClaimDaily() {
    const d = pkmJSON("pkm_daily", {});
    const today = pkmDay(0);
    if (d.last === today) return null;
    const streak = d.last === pkmDay(-1) ? (d.streak || 0) + 1 : 1;
    const r = pkmDailyRewards(streak);
    let master = false;
    if (r.day === 7 && Math.random() < 0.25) { master = true; r.items.push([STORAGE.masterBalls, 1, "Master Ball"]); }
    if ((pkmCurrentEvent() || {}).id === "holiday") r.coins *= 2;
    setInt(STORAGE.coins, getInt(STORAGE.coins) + r.coins);
    for (const [k, n] of r.items) setInt(k, getInt(k) + n);
    pkmSave("pkm_daily", { last: today, streak, best: Math.max(d.best || 0, streak) });
    pkmTrack("coins", r.coins);
    return { ...r, streak, master, isNew: true };
  }
  function pkmOpenDaily(claimed) {
    const d = pkmJSON("pkm_daily", {});
    const streak = d.last === pkmDay(0) || d.last === pkmDay(-1) ? d.streak || 0 : 0;
    const res = claimed && claimed.isNew ? claimed : null;
    const cur = res ? res.streak : streak;
    const dayInWeek = cur ? ((cur - 1) % 7) + 1 : 0;
    const next = pkmDailyRewards((d.last === pkmDay(0) ? cur : cur) + 1);
    pkmCloseDaily();
    const P = (pkmDailyPanel = document.createElement("div"));
    P.className = "pkm-panel pkm-modal pkm-set pkm-daily";
    P.setAttribute("role", "dialog");
    P.setAttribute("aria-label", "Daily reward");
    const prev = pkmWeekRolled;
    P.innerHTML = `
      <div class="pkm-set-head dl-head"><span>🎁 Daily reward</span><button type="button" class="pkm-x" data-a="close" aria-label="Close" title="Close (Esc)">✕</button></div>
      <div class="dl-body">
        <div class="dl-streak">🔥 ${cur || 0}-day streak <span class="pkm-dim">(best ${Math.max(d.best || 0, cur || 0)})</span></div>
        <div class="dl-days">${[1, 2, 3, 4, 5, 6, 7].map((n) => `<div class="dl-day${n < dayInWeek || (n === dayInWeek && cur) ? " done" : ""}${n === dayInWeek && res ? " today" : ""}"><b>Day ${n}</b><span>${["💰", "⭕", "🔵", "💉", "🟡", "✨", "💎"][n - 1]}</span></div>`).join("")}</div>
        ${res ? `<div class="dl-got"><div class="dl-t">Today you got</div><div class="dl-items"><span>💰 ${res.coins} coins</span>${res.items.map(([, n, label]) => `<span>${n} × ${label}</span>`).join("")}</div>
          ${res.master ? `<div class="dl-master">🎉 Lucky! A Master Ball!</div>` : ""}</div>`
          : `<div class="dl-got"><div class="dl-t">${d.last === pkmDay(0) ? "Already collected today ✓" : "Come back tomorrow!"}</div></div>`}
        <div class="pkm-dim dl-next">Tomorrow (day ${(dayInWeek % 7) + 1}): 💰 ${next.coins}${next.items.map(([, n, l]) => ` + ${n} × ${l}`).join("")}. Miss a day and the streak starts over.</div>
        ${prev && prev.id ? `<div class="dl-week"><b>📊 Last week</b><span>⚔️ ${prev.wins || 0} wins</span><span>⭕ ${prev.caught || 0} caught</span><span>💰 ${prev.coins || 0} coins</span><span>✨ ${prev.shinies || 0} shiny</span></div>` : ""}
        <div class="pkm-btns" style="justify-content:center;margin-top:12px"><button type="button" class="pkm-btn2 primary" data-a="close">Awesome!</button><button type="button" class="pkm-btn2" data-a="stats">📊 Weekly stats</button></div>
      </div>`;
    P.onclick = (e) => {
      const a = e.target.closest("[data-a]")?.dataset.a;
      if (a === "close") pkmCloseDaily();
      if (a === "stats") { pkmCloseDaily(); pkmOpenBadges("week"); }
    };
    pkmMount(P);
    if (res) { playSound("daily"); pkmReact("happy"); }
    pkmWeekRolled = null;
    P.querySelector('[data-a="close"].primary').focus({ preventScroll: true });
  }
  // Show the daily reward once per day, when the page is idle (not while typing or in another panel)
  {
    let tries = 0;
    const tick = () => {
      const d = pkmJSON("pkm_daily", {});
      if (d.last === pkmDay(0)) return;
      if (document.hidden || pkmTyping || pkmOpenPanel() || !wrap.isConnected) { if (++tries < 120) setTimeout(tick, 30000); return; }
      const r = pkmClaimDaily();
      if (r) pkmOpenDaily(r);
    };
    setTimeout(tick, 2500);
  }

  // ---------- Evolution stones ----------
  for (const s of PKM_STONES) {
    PKM_ITEMS.push({ img: s, name: pkmCap(s), key: `pkm_item_${s}`, price: 300, cat: "evolution", desc: "Evolves certain Pokémon. Use it from the Bag on your active partner.", use: `stone:${s}` });
  }
  function pkmFindChainNode(node, name) {
    if (!node) return null;
    if (node.species && node.species.name === name) return node;
    for (const c of node.evolves_to || []) { const r = pkmFindChainNode(c, name); if (r) return r; }
    return null;
  }
  async function pkmUseStone(stone) {
    const key = `pkm_item_${stone}`;
    if (getInt(key) <= 0) return pkmToast(`You don't have a ${pkmCap(stone)}`);
    const id = GM_getValue("pkm_starter_id");
    const party = getObj(STORAGE.party) || {};
    const mon = party[id];
    if (!mon) return pkmToast("Choose an active partner first");
    try {
      const nm = String(mon.name).toLowerCase();
      const sp = await pkmSpeciesData(nm);
      const ch = sp && sp.evolution_chain ? await (await pkmFetch(sp.evolution_chain.url)).json() : null;
      const node = ch ? pkmFindChainNode(ch.chain, sp.name) : null;
      const opts = node ? node.evolves_to.filter((n) => (n.evolution_details || []).some((d) => d.trigger && d.trigger.name === "use-item" && d.item && d.item.name === stone && pkmEvoGenderOk(d, id))) : [];
      if (!opts.length) return pkmToast(`It won't have any effect on ${pkmCap(nm)}.`);
      const target = pkmPick(opts).species.name;
      setInt(key, getInt(key) - 1);
      await pkmEvolveTo(id, target);
    } catch (e) {
      console.warn(e);
      pkmToast("Couldn't use the stone right now. Try again.");
    }
  }
  {
    const ui = pkmUseItem;
    pkmUseItem = function (kind) {
      if (String(kind).startsWith("stone:")) return pkmUseStone(String(kind).slice(6));
      return ui.apply(this, arguments);
    };
  }

  // ---------- Pokédex: shiny counter + rarest catches ----------
  function pkmDexExtra(el) {
    if (!el) return;
    const party = Object.entries(getObj(STORAGE.party) || {});
    const stats = getObj(STORAGE.stats) || {};
    const dexArr = getArr(STORAGE.pokedex) || [];
    const shinies = party.filter(([, m]) => m.isShiny).length;
    const rank = { mythical: 5, legendary: 4, sublegendary: 3, rare: 2, uncommon: 1, common: 0 };
    const rare = party
      .map(([id, m]) => ({ id, m, r: getRarity(m.name) || "common", lv: (stats[id] && stats[id].level) || 1 }))
      .sort((a, b) => (rank[b.r] || 0) - (rank[a.r] || 0) || (b.m.isShiny ? 1 : 0) - (a.m.isShiny ? 1 : 0) || b.lv - a.lv)
      .slice(0, 6);
    const life = pkmJSON("pkm_progress", {}).shinies || 0;
    el.innerHTML = `<div class="dex-shiny"><div class="dex-shiny-n">✨ ${shinies}</div><div class="pkm-dim">shiny owned${life ? ` · ${life} caught in total` : ""}</div></div>
      <div class="dex-rare"><div class="pkm-dim">Rarest catches</div><div class="dex-rare-list">${rare.length ? rare.map((x) => `<div class="dex-rare-i" title="${pkmEsc(pkmCap(x.m.name))} · ${x.r} · Lv ${Math.min(MAX_LEVEL, x.lv)}">
        <img src="${pkmEsc(pkmMonSprite(x.m, dexArr))}" alt="">${x.m.isShiny ? "<i>✨</i>" : ""}<span class="bag-rar r-${x.r}">${x.r}</span></div>`).join("") : '<span class="pkm-dim">Catch some Pokémon first!</span>'}</div></div>`;
  }

  // ---------- Sounds (synthesized, no downloads) + mute button ----------
  const PKM_SYNTH = {
    buy: [[988, 0.07], [1319, 0.16]],
    level: [[523, 0.09], [659, 0.09], [784, 0.09], [1047, 0.28]],
    heal: [[784, 0.12, "sine"], [988, 0.12, "sine"], [1175, 0.22, "sine"]],
    badge: [[659, 0.1], [784, 0.1], [988, 0.1], [1319, 0.32]],
    daily: [[880, 0.09, "triangle"], [1109, 0.09, "triangle"], [1319, 0.09, "triangle"], [1760, 0.26, "triangle"]],
    evolve: [[392, 0.12], [523, 0.12], [659, 0.12], [784, 0.12], [1047, 0.35]],
    faint: [[392, 0.15, "sawtooth"], [330, 0.15, "sawtooth"], [262, 0.32, "sawtooth"]],
  };
  let pkmAC = null;
  function pkmSynth(kind) {
    if (!getBool(STORAGE.soundOn)) return;
    try {
      pkmAC = pkmAC || new (window.AudioContext || window.webkitAudioContext)();
      const ac = pkmAC;
      if (ac.state === "suspended") ac.resume();
      const vol = parseFloat(getStr(STORAGE.volume, "0.4"));
      let t = ac.currentTime + 0.02;
      for (const [f, d, type] of PKM_SYNTH[kind]) {
        const o = ac.createOscillator();
        const g = ac.createGain();
        o.type = type || "square";
        o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(Math.max(0.001, 0.18 * (isNaN(vol) ? 0.4 : vol)), t + 0.012);
        g.gain.exponentialRampToValueAtTime(0.0001, t + d);
        o.connect(g).connect(ac.destination);
        o.start(t);
        o.stop(t + d + 0.03);
        t += d * 0.92;
      }
    } catch {}
  }
  {
    const ps = playSound;
    playSound = function (key) {
      if (PKM_SYNTH[key]) return pkmSynth(key);
      return ps.apply(this, arguments);
    };
  }
  function pkmUpdateMuteIcon() {
    const b = wrap.querySelector('[data-hud="mute"]');
    if (b) { const on = getBool(STORAGE.soundOn); b.textContent = on ? "🔊" : "🔇"; b.title = on ? "Mute sounds" : "Turn sounds on"; }
  }
  function pkmToggleMute() {
    const on = !getBool(STORAGE.soundOn);
    setBool(STORAGE.soundOn, on);
    if (!on) Object.values(SOUNDS).forEach((a) => { if (a instanceof Audio) a.pause(); });
    else if (battlePanel) { try { SOUNDS.battleSound.play(); } catch {} }
    pkmUpdateMuteIcon();
    pkmToast(on ? "🔊 Sound on" : "🔇 Sound off", 1500);
  }
  {
    const lr = pkmLiveRefresh;
    pkmLiveRefresh = function () { lr(); pkmUpdateMuteIcon(); };
  }
  pkmUpdateMuteIcon();

  // ---------- Partner reactions: hearts, happy jumps, naps ----------
  function pkmReact(kind) {
    const w = spriteWrapperEl;
    if (!w) return;
    const sets = { heart: ["💖", "💗", "💕"], happy: ["✨", "⭐", "🎵"], sad: ["💧"], zzz: ["💤"], wake: ["❗"] };
    const list = sets[kind] || sets.happy;
    const n = kind === "zzz" || kind === "wake" || kind === "sad" ? 1 : 3;
    for (let i = 0; i < n; i++) {
      const s = document.createElement("span");
      s.className = "pkm-react";
      s.textContent = list[i % list.length];
      s.style.left = `${18 + pkmRand(-14, 14)}px`;
      s.style.animationDelay = `${i * 0.18}s`;
      w.appendChild(s);
      setTimeout(() => s.remove(), 2200);
    }
    if (kind === "happy" || kind === "heart") { w.classList.remove("pkm-jump"); void w.offsetWidth; w.classList.add("pkm-jump"); setTimeout(() => w.classList.remove("pkm-jump"), 700); }
  }
  let pkmNapping = false;
  let pkmLastActive = Date.now();
  let pkmZzz = 0;
  function pkmNap() {
    if (!spriteWrapperEl || pkmNapping) return;
    pkmNapping = true;
    spriteWrapperEl.classList.add("pkm-nap");
    pkmReact("zzz");
    pkmZzz = setInterval(() => pkmReact("zzz"), 2600);
  }
  function pkmWake() {
    pkmNapping = false;
    clearInterval(pkmZzz);
    if (spriteWrapperEl) { spriteWrapperEl.classList.remove("pkm-nap"); pkmReact("wake"); }
  }
  ["pointermove", "pointerdown", "keydown", "wheel", "scroll"].forEach((ev) =>
    window.addEventListener(ev, () => { pkmLastActive = Date.now(); if (pkmNapping) pkmWake(); }, { capture: true, passive: true })
  );
  setInterval(() => { if (!pkmNapping && !battlePanel && Date.now() - pkmLastActive > 3 * 60e3) pkmNap(); }, 10000);

  // =====================================================================
  //  3.6: friendship evolutions, daily quests, moves manager, held items
  //  in the Bag, Safari Zone, more achievements
  // =====================================================================

  // ---------- Evolution (level-up, friendship, time of day) ----------
  const PKM_EVO_UNSUPPORTED = ["held_item", "known_move", "known_move_type", "location", "min_affection", "min_beauty", "party_species",
    "party_type", "relative_physical_stats", "needs_overworld_rain", "trade_species", "turn_upside_down", "item"];
  /** PokéAPI evolution gender: 1 = female only (Vespiquen, Froslass), 2 = male only (Gallade, Mothim). */
  function pkmEvoGenderOk(d, id) { if (d.gender == null) return true; const g = pkmGenderOf(id); return d.gender === 1 ? g === "female" : g === "male"; }
  async function pkmEvolveTo(id, target) {
    const party = getObj(STORAGE.party) || {};
    const mon = party[id];
    if (!mon) return;
    const from = pkmCap(mon.name);
    party[id].name = target;
    party[id].spriteUrl = null;
    setObj(STORAGE.party, party);
    if (id === GM_getValue("pkm_starter_id")) setStr(STORAGE.starter, target);
    const all = getObj(STORAGE.stats) || {};
    if (all[id]) { delete all[id].ability; setObj(STORAGE.stats, all); }
    pkmOnEvolve();
    pkmToast(`✨ What? ${from} is evolving! … ${from} evolved into ${pkmCap(target)}!`, 5000);
    if (id === GM_getValue("pkm_starter_id")) await fetchPartner(id);
    else await pkmSyncStats(id, target);
    if (bagPanel) drawBag();
  }
  async function pkmEvolveCheck() {
    const id = GM_getValue("pkm_starter_id");
    const mon = (getObj(STORAGE.party) || {})[id];
    if (!mon) return;
    const s = (getObj(STORAGE.stats) || {})[id] || {};
    try {
      const sp = await pkmSpeciesData(String(mon.name).toLowerCase());
      if (!sp || !sp.evolution_chain) return;
      const ch = await (await pkmFetch(sp.evolution_chain.url)).json();
      const node = pkmFindChainNode(ch.chain, sp.name);
      if (!node) return;
      const h = new Date().getHours();
      const tod = h >= 6 && h < 18 ? "day" : "night";
      const ok = (d) =>
        d.trigger && d.trigger.name === "level-up" && (d.min_level != null || d.min_happiness != null) &&
        !PKM_EVO_UNSUPPORTED.some((k) => d[k] != null && d[k] !== false && d[k] !== "") &&
        (d.min_level == null || (s.level || 1) >= d.min_level) &&
        (d.min_happiness == null || (s.friendship == null ? 70 : s.friendship) >= d.min_happiness) &&
        (!d.time_of_day || d.time_of_day === tod) &&
        pkmEvoGenderOk(d, id);
      const next = (node.evolves_to || []).find((n) => (n.evolution_details || []).some(ok));
      if (next) await pkmEvolveTo(id, next.species.name);
    } catch (e) {
      console.warn("Evolution check failed:", e);
    }
  }
  evolvePartner = pkmEvolveCheck;
  // Friendship grows while your partner walks with you (every 2 minutes on a visible tab)
  setInterval(() => { if (spriteWrapperEl && !document.hidden && !pkmNapping) pkmFriend(GM_getValue("pkm_starter_id"), 1); }, 120000);

  // ---------- Daily quests ----------
  const PKM_QUEST_T = [
    { id: "win", ev: "win", n: 3, text: () => "Win 3 battles" },
    { id: "winType", ev: "winType", n: 2, typed: "move", text: (t) => `Win 2 battles finishing with a ${pkmCap(t)} move` },
    { id: "catch", ev: "catch", n: 2, text: () => "Catch 2 Pokémon" },
    { id: "catchType", ev: "catchType", n: 1, typed: "any", text: (t) => `Catch a ${pkmCap(t)}-type Pokémon` },
    { id: "trainer", ev: "trainer", n: 1, text: () => "Beat a trainer" },
    { id: "super", ev: "super", n: 4, text: () => "Land 4 super-effective hits" },
    { id: "potion", ev: "potion", n: 2, text: () => "Use 2 Potions" },
    { id: "stop", ev: "stop", n: 2, text: () => "Visit a PokéStop twice" },
    { id: "coins", ev: "coins", n: 500, text: () => "Earn 500 coins" },
    { id: "switch", ev: "switch", n: 2, text: () => "Switch Pokémon 2 times in battle" },
  ];
  const PKM_QUEST_REWARDS = [[200, STORAGE.greatBalls, 2, "Great Balls"], [250, STORAGE.potions, 3, "Potions"], [300, STORAGE.ultraBalls, 1, "Ultra Ball"],
    [350, "pkm_revive", 1, "Revive"], [250, "pkm_item_oran-berry", 2, "Oran Berries"], [300, "pkm_xattack", 2, "X Attacks"]];
  function pkmQuests() {
    let q = pkmJSON("pkm_quests", null);
    if (!q || q.day !== pkmDay(0) || !Array.isArray(q.list)) {
      const myTypes = (activeStats().types || ["normal"]).filter(Boolean);
      const picks = PKM_QUEST_T.slice().sort(() => Math.random() - 0.5).slice(0, 3);
      q = { day: pkmDay(0), bonus: false, list: picks.map((t) => {
        const type = t.typed === "move" ? pkmPick(myTypes.length ? myTypes : ["normal"]) : t.typed === "any" ? pkmPick(["water", "fire", "grass", "bug", "normal", "flying", "poison", "electric"]) : null;
        return { id: t.id, ev: t.ev, n: t.n, have: 0, type, text: t.text(type), reward: pkmPick(PKM_QUEST_REWARDS), done: false };
      }) };
      pkmSave("pkm_quests", q);
    }
    return q;
  }
  function pkmQuest(ev, amount = 1, data = {}) {
    try {
      const q = pkmQuests();
      let changed = false;
      for (const it of q.list) {
        if (it.done || it.ev !== ev) continue;
        if (ev === "winType" && data.type !== it.type) continue;
        if (ev === "catchType" && !(data.types || []).includes(it.type)) continue;
        it.have = Math.min(it.n, it.have + amount);
        changed = true;
        if (it.have >= it.n) {
          it.done = true;
          const [c, key, n, label] = it.reward;
          setInt(STORAGE.coins, getInt(STORAGE.coins) + c);
          setInt(key, getInt(key) + n);
          setTimeout(() => { playSound("badge"); pkmToast(`📋 Quest done: ${it.text}! +${c} coins, ${n} × ${label}`, 4500); }, 400);
          setTimeout(() => pkmTrack("quests"), 0);
        }
      }
      if (changed && !q.bonus && q.list.every((x) => x.done)) {
        q.bonus = true;
        setInt(STORAGE.coins, getInt(STORAGE.coins) + 500);
        setInt(STORAGE.ultraBalls, getInt(STORAGE.ultraBalls) + 2);
        setTimeout(() => { playSound("daily"); pkmToast("🎁 All daily quests done! Bonus: +500 coins and 2 Ultra Balls", 5000); }, 2500);
      }
      if (changed) pkmSave("pkm_quests", q);
    } catch (e) {
      console.warn("Quest update failed:", e);
    }
  }

  // ---------- Bag: nature, ability, friendship, held item, moves ----------
  function pkmBagTraits(id, mon, st) {
    const nat = PKM_NATURES[st.nature];
    const natTxt = st.nature ? `${pkmCap(st.nature)}${nat && nat.length ? ` (+${PKM_STAT_LABEL[nat[0]]} −${PKM_STAT_LABEL[nat[1]]})` : ""}` : "—";
    const f = st.friendship == null ? 70 : st.friendship;
    const hearts = Math.max(0, Math.min(5, Math.round(f / 51)));
    const held = mon.held ? PKM_ITEMS.find((i) => i.img === mon.held) : null;
    const owned = PKM_ITEMS.filter((i) => i.cat === "held" && getInt(i.key) > 0);
    return `<div class="bag-traits"><span title="Nature">🌿 ${natTxt}</span><span title="${pkmEsc(PKM_ABILITY_INFO[st.ability] || "Ability")}">✴️ ${st.ability ? pkmCap(st.ability) : "—"}</span>
        <span title="Friendship ${f}/255">${"❤️".repeat(hearts)}${"🤍".repeat(5 - hearts)}</span>${mon.costume ? `<span>${mon.costume} Costume</span>` : ""}</div>
      <div class="bag-held-row">${held ? `<img src="${PKM_ITEM_IMG}${held.img}.png" alt=""> Holding <b>${pkmEsc(held.name)}</b><button type="button" class="pkm-btn2" data-a="take">Take</button>`
        : owned.length ? `<select class="bag-give-sel" aria-label="Item to give">${owned.map((i) => `<option value="${i.img}">${pkmEsc(i.name)} (×${getInt(i.key)})</option>`).join("")}</select><button type="button" class="pkm-btn2" data-a="give">Give</button>`
        : `<span class="pkm-dim">No held item. Buy one in the PokéMart → Held items.</span>`}</div>`;
  }
  {
    const ba = pkmBagAction;
    pkmBagAction = function (a, btn, box) {
      if (a === "moves" || a === "give" || a === "take") {
        const id = pkmBag.sel;
        const party = getObj(STORAGE.party) || {};
        if (!id || !party[id]) return;
        if (a === "moves") return pkmOpenMoves(id);
        if (a === "give") {
          const img = bagPanel.querySelector(".bag-give-sel")?.value;
          const it = PKM_ITEMS.find((i) => i.img === img);
          if (!it || getInt(it.key) <= 0) return;
          if (party[id].held) setInt(`pkm_item_${party[id].held}`, getInt(`pkm_item_${party[id].held}`) + 1);
          setInt(it.key, getInt(it.key) - 1);
          party[id].held = img;
          setObj(STORAGE.party, party);
          pkmToast(`🎁 ${pkmCap(party[id].name)} is now holding ${it.name}`);
        } else {
          const img = party[id].held;
          if (img) setInt(`pkm_item_${img}`, getInt(`pkm_item_${img}`) + 1);
          party[id].held = null;
          setObj(STORAGE.party, party);
          pkmToast("Item returned to the Bag");
        }
        return drawBag();
      }
      return ba.apply(this, arguments);
    };
  }

  let pkmMovesPanel = null;
  function pkmCloseMoves() { if (pkmMovesPanel) pkmMovesPanel.remove(); pkmMovesPanel = null; }
  async function pkmOpenMoves(id, pickIdx = -1) {
    const party = getObj(STORAGE.party) || {};
    const pm = party[id];
    if (!pm) return;
    if (!pkmMovesPanel) {
      pkmMovesPanel = document.createElement("div");
      pkmMovesPanel.className = "pkm-panel pkm-modal pkm-set pkm-moves";
      pkmMovesPanel.setAttribute("role", "dialog");
      pkmMovesPanel.setAttribute("aria-label", "Moves");
      pkmMovesPanel.innerHTML = `<div class="pkb-loading">Loading moves…</div>`;
      pkmMount(pkmMovesPanel);
    }
    const P = pkmMovesPanel;
    await pkmSyncStats(id, pm.name);
    const all = getObj(STORAGE.stats) || {};
    const s = all[id] || {};
    const d = await pkmPokemonData(pm.name);
    if (!d || !pkmMovesPanel) return;
    if (!Array.isArray(s.moves) || !s.moves.length) {
      s.moves = (await pkmPickMoves(d, s.level || 1)).map((m) => m.name);
      s.movesLv = s.level || 1;
      all[id] = s;
      setObj(STORAGE.stats, all);
    }
    const cur = await pkmMovesByNames(s.moves);
    const learnable = (await pkmMovesByNames([...new Set((d._lv || []).filter(([, l]) => l <= (s.level || 1)).map(([n]) => n))].filter((n) => !s.moves.includes(n))))
      .sort((a, b) => b.power - a.power);
    const pending = s.movesPending || [];
    const row = (m, extra) => `<span class="pk-type ${m.type}">${m.type}</span><b>${pkmEsc(m.display)}</b><span class="pkm-dim">${m.cls === "status" ? "◌ Status" : `${m.cls === "special" ? "✦ Special" : "✊ Physical"} · ${m.fixed ? "fixed" : m.power} pow`} · ${m.acc || "—"}% · PP ${m.maxPP}</span>${extra || ""}`;
    P.innerHTML = `
      <div class="pkm-set-head mv-head"><span>📜 ${pkmEsc(pkmCap(pm.name))}'s moves</span><button type="button" class="pkm-x" data-a="close" aria-label="Close" title="Close (Esc)">✕</button></div>
      <div class="mv-body">
        <div class="mv-col"><div class="bag-sec"><span>Current moves</span><span class="pkm-dim">${cur.length}/4</span></div>
          ${cur.map((m, i) => `<div class="mv-row${i === pickIdx ? " sel" : ""}" data-pick="${i}" tabindex="0" role="button" aria-label="Select ${pkmEsc(m.display)} to replace">${row(m)}
            <button type="button" class="pkm-btn2" data-forget="${i}" ${cur.length <= 1 ? "disabled" : ""}>Forget</button></div>`).join("")}
          <div class="pkm-dim" style="margin-top:6px">${cur.length >= 4 ? (pickIdx >= 0 ? `Pick a move on the right to replace <b>${pkmEsc(cur[pickIdx].display)}</b>.` : "Click a current move first, then pick a new one to replace it.") : "You have a free slot: pick any move on the right."}</div>
        </div>
        <div class="mv-col"><div class="bag-sec"><span>Can learn (Lv ${s.level || 1})</span><span class="pkm-dim">${learnable.length}</span></div>
          <div class="mv-list">${learnable.length ? learnable.map((m) => `<div class="mv-row">${row(m, pending.includes(m.name) ? ' <b class="bag-new">NEW</b>' : "")}
            <button type="button" class="pkm-btn2 primary" data-learn="${pkmEsc(m.name)}" ${cur.length >= 4 && pickIdx < 0 ? "disabled" : ""}>${cur.length < 4 ? "Learn" : "Replace"}</button></div>`).join("")
            : '<div class="pkm-dim">No other moves yet. Level up to learn more!</div>'}</div>
        </div>
      </div>`;
    const save = (names) => {
      const a2 = getObj(STORAGE.stats) || {};
      const s2 = a2[id] || {};
      s2.moves = names;
      s2.movesPending = (s2.movesPending || []).filter((n) => !names.includes(n));
      a2[id] = s2;
      setObj(STORAGE.stats, a2);
    };
    P.onclick = (e) => {
      if (e.target.closest("[data-a='close']")) return pkmCloseMoves();
      const fg = e.target.closest("[data-forget]");
      if (fg && !fg.disabled) { const n = s.moves.slice(); const [x] = n.splice(+fg.dataset.forget, 1); save(n); pkmToast(`${pkmCap(pm.name)} forgot ${pkmCap(x)}.`); return pkmOpenMoves(id); }
      const ln = e.target.closest("[data-learn]");
      if (ln && !ln.disabled) {
        const n = s.moves.slice();
        const nm = ln.dataset.learn;
        let msg;
        if (n.length < 4) { n.push(nm); msg = `${pkmCap(pm.name)} learned ${pkmCap(nm)}!`; }
        else { msg = `${pkmCap(pm.name)} forgot ${pkmCap(n[pickIdx])} and learned ${pkmCap(nm)}!`; n[pickIdx] = nm; }
        save(n);
        playSound("level");
        pkmToast(msg);
        return pkmOpenMoves(id);
      }
      const pk = e.target.closest("[data-pick]");
      if (pk) return pkmOpenMoves(id, +pk.dataset.pick === pickIdx ? -1 : +pk.dataset.pick);
    };
    P.onkeydown = (e) => { const pk = e.target.closest && e.target.closest("[data-pick]"); if (pk && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); pk.click(); } };
    if (bagPanel) drawBag();
  }

  // ---------- Safari Zone ----------
  const PKM_SAFARI_POOL = ["chansey", "kangaskhan", "tauros", "scyther", "pinsir", "dratini", "exeggcute", "rhyhorn", "nidoran-f", "nidoran-m", "venomoth",
    "doduo", "paras", "eevee", "larvitar", "bagon", "beldum", "gible", "riolu", "axew", "deino", "lapras", "snorlax", "porygon", "togepi", "miltank",
    "heracross", "skarmory", "absol", "feebas", "shinx", "zorua", "litleo", "goomy", "jangmo-o", "ralts", "trapinch", "bulbasaur", "charmander", "squirtle"];
  const PKM_SAFARI_LEGENDS = ["articuno", "zapdos", "moltres", "raikou", "entei", "suicune"];
  function pkmSafariCost() { try { return (pkmCurrentEvent() || {}).id === "summer" ? 250 : 500; } catch { return 500; } }
  let pkmSafari = null;
  let pkmSafariPanel = null;
  function pkmCloseSafari() {
    if (pkmSafari) pkmEndSafari("You left the Safari Zone.");
    if (pkmSafariPanel) pkmSafariPanel.remove();
    pkmSafariPanel = null;
  }
  function pkmEndSafari(reason) {
    const s = pkmSafari;
    if (!s) return;
    clearInterval(s.timer);
    pkmSafari = null;
    pkmSave("pkm_safari_last", { t: Date.now(), caught: s.caught });
    pkmToast(`🌴 ${reason} You caught ${s.caught.length} Pokémon${s.caught.length ? `: ${s.caught.map(pkmCap).join(", ")}` : ""}.`, 5000);
    if (pkmSafariPanel) pkmDrawSafari(reason);
  }
  function pkmOpenSafari() {
    if (!pkmSafariPanel) {
      pkmSafariPanel = document.createElement("div");
      pkmSafariPanel.className = "pkm-panel pkm-modal pkm-set pkm-safari";
      pkmSafariPanel.setAttribute("role", "dialog");
      pkmSafariPanel.setAttribute("aria-label", "Safari Zone");
      pkmMount(pkmSafariPanel);
    }
    pkmDrawSafari();
  }
  function pkmDrawSafari(msg) {
    const P = pkmSafariPanel;
    if (!P) return;
    const s = pkmSafari;
    const cost = pkmSafariCost();
    let body;
    if (!s) {
      const last = pkmJSON("pkm_safari_last", null);
      body = `<div class="sf-intro"><div class="sf-big">🌴🦒🌿</div>
        <p>Walk through the tall grass and meet rare Pokémon. You can't battle here: throw <b>bait</b> to make them calmer (harder to catch, less likely to flee) or a <b>rock</b> to make them easier to catch (but more likely to run).</p>
        <p class="pkm-dim">10 minutes · 30 Safari Balls · shiny odds ×2 · ${cost === 250 ? "☀️ Summer price!" : ""} Entry: 💰 ${cost}</p>
        ${last ? `<p class="pkm-dim">Last visit: caught ${last.caught.length}${last.caught.length ? ` (${last.caught.map(pkmCap).join(", ")})` : ""}.</p>` : ""}
        <div class="pkm-btns" style="justify-content:center"><button type="button" class="pkm-btn2 primary" data-sf="enter" ${getInt(STORAGE.coins) < cost ? "disabled" : ""}>Enter (💰 ${cost})</button></div></div>`;
    } else {
      const left = Math.max(0, s.ends - Date.now());
      const e = s.enc;
      const catchP = e ? Math.min(1, Math.pow(Math.max(1, ((e.mon.captureRate || 45) * 1.5 * e.catchMod) / 3) / 255, 0.75)) : 0;
      body = `<div class="sf-bar"><span>⏱ <b class="sf-time">${Math.floor(left / 60000)}:${String(Math.floor((left % 60000) / 1000)).padStart(2, "0")}</b></span><span>🟢 Safari Balls <b>${s.balls}</b></span><span>⭕ Caught <b>${s.caught.length}</b></span></div>
        <div class="pkb-field sf-field">${e ? `<div class="sf-enc"><div class="pkb-info"><div class="pkb-name">${e.mon.shiny ? "✨ " : ""}${pkmEsc(e.mon.display)} <span>Lv ${e.mon.level}</span></div><div class="pkb-types">${e.mon.types.map((t) => `<span class="pk-type ${t}">${t}</span>`).join("")}</div>
          <div class="pkm-dim" style="color:#333">Catch ≈ ${Math.round(catchP * 100)}% · Flee ≈ ${Math.round(Math.min(0.9, e.flee * e.fleeMod) * 100)}%${e.mood ? ` · ${e.mood}` : ""}</div></div>
          <div class="pkb-spr"><img class="pkb-sprite foe" src="${pkmEsc(e.mon.front)}" alt="${pkmEsc(e.mon.display)}"></div></div>` : `<div class="sf-grass">🌿🌿🌿🌿🌿</div>`}</div>
        <div class="pkb-msg" aria-live="polite">${pkmEsc(msg || (e ? `What will you do?` : "The grass rustles…"))}</div>
        <div class="pk-controls pkb-controls sf-ctl">${e
          ? `<button type="button" class="pk-btn pkb-act" data-sf="ball" ${s.busy ? "disabled" : ""}><div class="pk-ico">🟢</div><div class="pk-label">Safari Ball</div><div class="pk-badge">${s.balls}</div></button>
             <button type="button" class="pk-btn pkb-act" data-sf="bait" ${s.busy ? "disabled" : ""}><div class="pk-ico">🍓</div><div class="pk-label">Bait</div></button>
             <button type="button" class="pk-btn pkb-act" data-sf="rock" ${s.busy ? "disabled" : ""}><div class="pk-ico">🪨</div><div class="pk-label">Rock</div></button>
             <button type="button" class="pk-btn pkb-act" data-sf="run" ${s.busy ? "disabled" : ""}><div class="pk-ico">🏃</div><div class="pk-label">Run</div></button>`
          : `<button type="button" class="pk-btn pkb-act sf-walk" data-sf="walk" ${s.busy ? "disabled" : ""}><div class="pk-ico">👣</div><div class="pk-label">Walk into the tall grass</div></button>
             <button type="button" class="pk-btn pkb-act" data-sf="leave"><div class="pk-ico">🚪</div><div class="pk-label">Leave</div></button>`}</div>`;
    }
    P.innerHTML = `<div class="pkm-set-head sf-head"><span>🌴 Safari Zone</span><button type="button" class="pkm-x" data-sf="close" aria-label="Close" title="Close (Esc)">✕</button></div><div class="sf-body">${body}</div>`;
    P.onclick = (ev) => { const b = ev.target.closest("[data-sf]"); if (b && !b.disabled) pkmSafariAct(b.dataset.sf); };
    pkmBattleKeys(P.querySelector(".pk-controls") || document.createElement("div"));
  }
  async function pkmSafariAct(a) {
    if (a === "close") return pkmCloseSafari();
    if (a === "enter") {
      const cost = pkmSafariCost();
      if (getInt(STORAGE.coins) < cost) return pkmToast(`You need ${cost} coins to enter.`);
      setInt(STORAGE.coins, getInt(STORAGE.coins) - cost);
      pkmSafari = { ends: Date.now() + 10 * 60e3, balls: 30, caught: [], enc: null, busy: false };
      pkmSafari.timer = setInterval(() => {
        if (!pkmSafari) return;
        if (Date.now() >= pkmSafari.ends) return pkmEndSafari("PA: Ding-dong! Time's up!");
        const t = pkmSafariPanel && pkmSafariPanel.querySelector(".sf-time");
        if (t) { const left = pkmSafari.ends - Date.now(); t.textContent = `${Math.floor(left / 60000)}:${String(Math.floor((left % 60000) / 1000)).padStart(2, "0")}`; }
      }, 1000);
      return pkmDrawSafari("Welcome to the Safari Zone! Good luck!");
    }
    const s = pkmSafari;
    if (!s || s.busy) return;
    if (a === "leave") return pkmEndSafari("You left the Safari Zone.");
    const wait = (ms) => pkmWait(ms);
    if (a === "walk") {
      s.busy = true;
      pkmDrawSafari("You walk into the tall grass…");
      try {
        const legend = Math.random() < 0.02;
        const sp = legend ? pkmPick(PKM_SAFARI_LEGENDS) : (pkmSafariOutbreakPick() || pkmPick(PKM_SAFARI_POOL));
        const L = pkmSafariBase();
        const mon = await pkmBuildMon(sp, Math.max(5, Math.min(MAX_LEVEL, L + pkmRand(-3, 3))), { shinyMult: 2 });
        if (!mon) throw new Error("no data");
        const spd = await pkmSpeciesData(sp);
        mon.captureRate = spd && spd.capture_rate != null ? spd.capture_rate : 45;
        const r = getRarity(mon.name);
        s.enc = { mon, catchMod: 1, fleeMod: 1, flee: legend ? 0.35 : ["rare", "sublegendary", "legendary"].includes(r) ? 0.2 : 0.1, mood: "" };
        s.busy = false;
        playSound("ball");
        return pkmDrawSafari(`A wild ${mon.shiny ? "✨ shiny " : ""}${mon.display} appeared!`);
      } catch {
        s.busy = false;
        return pkmDrawSafari("Nothing here… try again.");
      }
    }
    const e = s.enc;
    if (!e) return;
    const fleeCheck = async () => {
      if (Math.random() < Math.min(0.9, e.flee * e.fleeMod)) { s.enc = null; s.busy = false; pkmDrawSafari(`${e.mon.display} fled!`); return true; }
      return false;
    };
    s.busy = true;
    if (a === "run") { s.enc = null; s.busy = false; return pkmDrawSafari("You got away safely."); }
    if (a === "bait") {
      e.catchMod = Math.max(0.25, e.catchMod * 0.5); e.fleeMod = Math.max(0.25, e.fleeMod * 0.5); e.mood = "🍓 eating";
      pkmDrawSafari(`You threw some bait. ${e.mon.display} is eating!`); await wait(900);
      if (!(await fleeCheck())) { s.busy = false; pkmDrawSafari(); }
      return;
    }
    if (a === "rock") {
      e.catchMod = Math.min(4, e.catchMod * 2); e.fleeMod = Math.min(4, e.fleeMod * 2); e.mood = "😠 angry";
      pkmDrawSafari(`You threw a rock. ${e.mon.display} is angry!`); await wait(900);
      if (!(await fleeCheck())) { s.busy = false; pkmDrawSafari(); }
      return;
    }
    if (a === "ball") {
      s.balls--;
      playSound("ball");
      const p = Math.min(1, Math.pow(Math.max(1, ((e.mon.captureRate || 45) * 1.5 * e.catchMod) / 3) / 255, 0.75));
      const shake = Math.pow(p, 1 / 3);
      pkmDrawSafari("You threw a Safari Ball!"); await wait(650);
      let caught = true;
      for (let i = 0; i < 3; i++) {
        if (Math.random() >= shake) { caught = false; pkmDrawSafari(["Oh no! The Pokémon broke free!", "Aww! It appeared to be caught!", "Aargh! Almost had it!"][i]); await wait(900); break; }
        pkmDrawSafari(["The ball wobbles…", "The ball wobbles… wobbles…", "The ball wobbles… wobbles… wobbles…"][i]); await wait(500);
      }
      if (caught) {
        playSound("catch");
        pkmStoreCaught(e.mon, "safari");
        s.caught.push(e.mon.name);
        s.enc = null;
        s.busy = false;
        pkmDrawSafari(`Gotcha! ${e.mon.display} was caught!${e.mon.shiny ? " ✨ It's shiny!" : ""}`);
      } else if (!(await fleeCheck())) { s.busy = false; pkmDrawSafari(); }
      if (pkmSafari && pkmSafari.balls <= 0) pkmEndSafari("You're out of Safari Balls!");
    }
  }

  // ---------- More achievements ----------
  PKM_ACH.push(
    ["champion", "🏆", "Champion", "Beat the Elite Four and the Champion", (p) => p.champion || 0, 1],
    ["safari5", "🌴", "Safari ranger", "Catch 5 Pokémon in the Safari Zone", (p) => p.safariCaught || 0, 5],
    ["friend", "💞", "Best friends", "Max out a Pokémon's friendship", (p) => p._maxFriend, 255],
    ["quests10", "📋", "Quest hunter", "Finish 10 daily quests", (p) => p.quests || 0, 10],
    ["chain20", "🔗", "Chain master", "Reach a shiny chain of 20", (p) => p.maxChain || 0, 20]
  );
  {
    const pv0 = pkmProgressView;
    pkmProgressView = function () {
      const p = pv0();
      const stats = getObj(STORAGE.stats) || {};
      p._maxFriend = Math.max(0, ...Object.keys(getObj(STORAGE.party) || {}).map((id) => (stats[id] && stats[id].friendship) || 0));
      return p;
    };
  }
  PKM_PANELS.unshift(["moves", () => pkmMovesPanel, () => pkmCloseMoves()]);
  PKM_PANELS.push(["safari", () => pkmSafariPanel, () => pkmCloseSafari()]);
  pkmOpenSafari = pkmExclusive("safari", pkmOpenSafari);

  pkmStyle(`
    /* Battle v3 additions */
    .pkb-spr{position:relative}
    .pkb-costume{position:absolute;left:50%;top:-6px;transform:translateX(-50%);font-size:30px;pointer-events:none;filter:drop-shadow(0 2px 2px rgba(0,0,0,.3))}
    .pkb-ab{font-size:9.5px;font-weight:700;padding:0 6px;border-radius:999px;background:#e9e3ff;color:#4b3a8a;margin-left:2px}
    .pkb-stage{font-size:9.5px;font-weight:800;padding:0 5px;border-radius:999px;margin-left:2px}
    .pkb-stage.up{background:#d9f7e3;color:#167a3e}.pkb-stage.down{background:#ffe0dc;color:#b3261e}
    .pkb-held{width:18px;height:18px;image-rendering:pixelated}
    .pkb-hpnum{display:flex;justify-content:space-between;align-items:center}
    .pkb-mine{display:flex;gap:3px}
    .pkb-mine span{width:10px;height:10px;border-radius:50%;background:linear-gradient(#e3350d 0 44%,#222 44% 56%,#f5f5f5 56%);border:1px solid #222}
    .pkb-mine span.out{filter:grayscale(1) brightness(.45)}
    .pkb-mine span.cur{box-shadow:0 0 0 2px #3c9cff}
    .pk-controls.pkb-switching{grid-template-columns:repeat(3,minmax(0,1fr))!important}
    .pkb-sw{display:grid!important;grid-template-columns:40px 1fr;grid-template-rows:auto auto auto;gap:0 8px;text-align:left!important;padding:6px 8px!important;align-items:center}
    .pkb-sw img{grid-row:1/4;width:40px;height:40px;object-fit:contain;image-rendering:pixelated}
    .pkb-sw .pk-label{font-weight:800;font-size:12.5px}
    .pkb-sw-sub{font-size:10.5px;opacity:.8}
    .pkb-hp.mini{height:5px;margin-top:3px}
    .pkm-costume{position:absolute;left:50%;top:6px;transform:translateX(-50%);font-size:22px;pointer-events:none}
    .pkm-chip.pkm-ev-chip{background:rgba(255,140,0,.2);border-color:rgba(255,140,0,.5)}
    /* Bag additions */
    .bag-costume{position:absolute;top:2px;left:50%;transform:translateX(-50%);font-size:18px}
    .bag-heldi{position:absolute;bottom:20px;right:6px;width:18px;height:18px;image-rendering:pixelated}
    .bag-traits{display:flex;gap:8px;flex-wrap:wrap;font-size:12px}
    .bag-held-row{display:flex;gap:8px;align-items:center;font-size:12.5px}
    .bag-held-row img{width:24px;height:24px;image-rendering:pixelated}
    .bag-held-row select{background:#0f1220;color:#e8eaf6;border:1px solid #2c3350;border-radius:8px;padding:4px 8px}
    .bag-new{background:#ff4d4f;color:#fff;border-radius:999px;padding:0 6px;font-size:10px}
    /* Moves manager */
    .pkm-set.pkm-moves{width:min(820px,96vw);z-index:11700}
    .mv-head{background:linear-gradient(90deg,#2b8a6e,#1d5e4b)!important}
    .mv-body{display:grid;grid-template-columns:1fr 1fr;gap:14px;padding:12px 16px 16px}
    .mv-list{max-height:52vh;overflow:auto;display:grid;gap:6px}
    .mv-row{display:grid;grid-template-columns:auto 1fr auto;grid-template-rows:auto auto;gap:2px 8px;align-items:center;padding:8px 10px;border-radius:10px;background:#1b1f33;border:1px solid #2c3350;margin-bottom:6px}
    .mv-row .pkm-dim{grid-column:2/3;font-size:11px}
    .mv-row .pkm-btn2{grid-row:1/3;grid-column:3}
    .mv-row[data-pick]{cursor:pointer}
    .mv-row.sel{border-color:#ffcb05;box-shadow:0 0 0 2px rgba(255,203,5,.35)}
    @media (max-width:640px){.mv-body{grid-template-columns:1fr}}
    /* Trainers additions */
    .tr-cards{display:grid;grid-template-columns:1fr 1fr;gap:0;margin:0}
    .tr-cards .tr-random{margin:12px 8px 12px 16px}
    .tr-cards .tr-random.tr-safari{margin:12px 16px 12px 8px;background:linear-gradient(135deg,#1f4a2c,#18301f);border-color:#3d7a4e}
    .tr-league{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px;padding:8px 16px 10px}
    .tr-league.locked{opacity:.4;filter:grayscale(.6)}
    .tr-lg{display:grid;justify-items:center;align-content:start;gap:2px;padding:8px;border-radius:12px;background:#1b1f33;border:1px solid #2c3350;text-align:center}
    .tr-lg.done{border-color:#2fbf71;background:linear-gradient(180deg,rgba(47,191,113,.18),#1b1f33)}
    .tr-lg.next{border-color:#ffcb05;box-shadow:0 0 0 2px rgba(255,203,5,.3)}
    .tr-lg .tr-img{width:56px;height:56px}
    @media (max-width:640px){.tr-cards{grid-template-columns:1fr}.tr-league{grid-template-columns:repeat(3,minmax(0,1fr))}}
    /* Hall of Fame */
    .bc-hof{display:grid;gap:10px}
    .bc-hof-e{padding:10px 12px;border-radius:14px;background:linear-gradient(180deg,#3a2f12,#221b0b);border:1px solid #8a6d1c}
    .bc-hof-h{display:flex;justify-content:space-between;margin-bottom:6px}
    .bc-hof-team{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:6px}
    .bc-hof-team div{position:relative;display:grid;justify-items:center;font-size:11px;text-align:center}
    .bc-hof-team img{width:48px;height:48px;object-fit:contain;image-rendering:pixelated}
    .bc-hof-team i{position:absolute;top:0;right:6px;font-style:normal}
    /* Safari */
    .pkm-set.pkm-safari{width:min(560px,96vw)}
    .sf-head{background:linear-gradient(90deg,#2e8b3a,#1d5c25)!important}
    .sf-body{padding:12px 14px 14px}
    .sf-intro{text-align:center;line-height:1.45}
    .sf-big{font-size:40px;margin:6px 0}
    .sf-bar{display:flex;justify-content:space-between;gap:8px;margin-bottom:8px;font-size:13px}
    .sf-field{min-height:180px;align-content:center}
    .sf-enc{display:flex;align-items:center;justify-content:space-between;gap:10px}
    .sf-grass{text-align:center;font-size:42px;letter-spacing:4px;animation:bobWalk 1.6s infinite}
    .pk-controls.sf-ctl{grid-template-columns:repeat(4,minmax(0,1fr))!important}
    .sf-walk{grid-column:span 3}
  `, "pkm-v36");
  // =====================================================================
  //  3.7 features: Battle Tower, Rival, Legendary hunt, Daycare + Eggs,
  //  Link (friend battles, trades), Mystery Gifts, Pokédex rewards
  // =====================================================================
  /** Highest level among the six Pokémon in your party. */
  function pkmTopLevel() {
    const party = getObj(STORAGE.party) || {};
    const st = getObj(STORAGE.stats) || {};
    return Math.max(1, ...Object.keys(party).slice(0, PKM_PARTY_SIZE).map((id) => Math.min(MAX_LEVEL, (st[id] || {}).level || 1)));
  }
  const pkmClamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
  /** Add rewards: [[storageKey, amount, label], ...] */
  function pkmGive(items) { for (const [k, n] of items) setInt(k, getInt(k) + n); }
  const pkmItemsText = (items) => items.map(([, n, label]) => `${n} × ${label}`).join(", ");
  const pkmDexCount = () => new Set((getArr(STORAGE.pokedex) || []).map((e) => e.id)).size;
  const pkmRandomStone = () => `pkm_item_${pkmPick(PKM_STONES)}`;
  const pkmRandomHeld = () => pkmPick(PKM_ITEMS.filter((i) => i.cat === "held"));
  // Small string hash + packed share codes (team codes, trade codes, gift codes)
  function pkmHash(str, seed = 0) {
    let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
    for (let i = 0, ch; i < str.length; i++) { ch = str.charCodeAt(i); h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677); }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return 4294967296 * (2097151 & h2) + (h1 >>> 0);
  }
  function pkmPack(kind, obj) {
    const bytes = new TextEncoder().encode(JSON.stringify(obj));
    let bin = "";
    bytes.forEach((c) => (bin += String.fromCharCode(c)));
    const b64 = btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    return `${kind}.${b64}.${pkmHash(`${kind}.${b64}`, 11).toString(36).slice(-8)}`;
  }
  /** Returns the object inside a share code, or null when the code is damaged or of another kind. */
  function pkmUnpack(kind, code) {
    try {
      const parts = String(code || "").trim().split(".");
      if (parts.length !== 3 || parts[0] !== kind || parts[1].length > 8000) return null;
      if (pkmHash(`${parts[0]}.${parts[1]}`, 11).toString(36).slice(-8) !== parts[2]) return null;
      const bin = atob(parts[1].replace(/-/g, "+").replace(/_/g, "/"));
      const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
      const o = JSON.parse(new TextDecoder().decode(bytes));
      return o && typeof o === "object" ? o : null;
    } catch { return null; }
  }
  const pkmSafeName = (s, n = 14) => String(s || "").replace(/[^A-Za-z0-9 ]/g, "").trim().slice(0, n);
  const pkmSafeSlug = (s) => (/^[a-z0-9-]{2,32}$/.test(String(s)) ? String(s) : null);

  // ---------- Battle Tower: win streaks, a tougher boss every 7th battle ----------
  const pkmTower = () => Object.assign({ streak: 0, best: 0, active: false, wins: 0 }, pkmJSON("pkm_tower", {}));
  const PKM_LEGEND_IDS = (() => { const s = new Set(); for (const [a, b] of [[144, 146], [150, 151], [243, 251], [377, 386], [480, 494], [638, 649]]) for (let i = a; i <= b; i++) s.add(i); return s; })();
  const PKM_TOWER_BOSSES = [["Palmer", "palmer"], ["Brandon", "brandon"], ["Tucker", "tucker"], ["Anabel", "anabel"], ["Greta", "greta"], ["Lucy", "lucy"], ["Spenser", "spenser"], ["Noland", "noland"], ["Thorton", "thorton"]];
  const PKM_TOWER_ITEMS = ["leftovers", "sitrus-berry", "lum-berry", "focus-sash", "choice-band", "choice-specs", "life-orb", "expert-belt", "muscle-band", "wise-glasses", "choice-scarf", "assault-vest"];
  function pkmTowerTrainer(streak) {
    const boss = streak % 7 === 0;
    const lvl = pkmClamp(pkmTopLevel() - 2 + Math.floor(streak / 3) + (boss ? 4 : 0), 5, MAX_LEVEL);
    const n = Math.min(6, 3 + Math.floor(streak / 12) + (boss ? 1 : 0));
    const used = new Set();
    const team = [];
    while (team.length < n) {
      const id = pkmRand(1, 649);
      if (used.has(id) || (PKM_LEGEND_IDS.has(id) && !(boss && streak >= 28))) continue;
      used.add(id);
      team.push([id, team.length === n - 1 ? lvl : lvl - pkmRand(0, 2), streak >= 7 ? pkmPick(PKM_TOWER_ITEMS) : null]);
    }
    let name, sprite, title, lose;
    if (boss) { const [n2, s2] = pkmPick(PKM_TOWER_BOSSES); name = n2; sprite = s2; title = "Frontier Brain"; lose = "Impressive. You've earned your reward."; }
    else { const c = pkmPick(PKM_TRAINER_CLASSES); name = pkmPick(c.names); sprite = c.sprite; title = `Tower ${c.title}`; lose = c.lose; }
    return { title, name, sprite: `${PKM_TRAINER_IMG}${sprite}.png`, lose, team, tower: true, streak, boss, gym: 0 };
  }
  let pkmTowerCoins = (tr) => Math.floor((80 + tr.streak * 25) * (tr.boss ? 3 : 1));
  function pkmTowerRewards(streak, boss) {
    const items = [];
    if (streak % 5 === 0) items.push([STORAGE.greatBalls, 3, "Great Balls"], [STORAGE.potions, 3, "Potions"]);
    if (boss) { const h = pkmRandomHeld(); items.push(["pkm_revive", 1, "Revive"], [STORAGE.ultraBalls, 3, "Ultra Balls"], [h.key, 1, h.name]); }
    if (streak % 21 === 0) items.push([pkmRandomStone(), 1, "Evolution stone"]);
    if (streak % 50 === 0) items.push([STORAGE.masterBalls, 1, "Master Ball"]);
    pkmGive(items);
    return items;
  }
  function pkmTowerWin(b) {
    const tr = b.trainer;
    const t = pkmTower();
    t.streak = tr.streak;
    t.best = Math.max(t.best, t.streak);
    t.active = true;
    t.wins++;
    pkmSave("pkm_tower", t);
    pkmTrack("towerWins");
    const items = pkmTowerRewards(tr.streak, tr.boss);
    healPokemon();
    pkmPostBattle = () => pkmOpenTower();
    return ` 🗼 Streak ${t.streak}!${items.length ? ` Bonus: ${pkmItemsText(items)}.` : ""} Your party was healed.`;
  }
  function pkmTowerLose(b) {
    const t = pkmTower();
    const last = t.streak;
    t.active = false;
    pkmSave("pkm_tower", t);
    pkmPostBattle = () => pkmOpenTower();
    return ` Your Tower run ended with a streak of ${last}. Best: ${t.best}.`;
  }
  function pkmTowerStart() {
    const party = getObj(STORAGE.party) || {};
    if (!Object.keys(party).length) return pkmToast("Choose a starter first");
    healPokemon();
    const t = pkmTower();
    t.streak = 0;
    t.active = true;
    pkmSave("pkm_tower", t);
    pkmCloseTower();
    pkmStartTrainer(pkmTowerTrainer(1));
  }

  // ---------- Rival: a recurring trainer who grows with you ----------
  const pkmRival = () => Object.assign({ name: "Silver", stage: 0, wins: 0, losses: 0 }, pkmJSON("pkm_rival", {}));
  /** Each line is [first level, species]; the latest entry at or below the level is used. */
  const PKM_RIVAL_LINES = [
    [[1, "zubat"], [22, "golbat"], [40, "crobat"]],
    [[1, "gastly"], [25, "haunter"], [38, "gengar"]],
    [[1, "sneasel"], [45, "weavile"]],
    [[1, "magnemite"], [30, "magneton"], [50, "magnezone"]],
    [[1, "larvitar"], [30, "pupitar"], [55, "tyranitar"]],
    [[1, "totodile"], [18, "croconaw"], [30, "feraligatr"]],
  ];
  const PKM_RIVAL_STAGES = [
    { need: 0, off: -4, size: 2, line: "Hmph. Beginner's luck." },
    { need: 2, off: -3, size: 3, line: "You're not as weak as I thought." },
    { need: 5, off: -2, size: 3, line: "Next time I'll win. Count on it." },
    { need: 8, off: -1, size: 4, line: "…How are you getting stronger so fast?" },
    { need: 14, off: 0, size: 4, line: "I'm not going to stop until I beat you!" },
    { need: 22, off: 1, size: 5, line: "Fine. You've earned my respect." },
    { need: 32, off: 2, size: 6, line: "One more time. I'll get there someday." },
    { need: 40, off: 3, size: 6, line: "You really are the best. For now." },
  ];
  const PKM_RIVAL_REWARDS = [
    [1000, [[STORAGE.ultraBalls, 3, "Ultra Balls"]]], [1500, [["pkm_revive", 2, "Revives"]]], [2500, "stone"], [4000, [[STORAGE.ultraBalls, 5, "Ultra Balls"]]],
    [6000, "held"], [9000, [[STORAGE.masterBalls, 1, "Master Ball"]]], [12000, "stone2"], [20000, [[STORAGE.masterBalls, 2, "Master Balls"]]],
  ];
  const pkmRivalReady = () => { const r = pkmRival(); const s = PKM_RIVAL_STAGES[Math.min(r.stage, PKM_RIVAL_STAGES.length - 1)]; return pkmBadges().length >= s.need; };
  function pkmRivalTrainer() {
    const r = pkmRival();
    const rematch = r.stage >= PKM_RIVAL_STAGES.length;
    const idx = Math.min(r.stage, PKM_RIVAL_STAGES.length - 1);
    const s = PKM_RIVAL_STAGES[idx];
    const L = pkmClamp(pkmTopLevel() + s.off + (rematch ? 2 : 0), 5, MAX_LEVEL);
    const team = [];
    for (let i = 0; i < s.size; i++) {
      const line = PKM_RIVAL_LINES[i];
      const lv = i === s.size - 1 ? L : L - (s.size - 1 - i);
      const lead = line.filter(([from]) => from <= lv).pop() || line[0];
      team.push([lead[1], pkmClamp(lv, 2, MAX_LEVEL), i === s.size - 1 && idx >= 3 ? "sitrus-berry" : null]);
    }
    return { title: "Rival", name: r.name, sprite: `${PKM_TRAINER_IMG}silver.png`, lose: s.line, team, rival: true, stage: idx, rematch, gym: 0 };
  }
  function pkmRivalWin(b) {
    const r = pkmRival();
    r.wins++;
    let txt = "";
    if (!b.trainer.rematch) {
      const [coins, rw] = PKM_RIVAL_REWARDS[b.trainer.stage];
      let items = rw;
      if (rw === "stone") items = [[pkmRandomStone(), 1, "Evolution stone"]];
      else if (rw === "stone2") items = [[pkmRandomStone(), 1, "Evolution stone"], [pkmRandomStone(), 1, "Evolution stone"]];
      else if (rw === "held") { const h = pkmRandomHeld(); items = [[h.key, 1, h.name]]; }
      pkmGive(items);
      setInt(STORAGE.coins, getInt(STORAGE.coins) + coins);
      r.stage++;
      txt = ` First win over ${r.name} at this stage: +${coins} coins and ${pkmItemsText(items)}.`;
    }
    pkmSave("pkm_rival", r);
    pkmTrack("rivalWins");
    return txt;
  }
  function pkmRivalLose() {
    const r = pkmRival();
    r.losses++;
    pkmSave("pkm_rival", r);
  }

  // ---------- Legendary hunt ----------
  /** req: region + badges (that many badges of the region), league (that region's Champion beaten), dex (Pokédex entries), leagues (Champions beaten in total). */
  const PKM_LEGENDS = [
    { name: "articuno", id: 144, lv: 50, req: { region: "kanto", badges: 4 } },
    { name: "zapdos", id: 145, lv: 50, req: { region: "kanto", badges: 6 } },
    { name: "moltres", id: 146, lv: 50, req: { region: "kanto", badges: 8 } },
    { name: "mewtwo", id: 150, lv: 70, req: { league: "kanto" } },
    { name: "mew", id: 151, lv: 60, req: { league: "kanto", dex: 100 } },
    { name: "raikou", id: 243, lv: 60, req: { region: "johto", badges: 3 } },
    { name: "entei", id: 244, lv: 60, req: { region: "johto", badges: 5 } },
    { name: "suicune", id: 245, lv: 60, req: { region: "johto", badges: 8 } },
    { name: "lugia", id: 249, lv: 75, req: { league: "johto" } },
    { name: "ho-oh", id: 250, lv: 75, req: { league: "johto", dex: 150 } },
    { name: "celebi", id: 251, lv: 70, req: { league: "johto", dex: 200 } },
    { name: "regirock", id: 377, lv: 70, req: { region: "hoenn", badges: 2 } },
    { name: "regice", id: 378, lv: 70, req: { region: "hoenn", badges: 4 } },
    { name: "registeel", id: 379, lv: 70, req: { region: "hoenn", badges: 6 } },
    { name: "latias", id: 380, lv: 75, req: { region: "hoenn", badges: 8 } },
    { name: "latios", id: 381, lv: 75, req: { region: "hoenn", badges: 8 } },
    { name: "kyogre", id: 382, lv: 80, req: { league: "hoenn" } },
    { name: "groudon", id: 383, lv: 80, req: { league: "hoenn" } },
    { name: "jirachi", id: 385, lv: 75, req: { league: "hoenn", dex: 250 } },
    { name: "rayquaza", id: 384, lv: 85, req: { league: "hoenn", dex: 300 } },
    { name: "deoxys", id: 386, lv: 85, req: { league: "hoenn", dex: 350 } },
    { name: "uxie", id: 480, lv: 80, req: { region: "sinnoh", badges: 3 } },
    { name: "mesprit", id: 481, lv: 80, req: { region: "sinnoh", badges: 5 } },
    { name: "azelf", id: 482, lv: 80, req: { region: "sinnoh", badges: 7 } },
    { name: "heatran", id: 485, lv: 85, req: { region: "sinnoh", badges: 8 } },
    { name: "cresselia", id: 488, lv: 85, req: { league: "sinnoh" }, night: true },
    { name: "darkrai", id: 491, lv: 85, req: { league: "sinnoh" }, night: true },
    { name: "dialga", id: 483, lv: 90, req: { league: "sinnoh" } },
    { name: "palkia", id: 484, lv: 90, req: { league: "sinnoh" } },
    { name: "regigigas", id: 486, lv: 90, req: { league: "sinnoh", dex: 400 } },
    { name: "giratina", id: 487, lv: 90, req: { league: "sinnoh", dex: 420 }, night: true },
    { name: "arceus", id: 493, lv: 100, req: { leagues: 4, dex: 450 } },
    { name: "cobalion", id: 638, lv: 90, req: { region: "unova", badges: 3 } },
    { name: "terrakion", id: 639, lv: 90, req: { region: "unova", badges: 5 } },
    { name: "virizion", id: 640, lv: 90, req: { region: "unova", badges: 7 } },
    { name: "tornadus", id: 641, lv: 90, req: { region: "unova", badges: 8 } },
    { name: "thundurus", id: 642, lv: 90, req: { region: "unova", badges: 8 } },
    { name: "landorus", id: 645, lv: 95, req: { league: "unova" } },
    { name: "reshiram", id: 643, lv: 100, req: { league: "unova" } },
    { name: "zekrom", id: 644, lv: 100, req: { league: "unova" } },
    { name: "kyurem", id: 646, lv: 100, req: { league: "unova", dex: 500 } },
    { name: "xerneas", id: 716, lv: 100, req: { league: "kalos" } },
    { name: "yveltal", id: 717, lv: 100, req: { league: "kalos" } },
    { name: "zygarde", id: 718, lv: 100, req: { league: "kalos", dex: 600 } },
  ];
  const pkmLegendsState = () => pkmJSON("pkm_legends", {});
  /** { ok, why }: why lists what's still missing. */
  function pkmLegendReq(l) {
    const r = l.req || {};
    const bs = pkmBadges();
    const why = [];
    if (r.region) { const reg = pkmRegion(r.region); const n = pkmRegionBadges(reg, bs).length; if (n < r.badges) why.push(`${r.badges} ${reg.name} badges (${n})`); }
    if (r.league && !pkmRegionDone(r.league)) why.push(`Beat the ${pkmRegion(r.league).name} Champion`);
    if (r.leagues && Object.values(pkmChamps()).filter((v) => v > 0).length < r.leagues) why.push(`Beat ${r.leagues} Champions`);
    if (r.dex && pkmDexCount() < r.dex) why.push(`${r.dex} Pokédex entries (${pkmDexCount()})`);
    return { ok: !why.length, why };
  }
  /** Time left before this legend can be sought again (0 = ready). */
  function pkmLegendWait(l) {
    const s = pkmLegendsState()[l.name] || {};
    const cd = (s.caught ? 72 : 12) * 36e5;
    return Math.max(0, (s.last || 0) + cd - Date.now());
  }
  function pkmRandomLegend() {
    const open = PKM_LEGENDS.filter((l) => pkmLegendReq(l).ok && (!l.night || pkmIsNight()));
    return open.length ? pkmPick(open) : null;
  }
  function pkmLegendCaught(name) {
    const st = pkmLegendsState();
    st[name] = Object.assign(st[name] || {}, { caught: ((st[name] || {}).caught || 0) + 1, last: Date.now() });
    pkmSave("pkm_legends", st);
    pkmTrack("legends");
  }
  function pkmSeekLegend(name) {
    const l = PKM_LEGENDS.find((x) => x.name === name);
    if (!l) return;
    if (!pkmLegendReq(l).ok) return pkmToast("You haven't met the requirements yet.");
    if (l.night && !pkmIsNight()) return pkmToast("🌙 This Pokémon only shows itself at night (8 PM to 6 AM).");
    const wait = pkmLegendWait(l);
    if (wait > 0) return pkmToast(`It isn't around right now. Try again in ${Math.ceil(wait / 36e5)} hour(s).`);
    const before = pkmLegendsState();
    const st = JSON.parse(JSON.stringify(before));
    st[name] = Object.assign(st[name] || {}, { last: Date.now() });
    pkmSave("pkm_legends", st);
    pkmForcedWild = { name, level: Math.max(l.lv, pkmTopLevel()) };
    pkmCloseLegends();
    openBattle();
    if (!battlePanel) { pkmForcedWild = null; pkmSave("pkm_legends", before); }
  }

  // ---------- Daycare and Eggs ----------
  const PKM_EGG_MAX = 6;
  const PKM_EGG_STEPS = 900; // steps between Eggs while two compatible Pokémon stay at the Daycare
  const PKM_LEVEL_STEPS = 150; // steps per level for Pokémon at the Daycare
  const pkmDaycare = () => Object.assign({ slots: [], progress: 0, lvlSteps: 0, compat: false, pool: [] }, pkmJSON("pkm_daycare", {}));
  const pkmEggs = () => pkmJSON("pkm_eggs", []);
  let pkmEggBusy = false;
  /** The first stage of an evolution family (the Egg's species). */
  async function pkmBaseSpecies(name) {
    let cur = name;
    for (let i = 0; i < 4; i++) {
      const sp = await pkmSpeciesData(cur);
      if (!sp) return cur;
      if (!sp.evolves_from) return sp.name;
      cur = sp.evolves_from;
    }
    return cur;
  }
  /** Do the two Pokémon at the Daycare share an Egg Group (or is one a Ditto)? Saves the result and the possible Egg species. */
  async function pkmDaycareCheck() {
    let compat = false;
    let pool = [];
    const dc = pkmDaycare();
    if (dc.slots.length === 2) {
      const [sa, sb] = await Promise.all(dc.slots.map((s) => pkmSpeciesData(s.party.name)));
      if (sa && sb) {
        const ga = sa.egg_groups || [], gb = sb.egg_groups || [];
        const dit = (g) => g.includes("ditto");
        let ok = false;
        if (!ga.includes("no-eggs") && !gb.includes("no-eggs") && !(dit(ga) && dit(gb))) ok = dit(ga) || dit(gb) || ga.some((g) => gb.includes(g));
        if (ok) {
          const parents = dit(ga) ? [sb] : dit(gb) ? [sa] : [sa, sb];
          pool = [...new Set(await Promise.all(parents.map((p) => pkmBaseSpecies(p.name))))];
          compat = pool.length > 0;
        }
      }
    }
    const fresh = pkmDaycare();
    fresh.compat = compat;
    fresh.pool = pool;
    pkmSave("pkm_daycare", fresh);
    return fresh;
  }
  async function pkmMakeEgg() {
    if (pkmEggBusy) return;
    pkmEggBusy = true;
    try {
      const dc = pkmDaycare();
      if (dc.slots.length !== 2 || !dc.compat || !dc.pool.length || dc.progress < PKM_EGG_STEPS || pkmEggs().length >= PKM_EGG_MAX) return;
      const species = pkmPick(dc.pool);
      const sp = await pkmSpeciesData(species);
      const [a, b] = dc.slots;
      const ever = [a, b].find((s) => s.party.held === "everstone" && pkmHas(PKM_NATURES, s.stats.nature));
      const iv = pkmClamp(Math.round(((a.stats.iv == null ? 15 : a.stats.iv) + (b.stats.iv == null ? 15 : b.stats.iv)) / 2 + pkmRand(-3, 6)), 0, 31);
      const bd = await pkmPokemonData(species);
      const eggList = (bd && bd._egg) || [];
      const known = [...new Set([...(a.stats.moves || []), ...(b.stats.moves || [])])].filter((n) => eggList.includes(n));
      const moves = known.sort(() => Math.random() - 0.5).slice(0, 2);
      let hid = 0.05;
      for (const s of [a, b]) { const info = await pkmAbilityInfo(s.party.name); if (info.hidden && s.stats.ability === info.hidden) hid = 0.6; }
      const eggs = pkmEggs();
      eggs.push({ species, moves, hid, need: pkmClamp((sp && sp.hatch_counter ? sp.hatch_counter : 20) * 25, 300, 1500), have: 0, iv, nature: ever ? ever.stats.nature : pkmPick(Object.keys(PKM_NATURES)), shiny: Math.random() < pkmShinyRate(1.5), t: Date.now() });
      pkmSave("pkm_eggs", eggs);
      const dc2 = pkmDaycare();
      dc2.progress = Math.max(0, dc2.progress - PKM_EGG_STEPS);
      pkmSave("pkm_daycare", dc2);
      playSound("catch");
      pkmToast("🥚 The Daycare found an Egg! Keep browsing and it will hatch.", 5000);
      if (pkmDaycarePanel) pkmDrawDaycare();
    } catch (e) { console.warn("Egg failed:", e); }
    finally { pkmEggBusy = false; }
  }
  async function pkmHatchEggs() {
    if (pkmEggBusy) return;
    pkmEggBusy = true;
    try {
      for (const e of pkmEggs().filter((x) => x.have >= x.need)) {
        const mon = await pkmBuildMon(e.species, 5, { iv: e.iv, nature: e.nature, shiny: !!e.shiny, hidden: e.hid });
        if (!mon) continue; // PokéAPI didn't answer: try again later
        const em = await pkmMovesByNames(e.moves || []);
        if (em.length) mon.moves = [...mon.moves.filter((m) => !em.some((x) => x.name === m.name)).slice(0, 4 - em.length), ...em];
        pkmStoreCaught(mon, "egg");
        pkmSave("pkm_eggs", pkmEggs().filter((x) => !(x.t === e.t && x.species === e.species)));
        pkmTrack("hatched");
        playSound("evolve");
        pkmReact("happy");
        pkmToast(`🐣 Your Egg hatched! It's ${mon.shiny ? "a ✨ shiny " : "a "}${mon.display}!${em.length ? ` It knows ${em.map((m) => m.display).join(" and ")} from its parents.` : ""}`, 6000);
      }
      if (pkmDaycarePanel) pkmDrawDaycare();
    } catch (e) { console.warn("Hatch failed:", e); }
    finally { pkmEggBusy = false; }
  }
  function pkmAddSteps(n) {
    const eggs = pkmEggs();
    let ready = false;
    for (const e of eggs) { e.have = Math.min(e.need, (e.have || 0) + n); if (e.have >= e.need) ready = true; }
    if (eggs.length) pkmSave("pkm_eggs", eggs);
    const dc = pkmDaycare();
    if (dc.slots.length) {
      dc.lvlSteps += n;
      while (dc.lvlSteps >= PKM_LEVEL_STEPS) {
        dc.lvlSteps -= PKM_LEVEL_STEPS;
        for (const s of dc.slots) if ((s.stats.level || 1) < MAX_LEVEL) { s.stats.level = (s.stats.level || 1) + 1; s.stats.xp = 0; }
      }
      if (dc.slots.length === 2 && dc.compat) dc.progress = Math.min(PKM_EGG_STEPS * 2, dc.progress + n);
      pkmSave("pkm_daycare", dc);
    }
    pkmTrainSteps(n);
    if (ready) pkmHatchEggs();
    else if (dc.slots.length === 2 && dc.compat && dc.progress >= PKM_EGG_STEPS && eggs.length < PKM_EGG_MAX) pkmMakeEgg();
  }
  /** 1 step per second while a page is visible (all tabs together count once), plus a bonus for each page you open. */
  function pkmStepTick(bonus) {
    if (!bonus) {
      if (document.hidden) return;
      const now = Date.now();
      if (now - Number(GM_getValue("pkm_steps_t", 0)) < 4500) return;
      GM_setValue("pkm_steps_t", now);
    }
    if (!pkmEggs().length && !pkmDaycare().slots.length && !pkmJSON("pkm_training", null) && !pkmJSON("pkm_garden", null)) return;
    pkmAddSteps(bonus || 5);
    if (pkmDaycarePanel && !bonus) pkmDrawDaycare();
  }
  setInterval(() => pkmStepTick(0), 5000);
  setTimeout(() => {
    const now = Date.now();
    if (now - Number(GM_getValue("pkm_load_t", 0)) > 60000) { GM_setValue("pkm_load_t", now); pkmStepTick(25); }
  }, 3000);
  async function pkmDaycareDeposit(id) {
    const party = getObj(STORAGE.party) || {};
    const st = getObj(STORAGE.stats) || {};
    const dc = pkmDaycare();
    if (!party[id]) return;
    if (dc.slots.length >= 2) return pkmToast("The Daycare is full (2 Pokémon).");
    if (id === GM_getValue("pkm_starter_id")) return pkmToast("Your active partner can't stay at the Daycare. Switch partners first.");
    if (Object.keys(party).length <= 1) return pkmToast("Keep at least one Pokémon with you.");
    dc.slots.push({ id, party: party[id], stats: st[id] || {}, t: Date.now() });
    dc.progress = 0;
    dc.compat = false;
    delete party[id];
    delete st[id];
    setObj(STORAGE.party, party);
    setObj(STORAGE.stats, st);
    pkmSave("pkm_daycare", dc);
    pkmDrawDaycare();
    await pkmDaycareCheck();
    pkmDrawDaycare();
  }
  async function pkmDaycareWithdraw(i) {
    const dc = pkmDaycare();
    const s = dc.slots[i];
    if (!s) return;
    dc.slots.splice(i, 1);
    dc.progress = 0;
    dc.compat = false;
    pkmSave("pkm_daycare", dc);
    const party = getObj(STORAGE.party) || {};
    const st = getObj(STORAGE.stats) || {};
    party[s.id] = s.party;
    st[s.id] = s.stats;
    setObj(STORAGE.party, party);
    setObj(STORAGE.stats, st);
    await pkmSyncStats(s.id, s.party.name);
    pkmToast(`${pkmCap(s.party.name)} is back in your Bag at Lv ${s.stats.level || 1}.`);
    pkmDrawDaycare();
    await pkmDaycareCheck();
    pkmDrawDaycare();
  }

  // ---------- Link: friend battles, trades and Mystery Gifts ----------
  const pkmHas = (o, k) => typeof k === "string" && Object.prototype.hasOwnProperty.call(o, k);
  const pkmTrainerName = () => pkmSafeName(GM_getValue("pkm_trainer_name", "Trainer")) || "Trainer";
  const pkmHeldIds = () => PKM_ITEMS.filter((i) => i.cat === "held").map((i) => i.img);
  /** A Pokémon as plain, shareable data. */
  function pkmMonShare(id) {
    const p = (getObj(STORAGE.party) || {})[id];
    if (!p) return null;
    const s = (getObj(STORAGE.stats) || {})[id] || {};
    return { s: p.name, l: Math.min(MAX_LEVEL, s.level || 1), i: s.iv == null ? 15 : s.iv, n: s.nature || "hardy", a: s.ability || "", m: (s.moves || []).slice(0, 4), h: p.held || "", x: p.isShiny ? 1 : 0 };
  }
  /** Checks one shared Pokémon. Anything odd is dropped or replaced by a safe default. */
  function pkmCleanShare(x) {
    if (!x || typeof x !== "object") return null;
    const sp = pkmSafeSlug(String(x.s || "").toLowerCase());
    if (!sp) return null;
    return {
      sp, lv: pkmClamp(parseInt(x.l, 10) || 1, 1, MAX_LEVEL), iv: pkmClamp(parseInt(x.i, 10) || 0, 0, 31), nature: pkmHas(PKM_NATURES, x.n) ? x.n : undefined,
      ability: pkmSafeSlug(x.a) || undefined, moves: Array.isArray(x.m) ? x.m.slice(0, 4).map(pkmSafeSlug).filter(Boolean) : [],
      held: pkmHeldIds().includes(x.h) ? x.h : null, shiny: !!x.x,
    };
  }
  function pkmTeamCode() {
    const ids = Object.keys(getObj(STORAGE.party) || {}).slice(0, PKM_PARTY_SIZE);
    return pkmPack("PKT1", { v: 1, n: pkmTrainerName(), t: ids.map(pkmMonShare).filter(Boolean) });
  }
  function pkmParseTeamCode(code) {
    const o = pkmUnpack("PKT1", code);
    if (!o || !Array.isArray(o.t)) return null;
    const team = o.t.slice(0, PKM_PARTY_SIZE).map(pkmCleanShare).filter(Boolean);
    return team.length ? { name: pkmSafeName(o.n) || "Friend", team } : null;
  }
  function pkmFriendBattle(f, double) {
    pkmCloseLink();
    pkmStartTrainer({ title: "Friend", name: f.name, sprite: `${PKM_TRAINER_IMG}acetrainer.png`, lose: "Good game!", team: f.team, pvp: true, gym: 0, double: !!double && f.team.length >= 2 });
  }
  /** Add a (checked) shared Pokémon to the Bag. Returns its new id or null. */
  async function pkmAddShared(m) {
    const d = await pkmPokemonData(m.sp);
    if (!d) return null;
    const ability = m.ability && (d.abilities || []).some((a) => a.ability.name === m.ability) ? m.ability : undefined;
    const mon = pkmMonFromData(d, m.lv, { iv: m.iv, nature: m.nature, ability, shiny: m.shiny });
    const mv = m.moves.length ? await pkmMovesByNames(m.moves) : [];
    mon.moves = mv.length ? mv : await pkmPickMoves(d, m.lv);
    return pkmStoreCaught(mon, "trade");
  }
  function pkmTradeOffer(id) {
    const mon = pkmMonShare(id);
    if (!mon) return null;
    if (id === GM_getValue("pkm_starter_id")) { pkmToast("Your active partner can't be traded. Switch partners first."); return null; }
    mon.h = "";
    const nonce = `${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
    pkmSave("pkm_trade_offer", { nonce, id });
    return pkmPack("PKX1", { v: 1, id: nonce, mon });
  }
  async function pkmTradeReceive(code) {
    const o = pkmUnpack("PKX1", code);
    const m = o && o.id && pkmCleanShare(o.mon);
    if (!m) return "That isn't a valid trade code.";
    const used = pkmJSON("pkm_trade_used", []);
    const offer = pkmJSON("pkm_trade_offer", null);
    if (used.includes(o.id)) return "That trade code was already used.";
    if (!offer) return "Make your own offer first. A trade swaps one Pokémon for one.";
    if (offer.nonce === o.id) return "That's your own offer. Send it to your friend and paste theirs here.";
    const party = getObj(STORAGE.party) || {};
    if (!party[offer.id]) return "The Pokémon you offered isn't in your Bag anymore.";
    if (offer.id === GM_getValue("pkm_starter_id")) return "The Pokémon you offered is your active partner now. Cancel the offer and make a new one.";
    const id = await pkmAddShared({ ...m, held: null });
    if (!id) return "Couldn't load that Pokémon (PokéAPI didn't answer). Try again.";
    const out = (getObj(STORAGE.party) || {})[offer.id];
    const outName = out ? out.name : "your Pokémon";
    const p2 = getObj(STORAGE.party) || {};
    const s2 = getObj(STORAGE.stats) || {};
    if (p2[offer.id] && p2[offer.id].held) setInt(`pkm_item_${p2[offer.id].held}`, getInt(`pkm_item_${p2[offer.id].held}`) + 1);
    delete p2[offer.id];
    delete s2[offer.id];
    setObj(STORAGE.party, p2);
    setObj(STORAGE.stats, s2);
    used.push(o.id);
    pkmSave("pkm_trade_used", used.slice(-100));
    pkmSave("pkm_trade_offer", null);
    pkmTrack("trades");
    playSound("evolve");
    pkmToast(`🔁 You traded ${pkmCap(outName)} for ${pkmCap(m.sp)}!`, 5000);
    return "";
  }

  const PKM_PROMOS = {
    d8rhkzvhrg: { c: 500, i: [[STORAGE.balls, 5, "Poké Balls"]] },
    "1vmiylm6pb4": { c: 1000, i: [[STORAGE.greatBalls, 10, "Great Balls"]] },
    "2ddal3mpo1g": { c: 800, i: [[STORAGE.ultraBalls, 5, "Ultra Balls"]] },
    qx03of7ca7: { c: 1500, i: [[STORAGE.potions, 10, "Potions"], ["pkm_revive", 3, "Revives"]] },
  };
  const pkmGiftKeys = () => PKM_ITEMS.map((i) => i.key);
  /** Redeems a Mystery Gift. Returns { err } or { text }. */
  function pkmRedeem(raw) {
    const code = String(raw || "").trim();
    if (!code) return { err: "Type or paste a code first." };
    const used = pkmJSON("pkm_gifts_used", []);
    let coins = 0;
    let items = [];
    let id;
    if (/^PKG1\./.test(code)) {
      const o = pkmUnpack("PKG1", code);
      if (!o || !o.id) return { err: "That gift code is damaged or isn't a gift code." };
      id = String(o.id);
      coins = pkmClamp(parseInt(o.c, 10) || 0, 0, 100000);
      const keys = pkmGiftKeys();
      for (const [k, n] of (Array.isArray(o.i) ? o.i : []).slice(0, 5)) {
        const it = PKM_ITEMS.find((x) => x.key === k);
        if (keys.includes(k) && it) items.push([k, pkmClamp(parseInt(n, 10) || 0, 1, 99), it.name]);
      }
      if (!coins && !items.length) return { err: "That gift is empty." };
    } else {
      id = pkmHash(code.toUpperCase(), 7).toString(36);
      const promo = PKM_PROMOS[id];
      if (!promo) return { err: "That code isn't valid." };
      coins = promo.c;
      items = promo.i;
    }
    if (used.includes(id)) return { err: "You already redeemed that code." };
    for (const [k, n] of items) { const it = PKM_ITEMS.find((x) => x.key === k); if (it && it.max) items = items.map((e) => (e[0] === k ? [k, Math.max(0, Math.min(n, it.max - getInt(k))), e[2]] : e)); }
    items = items.filter(([, n]) => n > 0);
    if (coins) { setInt(STORAGE.coins, getInt(STORAGE.coins) + coins); pkmTrack("coins", coins); }
    pkmGive(items);
    used.push(id);
    pkmSave("pkm_gifts_used", used.slice(-200));
    pkmTrack("gifts");
    playSound("daily");
    return { text: `🎁 You got ${coins ? `${coins} coins` : ""}${coins && items.length ? " and " : ""}${pkmItemsText(items)}!` };
  }
  /** Makes a gift code for a friend: the coins/items leave your Bag. */
  function pkmMakeGift(coins, key, n) {
    coins = pkmClamp(parseInt(coins, 10) || 0, 0, 100000);
    n = pkmClamp(parseInt(n, 10) || 0, 0, 99);
    const it = key ? PKM_ITEMS.find((x) => x.key === key) : null;
    if (!coins && !(it && n)) return { err: "Choose coins or an item and an amount." };
    if (coins > getInt(STORAGE.coins)) return { err: "You don't have that many coins." };
    if (it && n > getInt(it.key)) return { err: `You only have ${getInt(it.key)} ${it.name}.` };
    if (coins) setInt(STORAGE.coins, getInt(STORAGE.coins) - coins);
    if (it && n) setInt(it.key, getInt(it.key) - n);
    const id = `${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
    return { code: pkmPack("PKG1", { v: 1, id, c: coins, i: it && n ? [[it.key, n]] : [] }) };
  }

  // ---------- Pokédex rewards (per region) ----------
  const PKM_DEX_STEPS = [25, 50, 75, 100];
  function pkmDexRegion(r) {
    const have = new Set((getArr(STORAGE.pokedex) || []).map((e) => e.id).filter((id) => id >= r.dex[0] && id <= r.dex[1])).size;
    return { have, total: r.dex[1] - r.dex[0] + 1 };
  }
  function pkmDexPrize(ri, pct) {
    const k = ri + 1;
    if (pct === 25) return { coins: 500 * k, items: [[STORAGE.greatBalls, 5, "Great Balls"]] };
    if (pct === 50) return { coins: 1000 * k, items: [[STORAGE.ultraBalls, 3, "Ultra Balls"]] };
    if (pct === 75) return { coins: 2000 * k, items: [["pkm_revive", 2, "Revives"], [pkmRandomStone(), 1, "Evolution stone"]] };
    const h = pkmRandomHeld();
    return { coins: 5000 * k, items: [[STORAGE.masterBalls, 1, "Master Ball"], [h.key, 1, h.name]] };
  }
  const pkmDexDone = () => pkmJSON("pkm_dex_claims", {});
  function pkmDexClaim(regionId, pct) {
    const ri = PKM_REGIONS.findIndex((r) => r.id === regionId);
    if (ri < 0 || !PKM_DEX_STEPS.includes(pct)) return;
    const d = pkmDexRegion(PKM_REGIONS[ri]);
    const claims = pkmDexDone();
    claims[regionId] = claims[regionId] || [];
    if (claims[regionId].includes(pct) || d.have < Math.ceil((d.total * pct) / 100)) return;
    const prize = pkmDexPrize(ri, pct);
    claims[regionId].push(pct);
    pkmSave("pkm_dex_claims", claims);
    setInt(STORAGE.coins, getInt(STORAGE.coins) + prize.coins);
    pkmGive(prize.items);
    pkmTrack("coins", prize.coins);
    playSound("badge");
    pkmToast(`📖 ${PKM_REGIONS[ri].name} Pokédex ${pct}%: +${prize.coins} coins, ${pkmItemsText(prize.items)}`, 5000);
  }

  // ---------- Battle Tower panel ----------
  let pkmTowerPanel = null;
  function pkmCloseTower() { if (pkmTowerPanel) pkmTowerPanel.remove(); pkmTowerPanel = null; }
  function pkmOpenTower() {
    pkmCloseTower();
    const P = (pkmTowerPanel = document.createElement("div"));
    P.className = "pkm-panel pkm-modal pkm-set pkm-tower";
    P.setAttribute("role", "dialog");
    P.setAttribute("aria-label", "Battle Tower");
    const t = pkmTower();
    const next = t.streak + 1;
    const boss = next % 7 === 0;
    P.innerHTML = `
      <div class="pkm-set-head tw-head"><span>🗼 Battle Tower</span><button type="button" class="pkm-x" data-a="close" aria-label="Close" title="Close (Esc)">✕</button></div>
      <div class="tw-body">
        <div class="tw-stats"><div><b>${t.active ? t.streak : 0}</b><span class="pkm-dim">Current streak</span></div><div><b>${t.best}</b><span class="pkm-dim">Best streak</span></div><div><b>${t.wins}</b><span class="pkm-dim">Tower wins</span></div></div>
        <p>Win battle after battle against trainers with random teams. Your party is healed after every win. Lose once and the run is over. Every 7th trainer is a Frontier Brain with a stronger team.</p>
        ${t.active ? `<div class="tw-next">Next: battle ${next}${boss ? " · 👑 Frontier Brain!" : ""}<div class="pkm-dim">Pays about 💰 ${pkmTowerCoins({ streak: next, boss })}</div></div>` : ""}
        <div class="pkm-btns" style="justify-content:center">
          ${t.active ? `<button type="button" class="pkm-btn2 primary" data-a="go">Continue (battle ${next})</button><button type="button" class="pkm-btn2 danger" data-a="retire">Retire</button>` : `<button type="button" class="pkm-btn2 primary" data-a="start">Start a run</button>`}
        </div>
        <div class="tw-rewards pkm-dim">
          <b>Rewards</b>
          <div>Every win: 💰 80 + 25 × streak (×3 for a Frontier Brain)</div>
          <div>Every 5th win: 3 Great Balls + 3 Potions</div>
          <div>Frontier Brain: Revive, 3 Ultra Balls and a held item</div>
          <div>Every 21st win: an Evolution stone · Every 50th: a Master Ball</div>
          <div>Teams are around your top level (Lv ${pkmTopLevel()}) and grow with your streak.</div>
        </div>
      </div>`;
    P.onclick = (e) => {
      const a = e.target.closest("[data-a]")?.dataset.a;
      if (a === "close") return pkmCloseTower();
      if (a === "start") return pkmTowerStart();
      if (a === "go") { pkmCloseTower(); return pkmStartTrainer(pkmTowerTrainer(pkmTower().streak + 1)); }
      if (a === "retire") { const x = pkmTower(); x.active = false; pkmSave("pkm_tower", x); pkmOpenTower(); }
    };
    pkmMount(P);
  }

  // ---------- Legendary hunt panel ----------
  let pkmLegendsPanel = null;
  function pkmCloseLegends() { if (pkmLegendsPanel) pkmLegendsPanel.remove(); pkmLegendsPanel = null; }
  function pkmOpenLegends() {
    pkmCloseLegends();
    const P = (pkmLegendsPanel = document.createElement("div"));
    P.className = "pkm-panel pkm-modal pkm-set pkm-legends";
    P.setAttribute("role", "dialog");
    P.setAttribute("aria-label", "Legendary hunt");
    const st = pkmLegendsState();
    const cards = PKM_LEGENDS.map((l) => {
      const rq = pkmLegendReq(l);
      const wait = rq.ok ? pkmLegendWait(l) : 0;
      const night = l.night && !pkmIsNight();
      const s = st[l.name] || {};
      const label = !rq.ok ? "🔒 Locked" : night ? "🌙 Night only" : wait > 0 ? `⏳ ${Math.ceil(wait / 36e5)}h` : s.caught ? "Seek again" : "Seek";
      const dis = !rq.ok || night || wait > 0;
      return `<div class="lg-card${rq.ok ? "" : " locked"}${s.caught ? " caught" : ""}">
        <img src="${PKM_SPRITES}${l.id}.png" alt="" loading="lazy"><div class="lg-name">${pkmEsc(pkmCap(l.name))}${s.caught ? " ✅" : ""}</div>
        <div class="pkm-dim">Lv ${l.lv}+${l.night ? " · 🌙" : ""}</div>
        <div class="pkm-dim lg-req">${rq.ok ? "Ready to find" : pkmEsc(rq.why.join(" · "))}</div>
        <button type="button" class="pkm-btn2 ${dis ? "" : "primary"}" data-seek="${pkmEsc(l.name)}" ${dis ? "disabled" : ""}>${label}</button></div>`;
    }).join("");
    const open = PKM_LEGENDS.filter((l) => pkmLegendReq(l).ok).length;
    P.innerHTML = `
      <div class="pkm-set-head lg-head"><span>🌟 Legendary hunt</span><button type="button" class="pkm-x" data-a="close" aria-label="Close" title="Close (Esc)">✕</button></div>
      <div class="lg-body"><div class="pkm-dim" style="margin-bottom:8px">${open}/${PKM_LEGENDS.length} can be found. Earn badges and beat Champions to unlock more. A hunt is a wild battle with one legendary Pokémon (use Ultra or Master Balls!). Each one can be sought again after 12 hours (72 hours once caught). They also rarely show up in ordinary wild battles.</div>
      <div class="lg-grid">${cards}</div></div>`;
    P.onclick = (e) => {
      if (e.target.closest("[data-a='close']")) return pkmCloseLegends();
      const s = e.target.closest("[data-seek]");
      if (s && !s.disabled) pkmSeekLegend(s.dataset.seek);
    };
    pkmMount(P);
  }

  // ---------- Daycare panel ----------
  let pkmDaycarePanel = null;
  function pkmCloseDaycare() { if (pkmDaycarePanel) pkmDaycarePanel.remove(); pkmDaycarePanel = null; }
  function pkmOpenDaycare() {
    if (!pkmDaycarePanel) {
      const P = (pkmDaycarePanel = document.createElement("div"));
      P.className = "pkm-panel pkm-modal pkm-set pkm-daycare";
      P.setAttribute("role", "dialog");
      P.setAttribute("aria-label", "Daycare");
      P.onclick = (e) => {
        const a = e.target.closest("[data-a]")?.dataset.a;
        if (a === "close") return pkmCloseDaycare();
        if (a === "put") { const v = P.querySelector(".dc-sel")?.value; if (v) pkmDaycareDeposit(v); }
        if (a === "take") pkmDaycareWithdraw(+e.target.closest("[data-a]").dataset.i);
      };
      pkmMount(P);
    }
    pkmDrawDaycare();
    pkmDaycareCheck().then(() => pkmDrawDaycare());
  }
  function pkmDrawDaycare(onlyProgress) {
    const P = pkmDaycarePanel;
    if (!P) return;
    const dc = pkmDaycare();
    const eggs = pkmEggs();
    const nextTxt = dc.slots.length < 2 ? "Leave two Pokémon here to look for an Egg."
      : !dc.compat ? "These two don't seem to get along. Try a pair that shares an Egg Group (or add a Ditto)."
      : eggs.length >= PKM_EGG_MAX ? "You're carrying as many Eggs as you can. Hatch some first."
      : `Next Egg in ${Math.max(0, PKM_EGG_STEPS - dc.progress)} steps (about ${Math.ceil(Math.max(0, PKM_EGG_STEPS - dc.progress) / 60)} min of browsing).`;
    if (onlyProgress) {
      P.querySelectorAll("[data-egg]").forEach((el) => {
        const e = eggs[+el.dataset.egg];
        if (e) { el.querySelector("span").style.width = `${Math.round((e.have / e.need) * 100)}%`; el.title = `${e.have}/${e.need} steps`; }
      });
      const nx = P.querySelector(".dc-next");
      if (nx) nx.textContent = nextTxt;
      return;
    }
    const party = getObj(STORAGE.party) || {};
    const st = getObj(STORAGE.stats) || {};
    const dexArr = getArr(STORAGE.pokedex) || [];
    const active = GM_getValue("pkm_starter_id");
    const opts = Object.entries(party).filter(([id]) => id !== active).sort((a, b) => a[1].name.localeCompare(b[1].name))
      .map(([id, p]) => `<option value="${pkmEsc(id)}">${pkmEsc(pkmCap(p.name))}${p.isShiny ? " ✨" : ""} (Lv ${(st[id] || {}).level || 1})</option>`).join("");
    const slot = (i) => {
      const s = dc.slots[i];
      if (!s) return `<div class="dc-slot empty"><span class="pkm-dim">Empty</span></div>`;
      return `<div class="dc-slot"><img src="${pkmEsc(pkmMonSprite(s.party, dexArr))}" alt=""><div><b>${pkmEsc(pkmCap(s.party.name))}</b>${s.party.isShiny ? " ✨" : ""}</div>
        <div class="pkm-dim">Lv ${s.stats.level || 1}</div><button type="button" class="pkm-btn2" data-a="take" data-i="${i}">Take back</button></div>`;
    };
    P.innerHTML = `
      <div class="pkm-set-head dc-head"><span>🥚 Daycare</span><button type="button" class="pkm-x" data-a="close" aria-label="Close" title="Close (Esc)">✕</button></div>
      <div class="dc-body">
        <p class="pkm-dim">Pokémon left here gain a level every ${PKM_LEVEL_STEPS} steps. Two that can breed produce an Egg every ${PKM_EGG_STEPS} steps. You walk 1 step per second while a page is open, plus 25 steps for each page you visit. An Everstone passes its Nature to the Egg.</p>
        <div class="dc-slots">${slot(0)}${slot(1)}</div>
        <div class="dc-next pkm-dim">${pkmEsc(nextTxt)}</div>
        ${dc.slots.length < 2 ? `<div class="dc-put"><select class="dc-sel" aria-label="Pokémon to leave">${opts}</select><button type="button" class="pkm-btn2 primary" data-a="put" ${opts ? "" : "disabled"}>Leave here</button></div>` : ""}
        <div class="bag-sec"><span>Eggs</span><span class="pkm-dim">${eggs.length}/${PKM_EGG_MAX}</span></div>
        <div class="dc-eggs">${eggs.length ? eggs.map((e, i) => `<div class="dc-egg" data-egg="${i}" title="${e.have}/${e.need} steps"><div class="dc-egg-ico">🥚</div><div class="bc-bar"><span style="width:${Math.round((e.have / e.need) * 100)}%"></span></div></div>`).join("") : `<div class="pkm-dim">No Eggs yet.</div>`}</div>
      </div>`;
  }

  // ---------- Link panel: friend battles, trades, Mystery Gifts ----------
  let pkmLinkPanel = null;
  let pkmLinkTab = "battle";
  let pkmLinkMsg = "";
  let pkmLinkOut = "";
  function pkmCloseLink() { if (pkmLinkPanel) pkmLinkPanel.remove(); pkmLinkPanel = null; }
  function pkmOpenLink(tab) {
    if (typeof tab === "string") pkmLinkTab = tab;
    if (!pkmLinkPanel) {
      const P = (pkmLinkPanel = document.createElement("div"));
      P.className = "pkm-panel pkm-modal pkm-set pkm-link";
      P.setAttribute("role", "dialog");
      P.setAttribute("aria-label", "Link and gifts");
      P.onclick = pkmLinkClick;
      P.onchange = (e) => { if (e.target.matches(".lk-name")) { GM_setValue("pkm_trainer_name", pkmSafeName(e.target.value) || "Trainer"); pkmLinkMsg = "Name saved."; pkmDrawLink(); } };
      pkmMount(P);
    }
    pkmDrawLink();
  }
  function pkmDrawLink() {
    const P = pkmLinkPanel;
    if (!P) return;
    const q = (sel) => (P.querySelector(sel) ? P.querySelector(sel).value : "");
    const keep = { team: q(".lk-friend"), trade: q(".lk-trade"), redeem: q(".lk-redeem") };
    let body = "";
    if (pkmLinkTab === "battle") {
      body = `<p class="pkm-dim">Share your team code with a friend. Paste theirs to battle their team (their saved moves, natures and items). Friend battles give no coins or XP.</p>
        <label class="lk-l">Your trainer name <input class="lk-name" maxlength="14" value="${pkmEsc(pkmTrainerName())}"></label>
        <label class="lk-l">Your team code <textarea class="lk-out" readonly rows="3" aria-label="Your team code">${pkmEsc(pkmTeamCode())}</textarea></label>
        <div class="pkm-btns"><button type="button" class="pkm-btn2" data-a="copy-team">📋 Copy my team code</button></div>
        <label class="lk-l">Friend's team code <textarea class="lk-friend" rows="3" placeholder="PKT1.…" aria-label="Friend's team code">${pkmEsc(keep.team)}</textarea></label>
        <div class="pkm-btns"><button type="button" class="pkm-btn2 primary" data-a="fight">⚔️ Battle this team</button><button type="button" class="pkm-btn2" data-a="fight2">👥 Double battle</button></div>`;
    } else if (pkmLinkTab === "trade") {
      const party = getObj(STORAGE.party) || {};
      const st = getObj(STORAGE.stats) || {};
      const active = GM_getValue("pkm_starter_id");
      const offer = pkmJSON("pkm_trade_offer", null);
      const opts = Object.entries(party).filter(([id]) => id !== active).sort((a, b) => a[1].name.localeCompare(b[1].name))
        .map(([id, p]) => `<option value="${pkmEsc(id)}">${pkmEsc(pkmCap(p.name))} (Lv ${(st[id] || {}).level || 1})</option>`).join("");
      body = `<p class="pkm-dim">A trade swaps one Pokémon for one. 1) Each of you creates an offer code and sends it to the other. 2) Each pastes the friend's code and presses Trade. Your offered Pokémon leaves only when you receive theirs. Held items go back to your Bag.</p>
        <div class="bag-sec"><span>1. Your offer</span></div>
        ${offer && party[offer.id] ? `<div class="pkm-dim">Offering <b>${pkmEsc(pkmCap(party[offer.id].name))}</b>.</div>` : `<div class="pkm-btns"><select class="lk-pick" aria-label="Pokémon to offer">${opts}</select><button type="button" class="pkm-btn2 primary" data-a="offer" ${opts ? "" : "disabled"}>Create offer code</button></div>`}
        ${pkmLinkOut ? `<label class="lk-l">Send this code to your friend <textarea class="lk-out" readonly rows="3">${pkmEsc(pkmLinkOut)}</textarea></label><div class="pkm-btns"><button type="button" class="pkm-btn2" data-a="copy-out">📋 Copy</button></div>` : ""}
        ${offer ? `<div class="pkm-btns"><button type="button" class="pkm-btn2 danger" data-a="cancel-offer">Cancel my offer</button></div>` : ""}
        <div class="bag-sec"><span>2. Your friend's offer</span></div>
        <label class="lk-l"><textarea class="lk-trade" rows="3" placeholder="PKX1.…" aria-label="Friend's trade code">${pkmEsc(keep.trade)}</textarea></label>
        <div class="pkm-btns"><button type="button" class="pkm-btn2 primary" data-a="trade" ${offer ? "" : "disabled"}>🔁 Trade</button></div>`;
    } else {
      const owned = PKM_ITEMS.filter((i) => getInt(i.key) > 0);
      body = `<p class="pkm-dim">Redeem a Mystery Gift code (from an event or a friend). Each code works once.</p>
        <div class="pkm-btns"><input class="lk-redeem" placeholder="Enter a code" value="${pkmEsc(keep.redeem)}" aria-label="Gift code"><button type="button" class="pkm-btn2 primary" data-a="redeem">🎁 Redeem</button></div>
        <div class="bag-sec"><span>Send a gift to a friend</span></div>
        <p class="pkm-dim">The coins or items leave your Bag and go into a code your friend can redeem once.</p>
        <div class="pkm-btns"><label>💰 <input class="lk-coins" type="number" min="0" max="100000" value="0" style="width:90px"></label>
          <select class="lk-item" aria-label="Item to gift"><option value="">No item</option>${owned.map((i) => `<option value="${pkmEsc(i.key)}">${pkmEsc(i.name)} (×${getInt(i.key)})</option>`).join("")}</select>
          <input class="lk-qty" type="number" min="1" max="99" value="1" style="width:60px" aria-label="Amount">
          <button type="button" class="pkm-btn2 primary" data-a="mkgift">Create gift code</button></div>
        ${pkmLinkOut ? `<label class="lk-l">Gift code <textarea class="lk-out" readonly rows="3">${pkmEsc(pkmLinkOut)}</textarea></label><div class="pkm-btns"><button type="button" class="pkm-btn2" data-a="copy-out">📋 Copy</button></div>` : ""}`;
    }
    P.innerHTML = `
      <div class="pkm-set-head lk-head"><span>🔗 Link & gifts</span><span class="bag-head-r"><span class="pkm-chip" data-coins>💰 ${getInt(STORAGE.coins)}</span><button type="button" class="pkm-x" data-a="close" aria-label="Close" title="Close (Esc)">✕</button></span></div>
      <div class="bag-tabs" role="tablist">
        <button type="button" role="tab" data-tab="battle" aria-selected="${pkmLinkTab === "battle"}">Friend battle</button>
        <button type="button" role="tab" data-tab="trade" aria-selected="${pkmLinkTab === "trade"}">Trade</button>
        <button type="button" role="tab" data-tab="gift" aria-selected="${pkmLinkTab === "gift"}">Mystery Gift</button>
      </div>
      ${pkmLinkMsg ? `<div class="bag-msg" role="status">${pkmEsc(pkmLinkMsg)}</div>` : ""}
      <div class="lk-body">${body}</div>`;
  }
  async function pkmLinkClick(e) {
    const P = pkmLinkPanel;
    const tab = e.target.closest("[data-tab]");
    if (tab) { pkmLinkTab = tab.dataset.tab; pkmLinkMsg = ""; pkmLinkOut = ""; return pkmDrawLink(); }
    const a = e.target.closest("[data-a]")?.dataset.a;
    if (!a) return;
    const val = (sel) => (P.querySelector(sel) ? P.querySelector(sel).value : "");
    const copy = async (text) => { try { await navigator.clipboard.writeText(text); pkmLinkMsg = "Copied to the clipboard."; } catch { pkmLinkMsg = "Couldn't copy. Select the text and press Ctrl+C."; } };
    if (a === "close") return pkmCloseLink();
    if (a === "copy-team") { await copy(pkmTeamCode()); return pkmDrawLink(); }
    if (a === "copy-out") { await copy(pkmLinkOut); return pkmDrawLink(); }
    if (a === "fight" || a === "fight2") {
      const f = pkmParseTeamCode(val(".lk-friend"));
      if (!f) { pkmLinkMsg = "That isn't a valid team code."; return pkmDrawLink(); }
      return pkmFriendBattle(f, a === "fight2");
    }
    if (a === "offer") { pkmLinkOut = pkmTradeOffer(val(".lk-pick")) || ""; pkmLinkMsg = pkmLinkOut ? "Offer created. Send the code to your friend." : pkmLinkMsg; return pkmDrawLink(); }
    if (a === "cancel-offer") { pkmSave("pkm_trade_offer", null); pkmLinkOut = ""; pkmLinkMsg = "Offer cancelled."; return pkmDrawLink(); }
    if (a === "trade") {
      const err = await pkmTradeReceive(val(".lk-trade"));
      pkmLinkMsg = err || "Trade complete!";
      if (!err) pkmLinkOut = "";
      return pkmDrawLink();
    }
    if (a === "redeem") { const r = pkmRedeem(val(".lk-redeem")); pkmLinkMsg = r.err || r.text; return pkmDrawLink(); }
    if (a === "mkgift") {
      const r = pkmMakeGift(val(".lk-coins"), val(".lk-item"), val(".lk-qty"));
      if (r.err) pkmLinkMsg = r.err;
      else { pkmLinkOut = r.code; pkmLinkMsg = "Gift code created. What you put in left your Bag."; }
      return pkmDrawLink();
    }
  }

  // ---------- Achievements for the new features ----------
  PKM_ACH.push(
    ...PKM_REGIONS.slice(1).map((r) => [`champ_${r.id}`, r.icon, `${r.name} Champion`, `Beat the ${r.name} Champion`, () => (pkmRegionDone(r.id) ? 1 : 0), 1]),
    ["champ_all", "👑", "Master of every region", "Beat all six Champions", (p) => p._champs, 6],
    ["badges48", "🎖️", "Badge collector", "Earn all 48 Gym badges", (p) => p._badges, 48],
    ["tower10", "🗼", "Tower climber", "Reach a Tower streak of 10", (p) => p._towerBest, 10],
    ["tower25", "🏯", "Tower veteran", "Reach a Tower streak of 25", (p) => p._towerBest, 25],
    ["tower50", "🏰", "Tower legend", "Reach a Tower streak of 50", (p) => p._towerBest, 50],
    ["rival_all", "😤", "Rivalry settled", "Beat every stage of your rival", (p) => p._rivalStage, 8],
    ["hatch1", "🥚", "It's hatching!", "Hatch an Egg", (p) => p.hatched || 0, 1],
    ["hatch10", "🐣", "Breeder", "Hatch 10 Eggs", (p) => p.hatched || 0, 10],
    ["legend1", "🌟", "Legend hunter", "Catch a legendary Pokémon from the hunt", (p) => p.legends || 0, 1],
    ["legend5", "💫", "Legend collector", "Catch 5 legendary Pokémon from the hunt", (p) => p.legends || 0, 5],
    ["mega1", "💠", "Mega power", "Mega Evolve in battle", (p) => p.megas || 0, 1],
    ["z1", "Ⓩ", "Full Z-Power", "Use a Z-Move", (p) => p.zmoves || 0, 1],
    ["trade1", "🔁", "Swap meet", "Trade a Pokémon", (p) => p.trades || 0, 1],
    ["gift1", "🎁", "Mystery Gift", "Redeem a gift code", (p) => p.gifts || 0, 1],
    ["dexregion", "📖", "Regional complete", "Complete the Pokédex of one region", (p) => p._dexRegions, 1]
  );
  {
    const pv = pkmProgressView;
    pkmProgressView = function () {
      const p = pv.apply(this, arguments);
      p._champs = Object.values(pkmChamps()).filter((v) => v > 0).length;
      p._towerBest = pkmTower().best;
      p._rivalStage = pkmRival().stage;
      p._dexRegions = PKM_REGIONS.filter((r) => { const d = pkmDexRegion(r); return d.have >= d.total; }).length;
      return p;
    };
  }

  // ---------- Styles for the new panels ----------
  pkmStyle(`
    .pkm-set.pkm-tower,.pkm-set.pkm-daycare,.pkm-set.pkm-link{width:min(560px,96vw);max-height:92vh;overflow:auto}
    .pkm-set.pkm-legends{width:min(860px,96vw);max-height:92vh;overflow:auto}
    .tw-head{background:linear-gradient(90deg,#6a3fb5,#3f2a7a)!important}
    .lg-head{background:linear-gradient(90deg,#d49b1a,#8a5a06)!important}
    .dc-head{background:linear-gradient(90deg,#d6758a,#8c3f55)!important}
    .lk-head{background:linear-gradient(90deg,#2a9d8f,#1b6b62)!important}
    .tw-body,.lg-body,.dc-body,.lk-body{padding:12px 16px 16px}
    .tw-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:10px}
    .tw-stats div{background:rgba(255,255,255,.07);border-radius:12px;padding:10px;text-align:center;display:flex;flex-direction:column;gap:2px}
    .tw-stats b{font-size:24px}
    .tw-next{text-align:center;margin:8px 0;font-weight:800}
    .tw-rewards{margin-top:14px;display:grid;gap:3px;font-size:12.5px}
    .lg-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px}
    .lg-card{display:flex;flex-direction:column;align-items:center;gap:3px;text-align:center;padding:8px;border-radius:12px;background:#1b1f33;border:1px solid #2c3350}
    .lg-card.locked img{filter:grayscale(1) brightness(.4)}
    .lg-card.caught{border-color:#ffcb05}
    .lg-card img{width:72px;height:72px;image-rendering:pixelated}
    .lg-name{font-weight:800}
    .lg-req{font-size:11px;min-height:28px}
    .dc-slots{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:10px 0}
    .dc-slot{display:flex;flex-direction:column;align-items:center;gap:3px;padding:10px;border-radius:12px;background:rgba(255,255,255,.07);min-height:130px;justify-content:center}
    .dc-slot.empty{border:1px dashed rgba(255,255,255,.25);background:transparent}
    .dc-slot img{width:72px;height:72px;image-rendering:pixelated}
    .dc-put{display:flex;gap:8px;margin:10px 0}
    .dc-put select,.lk-pick,.lk-item,.lk-body input,.lk-body textarea{background:#0f1220;color:#e8eaf6;border:1px solid #2c3350;border-radius:8px;padding:6px 8px;font-size:13px}
    .dc-put select{flex:1}
    .dc-eggs{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
    .dc-egg{background:rgba(255,255,255,.07);border-radius:12px;padding:8px;text-align:center}
    .dc-egg-ico{font-size:30px}
    .lk-l{display:flex;flex-direction:column;gap:4px;margin:10px 0;font-size:12.5px}
    .lk-l textarea{width:100%;box-sizing:border-box;resize:vertical;font-family:monospace;font-size:11px}
    .lk-body .pkm-btns{margin:8px 0;flex-wrap:wrap;gap:6px}
    /* Battle field: weather, terrain and time of day */
    .pkb-st.st-dyn{background:#d6204a;color:#fff}.pkb-st.st-tera{background:linear-gradient(90deg,#7de3ff,#d77dff);color:#222}
    .pkb-st.st-cnf{background:#c9a14a;color:#222}.pkb-st.st-sub{background:#444;color:#fff}
    .pkb-env{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 6px}
    .pkb-env-chip{font-size:11.5px;font-weight:700;padding:2px 9px;border-radius:999px;background:rgba(255,255,255,.12)}
    .pkb-env-chip.w-rain{background:rgba(79,163,255,.3)}.pkb-env-chip.w-sun{background:rgba(255,160,40,.3)}
    .pkb-env-chip.w-sand{background:rgba(201,161,74,.3)}.pkb-env-chip.w-hail{background:rgba(159,227,255,.3)}
    .pkb-field.night{background:radial-gradient(ellipse 34% 12% at 76% 40%,rgba(30,70,30,.5),transparent 70%),radial-gradient(ellipse 36% 12% at 24% 92%,rgba(30,70,30,.5),transparent 70%),linear-gradient(180deg,#141a3d 0%,#2a3566 42%,#3d6b3a 43%,#2c5a2a 100%)}
    .pkb-field.w-rain{box-shadow:inset 0 0 0 2px rgba(79,163,255,.55)}
    .pkb-field.w-sun{box-shadow:inset 0 0 40px rgba(255,190,60,.45)}
    .pkb-field.w-sand{box-shadow:inset 0 0 40px rgba(201,161,74,.55)}
    .pkb-field.w-hail{box-shadow:inset 0 0 40px rgba(220,245,255,.55)}
    .pkb-special{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:6px 0}
    .pkb-move.pkb-z{box-shadow:0 0 0 2px #ffcb05,0 0 14px rgba(255,203,5,.7)}
    .tr-regions{display:flex;gap:4px;flex-wrap:wrap;padding:0 16px;margin-bottom:6px}
    .tr-regions button{all:unset;cursor:pointer;padding:6px 12px;border-radius:999px;font-size:12.5px;background:rgba(255,255,255,.08)}
    .tr-regions button[aria-selected="true"]{background:#ffcb05;color:#222;font-weight:800}
    .tr-regions button:focus-visible{outline:2px solid #ffcb05}
    .tr-rival input{background:#0f1220;color:#e8eaf6;border:1px solid #2c3350;border-radius:8px;padding:3px 6px;font-size:12.5px;width:96px}
    .dx-reg{margin-bottom:10px}
    .dx-steps{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-top:6px}
    .dx-step{background:rgba(255,255,255,.06);border-radius:10px;padding:6px;text-align:center;font-size:11.5px;display:flex;flex-direction:column;gap:3px}
    .dx-step.got{opacity:.55}
    @media (max-width:560px){.dc-eggs{grid-template-columns:repeat(2,1fr)}.dx-steps{grid-template-columns:repeat(2,1fr)}}
  `, "pkm-v37");

  // =====================================================================
  //  3.8: levels that follow your progress, a world map with places to
  //  explore, and an Options panel (difficulty, speed, tools)
  // =====================================================================
  // ---------- Levels ----------
  // Wild Pokémon used to copy your partner's level, so everything got stronger as fast as you did. Now the world's level
  // follows your Gym progress (the next Gym Leader's level), and the XP you earn drops when you fight weaker Pokémon.
  const pkmLevelMode = () => GM_getValue("pkm_level_mode", "area"); // "area" | "mixed" | "party"
  const pkmDiffOffset = () => ({ easy: -3, normal: 0, hard: 3 }[pkmDifficulty()] || 0);
  /** Level of the next Gym Leader you haven't beaten (100 once you have every badge). */
  function pkmAreaLevel() {
    const bs = pkmBadges();
    const g = PKM_GYMS.find((x) => !bs.includes(x.n));
    return g ? g.lvl : MAX_LEVEL;
  }
  function pkmWildLevel(partyLevel) {
    const mode = pkmLevelMode();
    // Never far above your lead Pokémon, so a new Lv 1 starter isn't thrown at Lv 10 Pokémon
    const area = Math.min(pkmClamp(pkmAreaLevel() - pkmRand(2, 8), 2, MAX_LEVEL), (partyLevel || 5) + 2);
    const party = pkmClamp((partyLevel || 5) + pkmRand(-3, 1), 2, MAX_LEVEL);
    const lvl = mode === "party" ? party : mode === "mixed" ? Math.round((area + party) / 2) : area;
    return pkmClamp(lvl + pkmDiffOffset(), 2, MAX_LEVEL);
  }
  function pkmTrainerBase() {
    const mode = pkmLevelMode();
    const party = activeStats().level || 5;
    const area = Math.min(pkmAreaLevel() - 3, party + 1);
    return pkmClamp((mode === "party" ? party : mode === "mixed" ? Math.round((party + area) / 2) : area) + pkmDiffOffset(), 3, MAX_LEVEL);
  }
  function pkmSafariBase() {
    const mode = pkmLevelMode();
    const party = activeStats().level || 10;
    const area = Math.min(pkmAreaLevel(), party + 3);
    return pkmClamp((mode === "party" ? party : mode === "mixed" ? Math.round((party + area) / 2) : area) + pkmDiffOffset(), 5, MAX_LEVEL);
  }
  /** XP for defeating a Pokémon: the games' formula, so beating much weaker Pokémon gives little. */
  function pkmXpFor(foe, me, trainer) {
    const f = foe.level, p = me.level;
    const x = ((foe.baseExp * f) / 5) * Math.pow((2 * f + 10) / (f + p + 10), 2.5) + 1;
    const mult = { easy: 1.25, normal: 1, hard: 0.85 }[pkmDifficulty()] || 1;
    return Math.max(1, Math.floor(x * (trainer ? 1.5 : 1) * mult));
  }

  // ---------- World map ----------
  const pkmZ = (id, name, icon, lv, req, theme, pool) => ({ id, name, icon, lv, req, theme, pool });
  const PKM_ZONES = {
    kanto: [
      pkmZ("kanto-route1", "Route 1", "🌱", [3, 8], 0, "grass", ["pidgey", "rattata", "spearow", "nidoran-f", "nidoran-m", "caterpie", "weedle"]),
      pkmZ("viridian-forest", "Viridian Forest", "🌲", [6, 12], 0, "forest", ["caterpie", "metapod", "weedle", "kakuna", "pikachu", "pidgey", "oddish", "bellsprout"]),
      pkmZ("mt-moon", "Mt. Moon", "🌙", [10, 17], 1, "cave", ["zubat", "geodude", "paras", "clefairy", "sandshrew", "rattata", "onix"]),
      pkmZ("cerulean-cape", "Cerulean Cape", "🌊", [17, 26], 3, "water", ["goldeen", "psyduck", "poliwag", "staryu", "tentacool", "krabby", "horsea"]),
      pkmZ("rock-tunnel", "Rock Tunnel", "🕳️", [26, 38], 5, "cave", ["machop", "geodude", "graveler", "onix", "golbat", "cubone", "kangaskhan"]),
      pkmZ("victory-road", "Victory Road", "🏔️", [38, 48], 7, "mountain", ["machoke", "golbat", "graveler", "rhyhorn", "onix", "arbok", "venomoth"]),
    ],
    johto: [
      pkmZ("johto-route29", "Route 29", "🌾", [44, 52], 0, "grass", ["furret", "skiploom", "pidgeotto", "raticate", "ledian", "marill", "sunflora"]),
      pkmZ("ilex-forest", "Ilex Forest", "🌳", [48, 56], 0, "forest", ["parasect", "gloom", "pineco", "golbat", "heracross", "scyther", "noctowl"]),
      pkmZ("union-cave", "Union Cave", "🕳️", [52, 60], 2, "cave", ["golbat", "onix", "quagsire", "graveler", "sandslash", "wobbuffet", "dugtrio"]),
      pkmZ("lake-of-rage", "Lake of Rage", "🐟", [58, 66], 4, "water", ["gyarados", "seaking", "dewgong", "octillery", "politoed", "lanturn", "quagsire"]),
      pkmZ("mt-mortar", "Mt. Mortar", "💦", [64, 72], 6, "mountain", ["machoke", "hitmontop", "raticate", "golbat", "rhydon", "poliwrath", "kingler"]),
      pkmZ("dragons-den", "Dragon's Den", "🐉", [70, 78], 8, "cave", ["dragonair", "kingdra", "gyarados", "seadra", "ampharos", "lapras"]),
    ],
    hoenn: [
      pkmZ("hoenn-route101", "Route 101", "🌿", [56, 64], 0, "grass", ["linoone", "mightyena", "swellow", "kirlia", "pelipper", "masquerain", "vigoroth"]),
      pkmZ("petalburg-woods", "Petalburg Woods", "🌲", [60, 68], 0, "forest", ["dustox", "beautifly", "breloom", "vigoroth", "swellow", "kirlia", "ninjask"]),
      pkmZ("granite-cave", "Granite Cave", "🕳️", [64, 72], 2, "cave", ["lairon", "hariyama", "sableye", "nosepass", "golbat", "graveler", "mawile"]),
      pkmZ("route-119", "Route 119", "🌧️", [68, 76], 4, "water", ["whiscash", "lombre", "pelipper", "seaking", "wailmer", "sharpedo", "tropius"]),
      pkmZ("jagged-pass", "Jagged Pass", "🌋", [72, 80], 6, "mountain", ["camerupt", "machoke", "grumpig", "torkoal", "absol", "medicham"]),
      pkmZ("sky-pillar", "Sky Pillar", "🗼", [76, 84], 8, "mountain", ["altaria", "claydol", "sableye", "banette", "dusclops", "medicham", "flygon"]),
    ],
    sinnoh: [
      pkmZ("sinnoh-route201", "Route 201", "🌸", [68, 76], 0, "grass", ["staravia", "bibarel", "kricketune", "roselia", "luxio", "lopunny", "rapidash"]),
      pkmZ("eterna-forest", "Eterna Forest", "🌲", [72, 80], 0, "forest", ["beautifly", "kricketune", "roselia", "gloom", "heracross", "drifblim", "ambipom"]),
      pkmZ("oreburgh-gate", "Oreburgh Gate", "⛏️", [76, 84], 2, "cave", ["golbat", "graveler", "machoke", "onix", "bronzong", "drapion"]),
      pkmZ("lake-valor", "Lake Valor", "💧", [80, 88], 4, "water", ["gyarados", "floatzel", "gastrodon", "golduck", "mantine", "lumineon"]),
      pkmZ("mt-coronet", "Mt. Coronet", "🏔️", [84, 92], 6, "mountain", ["crobat", "machamp", "gabite", "medicham", "rhydon", "lucario"]),
      pkmZ("snowpoint-temple", "Snowpoint Temple", "❄️", [88, 96], 8, "snow", ["glalie", "abomasnow", "mamoswine", "froslass", "weavile", "walrein", "glaceon"]),
    ],
    unova: [
      pkmZ("unova-route2", "Route 2", "🌾", [78, 86], 0, "grass", ["herdier", "watchog", "liepard", "tranquill", "swadloon", "audino"]),
      pkmZ("pinwheel-forest", "Pinwheel Forest", "🌲", [82, 90], 0, "forest", ["leavanny", "whirlipede", "whimsicott", "lilligant", "sawsbuck", "swoobat", "throh"]),
      pkmZ("chargestone-cave", "Chargestone Cave", "⚡", [86, 94], 2, "cave", ["boldore", "galvantula", "ferrothorn", "klang", "eelektrik", "swoobat", "magneton"]),
      pkmZ("undella-bay", "Undella Bay", "🌊", [90, 98], 4, "water", ["jellicent", "carracosta", "seismitoad", "swanna", "alomomola", "gyarados"]),
      pkmZ("twist-mountain", "Twist Mountain", "🏔️", [92, 100], 6, "mountain", ["gigalith", "durant", "excadrill", "beartic", "cryogonal", "scrafty"]),
      pkmZ("giant-chasm", "Giant Chasm", "🌌", [94, 100], 8, "cave", ["fraxure", "golurk", "bisharp", "mandibuzz", "braviary", "haxorus"]),
    ],
    kalos: [
      pkmZ("kalos-route2", "Route 2", "🌼", [86, 94], 0, "grass", ["diggersby", "talonflame", "vivillon", "furfrou", "gogoat", "pangoro"]),
      pkmZ("santalune-forest", "Santalune Forest", "🌲", [90, 98], 0, "forest", ["vivillon", "raichu", "gogoat", "florges", "meowstic", "honchkrow"]),
      pkmZ("connecting-cave", "Connecting Cave", "🕳️", [92, 100], 2, "cave", ["crobat", "whiscash", "excadrill", "gigalith", "carbink", "claydol"]),
      pkmZ("azure-bay", "Azure Bay", "🏖️", [94, 100], 4, "water", ["clawitzer", "barbaracle", "dragalge", "gyarados", "starmie", "malamar"]),
      pkmZ("frost-cavern", "Frost Cavern", "🧊", [96, 100], 6, "snow", ["avalugg", "weavile", "mamoswine", "glalie", "abomasnow", "cryogonal"]),
      pkmZ("sea-spirits-den", "Sea Spirit's Den", "🌀", [98, 100], 8, "cave", ["goodra", "noivern", "tyrantrum", "aurorus", "gourgeist", "hawlucha"]),
    ],
  };
  const PKM_ZONE_THEME = {
    grass: "linear-gradient(180deg,#8fd3f7 0%,#c9ecff 42%,#a6dd7d 43%,#79c552 100%)", forest: "linear-gradient(180deg,#6aa86a 0%,#9fd08f 40%,#4f9a45 41%,#2f6b2f 100%)",
    cave: "linear-gradient(180deg,#3a3550 0%,#5a5472 45%,#4a4660 46%,#2c2840 100%)", water: "linear-gradient(180deg,#9fd8ff 0%,#6bb8f0 45%,#3b86d6 46%,#1f5fa8 100%)",
    mountain: "linear-gradient(180deg,#b8d4ee 0%,#d8e6f2 40%,#b1a58f 41%,#8a7e6a 100%)", snow: "linear-gradient(180deg,#dff1ff 0%,#f4fbff 45%,#e8f4fb 46%,#c7dded 100%)",
  };
  const pkmAllZones = () => PKM_REGIONS.flatMap((r) => PKM_ZONES[r.id].map((z) => ({ ...z, region: r.id })));
  const pkmZoneById = (id) => pkmAllZones().find((z) => z.id === id) || null;
  const pkmZoneOpen = (z) => { const ri = PKM_REGIONS.findIndex((r) => r.id === z.region); return pkmRegionOpen(ri) && pkmRegionBadges(pkmRegion(z.region)).length >= z.req && (!z.post || pkmRegionDone(z.post)); };
  let pkmForcedZone = null; // a zone for the next wild battle (set by the Explore panel)
  async function pkmZoneWild(z) {
    for (let t = 0; t < 4; t++) {
      const d = await pkmPokemonData(pkmPick(z.pool));
      if (!d) continue;
      const lvl = pkmClamp(pkmRand(z.lv[0], z.lv[1]) + pkmDiffOffset(), 2, MAX_LEVEL);
      const m = await pkmWildFrom(d, lvl, {});
      m.zone = z.id;
      return m;
    }
    return null;
  }
  function pkmZoneTrainer(z) {
    const c = pkmPick(PKM_TRAINER_CLASSES);
    const n = Math.random() < 0.45 ? 3 : 2;
    return { title: c.title, name: pkmPick(c.names), sprite: `${PKM_TRAINER_IMG}${c.sprite}.png`, lose: c.lose, gym: 0, zone: z.id,
      team: Array.from({ length: n }, () => [pkmPick(z.pool), pkmClamp(pkmRand(z.lv[0], z.lv[1]) + pkmDiffOffset(), 2, MAX_LEVEL)]) };
  }
  let pkmMapPanel = null;
  let pkmMapRegion = null;
  let pkmMapSel = null;
  function pkmCloseMap() { if (pkmMapPanel) pkmMapPanel.remove(); pkmMapPanel = null; }
  function pkmOpenMap(region) {
    if (typeof region === "string") pkmMapRegion = region;
    if (!pkmMapRegion) {
      let i = PKM_REGIONS.findIndex((r, ix) => pkmRegionOpen(ix) && !pkmRegionDone(r.id));
      if (i < 0) i = PKM_REGIONS.length - 1;
      pkmMapRegion = PKM_REGIONS[i].id;
    }
    if (!pkmMapPanel) {
      const P = (pkmMapPanel = document.createElement("div"));
      P.className = "pkm-panel pkm-modal pkm-set pkm-map";
      P.setAttribute("role", "dialog");
      P.setAttribute("aria-label", "World map");
      P.onclick = (e) => {
        const a = e.target.closest("[data-a]")?.dataset.a;
        if (a === "close") return pkmCloseMap();
        const rg = e.target.closest("[data-region]");
        if (rg) { pkmMapSel = null; return pkmOpenMap(rg.dataset.region); }
        const mode = e.target.closest("[data-lvmode]");
        if (mode) { GM_setValue("pkm_level_mode", mode.dataset.lvmode); return pkmDrawMap(); }
        const n = e.target.closest("[data-zone]");
        if (n) { pkmMapSel = n.dataset.zone; return pkmDrawMap(); }
        if (a === "go") { const z = pkmZoneById(pkmMapSel); if (z && pkmZoneOpen(z)) { pkmCloseMap(); pkmOpenExplore(z.id); } }
      };
      pkmMount(P);
    }
    pkmDrawMap();
  }
  function pkmDrawMap() {
    const P = pkmMapPanel;
    if (!P) return;
    const ri = PKM_REGIONS.findIndex((r) => r.id === pkmMapRegion);
    const reg = PKM_REGIONS[ri];
    const zones = PKM_ZONES[reg.id].map((z) => ({ ...z, region: reg.id }));
    const rows = Math.max(1, Math.ceil(zones.length / 3));
    const pos = zones.map((_, i) => { const row = Math.floor(i / 3); const col = row % 2 ? 2 - (i % 3) : i % 3; return [16 + col * 34, rows === 1 ? 50 : 18 + (row * 64) / (rows - 1)]; });
    const sel = zones.find((z) => z.id === pkmMapSel) || null;
    const bs = pkmRegionBadges(reg).length;
    const mode = pkmLevelMode();
    P.innerHTML = `
      <div class="pkm-set-head mp-head"><span>🗺️ World map</span><button type="button" class="pkm-x" data-a="close" aria-label="Close" title="Close (Esc)">✕</button></div>
      <div class="tr-regions" role="tablist" aria-label="Regions">${PKM_REGIONS.map((r, i) => `<button type="button" role="tab" data-region="${r.id}" aria-selected="${r.id === reg.id}">${r.icon} ${r.name} ${pkmRegionOpen(i) ? "" : "🔒"}</button>`).join("")}</div>
      <div class="mp-board">
        <svg class="mp-lines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><polyline points="${pos.map((p) => `${p[0]},${p[1]}`).join(" ")}" /></svg>
        ${zones.map((z, i) => { const open = pkmZoneOpen(z); return `<button type="button" class="mp-node${open ? "" : " locked"}${sel && sel.id === z.id ? " sel" : ""}" style="left:${pos[i][0]}%;top:${pos[i][1]}%" data-zone="${z.id}" aria-label="${pkmEsc(z.name)}${open ? "" : " (locked)"}">
          <span class="mp-ico">${open ? z.icon : "🔒"}</span><span class="mp-name">${pkmEsc(z.name)}</span><span class="mp-lv">Lv ${z.lv[0]}–${z.lv[1]}</span></button>`; }).join("")}
      </div>
      <div class="mp-info">${sel ? (() => { const open = pkmZoneOpen(sel); return `<div><b>${sel.icon} ${pkmEsc(sel.name)}</b> <span class="pkm-dim">Lv ${sel.lv[0]}–${sel.lv[1]}</span></div>
          <div class="pkm-dim">Wild: ${sel.pool.map((n) => pkmEsc(pkmCap(n))).join(", ")}</div>
          ${open ? `<div class="pkm-btns"><button type="button" class="pkm-btn2 primary" data-a="go">👣 Explore</button></div>` : `<div class="pkm-dim">🔒 ${!pkmRegionOpen(ri) ? `Beat the ${PKM_REGIONS[ri - 1].name} Champion first.` : `Needs ${sel.req} ${reg.name} badges (you have ${bs}).`}</div>`}`; })() : `<div class="pkm-dim">Pick a place on the map. Each place has its own Pokémon and levels, and you can battle as you walk around, like in the Safari Zone.</div>`}</div>
      <div class="mp-mode"><span class="pkm-dim">Wild levels in normal battles:</span>
        ${[["area", "Follow my badges"], ["mixed", "Mixed"], ["party", "Match my Pokémon"]].map(([k, l]) => `<button type="button" class="pkm-btn2 ${mode === k ? "primary" : ""}" data-lvmode="${k}">${l}</button>`).join("")}
        <span class="pkm-dim">Now: about Lv ${pkmClamp(pkmAreaLevel() - 5, 2, MAX_LEVEL)} (next Gym: Lv ${pkmAreaLevel()}).</span></div>`;
  }
  // Explore a place: walk around and meet Pokémon, trainers and items, with the same look as the Safari Zone
  let pkmExplorePanel = null;
  let pkmExploreZone = null;
  let pkmExploreBusy = false;
  function pkmCloseExplore() { if (pkmExplorePanel) pkmExplorePanel.remove(); pkmExplorePanel = null; pkmExploreZone = null; }
  function pkmOpenExplore(zoneId, msg) {
    const z = pkmZoneById(zoneId || (pkmExploreZone && pkmExploreZone.id));
    if (!z) return;
    pkmExploreZone = z;
    if (!pkmExplorePanel) {
      const P = (pkmExplorePanel = document.createElement("div"));
      P.className = "pkm-panel pkm-modal pkm-set pkm-explore";
      P.setAttribute("role", "dialog");
      P.setAttribute("aria-label", "Exploring");
      P.onclick = (e) => {
        const a = e.target.closest("[data-a]")?.dataset.a;
        if (a === "close") return pkmCloseExplore();
        if (a === "map") { pkmCloseExplore(); return pkmOpenMap(); }
        if (a === "walk") return pkmExploreWalk();
      };
      pkmMount(P);
    }
    const st = pkmJSON("pkm_zone_stats", {});
    const s = st[z.id] || { walks: 0, battles: 0 };
    pkmExplorePanel.innerHTML = `
      <div class="pkm-set-head mp-head"><span>${z.icon} ${pkmEsc(z.name)}</span><button type="button" class="pkm-x" data-a="close" aria-label="Close" title="Close (Esc)">✕</button></div>
      <div class="sf-body">
        <div class="sf-bar"><span>📍 Lv ${z.lv[0]}–${z.lv[1]}</span><span>👣 Steps here <b>${s.walks}</b></span><span>⚔️ Battles <b>${s.battles}</b></span></div>
        <div class="pkb-field sf-field" style="background:${PKM_ZONE_THEME[z.theme]}"><div class="sf-grass">${z.icon}${z.icon}${z.icon}${z.icon}${z.icon}</div></div>
        <div class="pkb-msg" aria-live="polite">${pkmEsc(msg || "You look around. What will you do?")}</div>
        <div class="pk-controls pkb-controls sf-ctl">
          <button type="button" class="pk-btn pkb-act sf-walk" data-a="walk"><div class="pk-ico">👣</div><div class="pk-label">Walk around</div></button>
          <button type="button" class="pk-btn pkb-act" data-a="map"><div class="pk-ico">🗺️</div><div class="pk-label">Map</div></button>
        </div>
      </div>`;
    pkmBattleKeys(pkmExplorePanel.querySelector(".pk-controls"));
  }
  /** One step: usually a wild Pokémon, sometimes a trainer, an item or nothing. */
  async function pkmExploreWalk() {
    const z = pkmExploreZone;
    if (!z || pkmExploreBusy || battlePanel) return;
    pkmExploreBusy = true;
    try {
      const st = pkmJSON("pkm_zone_stats", {});
      const s = (st[z.id] = st[z.id] || { walks: 0, battles: 0 });
      s.walks++;
      pkmTrack("walks");
      pkmAddSteps(20);
      const r = Math.random();
      const back = () => { pkmPostBattle = () => pkmOpenExplore(z.id); };
      if (r < 0.55) {
        s.battles++;
        pkmSave("pkm_zone_stats", st);
        back();
        pkmForcedZone = z;
        pkmCloseExplore();
        openBattle();
        if (!battlePanel) { pkmForcedZone = null; pkmPostBattle = null; pkmOpenExplore(z.id); }
        return;
      }
      if (r < 0.65) {
        s.battles++;
        pkmSave("pkm_zone_stats", st);
        back();
        pkmCloseExplore();
        pkmStartTrainer(pkmZoneTrainer(z));
        if (!battlePanel) { pkmPostBattle = null; pkmOpenExplore(z.id); }
        return;
      }
      pkmSave("pkm_zone_stats", st);
      let msg = "The area is quiet. Nothing happened.";
      if (r < 0.80) {
        const it = pkmPick([[STORAGE.potions, 1, "Potion"], [STORAGE.balls, 2, "Poké Balls"], [STORAGE.greatBalls, 1, "Great Ball"], ["pkm_xattack", 1, "X Attack"], [STORAGE.potions, 2, "Potions"]]);
        pkmGive([it]);
        msg = `You found ${it[1]} × ${it[2]} on the ground!`;
      } else if (r < 0.88) {
        const c = Math.floor((z.lv[0] + z.lv[1]) * pkmRand(3, 6));
        setInt(STORAGE.coins, getInt(STORAGE.coins) + c);
        pkmTrack("coins", c);
        msg = `You found 💰 ${c} coins!`;
      } else if (r < 0.93) msg = "A wild Pokémon rustles in the distance, but it ran off.";
      playSound("ball");
      pkmOpenExplore(z.id, msg);
    } finally { pkmExploreBusy = false; }
  }
  // Zone encounters use the zone's own Pokémon and levels
  {
    const pw = pkmPickWild;
    pkmPickWild = async function (L) {
      const z = pkmForcedZone;
      if (z) { pkmForcedZone = null; const m = await pkmZoneWild(z); if (m) return m; }
      return pw.apply(this, arguments);
    };
  }

  // ---------- Options: difficulty, speed, teams, damage calculator, battle logs, what's new ----------
  const PKM_VERSION = "4.6";
  const PKM_CHANGES = [
    ["4.6", "Pick 1 of 3 random starters", [
      "🔰 New trainers are offered 3 random starters from the main games (Bulbasaur to Quaxly) instead of the whole Pokédex.",
      "🔒 Your starter choice is final: the three are saved so you can't re-roll, and the Change starter button is gone.",
      "🌐 With the game server on, reinstalling the script gives you the same three starters (and your pick) back.",
      "🎨 The starter menu now looks like the other menus, with sprites and a header bar."
    ]],
    ["4.5", "Quick match, guild shop, bonus pass & more", [
      "⚡ Quick match: find a ranked opponent automatically. 🏆 Best-of-3 live battles (first to 2 wins).",
      "🔁 In rotation battles the other trainer rotates too, and 🐾 in a horde you can catch the last Pokémon left.",
      "🛡️ Guilds: guild chat, a guild shop paid with guild points (from raid damage), and ranks: leader, officers and members.",
      "🎟️ Season pass bonus track (5000 coins) and a season ranking with prizes when the month ends.",
      "🌍 GTS: a wish list, a list of offers you can fill with Pokémon you already have, and 🧾 your trade history.",
      "🏭 Battle Frontier progress (Factory, Arcade, Pike, Hall, Castle) is checked by the server and has leaderboards.",
      "🪪 Profiles: pick a background and 3 favorite Pokémon, and like your friends' profiles.",
      "🤝 Community catch goal: everyone's catches add up, and when the goal is reached each helper gets an event Pokémon with a special move.",
      "Server admin: an admin action log, temporary suspensions and a blocked-words list for names."
    ]],
    ["4.4", "Guilds, season pass, ranked battles & more", [
      "⚔️ Live battles: your friend can now switch Pokémon, anyone with the code can watch, and 🏅 ranked battles change your live rating.",
      "💬 Trade chat with set messages (Looking for…, Offering…, GG!), with a ⚑ button to report a trainer.",
      "🛡️ Guilds: make or join one with a short tag, fight your guild's weekly raid boss together, and race other guilds on the leaderboard.",
      "🎟️ Season pass: 5 weekly missions give season points; 20 reward tiers each month, including 2 villain-boss outfits for your trainer look.",
      "🗼 Online Battle Tower runs are checked by the server (everyone faces the same foes on a run), so the Tower leaderboard is fair.",
      "🔔 Desktop alerts when an online trade or Wonder Trade finishes, or a friend sends a gift.",
      "🪪 Public trainer profile page you can share (turn it on in 🌐 Online → Friends).",
      "📕 National Dex across all your browsers, and send Pokémon straight to a friend's Home box.",
      "🎉 Seasonal places from the server admin, with costume Pokémon.",
      "Fixed: the Habitat map showed every place as locked."
    ]],
    ["4.3", "Live battles, friends, events & more", [
      "⚔️ Live battles with a friend: one of you makes a battle code, the other joins, and you battle turn by turn.",
      "🏆 Leaderboards for the Battle Tower, Pokédex, shiny species and the weekly ladder.",
      "🎉 Server events: a weekly Mystery Gift, a shared raid where everyone's damage adds up, and a Safari Zone outbreak.",
      "👥 Friends: add friends with a 12-digit friend code and send each one a gift a day (coins, items or a Pokémon).",
      "🔗 Share a battle replay as a link from Options → Battle logs, and watch replays others share.",
      "🎀 Online contests: enter a Pokémon each week and compete with other players' entries.",
      "Badges next to your name on the GTS, the leaderboards and your friends' lists.",
      "🗺️ Habitat map: which Pokémon live in each place, and which you still need.",
      "Weather events on the map: snowstorms bring Ice types, heatwaves Fire types, thunderstorms Electric types, and more.",
      "Your walking partner shows its mood. Click the bubble to see how it feels."
    ]],
    ["4.2", "Online trades, Camp, villains & more", [
      "🌐 Online: trade on the GTS with players everywhere, keep Pokémon in a Home box you can open in another browser, and Wonder Trade. It uses the game server at dstokesncstudio.com.",
      "Wonder Trade works without the server too: you get a random Pokémon from a list.",
      "⛺ Pokémon Camp: pet, feed and play with your party to raise friendship.",
      "Hidden Grottos (a Pokémon with its hidden ability) and hordes (5 wild Pokémon at once) on map walks.",
      "🌀 Ultra Wormholes after the Alola League: Ultra Beasts and legends, 3 trips a day.",
      "🦹 Villain teams: a 4-chapter story in every region, from Team Rocket to Macro Cosmos.",
      "📊 Species progress on the trainer card: catches, shinies and shiny odds for every species.",
      "Dawn, dusk and night tint the battle background, and attacks have animations for each type.",
      "🧩 Gym puzzles before your first challenge of each Gym Leader (you can turn them off in Options).",
      "🧢 Trainer look: pick your outfit, card color and title for the trainer card and card image."
    ]],
    ["4.1", "Side menu, updates, triples & more", [
      "The Poké Ball menu is now a side panel with groups and a search box, so it fits on any screen.",
      "Update checks work again: the game checks GitHub for Pokemon Battle (Full Edition).user.js, shows a banner when a new version is out, and Options → What's new has a Check for updates button.",
      "Triple battles (3 vs 3) and rotation battles (a free rotation each turn) from Trainers.",
      "Telepathy works: moves that hit everyone, like Earthquake and Surf, now also hit your partner unless it has Telepathy.",
      "Female Pokémon with a different look use their own sprite (like Pikachu's heart-shaped tail).",
      "Gender evolutions: Combee → Vespiquen and Salandit → Salazzle (female), Kirlia → Gallade with a Dawn Stone (male), Snorunt → Froslass (female), Burmy → Wormadam or Mothim.",
      "Gigantamax Factor: Pokémon caught from a G-Max Max Raid can Gigantamax. Pokémon you had before 4.1 keep the ability.",
      "Shiny odds grow as you catch more of a species: x1.5 at 10, x2 at 25, x3 at 50 and x4 at 100.",
      "Nuzlocke panel with a graveyard, plus hardcore rules: no items in battle and a level cap at the next Gym Leader's level.",
      "Ribbons tab on the trainer card for your Contest winners.",
      "Save codes: copy your whole save as text and restore it on another computer.",
      "Bag: Select many to release several Pokémon at once."
    ]],
    ["4.0", "Battle tricks, wild doubles, Nuzlocke & more", [
      "Helping Hand, Follow Me and Friend Guard in double battles (Telepathy is listed but has no effect yet, because allies never hit each other).",
      "Trick Room, Tailwind, Leech Seed, Taunt and Encore.",
      "Form-changing abilities: Aegislash's Stance Change, Mimikyu's Disguise and Wishiwashi's Schooling.",
      "Wild double battles, and double rematches against Gym Leaders whose badge you have.",
      "Regional forms in the wild, gender, breeding needs a male and a female (or a Ditto), and the Masuda method for shiny Eggs.",
      "Pokérus, a crafting bench, fishing and surfing at water places, hourly weather and roaming legendaries.",
      "Type challenge, habitat tracking, and a quest chain with your rival in every region.",
      "Weekly ladder, trainer card image, and Battle Tower record codes.",
      "Box tools: sort, and release many Pokémon at once. The Bag hides items you have none of.",
      "Battle Hall and Battle Castle in the Frontier.",
      "Seasonal event places with costume legendaries, Ultra Space in Alola and Max Raid dens with Gigantamax bosses in Galar.",
      "Nuzlocke mode: one catch per place, and fainted Pokémon are released.",
      "New players: sound starts off, wild Pokémon stay close to your team's level, and the berry garden dropdown no longer closes when clicked."
    ]],
    ["3.9", "Doubles, Alola, Galar & more", [
      "Double battles (2 vs 2) against trainer duos, friends' team codes, and the Tower in Doubles week. Mega, Z, Tera and Dynamax work in doubles too.",
      "Alola (Island Challenge) and Galar (Gym Challenge): 16 more badges, two more Leagues, 12 more places on the map, and new legendaries.",
      "Mega Evolution now needs the Pokémon to hold its own Mega Stone (47 stones in the PokéMart).",
      "Signature G-Max moves when Gigantamaxed, Tera Blast after Terastallizing, and Terapagos's Stellar form.",
      "Move tutor and TMs (new TMs tab in the PokéMart).",
      "Pokédex entries with base stats, abilities and where to find each Pokémon.",
      "Hourly swarms and a Mystery Dungeon that opens every 2 hours on the map.",
      "Trainer rank on the trainer card, and a different Battle Tower rule every week.",
      "Auto battle for wild fights, move tooltips, colorblind-friendly type labels and bigger text.",
    ]],
    ["3.8", "Battle & levels", [
      "Status moves are in: stat boosts and drops, Thunder Wave, Toxic, Recover, Protect, Substitute, Reflect, weather and terrain moves, Stealth Rock, Spikes and more.",
      "Flinching, confusion, multi-hit moves, two-turn moves (Fly, Solar Beam), fixed-damage moves, recharge moves, and accuracy and evasion stages.",
      "Wild levels now follow your Gym progress instead of copying your partner's level. Change it on the map or in Options (Follow my badges, Mixed, Match my Pokémon).",
      "XP now drops when you fight much weaker Pokémon, like in the games.",
      "World map: explore places in all six regions with their own Pokémon, trainers, items and levels.",
      "Options: difficulty, battle speed, skip animations, team presets, damage calculator and battle logs with replay.",
      "Terastallization (Tera Orb) and Dynamax/Gigantamax (Dynamax Band): one special action per battle, shared with Mega Evolution and Z-Moves.",
      "Training center: EVs (from battles, vitamins and a passive training area), Nature Mints, Ability Capsule and Patch, Tera Shards. Hidden abilities and egg moves for breeding.",
      "Battle Frontier: Battle Factory (rental teams), Battle Arcade (roulette boosts) and Battle Pike (doors), next to the Battle Tower.",
      "Raid den: a shared boss every 3 hours with allies and a turn limit. Berry garden, Contests with ribbons, and Story quest chains with recurring characters.",
      "League rematches with stronger teams after you become Champion.",
    ]],
    ["3.7", "Regions & more", [
      "Johto, Hoenn, Sinnoh, Unova and Kalos with Gyms and Leagues, Battle Tower, Rival, Legendary hunt, Daycare and Eggs, Mega Evolution and Z-Moves, weather and terrain, friend battles, trades and gift codes.",
    ]],
  ];
  let pkmOptionsPanel = null;
  let pkmOptionsTab = "game";
  let pkmReplayTimer = null;
  let pkmReplayLog = null;
  let pkmCalcOut = "";
  const pkmPresets = () => pkmJSON("pkm_presets", {});
  function pkmCloseOptions() { clearInterval(pkmReplayTimer); if (pkmOptionsPanel) pkmOptionsPanel.remove(); pkmOptionsPanel = null; }
  function pkmOpenOptions(tab) {
    if (typeof tab === "string") pkmOptionsTab = tab;
    if (!pkmOptionsPanel) {
      const P = (pkmOptionsPanel = document.createElement("div"));
      P.className = "pkm-panel pkm-modal pkm-set pkm-options";
      P.setAttribute("role", "dialog");
      P.setAttribute("aria-label", "Options and tools");
      P.onclick = pkmOptionsClick;
      P.onchange = (e) => { if (e.target.matches(".oc-me")) pkmFillCalcMoves(); };
      pkmMount(P);
    }
    pkmDrawOptions();
  }
  function pkmDrawOptions() {
    const P = pkmOptionsPanel;
    if (!P) return;
    clearInterval(pkmReplayTimer);
    const diff = pkmDifficulty();
    const speed = Number(GM_getValue("pkm_battle_speed", 1)) || 1;
    const skip = GM_getValue("pkm_skip_anim", "false") === "true";
    const mode = pkmLevelMode();
    const btn = (attr, val, label, on) => `<button type="button" class="pkm-btn2 ${on ? "primary" : ""}" ${attr}="${val}" aria-pressed="${!!on}">${label}</button>`;
    let body = "";
    if (pkmOptionsTab === "game") {
      body = `<div class="bag-sec"><span>Difficulty</span></div>
        <div class="pkm-btns">${[["easy", "Easy"], ["normal", "Normal"], ["hard", "Hard"]].map(([k, l]) => btn("data-diff", k, l, diff === k)).join("")}</div>
        <div class="pkm-dim">Easy: foes are 3 levels lower, play randomly more often, and you earn 25% more XP. Hard: foes are 3 levels higher, choose better moves and use status moves more, and you earn 15% less XP.</div>
        <div class="bag-sec"><span>Wild and trainer levels</span></div>
        <div class="pkm-btns">${[["area", "Follow my badges"], ["mixed", "Mixed"], ["party", "Match my Pokémon"]].map(([k, l]) => btn("data-lvmode", k, l, mode === k)).join("")}</div>
        <div class="pkm-dim">Follow my badges: the world's level is set by the next Gym Leader, no matter how strong your Pokémon are (about Lv ${pkmClamp(pkmAreaLevel() - 5, 2, MAX_LEVEL)} now). Match my Pokémon is the old behavior.</div>
        <div class="bag-sec"><span>Battle speed</span></div>
        <div class="pkm-btns">${[1, 2, 4].map((n) => btn("data-speed", n, `${n}×`, speed === n)).join("")}${btn("data-skip", "toggle", skip ? "✓ Skip animations" : "Skip animations", skip)}</div>
        <div class="bag-sec"><span>Save data</span></div>
        <div class="pkm-btns"><button type="button" class="pkm-btn2" data-a="savetools">💾 Export, import and backups</button></div>`;
    } else if (pkmOptionsTab === "teams") {
      const pre = pkmPresets();
      const party = getObj(STORAGE.party) || {};
      const names = Object.keys(pre);
      body = `<div class="pkm-dim">Save your six party Pokémon as a team and load it later. Loading moves those Pokémon to the front of your Bag.</div>
        <div class="pkm-btns"><input class="oc-pname" maxlength="16" placeholder="Team name" aria-label="Team name"><button type="button" class="pkm-btn2 primary" data-a="savepreset">Save current party</button></div>
        ${names.length ? names.map((n) => `<div class="oc-preset"><div><b>${pkmEsc(n)}</b><div class="pkm-dim">${pre[n].map((id) => pkmEsc(pkmCap((party[id] || { name: "(gone)" }).name))).join(", ")}</div></div>
          <div class="pkm-btns"><button type="button" class="pkm-btn2 primary" data-load="${pkmEsc(n)}">Load</button><button type="button" class="pkm-btn2 danger" data-del="${pkmEsc(n)}">Delete</button></div></div>`).join("") : `<div class="pkm-dim">No saved teams yet.</div>`}`;
    } else if (pkmOptionsTab === "calc") {
      const party = getObj(STORAGE.party) || {};
      const st = getObj(STORAGE.stats) || {};
      const opts = Object.entries(party).slice(0, 60).map(([id, p]) => `<option value="${pkmEsc(id)}">${pkmEsc(pkmCap(p.name))} (Lv ${(st[id] || {}).level || 1})</option>`).join("");
      body = `<div class="pkm-dim">Check how hard your Pokémon hit a target, and how hard it hits back. The target is a typical one with a random nature and IVs, so the numbers are a guide.</div>
        <label class="lk-l">Your Pokémon <select class="oc-me">${opts}</select></label>
        <label class="lk-l">Move <select class="oc-mv"><option value="">Loading…</option></select></label>
        <div class="pkm-btns"><input class="oc-foe" placeholder="Target (e.g. gengar)" aria-label="Target Pokémon" value="${pkmEsc(GM_getValue("pkm_calc_foe", ""))}"><input class="oc-lv" type="number" min="1" max="100" value="${Number(GM_getValue("pkm_calc_lv", 50)) || 50}" style="width:70px" aria-label="Target level"><button type="button" class="pkm-btn2 primary" data-a="calc">Calculate</button></div>
        <div class="oc-out" aria-live="polite">${pkmCalcOut}</div>`;
    } else if (pkmOptionsTab === "logs") {
      const logs = pkmJSON("pkm_battle_logs", []);
      body = pkmReplayLog
        ? `<div class="pkm-btns"><button type="button" class="pkm-btn2" data-a="logback">← Back</button><button type="button" class="pkm-btn2 primary" data-a="replay">▶ Replay</button></div><div class="oc-replay" aria-live="polite">${pkmReplayLog.lines.map((l) => `<div>${pkmEsc(l)}</div>`).join("")}</div>`
        : logs.length ? logs.slice().reverse().map((l, i) => `<div class="oc-preset"><div><b>${pkmEsc(l.title)}</b> <span class="pkm-dim">${pkmEsc(l.result || "")} · ${new Date(l.t).toLocaleString()}</span><div class="pkm-dim">${l.lines.length} lines</div></div>
            <button type="button" class="pkm-btn2" data-log="${logs.length - 1 - i}">Open</button></div>`).join("") : `<div class="pkm-dim">Your last battles show up here, with a replay. Fight one first.</div>`;
    } else {
      body = PKM_CHANGES.map(([v, t, items]) => `<div class="bag-sec"><span>Version ${v}: ${pkmEsc(t)}</span></div><ul class="oc-list">${items.map((i) => `<li>${pkmEsc(i)}</li>`).join("")}</ul>`).join("");
    }
    P.innerHTML = `
      <div class="pkm-set-head op-head"><span>⚙️ Options & tools</span><button type="button" class="pkm-x" data-a="close" aria-label="Close" title="Close (Esc)">✕</button></div>
      <div class="bag-tabs" role="tablist">${[["game", "Game"], ["teams", "Teams"], ["calc", "Calculator"], ["logs", "Battle logs"], ["new", "What's new"]].map(([k, l]) => `<button type="button" role="tab" data-tab="${k}" aria-selected="${pkmOptionsTab === k}">${l}</button>`).join("")}</div>
      <div class="lk-body">${body}</div>`;
    if (pkmOptionsTab === "calc") pkmFillCalcMoves();
  }
  async function pkmFillCalcMoves() {
    const P = pkmOptionsPanel;
    const sel = P && P.querySelector(".oc-mv");
    if (!sel) return;
    const id = P.querySelector(".oc-me") && P.querySelector(".oc-me").value;
    const s = (getObj(STORAGE.stats) || {})[id] || {};
    const names = Array.isArray(s.moves) && s.moves.length ? s.moves : [];
    const mv = (await pkmMovesByNames(names)).filter((m) => m.cls !== "status");
    if (!pkmOptionsPanel) return;
    sel.innerHTML = mv.length ? mv.map((m) => `<option value="${pkmEsc(m.name)}">${pkmEsc(m.display)} (${m.type}, ${m.fixed ? "fixed" : m.power})</option>`).join("") : `<option value="">No attacking moves yet (battle once first)</option>`;
  }
  async function pkmCalcRun() {
    const P = pkmOptionsPanel;
    const id = P.querySelector(".oc-me").value;
    const mvName = P.querySelector(".oc-mv").value;
    const foeName = pkmSafeSlug(P.querySelector(".oc-foe").value.trim().toLowerCase().replace(/\s+/g, "-"));
    const lv = pkmClamp(parseInt(P.querySelector(".oc-lv").value, 10) || 50, 1, MAX_LEVEL);
    const out = P.querySelector(".oc-out");
    if (!id || !mvName || !foeName) { out.textContent = "Pick your Pokémon, a move, and type a target Pokémon's name."; return; }
    GM_setValue("pkm_calc_foe", foeName);
    GM_setValue("pkm_calc_lv", lv);
    out.textContent = "Calculating…";
    const me = await pkmBuildInstance(id);
    const foe = await pkmBuildMon(foeName, lv, { shiny: false });
    if (!me || !foe) { out.textContent = "Couldn't find that Pokémon."; return; }
    const sample = (a, d, m) => {
      const r = Array.from({ length: 200 }, () => pkmDamage(a, d, m, {}).dmg).sort((x, y) => x - y);
      return { min: r[0], max: r[r.length - 1], ko: r.filter((x) => x >= d.hp).length / r.length };
    };
    const mv = me.moves.find((m) => m.name === mvName) || (await pkmMovesByNames([mvName]))[0];
    const a = sample(me, foe, mv);
    const eff = pkmMoveEff(me, foe, mv);
    const pct = (n, hp) => Math.round((n / hp) * 100);
    const back = foe.moves.filter((m) => m.cls !== "status").map((m) => ({ m, r: sample(foe, me, m) }));
    out.innerHTML = `<div><b>${pkmEsc(me.display)}</b> Lv ${me.level} → <b>${pkmEsc(foe.display)}</b> Lv ${foe.level} (${pkmEsc(pkmCap(foe.nature))}, ${pkmEsc(pkmCap(foe.ability))}, ${foe.maxHP} HP)</div>
      <div>${pkmEsc(mv.display)}: <b>${a.min}–${a.max}</b> damage (${pct(a.min, foe.maxHP)}–${pct(a.max, foe.maxHP)}% of its HP)${eff > 1 ? ", super effective" : eff === 0 ? ", no effect" : eff < 1 ? ", not very effective" : ""}. Knock-out chance in one hit: ${Math.round(a.ko * 100)}%.</div>
      <div class="pkm-dim" style="margin-top:6px">Its attacks on you (${me.maxHP} HP):</div>${back.length ? back.map((x) => `<div>${pkmEsc(x.m.display)}: ${x.r.min}–${x.r.max} (${pct(x.r.min, me.maxHP)}–${pct(x.r.max, me.maxHP)}%)</div>`).join("") : "<div class='pkm-dim'>It only knows status moves.</div>"}`;
  }
  function pkmLoadPreset(name) {
    const pre = pkmPresets()[name];
    const party = getObj(STORAGE.party) || {};
    if (!pre) return;
    const ids = pre.filter((id) => party[id]);
    if (!ids.length) return pkmToast("None of those Pokémon are in your Bag anymore.");
    const next = {};
    for (const id of ids) next[id] = party[id];
    for (const id of Object.keys(party)) if (!next[id]) next[id] = party[id];
    setObj(STORAGE.party, next);
    pkmToast(`Team “${name}” loaded${ids.length < pre.length ? ` (${pre.length - ids.length} Pokémon are gone)` : ""}.`);
    if (typeof drawBag === "function" && bagPanel) drawBag();
  }
  async function pkmOptionsClick(e) {
    const P = pkmOptionsPanel;
    const t = e.target.closest("[data-tab]");
    if (t) { pkmOptionsTab = t.dataset.tab; pkmReplayLog = null; return pkmDrawOptions(); }
    const g = (k) => e.target.closest(`[${k}]`);
    if (g("data-diff")) { GM_setValue("pkm_difficulty", g("data-diff").dataset.diff); return pkmDrawOptions(); }
    if (g("data-lvmode")) { GM_setValue("pkm_level_mode", g("data-lvmode").dataset.lvmode); return pkmDrawOptions(); }
    if (g("data-speed")) { GM_setValue("pkm_battle_speed", Number(g("data-speed").dataset.speed)); return pkmDrawOptions(); }
    if (g("data-skip")) { GM_setValue("pkm_skip_anim", GM_getValue("pkm_skip_anim", "false") === "true" ? "false" : "true"); return pkmDrawOptions(); }
    if (g("data-load")) return pkmLoadPreset(g("data-load").dataset.load);
    if (g("data-del")) { const pre = pkmPresets(); delete pre[g("data-del").dataset.del]; pkmSave("pkm_presets", pre); return pkmDrawOptions(); }
    if (g("data-log")) { pkmReplayLog = pkmJSON("pkm_battle_logs", [])[+g("data-log").dataset.log] || null; return pkmDrawOptions(); }
    const a = e.target.closest("[data-a]")?.dataset.a;
    if (a === "close") return pkmCloseOptions();
    if (a === "savetools") { pkmCloseOptions(); return openSettings(); }
    if (a === "savepreset") {
      const name = pkmSafeName(P.querySelector(".oc-pname").value, 16);
      if (!name) return pkmToast("Give the team a name.");
      const pre = pkmPresets();
      pre[name] = Object.keys(getObj(STORAGE.party) || {}).slice(0, PKM_PARTY_SIZE);
      pkmSave("pkm_presets", pre);
      pkmToast(`Team “${name}” saved.`);
      return pkmDrawOptions();
    }
    if (a === "calc") return pkmCalcRun();
    if (a === "logback") { pkmReplayLog = null; return pkmDrawOptions(); }
    if (a === "replay" && pkmReplayLog) {
      const box = P.querySelector(".oc-replay");
      box.innerHTML = "";
      let i = 0;
      clearInterval(pkmReplayTimer);
      pkmReplayTimer = setInterval(() => {
        if (!box.isConnected || i >= pkmReplayLog.lines.length) return clearInterval(pkmReplayTimer);
        const d = document.createElement("div");
        d.textContent = pkmReplayLog.lines[i++];
        box.appendChild(d);
        box.scrollTop = box.scrollHeight;
      }, 700);
    }
  }
  // Remember each battle's messages for the Battle logs tab
  {
    const cb2 = closeBattle;
    closeBattle = function (...a) {
      const b = pkb;
      pkmLastResult = (b && b.result) || "";
      if (b && b.log && b.log.length > 2 && b.foe) {
        const logs = pkmJSON("pkm_battle_logs", []);
        logs.push({ t: Date.now(), title: b.trainer ? `${b.trainer.title} ${b.trainer.name}` : `Wild ${b.foe.display}`, result: b.result || "", lines: b.log.slice(0, 250) });
        pkmSave("pkm_battle_logs", logs.slice(-8));
      }
      return cb2.apply(this, a);
    };
  }
  // Tell the player once when a new version brings changes
  setTimeout(() => {
    if (GM_getValue("pkm_seen_version", "") === PKM_VERSION) return;
    GM_setValue("pkm_seen_version", PKM_VERSION);
    if (Object.keys(getObj(STORAGE.party) || {}).length) pkmToast("✨ Pokémon 4.6: new trainers now pick 1 of 3 random starters, and the choice is final. See Options → What's new.", 9000);
  }, 6000);

  // ---------- Styles: map, explore, options ----------
  pkmStyle(`
    .pkm-set.pkm-map{width:min(780px,96vw);max-height:94vh;overflow:auto}
    .pkm-set.pkm-explore{width:min(620px,96vw)}
    .pkm-set.pkm-options{width:min(640px,96vw);max-height:92vh;overflow:auto}
    .mp-head{background:linear-gradient(90deg,#2f8f5b,#1c5e3b)!important}
    .op-head{background:linear-gradient(90deg,#5b6bd6,#34408f)!important}
    .mp-board{position:relative;margin:6px 16px;height:300px;border-radius:14px;overflow:hidden;background:radial-gradient(circle at 20% 25%,#7bc86a 0 14%,transparent 15%),radial-gradient(circle at 80% 70%,#4aa0d8 0 18%,transparent 19%),linear-gradient(135deg,#a6dd7d,#79c552 55%,#6bb066)}
    .mp-lines{position:absolute;inset:0;width:100%;height:100%}
    .mp-lines polyline{fill:none;stroke:rgba(255,255,255,.75);stroke-width:1.2;stroke-dasharray:3 2;vector-effect:non-scaling-stroke}
    .mp-node{all:unset;cursor:pointer;position:absolute;transform:translate(-50%,-50%);display:flex;flex-direction:column;align-items:center;gap:1px;padding:5px 8px;border-radius:12px;background:rgba(17,20,33,.88);color:#fff;font-size:11px;min-width:78px;text-align:center;border:2px solid transparent}
    .mp-node:hover{border-color:#ffcb05}.mp-node:focus-visible{outline:2px solid #ffcb05}.mp-node.sel{border-color:#ffcb05;background:rgba(60,50,10,.95)}.mp-node.locked{opacity:.6}
    .mp-ico{font-size:22px}.mp-name{font-weight:800}.mp-lv{opacity:.8}
    .mp-info{margin:6px 16px;padding:8px 10px;border-radius:12px;background:rgba(255,255,255,.07);display:grid;gap:4px;font-size:13px}
    .mp-mode{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin:6px 16px 14px}
    .oc-preset{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:8px 10px;margin:6px 0;border-radius:10px;background:rgba(255,255,255,.07)}
    .oc-out{margin-top:10px;display:grid;gap:3px;font-size:13px}
    .oc-replay{margin-top:8px;max-height:300px;overflow:auto;display:grid;gap:3px;font-size:13px;background:#0f1220;border-radius:10px;padding:8px}
    .oc-list{margin:4px 0 10px 18px;display:grid;gap:4px;font-size:13px}
    .lk-body select{background:#0f1220;color:#e8eaf6;border:1px solid #2c3350;border-radius:8px;padding:6px 8px;font-size:13px}
    .pkb-field.z-themed{background-size:cover}
  `, "pkm-v38");

  // =====================================================================
  //  3.8: training (EVs, vitamins, mints, abilities, Tera type), egg moves
  // =====================================================================
  const PKM_EV_KEYS = ["hp", "atk", "def", "spa", "spd", "spe"];
  const PKM_EV_LABEL = { hp: "HP", atk: "Attack", def: "Defense", spa: "Sp. Atk", spd: "Sp. Def", spe: "Speed" };
  const PKM_EV_FROM_API = { hp: "hp", attack: "atk", defense: "def", "special-attack": "spa", "special-defense": "spd", speed: "spe" };
  const PKM_VITAMINS = [["hp-up", "HP Up", "hp"], ["protein", "Protein", "atk"], ["iron", "Iron", "def"], ["calcium", "Calcium", "spa"], ["zinc", "Zinc", "spd"], ["carbos", "Carbos", "spe"]];
  for (const [img, name, k] of PKM_VITAMINS) PKM_ITEMS.push({ img, name, key: `pkm_item_${img}`, price: 800, cat: "medicine", desc: `Adds 10 ${PKM_EV_LABEL[k]} EVs (up to 100 from vitamins). Use it in the Training center.` });
  PKM_ITEMS.push(
    { img: "adamant-mint", name: "Nature Mint", key: "pkm_item_nature-mint", price: 3000, cat: "battle", desc: "Changes a Pokémon's Nature. Use it in the Training center." },
    { img: "ability-capsule", name: "Ability Capsule", key: "pkm_item_ability-capsule", price: 5000, cat: "battle", desc: "Switches a Pokémon to its other regular ability. Use it in the Training center." },
    { img: "ability-patch", name: "Ability Patch", key: "pkm_item_ability-patch", price: 20000, cat: "battle", desc: "Gives a Pokémon its hidden ability. Use it in the Training center." },
    { img: "normal-tera-shard", name: "Tera Shard", key: "pkm_item_tera-shard", price: 3000, cat: "battle", desc: "Changes a Pokémon's Tera type. Use it in the Training center." }
  );
  const pkmEvTotal = (ev) => PKM_EV_KEYS.reduce((n, k) => n + ((ev && ev[k]) || 0), 0);
  /** Pokémon you defeat give effort points to the one that fought. */
  function pkmGainEV(mon, foe) {
    if (!mon || !mon.instanceId || !foe || !foe.evYield) return;
    const all = getObj(STORAGE.stats) || {};
    const s = all[mon.instanceId];
    if (!s) return;
    s.ev = Object.assign({ hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, s.ev);
    for (const [k, n] of Object.entries(foe.evYield)) {
      const room = Math.min(252 - s.ev[k], 510 - pkmEvTotal(s.ev));
      if (room > 0) s.ev[k] += Math.min(room, n);
    }
    all[mon.instanceId] = s;
    setObj(STORAGE.stats, all);
  }
  /** Passive training: while you browse, the chosen Pokémon gains 1 EV every 40 steps. */
  function pkmTrainSteps(n) {
    const t = pkmJSON("pkm_training", null);
    if (!t || !t.id || !t.stat) return;
    t.steps = (t.steps || 0) + n;
    const gain = Math.floor(t.steps / 40);
    if (gain > 0) {
      t.steps -= gain * 40;
      const all = getObj(STORAGE.stats) || {};
      const s = all[t.id];
      if (s) {
        s.ev = Object.assign({ hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, s.ev);
        const room = Math.min(252 - s.ev[t.stat], 510 - pkmEvTotal(s.ev));
        if (room > 0) { s.ev[t.stat] += Math.min(room, gain); all[t.id] = s; setObj(STORAGE.stats, all); }
      }
    }
    pkmSave("pkm_training", t);
  }
  /** Names of a species' abilities: { regular: [...], hidden: name|null }. */
  async function pkmAbilityInfo(name) {
    const d = await pkmPokemonData(name);
    const ab = (d && d.abilities) || [];
    const h = ab.find((a) => a.is_hidden);
    return { regular: ab.filter((a) => !a.is_hidden).map((a) => a.ability.name), hidden: h ? h.ability.name : null };
  }

  let pkmTrainPanel = null;
  let pkmTrainSel = null;
  let pkmTrainMsg = "";
  function pkmCloseTraining() { if (pkmTrainPanel) pkmTrainPanel.remove(); pkmTrainPanel = null; }
  function pkmOpenTraining(id) {
    if (typeof id === "string") pkmTrainSel = id;
    if (!pkmTrainPanel) {
      const P = (pkmTrainPanel = document.createElement("div"));
      P.className = "pkm-panel pkm-modal pkm-set pkm-training";
      P.setAttribute("role", "dialog");
      P.setAttribute("aria-label", "Training center");
      P.onclick = pkmTrainClick;
      P.onchange = (e) => { if (e.target.matches(".tc-who")) { pkmTrainSel = e.target.value; pkmTrainMsg = ""; pkmDrawTraining(); } };
      pkmMount(P);
    }
    pkmDrawTraining();
  }
  async function pkmDrawTraining() {
    const P = pkmTrainPanel;
    if (!P) return;
    const party = getObj(STORAGE.party) || {};
    const ids = Object.keys(party);
    if (!ids.length) { P.innerHTML = `<div class="pkm-set-head tc-head"><span>🏋️ Training center</span><button type="button" class="pkm-x" data-a="close" aria-label="Close">✕</button></div><div class="lk-body pkm-dim">Choose a starter first.</div>`; return; }
    if (!pkmTrainSel || !party[pkmTrainSel]) pkmTrainSel = GM_getValue("pkm_starter_id") && party[GM_getValue("pkm_starter_id")] ? GM_getValue("pkm_starter_id") : ids[0];
    const id = pkmTrainSel;
    await pkmSyncStats(id, party[id].name);
    const st = (getObj(STORAGE.stats) || {})[id] || {};
    const info = await pkmAbilityInfo(party[id].name);
    if (!pkmTrainPanel) return;
    const ev = Object.assign({ hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, st.ev);
    const tr = pkmJSON("pkm_training", null);
    const tera = st.teraType || (st.types && st.types[0]) || "normal";
    const own = (k) => getInt(`pkm_item_${k}`);
    const vit = Object.assign({}, st.evVit);
    const nat = PKM_NATURES[st.nature];
    P.innerHTML = `
      <div class="pkm-set-head tc-head"><span>🏋️ Training center</span><span class="bag-head-r"><span class="pkm-chip" data-coins>💰 ${getInt(STORAGE.coins)}</span><button type="button" class="pkm-x" data-a="close" aria-label="Close" title="Close (Esc)">✕</button></span></div>
      ${pkmTrainMsg ? `<div class="bag-msg" role="status">${pkmEsc(pkmTrainMsg)}</div>` : ""}
      <div class="lk-body">
        <label class="lk-l">Pokémon <select class="tc-who">${ids.slice(0, 120).map((i) => `<option value="${pkmEsc(i)}" ${i === id ? "selected" : ""}>${pkmEsc(pkmCap(party[i].name))} (Lv ${((getObj(STORAGE.stats) || {})[i] || {}).level || 1})</option>`).join("")}</select></label>
        <div class="pkm-dim">Nature: <b>${pkmEsc(pkmCap(st.nature || "—"))}</b>${nat && nat.length ? ` (+${PKM_EV_LABEL[nat[0]]} −${PKM_EV_LABEL[nat[1]]})` : ""} · Ability: <b>${pkmEsc(pkmCap(st.ability || "—"))}</b>${st.ability === info.hidden ? " (hidden)" : ""} · Tera: <b>${pkmEsc(pkmCap(tera))}</b></div>
        <div class="bag-sec"><span>Effort points (EVs)</span><span class="pkm-dim">${pkmEvTotal(ev)}/510</span></div>
        <div class="tc-evs">${PKM_EV_KEYS.map((k) => `<div class="tc-ev"><span>${PKM_EV_LABEL[k]}</span><div class="bc-bar"><span style="width:${Math.round((ev[k] / 252) * 100)}%"></span></div><b>${ev[k]}</b></div>`).join("")}</div>
        <div class="pkm-dim">Defeating Pokémon gives EVs for the stats they're known for (max 252 per stat). Every 4 EVs add 1 to a stat at Lv 100.</div>
        <div class="bag-sec"><span>Vitamins</span></div>
        <div class="pkm-btns">${PKM_VITAMINS.map(([img, name, k]) => `<button type="button" class="pkm-btn2" data-vit="${img}" ${own(img) > 0 && (vit[k] || 0) < 100 ? "" : "disabled"} title="${PKM_EV_LABEL[k]} +10">${name} ×${own(img)}</button>`).join("")}</div>
        <div class="bag-sec"><span>Training area</span></div>
        <div class="pkm-btns"><select class="tc-stat" aria-label="Stat to train">${PKM_EV_KEYS.map((k) => `<option value="${k}" ${tr && tr.stat === k ? "selected" : ""}>${PKM_EV_LABEL[k]}</option>`).join("")}</select>
          <button type="button" class="pkm-btn2 primary" data-a="train">${tr && tr.id === id ? "Change stat" : "Train this Pokémon"}</button>${tr ? `<button type="button" class="pkm-btn2 danger" data-a="stoptrain">Stop</button>` : ""}</div>
        <div class="pkm-dim">${tr && party[tr.id] ? `Training ${pkmEsc(pkmCap(party[tr.id].name))}'s ${PKM_EV_LABEL[tr.stat]}: +1 EV every 40 steps while you browse and walk around (${tr.steps || 0}/40).` : "Pick a stat and the Pokémon trains while you browse the web (steps count like the Daycare's)."}</div>
        <div class="pkm-btns"><button type="button" class="pkm-btn2 danger" data-a="resetev" ${pkmEvTotal(ev) ? "" : "disabled"}>Reset EVs (💰 500)</button></div>
        <div class="bag-sec"><span>Nature</span><span class="pkm-dim">Nature Mints ×${own("nature-mint")}</span></div>
        <div class="pkm-btns"><select class="tc-nat" aria-label="New nature">${Object.keys(PKM_NATURES).map((n) => `<option value="${n}" ${n === st.nature ? "selected" : ""}>${pkmCap(n)}${PKM_NATURES[n].length ? ` (+${PKM_EV_LABEL[PKM_NATURES[n][0]]} −${PKM_EV_LABEL[PKM_NATURES[n][1]]})` : ""}</option>`).join("")}</select>
          <button type="button" class="pkm-btn2 primary" data-a="mint" ${own("nature-mint") > 0 ? "" : "disabled"}>Use a Mint</button></div>
        <div class="bag-sec"><span>Ability</span></div>
        <div class="pkm-dim">${info.regular.length ? `Regular: ${info.regular.map((n) => pkmEsc(pkmCap(n))).join(", ")}` : ""}${info.hidden ? ` · Hidden: ${pkmEsc(pkmCap(info.hidden))}` : " · No hidden ability"}</div>
        <div class="pkm-btns"><button type="button" class="pkm-btn2" data-a="capsule" ${own("ability-capsule") > 0 && info.regular.length > 1 && info.regular.includes(st.ability) ? "" : "disabled"}>Ability Capsule ×${own("ability-capsule")}</button>
          <button type="button" class="pkm-btn2" data-a="patch" ${own("ability-patch") > 0 && info.hidden && st.ability !== info.hidden ? "" : "disabled"}>Ability Patch ×${own("ability-patch")}</button></div>
        <div class="bag-sec"><span>Tera type</span><span class="pkm-dim">Tera Shards ×${own("tera-shard")}</span></div>
        <div class="pkm-btns"><select class="tc-tera" aria-label="New Tera type">${["normal", "fire", "water", "electric", "grass", "ice", "fighting", "poison", "ground", "flying", "psychic", "bug", "rock", "ghost", "dragon", "dark", "steel", "fairy"].map((n) => `<option value="${n}" ${n === tera ? "selected" : ""}>${pkmCap(n)}</option>`).join("")}</select>
          <button type="button" class="pkm-btn2 primary" data-a="tera" ${own("tera-shard") > 0 ? "" : "disabled"}>Use a Tera Shard</button></div>
      </div>`;
  }
  async function pkmTrainClick(e) {
    const P = pkmTrainPanel;
    const id = pkmTrainSel;
    const a = e.target.closest("[data-a]")?.dataset.a;
    const vitBtn = e.target.closest("[data-vit]");
    const upd = async (fn) => {
      const all = getObj(STORAGE.stats) || {};
      const s = all[id];
      if (!s) return;
      const msg = await fn(s);
      all[id] = s;
      setObj(STORAGE.stats, all);
      pkmTrainMsg = msg || "";
      await pkmSyncStats(id, (getObj(STORAGE.party) || {})[id].name);
      pkmLiveRefresh();
      pkmDrawTraining();
    };
    if (a === "close") return pkmCloseTraining();
    if (vitBtn && !vitBtn.disabled) {
      const [, name, k] = PKM_VITAMINS.find((v) => v[0] === vitBtn.dataset.vit);
      if (getInt(`pkm_item_${vitBtn.dataset.vit}`) <= 0) return;
      return upd((s) => {
        s.ev = Object.assign({ hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, s.ev);
        s.evVit = Object.assign({}, s.evVit);
        const room = Math.min(10, 100 - (s.evVit[k] || 0), 252 - s.ev[k], 510 - pkmEvTotal(s.ev));
        if (room <= 0) return `${PKM_EV_LABEL[k]} can't go any higher.`;
        setInt(`pkm_item_${vitBtn.dataset.vit}`, getInt(`pkm_item_${vitBtn.dataset.vit}`) - 1);
        s.ev[k] += room;
        s.evVit[k] = (s.evVit[k] || 0) + room;
        return `${name}: ${PKM_EV_LABEL[k]} +${room} EVs.`;
      });
    }
    if (a === "train") { const stat = P.querySelector(".tc-stat").value; pkmSave("pkm_training", { id, stat, steps: 0 }); pkmTrainMsg = `Training ${PKM_EV_LABEL[stat]}. Keep browsing!`; return pkmDrawTraining(); }
    if (a === "stoptrain") { pkmSave("pkm_training", null); pkmTrainMsg = "Training stopped."; return pkmDrawTraining(); }
    if (a === "resetev") {
      if (getInt(STORAGE.coins) < 500) { pkmTrainMsg = "You need 500 coins."; return pkmDrawTraining(); }
      return upd((s) => { setInt(STORAGE.coins, getInt(STORAGE.coins) - 500); s.ev = null; s.evVit = null; return "EVs reset."; });
    }
    if (a === "mint") {
      const nat = P.querySelector(".tc-nat").value;
      if (!pkmHas(PKM_NATURES, nat) || getInt("pkm_item_nature-mint") <= 0) return;
      return upd((s) => { if (s.nature === nat) return "It already has that nature."; setInt("pkm_item_nature-mint", getInt("pkm_item_nature-mint") - 1); s.nature = nat; return `Nature changed to ${pkmCap(nat)}.`; });
    }
    if (a === "capsule" || a === "patch") {
      const info = await pkmAbilityInfo((getObj(STORAGE.party) || {})[id].name);
      return upd((s) => {
        if (a === "capsule") {
          const list = info.regular;
          const next = list[(list.indexOf(s.ability) + 1) % list.length];
          if (list.length < 2 || next === s.ability || getInt("pkm_item_ability-capsule") <= 0) return "It has no other regular ability.";
          setInt("pkm_item_ability-capsule", getInt("pkm_item_ability-capsule") - 1);
          s.ability = next;
          return `Its ability is now ${pkmCap(next)}.`;
        }
        if (!info.hidden || getInt("pkm_item_ability-patch") <= 0) return "It has no hidden ability.";
        setInt("pkm_item_ability-patch", getInt("pkm_item_ability-patch") - 1);
        s.ability = info.hidden;
        return `Its ability is now ${pkmCap(info.hidden)} (hidden).`;
      });
    }
    if (a === "tera") {
      const type = P.querySelector(".tc-tera").value;
      if (getInt("pkm_item_tera-shard") <= 0) return;
      return upd((s) => { setInt("pkm_item_tera-shard", getInt("pkm_item_tera-shard") - 1); s.teraType = type; return `Tera type changed to ${pkmCap(type)}.`; });
    }
  }

  // =====================================================================
  //  3.8: Battle Frontier (Factory, Arcade, Pike), Raids, Berry garden, Contests, Story
  // =====================================================================
  function pkmMakePanel(cls, label, onclick) {
    const P = document.createElement("div");
    P.className = `pkm-panel pkm-modal pkm-set ${cls}`;
    P.setAttribute("role", "dialog");
    P.setAttribute("aria-label", label);
    P.onclick = onclick;
    pkmMount(P);
    return P;
  }
  const pkmPanelHead = (title, cls) => `<div class="pkm-set-head ${cls}"><span>${title}</span><span class="bag-head-r"><span class="pkm-chip" data-coins>💰 ${getInt(STORAGE.coins)}</span><button type="button" class="pkm-x" data-a="close" aria-label="Close" title="Close (Esc)">✕</button></span></div>`;
  function pkmRng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  const pkmRandNonLegend = () => { for (;;) { const id = pkmRand(1, 649); if (!PKM_LEGEND_IDS.has(id)) return id; } };
  function pkmFrontRecord(k, n) { const b = pkmJSON("pkm_frontier_best", {}); if (n > (b[k] || 0)) { b[k] = n; pkmSave("pkm_frontier_best", b); } }
  const pkmFrontBest = () => pkmJSON("pkm_frontier_best", {});
  /** Heal every Pokémon in the party by this share of its max HP (1 = full). */
  function pkmHealShare(share, minOne) {
    const st = getObj(STORAGE.stats) || {};
    for (const id of Object.keys(getObj(STORAGE.party) || {}).slice(0, PKM_PARTY_SIZE)) {
      const s = st[id];
      if (!s || !s.hp) continue;
      const cur = Number.isFinite(s.currentHP) ? s.currentHP : s.hp;
      s.currentHP = share >= 0 ? Math.min(s.hp, Math.ceil(cur + s.hp * share)) : Math.max(minOne ? 1 : 0, Math.floor(cur + s.hp * share));
    }
    setObj(STORAGE.stats, st);
    pkmLiveRefresh();
  }

  // ---------- Battle Factory: rental teams ----------
  const pkmFactory = () => Object.assign({ active: false, round: 0, phase: "none", offer: [], team: [], swap: [] }, pkmJSON("pkm_factory", {}));
  const pkmSpecOf = (m) => ({ sp: m.name, lv: m.level, held: m.held || null, nature: m.nature, iv: m.iv, ability: m.ability, moves: m.moves.map((x) => x.name) });
  async function pkmRentals(n) {
    const out = [];
    while (out.length < n) {
      const m = await pkmBuildMon(pkmRandNonLegend(), 50, { shiny: false, held: pkmPick(PKM_TOWER_ITEMS) });
      if (m) out.push(pkmSpecOf(m));
    }
    return out;
  }
  async function pkmFactoryStart() {
    const f = { active: true, round: 0, phase: "pick", offer: await pkmRentals(6), team: [], swap: [] };
    pkmSave("pkm_factory", f);
    pkmOpenFrontier("factory");
  }
  async function pkmFactoryFight() {
    const f = pkmFactory();
    const mine = (await Promise.all(f.team.map(pkmBuildTrainerMon))).filter(Boolean);
    if (mine.length < 1) return pkmToast("Couldn't load your rental team. Try again.");
    const foes = await pkmRentals(3);
    f.foes = foes;
    pkmSave("pkm_factory", f);
    const boss = f.round === 6;
    pkmNextRoster = mine;
    pkmPostBattle = () => pkmOpenFrontier("factory");
    pkmCloseFrontier();
    pkmStartTrainer({ title: boss ? "Factory Head" : "Factory Hand", name: boss ? "Thorton" : pkmPick(["Cade", "Mira", "Ollie", "Pia"]), sprite: `${PKM_TRAINER_IMG}${boss ? "thorton" : "acetrainer"}.png`, lose: "Nice battling!", team: foes, facility: "factory", noXp: true, gym: 0, round: f.round + 1 });
    if (!battlePanel) { pkmNextRoster = null; pkmPostBattle = null; }
  }
  function pkmFactoryWin(b) {
    const f = pkmFactory();
    f.round++;
    const pay = 150 * f.round;
    setInt(STORAGE.coins, getInt(STORAGE.coins) + pay);
    let txt = ` Factory round ${f.round}/7: +${pay} coins.`;
    if (f.round >= 7) {
      const items = [[STORAGE.ultraBalls, 5, "Ultra Balls"], ["pkm_revive", 2, "Revives"]];
      const h = pkmRandomHeld();
      items.push([h.key, 1, h.name]);
      pkmGive(items);
      setInt(STORAGE.coins, getInt(STORAGE.coins) + 3000);
      pkmFrontRecord("factory", 7);
      pkmTrack("frontierWins");
      f.active = false; f.phase = "done";
      txt += ` 🏭 You beat the Battle Factory! Bonus: 3000 coins, ${pkmItemsText(items)}.`;
    } else { f.phase = "swap"; f.swap = f.foes || []; pkmFrontRecord("factory", f.round); }
    pkmSave("pkm_factory", f);
    return txt;
  }
  function pkmFacilityWin(b) {
    const k = b.trainer.facility;
    if (k === "factory") return pkmFactoryWin(b);
    if (k === "arcade") return pkmArcadeWin(b);
    if (k === "pike") return pkmPikeWin(b);
    return "";
  }
  function pkmFacilityLose(b) {
    const k = b.trainer.facility;
    if (k === "factory") { const f = pkmFactory(); f.active = false; f.phase = "done"; pkmSave("pkm_factory", f); return ` Your Factory run ended after ${f.round} win(s).`; }
    if (k === "arcade") { const a = pkmArcade(); a.active = false; pkmSave("pkm_arcade", a); return ` Your Arcade run ended after ${a.round} round(s).`; }
    if (k === "pike") { const p = pkmPike(); p.active = false; pkmSave("pkm_pike", p); return ` Your Pike run ended at room ${p.room}.`; }
    return "";
  }

  // ---------- Battle Arcade: a roulette before each battle ----------
  const pkmArcade = () => Object.assign({ active: false, round: 0, cards: [] }, pkmJSON("pkm_arcade", {}));
  const PKM_ARC_BOONS = [
    ["sun", "☀️ Harsh sunlight", (b) => { b.weather = { id: "sun", turns: 5 }; }], ["rain", "🌧️ Rain", (b) => { b.weather = { id: "rain", turns: 5 }; }],
    ["sand", "🏜️ Sandstorm", (b) => { b.weather = { id: "sand", turns: 5 }; }], ["hail", "❄️ Hail", (b) => { b.weather = { id: "hail", turns: 5 }; }],
    ["electric", "⚡ Electric Terrain", (b) => { b.terrain = { id: "electric", turns: 5 }; }], ["grassy", "🌿 Grassy Terrain", (b) => { b.terrain = { id: "grassy", turns: 5 }; }],
    ["atk", "💪 Your lead's Attack +1", (b) => { b.me.stages.atk = Math.min(6, b.me.stages.atk + 1); }], ["def", "🛡️ Your lead's Defense +1", (b) => { b.me.stages.def = Math.min(6, b.me.stages.def + 1); }],
    ["spe", "💨 Your lead's Speed +1", (b) => { b.me.stages.spe = Math.min(6, b.me.stages.spe + 1); }], ["spa", "🔮 Your lead's Sp. Atk +1", (b) => { b.me.stages.spa = Math.min(6, b.me.stages.spa + 1); }],
    ["heal", "💖 Your lead heals 40%", (b) => { b.me.hp = Math.min(b.me.maxHP, b.me.hp + Math.floor(b.me.maxHP * 0.4)); pkmSaveMonHP(b.me); }], ["coins", "🍀 Double coins this round", (b) => { b.arcadeCoins = 2; }],
  ];
  const PKM_ARC_CURSES = [
    ["fatk", "😈 The foe starts with Attack +1", (b) => { b.foe.stages.atk = Math.min(6, b.foe.stages.atk + 1); }], ["fdef", "😈 The foe starts with Defense +1", (b) => { b.foe.stages.def = Math.min(6, b.foe.stages.def + 1); }],
    ["fspe", "😈 The foe starts with Speed +1", (b) => { b.foe.stages.spe = Math.min(6, b.foe.stages.spe + 1); }], ["sash", "🎗️ The foe holds a Focus Sash", (b) => { b.foe.held = "focus-sash"; }],
    ["psn", "☠️ Your lead starts poisoned", (b) => { if (!b.me.types.includes("poison") && !b.me.types.includes("steel")) b.me.status = "psn"; }], ["slow", "🐌 Your lead's Speed -1", (b) => { b.me.stages.spe = Math.max(-6, b.me.stages.spe - 1); }],
    ["none", "😌 No curse", () => {}],
  ];
  function pkmArcadeApply(b, fx) {
    const boon = PKM_ARC_BOONS.find((x) => x[0] === fx.boon);
    const curse = PKM_ARC_CURSES.find((x) => x[0] === fx.curse);
    if (boon) boon[2](b);
    if (curse) curse[2](b);
    return `Arcade roulette: ${boon ? boon[1] : ""}${curse && curse[0] !== "none" ? ` / ${curse[1]}` : ""}.`;
  }
  function pkmArcadeCards() { return Array.from({ length: 3 }, () => ({ boon: pkmPick(PKM_ARC_BOONS)[0], curse: pkmPick(PKM_ARC_CURSES)[0] })); }
  function pkmArcadeStart() {
    if (!Object.keys(getObj(STORAGE.party) || {}).length) return pkmToast("Choose a starter first");
    healPokemon();
    pkmSave("pkm_arcade", { active: true, round: 0, cards: pkmArcadeCards() });
    pkmOpenFrontier("arcade");
  }
  function pkmArcadePlay(i) {
    const a = pkmArcade();
    const card = a.cards[i];
    if (!card) return;
    const lvl = pkmClamp(pkmTopLevel() - 3 + a.round * 2, 5, MAX_LEVEL);
    const n = 3;
    const team = Array.from({ length: n }, (_, k) => [pkmRandNonLegend(), k === n - 1 ? lvl : lvl - pkmRand(0, 2), null]);
    pkmPostBattle = () => pkmOpenFrontier("arcade");
    pkmCloseFrontier();
    pkmStartTrainer({ title: "Arcade Challenger", name: pkmPick(["Dex", "Pixel", "Joy", "Neo"]), sprite: `${PKM_TRAINER_IMG}${pkmPick(["acetrainer", "psychic", "blackbelt"])}.png`, lose: "Game over for me!", team, facility: "arcade", noXp: false, gym: 0, arcade: card, round: a.round + 1 });
    if (!battlePanel) pkmPostBattle = null;
  }
  function pkmArcadeWin(b) {
    const a = pkmArcade();
    a.round++;
    const pay = 250 * a.round * (b.arcadeCoins || 1);
    setInt(STORAGE.coins, getInt(STORAGE.coins) + pay);
    let txt = ` Arcade round ${a.round}/5: +${pay} coins.`;
    healPokemon();
    if (a.round >= 5) {
      const items = [[STORAGE.ultraBalls, 5, "Ultra Balls"], ["pkm_revive", 2, "Revives"], [pkmRandomStone(), 1, "Evolution stone"]];
      pkmGive(items);
      setInt(STORAGE.coins, getInt(STORAGE.coins) + 4000);
      pkmFrontRecord("arcade", 5);
      pkmTrack("frontierWins");
      a.active = false;
      txt += ` 🎰 You cleared the Battle Arcade! Bonus: 4000 coins, ${pkmItemsText(items)}.`;
    } else { a.cards = pkmArcadeCards(); pkmFrontRecord("arcade", a.round); }
    pkmSave("pkm_arcade", a);
    return txt;
  }

  // ---------- Battle Pike: pick a door, face what's behind it ----------
  const pkmPike = () => Object.assign({ active: false, room: 1, doors: [], msg: "" }, pkmJSON("pkm_pike", {}));
  const PKM_PIKE_ROOMS = 10;
  function pkmPikeDoors(room) {
    if (room >= PKM_PIKE_ROOMS) return ["queen", "queen", "queen"];
    const w = [["wild", 28], ["trainer", 20], ["heal", 14], ["trap", 10], ["item", 10], ["nothing", 8]];
    const total = w.reduce((n, x) => n + x[1], 0);
    const roll = () => { let r = Math.random() * total; for (const [k, v] of w) { if ((r -= v) < 0) return k; } return "nothing"; };
    return [roll(), roll(), roll()];
  }
  function pkmPikeStart() {
    if (!Object.keys(getObj(STORAGE.party) || {}).length) return pkmToast("Choose a starter first");
    healPokemon();
    pkmSave("pkm_pike", { active: true, room: 1, doors: pkmPikeDoors(1), msg: "Choose a door." });
    pkmOpenFrontier("pike");
  }
  function pkmPikeAdvance(msg) {
    const p = pkmPike();
    p.room++;
    if (p.room > PKM_PIKE_ROOMS) {
      const items = [[STORAGE.ultraBalls, 5, "Ultra Balls"], ["pkm_revive", 3, "Revives"]];
      const h = pkmRandomHeld();
      items.push([h.key, 1, h.name]);
      pkmGive(items);
      setInt(STORAGE.coins, getInt(STORAGE.coins) + 6000);
      pkmFrontRecord("pike", PKM_PIKE_ROOMS);
      pkmTrack("frontierWins");
      p.active = false;
      p.msg = `${msg} 🪤 You cleared the Battle Pike! Bonus: 6000 coins, ${pkmItemsText(items)}.`;
    } else { p.doors = pkmPikeDoors(p.room); p.msg = msg; pkmFrontRecord("pike", p.room - 1); }
    pkmSave("pkm_pike", p);
  }
  function pkmPikeWin(b) {
    const pay = 120 * pkmPike().room;
    setInt(STORAGE.coins, getInt(STORAGE.coins) + pay);
    return ` +${pay} coins.`;
  }
  function pkmPikeOpen(i) {
    const p = pkmPike();
    const door = p.doors[i];
    if (!door || !p.active) return;
    const top = pkmTopLevel();
    const after = () => { pkmPostBattle = () => { const r = pkmLastResult; const q = pkmPike(); if (!q.active) return pkmOpenFrontier("pike"); if (r === "Won" || r === "Caught") pkmPikeAdvance("You made it through the room!"); else if (r === "Lost") { q.active = false; q.msg = `Your run ended in room ${q.room}.`; pkmSave("pkm_pike", q); } else { q.msg = "You backed out. Pick a door again."; pkmSave("pkm_pike", q); } pkmOpenFrontier("pike"); }; };
    if (door === "wild") {
      after();
      pkmForcedWild = { name: String(pkmRandNonLegend()), level: pkmClamp(top - 4 + p.room, 5, MAX_LEVEL) };
      pkmCloseFrontier();
      openBattle();
      if (!battlePanel) { pkmForcedWild = null; pkmPostBattle = null; pkmOpenFrontier("pike"); }
      return;
    }
    if (door === "trainer" || door === "queen") {
      const queen = door === "queen";
      const lvl = pkmClamp(top - 2 + p.room + (queen ? 3 : 0), 5, MAX_LEVEL);
      const n = queen ? 4 : 3;
      const team = Array.from({ length: n }, (_, k) => [pkmRandNonLegend(), k === n - 1 ? lvl : lvl - pkmRand(0, 2), queen ? pkmPick(PKM_TOWER_ITEMS) : null]);
      after();
      pkmCloseFrontier();
      pkmStartTrainer({ title: queen ? "Pike Queen" : "Pike Trainer", name: queen ? "Lucy" : pkmPick(["Rook", "Sable", "Wren", "Colt"]), sprite: `${PKM_TRAINER_IMG}${queen ? "lucy" : "acetrainer"}.png`, lose: "The Pike is yours!", team, facility: "pike", noXp: false, gym: 0 });
      if (!battlePanel) pkmPostBattle = null;
      return;
    }
    if (door === "heal") { pkmHealShare(0.5); pkmPikeAdvance("A cool spring: your party recovered half its HP."); }
    else if (door === "trap") { pkmHealShare(-0.15, true); pkmPikeAdvance("A trap! Everyone lost some HP."); }
    else if (door === "item") { const it = pkmPick([[STORAGE.potions, 3, "Potions"], [STORAGE.ultraBalls, 1, "Ultra Ball"], ["pkm_revive", 1, "Revive"], [STORAGE.greatBalls, 3, "Great Balls"]]); pkmGive([it]); pkmPikeAdvance(`You found ${it[1]} × ${it[2]}!`); }
    else pkmPikeAdvance("The room is empty. You move on.");
    pkmOpenFrontier("pike");
  }

  // ---------- Battle Frontier panel ----------
  let pkmFrontPanel = null;
  let pkmFrontTab = "factory";
  let pkmFactoryPick = [];
  function pkmCloseFrontier() { if (pkmFrontPanel) pkmFrontPanel.remove(); pkmFrontPanel = null; }
  function pkmOpenFrontier(tab) {
    if (typeof tab === "string") pkmFrontTab = tab;
    if (!pkmFrontPanel) pkmFrontPanel = pkmMakePanel("pkm-frontier", "Battle Frontier", pkmFrontClick);
    pkmDrawFrontier();
  }
  async function pkmSpecCard(s, attrs, on) {
    const d = await pkmPokemonData(s.sp).catch(() => null);
    const types = d ? d.types.map((t) => `<span class="pk-type ${t.type.name}">${t.type.name}</span>`).join("") : "";
    const img = d && d.sprites && d.sprites.front_default ? d.sprites.front_default : "";
    return `<button type="button" class="ft-card${on ? " on" : ""}" ${attrs}>${img ? `<img src="${pkmEsc(img)}" alt="">` : ""}<b>${pkmEsc(pkmCap(s.sp))}</b><span>${types}</span><span class="pkm-dim">${s.held ? pkmEsc(pkmCap(s.held)) : ""}</span><span class="pkm-dim">${(s.moves || []).slice(0, 4).map((m) => pkmEsc(pkmCap(m))).join(", ")}</span></button>`;
  }
  async function pkmDrawFrontier() {
    const P = pkmFrontPanel;
    if (!P) return;
    const best = pkmFrontBest();
    const tabs = [["tower", "🗼 Tower"], ["factory", "🏭 Factory"], ["arcade", "🎰 Arcade"], ["pike", "🪤 Pike"]];
    let body = "";
    if (pkmFrontTab === "tower") {
      const t = pkmTower();
      body = `<p>The Battle Tower has its own panel. Best streak: <b>${t.best}</b>.</p><div class="pkm-btns"><button type="button" class="pkm-btn2 primary" data-a="tower">Open the Battle Tower</button></div>`;
    } else if (pkmFrontTab === "factory") {
      const f = pkmFactory();
      if (!f.active) body = `<p>Battle with <b>rental Pokémon</b> at Lv 50. You pick 3 of 6, fight 7 rounds, and after each win you may swap one of yours for one of your opponent's. Rentals are free and your own Pokémon aren't used. Best: <b>${best.factory || 0}</b> rounds.</p><div class="pkm-btns"><button type="button" class="pkm-btn2 primary" data-a="fstart">Start a run</button></div>`;
      else if (f.phase === "pick") {
        const cards = await Promise.all(f.offer.map((s, i) => pkmSpecCard(s, `data-fpick="${i}"`, pkmFactoryPick.includes(i))));
        body = `<p>Pick 3 rentals (${pkmFactoryPick.length}/3).</p><div class="ft-grid">${cards.join("")}</div><div class="pkm-btns"><button type="button" class="pkm-btn2 primary" data-a="fgo" ${pkmFactoryPick.length === 3 ? "" : "disabled"}>Start round 1</button><button type="button" class="pkm-btn2 danger" data-a="fquit">Give up</button></div>`;
      } else if (f.phase === "swap") {
        const mine = await Promise.all(f.team.map((s, i) => pkmSpecCard(s, `data-fmine="${i}"`, pkmFactoryPick[0] === i)));
        const theirs = await Promise.all(f.swap.map((s, i) => pkmSpecCard(s, `data-ftheirs="${i}"`, pkmFactoryPick[1] === i)));
        body = `<p>You won round ${f.round}/7! Swap one of your Pokémon for one of theirs, or keep your team.</p><div class="bag-sec"><span>Yours</span></div><div class="ft-grid">${mine.join("")}</div><div class="bag-sec"><span>Theirs</span></div><div class="ft-grid">${theirs.join("")}</div>
          <div class="pkm-btns"><button type="button" class="pkm-btn2 primary" data-a="fswap" ${pkmFactoryPick.length === 2 && pkmFactoryPick[0] != null && pkmFactoryPick[1] != null ? "" : "disabled"}>Swap and fight round ${f.round + 1}</button><button type="button" class="pkm-btn2" data-a="fkeep">Keep my team, fight round ${f.round + 1}</button><button type="button" class="pkm-btn2 danger" data-a="fquit">Stop here</button></div>`;
      } else body = `<p>Run over. Best: <b>${best.factory || 0}</b> rounds.</p><div class="pkm-btns"><button type="button" class="pkm-btn2 primary" data-a="fstart">Start a new run</button></div>`;
    } else if (pkmFrontTab === "arcade") {
      const a = pkmArcade();
      if (!a.active) body = `<p>Fight 5 battles with <b>your own party</b>. Before each one, pick a roulette card: each has a boost for you and sometimes a curse. Your party is healed between rounds. Best: <b>${best.arcade || 0}</b> rounds.</p><div class="pkm-btns"><button type="button" class="pkm-btn2 primary" data-a="astart">Start a run</button></div>`;
      else body = `<p>Round ${a.round + 1} of 5. Pick a card:</p><div class="ft-grid">${a.cards.map((c, i) => `<button type="button" class="ft-card" data-acard="${i}"><b>Card ${i + 1}</b><span>${pkmEsc((PKM_ARC_BOONS.find((x) => x[0] === c.boon) || [0, ""])[1])}</span><span class="pkm-dim">${pkmEsc((PKM_ARC_CURSES.find((x) => x[0] === c.curse) || [0, ""])[1])}</span></button>`).join("")}</div><div class="pkm-btns"><button type="button" class="pkm-btn2 danger" data-a="aquit">Give up</button></div>`;
    } else {
      const p = pkmPike();
      if (!p.active) body = `<p>${p.msg ? pkmEsc(p.msg) + "<br>" : ""}Walk through 10 rooms. In each one, choose a door: a wild Pokémon, a trainer, a spring, a trap, an item, or nothing. Your own party fights and <b>HP carries over</b>. The 10th room has the Pike Queen. Best: <b>${best.pike || 0}</b> rooms.</p><div class="pkm-btns"><button type="button" class="pkm-btn2 primary" data-a="pstart">Enter the Pike</button></div>`;
      else body = `<p>Room ${p.room} of ${PKM_PIKE_ROOMS}. ${pkmEsc(p.msg || "")}</p><div class="ft-grid">${p.doors.map((_, i) => `<button type="button" class="ft-card" data-door="${i}"><b>🚪 Door ${i + 1}</b><span class="pkm-dim">${p.room >= PKM_PIKE_ROOMS ? "The Pike Queen waits" : "Who knows?"}</span></button>`).join("")}</div><div class="pkm-btns"><button type="button" class="pkm-btn2 danger" data-a="pquit">Give up</button></div>`;
    }
    if (!pkmFrontPanel) return;
    P.innerHTML = `${pkmPanelHead("🏟️ Battle Frontier", "ft-head")}<div class="bag-tabs" role="tablist">${tabs.map(([k, l]) => `<button type="button" role="tab" data-tab="${k}" aria-selected="${pkmFrontTab === k}">${l}</button>`).join("")}</div><div class="lk-body">${body}</div>`;
  }
  async function pkmFrontClick(e) {
    const tab = e.target.closest("[data-tab]");
    if (tab) { pkmFactoryPick = []; pkmFrontTab = tab.dataset.tab; return pkmDrawFrontier(); }
    const a = e.target.closest("[data-a]")?.dataset.a;
    const g = (k) => e.target.closest(`[${k}]`);
    if (a === "close") return pkmCloseFrontier();
    if (a === "tower") { pkmCloseFrontier(); return pkmOpenTower(); }
    if (a === "fstart") { pkmFactoryPick = []; return pkmFactoryStart(); }
    if (a === "fquit") { const f = pkmFactory(); f.active = false; f.phase = "done"; pkmSave("pkm_factory", f); pkmFactoryPick = []; return pkmDrawFrontier(); }
    if (g("data-fpick")) { const i = +g("data-fpick").dataset.fpick; pkmFactoryPick = pkmFactoryPick.includes(i) ? pkmFactoryPick.filter((x) => x !== i) : pkmFactoryPick.length < 3 ? [...pkmFactoryPick, i] : pkmFactoryPick; return pkmDrawFrontier(); }
    if (a === "fgo") { const f = pkmFactory(); f.team = pkmFactoryPick.map((i) => f.offer[i]); f.phase = "fight"; pkmSave("pkm_factory", f); pkmFactoryPick = []; return pkmFactoryFight(); }
    if (g("data-fmine")) { pkmFactoryPick[0] = +g("data-fmine").dataset.fmine; return pkmDrawFrontier(); }
    if (g("data-ftheirs")) { pkmFactoryPick[1] = +g("data-ftheirs").dataset.ftheirs; return pkmDrawFrontier(); }
    if (a === "fswap") { const f = pkmFactory(); f.team[pkmFactoryPick[0]] = f.swap[pkmFactoryPick[1]]; f.phase = "fight"; pkmSave("pkm_factory", f); pkmFactoryPick = []; return pkmFactoryFight(); }
    if (a === "fkeep") { const f = pkmFactory(); f.phase = "fight"; pkmSave("pkm_factory", f); pkmFactoryPick = []; return pkmFactoryFight(); }
    if (a === "astart") return pkmArcadeStart();
    if (a === "aquit") { const x = pkmArcade(); x.active = false; pkmSave("pkm_arcade", x); return pkmDrawFrontier(); }
    if (g("data-acard")) return pkmArcadePlay(+g("data-acard").dataset.acard);
    if (a === "pstart") return pkmPikeStart();
    if (a === "pquit") { const x = pkmPike(); x.active = false; x.msg = "You left the Pike."; pkmSave("pkm_pike", x); return pkmDrawFrontier(); }
    if (g("data-door")) return pkmPikeOpen(+g("data-door").dataset.door);
  }

  // ---------- Raids: a shared boss every 3 hours ----------
  const PKM_RAID_TURNS = 15;
  const PKM_RAID_HOURS = 3;
  const PKM_RAID_POOL = ["charizard", "blastoise", "venusaur", "gengar", "dragonite", "tyranitar", "salamence", "garchomp", "lucario", "metagross", "gardevoir", "gyarados", "snorlax", "alakazam", "machamp", "golem", "rhydon", "scizor", "heracross", "steelix", "kingdra", "blaziken", "swampert", "sceptile", "infernape", "empoleon", "torterra", "hydreigon", "volcarona", "excadrill", "haxorus", "chandelure", "umbreon", "espeon", "jolteon", "flareon", "vaporeon", "leafeon", "glaceon", "mamoswine", "togekiss", "weavile", "magnezone", "electivire", "magmortar", "rhyperior", "gliscor", "gallade", "porygon-z", "tangrowth"];
  const PKM_RAID_POOL5 = ["mewtwo", "rayquaza", "lugia", "ho-oh", "kyogre", "groudon", "dialga", "palkia", "giratina", "reshiram", "zekrom", "xerneas", "yveltal"];
  const pkmRaidSlot = () => Math.floor(Date.now() / (PKM_RAID_HOURS * 36e5));
  /** The same boss for everyone in the same 3-hour window. */
  function pkmRaidBoss(slot = pkmRaidSlot()) {
    const r = pkmRng(slot * 7919 + 13);
    const x = r() * 100;
    const tier = x < 30 ? 1 : x < 60 ? 2 : x < 80 ? 3 : x < 92 ? 4 : 5;
    const pool = tier === 5 ? PKM_RAID_POOL5 : PKM_RAID_POOL;
    return { slot, tier, name: pool[Math.floor(r() * pool.length)] };
  }
  const pkmRaidState = () => { const s = pkmJSON("pkm_raid", { slot: -1, attempts: 0, won: false }); return s.slot === pkmRaidSlot() ? s : { slot: pkmRaidSlot(), attempts: 0, won: false }; };
  async function pkmRaidRound(b) {
    b.turns = (b.turns || 0) + 1;
    if (b.foe.hp > 0) {
      const hit = Math.max(1, Math.floor(b.foe.maxHP * 0.03)) * 2;
      b.foe.hp = Math.max(0, b.foe.hp - hit);
      pkmSyncGlobals(b);
      await pkmSay(b, "Your raid allies joined the attack!", 800, { side: "foe", text: `-${hit}` });
    }
    if (b.foe.hp > 0 && b.turns >= PKM_RAID_TURNS) {
      b.raidTimeout = true;
      await pkmSay(b, "Time's up!", 800);
      await pkmLose(b, true);
    }
  }
  async function pkmRaidWin(b) {
    const s = pkmRaidState();
    s.won = true;
    pkmSave("pkm_raid", s);
    const tier = b.foe.raid;
    const coins = 800 * tier;
    setInt(STORAGE.coins, getInt(STORAGE.coins) + coins);
    const items = [[STORAGE.ultraBalls, 1 + tier, "Ultra Balls"]];
    const pool = [["pkm_item_nature-mint", "Nature Mint"], ["pkm_item_ability-capsule", "Ability Capsule"], ["pkm_item_tera-shard", "Tera Shard"], ["pkm_item_hp-up", "HP Up"], ["pkm_item_protein", "Protein"], ["pkm_item_carbos", "Carbos"]];
    for (let i = 0; i < Math.max(0, tier - 1); i++) { const p = pkmPick(pool); items.push([p[0], 1, p[1]]); }
    if (tier >= 4) items.push(["pkm_item_ability-patch", 1, "Ability Patch"]);
    if (tier === 5) items.push([STORAGE.masterBalls, 1, "Master Ball"]);
    pkmGive(items);
    pkmTrack("raids");
    let txt = ` 💥 Raid cleared! +${coins} coins and ${pkmItemsText(items)}.`;
    for (let i = 0; i < 3; i++) {
      if (Math.random() < 0.35 + (tier === 5 ? -0.1 : 0)) {
        const f = b.foe;
        f.maxHP = f.stats.hp;
        f.hp = f.maxHP;
        pkmStoreCaught(f, "raid");
        txt += ` You caught the ${f.display} with Premier Ball #${i + 1}!`;
        return txt;
      }
    }
    return `${txt} The ${b.foe.display} slipped away before you could catch it.`;
  }
  let pkmRaidPanel = null;
  function pkmCloseRaids() { if (pkmRaidPanel) pkmRaidPanel.remove(); pkmRaidPanel = null; }
  async function pkmOpenRaids() {
    if (!pkmRaidPanel) pkmRaidPanel = pkmMakePanel("pkm-raids", "Raids", (e) => {
      const a = e.target.closest("[data-a]")?.dataset.a;
      if (a === "close") return pkmCloseRaids();
      if (a === "join") return pkmRaidJoin();
    });
    const boss = pkmRaidBoss();
    const s = pkmRaidState();
    const d = await pkmPokemonData(boss.name).catch(() => null);
    if (!pkmRaidPanel) return;
    const left = (boss.slot + 1) * PKM_RAID_HOURS * 36e5 - Date.now();
    const lvl = pkmClamp(pkmAreaLevel() + 4 + boss.tier * 3, 5, MAX_LEVEL);
    const ok = !s.won && s.attempts < 3;
    pkmRaidPanel.innerHTML = `${pkmPanelHead("💥 Raid den", "rd-head")}<div class="lk-body">
      <div class="rd-boss">${d && d.sprites ? `<img src="${pkmEsc(d.sprites.front_default || "")}" alt="">` : ""}<div><div class="tr-t">${"★".repeat(boss.tier)} ${pkmEsc(pkmCap(boss.name))}</div><div class="pkm-dim">Lv ${lvl} · ${d ? d.types.map((t) => t.type.name).join("/") : ""}</div>
        <div class="pkm-dim">Leaves in ${Math.floor(left / 36e5)}h ${Math.floor((left % 36e5) / 6e4)}m</div></div></div>
      <p>Everyone who plays in the same 3-hour window sees the same raid boss. It has a huge HP bar, and your raid allies chip in every turn, but you only have ${PKM_RAID_TURNS} turns. Win to earn coins and items, with three chances to catch it.</p>
      <div class="pkm-dim">Attempts left: ${3 - s.attempts}/3${s.won ? " · already cleared this window ✅" : ""}</div>
      <div class="pkm-btns"><button type="button" class="pkm-btn2 primary" data-a="join" ${ok ? "" : "disabled"}>${ok ? "Join the raid" : s.won ? "Cleared" : "No attempts left"}</button></div></div>`;
  }
  function pkmRaidJoin() {
    const s = pkmRaidState();
    if (s.won || s.attempts >= 3) return;
    if (!Object.keys(getObj(STORAGE.party) || {}).length) return pkmToast("Choose a starter first");
    const boss = pkmRaidBoss();
    s.attempts++;
    pkmSave("pkm_raid", s);
    pkmForcedWild = { name: boss.name, level: pkmClamp(pkmAreaLevel() + 4 + boss.tier * 3, 5, MAX_LEVEL), raid: boss.tier };
    pkmPostBattle = () => pkmOpenRaids();
    pkmCloseRaids();
    openBattle();
    if (!battlePanel) { pkmForcedWild = null; pkmPostBattle = null; s.attempts--; pkmSave("pkm_raid", s); pkmOpenRaids(); }
  }

  // ---------- Berry garden: berries grow while you browse ----------
  const PKM_BERRIES = [["oran-berry", "Oran Berry", 300], ["sitrus-berry", "Sitrus Berry", 600], ["lum-berry", "Lum Berry", 900]];
  const pkmGarden = () => Object.assign({ plots: [null, null, null, null] }, pkmJSON("pkm_garden", {}));
  function pkmGardenSteps(n) {
    const g = pkmJSON("pkm_garden", null);
    if (!g) return;
    let ch = false;
    for (const p of g.plots) if (p) { p.steps = (p.steps || 0) + n * (p.watered ? 1.5 : 1); ch = true; }
    if (ch) pkmSave("pkm_garden", g);
  }
  let pkmGardenPanel = null;
  function pkmCloseGarden() { if (pkmGardenPanel) pkmGardenPanel.remove(); pkmGardenPanel = null; }
  function pkmOpenGarden() {
    if (!pkmGardenPanel) pkmGardenPanel = pkmMakePanel("pkm-garden", "Berry garden", (e) => {
      const a = e.target.closest("[data-a]")?.dataset.a;
      if (a === "close") return pkmCloseGarden();
      if (!a) return; // clicks on the berry dropdown (or empty space) must not redraw the panel
      const g = pkmGarden();
      const plot = e.target.closest("[data-plot]");
      const i = plot ? +plot.dataset.plot : -1;
      if (a === "plant") {
        const berry = pkmGardenPanel.querySelector(".gd-berry").value;
        const info = PKM_BERRIES.find((x) => x[0] === berry);
        if (!info || getInt(`pkm_item_${berry}`) <= 0) return pkmToast("You don't have that berry. Buy some in the PokéMart.");
        setInt(`pkm_item_${berry}`, getInt(`pkm_item_${berry}`) - 1);
        g.plots[i] = { berry, steps: 0, watered: false };
      } else if (a === "water" && g.plots[i]) g.plots[i].watered = true;
      else if (a === "harvest" && g.plots[i]) {
        const p = g.plots[i];
        const info = PKM_BERRIES.find((x) => x[0] === p.berry);
        if ((p.steps || 0) < info[2]) return;
        const n = pkmRand(2, 5);
        setInt(`pkm_item_${p.berry}`, getInt(`pkm_item_${p.berry}`) + n);
        pkmToast(`🍓 You harvested ${n} × ${info[1]}!`);
        pkmTrack("harvests");
        g.plots[i] = null;
      } else if (a === "pull") g.plots[i] = null;
      pkmSave("pkm_garden", g);
      pkmOpenGarden();
    });
    const g = pkmGarden();
    pkmGardenPanel.innerHTML = `${pkmPanelHead("🍓 Berry garden", "gd-head")}<div class="lk-body">
      <p class="pkm-dim">Plant a berry from your Bag and it grows while you browse (1 step per second, +25 per page you visit). Watering makes it grow 50% faster. A harvest gives 2 to 5 berries. Oran Berries take about 5 minutes, Sitrus 10 and Lum 15.</p>
      <div class="ft-grid">${g.plots.map((p, i) => {
        if (!p) return `<div class="ft-card"><b>Empty plot</b><div class="pkm-btns"><select class="gd-berry" aria-label="Berry">${PKM_BERRIES.map(([k, n]) => `<option value="${k}">${n} (×${getInt(`pkm_item_${k}`)})</option>`).join("")}</select><button type="button" class="pkm-btn2 primary" data-a="plant" data-plot="${i}">Plant</button></div></div>`;
        const info = PKM_BERRIES.find((x) => x[0] === p.berry);
        const pct = Math.min(100, Math.round(((p.steps || 0) / info[2]) * 100));
        return `<div class="ft-card"><img src="${PKM_ITEM_IMG}${p.berry}.png" alt=""><b>${info[1]}</b><div class="bc-bar"><span style="width:${pct}%"></span></div><span class="pkm-dim">${pct >= 100 ? "Ready!" : `${pct}%`}${p.watered ? " 💧" : ""}</span>
          <div class="pkm-btns">${pct >= 100 ? `<button type="button" class="pkm-btn2 primary" data-a="harvest" data-plot="${i}">Harvest</button>` : `<button type="button" class="pkm-btn2" data-a="water" data-plot="${i}" ${p.watered ? "disabled" : ""}>💧 Water</button><button type="button" class="pkm-btn2 danger" data-a="pull" data-plot="${i}">Pull</button>`}</div></div>`;
      }).join("")}</div></div>`;
  }

  // ---------- Contests ----------
  const PKM_CONTEST = {
    cool: { name: "Cool", icon: "😎", stats: ["atk", "spe"], types: ["fire", "fighting", "electric", "dragon"] },
    beauty: { name: "Beauty", icon: "💎", stats: ["spa", "def"], types: ["water", "ice", "fairy", "psychic"] },
    cute: { name: "Cute", icon: "🥰", stats: ["hp", "spd"], types: ["normal", "fairy", "grass", "bug"] },
    smart: { name: "Smart", icon: "🧠", stats: ["spa", "spd"], types: ["psychic", "ghost", "dark", "steel"] },
    tough: { name: "Tough", icon: "💪", stats: ["def", "hp"], types: ["rock", "ground", "fighting", "steel"] },
  };
  const PKM_CONTEST_RANKS = [["Normal", 30, 1], ["Super", 60, 2], ["Hyper", 90, 3], ["Master", 100, 4]];
  /** How well a Pokémon fits a contest category (about 0 to 100). */
  function pkmContestCondition(mon, cat, st) {
    const c = PKM_CONTEST[cat];
    const s = { hp: st.hp || 50, atk: st.atk || 50, def: st.def || 50, spa: st.spAtk || 50, spd: st.spDef || 50, spe: st.speed || 50 };
    const lvl = Math.max(1, st.level || 1);
    const stat = c.stats.reduce((n, k) => n + s[k], 0) / c.stats.length;
    const fr = (st.friendship == null ? 70 : st.friendship) / 255;
    return Math.min(100, (stat / (lvl * 2 + 40)) * 50 + fr * 40 + 10);
  }
  let pkmContestPanel = null;
  let pkmContestState = null;
  function pkmCloseContests() { if (pkmContestPanel) pkmContestPanel.remove(); pkmContestPanel = null; pkmContestState = null; }
  async function pkmOpenContests() {
    if (!pkmContestPanel) pkmContestPanel = pkmMakePanel("pkm-contest", "Contests", pkmContestClick);
    await pkmDrawContest();
  }
  async function pkmDrawContest(msg) {
    const P = pkmContestPanel;
    if (!P) return;
    const party = getObj(STORAGE.party) || {};
    const stAll = getObj(STORAGE.stats) || {};
    const cs = pkmContestState;
    const wait = Math.max(0, Number(GM_getValue("pkm_contest_t", 0)) + 3 * 6e4 - Date.now());
    let body = "";
    if (!cs) {
      const ids = Object.keys(party);
      body = `<p class="pkm-dim">Show off your Pokémon in three rounds of appeals. Condition comes from its stats and friendship, and moves that suit the category score more. Win to earn coins and a ribbon. ${wait > 0 ? `<b>Next contest in ${Math.ceil(wait / 1000)}s.</b>` : ""}</p>
        <label class="lk-l">Pokémon <select class="ct-who">${ids.map((i) => `<option value="${pkmEsc(i)}">${pkmEsc(pkmCap(party[i].name))} (Lv ${(stAll[i] || {}).level || 1})</option>`).join("")}</select></label>
        <div class="pkm-btns">${Object.entries(PKM_CONTEST).map(([k, c]) => `<button type="button" class="pkm-btn2 primary" data-cat="${k}" ${wait > 0 ? "disabled" : ""}>${c.icon} ${c.name}</button>`).join("")}</div>`;
    } else {
      const moves = cs.moves;
      body = `<div class="pkm-dim">${cs.catIcon} ${cs.catName} Contest (${cs.rank}) · Round ${Math.min(3, cs.round + 1)}/3</div>
        <div class="oc-out"><div>${pkmEsc(cs.who)} <b>${cs.score}</b> pts</div>${cs.npcs.map((n) => `<div class="pkm-dim">${pkmEsc(n.name)} ${n.score} pts</div>`).join("")}</div>
        ${msg ? `<div class="bag-msg">${pkmEsc(msg)}</div>` : ""}
        ${cs.round < 3 ? `<div class="pkm-dim" style="margin-top:8px">Pick an appeal:</div><div class="pkm-btns">${moves.map((m, i) => `<button type="button" class="pkm-btn2 primary" data-appeal="${i}">${pkmEsc(m.display)} <span class="pk-type ${m.type}">${m.type}</span></button>`).join("")}</div>`
          : `<div class="pkm-btns"><button type="button" class="pkm-btn2 primary" data-a="done">Finish</button></div>`}`;
    }
    P.innerHTML = `${pkmPanelHead("🎀 Contests", "ct-head")}<div class="lk-body">${body}</div>`;
  }
  async function pkmContestClick(e) {
    const a = e.target.closest("[data-a]")?.dataset.a;
    if (a === "close") return pkmCloseContests();
    if (a === "done") { pkmContestState = null; return pkmDrawContest(); }
    const cat = e.target.closest("[data-cat]");
    if (cat && !cat.disabled) {
      const id = pkmContestPanel.querySelector(".ct-who").value;
      const party = getObj(STORAGE.party) || {};
      const st = (getObj(STORAGE.stats) || {})[id];
      if (!party[id] || !st) return;
      await pkmSyncStats(id, party[id].name);
      const st2 = (getObj(STORAGE.stats) || {})[id];
      const names = (st2.moves && st2.moves.length ? st2.moves : []).slice(0, 4);
      const moves = (await pkmMovesByNames(names)).slice(0, 4);
      if (!moves.length) return pkmToast("This Pokémon needs to know a move first (battle once).");
      const rank = PKM_CONTEST_RANKS.find((r) => (st2.level || 1) <= r[1]) || PKM_CONTEST_RANKS[3];
      const cond = pkmContestCondition(party[id], cat.dataset.cat, st2);
      GM_setValue("pkm_contest_t", Date.now());
      pkmContestState = { id, cat: cat.dataset.cat, catName: PKM_CONTEST[cat.dataset.cat].name, catIcon: PKM_CONTEST[cat.dataset.cat].icon, rank: rank[0], rankMult: rank[2], cond, moves, round: 0, score: 0, last: -1, who: pkmCap(party[id].name),
        npcs: ["Rival A", "Rival B", "Rival C"].map((name) => ({ name, base: 38 + rank[2] * 4 + pkmRand(0, 22), score: 0 })) };
      return pkmDrawContest();
    }
    const ap = e.target.closest("[data-appeal]");
    if (ap && pkmContestState && pkmContestState.round < 3) {
      const cs = pkmContestState;
      const i = +ap.dataset.appeal;
      const m = cs.moves[i];
      const fit = PKM_CONTEST[cs.cat].types.includes(m.type) ? 1.35 : 1;
      const repeat = cs.last === i ? 0.6 : 1;
      const pts = Math.round((cs.cond * 0.28 + 6) * fit * repeat * (0.85 + Math.random() * 0.3));
      cs.score += pts;
      cs.last = i;
      for (const n of cs.npcs) n.score += Math.round((n.base / 3) * (0.8 + Math.random() * 0.4));
      cs.round++;
      let msg = `${cs.who} used ${m.display}! +${pts}${fit > 1 ? " (a great fit!)" : ""}${repeat < 1 ? " (repeating costs points)" : ""}.`;
      if (cs.round >= 3) {
        const rankPos = 1 + cs.npcs.filter((n) => n.score > cs.score).length;
        const pay = [500, 250, 120, 50][rankPos - 1] * cs.rankMult;
        setInt(STORAGE.coins, getInt(STORAGE.coins) + pay);
        pkmTrack("contests");
        msg += ` You placed #${rankPos}! +${pay} coins.`;
        if (rankPos === 1) {
          const all = getObj(STORAGE.stats) || {};
          const s = all[cs.id] || {};
          s.ribbons = [...new Set([...(s.ribbons || []), `${cs.catName} ${cs.rank}`])];
          all[cs.id] = s;
          setObj(STORAGE.stats, all);
          pkmTrack("contestWins");
          msg += ` 🎀 It earned the ${cs.catName} ${cs.rank} Ribbon!`;
          playSound("badge");
        }
      }
      return pkmDrawContest(msg);
    }
  }

  // ---------- Story: quest chains with recurring characters ----------
  const PKM_STORY = [
    { id: "oak", who: "Professor Oak", icon: "🧪", title: "The Professor's Research", steps: [
      { say: "Ah, a new trainer! I'm collecting field data. Could you catch a few Pokémon for me?", text: "Catch 3 Pokémon", f: "caught", n: 3, reward: { coins: 500, items: [[STORAGE.balls, 5, "Poké Balls"]] } },
      { say: "Splendid! Now test your skills. Battle experience teaches us a great deal.", text: "Win 5 battles", f: "wins", n: 5, reward: { coins: 800, items: [[STORAGE.greatBalls, 5, "Great Balls"]] } },
      { say: "Let's fill the Pokédex. Every entry brings us closer to understanding Pokémon.", text: "Have 30 Pokédex entries", f: "_dex", n: 30, abs: true, reward: { coins: 1500, items: [[STORAGE.ultraBalls, 5, "Ultra Balls"]] } },
      { say: "One last thing: I'd love to witness an evolution up close.", text: "Evolve a Pokémon", f: "evolutions", n: 1, reward: { coins: 3000, items: [[STORAGE.masterBalls, 1, "Master Ball"]] } },
    ] },
    { id: "joy", who: "Nurse Joy", icon: "💗", title: "A Nurse's Request", steps: [
      { say: "Hello! The Pokémon Center could use help. Trainers who walk around find berries and herbs.", text: "Walk around 20 times in the world map", f: "walks", n: 20, reward: { coins: 600, items: [[STORAGE.potions, 5, "Potions"]] } },
      { say: "Thank you! Some of our guests left an Egg. Could you take care of one?", text: "Hatch an Egg", f: "hatched", n: 1, reward: { coins: 1000, items: [["pkm_revive", 3, "Revives"]] } },
      { say: "You're so kind. Show everyone how strong your friendship is with your Pokémon!", text: "Win 10 battles", f: "wins", n: 10, reward: { coins: 2000, items: [["pkm_item_nature-mint", 1, "Nature Mint"]] } },
    ] },
    { id: "rocket", who: "Giovanni", icon: "🕴️", title: "Team Trouble", steps: [
      { say: "So you've started making a name for yourself. Prove you're not all talk.", text: "Beat 5 trainers", f: "trainerWins", n: 5, reward: { coins: 1000, items: [[STORAGE.ultraBalls, 3, "Ultra Balls"]] } },
      { say: "Hm. Not bad. But can you beat a rival who knows you well?", text: "Beat your rival once", f: "rivalWins", n: 1, reward: { coins: 2000, items: [["pkm_item_ability-capsule", 1, "Ability Capsule"]] } },
      { say: "Gym Leaders are no pushovers either. Earn some badges.", text: "Have 4 badges", f: "_badges", n: 4, abs: true, reward: { coins: 3000, items: [["pkm_item_tera-shard", 1, "Tera Shard"]] } },
      { say: "I underestimated you. Become a Champion and I'll admit it.", text: "Beat a region's Champion", f: "_champs", n: 1, abs: true, reward: { coins: 8000, items: [[STORAGE.masterBalls, 1, "Master Ball"]] } },
    ] },
    { id: "legend", who: "Lorekeeper Sage", icon: "🔮", title: "The Legend Trail", steps: [
      { say: "Old tales speak of power beyond ordinary battles. Use it once, in any form.", text: "Mega Evolve, Terastallize or Dynamax once", f: "_special", n: 1, reward: { coins: 2000, items: [["pkm_item_hp-up", 2, "HP Up"]] } },
      { say: "The legends reward the patient. Win a Frontier or Tower battle.", text: "Win 3 Tower or Frontier runs' battles", f: "_front", n: 3, reward: { coins: 3000, items: [["pkm_item_protein", 2, "Protein"]] } },
      { say: "Now find one of the great Pokémon and bring it home.", text: "Catch a legendary Pokémon", f: "legends", n: 1, reward: { coins: 6000, items: [["pkm_item_ability-patch", 1, "Ability Patch"]] } },
    ] },
  ];
  const pkmStoryState = () => pkmJSON("pkm_story", {});
  function pkmStoryVal(f) {
    const p = pkmProgressView();
    if (f === "_special") return (p.megas || 0) + (p.teras || 0) + (p.dynamaxes || 0) + (p.zmoves || 0);
    if (f === "_front") return (p.towerWins || 0) + (p.frontierWins || 0) + (p.rivalWins || 0);
    if (f === "_dex") return p._dex;
    return p[f] || 0;
  }
  function pkmStoryProgress(ch) {
    const s = pkmStoryState()[ch.id] || { step: 0, base: null };
    const step = ch.steps[s.step];
    if (!step) return { done: true, step: null, have: 0 };
    const cur = pkmStoryVal(step.f);
    const base = step.abs ? 0 : s.base == null ? cur : s.base;
    return { done: false, step, have: Math.min(step.n, cur - base), idx: s.step };
  }
  function pkmStoryClaim(id) {
    const ch = PKM_STORY.find((c) => c.id === id);
    if (!ch) return;
    const pr = pkmStoryProgress(ch);
    if (pr.done || pr.have < pr.step.n) return;
    setInt(STORAGE.coins, getInt(STORAGE.coins) + pr.step.reward.coins);
    pkmGive(pr.step.reward.items);
    const st = pkmStoryState();
    const next = ch.steps[pr.idx + 1];
    st[id] = { step: pr.idx + 1, base: next && !next.abs ? pkmStoryVal(next.f) : null };
    pkmSave("pkm_story", st);
    pkmTrack("storySteps");
    playSound("badge");
    pkmToast(`📖 ${ch.who}: +${pr.step.reward.coins} coins, ${pkmItemsText(pr.step.reward.items)}`, 5000);
  }
  /** A chain's step counts from the moment the previous one is claimed: fix up chains that haven't started. */
  function pkmStoryInit() {
    const st = pkmStoryState();
    let ch = false;
    for (const c of PKM_STORY) {
      const s = st[c.id] || { step: 0, base: null };
      const step = c.steps[s.step];
      if (step && !step.abs && s.base == null) { st[c.id] = { step: s.step, base: pkmStoryVal(step.f) }; ch = true; }
    }
    if (ch) pkmSave("pkm_story", st);
  }
  let pkmStoryPanel = null;
  function pkmCloseStory() { if (pkmStoryPanel) pkmStoryPanel.remove(); pkmStoryPanel = null; }
  function pkmOpenStory() {
    pkmStoryInit();
    if (!pkmStoryPanel) pkmStoryPanel = pkmMakePanel("pkm-story", "Story", (e) => {
      const a = e.target.closest("[data-a]")?.dataset.a;
      if (a === "close") return pkmCloseStory();
      const c = e.target.closest("[data-claim]");
      if (c) { pkmStoryClaim(c.dataset.claim); pkmOpenStory(); }
    });
    pkmStoryPanel.innerHTML = `${pkmPanelHead("📖 Story", "sy-head")}<div class="lk-body">${PKM_STORY.map((ch) => {
      const pr = pkmStoryProgress(ch);
      if (pr.done) return `<div class="oc-preset"><div><b>${ch.icon} ${pkmEsc(ch.title)}</b><div class="pkm-dim">${pkmEsc(ch.who)}: Thank you for everything! ✅</div></div></div>`;
      const ok = pr.have >= pr.step.n;
      return `<div class="sy-chain"><div><b>${ch.icon} ${pkmEsc(ch.title)}</b> <span class="pkm-dim">Step ${pr.idx + 1}/${ch.steps.length}</span></div>
        <div class="sy-say">“${pkmEsc(pr.step.say)}” <span class="pkm-dim">— ${pkmEsc(ch.who)}</span></div>
        <div>${pkmEsc(pr.step.text)}: <b>${pr.have}/${pr.step.n}</b></div><div class="bc-bar"><span style="width:${Math.round((pr.have / pr.step.n) * 100)}%"></span></div>
        <div class="pkm-dim">Reward: 💰 ${pr.step.reward.coins}, ${pkmEsc(pkmItemsText(pr.step.reward.items))}</div>
        <div class="pkm-btns"><button type="button" class="pkm-btn2 primary" data-claim="${ch.id}" ${ok ? "" : "disabled"}>${ok ? "Claim reward" : "In progress"}</button></div></div>`;
    }).join("")}</div>`;
  }
  // Garden and raids both use the browsing steps
  {
    const as = pkmAddSteps;
    pkmAddSteps = function (n) { pkmGardenSteps(n); return as.apply(this, arguments); };
  }

  // ---------- League rematch (stronger teams after you're Champion) ----------
  function pkmRematchTeam(team) { return team.map(([sp, lv, held]) => [sp, Math.min(MAX_LEVEL, lv + 10), held || "sitrus-berry"]); }

  // ---------- Styles ----------
  pkmStyle(`
    .pkm-set.pkm-frontier,.pkm-set.pkm-raids,.pkm-set.pkm-garden,.pkm-set.pkm-contest,.pkm-set.pkm-story,.pkm-set.pkm-training{width:min(700px,96vw);max-height:92vh;overflow:auto}
    .ft-head{background:linear-gradient(90deg,#c2562b,#7a2f12)!important}.rd-head{background:linear-gradient(90deg,#d6204a,#7e0e2a)!important}.gd-head{background:linear-gradient(90deg,#3f9d4a,#1f5f2a)!important}
    .ct-head{background:linear-gradient(90deg,#d65ca8,#8a2f6a)!important}.sy-head{background:linear-gradient(90deg,#5a6bd6,#2f3a8a)!important}.tc-head{background:linear-gradient(90deg,#d6a22b,#7a5a0e)!important}
    .ft-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px;margin:8px 0}
    .ft-card{all:unset;box-sizing:border-box;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:3px;text-align:center;padding:8px;border-radius:12px;background:#1b1f33;border:2px solid #2c3350;font-size:12px;color:#e8eaf6}
    .ft-card:hover{border-color:#4a5585}.ft-card.on{border-color:#ffcb05;background:#2a2a14}.ft-card img{width:64px;height:64px;image-rendering:pixelated}
    .rd-boss{display:flex;align-items:center;gap:12px;margin-bottom:8px}.rd-boss img{width:96px;height:96px;image-rendering:pixelated}
    .tc-evs{display:grid;gap:4px;margin:6px 0}.tc-ev{display:grid;grid-template-columns:70px 1fr 36px;gap:8px;align-items:center;font-size:12.5px}
    .sy-chain{padding:10px;border-radius:12px;background:rgba(255,255,255,.07);margin:8px 0;display:grid;gap:4px}.sy-say{font-style:italic}
  `, "pkm-v38b");

  // =====================================================================
  //  3.9: double battles (2 vs 2). The move, damage and status code is shared with singles.
  // =====================================================================
  const pkmActive = (b) => (b.double ? [...b.mine, ...b.foes].filter(Boolean) : [b.me, b.foe]);
  const pkmDblFoesOf = (b, m) => (pkmMine(b, m) ? b.foes : b.mine).filter((x) => x && x.hp > 0);
  const pkmDblAllyOf = (b, m) => (pkmMine(b, m) ? b.mine : b.foes).find((x) => x && x !== m && x.hp > 0) || null;
  /** Keep b.me / b.foe pointing at a living Pokémon so the shared code and the HUD stay happy. */
  function pkmDblPrimary(b) {
    b.me = b.mine.find((m) => m && m.hp > 0) || b.mine[0];
    b.foe = b.foes.find((m) => m && m.hp > 0) || b.foes[0];
    pkmSyncGlobals(b);
  }
  const pkmDblBench = (b) => b.roster.filter((r) => !b.mine.includes(r.mon) && pkmRosterHP(r).hp > 0);
  /** Turn a battle that was just built for singles into a double (size 2) or triple (size 3) battle. Needs 2+ healthy Pokémon on each side. */
  async function pkmDblSetup(b, size = 2) {
    const leadEntry = b.roster.find((r) => r.mon === b.me);
    const extra = b.roster.filter((r) => r !== leadEntry && pkmRosterHP(r).hp > 0).slice(0, size - 1);
    if (!extra.length || b.team.length < 2) return false;
    for (const r of extra) if (!r.mon) r.mon = await pkmBuildInstance(r.id);
    const ready = extra.filter((r) => r.mon).map((r) => r.mon);
    if (!ready.length) return false;
    const n = Math.min(size, 1 + ready.length, b.team.length);
    b.double = true;
    b.triple = n === 3;
    b.mine = [b.me, ...ready].slice(0, n);
    b.foes = b.team.slice(0, n);
    b.foeNext = n;
    b.dbl = { slot: 0, picks: [], stage: "move", pending: null, refill: [] };
    pkmDblPrimary(b);
    return true;
  }
  async function pkmDblEntries(b, list) {
    for (const m of list || pkmActive(b)) {
      for (const opp of pkmDblFoesOf(b, m)) await pkmOnEntry(b, m, opp);
    }
  }
  const pkmDblNeedsTarget = (mv) => !pkmSelfMove(mv) && !/^all-(opponents|other-pokemon)/.test(mv.target || "");
  function pkmDblFirstSlot(b, from = 0) {
    for (let i = from; i < b.mine.length; i++) if (b.mine[i] && b.mine[i].hp > 0) return i;
    return -1;
  }
  function pkmDblPick(b, action) {
    b.dbl.picks[b.dbl.slot] = action;
    b.dbl.pending = null;
    b.dbl.stage = "move";
    const next = pkmDblFirstSlot(b, b.dbl.slot + 1);
    if (next >= 0) { b.dbl.slot = next; return drawBattle(`What will ${b.mine[next].display} do?`); }
    pkmDblTurn(b);
  }
  async function pkmDblSwitch(b, slot, id) {
    const r = b.roster.find((x) => x.id === id);
    if (!r) return;
    if (!r.mon) r.mon = await pkmBuildInstance(id);
    if (!r.mon || r.mon.hp <= 0 || !pkmAlive(b)) return;
    const old = b.mine[slot];
    if (old) {
      pkmEndDynamax(old);
      old.stages = { atk: 0, def: 0, spa: 0, spd: 0, spe: 0, acc: 0, eva: 0 };
      old.confused = 0; old.charging = null; old.invuln = false; old.sub = 0; old.mustRecharge = false; old.entered = false;
      if (old.ability === "natural-cure") old.status = null;
      if (old.ability === "regenerator" && old.hp > 0) { old.hp = Math.min(old.maxHP, old.hp + Math.floor(old.maxHP / 3)); pkmSaveMonHP(old); }
    }
    b.mine[slot] = r.mon;
    r.mon.faintDone = false;
    pkmDblPrimary(b);
    await pkmSay(b, old && old.hp > 0 ? `Come back, ${old.display}! Go, ${r.mon.display}!` : `Go, ${r.mon.display}!`, 900);
    await pkmDblEntries(b, [r.mon]);
  }
  /** Run one move against its target(s): single-target moves hit the chosen foe, spread moves hit both at 75%. */
  async function pkmDblMove(b, att, mv, target) {
    const opp = pkmDblFoesOf(b, att);
    if (!opp.length) return;
    if (pkmSelfMove(mv)) return pkmUseMove(b, att, opp[0], mv);
    if (!pkmDblNeedsTarget(mv) && opp.length > 1) {
      const src = mv.srcMove || mv;
      for (let i = 0; i < opp.length; i++) {
        if (att.hp <= 0 || !pkmAlive(b)) return;
        await pkmUseMove(b, att, opp[i], { ...mv, spread: 0.75, srcMove: src, ...(i ? { noPP: true, quiet: true } : {}) });
        if (att.charging) return; // a two-turn spread move only charges once
      }
      return;
    }
    const t = target && target.hp > 0 && opp.includes(target) ? target : pkmPick(opp);
    return pkmUseMove(b, att, t, mv);
  }
  async function pkmDblFaints(b) {
    for (const m of [...b.foes, ...b.mine]) {
      if (!m || m.hp > 0 || m.faintDone || !pkmAlive(b)) continue;
      m.faintDone = true;
      await pkmSay(b, `${pkmWho(b, m)} fainted!`, 750);
      if (pkmMine(b, m)) {
        pkmSaveMonHP(m);
        pkmFriend(m.instanceId, -3);
        playSound("faint");
      } else if (!(b.trainer && (b.trainer.pvp || b.trainer.noXp))) {
        const alive = b.mine.filter((x) => x && x.hp > 0);
        for (const a of alive) {
          await pkmGiveXP(b, a, Math.max(1, Math.floor(pkmXpFor(m, a, true) * (a.held === "lucky-egg" ? 1.5 : 1) / alive.length)));
          pkmGainEV(a, m);
        }
      }
    }
    pkmDblPrimary(b);
  }
  /** After a turn: the foe sends in replacements; you pick yours. Returns true when the battle is over. */
  async function pkmDblRefill(b) {
    for (let i = 0; i < b.foes.length; i++) {
      if (b.foes[i] && b.foes[i].hp > 0) continue;
      if (b.foeNext < b.team.length) {
        const nm = b.team[b.foeNext++];
        b.foes[i] = nm;
        b.foeIdx = b.foeNext - 1;
        pkmDblPrimary(b);
        await pkmSay(b, b.trainer ? `${b.trainer.name} sent out ${nm.display}!` : `Another wild ${nm.display} appeared!`, 900);
        await pkmDblEntries(b, [nm]);
      }
    }
    if (!b.foes.some((f) => f && f.hp > 0)) { await pkmWin(b); return true; }
    const bench = pkmDblBench(b);
    const empty = b.mine.map((_, i) => i).filter((i) => !b.mine[i] || b.mine[i].hp <= 0);
    if (!b.mine.some((m) => m && m.hp > 0) && !bench.length) {
      if (getInt("pkm_revive") > 0) { b.awaitRevive = true; b.busy = false; drawBattle("Your Pokémon fainted! Use a Revive to keep fighting?"); return true; }
      await pkmLose(b);
      return true;
    }
    b.dbl.refill = empty.slice(0, bench.length);
    return false;
  }
  function pkmDblNewTurn(b) {
    b.dbl.picks = [];
    b.dbl.pending = null;
    b.dbl.stage = "move";
    b.dbl.slot = pkmDblFirstSlot(b);
    b.busy = false;
    drawBattle(b.dbl.refill.length ? "Choose a Pokémon to send out!" : `What will ${b.mine[b.dbl.slot].display} do?`);
  }
  async function pkmDblTurn(b) {
    if (!pkmAlive(b) || b.busy) return;
    b.busy = true;
    drawBattle();
    for (const m of pkmActive(b)) { m.moved = false; m.flinched = false; if (!m.protectedNow) m.protectCount = 0; m.protectedNow = false; }
    const acts = [];
    b.mine.forEach((m, i) => { if (m && m.hp > 0) acts.push({ mon: m, ...(b.dbl.picks[i] || {}) }); });
    for (const m of b.foes) {
      if (!m || m.hp <= 0) continue;
      const opp = b.mine.filter((x) => x && x.hp > 0);
      if (!opp.length) break;
      const tg = pkmPick(opp);
      acts.push({ mon: m, mv: m.charging || pkmAiMove(m, tg, b), target: tg });
    }
    for (const a of acts) {
      if (a.mon.charging) { a.mv = a.mon.charging; a.type = null; }
      else if (a.mv && a.mon.encore && a.mon.encore.turns > 0) a.mv = a.mon.moves.find((x) => x.name === a.mon.encore.name) || a.mv;
    }
    const pr = (a) => (a.type === "switch" ? 7 : a.type === "potion" ? 6 : (a.mv && a.mv.prio) || 0);
    acts.sort((x, y) => pr(y) - pr(x) || pkmSpeed(y.mon, b) - pkmSpeed(x.mon, b) || Math.random() - 0.5);
    for (const a of acts) {
      if (!pkmAlive(b)) return;
      if (a.mon.hp <= 0 || (!a.type && !a.mv)) continue;
      if (a.type === "switch") { const slot = b.mine.indexOf(a.mon); if (slot >= 0) await pkmDblSwitch(b, slot, a.id); continue; }
      if (a.type === "potion") {
        if (getInt(STORAGE.potions) <= 0) continue;
        setInt(STORAGE.potions, getInt(STORAGE.potions) - 1);
        await pkmHeal(b, a.mon, Math.max(20, a.mon.maxHP * 0.35), `You used a Potion on ${a.mon.display}!`);
        continue;
      }
      await pkmDblMove(b, a.mon, a.mv, a.target);
      await pkmDblFaints(b);
      if (!b.foes.some((f) => f && f.hp > 0) && b.foeNext >= b.team.length) break;
      if (!b.mine.some((m) => m && m.hp > 0)) break;
    }
    if (!pkmAlive(b)) return;
    await pkmEndOfTurn(b);
    await pkmDblFaints(b);
    if (!pkmAlive(b)) return;
    if (await pkmDblRefill(b)) return;
    pkmDblNewTurn(b);
  }
  function pkmDrawDouble(msg) {
    const b = pkb;
    if (msg != null) b.msg = msg;
    const pct = (m) => Math.max(0, Math.round((m.hp / m.maxHP) * 100));
    const col = (p) => (p > 50 ? "#2fbf71" : p > 20 ? "#ffb020" : "#ff4d4f");
    const st = (m) => (m.status ? `<span class="pkb-st st-${m.status}">${m.status.toUpperCase()}</span>` : "") + (m.confused > 0 ? `<span class="pkb-st st-cnf">CNF</span>` : "") + (m.sub > 0 ? `<span class="pkb-st st-sub">🛡️</span>` : "");
    const box = (m, side) => (m ? `<div class="dbl-mon${m.hp <= 0 ? " out" : ""}"><img class="dbl-spr${side === "me" ? " back" : ""}" src="${pkmEsc(side === "me" ? m.back : m.front)}" alt="${pkmEsc(m.display)}">
      <div class="dbl-info"><div class="pkb-name">${pkmEsc(m.display)} <span>Lv ${m.level}</span>${st(m)}</div><div class="pkb-types">${m.types.map((t) => `<span class="pk-type ${t}">${t}</span>`).join("")}</div>
      <div class="pkb-hp"><span style="width:${pct(m)}%;background:${col(pct(m))}"></span></div>${side === "me" ? `<div class="pkm-dim">${Math.max(0, m.hp)}/${m.maxHP} HP</div>` : ""}</div></div>` : `<div class="dbl-mon out"></div>`);
    const tr = b.trainer;
    const busy = b.busy || b.over;
    let controls = "";
    const d = b.dbl;
    if (b.awaitRevive) {
      controls = `<button type="button" class="pk-btn pkb-act" data-dact="revive"><div class="pk-ico">✨</div><div class="pk-label">Use Revive</div><div class="pk-badge">${getInt("pkm_revive")}</div></button><button type="button" class="pk-btn pkb-act" data-dact="giveup"><div class="pk-ico">🏳️</div><div class="pk-label">Give up</div></button>`;
    } else if (!busy && d.refill.length) {
      controls = pkmDblBench(b).map((r) => `<button type="button" class="pk-btn pkb-sw" data-dsw="${pkmEsc(r.id)}"><div class="pk-label">${pkmEsc(pkmCap(r.name))}</div><div class="pkb-sw-sub">${pkmRosterHP(r).hp}/${pkmRosterHP(r).max}</div></button>`).join("");
    } else if (!busy && d.slot >= 0) {
      const me = b.mine[d.slot];
      if (d.stage === "target") {
        controls = b.foes.map((f, i) => (f && f.hp > 0 ? `<button type="button" class="pk-btn pkb-act" data-dt="${i}"><div class="pk-ico">🎯</div><div class="pk-label">${pkmEsc(f.display)}</div></button>` : "")).join("") + `<button type="button" class="pk-btn pkb-act" data-dact="back"><div class="pk-ico">↩️</div><div class="pk-label">Back</div></button>`;
      } else if (d.stage === "switch") {
        controls = pkmDblBench(b).map((r) => `<button type="button" class="pk-btn pkb-sw" data-dsw="${pkmEsc(r.id)}"><div class="pk-label">${pkmEsc(pkmCap(r.name))}</div><div class="pkb-sw-sub">${pkmRosterHP(r).hp}/${pkmRosterHP(r).max}</div></button>`).join("") + `<button type="button" class="pk-btn pkb-act" data-dact="back"><div class="pk-ico">↩️</div><div class="pk-label">Back</div></button>`;
      } else {
        controls = me.moves.map((m, i) => `<button type="button" class="pk-btn pkb-move t-${m.type}${m.cls === "status" ? " pkb-status" : ""}" data-dm="${i}" ${m.pp <= 0 ? "disabled" : ""}><div class="pk-label">${pkmEsc(m.display)}</div>
            <div class="pkb-mv-sub"><span class="pk-type ${m.type}">${m.type}</span><span>${m.cls === "status" ? "◌ Status" : m.fixed ? "—" : m.power}</span><span>PP ${m.pp}/${m.maxPP}</span></div>${pkmDblNeedsTarget(m) ? "" : `<div class="pkb-eff">${pkmSelfMove(m) ? "Self/field" : "Hits both"}</div>`}</button>`).join("")
          + `<button type="button" class="pk-btn pkb-act" data-dact="switch" ${pkmDblBench(b).length ? "" : "disabled"}><div class="pk-ico">🔄</div><div class="pk-label">Switch</div></button>`
          + `<button type="button" class="pk-btn pkb-act" data-dact="potion" ${getInt(STORAGE.potions) > 0 && me.hp < me.maxHP ? "" : "disabled"}><div class="pk-ico">💉</div><div class="pk-label">Potion</div><div class="pk-badge">${getInt(STORAGE.potions)}</div></button>`
          + `<button type="button" class="pk-btn pkb-act" data-dact="run"><div class="pk-ico">🏳️</div><div class="pk-label">Forfeit</div></button>`;
      }
    }
    battlePanel.classList.add("pk-card", "pkb-card");
    battlePanel.innerHTML = `${tr ? `<div class="pkb-trainer"><img class="pkb-tr-img" src="${pkmEsc(tr.sprite)}" alt=""><div><b>${pkmEsc(tr.title)} ${pkmEsc(tr.name)}</b>
        <div class="pkb-balls">${b.team.map((m) => `<span class="${m.hp <= 0 ? "out" : b.foes.includes(m) ? "cur" : ""}"></span>`).join("")}</div></div><span class="pkb-gym">👥 ${b.triple ? "Triple" : "Double"} battle${tr.pvp ? " · friend" : ""}</span></div>` : ""}${pkmFieldChips(b)}
      <div class="pkb-field dbl-field${b.night ? " night" : ""}"${b.zone && pkmZoneById(b.zone) ? ` style="background:${PKM_ZONE_THEME[pkmZoneById(b.zone).theme]}"` : ""}>
        <div class="pkb-row foe dbl-row${b.triple ? " tri" : ""}">${b.foes.map((m) => box(m, "foe")).join("")}</div>
        <div class="pkb-row me dbl-row${b.triple ? " tri" : ""}">${b.mine.map((m) => box(m, "me")).join("")}</div>
      </div>
      <div class="pkb-msg" aria-live="polite">${pkmEsc(b.msg || "")}${!busy && d.slot >= 0 && !d.refill.length && !b.awaitRevive ? ` <b>(${pkmEsc(b.mine[d.slot].display)})</b>` : ""}</div>
      <div class="pk-controls pkb-controls">${controls}</div>`;
    const tImg = battlePanel.querySelector(".pkb-tr-img");
    if (tImg) pkmTrainerImg(tImg);
    battlePanel.querySelectorAll(".dbl-spr.back").forEach((img) => { img.onerror = () => { img.onerror = null; const m = b.mine.find((x) => x && x.back === img.getAttribute("src")); if (m) img.src = m.front; img.classList.add("flip"); }; });
    battlePanel.onclick = async (e) => {
      if (b.over) return;
      const g = (k) => e.target.closest(`[${k}]`);
      if (g("data-dsw")) {
        const id = g("data-dsw").dataset.dsw;
        if (d.refill.length) { const slot = d.refill.shift(); b.busy = true; await pkmDblSwitch(b, slot, id); b.busy = false; if (d.refill.length) return drawBattle("Choose another Pokémon to send out!"); return pkmDblNewTurn(b); }
        return pkmDblPick(b, { type: "switch", id });
      }
      if (b.busy) return;
      if (g("data-dm")) {
        const me = b.mine[d.slot];
        const mv = me.moves[+g("data-dm").dataset.dm];
        if (!mv || mv.pp <= 0) return;
        if (pkmDblNeedsTarget(mv) && b.foes.filter((f) => f && f.hp > 0).length > 1) { d.pending = mv; d.stage = "target"; return drawBattle(`Which foe should ${me.display} target?`); }
        return pkmDblPick(b, { mv, target: b.foes.find((f) => f && f.hp > 0) });
      }
      if (g("data-dt")) return pkmDblPick(b, { mv: d.pending, target: b.foes[+g("data-dt").dataset.dt] });
      const a = g("data-dact") && g("data-dact").dataset.dact;
      if (a === "back") { d.stage = "move"; return drawBattle(); }
      if (a === "switch") { d.stage = "switch"; return drawBattle(`Switch ${b.mine[d.slot].display} for…`); }
      if (a === "potion") return pkmDblPick(b, { type: "potion" });
      if (a === "run") return runAway();
      if (a === "giveup") { b.awaitRevive = false; return pkmLose(b); }
      if (a === "revive") {
        if (getInt("pkm_revive") <= 0) return;
        setInt("pkm_revive", getInt("pkm_revive") - 1);
        const m = b.mine.find(Boolean);
        m.hp = Math.floor(m.maxHP / 2); m.status = null; m.faintDone = false;
        pkmSaveMonHP(m);
        b.awaitRevive = false;
        pkmDblPrimary(b);
        playSound("heal");
        return pkmDblNewTurn(b);
      }
    };
    pkmBattleKeys(battlePanel.querySelector(".pk-controls"));
  }
  /** A random trainer who battles 2 vs 2. */
  function pkmDoubleTrainer() {
    const t = pkmRandomTrainer();
    const L = pkmTrainerBase();
    const c = PKM_TRAINER_CLASSES.find((x) => x.title === t.title) || PKM_TRAINER_CLASSES[0];
    t.team = Array.from({ length: 4 }, () => [pkmPick(c.pool), Math.max(2, Math.min(MAX_LEVEL, L + pkmRand(-2, 1)))]);
    t.title = `${t.title} duo`;
    t.double = true;
    return t;
  }
  pkmStyle(`
    .dbl-field{gap:8px}
    .dbl-row{display:grid!important;grid-template-columns:1fr 1fr;gap:8px;align-items:end}
    .dbl-row.tri{grid-template-columns:1fr 1fr 1fr}
    .dbl-row.tri .dbl-spr{width:64px;height:64px}
    .dbl-row.tri .dbl-info{font-size:11px;padding:3px 5px}
    .dbl-mon{display:flex;flex-direction:column;align-items:center;gap:2px;min-height:90px}
    .dbl-mon.out{opacity:.35}
    .dbl-spr{width:80px;height:80px;image-rendering:pixelated}
    .dbl-spr.flip{transform:scaleX(-1)}
    .dbl-info{background:rgba(255,255,255,.94);border-radius:10px;padding:4px 8px;width:100%;box-sizing:border-box;color:#222;font-size:12px}
    .dbl-info .pkb-name{font-size:12.5px}
  `, "pkm-v39");

  // =====================================================================
  //  3.9: Alola and Galar, Mega Stones, G-Max moves, Tera Blast + Terapagos,
  //  TMs and tutors, Pokédex entries, map events and dungeons, rank,
  //  seasonal Tower, specials in doubles, auto battle, move tooltips
  // =====================================================================
  // ---------- Alola (Island Challenge) and Galar (Gym Challenge) ----------
  PKM_GYMS.push(
    pkmG(49, "Ilima", "Normalium Stamp", "normal", "⚪", "#cfcfcf", "ilima", 96, ["gumshoos", "smeargle", "komala"], "You passed the Normal-type trial!"),
    pkmG(50, "Lana", "Waterium Stamp", "water", "🌊", "#3b8ae6", "lana", 96, ["araquanid", "wishiwashi", "primarina"], "You passed the Water-type trial!", { weather: "rain" }),
    pkmG(51, "Kiawe", "Firium Stamp", "fire", "🔥", "#ff6b3d", "kiawe", 97, ["salazzle", "marowak", "turtonator"], "Your fire burned brighter than mine!", { weather: "sun" }),
    pkmG(52, "Mallow", "Grassium Stamp", "grass", "🌿", "#59b95a", "mallow", 97, ["shiinotic", "lurantis", "tsareena"], "That was delicious! You passed the trial."),
    pkmG(53, "Sophocles", "Electrium Stamp", "electric", "⚡", "#ffd321", "sophocles", 98, ["togedemaru", "vikavolt", "magnezone"], "My calculations were off… You win."),
    pkmG(54, "Acerola", "Ghostium Stamp", "ghost", "👻", "#7b52a8", "acerola", 98, ["mimikyu", "palossand", "dhelmise"], "Spooky good! The trial is yours."),
    pkmG(55, "Mina", "Fairium Stamp", "fairy", "🎨", "#f7a6d8", "mina", 99, ["ribombee", "granbull", "comfey"], "You painted a masterpiece of a battle."),
    pkmG(56, "Hapu", "Groundium Stamp", "ground", "⛰️", "#c9a14a", "hapu", 100, ["mudsdale", "golurk", "flygon"], "You've earned the Kahuna's seal.", { weather: "sand" }),
    pkmG(57, "Milo", "Grass Badge", "grass", "🌾", "#6bc16b", "milo", 96, ["eldegoss", "flapple", "appletun"], "You've grown strong! The Grass Badge."),
    pkmG(58, "Nessa", "Water Badge", "water", "💧", "#4fa3ff", "nessa", 96, ["drednaw", "golisopod", "barraskewda"], "You're the real deal. The Water Badge!", { weather: "rain" }),
    pkmG(59, "Kabu", "Fire Badge", "fire", "🔥", "#ff7a2f", "kabu", 97, ["centiskorch", "arcanine", "ninetales"], "Your passion outburned mine. The Fire Badge.", { weather: "sun" }),
    pkmG(60, "Bea", "Fighting Badge", "fighting", "🥋", "#c8553d", "bea", 97, ["sirfetchd", "hitmontop", "grapploct", "machamp"], "I need more training. Take the Fighting Badge."),
    pkmG(61, "Opal", "Fairy Badge", "fairy", "☂️", "#f7a6d8", "opal", 98, ["mawile", "togekiss", "alcremie"], "Your pink is perfect. The Fairy Badge!"),
    pkmG(62, "Gordie", "Rock Badge", "rock", "🪨", "#b59e7b", "gordie", 98, ["coalossal", "stonjourner", "barbaracle"], "You rocked it. The Rock Badge.", { weather: "sand" }),
    pkmG(63, "Piers", "Dark Badge", "dark", "🎸", "#5a4a6a", "piers", 99, ["obstagoon", "malamar", "scrafty"], "That's the end of the song. The Dark Badge."),
    pkmG(64, "Raihan", "Dragon Badge", "dragon", "🐉", "#4a63d9", "raihan", 100, ["duraludon", "flygon", "goodra"], "Gotta take a selfie with you! The Dragon Badge.", { weather: "sand" })
  );
  PKM_LEAGUES.alola = [
    pkmL("Hala", "hala", "fighting", "You've grown so much!", [["hariyama", 100], ["crabominable", 100], ["bewear", 100], ["primeape", 100], ["poliwrath", 100, "sitrus-berry"]]),
    pkmL("Olivia", "olivia", "rock", "Tough as diamonds!", [["lycanroc", 100], ["golem", 100], ["probopass", 100], ["carbink", 100], ["relicanth", 100, "sitrus-berry"]]),
    pkmL("Acerola", "acerola", "ghost", "That was a spooky-good battle!", [["sableye", 100], ["froslass", 100], ["drifblim", 100], ["dhelmise", 100], ["palossand", 100, "sitrus-berry"]]),
    pkmL("Kahili", "kahili", "flying", "Hole in one, for you!", [["skarmory", 100], ["crobat", 100], ["oricorio", 100], ["mandibuzz", 100], ["toucannon", 100, "sitrus-berry"]]),
    pkmL("Kukui", "kukui", "normal", "Woo! You're Alola's first Champion!", [["lycanroc", 100], ["ninetales", 100], ["braviary", 100], ["magnezone", 100], ["snorlax", 100], ["incineroar", 100, "sitrus-berry"]], "Champion"),
  ];
  PKM_LEAGUES.galar = [
    pkmL("Marnie", "marnie", "dark", "You were great out there.", [["liepard", 100], ["toxicroak", 100], ["scrafty", 100], ["morpeko", 100], ["grimmsnarl", 100, "sitrus-berry"]], "Semifinalist"),
    pkmL("Hop", "hop", "normal", "Mate, you're amazing!", [["dubwool", 100], ["pincurchin", 100], ["corviknight", 100], ["snorlax", 100], ["rillaboom", 100, "sitrus-berry"]], "Semifinalist"),
    pkmL("Bede", "bede", "fairy", "Hmph. Fine. You win.", [["gardevoir", 100], ["hatterene", 100], ["mawile", 100], ["rapidash", 100], ["gothitelle", 100, "sitrus-berry"]], "Semifinalist"),
    pkmL("Raihan", "raihan", "dragon", "That's a battle for the history books!", [["flygon", 100], ["sandaconda", 100], ["gigalith", 100], ["turtonator", 100], ["duraludon", 100, "sitrus-berry"]], "Gym Leader"),
    pkmL("Leon", "leon", "fire", "You're the new Champion of Galar!", [["aegislash", 100], ["dragapult", 100], ["haxorus", 100], ["seismitoad", 100], ["mr-rime", 100], ["charizard", 100, "sitrus-berry"]], "Champion"),
  ];
  PKM_REGIONS.push(
    { id: "alola", name: "Alola", icon: "🌺", gyms: [49, 56], dex: [722, 809], coin: 0.3, bonus: 45000 },
    { id: "galar", name: "Galar", icon: "🏰", gyms: [57, 64], dex: [810, 905], coin: 0.3, bonus: 50000 }
  );
  PKM_ZONES.alola = [
    pkmZ("hauoli-outskirts", "Hau'oli Outskirts", "🌴", [90, 98], 0, "grass", ["gumshoos", "trumbeak", "charjabug", "crabrawler", "oricorio", "ribombee"]),
    pkmZ("lush-jungle", "Lush Jungle", "🌳", [92, 100], 0, "forest", ["lurantis", "shiinotic", "tsareena", "comfey", "toucannon", "bewear"]),
    pkmZ("ten-carat-hill", "Ten Carat Hill", "💎", [94, 100], 2, "cave", ["lycanroc", "carbink", "sableye", "golbat", "gigalith"]),
    pkmZ("brooklet-hill", "Brooklet Hill", "💧", [96, 100], 4, "water", ["araquanid", "wishiwashi", "masquerain", "bruxish", "pyukumuku"]),
    pkmZ("wela-volcano", "Wela Volcano", "🌋", [98, 100], 6, "mountain", ["salazzle", "turtonator", "marowak", "magmar", "fletchinder"]),
    pkmZ("mount-lanakila", "Mount Lanakila", "🏔️", [100, 100], 8, "snow", ["crabominable", "vanilluxe", "sneasel", "absol", "glalie", "froslass"]),
  ];
  PKM_ZONES.galar = [
    pkmZ("galar-route2", "Route 2", "🐑", [90, 98], 0, "grass", ["greedent", "corviknight", "dubwool", "thievul", "boltund", "eldegoss"]),
    pkmZ("slumbering-weald", "Slumbering Weald", "🌫️", [92, 100], 0, "forest", ["orbeetle", "thievul", "greedent", "hatterene", "grimmsnarl", "morgrem"]),
    pkmZ("galar-mine", "Galar Mine", "⛏️", [94, 100], 2, "cave", ["coalossal", "drednaw", "stonjourner", "excadrill", "onix", "centiskorch"]),
    pkmZ("lake-of-outrage", "Lake of Outrage", "🌊", [96, 100], 4, "water", ["barraskewda", "drednaw", "gyarados", "cramorant", "lapras", "dhelmise"]),
    pkmZ("hammerlocke-hills", "Hammerlocke Hills", "🏯", [98, 100], 6, "mountain", ["duraludon", "sandaconda", "copperajah", "falinks", "hawlucha", "flapple"]),
    pkmZ("circhester-bay", "Circhester Bay", "❄️", [100, 100], 8, "snow", ["frosmoth", "eiscue", "mr-rime", "abomasnow", "lapras", "cryogonal"]),
  ];
  PKM_LEGENDS.push(
    { name: "tapu-koko", id: 785, lv: 100, req: { region: "alola", badges: 3 } },
    { name: "tapu-lele", id: 786, lv: 100, req: { region: "alola", badges: 5 } },
    { name: "tapu-bulu", id: 787, lv: 100, req: { region: "alola", badges: 7 } },
    { name: "tapu-fini", id: 788, lv: 100, req: { region: "alola", badges: 8 } },
    { name: "solgaleo", id: 791, lv: 100, req: { league: "alola" } },
    { name: "lunala", id: 792, lv: 100, req: { league: "alola" }, night: true },
    { name: "necrozma", id: 800, lv: 100, req: { league: "alola", dex: 600 } },
    { name: "regieleki", id: 894, lv: 100, req: { region: "galar", badges: 8 } },
    { name: "regidrago", id: 895, lv: 100, req: { region: "galar", badges: 8 } },
    { name: "zacian", id: 888, lv: 100, req: { league: "galar" } },
    { name: "zamazenta", id: 889, lv: 100, req: { league: "galar" } },
    { name: "eternatus", id: 890, lv: 100, req: { league: "galar", dex: 650 } },
    { name: "terapagos", id: 1024, lv: 100, req: { leagues: 8, dex: 700 } }
  );
  if (PKM_GYMS.some((g, i) => g.n !== i + 1)) console.warn("Pokémon: gym numbers are out of order");
  // The badge and Champion achievements now cover all eight regions
  for (const a of PKM_ACH) {
    if (a[0] === "badges48") { a[2] = "Badge collector"; a[3] = `Earn all ${PKM_GYMS.length} Gym badges and stamps`; a[5] = PKM_GYMS.length; }
    if (a[0] === "champ_all") { a[3] = `Beat all ${PKM_REGIONS.length} Champions`; a[5] = PKM_REGIONS.length; }
  }
  PKM_ACH.push(...PKM_REGIONS.slice(6).map((r) => [`champ_${r.id}`, r.icon, `${r.name} Champion`, `Beat the ${r.name} Champion`, () => (pkmRegionDone(r.id) ? 1 : 0), 1]));

  // ---------- Mega Stones: the Pokémon must hold its own stone (plus you need the Mega Ring) ----------
  const PKM_MEGA_STONES = [
    ["venusaurite", "Venusaurite", "venusaur-mega"], ["charizardite-x", "Charizardite X", "charizard-mega-x"], ["charizardite-y", "Charizardite Y", "charizard-mega-y"],
    ["blastoisinite", "Blastoisinite", "blastoise-mega"], ["alakazite", "Alakazite", "alakazam-mega"], ["gengarite", "Gengarite", "gengar-mega"], ["kangaskhanite", "Kangaskhanite", "kangaskhan-mega"],
    ["pinsirite", "Pinsirite", "pinsir-mega"], ["gyaradosite", "Gyaradosite", "gyarados-mega"], ["aerodactylite", "Aerodactylite", "aerodactyl-mega"], ["mewtwonite-x", "Mewtwonite X", "mewtwo-mega-x"],
    ["mewtwonite-y", "Mewtwonite Y", "mewtwo-mega-y"], ["ampharosite", "Ampharosite", "ampharos-mega"], ["scizorite", "Scizorite", "scizor-mega"], ["heracronite", "Heracronite", "heracross-mega"],
    ["houndoominite", "Houndoominite", "houndoom-mega"], ["tyranitarite", "Tyranitarite", "tyranitar-mega"], ["blazikenite", "Blazikenite", "blaziken-mega"], ["gardevoirite", "Gardevoirite", "gardevoir-mega"],
    ["mawilite", "Mawilite", "mawile-mega"], ["aggronite", "Aggronite", "aggron-mega"], ["medichamite", "Medichamite", "medicham-mega"], ["manectite", "Manectite", "manectric-mega"],
    ["banettite", "Banettite", "banette-mega"], ["absolite", "Absolite", "absol-mega"], ["garchompite", "Garchompite", "garchomp-mega"], ["lucarionite", "Lucarionite", "lucario-mega"],
    ["abomasite", "Abomasite", "abomasnow-mega"], ["beedrillite", "Beedrillite", "beedrill-mega"], ["pidgeotite", "Pidgeotite", "pidgeot-mega"], ["slowbronite", "Slowbronite", "slowbro-mega"],
    ["steelixite", "Steelixite", "steelix-mega"], ["sceptilite", "Sceptilite", "sceptile-mega"], ["swampertite", "Swampertite", "swampert-mega"], ["sablenite", "Sablenite", "sableye-mega"],
    ["sharpedonite", "Sharpedonite", "sharpedo-mega"], ["cameruptite", "Cameruptite", "camerupt-mega"], ["altarianite", "Altarianite", "altaria-mega"], ["glalitite", "Glalitite", "glalie-mega"],
    ["salamencite", "Salamencite", "salamence-mega"], ["metagrossite", "Metagrossite", "metagross-mega"], ["latiasite", "Latiasite", "latias-mega"], ["latiosite", "Latiosite", "latios-mega"],
    ["lopunnite", "Lopunnite", "lopunny-mega"], ["galladite", "Galladite", "gallade-mega"], ["audinite", "Audinite", "audino-mega"], ["diancite", "Diancite", "diancie-mega"],
  ];
  for (const [img, name, form] of PKM_MEGA_STONES) PKM_ITEMS.push({ img, name, key: `pkm_item_${img}`, price: 6000, cat: "held", desc: `Lets ${pkmCap(form.split("-mega")[0])} Mega Evolve in battle (you also need the Mega Ring). Give it to that Pokémon in the Bag.` });
  for (const it of PKM_ITEMS) if (it.key === "pkm_item_mega-bracelet") it.desc = "Lets a Pokémon that holds its own Mega Stone Mega Evolve once per battle (instead of a Z-Move, Tera or Dynamax).";
  /** The Mega form this Pokémon can reach with the stone it holds (none without the right stone). */
  pkmMegaForms = async function (m) {
    const st = PKM_MEGA_STONES.find((s) => s[0] === m.held);
    return st && st[2].split("-mega")[0] === m.name ? [st[2]] : [];
  };

  // ---------- Signature G-Max moves ----------
  const pkmGx = (type, id, name, fx, power) => ({ type, id, name, fx, power });
  const PKM_GMAX = {
    charizard: pkmGx("fire", "g-max-wildfire", "G-Max Wildfire", "dot"), venusaur: pkmGx("grass", "g-max-vine-lash", "G-Max Vine Lash", "dot"), blastoise: pkmGx("water", "g-max-cannonade", "G-Max Cannonade", "dot"),
    coalossal: pkmGx("rock", "g-max-volcalith", "G-Max Volcalith", "dot"), centiskorch: pkmGx("fire", "g-max-centiferno", "G-Max Centiferno", "dot"), sandaconda: pkmGx("ground", "g-max-sandblast", "G-Max Sandblast", "dot"),
    pikachu: pkmGx("electric", "g-max-volt-crash", "G-Max Volt Crash", "par"), toxtricity: pkmGx("electric", "g-max-stun-shock", "G-Max Stun Shock", "psnpar"), butterfree: pkmGx("bug", "g-max-befuddle", "G-Max Befuddle", "befuddle"),
    grimmsnarl: pkmGx("dark", "g-max-snooze", "G-Max Snooze", "sleep"), hatterene: pkmGx("fairy", "g-max-smite", "G-Max Smite", "confuse"), gengar: pkmGx("ghost", "g-max-terror", "G-Max Terror", "slow"),
    lapras: pkmGx("ice", "g-max-resonance", "G-Max Resonance", "veil"), eevee: pkmGx("normal", "g-max-cuddle", "G-Max Cuddle", "cuddle"), meowth: pkmGx("normal", "g-max-gold-rush", "G-Max Gold Rush", "gold"),
    corviknight: pkmGx("flying", "g-max-wind-rage", "G-Max Wind Rage", "defog"), drednaw: pkmGx("water", "g-max-stonesurge", "G-Max Stonesurge", "rocks"), copperajah: pkmGx("steel", "g-max-steelsurge", "G-Max Steelsurge", "rocks"),
    kingler: pkmGx("water", "g-max-foam-burst", "G-Max Foam Burst", "foam"), alcremie: pkmGx("fairy", "g-max-finale", "G-Max Finale", "heal"), appletun: pkmGx("grass", "g-max-sweetness", "G-Max Sweetness", "heal"),
    flapple: pkmGx("grass", "g-max-tartness", "G-Max Tartness", "tart"), machamp: pkmGx("fighting", "g-max-chi-strike", "G-Max Chi Strike", "chi"), snorlax: pkmGx("normal", "g-max-replenish", "G-Max Replenish", "heal"),
    rillaboom: pkmGx("grass", "g-max-drum-solo", "G-Max Drum Solo", "none", 160), cinderace: pkmGx("fire", "g-max-fireball", "G-Max Fireball", "none", 160), inteleon: pkmGx("water", "g-max-hydrosnipe", "G-Max Hydrosnipe", "none", 160),
  };
  {
    const mm = pkmMaxMove;
    pkmMaxMove = function (mv, mon) {
      const x = mm(mv);
      const g = mon && mon.gmaxOrig && PKM_GMAX[mon.name];
      if (g && x.cls !== "status" && g.type === mv.type) Object.assign(x, { name: g.id, display: g.name, gmax: g.fx, power: g.power || x.power });
      return x;
    };
    const me = pkmMaxEffect;
    pkmMaxEffect = async function (b, att, def, mv) {
      if (!mv.gmax) return me.apply(this, arguments);
      const foes = b.double ? pkmDblFoesOf(b, att) : [def].filter((x) => x.hp > 0);
      const fx = mv.gmax;
      if (fx === "dot") { b.gmaxDot = b.gmaxDot || {}; b.gmaxDot[pkmSide(b, def)] = { type: mv.type, turns: 4, name: mv.display }; return pkmSay(b, `${mv.display} surrounds the foe!`, 800); }
      for (const f of foes) {
        if (fx === "par") await pkmSetStatus(b, f, "par", att);
        else if (fx === "psnpar") await pkmSetStatus(b, f, pkmPick(["psn", "par"]), att);
        else if (fx === "befuddle") await pkmSetStatus(b, f, pkmPick(["psn", "par", "slp"]), att);
        else if (fx === "sleep" && Math.random() < 0.5) await pkmSetStatus(b, f, "slp", att);
        else if (fx === "confuse" && !f.confused) { f.confused = pkmRand(2, 5); await pkmSay(b, `${pkmWho(b, f)} became confused!`, 700); }
        else if (fx === "slow" || fx === "foam") await pkmApplyStages(b, f, [["spe", fx === "foam" ? -2 : -1]], att);
        else if (fx === "cuddle") await pkmApplyStages(b, f, [["atk", -1]], att);
        else if (fx === "tart") await pkmApplyStages(b, f, [["eva", -1]], att);
      }
      if (fx === "veil") { const sc = b.screens[pkmSide(b, att)]; sc.reflect = 5; sc.light = 5; await pkmSay(b, "An aurora veil protects your side!", 800); }
      if (fx === "gold" && pkmMine(b, att)) { const c = 100 * att.level; setInt(STORAGE.coins, getInt(STORAGE.coins) + c); await pkmSay(b, `Coins scattered everywhere! You picked up ${c}.`, 800); }
      if (fx === "defog") { b.hazards[pkmSide(b, def)] = {}; b.screens[pkmSide(b, def)] = {}; await pkmSay(b, "The wind blew away the foe's screens and hazards!", 800); }
      if (fx === "rocks") { b.hazards[pkmSide(b, def)].rock = 1; await pkmSay(b, "Sharp stones float around the foe's side!", 800); }
      if (fx === "heal") await pkmHeal(b, att, att.maxHP / 6, `${pkmWho(b, att)} recovered some HP!`);
      if (fx === "chi") { att.stages.atk = Math.min(6, att.stages.atk + 1); await pkmSay(b, `${pkmWho(b, att)} is getting pumped!`, 700); }
    };
    const eot = pkmEndOfTurn;
    pkmEndOfTurn = async function (b) {
      await eot.apply(this, arguments);
      for (const side of ["me", "foe"]) {
        const d = b.gmaxDot && b.gmaxDot[side];
        if (!d || !pkmAlive(b)) continue;
        for (const m of pkmActive(b).filter((x) => pkmSide(b, x) === side && x.hp > 0 && !x.types.includes(d.type))) await pkmHurt(b, m, m.maxHP / 6, `${pkmWho(b, m)} is hurt by ${d.name}!`);
        if (--d.turns <= 0) b.gmaxDot[side] = null;
      }
    };
  }

  // ---------- Tera Blast, and Terapagos's Stellar form ----------
  {
    const tz = pkmTerastallize;
    pkmTerastallize = async function (b) {
      const m = b.me;
      const pagos = /^terapagos/.test(m.name);
      if (pagos) m.teraType = "stellar";
      await tz.apply(this, arguments);
      if (pagos) {
        m.types = m.origTypes.slice();
        const d = await pkmPokemonData("terapagos-stellar").catch(() => null);
        if (d) {
          const base = pkmBase(d);
          const hpShare = m.hp / m.maxHP;
          m.base = base;
          m.stats = pkmCalcStats(base, m.level, m.iv, m.nature, m.ev);
          m.maxHP = m.stats.hp;
          m.hp = Math.max(1, Math.round(m.maxHP * hpShare));
          const sp = d.sprites || {};
          if (sp.front_default) m.front = sp.front_default;
          if (sp.back_default) m.back = sp.back_default;
          m.display = "Terapagos (Stellar Form)";
          pkmSyncGlobals(b);
          await pkmSay(b, "Terapagos shone with Stellar light and changed form!", 1300);
        }
      }
      // Tera Blast becomes the Tera type and uses the higher attacking stat
      if (!m.moves.some((x) => x.name === "tera-blast")) {
        const tb = { ...PKM_TACKLE, name: "tera-blast", display: "Tera Blast", type: m.tera === "stellar" ? "normal" : m.tera, power: m.tera === "stellar" ? 100 : 80, acc: 100, pp: 10, maxPP: 10, cls: m.stats.atk > m.stats.spa ? "physical" : "special" };
        const weakest = m.moves.filter((x) => x.cls !== "status").sort((a, c) => a.power - c.power)[0];
        if (m.moves.length < 4) m.moves.push(tb);
        else if (weakest) m.moves[m.moves.indexOf(weakest)] = tb;
        await pkmSay(b, `${m.display} can now use Tera Blast!`, 800);
      }
    };
  }

  // ---------- TMs and the Move Tutor ----------
  const PKM_TMS = [
    ["flamethrower", "fire", 3000], ["thunderbolt", "electric", 3000], ["ice-beam", "ice", 3000], ["surf", "water", 3000], ["earthquake", "ground", 4000], ["psychic", "psychic", 3000],
    ["shadow-ball", "ghost", 3000], ["energy-ball", "grass", 2500], ["sludge-bomb", "poison", 2500], ["focus-blast", "fighting", 2500], ["dragon-pulse", "dragon", 2500], ["dark-pulse", "dark", 2500],
    ["flash-cannon", "steel", 2500], ["dazzling-gleam", "fairy", 2500], ["air-slash", "flying", 2500], ["bug-buzz", "bug", 2500], ["rock-slide", "rock", 2500], ["x-scissor", "bug", 2000],
    ["brick-break", "fighting", 2000], ["iron-head", "steel", 2500], ["swords-dance", "normal", 3000], ["calm-mind", "psychic", 3000], ["bulk-up", "fighting", 3000], ["nasty-plot", "dark", 3000],
    ["protect", "normal", 1500], ["toxic", "poison", 2000], ["thunder-wave", "electric", 1500], ["will-o-wisp", "fire", 2000], ["stealth-rock", "rock", 2500], ["substitute", "normal", 2000],
    ["rain-dance", "water", 1500], ["sunny-day", "fire", 1500], ["reflect", "psychic", 1500], ["light-screen", "psychic", 1500], ["u-turn", "bug", 2500], ["volt-switch", "electric", 2500],
  ];
  for (const [mv, type, price] of PKM_TMS) PKM_ITEMS.push({ img: `tm-${type}`, name: `TM ${pkmCap(mv)}`, key: `pkm_tm_${mv}`, price, cat: "tm", desc: `Teaches ${pkmCap(mv)} to a Pokémon that can learn it. Used up. Use it at the Move Tutor.` });
  const PKM_TUTOR_PRICE = { tm: 2500, egg: 3500 };
  let pkmTutorPanel = null;
  let pkmTutorSel = null;
  let pkmTutorSlot = 0;
  let pkmTutorMsg = "";
  function pkmCloseTutor() { if (pkmTutorPanel) pkmTutorPanel.remove(); pkmTutorPanel = null; }
  function pkmOpenTutor(id) {
    if (typeof id === "string") pkmTutorSel = id;
    if (!pkmTutorPanel) {
      pkmTutorPanel = pkmMakePanel("pkm-tutor", "Move tutor and TMs", pkmTutorClick);
      pkmTutorPanel.onchange = (e) => { if (e.target.matches(".mt-who")) { pkmTutorSel = e.target.value; pkmTutorSlot = 0; pkmTutorMsg = ""; pkmDrawTutor(); } if (e.target.matches(".mt-slot")) pkmTutorSlot = +e.target.value; };
    }
    pkmDrawTutor();
  }
  async function pkmDrawTutor() {
    const P = pkmTutorPanel;
    if (!P) return;
    const party = getObj(STORAGE.party) || {};
    const ids = Object.keys(party);
    if (!ids.length) return;
    if (!pkmTutorSel || !party[pkmTutorSel]) pkmTutorSel = ids[0];
    const id = pkmTutorSel;
    const st = (getObj(STORAGE.stats) || {})[id] || {};
    const d = await pkmPokemonData(party[id].name);
    if (!pkmTutorPanel || !d) return;
    const known = Array.isArray(st.moves) ? st.moves : [];
    const cur = await pkmMovesByNames(known);
    const tmSet = new Set(d._tm || []);
    const eggSet = new Set(d._egg || []);
    const ownedTMs = PKM_TMS.filter(([mv]) => getInt(`pkm_tm_${mv}`) > 0 && !known.includes(mv) && (tmSet.has(mv) || (d._lv || []).some(([n]) => n === mv)));
    const tutorNames = [...new Set([...(d._tm || []), ...(d._egg || [])])].filter((n) => !known.includes(n)).slice(0, 80);
    const tutor = (await pkmMovesByNames(tutorNames)).sort((a, c) => c.power - a.power);
    if (!pkmTutorPanel) return;
    const row = (m) => `<span class="pk-type ${m.type}">${m.type}</span><b>${pkmEsc(m.display)}</b><span class="pkm-dim">${m.cls === "status" ? "Status" : `${m.fixed ? "fixed" : m.power} pow`} · ${m.acc || "—"}%</span>`;
    P.innerHTML = `${pkmPanelHead("🎓 Move tutor & TMs", "mt-head")}${pkmTutorMsg ? `<div class="bag-msg" role="status">${pkmEsc(pkmTutorMsg)}</div>` : ""}<div class="lk-body">
      <label class="lk-l">Pokémon <select class="mt-who">${ids.slice(0, 120).map((i) => `<option value="${pkmEsc(i)}" ${i === id ? "selected" : ""}>${pkmEsc(pkmCap(party[i].name))} (Lv ${((getObj(STORAGE.stats) || {})[i] || {}).level || 1})</option>`).join("")}</select></label>
      <label class="lk-l">Put the new move in <select class="mt-slot">${cur.map((m, i) => `<option value="${i}" ${i === pkmTutorSlot ? "selected" : ""}>Replace ${pkmEsc(m.display)}</option>`).join("")}${cur.length < 4 ? `<option value="${cur.length}" ${pkmTutorSlot === cur.length ? "selected" : ""}>An empty slot</option>` : ""}</select></label>
      <div class="bag-sec"><span>Your TMs it can learn</span><span class="pkm-dim">${ownedTMs.length}</span></div>
      ${ownedTMs.length ? ownedTMs.map(([mv]) => `<div class="mv-row"><b>TM</b> ${pkmEsc(pkmCap(mv))} <span class="pkm-dim">×${getInt(`pkm_tm_${mv}`)}</span><button type="button" class="pkm-btn2 primary" data-tm="${pkmEsc(mv)}">Use TM</button></div>`).join("") : `<div class="pkm-dim">No usable TMs. Buy them in the PokéMart (TMs tab).</div>`}
      <div class="bag-sec"><span>Tutor moves</span><span class="pkm-dim">TM moves 💰 ${PKM_TUTOR_PRICE.tm}, egg moves 💰 ${PKM_TUTOR_PRICE.egg}</span></div>
      <div class="mv-list">${tutor.length ? tutor.map((m) => `<div class="mv-row">${row(m)}${eggSet.has(m.name) && !tmSet.has(m.name) ? ' <b class="bag-new">EGG</b>' : ""}<button type="button" class="pkm-btn2" data-tutor="${pkmEsc(m.name)}">Learn · ${eggSet.has(m.name) && !tmSet.has(m.name) ? PKM_TUTOR_PRICE.egg : PKM_TUTOR_PRICE.tm}</button></div>`).join("") : `<div class="pkm-dim">Nothing else to teach.</div>`}</div></div>`;
  }
  async function pkmTutorClick(e) {
    const a = e.target.closest("[data-a]")?.dataset.a;
    if (a === "close") return pkmCloseTutor();
    const tm = e.target.closest("[data-tm]");
    const tu = e.target.closest("[data-tutor]");
    if (!tm && !tu) return;
    const id = pkmTutorSel;
    const party = getObj(STORAGE.party) || {};
    const d = await pkmPokemonData(party[id].name);
    const mv = tm ? tm.dataset.tm : tu.dataset.tutor;
    if (tm) {
      if (getInt(`pkm_tm_${mv}`) <= 0) return;
      setInt(`pkm_tm_${mv}`, getInt(`pkm_tm_${mv}`) - 1);
    } else {
      const price = (d._egg || []).includes(mv) && !(d._tm || []).includes(mv) ? PKM_TUTOR_PRICE.egg : PKM_TUTOR_PRICE.tm;
      if (getInt(STORAGE.coins) < price) { pkmTutorMsg = `You need ${price} coins.`; return pkmDrawTutor(); }
      setInt(STORAGE.coins, getInt(STORAGE.coins) - price);
    }
    const all = getObj(STORAGE.stats) || {};
    const s = all[id] || {};
    const moves = Array.isArray(s.moves) ? s.moves.slice() : [];
    const slot = Math.min(pkmTutorSlot, moves.length, 3);
    const old = moves[slot];
    moves[slot] = mv;
    s.moves = moves.slice(0, 4);
    all[id] = s;
    setObj(STORAGE.stats, all);
    playSound("level");
    pkmTrack("tutored");
    pkmTutorMsg = `${pkmCap(party[id].name)} ${old ? `forgot ${pkmCap(old)} and ` : ""}learned ${pkmCap(mv)}!`;
    pkmDrawTutor();
  }

  // ---------- Pokédex entries with habitats ----------
  function pkmHabitats(name) {
    const out = [];
    for (const r of PKM_REGIONS) for (const z of PKM_ZONES[r.id] || []) if (z.pool.includes(name)) out.push(`${z.icon} ${z.name} (${r.name}, Lv ${z.lv[0]}–${z.lv[1]})`);
    if (PKM_NIGHT_POOL.includes(name)) out.push("🌙 Wild battles at night");
    if (PKM_DAY_POOL.includes(name)) out.push("🌞 Wild battles during the day");
    if (PKM_SAFARI_POOL.includes(name) || PKM_SAFARI_LEGENDS.includes(name)) out.push("🌴 Safari Zone");
    if (PKM_LEGENDS.some((l) => l.name === name)) out.push("🌟 Legendary hunt");
    if (PKM_RAID_POOL.includes(name) || PKM_RAID_POOL5.includes(name)) out.push("💥 Raid den");
    if (PKM_EVENTS.some((ev) => ev.pool.includes(name))) out.push("🎉 Seasonal events");
    return out;
  }
  let pkmDexEntryPanel = null;
  function pkmCloseDexEntry() { if (pkmDexEntryPanel) pkmDexEntryPanel.remove(); pkmDexEntryPanel = null; }
  async function pkmOpenDexEntry(id, name, own) {
    if (!pkmDexEntryPanel) pkmDexEntryPanel = pkmMakePanel("pkm-dexentry", "Pokédex entry", (e) => { if (e.target.closest("[data-a='close']")) pkmCloseDexEntry(); });
    const P = pkmDexEntryPanel;
    P.innerHTML = `<div class="pkb-loading">Loading #${id}…</div>`;
    const [d, sp] = await Promise.all([pkmPokemonData(name).catch(() => null), pkmSpeciesData(name).catch(() => null)]);
    if (!pkmDexEntryPanel) return;
    const hab = pkmHabitats(name);
    const base = d ? pkmBase(d) : null;
    const bar = (k, label) => `<div class="tc-ev"><span>${label}</span><div class="bc-bar"><span style="width:${Math.min(100, Math.round((base[k] / 200) * 100))}%"></span></div><b>${base[k]}</b></div>`;
    const sprite = own ? (d && d.sprites && d.sprites.front_default) || `${PKM_SPRITES}${id}.png` : `${PKM_SPRITES}${id}.png`;
    P.innerHTML = `<div class="pkm-set-head dx-head"><span>📖 #${id} ${own ? pkmEsc(pkmCap(name)) : "???"}</span><button type="button" class="pkm-x" data-a="close" aria-label="Close" title="Close (Esc)">✕</button></div>
      <div class="lk-body"><div class="rd-boss"><img class="${own ? "" : "dx-sil"}" src="${pkmEsc(sprite)}" alt=""><div>
        ${own && d ? `<div>${d.types.map((t) => `<span class="pk-type ${t.type.name}">${t.type.name}</span>`).join("")}</div><div class="pkm-dim">Height ${(d.height / 10).toFixed(1)} m · Weight ${(d.weight / 10).toFixed(1)} kg</div>
        <div class="pkm-dim">Abilities: ${(d.abilities || []).map((a) => `${pkmEsc(pkmCap(a.ability.name))}${a.is_hidden ? " (hidden)" : ""}`).join(", ")}</div>
        ${sp ? `<div class="pkm-dim">Egg groups: ${(sp.egg_groups || []).map(pkmCap).join(", ") || "—"} · Catch rate ${sp.capture_rate}${sp.evolves_from ? ` · Evolves from ${pkmEsc(pkmCap(sp.evolves_from))}` : ""}</div>` : ""}` : `<div class="pkm-dim">You haven't caught this Pokémon yet.</div>`}
      </div></div>
      ${own && base ? `<div class="bag-sec"><span>Base stats</span><span class="pkm-dim">Total ${Object.values(base).reduce((a, c) => a + c, 0)}</span></div><div class="tc-evs">${bar("hp", "HP")}${bar("atk", "Attack")}${bar("def", "Defense")}${bar("spa", "Sp. Atk")}${bar("spd", "Sp. Def")}${bar("spe", "Speed")}</div>` : ""}
      <div class="bag-sec"><span>Where to find it</span></div>
      ${hab.length ? `<ul class="oc-list">${hab.map((h) => `<li>${pkmEsc(h)}</li>`).join("")}</ul>` : `<div class="pkm-dim">Not in a fixed place. Try random wild battles, Eggs or trades.</div>`}</div>`;
  }

  // ---------- Map events: hourly swarms and the Mystery Dungeon ----------
  const pkmHourSlot = () => Math.floor(Date.now() / 36e5);
  /** One place has a swarm of one Pokémon each hour (the same for everyone). */
  function pkmSwarm(slot = pkmHourSlot()) {
    const r = pkmRng(slot * 104729 + 7);
    const zones = pkmAllZones().filter((z) => pkmZoneOpen(z));
    if (!zones.length) return null;
    const z = zones[Math.floor(r() * zones.length)];
    return { zone: z, species: z.pool[Math.floor(r() * z.pool.length)], ends: (slot + 1) * 36e5 };
  }
  {
    const zw = pkmZoneWild;
    pkmZoneWild = async function (z) {
      const sw = pkmSwarm();
      if (sw && sw.zone.id === z.id && Math.random() < 0.6) return zw({ ...z, pool: [sw.species] });
      return zw.apply(this, arguments);
    };
  }
  /** The Mystery Dungeon opens for 40 minutes every 2 hours. */
  const pkmDungeonOpen = () => GM_getValue("pkm_dungeon_force", "") === "open" || (Date.now() / 6e4) % 120 < 40;
  const pkmDungeonSlot = () => Math.floor(Date.now() / (120 * 6e4));
  const pkmDungeon = () => Object.assign({ active: false, floor: 1, step: 0, slot: -1, cleared: -1, msg: "" }, pkmJSON("pkm_dungeon", {}));
  const PKM_DUNGEON_FLOORS = 5;
  let pkmDungeonPanel = null;
  function pkmCloseDungeon() { if (pkmDungeonPanel) pkmDungeonPanel.remove(); pkmDungeonPanel = null; }
  function pkmOpenDungeon() {
    if (!pkmDungeonPanel) pkmDungeonPanel = pkmMakePanel("pkm-dungeon", "Mystery Dungeon", (e) => {
      const a = e.target.closest("[data-a]")?.dataset.a;
      if (a === "close") return pkmCloseDungeon();
      if (a === "enter") { healPokemon(); pkmSave("pkm_dungeon", { active: true, floor: 1, step: 0, slot: pkmDungeonSlot(), cleared: pkmDungeon().cleared, msg: "You stepped into the dungeon. The air feels strange…" }); return pkmOpenDungeon(); }
      if (a === "leave") { const s = pkmDungeon(); s.active = false; s.msg = "You left the dungeon."; pkmSave("pkm_dungeon", s); return pkmOpenDungeon(); }
      if (a === "walk") return pkmDungeonWalk();
    });
    const s = pkmDungeon();
    const open = pkmDungeonOpen();
    const done = s.cleared === pkmDungeonSlot();
    pkmDungeonPanel.innerHTML = `${pkmPanelHead("🌀 Mystery Dungeon", "dg-head")}<div class="sf-body">
      ${s.active ? `<div class="sf-bar"><span>Floor <b>${s.floor}</b>/${PKM_DUNGEON_FLOORS}</span><span>Steps <b>${s.step}</b>/3</span></div>
        <div class="pkb-field sf-field" style="background:linear-gradient(180deg,#2a1f4a,#4b3a7a 45%,#3a2c5e 46%,#1f1638)"><div class="sf-grass">🌀🕯️🌀🕯️🌀</div></div>
        <div class="pkb-msg" aria-live="polite">${pkmEsc(s.msg || "")}</div>
        <div class="pk-controls pkb-controls sf-ctl"><button type="button" class="pk-btn pkb-act sf-walk" data-a="walk"><div class="pk-ico">👣</div><div class="pk-label">${s.step >= 2 && s.floor >= PKM_DUNGEON_FLOORS ? "Face the guardian" : "Go deeper"}</div></button><button type="button" class="pk-btn pkb-act" data-a="leave"><div class="pk-ico">🚪</div><div class="pk-label">Leave</div></button></div>`
        : `<p>${pkmEsc(s.msg || "")}</p><p>A strange dungeon appears for 40 minutes every 2 hours. Walk down ${PKM_DUNGEON_FLOORS} floors of wild Pokémon, traps and treasure, with your HP carrying over. A guardian waits at the bottom. You can clear it once each time it appears.</p>
          <div class="pkm-btns"><button type="button" class="pkm-btn2 primary" data-a="enter" ${open && !done ? "" : "disabled"}>${!open ? "🔒 Closed right now" : done ? "Cleared ✅" : "Enter"}</button></div>`}</div>`;
  }
  function pkmDungeonWalk() {
    const s = pkmDungeon();
    if (!s.active || battlePanel) return;
    pkmAddSteps(15);
    const lvl = pkmClamp(pkmAreaLevel() + s.floor * 2, 5, MAX_LEVEL);
    const boss = s.floor >= PKM_DUNGEON_FLOORS && s.step >= 2;
    const after = () => { pkmPostBattle = () => { const r = pkmLastResult; const q = pkmDungeon(); if (r === "Lost") { q.active = false; q.msg = `You fainted on floor ${q.floor}. The dungeon pushed you out.`; } else if (r === "Won" || r === "Caught") pkmDungeonAdvance(q, boss); else q.msg = "You backed away."; pkmSave("pkm_dungeon", q); pkmOpenDungeon(); }; };
    const r = Math.random();
    if (boss || r < 0.5) {
      const pool = pkmAllZones().filter((z) => pkmZoneOpen(z)).flatMap((z) => z.pool);
      const name = boss ? pkmPick(PKM_RAID_POOL) : pkmPick(pool.length ? pool : PKM_DAY_POOL);
      after();
      pkmForcedWild = { name, level: boss ? pkmClamp(lvl + 6, 5, MAX_LEVEL) : lvl };
      pkmCloseDungeon();
      openBattle();
      if (!battlePanel) { pkmForcedWild = null; pkmPostBattle = null; pkmOpenDungeon(); }
      return;
    }
    if (r < 0.7) { const it = pkmPick([[STORAGE.ultraBalls, 2, "Ultra Balls"], ["pkm_revive", 1, "Revive"], [STORAGE.potions, 3, "Potions"], ["pkm_item_tera-shard", 1, "Tera Shard"], [pkmRandomStone(), 1, "Evolution stone"]]); pkmGive([it]); s.msg = `You found ${it[1]} × ${it[2]}!`; }
    else if (r < 0.82) { pkmHealShare(-0.12, true); s.msg = "A trap! Everyone lost some HP."; }
    else if (r < 0.92) { pkmHealShare(0.3); s.msg = "A glowing spring healed your party a little."; }
    else s.msg = "Silence… nothing here.";
    pkmDungeonAdvance(s, false);
    pkmSave("pkm_dungeon", s);
    pkmOpenDungeon();
  }
  function pkmDungeonAdvance(s, boss) {
    if (boss) {
      const items = [[STORAGE.masterBalls, 1, "Master Ball"], ["pkm_item_ability-patch", 1, "Ability Patch"], [STORAGE.ultraBalls, 5, "Ultra Balls"]];
      pkmGive(items);
      const c = 5000 + pkmAreaLevel() * 50;
      setInt(STORAGE.coins, getInt(STORAGE.coins) + c);
      pkmTrack("dungeons");
      s.active = false;
      s.cleared = pkmDungeonSlot();
      s.msg = `🌀 You beat the guardian and cleared the dungeon! +${c} coins and ${pkmItemsText(items)}.`;
      return;
    }
    s.step++;
    if (s.step >= 3 && s.floor < PKM_DUNGEON_FLOORS) { s.floor++; s.step = 0; s.msg += ` You found the stairs to floor ${s.floor}.`; }
    else if (s.step > 2) s.step = 2;
  }
  {
    const dm = pkmDrawMap;
    pkmDrawMap = function () {
      const r = dm.apply(this, arguments);
      const P = pkmMapPanel;
      const sw = pkmSwarm();
      if (!P || !P.querySelector(".mp-info")) return r;
      const left = (e) => `${Math.max(0, Math.ceil((e - Date.now()) / 6e4))} min left`;
      P.querySelector(".mp-info").insertAdjacentHTML("beforebegin", `<div class="mp-events">
        ${sw ? `<button type="button" class="pkm-btn2" data-swarm="${sw.zone.id}">🐝 Swarm: lots of ${pkmEsc(pkmCap(sw.species))} at ${pkmEsc(sw.zone.name)} (${left(sw.ends)})</button>` : ""}
        <button type="button" class="pkm-btn2 ${pkmDungeonOpen() ? "primary" : ""}" data-dungeon="1">🌀 Mystery Dungeon: ${pkmDungeonOpen() ? "open now!" : "closed (opens every 2 hours)"}</button></div>`);
      if (!P._baseClick) P._baseClick = P.onclick;
      const oc = P._baseClick;
      P.onclick = (e) => {
        const s = e.target.closest("[data-swarm]");
        if (s) { pkmCloseMap(); return pkmOpenExplore(s.dataset.swarm); }
        if (e.target.closest("[data-dungeon]")) { pkmCloseMap(); return pkmOpenDungeon(); }
        return oc.call(P, e);
      };
      return r;
    };
  }

  // ---------- Trainer rank on the trainer card ----------
  const PKM_RANKS = [[0, "Rookie", "🌱"], [60, "Trainer", "🎒"], [160, "Ace Trainer", "⭐"], [320, "Veteran", "🌟"], [550, "Expert", "💫"], [850, "Elite", "🏅"], [1250, "Champion", "🏆"], [1800, "Master", "👑"], [2600, "Legend", "🐉"]];
  function pkmRankPoints() {
    const p = pkmProgressView();
    const ach = Object.keys(pkmJSON("pkm_ach", {})).length;
    return p._badges * 10 + p._champs * 60 + Math.floor(p._dex / 4) + (p._towerBest || 0) * 2 + ach * 5 + (p.legends || 0) * 15 + (p.raids || 0) * 4 + (p.contestWins || 0) * 3 + (p.frontierWins || 0) * 10 + (p.dungeons || 0) * 12;
  }
  function pkmRank() {
    const pts = pkmRankPoints();
    let i = 0;
    while (i + 1 < PKM_RANKS.length && pts >= PKM_RANKS[i + 1][0]) i++;
    const next = PKM_RANKS[i + 1];
    return { pts, name: PKM_RANKS[i][1], icon: PKM_RANKS[i][2], next: next ? next[0] : null, nextName: next ? next[1] : null, from: PKM_RANKS[i][0] };
  }
  {
    const ob = pkmOpenBadges;
    pkmOpenBadges = function () {
      const r = ob.apply(this, arguments);
      const P = pkmBadgesPanel;
      if (P && P.querySelector(".bag-tabs") && !P.querySelector(".rk-banner")) {
        const k = pkmRank();
        const pct = k.next ? Math.round(((k.pts - k.from) / (k.next - k.from)) * 100) : 100;
        P.querySelector(".bag-tabs").insertAdjacentHTML("beforebegin", `<div class="rk-banner"><b>${k.icon} ${pkmEsc(k.name)}</b> <span class="pkm-dim">${k.pts} rank points${k.next ? ` · ${k.next - k.pts} to ${pkmEsc(k.nextName)}` : " · top rank!"}</span><div class="bc-bar"><span style="width:${pct}%"></span></div></div>`);
      }
      return r;
    };
  }

  // ---------- Seasonal Tower: a different rule every week ----------
  const PKM_TOWER_MODES = [
    { id: "standard", name: "Standard week", desc: "Normal Tower rules." },
    { id: "rain", name: "Rainy week", desc: "Every Tower battle takes place in the rain. +20% coins." },
    { id: "sun", name: "Sunny week", desc: "Every Tower battle takes place in harsh sunlight. +20% coins." },
    { id: "sand", name: "Sandstorm week", desc: "Every Tower battle takes place in a sandstorm. +20% coins." },
    { id: "doubles", name: "Doubles week", desc: "Tower battles are 2 vs 2. +30% coins." },
    { id: "bosses", name: "Brain week", desc: "Every 3rd battle is a Frontier Brain. +30% coins." },
    { id: "noitems", name: "Bare-handed week", desc: "Tower trainers hold no items. +10% coins." },
  ];
  function pkmTowerMode() {
    const f = GM_getValue("pkm_tower_mode_force", "");
    if (f) return PKM_TOWER_MODES.find((m) => m.id === f) || PKM_TOWER_MODES[0];
    const w = pkmWeekId();
    return PKM_TOWER_MODES[pkmHash(w, 3) % PKM_TOWER_MODES.length];
  }
  {
    const tt = pkmTowerTrainer;
    pkmTowerTrainer = function (streak) {
      const t = tt.apply(this, arguments);
      const mode = pkmTowerMode().id;
      if (["rain", "sun", "sand"].includes(mode)) t.weather = mode;
      if (mode === "doubles") { t.double = true; while (t.team.length < 4) t.team.push([pkmRandNonLegend(), t.team[t.team.length - 1][1], null]); }
      if (mode === "bosses" && streak % 3 === 0 && !t.boss) { t.boss = true; t.title = "Frontier Brain"; }
      if (mode === "noitems") t.team = t.team.map(([s, l]) => [s, l, null]);
      t.towerMode = mode;
      return t;
    };
    const tc = pkmTowerCoins;
    pkmTowerCoins = function (tr) {
      const bonus = { rain: 1.2, sun: 1.2, sand: 1.2, doubles: 1.3, bosses: 1.3, noitems: 1.1 }[tr.towerMode] || 1;
      return Math.floor(tc(tr) * bonus);
    };
    const ot = pkmOpenTower;
    pkmOpenTower = function () {
      const r = ot.apply(this, arguments);
      const P = pkmTowerPanel;
      const m = pkmTowerMode();
      if (P && P.querySelector(".tw-body")) P.querySelector(".tw-body").insertAdjacentHTML("afterbegin", `<div class="rk-banner"><b>📅 This week: ${pkmEsc(m.name)}</b> <span class="pkm-dim">${pkmEsc(m.desc)}</span></div>`);
      return r;
    };
  }

  // ---------- Auto battle (wild battles) and move tooltips ----------
  function pkmMoveInfo(m) {
    const bits = [`${pkmCap(m.type)} · ${m.cls === "status" ? "Status" : m.cls === "special" ? "Special" : "Physical"}`];
    if (m.cls !== "status") bits.push(m.fixed ? (m.fixed.kind === "level" ? "Damage = your level" : m.fixed.kind === "half" ? "Halves the target's HP" : `Always ${m.fixed.n} damage`) : `Power ${m.power}`);
    bits.push(m.acc ? `Accuracy ${m.acc}%` : "Never misses");
    if (m.prio) bits.push(`Priority ${m.prio > 0 ? "+" : ""}${m.prio}`);
    if (m.maxHits > 1) bits.push(m.minHits === m.maxHits ? `Hits ${m.maxHits} times` : `Hits ${m.minHits}–${m.maxHits} times`);
    if (m.twoTurn) bits.push("Takes two turns");
    if (m.recharge) bits.push("You must rest the next turn");
    if (m.selfKO) bits.push("The user faints");
    if (m.drain > 0) bits.push(`Heals ${m.drain}% of the damage`);
    if (m.drain < 0) bits.push(`${-m.drain}% recoil`);
    if (m.healing > 0) bits.push(`Heals ${m.healing}% HP`);
    if (m.ailment && m.ailment !== "none") bits.push(`${m.cls === "status" ? "" : `${m.ailmentChance}% `}${pkmCap(m.ailment)}`.trim());
    if (m.flinch) bits.push(`${m.flinch}% flinch`);
    if (m.crit) bits.push("High critical-hit ratio");
    for (const [k, n] of m.stats || []) bits.push(`${PKM_STAT_LABEL[k]} ${n > 0 ? "+" : ""}${n}${m.statChance && m.statChance < 100 ? ` (${m.statChance}%)` : ""}`);
    if (PKM_WEATHER_MV[m.name]) bits.push(`Sets ${PKM_WEATHER[PKM_WEATHER_MV[m.name]].name}`);
    if (PKM_TERRAIN_MV[m.name]) bits.push(`Sets ${PKM_TERRAIN[PKM_TERRAIN_MV[m.name]].name}`);
    if (PKM_PROTECT.has(m.name)) bits.push("Blocks attacks this turn");
    if (PKM_HAZARD[m.name]) bits.push("Lays a trap on the foe's side");
    if (/^all-(opponents|other-pokemon)/.test(m.target || "")) bits.push("Hits both foes in doubles");
    return bits.join(" · ");
  }
  function pkmAutoPick(b) {
    const me = b.me, foe = b.foe;
    let best = -1, bv = -1;
    me.moves.forEach((m, i) => {
      if (m.pp <= 0 || m.cls === "status") return;
      const v = (m.fixed ? 60 : m.power) * pkmMoveEff(me, foe, m) * (me.types.includes(m.type) ? 1.5 : 1) * ((m.acc || 100) / 100);
      if (v > bv) { bv = v; best = i; }
    });
    if (best < 0) best = me.moves.findIndex((m) => m.pp > 0);
    return best;
  }
  {
    const db = drawBattle;
    drawBattle = function () {
      const r = db.apply(this, arguments);
      const b = pkb;
      if (!b || !battlePanel || b.double) return r;
      battlePanel.querySelectorAll("[data-mv]").forEach((el, i) => { const m = b.me.moves[+el.dataset.mv]; if (m) el.title = `${pkmMoveInfo(m)} (key ${i + 1})`; });
      if (b.kind === "wild" && !b.over && battlePanel.querySelector(".pkb-msg") && !battlePanel.querySelector("[data-auto]")) {
        battlePanel.querySelector(".pkb-msg").insertAdjacentHTML("afterend", `<div class="pkb-special"><button type="button" class="pkm-btn2${b.auto ? " primary" : ""}" data-auto="1" aria-pressed="${!!b.auto}" title="Let your Pokémon pick its strongest attack every turn (wild battles only)">⚡ Auto ${b.auto ? "on" : "off"}</button></div>`);
        battlePanel.querySelector("[data-auto]").onclick = (e) => { e.stopPropagation(); b.auto = !b.auto; drawBattle(); };
      }
      if (b.auto && !b.busy && !b.over && !b.awaitSwitch && !b.awaitRevive && pkmAlive(b)) {
        setTimeout(() => { if (pkb === b && b.auto && !b.busy && !b.over && !b.awaitSwitch) { const i = pkmAutoPick(b); if (i >= 0) pkmTurn({ type: "move", idx: i }); } }, 250);
      }
      if (b.auto && b.awaitSwitch) setTimeout(() => { const btn = battlePanel && battlePanel.querySelector(".pkb-sw:not([disabled])"); if (pkb === b && b.awaitSwitch && btn) btn.click(); }, 250);
      return r;
    };
  }

  // ---------- Accessibility: colorblind-friendly type labels and bigger text ----------
  function pkmApplyA11y() {
    PKM.classList.toggle("pkm-cb", GM_getValue("pkm_cb_types", "false") === "true");
    PKM.classList.toggle("pkm-big", GM_getValue("pkm_big_text", "false") === "true");
  }
  pkmApplyA11y();
  {
    const dro = pkmDrawOptions;
    pkmDrawOptions = function () {
      const r = dro.apply(this, arguments);
      const P = pkmOptionsPanel;
      if (P && pkmOptionsTab === "game" && P.querySelector(".lk-body")) {
        const cb = GM_getValue("pkm_cb_types", "false") === "true", big = GM_getValue("pkm_big_text", "false") === "true";
        P.querySelector(".lk-body").insertAdjacentHTML("beforeend", `<div class="bag-sec"><span>Accessibility</span></div><div class="pkm-btns">
          <button type="button" class="pkm-btn2 ${cb ? "primary" : ""}" data-a11y="pkm_cb_types">${cb ? "✓ " : ""}Colorblind-friendly types</button>
          <button type="button" class="pkm-btn2 ${big ? "primary" : ""}" data-a11y="pkm_big_text">${big ? "✓ " : ""}Bigger text</button></div>
          <div class="pkm-dim">Colorblind mode adds a symbol to every type label and uses high-contrast colors.</div>`);
        P.querySelectorAll("[data-a11y]").forEach((el) => (el.onclick = (e) => { e.stopPropagation(); const k = el.dataset.a11y; GM_setValue(k, GM_getValue(k, "false") === "true" ? "false" : "true"); pkmApplyA11y(); pkmDrawOptions(); }));
      }
      return r;
    };
  }

  // ---------- Specials (Mega, Z, Tera, Dynamax) in double battles ----------
  {
    const dd = pkmDrawDouble;
    pkmDrawDouble = function (msg) {
      const r = dd.apply(this, arguments);
      const b = pkb;
      const d = b && b.dbl;
      if (!b || !d || b.busy || b.over || b.specialUsed || d.stage !== "move" || d.refill.length || d.slot < 0) return r;
      const me = b.mine[d.slot];
      const opts = [];
      if (getInt("pkm_item_mega-bracelet") > 0 && me.megaForms && me.megaForms.length && !me.mega) opts.push(["mega", "💠 Mega"]);
      if (getInt("pkm_item_z-power-ring") > 0) opts.push(["z", "Ⓩ Z-Move"]);
      if (getInt("pkm_item_tera-orb") > 0) opts.push(["tera", "💎 Tera"]);
      if (getInt("pkm_item_dynamax-band") > 0) opts.push(["dyna", "🔴 Dynamax"]);
      if (!opts.length) return r;
      battlePanel.querySelector(".pkb-msg").insertAdjacentHTML("afterend", `<div class="pkb-special">${opts.map(([k, l]) => `<button type="button" class="pkm-btn2${d.arm === k ? " primary" : ""}" data-dsp="${k}">${l}</button>`).join("")}<span class="pkm-dim">${d.arm ? `For ${pkmEsc(me.display)}: now pick a move` : "One use per battle"}</span></div>`);
      battlePanel.querySelectorAll("[data-dsp]").forEach((el) => (el.onclick = (e) => { e.stopPropagation(); d.arm = d.arm === el.dataset.dsp ? null : el.dataset.dsp; d.armSlot = d.slot; drawBattle(); }));
      return r;
    };
    const dp = pkmDblPick;
    pkmDblPick = function (b, action) {
      if (b.dbl.arm && b.dbl.armSlot === b.dbl.slot && action.mv) { action.arm = b.dbl.arm; b.dbl.arm = null; }
      return dp.apply(this, arguments);
    };
    const dt = pkmDblTurn;
    pkmDblTurn = async function (b) {
      if (!pkmAlive(b) || b.busy) return;
      for (let i = 0; i < 2; i++) {
        const a = b.dbl.picks[i];
        const m = b.mine[i];
        if (!a || !a.arm || !m || m.hp <= 0 || b.specialUsed) continue;
        const saveMe = b.me;
        b.me = m;
        b.busy = true;
        if (a.arm === "mega") await pkmMegaEvolve(b);
        else if (a.arm === "tera") await pkmTerastallize(b);
        else if (a.arm === "dyna") await pkmDynamax(b);
        else if (a.arm === "z" && a.mv.cls !== "status") { b.specialUsed = true; a.mv = pkmZMove(a.mv); pkmTrack("zmoves"); }
        b.me = saveMe;
        b.busy = false;
        pkmDblPrimary(b);
        if (!pkmAlive(b)) return;
      }
      return dt.apply(this, arguments);
    };
    const dm = pkmDblMove;
    pkmDblMove = function (b, att, mv, target) {
      if (att.dynamax > 0 && !mv.max && pkmMine(b, att)) mv = pkmMaxMove(mv, att);
      return dm.call(this, b, att, mv, target);
    };
  }

  pkmStyle(`
    .mt-head{background:linear-gradient(90deg,#3c8d93,#1f5a5f)!important}.dx-head{background:linear-gradient(90deg,#d6403a,#8a1f1a)!important}.dg-head{background:linear-gradient(90deg,#6a4ad6,#2f1f6a)!important}
    .pkm-set.pkm-tutor,.pkm-set.pkm-dexentry,.pkm-set.pkm-dungeon{width:min(640px,96vw);max-height:92vh;overflow:auto}
    .dx-sil{filter:brightness(0) opacity(.7)}
    .mp-events{display:flex;flex-wrap:wrap;gap:6px;margin:6px 16px}
    .rk-banner{margin:8px 16px;padding:8px 10px;border-radius:12px;background:rgba(255,203,5,.12);display:grid;gap:4px}
    .mv-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:5px 0}
    .pkm-big{font-size:115%}
    .pkm-big .pkm-panel,.pkm-big .pkb-card{zoom:1.12}
    .pkm-cb .pk-type{color:#000!important;text-shadow:none!important;border:2px solid #000;font-weight:800}
    .pkm-cb .pk-type.fire{background:#ff9f3f!important}.pkm-cb .pk-type.water{background:#5aa9ff!important}.pkm-cb .pk-type.grass{background:#9be36b!important}
    .pkm-cb .pk-type.electric{background:#ffe14a!important}.pkm-cb .pk-type.ice{background:#bff3ff!important}.pkm-cb .pk-type.fighting{background:#e0a080!important}
    .pkm-cb .pk-type.poison{background:#d6a8ff!important}.pkm-cb .pk-type.ground{background:#e8cf8a!important}.pkm-cb .pk-type.flying{background:#cfe0ff!important}
    .pkm-cb .pk-type.psychic{background:#ffb3d1!important}.pkm-cb .pk-type.bug{background:#d8e88a!important}.pkm-cb .pk-type.rock{background:#d8c8a0!important}
    .pkm-cb .pk-type.ghost{background:#b8a8d8!important}.pkm-cb .pk-type.dragon{background:#a8b8ff!important}.pkm-cb .pk-type.dark{background:#b8a898!important}
    .pkm-cb .pk-type.steel{background:#d8dde8!important}.pkm-cb .pk-type.fairy{background:#ffd0ee!important}.pkm-cb .pk-type.normal{background:#e8e8d8!important}
    .pkm-cb .pk-type::before{margin-right:3px}
    .pkm-cb .pk-type.fire::before{content:"▲"}.pkm-cb .pk-type.water::before{content:"≈"}.pkm-cb .pk-type.grass::before{content:"♣"}.pkm-cb .pk-type.electric::before{content:"ϟ"}
    .pkm-cb .pk-type.ice::before{content:"❄"}.pkm-cb .pk-type.fighting::before{content:"✊"}.pkm-cb .pk-type.poison::before{content:"☠"}.pkm-cb .pk-type.ground::before{content:"▬"}
    .pkm-cb .pk-type.flying::before{content:"➶"}.pkm-cb .pk-type.psychic::before{content:"◉"}.pkm-cb .pk-type.bug::before{content:"✳"}.pkm-cb .pk-type.rock::before{content:"◆"}
    .pkm-cb .pk-type.ghost::before{content:"☾"}.pkm-cb .pk-type.dragon::before{content:"♆"}.pkm-cb .pk-type.dark::before{content:"●"}.pkm-cb .pk-type.steel::before{content:"⬢"}
    .pkm-cb .pk-type.fairy::before{content:"✿"}.pkm-cb .pk-type.normal::before{content:"○"}
  `, "pkm-v39b");

  // =====================================================================
  //  4.0 (part 1): partner moves and abilities for doubles, Trick Room,
  //  Tailwind, Leech Seed, Taunt, Encore, form-change abilities, wild and
  //  Gym doubles, regional forms, fishing and surfing, hourly weather,
  //  roaming legendaries, event places, Alola/Galar post-game
  // =====================================================================
  let pkmWildDoubleNext = false; // the next wild battle has two Pokémon

  // ---------- New status moves ----------
  for (const n of ["trick-room", "tailwind", "leech-seed", "taunt", "encore", "helping-hand", "follow-me", "rage-powder"]) { PKM_NO_STATUS.delete(n); PKM_SPECIAL_STATUS.add(n); }
  Object.assign(PKM_ABILITY_INFO, {
    "friend-guard": "Its partner takes 25% less damage in double battles", telepathy: "Never hit by its partner's attacks",
    "stance-change": "Blade Forme when it attacks, Shield Forme when it uses King's Shield", disguise: "The first hit only breaks its disguise",
    schooling: "Forms a big school above 25% HP (from Lv 20)", "zen-mode": "Changes to Zen Mode below half HP",
  });
  {
    const us = pkmUseStatus;
    pkmUseStatus = async function (b, att, def, mv) {
      const who = pkmWho(b, att);
      const side = pkmSide(b, att);
      const fail = () => pkmSay(b, "But it failed!", 800);
      const ally = b.double ? pkmDblAllyOf(b, att) : null;
      switch (mv.name) {
        case "trick-room":
          if (b.trickRoom > 0) { b.trickRoom = 0; return pkmSay(b, "The twisted dimensions returned to normal!", 800); }
          b.trickRoom = 5;
          return pkmSay(b, `${who} twisted the dimensions! Slower Pokémon move first.`, 900);
        case "tailwind":
          b.tailwind = b.tailwind || {};
          if (b.tailwind[side] > 0) return fail();
          b.tailwind[side] = 4;
          return pkmSay(b, `A tailwind blew from behind ${side === "me" ? "your" : "the foe's"} team!`, 900);
        case "leech-seed":
          if (def.seeded || def.types.includes("grass") || def.sub > 0) return fail();
          def.seeded = true;
          return pkmSay(b, `${pkmWho(b, def)} was seeded!`, 800);
        case "taunt":
          if (def.taunt > 0) return fail();
          def.taunt = 3;
          return pkmSay(b, `${pkmWho(b, def)} fell for the taunt!`, 800);
        case "encore":
          if (!def.lastMove || def.encore || def.lastMove === "encore") return fail();
          def.encore = { name: def.lastMove, turns: 3 };
          return pkmSay(b, `${pkmWho(b, def)} received an encore!`, 800);
        case "helping-hand":
          if (!ally) return fail();
          ally.helped = true;
          return pkmSay(b, `${who} is ready to help ${pkmWho(b, ally)}!`, 800);
        case "follow-me":
        case "rage-powder":
          if (!b.double) return fail();
          att.followMe = true;
          return pkmSay(b, `${who} became the center of attention!`, 800);
      }
      return us.apply(this, arguments);
    };
    // Taunted Pokémon can't use status moves; encored ones count down
    const um = pkmUseMove;
    pkmUseMove = async function (b, att, def, mv) {
      if (att.hp > 0 && att.taunt > 0 && mv.cls === "status") { att.moved = true; return pkmSay(b, `${pkmWho(b, att)} can't use ${mv.display} after the taunt!`, 800); }
      if (att.hp > 0 && att.ability === "stance-change") await pkmStanceChange(b, att, mv);
      const dis = def && def.ability === "disguise" && !def.disguiseBroken;
      const r = await um.apply(this, arguments);
      if (!mv.quiet) att.lastMove = (mv.srcMove || mv).name;
      if (att.encore && att.encore.turns > 0 && --att.encore.turns <= 0) { att.encore = null; await pkmSay(b, `${pkmWho(b, att)}'s encore ended.`, 600); }
      if (dis && def.disguiseBroken) await pkmSay(b, `${pkmWho(b, def)}'s disguise was busted!`, 800);
      return r;
    };
    const ai = pkmAiMove;
    pkmAiMove = function (foe, me, b) {
      if (foe.taunt > 0) {
        const keep = foe.moves;
        const att = keep.filter((m) => m.cls !== "status");
        if (att.length) { foe.moves = att; try { return ai.call(this, foe, me, b); } finally { foe.moves = keep; } }
      }
      return ai.apply(this, arguments);
    };
    // Trick Room reverses the order (by making speeds negative), Tailwind doubles a side's speed
    const sp = pkmSpeed;
    pkmSpeed = function (m, b) {
      let s = sp.apply(this, arguments);
      if (b && b.tailwind && b.tailwind[pkmSide(b, m)] > 0) s *= 2;
      return b && b.trickRoom > 0 ? -s : s;
    };
    // Helping Hand, Friend Guard, Disguise
    const dmg = pkmDamage;
    pkmDamage = function (att, def, mv, b) {
      const r = dmg.apply(this, arguments);
      if (r.dmg > 0) {
        if (att.helped) r.dmg = Math.floor(r.dmg * 1.5);
        const ally = b && b.double ? pkmDblAllyOf(b, def) : null;
        if (ally && ally.ability === "friend-guard") r.dmg = Math.max(1, Math.floor(r.dmg * 0.75));
        if (def.ability === "disguise" && !def.disguiseBroken && !PKM_MOLD.includes(att.ability)) { def.disguiseBroken = true; r.dmg = Math.max(1, Math.floor(def.maxHP / 8)); }
      }
      return r;
    };
    const eot = pkmEndOfTurn;
    pkmEndOfTurn = async function (b) {
      for (const m of pkmActive(b)) {
        if (!pkmAlive(b) || m.hp <= 0) continue;
        if (m.seeded) {
          const take = Math.min(m.hp, Math.max(1, Math.floor(m.maxHP / 8)));
          await pkmHurt(b, m, take, `${pkmWho(b, m)}'s health is sapped by Leech Seed!`);
          const sap = b.double ? pkmDblFoesOf(b, m)[0] : pkmMine(b, m) ? b.foe : b.me;
          if (sap && sap.hp > 0) await pkmHeal(b, sap, take, `${pkmWho(b, sap)} drank the sapped health.`);
        }
        if (m.taunt > 0 && --m.taunt === 0) await pkmSay(b, `${pkmWho(b, m)} shook off the taunt.`, 600);
      }
      if (!pkmAlive(b)) return;
      await eot.apply(this, arguments);
      if (!pkmAlive(b)) return;
      if (b.trickRoom > 0 && --b.trickRoom === 0) await pkmSay(b, "The twisted dimensions returned to normal!", 700);
      for (const side of ["me", "foe"]) if (b.tailwind && b.tailwind[side] > 0 && --b.tailwind[side] === 0) await pkmSay(b, `${side === "me" ? "Your" : "The foe's"} tailwind petered out.`, 700);
      for (const m of pkmActive(b)) if (m.hp > 0 && (m.ability === "schooling" || m.ability === "zen-mode")) await pkmFormCheck(b, m);
    };
  }

  // ---------- Form-change abilities ----------
  /** Switch a battle Pokémon to another form's base stats and sprites, keeping HP and level. */
  async function pkmFormSwap(b, m, form, label) {
    if (m.form === form) return;
    const d = await pkmPokemonData(form).catch(() => null);
    if (!d) return;
    const hpShare = m.hp / m.maxHP;
    m.base = pkmBase(d);
    const stats = pkmCalcStats(m.base, m.level, m.iv, m.nature, m.ev);
    m.stats = { ...stats, hp: m.maxHP };
    if (m.form === undefined) m.formBase = { front: m.front, back: m.back };
    const sp = d.sprites || {};
    m.front = (m.shiny ? sp.front_shiny : sp.front_default) || m.front;
    m.back = (m.shiny ? sp.back_shiny : sp.back_default) || m.back;
    m.form = form;
    m.hp = Math.max(m.hp > 0 ? 1 : 0, Math.round(m.maxHP * hpShare));
    pkmSyncGlobals(b);
    if (label) await pkmSay(b, label, 800);
  }
  async function pkmStanceChange(b, m, mv) {
    if (!/^aegislash/.test(m.name)) return;
    if (mv.cls !== "status" && m.form !== "aegislash-blade") await pkmFormSwap(b, m, "aegislash-blade", `${pkmWho(b, m)} changed to Blade Forme!`);
    else if (mv.name === "king-s-shield" && m.form !== "aegislash-shield") await pkmFormSwap(b, m, "aegislash-shield", `${pkmWho(b, m)} changed to Shield Forme!`);
  }
  async function pkmFormCheck(b, m) {
    if (m.ability === "schooling" && /^wishiwashi/.test(m.name) && m.level >= 20) {
      const school = m.hp > m.maxHP / 4;
      if (school && m.form !== "wishiwashi-school") await pkmFormSwap(b, m, "wishiwashi-school", `${pkmWho(b, m)} formed a school!`);
      else if (!school && m.form === "wishiwashi-school") await pkmFormSwap(b, m, "wishiwashi-solo", `${pkmWho(b, m)} stopped schooling!`);
    }
    if (m.ability === "zen-mode" && /^darmanitan/.test(m.name) && m.hp <= m.maxHP / 2 && m.form !== "darmanitan-zen") await pkmFormSwap(b, m, "darmanitan-zen", `${pkmWho(b, m)} entered Zen Mode!`);
  }
  {
    const oe = pkmOnEntry;
    pkmOnEntry = async function (b, m, other) {
      await oe.apply(this, arguments);
      if (m.hp > 0 && m.ability === "schooling") await pkmFormCheck(b, m);
    };
  }

  // ---------- Partner targeting in doubles: Follow Me, and per-turn resets ----------
  {
    const dm = pkmDblMove;
    pkmDblMove = function (b, att, mv, target) {
      const opp = pkmDblFoesOf(b, att);
      const lure = opp.find((x) => x.followMe);
      if (lure && pkmDblNeedsTarget(mv)) target = lure;
      return dm.call(this, b, att, mv, target);
    };
    const dt = pkmDblTurn;
    pkmDblTurn = function (b) {
      if (!b.busy) for (const m of pkmActive(b)) { m.helped = false; m.followMe = false; }
      return dt.apply(this, arguments);
    };
    const tn = pkmTurn;
    pkmTurn = function (a) { const b = pkb; if (b && !b.busy) for (const m of [b.me, b.foe]) if (m) m.helped = false; return tn.apply(this, arguments); };
  }

  // ---------- Regional forms in the wild ----------
  PKM_ZONES.alola.forEach((z, i) => z.pool.push(...[["rattata-alola", "raticate-alola"], ["exeggutor-alola", "raichu-alola"], ["diglett-alola", "geodude-alola"], ["grimer-alola", "meowth-alola"], ["marowak-alola"], ["vulpix-alola", "ninetales-alola", "sandshrew-alola"]][i]));
  PKM_ZONES.galar.forEach((z, i) => z.pool.push(...[["zigzagoon-galar", "linoone-galar"], ["ponyta-galar", "farfetchd-galar"], ["yamask-galar", "stunfisk-galar"], ["corsola-galar", "slowpoke-galar"], ["weezing-galar"], ["mr-mime-galar", "darumaka-galar"]][i]));
  PKM_ZONES.sinnoh.forEach((z, i) => z.pool.push(...[["growlithe-hisui"], ["zorua-hisui"], ["voltorb-hisui"], ["qwilfish-hisui"], ["braviary-hisui"], ["sneasel-hisui"]][i]));

  // ---------- Post-game: Ultra Space (after Alola) and Max Raids (after Galar) ----------
  PKM_ZONES.alola.push({ ...pkmZ("ultra-space", "Ultra Space", "🌌", [100, 100], 8, "cave", ["nihilego", "buzzwole", "pheromosa", "xurkitree", "celesteela", "kartana", "guzzlord", "poipole", "stakataka", "blacephalon"]), post: "alola" });
  PKM_ZONES.galar.push({ ...pkmZ("crown-tundra", "Crown Tundra", "👑", [100, 100], 8, "snow", ["glastrier", "spectrier", "regieleki", "regidrago", "duraludon", "frosmoth", "eiscue"]), post: "galar" });
  const PKM_GMAX_RAID = ["charizard", "venusaur", "blastoise", "pikachu", "gengar", "lapras", "snorlax", "machamp", "corviknight", "drednaw", "coalossal", "centiskorch", "grimmsnarl", "hatterene", "copperajah", "toxtricity", "alcremie", "duraludon"];
  {
    const or = pkmOpenRaids;
    pkmOpenRaids = async function () {
      await or.apply(this, arguments);
      const P = pkmRaidPanel;
      if (!P || P.querySelector("[data-maxraid]")) return;
      const open = pkmRegionDone("galar");
      const s = pkmJSON("pkm_maxraid", { slot: -1, done: false });
      const done = s.slot === pkmRaidSlot() && s.done;
      P.querySelector(".lk-body").insertAdjacentHTML("beforeend", `<div class="bag-sec"><span>🔴 Max Raid den (Galar post-game)</span></div>
        <div class="pkm-dim">${open ? "A Gigantamax boss with even more HP. One clear per raid window." : "Beat the Galar Champion to open Max Raids."}</div>
        <div class="pkm-btns"><button type="button" class="pkm-btn2 primary" data-maxraid="1" ${open && !done ? "" : "disabled"}>${done ? "Cleared ✅" : "Join the Max Raid"}</button></div>`);
      P.querySelector("[data-maxraid]").onclick = (e) => {
        e.stopPropagation();
        const slot = pkmRaidSlot();
        const name = PKM_GMAX_RAID[Math.floor(pkmRng(slot * 31 + 5)() * PKM_GMAX_RAID.length)];
        pkmSave("pkm_maxraid", { slot, done: false });
        pkmForcedWild = { name, level: MAX_LEVEL, raid: 5, gmax: true };
        pkmPostBattle = () => pkmOpenRaids();
        pkmCloseRaids();
        openBattle();
        if (!battlePanel) { pkmForcedWild = null; pkmPostBattle = null; }
      };
    };
    // Gigantamax raid bosses look the part, and a win counts as the Max Raid clear
    const pw = pkmPickWild;
    pkmPickWild = async function () {
      const f = pkmForcedWild;
      const m = await pw.apply(this, arguments);
      if (m && f && f.gmax) {
        m.maxHP = Math.floor(m.maxHP * 1.5); m.hp = m.maxHP; m.gmaxBoss = true;
        const d = await pkmPokemonData(`${m.name}-gmax`).catch(() => null);
        if (d && d.sprites && d.sprites.front_default) m.front = d.sprites.front_default;
        m.display = `G-Max ${m.display}`;
      }
      return m;
    };
    const rw = pkmRaidWin;
    pkmRaidWin = async function (b) {
      if (b.foe.gmaxBoss) { pkmSave("pkm_maxraid", { slot: pkmRaidSlot(), done: true }); pkmGive([["pkm_item_ability-patch", 1, "Ability Patch"]]); }
      return rw.apply(this, arguments);
    };
  }

  // ---------- Hourly weather per region (used in map battles) ----------
  const PKM_ZONE_SKY = { grass: ["rain", "sun", null, null, null], forest: ["rain", null, null, null], cave: [null], water: ["rain", "rain", null, null], mountain: ["sand", "sun", null, null], snow: ["hail", "hail", null] };
  function pkmRegionWeather(regionId, slot = pkmHourSlot()) {
    const r = pkmRng(slot * 977 + regionId.length * 131 + regionId.charCodeAt(0));
    return ["rain", "sun", "sand", "hail", null, null, null][Math.floor(r() * 7)];
  }
  /** The weather in a place this hour: its region's weather if the place can have it, else the place's usual sky. */
  function pkmZoneWeather(zoneId) {
    const z = pkmZoneById(zoneId);
    if (!z) return null;
    if (z.theme === "cave") return null;
    const w = pkmRegionWeather(z.region);
    if (w === "hail" && z.theme !== "snow" && z.theme !== "mountain") return null;
    if (w && (PKM_ZONE_SKY[z.theme] || []).includes(w)) return w;
    if (z.theme === "snow") return "hail";
    return w === "rain" || w === "sun" ? w : null;
  }

  // ---------- Roaming legendaries ----------
  const PKM_ROAMERS = [["raikou", "johto"], ["entei", "johto"], ["suicune", "johto"], ["latias", "hoenn"], ["latios", "hoenn"], ["mesprit", "sinnoh"], ["cresselia", "sinnoh"], ["tornadus", "unova"], ["thundurus", "unova"], ["zygarde", "kalos"]];
  /** Where each unlocked roamer is this hour (the same for everyone). */
  function pkmRoamers(slot = pkmHourSlot()) {
    const st = pkmLegendsState();
    return PKM_ROAMERS.map(([name, region]) => {
      const l = PKM_LEGENDS.find((x) => x.name === name);
      const ri = PKM_REGIONS.findIndex((r) => r.id === region);
      if (!l || !pkmRegionOpen(ri) || (st[name] && st[name].caught)) return null;
      const zones = (PKM_ZONES[region] || []).filter((z) => !z.post);
      const r = pkmRng(slot * 613 + name.length * 37 + name.charCodeAt(1));
      return { name, region, zone: zones[Math.floor(r() * zones.length)], lv: l.lv };
    }).filter(Boolean);
  }
  {
    const zw = pkmZoneWild;
    pkmZoneWild = async function (z) {
      const roam = pkmRoamers().find((x) => x.zone && x.zone.id === z.id);
      if (roam && Math.random() < 0.15) {
        const d = await pkmPokemonData(roam.name);
        if (d) { const m = await pkmWildFrom(d, Math.max(roam.lv, pkmTopLevel())); m.legend = roam.name; m.zone = z.id; return m; }
      }
      return zw.apply(this, arguments);
    };
  }

  // ---------- Fishing and surfing ----------
  const PKM_RODS = [["old-rod", "Old Rod", 500], ["good-rod", "Good Rod", 3000], ["super-rod", "Super Rod", 10000]];
  for (const [img, name, price] of PKM_RODS) PKM_ITEMS.push({ img, name, key: `pkm_item_${img}`, price, cat: "key", max: 1, desc: "Fish at water places on the world map. Better rods hook rarer, stronger Pokémon." });
  const PKM_FISH = {
    "old-rod": ["magikarp", "goldeen", "poliwag", "tentacool", "horsea", "remoraid", "feebas", "wailmer", "finneon", "basculin"],
    "good-rod": ["seaking", "staryu", "krabby", "shellder", "chinchou", "qwilfish", "corphish", "barboach", "luvdisc", "tympole", "frillish", "skrelp", "clauncher", "wishiwashi", "arrokuda"],
    "super-rod": ["gyarados", "lapras", "dratini", "kingdra", "milotic", "lanturn", "sharpedo", "whiscash", "lumineon", "jellicent", "dragalge", "clawitzer", "bruxish", "barraskewda", "dhelmise"],
  };
  const PKM_SURF = ["tentacruel", "pelipper", "mantine", "wingull", "floatzel", "buizel", "golduck", "dewgong", "lapras", "wailord", "alomomola", "drednaw", "cramorant", "lanturn", "starmie", "seaking"];
  const pkmBestRod = () => [...PKM_RODS].reverse().find(([img]) => getInt(`pkm_item_${img}`) > 0);
  const pkmCanSurf = () => Object.keys(getObj(STORAGE.party) || {}).slice(0, PKM_PARTY_SIZE).some((id) => ((getObj(STORAGE.stats) || {})[id] || {}).types && getObj(STORAGE.stats)[id].types.includes("water"));
  {
    const ox = pkmOpenExplore;
    pkmOpenExplore = function (zoneId, msg) {
      const r = ox.apply(this, arguments);
      const z = pkmExploreZone;
      const P = pkmExplorePanel;
      if (!z || !P || P.querySelector("[data-water]")) return r;
      const water = z.theme === "water";
      const rod = pkmBestRod();
      const hint = [];
      if (water) {
        P.querySelector(".pk-controls").insertAdjacentHTML("beforeend", `<button type="button" class="pk-btn pkb-act" data-water="fish" ${rod ? "" : "disabled"} title="${rod ? `Fish with your ${rod[1]}` : "Buy a fishing rod in the PokéMart (Key items)"}"><div class="pk-ico">🎣</div><div class="pk-label">Fish</div></button>
          <button type="button" class="pk-btn pkb-act" data-water="surf" ${pkmCanSurf() ? "" : "disabled"} title="${pkmCanSurf() ? "Surf on the water" : "You need a Water-type Pokémon in your party"}"><div class="pk-ico">🏄</div><div class="pk-label">Surf</div></button>`);
        if (!rod) hint.push("Buy a rod to fish here.");
        if (!pkmCanSurf()) hint.push("A Water-type in your party lets you surf.");
      }
      const w = pkmZoneWeather(z.id);
      const roam = pkmRoamers().find((x) => x.zone && x.zone.id === z.id);
      const sw = pkmSwarm();
      const bar = P.querySelector(".sf-bar");
      if (bar) bar.insertAdjacentHTML("beforeend", `<span>${w ? `${PKM_WEATHER[w].icon} ${PKM_WEATHER[w].name}` : "☁️ Clear"}</span>`);
      const notes = [roam ? `📍 ${pkmCap(roam.name)} is roaming here this hour!` : "", sw && sw.zone.id === z.id ? `🐝 A swarm of ${pkmCap(sw.species)} is here!` : "", ...hint].filter(Boolean);
      if (notes.length) P.querySelector(".pkb-msg").insertAdjacentHTML("afterend", `<div class="pkm-dim" style="margin:4px 0">${notes.map(pkmEsc).join(" · ")}</div>`);
      P.querySelectorAll("[data-water]").forEach((el) => (el.onclick = (e) => { e.stopPropagation(); if (!el.disabled) pkmWaterEncounter(z, el.dataset.water); }));
      // A wild double battle now and then
      return r;
    };
  }
  function pkmWaterEncounter(z, how) {
    if (battlePanel) return;
    let pool, lv;
    if (how === "fish") {
      const rod = pkmBestRod();
      if (!rod) return;
      const tiers = PKM_RODS.findIndex((x) => x[0] === rod[0]);
      pool = PKM_FISH[pkmPick(PKM_RODS.slice(0, tiers + 1))[0]];
      lv = pkmClamp(pkmRand(z.lv[0], z.lv[1]) - 6 + tiers * 4, 2, MAX_LEVEL);
      if (Math.random() < 0.25) return pkmOpenExplore(z.id, "Not even a nibble…");
    } else { pool = PKM_SURF; lv = pkmRand(z.lv[0], z.lv[1]); }
    pkmTrack(how === "fish" ? "fished" : "surfed");
    pkmForcedWild = { name: pkmPick(pool), level: lv };
    pkmPostBattle = () => pkmOpenExplore(z.id);
    pkmCloseExplore();
    openBattle();
    if (!battlePanel) { pkmForcedWild = null; pkmPostBattle = null; pkmOpenExplore(z.id); }
  }
  // Forced fishing/surfing encounters aren't legends
  {
    const pw = pkmPickWild;
    pkmPickWild = async function () {
      const f = pkmForcedWild;
      const m = await pw.apply(this, arguments);
      if (m && f && !f.raid && !PKM_LEGENDS.some((l) => l.name === f.name)) delete m.legend;
      return m;
    };
  }
  // Wild doubles: 12% of map walks that meet a wild Pokémon meet two (with 2+ healthy Pokémon)
  {
    const ew = pkmExploreWalk;
    pkmExploreWalk = async function () {
      const healthy = Object.keys(getObj(STORAGE.party) || {}).slice(0, PKM_PARTY_SIZE).filter((id) => { const s = (getObj(STORAGE.stats) || {})[id] || {}; return (s.currentHP == null ? 1 : s.currentHP) > 0; }).length;
      pkmWildDoubleNext = healthy >= 2 && pkmExploreZone && Math.random() < (GM_getValue("pkm_wild_double_force", "") === "1" ? 1 : 0.12) ? pkmExploreZone.id : false;
      const r = await ew.apply(this, arguments);
      if (!pkmForcedZone && !battlePanel) pkmWildDoubleNext = false;
      return r;
    };
  }

  // ---------- Gym Leader doubles (rematches) ----------
  {
    const ot = pkmOpenTrainers;
    pkmOpenTrainers = function () {
      const r = ot.apply(this, arguments);
      const P = pkmTrainersPanel;
      if (!P) return r;
      const bs = pkmBadges();
      P.querySelectorAll(".tr-gym [data-gym]").forEach((btn) => {
        const n = +btn.dataset.gym;
        if (!bs.includes(n)) return;
        btn.insertAdjacentHTML("afterend", `<button type="button" class="pkm-btn2" data-gym2="${n}" title="A 2 vs 2 rematch">👥 Double</button>`);
      });
      P.querySelectorAll("[data-gym2]").forEach((el) => (el.onclick = (e) => {
        e.stopPropagation();
        const g = PKM_GYMS[+el.dataset.gym2 - 1];
        const t = pkmGymTrainer(g);
        while (t.team.length < 4) t.team.unshift([pkmPick(g.team), g.lvl - 1]);
        t.double = true;
        t.title = "Gym Leader (doubles)";
        pkmStartTrainer(t);
      }));
      return r;
    };
  }

  // ---------- Event places on the map (with costume legendaries) ----------
  const PKM_EVENT_PLACES = {
    valentine: ["Heartbeat Garden", "💘", ["latias", "diancie"]], spring: ["Blossom Meadow", "🌸", ["shaymin", "virizion"]],
    summer: ["Sunny Beach", "🏖️", ["kyogre", "manaphy"]], halloween: ["Spooky Manor", "🎃", ["giratina", "marshadow"]], holiday: ["Snowy Festival", "🎄", ["regice", "kyurem"]],
  };
  {
    const ev = pkmCurrentEvent();
    const ep = ev && PKM_EVENT_PLACES[ev.id];
    if (ep) PKM_ZONES.kanto.push({ ...pkmZ(`event-${ev.id}`, ep[0], ep[1], [5, 100], 0, ev.id === "holiday" ? "snow" : ev.id === "summer" ? "water" : "grass", ev.pool.slice()), event: ev.id, legends: ep[2] });
    const zw = pkmZoneWild;
    pkmZoneWild = async function (z) {
      if (z.event) {
        const e2 = PKM_EVENTS.find((x) => x.id === z.event);
        const lvl = pkmClamp(pkmTopLevel() + pkmRand(-4, 1), 3, MAX_LEVEL);
        const legend = Math.random() < 0.03;
        const d = await pkmPokemonData(legend ? pkmPick(z.legends) : pkmPick(z.pool));
        if (d) {
          const m = await pkmWildFrom(d, lvl, { costume: legend || Math.random() < 0.5 ? e2.costume : null });
          m.zone = z.id;
          if (legend) { m.legend = d.name; m.display = `${e2.costume} ${m.display}`; }
          return m;
        }
      }
      return zw.apply(this, arguments);
    };
  }

  // =====================================================================
  //  4.0 (part 2): gender + Masuda breeding, Pokérus, crafting bench,
  //  type challenge, habitat tracking, region quests with rivals, weekly
  //  ladder, trainer card image, Tower record codes, Box tools, Nuzlocke,
  //  Battle Hall and Battle Castle
  // =====================================================================
  // ---------- Gender ----------
  /** -1 = genderless, 0..8 = eighths female (from cached species data, 4 if unknown). */
  // Fallback for when species data isn't cached yet (gender is rolled at catch time).
  const PKM_GENDERLESS = new Set(("ditto magnemite magneton magnezone voltorb electrode staryu starmie porygon porygon2 porygon-z bronzor bronzong baltoy claydol beldum metang metagross " +
    "shedinja lunatone solrock rotom klink klang klinklang golett golurk cryogonal carbink minior dhelmise sinistea polteageist falinks " +
    "articuno zapdos moltres mewtwo mew unown raikou entei suicune lugia ho-oh celebi regirock regice registeel kyogre groudon rayquaza jirachi deoxys " +
    "uxie mesprit azelf dialga palkia giratina phione manaphy darkrai shaymin arceus victini cobalion terrakion virizion reshiram zekrom kyurem keldeo meloetta genesect " +
    "xerneas yveltal zygarde diancie hoopa volcanion type-null silvally tapu-koko tapu-lele tapu-bulu tapu-fini cosmog cosmoem solgaleo lunala nihilego buzzwole pheromosa " +
    "xurkitree celesteela kartana guzzlord necrozma magearna marshadow poipole naganadel stakataka blacephalon zeraora meltan melmetal dracozolt arctozolt dracovish arctovish " +
    "zacian zamazenta eternatus regieleki regidrago glastrier spectrier calyrex koraidon miraidon terapagos").split(" "));
  const PKM_MALE_ONLY = new Set("nidoran-m nidorino nidoking hitmonlee hitmonchan hitmontop tyrogue tauros volbeat latios gallade throh sawk rufflet braviary impidimp morgrem grimmsnarl tornadus thundurus landorus".split(" "));
  const PKM_FEMALE_ONLY = new Set("nidoran-f nidorina nidoqueen chansey blissey happiny kangaskhan jynx smoochum miltank illumise latias froslass vespiquen petilil lilligant vullaby mandibuzz flabebe floette florges bounsweet steenee tsareena hatenna hattrem hatterene milcery alcremie enamorus".split(" "));
  function pkmGenderRate(name) {
    const base = String(name).toLowerCase().replace(/-(mega.*|gmax|alola|galar|hisui|paldea)$/, "");
    if (PKM_GENDERLESS.has(base)) return -1;
    if (PKM_MALE_ONLY.has(base)) return 0;
    if (PKM_FEMALE_ONLY.has(base)) return 8;
    try { const raw = pkmCacheGet(`https://pokeapi.co/api/v2/pokemon-species/${String(name).toLowerCase().split("-mega")[0]}`); if (raw) { const s = JSON.parse(raw); if (s.gender_rate != null) return s.gender_rate; } } catch {}
    return 4;
  }
  function pkmRollGender(name, seed) {
    const rate = pkmGenderRate(name);
    if (rate < 0) return "none";
    return pkmHash(String(seed), 5) % 8 < rate ? "female" : "male";
  }
  /** A Pokémon's gender, worked out (and saved) the first time it's needed. */
  function pkmGenderOf(id) {
    const all = getObj(STORAGE.stats) || {};
    const s = all[id];
    const p = (getObj(STORAGE.party) || {})[id];
    if (!s || !p) return "none";
    if (!s.gender) { s.gender = pkmRollGender(p.name, id); all[id] = s; setObj(STORAGE.stats, all); }
    else { const r = pkmGenderRate(p.name); const fix = r < 0 ? "none" : r === 0 ? "male" : r === 8 ? "female" : (s.gender === "none" ? pkmRollGender(p.name, id) : null); if (fix && fix !== s.gender) { s.gender = fix; all[id] = s; setObj(STORAGE.stats, all); } }
    return s.gender;
  }
  const PKM_GENDER_ICON = { male: "♂", female: "♀", none: "" };
  {
    const sc = pkmStoreCaught;
    pkmStoreCaught = function (f, source) {
      const id = sc.apply(this, arguments);
      const all = getObj(STORAGE.stats) || {};
      if (all[id]) { all[id].gender = f.gender || pkmRollGender(f.name, id); setObj(STORAGE.stats, all); }
      if (source === "trade" || source === "raid" || source === "egg") { const party = getObj(STORAGE.party) || {}; if (party[id]) { party[id].origin = source; setObj(STORAGE.party, party); } }
      return id;
    };
    const bt = pkmBagTraits;
    pkmBagTraits = function (id, mon, st) {
      const g = PKM_GENDER_ICON[pkmGenderOf(id)];
      const pr = (st.pokerus && !st.pokerus.cured) ? `<span title="Pokérus: doubles the EVs it earns">🦠 Pokérus</span>` : st.pokerus ? `<span title="Cured of Pokérus">😊 Cured</span>` : "";
      return bt.apply(this, arguments).replace('<div class="bag-traits">', `<div class="bag-traits">${g ? `<span title="Gender">${g}</span>` : ""}${pr}`);
    };
    // Breeding needs a male and a female (or a Ditto); genderless Pokémon only breed with Ditto
    const dc = pkmDaycareCheck;
    pkmDaycareCheck = async function () {
      const res = await dc.apply(this, arguments);
      if (res.slots.length !== 2 || !res.compat) return res;
      const ditto = res.slots.some((s) => s.party.name === "ditto");
      if (ditto) return res;
      const g = res.slots.map((s) => s.stats.gender || pkmRollGender(s.party.name, s.id));
      if (g.includes("none") || g[0] === g[1]) { const fresh = pkmDaycare(); fresh.compat = false; fresh.reason = g.includes("none") ? "genderless" : "same"; pkmSave("pkm_daycare", fresh); return fresh; }
      return res;
    };
    // Masuda method: parents from different games (one came by trade) make shiny Eggs much more likely
    const me = pkmMakeEgg;
    pkmMakeEgg = async function () {
      const before = pkmEggs().length;
      await me.apply(this, arguments);
      const eggs = pkmEggs();
      if (eggs.length > before) {
        const dc2 = pkmDaycare();
        if (dc2.slots.some((s) => s.party.origin === "trade")) {
          const e = eggs[eggs.length - 1];
          if (!e.shiny && Math.random() < pkmShinyRate(6)) { e.shiny = true; pkmSave("pkm_eggs", eggs); }
          e.masuda = true;
          pkmSave("pkm_eggs", eggs);
        }
      }
    };
  }

  // ---------- Pokérus ----------
  const PKM_PKRS_DAYS = 4;
  function pkmPokerusTick() {
    const party = getObj(STORAGE.party) || {};
    const ids = Object.keys(party).slice(0, PKM_PARTY_SIZE);
    const all = getObj(STORAGE.stats) || {};
    let ch = false;
    for (const id of ids) { const p = all[id] && all[id].pokerus; if (p && !p.cured && Date.now() - p.t > PKM_PKRS_DAYS * 864e5) { p.cured = true; ch = true; } }
    const infected = ids.filter((id) => all[id] && all[id].pokerus && !all[id].pokerus.cured);
    const clean = ids.filter((id) => all[id] && !all[id].pokerus);
    if (!infected.length && clean.length && Math.random() < 1 / 150) { all[clean[0]].pokerus = { t: Date.now(), cured: false }; ch = true; pkmToast(`🦠 ${pkmCap(party[clean[0]].name)} caught Pokérus! It will earn double EVs for a few days.`, 6000); }
    else if (infected.length && clean.length && Math.random() < 1 / 3) { const v = pkmPick(clean); all[v].pokerus = { t: Date.now(), cured: false }; ch = true; }
    if (ch) setObj(STORAGE.stats, all);
  }
  {
    const ge = pkmGainEV;
    pkmGainEV = function (mon, foe) {
      ge.apply(this, arguments);
      const s = mon && mon.instanceId && (getObj(STORAGE.stats) || {})[mon.instanceId];
      if (s && s.pokerus && !s.pokerus.cured) ge.apply(this, arguments);
    };
  }

  // ---------- After every battle: Pokérus, type challenge, Nuzlocke ----------
  {
    const w = pkmWin;
    pkmWin = async function (b) {
      try {
        pkmPokerusTick();
        const tc = pkmJSON("pkm_typechal", null);
        if (tc && tc.type && b.kind === "trainer" && !b.trainer.pvp && pkmTypeTeamOk(tc.type)) {
          tc.wins = (tc.wins || 0) + 1;
          const tiers = [5, 15, 30];
          const done = pkmJSON("pkm_typechal_done", {});
          done[tc.type] = Math.max(done[tc.type] || 0, tc.wins);
          pkmSave("pkm_typechal_done", done);
          if (tiers.includes(tc.wins)) { const pay = 1000 * (tiers.indexOf(tc.wins) + 1); setInt(STORAGE.coins, getInt(STORAGE.coins) + pay); setTimeout(() => pkmToast(`🎯 ${pkmCap(tc.type)} specialist: ${tc.wins} wins! +${pay} coins.`, 5000), 600); }
          pkmSave("pkm_typechal", tc);
        }
      } catch (e) { console.warn(e); }
      return w.apply(this, arguments);
    };
  }
  function pkmTypeTeamOk(type) {
    const ids = Object.keys(getObj(STORAGE.party) || {}).slice(0, PKM_PARTY_SIZE);
    const st = getObj(STORAGE.stats) || {};
    return ids.length > 0 && ids.every((id) => (st[id] && st[id].types || []).includes(type));
  }

  // ---------- Crafting bench ----------
  const PKM_RECIPES = [
    { out: [STORAGE.greatBalls, 1, "Great Ball"], need: [[STORAGE.balls, 3, "Poké Balls"], ["pkm_item_oran-berry", 1, "Oran Berry"]], coins: 0 },
    { out: [STORAGE.ultraBalls, 1, "Ultra Ball"], need: [[STORAGE.greatBalls, 3, "Great Balls"], ["pkm_item_sitrus-berry", 1, "Sitrus Berry"]], coins: 0 },
    { out: ["pkm_revive", 1, "Revive"], need: [[STORAGE.potions, 2, "Potions"], ["pkm_item_lum-berry", 1, "Lum Berry"]], coins: 0 },
    { out: [STORAGE.potions, 3, "Potions"], need: [["pkm_item_oran-berry", 2, "Oran Berries"]], coins: 0 },
    { out: ["pkm_item_nature-mint", 1, "Nature Mint"], need: [["pkm_item_sitrus-berry", 5, "Sitrus Berries"]], coins: 1000 },
    { out: ["pkm_item_tera-shard", 1, "Tera Shard"], need: [["pkm_item_lum-berry", 5, "Lum Berries"]], coins: 1000 },
    { out: ["stone", 1, "Evolution stone"], need: [["pkm_item_oran-berry", 4, "Oran Berries"], ["pkm_item_sitrus-berry", 2, "Sitrus Berries"]], coins: 500 },
    { out: ["pkm_item_life-orb", 1, "Life Orb"], need: [[STORAGE.ultraBalls, 5, "Ultra Balls"], ["pkm_item_lum-berry", 3, "Lum Berries"]], coins: 2000 },
    { out: ["pkm_item_ability-capsule", 1, "Ability Capsule"], need: [["pkm_item_hp-up", 1, "HP Up"], ["pkm_item_protein", 1, "Protein"], ["pkm_item_carbos", 1, "Carbos"]], coins: 1500 },
  ];
  const pkmCanCraft = (r) => getInt(STORAGE.coins) >= r.coins && r.need.every(([k, n]) => getInt(k) >= n);
  function pkmCraft(i) {
    const r = PKM_RECIPES[i];
    if (!r || !pkmCanCraft(r)) return false;
    for (const [k, n] of r.need) setInt(k, getInt(k) - n);
    if (r.coins) setInt(STORAGE.coins, getInt(STORAGE.coins) - r.coins);
    const out = r.out[0] === "stone" ? [pkmRandomStone(), 1, "Evolution stone"] : r.out;
    pkmGive([out]);
    pkmTrack("crafted");
    playSound("buy");
    pkmToast(`🛠️ Crafted ${out[1]} × ${out[2]}!`);
    return true;
  }

  // ---------- Region quest chains with their own rivals ----------
  const PKM_REGION_RIVALS = {
    kanto: ["Blue", "blue-gen1", ["pidgeot", "alakazam", "rhydon"]], johto: ["Silver", "silver", ["feraligatr", "crobat", "magneton"]], hoenn: ["Brendan", "brendan", ["swampert", "breloom", "swellow"]],
    sinnoh: ["Barry", "barry", ["empoleon", "staraptor", "heracross"]], unova: ["Cheren", "cheren", ["samurott", "liepard", "stoutland"]], kalos: ["Shauna", "shauna", ["delphox", "goodra", "florges"]],
    alola: ["Hau", "hau", ["primarina", "raichu-alola", "noivern"]], galar: ["Hop", "hop", ["rillaboom", "corviknight", "dubwool"]],
  };
  for (const r of PKM_REGIONS) {
    const rv = PKM_REGION_RIVALS[r.id];
    if (!rv) continue;
    PKM_STORY.push({ id: `reg-${r.id}`, who: rv[0], icon: r.icon, title: `${r.name} journey`, region: r.id, steps: [
      { say: `So you made it to ${r.name}! Let's see who earns more badges.`, text: `Have 2 ${r.name} badges`, f: `_rb_${r.id}`, n: 2, abs: true, reward: { coins: 1500, items: [[STORAGE.ultraBalls, 3, "Ultra Balls"]] } },
      { say: `I bet you can't catch as many Pokémon in ${r.name}'s wild places as I can!`, text: `Catch 5 Pokémon in ${r.name}'s places`, f: `caught_${r.id}`, n: 5, reward: { coins: 2000, items: [["pkm_item_nature-mint", 1, "Nature Mint"]] } },
      { say: `Enough talk. Battle me!`, text: `Beat ${rv[0]}`, f: `storyRival_${r.id}`, n: 1, rival: r.id, reward: { coins: 4000, items: [["pkm_item_ability-capsule", 1, "Ability Capsule"]] } },
      { say: `You're strong. Become ${r.name}'s Champion, and I'll cheer for you.`, text: `Beat the ${r.name} Champion`, f: `_champ_${r.id}`, n: 1, abs: true, reward: { coins: 8000, items: [[STORAGE.masterBalls, 1, "Master Ball"]] } },
    ] });
  }
  {
    const sv = pkmStoryVal;
    pkmStoryVal = function (f) {
      if (f.startsWith("_rb_")) return pkmRegionBadges(pkmRegion(f.slice(4))).length;
      if (f.startsWith("_champ_")) return pkmRegionDone(f.slice(7)) ? 1 : 0;
      return sv.apply(this, arguments);
    };
    // Catches in a region's places count toward its quest
    const cg = pkmCaught;
    pkmCaught = async function (b) {
      const z = b && b.zone && pkmZoneById(b.zone);
      if (z) pkmTrack(`caught_${z.region}`);
      return cg.apply(this, arguments);
    };
    const os = pkmOpenStory;
    pkmOpenStory = function () {
      const r = os.apply(this, arguments);
      const P = pkmStoryPanel;
      if (!P) return r;
      for (const ch of PKM_STORY) {
        const pr = pkmStoryProgress(ch);
        if (pr.done || !pr.step.rival || pr.have >= pr.step.n) continue;
        const btn = P.querySelector(`[data-claim="${ch.id}"]`);
        const ri = PKM_REGIONS.findIndex((x) => x.id === pr.step.rival);
        if (!btn || !pkmRegionOpen(ri)) continue;
        btn.insertAdjacentHTML("beforebegin", `<button type="button" class="pkm-btn2 primary" data-rivalq="${ch.id}">⚔️ Battle ${pkmEsc(ch.who)}</button>`);
      }
      P.querySelectorAll("[data-rivalq]").forEach((el) => (el.onclick = (e) => {
        e.stopPropagation();
        const ch = PKM_STORY.find((c) => c.id === el.dataset.rivalq);
        const rv = PKM_REGION_RIVALS[ch.region];
        const reg = pkmRegion(ch.region);
        const lvl = pkmClamp(PKM_GYMS[reg.gyms[0] - 1].lvl + 4, 5, MAX_LEVEL);
        pkmPostBattle = () => pkmOpenStory();
        pkmCloseStory();
        pkmStartTrainer({ title: "Rival", name: rv[0], sprite: `${PKM_TRAINER_IMG}${rv[1]}.png`, lose: "Next time, I'll win!", team: rv[2].map((sp, i) => [sp, lvl - (2 - i), i === 2 ? "sitrus-berry" : null]), gym: 0, storyRival: ch.region });
        if (!battlePanel) pkmPostBattle = null;
      }));
      return r;
    };
    const w = pkmWin;
    pkmWin = async function (b) {
      if (b && b.trainer && b.trainer.storyRival) pkmTrack(`storyRival_${b.trainer.storyRival}`);
      return w.apply(this, arguments);
    };
  }

  // ---------- Weekly ladder ----------
  const PKM_LADDER_RULES = [
    { id: "lv50", name: "Level 50", desc: "Your three lead Pokémon are set to Lv 50, like the opponents." },
    { id: "lv50-noitems", name: "Level 50, no items", desc: "Lv 50 and nobody holds an item." },
    { id: "mono", name: "Level 50 monotype", desc: "Your three lead Pokémon must share a type. Lv 50." },
  ];
  const pkmLadderRule = () => PKM_LADDER_RULES[pkmHash(pkmWeekId(), 9) % PKM_LADDER_RULES.length];
  const pkmLadder = () => { const s = pkmJSON("pkm_ladder", {}); return s.week === pkmWeekId() ? s : { week: pkmWeekId(), pts: 0, wins: 0, losses: 0, paid: [] }; };
  const PKM_LADDER_TIERS = [[0, "Poké Ball", "⚪"], [100, "Great Ball", "🔵"], [250, "Ultra Ball", "🟡"], [500, "Master Ball", "🟣"], [800, "Champion", "👑"]];
  const pkmLadderTier = (pts) => [...PKM_LADDER_TIERS].reverse().find((t) => pts >= t[0]);
  async function pkmLadderBattle() {
    const rule = pkmLadderRule();
    const party = getObj(STORAGE.party) || {};
    const ids = Object.keys(party).slice(0, 3);
    if (ids.length < 3) return pkmToast("You need at least 3 Pokémon for the ladder.");
    const mons = (await Promise.all(ids.map((id) => pkmBuildInstance(id)))).filter(Boolean);
    if (rule.id === "mono") { const t = mons[0].types.find((ty) => mons.every((m) => m.types.includes(ty))); if (!t) return pkmToast("This week's rule is monotype: your first three Pokémon must share a type."); }
    for (const m of mons) {
      m.level = 50;
      m.stats = pkmCalcStats(m.base, 50, m.iv, m.nature, m.ev);
      m.maxHP = m.hp = m.stats.hp;
      m.instanceId = undefined;
      m.status = null;
      if (rule.id === "lv50-noitems") m.held = null;
    }
    const team = Array.from({ length: 3 }, () => [pkmRandNonLegend(), 50, rule.id === "lv50-noitems" ? null : pkmPick(PKM_TOWER_ITEMS)]);
    pkmNextRoster = mons;
    pkmPostBattle = () => pkmOpenLadder();
    pkmCloseLadder();
    pkmStartTrainer({ title: "Ladder rival", name: pkmPick(["Ash", "Vega", "Kai", "Nova", "Rin", "Sol"]), sprite: `${PKM_TRAINER_IMG}acetrainer.png`, lose: "Good match!", team, facility: "ladder", noXp: true, gym: 0 });
    if (!battlePanel) { pkmNextRoster = null; pkmPostBattle = null; }
  }
  {
    const fw = pkmFacilityWin, fl = pkmFacilityLose;
    pkmFacilityWin = function (b) {
      if (b.trainer.facility === "ladder") {
        const s = pkmLadder(); s.pts += 25; s.wins++;
        let txt = ` Ladder: +25 points (${s.pts}).`;
        for (const [min, name] of PKM_LADDER_TIERS) if (min > 0 && s.pts >= min && !s.paid.includes(name)) { s.paid.push(name); const c = min * 10; setInt(STORAGE.coins, getInt(STORAGE.coins) + c); txt += ` Reached ${name} tier: +${c} coins!`; }
        pkmSave("pkm_ladder", s);
        return txt;
      }
      if (b.trainer.facility === "hall") return pkmHallWin(b);
      if (b.trainer.facility === "castle") return pkmCastleWin(b);
      return fw.apply(this, arguments);
    };
    pkmFacilityLose = function (b) {
      if (b.trainer.facility === "ladder") { const s = pkmLadder(); s.pts = Math.max(0, s.pts - 10); s.losses++; pkmSave("pkm_ladder", s); return ` Ladder: −10 points (${s.pts}).`; }
      if (b.trainer.facility === "hall") { const h = pkmHall(); h.active = false; pkmSave("pkm_hall", h); return " Your Hall run ended."; }
      if (b.trainer.facility === "castle") { const c = pkmCastle(); c.active = false; pkmSave("pkm_castle", c); return ` Your Castle run ended after ${c.round} win(s).`; }
      return fl.apply(this, arguments);
    };
  }
  let pkmLadderPanel = null;
  function pkmCloseLadder() { if (pkmLadderPanel) pkmLadderPanel.remove(); pkmLadderPanel = null; }
  function pkmOpenLadder() {
    if (!pkmLadderPanel) pkmLadderPanel = pkmMakePanel("pkm-ladder", "Weekly ladder", async (e) => {
      const a = e.target.closest("[data-a]")?.dataset.a;
      if (a === "close") return pkmCloseLadder();
      if (a === "fight") return pkmLadderBattle();
      if (a === "copy") { try { await navigator.clipboard.writeText(pkmLadderPanel.querySelector(".lk-out").value); pkmToast("Copied!"); } catch {} }
      if (a === "compare") {
        const o = pkmUnpack("PKL1", pkmLadderPanel.querySelector(".ld-in").value);
        const box = pkmLadderPanel.querySelector(".ld-res");
        box.textContent = o && o.week ? `${pkmSafeName(o.n) || "Friend"}: ${pkmClamp(parseInt(o.pts, 10) || 0, 0, 99999)} points in week ${pkmSafeName(o.week, 10)} (${parseInt(o.w, 10) || 0}W ${parseInt(o.l, 10) || 0}L)` : "That isn't a ladder code.";
      }
    });
    const s = pkmLadder();
    const rule = pkmLadderRule();
    const tier = pkmLadderTier(s.pts);
    const code = pkmPack("PKL1", { week: s.week, pts: s.pts, w: s.wins, l: s.losses, n: pkmTrainerName() });
    pkmLadderPanel.innerHTML = `${pkmPanelHead("🪜 Weekly ladder", "ld-head")}<div class="lk-body">
      <div class="rk-banner"><b>${tier[2]} ${tier[1]} tier</b> <span class="pkm-dim">${s.pts} points · ${s.wins}W ${s.losses}L · week ${pkmEsc(s.week)}</span></div>
      <p><b>This week: ${pkmEsc(rule.name)}.</b> ${pkmEsc(rule.desc)} Wins give +25 points, losses −10. Reaching a new tier pays coins once a week. No XP and no coin loss. Points reset every Monday.</p>
      <div class="pkm-btns"><button type="button" class="pkm-btn2 primary" data-a="fight">⚔️ Find a ladder match</button></div>
      <label class="lk-l">Your ladder code <textarea class="lk-out" readonly rows="2">${pkmEsc(code)}</textarea></label><div class="pkm-btns"><button type="button" class="pkm-btn2" data-a="copy">📋 Copy</button></div>
      <label class="lk-l">Compare with a friend's code <textarea class="ld-in" rows="2" placeholder="PKL1.…"></textarea></label><div class="pkm-btns"><button type="button" class="pkm-btn2" data-a="compare">Compare</button></div><div class="ld-res pkm-dim"></div></div>`;
  }

  // ---------- Trainer card image ----------
  async function pkmCardImage() {
    const c = document.createElement("canvas");
    c.width = 640; c.height = 360;
    const g = c.getContext("2d");
    const look = pkmLook();
    const lc = PKM_LOOK_COLORS[look.color] || PKM_LOOK_COLORS[0];
    const grd = g.createLinearGradient(0, 0, 640, 360); grd.addColorStop(0, lc[1]); grd.addColorStop(1, lc[2]);
    g.fillStyle = grd; g.fillRect(0, 0, 640, 360);
    g.fillStyle = "rgba(255,255,255,.12)"; g.fillRect(20, 20, 600, 320);
    const k = pkmRank();
    const p = pkmProgressView();
    g.fillStyle = "#fff"; g.font = "bold 30px sans-serif"; g.fillText(pkmTrainerName(), 40, 70);
    g.font = "20px sans-serif";
    g.fillText(`${look.title || k.name} · ${k.pts} rank points`, 40, 102);
    await new Promise((res) => { const t = new Image(); t.crossOrigin = "anonymous"; t.onload = () => { try { g.drawImage(t, 480, 30, 120, 120); } catch {} res(); }; t.onerror = res; t.src = `${PKM_TRAINER_IMG}${look.sprite}.png`; });
    g.fillText(`Badges ${p._badges}/${PKM_GYMS.length} · Champions ${p._champs}/${PKM_REGIONS.length}`, 40, 134);
    g.fillText(`Pokédex ${p._dex} · Tower best ${p._towerBest || 0} · Caught ${p.caught || 0}`, 40, 164);
    const party = getObj(STORAGE.party) || {};
    const dexArr = getArr(STORAGE.pokedex) || [];
    const ids = Object.keys(party).slice(0, 6);
    await Promise.all(ids.map((id, i) => new Promise((res) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => { try { g.drawImage(img, 40 + i * 96, 200, 96, 96); } catch {} res(); };
      img.onerror = res;
      img.src = pkmMonSprite(party[id], dexArr);
    })));
    g.font = "14px sans-serif"; g.fillStyle = "rgba(255,255,255,.8)"; g.fillText(`Pokémon Battle (Full Edition) · ${new Date().toLocaleDateString()}`, 40, 325);
    try { return c.toDataURL("image/png"); } catch { return null; }
  }
  {
    const ob = pkmOpenBadges;
    pkmOpenBadges = function () {
      const r = ob.apply(this, arguments);
      const P = pkmBadgesPanel;
      const ban = P && P.querySelector(".rk-banner");
      if (ban && !P.querySelector("[data-cardimg]")) {
        ban.insertAdjacentHTML("beforeend", `<div class="pkm-btns"><button type="button" class="pkm-btn2" data-cardimg="1">🖼️ Make a card image</button></div><div class="ci-out"></div>`);
        P.querySelector("[data-cardimg]").onclick = async (e) => {
          e.stopPropagation();
          const url = await pkmCardImage();
          const out = P.querySelector(".ci-out");
          if (!out) return;
          out.innerHTML = url ? `<img src="${url}" alt="Trainer card" style="width:100%;border-radius:10px;margin-top:6px"><a class="pkm-btn2" download="trainer-card.png" href="${url}">⬇️ Download</a>` : `<div class="pkm-dim">Couldn't make the image in this browser.</div>`;
        };
      }
      return r;
    };
  }

  // ---------- Tower record codes ----------
  {
    const ot = pkmOpenTower;
    pkmOpenTower = function () {
      const r = ot.apply(this, arguments);
      const P = pkmTowerPanel;
      if (!P || P.querySelector(".tw-rec")) return r;
      const t = pkmTower();
      const party = getObj(STORAGE.party) || {};
      const code = pkmPack("PKR1", { best: t.best, wins: t.wins, n: pkmTrainerName(), team: Object.values(party).slice(0, 6).map((p) => p.name), d: Date.now() });
      const friends = pkmJSON("pkm_tower_friends", []);
      P.querySelector(".tw-body").insertAdjacentHTML("beforeend", `<div class="tw-rec"><div class="bag-sec"><span>🏅 Tower records</span></div>
        <label class="lk-l">Your record code <textarea class="lk-out" readonly rows="2">${pkmEsc(code)}</textarea></label>
        <label class="lk-l">Add a friend's record <textarea class="tw-in" rows="2" placeholder="PKR1.…"></textarea></label><div class="pkm-btns"><button type="button" class="pkm-btn2" data-twadd="1">Add</button></div>
        ${friends.length ? `<div class="bc-ach">${[{ n: pkmTrainerName() + " (you)", best: t.best }, ...friends].sort((a, c) => c.best - a.best).map((f, i) => `<div class="pkm-dim">#${i + 1} ${pkmEsc(f.n)}: best streak ${f.best}${f.team ? ` · ${f.team.map(pkmCap).join(", ")}` : ""}</div>`).join("")}</div>` : ""}</div>`);
      P.querySelector("[data-twadd]").onclick = (e) => {
        e.stopPropagation();
        const o = pkmUnpack("PKR1", P.querySelector(".tw-in").value);
        if (!o) return pkmToast("That isn't a Tower record code.");
        const list = pkmJSON("pkm_tower_friends", []).filter((f) => f.n !== pkmSafeName(o.n));
        list.push({ n: pkmSafeName(o.n) || "Friend", best: pkmClamp(parseInt(o.best, 10) || 0, 0, 9999), team: Array.isArray(o.team) ? o.team.slice(0, 6).map((x) => pkmSafeSlug(String(x)) || "?") : [] });
        pkmSave("pkm_tower_friends", list.slice(-20));
        pkmOpenTower();
      };
      return r;
    };
  }

  // ---------- Box tools: sort storage and release in bulk ----------
  let pkmBoxPanel = null;
  let pkmBoxSort = "level";
  let pkmBoxSel = new Set();
  let pkmBoxConfirm = 0;
  function pkmCloseBox() { if (pkmBoxPanel) pkmBoxPanel.remove(); pkmBoxPanel = null; pkmBoxSel = new Set(); }
  function pkmBoxOrder(entries, st) {
    const lv = (id) => (st[id] || {}).level || 1;
    const by = {
      level: (a, c) => lv(c[0]) - lv(a[0]), name: (a, c) => a[1].name.localeCompare(c[1].name), newest: (a, c) => (c[1].caughtAt || 0) - (a[1].caughtAt || 0),
      shiny: (a, c) => (c[1].isShiny ? 1 : 0) - (a[1].isShiny ? 1 : 0) || lv(c[0]) - lv(a[0]), dex: (a, c) => ((st[a[0]] || {}).dexId || 9999) - ((st[c[0]] || {}).dexId || 9999),
    }[pkmBoxSort];
    return entries.slice().sort(by);
  }
  function pkmOpenBox() {
    if (!pkmBoxPanel) {
      pkmBoxPanel = pkmMakePanel("pkm-box", "Box tools", (e) => {
        const a = e.target.closest("[data-a]")?.dataset.a;
        const cb = e.target.closest("[data-box]");
        if (a === "close") return pkmCloseBox();
        if (cb) { const id = cb.dataset.box; pkmBoxSel.has(id) ? pkmBoxSel.delete(id) : pkmBoxSel.add(id); pkmBoxConfirm = 0; return pkmOpenBox(); }
        if (a === "apply") {
          const party = getObj(STORAGE.party) || {}; const st = getObj(STORAGE.stats) || {};
          const ents = Object.entries(party);
          const keep = ents.slice(0, PKM_PARTY_SIZE);
          const next = {};
          for (const [id, p] of [...keep, ...pkmBoxOrder(ents.slice(PKM_PARTY_SIZE), st)]) next[id] = p;
          setObj(STORAGE.party, next);
          pkmToast("Storage sorted. Your party stayed the same.");
          return pkmOpenBox();
        }
        if (a === "release") {
          if (!pkmBoxSel.size) return;
          if (Date.now() - pkmBoxConfirm > 4000) { pkmBoxConfirm = Date.now(); return pkmToast(`Press Release again to release ${pkmBoxSel.size} Pokémon for good.`, 4000); }
          const party = getObj(STORAGE.party) || {}; const st = getObj(STORAGE.stats) || {};
          const active = GM_getValue("pkm_starter_id");
          let n = 0;
          for (const id of pkmBoxSel) { if (id === active || !party[id]) continue; if (party[id].held) setInt(`pkm_item_${party[id].held}`, getInt(`pkm_item_${party[id].held}`) + 1); delete party[id]; delete st[id]; n++; }
          setObj(STORAGE.party, party); setObj(STORAGE.stats, st);
          pkmBoxSel = new Set(); pkmBoxConfirm = 0;
          pkmToast(`Released ${n} Pokémon. Held items went back to your Bag.`);
          return pkmOpenBox();
        }
      });
      pkmBoxPanel.onchange = (e) => { if (e.target.matches(".bx-sort")) { pkmBoxSort = e.target.value; pkmOpenBox(); } };
    }
    const party = getObj(STORAGE.party) || {};
    const st = getObj(STORAGE.stats) || {};
    const dexArr = getArr(STORAGE.pokedex) || [];
    const storage = pkmBoxOrder(Object.entries(party).slice(PKM_PARTY_SIZE), st);
    pkmBoxPanel.innerHTML = `${pkmPanelHead("📦 Box tools", "bx-head")}<div class="lk-body">
      <div class="pkm-btns"><label>Sort by <select class="bx-sort">${[["level", "Level"], ["name", "Name"], ["newest", "Newest"], ["shiny", "Shiny first"], ["dex", "Pokédex number"]].map(([k, l]) => `<option value="${k}" ${pkmBoxSort === k ? "selected" : ""}>${l}</option>`).join("")}</select></label>
        <button type="button" class="pkm-btn2 primary" data-a="apply">Apply this order to storage</button>
        <button type="button" class="pkm-btn2 danger" data-a="release" ${pkmBoxSel.size ? "" : "disabled"}>Release ${pkmBoxSel.size || ""} selected</button></div>
      <div class="pkm-dim">Only Pokémon in storage (not your party of 6) are shown. Released Pokémon are gone for good.</div>
      <div class="ft-grid">${storage.length ? storage.map(([id, p]) => `<button type="button" class="ft-card${pkmBoxSel.has(id) ? " on" : ""}" data-box="${pkmEsc(id)}" aria-pressed="${pkmBoxSel.has(id)}"><img src="${pkmEsc(pkmMonSprite(p, dexArr))}" alt=""><b>${pkmEsc(pkmCap(p.name))}${p.isShiny ? " ✨" : ""}</b><span class="pkm-dim">Lv ${(st[id] || {}).level || 1}</span></button>`).join("") : `<div class="pkm-dim">Your storage is empty.</div>`}</div></div>`;
  }

  // ---------- Nuzlocke mode ----------
  const pkmNuzOn = () => GM_getValue("pkm_nuzlocke", "false") === "true";
  {
    const tb = throwBall;
    throwBall = function (ball) {
      const b = pkb;
      if (pkmNuzOn() && b && b.kind === "wild" && b.zone && typeof ball === "string") {
        const used = pkmJSON("pkm_nuz_zones", {});
        if (used[b.zone] && used[b.zone] !== b.nuzId) return drawBattle("Nuzlocke: you already had your one encounter in this place.");
      }
      return tb.apply(this, arguments);
    };
    const sb = pkmStartBattle;
    pkmStartBattle = async function () {
      const r = await sb.apply(this, arguments);
      const b = pkb;
      if (pkmNuzOn() && b && b.kind === "wild" && b.zone) {
        const used = pkmJSON("pkm_nuz_zones", {});
        if (!used[b.zone]) { b.nuzId = `${Date.now()}`; used[b.zone] = b.nuzId; pkmSave("pkm_nuz_zones", used); }
      }
      return r;
    };
    startBattle = pkmStartBattle;
    const cb = closeBattle;
    closeBattle = function (...a) {
      const b = pkb;
      if (pkmNuzOn() && b && b.roster) {
        const party = getObj(STORAGE.party) || {}; const st = getObj(STORAGE.stats) || {};
        const lost = [];
        for (const r of b.roster) {
          const id = r.mon && r.mon.instanceId;
          if (!id || !party[id] || r.mon.hp > 0 || Object.keys(party).length <= 1) continue;
          lost.push(party[id].name);
          delete party[id]; delete st[id];
        }
        if (lost.length) {
          setObj(STORAGE.party, party); setObj(STORAGE.stats, st);
          const grave = pkmJSON("pkm_nuz_lost", []); grave.push(...lost.map((n) => ({ n, t: Date.now() }))); pkmSave("pkm_nuz_lost", grave.slice(-100));
          if (!party[GM_getValue("pkm_starter_id")]) { const first = Object.keys(party)[0]; if (first) fetchPartner(first); }
          setTimeout(() => pkmToast(`🕯️ Nuzlocke: ${lost.map(pkmCap).join(", ")} fainted and ${lost.length > 1 ? "were" : "was"} released.`, 6000), 400);
        }
      }
      return cb.apply(this, a);
    };
  }

  // ---------- Battle Hall (one-on-one by type) and Battle Castle (spend points between battles) ----------
  const PKM_TYPES = ["normal", "fire", "water", "electric", "grass", "ice", "fighting", "poison", "ground", "flying", "psychic", "bug", "rock", "ghost", "dragon", "dark", "steel", "fairy"];
  const pkmHall = () => Object.assign({ active: false, ranks: {} }, pkmJSON("pkm_hall", {}));
  async function pkmTypeSpecies(type) {
    const r = await pkmFetch(`https://pokeapi.co/api/v2/type/${type}`).catch(() => null);
    const d = r && r.ok ? await r.json() : null;
    return ((d && d.pokemon) || []).map((x) => x.pokemon.name).filter((n) => !/-(mega|gmax|totem|starter)/.test(n));
  }
  async function pkmHallFight(type) {
    const h = pkmHall();
    const party = getObj(STORAGE.party) || {};
    const st = getObj(STORAGE.stats) || {};
    const id = Object.keys(party).slice(0, PKM_PARTY_SIZE).find((i) => ((st[i] || {}).currentHP == null ? 1 : st[i].currentHP) > 0);
    if (!id) return pkmToast("Heal your Pokémon first.");
    const names = await pkmTypeSpecies(type);
    if (!names.length) return pkmToast("Couldn't load Pokémon of that type. Try again.");
    const rank = (h.ranks[type] || 0) + 1;
    const lead = await pkmBuildInstance(id);
    if (!lead) return;
    h.active = true; h.type = type;
    pkmSave("pkm_hall", h);
    pkmNextRoster = [lead];
    pkmPostBattle = () => pkmOpenFrontier("hall");
    pkmCloseFrontier();
    pkmStartTrainer({ title: "Hall Matron", name: "Argenta", sprite: `${PKM_TRAINER_IMG}argenta.png`, lose: "Splendid!", team: [[pkmPick(names), pkmClamp(lead.level - 3 + rank, 5, MAX_LEVEL), rank >= 5 ? pkmPick(PKM_TOWER_ITEMS) : null]], facility: "hall", hallType: type, gym: 0 });
    if (!battlePanel) { pkmNextRoster = null; pkmPostBattle = null; }
  }
  function pkmHallWin(b) {
    const h = pkmHall();
    const t = b.trainer.hallType;
    h.ranks[t] = Math.min(10, (h.ranks[t] || 0) + 1);
    const pay = 200 * h.ranks[t];
    setInt(STORAGE.coins, getInt(STORAGE.coins) + pay);
    pkmSave("pkm_hall", h);
    const total = Object.values(h.ranks).reduce((a, c) => a + c, 0);
    pkmFrontRecord("hall", total);
    pkmTrack("frontierWins");
    return ` Hall: ${pkmCap(t)} rank ${h.ranks[t]}/10, +${pay} coins.`;
  }
  const pkmCastle = () => Object.assign({ active: false, round: 0, cp: 0, scout: null }, pkmJSON("pkm_castle", {}));
  async function pkmCastleFight() {
    const c = pkmCastle();
    const lvl = pkmClamp(pkmTopLevel() - 2 + c.round * 2, 5, MAX_LEVEL);
    const team = c.scout || Array.from({ length: 3 }, () => [pkmRandNonLegend(), lvl, pkmPick(PKM_TOWER_ITEMS)]);
    c.scout = null;
    pkmSave("pkm_castle", c);
    pkmPostBattle = () => pkmOpenFrontier("castle");
    pkmCloseFrontier();
    pkmStartTrainer({ title: c.round === 6 ? "Castle Valet" : "Castle Knight", name: c.round === 6 ? "Darach" : pkmPick(["Ilse", "Gareth", "Mira", "Ronan"]), sprite: `${PKM_TRAINER_IMG}${c.round === 6 ? "darach" : "acetrainer"}.png`, lose: "Most impressive.", team, facility: "castle", gym: 0 });
    if (!battlePanel) pkmPostBattle = null;
  }
  function pkmCastleWin(b) {
    const c = pkmCastle();
    c.round++;
    const share = b.roster.reduce((n, r) => n + Math.max(0, pkmRosterHP(r).hp) / Math.max(1, pkmRosterHP(r).max), 0) / Math.max(1, b.roster.length);
    const gain = 3 + Math.round(share * 7);
    c.cp += gain;
    let txt = ` Castle round ${c.round}/7: +${gain} Castle Points.`;
    if (c.round >= 7) {
      const items = [[STORAGE.ultraBalls, 5, "Ultra Balls"], ["pkm_item_ability-capsule", 1, "Ability Capsule"]];
      pkmGive(items);
      setInt(STORAGE.coins, getInt(STORAGE.coins) + 5000 + c.cp * 100);
      txt += ` 🏰 Castle cleared! +${5000 + c.cp * 100} coins (leftover points count), ${pkmItemsText(items)}.`;
      pkmFrontRecord("castle", 7);
      pkmTrack("frontierWins");
      c.active = false;
    } else pkmFrontRecord("castle", c.round);
    pkmSave("pkm_castle", c);
    return txt;
  }
  {
    const df = pkmDrawFrontier;
    pkmDrawFrontier = async function () {
      await df.apply(this, arguments);
      const P = pkmFrontPanel;
      if (!P) return;
      const tabs = P.querySelector(".bag-tabs");
      if (tabs && !tabs.querySelector('[data-tab="hall"]')) tabs.insertAdjacentHTML("beforeend", `<button type="button" role="tab" data-tab="hall" aria-selected="${pkmFrontTab === "hall"}">🏛️ Hall</button><button type="button" role="tab" data-tab="castle" aria-selected="${pkmFrontTab === "castle"}">🏰 Castle</button>`);
      if (pkmFrontTab !== "hall" && pkmFrontTab !== "castle") return;
      const body = P.querySelector(".lk-body");
      const best = pkmFrontBest();
      if (pkmFrontTab === "hall") {
        const h = pkmHall();
        body.innerHTML = `<p>Battle one-on-one with your lead Pokémon. Pick a type and face a Pokémon of that type. Each type has 10 ranks, and each win raises that type's rank (stronger foes, more coins). Total ranks: <b>${Object.values(h.ranks).reduce((a, c) => a + c, 0)}</b>/180 (best ${best.hall || 0}).</p>
          <div class="ft-grid">${PKM_TYPES.map((t) => `<button type="button" class="ft-card" data-hall="${t}"><span class="pk-type ${t}">${t}</span><span class="pkm-dim">Rank ${h.ranks[t] || 0}/10</span></button>`).join("")}</div>`;
        body.querySelectorAll("[data-hall]").forEach((el) => (el.onclick = (e) => { e.stopPropagation(); if ((pkmHall().ranks[el.dataset.hall] || 0) >= 10) return pkmToast("That type is already at rank 10!"); pkmHallFight(el.dataset.hall); }));
      } else {
        const c = pkmCastle();
        body.innerHTML = c.active
          ? `<div class="rk-banner"><b>Round ${c.round + 1}/7 · ${c.cp} Castle Points</b> <span class="pkm-dim">Your HP carries over between battles.</span></div>
            ${c.scout ? `<div class="pkm-dim">Next foe: ${c.scout.map((x) => `#${x[0]}`).join(", ")} at Lv ${c.scout[0][1]}</div>` : ""}
            <div class="pkm-btns"><button type="button" class="pkm-btn2" data-castle="heal50" ${c.cp >= 4 ? "" : "disabled"}>💗 Heal 50% (4 CP)</button><button type="button" class="pkm-btn2" data-castle="heal" ${c.cp >= 8 ? "" : "disabled"}>❤️ Full heal (8 CP)</button>
              <button type="button" class="pkm-btn2" data-castle="potion" ${c.cp >= 2 ? "" : "disabled"}>💉 Potion (2 CP)</button><button type="button" class="pkm-btn2" data-castle="scout" ${c.cp >= 1 && !c.scout ? "" : "disabled"}>🔍 Scout the next foe (1 CP)</button></div>
            <div class="pkm-btns"><button type="button" class="pkm-btn2 primary" data-castle="fight">⚔️ Battle</button><button type="button" class="pkm-btn2 danger" data-castle="quit">Give up</button></div>`
          : `<p>Fight 7 battles with your own party. Wins earn Castle Points (more if your team is healthy). Spend them between battles on healing, Potions or scouting. Leftover points pay coins at the end. Best: <b>${best.castle || 0}</b>.</p><div class="pkm-btns"><button type="button" class="pkm-btn2 primary" data-castle="start">Enter the Castle</button></div>`;
        body.querySelectorAll("[data-castle]").forEach((el) => (el.onclick = (e) => {
          e.stopPropagation();
          const c2 = pkmCastle();
          const k = el.dataset.castle;
          if (k === "start") { healPokemon(); pkmSave("pkm_castle", { active: true, round: 0, cp: 0, scout: null }); return pkmDrawFrontier(); }
          if (k === "quit") { c2.active = false; pkmSave("pkm_castle", c2); return pkmDrawFrontier(); }
          if (k === "fight") return pkmCastleFight();
          const cost = { heal50: 4, heal: 8, potion: 2, scout: 1 }[k];
          if (c2.cp < cost) return;
          c2.cp -= cost;
          if (k === "heal50") pkmHealShare(0.5);
          if (k === "heal") pkmHealShare(1);
          if (k === "potion") setInt(STORAGE.potions, getInt(STORAGE.potions) + 1);
          if (k === "scout") { const lvl = pkmClamp(pkmTopLevel() - 2 + c2.round * 2, 5, MAX_LEVEL); c2.scout = Array.from({ length: 3 }, () => [pkmRandNonLegend(), lvl, pkmPick(PKM_TOWER_ITEMS)]); }
          pkmSave("pkm_castle", c2);
          pkmDrawFrontier();
        }));
      }
    };
  }

  // ---------- Panels: crafting bench, type challenge ----------
  let pkmCraftPanel = null;
  function pkmCloseCraft() { if (pkmCraftPanel) pkmCraftPanel.remove(); pkmCraftPanel = null; }
  function pkmOpenCraft() {
    if (!pkmCraftPanel) pkmCraftPanel = pkmMakePanel("pkm-craft", "Crafting bench", (e) => {
      const a = e.target.closest("[data-a]")?.dataset.a;
      if (a === "close") return pkmCloseCraft();
      const r = e.target.closest("[data-craft]");
      if (r && !r.disabled) { pkmCraft(+r.dataset.craft); pkmOpenCraft(); }
    });
    pkmCraftPanel.innerHTML = `${pkmPanelHead("🛠️ Crafting bench", "cr-head")}<div class="lk-body"><p class="pkm-dim">Turn berries from your garden and spare items into useful ones.</p>
      ${PKM_RECIPES.map((r, i) => `<div class="oc-preset"><div><b>${r.out[1]} × ${pkmEsc(r.out[2])}</b><div class="pkm-dim">${r.need.map(([k, n, l]) => `${n} × ${pkmEsc(l)} (${getInt(k)})`).join(" + ")}${r.coins ? ` + 💰 ${r.coins}` : ""}</div></div><button type="button" class="pkm-btn2 primary" data-craft="${i}" ${pkmCanCraft(r) ? "" : "disabled"}>Craft</button></div>`).join("")}</div>`;
  }
  let pkmTypePanel = null;
  function pkmCloseTypeChal() { if (pkmTypePanel) pkmTypePanel.remove(); pkmTypePanel = null; }
  function pkmOpenTypeChal() {
    if (!pkmTypePanel) pkmTypePanel = pkmMakePanel("pkm-typechal", "Type challenge", (e) => {
      const a = e.target.closest("[data-a]")?.dataset.a;
      if (a === "close") return pkmCloseTypeChal();
      if (a === "stop") { pkmSave("pkm_typechal", null); return pkmOpenTypeChal(); }
      const t = e.target.closest("[data-tchal]");
      if (t) { pkmSave("pkm_typechal", { type: t.dataset.tchal, wins: 0 }); pkmOpenTypeChal(); }
    });
    const tc = pkmJSON("pkm_typechal", null);
    const done = pkmJSON("pkm_typechal_done", {});
    pkmTypePanel.innerHTML = `${pkmPanelHead("🎯 Type specialist", "tp-head")}<div class="lk-body">
      <p>Pick a type, then win trainer battles while <b>every Pokémon in your party</b> has that type. Prizes at 5, 15 and 30 wins.</p>
      ${tc ? `<div class="rk-banner"><b><span class="pk-type ${tc.type}">${tc.type}</span> challenge: ${tc.wins} wins</b> <span class="pkm-dim">${pkmTypeTeamOk(tc.type) ? "Your party qualifies ✅" : "Your party doesn't qualify right now"}</span><div class="pkm-btns"><button type="button" class="pkm-btn2 danger" data-a="stop">Stop the challenge</button></div></div>` : ""}
      <div class="ft-grid">${PKM_TYPES.map((t) => `<button type="button" class="ft-card${tc && tc.type === t ? " on" : ""}" data-tchal="${t}"><span class="pk-type ${t}">${t}</span><span class="pkm-dim">Best ${done[t] || 0} wins${(done[t] || 0) >= 30 ? " 🏆" : ""}</span></button>`).join("")}</div></div>`;
  }

  // ---------- Habitat tracking on the map ----------
  {
    const dm = pkmDrawMap;
    pkmDrawMap = function () {
      const r = dm.apply(this, arguments);
      const P = pkmMapPanel;
      if (!P) return r;
      const caught = new Set((getArr(STORAGE.pokedex) || []).map((e) => String(e.name).toLowerCase().replace(/\s+/g, "-")));
      const zones = (PKM_ZONES[pkmMapRegion] || []);
      P.querySelectorAll(".mp-node").forEach((n) => {
        const z = zones.find((x) => x.id === n.dataset.zone);
        if (!z) return;
        const have = z.pool.filter((s) => caught.has(s)).length;
        n.insertAdjacentHTML("beforeend", `<span class="mp-lv">${have === z.pool.length ? "✅ " : ""}${have}/${z.pool.length} caught</span>`);
      });
      const sel = zones.find((x) => x.id === pkmMapSel);
      const info = P.querySelector(".mp-info");
      if (sel && info) info.insertAdjacentHTML("beforeend", `<div class="pkm-dim">Caught here: ${sel.pool.map((s) => `${caught.has(s) ? "✅" : "▫️"} ${pkmEsc(pkmCap(s))}`).join(", ")}</div>`);
      const roam = pkmRoamers().filter((x) => x.region === pkmMapRegion);
      const w = pkmRegionWeather(pkmMapRegion);
      const ev = P.querySelector(".mp-events");
      if (ev) ev.insertAdjacentHTML("beforeend", `<span class="pkm-dim">${w ? `${PKM_WEATHER[w].icon} ${PKM_WEATHER[w].name} in ${pkmEsc(pkmRegion(pkmMapRegion).name)} this hour` : "☁️ Clear skies this hour"}</span>${roam.map((x) => `<span class="pkm-dim">📍 ${pkmEsc(pkmCap(x.name))} is roaming at ${pkmEsc(x.zone.name)}</span>`).join("")}`);
      return r;
    };
  }

  // ---------- Options: Nuzlocke switch, sound note ----------
  {
    const dro = pkmDrawOptions;
    pkmDrawOptions = function () {
      const r = dro.apply(this, arguments);
      const P = pkmOptionsPanel;
      if (P && pkmOptionsTab === "game" && P.querySelector(".lk-body") && !P.querySelector("[data-nuz]")) {
        const on = pkmNuzOn();
        P.querySelector(".lk-body").insertAdjacentHTML("beforeend", `<div class="bag-sec"><span>Nuzlocke mode</span></div>
          <div class="pkm-dim">Only your first wild encounter in each map place can be caught, and Pokémon that faint are released after the battle (your last Pokémon is always kept). ${on ? `${pkmJSON("pkm_nuz_lost", []).length} lost so far.` : ""}</div>
          <div class="pkm-btns"><button type="button" class="pkm-btn2 ${on ? "danger" : ""}" data-nuz="1">${on ? "Turn Nuzlocke off" : "Turn Nuzlocke on…"}</button></div>`);
        let ask = 0;
        P.querySelector("[data-nuz]").onclick = (e) => {
          e.stopPropagation();
          if (pkmNuzOn()) { GM_setValue("pkm_nuzlocke", "false"); return pkmDrawOptions(); }
          if (Date.now() - ask > 4000) { ask = Date.now(); return pkmToast("Fainted Pokémon will be released for good. Press again to turn Nuzlocke on.", 4500); }
          GM_setValue("pkm_nuzlocke", "true");
          pkmSave("pkm_nuz_zones", {});
          pkmDrawOptions();
        };
      }
      return r;
    };
  }

  pkmStyle(`
    .pkm-set.pkm-ladder,.pkm-set.pkm-box,.pkm-set.pkm-craft,.pkm-set.pkm-typechal{width:min(700px,96vw);max-height:92vh;overflow:auto}
    .ld-head{background:linear-gradient(90deg,#d68a2b,#7a4a0e)!important}.bx-head{background:linear-gradient(90deg,#5a7a8a,#2f4a5a)!important}
    .cr-head{background:linear-gradient(90deg,#8a6a3a,#5a3a1a)!important}.tp-head{background:linear-gradient(90deg,#3aa06a,#1a6040)!important}
  `, "pkm-v40");

  // =====================================================================
  //  4.1: update notices, Telepathy, triple and rotation battles, gender
  //  sprites, Gigantamax Factor, Nuzlocke graveyard and hardcore rules,
  //  shiny odds per species, ribbons on the trainer card, save codes,
  //  and selecting many Pokémon in the Bag
  // =====================================================================

  // ---------- Update notice (a banner instead of the old confirm() box) ----------
  let pkmUpdBanner = null;
  function pkmUpdateNotice(v) {
    try {
      if (!v || updater.compareVersions(v, cfg.CURRENT_VERSION) <= 0) return;
      if (GM_getValue("pkm_update_dismissed", "") === v) return;
      if (pkmUpdBanner) pkmUpdBanner.remove();
      const el = document.createElement("div");
      el.className = "pkm-upd-banner";
      el.setAttribute("role", "status");
      el.innerHTML = `<span>⬆️ <b>Pokémon Battle ${pkmEsc(v)}</b> is out (you have ${pkmEsc(cfg.CURRENT_VERSION)}).</span>
        <button type="button" class="pkm-btn2 primary" data-u="go">Update now</button><button type="button" class="pkm-btn2" data-u="new">What's new</button><button type="button" class="pkm-x" data-u="later" aria-label="Later" title="Remind me next version">✕</button>`;
      el.onclick = (e) => {
        const a = e.target.closest("[data-u]")?.dataset.u;
        if (!a) return;
        if (a === "go") window.open(cfg.DOWNLOAD_URL, "_blank");
        if (a === "new") pkmOpenOptions("new");
        if (a === "later" || a === "go") GM_setValue("pkm_update_dismissed", v);
        el.remove(); pkmUpdBanner = null;
      };
      pkmMount(el);
      pkmUpdBanner = el;
      pkmLauncher.classList.add("has-upd");
    } catch (e) { console.warn(e); }
  }
  /** Ask GitHub for the newest version now (skips the 1-hour cache). Returns { remote, newer } or null. */
  async function pkmCheckUpdateNow() {
    const remote = await updater.fetchRemoteVersion(cfg.DOWNLOAD_URL, true);
    if (!remote) return null;
    GM_setValue("pkm_update_remote", remote);
    const newer = updater.compareVersions(remote, cfg.CURRENT_VERSION) > 0;
    if (newer) { GM_deleteValue("pkm_update_dismissed"); pkmUpdateNotice(remote); }
    return { remote, newer };
  }
  setTimeout(() => {
    const v = GM_getValue("pkm_update_remote", "");
    if (v && updater.compareVersions(v, cfg.CURRENT_VERSION) > 0) pkmUpdateNotice(v);
  }, 4000);
  // Check again every 3 hours on long-open tabs
  setInterval(() => { if (!document.hidden) updater.fetchRemoteVersion(cfg.DOWNLOAD_URL).then((v) => { if (v) { GM_setValue("pkm_update_remote", v); pkmUpdateNotice(v); } }).catch(() => {}); }, 3 * 3600e3);

  // ---------- Options → What's new: version, update check ----------
  {
    const dro = pkmDrawOptions;
    pkmDrawOptions = function () {
      const r = dro.apply(this, arguments);
      const P = pkmOptionsPanel;
      if (!P || pkmOptionsTab !== "new" || P.querySelector(".op-upd")) return r;
      const remote = GM_getValue("pkm_update_remote", "");
      const newer = remote && updater.compareVersions(remote, cfg.CURRENT_VERSION) > 0;
      P.querySelector(".lk-body").insertAdjacentHTML("afterbegin", `<div class="op-upd">
        <div><b>You have version ${pkmEsc(cfg.CURRENT_VERSION)}</b><div class="pkm-dim op-upd-st" aria-live="polite">${newer ? `Version ${pkmEsc(remote)} is ready to install.` : remote ? `Newest on GitHub: ${pkmEsc(remote)}.` : "Not checked yet."}</div></div>
        <div class="pkm-btns"><button type="button" class="pkm-btn2" data-upd="check">🔄 Check for updates</button><button type="button" class="pkm-btn2 primary" data-upd="go" ${newer ? "" : "hidden"}>⬆️ Install update</button></div></div>`);
      const st = P.querySelector(".op-upd-st");
      const go = P.querySelector('[data-upd="go"]');
      P.querySelector('[data-upd="check"]').onclick = async (e) => {
        e.stopPropagation();
        e.currentTarget.disabled = true;
        st.textContent = "Checking GitHub…";
        const res = await pkmCheckUpdateNow().catch(() => null);
        if (!st.isConnected) return;
        P.querySelector('[data-upd="check"]').disabled = false;
        if (!res) { st.textContent = "Couldn't reach GitHub. Check your connection and try again."; return; }
        st.textContent = res.newer ? `Version ${res.remote} is ready to install.` : `You're up to date (newest is ${res.remote}).`;
        go.hidden = !res.newer;
      };
      go.onclick = (e) => { e.stopPropagation(); window.open(cfg.DOWNLOAD_URL, "_blank"); };
      return r;
    };
  }

  // ---------- Telepathy: moves that hit everyone also hit your partner, unless it has Telepathy ----------
  {
    const dm = pkmDblMove;
    pkmDblMove = async function (b, att, mv, target) {
      const r = await dm.apply(this, arguments);
      if (!b.double || !mv || pkmSelfMove(mv) || !/^all-other-pokemon/.test(mv.target || "") || att.hp <= 0 || !pkmAlive(b) || att.charging) return r;
      const side = pkmMine(b, att) ? b.mine : b.foes;
      for (const al of side.filter((x) => x && x !== att && x.hp > 0)) {
        if (!pkmAlive(b)) break;
        if (al.ability === "telepathy") { await pkmSay(b, `${pkmWho(b, al)} read its partner's mind and dodged with Telepathy!`, 700); continue; }
        await pkmUseMove(b, att, al, { ...mv, spread: 0.75, srcMove: mv.srcMove || mv, noPP: true, quiet: true });
      }
      return r;
    };
  }

  // ---------- Triple and rotation battles ----------
  function pkmTripleTrainer() {
    const t = pkmDoubleTrainer();
    const L = pkmTrainerBase();
    const c = PKM_TRAINER_CLASSES.find((x) => t.title.startsWith(x.title)) || PKM_TRAINER_CLASSES[0];
    t.team = Array.from({ length: 6 }, () => [pkmPick(c.pool), Math.max(2, Math.min(MAX_LEVEL, L + pkmRand(-2, 1)))]);
    t.title = t.title.replace(/ duo$/, " trio");
    t.triple = true;
    return t;
  }
  function pkmRotationTrainer() {
    const t = pkmRandomTrainer();
    const L = pkmTrainerBase();
    const c = PKM_TRAINER_CLASSES.find((x) => x.title === t.title) || PKM_TRAINER_CLASSES[0];
    t.team = Array.from({ length: 3 }, () => [pkmPick(c.pool), Math.max(2, Math.min(MAX_LEVEL, L + pkmRand(-1, 1)))]);
    t.title = `${t.title} (rotation)`;
    t.rotation = true;
    return t;
  }
  /** Rotation: your first 3 healthy Pokémon take turns; one free rotation per turn. */
  const pkmRotationPool = (b) => b.roster.filter((r) => pkmRosterHP(r).hp > 0).slice(0, 3);
  async function pkmRotate(b) {
    if (!b || !b.trainer || !b.trainer.rotation || b.busy || b.over || b.rotated || b.awaitSwitch || b.awaitRevive) return;
    const pool = pkmRotationPool(b);
    const i = pool.findIndex((r) => r.mon === b.me);
    const next = pool[(i + 1) % pool.length];
    if (!next || next.mon === b.me) return;
    b.busy = true;
    await pkmDoSwitch(b, next.id);
    b.busy = false;
    b.rotated = true;
    if (pkmAlive(b)) drawBattle(`${b.me.display} rotated to the front! What will it do?`);
  }
  {
    const tn = pkmTurn;
    pkmTurn = async function () {
      // The free rotation comes back at the start of each turn, so the end-of-turn screen shows it again
      if (pkb && !pkb.busy) pkb.rotated = false;
      return tn.apply(this, arguments);
    };
  }

  // ---------- Battle screen: rotation button, hardcore Nuzlocke (no items) ----------
  const pkmNuzRule = (k) => pkmNuzOn() && GM_getValue(`pkm_nuz_${k}`, "false") === "true";
  {
    const db = drawBattle;
    drawBattle = function () {
      const r = db.apply(this, arguments);
      const b = pkb;
      if (!b || !battlePanel) return r;
      const ctl = battlePanel.querySelector(".pk-controls");
      if (ctl && !b.double && b.trainer && b.trainer.rotation && !b.busy && !b.over && !b.awaitSwitch && !b.awaitRevive && !b.choosing && pkmRotationPool(b).length > 1 && !ctl.querySelector("[data-rot]")) {
        ctl.insertAdjacentHTML("beforeend", `<button type="button" class="pk-btn pkb-act" data-rot="1" ${b.rotated ? "disabled" : ""} title="Rotate to your next Pokémon for free (once per turn)"><div class="pk-ico">🔁</div><div class="pk-label">Rotate</div></button>`);
        ctl.querySelector("[data-rot]").onclick = (e) => { e.stopPropagation(); pkmRotate(b); };
      }
      if (ctl && pkmNuzRule("noitems") && !(b.trainer && b.trainer.pvp)) {
        ctl.querySelectorAll('[data-act="items"],[data-act="revive"],[data-dact="potion"],[data-dact="revive"],[data-item]').forEach((x) => { x.disabled = true; x.title = "Hardcore Nuzlocke: no items in battle"; });
      }
      return r;
    };
  }

  // ---------- Hardcore Nuzlocke: level cap at the next Gym Leader's level ----------
  {
    const gx = pkmGiveXP;
    pkmGiveXP = async function (b, mon, xp, quiet) {
      if (pkmNuzRule("lvcap") && mon && pkmMine(b || pkb || {}, mon)) {
        const cap = pkmAreaLevel();
        if (mon.level >= cap) {
          if (b && !b.capSaid) { b.capSaid = true; await pkmSay(b, `Level cap: ${mon.display} can't grow past Lv ${cap} until you beat the next Gym Leader.`, 1000); }
          return;
        }
      }
      return gx.apply(this, arguments);
    };
  }

  // ---------- Gender sprites (female forms like Pikachu's heart tail) ----------
  const PKM_FEMALE_SPR = new Set([3, 12, 19, 20, 25, 26, 41, 42, 44, 45, 64, 65, 84, 85, 97, 111, 112, 118, 119, 123, 129, 130, 133, 154, 165, 166, 178, 185, 186, 190, 194, 195, 198, 202, 203, 207, 208, 212, 214, 215, 217, 221, 224, 229, 232, 255, 256, 257, 267, 269, 272, 274, 275, 307, 308, 315, 316, 317, 322, 323, 332, 350, 369, 396, 397, 398, 399, 400, 401, 402, 403, 404, 405, 407, 415, 417, 418, 419, 424, 443, 444, 445, 449, 450, 453, 454, 456, 457, 459, 460, 461, 464, 465, 473, 521, 592, 593, 668, 678, 876]);
  function pkmFemaleSprites(m) {
    if (!m || m.gender !== "female" || !PKM_FEMALE_SPR.has(m.dexId) || m.costume) return;
    const sh = m.shiny ? "shiny/" : "";
    m.front = `${PKM_SPRITES}${sh}female/${m.dexId}.png`;
    m.back = `${PKM_SPRITES}back/${sh}female/${m.dexId}.png`;
  }
  {
    const bi = pkmBuildInstance;
    pkmBuildInstance = async function (id) {
      const m = await bi.apply(this, arguments);
      if (!m) return m;
      m.gender = pkmGenderOf(id);
      pkmFemaleSprites(m);
      // Gigantamax needs the Gigantamax Factor (from Max Raids). Pokémon you had before 4.1 keep it.
      const s = (getObj(STORAGE.stats) || {})[id] || {};
      if (m.gmaxForm && !s.gmax && !s.gmaxLegacy) m.gmaxForm = null;
      return m;
    };
    const pw = pkmPickWild;
    pkmPickWild = async function () {
      const m = await pw.apply(this, arguments);
      if (m && !m.gender) { m.gender = pkmRollGender(m.name, `${Date.now()}-${Math.random()}`); if (!m.gmaxBoss) pkmFemaleSprites(m); }
      return m;
    };
  }

  // ---------- Gigantamax Factor ----------
  try {
    if (GM_getValue("pkm_gmax_migrated", "") !== "1") {
      const all = getObj(STORAGE.stats) || {};
      const party = getObj(STORAGE.party) || {};
      let changed = false;
      for (const id of Object.keys(party)) if (all[id] && typeof all[id] === "object") { all[id].gmaxLegacy = true; changed = true; }
      if (changed) setObj(STORAGE.stats, all);
      GM_setValue("pkm_gmax_migrated", "1");
    }
  } catch (e) { console.warn("G-Max migration skipped:", e); }
  // ---------- Shiny odds that grow as you catch more of a species ----------
  const PKM_SHINY_STEPS = [[100, 4], [50, 3], [25, 2], [10, 1.5]];
  function pkmSpeciesCaught(name) {
    const n = String(name || "").toLowerCase();
    const rec = pkmJSON("pkm_species_caught", {});
    if (rec[n] == null) rec[n] = Object.values(getObj(STORAGE.party) || {}).filter((p) => String(p.name).toLowerCase() === n).length;
    return rec[n];
  }
  const pkmShinyBonus = (name) => { const c = pkmSpeciesCaught(name); const s = PKM_SHINY_STEPS.find(([k]) => c >= k); return s ? s[1] : 1; };
  {
    const mf = pkmMonFromData;
    pkmMonFromData = function (d, level, opt = {}) {
      if (opt.shiny == null && d && d.name) opt = { ...opt, shinyMult: (opt.shinyMult || 1) * pkmShinyBonus(d.name) };
      return mf.call(this, d, level, opt);
    };
    const sc = pkmStoreCaught;
    pkmStoreCaught = function (f, source) {
      const id = sc.apply(this, arguments);
      try {
        if (f && f.gmaxBoss) { const all = getObj(STORAGE.stats) || {}; if (all[id]) { all[id].gmax = true; setObj(STORAGE.stats, all); } }
        if (f && f.name && source !== "test") {
          const n = String(f.name).toLowerCase();
          const before = pkmShinyBonus(n);
          const rec = pkmJSON("pkm_species_caught", {});
          rec[n] = pkmSpeciesCaught(n) + 1;
          pkmSave("pkm_species_caught", rec);
          const after = pkmShinyBonus(n);
          if (after > before) setTimeout(() => pkmToast(`✨ You've caught ${rec[n]} ${pkmCap(n)}. Shiny ${pkmCap(n)} are now x${after} as likely!`, 5000), 900);
        }
      } catch (e) { console.warn(e); }
      return id;
    };
    const bt = pkmBagTraits;
    pkmBagTraits = function (id, mon, st) {
      let h = bt.apply(this, arguments);
      const extra = [];
      if (st && (st.gmax || st.gmaxLegacy) && PKM_GMAX[String(mon.name).toLowerCase()]) extra.push(`<span title="Can Gigantamax with the Dynamax Band">⚡ G-Max Factor</span>`);
      const sb = pkmShinyBonus(mon.name);
      if (sb > 1) extra.push(`<span title="Shiny odds for this species, from how many you've caught">✨ x${sb} shiny odds</span>`);
      if (extra.length) h = h.replace('<div class="bag-traits">', `<div class="bag-traits">${extra.join("")}`);
      return h;
    };
  }

  // ---------- Nuzlocke panel: rules and graveyard ----------
  let pkmNuzPanel = null;
  let pkmNuzAsk = 0;
  function pkmCloseNuzlocke() { if (pkmNuzPanel) pkmNuzPanel.remove(); pkmNuzPanel = null; }
  function pkmOpenNuzlocke() {
    if (!pkmNuzPanel) pkmNuzPanel = pkmMakePanel("pkm-nuz", "Nuzlocke", (e) => {
      const a = e.target.closest("[data-a]")?.dataset.a;
      const rule = e.target.closest("[data-rule]")?.dataset.rule;
      if (a === "close") return pkmCloseNuzlocke();
      if (a === "toggle") {
        if (pkmNuzOn()) { GM_setValue("pkm_nuzlocke", "false"); return pkmOpenNuzlocke(); }
        if (Date.now() - pkmNuzAsk > 4000) { pkmNuzAsk = Date.now(); return pkmToast("Fainted Pokémon will be released for good. Press again to turn Nuzlocke on.", 4500); }
        GM_setValue("pkm_nuzlocke", "true"); pkmSave("pkm_nuz_zones", {});
        return pkmOpenNuzlocke();
      }
      if (rule) { const k = `pkm_nuz_${rule}`; GM_setValue(k, GM_getValue(k, "false") === "true" ? "false" : "true"); return pkmOpenNuzlocke(); }
      if (a === "clear") { pkmSave("pkm_nuz_lost", []); return pkmOpenNuzlocke(); }
    });
    const on = pkmNuzOn();
    const grave = pkmJSON("pkm_nuz_lost", []).slice().reverse();
    const used = Object.keys(pkmJSON("pkm_nuz_zones", {})).length;
    const dexArr = getArr(STORAGE.pokedex) || [];
    const ruleBtn = (k, label, desc) => { const v = GM_getValue(`pkm_nuz_${k}`, "false") === "true"; return `<div class="nz-rule"><div><b>${label}</b><div class="pkm-dim">${desc}</div></div><button type="button" class="pkm-btn2 ${v ? "primary" : ""}" data-rule="${k}" aria-pressed="${v}">${v ? "On" : "Off"}</button></div>`; };
    pkmNuzPanel.innerHTML = `${pkmPanelHead("🪦 Nuzlocke", "nz-head")}<div class="lk-body">
      <div class="pkm-dim">Only your first wild encounter in each map place can be caught, and Pokémon that faint are released after the battle (your last Pokémon is always kept).</div>
      <div class="pkm-btns"><button type="button" class="pkm-btn2 ${on ? "danger" : "primary"}" data-a="toggle">${on ? "Turn Nuzlocke off" : "Turn Nuzlocke on…"}</button><span class="pkm-dim">${on ? `On · ${used} place${used === 1 ? "" : "s"} used` : "Off"}</span></div>
      <div class="bag-sec"><span>Hardcore rules</span><span class="pkm-dim">only while Nuzlocke is on</span></div>
      ${ruleBtn("noitems", "No items in battle", "Potions, Revives and X items can't be used in battle.")}
      ${ruleBtn("lvcap", "Level cap", `Your Pokémon stop gaining XP at the next Gym Leader's level (Lv ${pkmAreaLevel()} now).`)}
      <div class="bag-sec"><span>Graveyard</span><span class="pkm-dim">${grave.length}</span></div>
      ${grave.length ? `<div class="nz-grave">${grave.map((g) => `<div class="nz-stone" title="${pkmEsc(pkmCap(g.n))} · ${new Date(g.t).toLocaleDateString()}"><img src="${pkmEsc(pkmMonSprite({ name: g.n }, dexArr))}" alt=""><b>${pkmEsc(pkmCap(g.n))}</b><span class="pkm-dim">${new Date(g.t).toLocaleDateString()}</span></div>`).join("")}</div>
        <div class="pkm-btns"><button type="button" class="pkm-btn2" data-a="clear">Clear the graveyard</button></div>` : `<div class="pkm-dim">Nobody has been lost. Keep it that way.</div>`}</div>`;
  }

  // ---------- Trainer card: Ribbons tab ----------
  {
    const ob = pkmOpenBadges;
    pkmOpenBadges = function (tab) {
      const r = ob.apply(this, arguments);
      const P = pkmBadgesPanel;
      if (!P) return r;
      const tabs = P.querySelector(".bag-tabs");
      const party = getObj(STORAGE.party) || {};
      const st = getObj(STORAGE.stats) || {};
      const owners = Object.keys(party).filter((id) => (st[id] && st[id].ribbons || []).length);
      const total = owners.reduce((n, id) => n + st[id].ribbons.length, 0);
      if (tabs && !tabs.querySelector('[data-tab="ribbons"]')) tabs.insertAdjacentHTML("beforeend", `<button type="button" role="tab" data-tab="ribbons" aria-selected="${pkmBadgesTab === "ribbons"}">Ribbons <span class="bag-count">${total}</span></button>`);
      if (pkmBadgesTab === "ribbons") {
        tabs && tabs.querySelectorAll("[data-tab]").forEach((t) => t.setAttribute("aria-selected", String(t.dataset.tab === "ribbons")));
        const dexArr = getArr(STORAGE.pokedex) || [];
        const body = P.querySelector(".bc-body");
        if (body) body.innerHTML = owners.length
          ? `<div class="pkm-dim" style="margin-bottom:8px">Win 1st place in a Contest to earn a ribbon for that Pokémon.</div><div class="rb-list">${owners.map((id) => `<div class="rb-mon"><img src="${pkmEsc(pkmMonSprite(party[id], dexArr))}" alt=""><div><b>${pkmEsc(pkmCap(party[id].name))}</b> <span class="pkm-dim">Lv ${st[id].level || 1}</span>
              <div class="rb-ribbons">${st[id].ribbons.map((x) => `<span class="rb-r" title="${pkmEsc(x)} Ribbon">🎀 ${pkmEsc(x)}</span>`).join("")}</div></div></div>`).join("")}</div>`
          : `<div class="pkm-dim" style="text-align:center;padding:30px">No ribbons yet. Win 1st place in a 🎀 Contest to earn one.</div>`;
      }
      return r;
    };
  }

  // ---------- Save codes (copy your whole save as text, restore it anywhere) ----------
  async function pkmGz(bytes, mode) {
    const s = new Blob([bytes]).stream().pipeThrough(mode === "c" ? new CompressionStream("gzip") : new DecompressionStream("gzip"));
    return new Uint8Array(await new Response(s).arrayBuffer());
  }
  const pkmB64 = (u8) => { let s = ""; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
  const pkmUnB64 = (t) => Uint8Array.from(atob(t), (c) => c.charCodeAt(0));
  async function pkmMakeSaveCode() {
    const raw = new TextEncoder().encode(JSON.stringify({ v: 1, t: Date.now(), data: pkmCollectSave() }));
    if (typeof CompressionStream === "function") return `PKS1.${pkmB64(await pkmGz(raw, "c"))}`;
    return `PKS0.${pkmB64(raw)}`;
  }
  async function pkmReadSaveCode(code) {
    const c = String(code || "").replace(/\s+/g, "");
    const m = /^PKS([01])\.([A-Za-z0-9+/=]+)$/.exec(c);
    if (!m) throw new Error("That doesn't look like a save code (it should start with PKS1.).");
    let bytes = pkmUnB64(m[2]);
    if (m[1] === "1") bytes = await pkmGz(bytes, "d");
    const obj = JSON.parse(new TextDecoder().decode(bytes));
    if (!obj || typeof obj.data !== "object" || !obj.data) throw new Error("The save code is damaged.");
    for (const k of Object.keys(obj.data)) if (!pkmIsSaveKey(k)) delete obj.data[k];
    return obj;
  }
  let pkmSaveCodePanel = null;
  function pkmCloseSaveCode() { if (pkmSaveCodePanel) pkmSaveCodePanel.remove(); pkmSaveCodePanel = null; }
  function pkmOpenSaveCode() {
    if (!pkmSaveCodePanel) pkmSaveCodePanel = pkmMakePanel("pkm-savecode", "Save code", async (e) => {
      const a = e.target.closest("[data-a]")?.dataset.a;
      const P = pkmSaveCodePanel;
      if (a === "close") return pkmCloseSaveCode();
      if (a === "make") {
        const out = P.querySelector(".sc-out");
        out.value = "Making your code…";
        try { out.value = await pkmMakeSaveCode(); P.querySelector(".sc-len").textContent = `${out.value.length.toLocaleString()} characters`; out.select(); } catch (err) { out.value = ""; pkmToast("Couldn't make a save code."); console.warn(err); }
      }
      if (a === "copy") {
        const out = P.querySelector(".sc-out");
        if (!out.value.startsWith("PKS")) return pkmToast("Make a code first.");
        try { await navigator.clipboard.writeText(out.value); pkmToast("Save code copied. Keep it somewhere safe."); } catch { out.select(); pkmToast("Press Ctrl+C to copy the selected code."); }
      }
      if (a === "restore") {
        try {
          const obj = await pkmReadSaveCode(P.querySelector(".sc-in").value);
          pkmBackupNow("before save code");
          pkmCloseSaveCode();
          pkmPreviewSave(obj.data, `Save code from ${new Date(obj.t).toLocaleString()}`);
        } catch (err) { pkmToast(err.message || "That save code didn't work.", 4000); }
      }
    });
    pkmSaveCodePanel.innerHTML = `${pkmPanelHead("💾 Save code", "sc-head")}<div class="lk-body">
      <div class="pkm-dim">A save code is your whole game as text. Paste it on another computer or browser to carry on there, or keep it as a backup. Anyone with the code can load your save, so don't post it publicly.</div>
      <div class="bag-sec"><span>Your code</span><span class="pkm-dim sc-len"></span></div>
      <textarea class="sc-out" readonly rows="4" aria-label="Your save code" placeholder="Press Make my code"></textarea>
      <div class="pkm-btns"><button type="button" class="pkm-btn2 primary" data-a="make">Make my code</button><button type="button" class="pkm-btn2" data-a="copy">📋 Copy</button></div>
      <div class="bag-sec"><span>Restore from a code</span></div>
      <textarea class="sc-in" rows="4" aria-label="Paste a save code" placeholder="Paste a code that starts with PKS1."></textarea>
      <div class="pkm-btns"><button type="button" class="pkm-btn2 danger" data-a="restore">Check and restore</button></div>
      <div class="pkm-dim">You'll see what's in the code before anything changes, and your current save is backed up first (Settings → Backups).</div></div>`;
  }

  // ---------- Bag: select many Pokémon to release ----------
  pkmBag.multi = false;
  pkmBag.pick = new Set();
  {
    const dbg = drawBag;
    drawBag = function () {
      const r = dbg.apply(this, arguments);
      if (!bagPanel || pkmBag.tab !== "pokemon") return r;
      const tools = bagPanel.querySelector(".bag-tools");
      const active = GM_getValue("pkm_starter_id");
      if (tools && !tools.querySelector("[data-multi]")) tools.insertAdjacentHTML("afterbegin", `<button type="button" class="pkm-btn2 ${pkmBag.multi ? "primary" : ""}" data-multi="1" title="Pick many Pokémon to release at once">${pkmBag.multi ? "✓ Selecting" : "☑ Select many"}</button>`);
      if (pkmBag.multi) {
        bagPanel.querySelectorAll(".bag-slot[data-id]").forEach((s) => { if (pkmBag.pick.has(s.dataset.id)) s.classList.add("picked"); if (s.dataset.id === active) s.classList.add("nopick"); });
        const det = bagPanel.querySelector(".bag-detail");
        const n = pkmBag.pick.size;
        const html = `<div class="bag-detail bag-multi"><div><b>${n} selected</b><div class="pkm-dim">Click Pokémon to pick them. Your active partner can't be released. Held items go back to your Bag.</div></div>
          <div class="pkm-btns"><button type="button" class="pkm-btn2 danger" data-mr="release" ${n ? "" : "disabled"}>${pkmBag.multiAsk ? `Sure? Release ${n} for good` : `Release ${n || ""}`}</button><button type="button" class="pkm-btn2" data-mr="clear" ${n ? "" : "disabled"}>Clear</button><button type="button" class="pkm-btn2" data-mr="done">Done</button></div></div>`;
        if (det) det.outerHTML = html;
      }
      const orig = bagPanel.onclick;
      bagPanel.onclick = (e) => {
        if (e.target.closest("[data-multi]")) { pkmBag.multi = !pkmBag.multi; pkmBag.pick = new Set(); pkmBag.multiAsk = false; return drawBag(); }
        if (pkmBag.multi) {
          const mr = e.target.closest("[data-mr]")?.dataset.mr;
          if (mr === "done") { pkmBag.multi = false; pkmBag.pick = new Set(); pkmBag.multiAsk = false; return drawBag(); }
          if (mr === "clear") { pkmBag.pick = new Set(); pkmBag.multiAsk = false; return drawBag(); }
          if (mr === "release") {
            if (!pkmBag.multiAsk) { pkmBag.multiAsk = true; return drawBag(); }
            const party = getObj(STORAGE.party) || {}; const st = getObj(STORAGE.stats) || {};
            let n = 0;
            for (const id of pkmBag.pick) {
              if (id === active || !party[id] || Object.keys(party).length <= 1) continue;
              if (party[id].held) setInt(`pkm_item_${party[id].held}`, getInt(`pkm_item_${party[id].held}`) + 1);
              delete party[id]; delete st[id]; n++;
            }
            setObj(STORAGE.party, party); setObj(STORAGE.stats, st);
            pkmBag.pick = new Set(); pkmBag.multiAsk = false; pkmBag.sel = null;
            pkmToast(`Released ${n} Pokémon.`);
            return drawBag();
          }
          const slot = e.target.closest(".bag-slot[data-id]");
          if (slot) {
            const id = slot.dataset.id;
            if (id === active) return pkmToast("Your active partner can't be released.");
            pkmBag.pick.has(id) ? pkmBag.pick.delete(id) : pkmBag.pick.add(id);
            pkmBag.multiAsk = false;
            return drawBag();
          }
        }
        return orig && orig.call(bagPanel, e);
      };
      return r;
    };
  }

  // ---------- Panels ----------
  PKM_PANELS.push(["nuzlocke", () => pkmNuzPanel, () => pkmCloseNuzlocke()], ["savecode", () => pkmSaveCodePanel, () => pkmCloseSaveCode()]);
  pkmOpenNuzlocke = pkmExclusive("nuzlocke", pkmOpenNuzlocke);
  pkmOpenSaveCode = pkmExclusive("savecode", pkmOpenSaveCode);

  pkmStyle(`
    .pkm-upd-banner{position:fixed;left:50%;top:10px;transform:translateX(-50%);z-index:10010;display:flex;gap:8px;align-items:center;flex-wrap:wrap;max-width:min(640px,94vw);
      background:rgba(17,20,33,.97);color:#e8eaf6;border:1px solid rgba(47,191,113,.6);border-radius:12px;padding:8px 10px;box-shadow:0 10px 30px rgba(0,0,0,.45);font:13px system-ui,sans-serif}
    .pkm-upd-banner .pkm-x{position:static!important}
    .pkm-launcher.has-upd::after{content:"";position:absolute;right:4px;top:4px;width:9px;height:9px;border-radius:50%;background:#2fbf71;box-shadow:0 0 0 2px #111421}
    .op-upd{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;padding:10px;border-radius:12px;background:rgba(47,191,113,.12);border:1px solid rgba(47,191,113,.35);margin-bottom:10px}
    .pkm-set.pkm-nuz,.pkm-set.pkm-savecode{width:min(620px,96vw);max-height:92vh;overflow:auto}
    .nz-head{background:linear-gradient(90deg,#5a5a6a,#2a2a3a)!important}.sc-head{background:linear-gradient(90deg,#3a6aa0,#1a3a6a)!important}
    .nz-rule{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid rgba(127,127,127,.15)}
    .nz-grave{display:grid;grid-template-columns:repeat(auto-fill,minmax(96px,1fr));gap:6px}
    .nz-stone{display:flex;flex-direction:column;align-items:center;padding:6px;border-radius:10px 10px 4px 4px;background:rgba(127,127,127,.15);filter:grayscale(1);font-size:12px}
    .nz-stone img{width:56px;height:56px;image-rendering:pixelated}
    .pkm-savecode textarea{width:100%;box-sizing:border-box;font:11px ui-monospace,monospace;border-radius:8px;padding:6px;resize:vertical}
    .rb-list{display:grid;gap:8px}.rb-mon{display:flex;gap:8px;align-items:center}.rb-mon img{width:56px;height:56px;image-rendering:pixelated}
    .rb-ribbons{display:flex;flex-wrap:wrap;gap:4px;margin-top:3px}.rb-r{font-size:11.5px;padding:2px 7px;border-radius:999px;background:rgba(255,105,180,.18);border:1px solid rgba(255,105,180,.4)}
    .bag-slot.picked{outline:3px solid #ff4d4f;outline-offset:-3px}.bag-slot.picked::after{content:"✓";position:absolute;right:4px;bottom:4px;background:#ff4d4f;color:#fff;border-radius:50%;width:18px;height:18px;display:grid;place-items:center;font-size:12px}
    .bag-slot.nopick{opacity:.6}
    .bag-multi{display:flex!important;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap}
  `, "pkm-v41");
  // =====================================================================
  //  4.2: online GTS trades, Pokémon Home and Wonder Trade (server at
  //  dstokesncstudio.com/poke/api/), Pokémon Camp, Hidden Grottos and
  //  hordes, Ultra Wormholes, villain teams, species progress, day/night
  //  tint, move animations, Gym puzzles and trainer looks
  // =====================================================================

  // ---------- Server connection ----------
  const PKM_SERVER_DEFAULT = "https://dstokesncstudio.com/poke/api/";
  const pkmServerUrl = () => { const u = String(GM_getValue("pkm_server_url", "") || "").trim(); return /^https?:\/\//.test(u) ? (u.endsWith("/") ? u : `${u}/`) : PKM_SERVER_DEFAULT; };
  const pkmOnline = () => pkmJSON("pkm_online", null);
  /** One API call: POST JSON to <server>?a=<action>. Resolves with the reply, rejects with a readable message. */
  function pkmApi(a, data = {}, acctOverride) {
    const acct = acctOverride || pkmOnline() || {};
    const body = JSON.stringify({ ...data, pid: acct.pid, sec: acct.sec });
    return new Promise((resolve, reject) => {
      const fail = (m) => reject(new Error(m));
      try {
        GM_xmlhttpRequest({
          method: "POST",
          url: `${pkmServerUrl()}?a=${encodeURIComponent(a)}`,
          headers: { "Content-Type": "application/json" },
          data: body,
          timeout: 15000,
          responseType: "text",
          onload: (r) => {
            let j = null;
            try { j = JSON.parse(r.responseText); } catch {}
            if (!j) return fail(r.status === 404 ? "The game server isn't set up yet." : `The server answered with an error (${r.status}).`);
            if (!j.ok) { if (r.status === 401 && /not found/i.test(j.error || "")) GM_deleteValue("pkm_online"); return fail(j.error || "Server error."); }
            resolve(j);
          },
          onerror: () => fail("Couldn't reach the game server. It may be offline."),
          ontimeout: () => fail("The game server took too long to answer."),
        });
      } catch (e) { fail("Couldn't reach the game server."); }
    });
  }
  async function pkmOnlineLogin() {
    if (pkmOnline()) return pkmOnline();
    const r = await pkmApi("register", { name: pkmTrainerName() });
    const acct = { pid: r.pid, sec: r.sec, name: r.name };
    pkmSave("pkm_online", acct);
    return acct;
  }
  const pkmLinkCode = () => { const a = pkmOnline(); return a ? `PKH1.${a.pid}.${a.sec}` : ""; };
  async function pkmUseLinkCode(code) {
    const m = /^PKH1\.(\d{1,10})\.([a-f0-9]{64})$/.exec(String(code || "").trim());
    if (!m) throw new Error("That isn't an account link code (it starts with PKH1.).");
    const old = pkmOnline();
    pkmSave("pkm_online", { pid: +m[1], sec: m[2] });
    try { const r = await pkmApi("me"); pkmSave("pkm_online", { pid: r.pid, sec: m[2], name: r.name }); return r; } catch (e) { pkmSave("pkm_online", old); throw e; }
  }

  // ---------- Moving Pokémon in and out of the Bag ----------
  /** A Pokémon packed for the server (no held item), or an error message. */
  function pkmPackForSend(id) {
    const party = getObj(STORAGE.party) || {};
    if (!party[id]) return { err: "That Pokémon isn't in your Bag." };
    if (id === GM_getValue("pkm_starter_id")) return { err: "Your active partner can't leave. Pick another partner first." };
    if (Object.keys(party).length <= 1) return { err: "You can't send away your last Pokémon." };
    const mon = pkmMonShare(id);
    mon.h = "";
    mon.g = pkmGenderOf(id);
    return { mon };
  }
  function pkmRemoveMon(id) {
    const party = getObj(STORAGE.party) || {};
    const st = getObj(STORAGE.stats) || {};
    if (party[id] && party[id].held) setInt(`pkm_item_${party[id].held}`, getInt(`pkm_item_${party[id].held}`) + 1);
    delete party[id]; delete st[id];
    setObj(STORAGE.party, party); setObj(STORAGE.stats, st);
  }
  /** Adds a Pokémon that came from the server (checked again here) and returns its id. */
  async function pkmReceiveMon(x, source = "trade") {
    const m = pkmCleanShare(x);
    if (!m) throw new Error("The Pokémon that came back wasn't valid.");
    const id = await pkmAddShared({ ...m, held: null });
    if (!id) throw new Error("Couldn't load that Pokémon from PokéAPI. Try again.");
    const all = getObj(STORAGE.stats) || {};
    if (all[id] && ["male", "female", "none"].includes(x.g)) { all[id].gender = x.g; setObj(STORAGE.stats, all); }
    const party = getObj(STORAGE.party) || {};
    if (party[id] && source !== "trade") { party[id].origin = source; setObj(STORAGE.party, party); }
    return id;
  }
  /** Pokémon that arrive are saved in an inbox first, so a PokéAPI hiccup can't lose them. */
  async function pkmInboxFlush() {
    const q = pkmJSON("pkm_online_inbox", []);
    if (!q.length) return 0;
    const left = [];
    for (const it of q) { try { await pkmReceiveMon(it.mon, it.source); } catch { left.push(it); } }
    pkmSave("pkm_online_inbox", left);
    return q.length - left.length;
  }
  async function pkmDeliver(mon, source) {
    const q = pkmJSON("pkm_online_inbox", []);
    q.push({ mon, source, t: Date.now() });
    pkmSave("pkm_online_inbox", q);
    await pkmInboxFlush();
    if (pkmJSON("pkm_online_inbox", []).length) throw new Error("Your new Pokémon is safe and will arrive the next time you open 🌐 Online (PokéAPI didn't answer).");
  }
  const pkmShareLabel = (m) => `${pkmCap(m.s)}${m.x ? " ✨" : ""} Lv ${m.l}${m.g === "female" ? " ♀" : m.g === "male" ? " ♂" : ""}`;
  const pkmShareSprite = (m) => { const id = pkmDexId(m.s); return id ? `${PKM_SPRITES}${m.x ? "shiny/" : ""}${id}.png` : `${PKM_ITEM_IMG}poke-ball.png`; };
  /** <option>s for every Pokémon you could send (not the active partner). */
  function pkmSendOptions(filter) {
    const party = getObj(STORAGE.party) || {};
    const st = getObj(STORAGE.stats) || {};
    const active = GM_getValue("pkm_starter_id");
    return Object.entries(party).filter(([id, p]) => id !== active && (!filter || String(p.name).toLowerCase() === filter))
      .map(([id, p]) => `<option value="${pkmEsc(id)}">${pkmEsc(pkmCap(p.name))}${p.isShiny ? " ✨" : ""} (Lv ${(st[id] || {}).level || 1})</option>`).join("");
  }

  // ---------- Wonder Trade: offline list (used when the server can't be reached) ----------
  const PKM_WONDER_LOCAL = ["pikachu", "eevee", "magikarp", "bulbasaur", "charmander", "squirtle", "chikorita", "cyndaquil", "totodile", "treecko", "torchic", "mudkip", "turtwig", "chimchar", "piplup", "snivy", "tepig", "oshawott",
    "chespin", "fennekin", "froakie", "rowlet", "litten", "popplio", "grookey", "scorbunny", "sobble", "dratini", "larvitar", "bagon", "beldum", "gible", "axew", "deino", "goomy", "jangmo-o", "dreepy", "riolu", "ralts", "abra",
    "gastly", "machop", "geodude", "growlithe", "vulpix", "ponyta", "slowpoke", "onix", "scyther", "lapras", "snorlax", "togepi", "mareep", "wooper", "sneasel", "houndour", "phanpy", "aron", "shroomish", "trapinch", "swablu",
    "feebas", "absol", "spheal", "shinx", "buneary", "zorua", "litwick", "rockruff", "sandshrew", "applin", "rookidee", "yamper", "sprigatito", "fuecoco", "quaxly", "tinkatink"];
  async function pkmWonderLocal(sent) {
    const sp = pkmPick(PKM_WONDER_LOCAL);
    const lv = pkmClamp(sent.l + pkmRand(-4, 4), 1, MAX_LEVEL);
    return { s: sp, l: lv, i: pkmRand(5, 31), n: pkmPick(Object.keys(PKM_NATURES)), a: "", m: [], h: "", x: Math.random() < 1 / 64 ? 1 : 0, g: "" };
  }

  // ---------- Online panel: GTS, Home, Wonder Trade ----------
  let pkmOnlinePanel = null;
  let pkmOnlineTab = "gts";
  let pkmOnlineData = { gts: null, mine: null, home: null, wonder: null, err: "" };
  let pkmOnlineSearch = "";
  function pkmCloseOnline() { if (pkmOnlinePanel) pkmOnlinePanel.remove(); pkmOnlinePanel = null; }
  async function pkmOnlineRefresh() {
    pkmOnlineData.err = "";
    try {
      if (!pkmOnline()) return;
      if (pkmOnlineTab === "gts") {
        const [a, b] = await Promise.all([pkmApi("trade_list", { species: pkmOnlineSearch }), pkmApi("trade_mine")]);
        pkmOnlineData.gts = a.trades; pkmOnlineData.mine = b.trades;
      } else if (pkmOnlineTab === "home") {
        pkmOnlineData.home = await pkmApi("home_list");
      } else {
        pkmOnlineData.wonder = (await pkmApi("wonder_mine")).wonder;
      }
    } catch (e) { pkmOnlineData.err = e.message; }
  }
  const pkmShareCard = (m, extra = "") => `<div class="ol-card"><img src="${pkmEsc(pkmShareSprite(m))}" alt="" loading="lazy"><div class="ol-main"><b>${pkmEsc(pkmShareLabel(m))}</b>${extra}</div></div>`;
  function pkmDrawOnline() {
    const P = pkmOnlinePanel;
    if (!P) return;
    const acct = pkmOnline();
    const d = pkmOnlineData;
    const tab = (k, l) => `<button type="button" role="tab" data-otab="${k}" aria-selected="${pkmOnlineTab === k}">${l}</button>`;
    let body = "";
    if (!acct) {
      body = `<div class="pkm-dim">Trade with players everywhere, keep Pokémon in your Home box and use them in another browser, and send Pokémon to Wonder Trade. Your trainer name (${pkmEsc(pkmTrainerName())}) is shown to other players.</div>
        <div class="pkm-btns"><button type="button" class="pkm-btn2 primary" data-a="login">🌐 Connect to the game server</button></div>
        <div class="bag-sec"><span>Already have an account in another browser?</span></div>
        <div class="pkm-btns"><input class="ol-link" placeholder="Paste a PKH1. link code" aria-label="Account link code"><button type="button" class="pkm-btn2" data-a="uselink">Use this account</button></div>
        <div class="pkm-dim">Wonder Trade also works without the server: you'll get a random Pokémon from a list instead of from another player.</div>`;
    } else if (pkmOnlineTab === "gts") {
      const opts = pkmSendOptions();
      body = `<div class="bag-sec"><span>Offer a Pokémon</span></div>
        <div class="pkm-btns"><select class="ol-give" aria-label="Pokémon to offer">${opts || `<option value="">No Pokémon to offer</option>`}</select><input class="ol-want" placeholder="Want (optional, e.g. eevee)" aria-label="Pokémon you want" maxlength="40"><button type="button" class="pkm-btn2 primary" data-a="offer" ${opts ? "" : "disabled"}>Put on the GTS</button></div>
        ${(d.mine || []).length ? `<div class="bag-sec"><span>Your offers</span></div>${d.mine.map((t) => pkmShareCard(t.mon, t.status === "done" ? `<div class="ol-done">✅ Traded to ${pkmEsc(t.taker || "a trainer")} for ${pkmEsc(pkmShareLabel(t.got || { s: "?", l: 1 }))}</div><button type="button" class="pkm-btn2 primary" data-claim="${t.id}">Collect</button>` : `<div class="pkm-dim">${t.want ? `Wants ${pkmEsc(pkmCap(t.want))}` : "Any Pokémon"} · waiting</div><button type="button" class="pkm-btn2" data-cancel="${t.id}">Take back</button>`)).join("")}` : ""}
        <div class="bag-sec"><span>Offers from other trainers</span><span class="pkm-btns"><input class="ol-search" placeholder="Find a species" value="${pkmEsc(pkmOnlineSearch)}" aria-label="Find a species"><button type="button" class="pkm-btn2" data-a="search">🔎</button></span></div>
        ${(d.gts || []).length ? d.gts.map((t) => { const mineOpts = pkmSendOptions(t.want || ""); return pkmShareCard(t.mon, `<div class="pkm-dim">From ${pkmEsc(t.owner)} · ${t.want ? `wants ${pkmEsc(pkmCap(t.want))}` : "wants any Pokémon"}</div>
            <div class="pkm-btns"><select class="ol-pay" data-for="${t.id}" aria-label="Pokémon to give">${mineOpts || `<option value="">You don't have one</option>`}</select><button type="button" class="pkm-btn2 primary" data-take="${t.id}" ${mineOpts ? "" : "disabled"}>Trade</button></div>`); }).join("") : `<div class="pkm-dim">${d.gts ? "No offers right now. Put one up and check back later." : "Loading…"}</div>`}`;
    } else if (pkmOnlineTab === "home") {
      const h = d.home || { home: [], max: 60 };
      const opts = pkmSendOptions();
      body = `<div class="pkm-dim">Pokémon in Home are kept on the server. Open the game in another browser, use your link code there, and take them out.</div>
        <div class="pkm-btns"><select class="ol-give" aria-label="Pokémon to put in Home">${opts || `<option value="">No Pokémon to move</option>`}</select><button type="button" class="pkm-btn2 primary" data-a="deposit" ${opts ? "" : "disabled"}>Move to Home</button><span class="pkm-dim">${(h.home || []).length}/${h.max}</span></div>
        ${(h.home || []).length ? `<div class="ol-grid">${h.home.map((r) => `<div class="ol-tile"><img src="${pkmEsc(pkmShareSprite(r.mon))}" alt=""><b>${pkmEsc(pkmShareLabel(r.mon))}</b><button type="button" class="pkm-btn2" data-out="${r.id}">Take out</button></div>`).join("")}</div>` : `<div class="pkm-dim">${d.home ? "Your Home box is empty." : "Loading…"}</div>`}
        <div class="bag-sec"><span>Use this account in another browser</span></div>
        <div class="pkm-btns"><input class="ol-mylink" readonly value="${pkmEsc(pkmLinkCode())}" aria-label="Your link code" style="flex:1"><button type="button" class="pkm-btn2" data-a="copylink">📋 Copy</button></div>
        <div class="pkm-dim">Keep the link code private: anyone with it can use your Home box and trades.</div>`;
    } else {
      const opts = pkmSendOptions();
      body = `<div class="pkm-dim">Send a Pokémon and get a random one back from another player. If nobody is waiting, yours waits for the next trainer and you collect your new Pokémon here later.</div>
        <div class="pkm-btns"><select class="ol-give" aria-label="Pokémon to send">${opts || `<option value="">No Pokémon to send</option>`}</select><button type="button" class="pkm-btn2 primary" data-a="wonder" ${opts ? "" : "disabled"}>🎲 Wonder Trade</button></div>
        ${(d.wonder || []).map((w) => pkmShareCard(w.mon, w.matched ? `<div class="ol-done">✅ ${pkmEsc(w.from || "A trainer")} sent you ${pkmEsc(pkmShareLabel(w.got || { s: "?", l: 1 }))}</div><button type="button" class="pkm-btn2 primary" data-wclaim="${w.id}">Collect</button>` : `<div class="pkm-dim">Waiting for a trainer…</div><button type="button" class="pkm-btn2" data-wcancel="${w.id}">Take back</button>`)).join("")}`;
    }
    P.innerHTML = `${pkmPanelHead("🌐 Online", "ol-head")}
      <div class="bag-tabs" role="tablist">${tab("gts", "🌍 GTS trades")}${tab("home", "🏠 Home box")}${tab("wonder", "🎲 Wonder Trade")}</div>
      <div class="lk-body">${acct ? `<div class="pkm-dim ol-acct">Signed in as <b>${pkmEsc(acct.name || pkmTrainerName())}</b> · <button type="button" class="pkm-btn2" data-a="refresh">🔄 Refresh</button></div>` : ""}
      ${d.err ? `<div class="bag-msg ol-err">⚠️ ${pkmEsc(d.err)}</div>` : ""}${body}</div>`;
  }
  let pkmOnlineBusy = 0;
  async function pkmOnlineDo(fn) {
    pkmOnlineBusy++;
    if (pkmOnlinePanel) pkmOnlinePanel.classList.add("busy");
    try { await fn(); } catch (e) { pkmOnlineData.err = e.message || String(e); } finally { pkmOnlineBusy--; if (pkmOnlinePanel && !pkmOnlineBusy) pkmOnlinePanel.classList.remove("busy"); }
    if (bagPanel) drawBag();
    pkmDrawOnline();
  }
  async function pkmOpenOnline(tab) {
    if (typeof tab === "string") pkmOnlineTab = tab;
    if (!pkmOnlinePanel) {
      pkmOnlinePanel = pkmMakePanel("pkm-online", "Online", (e) => {
        const P = pkmOnlinePanel;
        const g = (k) => e.target.closest(`[${k}]`);
        const a = g("data-a")?.dataset.a;
        if (a === "close") return pkmCloseOnline();
        if (g("data-otab")) { pkmOnlineTab = g("data-otab").dataset.otab; pkmDrawOnline(); return pkmOnlineDo(pkmOnlineRefresh); }
        if (a === "login") return pkmOnlineDo(async () => { await pkmOnlineLogin(); pkmToast("🌐 Connected to the game server."); await pkmOnlineRefresh(); });
        if (a === "uselink") return pkmOnlineDo(async () => { const r = await pkmUseLinkCode(P.querySelector(".ol-link").value); pkmToast(`Signed in as ${r.name}.`); await pkmOnlineRefresh(); });
        if (a === "copylink") { const i = P.querySelector(".ol-mylink"); i.select(); navigator.clipboard?.writeText(i.value).then(() => pkmToast("Link code copied."), () => pkmToast("Press Ctrl+C to copy.")); return; }
        if (a === "refresh") return pkmOnlineDo(pkmOnlineRefresh);
        if (a === "search") { pkmOnlineSearch = pkmSafeSlug(P.querySelector(".ol-search").value.trim().toLowerCase()) || ""; return pkmOnlineDo(pkmOnlineRefresh); }
        if (a === "offer") return pkmOnlineDo(async () => {
          const id = P.querySelector(".ol-give").value;
          const p = pkmPackForSend(id);
          if (p.err) throw new Error(p.err);
          const want = pkmSafeSlug(P.querySelector(".ol-want").value.trim().toLowerCase()) || "";
          await pkmApi("trade_create", { mon: p.mon, want });
          pkmRemoveMon(id);
          pkmToast(`${pkmCap(p.mon.s)} is on the GTS now. Check back to collect your trade.`, 4000);
          await pkmOnlineRefresh();
        });
        if (g("data-take")) return pkmOnlineDo(async () => {
          const tid = +g("data-take").dataset.take;
          const id = P.querySelector(`.ol-pay[data-for="${tid}"]`).value;
          const p = pkmPackForSend(id);
          if (p.err) throw new Error(p.err);
          const r = await pkmApi("trade_accept", { id: tid, mon: p.mon });
          pkmRemoveMon(id);
          await pkmDeliver(r.mon, "trade");
          pkmTrack("trades"); playSound("evolve");
          pkmToast(`🔄 You traded ${pkmCap(p.mon.s)} for ${pkmShareLabel(r.mon)}!`, 5000);
          await pkmOnlineRefresh();
        });
        if (g("data-claim")) return pkmOnlineDo(async () => {
          const r = await pkmApi("trade_claim", { id: +g("data-claim").dataset.claim });
          await pkmDeliver(r.mon, "trade");
          pkmTrack("trades"); playSound("evolve");
          pkmToast(`🔄 ${r.from || "A trainer"} traded you ${pkmShareLabel(r.mon)}!`, 5000);
          await pkmOnlineRefresh();
        });
        if (g("data-cancel")) return pkmOnlineDo(async () => { const r = await pkmApi("trade_cancel", { id: +g("data-cancel").dataset.cancel }); await pkmDeliver(r.mon, "trade"); pkmToast(`${pkmCap(r.mon.s)} came back from the GTS.`); await pkmOnlineRefresh(); });
        if (a === "deposit") return pkmOnlineDo(async () => {
          const id = P.querySelector(".ol-give").value;
          const p = pkmPackForSend(id);
          if (p.err) throw new Error(p.err);
          await pkmApi("home_deposit", { mon: p.mon });
          pkmRemoveMon(id);
          pkmToast(`${pkmCap(p.mon.s)} moved to your Home box.`);
          await pkmOnlineRefresh();
        });
        if (g("data-out")) return pkmOnlineDo(async () => { const r = await pkmApi("home_withdraw", { id: +g("data-out").dataset.out }); await pkmDeliver(r.mon, "home"); pkmToast(`${pkmShareLabel(r.mon)} came out of Home.`); await pkmOnlineRefresh(); });
        if (a === "wonder") return pkmOnlineDo(() => pkmWonderSend(P.querySelector(".ol-give").value));
        if (g("data-wclaim")) return pkmOnlineDo(async () => { const r = await pkmApi("wonder_claim", { id: +g("data-wclaim").dataset.wclaim }); await pkmDeliver(r.mon, "wonder"); pkmToast(`🎲 ${r.from || "A trainer"} sent you ${pkmShareLabel(r.mon)}!`, 5000); await pkmOnlineRefresh(); });
        if (g("data-wcancel")) return pkmOnlineDo(async () => { const r = await pkmApi("wonder_cancel", { id: +g("data-wcancel").dataset.wcancel }); await pkmDeliver(r.mon, "wonder"); await pkmOnlineRefresh(); });
      });
    }
    pkmOnlineData = { gts: null, mine: null, home: null, wonder: null, err: "" };
    pkmDrawOnline();
    await pkmOnlineDo(async () => { const n = await pkmInboxFlush(); if (n) pkmToast(`📬 ${n} Pokémon from earlier trades arrived in your Bag.`); await pkmOnlineRefresh(); });
  }
  /** Wonder Trade: through the server when signed in, otherwise from the offline list. */
  async function pkmWonderSend(id) {
    const p = pkmPackForSend(id);
    if (p.err) throw new Error(p.err);
    let r = null;
    if (pkmOnline()) {
      try { r = await pkmApi("wonder_send", { mon: p.mon }); } catch (e) { if (!/reach|too long|isn't set up/.test(e.message)) throw e; }
    }
    pkmRemoveMon(id);
    if (r && !r.matched) { pkmToast(`🎲 ${pkmCap(p.mon.s)} is waiting for a trainer. Collect your new Pokémon in Online → Wonder Trade later.`, 5000); await pkmOnlineRefresh(); return; }
    const got = r ? r.mon : await pkmWonderLocal(p.mon);
    await pkmDeliver(got, "wonder");
    pkmTrack("trades"); playSound("evolve");
    pkmToast(`🎲 Wonder Trade! You sent ${pkmCap(p.mon.s)} and got ${pkmShareLabel(got)}${r && r.from ? ` from ${r.from}` : ""}!`, 5000);
    if (pkmOnline()) await pkmOnlineRefresh();
  }
  // Tell the player once per page when an online trade is ready to collect
  setTimeout(async () => {
    if (!pkmOnline() || document.hidden) return;
    try {
      const [t, w] = await Promise.all([pkmApi("trade_mine"), pkmApi("wonder_mine")]);
      const n = t.trades.filter((x) => x.status === "done").length + w.wonder.filter((x) => x.matched).length;
      if (n) pkmToast(`🌐 ${n} online trade${n > 1 ? "s are" : " is"} ready. Open 🌐 Online to collect.`, 6000);
    } catch {}
  }, 9000);

  // ---------- Pokémon Camp (pet, feed and play to raise friendship) ----------
  let pkmCampPanel = null;
  let pkmCampSel = null;
  const PKM_CAMP_LIMITS = { pet: 10, feed: 5, play: 5 };
  const pkmCampDay = () => { const c = pkmJSON("pkm_camp", {}); return c.day === pkmDay(0) ? c : { day: pkmDay(0), n: {} }; };
  function pkmCloseCamp() { if (pkmCampPanel) pkmCampPanel.remove(); pkmCampPanel = null; }
  function pkmCampAct(id, kind) {
    const c = pkmCampDay();
    const used = (c.n[id] = c.n[id] || { pet: 0, feed: 0, play: 0 });
    if (used[kind] >= PKM_CAMP_LIMITS[kind]) return `That's enough ${kind === "pet" ? "petting" : kind === "feed" ? "treats" : "play"} for today.`;
    if (kind === "feed") { if (getInt(STORAGE.coins) < 50) return "A Poké Puff costs 50 coins."; setInt(STORAGE.coins, getInt(STORAGE.coins) - 50); }
    used[kind]++;
    pkmSave("pkm_camp", c);
    pkmFriend(id, kind === "pet" ? 1 : kind === "feed" ? 4 : 2);
    pkmTrack("campCare");
    return "";
  }
  function pkmOpenCamp() {
    if (!pkmCampPanel) pkmCampPanel = pkmMakePanel("pkm-camp", "Pokémon Camp", (e) => {
      const a = e.target.closest("[data-a]")?.dataset.a;
      const pick = e.target.closest("[data-camp]");
      if (a === "close") return pkmCloseCamp();
      if (pick) { pkmCampSel = pick.dataset.camp; return pkmOpenCamp(); }
      const act = e.target.closest("[data-care]")?.dataset.care;
      if (act && pkmCampSel) {
        const err = pkmCampAct(pkmCampSel, act);
        if (err) return pkmToast(err);
        const spr = pkmCampPanel.querySelector(".cp-big");
        pkmOpenCamp();
        const big = pkmCampPanel.querySelector(".cp-big");
        if (big && spr) { big.classList.add(act === "pet" ? "cp-wiggle" : act === "feed" ? "cp-hop" : "cp-spin"); big.insertAdjacentHTML("afterend", `<div class="cp-heart">${act === "feed" ? "🧁💕" : act === "play" ? "⚽💕" : "💕"}</div>`); }
      }
    });
    const party = getObj(STORAGE.party) || {};
    const st = getObj(STORAGE.stats) || {};
    const ids = Object.keys(party).slice(0, PKM_PARTY_SIZE);
    if (!ids.includes(pkmCampSel)) pkmCampSel = ids[0] || null;
    const dexArr = getArr(STORAGE.pokedex) || [];
    const c = pkmCampDay();
    const sel = pkmCampSel && party[pkmCampSel];
    const f = sel ? ((st[pkmCampSel] || {}).friendship == null ? 70 : st[pkmCampSel].friendship) : 0;
    const used = (pkmCampSel && c.n[pkmCampSel]) || { pet: 0, feed: 0, play: 0 };
    const hearts = Math.round((f / 255) * 5);
    pkmCampPanel.innerHTML = `${pkmPanelHead("⛺ Pokémon Camp", "cp-head")}<div class="lk-body">
      <div class="pkm-dim">Pet, feed and play with your party to raise friendship. Friendship helps some Pokémon evolve.</div>
      <div class="cp-party">${ids.map((id) => `<button type="button" class="cp-pick${id === pkmCampSel ? " on" : ""}" data-camp="${pkmEsc(id)}" aria-pressed="${id === pkmCampSel}"><img src="${pkmEsc(pkmMonSprite(party[id], dexArr))}" alt=""><span>${pkmEsc(pkmCap(party[id].name))}</span></button>`).join("")}</div>
      ${sel ? `<div class="cp-stage"><img class="cp-big" src="${pkmEsc(pkmMonSprite(sel, dexArr))}" alt="${pkmEsc(pkmCap(sel.name))}"></div>
        <div class="cp-f"><b>${pkmEsc(pkmCap(sel.name))}</b> <span title="Friendship ${f}/255">${"❤️".repeat(hearts)}${"🤍".repeat(5 - hearts)}</span> <span class="pkm-dim">${f}/255</span></div>
        <div class="pkm-btns" style="justify-content:center">
          <button type="button" class="pkm-btn2 primary" data-care="pet">✋ Pet (${PKM_CAMP_LIMITS.pet - used.pet} left)</button>
          <button type="button" class="pkm-btn2 primary" data-care="feed">🧁 Poké Puff, 50 coins (${PKM_CAMP_LIMITS.feed - used.feed} left)</button>
          <button type="button" class="pkm-btn2 primary" data-care="play">⚽ Play (${PKM_CAMP_LIMITS.play - used.play} left)</button></div>` : `<div class="pkm-dim">Choose a starter first.</div>`}</div>`;
  }

  // ---------- Hidden Grottos and hordes on map walks ----------
  let pkmHordeNext = false;
  {
    const ew = pkmExploreWalk;
    pkmExploreWalk = async function () {
      const z = pkmExploreZone;
      if (!z || battlePanel || pkmExploreBusy) return ew.apply(this, arguments);
      const forceG = GM_getValue("pkm_grotto_force", "");
      const r = Math.random();
      if (forceG === "grotto" || (!forceG && r < 0.04)) {
        const name = pkmPick(z.pool);
        pkmForcedWild = { name, level: pkmClamp(Math.round((z.lv[0] + z.lv[1]) / 2) + 3, 2, MAX_LEVEL), hidden: true };
        pkmPostBattle = () => pkmOpenExplore(z.id);
        pkmCloseExplore();
        pkmToast("🌿 You found a Hidden Grotto! A rare Pokémon with its hidden ability is inside.", 3500);
        openBattle();
        if (!battlePanel) { pkmForcedWild = null; pkmPostBattle = null; pkmOpenExplore(z.id); }
        return;
      }
      const party = getObj(STORAGE.party) || {};
      const lead = (getObj(STORAGE.stats) || {})[GM_getValue("pkm_starter_id")] || {};
      pkmHordeNext = Object.keys(party).length && (lead.currentHP == null || lead.currentHP > 0) && (forceG === "horde" || (!forceG && r < 0.10)) ? z.id : false;
      const out = await ew.apply(this, arguments);
      if (!battlePanel) pkmHordeNext = false;
      return out;
    };
    const pw = pkmPickWild;
    pkmPickWild = async function () {
      const f = pkmForcedWild;
      const m = await pw.apply(this, arguments);
      if (m && f && f.hidden) {
        const d = await pkmPokemonData(m.name).catch(() => null);
        const hid = d && (d.abilities || []).find((x) => x.is_hidden);
        if (hid) m.ability = hid.ability.name;
        m.grotto = true;
        if (!m.shiny && Math.random() < 0.05) { m.shiny = true; m.front = `${PKM_SPRITES}shiny/${m.dexId}.png`; }
      }
      return m;
    };
  }
  /** A horde: you against five wild Pokémon of one species (built for the battle that's starting). */
  async function pkmHordeSetup(b) {
    const d = await pkmPokemonData(b.foe.name).catch(() => null);
    if (!d) return false;
    const team = [b.foe];
    for (let i = 0; i < 4; i++) { const m = await pkmWildFrom(d, Math.max(2, b.foe.level - pkmRand(0, 3))); m.zone = b.foe.zone; team.push(m); }
    b.team = team;
    b.foeIdx = 0;
    b.double = true;
    b.horde = true;
    b.mine = [b.me];
    b.foes = team.slice();
    b.foeNext = team.length;
    b.dbl = { slot: 0, picks: [], stage: "move", pending: null, refill: [] };
    pkmDblPrimary(b);
    return true;
  }

  // ---------- Ultra Wormholes ----------
  const PKM_WORMHOLES = [
    { id: "blue", name: "Blue wormhole", icon: "🔵", desc: "Calm. Mostly Ultra Beasts.", legend: 0.15, lv: 0 },
    { id: "green", name: "Green wormhole", icon: "🟢", desc: "Wild. Ultra Beasts and some legends.", legend: 0.35, lv: 3 },
    { id: "red", name: "Red wormhole", icon: "🔴", desc: "Dangerous. Legends are likely, and they're strong.", legend: 0.6, lv: 6 },
  ];
  const PKM_UB = ["nihilego", "buzzwole", "pheromosa", "xurkitree", "celesteela", "kartana", "guzzlord", "poipole", "stakataka", "blacephalon"];
  const PKM_WORM_LEGENDS = ["articuno", "zapdos", "moltres", "mewtwo", "raikou", "entei", "suicune", "lugia", "ho-oh", "regirock", "regice", "registeel", "latias", "latios", "kyogre", "groudon", "rayquaza", "uxie", "mesprit", "azelf", "dialga", "palkia",
    "heatran", "regigigas", "giratina-altered", "cresselia", "cobalion", "terrakion", "virizion", "tornadus-incarnate", "thundurus-incarnate", "reshiram", "zekrom", "landorus-incarnate", "kyurem", "xerneas", "yveltal", "tapu-koko", "tapu-lele", "tapu-bulu", "tapu-fini", "solgaleo", "lunala", "necrozma"];
  const pkmWormDay = () => { const s = pkmJSON("pkm_wormhole", {}); return s.day === pkmDay(0) ? s : { day: pkmDay(0), trips: 0 }; };
  let pkmWormPanel = null;
  function pkmCloseWormholes() { if (pkmWormPanel) pkmWormPanel.remove(); pkmWormPanel = null; }
  function pkmWormTrip(id) {
    const w = PKM_WORMHOLES.find((x) => x.id === id);
    const s = pkmWormDay();
    if (!w || s.trips >= 3) return pkmToast("The Ultra Wormholes are closed until tomorrow.");
    if (!pkmRegionDone("alola") && GM_getValue("pkm_wormhole_force", "") !== "1") return pkmToast("Become the Alola Champion to ride the Ultra Wormholes.");
    s.trips++;
    pkmSave("pkm_wormhole", s);
    const name = Math.random() < w.legend ? pkmPick(PKM_WORM_LEGENDS) : pkmPick(PKM_UB);
    pkmForcedWild = { name, level: pkmClamp(pkmTopLevel() + w.lv + pkmRand(-2, 2), 30, MAX_LEVEL) };
    pkmPostBattle = () => pkmOpenWormholes();
    pkmCloseWormholes();
    pkmToast(`🌀 You dove into the ${w.name}…`, 2500);
    openBattle();
    if (!battlePanel) { pkmForcedWild = null; pkmPostBattle = null; }
  }
  function pkmOpenWormholes() {
    if (!pkmWormPanel) pkmWormPanel = pkmMakePanel("pkm-worm", "Ultra Wormholes", (e) => {
      const a = e.target.closest("[data-a]")?.dataset.a;
      if (a === "close") return pkmCloseWormholes();
      const w = e.target.closest("[data-worm]");
      if (w && !w.disabled) pkmWormTrip(w.dataset.worm);
    });
    const s = pkmWormDay();
    const open = pkmRegionDone("alola") || GM_getValue("pkm_wormhole_force", "") === "1";
    pkmWormPanel.innerHTML = `${pkmPanelHead("🌀 Ultra Wormholes", "uw-head")}<div class="lk-body">
      <div class="pkm-dim">${open ? `Ride an Ultra Wormhole to meet Ultra Beasts and legendary Pokémon. ${3 - s.trips} of 3 trips left today.` : "Become the Alola Champion to ride the Ultra Wormholes."}</div>
      <div class="uw-list">${PKM_WORMHOLES.map((w) => `<button type="button" class="uw-hole uw-${w.id}" data-worm="${w.id}" ${open && s.trips < 3 ? "" : "disabled"}><span class="uw-ico">${w.icon}</span><b>${w.name}</b><span class="pkm-dim">${w.desc}</span></button>`).join("")}</div></div>`;
  }

  // ---------- Villain teams (a short story in every region) ----------
  const PKM_VILLAINS = [
    { region: "kanto", team: "Team Rocket", color: "#b0202a", grunt: "rocketgrunt", gruntF: "rocketgruntf", admin: ["archer", "Archer"], boss: ["giovanni", "Giovanni"], pool: ["rattata", "zubat", "ekans", "koffing", "grimer", "meowth"], ace: ["persian", "nidoking", "rhydon"] },
    { region: "johto", team: "Team Rocket", color: "#b0202a", grunt: "rocketgrunt", gruntF: "rocketgruntf", admin: ["ariana", "Ariana"], boss: ["archer", "Archer"], pool: ["raticate", "golbat", "koffing", "murkrow", "houndour"], ace: ["houndoom", "arbok", "weezing"] },
    { region: "hoenn", team: "Team Magma", color: "#c2431b", grunt: "magmagrunt", gruntF: "magmagruntf", admin: ["courtney", "Courtney"], boss: ["maxie-gen6", "Maxie"], pool: ["poochyena", "numel", "zubat", "slugma", "baltoy"], ace: ["camerupt", "mightyena", "crobat"] },
    { region: "sinnoh", team: "Team Galactic", color: "#3b6ea8", grunt: "galacticgrunt", gruntF: "galacticgruntf", admin: ["mars", "Mars"], boss: ["cyrus", "Cyrus"], pool: ["glameow", "stunky", "zubat", "croagunk", "bronzor"], ace: ["weavile", "honchkrow", "gyarados"] },
    { region: "unova", team: "Team Plasma", color: "#4d5a73", grunt: "plasmagrunt", gruntF: "plasmagruntf", admin: ["zinzolin", "Zinzolin"], boss: ["ghetsis", "Ghetsis"], pool: ["patrat", "purrloin", "sandile", "trubbish", "scraggy"], ace: ["hydreigon", "seismitoad", "bisharp"] },
    { region: "kalos", team: "Team Flare", color: "#d0402a", grunt: "flaregrunt", gruntF: "flaregruntf", admin: ["xerosic", "Xerosic"], boss: ["lysandre", "Lysandre"], pool: ["houndour", "litleo", "croagunk", "scraggy", "golbat"], ace: ["malamar", "gyarados", "honchkrow"] },
    { region: "alola", team: "Team Skull", color: "#5b4b8a", grunt: "skullgrunt", gruntF: "skullgruntf", admin: ["plumeria", "Plumeria"], boss: ["guzma", "Guzma"], pool: ["zubat", "drowzee", "salandit", "rattata-alola", "yungoos"], ace: ["golisopod", "salazzle", "ariados"] },
    { region: "galar", team: "Macro Cosmos", color: "#2f6a5a", grunt: "yellgrunt", gruntF: "yellgruntf", admin: ["oleana", "Oleana"], boss: ["rose", "Chairman Rose"], pool: ["nickit", "zigzagoon-galar", "skwovet", "rolycoly", "impidimp"], ace: ["copperajah", "garbodor", "froslass"] },
  ];
  const PKM_VILLAIN_STEPS = [
    { need: 1, who: "grunt", title: "A grunt blocks the road", text: "\"Hand over your Pokémon, kid!\" A grunt is stealing Pokémon from travelers.", n: 2, lv: -3 },
    { need: 3, who: "duo", title: "Two grunts at the hideout", text: "You followed the grunt to a hideout. Two of them attack together!", n: 4, lv: -1, double: true },
    { need: 5, who: "admin", title: "The admin", text: "An admin is waiting deep inside. \"Our plan can't be stopped now.\"", n: 4, lv: 1 },
    { need: 7, who: "boss", title: "The boss", text: "The boss steps out. \"So you're the one who keeps getting in our way.\"", n: 5, lv: 3 },
  ];
  const pkmVillainState = () => pkmJSON("pkm_villain", {});
  function pkmVillainTrainer(v, i) {
    const step = PKM_VILLAIN_STEPS[i];
    const L = pkmClamp(pkmAreaLevel() + step.lv, 3, MAX_LEVEL);
    const team = Array.from({ length: step.n }, (_, k) => [k === step.n - 1 && i >= 2 ? pkmPick(v.ace) : pkmPick(v.pool), k === step.n - 1 ? L + 1 : L - pkmRand(0, 2), k === step.n - 1 && i === 3 ? "sitrus-berry" : null]);
    const who = step.who === "admin" ? v.admin : step.who === "boss" ? v.boss : [Math.random() < 0.5 ? v.grunt : v.gruntF, `${v.team} Grunt${step.who === "duo" ? "s" : ""}`];
    return { title: step.who === "boss" ? `${v.team} Boss` : step.who === "admin" ? `${v.team} Admin` : v.team, name: who[1], sprite: `${PKM_TRAINER_IMG}${who[0]}.png`, lose: step.who === "boss" ? "This isn't the end…" : "We'll remember this!", team, gym: 0, double: !!step.double, villain: { region: v.region, step: i } };
  }
  let pkmVillainPanel = null;
  function pkmCloseVillains() { if (pkmVillainPanel) pkmVillainPanel.remove(); pkmVillainPanel = null; }
  function pkmVillainFight(region) {
    const v = PKM_VILLAINS.find((x) => x.region === region);
    const s = pkmVillainState();
    const i = s[region] || 0;
    if (!v || i >= PKM_VILLAIN_STEPS.length) return;
    pkmPostBattle = () => {
      if (pkmLastResult === "Won") {
        const st = pkmVillainState();
        st[region] = Math.max(st[region] || 0, i + 1);
        pkmSave("pkm_villain", st);
        const coins = [600, 1200, 2500, 6000][i];
        const items = i === 3 ? [[STORAGE.masterBalls, 1, "Master Ball"], ["pkm_item_ability-patch", 1, "Ability Patch"]] : i === 2 ? [[STORAGE.ultraBalls, 3, "Ultra Balls"]] : [[STORAGE.greatBalls, 3, "Great Balls"]];
        setInt(STORAGE.coins, getInt(STORAGE.coins) + coins);
        pkmGive(items);
        pkmTrack("villainWins");
        setTimeout(() => pkmToast(i === 3 ? `🏆 You stopped ${v.team} in ${pkmRegion(region).name}! +${coins} coins, ${pkmItemsText(items)}.` : `You beat ${v.team}! +${coins} coins, ${pkmItemsText(items)}.`, 5000), 300);
      }
      pkmOpenVillains(region);
    };
    pkmCloseVillains();
    pkmStartTrainer(pkmVillainTrainer(v, i));
    if (!battlePanel) pkmPostBattle = null;
  }
  let pkmVillainRegion = "kanto";
  function pkmOpenVillains(region) {
    if (typeof region === "string") pkmVillainRegion = region;
    if (!pkmVillainPanel) pkmVillainPanel = pkmMakePanel("pkm-villain", "Villain teams", (e) => {
      const a = e.target.closest("[data-a]")?.dataset.a;
      if (a === "close") return pkmCloseVillains();
      const r = e.target.closest("[data-vreg]");
      if (r && !r.disabled) return pkmOpenVillains(r.dataset.vreg);
      const f = e.target.closest("[data-vfight]");
      if (f && !f.disabled) pkmVillainFight(f.dataset.vfight);
    });
    const s = pkmVillainState();
    const v = PKM_VILLAINS.find((x) => x.region === pkmVillainRegion) || PKM_VILLAINS[0];
    const reg = pkmRegion(v.region);
    const have = pkmRegionBadges(reg, pkmBadges()).length;
    const i = s[v.region] || 0;
    const step = PKM_VILLAIN_STEPS[i];
    pkmVillainPanel.innerHTML = `${pkmPanelHead("🦹 Villain teams", "vl-head")}<div class="lk-body">
      <div class="bag-tabs" role="tablist">${PKM_VILLAINS.map((x, ri) => `<button type="button" role="tab" data-vreg="${x.region}" aria-selected="${x.region === v.region}" ${pkmRegionOpen(ri) ? "" : "disabled"}>${pkmRegion(x.region).icon} ${pkmEsc(pkmRegion(x.region).name)}${(s[x.region] || 0) >= 4 ? " ✅" : ""}</button>`).join("")}</div>
      <div class="vl-team" style="--vc:${v.color}"><b>${pkmEsc(v.team)}</b><span class="pkm-dim">${i}/${PKM_VILLAIN_STEPS.length} chapters</span></div>
      <div class="vl-steps">${PKM_VILLAIN_STEPS.map((x, k) => `<div class="vl-step${k < i ? " done" : k === i ? " now" : ""}"><b>${k < i ? "✅" : k === i ? "▶" : "🔒"} ${pkmEsc(x.title)}</b><span class="pkm-dim">${k <= i ? pkmEsc(x.text) : `Needs ${x.need} ${pkmEsc(reg.name)} badge${x.need > 1 ? "s" : ""}`}</span></div>`).join("")}</div>
      ${step ? `<div class="pkm-btns"><button type="button" class="pkm-btn2 primary" data-vfight="${v.region}" ${have >= step.need ? "" : "disabled"}>${have >= step.need ? `⚔️ ${step.double ? "Fight them" : "Battle"}` : `Earn ${step.need} badge${step.need > 1 ? "s" : ""} in ${pkmEsc(reg.name)} (you have ${have})`}</button></div>` : `<div class="pkm-dim">🏆 You stopped ${pkmEsc(v.team)} for good. The region is safe.</div>`}</div>`;
  }

  // ---------- Trainer card: Species progress tab ----------
  {
    const ob = pkmOpenBadges;
    pkmOpenBadges = function () {
      const r = ob.apply(this, arguments);
      const P = pkmBadgesPanel;
      if (!P) return r;
      const tabs = P.querySelector(".bag-tabs");
      if (tabs && !tabs.querySelector('[data-tab="species"]')) tabs.insertAdjacentHTML("beforeend", `<button type="button" role="tab" data-tab="species" aria-selected="${pkmBadgesTab === "species"}">Species</button>`);
      if (pkmBadgesTab !== "species") return r;
      tabs && tabs.querySelectorAll("[data-tab]").forEach((t) => t.setAttribute("aria-selected", String(t.dataset.tab === "species")));
      const dexArr = getArr(STORAGE.pokedex) || [];
      const rec = pkmJSON("pkm_species_caught", {});
      const shin = pkmJSON("pkm_species_shiny", {});
      const party = Object.values(getObj(STORAGE.party) || {});
      const rows = dexArr.map((p) => {
        const n = String(p.name).toLowerCase();
        const own = party.filter((x) => String(x.name).toLowerCase() === n);
        const caught = Math.max(rec[n] || 0, own.length);
        const shiny = Math.max(shin[n] || 0, own.filter((x) => x.isShiny).length);
        const next = [10, 25, 50, 100].find((k) => caught < k);
        return { n, p, caught, shiny, mult: pkmShinyBonus(n), next };
      }).sort((a, b) => (pkmDexId(a.n) || 9999) - (pkmDexId(b.n) || 9999));
      const totShiny = rows.reduce((s, x) => s + (x.shiny ? 1 : 0), 0);
      const body = P.querySelector(".bc-body");
      if (body) body.innerHTML = `<div class="sp-sum"><div class="bc-tile"><div class="bc-tv">${rows.length}</div><div class="pkm-dim">Species caught</div></div><div class="bc-tile"><div class="bc-tv">${totShiny}</div><div class="pkm-dim">Species found shiny</div></div><div class="bc-tile"><div class="bc-tv">${rows.filter((x) => x.mult >= 4).length}</div><div class="pkm-dim">At max shiny odds</div></div></div>
        ${rows.length ? `<div class="sp-list">${rows.map((x) => `<div class="sp-row"><img src="${pkmEsc(pkmMonSprite(x.p, dexArr))}" alt="" loading="lazy"><div class="sp-main"><b>#${pkmDexId(x.n) || "?"} ${pkmEsc(pkmCap(x.n))}</b>${x.shiny ? ` <span title="Shinies caught">✨${x.shiny}</span>` : ""}
          <div class="pkm-dim">Caught ${x.caught} · shiny odds x${x.mult}${x.next ? ` · ${x.next - x.caught} more for the next boost` : " · max"}</div><div class="bc-bar"><span style="width:${Math.min(100, Math.round((x.caught / 100) * 100))}%"></span></div></div></div>`).join("")}</div>` : `<div class="pkm-dim" style="text-align:center;padding:30px">Catch Pokémon to fill this page.</div>`}`;
      return r;
    };
    const sc = pkmStoreCaught;
    pkmStoreCaught = function (f, source) {
      const id = sc.apply(this, arguments);
      try { if (f && f.shiny && source !== "test") { const n = String(f.name).toLowerCase(); const s = pkmJSON("pkm_species_shiny", {}); s[n] = (s[n] || 0) + 1; pkmSave("pkm_species_shiny", s); } } catch {}
      return id;
    };
  }

  // ---------- Battle look: day/night tint, horde layout, move animations ----------
  const pkmTimeOfDay = () => {
    const f = GM_getValue("pkm_time_force", "");
    if (f === "night" || f === "day" || f === "dawn" || f === "dusk") return f;
    const h = new Date().getHours();
    return h >= 5 && h < 8 ? "dawn" : h >= 17 && h < 20 ? "dusk" : h >= 20 || h < 5 ? "night" : "day";
  };
  {
    const db = drawBattle;
    drawBattle = function () {
      const r = db.apply(this, arguments);
      const b = pkb;
      if (!b || !battlePanel) return r;
      const field = battlePanel.querySelector(".pkb-field");
      if (field) {
        field.classList.add(`tod-${pkmTimeOfDay()}`);
        if (b.horde) { field.querySelector(".pkb-row.foe")?.classList.add("horde"); field.querySelector(".pkb-row.me")?.classList.add("solo"); }
      }
      if (b.horde && b.trainer == null) { const gym = battlePanel.querySelector(".pkb-msg"); if (gym && !battlePanel.querySelector(".pkb-horde-tag")) gym.insertAdjacentHTML("beforebegin", `<div class="pkb-horde-tag">🐾 Horde encounter: 5 wild ${pkmEsc(b.foes[0] ? b.foes[0].display : "")}</div>`); }
      return r;
    };
  }
  const PKM_FX = { normal: "💥", fire: "🔥", water: "💧", grass: "🍃", electric: "⚡", ice: "❄️", fighting: "👊", poison: "☠️", ground: "🪨", flying: "🌪️", psychic: "🌀", bug: "🐛", rock: "🪨", ghost: "👻", dragon: "🐉", dark: "🌑", steel: "⚙️", fairy: "✨" };
  const pkmFxOn = () => GM_getValue("pkm_skip_anim", "false") !== "true" && GM_getValue("pkm_move_fx", "true") !== "false" && !(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  function pkmMoveFx(b, def, mv) {
    if (!battlePanel || !pkmFxOn() || !mv || mv.cls === "status") return;
    const side = pkmMine(b, def) ? "me" : "foe";
    let el = null;
    if (b.double) { const list = side === "me" ? b.mine : b.foes; const i = list.indexOf(def); el = battlePanel.querySelectorAll(`.pkb-row.${side} .dbl-mon`)[i]; }
    else el = battlePanel.querySelector(`.pkb-row.${side} img`);
    if (!el) return;
    const rc = el.getBoundingClientRect();
    if (!rc.width) return;
    const fx = document.createElement("div");
    fx.className = `pkm-fx fx-${mv.type}`;
    fx.style.left = `${rc.left + rc.width / 2}px`;
    fx.style.top = `${rc.top + rc.height / 2}px`;
    fx.setAttribute("aria-hidden", "true");
    const ico = PKM_FX[mv.type] || "💥";
    fx.innerHTML = `<span class="fx-ring"></span>${Array.from({ length: 6 }, (_, i) => `<span class="fx-p" style="--a:${i * 60 + pkmRand(-15, 15)}deg;--d:${pkmRand(28, 46)}px">${ico}</span>`).join("")}`;
    pkmMount(fx);
    setTimeout(() => fx.remove(), 700 * 20 > 5000 ? 700 : 700);
  }
  {
    const um = pkmUseMove;
    pkmUseMove = async function (b, att, def, mv) {
      try { if (b && att && def && att.hp > 0 && !att.charging && !(mv && mv.quiet && mv.spread)) pkmMoveFx(b, def, mv); } catch {}
      return um.apply(this, arguments);
    };
  }

  // ---------- Gym puzzles (once per Gym, before the first challenge) ----------
  let pkmPuzzlePanel = null;
  let pkmPuzzle = null;
  function pkmClosePuzzle() { if (pkmPuzzlePanel) pkmPuzzlePanel.remove(); pkmPuzzlePanel = null; pkmPuzzle = null; }
  const pkmPuzzlesDone = () => pkmJSON("pkm_gym_puzzles", []);
  /** Runs `go` right away, or after the Gym's puzzle is solved. */
  function pkmGymGate(gym, go) {
    if (pkmBadges().includes(gym.n) || pkmPuzzlesDone().includes(gym.n) || GM_getValue("pkm_gym_puzzles_off", "false") === "true") return go();
    pkmCloseTrainers();
    pkmOpenPuzzle(gym, go);
  }
  const PKM_TYPES_ALL = Object.keys(PKM_TYPE_CHART);
  const pkmEffOn = (atk, def) => { const e = PKM_TYPE_CHART[atk] || {}; return e[def] == null ? 1 : e[def]; };
  function pkmQuizQ(type) {
    const good = PKM_TYPES_ALL.filter((t) => pkmEffOn(t, type) >= 2);
    const bad = PKM_TYPES_ALL.filter((t) => pkmEffOn(t, type) <= 1);
    if (!good.length || bad.length < 2) return null;
    const ans = pkmPick(good);
    const opts = [ans, ...bad.sort(() => Math.random() - 0.5).slice(0, 2)].sort(() => Math.random() - 0.5);
    return { q: `Which type of move is super effective against ${pkmCap(type)} Pokémon?`, opts, ans };
  }
  function pkmLightsNew() {
    const g = Array(9).fill(true);
    const press = (i) => { const r = Math.floor(i / 3), c = i % 3; for (const [dr, dc] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) { const rr = r + dr, cc = c + dc; if (rr >= 0 && rr < 3 && cc >= 0 && cc < 3) g[rr * 3 + cc] = !g[rr * 3 + cc]; } };
    for (let k = 0; k < 3; k++) press(pkmRand(0, 8));
    if (g.every(Boolean)) press(4);
    return { g, press };
  }
  function pkmOpenPuzzle(gym, go) {
    pkmClosePuzzle();
    const kind = gym.n % 2 ? "quiz" : "lights";
    pkmPuzzle = { gym, go, kind, step: 0, need: 3, q: null, lights: null, moves: 0 };
    if (kind === "quiz") pkmPuzzle.q = pkmQuizQ(gym.type) || pkmQuizQ("normal");
    else pkmPuzzle.lights = pkmLightsNew();
    pkmPuzzlePanel = pkmMakePanel("pkm-puzzle", "Gym puzzle", (e) => {
      const p = pkmPuzzle;
      if (!p) return;
      const a = e.target.closest("[data-a]")?.dataset.a;
      if (a === "close") return pkmClosePuzzle();
      const opt = e.target.closest("[data-opt]");
      if (opt && p.kind === "quiz") {
        if (opt.dataset.opt === p.q.ans) { p.step++; playSound("hit"); if (p.step >= p.need) return pkmPuzzleSolved(); p.q = pkmQuizQ(pkmPick([gym.type, gym.type, pkmPick(PKM_TYPES_ALL)])) || p.q; }
        else { pkmToast(`Not quite. ${pkmCap(p.q.ans)} is super effective here. Try another one.`, 3000); p.step = Math.max(0, p.step - 1); p.q = pkmQuizQ(gym.type) || p.q; }
        return pkmDrawPuzzle();
      }
      const tile = e.target.closest("[data-tile]");
      if (tile && p.kind === "lights") {
        p.lights.press(+tile.dataset.tile); p.moves++;
        if (p.lights.g.every(Boolean)) return pkmPuzzleSolved();
        return pkmDrawPuzzle();
      }
      if (a === "reset" && p.kind === "lights") { p.lights = pkmLightsNew(); p.moves = 0; return pkmDrawPuzzle(); }
    });
    pkmDrawPuzzle();
  }
  function pkmPuzzleSolved() {
    const p = pkmPuzzle;
    const done = pkmPuzzlesDone();
    if (!done.includes(p.gym.n)) done.push(p.gym.n);
    pkmSave("pkm_gym_puzzles", done);
    pkmClosePuzzle();
    pkmToast(`🧩 Puzzle solved! ${p.gym.leader} is waiting for you.`, 3000);
    p.go();
  }
  function pkmDrawPuzzle() {
    const p = pkmPuzzle;
    if (!p || !pkmPuzzlePanel) return;
    const g = p.gym;
    const body = p.kind === "quiz"
      ? `<div class="pkm-dim">The Gym trainers quiz you before you can reach ${pkmEsc(g.leader)}. Answer ${p.need} in a row.</div>
        <div class="pz-prog">${"🟢".repeat(p.step)}${"⚪".repeat(p.need - p.step)}</div>
        <div class="pz-q">${pkmEsc(p.q.q)}</div>
        <div class="pkm-btns" style="justify-content:center">${p.q.opts.map((o) => `<button type="button" class="pkm-btn2 pz-opt" data-opt="${o}"><span class="pk-type ${o}">${o}</span></button>`).join("")}</div>`
      : `<div class="pkm-dim">The path to ${pkmEsc(g.leader)} is dark. Each switch flips itself and the ones next to it. Light up all nine to open the way.</div>
        <div class="pz-grid">${p.lights.g.map((on, i) => `<button type="button" class="pz-tile${on ? " on" : ""}" data-tile="${i}" aria-label="Switch ${i + 1} ${on ? "on" : "off"}" aria-pressed="${on}"></button>`).join("")}</div>
        <div class="pkm-btns" style="justify-content:center"><span class="pkm-dim">Moves: ${p.moves}</span><button type="button" class="pkm-btn2" data-a="reset">Start over</button></div>`;
    pkmPuzzlePanel.innerHTML = `${pkmPanelHead(`🧩 ${pkmEsc(g.leader)}'s Gym`, "pz-head")}<div class="lk-body">${body}</div>`;
  }

  // ---------- Trainer look ----------
  const PKM_LOOKS = ["red", "leaf-gen3", "ethan", "lyra", "kris", "brendan", "may", "lucas", "dawn", "hilbert", "hilda", "nate", "rosa", "calem", "serena", "elio", "selene", "victor", "gloria", "blue", "marnie", "acetrainer", "acetrainerf", "youngster", "lass", "hiker", "swimmer", "mable", "bryony", "piers"];
  const PKM_LOOK_COLORS = [["Blue", "#1f6fe0", "#7a2fb5"], ["Red", "#d6322a", "#7a1414"], ["Green", "#2f9e5a", "#14522e"], ["Gold", "#d6a12a", "#7a5414"], ["Pink", "#e05aa0", "#7a2f6a"], ["Night", "#2a2f5a", "#0e1128"]];
  const pkmLook = () => Object.assign({ sprite: "red", color: 0, title: "" }, pkmJSON("pkm_trainer_look", {}));
  let pkmLookPanel = null;
  function pkmCloseLook() { if (pkmLookPanel) pkmLookPanel.remove(); pkmLookPanel = null; }
  function pkmOpenLook() {
    if (!pkmLookPanel) pkmLookPanel = pkmMakePanel("pkm-look", "Trainer look", (e) => {
      const a = e.target.closest("[data-a]")?.dataset.a;
      if (a === "close") return pkmCloseLook();
      const L = pkmLook();
      const spr = e.target.closest("[data-spr]");
      const col = e.target.closest("[data-col]");
      if (spr) { L.sprite = spr.dataset.spr; pkmSave("pkm_trainer_look", L); return pkmOpenLook(); }
      if (col) { L.color = +col.dataset.col; pkmSave("pkm_trainer_look", L); return pkmOpenLook(); }
      if (a === "save") {
        const P = pkmLookPanel;
        const name = pkmSafeName(P.querySelector(".lk-name").value, 16);
        if (name) GM_setValue("pkm_trainer_name", name);
        L.title = pkmSafeName(P.querySelector(".lk-title").value, 24) || "";
        pkmSave("pkm_trainer_look", L);
        if (pkmOnline() && name) pkmApi("rename", { name }).then((r) => { const o = pkmOnline(); if (o) { o.name = r.name; pkmSave("pkm_online", o); } }).catch(() => {});
        pkmToast("Trainer look saved.");
        return pkmOpenLook();
      }
    });
    const L = pkmLook();
    const c = PKM_LOOK_COLORS[L.color] || PKM_LOOK_COLORS[0];
    pkmLookPanel.innerHTML = `${pkmPanelHead("🧢 Trainer look", "tl-head")}<div class="lk-body">
      <div class="tl-preview" style="background:linear-gradient(120deg,${c[1]},${c[2]})"><img src="${PKM_TRAINER_IMG}${pkmEsc(L.sprite)}.png" alt=""><div><b>${pkmEsc(pkmTrainerName())}</b><div>${pkmEsc(L.title || pkmRank().name)}</div></div></div>
      <div class="pkm-btns"><label class="lk-l">Name <input class="lk-name" maxlength="16" value="${pkmEsc(pkmTrainerName())}"></label><label class="lk-l">Title <input class="lk-title" maxlength="24" placeholder="${pkmEsc(pkmRank().name)}" value="${pkmEsc(L.title)}"></label><button type="button" class="pkm-btn2 primary" data-a="save">Save</button></div>
      <div class="bag-sec"><span>Card color</span></div>
      <div class="pkm-btns">${PKM_LOOK_COLORS.map((x, i) => `<button type="button" class="tl-col${i === L.color ? " on" : ""}" data-col="${i}" style="background:linear-gradient(120deg,${x[1]},${x[2]})" aria-label="${x[0]}" aria-pressed="${i === L.color}"></button>`).join("")}</div>
      <div class="bag-sec"><span>Outfit</span></div>
      <div class="tl-grid">${PKM_LOOKS.map((s) => `<button type="button" class="tl-spr${s === L.sprite ? " on" : ""}" data-spr="${s}" aria-pressed="${s === L.sprite}" title="${pkmEsc(pkmCap(s.replace(/-gen\d$/, "")))}"><img src="${PKM_TRAINER_IMG}${s}.png" alt="${pkmEsc(s)}" loading="lazy"></button>`).join("")}</div></div>`;
  }
  // The trainer card header shows your look
  {
    const ob = pkmOpenBadges;
    pkmOpenBadges = function () {
      const r = ob.apply(this, arguments);
      const P = pkmBadgesPanel;
      const head = P && P.querySelector(".bc-head");
      if (head && !head.querySelector(".bc-me")) {
        const L = pkmLook();
        const c = PKM_LOOK_COLORS[L.color] || PKM_LOOK_COLORS[0];
        head.style.background = `linear-gradient(90deg,${c[1]},${c[2]})`;
        head.querySelector("span").insertAdjacentHTML("afterbegin", `<img class="bc-me" src="${PKM_TRAINER_IMG}${pkmEsc(L.sprite)}.png" alt=""><button type="button" class="pkm-btn2 bc-look" data-look="1" title="Change your trainer look">🧢 ${pkmEsc(pkmTrainerName())}${L.title ? ` · ${pkmEsc(L.title)}` : ""}</button> `);
        head.querySelector("[data-look]").onclick = (e) => { e.stopPropagation(); pkmOpenLook(); };
      }
      return r;
    };
  }

  // ---------- Options: server address, move animations, gym puzzles ----------
  {
    const dro = pkmDrawOptions;
    pkmDrawOptions = function () {
      const r = dro.apply(this, arguments);
      const P = pkmOptionsPanel;
      if (!P || pkmOptionsTab !== "game" || P.querySelector("[data-o42]")) return r;
      const fx = GM_getValue("pkm_move_fx", "true") !== "false";
      const pz = GM_getValue("pkm_gym_puzzles_off", "false") !== "true";
      P.querySelector(".lk-body").insertAdjacentHTML("beforeend", `<div class="bag-sec" data-o42="1"><span>More options</span></div>
        <div class="pkm-btns"><button type="button" class="pkm-btn2 ${fx ? "primary" : ""}" data-o42="fx">${fx ? "✓ " : ""}Move animations</button><button type="button" class="pkm-btn2 ${pz ? "primary" : ""}" data-o42="pz">${pz ? "✓ " : ""}Gym puzzles</button></div>
        <div class="bag-sec"><span>Game server</span><span class="pkm-dim">for 🌐 Online</span></div>
        <div class="pkm-btns"><input class="op-srv" style="flex:1" placeholder="${PKM_SERVER_DEFAULT}" value="${pkmEsc(GM_getValue("pkm_server_url", ""))}" aria-label="Game server address"><button type="button" class="pkm-btn2" data-o42="srv">Save</button></div>`);
      P.querySelectorAll("[data-o42]").forEach((el) => {
        if (el.tagName !== "BUTTON") return;
        el.onclick = (e) => {
          e.stopPropagation();
          const k = el.dataset.o42;
          if (k === "fx") GM_setValue("pkm_move_fx", fx ? "false" : "true");
          if (k === "pz") GM_setValue("pkm_gym_puzzles_off", pz ? "true" : "false");
          if (k === "srv") { const v = P.querySelector(".op-srv").value.trim(); if (v && !/^https:\/\//.test(v)) return pkmToast("The server address must start with https://"); GM_setValue("pkm_server_url", v); pkmToast(v ? "Server address saved." : "Using the default server."); }
          pkmDrawOptions();
        };
      });
      return r;
    };
  }

  // ---------- Panels ----------
  PKM_PANELS.push(
    ["online", () => pkmOnlinePanel, () => pkmCloseOnline()], ["camp", () => pkmCampPanel, () => pkmCloseCamp()], ["worm", () => pkmWormPanel, () => pkmCloseWormholes()],
    ["villain", () => pkmVillainPanel, () => pkmCloseVillains()], ["puzzle", () => pkmPuzzlePanel, () => pkmClosePuzzle()], ["look", () => pkmLookPanel, () => pkmCloseLook()],
  );
  pkmOpenOnline = pkmExclusive("online", pkmOpenOnline);
  pkmOpenCamp = pkmExclusive("camp", pkmOpenCamp);
  pkmOpenWormholes = pkmExclusive("worm", pkmOpenWormholes);
  pkmOpenVillains = pkmExclusive("villain", pkmOpenVillains);
  pkmOpenLook = pkmExclusive("look", pkmOpenLook);

  pkmStyle(`
    .pkm-set.pkm-online,.pkm-set.pkm-camp,.pkm-set.pkm-worm,.pkm-set.pkm-villain,.pkm-set.pkm-puzzle,.pkm-set.pkm-look{width:min(680px,96vw);max-height:92vh;overflow:auto}
    .pkm-online.busy{cursor:progress}.pkm-online.busy .lk-body{opacity:.6;pointer-events:none}
    .ol-head{background:linear-gradient(90deg,#1f8fe0,#145a9a)!important}.cp-head{background:linear-gradient(90deg,#5aa04a,#2e6a24)!important}
    .uw-head{background:linear-gradient(90deg,#7a3ab5,#2a1460)!important}.vl-head{background:linear-gradient(90deg,#8a2a2a,#3a1010)!important}
    .pz-head{background:linear-gradient(90deg,#c08a2a,#6a4a10)!important}.tl-head{background:linear-gradient(90deg,#2a8ab0,#14506a)!important}
    .ol-card{display:flex;gap:10px;align-items:center;padding:6px 0;border-bottom:1px solid rgba(127,127,127,.15)}.ol-card img{width:64px;height:64px;image-rendering:pixelated;flex:none}
    .ol-main{flex:1;display:grid;gap:4px}.ol-done{color:#2fbf71;font-weight:600}.ol-err{color:#ff6b6b}
    .ol-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:6px}.ol-tile{display:flex;flex-direction:column;align-items:center;gap:3px;padding:6px;border-radius:10px;background:rgba(127,127,127,.12);font-size:12px;text-align:center}
    .ol-tile img{width:64px;height:64px;image-rendering:pixelated}
    .cp-party{display:flex;gap:6px;flex-wrap:wrap;justify-content:center;margin:8px 0}.cp-pick{all:unset;cursor:pointer;display:flex;flex-direction:column;align-items:center;padding:4px 6px;border-radius:10px;font-size:11.5px;background:rgba(127,127,127,.12)}
    .cp-pick.on{outline:2px solid #5aa04a}.cp-pick img{width:48px;height:48px;image-rendering:pixelated}
    .cp-stage{position:relative;display:grid;place-items:center;height:150px;border-radius:14px;background:radial-gradient(ellipse at 50% 85%,rgba(90,160,74,.45),transparent 60%),linear-gradient(#bfe6ff,#e9f7d8)}
    .cp-big{width:128px;height:128px;image-rendering:pixelated}.cp-f{text-align:center;margin:6px 0}
    .cp-heart{position:absolute;top:20px;left:50%;transform:translateX(-50%);font-size:26px;animation:cpHeart .9s ease-out forwards;pointer-events:none}
    .cp-wiggle{animation:cpWiggle .5s}.cp-hop{animation:cpHop .5s}.cp-spin{animation:cpSpin .6s}
    @keyframes cpHeart{to{transform:translate(-50%,-40px);opacity:0}}@keyframes cpWiggle{25%{transform:rotate(-8deg)}75%{transform:rotate(8deg)}}
    @keyframes cpHop{50%{transform:translateY(-18px)}}@keyframes cpSpin{to{transform:rotate(360deg)}}
    .uw-list{display:grid;gap:8px;margin-top:8px}.uw-hole{all:unset;cursor:pointer;display:grid;grid-template-columns:40px 1fr;grid-template-rows:auto auto;column-gap:10px;padding:10px;border-radius:14px;color:#fff}
    .uw-hole[disabled]{opacity:.45;cursor:not-allowed}.uw-ico{grid-row:span 2;font-size:30px;align-self:center}
    .uw-blue{background:linear-gradient(120deg,#1a4a9a,#4ab0ff)}.uw-green{background:linear-gradient(120deg,#145a2a,#4ad08a)}.uw-red{background:linear-gradient(120deg,#6a1010,#ff5a3a)}
    .vl-team{display:flex;justify-content:space-between;align-items:center;padding:8px 10px;margin:8px 0;border-radius:10px;border-left:6px solid var(--vc);background:rgba(127,127,127,.12)}
    .vl-steps{display:grid;gap:6px}.vl-step{display:grid;gap:2px;padding:6px 8px;border-radius:8px;background:rgba(127,127,127,.08)}.vl-step.now{outline:2px solid #ffcb05}.vl-step.done{opacity:.7}
    .sp-sum{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-bottom:8px}.sp-list{display:grid;gap:4px}.sp-row{display:flex;gap:8px;align-items:center}.sp-row img{width:44px;height:44px;image-rendering:pixelated}.sp-main{flex:1}
    .pkb-field.tod-dawn::after,.pkb-field.tod-dusk::after,.pkb-field.tod-night::after{content:"";position:absolute;inset:0;pointer-events:none;border-radius:inherit}
    .pkb-field.tod-dawn::after{background:linear-gradient(180deg,rgba(255,170,120,.28),rgba(255,220,180,.08))}
    .pkb-field.tod-dusk::after{background:linear-gradient(180deg,rgba(255,110,60,.32),rgba(120,60,140,.18))}
    .pkb-field.tod-night::after{background:linear-gradient(180deg,rgba(10,20,70,.38),rgba(10,20,60,.22))}
    .dbl-row.horde{grid-template-columns:repeat(5,1fr)}.dbl-row.horde .dbl-spr{width:52px;height:52px}.dbl-row.horde .dbl-info{font-size:10px;padding:2px 4px}
    .dbl-row.solo{grid-template-columns:minmax(0,260px);justify-content:center}
    .pkb-horde-tag{text-align:center;font-size:12px;font-weight:700;opacity:.8;margin:2px 0}
    .pkm-fx{position:fixed;z-index:10020;width:0;height:0;pointer-events:none}
    .pkm-fx .fx-p{position:absolute;left:-12px;top:-12px;font-size:22px;animation:fxBurst .6s ease-out forwards}
    .pkm-fx .fx-ring{position:absolute;left:-30px;top:-30px;width:60px;height:60px;border-radius:50%;border:4px solid var(--fxc,#fff);animation:fxRing .5s ease-out forwards}
    @keyframes fxBurst{from{transform:rotate(var(--a)) translateX(0) rotate(calc(-1*var(--a))) scale(.6);opacity:1}to{transform:rotate(var(--a)) translateX(var(--d)) rotate(calc(-1*var(--a))) scale(1.1);opacity:0}}
    @keyframes fxRing{from{transform:scale(.3);opacity:.9}to{transform:scale(1.4);opacity:0}}
    .fx-fire{--fxc:#ff6a2a}.fx-water{--fxc:#3a9aff}.fx-grass{--fxc:#4ac04a}.fx-electric{--fxc:#ffd21a}.fx-ice{--fxc:#9ae6ff}.fx-fighting{--fxc:#c0402a}.fx-poison{--fxc:#a04ac0}.fx-ground{--fxc:#c0a050}.fx-flying{--fxc:#a0b4ff}
    .fx-psychic{--fxc:#ff5a9a}.fx-bug{--fxc:#a0c020}.fx-rock{--fxc:#b0a060}.fx-ghost{--fxc:#6a5aa0}.fx-dragon{--fxc:#6a3aff}.fx-dark{--fxc:#5a4a40}.fx-steel{--fxc:#b0b0c8}.fx-fairy{--fxc:#ff9ad0}.fx-normal{--fxc:#e0e0d0}
    .pz-prog{text-align:center;font-size:20px;margin:6px 0}.pz-q{text-align:center;font-weight:700;margin:8px 0}
    .pz-grid{display:grid;grid-template-columns:repeat(3,64px);gap:8px;justify-content:center;margin:12px 0}
    .pz-tile{all:unset;cursor:pointer;width:64px;height:64px;border-radius:12px;background:#2a2f45;box-shadow:inset 0 0 0 2px rgba(255,255,255,.15)}
    .pz-tile.on{background:radial-gradient(circle,#fff6a0,#ffcb05);box-shadow:0 0 14px #ffcb05}
    .tl-preview{display:flex;gap:12px;align-items:center;padding:10px;border-radius:14px;color:#fff;margin-bottom:8px}.tl-preview img{width:80px;height:80px;image-rendering:pixelated}
    .tl-col{all:unset;cursor:pointer;width:34px;height:34px;border-radius:50%;box-shadow:inset 0 0 0 2px rgba(255,255,255,.4)}.tl-col.on{outline:3px solid #ffcb05}
    .tl-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(70px,1fr));gap:6px}.tl-spr{all:unset;cursor:pointer;border-radius:10px;background:rgba(127,127,127,.12);display:grid;place-items:center;padding:4px}
    .tl-spr.on{outline:2px solid #2a8ab0}.tl-spr img{width:60px;height:60px;image-rendering:pixelated}
    .bc-me{width:34px;height:34px;image-rendering:pixelated;vertical-align:middle;margin-right:4px}.bc-look{font-size:12px!important;padding:3px 8px!important}
  `, "pkm-v42");
  // =====================================================================
  //  4.3: live friend battles, leaderboards, server events (weekly gift,
  //  shared raid, Safari outbreak), friends and gifts, shared replays,
  //  online contests, profile badges, habitat map, map weather events and
  //  a partner that shows its mood
  // =====================================================================

  // ---------- Profile badges (shown next to your name online) ----------
  const PKM_BADGE_ICONS = { champ: ["🏆", "Champion"], champ8: ["👑", "Champion of every region"], allbadges: ["🎖️", "All 64 Gym badges"], dex100: ["📕", "100 Pokédex entries"], dex500: ["📚", "500 Pokédex entries"],
    shiny: ["✨", "Shiny hunter"], tower50: ["🗼", "50-win Battle Tower streak"], villain: ["🦹", "Stopped a villain team"], nuzlocke: ["🪦", "Nuzlocke trainer"], master: ["🎀", "Master Contest winner"] };
  function pkmMyBadges() {
    const out = [];
    const champs = Object.keys(pkmJSON("pkm_champs", {}) || {}).length;
    const dex = (getArr(STORAGE.pokedex) || []).length;
    const party = Object.values(getObj(STORAGE.party) || {});
    const st = getObj(STORAGE.stats) || {};
    if (champs >= PKM_REGIONS.length) out.push("champ8"); else if (champs) out.push("champ");
    if (pkmBadges().length >= PKM_GYMS.length) out.push("allbadges");
    if (dex >= 500) out.push("dex500"); else if (dex >= 100) out.push("dex100");
    if (party.some((p) => p.isShiny) || Object.keys(pkmJSON("pkm_species_shiny", {})).length) out.push("shiny");
    if ((pkmTower().best || 0) >= 50) out.push("tower50");
    if (Object.values(pkmJSON("pkm_villain", {})).some((n) => n >= 4)) out.push("villain");
    if (pkmNuzOn() && pkmBadges().length >= 8) out.push("nuzlocke");
    if (Object.values(st).some((s) => s && (s.ribbons || []).some((r) => / Master$/.test(r)))) out.push("master");
    return out;
  }
  const pkmBadgeHtml = (list) => (list || []).filter((b) => PKM_BADGE_ICONS[b]).slice(0, 4).map((b) => `<span class="ol-badge" title="${pkmEsc(PKM_BADGE_ICONS[b][1])}">${PKM_BADGE_ICONS[b][0]}</span>`).join("");
  let pkmProfileSent = "";
  async function pkmSyncProfile() {
    const b = pkmMyBadges();
    const k = b.join(",");
    if (!pkmOnline() || k === pkmProfileSent) return;
    pkmProfileSent = k;
    await pkmApi("profile", { badges: b }).catch(() => { pkmProfileSent = ""; });
  }

  // ---------- Rewards from the server (only known item keys, sane amounts) ----------
  const PKM_SAFE_ITEM = /^pkm_(item_[a-z0-9-]{2,30}|balls|great_balls|ultra_balls|master_balls|potions|revive)$/;
  function pkmApplyServerReward(coins, items) {
    const got = [];
    const c = pkmClamp(parseInt(coins, 10) || 0, 0, 100000);
    if (c) { setInt(STORAGE.coins, getInt(STORAGE.coins) + c); got.push(`${c} coins`); }
    for (const it of Array.isArray(items) ? items : []) {
      if (!Array.isArray(it) || !PKM_SAFE_ITEM.test(String(it[0]))) continue;
      const n = pkmClamp(parseInt(it[1], 10) || 0, 0, 99);
      if (!n) continue;
      setInt(it[0], getInt(it[0]) + n);
      got.push(`${n} x ${pkmSafeName(String(it[2] || it[0]).replace(/^pkm_(item_)?/, "").replace(/[-_]/g, " "), 30) || "item"}`);
    }
    return got.join(", ");
  }

  // ---------- Online panel: more tabs ----------
  const PKM_NEW_TABS = [["live", "⚔️ Live"], ["ranks", "🏆 Ranks"], ["events", "🎉 Events"], ["friends", "👥 Friends"], ["contest", "🎀 Contest"]];
  const pkmOnline2 = { ranks: null, board: "tower", events: null, friends: null, inbox: null, contest: null, cat: "cool", live: null };
  {
    const rf = pkmOnlineRefresh;
    pkmOnlineRefresh = async function () {
      if (!PKM_NEW_TABS.some(([k]) => k === pkmOnlineTab)) { await rf.apply(this, arguments); pkmSyncProfile(); return; }
      pkmOnlineData.err = "";
      if (!pkmOnline()) return;
      try {
        pkmSyncProfile();
        if (pkmOnlineTab === "ranks") {
          const p = pkmJSON("pkm_progress", {});
          const shinies = Math.max(Object.keys(pkmJSON("pkm_species_shiny", {})).length, Object.values(getObj(STORAGE.party) || {}).filter((x) => x.isShiny).length, p.shinies || 0);
          await Promise.all([
            pkmApi("score_submit", { board: "tower", score: pkmTower().best || 0 }), pkmApi("score_submit", { board: "dex", score: (getArr(STORAGE.pokedex) || []).length }),
            pkmApi("score_submit", { board: "shiny", score: shinies }), pkmApi("score_submit", { board: `ladder-${pkmWeekId()}`, score: pkmLadder().pts || 0 }),
          ]);
          pkmOnline2.ranks = pkmOnline2.board === "rating" ? await pkmApi("rating_top") : pkmOnline2.board === "guilds" ? await pkmApi("guild_top") : await pkmApi("score_top", { board: pkmOnline2.board === "ladder" ? `ladder-${pkmWeekId()}` : pkmOnline2.board });
        } else if (pkmOnlineTab === "events") {
          pkmOnline2.events = await pkmApi("events");
          pkmSave("pkm_srv_events", { t: Date.now(), d: pkmOnline2.events });
        } else if (pkmOnlineTab === "friends") {
          const [f, g] = await Promise.all([pkmApi("friend_list"), pkmApi("fgift_inbox")]);
          pkmOnline2.friends = f; pkmOnline2.inbox = g.gifts;
        } else if (pkmOnlineTab === "contest") {
          pkmOnline2.contest = await pkmApi("contest_board", { cat: pkmOnline2.cat });
        }
      } catch (e) { pkmOnlineData.err = e.message; }
    };
    const dr = pkmDrawOnline;
    pkmDrawOnline = function () {
      dr.apply(this, arguments);
      const P = pkmOnlinePanel;
      if (!P) return;
      if (!P.dataset.v43) { P.dataset.v43 = "1"; P.addEventListener("click", pkmOnline2Click); }
      const tabs = P.querySelector(".bag-tabs");
      if (tabs) tabs.insertAdjacentHTML("beforeend", PKM_NEW_TABS.map(([k, l]) => `<button type="button" role="tab" data-otab="${k}" aria-selected="${pkmOnlineTab === k}">${l}</button>`).join(""));
      if (pkmOnlineTab === "wonder" || pkmOnlineTab === "home") return;
      if (pkmOnlineTab === "gts") {
        for (const t of pkmOnlineData.gts || []) { const card = P.querySelector(`.ol-pay[data-for="${t.id}"]`)?.closest(".ol-card"); const dim = card && card.querySelector(".pkm-dim"); if (dim && t.badges && t.badges.length) dim.insertAdjacentHTML("beforeend", ` ${pkmBadgeHtml(t.badges)}`); }
        return;
      }
      const body = P.querySelector(".lk-body");
      if (!body || !pkmOnline()) return;
      const head = [...body.children].filter((c) => c.classList.contains("ol-acct") || c.classList.contains("ol-err")).map((c) => c.outerHTML).join("");
      body.innerHTML = head + pkmOnline2Body();
    };
  }
  function pkmOnline2Body() {
    const t = pkmOnlineTab;
    const o = pkmOnline2;
    if (t === "live") {
      const L = o.live;
      if (L && L.role === "host" && L.status === "wait") return `<div class="lv-code"><div class="pkm-dim">Send this code to your friend:</div><b>${pkmEsc(L.code)}</b><div class="pkm-dim">Waiting for them to join… The battle starts by itself.</div><div class="pkm-btns" style="justify-content:center"><button type="button" class="pkm-btn2" data-lv="cancel">Cancel</button></div></div>`;
      return `<div class="pkm-dim">Battle a friend live, turn by turn. Your game runs the battle when you host; your friend picks their moves on their screen. Friend battles give no coins or XP.</div>
        <div class="bag-sec"><span>Host a battle</span></div><div class="pkm-btns"><button type="button" class="pkm-btn2 primary" data-lv="host">⚔️ Create a battle code</button><button type="button" class="pkm-btn2" data-lv="ranked" title="Wins and losses change your live rating">🏅 Ranked battle</button><span class="pkm-dim">Uses your party</span></div>
        <div class="bag-sec"><span>Join a friend</span></div><div class="pkm-btns"><input class="lv-join" maxlength="8" placeholder="Battle code" aria-label="Battle code" style="text-transform:uppercase"><button type="button" class="pkm-btn2 primary" data-lv="join">Join</button></div>
        <div class="bag-sec"><span>Watch a battle</span></div><div class="pkm-btns"><input class="lv-watch" maxlength="8" placeholder="Battle code" aria-label="Battle code to watch" style="text-transform:uppercase"><button type="button" class="pkm-btn2" data-lv="watch">👀 Watch</button></div>
        <div class="pkm-dim">Your live rating: <b>${pkmOnline2.rating == null ? "1000" : pkmOnline2.rating}</b>. See 🏆 Ranks → 🏅 Live rating.</div>`;
    }
    if (t === "ranks") {
      const r = o.ranks;
      const boards = [["tower", "🗼 Tower streak"], ["dex", "📕 Pokédex"], ["shiny", "✨ Shiny species"], ["ladder", "📈 Weekly ladder"], ["rating", "🏅 Live rating"], ["guilds", "🛡️ Guilds"], ["front-factory", "🏭 Factory"], ["front-arcade", "🎰 Arcade"], ["front-pike", "🪤 Pike"], ["front-hall", "🏛 Hall"], ["front-castle", "🏰 Castle"]];
      return `<div class="pkm-btns">${boards.map(([k, l]) => `<button type="button" class="pkm-btn2 ${o.board === k ? "primary" : ""}" data-board="${k}">${l}</button>`).join("")}</div>
        ${r && r.top ? `<div class="pkm-dim">${o.board === "guilds" ? `Guild damage this week (${pkmEsc(r.week || "")})` : `Your score: <b>${r.mine == null ? "-" : r.mine}</b>`}${r.rank ? ` · rank #${r.rank}` : ""}</div>
        <table class="lb-table"><tr><th>#</th><th>Trainer</th><th>Score</th></tr>${r.top.map((x) => `<tr class="${x.me ? "me" : ""}"><td>${x.rank}</td><td>${x.tag ? `[${pkmEsc(x.tag)}] ` : ""}${pkmEsc(x.name)} ${pkmBadgeHtml(x.badges)}${x.wl ? ` <span class="pkm-dim">${pkmEsc(x.wl)}</span>` : ""}${x.members ? ` <span class="pkm-dim">${x.members} members</span>` : ""}</td><td>${x.score.toLocaleString()}</td></tr>`).join("") || `<tr><td colspan="3" class="pkm-dim">Nobody yet. Be the first!</td></tr>`}</table>` : `<div class="pkm-dim">Loading…</div>`}`;
    }
    if (t === "events") {
      const e = o.events;
      if (!e) return `<div class="pkm-dim">Loading…</div>`;
      const g = e.gift, r = e.raid, ob = e.outbreak;
      const pct = Math.min(100, Math.round((r.total / r.hp) * 100));
      const down = r.total >= r.hp;
      return `<div class="ev-card"><b>🎁 ${pkmEsc(g.title)}</b><div class="pkm-dim">${g.coins ? `${g.coins} coins` : ""}${(g.items || []).map((x) => ` · ${pkmEsc(String(x[1]))} x ${pkmEsc(String(x[2] || x[0]))}`).join("")}</div><button type="button" class="pkm-btn2 primary" data-ev="gift" ${g.claimed ? "disabled" : ""}>${g.claimed ? "Opened ✓" : "Open the gift"}</button></div>
        <div class="ev-card"><b>🔥 ${pkmEsc(r.title)}: ${pkmEsc(pkmCap(r.species))}</b><div class="pkm-dim">Everyone's damage adds up. ${r.players} trainer${r.players === 1 ? "" : "s"} joined. You dealt ${r.mine.toLocaleString()}. Fights today: ${r.hitsToday}/5.</div>
          <div class="bc-bar ev-bar"><span style="width:${pct}%"></span></div><div class="pkm-dim">${down ? "💥 The boss is down!" : `${r.total.toLocaleString()} / ${r.hp.toLocaleString()} HP (${pct}%)`}</div>
          <div class="pkm-btns"><button type="button" class="pkm-btn2 primary" data-ev="raid" ${down || r.hitsToday >= 5 ? "disabled" : ""}>⚔️ Fight the boss</button><button type="button" class="pkm-btn2" data-ev="raidclaim" ${down && r.mine > 0 && !r.claimed ? "" : "disabled"}>${r.claimed ? "Prize collected ✓" : "Collect the prize"}</button></div></div>
        <div class="ev-card"><b>📣 ${pkmEsc(ob.title)}: ${pkmEsc(pkmCap(ob.species))}</b><div class="pkm-dim">${pkmEsc(pkmCap(ob.species))} shows up often in the Safari Zone this week.</div><button type="button" class="pkm-btn2" data-ev="safari">🦒 Go to the Safari Zone</button></div>`;
    }
    if (t === "friends") {
      const f = o.friends;
      if (!f) return `<div class="pkm-dim">Loading…</div>`;
      const code = String(f.code || "").replace(/(\d{4})(?=\d)/g, "$1-");
      const giftOpts = `<option value="coins">200 coins</option><option value="ub">2 Ultra Balls</option><option value="gb">5 Great Balls</option><option value="pot">3 Potions</option><option value="mon">A Pokémon…</option>`;
      return `<div class="fr-me">Your friend code: <b>${pkmEsc(code)}</b> <button type="button" class="pkm-btn2" data-fr="copy">📋</button></div>
        <div class="pkm-btns"><input class="fr-add" placeholder="Friend's code (12 digits)" aria-label="Friend code"><button type="button" class="pkm-btn2 primary" data-fr="add">Add friend</button></div>
        ${(o.inbox || []).length ? `<div class="bag-sec"><span>🎁 Gifts for you</span></div>${o.inbox.map((g) => `<div class="ol-card"><div class="ol-main"><b>From ${pkmEsc(g.from)}</b><div class="pkm-dim">${g.kind === "coins" ? `${g.gift.coins} coins` : g.kind === "item" ? `${g.gift.n} x ${pkmEsc(g.gift.label || g.gift.item)}` : pkmEsc(pkmShareLabel(g.gift.mon))}</div></div><button type="button" class="pkm-btn2 primary" data-gopen="${g.id}">Open</button></div>`).join("")}` : ""}
        <div class="bag-sec"><span>Friends</span><span class="pkm-dim">${f.friends.length}</span></div>
        ${f.friends.length ? f.friends.map((x) => `<div class="ol-card fr-row"><div class="ol-main"><b>${pkmEsc(x.name)} ${pkmBadgeHtml(x.badges)}</b><div class="pkm-dim">Last seen ${new Date(x.seen * 1000).toLocaleDateString()}</div>
            <div class="pkm-btns">${x.canGift ? `<select class="fr-kind" data-to="${x.pid}" aria-label="Gift">${giftOpts}</select><select class="fr-mon" data-to="${x.pid}" aria-label="Pokémon to give" hidden>${pkmSendOptions()}</select><button type="button" class="pkm-btn2" data-gift="${x.pid}">🎁 Send</button>` : `<span class="pkm-dim">Gift sent today ✓</span>`}<button type="button" class="pkm-btn2" data-unfriend="${x.pid}" title="Remove friend">✕</button></div></div></div>`).join("") : `<div class="pkm-dim">Share your code with friends and add theirs. You can send each friend one gift a day.</div>`}`;
    }
    if (t === "contest") {
      const c = o.contest;
      const cats = Object.entries(PKM_CONTEST);
      return `<div class="pkm-dim">Enter one Pokémon in each contest every week. The best appeal wins. Prizes for last week's top 3 (5000, 3000 and 1500 coins), and 300 coins just for taking part.</div>
        <div class="pkm-btns">${cats.map(([k, v]) => `<button type="button" class="pkm-btn2 ${pkmOnline2.cat === k ? "primary" : ""}" data-ccat="${k}">${v.icon} ${v.name}</button>`).join("")}</div>
        <div class="pkm-btns"><select class="ct-mon" aria-label="Pokémon to enter">${pkmSendOptions() || ""}<option value="${pkmEsc(GM_getValue("pkm_starter_id", ""))}">Your partner</option></select><button type="button" class="pkm-btn2 primary" data-ct="enter">Enter this week</button><button type="button" class="pkm-btn2" data-ct="claim">Collect last week's prize</button></div>
        ${c ? `<div class="bag-sec"><span>${pkmEsc(PKM_CONTEST[pkmOnline2.cat].name)} contest · week ${pkmEsc(c.week.split("-W")[1])}</span></div>
          ${c.entries.length ? `<table class="lb-table"><tr><th>#</th><th>Trainer</th><th>Pokémon</th><th>Appeal</th></tr>${c.entries.map((x) => `<tr class="${x.me ? "me" : ""}"><td>${x.rank}</td><td>${pkmEsc(x.name)} ${pkmBadgeHtml(x.badges)}</td><td><img src="${pkmEsc(pkmShareSprite(x.mon))}" alt="" class="lb-spr">${pkmEsc(pkmShareLabel(x.mon))}</td><td>${x.score}</td></tr>`).join("")}</table>` : `<div class="pkm-dim">No entries yet this week.</div>`}` : `<div class="pkm-dim">Loading…</div>`}`;
    }
    return "";
  }
  /** Appeal for an online contest, from the Pokémon's stats, types, friendship and ribbons. */
  async function pkmContestScore(id, cat) {
    const c = PKM_CONTEST[cat];
    const m = await pkmBuildInstance(id);
    if (!m || !c) return 0;
    const s = (getObj(STORAGE.stats) || {})[id] || {};
    const stat = c.stats.reduce((n, k) => n + (m.stats[k] || 0), 0) / 3;
    const type = m.types.some((x) => c.types.includes(x)) ? 60 : 0;
    const fr = (s.friendship == null ? 70 : s.friendship) / 4;
    return pkmClamp(Math.round(stat + type + fr + (s.ribbons || []).length * 8 + m.level / 2 + (m.shiny ? 15 : 0)), 0, 999);
  }
  async function pkmOnline2Click(e) {
    const P = pkmOnlinePanel;
    if (!P) return;
    const g = (k) => e.target.closest(`[${k}]`);
    if (g("data-board")) { pkmOnline2.board = g("data-board").dataset.board; pkmOnline2.ranks = null; pkmDrawOnline(); return pkmOnlineDo(pkmOnlineRefresh); }
    if (g("data-ccat")) { pkmOnline2.cat = g("data-ccat").dataset.ccat; pkmOnline2.contest = null; pkmDrawOnline(); return pkmOnlineDo(pkmOnlineRefresh); }
    const ev = g("data-ev")?.dataset.ev;
    if (ev === "gift") return pkmOnlineDo(async () => { const r = await pkmApi("gift_claim", { id: pkmOnline2.events.gift.id }); pkmToast(`🎁 You got ${pkmApplyServerReward(r.coins, r.items)}!`, 5000); await pkmOnlineRefresh(); });
    if (ev === "raidclaim") return pkmOnlineDo(async () => { const r = await pkmApi("raid_claim", { id: pkmOnline2.events.raid.id }); pkmToast(`🏆 Raid prize: ${pkmApplyServerReward(r.coins, r.items)}!`, 5000); await pkmOnlineRefresh(); });
    if (ev === "raid") return pkmGlobalRaidFight(pkmOnline2.events.raid);
    if (ev === "safari") { pkmCloseOnline(); return pkmOpenSafari(); }
    const fr = g("data-fr")?.dataset.fr;
    if (fr === "copy") { navigator.clipboard?.writeText(String(pkmOnline2.friends.code)).then(() => pkmToast("Friend code copied.")); return; }
    if (fr === "add") return pkmOnlineDo(async () => { const r = await pkmApi("friend_add", { code: P.querySelector(".fr-add").value }); pkmToast(`👥 ${r.name} is your friend now!`); await pkmOnlineRefresh(); });
    if (g("data-unfriend")) return pkmOnlineDo(async () => { await pkmApi("friend_remove", { target: +g("data-unfriend").dataset.unfriend }); await pkmOnlineRefresh(); });
    if (g("data-gift")) return pkmOnlineDo(() => pkmSendFriendGift(+g("data-gift").dataset.gift));
    if (g("data-gopen")) return pkmOnlineDo(async () => {
      const r = await pkmApi("fgift_claim", { id: +g("data-gopen").dataset.gopen });
      let what = "";
      if (r.kind === "coins") what = pkmApplyServerReward(Math.min(1000, r.gift.coins), []);
      else if (r.kind === "item") what = pkmApplyServerReward(0, [[r.gift.item, Math.min(5, r.gift.n), r.gift.label]]);
      else if (r.kind === "mon") { await pkmDeliver(r.gift.mon, "gift"); what = pkmShareLabel(r.gift.mon); }
      pkmToast(`🎁 ${r.from} sent you ${what}!`, 5000);
      await pkmOnlineRefresh();
    });
    const ct = g("data-ct")?.dataset.ct;
    if (ct === "enter") return pkmOnlineDo(async () => {
      const id = P.querySelector(".ct-mon").value;
      const mon = pkmMonShare(id);
      if (!mon) throw new Error("Pick a Pokémon.");
      mon.h = ""; mon.g = pkmGenderOf(id);
      const score = await pkmContestScore(id, pkmOnline2.cat);
      await pkmApi("contest_enter", { cat: pkmOnline2.cat, mon, score });
      pkmToast(`🎀 ${pkmCap(mon.s)} entered with an appeal of ${score}!`, 4000);
      await pkmOnlineRefresh();
    });
    if (ct === "claim") return pkmOnlineDo(async () => { const r = await pkmApi("contest_claim", { cat: pkmOnline2.cat }); pkmToast(`🎀 You placed #${r.rank} last week! ${pkmApplyServerReward(Math.min(5000, r.coins), [])}.`, 5000); });
    const lv = g("data-lv")?.dataset.lv;
    if (lv === "host") return pkmOnlineDo(() => pkmLiveHost(false));
    if (lv === "ranked") return pkmOnlineDo(() => pkmLiveHost(true));
    if (lv === "watch") { const code = P.querySelector(".lv-watch").value.trim(); if (!code) return pkmToast("Type the battle code to watch."); pkmCloseOnline(); return pkmOpenLive(0, "", code); }
    if (lv === "join") return pkmOnlineDo(() => pkmLiveJoin(P.querySelector(".lv-join").value));
    if (lv === "cancel") { pkmLiveStopPoll(); if (pkmOnline2.live) pkmApi("live_leave", { id: pkmOnline2.live.id }).catch(() => {}); pkmOnline2.live = null; return pkmDrawOnline(); }
  }
  // the friend-gift kind picker shows the Pokémon list when "A Pokémon…" is chosen
  document.addEventListener("change", (e) => {
    const el = e.composedPath()[0];
    if (!el || !el.classList || !el.classList.contains("fr-kind")) return;
    const mon = el.parentElement.querySelector(".fr-mon");
    if (mon) mon.hidden = el.value !== "mon";
  }, true);
  async function pkmSendFriendGift(to) {
    const P = pkmOnlinePanel;
    const kind = P.querySelector(`.fr-kind[data-to="${to}"]`).value;
    const items = { ub: [STORAGE.ultraBalls, 2, "Ultra Balls"], gb: [STORAGE.greatBalls, 5, "Great Balls"], pot: [STORAGE.potions, 3, "Potions"] };
    if (kind === "coins") {
      if (getInt(STORAGE.coins) < 200) throw new Error("You need 200 coins.");
      await pkmApi("fgift_send", { to, kind: "coins", amount: 200 });
      setInt(STORAGE.coins, getInt(STORAGE.coins) - 200);
    } else if (items[kind]) {
      const [key, n, label] = items[kind];
      if (getInt(key) < n) throw new Error(`You need ${n} ${label}.`);
      await pkmApi("fgift_send", { to, kind: "item", item: key, amount: n, label });
      setInt(key, getInt(key) - n);
    } else {
      const id = P.querySelector(`.fr-mon[data-to="${to}"]`).value;
      const p = pkmPackForSend(id);
      if (p.err) throw new Error(p.err);
      await pkmApi("fgift_send", { to, kind: "mon", mon: p.mon });
      pkmRemoveMon(id);
    }
    pkmToast("🎁 Gift sent!");
    await pkmOnlineRefresh();
  }

  // ---------- Shared raid (everyone's damage adds up) ----------
  function pkmGlobalRaidFight(r, backTab = "events") {
    if (!r) return;
    pkmForcedWild = { name: r.species, level: pkmClamp(r.level || 75, 1, MAX_LEVEL), globalRaid: r.id };
    pkmPostBattle = () => pkmOpenOnline(backTab);
    pkmCloseOnline();
    openBattle();
    if (!battlePanel) { pkmForcedWild = null; pkmPostBattle = null; }
  }
  {
    const pw = pkmPickWild;
    pkmPickWild = async function () {
      const f = pkmForcedWild;
      const m = await pw.apply(this, arguments);
      if (m && f && f.globalRaid) { m.maxHP = m.maxHP * 12; m.hp = m.maxHP; m.globalRaid = f.globalRaid; m.display = `Raid Boss ${m.display}`; }
      return m;
    };
    const tb = throwBall;
    throwBall = function () { if (pkb && pkb.foe && pkb.foe.globalRaid) return drawBattle("You can't catch the shared raid boss. Hit it as hard as you can!"); return tb.apply(this, arguments); };
    const tn = pkmTurn;
    pkmTurn = async function () {
      const b = pkb;
      const r = await tn.apply(this, arguments);
      if (b && b.foe && b.foe.globalRaid && pkmAlive(b) && !b.over) {
        b.raidTurns = (b.raidTurns || 0) + 1;
        if (b.raidTurns >= 10) { b.over = true; b.result = "Raid"; await pkmSay(b, "The raid boss is too strong! Time's up after 10 turns.", 1200); closeBattle(); }
      }
      return r;
    };
    const cb = closeBattle;
    closeBattle = function (...a) {
      const b = pkb;
      if (b && b.foe && b.foe.globalRaid) {
        const dmg = Math.max(0, Math.round(b.foe.maxHP - Math.max(0, b.foe.hp)));
        const id = b.foe.globalRaid;
        b.foe.globalRaid = null;
        pkmApi(/^guild-/.test(id) ? "guild_raid_hit" : "raid_hit", { id, dmg }).then((x) => pkmToast(`🔥 You dealt ${x.added.toLocaleString()} damage to the raid boss! Total: ${x.total.toLocaleString()} / ${x.hp.toLocaleString()}.`, 5000), (e) => pkmToast(e.message, 4000));
      }
      return cb.apply(this, a);
    };
  }

  // ---------- Live battles ----------
  let pkmLivePoll = null;
  const pkmLiveStopPoll = () => { if (pkmLivePoll) clearInterval(pkmLivePoll); pkmLivePoll = null; };
  const pkmLiveTeam = () => Object.keys(getObj(STORAGE.party) || {}).slice(0, PKM_PARTY_SIZE).map((id) => { const m = pkmMonShare(id); if (m) { m.h = ""; m.g = pkmGenderOf(id); } return m; }).filter(Boolean);
  async function pkmLiveHost(ranked, bo3) {
    const team = pkmLiveTeam();
    if (!team.length) throw new Error("You need a party first.");
    await pkmOnlineLogin();
    const r = await pkmApi("live_create", { team, ranked: !!ranked, bo3: !!bo3 });
    pkmOnline2.live = { id: r.id, code: r.code, role: "host", status: "wait", ranked: !!ranked };
    pkmLiveStopPoll();
    pkmLivePoll = setInterval(async () => {
      if (!pkmOnline2.live || pkmOnline2.live.id !== r.id) return pkmLiveStopPoll();
      try {
        const x = await pkmApi("live_get", { id: r.id });
        if (x.status === "live" && Array.isArray(x.guestTeam)) { pkmLiveStopPoll(); pkmOnline2.live = null; pkmLiveStart(x); }
        else if (x.status === "over") { pkmLiveStopPoll(); pkmOnline2.live = null; if (pkmOnlinePanel) pkmDrawOnline(); }
      } catch {}
    }, 2000);
  }
  function pkmLiveStart(x) {
    const team = x.guestTeam.map(pkmCleanShare).filter(Boolean).map((m) => ({ ...m, held: null }));
    if (!team.length) return pkmToast("Your friend's team didn't load.");
    pkmCloseOnline();
    pkmToast(`⚔️ ${x.guest} joined! The battle starts.`, 3000);
    pkmPostBattle = () => pkmOpenOnline("live");
    const bo3 = !!(x.bo3 || (x.series && x.series.bo === 3));
    if (bo3) healPokemon();
    pkmStartTrainer({ title: bo3 ? `Live battle · game ${(x.series && x.series.game) || 1} of 3` : "Live battle", name: x.guest || "Friend", sprite: `${PKM_TRAINER_IMG}acetrainer.png`, lose: "GG!", team, pvp: true, gym: 0, live: { id: x.id, turn: 1, last: "", guestTeam: x.guestTeam, bo3, series: x.series || null } });
    if (!battlePanel) pkmPostBattle = null;
  }
  const pkmLiveMini = (m) => (m ? { n: m.display, lv: m.level, hp: Math.max(0, m.hp), max: m.maxHP, st: m.status || "", img: m.front, t: m.types } : null);
  function pkmLiveSnapshot(b, over) {
    const L = b.trainer.live;
    const pct = (m) => (m ? Math.max(0, Math.round((m.hp / m.maxHP) * 100)) : 0);
    return {
      turn: L.turn, over: !!over, winner: over ? (b.result === "Won" ? "host" : "guest") : null, msg: b.msg || "",
      host: { name: pkmTrainerName(), mon: pkmLiveMini(b.me), team: b.roster.map((r) => (r.mon ? pct(r.mon) : pkmRosterHP(r).hp > 0 ? 100 : 0)) },
      guest: { mon: pkmLiveMini(b.foe), team: b.team.map(pct), moves: (b.foe.moves || []).map((m) => ({ n: m.display, t: m.type, pp: m.pp, max: m.maxPP, s: m.cls === "status" ? 1 : 0 })),
        bench: b.team.map((m, i) => ({ i, n: m.display, hp: Math.max(0, m.hp), max: m.maxHP, cur: m === b.foe ? 1 : 0, img: m.front })) },
      log: (b.log || []).slice(-8),
    };
  }
  async function pkmLivePush(b, over) {
    if (!b || !b.trainer || !b.trainer.live || !b.me || !b.foe || !b.team || !b.roster) return;
    const s = pkmLiveSnapshot(b, over);
    const k = JSON.stringify(s);
    if (!over && k === b.trainer.live.last) return;
    b.trainer.live.last = k;
    return await pkmApi("live_state", { id: b.trainer.live.id, turn: b.trainer.live.turn, state: s }).catch(() => null);
  }
  setInterval(() => { const b = pkb; if (b && b.trainer && b.trainer.live && !b.over) pkmLivePush(b); }, 2000);
  /** The guest asked to switch: the host's game sends in that Pokémon (it uses up the guest's turn). */
  async function pkmLiveFoeSwitch(b, i) {
    const m = b.team[i];
    if (!m || m.hp <= 0 || m === b.foe) return false;
    const old = b.foe;
    old.stages = { atk: 0, def: 0, spa: 0, spd: 0, spe: 0, acc: 0, eva: 0 };
    old.confused = 0; old.charging = null; old.invuln = false; old.sub = 0; old.mustRecharge = false; old.entered = false;
    pkmEndDynamax(old);
    b.foe = m;
    b.foeIdx = i;
    b.shown && (b.shown.foe = null);
    pkmSyncGlobals(b);
    await pkmSay(b, `${b.trainer.name} called back ${old.display} and sent out ${m.display}!`, 900);
    await pkmOnEntry(b, b.foe, b.me);
    return true;
  }
  {
    const um = pkmUseMove;
    pkmUseMove = async function (b, att) {
      if (b && b.liveSkipFoe && att === b.foe) { b.liveSkipFoe = false; return; }
      return um.apply(this, arguments);
    };
  }
  async function pkmLiveWaitMove(b) {
    const L = b.trainer.live;
    const t0 = Date.now();
    await pkmLivePush(b);
    while (pkmAlive(b) && Date.now() - t0 < 90000) {
      try {
        const x = await pkmApi("live_get", { id: L.id });
        if (x.status === "over") return "forfeit";
        if (x.guestMove && x.guestMove.turn === L.turn) return x.guestMove.move;
      } catch {}
      await new Promise((r) => setTimeout(r, 1500));
    }
    return null;
  }
  {
    const tn = pkmTurn;
    pkmTurn = async function () {
      const b = pkb;
      if (!b || !b.trainer || !b.trainer.live || b.liveGo) return tn.apply(this, arguments);
      if (b.busy || b.awaitSwitch || b.awaitRevive || !pkmAlive(b)) return;
      b.busy = true;
      drawBattle(`Waiting for ${b.trainer.name} to choose a move…`);
      const mv = await pkmLiveWaitMove(b);
      b.busy = false;
      if (!pkmAlive(b)) return;
      if (mv === "forfeit") {
        await pkmSay(b, `${b.trainer.name} forfeited the battle.`, 1200);
        b.team.forEach((m) => { m.hp = 0; });
        return pkmWin(b);
      }
      b.liveMove = mv == null ? null : mv;
      if (typeof mv === "string" && /^s\d$/.test(mv)) { b.liveMove = null; if (await pkmLiveFoeSwitch(b, +mv.slice(1))) b.liveSkipFoe = true; if (!pkmAlive(b)) return; }
      b.liveGo = true;
      try { await tn.apply(this, arguments); } finally { b.liveGo = false; b.liveSkipFoe = false; }
      b.trainer.live.turn++;
      pkmLivePush(b);
    };
    const ai = pkmAiMove;
    pkmAiMove = function (foe, me, b) {
      const bb = b || pkb;
      if (bb && bb.trainer && bb.trainer.live && bb.liveMove != null && foe === bb.foe) {
        const m = foe.moves[bb.liveMove];
        bb.liveMove = null;
        if (m && m.pp > 0) return m;
      }
      return ai.apply(this, arguments);
    };
    const cb = closeBattle;
    closeBattle = function (...a) {
      const b = pkb;
      if (b && b.trainer && b.trainer.live && !b.trainer.live.done) {
        b.trainer.live.done = true;
        if (!b.result) b.result = "Lost";
        const L = b.trainer.live, guest = b.trainer.name;
        const pr = pkmLivePush(b, true);
        if (L.bo3) {
          const pb = pkmPostBattle;
          pkmPostBattle = () => pr.then((res) => {
            const se = res && res.series;
            if (se && !se.done) {
              pkmToast(`⚔️ Best of 3: ${se.host}–${se.guest}. Game ${se.game} starts…`, 3000);
              setTimeout(() => pkmLiveStart({ id: L.id, guest, guestTeam: L.guestTeam, bo3: true, series: { bo: 3, ...se } }), 1800);
            } else {
              if (se) pkmToast(se.winner === "host" ? `🏆 You won the series ${se.host}–${se.guest}!` : `You lost the series ${se.host}–${se.guest}. GG!`, 5000);
              if (pb) pb();
            }
          });
        }
      }
      return cb.apply(this, a);
    };
  }
  // Guest side: a small screen that shows the host's battle and sends your moves
  let pkmLivePanel = null;
  let pkmLiveView = null;
  function pkmCloseLive() { pkmLiveStopPoll(); if (pkmLivePanel) pkmLivePanel.remove(); pkmLivePanel = null; pkmLiveView = null; }
  async function pkmLiveJoin(code) {
    const team = pkmLiveTeam();
    if (!team.length) throw new Error("You need a party first.");
    await pkmOnlineLogin();
    const r = await pkmApi("live_join", { code: String(code || "").trim(), team });
    pkmCloseOnline();
    pkmOpenLive(r.id, r.host);
  }
  function pkmOpenLive(id, host, watchCode) {
    pkmCloseLive();
    pkmLiveView = { id, host, x: null, sent: 0, lastSeen: Date.now(), watch: watchCode || "" };
    pkmLivePanel = pkmMakePanel("pkm-live", "Live battle", (e) => {
      const v = pkmLiveView;
      if (!v) return;
      if (e.target.closest("[data-a='close']") && v.watch) return pkmCloseLive();
      if (e.target.closest("[data-a='close']")) { if (v.x && v.x.status !== "over" && !confirm("Leave the battle? You'll lose.")) return; if (v.x && v.x.status !== "over") pkmApi("live_move", { id, turn: (v.x.state || {}).turn || 0, move: "forfeit" }).catch(() => {}); return pkmCloseLive(); }
      const mv = e.target.closest("[data-lmove]");
      if (mv && !mv.disabled && v.x && v.x.state) {
        const turn = v.x.state.turn;
        const m = mv.dataset.lmove === "forfeit" ? "forfeit" : /^s\d$/.test(mv.dataset.lmove) ? mv.dataset.lmove : +mv.dataset.lmove;
        v.sent = turn;
        pkmApi("live_move", { id, turn, move: m }).catch((err) => { v.sent = 0; pkmToast(err.message); });
        pkmDrawLive();
      }
    });
    pkmDrawLive();
    const tick = async () => {
      const v = pkmLiveView;
      if (!v || v.id !== id) return;
      try {
        const x = v.watch ? await pkmApi("live_watch", { code: v.watch }) : await pkmApi("live_get", { id });
        if (!pkmLiveView) return;
        if (v.watch) { v.host = x.host; v.guestName = x.guest; }
        if (v.x && x.series && v.x.series && x.series.game !== v.x.series.game) v.sent = 0;
        if (!v.x || x.updated !== v.x.updated || (x.state || {}).turn !== ((v.x || {}).state || {}).turn) v.lastSeen = Date.now();
        v.x = x;
        pkmDrawLive();
        if (x.status === "over") pkmLiveStopPoll();
      } catch (err) { v.err = err.message; pkmDrawLive(); }
    };
    tick();
    pkmLivePoll = setInterval(tick, 1500);
  }
  function pkmDrawLive() {
    const v = pkmLiveView;
    const P = pkmLivePanel;
    if (!v || !P) return;
    const s = v.x && v.x.state;
    const bar = (m) => { const p = m ? Math.round((m.hp / m.max) * 100) : 0; return `<div class="pkb-hp"><span style="width:${p}%;background:${p > 50 ? "#2fbf71" : p > 20 ? "#ffb020" : "#ff4d4f"}"></span></div>`; };
    const side = (m, team, label) => (m ? `<div class="lvw-side"><img src="${pkmEsc(m.img)}" alt=""><div><b>${pkmEsc(label)}: ${pkmEsc(m.n)}</b> <span class="pkm-dim">Lv ${m.lv}${m.st ? ` · ${pkmEsc(m.st.toUpperCase())}` : ""}</span>${bar(m)}<div class="pkm-dim">${m.hp}/${m.max} HP · ${team.map((p) => (p > 0 ? "●" : "○")).join("")}</div></div></div>` : "");
    let body;
    if (!s) body = `<div class="pkm-dim">${v.x && v.x.status === "live" ? `Waiting for ${pkmEsc(v.host)} to start…` : "Connecting…"}</div>`;
    else {
      const waiting = v.sent === s.turn;
      const stale = Date.now() - v.lastSeen > 180000 && !s.over;
      if (v.watch) {
        body = `<div class="pkm-dim">👀 Watching${v.x && v.x.ranked ? " a ranked battle" : ""}</div>${side(s.host.mon, s.host.team, s.host.name)}${side(s.guest.mon, s.guest.team, v.guestName || "Guest")}
          <div class="lvw-log">${(s.log || []).map((l) => `<div>${pkmEsc(l)}</div>`).join("")}</div>
          ${s.over ? `<div class="lvw-end">🏆 ${pkmEsc(s.winner === "host" ? s.host.name : v.guestName || "Guest")} won!</div>` : ""}`;
        P.innerHTML = `${pkmPanelHead(`👀 ${pkmEsc(v.host || "")} vs ${pkmEsc(v.guestName || "")}`, "lv-head")}<div class="lk-body">${v.err ? `<div class="bag-msg ol-err">⚠️ ${pkmEsc(v.err)}</div>` : ""}${body}</div>`;
        return;
      }
      const bench = (s.guest.bench || []).filter((m) => !m.cur);
      body = `${side(s.host.mon, s.host.team, s.host.name)}${side(s.guest.mon, s.guest.team, "You")}
        <div class="lvw-log">${(s.log || []).map((l) => `<div>${pkmEsc(l)}</div>`).join("")}</div>
        ${s.over ? `<div class="lvw-end">${s.winner === "guest" ? "🏆 You won!" : "You lost. Good game!"}</div>`
          : stale ? `<div class="pkm-dim">${pkmEsc(v.host)} hasn't moved for a while. They may have left.</div>`
          : `<div class="pkm-dim">${waiting ? `Waiting for ${pkmEsc(v.host)}…` : "Choose your move:"}</div>
            <div class="pk-controls lvw-moves">${s.guest.moves.map((m, i) => `<button type="button" class="pk-btn pkb-move t-${pkmEsc(m.t)}" data-lmove="${i}" ${waiting || m.pp <= 0 || s.guest.mon.hp <= 0 ? "disabled" : ""}><div class="pk-label">${pkmEsc(m.n)}</div><div class="pkb-mv-sub"><span class="pk-type ${pkmEsc(m.t)}">${pkmEsc(m.t)}</span><span>PP ${m.pp}/${m.max}</span></div></button>`).join("")}
            <button type="button" class="pk-btn pkb-act" data-lmove="forfeit" ${waiting ? "disabled" : ""}><div class="pk-ico">🏳️</div><div class="pk-label">Forfeit</div></button></div>
            ${bench.length ? `<div class="pkm-dim">Or switch (uses your turn):</div><div class="pkm-btns lvw-bench">${bench.map((m) => `<button type="button" class="pkm-btn2" data-lmove="s${m.i}" ${waiting || m.hp <= 0 ? "disabled" : ""}><img src="${pkmEsc(m.img)}" alt="" class="lb-spr">${pkmEsc(m.n)} <span class="pkm-dim">${m.hp}/${m.max}</span></button>`).join("")}</div>` : ""}`}`;
    }
    const se = v.x && v.x.series;
    if (se && se.bo === 3) body = `<div class="lvw-series">Best of 3 · game ${se.game} · <b>${pkmEsc(v.host || "Host")} ${se.host} – ${se.guest} You</b></div>` + body;
    P.innerHTML = `${pkmPanelHead(`⚔️ Live battle vs ${pkmEsc(v.host || "Friend")}`, "lv-head")}<div class="lk-body">${v.err ? `<div class="bag-msg ol-err">⚠️ ${pkmEsc(v.err)}</div>` : ""}${body}</div>`;
  }

  // ---------- Shared replays (Options → Battle logs) ----------
  {
    const dro = pkmDrawOptions;
    pkmDrawOptions = function () {
      const r = dro.apply(this, arguments);
      const P = pkmOptionsPanel;
      if (!P || pkmOptionsTab !== "logs" || P.querySelector(".rp-open")) return r;
      const body = P.querySelector(".lk-body");
      body.insertAdjacentHTML("afterbegin", `<div class="pkm-btns rp-open"><input class="rp-id" placeholder="Paste a replay link or code" aria-label="Replay link" style="flex:1"><button type="button" class="pkm-btn2" data-rp="open">▶ Watch</button></div>`);
      P.querySelectorAll("[data-log]").forEach((b) => b.insertAdjacentHTML("afterend", `<button type="button" class="pkm-btn2" data-rpshare="${b.dataset.log}" title="Share a link to this replay">🔗 Share</button>`));
      P.querySelectorAll("[data-rp],[data-rpshare]").forEach((b) => (b.onclick = async (e) => {
        e.stopPropagation();
        try {
          if (b.dataset.rp === "open") {
            const m = /([a-z0-9]{10})\s*$/.exec(P.querySelector(".rp-id").value.trim());
            if (!m) return pkmToast("Paste a replay link (it ends in a 10-letter code).");
            const x = await pkmApi("replay_get", { id: m[1] });
            pkmReplayLog = { t: x.created * 1000, title: `${x.title} (by ${x.owner})`, result: x.result, lines: x.lines };
            return pkmDrawOptions();
          }
          const log = pkmJSON("pkm_battle_logs", [])[+b.dataset.rpshare];
          if (!log) return;
          await pkmOnlineLogin();
          const x = await pkmApi("replay_share", { title: log.title, result: log.result || "", lines: log.lines });
          const url = `${pkmServerUrl()}replay.php?id=${x.id}`;
          navigator.clipboard?.writeText(url).catch(() => {});
          pkmToast(`🔗 Replay link copied: ${url}`, 7000);
        } catch (err) { pkmToast(err.message || "Couldn't reach the game server.", 4000); }
      }));
      return r;
    };
  }

  // ---------- Safari outbreak (from the server, or a weekly pick when offline) ----------
  const PKM_OUTBREAK_LOCAL = ["eevee", "dratini", "chansey", "scyther", "pinsir", "tauros", "kangaskhan", "larvitar", "bagon", "gible", "riolu", "axew", "deino", "goomy", "jangmo-o", "dreepy", "ralts", "beldum"];
  function pkmOutbreakSpecies() {
    const c = pkmJSON("pkm_srv_events", null);
    const o = c && c.d && c.d.outbreak;
    if (o && o.species && (!o.ends || o.ends * 1000 > Date.now()) && c.d.week === pkmWeekId()) return o.species;
    const w = pkmWeekId();
    return PKM_OUTBREAK_LOCAL[(parseInt(w.slice(-2), 10) + parseInt(w.slice(0, 4), 10)) % PKM_OUTBREAK_LOCAL.length];
  }
  const pkmSafariOutbreakPick = () => (Math.random() < 0.3 ? pkmOutbreakSpecies() : null);
  {
    const ds = pkmDrawSafari;
    pkmDrawSafari = function () {
      const r = ds.apply(this, arguments);
      const P = pkmSafariPanel;
      if (P && !P.querySelector(".sf-outbreak")) { const bar = P.querySelector(".sf-bar") || P.querySelector(".pkm-set-head"); if (bar) bar.insertAdjacentHTML("afterend", `<div class="sf-outbreak">📣 Outbreak this week: <b>${pkmEsc(pkmCap(pkmOutbreakSpecies()))}</b> appears often!</div>`); }
      return r;
    };
  }

  // ---------- Weather events on the map (snowstorms bring Ice types, and so on) ----------
  const PKM_STORMS = [
    { id: "snow", name: "snowstorm", icon: "🌨️", weather: "hail", kind: "Ice", pool: ["snorunt", "swinub", "snover", "vanillite", "cubchoo", "bergmite", "snom", "spheal", "sneasel", "delibird", "smoochum", "cryogonal", "glalie", "sealeo"] },
    { id: "heat", name: "heatwave", icon: "🔥", weather: "sun", kind: "Fire", pool: ["vulpix", "growlithe", "ponyta", "magby", "slugma", "numel", "torkoal", "houndour", "litleo", "salandit", "sizzlipede", "litwick", "darumaka", "heatmor"] },
    { id: "thunder", name: "thunderstorm", icon: "⛈️", weather: "rain", kind: "Electric", pool: ["pikachu", "magnemite", "voltorb", "elekid", "mareep", "electrike", "shinx", "blitzle", "tynamo", "joltik", "helioptile", "yamper", "pawmi", "pichu"] },
    { id: "fog", name: "thick fog", icon: "🌫️", weather: null, kind: "Ghost and Psychic", pool: ["gastly", "misdreavus", "shuppet", "duskull", "drifloon", "phantump", "pumpkaboo", "sinistea", "abra", "natu", "ralts", "espurr", "hatenna", "litwick"] },
    { id: "sand", name: "sandstorm", icon: "🏜️", weather: "sand", kind: "Ground and Rock", pool: ["sandshrew", "diglett", "geodude", "onix", "larvitar", "trapinch", "gible", "hippopotas", "drilbur", "sandile", "rolycoly", "silicobra", "nacli", "rhyhorn"] },
  ];
  /** The weather event in a region right now (changes every 4 hours, the same for everyone), or null. */
  function pkmMapStorm(region) {
    const f = GM_getValue("pkm_storm_force", "");
    if (f) return PKM_STORMS.find((s) => s.id === f) || null;
    const slot = Math.floor(Date.now() / (4 * 3600e3));
    const r = pkmRng(pkmHash(`${region}:${slot}`, 7))();
    return r < 0.3 ? PKM_STORMS[Math.floor((r / 0.3) * PKM_STORMS.length) % PKM_STORMS.length] : null;
  }
  {
    const zw = pkmZoneWild;
    pkmZoneWild = async function (z) {
      const s = z && pkmMapStorm(z.region);
      const sw = pkmSwarm();
      // a swarm in this place wins over the weather event
      if (s && z.theme !== "cave" && !(sw && sw.zone && sw.zone.id === z.id) && Math.random() < 0.35) {
        const d = await pkmPokemonData(pkmPick(s.pool)).catch(() => null);
        if (d) { const m = await pkmWildFrom(d, pkmClamp(pkmRand(z.lv[0], z.lv[1]) + pkmDiffOffset(), 2, MAX_LEVEL), {}); m.zone = z.id; m.storm = s.id; return m; }
      }
      return zw.apply(this, arguments);
    };
    const zwx = pkmZoneWeather;
    pkmZoneWeather = function (zoneId) {
      const z = pkmZoneById(zoneId);
      const s = z && z.theme !== "cave" && pkmMapStorm(z.region);
      if (s && s.weather) return s.weather;
      return zwx.apply(this, arguments);
    };
    const oe = pkmOpenExplore;
    pkmOpenExplore = function (zoneId) {
      const r = oe.apply(this, arguments);
      const z = pkmZoneById(zoneId);
      const s = z && pkmMapStorm(z.region);
      const P = pkmExplorePanel;
      if (s && P && !P.querySelector(".mp-storm")) { const m = P.querySelector(".pkb-msg"); if (m) m.insertAdjacentHTML("afterend", `<div class="mp-storm">${s.icon} A ${pkmEsc(s.name)} is sweeping ${pkmEsc(pkmRegion(z.region).name)}! ${pkmEsc(s.kind)}-type Pokémon are out.</div>`); }
      return r;
    };
    const om = pkmOpenMap;
    pkmOpenMap = function () {
      const r = om.apply(this, arguments);
      const P = pkmMapPanel;
      if (P && !P.querySelector(".mp-storms")) {
        const list = PKM_REGIONS.filter((x, i) => pkmRegionOpen(i)).map((x) => [x, pkmMapStorm(x.id)]).filter(([, s]) => s);
        if (list.length) P.querySelector(".pkm-set-head")?.insertAdjacentHTML("afterend", `<div class="mp-storms">${list.map(([x, s]) => `<span>${s.icon} ${pkmEsc(pkmCap(s.name))} in ${pkmEsc(x.name)}</span>`).join("")}</div>`);
      }
      return r;
    };
  }

  // ---------- Habitat map (which Pokémon live where, and which you've caught) ----------
  let pkmHabPanel = null;
  let pkmHabRegion = "kanto";
  function pkmCloseHabitats() { if (pkmHabPanel) pkmHabPanel.remove(); pkmHabPanel = null; }
  function pkmOpenHabitats(region) {
    if (typeof region === "string") pkmHabRegion = region;
    if (!pkmHabPanel) pkmHabPanel = pkmMakePanel("pkm-hab", "Habitat map", (e) => {
      const a = e.target.closest("[data-a]")?.dataset.a;
      if (a === "close") return pkmCloseHabitats();
      const r = e.target.closest("[data-hreg]");
      if (r && !r.disabled) return pkmOpenHabitats(r.dataset.hreg);
      const z = e.target.closest("[data-hzone]");
      if (z && !z.disabled) { pkmCloseHabitats(); pkmOpenExplore(z.dataset.hzone); }
    });
    const dex = new Set((getArr(STORAGE.pokedex) || []).map((p) => String(p.name).toLowerCase()));
    const zones = (PKM_ZONES[pkmHabRegion] || []).filter((z) => !z.event || z.event === (pkmCurrentEvent() || {}).id).map((z) => ({ ...z, region: pkmHabRegion }));
    const all = new Set(zones.flatMap((z) => z.pool));
    const have = [...all].filter((n) => dex.has(n)).length;
    pkmHabPanel.innerHTML = `${pkmPanelHead("🗺️ Habitat map", "hb-head")}<div class="lk-body">
      <div class="bag-tabs" role="tablist">${PKM_REGIONS.map((x, i) => `<button type="button" role="tab" data-hreg="${x.id}" aria-selected="${x.id === pkmHabRegion}" ${pkmRegionOpen(i) ? "" : "disabled"}>${x.icon} ${pkmEsc(x.name)}</button>`).join("")}</div>
      <div class="pkm-dim">${have}/${all.size} of the Pokémon that live in ${pkmEsc(pkmRegion(pkmHabRegion).name)} are in your Pokédex. Gray ones are still to catch. Click a place to go there.</div>
      <div class="hb-list">${zones.map((z) => { const got = z.pool.filter((n) => dex.has(n)).length; const open = pkmZoneOpen(z); return `<div class="hb-zone"><button type="button" class="hb-zh" data-hzone="${z.id}" ${open ? "" : "disabled"}><b>${z.icon} ${pkmEsc(z.name)}</b><span class="pkm-dim">Lv ${z.lv[0]}-${z.lv[1]} · ${got}/${z.pool.length}${open ? "" : " · 🔒"}</span></button>
        <div class="hb-mons">${z.pool.map((n) => `<img src="https://play.pokemonshowdown.com/sprites/gen5/${pkmEsc(n)}.png" alt="${pkmEsc(pkmCap(n))}" title="${pkmEsc(pkmCap(n))}${dex.has(n) ? "" : " (not caught)"}" class="${dex.has(n) ? "" : "miss"}" loading="lazy">`).join("")}</div></div>`; }).join("")}</div></div>`;
    pkmHabPanel.querySelectorAll(".hb-mons img").forEach((img) => { img.onerror = () => { img.style.visibility = "hidden"; }; });
  }

  // ---------- Your partner's mood while it walks with you ----------
  function pkmPartnerMood() {
    const id = GM_getValue("pkm_starter_id");
    const s = (getObj(STORAGE.stats) || {})[id] || {};
    const p = (getObj(STORAGE.party) || {})[id];
    if (!p) return null;
    const name = pkmCap(p.name);
    const f = s.friendship == null ? 70 : s.friendship;
    const st = activeStats();
    const hp = st.currentHP != null ? st.currentHP : st.hp;
    if (hp <= 0) return ["😵", `${name} fainted. Heal it at a Pokémon Center.`];
    if (hp < st.hp * 0.3) return ["🤕", `${name} is hurt and needs a rest.`];
    if (pkmIsNight() && f < 220) return ["😴", `${name} is getting sleepy.`];
    if (f >= 220) return ["💖", `${name} loves walking with you!`];
    if (f >= 150) return ["😊", `${name} is happy to be with you.`];
    if (f >= 90) return ["🙂", `${name} seems content.`];
    return ["😐", `${name} is still getting used to you. Try ⛺ Pokémon Camp!`];
  }
  let pkmMoodTick = 0;
  function pkmShowMood(force) {
    if (!spriteWrapperEl || document.hidden) return;
    let el = spriteWrapperEl.querySelector(".pkm-mood");
    if (!el) {
      el = document.createElement("button");
      el.type = "button";
      el.className = "pkm-mood";
      el.onclick = (e) => { e.stopPropagation(); const m = pkmPartnerMood(); if (m) pkmToast(`${m[0]} ${m[1]}`, 3500); };
      spriteWrapperEl.appendChild(el);
    }
    const m = pkmPartnerMood();
    if (!m) return;
    el.textContent = m[0];
    el.title = m[1];
    el.setAttribute("aria-label", m[1]);
    pkmMoodTick++;
    if (force || pkmMoodTick % 2 === 0) { el.classList.add("show"); setTimeout(() => el.classList.remove("show"), 6000); }
  }
  setTimeout(() => pkmShowMood(true), 5000);
  setInterval(() => pkmShowMood(false), 30000);

  // ---------- Panels ----------
  PKM_PANELS.push(["live", () => pkmLivePanel, () => pkmCloseLive()], ["hab", () => pkmHabPanel, () => pkmCloseHabitats()]);
  pkmOpenHabitats = pkmExclusive("hab", pkmOpenHabitats);

  pkmStyle(`
    .pkm-set.pkm-live,.pkm-set.pkm-hab{width:min(680px,96vw);max-height:92vh;overflow:auto}
    .lv-head{background:linear-gradient(90deg,#c0302a,#5a1010)!important}.hb-head{background:linear-gradient(90deg,#3a8a5a,#1a4a2e)!important}
    .ol-badge{font-size:13px;margin-left:1px;cursor:help}
    .lv-code{text-align:center;padding:14px}.lv-code b{display:block;font-size:34px;letter-spacing:.2em;margin:8px 0;font-family:ui-monospace,monospace}
    .lb-table{width:100%;border-collapse:collapse;margin-top:6px;font-size:13px}.lb-table th,.lb-table td{padding:4px 6px;border-bottom:1px solid rgba(127,127,127,.15);text-align:left}
    .lb-table tr.me{background:rgba(255,203,5,.15);font-weight:700}.lb-spr{width:32px;height:32px;vertical-align:middle;image-rendering:pixelated}
    .ev-card{padding:10px;border-radius:12px;background:rgba(127,127,127,.1);margin:8px 0;display:grid;gap:5px}.ev-bar span{background:linear-gradient(90deg,#ff6a2a,#ffcb05)!important}
    .fr-me{padding:8px;border-radius:10px;background:rgba(127,127,127,.1);margin-bottom:6px}.fr-me b{font-family:ui-monospace,monospace;font-size:16px}
    .lvw-side{display:flex;gap:10px;align-items:center;margin:6px 0}.lvw-side img{width:72px;height:72px;image-rendering:pixelated}.lvw-side>div{flex:1}
    .lvw-log{max-height:140px;overflow:auto;font-size:12.5px;background:rgba(127,127,127,.1);border-radius:8px;padding:6px 8px;margin:6px 0}
    .lvw-end{text-align:center;font-size:18px;font-weight:700;padding:10px}
    .sf-outbreak,.mp-storm{margin:4px 0;padding:5px 8px;border-radius:8px;background:rgba(255,160,40,.18);font-size:12.5px}
    .mp-storms{display:flex;gap:8px;flex-wrap:wrap;padding:6px 10px;font-size:12.5px;background:rgba(80,140,255,.15)}
    .hb-list{display:grid;gap:8px;margin-top:8px}.hb-zone{border-radius:12px;background:rgba(127,127,127,.1);padding:6px 8px}
    .hb-zh{all:unset;cursor:pointer;display:flex;justify-content:space-between;width:100%;gap:8px}.hb-zh[disabled]{cursor:default;opacity:.7}
    .hb-mons{display:flex;flex-wrap:wrap;gap:2px;margin-top:4px}.hb-mons img{width:40px;height:40px;image-rendering:pixelated}.hb-mons img.miss{filter:grayscale(1) brightness(.35);opacity:.7}
    .pkm-mood{all:unset;cursor:pointer;position:absolute;left:50%;top:-26px;transform:translateX(-50%) scale(.6);font-size:20px;opacity:0;transition:opacity .3s,transform .3s;pointer-events:auto;
      background:#fff;border-radius:999px;padding:1px 6px;box-shadow:0 2px 6px rgba(0,0,0,.3)}
    .pkm-mood.show,.pkm-partner:hover .pkm-mood{opacity:1;transform:translateX(-50%) scale(1)}
  `, "pkm-v43");
  // =====================================================================
  //  4.4: trade chat, guilds + guild raid, season pass, server-checked
  //  Battle Tower, desktop alerts, public profile, National Dex across
  //  browsers, sending Pokémon to a friend's Home, seasonal server places
  //  (plus live-battle switching, spectators and ranked play in 14h)
  // =====================================================================

  // ---------- Trade chat (preset messages only) ----------
  const PKM_CHAT = [
    ["Hello everyone! 👋", ""], ["Looking for {x}!", "sp"], ["Offering {x} on the GTS.", "sp"], ["Anyone up for a live battle?", ""],
    ["Join my guild! Tag: {x}", "tag"], ["Thanks for the trade! 🙏", ""], ["GG! 🎉", ""], ["Who wants to Wonder Trade?", ""],
    ["The shared raid boss is almost down! ⚔️", ""], ["Just caught a shiny {x}! ✨", "sp"], ["Need help with our guild raid!", ""], ["Good luck, trainers! 🍀", ""],
  ];
  const pkmChatText = (c) => { const p = PKM_CHAT[c.msg]; if (!p) return "…"; const x = c.sp ? (p[1] === "tag" ? String(c.sp).toUpperCase() : pkmCap(c.sp)) : "?"; return p[0].replace("{x}", x); };
  PKM_NEW_TABS.push(["chat", "💬 Chat"], ["guild", "🛡️ Guild"]);
  Object.assign(pkmOnline2, { chat: [], chatLast: 0, reportFor: null, guild: undefined, guildTop: null, rating: null, dex: null, homeFriends: null, alertsAsked: false });
  let pkmChatPoll = null;
  {
    const rf = pkmOnlineRefresh;
    pkmOnlineRefresh = async function () {
      const t = pkmOnlineTab;
      if (!["chat", "guild", "live", "home", "friends"].includes(t) || !pkmOnline()) return rf.apply(this, arguments);
      if (t === "live" || t === "friends") await rf.apply(this, arguments);
      try {
        if (t === "chat") {
          const r = await pkmApi("chat_list", { since: 0 });
          pkmOnline2.chat = r.chat;
          pkmOnline2.chatLast = r.chat.length ? r.chat[r.chat.length - 1].id : 0;
          if (!pkmChatPoll) pkmChatPoll = setInterval(() => { if (!pkmOnlinePanel || pkmOnlineTab !== "chat") { clearInterval(pkmChatPoll); pkmChatPoll = null; return; } pkmApi("chat_list", { since: 0 }).then((x) => { const last = x.chat.length ? x.chat[x.chat.length - 1].id : 0; if (last !== pkmOnline2.chatLast) { pkmOnline2.chat = x.chat; pkmOnline2.chatLast = last; pkmDrawOnline(); } }).catch(() => {}); }, 10000);
        } else if (t === "guild") {
          const [g, top] = await Promise.all([pkmApi("guild_info"), pkmApi("guild_top")]);
          pkmOnline2.guild = g; pkmOnline2.guildTop = top;
        } else if (t === "live") {
          pkmOnline2.rating = (await pkmApi("rating_me")).rating;
        } else if (t === "home") {
          await rf.apply(this, arguments);
          const [f, dx] = await Promise.all([pkmApi("friend_list"), pkmApi("dex_sync", { names: (getArr(STORAGE.pokedex) || []).map((p) => String(p.name).toLowerCase()) })]);
          pkmOnline2.homeFriends = f.friends; pkmOnline2.dex = dx.names;
        }
      } catch (e) { pkmOnlineData.err = e.message; }
    };
    const body = pkmOnline2Body;
    pkmOnline2Body = function () {
      const t = pkmOnlineTab, o = pkmOnline2;
      if (t === "chat") {
        const opts = PKM_CHAT.map((p, i) => `<option value="${i}">${pkmEsc(p[0].replace("{x}", p[1] === "tag" ? "TAG" : "…"))}</option>`).join("");
        return `<div class="pkm-dim">Chat with every trainer. To keep it friendly, you pick from set messages.</div>
          <div class="ch-list">${o.chat.length ? o.chat.map((c) => `<div class="ch-msg${c.me ? " me" : ""}"><b>${pkmEsc(c.name)}</b>${pkmBadgeHtml(c.badges)} <span class="pkm-dim">${new Date(c.created * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
              ${c.me ? "" : `<button type="button" class="ch-flag" data-flag="${c.pid}" title="Report this trainer">⚑</button>`}<div>${pkmEsc(pkmChatText(c))}</div>
              ${o.reportFor === c.pid && !c.me ? `<div class="pkm-btns ch-report">Report for: ${[["cheating", "Cheating"], ["bad-name", "Bad name"], ["spam", "Spam"], ["scam", "Trade scam"]].map(([k, l]) => `<button type="button" class="pkm-btn2" data-rep="${k}" data-pid="${c.pid}">${l}</button>`).join("")}<button type="button" class="pkm-btn2" data-flag="0">Cancel</button></div>` : ""}</div>`).join("") : `<div class="pkm-dim">No messages yet. Say hello!</div>`}</div>
          <div class="pkm-btns"><select class="ch-pick" aria-label="Message">${opts}</select><input class="ch-x" maxlength="30" placeholder="Pokémon or guild tag" aria-label="Pokémon or guild tag"><button type="button" class="pkm-btn2 primary" data-chat="send">Send</button></div>`;
      }
      if (t === "guild") {
        const g = o.guild;
        if (g === undefined) return `<div class="pkm-dim">Loading…</div>`;
        const top = (o.guildTop && o.guildTop.top) || [];
        const topHtml = `<div class="bag-sec"><span>🛡️ Top guilds this week</span></div><table class="lb-table"><tr><th>#</th><th>Guild</th><th>Raid damage</th></tr>${top.map((x) => `<tr class="${x.me ? "me" : ""}"><td>${x.rank}</td><td>[${pkmEsc(x.tag)}] ${pkmEsc(x.name)} <span class="pkm-dim">${x.members} members</span></td><td>${x.score.toLocaleString()}</td></tr>`).join("") || `<tr><td colspan="3" class="pkm-dim">No guilds yet.</td></tr>`}</table>`;
        if (!g.guild) return `<div class="pkm-dim">Team up with other trainers. Guild members fight a weekly guild raid boss together, and guilds race on the weekly leaderboard.</div>
          <div class="bag-sec"><span>Make a guild</span></div><div class="pkm-btns"><input class="gd-name" maxlength="16" placeholder="Guild name" aria-label="Guild name"><input class="gd-tag" maxlength="4" placeholder="TAG" aria-label="Guild tag (2-4 letters)" style="width:70px;text-transform:uppercase"><button type="button" class="pkm-btn2 primary" data-gd="create">Create</button></div>
          <div class="bag-sec"><span>Join a guild</span></div><div class="pkm-btns"><input class="gd-join" maxlength="4" placeholder="TAG" aria-label="Guild tag" style="width:80px;text-transform:uppercase"><button type="button" class="pkm-btn2 primary" data-gd="join">Join</button></div>${topHtml}`;
        const r = g.raid;
        const pct = Math.min(100, Math.round((r.total / r.hp) * 100));
        const down = r.total >= r.hp;
        return `<div class="gd-head"><b>[${pkmEsc(g.guild.tag)}] ${pkmEsc(g.guild.name)}</b><span class="pkm-dim">${g.members.length} member${g.members.length === 1 ? "" : "s"}${g.guild.owner ? " · you lead it" : ""}</span><button type="button" class="pkm-btn2" data-gd="leave">Leave</button></div>
          <div class="ev-card"><b>⚔️ Guild raid: ${pkmEsc(pkmCap(r.species))}</b><div class="pkm-dim">Your guild's damage adds up this week. You dealt ${r.mine.toLocaleString()}. Fights today: ${r.hitsToday}/3.</div>
            <div class="bc-bar ev-bar"><span style="width:${pct}%"></span></div><div class="pkm-dim">${down ? "💥 Your guild beat the boss!" : `${r.total.toLocaleString()} / ${r.hp.toLocaleString()} HP (${pct}%)`}</div>
            <div class="pkm-btns"><button type="button" class="pkm-btn2 primary" data-gd="fight" ${down || r.hitsToday >= 3 ? "disabled" : ""}>⚔️ Fight</button><button type="button" class="pkm-btn2" data-gd="claim" ${down && r.mine > 0 && !r.claimed ? "" : "disabled"}>${r.claimed ? "Prize collected ✓" : "Collect the prize"}</button></div></div>
          <div class="bag-sec"><span>Members</span></div><table class="lb-table"><tr><th>Trainer</th><th>Damage this week</th></tr>${g.members.map((m) => `<tr><td>${m.owner ? "👑 " : ""}${pkmEsc(m.name)} ${pkmBadgeHtml(m.badges)}</td><td>${m.dmg.toLocaleString()}</td></tr>`).join("")}</table>${topHtml}`;
      }
      let html = body.apply(this, arguments);
      if (t === "friends" && o.friends) {
        const pub = GM_getValue("pkm_profile_public", "false") === "true";
        const url = `${pkmServerUrl()}profile.php?c=${o.friends.code}`;
        html += `<div class="bag-sec"><span>🪪 Public profile</span></div>
          <div class="pkm-btns"><button type="button" class="pkm-btn2 ${pub ? "primary" : ""}" data-pf="toggle" aria-pressed="${pub}">${pub ? "✓ Public" : "Make my profile public"}</button>${pub ? `<input readonly class="pf-url" value="${pkmEsc(url)}" style="flex:1" aria-label="Profile link"><button type="button" class="pkm-btn2" data-pf="copy">📋</button>` : ""}</div>
          <div class="pkm-dim">A public profile shows your name, trainer look, badges, a few totals and your party on a web page anyone with the link can open.</div>`;
      }
      return html;
    };
    const dr = pkmDrawOnline;
    pkmDrawOnline = function () {
      dr.apply(this, arguments);
      const P = pkmOnlinePanel;
      if (!P || !pkmOnline()) return;
      const acct = P.querySelector(".ol-acct");
      if (acct && !acct.querySelector("[data-push]")) {
        const on = GM_getValue("pkm_push", "false") === "true";
        acct.insertAdjacentHTML("beforeend", ` <button type="button" class="pkm-btn2 ${on ? "primary" : ""}" data-push="1" title="Desktop alerts for finished trades, Wonder Trades and gifts">🔔 ${on ? "Alerts on" : "Alerts off"}</button>`);
      }
      if (pkmOnlineTab === "home" && !P.querySelector(".hm-extra")) {
        const body = P.querySelector(".lk-body");
        for (const r of (pkmOnlineData.home && pkmOnlineData.home.home) || []) { if (!r.from) continue; const tile = P.querySelector(`[data-out="${r.id}"]`)?.closest(".ol-tile"); if (tile) tile.insertAdjacentHTML("beforeend", `<span class="pkm-dim">From ${pkmEsc(r.from)}</span>`); }
        const fr = pkmOnline2.homeFriends || [];
        const dex = pkmOnline2.dex;
        const local = new Set((getArr(STORAGE.pokedex) || []).map((p) => String(p.name).toLowerCase()));
        const other = (dex || []).filter((n) => !local.has(n));
        body && body.insertAdjacentHTML("beforeend", `<div class="hm-extra">
          <div class="bag-sec"><span>🎁 Send to a friend's Home</span></div>
          ${fr.length ? `<div class="pkm-btns"><select class="hm-give" aria-label="Pokémon to send">${pkmSendOptions()}</select><select class="hm-to" aria-label="Friend">${fr.map((f) => `<option value="${f.pid}">${pkmEsc(f.name)}</option>`).join("")}</select><button type="button" class="pkm-btn2 primary" data-hm="send">Send</button></div>` : `<div class="pkm-dim">Add friends in 👥 Friends to send them Pokémon.</div>`}
          <div class="bag-sec"><span>📕 National Dex (all your browsers)</span><span class="pkm-dim">${dex ? dex.length : "…"}</span></div>
          ${dex ? `<div class="pkm-dim">${dex.length} species registered across every browser that uses this account. ${other.length} of them are only in another browser's Pokédex:</div>
            <div class="hb-mons">${other.slice(0, 120).map((n) => `<img src="https://play.pokemonshowdown.com/sprites/gen5/${pkmEsc(n)}.png" alt="${pkmEsc(pkmCap(n))}" title="${pkmEsc(pkmCap(n))}" loading="lazy">`).join("") || `<span class="pkm-dim">None. This browser has them all.</span>`}</div>` : ""}</div>`);
        body && body.querySelectorAll(".hm-extra img").forEach((img) => { img.onerror = () => { img.style.visibility = "hidden"; }; });
      }
    };
    const ck = pkmOnline2Click;
    pkmOnline2Click = async function (e) {
      const P = pkmOnlinePanel;
      const g = (k) => e.target.closest(`[${k}]`);
      if (g("data-push")) return pkmTogglePush();
      if (g("data-flag")) { pkmOnline2.reportFor = +g("data-flag").dataset.flag || null; return pkmDrawOnline(); }
      if (g("data-rep")) return pkmOnlineDo(async () => { await pkmApi("report", { target: +g("data-rep").dataset.pid, reason: g("data-rep").dataset.rep }); pkmOnline2.reportFor = null; pkmToast("Thanks. The report was sent to the server admin."); });
      if (g("data-chat")) return pkmOnlineDo(async () => {
        const msg = +P.querySelector(".ch-pick").value;
        const x = P.querySelector(".ch-x").value.trim().toLowerCase().replace(/\s+/g, "-");
        if (PKM_CHAT[msg][1] && !x) throw new Error(PKM_CHAT[msg][1] === "tag" ? "Type your guild tag." : "Type a Pokémon name.");
        await pkmApi("chat_post", { msg, sp: PKM_CHAT[msg][1] ? x : "" });
        await pkmOnlineRefresh();
      });
      const gd = g("data-gd")?.dataset.gd;
      if (gd === "create") return pkmOnlineDo(async () => { const r = await pkmApi("guild_create", { name: P.querySelector(".gd-name").value, tag: P.querySelector(".gd-tag").value }); pkmToast(`🛡️ Guild [${r.tag}] ${r.name} is ready. Share the tag so friends can join!`, 5000); await pkmOnlineRefresh(); });
      if (gd === "join") return pkmOnlineDo(async () => { const r = await pkmApi("guild_join", { tag: P.querySelector(".gd-join").value }); pkmToast(`🛡️ You joined [${r.tag}] ${r.name}!`); await pkmOnlineRefresh(); });
      if (gd === "leave") { if (!confirm("Leave your guild?")) return; return pkmOnlineDo(async () => { await pkmApi("guild_leave"); await pkmOnlineRefresh(); }); }
      if (gd === "claim") return pkmOnlineDo(async () => { const r = await pkmApi("guild_raid_claim"); pkmToast(`🛡️ Guild raid prize: ${pkmApplyServerReward(r.coins, r.items)}!`, 5000); await pkmOnlineRefresh(); });
      if (gd === "fight") { const r = pkmOnline2.guild.raid; return pkmGlobalRaidFight({ id: r.id, species: r.species, level: r.level }, "guild"); }
      const pf = g("data-pf")?.dataset.pf;
      if (pf === "toggle") return pkmOnlineDo(async () => { const on = GM_getValue("pkm_profile_public", "false") !== "true"; GM_setValue("pkm_profile_public", on ? "true" : "false"); await pkmSyncPublicProfile(true); });
      if (pf === "copy") { const i = P.querySelector(".pf-url"); navigator.clipboard?.writeText(i.value).then(() => pkmToast("Profile link copied.")); return; }
      if (g("data-hm")) return pkmOnlineDo(async () => {
        const id = P.querySelector(".hm-give").value, to = +P.querySelector(".hm-to").value;
        const p = pkmPackForSend(id);
        if (p.err) throw new Error(p.err);
        await pkmApi("home_send", { to, mon: p.mon });
        pkmRemoveMon(id);
        pkmToast(`🎁 ${pkmCap(p.mon.s)} is on its way to your friend's Home box.`);
        await pkmOnlineRefresh();
      });
      return ck.apply(this, arguments);
    };
  }

  // ---------- Public profile ----------
  async function pkmSyncPublicProfile(force) {
    if (!pkmOnline()) return;
    const pub = GM_getValue("pkm_profile_public", "false") === "true";
    const day = pkmDay(0);
    if (!force && (!pub || GM_getValue("pkm_profile_synced", "") === day)) return;
    const L = pkmLook();
    const pv = pkmProgressView();
    const r = await pkmApi("profile_full", {
      public: pub, team: pkmLiveTeam(), look: { sprite: L.sprite, color: L.color, title: L.title }, bg: +GM_getValue("pkm_profile_bg", 0) || 0, favs: pkmProfileFavs(),
      stats: { dex: pv._dex, badges: pv._badges, champs: Object.keys(pkmJSON("pkm_champs", {}) || {}).length, tower: pkmTower().best || 0, shinies: Object.keys(pkmJSON("pkm_species_shiny", {})).length, caught: pv.caught || 0 },
    });
    GM_setValue("pkm_profile_synced", day);
    if (force) pkmToast(pub ? "🪪 Your profile is public now." : "🪪 Your profile is private now.");
    return r;
  }
  setTimeout(() => pkmSyncPublicProfile(false).catch(() => {}), 12000);

  // ---------- Desktop alerts ----------
  async function pkmTogglePush() {
    const on = GM_getValue("pkm_push", "false") === "true";
    if (on) { GM_setValue("pkm_push", "false"); pkmToast("🔕 Desktop alerts are off."); return pkmDrawOnline(); }
    let perm = typeof Notification === "function" ? Notification.permission : "denied";
    if (perm === "default") perm = await Notification.requestPermission().catch(() => "denied");
    GM_setValue("pkm_push", "true");
    pkmToast(perm === "granted" ? "🔔 Desktop alerts are on." : "🔔 Alerts are on, but your browser blocked desktop pop-ups, so they'll show in the game instead.", 5000);
    pkmDrawOnline();
    pkmPushCheck(true);
  }
  function pkmPushNotify(title, body, tab) {
    try {
      if (typeof Notification === "function" && Notification.permission === "granted" && document.hidden) {
        const n = new Notification(title, { body, tag: `pkm-${tab}`, icon: `${PKM_ITEM_IMG}poke-ball.png` });
        n.onclick = () => { window.focus(); pkmOpenOnline(tab); n.close(); };
        return;
      }
    } catch {}
    pkmToast(`${title} ${body}`, 6000);
  }
  /** Looks for finished trades, Wonder Trades and gifts and tells the player about new ones. */
  async function pkmPushCheck(silent) {
    if (GM_getValue("pkm_push", "false") !== "true" || !pkmOnline()) return;
    try {
      const [t, w, gft] = await Promise.all([pkmApi("trade_mine"), pkmApi("wonder_mine"), pkmApi("fgift_inbox")]);
      const seen = new Set(pkmJSON("pkm_push_seen", []));
      const fresh = [
        ...t.trades.filter((x) => x.status === "done").map((x) => [`t${x.id}`, "🔄 GTS trade finished!", `${x.taker || "A trainer"} traded you ${pkmShareLabel(x.got || { s: "?", l: 1 })}.`, "gts"]),
        ...w.wonder.filter((x) => x.matched).map((x) => [`w${x.id}`, "🎲 Wonder Trade done!", `${x.from || "A trainer"} sent you ${pkmShareLabel(x.got || { s: "?", l: 1 })}.`, "wonder"]),
        ...gft.gifts.map((x) => [`g${x.id}`, "🎁 New gift!", `${x.from} sent you a gift.`, "friends"]),
      ].filter(([k]) => !seen.has(k));
      fresh.forEach(([k]) => seen.add(k));
      pkmSave("pkm_push_seen", [...seen].slice(-300));
      if (!silent) fresh.slice(0, 3).forEach(([, a, b, tab]) => pkmPushNotify(a, b, tab));
    } catch {}
  }
  setInterval(() => pkmPushCheck(false), 120000);

  // ---------- Server-checked Battle Tower (same foes for everyone on a run seed) ----------
  {
    const ts = pkmTowerStart;
    pkmTowerStart = async function () {
      GM_deleteValue("pkm_tower_run");
      if (pkmOnline()) {
        try {
          const r = await Promise.race([pkmApi("tower_start"), new Promise((_, rej) => setTimeout(() => rej(new Error("slow")), 5000))]);
          pkmSave("pkm_tower_run", { run: r.run, seed: r.seed });
          pkmToast("🗼 This run is checked by the server, so it counts for the online leaderboard.", 3500);
        } catch {}
      }
      return ts.apply(this, arguments);
    };
    const tt = pkmTowerTrainer;
    pkmTowerTrainer = function (streak) {
      const run = pkmJSON("pkm_tower_run", null);
      if (!run) return tt.apply(this, arguments);
      const rnd = Math.random;
      Math.random = pkmRng(((run.seed >>> 0) + streak * 7919) >>> 0);
      try { return tt.apply(this, arguments); } finally { Math.random = rnd; }
    };
    const tw = pkmTowerWin;
    pkmTowerWin = function (b) {
      const r = tw.apply(this, arguments);
      const run = pkmJSON("pkm_tower_run", null);
      if (run && b && b.trainer) pkmApi("tower_win", { run: run.run, streak: b.trainer.streak }).catch((e) => console.warn("[Tower]", e.message));
      return r;
    };
    const tl = pkmTowerLose;
    pkmTowerLose = function () {
      const run = pkmJSON("pkm_tower_run", null);
      if (run) { pkmApi("tower_end", { run: run.run }).catch(() => {}); GM_deleteValue("pkm_tower_run"); }
      return tl.apply(this, arguments);
    };
  }

  // ---------- Season pass (weekly missions -> season points -> tier rewards and outfits) ----------
  const PKM_SEASON_MISSIONS = [
    ["wins", 15, "Win 15 battles"], ["caught", 10, "Catch 10 Pokémon"], ["trainerWins", 8, "Beat 8 trainers"], ["evolutions", 2, "Evolve 2 Pokémon"],
    ["hatched", 1, "Hatch an Egg"], ["campCare", 8, "Care for Pokémon at Camp 8 times"], ["walks", 30, "Walk 30 steps on the map"], ["raids", 1, "Clear a raid"],
    ["quests", 5, "Finish 5 daily quests"], ["safariCaught", 3, "Catch 3 Pokémon in the Safari Zone"], ["contests", 1, "Enter a Contest"], ["trades", 1, "Make a trade"],
    ["towerWins", 5, "Win 5 Battle Tower battles"], ["villainWins", 1, "Beat a villain team battle"], ["frontierWins", 3, "Win 3 Frontier battles"],
  ];
  const PKM_SEASON_OUTFITS = [["giovanni", "Giovanni"], ["cyrus", "Cyrus"], ["lysandre", "Lysandre"], ["guzma", "Guzma"], ["rose", "Chairman Rose"], ["plumeria", "Plumeria"],
    ["mars", "Mars"], ["courtney", "Courtney"], ["archer", "Archer"], ["ghetsis", "Ghetsis"], ["colress", "Colress"], ["oleana", "Oleana"]];
  const PKM_SEASON_TIERS = 20, PKM_SEASON_STEP = 150;
  const pkmSeasonId = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; };
  const pkmSeason = () => { const s = pkmJSON("pkm_season", {}); return s.id === pkmSeasonId() ? s : { id: pkmSeasonId(), sp: 0, tiers: [], done: {} }; };
  function pkmSeasonMissions() {
    const w = pkmWeekId();
    const rng = pkmRng(pkmHash(`season:${w}`, 3));
    const pool = PKM_SEASON_MISSIONS.slice();
    const out = [];
    while (out.length < 5 && pool.length) out.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
    return { week: w, list: out };
  }
  /** The two outfits this month's pass gives (tiers 10 and 20). */
  function pkmSeasonOutfits() {
    const m = new Date().getMonth();
    return [PKM_SEASON_OUTFITS[(m * 2) % PKM_SEASON_OUTFITS.length], PKM_SEASON_OUTFITS[(m * 2 + 1) % PKM_SEASON_OUTFITS.length]];
  }
  function pkmSeasonReward(tier) {
    const [o1, o2] = pkmSeasonOutfits();
    if (tier === 10) return { outfit: o1, label: `🧢 ${o1[1]} outfit` };
    if (tier === 20) return { outfit: o2, label: `🧢 ${o2[1]} outfit` };
    const cycle = [
      { coins: 800, label: "💰 800 coins" }, { items: [[STORAGE.greatBalls, 5, "Great Balls"]], label: "⚪ 5 Great Balls" }, { items: [["pkm_item_rare-candy", 1, "Rare Candy"]], label: "🍬 Rare Candy" },
      { items: [[STORAGE.ultraBalls, 3, "Ultra Balls"]], label: "🟡 3 Ultra Balls" }, { coins: 1500, label: "💰 1500 coins" }, { items: [["pkm_item_ability-capsule", 1, "Ability Capsule"]], label: "💊 Ability Capsule" },
      { items: [["pkm_revive", 2, "Revives"]], label: "✨ 2 Revives" }, { items: [["pkm_item_nature-mint", 1, "Nature Mint"]], label: "🌿 Nature Mint" }, { items: [[STORAGE.masterBalls, 1, "Master Ball"]], label: "🟣 Master Ball" },
    ];
    return cycle[(tier - 1) % cycle.length];
  }
  function pkmUnlockedOutfits() { return pkmJSON("pkm_outfits", []); }
  function pkmAddOutfitLooks() { for (const s of pkmUnlockedOutfits()) if (!PKM_LOOKS.includes(s)) PKM_LOOKS.push(s); }
  pkmAddOutfitLooks();
  let pkmSeasonPanel = null;
  function pkmCloseSeason() { if (pkmSeasonPanel) pkmSeasonPanel.remove(); pkmSeasonPanel = null; }
  function pkmOpenSeason() {
    if (!pkmSeasonPanel) pkmSeasonPanel = pkmMakePanel("pkm-season", "Season pass", (e) => {
      const a = e.target.closest("[data-a]")?.dataset.a;
      if (a === "close") return pkmCloseSeason();
      const m = e.target.closest("[data-sm]");
      if (m && !m.disabled) {
        const s = pkmSeason();
        const { week } = pkmSeasonMissions();
        const key = `${week}:${m.dataset.sm}`;
        if (s.done[key]) return;
        s.done[key] = 1; s.sp += 100;
        pkmSave("pkm_season", s);
        pkmToast("🎟️ +100 season points!");
        return pkmOpenSeason();
      }
      const t = e.target.closest("[data-st]");
      if (t && !t.disabled) {
        const tier = +t.dataset.st;
        const s = pkmSeason();
        if (s.tiers.includes(tier) || s.sp < tier * PKM_SEASON_STEP) return;
        const r = pkmSeasonReward(tier);
        if (r.coins) setInt(STORAGE.coins, getInt(STORAGE.coins) + r.coins);
        if (r.items) pkmGive(r.items);
        if (r.outfit) { const o = pkmUnlockedOutfits(); if (!o.includes(r.outfit[0])) o.push(r.outfit[0]); pkmSave("pkm_outfits", o); pkmAddOutfitLooks(); }
        s.tiers.push(tier);
        pkmSave("pkm_season", s);
        playSound("evolve");
        pkmToast(`🎟️ Tier ${tier}: ${r.label}!${r.outfit ? " Wear it in 🧢 Trainer look." : ""}`, 4500);
        return pkmOpenSeason();
      }
    });
    const s = pkmSeason();
    const w = pkmWeek();
    const { week, list } = pkmSeasonMissions();
    const tier = Math.floor(s.sp / PKM_SEASON_STEP);
    const into = s.sp % PKM_SEASON_STEP;
    const daysLeft = Math.ceil((new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1) - new Date()) / 864e5);
    pkmSeasonPanel.innerHTML = `${pkmPanelHead("🎟️ Season pass", "ss-head")}<div class="lk-body">
      <div class="ss-top"><div><b>Season ${pkmEsc(s.id)}</b><div class="pkm-dim">${daysLeft} day${daysLeft === 1 ? "" : "s"} left · ${s.sp} points · tier ${Math.min(tier, PKM_SEASON_TIERS)}/${PKM_SEASON_TIERS}</div></div>
        <div class="ss-bar"><span style="width:${tier >= PKM_SEASON_TIERS ? 100 : Math.round((into / PKM_SEASON_STEP) * 100)}%"></span></div></div>
      <div class="bag-sec"><span>This week's missions</span><span class="pkm-dim">new every Monday</span></div>
      ${list.map(([k, n, label], i) => { const have = Math.min(n, w[k] || 0); const done = !!s.done[`${week}:${i}`]; return `<div class="ss-mis${done ? " done" : ""}"><div><b>${pkmEsc(label)}</b><div class="bc-bar"><span style="width:${Math.round((have / n) * 100)}%"></span></div></div><span class="pkm-dim">${have}/${n}</span>
        <button type="button" class="pkm-btn2 ${have >= n && !done ? "primary" : ""}" data-sm="${i}" ${have >= n && !done ? "" : "disabled"}>${done ? "✓ +100" : "+100"}</button></div>`; }).join("")}
      <div class="bag-sec"><span>Rewards</span><span class="pkm-dim">every ${PKM_SEASON_STEP} points</span></div>
      <div class="ss-tiers">${Array.from({ length: PKM_SEASON_TIERS }, (_, i) => i + 1).map((t) => { const r = pkmSeasonReward(t); const got = s.tiers.includes(t); const can = !got && s.sp >= t * PKM_SEASON_STEP; return `<button type="button" class="ss-tier${got ? " got" : can ? " can" : ""}${r.outfit ? " big" : ""}" data-st="${t}" ${can ? "" : "disabled"} title="${pkmEsc(r.label)}">
        ${r.outfit ? `<img src="${PKM_TRAINER_IMG}${pkmEsc(r.outfit[0])}.png" alt="">` : ""}<b>${t}</b><span>${pkmEsc(r.label)}</span>${got ? "<i>✓</i>" : ""}</button>`; }).join("")}</div></div>`;
  }

  // ---------- Seasonal server places (admin events with costume Pokémon) ----------
  function pkmServerSeason() {
    const c = pkmJSON("pkm_srv_events", null);
    const s = c && c.d && c.d.season;
    return s && s.pool && (!s.ends || s.ends * 1000 > Date.now()) ? s : null;
  }
  function pkmAddSeasonPlace() {
    const s = pkmServerSeason();
    const at = PKM_ZONES.kanto.findIndex((z) => z.id === "srv-season");
    if (at >= 0) PKM_ZONES.kanto.splice(at, 1);
    if (!s) return;
    const pool = s.pool.map((n) => pkmSafeSlug(String(n))).filter(Boolean).slice(0, 30);
    if (!pool.length) return;
    const lv = Array.isArray(s.lv) ? [pkmClamp(+s.lv[0] || 5, 1, MAX_LEVEL), pkmClamp(+s.lv[1] || 40, 1, MAX_LEVEL)] : [10, 40];
    PKM_ZONES.kanto.push({ ...pkmZ("srv-season", pkmSafeName(s.place, 30) || "Event Grove", String(s.icon || "🎉").slice(0, 4), lv, 0, "grass", pool), srvSeason: true, costume: String(s.costume || "🎀").slice(0, 4), eventTitle: s.title });
  }
  pkmAddSeasonPlace();
  {
    const rf = pkmOnlineRefresh;
    pkmOnlineRefresh = async function () {
      const r = await rf.apply(this, arguments);
      if (pkmOnlineTab === "events") pkmAddSeasonPlace();
      return r;
    };
    const zw = pkmZoneWild;
    pkmZoneWild = async function (z) {
      const m = await zw.apply(this, arguments);
      if (m && z && z.srvSeason && Math.random() < 0.6) m.costume = z.costume;
      return m;
    };
    const body = pkmOnline2Body;
    pkmOnline2Body = function () {
      let html = body.apply(this, arguments);
      const s = pkmOnlineTab === "events" && pkmServerSeason();
      if (s) html += `<div class="ev-card"><b>${pkmEsc(String(s.icon || "🎉"))} ${pkmEsc(s.title || "Seasonal event")}</b><div class="pkm-dim">${pkmEsc(s.place || "A new place")} is open in Kanto for a limited time. Pokémon there can wear a ${pkmEsc(String(s.costume || "🎀"))} costume.</div><button type="button" class="pkm-btn2 primary" data-ev2="season">Go there</button></div>`;
      return html;
    };
    const ck = pkmOnline2Click;
    pkmOnline2Click = async function (e) {
      if (e.target.closest("[data-ev2='season']")) { pkmCloseOnline(); return pkmOpenExplore("srv-season"); }
      return ck.apply(this, arguments);
    };
  }

  // ---------- Panels ----------
  PKM_PANELS.push(["season", () => pkmSeasonPanel, () => pkmCloseSeason()]);
  pkmOpenSeason = pkmExclusive("season", pkmOpenSeason);

  pkmStyle(`
    .pkm-set.pkm-season{width:min(680px,96vw);max-height:92vh;overflow:auto}
    .ss-head{background:linear-gradient(90deg,#e0a020,#a0502a)!important}
    .ss-top{display:grid;gap:6px;padding:8px;border-radius:12px;background:rgba(224,160,32,.12)}
    .ss-bar{height:10px;border-radius:999px;background:rgba(127,127,127,.25);overflow:hidden}.ss-bar span{display:block;height:100%;background:linear-gradient(90deg,#ffcb05,#ff7a1a)}
    .ss-mis{display:grid;grid-template-columns:1fr auto auto;gap:8px;align-items:center;padding:6px 0;border-bottom:1px solid rgba(127,127,127,.15)}.ss-mis.done{opacity:.6}
    .ss-tiers{display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:6px}
    .ss-tier{all:unset;position:relative;display:grid;gap:2px;justify-items:center;text-align:center;padding:8px 4px;border-radius:12px;background:rgba(127,127,127,.12);font-size:11.5px}
    .ss-tier b{font-size:16px}.ss-tier.can{cursor:pointer;outline:2px solid #ffcb05;background:rgba(255,203,5,.16)}.ss-tier.got{opacity:.55}.ss-tier.big img{width:54px;height:54px;image-rendering:pixelated}
    .ss-tier i{position:absolute;right:6px;top:4px;font-style:normal;color:#2fbf71;font-weight:800}
    .ch-list{display:grid;gap:4px;max-height:320px;overflow:auto;margin:6px 0;padding:6px;border-radius:10px;background:rgba(127,127,127,.08)}
    .ch-msg{position:relative;padding:5px 8px;border-radius:10px;background:rgba(127,127,127,.12);font-size:13px}.ch-msg.me{background:rgba(31,143,224,.16)}
    .ch-flag{all:unset;cursor:pointer;position:absolute;right:8px;top:4px;opacity:.5}.ch-flag:hover{opacity:1}.ch-report{margin-top:4px;font-size:12px}
    .gd-head{display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:8px;border-radius:12px;background:rgba(127,127,127,.1)}.gd-head .pkm-btn2{margin-left:auto}
    .lvw-bench{flex-wrap:wrap}.lvw-bench .pkm-btn2{display:inline-flex;align-items:center;gap:4px}
  `, "pkm-v44");
  // =====================================================================
  //  4.5: rotation foes rotate, catch the last horde Pokémon, ranked quick
  //  match + best of 3, guild chat / shop / ranks, season bonus track and
  //  season ranking, GTS wish list + offers you can fill + trade history,
  //  server-checked Frontier, profile background / favorites / likes,
  //  community catch goal with an event Pokémon
  // =====================================================================

  // ---------- Rotation: the foe rotates too ----------
  /** Best damage multiplier the attacker has against the defender (0 if no attacking moves). */
  const pkmBestEff = (att, def) => Math.max(0, ...(att.moves || []).filter((m) => m.cls !== "status" && m.pp > 0).map((m) => pkmMoveEff(att, def, m)));
  async function pkmFoeRotate(b) {
    const pool = b.team.slice(0, 3).filter((m) => m && m.hp > 0 && m !== b.foe);
    if (!pool.length) return false;
    const danger = pkmBestEff(b.me, b.foe) >= 2 || b.foe.hp < b.foe.maxHP * 0.3;
    if (!danger || Math.random() < 0.4) return false;
    const pick = pool.sort((x, y) => pkmBestEff(b.me, x) - pkmBestEff(b.me, y) || y.hp / y.maxHP - x.hp / x.maxHP)[0];
    if (pkmBestEff(b.me, pick) > pkmBestEff(b.me, b.foe) && pick.hp >= b.foe.hp) return false;
    const old = b.foe;
    b.foe = pick;
    b.foeIdx = b.team.indexOf(pick);
    if (b.shown) b.shown.foe = null;
    pkmSyncGlobals(b);
    await pkmSay(b, `${b.trainer.name} rotated ${old.display} out for ${pick.display}!`, 900);
    return true;
  }
  {
    const tn = pkmTurn;
    pkmTurn = async function (myAction) {
      const b = pkb;
      if (b && b.trainer && b.trainer.rotation && !b.double && !b.trainer.live && myAction && myAction.type === "move" && !b.busy && !b.awaitSwitch && !b.awaitRevive && pkmAlive(b) && !b.foe.charging) {
        b.busy = true;
        try { await pkmFoeRotate(b); } finally { b.busy = false; }
        if (!pkmAlive(b)) return;
      }
      return tn.apply(this, arguments);
    };
  }

  // ---------- Hordes: when one Pokémon is left, the battle becomes a normal one so you can catch it ----------
  {
    const db = drawBattle;
    let converting = false;
    drawBattle = function () {
      const b = pkb;
      if (b && b.horde && b.double && !b.busy && !b.over && !converting && b.kind === "wild" && b.foeNext >= (b.team || []).length) {
        const alive = b.foes.filter((f) => f && f.hp > 0);
        const me = b.mine.find((m) => m && m.hp > 0);
        if (alive.length === 1 && me && !(b.dbl && b.dbl.refill && b.dbl.refill.length)) {
          converting = true;
          b.double = false; b.horde = false; b.hordeDone = true;
          b.me = me; b.foe = alive[0];
          delete b.team; b.foeIdx = 0; b.dbl = null;
          if (b.shown) { b.shown.me = null; b.shown.foe = null; }
          pkmSyncGlobals(b);
          converting = false;
          setTimeout(() => pkmToast(`Only one ${b.foe.display} is left. You can throw a ball now!`, 3500), 50);
          return db.call(this, `Only ${b.foe.display} is left! What will ${b.me.display} do?`);
        }
      }
      return db.apply(this, arguments);
    };
  }

  // ---------- Quick match (ranked) ----------
  let pkmQueuePoll = null;
  const pkmQueueStop = () => { if (pkmQueuePoll) clearInterval(pkmQueuePoll); pkmQueuePoll = null; pkmOnline2.queue = null; };
  async function pkmQueueJoin() {
    const team = pkmLiveTeam();
    if (!team.length) throw new Error("You need a party first.");
    await pkmOnlineLogin();
    const r = await pkmApi("queue_join", { team });
    if (r.matched) { pkmQueueStop(); pkmCloseOnline(); pkmToast(`⚡ Matched with ${r.host}!`, 3000); return pkmOpenLive(r.id, r.host); }
    pkmOnline2.queue = { since: Date.now(), waiting: r.waiting };
    if (pkmQueuePoll) clearInterval(pkmQueuePoll);
    pkmQueuePoll = setInterval(async () => {
      try {
        const s = await pkmApi("queue_status");
        if (s.matched && s.role === "host") {
          pkmQueueStop();
          const x = await pkmApi("live_get", { id: s.id });
          pkmToast(`⚡ Matched with ${x.guest}!`, 3000);
          return pkmLiveStart(x);
        }
        if (!s.queued || Date.now() - (pkmOnline2.queue || {}).since > 180000) { pkmQueueStop(); pkmApi("queue_leave").catch(() => {}); pkmToast("Nobody was found for a quick match. Try again soon."); }
        else if (pkmOnline2.queue) pkmOnline2.queue.waiting = s.waiting;
        if (pkmOnlinePanel && pkmOnlineTab === "live") pkmDrawOnline();
      } catch {}
    }, 3000);
  }

  // ---------- Guild chat extras ----------
  const PKM_GCHAT = PKM_CHAT.concat([["Raid time! Everyone fight the guild boss ⚔️", ""], ["Welcome to the guild! 👋", ""], ["Thanks for the help!", ""], ["Saving guild points for {x}.", "sp"]]);
  const pkmGChatText = (c) => { const p = PKM_GCHAT[c.msg]; if (!p) return "…"; return p[0].replace("{x}", c.sp ? (p[1] === "tag" ? String(c.sp).toUpperCase() : pkmCap(c.sp)) : "?"); };
  const PKM_ROLE_ICON = { leader: "👑", officer: "⭐", member: "" };

  // ---------- GTS wish list ----------
  const pkmWishList = () => pkmJSON("pkm_wishlist", []);
  const pkmOwnedSpecies = () => [...new Set(Object.values(getObj(STORAGE.party) || {}).map((p) => String(p.name).toLowerCase()))];
  PKM_NEW_TABS.push(["history", "🧾 History"]);
  Object.assign(pkmOnline2, { queue: null, gchat: [], gme: null, match: null, history: null, community: null, seasonTop: null });

  // ---------- Online panel: data ----------
  {
    const rf = pkmOnlineRefresh;
    pkmOnlineRefresh = async function () {
      const t = pkmOnlineTab;
      if (["guild", "gts", "history", "events"].includes(t) && t !== "history") await rf.apply(this, arguments);
      if (t !== "guild" && t !== "gts" && t !== "history" && t !== "events") return rf.apply(this, arguments);
      if (!pkmOnline()) return;
      try {
        if (t === "guild" && pkmOnline2.guild && pkmOnline2.guild.guild) {
          const [c, me] = await Promise.all([pkmApi("guild_chat_list"), pkmApi("guild_me")]);
          pkmOnline2.gchat = c.chat; pkmOnline2.gme = me;
        } else if (t === "gts") {
          pkmOnline2.match = await pkmApi("trade_match", { have: pkmOwnedSpecies(), wish: pkmWishList() });
        } else if (t === "history") {
          pkmOnline2.history = (await pkmApi("trade_history")).history;
        } else if (t === "events") {
          pkmOnline2.community = (await pkmApi("community")).community;
          pkmSave("pkm_srv_community", { id: pkmOnline2.community.id, species: pkmOnline2.community.species, ends: pkmOnline2.community.ends });
        }
      } catch (e) { pkmOnlineData.err = e.message; }
    };
  }

  // ---------- Online panel: views ----------
  {
    const body = pkmOnline2Body;
    pkmOnline2Body = function () {
      const t = pkmOnlineTab, o = pkmOnline2;
      if (t === "history") {
        const h = o.history;
        if (!h) return `<div class="pkm-dim">Loading…</div>`;
        return h.length ? `<table class="lb-table"><tr><th>When</th><th>Type</th><th>You gave</th><th>You got</th><th>With</th></tr>${h.map((x) => `<tr><td>${new Date(x.created * 1000).toLocaleDateString()}</td><td>${x.kind === "wonder" ? "🎲 Wonder" : "🌍 GTS"}</td><td>${x.gave ? `<img class="lb-spr" src="${pkmEsc(pkmShareSprite(x.gave))}" alt="">${pkmEsc(pkmShareLabel(x.gave))}` : "-"}</td><td>${x.got ? `<img class="lb-spr" src="${pkmEsc(pkmShareSprite(x.got))}" alt="">${pkmEsc(pkmShareLabel(x.got))}` : "-"}</td><td>${pkmEsc(x.partner || "")}</td></tr>`).join("")}</table>`
          : `<div class="pkm-dim">No online trades yet. Finished GTS trades and Wonder Trades show up here.</div>`;
      }
      let html = body.apply(this, arguments);
      if (t === "live" && pkmOnline()) {
        const q = o.queue;
        html += `<div class="bag-sec"><span>⚡ Quick match</span><span class="pkm-dim">ranked, against anyone</span></div>
          ${q ? `<div class="pkm-btns"><span>🔎 Looking for an opponent… (${Math.max(0, (q.waiting || 1) - 1)} other trainer${(q.waiting || 1) - 1 === 1 ? "" : "s"} waiting)</span><button type="button" class="pkm-btn2" data-qm="leave">Stop</button></div>`
            : `<div class="pkm-btns"><button type="button" class="pkm-btn2 primary" data-qm="join">⚡ Find a ranked match</button></div>`}
          <div class="bag-sec"><span>🏆 Best of 3</span></div><div class="pkm-btns"><button type="button" class="pkm-btn2" data-lv3="1">Create a best-of-3 code</button><button type="button" class="pkm-btn2" data-lv3="2">Ranked best of 3</button></div>
          <div class="pkm-dim">In a best of 3, the first to win 2 games wins. Your party is healed before each game.</div>`;
      }
      if (t === "guild" && o.guild && o.guild.guild) {
        const me = o.gme || { role: "member", points: 0, shop: [] };
        const opts = PKM_GCHAT.map((p, i) => `<option value="${i}">${pkmEsc(p[0].replace("{x}", "…"))}</option>`).join("");
        html += `<div class="bag-sec"><span>💬 Guild chat</span></div>
          <div class="ch-list">${(o.gchat || []).map((c) => `<div class="ch-msg${c.me ? " me" : ""}"><b>${PKM_ROLE_ICON[c.role] || ""}${pkmEsc(c.name)}</b> <span class="pkm-dim">${new Date(c.created * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span><div>${pkmEsc(pkmGChatText(c))}</div></div>`).join("") || `<div class="pkm-dim">No messages yet.</div>`}</div>
          <div class="pkm-btns"><select class="gc-pick" aria-label="Message">${opts}</select><input class="gc-x" maxlength="30" placeholder="Pokémon / item" aria-label="Detail"><button type="button" class="pkm-btn2 primary" data-gchat="send">Send</button></div>
          <div class="bag-sec"><span>🛒 Guild shop</span><span class="pkm-dim">You have <b>${me.points}</b> guild points (1 per 1000 raid damage, +100 when the boss falls)</span></div>
          <div class="gs-grid">${(me.shop || []).map((s) => `<button type="button" class="pkm-btn2 ${me.points >= s.cost ? "primary" : ""}" data-gshop="${pkmEsc(s.id)}" ${me.points >= s.cost ? "" : "disabled"}>${pkmEsc(s.label)} · ${s.cost} pts</button>`).join("")}</div>
          <div class="bag-sec"><span>Ranks</span><span class="pkm-dim">You are ${PKM_ROLE_ICON[me.role] || ""}${pkmEsc(me.role || "member")}</span></div>
          <table class="lb-table">${o.guild.members.map((m) => `<tr><td>${PKM_ROLE_ICON[m.role] || ""} ${pkmEsc(m.name)}</td><td class="pkm-dim">${pkmEsc(m.role)}</td><td>${me.role === "leader" && m.role === "member" ? `<button type="button" class="pkm-btn2" data-grole="promote" data-target="${m.pid}">⭐ Make officer</button>` : ""}${me.role === "leader" && m.role === "officer" ? `<button type="button" class="pkm-btn2" data-grole="demote" data-target="${m.pid}">Make member</button>` : ""}${((me.role === "leader" && m.role !== "leader") || (me.role === "officer" && m.role === "member")) ? ` <button type="button" class="pkm-btn2 danger" data-grole="kick" data-target="${m.pid}">Remove</button>` : ""}</td></tr>`).join("")}</table>`;
      }
      if (t === "gts-extra" && pkmOnline()) {
        const wl = pkmWishList();
        const m = o.match || { fill: [], wish: [] };
        const card = (x) => pkmShareCard(x.mon, `<div class="pkm-dim">From ${pkmEsc(x.owner)} ${pkmBadgeHtml(x.badges)} · ${x.want ? `wants ${pkmEsc(pkmCap(x.want))}` : "wants any Pokémon"}</div>
          <div class="pkm-btns"><select class="ol-pay" data-for="${x.id}" aria-label="Pokémon to give">${pkmSendOptions(x.want || "") || `<option value="">You don't have one</option>`}</select><button type="button" class="pkm-btn2 primary" data-take="${x.id}" ${pkmSendOptions(x.want || "") ? "" : "disabled"}>Trade</button></div>`);
        html += `<div class="bag-sec"><span>⭐ Your wish list</span></div>
          <div class="pkm-btns">${wl.map((s) => `<span class="wl-chip">${pkmEsc(pkmCap(s))}<button type="button" data-wl-del="${pkmEsc(s)}" aria-label="Remove ${pkmEsc(s)}">✕</button></span>`).join("")}<input class="wl-add" maxlength="30" placeholder="Add a Pokémon" aria-label="Add to wish list"><button type="button" class="pkm-btn2" data-wl="add">Add</button></div>
          ${wl.length ? `<div class="bag-sec"><span>Offers on your wish list</span><span class="pkm-dim">${m.wish.length}</span></div>${m.wish.map(card).join("") || `<div class="pkm-dim">None right now.</div>`}` : ""}
          <div class="bag-sec"><span>✅ Offers you can fill</span><span class="pkm-dim">they want a Pokémon you have</span></div>${m.fill.map(card).join("") || `<div class="pkm-dim">None right now.</div>`}`;
      }
      if (t === "events" && o.community) {
        const c = o.community;
        const pct = Math.min(100, Math.round((c.total / c.goal) * 100));
        const done = c.total >= c.goal;
        html += `<div class="ev-card"><b>🤝 ${pkmEsc(c.title)}: catch ${c.goal.toLocaleString()} ${pkmEsc(pkmCap(c.species))}</b>
          <div class="pkm-dim">Every trainer's catches count (up to 30 a day each). When the goal is reached, everyone who helped gets a ${pkmEsc(pkmCap(c.species))} that knows ${pkmEsc(pkmCap(c.move))}! You caught ${c.mine}. ${c.players} trainer${c.players === 1 ? "" : "s"} joined.</div>
          <div class="bc-bar ev-bar"><span style="width:${pct}%"></span></div><div class="pkm-dim">${c.total.toLocaleString()} / ${c.goal.toLocaleString()}</div>
          <div class="pkm-btns"><button type="button" class="pkm-btn2 primary" data-comm="claim" ${done && c.mine > 0 && !c.claimed ? "" : "disabled"}>${c.claimed ? "Collected ✓" : "Get the event Pokémon"}</button></div></div>`;
      }
      if (t === "friends" && o.friends) {
        const favs = pkmJSON("pkm_profile_favs", []);
        const bg = +GM_getValue("pkm_profile_bg", 0) || 0;
        const opts = (sel) => `<option value="">(none)</option>` + Object.entries(getObj(STORAGE.party) || {}).map(([id, p]) => `<option value="${pkmEsc(id)}" ${sel === id ? "selected" : ""}>${pkmEsc(pkmCap(p.name))}${p.isShiny ? " ✨" : ""}</option>`).join("");
        html += `<div class="pkm-btns pf-extra"><span>Background</span>${PKM_PROFILE_BGS.map((g, i) => `<button type="button" class="pf-bg${i === bg ? " on" : ""}" data-pfbg="${i}" style="background:${g}" aria-label="Background ${i + 1}" aria-pressed="${i === bg}"></button>`).join("")}</div>
          <div class="pkm-btns pf-extra"><span>⭐ Favorites</span>${[0, 1, 2].map((i) => `<select class="pf-fav" data-i="${i}" aria-label="Favorite ${i + 1}">${opts(favs[i] || "")}</select>`).join("")}<button type="button" class="pkm-btn2" data-pf="save">Save profile</button></div>`;
        // friends' profiles + likes
        setTimeout(() => {
          const P = pkmOnlinePanel;
          if (!P) return;
          for (const f of o.friends.friends || []) {
            if (!f.profile) continue;
            const row = P.querySelector(`[data-gift="${f.pid}"], [data-unfriend="${f.pid}"]`)?.closest(".pkm-btns");
            if (row && !row.querySelector("[data-like]")) row.insertAdjacentHTML("beforeend", `<a class="pkm-btn2" href="${pkmEsc(`${pkmServerUrl()}profile.php?c=${f.profile}`)}" target="_blank" rel="noopener">🪪 Profile</a><button type="button" class="pkm-btn2" data-like="${pkmEsc(f.profile)}">👍 Like</button>`);
          }
        }, 0);
      }
      return html;
    };
  }
  // The GTS tab is drawn by 14g (not through pkmOnline2Body), so its extras are added after it draws
  {
    const dr = pkmDrawOnline;
    pkmDrawOnline = function () {
      dr.apply(this, arguments);
      const P = pkmOnlinePanel;
      if (!P || pkmOnlineTab !== "gts" || !pkmOnline() || P.querySelector(".gts-extra")) return;
      const keep = pkmOnlineTab;
      pkmOnlineTab = "gts-extra";
      let html = "";
      try { html = pkmOnline2Body(); } finally { pkmOnlineTab = keep; }
      P.querySelector(".lk-body")?.insertAdjacentHTML("beforeend", `<div class="gts-extra">${html}</div>`);
    };
  }
  const PKM_PROFILE_BGS = ["linear-gradient(180deg,#111421,#1b2140)", "linear-gradient(180deg,#0f2a1a,#1f4d2e)", "linear-gradient(180deg,#2a1020,#5a1f3a)", "linear-gradient(180deg,#0a2a40,#1a5a7a)",
    "linear-gradient(180deg,#3a2a0a,#7a5a1a)", "radial-gradient(circle at 30% 20%,#3a2a6a,#111421 70%)", "linear-gradient(180deg,#1a1a1a,#3a3a3a)", "linear-gradient(180deg,#402010,#a04020)"];
  function pkmProfileFavs() {
    const party = getObj(STORAGE.party) || {};
    return pkmJSON("pkm_profile_favs", []).filter((id) => party[id]).slice(0, 3).map((id) => { const m = pkmMonShare(id); if (m) m.h = ""; return m; }).filter(Boolean);
  }

  // ---------- Online panel: clicks ----------
  {
    const ck = pkmOnline2Click;
    pkmOnline2Click = async function (e) {
      const P = pkmOnlinePanel;
      const g = (k) => e.target.closest(`[${k}]`);
      const qm = g("data-qm")?.dataset.qm;
      if (qm === "join") return pkmOnlineDo(pkmQueueJoin);
      if (qm === "leave") { pkmQueueStop(); pkmApi("queue_leave").catch(() => {}); return pkmDrawOnline(); }
      if (g("data-lv3")) return pkmOnlineDo(() => pkmLiveHost(g("data-lv3").dataset.lv3 === "2", true));
      if (g("data-gchat")) return pkmOnlineDo(async () => {
        const msg = +P.querySelector(".gc-pick").value;
        const x = P.querySelector(".gc-x").value.trim().toLowerCase().replace(/\s+/g, "-");
        if (PKM_GCHAT[msg][1] && !x) throw new Error("Type the detail (a Pokémon or item).");
        await pkmApi("guild_chat_post", { msg, sp: PKM_GCHAT[msg][1] ? x : "" });
        await pkmOnlineRefresh();
      });
      if (g("data-gshop")) return pkmOnlineDo(async () => { const r = await pkmApi("guild_shop_buy", { item: g("data-gshop").dataset.gshop }); pkmToast(`🛒 Bought ${pkmApplyServerReward(0, r.items)}!`); await pkmOnlineRefresh(); });
      if (g("data-grole")) {
        const el = g("data-grole");
        if (el.dataset.grole === "kick" && !confirm("Remove this trainer from the guild?")) return;
        return pkmOnlineDo(async () => { await pkmApi("guild_role", { target: +el.dataset.target, do: el.dataset.grole }); await pkmOnlineRefresh(); });
      }
      if (g("data-wl") || g("data-wl-del")) {
        let wl = pkmWishList();
        if (g("data-wl-del")) wl = wl.filter((s) => s !== g("data-wl-del").dataset.wlDel);
        else { const s = pkmSafeSlug(P.querySelector(".wl-add").value.trim().toLowerCase().replace(/\s+/g, "-")); if (!s) return pkmToast("Type a Pokémon name."); if (!wl.includes(s)) wl.push(s); }
        pkmSave("pkm_wishlist", wl.slice(0, 20));
        return pkmOnlineDo(pkmOnlineRefresh);
      }
      if (g("data-comm")) return pkmOnlineDo(async () => {
        const r = await pkmApi("community_claim");
        await pkmDeliver(r.mon, "event");
        pkmApplyServerReward(r.coins, []);
        pkmToast(`🤝 Thank you! A ${pkmCap(r.mon.s)} that knows ${pkmCap(r.move)} joined your Bag, plus ${r.coins} coins!`, 6000);
        await pkmOnlineRefresh();
      });
      if (g("data-pfbg")) { GM_setValue("pkm_profile_bg", +g("data-pfbg").dataset.pfbg); return pkmOnlineDo(() => pkmSyncPublicProfile(false).then(() => {}).catch(() => {})); }
      if (g("data-pf") && g("data-pf").dataset.pf === "save") {
        pkmSave("pkm_profile_favs", [...P.querySelectorAll(".pf-fav")].map((s) => s.value).filter(Boolean).slice(0, 3));
        return pkmOnlineDo(async () => { GM_deleteValue("pkm_profile_synced"); await pkmApi("profile_full", { public: GM_getValue("pkm_profile_public", "false") === "true", team: pkmLiveTeam(), look: (() => { const L = pkmLook(); return { sprite: L.sprite, color: L.color, title: L.title }; })(), bg: +GM_getValue("pkm_profile_bg", 0) || 0, favs: pkmProfileFavs(), stats: { dex: (getArr(STORAGE.pokedex) || []).length, tower: pkmTower().best || 0 } }); pkmToast("🪪 Profile saved."); });
      }
      if (g("data-like")) return pkmOnlineDo(async () => { const r = await pkmApi("profile_like", { code: g("data-like").dataset.like }); pkmToast(`👍 Liked! That profile has ${r.likes} like${r.likes === 1 ? "" : "s"}.`); });
      return ck.apply(this, arguments);
    };
  }

  // ---------- Community catch goal: count matching catches ----------
  {
    const sc = pkmStoreCaught;
    pkmStoreCaught = function (f, source) {
      const id = sc.apply(this, arguments);
      try {
        const c = pkmJSON("pkm_srv_community", null);
        if (c && f && pkmOnline() && !["test", "trade", "raid", "egg", "gift", "event", "home", "wonder"].includes(source) && String(f.name).toLowerCase() === c.species && (!c.ends || c.ends * 1000 > Date.now())) {
          pkmApi("community_catch", { id: c.id, species: c.species }).then((r) => pkmToast(`🤝 Community goal: ${r.total.toLocaleString()} / ${r.goal.toLocaleString()} ${pkmCap(c.species)} caught!`, 3500)).catch(() => {});
        }
      } catch {}
      return id;
    };
  }
  // Learn this week's goal once per page so catches count even before the Events tab is opened
  setTimeout(() => { if (pkmOnline()) pkmApi("community").then((r) => pkmSave("pkm_srv_community", { id: r.community.id, species: r.community.species, ends: r.community.ends })).catch(() => {}); }, 15000);

  // ---------- Server-checked Battle Frontier progress ----------
  {
    const fr = pkmFrontRecord;
    pkmFrontRecord = function (k, n) {
      const r = fr.apply(this, arguments);
      if (pkmOnline() && /^(factory|arcade|pike|hall|castle)$/.test(k)) pkmApi("frontier_progress", { facility: k, n }).catch(() => {});
      return r;
    };
  }

  // ---------- Season pass: bonus track (coins) and season ranking ----------
  const PKM_BONUS_COST = 5000;
  function pkmBonusReward(tier) {
    if (tier === 10) return { items: [["pkm_item_ability-patch", 1, "Ability Patch"]], label: "🩹 Ability Patch" };
    if (tier === 20) return { items: [[STORAGE.masterBalls, 1, "Master Ball"]], coins: 3000, label: "🟣 Master Ball + 3000 coins" };
    const c = [{ items: [["pkm_item_rare-candy", 2, "Rare Candy"]], label: "🍬 2 Rare Candy" }, { coins: 1000, label: "💰 1000 coins" }, { items: [[STORAGE.ultraBalls, 5, "Ultra Balls"]], label: "🟡 5 Ultra Balls" },
      { items: [["pkm_item_nature-mint", 1, "Nature Mint"]], label: "🌿 Nature Mint" }, { items: [["pkm_item_tera-shard", 2, "Tera Shards"]], label: "💎 2 Tera Shards" }];
    return c[(tier - 1) % c.length];
  }
  const pkmPrevSeasonId = () => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; };
  {
    const os = pkmOpenSeason;
    pkmOpenSeason = function () {
      const r = os.apply(this, arguments);
      const P = pkmSeasonPanel;
      if (!P) return r;
      const s = pkmSeason();
      const tier = Math.min(PKM_SEASON_TIERS, Math.floor(s.sp / PKM_SEASON_STEP));
      const got = s.bonusTiers || [];
      P.querySelector(".lk-body").insertAdjacentHTML("beforeend", `<div class="bag-sec"><span>💎 Bonus track</span><span class="pkm-dim">${s.bonus ? "unlocked this season" : `${PKM_BONUS_COST} coins for this season`}</span></div>
        ${s.bonus ? `<div class="ss-tiers">${Array.from({ length: PKM_SEASON_TIERS }, (_, i) => i + 1).map((t) => { const b = pkmBonusReward(t); const have = got.includes(t); const can = !have && t <= tier; return `<button type="button" class="ss-tier bonus${have ? " got" : can ? " can" : ""}" data-sbonus="${t}" ${can ? "" : "disabled"} title="${pkmEsc(b.label)}"><b>${t}</b><span>${pkmEsc(b.label)}</span>${have ? "<i>✓</i>" : ""}</button>`; }).join("")}</div>`
          : `<div class="pkm-btns"><button type="button" class="pkm-btn2 primary" data-sbuy="1" ${getInt(STORAGE.coins) >= PKM_BONUS_COST ? "" : "disabled"}>💎 Unlock the bonus track</button><span class="pkm-dim">Every tier also gives a bonus reward (Rare Candy, Ultra Balls, an Ability Patch at 10, a Master Ball at 20).</span></div>`}
        <div class="bag-sec"><span>🏆 Season ranking</span><span class="pkm-dim">${pkmOnline() ? "top trainers by season points" : "connect in 🌐 Online to rank"}</span></div>
        <div class="ss-rank">${pkmOnline() ? "Loading…" : ""}</div>
        ${pkmOnline() ? `<div class="pkm-btns"><button type="button" class="pkm-btn2" data-sclaim="1">Collect last season's ranking prize (${pkmEsc(pkmPrevSeasonId())})</button></div><div class="pkm-dim">Prizes: #1 20000 coins, top 3 10000, top 10 5000 + a Master Ball, top 50 2000, everyone else 500.</div>` : ""}`);
      P.querySelectorAll("[data-sbonus],[data-sbuy],[data-sclaim]").forEach((el) => (el.onclick = async (e) => {
        e.stopPropagation();
        const st = pkmSeason();
        if (el.dataset.sbuy) {
          if (getInt(STORAGE.coins) < PKM_BONUS_COST) return pkmToast(`You need ${PKM_BONUS_COST} coins.`);
          setInt(STORAGE.coins, getInt(STORAGE.coins) - PKM_BONUS_COST);
          st.bonus = true; pkmSave("pkm_season", st);
          pkmToast("💎 Bonus track unlocked for this season!");
          return pkmOpenSeason();
        }
        if (el.dataset.sbonus) {
          const t = +el.dataset.sbonus;
          st.bonusTiers = st.bonusTiers || [];
          if (!st.bonus || st.bonusTiers.includes(t) || Math.floor(st.sp / PKM_SEASON_STEP) < t) return;
          const b = pkmBonusReward(t);
          if (b.coins) setInt(STORAGE.coins, getInt(STORAGE.coins) + b.coins);
          if (b.items) pkmGive(b.items);
          st.bonusTiers.push(t); pkmSave("pkm_season", st);
          pkmToast(`💎 Bonus tier ${t}: ${b.label}!`);
          return pkmOpenSeason();
        }
        if (el.dataset.sclaim) {
          try { const x = await pkmApi("season_claim", { season: pkmPrevSeasonId() }); pkmToast(`🏆 Last season you placed #${x.rank}! ${pkmApplyServerReward(x.coins, x.items)}.`, 6000); }
          catch (err) { pkmToast(err.message, 4000); }
        }
      }));
      if (pkmOnline()) {
        const board = `season-${s.id}`;
        pkmApi("score_submit", { board, score: s.sp }).then(() => pkmApi("score_top", { board })).then((x) => {
          const box = pkmSeasonPanel && pkmSeasonPanel.querySelector(".ss-rank");
          if (!box) return;
          box.innerHTML = `<div class="pkm-dim">You: <b>${x.mine == null ? 0 : x.mine}</b> points${x.rank ? ` · rank #${x.rank}` : ""}</div><table class="lb-table">${x.top.slice(0, 10).map((y) => `<tr class="${y.me ? "me" : ""}"><td>${y.rank}</td><td>${pkmEsc(y.name)} ${pkmBadgeHtml(y.badges)}</td><td>${y.score}</td></tr>`).join("")}</table>`;
        }).catch(() => { const box = pkmSeasonPanel && pkmSeasonPanel.querySelector(".ss-rank"); if (box) box.textContent = "Couldn't load the ranking."; });
      }
      return r;
    };
  }

  pkmStyle(`
    .lvw-series{text-align:center;font-size:13px;padding:4px;border-radius:8px;background:rgba(255,203,5,.14);margin-bottom:4px}
    .gs-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:6px}
    .wl-chip{display:inline-flex;align-items:center;gap:4px;padding:2px 4px 2px 9px;border-radius:999px;background:rgba(255,203,5,.18);font-size:12.5px}
    .wl-chip button{all:unset;cursor:pointer;padding:0 4px;opacity:.7}.wl-chip button:hover{opacity:1}
    .pf-extra{align-items:center}.pf-bg{all:unset;cursor:pointer;width:28px;height:28px;border-radius:8px;box-shadow:inset 0 0 0 2px rgba(255,255,255,.3)}.pf-bg.on{outline:3px solid #ffcb05}
    .ss-tier.bonus{background:rgba(120,90,255,.14)}.ss-tier.bonus.can{outline-color:#9a7aff;background:rgba(120,90,255,.24)}
  `, "pkm-v45");
  // ---------- Register the new panels (one at a time + Esc) ----------
  PKM_PANELS.push(
    ["daily", () => pkmDailyPanel, () => pkmCloseDaily()],
    ["trainers", () => pkmTrainersPanel, () => pkmCloseTrainers()],
    ["badges", () => pkmBadgesPanel, () => pkmCloseBadges()],
    ["tower", () => pkmTowerPanel, () => pkmCloseTower()],
    ["legends", () => pkmLegendsPanel, () => pkmCloseLegends()],
    ["daycare", () => pkmDaycarePanel, () => pkmCloseDaycare()],
    ["link", () => pkmLinkPanel, () => pkmCloseLink()],
    ["map", () => pkmMapPanel, () => pkmCloseMap()],
    ["explore", () => pkmExplorePanel, () => pkmCloseExplore()],
    ["options", () => pkmOptionsPanel, () => pkmCloseOptions()],
    ["training", () => pkmTrainPanel, () => pkmCloseTraining()],
    ["frontier", () => pkmFrontPanel, () => pkmCloseFrontier()],
    ["raids", () => pkmRaidPanel, () => pkmCloseRaids()],
    ["garden", () => pkmGardenPanel, () => pkmCloseGarden()],
    ["contests", () => pkmContestPanel, () => pkmCloseContests()],
    ["story", () => pkmStoryPanel, () => pkmCloseStory()],
    ["tutor", () => pkmTutorPanel, () => pkmCloseTutor()],
    ["dungeon", () => pkmDungeonPanel, () => pkmCloseDungeon()],
    ["ladder", () => pkmLadderPanel, () => pkmCloseLadder()],
    ["box", () => pkmBoxPanel, () => pkmCloseBox()],
    ["craft", () => pkmCraftPanel, () => pkmCloseCraft()],
    ["typechal", () => pkmTypePanel, () => pkmCloseTypeChal()]
  );
  pkmOpenLadder = pkmExclusive("ladder", pkmOpenLadder);
  pkmOpenBox = pkmExclusive("box", pkmOpenBox);
  pkmOpenCraft = pkmExclusive("craft", pkmOpenCraft);
  pkmOpenTypeChal = pkmExclusive("typechal", pkmOpenTypeChal);
  PKM_PANELS.unshift(["dexentry", () => pkmDexEntryPanel, () => pkmCloseDexEntry()]);
  pkmOpenTutor = pkmExclusive("tutor", pkmOpenTutor);
  pkmOpenDungeon = pkmExclusive("dungeon", pkmOpenDungeon);
  pkmOpenFrontier = pkmExclusive("frontier", pkmOpenFrontier);
  pkmOpenRaids = pkmExclusive("raids", pkmOpenRaids);
  pkmOpenGarden = pkmExclusive("garden", pkmOpenGarden);
  pkmOpenContests = pkmExclusive("contests", pkmOpenContests);
  pkmOpenStory = pkmExclusive("story", pkmOpenStory);
  pkmOpenTraining = pkmExclusive("training", pkmOpenTraining);
  pkmOpenMap = pkmExclusive("map", pkmOpenMap);
  pkmOpenExplore = pkmExclusive("explore", pkmOpenExplore);
  pkmOpenOptions = pkmExclusive("options", pkmOpenOptions);
  pkmOpenTrainers = pkmExclusive("trainers", pkmOpenTrainers);
  pkmOpenBadges = pkmExclusive("badges", pkmOpenBadges);
  pkmOpenDaily = pkmExclusive("daily", pkmOpenDaily);
  pkmOpenTower = pkmExclusive("tower", pkmOpenTower);
  pkmOpenLegends = pkmExclusive("legends", pkmOpenLegends);
  pkmOpenDaycare = pkmExclusive("daycare", pkmOpenDaycare);
  pkmOpenLink = pkmExclusive("link", pkmOpenLink);
  setTimeout(() => { try { pkmCheckAch(); } catch {} }, 4000);

  pkmStyle(`
    /* Starter picker */
    .pkm-set.pkm-starter{width:min(520px,96vw);max-height:92vh;overflow:auto}
    .st-head{background:linear-gradient(90deg,#2fbf71,#1c8a4f)!important}
    .st-body{padding:10px 14px 14px}
    .st-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(104px,1fr));gap:8px;max-height:56vh;overflow-y:auto;padding-right:2px}
    .st-card{all:unset;box-sizing:border-box;cursor:pointer;position:relative;background:#1a1a2a;border:1px solid #2b2b3d;border-radius:12px;padding:8px 6px;text-align:center;color:#e9e7ff;transition:transform .15s ease,box-shadow .15s ease,border-color .15s ease}
    .st-card:hover,.st-card:focus-visible{transform:translateY(-2px);box-shadow:0 6px 16px rgba(0,0,0,.35);border-color:#ffcb05;outline:none}
    .st-card img{display:block;margin:0 auto;width:64px;height:64px;image-rendering:pixelated;filter:drop-shadow(0 0 6px rgba(255,255,255,.2))}
    .st-num{position:absolute;left:8px;top:6px;font-size:.72rem;opacity:.6}
    .st-name{display:block;margin-top:4px;font-weight:700;font-size:12.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .st-note{grid-column:1/-1;padding:10px 2px}
    .st-three{grid-template-columns:repeat(3,1fr);max-height:none}
    .st-three .st-card{padding:14px 6px}
    .st-three .st-card img{width:96px;height:96px}
    .st-three .st-name{font-size:14px}
    @media(max-width:480px){.st-three{grid-template-columns:1fr}}
  `);
  pkmStyle(`
    /* HUD: 5 columns now (10 buttons) */
    .pkm-hud .pkm-hud-grid{grid-template-columns:repeat(5,1fr)}
    .pkm-hud .pkm-hud-btn{font-size:10.5px}
    /* Battle v2 */
    .pk-card.pkb-card{width:min(580px,96vw)!important;padding:12px!important;max-height:94vh;overflow:auto;transform:translate(-50%,-50%)}
    .pkb-loading{padding:46px 20px;text-align:center;font-size:15px}
    .pkb-trainer{display:flex;align-items:center;gap:10px;padding:6px 10px;border-radius:12px;background:rgba(255,255,255,.07);margin-bottom:8px}
    .pkb-trainer img{width:54px;height:54px;object-fit:contain;image-rendering:pixelated}
    .pkb-balls{display:flex;gap:4px;margin-top:4px}
    .pkb-balls span{width:13px;height:13px;border-radius:50%;background:linear-gradient(#e3350d 0 44%,#222 44% 56%,#f5f5f5 56%);border:1px solid #222}
    .pkb-balls span.out{filter:grayscale(1) brightness(.45)}
    .pkb-balls span.cur{box-shadow:0 0 0 2px #ffcb05}
    .pkb-gym{margin-left:auto;font-size:12px;font-weight:800;background:rgba(255,203,5,.18);color:#ffcb05;padding:3px 10px;border-radius:999px}
    .pkb-field{position:relative;border-radius:14px;padding:10px 12px;color:#1d1d1d;display:grid;gap:2px;overflow:hidden;
      background:radial-gradient(ellipse 34% 12% at 76% 40%,rgba(60,120,40,.45),transparent 70%),radial-gradient(ellipse 36% 12% at 24% 92%,rgba(60,120,40,.45),transparent 70%),
      linear-gradient(180deg,#8fd3f7 0%,#c9ecff 42%,#a6dd7d 43%,#79c552 100%)}
    .pkb-row{display:flex;align-items:center;justify-content:space-between;gap:10px;position:relative}
    .pkb-info{background:rgba(255,255,255,.94);border-radius:12px 12px 12px 3px;padding:6px 10px 7px;min-width:200px;max-width:62%;box-shadow:0 3px 0 rgba(0,0,0,.18);color:#222}
    .pkb-row.me .pkb-info{border-radius:12px 12px 3px 12px}
    .pkb-name{font-weight:800;font-size:14px;display:flex;gap:6px;align-items:center;flex-wrap:wrap}
    .pkb-name span{font-weight:600;font-size:12px;opacity:.7}
    .pkb-types{display:flex;gap:3px;margin-top:2px}
    .pkb-types .pk-type{font-size:9.5px;padding:0 6px}
    .pkb-hp{height:8px;border-radius:5px;background:#444;overflow:hidden;margin-top:5px;border:1px solid #222}
    .pkb-hp span{display:block;height:100%;transition:width .5s ease,background .5s}
    .pkb-hpnum{font-size:11px;text-align:right;font-weight:800;margin-top:2px}
    .pkb-xp{height:4px;background:#d0d0d0;border-radius:3px;overflow:hidden;margin-top:3px}
    .pkb-xp span{display:block;height:100%;background:#3c9cff}
    .pkb-sprite{width:112px;height:112px;object-fit:contain;image-rendering:pixelated}
    .pkb-sprite.foe{filter:drop-shadow(0 6px 0 rgba(0,0,0,.15));animation:bobWalk 1.4s infinite}
    .pkb-sprite.me{width:124px;height:124px}
    .pkb-sprite.flip{transform:scaleX(-1)}
    .pkb-st{font-size:10px;font-weight:800;padding:1px 5px;border-radius:4px;color:#fff}
    .st-brn{background:#e2542b}.st-psn{background:#a33ea1}.st-par{background:#d6b400;color:#222}.st-slp{background:#7a7a8c}.st-frz{background:#3fb4dc}
    .pkb-msg{margin:10px 0 6px;min-height:44px;padding:9px 12px;border-radius:10px;background:#141829;border:2px solid #4a5585;font-size:14px;line-height:1.35;color:#fff}
    .pkb-catch{font-size:11.5px;opacity:.75;margin:-2px 2px 6px}
    .pk-controls.pkb-controls{grid-template-columns:repeat(4,minmax(0,1fr))!important;margin-top:0!important;gap:7px}
    .pkb-move{text-align:left!important;padding:8px 9px 7px!important;border-left:4px solid var(--tc,#888)!important;min-height:66px;display:flex;flex-direction:column;justify-content:center}
    .pkb-move .pk-label{font-weight:800;font-size:13px}
    .pkb-move.empty{opacity:.3}
    .pkb-mv-sub{font-size:10.5px;opacity:.9;margin-top:3px;display:flex;align-items:center;gap:5px;flex-wrap:wrap}
    .pkb-mv-sub .pk-type{font-size:9px;padding:0 5px}
    .pkb-eff{font-size:10px;font-weight:800;margin-top:3px}
    .pkb-eff.e-up{color:#7dff9a}.pkb-eff.e-down{color:#ffb4a8}.pkb-eff.e-no{color:#9a9a9a}
    .t-normal{--tc:#A8A77A}.t-fire{--tc:#EE8130}.t-water{--tc:#6390F0}.t-electric{--tc:#F7D02C}.t-grass{--tc:#7AC74C}.t-ice{--tc:#96D9D6}
    .t-fighting{--tc:#C22E28}.t-poison{--tc:#A33EA1}.t-ground{--tc:#E2BF65}.t-flying{--tc:#A98FF3}.t-psychic{--tc:#F95587}.t-bug{--tc:#A6B91A}
    .t-rock{--tc:#B6A136}.t-ghost{--tc:#735797}.t-dragon{--tc:#6F35FC}.t-dark{--tc:#705746}.t-steel{--tc:#B7B7CE}.t-fairy{--tc:#D685AD}
    .pkb-dmg{position:absolute;left:50%;top:20%;font-weight:900;font-size:22px;color:#fff;text-shadow:0 2px 0 #b3261e,0 0 8px rgba(0,0,0,.7);animation:pkmFloat 1s ease-out forwards;pointer-events:none}
    @keyframes pkmFloat{from{opacity:1;transform:translateY(0)}to{opacity:0;transform:translateY(-30px)}}
    /* Trainers & Gyms */
    .pkm-set.pkm-trainers{width:min(760px,96vw)}
    .tr-head{background:linear-gradient(90deg,#7b2ff7,#4a1aa8)!important}
    .tr-random{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:12px 16px;padding:12px 14px;border-radius:14px;background:linear-gradient(135deg,#232a48,#1a1f36);border:1px solid #3a4470}
    .tr-t{font-weight:800;font-size:15px}
    .tr-gyms{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;padding:8px 16px 12px}
    .tr-gym{border-radius:14px;padding:10px;background:#1b1f33;border:1px solid #2c3350;display:grid;gap:4px;justify-items:center;text-align:center;border-top:3px solid var(--gc)}
    .tr-gym.earned{box-shadow:0 0 0 1px var(--gc),0 0 18px -6px var(--gc)}
    .tr-gym.locked{opacity:.45}
    .tr-top{position:relative;width:72px;height:72px}
    .tr-img{width:72px;height:72px;object-fit:contain;image-rendering:pixelated}
    .tr-badge{position:absolute;right:-8px;bottom:-2px;width:28px;height:28px;border-radius:50%;display:grid;place-items:center;background:#111421;border:2px solid var(--gc);font-size:14px}
    .tr-gym:not(.earned) .tr-badge{filter:grayscale(1);opacity:.6}
    .tr-name{font-weight:800}
    .tr-meta{display:flex;gap:6px;align-items:center}
    @media (max-width:640px){.tr-gyms{grid-template-columns:repeat(2,minmax(0,1fr))}}
    /* Badge case */
    .pkm-set.pkm-badges{width:min(720px,96vw)}
    .bc-head{background:linear-gradient(90deg,#d4a017,#9a7208)!important}
    .bc-body{padding:14px 16px 16px}
    .bc-case{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;padding:14px;border-radius:16px;background:linear-gradient(180deg,#3b2a1a,#2a1d12);border:2px solid #6b4a2a;box-shadow:inset 0 2px 10px rgba(0,0,0,.5)}
    .bc-badge{display:grid;justify-items:center;gap:3px;text-align:center}
    .bc-medal{width:62px;height:62px;border-radius:50%;display:grid;place-items:center;font-size:28px;background:#2a2a2a;filter:grayscale(1);opacity:.35;border:3px solid #555}
    .bc-badge.on .bc-medal{filter:none;opacity:1;background:radial-gradient(circle at 35% 30%,#fff8,transparent 45%),var(--gc);border-color:#fff6;box-shadow:0 0 16px -2px var(--gc)}
    .bc-name{font-size:11.5px;font-weight:700}
    .bc-ach{display:grid;gap:6px}
    .bc-row{display:grid;grid-template-columns:36px 1fr auto;gap:10px;align-items:center;padding:8px 10px;border-radius:12px;background:#1b1f33;border:1px solid #2c3350;opacity:.75}
    .bc-row.on{opacity:1;border-color:#d4a017;background:linear-gradient(90deg,rgba(212,160,23,.15),#1b1f33)}
    .bc-ico{font-size:22px;text-align:center}
    .bc-bar{height:5px;border-radius:4px;background:rgba(255,255,255,.1);overflow:hidden;margin-top:4px}
    .bc-bar span{display:block;height:100%;background:linear-gradient(90deg,#ffcb05,#ff8a00)}
    .bc-val{font-weight:800;font-size:12.5px}
    .bc-row.on .bc-val{color:#ffcb05;font-size:16px}
    .bc-week-h{margin-bottom:10px;font-size:15px}
    .bc-tiles{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}
    .bc-tile{padding:12px;border-radius:14px;background:#1b1f33;border:1px solid #2c3350;text-align:center}
    .bc-ti{font-size:20px}
    .bc-tv{font-size:22px;font-weight:900;margin:2px 0}
    .bc-td{font-size:11px;margin-top:4px;opacity:.8}
    .bc-td.up{color:#7dff9a}.bc-td.down{color:#ffb4a8}
    @media (max-width:640px){.bc-case,.bc-tiles{grid-template-columns:repeat(2,minmax(0,1fr))}}
    /* Daily reward */
    .pkm-set.pkm-daily{width:min(520px,94vw)}
    .dl-head{background:linear-gradient(90deg,#ff5f6d,#ffc371)!important}
    .dl-body{padding:16px}
    .dl-streak{font-size:20px;font-weight:900;text-align:center;margin-bottom:12px}
    .dl-days{display:grid;grid-template-columns:repeat(7,1fr);gap:6px}
    .dl-day{display:grid;justify-items:center;gap:2px;padding:8px 2px;border-radius:12px;background:#1b1f33;border:1px solid #2c3350;font-size:11px}
    .dl-day span{font-size:18px}
    .dl-day.done{background:linear-gradient(180deg,#2e7d4f,#1f5a38);border-color:#3fbf73}
    .dl-day.today{box-shadow:0 0 0 2px #ffcb05;animation:pkmBought 1.2s ease-out 2}
    .dl-got{margin:14px 0 8px;text-align:center}
    .dl-t{font-weight:800;margin-bottom:6px}
    .dl-items{display:flex;flex-wrap:wrap;gap:6px;justify-content:center}
    .dl-items span{padding:5px 11px;border-radius:999px;background:rgba(255,203,5,.15);border:1px solid rgba(255,203,5,.4);font-weight:700;font-size:13px}
    .dl-master{margin-top:8px;font-weight:900;color:#ff9be0}
    .dl-next{text-align:center}
    .dl-week{display:flex;flex-wrap:wrap;gap:8px;justify-content:center;margin-top:12px;padding:10px;border-radius:12px;background:#1b1f33;border:1px solid #2c3350;font-size:12.5px}
    .dl-week b{width:100%;text-align:center}
    /* Pokédex extras */
    .dex-extra{display:flex;gap:10px;align-items:stretch;margin-top:8px;flex:0 0 auto}
    .dex-shiny{padding:8px 14px;border-radius:12px;background:linear-gradient(135deg,#3a2f5c,#24203d);border:1px solid #5b4b94;display:grid;place-items:center;min-width:120px}
    .dex-shiny-n{font-size:20px;font-weight:900}
    .dex-rare{flex:1;padding:6px 10px;border-radius:12px;background:#10101a;border:1px solid #2b2b3d;min-width:0}
    .dex-rare-list{display:flex;gap:6px;overflow-x:auto;margin-top:4px}
    .dex-rare-i{position:relative;display:grid;justify-items:center;min-width:58px}
    .dex-rare-i img{width:44px;height:44px;object-fit:contain;image-rendering:pixelated}
    .dex-rare-i i{position:absolute;top:0;right:4px;font-style:normal;font-size:11px}
    .dex-rare-i .bag-rar{font-size:9px;padding:0 6px}
    /* Partner reactions */
    .pkm-react{position:absolute;top:-6px;font-size:16px;pointer-events:none;animation:pkmReact 1.8s ease-out forwards;opacity:0}
    @keyframes pkmReact{0%{opacity:0;transform:translateY(6px) scale(.6)}15%{opacity:1;transform:translateY(0) scale(1)}100%{opacity:0;transform:translateY(-34px) scale(1.1)}}
    .pkm-jump{animation:pkmJump .6s ease-out}
    @keyframes pkmJump{0%,100%{transform:translateY(0)}35%{transform:translateY(-16px)}60%{transform:translateY(0)}80%{transform:translateY(-5px)}}
    .pkm-nap img{animation:none!important;filter:brightness(.85) saturate(.8);transform:rotate(-10deg) translateY(6px)}
  `, "pkm-v35");
  // ---------- Styles for all of the above ----------
  pkmStyle(`
    .pkm-dim{opacity:.65;font-size:12px}
    /* HUD */
    .pkm-hud{background:rgba(17,20,33,.94)!important;color:#e8eaf6!important;border:1px solid rgba(255,255,255,.12)!important;border-radius:14px;
      box-shadow:0 10px 30px rgba(0,0,0,.45);padding:0!important;overflow:hidden;width:min(400px,96vw);gap:0!important;transition:opacity .2s}
    .pkm-hud-hidden{display:none!important}
    .pkm-hud [data-hud-bar]{display:flex;align-items:center;gap:4px;background:linear-gradient(90deg,#d62839,#a4161a)!important;
      padding:3px 4px 3px 10px!important;font-weight:600;letter-spacing:.3px;font-size:12px}
    .pkm-bar-title{flex:1}
    .pkm-bar-btn{all:unset;cursor:pointer;width:22px;height:22px;display:grid;place-items:center;border-radius:6px;color:#fff;font-size:13px}
    .pkm-bar-btn:hover,.pkm-bar-btn:focus-visible{background:rgba(255,255,255,.22)}
    .pkm-hud [data-hud-body]{padding:10px 12px 12px}
    .pkm-hud-top{display:flex;align-items:center;gap:10px}
    .pkm-hud-avatar{width:48px;height:48px;border-radius:50%;background:radial-gradient(circle at 50% 40%,#2a3150,#141827);display:grid;place-items:center;
      flex:0 0 auto;border:1px solid rgba(255,255,255,.14);overflow:hidden;font-size:20px}
    .pkm-hud-avatar img{width:48px;height:48px;object-fit:contain;image-rendering:pixelated}
    .pkm-hud-main{min-width:0;flex:1}
    .pkm-hud-name{font-weight:700;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .pkm-hud-sub{font-weight:500;font-size:11px;opacity:.7}
    .pkm-hud-bars{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:4px}
    .pkm-hud-bars small{font-size:10.5px;opacity:.85;display:block;margin-bottom:2px}
    .pkm-hud .progress{height:7px!important;width:100%!important;background:rgba(255,255,255,.1)!important;border-radius:6px}
    .pkm-hud-chips{display:flex;flex-wrap:wrap;gap:5px;margin-top:9px}
    .pkm-chip{font-size:11px;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.1);border-radius:999px;padding:2px 8px;white-space:nowrap}
    .pkm-hud-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-top:10px}
    .pkm-hud-btn{all:unset;box-sizing:border-box;cursor:pointer;position:relative;display:flex;flex-direction:column;align-items:center;gap:3px;padding:7px 4px 6px;
      border-radius:10px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);font-size:11px;color:#e8eaf6;text-align:center;
      transition:transform .12s,background .12s}
    .pkm-hud-btn .ico{font-size:18px;line-height:1}
    .pkm-hud-btn:hover{background:rgba(255,255,255,.13);transform:translateY(-1px)}
    .pkm-hud-btn:focus-visible,.pkm-menu-item:focus-visible,.pkm-btn2:focus-visible,.pkm-x:focus-visible,.dex-entry:focus-visible,.pk-btn:focus-visible,.pkm-launcher:focus-visible{outline:2px solid #ffcb05;outline-offset:2px}
    .pkm-dot{position:absolute;top:4px;right:8px;width:8px;height:8px;border-radius:50%;background:#ff4d4f;box-shadow:0 0 0 2px #111421}
    /* Launcher + quick menu */
    .pkm-launcher{all:unset;box-sizing:border-box;position:fixed;left:0;top:calc(50% - 22px);width:40px;height:44px;border-radius:0 22px 22px 0;background:#111421;
      box-shadow:0 6px 18px rgba(0,0,0,.45);display:grid;place-items:center;cursor:pointer;z-index:10002;border:1px solid rgba(255,255,255,.18);border-left:0;
      transition:width .15s,opacity .2s}
    .pkm-launcher:hover,.pkm-launcher:focus-visible,.pkm-launcher[aria-expanded="true"]{width:50px}
    .pkm-ball{width:26px;height:26px;border-radius:50%;background:linear-gradient(#e3350d 0 45%,#1b1b1b 45% 55%,#f5f5f5 55%);border:2px solid #1b1b1b;
      position:relative;transition:transform .3s;box-sizing:border-box}
    .pkm-ball::after{content:"";position:absolute;left:50%;top:50%;width:9px;height:9px;margin:-4.5px 0 0 -4.5px;background:#fff;border:2px solid #1b1b1b;border-radius:50%;box-sizing:border-box}
    .pkm-launcher:hover .pkm-ball{transform:rotate(-20deg)}
    .pkm-launcher[aria-expanded="true"] .pkm-ball{transform:rotate(180deg)}
    .pkm-menu{position:fixed;left:0;top:0;bottom:0;z-index:10003;width:min(330px,92vw);overflow:hidden;background:rgba(17,20,33,.98);
      color:#e8eaf6;border-right:1px solid rgba(255,255,255,.12);border-radius:0 16px 16px 0;box-shadow:8px 0 40px rgba(0,0,0,.55);padding:8px;display:flex;flex-direction:column;gap:6px;
      animation:pkmSlide .16s ease-out;box-sizing:border-box}
    .pkm-menu[hidden]{display:none}
    .pkm-menu-head{padding:4px 4px 8px 10px;font-weight:700;font-size:14px;border-bottom:1px solid rgba(255,255,255,.08);display:flex;gap:8px;justify-content:space-between;align-items:center}
    .pkm-menu-head .pkm-dim{margin-left:auto}
    .pkm-menu-x{position:static!important}
    .pkm-menu-q{all:unset;box-sizing:border-box;width:100%;padding:7px 10px;border-radius:9px;background:rgba(255,255,255,.08);font-size:13px;color:#fff}
    .pkm-menu-q::placeholder{color:rgba(255,255,255,.5)}
    .pkm-menu-upd{all:unset;box-sizing:border-box;cursor:pointer;padding:8px 10px;border-radius:10px;background:linear-gradient(90deg,#2fbf71,#1a8a4e);color:#fff;font-weight:700;font-size:12.5px;text-align:center}
    .pkm-menu-list{overflow:auto;flex:1;display:grid;gap:8px;align-content:start;padding-right:2px;overscroll-behavior:contain}
    .pkm-menu-grp[hidden]{display:none}
    .pkm-menu-gt{font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;opacity:.65;padding:2px 6px 4px}
    .pkm-menu-grid{display:grid;grid-template-columns:1fr 1fr;gap:3px}
    .pkm-menu-item{all:unset;box-sizing:border-box;display:flex;gap:7px;align-items:center;padding:6px 8px;border-radius:9px;cursor:pointer;font-size:12.5px;line-height:1.2;background:rgba(255,255,255,.04);min-height:34px}
    .pkm-menu-item[hidden]{display:none}
    .pkm-menu-item:hover{background:rgba(255,255,255,.12)}
    .pkm-menu-item .ico{width:18px;text-align:center;flex:none}
    .pkm-menu-sep{height:1px;background:rgba(255,255,255,.08);margin:4px 2px}
    @keyframes pkmSlide{from{transform:translateX(-24px);opacity:0}to{transform:none;opacity:1}}
    @keyframes pkmPop{from{opacity:0;transform:translateX(-6px) scale(.98)}to{opacity:1;transform:none}}
    /* Auto-hide while typing on the page */
    .pkm-typing .pkm-hud,.pkm-typing .pkm-partner{opacity:0!important;pointer-events:none!important}
    .pkm-partner{transition:opacity .2s}
    /* Toast */
    .pkm-toast{position:fixed;left:50%;bottom:24px;transform:translate(-50%,16px);opacity:0;background:#111421;color:#fff;border:1px solid rgba(255,255,255,.15);
      padding:8px 14px;border-radius:10px;z-index:12000;font-size:13px;transition:opacity .25s,transform .25s;box-shadow:0 8px 24px rgba(0,0,0,.4);pointer-events:none}
    .pkm-toast.show{opacity:1;transform:translate(-50%,0)}
    /* Shared dark panels */
    .pkm-panel{background:#151826!important;color:#e8eaf6!important;border:1px solid #2c3350!important;border-radius:14px!important;box-shadow:0 20px 60px rgba(0,0,0,.55)!important}
    .pkm-panel input[type=text]{background:#0f1220!important;color:#e8eaf6!important;border:1px solid #2c3350!important;border-radius:8px}
    .pkm-modal{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:10000}
    .pkm-preview{z-index:11600}
    .pkm-set{width:min(440px,94vw);max-height:88vh;overflow:auto;padding:0!important}
    .pkm-set-head{display:flex;align-items:center;justify-content:space-between;padding:10px 12px 10px 16px;background:linear-gradient(90deg,#d62839,#a4161a);
      font-weight:700;position:sticky;top:0;z-index:1;color:#fff}
    .pkm-set-sec{padding:10px 16px;border-bottom:1px solid rgba(255,255,255,.07)}
    .pkm-set-sec:last-child{border-bottom:0}
    .pkm-set-sec h4{font-size:11px;text-transform:uppercase;letter-spacing:.08em;opacity:.6;margin:0 0 6px;font-weight:700}
    .pkm-row{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:6px 0;font-size:13px}
    .pkm-sw{appearance:none;-webkit-appearance:none;width:36px;height:20px;border-radius:999px;background:#3a3f55;position:relative;cursor:pointer;flex:0 0 auto;margin:0;transition:background .15s}
    .pkm-sw::after{content:"";position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:#fff;transition:left .15s}
    .pkm-sw:checked{background:#2fbf71}
    .pkm-sw:checked::after{left:18px}
    .pkm-sw:focus-visible{outline:2px solid #ffcb05;outline-offset:2px}
    .pkm-set input[type=range]{width:150px;accent-color:#ffcb05}
    .pkm-set textarea{width:100%;min-height:90px;background:#0f1220;color:#e8eaf6;border:1px solid #2c3350;border-radius:8px;padding:6px 8px;font:12px ui-monospace,Consolas,monospace;resize:vertical}
    .pkm-btns{display:flex;flex-wrap:wrap;gap:6px}
    .pkm-btn2{all:unset;box-sizing:border-box;cursor:pointer;padding:6px 10px;border-radius:8px;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.14);font-size:12.5px;color:#e8eaf6;white-space:nowrap}
    .pkm-btn2:hover{background:rgba(255,255,255,.16)}
    .pkm-btn2.primary{background:#3c7cff;border-color:#3c7cff;color:#fff}
    .pkm-btn2.primary:hover{background:#5a92ff}
    .pkm-btn2.danger{background:rgba(214,40,57,.25);border-color:rgba(214,40,57,.6)}
    .pkm-btn2[disabled]{opacity:.5;cursor:wait}
    .pkm-x{all:unset;cursor:pointer;width:28px;height:28px;display:grid;place-items:center;border-radius:7px;color:#fff;font-size:14px}
    .pkm-x:hover{background:rgba(255,255,255,.2)}
    .pkm-cmp{width:100%;border-collapse:collapse;font-size:13px;margin:8px 0}
    .pkm-cmp td,.pkm-cmp th{padding:5px 6px;border-bottom:1px solid rgba(255,255,255,.07);text-align:left}
    .pkm-cmp th{opacity:.6;font-weight:600}
    .pkm-cmp .pkm-chg{color:#ffcb05;font-weight:700}
    /* Pokédex */
    .dex-head{display:flex;align-items:center;justify-content:space-between;flex:0 0 auto}
    .dex-head .dex-title{margin:0}
    .dex-progress{flex:0 0 auto;margin-top:8px}
    .dex-progress-bar{height:10px;border-radius:999px;background:#10101a;border:1px solid #2b2b3d;overflow:hidden}
    .dex-progress-bar span{display:block;height:100%;width:0;background:linear-gradient(90deg,#ffcb05,#ff7a00);transition:width .5s}
    .dex-progress-txt{font-size:12px;opacity:.85;margin-top:4px;display:flex;justify-content:space-between}
    .dex-filters{display:flex;flex-wrap:wrap;gap:6px;flex:0 0 auto;margin:8px 0}
    .dex-filters .dex-search{flex:1 1 200px;margin:0!important}
    .dex-filters select{background:#10101a;color:#fff;border:1px solid #2b2b3d;border-radius:8px;padding:6px 8px}
    .dex-entry{cursor:pointer}
    .dex-entry[hidden]{display:none!important}
    .dex-sprite{height:64px}
    .dex-entry.missing .dex-sprite img{filter:brightness(0) opacity(.5)!important}
    .dex-entry.missing .dex-name{opacity:.5}
    .dex-empty{grid-column:1/-1;text-align:center;opacity:.7;padding:30px}
    .dex-empty[hidden]{display:none}
    .pkm-dex-panel .dex-progress,.pkm-dex-panel .dex-filters,.pkm-dex-panel .dex-head{flex:0 0 auto}
    /* Battle keyboard hints */
    .pk-btn .pk-key{position:absolute;left:6px;top:4px;font-size:10px;opacity:.5;font-weight:700}
    @media (prefers-reduced-motion: reduce){
      .pkm-layer *,.pkm-layer *::before,.pkm-layer *::after{animation:none!important;transition:none!important}
    }
  `, "pkm-ui");
  // Bootstrap is loaded inside the game's shadow root (see top). Nothing is injected into the page.
  renderHeader();
  initPartner();
  setInterval(() => {
    updatePokeStopTimer();
    updateNextBattleTimer();
  }, 1000);

  unsafeWindow.changePokemon = (identifier) => {
    const party = getObj(STORAGE.party) || {};
    let id = identifier;
    let name = null;

    // 🧩 If called with a name instead of an ID, find the first match
    if (!party[id]) {
      const found = Object.entries(party).find(
        ([, entry]) => entry.name.toLowerCase() === identifier.toLowerCase()
      );
      if (found) {
        id = found[0];
        name = found[1].name;
      } else {
        name = identifier;
      }
    } else {
      name = party[id].name;
    }

    if (!name) {
      console.warn(`⚠️ changePokemon: Could not find Pokémon "${identifier}".`);
      return;
    }

    // ✅ Save current active Pokémon
    GM_setValue("pkm_starter_id", id);
    GM_setValue(STORAGE.starter, name);

    // ✅ Fetch and refresh HUD for this instance
    fetchPartner(id);
  };
})();

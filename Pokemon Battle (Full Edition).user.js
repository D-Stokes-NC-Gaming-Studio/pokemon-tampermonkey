// ==UserScript==
// @name        Pokemon Battle (Full Edition)
// @author      JellxWrld(@diedrchr), DStokesNCStudio9@esrobbie)
// @connect     pokeapi.co
// @connect     https://dstokesncstudio.com/pokeapi/pokeapi.php
// @namespace   dstokesncstudio.com
// @version     3.8.0.0
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
      if (/\/api\/v2\/pokemon\/[^/?]+\/?$/.test(url) && (e.body.indexOf('"_lv"') < 0 || e.body.indexOf('"_egg"') < 0)) return null;
      // Moves cached before 3.8 lack stat changes, targets and hit counts: fetch them again once.
      if (/\/api\/v2\/move\/[^/?]+\/?$/.test(url) && e.body.indexOf('"stat_changes"') < 0) return null;
      // Species cached before 3.7 lack egg groups and forms (daycare, Mega Evolution): fetch them again once.
      if (/\/api\/v2\/pokemon-species\/[^/?]+\/?$/.test(url) && e.body.indexOf('"egg_groups"') < 0) return null;
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
        delete d.moves; delete d.game_indices; delete d.held_items; delete d.past_types; delete d.past_abilities; delete d.cries;
        if (d.sprites) { delete d.sprites.versions; if (d.sprites.other) d.sprites.other = { "official-artwork": d.sprites.other["official-artwork"] }; }
        return JSON.stringify(d);
      }
      if (d.capture_rate !== undefined && d.evolution_chain) {
        // /pokemon-species/{id}
        const def = (d.varieties || []).find((v) => v.is_default);
        return JSON.stringify({ id: d.id, name: d.name, capture_rate: d.capture_rate, evolution_chain: d.evolution_chain, is_legendary: d.is_legendary,
          is_mythical: d.is_mythical, growth_rate: d.growth_rate, default_variety: def && def.pokemon ? def.pokemon.name : d.name,
          egg_groups: (d.egg_groups || []).map((g) => g.name), hatch_counter: d.hatch_counter, is_baby: !!d.is_baby,
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
      url = "https://raw.githubusercontent.com/D-Stokes-NC-Gaming-Studio/pokemon-tampermonkey/main/Pokemon%20Battle%20(Full%20Edition)-1.0.user.js",
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
      if (GM_getValue("pkm_update_prompted", "") === remoteVersion) return;   // asked about this version already
      GM_setValue("pkm_update_prompted", remoteVersion);
      if (
        confirm(
          `⚡ New version available (${remoteVersion}). Open download page?`
        )
      ) {
        window.open(this.configs.DOWNLOAD_URL, "_blank");
      }
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

    async fetchRemoteVersion(url) {
      // Cached for 6 hours: this used to download the whole script on every HUD redraw.
      try { const c = JSON.parse(GM_getValue("pkm_update_cache", "{}")); if (c.url === url && Date.now() - c.t < 6 * 3600e3) return c.v; } catch {}
      const v = await this._fetchRemoteVersion(url);
      if (v) GM_setValue("pkm_update_cache", JSON.stringify({ url, t: Date.now(), v }));
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
  if (!GM_getValue(STORAGE.soundOn)) setBool(STORAGE.soundOn, true);
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
            if (m.own) openDetail(m.own);
            else pkmToast(`#${m.id} hasn't been caught yet. Keep battling!`);
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
  // === Starter Selection ===
  let starterPanel;
  function openStarter() {
    if (starterPanel) return;
    starterPanel = document.createElement("div");
    Object.assign(starterPanel.style, {
      position: "fixed",
      top: "50%",
      left: "50%",
      transform: "translate(-50%, -50%)",
      background: "#fff",
      color: "#000",
      padding: "12px",
      border: "2px solid black",
      zIndex: "10000",
      maxHeight: "80vh",
      overflowY: "auto",
      width: "320px",
    });
    pkmMount(starterPanel);

    // Add search input
    const search = document.createElement("input");
    search.type = "text";
    search.placeholder = "Search Pokémon...";
    Object.assign(search.style, {
      width: "100%",
      padding: "6px",
      marginBottom: "8px",
      fontSize: "16px",
      boxSizing: "border-box",
    });
    starterPanel.appendChild(search);

    // List container
    const list = document.createElement("div");
    starterPanel.appendChild(list);

    pkmFetch("https://pokeapi.co/api/v2/pokemon?limit=1010")
      .then((res) => res.json())
      .then((data) => {
        const names = data.results.map((p) => p.name);
        renderFilteredList(names, list, search);
        search.addEventListener("input", () =>
          renderFilteredList(names, list, search)
        );
      });

    const cancel = createButton("🚫 Cancel", closeStarter, "btn btn-success");
    cancel.style.marginTop = "10px";
    starterPanel.appendChild(cancel);
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
        <div class="pkm-btns"><button type="button" class="pkm-btn2" data-a="starter">🔄 Change starter</button><button type="button" class="pkm-btn2" data-a="upgradeDex">📖 Upgrade Pokédex data</button></div>
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
      if (a === "starter") return openStarter();
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
  function renderFilteredList(names, container, searchEl) {
    const filter = searchEl.value.trim().toLowerCase();
    container.innerHTML = "";

    // ✅ Filter results by name (case-insensitive) and limit for performance
    const filtered = names
      .filter((n) => n.toLowerCase().includes(filter))
      .slice(0, 50);

    if (filtered.length === 0) {
      const noRes = document.createElement("div");
      noRes.textContent = "No Pokémon found.";
      noRes.style.opacity = "0.7";
      noRes.style.marginTop = "8px";
      container.appendChild(noRes);
      return;
    }

    for (const name of filtered) {
      const displayName = name[0].toUpperCase() + name.slice(1);

      const btn = createButton(
        displayName,
        () => {
          // ✅ Generate a unique instance ID for this starter
          const id = generateUniqueId(name);

          // Create new party entry if not exists
          const party = getObj(STORAGE.party) || {};
          if (!party[id]) {
            party[id] = {
              name,
              caughtAt: Date.now(),
            };
            setObj(STORAGE.party, party);
          }

          // ✅ Set as active Pokémon (instance-based)
          GM_setValue("pkm_starter_id", id);
          GM_setValue(STORAGE.starter, name);

          // ✅ Load it immediately
          fetchPartner(id);

          // ✅ Close the starter selection UI
          closeStarter();

          // ✅ Refresh header UI
          renderHeader();
        },
        "btn btn-success"
      );

      btn.style.margin = "2px";
      container.appendChild(btn);
    }
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
    const cats = [["all", "All"], ["balls", "Poké Balls"], ["medicine", "Medicine"], ["battle", "Battle"], ["held", "Held items"], ["evolution", "Evolution"], ["key", "Key items"]];
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

    const itemsHtml = PKM_ITEMS.filter((it) => !["evolution", "held", "key"].includes(it.cat) || getInt(it.key) > 0).map(
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
    const items = [
      ["⚔️", "Battle", () => openBattle()],
      ["🧢", "Trainers & Gyms", () => pkmOpenTrainers()],
      ["📍", "PokéStop", () => openPokeStop()],
      ["❤️", `Pokémon Center (${POKE_CENTER_COST})`, () => pokeCenter()],
      ["🛒", "Shop", () => openShop()],
      ["🎒", "Bag", () => openBag()],
      ["📖", "Pokédex", () => openPokedex()],
      ["🏅", "Badges & stats", () => pkmOpenBadges()],
      ["🎁", "Daily reward", () => pkmOpenDaily()],
      ["📋", "Daily quests", () => pkmOpenBadges("quests")],
      ["🗺️", "World map", () => pkmOpenMap()],
      ["🌴", "Safari Zone", () => pkmOpenSafari()],
      ["🗼", "Battle Tower", () => pkmOpenTower()],
      ["🌟", "Legendary hunt", () => pkmOpenLegends()],
      ["🥚", "Daycare & Eggs", () => pkmOpenDaycare()],
      ["🏋️", "Training center", () => pkmOpenTraining()],
      ["🏟️", "Battle Frontier", () => pkmOpenFrontier()],
      ["💥", "Raid den", () => pkmOpenRaids()],
      ["🍓", "Berry garden", () => pkmOpenGarden()],
      ["🎀", "Contests", () => pkmOpenContests()],
      ["📖", "Story", () => pkmOpenStory()],
      ["🔗", "Link & gifts", () => pkmOpenLink()],
      ["📖", "Pokédex prizes", () => pkmOpenBadges("dex")],
      null,
      [hudHidden ? "👁️" : "🙈", hudHidden ? "Show HUD" : "Hide HUD", () => pkmSetHudHidden(!hudHidden, false)],
      ["📌", "Reset HUD position", () => pkmResetHud()],
      ["🛠️", "Options & tools", () => pkmOpenOptions()],
      ["⚙️", "Settings", () => openSettings()],
      ["⏸️", `Turn off on ${location.hostname}`, () => pkmTurnOffHere()],
    ];
    pkmMenu.innerHTML = `<div class="pkm-menu-head"><span>Pokémon</span><span class="pkm-dim">💰 ${getInt(STORAGE.coins)}</span></div>`;
    for (const it of items) {
      if (!it) { const s = document.createElement("div"); s.className = "pkm-menu-sep"; pkmMenu.appendChild(s); continue; }
      const b = document.createElement("button");
      b.type = "button";
      b.className = "pkm-menu-item";
      b.setAttribute("role", "menuitem");
      b.innerHTML = `<span class="ico" aria-hidden="true">${it[0]}</span><span>${pkmEsc(it[1])}</span>`;
      b.onclick = () => { pkmLauncherMenu(false); it[2](); };
      pkmMenu.appendChild(b);
    }
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
    const items = [...pkmMenu.querySelectorAll(".pkm-menu-item")];
    const i = items.indexOf(e.target);
    let n = null;
    if (e.key === "ArrowDown") n = (i + 1) % items.length;
    else if (e.key === "ArrowUp") n = (i - 1 + items.length) % items.length;
    else if (e.key === "Home") n = 0;
    else if (e.key === "End") n = items.length - 1;
    else if (e.key === "Tab") { pkmLauncherMenu(false); return; }
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
  const pkmMine = (b, m) => m !== b.foe;
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
    await pkmHazards(b, m);
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
      if (pkb !== b || !battlePanel) return;
      pkmSyncGlobals(b);
      pkmTrack("battles");
      b.zone = (b.foe && b.foe.zone) || (trainer && trainer.zone) || null;
      if (trainer && trainer.weather) b.weather = { id: trainer.weather, turns: Infinity };
      else if (!trainer || !(trainer.gym || trainer.league != null || trainer.pvp || trainer.arcade || trainer.facility)) pkmRandomField(b, trainer && trainer.tower ? 0.4 : 0.3);
      const arcadeTxt = trainer && trainer.arcade ? pkmArcadeApply(b, trainer.arcade) : "";
      let intro = b.foe.legend ? `✨ A legendary aura fills the air… ${b.foe.display} appeared!` : trainer ? `${trainer.title} ${trainer.name} wants to battle! They sent out ${b.foe.display}!` : `A wild ${b.foe.shiny ? "✨ shiny " : ""}${b.foe.display} appeared!`;
      if (b.foe.raid) intro = `💥 RAID BATTLE! A ${"★".repeat(b.foe.raid)} ${b.foe.display} towers over the field!`;
      if (b.weather) intro += ` ${PKM_WEATHER[b.weather.id].on}`;
      if (b.terrain) intro += ` ${PKM_TERRAIN[b.terrain.id].on}`;
      if (arcadeTxt) intro += ` ${arcadeTxt}`;
      if (b.foe.costume) intro += ` It's wearing a costume!`;
      if (lead.id !== activeId) intro += ` Go, ${b.me.display}!`;
      if ((b.me.learned || []).length) intro += ` ${b.me.display} learned ${b.me.learned.map(pkmCap).join(", ")}!`;
      if ((b.me.pending || []).length) intro += ` (${b.me.display} wants to learn ${b.me.pending.map(pkmCap).join(", ")}: Bag → Moves)`;
      await pkmSay(b, intro, 1200);
      await pkmOnEntry(b, b.me, b.foe);
      await pkmOnEntry(b, b.foe, b.me);
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
        const mx = me.dynamax > 0 ? pkmMaxMove(m) : null;
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
    old.confused = 0; old.charging = null; old.invuln = false; old.sub = 0; old.mustRecharge = false; old.flinched = false;
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
    if (att.tera) stab = mv.type === att.tera ? ((att.origTypes || []).includes(mv.type) ? 2 : 1.5) : (att.origTypes || []).includes(mv.type) ? 1.5 : 1;
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
    if (!m.dynaBase || !m.maxHP || !(m.dynamax > 0 || m.gmaxOrig)) { m.dynamax = 0; return; }
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
    if (mine && !second) ppMove.pp = Math.max(0, ppMove.pp - 1);
    if (mv.cls !== "status" && (att.ability === "protean" || att.ability === "libero") && (att.types.length !== 1 || att.types[0] !== mv.type)) att.types = [mv.type];
    await pkmSay(b, mv.z ? `${who} unleashed its full Z-Power! ${mv.display}!` : mv.max ? `${who} used ${mv.display}!` : `${who} used ${mv.display}!`, mv.z || mv.max ? 1100 : 650);
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
    for (const m of [b.me, b.foe]) {
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
    for (const m of [b.me, b.foe]) {
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
    if (mineMv && b.arm === "mega" && !b.specialUsed) { b.arm = null; drawBattle(); await pkmMegaEvolve(b); if (!pkmAlive(b)) return; }
    else if (mineMv && b.arm === "z" && !b.specialUsed && mineMv.cls !== "status" && !mineMv.srcMove) { b.specialUsed = true; mineMv = pkmZMove(mineMv); pkmTrack("zmoves"); }
    else if (mineMv && b.arm === "tera" && !b.specialUsed) { b.arm = null; drawBattle(); await pkmTerastallize(b); if (!pkmAlive(b)) return; }
    else if (mineMv && b.arm === "dyna" && !b.specialUsed) { b.arm = null; drawBattle(); await pkmDynamax(b); if (!pkmAlive(b)) return; }
    b.arm = null;
    if (mineMv && b.me.dynamax > 0 && !mineMv.max) mineMv = pkmMaxMove(mineMv);
    drawBattle();
    const foeMove = b.foe.charging || pkmAiMove(b.foe, b.me, b);
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
        pkmStartTrainer(pkmGymTrainer(gym));
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
      const opts = node ? node.evolves_to.filter((n) => (n.evolution_details || []).some((d) => d.trigger && d.trigger.name === "use-item" && d.item && d.item.name === stone)) : [];
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
  const PKM_EVO_UNSUPPORTED = ["held_item", "known_move", "known_move_type", "location", "min_affection", "min_beauty", "gender", "party_species",
    "party_type", "relative_physical_stats", "needs_overworld_rain", "trade_species", "turn_upside_down", "item"];
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
        (!d.time_of_day || d.time_of_day === tod);
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
        const sp = legend ? pkmPick(PKM_SAFARI_LEGENDS) : pkmPick(PKM_SAFARI_POOL);
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
  const pkmTowerCoins = (tr) => Math.floor((80 + tr.streak * 25) * (tr.boss ? 3 : 1));
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
  function pkmFriendBattle(f) {
    pkmCloseLink();
    pkmStartTrainer({ title: "Friend", name: f.name, sprite: `${PKM_TRAINER_IMG}acetrainer.png`, lose: "Good game!", team: f.team, pvp: true, gym: 0 });
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
        <div class="pkm-btns"><button type="button" class="pkm-btn2 primary" data-a="fight">⚔️ Battle this team</button></div>`;
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
    if (a === "fight") {
      const f = pkmParseTeamCode(val(".lk-friend"));
      if (!f) { pkmLinkMsg = "That isn't a valid team code."; return pkmDrawLink(); }
      return pkmFriendBattle(f);
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
    const area = pkmClamp(pkmAreaLevel() - pkmRand(2, 8), 2, MAX_LEVEL);
    const party = pkmClamp((partyLevel || 5) + pkmRand(-3, 1), 2, MAX_LEVEL);
    const lvl = mode === "party" ? party : mode === "mixed" ? Math.round((area + party) / 2) : area;
    return pkmClamp(lvl + pkmDiffOffset(), 2, MAX_LEVEL);
  }
  function pkmTrainerBase() {
    const mode = pkmLevelMode();
    const party = activeStats().level || 5;
    const area = pkmAreaLevel() - 3;
    return pkmClamp((mode === "party" ? party : mode === "mixed" ? Math.round((party + area) / 2) : area) + pkmDiffOffset(), 3, MAX_LEVEL);
  }
  function pkmSafariBase() {
    const mode = pkmLevelMode();
    const party = activeStats().level || 10;
    const area = pkmAreaLevel();
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
  const pkmZoneOpen = (z) => { const ri = PKM_REGIONS.findIndex((r) => r.id === z.region); return pkmRegionOpen(ri) && pkmRegionBadges(pkmRegion(z.region)).length >= z.req; };
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
    const pos = zones.map((_, i) => { const row = Math.floor(i / 3); const col = row % 2 ? 2 - (i % 3) : i % 3; return [16 + col * 34, 20 + row * 46]; });
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
  const PKM_VERSION = "3.8";
  const PKM_CHANGES = [
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
    if (Object.keys(getObj(STORAGE.party) || {}).length) pkmToast("✨ Pokémon 3.8: status moves, a world map, wild levels that follow your badges, Tera and Dynamax, a Training center, Battle Frontier, raids, a garden, contests and a story. See Options → What's new.", 9000);
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
    ["story", () => pkmStoryPanel, () => pkmCloseStory()]
  );
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
    .pkm-menu{position:fixed;left:58px;top:max(10px,calc(50% - 210px));z-index:10003;min-width:220px;max-height:calc(100vh - 20px);overflow:auto;background:rgba(17,20,33,.97);
      color:#e8eaf6;border:1px solid rgba(255,255,255,.12);border-radius:14px;box-shadow:0 14px 40px rgba(0,0,0,.5);padding:6px;display:grid;gap:2px;
      animation:pkmPop .14s ease-out}
    .pkm-menu[hidden]{display:none}
    .pkm-menu-head{padding:6px 10px 8px;font-weight:700;font-size:13px;border-bottom:1px solid rgba(255,255,255,.08);margin-bottom:4px;display:flex;justify-content:space-between;align-items:center}
    .pkm-menu-item{all:unset;box-sizing:border-box;display:flex;gap:10px;align-items:center;padding:7px 10px;border-radius:9px;cursor:pointer;font-size:13px}
    .pkm-menu-item:hover{background:rgba(255,255,255,.1)}
    .pkm-menu-item .ico{width:20px;text-align:center}
    .pkm-menu-sep{height:1px;background:rgba(255,255,255,.08);margin:4px 2px}
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

// ==UserScript==
// @name        Pokemon Battle (Full Edition)
// @author      JellxWrld(@diedrchr), DStokesNCStudio9@esrobbie)
// @connect     pokeapi.co
// @connect     https://dstokesncstudio.com/pokeapi/pokeapi.php
// @namespace   dstokesncstudio.com
// @version     3.0.0.6
// @description Full version with XP, evolution, stats, sound, shop, battles, and walking partner — persistent across sites.
// @include     *
// @grant       GM.xmlHttpRequest
// @grant       unsafeWindow
// @grant       GM_getValue
// @grant       GM_setValue
// @grant       GM_xmlhttpRequest
// @grant       GM_addStyle
// @connect     github.com
// @connect     raw.githubusercontent.com
// @connect     play.pokemonshowdown.com
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
  GM_addStyle(`
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

`);
  // 🔥 --- Custom Pokemon Logger (paste the whole code here) ---
  (function attachPokemonLogger(global = window) {
    const LEVELS = ["debug", "log", "info", "warn", "error"];
    const DEFAULT_COLOR = "#ff4b2b";

    function fmtNow() {
      const d = new Date();
      return d.toLocaleTimeString(undefined, { hour12: false }) + "." + String(d.getMilliseconds()).padStart(3, "0");
    }

    function makePrinter(scope, color = DEFAULT_COLOR, enabled = true, minLevel = "debug") {
      const minIdx = Math.max(0, LEVELS.indexOf(minLevel));

      function style(labelColor) {
        return [
          `%c${fmtNow()} %c${scope}%c`,
          "opacity:.7",
          `background:${labelColor}; color:#fff; padding:2px 6px; border-radius:6px; font-weight:700`,
          "color:inherit"
        ];
      }

      const api = {
        scope,
        enabled,
        color,
        level: minLevel,
        setEnabled(v) { api.enabled = !!v; return api; },
        setLevel(lvl) { api.level = lvl; return api; },
        setColor(c) { api.color = c; return api; },

        child(subScope, subColor) {
          return makePrinter(`${scope}.${subScope}`, subColor || color, api.enabled, api.level);
        },

        _buffer: [],
        get history() { return api._buffer.slice(); },
        clearHistory() { api._buffer.length = 0; },

        debug(...args) { return _print("debug", args); },
        log(...args) { return _print("log", args); },
        info(...args) { return _print("info", args); },
        warn(...args) { return _print("warn", args); },
        error(...args) { return _print("error", args); },
        success(...args) { return _print("log", args, "#2e7d32"); }
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

    Object.defineProperty(global, "pokemon", { value: pokemon, writable: false });
  })(typeof unsafeWindow !== "undefined" ? unsafeWindow : window);

  pokemon.log("Pokemon script started ✅");
  // --- Configs class (example usage) ---
  class Configs {
    constructor(
      url = "https://raw.githubusercontent.com/D-Stokes-NC-Gaming-Studio/pokemon-tampermonkey/main/Pokemon%20Battle%20(Full%20Edition)-1.0.user.js",
      currentVersion = (typeof GM_info !== "undefined" && GM_info?.script?.version)
        ? GM_info.script.version
        : "0.0.0"
    ) {
      this.DOWNLOAD_URL = url;
      this.CURRENT_VERSION = currentVersion;
      this._updateChecking = false;
      this.STORAGE = {
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
      };
      this.POKEAPI_VALID_FORMS = {
        // only include forms that PokéAPI has sprites for
        mega: [
          "charizard-mega-x",
          "charizard-mega-y",
          "mewtwo-mega-x",
          "mewtwo-mega-y",
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
      this.SPRITE_NAME_FIXES = {
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
        // Add more as needed
      };
      this.SOUNDS = {
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
      this.XP_TO_LEVEL = (lvl) => 50 + lvl * 25;
      this.POKE_CENTER_COST = 250; // coins
      this.getInt = (k, d = 0) => {
        const v = parseInt(GM_getValue(k, d), 10);
        return isNaN(v) ? d : v;
      };
      this.setInt = (k, v) => GM_setValue(k, parseInt(v, 10));

      this.getBool = (k) => GM_getValue(k, "false") === "true";
      this.setBool = (k, v) => GM_setValue(k, v ? "true" : "false");

      this.getObj = (k) => {
        try {
          return JSON.parse(GM_getValue(k, "{}")) || {};
        } catch {
          return {};
        }
      };
      this.setObj = (k, o) => GM_setValue(k, JSON.stringify(o));

      this.getStr = (k, d = "") => GM_getValue(k, d);
      this.setStr = (k, v) => GM_setValue(k, v);
      this.getArr = (k) => {
        try {
          return JSON.parse(GM_getValue(k, "[]")) || [];
        } catch {
          return [];
        }
      };
      this.setArr = (k, a) => GM_setValue(k, JSON.stringify(a));

      if (!GM_getValue(this.STORAGE.coins)) this.setInt(this.STORAGE.coins, 100);
      if (!GM_getValue(this.STORAGE.balls)) this.setInt(this.STORAGE.balls, 5);
      if (!GM_getValue(this.STORAGE.potions)) this.setInt(this.STORAGE.potions, 2);
      if (!GM_getValue(this.STORAGE.greatBalls)) this.setInt(this.STORAGE.greatBalls, 0);
      if (!GM_getValue(this.STORAGE.ultraBalls)) this.setInt(this.STORAGE.ultraBalls, 0);
      if (!GM_getValue(this.STORAGE.masterBalls)) this.setInt(this.STORAGE.masterBalls, 0);
      if (!GM_getValue(this.STORAGE.pokestopCooldown))
        this.setInt(this.STORAGE.pokestopCooldown, 0);
      if (!GM_getValue(this.STORAGE.pokedex)) this.setArr(this.STORAGE.pokedex, []);
      if (!GM_getValue(this.STORAGE.party)) {
        this.setObj(this.STORAGE.party, {});
      } else {
        // Migration from old array party format
        const val = GM_getValue(this.STORAGE.party);
        try {
          const parsed = JSON.parse(val);
          if (Array.isArray(parsed)) {
            const objParty = {};
            for (const name of parsed) {
              const key = name.toLowerCase();
              objParty[key] = (objParty[key] || 0) + 1;
            }
            this.setObj(this.STORAGE.party, objParty);
          }
        } catch { }
      }
      if (!GM_getValue(this.STORAGE.soundOn)) this.setBool(this.STORAGE.soundOn, true);
      if (!GM_getValue(this.STORAGE.xp)) this.setInt(this.STORAGE.xp, 0);
      if (!GM_getValue(this.STORAGE.level)) this.setInt(this.STORAGE.level, 1);
      if (!GM_getValue(this.STORAGE.stats)) this.setObj(this.STORAGE.stats, { hp: 100, atk: 15 });

      pokemon.configs.info("Loading configs...");
    }

    getRandomForm(baseName) {
      const isShiny = Math.random() < 0.05;
      const allForms = Object.entries(this.POKEAPI_VALID_FORMS).flatMap(
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
    getStats(name) {
      const allStats = this.getObj(this.STORAGE.stats);
      return (
        allStats[name.toLowerCase()] || { xp: 0, level: 1, hp: 100, atk: 15 }
      );
    }

    setStats(name, stats) {
      const allStats = this.getObj(this.STORAGE.stats);
      allStats[name.toLowerCase()] = stats;
      this.setObj(this.STORAGE.stats, allStats);
    }

    logInfo() {
      pokemon.configs.info("Config ready:", "Starting to check for updates...");
      this.checkUpdates(); // ✅ Kick off update check here if you want
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
      const remoteVersion = await this.fetchRemoteVersion(this.configs.DOWNLOAD_URL);
      pokemon.configs.info("Remote Version:", remoteVersion || "Unknown");
      pokemon.configs.info("Current Version:", this.configs.CURRENT_VERSION);

      if (!remoteVersion) {
        pokemon.configs.warn("⚠️ Could not fetch remote version.");
        return;
      }

      const cmp = this.compareVersions(remoteVersion, this.configs.CURRENT_VERSION);
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
      if (confirm(`⚡ New version available (${remoteVersion}). Open download page?`)) {
        window.open(this.configs.DOWNLOAD_URL, "_blank");
      }
    }

    async needsUpdate() {
      const remoteVersion = await this.fetchRemoteVersion(this.configs.DOWNLOAD_URL);
      if (!remoteVersion) return false;
      return this.compareVersions(remoteVersion, this.configs.CURRENT_VERSION) > 0;
    }

    async fetchRemoteVersion(url) {
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
      const parts = v.split(/[.\-]/).map(seg => {
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
    /:\/\/chatgpt\.com\//,
    /:\/\/github\.com\//,
    /:\/\/youtube\.com\//,
    /:\/\/password-v2\.corp\.amazon\.com/,
    /:\/\/password\.amazon\.com/,
    /:\/\/amazonots\.service-now\.com/,
    /:\/\/ithelp\.corp\.amazon\.com/,
    /:\/\/prod\.dscs\.opstechit\.amazon\.dev/,
    /:\/\/apxprod\.dscs\.opstechit\.amazon\.dev/,
    /:\/\/zebratool\.corp\.amazon\.com/,
    /:\/\/t\.corp\.amazon\.com/,

    /// DoubleClick ad domains
    // Add more patterns as needed
  ];
  //#region Update check (optional, uncomment to enable)
  /*
  // ====== CONFIG ======
  const DOWNLOAD_URL =
  "https://raw.githubusercontent.com/D-Stokes-NC-Gaming-Studio/pokemon-tampermonkey/refs/heads/main/Pokemon%20Battle%20(Full%20Edition)-1.0.user.js";
  // If you prefer the link you pasted, it redirects from github.com -> raw.githubusercontent.com.
  // Using raw directly avoids extra hops.
  
  
  const CURRENT_VERSION =
  typeof GM_info !== "undefined" && GM_info.script && GM_info.script.version
    ? GM_info.script.version
    : "0.0.0";
  const rVersion = fetchRemoteVersion(DOWNLOAD_URL);
  console.log("RemoteVersion: " + rVersion);
  console.log("CURRENTVERSION: " + CURRENT_VERSION);
  // ====== UPDATE CHECK ======
  // ====== VERSION COMPARISON (hardened) ======
  function normalizeVersion(v, length = 4) {
  // "v1.2.3" -> [1,2,3,0]
  // "1.2.3-beta.1" -> [1,2,3,1]
  // "1.0.0.0" -> [1,0,0,0]
  // "1.2" -> [1,2,0,0]
  if (!v) return Array.from({ length }, () => 0);
  v = String(v).trim().replace(/^v/i, ""); // strip leading 'v'
  const parts = v.split(/[.\-]/).map((seg) => {
    const m = String(seg).match(/^\d+/); // take leading digits only
    return m ? parseInt(m[0], 10) : 0;
  });
  while (parts.length < length) parts.push(0);
  if (parts.length > length) parts.length = length;
  return parts;
  }
  
  // returns 1 if a>b, 0 if equal, -1 if a<b
  function compareVersions(a, b) {
  const A = normalizeVersion(a, 4);
  const B = normalizeVersion(b, 4);
  for (let i = 0; i < A.length; i++) {
    if (A[i] > B[i]) return 1;
    if (A[i] < B[i]) return -1;
  }
  return 0;
  }
  
  // ====== FETCH REMOTE VERSION ======
  function fetchRemoteVersion(url) {
  return new Promise((resolve) => {
    GM_xmlhttpRequest({
      method: "GET",
      url: url, // bust cache
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
  */


  /**
  * Checks if there is an update available for this userscript.
  * @returns {Promise<boolean>} true if remote version > CURRENT_VERSION
  
  async function tampermonkeyNeedsUpdate() {
  try {
    const remoteVersion = await fetchRemoteVersion(DOWNLOAD_URL);
    if (!remoteVersion) return false;
    // Debug (optional)
    // console.log('remote:', remoteVersion, 'local:', CURRENT_VERSION, 'cmp:', compareVersions(remoteVersion, CURRENT_VERSION));
    return compareVersions(remoteVersion, CURRENT_VERSION) > 0;
  } catch {
    return false;
  }
  }
  */
  //#endregion

  // Check if current URL matches any blocklist rule
  if (BLOCKLIST.some((rx) => rx.test(location.href))) return;

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
    "farfetchd": "farfetchd",
    "mr-mime": "mrmime",
    "mr-rime": "mrrime",
    "mime-jr": "mimejr",
    "flabebe": "flabebe",
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

  function setStats(name, stats) {
    const allStats = getObj(STORAGE.stats);
    allStats[name.toLowerCase()] = stats;
    setObj(STORAGE.stats, allStats);
  }

  const getInt = (k, d = 0) => {
    const v = parseInt(GM_getValue(k, d), 10);
    return isNaN(v) ? d : v;
  };
  const setInt = (k, v) => GM_setValue(k, parseInt(v, 10));

  const getBool = (k) => GM_getValue(k, "false") === "true";
  const setBool = (k, v) => GM_setValue(k, v ? "true" : "false");

  const getObj = (k) => {
    try {
      return JSON.parse(GM_getValue(k, "{}")) || {};
    } catch {
      return {};
    }
  };
  const setObj = (k, o) => GM_setValue(k, JSON.stringify(o));

  const getStr = (k, d = "") => GM_getValue(k, d);
  const setStr = (k, v) => GM_setValue(k, v);
  const getArr = (k) => {
    try {
      return JSON.parse(GM_getValue(k, "[]")) || [];
    } catch {
      return [];
    }
  };
  const setArr = (k, a) => GM_setValue(k, JSON.stringify(a));

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
    } catch { }
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
      container.innerHTML = `
    <h2 class="dex-title">Pokédex</h2>
    <input type="text" id="dexSearch" placeholder="Search name or #..." class="dex-search" />
    <div class="dex-grid"></div>
    <div class="dex-footer"></div>
  `;

      const dexGrid = container.querySelector(".dex-grid");
      const owned = new Set(this.entries.map(e => e.name.toLowerCase()));

      fetch("https://pokeapi.co/api/v2/pokemon?limit=1010")
        .then(res => res.json())
        .then(data => {
          data.results.forEach((poke, index) => {
            const name = poke.name;
            const ownedEntry = this.entries.find(e => e.name.toLowerCase() === name);
            const isOwned = !!ownedEntry;

            const sprite = isOwned
              ? ownedEntry.spriteUrl
              : "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/poke-ball.png";

            const card = document.createElement("div");
            card.className = "dex-entry";
            card.innerHTML = `
          <div class="dex-number">#${index + 1}</div>
          <div class="dex-sprite"><img src="${sprite}" alt="${isOwned ? ownedEntry.name : "unknown"}"/></div>
          <div class="dex-name">${isOwned ? ownedEntry.name : "???????"}</div>
        `;
            if (isOwned) {
              card.onclick = () => openDetail(ownedEntry);
              card.classList.add("owned");
            } else {
              card.onclick = () => alert("You haven't discovered this Pokémon yet!");
            }
            dexGrid.appendChild(card);
          });

          // live search
          container.querySelector("#dexSearch").addEventListener("input", e => {
            const q = e.target.value.toLowerCase();
            for (const card of dexGrid.children) {
              const name = card.querySelector(".dex-name").textContent.toLowerCase();
              const num = card.querySelector(".dex-number").textContent.toLowerCase();
              card.style.display = (name.includes(q) || num.includes(q)) ? "" : "none";
            }
          });
        });

      container.querySelector(".dex-footer").appendChild(
        createButton("Close Pokédex", closePokedex, "btn btn-light mt-3 w-100")
      );
    }


    getOwnedCount() {
      return this.entries.length;
    }

    getCompletionRate(total = 1010) {
      return ((this.getOwnedCount() / total) * 100).toFixed(2) + "%";
    }

    hasPokemon(name) {
      return this.entries.some(e => e.name.toLowerCase() === name.toLowerCase());
    }

    getEntry(name) {
      return this.entries.find(e => e.name.toLowerCase() === name.toLowerCase()) || null;
    }

    listAllOwned() {
      return this.entries.map(e => e.name);
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
      width: "600px",
      height: "600px",
      overflowY: "auto",
    });
    document.body.appendChild(pokedexPanel);
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
  wrap.classList = "bg-dark bg-opacity-50 border border-1 border-dark";

  document.body.appendChild(wrap);
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
      } catch { }
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
      bar.textContent = "≡ Pokémon HUD";
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
  const XP_CURVE = "smooth";     // 'linear' | 'smooth' | 'fast' | 'slow' | 'mediumFast'
  const XP_SCALE = 25;           // global multiplier (raise to require more XP)
  function xpThreshold(level) {
    const L = Math.max(1, (level | 0));

    switch (XP_CURVE) {
      case "linear":
        // ~ your old 50 + 25*L
        return Math.max(1, 50 + 25 * L);

      case "fast":
        // gentler growth
        return Math.max(1, Math.round(30 + XP_SCALE * Math.pow(L, 1.20)));

      case "slow":
        // steeper growth
        return Math.max(1, Math.round(60 + XP_SCALE * Math.pow(L, 1.60)));

      case "mediumFast":
        // Pokémon-style "medium fast": total XP ≈ n^3. Per-level increment is Δ(n^3) = 3n^2+3n+1.
        // Scaled so numbers stay in your existing range.
        return Math.max(1, Math.round((3 * L * L + 3 * L + 1) * (XP_SCALE / 2)));

      case "smooth":
      default:
        // Nice S-curve feel; default
        return Math.max(1, Math.round(40 + XP_SCALE * Math.pow(L, 1.40)));
    }
  }

  /** Progress helper for HUD bars (level-local). */
  function xpProgress(level, xpInLevel) {
    const need = xpThreshold(level);
    const have = Math.max(0, Math.min(need, Number(xpInLevel) || 0));
    const pct = Math.min(100, Math.round((have / need) * 100));
    return { need, have, pct };
  }
  function addXP(name, amount, { autoLevel = true } = {}) {
    const key = String(name || "").toLowerCase();
    const s = getStats(key) || { xp: 0, level: 1, hp: 100, atk: 15, currentHP: 100 };
    let gained = Math.max(0, Number(amount) || 0);
    let leveled = 0;
    let leveledUp = false;
    if (!gained) return { leveled: 0, newLevel: s.level, xpInLevel: s.xp, need: xpThreshold(s.level) };

    s.xp = Math.max(0, Number(s.xp) || 0);

    if (autoLevel) {
      while (gained > 0) {
        const need = xpThreshold(s.level);
        const space = Math.max(0, need - s.xp);

        if (gained < space) {
          s.xp += gained;
          gained = 0;
          break;
        }

        // Fill current level, level up, carry over remainder
        s.xp += space;
        gained -= space;

        // Level up
        s.level += 1;
        leveled += 1;
        leveledUp = true;
        s.xp = 0;

        // Optional: tiny stat bumps per level (tune or remove)
        s.hp = Math.round((s.hp || 100) * 1.04);
        s.atk = Math.round((s.atk || 15) * 1.03);
        s.currentHP = Math.min(s.hp, s.currentHP == null ? s.hp : s.currentHP + Math.ceil(s.hp * 0.25));
        alert(
          `🎉 ${partnerName} leveled up to ${s.level}! HP and ATK increased.`
        );
        if (leveledUp) evolvePartner();

      }
    } else {
      const need = xpThreshold(s.level);
      s.xp = Math.min(need, s.xp + gained);
      gained = 0;
    }

    setStats(key, s);
    const prog = xpProgress(s.level, s.xp);
    updateHeaderHP();
    return { leveled, newLevel: s.level, xpInLevel: s.xp, need: prog.need, pct: prog.pct };
  }

  /** Set a Pokémon's XP to the maximum for its current level (fills the bar). */
  function setXPToMax(name) {
    const key = String(name || "").toLowerCase();
    const s = getStats(key);
    if (!s) return 0;
    const need = xpThreshold(s.level);
    const before = Number(s.xp) || 0;
    s.xp = need;
    setStats(key, s);
    return Math.max(0, need - before); // amount filled
  }
  async function renderHeader() {
    const root = wrap.querySelector("[data-hud-body]") || wrap;
    root.innerHTML = "";

    // --- Active Pokémon lookup ---
    const starterId = GM_getValue("pkm_starter_id");
    const party = getObj(STORAGE.party) || {};
    const starterEntry = starterId ? party[starterId] : null;

    // ✅ Determine current Pokémon name
    const name = starterEntry?.name || getStr(STORAGE.starter) || null;

    // --- Fetch stats ---
    let stats;
    if (starterId && starterEntry) {
      // ✅ Load instance stats first
      stats = getStatsForInstance(starterId, starterEntry.name);
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
    if(lvl >= MAX_LEVEL) {
      xp = nextXp;
    }
    // --- Top row: Partner name + bars ---
    const topRow = document.createElement("div");
    Object.assign(topRow.style, {
      display: "flex",
      alignItems: "center",
      gap: "16px",
      marginBottom: "8px",
    });

    // Partner label
    const partnerDiv = document.createElement("div");
    partnerDiv.id = "pkm-partner";

    if (name) {
      partnerDiv.textContent = `Partner: ${name[0].toUpperCase() + name.slice(1)} (Lv ${lvl}) | ATK: ${atk}`;
    } else {
      partnerDiv.textContent = "Choose your starter!";
    }

    topRow.appendChild(partnerDiv);

    // Bars container
    const bars = document.createElement("div");
    Object.assign(bars.style, {
      display: "flex",
      gap: "12px",
      flexShrink: "0",
    });

    // --- HP bar ---
    const hpWrapper = document.createElement("div");
    hpWrapper.style.display = "flex";
    hpWrapper.style.flexDirection = "column";

    const hpLabel = document.createElement("small");
    hpLabel.id = "pkm-hp-label";
    hpLabel.textContent = `HP: ${curHp}/${maxHp}`;

    const hpPct = Math.round((curHp / maxHp) * 100);
    const hpBar = document.createElement("div");
    hpBar.id = "pkm-hp-bar";
    hpBar.className = "progress";
    hpBar.style.width = "120px";
    hpBar.style.height = "8px";
    hpBar.innerHTML = `
    <div class="progress-bar bg-danger"
         role="progressbar"
         style="width: ${hpPct}%;"
         aria-valuenow="${hpPct}"
         aria-valuemin="0"
         aria-valuemax="100"></div>
  `;
    hpWrapper.append(hpLabel, hpBar);

    // --- XP bar ---
    const xpWrapper = document.createElement("div");
    xpWrapper.style.display = "flex";
    xpWrapper.style.flexDirection = "column";

    const xpLabel = document.createElement("small");
    xpLabel.id = "pkm-xp-label";
    xpLabel.textContent = `XP: ${xp}/${nextXp}`;

    const xpBar = document.createElement("div");
    xpBar.className = "progress";
    xpBar.style.width = "120px";
    xpBar.style.height = "8px";
    xpBar.innerHTML = `
    <div class="progress-bar bg-info"
         role="progressbar"
         style="width: ${xpPct}%;"
         aria-valuenow="${xpPct}"
         aria-valuemin="0"
         aria-valuemax="100"></div>
  `;
    xpWrapper.append(xpLabel, xpBar);

    bars.append(hpWrapper, xpWrapper);
    topRow.append(bars);
    root.appendChild(topRow);

    // --- Currency & timers ---
    const status = document.createElement("div");
    let timerStr = "";

    if (nextBattleTime && randomBattleEnabled) {
      const d = Math.max(0, nextBattleTime - Date.now());
      timerStr += ` | <span id="nextBattleStatus">Next Battle: ${Math.floor(d / 60000)}m ${Math.floor(
        (d % 60000) / 1000
      )}s</span>`;
    } else {
      timerStr += ` | <span id="nextBattleStatus">Next Battle: —</span>`;
    }

    const psCd = getInt(STORAGE.pokestopCooldown);
    if (psCd > Date.now()) {
      const r = psCd - Date.now();
      timerStr += ` | <span id="pokeStopStatus">PokéStop: ${Math.floor(r / 60000)}m ${Math.floor(
        (r % 60000) / 1000
      )}s</span>`;
    } else {
      timerStr += ` | <span id="pokeStopStatus">PokéStop: Ready!</span>`;
    }

    status.innerHTML = `<span id="pk-header-coins">💰 Coins: ${getInt(STORAGE.coins)}</span> | Balls: ${getInt(
      STORAGE.balls
    )} | Potions: ${getInt(STORAGE.potions)}${timerStr}`;
    root.appendChild(status);

    // --- Buttons row ---
    const row = document.createElement("div");
    Object.assign(row.style, {
      display: "flex",
      flexWrap: "wrap",
      gap: "6px",
      marginTop: "8px",
    });

    row.appendChild(createButton("⚔️ Battle", openBattle, "btn btn-success btn-sm"));
    row.appendChild(createButton("Pokemon Center", pokeCenter, "btn btn-success btn-sm"));
    row.appendChild(createButton("📍 PokéStop", openPokeStop, "btn btn-success btn-sm"));
    row.appendChild(createButton("🛒 Shop", openShop, "btn btn-success btn-sm"));
    row.appendChild(createButton("🎒 Bag", openBag, "btn btn-success btn-sm"));
    row.appendChild(createButton("📖 Pokédex", openPokedex, "btn btn-success btn-sm"));
    row.appendChild(createButton("🐞 Debug", openDebugPanel, "btn btn-success btn-sm"));

    (async () => {
      const hasUpdate = await updater.needsUpdate();
      const settingsBtn = createButton("⚙️ Settings", openSettings, "btn btn-success btn-sm");
      if (hasUpdate) {
        const badge = document.createElement("span");
        badge.className = "badge rounded-pill bg-danger top-0 translate-middle position-relative";
        badge.textContent = "!";
        badge.style.marginLeft = "6px";
        settingsBtn.appendChild(badge);
      }
      row.appendChild(settingsBtn);
    })();

    root.appendChild(row);
    updatePokeStopTimer();
    updateNextBattleTimer();
  }


  function updateHeaderHP() {
    const hpLabel = document.querySelector("#pkm-hp-label");
    const hpBar = document.querySelector("#pkm-hp-bar");
    const stored = getStr(STORAGE.starter);
    if (!stored) return;
    const stats = getStats(stored);
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
      console.log(`🎮 Loading active Pokémon: ${entry.name} (#${starterId.slice(-6)})`);
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
    const status = document.querySelector("#pokeStopStatus");
    if (!status) return;

    const psCd = getInt(STORAGE.pokestopCooldown);
    let text = "";
    if (psCd > Date.now()) {
      const r = psCd - Date.now();
      text = `PokéStop: ${Math.floor(r / 60000)}m ${Math.floor((r % 60000) / 1000)}s`;
    } else {
      text = "PokéStop: Ready!";
    }
    status.textContent = text;
  }
  function updateNextBattleTimer() {
    const el = document.querySelector("#nextBattleStatus");
    if (!el) return;

    if (randomBattleEnabled && nextBattleTime) {
      const d = Math.max(0, nextBattleTime - Date.now());
      el.textContent = `Next Battle: ${Math.floor(d / 60000)}m ${Math.floor((d % 60000) / 1000)}s`;
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
    <img src="${p.spriteBlobUrl || p.spriteUrl}" class="detail-sprite" alt="${p.name}"/>
    <div class="detail-section">
      <div><strong>Level:</strong> ${p.level}</div>
      <div><strong>XP:</strong> ${p.xp} / ${p.level * 100}</div>
      <div><strong>HP:</strong> ${p.currentHP} / ${p.maxHp}</div>
    </div>
    <div class="detail-section">
      <div><strong>Types:</strong> ${p.types.join(", ")}</div>
      <div><strong>Abilities:</strong> ${p.abilities.join(", ")}</div>
    </div>
    <table class="detail-stats">
      <thead><tr><th>Stat</th><th>Base</th></tr></thead>
      <tbody>
        ${p.stats.map(s => `<tr><td>${s.name}</td><td>${s.value}</td></tr>`).join("")}
      </tbody>
    </table>
    <button class="btn btn-danger w-100 mt-3" id="closeDetail">Close</button>
  `;
    document.body.appendChild(detailPanel);

    const close = () => { detailPanel.remove(); detailPanel = null; };
    detailPanel.querySelector("#closeDetail").onclick = close;
    detailPanel.querySelector(".detail-close").onclick = close;
  }


  function toggleRandomBattles() {
    randomBattleEnabled = !randomBattleEnabled;
    setBool("pkm_random_battles", randomBattleEnabled);
    if (randomBattleEnabled) {
      scheduleRandomBattle();
      alert("Random battles enabled!");
    } else {
      clearTimeout(randomBattleTimer);
      alert("Random battles disabled!");
    }
    renderSettings(); // Refresh UI
  }
  function scheduleRandomBattle() {
    if (!randomBattleEnabled) return;
    const delay = (60 + Math.random() * 540) * 1000; // 1–10 min
    nextBattleTime = Date.now() + delay;

    randomBattleTimer = setTimeout(() => {
      if (randomBattleEnabled) openBattle();
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

    // 💾 Remember current active Pokémon instance
    GM_setValue("pkm_starter_id", id);
    setStr(STORAGE.starter, name);

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

    const missingCoreStats = ["hp", "atk", "def", "spAtk", "spDef", "speed"].some(
      (k) => currentStats[k] == null
    );

    // ✅ Fetch PokéAPI stats if missing
    if (missingCoreStats) {
      console.log(`📡 Fetching ${name} stats from PokéAPI (missing data)...`);

      await new Promise((resolve) => {
        GM.xmlHttpRequest({
          method: "GET",
          url: `https://pokeapi.co/api/v2/pokemon/${encodeURIComponent(fixedName)}`,
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

    // ✅ Render UI for current partner
    renderHeader();
    spawnWalkingSprite(partnerSpriteUrl);
  }

  function extractStatsFromPokeApi(d) {
    if (!d || !Array.isArray(d.stats)) return {};

    const get = (n) => {
      const v = d.stats.find(s => s?.stat?.name === n)?.base_stat;
      return Number.isFinite(v) ? Number(v) : undefined;
    };

    const partial = {};
    if (get("hp") !== undefined) partial.hp = get("hp");
    if (get("attack") !== undefined) partial.atk = get("attack");
    if (get("defense") !== undefined) partial.def = get("defense");
    if (get("special-attack") !== undefined) partial.spAtk = get("special-attack");
    if (get("special-defense") !== undefined) partial.spDef = get("special-defense");
    if (get("speed") !== undefined) partial.speed = get("speed");

    // optional extras
    if (d.types) partial.types = d.types.map(t => t.type.name);
    if (d.abilities) partial.abilities = d.abilities.map(a => a.ability.name);

    return partial; // may be empty if API had nothing
  }

  function mergeStatsPartial(name, partial) {
    const key = String(name || "").toLowerCase();
    const old = getStats(key) || { level: 1, xp: 0, hp: 100, atk: 15, currentHP: 100 };

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
      GM.xmlHttpRequest({
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
    spriteWrapperEl = wrapper;

    const stats = getStats(partnerName) || {};
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
    wrapper.appendChild(inner);
    document.body.appendChild(wrapper);

    // Walk animation
    let posX = 0;
    let dir = 1;
    const speed = 2;

    walkInterval = setInterval(() => {
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
        const res = await fetch(
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
    document.body.appendChild(starterPanel);

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

    fetch("https://pokeapi.co/api/v2/pokemon?limit=1010")
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
    Object.assign(settingsPanel.style, {
      position: "fixed",
      top: "50%",
      left: "50%",
      transform: "translate(-50%, -50%)",
      background: "#fff",
      color: "#000",
      padding: "12px",
      border: "2px solid black",
      zIndex: "10000",
      width: "300px",
    });
    settingsPanel.classList = "d-grid gap-1 bg-dark bg-opacity-50";
    document.body.appendChild(settingsPanel);

    renderSettings();
  }
  async function renderSettings() {
    if (!settingsPanel) return;
    settingsPanel.innerHTML = "<strong>Settings</strong><br><br>";

    // Sound On/Off Toggle
    const soundToggle = createButton(
      `Sound: ${getBool(STORAGE.soundOn) ? "On" : "Off"}`,
      () => {
        const current = getBool(STORAGE.soundOn);
        const newVal = !current;
        setBool(STORAGE.soundOn, newVal);

        if (!newVal) {
          Object.values(SOUNDS).forEach((audio) => {
            if (audio instanceof Audio) {
              audio.pause();
              audio.currentTime = 0;
            }
          });
        }

        renderSettings();
      },
      "btn btn-info"
    );

    // Volume Slider
    const volumeSlider = document.createElement("input");
    volumeSlider.type = "range";
    volumeSlider.min = 0;
    volumeSlider.max = 1;
    volumeSlider.step = 0.01;
    volumeSlider.value = getStr(STORAGE.volume, "0.4");
    volumeSlider.style.width = "100%";
    volumeSlider.oninput = () => {
      const vol = parseFloat(volumeSlider.value);
      setStr(STORAGE.volume, volumeSlider.value);
      Object.values(SOUNDS).forEach((a) => {
        if (a instanceof Audio) a.volume = vol;
      });
    };

    // Change Starter
    const starterBtn = createButton("🔄 Change Starter", openStarter, "btn btn-success");

    // Random Battle Toggle
    const randomBattleToggle = createButton(
      `Random Battles: ${randomBattleEnabled ? "On" : "Off"}`,
      toggleRandomBattles,
      "btn btn-success"
    );

    // Upgrade Pokédex
    const pokedexBtn = createButton("Upgrade Pokédex", upgradeOldPokedexEntries, "btn btn-warning mt-2");

    // Reset Game
    const resetBtn = createButton("🗑️ Reset Game", resetGameData, "btn btn-warning");
    resetBtn.style.color = "black";
    resetBtn.style.marginTop = "12px";

    // Container for update UI
    const updateContainer = document.createElement("div");
    updateContainer.style.marginTop = "12px";
    updateContainer.textContent = "Checking for updates…";

    // Close Button
    const closeBtn = createButton(
      "❌ Close",
      () => {
        document.body.removeChild(settingsPanel);
        settingsPanel = null;
      },
      "btn btn-success"
    );

    // Append the static controls first
    settingsPanel.append(
      soundToggle, document.createElement("br"),
      volumeSlider, document.createElement("br"), document.createElement("br"),
      starterBtn, document.createElement("br"), document.createElement("br"),
      randomBattleToggle, document.createElement("br"), document.createElement("br"),
      resetBtn, document.createElement("br"), document.createElement("br"),
      pokedexBtn, document.createElement("br"),
      updateContainer, // <- placeholder for async update button
      document.createElement("br"),
      closeBtn
    );

    // ✅ Now do the async check and update the placeholder
    try {
      const hasUpdate = await updater.needsUpdate();
      if (hasUpdate) {
        const remote = await updater.fetchRemoteVersion(cfg.DOWNLOAD_URL);
        const updateBtn = createButton(
          "⬆️ Update Available",
          () => window.open(updater.configs.DOWNLOAD_URL, "_blank"),
          "btn btn-danger w-100"
        );
        updateBtn.title = `Current: ${cfg.CURRENT_VERSION} → Remote: ${remote || "?"}`;
        updateContainer.replaceChildren(updateBtn);

      } else {
        updateContainer.textContent = `✅ Up to date (v${cfg.CURRENT_VERSION})`;
      }
    } catch (e) {
      updateContainer.textContent = "⚠️ Update check failed.";
      console.warn(e);
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
    if (starterPanel) document.body.removeChild(starterPanel);
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
  document.head.appendChild(style);

  // === Evolution & XP ===
  function gainXP(amount) {
    const stats = getStats(starterName);
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
      alert(
        `🎉 ${partnerName} leveled up to ${stats.level}! HP and ATK increased.`
      );
    }

    setStats(starterName, stats);
    if (leveledUp) evolvePartner();
    updateHeaderHP();
    renderHeader();
  }
  async function evolvePartner() {
    const starterId = GM_getValue("pkm_starter_id");
    const party = getObj(STORAGE.party) || {};
    const starter = party[starterId];

    if (!starter) {
      alert("⚠️ No active Pokémon selected!");
      return;
    }

    const starterName = starter.name;
    const stats = getStatsForInstance(starterId, starterName);

    try {
      // --- Fetch species data ---
      const speciesRes = await fetch(`https://pokeapi.co/api/v2/pokemon-species/${starterName.toLowerCase()}`);
      const species = await speciesRes.json();

      // --- Fetch evolution chain ---
      const evoRes = await fetch(species.evolution_chain.url);
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
        alert(`${starterName} cannot evolve further!`);
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
          evolvedStats.atk = Math.round(evolvedStats.atk * 1.2);
          evolvedStats.hp = Math.round(evolvedStats.hp * 1.25);
          evolvedStats.currentHP = evolvedStats.hp;

          // --- Update the party entry (keep same ID) ---
          party[starterId].name = nextName;
          setObj(STORAGE.party, party);

          // --- Save evolved stats ---
          setStatsForInstance(starterId, evolvedStats);

          // --- Update starter and HUD ---
          GM_setValue(STORAGE.starter, nextName);
          fetchPartner(starterId);
          renderHeader();

          alert(`✨ Your ${starterName} evolved into ${nextName[0].toUpperCase() + nextName.slice(1)}!`);
        } else {
          alert(`${starterName} needs to reach Lv ${requiredLevel} to evolve.`);
        }
      } else {
        alert(`${starterName} cannot evolve by level-up.`);
      }
    } catch (err) {
      console.error("❌ Evolution failed:", err);
      alert("Evolution failed — check console for details.");
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
    const stats = getStats(starterName);
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

    setStats(starterName, { ...stats, currentHP: pHP });
  }
  // === Battle System ===
  // --- Battle styles (inject once) ---
  (function injectBattleStyles() {
    if (document.getElementById("pk-battle-styles")) return;
    const css = `
  :root{
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
    document.head.appendChild(style);
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
    const fill = document.getElementById(`${idPrefix}-fill`);
    const text = document.getElementById(`${idPrefix}-text`);
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
      padding: "0px",
      zIndex: "10000",
      width: "310px",               // a bit wider for the grid
      maxWidth: "92vw"
    });
    document.body.appendChild(battlePanel);

    if (getBool(STORAGE.soundOn)) {
      try { SOUNDS.battleSound.play(); } catch { }
    }
    startBattle(); // this should call drawBattle() initially
  }
  function updateHeaderCoins() {
    const coins = getInt(STORAGE.coins, 0);
    const coinBtn = document.getElementById("pk-header-coins");
    if (coinBtn) {
      coinBtn.textContent = `💰 Coins: ${coins}`;
    }

  }
  function pokeCenter() {
    const coins = getInt(STORAGE.coins, 0);
    if (coins < POKE_CENTER_COST) {
      alert("❌ You don't have enough PokéCoins to heal your party.");
      return;
    }
    healPokemon();
    playSound("heal");
    setInt(STORAGE.coins, coins - POKE_CENTER_COST);
    updateHeaderCoins();
  }
  function healPokemon() {
    let party = getObj(STORAGE.party);
    if (!party || typeof party !== "object") return 0;

    let changed = 0;

    // Heal each party species
    for (const name of Object.keys(party)) {
      const key = name.toLowerCase();
      const s = getStats(key);
      if (!s || typeof s.hp !== "number") continue;

      const before = s.currentHP ?? 0;
      if (before < s.hp) {
        s.currentHP = s.hp;
        setStats(key, s);
        changed++;
      }
    }

    // Also heal starter if it's not already in the party map
    const starter = (getStr(STORAGE.starter, "") || "").toLowerCase();
    if (starter && !party[starter]) {
      const s = getStats(starter);
      if (s && typeof s.hp === "number" && (s.currentHP ?? 0) < s.hp) {
        s.currentHP = s.hp;
        setStats(starter, s);
        changed++;
      }
    }
    updateHeaderCoins();
    updateHeaderHP();
    if (changed > 0) {
      alert("✨ Your entire party has been healed!");
    }
  }

  function startBattle() {
    const id = Math.floor(Math.random() * 649) + 1;

    GM.xmlHttpRequest({
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

        const myStats = getStats(starterName);
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
    const partnerLevel = getStats(starterName).level;
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
    const youHP = buildHPBar("hp-you", pHP, getStats(starterName).hp);

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
              getStats(starterName).atk *
              0.6 *
              (getStats(starterName).atkBuff || 1)
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
              getStats(starterName).atk *
              0.7 *
              (getStats(starterName).atkBuff || 1)
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

    // keep HP bars in sync if anything changed mid-draw
    updateHPBar("hp-wild", wHP, wMaxHP);
    updateHPBar("hp-you", pHP, getStats(starterName).hp);
  }


  function animateHit() {
    const el = document.getElementById("wild-img");
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
    const st = getStats(starterName);
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

    const myLevel = getStats(starterName).level;
    const stats = getStats(starterName);
    const baseDmg = 5 + Math.random() * 10;
    const dmg = Math.floor(baseDmg + myLevel * 0.5);

    pHP = Math.max(0, pHP - dmg);
    stats.currentHP = pHP;
    setStats(starterName, stats);

    animatePartnerHit();
    playSound("hit");
    setTimeout(() => setHP(pHP), stats.hp);
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
    const myLevel = getStats(starterName).level;
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
    drawBattle(`You defeated ${wild.name}! +${reward} coins, +${wMaxHP} XP`);
    setTimeout(closeBattle, 1500);
  }
  function throwBall() {
    const useBall = prompt(
      "Which ball? (poke, great, ultra, master)",
      "poke"
    ).toLowerCase();

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

    const partnerLevel = getStats(starterName).level;
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
      GM.xmlHttpRequest({
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

    const stats = getStats(starterName);
    const newHP = Math.min(stats.hp, pHP + 30); // Don't exceed max HP
    setHP(newHP); // ✅ This triggers the animation too
    pHP = newHP; // ✅ Update your local HP value
    updateHeaderHP();
    drawBattle("You used a Potion.");
    renderHeader();

    setTimeout(wildAttack, 500);
  }
  function useXAttack() {
    if (getInt("pkm_xattack") <= 0) return drawBattle("No X-Attack!");
    setInt("pkm_xattack", getInt("pkm_xattack") - 1);
    const s = getStats(starterName);
    s.atkBuff = Math.max(s.atkBuff || 1, 1.5); // +50% atk for this battle
    setStats(starterName, s);
    drawBattle("Your attack rose!");
  }

  function useRevive() {
    if (getInt("pkm_revive") <= 0) return drawBattle("No Revive!");
    if (pHP > 0) return drawBattle("You are not fainted.");
    setInt("pkm_revive", getInt("pkm_revive") - 1);
    const s = getStats(starterName);
    pHP = Math.floor(s.hp * 0.5);
    s.currentHP = pHP;
    setStats(starterName, s);
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
    if (battlePanel) document.body.removeChild(battlePanel);
    battlePanel = null;
    // Reset temporary buffs
    const s = getStats(starterName);
    if (s.atkBuff) {
      delete s.atkBuff;
      setStats(starterName, s);
    }
    wildStatus = { poison: 0, burn: 0, sleep: 0 };
    playerStatus = { poison: 0, burn: 0, sleep: 0 };
    renderHeader();
  }

  // === Shop System ===
  let shopPanel;
  function openShop() {
    if (shopPanel) return;
    shopPanel = document.createElement("div");
    Object.assign(shopPanel.style, {
      position: "fixed",
      top: "50%",
      left: "50%",
      transform: "translate(-50%, -50%)",
      padding: "12px",
      border: "2px solid black",
      background: "#fff",
      color: "#000",
      zIndex: "10000",
    });
    document.body.appendChild(shopPanel);
    drawShop();
  }
  function drawShop(msg) {
    shopPanel.innerHTML = "";
    if (msg)
      shopPanel.appendChild(
        Object.assign(document.createElement("div"), { textContent: msg })
      );
    [
      { name: "Poké Ball", key: STORAGE.balls, price: 20 },
      { name: "Great Ball", key: "pkm_great_balls", price: 50 },
      { name: "Ultra Ball", key: "pkm_ultra_balls", price: 100 },
      { name: "Potion", key: STORAGE.potions, price: 10 },
      { name: "X-Attack (+50% atk for battle)", key: "pkm_xattack", price: 60 },
      { name: "Revive (revive to 50% HP)", key: "pkm_revive", price: 120 },
    ].forEach((item) => {
      const row = document.createElement("div");
      row.style.display = "flex";
      row.style.justifyContent = "space-between";
      row.style.margin = "6px 0";
      const lbl = document.createElement("span");
      lbl.textContent = `${item.name} x${getInt(item.key)}`;
      const btn = createButton(
        `Buy (${item.price})`,
        () => {
          if (getInt(STORAGE.coins) < item.price)
            return drawShop("Not enough coins.");
          setInt(STORAGE.coins, getInt(STORAGE.coins) - item.price);
          setInt(item.key, getInt(item.key) + 1);
          drawShop(`Bought 1 ${item.name}.`);
        },
        "btn btn-success"
      );
      row.append(lbl, btn);
      shopPanel.appendChild(row);
    });
    const closeBtn = createButton("❌ Close", closeShop, "btn btn-success");
    closeBtn.style.marginTop = "10px";
    shopPanel.appendChild(closeBtn);
  }
  function closeShop() {
    if (shopPanel) document.body.removeChild(shopPanel);
    shopPanel = null;
    renderHeader();
  }

  let bagPanel;
  const RARITY = {
    common: 10,
    uncommon: 30,
    rare: 100,
    legendary: 300,
  };
  function getRarity(name) {
    const legendaries = [
      "mewtwo",
      "lugia",
      "ho-oh",
      "rayquaza",
      "dialga",
      "palkia",
      "giratina",
      "zekrom",
      "reshiram",
      "xerneas",
      "yveltal",
      "zacian",
      "zamazenta",
      "eternatus",
    ];
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

    name = name.toLowerCase();
    if (legendaries.includes(name)) return "legendary";
    if (rares.includes(name)) return "rare";
    if (uncommons.includes(name)) return "uncommon";
    return "common";
  }
  function openBag() {
    if (bagPanel) return;
    bagPanel = document.createElement("div");
    Object.assign(bagPanel.style, {
      position: "fixed",
      top: "50%",
      left: "50%",
      transform: "translate(-50%, -50%)",
      color: "#000",
      padding: "12px",
      zIndex: "10000",
      height: "570px",
      width: "720px",
      overflowY: "auto",
    });

    document.body.appendChild(bagPanel);
    drawBag();
  }
  function openPokeStop() {
    const now = Date.now();
    const cooldownEnd = getInt(STORAGE.pokestopCooldown);

    if (now < cooldownEnd) {
      const remaining = cooldownEnd - now;
      const mins = Math.floor(remaining / 60000);
      const secs = Math.floor((remaining % 60000) / 1000);
      alert(`🕒 PokéStop will be ready in ${mins}m ${secs}s`);
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

    let msg = `🪙 +${coinAmount} Coins\n🎁 +${ballAmount} ${randBall.name}`;

    if (Math.random() < 0.025) {
      setInt(STORAGE.masterBalls, getInt(STORAGE.masterBalls) + 1);
      msg += `\n🎱 +1 Master Ball!`;
    }

    // Set new cooldown (1–5 mins)
    const cooldownMs = (1 + Math.floor(Math.random() * 5)) * 60 * 1000;
    setInt(STORAGE.pokestopCooldown, now + cooldownMs);

    alert(`📍 PokéStop Reward:\n\n${msg}`);
    renderHeader();
  }
  function drawBag(msg) {
    const party = getObj(STORAGE.party);
    const names = Object.keys(party);


    // Sort Controls
    const sortOptions = document.createElement("div");
    sortOptions.style.margin = "6px 0";
    sortOptions.innerHTML = "Sort by: ";
    let currentSort = "name";
    ["name", "rarity", "quantity"].forEach((crit) => {
      const btn = createButton(crit, () => {
        currentSort = crit;
        drawBagSorted(currentSort, msg);
      });

      btn.style.marginRight = "6px";
      sortOptions.appendChild(btn);
    });
    bagPanel.appendChild(sortOptions);

    drawBagSorted(currentSort, msg);
  }
  // --- ✅ Async version: Fetch Pokémon ID by name ---
  function getPokeIdByName(name) {
    return new Promise((resolve) => {
      console.log("Fetching Pokémon ID for:", name);
      GM.xmlHttpRequest({
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
        }
      });
    });
  }

  async function drawBagSorted(sortBy = "name", msg = "") {
    const pokedex = getArr(STORAGE.pokedex) || [];
    const statsAll = getObj(STORAGE.stats) || {};
    const bagWrap = bagPanel;
    bagWrap.innerHTML = `<strong>Party & Storage</strong><br>`;

    // Helper to always pull the newest list
    function getSortedList() {
      const d = getObj(STORAGE.party) || {};
      return Object.entries(d).sort((a, b) => a[1].name.localeCompare(b[1].name));
    }
    function getOrderedList() {
      const data = getObj(STORAGE.party) || {};
      return Object.entries(data); // no sorting!
    }

    const all = getOrderedList();
    const partyEntries = all.slice(0, 6);
    const storageEntries = all.slice(6);

    const container = document.createElement("div");
    container.className = "party-storage-panel";

    // --- Header ---
    container.innerHTML = `
    <div class="party-header">
      <div class="name">Party & Storage</div>
      <div class="box-nav">
        <button class="btn btn-success btn-sm">⟨</button>
        <span class="muted small">Box 1</span>
        <button class="btn btn-success btn-sm">⟩</button>
      </div>
    </div>`;

    // === Card builder ===
    function makeCard(id, mon) {
      const name = mon.name;
      const dex = pokedex.find(p => p.name.toLowerCase() === name.toLowerCase());
      const sprite = dex?.spriteUrl ||
        `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${name.toLowerCase()}.png`;
      const st = statsAll[id] || { level: 1 };
      const level = st.level || 1;
      const rarity = getRarity(name);
      const base = { common: 2, uncommon: 5, rare: 10, legendary: 20 };
      const value = (base[rarity] || 1) * (level + 1);

      const c = document.createElement("div");
      c.className = "mon-card";
      c.draggable = true;
      c.dataset.id = id;
      c.innerHTML = `
      <div class="mon-sprite"><img src="${sprite}" alt="${name}"></div>
      <div class="mon-meta"><div class="mon-name">${name}</div><div class="mon-sub">Lv ${level}</div></div>
      <div class="mon-buttons">
        <button class="btn btn-success btn-xs">Set Active</button>
        <button class="btn btn-danger btn-xs">Sell (${value}c)</button>
      </div>`;

      // drag
      c.addEventListener("dragstart", e => {
        e.dataTransfer.setData("text/plain", id);
        e.dataTransfer.effectAllowed = "move";
      });

      const [setBtn, sellBtn] = c.querySelectorAll("button");
      setBtn.onclick = () => {
        GM_setValue("pkm_starter_id", id);
        setStr(STORAGE.starter, name);
        changePokemon(id);
        renderHeader();
      };
      sellBtn.onclick = () => {
        const bag = getObj(STORAGE.party) || {};
        delete bag[id];
        setObj(STORAGE.party, bag);
        setInt(STORAGE.coins, getInt(STORAGE.coins) + value);
        const st = getObj(STORAGE.stats) || {};
        delete st[id];
        setObj(STORAGE.stats, st);
        drawBagSorted(sortBy, `${name} sold for ${value} coins.`);
      };
      return c;
    }

    // === Slot builder ===
    function makeSlot(entry, i, zone) {
      const slot = document.createElement("div");
      slot.className = "slot";
      slot.dataset.zone = zone;
      slot.dataset.index = i;
      slot.addEventListener("dragover", e => e.preventDefault());
      slot.addEventListener("drop", e => {
        e.preventDefault();
        const draggedId = e.dataTransfer.getData("text/plain");
        handleDrop(draggedId, zone, i);
      });

      if (entry) {
        const [id, mon] = entry;
        slot.appendChild(makeCard(id, mon));
      } else slot.classList.add("empty");

      return slot;
    }

    // === Drop handler ===
    function handleDrop(draggedId, zone, index) {
      const curList = getOrderedList();
      const dragged = curList.find(([id]) => id === draggedId);
      if (!dragged) return;
      const rest = curList.filter(([id]) => id !== draggedId);

      if (zone === "party") rest.splice(index, 0, dragged);
      else if (zone === "storage") rest.splice(6 + index, 0, dragged);

      const rebuilt = {};
      for (const [id, data] of rest) rebuilt[id] = data;
      setObj(STORAGE.party, rebuilt);

      // make first Pokémon active
      const first = Object.entries(rebuilt)[0];
      if (first) {
        const [fid, fdata] = first;
        GM_setValue("pkm_starter_id", fid);
        setStr(STORAGE.starter, fdata.name);
        changePokemon(fid);
      }

      // 💥 FULL refresh from storage
      setTimeout(() => {
        drawBagSorted(sortBy);
        renderHeader();
        
      }, 0);
    }

    // === Party grid ===
    const partyGrid = document.createElement("div");
    partyGrid.className = "party-grid";
    for (let i = 0; i < 6; i++) partyGrid.appendChild(makeSlot(partyEntries[i], i, "party"));
    container.appendChild(partyGrid);

    const tip = document.createElement("div");
    tip.className = "tiny muted";
    tip.textContent = "Drag between Party ↔ Storage to move Pokémon.";
    container.appendChild(tip);

    const sep = document.createElement("hr");
    sep.className = "sep";
    container.appendChild(sep);

    // === Storage grid ===
    const storageGrid = document.createElement("div");
    storageGrid.className = "storage-grid";
    for (let i = 0; i < 30; i++) storageGrid.appendChild(makeSlot(storageEntries[i], i, "storage"));
    container.appendChild(storageGrid);

    const closeBtn = createButton("❌ Close", closeBag);
    closeBtn.style.marginTop = "10px";
    container.appendChild(closeBtn);

    bagWrap.appendChild(container);

    // ensure starter
    const first = Object.entries(getObj(STORAGE.party) || {})[0];
    if (first) {
      const [fid, fdata] = first;
      GM_setValue("pkm_starter_id", fid);
      setStr(STORAGE.starter, fdata.name);
    }
  }

  // --- Unique IDs --------------------------------------------------------------
  function generateUniqueId(baseName) {
    const base = String(baseName || "").toLowerCase().replace(/[^a-z0-9-]/g, "");
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
      const found = party.find(p => p.name.toLowerCase() === starter.toLowerCase());
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
      Object.values(party).some(v => v && typeof v === "object" && v.name && v.caughtAt);
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
        const base = getStats(speciesName) || { level: 1, xp: 0, hp: 100, atk: 15 };
        newStats[id] = { ...base };
      }
    }

    // ✅ Ensure legacy starter (pignite) exists in new party
    const oldStarter = getStr(STORAGE.starter);
    if (oldStarter && !Object.values(newParty).some(p => p.name?.toLowerCase() === oldStarter.toLowerCase())) {
      const id = generateUniqueId(oldStarter);
      newParty[id] = { name: oldStarter, caughtAt: Date.now() };
      const base = getStats(oldStarter) || { level: 1, xp: 0, hp: 100, atk: 15 };
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
      console.log(`🌟 Auto-selected starter '${newParty[firstId].name}' (${firstId})`);
    }
  }

  function closeBag() {
    if (bagPanel) document.body.removeChild(bagPanel);
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
    const bundle = {};
    const storageKeys = new Set(
      Object.values(STORAGE).concat([
        "pkm_great_balls",
        "pkm_ultra_balls",
        "pkm_master_balls",
        "pkm_random_battles",
        LOG_KEY,
      ])
    );
    storageKeys.forEach((k) => {
      try {
        bundle[k] = GM_getValue(k);
      } catch { }
    });
    const blob = new Blob([JSON.stringify(bundle, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement("a"), {
      href: url,
      download: "pokemon_save.json",
    });
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function importSave(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const obj = JSON.parse(reader.result);
        Object.entries(obj).forEach(([k, v]) => GM_setValue(k, v));
        alert("Save imported. Reloading…");
        location.reload();
      } catch (e) {
        alert("Import failed: " + e.message);
      }
    };
    reader.readAsText(file);
  }

  function openDebugPanel() {
    const panel = document.createElement("div");
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
          `[${l.t}] ${l.type || "info"}: ${l.msg}${l.stack ? "\n" + l.stack : ""
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
        panel.remove();
        openDebugPanel();
      },
      "btn btn-warning btn-sm"
    );
    const closeBtn = createButton(
      "Close",
      () => panel.remove(),
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
    document.body.appendChild(panel);
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

  // Start Call css and JS Then Render Header //
  syncCSS(
    "https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css",
    "bootstrap@"
  );
  syncJS(
    "https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js",
    "bootstrap.bundle"
  );
  syncCSS(
    "https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.min.css",
    "bootstrap-icons"
  );
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

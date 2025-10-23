// ==UserScript==
// @name        Pokemon-Battle-Full-Edition-Beta
// @author      JellxWrld(@diedrchr), DStokesNCStudio9@esrobbie)
// @connect     pokeapi.co
// @connect     https://dstokesncstudio.com/pokeapi/pokeapi.php
// @namespace   dstokesncstudio.com
// @version     1.0.0.0
// @updateURL   
// @downloadURL 
// @description Full version with XP, evolution, stats, sound, shop, battles, and walking partner — persistent across sites.
// @include     *
// @grant       GM.xmlHttpRequest
// @grant       unsafeWindow
// @grant       GM_getValue
// @grant       GM_setValue
// @grant       GM_xmlhttpRequest
// @grant       GM_addStyle
// @sandbox     JavaScript
// @connect     github.com
// @connect     raw.githubusercontent.com
// @connect     play.pokemonshowdown.com
// ==/UserScript==
(function () {
    'use strict';
    // 🔥 --- Custom Pokemon Logger  ---
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
    class Config {
        constructor(      
        url = "https://raw.githubusercontent.com/D-Stokes-NC-Gaming-Studio/pokemon-tampermonkey/main/Pokemon-Battle-Full-Edition.user.js",
      currentVersion = (typeof GM_info !== "undefined" && GM_info?.script?.version)
        ? GM_info.script.version
        : "0.0.0") {
            this.debug = false;
            this.maxLevel = 100;
            
        }
    }
})();

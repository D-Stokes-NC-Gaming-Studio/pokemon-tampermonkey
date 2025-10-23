// ==UserScript==
// @name        Pokemon-Battle-Full-Edition-Beta
// @author      JellxWrld(@diedrchr), DStokesNCStudio9(@esrobbie)
// @namespace   dstokesncstudio.com
// @version     1.0.0.0
// @description Full version with XP, evolution, stats, sound, shop, battles, and walking partner — persistent across sites.
// @updateURL   https://raw.githubusercontent.com/D-Stokes-NC-Gaming-Studio/pokemon-tampermonkey/main/Pokemon-Battle-Full-Edition-Beta.user.js
// @downloadURL https://raw.githubusercontent.com/D-Stokes-NC-Gaming-Studio/pokemon-tampermonkey/main/Pokemon-Battle-Full-Edition-Beta.user.js
// @match       *://*/*
// @include     *
// @grant       GM.xmlHttpRequest
// @grant       GM_xmlhttpRequest
// @grant       GM_info
// @grant       GM_notification
// @grant       GM_getValue
// @grant       GM_setValue
// @grant       GM_addStyle
// @grant       unsafeWindow
// @connect     pokeapi.co
// @connect     github.com
// @connect     raw.githubusercontent.com
// @connect     play.pokemonshowdown.com
// @connect     https://dstokesncstudio.com/pokeapi/pokeapi.php
// ==/UserScript==

(function () {
    'use strict';

    (function attachPokemonLogger(global = window) {
        const LEVELS = ["debug", "log", "info", "warn", "error"];
        const DEFAULT_COLOR = "#ff4b2b";
        const now = () => {
            const d = new Date();
            return d.toLocaleTimeString(undefined, { hour12: false }) + "." + String(d.getMilliseconds()).padStart(3, "0");
        };
        function printer(scope, color = DEFAULT_COLOR, enabled = true, level = "debug") {
            function style(c) {
                return [
                    `%c${now()} %c${scope}%c`,
                    "opacity:.7",
                    `background:${c}; color:#fff; padding:2px 6px; border-radius:6px; font-weight:700`,
                    "color:inherit"
                ];
            }
            const api = {
                scope, color, enabled, level,
                setEnabled(v) { api.enabled = !!v; return api; },
                setLevel(v) { api.level = v; return api; },
                setColor(v) { api.color = v; return api; },
                child(s, c) { return printer(`${scope}.${s}`, c || color, api.enabled, api.level); },
                _buffer: [],
                get history() { return api._buffer.slice(); },
                clearHistory() { api._buffer.length = 0; },
                debug(...a) { return out("debug", a); },
                log(...a) { return out("log", a); },
                info(...a) { return out("info", a); },
                warn(...a) { return out("warn", a); },
                error(...a) { return out("error", a); },
                success(...a) { return out("log", a, "#2e7d32"); },
            };
            function out(lvl, args, force) {
                if (!api.enabled) return api;
                if (LEVELS.indexOf(lvl) < LEVELS.indexOf(api.level)) return api;
                api._buffer.push({ t: Date.now(), scope, lvl, args });
                try { (console[lvl] || console.log).apply(console, style(force || api.color).concat(args)); }
                catch { console.log(`[${scope}]`, ...args); }
                return api;
            }
            return api;
        }
        const pokemon = printer("pokemon");
        pokemon.configs = pokemon.child("configs", "#00bcd4");
        pokemon.net = pokemon.child("net", "#9c27b0");
        pokemon.ui = pokemon.child("ui", "#ff9800");
        Object.defineProperty(global, "pokemon", { value: pokemon, writable: false });
    })(typeof unsafeWindow !== "undefined" ? unsafeWindow : window);
    // Make the global logger available as a local const for this userscript scope
    const pokemon = (typeof unsafeWindow !== "undefined" ? unsafeWindow : window).pokemon;
    class Item {
        constructor(id, name, price, desc, kind, params = {}) {
            this.id = id;
            this.name = name;
            this.price = price;
            this.desc = desc;
            this.kind = kind;
            this.params = params;
            this.qty = params.qty ?? 1; // new: quantity stack
        }
    }
    class Config {
        constructor(
            url = "https://raw.githubusercontent.com/D-Stokes-NC-Gaming-Studio/pokemon-tampermonkey/main/Pokemon-Battle-Full-Edition-Beta.user.js",
            ver = (typeof GM_info !== "undefined" && GM_info?.script?.version) ? GM_info.script.version : "0.0.0"
        ) {
            this.DOWNLOAD_URL = url;
            this.CURRENT_VERSION = ver;
            this.debug = false;
            this.maxLevel = 100;
            this.CONCURRENCY = 6;
            this.SHINY_ODDS = 4096;
            this.POKE_CENTER_COST = 250;
            this.pkm_player_name = "";
            this.STARTERS = ["bulbasaur", "charmander", "squirtle"];
            this.STORAGE = {
                PLAYER_DATA: "pkm_player_data",
                POKEDEX: "pkm_pokedex",
                MOVE_CACHE: "pkm_move_cache",
                SPECIES_META: "pkm_species_meta",
                STARTER: "pkm_starter"

            };
            this.SOUNDS = {
                hit: new Audio("https://github.com/jellowrld/pokemon-tampermonkey/raw/refs/heads/main/hit.mp3"),
                ball: new Audio("https://github.com/jellowrld/pokemon-tampermonkey/raw/refs/heads/main/Throw.mp3"),
                catch: new Audio("https://github.com/jellowrld/pokemon-tampermonkey/raw/refs/heads/main/06-caught-a-pokemon.mp3"),
                faint: new Audio("https://github.com/jellowrld/pokemon-tampermonkey/raw/refs/heads/main/faint.mp3"),
                run: new Audio("https://github.com/jellowrld/pokemon-tampermonkey/raw/refs/heads/main/runaway.mp3"),
                start: new Audio("https://github.com/jellowrld/pokemon-tampermonkey/raw/refs/heads/main/wildbattle.mp3"),
                victory: new Audio("https://github.com/jellowrld/pokemon-tampermonkey/raw/refs/heads/main/victory.mp3"),
                lose: new Audio("https://github.com/jellowrld/pokemon-tampermonkey/raw/refs/heads/main/lose.mp3"),
                battleSound: new Audio("https://github.com/jellowrld/pokemon-tampermonkey/raw/refs/heads/main/wildbattle.mp3"),
            };
            this.SHOP_DB = [
                new Item(1, "Potion", 200, "Restores 20 HP.", "potion", { heal: 20 }),
                new Item(2, "Super Potion", 700, "Restores 50 HP.", "potion", { heal: 50 }),
                new Item(3, "Extra Box", 5000, "Adds one more PC Box.", "other", {}),
                new Item(10, "Poké Ball", 200, "Catches a Pokémon.", "ball", { rateMultiplier: 1.0 }),
                new Item(11, "Great Ball", 600, "Higher catch rate.", "ball", { rateMultiplier: 1.5 }),
                new Item(12, "Ultra Ball", 1200, "High performance ball.", "ball", { rateMultiplier: 2.0 }),
                new Item(99, "Master Ball", 0, "Catches without fail.", "ball", { masterBall: true }),
            ];

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
    const CONFIG = new Config();
    const updater = new CheckUpdate(CONFIG);
    updater.check(); // runs full check

    // =============== Helpers (storage & net) ===============
    function saveVal(key, value) { GM_setValue(key, JSON.stringify(value)); }
    function loadVal(key, fallback = null) {
        const raw = GM_getValue(key);
        if (!raw) return fallback;
        try { return JSON.parse(raw); } catch { return fallback; }
    }
    function fetchJSON(url) {
        return new Promise((resolve, reject) => {
            (GM_xmlhttpRequest || GM.xmlHttpRequest)({
                method: "GET",
                url,
                onload: r => { try { resolve(JSON.parse(r.responseText)); } catch (e) { reject(e); } },
                onerror: reject
            });
        });
    }
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const randInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

    // =============== Core Data Models ===============
    class PokemonMon {
        constructor({ id, name, stats, abilities, moves, sprites, evolutions,
            captureRate = 45, level = 1, xp = 0, isShiny = false }) {
            this.id = id;
            this.name = name;
            this.stats = stats;           // { hp, attack, defense, specialattack, specialdefense, speed }
            this.abilities = abilities;   // [string]
            this.moves = moves;           // [{name, pp, power, accuracy, type, damage_class}]
            this.sprites = sprites;       // { normal, shiny, official }
            this.evolutions = evolutions; // [next species names]
            this.captureRate = captureRate;
            this.level = level;
            this.xp = xp;
            this.isShiny = isShiny;
            this.currentHP = stats?.hp ?? 50;
            this.movePP = {};
            for (const m of moves) this.movePP[m.name] = m.pp ?? 10;
        }
        getSpriteURL() { return this.isShiny ? (this.sprites.shiny || this.sprites.normal) : this.sprites.normal; }
        canEvolve() { return Array.isArray(this.evolutions) && this.evolutions.length > 0; }
    }

    class StoragePC {
        constructor() { this.boxes = [new Array(30).fill(null)]; }
        addBox() { this.boxes.push(new Array(30).fill(null)); }
        addPokemon(pkm) {
            for (const box of this.boxes) {
                const idx = box.findIndex(s => s === null);
                if (idx !== -1) { box[idx] = pkm; return true; }
            }
            return false;
        }
    }

    class Party {
        constructor() { this.slots = new Array(6).fill(null); }
        addPokemon(pkm) {
            const idx = this.slots.findIndex(p => p === null);
            if (idx !== -1) { this.slots[idx] = pkm; return true; }
            return false;
        }
        firstAlive() { return this.slots.find(p => p && p.currentHP > 0) || null; }
    }

    class Player {
        constructor(name) {
            this.name = name;
            this.money = 5000;
            this.party = new Party();
            this.storage = new StoragePC();
            this.inventory = []; // ✅ empty
            this.caught = [];
        }
        markCaught(species) { if (!this.caught.includes(species)) this.caught.push(species); }

        addItemByName(name, count = 1) {
            const base = CONFIG.SHOP_DB.find(x => x.name === name);
            if (!base) return false;
            let existing = this.inventory.find(i => i.name === name);
            if (existing) {
                existing.qty = Math.min(999, existing.qty + count);
                return true;
            }
            const newItem = new Item(base.id, base.name, base.price, base.desc, base.kind, { ...base.params, qty: count });
            this.inventory.push(newItem);
            return true;
        }

        useItem(name) {
            const item = this.inventory.find(i => i.name === name);
            if (!item) return null;
            if (--item.qty <= 0) this.inventory = this.inventory.filter(i => i.qty > 0);
            return item;
        }

        getItemCount(name) {
            const item = this.inventory.find(i => i.name === name);
            return item ? item.qty : 0;
        }
    }

    class Shop {
        constructor() { this.items = CONFIG.SHOP_DB.slice(); }
        buy(player, itemName) {
            const item = this.items.find(i => i.name === itemName);
            if (!item) return pokemon.warn("[Shop] Item not found:", itemName);
            if (item.name === "Extra Box") {
                if (player.money < item.price) return pokemon.warn("[Shop] Not enough money.");
                player.money -= item.price;
                player.storage.addBox();
                pokemon.success("[Shop] Extra PC Box purchased. Boxes:", player.storage.boxes.length);
                persistPlayers();
                return;
            }
            if (player.money < item.price) return pokemon.warn("[Shop] Not enough money.");
            player.money -= item.price;
            player.addItemByName(item.name, 1);
            pokemon.success(`[Shop] Bought ${item.name}.`);
            persistPlayers();
        }
    }

    // =============== Move Cache (lazy, global) ===============
    const MoveCache = {
        _cache: loadVal(CONFIG.STORAGE.MOVE_CACHE, {}) || {},
        async get(name) {
            if (this._cache[name]) return this._cache[name];
            const d = await fetchJSON(`https://pokeapi.co/api/v2/move/${name}`);
            const entry = {
                name: d.name,
                pp: d.pp ?? 10,
                power: d.power ?? 0,
                accuracy: d.accuracy ?? 100,
                type: d.type?.name ?? "normal",
                damage_class: d.damage_class?.name ?? "status",
            };
            this._cache[name] = entry;
            saveVal(CONFIG.STORAGE.MOVE_CACHE, this._cache);
            return entry;
        },
        async many(names, limit = names.length) {
            const out = [];
            for (const n of names.slice(0, limit)) {
                try { out.push(await this.get(n)); } catch {/* skip */ }
            }
            return out;
        }
    };

    // =============== Full Pokédex Cache ===============
    class Pokedex {
        constructor() {
            this.all = loadVal(CONFIG.STORAGE.POKEDEX, {}) || {};      // { name: PokemonMonJSON }
            this.meta = loadVal(CONFIG.STORAGE.SPECIES_META, {}) || {}; // { name: { captureRate, evoChainNames[] } }
        }
        async ensureAll() {
            if (Object.keys(this.all).length > 0) {
                pokemon.success("✅ Pokedex loaded from cache:", Object.keys(this.all).length);
                return;
            }
            pokemon.info("🕓 First run: caching full Pokédex from PokeAPI (one-time).");
            const list = await fetchJSON("https://pokeapi.co/api/v2/pokemon?limit=100000");
            const urls = list.results.map(r => r.url);

            let active = 0, i = 0, done = 0;
            const results = new Map();
            const meta = {};

            const pump = async () => {
                while (active < CONFIG.CONCURRENCY && i < urls.length) {
                    const url = urls[i++]; active++;
                    (async () => {
                        try {
                            const pkm = await fetchJSON(url);

                            // stats
                            const stats = {};
                            for (const s of pkm.stats) stats[s.stat.name.replace("-", "")] = s.base_stat;

                            // abilities
                            const abilities = pkm.abilities.map(a => a.ability.name);

                            // sprites (front_default + shiny + official artwork)
                            const sprites = {
                                normal: pkm.sprites?.front_default || pkm.sprites?.other?.["official-artwork"]?.front_default || null,
                                shiny: pkm.sprites?.front_shiny || pkm.sprites?.other?.["official-artwork"]?.front_shiny || null,
                                official: pkm.sprites?.other?.["official-artwork"]?.front_default || null
                            };

                            // moves (limit initial per mon; details from move cache)
                            const moveNames = pkm.moves.map(m => m.move.name);
                            const moves = await MoveCache.many(moveNames, 12);

                            // species meta (capture rate + evo chain)
                            const species = await fetchJSON(pkm.species.url);
                            const captureRate = species.capture_rate ?? 45;
                            let evolutions = [];
                            if (species.evolution_chain?.url) {
                                const evo = await fetchJSON(species.evolution_chain.url);
                                const names = [];
                                (function walk(chain) {
                                    names.push(chain.species.name);
                                    (chain.evolves_to || []).forEach(walk);
                                })(evo.chain);
                                const idxSelf = names.indexOf(species.name);
                                evolutions = idxSelf >= 0 ? names.slice(idxSelf + 1) : [];
                                meta[species.name] = { captureRate, evoChainNames: names };
                            }

                            const mon = new PokemonMon({
                                id: pkm.id, name: pkm.name, stats, abilities, moves, sprites, evolutions, captureRate
                            });
                            results.set(mon.name, mon);

                            done++;
                            if (done % 50 === 0) {
                                pokemon.net.info(`📥 Cached ${done}/${urls.length}`);
                                saveVal(CONFIG.STORAGE.POKEDEX, { ...this.all, ...results });
                                saveVal(CONFIG.STORAGE.SPECIES_META, { ...this.meta, ...meta });
                            }
                        } catch (e) {
                            // swallow odd forms/404s
                        } finally { active--; pump(); }
                    })();
                }
            };
            await pump();
            while (active > 0) await sleep(100);

            this.all = Object.fromEntries([...results.entries()].sort((a, b) => a[1].id - b[1].id));
            this.meta = { ...this.meta, ...meta };
            saveVal(CONFIG.STORAGE.POKEDEX, this.all);
            saveVal(CONFIG.STORAGE.SPECIES_META, this.meta);
            pokemon.success("✅ Full Pokédex cached. Total species:", Object.keys(this.all).length);
        }
        get(name) { return this.all[name] || null; }
        list() { return Object.keys(this.all); }
    }

    // =============== Battle Engine ===============
    class Battle {
        constructor({ playerMon, wildMon, playerRef, onLog = (m) => pokemon.log(m) }) {
            this.player = playerMon;
            this.foe = wildMon;
            this.playerRef = playerRef; // Player (for bag)
            this.onLog = onLog;
            this.turn = 1;
            try { CONFIG.SOUNDS.start.play().catch(() => { }); } catch { }
        }
        _hit(acc = 100) { return Math.random() * 100 <= acc; }
        _damage(attacker, defender, move) {
            if (move.damage_class === "status" || (move.power ?? 0) === 0) return 0;
            const atk = move.damage_class === "physical" ? (attacker.stats.attack ?? 50) : (attacker.stats.specialattack ?? 50);
            const def = move.damage_class === "physical" ? (defender.stats.defense ?? 50) : (defender.stats.specialdefense ?? 50);
            const level = attacker.level ?? 50;
            const base = Math.floor((((2 * level / 5 + 2) * (move.power ?? 40) * (atk / Math.max(1, def))) / 50) + 2);
            const variance = randInt(85, 100) / 100;
            return Math.max(1, Math.floor(base * variance));
        }
        _usePP(user, moveName) {
            if ((user.movePP[moveName] ?? 0) > 0) { user.movePP[moveName] -= 1; return true; }
            return false;
        }
        async useMove(attacker, defender, moveName) {
            const mv = attacker.moves.find(m => m.name === moveName);
            if (!mv) { this.onLog(`${attacker.name} doesn't know ${moveName}!`); return; }
            if (!this._usePP(attacker, mv.name)) { this.onLog(`${attacker.name} has no PP left for ${mv.name}!`); return; }
            if (!this._hit(mv.accuracy ?? 100)) { this.onLog(`${attacker.name} used ${mv.name}... but missed!`); return; }
            const dmg = this._damage(attacker, defender, mv);
            defender.currentHP = Math.max(0, defender.currentHP - dmg);
            try { CONFIG.SOUNDS.hit.play().catch(() => { }); } catch { }
            this.onLog(`${attacker.name} used ${mv.name}! It dealt ${dmg} damage.`);
            if (defender.currentHP === 0) {
                try { CONFIG.SOUNDS.faint.play().catch(() => { }); } catch { }
                this.onLog(`${defender.name} fainted!`);
            }
        }
        async wildAttack() {
            const pool = this.foe.moves?.length ? this.foe.moves : [{ name: "tackle", power: 40, accuracy: 95, type: "normal", damage_class: "physical", pp: 35 }];
            const pick = pool[Math.floor(Math.random() * pool.length)];
            await this.useMove(this.foe, this.player, pick.name);
        }
        async useItem(itemName) {
            const it = this.playerRef.useItem(itemName);
            if (!it) { this.onLog(`No ${itemName} left!`); return; }
            if (it.kind === "potion") {
                const heal = it.params.heal ?? 20;
                const before = this.player.currentHP;
                this.player.currentHP = Math.min(this.player.stats.hp, this.player.currentHP + heal);
                this.onLog(`Used ${it.name}. ${this.player.name} healed ${this.player.currentHP - before} HP.`);
            } else {
                this.onLog(`${it.name} can't be used right now.`);
                // return it to bag if not consumed
                this.playerRef.inventory.push(it);
            }
        }
        async tryCatch(ballName = "Poké Ball") {
            const it = this.playerRef.useItem(ballName);
            if (!it) { this.onLog(`No ${ballName} left!`); return false; }
            try { CONFIG.SOUNDS.ball.play().catch(() => { }); } catch { }
            if (it.kind !== "ball") { this.onLog(`${ballName} is not a Poké Ball.`); this.playerRef.inventory.push(it); return false; }
            if (it.params.masterBall) { this.onLog("Gotcha! (Master Ball)"); try { CONFIG.SOUNDS.catch.play().catch(() => { }); } catch { } return true; }
            const maxHP = this.foe.stats.hp, curHP = Math.max(1, this.foe.currentHP);
            const cr = Math.max(1, this.foe.captureRate), ball = it.params.rateMultiplier ?? 1.0;
            const a = Math.floor(((3 * maxHP - 2 * curHP) * cr * ball) / (3 * maxHP));
            const success = a >= randInt(0, 255);
            if (success) { this.onLog(`Gotcha! ${this.foe.name} was caught!`); try { CONFIG.SOUNDS.catch.play().catch(() => { }); } catch { }; }
            else this.onLog(`${this.foe.name} broke free!`);
            return success;
        }
        async round(playerAction) {
            // playerAction: { type:"move"|"item"|"ball"|"run", moveName?, itemName?, ballName? }
            const ps = this.player.stats.speed ?? 50, es = this.foe.stats.speed ?? 50;
            const actPlayer = async () => {
                const t = playerAction?.type;
                if (t === "move") await this.useMove(this.player, this.foe, playerAction.moveName);
                else if (t === "item") await this.useItem(playerAction.itemName);
                else if (t === "ball") await this.tryCatch(playerAction.ballName || "Poké Ball");
                else if (t === "run") { this.onLog("Got away safely!"); try { CONFIG.SOUNDS.run.play().catch(() => { }); } catch { } }
            };
            if (ps >= es) {
                await actPlayer();
                if (this.foe.currentHP > 0 && this.player.currentHP > 0) await this.wildAttack();
            } else {
                await this.wildAttack();
                if (this.foe.currentHP > 0 && this.player.currentHP > 0) await actPlayer();
            }
            this.turn++;
        }
    }

    // =============== Players Save/Load ===============
    // =============== Players Save/Load ===============
    const PLAYERS = loadVal(CONFIG.STORAGE.PLAYER_DATA, { players: {}, caughtDex: {} });

    function getPlayer(name) {
        if (!PLAYERS.players[name]) {
            
            // Create a new player if not existing
            PLAYERS.players[name] = new Player(name);
            persistPlayers();
            pokemon.success(`🧍 Created new player profile: ${name}`);
        }
        return PLAYERS.players[name];
    }

    function persistPlayers() {
        saveVal(CONFIG.STORAGE.PLAYER_DATA, PLAYERS);
        pokemon.debug("💾 Player data saved");
    }
    // =============== Pokedex Singleton ===============
    const DEX = new Pokedex();

    // =============== Public API (global) ===============
    const API = {
        async initFullDex() { await DEX.ensureAll(); },
        listAll() { return DEX.list(); },
        getMon(name) {
            const raw = DEX.get(name);
            if (!raw) return null;
            return new PokemonMon(JSON.parse(JSON.stringify(raw))); // deep clone to avoid mutating cache
        },
        // Wild encounter: roll shiny, set level & HP
        wildEncounter(name, level = 5) {
            const mon = API.getMon(name);
            if (!mon) return null;
            mon.level = level;
            mon.currentHP = mon.stats.hp;
            mon.isShiny = (randInt(1, CONFIG.SHINY_ODDS) === 1);
            return mon;
        },
        getOrCreatePlayer: getPlayer,
        shopBuy(playerName, itemName) { new Shop().buy(getPlayer(playerName), itemName); },
        getPlayerCaught(name) { return (PLAYERS.players[name]?.caught ?? []).slice(); },
        markCaughtForPlayer(name, species) {
            const p = getPlayer(name);
            p.markCaught(species);
            if (!PLAYERS.caughtDex[name]) PLAYERS.caughtDex[name] = [];
            if (!PLAYERS.caughtDex[name].includes(species)) PLAYERS.caughtDex[name].push(species);
            persistPlayers();
        },
        startBattle({ playerName, yourMonName, wildName, yourLevel = 5, wildLevel = 5, onLog = (m) => pokemon.log(m) }) {
            const p = getPlayer(playerName);
            const your = API.getMon(yourMonName); if (!your) throw new Error("Your Pokémon not found (init dex first).");
            your.level = yourLevel; your.currentHP = your.stats.hp;
            const wild = API.wildEncounter(wildName, wildLevel); if (!wild) throw new Error("Wild Pokémon not found (init dex first).");
            const battle = new Battle({ playerMon: your, wildMon: wild, playerRef: p, onLog });
            return { battle, player: p };
        },
        finishCatch({ playerName, battle }) {
            const p = getPlayer(playerName);
            p.markCaught(battle.foe.name);
            // add to party, else to PC
            if (!p.party.addPokemon(JSON.parse(JSON.stringify(battle.foe)))) {
                if (!p.storage.addPokemon(JSON.parse(JSON.stringify(battle.foe)))) {
                    pokemon.warn("[Storage] Full! Buy Extra Box in Shop.");
                }
            }
            persistPlayers();
        }
    };

    // Expose API globally so you can use it on ANY site


    // ===== Optional: Auto-init full dex on first run (no UI) =====
    (async () => {

        pokemon.info("⚙️ Pokémon system booting…");
        await API.initFullDex(); // first run will progressively cache everything
        pokemon.success("✅ Pokémon system ready. Use `PokeGame` in DevTools.");
        // Example usage (run in console):
        // const { battle } = PokeGame.startBattle({ playerName:"Ash", yourMonName:"pikachu", wildName:"charmander", yourLevel:7, wildLevel:5 });
        // await battle.round({ type:"move", moveName:battle.player.moves[0].name });
        // await battle.round({ type:"ball", ballName:"Ultra Ball" });
        // PokeGame.finishCatch({ playerName:"Ash", battle });
    })();
    // =============== XP & Evolution System ===============
    class XPSystem {
        static xpToLevel(level) {
            // Simplified "medium fast" formula
            return Math.floor(Math.pow(level, 3));
        }

        static addXP(pokemon, xpGained) {
            const before = pokemon.level;
            pokemon.xp += xpGained;
            let nextLevel = pokemon.level;

            while (pokemon.xp >= XPSystem.xpToLevel(nextLevel + 1)) {
                nextLevel++;
                if (nextLevel > CONFIG.maxLevel) break;
            }

            if (nextLevel > before) {
                pokemon.level = nextLevel;
                pokemon.currentHP = pokemon.stats.hp;
                pokemon.xp = Math.min(pokemon.xp, XPSystem.xpToLevel(nextLevel));
                pokemonLog.success(`${pokemon.name} leveled up to ${pokemon.level}!`);

            }
        }

        static async tryEvolve(pokemon) {
            if (!pokemon.canEvolve()) return null;
            const next = pokemon.evolutions[0];
            if (!next) return null;
            const nextData = DEX.get(next);
            if (!nextData) return null;
            const evolved = new PokemonMon(JSON.parse(JSON.stringify(nextData)));
            evolved.level = pokemon.level;
            evolved.isShiny = pokemon.isShiny;
            evolved.xp = pokemon.xp;
            pokemonLog.success(`${pokemon.name} evolved into ${evolved.name}!`);
            return evolved;
        }
    }

    const pokemonLog = pokemon.child("xp", "#8bc34a");

    // =============== Save / Load Utilities ===============
    class SaveLoadManager {
        static saveAll() {
            saveVal(CONFIG.STORAGE.POKEDEX, DEX.all);
            saveVal(CONFIG.STORAGE.SPECIES_META, DEX.meta);
            saveVal(CONFIG.STORAGE.PLAYER_DATA, PLAYERS);
            pokemon.success("💾 All data saved to storage");
        }

        static loadAll() {
            DEX.all = loadVal(CONFIG.STORAGE.POKEDEX, DEX.all);
            DEX.meta = loadVal(CONFIG.STORAGE.SPECIES_META, DEX.meta);
            const tmp = loadVal(CONFIG.STORAGE.PLAYER_DATA, PLAYERS);
            if (tmp) Object.assign(PLAYERS, tmp);
            pokemon.success("📂 All data loaded from storage");
        }

        static clearAll() {
            for (const k of Object.values(CONFIG.STORAGE)) GM_setValue(k, "");
            pokemon.warn("🧹 All Pokémon data cleared. Next run will rebuild cache.");
        }
    }

    // =============== Mini UI Hooks (optional demo window) ===============
    (function setupMiniHUD() {
        const existing = document.getElementById("pokemon-mini-hud");
        if (existing) existing.remove();
        const hud = document.createElement("div");
        hud.id = "pokemon-mini-hud";
        hud.className = "bg-dark border-primary border border-3";
        hud.style.cssText = `
    position:fixed; bottom:10px; right:10px;
    color:#fff; padding:10px 14px;
    border-radius:10px; font-family:monospace; z-index:999999;
    font-size:12px; opacity:0.9; max-width:260px;
  `;
        hud.innerHTML = `
    <b>Pokémon Battle (Beta)</b><br>
    <button id="poke-refresh" class="btn btn-success btn-sm">Reload</button>
    <button id="poke-clear" class="btn btn-success btn-sm">Clear</button>
    <button id="poke-shop" class="btn btn-success btn-sm">Shop</button>
    <br><small>Use <code>PokeGame</code> in console</small>
  `;
        document.body.appendChild(hud);
        document.getElementById("poke-refresh").onclick = () => SaveLoadManager.loadAll();
        document.getElementById("poke-clear").onclick = () => SaveLoadManager.clearAll();
        document.getElementById("poke-shop").onclick = () => {
            const shop = new Shop();
            let text = shop.items.map(i => `${i.name} - $${i.price}`).join("\n");
            alert(`🛒 Shop:\n${text}`);
        };
    })();

    // =============== Add XP on victory (battle wrapper extension) ===============
    Battle.prototype.rewardXP = async function () {
        if (this.foe.currentHP <= 0) {
            const gain = randInt(20, 50) + this.foe.stats.hp;
            XPSystem.addXP(this.player, gain);
            const evo = await XPSystem.tryEvolve(this.player);
            if (evo) this.player = evo;
            pokemon.success(`🎉 ${this.player.name} gained ${gain} XP!`);
        }
    };
    (async function playerSetup() {
        // wait until the API is available
        async function waitForGameReady() {
            while (typeof (typeof unsafeWindow !== "undefined" ? unsafeWindow : window).PokeGame === "undefined") {
                await new Promise(r => setTimeout(r, 300));
            }
        }
        await waitForGameReady();

        const root = (typeof unsafeWindow !== "undefined" ? unsafeWindow : window);

        // if both values already exist, skip UI
        let playerName = GM_getValue("pkm_player_name", null);
        let starterChosen = GM_getValue("pkm_starter_chosen", null);
        getPlayer(playerName); // ensure player exists
        if (playerName && starterChosen) {
            pokemon.log(`Welcome back, ${playerName}! Starter: ${starterChosen}`);
            return;
        }

        // remove any existing setup UI (prevents doubles without a global flag)
        const existing = document.getElementById("poke-setup");
        if (existing) existing.remove();

        // add styles once
        GM_addStyle(`
        #poke-setup {
            position: fixed; inset: 0;
            background: rgba(0,0,0,0.75);
            display: flex; align-items: center; justify-content: center;
            z-index: 999999;
        }
        .poke-setup-box {
            background: #ffffff;
            color: #000;
            width: 340px; max-width: 90vw;
            padding: 18px 20px;
            border-radius: 12px;
            text-align: center;
            box-shadow: 0 10px 30px rgba(0,0,0,0.45);
            font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
        }
        .poke-setup-box h2 { margin: 0 0 10px; }
        .poke-setup-box .desc { font-size: 12px; opacity: .8; margin-bottom: 12px; }
        .poke-setup-box input[type="text"] {
            width: 100%;
            padding: 8px 10px;
            border: 1px solid #bbb; border-radius: 8px;
            margin-bottom: 10px;
        }
        .starter-row { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; margin-top: 6px; }
        .starter-btn { border-radius: 8px; }
        .action-row { margin-top: 8px; }
        .action-row button { margin: 4px 6px; border-radius: 8px; }
    `);

        // helper: cased label
        const labelize = (s) => s.charAt(0).toUpperCase() + s.slice(1);

        // build UI
        const wrap = document.createElement("div");
        wrap.id = "poke-setup";
        const box = document.createElement("div");
        box.className = "poke-setup-box";
        box.innerHTML = `
        <h2>🎮 Pokémon Battle Setup</h2>
        <div class="desc">Pick your trainer name and starter to begin.</div>
        <div id="step-name">
            <input type="text" id="trainerNameInput" placeholder="Enter your name" />
            <div class="action-row" id="nameActions"></div>
        </div>
        <div id="step-starter" style="display:none;">
            <div>Choose your Starter Pokémon:</div>
            <div class="starter-row" id="starterButtons"></div>
            <div class="action-row">
                <small class="desc">Starters: ${CONFIG.STARTERS.map(labelize).join(", ")}</small>
            </div>
        </div>
    `;
        wrap.appendChild(box);
        document.body.appendChild(wrap);

        const nameInput = box.querySelector("#trainerNameInput");
        const nameActions = box.querySelector("#nameActions");
        const stepStarter = box.querySelector("#step-starter");
        const starterButtons = box.querySelector("#starterButtons");

        // prefill name if it exists
        if (playerName) {
            nameInput.value = playerName;
        }

        // “Continue” button using your helper
        const continueBtn = createButton("Continue", () => {
            const val = (nameInput.value || "").trim();
            playerName = val || "Trainer";
            GM_setValue("pkm_player_name", playerName);
            nameInput.disabled = true;
            // go to starter step
            showStarterStep();
        }, "starter-btn");
        nameActions.appendChild(continueBtn);

        // allow Enter key to continue
        nameInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter") continueBtn.click();
        });

        function showStarterStep() {
            stepStarter.style.display = "";
            starterButtons.innerHTML = "";
            for (const s of CONFIG.STARTERS) {
                const btn = createButton(labelize(s), () => chooseStarter(s), "starter-btn");
                starterButtons.appendChild(btn);
            }
        }

        function chooseStarter(starter) {
            GM_setValue("pkm_starter_chosen", starter.toLowerCase());
            const player = root.PokeGame.getOrCreatePlayer(playerName);
            const mon = root.PokeGame.getMon(starter.toLowerCase());
            if (mon) {
                mon.level = 5;
                player.party.addPokemon(mon);
                pokemon.success(`🎉 ${playerName} chose ${labelize(starter)}!`);
                // persist to avoid any re-show later
                getPlayer(playerName); // ensure player exists
                if (typeof persistPlayers === "function") persistPlayers();
            }
            // close UI
            wrap.remove();

            GM_notification({
                title: "Pokémon Battle Ready!",
                text: `Welcome ${playerName}! You chose ${labelize(starter)}.`,
            });
        }

        // if name was already saved but no starter yet, jump straight to starter
        if (playerName && !starterChosen) {
            nameInput.value = playerName;
            nameInput.disabled = true;
            showStarterStep();
        }
    })();



    GM_notification({
        text: "Thanks for using Pokémon Battle (Beta)! On first run, the Pokédex will be cached locally. This may take several minutes. Check console for progress.",
        title: "Pokemon Battle (Beta)",
        url: 'https://dstokesncstudio.com',
    });
    // =============== Export Utility + Event Hook ===============
    (function installGlobalCommands() {
        const root = typeof unsafeWindow !== "undefined" ? unsafeWindow : window;

        // Attach inside Tampermonkey sandbox (for your own code)
        root.PokeGame = API;
        root.PokeSave = SaveLoadManager;
        root.PokeXP = XPSystem;
        root.PokeShop = Shop;

        // ✅ Create a safe "public" bridge in the real page context
        try {
            const bridge = {
                listAll: (...a) => root.PokeGame.listAll(...a),
                getMon: (...a) => root.PokeGame.getMon(...a),
                wildEncounter: (...a) => root.PokeGame.wildEncounter(...a),
                startBattle: (...a) => root.PokeGame.startBattle(...a),
                finishCatch: (...a) => root.PokeGame.finishCatch(...a),
                getPlayer: (...a) => root.PokeGame.getOrCreatePlayer(...a),
                shopBuy: (...a) => root.PokeGame.shopBuy(...a),
                version: root.CONFIG?.CURRENT_VERSION ?? "unknown"
            };

            // Expose bridge in real page context (accessible from console/UI)
            window.wrappedJSObject
                ? (window.wrappedJSObject.PokeGame = bridge)
                : (window.PokeGame = bridge);

            window.dispatchEvent(new CustomEvent("PokeGameReady", { detail: true }));
            pokemon.success("🌍 PokeGame bridge attached to real page window");
        } catch (err) {
            pokemon.error("Failed to expose PokeGame bridge:", err);
        }

        pokemon.info("💡 Global helpers available: PokeGame, PokeSave, PokeXP, PokeShop");
    })();

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
    // =============== Auto-Backup Every 10 Minutes ===============
    setInterval(() => SaveLoadManager.saveAll(), 600000);
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


})();


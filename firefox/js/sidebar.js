// js/sidebar.js
const $ = (s, r = document) => r.querySelector(s);
/* =========================
   CONFIG
   ========================= */
const API_BASE = "https://dstokesncstudio.com/pokeapi/pokeapi.php";
const GET_POKEMON = (name) => `${API_BASE}?action=getPokemon&name=${encodeURIComponent(String(name).toLowerCase())}`;
const dev = false;
const MAX_DEX = 1025;
let party = [];           // player's current party (max 6)
// ===== Party/Storage keys =====
const PARTY_KEY = "party";
const BOXES_KEY = "pcBoxes";
let __drag = null; // { from: "party"|"box", index: number } while dragging
// keys for extra inventory
const STORE = {
    coins: "coins",
    greatBalls: "greatBalls",
    ultraBalls: "ultraBalls",
    masterBalls: "masterBalls",
    cooldown: "pokestopCooldown",
};
/* =========================
   BALLS: CONFIG + HELPERS
   ========================= */
const BALLS = {
    poke: { label: "Poké Ball", key: "balls", store: "playerStats", mult: 1.0, icon: "⭕" },
    great: { label: "Great Ball", key: STORE.greatBalls, store: "local", mult: 1.5, icon: "🔵" },
    ultra: { label: "Ultra Ball", key: STORE.ultraBalls, store: "local", mult: 2.0, icon: "🟡" },
    master: { label: "Master Ball", key: STORE.masterBalls, store: "local", mult: 255, icon: "🟣" }, // treat as guarantee
};
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

let selectedBall = "poke"; // default
async function getBallCount(type) {
    const b = BALLS[type];
    if (!b) return 0;
    if (b.store === "playerStats") {
        const { playerStats } = await browser.storage.local.get("playerStats");
        return playerStats?.[b.key] | 0;
    } else {
        return await getNum(b.key, 0);
    }
}
async function setBallCount(type, newVal) {
    const b = BALLS[type];
    if (!b) return;
    if (b.store === "playerStats") {
        const pack = (await browser.storage.local.get("playerStats"))?.playerStats || {};
        pack[b.key] = Math.max(0, Number(newVal) || 0);
        await browser.storage.local.set({ playerStats: pack });
    } else {
        await setNum(b.key, Math.max(0, Number(newVal) || 0));
    }
}
async function decBall(type) {
    await setBallCount(type, (await getBallCount(type)) - 1);
}
/*
*  *    Build a ball button with a corner badge
*       Important
*/
function makeBallButton(type, label, icon) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn-success btn-sm item-btn";
    btn.style.padding = "4px 8px";

    // Main label
    const span = document.createElement("span");
    span.textContent = `${icon} ${label}`;
    btn.appendChild(span);

    // Badge
    const badge = document.createElement("span");
    badge.className = "count-badge";
    badge.dataset.ball = type;             // used by updater
    badge.textContent = "0";
    btn.appendChild(badge);

    return btn;
}
/*
*  *    Refresh counts + disabled state + active highlight on all ball badges
*       
        FUNCTIONS FOR BALLS
*/
async function updateBallBadges(container) {
    const root = container || document;
    const pick = selectedBall;
    const order = ["poke", "great", "ultra", "master"];

    for (const t of order) {
        const cnt = await getBallCount(t);
        // find the badge/button for this type under the given container
        const badge = root.querySelector(`.count-badge[data-ball="${t}"]`);
        const btn = badge?.closest(".item-btn");

        if (!badge || !btn) continue;

        badge.textContent = String(cnt);
        btn.classList.toggle("item-empty", cnt <= 0);
        btn.disabled = cnt <= 0;
        // active outline
        if (t === pick) btn.classList.add("active"); else btn.classList.remove("active");
    }
}
async function updateBallSelect() {
    const select = $("#ballSelect");
    if (!select) return;

    const order = ["poke", "great", "ultra", "master"];
    for (const t of order) {
        const conf = BALLS[t];
        const cnt = await getBallCount(t);
        const opt = select.querySelector(`option[value="${t}"]`);
        if (opt) {
            opt.textContent = `${conf.icon} ${conf.label} (${cnt})`;
            opt.disabled = cnt <= 0;
            if (t === selectedBall) opt.selected = true;
        }
    }
}
/*
=========================
    COINS
=========================
*/
async function initCoinDisplay() {
    const el = document.getElementById("userCoins");
    if (!el) return;

    // helper: refresh coins from storage
    async function refreshCoins() {
        const coins = await getNum(STORE.coins, 0);
        el.textContent = coins.toLocaleString(); // add commas for readability
    }

    // 1) initial render
    await refreshCoins();

    // 2) update whenever storage changes
    browser.storage.onChanged.addListener((changes, area) => {
        if (area === "local" && changes[STORE.coins]) {
            const newVal = changes[STORE.coins].newValue ?? 0;
            el.textContent = newVal.toLocaleString();
        }
    });

    // 3) optional: periodic refresh in case other logic bypasses onChanged
    setInterval(refreshCoins, 5000);
}
/* =========================
*   
*   HELPERS
    HELPERS for NET
   ========================= */
async function fetchJSONViaBG(url, opts) {
    const res = await browser.runtime.sendMessage({ type: "FETCH_JSON", url, opts });
    if (!res?.ok) throw new Error(res?.error || `HTTP ${res?.status || "?"}`);
    return res.json ?? JSON.parse(res.text);
}
/* =========================
*   *   LOADING New Game
        STARTERS for new users
   ========================= */
async function loadStarters() {
    const url = browser.runtime.getURL("starters.json");
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error("Failed to load starters.json");
    const data = await res.json();
    if (!Array.isArray(data)) throw new Error("starters.json must be an array");
    return data;
}
function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}
/* =========================
   TYPE CHIP
   ========================= */
function chipForType(nm) {
    const name = String(nm || "").toLowerCase();
    const cap = name ? name[0].toUpperCase() + name.slice(1) : "—";
    const span = document.createElement("span");
    span.className = `type-chip type-${name}`;
    span.textContent = cap;
    return span;
}
/* =========================
   VIEW SWITCHING
   ========================= */
function showPicker() {
    $("#viewPicker")?.classList.remove("hidden");
    $("#resultCard")?.classList.toggle("hidden", !window.__hasResult);
    $("#viewDex")?.classList.add("hidden");
    $("#viewBattle")?.classList.add("hidden");
    $("#viewParty")?.classList.add("hidden");
    $("#viewSettings")?.classList.add("hidden");
    if (wild) endBattle();
}
function showDex() {
    $("#viewPicker")?.classList.add("hidden");
    $("#resultCard")?.classList.add("hidden");
    $("#viewDex")?.classList.remove("hidden");
    $("#viewSettings")?.classList.add("hidden");
    $("#viewParty")?.classList.add("hidden");
    $("#viewBattle")?.classList.add("hidden");
}
function showBattle() {
    $("#viewPicker")?.classList.add("hidden");
    $("#resultCard")?.classList.add("hidden");
    $("#viewDex")?.classList.add("hidden");
    $("#viewBattle")?.classList.remove("hidden");
    $("#viewParty")?.classList.add("hidden");
    $("#viewSettings")?.classList.add("hidden");
    if (!wild) endBattle(); else renderBattle();
}
/* =========================
   POKEDEX STORAGE
   
   ========================= 
*/
async function getCaught() {
    const { caught } = await browser.storage.local.get("caught");
    return Array.isArray(caught) ? caught : [];
}
async function setCaught(list) {
    await browser.storage.local.set({ caught: list });
}
function makeCaughtEntry(p, playerLevel = 5) {
    // Decide a starting level: wild level OR close to player's first mon
    const lvl = p.level ?? Math.max(1, playerLevel + (Math.floor(Math.random() * 3) - 1)); // ±1

    // Build base stats
    const base = p.base
        ? p.base
        : mapBaseStatsFromPokeAPI(p);

    // Calculate stats if missing
    const stats = p.stats && typeof p.stats.hp === "number"
        ? p.stats
        : calcStats(base, lvl);

    return {
        uid: crypto?.randomUUID?.() || ("m" + Date.now() + Math.random().toString(16).slice(2)),
        pokeDex_num: p.pokeDex_num ?? p.dex ?? null,
        name: p.name,
        image: p.base_image || p.shiny_image || p.sprite || "",
        types: p.types || [],
        base_experience: p.base_experience ?? null,
        capturedAt: Date.now(),
        shiny: !!p.isShiny,
        level: lvl,
        currentHP: p.currentHP ?? stats.hp,
        exp: 0,
        expToNext: expToNext(lvl),
        base,
        stats
    };
}

/* =========================
   PICKER + RESULT RENDER
   ========================= */
function svgBall() {
    return `
    <svg viewBox="0 0 100 100" width="64" height="64" aria-hidden="true">
      <defs><clipPath id="half"><rect x="0" y="0" width="100" height="50"/></clipPath></defs>
      <circle cx="50" cy="50" r="45" fill="#fff" stroke="#111" stroke-width="6"/>
      <g clip-path="url(#half)"><circle cx="50" cy="50" r="45" fill="#e74c3c"/></g>
      <rect x="5" y="47" width="90" height="6" fill="#111"/>
      <circle cx="50" cy="50" r="14" fill="#fff" stroke="#111" stroke-width="6"/>
    </svg>`;
}
function renderThreeBalls(pool) {
    const wrap = $("#balls");
    if (!wrap) return;
    wrap.innerHTML = "";
    pool.forEach((poke, idx) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "ball";
        b.dataset.index = String(idx);
        b.title = "Pick this Poké Ball";
        b.innerHTML = svgBall();
        wrap.appendChild(b);
    });
    $("#status").textContent = "Choose a Poké Ball:";
    wrap.classList.remove("hidden");
}
function showResult(p) {
    window.__hasResult = true;
    $("#resultCard")?.classList.remove("hidden");

    const spriteBox = $("#resultSprite");
    if (spriteBox) {
        spriteBox.innerHTML = "";
        const img = new Image();
        img.src = p.base_image || p.shiny_image || "";
        img.alt = p.name || "pokemon";
        img.style.width = "84px";
        img.style.height = "auto";
        img.style.imageRendering = "pixelated";
        spriteBox.appendChild(img);
    }

    const proper = (p.name || "unknown").replace(/\b\w/g, m => m.toUpperCase());
    $("#resultName").textContent = proper;
    $("#resultMeta").textContent = `Dex #${p.pokeDex_num} • Base EXP ${p.base_experience ?? "—"}`;

    const typesRow = $("#resultTypes");
    if (typesRow) {
        typesRow.innerHTML = "";
        (p.types || []).forEach(t => {
            const nm = t?.type?.name || String(t).toLowerCase();
            typesRow.appendChild(chipForType(nm));
        });
    }

    const statsBox = $("#resultStats");
    if (statsBox) {
        statsBox.innerHTML = "";
        if (Array.isArray(p.stats)) {
            const ul = document.createElement("ul");
            p.stats.forEach(s => {
                const li = document.createElement("li");
                li.textContent = `${s.name}: ${s.value}`;
                ul.appendChild(li);
            });
            statsBox.appendChild(ul);
        }
    }
}
/* =========================
   POKEDEX RENDER
   ========================= */
function renderDexList(list) {
    const grid = $("#dexGrid");
    const empty = $("#dexEmpty");
    if (!grid || !empty) return;

    grid.innerHTML = "";
    if (!list.length) { empty.classList.remove("hidden"); return; }
    empty.classList.add("hidden");

    list
        .sort((a, b) => (a.pokeDex_num ?? 9999) - (b.pokeDex_num ?? 9999))
        .forEach(p => {
            const card = document.createElement("div");
            card.className = "dex-card";

            const img = new Image();
            img.src = p.image || "";
            img.alt = p.name || "pokemon";

            const meta = document.createElement("div");
            meta.className = "dex-meta";

            const name = document.createElement("div");
            name.className = "dex-name";
            name.textContent = (p.name || "").replace(/\b\w/g, m => m.toUpperCase());

            const id = document.createElement("div");
            id.className = "dex-id";
            id.textContent = p.pokeDex_num ? `#${p.pokeDex_num}` : "#—";

            const types = document.createElement("div");
            types.className = "dex-types";
            (p.types || []).forEach(t => {
                const nm = t?.type?.name || String(t).toLowerCase();
                types.appendChild(chipForType(nm));
            });

            meta.append(name, id, types);
            card.append(img, meta);
            grid.appendChild(card);
        });
}
function mapCaughtByDex(caught) {
    const m = new Map();
    for (const c of (caught || [])) {
        const key = Number(c.pokeDex_num || 0);
        if (key > 0) m.set(key, c);
    }
    return m;
}
/*=========================
    Capitalize helper
=========================
*/
function properName(n) {
    return String(n || "").replace(/\b\w/g, m => m.toUpperCase());
}

/*========================= 
    POKEDEX POKEDEX HELPERS
========================= 
*   
*/
function makeDexRow(id, caught) {
    const row = document.createElement("div");
    row.className = "dex-row" + (caught ? "" : " unknown");

    // --- Column 1: number
    const num = document.createElement("div");
    num.className = "dex-num";
    num.textContent = `#${id}`;
    row.appendChild(num);

    // --- Column 2: sprite
    const spr = document.createElement("div");
    spr.className = "dex-sprite";
    if (caught?.image) {
        const img = new Image();
        img.src = caught.image;
        img.alt = caught.name || `#${id}`;
        spr.appendChild(img);
    } else {
        const q = document.createElement("i");
        q.className = "bi bi-question-circle dex-q";
        spr.appendChild(q);
    }
    row.appendChild(spr);

    // --- Column 3: name + types
    const info = document.createElement("div");
    info.className = "dex-info";

    const nm = document.createElement("div");
    nm.className = "dex-name";
    nm.textContent = caught ? properName(caught.name) : "???????";
    info.appendChild(nm);

    const types = document.createElement("div");
    types.className = "dex-types";
    if (caught && Array.isArray(caught.types)) {
        caught.types.forEach(t => {
            const nm = t?.type?.name || String(t).toLowerCase();
            types.appendChild(chipForType(nm));
        });
    }
    info.appendChild(types);

    row.appendChild(info);
    return row;
}
/*========================= 
    POKEDEX RENDER
*   full Render Pokédex
========================= 
*/
async function renderDexFull(caughtList) {
    const listEl = document.querySelector("#dexList");     // inside .dex-scroll
    const empty = document.querySelector("#dexEmpty");
    if (!listEl) return;

    // Map caught by dex #
    const byDex = new Map(
        caughtList
            .filter(p => Number.isFinite(Number(p.pokeDex_num)))
            .map(p => [Number(p.pokeDex_num), p])
    );

    // Build rows 1..MAX_DEX
    const frag = document.createDocumentFragment();
    for (let dex = 1; dex <= MAX_DEX; dex++) {
        const caught = byDex.get(dex);
        const row = document.createElement("div");
        row.className = "dex-row" + (caught ? "" : " unknown");

        // left: number
        const num = document.createElement("div");
        num.className = "dex-num";
        num.textContent = `#${dex}`;
        row.appendChild(num);

        // middle: sprite
        const sprite = document.createElement("div");
        sprite.className = "dex-sprite";
        if (caught?.image) {
            const img = new Image();
            img.src = caught.image;
            img.alt = caught.name || `#${dex}`;
            sprite.appendChild(img);
        } else {
            const q = document.createElement("i");
            q.className = "bi bi-question-circle dex-q";
            sprite.appendChild(q);
        }
        row.appendChild(sprite);

        // right: name + types
        const info = document.createElement("div");
        info.className = "dex-info";
        const name = document.createElement("div");
        name.className = "dex-name";
        name.textContent = caught ? (caught.name || `#${dex}`) : "???????";
        info.appendChild(name);

        const types = document.createElement("div");
        types.className = "dex-types";
        if (caught?.types?.length) {
            caught.types.forEach(t => {
                const nm = t?.type?.name || String(t).toLowerCase();
                const chip = document.createElement("span");
                chip.className = `type-chip type-${nm}`;
                chip.textContent = nm[0].toUpperCase() + nm.slice(1);
                types.appendChild(chip);
            });
        }
        info.appendChild(types);
        row.appendChild(info);

        frag.appendChild(row);
    }

    listEl.innerHTML = "";
    listEl.appendChild(frag);

    if (empty) empty.classList.add("hidden");
}
function wireDexSearch(maxDex = 1025) {
    const search = $("#dexSearch");
    if (!search) return;
    search.oninput = () => {
        const q = search.value.trim().toLowerCase();
        const rows = Array.from(document.querySelectorAll(".dex-row"));
        if (!q) {
            rows.forEach(r => r.style.display = "");
            return;
        }
        rows.forEach(r => {
            const num = (r.querySelector(".dex-num")?.textContent || "").toLowerCase();
            const name = (r.querySelector(".dex-name")?.textContent || "").toLowerCase();
            r.style.display = (num.includes(q) || name.includes(q)) ? "" : "none";
        });
    };
}
async function openDex() {
    document.querySelector("#viewPicker")?.classList.add("hidden");
    document.querySelector("#resultCard")?.classList.add("hidden");
    document.querySelector("#viewBattle")?.classList.add("hidden");
    document.querySelector("#viewParty")?.classList.add("hidden");
    document.querySelector("#viewDex")?.classList.remove("hidden");
    document.querySelector("#viewSettings")?.classList.add("hidden");

    const allCaught = await getCaught();
    renderDexFull(allCaught);

    // search by name or number
    const search = document.querySelector("#dexSearch");
    if (search) {
        search.oninput = async () => {
            const term = (search.value || "").trim().toLowerCase();
            const rows = document.querySelectorAll("#dexList .dex-row");
            rows.forEach(row => {
                const num = row.querySelector(".dex-num")?.textContent?.replace("#", "") || "";
                const name = row.querySelector(".dex-name")?.textContent?.toLowerCase() || "";
                const match = !term || num.includes(term) || name.includes(term);
                row.style.display = match ? "" : "none";
            });
        };
    }
}
async function addCaughtAndRefreshDex(entryLikeWild) {
    // preserve battle state (hp, level, stats) in the Pokédex entry
    const entry = makeCaughtEntry(entryLikeWild);
    const list = await getCaught();
    const key = String(entry.pokeDex_num ?? entry.name).toLowerCase();
    if (!list.some(x => String(x.pokeDex_num ?? x.name).toLowerCase() === key)) {
        list.push(entry);
        await setCaught(list);
    }
    // If Pokédex is showing, re-render 1..MAX_DEX immediately
    const dexVisible = !document.querySelector("#viewDex")?.classList.contains("hidden");
    if (dexVisible && typeof renderDexFull === "function") {
        renderDexFull(await getCaught());
    }
}
/* =========================
   ADD OWNED (DEV) LOOKUP
   ========================= */
let __startersCache = null;
async function findByNameOrDex(input) {
    if (!__startersCache) __startersCache = await loadStarters();
    const list = __startersCache;

    const clean = String(input).trim().toLowerCase();
    if (!clean) return null;

    if (/^\d+$/.test(clean)) {
        const dex = Number(clean);
        const s = list.find(p => Number(p.pokeDex_num) === dex);
        if (s) return s;
        const json = await fetchJSONViaBG(`${API_BASE}?action=getPokemon&name=${dex}`);
        if (json?.status === "success" && json.data) return json.data;
        return null;
    }

    const s = list.find(p => (p.name || "").toLowerCase() === clean);
    if (s) return s;

    const json = await fetchJSONViaBG(GET_POKEMON(clean));
    if (json?.status === "success" && json.data) return json.data;
    return null;
}
function toggleAddOwned(open) {
    $("#addOwnedPanel")?.classList.toggle("hidden", !open);
    const s = $("#addOwnedStatus"); if (s) s.textContent = "";
    if (open) $("#addOwnedInput")?.focus();
}
async function saveAddOwned() {
    const status = $("#addOwnedStatus"); if (!status) return;
    const raw = $("#addOwnedInput")?.value || "";
    const tokens = raw.split(/[\n,]+/g).map(t => t.trim()).filter(Boolean);
    if (!tokens.length) { status.textContent = "Nothing to add."; return; }

    status.textContent = "Resolving…";
    const added = [], failed = [];

    for (const t of tokens) {
        try {
            const data = await findByNameOrDex(t);
            if (!data) { failed.push(t); continue; }
            added.push(makeCaughtEntry(data));
        } catch { failed.push(t); }
    }

    const existing = await getCaught();
    const map = new Map(existing.map(p => [String(p.pokeDex_num ?? p.name).toLowerCase(), p]));
    for (const a of added) {
        const key = String(a.pokeDex_num ?? a.name).toLowerCase();
        if (!map.has(key)) map.set(key, a);
    }
    await setCaught(Array.from(map.values()));

    status.textContent =
        `Added ${added.length}` + (failed.length ? `, skipped: ${failed.join(", ")}` : "");
    const input = $("#addOwnedInput"); if (input) input.value = "";
    renderDexList(await getCaught());
}
/* =========================
   BATTLE: SPRITES / NAMES
   ========================= */
const GET_POKEAPI_BY_ID = (id) => `https://pokeapi.co/api/v2/pokemon/${id}`;
const GET_POKEAPI_SPECIES = (idOrName) => `https://pokeapi.co/api/v2/pokemon-species/${idOrName}`;
const GET_POKEAPI_MON = (idOrName) => `https://pokeapi.co/api/v2/pokemon/${idOrName}`;

// Showdown sprite helper (reuses your SPRITE_NAME_FIXES)
function showdownSlug(name) {
    let slug = String(name || "").toLowerCase().replace(/[^a-z0-9-]/g, "");
    return SPRITE_NAME_FIXES[slug] || slug;
}
function showdownSprite(name, shiny = false) {
    const slug = showdownSlug(name);
    return shiny
        ? `https://play.pokemonshowdown.com/sprites/ani-shiny/${slug}.gif`
        : `https://play.pokemonshowdown.com/sprites/ani/${slug}.gif`;
}

// DFS: find the node in an evolution chain whose species.name === target
function findChainNode(chain, targetLower) {
    if (!chain) return null;
    if ((chain.species?.name || "").toLowerCase() === targetLower) return chain;
    for (const nxt of (chain.evolves_to || [])) {
        const hit = findChainNode(nxt, targetLower);
        if (hit) return hit;
    }
    return null;
}

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
    "darmanitan-standard": "darmanitan",
};
const POKEAPI_VALID_FORMS = {
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
function getRandomForm(baseName) {
    const isShiny = Math.random() < 1 / 128;
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
// ---- simple numeric storage helpers ----
async function getNum(key, def = 0) {
    const obj = await browser.storage.local.get(key);
    const n = Number(obj?.[key]);
    return Number.isFinite(n) ? n : def;
}
async function setNum(key, val) {
    await browser.storage.local.set({ [key]: Number(val) || 0 });
}
async function getBool(key, def = false) {
    const obj = await browser.storage.local.get(key);
    const v = obj?.[key];
    return typeof v === "boolean" ? v : def;
}
async function setBool(key, val) {
    await browser.storage.local.set({ [key]: !!val });
}
async function getVolume(def = .8) {
    const obj = await browser.storage.local.get("audioVolume");
    const v = obj?.audioVolume;
    return (typeof v === "number" && v >= 0 && v <= 1) ? v : def;
}
async function setVolume(v) {
    const vol = Math.min(1, Math.max(0, Number(v) || 0));
    browser.storage.local.set({ audioVolume: vol });
    // also update all sounds immediately
    Object.values(SOUNDS).forEach(s => { s.volume = vol; });
}

/* =========================
   BATTLE: MATH HELPERS
   ========================= */
function mapBaseStatsFromPokeAPI(d) {
    const out = { hp: 45, atk: 49, def: 49, spAtk: 50, spDef: 50, spd: 45 };
    if (!d?.stats) return out;
    for (const s of d.stats) {
        const n = s?.stat?.name;
        if (n === "hp") out.hp = s.base_stat;
        else if (n === "attack") out.atk = s.base_stat;
        else if (n === "defense") out.def = s.base_stat;
        else if (n === "special-attack") out.spAtk = s.base_stat;
        else if (n === "special-defense") out.spDef = s.base_stat;
        else if (n === "speed") out.spd = s.base_stat;
    }
    return out;
}
function randomIV() { return 10 + Math.floor(Math.random() * 22); } // 10..31
function randomNature() {
    const keys = ["atk", "def", "spAtk", "spDef", "spd"];
    const up = keys[Math.floor(Math.random() * keys.length)];
    const down = keys[Math.floor(Math.random() * keys.length)];
    const mod = { atk: 1, def: 1, spAtk: 1, spDef: 1, spd: 1 };
    if (up !== down) { mod[up] = 1.1; mod[down] = 0.9; }
    return mod;
}
function calcStats(base, level, opt = {}) {
    const iv = opt.iv || {
        hp: randomIV(), atk: randomIV(), def: randomIV(),
        spAtk: randomIV(), spDef: randomIV(), spd: randomIV()
    };
    const nat = opt.nature || randomNature();
    const HP = Math.floor(((2 * base.hp + iv.hp) * level) / 100) + level + 10;
    const ATK = Math.floor((Math.floor(((2 * base.atk + iv.atk) * level) / 100) + 5) * nat.atk);
    const DEF = Math.floor((Math.floor(((2 * base.def + iv.def) * level) / 100) + 5) * nat.def);
    const SPA = Math.floor((Math.floor(((2 * base.spAtk + iv.spAtk) * level) / 100) + 5) * nat.spAtk);
    const SPDf = Math.floor((Math.floor(((2 * base.spDef + iv.spDef) * level) / 100) + 5) * nat.spDef);
    const SPE = Math.floor((Math.floor(((2 * base.spd + iv.spd) * level) / 100) + 5) * nat.spd);
    return {
        iv, nature: nat,
        hp: Math.max(1, HP),
        atk: Math.max(1, ATK),
        def: Math.max(1, DEF),
        spAtk: Math.max(1, SPA),
        spDef: Math.max(1, SPDf),
        spd: Math.max(1, SPE)
    };
}
function calcDamage(attacker, defender, power = 40) {
    const L = attacker.level;
    const A = attacker.stats.atk;
    const D = Math.max(1, defender.stats.def);
    const base = Math.floor((((2 * L / 5 + 2) * power * A) / D) / 50) + 2;
    const rand = 0.85 + Math.random() * 0.15; // 0.85–1.0
    return Math.max(1, Math.floor(base * rand));
}
function pickWildLevel(playerLevel) {
    const deltas = [-2, -1, 0, 0, +1, +2];
    const d = deltas[Math.floor(Math.random() * deltas.length)];
    return Math.max(1, Math.min(80, playerLevel + d));
}
function pct(n, d) { return Math.round((n / Math.max(1, d)) * 100); }
/** Add a header button to either group.
 *  group: "primary" | "secondary"
 *  opts: { id, text, title, onClick, classes? }
 */
function addHeaderButton(group, opts) {
    const ul = document.getElementById(group === "secondary" ? "navSecondary" : "navPrimary");
    if (!ul) return null;

    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.id = opts.id;
    btn.className = opts.classes || "btn btn-success btn-sm";
    btn.textContent = opts.text;
    if (opts.title) btn.title = opts.title;
    if (typeof opts.onClick === "function") btn.addEventListener("click", opts.onClick);

    li.appendChild(btn);
    ul.appendChild(li);
    return btn;
}
/* ================
*   Ensure a dropdown toggle exists for a given UL.
*   ulId: "navPrimary" | "navSecondary"
*   opts: { label, right?: boolean, icon?: string }
*   ================
*/
function ensureMenuToggle(ulId, { label, right = false, icon = "" } = {}) {
    const ul = document.getElementById(ulId);
    if (!ul) return;

    // Create a wrapper so the panel can position relative to the toggle
    const wrap = document.createElement("div");
    wrap.className = "hdr-menu " + (ulId === "navPrimary" ? "primary" : "secondary");
    if (right) wrap.classList.add("right");

    // Insert wrapper and move the UL inside it
    const parent = ul.parentNode;
    parent.insertBefore(wrap, ul);
    wrap.appendChild(ul);

    // Add the toggle button
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "menu-toggle";
    btn.id = ulId + "Toggle";
    btn.innerHTML = (icon ? icon + " " : "") + label;
    wrap.insertBefore(btn, ul);

    // Toggle open/closed
    btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const isOpen = wrap.classList.contains("open");
        document.querySelectorAll(".hdr-menu.open").forEach(m => m.classList.remove("open"));
        if (!isOpen) wrap.classList.add("open");
    });
}
/* Close menus when clicking outside or pressing Escape */
function wireGlobalMenuClose() {
    document.addEventListener("click", () => {
        document.querySelectorAll(".hdr-menu.open").forEach(m => m.classList.remove("open"));
    });
    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
            document.querySelectorAll(".hdr-menu.open").forEach(m => m.classList.remove("open"));
        }
    });
}
/* =========================
   PLAYER MON (ACTIVE PARTNER)
   ========================= */
async function getPlayerMon() {
    const { party } = await browser.storage.local.get("party");
    const caught = await getCaughtWithUID();
    const byUID = mapCaughtByUID(caught);

    if (Array.isArray(party) && party[0]) {
        const mon = byUID.get(party[0]) || null;
        return mon;
    }
    return null;
}



async function setPlayerMon(mon) {
    // Update party reference
    const { party } = await browser.storage.local.get("party");
    if (!Array.isArray(party) || !party.length) return;

    party[0] = mon.uid;
    await saveParty(party);

    // Update the caught entry with latest state
    const caught = await getCaughtWithUID();
    const idx = caught.findIndex(c => c.uid === mon.uid);
    if (idx >= 0) {
        caught[idx] = mon;
        await setCaught(caught);
    }
}


/* =========================
   ENCOUNTER STATE
   ========================= */
let wild = null;
let wMaxHP = 0;
let wHP = 0;
let pHP = 0;
let wildSleepTurns = 0;
async function setLastEncounter(enc) {
    await browser.storage.local.set({ lastEncounter: enc });
}
/* =========================
   BATTLE UI HELPERS
   ========================= */
function hpBar(current, max) {
    const wrap = document.createElement("div");
    wrap.className = "progress";
    const fill = document.createElement("i");
    fill.style.width = `${pct(current, max)}%`;
    wrap.appendChild(fill);
    return wrap;
}
function getRarityByDex(num) {
    if ([144, 145, 146, 150, 151].includes(num)) return "legendary";
    if (num % 25 === 0) return "rare";
    if (num % 7 === 0) return "uncommon";
    return "common";
}
function endBattle(message) {
    wild = null;
    wMaxHP = 0; wHP = 0; pHP = 0; wildSleepTurns = 0;
    const panel = $("#battlePanel");
    if (panel) {
        panel.innerHTML = "";
        const hint = document.createElement("div");
        hint.className = "muted small";
        hint.textContent = message || 'Tap “Start Battle” to encounter a random wild Pokémon (Gen 1–5).';
        panel.appendChild(hint);
    }
    const status = $("#battleStatus"); if (status) status.textContent = "";
}
/*==========================
    BATTLE: EVOLUTION CHECK
    Try to evolve player mon if level-up requirements are met.
    Returns { evolved: boolean, oldName, newName }.
==========================
*/
async function evolvePlayerIfEligible() {
    const player = await getPlayerMon();
    if (!player?.name) return { evolved: false };

    const currentNameLower = String(player.name).toLowerCase();

    // 1) Get species to reach the chain
    const species = await fetchJSONViaBG(GET_POKEAPI_SPECIES(player.dex || currentNameLower));
    const chainRootUrl = species?.evolution_chain?.url;
    if (!chainRootUrl) return { evolved: false };

    // 2) Load the chain, find current node
    const chainDoc = await fetchJSONViaBG(chainRootUrl);
    const node = findChainNode(chainDoc?.chain, currentNameLower);
    if (!node) return { evolved: false };

    // 3) No further evolutions? done.
    const nexts = Array.isArray(node.evolves_to) ? node.evolves_to : [];
    if (!nexts.length) return { evolved: false }; // already final form

    // 4) Find a next evolution that is level-up with a defined min_level we meet
    const candidate = nexts.find(n => {
        const det = (n.evolution_details && n.evolution_details[0]) || null;
        return det?.trigger?.name === "level-up" &&
            typeof det.min_level === "number" &&
            player.level >= det.min_level;
    });
    if (!candidate) return { evolved: false }; // not eligible yet (maybe stone/trade etc.)

    const nextName = candidate.species?.name;
    if (!nextName) return { evolved: false };

    // 5) Fetch target mon data and rebuild player stats/sprite
    const nextMonData = await fetchJSONViaBG(GET_POKEAPI_MON(nextName));
    const nextBase = mapBaseStatsFromPokeAPI(nextMonData);

    // keep HP ratio
    const hpRatio = Math.max(0, Math.min(1, player.currentHP / Math.max(1, player.stats.hp)));
    const newStats = calcStats(nextBase, player.level);
    const newHP = Math.max(1, Math.floor(newStats.hp * hpRatio));

    const pretty = (s) => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;

    const evolvedMon = {
        ...player,
        name: pretty(nextName),
        dex: nextMonData.id,
        base: nextBase,
        stats: newStats,
        currentHP: newHP,
        sprite: showdownSprite(nextName, !!player.isShiny),
    };

    await setPlayerMon(evolvedMon);

    // Optionally keep your `pickedPokemon` in sync so other views show the new name/#.
    try {
        const { pickedPokemon } = await browser.storage.local.get("pickedPokemon");
        if (pickedPokemon) {
            await browser.storage.local.set({
                pickedPokemon: {
                    ...pickedPokemon,
                    name: pretty(nextName),
                    pokeDex_num: nextMonData.id,
                    base_image: pickedPokemon.base_image, // keep if you want; sprite comes from showdown
                }
            });
        }
    } catch { }

    // Refresh battle view if it's open
    if (!document.querySelector("#viewBattle")?.classList.contains("hidden")) {
        renderBattle(`✨ ${pretty(player.name)} evolved into ${pretty(nextName)}!`);
    }

    return { evolved: true, oldName: player.name, newName: pretty(nextName) };
}
/* =========================
   BATTLE CORE
   ========================= */
async function startBattle(opts = {}) {
    const { forceNew = false } = opts;
    const status = $("#battleStatus");
    if (status) status.textContent = "Finding a wild Pokémon…";

    try {
        // 1) Resume last battle if possible
        if (!forceNew) {
            if (wild && wHP > 0) {
                renderBattle("Resuming battle…");
                if (status) status.textContent = "";
                return;
            }
            const saved = (await browser.storage.local.get("lastEncounter"))?.lastEncounter;
            if (saved && saved.currentHP > 0) {
                wild = saved;
                wMaxHP = wild.stats?.hp || saved.currentHP || 1;
                wHP = saved.currentHP;

                const player = await getPlayerMon();
                if (player.currentHP > player.stats.hp) {
                    player.currentHP = player.stats.hp;
                    await setPlayerMon(player);
                }

                renderBattle("Resumed your last encounter.");
                if (status) status.textContent = "";
                return;
            }
        }

        // 2) Try to evolve party[0] if eligible before encounter
        try { await evolvePlayerIfEligible(); } catch { }

        const player = await getPlayerMon();
        if (!player) throw new Error("No active Pokémon in party!");

        // 3) Roll a new wild encounter
        const id = Math.floor(Math.random() * 649) + 1;
        const d = await fetchJSONViaBG(GET_POKEAPI_BY_ID(id));

        const baseName = d.name ? (d.name[0].toUpperCase() + d.name.slice(1)) : `#${id}`;
        const { isShiny, formName, displayName } = getRandomForm(baseName);

        let showdownName = formName.toLowerCase().replace(/[^a-z0-9-]/g, "");
        showdownName = SPRITE_NAME_FIXES[showdownName] || showdownName;

        const sprite = isShiny
            ? `https://play.pokemonshowdown.com/sprites/ani-shiny/${showdownName}.gif`
            : `https://play.pokemonshowdown.com/sprites/ani/${showdownName}.gif`;

        const wildLevel = pickWildLevel(player.level);
        const wildBase = mapBaseStatsFromPokeAPI(d);
        const wildStats = calcStats(wildBase, wildLevel);

        wild = {
            name: displayName,
            baseName: d.name,
            sprite,
            formName,
            isShiny,
            dex: d.id,
            level: wildLevel,
            base: wildBase,
            stats: wildStats,
            currentHP: wildStats.hp,
            types: d.types || [],
            status: { sleep: 0, poison: 0, burn: 0 }
        };

        wMaxHP = wild.stats.hp;
        wHP = wild.currentHP;

        // Cap player HP if needed
        if (player.currentHP > player.stats.hp) {
            player.currentHP = player.stats.hp;
            await setPlayerMon(player);
        }

        await setLastEncounter(wild);
        renderBattle();
        if (status) status.textContent = "";
    } catch (e) {
        console.error(e);
        if (status) status.textContent = "Failed to fetch wild Pokémon.";
    }
}

function spriteWithHP({ label, imgSrc, cur, max, flip = false, extraClass = "" }) {
    const col = document.createElement("div");
    col.className = `battle-col ${extraClass}`;   // <-- add class

    const name = document.createElement("div");
    name.className = "tiny muted";
    name.textContent = label;
    col.appendChild(name);

    const img = new Image();
    img.src = imgSrc || "";
    img.alt = label;
    img.style.imageRendering = "pixelated";
    img.style.animation = "bobWalk 1.2s infinite";
    if (flip) img.style.transform = "scaleX(-1)";
    col.appendChild(img);

    const bar = hpBar(cur, max);
    bar.style.width = "100%";
    col.appendChild(bar);

    return col;
}

async function renderBattle(msg) {
    const panel = $("#battlePanel"); if (!panel) return;
    panel.innerHTML = "";

    const card = document.createElement("div");
    card.className = "battle-card";

    if (msg) {
        const m = document.createElement("div");
        m.textContent = msg;
        m.className = "muted";
        card.appendChild(m);
    }

    const top = document.createElement("div");
    top.className = "battle-top";

    const player = await getPlayerMon();

    const wildCol = spriteWithHP({
        label: "Wild",
        imgSrc: wild?.sprite,
        cur: wHP,
        max: wMaxHP,
        flip: false,
        extraClass: "wild"
    });

    const info = document.createElement("div");
    info.className = "battle-info";

    const rarity = getRarityByDex(wild.dex);
    const rarityPenalty = { common: 1, uncommon: 1.2, rare: 1.5, legendary: 2 }[rarity] || 1;

    let chance = ((wMaxHP - wHP) / Math.max(1, wMaxHP)) / rarityPenalty + (player.level * 0.01);
    if (wildSleepTurns > 0) chance += 0.2;
    const mult = BALLS[selectedBall]?.mult || 1.0;
    chance = Math.min(0.95, Math.max(0.1, chance * mult));

    const expLine = `<div class="tiny muted">EXP ${player.exp || 0} / ${player.expToNext || expToNext(player.level)}</div>`;
    info.innerHTML = `
      <div class="tiny muted">Selected: ${BALLS[selectedBall]?.label || "Poké Ball"}</div>
      <div style="font-weight:600;">${wild.name} ${wild.isShiny ? "✨" : ""}</div>
      <div class="small">Lv ${wild.level} • Form: ${wild.formName || "Normal"} • Rarity: ${rarity}</div>
      <div class="small">You: Lv ${player.level} — HP ${player.currentHP} / ${player.stats.hp}</div>
      ${expLine}
      <div class="small">Wild HP: ${wHP} / ${wMaxHP}</div>
      <div class="small">Catch Chance: ${(chance * 100).toFixed(1)}%</div>
    `;

    const youCol = spriteWithHP({
        label: player.name,
        imgSrc: player?.image,
        cur: player.currentHP,
        max: player?.stats?.hp || 1,
        flip: true,
        extraClass: "you"
    });

    top.append(wildCol, info, youCol);

    // ===== Controls (unchanged below)… =====
    const ctl = document.createElement("div");
    ctl.className = "battle-ctl";
    [
        { txt: '⚔️ Attack', fn: playerAttack },
        { txt: '⭕ Ball', fn: throwBall },
        { txt: '🧪 Potion', fn: usePotion },
        { txt: '🏃 Run', fn: runAway }
    ].forEach(a => {
        const b = document.createElement("button");
        b.className = "btn btn-success btn-sm";
        b.textContent = a.txt;
        b.onclick = a.fn;
        ctl.appendChild(b);
    });

    // Sleep Powder
    const sleepBtn = document.createElement("button");
    sleepBtn.className = "btn btn-success btn-sm";
    sleepBtn.textContent = "🌙 Sleep Powder";
    sleepBtn.onclick = () => {
        if (wildSleepTurns <= 0) {
            wildSleepTurns = 2;
            renderBattle(`${wild.name} fell asleep!`);
            setTimeout(wildAttack, 500);
        } else {
            renderBattle(`${wild.name} is already sleepy!`);
            setTimeout(wildAttack, 500);
        }
    };
    ctl.appendChild(sleepBtn);

    // ----- Ball selector (dropdown) -----
    const ballRow = document.createElement("div");
    ballRow.className = "tiny";
    Object.assign(ballRow.style, {
        display: "flex",
        alignItems: "center",
        gap: "6px"
    });

    const ballLabel = document.createElement("label");
    ballLabel.textContent = "Poké Ball:";
    ballLabel.setAttribute("for", "ballSelect");
    ballLabel.style.opacity = "0.8";

    const select = document.createElement("select");
    select.id = "ballSelect";
    select.className = "input";
    select.style.flex = "1";

    const order = ["poke", "great", "ultra", "master"];
    (async () => {
        for (const t of order) {
            const conf = BALLS[t];
            const cnt = await getBallCount(t);
            const opt = document.createElement("option");
            opt.value = t;
            opt.textContent = `${conf.icon} ${conf.label} (${cnt})`;
            opt.disabled = cnt <= 0;
            if (t === selectedBall) opt.selected = true;
            select.appendChild(opt);
        }
    })();

    select.onchange = () => {
        selectedBall = select.value;
        renderBattle(`Selected: ${BALLS[selectedBall].label}`);
    };

    ballRow.append(ballLabel, select);
    ctl.appendChild(ballRow);

    // Update select counts/enabled state now
    await updateBallSelect();

    // Compose card
    card.append(top, ctl);
    panel.appendChild(card);
}
async function playerAttack() {
    const player = await getPlayerMon();
    const dmg = calcDamage(player, wild, 40);

    wHP = Math.max(0, wHP - dmg);
    wild.currentHP = wHP;
    await setLastEncounter(wild);

    if (wHP <= 0) {
        const { gain, leveled, level } = await grantExpForWin(wild);
        renderBattle(`You dealt ${dmg}. ${wild.name} fainted! +${gain} EXP${leveled ? ` ⬆️ Lv ${level}!` : ""}`);
        setTimeout(() => endBattle("You won! Start another battle."), 5000);
        return;
    }
    renderBattle(`You dealt ${dmg}!`);
    setTimeout(wildAttack, 500);
}

async function wildAttack() {
    if (wildSleepTurns > 0) {
        wildSleepTurns--;
        renderBattle(`${wild.name} is sleeping...`);
        return;
    }

    const player = await getPlayerMon();
    const dmg = calcDamage(wild, player, 40);

    player.currentHP = Math.max(0, player.currentHP - dmg);

    await setPlayerMon(player);

    if (player.currentHP <= 0) {
        renderBattle(`${wild.name} hit for ${dmg}. Your mon fainted!`);
        return;
    }
    renderBattle(`${wild.name} hit for ${dmg}.`);
}
/* =========================
   EXP / LEVELING HELPERS
   ========================= */
// Simple curve: next level needs (20 + L*10) EXP
function expToNext(level) { return 20 + level * 10; }
// Grant EXP after defeating a wild mon
async function grantExpForWin(wildMon) {
    const [pb, caught] = await Promise.all([
        browser.storage.local.get("party"),
        getCaughtWithUID()
    ]);
    const party = pb.party;
    if (!party?.[0]) return { gain: 0, leveled: false, level: 1 };

    const uid = party[0];
    const byUID = mapCaughtByUID(caught);
    const mon = byUID.get(uid);
    if (!mon) return { gain: 0, leveled: false, level: 1 };

    // --- Grant EXP ---
    const gain = Math.max(8, Math.floor(10 + wildMon.level * 3));
    mon.exp = (mon.exp || 0) + gain;

    let leveled = false;
    while ((mon.expToNext || expToNext(mon.level)) <= mon.exp) {
        mon.exp -= (mon.expToNext || expToNext(mon.level));
        mon.level++;
        leveled = true;

        const ratio = mon.currentHP / mon.stats.hp;
        mon.stats = calcStats(mon.base, mon.level);
        mon.currentHP = Math.max(1, Math.floor(mon.stats.hp * Math.min(1, ratio)));
        mon.expToNext = expToNext(mon.level);
    }
    if (!mon.expToNext) mon.expToNext = expToNext(mon.level);

    // --- Save back into caught list ---
    const idx = caught.findIndex(c => c.uid === uid);
    if (idx >= 0) caught[idx] = mon;
    await setCaught(caught);

    // evolution check
    try {
        const evo = await evolvePlayerIfEligible();
        if (evo.evolved) toast(`✨ ${evo.oldName} evolved into ${evo.newName}!`);
    } catch (e) {
        console.warn("Evolution check failed:", e);
    }

    return { gain, leveled, level: mon.level };
}

async function usePotion() {
    // Load party and caught list
    const { party } = await browser.storage.local.get("party");
    const caught = await getCaughtWithUID();
    const byUID = mapCaughtByUID(caught);

    // Ensure valid party and resolve UID
    if (!party?.[0]) return;
    let player = typeof party[0] === "string" ? byUID.get(party[0]) : party[0];
    if (!player || !player.stats) {
        renderBattle("No valid Pokémon in party!");
        return;
    }

    // Load potions from playerStats
    const store = (await browser.storage.local.get("playerStats"))?.playerStats || { potions: 0 };
    if ((store.potions | 0) <= 0) {
        renderBattle(`You have no potions!`);
        return;
    }
    store.potions--;

    // Heal calculation
    const heal = Math.max(10, Math.floor(player.stats.hp * 0.25));
    player.currentHP = Math.min(player.stats.hp, (player.currentHP || 0) + heal);

    // Save back updated mon
    party[0] = player.uid || player; // keep UID or object depending on design
    await Promise.all([
        browser.storage.local.set({ party }),
        browser.storage.local.set({ playerStats: store }),
        // Also update caught list with new HP
        setCaught(caught.map(m => m.uid === player.uid ? player : m))
    ]);

    renderBattle(`You used a potion and healed ${heal} HP.`);
    setTimeout(wildAttack, 500);
}

async function throwBall() {
    const ball = BALLS[selectedBall] || BALLS.poke;

    // 1) Inventory check
    const have = await getBallCount(selectedBall);
    if (have <= 0) {
        renderBattle(`No ${ball.label}s left!`);
        setTimeout(wildAttack, 500);
        return;
    }

    // 2) Spend the ball and refresh UI counts
    await decBall(selectedBall);
    await updateBallSelect();

    // 3) Master Ball = guaranteed
    if (selectedBall === "master") {
        await handleCatch({
            ...wild,
            base_image: null,
            shiny_image: null
        });
        return; // handleCatch clears battle
    }

    // 4) Compute chance
    const player = await getPlayerMon();
    const rarity = getRarityByDex(wild.dex);
    const rarityPenalty = { common: 1, uncommon: 1.2, rare: 1.5, legendary: 2 }[rarity] || 1;

    let chance = ((wMaxHP - wHP) / Math.max(1, wMaxHP)) / rarityPenalty + (player.level * 0.01);
    if (wildSleepTurns > 0) chance += 0.2;
    const mult = BALLS[selectedBall]?.mult || 1.0;
    chance = Math.max(0.05, Math.min(0.95, chance * mult));

    // 5) Roll it
    const roll = Math.random();
    if (roll <= chance) {
        await handleCatch({
            ...wild,
            base_image: null,
            shiny_image: null
        });
        return; // stop here, handleCatch does the rest
    }

    // 6) Miss
    renderBattle(`${ball.label} failed! (${Math.round(chance * 100)}% chance)`);
    setTimeout(wildAttack, 500);
}

function runAway() {
    browser.storage.local.set({ lastEncounter: null });
    endBattle("Got away safely. Start another battle!");
}
/* =========================
   PokéStop logic
   ========================= */
let pokestopTimer = null;
// Format remaining cooldown as mm:ss
function fmtTime(ms) {
    const m = Math.floor(ms / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
// Show a small toast (use alert if you prefer)
function toast(msg) {
    // lightweight fallback
    alert(msg);
}
async function updatePokeStopStatus() {
    const statusEl = $("#btnPokeStop");
    const pokeEl = $("#pokeStopPanel");
    if (!statusEl) return;

    const now = Date.now();
    const cooldownEnd = await getNum(STORE.cooldown, 0);

    if (now >= cooldownEnd) {
        statusEl.textContent = "📍 PokéStop ready!";
        statusEl.title = "Click to spin the PokéStop";
        pokeEl.textContent = "";
        statusEl.disabled = false;
        statusEl.classList.remove("cooling");
        if (pokestopTimer) {
            clearInterval(pokestopTimer);
            pokestopTimer = null;
        }
    } else {
        const left = cooldownEnd - now;
        const mins = Math.floor(left / 60000);
        const secs = Math.floor((left % 60000) / 1000);
        statusEl.disabled = true;
        statusEl.textContent = `🕒 PokéStop cooldown`;
        pokeEl.textContent = `PokéStop cooldown: ${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
        statusEl.title = `PokéStop is cooling down. Ready in ${fmtTime(left)}`;
        statusEl.classList.add("cooling");
    }
}
async function openPokeStop() {
    const now = Date.now();
    const cooldownEnd = await getNum(STORE.cooldown, 0);

    if (now < cooldownEnd) {
        const left = cooldownEnd - now;
        updatePokeStopStatus();
        toast(`🕒 PokéStop is cooling down\nReady in ${fmtTime(left)}`);
        return;
    }

    // Always some coins
    const coinAmount = Math.floor(Math.random() * 91) + 10; // 10–100
    const prevCoins = await getNum(STORE.coins, 0);
    await setNum(STORE.coins, prevCoins + coinAmount);

    // One ball type (weighted)
    const roll = Math.random();
    let ballKind = "poke"; // default
    if (roll > 0.75 && roll <= 0.95) ballKind = "great";
    else if (roll > 0.95) ballKind = "ultra";

    const ballAmount = Math.floor(Math.random() * 5) + 1; // 1–5
    const inv = (await browser.storage.local.get("playerStats"))?.playerStats || { balls: 0, potions: 0 };

    if (ballKind === "poke") {
        inv.balls = (inv.balls | 0) + ballAmount; // your game uses playerStats.balls
    } else if (ballKind === "great") {
        const n = await getNum(STORE.greatBalls, 0);
        await setNum(STORE.greatBalls, n + ballAmount);
    } else {
        const n = await getNum(STORE.ultraBalls, 0);
        await setNum(STORE.ultraBalls, n + ballAmount);
    }

    // 30% chance: potions (1–3)
    let potionLine = "";
    if (Math.random() < 0.30) {
        const pots = 1 + Math.floor(Math.random() * 3);
        inv.potions = (inv.potions | 0) + pots;
        potionLine = `\n🧪 +${pots} Potion${pots > 1 ? "s" : ""}`;
    }

    // Rare Master Ball (2.5%)
    let masterLine = "";
    if (Math.random() < 0.025) {
        const n = await getNum(STORE.masterBalls, 0);
        await setNum(STORE.masterBalls, n + 1);
        masterLine = `\n🎱 +1 Master Ball!`;
    }

    // Save back playerStats if we touched it
    await browser.storage.local.set({ playerStats: inv });
    if (!$("#viewBattle")?.classList.contains("hidden")) {
        await updateBallSelect();
    }

    const ballName =
        ballKind === "poke" ? "Poké Ball" :
            ballKind === "great" ? "Great Ball" : "Ultra Ball";

    toast(
        `📍 PokéStop Reward:\n\n` +
        `🪙 +${coinAmount} Coins\n` +
        `🎁 +${ballAmount} ${ballName}` +
        potionLine + masterLine
    );

    // Cooldown 1–5 minutes
    const cooldownMs = (1 + Math.floor(Math.random() * 5)) * 60 * 1000;
    await setNum(STORE.cooldown, now + cooldownMs);
    // Start ticker if not running
    if (!pokestopTimer) {
        pokestopTimer = setInterval(updatePokeStopStatus, 1000);
    }
    updatePokeStopStatus();
}
/* =========================
    Inventory Helpers
    ========================= */
async function getInventorySummary() {
    const { playerStats } = await browser.storage.local.get("playerStats");
    const balls = playerStats?.balls | 0;
    const potions = playerStats?.potions | 0;
    const coins = await getNum(STORE.coins, 0);
    const great = await getNum(STORE.greatBalls, 0);
    const ultra = await getNum(STORE.ultraBalls, 0);
    const master = await getNum(STORE.masterBalls, 0);
    return { coins, balls, potions, great, ultra, master };
}
/* =========================
   INIT + EVENTS
   ========================= */
async function rollAndRender() {
    $("#status").textContent = "Loading starters…";
    const list = await loadStarters();
    const unique = new Map(list.map(p => [String(p.pokeDex_num ?? p.name), p]));
    const pool = shuffle(Array.from(unique.values())).slice(0, 3);
    await browser.storage.local.set({ ballPool: pool });
    renderThreeBalls(pool);
}
function applyCompactLayout() {
    const compact = document.documentElement.clientWidth <= 360;
    document.body.classList.toggle('compact', compact);
}
function openSettings() {
    $('#resultCard')?.classList.add("hidden");
    $("#viewBattle")?.classList.add("hidden");
    $("#viewDex")?.classList.add("hidden");
    $("#viewPicker")?.classList.add("hidden");
    $("#viewParty")?.classList.add("hidden");
    $("#viewSettings")?.classList.remove("hidden");

}
async function initSettings() {
    const chk = document.getElementById("aduioEnabled");
    const slider = document.getElementById("audioVolume");
    const label = document.getElementById("audioVolumeVal");
    const testBtn = document.getElementById("testSound");
    const saveBtn = document.getElementById("saveBtn");
    if (!chk || !slider || !label || !testBtn || !saveBtn) return;

    if (!await getBool("audioEnabled")) await setBool("audioEnabled", true);
    if (!await getNum("audioVolume")) await setNum("audioVolume", 0.5);
    chk.checked = await getBool("audioEnabled", true);
    const vol = await getVolume();
    slider.value = Math.round(vol * 100);
    label.textContent = `${slider.value}%`;

    chk.addEventListener("change", async () => {
        await setBool("audioEnabled", chk.checked);
    });
    slider.addEventListener("input", async () => {
        label.textContent = `${slider.value}%`;
    });
    slider.addEventListener("change", async () => {
        await setVolume(Number(slider.value) / 100);
    });
    testBtn.addEventListener("click", async () => {
        playSound("hit");
    });
    saveBtn.addEventListener("click", () => {
        toast("Settings saved.");
        alert("This will be added so saaving data will persist across devices in a future update.");
    });

    browser.storage.onChanged.addListener((changes, area) => {
        if (area !== "local") return;

        if (changes.audioEnabled) {
            const v = changes.audioEnabled.newValue;
            if (typeof v === "boolean") {
                chk.checked = v;
            }
        }
        if (changes.audioVolume) {
            const v = changes.audioVolume.newValue;
            if (typeof v === "number") {
                const pct = Math.round(Math.max(0, Math.min(1, v)) * 100);
                slider.value = pct;
                label.textContent = `${pct}%`;
            }
        }
    });
}
async function playSound(key) {
    const audio = SOUNDS[key];
    if (!audio) {
        console.warn("[Audio] No sound for key: ", key);
        return;
    }
    /*
    *  *   load Sound from settings if audio is enabled
    */
    if (!await getBool("soundEnabled", true)) return;
    const clone = audio.cloneNode();
    const volume = await getVolume();

    clone.volume = Math.min(1, Math.max(0, volume));
    try {
        clone.currentTime = 0;
        await clone.play();
    } catch (e) {
        console.warn("[Audio] play error:", e);
    }
}
/* =========================
    PARTY & STORAGE BOXES
    ========================= 
*/
// Initialize default PC boxes if missing
async function loadPartyAndBoxes() {
    let [party, boxes] = await Promise.all([
        browser.storage.local.get(PARTY_KEY).then(o => Array.isArray(o[PARTY_KEY]) ? o[PARTY_KEY] : []),
        browser.storage.local.get(BOXES_KEY).then(o => o[BOXES_KEY]),
    ]);

    if (!boxes || !Array.isArray(boxes.boxes)) {
        boxes = {
            current: 0,
            boxes: [
                { name: "Box 1", slots: Array(30).fill(null) }
            ]
        };
        await browser.storage.local.set({ [BOXES_KEY]: boxes });
    }

    // Always compact the party on load (remove nulls)
    if (!Array.isArray(party)) {
        party = [];
    } else {
        party = compactParty(party);
    }
    await browser.storage.local.set({ [PARTY_KEY]: party });

    return { party, boxes };
}
function compactParty(party) {
    return party.filter(Boolean).slice(0, 6);
}
async function saveParty(party) {
    const compacted = compactParty(party);
    await browser.storage.local.set({ [PARTY_KEY]: compacted });
}
async function saveBoxes(boxes) {
    await browser.storage.local.set({ [BOXES_KEY]: boxes });
}
// Utility: first empty slot index in the current box (or -1)
function firstEmptySlot(slots) {
    return slots.findIndex(x => !x);
}
function makeMonCard(mon) {
    const card = document.createElement("div");
    card.className = "mon-card";
    card.draggable = true;
    card.dataset.uid = mon.uid;

    const spr = document.createElement("div");
    spr.className = "mon-sprite";
    const img = new Image();
    img.src = mon.image || mon.base_image || mon.shiny_image || mon.sprite || "";
    img.alt = mon.name || "";
    spr.appendChild(img);

    const meta = document.createElement("div");
    meta.className = "mon-meta";
    const name = document.createElement("div");
    name.className = "mon-name";
    name.textContent = (mon.name || "").replace(/\b\w/g, m => m.toUpperCase());
    const sub = document.createElement("div");
    sub.className = "mon-sub";
    sub.textContent = mon.level ? `Lv ${mon.level}` : (mon.base_experience ? `EXP ${mon.base_experience}` : "");
    meta.append(name, sub);

    card.append(spr, meta);
    return card;
}
function wireSlotDnD(slotEl, onDrop) {
    slotEl.addEventListener("dragenter", e => { e.preventDefault(); slotEl.classList.add("drop-ok"); });
    slotEl.addEventListener("dragover", e => { e.preventDefault(); });
    slotEl.addEventListener("dragleave", () => slotEl.classList.remove("drop-ok"));
    slotEl.addEventListener("drop", async e => {
        e.preventDefault();
        slotEl.classList.remove("drop-ok");
        if (!__drag) return;
        await onDrop(__drag);
        __drag = null;
    });
}
function wireCardDrag(card, from, index) {
    card.addEventListener("dragstart", () => { __drag = { from, index }; });
    card.addEventListener("dragend", () => { __drag = null; });
}
async function renderPartyAndStorage() {
    const [caught, pb] = await Promise.all([getCaughtWithUID(), loadPartyAndBoxes()]);
    const byUID = mapCaughtByUID(caught);

    // Party
    const partyGrid = document.getElementById("partyGrid");
    partyGrid.innerHTML = "";
    for (let i = 0; i < 6; i++) {
        const uid = pb.party[i] || null;
        const slot = document.createElement("div");
        slot.className = "slot" + (uid ? "" : " empty");

        if (uid) {
            const mon = byUID.get(uid);
            if (mon) {
                const card = makeMonCard(mon);
                wireCardDrag(card, "party", i);
                slot.appendChild(card);
            } else {
                // missing/corrupt id
                slot.classList.add("empty");
            }
        }

        // Drop behavior: move/swap into party slot i
        wireSlotDnD(slot, async (drag) => {
            const { party, boxes } = await loadPartyAndBoxes();
            if (drag.from === "party") {
                // swap within party
                const uidA = party[drag.index] || null;
                const uidB = party[i] || null;
                party[i] = uidA;
                if (drag.index !== i) party[drag.index] = uidB || null;
                await saveParty(party);
            } else {
                // from storage box
                const slots = boxes.boxes[boxes.current].slots;
                const moving = slots[drag.index];
                const replaced = party[i] || null;
                party[i] = moving || null;
                slots[drag.index] = replaced || null;
                await Promise.all([saveParty(party), saveBoxes(boxes)]);
            }
            renderPartyAndStorage();
        });

        partyGrid.appendChild(slot);
    }

    // Storage box
    const boxTitle = document.getElementById("boxTitle");
    boxTitle.textContent = pb.boxes.boxes[pb.boxes.current]?.name || `Box ${pb.boxes.current + 1}`;

    const storageGrid = document.getElementById("storageGrid");
    storageGrid.innerHTML = "";
    const slots = pb.boxes.boxes[pb.boxes.current].slots;
    for (let i = 0; i < 30; i++) {
        const uid = slots[i] || null;
        const slot = document.createElement("div");
        slot.className = "slot" + (uid ? "" : " empty");

        if (uid) {
            const mon = byUID.get(uid);
            if (mon) {
                const card = makeMonCard(mon);
                wireCardDrag(card, "box", i);
                slot.appendChild(card);
            } else {
                slot.classList.add("empty");
            }
        }

        // Drop into storage slot i
        wireSlotDnD(slot, async (drag) => {
            const { party, boxes } = await loadPartyAndBoxes();
            const destSlots = boxes.boxes[boxes.current].slots;

            if (drag.from === "party") {
                const moving = party[drag.index] || null;
                const replaced = destSlots[i] || null;
                destSlots[i] = moving;

                // Instead of leaving null in the party, remove it
                party.splice(drag.index, 1);
                if (replaced) party.push(replaced);

                await Promise.all([saveParty(party), saveBoxes(boxes)]);
            } else {
                // swap within same box
                const a = drag.index, b = i;
                const tmp = destSlots[a];
                destSlots[a] = destSlots[b];
                destSlots[b] = tmp;
                await saveBoxes(boxes);
            }
            renderPartyAndStorage();
        });

        storageGrid.appendChild(slot);
    }
}
async function openPartyView() {
    // View switching
    document.getElementById("viewPicker")?.classList.add("hidden");
    document.getElementById("resultCard")?.classList.add("hidden");
    document.getElementById("viewBattle")?.classList.add("hidden");
    document.getElementById("viewDex")?.classList.add("hidden");
    document.getElementById("viewSettings")?.classList?.add("hidden");
    document.getElementById("viewParty")?.classList.remove("hidden");

    await renderPartyAndStorage();
}
// Wire arrows once (in init)
function wireBoxArrows() {
    const prev = document.getElementById("boxPrev");
    const next = document.getElementById("boxNext");
    if (prev) prev.onclick = async () => {
        const boxes = (await browser.storage.local.get(BOXES_KEY))[BOXES_KEY];
        boxes.current = (boxes.current - 1 + boxes.boxes.length) % boxes.boxes.length;
        await saveBoxes(boxes);
        renderPartyAndStorage();
    };
    if (next) next.onclick = async () => {
        const boxes = (await browser.storage.local.get(BOXES_KEY))[BOXES_KEY];
        boxes.current = (boxes.current + 1) % boxes.boxes.length;
        await saveBoxes(boxes);
        renderPartyAndStorage();
    };
}
// Call after you push a new caught entry into `caught` and setCaught(list)
async function placeNewCatchIntoPartyOrStorage(caughtUID) {
    const { party, boxes } = await loadPartyAndBoxes();

    if (party.length < 6) {
        party.push(caughtUID);
        await saveParty(party);
    } else {
        // Party full, go to storage
        let slots = boxes.boxes[boxes.current].slots;
        let idx = firstEmptySlot(slots);
        if (idx === -1) {
            boxes.boxes.push({ name: `Box ${boxes.boxes.length + 1}`, slots: Array(30).fill(null) });
            boxes.current = boxes.boxes.length - 1;
            slots = boxes.boxes[boxes.current].slots;
            idx = firstEmptySlot(slots);
        }
        slots[idx] = caughtUID;
        await saveBoxes(boxes);
    }

    // Re-render if party UI is open
    if (!document.getElementById("viewParty")?.classList.contains("hidden")) {
        await renderPartyAndStorage();
    }
}


/* =========================
    CATCH HANDLER
    ========================= 
*/
// Ensure each caught entry has a stable unique id
function ensureCaughtUID(entry) {
    if (!entry.uid) entry.uid = crypto?.randomUUID?.() || ("m" + Date.now() + Math.random().toString(16).slice(2));
    return entry;
}
// Load caught list and ensure UIDs
async function getCaughtWithUID() {
    const list = await getCaught();
    let changed = false;
    for (const e of list) if (!e.uid) { ensureCaughtUID(e); changed = true; }
    if (changed) await setCaught(list);
    return list;
}
// Lookup helpers
function mapCaughtByUID(list) { const m = new Map(); for (const c of list) if (c.uid) m.set(c.uid, c); return m; }
async function handleCatch(mon) {
    const player = await getPlayerMon();
    const playerLevel = player?.level || 5;

    const list = await getCaughtWithUID();
    const entry = ensureCaughtUID(makeCaughtEntry(mon, playerLevel));

    list.push(entry);
    await setCaught(list);
    await placeNewCatchIntoPartyOrStorage(entry.uid);


    // Reset encounter both in storage and memory
    wild = null;
    wHP = 0;
    wMaxHP = 0;
    await browser.storage.local.set({ lastEncounter: null });

    endBattle(`You caught ${mon.name}!`);
}
/* 
*   =========================
*   Save Data Helpers
*   =========================
*/ 
async function collectPlayerState(username = "guest") {
    // Load everything we need from storage
    const keys = [
        "playerStats", "party", "pcBoxes", "pickedPokemon",
        "pokestopCooldown", "ballPool", "coins"
    ];
    const store = await browser.storage.local.get(keys);

    // Normalize items layout
    const playerStats = store.playerStats || {};
    const items = {
        balls: [
            {
                name: "pokeball",
                amount: playerStats.balls || 0,
                image: "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/poke-ball.png"
            },
            {
                name: "greatball",
                amount: await getNum(STORE.greatBalls, 0),
                image: "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/great-ball.png"
            },
            {
                name: "ultraball",
                amount: await getNum(STORE.ultraBalls, 0),
                image: "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/ultra-ball.png"
            },
            {
                name: "masterball",
                amount: await getNum(STORE.masterBalls, 0),
                image: "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/master-ball.png"
            }
        ],
        items: [
            { name: "potion",      image: "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/potion.png" },
            { name: "superpotion", image: "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/super-potion.png" },
            { name: "hyperpotion", image: "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/hyper-potion.png" },
            { name: "maxpotion",   image: "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/max-potion.png" },
            { name: "fullrestore", image: "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/full-restore.png" }
        ]
    };

    return {
        username,
        items,
        pcBoxes: store.pcBoxes || { current: 0, boxes: [] },
        party: store.party || [],
        pickedPokemon: store.pickedPokemon || null,
        pokestopCooldown: store.pokestopCooldown || 0,
        ballPool: store.ballPool || [],
        coins: store.coins || 0
    };
}
async function savePlayerToDB(username = "guest") {
    const payload = await collectPlayerState(username);

    try {
        const res = await fetch("https://dstokesncstudio.com/pokeapi/pokeapi.php?action=savePlayer", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });
        const json = await res.json();
        console.log("[savePlayerToDB] Response:", json);
        return json;
    } catch (err) {
        console.error("[savePlayerToDB] Failed:", err);
        return { status: "error", message: err.message };
    }
}

/* =========================
    Migration Helpers
    ========================= 
*/
async function migrateOldStorage() {
    const store = await browser.storage.local.get(null); // get everything

    // Ensure caught is array
    if (!Array.isArray(store.caught)) {
        await browser.storage.local.set({ caught: [] });
    }

    // Ensure party exists
    if (!Array.isArray(store.party)) {
        await browser.storage.local.set({ party: [] });
    }

    // Ensure pcBoxes exists
    if (!store.pcBoxes || !Array.isArray(store.pcBoxes.boxes)) {
        const pcBoxes = {
            current: 0,
            boxes: [{ name: "Box 1", slots: Array(30).fill(null) }]
        };
        await browser.storage.local.set({ pcBoxes });
    }

    // Normalize playerStats
    if (typeof store.playerStats !== "object" || store.playerStats === null) {
        await browser.storage.local.set({
            playerStats: { balls: 5, potions: 3 }
        });
    } else {
        if (typeof store.playerStats.balls !== "number") store.playerStats.balls = 5;
        if (typeof store.playerStats.potions !== "number") store.playerStats.potions = 3;
        await browser.storage.local.set({ playerStats: store.playerStats });
    }

    // Ensure coin count
    if (typeof store.coins !== "number") {
        await browser.storage.local.set({ coins: 0 });
    }

    // Ensure ballPool is array
    if (!typeof store.pokeBalls === "number") {
        await browser.storage.local.set({ ballPool: [] });
    }

    if(!typeof store.greatBalls === "number"){
        await browser.storage.local.set({ greatBalls: 0 });
    }
    if(!typeof store.ultraBalls === "number"){
        await browser.storage.local.set({ ultraBalls: 0 });
    }
    if(!typeof store.masterBalls === "number"){
        await browser.storage.local.set({ masterBalls: 0 });
    }

    toast("Storage migration complete.");
    console.log("[migrateOldStorage] Migration complete.");
}

/* 
*   =========================
    MAIN INIT
    ========================= 
*/
async function init() {
    // show version
    $("#ver").textContent = browser.runtime.getManifest().version;

    // Build the two dropdown menus (labels are yours to change)
    ensureMenuToggle("navPrimary", { label: "Play", icon: "🎮" });            // left menu
    ensureMenuToggle("navSecondary", { label: "More", icon: "☰", right: true }); // right menu
    wireGlobalMenuClose();

    addHeaderButton("primary", {
        id: "btnBattle",
        text: "⚔️ Battle",
        title: "Battle!",
        onClick: showBattle,
    });
    addHeaderButton("secondary", {
        id: "btnParty",
        text: "🎒 Party",
        title: "Party & Storage",
        onClick: openPartyView,
    });
    addHeaderButton("primary", {
        id: "btnShop",
        text: "🛒 Shop",
        title: "Shop (coming soon)",
        onClick: () => alert("Shop is coming soon!"),
    });


    // Fill secondary menu (Pokédex, Reset)
    addHeaderButton("secondary", {
        id: "btnPokedex",
        text: "📖 Pokédex",
        title: "Open Pokédex",
        onClick: openDex,
    });
    addHeaderButton("secondary", {
        id: "btnSettings",
        text: "⚙️ Settings",
        title: "Settings",
        onClick: openSettings,
    });
    addHeaderButton("secondary", {
        id: "reset",
        text: "🗑️ Reset Game",
        title: "Reset selection",
        onClick: async () => {
            await browser.storage.local.remove([
                "pickedPokemon", "ballPool", "playerMon", "playerStats",
                "caught", "lastEncounter",
                "coins", "greatBalls", "ultraBalls", "masterBalls", "pokestopCooldown", "party", "pcBoxes"
            ]);
            $("#resultCard")?.classList.add("hidden");
            window.__hasResult = false;
            await rollAndRender();
            if (!$("#viewDex")?.classList.contains("hidden")) {
                await renderDexFull([]); // show ???????
            } else {
                showPicker();
            }
        },
    });
    // --- end header buttons ---

    // starter pick / restore flow
    const saved = await browser.storage.local.get(["pickedPokemon", "ballPool"]);
    if (saved.pickedPokemon) {
        $("#status").textContent = "Your pick: " + (saved.pickedPokemon.name || "unknown");
        $("#balls")?.classList.add("hidden");
        showResult(saved.pickedPokemon);
    } else if (Array.isArray(saved.ballPool) && saved.ballPool.length === 3) {
        $("#status").textContent = "Choose a Poké Ball:";
        renderThreeBalls(saved.ballPool);
    } else {
        await rollAndRender();
    }

    // pick one of the three balls
    $("#balls")?.addEventListener("click", async (e) => {
        const btn = e.target.closest(".ball");
        if (!btn) return;

        const { pickedPokemon, ballPool } = await browser.storage.local.get(["pickedPokemon", "ballPool"]);
        if (pickedPokemon || !Array.isArray(ballPool)) return;

        const idx = Number(btn.dataset.index || 0);
        const chosen = ballPool[idx];
        if (!chosen) return;

        // Save as picked starter
        await browser.storage.local.set({ pickedPokemon: chosen });
        $("#status").textContent = "Your pick: " + (chosen.name || "unknown");
        $("#balls")?.classList.add("hidden");
        showResult(chosen);

        // Ensure playerMon exists
        const player = await getPlayerMon();

        // --- NEW: Add to Pokédex & Party/Storage ---
        try {
            // Wrap it with UID
            const entry = ensureCaughtUID(makeCaughtEntry(chosen));

            // Add to dex if not already
            const list = await getCaughtWithUID();
            const key = String(entry.pokeDex_num ?? entry.name).toLowerCase();
            if (!list.some(x => String(x.pokeDex_num ?? x.name).toLowerCase() === key)) {
                list.push(entry);
                await setCaught(list);
            }

            // Place into party (or storage if full)
            await placeNewCatchIntoPartyOrStorage(entry.uid);

            console.log(`Starter ${chosen.name} added to Pokédex + party.`);
        } catch (err) {
            console.error("Failed to add starter to dex/party:", err);
        }
    });


    // battle panel buttons
    $("#btnHome")?.addEventListener("click", showPicker);
    $("#btnStartBattle")?.addEventListener("click", startBattle);
    $("#btnPokeStop")?.addEventListener("click", openPokeStop);
    $("#migrateData")?.addEventListener("click", migrateOldStorage);
    document.addEventListener("click", (e) => {
        if (e.target.closest("#btnHome")) showPicker();
    });
    // fetch-more (enrich starter details)
    $("#fetchMore")?.addEventListener("click", async () => {
        const statusEl = $("#fetchMoreStatus"); if (statusEl) statusEl.textContent = "Fetching…";
        try {
            const { pickedPokemon } = await browser.storage.local.get("pickedPokemon");
            if (!pickedPokemon?.name) { if (statusEl) statusEl.textContent = "Pick a Pokémon first."; return; }
            const endpoint = GET_POKEMON(pickedPokemon.name);
            const json = await fetchJSONViaBG(endpoint);
            if (json?.status !== "success" || !json.data) { if (statusEl) statusEl.textContent = "No data."; return; }
            const d = json.data;
            const merged = {
                ...pickedPokemon,
                base_image: d.base_image ?? pickedPokemon.base_image,
                shiny_image: d.shiny_image ?? pickedPokemon.shiny_image,
                base_experience: d.base_experience ?? pickedPokemon.base_experience,
                types: Array.isArray(d.types) ? d.types : pickedPokemon.types,
                stats: Array.isArray(d.stats) ? d.stats : pickedPokemon.stats,
                moves: Array.isArray(d.moves) ? d.moves : pickedPokemon.moves,
                variants: Array.isArray(d.variants) ? d.variants : pickedPokemon.variants
            };
            await browser.storage.local.set({ pickedPokemon: merged });
            showResult(merged);
            if (statusEl) statusEl.textContent = "Updated from server.";
        } catch (e) {
            console.error(e);
            if (statusEl) statusEl.textContent = "Fetch failed.";
        }
    });

    // dev panel (optional)
    if (dev) {
        $("#btnAddOwned")?.addEventListener("click", () => toggleAddOwned(true));
        $("#addOwnedCancel")?.addEventListener("click", () => toggleAddOwned(false));
        $("#addOwnedSave")?.addEventListener("click", saveAddOwned);
        $("#devAddToDex")?.addEventListener("click", async () => {
            const s = $("#devAddStatus");
            try {
                const { pickedPokemon } = await browser.storage.local.get("pickedPokemon");
                if (!pickedPokemon) { if (s) s.textContent = "Pick first."; return; }
                const list = await getCaught();
                const key = String(pickedPokemon.pokeDex_num ?? pickedPokemon.name).toLowerCase();
                if (!list.some(x => String(x.pokeDex_num ?? x.name).toLowerCase() === key)) {
                    list.push(makeCaughtEntry(pickedPokemon));
                    await setCaught(list);
                }
                if (s) s.textContent = "Added to Pokédex.";
            } catch (e) {
                console.error(e);
                if (s) s.textContent = "Failed to add.";
            }
        });
    } else {
        $("#devPanel")?.remove();
        $("#dex-tools")?.classList.add("hidden");
        $("#addOwnedPanel")?.remove();
    }
    window.addEventListener('resize', applyCompactLayout);
    applyCompactLayout();
    // PokéStop ticker and coin display
    updatePokeStopStatus();
    initCoinDisplay();
    initSettings();
    if (!window.__pokestopTimer) {
        window.__pokestopTimer = setInterval(updatePokeStopStatus, 1000);
    }
}
init().catch(err => {
    console.error(err);
    $("#status").textContent = "Failed to load starters.json";
});
// js/sidebar.js
import { loadPokemonData } from "./pokemonData.js";
import { loadItemsAndMachines } from "./itemsMachines.js";
import {loadMovesData} from './moves.js';
const $ = (s, r = document) => r.querySelector(s);
let selectedBall = "poke"; // default
let __startersCache = null;
let __drag = null; 
let party = [];           // player's current party (max 6)
let wild = null;
let wMaxHP = 0;
let wHP = 0;
let pHP = 0;
let wildSleepTurns = 0;
let pokestopTimer = null;
/* =========================
   CONFIG
   ========================= */
// Need to add user input for username //
const API_BASE = "https://dstokesncstudio.com/pokeapi/pokeapi.php";
const GET_POKEMON = (name) => `${API_BASE}?action=getPokemon&name=${encodeURIComponent(String(name).toLowerCase())}`;
const dev = false;
const MAX_DEX = 1025;
const pokeData = await loadPokemonData();
const ItemsAndMachines = await loadItemsAndMachines();
const movesData = await loadMovesData();
const GET_POKEAPI_BY_ID = (id) => `https://pokeapi.co/api/v2/pokemon/${id}`;
const GET_POKEAPI_SPECIES = (idOrName) => `https://pokeapi.co/api/v2/pokemon-species/${idOrName}`;
const GET_POKEAPI_MON = (idOrName) => `https://pokeapi.co/api/v2/pokemon/${idOrName}`;
// ===== Party/Storage keys =====
const PARTY_KEY = "party";
const BOXES_KEY = "pcBoxes";
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
const LEGENDARY_IDS = [
    144, 145, 146, 150,
    243, 244, 245, 249, 250,
    377, 378, 379, 380, 381, 382, 383, 384,
    480, 481, 482, 483, 484, 485, 486, 487, 488,
    638, 639, 640, 641, 642, 643, 644, 645, 646,
    716, 717, 718,
    772, 773, 785, 786, 787, 788, 789, 790, 791, 792, 800,
    888, 889, 890, 891, 892, 894, 895, 896, 897, 898,
    1001, 1002, 1003, 1004,
    1007, 1008, 1009, 1010, 1024
];
const MYTHICAL_IDS = [
    151,
    251,
    385, 386,
    489, 490, 491, 492, 493,
    494, 647, 648, 649,
    719, 720, 721,
    801, 802, 807, 808, 809,
    893
];
const LEGENDARY_SET = new Set(LEGENDARY_IDS);
const MYTHICAL_SET = new Set(MYTHICAL_IDS);
const STORE = {
    coins: "coins",
    greatBalls: "greatBalls",
    ultraBalls: "ultraBalls",
    masterBalls: "masterBalls",
    cooldown: "pokestopCooldown",
};
const POTION_HEAL = {
    "potion": 20,
    "super-potion": 50,
    "hyper-potion": 120,
    "max-potion": 9999,
    "full-restore": 9999
};
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
    MainOnlineBattle: new Audio(
        "https://github.com/D-Stokes-NC-Gaming-Studio/pokemon-tampermonkey/raw/refs/heads/main/sounds/05%20Battle%20Dome%201.mp3"
    ),
};
const BALL_ITEM_MAP = {
    poke: "poke-ball",
    great: "great-ball",
    ultra: "ultra-ball",
    master: "master-ball"
};


async function getInventory() {
    const stored = await browser.storage.local.get("playerStats");
    let stats = stored.playerStats || [];

    let entry = stats.find(x => x[0] === "inventory");
    if (!entry) {
        entry = ["inventory", {}];
        stats.push(entry);
        await browser.storage.local.set({ playerStats: stats });
    }

    return entry[1]; // return inventory object
}
async function saveInventory(inv) {
    const stored = await browser.storage.local.get("playerStats");
    let stats = stored.playerStats || [];

    let entry = stats.find(x => x[0] === "inventory");
    if (!entry) {
        entry = ["inventory", inv];
        stats.push(entry);
    } else {
        entry[1] = inv;
    }

    await browser.storage.local.set({ playerStats: stats });
}

async function getBallCount(type) {
    const inv = await getInventory();
    const itemName = BALL_ITEM_MAP[type];
    if (!itemName) return 0;
    return inv[itemName] || 0;
}

async function setBallCount(type, newVal) {
    const inv = await getInventory();
    const itemName = BALL_ITEM_MAP[type];
    if (!itemName) return;

    inv[itemName] = Math.max(0, Number(newVal) || 0);

    await saveInventory(inv);
}

async function decBall(type) {
    const current = await getBallCount(type);
    await setBallCount(type, current - 1);
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
        const badge = root.querySelector(`.count-badge[data-ball="${t}"]`);
        const btn = badge?.closest(".item-btn");

        if (!badge || !btn) continue;

        badge.textContent = String(cnt);
        btn.classList.toggle("item-empty", cnt <= 0);
        btn.disabled = cnt <= 0;

        btn.classList.toggle("active", t === pick);
    }
}
async function updateBallSelect() {
    const select = $("#ballSelect");
    if (!select) return;

    const order = ["poke", "great", "ultra", "master"];

    for (const t of order) {
        const cnt = await getBallCount(t);
        const conf = BALLS[t];
        const opt = select.querySelector(`option[value="${t}"]`);

        if (opt) {
            opt.textContent = `${conf.icon} ${conf.label} (${cnt})`;
            opt.disabled = cnt <= 0;
            opt.selected = (t === selectedBall);
        }
    }
}
/*
========================
    Register User

*/
function initPasswordToggle() {
    const toggleBtn = document.getElementById("togglePassword");
    const pwdInput = document.getElementById("password");
    const icon = document.getElementById("togglePasswordIcon");

    if (!toggleBtn || !pwdInput || !icon) return;

    toggleBtn.addEventListener("click", () => {
        const isPwd = pwdInput.type === "password";
        pwdInput.type = isPwd ? "text" : "password";
        icon.classList.toggle("bi-eye-slash", !isPwd);
        icon.classList.toggle("bi-eye", isPwd);
    });
}
async function saveAuth(username, password) {
    await browser.storage.local.set({
        auth: { username, password }
    });

    // Store username ONLY
    localStorage.setItem("username", username);
    sessionStorage.setItem("username", username);

    // Do NOT store password here
}

async function loadAuth() {
    const r = await browser.storage.local.get("auth");
    return r.auth || null;
}

async function initLoginRegisterSystem() {
    return new Promise(async (resolve) => {

        // DOM Elements
        const loginSection     = $("#viewLoginRegister");
        const registerSection  = $("#viewRegister");
        const loginDiv         = $("#loginDiv");
        const registerDiv      = $("#registerDiv");

        const statusLogin      = $("#statusLogin");
        const statusRegister   = $("#statusRegister");

        const usernameInput    = $("#username");
        const passwordInput    = $("#password");
        const rememberMe       = $("#rememberMe");
        const loginBtn         = $("#loginBtn");

        const regUsername      = $("#reg_username");
        const regPassword      = $("#reg_password");
        const regPassword2     = $("#reg_password_confirm");
        const registerBtn      = $("#registerBtn");

        const registerMe       = $("#registerMe");
        const goToLoginLink    = $("#goToLoginLink");


        // -----------------------------------------------------------
        // HELPERS
        // -----------------------------------------------------------
        function showStatus(el, message, type = "info") {
            el.textContent = message;
            el.className = `small d-flex mb-3 text-${type} align-items-center justify-content-center`;
        }

        function showLogin() {
            registerSection.classList.add("hidden");
            loginSection.classList.remove("hidden");
            loginDiv.classList.remove("hidden");
        }

        function showRegister() {
            loginSection.classList.add("hidden");
            registerSection.classList.remove("hidden");
            registerDiv.classList.remove("hidden");
        }

        async function saveUser(username) {
            try {
                await browser.storage.local.set({ username });
            } catch {}

            localStorage.setItem("username", username);
            sessionStorage.setItem("username", username);
        }

        async function loadStoredUsername() {
            let stored = null;

            try {
                const r = await browser.storage.local.get("username");
                if (r.username) stored = r.username;
            } catch {}

            stored = stored || localStorage.getItem("username") || sessionStorage.getItem("username");
            // Prevent password from being mistaken as username
            if (stored && stored.length < 3) return null;
            if (stored && stored.includes("@")) return null;
            if (stored && stored.includes(" ")) return null;
            if (stored) sessionStorage.setItem("username", stored);
            
            return stored;
        }


        // -----------------------------------------------------------
        // BACKEND CALLS
        // -----------------------------------------------------------
        async function loginUser(username, password) {
            const res = await fetch(
                "https://dstokesncstudio.com/pokeBackend/api/loginUser.php",
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ username, password })
                }
            );

            return await res.json(); // { success: true/false }
        }

        // 🔹 Check if user exists
        async function checkUserExists(username) {
            console.log("checkUserExists sending:", username);

            const res = await fetch(
                "https://dstokesncstudio.com/pokeBackend/api/getUser.php",
                {
                    method: "GET",
                    headers: { "X-Session-User": username }
                }
            );

            const json = await res.json();
            console.log("checkUserExists response:", json);

            return json.success === true && json.data;
        }


        // 🔹 Register new user
        async function registerUser(username, password) {
            const res = await fetch(
                "https://dstokesncstudio.com/pokeBackend/api/registerUser.php",
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ username, password }),
                }
            );

            return await res.json();
        }



        // -----------------------------------------------------------
        // AUTO LOGIN IF USER EXISTS LOCALLY
        // -----------------------------------------------------------
        async function tryAutoLogin() {
            document.getElementById("viewLoginRegister").classList.add("hidden");
            const auth = await loadAuth();
            if (!auth) return null;

            const { username, password } = auth;

            // Ask backend to verify
            const res = await loginUser(username, password);

            if (res.success) {
                await migrateOldBallSystemToInventory();
                
                return username;
            }

            return null; // Incorrect password or account invalid
        }



        // -----------------------------------------------------------
        // EVENTS
        // -----------------------------------------------------------
        registerMe.addEventListener("click", (e) => {
            e.preventDefault();
            showRegister();
            showStatus(statusRegister, "Create your account", "info");
        });

        goToLoginLink.addEventListener("click", (e) => {
            e.preventDefault();
            showLogin();
            showStatus(statusLogin, "Welcome back!", "info");
        });


        // -----------------------------------------------------------
        // LOGIN BUTTON
        // -----------------------------------------------------------
        loginBtn.addEventListener("click", async () => {
            const username = usernameInput.value.trim();
            const password = passwordInput.value.trim();

            if (username.length < 3) {
                showStatus(statusLogin, "Username must be at least 3 characters.", "danger");
                return;
            }

            showStatus(statusLogin, "Checking account…", "info");

            const exists = await checkUserExists(username);

            if (!exists) {
                showStatus(statusLogin, "User not found. Please register.", "danger");
                return;
            }

            // SUCCESSFUL LOGIN
            await saveAuth(username, password);

            await migrateOldBallSystemToInventory();

            showStatus(statusLogin, `Welcome back, ${username}!`, "success");
            document.getElementById("viewLoginRegister").classList.add("hidden");
            resolve(username);
        });


        // -----------------------------------------------------------
        // REGISTER BUTTON
        // -----------------------------------------------------------
        registerBtn.addEventListener("click", async (e) => {
            e.preventDefault();
            const username = regUsername.value.trim();
            const password = regPassword.value.trim();
            const confirmPassword = regPassword2.value.trim();
            console.log("Sending to registerUser.php:", { username, password });
            if (password !== confirmPassword) {
                showStatus(statusRegister, "Passwords do not match.", "danger");
                return;
            }

            if (username.length < 3) {
                showStatus(statusRegister, "Username must be at least 3 characters.", "danger");
                return;
            }

            showStatus(statusRegister, "Checking username…", "info");

            // ❗ Correct: check if username exists in backend
            const exists = await checkUserExists(username);

            if (exists) {
                showStatus(statusRegister, "Username already taken.", "danger");
                return;
            }

            showStatus(statusRegister, "Creating account…", "info");

            // Try register user
            const res = await registerUser(username, password);

            if (!res.success) {
                showStatus(statusRegister, res.error || "Error creating account.", "danger");
                return;
            }

            // Store auth locally for auto-login later
            await saveAuth(username, password);

            showStatus(statusRegister, "Account created! Please log in.", "success");

            // Move back to login
            usernameInput.value = username;
            showLogin();
            showStatus(statusLogin, "Account created! Please log in.", "success");
        });



        // -----------------------------------------------------------
        // INITIAL PAGE LOAD
        // -----------------------------------------------------------
        const autoAuth = await loadAuth();
        if (autoAuth?.username && autoAuth?.password?.length >= 6) {
            const auto = await tryAutoLogin();
            if (auto) resolve(auto);
            return;

        }
        

        const stored = await loadStoredUsername();
        if (stored) {
            usernameInput.value = stored;
            showLogin();
            showStatus(statusLogin, `Welcome back, ${stored}!`, "success");
        } else {
            showRegister();
            showStatus(statusRegister, "Create your account", "info");
        }
    });
}
async function promptUsernameAndRegister() {
    // ✅ Try persistent sources first
    let username =
        (await browser.storage.local.get("username")).username ||
        localStorage.getItem("username") ||
        sessionStorage.getItem("username");

    // 🧠 If found, reuse without asking
    if (username) {
        console.log("Loaded username:", username);
        sessionStorage.setItem("username", username); // restore to session for convenience
        return username;
    }

    // 🚀 Ask only if no username found anywhere
    username = prompt("🎮 Choose a unique username to start your Pokémon adventure:");
    if (!username || username.trim().length < 3) {
        alert("Please enter a username with at least 3 characters.");
        return promptUsernameAndRegister();
    }

    username = username.trim();

    try {
        const getUserName = await fetch("https://dstokesncstudio.com/pokeBackend/getUser.php", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username }),
        });
        const userJson = await getUserName.json;

        if (userJson.success || userJson.status === "success") {
            console.log("✅ Registered:", userJson.username || username);
            // Save persistently
            await browser.storage.local.set({ username });
            localStorage.setItem("username", username);
            sessionStorage.setItem("username", username);
            return username;
        } else {
            const res = await fetch("https://dstokesncstudio.com/pokeBackend/api/registerUser.php", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ username }),
            });

            const json = await res.json();

            if (json.success || json.status === "success") {
                console.log("✅ Registered:", json.username || username);
                // Save persistently
                await browser.storage.local.set({ username });
                localStorage.setItem("username", username);
                sessionStorage.setItem("username", username);
                return username;
            } else if (json.message?.includes("taken")) {
                alert("❌ Username already taken! Try another.");
                return promptUsernameAndRegister();
            } else {
                alert("⚠️ " + json.message);
                return promptUsernameAndRegister();
            }
        }


    } catch (err) {
        console.error("Registration failed:", err);
        alert("Failed to connect to server.");
    }

    return null;
}
async function syncUserDataToBackend() {
    const { username } = await browser.storage.local.get("username");
    if (!username) return;

    const keys = [
        "audioEnabled", "audioVolume",
        "ballPool", "caught", "party", "pcBoxes", "pickedPokemon",
        "playerStats", "lastEncounter",
        "pokestopCooldown", "coins"
    ];
    const data = await browser.storage.local.get(keys);

    // quick type safety
    data.audioEnabled = !!data.audioEnabled;
    data.audioVolume = Number.isFinite(+data.audioVolume) ? +data.audioVolume : 0.5;
    data.pokestopCooldown = Number.isFinite(+data.pokestopCooldown) ? +data.pokestopCooldown : 0;
    data.coins = Number.isFinite(+data.coins) ? +data.coins : 0;

    await fetch("https://dstokesncstudio.com/pokeBackend/api/updateUser.php", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "X-Session-User": username
        },
        body: JSON.stringify(data)
    }).then(r => r.json()).then(j => {
        if (!j.success) console.warn("Sync failed:", j);
    }).catch(err => console.error("Sync error:", err));
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
    runAway();
    $("#viewPicker")?.classList.remove("hidden");
    $("#resultCard")?.classList.toggle("hidden", !window.__hasResult);
    $("#viewDex")?.classList.add("hidden");
    $("#viewBattle")?.classList.add("hidden");
    $("#viewParty")?.classList.add("hidden");
    $("#viewSettings")?.classList.add("hidden");
    $("#viewOnlineBattle")?.classList.add("hidden");
    $("#viewStore")?.classList.add("hidden");
    if (wild) endBattle();
    playSound("stop", false);
}
function showDex() {
    runAway();
    $("#viewPicker")?.classList.add("hidden");
    $("#resultCard")?.classList.add("hidden");
    $("#viewDex")?.classList.remove("hidden");
    $("#viewSettings")?.classList.add("hidden");
    $("#viewParty")?.classList.add("hidden");
    $("#viewBattle")?.classList.add("hidden");
    $("#viewOnlineBattle")?.classList.add("hidden");
    $("#viewStore")?.classList.add("hidden");
    playSound("stop", false);
}
function showBattle() {
    runAway();
    $("#viewPicker")?.classList.add("hidden");
    $("#resultCard")?.classList.add("hidden");
    $("#viewDex")?.classList.add("hidden");
    $("#viewBattle")?.classList.remove("hidden");
    $("#viewParty")?.classList.add("hidden");
    $("#viewSettings")?.classList.add("hidden");
    $("#viewOnlineBattle")?.classList.add("hidden");
    $("#viewStore")?.classList.add("hidden");
    
    playSound("stop");
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
        img.alt = p.name || "pokemon";
        img.style.width = "64px";
        img.style.height = "auto";
        img.style.imageRendering = "pixelated";

        // Primary source: PokeAPI home sprite (if we have a dex number)
        if (p.pokeDex_num) {
            img.src = `https://github.com/PokeAPI/sprites/blob/master/sprites/pokemon/other/home/${p.pokeDex_num}.png?raw=true`;
        } else if (p.base_image || p.shiny_image) {
            // No dex number, use base/shiny directly
            img.src = p.base_image || p.shiny_image;
        } else {
            img.src = ""; // or some default placeholder
        }

        // Fallback if PokeAPI sprite fails to load
        img.onerror = () => {
            if (p.base_image || p.shiny_image) {
                img.onerror = null; // prevent infinite loop
                img.src = p.base_image || p.shiny_image;
            }
        };

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
    runAway();
    document.querySelector("#viewPicker")?.classList.add("hidden");
    document.querySelector("#resultCard")?.classList.add("hidden");
    document.querySelector("#viewBattle")?.classList.add("hidden");
    document.querySelector("#viewParty")?.classList.add("hidden");
    document.querySelector("#viewDex")?.classList.remove("hidden");
    document.querySelector("#viewSettings")?.classList.add("hidden");
    $("#viewStore")?.classList.add("hidden");
    $("#viewOnlineBattle")?.classList.add("hidden");
    playSound("stop");

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
    await syncUserDataToBackend();
}
/* =========================
   ENCOUNTER STATE
   ========================= */

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
    if (MYTHICAL_SET.has(num)) return "mythical";   // or "legendary" if you want them merged
    if (LEGENDARY_SET.has(num)) return "legendary";

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
    syncUserDataToBackend();
    const status = $("#battleStatus"); if (status) status.textContent = "";
}
/*
    ==================================================================
    |    BATTLE: EVOLUTION CHECK                                     |
    |    Try to evolve player mon if level-up requirements are met.  |
    |    Returns { evolved: boolean, oldName, newName }.             |
    ==================================================================
*/
/**
 * Get moves for a given Pokémon in a specific version group.
 * Defaults to Scarlet/Violet and level-up moves only.
 */
function getMovesForVersion(pokemonName, {
    versionGroup = "scarlet-violet",
    methods = ["level-up"]   // pass null to allow all methods
} = {}) {
    const mon = pokeData[pokemonName];
    if (!mon || !mon.moves) return [];

    const result = [];

    for (const [moveName, entries] of Object.entries(mon.moves)) {
        // entries is the array like [{ level_learned_at, move_learn_method, version_group }, ...]
        const match = entries.find(e =>
            e.version_group === versionGroup &&
            (!methods || methods.includes(e.move_learn_method))
        );

        if (!match) continue;

        result.push({
            moveName,                      // "razor-wind"
            level: match.level_learned_at, // the level for that version
            method: match.move_learn_method
        });
    }

    // sort by level learned
    result.sort((a, b) => a.level - b.level);
    console.log(result);
    return result;
}

function getMoveLevelForScarletViolet(pokemonName, moveName) {
    const mon = pokeData[pokemonName];
    if (!mon || !mon.moves || !mon.moves[moveName]) return null;

    const entry = mon.moves[moveName].find(
        e => e.version_group === "scarlet-violet"
    );
    return entry ? entry.level_learned_at : null;
}
// Return only moves the Pokémon can learn in Scarlet/Violet
// at or below the given level, via level-up.
function getLearnableMovesForScarletViolet(pokemonName, currentLevel) {
    if (!pokemonName) return [];

    const normName = String(pokemonName).toLowerCase();

    // Use your existing helper
    const all = getMovesForVersion(normName, {
        versionGroup: "scarlet-violet",
        methods: ["level-up"]
    });

    // Only moves at or below the current level
    return all.filter(m => (m.level || 1) <= currentLevel);
}

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
async function openMoveSelector(player) {
    const moves = Array.isArray(player.moves) ? player.moves : [];

    if (!moves.length) {
        renderBattle("This Pokémon has no learned moves!");
        return;
    }

    let html = `<h3>Select a Move</h3>`;

    for (const mv of moves) {
        const safeName = mv.name || "unknown-move";

        html += `
            <button class="btn btn-primary btn-sm w-100 mb-2 move-btn" 
                    data-move="${safeName}">
                ${safeName.replace(/-/g, " ")} (PP ${mv.pp ?? 0})
            </button>
        `;
    }

    // Insert into the correct modal
    const body = document.getElementById("battleMoveBody");
    if (!body) return;
    body.innerHTML = html;

    // Attach useMove()
    body.querySelectorAll(".move-btn").forEach(btn => {
        btn.addEventListener("click", async () => {
            const move = btn.dataset.move;
            await useMove(move);   // ← proper battle attack
        });
    });

    bootstrap.Modal.getOrCreateInstance(
        document.getElementById("battleMoveModal")
    ).show();
}


async function useMove(moveName) {
    const player = await getPlayerMon();
    if (!player) return;

    // 🔹 Close the modal if open
    try {
        const modalEl = document.getElementById("battleMoveModal");
        const instance = bootstrap.Modal.getInstance(modalEl);
        if (instance) instance.hide();
    } catch {}

    // Ensure we have a moves array
    const moves = Array.isArray(player.moves) ? player.moves : [];
    const move = moves.find(m => m.name === moveName);

    if (!move) {
        renderBattle(`${player.name} doesn’t know ${formatMoveName(moveName)}!`);
        return;
    }

    // Guard PP
    if (typeof move.pp !== "number") {
        move.pp = move.pp ?? 10;
    }

    if (move.pp <= 0) {
        renderBattle(`${player.name} has no PP left for ${formatMoveName(move.name)}!`);
        return;
    }

    // Accuracy check
    const accuracy = typeof move.accuracy === "number" ? move.accuracy : 100;
    const roll = Math.random() * 100;

    // Spend 1 PP
    move.pp = Math.max(0, move.pp - 1);

    // Save updated PP list
    player.moves = moves;
    await setPlayerMon(player);

    if (roll > accuracy) {
        renderBattle(`${player.name} used ${formatMoveName(move.name)}, but it missed!`);
        setTimeout(wildAttack, 800);
        return;
    }

    // Damage using move power or fallback to 40
    const basePower = (typeof move.power === "number" && move.power > 0) ? move.power : 40;
    const dmg = calcDamage(player, wild, basePower);

    wHP = Math.max(0, wHP - dmg);
    wild.currentHP = wHP;
    await setLastEncounter(wild);

    if (wHP <= 0) {
        const { gain, leveled, level } = await grantExpForWin(wild);
        renderBattle(
            `${player.name} used ${formatMoveName(move.name)}! ` +
            `${wild.name} fainted! +${gain} EXP${leveled ? ` ⬆️ Lv ${level}!` : ""}`
        );
        setTimeout(() => endBattle("You won! Start another battle."), 5000);
        return;
    }

    // Wild counterattacks
    renderBattle(
        `${player.name} used ${formatMoveName(move.name)}! It dealt ${dmg} damage!`
    );

    setTimeout(wildAttack, 800);
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
            ? `hhttps://raw.githubusercontent.com/PokeAPI/sprites/refs/heads/master/sprites/pokemon/other/showdown/shiny/${id}.gif`
            : `https://raw.githubusercontent.com/PokeAPI/sprites/refs/heads/master/sprites/pokemon/other/showdown/${id}.gif`;

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
        await syncUserDataToBackend();
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
    const panel = $("#battlePanel");
    if (!panel) return;
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
    const inv = await getInventory();

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

    const expLine = `<div class='tiny muted'>EXP ${player.exp || 0} / ${player.expToNext || expToNext(player.level)}</div>`;

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

    // ===========================================
    // CONTROLS
    // ===========================================
    const ctl = document.createElement("div");
    ctl.className = "battle-ctl";

    // ==== MOVES BUTTON ====
    const bMoves = document.createElement("button");
    bMoves.className = "btn btn-success btn-sm";
    bMoves.textContent = "📝 Moves";
    bMoves.onclick = () => openMoveSelector(player);
    ctl.appendChild(bMoves);

    // ====== Attack (old auto-attack)
    const bAtk = document.createElement("button");
    bAtk.className = "btn btn-success btn-sm disabled";
    bAtk.textContent = "⚔️ Attack";
    bAtk.onclick = playerAttack;
    ctl.appendChild(bAtk);

    // ====== Ball Button
    const bBall = document.createElement("button");
    bBall.className = "btn btn-success btn-sm";
    bBall.textContent = "⭕ Ball";
    bBall.onclick = throwBall;
    ctl.appendChild(bBall);

    // ====== Potion logic
    const totalPotions = Object.entries(inv)
        .filter(([k, v]) => POTION_HEAL[k])
        .reduce((a, [k, v]) => a + v, 0);

    const bPot = document.createElement("button");
    bPot.className = "btn btn-success btn-sm";
    bPot.textContent = `🧪 Potion`;
    bPot.onclick = () => usePotion(selectedPotion);
    bPot.disabled = totalPotions <= 0;
    ctl.appendChild(bPot);

    // ====== Run Button
    const bRun = document.createElement("button");
    bRun.className = "btn btn-success btn-sm";
    bRun.textContent = "🏃 Run";
    bRun.onclick = runAway;
    ctl.appendChild(bRun);

    // ====== Sleep Powder
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

    // ===========================================
    // Ball Selector
    // ===========================================
    const ballRow = document.createElement("div");
    ballRow.className = "tiny";
    Object.assign(ballRow.style, {
        display: "flex",
        alignItems: "center",
        gap: "6px"
    });

    const ballLabel = document.createElement("label");
    ballLabel.textContent = "Poké Ball:";
    ballLabel.style.opacity = "0.8";

    const select = document.createElement("select");
    select.id = "ballSelect";
    select.className = "input";
    select.style.flex = "1";

    (async () => {
        for (const t of ["poke", "great", "ultra", "master"]) {
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

    // ===========================================
    // Potion Selector
    // ===========================================
    const potionRow = document.createElement("div");
    potionRow.className = "tiny";
    Object.assign(potionRow.style, {
        display: "flex",
        alignItems: "center",
        gap: "6px",
        marginTop: "4px"
    });

    const potionLabel = document.createElement("label");
    potionLabel.textContent = "Potion:";
    potionLabel.style.opacity = "0.8";

    const potSelect = document.createElement("select");
    potSelect.id = "potionSelect";
    potSelect.className = "input";
    potSelect.style.flex = "1";

    let selectedPotion = null;
    for (const [name, qty] of Object.entries(inv)) {
        if (!POTION_HEAL[name]) continue;

        const opt = document.createElement("option");
        opt.value = name;
        opt.textContent = `${name.replace(/-/g, " ")} (${qty})`;
        potSelect.appendChild(opt);

        if (!selectedPotion) selectedPotion = name;
    }

    if (!selectedPotion) {
        const opt = document.createElement("option");
        opt.textContent = "No potions";
        potSelect.appendChild(opt);
        potSelect.disabled = true;
    }

    potSelect.onchange = () => selectedPotion = potSelect.value;

    potionRow.append(potionLabel, potSelect);
    ctl.appendChild(potionRow);

    // ===========================================
    // Final layout
    // ===========================================
    await updateBallSelect();
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
    const inv = await getInventory();

    // Which potion do we try?
    const potionOrder = [
        "full-restore",
        "max-potion",
        "hyper-potion",
        "super-potion",
        "potion"
    ];

    let chosen = null;

    for (const p of potionOrder) {
        if ((inv[p] || 0) > 0) {
            chosen = p;
            break;
        }
    }

    if (!chosen) {
        renderBattle("You have no healing items!");
        setTimeout(wildAttack, 500);
        return;
    }

    const heal = POTION_HEAL[chosen] || 20;
    const player = await getPlayerMon();
    const oldHP = player.currentHP;

    player.currentHP = Math.min(player.stats.hp, oldHP + heal);

    inv[chosen]--;
    if (inv[chosen] <= 0) delete inv[chosen];

    await saveInventory(inv);
    await setPlayerMon(player);

    renderBattle(`Used ${chosen.replace(/-/g, " ")}! HP restored.`);
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

// Format remaining cooldown as mm:ss
function fmtTime(ms) {
    const m = Math.floor(ms / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
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

    //-------------------------------------------------------
    // ALWAYS load the SAME inventory format as shop
    //-------------------------------------------------------
    const inv = await getInventory();   // <-- uses your array format

    //-------------------------------------------------------
    // COINS
    //-------------------------------------------------------
    const coinAmount = Math.floor(Math.random() * 91) + 10;
    const prevCoins = await getNum(STORE.coins, 0);
    await setNum(STORE.coins, prevCoins + coinAmount);

    //-------------------------------------------------------
    // BALLS (weighted)
    //-------------------------------------------------------
    const roll = Math.random();
    let itemKey = "poke-ball";

    if (roll > 0.75 && roll <= 0.95) itemKey = "great-ball";
    else if (roll > 0.95) itemKey = "ultra-ball";

    const ballAmount = 1 + Math.floor(Math.random() * 5);
    inv[itemKey] = (inv[itemKey] || 0) + ballAmount;

    //-------------------------------------------------------
    // POTIONS (30%)
    //-------------------------------------------------------
    let potionLine = "";
    if (Math.random() < 0.30) {
        const pots = 1 + Math.floor(Math.random() * 3);

        inv["potion"] = (inv["potion"] || 0) + pots;
        potionLine = `\n🧪 +${pots} Potion${pots > 1 ? "s" : ""}`;
    }

    //-------------------------------------------------------
    // MASTER BALL (2.5%)
    //-------------------------------------------------------
    let masterLine = "";
    if (Math.random() < 0.025) {
        inv["master-ball"] = (inv["master-ball"] || 0) + 1;
        masterLine = `\n🎱 +1 Master Ball!`;
    }

    //-------------------------------------------------------
    // SAVE using the shop's system
    //-------------------------------------------------------
    await saveInventory(inv);   // <-- correct: updates playerStats array

    if (!$("#viewBattle")?.classList.contains("hidden")) {
        await updateBallSelect();
    }

    //-------------------------------------------------------
    // Toast message
    //-------------------------------------------------------
    const prettyName =
        itemKey === "poke-ball" ? "Poké Ball" :
        itemKey === "great-ball" ? "Great Ball" :
        itemKey === "ultra-ball" ? "Ultra Ball" : "Item";

    toast(
        `📍 PokéStop Reward:\n\n` +
        `🪙 +${coinAmount} Coins\n` +
        `🎁 +${ballAmount} ${prettyName}` +
        potionLine +
        masterLine
    );

    //-------------------------------------------------------
    // Cooldown (1–5 minutes)
    //-------------------------------------------------------
    const cooldownMs = (1 + Math.floor(Math.random() * 5)) * 60 * 1000;
    await setNum(STORE.cooldown, now + cooldownMs);

    if (!pokestopTimer) {
        pokestopTimer = setInterval(updatePokeStopStatus, 1000);
    }
    updatePokeStopStatus();

    await syncUserDataToBackend();
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
    try {
        $("#status").textContent = "Loading starters…";

        // Load and pick 3 unique starters
        const list = await loadStarters();
        const unique = new Map(list.map(p => [String(p.pokeDex_num ?? p.name), p]));
        const pool = shuffle(Array.from(unique.values())).slice(0, 3);

        // Save to local storage
        await browser.storage.local.set({ ballPool: pool });

        // 🆕 Immediately sync new starter data to backend
        await syncUserDataToBackend();

        // Render the 3 Poké Balls
        renderThreeBalls(pool);

        $("#status").textContent = "Choose a Poké Ball:";
        console.log("🎲 Starter pool generated and synced to backend.");
    } catch (err) {
        console.error("❌ Failed to roll starters:", err);
        $("#status").textContent = "Failed to load starters.";
    }
}
function applyCompactLayout() {
    const compact = document.documentElement.clientWidth <= 360;
    document.body.classList.toggle('compact', compact);
}
function openSettings() {
    runAway();
    $('#resultCard')?.classList.add("hidden");
    $("#viewBattle")?.classList.add("hidden");
    $("#viewDex")?.classList.add("hidden");
    $("#viewPicker")?.classList.add("hidden");
    $("#viewParty")?.classList.add("hidden");
    $("#viewSettings")?.classList.remove("hidden");
    $("#viewOnlineBattle")?.classList.add("hidden");
    $("#viewStore")?.classList.add("hidden");
    playSound("stop");

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
        toast({ title: "Settings", message: "Audio settings saved!", type: "success" });
        syncUserDataToBackend();
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
// Keep references to looped sounds so we can stop them
const ACTIVE_SOUNDS = {};
const ACTIVE_LOOPING_SOUNDS = {};
async function playSound(key, loop = false) {
    const audio = SOUNDS[key];
    if (key === "stop") {
        stopAllSounds();
        return;
    }

    if (!audio) {
        console.warn("[Audio] No sound for key:", key);
        return;
    }

    if (!await getBool("soundEnabled", true)) return;

    const volume = await getVolume();
    const finalVolume = Math.min(1, Math.max(0, volume));

    // 🔁 LOOPING SOUND
    if (loop) {
        // If already looping, just resume
        if (ACTIVE_LOOPING_SOUNDS[key]) {
            let a = ACTIVE_LOOPING_SOUNDS[key];
            a.volume = finalVolume;
            if (a.paused) a.play().catch(err => console.warn(err));
            return a;
        }

        // Create new instance
        const instance = audio.cloneNode();
        instance.volume = finalVolume;
        instance.loop = true;

        try {
            await instance.play();
        } catch (e) {
            console.warn("[Audio Loop] play error:", e);
        }

        ACTIVE_LOOPING_SOUNDS[key] = instance;
        return instance;
    }

    // 🎵 ONE-SHOT SOUND
    const instance = audio.cloneNode();
    instance.volume = finalVolume;
    instance.loop = false;

    try {
        await instance.play();
    } catch (e) {
        console.warn("[Audio] play error:", e);
        return;
    }

    // Track it until it ends
    ACTIVE_SOUNDS[key] = instance;
    instance.onended = () => delete ACTIVE_SOUNDS[key];

    return instance;
}
function stopSound(key) {
    // Stop looping
    if (ACTIVE_LOOPING_SOUNDS[key]) {
        const a = ACTIVE_LOOPING_SOUNDS[key];
        try {
            a.pause();
            a.currentTime = 0;
        } catch { }
        delete ACTIVE_LOOPING_SOUNDS[key];
    }

    // Stop any active one-shot
    if (ACTIVE_SOUNDS[key]) {
        const a = ACTIVE_SOUNDS[key];
        try {
            a.pause();
            a.currentTime = 0;
        } catch { }
        delete ACTIVE_SOUNDS[key];
    }
}
function stopAllSounds() {
    // Stop all looped audio
    for (const k in ACTIVE_LOOPING_SOUNDS) stopSound(k);

    // Stop all one-shots
    for (const k in ACTIVE_SOUNDS) stopSound(k);
}
/* =========================
    PARTY & STORAGE BOXES
    ========================= 
*/
// Initialize default PC boxes if missing
async function loadPartyAndBoxes() {
    const { party, pcBoxes } = await browser.storage.local.get(["party", "pcBoxes"]);

    const safeParty = Array.isArray(party) ? party : [];

    let boxes = pcBoxes;

    // 🩹 Fix or initialize missing structure
    let changed = false;
    if (!boxes || typeof boxes !== "object" || !Array.isArray(boxes.boxes)) {
        boxes = {
            current: 0,
            boxes: [{ name: "Box 1", slots: new Array(30).fill(null) }]
        };
        changed = true;
    } else {
        if (!Array.isArray(boxes.boxes)) {
            boxes.boxes = [{ name: "Box 1", slots: new Array(30).fill(null) }];
            changed = true;
        }
        if (boxes.boxes.length === 0) {
            boxes.boxes.push({ name: "Box 1", slots: new Array(30).fill(null) });
            changed = true;
        }
        for (const box of boxes.boxes) {
            if (!Array.isArray(box.slots)) {
                box.slots = new Array(30).fill(null);
                changed = true;
            }
        }
        if (typeof boxes.current !== "number" || boxes.current < 0 || boxes.current >= boxes.boxes.length) {
            boxes.current = 0;
            changed = true;
        }
    }

    // 🔄 Persist repair immediately
    if (changed) {
        await browser.storage.local.set({ pcBoxes: boxes });
    }

    return { party: safeParty, boxes };
}

function compactParty(party) {
    return party.filter(Boolean).slice(0, 6);
}
async function saveParty(party) {
    const compacted = compactParty(party);
    await browser.storage.local.set({ [PARTY_KEY]: compacted });
}
// Ensure saved structure is valid
async function saveBoxes(boxes) {
    if (!boxes || !Array.isArray(boxes.boxes)) {
        boxes = { current: 0, boxes: [{ name: "Box 1", slots: new Array(30).fill(null) }] };
    }
    // Make sure slots exist for each box
    for (const box of boxes.boxes) {
        if (!Array.isArray(box.slots)) box.slots = new Array(30).fill(null);
    }
    await browser.storage.local.set({ pcBoxes: boxes });
}
// Utility: first empty slot index in the current box (or -1)
function firstEmptySlot(slots) {
    return Array.isArray(slots) ? slots.findIndex(s => s === null) : -1;
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
    const [caught, pbRaw] = await Promise.all([
        getCaughtWithUID(),
        loadPartyAndBoxes()
    ]);

    // ✅ Safety: make sure pb structure is valid
    const pb = {
        party: Array.isArray(pbRaw.party) ? pbRaw.party : [],
        boxes: pbRaw.boxes && Array.isArray(pbRaw.boxes.boxes)
            ? pbRaw.boxes
            : {
                current: 0,
                boxes: [
                    { name: "Box 1", slots: new Array(30).fill(null) }
                ]
            }
    };

    // ✅ Ensure current box index is valid
    if (pb.boxes.current >= pb.boxes.boxes.length) pb.boxes.current = 0;
    if (!Array.isArray(pb.boxes.boxes[pb.boxes.current].slots)) {
        pb.boxes.boxes[pb.boxes.current].slots = new Array(30).fill(null);
    }

    const byUID = mapCaughtByUID(caught);

    // ========================
    // 🧩 PARTY GRID
    // ========================
    const partyGrid = document.getElementById("partyGrid");
    if (!partyGrid) return console.warn("No #partyGrid element found!");
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
                slot.classList.add("empty");
            }
        }

        // Drop into party slot i
        wireSlotDnD(slot, async (drag) => {
            const { party, boxes } = await loadPartyAndBoxes();
            if (drag.from === "party") {
                const uidA = party[drag.index] || null;
                const uidB = party[i] || null;
                party[i] = uidA;
                if (drag.index !== i) party[drag.index] = uidB || null;
                await saveParty(party);
            } else {
                const slots = boxes.boxes[boxes.current].slots;
                const moving = slots[drag.index];
                const replaced = party[i] || null;
                party[i] = moving || null;
                slots[drag.index] = replaced || null;
                await Promise.all([saveParty(party), saveBoxes(boxes)]);
            }
            // 🟢 Sync with backend
            try {
                await syncUserDataToBackend();
                console.log("[Sync] Party/Storage update pushed to backend.");
            } catch (err) {
                console.warn("[Sync] Failed to push update:", err);
            }
            // ✅ Always re-render after any update
            renderPartyAndStorage();
        });

        partyGrid.appendChild(slot);
    }

    // ========================
    // 📦 STORAGE BOX GRID
    // ========================
    const boxTitle = document.getElementById("boxTitle");
    if (boxTitle) {
        const curBox = pb.boxes.boxes[pb.boxes.current];
        boxTitle.textContent = curBox.name || `Box ${pb.boxes.current + 1}`;
    }

    const storageGrid = document.getElementById("storageGrid");
    if (!storageGrid) return console.warn("No #storageGrid element found!");
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
                party.splice(drag.index, 1);
                if (replaced) party.push(replaced);

                await Promise.all([saveParty(party), saveBoxes(boxes)]);
            } else {
                const a = drag.index, b = i;
                const tmp = destSlots[a];
                destSlots[a] = destSlots[b];
                destSlots[b] = tmp;
                await saveBoxes(boxes);
            }
            // 🟢 Sync with backend
            try {
                await syncUserDataToBackend();
                console.log("[Sync] Box update pushed to backend.");
            } catch (err) {
                console.warn("[Sync] Failed to push update:", err);
            }
            renderPartyAndStorage();
        });

        storageGrid.appendChild(slot);
    }
}
async function openPartyView() {
    // View switching
    runAway();
    document.getElementById("viewPicker")?.classList.add("hidden");
    document.getElementById("resultCard")?.classList.add("hidden");
    document.getElementById("viewBattle")?.classList.add("hidden");
    document.getElementById("viewDex")?.classList.add("hidden");
    document.getElementById("viewSettings")?.classList?.add("hidden");
    document.getElementById("viewParty")?.classList.remove("hidden");
    $("#viewOnlineBattle")?.classList.add("hidden");
    $("#viewStore")?.classList.add("hidden");
    playSound("stop");

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

    // 🧩 Ensure at least one valid box
    if (!boxes.boxes || boxes.boxes.length === 0) {
        boxes.boxes = [{ name: "Box 1", slots: new Array(30).fill(null) }];
        boxes.current = 0;
        await saveBoxes(boxes);
    }

    if (party.length < 6) {
        party.push(caughtUID);
        await saveParty(party);
    } else {
        let currentBox = boxes.boxes[boxes.current];
        if (!currentBox || !Array.isArray(currentBox.slots)) {
            currentBox = { name: `Box ${boxes.boxes.length + 1}`, slots: new Array(30).fill(null) };
            boxes.boxes.push(currentBox);
            boxes.current = boxes.boxes.length - 1;
        }

        let idx = firstEmptySlot(currentBox.slots);
        if (idx === -1) {
            const newBox = { name: `Box ${boxes.boxes.length + 1}`, slots: new Array(30).fill(null) };
            boxes.boxes.push(newBox);
            boxes.current = boxes.boxes.length - 1;
            idx = 0;
        }

        currentBox.slots[idx] = caughtUID;
        await saveBoxes(boxes);
    }

    // 🖼 Optional immediate UI + sync
    if (!document.getElementById("viewParty")?.classList.contains("hidden")) {
        await renderPartyAndStorage();
    }

    // ✅ Immediately persist to backend if username exists
    const { username } = await browser.storage.local.get("username");
    if (username) {
        await syncUserDataToBackend(username);
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
            { name: "potion", image: "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/potion.png" },
            { name: "superpotion", image: "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/super-potion.png" },
            { name: "hyperpotion", image: "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/hyper-potion.png" },
            { name: "maxpotion", image: "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/max-potion.png" },
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
/* =========================
    Online Battle
    ========================= 
*/
function openOnlineBattleView() {
    runAway();
    // Hide other main views
    document.getElementById("viewLoginRegister")?.classList.add("hidden");
    document.getElementById("viewRegister")?.classList.add("hidden");
    document.getElementById("viewDex")?.classList.add("hidden");
    document.getElementById("viewBattle")?.classList.add("hidden");
    document.getElementById("viewPicker")?.classList.add("hidden");
    document.getElementById("resultCard")?.classList.add("hidden");
    $("#viewSettings")?.classList.add("hidden");
    $("#viewParty")?.classList.add("hidden");
    $("#viewStore")?.classList.add("hidden");
    // ^ adjust to whatever main views you actually use

    // Show Online Battle view
    const battleView = document.getElementById("viewOnlineBattle");
    if (battleView) {
        battleView.classList.remove("hidden");
    }

    playSound("MainOnlineBattle", true);
}
/* =========================
    Save Data to Backend
    ========================= 
*/
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

    if (!typeof store.greatBalls === "number") {
        await browser.storage.local.set({ greatBalls: 0 });
    }
    if (!typeof store.ultraBalls === "number") {
        await browser.storage.local.set({ ultraBalls: 0 });
    }
    if (!typeof store.masterBalls === "number") {
        await browser.storage.local.set({ masterBalls: 0 });
    }
    await loadPartyAndBoxes(); // triggers auto-repair and saveBoxes
    toast("Storage migration complete.");
    console.log("[migrateOldStorage] Migration complete.");
}
/* 
    ========================
        Open Store
    ========================
*/
function searchItems(query, items) {
    if (!query) return items;
    const q = query.trim().toLowerCase();
    return items.filter(it => it.name && it.name.toLowerCase().includes(q));
}
function filterStoreByCategory(category, items) {
    if (!category) return items;
    const cat = category.toLowerCase();

    return items.filter(it => {
        const itemCat = (it.category || "").toLowerCase();
        if (!itemCat) return false;

        if (cat === "balls") {
            return itemCat.includes("ball");
        }
        return itemCat === cat;
    });
}
async function openStore() {
    hideAllViews();

    const view = document.getElementById("viewStore");
    if (!view) {
        console.error("#viewStore not found in DOM");
        return;
    }
    view.classList.remove("hidden");

    const data = await loadItemsAndMachines();
    if (!data || !data.items) {
        const storeItemsErr = document.getElementById("storeItems");
        if (storeItemsErr) {
            storeItemsErr.innerHTML =
                `<div class="text-danger">Failed to load items.</div>`;
        }
        return;
    }

    // Only items that actually cost something
    let baseItems = Object.values(data.items).filter(it =>
        typeof it.cost === "number" && it.cost > 0
    );

    const searchInput = document.getElementById("storeSearch");
    const categorySelect = document.getElementById("storeCategory");
    const storeItems = document.getElementById("storeItems");

    if (!storeItems) {
        console.error("#storeItems not found");
        return;
    }

    // Ensure 4-column grid on md+
    storeItems.classList.add("row", "row-cols-2", "row-cols-md-4", "g-2");

    function renderStore() {
        let filtered = searchItems(searchInput?.value || "", baseItems);
        filtered = filterStoreByCategory(categorySelect?.value || "", filtered);

        storeItems.innerHTML = "";

        if (filtered.length === 0) {
            storeItems.innerHTML = `<div class="text-muted">No items found.</div>`;
            return;
        }

        for (const item of filtered) {
            // Column wrapper
            const col = document.createElement("div");
            col.className = "col mb-2";
            col.style.width = "130px";
            const card = document.createElement("div");
            card.className =
                "card p-2 bg-dark text-white border-secondary h-100 d-flex flex-column align-items-center text-center";

            card.innerHTML = `
                <img src="${item.sprites?.default || ""}"
                    style="width:48px;height:48px;image-rendering:pixelated;"
                    class="mb-2">

                <div class="store-name">${item.name.replace(/-/g, " ")}</div>
                <div class="store-cost text-muted">Cost: ${item.cost}</div>

                <div class="store-controls mt-2">
                    <input type="number"
                        class="store-qty-input form-control form-control-sm"
                        data-item="${item.name}"
                        min="1"
                        value="1">

                    <button class="buy-btn btn btn-success btn-sm mt-1 w-100"
                            data-item="${item.name}">
                        Buy
                    </button>
                </div>
            `;



            col.appendChild(card);
            storeItems.appendChild(col);
        }
    }

    // Bind search + filter once
    if (searchInput && !searchInput._storeBound) {
        searchInput.addEventListener("input", renderStore);
        searchInput._storeBound = true;
    }

    if (categorySelect && !categorySelect._storeBound) {
        categorySelect.addEventListener("change", renderStore);
        categorySelect._storeBound = true;
    }
    // First render
    renderStore();
}
// Get a value from playerStats array
async function getPlayerStat(key, defaultValue) {
    const stored = await browser.storage.local.get("playerStats");
    let stats = stored.playerStats || [];

    const found = stats.find(x => x[0] === key);
    return found ? found[1] : defaultValue;
}
// Set/update a value in playerStats array
async function setPlayerStat(key, value) {
    const stored = await browser.storage.local.get("playerStats");
    let stats = stored.playerStats || [];

    const idx = stats.findIndex(x => x[0] === key);
    if (idx >= 0) stats[idx][1] = value;
    else stats.push([key, value]);

    await browser.storage.local.set({ playerStats: stats });
    return true;
}
async function buyItem(itemName) {
    if (!itemName) return console.error("Undefined itemName");

    const data = await loadItemsAndMachines();
    if (!data?.items) return console.error("Items not loaded");

    const item = data.items[itemName];
    if (!item) return console.warn("Item not found:", itemName);
    if (!item.cost || item.cost <= 0) return; // skip free items

    const qtyInput = document.querySelector(
        `.store-qty-input[data-item="${CSS.escape(itemName)}"]`
    );
    const qty = Math.max(1, Number(qtyInput?.value || 1));
    const totalCost = item.cost * qty;

    // coins
    const coins = await getNum(STORE.coins, 0);
    if (coins < totalCost) {
        playSound?.("lose");
        toast("Not enough coins!");
        return;
    }

    // deduct
    await setNum(STORE.coins, coins - totalCost);

    // add to inventory
    const inv = await getInventory();
    inv[itemName] = (inv[itemName] || 0) + qty;
    await saveInventory(inv);

    syncUserDataToBackend();
    playSound?.("victory");
    toast(`You bought ${qty} × ${item.name.replace(/-/g, " ")}!`);
}
function hideAllViews() {
    const viewIds = [
        "viewLoginRegister",
        "viewRegister",
        "viewOnlineBattle",
        "resultCard",
        "viewStore",
        "viewDex",
        "viewPicker",
        "viewBattle",
        "viewSettings",
        "viewParty"
        // add more view IDs here if you have them
    ];

    for (const id of viewIds) {
        const el = document.getElementById(id);
        if (el) el.classList.add("hidden");
    }
}


async function learnMove(moveName) {
    const player = await getPlayerMon();
    if (!player) return;

    const pretty = formatMoveName(moveName);
    const playerMoves = Array.isArray(player.moves) ? player.moves : [];

    if (playerMoves.some(m => m.name === moveName)) {
        showMoveTutorModal(`<p>${player.name} already knows <b>${pretty}</b>.</p>`);
        return;
    }

    if (playerMoves.length >= 4) {
        let html = `
        <p><b>${player.name}</b> already knows 4 moves.</p>
        <p>Select a move to forget:</p>
        `;

        html += player.moves.map(m => `
            <button class="btn btn-danger btn-sm mt-1 w-100"
                onclick="replaceMove('${m.name}','${moveName}')">
                Replace ${formatMoveName(m.name)}
            </button>
        `).join("");

        showMoveTutorModal(html);
        return;
    }

    const moveData = getMoveDetails(moveName);
    player.moves = Array.isArray(player.moves) ? player.moves : [];
    player.moves.push(moveData);

    await setPlayerMon(player);

    showMoveTutorModal(`<b>${player.name}</b> learned <b>${pretty}</b>!`);
    setTimeout(() => openMoveTutor(), 800);
}

async function replaceMove(oldMove, newMove) {
    const player = await getPlayerMon();
    if (!player) return;

    const playerMoves = Array.isArray(player.moves) ? player.moves : [];
    const idx = playerMoves.findIndex(m => m.name === oldMove);
    if (idx < 0) return;

    playerMoves[idx] = getMoveDetails(newMove);
    player.moves = playerMoves;

    await setPlayerMon(player);

    showMoveTutorModal(`
        <p>${player.name} forgot <b>${formatMoveName(oldMove)}</b> 
        and learned <b>${formatMoveName(newMove)}</b>!</p>
    `);

    setTimeout(() => openMoveTutor(), 900);
}

async function forgetMove(moveName) {
    const player = await getPlayerMon();
    if (!player) return;

    const playerMoves = Array.isArray(player.moves) ? player.moves : [];
    player.moves = playerMoves.filter(m => m.name !== moveName);

    await setPlayerMon(player);
    showMoveTutorModal(`<p>${player.name} forgot <b>${formatMoveName(moveName)}</b>.</p>`);

    setTimeout(() => openMoveTutor(), 800);
}

function formatMoveName(n) {
    return n.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

function getMoveDetails(moveName) {
    const mv = movesData[moveName];
    return {
        name: moveName,
        pp: mv?.pp ?? 10,
        power: mv?.power ?? 0,
        accuracy: mv?.accuracy ?? 100,
        type: mv?.type ?? "normal"
    };
}

// Builds the HTML and shows the modal
async function openMoveTutor() {
    const player = await getPlayerMon();
    if (!player?.name) {
        showMoveTutorModal("<p>No active Pokémon in your party.</p>");
        return;
    }

    const speciesName = String(player.name).toLowerCase();
    const allMoves = getLearnableMovesForScarletViolet(speciesName, player.level); // whatever helper you use
    console.log(allMoves);
    const eligibleMoves = allMoves.filter(m => m.level <= player.level);

    if (!eligibleMoves.length) {
        showMoveTutorModal(`<p>${player.name} can't learn any moves at its current level.</p>`);
        return;
    }

    let html = `<div class="move-tutor-list">`;
    html += `<h5>${player.name} – level ${player.level}</h5>`;
    html += `<p>Choose up to 4 moves. Learned moves are highlighted.</p>`;

    const playerMoves = Array.isArray(player.moves) ? player.moves : [];
    const currentNames = playerMoves.map(m => m.name);

    for (const move of eligibleMoves) {
        const learned = currentNames.includes(move.moveName);
        html += `
            <button class="btn btn-sm ${learned ? "btn-success" : "btn-outline-light"} mb-2 w-100"
                    data-move="${move.moveName}">
                <div class="d-flex justify-content-between">
                    <span>${move.moveName.replace(/-/g, " ")}</span>
                    <span class="small text-muted">Lv ${move.level}</span>
                </div>
            </button>
        `;
    }

    html += `</div>`;

    showMoveTutorModal(html);
}
function showModal(html) {
    showMoveTutorModal(html);
}
// Only handles DOM + Bootstrap, never receives events
function showMoveTutorModal(html) {
    const body = document.getElementById("moveTutorBody");
    if (!body) return;

    body.innerHTML = html;

    body.querySelectorAll("button[data-move]").forEach(btn => {
        btn.addEventListener("click", async (e) => {
            const moveName = e.currentTarget.dataset.move;
            await learnMove(moveName);
        });
    });

    bootstrap.Modal.getOrCreateInstance(
        document.getElementById("moveTutorModal")
    ).show();
}


// global handler used by the buttons in the HTML above
window.tm_selectMove = async function (moveName) {
    const player = await getPlayerMon();
    if (!player) return;

    // TODO: your logic to add/replace moves, enforce 4-move limit, etc.
    console.log("Selected move:", moveName, "for", player.name);
};

// BIND ONCE — globally
if (!window._storeBuyBound) {
    document.addEventListener("click", (e) => {
        const btn = e.target.closest(".buy-btn");
        if (!btn) return;

        const itemName = btn.dataset.item;
        if (!itemName) {
            console.error("Buy button missing data-item");
            return;
        }

        buyItem(itemName);
    });


    window._storeBuyBound = true;
}
// Show a small toast (use alert if you prefer)
// Simple toast API:
// toast("Saved!");
// toast("Saved", "success");
// toast({ title: "Synced", message: "Party updated", type: "info", duration: 3000 });
// setToastPosition("top-right" | "top-left" | "bottom-left" | "bottom-right")

// === TOAST SYSTEM ===
(function () {
    const ICONS = { success: "✔️", error: "✖️", warning: "⚠️", info: "ℹ️", default: "🔔" };
    function ensureRoot() {
        let root = document.getElementById("toast-root");
        if (!root) {
            root = document.createElement("div");
            root.id = "toast-root";
            document.body.appendChild(root);
        }
        return root;
    }
    function removeToast(el) {
        el.style.animation = "toast-out .16s ease-in forwards";
        setTimeout(() => el.remove(), 170);
    }
    function makeToast({ title, message, type = "default", duration = 3500, closeable = true }) {
        const root = ensureRoot();
        const el = document.createElement("div");
        el.className = `toast toast--${type} show`;
        const icon = document.createElement("div");
        icon.className = "toast__icon";
        icon.textContent = ICONS[type] || ICONS.default;
        const content = document.createElement("div");
        content.className = "toast__content";
        if (title) {
            const t = document.createElement("div");
            t.className = "toast__title";
            t.textContent = title;
            content.appendChild(t);
        }
        const m = document.createElement("div");
        m.className = "toast__msg";
        m.textContent = message || title || "";
        content.appendChild(m);
        const close = document.createElement("button");
        close.className = "toast__close";
        close.innerHTML = "×";
        if (closeable) close.addEventListener("click", () => removeToast(el));
        else close.style.display = "none";
        el.append(icon, content, close);
        root.appendChild(el);
        if (duration > 0) setTimeout(() => removeToast(el), duration);
        return el;
    }
    window.toast = function (arg1, arg2) {
        if (typeof arg1 === "object") {
            const { title, message, type, duration, closeable } = arg1;
            return makeToast({ title, message, type, duration, closeable });
        }
        const message = String(arg1 ?? "");
        const type = arg2 || "default";
        return makeToast({ message, type });
    };
    window.setToastPosition = function (pos = "bottom-right") {
        const root = ensureRoot();
        root.classList.remove("top-right", "top-left", "bottom-left", "bottom-right");
        root.classList.add(pos);
    };
})();
async function migrateOldBallSystemToInventory() {
    const stored = await browser.storage.local.get([
        "playerStats",
        "balls",
        "greatBalls",
        "ultraBalls",
        "masterBalls",
        "potions"
    ]);

    console.log("[Migration] Stored data:", stored);

    // Ensure playerStats exists and is an object
    let stats = stored.playerStats;
    if (!stats || typeof stats !== "object" || Array.isArray(stats)) {
        console.warn("[Migration] playerStats was invalid, fixing...");
        stats = {}; // rebuild clean object
    }

    // Ensure inventory exists
    if (!stats.inventory || typeof stats.inventory !== "object") {
        stats.inventory = {};
    }

    let migratedAnything = false;

    // Helper to write safely
    const safeAdd = (itemKey, oldAmount) => {
        if (!oldAmount || oldAmount <= 0) return;

        // Do not overwrite existing inventory values
        const prev = stats.inventory[itemKey] || 0;
        stats.inventory[itemKey] = prev + oldAmount;
        migratedAnything = true;
    };

    // ---- Migrate balls safely ----
    safeAdd("poke-ball",   stored.balls       | 0);
    safeAdd("great-ball",  stored.greatBalls  | 0);
    safeAdd("ultra-ball",  stored.ultraBalls  | 0);
    safeAdd("master-ball", stored.masterBalls | 0);

    // ---- Migrate potions ----
    safeAdd("potion", stored.potions | 0);

    if (!migratedAnything) {
        console.log("[Migration] No old data found — skipping.");
        return;
    }

    // Save updated inventory
    await browser.storage.local.set({ playerStats: stats });
    console.log("[Migration] Inventory updated:", stats.inventory);

    // After safe migration — remove old fields
    await browser.storage.local.remove([
        "balls",
        "greatBalls",
        "ultraBalls",
        "masterBalls",
        "potions"
    ]);

    console.log("[Migration] Old fields cleaned up.");
}
/*  ==========MAIN INIT==========
*/
async function init() {

    $("#ver").textContent = browser.runtime.getManifest().version;
    setToastPosition("bottom-right");

    // 🔹 Show login/register UI & wait for username
    const username = await initLoginRegisterSystem();
    console.log("Active session username:", username);

    initPasswordToggle();

    // 🔹 Fetch saved data from backend
    try {
        const res = await fetch("https://dstokesncstudio.com/pokeBackend/api/getUser.php", {
            headers: { "X-Session-User": username }
        });
        const json = await res.json();

        if (json.success && json.data) {
            console.log("Loaded user:", json.data);
            await browser.storage.local.set(json.data);
        }
    } catch (err) {
        console.error("Failed to load user data:", err);
    }
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
        id: "pokeMoves",
        text: "Moves",
        title: "Moves",
        onClick: () => openMoveTutor(),
    });

    addHeaderButton("secondary", {
        id: "btnOnlineBattle",
        text: "⚔️ Online Battle",
        title: "Online Battle",
        onClick: openOnlineBattleView,
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
        title: "Buy items",
        onClick: openStore
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

    if (saved.pickedPokemon && Object.keys(saved.pickedPokemon).length > 0) {
        // 🔹 User already picked a Pokémon
        $("#status").textContent = "Your pick: " + (saved.pickedPokemon.name || "unknown");
        $("#balls")?.classList.add("hidden");
        showResult(saved.pickedPokemon);
    }
    else if (Array.isArray(saved.ballPool) && saved.ballPool.length === 3) {
        // 🔹 Already have 3 Pokéballs from previous session
        $("#status").textContent = "Choose a Poké Ball:";
        renderThreeBalls(saved.ballPool);
    }
    else {
        // 🔹 Missing OR empty — generate new Pokéballs
        console.log("🆕 No starter Pokémon or empty ball pool detected — generating new starters...");
        await rollAndRender();
    }


    // pick one of the three balls
    $("#balls")?.addEventListener("click", async (e) => {
        const btn = e.target.closest(".ball");
        if (!btn) return;

        const { pickedPokemon, ballPool, party } = await browser.storage.local.get([
            "pickedPokemon",
            "ballPool",
            "party"
        ]);

        // 🚫 Prevent picking twice
        if (pickedPokemon && Object.keys(pickedPokemon).length > 0) {
            console.warn("Starter already chosen.");
            return;
        }

        if (Array.isArray(party) && party.some(p => p && Object.keys(p).length > 0)) {
            console.warn("Active party already exists.");
            return;
        }


        // Ensure a valid click
        if (!Array.isArray(ballPool)) return;
        const idx = Number(btn.dataset.index || 0);
        const chosen = ballPool[idx];
        if (!chosen) return;

        // Save chosen Pokémon locally
        await browser.storage.local.set({ pickedPokemon: chosen });
        $("#status").textContent = "Your pick: " + (chosen.name || "unknown");
        $("#balls")?.classList.add("hidden");
        showResult(chosen);

        // --- Add to Pokédex + Party/Storage ---
        try {
            const entry = ensureCaughtUID(makeCaughtEntry(chosen));

            // Update Pokédex
            const caughtList = await getCaughtWithUID();
            const key = String(entry.pokeDex_num ?? entry.name).toLowerCase();
            if (!caughtList.some(x => String(x.pokeDex_num ?? x.name).toLowerCase() === key)) {
                caughtList.push(entry);
                await setCaught(caughtList);
            }

            // Place into party or storage
            await placeNewCatchIntoPartyOrStorage(entry.uid);

            console.log(`✅ Starter ${chosen.name} added to Pokédex + party.`);

            // --- Sync everything to backend ---
            await syncUserDataToBackend();
        } catch (err) {
            console.error("❌ Failed to add starter to dex/party:", err);
        }
    });




    // battle panel buttons
    $("#btnHome")?.addEventListener("click", showPicker);
    $("#btnStartBattle")?.addEventListener("click", startBattle);
    document.getElementById("btnFindMatch")?.addEventListener("click", () => {
        console.log("Finding match...");
        document.getElementById("bcText").innerHTML = "Finding match...";
        // TODO: call your matchmaking API
    });

    document.getElementById("btnCreateRoom")?.addEventListener("click", () => {
        console.log("Creating room...");
        // TODO: generate room code
    });

    document.getElementById("btnJoinRoom")?.addEventListener("click", () => {
        const code = document.getElementById("roomCodeInput").value.trim();
        if (!code) return;
        console.log("Joining room:", code);
    });

    document.getElementById("btnOnlineBack").addEventListener("click", showPicker);

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
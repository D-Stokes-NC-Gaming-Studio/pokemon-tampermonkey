// ==UserScript==
// @name        Pokemon Battle (Full Edition)
// @author      JellxWrld(@diedrchr), DStokesNCStudio9@esrobbie)
// @connect     pokeapi.co
// @connect     https://dstokesncstudio.com/pokeapi/pokeapi.php
// @namespace   dstokesncstudio.com
// @version     1.2.0.2
// @description Full version with XP, evolution, stats, sound, shop, battles, and walking partner — persistent across sites.
// @include     *
// @grant       GM.xmlHttpRequest
// @grant       unsafeWindow
// @grant       GM_getValue
// @grant       GM_setValue
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
(function() {
    'use strict';

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
        /// DoubleClick ad domains
        // Add more patterns as needed
    ];

    // Check if current URL matches any blocklist rule
    if (BLOCKLIST.some(rx => rx.test(location.href))) return;

    // In addition to the above blocklist:
    if (
        ['youtube.com', 'www.youtube.com'].includes(window.location.hostname) &&
        (window.location.pathname.startsWith('/live_chat') || window.location.pathname.startsWith('/embed/'))
    ) {
        return;
    }
    // If running inside an iframe (ads commonly do this)
    if (window !== window.top) {
        // Optionally, only block on specific domains
        if (/youtube\.com|doubleclick\.net|ads\.google\./.test(window.location.hostname)) return;
    }
    // --- Storage and helpers ---
    const STORAGE = {
        coins: 'pkm_coins',
        balls: 'pkm_balls',
        greatBalls: 'pkm_great_balls',
        ultraBalls: 'pkm_ultra_balls',
        potions: 'pkm_potions',
        party: 'pkm_party',
        starter: 'pkm_starter',
        xp: 'pkm_xp',
        level: 'pkm_level',
        soundOn: 'pkm_sound_on',
        stats: 'pkm_stats',
        masterBalls: 'pkm_master_balls',
        pokestopCooldown: 'pkm_pokestop_cooldown',
        volume: 'pkm_volume',
        pokedex: 'pkm_pokedex'
    };
    const POKEAPI_VALID_FORMS = {
        // only include forms that PokéAPI has sprites for
        mega: ['charizard-mega-x', 'charizard-mega-y', 'mewtwo-mega-x', 'mewtwo-mega-y', 'lucario-mega', 'gyarados-mega'],
        alolan: ['raichu-alola', 'marowak-alola', 'vulpix-alola', 'ninetales-alola'],
        galarian: ['zigzagoon-galar', 'slowpoke-galar', 'rapidash-galar'],
        hisuian: ['zoroark-hisui', 'braviary-hisui', 'growlithe-hisui'],
        paldean: ['wooper-paldea']
    };
    const SPRITE_NAME_FIXES = {
        'shaymin-land': 'shaymin',
        'giratina-altered': 'giratina',
        'tornadus-incarnate': 'tornadus',
        'thundurus-incarnate': 'thundurus',
        'landorus-incarnate': 'landorus',
        'keldeo-ordinary': 'keldeo',
        'meloetta-aria': 'meloetta',
        'lycanroc-midday': 'lycanroc',
        'zygarde-50': 'zygarde',
        'wishiwashi-solo': 'wishiwashi'
        // Add more as needed
    };
    function getRandomForm(baseName) {
        const isShiny = Math.random() < 0.05;
        const allForms = Object.entries(POKEAPI_VALID_FORMS)
        .flatMap(([formType, names]) => names.map(name => ({ formType, name })));

        const possibleForms = allForms.filter(f => f.name.startsWith(baseName.toLowerCase()));

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
        return allStats[name.toLowerCase()] || { xp: 0, level: 1, hp: 100, atk: 15 };
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

    const getBool = k => GM_getValue(k, 'false') === 'true';
    const setBool = (k, v) => GM_setValue(k, v ? 'true' : 'false');

    const getObj = k => {
        try { return JSON.parse(GM_getValue(k, '{}')) || {}; } catch { return {}; }
    };
    const setObj = (k, o) => GM_setValue(k, JSON.stringify(o));

    const getStr = (k, d = '') => GM_getValue(k, d);
    const setStr = (k, v) => GM_setValue(k, v);
    const getArr = k => { try{ return JSON.parse(GM_getValue(k,'[]'))||[] }catch{ return [] } };
    const setArr = (k,a) => GM_setValue(k,JSON.stringify(a));

    // Initialize defaults if needed
    if (!GM_getValue(STORAGE.coins)) setInt(STORAGE.coins, 100);
    if (!GM_getValue(STORAGE.balls)) setInt(STORAGE.balls, 5);
    if (!GM_getValue(STORAGE.potions)) setInt(STORAGE.potions, 2);
    if (!GM_getValue(STORAGE.greatBalls)) setInt(STORAGE.greatBalls, 0);
    if (!GM_getValue(STORAGE.ultraBalls)) setInt(STORAGE.ultraBalls, 0);
    if (!GM_getValue(STORAGE.masterBalls)) setInt(STORAGE.masterBalls, 0);
    if (!GM_getValue(STORAGE.pokestopCooldown)) setInt(STORAGE.pokestopCooldown, 0);
    if (!GM_getValue(STORAGE.pokedex)) setArr(STORAGE.pokedex,[]);
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

    const XP_TO_LEVEL = lvl => 50 + lvl * 25;

    // --- Sounds ---
    const SOUNDS = {
        hit: new Audio('https://github.com/jellowrld/pokemon-tampermonkey/raw/refs/heads/main/hit.mp3'),
        ball: new Audio('https://github.com/jellowrld/pokemon-tampermonkey/raw/refs/heads/main/Throw.mp3'),
        catch: new Audio('https://github.com/jellowrld/pokemon-tampermonkey/raw/refs/heads/main/06-caught-a-pokemon.mp3'),
        faint: new Audio('https://github.com/jellowrld/pokemon-tampermonkey/raw/refs/heads/main/faint.mp3'),
        run: new Audio('https://github.com/jellowrld/pokemon-tampermonkey/raw/refs/heads/main/runaway.mp3'),
        start: new Audio('https://github.com/jellowrld/pokemon-tampermonkey/raw/refs/heads/main/wildbattle.mp3'),
        victory: new Audio('https://github.com/jellowrld/pokemon-tampermonkey/raw/refs/heads/main/victory.mp3'),
        lose: new Audio('https://github.com/jellowrld/pokemon-tampermonkey/raw/refs/heads/main/lose.mp3'),
        stop: new Audio(''),
        battleSound: new Audio('https://github.com/jellowrld/pokemon-tampermonkey/raw/refs/heads/main/wildbattle.mp3')
    };
    const parsedVol = parseFloat(getStr(STORAGE.volume, '0.4'));
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
            clone.play().catch(err => console.warn('Audio play failed or blocked:', err));
        }
    }

    // --- Global vars ---
    let partnerName = null, partnerSpriteUrl = null, starterName = null;
    let spriteEl = null, walkInterval = null, walkDirection = -1;
    let wrap = document.createElement('div');
    let wildSleepTurns = 0;
    let randomBattleEnabled = getBool('pkm_random_battles');
    let randomBattleTimer = null;
    let nextBattleTime = null;
    SOUNDS.battleSound.loop = true;
    function loadPokedex() {
        let raw = GM_getValue(STORAGE.pokedex, '[]');
        try { return JSON.parse(raw); }
        catch { return []; }
    }
    function recordPokedex(entry) {
        // STORAGE.pokedex will hold a JSON array of {id,name,spriteUrl,types,…}
        let raw = GM_getValue(STORAGE.pokedex, '[]');
        let arr;
        try { arr = JSON.parse(raw); }
        catch { arr = []; }
        if (!arr.some(e => e.name.toLowerCase() === entry.name.toLowerCase())) {
            arr.push(entry);
            GM_setValue(STORAGE.pokedex, JSON.stringify(arr));
        }
    }
    // PokeDex Class //
    class Pokedex {
        constructor(entries){ this.entries = entries; }
        static async load(){
            const raw = await getArr(STORAGE.pokedex);
            return new Pokedex(raw);
        }
        render(container){
            container.innerHTML = '';
            container.appendChild(Object.assign(document.createElement('h5'),{
                textContent:'Your Pokédex'
            }));
            const table = document.createElement('table');
            table.className = 'table table-sm table-dark';
            table.innerHTML = `
      <thead>
        <tr><th></th><th>#</th><th>Name</th><th>Types</th></tr>
      </thead>
      <tbody>
        ${this.entries.map(e=>`
          <tr style="cursor:pointer">
            <td><img src="${e.spriteUrl}" width="32"></td>
            <td>${e.id}</td>
            <td>${e.name}</td>
            <td>${e.types.join(', ')}</td>
          </tr>
        `).join('')}
      </tbody>
    `;
            container.appendChild(table);
            // wire up row clicks
            Array.from(table.tBodies[0].rows).forEach((row,i)=>{
                row.onclick = ()=> openDetail(this.entries[i]);
            });
            container.appendChild(createButton('Close Pokédex', closePokedex, 'btn btn-light mt-2'));
        }
    }

    // panel handle
    let pokedexPanel = null;
    async function openPokedex(){
        if(pokedexPanel) return;
        pokedexPanel = document.createElement('div');
        Object.assign(pokedexPanel.style,{
            position:'fixed', top:'50%', left:'50%',
            transform:'translate(-50%,-50%)',
            background:'#222', color:'#fff',
            padding:'12px', border:'2px solid #fff',
            zIndex:10000, width:'300px', maxHeight:'80vh',
            overflowY:'auto'
        });
        document.body.appendChild(pokedexPanel);
        const dex = await Pokedex.load();
        dex.render(pokedexPanel);
    }
    function closePokedex(){
        if(!pokedexPanel) return;
        pokedexPanel.remove();
        pokedexPanel = null;
        renderHeader();
    }

    // --- UI and rendering ---
    Object.assign(wrap.style, {
        position:'fixed', bottom:'0', left:'0',
        color:'#fff', padding:'8px', fontFamily:'sans-serif', fontSize:'14px',
        zIndex:'9999', display:'flex', flexDirection:'column', gap:'4px'
    });
    wrap.classList = 'bg-dark bg-opacity-50 border border-1 border-dark';
    document.body.appendChild(wrap);

    function createButton(label, onClick, customClass='') {
        const btn = document.createElement('button');
        btn.classList = customClass;
        btn.textContent = label;
        btn.style.border = '1px solid black';
        btn.style.padding = '4px 8px';
        btn.style.color = 'black';
        btn.onclick = onClick;
        return btn;
    }

    async function renderHeader() {
        wrap.innerHTML = '';

        // --- Fetch partner stats ---
        const stored = getStr(STORAGE.starter);
        const stats= stored
        ? getStats(stored)
        : { xp:0, level:1, hp:100, atk:15, currentHP:null };
        const lvl= stats.level;
        const xp= stats.xp;
        const hp = stats.hp;
        const maxHp= hp
        const curHp= stats.currentHP != null ? stats.currentHP : maxHp;
        const nextXp = lvl * 100;
        console.log(stats.currentHP);
        // --- Top row: Partner name + bars ---
        const topRow = document.createElement('div');
        Object.assign(topRow.style, {
            display:       'flex',
            alignItems:    'center',
            gap:           '16px',
            marginBottom:  '8px'
        });

        // Partner label
        const partnerDiv = document.createElement('div');
        partnerDiv.id = 'pkm-partner';
        partnerDiv.textContent = stored
            ? `Partner: ${stored[0].toUpperCase() + stored.slice(1)} (Lv ${lvl}) | ATK: ${stats.atk}`
        : 'Choose your starter!';
        topRow.appendChild(partnerDiv);

        // Bars container
        const bars = document.createElement('div');
        Object.assign(bars.style, {
            display:    'flex',
            gap:        '12px',
            flexShrink: '0'
        });

        // HP wrapper
        const hpWrapper = document.createElement('div');
        hpWrapper.style.display = 'flex';
        hpWrapper.style.flexDirection = 'column';
        const hpLabel = document.createElement('small');
        hpLabel.textContent = `HP: ${curHp}/${maxHp}`;
        const hpPct = Math.round((curHp / maxHp) * 100);
        const hpBar = document.createElement('div');
        hpBar.className = 'progress';
        hpBar.style.width= '120px';
        hpBar.style.height = '8px';
        hpBar.innerHTML = `
    <div class="progress-bar bg-danger"
         role="progressbar"
         style="width: ${hpPct}%;"
         aria-valuenow="${hpPct}"
         aria-valuemin="0"
         aria-valuemax="100"></div>
  `;
        hpWrapper.append(hpLabel, hpBar);

        // XP wrapper
        const xpWrapper = document.createElement('div');
        xpWrapper.style.display = 'flex';
        xpWrapper.style.flexDirection = 'column';
        const xpLabel = document.createElement('small');
        xpLabel.textContent = `XP: ${xp}/${nextXp}`;
        const xpPct = Math.round((xp / nextXp) * 100);
        const xpBar = document.createElement('div');
        xpBar.className = 'progress';
        xpBar.style.width= '120px';
        xpBar.style.height = '8px';
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

        wrap.appendChild(topRow);

        // --- Currency & timers line ---
        const status = document.createElement('div');
        let timerStr = '';
        if (nextBattleTime && randomBattleEnabled) {
            const d = Math.max(0, nextBattleTime - Date.now());
            timerStr += ` | Next Battle: ${Math.floor(d/60000)}m ${Math.floor((d%60000)/1000)}s`;
        }
        const psCd = getInt(STORAGE.pokestopCooldown);
        if (psCd > Date.now()) {
            const r = psCd - Date.now();
            timerStr += ` | PokéStop: ${Math.floor(r/60000)}m ${Math.floor((r%60000)/1000)}s`;
        } else {
            timerStr += ` | PokéStop: Ready!`;
        }
        status.textContent =
            `Coins: ${getInt(STORAGE.coins)} | Balls: ${getInt(STORAGE.balls)} | Potions: ${getInt(STORAGE.potions)}${timerStr}`;
        wrap.appendChild(status);

        // --- Buttons row ---
        const row = document.createElement('div');
        Object.assign(row.style, { display:'flex', flexWrap:'wrap', gap:'6px', marginTop:'8px' });

        row.appendChild(createButton('⚔️ Battle',openBattle,'btn btn-success btn-sm'));
        row.appendChild(createButton('📍 PokéStop', openPokeStop,'btn btn-success btn-sm'));
        row.appendChild(createButton('🛒 Shop',openShop,'btn btn-success btn-sm'));
        row.appendChild(createButton('🎒 Bag',openBag,'btn btn-success btn-sm'));
        row.appendChild(createButton('📖 Pokédex',openPokedex,'btn btn-success btn-sm'));
        // row.appendChild(createButton('👥 Party',openParty,'btn btn-success btn-sm'));
        row.appendChild(createButton('⚙️ Settings',openSettings, 'btn btn-success btn-sm'));

        wrap.appendChild(row);
    }


    // --- Partner setup ---
    function initPartner() {
        const stored = getStr(STORAGE.starter);
        if (stored) fetchPartner(stored);
        else {
            renderHeader();
            setTimeout(openStarter, 300);
        }
    }

    let detailPanel = null;
    function openDetail(p) {
        // If it’s already open, do nothing
        if (detailPanel) return;

        // Create the outer panel
        detailPanel = document.createElement('div');
        Object.assign(detailPanel.style, {
            position: 'fixed',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%,-50%)',
            background: '#222',
            color: '#fff',
            padding: '16px',
            border: '2px solid #fff',
            zIndex: 11000,
            width: '300px',
            maxHeight: '80vh',
            overflowY: 'auto',
            fontFamily: 'sans-serif',
        });
        document.body.appendChild(detailPanel);

        // Title: Name, #, Level
        const title = document.createElement('h5');
        title.textContent = `${p.name} (#${p.id}) — Level ${p.level}`;
        detailPanel.appendChild(title);

        // HP progress bar
        const hpPct = Math.floor(100 * p.currentHP / p.maxHp);
        detailPanel.appendChild(Object.assign(document.createElement('div'), {
            innerHTML: `<strong>HP:</strong> ${p.currentHP} / ${p.maxHp}`
        }));
        const hpBar = document.createElement('div');
        hpBar.className = 'progress mb-2';
        Object.assign(hpBar.style, { height: '6px' });
        hpBar.innerHTML = `
    <div class="progress-bar bg-danger" role="progressbar"
         style="width: ${hpPct}%;" aria-valuenow="${hpPct}"
         aria-valuemin="0" aria-valuemax="100"></div>
  `;
        detailPanel.appendChild(hpBar);

        // XP progress bar
        const threshold = p.level * 100;
        const xpPct = Math.floor(100 * p.xp / threshold);
        detailPanel.appendChild(Object.assign(document.createElement('div'), {
            innerHTML: `<strong>XP:</strong> ${p.xp} / ${threshold}`
        }));
        const xpBar = document.createElement('div');
        xpBar.className = 'progress mb-2';
        Object.assign(xpBar.style, { height: '6px' });
        xpBar.innerHTML = `
    <div class="progress-bar bg-info" role="progressbar"
         style="width: ${xpPct}%;" aria-valuenow="${xpPct}"
         aria-valuemin="0" aria-valuemax="100"></div>
  `;
        detailPanel.appendChild(xpBar);

        // Sprite
        const img = document.createElement('img');
        img.src = p.spriteBlobUrl || p.spriteUrl;
        Object.assign(img.style, {
            display: 'block',
            margin: '8px auto',
            width: '96px',
            height: '96px',
        });
        detailPanel.appendChild(img);

        // Types & Abilities
        const typesDiv = document.createElement('div');
        typesDiv.textContent = 'Types: ' + p.types.join(', ');
        detailPanel.appendChild(typesDiv);

        const abDiv = document.createElement('div');
        abDiv.textContent = 'Abilities: ' + p.abilities.join(', ');
        detailPanel.appendChild(abDiv);

        // Stats table
        const table = document.createElement('table');
        table.className = 'table table-sm table-dark mt-2';
        table.style.fontSize = '0.85em';
        table.innerHTML = `
    <thead><tr><th>Stat</th><th>Base</th></tr></thead>
    <tbody>
      ${p.stats.map(s =>
                    `<tr><td>${s.name}</td><td>${s.value}</td></tr>`
                   ).join('')}
    </tbody>
  `;
        detailPanel.appendChild(table);

        // Close button
        const closeBtn = document.createElement('button');
        closeBtn.textContent = 'Close';
        closeBtn.className = 'btn btn-light mt-2';
        closeBtn.onclick = () => {
            detailPanel.remove();
            detailPanel = null;
        };
        detailPanel.appendChild(closeBtn);
    }
    function toggleRandomBattles() {
        randomBattleEnabled = !randomBattleEnabled;
        setBool('pkm_random_battles', randomBattleEnabled);
        if (randomBattleEnabled) {
            scheduleRandomBattle();
            alert('Random battles enabled!');
        } else {
            clearTimeout(randomBattleTimer);
            alert('Random battles disabled!');
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
    function fetchPartner(name) {
        if (!name) return;

        starterName= name;
        partnerSpriteUrl = `https://play.pokemonshowdown.com/sprites/ani/${name.toLowerCase()}.gif`;
        partnerName = name[0].toUpperCase() + name.slice(1);
        const isShiny = name.toLowerCase().startsWith('shiny ');
        let rawName = isShiny ? name.toLowerCase().replace('shiny ', '') : name.toLowerCase();

        // Apply sprite name fixes if needed
        if (SPRITE_NAME_FIXES[rawName]) {
            rawName = SPRITE_NAME_FIXES[rawName];
        }

        GM.xmlHttpRequest({
            method: 'GET',
            url: `https://pokeapi.co/api/v2/pokemon/${encodeURIComponent(name)}`,
            onload: async res => {
                const d = JSON.parse(res.responseText);
                // build your entry
                const entry = {
                    id: d.id,
                    name: d.name[0].toUpperCase() + d.name.slice(1),
                    spriteUrl: partnerSpriteUrl,
                    types: d.types.map(t => t.type.name),
                    abilities: d.abilities.map(a => a.ability.name),
                    stats: d.stats.map(s => ({ name: s.stat.name, value: s.base_stat })),
                    hp: d.stats.base_stat,
                    level: 1,
                    xp: 0,
                    currentHP: d.stats.find(s=>s.stat.name==='hp').base_stat
                };

                // 2) record in the Pokédex
                await recordPokedex(entry);

                // 3) now set up your partner normally:
                starterName= name;
                partnerName= entry.name;
                //partnerSpriteUrl = entry.spriteUrl;

                // if you want to track its stats in storage you can also do:
                const stats = getStats(name);
                console.log(stats)
                if (
                    stats.hp == null ||
                    stats.currentHP == null ||
                    stats.currentHP == undefined
                ) {
                    stats.currentHP = entry.currentHP;
                    stats.hp = entry.currentHP;
                    console.log(entry);
                    setStats(name, stats);
                } else {
                    setStats(name, stats);
                }




                renderHeader();
                spawnWalkingSprite(partnerSpriteUrl);
            },
            onerror: err => {
                console.error("Failed to fetch partner:", err);
            }
        });
        renderHeader();
        spawnWalkingSprite(partnerSpriteUrl);
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

        const wrapper = document.createElement('div');
        spriteWrapperEl = wrapper;

        const stats = getStats(partnerName) || {};
        currentHP = stats.currentHP || 0;
        maxHP = stats.hp || 100;

        // Wrapper
        Object.assign(wrapper.style, {
            position: 'fixed',
            bottom: '64px',
            left: '0px',
            width: '64px',
            zIndex: '9999',
            pointerEvents: 'none',
            overflow: 'visible',
        });

        // Inner container (flips)
        const inner = document.createElement('div');
        Object.assign(inner.style, {
            position: 'relative',
            width: '64px',
            height: '80px'
        });

        // HP bar wrapper
        const progressWrapper = document.createElement('div');
        Object.assign(progressWrapper.style, {
            position: 'absolute',
            top: '-12px',
            left: '8px',
            width: '48px',
            height: '6px',
            backgroundColor: '#333',
            border: '1px solid #888',
            borderRadius: '3px',
            overflow: 'hidden',
            transform: 'scaleX(1)',
        });

        // HP fill (animate this!)
        hpFillEl = document.createElement('div');
        const hpPercent = Math.max(0, Math.min(100, (currentHP / maxHP) * 100));
        Object.assign(hpFillEl.style, {
            width: `${hpPercent}%`,
            height: '100%',
            backgroundColor: hpPercent > 50 ? '#4caf50' : hpPercent > 25 ? '#ff9800' : '#f44336',
            transition: 'width 0.5s ease-in-out'
        });

        progressWrapper.appendChild(hpFillEl);

        // Sprite image
        spriteEl = document.createElement('img');
        spriteEl.id = 'pkm-partner-sprite';
        spriteEl.src = spriteUrl;
        spriteEl.alt = partnerName || 'partner';
        Object.assign(spriteEl.style, {
            width: '64px',
            height: '64px',
            imageRendering: 'pixelated',
            animation: 'bobWalk 0.6s infinite',
            display: 'block',
            marginTop: '16px'
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
            progressWrapper.style.transform = 'scaleX(1)'; // keep HP bar forward
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
                percent > 50 ? '#4caf50' :
            percent > 25 ? '#ff9800' :
            '#f44336';
        }
    }


    function showFloatingHPChange(amount) {
        const floatText = document.createElement('div');
        floatText.innerText = amount > 0 ? `+${amount}` : `${amount}`;

        // Style it
        Object.assign(floatText.style, {
            position: 'absolute',
            top: '-28px',
            left: '0px',
            width: '64px',
            textAlign: 'center',
            fontWeight: 'bold',
            fontSize: '14px',
            fontFamily: 'monospace',
            color: amount > 0 ? '#00ff66' : '#ff4444',
            textShadow: '0 0 2px black, 1px 1px 2px black',
            pointerEvents: 'none',
            opacity: '1',
            transform: 'translateY(0)',
            zIndex: '10000',
            transition: 'transform 1s ease-out, opacity 1s ease-out'
        });

        // Append it FIRST, then trigger animation
        spriteWrapperEl?.appendChild(floatText);

        // Delay the animation trigger to ensure browser registers initial styles
        setTimeout(() => {
            floatText.style.transform = 'translateY(-30px)';
            floatText.style.opacity = '0';
        }, 50); // 1 frame (~16ms) might work, but 50ms is safer

        // Remove after animation completes
        setTimeout(() => {
            floatText.remove();
        }, 1050);
    }





    // === Starter Selection ===
    let starterPanel;

    function openStarter() {
        if (starterPanel) return;
        starterPanel = document.createElement('div');
        Object.assign(starterPanel.style, {
            position: 'fixed',
            top: '50%', left: '50%',
            transform: 'translate(-50%, -50%)',
            background: '#fff', color: '#000',
            padding: '12px',
            border: '2px solid black',
            zIndex: '10000',
            maxHeight: '80vh',
            overflowY: 'auto',
            width: '320px'
        });
        document.body.appendChild(starterPanel);

        // Add search input
        const search = document.createElement('input');
        search.type = 'text';
        search.placeholder = 'Search Pokémon...';
        Object.assign(search.style, {
            width: '100%',
            padding: '6px',
            marginBottom: '8px',
            fontSize: '16px',
            boxSizing: 'border-box'
        });
        starterPanel.appendChild(search);

        // List container
        const list = document.createElement('div');
        starterPanel.appendChild(list);

        fetch('https://pokeapi.co/api/v2/pokemon?limit=1010')
            .then(res => res.json())
            .then(data => {
            const names = data.results.map(p => p.name);
            renderFilteredList(names, list, search);
            search.addEventListener('input', () => renderFilteredList(names, list, search));
        });

        const cancel = createButton('🚫 Cancel', closeStarter, 'btn btn-success');
        cancel.style.marginTop = '10px';
        starterPanel.appendChild(cancel);
    }

    let settingsPanel;

    function openSettings() {
        if (settingsPanel) return;
        settingsPanel = document.createElement('div');
        Object.assign(settingsPanel.style, {
            position: 'fixed', top: '50%', left: '50%',
            transform: 'translate(-50%, -50%)',
            background: '#fff', color: '#000',
            padding: '12px', border: '2px solid black',
            zIndex: '10000', width: '300px'
        });
        settingsPanel.classList = 'd-grid gap-1 bg-dark bg-opacity-50';
        document.body.appendChild(settingsPanel);

        renderSettings();
    }

    function renderSettings() {
        if (!settingsPanel) return;
        settingsPanel.innerHTML = '<strong>Settings</strong><br><br>';

        // Sound On/Off Toggle
        const soundToggle = createButton(`Sound: ${getBool(STORAGE.soundOn) ? 'On' : 'Off'}`, () => {
            const current = getBool(STORAGE.soundOn);
            const newVal = !current;
            setBool(STORAGE.soundOn, newVal);

            if (!newVal) {
                // Stop and reset all currently playing sounds
                Object.values(SOUNDS).forEach(audio => {
                    if (audio instanceof Audio) {
                        audio.pause();
                        audio.currentTime = 0;
                    }
                });
            }

            renderSettings();
        }, 'btn btn-info');

        // Volume Slider
        const volumeSlider = document.createElement('input');
        volumeSlider.type = 'range';
        volumeSlider.min = 0;
        volumeSlider.max = 1;
        volumeSlider.step = 0.01;
        volumeSlider.value = getStr(STORAGE.volume, '0.4');
        volumeSlider.style.width = '100%';
        volumeSlider.oninput = () => {
            const vol = parseFloat(volumeSlider.value);
            setStr(STORAGE.volume, volumeSlider.value);
            Object.values(SOUNDS).forEach(a => {
                if (a instanceof Audio) a.volume = vol;
            });
        };


        // Change Starter
        const starterBtn = createButton('🔄 Change Starter', openStarter, 'btn btn-success');

        // Random Battle Toggle
        const randomBattleToggle = createButton(`Random Battles: ${randomBattleEnabled ? 'On' : 'Off'}`, toggleRandomBattles, 'btn btn-success');

        // 🔴 Reset Game Button
        const resetBtn = createButton('🗑️ Reset Game', resetGameData, 'btn btn-warning');
        resetBtn.style.color = 'black';
        resetBtn.style.marginTop = '12px';

        // Close Button
        const closeBtn = createButton('❌ Close', () => {
            document.body.removeChild(settingsPanel);
            settingsPanel = null;
        }, 'btn btn-success');
        settingsPanel.append(
            soundToggle, document.createElement('br'),
            volumeSlider, document.createElement('br'), document.createElement('br'),
            starterBtn, document.createElement('br'), document.createElement('br'),
            randomBattleToggle, document.createElement('br'), document.createElement('br'),
            resetBtn, document.createElement('br'), document.createElement('br'),
            closeBtn
        );
    }

    function renderFilteredList(names, container, searchEl) {
        const filter = searchEl.value.toLowerCase();
        container.innerHTML = '';
        names
            .filter(name => name.includes(filter))
            .slice(0, 50) // limit to 50 results for performance
            .forEach(name => {
            const btn = createButton(name[0].toUpperCase() + name.slice(1), () => {
                setStr(STORAGE.starter, name);
                fetchPartner(name);
                closeStarter();
            }, 'btn btn-success');
            btn.style.margin = '2px';
            container.appendChild(btn);
        });
    }

    function closeStarter() {
        if (starterPanel) document.body.removeChild(starterPanel);
        starterPanel = null;
        renderHeader();
    }

    // === CSS Animations ===
    // === CSS Animations ===
    const style = document.createElement('style');
    style.textContent = `
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
        stats.xp += amount;
        let leveledUp = false;

        while (stats.xp >= XP_TO_LEVEL(stats.level)) {
            stats.xp -= XP_TO_LEVEL(stats.level);
            stats.level++;
            stats.hp += 10;
            stats.atk += 5;
            leveledUp = true;
            alert(`🎉 ${partnerName} leveled up to ${stats.level}! HP and ATK increased.`);
        }

        setStats(starterName, stats);
        if (leveledUp) evolvePartner();
        renderHeader();
    }

    function evolvePartner() {
        const stats = getStats(starterName);
        GM.xmlHttpRequest({
            method: 'GET',
            url: `https://pokeapi.co/api/v2/pokemon-species/${starterName.toLowerCase()}`,
            onload(res) {
                const species = JSON.parse(res.responseText);
                GM.xmlHttpRequest({
                    method: 'GET',
                    url: species.evolution_chain.url,
                    onload(evRes) {
                        const chain = JSON.parse(evRes.responseText).chain;
                        let current = chain;
                        let found = false;

                        // Traverse the chain to find the current Pokémon
                        while (current && !found) {
                            if (current.species.name === starterName.toLowerCase()) {
                                found = true;
                                break;
                            }
                            if (current.evolves_to.length) {
                                current = current.evolves_to[0];
                            } else break;
                        }

                        // ✅ Stop if already in final evolution form
                        if (!found || current.evolves_to.length === 0) {
                            return; // Already fully evolved
                        }

                        const nextForm = current.evolves_to[0];
                        const nextName = nextForm.species.name;
                        const evoDetails = nextForm.evolution_details[0];

                        // ✅ Evolve only if it's a level-up and min_level is defined
                        if (evoDetails?.trigger?.name === 'level-up' && typeof evoDetails.min_level === 'number') {
                            const requiredLevel = evoDetails.min_level;

                            if (stats.level >= requiredLevel) {
                                const oldStats = getStats(starterName);
                                setStr(STORAGE.starter, nextName);
                                fetchPartner(nextName);
                                setStats(nextName, { ...oldStats });
                                alert(`✨ Your Pokémon evolved into ${nextName[0].toUpperCase() + nextName.slice(1)}!`);
                            }
                        }
                    }
                });
            }
        });
    }

    // === Battle System ===
    let battlePanel, wild, pHP, wHP, wMaxHP;
    function openBattle() {
        if (battlePanel) return;
        battlePanel = document.createElement('div');
        battlePanel.classList += ' pixel-frame';
        Object.assign(battlePanel.style, {
            position:'fixed', top:'50%', left:'50%', transform:'translate(-50%,-50%)',
            color:'#fff', padding:'0px',
            zIndex:'10000', width:'280px'
        });
        document.body.appendChild(battlePanel);
        if (getBool(STORAGE.soundOn)) {
            SOUNDS.battleSound.play();
        }
        startBattle();
    }
    function startBattle() {
        const id = Math.floor(Math.random() * 649) + 1;

        GM.xmlHttpRequest({
            method: 'GET',
            url: `https://pokeapi.co/api/v2/pokemon/${id}`,
            onload(res) {
                const d = JSON.parse(res.responseText);
                const baseName = d.name[0].toUpperCase() + d.name.slice(1);

                const { isShiny, formName, displayName } = getRandomForm(baseName);

                // Use Showdown sprite URLs with form-safe names
                let showdownName = formName.toLowerCase().replace(/[^a-z0-9-]/g, '');
                showdownName = SPRITE_NAME_FIXES[showdownName] || showdownName;

                const sprite = isShiny
                ? `https://play.pokemonshowdown.com/sprites/ani-shiny/${showdownName}.gif`
                : `https://play.pokemonshowdown.com/sprites/ani/${showdownName}.gif`;

                wild = {
                    name: displayName,
                    baseName: d.name,
                    sprite: sprite,
                    formName: formName,
                    isShiny: isShiny
                };

                const baseHP = d.stats.find(s => s.stat.name === 'hp').base_stat;
                const baseAtk = d.stats.find(s => s.stat.name === 'attack')?.base_stat || 10;

                const myStats = getStats(starterName);
                const myLevel = myStats.level;

                const hpMultiplier = 8;
                wMaxHP = Math.floor(baseHP + myLevel * hpMultiplier);
                pHP = myStats.currentHP;
                wHP = wMaxHP;

                // ✅ Save scaled wild attack stat
                wild.baseAtk = Math.floor(baseAtk + myLevel * 1.0);


                drawBattle();
            }
        });
    }
    function drawBattle(msg) {
        battlePanel.innerHTML = '';
        const main = document.createElement('div');
        if (msg) main.append(Object.assign(document.createElement('div'), { textContent: msg }));
        const info = document.createElement('div');

        Object.assign(main.style,{
            background: 'RGB(53, 35, 87)',
            zIndex: '1000',
            position: 'relative'
        });
        info.classList += ' text-capitalize text-center';
        info.innerHTML = `You HP: ${pHP}<br>${wild.name} HP: ${wHP}/${wMaxHP}`;
        info.innerHTML += `<br>Form: ${wild.form || 'Normal'} | Shiny: ${wild.isShiny ? 'Yes' : 'No'}`;
        const partnerLevel = getStats(starterName).level;
        const rarity = getRarity(wild.name);
        const rarityPenalty = { common: 1, uncommon: 1.2, rare: 1.5, legendary: 2 }[rarity];
        let chance = ((wMaxHP - wHP) / wMaxHP) / rarityPenalty + (partnerLevel * 0.01);
        if (wildSleepTurns > 0) chance += 0.2;
        chance = Math.min(0.95, Math.max(0.1, chance));
        info.innerHTML += `<br>Catch Chance: ${(chance * 100).toFixed(1)}%`;

        const img = document.createElement('img');
        img.src = wild.sprite;
        img.id = 'wild-img';
        img.classList += ' w-auto';
        Object.assign(img.style, {
            width: '42',
            display: 'block',
            animation: 'bobWalk 1.2s infinite',
            transformOrigin: 'center'
        });

        const ctl = document.createElement('div');
        Object.assign(ctl.style, { display:'flex', flexWrap:'wrap', gap:'6px', marginTop:'8px' });
        [
            { txt:'⚔️ Attack', fn:playerAttack },
            { txt:`⭕ Ball (${getInt(STORAGE.balls)})`, fn:throwBall },
            { txt:`🧪 Potion (${getInt(STORAGE.potions)})`, fn:usePotion },
            { txt:'🏃 Run', fn:runAway }
        ].forEach(a => {
            const b = createButton(a.txt, a.fn);
            b.style.flex = '1';
            ctl.appendChild(b);
        });

        // ✅ Add Sleep Powder Button Below
        const sleepBtn = createButton('🌙 Sleep Powder', () => {
            wildSleepTurns = 1;
            drawBattle(`${wild.name} fell asleep!`);
        });
        sleepBtn.style.flex = '1';
        ctl.appendChild(sleepBtn);

        main.append(img, info);
        main.appendChild(ctl);
        battlePanel.append(main);

    }
    function animateHit() {
        const el = document.getElementById('wild-img');
        if (el) {
            el.style.animation = 'none'; // Clear all animations
            el.offsetHeight; // Force reflow
            el.style.animation = 'shake 0.3s, bobWalk 1.2s infinite'; // Apply shake + bob
        }
    }
    function animatePartnerHit() {
        if (!spriteEl) return;

        spriteEl.style.animation = 'none'; // Reset
        spriteEl.offsetHeight; // Force reflow
        spriteEl.style.animation = 'shake 0.3s, flash 0.3s, bobWalk 0.6s infinite';
    }
    function playerAttack() {
        const atk = getStats(starterName).atk;
        const dmg = Math.floor(atk * (0.8 + Math.random()*0.4));
        wHP = Math.max(0, wHP - dmg);
        animateHit();
        playSound('hit');
        if (wHP <= 0) winBattle();
        else { drawBattle(`You hit for ${dmg}!`); setTimeout(wildAttack, 500); }
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
        console.log(stats);

        animatePartnerHit();
        playSound('hit');
        setTimeout(() => setHP(pHP), stats.hp);
        renderHeader();
        if (pHP <= 0) {
            SOUNDS.battleSound.pause();
            SOUNDS.battleSound.currentTime = 0;
            playSound('lose');
            drawBattle(`You were knocked out...`);
            setTimeout(closeBattle, 1500);
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
        if (rarity === 'uncommon') {
            xp *= 1.2;
            reward = Math.floor(reward * 1.3);
        } else if (rarity === 'rare') {
            xp *= 1.5;
            reward = Math.floor(reward * 1.6);
        } else if (rarity === 'legendary') {
            xp *= 2.5;
            reward = Math.floor(reward * 3);
        }

        setInt(STORAGE.coins, getInt(STORAGE.coins) + reward);
        gainXP(Math.floor(xp));
        SOUNDS.battleSound.pause();
        SOUNDS.battleSound.currentTime = 0;
        playSound('victory');
        drawBattle(`You defeated ${wild.name}! +${reward} coins, +${wMaxHP} XP`);
        setTimeout(closeBattle, 1500);
    }
    function throwBall() {
        const useBall = prompt("Which ball? (poke, great, ultra, master)", "poke").toLowerCase();

        let key, bonus, isMaster = false;
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
        playSound('ball');

        const partnerLevel = getStats(starterName).level;
        const rarity = getRarity(wild.name);
        const rarityPenalty = { common: 1, uncommon: 1.2, rare: 1.5, legendary: 2 }[rarity];
        let chance = ((wMaxHP - wHP) / wMaxHP) / rarityPenalty + (partnerLevel * 0.01) + bonus;
        if (wildSleepTurns > 0) chance += 0.2;
        chance = Math.min(0.95, Math.max(0.1, chance));

        if (isMaster || Math.random() < chance) catchIt();
        else { drawBattle(`It broke free from the ${useBall} ball!`); setTimeout(wildAttack, 500); }
    }
    function catchIt() {
        // 1) add to your party
        const party = getObj(STORAGE.party);
        const key = wild.name.toLowerCase();
        party[key] = (party[key] || 0) + 1;
        setObj(STORAGE.party, party);

        // 2) record into the Pokédex
        GM.xmlHttpRequest({
            method: 'GET',
            url: `https://pokeapi.co/api/v2/pokemon/${key}`,
            onload(res) {
                try {
                    const d = JSON.parse(res.responseText);
                    recordPokedex({
                        id:        d.id,
                        name:      d.name[0].toUpperCase() + d.name.slice(1),
                        spriteUrl: d.sprites.front_default,
                        types:     d.types.map(t=>t.type.name)
                    });
                } catch (err) {
                    console.warn('Pokédex record failed', err);
                }

                // 3) rest of your catch flow
                SOUNDS.battleSound.pause();
                SOUNDS.battleSound.currentTime = 0;
                playSound('catch');
                drawBattle(`Caught ${wild.name}!`);
                setTimeout(closeBattle, 1500);
            },
            onerror(err) {
                console.warn('Failed to fetch Pokémon for Pokédex:', err);
                // still finish the catch
                SOUNDS.battleSound.pause();
                SOUNDS.battleSound.currentTime = 0;
                playSound('catch');
                drawBattle(`Caught ${wild.name}!`);
                setTimeout(closeBattle, 1500);
            }
        });
    }

    function usePotion() {
        if (getInt(STORAGE.potions) <= 0) return drawBattle('No Potions!');

        setInt(STORAGE.potions, getInt(STORAGE.potions) - 1);

        const stats = getStats(starterName);
        const newHP = Math.min(stats.hp, pHP + 30); // Don't exceed max HP
        setHP(newHP); // ✅ This triggers the animation too
        pHP = newHP; // ✅ Update your local HP value

        drawBattle('You used a Potion.');
        renderHeader();

        setTimeout(wildAttack, 500);
    }

    function runAway() {
        SOUNDS.battleSound.pause();
        SOUNDS.battleSound.currentTime = 0;
        playSound('run');
        drawBattle('You ran away!');
        setTimeout(closeBattle, 500);
    }
    function closeBattle() {
        if (battlePanel) document.body.removeChild(battlePanel);
        battlePanel = null;
        renderHeader();
    }

    // === Shop System ===
    let shopPanel;
    function openShop() {
        if (shopPanel) return;
        shopPanel = document.createElement('div');
        Object.assign(shopPanel.style, {
            position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
            padding: '12px', border: '2px solid black', background: '#fff', color: '#000', zIndex: '10000'
        });
        document.body.appendChild(shopPanel);
        drawShop();
    }
    function drawShop(msg) {
        shopPanel.innerHTML = '';
        if (msg) shopPanel.appendChild(Object.assign(document.createElement('div'), { textContent: msg }));
        [
            { name: 'Poké Ball', key: STORAGE.balls, price: 20 },
            { name: 'Great Ball', key: 'pkm_great_balls', price: 50 },
            { name: 'Ultra Ball', key: 'pkm_ultra_balls', price: 100 },
            { name: 'Potion', key: STORAGE.potions, price: 10 }
        ].forEach(item => {
            const row = document.createElement('div');
            row.style.display = 'flex';
            row.style.justifyContent = 'space-between';
            row.style.margin = '6px 0';
            const lbl = document.createElement('span');
            lbl.textContent = `${item.name} x${getInt(item.key)}`;
            const btn = createButton(`Buy (${item.price})`, () => {
                if (getInt(STORAGE.coins) < item.price) return drawShop('Not enough coins.');
                setInt(STORAGE.coins, getInt(STORAGE.coins) - item.price);
                setInt(item.key, getInt(item.key) + 1);
                drawShop(`Bought 1 ${item.name}.`);
            }, 'btn btn-success');
            row.append(lbl, btn);
            shopPanel.appendChild(row);
        });
        const closeBtn = createButton('❌ Close', closeShop, 'btn btn-success');
        closeBtn.style.marginTop = '10px';
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
        legendary: 300
    };

    function getRarity(name) {
        const legendaries = ['mewtwo','lugia','ho-oh','rayquaza','dialga','palkia','giratina','zekrom','reshiram','xerneas','yveltal','zacian','zamazenta','eternatus'];
        const rares = ['dragonite','tyranitar','salamence','metagross','garchomp','hydreigon','goodra','dragapult'];
        const uncommons = ['pikachu','eevee','lucario','snorlax','gengar'];

        name = name.toLowerCase();
        if (legendaries.includes(name)) return 'legendary';
        if (rares.includes(name)) return 'rare';
        if (uncommons.includes(name)) return 'uncommon';
        return 'common';
    }


    function openBag() {
        if (bagPanel) return;
        bagPanel = document.createElement('div');
        Object.assign(bagPanel.style, {
            position: 'fixed',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            background: '#fff',
            color: '#000',
            padding: '12px',
            border: '2px solid black',
            zIndex: '10000',
            maxHeight: '80vh',
            overflowY: 'auto'
        });
        bagPanel.classList = 'w-auto';
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
            { name: 'Poké Ball', key: STORAGE.balls },
            { name: 'Great Ball', key: 'pkm_great_balls' },
            { name: 'Ultra Ball', key: 'pkm_ultra_balls' }
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
        bagPanel.innerHTML = '<strong>Your Pokémon Bag:</strong><br>';

        // Sort Controls
        const sortOptions = document.createElement('div');
        sortOptions.style.margin = '6px 0';
        sortOptions.innerHTML = 'Sort by: ';
        let currentSort = 'name';
        ['name', 'rarity', 'quantity'].forEach(crit => {
            const btn = createButton(crit, () => {
                currentSort = crit;
                drawBagSorted(currentSort, msg);
            });

            btn.style.marginRight = '6px';
            sortOptions.appendChild(btn);
        });
        bagPanel.appendChild(sortOptions);

        drawBagSorted(currentSort, msg);
    }
    function drawBagSorted(sortBy, msg) {
        const party = getObj(STORAGE.party);
        const names = Object.keys(party);
        const sorted = [...names].sort((a, b) => {
            if (sortBy === 'name') return a.localeCompare(b);
            if (sortBy === 'quantity') return party[b] - party[a];
            if (sortBy === 'rarity') {
                const ranks = { common: 1, uncommon: 2, rare: 3, legendary: 4 };
                return ranks[getRarity(b)] - ranks[getRarity(a)];
            }
            return 0;
        });

        const container = document.createElement('div');
        if (msg) {
            const m = document.createElement('div');
            m.textContent = msg;
            container.appendChild(m);
        }

        if (sorted.length === 0) {
            container.innerHTML += '<em>You haven’t caught any Pokémon yet.</em>';
        } else {
            sorted.forEach(name => {
                const count = party[name];
                const row = document.createElement('div');
                row.style.display = 'flex';
                row.style.alignItems = 'center';
                row.style.justifyContent = 'space-between';
                row.style.margin = '4px 0';

                const img = document.createElement('img');
                let isShiny = name.toLowerCase().includes('shiny');
                let rawName = name.toLowerCase().replace('shiny ', ''); // remove "Shiny " if present

                // Fix known form names if needed (optional: use SPRITE_NAME_FIXES here)
                if (SPRITE_NAME_FIXES[rawName]) {
                    rawName = SPRITE_NAME_FIXES[rawName];
                }

                img.src = `https://play.pokemonshowdown.com/sprites/${isShiny ? 'ani-shiny' : 'ani'}/${rawName}.gif`;

                img.style.width = '40px';

                const lbl = document.createElement('span');
                lbl.textContent = `${name} x${count}`;

                const rarity = getRarity(name);
                const stats = getStats(name);
                const level = stats.level || 1;

                const baseValues = {
                    common: 2,
                    uncommon: 5,
                    rare: 10,
                    legendary: 20
                };

                const value = baseValues[rarity] * (level + 1);

                const btnSet = createButton('Set Active', () => {
                    const oldStarter = getStr(STORAGE.starter);
                    if (oldStarter && oldStarter !== name) {
                        const party = getObj(STORAGE.party);
                        const oldName = oldStarter.toLowerCase();
                        party[oldName] = (party[oldName] || 0) + 1; // add old starter to bag

                        if (--party[name] <= 0) delete party[name]; // remove one instance of new starter from bag

                        setObj(STORAGE.party, party);
                    }

                    setStr(STORAGE.starter, name);
                    fetchPartner(name);
                    renderHeader();
                });

                const btnSell = createButton(`Sell (${value}c)`, () => {
                    const p = getObj(STORAGE.party);
                    if (--p[name] <= 0) delete p[name];
                    setObj(STORAGE.party, p);
                    setInt(STORAGE.coins, getInt(STORAGE.coins) + value);
                    drawBagSorted(sortBy, `${name} sold for ${value} coins.`);
                });

                const controls = document.createElement('div');
                controls.appendChild(btnSet);
                controls.appendChild(btnSell);

                const left = document.createElement('div');
                left.style.display = 'flex';
                left.style.alignItems = 'center';
                left.style.gap = '6px';
                left.appendChild(img);
                left.appendChild(lbl);

                row.append(left, controls);
                container.appendChild(row);
            });
        }

        bagPanel.innerHTML = '<strong>Your Pokémon Bag:</strong><br>';
        bagPanel.appendChild(container);
        const closeBtn = createButton('❌ Close', closeBag);
        closeBtn.style.marginTop = '10px';
        bagPanel.appendChild(closeBtn);
    }
    function closeBag() {
        if (bagPanel) document.body.removeChild(bagPanel);
        bagPanel = null;
        renderHeader();
    }
    function resetGameData() {
        if (!confirm("⚠️ Are you sure you want to reset your game? This cannot be undone.")) return;

        const keys = Object.values(STORAGE).concat([
            'pkm_great_balls',
            'pkm_ultra_balls',
            'pkm_random_battles'
        ]);

        for (const key of keys) {
            GM_setValue(key, null);
        }

        alert("Game reset complete. Reloading...");
        location.reload();
    }

    // Added //
    function syncCSS(url,id){
        const ex=[...document.head.querySelectorAll('link[rel="stylesheet"]')].find(l=>l.href.includes(id));
        if(ex) ex.href=url; else {
            const l=document.createElement('link');
            l.rel='stylesheet'; l.href=url;
            document.head.appendChild(l);
        }
    }
    function syncJS(url,id){
        const ex=[...document.head.querySelectorAll('script[src]')].find(s=>s.src.includes(id));
        if(ex) ex.src=url; else {
            const s=document.createElement('script');
            s.src=url;
            document.head.appendChild(s);
        }
    }

    // Start Call css and JS Then Render Header //
    syncCSS('https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css','bootstrap@');
    syncJS ('https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js','bootstrap.bundle');
    syncCSS('https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.min.css','bootstrap-icons');
    renderHeader();
    initPartner();
    if (randomBattleEnabled) scheduleRandomBattle();

    // 🔁 Update the random battle timer every second
    setInterval(() => {
        const now = Date.now();
        if ((randomBattleEnabled && nextBattleTime) || getInt(STORAGE.pokestopCooldown) > now) {
            renderHeader();
        }
    }, 1000);


    unsafeWindow.changePokemon = name => { GM_setValue(STORAGE.starter, name); fetchPartner(name); };
})();

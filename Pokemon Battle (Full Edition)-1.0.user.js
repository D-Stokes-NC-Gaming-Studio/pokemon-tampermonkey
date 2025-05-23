// ==UserScript==
// @name        Pokemon Battle (Full Edition)
// @author      JellxWrld(@diedrchr), DStokesNCStudio9@esrobbie)
// @connect     pokeapi.co
// @namespace   dstokesncstudio.com
// @version     1.2
// @description Full version with XP, evolution, stats, sound, shop, battles, and walking partner — persistent across sites.
// @include     *
// @grant       GM.xmlHttpRequest
// @grant       unsafeWindow
// @grant       GM_getValue
// @grant       GM_setValue
// ==/UserScript==

(function() {
'use strict';

// --- Blocklist: Add domains or paths you want to skip ---
const BLOCKLIST = [
  /:\/\/www\.facebook\.com\/adsmanager\//, // Example: Facebook ads manager
  /:\/\/ads\.google\./, // Google Ads
  /:\/\/doubleclick\.net\//, // DoubleClick ad domains
  // Add more patterns as needed
];

// Check if current URL matches any blocklist rule
if (BLOCKLIST.some(rx => rx.test(location.href))) return;

// In addition to the above blocklist:
if (
  window.location.hostname.endsWith('youtube.com') &&
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
  volume: 'pkm_volume'
};

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

// Initialize defaults if needed
if (!GM_getValue(STORAGE.coins)) setInt(STORAGE.coins, 100);
if (!GM_getValue(STORAGE.balls)) setInt(STORAGE.balls, 5);
if (!GM_getValue(STORAGE.potions)) setInt(STORAGE.potions, 2);
if (!GM_getValue(STORAGE.greatBalls)) setInt(STORAGE.greatBalls, 0);
if (!GM_getValue(STORAGE.ultraBalls)) setInt(STORAGE.ultraBalls, 0);
if (!GM_getValue(STORAGE.masterBalls)) setInt(STORAGE.masterBalls, 0);
if (!GM_getValue(STORAGE.pokestopCooldown)) setInt(STORAGE.pokestopCooldown, 0);
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
  stop: new Audio('')
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
let battleSound = new Audio('https://github.com/jellowrld/pokemon-tampermonkey/raw/refs/heads/main/wildbattle.mp3');
battleSound.loop = true;

// --- UI and rendering ---
Object.assign(wrap.style, {
  position:'fixed', bottom:'0', left:'0', background:'rgba(0,0,0,0.7)',
  color:'#fff', padding:'8px', fontFamily:'sans-serif', fontSize:'14px',
  zIndex:'9999', display:'flex', flexDirection:'column', gap:'4px'
});
document.body.appendChild(wrap);

function createButton(label, onClick) {
  const btn = document.createElement('button');
  btn.textContent = label;
  btn.style.border = '1px solid black';
  btn.style.padding = '4px 8px';
  btn.style.color = 'black';
  btn.style.background = '#fff';
  btn.onclick = onClick;
  return btn;
}

function renderHeader() {
  wrap.innerHTML = '';

  const storedStarter = getStr(STORAGE.starter);
  const stats = storedStarter ? getStats(storedStarter) : { xp: 0, level: 1, hp: 100, atk: 15 };
  const lvl = stats.level;
  const xp = stats.xp;

  const p = document.createElement('div');
  p.id = 'pkm-partner';
  p.textContent = storedStarter
    ? `Partner: ${storedStarter[0].toUpperCase() + storedStarter.slice(1)} (Lv ${lvl}) - XP: ${xp}/${XP_TO_LEVEL(lvl)} | HP: ${stats.hp} | ATK: ${stats.atk}`
    : 'Choose your starter!';
  wrap.appendChild(p);

  const s = document.createElement('div');
let timerStr = '';
if (nextBattleTime && randomBattleEnabled) {
  const delta = Math.max(0, nextBattleTime - Date.now());
  const minutes = Math.floor(delta / 60000);
  const seconds = Math.floor((delta % 60000) / 1000);
  timerStr += ` | Next Battle: ${minutes}m ${seconds}s`;
}

const pokestopTime = getInt(STORAGE.pokestopCooldown);
if (pokestopTime && pokestopTime > Date.now()) {
  const remaining = pokestopTime - Date.now();
  const m = Math.floor(remaining / 60000);
  const s = Math.floor((remaining % 60000) / 1000);
  timerStr += ` | PokéStop: ${m}m ${s}s`;
} else {
  timerStr += ` | PokéStop: Ready!`;
}
s.textContent = `Coins: ${getInt(STORAGE.coins)} | Balls: ${getInt(STORAGE.balls)} | Potions: ${getInt(STORAGE.potions)}${timerStr}`;
wrap.appendChild(s);

  const row = document.createElement('div');
  row.style.display = 'flex';
  row.style.gap = '6px';

  row.appendChild(createButton('⚔️ Battle', openBattle));
  row.appendChild(createButton('📍 PokéStop', openPokeStop));
  row.appendChild(createButton('🛒 Shop', openShop));
  row.appendChild(createButton('🎒 Bag', openBag));
  row.appendChild(createButton('⚙️ Settings', openSettings));


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
  starterName = name;
  partnerName = name[0].toUpperCase() + name.slice(1);
  partnerSpriteUrl = `https://play.pokemonshowdown.com/sprites/ani/${name.toLowerCase()}.gif`;
  renderHeader();
  spawnWalkingSprite();
}

// --- Walking sprite ---
function spawnWalkingSprite() {
  if (spriteEl) spriteEl.remove();
  if (walkInterval) clearInterval(walkInterval);

  // Outer wrapper to handle flipping
  const wrapper = document.createElement('div');
  Object.assign(wrapper.style, {
    position: 'fixed',
    bottom: '64px', // just above your UI bar
    left: '0px',
    width: '64px',
    height: '64px',
    zIndex: '9999',
    pointerEvents: 'none',
    overflow: 'visible'
  });

  // Sprite image element (bobbing animation goes here)
  spriteEl = document.createElement('img');
  spriteEl.id = 'pkm-partner-sprite';
  spriteEl.src = `https://play.pokemonshowdown.com/sprites/ani/${starterName.toLowerCase()}.gif`;
  spriteEl.alt = partnerName || 'partner';
  Object.assign(spriteEl.style, {
    width: '64px',
    height: '64px',
    imageRendering: 'pixelated',
    animation: 'bobWalk 0.6s infinite'
  });

  wrapper.appendChild(spriteEl);
  document.body.appendChild(wrapper);

  let posX = 0;
  let dir = 1; // 1 = right, -1 = left
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
    wrapper.style.transform = `scaleX(${dir === 1 ? -1 : 1})`; // ✅ correct direction flip
  }, 30);
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

  const cancel = createButton('🚫 Cancel', closeStarter);
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
  document.body.appendChild(settingsPanel);

  renderSettings();
}

function renderSettings() {
  if (!settingsPanel) return;
  settingsPanel.innerHTML = '<strong>Settings</strong><br><br>';

  // Sound On/Off Toggle
  const soundToggle = createButton(`Sound: ${getBool(STORAGE.soundOn) ? 'On' : 'Off'}`, () => {
    setBool(STORAGE.soundOn, !getBool(STORAGE.soundOn));
    renderSettings();
  });

  // Volume Slider
  const volumeSlider = document.createElement('input');
  volumeSlider.type = 'range';
  volumeSlider.min = 0;
  volumeSlider.max = 1;
  volumeSlider.step = 0.01;
  volumeSlider.value = getStr(STORAGE.volume, '0.4');
  volumeSlider.style.width = '100%';
  volumeSlider.oninput = () => {
    setStr(STORAGE.volume, volumeSlider.value);
    Object.values(SOUNDS).forEach(a => {
  a.volume = parseFloat(volumeSlider.value);
});
  };

  // Change Starter
  const starterBtn = createButton('🔄 Change Starter', openStarter);

  // Random Battle Toggle
  const randomBattleToggle = createButton(`Random Battles: ${randomBattleEnabled ? 'On' : 'Off'}`, toggleRandomBattles);

  // 🔴 Reset Game Button
  const resetBtn = createButton('🗑️ Reset Game', resetGameData);
  resetBtn.style.color = 'red';
  resetBtn.style.marginTop = '12px';

  // Close Button
  const closeBtn = createButton('❌ Close', () => {
  document.body.removeChild(settingsPanel);
  settingsPanel = null;
});
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
      });
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
  Object.assign(battlePanel.style, {
    position:'fixed', top:'50%', left:'50%', transform:'translate(-50%,-50%)',
    background:'#222', color:'#fff', padding:'12px', border:'2px solid #fff',
    zIndex:'10000', width:'280px'
  });
  document.body.appendChild(battlePanel);
  battleSound.play();
  startBattle();
}
function startBattle() {
  const id = Math.floor(Math.random()*649)+1;
  GM.xmlHttpRequest({ method:'GET', url:`https://pokeapi.co/api/v2/pokemon/${id}`, onload(res) {
    const d = JSON.parse(res.responseText);
    wild = { name:d.name[0].toUpperCase()+d.name.slice(1), sprite:d.sprites.front_default };
    const baseHP = d.stats.find(s => s.stat.name === 'hp').base_stat;
    const myStats = getStats(starterName);
    const myLevel = myStats.level;

// Scale wild HP
    const hpMultiplier = 8; // Tune as needed
    wMaxHP = Math.floor(baseHP + myLevel * hpMultiplier);
    wHP = pHP = myStats.hp;

    drawBattle();
  }});
}
function drawBattle(msg) {
  battlePanel.innerHTML = '';
  if (msg) battlePanel.append(Object.assign(document.createElement('div'), { textContent: msg }));
  const info = document.createElement('div');
  info.innerHTML = `You HP: ${pHP}<br>${wild.name} HP: ${wHP}/${wMaxHP}`;
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
Object.assign(img.style, {
  width: '80px',
  display: 'block',
  animation: 'bobWalk 1.2s infinite',
  transformOrigin: 'center'
});

  battlePanel.append(img, info);
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

battlePanel.appendChild(ctl);
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
  const baseDmg = 5 + Math.random() * 10;
  const dmg = Math.floor(baseDmg + myLevel * 0.5);

  pHP = Math.max(0, pHP - dmg);
  animatePartnerHit();
  playSound('hit');

  if (pHP <= 0) {
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
  battleSound.pause();
  battleSound.currentTime = 0;
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
  const party = getObj(STORAGE.party);
  const name = wild.name.toLowerCase();
  party[name] = (party[name] || 0) + 1;
  setObj(STORAGE.party, party);
  battleSound.pause();
  battleSound.currentTime = 0;
  playSound('catch');
  drawBattle(`Caught ${wild.name}!`);
  setTimeout(closeBattle, 1500);
}
function usePotion() {
  if (getInt(STORAGE.potions) <= 0) return drawBattle('No Potions!');
  setInt(STORAGE.potions, getInt(STORAGE.potions) - 1);
  pHP = Math.min(getStats(starterName).hp, pHP + 30);
  drawBattle('You used a Potion.');
  setTimeout(wildAttack, 500);
}
function runAway() {
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
    });
    row.append(lbl, btn);
    shopPanel.appendChild(row);
  });
  const closeBtn = createButton('❌ Close', closeShop);
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
    overflowY: 'auto',
    width: '320px'
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
      img.src = `https://play.pokemonshowdown.com/sprites/ani/${name}.gif`;
      img.style.width = '40px';

      const lbl = document.createElement('span');
      lbl.textContent = `${name[0].toUpperCase() + name.slice(1)} x${count}`;

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

# Pokémon Battle (Full Edition)

A browser-based Pokémon game built as a **Tampermonkey userscript**. Battle, catch, evolve and train Pokémon on **any website**, with your starter walking along the bottom of the page.

Current version: **3.8.0.0** (`Pokemon Battle (Full Edition)-3.0.0.6.user.js`).

---

## 🌟 Features

### 🎮 Core gameplay
- **Starter selection** from **1000+ species** with a searchable list.
- **Turn-based battles** with real stat formulas, natures, IVs, STAB, critical hits, type effectiveness, abilities and held items.
- **Catch and collect**: Poké, Great, Ultra and Master Balls, a shiny chain, and a shiny charm.
- **Levels and evolution**: XP, level-ups, new moves, and evolution from PokéAPI data (including evolution stones).
- **Walking companion** that follows you across pages, with reactions and a nap mode.
- **Party of six** plus storage boxes, sorting, selling, and a Pokémon Center that heals your party for a fee.

### ⚔️ Battle engine
- **Move types**: attacks plus status moves (stat boosts and drops, Thunder Wave, Toxic, Recover, Rest, Protect, Substitute, Reflect, Light Screen, Stealth Rock, Spikes, Toxic Spikes, weather and terrain moves).
- **Move effects**: flinching, confusion, multi-hit, two-turn (Fly, Solar Beam), recharge, fixed-damage, self-KO, and accuracy and evasion stages.
- **Weather and terrain** (rain, sun, sand, hail, and four terrains) with abilities that set them.
- **90+ abilities** and **about 50 held items** with battle effects.
- **One special action per battle**: Mega Evolution (Mega Ring), Z-Moves (Z-Ring), Terastallization (Tera Orb) or Dynamax/Gigantamax (Dynamax Band).
- **Difficulty** (Easy, Normal, Hard), **battle speed** (1×, 2×, 4×) and **skip animations**.

### 🗺️ Regions, trainers and places
- **Six regions** (Kanto, Johto, Hoenn, Sinnoh, Unova, Kalos) with **48 Gyms**, an Elite Four and Champion for each. A region opens after you beat the previous Champion.
- **League rematches** with stronger teams after you become Champion.
- **World map** with six places per region, each with its own Pokémon, levels, trainers and items. Walk around like in the Safari Zone.
- **Safari Zone** with bait, rocks and Safari Balls.
- **Wild levels follow your badge progress** (not your partner's level). You can switch to *Mixed* or *Match my Pokémon* in Options or on the map.
- **Day and night** change which Pokémon appear, and **seasonal events** add costume Pokémon.

### 🏟️ Challenges and facilities
- **Battle Tower**: endless win streaks with a Frontier Brain every 7th battle.
- **Battle Frontier**: Battle Factory (rental teams), Battle Arcade (roulette boosts) and Battle Pike (pick a door).
- **Rival** with eight stages that grow with your progress.
- **Legendary hunt**: 44 legendary Pokémon unlocked by badges, Champions and Pokédex progress.
- **Raid den**: a shared boss every 3 hours with allies, a turn limit, rewards and a catch chance.
- **Contests** with ribbons, a **Berry garden**, and **Story quest chains** with recurring characters.
- **Daily quests**, **daily login rewards**, **achievements**, and a **trainer card** with badges, weekly stats and a Hall of Fame.

### 🥚 Training and breeding
- **Daycare and Eggs** that hatch as you browse (steps count while a page is open and for each page you visit).
- **Training center**: EVs (from battles, vitamins and a passive training area), Nature Mints, Ability Capsule and Patch, Tera Shards.
- **Hidden abilities** and **egg moves**.
- **Pokédex prizes** for each region at 25%, 50%, 75% and 100%.

### 🔗 Sharing
- **Friend battles** with a team code (no coins or XP).
- **Trades** with one-for-one offer codes.
- **Mystery Gift** codes, and gift codes you can send to friends.

### 💼 Inventory and shop
- **Bag**: manage Pokémon and items, give held items, and teach moves.
- **PokéMart**: balls, medicine, battle items, held items, evolution stones, vitamins, mints and key items.
- **PokéStop**: free loot every few minutes, including rare Master Balls.

### ⚙️ Options, tools and saving
- **Options & tools**: difficulty, speed, wild level mode, **saved team presets**, a **damage calculator**, **battle logs with replay**, and a **What's new** screen.
- **Persistent data** is stored with `GM_setValue`, so progress carries across sessions and sites.
- **Backups and export/import** are in Settings: automatic backups plus export and import of a save file.
- **Per-site control**: turn the game off on sites where you don't want it.

### 🔔 Sound and animation
- **Sound effects** from hosted audio files, plus built-in synthesized effects, with a mute button.
- **CSS animations**: bobbing, shaking, flashing, walking, and HP bars.
- Honors the browser's **reduced motion** setting.

### 🌐 Compatibility
- Runs on any page the userscript is allowed on (top page only, not iframes).
- The game lives in a **shadow root**, so site styles can't break it and its styles don't leak into the page.
- A small launcher and HUD sit at the bottom-left of the screen. Right-click the launcher to hide or show the HUD.

---

## 📦 Installation

You need **[Tampermonkey](https://www.tampermonkey.net/)** in your browser.

1. Install Tampermonkey.
2. Create a new userscript and paste in the code from `Pokemon Battle (Full Edition)-3.0.0.6.user.js` (or install it from a hosted URL if you have one).
3. Enable the script and open any website.
4. Choose your starter and begin your journey.

---

## 🧠 Technologies and APIs

- **JavaScript (ES2022)**, no build step and no server-side components.
- **[PokéAPI](https://pokeapi.co/)** for Pokémon, moves, species and evolution data. Responses are cached in Tampermonkey storage.
- **Tampermonkey API** (`GM_setValue`, `GM_getValue`, `GM.xmlHttpRequest`, and more).
- **Web Audio and HTML5 Audio** for sound, and the **DOM** for the UI.

---

## 🚧 Known limitations

- Battles are **singles only** for now (no double battles).
- Friend battles and trades use **share codes**. There is no live multiplayer, and codes work on the honor system.
- Gigantamax changes the Pokémon's look but has no signature G-Max moves.
- Data is stored **locally per browser profile**. Use Settings → Export to move a save to another computer.
- Some UI elements may overlap with certain websites, depending on their layout.

---

## 🛠️ Planned

- Double battles (and double friend battles).
- Galar and Alola.
- Signature G-Max moves, Tera Blast, and Terapagos-style Tera forms.
- Held Mega Stones for each species.
- Move tutors and TMs.
- A Pokédex entry screen with habitats.
- Mystery dungeons and timed map events.
- A trainer card rank and a seasonal Tower mode.

---

## 🧪 Developer notes

The script is self-contained and modular, and runs entirely in the browser. It builds its DOM dynamically and saves with Tampermonkey's storage API. Version 3.8 was checked with an automated test suite in headless Edge (battles, status moves, regions, facilities, saving, codes and panels).

---

🎮 Gotta catch 'em all, now from *any page* on the web!

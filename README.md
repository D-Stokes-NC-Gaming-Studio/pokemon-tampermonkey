# Pokémon Battle (Full Edition)

A fully immersive, browser-based Pokémon experience built using a **Tampermonkey userscript**. This game allows you to battle, catch, evolve, and train Pokémon right from **any website**—just like having your own pocket monster companion everywhere you browse.

---

## 🌟 Features

### 🎮 Gameplay
- **Starter Selection**: Choose your favorite Pokémon from over **1000 species** via a searchable list.
- **Turn-Based Battles**: Engage in battles against wild Pokémon using attacks, Poké Balls, potions, or Sleep Powder.
- **Catch & Collect**: Capture wild Pokémon and manage them in your bag.
- **Leveling & Evolution**: Gain XP, level up, and trigger evolution automatically using data from PokéAPI.
- **Walking Companion**: Your starter Pokémon visibly walks on your screen with animated movement.

### 💼 Inventory & Shop
- **Pokémon Bag**: View, sort, and manage your caught Pokémon. Set active partners or sell them for coins.
- **Items**: Use Poké Balls (Poke, Great, Ultra, Master), Potions, and Sleep Powder during battles.
- **PokéShop**: Buy new items with in-game coins.
- **PokéStop**: Get randomized loot every few minutes (Poké Balls, Coins, and rare Master Balls).

### ⚙️ Settings & Persistence
- **Persistent Data**: Progress is saved using `GM_setValue`, making it **persistent across sessions and sites**.
- **Database**: Progress is saved in database, making it where users can't edit pokemon stats and bag items.
- **Custom Settings**: Adjust sound volume, toggle random battles, or change your active Pokémon.
- **Game Reset**: Full data wipe and game reset available.

### 🔔 Sound & Animation (Work in-progress, need to find working sounds.)
- **Sound Effects**: Battle and catch events come with authentic Pokémon game sounds.
- **CSS Animations**: Includes bobbing, shaking, flashing, and walking effects.

### 🌐 Compatibility
- **Runs Anywhere**: Injected into any website.
- **Auto UI Rendering**: Overlays an unobtrusive control bar at the bottom-left corner of your screen.

---

## 📦 Installation

To use this userscript, you need **[Tampermonkey](https://www.tampermonkey.net/)** installed in your browser.

1. Install Tampermonkey.
2. Add this script manually by pasting in the code from `Pokemon Battle (Full Edition)-1.0.user.js`, or use a hosted URL if available.
3. Enable the script and visit any website.
4. Select your starter and begin your journey!

---

## 🧠 Technologies & APIs Used

- **JavaScript (ES6+)**
- **[PokéAPI](https://pokeapi.co/)** for real-time Pokémon data, sprites, evolution chains, and stats.
- **Tampermonkey API** (`GM_setValue`, `GM_getValue`, `GM.xmlHttpRequest`, etc.)
- **HTML5 Audio & DOM Manipulation** for UI and sound integration.
- **[PokéAPI Wrapper](https://dstokesncstudio.com/pokeapi/pokeapi.php)

---

## 🚧 Known Limitations

- Battles are limited to wild encounters (no PvP or trainer battles).
- Some UI elements may visually conflict with certain websites depending on layout.
- Data storage is local per browser/profile.

---

## 🛠️ Future Enhancements (Work in-progress)

- Multiplayer duels or AI trainers.
- Daily challenges or login rewards.
- Quest system or gym leaders.

---

## 🧪 Developer Notes

This script is entirely self-contained, modular, and operates purely in the client browser. It uses dynamic DOM creation and data persistence via Tampermonkey's API, requiring **no server-side components**.

---

🎮 Gotta catch 'em all — now from *any page* on the web!

export let POKEMON_DATA = null;
export const POKEMON_DATA_VERSION = 1;

export async function loadPokemonData() {
    // 1️⃣ In-memory cache
    if (POKEMON_DATA) return POKEMON_DATA;

    // 2️⃣ Try browser.storage.local
    try {
        if (browser?.storage?.local) {
            const stored = await browser.storage.local.get([
                "pokemonData",
                "pokemonDataVersion"
            ]);

            if (
                stored &&
                stored.pokemonData &&
                stored.pokemonDataVersion === POKEMON_DATA_VERSION
            ) {
                console.log("[PokemonData] Loaded from storage cache");
                POKEMON_DATA = stored.pokemonData;
                return POKEMON_DATA;
            }
        }
    } catch (e) {
        console.warn("[PokemonData] Failed to read from storage:", e);
    }

    // 3️⃣ Fetch from file inside the extension
    try {
        const url = browser.runtime.getURL("data/pokemonData.json");
        const res = await fetch(url);

        if (!res.ok) {
            throw new Error("Failed to load pokemonData.json: " + res.status);
        }

        const json = await res.json();
        POKEMON_DATA = json;

        // Save to storage for next time
        try {
            if (browser?.storage?.local) {
                await browser.storage.local.set({
                    pokemonData: json,
                    pokemonDataVersion: POKEMON_DATA_VERSION
                });
                console.log("[PokemonData] Cached to storage");
            }
        } catch (e) {
            console.warn("[PokemonData] Failed to write cache:", e);
        }

        return POKEMON_DATA;
    } catch (e) {
        console.error("[PokemonData] Failed to load from file:", e);
        POKEMON_DATA = null;
        return null;
    }
}
export async function getPokemonByDex(name) {
    const data = await loadPokemonData();
    if (!data) return null;

    // depends on your structure — examples:

    // 1) If it's a plain array: [{id: 1, name: "Bulbasaur"}, ...]
    // return data.find(p => p.id === num) || null;

    // 2) If it's an object keyed by id: { "1": {...}, "2": {...}, ... }
    return data[name] || data[String(name)] || null;
}
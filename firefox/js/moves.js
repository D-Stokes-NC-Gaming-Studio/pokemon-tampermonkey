// =======================
//  Moves data cache
// =======================
export let MOVES_DATA = null;
// bump this whenever you regenerate moves.json
export const MOVES_DATA_VERSION = 1;  

/**
 * Load moves.json, with in-memory + browser.storage.local cache.
 * File should live at: data/moves.json inside the extension.
 */
export async function loadMovesData() {
    // 1️⃣ In-memory cache
    if (MOVES_DATA) return MOVES_DATA;

    // 2️⃣ Try browser.storage.local cache
    try {
        if (browser?.storage?.local) {
            const stored = await browser.storage.local.get([
                "movesData",
                "movesDataVersion"
            ]);

            if (
                stored &&
                stored.movesData &&
                stored.movesDataVersion === MOVES_DATA_VERSION
            ) {
                console.log("[Moves] Loaded from storage cache");
                MOVES_DATA = stored.movesData;
                return MOVES_DATA;
            }
        }
    } catch (err) {
        console.warn("[Moves] Failed to read from storage:", err);
    }

    // 3️⃣ Fallback: fetch bundled JSON from extension
    try {
        const url = browser.runtime.getURL("data/moves.json");
        const res = await fetch(url);

        if (!res.ok) {
            throw new Error("Failed to load moves.json: " + res.status);
        }

        const json = await res.json();
        MOVES_DATA = json;

        // 4️⃣ Save to browser.storage.local for next time
        try {
            if (browser?.storage?.local) {
                await browser.storage.local.set({
                    movesData: json,
                    movesDataVersion: MOVES_DATA_VERSION
                });
                console.log("[Moves] Cached to storage");
            }
        } catch (err) {
            console.warn("[Moves] Failed to write cache:", err);
        }

        return MOVES_DATA;
    } catch (err) {
        console.error("[Moves] Load failed:", err);
        MOVES_DATA = null;
        return null;
    }
}

/**
 * Convenience helper: get a move by name or numeric id.
 * Assumes moves.json is an object keyed by id string: { "1": {...}, "2": {...}, ... }
 * and each entry has .name on it.
 */
export async function getMoveData(nameOrId) {
    const data = await loadMovesData();
    if (!data) return null;

    // try id lookup first
    if (nameOrId == null) return null;
    const key = String(nameOrId);
    if (data[key]) return data[key];

    // then fallback: search by name
    const lower = key.toLowerCase();
    return Object.values(data).find(m => m.name?.toLowerCase() === lower) || null;
}

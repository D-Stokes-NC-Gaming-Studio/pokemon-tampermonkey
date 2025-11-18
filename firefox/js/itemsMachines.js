// In-memory cache
let ITEMS_DATA = null;
// Increase version if you change the JSON structure/content
const ITEMS_DATA_VERSION = 1;

async function loadItemsAndMachines() {
    // 1️⃣ Memory cache first
    if (ITEMS_DATA) return ITEMS_DATA;

    // 2️⃣ Try browser.storage.local
    try {
        if (browser?.storage?.local) {
            const stored = await browser.storage.local.get([
                "itemsData",
                "itemsDataVersion"
            ]);

            if (
                stored &&
                stored.itemsData &&
                stored.itemsDataVersion === ITEMS_DATA_VERSION
            ) {
                console.log("[Items] Loaded from storage cache");
                ITEMS_DATA = stored.itemsData;
                return ITEMS_DATA;
            }
        }
    } catch (err) {
        console.warn("[Items] Failed to read from storage:", err);
    }

    // 3️⃣ Fetch fresh file from inside extension
    try {
        const url = browser.runtime.getURL("data/items_and_machines.json");
        const res = await fetch(url);

        if (!res.ok) {
            throw new Error(
                "Failed to load items_and_machines.json: " + res.status
            );
        }

        const json = await res.json();
        ITEMS_DATA = json;

        // Cache in browser.storage.local
        try {
            if (browser?.storage?.local) {
                await browser.storage.local.set({
                    itemsData: json,
                    itemsDataVersion: ITEMS_DATA_VERSION
                });
                console.log("[Items] Cached to storage");
            }
        } catch (err) {
            console.warn("[Items] Failed to write cache:", err);
        }

        return ITEMS_DATA;
    } catch (err) {
        console.error("[Items] Load failed:", err);
        ITEMS_DATA = null;
        return null;
    }
}
async function getItemMachines(name) {
    const data = await loadItemsAndMachines();
    if (!data) return null;

    // normalize
    const key = String(name).toLowerCase();

    // check in items
    if (data.items && data.items[key]) {
        return data.items[key];
    }

    // check in machines
    if (data.machines && data.machines[key]) {
        return data.machines[key];
    }

    // nothing found
    return null;
}
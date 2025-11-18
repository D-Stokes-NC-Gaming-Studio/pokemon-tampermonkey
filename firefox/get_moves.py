import requests
import json
import time
from pathlib import Path

OUTFILE = "moves.json"
LIST_URL = "https://pokeapi.co/api/v2/move/"
MOVE_URL = "https://pokeapi.co/api/v2/move/"

# ==============================
# Helper: generic GET with retry
# ==============================
def get_with_retry(url, max_retries=5, base_delay=2.0):
    """
    GET url with retries + exponential backoff.
    Special handling for HTTP 429 (rate limit).
    Returns response.json() on success; raises on total failure.
    """
    for attempt in range(1, max_retries + 1):
        try:
            resp = requests.get(url, timeout=15)
            # Rate limit
            if resp.status_code == 429:
                wait = int(resp.headers.get("Retry-After", 10))
                print(f"⏳ 429 Too Many Requests for {url}, waiting {wait}s…")
                time.sleep(wait)
                continue

            resp.raise_for_status()
            return resp.json()

        except Exception as e:
            if attempt == max_retries:
                print(f"❌ Giving up on {url} after {max_retries} attempts: {e}")
                raise
            # Exponential backoff for other errors
            wait = base_delay * attempt
            print(f"⚠️ Error on {url} (attempt {attempt}/{max_retries}): {e} — retrying in {wait:.1f}s")
            time.sleep(wait)


# =================================
# STEP 1 — Get total moves (count)
# =================================
print("📥 Fetching total move count from PokeAPI…")

try:
    meta = get_with_retry(LIST_URL)
    TOTAL_MOVES = meta["count"]
except Exception as e:
    print("❌ Could not get move count:", e)
    raise SystemExit(1)

print(f"🔢 Total moves reported by API: {TOTAL_MOVES}")

# =================================
# STEP 2 — Resume from moves.json
# =================================
if Path(OUTFILE).exists():
    print("🔄 Found existing moves.json, resuming…")
    with open(OUTFILE, "r", encoding="utf-8") as f:
        moves = json.load(f)
else:
    moves = {}

# =================================
# Fetch a single move (with retry)
# =================================
def fetch_move(move_id):
    url = f"{MOVE_URL}{move_id}/"
    try:
        data = get_with_retry(url, max_retries=5, base_delay=2.0)
        return data
    except Exception:
        # Already logged inside get_with_retry
        return None


# =================================
# Slim move object → only needed fields
# =================================
def extract_fields(data):
    meta = data.get("meta") or {}
    return {
        "id": data.get("id"),
        "name": data.get("name"),
        "accuracy": data.get("accuracy"),
        "effect_chance": data.get("effect_chance"),
        "pp": data.get("pp"),
        "priority": data.get("priority"),
        "power": data.get("power"),
        "damage_class": (data.get("damage_class") or {}).get("name"),
        "type": (data.get("type") or {}).get("name"),
        "meta": {
            "ailment": (meta.get("ailment") or {}).get("name"),
            "category": (meta.get("category") or {}).get("name"),
            "min_hits": meta.get("min_hits"),
            "max_hits": meta.get("max_hits"),
            "min_turns": meta.get("min_turns"),
            "max_turns": meta.get("max_turns"),
            "drain": meta.get("drain"),
            "healing": meta.get("healing"),
            "crit_rate": meta.get("crit_rate"),
            "ailment_chance": meta.get("ailment_chance"),
            "flinch_chance": meta.get("flinch_chance"),
            "stat_chance": meta.get("stat_chance"),
        },
    }


# =================================
# STEP 3 — Download all moves
# =================================
print("🚀 Downloading moves…")

for move_id in range(1, TOTAL_MOVES + 1):
    key = str(move_id)

    # Already downloaded → skip
    if key in moves:
        continue

    data = fetch_move(move_id)
    if not data:
        # On total failure we skip this ID but keep going
        continue

    cleaned = extract_fields(data)
    moves[key] = cleaned

    # Save progress after each move (safe for interruptions)
    with open(OUTFILE, "w", encoding="utf-8") as f:
        json.dump(moves, f, indent=2, ensure_ascii=False)

    print(f"✔ Saved move {move_id}: {cleaned['name']}")

    # gentle delay so we don't hammer the API
    time.sleep(0.25)

print("🎉 Done! moves.json is fully generated.")

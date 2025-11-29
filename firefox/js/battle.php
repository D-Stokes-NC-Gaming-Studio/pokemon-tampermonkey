<?php
require_once __DIR__ . '/../config/init.php';

// Standard JSON output
header('Content-Type: application/json');

// --- CORS ---
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Headers: *");
header("Access-Control-Allow-Methods: GET, POST, OPTIONS");
header("Access-Control-Allow-Credentials: false");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

// Router
$action = isset($_GET['action']) ? $_GET['action'] : null;

// For extension → auto-logged user
$usernameHeader = isset($_SERVER['HTTP_X_SESSION_USER']) ? $_SERVER['HTTP_X_SESSION_USER'] : null;

// ===============================
//  ROUTE HANDLER
// ===============================

switch ($action) {

    case "getRandomUser":
        echo json_encode(getRandomUser());
        exit;

    case "logBattle":
        echo json_encode(api_logBattle());
        exit;

    case "setOnlineBP":
        echo json_encode(api_setOnlineBP($usernameHeader));
        exit;

    default:
        echo json_encode([
            "success" => false,
            "error"   => "Invalid or missing action"
        ]);
        exit;
}


// ============================================================
// ACTION: getRandomUser
// Replace with real DB lookup later
// ============================================================

/**
 * Get a real random user from the users table (excluding self).
 * Returns:
 * {
 *   success: true,
 *   user: "OpponentName",
 *   party: [...],
 *   moves: [...],
 *   player: {
 *     party: [...],
 *     moves: [...]
 *   }
 * }
 */
function getRandomUser($db, $currentUsername) {

    // 1. Get all users except the current one
    $list = $db->fetchAll(
        "SELECT username, onlineBP 
         FROM users 
         WHERE username != :u
         ORDER BY RAND()
         LIMIT 1",
        [":u" => $currentUsername]
    );

    if (!$list || count($list) === 0) {
        return [
            "success" => false,
            "error"   => "No other users found"
        ];
    }

    $row = $list[0];
    $opponent = $row["username"];

    // 2. Decode onlineParty JSON
    $onlineParty = [];
    if (!empty($row["onlineParty"])) {
        $onlineParty = json_decode($row["onlineParty"], true);
    }

    // Extract Pokemon names (optional)
    $partyNames = array_map(function ($p) {
        return isset($p["name"]) ? $p["name"] : "Unknown";
    }, $onlineParty);

    // Extract FIRST 4 moves of FIRST Pokémon (example; customize later)
    $moveList = [];
    if (isset($onlineParty[0]["moves"])) {
        foreach ($onlineParty[0]["moves"] as $m) {
            $moveList[] = $m["name"];
        }
    }

    // 3. Load current player's own onlineParty
    $playerRow = $db->fetch(
        "SELECT onlineBP FROM users WHERE username = :u LIMIT 1",
        [":u" => $currentUsername]
    );

    $playerOnlineParty = [];
    if ($playerRow && !empty($playerRow["onlineParty"])) {
        $playerOnlineParty = json_decode($playerRow["onlineParty"], true);
    }

    return [
        "success" => true,
        "user"    => $opponent,
        "party"   => $partyNames,
        "moves"   => $moveList,
        "player"  => [
            "party" => array_map(function ($p) {
                return isset($p["name"]) ? $p["name"] : "Unknown";
            }, $playerOnlineParty),
            "moves" => isset($playerOnlineParty[0]["moves"])
                ? array_map(function ($m) {
                    return $m["name"];
                }, $playerOnlineParty[0]["moves"])
                : []
        ]
    ];
}



// ============================================================
// ACTION: logBattle
// Writes formatted log block to logs/online_battles.log
// ============================================================

function api_logBattle() {
    $json = file_get_contents("php://input");
    $data = json_decode($json, true);

    if (!$data) {
        return [ "success" => false, "error" => "Invalid JSON body" ];
    }

    $player    = isset($data["player"]) ? $data["player"] : "Unknown";
    $opponent  = isset($data["opponent"]) ? $data["opponent"] : "Unknown";
    $battleLog = isset($data["battleLog"]) ? $data["battleLog"] : [];

    $ok = write_battle_log($player, $opponent, $battleLog);

    if (!$ok) {
        return [ "success" => false, "error" => "Failed to write battle log" ];
    }

    return [
        "success" => true,
        "message" => "Battle log saved"
    ];
}



// ============================================================
// ACTION: setOnlineBP  (SAVE ONLINE BATTLE PARTY)
// Frontend sends:
// {
//   "username": "esrobbie",
//   "onlineBP": [ ...battlePartyJson ]
// }
// ============================================================

function api_setOnlineBP($usernameHeader) {
    global $db;

    // Read body
    $raw = file_get_contents("php://input");
    $body = json_decode($raw, true);

    if (!$body) {
        return [
            "success" => false,
            "error"   => "Invalid JSON sent"
        ];
    }

    // Username priority:
    // 1) From header (extension auto-login)
    // 2) From JSON body
    $username = $usernameHeader ?: (isset($body["username"]) ? $body["username"] : null);

    if (!$username) {
        return [
            "success" => false,
            "error"   => "Username missing (header or body)"
        ];
    }

    $onlineBP = isset($body["onlineBP"]) ? $body["onlineBP"] : null;

    if (!$onlineBP || !is_array($onlineBP)) {
        return [
            "success" => false,
            "error"   => "Invalid or empty online party"
        ];
    }

    try {
        // Ensure user exists
        $exists = $db->fetch(
            "SELECT id FROM users WHERE username = :u LIMIT 1",
            [":u" => $username]
        );

        if (!$exists) {
            return [
                "success" => false,
                "error"   => "User not found"
            ];
        }

        // Save online battle party
        $db->query(
            "UPDATE users SET onlineBP = :p WHERE username = :u",
            [
                ":p" => json_encode($onlineBP, JSON_UNESCAPED_UNICODE),
                ":u" => $username
            ]
        );

        return [
            "success" => true,
            "message" => "Online battle party updated",
            "user"    => $username
        ];

    } catch (Exception $e) {
        return [
            "success" => false,
            "error"   => $e->getMessage()
        ];
    }
}



// ============================================================
// Log writer
// ============================================================

function write_battle_log($player, $opponent, $battleLog) {
    $logDir  = __DIR__ . "/../logs";
    $logFile = $logDir . "/online_battles.log";

    if (!is_dir($logDir)) {
        @mkdir($logDir, 0775, true);
    }

    $time = date("Y-m-d H:i:s");

    $lines = [];
    $lines[] = "╔══════════════════════════════════════════════════════════╗";
    $lines[] = "║ 🕹 ONLINE BATTLE – {$time}";
    $lines[] = "║ Player   : {$player}";
    $lines[] = "║ Opponent : {$opponent}";
    $lines[] = "╠════════════════════════════ LOGS ════════════════════════╣";

    $i = 1;
    foreach ($battleLog as $entry) {
        $type = strtoupper(isset($entry["type"]) ? $entry["type"] : "INFO");
        $msg  = trim(isset($entry["message"]) ? $entry["message"] : "");

        if (strlen($msg) > 120) {
            $msg = substr($msg, 0, 117) . "...";
        }

        $n = str_pad($i, 2, "0", STR_PAD_LEFT);
        $t = str_pad($type, 5);

        $lines[] = "║ [{$n}] {$t} | {$msg}";
        $i++;
    }

    $lines[] = "╚══════════════════════════════════════════════════════════╝";
    $lines[] = "";

    $entry = implode(PHP_EOL, $lines) . PHP_EOL;

    return (bool)file_put_contents($logFile, $entry, FILE_APPEND | LOCK_EX);
}

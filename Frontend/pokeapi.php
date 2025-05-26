<?php
/**
 * 
 * 
 * A simple REST-like API wrapper that:
 *  - Proxies to the PokéAPI to fetch Pokémon details
 *  - Stores and retrieves user-caught Pokémon in a MySQL JSON column
 *  - Allows choosing a starter Pokémon
 * 
 * Endpoints (via `action` parameter):
 *  GET  /pokeapi.php?action=getPokemon&name={name}
 *      - Returns fresh data from PokéAPI for {name}
 *  GET  /pokeapi.php?action=getPokeDexNum&name={name}
 *      - Returns the Pokédex number for {name}
 *  GET  /pokeapi.php?action=getName&name={name}
 *      - Returns the canonical Pokémon name for {name}
 *  GET  /pokeapi.php?action=getBaseImage&name={name}
 *      - Returns the default front sprite URL for {name}
 *  GET  /pokeapi.php?action=getShinyImage&name={name}
 *      - Returns the shiny sprite URL for {name}
 *  GET  /pokeapi.php?action=getBaseExperience&name={name}
 *      - Returns the base experience (XP) for leveling up {name}
 *  GET  /pokeapi.php?action=getTypes&name={name}
 *      - Returns the type(s) array for {name}
 *  GET  /pokeapi.php?action=getAllStats&name={name}
 *      - Returns all stats for {name}
 *  GET  /pokeapi.php?action=getStat&name={name}&value={statName}
 *      - Returns a specific stat ({statName}) for {name}
 *  GET  /pokeapi.php?action=getMoves&name={name}
 *      - Returns the moves list for {name}
 *  GET  /pokeapi.php?action=getVariants&name={name}
 *      - Returns the variant forms for {name}
 *
 *  POST /pokeapi.php?action=chooseStarter
 *      - Params (form-data/json): username, starter
 *      - Marks {starter} as the user's starter
 *
 *  POST /pokeapi.php?action=storePokemon
 *      - Params: username, pokemonName
 *      - Stores caught Pokémon for user
 *
 *  GET  /pokeapi.php?action=fetchPokemon&username={username}&pokemonName={name}
 *      - Retrieves stored Pokémon JSON for user
 *
 * All responses are JSON with `status` and `data` or `message`.
 */

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');


require_once __DIR__ . '/../backend/database/conn.php';
require_once __DIR__ . '/../backend/database/Pokemon.php';
try {
    $db     = Database::getInstance();
    $action = $_REQUEST['action'] ?? '';

    switch ($action) {
        case 'getPokemon':
            // Proxy live data from PokéAPI
            $name = $_GET['name'] ?? '';
            if (empty($name)) {
                throw new Exception('Missing parameter: name');
            }
            $data = $db->getPokemonData($name);
            echo json_encode(['status'=>'success', 'data'=> $data]);
            break;

        case 'chooseStarter':
            // User selects starter
            $input = json_decode(file_get_contents('php://input'), true) ?: $_POST;
            $username = $input['username']   ?? '';
            $starter  = $input['starter']    ?? '';
            if (!$username || !$starter) {
                throw new Exception('Missing username or starter');
            }
            $db->chooseStarter($username, $starter);
            echo json_encode(['status'=>'success', 'message'=>"Starter $starter chosen for $username"]);
            break;

        case 'storePokemon':
            // Store a caught Pokémon
            $input = json_decode(file_get_contents('php://input'), true) ?: $_POST;
            $username    = $input['username']    ?? '';
            $pokemonName = $input['pokemonName'] ?? '';
            if (!$username || !$pokemonName) {
                throw new Exception('Missing username or pokemonName');
            }
            $db->storePokemonForUser($username, $pokemonName);
            echo json_encode(['status'=>'success', 'message'=>"Stored $pokemonName for $username"]);
            break;

        case 'fetchPokemon':
            // Retrieve stored JSON for a user Pokémon
            $username    = $_GET['username']    ?? '';
            $pokemonName = $_GET['pokemonName'] ?? '';
            if (!$username || !$pokemonName) {
                throw new Exception('Missing username or pokemonName');
            }
            $data = $db->fetchPokemonForUser($username, $pokemonName);
            if ($data) {
                echo json_encode(['status'=>'success', 'data'=> $data]);
            } else {
                echo json_encode(['status'=>'error', 'message'=>'Not found']);
            }
            break;
        case 'getPokeDexNum':
             // Proxy live data from PokéAPI
            $name = $_GET['name'] ?? '';
            if (empty($name)) {
                throw new Exception('Missing parameter: name');
            }
            $data = $db->getPokemonData($name);
            $pokemon = new Pokemon($data);
            
            echo json_encode(['status'=>'success', 'PokeDex_Number'=> $pokemon->getPokedexNum()]);
            break;
        case 'getName':
             // Proxy live data from PokéAPI
            $name = $_GET['name'] ?? '';
            if (empty($name)) {
                throw new Exception('Missing parameter: name');
            }
            $data = $db->getPokemonData($name);
            $pokemon = new Pokemon($data);
            
            echo json_encode(['status'=>'success', 'PokemonName'=> $pokemon->getName()]);
            break;
        case 'getBaseImage':
             // Proxy live data from PokéAPI
            $name = $_GET['name'] ?? '';
            if (empty($name)) {
                throw new Exception('Missing parameter: name');
            }
            $data = $db->getPokemonData($name);
            $pokemon = new Pokemon($data);
            
            echo json_encode(['status'=>'success', 'BaseImage'=> $pokemon->getBaseImage()]);
            break;
        case 'getShinyImage':
             // Proxy live data from PokéAPI
            $name = $_GET['name'] ?? '';
            if (empty($name)) {
                throw new Exception('Missing parameter: name');
            }
            $data = $db->getPokemonData($name);
            $pokemon = new Pokemon($data);
            
            echo json_encode(['status'=>'success', 'ShinyImage'=> $pokemon->getShinyImage()]);
            break;
        case 'getBaseExperience':
             // Proxy live data from PokéAPI
            $name = $_GET['name'] ?? '';
            if (empty($name)) {
                throw new Exception('Missing parameter: name');
            }
            $data = $db->getPokemonData($name);
            $pokemon = new Pokemon($data);
            
            echo json_encode(['status'=>'success', 'PokemonBaseXP'=> $pokemon->getBaseExperience()]);
            break;
        case 'getTypes':
             // Proxy live data from PokéAPI
            $name = $_GET['name'] ?? '';
            if (empty($name)) {
                throw new Exception('Missing parameter: name');
            }
            $data = $db->getPokemonData($name);
            $pokemon = new Pokemon($data);
            
            echo json_encode(['status'=>'success', 'PokemonTypes'=> $pokemon->getTypes()]);
            break;
        case 'getAllStats':
             // Proxy live data from PokéAPI
            $name = $_GET['name'] ?? '';
            if (empty($name)) {
                throw new Exception('Missing parameter: name');
            }
            $data = $db->getPokemonData($name);
            $pokemon = new Pokemon($data);
            
            echo json_encode(['status'=>'success', 'PokemonStats'=> $pokemon->getAllStats()]);
            break;
        case 'getStat':
             // Proxy live data from PokéAPI
            $name = $_GET['name'] ?? '';
            $stateName = $_GET['stateName'] ?? '';
            if (empty($name)) {
                throw new Exception('Missing parameter: name');
            }
            if (empty($stateName)) {
                throw new Exception('Missing parameter: stateName');
            }
            $data = $db->getPokemonData($name);
            $pokemon = new Pokemon($data);
            
            echo json_encode(['status'=>'success', $stateName => $pokemon->getStat($stateName)]);
            break;
        case 'getMoves':
             // Proxy live data from PokéAPI
            $name = $_GET['name'] ?? '';
            if (empty($name)) {
                throw new Exception('Missing parameter: name');
            }
            $data = $db->getPokemonData($name);
            $pokemon = new Pokemon($data);
            
            echo json_encode(['status'=>'success', 'PokemonMoves'=> $pokemon->getMoves()]);
            break;
        case 'getVariants':
             // Proxy live data from PokéAPI
            $name = $_GET['name'] ?? '';
            if (empty($name)) {
                throw new Exception('Missing parameter: name');
            }
            $data = $db->getPokemonData($name);
            $pokemon = new Pokemon($data);
            
            echo json_encode(['status'=>'success', 'PokemonVariants'=> $pokemon->getVariants()]);
            break;
        default:
        http_response_code(405);
        // No action or unknown action
        echo json_encode([
            'status'    => 'ready',
            'endpoints' => [
                'GET getPokemon: ?action=getPokemon&name={name}',
                'GET getPokeDexNum: ?action=getPokeDexNum&name={name}',
                'GET getName: ?action=getName&name={name}',
                'GET getBaseImage: ?action=getBaseImage&name={name}',
                'GET getShinyImage: ?action=getShinyImage&name={name}',
                'GET getBaseExperience: ?action=getBaseExperience&name={name}',
                'GET getTypes: ?action=getTypes&name={name}',
                'GET getAllStats: ?action=getAllStats&name={name}',
                'GET getStat: ?action=getStat&name={name}&value={statName}',
                'GET getMoves: ?action=getMoves&name={name}',
                'GET getVariants: ?action=getVariants&name={name}',
                'POST chooseStarter: ?action=chooseStarter (body: username, starter)',
                'POST storePokemon: ?action=storePokemon (body: username, pokemonName)',
                'GET fetchPokemon: ?action=fetchPokemon&username={username}&pokemonName={name}',
            ]
        ]);
        
        break;
    }
} catch (Exception $e) {
    http_response_code(400);
    echo json_encode(['status'=>'error', 'message'=>$e->getMessage()]);
}
?>
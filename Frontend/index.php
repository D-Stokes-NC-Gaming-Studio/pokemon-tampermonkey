<?php

// Front controller using switch-case based on \$_REQUEST['action']

// index.php
try {
    $db = Database::getInstance();
    $action = $_REQUEST['action'] ?? '';

    switch ($action) {
        case 'chooseStarter':
            // Choose starter Pokémon
            $username    = $_POST['username']  ?? '';
            $starterName = $_POST['starter']   ?? '';
            $db->chooseStarter($username, $starterName);
            echo json_encode(['status' => 'success', 'message' => "Starter $starterName chosen for $username"]);
            break;

        case 'storePokemon':
            // Store a caught Pokémon
            $username    = $_POST['username']    ?? '';
            $pokemonName = $_POST['pokemonName'] ?? '';
            $db->storePokemonForUser($username, $pokemonName);
            echo json_encode(['status' => 'success', 'message' => "Stored $pokemonName for $username"]);
            break;

        case 'fetchPokemon':
            // Fetch stored Pokémon
            $username    = $_GET['username']    ?? '';
            $pokemonName = $_GET['pokemonName'] ?? '';
            $data = $db->fetchPokemonForUser($username, $pokemonName);
            if ($data) {
                echo json_encode(['status' => 'success', 'data' => $data]);
            } else {
                echo json_encode(['status' => 'error', 'message' => 'Not found']);
            }
            break;

        default:
            // Default: show available actions or form
            echo json_encode([
                'status' => 'ready',
                'actions' => ['chooseStarter', 'storePokemon', 'fetchPokemon'],
                'method' => 'POST for store/choose, GET for fetch'
            ]);
    }
} catch (Exception $e) {
    http_response_code(400);
    echo json_encode(['status' => 'error', 'message' => $e->getMessage()]);
}
?>
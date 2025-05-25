<?php

/**
 * Database class for handling MySQLi connection and PokéAPI integration.
 *
 * - Singleton pattern to ensure a single shared instance
 * - Direct credential storage (adjust for production use)
 * - Methods to fetch and parse data from the PokéAPI
 * - JSON storage of Pokémon data per user
 *
 * @package PokéAPIStorage
 */
class Database {
    /** @var Database|null Singleton instance */
    private static ?Database $instance = null;

    /** @var string Database host */
    private string $host     = 'localhost';
    /** @var string Database username */
    private string $username = 'my_user';
    /** @var string Database password */
    private string $password = 'my_secret_pass';
    /** @var string Database name */
    private string $dbname   = 'my_database';
    /** @var int Database port */
    private int    $port     = 3306;
    /** @var string Connection charset */
    private string $charset  = 'utf8mb4';

    /** @var mysqli Active MySQLi connection */
    private mysqli $conn;

    /**
     * Private constructor to prevent direct instantiation.
     * Initializes the MySQLi connection.
     *
     * @throws Exception if connection or charset setup fails
     */
    private function __construct() {
        $this->connect();
    }

    /**
     * Disable cloning of the singleton instance.
     */
    private function __clone() {}

    /**
     * Disable unserialization of the singleton instance.
     */
    private function __wakeup() {}

    /**
     * Retrieves the shared Database instance.
     *
     * @return Database Singleton instance
     */
    public static function getInstance(): Database {
        if (self::$instance === null) {
            self::$instance = new self();
        }
        return self::$instance;
    }

    /**
     * Establishes the MySQLi connection.
     *
     * @throws Exception on connection or charset errors
     */
    private function connect(): void {
        $this->conn = new mysqli(
            $this->host,
            $this->username,
            $this->password,
            $this->dbname,
            $this->port
        );
        if ($this->conn->connect_errno) {
            throw new Exception('Connection failed: ' . $this->conn->connect_error);
        }
        if (!$this->conn->set_charset($this->charset)) {
            throw new Exception('Error setting charset ' . $this->charset . ': ' . $this->conn->error);
        }
    }

    // === PokéAPI Methods ===

    /**
     * Sends a GET request to the PokéAPI for a given Pokémon name.
     *
     * @param string $name Pokémon name (case-insensitive)
     * @return string Raw JSON response
     * @throws Exception on HTTP or cURL error
     */
    private function getPokemonJson(string $name): string {
        $url = 'https://pokeapi.co/api/v2/pokemon/' . urlencode(strtolower($name));
        $ch = curl_init($url);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_TIMEOUT, 5);
        $json = curl_exec($ch);
        if ($json === false) {
            throw new Exception('cURL error: ' . curl_error($ch));
        }
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        if ($httpCode !== 200) {
            throw new Exception("PokéAPI returned HTTP $httpCode for '$name'");
        }
        return $json;
    }

    /**
     * Parses Pokémon data into a structured array.
     *
     * @param string $name Pokémon name
     * @return array Parsed data: ['name', 'image', 'stats', 'moves']
     * @throws Exception if API response is invalid
     */
    public function getPokemonData(string $name): array {
        $raw  = $this->getPokemonJson($name);
        $data = json_decode($raw, true);
        if (!isset($data['stats'])) {
            throw new Exception('Invalid PokéAPI data for ' . $name);
        }
        $image = $data['sprites']['front_default'] ?? null;
        $stats = array_map(static fn($s) => [
            'name'  => $s['stat']['name'],
            'value' => $s['base_stat'],
        ], $data['stats']);
        $moves = array_map(static fn($m) => $m['move']['name'], $data['moves']);
        return [
            'name'  => $data['name'] ?? $name,
            'image' => $image,
            'stats' => $stats,
            'moves' => $moves,
        ];
    }

    // === User Pokémon Storage ===

    /**
     * Stores a Pokémon for a user in the database.
     *
     * @param string $username Username identifier
     * @param string $pokemonName Pokémon to store
     * @param bool   $isStarter Flag for starter Pokémon
     * @return void
     * @throws Exception on API or SQL errors
     */
    public function storePokemonForUser(string $username, string $pokemonName, bool $isStarter = false): void {
        $details = $this->getPokemonData($pokemonName);
        $details['isStarter'] = $isStarter;
        $json = json_encode($details, JSON_UNESCAPED_UNICODE);
        $sql  = 'INSERT INTO user_pokemon (username, pokemon_data) VALUES (?, ?)';
        $stmt = $this->execute($sql, 'ss', [$username, $json]);
        $stmt->close();
    }

    /**
     * Retrieves a specific Pokémon JSON for a user.
     *
     * @param string $username Username identifier
     * @param string $pokemonName Pokémon name to fetch
     * @return array|null Decoded Pokémon data or null if not found
     * @throws Exception on SQL errors
     */
    public function fetchPokemonForUser(string $username, string $pokemonName): ?array {
        $sql = "SELECT pokemon_data FROM user_pokemon
                WHERE username = ?
                  AND JSON_UNQUOTE(JSON_EXTRACT(pokemon_data, '$.name')) = ?
                LIMIT 1";
        $row = $this->fetch($sql, 'ss', [$username, $pokemonName]);
        return $row ? json_decode($row['pokemon_data'], true) : null;
    }

    /**
     * Allows a user to choose their starter Pokémon.
     *
     * @param string $username User selecting starter
     * @param string $starterName Starter Pokémon name
     * @return void
     * @throws Exception if starter already chosen or on storage error
     */
    public function chooseStarter(string $username, string $starterName): void {
        // Ensure no prior starter
        $sql = "SELECT COUNT(*) AS cnt FROM user_pokemon
                WHERE username = ?
                  AND JSON_UNQUOTE(JSON_EXTRACT(pokemon_data, '$.isStarter')) = '1'";
        $row = $this->fetch($sql, 's', [$username]);
        if (!empty($row['cnt'])) {
            throw new Exception('Starter already chosen for ' . $username);
        }
        $this->storePokemonForUser($username, $starterName, true);
    }

    // === Generic Database Helpers ===

    /**
     * Prepares and executes a parameterized SQL statement.
     *
     * @param string $sql    SQL with placeholders
     * @param string $types  Parameter types (e.g. 'ss')
     * @param array  $params Values to bind
     * @return mysqli_stmt  Executed statement
     * @throws Exception on prepare/execute error
     */
    public function execute(string $sql, string $types = '', array $params = []): mysqli_stmt {
        $stmt = $this->conn->prepare($sql);
        if ($stmt === false) {
            throw new Exception('Prepare failed: ' . $this->conn->error);
        }
        if ($types !== '' && !empty($params)) {
            $stmt->bind_param($types, ...$params);
        }
        if (!$stmt->execute()) {
            throw new Exception('Execution failed: ' . $stmt->error);
        }
        return $stmt;
    }

    /**
     * Fetches a single row from a parameterized query.
     *
     * @param string $sql    SQL with placeholders
     * @param string $types  Parameter types
     * @param array  $params Values to bind
     * @return array|null    Associative row or null if none
     * @throws Exception on SQL error
     */
    public function fetch(string $sql, string $types = '', array $params = []): ?array {
        $stmt   = $this->execute($sql, $types, $params);
        $result = $stmt->get_result();
        $data   = $result->fetch_assoc();
        $stmt->close();
        return $data ?: null;
    }

    /**
     * Fetches all rows from a parameterized query.
     *
     * @param string $sql    SQL with placeholders
     * @param string $types  Parameter types
     * @param array  $params Values to bind
     * @return array         List of associative rows
     * @throws Exception on SQL error
     */
    public function fetchAll(string $sql, string $types = '', array $params = []): array {
        $stmt   = $this->execute($sql, $types, $params);
        $result = $stmt->get_result();
        $data   = $result->fetch_all(MYSQLI_ASSOC);
        $stmt->close();
        return $data;
    }

    /**
     * Closes the database connection when the object is destructed.
     */
    public function __destruct() {
        if (isset($this->conn) && $this->conn instanceof mysqli) {
            $this->conn->close();
        }
    }
}


?>
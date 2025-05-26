<?php

/**
 * Pokemon model class that wraps raw PokéAPI data and provides convenient accessors.
 *
 * Usage:
 * ```php
 * $db      = Database::getInstance();
 * $data    = $db->getPokemonData('pikachu');
 * $pokemon = new Pokemon($data);
 * 
 * echo $pokemon->getName();            // pikachu
 * print_r($pokemon->getTypes());       // types array
 * print_r($pokemon->getAllStats());    // stats array
 * ```
 */
class Pokemon {
    /** @var array Raw Pokémon data from PokéAPI */
    private array $data;

    /**
     * Constructor.
     *
     * @param array $data Raw data array as returned by Database::getPokemonData()
     */
    public function __construct(array $data) {
        $this->data = $data;
    }

    /**
     * Get the Pokédex number.
     *
     * @return int|null
     */
    public function getPokedexNum(): ?int {
        return $this->data['pokeDex_num'] ?? null;
    }

    /**
     * Get the Pokémon's name.
     *
     * @return string|null
     */
    public function getName(): ?string {
        return $this->data['name'] ?? null;
    }

    /**
     * Get the default front sprite URL.
     *
     * @return string|null
     */
    public function getBaseImage(): ?string {
        return $this->data['base_image'] ?? null;
    }

    /**
     * Get the shiny sprite URL.
     *
     * @return string|null
     */
    public function getShinyImage(): ?string {
        return $this->data['shiny_image'] ?? null;
    }

    /**
     * Get the base experience for leveling up.
     *
     * @return int|null
     */
    public function getBaseExperience(): ?int {
        return $this->data['base_experience'] ?? null;
    }

    /**
     * Get the types array.
     * Each entry: ['slot'=>int, 'type'=>['name'=>string,'url'=>string]]
     *
     * @return array
     */
    public function getTypes(): array {
        return $this->data['types'] ?? [];
    }

   /**
     * Get the stats array.
     * Each entry: ['name'=>string,'value'=>int]
     *
     * @return array
     */
    public function getStats(): array {
        return $this->data['stats'] ?? [];
    }

    /**
     * Alias for getStats(), returns all stats.
     *
     * @return array
     */
    public function getAllStats(): array {
        return $this->getStats();
    }

    /**
     * Get a specific stat by name.
     *
     * @param string $statName Name of the stat (e.g., 'attack')
     * @return int|null Value of the stat or null if not found
     */
    public function getStat(string $statName): ?int {
        foreach ($this->getStats() as $stat) {
            if (strtolower($stat['name']) === strtolower($statName)) {
                return $stat['value'];
            }
        }
        return null;
    }

    /**
     * Get the moves list.
     *
     * @return array List of move names
     */
    public function getMoves(): array {
        return $this->data['moves'] ?? [];
    }

    /**
     * Get all variant forms: ['name'=>string,'image'=>string]
     *
     * @return array
     */
    public function getVariants(): array {
        return $this->data['variants'] ?? [];
    }

    /**
     * Convert the model back to raw array.
     *
     * @return array
     */
    public function toArray(): array {
        return $this->data;
    }

    /**
     * Instantiate a Pokemon directly by name, fetching from DB & API.
     *
     * @param string $name
     * @return self
     * @throws Exception on fetch errors
     */
    public static function fromName(string $name): self {
        $db     = Database::getInstance();
        $data   = $db->getPokemonData($name);
        return new self($data);
    }
}
?>
// turnTimer.js
// Turn timer manager for online battles
// Handles countdown for picking moves or switching Pokémon

export function createTurnTimer(defaultWaitTime) {
    const state = {
        waitTime: defaultWaitTime,   // how long each player gets
        activeSide: null,            // "player" | "opponent" | null
        deadline: null,              // timestamp (ms)
        timeoutId: null              // setTimeout ID
    };

    /**
     * Starts the timer for the given side.
     * @param {string} side - "player" or "opponent"
     * @param {Object} options
     * @param {number} options.waitTime - override wait time (optional)
     * @param {Function} options.onExpire - callback when timer runs out
     */
    function start(side, { waitTime = state.waitTime, onExpire = () => {} } = {}) {
        cancel(); // ensure clean start

        state.waitTime = waitTime;
        state.activeSide = side;
        state.deadline = Date.now() + waitTime;

        state.timeoutId = setTimeout(() => {
            // timer ended
            state.timeoutId = null;
            const expiredSide = state.activeSide;

            // clear state
            state.activeSide = null;
            state.deadline = null;

            // notify battle logic
            onExpire(expiredSide);
        }, waitTime);
    }

    /**
     * Cancels the active timer.
     */
    function cancel() {
        if (state.timeoutId !== null) {
            clearTimeout(state.timeoutId);
            state.timeoutId = null;
        }

        state.activeSide = null;
        state.deadline = null;
    }

    /**
     * Returns remaining time in milliseconds.
     */
    function getRemaining() {
        if (!state.deadline) return 0;
        return Math.max(state.deadline - Date.now(), 0);
    }

    /**
     * Returns true if a timer is currently running.
     */
    function isRunning() {
        return state.timeoutId !== null && state.deadline !== null;
    }

    /**
     * Returns the side currently under timer.
     */
    function getActiveSide() {
        return state.activeSide;
    }

    /**
     * Formats milliseconds as mm:ss for UI labels.
     */
    function formatRemaining() {
        const ms = getRemaining();
        const totalSeconds = Math.floor(ms / 1000);
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;

        return `${minutes}:${seconds.toString().padStart(2, "0")}`;
    }

    /**
     * Debug: gets the entire internal state
     */
    function debugState() {
        return {
            waitTime: state.waitTime,
            activeSide: state.activeSide,
            deadline: state.deadline,
            timeoutId: state.timeoutId
        };
    }

    return {
        start,
        cancel,
        getRemaining,
        isRunning,
        getActiveSide,
        formatRemaining,
        debugState
    };
}

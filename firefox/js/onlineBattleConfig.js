// onlineBattleConfig.js (or wherever)
export const onlineBatttleConfig = {
    opponentUsername: null,
    opponentParty: [],
    opponentMoves: [],
    opponentTurn: null,
    opponentReady: false,
    playerName: null,
    playerParty: [],
    playerMoves: [],
    playerTurn: null,
    playerReady: false,
    onlineState: [{
        status: "waiting",   // waiting, battling, won, lost
        message: ""
    }],
    turn: 0,
    battleLog: [],
    waitTime: 60000, // milliseconds
};

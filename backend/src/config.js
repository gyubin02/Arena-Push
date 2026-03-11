module.exports = {
  port: Number(process.env.PORT || 3000),
  arenaRadius: 180,
  playerRadius: 18,
  playerSpeed: 240,
  tickRate: 30,
  roundDurationMs: 35000,
  lobbyCountdownMs: 3000,
  rematchWaitMs: 10000,
  broadcastRate: 30,
  maxPlayersPerRoom: 2
};

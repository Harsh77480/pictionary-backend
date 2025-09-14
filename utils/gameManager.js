// utils/gameManager.js
const crypto = require('crypto');
const redisModule = require('../redisClient');
const redis = redisModule.client;
const words = require('./words');
const {
  MAX_GAMES,
  MAX_USERS_PER_GAME,
  GAME_TTL_MS,
  ROUND_DURATION_MS,
  POINTS_GUESSER,
  POINTS_DRAWER,
  DRAW_TURNS_PER_PLAYER
} = require('../config');

const games = new Map(); // pin -> game object
let io = null;

function init(ioInstance) {
  io = ioInstance;
}

// short pin generator
function generatePin() {
  return crypto.randomUUID().split('-')[0]; // ~8 hex chars
}

async function createGame(hostSocketId) {
  if (games.size >= MAX_GAMES) return { ok: false, message: `Max games reached (${MAX_GAMES})` };
  let pin;
  do { pin = generatePin(); } while (games.has(pin));

  const game = {
    pin,
    host: hostSocketId,
    players: [], // { id, name }
    status: 'waiting',
    turnIndex: 0,
    roundsTotal: 0,
    roundsPlayed: 0,
    currentWord: null,
    roundActive: false,
    expiryTimer: null,
    roundTimer: null,
    scoreboardKey: `game:${pin}:scores`,
    wordKey: `game:${pin}:word`,
    lockKey: `game:${pin}:lock`,
    inMemoryScores: {} // fallback if redis unavailable
  };

  // set TTL to destroy if empty after GAME_TTL_MS
  game.expiryTimer = setTimeout(() => {
    destroyGame(pin, 'ttl_expired');
  }, GAME_TTL_MS);

  games.set(pin, game);

  // clear redis keys if redis present
  if (redisModule.redisConnected() && redis) {
    try {
      await redis.del(game.scoreboardKey);
      await redis.del(game.wordKey);
      await redis.del(game.lockKey);
    } catch (err) {
      console.warn('Redis cleanup error on createGame', err.message);
    }
  }

  return { ok: true, pin, ttlMs: GAME_TTL_MS };
}

function getGame(pin) {
  return games.get(pin);
}

async function joinGame(pin, socketId, desiredName) {
  const game = games.get(pin);
  if (!game) return { ok: false, message: 'Game not found or expired' };
  if (game.status !== 'waiting') return { ok: false, message: 'Game already started' };
  if (game.players.length >= MAX_USERS_PER_GAME) return { ok: false, message: 'Game full' };

  let name = (desiredName || 'Player').trim();
  if (!name) name = 'Player';

  // ensure unique
  const existing = new Set(game.players.map(p => p.name));
  let base = name;
  let suffix = 1;
  while (existing.has(name)) {
    name = `${base}${suffix++}`;
    if (suffix > 100) break;
  }

  game.players.push({ id: socketId, name });

  // initialize score in Redis or in-memory
  if (redisModule.redisConnected() && redis) {
    try {
      await redis.hSet(game.scoreboardKey, name, 0);
    } catch (err) {
      console.warn('Redis hSet failed on joinGame', err.message);
      game.inMemoryScores[name] = 0;
    }
  } else {
    game.inMemoryScores[name] = 0;
  }

  // cancel game TTL if players join (we'll manage destruction when empty)
  if (game.expiryTimer) {
    clearTimeout(game.expiryTimer);
    game.expiryTimer = null;
  }

  return { ok: true, pin, name };
}

async function leaveGame(pin, socketId) {
  const game = games.get(pin);
  if (!game) return;
  const idx = game.players.findIndex(p => p.id === socketId);
  if (idx !== -1) {
    const removed = game.players.splice(idx, 1)[0];
    // optionally remove score from inMemoryScores; keep it for audit
    delete game.inMemoryScores[removed.name];
  }

  // if no players left schedule destroy
  if (game.players.length === 0) {
    game.expiryTimer = setTimeout(() => destroyGame(pin, 'empty'), GAME_TTL_MS);
  } else {
    // if host left, reassign
    if (game.host === socketId) {
      game.host = game.players[0].id;
    }
  }
}

async function startGame(pin, starterSocketId) {
  const game = games.get(pin);
  if (!game) return { ok: false, message: 'Game not found' };
  if (game.host !== starterSocketId) return { ok: false, message: 'Only host can start' };
  if (game.players.length < 2) return { ok: false, message: 'Need at least 2 players' };

  game.status = 'in_progress';
  game.roundsTotal = DRAW_TURNS_PER_PLAYER * game.players.length; // each player draws once
  game.roundsPlayed = 0;
  game.turnIndex = 0;
  game.roundActive = false;

  // start first round
  setImmediate(() => startRound(pin).catch(() => {}));
  return { ok: true };
}

function pickWord() {
  const idx = Math.floor(Math.random() * words.length);
  return words[idx];
}

async function setWordInRedis(game, word) {
  if (redisModule.redisConnected() && redis) {
    try {
      await redis.set(game.wordKey, word, { EX: Math.ceil(GAME_TTL_MS / 1000) });
    } catch (err) {
      console.warn('Redis set word failed', err.message);
    }
  }
}

async function startRound(pin) {
  const game = games.get(pin);
  if (!game || game.status !== 'in_progress') return;

  if (game.roundsPlayed >= game.roundsTotal) {
    // end game
    await endGame(pin);
    return;
  }

  const drawer = game.players[game.turnIndex];
  if (!drawer) {
    await endGame(pin);
    return;
  }

  const secret = pickWord();
  game.currentWord = secret;
  game.roundActive = true;

  // store secret in redis (best-effort)
  await setWordInRedis(game, secret);

  // set a round timer
  if (game.roundTimer) {
    clearTimeout(game.roundTimer);
  }
  game.roundTimer = setTimeout(() => {
    // round expired without winner
    handleRoundTimeout(pin).catch(() => {});
  }, ROUND_DURATION_MS);

  // notify drawer privately
  if (io) {
    try {
      io.to(pin).emit('roundStarted', {
        drawerName: drawer.name,
        round: game.roundsPlayed + 1,
        totalRounds: game.roundsTotal,
        roundDurationMs: ROUND_DURATION_MS
      });
      io.to(drawer.id).emit('wordToDraw', { word: secret });
      const scores = await getScores(pin);
      io.to(pin).emit('scoreboard', { scores });
    } catch (err) {
      console.warn('startRound emit error', err.message);
    }
  }
}

async function getScores(pin) {
  const game = games.get(pin);
  if (!game) return {};
  if (redisModule.redisConnected() && redis) {
    try {
      const raw = await redis.hGetAll(game.scoreboardKey);
      const out = {};
      for (const k of Object.keys(raw)) out[k] = parseInt(raw[k], 10) || 0;
      return out;
    } catch (err) {
      console.warn('Redis hGetAll failed', err.message);
    }
  }
  // fallback to in-memory map
  return { ...game.inMemoryScores };
}

async function processGuess(pin, guesserName, message, socketId) {
  const game = games.get(pin);
  if (!game || game.status !== 'in_progress' || !game.roundActive) return { ok: false, reason: 'No active round' };

  const drawer = game.players[game.turnIndex];
  if (!drawer) return { ok: false, reason: 'No drawer' };
  if (drawer.id === socketId) return { ok: false, reason: 'Drawer cannot guess' };

  // get secret (from memory or redis)
  let secret = game.currentWord;
  if (!secret && redisModule.redisConnected() && redis) {
    try { secret = await redis.get(game.wordKey); } catch (err) { /* ignore */ }
  }
  if (!secret) return { ok: false, reason: 'No secret' };

  if (message.trim().toLowerCase() === secret.trim().toLowerCase()) {
    // Acquire lock via Redis if available to ensure first-claim wins
    let lockAcquired = false;
    if (redisModule.redisConnected() && redis) {
      try {
        const res = await redis.set(game.lockKey, socketId, { NX: true, PX: 5000 });
        if (res) lockAcquired = true;
      } catch (err) {
        console.warn('Redis lock error', err.message);
      }
    } else {
      // in-memory fallback
      if (!game._internalWinnerClaimed) {
        lockAcquired = true;
        game._internalWinnerClaimed = true;
      }
    }

    if (!lockAcquired) {
      return { ok: false, reason: 'Someone already claimed' };
    }

    // award points (atomic in redis when available)
    if (redisModule.redisConnected() && redis) {
      try {
        await redis.hIncrBy(game.scoreboardKey, guesserName, POINTS_GUESSER);
        await redis.hIncrBy(game.scoreboardKey, drawer.name, POINTS_DRAWER);
      } catch (err) {
        console.warn('Redis scoring error', err.message);
      }
    } else {
      game.inMemoryScores[guesserName] = (game.inMemoryScores[guesserName] || 0) + POINTS_GUESSER;
      game.inMemoryScores[drawer.name] = (game.inMemoryScores[drawer.name] || 0) + POINTS_DRAWER;
    }

    // end round
    game.roundActive = false;
    game.roundsPlayed += 1;
    if (game.roundTimer) { clearTimeout(game.roundTimer); game.roundTimer = null; }

    // fetch scores and broadcast result
    const scores = await getScores(pin);
    if (io) {
      io.to(pin).emit('roundEnded', {
        winner: guesserName,
        drawer: drawer.name,
        word: secret,
        scores
      });
    }

    // advance turn
    game.turnIndex = (game.turnIndex + 1) % game.players.length;
    game._internalWinnerClaimed = false;

    // start next round after small delay
    setTimeout(() => startRound(pin).catch(() => {}), 3000);

    return { ok: true, winner: guesserName, scores };
  }

  return { ok: false, reason: 'Incorrect' };
}

async function handleRoundTimeout(pin) {
  const game = games.get(pin);
  if (!game || !game.roundActive) return;
  game.roundActive = false;
  game.roundsPlayed += 1;
  if (game.roundTimer) { clearTimeout(game.roundTimer); game.roundTimer = null; }

  // reveal the word, no one wins
  const secret = game.currentWord || (redisModule.redisConnected() && redis ? await redis.get(game.wordKey).catch(()=>null) : null);

  const scores = await getScores(pin);
  if (io) {
    io.to(pin).emit('roundEnded', { winner: null, drawer: game.players[game.turnIndex]?.name || null, word: secret, scores });
  }

  // advance turn and start next
  game.turnIndex = (game.turnIndex + 1) % (game.players.length || 1);
  setTimeout(() => startRound(pin).catch(() => {}), 3000);
}

async function endGame(pin) {
  const game = games.get(pin);
  if (!game) return;
  const scores = await getScores(pin);
  if (io) io.to(pin).emit('gameOver', { scores });
  destroyGame(pin, 'finished');
}

function destroyGame(pin, reason = 'manual') {
  const game = games.get(pin);
  if (!game) return;
  if (io) {
    io.to(pin).emit('gameDestroyed', { pin, reason });
    const room = io.sockets.adapter.rooms.get(pin);
    if (room) {
      for (const sockid of room) {
        const s = io.sockets.sockets.get(sockid);
        try { s.leave(pin); s.emit('forceDisconnect', { reason: 'game_destroyed' }); } catch (e) {}
      }
    }
  }
  if (game.expiryTimer) clearTimeout(game.expiryTimer);
  if (game.roundTimer) clearTimeout(game.roundTimer);
  // cleanup redis keys
  if (redisModule.redisConnected() && redis) {
    redis.del(game.scoreboardKey).catch(()=>{});
    redis.del(game.wordKey).catch(()=>{});
    redis.del(game.lockKey).catch(()=>{});
  }
  games.delete(pin);
}

function getActiveGames() {
  return Array.from(games.values()).map(g => ({
    pin: g.pin,
    status: g.status,
    players: g.players.map(p => p.name)
  }));
}

module.exports = {
  init,
  createGame,
  joinGame,
  leaveGame,
  startGame,
  processGuess,
  getGame,
  getActiveGames,
  getScores,
  destroyGame
};

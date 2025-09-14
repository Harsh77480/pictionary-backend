// socket/handlers.js
const gameManager = require('../utils/gameManager');
const {
  validateStrokeStart,
  validateDrawBatch,
  validateName,
  validateChatMessage
} = require('../utils/validation');

const {
  DRAW_TURNS_PER_PLAYER
} = require('../config');

function registerHandlers(io, socket) {

  const sendError = (msg) => {
    try { socket.emit('errorMessage', { message: msg }); } catch (e) {}
  };

  // CREATE GAME
  socket.on('createGame', async (cb) => {
    try {
      const res = await gameManager.createGame(socket.id);
      if (res.ok) {
        socket.join(res.pin);
        socket.data.gamePin = res.pin;
        // host will call joinGame to join players list with name
      }
      return typeof cb === 'function' ? cb(res) : null;
    } catch (err) {
      console.error('createGame error', err);
      return typeof cb === 'function' ? cb({ ok: false, message: 'Server error' }) : null;
    }
  });

  // JOIN GAME (with display name)
  socket.on('joinGame', async (payload, cb) => {
    try {
      const { pin, name } = payload || {};
      if (!pin || typeof pin !== 'string' || !validateName(name)) {
        return typeof cb === 'function' ? cb({ ok: false, message: 'Invalid pin or name' }) : null;
      }

      const res = await gameManager.joinGame(pin, socket.id, name);
      if (!res.ok) return typeof cb === 'function' ? cb(res) : null;

      socket.join(pin);
      socket.data.gamePin = pin;
      socket.data.name = res.name;

      // broadcast lobby update
      const info = gameManager.getGame(pin);
      if (info) {
        io.to(pin).emit('lobbyUpdate', { players: info.players.map(p => p.name), host: info.host });
      }

      return typeof cb === 'function' ? cb({ ok: true, pin, name: res.name }) : null;
    } catch (err) {
      console.error('joinGame error', err);
      return typeof cb === 'function' ? cb({ ok: false, message: 'Server error' }) : null;
    }
  });

  // START GAME (only host)
  socket.on('startGame', async (payload, cb) => {
    try {
      const pin = socket.data.gamePin;
      if (!pin) return typeof cb === 'function' ? cb({ ok: false, message: 'Not in game' }) : null;
      const res = await gameManager.startGame(pin, socket.id);
      if (!res.ok) return typeof cb === 'function' ? cb(res) : null;

      io.to(pin).emit('gameStarted', { message: 'Game started' });
      return typeof cb === 'function' ? cb({ ok: true }) : null;
    } catch (err) {
      console.error('startGame error', err);
      return typeof cb === 'function' ? cb({ ok: false, message: 'Server error' }) : null;
    }
  });

  // CHAT (guesses + messages)
  socket.on('chatMessage', async (payload) => {
    try {
      const pin = socket.data.gamePin;
      const name = socket.data.name || 'Anon';
      if (!pin || !validateChatMessage(payload?.message)) return;

      const clean = payload.message.trim();

      // broadcast to room
      io.to(pin).emit('chatMessage', { from: name, message: clean });

      // attempt guess if game in progress
      const result = await gameManager.processGuess(pin, name, clean, socket.id);
      // processGuess will broadcast roundEnded if correct
    } catch (err) {
      console.error('chatMessage handler error', err);
    }
  });

  // Drawing: allow only drawer to draw
  socket.on('strokeStart', (payload) => {
    const pin = socket.data.gamePin;
    if (!pin) return;
    if (!validateStrokeStart(payload)) return;
    const g = gameManager.getGame(pin);
    if (!g || g.status !== 'in_progress') return;
    const currentDrawer = g.players[g.turnIndex];
    if (!currentDrawer || currentDrawer.id !== socket.id) return; // only drawer allowed
    // forward
    socket.to(pin).emit('strokeStart', payload);
  });

  socket.on('drawBatch', (payload) => {
    const pin = socket.data.gamePin;
    // console.log(pin,payload,DRAW_TURNS_PER_PLAYER)
    if (!pin) return;
    if (!validateDrawBatch(payload)) return;
    const g = gameManager.getGame(pin);
    if (!g || g.status !== 'in_progress') return;
    const currentDrawer = g.players[g.turnIndex];
    if (!currentDrawer || currentDrawer.id !== socket.id) return;
    socket.to(pin).emit('drawBatch', payload);
  });

  socket.on('strokeEnd', () => {
    const pin = socket.data.gamePin;
    if (!pin) return;
    const g = gameManager.getGame(pin);
    if (!g || g.status !== 'in_progress') return;
    const currentDrawer = g.players[g.turnIndex];
    if (!currentDrawer || currentDrawer.id !== socket.id) return;
    socket.to(pin).emit('strokeEnd');
  });

  // LEAVE GAME
  socket.on('leaveGame', () => {
    const pin = socket.data.gamePin;
    if (!pin) return;
    socket.leave(pin);
    gameManager.leaveGame(pin, socket.id);
    socket.data.gamePin = null;
    socket.data.name = null;
    const g = gameManager.getGame(pin);
    if (g) io.to(pin).emit('lobbyUpdate', { players: g.players.map(p => p.name), host: g.host });
  });

  // DISCONNECT
  socket.on('disconnect', (reason) => {
    const pin = socket.data.gamePin;
    if (pin) {
      gameManager.leaveGame(pin, socket.id);
      const g = gameManager.getGame(pin);
      if (g) io.to(pin).emit('lobbyUpdate', { players: g.players.map(p => p.name), host: g.host });
    }
    console.log(`Socket disconnected ${socket.id} (${reason})`);
  });
}

module.exports = { registerHandlers };

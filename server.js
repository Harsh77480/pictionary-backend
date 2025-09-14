// server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const { PORT, FRONTEND_ORIGIN } = require('./config');
const { registerHandlers } = require('./socket/handlers');
const gameManager = require('./utils/gameManager');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: FRONTEND_ORIGIN,
    methods: ['GET', 'POST']
  }
});

// init manager with io
gameManager.init(io);

// handshake origin check (defense in depth)
io.use((socket, next) => {
  try {
    const origin = socket.handshake.headers.origin;
    if (origin && origin !== FRONTEND_ORIGIN) {
      return next(new Error('Origin not allowed'));
    }
    return next();
  } catch (err) {
    return next(new Error('Handshake error'));
  }
});

app.get('/health', (req, res) => res.json({ ok: true }));
app.get('/active-games', (req, res) => res.json({ active: gameManager.getActiveGames() }));

io.on('connection', (socket) => {
  console.log('Client connected', socket.id);
  registerHandlers(io, socket);
});

server.listen(PORT, () => {
  console.log(`🚀 Pictionary backend listening on http://localhost:${PORT}`);
});

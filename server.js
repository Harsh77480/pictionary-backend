// server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const { PORT, FRONTEND_ORIGIN } = require('./config');
const { registerHandlers } = require('./socket/handlers');
const gameManager = require('./utils/gameManager');
const sanitizeInput = require("./utils/sanitizer");

const app = express();
const server = http.createServer(app);


// sanitizing http middleware 
app.use((req, res, next) => {
  if (req.body) req.body = sanitizeInput(req.body);
  if (req.query) req.query = sanitizeInput(req.query);
  if (req.params) req.params = sanitizeInput(req.params);
  next();
}); 

const io = new Server(server, {
  cors: {
    origin: FRONTEND_ORIGIN,
    methods: ['GET', 'POST']
  }
});

// init manager with io
gameManager.init(io);

// middleware wss santize
  io.use((socket, next) => {
    const origOn = socket.on.bind(socket);
    socket.on = (event, handler) => {
       origOn(event, (...args) => {
        // Sanitize all arguments (not just first one)
        const cleanArgs = args.map(sanitizeInput);
        console.log(cleanArgs);
        handler(...cleanArgs);
      });
    };
    next();
  });

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

  //rate limiting on socket events 
  var EVENTS = 50;var TIME = 1000;// 50 events/second  

  const interval = setInterval(() => {
    socket.messageCount = 0;
  }, TIME); 

  socket.use((packet, next) => {
  socket.messageCount++;
    if (socket.messageCount > EVENTS) {return;}
    next();
  });
  socket.on("disconnect", () => clearInterval(interval));
  // ------- ends here 


});

server.listen(PORT, () => {
  console.log(`🚀 Pictionary backend listening on http://localhost:${PORT}`);
});

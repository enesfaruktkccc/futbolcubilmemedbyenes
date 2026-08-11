const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname)));
app.get('/health', (_, res) => res.json({ ok: true, players: leaderboard.length }));

// Temporary in-memory room state. Replace with a database before treating this as permanent storage.
const players = new Map();
const messages = [];
const leaderboard = [];

function cleanName(value) {
  return String(value || '').trim().slice(0, 20);
}
function cleanMessage(value) {
  return String(value || '').replace(/[<>]/g, '').trim().slice(0, 250);
}
function publicLeaderboard() {
  return leaderboard
    .slice()
    .sort((a,b) => b.score - a.score || b.correct - a.correct)
    .slice(0, 100);
}

io.on('connection', socket => {
  socket.emit('chat:history', messages.slice(-100));
  socket.emit('leaderboard:update', publicLeaderboard());

  socket.on('player:join', data => {
    const name = cleanName(data?.name) || 'misafir';
    players.set(socket.id, { name, score: 0, correct: 0 });
    socket.emit('player:joined', { name });
    io.emit('leaderboard:update', publicLeaderboard());
  });

  socket.on('score:update', data => {
    const player = players.get(socket.id);
    if (!player) return;
    const score = Number(data?.score);
    const correct = Number(data?.correct);
    if (!Number.isFinite(score) || !Number.isFinite(correct)) return;
    player.score = Math.max(0, Math.min(Math.floor(score), 1000000));
    player.correct = Math.max(0, Math.min(Math.floor(correct), 10000));
    const existing = leaderboard.find(x => x.id === socket.id);
    if (existing) Object.assign(existing, { name: player.name, score: player.score, correct: player.correct });
    else leaderboard.push({ id: socket.id, name: player.name, score: player.score, correct: player.correct });
    io.emit('leaderboard:update', publicLeaderboard());
  });

  socket.on('chat:send', data => {
    const player = players.get(socket.id);
    const text = cleanMessage(data?.text);
    if (!player || !text) return;
    const message = { id: `${Date.now()}-${socket.id}`, name: player.name, text, at: Date.now() };
    messages.push(message);
    if (messages.length > 200) messages.shift();
    io.emit('chat:new', message);
  });

  socket.on('disconnect', () => {
    players.delete(socket.id);
    const index = leaderboard.findIndex(x => x.id === socket.id);
    if (index !== -1) leaderboard.splice(index, 1);
    io.emit('leaderboard:update', publicLeaderboard());
  });
});

server.listen(PORT, () => console.log(`server running on ${PORT}`));

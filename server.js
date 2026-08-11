const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: true, credentials: true } });
const PORT = process.env.PORT || 3000;
const DATA = path.join(__dirname, 'chat-messages.json');

let messages = [];
// Canlı sıralama: sunucuya bağlı/oynamış tüm kullanıcılar burada tutulur.
// Aynı kullanıcı farklı cihazdan bağlanırsa en güncel gönderilen istatistik kazanır.
const leaderboard = new Map();
try { messages = JSON.parse(fs.readFileSync(DATA, 'utf8')); } catch { messages = []; }

function persist() {
  try { fs.writeFileSync(DATA, JSON.stringify(messages.slice(-200), null, 2)); } catch (e) { console.error('chat kayıt hatası', e); }
}
function clean(v, max) { return String(v ?? '').replace(/[<>]/g, '').trim().slice(0, max); }
function cleanStats(raw) {
  const n = v => Math.max(0, Math.min(Number.isFinite(Number(v)) ? Number(v) : 0, 100000000));
  return {
    name: clean(raw?.name, 18), rating: n(raw?.rating), xp: n(raw?.xp),
    weeklyXP: n(raw?.weeklyXP), monthXP: n(raw?.monthXP), correct: n(raw?.correct),
    total: n(raw?.total), streak: n(raw?.streak), bestStreak: n(raw?.bestStreak),
    playersGuessed: n(raw?.playersGuessed), careerCorrect: n(raw?.careerCorrect),
    careerTotal: n(raw?.careerTotal), avatar: clean(raw?.avatar, 1) || '?'
  };
}
function leaderboardList() {
  return [...leaderboard.values()].sort((a,b) => (b.rating-a.rating) || (b.xp-a.xp) || a.name.localeCompare(b.name, 'tr'));
}
function emitLeaderboard() {
  const list = leaderboardList();
  // v1.4 client
  io.emit('leaderboard:state', list);
  // older client compatibility
  io.emit('leaderboard:update', list);
}

app.use(express.static(__dirname));
app.get('/health', (_, res) => res.json({ ok: true, online: io.engine.clientsCount, leaderboard: leaderboard.size }));

io.on('connection', socket => {
  socket.emit('chat:history', messages.slice(-80));
  socket.emit('leaderboard:state', leaderboardList());
  socket.emit('leaderboard:update', leaderboardList());

  socket.on('leaderboard:join', raw => {
    const stats = cleanStats(raw);
    if (!stats.name) return;
    leaderboard.set(stats.name.toLowerCase(), stats);
    emitLeaderboard();
  });

  socket.on('leaderboard:update', raw => {
    const stats = cleanStats(raw);
    if (!stats.name) return;
    leaderboard.set(stats.name.toLowerCase(), stats);
    emitLeaderboard();
  });

  socket.on('score:update', raw => {
    const stats = cleanStats(raw);
    if (!stats.name) return;
    leaderboard.set(stats.name.toLowerCase(), stats);
    emitLeaderboard();
  });

  socket.on('player:join', raw => {
    const stats = cleanStats({ name: raw?.name });
    if (!stats.name) return;
    leaderboard.set(stats.name.toLowerCase(), stats);
    socket.emit('player:joined', { name: stats.name });
    emitLeaderboard();
  });

  socket.on('chat:message', raw => {
    const user = clean(raw?.user, 18);
    const text = clean(raw?.text, 180);
    if (!user || !text) return;
    const msg = { user, text, at: Date.now() };
    messages.push(msg);
    messages = messages.slice(-200);
    persist();
    io.emit('chat:message', msg);
  });

  socket.on('chat:send', raw => {
    const user = clean(raw?.user || raw?.name, 18);
    const text = clean(raw?.text, 180);
    if (!user || !text) return;
    const msg = { user, text, at: Date.now() };
    messages.push(msg);
    messages = messages.slice(-200);
    persist();
    io.emit('chat:message', msg);
    io.emit('chat:new', { id: `${msg.at}-${socket.id}`, name: user, text, at: msg.at });
  });
});

server.listen(PORT, '0.0.0.0', () => console.log(`Futbolcuyu Bil çalışıyor: ${PORT}`));

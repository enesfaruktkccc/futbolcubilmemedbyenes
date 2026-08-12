const express = require('express');
const http = require('http');
const crypto = require('crypto');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: true, credentials: true } });
const PORT = process.env.PORT || 3000;
const INDEX = path.join(__dirname, 'index.html');
const DATA = path.join(__dirname, 'chat-messages.json');

const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false }
    })
  : null;

let dbReady = false;
let messages = [];
const sessions = new Map();
const socketUsers = new Map();
const games = new Map();
const leaderboard = new Map();

function clean(v, max) {
  return String(v ?? '').replace(/[<>]/g, '').trim().slice(0, max);
}

function norm(v) {
  return String(v ?? '')
    .toLocaleLowerCase('tr-TR')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ı/g, 'i')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a) return b.length;
  if (!b) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(
        cur[j - 1] + 1,
        prev[j] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    prev = cur;
  }
  return prev[b.length];
}

function typoOK(input, target) {
  if (!input || !target) return false;
  if (input === target) return true;
  return target.length >= 4 && levenshtein(input, target) <= Math.max(1, Math.floor(target.length * 0.25));
}

const EXTRA_ALIASES = new Map([
  ['cr7', 'cristiano ronaldo'], ['ronaldo', 'cristiano ronaldo'], ['cristiano', 'cristiano ronaldo'],
  ['messi', 'lionel messi'], ['leo messi', 'lionel messi'],
  ['vini', 'vinicius junior'], ['vini jr', 'vinicius junior'], ['vini junior', 'vinicius junior'],
  ['mbappe', 'kylian mbappe'], ['kylian', 'kylian mbappe'],
  ['haaland', 'erling haaland'], ['salah', 'mohamed salah'], ['mo salah', 'mohamed salah'],
  ['lewa', 'robert lewandowski'], ['bellingham', 'jude bellingham'], ['jude', 'jude bellingham'],
  ['kdb', 'kevin de bruyne'], ['de bruyne', 'kevin de bruyne'],
  ['modric', 'luka modric'], ['luka', 'luka modric'], ['zlatan', 'zlatan ibrahimovic'], ['ibra', 'zlatan ibrahimovic'],
  ['ronaldinho', 'ronaldinho'], ['dinho', 'ronaldinho'], ['zidane', 'zinedine zidane'], ['kaka', 'kaka'],
  ['becks', 'david beckham'], ['beckham', 'david beckham'], ['henry', 'thierry henry'], ['rooney', 'wayne rooney'],
  ['busquets', 'sergio busquets'], ['rice', 'declan rice'], ['declan', 'declan rice'],
  ['sergio', 'sergio busquets'], ['arda', 'arda guler'], ['hakan', 'hakan calhanoglu'],
  ['icardi', 'mauro icardi'], ['mauro', 'mauro icardi'], ['osimhen', 'victor osimhen'], ['victor', 'victor osimhen'],
  ['tadic', 'dusan tadic'], ['dusan', 'dusan tadic'], ['dzeko', 'edin dzeko'], ['edin', 'edin dzeko'],
  ['torreira', 'lucas torreira'], ['lucas', 'lucas torreira'], ['muslera', 'fernando muslera'], ['fernando', 'fernando muslera'],
  ['mertens', 'dries mertens'], ['dries', 'dries mertens'], ['busqes', 'sergio busquets'], ['busqets', 'sergio busquets']
]);

function answerMatches(raw, fullName, aliases = []) {
  const input = norm(raw);
  const target = norm(fullName);
  if (!input || !target) return false;
  if (input === target) return true;
  if (EXTRA_ALIASES.get(input) === target) return true;

  const parts = target.split(' ');
  if (parts.some(part => part.length >= 4 && typoOK(input, part))) return true;
  for (const alias of aliases) {
    if (typoOK(input, norm(alias))) return true;
  }

  const inputParts = input.split(' ');
  if (inputParts.length === parts.length && inputParts.every((x, i) => typoOK(x, parts[i]))) return true;
  return false;
}

function difficultyFor(total) {
  const q = total + 1;
  if (q <= 50) return 1;
  if (q <= 150) return 2;
  if (q <= 300) return 3;
  if (q <= 400) return 4;
  if (q <= 1200) return 5;
  return 6;
}

function difficultyName(level) {
  return ['AŞIRI KOLAY', 'KOLAY', 'ORTA', 'ZOR', 'ÇOK ZOR', 'EFSANE'][level - 1] || 'EFSANE';
}

function safeCatalog(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const out = [];
  for (const item of raw.slice(0, 600)) {
    const name = clean(item?.name, 80);
    const difficulty = Math.max(1, Math.min(Number(item?.difficulty) || 1, 6));
    const key = norm(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ name, difficulty, aliases: Array.isArray(item?.aliases) ? item.aliases.slice(0, 12).map(x => clean(x, 50)) : [] });
  }
  return out;
}

function validateCatalog(catalog) {
  if (catalog.length < 100) return false;
  const names = new Set(catalog.map(x => norm(x.name)));
  const anchors = ['lionel messi', 'cristiano ronaldo', 'kylian mbappe', 'erling haaland', 'mohamed salah'];
  return anchors.every(a => names.has(a));
}

function chooseQuestion(game, forcedLevel = null) {
  const level = forcedLevel || difficultyFor(game.total);
  const pool = game.catalog.filter(x => x.difficulty === level);
  const usable = pool.length ? pool : game.catalog.filter(x => x.difficulty === Math.max(1, Math.min(level, 5)));
  if (!usable.length) throw new Error('Soru havuzu boş');
  const unseen = usable.filter(x => !game.used.has(norm(x.name)));
  const candidates = unseen.length ? unseen : usable;
  let candidate = candidates[crypto.randomInt(0, candidates.length)];
  if (game.question?.name && candidates.length > 1) {
    const alternatives = candidates.filter(x => norm(x.name) !== norm(game.question.name));
    candidate = alternatives[crypto.randomInt(0, alternatives.length)];
  }
  game.used.add(norm(candidate.name));
  if (game.used.size > 500) {
    const latest = [...game.used].slice(-450);
    game.used = new Set(latest);
  }
  game.questionNo += 1;
  game.question = {
    id: crypto.randomUUID(),
    name: candidate.name,
    aliases: candidate.aliases,
    difficulty: level,
    startedAt: Date.now(),
    hintsUsed: []
  };
  return {
    id: game.question.id,
    name: game.question.name,
    difficulty: level,
    difficultyName: difficultyName(level),
    questionNo: game.questionNo,
    startedAt: game.question.startedAt
  };
}

function leaderboardList() {
  return [...leaderboard.values()]
    .sort((a, b) => (b.rating - a.rating) || (b.xp - a.xp) || a.name.localeCompare(b.name, 'tr'))
    .map((x, i) => ({ ...x, rank: i + 1 }));
}

function emitLeaderboard() {
  io.emit('leaderboard:state', leaderboardList());
  io.emit('leaderboard:update', leaderboardList());
}

function onlineList() {
  const seen = new Map();
  for (const [socketId, username] of socketUsers) {
    if (!username) continue;
    seen.set(norm(username), username);
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b, 'tr'));
}

function emitOnline() {
  io.emit('online:state', onlineList());
}

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

function makeSessionToken() {
  return crypto.randomBytes(32).toString('hex');
}

function setSessionCookie(res, token) {
  const secure = process.env.RENDER === 'true' || process.env.NODE_ENV === 'production';
  res.setHeader('Set-Cookie', `futbolcu_session=${token}; Path=/; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}; Max-Age=2592000`);
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', 'futbolcu_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
}

function parseCookies(header = '') {
  const out = {};
  for (const piece of header.split(';')) {
    const [k, ...rest] = piece.trim().split('=');
    if (k) out[k] = decodeURIComponent(rest.join('='));
  }
  return out;
}

function sessionUserFromRequest(req) {
  const token = parseCookies(req.headers.cookie || '').futbolcu_session;
  const s = token ? sessions.get(token) : null;
  if (!s) return null;
  if (s.expiresAt < Date.now()) {
    sessions.delete(token);
    return null;
  }
  return s.username;
}

async function getPlayerByKey(key) {
  if (!pool || !dbReady) return leaderboard.get(key) || null;
  const result = await pool.query(`
    SELECT name, rating, xp, weekly_xp, month_xp, correct, total, streak,
           best_streak, players_guessed, career_correct, career_total, avatar,
           password_hash, password_salt
    FROM players WHERE name_key = $1
  `, [key]);
  return result.rows[0] || null;
}

function publicPlayer(row) {
  return {
    name: row.name,
    rating: Number(row.rating) || 1000,
    xp: Number(row.xp) || 0,
    weeklyXP: Number(row.weekly_xp) || 0,
    monthXP: Number(row.month_xp) || 0,
    correct: Number(row.correct) || 0,
    total: Number(row.total) || 0,
    streak: Number(row.streak) || 0,
    bestStreak: Number(row.best_streak) || 0,
    playersGuessed: Number(row.players_guessed) || 0,
    careerCorrect: Number(row.career_correct) || 0,
    careerTotal: Number(row.career_total) || 0,
    avatar: row.avatar || row.name?.[0]?.toUpperCase() || '?'
  };
}

async function savePlayerStats(username, stats, extra = {}) {
  const key = norm(username);
  if (!pool || !dbReady) {
    leaderboard.set(key, { ...stats, name: username });
    return;
  }
  await pool.query(`
    INSERT INTO players (
      name_key, name, rating, xp, weekly_xp, month_xp, correct, total,
      streak, best_streak, players_guessed, career_correct, career_total, avatar,
      password_hash, password_salt, updated_at, last_seen
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,NOW(),NOW())
    ON CONFLICT (name_key) DO UPDATE SET
      name = EXCLUDED.name,
      rating = EXCLUDED.rating,
      xp = EXCLUDED.xp,
      weekly_xp = EXCLUDED.weekly_xp,
      month_xp = EXCLUDED.month_xp,
      correct = EXCLUDED.correct,
      total = EXCLUDED.total,
      streak = EXCLUDED.streak,
      best_streak = EXCLUDED.best_streak,
      players_guessed = EXCLUDED.players_guessed,
      career_correct = EXCLUDED.career_correct,
      career_total = EXCLUDED.career_total,
      avatar = EXCLUDED.avatar,
      updated_at = NOW(),
      last_seen = NOW()
  `, [
    key, username, stats.rating, stats.xp, stats.weeklyXP, stats.monthXP,
    stats.correct, stats.total, stats.streak, stats.bestStreak,
    stats.playersGuessed, stats.careerCorrect, stats.careerTotal, stats.avatar,
    extra.passwordHash || null, extra.passwordSalt || null
  ]);
  leaderboard.set(key, { ...stats, name: username });
}

async function initDatabase() {
  if (!pool) {
    try { messages = JSON.parse(fs.readFileSync(DATA, 'utf8')); } catch { messages = []; }
    return;
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS players (
      name_key TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      rating DOUBLE PRECISION NOT NULL DEFAULT 1000,
      xp DOUBLE PRECISION NOT NULL DEFAULT 0,
      weekly_xp DOUBLE PRECISION NOT NULL DEFAULT 0,
      month_xp DOUBLE PRECISION NOT NULL DEFAULT 0,
      correct DOUBLE PRECISION NOT NULL DEFAULT 0,
      total DOUBLE PRECISION NOT NULL DEFAULT 0,
      streak DOUBLE PRECISION NOT NULL DEFAULT 0,
      best_streak DOUBLE PRECISION NOT NULL DEFAULT 0,
      players_guessed DOUBLE PRECISION NOT NULL DEFAULT 0,
      career_correct DOUBLE PRECISION NOT NULL DEFAULT 0,
      career_total DOUBLE PRECISION NOT NULL DEFAULT 0,
      avatar TEXT NOT NULL DEFAULT '?',
      password_hash TEXT,
      password_salt TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_seen TIMESTAMPTZ
    )
  `);
  await pool.query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS password_hash TEXT`);
  await pool.query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS password_salt TEXT`);
  await pool.query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS last_seen TIMESTAMPTZ`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS chat_messages (
      id BIGSERIAL PRIMARY KEY,
      username TEXT NOT NULL,
      message TEXT NOT NULL,
      sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const players = await pool.query(`
    SELECT name, rating, xp, weekly_xp, month_xp, correct, total, streak,
           best_streak, players_guessed, career_correct, career_total, avatar
    FROM players
  `);
  for (const row of players.rows) leaderboard.set(norm(row.name), publicPlayer(row));

  const chat = await pool.query(`
    SELECT username AS user, message AS text,
           EXTRACT(EPOCH FROM sent_at) * 1000 AS at
    FROM chat_messages ORDER BY id DESC LIMIT 200
  `);
  messages = chat.rows.reverse().map(m => ({ user: m.user, text: m.text, at: Number(m.at) }));
  dbReady = true;
  console.log(`PostgreSQL hazır: ${leaderboard.size} oyuncu, ${messages.length} chat mesajı yüklendi.`);
}

async function saveChat(msg) {
  if (!pool || !dbReady) {
    messages.push(msg);
    messages = messages.slice(-200);
    try { fs.writeFileSync(DATA, JSON.stringify(messages, null, 2)); } catch {}
    return;
  }
  await pool.query(
    'INSERT INTO chat_messages (username, message, sent_at) VALUES ($1, $2, TO_TIMESTAMP($3 / 1000.0))',
    [msg.user, msg.text, msg.at]
  );
  messages.push(msg);
  messages = messages.slice(-200);
}

app.use(express.json({ limit: '350kb' }));

app.get('/', (req, res, next) => {
  try {
    let html = fs.readFileSync(INDEX, 'utf8');
    const secureScript = '<script src="/secure-client.js"></script>';
    if (!html.includes(secureScript)) html = html.replace('</body>', `${secureScript}</body>`);
    res.type('html').send(html);
  } catch (e) {
    next(e);
  }
});

app.use(express.static(__dirname));

app.get('/health', async (_, res) => {
  let database = dbReady;
  if (pool) {
    try { await pool.query('SELECT 1'); database = dbReady; } catch { database = false; }
  }
  res.json({ ok: true, online: onlineList().length, leaderboard: leaderboard.size, database });
});

app.post('/api/auth/register', async (req, res) => {
  const username = clean(req.body?.username, 18);
  const password = String(req.body?.password || '');
  const key = norm(username);
  if (!/^[\p{L}\p{N}_-]{3,18}$/u.test(username) || !key) return res.status(400).json({ error: 'Kullanıcı adı 3-18 karakter olmalı.' });
  if (password.length < 4 || password.length > 72) return res.status(400).json({ error: 'Şifre 4-72 karakter olmalı.' });
  try {
    const existing = await getPlayerByKey(key);
    const salt = crypto.randomBytes(16).toString('hex');
    const passwordHash = hashPassword(password, salt);
    if (existing?.password_hash) return res.status(409).json({ error: 'Bu kullanıcı adı zaten kayıtlı.' });

    const stats = existing ? publicPlayer(existing) : {
      name: username, rating: 1000, xp: 0, weeklyXP: 0, monthXP: 0,
      correct: 0, total: 0, streak: 0, bestStreak: 0,
      playersGuessed: 0, careerCorrect: 0, careerTotal: 0, avatar: username[0]?.toUpperCase() || '?'
    };
    if (pool && dbReady) {
      await pool.query(`
        INSERT INTO players (name_key, name, rating, xp, weekly_xp, month_xp, correct, total, streak, best_streak,
          players_guessed, career_correct, career_total, avatar, password_hash, password_salt, last_seen)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,NOW())
        ON CONFLICT (name_key) DO UPDATE SET password_hash = EXCLUDED.password_hash, password_salt = EXCLUDED.password_salt,
          name = EXCLUDED.name, updated_at = NOW(), last_seen = NOW()
      `, [key, username, stats.rating, stats.xp, stats.weeklyXP, stats.monthXP, stats.correct, stats.total,
          stats.streak, stats.bestStreak, stats.playersGuessed, stats.careerCorrect, stats.careerTotal, stats.avatar,
          passwordHash, salt]);
      leaderboard.set(key, stats);
    } else {
      leaderboard.set(key, stats);
    }
    const token = makeSessionToken();
    sessions.set(token, { username, expiresAt: Date.now() + 30 * 24 * 3600 * 1000 });
    setSessionCookie(res, token);
    emitLeaderboard();
    res.json({ player: stats });
  } catch (e) {
    console.error('register', e);
    res.status(500).json({ error: 'Kayıt sırasında hata oluştu.' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const username = clean(req.body?.username, 18);
  const password = String(req.body?.password || '');
  const key = norm(username);
  try {
    const row = await getPlayerByKey(key);
    if (!row) return res.status(401).json({ error: 'Kullanıcı adı veya şifre hatalı.' });

    if (row.password_hash && row.password_salt) {
      const hash = hashPassword(password, row.password_salt);
      if (!crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(row.password_hash, 'hex'))) {
        return res.status(401).json({ error: 'Kullanıcı adı veya şifre hatalı.' });
      }
    } else {
      if (password.length < 4) return res.status(401).json({ error: 'Bu eski hesap için önce bir şifre belirlemelisin.' });
      const salt = crypto.randomBytes(16).toString('hex');
      const passwordHash = hashPassword(password, salt);
      if (pool && dbReady) await pool.query('UPDATE players SET password_hash=$1, password_salt=$2 WHERE name_key=$3', [passwordHash, salt, key]);
    }

    const token = makeSessionToken();
    sessions.set(token, { username: row.name, expiresAt: Date.now() + 30 * 24 * 3600 * 1000 });
    setSessionCookie(res, token);
    if (pool && dbReady) await pool.query('UPDATE players SET last_seen=NOW() WHERE name_key=$1', [key]);
    res.json({ player: publicPlayer(row) });
  } catch (e) {
    console.error('login', e);
    res.status(500).json({ error: 'Giriş sırasında hata oluştu.' });
  }
});

app.post('/api/auth/logout', (req, res) => {
  const token = parseCookies(req.headers.cookie || '').futbolcu_session;
  if (token) sessions.delete(token);
  clearSessionCookie(res);
  res.json({ ok: true });
});

app.get('/api/session/me', async (req, res) => {
  try {
    const username = sessionUserFromRequest(req);
    if (!username) return res.status(401).json({ error: 'Oturum yok.' });
    const row = await getPlayerByKey(norm(username));
    if (!row) return res.status(401).json({ error: 'Oyuncu bulunamadı.' });
    res.json({ player: publicPlayer(row) });
  } catch (e) {
    res.status(500).json({ error: 'Oturum okunamadı.' });
  }
});

app.get('/api/leaderboard', (_, res) => res.json({ players: leaderboardList() }));
app.get('/api/online', (_, res) => res.json({ players: onlineList() }));

app.post('/api/game/start', async (req, res) => {
  const username = sessionUserFromRequest(req);
  if (!username) return res.status(401).json({ error: 'Önce giriş yapmalısın.' });
  const catalog = safeCatalog(req.body?.catalog);
  if (!validateCatalog(catalog)) return res.status(400).json({ error: 'Oyuncu kataloğu geçersiz.' });

  try {
    const row = await getPlayerByKey(norm(username));
    if (!row) return res.status(404).json({ error: 'Oyuncu bulunamadı.' });
    const stats = publicPlayer(row);
    let game = games.get(`api:${norm(username)}`);
    if (!game) {
      game = { username, catalog, used: new Set(), question: null, questionNo: 0, total: stats.total, streak: stats.streak };
      games.set(`api:${norm(username)}`, game);
    } else {
      game.catalog = catalog;
      game.total = stats.total;
      game.streak = stats.streak;
    }
    const question = chooseQuestion(game);
    res.json({ question, stats });
  } catch (e) {
    console.error('game start', e);
    res.status(500).json({ error: 'Oyun başlatılamadı.' });
  }
});

app.post('/api/game/answer', async (req, res) => {
  const username = sessionUserFromRequest(req);
  if (!username) return res.status(401).json({ error: 'Oturum yok.' });
  const game = games.get(`api:${norm(username)}`);
  if (!game?.question || !req.body?.questionId || req.body.questionId !== game.question.id) return res.status(409).json({ error: 'Soru süresi/oturumu geçersiz.' });
  const raw = clean(req.body?.answer, 80);
  const q = game.question;
  const elapsed = Math.max(0.5, (Date.now() - q.startedAt) / 1000);
  const correct = answerMatches(raw, q.name, q.aliases);
  const row = await getPlayerByKey(norm(username));
  if (!row) return res.status(404).json({ error: 'Oyuncu bulunamadı.' });
  const stats = publicPlayer(row);

  stats.total += 1;
  stats.careerTotal += 1;
  let gained = 0;
  let ratingDelta = 0;
  let message;
  if (correct) {
    const base = Math.max(25, 110 - q.difficulty * 10);
    const speed = Math.max(0, Math.round(35 - Math.min(elapsed, 35)));
    const penalty = q.hintsUsed.reduce((sum, cost) => sum + cost, 0);
    gained = Math.max(8, base + speed - penalty);
    ratingDelta = Math.max(7, Math.round(gained / 4) + Math.min(stats.streak, 8));
    stats.correct += 1;
    stats.streak += 1;
    stats.bestStreak = Math.max(stats.bestStreak, stats.streak);
    stats.playersGuessed += 1;
    stats.careerCorrect += 1;
    stats.xp += gained;
    stats.weeklyXP += gained;
    stats.monthXP += gained;
    stats.rating += ratingDelta;
    message = `DOĞRU! +${gained} XP • +${ratingDelta} rating`;
  } else {
    stats.streak = 0;
    stats.rating = Math.max(700, stats.rating - 12);
    message = `OLMADI • Doğru cevap: ${q.name}`;
  }

  await savePlayerStats(username, stats);
  game.total = stats.total;
  game.streak = stats.streak;
  const next = chooseQuestion(game);
  game.question = game.question;
  emitLeaderboard();
  res.json({ correct, answer: q.name, gained, ratingDelta, message, stats, next });
});

app.post('/api/game/pass', async (req, res) => {
  const username = sessionUserFromRequest(req);
  if (!username) return res.status(401).json({ error: 'Oturum yok.' });
  const game = games.get(`api:${norm(username)}`);
  if (!game?.question || req.body?.questionId !== game.question.id) return res.status(409).json({ error: 'Soru geçersiz.' });
  const q = game.question;
  const row = await getPlayerByKey(norm(username));
  if (!row) return res.status(404).json({ error: 'Oyuncu bulunamadı.' });
  const stats = publicPlayer(row);
  stats.total += 1;
  stats.careerTotal += 1;
  stats.streak = 0;
  stats.rating = Math.max(700, stats.rating - 4);
  await savePlayerStats(username, stats);
  game.total = stats.total;
  game.streak = 0;
  const next = chooseQuestion(game);
  res.json({ stats, answer: q.name, message: `PAS • Doğru cevap: ${q.name}`, next });
  emitLeaderboard();
});

app.post('/api/game/hint', async (req, res) => {
  const username = sessionUserFromRequest(req);
  if (!username) return res.status(401).json({ error: 'Oturum yok.' });
  const game = games.get(`api:${norm(username)}`);
  if (!game?.question || req.body?.questionId !== game.question.id) return res.status(409).json({ error: 'Soru geçersiz.' });
  const index = Math.max(0, Math.min(Number(req.body?.index) || 0, 2));
  const costs = [5, 5, 15];
  if (game.question.hintsUsed.includes(costs[index])) return res.json({ ok: true, alreadyUsed: true, used: game.question.hintsUsed });
  game.question.hintsUsed.push(costs[index]);
  const labels = [
    `Adı ${game.question.name.length} karakter`,
    `İlk harfi: ${game.question.name[0]?.toUpperCase() || '?'}`,
    `Soyadının ilk harfi: ${game.question.name.split(' ').pop()?.[0]?.toUpperCase() || '?'}`
  ];
  res.json({ ok: true, cost: costs[index], label: labels[index], used: game.question.hintsUsed });
});

app.post('/api/game/restart', async (req, res) => {
  const username = sessionUserFromRequest(req);
  if (!username) return res.status(401).json({ error: 'Oturum yok.' });
  const key = `api:${norm(username)}`;
  const game = games.get(key);
  const row = await getPlayerByKey(norm(username));
  if (!row || !game) return res.status(404).json({ error: 'Oyun bulunamadı.' });
  const stats = publicPlayer(row);
  game.used = new Set();
  game.questionNo = 0;
  game.total = stats.total;
  game.streak = stats.streak;
  const next = chooseQuestion(game, difficultyFor(stats.total));
  res.json({ stats, next });
});

io.on('connection', socket => {
  socket.emit('chat:history', messages.slice(-80));
  socket.emit('leaderboard:state', leaderboardList());
  socket.emit('online:state', onlineList());

  socket.on('auth:refresh', async () => {
    try {
      const cookies = parseCookies(socket.handshake.headers.cookie || '');
      const token = cookies.futbolcu_session;
      const session = token ? sessions.get(token) : null;
      if (!session || session.expiresAt < Date.now()) return;
      socketUsers.set(socket.id, session.username);
      if (pool && dbReady) await pool.query('UPDATE players SET last_seen=NOW() WHERE name_key=$1', [norm(session.username)]);
      emitOnline();
    } catch (e) { console.error('auth refresh', e); }
  });

  async function handleChat(raw) {
    const user = socketUsers.get(socket.id);
    const text = clean(raw?.text, 180);
    if (!user || !text) return;
    const msg = { user, text, at: Date.now() };
    try {
      await saveChat(msg);
      io.emit('chat:message', msg);
      io.emit('chat:new', { id: `${msg.at}-${socket.id}`, name: user, text, at: msg.at });
    } catch (e) { console.error('chat kayıt hatası', e); }
  }

  socket.on('chat:message', handleChat);
  socket.on('chat:send', handleChat);

  socket.on('disconnect', () => {
    socketUsers.delete(socket.id);
    emitOnline();
  });
});

initDatabase()
  .then(() => server.listen(PORT, '0.0.0.0', () => console.log(`Futbolcuyu Bil çalışıyor: ${PORT}`)))
  .catch(err => {
    console.error('PostgreSQL başlatılamadı:', err);
    server.listen(PORT, '0.0.0.0', () => console.log(`Futbolcuyu Bil çalışıyor: ${PORT}`));
  });

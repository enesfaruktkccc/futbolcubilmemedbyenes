(() => {
  'use strict';

  const api = (url, options = {}) => fetch(url, {
    credentials: 'same-origin',
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
  }).then(async r => {
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || 'İşlem başarısız.');
    return data;
  });

  let me = null;
  let question = null;
  let hintsUsed = new Set();

  const legacyPlayers = () => {
    try { return eval('players'); } catch { return []; }
  };
  const legacyNorm = s => String(s || '').toLocaleLowerCase('tr-TR').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ı/g, 'i').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();

  function catalog() {
    return legacyPlayers().map(p => ({ name: p.name, difficulty: p.difficulty, aliases: [] }));
  }

  function message(text) {
    const el = document.getElementById('imageStatus');
    if (el && String(text).length < 80) el.textContent = text;
    console.log('[Futbolcuyu Bil]', text);
  }

  function applyStats(s) {
    if (!s) return;
    const ids = { correct: s.correct, total: s.total, streak: s.streak };
    Object.entries(ids).forEach(([id, value]) => { const el = document.getElementById(id); if (el) el.textContent = value ?? 0; });
    const avatar = document.getElementById('avatar');
    const topName = document.getElementById('userNameTop');
    const account = document.getElementById('accountSide');
    if (avatar) avatar.textContent = (s.name || me?.name || '?')[0].toUpperCase();
    if (topName) topName.textContent = s.name || me?.name || 'Oyuncu';
    if (account) account.textContent = s.name || me?.name || 'Giriş yap';
    const mini = document.getElementById('leaderMini');
    if (mini && me) mini.dataset.secure = '1';
  }

  async function loadQuestionImage(name) {
    const img = document.getElementById('playerPhoto');
    const fallback = document.getElementById('fallbackPlayer');
    if (!img || !fallback) return;
    img.style.display = 'none'; fallback.style.display = 'grid';
    try {
      const r = await fetch('https://en.wikipedia.org/api/rest_v1/page/summary/' + encodeURIComponent(name.replace(/\s+/g, '_')));
      const d = await r.json();
      if (!d.thumbnail?.source) throw new Error('no image');
      img.onload = () => { fallback.style.display = 'none'; img.style.display = 'block'; };
      img.src = d.thumbnail.source;
    } catch { message('GÖRSEL BULUNAMADI'); }
  }

  function renderQuestion(q) {
    question = q;
    hintsUsed = new Set();
    const difficulty = document.getElementById('difficulty');
    if (difficulty) difficulty.textContent = q.difficultyName || '';
    const title = document.querySelector('.question h1');
    if (title) title.innerHTML = 'BU FUTBOLCU <span>KİM?</span>';
    renderHints();
    loadQuestionImage(q.name);
  }

  function renderHints() {
    const box = document.getElementById('hints');
    if (!box || !question) return;
    const labels = [
      `Adı ${question.name.length} karakter`,
      `İlk harfi: ${question.name[0]?.toUpperCase() || '?'}`,
      `Soyadının ilk harfi: ${question.name.split(' ').pop()?.[0]?.toUpperCase() || '?'}`
    ];
    const costs = [5, 5, 15];
    box.innerHTML = '';
    labels.forEach((label, i) => {
      const b = document.createElement('button'); b.className = 'hint';
      b.textContent = hintsUsed.has(i) ? label : `İPUCU ${i + 1} • -${costs[i]}`;
      b.onclick = async () => {
        if (hintsUsed.has(i) || !question) return;
        try {
          const d = await api('/api/game/hint', { method: 'POST', body: JSON.stringify({ questionId: question.id, index: i }) });
          hintsUsed.add(i); b.textContent = d.label || label;
        } catch (e) { message(e.message); }
      };
      box.appendChild(b);
    });
  }

  async function startGame() {
    if (!me) { document.getElementById('accountModal').style.display = 'grid'; return; }
    try {
      const d = await api('/api/game/start', { method: 'POST', body: JSON.stringify({ catalog: catalog() }) });
      applyStats(d.stats); renderQuestion(d.question);
    } catch (e) { message(e.message); }
  }

  async function answer() {
    if (!me) { document.getElementById('accountModal').style.display = 'grid'; return; }
    const input = document.getElementById('answer'); const value = input?.value.trim();
    if (!value || !question) return;
    try {
      const d = await api('/api/game/answer', { method: 'POST', body: JSON.stringify({ questionId: question.id, answer: value }) });
      input.value = ''; applyStats(d.stats); message(d.message); renderQuestion(d.next);
      refreshLeaderboard();
    } catch (e) { message(e.message); }
  }

  async function pass() {
    if (!me) { document.getElementById('accountModal').style.display = 'grid'; return; }
    if (!question) return;
    try {
      const d = await api('/api/game/pass', { method: 'POST', body: JSON.stringify({ questionId: question.id }) });
      const input = document.getElementById('answer'); if (input) input.value = '';
      applyStats(d.stats); message(d.message); renderQuestion(d.next); refreshLeaderboard();
    } catch (e) { message(e.message); }
  }

  async function restart() {
    if (!me) { document.getElementById('accountModal').style.display = 'grid'; return; }
    try { const d = await api('/api/game/restart', { method: 'POST', body: '{}' }); applyStats(d.stats); renderQuestion(d.next); message('Oyun yeniden başladı.'); }
    catch (e) { message(e.message); }
  }

  async function login(register) {
    const user = document.getElementById(register ? 'registerUser' : 'loginUser')?.value.trim();
    const pass = document.getElementById(register ? 'registerPass' : 'loginPass')?.value || '';
    if (!user || !pass) return message('Kullanıcı adı ve şifre gerekli.');
    try {
      const d = await api(register ? '/api/auth/register' : '/api/auth/login', { method: 'POST', body: JSON.stringify({ username: user, password: pass }) });
      me = d.player;
      document.getElementById('accountModal').style.display = 'none';
      applyStats(me);
      if (window.chatSocket?.connected) window.chatSocket.emit('auth:refresh');
      await startGame();
    } catch (e) { message(e.message); }
  }

  async function checkSession() {
    try { const d = await api('/api/session/me'); me = d.player; return true; } catch { return false; }
  }

  async function refreshLeaderboard() {
    try {
      const d = await api('/api/leaderboard');
      const list = d.players || [];
      const mini = document.getElementById('leaderMini');
      if (mini) mini.innerHTML = list.slice(0, 5).map(x => `<div class="row"><span class="rank">${x.rank}</span><span class="name">${String(x.name).replace(/[&<>]/g,'')}</span><span class="score">${x.rating}</span></div>`).join('');
      const full = document.getElementById('leaderFull');
      if (full) full.innerHTML = list.map(x => `<div class="leaderRow"><span>${x.rank}</span><b>${String(x.name).replace(/[&<>]/g,'')}</b><span>${x.xp || 0} XP</span><strong class="score">${x.rating}</strong></div>`).join('');
      const meCard = document.getElementById('leaderMeCard');
      const mine = list.find(x => legacyNorm(x.name) === legacyNorm(me?.name));
      if (meCard && mine) meCard.textContent = `sen: #${mine.rank} • ${mine.rating} rating`;
    } catch {}
  }

  function wire() {
    document.getElementById('loginBtn')?.addEventListener('click', () => login(false));
    document.getElementById('registerBtn')?.addEventListener('click', () => login(true));
    document.querySelectorAll('.authTab').forEach(tab => tab.addEventListener('click', () => {
      const reg = tab.dataset.auth === 'register';
      document.querySelectorAll('.authTab').forEach(x => x.classList.toggle('active', x === tab));
      document.getElementById('loginPanel').style.display = reg ? 'none' : 'block';
      document.getElementById('registerPanel').style.display = reg ? 'block' : 'none';
    }));
    document.getElementById('answerBtn').onclick = answer;
    document.getElementById('passBtn').onclick = pass;
    document.getElementById('skipBtn').onclick = pass;
    document.getElementById('restartBtn').onclick = restart;
    document.getElementById('answer').onkeydown = e => { if (e.key === 'Enter') answer(); };
    window.startMode = async () => { if (!me && !(await checkSession())) { document.getElementById('accountModal').style.display = 'grid'; return; } document.querySelector('[data-screen=game]')?.click(); await startGame(); };
  }

  async function boot() {
    wire();
    if (await checkSession()) {
      document.getElementById('accountModal').style.display = 'none';
      applyStats(me); await startGame();
    } else {
      document.getElementById('accountModal').style.display = 'grid';
    }
    refreshLeaderboard();
    if (window.chatSocket?.connected) window.chatSocket.emit('auth:refresh');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();

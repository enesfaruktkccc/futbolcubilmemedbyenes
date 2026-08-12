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

  function parsePlayersFromPage() {
    const scripts = [...document.scripts].filter(s => !s.src);
    const script = scripts.find(s => s.textContent.includes('const playerNames = [') && s.textContent.includes('const uniquePlayerNames'));
    if (!script) return [];
    try {
      const text = script.textContent;
      const start = text.indexOf('const playerNames =');
      const end = text.indexOf('const uniquePlayerNames', start);
      if (start < 0 || end < 0) return [];
      const source = text.slice(start, end).replace(/^const playerNames\s*=\s*/, '').trim().replace(/;\s*$/, '');
      const names = Function(`"use strict"; return (${source});`)();
      const overrideStart = text.indexOf('const difficultyOverrides=', end);
      const overrideEnd = text.indexOf('const players=', overrideStart);
      let overrides = {};
      if (overrideStart >= 0 && overrideEnd > overrideStart) {
        const overrideSource = text.slice(overrideStart, overrideEnd).replace(/^const difficultyOverrides\s*=\s*/, '').trim().replace(/;\s*$/, '');
        overrides = Function(`"use strict"; return (${overrideSource});`)();
      }
      const seen = new Set();
      return names.map((name, i) => {
        const key = String(name).toLocaleLowerCase('tr-TR').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ı/g, 'i').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
        if (!key || seen.has(key)) return null;
        seen.add(key);
        const difficulty = Number(overrides[name]) || (i < 50 ? 1 : i < 150 ? 2 : i < 300 ? 3 : i < 400 ? 4 : 5);
        return { name: String(name), difficulty, aliases: [] };
      }).filter(Boolean);
    } catch (e) {
      console.error('Futbolcu kataloğu okunamadı', e);
      return [];
    }
  }

  function playersCatalog() {
    const parsed = parsePlayersFromPage();
    if (parsed.length >= 100) return parsed;
    try {
      if (typeof players !== 'undefined' && Array.isArray(players) && players.length >= 100) {
        return players.map(p => ({ name: p.name, difficulty: p.difficulty, aliases: [] }));
      }
    } catch {}
    return [];
  }

  function norm(s) {
    return String(s || '').toLocaleLowerCase('tr-TR').normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '').replace(/ı/g, 'i')
      .replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function notify(text) {
    console.log('[Futbolcuyu Bil]', text);
    const box = document.querySelector('.question h1');
    if (box) box.title = String(text).slice(0, 120);
  }

  function applyStats(s) {
    if (!s) return;
    for (const [id, value] of Object.entries({ correct: s.correct, total: s.total, streak: s.streak })) {
      const el = document.getElementById(id); if (el) el.textContent = value ?? 0;
    }
    const avatar = document.getElementById('avatar');
    const top = document.getElementById('userNameTop');
    const side = document.getElementById('accountSide');
    if (avatar) avatar.textContent = (s.name || me?.name || '?')[0].toUpperCase();
    if (top) top.textContent = s.name || me?.name || 'Oyuncu';
    if (side) side.textContent = s.name || me?.name || 'Giriş yap';
  }

  async function showImage(name) {
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
    } catch {
      const status = document.getElementById('imageStatus'); if (status) status.textContent = 'GÖRSEL BULUNAMADI';
    }
  }

  function renderQuestion(q) {
    question = q;
    hintsUsed = new Set();
    const difficulty = document.getElementById('difficulty');
    if (difficulty) difficulty.textContent = q.difficultyName || '';
    renderHints();
    showImage(q.name);
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
        } catch (e) { notify(e.message); }
      };
      box.appendChild(b);
    });
  }

  async function startGame() {
    if (!me) { openAccount(); return false; }
    const list = playersCatalog();
    if (list.length < 100) { notify('Futbolcu listesi yüklenemedi.'); return false; }
    try {
      const d = await api('/api/game/start', { method: 'POST', body: JSON.stringify({ catalog: list }) });
      applyStats(d.stats); renderQuestion(d.question); return true;
    } catch (e) { notify(e.message); console.error('game/start', e); return false; }
  }

  async function answer() {
    if (!me) { openAccount(); return; }
    const input = document.getElementById('answer'); const value = input?.value.trim();
    if (!value || !question) return;
    try {
      const d = await api('/api/game/answer', { method: 'POST', body: JSON.stringify({ questionId: question.id, answer: value }) });
      input.value = ''; applyStats(d.stats); notify(d.message); renderQuestion(d.next); await refreshLeaderboard();
    } catch (e) { notify(e.message); }
  }

  async function pass() {
    if (!me) { openAccount(); return; }
    if (!question) return;
    try {
      const d = await api('/api/game/pass', { method: 'POST', body: JSON.stringify({ questionId: question.id }) });
      const input = document.getElementById('answer'); if (input) input.value = '';
      applyStats(d.stats); notify(d.message); renderQuestion(d.next); await refreshLeaderboard();
    } catch (e) { notify(e.message); }
  }

  async function restart() {
    if (!me) { openAccount(); return; }
    try { const d = await api('/api/game/restart', { method: 'POST', body: '{}' }); applyStats(d.stats); renderQuestion(d.next); notify('Oyun yeniden başladı.'); }
    catch (e) { notify(e.message); }
  }

  function openAccount() { const modal = document.getElementById('accountModal'); if (modal) modal.style.display = 'grid'; }

  async function auth(register) {
    const user = document.getElementById(register ? 'registerUser' : 'loginUser')?.value.trim();
    const pass = document.getElementById(register ? 'registerPass' : 'loginPass')?.value || '';
    if (!user || !pass) { notify('Kullanıcı adı ve şifre gerekli.'); return; }
    try {
      const d = await api(register ? '/api/auth/register' : '/api/auth/login', { method: 'POST', body: JSON.stringify({ username: user, password: pass }) });
      me = d.player; const modal = document.getElementById('accountModal'); if (modal) modal.style.display = 'none';
      applyStats(me); document.querySelector('[data-screen="game"]')?.click(); await startGame(); await refreshLeaderboard();
    } catch (e) { notify(e.message); }
  }

  async function checkSession() { try { const d = await api('/api/session/me'); me = d.player; return true; } catch { return false; } }

  async function refreshLeaderboard() {
    try {
      const d = await api('/api/leaderboard'); const list = d.players || [];
      const mini = document.getElementById('leaderMini');
      if (mini) mini.innerHTML = list.slice(0,5).map(x => `<div class="row"><span class="rank">${x.rank}</span><span class="name">${String(x.name).replace(/[&<>]/g,'')}</span><span class="score">${x.rating}</span></div>`).join('');
      const full = document.getElementById('leaderFull');
      if (full) full.innerHTML = list.map(x => `<div class="leaderRow"><span>${x.rank}</span><b>${String(x.name).replace(/[&<>]/g,'')}</b><span>${x.xp||0} XP</span><strong class="score">${x.rating}</strong></div>`).join('');
      const meCard = document.getElementById('leaderMeCard'); const mine = list.find(x => norm(x.name) === norm(me?.name));
      if (meCard && mine) meCard.textContent = `sen: #${mine.rank} • ${mine.rating} rating`;
    } catch {}
  }

  function wireChat() {
    const pairs = [['chatForm','chatMessage'],['chatFormGame','chatMessageGame'],['chatFormMobile','chatMessageMobile']];
    pairs.forEach(([formId,inputId]) => {
      const form = document.getElementById(formId), input = document.getElementById(inputId); if (!form || !input) return;
      form.onsubmit = e => {
        e.preventDefault(); const text = input.value.trim(); if (!text) return;
        if (!me) { openAccount(); return; }
        try { if (typeof chatSocket !== 'undefined' && chatSocket?.connected) { chatSocket.emit('chat:message',{text:text.slice(0,180)}); input.value=''; input.focus(); } else notify('Chat bağlantısı yok.'); }
        catch (err) { notify(err.message); }
      };
    });
  }

  function disableLegacyHandlers() {
    ['answerBtn','passBtn','skipBtn','restartBtn'].forEach(id => {
      const el = document.getElementById(id); if (!el) return;
      el.onclick = null; el.onkeydown = null;
    });
    const input = document.getElementById('answer'); if (input) input.onkeydown = null;
  }

  function wire() {
    disableLegacyHandlers();
    document.getElementById('loginBtn')?.addEventListener('click', () => auth(false));
    document.getElementById('registerBtn')?.addEventListener('click', () => auth(true));
    document.querySelectorAll('.authTab').forEach(tab => tab.addEventListener('click', () => {
      const register = tab.dataset.auth === 'register';
      document.querySelectorAll('.authTab').forEach(x => x.classList.toggle('active', x === tab));
      const loginPanel = document.getElementById('loginPanel'), registerPanel = document.getElementById('registerPanel');
      if (loginPanel) loginPanel.style.display = register ? 'none' : 'block'; if (registerPanel) registerPanel.style.display = register ? 'block' : 'none';
    }));
    document.getElementById('answerBtn')?.addEventListener('click', answer);
    document.getElementById('passBtn')?.addEventListener('click', pass);
    document.getElementById('skipBtn')?.addEventListener('click', pass);
    document.getElementById('restartBtn')?.addEventListener('click', restart);
    document.getElementById('answer')?.addEventListener('keydown', e => { if (e.key === 'Enter') answer(); });
    window.startMode = async () => { if (!me && !(await checkSession())) { openAccount(); return; } document.querySelector('[data-screen="game"]')?.click(); await startGame(); };
    wireChat();
  }

  async function boot() {
    wire();
    if (await checkSession()) { const modal = document.getElementById('accountModal'); if (modal) modal.style.display = 'none'; applyStats(me); await startGame(); }
    else openAccount();
    await refreshLeaderboard();
  }

  window.addEventListener('unhandledrejection', e => console.error('Unhandled promise', e.reason));
  window.addEventListener('error', e => console.error('Page error', e.error || e.message));

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();

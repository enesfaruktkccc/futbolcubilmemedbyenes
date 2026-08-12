(() => {
  'use strict';

  const api = (url, options = {}) => fetch(url, {
    credentials: 'same-origin',
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
  }).then(async r => {
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
    return data;
  });

  let me = null;
  let question = null;
  let hintsUsed = new Set();

  function showMessage(text) {
    console.log('[Futbolcuyu Bil]', text);
    const imageStatus = document.getElementById('imageStatus');
    if (imageStatus && String(text).length <= 90) imageStatus.textContent = String(text);
  }

  function openAccount() {
    const modal = document.getElementById('accountModal');
    if (modal) modal.style.display = 'grid';
  }

  function setScreen(name) {
    document.querySelectorAll('.screen').forEach(screen => {
      const active = screen.id === name;
      screen.classList.toggle('active', active);
      screen.style.display = active ? '' : 'none';
    });
    document.querySelectorAll('[data-screen]').forEach(button => {
      button.classList.toggle('active', button.dataset.screen === name);
    });
    window.scrollTo({ top: 0, behavior: 'instant' });
  }

  function getCatalog() {
    try {
      if (typeof difficultyPools !== 'undefined' && difficultyPools) {
        const catalog = [];
        for (const [difficulty, pool] of Object.entries(difficultyPools)) {
          if (!Array.isArray(pool)) continue;
          for (const p of pool) {
            if (!p || !p.name) continue;
            catalog.push({ name: p.name, difficulty: Number(difficulty) || 1, aliases: Array.isArray(p.aliases) ? p.aliases : [] });
          }
        }
        return catalog;
      }
    } catch (e) { console.error('players list error', e); }
    return [];
  }

  function applyStats(s) {
    if (!s) return;
    const map = { correct: s.correct, total: s.total, streak: s.streak };
    Object.entries(map).forEach(([id, value]) => {
      const el = document.getElementById(id);
      if (el) el.textContent = String(value ?? 0);
    });
    const avatar = document.getElementById('avatar');
    const top = document.getElementById('userNameTop');
    const account = document.getElementById('accountSide');
    if (avatar) avatar.textContent = (s.name || me?.name || '?')[0].toUpperCase();
    if (top) top.textContent = s.name || me?.name || 'Oyuncu';
    if (account) account.textContent = s.name || me?.name || 'Giriş yap';
  }

  // image pipeline: try the server proxy first; if that fails, search Wikimedia
  // from the browser and load the thumbnail through a public image proxy.
  async function renderImage(name) {
    const img = document.getElementById('playerPhoto');
    const fallback = document.getElementById('fallbackPlayer');
    const status = document.getElementById('imageStatus');
    if (!img || !fallback) return;

    img.onload = () => {
      fallback.style.display = 'none';
      img.style.display = 'block';
      if (status) status.textContent = '';
    };
    img.onerror = () => {
      img.style.display = 'none';
      fallback.style.display = 'grid';
      if (status) status.textContent = 'GÖRSEL BULUNAMADI';
    };

    img.style.display = 'none';
    fallback.style.display = 'grid';
    if (status) status.textContent = 'GÖRSEL YÜKLENİYOR...';

    // 1) Our own server proxy.
    try {
      const localUrl = '/api/player-image?name=' + encodeURIComponent(name) + '&raw=1&v=2';
      const ok = await new Promise(resolve => {
        let settled = false;
        const finish = value => { if (!settled) { settled = true; resolve(value); } };
        const timer = setTimeout(() => finish(false), 7000);
        const probe = new Image();
        probe.onload = () => { clearTimeout(timer); finish(true); };
        probe.onerror = () => { clearTimeout(timer); finish(false); };
        probe.src = localUrl;
      });
      if (ok) {
        img.src = localUrl;
        return;
      }
    } catch (e) { console.warn('local image proxy failed', e); }

    // 2) Wikimedia search. Exact page lookup was unreliable for many players,
    // so search for the player and take the best page image instead.
    try {
      const searchUrl = 'https://en.wikipedia.org/w/api.php?action=query&generator=search&gsrsearch=' +
        encodeURIComponent(name) + '&gsrnamespace=0&gsrlimit=5&prop=pageimages&piprop=thumbnail&pithumbsize=900&format=json&origin=*';
      const response = await fetch(searchUrl, { credentials: 'omit' });
      if (!response.ok) throw new Error('wikimedia search ' + response.status);
      const data = await response.json();
      const pages = Object.values(data?.query?.pages || {});
      const normalized = String(name).toLocaleLowerCase('en-US').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
      pages.sort((a, b) => {
        const an = String(a.title || '').toLocaleLowerCase('en-US');
        const bn = String(b.title || '').toLocaleLowerCase('en-US');
        const as = an === normalized ? 0 : (an.includes(normalized) ? 1 : 2);
        const bs = bn === normalized ? 0 : (bn.includes(normalized) ? 1 : 2);
        return as - bs;
      });
      const imageUrl = pages.map(p => p?.thumbnail?.source).find(Boolean);
      if (!imageUrl) throw new Error('no Wikimedia thumbnail');

      // 3) Wikimedia itself can occasionally fail to load in a browser/network.
      // wsrv mirrors the image and serves it as a normal image response.
      const proxied = 'https://images.weserv.nl/?url=' + encodeURIComponent(imageUrl);
      img.src = proxied;
      return;
    } catch (e) {
      console.warn('Wikimedia image lookup failed', e);
      if (status) status.textContent = 'GÖRSEL BULUNAMADI';
    }
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
      const button = document.createElement('button');
      button.className = 'hint';
      button.textContent = hintsUsed.has(i) ? label : `İPUCU ${i + 1} • -${costs[i]}`;
      button.onclick = async () => {
        if (!question || hintsUsed.has(i)) return;
        try {
          const result = await api('/api/game/hint', {
            method: 'POST',
            body: JSON.stringify({ questionId: question.id, index: i })
          });
          hintsUsed.add(i);
          button.textContent = result.label || label;
        } catch (e) { showMessage(e.message); }
      };
      box.appendChild(button);
    });
  }

  function renderQuestion(q) {
    question = q;
    hintsUsed = new Set();
    const difficulty = document.getElementById('difficulty');
    if (difficulty) difficulty.textContent = q.difficultyName || '';
    renderHints();
    renderImage(q.name);
  }

  async function startGame() {
    if (!me) { openAccount(); return false; }
    const catalog = getCatalog();
    if (catalog.length < 100) {
      showMessage(`Futbolcu listesi okunamadı (${catalog.length}).`);
      return false;
    }
    try {
      const result = await api('/api/game/start', {
        method: 'POST',
        body: JSON.stringify({ catalog })
      });
      applyStats(result.stats);
      renderQuestion(result.question);
      return true;
    } catch (e) { showMessage(e.message); return false; }
  }

  async function answer() {
    if (!me) { openAccount(); return; }
    const input = document.getElementById('answer');
    const value = input?.value.trim();
    if (!value || !question) return;
    try {
      const result = await api('/api/game/answer', {
        method: 'POST',
        body: JSON.stringify({ questionId: question.id, answer: value })
      });
      input.value = '';
      applyStats(result.stats);
      showMessage(result.message);
      renderQuestion(result.next);
      refreshLeaderboard();
    } catch (e) { showMessage(e.message); }
  }

  async function pass() {
    if (!me) { openAccount(); return; }
    if (!question) return;
    try {
      const result = await api('/api/game/pass', {
        method: 'POST',
        body: JSON.stringify({ questionId: question.id })
      });
      const input = document.getElementById('answer');
      if (input) input.value = '';
      applyStats(result.stats);
      showMessage(result.message);
      renderQuestion(result.next);
      refreshLeaderboard();
    } catch (e) { showMessage(e.message); }
  }

  async function restart() {
    if (!me) { openAccount(); return; }
    try {
      const result = await api('/api/game/restart', { method: 'POST', body: '{}' });
      applyStats(result.stats);
      renderQuestion(result.next);
      showMessage('Oyun yeniden başladı.');
    } catch (e) { showMessage(e.message); }
  }

  async function auth(register) {
    const usernameId = register ? 'registerUser' : 'loginUser';
    const passwordId = register ? 'registerPass' : 'loginPass';
    const username = document.getElementById(usernameId)?.value.trim();
    const password = document.getElementById(passwordId)?.value || '';
    if (!username || !password) { showMessage('Kullanıcı adı ve şifre gerekli.'); return; }
    try {
      const result = await api(register ? '/api/auth/register' : '/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password })
      });
      me = result.player;
      const modal = document.getElementById('accountModal');
      if (modal) modal.style.display = 'none';
      applyStats(me);
      setScreen('game');
      await startGame();
      await refreshLeaderboard();
    } catch (e) { showMessage(e.message); }
  }

  async function checkSession() {
    try {
      const result = await api('/api/session/me');
      me = result.player;
      return true;
    } catch { return false; }
  }

  async function refreshLeaderboard() {
    try {
      const result = await api('/api/leaderboard');
      const list = result.players || [];
      const safe = value => String(value).replace(/[&<>]/g, '');
      const mini = document.getElementById('leaderMini');
      if (mini) mini.innerHTML = list.slice(0, 5).map(x => `<div class="row"><span class="rank">${x.rank}</span><span class="name">${safe(x.name)}</span><span class="score">${x.rating}</span></div>`).join('');
      const full = document.getElementById('leaderFull');
      if (full) full.innerHTML = list.map(x => `<div class="leaderRow"><span>${x.rank}</span><b>${safe(x.name)}</b><span>${x.xp || 0} XP</span><strong class="score">${x.rating}</strong></div>`).join('');
      const meCard = document.getElementById('leaderMeCard');
      const mine = list.find(x => String(x.name).toLocaleLowerCase('tr-TR') === String(me?.name).toLocaleLowerCase('tr-TR'));
      if (meCard && mine) meCard.textContent = `sen: #${mine.rank} • ${mine.rating} rating`;
    } catch (e) { console.error('leaderboard failed', e); }
  }

  function wireNavigation() {
    document.querySelectorAll('[data-screen]').forEach(button => {
      button.onclick = async () => {
        const target = button.dataset.screen;
        setScreen(target);
        if (target === 'game' && me) await startGame();
      };
    });
    window.startMode = async () => {
      if (!me && !(await checkSession())) { openAccount(); return; }
      setScreen('game');
      await startGame();
    };
    window.answerSecure = answer;
  }

  function wireGame() {
    const answerButton = document.getElementById('answerBtn');
    const passButton = document.getElementById('passBtn');
    const skipButton = document.getElementById('skipBtn');
    const restartButton = document.getElementById('restartBtn');
    const answerInput = document.getElementById('answer');
    if (answerButton) answerButton.onclick = answer;
    if (passButton) passButton.onclick = pass;
    if (skipButton) skipButton.onclick = pass;
    if (restartButton) restartButton.onclick = restart;
    if (answerInput) answerInput.onkeydown = e => { if (e.key === 'Enter') answer(); };
  }

  async function boot() {
    wireNavigation();
    wireGame();
    const login = document.getElementById('loginBtn');
    const register = document.getElementById('registerBtn');
    if (login) login.onclick = () => auth(false);
    if (register) register.onclick = () => auth(true);
    if (await checkSession()) {
      const modal = document.getElementById('accountModal');
      if (modal) modal.style.display = 'none';
      applyStats(me);
      setScreen('home');
    } else {
      setScreen('home');
      openAccount();
    }
    refreshLeaderboard();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();

(() => {
  'use strict';

  const api = (url, options = {}) => fetch(url, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options
  }).then(async r => {
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || 'İşlem başarısız.');
    return data;
  });

  let secureQuestionId = null;
  let secureMode = false;
  let secureStats = null;

  function catalog() {
    return Array.isArray(window.players)
      ? window.players.map(p => ({ name: p.name, difficulty: p.difficulty, aliases: [] }))
      : [];
  }

  function applyStats(s) {
    if (!s) return;
    secureStats = s;
    window.state = { ...window.state, ...s, usedPlayerIds: window.state?.usedPlayerIds || [] };
    if (typeof window.render === 'function') window.render();
    const correct = document.getElementById('correct');
    const total = document.getElementById('total');
    const streak = document.getElementById('streak');
    if (correct) correct.textContent = s.correct ?? 0;
    if (total) total.textContent = s.total ?? 0;
    if (streak) streak.textContent = s.streak ?? 0;
  }

  function showMessage(text) {
    if (typeof window.toast === 'function') window.toast(text);
    else console.log(text);
  }

  function setQuestion(q) {
    if (!q) return;
    secureQuestionId = q.id;
    secureMode = true;
    window.current = window.players?.find(p => window.norm(p.name) === window.norm(q.name)) || {
      id: 0, name: q.name, difficulty: q.difficulty
    };
    window.usedHints = [];
    window.startedAt = q.startedAt || Date.now();
    const difficulty = document.getElementById('difficulty');
    if (difficulty) difficulty.textContent = q.difficultyName || window.DIFFICULTIES?.[q.difficulty - 1]?.name || '';
    if (typeof window.renderHints === 'function') window.renderHints();
    if (typeof window.loadImage === 'function') window.loadImage();
    if (typeof window.render === 'function') window.render();
  }

  async function startSecureGame() {
    try {
      const data = await api('/api/game/start', {
        method: 'POST',
        body: JSON.stringify({ catalog: catalog() })
      });
      applyStats(data.stats);
      setQuestion(data.question);
      return true;
    } catch (e) {
      showMessage(e.message);
      return false;
    }
  }

  window.answer = async function secureAnswer() {
    if (!window.profile) { window.openAccount(); return; }
    const input = document.getElementById('answer');
    const raw = input?.value.trim();
    if (!raw || !secureQuestionId) return;
    try {
      const data = await api('/api/game/answer', {
        method: 'POST',
        body: JSON.stringify({ questionId: secureQuestionId, answer: raw })
      });
      if (input) input.value = '';
      applyStats(data.stats);
      showMessage(data.message);
      setQuestion(data.next);
    } catch (e) {
      showMessage(e.message);
      if (e.message.includes('Soru')) await startSecureGame();
    }
  };

  window.skip = async function secureSkip() {
    if (!window.profile) { window.openAccount(); return; }
    if (!secureQuestionId) return;
    try {
      const data = await api('/api/game/pass', {
        method: 'POST',
        body: JSON.stringify({ questionId: secureQuestionId })
      });
      const input = document.getElementById('answer');
      if (input) input.value = '';
      applyStats(data.stats);
      showMessage(data.message);
      setQuestion(data.next);
    } catch (e) { showMessage(e.message); }
  };

  window.restartGame = async function secureRestart() {
    if (!window.profile) { window.openAccount(); return; }
    try {
      const data = await api('/api/game/restart', { method: 'POST', body: '{}' });
      applyStats(data.stats);
      setQuestion(data.next);
      showMessage('Oyun yeniden başladı.');
    } catch (e) { showMessage(e.message); }
  };

  window.renderHints = function secureHints() {
    const box = document.getElementById('hints');
    if (!box || !window.current) return;
    const used = new Set(window.usedHints || []);
    const labels = [
      `Adı ${window.current.name.length} karakter`,
      `İlk harfi: ${window.current.name[0]?.toUpperCase() || '?'}`,
      `Soyadının ilk harfi: ${window.current.name.split(' ').pop()?.[0]?.toUpperCase() || '?'}`
    ];
    const costs = [5, 5, 15];
    box.innerHTML = labels.map((label, i) => {
      const b = document.createElement('button');
      b.className = 'hint';
      b.textContent = used.has(costs[i]) ? label : `İPUCU ${i + 1} • -${costs[i]}`;
      b.onclick = async () => {
        if (used.has(costs[i]) || !secureQuestionId) return;
        try {
          const data = await api('/api/game/hint', {
            method: 'POST',
            body: JSON.stringify({ questionId: secureQuestionId, index: i })
          });
          window.usedHints = data.used || [];
          window.renderHints();
        } catch (e) { showMessage(e.message); }
      };
      return b;
    }).forEach(b => box.appendChild(b));
  };

  function setProfile(player) {
    if (!player) return;
    window.profile = { name: player.name };
    applyStats(player);
    localStorage.setItem('futbolcuyu_server_session_v1', '1');
    if (window.chatSocket?.connected) window.chatSocket.emit('auth:refresh');
  }

  async function serverMe() {
    try {
      const data = await api('/api/session/me');
      setProfile(data.player);
      return data.player;
    } catch { return null; }
  }

  async function login(username, password) {
    const data = await api('/api/auth/login', {
      method: 'POST', body: JSON.stringify({ username, password })
    });
    setProfile(data.player);
    document.getElementById('accountModal').style.display = 'none';
    await startSecureGame();
  }

  async function register(username, password) {
    const data = await api('/api/auth/register', {
      method: 'POST', body: JSON.stringify({ username, password })
    });
    setProfile(data.player);
    document.getElementById('accountModal').style.display = 'none';
    await startSecureGame();
  }

  function wireAuth() {
    const loginBtn = document.getElementById('loginBtn');
    const registerBtn = document.getElementById('registerBtn');
    if (loginBtn) loginBtn.onclick = async () => {
      try {
        await login(document.getElementById('loginUser').value.trim(), document.getElementById('loginPass').value);
      } catch (e) { showMessage(e.message); }
    };
    if (registerBtn) registerBtn.onclick = async () => {
      try {
        await register(document.getElementById('registerUser').value.trim(), document.getElementById('registerPass').value);
      } catch (e) { showMessage(e.message); }
    };

    document.querySelectorAll('.authTab').forEach(tab => {
      tab.onclick = () => {
        document.querySelectorAll('.authTab').forEach(x => x.classList.remove('active'));
        tab.classList.add('active');
        const registerPanel = document.getElementById('registerPanel');
        const loginPanel = document.getElementById('loginPanel');
        const register = tab.dataset.auth === 'register';
        if (registerPanel) registerPanel.style.display = register ? 'block' : 'none';
        if (loginPanel) loginPanel.style.display = register ? 'none' : 'block';
      };
    });
  }

  function wireGameButtons() {
    const answerBtn = document.getElementById('answerBtn');
    const passBtn = document.getElementById('passBtn');
    const skipBtn = document.getElementById('skipBtn');
    const restartBtn = document.getElementById('restartBtn');
    if (answerBtn) answerBtn.onclick = window.answer;
    if (passBtn) passBtn.onclick = window.skip;
    if (skipBtn) skipBtn.onclick = window.skip;
    if (restartBtn) restartBtn.onclick = window.restartGame;
    const input = document.getElementById('answer');
    if (input) input.onkeydown = e => { if (e.key === 'Enter') window.answer(); };
  }

  function patchStartMode() {
    window.startMode = async function secureStartMode() {
      const existing = await serverMe();
      if (!existing) { window.openAccount(); return; }
      document.querySelector('[data-screen=game]')?.click();
      await startSecureGame();
    };
  }

  async function boot() {
    wireAuth();
    wireGameButtons();
    patchStartMode();
    const me = await serverMe();
    if (me) {
      document.getElementById('accountModal').style.display = 'none';
      await startSecureGame();
    } else {
      document.getElementById('accountModal').style.display = 'grid';
    }
    if (window.chatSocket) window.chatSocket.emit('auth:refresh');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();

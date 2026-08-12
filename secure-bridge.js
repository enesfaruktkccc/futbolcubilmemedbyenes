(() => {
  const bind = (name, get, set) => {
    try {
      Object.defineProperty(window, name, { configurable: true, get, set });
    } catch (e) {}
  };
  bind('players', () => players, v => {});
  bind('current', () => current, v => { current = v; });
  bind('usedHints', () => usedHints, v => { usedHints = Array.isArray(v) ? v : []; });
  bind('startedAt', () => startedAt, v => { startedAt = Number(v) || Date.now(); });
  bind('state', () => state, v => { state = v || state; });
  bind('profile', () => profile, v => { profile = v; });
  bind('currentUsername', () => currentUsername, v => { currentUsername = String(v || ''); });
  bind('chatSocket', () => chatSocket, v => { chatSocket = v; });
})();

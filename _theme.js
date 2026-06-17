/* Shared theme switcher. Reads localStorage.lcb_theme, applies data-theme
 * to <html>. Adds floating toggle button. Default = 'light' (per user 10.05).
 */
(function () {
  var KEY = 'lcb_theme';
  var USER_SET_KEY = 'lcb_theme_user_set';
  function get() {
    try {
      var v = localStorage.getItem(KEY);
      // Legacy sessions may have a stale dark value from previous dashboard
      // defaults. Treat it as light until the user explicitly toggles theme
      // again in this version.
      if (v === 'dark' && localStorage.getItem(USER_SET_KEY) !== '1') return 'light';
      return v || 'light';
    }
    catch { return 'light'; }
  }
  function set(v, userSet) {
    document.documentElement.setAttribute('data-theme', v);
    try {
      localStorage.setItem(KEY, v);
      if (userSet) localStorage.setItem(USER_SET_KEY, '1');
    } catch {}
  }
  // Apply ASAP (before paint) — script tag должен быть в <head>
  set(get(), false);

  function mountToggle() {
    if (document.querySelector('.lcb-theme-toggle')) return;
    // Pages with their own header button use the same lcb_theme storage key.
    // Avoid rendering a second floating switcher there.
    if (document.querySelector('#theme-toggle.theme-toggle')) return;
    var btn = document.createElement('button');
    btn.className = 'lcb-theme-toggle';
    btn.setAttribute('aria-label', 'Toggle theme');
    function updateIcon() {
      btn.textContent = get() === 'light' ? '🌙' : '☀️';
      btn.title = get() === 'light' ? 'Тёмная тема' : 'Светлая тема';
    }
    updateIcon();
    btn.addEventListener('click', function () {
      set(get() === 'light' ? 'dark' : 'light', true);
      updateIcon();
    });
    document.body.appendChild(btn);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountToggle);
  } else {
    mountToggle();
  }
})();

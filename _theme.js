/* Shared theme switcher. Reads localStorage.lcb_theme, applies data-theme
 * to <html>. Adds floating toggle button. Default = 'light' (per user 10.05).
 */
(function () {
  var KEY = 'lcb_theme';
  function get() {
    try { return localStorage.getItem(KEY) || 'light'; }
    catch { return 'light'; }
  }
  function set(v) {
    document.documentElement.setAttribute('data-theme', v);
    try { localStorage.setItem(KEY, v); } catch {}
  }
  // Apply ASAP (before paint) — script tag должен быть в <head>
  set(get());

  function mountToggle() {
    if (document.querySelector('.lcb-theme-toggle')) return;
    var btn = document.createElement('button');
    btn.className = 'lcb-theme-toggle';
    btn.setAttribute('aria-label', 'Toggle theme');
    function updateIcon() {
      btn.textContent = get() === 'light' ? '🌙' : '☀️';
      btn.title = get() === 'light' ? 'Тёмная тема' : 'Светлая тема';
    }
    updateIcon();
    btn.addEventListener('click', function () {
      set(get() === 'light' ? 'dark' : 'light');
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

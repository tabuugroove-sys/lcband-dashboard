/* Shared top navigation — auto-inject на всех страницах dashboard.
 * Подключение: <script src="_nav.js"></script> в <head>.
 *
 * Преимущество vs ручная nav в каждом HTML:
 *   - один источник правды
 *   - изменения в этом файле автоматически на всех страницах
 *   - active state определяется по location.pathname
 */
(function () {
  var PAGES = [
    { href: 'index.html',           emoji: '🏠', label: 'Дашборд',     color: 'home' },
    { href: 'events.html',          emoji: '📋', label: 'Events',     color: 'events' },
    { href: 'pricing.html',         emoji: '💰', label: 'Pricing',    color: 'pricing' },
    { href: 'broker.html',          emoji: '🤝', label: 'Broker',     color: 'broker' },
    { href: 'cost.html',            emoji: '💸', label: 'Расход',     color: 'cost' },
    { href: 'context_cards.html',   emoji: '🗂', label: 'Картотека',  color: 'cards' },
    { href: 'architecture.html',    emoji: '🗺️', label: 'Архитектура', color: 'arch' },
  ];

  var STYLE_ID = 'lcb-nav-style';
  var NAV_ID = 'lcb-nav';

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = [
      '#' + NAV_ID + ' { display:flex; gap:8px; flex-wrap:wrap; align-items:center;',
      '  margin:0 0 16px 0; padding: 8px 0; }',
      '#' + NAV_ID + ' a { padding:7px 11px; border-radius:8px; font-size:13px;',
      '  font-weight:600; text-decoration:none; border:1px solid; white-space:nowrap;',
      '  transition: transform .1s; }',
      '#' + NAV_ID + ' a:hover { transform: translateY(-1px); text-decoration:none; }',
      '#' + NAV_ID + ' a.home    { background:rgba(255,149,0,0.12); color:#ff9500;  border-color:rgba(255,149,0,0.35); }',
      '#' + NAV_ID + ' a.events  { background:rgba(52,199,89,0.12); color:#34c759;  border-color:rgba(52,199,89,0.35); }',
      '#' + NAV_ID + ' a.pricing { background:rgba(255,149,0,0.12); color:#ff9500;  border-color:rgba(255,149,0,0.35); }',
      '#' + NAV_ID + ' a.broker  { background:rgba(16,163,127,0.12); color:#10a37f;  border-color:rgba(16,163,127,0.35); }',
      '#' + NAV_ID + ' a.cost    { background:rgba(0,112,243,0.14); color:#0070f3;  border-color:rgba(0,112,243,0.45); }',
      '#' + NAV_ID + ' a.cards   { background:rgba(255,59,48,0.10); color:#ff3b30;  border-color:rgba(255,59,48,0.30); }',
      '#' + NAV_ID + ' a.arch    { background:rgba(113,56,199,0.12); color:#7138c7;  border-color:rgba(113,56,199,0.35); }',
      '#' + NAV_ID + ' a.active  { box-shadow: inset 0 0 0 1px currentColor; }',
      // Dark theme — повышаем contrast
      'html[data-theme="dark"] #' + NAV_ID + ' a { color: inherit; }',
    ].join('\n');
    document.head.appendChild(s);
  }

  function currentPage() {
    var path = (location.pathname || '').split('/').pop() || 'index.html';
    return path.toLowerCase();
  }

  function buildNav() {
    if (document.getElementById(NAV_ID)) return;
    var nav = document.createElement('nav');
    nav.id = NAV_ID;
    nav.setAttribute('aria-label', 'Main navigation');
    var current = currentPage();
    PAGES.forEach(function (p) {
      var a = document.createElement('a');
      a.href = p.href;
      var isActive = p.href.toLowerCase() === current ||
        (p.href === 'context_cards.html' && current === 'context-card.html');
      a.className = p.color + (isActive ? ' active' : '');
      a.textContent = p.emoji + ' ' + p.label;
      nav.appendChild(a);
    });
    // Вставляем в начало body. Если есть существующая <nav class="topnav"> — заменяем,
    // чтобы не было двойной навигации с разными цветами/набором.
    var existingNav = document.querySelector('nav.topnav, nav#topnav');
    if (existingNav) {
      existingNav.parentNode.replaceChild(nav, existingNav);
    } else {
      document.body.insertBefore(nav, document.body.firstChild);
    }
  }

  function mount() {
    injectStyles();
    buildNav();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }
})();

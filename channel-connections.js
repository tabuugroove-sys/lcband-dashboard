/* Connection evidence only: no AI calls, sends, or automatic browser login probes. */
(() => {
  'use strict';
  const root = document.getElementById('channelConnections');
  if (!root) return;
  const local = 'http://127.0.0.1:8878';
  const names = {read:'Чтение', send:'Отправка', followup:'Follow-up'};
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const when = t => t ? new Date(t * 1000).toLocaleString('ru-RU') : 'нет отметки проверки';
  let busy = false, checking = false;
  async function json(url, options = {}, timeout = 8000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetch(url, {...options, signal:controller.signal, cache:'no-store'});
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } finally { clearTimeout(timer); }
  }
  function card(c) {
    return `<article class="cc-card"><h3>${esc(c.channel)} <small>· ${esc(c.location)}</small></h3><div class="cc-transport">${esc(c.transport)}</div>${Object.entries(names).map(([key,name]) => {
      const v = c.capabilities[key];
      return `<details class="cc-row"><summary><span>${name}</span><span class="cc-state" data-state="${esc(v.state)}">${esc(v.label)}</span></summary><p>${esc(v.detail)}</p><span class="cc-time">Проверено: ${esc(when(v.checked_at))}</span></details>`;
    }).join('')}${c.channel === 'ВКонтакте' ? '<button type="button" data-cc-vk>Проверить вход VK</button>' : ''}</article>`;
  }
  async function refresh() {
    if (busy || checking) return;
    busy = true;
    const results = await Promise.allSettled([
      json(local + '/api/channel-connections'), json('/api/core/data-source'), json('/api/core/health')
    ]);
    const [connections,source,health] = results.map(r => r.status === 'fulfilled' ? r.value : null);
    const expanded = new Set([...root.querySelectorAll('details[open]')].map(el => el.dataset.key));
    const location = source?.location === 'server' ? 'Сервер' : source?.location === 'local' ? 'Локально' : 'место не подтверждено';
    const app = source ? `${esc(location)} · ${esc(source.label || 'Core')}` : 'источник не отвечает';
    const core = health ? `Ручная отправка: ${health.manual_send_enabled === true ? 'очередь доступна' : 'выключена'}. Автоотправка: ${health.agent_send_enabled === true ? 'разрешена' : 'выключена'}. Режим транспорта: ${esc(health.telegram_transport_mode || 'неизвестен')}.` : 'Состояние отправки Core не получено.';
    root.innerHTML = `<div class="cc-heading"><div><h2>Подключения каналов</h2><p>Приложение получает данные: <strong>${app}</strong></p></div><button type="button" data-cc-refresh>Обновить</button></div><div class="cc-core"><strong>Telegram · Core приложения</strong><br>${core}<br><span class="cc-note">Доступная очередь не подтверждает доставку. Follow-up отдельно не подтверждён.</span></div>${connections?.ok ? `<div class="cc-grid">${connections.channels.map(card).join('')}</div>` : '<p role="status">Локальный источник на Маке недоступен (127.0.0.1:8878). Состояние подключений неизвестно.</p>'}<p class="cc-note">Чтение, отправка и follow-up проверяются отдельно. Нажмите строку, чтобы увидеть основание и время проверки. Обновление статусов не отправляет сообщения.</p><div data-cc-result role="status"></div>`;
    root.querySelectorAll('details').forEach((el, index) => {
      el.dataset.key = String(index);
      el.open = expanded.has(String(index));
    });
    busy = false;
  }
  root.addEventListener('click', async event => {
    if (event.target.closest('[data-cc-refresh]')) refresh();
    const button = event.target.closest('[data-cc-vk]');
    if (!button || checking) return;
    checking = true; button.disabled = true;
    const message = root.querySelector('[data-cc-result]');
    message.textContent = 'Проверяю вход в существующем браузерном профиле VK…';
    try {
      await json(local + '/api/channel-connections/check-vk', {method:'POST'}, 150000);
      checking = false; await refresh();
    } catch (_) {
      message.textContent = 'Проверка VK не завершилась. Подключение не подтверждено.';
    } finally { checking = false; button.disabled = false; }
  });
  function visibleRefresh() { if (!document.hidden && location.hash === '#system') refresh(); }
  window.addEventListener('hashchange', visibleRefresh);
  document.addEventListener('visibilitychange', visibleRefresh);
  setInterval(visibleRefresh, 30000);
  visibleRefresh();
})();

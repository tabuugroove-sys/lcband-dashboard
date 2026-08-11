"use strict";

/* Operational parity workspace for Core v2.
 * Reads use an explicit server-side allowlist.  Effects require an authenticated
 * operator session plus a one-time challenge bound to the exact request body.
 */
(function () {
  const state = {
    activeArea: "overview",
    capabilities: [],
    authenticated: false,
    initialized: false,
    loading: false,
    renderingArea: "",
    pendingForce: false,
    cache: new Map(),
  };

  const AREA_META = Object.freeze({
    overview: ["Операционный обзор", "Все production-контуры и их реальные границы."],
    broker: ["Broker", "Заказы, кандидаты, составы и relay-платежи."],
    pricing: ["Клиентские цены", "Только действующий канон из price_canon.py."],
    contacts: ["Контакты и роли", "Контекст, идентичности и назначенные роли."],
    leads: ["Лиды и задачи", "Воронка, аудит контекста, неопределённость и ручная отмена."],
    approvals: ["Согласования", "Черновики, отклонения и подтверждённая ручная отправка."],
    events: ["События", "Planning overlay, действия по составу, площадке и группе."],
    runtime: ["Процессы", "Live-health, launchd, rescans и восстановление сессий."],
    cost: ["Расход и маршрутизация", "Provider spend, квоты, routing и LLM guard."],
    outreach: ["Outreach и A/B", "Browser Walk, прогресс мониторинга и ручной A/B запуск."],
    tools: ["Инструменты", "Журналы, подписи, KB, AI layer и снимок базы."],
    broadcast: ["Рассылка", "Draft-first кампании с отдельной operator-активацией."],
  });

  function byId(id) { return document.getElementById(id); }
  function esc(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    })[char]);
  }
  function attr(value) { return esc(value).replace(/`/g, "&#96;"); }
  function money(value) {
    const n = Number(value);
    return Number.isFinite(n) ? `${new Intl.NumberFormat("ru-RU").format(n)} ₽` : "—";
  }
  function usd(value) {
    const n = Number(value);
    return Number.isFinite(n) ? `$${n.toFixed(2)}` : "—";
  }
  function count(value) {
    const n = Number(value);
    return Number.isFinite(n) ? new Intl.NumberFormat("ru-RU").format(n) : "—";
  }
  function short(value, max = 140) {
    const text = typeof value === "string" ? value : value == null ? "" : JSON.stringify(value);
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
  }
  function notify(message) {
    if (typeof window.toast === "function") window.toast(message);
    else console.info(message);
  }
  function getPath(object, ...keys) {
    for (const key of keys) {
      if (object && object[key] !== undefined && object[key] !== null) return object[key];
    }
    return null;
  }
  function rowsFrom(payload, keys = []) {
    if (Array.isArray(payload)) return payload;
    for (const key of keys) {
      if (Array.isArray(payload?.[key])) return payload[key];
      if (payload?.[key] && typeof payload[key] === "object") {
        return Object.entries(payload[key]).map(([id, item]) => (
          item && typeof item === "object" ? { __key: id, ...item } : { __key: id, value: item }
        ));
      }
    }
    const arrays = Object.values(payload || {}).filter(Array.isArray);
    if (arrays.length) return arrays[0];
    return [];
  }
  function settled(result, fallback = {}) {
    return result.status === "fulfilled" ? result.value : { ...fallback, __error: result.reason?.message || String(result.reason) };
  }
  function errorMessage(payload) {
    return payload?.detail || payload?.error || payload?.message || "Неизвестная ошибка";
  }

  async function request(url, options = {}) {
    const response = await fetch(url, { credentials: "same-origin", ...options });
    const type = response.headers.get("content-type") || "";
    const payload = type.includes("json") ? await response.json() : await response.text();
    if (!response.ok) {
      const error = new Error(typeof payload === "string" ? payload : errorMessage(payload));
      error.status = response.status;
      error.payload = payload;
      throw error;
    }
    return payload;
  }
  function read(path, query = "") {
    const suffix = query ? `?${query}` : "";
    return request(`/api/legacy-read/${path}${suffix}`);
  }
  async function sha256(text) {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  async function refreshSession() {
    try {
      const payload = await request("/api/core/operator-session");
      state.authenticated = Boolean(payload.authenticated);
    } catch (_) {
      state.authenticated = false;
    }
    renderSessionState();
    return state.authenticated;
  }
  async function mutate(path, capability, payload = {}, method = "POST") {
    if (!await refreshSession()) {
      openLogin();
      throw new Error("Сначала выполните operator login");
    }
    const body = JSON.stringify(payload ?? {});
    const challenge = await request("/api/core/action-challenge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        capability,
        method,
        path,
        body_sha256: await sha256(body),
      }),
    });
    return request(`/api/core/action/${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        "X-Core-Operator-Confirm": capability,
        "X-Core-Action-Challenge": challenge.challenge,
        "X-Request-ID": `core-parity:${Date.now()}`,
      },
      body,
    });
  }

  function container() {
    const area = state.renderingArea || state.activeArea;
    return area === "broadcast" ? byId("broadcastParity") : byId("parityContent");
  }
  function head(area, actions = "") {
    const [title, subtitle] = AREA_META[area] || [area, ""];
    return `<header class="parity-section-head"><div><h2>${esc(title)}</h2><p>${esc(subtitle)}</p></div><div class="parity-toolbar">${actions}</div></header>`;
  }
  function metric(value, label, extra = "") {
    return `<article class="parity-card parity-metric ${extra}"><strong>${esc(value)}</strong><span>${esc(label)}</span></article>`;
  }
  function rawCard(title, payload, extra = "") {
    return `<article class="parity-card is-wide ${extra}"><h3>${esc(title)}</h3><pre class="parity-json">${esc(JSON.stringify(payload, null, 2))}</pre></article>`;
  }
  function panelError(error) {
    return `<div class="parity-error"><strong>Контур не прочитан</strong><p>${esc(error?.message || error)}</p><button class="parity-action" data-parity-action="refresh">Повторить</button></div>`;
  }
  function loading() {
    const target = container();
    if (target) target.innerHTML = '<div class="parity-loading"><span></span><strong>Читаем live-состояние…</strong></div>';
  }

  async function loadCapabilities(force = false) {
    if (state.capabilities.length && !force) return state.capabilities;
    const payload = await request("/api/core/capabilities");
    state.capabilities = payload.capabilities || [];
    const areas = new Set(state.capabilities.map((item) => item.area));
    const mutations = state.capabilities.filter((item) => item.mutation).length;
    const stats = byId("parityHeroStats");
    if (stats) stats.innerHTML = `<span><b>${areas.size}</b>контуров</span><span><b>${mutations}</b>действий</span><span><b>0</b>новых catch-all</span>`;
    return state.capabilities;
  }

  async function renderOverview() {
    const [caps, runtimeResult, approvalsResult, brokerResult, costResult] = await Promise.all([
      loadCapabilities(),
      read("runtime_health").catch((error) => ({ __error: error.message })),
      read("approvals", "full=1").catch((error) => ({ __error: error.message })),
      read("broker_dashboard").catch((error) => ({ __error: error.message })),
      read("cost_overview").catch((error) => ({ __error: error.message })),
    ]);
    const groups = Object.entries(caps.reduce((acc, item) => {
      acc[item.area] ||= { read: 0, actions: 0 };
      item.mutation ? acc[item.area].actions += 1 : acc[item.area].read += 1;
      return acc;
    }, {}));
    const approvalRows = rowsFrom(approvalsResult, ["approvals", "pending", "items"]);
    const processRows = rowsFrom(runtimeResult, ["processes", "agents", "services"]);
    const brokerRows = rowsFrom(brokerResult, ["orders", "active_orders", "items"]);
    const spend = getPath(costResult?.today, "total_cost_usd", "cost_usd") ?? getPath(costResult, "total_cost_24h", "cost_24h", "spend_24h", "total_usd") ?? 0;
    container().innerHTML = `${head("overview", '<button class="parity-action" data-parity-action="refresh">↻ Обновить</button>')}
      <div class="parity-grid">
        ${metric(count(approvalRows.length), "решений в очереди", approvalRows.length ? "warn" : "")}
        ${metric(count(processRows.length), "процессов в live-снимке")}
        ${metric(count(brokerRows.length), "broker-заказов")}
        ${metric(usd(spend), "provider spend / сегодня")}
        ${metric(state.authenticated ? "UNLOCKED" : "READ ONLY", "operator-сессия", state.authenticated ? "accent" : "")}
        ${metric("0", "wildcard routes в parity bridge")}
      </div>
      <div class="parity-grid">
        ${groups.map(([area, item]) => `<article class="parity-card"><h3>${esc(AREA_META[area]?.[0] || area)}</h3><p>${item.read} read-capabilities · ${item.actions} gated actions</p><button class="parity-action" data-parity-area-jump="${attr(area)}">Открыть →</button></article>`).join("")}
      </div>
      <p class="parity-note">Core v2 не дублирует бизнес-логику legacy: он даёт управляемую дорогу к действующему владельцу функции. Автоответы и SEND HOLD этим мостом не меняются. Старый /api/app/* пока остаётся только для ранее существовавших экранов токенов/routing и не используется этим parity workspace.</p>`;
  }

  async function renderPricing() {
    const data = await request("/api/core/client-pricing");
    const lineups = data.lineups || [];
    container().innerHTML = `${head("pricing", '<span class="pill ok">LIVE CANON</span>')}
      <div class="parity-grid">
        ${lineups.map((item) => `<article class="parity-card parity-metric"><strong>${money(item.client_price_rub)}</strong><span>${esc(item.label)}</span><p>${item.size} человек · ${esc(item.id)}</p></article>`).join("")}
      </div>
      <div class="parity-grid two">
        <article class="parity-card"><h3>Компактные форматы</h3><p><strong>${money(data.compact?.standard_rub)}</strong> — стандарт</p><p><strong>${money(data.compact?.low_budget_floor_rub)}</strong> — только при явно названном бюджете клиента</p></article>
        <article class="parity-card"><h3>Короткие слоты</h3><p>Solo: ${(data.short_slots?.solo_rub || []).map(money).join(" · ")}</p><p>Duet: ${(data.short_slots?.duet_rub || []).map(money).join(" · ")}</p></article>
        <article class="parity-card"><h3>Оборудование</h3><p>Малое: ${money(data.equipment?.small_rub)}</p><p>Стандартный backline: ${(data.equipment?.standard_backline_rub || []).map(money).join(" · ")}</p><p>Большой: ${(data.equipment?.large_backline_rub || []).map(money).join(" · ")}</p></article>
        <article class="parity-card"><h3>Коэффициенты</h3><p>СПб ×${esc(data.rules?.spb_travel_multiplier)} · регионы ×${esc(data.rules?.region_travel_multiplier)} · второй день ×${esc(data.rules?.second_day_multiplier)}</p><p>Безнал: ${esc(data.rules?.cashless_formula)}</p></article>
      </div>
      <section class="parity-card" style="margin-top:9px"><h3>Барабанное шоу</h3><div class="parity-list">${(data.drum_show || []).map((item) => `<div class="parity-row"><div><strong>${esc(item.label)}</strong><small>${esc(item.id)}</small></div><p>${esc(item.note || "Клиентский канон")}</p><strong>${money(item.client_price_rub)}</strong></div>`).join("")}</div></section>
      <p class="parity-note">Источник: ${esc(data.source)}. Закупочные ставки музыкантов здесь намеренно не показываются.</p>`;
  }

  async function renderBroker() {
    const results = await Promise.allSettled([read("broker_dashboard"), read("broker_orders"), read("broker_roster")]);
    const dashboard = settled(results[0]);
    const ordersPayload = settled(results[1]);
    const rosterPayload = settled(results[2]);
    const orders = rowsFrom(ordersPayload, ["orders", "items", "active"]);
    const categories = rowsFrom(rosterPayload, ["categories"]);
    const roster = categories.flatMap((category) => (category.vendors || []).map((vendor) => ({ ...vendor, category_label: vendor.category_label || category.label })));
    container().innerHTML = `${head("broker", '<button class="parity-action" data-parity-action="refresh">↻ Live</button>')}
      <div class="parity-grid">${metric(count(orders.length), "заказов")}${metric(count(roster.length), "позиций в составе")}${metric(short(getPath(dashboard, "status", "stage", "updated_at") || "LIVE", 24), "состояние контура")}</div>
      <section class="parity-card is-wide" style="margin-top:9px"><h3>Заказы · клиент ↔ подрядчики · маржа · relay</h3><div class="parity-list">${orders.slice(0, 80).map((item) => `<div class="parity-row"><div><strong>${esc(item.client_name || item.client_username || item.title || item.id || "Заказ")}</strong><small>${esc(item.event_date || "без даты")} · ${esc(item.event_location || "")}</small></div><p>${esc(item.service_label || item.service_type || "Услуга")} · бюджет ${money(item.budget_rub)} · потолок подрядчика ${money(item.contractor_ceiling_rub)} · маржа ${money(item.margin_rub)} (${esc(item.margin_pct || 0)}%)</p><div class="parity-actions"><span class="pill ${item.block_severity === "urgent" ? "hold" : ""}">${esc(item.block_reason || item.status || "live")}</span><span class="pill">${count(item.candidates_count || (item.candidates || []).length)} кандидатов</span><span class="pill">${count(item.candidates_sent_to_client || 0)} relayed</span></div>${(item.candidates || []).length ? `<details><summary>Подрядчики</summary><div class="parity-list">${item.candidates.map((candidate) => `<div class="parity-row"><div><strong>${esc(candidate.name || candidate.username || "Подрядчик")}</strong><small>${esc(candidate.stage || "")}</small></div><p>${money(candidate.price_rub)} · ceiling: ${esc(candidate.vs_ceiling || "—")} · quality: ${esc(candidate.quality_score ?? "—")}</p></div>`).join("")}</div></details>` : ""}</div>`).join("") || '<div class="empty-state">Заказы не найдены.</div>'}</div></section>
      <section class="parity-card is-wide" style="margin-top:9px"><h3>Состав и кандидаты</h3><div class="parity-table-wrap"><table class="parity-table"><thead><tr><th>Исполнитель</th><th>Роль</th><th>Статус</th><th>Контакт / ставка</th></tr></thead><tbody>${roster.slice(0, 120).map((item) => `<tr><td>${esc(getPath(item, "name", "display_name", "username") || item.__key || "—")}</td><td>${esc(getPath(item, "role", "instrument", "category") || "—")}</td><td>${esc(getPath(item, "status", "availability") || "—")}</td><td>${esc(short(getPath(item, "price", "rate", "phone", "username") || "—", 80))}</td></tr>`).join("")}</tbody></table></div></section>`;
  }

  async function renderContacts() {
    const results = await Promise.allSettled([read("context_cards"), read("contact_roles"), read("world")]);
    const cardsPayload = settled(results[0]);
    const rolesPayload = settled(results[1]);
    const world = settled(results[2]);
    const cards = rowsFrom(cardsPayload, ["cards", "contacts", "items"]);
    const roles = rowsFrom(rolesPayload, ["roles", "contacts", "items"]);
    container().innerHTML = `${head("contacts", '<button class="parity-action" data-parity-action="refresh">↻ Обновить</button>')}
      <div class="parity-grid">${metric(count(cards.length), "контекстных карточек")}${metric(count(roles.length), "роль-связей")}${metric(count(getPath(world, "total", "nodes", "contacts") || 0), "узлов world")}</div>
      <section class="parity-card is-wide" style="margin-top:9px"><h3>Карточки контактов</h3><div class="parity-list">${cards.slice(0, 120).map((item) => `<div class="parity-row"><div><strong>${esc(getPath(item, "display_name", "name", "title", "username") || item.__key || "Контакт")}</strong><small>${esc(getPath(item, "username", "phone", "channel", "id") || "")}</small></div><p>${esc(short(getPath(item, "summary", "context", "last_message", "notes") || item, 190))}</p><span class="pill">${esc(getPath(item, "role", "role_group", "stage") || "unknown")}</span></div>`).join("") || '<div class="empty-state">Контекстных карточек нет.</div>'}</div></section>
      <section class="parity-card is-wide" style="margin-top:9px"><h3>Назначенные роли</h3><div class="parity-table-wrap"><table class="parity-table"><thead><tr><th>Контакт</th><th>Роль</th><th>Источник</th><th>Уверенность</th></tr></thead><tbody>${roles.slice(0, 160).map((item) => `<tr><td>${esc(getPath(item, "display_name", "username", "person_id") || item.__key || "—")}</td><td>${esc(getPath(item, "role", "role_kind", "role_group") || "—")}</td><td>${esc(getPath(item, "source", "source_kind", "evidence") || "—")}</td><td>${esc(getPath(item, "confidence", "status") || "—")}</td></tr>`).join("")}</tbody></table></div></section>`;
  }

  async function renderLeads() {
    const results = await Promise.allSettled([read("overview_stats"), read("inbound_funnel"), read("lead_context_audit"), read("todos"), read("classifications"), read("uncertain_leads"), read("lead_flow")]);
    const stats = settled(results[0]);
    const funnel = settled(results[1]);
    const audit = settled(results[2]);
    const todosPayload = settled(results[3]);
    const leads = rowsFrom(funnel, ["leads", "items", "funnel"]);
    const todos = rowsFrom(todosPayload, ["todos", "items", "files"]);
    const classifications = settled(results[4]);
    const uncertain = settled(results[5]);
    const flow = settled(results[6]);
    const uncertainCount = getPath(audit?.summary, "needs_attention", "uncertain") ?? getPath(uncertain, "total", "count") ?? rowsFrom(uncertain, ["items", "leads"]).length;
    container().innerHTML = `${head("leads", '<button class="parity-action" data-parity-action="refresh">↻ Live</button>')}
      <div class="parity-grid">${metric(count(getPath(stats, "active_leads", "active", "total") || leads.length), "активных лидов")}${metric(count(uncertainCount), "требуют контекста")}${metric(count(todos.length), "TODO")}</div>
      <section class="parity-card" style="margin-top:9px"><h3>Папка Telegram</h3><form class="parity-form" id="moveLeadForm"><label><span>@username / user id</span><input name="q" required></label><label><span>Папка</span><input name="folder" required placeholder="Отмены"></label><button class="parity-primary" type="submit">Переместить</button></form></section>
      <section class="parity-card is-wide" style="margin-top:9px"><h3>Воронка</h3><div class="parity-list">${leads.slice(0, 100).map((item) => { const id = getPath(item, "id", "lead_id", "order_id") || item.__key || ""; return `<div class="parity-row"><div><strong>${esc(getPath(item, "client", "name", "username", "title") || `Лид ${id}`)}</strong><small>${esc(id)}</small></div><p>${esc(short(getPath(item, "summary", "last_message", "stage", "status") || item, 180))}</p><div class="parity-actions"><span class="pill">${esc(getPath(item, "stage", "status_group", "status") || "lead")}</span>${id ? `<button class="parity-action danger" data-parity-action="cancel-lead" data-id="${attr(id)}">Отменить</button>` : ""}</div></div>`; }).join("") || '<div class="empty-state">Лиды не найдены.</div>'}</div></section>
      <section class="parity-card is-wide" style="margin-top:9px"><h3>Задачи</h3><div class="parity-list">${todos.slice(0, 80).map((item) => { const file = getPath(item, "file", "filename") || item.__key || ""; return `<div class="parity-row"><div><strong>${esc(getPath(item, "title", "name", "subject") || file || "TODO")}</strong><small>${esc(file)}</small></div><p>${esc(short(getPath(item, "body", "text", "summary") || item, 180))}</p><div class="parity-actions">${file.startsWith("todo_") ? `<button class="parity-action danger" data-parity-action="delete-todo" data-file="${attr(file)}">В архив</button>` : ""}</div></div>`; }).join("") || '<div class="empty-state">TODO нет.</div>'}</div></section>
      ${rawCard("Классификации", classifications)}${rawCard("Lead-flow / timeline", flow)}`;
  }

  async function renderApprovals() {
    const [payload, waPayload] = await Promise.all([read("approvals", "full=1"), read("wa_cu_queue", "status=pending_approval,queued&limit=100")]);
    const approvals = rowsFrom(payload, ["approvals", "pending", "items"]);
    const waItems = rowsFrom(waPayload, ["items"]);
    container().innerHTML = `${head("approvals", '<button class="parity-action" data-parity-action="refresh">↻ Очередь</button>')}
      <div class="parity-grid">${metric(count(approvals.length), "в очереди", approvals.length ? "warn" : "")}${metric(count(waItems.length), "WhatsApp CU")}${metric(state.authenticated ? "READY" : "LOCKED", "delivery action gate")}</div>
      <section class="parity-card is-wide" style="margin-top:9px"><h3>Money-intent и общие approvals</h3><div class="parity-list">${approvals.map((item) => { const id = getPath(item, "approval_id", "id") || item.__key || ""; const who = getPath(item, "username", "who", "client", "peer") || "Получатель"; const text = getPath(item, "text", "draft", "message", "body") || ""; return `<div class="parity-row"><div><strong>${esc(who)}</strong><small>${esc(id)} · ${esc(item.status || "pending")}</small></div><p>${esc(short(text, 260))}</p><div class="parity-actions"><button class="parity-action danger" data-parity-action="reject-approval" data-id="${attr(id)}">Отклонить</button><button class="parity-primary" data-parity-action="send-approval" data-id="${attr(id)}" data-who="${attr(who)}">Отправить</button></div></div>`; }).join("") || '<div class="empty-state"><strong>Очередь пуста</strong>Нет черновиков, ожидающих решения.</div>'}</div></section>
      <section class="parity-card is-wide" style="margin-top:9px"><h3>WhatsApp Computer Use</h3><p class="parity-note">Approval для follow-up разрешает штатной очереди отправить позже, только в действующих лимитах. Это не provider receipt.</p><div class="parity-list">${waItems.map((item) => { const id = item.id || item.__key || ""; return `<div class="parity-row"><div><strong>${esc(item.name || item.contact || item.phone || "WA contact")}</strong><small>${esc(id)} · ${esc(item.status || "")}</small></div><p>${esc(short(item.text || item.message || item, 240))}</p><div class="parity-actions">${item.status === "pending_approval" ? `<button class="parity-action danger" data-parity-action="wa-cancel" data-id="${attr(id)}">Отклонить</button><button class="parity-primary" data-parity-action="wa-approve" data-id="${attr(id)}">Одобрить в очередь</button>` : `<span class="pill">${esc(item.status || "queued")}</span>`}</div></div>`; }).join("") || '<div class="empty-state">WA CU очередь пуста.</div>'}</div></section>`;
  }

  async function renderEvents() {
    const payload = await read("events", "include_unlinked=1&include_past=1");
    const events = rowsFrom(payload, ["events", "items"]);
    container().innerHTML = `${head("events", '<button class="parity-action" data-parity-action="refresh">↻ Календарь</button>')}
      <div class="parity-grid two">
        <article class="parity-card"><h3>Новое событие</h3><form class="parity-form" id="eventCreateForm"><label class="wide"><span>Название</span><input name="title" required placeholder="LCBand · заказчик · площадка"></label><label><span>Дата</span><input name="date" type="date"></label><label><span>Состав</span><select name="band_size"><option>4</option><option>5</option><option>6</option></select></label><label><span>Lead @username</span><input name="from_lead_username" placeholder="username"></label><label><span>Выезд</span><select name="out_of_moscow"><option value="false">Москва</option><option value="true">Вне Москвы</option></select></label><label class="wide"><span>Заметка</span><textarea name="notes"></textarea></label><button class="parity-primary" type="submit">Создать planning card</button></form></article>
        ${metric(count(events.length), "событий и linked cards", "accent")}
      </div>
      <section class="parity-card is-wide" style="margin-top:9px"><h3>События</h3><div class="parity-list">${events.slice(0, 140).map((item) => { const id = item.id || item.event_id || item.__key || ""; return `<div class="parity-row"><div><strong>${esc(item.title || item.name || "Событие")}</strong><small>${esc(item.date || item.hint_date || "Без даты")} · ${esc(id)}</small></div><p>${esc(short(item.summary || item.notes || item.status || item, 190))}</p><div class="parity-actions"><button class="parity-action" data-parity-action="edit-event" data-id="${attr(id)}" data-title="${attr(item.title || "")}" data-date="${attr(item.date || "")}">Править</button><button class="parity-action" data-parity-action="import-event-lead" data-id="${attr(id)}">Импорт lead</button><button class="parity-action" data-parity-action="attach-contract" data-id="${attr(id)}">Договор URL</button><button class="parity-action brass" data-parity-action="resolve-lineup" data-id="${attr(id)}">Состав</button><button class="parity-action brass" data-parity-action="resolve-venue" data-id="${attr(id)}">Площадка</button><button class="parity-action brass" data-parity-action="enrich-event" data-id="${attr(id)}">Enrich</button><button class="parity-action" data-parity-action="create-event-group" data-id="${attr(id)}">TG-группа</button><button class="parity-primary" data-parity-action="band-chat-draft" data-id="${attr(id)}">Draft в band-чат</button><button class="parity-action danger" data-parity-action="delete-event" data-id="${attr(id)}">Удалить</button></div></div>`; }).join("") || '<div class="empty-state">Событий нет.</div>'}</div></section>`;
  }

  async function renderRuntime() {
    const results = await Promise.allSettled([read("runtime_health"), read("launch_agents"), read("process_activity_24h"), read("wa_baileys_relink_status"), read("awake_guard"), read("cloudflare_tunnel_status"), read("tg_safety"), read("manual_tg_rescan_status"), read("manual_vk_rescan_status")]);
    const health = settled(results[0]);
    const agentsPayload = settled(results[1]);
    const activity = settled(results[2]);
    const wa = settled(results[3]);
    const awake = settled(results[4]);
    const tunnel = settled(results[5]);
    const tgSafety = settled(results[6]);
    const tgRescan = settled(results[7]);
    const vkRescan = settled(results[8]);
    const agents = rowsFrom(agentsPayload, ["agents", "services", "items"]);
    container().innerHTML = `${head("runtime", '<button class="parity-action" data-parity-action="refresh">↻ Live</button>')}
      <div class="parity-grid">${metric(count(agents.length), "launch agents")}${metric(short(getPath(health, "status", "overall", "ok") ?? "—", 20), "runtime health")}${metric(short(getPath(wa, "status", "state", "connected") ?? "—", 20), "WhatsApp")}${metric(short(getPath(tunnel, "status", "state", "healthy") ?? "—", 20), "Cloudflare")}${metric(short(getPath(awake, "enabled", "running") ?? "—", 20), "Awake guard")}${metric(short(getPath(tgSafety, "status", "delivery", "cold") ?? "LIVE", 20), "TG safety")}</div>
      <section class="parity-card is-wide" style="margin-top:9px"><h3>Управление</h3><div class="parity-actions" style="justify-content:flex-start"><button class="parity-action danger" data-parity-action="restart-agents">Перезапустить выбранные</button><button class="parity-action danger" data-parity-action="restart-backend">Restart legacy backend</button><button class="parity-action" data-parity-action="tg-rescan">Telegram rescan</button><button class="parity-action" data-parity-action="vk-rescan">VK rescan</button><button class="parity-action brass" data-parity-action="wa-relink">WA relink</button><button class="parity-action danger" data-parity-action="restart-wa-export">Restart WA export</button><button class="parity-action" data-parity-action="awake-enable">Awake on</button><button class="parity-action" data-parity-action="awake-disable">Awake off</button></div><p class="parity-note">«Перезапустить выбранные» использует отмеченные ниже labels. Без выбора кнопка намеренно не перезапускает весь fleet.</p></section>
      <section class="parity-card is-wide" style="margin-top:9px"><h3>Процессы</h3><div class="parity-table-wrap"><table class="parity-table"><thead><tr><th></th><th>Label</th><th>State</th><th>PID / runs</th><th>Последняя активность</th></tr></thead><tbody>${agents.map((item) => { const label = item.label || item.name || item.id || item.__key || ""; return `<tr><td><input type="checkbox" data-agent-label="${attr(label)}"></td><td><code>${esc(label)}</code></td><td>${esc(getPath(item, "state", "status", "health") || "—")}</td><td>${esc(getPath(item, "pid", "runs", "exit_status") || "—")}</td><td>${esc(short(getPath(item, "last_activity", "updated_at", "detail") || "—", 90))}</td></tr>`; }).join("")}</tbody></table></div></section>
      ${rawCard("Cloudflare status", tunnel)}${rawCard("TG safety", tgSafety)}${rawCard("Telegram rescan", tgRescan)}${rawCard("VK rescan", vkRescan)}${rawCard("Process activity / 24h", activity, activity.__error ? "warn" : "")}`;
  }

  async function renderCost() {
    const results = await Promise.allSettled([read("cost_overview"), read("realtime_burn"), read("ai_usage_breakdown"), read("runtime_config"), read("runtime_config/routing_mode"), read("llm_guard")]);
    const cost = settled(results[0]);
    const burn = settled(results[1]);
    const usage = settled(results[2]);
    const config = settled(results[3]);
    const routing = settled(results[4]);
    const guard = settled(results[5]);
    const configObject = config.config || config;
    const routingModes = rowsFrom(routing, ["modes"]);
    const currentMode = getPath(routing, "current_mode", "mode", "routing_mode", "active") || "—";
    const todaySpend = getPath(cost?.today, "total_cost_usd", "cost_usd") ?? getPath(cost, "total_cost_24h", "cost_24h", "spend_24h");
    container().innerHTML = `${head("cost", '<button class="parity-action" data-parity-action="refresh">↻ Пересчитать</button>')}
      <div class="parity-grid">${metric(usd(todaySpend), "actual provider spend / сегодня")}${metric(short(getPath(burn, "burn_rate", "hourly", "tokens_per_hour") || "live", 20), "текущий burn")}${metric(short(currentMode, 20), "routing mode")}</div>
      <div class="parity-grid two">
        <article class="parity-card"><h3>Глобальный routing mode</h3><div class="parity-actions" style="justify-content:flex-start">${routingModes.map((item) => { const mode = item.id || item.mode || item.value || item; const label = item.label || item.title || mode; return `<button class="${mode === currentMode ? "parity-primary" : "parity-action"}" data-parity-action="routing-mode" data-mode="${attr(mode)}">${esc(label)}</button>`; }).join("")}</div><p class="parity-note">Применение сбрасывает legacy per-purpose overrides и самовосстанавливает минимальные provider budgets.</p></article>
        <article class="parity-card"><h3>Аварийные переключатели</h3><div class="parity-actions" style="justify-content:flex-start"><button class="parity-action brass" data-parity-action="sonnet-on">Opus → Sonnet ON</button><button class="parity-action" data-parity-action="sonnet-off">Sonnet valve OFF</button></div><form class="parity-form" id="forceModelForm" style="margin-top:10px"><label><span>Purpose</span><input name="purpose" required placeholder="presend_review"></label><label><span>Model</span><select name="model"><option value="default">default</option><option value="gpt-5.5">gpt-5.5</option><option value="codex">codex</option><option value="opus">opus</option><option value="sonnet">sonnet</option><option value="haiku">haiku</option><option value="gemini">gemini</option></select></label><button class="parity-primary" type="submit">Применить override</button></form></article>
        <article class="parity-card"><h3>Runtime config · точечное изменение</h3><form class="parity-form" id="runtimeConfigForm"><label><span>Ключ</span><input name="key" required placeholder="provider_routing"></label><label><span>JSON-значение</span><input name="value" required placeholder='"auto"'></label><button class="parity-primary" type="submit">Применить и перезапустить dependents</button></form><p class="parity-note">Отправляется только один указанный ключ через server-side deep merge.</p></article>
        <article class="parity-card"><h3>LLM guard</h3><p>${esc(short(guard.status || guard, 260))}</p><div class="parity-actions" style="justify-content:flex-start"><button class="parity-action" data-parity-action="guard-enable">Включить guard</button><button class="parity-action danger" data-parity-action="guard-disable">Выключить guard</button><button class="parity-action brass" data-parity-action="codex-reset">Сбросить cooldown</button></div></article>
        <article class="parity-card"><h3>Deep usage telemetry</h3><p>Отдельные AI-вызовы, pools, дорогие вызовы, CLI attribution, category routing и spend efficiency загружаются по запросу, чтобы обычный live-экран оставался быстрым.</p><button class="parity-primary" data-parity-action="cost-deep">Загрузить deep usage</button></article>
      </div>
      <div id="costDeepResult"></div>
      ${rawCard("Cost overview / plan windows", cost)}
      ${rawCard("Realtime burn", burn)}
      ${rawCard("Текущая runtime-конфигурация", configObject)}
      ${rawCard("Разбивка AI usage", usage)}`;
  }

  async function renderOutreach() {
    const results = await Promise.allSettled([read("browser_walk_status"), read("browser_walk_progress"), read("monitor_ab"), read("bw_catchup")]);
    const status = settled(results[0]);
    const progress = settled(results[1]);
    const ab = settled(results[2]);
    const catchup = settled(results[3]);
    container().innerHTML = `${head("outreach", '<button class="parity-action" data-parity-action="refresh">↻ Статус</button>')}
      <div class="parity-grid">${metric(short(getPath(status, "status", "state") || "—", 20), "Browser Walk")}${metric(count(getPath(progress, "processed", "done", "current") || 0), "обработано")}${metric(short(getPath(ab, "winner", "status", "latest") || "—", 22), "A/B")}</div>
      <div class="parity-grid two">
        <article class="parity-card"><h3>Новый проход</h3><form class="parity-form" id="walkForm"><label><span>Источник</span><select name="source"><option value="tg">Telegram</option><option value="vk">VK</option></select></label><label><span>Часов назад</span><input name="hours" type="number" min="1" max="168" value="48"></label><button class="parity-primary" type="submit">Запустить</button></form><div class="parity-actions" style="margin-top:8px;justify-content:flex-start"><button class="parity-action brass" data-parity-action="walk-deep">Глубокий проход</button><button class="parity-action danger" data-parity-action="walk-clear">Очистить очередь</button></div></article>
        <article class="parity-card"><h3>A/B тест</h3><p>Ручной запуск идёт в фоне около 10 минут. Он не меняет production routing автоматически без действующих внутренних гардов.</p><button class="parity-primary" data-parity-action="ab-run">Запустить A/B</button></article>
      </div>
      ${rawCard("Текущий прогресс", progress)}${rawCard("Monitor A/B", ab)}${catchup.__error ? "" : rawCard("Catch-up", catchup)}`;
  }

  async function renderTools() {
    const results = await Promise.allSettled([read("outgoing_72h"), read("sign_requests"), read("pitch_library"), read("ai_layer_docs")]);
    const outgoing = settled(results[0]);
    const signsPayload = settled(results[1]);
    const pitches = settled(results[2]);
    const aiDocs = settled(results[3]);
    const signs = rowsFrom(signsPayload, ["requests", "sign_requests", "items"]);
    container().innerHTML = `${head("tools", '<button class="parity-action" data-parity-action="refresh">↻ Обновить</button>')}
      <div class="parity-grid two">
        <article class="parity-card"><h3>Knowledge Base</h3><form class="parity-form" id="kbForm"><label class="wide"><span>Поиск</span><input name="q" required placeholder="договор, площадка, техника…"></label><button class="parity-primary" type="submit">Найти</button></form><div id="kbResult"></div></article>
        <article class="parity-card"><h3>AI layer prompt</h3><form class="parity-form" id="aiPromptForm"><label class="wide"><span>Prompt</span><textarea name="prompt" required></textarea></label><button class="parity-primary" type="submit">Запустить AI-вызов</button></form></article>
        <article class="parity-card"><h3>DB snapshot</h3><p>Скачать read-only снимок через allowlisted endpoint.</p><a class="parity-action" href="/api/legacy-read/db/snapshot" target="_blank" rel="noopener">Открыть snapshot</a></article>
        <article class="parity-card"><h3>Запросы на подпись</h3><div class="parity-list">${signs.slice(0, 30).map((item) => { const token = item.token || item.sign_token || item.__key || ""; return `<div class="parity-row"><div><strong>${esc(item.title || item.name || item.client || "Документ")}</strong><small>${esc(item.status || "pending")}</small></div><p>${esc(short(item.summary || item.document || item, 120))}</p><div class="parity-actions">${token ? `<a class="parity-action" href="http://127.0.0.1:8878/sign.html?t=${attr(token)}" target="_blank" rel="noopener">Открыть форму</a>` : ""}</div></div>`; }).join("") || "Нет запросов."}</div></article>
        <article class="parity-card"><h3>Legacy knowledge pages</h3><div class="parity-actions" style="justify-content:flex-start"><a class="parity-action" href="http://127.0.0.1:8878/architecture.html" target="_blank" rel="noopener">Architecture</a><a class="parity-action" href="http://127.0.0.1:8878/process-map.html" target="_blank" rel="noopener">Process map</a><a class="parity-action" href="http://127.0.0.1:8878/agents-office.html" target="_blank" rel="noopener">Agents office</a><a class="parity-action" href="http://127.0.0.1:8878/access.html" target="_blank" rel="noopener">Access</a><a class="parity-action" href="http://127.0.0.1:8878/casting.html" target="_blank" rel="noopener">Cruise Casting</a></div></article>
      </div>
      ${rawCard("Исходящие за 72 часа", outgoing)}${rawCard("Pitch library", pitches)}${rawCard("AI layer docs", aiDocs)}`;
  }

  async function renderBroadcast() {
    const results = await Promise.allSettled([read("broadcast/audience"), read("broadcast/campaigns")]);
    const audience = settled(results[0]);
    const campaignsPayload = settled(results[1]);
    const campaigns = rowsFrom(campaignsPayload, ["campaigns", "items"]);
    const audienceRows = rowsFrom(audience, ["audience", "recipients", "items"]);
    container().innerHTML = `${head("broadcast", '<button class="parity-action" data-parity-action="refresh">↻ Live</button>')}
      <div class="parity-grid">${metric(count(audienceRows.length || getPath(audience, "eligible", "total") || 0), "доступная аудитория")}${metric(count(campaigns.length), "кампаний")}${metric(count(campaigns.filter((item) => item.status === "running").length), "активных")}</div>
      <section class="parity-card" style="margin-top:9px"><h3>Новая draft-кампания</h3><form class="parity-form" id="broadcastCreateForm"><label><span>Название</span><input name="title" required></label><label><span>Канал</span><select name="channel"><option value="tg">Telegram</option><option value="wa">WhatsApp</option><option value="vk">VK</option></select></label><label><span>Город</span><input name="city"></label><label><span>В день</span><input name="per_day" type="number" min="1" max="100" value="20"></label><label class="wide"><span>Бриф (минимум 20 символов)</span><textarea name="brief" minlength="20" required></textarea></label><button class="parity-primary" type="submit">Создать draft</button></form></section>
      <section class="parity-card" style="margin-top:9px"><h3>Кампании</h3><div class="parity-list">${campaigns.map((item) => { const id = item.id || item.campaign_id || item.__key || ""; const status = item.status || "draft"; return `<div class="parity-row"><div><strong>${esc(item.title || id || "Кампания")}</strong><small>${esc(id)} · ${esc(item.channel || "tg")}</small></div><p>${esc(short(item.brief || item.summary || item.note || item, 170))}</p><div class="parity-actions"><span class="pill ${status === "running" ? "ok" : status === "paused" ? "hold" : ""}">${esc(status)}</span>${status !== "running" ? `<button class="parity-primary" data-parity-action="broadcast-status" data-id="${attr(id)}" data-status="start">Запустить</button>` : `<button class="parity-action brass" data-parity-action="broadcast-status" data-id="${attr(id)}" data-status="pause">Пауза</button>`}<button class="parity-action" data-parity-action="broadcast-status" data-id="${attr(id)}" data-status="done">Завершить</button></div></div>`; }).join("") || '<div class="empty-state">Кампаний пока нет.</div>'}</div></section>`;
  }

  const RENDERERS = { overview: renderOverview, broker: renderBroker, pricing: renderPricing, contacts: renderContacts, leads: renderLeads, approvals: renderApprovals, events: renderEvents, runtime: renderRuntime, cost: renderCost, outreach: renderOutreach, tools: renderTools, broadcast: renderBroadcast };

  async function render(force = false) {
    if (state.loading) {
      state.pendingForce = state.pendingForce || force;
      return;
    }
    state.loading = true;
    const requestedArea = state.activeArea;
    state.renderingArea = requestedArea;
    loading();
    try {
      await loadCapabilities(force);
      await RENDERERS[requestedArea]();
    } catch (error) {
      const target = container();
      if (target) target.innerHTML = `${head(requestedArea)}${panelError(error)}`;
    } finally {
      state.loading = false;
      state.renderingArea = "";
      const rerender = state.activeArea !== requestedArea || state.pendingForce;
      const pendingForce = state.pendingForce;
      state.pendingForce = false;
      if (rerender) await render(pendingForce);
    }
  }
  async function activate(area = "overview") {
    if (!RENDERERS[area]) area = "overview";
    state.activeArea = area;
    if (area !== "broadcast") {
      document.querySelectorAll("[data-parity-area]").forEach((button) => button.classList.toggle("is-active", button.dataset.parityArea === area));
    }
    await refreshSession();
    return render(false);
  }
  async function refresh() {
    state.cache.clear();
    return render(true);
  }

  function renderSessionState() {
    const pill = byId("operatorSessionPill");
    if (pill) {
      pill.textContent = state.authenticated ? "Действия разблокированы" : "Только чтение";
      pill.className = `pill ${state.authenticated ? "ok" : ""}`;
    }
    for (const id of ["operatorLoginButton", "broadcastLoginButton"]) {
      const button = byId(id);
      if (button) button.textContent = state.authenticated ? "Завершить operator-сессию" : "Разблокировать действия";
    }
  }
  function openLogin() {
    byId("operatorLoginError").textContent = "";
    byId("operatorToken").value = "";
    byId("operatorDialog").showModal();
    window.setTimeout(() => byId("operatorToken").focus(), 50);
  }
  async function toggleLogin() {
    if (!state.authenticated) { openLogin(); return; }
    await request("/api/core/operator-session", { method: "DELETE" });
    state.authenticated = false;
    renderSessionState();
    notify("Operator-сессия завершена.");
  }
  async function login(event) {
    event.preventDefault();
    const token = byId("operatorToken").value;
    const error = byId("operatorLoginError");
    error.textContent = "Проверка…";
    try {
      await request("/api/core/operator-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      state.authenticated = true;
      byId("operatorToken").value = "";
      byId("operatorDialog").close();
      renderSessionState();
      notify("Действия разблокированы на 30 минут.");
      await render(false);
    } catch (loginError) {
      error.textContent = loginError.status === 401 ? "Неверный operator token." : loginError.message;
    }
  }

  async function confirmed(label, detail, operation) {
    if (!window.confirm(`${label}\n\n${detail}\n\nДействие будет записано production-контуром.`)) return;
    try {
      const result = await operation();
      notify(`${label}: выполнено.`);
      await render(true);
      return result;
    } catch (error) {
      notify(`${label}: ${error.message}`);
    }
  }

  async function handleAction(button) {
    const action = button.dataset.parityAction;
    if (action === "refresh") return refresh();
    if (action === "cancel-lead") return confirmed("Отменить лид", `ID ${button.dataset.id}. Отмена архивирует лид с причиной оператора.`, () => mutate("lead/cancel", "leads.cancel", { id: button.dataset.id, reason: "manual cancel from Core v2" }));
    if (action === "delete-todo") return confirmed("Убрать TODO", `${button.dataset.file} будет перемещён в recoverable /tmp backup.`, () => mutate("todos/delete", "todos.delete", { file: button.dataset.file }));
    if (action === "send-approval") return confirmed("Отправить согласованный ответ", `Получатель: ${button.dataset.who}. Это фактическая отправка с provider receipt.`, () => mutate("approval/send", "approval.send", { approval_id: button.dataset.id }));
    if (action === "reject-approval") return confirmed("Отклонить черновик", `Approval ${button.dataset.id} не будет отправлен.`, () => mutate("approval/reject", "approval.reject", { approval_id: button.dataset.id, reason: "rejected in Core v2" }));
    if (action === "wa-approve") return confirmed("Одобрить WA follow-up", `${button.dataset.id}: действие переводит запись в штатную очередь. Фактическая отправка произойдёт позже только при прохождении 3/day, 72h/contact и 9–22 MSK.`, () => mutate("wa_cu_queue/approve", "approvals.wa_approve", { id: button.dataset.id, approved_by: "core_v2", note: "operator approved in Core v2" }));
    if (action === "wa-cancel") return confirmed("Отклонить WA draft", `${button.dataset.id}: черновик не будет отправлен.`, () => mutate("wa_cu_queue/cancel", "approvals.wa_cancel", { id: button.dataset.id, cancelled_by: "core_v2", reason: "operator rejected in Core v2" }));
    if (action === "delete-event") return confirmed("Удалить planning card", button.dataset.id, () => mutate(`events/${encodeURIComponent(button.dataset.id)}`, "events.delete", {}, "DELETE"));
    if (action === "enrich-event") return confirmed("Дополнить событие", `${button.dataset.id}: production enrichment обновит карточку.`, () => mutate(`events/${encodeURIComponent(button.dataset.id)}/auto_enrich`, "events.auto_enrich", {}));
    if (action === "import-event-lead") {
      const username = window.prompt("Lead @username", "");
      if (!username) return;
      return confirmed("Импортировать lead", `${username} → ${button.dataset.id}.`, () => mutate(`events/${encodeURIComponent(button.dataset.id)}/import_lead`, "events.import_lead", { username }));
    }
    if (action === "attach-contract") {
      const url = window.prompt("URL договора (Google Docs / Drive / подписанный файл)", "");
      if (!url) return;
      return confirmed("Прикрепить договор", `${button.dataset.id}: ${url}`, () => mutate(`events/${encodeURIComponent(button.dataset.id)}/attach_contract`, "events.attach_contract", { url }));
    }
    if (action === "resolve-lineup") return confirmed("Пересобрать состав", `${button.dataset.id}: SSoT состав заменит stale-строки; ручные деньги и костюмы сохранятся для совпавших участников.`, () => mutate(`events/${encodeURIComponent(button.dataset.id)}/resolve_lineup`, "events.resolve_lineup", { drop_stale: true }));
    if (action === "resolve-venue") {
      const country = window.prompt("Country hint (RU, AE, …), можно оставить пустым", "RU");
      if (country === null) return;
      return confirmed("Разрешить площадку", `${button.dataset.id}: geocoder обновит адрес и координаты.`, () => mutate(`events/${encodeURIComponent(button.dataset.id)}/resolve_venue`, "events.resolve_venue", { country }));
    }
    if (action === "band-chat-draft") {
      const text = window.prompt("Текст draft для band-чата", "");
      if (!text) return;
      return confirmed("Создать approval для band-чата", `${button.dataset.id}: сейчас создаётся только draft в @lcband_notify_bot. Отправки без отдельного ✅ не будет.`, () => mutate(`events/${encodeURIComponent(button.dataset.id)}/post_to_band_chat`, "events.post_to_band_chat", { text, source: "manual_core_v2" }));
    }
    if (action === "create-event-group") return confirmed("Создать Telegram-группу", `${button.dataset.id}: это создаёт внешний объект и приглашает по правилам event backend.`, () => mutate(`events/${encodeURIComponent(button.dataset.id)}/create_tg_group`, "events.create_tg_group", {}));
    if (action === "edit-event") {
      const title = window.prompt("Название события", button.dataset.title || "");
      if (title === null) return;
      const date = window.prompt("Дата YYYY-MM-DD", button.dataset.date || "");
      if (date === null) return;
      return confirmed("Изменить событие", `${button.dataset.id}: ${title}, ${date || "без даты"}.`, () => mutate(`events/${encodeURIComponent(button.dataset.id)}`, "events.update", { title, date }, "PUT"));
    }
    if (action === "restart-agents") {
      const labels = [...document.querySelectorAll("[data-agent-label]:checked")].map((item) => item.dataset.agentLabel);
      if (!labels.length) return notify("Сначала отметьте конкретные процессы.");
      return confirmed("Перезапустить процессы", labels.join("\n"), () => mutate("restart_agents", "runtime.restart_agents", { labels }));
    }
    if (action === "restart-backend") return confirmed("Перезапустить legacy backend", "Коротко прервёт ответы legacy API на 8878; Core read-model останется доступен.", () => mutate("restart_dashboard_backend", "runtime.restart_backend", {}));
    if (action === "tg-rescan") return confirmed("Telegram rescan", "Будет запущено фоновое перечитывание Telegram.", () => mutate("manual_tg_rescan", "runtime.tg_rescan", {}));
    if (action === "vk-rescan") return confirmed("VK rescan", "Будет запущено фоновое перечитывание VK.", () => mutate("manual_vk_rescan", "runtime.vk_rescan", {}));
    if (action === "wa-relink") return confirmed("WhatsApp relink", "Текущая Baileys-сессия может запросить повторную привязку.", () => mutate("wa_baileys_relink", "runtime.wa_relink", {}));
    if (action === "restart-wa-export") return confirmed("Restart WA export", "Перезапуск экспортёра WhatsApp.", () => mutate("restart_wa_export", "runtime.restart_wa_export", {}));
    if (action === "awake-enable" || action === "awake-disable") return confirmed("Изменить Awake Guard", action === "awake-enable" ? "Не давать Mac уснуть во время операционных процессов." : "Отключить текущий caffeinate guard.", () => mutate("awake_guard", "runtime.awake_update", { action: action === "awake-enable" ? "enable" : "disable" }));
    if (action === "routing-mode") return confirmed("Изменить routing mode", `${button.dataset.mode}: глобальный AI routing, legacy purpose overrides будут очищены.`, () => mutate("runtime_config/routing_mode", "cost.routing_mode_update", { mode: button.dataset.mode }));
    if (action === "sonnet-on" || action === "sonnet-off") return confirmed("Аварийный Sonnet valve", action === "sonnet-on" ? "Глобально направить все Opus-вызовы в Sonnet." : "Вернуть обычный Opus/Sonnet routing.", () => mutate("runtime_config/sonnet_emergency", "cost.sonnet_emergency", { enabled: action === "sonnet-on" }));
    if (action === "guard-enable" || action === "guard-disable") return confirmed("Изменить LLM guard", action === "guard-enable" ? "Включить лимиты вызовов." : "Выключить лимиты вызовов — повышенный риск расхода.", () => mutate("llm_guard", "cost.llm_guard_update", { enabled: action === "guard-enable", updated_by: "core_v2" }));
    if (action === "codex-reset") return confirmed("Сбросить Codex cooldown", "Ручной сброс текущего cooldown-окна.", () => mutate("codex_cooldown_reset", "cost.codex_cooldown_reset", {}));
    if (action === "cost-deep") {
      button.disabled = true;
      button.textContent = "Загрузка…";
      const paths = ["recent_ai_calls", "ai_call_pools", "expensive_ai_calls", "claude_plan_usage", "codex_plan_usage", "process_cli_usage", "category_routing_stats", "spend_efficiency"];
      const values = await Promise.allSettled(paths.map((path) => read(path)));
      const target = byId("costDeepResult");
      if (target) target.innerHTML = values.map((result, index) => rawCard(paths[index], settled(result))).join("");
      button.disabled = false;
      button.textContent = "Обновить deep usage";
      return;
    }
    if (action === "walk-deep") return confirmed("Глубокий Browser Walk", "Проверка за неделю может занять несколько минут и вызвать AI-классификацию.", () => mutate("browser_walk_deep", "outreach.walk_deep", {}));
    if (action === "walk-clear") return confirmed("Очистить очередь Browser Walk", "Pending-запросы будут удалены.", () => mutate("browser_walk_request", "outreach.walk_clear", {}, "DELETE"));
    if (action === "ab-run") return confirmed("Запустить A/B тест", "Фоновый прогон около 10 минут.", () => mutate("ab_tests/run", "outreach.ab_run", {}));
    if (action === "broadcast-status") {
      const verb = button.dataset.status === "start" ? "Запустить рассылку" : button.dataset.status === "pause" ? "Поставить на паузу" : "Завершить кампанию";
      return confirmed(verb, `Campaign ${button.dataset.id}; status=${button.dataset.status}.`, () => mutate(`broadcast/campaigns/${encodeURIComponent(button.dataset.id)}/status`, "broadcast.status", { status: button.dataset.status, note: "operator action from Core v2" }));
    }
  }

  async function handleForm(form) {
    const data = Object.fromEntries(new FormData(form).entries());
    if (form.id === "eventCreateForm") return confirmed("Создать событие", `${data.title} · ${data.date || "без даты"}`, () => mutate("events", "events.create", { ...data, band_size: Number(data.band_size), out_of_moscow: data.out_of_moscow === "true", use_template: true }));
    if (form.id === "moveLeadForm") return confirmed("Переместить лид", `${data.q} → ${data.folder}.`, () => mutate("move_to_folder", "leads.move_to_folder", data));
    if (form.id === "forceModelForm") return confirmed("Изменить force model", `${data.purpose} → ${data.model}.`, () => mutate("runtime_config/force_model", "cost.force_model", data));
    if (form.id === "runtimeConfigForm") {
      let value;
      try { value = JSON.parse(data.value); } catch (_) { return notify("JSON-значение не разобрано."); }
      return confirmed("Изменить runtime config", `${data.key} = ${data.value}`, () => mutate("runtime_config", "cost.runtime_config_update", { updates: { [data.key]: value }, updated_by: "core_v2" }));
    }
    if (form.id === "walkForm") return confirmed("Запустить Browser Walk", `${data.source}, ${data.hours} часов.`, () => mutate("browser_walk_request", "outreach.walk_run", { source: data.source, hours: Number(data.hours) }));
    if (form.id === "broadcastCreateForm") return confirmed("Создать draft-кампанию", `${data.title} · ${data.channel} · ${data.per_day}/день. Отправка ещё не начнётся.`, () => mutate("broadcast/campaigns", "broadcast.create", { ...data, per_day: Number(data.per_day) }));
    if (form.id === "kbForm") {
      const result = await read("kb/lookup", new URLSearchParams({ q: data.q }).toString());
      byId("kbResult").innerHTML = `<pre class="parity-json" style="margin-top:9px">${esc(JSON.stringify(result, null, 2))}</pre>`;
      return;
    }
    if (form.id === "aiPromptForm") return confirmed("Запустить AI prompt", "Это AI-вызов с учётом действующих бюджетных гардов; клиенту ничего не отправляется.", () => mutate("ai_layer_prompt", "tools.ai_prompt", { prompt: data.prompt }));
  }

  function bind() {
    if (state.initialized) return;
    state.initialized = true;
    document.addEventListener("click", (event) => {
      const area = event.target.closest("[data-parity-area]");
      if (area) activate(area.dataset.parityArea);
      const jump = event.target.closest("[data-parity-area-jump]");
      if (jump) activate(jump.dataset.parityAreaJump);
      const action = event.target.closest("[data-parity-action]");
      if (action) handleAction(action);
    });
    document.addEventListener("submit", (event) => {
      if (!event.target.closest(".parity-content") && event.target.id !== "operatorLoginForm") return;
      event.preventDefault();
      if (event.target.id === "operatorLoginForm") login(event);
      else handleForm(event.target).catch((error) => notify(error.message));
    });
    byId("operatorLoginButton")?.addEventListener("click", toggleLogin);
    byId("broadcastLoginButton")?.addEventListener("click", toggleLogin);
    byId("operatorLoginCancel")?.addEventListener("click", () => byId("operatorDialog").close());
    refreshSession();
  }

  bind();
  window.CoreParity = Object.freeze({ activate, refresh, refreshSession });
})();

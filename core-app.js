"use strict";

const API = Object.freeze({
  health: "/api/core/health",
  summary: "/api/core/summary",
  calendar: "/api/core/calendar",
  threads: "/api/core/threads",
  messages: "/api/core/messages",
  coordinationCases: "/api/core/coordination-cases",
  send: "/api/core/send",
  work: "/api/core/work",
  operations: "/api/core/operations",
});

const state = {
  health: null,
  summary: null,
  calendar: { events: [], business_events: 0, technical_events: 0, model_ready: false },
  threads: [],
  coordinationCases: [],
  work: null,
  operations: null,
  activeView: "calendar",
  activeWorkTab: "obligations",
  selectedThreadId: "",
  selectedEventId: "",
  chatFolder: "all",
  chatStatus: "",
  query: "",
  calendarFilters: {
    lcb: true,
    broker: true,
    jobs: true,
    requests: true,
    technical: false,
    performed: true,
    content_pending: true,
    content_received: true,
    prepayment: true,
    contract: true,
    confirmed: true,
    negotiating: true,
    followup_waiting: true,
    followup_cold: true,
    lead: true,
    cancelled: true,
  },
  month: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  loading: false,
  calendarLoading: false,
  calendarRefreshedAt: 0,
  sending: false,
  selectedDraftId: "",
  threadReady: false,
  threadRequestController: null,
};

const CALENDAR_STAGE_LABELS = Object.freeze({
  performed: "Состоялось",
  content_pending: "Фото/видео запросить",
  content_received: "Фото/видео получены",
  prepayment: "Предоплата получена",
  contract: "Договор",
  confirmed: "Подтверждено",
  negotiating: "Переговоры",
  followup_waiting: "Ждём ответа",
  followup_cold: "Нет ответа",
  lead: "Новая заявка",
  cancelled: "Отмена",
});

const byId = (id) => document.getElementById(id);
const escapeHtml = (value) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#039;");

function formatNumber(value) {
  return new Intl.NumberFormat("ru-RU").format(Number(value || 0));
}

function formatDate(epoch, options = {}) {
  if (!epoch) return "—";
  return new Intl.DateTimeFormat("ru-RU", options.dateOnly
    ? { day: "numeric", month: "long", year: "numeric" }
    : { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }
  ).format(new Date(Number(epoch) * 1000));
}

function formatEventDate(value) {
  if (!value) return "Дата не указана";
  const [year, month, day] = String(value).split("-").map(Number);
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric" })
    .format(new Date(year, month - 1, day));
}

function formatMonth(date) {
  return new Intl.DateTimeFormat("ru-RU", { month: "long", year: "numeric" }).format(date);
}

function formatAge(seconds) {
  if (seconds === null || seconds === undefined) return "сообщений нет";
  const value = Math.max(0, Number(seconds));
  if (value < 60) return "только что";
  if (value < 3600) return `${Math.floor(value / 60)} мин назад`;
  if (value < 86400) return `${Math.floor(value / 3600)} ч назад`;
  return `${Math.floor(value / 86400)} дн назад`;
}

function formatMoney(minor, currency = "RUB") {
  if (minor === null || minor === undefined) return "—";
  try {
    return new Intl.NumberFormat("ru-RU", {
      style: "currency",
      currency: currency || "RUB",
      maximumFractionDigits: Number(minor) % 100 === 0 ? 0 : 2,
    }).format(Number(minor) / 100);
  } catch (_) {
    return `${formatNumber(Number(minor) / 100)} ${currency || ""}`.trim();
  }
}

function shortId(value, size = 38) {
  const text = String(value || "");
  return text.length > size ? `${text.slice(0, size - 1)}…` : text;
}

function channelLabel(value) {
  return ({ tg: "Telegram", wa: "WhatsApp", provider_canary: "Canary" })[value]
    || String(value || "Core");
}

function roleLabel(thread) {
  const labels = {
    client_organizer: "Организатор",
    client_private: "Частный клиент",
    client_agency: "Агентство",
    payer: "Плательщик",
    venue_rep: "Площадка",
    tech_contact: "Технический контакт",
    lcb_team_member: "Музыкант LCB",
    vendor_performer: "Подрядчик-музыкант",
    vendor_tech: "Технический подрядчик",
    vendor_media: "Фото / видео",
    vendor_other: "Подрядчик",
  };
  if (thread.is_technical) return "Техническая канарейка";
  return labels[thread.relationship_role] || "Роль не определена";
}

function threadTitle(thread) {
  return thread.display_name || thread.peer_external_id || thread.thread_id || "Core thread";
}

function eventTitle(event) {
  return event.display_name || event.title || event.peer_external_id || event.service_format || "Событие Core";
}

function initials(value) {
  const parts = String(value || "Core").replace(/[._:@-]+/g, " ").trim().split(/\s+/);
  return parts.slice(0, 2).map((part) => part[0] || "").join("").toUpperCase() || "C";
}

async function apiGet(url, options = {}) {
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    cache: "no-store",
    signal: options.signal,
  });
  const payload = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
  if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
  return payload;
}

async function apiPost(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
  if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
  return payload;
}

function avatarContent(thread, name) {
  return thread.avatar_url
    ? `<img src="${escapeHtml(thread.avatar_url)}" alt="" loading="lazy">`
    : escapeHtml(initials(name));
}

function toast(message) {
  const element = byId("toast");
  element.textContent = message;
  element.hidden = false;
  window.clearTimeout(toast.timer);
  toast.timer = window.setTimeout(() => { element.hidden = true; }, 4500);
}

function setConnection(kind, label) {
  byId("connectionDot").className = `status-dot ${kind === "ok" ? "is-ok" : kind === "error" ? "is-error" : ""}`;
  byId("connectionLabel").textContent = label;
}

function setBadge(id, value) {
  const badge = byId(id);
  const count = Number(value || 0);
  badge.textContent = count > 99 ? "99+" : String(count);
  badge.hidden = count === 0;
}

function setView(view) {
  state.activeView = view;
  document.querySelectorAll(".tab-button").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.view === view);
  });
  document.querySelectorAll(".screen").forEach((screen) => {
    screen.classList.toggle("is-active", screen.id === `screen-${view}`);
  });
  byId("globalSearchWrap").hidden = !["calendar", "chats"].includes(view);
  if (view === "calendar") {
    renderCalendar();
    refreshCalendar();
  }
  if (view === "chats") renderThreads();
  if (view === "today") renderToday();
  if (view === "system") renderSystem();
  if (view === "broadcast") renderBroadcast();
}

function route() {
  const raw = (location.hash || "#calendar").slice(1);
  const slash = raw.indexOf("/");
  const name = slash === -1 ? raw : raw.slice(0, slash);
  const argument = slash === -1 ? "" : decodeURIComponent(raw.slice(slash + 1));
  if (name === "event") {
    setView("calendar");
    if (argument) openEvent(argument, false);
    return;
  }
  if (name === "chat") {
    setView("chats");
    if (argument) openThread(argument, false);
    return;
  }
  const view = ["calendar", "chats", "today", "system", "broadcast"].includes(name)
    ? name : "calendar";
  if (view === "calendar") {
    state.selectedEventId = "";
    byId("eventDetail").hidden = true;
    byId("calendarHome").hidden = false;
  }
  if (view === "chats" && window.innerWidth <= 820) {
    state.selectedThreadId = "";
    byId("conversation").classList.remove("is-open");
  }
  setView(view);
}

function isoDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function calendarEvents() {
  const query = state.query.toLowerCase();
  return (state.calendar.events || []).filter((event) => {
    const filters = state.calendarFilters;
    if (event.is_technical && !filters.technical) return false;
    if (event.business_line === "lcb" && !filters.lcb) return false;
    if (event.business_line === "broker" && !filters.broker) return false;
    if (event.record_type === "job" && !filters.jobs) return false;
    if (event.record_type === "request" && !filters.requests) return false;
    const funnelStage = eventFunnelStage(event);
    if (funnelStage && filters[funnelStage] === false) return false;
    if (!query) return true;
    return [eventTitle(event), event.venue_ref, event.event_date, event.service_format, event.username]
      .some((value) => String(value || "").toLowerCase().includes(query));
  });
}

function eventFunnelStage(event) {
  if (event.funnel_stage && CALENDAR_STAGE_LABELS[event.funnel_stage]) return event.funnel_stage;
  if (event.cancelled || event.lifecycle === "cancelled" || event.occurrence_status === "cancelled") return "cancelled";
  if (event.lifecycle === "performed" || event.occurrence_status === "performed") return "performed";
  if (event.lifecycle === "prepayment") return "prepayment";
  if (event.lifecycle === "contract") return "contract";
  if (event.lifecycle === "confirmed") return "confirmed";
  if (event.lifecycle === "negotiation") return "negotiating";
  return "lead";
}

function funnelStageLabel(event) {
  return CALENDAR_STAGE_LABELS[eventFunnelStage(event)] || "Этап не определён";
}

function syncCalendarFilterControls() {
  const mapping = {
    filterLcb: "lcb",
    filterBroker: "broker",
    filterJobs: "jobs",
    filterRequests: "requests",
    filterCancelled: "cancelled",
    filterTechnical: "technical",
    filterStagePerformed: "performed",
    filterStageContentPending: "content_pending",
    filterStageContentReceived: "content_received",
    filterStagePrepayment: "prepayment",
    filterStageContract: "contract",
    filterStageConfirmed: "confirmed",
    filterStageNegotiating: "negotiating",
    filterStageFollowupWaiting: "followup_waiting",
    filterStageFollowupCold: "followup_cold",
    filterStageLead: "lead",
  };
  Object.entries(mapping).forEach(([id, key]) => {
    byId(id).checked = Boolean(state.calendarFilters[key]);
  });
}

function renderCalendar() {
  syncCalendarFilterControls();
  byId("calendarMonth").textContent = formatMonth(state.month);
  const payload = state.calendar || {};
  const summary = [];
  if (!payload.model_ready) summary.push('<span class="pill danger">Модель календаря не готова</span>');
  summary.push(`<span>LCBand ${formatNumber((payload.by_business_line || {}).lcb)} · Broker ${formatNumber((payload.by_business_line || {}).broker)}</span>`);
  if (Number(payload.technical_events || 0)) {
    summary.push(`<span>· ${formatNumber(payload.technical_events)} технических</span>`);
  }
  if (payload.mirror_snapshot) {
    const ageSeconds = Math.max(0, Math.floor(Date.now() / 1000) - Number(payload.mirror_snapshot.activated_at_epoch || 0));
    summary.push(`<span class="pill ${ageSeconds > 900 ? "danger" : "ok"}">зеркало ${escapeHtml(formatAge(ageSeconds))}</span>`);
  } else {
    summary.push('<span class="pill hold">зеркало ещё не загружено</span>');
  }
  if (!payload.business_events) {
    summary.push('<span class="pill hold">Бизнес-календарь ещё не мигрирован</span>');
  }
  byId("calendarSummary").innerHTML = summary.join("");

  const first = new Date(state.month.getFullYear(), state.month.getMonth(), 1);
  const offset = (first.getDay() + 6) % 7;
  const gridStart = new Date(first.getFullYear(), first.getMonth(), 1 - offset);
  const visibleEvents = calendarEvents();
  summary.push(`<span>· показано ${formatNumber(visibleEvents.length)}</span>`);
  byId("calendarSummary").innerHTML = summary.join("");
  const eventsByDate = new Map();
  visibleEvents.forEach((event) => {
    if (!event.event_date) return;
    if (!eventsByDate.has(event.event_date)) eventsByDate.set(event.event_date, []);
    eventsByDate.get(event.event_date).push(event);
  });
  const weekdays = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
  let html = `<div class="calendar-week">${weekdays.map((day) => `<div class="calendar-weekday">${day}</div>`).join("")}</div><div class="calendar-week">`;
  const today = isoDate(new Date());
  for (let index = 0; index < 42; index += 1) {
    const date = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + index);
    const key = isoDate(date);
    const outside = date.getMonth() !== state.month.getMonth();
    const events = eventsByDate.get(key) || [];
    html += `<div class="calendar-day ${outside ? "outside" : ""}">
      <span class="calendar-day-number ${key === today ? "today" : ""}">${date.getDate()}</span>
      ${events.slice(0, 3).map((event) => `<button class="event-chip funnel-${escapeHtml(eventFunnelStage(event))} ${event.is_technical ? "technical" : ""} ${escapeHtml(event.business_line || "")} ${escapeHtml(event.record_type || "")}" data-event-id="${escapeHtml(event.calendar_id || event.occurrence_id)}" title="${escapeHtml(`${eventTitle(event)} · ${funnelStageLabel(event)}`)}">${escapeHtml(eventTitle(event))}</button>`).join("")}
      ${events.length > 3 ? `<span class="thread-label">+${events.length - 3}</span>` : ""}
    </div>`;
  }
  html += "</div>";
  byId("calendarGrid").innerHTML = html;
  byId("calendarGrid").querySelectorAll("[data-event-id]").forEach((button) => {
    button.addEventListener("click", () => openEvent(button.dataset.eventId));
  });
  const undated = visibleEvents.filter((event) => !event.event_date);
  byId("undatedCount").textContent = formatNumber(undated.length);
  byId("undatedList").innerHTML = undated.length
    ? undated.map((event) => `<button class="undated-item" data-event-id="${escapeHtml(event.calendar_id || event.occurrence_id)}"><strong>${escapeHtml(eventTitle(event))}</strong><span>${event.business_line === "broker" ? "Broker" : "LCBand"} · ${event.record_type === "job" ? "событие" : "заявка"} · ${escapeHtml(funnelStageLabel(event))}</span></button>`).join("")
    : '<div class="calendar-empty-note">По выбранным фильтрам записей без даты нет</div>';
  byId("undatedList").querySelectorAll("[data-event-id]").forEach((button) => {
    button.addEventListener("click", () => openEvent(button.dataset.eventId));
  });
}

function checkState(done, waiting = false) {
  return done ? "done" : waiting ? "wait" : "gap";
}

function renderEventDetail(event) {
  if (event.source_kind === "legacy_mirror") {
    byId("eventKind").textContent = `${event.business_line === "broker" ? "Broker" : "LCB"} · ${event.record_type === "job" ? "событие" : "заявка"} · зеркало`;
    byId("eventTitle").textContent = eventTitle(event);
    byId("eventMeta").textContent = `${formatEventDate(event.event_date)} · ${event.venue_ref || "площадка не указана"}`;
    byId("eventStatus").textContent = event.status || event.lifecycle || "unknown";
    byId("eventStatus").className = `pill ${event.cancelled ? "danger" : event.event_date ? "ok" : "hold"}`;
    byId("eventTags").innerHTML = [funnelStageLabel(event), event.service_format, event.username ? `@${event.username}` : null, "read-only import"]
      .filter(Boolean).map((tag) => `<span class="pill">${escapeHtml(tag)}</span>`).join("");
    byId("eventChecklistScore").textContent = "legacy";
    byId("eventChecklist").innerHTML = `<div class="check-row wait"><span class="check-dot">…</span><div><strong>Детали ещё в текущем пайплайне</strong><small>В Core импортирован календарный факт. Договор, оплата, состав, райдер и репертуар не считаются перенесёнными без отдельных доказательств.</small></div></div>`;
    byId("eventFinance").innerHTML = [["Источник", event.source_system], ["ID записи", shortId(event.source_record_id, 30)], ["Дата в источнике", event.date_raw || "не указана"], ["Режим", "только чтение"]]
      .map(([label, value]) => `<div class="finance-cell"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join("");
    byId("eventLineup").innerHTML = '<div class="calendar-empty-note">Состав не импортируется календарным зеркалом</div>';
    byId("eventDocuments").innerHTML = '<div class="calendar-empty-note">Договор и программа не импортируются календарным зеркалом</div>';
    return;
  }
  byId("eventKind").textContent = event.is_technical ? "Техническая канарейка Core" : "Событие Core";
  byId("eventTitle").textContent = eventTitle(event);
  const time = event.performance_start_at_epoch ? formatDate(event.performance_start_at_epoch) : "время не указано";
  byId("eventMeta").textContent = `${formatEventDate(event.event_date)} · ${time} · ${event.venue_ref || "площадка не указана"}`;
  byId("eventStatus").textContent = event.occurrence_status || event.booking_status || "unknown";
  byId("eventStatus").className = `pill ${event.occurrence_status === "cancelled" ? "danger" : event.date_firm ? "ok" : "hold"}`;
  const tags = [
    funnelStageLabel(event),
    event.service_format,
    event.date_firm ? "дата подтверждена" : "дата мягкая",
    event.channel ? channelLabel(event.channel) : null,
    event.is_technical ? "не бизнес-событие" : null,
  ].filter(Boolean);
  byId("eventTags").innerHTML = tags.map((tag) => `<span class="pill ${event.is_technical ? "technical" : ""}">${escapeHtml(tag)}</span>`).join("");

  const totalMinor = event.finance_total_minor ?? event.amount_minor;
  const prepaymentMinor = event.finance_prepayment_minor ?? event.prepayment_minor;
  const receivedMinor = Number(event.finance_received_minor || 0);
  const balanceMinor = event.finance_balance_minor ?? (totalMinor === null || totalMinor === undefined ? null : Number(totalMinor) - receivedMinor);
  const checklist = [
    ["Договор", Number(event.agreement_count || 0) > 0, false, event.agreement_count ? `${event.agreement_count} версия/корень договора в Core` : "Договор ещё не создан в Core"],
    ["Предоплата", receivedMinor > 0, prepaymentMinor !== null && prepaymentMinor !== undefined, receivedMinor > 0 ? `Принято доказательств оплаты: ${formatMoney(receivedMinor, event.currency)}` : prepaymentMinor !== null && prepaymentMinor !== undefined ? `План предоплаты: ${formatMoney(prepaymentMinor, event.currency)}` : "План оплаты не зафиксирован"],
    ["Адрес и тайминг", Boolean(event.date_firm && event.venue_ref && event.performance_start_at_epoch), Boolean(event.event_date), event.venue_ref ? `${event.venue_ref}; ${time}` : "Нет точной площадки и времени"],
    ["Пропуск / паспорт / авто", Number(event.checklist_requirement_count || 0) > 0 && Number(event.checklist_unresolved_count || 0) === 0, Number(event.checklist_requirement_count || 0) > 0, event.checklist_requirement_count ? `Readiness-checklist: ${event.checklist_unresolved_count ?? "—"} незакрытых` : "Readiness-checklist ещё не открыт"],
    ["Состав", Number(event.lineup_count || 0) > 0, false, event.lineup_count ? `${event.lineup_count} участников в sealed lineup` : "Состав не перенесён в Core"],
    ["Звук / райдер", Number(event.rider_version_count || 0) > 0 && Boolean(event.tech_status), Number(event.rider_version_count || 0) > 0, event.rider_version_count ? `Райдер v${event.rider_version_count}; техника: ${event.tech_status || "ждёт координации"}` : "Райдер не зафиксирован"],
    ["Репертуар", Boolean(event.repertoire_status && event.repertoire_status !== "needs_facts"), event.repertoire_status === "needs_facts", event.repertoire_status ? `Статус: ${event.repertoire_status}` : "Требования к репертуару не записаны"],
  ];
  const doneCount = checklist.filter((item) => item[1]).length;
  byId("eventChecklistScore").textContent = `${doneCount}/${checklist.length}`;
  byId("eventChecklist").innerHTML = checklist.map(([title, done, waiting, detail]) => {
    const status = checkState(done, waiting);
    return `<div class="check-row ${status}"><span class="check-dot">${done ? "✓" : waiting ? "…" : "!"}</span><div><strong>${escapeHtml(title)}</strong><small>${escapeHtml(detail)}</small></div></div>`;
  }).join("");

  const finances = [
    ["Клиент всего", formatMoney(totalMinor, event.currency)],
    ["Получено", formatMoney(receivedMinor, event.currency)],
    ["Остаток", formatMoney(balanceMinor, event.currency)],
    ["Составу", "—"],
  ];
  byId("eventFinance").innerHTML = finances.map(([label, value]) => `<div class="finance-cell"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join("");
  byId("eventLineup").innerHTML = `<div class="fact-list"><div class="fact-row"><span>Участников</span><strong>${formatNumber(event.lineup_count || 0)}</strong></div><div class="fact-row"><span>Источник</span><strong>${event.lineup_count ? "Sealed lineup Core" : "Не заполнен"}</strong></div><div class="fact-row"><span>Booking</span><strong>${escapeHtml(shortId(event.booking_id, 46))}</strong></div></div>`;
  byId("eventDocuments").innerHTML = `<div class="fact-list"><div class="fact-row"><span>Договор</span><strong>${event.agreement_count ? `${event.agreement_count} в Core` : "нет"}</strong></div><div class="fact-row"><span>Репертуар</span><strong>${escapeHtml(event.repertoire_status || "не заполнен")}</strong></div><div class="fact-row"><span>Райдер</span><strong>${event.rider_version_count ? `${event.rider_version_count} версий` : "нет"}</strong></div><div class="fact-row"><span>Техника</span><strong>${escapeHtml(event.tech_status || "не согласована")}</strong></div></div>`;
}

function openEvent(occurrenceId, updateHash = true) {
  const event = (state.calendar.events || []).find((item) => (item.calendar_id || item.occurrence_id) === occurrenceId);
  if (!event) {
    if (state.loading) return;
    toast("Событие не найдено в Core");
    return;
  }
  state.selectedEventId = occurrenceId;
  byId("calendarHome").hidden = true;
  byId("eventDetail").hidden = false;
  renderEventDetail(event);
  if (updateHash) location.hash = `event/${encodeURIComponent(occurrenceId)}`;
}

function closeEvent() {
  state.selectedEventId = "";
  byId("eventDetail").hidden = true;
  byId("calendarHome").hidden = false;
  location.hash = "calendar";
}

function hotThreadIds() {
  const data = state.work || {};
  const ids = new Set();
  (data.obligations || []).forEach((item) => {
    if (item.thread_id && !["resolved", "closed", "cancelled", "completed"].includes(item.status)) ids.add(item.thread_id);
  });
  (data.drafts || []).forEach((item) => {
    if (item.thread_id && !item.review_verdict) ids.add(item.thread_id);
  });
  return ids;
}

const READ_THREADS_KEY = "lcb_core_read_threads";

function readThreadIds() {
  try {
    const value = JSON.parse(localStorage.getItem(READ_THREADS_KEY) || "[]");
    return new Set(Array.isArray(value) ? value.map(String) : []);
  } catch (_) {
    return new Set();
  }
}

function markThreadReadLocally(threadId) {
  const ids = readThreadIds();
  ids.add(String(threadId));
  localStorage.setItem(READ_THREADS_KEY, JSON.stringify([...ids].slice(-1000)));
}

function isSentTodayMoscow(thread) {
  if (thread.last_direction !== "outbound" || !thread.last_message_epoch) return false;
  const day = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow", year: "numeric", month: "2-digit", day: "2-digit",
  });
  return day.format(new Date(Number(thread.last_message_epoch) * 1000)) === day.format(new Date());
}

function chatStatusSets() {
  const business = state.threads.filter((thread) => !thread.is_technical);
  const read = readThreadIds();
  return {
    unread: new Set(business.filter((thread) => thread.last_direction !== "outbound" && !read.has(thread.thread_id)).map((thread) => thread.thread_id)),
    pending: hotThreadIds(),
    sent: new Set(business.filter(isSentTodayMoscow).map((thread) => thread.thread_id)),
  };
}

function activeCoordinationCase() {
  if (!state.chatFolder.startsWith("case:")) return null;
  const caseId = state.chatFolder.slice(5);
  return state.coordinationCases.find((item) => item.case_id === caseId) || null;
}

function coordinationContextForThread(threadId) {
  const item = activeCoordinationCase();
  if (!item) return null;
  const participant = (item.participants || []).find((link) => link.thread_id === threadId);
  return participant ? { item, participant } : null;
}

function coordinationRoleLabel(role) {
  return ({ requester: "организатор", responsible: "ответственный", observer: "участник" })[role] || "участник";
}

function visibleThreads() {
  const hot = hotThreadIds();
  const statuses = chatStatusSets();
  const query = state.query.toLowerCase();
  const coordination = activeCoordinationCase();
  const coordinationThreadIds = new Set((coordination?.participants || []).map((item) => item.thread_id));
  return state.threads.filter((thread) => {
    if (thread.is_technical) return false;
    if (state.chatStatus && !statuses[state.chatStatus].has(thread.thread_id)) return false;
    if (coordination) {
      if (!coordinationThreadIds.has(thread.thread_id)) return false;
    } else {
      if (state.chatFolder === "hot" && !hot.has(thread.thread_id)) return false;
      if (!["all", "hot"].includes(state.chatFolder) && thread.business_bucket !== state.chatFolder) return false;
    }
    if (!query) return true;
    return [threadTitle(thread), thread.peer_external_id, thread.last_body, roleLabel(thread)]
      .some((value) => String(value || "").toLowerCase().includes(query));
  });
}

function renderThreadFolders() {
  const business = state.threads.filter((thread) => !thread.is_technical);
  const hot = hotThreadIds();
  const counts = {
    All: business.length,
    New: business.filter((thread) => thread.business_bucket === "new").length,
    Hot: business.filter((thread) => hot.has(thread.thread_id)).length,
    Lcb: business.filter((thread) => thread.business_bucket === "lcb").length,
    Musicians: business.filter((thread) => thread.business_bucket === "musicians").length,
    Broker: business.filter((thread) => thread.business_bucket === "broker").length,
  };
  Object.entries(counts).forEach(([key, value]) => {
    const badge = byId(`folder${key}`);
    badge.textContent = formatNumber(value);
    badge.hidden = Number(value) === 0;
  });
  if (state.chatFolder.startsWith("case:") && !activeCoordinationCase()) state.chatFolder = "all";
  byId("coordinationFolders").innerHTML = state.coordinationCases.map((item) => {
    const folder = `case:${item.case_id}`;
    const count = (item.participants || []).length;
    return `<button class="coordination-folder ${folder === state.chatFolder ? "is-active" : ""}" data-coordination-folder="${escapeHtml(folder)}" title="${escapeHtml(item.title)}"><span class="folder-icon">▣</span><span class="folder-label">${escapeHtml(item.title)}</span><b>${formatNumber(count)}</b></button>`;
  }).join("");
  byId("coordinationFolders").querySelectorAll("[data-coordination-folder]").forEach((button) => {
    button.addEventListener("click", () => {
      state.chatFolder = button.dataset.coordinationFolder;
      state.chatStatus = "";
      renderThreads();
    });
  });
  document.querySelectorAll("[data-chat-folder]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.chatFolder === state.chatFolder);
  });
}

function syncChannelFilter() {
  const select = byId("channelFilter");
  const channels = [...new Set(state.threads.map((item) => item.channel))].sort();
  select.innerHTML = '<option value="">Все каналы</option>' + channels.map((channel) => `<option value="${escapeHtml(channel)}">${escapeHtml(channelLabel(channel))}</option>`).join("");
  select.value = channels.includes(state.channel) ? state.channel : "";
}

function renderChatStatusFilters() {
  const statuses = chatStatusSets();
  byId("countUnread").textContent = formatNumber(statuses.unread.size);
  byId("countPending").textContent = formatNumber(statuses.pending.size);
  byId("countSent").textContent = formatNumber(statuses.sent.size);
  document.querySelectorAll("[data-chat-status]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.chatStatus === state.chatStatus);
  });
}

function renderThreads() {
  renderThreadFolders();
  syncChannelFilter();
  byId("chatSearch").value = state.query;
  renderChatStatusFilters();
  const threads = visibleThreads();
  byId("threadTotal").textContent = `${threads.length} тредов`;
  byId("threadList").innerHTML = threads.length ? threads.map((thread) => {
    const name = threadTitle(thread);
    const coordination = coordinationContextForThread(thread.thread_id);
    const label = coordination
      ? `${coordination.item.title} · ${coordinationRoleLabel(coordination.participant.participant_role)}`
      : `${channelLabel(thread.channel)} · ${roleLabel(thread)}`;
    return `<button class="thread-button ${thread.thread_id === state.selectedThreadId ? "is-active" : ""}" data-thread-id="${escapeHtml(thread.thread_id)}"><span class="thread-avatar">${avatarContent(thread, name)}</span><span><span class="thread-top"><span class="thread-name">${escapeHtml(name)}</span><time class="thread-time">${escapeHtml(formatDate(thread.last_message_epoch))}</time></span><span class="thread-label">${escapeHtml(label)}</span><span class="thread-preview">${escapeHtml(thread.last_body || "Нет сообщений")}</span></span></button>`;
  }).join("") : '<div class="empty-state"><strong>Здесь пока пусто</strong>Core не записал треды этой категории. Роли не подменяются догадками.</div>';
  byId("threadList").querySelectorAll("[data-thread-id]").forEach((button) => {
    button.addEventListener("click", () => openThread(button.dataset.threadId));
  });
}

function dateKey(epoch) {
  if (!epoch) return "unknown";
  const date = new Date(Number(epoch) * 1000);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

async function openThread(threadId, updateHash = true) {
  if (updateHash) history.replaceState(null, "", `#chat/${encodeURIComponent(threadId)}`);
  state.threadRequestController?.abort();
  const controller = new AbortController();
  state.threadRequestController = controller;
  state.selectedThreadId = threadId;
  state.selectedDraftId = "";
  state.threadReady = false;
  byId("manualSendText").value = "";
  markThreadReadLocally(threadId);
  renderThreads();
  const selectedThread = state.threads.find((item) => item.thread_id === threadId) || {};
  const selectedName = threadTitle(selectedThread);
  byId("conversationEmpty").hidden = true;
  byId("conversationContent").hidden = false;
  byId("conversationName").textContent = selectedName;
  byId("conversationAvatar").innerHTML = avatarContent(selectedThread, selectedName);
  byId("conversationMeta").textContent = `${selectedThread.handle ? `@${selectedThread.handle}` : selectedThread.peer_external_id || "—"} · ${channelLabel(selectedThread.channel)} · загрузка переписки`;
  byId("conversationRole").textContent = roleLabel(selectedThread);
  byId("messageList").innerHTML = '<div class="empty-state"><strong>Загружаю переписку</strong>Предыдущий диалог очищен.</div>';
  byId("conversation").classList.add("is-open");
  renderManualSendState();
  try {
    const payload = await apiGet(
      `${API.messages}?thread_id=${encodeURIComponent(threadId)}&limit=200`,
      { signal: controller.signal },
    );
    if (state.selectedThreadId !== threadId) return;
    const thread = { ...(state.threads.find((item) => item.thread_id === threadId) || {}), ...(payload.thread || {}) };
    const name = threadTitle(thread);
    byId("conversationEmpty").hidden = true;
    byId("conversationContent").hidden = false;
    byId("conversationName").textContent = name;
    byId("conversationAvatar").innerHTML = avatarContent(thread, name);
    byId("conversationMeta").textContent = `${thread.handle ? `@${thread.handle}` : thread.peer_external_id || "—"} · ${channelLabel(thread.channel)} · ${thread.current_owner || "владелец не назначен"}`;
    byId("conversationRole").textContent = roleLabel(thread);
    let previousDay = "";
    const historyHtml = (payload.messages || []).map((message) => {
      const day = dateKey(message.sent_at_epoch);
      const divider = day !== previousDay ? `<div class="message-day">${escapeHtml(formatDate(message.sent_at_epoch, { dateOnly: true }))}</div>` : "";
      previousDay = day;
      return `${divider}<div class="message ${message.direction === "outbound" ? "outbound" : ""}">${escapeHtml(message.body || "[медиа без текста]")}<div class="message-meta">${escapeHtml(message.direction)} · ${escapeHtml(formatDate(message.sent_at_epoch))}</div></div>`;
    }).join("");
    const draft = (payload.drafts || []).find((item) => !item.is_superseded);
    let draftHtml = "";
    if (draft) {
      const violations = draft.rewrite_constraints?.style_violations || [];
      const status = draft.is_stale
        ? "УСТАРЕЛ · ПРИШЛО НОВОЕ СООБЩЕНИЕ"
        : draft.text
          ? "НЕ ОТПРАВЛЕН"
          : "ОТПРАВКА НЕ ПРЕДЛАГАЕТСЯ";
      const detail = draft.text || draft.missing_dependency || "V2 не сформировал текст ответа.";
      const action = draft.text && !draft.is_stale
        ? `<button type="button" data-draft-use="${escapeHtml(draft.draft_id)}">Использовать</button>`
        : "";
      const scenario = draft.rewrite_constraints?.ai_scenario_type || draft.scenario_type || "other";
      draftHtml = `<section class="draft-message ${draft.is_stale ? "is-stale" : ""}" data-draft-id="${escapeHtml(draft.draft_id)}"><div class="draft-message-head"><strong>Черновик V2</strong><span>${escapeHtml(status)}</span></div><div class="draft-message-text">${escapeHtml(detail)}</div><div class="draft-message-foot"><small>${escapeHtml(scenario)}${violations.length ? ` · замечаний стиля: ${violations.length}` : ""}</small>${action}</div></section>`;
    }
    byId("messageList").innerHTML = historyHtml || draftHtml
      ? `${historyHtml}${draftHtml}`
      : '<div class="empty-state"><strong>В треде нет сообщений</strong>Core хранит только сам тред.</div>';
    byId("messageList").querySelectorAll("[data-draft-use]").forEach((button) => {
      button.addEventListener("click", () => {
        const selected = (payload.drafts || []).find((item) => item.draft_id === button.dataset.draftUse);
        if (!selected?.text || selected.is_stale) return;
        state.selectedDraftId = selected.draft_id;
        byId("manualSendText").value = selected.text;
        renderManualSendState();
        byId("manualSendText").focus();
      });
    });
    const list = byId("messageList");
    list.scrollTop = list.scrollHeight;
    byId("conversation").classList.add("is-open");
    state.threadReady = true;
    renderManualSendState();
  } catch (error) {
    if (controller.signal.aborted || state.selectedThreadId !== threadId) return;
    byId("messageList").innerHTML = '<div class="empty-state"><strong>Переписка не загрузилась</strong><button type="button" data-thread-retry>Повторить</button></div>';
    byId("messageList").querySelector("[data-thread-retry]")?.addEventListener("click", () => openThread(threadId, false));
    toast(`Тред не открыт: ${error.message}`);
  } finally {
    if (state.threadRequestController === controller) state.threadRequestController = null;
  }
}

function renderManualSendState() {
  const enabled = Boolean(state.health?.manual_send_enabled && state.threadReady && state.selectedThreadId);
  const form = byId("manualSendForm");
  const text = byId("manualSendText");
  const button = byId("manualSendButton");
  form.classList.toggle("is-enabled", enabled);
  text.disabled = !enabled || state.sending;
  button.disabled = !enabled || state.sending;
  button.setAttribute("aria-disabled", String(!enabled || state.sending));
  byId("manualSendNote").textContent = enabled
    ? state.selectedDraftId
      ? "Выбран черновик V2. Проверь текст: отправка произойдёт только после твоего нажатия."
      : "Ручной текст уйдёт дословно через единственного Telegram-отправщика. Автоответы остаются в HOLD."
    : "Ручная отправка выключена конфигурацией Core. Автоответы остаются в HOLD.";
}

async function sendManualReply(event) {
  event.preventDefault();
  if (state.sending || !state.health?.manual_send_enabled || !state.threadReady || !state.selectedThreadId) return;
  const field = byId("manualSendText");
  const text = field.value.trim();
  if (!text) return;
  state.sending = true;
  renderManualSendState();
  try {
    const result = await apiPost(API.send, {
      thread_id: state.selectedThreadId,
      text,
      draft_id: state.selectedDraftId || null,
    });
    field.value = "";
    state.selectedDraftId = "";
    if (result.core_recorded === false) {
      toast(result.warning || "Telegram доставил, но Core требует сверки receipt.");
    } else {
      toast("Сообщение доставлено и записано в Core.");
    }
    await refreshAll();
    await openThread(state.selectedThreadId, false);
  } catch (error) {
    toast(error.message);
  } finally {
    state.sending = false;
    renderManualSendState();
  }
}

function itemSummary(tab, item) {
  if (tab === "obligations") return [item.kind, item.status, `${item.subject_type || "subject"}: ${item.subject_id || "—"}`, item.due_at_epoch];
  if (tab === "drafts") return [item.purpose, item.review_verdict || "unreviewed", item.text || item.missing_dependency || "—", item.created_at_epoch];
  if (tab === "outbound_intents") return [item.purpose, item.status, `${item.channel} → ${item.recipient_external_id}`, item.updated_at_epoch];
  if (tab === "approvals") return [item.purpose, item.decision, `${item.subject_type}: ${item.subject_id}`, item.created_at_epoch];
  return [item.event_type, `seq ${item.seq}`, `${item.aggregate_type}: ${item.aggregate_id}`, item.occurred_at_epoch];
}

function operationValue(value) {
  return value === null || value === undefined ? "—" : formatNumber(value);
}

function serviceLabel(value) {
  return ({
    "cli_codex_gpt-5.5": "Codex GPT-5.5",
    cli_antigravity: "Antigravity",
    claude: "Claude",
  })[value] || String(value || "AI");
}

function draftStatusLabel(value) {
  return ({
    ready: "Черновик готов",
    missing: "Черновика ещё нет",
    thread_not_imported: "Тред ещё не в Core",
  })[value] || "Статус неизвестен";
}

function renderOperations() {
  const operations = state.operations || {};
  const legacy = operations.legacy || {};
  const core = operations.core || {};
  const leads = legacy.leads || {};
  const pitches = legacy.pitches || {};
  const followups = legacy.followups || {};
  const day = operations.business_day || legacy.business_day || "—";
  const unclassified = Number(leads.lcb?.unclassified || 0);
  byId("operationsSource").textContent = `${day} · Core + read-only telemetry${legacy.available ? "" : " · legacy недоступен"}`;

  const cards = [
    ["LCB заявки", leads.lcb?.value, unclassified ? `не распределено: ${unclassified}` : "создано в CRM"],
    ["Broker заявки", leads.broker?.value, "создано сегодня"],
    ["Питчи отправлены", Number(pitches.sent_lcb || 0) + Number(pitches.sent_broker || 0), `LCB ${operationValue(pitches.sent_lcb)} · Broker ${operationValue(pitches.sent_broker)}`],
    ["Follow-up отправлены", followups.sent_today, "только receipt/log evidence"],
    ["Follow-up пора", followups.due_now, "ожидают обработки"],
    ["Мяч у нас", followups.ball_on_us, "нужен ответ, не follow-up"],
  ];
  byId("operationsMetrics").innerHTML = cards.map(([label, value, detail], index) => `<div class="operations-metric ${index >= 4 && Number(value || 0) ? "is-warn" : ""}"><span>${escapeHtml(label)}</span><strong>${escapeHtml(operationValue(value))}</strong><small>${escapeHtml(detail)}</small></div>`).join("");

  const channels = legacy.channels || [];
  byId("channelHealth").innerHTML = channels.length ? channels.map((channel) => `<div class="channel-health-row is-${escapeHtml(channel.status || "unknown")}"><span class="health-dot" aria-hidden="true"></span><strong>${escapeHtml(channel.label || channel.channel)}</strong><small>${escapeHtml(shortId(channel.detail || "нет данных", 115))}</small><em>${formatNumber(channel.core_threads || 0)} в Core</em></div>`).join("") : '<div class="empty-state"><strong>Health недоступен</strong>Legacy telemetry не ответил.</div>';

  const usage = legacy.ai_usage || {};
  if (usage.status === "ok") {
    const services = Object.entries(usage.services || {}).sort((a, b) => Number(b[1]?.calls || 0) - Number(a[1]?.calls || 0));
    byId("tokenUsage").innerHTML = `<div class="token-total"><div><span>Токенов</span><strong>${formatNumber(usage.total_tokens)}</strong><small>${formatNumber(usage.input_tokens)} вход · ${formatNumber(usage.output_tokens)} выход</small></div><div><span>Вызовов</span><strong>${formatNumber(usage.calls)}</strong></div></div><ul class="token-services">${services.map(([name, item]) => `<li><span>${escapeHtml(serviceLabel(name))}</span><strong>${formatNumber(item.calls || 0)}</strong></li>`).join("")}</ul>`;
  } else {
    byId("tokenUsage").innerHTML = '<div class="empty-state"><strong>Токены не измерены</strong>Источник usage не дал свежий бизнес-день.</div>';
  }

  const brokerBlockers = pitches.broker_blockers || [];
  byId("pitchOperations").innerHTML = `<div class="pitch-line"><span>LCB отправлено</span><strong>${operationValue(pitches.sent_lcb)}</strong></div><div class="pitch-line"><span>Broker отправлено</span><strong>${operationValue(pitches.sent_broker)}</strong></div><div class="pitch-line"><span>Broker остановлено</span><strong>${operationValue(pitches.not_sent_broker)}</strong></div><ul class="reason-list">${brokerBlockers.map((item) => `<li><span>${escapeHtml(item.reason)}</span><strong>${formatNumber(item.count)}</strong></li>`).join("") || '<li><span>Блокеров брокера нет</span><strong>0</strong></li>'}</ul><small class="source-note">LCB blocker-счётчик ещё не унифицирован; вместо ложного нуля показан только доказанный send.</small>`;

  const blockers = followups.blocked_reasons || [];
  byId("followupBlockers").innerHTML = `<div class="pitch-line"><span>Остановлено правилами</span><strong>${operationValue(followups.blocked)}</strong></div><ul class="reason-list">${blockers.map((item) => `<li><span>${escapeHtml(shortId(item.reason, 95))}</span><strong>${formatNumber(item.count)}</strong></li>`).join("") || '<li><span>Причины не получены</span><strong>—</strong></li>'}</ul>`;

  const dueItems = followups.due_items || [];
  byId("followupProjectionState").textContent = core.followups?.plans
    ? `${formatNumber(core.followups.plans)} планов Core · ${formatNumber(core.followups.drafts)} драфтов`
    : "Legacy сроки · Core plans ещё не подключены";
  byId("followupQueue").innerHTML = dueItems.length ? dueItems.map((item) => {
    const name = item.name || item.username || "Контакт";
    const action = item.core_thread_id
      ? `<button type="button" data-operation-thread="${escapeHtml(item.core_thread_id)}">Открыть тред</button>`
      : "";
    return `<div class="followup-row"><span><strong>${escapeHtml(name)}</strong><small>${escapeHtml(item.channel || "")} · ${escapeHtml(item.event_date || "без даты")}</small></span><span><small>${escapeHtml(shortId(item.reason || item.plan || "Причина не записана", 145))}</small><b class="draft-state ${item.core_draft_status === "ready" ? "is-ready" : ""}">${escapeHtml(draftStatusLabel(item.core_draft_status))}</b></span>${action}</div>`;
  }).join("") : '<div class="empty-state"><strong>Срочных follow-up нет</strong>На этот бизнес-день очередь пуста.</div>';
  byId("followupQueue").querySelectorAll("[data-operation-thread]").forEach((button) => {
    button.addEventListener("click", () => openThread(button.dataset.operationThread));
  });

  const alerts = operations.alerts || [];
  byId("operationsAlerts").innerHTML = alerts.map((item) => `<div class="operations-alert is-${escapeHtml(item.level || "degraded")}"><strong>${escapeHtml(item.title)}</strong>${escapeHtml(item.detail)}</div>`).join("");
}

function renderToday() {
  const data = state.work || { obligations: [], drafts: [], outbound_intents: [], approvals: [], domain_events: [] };
  const openObligations = (data.obligations || []).filter((item) => !["resolved", "closed", "cancelled", "completed"].includes(item.status)).length;
  const unreviewed = (data.drafts || []).filter((item) => !item.review_verdict).length;
  const activeApprovals = (data.approvals || []).filter((item) => item.active).length;
  const pendingOutbound = (data.outbound_intents || []).filter((item) => !["delivered", "cancelled", "failed"].includes(item.status)).length;
  byId("todayMetrics").innerHTML = [["Обязательства", openObligations], ["Черновики без review", unreviewed], ["Решения", activeApprovals], ["Исходящие в Core", pendingOutbound]].map(([label, value]) => `<div class="metric"><span>${escapeHtml(label)}</span><strong>${formatNumber(value)}</strong></div>`).join("");
  const countIds = { obligations: "countObligations", drafts: "countDrafts", outbound_intents: "countOutbound", approvals: "countApprovals", domain_events: "countEvents" };
  Object.entries(countIds).forEach(([key, id]) => { byId(id).textContent = formatNumber((data[key] || []).length); });
  document.querySelectorAll("[data-work-tab]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.workTab === state.activeWorkTab);
  });
  const rows = data[state.activeWorkTab] || [];
  byId("workList").innerHTML = rows.length ? rows.map((item) => {
    const [kind, status, detail, epoch] = itemSummary(state.activeWorkTab, item);
    return `<div class="work-row"><span class="work-state">${escapeHtml(status || "unknown")}</span><span><strong>${escapeHtml(kind || "Core item")}</strong><small>${escapeHtml(shortId(item.thread_id || item.actor || item.correlation_id || "", 42))}</small></span><span>${escapeHtml(shortId(detail, 120))}</span><time>${escapeHtml(formatDate(epoch))}</time></div>`;
  }).join("") : '<div class="empty-state"><strong>Очередь пуста</strong>Core не создал элементов этого типа.</div>';
  setBadge("navTodayCount", openObligations + unreviewed + activeApprovals);
  renderOperations();
}

function renderSystem() {
  const health = state.health || {};
  const rows = [
    ["Runtime", health.runtime_mode || "unknown"],
    ["Legacy fallback", health.legacy_fallback ? "включён" : "нет"],
    ["Черновики V2", health.draft_write_enabled ? "включены" : "выключены"],
    ["Отправка", health.send_enabled ? "включена" : "выключена"],
    ["Автоотправка", health.agent_send_enabled ? "включена" : "HOLD"],
  ];
  byId("systemState").innerHTML = rows.map(([label, value]) => `<div class="system-state-row"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join("");
  const details = [
    ["Живая схема", `v${health.schema_version ?? "—"}`],
    ["Схема кода", `v${health.code_schema_version ?? "—"}`],
    ["Команды готовы", health.schema_ready_for_commands ? "да" : "нет"],
    ["Размер Core DB", `${formatNumber(Math.round(Number(health.database_size_bytes || 0) / 1024))} KB`],
    ["Последнее сообщение", formatAge(health.latest_message_age_seconds)],
    ["Календарь Core", `${formatNumber(state.calendar.business_events)} бизнес / ${formatNumber(state.calendar.technical_events)} тех.`],
  ];
  byId("schemaDetails").innerHTML = details.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join("");
  byId("systemHealthPill").textContent = health.ok ? "Core доступен" : "Core неполон";
  byId("systemHealthPill").className = `pill ${health.ok ? "ok" : "danger"}`;
}

function renderBroadcast() {
  const channels = state.summary?.channels || [];
  byId("broadcastChannels").innerHTML = channels.length ? channels.map((item) => `<div class="channel-cell"><strong>${escapeHtml(channelLabel(item.channel))}</strong><span>${formatNumber(item.threads)} тредов в Core · отправка выключена</span></div>`).join("") : '<div class="empty-state"><strong>Каналов нет</strong>Core пока не записал каналы.</div>';
}

function updateCounts() {
  const work = state.work || {};
  const today = (work.obligations || []).filter((item) => !["resolved", "closed", "cancelled", "completed"].includes(item.status)).length
    + (work.drafts || []).filter((item) => !item.review_verdict).length
    + (work.approvals || []).filter((item) => item.active).length;
  setBadge("navTodayCount", today);
  setBadge("navChatsCount", 0);
}

async function refreshCalendar(force = false) {
  const now = Date.now();
  if (state.calendarLoading) return;
  if (!force && state.calendarRefreshedAt && now - state.calendarRefreshedAt < 300000) return;
  state.calendarLoading = true;
  try {
    state.calendar = await apiGet(API.calendar);
    state.calendarRefreshedAt = Date.now();
    renderCalendar();
  } catch (error) {
    if (state.activeView === "calendar") toast(`Календарь не обновлён: ${error.message}`);
  } finally {
    state.calendarLoading = false;
  }
}

async function refreshAll() {
  if (state.loading) return;
  state.loading = true;
  byId("refreshButton").disabled = true;
  setConnection("loading", "Обновление");
  try {
    const [health, summary, threadsPayload, coordinationPayload, work, operations] = await Promise.all([
      apiGet(API.health),
      apiGet(API.summary),
      apiGet(`${API.threads}?limit=200`),
      apiGet(API.coordinationCases),
      apiGet(API.work),
      apiGet(API.operations),
    ]);
    state.health = health;
    state.summary = summary;
    state.threads = threadsPayload.threads || [];
    state.coordinationCases = coordinationPayload.cases || [];
    state.work = work;
    state.operations = operations;
    renderCalendar();
    renderThreads();
    renderToday();
    renderSystem();
    renderBroadcast();
    renderManualSendState();
    updateCounts();
    setConnection(health.ok ? "ok" : "error", health.ok ? "Core доступен" : "Core неполон");
    if (state.selectedEventId) openEvent(state.selectedEventId, false);
  } catch (error) {
    setConnection("error", "Core недоступен");
    toast(`Не удалось прочитать Core: ${error.message}`);
  } finally {
    state.loading = false;
    byId("refreshButton").disabled = false;
  }
}

function bindEvents() {
  document.querySelectorAll(".tab-button").forEach((button) => {
    button.addEventListener("click", () => { location.hash = button.dataset.view; });
  });
  document.querySelectorAll("[data-chat-folder]").forEach((button) => {
    button.addEventListener("click", () => {
      state.chatFolder = button.dataset.chatFolder;
      renderThreads();
    });
  });
  byId("chatSearch").addEventListener("input", (event) => {
    state.query = event.target.value.trim();
    byId("globalSearch").value = state.query;
    renderThreads();
    byId("chatSearch").focus();
  });
  document.querySelectorAll("[data-counter-folder]").forEach((button) => {
    button.addEventListener("click", () => {
      state.chatFolder = button.dataset.counterFolder;
      renderThreads();
    });
  });
  document.querySelectorAll("[data-counter-work]").forEach((button) => {
    button.addEventListener("click", () => {
      state.activeWorkTab = button.dataset.counterWork;
      location.hash = "today";
    });
  });
  document.querySelectorAll("[data-work-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      state.activeWorkTab = button.dataset.workTab;
      renderToday();
    });
  });
  byId("calendarPrev").addEventListener("click", () => {
    state.month = new Date(state.month.getFullYear(), state.month.getMonth() - 1, 1);
    renderCalendar();
  });
  byId("calendarNext").addEventListener("click", () => {
    state.month = new Date(state.month.getFullYear(), state.month.getMonth() + 1, 1);
    renderCalendar();
  });
  byId("calendarToday").addEventListener("click", () => {
    const now = new Date();
    state.month = new Date(now.getFullYear(), now.getMonth(), 1);
    renderCalendar();
  });
  const calendarFilterInputs = {
    filterLcb: "lcb",
    filterBroker: "broker",
    filterJobs: "jobs",
    filterRequests: "requests",
    filterCancelled: "cancelled",
    filterTechnical: "technical",
    filterStagePerformed: "performed",
    filterStageContentPending: "content_pending",
    filterStageContentReceived: "content_received",
    filterStagePrepayment: "prepayment",
    filterStageContract: "contract",
    filterStageConfirmed: "confirmed",
    filterStageNegotiating: "negotiating",
    filterStageFollowupWaiting: "followup_waiting",
    filterStageFollowupCold: "followup_cold",
    filterStageLead: "lead",
  };
  Object.entries(calendarFilterInputs).forEach(([id, key]) => {
    byId(id).addEventListener("change", (event) => {
      state.calendarFilters[key] = Boolean(event.target.checked);
      renderCalendar();
    });
  });
  byId("calendarSelectAll").addEventListener("click", () => {
    Object.keys(state.calendarFilters).forEach((key) => { state.calendarFilters[key] = true; });
    renderCalendar();
  });
  byId("calendarClearAll").addEventListener("click", () => {
    Object.keys(state.calendarFilters).forEach((key) => { state.calendarFilters[key] = false; });
    renderCalendar();
  });
  byId("eventBack").addEventListener("click", closeEvent);
  byId("chatBack").addEventListener("click", () => {
    byId("conversation").classList.remove("is-open");
    location.hash = "chats";
  });
  byId("manualSendForm").addEventListener("submit", sendManualReply);
  document.querySelectorAll("[data-chat-status]").forEach((button) => {
    button.addEventListener("click", () => {
      state.chatStatus = state.chatStatus === button.dataset.chatStatus ? "" : button.dataset.chatStatus;
      renderThreads();
    });
  });
  byId("refreshButton").addEventListener("click", refreshAll);
  byId("connectionButton").addEventListener("click", () => { location.hash = "system"; });
  byId("themeButton").addEventListener("click", () => {
    const root = document.documentElement;
    const dark = root.dataset.theme === "dark";
    root.dataset.theme = dark ? "light" : "dark";
    localStorage.setItem("lcb_core_theme", root.dataset.theme);
  });
  let searchTimer;
  byId("globalSearch").addEventListener("input", (event) => {
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => {
      state.query = event.target.value.trim();
      if (state.activeView === "calendar") renderCalendar();
      if (state.activeView === "chats") renderThreads();
    }, 180);
  });
  window.addEventListener("hashchange", route);
}

const savedTheme = localStorage.getItem("lcb_core_theme");
if (savedTheme === "dark" || savedTheme === "light") document.documentElement.dataset.theme = savedTheme;
bindEvents();
route();
refreshAll();
window.setInterval(refreshAll, 30000);

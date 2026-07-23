"use strict";

const API = Object.freeze({
  health: "/api/core/health",
  autonomy: "/api/core/autonomy",
  summary: "/api/core/summary",
  fees: "/api/core/fees",
  calendar: "/api/core/calendar",
  threads: "/api/core/threads",
  messages: "/api/core/messages",
  coordinationCases: "/api/core/coordination-cases",
  send: "/api/core/send",
  sendScheduledNow: "/api/core/scheduled/send-now",
  dismissDraft: "/api/core/drafts/dismiss",
  rewriteDraft: "/api/core/drafts/rewrite",
  saveCanon: "/api/core/style-examples",
  assignRole: "/api/core/roles/assign",
  work: "/api/core/work",
  operations: "/api/core/operations",
});

const state = {
  health: null,
  autonomy: null,
  summary: null,
  fees: null,
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
    followup_cold: true,
    cancelled: true,
  },
  month: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  loading: false,
  calendarLoading: false,
  calendarRefreshedAt: 0,
  sending: false,
  sendingScheduledNow: false,
  rewritingDraft: false,
  savingCanon: false,
  dismissingDraft: false,
  assigningRole: false,
  changingAutonomy: false,
  selectedThread: null,
  selectedDraftId: "",
  savedCanonText: "",
  threadReady: false,
  threadRequestController: null,
};

const AUTONOMY_MODES = Object.freeze({
  approval_required: {
    label: "Спрашивать",
    icon: "✋",
    description: "Каждый ответ сначала подтверждает человек",
  },
  exception_only: {
    label: "При отклонении",
    icon: "◌",
    description: "Обычные ответы самостоятельно, отклонения и риск — человеку",
  },
  autonomous: {
    label: "Самостоятельно",
    icon: "◎",
    description: "Обычная переписка без обращения к человеку",
  },
});

const CALENDAR_STAGE_LABELS = Object.freeze({
  performed: "Состоялось",
  content_pending: "Фото/видео запросить",
  content_received: "Фото/видео получены",
  prepayment: "Предоплата получена",
  contract: "Договор",
  confirmed: "Подтверждено",
  negotiating: "Отвечает / в работе",
  followup_waiting: "Отвечает / в работе",
  followup_cold: "Не отвечает",
  lead: "Отвечает / в работе",
  cancelled: "Отмена",
});

const ROLE_OPTIONS = Object.freeze([
  ["client_organizer", "Организатор"],
  ["client_private", "Частный клиент"],
  ["client_agency", "Агентство"],
  ["payer", "Плательщик"],
  ["venue_rep", "Представитель площадки"],
  ["tech_contact", "Технический контакт"],
  ["lcb_team_member", "Музыкант LCB"],
  ["vendor_performer", "Подрядчик-артист"],
  ["vendor_tech", "Технический подрядчик"],
  ["vendor_media", "Фото / видео подрядчик"],
  ["vendor_other", "Другой подрядчик"],
  ["lead_source", "Источник лида"],
  ["aggregator", "Агрегатор"],
  ["referrer", "Рекомендатель"],
  ["accounting", "Бухгалтерия"],
  ["personal", "Личное / нерабочее"],
  ["unknown_review", "Пока не определено"],
]);

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
  if (isTechnicalThread(thread)) return "Внутреннее техническое сообщение";
  return ROLE_OPTIONS.find(([role]) => role === thread.relationship_role)?.[1] || "Роль не определена";
}

function isTechnicalThread(thread) {
  return Boolean(thread?.is_technical || thread?.business_bucket === "technical");
}

function renderConversationRole(thread) {
  state.selectedThread = thread || null;
  const button = byId("conversationRole");
  const menu = byId("conversationRoleMenu");
  button.textContent = roleLabel(thread || {});
  button.classList.toggle("is-ai", thread?.role_source === "ai");
  button.classList.toggle("is-operator", thread?.role_source === "operator");
  button.disabled = Boolean(isTechnicalThread(thread) || !thread?.thread_id || state.assigningRole);
  const confidence = thread?.role_confidence === null || thread?.role_confidence === undefined
    ? null
    : Math.round(Number(thread.role_confidence) * 100);
  const status = thread?.role_source === "operator"
    ? "Роль исправлена Михаилом и имеет приоритет над AI."
    : thread?.role_source === "ai"
      ? `AI определил по переписке${confidence === null ? "" : ` · уверенность ${confidence}%`}.`
      : "AI ещё не определил роль по переписке.";
  button.title = `${status} Нажми, чтобы изменить.`;
  menu.innerHTML = `<div class="role-menu-status"><strong>${escapeHtml(roleLabel(thread || {}))}</strong>${escapeHtml(status)}</div>${ROLE_OPTIONS.map(([role, label]) => `<button type="button" role="option" data-role-value="${escapeHtml(role)}" class="${role === thread?.relationship_role ? "is-selected" : ""}" aria-selected="${role === thread?.relationship_role}">${escapeHtml(label)}</button>`).join("")}`;
  menu.querySelectorAll("[data-role-value]").forEach((option) => {
    option.addEventListener("click", () => assignConversationRole(option.dataset.roleValue));
  });
}

function closeRoleMenu() {
  byId("conversationRoleMenu").hidden = true;
  byId("conversationRole").setAttribute("aria-expanded", "false");
}

async function assignConversationRole(role) {
  if (state.assigningRole || !state.selectedThreadId) return;
  state.assigningRole = true;
  closeRoleMenu();
  renderConversationRole(state.selectedThread || {});
  const requestId = globalThis.crypto?.randomUUID?.()
    || `role-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  try {
    const result = await apiPost(API.assignRole, {
      thread_id: state.selectedThreadId,
      role,
      request_id: requestId,
    });
    const current = state.threads.find((item) => item.thread_id === state.selectedThreadId);
    if (current) Object.assign(current, result);
    state.selectedThread = { ...(state.selectedThread || {}), ...result };
    renderThreads();
    renderConversationRole(state.selectedThread);
    toast(`Роль сохранена: ${roleLabel(state.selectedThread)}.`);
  } catch (error) {
    toast(`Роль не сохранена: ${error.message}`);
  } finally {
    state.assigningRole = false;
    renderConversationRole(state.selectedThread || {});
  }
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

async function apiPost(url, body, options = {}) {
  const controller = options.timeoutMs ? new AbortController() : null;
  const timer = controller
    ? window.setTimeout(() => controller.abort(), options.timeoutMs)
    : null;
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller?.signal,
    });
    const payload = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
    if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
    return payload;
  } catch (error) {
    if (controller?.signal.aborted) {
      throw new Error(options.timeoutMessage || "Core не ответил вовремя. Ничего не отправлено.");
    }
    if (error instanceof TypeError) {
      throw new Error("Нет связи с Core. Исходный текст сохранён; ничего не отправлено.");
    }
    throw error;
  } finally {
    if (timer !== null) window.clearTimeout(timer);
  }
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

function closeAutonomyMenu() {
  byId("autonomyMenu").hidden = true;
  byId("autonomyButton").setAttribute("aria-expanded", "false");
}

function renderAutonomy() {
  const autonomy = state.autonomy || {
    mode: "approval_required",
    agent_send_enabled: false,
    effective_blockers: ["policy_requires_approval"],
    transport_mode: "hold",
  };
  const config = AUTONOMY_MODES[autonomy.mode] || AUTONOMY_MODES.approval_required;
  byId("autonomyLabel").textContent = config.label;
  byId("autonomyButton").querySelector(".autonomy-icon").textContent = config.icon;
  byId("autonomyButton").disabled = state.changingAutonomy;
  const blocker = (autonomy.effective_blockers || []).join(", ");
  byId("autonomyButton").title = autonomy.agent_send_enabled
    ? `${config.description}. Автоответы доступны.`
    : `${config.description}. Фактическая отправка заблокирована: ${blocker || "HOLD"}.`;
  document.querySelectorAll("[data-autonomy-mode]").forEach((button) => {
    const selected = button.dataset.autonomyMode === autonomy.mode;
    button.classList.toggle("is-selected", selected);
    button.setAttribute("aria-checked", String(selected));
    button.disabled = state.changingAutonomy;
  });
  if (autonomy.agent_send_enabled) {
    byId("shadowStripText").innerHTML = `<strong>LC Band 2.0</strong> · ${escapeHtml(config.description)} · строгие бизнес-гейты активны`;
    byId("shadowStripPill").textContent = "AUTO READY";
    byId("shadowStripPill").className = "pill ok";
  } else {
    byId("shadowStripText").innerHTML = `<strong>LC Band 2.0</strong> · выбран режим «${escapeHtml(config.label)}» · фактическая автоотправка HOLD`;
    byId("shadowStripPill").textContent = "SEND HOLD";
    byId("shadowStripPill").className = "pill hold";
  }
}

async function setAutonomyMode(mode) {
  if (state.changingAutonomy || !AUTONOMY_MODES[mode]) return;
  state.changingAutonomy = true;
  closeAutonomyMenu();
  renderAutonomy();
  const requestId = globalThis.crypto?.randomUUID?.()
    || `autonomy-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  try {
    state.autonomy = await apiPost(API.autonomy, { mode, request_id: requestId });
    state.health = {
      ...(state.health || {}),
      chat_autonomy_mode: state.autonomy.mode,
      chat_autonomy_revision: state.autonomy.revision,
      agent_send_enabled: state.autonomy.agent_send_enabled,
      agent_send_blockers: state.autonomy.effective_blockers,
      telegram_transport_mode: state.autonomy.transport_mode,
    };
    renderSystem();
    toast(`Режим агента: ${AUTONOMY_MODES[state.autonomy.mode].label}.`);
  } catch (error) {
    toast(`Режим не изменён: ${error.message}`);
  } finally {
    state.changingAutonomy = false;
    renderAutonomy();
  }
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
  if (view === "fees") renderFees();
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
  const view = ["calendar", "chats", "today", "system", "fees", "broadcast"].includes(name)
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
    if (!calendarEventMatchesFilters(event)) return false;
    if (!query) return true;
    return [eventTitle(event), event.venue_ref, event.event_date, event.service_format, event.username]
      .some((value) => String(value || "").toLowerCase().includes(query));
  });
}

function calendarEventMatchesFilters(event) {
  const filters = state.calendarFilters;
  const businessLine = String(event.business_line || "").toLowerCase();
  const recordType = String(event.record_type || "").toLowerCase();
  const isTechnical = Boolean(event.is_technical);
  const selectedBusinessLines = [
    filters.lcb ? "lcb" : null,
    filters.broker ? "broker" : null,
  ].filter(Boolean);

  // Business line and record type are independent dimensions. With neither
  // record-type checkbox selected, keep all record types for the chosen line;
  // this makes selecting only LCB/Broker useful instead of showing zero rows.
  if (isTechnical) {
    if (!filters.technical) return false;
  } else if (!selectedBusinessLines.includes(businessLine)) {
    return false;
  }
  const selectedRecordTypes = [
    filters.jobs ? "job" : null,
    filters.requests ? "request" : null,
  ].filter(Boolean);
  if (selectedRecordTypes.length && !selectedRecordTypes.includes(recordType)) return false;

  const cancelled = Boolean(
    event.cancelled
      || event.lifecycle === "cancelled"
      || event.occurrence_status === "cancelled"
      || event.funnel_stage === "cancelled"
  );
  if (cancelled && !filters.cancelled) return false;
  const funnelStage = eventFunnelStage(event);
  if (funnelStage && filters[funnelStage] === false) return false;
  return true;
}

function eventFunnelStage(event) {
  if (["lead", "followup_waiting"].includes(event.funnel_stage)) return "negotiating";
  if (event.funnel_stage && CALENDAR_STAGE_LABELS[event.funnel_stage]) return event.funnel_stage;
  if (event.cancelled || event.lifecycle === "cancelled" || event.occurrence_status === "cancelled") return "cancelled";
  if (event.lifecycle === "performed" || event.occurrence_status === "performed") return "performed";
  if (event.lifecycle === "prepayment") return "prepayment";
  if (event.lifecycle === "contract") return "contract";
  if (event.lifecycle === "confirmed") return "confirmed";
  if (event.lifecycle === "negotiation") return "negotiating";
  return "negotiating";
}

function funnelStageLabel(event) {
  return CALENDAR_STAGE_LABELS[eventFunnelStage(event)] || "Этап не определён";
}

function funnelStageClass(event) {
  return eventFunnelStage(event).replaceAll("_", "-");
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
    filterStageFollowupCold: "followup_cold",
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
      ${events.slice(0, 3).map((event) => `<button class="event-chip funnel-${escapeHtml(funnelStageClass(event))} ${event.is_technical ? "technical" : ""} ${escapeHtml(event.business_line || "")} ${escapeHtml(event.record_type || "")}" data-event-id="${escapeHtml(event.calendar_id || event.occurrence_id)}" title="${escapeHtml(`${eventTitle(event)} · ${funnelStageLabel(event)}`)}">${escapeHtml(eventTitle(event))}</button>`).join("")}
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
  const mediaArrangements = event.media_arrangements || [];
  const video = mediaArrangements.find((item) => item.arrangement_kind === "videographer") || {};
  const soundRecording = mediaArrangements.find((item) => item.arrangement_kind === "stereo_multitrack") || {};
  const mediaDetail = (item, fallback) => item.status === "ready"
    ? `${item.owner_display_name || "ответственный назначен"}${item.recording_format ? ` · ${item.recording_format}` : ""}`
    : item.status === "declined"
      ? "Отказ зафиксирован"
      : fallback;
  const mediaStatusLabel = (value) => value && value !== "unknown" ? value : "не указано";
  const checklist = [
    ["Договор", Number(event.agreement_count || 0) > 0, false, event.agreement_count ? `${event.agreement_count} версия/корень договора в Core` : "Договор ещё не создан в Core"],
    ["Предоплата", receivedMinor > 0, prepaymentMinor !== null && prepaymentMinor !== undefined, receivedMinor > 0 ? `Принято доказательств оплаты: ${formatMoney(receivedMinor, event.currency)}` : prepaymentMinor !== null && prepaymentMinor !== undefined ? `План предоплаты: ${formatMoney(prepaymentMinor, event.currency)}` : "План оплаты не зафиксирован"],
    ["Адрес и тайминг", Boolean(event.date_firm && event.venue_ref && event.performance_start_at_epoch), Boolean(event.event_date), event.venue_ref ? `${event.venue_ref}; ${time}` : "Нет точной площадки и времени"],
    ["Пропуск / паспорт / авто", Number(event.checklist_requirement_count || 0) > 0 && Number(event.checklist_unresolved_count || 0) === 0, Number(event.checklist_requirement_count || 0) > 0, event.checklist_requirement_count ? `Readiness-checklist: ${event.checklist_unresolved_count ?? "—"} незакрытых` : "Readiness-checklist ещё не открыт"],
    ["Состав", Number(event.lineup_count || 0) > 0, false, event.lineup_count ? `${event.lineup_count} участников в sealed lineup` : "Состав не перенесён в Core"],
    ["Звук / райдер", Number(event.rider_version_count || 0) > 0 && Boolean(event.tech_status), Number(event.rider_version_count || 0) > 0, event.rider_version_count ? `Райдер v${event.rider_version_count}; техника: ${event.tech_status || "ждёт координации"}` : "Райдер не зафиксирован"],
    ["Репертуар", Boolean(event.repertoire_status && event.repertoire_status !== "needs_facts"), event.repertoire_status === "needs_facts", event.repertoire_status ? `Статус: ${event.repertoire_status}` : "Требования к репертуару не записаны"],
    ["Видеосъёмка", video.status === "ready", video.status === "needs_facts", mediaDetail(video, "Съёмка не организована или не подтверждена")],
    ["Запись звука", soundRecording.status === "ready", soundRecording.status === "needs_facts", mediaDetail(soundRecording, "Запись звука не организована или не подтверждена")],
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
    ["Составу начислено", formatMoney(event.team_payable_minor, event.currency)],
    ["Составу переведено", formatMoney(event.team_paid_minor, event.currency)],
    ["Плановая маржа", formatMoney(event.projected_margin_minor, event.currency)],
  ];
  byId("eventFinance").innerHTML = finances.map(([label, value]) => `<div class="finance-cell"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join("");
  byId("eventLineup").innerHTML = `<div class="fact-list"><div class="fact-row"><span>Участников</span><strong>${formatNumber(event.lineup_count || 0)}</strong></div><div class="fact-row"><span>Источник</span><strong>${event.lineup_count ? "Sealed lineup Core" : "Не заполнен"}</strong></div><div class="fact-row"><span>Booking</span><strong>${escapeHtml(shortId(event.booking_id, 46))}</strong></div></div>`;
  byId("eventDocuments").innerHTML = `<div class="fact-list"><div class="fact-row"><span>Договор</span><strong>${event.agreement_count ? `${event.agreement_count} в Core` : "нет"}</strong></div><div class="fact-row"><span>Репертуар</span><strong>${escapeHtml(event.repertoire_status || "не заполнен")}</strong></div><div class="fact-row"><span>Райдер</span><strong>${event.rider_version_count ? `${event.rider_version_count} версий` : "нет"}</strong></div><div class="fact-row"><span>Техника</span><strong>${escapeHtml(event.tech_status || "не согласована")}</strong></div></div>`;
  byId("eventMedia").innerHTML = `<div class="fact-list">${mediaArrangements.map((item) => `<div class="fact-row"><span>${escapeHtml(item.label || item.arrangement_kind)}</span><strong>${escapeHtml(mediaDetail(item, "не организовано"))} · ${escapeHtml(mediaStatusLabel(item.permission_status))} · ${escapeHtml(mediaStatusLabel(item.commercial_status))}</strong></div>`).join("")}</div>`;
  const payouts = event.payouts || [];
  byId("eventPayouts").innerHTML = payouts.length
    ? `<div class="fact-list">${payouts.map((item) => `<div class="fact-row"><span>${escapeHtml(item.display_name || "Исполнитель")}</span><strong>${escapeHtml(formatMoney(item.settled_minor, item.currency))} из ${escapeHtml(formatMoney(item.amount_minor, item.currency))} · ${escapeHtml(item.settlement_status)}</strong></div>`).join("")}</div>`
    : '<div class="calendar-empty-note">В Core нет подтверждённых гонораров и выплат. Маржа не рассчитывается.</div>';
}

function openEvent(occurrenceId, updateHash = true) {
  const event = (state.calendar.events || []).find((item) => (item.calendar_id || item.occurrence_id) === occurrenceId);
  if (!event) {
    if (state.loading) return;
    toast("Событие не найдено в Core");
    return;
  }
  if (event.navigation_target === "thread") {
    setView("chats");
    openThread(event.thread_id, true);
    return;
  }
  if (event.navigation_target === "thread_unavailable" || !event.event_card_ready) {
    toast("Переписка по этой заявке ещё не загружена в Core");
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
  const outboundEpoch = thread.last_outbound_epoch
    || (thread.last_direction === "outbound" ? thread.last_message_epoch : null);
  if (!outboundEpoch) return false;
  const day = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow", year: "numeric", month: "2-digit", day: "2-digit",
  });
  return day.format(new Date(Number(outboundEpoch) * 1000)) === day.format(new Date());
}

function chatStatusSets() {
  const business = state.threads.filter((thread) => !isTechnicalThread(thread));
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
    const technical = isTechnicalThread(thread);
    if (state.chatFolder === "technical") {
      if (!technical) return false;
    } else if (technical) {
      return false;
    }
    if (state.chatStatus && !statuses[state.chatStatus].has(thread.thread_id)) return false;
    if (coordination) {
      if (!coordinationThreadIds.has(thread.thread_id)) return false;
    } else {
      if (state.chatFolder === "hot" && !hot.has(thread.thread_id)) return false;
      if (!["all", "hot", "technical"].includes(state.chatFolder) && thread.business_bucket !== state.chatFolder) return false;
    }
    if (!query) return true;
    return [threadTitle(thread), thread.peer_external_id, thread.last_body, roleLabel(thread)]
      .some((value) => String(value || "").toLowerCase().includes(query));
  });
}

function renderThreadFolders() {
  const business = state.threads.filter((thread) => !isTechnicalThread(thread));
  const technical = state.threads.filter(isTechnicalThread);
  const hot = hotThreadIds();
  const counts = {
    All: business.length,
    New: business.filter((thread) => thread.business_bucket === "new").length,
    Hot: business.filter((thread) => hot.has(thread.thread_id)).length,
    Lcb: business.filter((thread) => thread.business_bucket === "lcb").length,
    Technical: technical.length,
    Personal: business.filter((thread) => thread.business_bucket === "personal").length,
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

function clearSelectedConversation() {
  state.threadRequestController?.abort();
  state.threadRequestController = null;
  state.selectedThreadId = "";
  state.selectedThread = null;
  state.selectedDraftId = "";
  state.savedCanonText = "";
  state.threadReady = false;
  setManualSendText("");
  byId("conversationContent").hidden = true;
  byId("conversationEmpty").hidden = false;
  byId("conversation").classList.remove("is-open");
  closeRoleMenu();
  renderManualSendState();
  if (location.hash.startsWith("#chat/")) history.replaceState(null, "", "#chats");
}

function renderThreads() {
  renderThreadFolders();
  syncChannelFilter();
  byId("chatSearch").value = state.query;
  renderChatStatusFilters();
  const threads = visibleThreads();
  if (
    state.selectedThreadId
    && !threads.some((thread) => thread.thread_id === state.selectedThreadId)
  ) {
    clearSelectedConversation();
  }
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
  state.savedCanonText = "";
  state.selectedThread = null;
  state.threadReady = false;
  setManualSendText("");
  byId("initialRequestPanel").hidden = true;
  byId("initialRequestPanel").open = false;
  byId("initialRequestText").textContent = "";
  byId("initialRequestMeta").textContent = "";
  markThreadReadLocally(threadId);
  renderThreads();
  const selectedThread = state.threads.find((item) => item.thread_id === threadId) || {};
  const selectedName = threadTitle(selectedThread);
  byId("conversationEmpty").hidden = true;
  byId("conversationContent").hidden = false;
  byId("conversationName").textContent = selectedName;
  byId("conversationAvatar").innerHTML = avatarContent(selectedThread, selectedName);
  byId("conversationMeta").textContent = `${selectedThread.handle ? `@${selectedThread.handle}` : selectedThread.peer_external_id || "—"} · ${channelLabel(selectedThread.channel)} · загрузка переписки`;
  renderConversationRole(selectedThread);
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
    renderConversationRole(thread);
    const initialRequest = payload.initial_request;
    if (initialRequest?.text) {
      byId("initialRequestPanel").hidden = false;
      byId("initialRequestText").textContent = initialRequest.text;
      byId("initialRequestMeta").textContent = `Первое входящее · ${formatDate(initialRequest.started_at_epoch)} · сообщений: ${(initialRequest.message_ids || []).length}`;
    }
    let previousDay = "";
    const historyHtml = (payload.messages || []).map((message) => {
      const day = dateKey(message.sent_at_epoch);
      const divider = day !== previousDay ? `<div class="message-day">${escapeHtml(formatDate(message.sent_at_epoch, { dateOnly: true }))}</div>` : "";
      previousDay = day;
      return `${divider}<div class="message ${message.direction === "outbound" ? "outbound" : ""}">${escapeHtml(message.body || "[медиа без текста]")}<div class="message-meta">${escapeHtml(message.direction)} · ${escapeHtml(formatDate(message.sent_at_epoch))}</div></div>`;
    }).join("");
    const scheduledHtml = (payload.scheduled_messages || []).map((message) => {
      const isWaiting = message.status === "queued" && !message.released;
      const statusLabel = isWaiting
        ? `◷ Отправится в ${new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Moscow" }).format(new Date(Number(message.send_at_epoch) * 1000))}`
        : message.status === "claimed"
          ? "Отправляется"
          : `Не отправлено · ${message.status}`;
      const sendNow = isWaiting
        ? `<button type="button" class="scheduled-send-now" data-scheduled-now="${escapeHtml(message.command_id)}" title="Убрать ожидание и отправить сейчас" aria-label="Убрать ожидание и отправить сейчас">×</button>`
        : "";
      const error = message.error ? `<div class="scheduled-error">${escapeHtml(message.error)}</div>` : "";
      return `<div class="message outbound scheduled-message ${isWaiting ? "is-waiting" : "is-failed"}">${escapeHtml(message.body)}<div class="scheduled-meta"><span>${escapeHtml(statusLabel)}</span>${sendNow}</div>${error}</div>`;
    }).join("");
    const draft = (payload.drafts || []).find((item) => !item.is_superseded && !item.is_dismissed);
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
      const dismiss = `<button type="button" data-draft-dismiss="${escapeHtml(draft.draft_id)}">Удалить</button>`;
      const scenario = draft.rewrite_constraints?.ai_scenario_type || draft.scenario_type || "other";
      draftHtml = `<section class="draft-message ${draft.is_stale ? "is-stale" : ""}" data-draft-id="${escapeHtml(draft.draft_id)}"><div class="draft-message-head"><strong>Черновик V2</strong><span>${escapeHtml(status)}</span></div><div class="draft-message-text">${escapeHtml(detail)}</div><div class="draft-message-foot"><small>${escapeHtml(scenario)}${violations.length ? ` · замечаний стиля: ${violations.length}` : ""}</small><span>${dismiss}${action}</span></div></section>`;
    }
    byId("messageList").innerHTML = historyHtml || scheduledHtml || draftHtml
      ? `${historyHtml}${scheduledHtml}${draftHtml}`
      : '<div class="empty-state"><strong>В треде нет сообщений</strong>Core хранит только сам тред.</div>';
    byId("messageList").querySelectorAll("[data-draft-use]").forEach((button) => {
      button.addEventListener("click", () => {
        const selected = (payload.drafts || []).find((item) => item.draft_id === button.dataset.draftUse);
        if (!selected?.text || selected.is_stale) return;
        state.selectedDraftId = selected.draft_id;
        state.savedCanonText = "";
        setManualSendText(selected.text);
        renderManualSendState();
        byId("manualSendText").focus();
      });
    });
    byId("messageList").querySelectorAll("[data-draft-dismiss]").forEach((button) => {
      button.addEventListener("click", async () => {
        if (state.dismissingDraft) return;
        const draftId = button.dataset.draftDismiss;
        if (!window.confirm("Удалить этот черновик из рабочего окна?")) return;
        state.dismissingDraft = true;
        button.disabled = true;
        try {
          await apiPost(API.dismissDraft, { draft_id: draftId, thread_id: threadId });
          if (state.selectedDraftId === draftId) {
            state.selectedDraftId = "";
            state.savedCanonText = "";
            setManualSendText("");
          }
          toast("Черновик удалён.");
          await openThread(threadId, false);
        } catch (error) {
          toast(`Черновик не удалён: ${error.message}`);
        } finally {
          state.dismissingDraft = false;
        }
      });
    });
    byId("messageList").querySelectorAll("[data-scheduled-now]").forEach((button) => {
      button.addEventListener("click", async () => {
        if (state.sendingScheduledNow) return;
        if (!window.confirm("Отправить это сообщение сейчас, не дожидаясь 08:00 МСК?")) return;
        state.sendingScheduledNow = true;
        button.disabled = true;
        try {
          const result = await apiPost(API.sendScheduledNow, {
            thread_id: threadId,
            command_id: button.dataset.scheduledNow,
          });
          toast(result.core_recorded === false
            ? result.warning || "Telegram доставил, Core требует сверки receipt."
            : "Сообщение отправлено сейчас и записано в Core.");
          await refreshAll();
          await openThread(threadId, false);
        } catch (error) {
          toast(error.message);
          button.disabled = false;
        } finally {
          state.sendingScheduledNow = false;
        }
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
  const sendButton = byId("manualSendButton");
  const rewriteButton = byId("rewriteDraftButton");
  const canonButton = byId("saveCanonButton");
  const currentText = text.value.trim();
  const hasText = Boolean(currentText);
  const hasDraft = Boolean(state.selectedDraftId);
  const busy = state.sending || state.rewritingDraft || state.savingCanon;
  form.classList.toggle("is-enabled", enabled);
  text.disabled = !enabled || busy;
  sendButton.disabled = !enabled || busy || !hasText;
  sendButton.setAttribute("aria-disabled", String(sendButton.disabled));
  rewriteButton.hidden = !hasDraft;
  rewriteButton.disabled = !enabled
    || !state.health?.draft_rewrite_enabled
    || busy
    || !hasText;
  rewriteButton.setAttribute("aria-disabled", String(rewriteButton.disabled));
  rewriteButton.textContent = state.rewritingDraft ? "Переписываю…" : "Переписать текст";
  canonButton.hidden = !hasDraft;
  canonButton.disabled = !enabled || busy || !hasText || state.savedCanonText === currentText;
  canonButton.setAttribute("aria-disabled", String(canonButton.disabled));
  canonButton.textContent = state.savingCanon
    ? "Сохраняю…"
    : state.savedCanonText === currentText && hasText
      ? "Канон сохранён"
      : "Сохранить как канон";
  byId("manualSendNote").textContent = enabled
    ? state.selectedDraftId
      ? "Выбран черновик V2. Проверь текст: отправка произойдёт только после твоего нажатия."
      : "Ручной текст уйдёт дословно через единственного Telegram-отправщика. Автоответы остаются в HOLD."
    : "Ручная отправка выключена конфигурацией Core. Автоответы остаются в HOLD.";
}

function resizeManualSendText() {
  const field = byId("manualSendText");
  if (!field) return;
  field.style.height = "auto";
  field.style.height = `${Math.max(42, field.scrollHeight + 2)}px`;
}

function setManualSendText(value) {
  const field = byId("manualSendText");
  field.value = value;
  resizeManualSendText();
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
    setManualSendText("");
    state.selectedDraftId = "";
    state.savedCanonText = "";
    if (result.scheduled === true) {
      toast("Сообщение поставлено на отправку в 08:00 МСК.");
    } else if (result.core_recorded === false) {
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

async function rewriteSelectedDraft() {
  if (
    state.rewritingDraft
    || state.sending
    || state.savingCanon
    || !state.health?.draft_rewrite_enabled
    || !state.threadReady
    || !state.selectedThreadId
    || !state.selectedDraftId
  ) return;
  const field = byId("manualSendText");
  const text = field.value.trim();
  if (!text) return;
  const threadId = state.selectedThreadId;
  const draftId = state.selectedDraftId;
  state.rewritingDraft = true;
  renderManualSendState();
  try {
    const result = await apiPost(
      API.rewriteDraft,
      {
        thread_id: threadId,
        draft_id: draftId,
        text,
      },
      {
        timeoutMs: 55_000,
        timeoutMessage: (
          "Сервис переписывания не ответил вовремя. Исходный текст сохранён; "
          + "ничего не отправлено."
        ),
      },
    );
    if (state.selectedThreadId === threadId && state.selectedDraftId === draftId) {
      setManualSendText(result.text);
      state.savedCanonText = "";
    }
    toast("Текст переписан. Ничего не отправлено.");
  } catch (error) {
    toast(`Текст не переписан: ${error.message}`);
  } finally {
    state.rewritingDraft = false;
    renderManualSendState();
  }
}

async function saveSelectedDraftAsCanon() {
  if (
    state.savingCanon
    || state.sending
    || !state.threadReady
    || !state.selectedThreadId
    || !state.selectedDraftId
  ) return;
  const field = byId("manualSendText");
  const text = field.value.trim();
  if (!text) return;
  const threadId = state.selectedThreadId;
  const draftId = state.selectedDraftId;
  state.savingCanon = true;
  renderManualSendState();
  try {
    await apiPost(API.saveCanon, {
      thread_id: threadId,
      draft_id: draftId,
      text,
    });
    if (state.selectedThreadId === threadId && state.selectedDraftId === draftId) {
      state.savedCanonText = text;
    }
    toast("Сохранено как канон. Сообщение не отправлено.");
  } catch (error) {
    toast(`Канон не сохранён: ${error.message}`);
  } finally {
    state.savingCanon = false;
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
  const autonomy = state.autonomy || {};
  const autonomyConfig = AUTONOMY_MODES[autonomy.mode] || AUTONOMY_MODES.approval_required;
  const rows = [
    ["Runtime", health.runtime_mode || "unknown"],
    ["Legacy fallback", health.legacy_fallback ? "включён" : "нет"],
    ["Черновики V2", health.draft_write_enabled ? "включены" : "выключены"],
    ["Отправка", health.send_enabled ? "включена" : "выключена"],
    ["Автоотправка", health.agent_send_enabled ? "включена" : "HOLD"],
    ["Режим общения", autonomyConfig.label],
    ["Telegram transport", autonomy.transport_mode || health.telegram_transport_mode || "hold"],
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

function formatFeeAmount(amountMinor, currency = "RUB") {
  if (amountMinor === null || amountMinor === undefined) return "Не задано";
  return `${formatNumber(Number(amountMinor) / 100)} ${currency}`;
}

function renderFees() {
  const payload = state.fees || { columns: [], products: [], historical_sources: [], currency: "RUB" };
  const columns = payload.columns || [];
  byId("feesCurrency").textContent = payload.currency || "RUB";
  byId("feesStatusPill").textContent = payload.policy?.active_rates_confirmed ? "Ставки активны" : "Требует подтверждения";
  byId("feesStatusPill").className = `pill ${payload.policy?.active_rates_confirmed ? "ok" : "hold"}`;
  byId("feesHead").innerHTML = `<tr><th>Категория</th>${columns.map((column) => `<th>${escapeHtml(column.label)}</th>`).join("")}</tr>`;
  byId("feesBody").innerHTML = (payload.products || []).map((product) => `<tr><th><strong>${escapeHtml(product.label)}</strong><small>${escapeHtml(product.description)}</small></th>${columns.map((column) => `<td><span class="fee-value ${product.usable_for_auto_quote ? "is-active" : "is-unconfirmed"}">${escapeHtml(formatFeeAmount(product.rates?.[column.id], payload.currency))}</span></td>`).join("")}</tr>`).join("");
  byId("feesHistory").innerHTML = (payload.historical_sources || []).map((source) => `<article class="fee-history"><div><strong>${escapeHtml(source.title)}</strong><span class="pill hold">Историческое · не использовать автоматически</span></div><p>${escapeHtml(source.note)}</p><div class="fee-role-grid">${(source.role_rates || []).map((item) => `<span><b>${escapeHtml(item.role)}</b>${escapeHtml(formatFeeAmount(item.amount_minor, payload.currency))}</span>`).join("")}</div></article>`).join("") || '<div class="empty-state">Источники ставок ещё не добавлены.</div>';
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
    const results = await Promise.allSettled([
      apiGet(API.health),
      apiGet(API.autonomy),
      apiGet(API.summary),
      apiGet(API.fees),
      apiGet(`${API.threads}?limit=200`),
      apiGet(API.coordinationCases),
      apiGet(API.work),
      apiGet(API.operations),
    ]);
    const [healthResult, autonomyResult, summaryResult, feesResult, threadsResult, coordinationResult, workResult, operationsResult] = results;
    if (healthResult.status !== "fulfilled" || threadsResult.status !== "fulfilled") {
      const failure = healthResult.status === "rejected" ? healthResult.reason : threadsResult.reason;
      throw failure instanceof Error ? failure : new Error(String(failure || "Core read failed"));
    }
    const health = healthResult.value;
    const threadsPayload = threadsResult.value;
    state.health = health;
    if (autonomyResult.status === "fulfilled") state.autonomy = autonomyResult.value;
    if (summaryResult.status === "fulfilled") state.summary = summaryResult.value;
    if (feesResult.status === "fulfilled") state.fees = feesResult.value;
    state.threads = threadsPayload.threads || [];
    if (state.selectedThreadId) {
      const refreshedThread = state.threads.find(
        (item) => item.thread_id === state.selectedThreadId,
      );
      if (refreshedThread) {
        state.selectedThread = { ...(state.selectedThread || {}), ...refreshedThread };
        renderConversationRole(state.selectedThread);
      }
    }
    if (coordinationResult.status === "fulfilled") {
      state.coordinationCases = coordinationResult.value.cases || [];
    }
    if (workResult.status === "fulfilled") state.work = workResult.value;
    if (operationsResult.status === "fulfilled") state.operations = operationsResult.value;
    renderCalendar();
    renderThreads();
    renderToday();
    renderSystem();
    renderFees();
    renderBroadcast();
    renderAutonomy();
    renderManualSendState();
    updateCounts();
    const partial = results.some((result, index) => ![0, 4].includes(index) && result.status === "rejected");
    setConnection(
      health.ok ? "ok" : "error",
      health.ok ? (partial ? "Core доступен · часть данных" : "Core доступен") : "Core неполон",
    );
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
    filterStageFollowupCold: "followup_cold",
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
  byId("manualSendText").addEventListener("input", () => {
    resizeManualSendText();
    renderManualSendState();
  });
  byId("rewriteDraftButton").addEventListener("click", rewriteSelectedDraft);
  byId("saveCanonButton").addEventListener("click", saveSelectedDraftAsCanon);
  byId("conversationRole").addEventListener("click", (event) => {
    event.stopPropagation();
    const menu = byId("conversationRoleMenu");
    menu.hidden = !menu.hidden;
    byId("conversationRole").setAttribute("aria-expanded", String(!menu.hidden));
  });
  byId("conversationRoleMenu").addEventListener("click", (event) => event.stopPropagation());
  document.addEventListener("click", closeRoleMenu);
  document.querySelectorAll("[data-chat-status]").forEach((button) => {
    button.addEventListener("click", () => {
      const nextStatus = state.chatStatus === button.dataset.chatStatus ? "" : button.dataset.chatStatus;
      state.chatStatus = nextStatus;
      if (nextStatus) state.chatFolder = "all";
      renderThreads();
    });
  });
  byId("refreshButton").addEventListener("click", refreshAll);
  byId("autonomyButton").addEventListener("click", (event) => {
    event.stopPropagation();
    const menu = byId("autonomyMenu");
    menu.hidden = !menu.hidden;
    byId("autonomyButton").setAttribute("aria-expanded", String(!menu.hidden));
  });
  byId("autonomyMenu").addEventListener("click", (event) => event.stopPropagation());
  document.querySelectorAll("[data-autonomy-mode]").forEach((button) => {
    button.addEventListener("click", () => setAutonomyMode(button.dataset.autonomyMode));
  });
  document.addEventListener("click", closeAutonomyMenu);
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

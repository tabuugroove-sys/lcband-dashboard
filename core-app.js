"use strict";

const API = Object.freeze({
  health: "/api/core/health",
  runtimeStatus: "/api/core/runtime-status",
  autonomy: "/api/core/autonomy",
  summary: "/api/core/summary",
  fees: "/api/core/fees",
  promo: "/api/core/promo",
  costumes: "/api/core/costumes",
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
  leadFlow: "/api/app/lead_flow",
  opsmap: "/api/app/opsmap",
  opsmapReveal: "/api/app/opsmap/reveal",
});

// OpsMap Phase 2 lead-mode surface. Used by opsmap.js; explicit references keep
// the Core app contract discoverable and CSP-clean.
const OPSMAP_LEAD_API = Object.freeze({
  search: "/api/opsmap/leads/search",
  trace: "/api/opsmap/leads",
});
const OPSMAP_LEAD_SELECTORS = Object.freeze([
  "opsmap-trace-node",
  "opsmap-inferred-edge",
  "opsmap-gap-marker",
]);
const OPSMAP_LEAD_FIELDS = Object.freeze([
  "stage_conflict",
  "identity_split",
  "evidence_gaps",
]);

const state = {
  health: null,
  runtimeStatus: null,
  autonomy: null,
  summary: null,
  fees: null,
  promo: null,
  costumes: { musicians: [], stats: { total: 0, with_size: 0, with_costumes: 0, needs_confirmation: 0 } },
  calendar: { events: [], business_events: 0, technical_events: 0, model_ready: false },
  threads: [],
  coordinationCases: [],
  work: null,
  operations: null,
  leadFlow: null,
  activeView: "calendar",
  flowPeriod: 90,
  flowSource: "",
  flowQuery: "",
  flowSelected: null,
  flowLoading: false,
  flowRefreshedAt: 0,
  opsmap: null,
  opsContour: "all",
  opsPeriod: 90,
  opsEvidence: "",
  opsStopped: "",
  opsQuery: "",
  opsDepth: "process",
  opsMode: "all",
  opsSelected: null,
  opsLoading: false,
  opsRefreshedAt: 0,
  opsDisabled: false,
  opsMapSvg: null,
  opsMapLoadedDepth: null,
  opsLiveOps: null,
  opsLiveOpsLoading: false,
  opsLiveOpsRefreshedAt: 0,
  opsTelegramLoading: false,
  runtimeStatusRefreshedAt: 0,
  opsSelectedOperation: null,
  opsTraceRef: null,
  opsTechnicalVisible: true,
  activeWorkTab: "obligations",
  selectedThreadId: "",
  selectedEventId: "",
  chatFolder: "all",
  chatStatus: "",
  channel: "",
  channelThreads: {},        // channel → { rows, at }: своя выборка каждого канала
  channelThreadsPending: {}, // channel → true, пока летит запрос
  query: "",
  promoFilters: { q: "", category: "", status: "all", page: 1 },
  calendarFilters: {
    lcb: true,
    broker: false,
    performed: false,
    content_pending: false,
    content_received: false,
    prepayment: true,
    contract: true,
    confirmed: true,
    negotiating: true,
    lead: false,
    followup_waiting: false,
    followup_cold: false,
    cancelled: false,
  },
  month: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  loading: false,
  calendarLoading: false,
  calendarRefreshedAt: 0,
  promoLoading: false,
  promoRefreshedAt: 0,
  costumesLoading: false,
  costumesRefreshedAt: 0,
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
  composerDirty: false,
  manualDeliveryState: { kind: "idle", text: "Не отправлено" },
  threadReady: false,
  threadRequestController: null,
  activeThreadFingerprint: "",
  activeThreadSyncing: false,
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

const AUTONOMY_BLOCKER_LABELS = Object.freeze({
  policy_requires_approval: "выбран режим с подтверждением человеком",
  agent_dispatcher_not_deployed: "Core dispatcher автоотправки не развёрнут",
  telegram_transport_live_direct: "Telegram остаётся на legacy live_direct, Core delivery queue не владеет отправкой",
  telegram_transport_operator_only: "Telegram принимает только действия оператора",
  telegram_transport_hold: "Telegram transport находится в HOLD",
  core_unavailable: "Core недоступен",
});

function autonomyBlockerText(autonomy) {
  const details = Array.isArray(autonomy?.effective_blocker_details)
    ? autonomy.effective_blocker_details.map((item) => item?.label).filter(Boolean)
    : [];
  if (details.length) return details.join("; ");
  return (autonomy?.effective_blockers || [])
    .map((code) => AUTONOMY_BLOCKER_LABELS[code] || code)
    .filter(Boolean)
    .join("; ");
}

const CALENDAR_STAGE_LABELS = Object.freeze({
  performed: "Состоялось",
  content_pending: "Фото/видео запросить",
  content_received: "Фото/видео получены",
  prepayment: "Предоплата получена",
  contract: "Договор",
  confirmed: "Подтверждено",
  negotiating: "Отвечает / в работе",
  followup_waiting: "Ждём ответа",
  followup_cold: "Не отвечает",
  lead: "Новая заявка",
  cancelled: "Отмена",
});

const PROMO_CATEGORY_LABELS = Object.freeze({
  afro_vocalist: "Афро-вокалисты",
  animator: "Аниматоры",
  cover_band_folk: "Фолк-группы",
  cover_band_jazz: "Джазовые группы",
  dance_ethnic: "Этнические танцы",
  dance_show: "Танцевальные шоу",
  decor: "Декор",
  dj: "DJ",
  drum_show: "Барабанные шоу",
  host: "Ведущие",
  host_dj_combo: "Ведущий + DJ",
  host_female: "Ведущие девушки",
  musician_solo: "Сольные музыканты",
  photo_video: "Фото и видео",
  show_ballet: "Шоу-балеты",
  singer_guitarist: "Вокалисты-гитаристы",
  singer_pianist: "Вокалисты-пианисты",
  solo_other: "Другие сольные артисты",
  sound_rental: "Звук и оборудование",
});

const PROMO_STATUS = Object.freeze({
  client_ready: { label: "Готово клиенту", className: "ready" },
  source_only: { label: "Только исходник", className: "source" },
  needs_drive: { label: "Нужен Drive", className: "needs" },
  missing: { label: "Нет промо", className: "missing" },
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

const NAV_LAYOUT_KEY = "lcb_core_nav_layout_v1";
const DEFAULT_NAV_LAYOUT = Object.freeze({
  primary: ["calendar", "chats", "flow", "opsmap", "today", "promo", "costumes", "operations", "arbitr"],
  secondary: ["system", "fees", "tokens", "loopguard", "broadcast", "sessions"],
});
let navDrag = null;
let navDropCommitted = false;
let navSuppressClickUntil = 0;

function navLayoutFromDom() {
  const views = (zone) => [...zone.querySelectorAll(".tab-button")].map((button) => button.dataset.view);
  return Object.fromEntries([...document.querySelectorAll("[data-nav-zone]")]
    .map((zone) => [zone.dataset.navZone, views(zone)]));
}

function normalizedNavLayout(candidate = {}) {
  const known = [...document.querySelectorAll(".tab-button")].map((button) => button.dataset.view);
  const knownSet = new Set(known);
  const seen = new Set();
  const take = (values) => (Array.isArray(values) ? values : [])
    .filter((view) => knownSet.has(view) && !seen.has(view) && seen.add(view));
  const primary = take(candidate.primary);
  const secondary = take(candidate.secondary);
  known.forEach((view) => {
    if (seen.has(view)) return;
    const fallback = DEFAULT_NAV_LAYOUT.secondary.includes(view) ? secondary : primary;
    fallback.push(view);
    seen.add(view);
  });
  return { primary, secondary };
}

function savedNavLayout() {
  try {
    return normalizedNavLayout(JSON.parse(localStorage.getItem(NAV_LAYOUT_KEY) || "{}"));
  } catch {
    return normalizedNavLayout(DEFAULT_NAV_LAYOUT);
  }
}

function applyNavLayout(layout) {
  const normalized = normalizedNavLayout(layout);
  Object.entries(normalized).forEach(([zoneName, views]) => {
    const container = document.querySelector(`[data-nav-zone="${zoneName}"] .tabbar-items`);
    views.forEach((view) => {
      const button = document.querySelector(`.tab-button[data-view="${view}"]`);
      if (button) container.append(button);
    });
  });
}

function saveNavLayout() {
  try {
    localStorage.setItem(NAV_LAYOUT_KEY, JSON.stringify(navLayoutFromDom()));
  } catch {
    // Перетаскивание продолжает работать до перезагрузки даже без localStorage.
  }
}

function navInsertTarget(container, clientY) {
  return [...container.querySelectorAll(".tab-button:not(.is-dragging)")].find((button) => {
    const rect = button.getBoundingClientRect();
    return clientY < rect.top + rect.height / 2;
  }) || null;
}

function initNavLayout() {
  applyNavLayout(savedNavLayout());
  const zones = [...document.querySelectorAll("[data-nav-zone]")];
  document.querySelectorAll(".tab-button").forEach((button) => {
    button.draggable = true;
    button.title = `${button.textContent.trim()} · перетащите, чтобы изменить меню`;
    button.addEventListener("dragstart", (event) => {
      navDrag = { button, layout: navLayoutFromDom() };
      navDropCommitted = false;
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", button.dataset.view);
      requestAnimationFrame(() => button.classList.add("is-dragging"));
    });
    button.addEventListener("dragend", () => {
      if (navDrag && !navDropCommitted) applyNavLayout(navDrag.layout);
      button.classList.remove("is-dragging");
      zones.forEach((zone) => zone.classList.remove("is-drag-over"));
      navDrag = null;
      navDropCommitted = false;
    });
  });
  zones.forEach((zone) => {
    zone.addEventListener("dragover", (event) => {
      if (!navDrag) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      zones.forEach((item) => item.classList.toggle("is-drag-over", item === zone));
      const container = zone.querySelector(".tabbar-items");
      const before = navInsertTarget(container, event.clientY);
      container.insertBefore(navDrag.button, before);
    });
    zone.addEventListener("dragleave", (event) => {
      if (!zone.contains(event.relatedTarget)) zone.classList.remove("is-drag-over");
    });
    zone.addEventListener("drop", (event) => {
      if (!navDrag) return;
      event.preventDefault();
      navDropCommitted = true;
      navSuppressClickUntil = Date.now() + 250;
      saveNavLayout();
      zone.classList.remove("is-drag-over");
    });
  });
}
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
  // порядок честности: имя собеседника → его номер → сырой идентификатор.
  // 15-значный `<lid>@lid` человеку не говорит ничего, номер — говорит.
  return thread.display_name
    || formatPhone(thread.handle)
    || formatPhone(waPhoneFromPeer(thread))
    || thread.peer_external_id
    || thread.thread_id
    || "Core thread";
}

function waPhoneFromPeer(thread) {
  if (thread.channel !== "wa") return "";
  const digits = String(thread.peer_external_id || "").split("@")[0];
  // телефонный jid — это номер; lid распознаём по длине (12+ цифр)
  return /^\d{10,12}$/.test(digits) && !String(thread.peer_external_id || "").endsWith("@lid")
    ? digits
    : "";
}

function formatPhone(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 11 && (digits[0] === "7" || digits[0] === "8")) {
    return `+7 ${digits.slice(1, 4)} ${digits.slice(4, 7)}-${digits.slice(7, 9)}-${digits.slice(9)}`;
  }
  if (digits.length >= 10 && digits.length <= 15) return `+${digits}`;
  return raw.startsWith("+") ? raw : "";
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
  if (!response.ok) {
    const failure = new Error(payload.error || `HTTP ${response.status}`);
    // Код нужен вызывающему: «тред пропал» (404) и «сервер лёг» — разные
    // состояния, и показывать их одинаково значит скрыть первое.
    failure.status = response.status;
    throw failure;
  }
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

function threadPreview(thread) {
  // «Нет сообщений» у чата, где сообщения есть, — прямая ложь: в WhatsApp
  // последним часто идёт фото/голосовое без подписи (кейс 04.08)
  const body = String(thread.last_body || "").trim();
  if (body) return body;
  if (thread.last_media_ref || Number(thread.message_count) > 0) return "[вложение]";
  return "Нет сообщений";
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

function setManualDeliveryState(kind, text) {
  state.manualDeliveryState = {
    kind: String(kind || "idle"),
    text: String(text || "Не отправлено"),
  };
  renderManualDeliveryState();
}

function renderManualDeliveryState() {
  const element = byId("manualSendStatus");
  const label = byId("manualSendStatusText");
  if (!element || !label) return;
  const current = state.manualDeliveryState || { kind: "idle", text: "Не отправлено" };
  const icons = {
    idle: "○",
    draft: "✎",
    sending: "…",
    queued: "◷",
    sent: "✓✓",
    error: "!",
  };
  element.className = `composer-status is-${current.kind}`;
  element.querySelector(".composer-status-icon").textContent = icons[current.kind] || "○";
  label.textContent = current.text;
}

function deliveryErrorState(message) {
  const value = String(message || "");
  return /(unknown|claimed|ambiguous|не подтвержд)/i.test(value)
    ? { kind: "error", text: "Доставка не подтверждена" }
    : { kind: "error", text: "Не отправлено" };
}

function setConnection(kind, label) {
  byId("connectionDot").className = `status-dot ${kind === "ok" ? "is-ok" : kind === "error" ? "is-error" : ""}`;
  byId("connectionLabel").textContent = label;
}

function runtimeStatusLabel(status) {
  return {
    online: "Работает",
    degraded: "Частично",
    offline: "Не работает",
    unknown: "Нет данных",
    connected: "Связь есть",
    disconnected: "Нет связи",
  }[status] || "Проверка";
}

function readinessStatusLabel(status) {
  return {
    FULLY_READY: "Полностью готова",
    RECOVERING: "Восстанавливается",
    DEGRADED: "Работает частично",
    OFFLINE: "Не работает",
  }[status] || "Нет доказательств";
}

function readinessChipState(status) {
  return {
    FULLY_READY: "online",
    RECOVERING: "recovering",
    DEGRADED: "degraded",
    OFFLINE: "offline",
  }[status] || "unknown";
}

const READINESS_REASON_TEXT = Object.freeze({
  private_dm_recovery_unproven: "Event Chats восстановлены, но исторический догон личных Telegram DM намеренно отключён. Новые DM продолжают поступать через NewMessage; полная recovery-проверка всей системы поэтому не заявляется.",
  telegram_private_dm_catchup_disabled: "Исторический догон личных Telegram DM отключён; это ограничение покрытия, а не остановка Event Chats.",
  v1_offline: "Критические процессы V1 не работают.",
  v1_degraded: "Работает только часть критических процессов V1.",
  v1_unknown: "launchctl не подтвердил состояние критических процессов V1.",
});

function runtimeReadinessReason(readiness) {
  const codes = [...(readiness.reason_codes || []), ...(readiness.not_covered || [])];
  const translated = [...new Set(codes)].map((code) => READINESS_REASON_TEXT[code] || `Неподтверждённая граница: ${code}`);
  if (translated.length) return translated.join(" ");
  if (String(readiness.state || "") === "FULLY_READY") {
    return "Все обязательные для текущего контура источники перечислены; processing/read residual равны нулю.";
  }
  return "Backend не передал конкретную причину; обновите статус и проверьте Операции → Процессы.";
}

function renderRuntimeExplanation() {
  const runtime = state.runtimeStatus || {};
  const processes = runtime.processes || {};
  const readiness = runtime.readiness || {};
  const running = Number(processes.running || 0);
  const stopped = Number(processes.stopped || 0);
  const stoppedNames = (processes.items || [])
    .filter((item) => item.state === "stopped")
    .map((item) => item.name || item.label);
  const ignored = (processes.ignored_retired || []).map((item) => item.label);
  const scopeTitle = byId("runtimeProcessScopeTitle");
  const scopeText = byId("runtimeProcessScopeText");
  const reasonTitle = byId("runtimeReadinessReasonTitle");
  const reasonText = byId("runtimeReadinessReasonText");
  const pill = byId("runtimeExplainerState");
  if (!scopeTitle || !scopeText || !reasonTitle || !reasonText || !pill) return;
  scopeTitle.textContent = `${running} работают · ${stopped} остановлены`;
  scopeText.textContent = processes.error
    ? "launchctl недоступен — список постоянных процессов не подтверждён."
    : `Считаются только KeepAlive LaunchAgents, то есть реальные долгоживущие PID. Задачи по расписанию и AI-purpose из «Токенов» сюда не входят.`
      + `${stoppedNames.length ? ` Остановлены: ${stoppedNames.join(", ")}.` : ""}`
      + `${ignored.length ? ` Выведенные из эксплуатации plist исключены: ${ignored.join(", ")}.` : ""}`;
  const readinessState = String(readiness.state || "DEGRADED");
  reasonTitle.textContent = readinessState === "FULLY_READY" ? "Почему система готова" : "Почему статус частичный";
  reasonText.textContent = runtimeReadinessReason(readiness);
  pill.textContent = readinessStatusLabel(readinessState);
  pill.className = `pill ${readinessState === "FULLY_READY" ? "ok" : "hold"}`;
}

function openRuntimeControls() {
  location.hash = "operations";
  window.setTimeout(() => window.CoreParity?.activate("runtime"), 0);
}

function runtimeAgeLabel(seconds) {
  if (!Number.isFinite(Number(seconds))) return "время синхронизации неизвестно";
  const value = Number(seconds);
  if (value < 90) return "копия только что";
  if (value < 3600) return `копия ${Math.floor(value / 60)} мин назад`;
  if (value < 86400) return `копия ${Math.floor(value / 3600)} ч назад`;
  return `копия ${Math.floor(value / 86400)} дн назад`;
}

function setRuntimeChip(id, status, title) {
  const element = byId(id);
  if (!element) return;
  const classStatus = ["online", "recovering", "degraded", "offline"].includes(status) ? status : "unknown";
  const variants = ["runtime-readiness", "runtime-processes", "runtime-metric"]
    .filter((name) => element.classList.contains(name));
  element.className = ["runtime-chip", ...variants, `is-${classStatus}`].join(" ");
  element.title = title || "";
}

function renderRuntimeStatus() {
  const runtime = state.runtimeStatus;
  if (!runtime) return;
  if (!runtime.readiness) {
    byId("runtimeReadinessLabel").textContent = "Нужен перезапуск";
    setRuntimeChip(
      "runtimeReadiness", "degraded",
      "Backend ещё работает на старой версии и не отдаёт доказательства recovery",
    );
    byId("runtimeCatchupLabel").textContent = "— / —";
    byId("runtimePostsLabel").textContent = "—";
    byId("runtimeRecoveredLabel").textContent = "—";
    byId("runtimeDeliveredLabel").textContent = "—";
    ["runtimeCatchup", "runtimePosts", "runtimeRecovered", "runtimeDelivered"]
      .forEach((id) => setRuntimeChip(id, "unknown", "Нет данных: backend ещё не перезапущен с recovery ledger"));
  }
  const readiness = runtime.readiness || {};
  const catchup = readiness.catchup || {};
  const counters = readiness.counters || {};
  const readinessState = String(readiness.state || "DEGRADED");
  if (runtime.readiness) byId("runtimeReadinessLabel").textContent = readinessStatusLabel(readinessState);
  if (runtime.readiness) setRuntimeChip(
    "runtimeReadiness",
    readinessChipState(readinessState),
    `${readinessStatusLabel(readinessState)} · контур ${readiness.scope || "не подтверждён"}`
      + `${readiness.full_system ? "" : " · полная система не доказана"}`
      + `${(readiness.reason_codes || []).length ? ` · ${readiness.reason_codes.join(", ")}` : ""}`,
  );
  const completedSources = Number(catchup.sources_completed || 0);
  const totalSources = Number(catchup.sources_total || 0);
  if (runtime.readiness) byId("runtimeCatchupLabel").textContent = `${completedSources} / ${totalSources}`;
  if (runtime.readiness) setRuntimeChip(
    "runtimeCatchup",
    totalSources > 0 && completedSources === totalSources ? "online" : readinessState === "RECOVERING" ? "recovering" : "degraded",
    `Обязательные источники: ${completedSources} из ${totalSources}; processing residual ${catchup.processing_residual || 0}; read residual ${catchup.ack_residual || 0}`
      + `${(catchup.pending_sources || []).length ? ` · ждём: ${catchup.pending_sources.join(", ")}` : ""}`,
  );
  const windowMark = readiness.complete_window ? "" : "*";
  const posts = Number(counters.posts_processed_24h || 0);
  const pitches = Number(counters.client_pitches_delivered_24h || 0);
  if (runtime.readiness) byId("runtimePostsLabel").textContent = `${formatNumber(posts)}${windowMark} / ${formatNumber(pitches)}`;
  if (runtime.readiness) setRuntimeChip(
    "runtimePosts", readiness.complete_window ? "online" : "degraded",
    `${formatNumber(posts)} уникальных постов с terminal processing result`
      + ` · ${formatNumber(pitches)} клиентских питчей с provider delivery receipt`
      + (readiness.complete_window
        ? " · скользящие 24 часа"
        : " · окно постов ещё неполное; показана доступная часть ledger"),
  );
  if (runtime.readiness) byId("runtimeRecoveredLabel").textContent = formatNumber(counters.recovery_unread_processed || 0);
  if (runtime.readiness) setRuntimeChip(
    "runtimeRecovered", readinessState === "RECOVERING" ? "recovering" : "online",
    "Посты, которые были непрочитанными при открытии текущего recovery-cycle и получили terminal processing result",
  );
  const messages = Number(counters.client_messages_delivered_24h || 0);
  if (runtime.readiness) byId("runtimeDeliveredLabel").textContent = `${pitches} · ${messages}`;
  if (runtime.readiness) setRuntimeChip(
    "runtimeDelivered",
    Number(counters.delivery_audience_unknown_24h || 0) > 0 ? "degraded" : "online",
    `${pitches} клиентских питчей · ${messages} provider-сообщений с точным delivery receipt`
      + ` · всего receipts ${counters.delivery_receipts_total_24h || 0}`
      + ` · audience не доказана ${counters.delivery_audience_unknown_24h || 0}`,
  );
  const processes = runtime.processes || {};
  byId("runtimeRunning").textContent = Number.isFinite(Number(processes.running)) ? String(processes.running) : "—";
  byId("runtimeStopped").textContent = Number.isFinite(Number(processes.stopped)) ? String(processes.stopped) : "—";
  const processState = processes.error ? "unknown" : Number(processes.stopped) > 0 ? "degraded" : "online";
  const stoppedNames = (processes.items || [])
    .filter((item) => item.state === "stopped")
    .map((item) => item.name || item.label);
  const ignoredRetired = (processes.ignored_retired || []).map((item) => item.label);
  setRuntimeChip(
    "runtimeProcesses",
    processState,
    processes.error
      ? "launchctl недоступен — число процессов не подтверждено"
      : `${processes.running || 0} KeepAlive LaunchAgents работают, ${processes.stopped || 0} остановлены.`
        + `${stoppedNames.length ? ` Остановлены: ${stoppedNames.join(", ")}.` : ""}`
        + `${ignoredRetired.length ? ` Retired исключены: ${ignoredRetired.join(", ")}.` : ""}`
        + " AI-purpose из меню «Токены» не являются отдельными PID.",
  );

  const v1 = runtime.projects?.v1 || {};
  byId("runtimeV1Label").textContent = runtimeStatusLabel(v1.status);
  setRuntimeChip("runtimeV1", v1.status, `V1 локально: ${v1.running_critical || 0} из ${v1.critical_total || 0} критических процессов работают`);

  const v2 = runtime.projects?.v2 || {};
  byId("runtimeV2Label").textContent = runtimeStatusLabel(v2.status);
  setRuntimeChip("runtimeV2", v2.status, `V2 на сервере: ${runtimeAgeLabel(v2.replica_age_seconds)}; режим ${v2.runtime_mode || "не подтверждён"}`);

  const ssh = runtime.ssh || {};
  byId("runtimeSshLabel").textContent = runtimeStatusLabel(ssh.status);
  setRuntimeChip(
    "runtimeSsh",
    ssh.status === "connected" ? "online" : ssh.status === "disconnected" ? "offline" : "unknown",
    ssh.status === "connected"
      ? `SSH подключён${Number.isFinite(Number(ssh.latency_ms)) ? ` · ${ssh.latency_ms} мс` : ""}`
      : `SSH: ${ssh.reason || "состояние неизвестно"}`,
  );
  renderRuntimeExplanation();
  renderOpsmapTelegramMonitor();
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
  const agentSendEnabled = autonomy.agent_send_enabled === true;
  const blocker = autonomyBlockerText(autonomy);
  const autonomyButton = byId("autonomyButton");
  const autonomyNotice = byId("autonomyRuntimeNotice");
  byId("autonomyCaption").textContent = agentSendEnabled
    ? "Режим агента"
    : `Выбрано: ${config.label}`;
  byId("autonomyLabel").textContent = agentSendEnabled
    ? config.label
    : "АВТООТПРАВКА ВЫКЛ";
  autonomyButton.querySelector(".autonomy-icon").textContent = agentSendEnabled ? config.icon : "⏸";
  autonomyButton.classList.toggle("is-blocked", !agentSendEnabled);
  autonomyButton.disabled = state.changingAutonomy;
  autonomyButton.title = agentSendEnabled
    ? `${config.description}. Автоответы доступны.`
    : `Выбран режим «${config.label}», но Core не отправляет автоматически: ${blocker || "HOLD"}.`;
  autonomyButton.setAttribute("aria-label", autonomyButton.title);
  autonomyNotice.textContent = agentSendEnabled
    ? `Фактически: Core может автоматически отправлять обычные текстовые ответы в режиме «${config.label}».`
    : `Фактически: Core не отправляет автоматически. ${blocker || "Действует HOLD."}`;
  autonomyNotice.classList.toggle("is-blocked", !agentSendEnabled);
  document.querySelectorAll("[data-autonomy-mode]").forEach((button) => {
    const selected = button.dataset.autonomyMode === autonomy.mode;
    button.classList.toggle("is-selected", selected);
    button.setAttribute("aria-checked", String(selected));
    button.disabled = state.changingAutonomy;
  });
  if (agentSendEnabled) {
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
    const selectedLabel = AUTONOMY_MODES[state.autonomy.mode].label;
    toast(state.autonomy.agent_send_enabled
      ? `Режим агента: ${selectedLabel}. Core автоотправка включена.`
      : `Режим «${selectedLabel}» выбран, но Core автоотправка не включена: ${autonomyBlockerText(state.autonomy) || "HOLD"}.`);
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

async function setView(view) {
  state.activeView = view;
  document.querySelectorAll(".tab-button").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.view === view);
  });
  document.querySelectorAll(".screen").forEach((screen) => {
    screen.classList.toggle("is-active", screen.id === `screen-${view}`);
  });
  byId("globalSearchWrap").hidden = !["calendar", "chats", "promo", "costumes"].includes(view);
  byId("globalSearch").value = view === "promo" ? state.promoFilters.q : state.query;
  byId("globalSearch").placeholder = view === "promo"
    ? "Поиск: артист, @username, категория…"
    : view === "costumes"
      ? "Поиск: музыкант, размер, тип костюма…"
      : "Поиск: контакт, событие…";
  if (view === "calendar") {
    renderCalendar();
    refreshCalendar();
  }
  if (view === "chats") renderThreads();
  if (view === "flow") {
    renderFlow();
    refreshFlow();
  }
  if (view === "opsmap") {
    await renderOpsmap();
    refreshOpsmap();
    startOpsmapLivePolling();
  } else {
    stopOpsmapLivePolling();
  }
  if (view === "today") renderToday();
  if (view === "system") renderSystem();
  if (view === "tokens") renderTokens();
  if (view === "loopguard") renderLoopGuard();
  if (view === "fees") renderFees();
  if (view === "costumes") {
    renderCostumes();
    refreshCostumes();
  }
  if (view === "promo") {
    renderPromo();
    refreshPromo();
  }
  if (view === "operations") window.CoreParity?.activate("overview");
  if (view === "broadcast") renderBroadcast();
  if (view === "sessions") refreshSessions();
  if (view === "arbitr") renderArbitr();
}

async function route() {
  const raw = (location.hash || "#calendar").slice(1);
  const slash = raw.indexOf("/");
  const name = slash === -1 ? raw : raw.slice(0, slash);
  const argument = slash === -1 ? "" : decodeURIComponent(raw.slice(slash + 1));
  if (name === "event") {
    await setView("calendar");
    if (argument) await openEvent(argument, false);
    return;
  }
  if (name === "chat") {
    await setView("chats");
    if (argument) openThread(argument, false);
    return;
  }
  const view = ["calendar", "chats", "flow", "opsmap", "today", "system", "tokens", "loopguard", "fees", "promo", "costumes", "operations", "broadcast", "sessions", "arbitr"].includes(name)
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
  await setView(view);
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
  const selectedBusinessLines = [
    filters.lcb ? "lcb" : null,
    filters.broker ? "broker" : null,
  ].filter(Boolean);

  // The calendar has two business lines. Selecting another line expands the
  // result set; requests/jobs are records inside a line, not extra filters.
  if (event.is_technical || !selectedBusinessLines.includes(businessLine)) return false;

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
    filterCancelled: "cancelled",
    filterStagePerformed: "performed",
    filterStageContentPending: "content_pending",
    filterStageContentReceived: "content_received",
    filterStagePrepayment: "prepayment",
    filterStageContract: "contract",
    filterStageConfirmed: "confirmed",
    filterStageNegotiating: "negotiating",
    filterStageLead: "lead",
    filterStageFollowupWaiting: "followup_waiting",
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
    button.addEventListener("click", async () => await openEvent(button.dataset.eventId));
  });
  const undated = visibleEvents.filter((event) => !event.event_date);
  byId("undatedCount").textContent = formatNumber(undated.length);
  byId("undatedList").innerHTML = undated.length
    ? undated.map((event) => `<button class="undated-item" data-event-id="${escapeHtml(event.calendar_id || event.occurrence_id)}"><strong>${escapeHtml(eventTitle(event))}</strong><span>${event.business_line === "broker" ? "Broker" : "LCBand"} · ${escapeHtml(funnelStageLabel(event))}</span></button>`).join("")
    : '<div class="calendar-empty-note">По выбранным фильтрам записей без даты нет</div>';
  byId("undatedList").querySelectorAll("[data-event-id]").forEach((button) => {
    button.addEventListener("click", async () => await openEvent(button.dataset.eventId));
  });
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
  const checklistProjection = event.event_checklist || { items: [], done_count: 0, total_count: 0 };
  const checklist = checklistProjection.items || [];
  byId("eventChecklistScore").textContent = `${checklistProjection.done_count || 0}/${checklistProjection.total_count || checklist.length}`;
  byId("eventChecklist").innerHTML = checklist.map((item) => {
    const status = item.status === "done" ? "done" : item.status === "waiting" ? "wait" : "gap";
    const marker = status === "done" ? "✓" : status === "wait" ? "…" : "!";
    return `<div class="check-row ${status}"><span class="check-dot">${marker}</span><div><strong>${escapeHtml(item.label)}</strong><small>${escapeHtml(item.detail)}</small></div></div>`;
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

async function openEvent(occurrenceId, updateHash = true) {
  const event = (state.calendar.events || []).find((item) => (item.calendar_id || item.occurrence_id) === occurrenceId);
  if (!event) {
    if (state.loading) return;
    toast("Событие не найдено в Core");
    return;
  }
  if (event.navigation_target === "thread") {
    await setView("chats");
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

function threadFunnelStage(thread) {
  const uname = String(thread?.username || thread?.display_name || "").replace(/^@/, "").toLowerCase();
  const fv = state.funnelView || {};
  if (uname && fv.lcb_stage_by_user && fv.lcb_stage_by_user[uname]) return fv.lcb_stage_by_user[uname];
  return String(thread?.funnel_stage || "");
}

function threadAttention(thread) {
  const uname = String(thread?.username || thread?.display_name || "").replace(/^@/, "").toLowerCase();
  return uname ? ((state.funnelView || {}).attention || {})[uname] : null;
}


function threadAttentionHtml(thread) {
  const att = threadAttention(thread);
  if (!att) return "";
  const bits = [];
  if (att.silence_days !== null && att.silence_days !== undefined && att.silence_days !== "")
    bits.push(`<span class="att-chip">тишина ${escapeHtml(String(Math.round(Number(att.silence_days) * 10) / 10))}д</span>`);
  if (att.next_label)
    bits.push(`<span class="att-chip ${att.overdue ? "is-overdue" : ""}">след: ${escapeHtml(att.next_label)}</span>`);
  if (att.ai_action) bits.push(`<span class="att-chip is-ai">${escapeHtml(att.ai_action)}</span>`);
  const detail = att.why || att.detail;
  return `<span class="thread-attention">${bits.join("")}</span>`
    + (detail ? `<span class="thread-att-detail">${escapeHtml(detail)}</span>` : "");
}
// Папка канала = канал целиком, независимо от выпадающего фильтра. Общая
// выборка ограничена свежими 200 тредами (их 6.2к), поэтому историю канала
// она физически не видит: без своей серверной выборки папка врала бы.
const CHANNEL_FOLDERS = { wa: "wa" };
// выборка канала живёт 30s и перезапрашивается: папка-мессенджер не должна
// замерзать на моменте первого клика
const CHANNEL_THREADS_TTL_MS = 30000;

function effectiveChannel() {
  return CHANNEL_FOLDERS[state.chatFolder] || state.channel;
}

function channelRows(channel) {
  const entry = state.channelThreads[channel];
  return entry ? entry.rows : null;
}

function ensureChannelThreads(channel) {
  if (!channel) return;
  const entry = state.channelThreads[channel];
  if (entry && Date.now() - entry.at < CHANNEL_THREADS_TTL_MS) return;
  if (state.channelThreadsPending[channel]) return;
  state.channelThreadsPending[channel] = true;
  apiGet(`${API.threads}?limit=1000&channel=${encodeURIComponent(channel)}`)
    .then((payload) => {
      state.channelThreads[channel] = { rows: payload.threads || [], at: Date.now() };
      delete state.channelThreadsPending[channel];
      if (effectiveChannel() === channel) renderThreads();
      else renderThreadFolders(); // бейдж папки честный и без захода в неё
    })
    .catch(() => { delete state.channelThreadsPending[channel]; });
}

function threadSource() {
  const channel = effectiveChannel();
  return (channel && channelRows(channel)) || state.threads;
}

function threadMatchesFolder(thread, folder) {
  if (!folder || folder === "all") return true;
  if (CHANNEL_FOLDERS[folder]) return thread.channel === CHANNEL_FOLDERS[folder];
  if (folder.startsWith("case:")) {
    const item = state.coordinationCases.find((entry) => `case:${entry.case_id}` === folder);
    return Boolean(item && (item.participants || []).some((link) => link.thread_id === thread.thread_id));
  }
  if (folder.startsWith("funnel:")) return threadFunnelStage(thread) === folder.slice(7);
  if (folder.startsWith("broker:")) {
    const uname = String(thread?.username || thread?.display_name || "").replace(/^@/, "").toLowerCase();
    return Boolean(uname && ((state.funnelView || {}).broker_stage_by_user || {})[uname] === folder.slice(7));
  }
  if (folder === "hot") return hotThreadIds().has(thread.thread_id);
  if (folder === "new") return !readThreadIds().has(thread.thread_id) && thread.last_direction !== "outbound";
  if (folder === "technical") return isTechnicalThread(thread);
  return thread.business_bucket === folder;
}

function chatStatusSets() {
  // Фильтры обязаны считаться ВНУТРИ выбранной папки: иначе счётчики «непрочитано /
  // ждут подтверждения / отправлено» не бьются с папкой (замечание Михаила 25.07 —
  // «покликай эти три фильтра, они не соотносятся с воронкой»).
  const inFolder = threadSource().filter((thread) => threadMatchesFolder(thread, state.chatFolder));
  const business = inFolder.filter((thread) => !isTechnicalThread(thread));
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
  // Общая выборка ограничена свежими 200 тредами; выбранный канал (папкой или
  // фильтром) смотрит свою серверную выборку, иначе историческим тредам
  // канала некуда попасть.
  const channel = effectiveChannel();
  return threadSource().filter((thread) => {
    const technical = isTechnicalThread(thread);
    if (state.chatFolder === "technical") {
      if (!technical) return false;
    } else if (technical) {
      return false;
    }
    if (channel && thread.channel !== channel) return false;
    if (state.chatStatus && !statuses[state.chatStatus].has(thread.thread_id)) return false;
    // Один предикат папки и для списка, и для счётчиков фильтров: пока их было два,
    // числа над списком не соответствовали тому, что в списке лежит.
    if (state.chatFolder !== "technical" && !threadMatchesFolder(thread, state.chatFolder)) {
      return false;
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
    Team: business.filter((thread) => thread.business_bucket === "team").length,
    Technical: technical.length,
    Personal: business.filter((thread) => thread.business_bucket === "personal").length,
    Musicians: business.filter((thread) => thread.business_bucket === "musicians").length,
    Broker: business.filter((thread) => thread.business_bucket === "broker").length,
    // счёт по своей выборке канала: иначе цифра показывала бы только тех,
    // кто попал в свежие 200 общего списка (29 вместо 135, кейс 04.08)
    Wa: (channelRows("wa") || business)
      .filter((thread) => thread.channel === "wa" && !isTechnicalThread(thread)).length,
  };
  Object.entries(counts).forEach(([key, value]) => {
    const badge = byId(`folder${key}`);
    badge.textContent = formatNumber(value);
    badge.hidden = Number(value) === 0;
  });
  // Папки воронки — те, по которым мы реально ходим (статусы CRM), а не идеальная
  // схема: пустых стадий на экране быть не должно.
  const funnelSpec = ((state.funnelView || {}).lcb_folders || []).length
    ? state.funnelView.lcb_folders
    : (state.funnelFolders && state.funnelFolders.length)
    ? state.funnelFolders
    : [
        { key: "interest", label: "Интерес" },
        { key: "negotiating", label: "Переговоры" },
        { key: "prepayment", label: "Ждём предоплату" },
        { key: "won", label: "Оплатили" },
        { key: "followup", label: "Follow-up" },
        { key: "aftercare", label: "Отзыв/контент" },
      ];
  const funnelCounts = new Map();
  state.threads.forEach((thread) => {
    const stage = threadFunnelStage(thread);
    if (stage) funnelCounts.set(stage, (funnelCounts.get(stage) || 0) + 1);
  });
  byId("funnelFolders").innerHTML = funnelSpec
    .filter((item) => (item.count || funnelCounts.get(item.key) || 0) > 0)
    .map((item) => {
      const folder = `funnel:${item.key}`;
      const count = item.count || funnelCounts.get(item.key) || 0;
      return `<button class="funnel-folder ${folder === state.chatFolder ? "is-active" : ""}" data-funnel-folder="${escapeHtml(folder)}"><span class="folder-icon">₽</span><span class="folder-label">${escapeHtml(item.label)}</span><b>${formatNumber(count)}</b></button>`;
    })
    .join("");
  byId("funnelFolders").querySelectorAll("[data-funnel-folder]").forEach((button) => {
    button.addEventListener("click", () => {
      state.chatFolder = button.dataset.funnelFolder;
      state.chatStatus = "";
      renderThreads();
    });
  });
  const brokerBox = byId("brokerFolders");
  if (brokerBox) {
    const brokerSpec = ((state.funnelView || {}).broker_folders || []).filter((item) => item.count > 0);
    brokerBox.innerHTML = brokerSpec.map((item) => {
      const folder = `broker:${item.key}`;
      return `<button class="funnel-folder ${folder === state.chatFolder ? "is-active" : ""}" data-broker-folder="${escapeHtml(folder)}"><span class="folder-icon">◆</span><span class="folder-label">${escapeHtml(item.label)}</span><b>${formatNumber(item.count)}</b></button>`;
    }).join("");
    brokerBox.querySelectorAll("[data-broker-folder]").forEach((button) => {
      button.addEventListener("click", () => {
        state.chatFolder = button.dataset.brokerFolder;
        state.chatStatus = "";
        renderThreads();
      });
    });
  }
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
  // Каналы — из полного среза Core (summary), не из свежей выборки тредов:
  // канал с только историческими тредами не должен пропадать из фильтра.
  const summaryChannels = (state.summary?.channels || []).map((item) => item.channel);
  const channels = [...new Set([
    ...summaryChannels,
    ...state.threads.map((item) => item.channel),
  ])].filter(Boolean).sort();
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
  state.composerDirty = false;
  state.manualDeliveryState = { kind: "idle", text: "Не отправлено" };
  state.threadReady = false;
  state.activeThreadFingerprint = "";
  setManualSendText("");
  byId("conversationContent").hidden = true;
  byId("conversationEmpty").hidden = false;
  byId("conversation").classList.remove("is-open");
  closeRoleMenu();
  renderManualSendState();
  if (location.hash.startsWith("#chat/")) history.replaceState(null, "", "#chats");
}

function renderThreads() {
  if (!state.funnelView || Date.now() - (state.funnelViewAt || 0) > 120000) {
    apiGet("/api/app/funnel_view").then((fv) => {
      state.funnelView = fv;
      state.funnelViewAt = Date.now();
      renderThreadFolders();
    }).catch(() => {});
  }
  renderThreadFolders();
  ensureChannelThreads(effectiveChannel());
  // каналы-папки держим свежими всегда: их бейджи должны быть честными
  // до первого клика, а список — живым (TTL 30s)
  Object.values(CHANNEL_FOLDERS).forEach(ensureChannelThreads);
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
    const sourceLabel = String(thread.lead_source_label || "").trim();
    const label = coordination
      ? `${coordination.item.title} · ${coordinationRoleLabel(coordination.participant.participant_role)}`
      : [sourceLabel, channelLabel(thread.channel), roleLabel(thread)]
          .filter(Boolean)
          .join(" · ");
    return `<button class="thread-button ${thread.thread_id === state.selectedThreadId ? "is-active" : ""}" data-thread-id="${escapeHtml(thread.thread_id)}"><span class="thread-avatar">${avatarContent(thread, name)}</span><span><span class="thread-top"><span class="thread-name">${escapeHtml(name)}</span><time class="thread-time">${escapeHtml(formatDate(thread.last_message_epoch))}</time></span><span class="thread-label">${escapeHtml(label)}</span><span class="thread-preview">${escapeHtml(threadPreview(thread))}</span>${threadAttentionHtml(thread)}</span></button>`;
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

function threadPayloadFingerprint(payload) {
  return JSON.stringify({
    messages: (payload.messages || []).map((message) => [
      message.message_id || message.provider_message_id,
      message.sent_at_epoch,
      message.direction,
      message.body,
    ]),
    drafts: (payload.drafts || []).map((draft) => [
      draft.draft_id,
      draft.text,
      draft.missing_dependency,
      draft.is_stale,
      draft.is_superseded,
      draft.is_dismissed,
      draft.is_resolved_by_outbound,
    ]),
    scheduled: (payload.scheduled_messages || []).map((message) => [
      message.command_id,
      message.status,
      message.released,
      message.error,
    ]),
    offeredDates: (payload.offered_dates || []).map((item) => [
      item.event_id,
      item.event_date,
      item.funnel_stage,
      item.source_status,
    ]),
  });
}

function composerSnapshot() {
  const field = byId("manualSendText");
  return {
    text: field.value,
    selectedDraftId: state.selectedDraftId,
    savedCanonText: state.savedCanonText,
    deliveryState: { ...state.manualDeliveryState },
    focused: document.activeElement === field,
  };
}

function restoreComposerSnapshot(payload, snapshot) {
  const selectedDraft = (payload.drafts || []).find((draft) => (
    draft.draft_id === snapshot.selectedDraftId
    && !draft.is_stale
    && !draft.is_superseded
    && !draft.is_dismissed
    && !draft.is_resolved_by_outbound
  ));
  state.selectedDraftId = selectedDraft ? snapshot.selectedDraftId : "";
  state.savedCanonText = selectedDraft ? snapshot.savedCanonText : "";
  state.manualDeliveryState = { ...snapshot.deliveryState };
  state.composerDirty = Boolean(snapshot.text.trim());
  setManualSendText(snapshot.text);
  renderManualSendState();
  if (snapshot.focused) byId("manualSendText").focus({ preventScroll: true });
}

async function openThread(threadId, updateHash = true, options = {}) {
  const background = Boolean(options.background);
  if (background && (
    state.threadRequestController
    || state.sending
    || state.sendingScheduledNow
    || state.rewritingDraft
    || state.savingCanon
    || state.dismissingDraft
  )) return;
  if (updateHash) history.replaceState(null, "", `#chat/${encodeURIComponent(threadId)}`);
  const switchingThread = state.selectedThreadId !== threadId;
  const preserveComposer = background && state.composerDirty;
  const savedComposer = preserveComposer ? composerSnapshot() : null;
  const listBefore = byId("messageList");
  const distanceFromBottom = listBefore.scrollHeight - listBefore.scrollTop;
  const wasNearBottom = listBefore.scrollHeight - listBefore.scrollTop - listBefore.clientHeight < 80;
  if (!background) state.threadRequestController?.abort();
  const controller = new AbortController();
  // Вечный «Загружаю переписку» (скриншот 25.07, @dimylichka): у запроса не было
  // таймаута — зависший бэкенд оставлял спиннер навсегда, без кнопки «Повторить».
  let requestTimedOut = false;
  const requestTimer = setTimeout(() => {
    requestTimedOut = true;
    controller.abort();
  }, 20000);
  state.threadRequestController = controller;
  state.selectedThreadId = threadId;
  if (!background) {
    state.selectedDraftId = "";
    state.savedCanonText = "";
    state.composerDirty = false;
    state.selectedThread = null;
    state.threadReady = false;
    state.activeThreadFingerprint = "";
    if (switchingThread) {
      state.manualDeliveryState = { kind: "idle", text: "Не отправлено" };
    }
    setManualSendText("");
    byId("initialRequestPanel").hidden = true;
    byId("initialRequestPanel").open = false;
    byId("initialRequestText").textContent = "";
    byId("initialRequestMeta").textContent = "";
    byId("contactDatesPanel").hidden = true;
    byId("contactDatesPanel").open = false;
    byId("contactDatesCount").textContent = "";
    byId("contactDatesList").innerHTML = "";
    markThreadReadLocally(threadId);
    renderThreads();
    const selectedThread = state.threads.find((item) => item.thread_id === threadId)
      || Object.values(state.channelThreads)
        .flatMap((entry) => entry.rows)
        .find((item) => item.thread_id === threadId)
      || {};
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
  }
  try {
    const payload = await apiGet(
      `${API.messages}?thread_id=${encodeURIComponent(threadId)}&limit=200`,
      { signal: controller.signal },
    );
    if (state.selectedThreadId !== threadId) return;
    const fingerprint = threadPayloadFingerprint(payload);
    if (background && fingerprint === state.activeThreadFingerprint) return;
    state.activeThreadFingerprint = fingerprint;
    if (background && state.selectedDraftId && !savedComposer) {
      const selectedDraftStillActionable = (payload.drafts || []).some((draft) => (
        draft.draft_id === state.selectedDraftId
        && !draft.is_stale
        && !draft.is_superseded
        && !draft.is_dismissed
        && !draft.is_resolved_by_outbound
      ));
      if (!selectedDraftStillActionable) {
        state.selectedDraftId = "";
        state.savedCanonText = "";
      }
    }
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
    const offeredDates = payload.offered_dates || [];
    if (offeredDates.length) {
      byId("contactDatesPanel").hidden = false;
      byId("contactDatesPanel").open = true;
      byId("contactDatesCount").textContent = `· ${offeredDates.length}`;
      byId("contactDatesList").innerHTML = offeredDates.map((item) => {
        const source = [
          item.business_line === "broker" ? "Broker" : "LCBand",
          item.title,
        ].filter(Boolean).join(" · ");
        return `<div class="contact-date-row"><div class="contact-date-main"><strong>${escapeHtml(formatEventDate(item.event_date))}</strong><small title="${escapeHtml(source)}">${escapeHtml(source)}</small></div><span class="contact-date-stage funnel-${escapeHtml(item.funnel_stage.replaceAll("_", "-"))}">${escapeHtml(item.funnel_stage_label)}</span></div>`;
      }).join("");
    }
    let previousDay = "";
    const historyHtml = (payload.messages || []).map((message) => {
      const day = dateKey(message.sent_at_epoch);
      const divider = day !== previousDay ? `<div class="message-day">${escapeHtml(formatDate(message.sent_at_epoch, { dateOnly: true }))}</div>` : "";
      previousDay = day;
      const meta = message.direction === "outbound"
        ? `<span class="delivery-state is-sent">✓✓ Отправлено</span><span>· ${escapeHtml(formatDate(message.sent_at_epoch))}</span>`
        : `<span>${escapeHtml(formatDate(message.sent_at_epoch))}</span>`;
      return `${divider}<div class="message ${message.direction === "outbound" ? "outbound" : ""}">${escapeHtml(message.body || "[медиа без текста]")}<div class="message-meta">${meta}</div></div>`;
    }).join("");
    const scheduledHtml = (payload.scheduled_messages || []).map((message) => {
      const isWaiting = message.status === "queued" && !message.released;
      const isSending = message.status === "claimed";
      const isUnknown = message.status === "unknown";
      const statusLabel = isWaiting
        ? `В очереди · отправится в ${new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Moscow" }).format(new Date(Number(message.send_at_epoch) * 1000))}`
        : isSending
          ? "Отправляется…"
          : isUnknown
            ? "Доставка не подтверждена"
            : `Не отправлено · ${message.status}`;
      const sendNow = isWaiting
        ? `<button type="button" class="scheduled-send-now" data-scheduled-now="${escapeHtml(message.command_id)}" title="Убрать ожидание и отправить сейчас" aria-label="Убрать ожидание и отправить сейчас">×</button>`
        : "";
      const error = message.error ? `<div class="scheduled-error">${escapeHtml(message.error)}</div>` : "";
      const stateClass = isWaiting ? "is-waiting" : isSending ? "is-sending" : "is-failed";
      return `<div class="message outbound scheduled-message ${stateClass}">${escapeHtml(message.body)}<div class="scheduled-meta"><span>${escapeHtml(statusLabel)}</span>${sendNow}</div>${error}</div>`;
    }).join("");
  const draft = (payload.drafts || []).find((item) =>
    !item.is_superseded && !item.is_dismissed && !item.is_resolved_by_outbound
  );
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
      // Пустой текст = ядро решило не отвечать. Показывать это как «черновик» с
      // кнопкой «Удалить» вводит в заблуждение: в карточке лежит причина решения,
      // а не предложенный текст (кейс @a_aslanidi 25.07 — причина читалась как
      // черновик). Заголовок обязан называть решение своим именем.
      const cardTitle = draft.text ? "Черновик V2" : "Решение V2: не отвечать";
      draftHtml = `<section class="draft-message ${draft.is_stale ? "is-stale" : ""}" data-draft-id="${escapeHtml(draft.draft_id)}"><div class="draft-message-head"><strong>${escapeHtml(cardTitle)}</strong><span>${escapeHtml(status)}</span></div><div class="draft-message-text">${escapeHtml(detail)}</div><div class="draft-message-foot"><small>${escapeHtml(scenario)}${violations.length ? ` · замечаний стиля: ${violations.length}` : ""}</small><span>${dismiss}${action}</span></div></section>`;
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
        state.composerDirty = true;
        setManualSendText(selected.text);
        setManualDeliveryState("draft", "Черновик · не отправлено");
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
            state.composerDirty = false;
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
    if (!background || wasNearBottom) {
      list.scrollTop = list.scrollHeight;
    } else {
      list.scrollTop = Math.max(0, list.scrollHeight - distanceFromBottom);
    }
    byId("conversation").classList.add("is-open");
    state.threadReady = true;
    if (savedComposer) restoreComposerSnapshot(payload, savedComposer);
    renderManualSendState();
  } catch (error) {
    if (state.selectedThreadId !== threadId) return;
    if (controller.signal.aborted && !requestTimedOut) return;
    // Тред пропал из набора Core — это не сбой загрузки, а факт, и молчать о
    // нём нельзя даже при фоновом обновлении. Иначе выбранный когда-то тред
    // навсегда остаётся на заглушке «Загружаю переписку»: запрос отвечает
    // честным 404, а экран об этом не узнаёт (скриншот 02.08, «My Dubai»).
    if (error?.status === 404) {
      state.threadReady = false;
      byId("conversationMeta").textContent = "переписки нет в наборе Core";
      byId("messageList").innerHTML = '<div class="empty-state"><strong>Этой переписки нет в Core</strong>Тред был выбран раньше, но сейчас его нет в наборе. Выберите другой слева.</div>';
      renderManualSendState();
      return;
    }
    if (background) return;
    byId("messageList").innerHTML = '<div class="empty-state"><strong>Переписка не загрузилась</strong><button type="button" data-thread-retry>Повторить</button></div>';
    byId("messageList").querySelector("[data-thread-retry]")?.addEventListener("click", () => openThread(threadId, false));
    toast(`Тред не открыт: ${error.message}`);
  } finally {
    clearTimeout(requestTimer);
    if (state.threadRequestController === controller) state.threadRequestController = null;
  }
}

async function syncActiveThread() {
  if (
    document.hidden
    || state.activeView !== "chats"
    || !state.selectedThreadId
    || state.activeThreadSyncing
  ) return;
  state.activeThreadSyncing = true;
  try {
    await openThread(state.selectedThreadId, false, { background: true });
  } finally {
    state.activeThreadSyncing = false;
  }
}

function manualSendChannel() {
  return String(state.selectedThread?.channel || "");
}

function manualSendEnabledForThread() {
  // Отправка канал-зависима: tg идёт через Telegram delivery-owner, wa — через
  // WA-очередь (Baileys). Остальные каналы честно отключены, а не «включены,
  // но сервер откажет».
  const channel = manualSendChannel();
  if (channel === "wa") return Boolean(state.health?.wa_manual_send_enabled);
  if (channel === "tg") return Boolean(state.health?.manual_send_enabled);
  return false;
}

function renderManualSendState() {
  const enabled = Boolean(manualSendEnabledForThread() && state.threadReady && state.selectedThreadId);
  const form = byId("manualSendForm");
  const text = byId("manualSendText");
  const sendButton = byId("manualSendButton");
  const rewriteButton = byId("rewriteDraftButton");
  const canonButton = byId("saveCanonButton");
  const currentText = text.value.trim();
  const hasText = Boolean(currentText);
  const hasDraft = Boolean(state.selectedDraftId);
  const busy = state.sending || state.rewritingDraft || state.savingCanon;
  // подпись поля обязана называть канал, в который реально уйдёт текст:
  // в WhatsApp-чате стояло «Ручной ответ в Telegram» (кейс 04.08)
  const channel = manualSendChannel();
  text.placeholder = channel ? `Ручной ответ в ${channelLabel(channel)}` : "Ручной ответ";
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
  renderManualDeliveryState();
  const sendChannel = manualSendChannel();
  byId("manualSendNote").textContent = enabled
    ? state.selectedDraftId
      ? "Выбран черновик V2. Проверь текст: отправка произойдёт только после твоего нажатия."
      : sendChannel === "wa"
        ? "Ручной текст уйдёт дословно в WhatsApp через Baileys-мост и запишется в Core."
        : "Ручной текст уйдёт дословно через единственного Telegram-отправщика. Автоответы остаются в HOLD."
    : sendChannel && sendChannel !== "tg" && sendChannel !== "wa"
      ? "Ручная отправка для этого канала пока не поддерживается."
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
  if (state.sending || !manualSendEnabledForThread() || !state.threadReady || !state.selectedThreadId) return;
  const field = byId("manualSendText");
  const text = field.value.trim();
  if (!text) return;
  state.sending = true;
  setManualDeliveryState("sending", "Отправляем…");
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
    state.composerDirty = false;
    if (result.scheduled === true) {
      const sendAt = Number(result.send_at_epoch || 0);
      const sendAtLabel = sendAt
        ? new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Moscow" }).format(new Date(sendAt * 1000))
        : "08:00";
      setManualDeliveryState("queued", `В очереди · отправится в ${sendAtLabel}`);
      toast("Сообщение поставлено на отправку в 08:00 МСК.");
    } else if (result.core_recorded === false) {
      setManualDeliveryState("error", "Отправлено · Core сверяет receipt");
      toast(result.warning || "Сообщение доставлено, но Core требует сверки receipt.");
    } else {
      setManualDeliveryState("sent", "✓✓ Отправлено");
      toast(result.warning || "Сообщение доставлено и записано в Core.");
    }
    await refreshAll();
    await openThread(state.selectedThreadId, false);
  } catch (error) {
    const deliveryState = deliveryErrorState(error.message);
    setManualDeliveryState(deliveryState.kind, deliveryState.text);
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
        timeoutMs: 40_000,
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
    const diagnosis = String(result.rewrite_diagnosis || "").trim();
    toast(
      diagnosis
        ? `Контекст исправлен: ${diagnosis}. Ничего не отправлено.`
        : "Текст переписан. Ничего не отправлено.",
    );
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
  const telegramOwner = health.telegram_delivery_owner || {};
  const autonomyConfig = AUTONOMY_MODES[autonomy.mode] || AUTONOMY_MODES.approval_required;
  const rows = [
    ["Runtime", health.runtime_mode || "unknown"],
    ["Legacy fallback", health.legacy_fallback ? "включён" : "нет"],
    ["Черновики V2", health.draft_write_enabled ? "включены" : "выключены"],
    ["Отправка", health.send_enabled ? "включена" : "выключена"],
    ["Core автоотправка", health.agent_send_enabled ? "включена" : "НЕ ЗАПУЩЕНА"],
    ["Режим общения", autonomyConfig.label],
    ["Telegram transport", autonomy.transport_mode || health.telegram_transport_mode || "hold"],
    ["Telegram owner", telegramOwner.available
      ? `healthy · ${telegramOwner.reason || "owner_healthy"}`
      : `HOLD · ${telegramOwner.reason || "owner_state_missing"}`],
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

const TOKEN_LIMIT_PROVIDERS = ["codex", "claude", "kimi", "minimax", "antigravity"];

function tokFmt(n) {
  n = Number(n) || 0;
  if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(n >= 1e4 ? 0 : 1) + "k";
  return String(Math.round(n));
}
function usdFmt(n) {
  n = Number(n) || 0;
  return n > 0 ? "$" + n.toFixed(n < 1 ? 3 : 2) : "—";
}

const BRAIN_PROVIDER_LABELS = { claude: "Claude", codex: "Codex", antigravity: "Antigravity", kimi: "Kimi", minimax: "MiniMax M3" };

function renderProviderStatusStrip(disabledTiers) {
  const disabled = new Set(disabledTiers || []);
  const items = Object.entries(BRAIN_PROVIDER_LABELS).map(([tier, label]) => {
    const off = disabled.has(tier);
    return `<span class="provider-status ${off ? "is-off" : "is-on"}">`
      + `<span class="provider-dot" aria-hidden="true">${off ? "⊘" : "●"}</span>${escapeHtml(label)}`
      + `<small>${off ? "отключён — запросы не идут" : "активен"}</small></span>`;
  }).join("");
  return `<div class="provider-status-strip">${items}</div>`;
}

function brainChipCls(t) {
  return (t.wallet === "paid" ? "chip chip-paid" : t.tier === "kimi" ? "chip chip-kimi"
    : t.tier === "claude_cli" ? "chip chip-claude"
    : t.tier === "minimax" ? "chip chip-minimax"
    : t.tier === "codex" ? "chip chip-codex"
    : t.tier === "antigravity" ? "chip chip-antigravity" : "chip")
    + (t.disabled ? " chip-disabled" : "");
}

/* Палитра «кубиков»: все доступные мозги. Кубик перетаскивается на цепочку,
   чтобы назначить модель задаче; внутри — расход 24ч/7д и остаток недельного
   справочного лимита (задаётся на экране лимитов, вызовы не блокирует). */
function renderBrainPalette(palette) {
  if (!palette || !palette.length) return "";
  const cubes = palette.map((p) => {
    const paid = p.wallet === "paid";
    const limit = Number(p.week_limit_tokens) || 0;
    const weekPct = limit ? Math.min(100, Math.round(100 * p.week_tokens / limit)) : 0;
    const dayPct = limit ? Math.min(100, Math.round(100 * p.day_tokens / limit)) : 0;
    let meter;
    if (paid) {
      meter = `<small class="cube-line">24ч ${tokFmt(p.day_tokens)} · 7д ${tokFmt(p.week_tokens)} · ${usdFmt(p.week_usd)}/нед</small>`;
    } else if (limit) {
      // Ширины ставятся JS'ом после innerHTML: CSP страницы (style-src 'self')
      // блокирует inline style-атрибуты.
      meter = `<div class="cube-track" title="Тёмная часть — последние 24ч">`
        + `<i class="${weekPct >= 90 ? "is-hot" : ""}" data-w="${weekPct}"></i>`
        + `<b data-w="${dayPct}"></b></div>`
        + `<small class="cube-line">24ч ${tokFmt(p.day_tokens)} (${dayPct}%) · 7д ${tokFmt(p.week_tokens)} (${weekPct}%)</small>`
        + `<small class="cube-line">осталось ${tokFmt(p.week_left_tokens)} из ${tokFmt(limit)}/нед</small>`;
    } else {
      meter = `<small class="cube-line">24ч ${tokFmt(p.day_tokens)} · 7д ${tokFmt(p.week_tokens)}</small>`
        + `<small class="cube-line cube-nolimit">нед. лимит не задан — см. «Лимиты»</small>`;
    }
    const badge = p.disabled ? '<span class="chip-off" aria-hidden="true">⊘</span>' : "";
    const title = (p.disabled ? "Отключён — запросы сюда сейчас не идут. " : "")
      + "Нажми кубик, потом строку — модель встанет в цепочку. Мышью тоже можно перетащить";
    return `<button type="button" class="${brainChipCls(p)} brain-cube" draggable="true" data-tier="${escapeHtml(p.tier)}"`
      + ` title="${escapeHtml(title)}">${badge}<b>${escapeHtml(p.provider)}</b>`
      + `<small>${escapeHtml(p.model_label)}</small>${meter}</button>`;
  }).join("");
  return `<div class="brain-palette" aria-label="Доступные модели">${cubes}`
    + '<small class="palette-hint" id="brainPaletteHint">Нажми кубик, затем строку — модель встанет в цепочку.'
    + ' Стрелки ‹ › на чипе двигают мозг по очереди, × убирает.</small></div>';
}

function brainChipHtml(t, i, count) {
  const paid = t.wallet === "paid";
  const cost = paid
    ? "≈$" + Number(t.avg_usd_per_call || 0).toFixed(4) + "/зап"
    : "≈" + tokFmt(t.avg_tokens_per_call || 0) + " ток/зап";
  const title = t.disabled
    ? "Отключён — запросы сюда сейчас не идут. Стрелки двигают по очереди, × убирает"
    : "Стрелки ‹ › двигают по очереди, × убирает";
  const badge = t.disabled ? '<span class="chip-off" aria-hidden="true">⊘</span>' : "";
  const liveStatus = t.disabled
    ? '<small class="chip-live-status is-off">неактивен — запросы не идут</small>'
    : '<small class="chip-live-status is-on">активен</small>';
  const last = i === count - 1;
  return `<span class="${brainChipCls(t)}" draggable="true" data-tier="${escapeHtml(t.tier)}"`
    + ` title="${escapeHtml(title)}">${badge}<b>${escapeHtml(t.provider)}</b>`
    + `<small>${escapeHtml(t.model_label)} · ${cost}</small>`
    + liveStatus
    + '<span class="chip-tools">'
    + `<button type="button" class="chip-move" data-dir="-1" title="Раньше в очереди"${i ? "" : " disabled"}>‹</button>`
    + `<button type="button" class="chip-move" data-dir="1" title="Позже в очереди"${last ? " disabled" : ""}>›</button>`
    + '<button type="button" class="chip-remove" title="Убрать из цепочки">×</button>'
    + "</span></span>";
}

function chainTierKey(tier) {
  return tier === "claude_cli" ? "claude" : String(tier || "");
}

function brainHandoffHtml(row, from, to) {
  const stats = row.chain_stats || {};
  const fromKey = chainTierKey(from.tier);
  const toKey = chainTierKey(to.tier);
  const edge = (stats.edges_24h || {})[`${fromKey}>${toKey}`] || {};
  const tier = (stats.tier_stats_24h || {})[fromKey] || {};
  const entered = Number(edge.entered || tier.attempted || 0);
  const moved = Number(edge.transitions || 0);
  const pct = edge.conversion_pct == null ? (entered ? 0 : null) : Number(edge.conversion_pct);
  const smarter = Number(edge.smarter || 0);
  const smarterPct = edge.smarter_pct == null ? null : Number(edge.smarter_pct);
  const stopped = Number(tier.stopped || 0);
  const stopPct = entered ? Math.round(100 * stopped / entered) : null;
  // 18.08.2026 (CHG-20260818-008): technical теперь честно исключает
  // guard-блоки (llm_budget_guard/kill-switch остановил вызов ДО провайдера) —
  // они отдельным полем guardBlocked, не "модель ответила плохо".
  // guard_blocked/technical_pct отсутствуют на записях без schema_version=2
  // (старая история, честная черта — см. dashboard_backend.py).
  const technical = Number(edge.technical || 0);
  const guardBlocked = Number(edge.guard_blocked || 0);
  const guardBlockedPct = edge.guard_blocked_pct == null ? null : Number(edge.guard_blocked_pct);
  const reasons = Object.entries(tier.reasons || {})
    .sort((a, b) => Number(b[1]) - Number(a[1]))
    .map(([reason, count]) => `${reason}: ${count}`).join(" · ");
  const title = entered
    ? `За 24ч: в ${from.provider} вошло ${entered}; в ${to.provider} перешло ${moved}`
      + (guardBlocked ? `, из них ${guardBlocked} — мы сами заблокировали вызов (не модель)` : "")
      + (reasons ? `. Причины: ${reasons}` : "")
    : "За 24ч фактических запусков этого перехода не было";
  return `<span class="brain-handoff" title="${escapeHtml(title)}">
    <span class="handoff-arrow" aria-hidden="true">→</span>
    <span class="handoff-rate"><b>${moved}</b><small>${pct == null ? "нет запусков" : `${pct}% перешло`}</small></span>
    <span class="handoff-causes">
      <em class="is-smart">умнее ${smarter}${smarterPct == null ? "" : ` · ${smarterPct}%`}</em>
      <em>тех. отказ ${technical}</em>
      ${guardBlocked ? `<em class="is-guard">заблок. нами ${guardBlocked}${guardBlockedPct == null ? "" : ` · ${guardBlockedPct}%`}</em>` : ""}
      <em class="is-stop">блок ${stopped}${stopPct == null ? "" : ` · ${stopPct}%`}</em>
    </span>
  </span>`;
}

function brainChainHtml(row) {
  const tiers = row.tiers || [];
  return tiers.map((t, i) =>
    (i ? brainHandoffHtml(row, tiers[i - 1], t) : "") + brainChipHtml(t, i, tiers.length)
  ).join("");
}

function processSpendHtml(row) {
  const day = Number(row.day_tokens || 0);
  const week = Number(row.week_tokens || 0);
  const limit = Number(row.week_limit_tokens || 0);
  const dailyPlan = limit / 7;
  const dayPct = limit ? Math.round(100 * day / Math.max(1, dailyPlan))
    : (week ? Math.round(100 * day / week) : 0);
  const weekPct = limit ? Math.round(100 * week / limit) : (week ? 100 : 0);
  const stats = row.chain_stats || {};
  const runs = Number(stats.runs_24h || 0);
  const success = stats.success_pct_24h == null ? "—" : `${stats.success_pct_24h}%`;
  const stopped = Number(stats.stopped_24h || 0);
  const exhausted = Number(stats.exhausted_24h || 0);
  const hot = limit && weekPct > 100 ? " is-over" : "";
  return `<aside class="chain-spend${hot}" data-purpose-limit="${escapeHtml(row.purpose)}">
    <div class="chain-spend-head"><strong>Расход цепочки</strong><small>${runs} запусков · успех ${success}</small></div>
    <div class="chain-spend-line"><span>24ч <b>${tokFmt(day)}</b></span><small>${limit ? `${dayPct}% дневного темпа` : "доля недели"}</small></div>
    <span class="chain-spend-track"><i data-w="${Math.min(100, Math.max(0, dayPct))}"></i></span>
    <div class="chain-spend-line"><span>7д <b>${tokFmt(week)}</b></span><small>${limit ? `${weekPct}% лимита` : "лимит не задан"}</small></div>
    <span class="chain-spend-track week"><i data-w="${Math.min(100, Math.max(0, weekPct))}"></i></span>
    <div class="chain-outcomes"><span>⛔ блок ${stopped}</span><span>∅ исчерпано ${exhausted}</span></div>
    <label class="chain-limit-label">Лимит/7д
      <input type="number" min="0" step="1000" value="${limit || ""}" placeholder="не задан" aria-label="Лимит токенов процесса за 7 дней">
      <button type="button" class="process-limit-save">Сохранить</button>
    </label>
    <small class="process-limit-note" aria-live="polite"></small>
  </aside>`;
}

/* Все зарегистрированные процессы, по категориям purpose_categories. Строки —
   те же .brain-row, весь механизм (кубик-клик, drag, ‹ ›, ×) работает как в
   основной карте. Fixed-группа — транспортно-связанные, без редактирования. */
function renderBrainGroups(groups) {
  if (!groups || !groups.length) return "";
  const spendGroups = groups.filter((g) => g.key !== "error");
  const maxDay = Math.max(1, ...spendGroups.map((g) => Number(g.day_tokens) || 0));
  const maxWeek = Math.max(1, ...spendGroups.map((g) => Number(g.week_tokens) || 0));
  return '<div class="brain-groups"><h3 class="brain-groups-title">Все процессы</h3>'
    + groups.map((g) => {
      const fixed = g.fixed || [];
      const purposes = g.purposes || [];
      const count = purposes.length || fixed.length;
      const dayTokens = Number(g.day_tokens) || 0;
      const weekTokens = Number(g.week_tokens) || 0;
      const dayWidth = Math.round(100 * dayTokens / maxDay);
      const weekWidth = Math.round(100 * weekTokens / maxWeek);
      const body = fixed.length
        ? fixed.map((f) => `<div class="brain-fixed-row"><code>${escapeHtml(f.purpose)}</code>
            <span>${escapeHtml(f.note)}</span></div>`).join("")
        : purposes.map((p) => {
          const chips = brainChainHtml(p);
          return `<div class="brain-row brain-process-row brain-row-compact" data-purpose="${escapeHtml(p.purpose)}">
            <div class="brain-label"><code>${escapeHtml(p.purpose)}</code></div>
            <div class="brain-chain">${chips}</div>
            ${processSpendHtml(p)}
            <div class="brain-saved" hidden></div>
          </div>`;
        }).join("");
      return `<details class="brain-group" data-group="${escapeHtml(g.key)}">
        <summary>
          <span class="brain-group-heading">${escapeHtml(g.label)} <b>${count}</b></span>
          <span class="brain-group-total">
            <span class="is-day"><i></i>24ч <strong>${tokFmt(dayTokens)}</strong></span>
            <span class="is-week"><i></i>7д <strong>${tokFmt(weekTokens)}</strong></span>
          </span>
          <span class="brain-group-chart" title="Длина линий — относительно самой расходной категории">
            <span class="is-day"><i data-w="${dayWidth}"></i></span>
            <span class="is-week"><i data-w="${weekWidth}"></i></span>
          </span>
        </summary>
        <div class="brain-group-body">${body}</div>
      </details>`;
    }).join("") + "</div>";
}

/* Два графика: сколько каждый мозг сжёг недельного лимита — за 24 часа и за
   7 дней. Лимит задаётся в секции «Лимиты» (токенов/неделя); если не задан —
   шкала относительная (от максимума среди мозгов) с пометкой. */
function renderBrainCharts(palette) {
  const box = byId("brainCharts");
  if (!box) return;
  const items = (palette || []).filter((p) => p.wallet !== "paid");
  if (!items.length) { box.innerHTML = ""; return; }
  const maxWeek = Math.max(1, ...items.map((p) => Number(p.week_tokens) || 0));
  const maxDay = Math.max(1, ...items.map((p) => Number(p.day_tokens) || 0));
  const panel = (title, field, relMax) => {
    const rows = items.map((p) => {
      const spent = Number(p[field]) || 0;
      const limit = Number(p.week_limit_tokens) || 0;
      const pct = limit ? Math.min(100, Math.round(100 * spent / limit)) : 0;
      const relPct = Math.min(100, Math.round(100 * spent / relMax));
      const width = limit ? pct : relPct;
      const label = limit
        ? `${tokFmt(spent)} · ${pct}% лимита` + (field === "week_tokens"
          ? ` · осталось ${tokFmt(Math.max(0, limit - spent))}` : "")
        : `${tokFmt(spent)} · лимит не задан`;
      const hot = limit && pct >= 90 ? " is-hot" : "";
      return `<div class="chart-row">
        <span class="chart-name">${escapeHtml(p.provider)}</span>
        <span class="chart-track"><i class="${limit ? "" : "is-nolimit"}${hot}" data-w="${width}"></i></span>
        <span class="chart-value">${escapeHtml(label)}</span>
      </div>`;
    }).join("");
    return `<div class="chart-panel"><h3>${title}</h3>${rows}</div>`;
  };
  box.innerHTML =
    panel("За 24 часа — от недельного лимита", "day_tokens", maxDay)
    + panel("За 7 дней — от недельного лимита", "week_tokens", maxWeek);
  box.querySelectorAll(".chart-track [data-w]").forEach((el) => {
    el.style.width = Math.max(0, Math.min(100, Number(el.dataset.w) || 0)) + "%";
  });
}

/* Два графика: сколько токенов сожгла каждая ПАПКА процессов («Все
   процессы» — client_generation/client_review/broker/classify/
   funnel_review/other_opus/fixed) — за 24ч и за 7д, вся папка целиком
   (сумма по всем purpose внутри, day_tokens/week_tokens с бэкенда). Шкала —
   относительная, от максимума среди папок (у папки нет своего недельного
   лимита — лимит задаётся per-тир, не per-задача). */
function renderProcessCharts(groups) {
  const box = byId("processCharts");
  if (!box) return;
  const items = (groups || []).filter((g) => g.key !== "error");
  if (!items.length) { box.innerHTML = ""; return; }
  const panel = (title, field) => {
    const sorted = [...items].sort((a, b) => (Number(b[field]) || 0) - (Number(a[field]) || 0));
    const relMax = Math.max(1, ...sorted.map((g) => Number(g[field]) || 0));
    const rows = sorted.map((g) => {
      const spent = Number(g[field]) || 0;
      const width = Math.min(100, Math.round(100 * spent / relMax));
      const count = Number(g.purpose_count) || 0;
      const label = `${tokFmt(spent)}` + (count ? ` · ${count} проц.` : "");
      return `<div class="chart-row chart-row-wide">
        <span class="chart-name">${escapeHtml(g.label || g.key)}</span>
        <span class="chart-track"><i class="is-nolimit" data-w="${width}"></i></span>
        <span class="chart-value">${escapeHtml(label)}</span>
      </div>`;
    }).join("");
    return `<div class="chart-panel"><h3>${title}</h3>${rows}</div>`;
  };
  box.innerHTML = panel("Папки — за 24 часа", "day_tokens") + panel("Папки — за 7 дней", "week_tokens");
  box.querySelectorAll(".chart-track [data-w]").forEach((el) => {
    el.style.width = Math.max(0, Math.min(100, Number(el.dataset.w) || 0)) + "%";
  });
}

/* Когда кубики последний раз реально сверялись с ai_routing.chain_for() —
   на переключении вкладки, после сохранения правки и на 30s-тике (см. ниже
   window.setInterval). Абсолютное время, не «Nс назад»: проще проверить
   глазами, что тик не встал. */
function markBrainSync(ok, error) {
  const pill = byId("brainSyncPill");
  if (!pill) return;
  const now = new Date();
  const time = now.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  if (ok) {
    pill.textContent = "Сверено: " + time;
    pill.className = "pill ok";
    pill.title = "Последняя сверка кубиков с ai_routing.chain_for()";
  } else {
    pill.textContent = "Не сверено: " + time;
    pill.className = "pill hold";
    pill.title = "Ошибка: " + String(error).slice(0, 160);
  }
}

/* Второй контур мозгов — CapyTime (CHG-20260823-003). Отдельный проект со
   своей цепочкой, своим расходом и своим kill-switch; общий тут только экран.
   Карточки и стрелки те же, поэтому переиспользуем brainChainHtml. */
function renderCapytimeBrain(map) {
  const rows = (map && map.rows) || [];
  if (!rows.length) {
    return '<div class="brain-scope brain-scope-capytime">'
      + '<h3 class="brain-groups-title">CapyTime — отдельный контур</h3>'
      + '<div class="empty-state">Карта недоступна'
      + (map && map.error ? ": " + escapeHtml(map.error) : "") + "</div></div>";
  }
  return '<div class="brain-scope brain-scope-capytime">'
    + '<h3 class="brain-groups-title">CapyTime — отдельный контур</h3>'
    + '<p class="brain-scope-note">Свой конфиг, свой учёт расхода и свой лимит. '
    + 'Переключатели LC Band сюда не достают, и наоборот.</p>'
    + rows.map((row) => `<div class="brain-row brain-process-row" data-scope="capytime" data-purpose="${escapeHtml(row.purpose)}">
      <div class="brain-label"><strong>${escapeHtml(row.title)}</strong><small>${escapeHtml(row.sub)}</small></div>
      <div class="brain-chain">${brainChainHtml(row)}</div>
      <div class="brain-saved" hidden></div>
    </div>`).join("")
    + "</div>";
}


function renderBrainMap(map) {
  const box = byId("brainMap");
  if (!box) return;
  // Открытые группы переживают перерисовку (сохранение цепочки зовёт
  // renderTokens — без этого каждая правка схлопывала «Все процессы»).
  const openGroups = new Set(
    [...box.querySelectorAll(".brain-group[open]")].map((d) => d.dataset.group));
  const rows = (map && map.rows) || [];
  if (!rows.length) {
    box.innerHTML = '<div class="empty-state">Карта недоступна' +
      (map && map.error ? ": " + escapeHtml(map.error) : "") + "</div>";
    return;
  }
  const strip = renderProviderStatusStrip(map && map.disabled_tiers);
  const palette = renderBrainPalette(map && map.palette);
  box.innerHTML = strip + palette + rows.map((row) => {
    const chips = brainChainHtml(row);
    // Текстовые пометки (row.note — «платно нельзя», «Codex убран 04.08» и
    // т.п.) убраны 16.08 по просьбе Михаила: на узком экране колонка с ними
    // съедала место и оставляла пустоту. Та же информация уже читается из
    // самих чипов (paid-чип просто не появится, если канон его не разрешает);
    // визуальный след — графики расхода ниже, а не текст в каждой строке.
    return `<div class="brain-row brain-process-row" data-purpose="${escapeHtml(row.purpose)}">
      <div class="brain-label"><strong>${escapeHtml(row.title)}</strong><small>${escapeHtml(row.sub)}</small></div>
      <div class="brain-chain">${chips}</div>
      ${processSpendHtml(row)}
      <div class="brain-saved" hidden></div>
    </div>`;
  }).join("") + renderBrainGroups(map && map.groups)
    + renderCapytimeBrain(state.capytimeBrain);
  box.querySelectorAll(".cube-track [data-w]").forEach((el) => {
    el.style.width = Math.max(0, Math.min(100, Number(el.dataset.w) || 0)) + "%";
  });
  box.querySelectorAll(".chain-spend-track [data-w]").forEach((el) => {
    el.style.width = Math.max(0, Math.min(100, Number(el.dataset.w) || 0)) + "%";
  });
  box.querySelectorAll(".brain-group-chart [data-w]").forEach((el) => {
    el.style.width = Math.max(0, Math.min(100, Number(el.dataset.w) || 0)) + "%";
  });
  box.querySelectorAll(".brain-group").forEach((d) => {
    if (openGroups.has(d.dataset.group)) d.open = true;
  });
  wireBrainDrag(box);
  wireProcessLimits(box);
}

function wireProcessLimits(box) {
  box.querySelectorAll(".process-limit-save").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const panel = btn.closest(".chain-spend");
      const input = panel && panel.querySelector("input");
      const note = panel && panel.querySelector(".process-limit-note");
      const purpose = panel && panel.dataset.purposeLimit;
      if (!input || !purpose) return;
      const value = input.value.trim() === "" ? 0 : Math.max(0, parseInt(input.value, 10) || 0);
      if (note) note.textContent = "Сохраняю…";
      try {
        await apiPost("/api/app/set_process_token_limit", { purpose, max_tokens_week: value });
        if (note) note.textContent = "Сохранено";
        renderTokens();
      } catch (error) {
        if (note) note.textContent = "Ошибка: " + String(error).slice(0, 70);
      }
    });
  });
  box.querySelectorAll(".chain-spend input").forEach((input) => {
    input.addEventListener("click", (e) => e.stopPropagation());
    input.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") input.closest(".chain-spend").querySelector(".process-limit-save").click();
    });
  });
}

/* Перетаскивание чипов меняет порядок обращения к мозгам, кубик из палитры
   добавляет модель в цепочку, × (или чип → палитра) убирает её.
   Экран читает цепочку из ai_routing и туда же пишет — иначе он снова начнёт
   показывать одно, а система делать другое, как было с прошитым списком. */
let brainDrag = null; // {tier, from: purpose|null, chipEl|null, moved}
/* Выбранный кликом кубик. HTML5-перетаскивание работает не везде (в оболочке
   приложения dragstart не приходит вовсе, на тач-экране его нет), поэтому
   основной путь — «нажал кубик → нажал строку», а drag остаётся как удобство. */
let brainArmedTier = null;

function setBrainArmed(box, tier) {
  brainArmedTier = tier;
  box.querySelectorAll(".brain-cube").forEach((c) => {
    c.classList.toggle("is-armed", !!tier && c.dataset.tier === tier);
  });
  box.querySelectorAll(".brain-row").forEach((r) => r.classList.toggle("is-awaiting", !!tier));
  const hint = box.querySelector("#brainPaletteHint");
  if (hint) {
    const cube = tier ? box.querySelector(`.brain-cube[data-tier="${tier}"] b`) : null;
    hint.textContent = tier
      ? `${cube ? cube.textContent : tier} выбран — нажми строку, куда его поставить (ещё раз по кубику — отмена).`
      : "Нажми кубик, затем строку — модель встанет в цепочку."
        + " Стрелки ‹ › на чипе двигают мозг по очереди, × убирает.";
  }
}

function wireBrainDrag(box) {
  // Ре-рендер посреди перетаскивания (например, после ×-удаления в другом ряду)
  // не должен оставить в brainDrag отвязанный от DOM чип: dragend по нему уже
  // не придёт, а dragover вставил бы его в свежую цепочку дублем.
  brainDrag = null;
  const armed = brainArmedTier;
  brainArmedTier = null;
  if (armed) setBrainArmed(box, armed); // выбор переживает перерисовку
  box.querySelectorAll(".brain-cube").forEach((cube) => {
    cube.addEventListener("click", () => {
      setBrainArmed(box, brainArmedTier === cube.dataset.tier ? null : cube.dataset.tier);
    });
    cube.addEventListener("dragstart", (e) => {
      brainDrag = { tier: cube.dataset.tier, from: null, chipEl: null };
      cube.classList.add("is-dragging");
      try { e.dataTransfer.setData("text/plain", cube.dataset.tier); } catch { /* не критично */ }
    });
    cube.addEventListener("dragend", () => { cube.classList.remove("is-dragging"); brainDrag = null; });
  });

  const paletteBox = box.querySelector(".brain-palette");
  if (paletteBox) {
    paletteBox.addEventListener("dragover", (e) => {
      if (brainDrag && brainDrag.from) { e.preventDefault(); paletteBox.classList.add("is-removal"); }
    });
    paletteBox.addEventListener("dragleave", () => paletteBox.classList.remove("is-removal"));
    paletteBox.addEventListener("drop", (e) => {
      paletteBox.classList.remove("is-removal");
      if (!brainDrag || !brainDrag.from) return;
      e.preventDefault();
      removeBrainTier(box, brainDrag.from, brainDrag.tier);
      brainDrag = null;
    });
  }

  box.querySelectorAll(".brain-row").forEach((row) => {
    const chain = row.querySelector(".brain-chain");
    if (!chain) return;
    chain.querySelectorAll(".chip").forEach((chip) => {
      chip.addEventListener("dragstart", (e) => {
        brainDrag = { tier: chip.dataset.tier, from: row.dataset.purpose, chipEl: chip };
        chip.style.opacity = ".4";
        // Без setData Firefox/Safari вообще не начинают drag.
        try { e.dataTransfer.setData("text/plain", chip.dataset.tier); } catch { /* не критично */ }
      });
      chip.addEventListener("dragend", (e) => {
        chip.style.opacity = "1";
        if (brainDrag && brainDrag.moved && brainDrag.chipEl === chip) {
          // Escape / отпускание вне валидной цели = отмена: dropEffect остаётся
          // "none" (мы явно ставим "move" в dragover). Превью откатываем
          // ре-рендером, в конфиг ничего не пишем.
          const cancelled = e.dataTransfer && e.dataTransfer.dropEffect === "none";
          if (cancelled) renderTokens();
          else saveBrainChain(row);
        }
        brainDrag = null;
      });
      const rm = chip.querySelector(".chip-remove");
      if (rm) rm.addEventListener("click", (e) => {
        e.stopPropagation();
        removeBrainTier(box, row.dataset.purpose, chip.dataset.tier);
      });
      chip.querySelectorAll(".chip-move").forEach((btn) => {
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          moveBrainTier(row, chip.dataset.tier, Number(btn.dataset.dir));
        });
      });
    });
    // Клик по строке ставит выбранный кубик — путь, не зависящий от HTML5 DnD.
    row.addEventListener("click", (e) => {
      if (!brainArmedTier) return;
      if (e.target.closest(".chip-move, .chip-remove, .chain-spend")) return;
      const tier = brainArmedTier;
      setBrainArmed(box, null);
      insertBrainTier(row, tier, e.clientX, e.clientY);
    });
    // Слушает СТРОКА целиком, а не только полоска чипов: у ряда с одним
    // мозгом («Карточки лидов») цепочка шириной в один чип, и попасть в неё
    // мышью почти невозможно — кубик было некуда бросить.
    row.addEventListener("dragover", (e) => {
      if (!brainDrag) return;
      e.preventDefault();
      if (brainDrag.chipEl && brainDrag.from === row.dataset.purpose) {
        // локальная перестановка — живой предпросмотр
        if (!brainDrag.chipEl.isConnected) return; // ре-рендер съел исходный чип
        try { e.dataTransfer.dropEffect = "move"; } catch { /* не критично */ }
        const target = e.target.closest ? e.target.closest(".chip") : null;
        if (target && target !== brainDrag.chipEl) {
          const rect = target.getBoundingClientRect();
          const after = e.clientX > rect.left + rect.width / 2;
          chain.insertBefore(brainDrag.chipEl, after ? target.nextSibling : target);
          brainDrag.moved = true;
        }
      } else {
        try { e.dataTransfer.dropEffect = "copy"; } catch { /* не критично */ }
        chain.classList.add("drop-target");
      }
    });
    row.addEventListener("dragleave", (e) => {
      // Переход между дочерними элементами строки — не выход из неё.
      if (e.relatedTarget && row.contains(e.relatedTarget)) return;
      chain.classList.remove("drop-target");
    });
    row.addEventListener("drop", (e) => {
      chain.classList.remove("drop-target");
      if (!brainDrag) return;
      e.preventDefault();
      // локальная перестановка сохраняется в dragend того же чипа
      if (brainDrag.chipEl && brainDrag.from === row.dataset.purpose) return;
      insertBrainTier(row, brainDrag.tier, e.clientX, e.clientY);
      brainDrag = null;
    });
  });
}

function insertBrainTier(row, tier, clientX, clientY) {
  const before = [...row.querySelectorAll(".brain-chain .chip")].map((c) => c.dataset.tier);
  const entries = [...row.querySelectorAll(".brain-chain .chip")]
    .filter((c) => c.dataset.tier !== tier);
  let idx = 0;
  for (const c of entries) {
    const r = c.getBoundingClientRect();
    if (clientY > r.bottom || (clientY >= r.top && clientX > r.left + r.width / 2)) idx += 1;
  }
  const chain = entries.map((c) => c.dataset.tier);
  chain.splice(idx, 0, tier);
  // Бросили мозг туда, где он и так стоит — без отклика это выглядит как
  // «перетаскивание не работает».
  if (chain.join(">") === before.join(">")) {
    const note = row.querySelector(".brain-saved");
    if (note) { note.hidden = false; note.textContent = "Этот мозг уже стоит здесь — порядок не изменился"; }
    return;
  }
  postBrainChain(row, chain);
}

function moveBrainTier(row, tier, dir) {
  const chain = [...row.querySelectorAll(".brain-chain .chip")].map((c) => c.dataset.tier);
  const idx = chain.indexOf(tier);
  const next = idx + dir;
  if (idx < 0 || next < 0 || next >= chain.length) return;
  chain.splice(next, 0, chain.splice(idx, 1)[0]);
  postBrainChain(row, chain);
}

function removeBrainTier(box, purpose, tier) {
  const row = [...box.querySelectorAll(".brain-row")]
    .find((r) => r.dataset.purpose === purpose);
  if (!row) return;
  const chain = [...row.querySelectorAll(".brain-chain .chip")]
    .map((c) => c.dataset.tier).filter((t) => t !== tier);
  const note = row.querySelector(".brain-saved");
  if (!chain.length) {
    if (note) { note.hidden = false; note.textContent = "Нельзя оставить цепочку пустой"; }
    return;
  }
  postBrainChain(row, chain);
}

function saveBrainChain(row) {
  postBrainChain(row, [...row.querySelectorAll(".brain-chain .chip")].map((c) => c.dataset.tier));
}

async function postBrainChain(row, rawChain) {
  const purpose = row.dataset.purpose;
  const chain = rawChain.filter((t, i) => t && rawChain.indexOf(t) === i);
  const note = row.querySelector(".brain-saved");
  if (!purpose || !chain.length) return;
  // 23.08.2026 (CHG-20260823-003): строка знает свой контур. Без этого правка
  // цепочки CapyTime уходила бы в конфиг LC Band — экран показывал бы одно, а
  // менял другое, ровно та болезнь, из-за которой цепочки вообще вынесли в данные.
  const scope = row.dataset.scope || "";
  const endpoint = scope === "capytime"
    ? "/api/app/capytime_set_brain_chain"
    : "/api/app/set_brain_chain";
  try {
    const res = await apiPost(endpoint, { purpose, chain });
    // Бэкенд может отрезать платный тир там, где канон его не разрешает —
    // показываем то, что реально записалось, а не то, что перетащили.
    // Toast, а не только .brain-saved: перерисовка карты стирает note, и без
    // тоста подтверждение жило доли секунды.
    const savedText = res && res.chain
      ? "Сохранено: " + purpose + " = " + res.chain.join(" → ")
      : "Сохранено: " + purpose;
    toast(savedText);
    if (note) { note.hidden = false; note.textContent = savedText; }
  } catch (err) {
    toast("Не сохранилось: " + String(err).slice(0, 80));
    if (note) { note.hidden = false; note.textContent = "Не сохранилось: " + String(err).slice(0, 80); }
  }
  // Перечитываем карту: бэкенд мог поправить цепочку, и экран обязан показать
  // то, что записалось, а не то, что мы перетащили.
  renderTokens();
}

function renderOutputBudget(ob) {
  const bar = byId("budgetBar");
  const mults = byId("budgetMultipliers");
  if (!bar || !mults) return;
  if (!ob || ob.error) {
    bar.innerHTML = '<div class="empty-state">Бюджет недоступен' +
      (ob && ob.error ? ": " + escapeHtml(ob.error) : "") + "</div>";
    return;
  }
  const pct = Math.min(100, Math.round(100 * ob.spent_weighted / Math.max(1, ob.base_tokens)));
  const over = ob.background_blocked;
  bar.innerHTML = `
    <div class="budget-line"><span>Потрачено (взвешенно)</span>
      <strong>${tokFmt(ob.spent_weighted)} из ${tokFmt(ob.base_tokens)} · ${pct}%</strong></div>
    <div class="budget-track"><i data-w="${pct}"></i></div>
    ${over ? '<p class="mtext budget-over">База исчерпана: фон остановлен, ответы людям живут в запасе ×' + ob.headroom + "</p>" : ""}
    <label class="budget-base">База, ток/сутки:
      <input type="number" id="budgetBase" min="100000" step="100000" value="${ob.base_tokens}"></label>`;
  // CSP страницы (style-src 'self') блокирует inline style-атрибуты, поэтому
  // ширина и цвет заливки ставятся через CSSOM — иначе бар всегда полный.
  const fill = bar.querySelector(".budget-track i[data-w]");
  if (fill) {
    fill.style.width = pct + "%";
    if (over) fill.style.background = "var(--danger)";
  }
  const overNote = bar.querySelector(".budget-over");
  if (overNote) overNote.style.color = "var(--danger)";
  const options = [1, 2, 4, 10, 20];
  mults.innerHTML = Object.entries(ob.multipliers || {}).map(([model, mult]) => {
    const opts = options.map((o) =>
      `<option value="${o}" ${Number(mult) === o ? "selected" : ""}>x${o}</option>`).join("");
    return `<label class="mult-item">${escapeHtml(model)}
      <select data-mult="${escapeHtml(model)}">${opts}</select></label>`;
  }).join("") + '<button class="text-button" id="budgetSaveBtn">Сохранить бюджет</button>';
  byId("budgetSaveBtn").addEventListener("click", async () => {
    const note = byId("budgetSaveNote");
    const multipliers = {};
    document.querySelectorAll("#budgetMultipliers select[data-mult]").forEach((sel) => {
      multipliers[sel.dataset.mult] = Number(sel.value);
    });
    const base = Number(byId("budgetBase").value) || 1000000;
    if (note) note.textContent = "Сохраняю…";
    try {
      const res = await apiPost("/api/app/set_output_budget", { base_tokens: base, multipliers });
      renderOutputBudget(res);
      if (note) note.textContent = "Сохранено. Действует сразу.";
    } catch (error) {
      if (note) note.textContent = "Ошибка: " + String(error).slice(0, 80);
    }
  });
}

/* Loop-Guard v2.  Durable containment incidents are facts; repeat-loop rows
   are evidence groups; budget blocks are policy telemetry, not incidents. */
let loopGuardRenderSeq = 0;

function loopGuardActiveIncidents(report) {
  const items = report?.containment_incidents?.items || [];
  return items.filter((row) => row.status === "open" || row.status === "acknowledged");
}

function loopGuardIdentityKey(row, kind) {
  const entity = kind === "thread"
    ? `conversation:${row.thread_id || ""}`
    : (row.entity_id || "");
  return `${row.purpose || ""}|${entity}|${row.source_revision || ""}`;
}

function loopGuardSignalCount(report, activeIncidents = loopGuardActiveIncidents(report)) {
  if (!report || report.available === false) return 0;
  // A durable incident and its originating evidence group are two projections
  // of one problem. Count only alert-only signal identities in addition to
  // active incidents; otherwise the navigation badge doubles every contained
  // loop even though both sections remain visible on the detail screen.
  const activeKeys = new Set(
    activeIncidents.map((row) => loopGuardIdentityKey(row, "incident"))
  );
  const purposeRows = report.purpose_only_loops || [];
  const threadRows = report.repeat_loops || [];
  if (purposeRows.length || threadRows.length) {
    const signalKeys = new Set();
    purposeRows.forEach((row) => {
      const key = loopGuardIdentityKey(row, "purpose");
      if (!activeKeys.has(key)) signalKeys.add(key);
    });
    threadRows.forEach((row) => {
      const key = loopGuardIdentityKey(row, "thread");
      if (!activeKeys.has(key)) signalKeys.add(key);
    });
    return signalKeys.size;
  }
  const counts = report.counts || {};
  return Number(counts.repeat_loop_groups_total ?? (report.repeat_loops || []).length)
    + Number(counts.purpose_only_loop_groups_total ?? (report.purpose_only_loops || []).length);
}

function loopGuardIncidentCount(report) {
  if (!report || report.available === false) return 0;
  const activeIncidents = loopGuardActiveIncidents(report);
  return activeIncidents.length + loopGuardSignalCount(report, activeIncidents);
}

async function refreshLoopGuardBadge() {
  try {
    const report = await apiGet("/api/app/spend_efficiency");
    setBadge("navLoopGuardCount", loopGuardIncidentCount(report));
  } catch {
    // Silent — badge just stays at its last known value; the screen itself
    // shows the real error state when opened.
  }
}

function loopGuardRowHtml(kind, row) {
  if (kind === "thread") {
    const attempts = row.logical_attempts ?? row.repeats ?? 0;
    const progress = Number(row.progress_evidence_count || 0);
    const quality = row.revision_known ? "revision известна" : "revision неизвестна · только сигнал";
    return `<div class="loop-guard-row">
      <span class="loop-guard-purpose">${escapeHtml(row.purpose)}</span>
      <span class="loop-guard-target">@${escapeHtml(row.username || row.thread_id)}</span>
      <span class="loop-guard-count">${escapeHtml(String(attempts))}×</span>
      <span class="loop-guard-note">logical attempts · progress ${progress} · ${escapeHtml(quality)}</span>
    </div>`;
  }
  if (kind === "incident") {
    const status = row.status === "acknowledged" ? "принят" : "открыт";
    const action = row.containment_action || "block";
    return `<div class="loop-guard-row is-contained">
      <span class="loop-guard-purpose">${escapeHtml(row.rule || row.purpose)}</span>
      <span class="loop-guard-target">${escapeHtml(row.entity_id || "—")}</span>
      <span class="loop-guard-count">${escapeHtml(String(row.occurrence_count || 1))}×</span>
      <span class="loop-guard-note"><span class="is-stop">${escapeHtml(status)} · ${escapeHtml(action)}</span> · ${escapeHtml(row.purpose || "")}</span>
    </div>`;
  }
  if (kind === "budget") {
    return `<div class="loop-guard-row is-budget">
      <span class="loop-guard-purpose">${escapeHtml(row.purpose || "policy")}</span>
      <span class="loop-guard-target">${escapeHtml(row.entity_id || row.provider || "общий лимит")}</span>
      <span class="loop-guard-count">${escapeHtml(String(row.guard_events ?? row.repeats ?? 0))}×</span>
      <span class="loop-guard-note">budget/policy block · не retry-инцидент</span>
    </div>`;
  }
  const identityStatus = row.identity_status || (row.missing_scope ? "missing" : "strong");
  const scopeNote = identityStatus === "strong"
    ? `${row.block_class || "loop"} · ${row.alert_episodes || 1} episode`
    : '<span class="is-stop">identity недостаточна · только alert, без auto-block</span>';
  return `<div class="loop-guard-row">
    <span class="loop-guard-purpose">${escapeHtml(row.purpose)}</span>
    <span class="loop-guard-target">${escapeHtml(row.entity_id || "без entity")}</span>
    <span class="loop-guard-count">${escapeHtml(String(row.guard_events ?? row.repeats ?? 0))}×</span>
    <span class="loop-guard-note">${scopeNote}</span>
  </div>`;
}

async function renderLoopGuard() {
  const seq = ++loopGuardRenderSeq;
  const stale = () => seq !== loopGuardRenderSeq;
  const pill = byId("loopGuardPill");
  const list = byId("loopGuardList");
  if (pill) pill.textContent = "Загрузка…";
  let report;
  try {
    report = await apiGet("/api/app/spend_efficiency");
  } catch (error) {
    if (stale()) return;
    if (pill) { pill.textContent = "Ошибка"; pill.className = "pill hold"; }
    if (list) list.innerHTML = `<div class="empty-state">${escapeHtml(String(error))}</div>`;
    return;
  }
  if (stale()) return;
  const threadLoops = report.repeat_loops || [];
  const purposeLoops = report.purpose_only_loops || [];
  const budgetBlocks = report.budget_blocks || [];
  const activeIncidents = loopGuardActiveIncidents(report);
  const signalTotal = loopGuardSignalCount(report, activeIncidents);
  const total = activeIncidents.length + signalTotal;
  setBadge("navLoopGuardCount", total);
  if (report.available === false) {
    if (pill) { pill.textContent = "Отчёт ещё не создан"; pill.className = "pill hold"; }
    if (list) list.innerHTML = '<div class="empty-state">spend_efficiency_watchdog.py ещё не запускался.</div>';
    return;
  }
  if (pill) {
    const stale = report.freshness?.stale;
    pill.textContent = stale
      ? "Отчёт устарел"
      : total
        ? `${activeIncidents.length} удержано · ${signalTotal} сигналов`
        : "Чисто";
    pill.className = (stale || total) ? "pill hold" : "pill ok";
  }
  if (!list) return;
  if (!total && !budgetBlocks.length && !report.freshness?.degraded) {
    list.innerHTML = '<div class="empty-state">Нет активных containment-инцидентов и повторов без прогресса.</div>';
    return;
  }
  const sections = [];
  if (report.freshness?.degraded) {
    const age = report.freshness.report_age_sec;
    const ageText = Number.isFinite(age) ? ` · отчёту ${Math.round(age / 60)} мин` : "";
    sections.push(`<div class="loop-guard-freshness"><strong>Данные неполные или устарели</strong>${escapeHtml(ageText)}. Auto-containment не считается подтверждённым без свежей strong identity.</div>`);
  }
  sections.push(`<div class="loop-guard-summary">Окно ${escapeHtml(String(report.window_hours || 24))}ч · AI calls ${escapeHtml(String(report.totals?.ai_calls || 0))} · provider hops ${escapeHtml(String(report.totals?.provider_hops || 0))} · logical attempts ${escapeHtml(String(report.totals?.logical_attempts || 0))}</div>`);
  if (activeIncidents.length) {
    sections.push(`<h3 class="loop-guard-section-title">Durable containment (${activeIncidents.length})</h3>`
      + activeIncidents.map((r) => loopGuardRowHtml("incident", r)).join(""));
  }
  if (purposeLoops.length) {
    sections.push(`<h3 class="loop-guard-section-title">Сигналы без диалога (${purposeLoops.length})</h3>`
      + purposeLoops.map((r) => loopGuardRowHtml("purpose", r)).join(""));
  }
  if (threadLoops.length) {
    sections.push(`<h3 class="loop-guard-section-title">Сигналы по диалогу (${threadLoops.length})</h3>`
      + threadLoops.map((r) => loopGuardRowHtml("thread", r)).join(""));
  }
  if (budgetBlocks.length) {
    sections.push(`<h3 class="loop-guard-section-title">Бюджетные блокировки — отдельно (${budgetBlocks.length})</h3>`
      + budgetBlocks.map((r) => loopGuardRowHtml("budget", r)).join(""));
  }
  list.innerHTML = sections.join("");
}

/* Быстрые последовательные вызовы (два сохранения подряд) не должны давать
   устаревшему ответу закрасить свежий: рисует только последний вызов. */
let tokensRenderSeq = 0;

async function renderTokens() {
  const seq = ++tokensRenderSeq;
  const stale = () => seq !== tokensRenderSeq;
  try {
    const ob = await apiGet("/api/app/output_budget");
    if (stale()) return;
    renderOutputBudget(ob);
  } catch (error) {
    if (stale()) return;
    renderOutputBudget({ error: String(error) });
  }
  try {
    const map = await apiGet("/api/app/brain_map");
    if (stale()) return;
    // Второй контур не должен ронять основную карту: своя try/catch, и при
    // ошибке секция просто скажет «недоступна».
    try {
      state.capytimeBrain = await apiGet("/api/app/capytime_brain_map");
    } catch (capyErr) {
      state.capytimeBrain = { rows: [], error: String(capyErr) };
    }
    if (stale()) return;
    renderBrainMap(map);
    markBrainSync(true);
  } catch (error) {
    if (stale()) return;
    renderBrainMap({ rows: [], error: String(error) });
    markBrainSync(false, error);
  }
  try {
    const cfg = await apiGet("/api/app/token_limits");
    if (stale()) return;
    state.tokenLimits = cfg.limits || {};
  } catch { state.tokenLimits = state.tokenLimits || {}; }
  if (stale()) return;
  renderTokenLimits();
  const providers = byId("tokenProviders");
  const agents = byId("tokenAgents");
  providers.innerHTML = '<div class="empty-state">Загрузка…</div>';
  agents.innerHTML = "";
  let data;
  try {
    data = await apiGet("/api/app/token_spend");
  } catch (error) {
    if (stale()) return;
    providers.innerHTML = `<div class="empty-state"><strong>Нет данных</strong>${escapeHtml(String(error))}</div>`;
    byId("tokensSpendPill").textContent = "Ошибка";
    return;
  }
  if (stale()) return;
  state.tokenSpend = data;
  const weekUsd = (data.providers || []).reduce((s, p) => s + (p.week.usd || 0), 0);
  byId("tokensSpendPill").textContent = "Платно за неделю: " + usdFmt(weekUsd);
  byId("tokensSpendPill").className = "pill " + (weekUsd > 2 ? "hold" : "ok");

  providers.innerHTML = (data.providers || []).map((p) => {
    const paid = p.wallet === "paid";
    const tag = paid
      ? '<span class="pill hold">платный $</span>'
      : '<span class="pill ok">подписка</span>';
    return `<div class="system-state-row"><span>${escapeHtml(p.provider)} ${tag}</span>
      <strong>${tokFmt(p.day.tokens)} / сут · ${tokFmt(p.week.tokens)} / нед${paid ? " · " + usdFmt(p.week.usd) : ""}</strong></div>`;
  }).join("") || '<div class="empty-state">Данных пока нет</div>';

  agents.innerHTML = (data.agents || []).map((a, i) => {
    const short = a.agent.replace("com.lcband.", "");
    const provs = (a.providers || []).map((p) => `${escapeHtml(p.provider)} ${tokFmt(p.tokens)}`).join(" · ");
    return `<button class="agent-row" data-agent-idx="${i}">
      <div class="system-state-row"><span>${escapeHtml(short)}</span>
        <strong>${tokFmt(a.day.tokens)} / сут · ${tokFmt(a.week.tokens)} / нед · ${a.week.calls} выз.</strong></div>
      <small>${escapeHtml(provs)}</small></button>`;
  }).join("") || '<div class="empty-state">Данных пока нет</div>';

  agents.querySelectorAll("[data-agent-idx]").forEach((row) => {
    row.addEventListener("click", () => openAgentDrilldown(Number(row.dataset.agentIdx)));
  });

  try {
    const debates = await apiGet("/api/app/spend_reduction_debates");
    if (!stale()) renderSpendDebates(debates);
  } catch (error) {
    if (!stale()) renderSpendDebates({ agents: [], error: String(error) });
  }
}

const SPEND_DEBATE_STATUS_LABEL = {
  ok: '<span class="pill ok">решение готово · консенсус</span>',
  disagreement: '<span class="pill hold">⚡ без консенсуса</span>',
  cooldown: '<span class="pill hold">⏳ кулдаун</span>',
  timeout: '<span class="pill hold">⚠️ таймаут</span>',
  error: '<span class="pill hold">⚠️ ошибка</span>',
};

/* Раз в сутки launchd-агент кладёт результат спора MiniMax↔Kimi (через
   TriBrain) в spend_reduction_debate_report.json — экран только читает и
   рисует. «Отправить Claude» — тот же безопасный sendPrompt/alert-паттерн,
   что и у обычной кнопки ревью: никакого автономного редактирования кода. */
function renderSpendDebates(payload) {
  const box = byId("spendDebateAgents");
  const pill = byId("spendDebateSyncPill");
  if (!box) return;
  if (payload && payload.generated_at && pill) {
    const dt = new Date(payload.generated_at);
    pill.textContent = "Прогон: " + dt.toLocaleString("ru-RU", {
      day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
    });
    pill.className = "pill ok";
  } else if (pill) {
    pill.textContent = payload && payload.note === "no_report_yet" ? "Ещё не запускался" : "—";
    pill.className = "pill";
  }
  const rows = (payload && payload.agents) || [];
  if (payload && payload.error) {
    box.innerHTML = `<div class="empty-state">Недоступно: ${escapeHtml(String(payload.error))}</div>`;
    return;
  }
  if (!rows.length) {
    box.innerHTML = '<div class="empty-state">Отчёт пуст — либо ещё не было прогона, либо все агенты ниже порога.</div>';
    return;
  }
  box.innerHTML = rows.map((a, i) => {
    const short = String(a.agent || "").replace("com.lcband.", "");
    const statusPill = SPEND_DEBATE_STATUS_LABEL[a.status] || "";
    let body;
    if (a.status === "ok") {
      body = `<p class="mtext spend-debate-decision">${escapeHtml(a.decision || "")}</p>
        <button type="button" class="text-button" data-spend-debate-send="${i}">Отправить Claude в чат</button>`;
    } else if (a.status === "disagreement") {
      const failed = Object.entries(a.failed_providers || {}).map(([p, why]) => `${p}: ${why}`).join(", ");
      body = `<p class="mtext">${failed ? "Сбой участника: " + escapeHtml(failed) : "Модели не сошлись во мнении"} — решению ниже доверять осторожнее, консенсуса нет.</p>
        <p class="mtext spend-debate-decision">${escapeHtml(a.decision || "")}</p>
        <button type="button" class="text-button" data-spend-debate-send="${i}">Отправить (без консенсуса) в чат</button>`;
    } else if (a.status === "cooldown") {
      body = `<p class="mtext">MiniMax/Kimi сейчас в кулдауне у нашего guard — спор не запускался, чтобы не жечь TriBrain-квоту впустую.<br><small>${escapeHtml(a.cooldown_reason || "")}</small></p>`;
    } else {
      body = `<p class="mtext">${escapeHtml(a.detail || a.status || "")}</p>`;
    }
    return `<div class="brain-row spend-debate-row">
      <div class="brain-label"><strong>${escapeHtml(short)}</strong><small>${tokFmt(a.day_tokens || 0)} ток/24ч</small></div>
      ${statusPill}
      ${body}
    </div>`;
  }).join("");
  box.querySelectorAll("[data-spend-debate-send]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const row = rows[Number(btn.dataset.spendDebateSend)];
      if (!row) return;
      // Решение уже приходит от MiniMax/Kimi в формате ТЗ (Где/Что менять/
      // Почему безопасно/Как проверить — см. spend_reduction_debate._debate_question).
      // Оборачиваем явным указанием следовать канону проекта — change ledger,
      // тесты — а не просто «примени» (16.08, Михаил).
      const trustNote = row.status === "disagreement"
        ? "Консенсуса между MiniMax и Kimi НЕ было (см. пометку выше) — проверь ТЗ вдвойне критично, часть пунктов может быть от одной модели без второго мнения.\n\n"
        : "";
      const prompt = `Техзадание от MiniMax/Kimi (спор через TriBrain, топ-10 расход за 24ч): `
        + `агент ${row.agent}, ${tokFmt(row.day_tokens || 0)} токенов/24ч.\n\n${trustNote}`
        + `${row.decision}\n\n`
        + `Прежде чем вносить правки: (1) проверь каждую ссылку file:line по факту — модели могли ошибиться; `
        + `(2) если правка реальна и безопасна — веди её как обычный change (ledger-запись, тесты, при риске P0/P1 — adversarial review), `
        + `как для любого изменения в этом проекте; (3) если ТЗ не подтверждается кодом или трогает safety-гейты/presend/voice/деньги — не применяй, объясни почему.`;
      if (typeof sendPrompt === "function") sendPrompt(prompt);
      else alert("Решение спора:\n\n" + prompt);
    });
  });
}

function renderTokenLimits() {
  const box = byId("tokenLimits");
  if (!box) return;
  const limits = state.tokenLimits || {};
  box.innerHTML = TOKEN_LIMIT_PROVIDERS.map((prov) => {
    const cur = limits[prov] || {};
    const label = prov === "codex" ? "Codex" : prov === "claude" ? "Claude"
      : prov === "minimax" ? "MiniMax M3" : prov === "antigravity" ? "Antigravity" : "Kimi K3";
    const numVal = (v) => (Number(v) > 0 ? v : "");
    return `<div class="limit-row">
      <span class="limit-name">${label}</span>
      <label>токенов/запрос<input type="number" min="0" data-limit="${prov}" data-field="max_tokens_per_call" value="${numVal(cur.max_tokens_per_call)}" placeholder="без лимита"></label>
      <label>вызовов/5ч<input type="number" min="0" data-limit="${prov}" data-field="max_calls_5h" value="${numVal(cur.max_calls_5h)}" placeholder="без лимита"></label>
      <label>токенов/неделя · справочно, для кубиков<input type="number" min="0" data-limit="${prov}" data-field="max_tokens_week" value="${numVal(cur.max_tokens_week)}" placeholder="не задан"></label>
    </div>`;
  }).join("") + `<button class="text-button" id="limitsSaveBtn">Сохранить лимиты</button>`;
  byId("limitsSaveBtn").addEventListener("click", saveTokenLimits);
}

async function saveTokenLimits() {
  const note = byId("limitsSaveNote");
  const payload = {};
  document.querySelectorAll("#tokenLimits input[data-limit]").forEach((inp) => {
    const prov = inp.dataset.limit;
    const field = inp.dataset.field;
    const val = inp.value.trim();
    payload[prov] = payload[prov] || {};
    payload[prov][field] = val === "" ? 0 : Math.max(0, parseInt(val, 10) || 0);
  });
  if (note) note.textContent = "Сохраняю…";
  try {
    const res = await apiPost("/api/app/set_token_limits", { limits: payload });
    state.tokenLimits = res.limits || payload;
    if (note) note.textContent = "Сохранено. Лимиты применятся к новым вызовам.";
    // Недельный лимит рисуется на кубиках карты мозгов — без перечитывания
    // кубик так и говорил бы «лимит не задан», как будто сохранение не прошло.
    renderTokens();
  } catch (error) {
    if (note) note.textContent = "Ошибка: " + String(error).slice(0, 80);
  }
}

function openAgentDrilldown(idx) {
  const data = state.tokenSpend || {};
  const agent = (data.agents || [])[idx];
  if (!agent) return;
  const short = agent.agent.replace("com.lcband.", "");
  const topDay = (data.top_day || []).filter((r) => r.owner === agent.agent).slice(0, 8);
  const topWeek = (data.top_week || []).filter((r) => r.owner === agent.agent).slice(0, 8);
  const big = agent.week.tokens >= 500000;
  const rows = (arr) => arr.map((r) =>
    `<div class="system-state-row"><span>${escapeHtml(r.purpose)}</span>
      <strong>${tokFmt(r.tokens)} · ${r.calls} выз.${r.usd > 0 ? " · " + usdFmt(r.usd) : ""}</strong></div>`).join("")
    || '<div class="empty-state">нет данных</div>';
  const html = `<div class="sheet-head"><h2>${escapeHtml(short)}</h2><button class="text-button" id="tokSheetClose">✕</button></div>
    <div class="system-state">
      <div class="system-state-row"><span>За сутки</span><strong>${tokFmt(agent.day.tokens)}</strong></div>
      <div class="system-state-row"><span>За неделю</span><strong>${tokFmt(agent.week.tokens)} · ${agent.week.calls} выз.</strong></div>
      <div class="system-state-row"><span>Платно / нед</span><strong>${usdFmt(agent.week.usd)}</strong></div>
    </div>
    <h2 style="margin-top:14px">Самое затратное — сутки</h2>${rows(topDay)}
    <h2 style="margin-top:14px">Самое затратное — неделя</h2>${rows(topWeek)}
    <button class="text-button" id="tokReviewBtn" style="margin-top:14px">Отправить на ревью: можно ли сократить расход?</button>
    ${big ? '<p class="mtext" style="color:var(--danger,#c0392b)">Расход крупный — ревью рекомендуется</p>' : ""}`;
  openTokSheet(html);
  byId("tokSheetClose").addEventListener("click", closeTokSheet);
  byId("tokReviewBtn").addEventListener("click", () => {
    closeTokSheet();
    const prompt = `Проанализируй расход токенов агента ${agent.agent} за неделю `
      + `(${tokFmt(agent.week.tokens)} токенов, ${agent.week.calls} вызовов). Топ дорогих процессов: `
      + topWeek.map((r) => r.purpose + " " + tokFmt(r.tokens)).join(", ")
      + `. Можно ли сократить расход без потери качества — что конкретно и на сколько?`;
    if (typeof sendPrompt === "function") sendPrompt(prompt);
    else alert("Ревью-запрос:\n\n" + prompt);
  });
}

function openTokSheet(html) {
  let wrap = byId("tokSheetWrap");
  if (!wrap) {
    wrap = document.createElement("div");
    wrap.id = "tokSheetWrap";
    wrap.className = "tok-sheet-wrap";
    wrap.innerHTML = '<div class="tok-sheet"></div>';
    document.body.appendChild(wrap);
    wrap.addEventListener("click", (event) => { if (event.target === wrap) closeTokSheet(); });
  }
  wrap.querySelector(".tok-sheet").innerHTML = html;
  wrap.classList.add("is-open");
}
function closeTokSheet() {
  const wrap = byId("tokSheetWrap");
  if (wrap) wrap.classList.remove("is-open");
}

function renderBroadcast() {
  window.CoreParity?.activate("broadcast");
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

const SESSION_STATUS_LABELS = {
  active: '<span class="session-status active">🟢 активна</span>',
  done: '<span class="session-status done">✅ завершена</span>',
  stalled: '<span class="session-status stalled">🟡 брошена</span>',
  single_shot: '<span class="session-status single-shot">⚙️ авто-классификация</span>',
};

function sessionCountLabel(value) {
  const count = Number(value || 0);
  const mod100 = count % 100;
  const mod10 = count % 10;
  const noun = mod100 >= 11 && mod100 <= 14 ? "сессий" : mod10 === 1 ? "сессия" : mod10 >= 2 && mod10 <= 4 ? "сессии" : "сессий";
  return `${count} ${noun}`;
}

function sessionReviewBadge(label, level, levelLabel, done, reasons = []) {
  const labels = {
    not_needed: "не нужен",
    recommended: "желательно",
    strongly_recommended: "настоятельно рекомендуется",
    required: "обязателен",
  };
  const normalizedLevel = Object.hasOwn(labels, level) ? level : "not_needed";
  const needLabel = levelLabel || labels[normalizedLevel];
  const completion = done ? "✓" : "□";
  const completionLabel = done ? "выполнен" : "не выполнен";
  const reasonText = Array.isArray(reasons) && reasons.length ? ` Причины: ${reasons.join("; ")}.` : "";
  return `<span class="session-review-badge need-${escapeHtml(normalizedLevel)}${done ? " is-done" : ""}" title="${escapeHtml(`${label}: ${needLabel}; ${completionLabel}.${reasonText}`)}"><span>${escapeHtml(label)}</span><b>${escapeHtml(needLabel)}</b><i aria-hidden="true">${completion}</i></span>`;
}

async function refreshSessions() {
  const project = byId("sessionsProjectFilter").value;
  const query = new URLSearchParams();
  if (project) query.set("project", project);
  try {
    const payload = await apiGet(`/api/core/agent_sessions?${query}`);
    state.sessions = payload;
    renderSessions();
  } catch (error) {
    byId("sessionsCountPill").textContent = "Недоступно";
    byId("sessionsList").innerHTML = `<div class="empty-state">Сессии не загружены: ${escapeHtml(error.message)}</div>`;
  }
}

function renderSessions() {
  const payload = state.sessions || {};
  const rows = payload.sessions || [];
  const branches = payload.branches || rows.map((row, index) => ({
    key: `legacy-${index}`,
    title: row.heading || row.title,
    problem: row.problem || row.title,
    solution_preview: row.solution_preview,
    status: row.status,
    sources: [row.source],
    projects: [row.project],
    last_activity: row.last_activity,
    session_count: 1,
    review_need_level: row.review_need_level,
    review_need_label: row.review_need_label,
    review_need_reasons: row.review_need_reasons,
    ultra_review_need_level: row.ultra_review_need_level,
    ultra_review_need_label: row.ultra_review_need_label,
    ultra_review_need_reasons: row.ultra_review_need_reasons,
    review_done: row.review_done,
    ultra_review_done: row.ultra_review_done,
    sessions: [row],
  }));
  byId("sessionsCountPill").textContent = `${payload.count ?? rows.length} сессий · ${payload.branch_count ?? branches.length} веток · ${payload.days ?? 14} дн`;
  const projectFilter = byId("sessionsProjectFilter");
  const selected = projectFilter.value;
  projectFilter.innerHTML = '<option value="">Все проекты</option>'
    + (payload.projects || []).map((name) => `<option value="${escapeHtml(name)}"${name === selected ? " selected" : ""}>${escapeHtml(name)}</option>`).join("");
  const sourcePill = (source) => `<span class="pill ${source === "codex" ? "hold" : "ok"}">${source === "codex" ? "Codex" : "Claude"}</span>`;
  byId("sessionsList").innerHTML = branches.map((branch) => `
    <article class="session-branch">
      <div class="session-branch-head">
        <span class="session-folder-mark" aria-hidden="true">▰</span>
        ${(branch.sources || []).map(sourcePill).join("")}
        <strong>${escapeHtml((branch.projects || []).join(" · "))}</strong>
        ${SESSION_STATUS_LABELS[branch.status] || escapeHtml(branch.status || "")}
        <span class="session-branch-count">${sessionCountLabel(branch.session_count || 1)}</span>
        <span class="session-review-assurance" aria-label="Необходимость и выполнение review">
          ${sessionReviewBadge("Review", branch.review_need_level, branch.review_need_label, branch.review_done, branch.review_need_reasons)}
          ${sessionReviewBadge("Ultra", branch.ultra_review_need_level, branch.ultra_review_need_label, branch.ultra_review_done, branch.ultra_review_need_reasons)}
        </span>
        <span class="session-time">${escapeHtml(branch.last_activity || "")}</span>
      </div>
      <div class="session-summary">
        <div class="session-summary-row is-problem">
          <span class="session-summary-label">Проблема</span>
          <p>${escapeHtml(branch.problem || "Описание проблемы ещё не сформировано.")}</p>
        </div>
        <div class="session-summary-row is-solution">
          <span class="session-summary-label">Решение</span>
          <p>${escapeHtml(branch.solution_preview || "Подтверждённый итог ещё не сформирован.")}</p>
        </div>
      </div>
    </article>`).join("") || '<div class="empty-state">Под выбранные фильтры веток нет.</div>';
}

function costumeStatusLabel(status) {
  if (status === "yes") return '<span class="costume-status yes">✓ есть</span>';
  if (status === "no") return '<span class="costume-status no">✗ нет</span>';
  return '<span class="costume-status unknown">? не проверено</span>';
}

function costumeInstrumentLabel(instrument) {
  return ({
    drums: "барабаны",
    sax: "саксофон",
    guitar: "гитара",
    bass: "бас",
    keys: "клавиши",
    trumpet: "труба",
    trombone: "тромбон",
    tuba: "туба",
    violin: "скрипка",
    vocal: "вокал",
  })[String(instrument || "").toLowerCase()] || instrument || "";
}

function renderCostumes() {
  const payload = state.costumes || {};
  const stats = payload.stats || {};
  const selection = payload.selection || {};
  byId("costumeSummary").innerHTML = [
    [stats.total || 0, "музыкантов"],
    [stats.with_size || 0, "с размером"],
    [stats.with_costumes || 0, "с костюмами"],
    [stats.needs_confirmation || 0, "нужно уточнить"],
  ].map(([value, label]) => `<div><strong>${formatNumber(value)}</strong><span>${escapeHtml(label)}</span></div>`).join("");
  const rosterUpdatedAt = payload.roster_updated_at
    ? String(payload.roster_updated_at).replace("T", " ").slice(0, 16)
    : "";
  const windowLabel = selection.window_end
    ? [
      selection.instrument_window_start
        ? `инструменталисты ${selection.instrument_window_start} — ${selection.window_end}`
        : "",
      selection.vocalist_window_start
        ? `вокалисты ${selection.vocalist_window_start} — ${selection.window_end}`
        : "",
    ].filter(Boolean).join(" · ")
    : "";
  byId("costumeUpdatedAt").textContent = selection.status === "ready"
    ? `Составы проверены${rosterUpdatedAt ? ` ${rosterUpdatedAt}` : ""}${windowLabel ? ` · период ${windowLabel}` : ""}`
    : "Нет проверенного списка отработанных составов";

  const query = state.query.trim().toLowerCase();
  const rows = (payload.musicians || []).filter((musician) => (
    !query || JSON.stringify(musician).toLowerCase().includes(query)
  ));
  const grid = byId("costumeGrid");
  if (!rows.length) {
    grid.innerHTML = `<div class="costume-empty"><strong>${query ? "Ничего не найдено" : "Список пока пуст"}</strong><p>${query ? "Измени запрос." : "Здесь появятся только участники подтверждённых отработанных LCB-составов: инструменталисты за шесть месяцев и вокалисты за год."}</p></div>`;
    return;
  }
  grid.innerHTML = rows.map((musician) => {
    const size = musician.size || {};
    const costumes = musician.costumes || [];
    const initials = String(musician.display_name || musician.username || "?").trim().slice(0, 1).toUpperCase();
    const identity = musician.username ? `@${musician.username}` : `ID ${musician.user_id || "—"}`;
    const instrument = costumeInstrumentLabel(musician.instrument);
    const workedSummary = musician.worked_event_count
      ? `Работал в составах: ${formatNumber(musician.worked_event_count)}${musician.last_worked_date ? ` · последний ${escapeHtml(musician.last_worked_date)}` : ""}`
      : "";
    const costumeRows = costumes.length ? costumes.map((costume) => {
      const variantCount = Number(costume.variant_count || 0);
      const variantDetails = (costume.variant_details || []).map((item) => escapeHtml(item)).join(" · ");
      const meta = [
        costume.garment_type,
        variantCount ? `${variantCount} ${variantCount === 1 ? "вариант" : "варианта"}` : "",
        costume.source_event_id ? `событие ${costume.source_event_id}` : "",
      ].filter(Boolean).join(" · ");
      return `<article class="costume-look ${escapeHtml(costume.availability || "unknown")}">
        ${costume.reference_url ? `<img src="${escapeHtml(costume.reference_url)}" alt="${escapeHtml(costume.title || "Референс костюма")}" loading="lazy">` : '<div class="costume-look-placeholder" aria-hidden="true">♢</div>'}
        <div class="costume-look-copy">
          <div><strong>${escapeHtml(costume.title || "Образ без названия")}</strong>${costumeStatusLabel(costume.availability)}</div>
          <p>${escapeHtml(costume.description || "Описание не сохранено")}</p>
          <small>${escapeHtml(meta || "детали не указаны")}</small>
          ${variantDetails ? `<small class="costume-variants">Варианты: ${variantDetails}</small>` : ""}
        </div>
      </article>`;
    }).join("") : '<div class="costume-unconfirmed"><span>?</span><div><strong>Костюмы не подтверждены</strong><p>Агент ещё не получил ответ с доказательством.</p></div></div>';
    return `<section class="costume-card ${escapeHtml(musician.profile_status || "empty")}">
      <header>
        ${musician.avatar_url ? `<img class="costume-avatar" src="${escapeHtml(musician.avatar_url)}" alt="">` : `<div class="costume-avatar placeholder">${escapeHtml(initials)}</div>`}
        <div><h2>${escapeHtml(musician.display_name || musician.username || musician.identity)}</h2><p>${escapeHtml(identity)}${instrument ? ` · ${escapeHtml(instrument)}` : ""}</p></div>
        <span class="costume-size ${size.value ? "known" : "unknown"}">${size.value ? `Размер ${escapeHtml(size.value)}` : "Размер ?"}</span>
      </header>
      <div class="costume-card-metrics">
        <span><b>${formatNumber(musician.owned_costume_count || 0)}</b> есть</span>
        <span><b>${formatNumber(musician.unavailable_costume_count || 0)}</b> нет</span>
        <span><b>${formatNumber(musician.variant_count || 0)}</b> вариантов</span>
      </div>
      <div class="costume-looks">${costumeRows}</div>
      <footer>${workedSummary}${workedSummary && musician.last_confirmed_at ? " · " : ""}${musician.last_confirmed_at ? `Последнее подтверждение костюма: ${escapeHtml(String(musician.last_confirmed_at).replace("T", " ").slice(0, 16))}` : workedSummary ? "" : "Подтверждений пока нет"}</footer>
    </section>`;
  }).join("");
}

async function refreshCostumes(force = false) {
  const now = Date.now();
  if (state.costumesLoading) return;
  if (!force && state.costumesRefreshedAt && now - state.costumesRefreshedAt < 300000) return;
  state.costumesLoading = true;
  try {
    state.costumes = await apiGet(API.costumes);
    state.costumesRefreshedAt = Date.now();
    renderCostumes();
  } catch (error) {
    byId("costumeGrid").innerHTML = `<div class="costume-empty is-error"><strong>Трекер не загрузился</strong><p>${escapeHtml(error.message)}</p></div>`;
    if (state.activeView === "costumes") toast(`Костюмы не обновлены: ${error.message}`);
  } finally {
    state.costumesLoading = false;
  }
}

function promoCategoryLabel(value) {
  return PROMO_CATEGORY_LABELS[value] || String(value || "Без категории").replaceAll("_", " ");
}

function promoLinkLabel(link) {
  if (link.is_drive) return link.is_folder ? "Папка Drive" : "Файл Drive";
  return ({
    instagram: "Instagram",
    youtube: "YouTube",
    vimeo: "Vimeo",
    telegram: "Telegram",
    website: "Сайт",
    portfolio: "Портфолио",
    video_link: "Видео",
    drive_folder: "Папка Drive",
    curated_media: "Материал Drive",
    presentation_pdf: "PDF-презентация",
    dubai_press_kit: "Dubai Press Kit",
    repertoire: "Репертуар",
  })[link.kind] || "Промо-ссылка";
}

function promoArtistWord(value) {
  const count = Math.abs(Number(value || 0)) % 100;
  const unit = count % 10;
  if (count > 10 && count < 20) return "артистов";
  if (unit === 1) return "артист";
  if (unit > 1 && unit < 5) return "артиста";
  return "артистов";
}

function promoMetric(label, value, tone = "") {
  return `<div class="promo-metric ${tone}"><strong>${formatNumber(value)}</strong><span>${escapeHtml(label)}</span></div>`;
}

function renderPromo() {
  const payload = state.promo;
  const grid = byId("promoGrid");
  if (!payload) {
    grid.innerHTML = '<div class="promo-loading">Собираем библиотеку промо…</div>';
    return;
  }

  const stats = payload.stats || {};
  byId("promoMetrics").innerHTML = [
    promoMetric("в каталоге", stats.total),
    promoMetric("готово клиенту", stats.client_ready, "ready"),
    promoMetric("есть в Drive", stats.with_drive, "drive"),
    promoMetric("нужна папка", stats.needs_drive, "needs"),
  ].join("");
  byId("promoSourceNote").textContent = payload.generated_at
    ? `Индекс обновлён ${payload.generated_at.replace("T", " ")} · источник: ${payload.source}`
    : `Источник: ${payload.source || "индекс промо"}`;

  const rootLink = byId("promoRootLink");
  rootLink.hidden = !payload.root_folder_url;
  if (payload.root_folder_url) rootLink.href = payload.root_folder_url;

  const categories = payload.categories || [];
  const categorySelect = byId("promoCategory");
  categorySelect.innerHTML = '<option value="">Все категории</option>' + categories.map((item) => (
    `<option value="${escapeHtml(item.id)}">${escapeHtml(promoCategoryLabel(item.id))} · ${formatNumber(item.total)}</option>`
  )).join("");
  categorySelect.value = state.promoFilters.category;
  byId("promoCategoryRail").innerHTML = categories.slice(0, 12).map((item) => (
    `<button type="button" data-promo-category="${escapeHtml(item.id)}" class="${state.promoFilters.category === item.id ? "is-active" : ""}"><span>${escapeHtml(promoCategoryLabel(item.id))}</span><b>${formatNumber(item.total)}</b><small>${formatNumber(item.with_drive)} в Drive</small></button>`
  )).join("");
  document.querySelectorAll("[data-promo-status]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.promoStatus === state.promoFilters.status);
  });

  byId("promoResultCount").textContent = `${formatNumber(payload.total)} ${promoArtistWord(payload.total)}`;
  byId("promoPageLabel").textContent = `${formatNumber(payload.page)} / ${formatNumber(payload.pages)}`;
  byId("promoPrev").disabled = payload.page <= 1;
  byId("promoNext").disabled = payload.page >= payload.pages;

  const items = payload.items || [];
  if (!items.length) {
    grid.innerHTML = '<div class="promo-empty"><span>⌕</span><strong>Ничего не найдено</strong><p>Измени поиск, категорию или фильтр готовности.</p></div>';
    return;
  }
  grid.innerHTML = items.map((item) => {
    const status = PROMO_STATUS[item.presentation_status] || PROMO_STATUS.missing;
    const readyDrive = (item.drive_links || []).find((link) => link.client_safe);
    const sourceDrive = (item.drive_links || [])[0];
    const drive = readyDrive || sourceDrive;
    const promoLinks = (item.promo_links || []).slice(0, 4);
    const mediaCount = Number(item.media?.local_files || 0)
      + Number(item.media?.indexed_media || 0)
      + Number(item.media?.links || 0);
    const extraDriveLinks = (item.drive_links || []).slice(1, 4);
    const actions = [
      drive ? `<a class="promo-action drive ${readyDrive ? "is-ready" : "is-source"}" href="${escapeHtml(drive.url)}" target="_blank" rel="noopener noreferrer"><span aria-hidden="true">↗</span>${readyDrive ? "Презентация Drive" : "Источник Drive"}</a>` : "",
      ...extraDriveLinks.map((link) => `<a class="promo-action" href="${escapeHtml(link.url)}" target="_blank" rel="noopener noreferrer"><span aria-hidden="true">↗</span>${escapeHtml(promoLinkLabel(link))}${link.client_safe ? "" : " · внутри пакета"}</a>`),
      ...promoLinks.map((link) => `<a class="promo-action" href="${escapeHtml(link.url)}" target="_blank" rel="noopener noreferrer"><span aria-hidden="true">↗</span>${escapeHtml(promoLinkLabel(link))}${link.client_safe ? "" : " · источник"}</a>`),
    ].filter(Boolean).join("");
    return `<article class="promo-card">
      <div class="promo-card-top"><span class="promo-category">${escapeHtml(promoCategoryLabel(item.category))}</span><span class="promo-status ${status.className}"><i></i>${escapeHtml(status.label)}</span></div>
      <div class="promo-identity"><div class="promo-monogram">${escapeHtml(item.name.slice(0, 1).toUpperCase())}</div><div><h3>${escapeHtml(item.name)}</h3>${item.username ? `<p>@${escapeHtml(item.username)}</p>` : ""}</div></div>
      ${item.rate_quote ? `<p class="promo-rate">${escapeHtml(item.rate_quote)}</p>` : '<p class="promo-rate is-empty">Гонорар в карточке не указан</p>'}
      <div class="promo-card-meta"><span>${formatNumber(mediaCount)} медиа / ссылок</span>${item.last_contact ? `<span>контакт ${escapeHtml(item.last_contact)}</span>` : ""}</div>
      <div class="promo-actions">${actions || '<span class="promo-no-links">Промо-ссылок пока нет</span>'}</div>
    </article>`;
  }).join("");
}

async function refreshPromo(force = false) {
  const now = Date.now();
  if (state.promoLoading) return;
  if (!force && state.promoRefreshedAt && now - state.promoRefreshedAt < 300000) return;
  state.promoLoading = true;
  byId("promoGrid").classList.add("is-loading");
  const params = new URLSearchParams({
    q: state.promoFilters.q,
    category: state.promoFilters.category,
    status: state.promoFilters.status,
    page: String(state.promoFilters.page),
    limit: "48",
  });
  try {
    state.promo = await apiGet(`${API.promo}?${params.toString()}`);
    state.promoFilters.page = state.promo.page;
    state.promoRefreshedAt = Date.now();
    renderPromo();
  } catch (error) {
    byId("promoGrid").innerHTML = `<div class="promo-empty is-error"><span>!</span><strong>Каталог не загрузился</strong><p>${escapeHtml(error.message)}</p></div>`;
    if (state.activeView === "promo") toast(`Промо не обновлено: ${error.message}`);
  } finally {
    state.promoLoading = false;
    byId("promoGrid").classList.remove("is-loading");
  }
}

const FLOW_EVIDENCE = Object.freeze({
  history_transition: { label: "История CRM", className: "" },
  log_transition: { label: "Fallback-журнал", className: "is-log" },
  to_only: { label: "Предыдущая стадия не доказана", className: "is-partial" },
  snapshot_only: { label: "Только текущее положение", className: "is-snapshot" },
});

function flowFormatTime(value) {
  if (!value) return "время неизвестно";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("ru-RU", {
    day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

function flowFilteredLeads(leads = state.leadFlow?.leads || []) {
  const query = state.flowQuery.toLocaleLowerCase("ru-RU");
  return leads.filter((lead) => {
    if (state.flowSource && lead.lead_source?.key !== state.flowSource) return false;
    if (!query) return true;
    return [lead.display, lead.username, lead.lead_id, lead.stage_label, lead.channel]
      .some((value) => String(value || "").toLocaleLowerCase("ru-RU").includes(query));
  });
}

function flowMetric(value, label, className = "") {
  return `<article class="flow-metric ${className}"><strong>${formatNumber(value)}</strong><span>${escapeHtml(label)}</span></article>`;
}

function renderFlowMetrics() {
  const data = state.leadFlow;
  if (!data) return;
  const coverage = data.coverage || {};
  const visible = flowFilteredLeads();
  const visibleIds = new Set(visible.map((lead) => lead.lead_id));
  const filtersActive = Boolean(state.flowSource || state.flowQuery);
  const confirmedTransitions = filtersActive
    ? (data.transitions || []).filter((row) => visibleIds.has(row.lead_id) && ["history_transition", "log_transition"].includes(row.evidence)).length
    : Number(coverage.confirmed_transitions || 0);
  const snapshotOnly = filtersActive
    ? visible.filter((lead) => lead.history_state === "snapshot_only").length
    : Number(coverage.snapshot_only_leads || 0);
  const stuck = visible.filter((lead) => lead.stuck).length;
  byId("flowMetrics").innerHTML = [
    flowMetric(visible.length, visible.length === Number(coverage.leads_total || 0) ? "лидов в выбранном контуре" : `лидов после фильтра · всего ${coverage.leads_total || 0}`, "is-accent"),
    flowMetric(confirmedTransitions, "подтверждённых переходов"),
    flowMetric(snapshotOnly, "без машинно-читаемого маршрута", snapshotOnly ? "is-warn" : ""),
    flowMetric(stuck, "без движения ≥ 14 дней", stuck ? "is-warn" : ""),
  ].join("");
  const pct = Number(coverage.history_pct || 0);
  byId("flowCoverageRing").style.borderTopColor = pct >= 60 ? "var(--pine)" : "var(--warn)";
  byId("flowCoverageRing").querySelector("strong").textContent = `${Math.round(pct)}%`;
  byId("flowFreshness").textContent = `Обновлено ${flowFormatTime(data.generated_at)}`;
}

function renderFlowWarnings() {
  const warnings = state.leadFlow?.warnings || [];
  byId("flowWarnings").innerHTML = warnings.map((warning) => `
    <div class="flow-warning"><b>!</b><span>${escapeHtml(warning.detail || warning.code)}</span></div>
  `).join("");
}

function flowSelectedKey(selection = state.flowSelected) {
  if (!selection) return "";
  if (selection.kind === "edge") return `${selection.from}|${selection.to}|${selection.evidence}`;
  return selection.key || selection.leadId || "";
}

function renderFlowMap() {
  const data = state.leadFlow;
  const canvas = byId("flowMapCanvas");
  if (!data) {
    canvas.style.width = "100%";
    canvas.innerHTML = '<div class="flow-loading">Собираем фактические переходы…</div>';
    return;
  }
  const visibleLeads = flowFilteredLeads();
  const visibleIds = new Set(visibleLeads.map((lead) => lead.lead_id));
  const nodes = data.nodes || [];
  const edges = (data.edges || []).map((edge) => ({
    ...edge,
    visibleLeadIds: (edge.lead_ids || []).filter((leadId) => visibleIds.has(leadId)),
  })).filter((edge) => edge.visibleLeadIds.length > 0);
  const width = Math.max(1080, nodes.length * 184 + 80);
  canvas.style.width = `${width}px`;
  const positions = new Map(nodes.map((node, index) => [node.key, 34 + index * 184]));
  const visibleNodeCount = (node) => node.key === "snapshot_origin"
    ? visibleLeads.filter((lead) => lead.history_state === "snapshot_only").length
    : visibleLeads.filter((lead) => lead.stage === node.key).length;
  if (!state.flowSelected) {
    const first = [...nodes].sort((a, b) => {
      const countDiff = visibleNodeCount(b) - visibleNodeCount(a);
      if (countDiff) return countDiff;
      return Number(a.kind === "evidence_gap") - Number(b.kind === "evidence_gap");
    })[0];
    if (first) state.flowSelected = { kind: "node", key: first.key };
  }
  const selectedKey = flowSelectedKey();
  const nodeHtml = nodes.map((node, index) => {
    const count = visibleNodeCount(node);
    const stuck = node.key === "snapshot_origin" ? 0 : visibleLeads.filter((lead) => lead.stage === node.key && lead.stuck).length;
    const active = node.key === "snapshot_origin"
      ? visibleLeads.filter((lead) => lead.history_state === "snapshot_only" && lead.lead_status === "active").length
      : visibleLeads.filter((lead) => lead.stage === node.key && lead.lead_status === "active").length;
    const classes = ["flow-node", node.kind === "evidence_gap" ? "is-gap" : "", count === 0 ? "is-empty" : "", selectedKey === node.key ? "is-selected" : ""].filter(Boolean).join(" ");
    return `<button class="${classes}" type="button" data-flow-node="${escapeHtml(node.key)}" data-flow-index="${index}">
      <span class="flow-node-name">${escapeHtml(node.label)}</span>
      <strong class="flow-node-count">${formatNumber(count)}</strong>
      <span class="flow-node-meta">${stuck ? `<i class="is-stuck">застряли ${stuck}</i>` : ""}${node.intra_stage_moves ? `<i>внутри стадии ${node.intra_stage_moves}</i>` : ""}<i>${active} активных</i></span>
    </button>`;
  }).join("");
  const drawableEdges = edges.filter((edge) => positions.has(edge.from) && positions.has(edge.to));
  const paths = drawableEdges.map((edge, index) => {
    const x1 = positions.get(edge.from) + 79;
    const x2 = positions.get(edge.to) + 79;
    const lane = 174 + (index % 8) * 31;
    const key = `${edge.from}|${edge.to}|${edge.evidence}`;
    const meta = FLOW_EVIDENCE[edge.evidence] || { label: edge.evidence, className: "is-partial" };
    const selected = selectedKey === key ? " is-selected" : "";
    const path = `M ${x1} 132 C ${x1} ${lane}, ${x2} ${lane}, ${x2} 132`;
    return `<path class="flow-edge ${meta.className}${selected}" d="${path}" data-flow-edge="${escapeHtml(key)}"><title>${escapeHtml(meta.label)} · ${edge.visibleLeadIds.length} лидов</title></path>
      <text class="flow-edge-label" x="${(x1 + x2) / 2}" y="${lane - 5}" text-anchor="middle" data-flow-edge="${escapeHtml(key)}">${edge.visibleLeadIds.length}</text>`;
  }).join("");
  const marker = `<defs><marker id="flowArrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="var(--pine)"></path></marker></defs>`;
  canvas.innerHTML = `<svg class="flow-map-svg" width="${width}" height="450" viewBox="0 0 ${width} 450" aria-hidden="true">${marker}${paths}</svg>${nodeHtml}`;
  canvas.querySelectorAll(".flow-edge").forEach((path) => path.setAttribute("marker-end", "url(#flowArrow)"));

}

function flowLeadCard(lead) {
  const source = lead.lead_source?.label || "Источник не определён";
  const status = lead.lead_status === "archived" ? "архивный" : "активный";
  const handle = lead.username ? `@${lead.username}` : lead.lead_id;
  return `<button class="flow-lead ${state.flowSelected?.leadId === lead.lead_id ? "is-selected" : ""}" type="button" data-flow-lead="${escapeHtml(lead.lead_id)}">
    <span class="flow-lead-top"><strong>${escapeHtml(lead.display)}</strong><em>${escapeHtml(status)}</em></span>
    <p>${escapeHtml(handle)} · ${escapeHtml(source)}</p>
    <span class="flow-lead-badges"><span>${escapeHtml(lead.stage_label || "Стадия неизвестна")}</span>${lead.stuck ? '<span class="is-stuck">застрял</span>' : ""}<span>${escapeHtml(lead.history_state)}</span></span>
  </button>`;
}

function renderFlowLeadDetail(lead) {
  const transitions = (state.leadFlow?.transitions || []).filter((row) => row.lead_id === lead.lead_id);
  const timeline = transitions.length ? transitions.map((row) => {
    const evidence = FLOW_EVIDENCE[row.evidence] || { label: row.evidence };
    const from = row.from ? (state.leadFlow.nodes || []).find((node) => node.key === row.from)?.label || row.raw_from || row.from : "предыдущая стадия неизвестна";
    const to = row.to ? (state.leadFlow.nodes || []).find((node) => node.key === row.to)?.label || row.raw_to || row.to : row.raw_to || "стадия не сопоставлена";
    return `<div class="flow-transition ${row.evidence === "to_only" ? "is-partial" : ""}"><strong>${escapeHtml(from)} → ${escapeHtml(to)}</strong><time>${escapeHtml(flowFormatTime(row.ts))}</time><small>${escapeHtml(evidence.label)} · ${escapeHtml(row.actor || "источник неизвестен")}</small></div>`;
  }).join("") : '<div class="flow-no-results">Подтверждённых переходов в выбранном периоде нет. Показано только текущее положение.</div>';
  const ageLabel = lead.days_in_stage === null ? "" : lead.days_in_stage_basis === "transition"
    ? ` · ${lead.days_in_stage} дн. на стадии`
    : ` · ${lead.days_in_stage} дн. без активности`;
  byId("flowDetail").innerHTML = `<div class="flow-detail-head"><p class="eyebrow">${escapeHtml(lead.lead_id)}</p><h2>${escapeHtml(lead.display)}</h2><p>${escapeHtml(lead.stage_label || "Стадия неизвестна")} · ${escapeHtml(lead.lead_source?.label || "Источник неизвестен")}${ageLabel}</p></div>
    ${lead.next_action ? `<div class="flow-warning"><b>→</b><span>${escapeHtml(lead.next_action)}</span></div>` : ""}
    <div class="flow-timeline">${timeline}</div>`;
}

function renderFlowDetail() {
  const data = state.leadFlow;
  if (!data) return;
  const selected = state.flowSelected;
  if (selected?.kind === "lead") {
    const lead = (data.leads || []).find((item) => item.lead_id === selected.leadId);
    if (lead) {
      renderFlowLeadDetail(lead);
      return;
    }
  }
  let leads = flowFilteredLeads();
  let eyebrow = "Выбор на карте";
  let title = "Лиды";
  let note = "Текущее положение в CRM";
  if (selected?.kind === "node") {
    const node = (data.nodes || []).find((item) => item.key === selected.key);
    title = node?.label || selected.key;
    leads = leads.filter((lead) => selected.key === "snapshot_origin" ? lead.history_state === "snapshot_only" : lead.stage === selected.key);
    note = selected.key === "snapshot_origin" ? "Маршрут не доказан; это не отдельная стадия" : `${leads.length} лидов сейчас`;
  } else if (selected?.kind === "edge") {
    const edge = (data.edges || []).find((item) => item.from === selected.from && item.to === selected.to && item.evidence === selected.evidence);
    const from = (data.nodes || []).find((node) => node.key === selected.from)?.label || selected.from;
    const to = (data.nodes || []).find((node) => node.key === selected.to)?.label || selected.to;
    title = `${from} → ${to}`;
    eyebrow = FLOW_EVIDENCE[selected.evidence]?.label || selected.evidence;
    const ids = new Set(edge?.lead_ids || []);
    leads = leads.filter((lead) => ids.has(lead.lead_id));
    note = `${leads.length} уникальных лидов`;
  }
  const cards = leads.slice(0, 80).map(flowLeadCard).join("");
  byId("flowDetail").innerHTML = `<div class="flow-detail-head"><p class="eyebrow">${escapeHtml(eyebrow)}</p><h2>${escapeHtml(title)}</h2><p>${escapeHtml(note)}</p></div><div class="flow-lead-list">${cards || '<div class="flow-no-results">По выбранным фильтрам лидов нет.</div>'}</div>`;
}

function renderFlow() {
  renderFlowMetrics();
  renderFlowWarnings();
  renderFlowMap();
  renderFlowDetail();
}

async function refreshFlow(force = false) {
  const now = Date.now();
  if (state.flowLoading) return;
  if (!force && state.flowRefreshedAt && now - state.flowRefreshedAt < 90000) return;
  state.flowLoading = true;
  byId("flowFreshness").textContent = "Обновление…";
  const params = new URLSearchParams({ scope: "lcb", period_days: String(state.flowPeriod) });
  try {
    state.leadFlow = await apiGet(`${API.leadFlow}?${params.toString()}`);
    state.flowRefreshedAt = Date.now();
    state.flowSelected = null;
    renderFlow();
  } catch (error) {
    byId("flowFreshness").textContent = "Карта недоступна";
    byId("flowMapCanvas").style.width = "100%";
    byId("flowMapCanvas").innerHTML = `<div class="flow-error"><strong>Не удалось собрать карту</strong><span>${escapeHtml(error.message)}</span></div>`;
    byId("flowWarnings").innerHTML = "";
    byId("flowMetrics").innerHTML = "";
  } finally {
    state.flowLoading = false;
  }
}

// ── OpsMap ────────────────────────────────────────────────────────────────
// Read-only карта процессов. Canonical node/edge panels live in opsmap.js.
// Live AI operations rail is rendered here. No messages, no data mutations.

function renderOpsmapMetrics() {
  const data = state.opsmap;
  const metrics = byId("opsMetrics");
  if (!data) { metrics.innerHTML = ""; return; }
  const coverage = data.coverage || {};
  const nodes = data.nodes || [];
  const confirmed = nodes.filter((node) => node.evidence === "confirmed").length;
  const pct = nodes.length ? (100 * confirmed) / nodes.length : 0;
  metrics.innerHTML = [
    flowMetric(nodes.length, "узлов на карте", "is-accent"),
    flowMetric(coverage.outbound_records || 0, "outbound-записей"),
    flowMetric(coverage.delivery_evidence_gaps || 0, "доставок без receipt", coverage.delivery_evidence_gaps ? "is-warn" : ""),
    flowMetric(coverage.identity_splits || 0, "identity split", coverage.identity_splits ? "is-warn" : ""),
    flowMetric(coverage.obligations_breached || 0, "просрочено obligations", coverage.obligations_breached ? "is-warn" : ""),
  ].join("");
  const ring = byId("opsGapRing");
  ring.style.borderTopColor = pct >= 50 ? "var(--pine)" : "var(--warn)";
  ring.querySelector("strong").textContent = `${Math.round(pct)}%`;
  byId("opsFreshness").textContent = `Обновлено ${flowFormatTime(data.generated_at)} · PII скрыта`;
}

function renderOpsmapWarnings() {
  const warnings = state.opsmap?.warnings || [];
  byId("opsWarnings").innerHTML = warnings.map((warning) => `
    <div class="flow-warning"><b>!</b><span>${escapeHtml(warning.detail || warning.code)}</span></div>
  `).join("");
}

async function renderOpsmapMap() {
  const canvas = byId("opsMapCanvas");
  if (!window.OpsMapSvg) {
    canvas.innerHTML = '<div class="flow-loading">SVG-модуль не загружен</div>';
    return;
  }
  if (!state.opsMapSvg) {
    state.opsMapSvg = new window.OpsMapSvg(canvas);
    canvas.addEventListener("opsmap-node-select", (ev) => {
      state.opsSelected = { kind: "node", nodeId: ev.detail.nodeId };
      renderOpsmapLiveOps();
    });
  }
  state.opsMapSvg.setMode(state.opsMode || "all");
  const depth = state.opsDepth || "node";
  // Prefer canonical topology endpoint (P6-1); fallback to cached data.
  if (!state.opsMapSvg.data || state.opsMapLoadedDepth !== depth) {
    state.opsMapLoadedDepth = depth;
    try {
      const envelope = await apiGet(`/api/opsmap/topology?depth=${encodeURIComponent(depth)}`);
      state.opsMapSvg.data = envelope.data || {};
      state.opsMapSvg.registryVersion = envelope.registry_version;
      state.opsMapSvg.depth = depth;
      state.opsMapSvg.render();
      state.opsMapSvg.showReadableStart();
    } catch (error) {
      state.opsMapSvg.load(depth);
    }
  } else {
    state.opsMapSvg.render();
  }
}

async function renderOpsmap() {
  renderOpsmapMetrics();
  renderOpsmapWarnings();
  await renderOpsmapMap();
  if (state.opsSelectedOperation) renderOpsmapOperationJourney(state.opsSelectedOperation);
  else renderOpsmapHumanOverview();
  setOpsmapTechnicalVisible(state.opsTechnicalVisible);
  renderOpsmapLiveOps();
}

function renderOpsmapDisabled(detail) {
  state.opsDisabled = true;
  byId("opsFreshness").textContent = "OpsMap выключена";
  byId("opsMetrics").innerHTML = "";
  byId("opsWarnings").innerHTML = "";
  byId("opsMapCanvas").innerHTML = `<div class="flow-error"><strong>OpsMap выключена feature-флагом</strong><span>${escapeHtml(detail || "Включите LCB_OPSMAP_ENABLED=1 в окружении dashboard_backend и перезапустите процесс. Production не меняется.")}</span></div>`;
  const liveList = byId("opsmap-live-list");
  if (liveList) liveList.innerHTML = '<div class="opsmap-live-empty">OpsMap выключена</div>';
}

// ── Live AI operations rail (P7) ───────────────────────────────────────────

const OPS_STATUS_LABEL = Object.freeze({
  active: "идёт",
  completed: "завершено",
  failed: "ошибка",
  stale: "устарело",
  recent: "недавнее",
  unknown: "неизвестно",
});

const OPS_LEAD_LABEL = Object.freeze({
  exact: { text: "карточка связана", className: "is-exact" },
  ambiguous: { text: "несколько карточек", className: "is-ambiguous" },
  unlinked: { text: "карточка не найдена", className: "is-unlinked" },
});

const OPS_EFFECT_LABEL = Object.freeze({
  working: "в работе",
  proposal_ready: "результат модели",
  completed: "выполнено",
  recorded: "записано",
  partial: "частично",
  no_action: "без внешнего действия",
  held: "нужен оператор",
  stalled: "остановилось",
  failed: "ошибка",
});

const OPS_PURPOSE_FALLBACK = Object.freeze({
  unified_dm_handle: ["Обработка нового сообщения", "Система определяет контекст и следующий шаг."],
  lead_context_enrich: ["Поиск карточки и контекста", "Система ищет заказ, мероприятие и историю общения."],
  lead_context_classify: ["Классификация сообщения в переписке", "Сообщение в переписке классифицировано."],
  tg_post_classify: ["Классификация поста Telegram", "Пост Telegram классифицирован."],
  vk_post_classify: ["Классификация поста VK", "Пост VK классифицирован."],
  core_role_classify: ["Определение роли собеседника", "Модель проверила роль автора сообщения."],
  core_shadow_writer: ["Подготовка черновика ответа", "Черновик подготовлен; это ещё не отправка."],
  broker_client_reply_disposition: ["Выбор следующего шага по клиенту", "Модель предложила действие; выполнение не подтверждено."],
  lcb_writer_followup: ["Подготовка повторного сообщения", "Вариант follow-up подготовлен; отправка не подтверждена."],
  thread_context_extract: ["Извлечение фактов из переписки", "Факты выделены моделью; применение ещё не подтверждено."],
  classify_batch: ["Классификация новых сообщений", "Пакет сообщений классифицирован моделью."],
  classify_batch_l2_opus: ["Повторная проверка классификации", "Сложная классификация перепроверена моделью."],
  lcb_writer_reply: ["Подготовка ответа клиенту", "Черновик ответа подготовлен; это ещё не отправка."],
  broker_public_casting_request_detect: ["Проверка запроса на поиск исполнителя", "Модель определила необходимость поиска; запуск не подтверждён."],
  broker_service_match: ["Подбор подходящей услуги", "Вариант услуги подобран моделью; подтверждение ещё требуется."],
  inbound_business_event: ["Распознавание бизнес-события", "Возможное изменение заказа распознано; применение не подтверждено."],
  promo_media_client_expectations: ["Проверка ожиданий клиента по промо", "Требования к промо выделены моделью."],
});

const OPS_LEAD_REASON_HELP = Object.freeze({
  no_thread_id: "У операции не записан thread_id и нет order_id, event_id или lead_id.",
  no_lead_evidence: "По thread_id не найдено доказательств связи с карточкой лида или мероприятия.",
  multiple_candidates: "По одной переписке найдено несколько возможных лидов. Нужен order_id, event_id или lead_id конкретного мероприятия.",
  conflicting_explicit_ids: "В операции записаны противоречащие друг другу order_id, event_id или lead_id. Система не выбирает один из них наугад.",
  explicit_id_not_found: "В операции записан конкретный ID, но соответствующая карточка не найдена.",
  explicit_id_resolver_error: "Конкретный ID записан, но проверить его по базе сейчас не удалось.",
  resolver_error: "Поиск связи с лидом завершился технической ошибкой.",
});

function opsLeadHelp(op) {
  const state = op.lead?.state || "unlinked";
  const reason = op.lead?.reason || "";
  if (state === "exact") {
    const matched = op.lead?.matched_by;
    const source = matched === "order" ? "order_id"
      : matched === "event" ? "event_id"
      : "уникальной связи переписки";
    return `Найдена одна конкретная карточка по ${source}. Нажмите операцию, чтобы показать её путь.`;
  }
  if (state === "ambiguous") {
    return OPS_LEAD_REASON_HELP[reason]
      || "Найдено несколько возможных карточек. Система не выбирает наугад; операции нужен order_id, event_id или lead_id.";
  }
  return OPS_LEAD_REASON_HELP[reason]
    || "AI-операция видна, но её нельзя доказанно связать с конкретной карточкой.";
}

function formatOpsTokens(tokens) {
  if (!tokens) return "—";
  if (tokens.state === "pending") return "считаются…";
  if (tokens.state === "unavailable") return "н/д";
  return `${formatNumber(tokens.total || 0)} ток`;
}

function opsPlainText(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number") return String(value).trim();
  if (Array.isArray(value)) return value.map(opsPlainText).filter(Boolean).join(" · ");
  if (typeof value === "object") {
    for (const key of ["label", "summary", "title", "detail", "message", "reason", "code", "name"]) {
      const text = opsPlainText(value[key]);
      if (text) return text;
    }
  }
  return "";
}

function opsContextHasConcreteContact(context) {
  const client = context?.client || {};
  const label = opsClientLabel(context).trim().toLowerCase();
  const missing = ["", "контакт не определён", "контакт не определен", "unknown"];
  return Boolean(context?.conversation_available && !missing.includes(label)
    && (client.name || client.username || client.contact_id || client.thread_id));
}

function opsContextHasConcreteEvent(op) {
  const context = op?.business_context || {};
  const event = context.event || {};
  const eventId = String(event.event_id || "").trim();
  const eventDate = String(event.date || "").trim().slice(0, 10);
  const terminal = new Set([
    "cancelled", "canceled", "done", "lost", "rejected", "declined",
    "hold_no_client", "archived", "ai-skip", "отмена", "отказ",
  ]);
  if (!eventId || !/^\d{4}-\d{2}-\d{2}$/.test(eventDate)) return false;
  if (terminal.has(String(event.status || "").trim().toLowerCase())) return false;
  const endOfEventDay = Date.parse(`${eventDate}T23:59:59`);
  return Number.isFinite(endOfEventDay) && endOfEventDay >= Date.now();
}

function opsIsActionableOperation(op) {
  if (!op || op.actionable === false || op.admission?.allowed === false) return false;
  return op.lead?.state === "exact"
    && opsContextHasConcreteContact(op.business_context || {})
    && opsContextHasConcreteEvent(op);
}

function opsActionableOperations(data) {
  return (data?.operations || []).filter(opsIsActionableOperation);
}

function opsHumanAction(op) {
  const supplied = opsPlainText(op.human_action);
  if (supplied && supplied !== "Обработка данных системой") return supplied;
  const planned = opsPlainText(op.business_context?.planned_action);
  return planned || OPS_PURPOSE_FALLBACK[op.purpose]?.[0] || "Назначение операции не записано";
}

function opsResultLabel(op) {
  if (op.result?.label) return op.result.label;
  if (op.status === "active") return OPS_PURPOSE_FALLBACK[op.purpose]?.[1] || "Операция выполняется; итог ещё не зафиксирован.";
  if (op.status === "failed") return "Операция завершилась ошибкой; полезное действие не подтверждено.";
  return OPS_PURPOSE_FALLBACK[op.purpose]?.[1] || "Модель вернула результат; внешний эффект не подтверждён.";
}

function opsSubjectLabel(op) {
  const context = op.business_context || {};
  const client = context.client || {};
  const event = context.event || {};
  const subject = op.subject || {};
  const contact = opsClientLabel(context);
  const orderId = client.order_id || subject.order_id;
  const eventLabel = opsEventLabel(context);
  const pieces = [];
  if (opsContextHasConcreteContact(context)) pieces.push(contact);
  if (orderId) pieces.push(`заказ ${orderId}`);
  if (event.event_id || event.date || event.city || event.venue) pieces.push(eventLabel);
  if (pieces.length) return pieces.join(" · ");
  if (subject.event_id) return `мероприятие ${subject.event_id}`;
  if (subject.trace_ref) return subject.trace_ref.replace(/^order:/, "заказ ").replace(/^event:/, "мероприятие ");
  return "Контекст операции не подтверждён";
}

function opsContextValue(value, empty = "не указано") {
  if (value === true) return "да";
  if (value === false) return "нет";
  if (value === null || value === undefined || value === "") return empty;
  return String(value);
}

function opsClientLabel(context) {
  const client = context?.client || {};
  const handle = client.username ? `@${client.username}` : "";
  return [client.name, handle].filter(Boolean).join(" · ") || "Контакт не определён";
}

function opsClientLink(context) {
  const label = escapeHtml(opsClientLabel(context));
  if (!opsContextHasConcreteContact(context) || !context?.operation_id) {
    return `<strong class="opsmap-contact-missing">${label}</strong>`;
  }
  return `<button type="button" class="opsmap-contact-link" data-opsmap-operation-id="${escapeHtml(String(context?.operation_id || ""))}" title="Открыть переписку с контактом">${label}</button>`;
}

async function openOpsmapConversation(operationId) {
  if (!operationId) return;
  const payload = await apiGet(`/api/opsmap/live-operations/${encodeURIComponent(operationId)}/conversation`);
  const threadId = String(payload.thread_id || "").trim();
  const telegramUrl = String(payload.telegram_url || "").trim();
  if (telegramUrl) {
    window.location.assign(telegramUrl);
    return;
  }
  if (!threadId) throw new Error("Переписка для этой операции не записана");
  // OpsMap is served by the legacy dashboard process; the Core conversation
  // reader lives on its dedicated app server. Navigate there explicitly
  // instead of showing an empty local Chats tab when the two ports differ.
  const coreApp = window.CORE_APP_URL || "http://127.0.0.1:8880/core-app.html";
  window.location.assign(`${coreApp}#chat/${encodeURIComponent(threadId)}`);
}

function opsEventLabel(context) {
  const event = context?.event || {};
  return [event.date, event.city, event.venue].filter(Boolean).join(" · ") || "Мероприятие пока не определено";
}

const OPS_LIVE_PLAN_LABEL = Object.freeze({
  unregistered_client_identity: "Контакт не зарегистрирован как клиент — автоответ запрещён.",
  provider_identity_conflict: "Конфликт идентификации контакта — действие остановлено.",
});

function opsLivePlanLabel(value, fallback) {
  const raw = String(value || "").trim();
  return OPS_LIVE_PLAN_LABEL[raw] || raw || fallback;
}

function opsContactRoleLabel(role) {
  const code = String(role || "unknown").toLowerCase();
  if (code.startsWith("client")) return code === "client_organizer" ? "клиент / организатор" : "клиент";
  if (code.includes("vocal") || code.includes("musician")) return code === "lcb_resident_vocalist" ? "штатный вокалист LCB" : "музыкант";
  if (code.startsWith("contractor") || code === "vendor") return "подрядчик";
  if (code === "team" || code.includes("internal")) return "команда LCB";
  if (code === "personal") return "личный контакт";
  return "статус не определён";
}

function opsOperationTrigger(op) {
  const context = op.business_context || {};
  const rawValue = op.trigger ?? context.trigger ?? {};
  const trigger = rawValue && typeof rawValue === "object" ? rawValue : {};
  const kind = String(trigger.kind || trigger.type || op.trigger_type || context.trigger_type || "").trim();
  const kindCode = kind.toLowerCase();
  const inferred = trigger.inferred === true;
  const source = opsPlainText(trigger.source || trigger.source_label || op.trigger_source || context.trigger_source);
  const sourceEventId = opsPlainText(
    trigger.source_event_id || trigger.event_id || trigger.message_id
    || op.source_event_id || context.source_event_id || context.message?.message_id || context.message?.id
  );
  const reason = opsPlainText(trigger.reason || trigger.detail || op.trigger_reason || context.trigger_reason);
  const explicitTitle = opsPlainText(
    typeof rawValue === "string" ? rawValue : (trigger.label || trigger.title || trigger.summary)
  );
  const contact = opsClientLabel(context);
  const isMessageTrigger = /message|inbound|new_message/.test(kindCode) || op.purpose === "unified_dm_handle";
  let title = explicitTitle;
  if (!title && isMessageTrigger) {
    title = inferred ? `Вероятный триггер: сообщение от ${contact}` : `Новое сообщение от ${contact}`;
  } else if (!title && (/follow.?up|schedule|timer/.test(kindCode) || op.purpose === "lcb_writer_followup")) {
    title = `Плановый follow-up для ${contact}`;
  } else if (!title && /card.?change|event.?change/.test(kindCode)) {
    title = `Изменение карточки ${contact}`;
  } else if (!title && /manual|operator/.test(kindCode)) {
    title = `Ручной запуск для ${contact}`;
  } else if (!title && /retry|replay/.test(kindCode)) {
    title = `Повтор операции для ${contact}`;
  } else if (!title && (source || kind)) {
    title = `Запуск: ${source || kind}`;
  }
  return {
    title: title || "Триггер не записан",
    detail: reason,
    source,
    sourceEventId,
    at: opsPlainText(trigger.at || trigger.ts || op.triggered_at || (isMessageTrigger ? context.message?.at : "") || op.started_at),
    kind,
    inferred,
    provenance: opsPlainText(trigger.provenance),
  };
}

function opsBusinessGoal(op) {
  const context = op.business_context || {};
  return opsPlainText(op.business_goal || context.business_goal || context.planned_action)
    || OPS_PURPOSE_FALLBACK[op.purpose]?.[0]
    || "Бизнес-цель не записана";
}

function opsAgentLabel(op) {
  const context = op.business_context || {};
  return opsPlainText(op.agent || context.agent || op.owner_label)
    || opsPlainText(op.process_node_id)
    || "Ответственный агент не записан";
}

function opsBusinessEffect(op) {
  const context = op.business_context || {};
  return opsPlainText(op.business_effect || context.business_effect) || opsResultLabel(op);
}

function opsOperationHeadline(op) {
  const trigger = opsOperationTrigger(op);
  return trigger.title === "Триггер не записан" ? opsHumanAction(op) : trigger.title;
}

const OPS_MODEL_ATTEMPT_STATUS = Object.freeze({
  success: "успешно",
  succeeded: "успешно",
  completed: "успешно",
  done: "успешно",
  ok: "успешно",
  active: "выполняется",
  running: "выполняется",
  pending: "ожидание",
  failed: "ошибка",
  error: "ошибка",
  timeout: "тайм-аут",
  escalated: "передано следующей модели",
  stopped: "остановлено",
  blocked: "заблокировано",
  skipped: "пропущено",
  cancelled: "отменено",
});

function opsModelAttemptState(status) {
  const code = String(status || "unknown").toLowerCase();
  if (["success", "succeeded", "completed", "done", "ok"].includes(code)) return "done";
  if (["active", "running", "pending"].includes(code)) return "active";
  if (["blocked", "skipped", "cancelled", "stopped"].includes(code)) return "blocked";
  if (["failed", "error", "timeout", "escalated"].includes(code)) return "failed";
  return "unknown";
}

function opsTokenNumber(...values) {
  const value = values.find((item) => item !== null && item !== undefined && item !== "");
  if (value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function opsModelAttempts(op) {
  const supplied = Array.isArray(op.model_attempts) ? op.model_attempts : [];
  const rows = supplied.length ? supplied : [{
    provider: op.provider,
    model: op.model,
    status: op.status === "failed" ? "failed" : (op.status === "active" ? "active" : "completed"),
    tokens: op.tokens,
  }];
  return rows.map((attempt, index) => {
    const tokens = attempt.tokens && typeof attempt.tokens === "object" ? attempt.tokens : {};
    const input = opsTokenNumber(attempt.input_tokens, attempt.input_tok, tokens.input, tokens.input_tok);
    const output = opsTokenNumber(attempt.output_tokens, attempt.output_tok, tokens.output, tokens.output_tok);
    const explicitTotal = opsTokenNumber(attempt.total_tokens, attempt.total_tok, tokens.total, tokens.total_tok);
    const total = explicitTotal ?? (input !== null || output !== null ? (input || 0) + (output || 0) : null);
    const error = opsPlainText(
      attempt.error || attempt.error_detail || attempt.failure || attempt.failure_reason || attempt.error_code
    );
    const status = String(
      attempt.status || attempt.state || attempt.outcome
      || (attempt.success === true ? "success" : "")
      || (error ? "failed" : "unknown")
    ).toLowerCase();
    const suppliedIndex = Number(attempt.sequence || attempt.attempt || index + 1);
    return {
      index: Number.isFinite(suppliedIndex) ? suppliedIndex : index + 1,
      tier: opsPlainText(attempt.configured_tier || attempt.tier),
      provider: opsPlainText(attempt.provider || attempt.service),
      model: opsPlainText(attempt.model || attempt.model_name),
      status,
      tokenState: opsPlainText(tokens.state || attempt.token_state || "actual"),
      input,
      output,
      total,
      error,
      fallbackReason: opsPlainText(attempt.fallback_reason || attempt.handoff_reason || attempt.retry_reason || attempt.reason),
    };
  }).sort((left, right) => left.index - right.index);
}

function opsModelName(attempt) {
  const values = [attempt.provider, attempt.model, attempt.tier]
    .filter((value) => value && value !== "unknown")
    .filter((value, index, all) => all.indexOf(value) === index);
  return values.join(" · ") || "Модель не записана";
}

function opsPrimaryModelLabel(op) {
  const attempts = opsModelAttempts(op);
  const successful = [...attempts].reverse().find((attempt) => opsModelAttemptState(attempt.status) === "done");
  return opsModelName(successful || attempts[attempts.length - 1]);
}

function opsAttemptTokensLabel(attempt) {
  if (attempt.tokenState === "pending") return "токены считаются…";
  if (attempt.tokenState === "unavailable" && attempt.total === null) return "токены не записаны";
  const value = (token) => token === null ? "—" : formatNumber(token);
  return `вход ${value(attempt.input)} · выход ${value(attempt.output)} · всего ${value(attempt.total)}`;
}

function renderOpsmapModelChain(op) {
  const attempts = opsModelAttempts(op);
  const operationTotal = opsTokenNumber(op.tokens?.total);
  const attemptTotal = attempts.reduce((sum, attempt) => sum + (attempt.total || 0), 0);
  const hasActualAttempts = attempts.some((attempt) => attempt.tokenState === "actual" && attempt.total !== null);
  const hasActualOperationTotal = op.tokens?.state === "actual" && operationTotal !== null;
  const total = operationTotal && operationTotal > 0 ? operationTotal : attemptTotal;
  const totalLabel = hasActualOperationTotal || hasActualAttempts
    ? `${formatNumber(total || 0)} ток`
    : (op.tokens?.state === "pending" ? "токены считаются…" : "токены н/д");
  const attemptWord = attempts.length % 10 === 1 && attempts.length % 100 !== 11
    ? "попытка"
    : ([2, 3, 4].includes(attempts.length % 10) && ![12, 13, 14].includes(attempts.length % 100) ? "попытки" : "попыток");
  return `<details class="opsmap-model-chain">
    <summary><span>Модели и токены</span><strong>${attempts.length} ${attemptWord} · ${escapeHtml(totalLabel)}</strong></summary>
    <ol>
      ${attempts.map((attempt, index) => {
        const state = opsModelAttemptState(attempt.status);
        const previous = index ? attempts[index - 1] : null;
        const handoffReason = attempt.fallbackReason || previous?.error || previous?.fallbackReason || "";
        return `<li class="is-${escapeHtml(state)}">
          ${index ? `<p class="opsmap-model-handoff"><span>Почему переключились</span>${escapeHtml(handoffReason || "Причина переключения не записана")}</p>` : ""}
          <div class="opsmap-model-attempt-head"><span>${index + 1}</span><strong>${escapeHtml(opsModelName(attempt))}</strong><b>${escapeHtml(OPS_MODEL_ATTEMPT_STATUS[attempt.status] || attempt.status || "статус не записан")}</b></div>
          <p class="opsmap-model-token-split">${escapeHtml(opsAttemptTokensLabel(attempt))}</p>
          ${attempt.error ? `<p class="opsmap-model-error"><span>Почему не сработало</span>${escapeHtml(attempt.error)}</p>` : ""}
        </li>`;
      }).join("")}
    </ol>
    <p class="opsmap-model-proof">Здесь показаны технические попытки модели. Они не доказывают отправку сообщения или изменение заказа.</p>
  </details>`;
}

function renderOpsmapLiveIdentity(op) {
  const context = op.business_context || {};
  const client = context.client || {};
  const order = client.order_id ? `заказ ${client.order_id}` : "заказ не определён";
  const event = opsEventLabel(context);
  const goal = opsBusinessGoal(op);
  const contact = context.conversation_available
    ? opsClientLink({ ...context, operation_id: op.operation_id })
    : `<strong>${escapeHtml(opsClientLabel(context))}</strong>`;
  const conversationNote = context.conversation_available ? "" : '<small class="opsmap-live-no-conversation">переписка не записана</small>';
  return `
    <div class="opsmap-live-identity">
      <div><span>Контакт</span>${contact}<small>Статус: ${escapeHtml(opsContactRoleLabel(client.role))}</small>${conversationNote}</div>
      <div><span>Заказ / мероприятие</span><strong>${escapeHtml(`${order} · ${event}`)}</strong></div>
    </div>
    <p class="opsmap-live-action"><span>Зачем</span>${escapeHtml(goal)}</p>`;
}

function renderOpsmapBusinessContext(op, compact = false) {
  const context = op.business_context || {};
  const trigger = opsOperationTrigger(op);
  const message = opsPlainText(context.message?.text);
  const goal = opsBusinessGoal(op);
  const goalRecord = op.business_goal || context.business_goal || {};
  const goalInferred = Boolean(
    goalRecord && typeof goalRecord === "object" && goalRecord.inferred === true
  );
  const agent = opsAgentLabel(op);
  const action = opsHumanAction(op);
  const effect = opsBusinessEffect(op);
  const deliveryCode = String(context.planned_action?.delivery || op.business_effect?.delivery || "").toLowerCase();
  const deliveryLabel = ({
    not_sent: "не отправлено",
    drafted: "создан черновик",
    approval: "на согласовании",
    sent: "отправлено, доставка не доказана",
    delivered: "доставка подтверждена",
    recorded: "изменение записано",
  })[deliveryCode] || "внешний эффект не подтверждён";
  const basis = context.decision_basis || [];
  const changes = context.card_changes || [];
  const triggerMeta = [
    trigger.source ? `источник: ${trigger.source}` : "",
    trigger.sourceEventId ? `событие: ${trigger.sourceEventId}` : "",
    trigger.at ? `время: ${trigger.at}` : "",
    trigger.inferred ? "причина восстановлена по ближайшему контексту" : "",
  ].filter(Boolean).join(" · ");
  const clientOrder = context.client?.order_id ? `заказ ${context.client.order_id}` : "заказ не записан";
  const changeHtml = changes.length
    ? `<div class="opsmap-card-changes">
        <strong>Что изменилось в карточке</strong>
        ${changes.map((change) => `<div class="opsmap-change-row"><span>${escapeHtml(change.label || change.field || "Поле")}</span><del>${escapeHtml(opsContextValue(change.before, "не было"))}</del><b>→</b><ins>${escapeHtml(opsContextValue(change.after, "очищено"))}</ins></div>`).join("")}
      </div>`
    : (op.result?.code === "card_refreshed" && !compact
      ? '<p class="opsmap-change-empty">Для этой операции точный снимок «до» не записан. Ниже показан доступный текущий контекст карточки.</p>'
      : "");
  return `
    <section class="opsmap-business-context ${compact ? "is-compact" : ""}">
      <div class="opsmap-context-trigger">
        <span>Что запустило процесс</span>
        <strong>${escapeHtml(trigger.title)}</strong>
        ${triggerMeta ? `<small>${escapeHtml(triggerMeta)}</small>` : ""}
        ${trigger.detail ? `<p>${escapeHtml(trigger.detail)}</p>` : ""}
      </div>
      <div class="opsmap-context-grid">
        <div><span>Контакт</span>${opsClientLink({ ...context, operation_id: op.operation_id })}<small>${escapeHtml(`${opsContactRoleLabel(context.client?.role)} · ${context.client?.channel || "канал не записан"}`)}</small></div>
        <div><span>Заказ / мероприятие</span><strong>${escapeHtml(`${clientOrder} · ${opsEventLabel(context)}`)}</strong><small>${escapeHtml(context.event?.status || "статус не указан")}</small></div>
      </div>
      <div class="opsmap-context-message"><span>Сообщение / входные данные</span><blockquote>${escapeHtml(message || "Содержимое события не записано в журнале.")}</blockquote></div>
      <div class="opsmap-context-story-grid">
        <div class="opsmap-context-goal"><span>Зачем запущено</span><strong>${escapeHtml(goal)}</strong>${goalInferred ? "<small>Цель восстановлена по назначению процесса, а не записана в исходном событии.</small>" : ""}</div>
        <div class="opsmap-context-agent"><span>Кто и что делал</span><strong>${escapeHtml(agent)}</strong><p>${escapeHtml(action)}</p></div>
      </div>
      <div class="opsmap-context-effect"><span>Бизнес-результат</span><strong>${escapeHtml(effect)}</strong><small>${escapeHtml(deliveryLabel)}</small></div>
      ${!compact && basis.length ? `<div class="opsmap-context-basis"><span>Почему выбран этот шаг</span><ul>${basis.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></div>` : ""}
      ${changeHtml}
    </section>`;
}

function setOpsmapTechnicalVisible(visible) {
  state.opsTechnicalVisible = Boolean(visible);
  const panel = document.querySelector("#screen-opsmap .flow-map-panel");
  const toggle = byId("opsmap-tech-toggle");
  const title = byId("opsMapTitle");
  if (panel) panel.classList.toggle("is-technical-view", state.opsTechnicalVisible);
  if (toggle) {
    toggle.setAttribute("aria-pressed", String(state.opsTechnicalVisible));
    toggle.textContent = state.opsTechnicalVisible ? "Показать клиентскую цепочку" : "Показать карту процессов";
  }
  if (title && state.opsTechnicalVisible) title.textContent = "Карта процессов";
  else if (title && !state.opsSelectedOperation) title.textContent = "Клиентские операции";
  if (state.opsTechnicalVisible && state.opsMapSvg) {
    window.requestAnimationFrame(() => state.opsMapSvg.showReadableStart());
  }
}

function renderOpsmapHumanOverview() {
  const host = byId("opsmap-human-journey");
  const title = byId("opsMapTitle");
  if (!host) return;
  if (title) title.textContent = "Клиентские операции";
  const steps = [
    ["1", "Получен триггер", "Фиксируем источник, автора и конкретное событие запуска."],
    ["2", "Карточка связана", "Связываем действие с отдельной карточкой заказа или события."],
    ["3", "Собран контекст", "Поднимаем историю, договорённости и подтверждённые факты."],
    ["4", "Определён следующий шаг", "Решаем: ответить, уточнить, поставить на согласование или остановить."],
    ["5", "Подготовлен результат", "Модель создаёт классификацию, черновик или предложение действия."],
    ["6", "Проверено", "Проверяем факты, адресата и ограничения до внешнего действия."],
    ["7", "Подтверждён эффект", "Отдельно доказываем запись, отправку или доставку."],
  ];
  host.innerHTML = `
    <div class="opsmap-human-intro">
      <div><span class="opsmap-human-kicker">Путь одной операции</span><h3>Выберите операцию справа</h3><p>Карта покажет только те шаги, которые реально выполнились, и честно отделит результат модели от отправки или доставки.</p></div>
      <span class="opsmap-human-readonly">read-only</span>
    </div>
    <ol class="opsmap-human-steps is-overview">
      ${steps.map(([num, stepTitle, detail]) => `<li class="opsmap-human-step is-idle"><span class="opsmap-step-index">${num}</span><div><strong>${escapeHtml(stepTitle)}</strong><p>${escapeHtml(detail)}</p></div></li>`).join("")}
    </ol>`;
  setOpsmapTechnicalVisible(true);
}

function renderOpsmapOperationJourney(op) {
  const host = byId("opsmap-human-journey");
  const title = byId("opsMapTitle");
  if (!host) return;
  const action = opsHumanAction(op);
  const headline = opsOperationHeadline(op);
  const trigger = opsOperationTrigger(op);
  const result = opsResultLabel(op);
  const effectState = op.result?.effect_state || (op.status === "active" ? "working" : "proposal_ready");
  const effectLabel = OPS_EFFECT_LABEL[effectState] || OPS_STATUS_LABEL[op.status] || effectState;
  const recordedSteps = op.journey || [
    { step_id: "work", state: op.status === "active" ? "active" : "done", title: action, detail: result },
  ];
  const steps = [
    {
      step_id: "trigger",
      state: trigger.title === "Триггер не записан" || trigger.inferred ? "warning" : "done",
      title: trigger.title,
      detail: trigger.detail || (trigger.title === "Триггер не записан" ? "Источник запуска отсутствует в телеметрии." : "Источник запуска зафиксирован выше."),
    },
    ...recordedSteps.filter((step) => {
      const stepId = String(step.step_id || "");
      return stepId !== "trigger" && !stepId.startsWith("model_");
    }),
  ];
  if (title) title.textContent = headline;
  host.innerHTML = `
    <div class="opsmap-result-hero is-${escapeHtml(effectState)}">
      <div>
        <span class="opsmap-human-kicker">${escapeHtml(opsSubjectLabel(op))}</span>
        <h3>${escapeHtml(headline)}</h3>
        <p>${escapeHtml(`${opsBusinessGoal(op)} · ${result}`)}</p>
      </div>
      <span class="opsmap-effect-pill">${escapeHtml(effectLabel)}</span>
    </div>
    ${renderOpsmapBusinessContext(op)}
    <ol class="opsmap-human-steps">
      ${steps.map((step, index) => `
        <li class="opsmap-human-step is-${escapeHtml(step.state || "idle")}">
          <span class="opsmap-step-index">${index + 1}</span>
          <div><strong>${escapeHtml(step.title || "Шаг")}</strong><p>${escapeHtml(step.detail || "")}</p></div>
        </li>`).join("")}
    </ol>
    ${renderOpsmapModelChain(op)}
    <div class="opsmap-next-step"><span>Что дальше</span><strong>${escapeHtml(op.result?.next_step || "Проверить результат перед внешним действием.")}</strong></div>
    <p class="opsmap-proof-note">${escapeHtml(op.proof_note || "AI-операция сама по себе не доказывает отправку или доставку.")}</p>`;
  setOpsmapTechnicalVisible(false);
}

function renderOpsmapTelegramMonitor() {
  const host = byId("opsmap-telegram-monitor");
  if (!host) return;
  const runtime = state.runtimeStatus;
  if (!runtime?.readiness) {
    host.className = "opsmap-tg-monitor is-unknown";
    host.innerHTML = '<strong>Telegram-посты</strong><span>Recovery ledger пока не загружен.</span>';
    return;
  }
  const readiness = runtime.readiness || {};
  const catchup = readiness.catchup || {};
  const counters = readiness.counters || {};
  const completed = Number(catchup.sources_completed || 0);
  const total = Number(catchup.sources_total || 0);
  const processingResidual = Number(catchup.processing_residual || 0);
  const readResidual = Number(catchup.ack_residual || 0);
  const posts = Number(counters.posts_processed_24h || 0);
  const recovered = Number(counters.recovery_unread_processed || 0);
  const pendingSources = Array.isArray(catchup.pending_sources) ? catchup.pending_sources : [];
  const catchupActive = total > 0 && (completed < total || processingResidual > 0 || readResidual > 0);
  const mode = catchupActive ? "realtime + догон" : "realtime";
  const windowMark = readiness.complete_window ? "" : "*";
  const modeDetail = catchupActive
    ? "Новые посты принимает Telegram NewMessage. Recovery отдельно идёт от старых к новым до зафиксированного target каждого event-чата."
    : "Новые посты принимает Telegram NewMessage; завершённые источники остаются под cursor-контролем.";
  const pendingHtml = pendingSources.length
    ? `<details class="opsmap-tg-pending"><summary>Не завершены: ${pendingSources.length}</summary><p>${pendingSources.map(escapeHtml).join(" · ")}</p></details>`
    : '<p class="opsmap-tg-complete">Все обязательные event-чаты завершили текущий recovery-cycle.</p>';
  host.className = `opsmap-tg-monitor ${catchupActive ? "is-catching-up" : "is-realtime"}`;
  host.innerHTML = `
    <div class="opsmap-tg-head">
      <div><span>Telegram · посты</span><strong>Монитор event-чатов</strong></div>
      <b>${escapeHtml(mode)}</b>
    </div>
    <p class="opsmap-tg-method"><span>Как смотрит</span>${escapeHtml(modeDetail)}</p>
    <div class="opsmap-tg-stats">
      <div><span>Источники</span><strong>${formatNumber(completed)} / ${formatNumber(total)}</strong></div>
      <div><span>Обработано · 24ч</span><strong>${formatNumber(posts)}${windowMark}</strong></div>
      <div><span>После восстановления</span><strong>${formatNumber(recovered)}</strong></div>
    </div>
    <div class="opsmap-tg-residuals">
      <span>Ждут обработки: <strong>${formatNumber(processingResidual)}</strong></span>
      <span>Ждут read-ack: <strong>${formatNumber(readResidual)}</strong></span>
    </div>
    ${pendingHtml}
    <p class="opsmap-tg-proof">Увиден ≠ обработан ≠ прочитан. Питч считается доставленным только по provider delivery receipt.</p>`;
}

async function refreshOpsmapTelegramMonitor(force = false) {
  const now = Date.now();
  if (state.opsTelegramLoading) return;
  if (!force && state.runtimeStatus && now - state.runtimeStatusRefreshedAt < 20000) {
    renderOpsmapTelegramMonitor();
    return;
  }
  state.opsTelegramLoading = true;
  try {
    state.runtimeStatus = await apiGet(API.runtimeStatus);
    state.runtimeStatusRefreshedAt = Date.now();
    renderRuntimeStatus();
  } catch (_error) {
    renderOpsmapTelegramMonitor();
  } finally {
    state.opsTelegramLoading = false;
  }
}

function renderOpsmapLiveOps() {
  const list = byId("opsmap-live-list");
  const statusEl = byId("opsmap-live-status");
  if (!list) return;
  const data = state.opsLiveOps;
  if (!data) {
    list.innerHTML = '<div class="opsmap-live-empty">Загрузка операций…</div>';
    if (statusEl) statusEl.textContent = "";
    return;
  }
  const selectedId = state.opsSelectedOperation?.operation_id;
  const allOps = (data.operations || []).slice(0, 200);
  const ops = allOps.filter(opsIsActionableOperation).sort((left, right) => {
    const selectedRank = Number(right.operation_id === selectedId) - Number(left.operation_id === selectedId);
    if (selectedRank) return selectedRank;
    return Number(right.status === "active") - Number(left.status === "active");
  });
  const serverBlocked = Number(
    data.watermarks?.timeline?.blocked_without_context
    || data.watermarks?.timeline?.blocked_without_business_context
    || data.blocked_without_context_count
    || 0
  );
  const excludedAuditRows = allOps.length - ops.length;
  const classifications = Number(data.watermarks?.timeline?.classification_count || 0);
  const classificationLabel = classifications ? ` · классификаций отдельно: ${classifications}` : "";
  const blockedLabel = serverBlocked ? ` · до AI заблокировано без контакта/мероприятия: ${serverBlocked}` : "";
  const excludedLabel = excludedAuditRows ? ` · скрыто непривязанных записей аудита: ${excludedAuditRows}` : "";
  if (!ops.length) {
    list.innerHTML = '<div class="opsmap-live-empty"><strong>Нет рабочих операций с подтверждённым контактом и мероприятием</strong><span>Непривязанные записи исключены из рабочего списка; их прошлые расходы, если они были, остаются в аудите.</span></div>';
    if (statusEl) statusEl.textContent = `0 рабочих операций${blockedLabel}${excludedLabel}${classificationLabel} · окно ${data.watermarks?.timeline?.window_s || "—"}с`;
    return;
  }
  if (statusEl) statusEl.textContent = `${ops.length} рабочих операций${blockedLabel}${excludedLabel}${classificationLabel} · окно ${data.watermarks?.timeline?.window_s || "—"}с`;
  list.innerHTML = ops.map((op) => {
    const status = OPS_STATUS_LABEL[op.status] || op.status;
    const lead = OPS_LEAD_LABEL[op.lead?.state] || OPS_LEAD_LABEL.unlinked;
    const leadHelp = opsLeadHelp(op);
    const selected = state.opsSelectedOperation?.operation_id === op.operation_id;
    const when = op.started_at ? flowFormatTime(op.started_at) : "—";
    const headline = opsOperationHeadline(op);
    const result = opsResultLabel(op);
    const effectState = op.result?.effect_state || (op.status === "active" ? "working" : "proposal_ready");
    return `
      <article class="opsmap-live-card ${selected ? "is-active" : ""} is-effect-${escapeHtml(effectState)}" tabindex="0" role="button" data-op-id="${escapeHtml(op.operation_id)}" aria-label="${escapeHtml(`${headline}. ${result}`)}">
        <div class="opsmap-live-top">
          <span class="opsmap-live-status-pill">${escapeHtml(status)}</span>
          <span class="opsmap-live-when">${escapeHtml(when)}</span>
        </div>
        <h3>${escapeHtml(headline)}</h3>
        ${renderOpsmapLiveIdentity(op)}
        <div class="opsmap-live-model"><span>Модель</span><strong>${escapeHtml(opsPrimaryModelLabel(op))}</strong><b>${escapeHtml(formatOpsTokens(op.tokens))}</b></div>
        <div class="opsmap-live-chips">
          <span class="opsmap-live-effect is-${escapeHtml(effectState)}">${escapeHtml(OPS_EFFECT_LABEL[effectState] || status)}</span>
          <span class="opsmap-live-lead ${lead.className}">${escapeHtml(lead.text)}${op.lead?.state === "ambiguous" ? ` · ${op.lead.candidate_refs.length}` : ""}</span>
          <span class="opsmap-live-help" tabindex="0" role="img" aria-label="${escapeHtml(leadHelp)}" data-tooltip="${escapeHtml(leadHelp)}">?</span>
        </div>
      </article>
    `;
  }).join("");
}

async function refreshOpsmapLiveOps(force = false) {
  const now = Date.now();
  if (state.opsLiveOpsLoading) return;
  if (!force && state.opsLiveOpsRefreshedAt && now - state.opsLiveOpsRefreshedAt < 3000) return;
  state.opsLiveOpsLoading = true;
  const statusEl = byId("opsmap-live-status");
  if (statusEl) statusEl.textContent = "Обновление…";
  try {
    const params = new URLSearchParams({ window_s: "3000", limit: "200", actionable_only: "1" });
    const envelope = await apiGet(`${window.API_OPSMAP_LIVE_OPS || "/api/opsmap/live-operations"}?${params.toString()}`);
    state.opsLiveOps = envelope.data || {};
    state.opsLiveOpsRefreshedAt = Date.now();
    renderOpsmapLiveOps();
    const operations = opsActionableOperations(state.opsLiveOps);
    const selected = operations.find((item) => item.operation_id === state.opsSelectedOperation?.operation_id);
    if (selected) {
      state.opsSelectedOperation = selected;
      renderOpsmapOperationJourney(selected);
    } else {
      const live = operations.find((item) => item.status === "active") || operations[0];
      if (live) {
        await selectLiveOperation(live);
      } else if (state.opsSelectedOperation) {
        clearLiveTrace();
      } else {
        renderOpsmapHumanOverview();
      }
    }
  } catch (error) {
    if (statusEl) statusEl.textContent = `live-ops недоступны: ${escapeHtml(error.message)}`;
  } finally {
    state.opsLiveOpsLoading = false;
  }
}

function startOpsmapLivePolling() {
  stopOpsmapLivePolling();
  refreshOpsmapLiveOps(true);
  refreshOpsmapTelegramMonitor(true);
  state.opsLiveOpsInterval = window.setInterval(() => {
    if (state.activeView === "opsmap") {
      refreshOpsmapLiveOps();
      refreshOpsmapTelegramMonitor();
    }
  }, 4000);
}

function stopOpsmapLivePolling() {
  if (state.opsLiveOpsInterval) {
    window.clearInterval(state.opsLiveOpsInterval);
    state.opsLiveOpsInterval = null;
  }
}

async function selectLiveOperation(op) {
  if (!opsIsActionableOperation(op)) return;
  state.opsSelectedOperation = op;
  renderOpsmapLiveOps();
  renderOpsmapOperationJourney(op);
  const header = byId("opsmap-trace-header");
  const title = byId("opsmap-trace-title");
  if (op.process_node_id && state.opsMapSvg) {
    state.opsMapSvg.activeNodeId = op.process_node_id;
    state.opsMapSvg.focusNode(op.process_node_id);
    state.opsMapSvg.render();
  }
  if (op.lead?.state === "exact" && op.lead.trace_ref) {
    state.opsTraceRef = op.lead.trace_ref;
    if (header) header.hidden = false;
    if (title) title.innerHTML = `<strong>${escapeHtml(opsOperationHeadline(op))}</strong><span> · ${escapeHtml(op.lead.trace_ref)} · ${escapeHtml(formatOpsTokens(op.tokens))}</span>`;
    try {
      await state.opsMapSvg.loadTrace(op.lead.trace_ref);
    } catch (err) {
      if (title) title.innerHTML += ` <span class="flow-warning">трасса не загружена: ${escapeHtml(err.message)}</span>`;
    }
  } else {
    state.opsTraceRef = null;
    if (state.opsMapSvg) state.opsMapSvg.clearTrace();
    if (header) header.hidden = false;
    const reason = op.lead?.state === "ambiguous"
      ? "нужно выбрать конкретную карточку"
      : "связь с карточкой пока не доказана";
    if (title) title.innerHTML = `<strong>${escapeHtml(opsOperationHeadline(op))}</strong><span> · ${escapeHtml(reason)}</span>`;
  }
}

function clearLiveTrace() {
  state.opsSelectedOperation = null;
  state.opsTraceRef = null;
  if (state.opsMapSvg) {
    state.opsMapSvg.activeNodeId = null;
    state.opsMapSvg.clearTrace();
  }
  const header = byId("opsmap-trace-header");
  if (header) header.hidden = true;
  renderOpsmapHumanOverview();
  setOpsmapTechnicalVisible(true);
  renderOpsmapLiveOps();
}

async function refreshOpsmap(force = false) {
  const now = Date.now();
  if (state.opsLoading) return;
  if (!force && state.opsRefreshedAt && now - state.opsRefreshedAt < 60000) return;
  state.opsLoading = true;
  byId("opsFreshness").textContent = "Обновление…";
  const params = new URLSearchParams({ contour: state.opsContour, period_days: String(state.opsPeriod) });
  try {
    state.opsmap = await apiGet(`${API.opsmap}?${params.toString()}`);
    state.opsDisabled = false;
    state.opsRefreshedAt = Date.now();
    state.opsSelected = null;
    renderOpsmap();
  } catch (error) {
    if (error.status === 404) {
      state.opsmap = null;
      renderOpsmapDisabled("LCB_OPSMAP_ENABLED не установлен; endpoint отвечает 404 по дизайну.");
    } else {
      byId("opsFreshness").textContent = "OpsMap недоступна";
      byId("opsMapCanvas").innerHTML = `<div class="flow-error"><strong>Не удалось собрать OpsMap</strong><span>${escapeHtml(error.message)}</span></div>`;
    }
  } finally {
    state.opsLoading = false;
  }
}

async function opsRevealPii(nodeId) {
  let token = window.sessionStorage.getItem("opsmapAdminToken") || "";
  if (!token) {
    token = window.prompt("X-Admin-Token (раскрытие PII пишется в audit):", "");
    if (!token) return;
    window.sessionStorage.setItem("opsmapAdminToken", token);
  }
  const target = byId("opsRevealed");
  if (target) target.textContent = "Запрос раскрытия…";
  try {
    const response = await fetch(API.opsmapReveal, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json", "X-Admin-Token": token },
      body: JSON.stringify({ node_id: nodeId }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 403) window.sessionStorage.removeItem("opsmapAdminToken");
      throw new Error(payload.error || `HTTP ${response.status}`);
    }
    const node = payload.node || {};
    const facts = Object.entries(node.facts || {})
      .map(([key, value]) => `<div class="ops-fact"><span>${escapeHtml(key)}</span><code>${escapeHtml(typeof value === "object" ? JSON.stringify(value) : String(value))}</code></div>`)
      .join("");
    if (target) {
      target.innerHTML = `<div class="ops-revealed-box"><h3>PII раскрыта · записано в audit</h3>
        <div class="ops-fact"><span>label</span><code>${escapeHtml(node.label || "")}</code></div>${facts}</div>`;
    }
  } catch (error) {
    if (target) target.innerHTML = `<div class="flow-warning"><b>!</b><span>Раскрытие не выполнено: ${escapeHtml(error.message)}</span></div>`;
  }
}

function changePromoFilters(changes) {
  Object.assign(state.promoFilters, changes, { page: changes.page || 1 });
  state.promoRefreshedAt = 0;
  refreshPromo(true);
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

async function refreshAll(force = false) {
  if (state.loading) return;
  state.loading = true;
  byId("refreshButton").disabled = true;
  setConnection("loading", "Обновление");
  try {
    // Sequential groups to avoid overwhelming the single-threaded Flask dev server
    // and to prevent net::ERR_EMPTY_RESPONSE on high parallelism.
    const [healthResult, autonomyResult, summaryResult, runtimeStatusResult] = await Promise.allSettled([
      apiGet(API.health),
      apiGet(API.autonomy),
      apiGet(API.summary),
      apiGet(`${API.runtimeStatus}${force ? "?force=1" : ""}`),
    ]);
    const [feesResult, costumesResult, threadsResult] = await Promise.allSettled([
      apiGet(API.fees),
      apiGet(API.costumes),
      apiGet(`${API.threads}?limit=200`),
    ]);
    const [coordinationResult, workResult, operationsResult] = await Promise.allSettled([
      apiGet(API.coordinationCases),
      apiGet(API.work),
      apiGet(API.operations),
    ]);
    const results = [healthResult, autonomyResult, summaryResult, runtimeStatusResult, feesResult, costumesResult, threadsResult, coordinationResult, workResult, operationsResult];
    if (healthResult.status !== "fulfilled" || threadsResult.status !== "fulfilled") {
      const failure = healthResult.status === "rejected" ? healthResult.reason : threadsResult.reason;
      throw failure instanceof Error ? failure : new Error(String(failure || "Core read failed"));
    }
    const health = healthResult.value;
    const threadsPayload = threadsResult.value;
    state.health = health;
    if (runtimeStatusResult.status === "fulfilled") {
      state.runtimeStatus = runtimeStatusResult.value;
      state.runtimeStatusRefreshedAt = Date.now();
    }
    if (autonomyResult.status === "fulfilled") state.autonomy = autonomyResult.value;
    if (summaryResult.status === "fulfilled") state.summary = summaryResult.value;
    if (feesResult.status === "fulfilled") state.fees = feesResult.value;
    if (costumesResult.status === "fulfilled") {
      state.costumes = costumesResult.value;
      state.costumesRefreshedAt = Date.now();
    }
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
    renderCostumes();
    renderBroadcast();
    renderAutonomy();
    renderRuntimeStatus();
    renderManualSendState();
    updateCounts();
    const partial = results.some((result, index) => ![0, 6].includes(index) && result.status === "rejected");
    setConnection(
      health.ok ? "ok" : "error",
      health.ok ? (partial ? "Core доступен · часть данных" : "Core доступен") : "Core неполон",
    );
    if (state.selectedEventId) await openEvent(state.selectedEventId, false);
  } catch (error) {
    setConnection("error", "Core недоступен");
    setRuntimeChip("runtimeProcesses", "unknown", "Core недоступен — статус процессов не обновлён");
    setRuntimeChip("runtimeV1", "unknown", "Core недоступен — статус V1 не обновлён");
    setRuntimeChip("runtimeV2", "unknown", "Core недоступен — статус V2 не обновлён");
    setRuntimeChip("runtimeSsh", "unknown", "Core недоступен — SSH не проверен");
    toast(`Не удалось прочитать Core: ${error.message}`);
  } finally {
    state.loading = false;
    byId("refreshButton").disabled = false;
  }
}

function bindEvents() {
  document.querySelectorAll(".tab-button").forEach((button) => {
    button.addEventListener("click", () => {
      if (Date.now() < navSuppressClickUntil) return;
      location.hash = button.dataset.view;
    });
  });
  document.querySelectorAll("[data-chat-folder]").forEach((button) => {
    button.addEventListener("click", () => {
      state.chatFolder = button.dataset.chatFolder;
      renderThreads();
    });
  });
  byId("channelFilter").addEventListener("change", (event) => {
    state.channel = event.target.value;
    // выбор другого канала выводит из папки канала — иначе папка и фильтр
    // спорят друг с другом и список молча пустеет
    if (CHANNEL_FOLDERS[state.chatFolder]
        && state.channel !== CHANNEL_FOLDERS[state.chatFolder]) {
      state.chatFolder = "all";
    }
    renderThreads();
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
    filterCancelled: "cancelled",
    filterStagePerformed: "performed",
    filterStageContentPending: "content_pending",
    filterStageContentReceived: "content_received",
    filterStagePrepayment: "prepayment",
    filterStageContract: "contract",
    filterStageConfirmed: "confirmed",
    filterStageNegotiating: "negotiating",
    filterStageLead: "lead",
    filterStageFollowupWaiting: "followup_waiting",
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
  byId("flowPeriod").addEventListener("change", (event) => {
    state.flowPeriod = Number(event.target.value || 90);
    state.flowRefreshedAt = 0;
    refreshFlow(true);
  });
  byId("flowSource").addEventListener("change", (event) => {
    state.flowSource = event.target.value;
    state.flowSelected = null;
    renderFlow();
  });
  let flowSearchTimer;
  byId("flowSearch").addEventListener("input", (event) => {
    window.clearTimeout(flowSearchTimer);
    flowSearchTimer = window.setTimeout(() => {
      state.flowQuery = event.target.value.trim();
      state.flowSelected = null;
      renderFlow();
    }, 140);
  });
  byId("flowReload").addEventListener("click", () => refreshFlow(true));
  byId("opsContour").addEventListener("change", (event) => {
    state.opsContour = event.target.value || "all";
    state.opsRefreshedAt = 0;
    refreshOpsmap(true);
  });
  byId("opsPeriod").addEventListener("change", (event) => {
    state.opsPeriod = Number(event.target.value || 90);
    state.opsRefreshedAt = 0;
    refreshOpsmap(true);
  });
  byId("opsEvidence").addEventListener("change", async (event) => {
    state.opsEvidence = event.target.value;
    state.opsSelected = null;
    await renderOpsmap();
  });
  byId("opsStopped").addEventListener("change", async (event) => {
    state.opsStopped = event.target.value;
    state.opsSelected = null;
    await renderOpsmap();
  });
  byId("opsDepth").addEventListener("change", async (event) => {
    state.opsDepth = event.target.value || "node";
    state.opsSelected = null;
    await renderOpsmapMap();
  });
  byId("opsMode").addEventListener("change", async (event) => {
    state.opsMode = event.target.value || "all";
    state.opsSelected = null;
    await renderOpsmapMap();
  });
  let opsSearchTimer;
  byId("opsSearch").addEventListener("input", (event) => {
    window.clearTimeout(opsSearchTimer);
    opsSearchTimer = window.setTimeout(async () => {
      state.opsQuery = event.target.value.trim();
      state.opsSelected = null;
      await renderOpsmapMap();
    }, 140);
  });
  byId("opsReload").addEventListener("click", () => {
    refreshOpsmap(true);
    refreshOpsmapLiveOps(true);
  });
  byId("opsmap-live-list").addEventListener("click", async (event) => {
    const contact = event.target.closest("[data-opsmap-operation-id]");
    if (contact) {
      event.stopPropagation();
      await openOpsmapConversation(contact.dataset.opsmapOperationId);
      return;
    }
    const card = event.target.closest("[data-op-id]");
    if (!card) return;
    const opId = card.dataset.opId;
    const op = (state.opsLiveOps?.operations || []).find((item) => item.operation_id === opId);
    if (op) await selectLiveOperation(op);
  });
  byId("opsmap-human-journey").addEventListener("click", async (event) => {
    const contact = event.target.closest("[data-opsmap-operation-id]");
    if (!contact) return;
    await openOpsmapConversation(contact.dataset.opsmapOperationId);
  });
  byId("opsmap-live-list").addEventListener("keydown", async (event) => {
    if (!['Enter', ' '].includes(event.key)) return;
    const card = event.target.closest("[data-op-id]");
    if (!card) return;
    event.preventDefault();
    const op = (state.opsLiveOps?.operations || []).find((item) => item.operation_id === card.dataset.opId);
    if (op) await selectLiveOperation(op);
  });
  byId("opsmap-tech-toggle").addEventListener("click", () => {
    setOpsmapTechnicalVisible(!state.opsTechnicalVisible);
  });
  byId("opsmap-trace-close").addEventListener("click", clearLiveTrace);
  document.addEventListener("keydown", async (ev) => {
    if (ev.key === "/" && !["INPUT", "TEXTAREA", "SELECT"].includes(ev.target.tagName)) {
      ev.preventDefault();
      const input = byId("opsmap-lead-q");
      if (input && state.opsMapSvg) {
        byId("opsMode").value = "lead";
        state.opsMode = "lead";
        await renderOpsmapMap();
        input.focus();
      }
    }
  });
  byId("flowMapCanvas").addEventListener("click", (event) => {    const node = event.target.closest("[data-flow-node]");
    if (node) {
      state.flowSelected = { kind: "node", key: node.dataset.flowNode };
      renderFlow();
      return;
    }
    const edge = event.target.closest("[data-flow-edge]");
    if (edge) {
      const [from, to, evidence] = edge.dataset.flowEdge.split("|");
      state.flowSelected = { kind: "edge", from, to, evidence };
      renderFlow();
    }
  });
  byId("flowDetail").addEventListener("click", (event) => {
    const lead = event.target.closest("[data-flow-lead]");
    if (!lead) return;
    state.flowSelected = { kind: "lead", leadId: lead.dataset.flowLead };
    renderFlowDetail();
  });
  byId("sessionsProjectFilter").addEventListener("change", refreshSessions);
  byId("arbitrFilters").addEventListener("click", (event) => {
    const button = event.target.closest("[data-arbitr-group]");
    if (!button) return;
    arbitrContactGroup = button.dataset.arbitrGroup || "clients";
    byId("arbitrFilters").querySelectorAll("[data-arbitr-group]").forEach((item) => {
      item.classList.toggle("is-selected", item === button);
    });
    renderArbitr();
  });
  byId("eventBack").addEventListener("click", closeEvent);
  byId("chatBack").addEventListener("click", () => {
    byId("conversation").classList.remove("is-open");
    location.hash = "chats";
  });
  byId("manualSendForm").addEventListener("submit", sendManualReply);
  byId("manualSendText").addEventListener("input", () => {
    state.composerDirty = Boolean(byId("manualSendText").value.trim());
    resizeManualSendText();
    setManualDeliveryState(
      state.selectedDraftId ? "draft" : "idle",
      state.selectedDraftId ? "Черновик · не отправлено" : "Не отправлено",
    );
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
  document.querySelectorAll("[data-promo-status]").forEach((button) => {
    button.addEventListener("click", () => {
      changePromoFilters({ status: button.dataset.promoStatus });
    });
  });
  byId("promoCategory").addEventListener("change", (event) => {
    changePromoFilters({ category: event.target.value });
  });
  byId("promoCategoryRail").addEventListener("click", (event) => {
    const button = event.target.closest("[data-promo-category]");
    if (!button) return;
    const category = state.promoFilters.category === button.dataset.promoCategory
      ? "" : button.dataset.promoCategory;
    changePromoFilters({ category });
  });
  byId("promoPrev").addEventListener("click", () => {
    changePromoFilters({ page: Math.max(1, state.promoFilters.page - 1) });
  });
  byId("promoNext").addEventListener("click", () => {
    changePromoFilters({ page: state.promoFilters.page + 1 });
  });
  byId("refreshButton").addEventListener("click", async () => {
    await refreshAll(true);
    if (state.activeView === "flow") await refreshFlow(true);
    if (state.activeView === "promo") await refreshPromo(true);
    if (state.activeView === "costumes") await refreshCostumes(true);
    if (["operations", "broadcast"].includes(state.activeView)) await window.CoreParity?.refresh();
  });
  const bindRuntimeShortcut = (id, action) => {
    const element = byId(id);
    if (!element) return;
    element.addEventListener("click", action);
    element.addEventListener("keydown", (event) => {
      if (!["Enter", " "].includes(event.key)) return;
      event.preventDefault();
      action();
    });
  };
  bindRuntimeShortcut("runtimeReadiness", () => { location.hash = "system"; });
  bindRuntimeShortcut("runtimeProcesses", openRuntimeControls);
  byId("runtimeOpenControls")?.addEventListener("click", openRuntimeControls);
  byId("runtimeRefreshStatus")?.addEventListener("click", () => refreshAll(true));
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
      const query = event.target.value.trim();
      if (state.activeView === "promo") {
        changePromoFilters({ q: query });
        return;
      }
      state.query = query;
      if (state.activeView === "calendar") renderCalendar();
      if (state.activeView === "chats") renderThreads();
      if (state.activeView === "costumes") renderCostumes();
    }, 180);
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) syncActiveThread();
  });
  window.addEventListener("focus", syncActiveThread);
  window.addEventListener("hashchange", route);
}

const savedTheme = localStorage.getItem("lcb_core_theme");
if (savedTheme === "dark" || savedTheme === "light") document.documentElement.dataset.theme = savedTheme;
initNavLayout();
bindEvents();
route();
refreshAll();
window.setInterval(refreshAll, 30000);
// Own lighter interval, not folded into refreshAll's 30s hot-path: the
// underlying report only changes once an hour (spend_efficiency_watchdog.py).
refreshLoopGuardBadge();
window.setInterval(refreshLoopGuardBadge, 120000);
/* Карта мозгов не входит в refreshAll (она дорогая: ~184 живых chain_for()).
   Без своего тика вкладка Токены показывала снимок на момент открытия —
   если цепочку поменяли извне (другая сессия, автоматика), кубики врали, пока
   не переключишься на вкладку и обратно. 16.08 (Михаил): «кубики должны
   отображать реальное положение вещей». Пропускаем тик во время
   перетаскивания/выбора кубика — иначе ре-рендер выдернет чип из-под курсора. */
window.setInterval(() => {
  if (state.activeView === "tokens" && !brainDrag && !brainArmedTier) renderTokens();
}, 30000);
window.setInterval(() => {
  if (state.activeView === "flow") refreshFlow();
}, 90000);
window.setInterval(syncActiveThread, 5000);

/* ── Арбитраж «старый vs Core» ──────────────────────────────────────────────
   Судейство shadow-сравнений живёт в этом приложении; данные и append-only
   журнал вердиктов остаются у legacy-владельца — бэкенд проксирует
   /api/arbitr/* на 8878 (тот же паттерн, что «Токены»). */

/* Словари ниже переводят машинные коды в живые фразы. 25.08 (Михаил): карточка
   из голых кодов («blocker», «уже материализовано», кресты осей) нечитаема —
   решение принять невозможно. Каждый код обязан иметь фразу-объяснение;
   новый код без перевода покажется как есть — это сигнал дополнить словарь. */
const ARBITR_DECISION_RU = {
  blocked: "остановился — нужен человек",
  no_business_intent: "не видит бизнес-запроса",
  already_materialized: "запрос уже оформлен раньше",
  propose_create_opportunity: "предлагает завести сделку",
  propose_draft: "предлагает черновик ответа",
  hold: "отложил и ждёт",
  noop: "решил ничего не делать",
};
const ARBITR_DECISION_EXPLAIN_RU = {
  blocked: "дальше сам не идёт: по его правилам здесь требуется решение оператора",
  no_business_intent: "считает, что это не запрос на выступление/услугу, поэтому никаких действий не планирует",
  already_materialized: "считает, что по этому запросу карточка/сделка уже создана раньше, повторного действия не нужно",
  propose_create_opportunity: "видит новый бизнес-запрос и завёл бы карточку сделки",
  propose_draft: "подготовил бы ответ клиенту (без отправки)",
  hold: "сознательно ждёт (условие/срок), вернётся позже",
  noop: "прочитал и решил, что отвечать/заводить ничего не нужно",
};
const ARBITR_INTENT_RU = {
  event_inquiry: "запрос на мероприятие",
  small_talk: "просто разговор",
  price_request: "вопрос цены",
  no_business_intent: "без бизнес-запроса",
  vendor_coordination: "координация с подрядчиком",
  booking_request: "бронирование",
  team_coordination: "координация команды",
  payment_coordination: "про оплату",
  technical_coordination: "техвопросы/райдер",
  contract_coordination: "про договор",
};
const ARBITR_REL_RU = {
  client_organizer: "клиент-организатор",
  client_private: "частный клиент",
  client_agency: "агентство",
  vendor_performer: "исполнитель/подрядчик",
  lcb_team_member: "участник команды",
  venue_rep: "представитель площадки",
  personal: "личный контакт",
  unknown_review: "роль не определена",
};
const ARBITR_BLOCKER_RU = {
  role_resolution_required: "не смог определить роль контакта — нужен человек",
  non_commercial_relationship: "контакт не коммерческий — правила запрещают автодействия",
  commercial_identity_missing: "не нашёл, к какому клиенту/сделке привязать",
  legacy_transient_result: "старый пайплайн дал временный сбой, результата нет",
};
const ARBITR_CLASSIFICATION_RU = {
  blocker: "критичное расхождение",
  mismatch: "расхождение",
  match: "совпадение",
};
const ARBITR_AXES_RU = {
  relationship: "кто этот контакт", intent: "чего он хочет", action: "что делать",
  subject: "о чём речь", money_contract: "деньги/договор", external_effect: "внешний эффект",
};
const ARBITR_VERDICTS = [
  ["old", "Старый прав"],
  ["core", "Core прав"],
  ["both_ok", "Оба ок"],
  ["both_bad", "Оба плохо"],
];
const ARBITR_VERDICT_RU = {
  old: "старый прав", core: "Core прав", both_ok: "оба ок", both_bad: "оба плохо",
};
const ARBITR_GROUPS_RU = {
  clients: "Клиенты", musicians: "Музыканты", contractors: "Подрядчики",
  team: "Команда", personal: "Личное", unknown: "Не определено", all: "Все",
};
let arbitrContactGroup = "clients";

function arbitrWhen(epoch) {
  if (!epoch) return "—";
  try {
    return new Date(epoch * 1000).toLocaleString("ru-RU", {
      timeZone: "Europe/Moscow", day: "2-digit", month: "2-digit",
      hour: "2-digit", minute: "2-digit",
    });
  } catch { return "—"; }
}

function arbitrEngineHtml(decision, label, pillClass) {
  const d = decision || {};
  const who = ARBITR_REL_RU[d.relationship] || d.relationship;
  const what = ARBITR_INTENT_RU[d.intent_kind] || d.intent_kind;
  const reading = [who && `это ${who}`, what && `тема: ${what}`].filter(Boolean).join(", ");
  const explain = ARBITR_DECISION_EXPLAIN_RU[d.decision] || "";
  const blockerText = d.blocker
    ? (ARBITR_BLOCKER_RU[d.blocker] || String(d.blocker))
    : "";
  return `<div class="arbitr-engine">
    <div class="arbitr-engine-head"><span class="pill ${pillClass}">${escapeHtml(label)}</span>
      <strong>${escapeHtml(ARBITR_DECISION_RU[d.decision] || d.decision || "решение не получено")}</strong></div>
    ${reading ? `<div class="mtext">Как понял сообщение: ${escapeHtml(reading)}</div>` : ""}
    ${explain ? `<div class="mtext arbitr-explain">${escapeHtml(explain)}</div>` : ""}
    ${blockerText ? `<div class="arbitr-blocker mtext">⛔ ${escapeHtml(blockerText)}</div>` : ""}
  </div>`;
}

function arbitrCardHtml(card) {
  const classPill = card.classification === "blocker" ? "danger"
    : card.classification === "mismatch" ? "hold" : "ok";
  const body = String((card.message || {}).body || "").replace(/\s+/g, " ").trim();
  const disagreed = Object.entries(card.axes || {})
    .filter(([, ok]) => !ok)
    .map(([axis]) => ARBITR_AXES_RU[axis] || axis);
  const axes = disagreed.length
    ? `Версии разошлись в: <strong>${disagreed.map(escapeHtml).join(", ")}</strong>`
    : "По всем осям сравнения версии совпали";
  const actions = card.verdict
    ? `<p class="mtext">Твой вердикт: ${escapeHtml(ARBITR_VERDICT_RU[card.verdict] || card.verdict)}</p>`
    : `<div class="arbitr-actions"><span class="mtext">Кто оценил ситуацию верно?</span>${ARBITR_VERDICTS.map(([value, label]) =>
        `<button class="text-button" type="button" data-verdict="${value}">${label}</button>`).join("")}</div>`;
  const threadId = (card.message || {}).thread_id || "";
  const contact = card.contact_name
    ? `<button class="text-button arbitr-contact" type="button" data-arbitr-open="${escapeHtml(threadId)}" title="Открыть переписку">${escapeHtml(card.contact_name)} ↗</button>`
    : "";
  return `<section class="band-section arbitr-card" data-comparison="${escapeHtml(card.comparison_id)}">
    <div class="section-head"><span class="pill ${classPill}">${escapeHtml(ARBITR_CLASSIFICATION_RU[card.classification] || card.classification || "?")}</span>
      ${contact}
      <span class="arbitr-when">входящее от ${arbitrWhen((card.message || {}).at_epoch || card.compared_at_epoch)}</span></div>
    <p class="arbitr-msg">Клиентское сообщение: «${escapeHtml(body.slice(0, 240) || "текст недоступен — см. контекст диалога выше")}»</p>
    <div class="arbitr-engines">
      ${arbitrEngineHtml(card.legacy, "Старый (v1)", "technical")}
      ${arbitrEngineHtml(card.core, "Core (v2)", "ok")}
    </div>
    <div class="arbitr-axes mtext">${axes}</div>
    ${actions}
  </section>`;
}

function arbitrThreadHtml(thread) {
  const history = (thread.history || []).map((message) => {
    const direction = message.direction === "outbound" ? "Исходящее" : "Входящее";
    const body = String(message.body || "").replace(/\s+/g, " ").trim() || "[медиа без текста]";
    return `<p class="arbitr-history-message is-${escapeHtml(message.direction || "inbound")}"><b>${direction}</b> · ${escapeHtml(body)}</p>`;
  }).join("") || '<p class="mtext">История сообщения недоступна.</p>';
  return `<section class="arbitr-thread" data-arbitr-thread="${escapeHtml(thread.thread_id)}">
    <div class="arbitr-thread-head"><div><span class="pill technical">${escapeHtml(ARBITR_GROUPS_RU[thread.contact_group] || thread.contact_group || "Контакт")}</span>
      <h2><button class="arbitr-contact-title" type="button" data-arbitr-open="${escapeHtml(thread.thread_id)}" title="Открыть переписку в Чатах">${escapeHtml(thread.contact_name || "Контакт")} ↗</button></h2></div>
      <span class="mtext">${(thread.cards || []).length} сравн.</span></div>
    <details class="arbitr-history" open><summary>Контекст диалога · последние ${Math.min((thread.history || []).length, 12)} сообщений</summary>${history}</details>
    <div class="arbitr-thread-cards">${(thread.cards || []).map((card) => arbitrCardHtml({ ...card, contact_name: thread.contact_name })).join("")}</div>
  </section>`;
}

async function renderArbitr() {
  const pill = byId("arbitrPill");
  const stats = byId("arbitrStats");
  const cardsBox = byId("arbitrCards");
  try {
    const st = await apiGet("/api/arbitr/stats");
    const byVerdict = st.by_verdict || {};
    pill.textContent = `Рассужено ${st.judged || 0} из ${st.comparisons_total || 0}`;
    pill.className = "pill " + ((st.judged || 0) > 0 ? "ok" : "hold");
    stats.innerHTML = `
      <span class="pill ok">Core прав: ${byVerdict.core || 0}</span>
      <span class="pill technical">старый прав: ${byVerdict.old || 0}</span>
      <span class="pill ok">оба ок: ${byVerdict.both_ok || 0}</span>
      <span class="pill danger">оба плохо: ${byVerdict.both_bad || 0}</span>`;
  } catch (error) {
    pill.textContent = "Нет данных";
    pill.className = "pill hold";
    stats.innerHTML = `<span class="mtext">${escapeHtml(String(error.message || error))}</span>`;
  }
  cardsBox.innerHTML = '<div class="empty-state">Загрузка…</div>';
  let queue;
  try {
    queue = await apiGet(`/api/arbitr/queue?limit=20&contact_group=${encodeURIComponent(arbitrContactGroup)}`);
  } catch (error) {
    cardsBox.innerHTML = `<div class="empty-state"><strong>Очередь недоступна</strong>${escapeHtml(String(error.message || error))}</div>`;
    return;
  }
  const threads = queue.threads || [];
  if (!threads.length) {
    // Пустой экран обязан объяснять причину живыми числами из диагностики,
    // а не догадкой (прецедент 25.07 в первой версии экрана).
    const dg = queue.diagnostics || {};
    const why = dg.blockers && Object.keys(dg.blockers).length
      ? Object.entries(dg.blockers).map(([reason, count]) => `${reason}: ${count}`).join(" · ")
      : "причина не определена";
    cardsBox.innerHTML = `<div class="empty-state"><strong>Сравнений для «${escapeHtml(ARBITR_GROUPS_RU[arbitrContactGroup] || arbitrContactGroup)}» в очереди нет</strong>
      Что мешает сейчас: ${escapeHtml(why)}.<br>
      Разобрано ядром ${dg.interpreted ?? "?"} · результат старого есть у ${dg.with_legacy_result ?? "?"} ·
      пересечение ${dg.ready ?? "?"} из ${dg.inbound ?? "?"} входящих.</div>`;
    return;
  }
  cardsBox.innerHTML = threads.map(arbitrThreadHtml).join("");
  cardsBox.querySelectorAll("[data-comparison]").forEach((card) => {
    card.querySelectorAll("button[data-verdict]").forEach((button) => {
      button.addEventListener("click", () =>
        submitArbitrVerdict(card, card.dataset.comparison, button.dataset.verdict));
    });
  });
  cardsBox.querySelectorAll("button[data-arbitr-open]").forEach((button) => {
    button.addEventListener("click", async () => {
      const threadId = button.dataset.arbitrOpen;
      if (!threadId) { toast("Тред для этой карточки не определён"); return; }
      await setView("chats");
      openThread(threadId, true);
    });
  });
}

async function submitArbitrVerdict(card, comparisonId, verdict) {
  card.querySelectorAll("button[data-verdict]").forEach((b) => { b.disabled = true; });
  try {
    await apiPost("/api/arbitr/verdict", { comparison_id: comparisonId, verdict });
    toast("Вердикт записан");
    renderArbitr();
  } catch (error) {
    toast(`Вердикт не записан: ${error.message}`);
    card.querySelectorAll("button[data-verdict]").forEach((b) => { b.disabled = false; });
  }
}

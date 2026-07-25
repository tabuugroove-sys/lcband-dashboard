/* LCB app v2 — точка входа: состояние S, роутер, APP_VERSION, обновление PWA (§5.6).
   Модули: app-api.js (API/индикатор), app-cal.js, app-chats.js, app-today.js,
   app-event.js, app-assurance.js, app-sys.js — подключаются <script>-тегами до этого файла.
   Ручных отправок нет: наружу уходят только approval/send|reject по approval_id. */
"use strict";

const APP_VERSION = "3.2.0"; // бампать в каждом релизе фронта вместе с VERSION в app-sw.js

const S = {
  base: null,
  token: localStorage.getItem("lcb_app_token") || "",
  tab: null,
  month: null, // Date первого числа показанного месяца
  layers: { lcb: true, broker: true, events: true, leads: true, followup: true, cancelled: true },
  cache: {}, // path -> {t, data, etag}
  offline: false,
  offlineAt: null, // epoch ms снимка из SW-кэша
  search: "",
  // мессенджер
  brain: "v1", // «мозг» чтений экрана «Чаты»: v1 (legacy) | core2 (ядро Core, вкладка LCB 2.0)
  dir: "lcb",
  folder: "hot",
  unreadOnly: false,
  pendingOnly: false, // фильтр «только с черновиком агента» (счётчик «ждут»)
  counters: null,
  thrIndex: {},
  funnelFolders: null, // папки воронки V2 из /api/v2/funnel_threads (folders)
  lastLcbRows: null, // последние lcb-треды — счётчики папок воронки между перерисовками
  stallMap: {}, // username → epoch последнего молчания агента за 24ч (значок ⚠ в списке)
  chat: null,
  readTimer: null,
  lastList: null, // отфильтрованный список тредов (для «есть ли тред в папке»)
  folderRevealQ: null, // deep-link desktop: раскрыть папку открытого треда
  // соединение (§3.8)
  conn: { state: "INIT", lastOkAt: null, resolveFails: 0 },
  needAuth: false,
  flags: {},
};

/* ── роутинг ────────────────────────────────────────────────────────────── */
const SCREENS = { cal: "scr-cal", chats: "scr-chats", today: "scr-today", sys: "scr-sys", tokens: "scr-tokens", cast: "scr-cast", core2: "scr-core2", assurance: "scr-assurance", view: "scr-view" };
function nav(hash) { location.hash = hash; }
function route() {
  stopPollsByPrefix("screen:");
  if (S.readTimer) { clearTimeout(S.readTimer); S.readTimer = null; }
  const h = (location.hash || "#cal").slice(1);
  const slash = h.indexOf("/");
  const name = slash === -1 ? h : h.slice(0, slash);
  const rawArg = slash === -1 ? null : h.slice(slash + 1);
  // desktop (≥900px): тред живёт в split-панели экрана «Чаты», не в отдельном view
  const deskChat = name === "chat" && typeof isDesktop === "function" && isDesktop();
  const tab = ["cal", "today", "chats", "sys", "tokens", "cast", "core2"].includes(name) ? name
    : name === "assurance" ? "assurance"
    : deskChat ? "chats"
    : (name === "event" || name === "chat" ? "view" : "cal");
  S.tab = tab;
  if (name !== "chat") S.chat = null;
  // «мозг» чатов: вне LCB 2.0 всегда v1; mobile-тред (#chat при узком экране)
  // сохраняет текущий мозг — открытый из LCB 2.0 тред читает Core
  if (name !== "core2" && !(name === "chat" && !deskChat)) S.brain = "v1";
  for (const [k, id] of Object.entries(SCREENS)) $("#" + id).classList.toggle("on", k === tab);
  const hiTab = name === "assurance" ? (rawArg === "core2" ? "core2" : "sys")
    : tab === "view" ? (name === "chat" ? "chats" : "cal") : tab;
  document.querySelectorAll("#tabbar button").forEach((b) => b.classList.toggle("on", b.dataset.tab === hiTab));
  if (name === "cal") renderCal();
  else if (name === "today") renderToday();
  else if (name === "chats") renderChats();
  else if (name === "sys") renderSys();
  else if (name === "tokens") renderTokens();
  else if (name === "cast") renderCast();
  else if (name === "core2") renderCore2();
  else if (name === "assurance") renderAssurance(rawArg || "sys");
  else if (name === "event") renderEvent(decodeURIComponent(rawArg || ""));
  else if (name === "chat") {
    let dir = "lcb", rq = rawArg || "";
    const s2 = rq.indexOf("/");
    if (s2 > -1) {
      const maybe = rq.slice(0, s2);
      if (["lcb", "musicians", "broker"].includes(maybe)) { dir = maybe; rq = rq.slice(s2 + 1); }
    }
    if (deskChat) renderChatsWithThread(dir, decodeURIComponent(rq));
    else renderThread(dir, decodeURIComponent(rq));
  } else renderCal();
}
window.addEventListener("hashchange", route);
document.querySelectorAll("#tabbar button").forEach((b) => b.addEventListener("click", () => nav("#" + b.dataset.tab)));

/* ── глобальные контролы ────────────────────────────────────────────────── */
$("#themeBtn").addEventListener("click", () => {
  const r = document.documentElement;
  const dark = r.getAttribute("data-theme") === "dark" || (!r.getAttribute("data-theme") && matchMedia("(prefers-color-scheme: dark)").matches);
  r.setAttribute("data-theme", dark ? "light" : "dark");
  localStorage.setItem("lcb_app_theme", r.getAttribute("data-theme"));
});
const savedTheme = localStorage.getItem("lcb_app_theme");
if (savedTheme) document.documentElement.setAttribute("data-theme", savedTheme);

$("#reloadBtn").addEventListener("click", () => { S.cache = {}; route(); fetchCounters(); });
$("#search").addEventListener("input", (e) => {
  S.search = e.target.value.trim();
  if (S.tab === "cal") renderCal();
  if (S.tab === "chats") drawThreads();
});
$("#search").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && S.search.startsWith("@")) nav("#chat/lcb/" + encodeURIComponent(S.search.replace(/^@/, "")));
});

$("#connPill").addEventListener("click", toggleDrawer);
$("#connDrawer").addEventListener("click", (e) => { if (e.target.id === "connDrawer") toggleDrawer(); });

/* ── обновление PWA (§5.6): версия + тост «Обновить» ────────────────────── */
function showUpdateToast(reg) {
  if ($("#updToast")) return;
  const t = el(`<div id="updToast" class="updtoast">Доступна новая версия <button class="btn go">Обновить</button></div>`);
  t.querySelector("button").onclick = () => {
    t.querySelector("button").textContent = "Обновляю…";
    if (reg.waiting) reg.waiting.postMessage({ type: "SKIP_WAITING" });
  };
  document.body.appendChild(t);
}
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("app-sw.js").then((reg) => {
    if (reg.waiting && navigator.serviceWorker.controller) showUpdateToast(reg);
    reg.addEventListener("updatefound", () => {
      const nw = reg.installing;
      if (!nw) return;
      nw.addEventListener("statechange", () => {
        if (nw.state === "installed" && navigator.serviceWorker.controller) showUpdateToast(reg);
      });
    });
  }).catch(() => {});
  let _reloaded = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!_reloaded) { _reloaded = true; location.reload(); }
  });
}

/* ── boot ───────────────────────────────────────────────────────────────── */
resolveBase(false).then(() => {
  route();
  // heartbeat /api/health 25с при видимой вкладке (§3.8)
  startPoll("hb", heartbeat, 25000);
  // счётчики 30с независимо от активной вкладки — бейдж на tabbar (§3.3.1)
  startPoll("counters", () => { delete S.cache[brainPath("/api/app/counters")]; fetchCounters(); }, 30000);
  fetchCounters();
});

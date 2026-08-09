/* LCB app v2 — API-слой (§5.2 ТЗ): резолв base, api() с кэшем/ретраями,
   централизованная 403-обработка, глобальный индикатор соединения (§3.8),
   heartbeat /api/health 25с, поллинг с паузой на hidden, MSK-время (§6).
   Подключается ПЕРВЫМ; состояние S и APP_VERSION живут в app.js (точка входа). */
"use strict";

/* ── общие DOM/формат-хелперы (доступны всем модулям) ───────────────────── */
const $ = (sel) => document.querySelector(sel);
const el = (html) => { const d = document.createElement("div"); d.innerHTML = html.trim(); return d.firstChild; };
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const RUB = new Intl.NumberFormat("ru-RU");
const money = (v) => (v == null || isNaN(+v) ? "—" : RUB.format(Math.round(+v)) + " ₽");
const MONTHS = ["январь","февраль","март","апрель","май","июнь","июль","август","сентябрь","октябрь","ноябрь","декабрь"];
const trunc = (s, n) => { s = String(s == null ? "" : s); return s.length > n ? s.slice(0, n) + "…" : s; };

function toast(msg, bad) {
  const t = el(`<div class="lcbtoast" style="background:${bad ? "var(--dang)" : "var(--pine)"}">${esc(msg)}</div>`);
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3800);
}

const WARNED = Object.create(null);
function warnOnce(key, msg) { if (!WARNED[key]) { WARNED[key] = 1; console.warn("[LCB] " + msg); } }

/* ── MSK-время (§6): весь показ — по Москве, локальную TZ не используем ── */
const MSK_TZ = "Europe/Moscow";
const _mskFmt = new Intl.DateTimeFormat("en-CA", { timeZone: MSK_TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const _wdFmt = new Intl.DateTimeFormat("ru-RU", { timeZone: MSK_TZ, weekday: "short" });
const _dateFmt = new Intl.DateTimeFormat("ru-RU", { timeZone: MSK_TZ, day: "2-digit", month: "2-digit", year: "numeric" });
const _dateShortFmt = new Intl.DateTimeFormat("ru-RU", { timeZone: MSK_TZ, day: "2-digit", month: "2-digit" });
function mskParts(d) { const g = {}; for (const p of _mskFmt.formatToParts(d)) g[p.type] = p.value; return g; }
function mskHM(d) { const g = mskParts(d); return `${g.hour}:${g.minute}`; }
function mskDateIso(d) { const g = mskParts(d); return `${g.year}-${g.month}-${g.day}`; }
function mskDayNum(d) { const g = mskParts(d); return Date.UTC(+g.year, +g.month - 1, +g.day) / 86400000; }
function parseDateFlexible(s) {
  if (!s) return NaN;
  let t = Date.parse(s);
  if (isNaN(t)) t = Date.parse(String(s).replace(" ", "T"));
  return t;
}
/* по-телеграмному: сегодня (МСК) — HH:MM, неделя — день недели, старше — дата */
function tgTime(epochSec) {
  if (!epochSec) return "";
  const d = new Date(epochSec * 1000);
  const diff = mskDayNum(new Date()) - mskDayNum(d);
  if (diff <= 0) return mskHM(d);
  if (diff < 7) return _wdFmt.format(d);
  return _dateFmt.format(d);
}
function bubStamp(epochSec, raw) {
  if (!epochSec) return String(raw || "").slice(0, 16);
  const d = new Date(epochSec * 1000);
  const diff = mskDayNum(new Date()) - mskDayNum(d);
  return diff <= 0 ? mskHM(d) : `${_dateShortFmt.format(d)} ${mskHM(d)}`;
}
/* сортировка тредов — только числом (mixed-TZ канон), не строками */
function epochOf(row) {
  if (row == null) return 0;
  const e = +row.last_activity_epoch;
  if (e > 0) return e;
  const t = parseDateFlexible(row.last_activity || row.last_activity_at || "");
  return isNaN(t) ? 0 : Math.round(t / 1000);
}
function msgEpoch(m) {
  if (!m) return 0;
  if (+m.epoch > 0) return +m.epoch;
  if (+m.date_epoch > 0) return +m.date_epoch;
  const t = parseDateFlexible(m.date || "");
  return isNaN(t) ? 0 : Math.round(t / 1000);
}

/* ── резолв base (§5.2): local or private tailnet same-origin only ──────── */

function baseKind(url) {
  const host = url ? new URL(url, location.href).hostname : location.hostname;
  if (host.endsWith(".ts.net")) return "TS";
  return "MAC";
}

async function probe(url) {
  try {
    const c = new AbortController();
    const to = setTimeout(() => c.abort(), 2500);
    const r = await fetch(url + "/api/health", { signal: c.signal, cache: "no-store" });
    clearTimeout(to);
    const j = await r.json();
    return j && j.ok === true;
  } catch { return false; }
}

let RESOLVING = null;
async function resolveBase(force) {
  if (S.base !== null && !force) return S.base;
  if (RESOLVING) return RESOLVING;
  RESOLVING = _resolveBase().finally(() => { RESOLVING = null; });
  return RESOLVING;
}
async function _resolveBase() {
  const isLocal = location.hostname === "127.0.0.1" || location.hostname === "localhost";
  const isTailnet = location.hostname.endsWith(".ts.net");
  if (location.port === "8878" || isTailnet) {
    S.base = "";
    if (await probe("")) connOk(baseKind("")); else _resolveFail();
    return S.base;
  }
  // A public/static host must never discover or probe a private backend.
  const cands = (isLocal || location.protocol === "file:") ? ["http://127.0.0.1:8878"] : [];
  for (const c of cands) {
    if (await probe(c)) { S.base = c; connOk(baseKind(c)); return S.base; }
  }
  if (S.base === null) S.base = cands[0] || ""; // fetch пойдёт через SW → офлайн-снимок
  _resolveFail();
  return S.base;
}
function _resolveFail() {
  S.conn.resolveFails++;
  // RECONNECT → OFFLINE после 3 неудачных полных ре-резолвов подряд (§3.8)
  setConnState((S.conn.resolveFails >= 3 || navigator.onLine === false) ? "OFFLINE" : "RECONNECT");
}

/* ── глобальный индикатор соединения (§3.8) ─────────────────────────────── */
function connLabel(st) {
  if (st === "INIT") return "Подключение…";
  if (st === "MAC") return "Mac";
  if (st === "TS") return "TS";
  if (st === "RECONNECT") return "Переподключение…";
  const t = S.offlineAt || S.conn.lastOkAt;
  return "Офлайн" + (t ? " · снимок " + mskHM(new Date(t)) : "");
}
function setConnState(st) {
  if (st === "OFFLINE" && S.conn.state !== "OFFLINE") startPoll("offlineRetry", () => resolveBase(true), 15000);
  if (st !== "OFFLINE") stopPoll("offlineRetry");
  S.conn.state = st;
  const p = $("#connPill");
  if (p) {
    p.className = "st-" + st.toLowerCase();
    const l = p.querySelector(".clabel");
    if (l) l.textContent = connLabel(st);
  }
  const d = $("#connDrawer");
  if (d && !d.hidden) renderDrawer();
}
function connOk(kind) {
  S.conn.lastOkAt = Date.now();
  S.conn.resolveFails = 0;
  if (S.offline) { S.offline = false; updateOfflineBar(); }
  setConnState(kind || "MAC");
}
function updateOfflineBar() {
  const bar = $("#offline");
  if (!bar) return;
  if (S.offline) {
    const t = S.offlineAt || S.conn.lastOkAt;
    bar.textContent = "Офлайн · снимок " + (t ? mskHM(new Date(t)) + " МСК" : "—");
    bar.classList.add("show");
  } else bar.classList.remove("show");
}

/* heartbeat: лёгкий /api/health вне общего кэша (SW его не кэширует),
   чтобы обрыв был виден ≤30с даже без действий пользователя */
async function heartbeat() {
  if (document.visibilityState !== "visible") return;
  if (S.base === null) { await resolveBase(false); return; }
  try {
    const c = new AbortController();
    const to = setTimeout(() => c.abort(), 5000);
    const r = await fetch((S.base || "") + "/api/health", { signal: c.signal, cache: "no-store" });
    clearTimeout(to);
    if (!r.ok) throw new Error("health_" + r.status);
    connOk(baseKind(S.base));
  } catch {
    if (S.conn.state !== "OFFLINE") setConnState("RECONNECT");
    await resolveBase(true);
  }
}

/* ── api(): кэш, ETag, ретрай через ре-резолв, 403 централизованно ──────── */
function _uuid() { return crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2); }

async function api(path, { ttl = 0, method = "GET", body = null, timeout = 0 } = {}) {
  const hit = S.cache[path];
  if (method === "GET" && ttl && hit && Date.now() - hit.t < ttl) return hit.data;
  await resolveBase(false);
  const doFetch = () => {
    const headers = {};
    if (S.token) headers["X-Admin-Token"] = S.token;
    if (method === "GET" && hit && hit.etag) headers["If-None-Match"] = hit.etag;
    if (method !== "GET") { headers["Content-Type"] = "application/json"; headers["X-Request-ID"] = _uuid(); }
    const opts = { method, headers, body: body ? JSON.stringify(body) : null };
    if (timeout) { const c = new AbortController(); opts.signal = c.signal; setTimeout(() => c.abort(), timeout); }
    return fetch((S.base || "") + path, opts);
  };
  let r;
  try {
    r = await doFetch();
  } catch (e) {
    if (S.conn.state !== "OFFLINE") setConnState("RECONNECT");
    await resolveBase(true); // один ре-резолв и один ретрай
    try {
      r = await doFetch();
    } catch (e2) {
      // POST в офлайне: никаких офлайн-очередей approve (§5.4)
      if (method !== "GET") toast("Нет соединения — действие не выполнено", true);
      const err = new Error("нет соединения");
      err.network = true;
      throw err;
    }
  }
  const offlineHit = r.headers.get("X-LCB-Offline") === "1";
  if (offlineHit) {
    const at = +r.headers.get("X-LCB-Cached-At") || null;
    S.offline = true;
    if (at) S.offlineAt = at;
    updateOfflineBar();
    if (S.conn.state !== "OFFLINE" && S.conn.state !== "RECONNECT") setConnState("RECONNECT");
  } else {
    connOk(baseKind(S.base));
  }
  if (r.status === 304 && hit) { hit.t = Date.now(); return hit.data; }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    if (r.status === 403) {
      // 403 при живом соединении НЕ меняет цвет пилюли (§3.8); в шторке — «Нужен ключ»
      S.needAuth = true;
      const d = $("#connDrawer");
      if (d && !d.hidden) renderDrawer();
    }
    const e = new Error((data && data.error) || ("http_" + r.status));
    e.status = r.status;
    e.data = data;
    throw e;
  }
  if (method === "GET" && !offlineHit) S.cache[path] = { t: Date.now(), data, etag: r.headers.get("ETag") || null };
  return data;
}

/* ── поллинг: пауза на hidden, немедленный тик на visible (§5.2) ────────── */
const POLLS = {};
function startPoll(key, fn, ms, immediate) {
  stopPoll(key);
  POLLS[key] = { fn, id: setInterval(() => { if (document.visibilityState === "visible") fn(); }, ms) };
  if (immediate && document.visibilityState === "visible") fn();
}
function stopPoll(key) {
  const p = POLLS[key];
  if (p) { clearInterval(p.id); delete POLLS[key]; }
}
function stopPollsByPrefix(pre) {
  for (const k of Object.keys(POLLS)) if (k.startsWith(pre)) stopPoll(k);
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") for (const k of Object.keys(POLLS)) POLLS[k].fn();
});
window.addEventListener("online", () => resolveBase(true));
window.addEventListener("offline", () => setConnState("OFFLINE"));

/* ── шторка индикатора: base, последний успех, версия, ключ (§3.8, §5.3) ── */
function toggleDrawer() {
  const d = $("#connDrawer");
  if (!d) return;
  if (d.hidden) { d.hidden = false; renderDrawer(); } else d.hidden = true;
}
function renderDrawer() {
  const d = $("#connDrawer");
  if (!d || d.hidden) return;
  const b = $("#drawerBody");
  const baseShown = S.base == null ? "—" : (S.base === "" ? location.origin : S.base);
  const lastOk = S.conn.lastOkAt ? mskHM(new Date(S.conn.lastOkAt)) + " МСК" : "—";
  b.innerHTML = `
    <div class="drow"><span class="k">Состояние</span><span>${esc(connLabel(S.conn.state))}</span></div>
    <div class="drow"><span class="k">Бэкенд</span><span class="num" style="font-size:12px;word-break:break-all">${esc(baseShown)}</span></div>
    <div class="drow"><span class="k">Последний успех</span><span>${esc(lastOk)}</span></div>
    <div class="drow"><span class="k">Удалённый доступ</span><span>${location.hostname.endsWith(".ts.net") ? "Tailnet" : "локально"}</span></div>
    <div class="drow"><span class="k">Версия</span><span class="num">${esc(typeof APP_VERSION !== "undefined" ? APP_VERSION : "?")}</span></div>
    ${S.needAuth ? `<div class="drow"><span class="k" style="color:var(--brass)">Нужен ключ</span><span class="mtext">закрытые разделы ждут кода доступа</span></div>` : ""}
    <div style="margin-top:10px">${S.token
      ? `<div class="drow" style="border:none"><span class="k">Ключ доступа</span><span>введён ••••</span></div>
         <button class="btn" id="tokForget" style="width:100%;margin-top:6px">Забыть ключ</button>`
      : `<input id="tokInput" class="dinput" type="password" placeholder="Код доступа (для iPhone/tailnet)" autocomplete="off">
         <button class="btn go" id="tokSave" style="width:100%;margin-top:8px">Сохранить ключ</button>`}</div>
    <button class="btn" id="connCheck" style="width:100%;margin-top:8px">Проверить соединение</button>
    <div class="mtext" style="margin-top:10px">Точка «непрочитано» = не смотрел в приложении (TG-статусы не трогаются). «Отправлено сегодня» — агентские отправки за день по МСК; ручные из родного Telegram не считаются.</div>`;
  const save = $("#tokSave");
  if (save) save.onclick = () => {
    const v = ($("#tokInput").value || "").trim();
    if (!v) return;
    S.token = v;
    localStorage.setItem("lcb_app_token", v);
    S.needAuth = false;
    S.cache = {};
    renderDrawer();
    toast("Ключ сохранён");
    if (typeof route === "function") route();
    if (typeof fetchCounters === "function") fetchCounters();
  };
  const forget = $("#tokForget");
  if (forget) forget.onclick = () => {
    S.token = "";
    localStorage.removeItem("lcb_app_token");
    S.cache = {};
    renderDrawer();
    toast("Ключ забыт");
  };
  $("#connCheck").onclick = async () => {
    $("#connCheck").textContent = "Проверяю…";
    await resolveBase(true);
    renderDrawer();
    toast(S.conn.state === "OFFLINE" ? "Бэкенд недоступен" : "Соединение: " + connLabel(S.conn.state), S.conn.state === "OFFLINE");
  };
}

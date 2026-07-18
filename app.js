/* LCB app v1 — vanilla SPA поверх живого API dashboard_backend.
   Календарь — первый экран. Ручных отправок нет: только пайплайн-мутации
   (approval/send|reject) под X-Admin-Token. */
"use strict";

const S = {
  base: null,
  token: localStorage.getItem("lcb_app_token") || "",
  tab: null,
  month: null, // Date первого числа показанного месяца
  layers: { events: true, leads: true, cancelled: true },
  cache: {}, // path -> {t, data}
  offline: false,
  search: "",
};

const $ = (sel) => document.querySelector(sel);
const el = (html) => { const d = document.createElement("div"); d.innerHTML = html.trim(); return d.firstChild; };
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const RUB = new Intl.NumberFormat("ru-RU");
const money = (v) => (v == null || isNaN(+v) ? "—" : RUB.format(Math.round(+v)) + " ₽");
const MONTHS = ["январь","февраль","март","апрель","май","июнь","июль","август","сентябрь","октябрь","ноябрь","декабрь"];

function toast(msg, bad) {
  const t = el(`<div style="position:fixed;left:50%;bottom:84px;transform:translateX(-50%);z-index:60;background:${bad ? "var(--dang)" : "var(--pine)"};color:#fff;padding:10px 18px;border-radius:10px;font-size:14px;max-width:88%;">${esc(msg)}</div>`);
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3800);
}

/* ── бэкенд: same-origin → backend_url.json → probe /api/health ─────────── */
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
async function resolveBase(force) {
  if (S.base && !force) return S.base;
  if (location.port === "8878") { S.base = ""; return S.base; }
  const cands = [];
  try {
    const r = await fetch("./backend_url.json", { cache: "no-store" });
    const j = await r.json();
    if (j.url && j.url.startsWith("https://")) cands.push(j.url.replace(/\/$/, ""));
  } catch {}
  cands.push("http://127.0.0.1:8878");
  for (const c of cands) if (await probe(c)) { S.base = c; setConn("ok"); return S.base; }
  S.base = cands[0] || "";
  setConn("dang");
  return S.base;
}
function setConn(level) {
  const d = $("#connDot");
  d.className = level === "ok" ? "" : level;
}

async function api(path, { auth = false, ttl = 0, method = "GET", body = null } = {}) {
  const hit = S.cache[path];
  if (method === "GET" && ttl && hit && Date.now() - hit.t < ttl) return hit.data;
  const base = await resolveBase(false);
  const headers = { };
  if (auth || method !== "GET") {
    if (!S.token) { showGate(); throw new Error("no_token"); }
    headers["X-Admin-Token"] = S.token;
  }
  if (method !== "GET") { headers["Content-Type"] = "application/json"; headers["X-Request-ID"] = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now())); }
  let r;
  try {
    r = await fetch(base + path, { method, headers, body: body ? JSON.stringify(body) : null });
  } catch (e) {
    await resolveBase(true); // туннель мог смениться — один ре-резолв и ретрай
    r = await fetch(S.base + path, { method, headers, body: body ? JSON.stringify(body) : null });
  }
  if (r.status === 403) { showGate("Ключ не подошёл или не задан"); throw new Error("forbidden"); }
  const data = await r.json().catch(() => ({}));
  S.offline = !!(data && data.offline);
  $("#offline").classList.toggle("show", S.offline);
  if (!r.ok) { const e = new Error(data.error || ("http_" + r.status)); e.status = r.status; e.data = data; throw e; }
  if (method === "GET") S.cache[path] = { t: Date.now(), data };
  return data;
}

/* ── вход по ключу ──────────────────────────────────────────────────────── */
function showGate(msg) {
  $("#gate").classList.add("show");
  $("#gateMsg").textContent = msg || "";
}
$("#gateGo").addEventListener("click", () => {
  S.token = $("#gateKey").value.trim();
  localStorage.setItem("lcb_app_token", S.token);
  $("#gate").classList.remove("show");
  render();
});
$("#gateSkip").addEventListener("click", () => $("#gate").classList.remove("show"));

/* ── роутинг ────────────────────────────────────────────────────────────── */
const SCREENS = { cal: "scr-cal", today: "scr-today", chats: "scr-chats", sys: "scr-sys", view: "scr-view" };
function nav(hash) { location.hash = hash; }
function route() {
  const h = (location.hash || "#cal").slice(1);
  const [name, arg] = h.split("/", 2).length > 1 ? [h.split("/")[0], decodeURIComponent(h.slice(h.indexOf("/") + 1))] : [h, null];
  const tab = ["cal", "today", "chats", "sys"].includes(name) ? name : (name === "event" || name === "chat" ? "view" : "cal");
  S.tab = tab;
  for (const [k, id] of Object.entries(SCREENS)) $("#" + id).classList.toggle("on", k === tab);
  document.querySelectorAll("#tabbar button").forEach((b) => b.classList.toggle("on", b.dataset.tab === (tab === "view" ? "" : tab)));
  if (name === "cal") renderCal();
  else if (name === "today") renderToday();
  else if (name === "chats") renderChats();
  else if (name === "sys") renderSys();
  else if (name === "event") renderEvent(arg);
  else if (name === "chat") renderChat(arg);
  else renderCal();
}
window.addEventListener("hashchange", route);
document.querySelectorAll("#tabbar button").forEach((b) => b.addEventListener("click", () => nav("#" + b.dataset.tab)));

/* ── календарь (первый экран) ───────────────────────────────────────────── */
function evColor(ev) {
  const st = ((ev.linked_order_status || "") + " " + (ev.business_state || "")).toLowerCase();
  if (st.includes("отмен") || st.includes("cancel")) return "c-cxl";
  const total = +ev.client_total || 0, rem = +ev.client_remaining || 0;
  if (total > 0 && rem <= 0) return "c-ok";
  if (total > 0) return "c-pay";
  return "c-ok";
}
function leadColor(l) {
  return (l.stage === "contract" || l.stage === "prepayment") ? "c-pay" : "c-neg";
}
async function renderCal() {
  const box = $("#scr-cal");
  if (!S.month) { const n = new Date(); S.month = new Date(n.getFullYear(), n.getMonth(), 1); }
  box.innerHTML = `<div id="calHead">
      <button id="calToday">Сегодня</button>
      <button id="calPrev">‹</button><button id="calNext">›</button>
      <span class="mon">${MONTHS[S.month.getMonth()]} ${S.month.getFullYear()}</span>
    </div>
    <div class="callay">
      <button class="lay ${S.layers.events ? "on" : ""}" data-l="events">События</button>
      <button class="lay ${S.layers.leads ? "on" : ""}" data-l="leads">Лиды с датами</button>
      <button class="lay ${S.layers.cancelled ? "on" : ""}" data-l="cancelled">Отменённые</button>
    </div>
    <div id="calGrid"><div class="skel"></div></div>
    <div id="dayPanel"></div>`;
  $("#calToday").onclick = () => { const n = new Date(); S.month = new Date(n.getFullYear(), n.getMonth(), 1); renderCal(); };
  $("#calPrev").onclick = () => { S.month = new Date(S.month.getFullYear(), S.month.getMonth() - 1, 1); renderCal(); };
  $("#calNext").onclick = () => { S.month = new Date(S.month.getFullYear(), S.month.getMonth() + 1, 1); renderCal(); };
  box.querySelectorAll(".callay .lay").forEach((b) => (b.onclick = () => { S.layers[b.dataset.l] = !S.layers[b.dataset.l]; renderCal(); }));

  let events = [], leads = [];
  try {
    const r = await api("/api/events?include_past=1", { ttl: 60000 });
    events = r.events || [];
  } catch (e) { /* открытая ручка; сеть */ }
  try {
    const r = await api("/api/leads_with_dates", { ttl: 60000 });
    leads = r.leads || [];
  } catch (e) {}

  const byDay = {};
  const put = (iso, chip) => { if (!iso) return; (byDay[iso] = byDay[iso] || []).push(chip); };
  if (S.layers.events) for (const ev of events) {
    const cls = evColor(ev);
    if (cls === "c-cxl" && !S.layers.cancelled) continue;
    put(ev.date, { cls, label: (cls === "c-cxl" ? "✕ " : "") + (ev.title || ev.linked_order_client || ev.id), href: "#event/" + encodeURIComponent(ev.id), sub: ev.business_state || "" });
  }
  if (S.layers.leads) for (const l of leads) {
    put(l.event_date_iso, { cls: leadColor(l), label: (l.client || l.username || "лид"), href: l.username ? "#chat/" + encodeURIComponent(l.username) : "#chats", sub: l.status || "" });
  }

  const q = S.search.toLowerCase();
  const first = new Date(S.month), y = first.getFullYear(), m = first.getMonth();
  const start = (first.getDay() + 6) % 7; // Пн=0
  const dim = new Date(y, m + 1, 0).getDate();
  const todayIso = new Date().toISOString().slice(0, 10);
  let cells = "";
  const heads = ["Пн","Вт","Ср","Чт","Пт","Сб","Вс"].map((h) => `<div class="h">${h}</div>`).join("");
  const total = Math.ceil((start + dim) / 7) * 7;
  for (let i = 0; i < total; i++) {
    const d = i - start + 1;
    if (d < 1 || d > dim) { cells += `<div class="gd out"></div>`; continue; }
    const iso = `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    let chips = (byDay[iso] || []);
    if (q) chips = chips.filter((c) => c.label.toLowerCase().includes(q));
    const shown = chips.slice(0, 3);
    const moreN = chips.length - shown.length;
    cells += `<div class="gd" data-iso="${iso}">
      <span class="dn ${iso === todayIso ? "today" : ""}">${d}</span>
      ${shown.map((c) => `<button class="chip ${c.cls}" data-href="${esc(c.href)}" title="${esc(c.label)} · ${esc(c.sub)}">${esc(c.label)}</button>`).join("")}
      ${moreN > 0 ? `<span class="more">ещё ${moreN}</span>` : ""}
    </div>`;
  }
  $("#calGrid").innerHTML = `<div class="gwk">${heads}${cells}</div>`;
  $("#calGrid").querySelectorAll(".chip").forEach((c) => (c.onclick = (e) => { e.stopPropagation(); nav(c.dataset.href); }));
  $("#calGrid").querySelectorAll(".gd[data-iso]").forEach((cell) => (cell.onclick = () => {
    const iso = cell.dataset.iso, list = byDay[iso] || [];
    $("#dayPanel").innerHTML = list.length
      ? `<div class="card"><div class="cname">${iso.split("-").reverse().join(".")}</div>` +
        list.map((c) => `<button class="thr" data-href="${esc(c.href)}" style="margin-top:8px"><div class="t1"><span class="who">${esc(c.label)}</span><span class="when">${esc(c.sub)}</span></div></button>`).join("") + `</div>`
      : "";
    $("#dayPanel").querySelectorAll(".thr").forEach((t) => (t.onclick = () => nav(t.dataset.href)));
  }));
}

/* ── сегодня ────────────────────────────────────────────────────────────── */
async function renderToday() {
  const box = $("#scr-today");
  box.innerHTML = `<div id="connRow" class="callay"></div>
    <div class="stats" id="todayKpi"></div>
    <div class="h2">Ждут твоего решения</div><div id="apprBox"><div class="skel"></div></div>
    <div class="h2">Требуют внимания</div><div id="attnBox"><div class="skel"></div></div>
    <div class="card"><div class="cname">Дайджест дня</div>
      <div class="mtext">Вечерний обзор приглушённых событий приходит в TG-бот в 22:00 МСК. Ручки выдачи очереди в API пока нет — добавлю на бэкенде (в списке доработок).</div></div>`;

  // подключения
  try {
    const [h, t, rh] = await Promise.all([
      api("/api/health", { ttl: 30000 }),
      api("/api/cloudflare_tunnel_status", { ttl: 60000 }).catch(() => null),
      api("/api/runtime_health", { ttl: 60000 }).catch(() => null),
    ]);
    const pills = [];
    pills.push(h.banned ? `<span class="pill p-dang">TG: бан — ${esc(h.ban_reason)}</span>` : `<span class="pill p-ok">TG отправка · квота ${h.send_quota_remaining}</span>`);
    if (t) pills.push(t.stale ? `<span class="pill p-warn">Туннель устарел ${Math.round((t.age_seconds || 0) / 60)} мин</span>` : `<span class="pill p-ok">Туннель</span>`);
    if (rh) pills.push(`<span class="pill ${rh.level === "ok" ? "p-ok" : rh.level === "warn" ? "p-warn" : "p-dang"}">Здоровье: ${esc(rh.level)}</span>`);
    $("#connRow").innerHTML = pills.join(" ");
    setConn(h.banned || (rh && rh.level === "alarm") ? "warn" : "ok");
  } catch { $("#connRow").innerHTML = `<span class="pill p-dang">Бэкенд недоступен</span>`; setConn("dang"); }

  // KPI из открытых ручек
  try {
    const f = await api("/api/inbound_funnel", { ttl: 600000 });
    const need = (f.leads || []).filter((l) => l.needs_attention);
    $("#todayKpi").innerHTML = `
      <div class="stat"><div class="l">Лидов в воронке</div><div class="v num">${f.total || 0}</div></div>
      <div class="stat"><div class="l">Требуют внимания</div><div class="v num" style="color:var(--warn)">${need.length}</div></div>
      <div class="stat"><div class="l">Переговоры</div><div class="v num">${(f.by_stage || {}).negotiating || 0}</div></div>
      <div class="stat"><div class="l">Подтверждено</div><div class="v num" style="color:var(--ok)">${(f.by_stage || {}).confirmed || 0}</div></div>`;
    $("#attnBox").innerHTML = need.slice(0, 8).map((l) => `
      <button class="thr" data-q="${esc(l.username || "")}">
        <div class="t1"><span class="who">${esc(l.username || "—")}</span>
          <span class="pill p-warn">${esc(l.stage || "")}</span>
          <span class="when">${esc((l.last_activity_at || "").slice(0, 10))}</span></div>
        <div class="prev">${esc(l.next_action || l.summary || "")}</div>
      </button>`).join("") || `<div class="empty">Никто не ждёт — чисто</div>`;
    $("#attnBox").querySelectorAll(".thr").forEach((t) => (t.onclick = () => t.dataset.q && nav("#chat/" + encodeURIComponent(t.dataset.q))));
  } catch { $("#attnBox").innerHTML = `<div class="empty">Воронка недоступна</div>`; }

  // апрувы (token-gated snapshot)
  try {
    const snap = await api("/api/db/snapshot", { auth: true, ttl: 60000 });
    const pend = snap.pending_drafts || [];
    $("#apprBox").innerHTML = pend.length ? pend.map((p) => `
      <div class="card hot">
        <div class="chead"><span class="pill p-brass">${esc(p.channel || "TG")}</span>
          <span class="cname">${esc(p.client || p.username || p.id)}</span>
          <span class="spacer mtext">${esc(p.last_activity || "")}</span></div>
        <div class="mtext" style="margin-top:6px">${esc((p.draft || p.desc || "").slice(0, 220))}</div>
        <div class="callay" style="margin-top:10px">
          <button class="btn go" data-a="send" data-id="${esc(p.id)}">Разрешить отправку</button>
          <button class="btn stop" data-a="reject" data-id="${esc(p.id)}">Отклонить</button>
        </div>
      </div>`).join("") : `<div class="empty">Очередь пуста</div>`;
    $("#apprBox").querySelectorAll("button[data-a]").forEach((b) => (b.onclick = () => approval(b.dataset.a, b.dataset.id, b)));
  } catch (e) {
    $("#apprBox").innerHTML = `<div class="card"><div class="mtext">${e.message === "no_token" || e.message === "forbidden"
      ? "Нужен админ-ключ — раздел с деньгами закрыт." : "Список апрувов недоступен: " + esc(e.message)}</div></div>`;
  }
}
async function approval(action, id, btn) {
  btn.disabled = true;
  try {
    const r = await api("/api/approval/" + (action === "send" ? "send" : "reject"), {
      method: "POST", body: action === "send" ? { approval_id: id } : { approval_id: id, reason: "via LCB app" },
    });
    toast(action === "send" ? `Отправлено: ${r.who || id} · ${r.status || "ok"}` : "Отклонено");
    delete S.cache["/api/db/snapshot"];
    renderToday();
  } catch (e) {
    if (e.status === 409) toast("Отправка остановлена preflight-защитой (грязный worktree) — это предохранитель, не сбой", true);
    else if (e.message !== "no_token" && e.message !== "forbidden") toast("Не вышло: " + e.message, true);
    btn.disabled = false;
  }
}

/* ── чаты: папки-воронка ────────────────────────────────────────────────── */
const FOLDERS = [
  { key: "hot", label: "Горячие", match: (s) => ["Переговоры", "Интерес", "Прямой лид"].includes(s) },
  { key: "new", label: "Новые", match: (s) => ["Новый", "Написал"].includes(s) },
  { key: "fu", label: "Follow-up", match: (s) => ["Follow-up", "Посредник"].includes(s) },
  { key: "paid", label: "Оплатили", match: (s) => /ОПЛА|Концерт/i.test(s || "") },
  { key: "all", label: "Все", match: () => true },
];
S.dir = "lcb"; S.folder = "hot";
async function renderChats() {
  const box = $("#scr-chats");
  box.innerHTML = `
    <div class="dirsw">
      <button data-d="lcb" class="${S.dir === "lcb" ? "on" : ""}">LCB клиенты</button>
      <button data-d="mus" class="${S.dir === "mus" ? "on" : ""}">Музыканты</button>
      <button data-d="brk" class="${S.dir === "brk" ? "on" : ""}">Брокер</button>
    </div>
    <div class="folders" id="chatFolders"></div>
    <div id="thrList"><div class="skel"></div><div class="skel"></div></div>`;
  box.querySelectorAll(".dirsw button").forEach((b) => (b.onclick = () => { S.dir = b.dataset.d; renderChats(); }));

  if (S.dir !== "lcb") {
    $("#chatFolders").innerHTML = "";
    $("#thrList").innerHTML = `<div class="card"><div class="cname">${S.dir === "mus" ? "Музыканты" : "Брокер-подрядчики"}</div>
      <div class="mtext" style="margin-top:6px">Треды ${S.dir === "mus" ? "штатных музыкантов" : "подрядчиков"} живут в отдельных сторах (band-чаты / broker_orders), и в API пока нет ручки списка — она в списке доработок бэкенда. Открыть конкретную переписку уже можно через поиск: введи @username выше и нажми Enter.</div></div>`;
    return;
  }
  $("#chatFolders").innerHTML = FOLDERS.map((f) => `<button data-f="${f.key}" class="${S.folder === f.key ? "on" : ""}">${f.label}</button>`).join("");
  $("#chatFolders").querySelectorAll("button").forEach((b) => (b.onclick = () => { S.folder = b.dataset.f; renderChats(); }));

  let rows = [];
  try {
    const snap = await api("/api/db/snapshot", { auth: true, ttl: 120000 });
    rows = snap.active || [];
  } catch (e) {
    // fallback без ключа: воронка из открытой ручки
    try {
      const f = await api("/api/inbound_funnel", { ttl: 600000 });
      rows = (f.leads || []).map((l) => ({ client: l.username, username: l.username, status: ({ negotiating: "Переговоры", inquiry_received: "Новый", confirmed: "ОПЛАТИЛА" }[l.stage] || l.stage), last_activity: (l.last_activity_at || "").slice(0, 16).replace("T", " "), desc: l.summary }));
    } catch {}
  }
  const fol = FOLDERS.find((f) => f.key === S.folder) || FOLDERS[0];
  const q = S.search.toLowerCase();
  let list = rows.filter((r) => fol.match(String(r.status || "")));
  if (q) list = list.filter((r) => ((r.client || "") + " " + (r.username || "") + " " + (r.desc || "")).toLowerCase().includes(q));
  list.sort((a, b) => String(b.last_activity || "").localeCompare(String(a.last_activity || "")));
  $("#thrList").innerHTML = list.slice(0, 60).map((r) => `
    <button class="thr" data-q="${esc(r.username || r.client || "")}">
      <div class="t1"><span class="who">${esc(r.client || r.username || "—")}</span>
        <span class="pill p-pine">${esc(r.status || "")}</span>
        <span class="when">${esc(String(r.last_activity || "").slice(0, 16))}</span></div>
      <div class="prev">${esc((r.desc || "").slice(0, 140))}</div>
    </button>`).join("") || `<div class="empty">Пусто в этой папке</div>`;
  $("#thrList").querySelectorAll(".thr").forEach((t) => (t.onclick = () => t.dataset.q && nav("#chat/" + encodeURIComponent(t.dataset.q))));
}

/* ── чат ────────────────────────────────────────────────────────────────── */
async function renderChat(q) {
  const box = $("#scr-view");
  box.innerHTML = `<div class="backrow"><button class="btn" onclick="history.back()">‹ Назад</button>
    <span class="cname">@${esc(q.replace(/^@/, ""))}</span></div><div id="chatView"><div class="skel"></div></div>`;
  try {
    const r = await api("/api/chat?q=" + encodeURIComponent(q) + "&limit=40", { ttl: 30000 });
    const msgs = r.messages || [];
    $("#chatView").innerHTML = msgs.map((m) => `
      <div class="bub ${m.out ? "out" : "in"}">${esc(m.text || (m.media ? "📎 медиа" : ""))}
        <div class="bmeta">${esc(m.date || "")}${m.out ? " · мы" : ""}</div></div>`).join("") || `<div class="empty">Локальная история пуста</div>`;
    $("#chatView").insertAdjacentHTML("beforeend",
      `<div class="mtext" style="margin:14px 0">Источник: ${esc(r.source || "локальные сторы")}. Ответы уходят только через пайплайн с ревью — ручной ввод из приложения отключён политикой TG-сессий. Точечный ручной режим диалога — через approval-бот.</div>`);
  } catch (e) {
    $("#chatView").innerHTML = `<div class="empty">${e.status === 503 ? "Переписка не найдена в локальных сторах" : "Ошибка: " + esc(e.message)}</div>`;
  }
}

/* ── событие ────────────────────────────────────────────────────────────── */
async function renderEvent(eid) {
  const box = $("#scr-view");
  box.innerHTML = `<div class="backrow"><button class="btn" onclick="history.back()">‹ Назад</button></div><div id="evBox"><div class="skel"></div><div class="skel"></div></div>`;
  try {
    const ev = await api("/api/events/" + encodeURIComponent(eid), { ttl: 60000 });
    const fin = ev.finance || {};
    const ck = ev.ops_checklist || [];
    const done = ck.filter((c) => c.status === "done").length;
    const lineup = ((ev.sections || []).find((s) => /Состав/i.test(s.name)) || {}).rows || [];
    const docsSec = (ev.sections || []).filter((s) => /Договор|Паспорта|Тайминг/i.test(s.name));
    $("#evBox").innerHTML = `
      <div class="chead"><span class="cname" style="font-size:17px">${esc(ev.title || eid)}</span>
        <span class="spacer pill p-brass num">${money(fin.client_total)} · осталось ${money(fin.client_remaining)}</span></div>
      <div class="mtext">${esc(ev.date || "")}${ev.notes ? " · " + esc(String(ev.notes).slice(0, 120)) : ""}</div>
      <div class="callay" style="margin-top:8px">${lineup.map((r) => {
        const paidOk = String(r["Статус ставки"] || "").toLowerCase().includes("оплач") || +r["Предоплата"] > 0;
        return `<span class="pill ${paidOk ? "p-ok" : "p-warn"}">${esc(r["Имя"] || "?")} · ${esc(r["Роль"] || "")}</span>`;
      }).join("")}</div>

      <div class="card"><div class="cname">Чек-лист · ${done} из ${ck.length}</div>
        ${ck.map((c) => `
          <div class="ck"><div class="ckdot ${c.status === "done" ? "done" : "gap"}">${c.status === "done" ? "✓" : "!"}</div>
            <div><div class="t">${esc(c.label || c.key)}${c.total_count ? ` · ${c.done_count || 0}/${c.total_count}` : ""}</div>
              ${c.detail ? `<div class="why">${esc(c.detail)}</div>` : ""}
              ${c.status !== "done" ? `<div class="why">Пайплайн ведёт этот пункт сам; если завис — причина будет в «Требуют внимания» на Сегодня.</div>` : ""}</div></div>`).join("") || `<div class="empty">Чек-лист пуст</div>`}
      </div>

      <div class="card"><div class="cname">Финансы</div>
        <div class="stats" style="margin-top:8px">
          <div class="stat"><div class="l">Клиент всего</div><div class="v num">${money(fin.client_total)}</div></div>
          <div class="stat"><div class="l">Получено</div><div class="v num" style="color:var(--ok)">${money(fin.client_paid)}</div></div>
          <div class="stat"><div class="l">Остаток</div><div class="v num" style="color:var(--brass)">${money(fin.client_remaining)}</div></div>
          <div class="stat"><div class="l">Составу</div><div class="v num">${money(fin.band_total)}</div></div>
        </div>
        ${(fin.reconciliation || []).map((r) => `<div class="mtext" style="margin-top:6px">⚠ ${esc(r.label)}: ${esc(r.detail || "")}</div>`).join("")}
      </div>

      ${docsSec.map((s) => `<div class="card"><div class="cname">${esc(s.name)}</div>
        ${(s.rows || []).slice(0, 8).map((r) => `<div class="doc"><div class="ic">§</div><div style="min-width:0">
          ${Object.entries(r).slice(0, 3).map(([k, v]) => `<div class="st"><b style="font-weight:500">${esc(k)}:</b> ${esc(String(v).slice(0, 80))}</div>`).join("")}
        </div></div>`).join("") || `<div class="empty">Пусто</div>`}</div>`).join("")}
      <div class="mtext" style="margin:12px 0">Отправка документов контактам карточки уйдёт через пайплайн-ревью — кнопка появится вместе с ручкой /api/event_send (в доработках бэкенда).</div>`;
  } catch (e) {
    $("#evBox").innerHTML = `<div class="empty">Событие не найдено: ${esc(e.message)}</div>`;
  }
}

/* ── система ────────────────────────────────────────────────────────────── */
async function renderSys() {
  const box = $("#scr-sys");
  box.innerHTML = `<div class="stats" id="sysKpi"></div>
    <div class="card"><div class="cname">Процессы за 24ч</div><div id="procBox"><div class="skel"></div></div></div>
    <div class="card"><div class="cname">Токены сегодня</div><div id="tokBox"><div class="skel"></div></div></div>
    <div class="card"><div class="cname">Здоровье рантайма</div><div id="rhBox"><div class="skel"></div></div></div>`;
  try {
    const [act, usage, rh, tun] = await Promise.all([
      api("/api/process_activity_24h", { ttl: 120000 }),
      api("/api/ai_usage_breakdown", { ttl: 120000 }),
      api("/api/runtime_health", { ttl: 60000 }),
      api("/api/cloudflare_tunnel_status", { ttl: 60000 }).catch(() => null),
    ]);
    const procs = Object.entries(act).filter(([k]) => k.startsWith("proc_"));
    const aiCalls = (act._ai_calls_24h || {}).count || 0;
    $("#sysKpi").innerHTML = `
      <div class="stat"><div class="l">AI-вызовов за 24ч</div><div class="v num">${RUB.format(aiCalls)}</div></div>
      <div class="stat"><div class="l">Процессов активно</div><div class="v num">${procs.filter(([, v]) => (v.count || 0) > 0).length}/${procs.length}</div></div>
      <div class="stat"><div class="l">Здоровье</div><div class="v" style="color:${rh.level === "ok" ? "var(--ok)" : rh.level === "warn" ? "var(--warn)" : "var(--dang)"}">${esc(rh.level)}</div></div>
      <div class="stat"><div class="l">Туннель</div><div class="v">${tun ? (tun.stale ? "устарел" : "жив") : "—"}</div></div>`;
    $("#procBox").innerHTML = procs.map(([k, v]) => `
      <div class="proc"><span class="lamp ${(v.count || 0) > 0 ? "" : "wr"}"></span>
        <span>${esc(k.replace("proc_", ""))}</span>
        <span class="spacer mtext num">${v.count ?? "—"} ${esc(v.unit || "")}</span></div>`).join("");
    const t = usage.today || {};
    const days = usage.days || [];
    const maxTok = Math.max(1, ...days.map((d) => (d.input_tok || 0) + (d.output_tok || 0)));
    $("#tokBox").innerHTML = `
      <div class="mtext">Сегодня: <span class="num">${RUB.format(t.calls || 0)}</span> вызовов · in ${RUB.format(t.input_tok || 0)} · out ${RUB.format(t.output_tok || 0)}</div>
      ${Object.entries((usage.window || {}).by_service || {}).map(([svc, v]) => `
        <div class="mtext" style="margin-top:6px">${esc(svc)} <span class="num">${RUB.format(v.calls || 0)}</span></div>
        <div class="bar"><i style="width:${Math.min(100, Math.round(100 * (v.calls || 0) / Math.max(1, (usage.window || {}).calls || 1)))}%"></i></div>`).join("")}
      <div class="mtext" style="margin-top:10px">7 дней (токены):</div>
      <div style="display:flex; gap:4px; align-items:flex-end; height:56px; margin-top:6px">
        ${days.map((d) => `<div title="${esc(d.date)}" style="flex:1;background:var(--pine);border-radius:3px 3px 0 0;height:${Math.max(5, Math.round(100 * ((d.input_tok || 0) + (d.output_tok || 0)) / maxTok))}%"></div>`).join("")}
      </div>`;
    $("#rhBox").innerHTML = (rh.log_sizes || []).map((l) => `
      <div class="proc"><span class="lamp ${l.level === "ok" ? "" : l.level === "warn" ? "wr" : "dn"}"></span>
        <span>${esc(l.name)}</span><span class="spacer mtext num">${esc(l.human || "")}</span></div>`).join("") +
      `<div class="mtext" style="margin-top:8px">Offsite-бэкап и статус 3 TG-сессий появятся здесь с новыми ручками бэкенда (в доработках).</div>`;
  } catch (e) {
    box.insertAdjacentHTML("beforeend", `<div class="empty">Система недоступна: ${esc(e.message)}</div>`);
  }
}

/* ── глобальные контролы ────────────────────────────────────────────────── */
$("#themeBtn").addEventListener("click", () => {
  const r = document.documentElement;
  const dark = r.getAttribute("data-theme") === "dark" || (!r.getAttribute("data-theme") && matchMedia("(prefers-color-scheme: dark)").matches);
  r.setAttribute("data-theme", dark ? "light" : "dark");
  localStorage.setItem("lcb_app_theme", r.getAttribute("data-theme"));
});
const savedTheme = localStorage.getItem("lcb_app_theme");
if (savedTheme) document.documentElement.setAttribute("data-theme", savedTheme);

$("#reloadBtn").addEventListener("click", () => { S.cache = {}; render(); });
$("#search").addEventListener("input", (e) => { S.search = e.target.value.trim(); if (S.tab === "cal") renderCal(); if (S.tab === "chats") renderChats(); });
$("#search").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && S.search.startsWith("@")) nav("#chat/" + encodeURIComponent(S.search.replace(/^@/, "")));
});

function render() { route(); }
if ("serviceWorker" in navigator) navigator.serviceWorker.register("app-sw.js").catch(() => {});
resolveBase(false).then(render);

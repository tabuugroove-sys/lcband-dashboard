/* LCB app v2 — мессенджер (§3.3 ТЗ): направления LCB|Музыканты|Брокер,
   папки по серверному stage, три счётчика, треды с черновиками агента
   (Подтвердить/Отклонить), «Открыть в Telegram», app-локальный read-state.
   Desktop (≥900px) — постоянный split-view как в Telegram: рейл папок +
   колонка списка + правая панель треда. Mobile — стек v2 без изменений.
   Ручного ввода НЕТ; наружу уходят только /api/approval/send|reject
   с одним полем approval_id (жёсткий канон §1.2). */
"use strict";

function isDesktop() { return matchMedia("(min-width:900px)").matches; }

const DIRS = [
  { key: "lcb", label: "LCB" },
  { key: "musicians", label: "Музыканты" },
  { key: "broker", label: "Брокер" },
];
const STAGE_FOLDERS = [
  { key: "hot", label: "Горячие" },
  { key: "new", label: "Новые" },
  { key: "followup", label: "Follow-up" },
  { key: "paid", label: "Оплатили" },
  { key: "all", label: "Все" },
];
/* рейл папок desktop: 5 LCB-папок + два направления, телеграмная структура */
const RAIL_ITEMS = [
  { key: "hot", dir: "lcb", folder: "hot", icon: "🔥", label: "Горячие" },
  { key: "new", dir: "lcb", folder: "new", icon: "✨", label: "Новые" },
  { key: "followup", dir: "lcb", folder: "followup", icon: "⏳", label: "Follow-up" },
  { key: "paid", dir: "lcb", folder: "paid", icon: "💰", label: "Оплатили" },
  { key: "all", dir: "lcb", folder: "all", icon: "👥", label: "Все LCB" },
  { key: "musicians", dir: "musicians", folder: "all", icon: "🎸", label: "Музыканты" },
  { key: "broker", dir: "broker", folder: "all", icon: "🤝", label: "Брокер" },
];

/* серверное поле stage; клиентский fallback только как деградация при старом бэкенде */
function stageOf(t) {
  if (t.stage) return t.stage;
  const s = String(t.status || "");
  if (["Переговоры", "Интерес", "Прямой лид"].includes(s)) return "hot";
  if (["Новый", "Написал"].includes(s)) return "new";
  if (["Follow-up", "Посредник"].includes(s)) return "followup";
  if (/ОПЛА|Концерт/i.test(s)) return "paid";
  return "other";
}

/* ── аватарки: изображение с бэкенда, при 404 — инициалы с детерминированным цветом ── */
const AVA_COLORS = ["#E17076", "#EDA86C", "#A695E7", "#7BC862", "#6EC9CB", "#65AADD", "#EE7AAE", "#8A9AA9"];
function avaColor(key) {
  let h = 0;
  const s = String(key || "?");
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return AVA_COLORS[h % AVA_COLORS.length];
}
function initialsOf(display, username) {
  const d = String(display || "").trim();
  if (d) {
    const w = d.split(/\s+/);
    return ((w[0][0] || "") + (w.length > 1 ? (w[1][0] || "") : "")).toUpperCase();
  }
  const u = String(username || "").replace(/^@/, "");
  return u.slice(0, 2).toUpperCase() || "?";
}
function avatarHtml(t) {
  t = t || {};
  const uname = String(t.username || "").replace(/^@/, "");
  const key = uname || t.display || "?";
  const init = esc(initialsOf(t.display || t.client, uname));
  const avaPath = t.avatar || (uname && String(t.channel || "TG").toUpperCase() === "TG" ? "/api/avatar/tg/" + encodeURIComponent(uname) : null);
  const img = avaPath ? `<img src="${esc((S.base || "") + avaPath)}" alt="" loading="lazy" onerror="this.remove()">` : "";
  return `<span class="ava" style="background:${avaColor(key)}">${init}${img}</span>`;
}

function unreadBadge(n) {
  n = +n || 0;
  if (n <= 0) return "";
  const s = n > 99 ? "99+" : (n > 1 ? String(n) : "");
  return `<span class="ub${s ? "" : " dot"}">${s}</span>`;
}

/* ── ключи тредов для /api/app/read (§4.2.3) и навигации ────────────────── */
function threadKeyOf(t) {
  const ch = String(t.channel || "TG").toUpperCase();
  if (ch === "VK") {
    const u = String(t.username || "");
    return u.startsWith("vk:") ? u : "vk:" + (t.user_id || t.vk_id || u.replace(/^@/, "") || "");
  }
  if (ch === "WA") return "wa:" + String(t.phone || t.username || "").replace(/^wa:/, "");
  if (t.username) return String(t.username).replace(/^@/, "");
  if (t.user_id) return "id:" + t.user_id;
  if (t.chat_id != null) return String(t.chat_id);
  return "";
}
function threadNavQ(t) {
  const ch = String(t.channel || "TG").toUpperCase();
  if (ch === "VK") return String(t.username || "").startsWith("vk:") ? t.username : "vk:" + (t.user_id || t.vk_id || "");
  if (ch === "WA") return "wa:" + String(t.phone || t.username || "").replace(/^wa:/, "");
  return t.username || (t.user_id ? "id:" + t.user_id : (t.chat_id != null ? String(t.chat_id) : ""));
}
function threadChannelOf(row, q) {
  return (row && String(row.channel || "").toUpperCase()) ||
    (q.startsWith("vk:") ? "VK" : q.startsWith("wa:") ? "WA" : "TG");
}

/* ── счётчики (§3.3.1): /api/app/counters, деградация без ручки → «—» ───── */
async function fetchCounters() {
  try {
    const c = await api("/api/app/counters", { ttl: 25000 });
    S.counters = c;
    S.flags.noCounters = false;
  } catch (e) {
    if (e.status === 404 || e.status === 503) {
      S.flags.noCounters = true;
      warnOnce("counters", "GET /api/app/counters недоступна — счётчики показывают «—»");
    } else if (e.status === 403) {
      S.counters = null;
    }
  }
  updateChatsBadge();
  if (S.tab === "chats") { updateCountersRow(); drawDirs(); }
}
function updateChatsBadge() {
  const b = $("#chatsTabBadge");
  if (!b) return;
  const n = (S.counters && +S.counters.unread_total) || 0;
  if (n > 0) { b.hidden = false; b.textContent = n > 99 ? "99+" : String(n); }
  else b.hidden = true;
}
function updateCountersRow() {
  const rowEl = $("#cntRow");
  if (!rowEl) return;
  const c = S.counters;
  const v = (x) => (x == null ? "—" : (x > 99 ? "99+" : String(x)));
  const un = c ? c.unread_total : null;
  const pe = c ? c.pending_approvals : null;
  const se = c && c.sent_today ? c.sent_today.total : null;
  rowEl.innerHTML = `
    <button class="cnt blue ${S.unreadOnly ? "on" : ""}" id="cntUnread" title="только с непрочитанным">
      <span class="cv"><span class="cdot2"></span>${v(un)}</span><span class="cl">непрочитано</span></button>
    <button class="cnt brass ${S.chatsView === "approvals" ? "on" : ""}" id="cntPend" title="список апрувов">
      <span class="cv"><span class="cdot2"></span>${v(pe)}</span><span class="cl">ждут подтверждения</span></button>
    <button class="cnt green" id="cntSent" title="разбивка по каналам">
      <span class="cv"><span class="cdot2"></span>${v(se)}</span><span class="cl">отправлено · за день МСК</span></button>`;
  $("#cntUnread").onclick = () => { S.unreadOnly = !S.unreadOnly; updateCountersRow(); drawThreads(); };
  $("#cntPend").onclick = () => { S.chatsView = S.chatsView === "approvals" ? "threads" : "approvals"; updateCountersRow(); drawThreads(); };
  $("#cntSent").onclick = toggleSentBreak;
}
function toggleSentBreak() {
  const b = $("#sentBreak");
  if (!b) return;
  if (b.style.display !== "none") { b.style.display = "none"; return; }
  const st = (S.counters && S.counters.sent_today) || null;
  b.innerHTML = st
    ? `Каналы: TG ${st.tg ?? 0} · VK ${st.vk ?? 0} · IG ${st.ig ?? 0} · WA ${st.wa ?? 0} — агентские отправки за день МСК (авто + апрувы); ручные из родного Telegram не считаются`
    : "Разбивка недоступна (нет ручки счётчиков)";
  b.style.display = "block";
}

/* ── экран «Чаты»: mobile-стек или desktop split-view ───────────────────── */
function chatsPollTick() { delete S.cache["/api/threads?dir=" + S.dir]; drawThreads(); }
function splitEmptyHtml() { return `<div class="sempty">Выбери диалог слева</div>`; }

async function renderChats() {
  const box = $("#scr-chats");
  if (isDesktop()) {
    box.innerHTML = `
      <div class="split">
        <div class="srail" id="chatRail"></div>
        <div class="slist">
          <div id="cntRow" class="cnt-row"></div>
          <div id="sentBreak" class="mtext sentbreak" style="display:none"></div>
          <div class="ssearchwrap"><input id="chatSearch" class="dinput" type="search" placeholder="Поиск" value="${esc(S.search)}" autocomplete="off"></div>
          <div id="chatsBar" class="chatsbar"></div>
          <div id="thrList"><div class="skel"></div><div class="skel"></div><div class="skel"></div></div>
        </div>
        <div class="sview" id="splitThread">${splitEmptyHtml()}</div>
      </div>`;
    drawRail();
    $("#chatSearch").oninput = (e) => { S.search = e.target.value.trim(); drawThreads(); };
  } else {
    box.innerHTML = `
      <div id="cntRow" class="cnt-row"></div>
      <div id="sentBreak" class="mtext sentbreak" style="display:none"></div>
      <div class="dirsw" id="dirSw"></div>
      <div class="folders" id="chatFolders"></div>
      <div id="chatsBar" class="chatsbar"></div>
      <div id="thrList"><div class="skel"></div><div class="skel"></div><div class="skel"></div></div>`;
    drawDirs();
  }
  updateCountersRow();
  fetchCounters();
  startPoll("screen:chats", chatsPollTick, 60000);
  await drawThreads();
}

/* рейл папок (desktop) */
function drawRail() {
  const r = $("#chatRail");
  if (!r) return;
  r.innerHTML = RAIL_ITEMS.map((it) => {
    const on = S.dir === it.dir && (it.dir !== "lcb" || S.folder === it.folder);
    return `<button class="ritem ${on ? "on" : ""}" data-k="${it.key}">
      <span class="ricon">${it.icon}<span class="rbadge" data-b="${it.key}" hidden></span></span>
      <span class="rlabel">${it.label}</span></button>`;
  }).join("");
  r.querySelectorAll(".ritem").forEach((b) => (b.onclick = () => {
    const it = RAIL_ITEMS.find((x) => x.key === b.dataset.k);
    if (it) railClick(it);
  }));
  updateRailBadges(null);
}
async function railClick(it) {
  S.dir = it.dir;
  S.folder = it.folder;
  S.chatsView = "threads";
  drawRail();
  updateCountersRow();
  await drawThreads();
  // открытый тред сохраняется, если есть в новой папке; иначе пустое состояние
  if (S.chat) {
    const present = S.chat.dir === S.dir && (S.lastList || []).some((t) => threadNavQ(t) === S.chat.q);
    if (present) markSelectedRow();
    else closeThreadPanel();
  }
}
async function updateRailBadges(lcbRows) {
  const set = (k, n) => {
    const b = document.querySelector(`.rbadge[data-b="${k}"]`);
    if (!b) return;
    n = +n || 0;
    if (n > 0) { b.hidden = false; b.textContent = n > 99 ? "99+" : String(n); }
    else b.hidden = true;
  };
  const by = (S.counters && S.counters.unread_by_dir) || {};
  set("musicians", by.musicians);
  set("broker", by.broker);
  let rows = lcbRows;
  if (!rows) {
    const hit = S.cache["/api/threads?dir=lcb"];
    if (hit && hit.data) rows = hit.data.threads || hit.data.rows || [];
  }
  if (rows) {
    const un = {};
    let all = 0;
    for (const t of rows) {
      const n = +t.unread > 0 ? +t.unread : 0;
      const st = t.__stage || stageOf(t);
      un[st] = (un[st] || 0) + n;
      all += n;
    }
    set("hot", un.hot); set("new", un.new); set("followup", un.followup); set("paid", un.paid); set("all", all);
  } else {
    set("all", by.lcb);
  }
}

/* направления/папки (mobile); на desktop счётчики капают в рейл */
function drawDirs() {
  if (isDesktop()) { updateRailBadges(null); return; }
  const d = $("#dirSw");
  if (!d) return;
  const by = (S.counters && S.counters.unread_by_dir) || {};
  d.innerHTML = DIRS.map((x) =>
    `<button data-d="${x.key}" class="${S.dir === x.key ? "on" : ""}">${x.label}${unreadBadge(+by[x.key] || 0)}</button>`).join("");
  d.querySelectorAll("button").forEach((b) => (b.onclick = () => {
    S.dir = b.dataset.d; S.folder = "hot"; S.chatsView = "threads"; renderChats();
  }));
}
function drawFolders(rows) {
  if (isDesktop()) { updateRailBadges(S.dir === "lcb" ? rows : null); return; }
  const f = $("#chatFolders");
  if (!f) return;
  if (S.dir !== "lcb" || rows === null) { f.innerHTML = ""; return; }
  const un = {};
  for (const t of rows || []) {
    const n = +t.unread > 0 ? +t.unread : 0;
    const st = t.__stage || "other";
    un[st] = (un[st] || 0) + n;
    un.all = (un.all || 0) + n;
  }
  f.innerHTML = STAGE_FOLDERS.map((x) =>
    `<button data-f="${x.key}" class="${S.folder === x.key ? "on" : ""}">${x.label}${unreadBadge(x.key === "all" ? (un.all || 0) : (un[x.key] || 0))}</button>`).join("");
  f.querySelectorAll("button").forEach((b) => (b.onclick = () => { S.folder = b.dataset.f; drawThreads(); }));
}

async function drawThreads() {
  const listBox = $("#thrList");
  if (!listBox) return;
  if (S.chatsView === "approvals") { drawFolders(null); return drawApprovalsList(); }
  let rows = null, fellBack = false;
  try {
    const r = await api("/api/threads?dir=" + S.dir, { ttl: 60000 });
    rows = r.threads || r.rows || (Array.isArray(r) ? r : []);
  } catch (e) {
    if (e.status === 403) {
      drawFolders(null);
      listBox.innerHTML = `<div class="empty">Раздел закрыт — введи ключ в шторке индикатора</div>`;
      $("#chatsBar").innerHTML = "";
      return;
    }
    warnOnce("thr_" + S.dir, "GET /api/threads?dir=" + S.dir + " недоступна (" + (e.status || "сеть") + ")");
    if (S.dir === "lcb") {
      // деградация до v1-источников: без unread/preview, но без белого экрана
      try {
        const snap = await api("/api/db/snapshot", { ttl: 120000 });
        rows = (snap.active || []).map((r0) => ({
          username: r0.username, display: r0.client || r0.username, status: r0.status,
          last_activity: r0.last_activity, preview: r0.desc || "", channel: "TG",
        }));
        fellBack = true;
      } catch (e2) {
        try {
          const fu = await api("/api/inbound_funnel", { ttl: 600000 });
          rows = (fu.leads || []).map((l) => ({
            username: l.username, display: l.username,
            status: ({ negotiating: "Переговоры", inquiry_received: "Новый", confirmed: "ОПЛАТИЛА" }[l.stage] || l.stage),
            last_activity: l.last_activity_at, preview: l.summary || "", channel: "TG",
          }));
          fellBack = true;
        } catch (e3) { rows = null; }
      }
    }
  }
  if (rows == null) {
    drawFolders(null);
    listBox.innerHTML = `<div class="empty">Список тредов недоступен — бэкенд не отвечает</div>`;
    $("#chatsBar").innerHTML = "";
    return;
  }
  for (const t of rows) { t.__stage = stageOf(t); t.__epoch = epochOf(t); }
  S.thrIndex = S.thrIndex || {};
  for (const t of rows) { const nq = threadNavQ(t); if (nq) S.thrIndex[S.dir + ":" + nq] = t; }
  // deep-link на desktop: раскрыть папку, в которой живёт открытый тред
  if (S.folderRevealQ) {
    if (isDesktop() && S.dir === "lcb" && S.folder !== "all") {
      const selRow = rows.find((t) => threadNavQ(t) === S.folderRevealQ);
      if (selRow && selRow.__stage !== S.folder) {
        S.folder = ["hot", "new", "followup", "paid"].includes(selRow.__stage) ? selRow.__stage : "all";
        drawRail();
      }
    }
    S.folderRevealQ = null;
  }
  drawFolders(rows);
  let list = rows.slice();
  if (S.dir === "lcb" && S.folder !== "all") list = list.filter((t) => t.__stage === S.folder);
  if (S.unreadOnly) list = list.filter((t) => +t.unread > 0);
  const q = S.search.toLowerCase();
  if (q) list = list.filter((t) => ((t.display || "") + " " + (t.username || "") + " " + (t.preview || "")).toLowerCase().includes(q));
  list.sort((a, b) => (b.__epoch || 0) - (a.__epoch || 0)); // epoch desc, числом
  S.lastList = list;
  const anyUnread = list.some((t) => +t.unread > 0);
  $("#chatsBar").innerHTML = anyUnread ? `<button class="btn" id="readAll">Прочитать всё</button>` : "";
  if (anyUnread) $("#readAll").onclick = () => markAllRead(list);
  listBox.innerHTML = list.slice(0, 100).map(threadRowHtml).join("") || `<div class="empty">В этой папке тихо</div>`;
  if (fellBack) listBox.insertAdjacentHTML("beforeend",
    `<div class="mtext" style="text-align:center;margin-top:8px">Упрощённый список (без unread) — новая ручка тредов недоступна</div>`);
  listBox.querySelectorAll(".trow").forEach((b) => (b.onclick = () => {
    const nq = b.dataset.q;
    if (nq) nav("#chat/" + S.dir + "/" + encodeURIComponent(nq));
  }));
  markSelectedRow();
}
function threadRowHtml(t) {
  const nq = threadNavQ(t);
  const uname = String(t.username || "").replace(/^@/, "");
  const when = tgTime(t.__epoch) || String(t.last_activity || "").slice(0, 16);
  const prev = t.preview != null && t.preview !== ""
    ? (t.preview_out ? "Вы: " : "") + t.preview
    : (t.status || "");
  return `<button class="thr trow" data-q="${esc(nq)}">
    ${avatarHtml(t)}
    <span class="tmain">
      <span class="t1"><span class="who">${esc(t.display || t.client || uname || "—")}</span>
        ${uname ? `<span class="uname">@${esc(uname)}</span>` : ""}
        <span class="when">${esc(when)}</span></span>
      <span class="t2"><span class="prev">${esc(trunc(prev, 120))}</span>
        ${t.has_pending_approval ? `<span class="pend-dot" title="есть черновик — ждёт подтверждения"></span>` : ""}
        ${unreadBadge(t.unread)}</span>
    </span></button>`;
}
function markSelectedRow() {
  document.querySelectorAll("#thrList .trow").forEach((b) =>
    b.classList.toggle("sel", !!S.chat && b.dataset.q === S.chat.q));
}
/* синяя точка гаснет прямо в списке, без перерисовки всей панели */
function clearUnreadDom(q) {
  document.querySelectorAll("#thrList .trow").forEach((b) => {
    if (b.dataset.q === q) { const ub = b.querySelector(".ub"); if (ub) ub.remove(); }
  });
}

/* «Прочитать всё» — bulk-форма /api/app/read (§4.2.3) */
async function markAllRead(list) {
  const now = Math.round(Date.now() / 1000);
  const items = list.filter((t) => +t.unread > 0).map((t) => ({
    channel: String(t.channel || "TG").toUpperCase(),
    thread: threadKeyOf(t),
    last_seen_epoch: t.__epoch || now,
  })).filter((x) => x.thread);
  if (!items.length) return;
  for (const t of list) if (+t.unread > 0) t.unread = 0; // optimistic: сервер — истина при следующем поллинге
  drawThreads();
  try {
    await api("/api/app/read", { method: "POST", body: { threads: items } });
    delete S.cache["/api/app/counters"];
    fetchCounters();
    toast("Прочитано: " + items.length);
  } catch (e) {
    if (e.status === 404 || e.status === 503) warnOnce("appread", "POST /api/app/read недоступна — read-state не сохраняется");
    else if (e.status === 403) toast("Нужен код доступа — введи в шторке индикатора", true);
  }
}

/* ── черновики агента: /api/approvals?full=1 (§4.2.2) ───────────────────── */
async function approvalsFull() {
  try {
    const r = await api("/api/approvals?full=1", { ttl: 30000 });
    return r.approvals || [];
  } catch (e) {
    if (e.status === 403) { warnOnce("apr403", "Апрувы закрыты без ключа (403)"); return []; }
    warnOnce("aprfull", "GET /api/approvals?full=1 недоступна (" + (e.status || "сеть") + ") — пробую базовую форму");
    try {
      const r = await api("/api/approvals", { ttl: 30000 });
      return r.approvals || [];
    } catch (e2) { return []; }
  }
}
function normalizeAp(a) {
  return {
    id: a.id, username: a.username, client: a.client || "",
    channel: a.channel || "TG", kind: a.kind || "", folder: a.folder || "",
    draft: a.draft || a.desc || "", money_intent: !!a.money_intent,
    status: a.status || "pending", created_at: a.created_at || a.last_activity || "",
  };
}

/* список апрувов (клик по счётчику «ждут») */
async function drawApprovalsList() {
  const listBox = $("#thrList");
  if (!listBox) return;
  $("#chatsBar").innerHTML = `<button class="btn" id="aprBack">‹ К тредам</button>`;
  $("#aprBack").onclick = () => { S.chatsView = "threads"; updateCountersRow(); drawThreads(); };
  listBox.innerHTML = `<div class="skel"></div>`;
  const list = (await approvalsFull()).map(normalizeAp).filter((a) => a.status === "pending");
  listBox.innerHTML = list.map((a, i) => `
    <div class="card hot" data-ap="${esc(a.id)}" data-i="${i}">
      <div class="chead"><span class="pill p-brass">${esc(a.channel)}</span>
        <span class="cname">${esc(a.client || a.username || a.id)}</span>
        ${a.money_intent ? `<span class="pill p-brass">деньги</span>` : ""}
        <span class="spacer mtext">${esc(a.folder || a.kind)}</span></div>
      <div class="mtext" style="margin-top:6px;white-space:pre-wrap">${esc(trunc(a.draft, 220))}</div>
      <div class="callay" style="margin-top:10px">
        <button class="btn go" data-act="send">Подтвердить</button>
        <button class="btn stop" data-act="reject">Отклонить</button>
        ${a.username ? `<button class="btn" data-act="open">Открыть тред</button>` : ""}
      </div>
    </div>`).join("") || `<div class="empty">Очередь пуста — никто не ждёт</div>`;
  listBox.querySelectorAll("[data-ap]").forEach((card) => {
    const a = list[+card.dataset.i];
    card.querySelectorAll("button[data-act]").forEach((b) => (b.onclick = () => {
      if (b.dataset.act === "open") nav("#chat/lcb/" + encodeURIComponent(String(a.username).replace(/^@/, "")));
      else approvalAction(a, b.dataset.act, card);
    }));
  });
}

/* Подтвердить/Отклонить: только approval_id в body — жёсткий канон §1.2 */
async function approvalAction(ap, act, container) {
  if (act === "send" && ap.money_intent && !confirm("Отправить? Это денежное сообщение")) return;
  if (act === "reject" && !confirm("Отклонить черновик?")) return;
  const btns = container ? container.querySelectorAll("button[data-act]") : [];
  btns.forEach((b) => { b.disabled = true; });
  const actBtn = container && container.querySelector(`button[data-act="${act}"]`);
  if (actBtn) { actBtn.textContent = act === "send" ? "Отправляется…" : "Отклоняю…"; actBtn.classList.add("busy"); }
  try {
    if (act === "send") {
      const r = await api("/api/approval/send", { method: "POST", body: { approval_id: ap.id }, timeout: 55000 });
      if (r && r.status === "already_sent") toast("Уже отправлено");
      else toast("Отправлено" + (r && r.who ? ": " + r.who : ""));
      ap.status = "sent";
    } else {
      await api("/api/approval/reject", { method: "POST", body: { approval_id: ap.id, reason: "via LCB app" } });
      ap.status = "rejected";
      toast("Отклонено");
    }
  } catch (e) {
    if (e.status === 409) toast("Отправка остановлена: " + ((e.data && e.data.error) || "preflight-защита"), true);
    else if (e.status === 403) toast("Нужен код доступа — введи в шторке индикатора", true);
    else if (e.status === 404) toast("Черновик не найден (возможно, уже обработан)", true);
    else if (!e.network) toast("Не вышло: " + e.message, true);
  }
  delete S.cache["/api/approvals?full=1"];
  delete S.cache["/api/approvals"];
  delete S.cache["/api/app/counters"];
  fetchCounters();
  if (S.chat) { S.chat.aps = await threadApprovals(); drawThreadMsgs(); }
  else if (S.tab === "chats" && S.chatsView === "approvals") drawApprovalsList();
}

/* ── тред: общий движок для mobile-экрана и desktop-панели (§3.3.2) ─────── */
function threadShellHtml(row, q, channel, withBack) {
  const title = row ? (row.display || row.client || q) : q.replace(/^@/, "");
  return `${withBack ? `<div class="backrow"><button class="btn" id="thrBack">‹ Назад</button></div>` : ""}
    <div class="thead">
      ${avatarHtml(row || { username: channel === "TG" ? q : "", channel })}
      <div class="tt"><div class="cname">${esc(title)}</div>
        <div class="mtext" id="thrSub">${esc(channel)}</div></div>
      <span class="spacer"></span><span id="tgOpen"></span>
    </div>
    <div id="chatView"><div class="skel"></div></div>
    <div class="chatnote">Ответы уходят через пайплайн. Ручной ответ — кнопкой «Открыть в Telegram». Время — МСК.</div>`;
}
async function startThread(dir, q, row, channel) {
  S.chat = { dir, q, channel, row, msgs: [], aps: [], meta: null, lastId: 0, err: null, src: "" };
  await loadThread(true);
  startPoll("screen:thread", pollThread, channel === "WA" ? 30000 : 15000);
  // read-state: через 1.5с видимости треда (§3.3.2), optimistic сброс точки
  S.readTimer = setTimeout(postThreadRead, 1500);
}
/* mobile: полноэкранный тред с «Назад» */
async function renderThread(dir, q) {
  const sp = $("#splitThread");
  if (sp) sp.innerHTML = splitEmptyHtml(); // не держать дубликат #chatView в скрытом split
  const row = (S.thrIndex && S.thrIndex[dir + ":" + q]) || null;
  const channel = threadChannelOf(row, q);
  const box = $("#scr-view");
  box.innerHTML = threadShellHtml(row, q, channel, true);
  $("#thrBack").onclick = () => history.back();
  await startThread(dir, q, row, channel);
}
/* desktop: тред в правой панели split-view; hash остаётся #chat/<dir>/<q> */
async function openThreadInPanel(dir, q) {
  const panel = $("#splitThread");
  if (!panel) return;
  stopPoll("screen:thread");
  if (S.readTimer) { clearTimeout(S.readTimer); S.readTimer = null; }
  const sv = $("#scr-view");
  if (sv) sv.innerHTML = ""; // не держать дубликат #chatView в скрытом экране
  const row = (S.thrIndex && S.thrIndex[dir + ":" + q]) || null;
  const channel = threadChannelOf(row, q);
  panel.innerHTML = threadShellHtml(row, q, channel, false);
  const p = startThread(dir, q, row, channel); // S.chat выставляется синхронно
  markSelectedRow();
  await p;
}
/* точка входа роутера для desktop: #chat/<dir>/<q> живёт внутри экрана «Чаты» */
async function renderChatsWithThread(dir, q) {
  const shell = document.querySelector("#scr-chats .split");
  const dirChanged = S.dir !== dir;
  if (dirChanged) { S.dir = dir; S.chatsView = "threads"; }
  if (!shell) {
    S.folderRevealQ = q;
    renderChats(); // markup строится синхронно, данные подъедут следом
  } else {
    startPoll("screen:chats", chatsPollTick, 60000); // route остановил screen-поллы
    if (dirChanged) { S.folderRevealQ = q; drawRail(); drawThreads(); }
  }
  await openThreadInPanel(dir, q);
}
function closeThreadPanel() {
  stopPoll("screen:thread");
  if (S.readTimer) { clearTimeout(S.readTimer); S.readTimer = null; }
  S.chat = null;
  const p = $("#splitThread");
  if (p) p.innerHTML = splitEmptyHtml();
  markSelectedRow();
  if ((location.hash || "").startsWith("#chat/")) history.replaceState(null, "", "#chats");
}

function chatEndpoint(c) {
  return c.channel === "VK" ? "/api/vk_chat" : c.channel === "WA" ? "/api/wa_chat" : "/api/chat";
}
function chatScrollBottom(initial) {
  const v = $("#chatView");
  if (!v) return;
  if (v.closest(".sview")) v.scrollTop = v.scrollHeight;
  else if (initial) window.scrollTo(0, document.body.scrollHeight);
}
async function loadThread(initial) {
  const c = S.chat;
  if (!c) return;
  const qParam = c.q.replace(/^(vk:|wa:|id:)/, "");
  try {
    const r = await api(`${chatEndpoint(c)}?q=${encodeURIComponent(qParam)}&limit=40`, { ttl: initial ? 15000 : 0 });
    c.meta = r.meta || null;
    c.src = r.source || "";
    c.msgs = (r.messages || []).map((m) => Object.assign({}, m, { __epoch: msgEpoch(m) }));
    c.lastId = c.msgs.reduce((a, m) => Math.max(a, +m.id || 0), 0);
    c.err = null;
  } catch (e) { c.err = e; }
  c.aps = await threadApprovals();
  drawThreadSub();
  drawTgOpen();
  drawThreadMsgs();
  if (initial && !c.err) chatScrollBottom(true);
}
async function pollThread() {
  const c = S.chat;
  if (!c) return;
  try {
    if (c.channel === "WA") { await loadThread(false); return; } // у WA инкремента нет — полная выборка
    const qParam = c.q.replace(/^(vk:|wa:|id:)/, "");
    const r = await api(`${chatEndpoint(c)}?q=${encodeURIComponent(qParam)}&limit=40&since_id=${c.lastId}`, { ttl: 0 });
    const inc = (r.messages || [])
      .map((m) => Object.assign({}, m, { __epoch: msgEpoch(m) }))
      .filter((m) => (+m.id || 0) > c.lastId);
    let changed = false;
    if (inc.length) {
      c.msgs = c.msgs.concat(inc);
      c.lastId = c.msgs.reduce((a, m) => Math.max(a, +m.id || 0), 0);
      changed = true;
    }
    const aps = await threadApprovals();
    if (JSON.stringify(aps) !== JSON.stringify(c.aps)) { c.aps = aps; changed = true; }
    if (changed) {
      drawThreadMsgs();
      if (inc.length) chatScrollBottom(false);
      if (inc.some((m) => !m.out)) postThreadRead(); // новый входящий в открытом треде — обновить read-state
    }
  } catch (e) { /* обрыв покажет индикатор; тред остаётся на снимке */ }
}
function threadUsername(c) {
  const u = (c.meta && c.meta.username) || (c.row && c.row.username) ||
    (c.channel === "TG" && !/^(id:|vk:|wa:|-?\d)/.test(c.q) ? c.q : "");
  return String(u || "").replace(/^@/, "");
}
async function threadApprovals() {
  const c = S.chat;
  if (!c) return [];
  const uname = threadUsername(c).toLowerCase();
  if (!uname) return [];
  const list = await approvalsFull();
  return list.map(normalizeAp)
    .filter((a) => String(a.username || "").replace(/^@/, "").toLowerCase() === uname)
    .sort((x, y) => String(x.created_at).localeCompare(String(y.created_at)));
}
function drawThreadSub() {
  const c = S.chat;
  const n = $("#thrSub");
  if (!c || !n) return;
  const uname = threadUsername(c);
  n.textContent = (uname ? "@" + uname + " · " : "") + c.channel;
}
/* «Открыть в Telegram»: t.me/<username>; без username — tg://user?id= c подписью;
   VK — vk.com/im; для групп и WA кнопка скрыта (§3.3.2) */
function drawTgOpen() {
  const c = S.chat;
  const slot = $("#tgOpen");
  if (!c || !slot) return;
  let href = null, label = "Открыть в Telegram", note = "";
  const uname = threadUsername(c);
  const uid = (c.meta && c.meta.user_id) || (c.row && c.row.user_id) || (c.q.startsWith("id:") ? c.q.slice(3) : "");
  if (c.channel === "VK") {
    const vid = uid || (c.q.startsWith("vk:") ? c.q.slice(3) : "");
    if (vid) { href = "https://vk.com/im?sel=" + encodeURIComponent(vid); label = "Открыть в VK"; }
  } else if (c.channel === "TG") {
    if (uname) href = "https://t.me/" + encodeURIComponent(uname);
    else if (uid) { href = "tg://user?id=" + encodeURIComponent(uid); note = "может не открыться, если диалога ещё нет"; }
  }
  slot.innerHTML = href
    ? `<a class="btn tgbtn" href="${esc(href)}" target="_blank" rel="noopener">${esc(label)}</a>` +
      (note ? `<div class="mtext" style="font-size:11px;max-width:150px;text-align:right">${esc(note)}</div>` : "")
    : "";
}
/* разделители дат в ленте пузырей (MSK) */
const _dayFmt = new Intl.DateTimeFormat("ru-RU", { timeZone: MSK_TZ, day: "numeric", month: "long" });
const _dayYearFmt = new Intl.DateTimeFormat("ru-RU", { timeZone: MSK_TZ, day: "numeric", month: "long", year: "numeric" });
function dayLabel(ep) {
  const d = new Date(ep * 1000);
  return mskParts(d).year === mskParts(new Date()).year ? _dayFmt.format(d) : _dayYearFmt.format(d);
}
function drawThreadMsgs() {
  const c = S.chat;
  const v = $("#chatView");
  if (!c || !v) return;
  let html = "";
  if (c.msgs.length >= 40) html += `<div class="mtext" style="text-align:center;margin:6px 0">показаны последние 40 сообщений</div>`;
  if (c.err && !c.msgs.length) {
    const e = c.err;
    html += `<div class="empty">${e.status === 503 ? "Переписка не найдена в локальных сторах"
      : e.status === 403 ? "Раздел закрыт — введи ключ в шторке индикатора"
      : "Ошибка: " + esc(e.message)}</div>`;
  }
  let lastDay = "";
  for (const m of c.msgs) {
    const day = m.__epoch ? mskDateIso(new Date(m.__epoch * 1000)) : "";
    if (day && day !== lastDay) { html += `<div class="bubday"><span>${esc(dayLabel(m.__epoch))}</span></div>`; lastDay = day; }
    const stamp = m.__epoch ? mskHM(new Date(m.__epoch * 1000)) : String(m.date || "").slice(0, 16);
    html += `<div class="bub ${m.out ? "out" : "in"}">${esc(trunc(m.text || "", 4000)) || (m.media ? "📎 медиа" : "")}
      <div class="bmeta">${esc(stamp)}${m.out ? " · мы" : ""}</div></div>`;
  }
  html += c.aps.map(apBubHtml).join("");
  if (!c.msgs.length && !c.aps.length && !c.err) html += `<div class="empty">Локальная история пуста</div>`;
  if (c.src && c.msgs.length) html += `<div class="mtext" style="margin:10px 0;text-align:center">Источник: ${esc(c.src)}</div>`;
  v.innerHTML = html;
  v.querySelectorAll(".ap-draft[data-ap]").forEach((bubEl) => {
    const ap = c.aps.find((a) => String(a.id) === bubEl.dataset.ap);
    if (!ap) return;
    bubEl.querySelectorAll("button[data-act]").forEach((b) => (b.onclick = () => approvalAction(ap, b.dataset.act, bubEl)));
  });
}
function apBubHtml(ap) {
  const t = esc(ap.draft || "");
  if (ap.status === "rejected") return `<div class="bub out ap-rej">${t}<div class="bmeta">отклонено</div></div>`;
  if (ap.status === "sent") return `<div class="bub out">${t}<div class="bmeta">отправлено · апрув · мы</div></div>`;
  return `<div class="bub out ap-draft" data-ap="${esc(ap.id)}">
    <div class="ap-badge">✋ ждёт подтверждения${ap.money_intent ? " · деньги" : ""}</div>
    <div>${t}</div>
    <div class="ap-actions">
      <button class="btn go" data-act="send">Подтвердить</button>
      <button class="btn stop" data-act="reject">Отклонить</button>
    </div></div>`;
}

/* app-локальный read-state (§4.2.3). КАНОН: только POST /api/app/read;
   TG-статусы прочитанности приложение не трогает никогда. */
function threadReadKey(c) {
  if (c.channel === "VK") {
    const vid = (c.meta && c.meta.user_id) || (c.q.startsWith("vk:") ? c.q.slice(3) : c.q);
    return vid ? "vk:" + String(vid).replace(/^vk:/, "") : null;
  }
  if (c.channel === "WA") {
    const ph = c.q.replace(/^wa:/, "");
    return ph ? "wa:" + ph : null;
  }
  const uname = threadUsername(c);
  if (uname) return uname;
  const uid = (c.meta && c.meta.user_id) || (c.q.startsWith("id:") ? c.q.slice(3) : "");
  if (uid) return "id:" + uid;
  if (/^-?\d+$/.test(c.q)) return c.q; // группа: chat_id строкой
  return c.q || null;
}
async function postThreadRead() {
  const c = S.chat;
  if (!c) return;
  const lastIn = c.msgs.filter((m) => !m.out).reduce((a, m) => Math.max(a, m.__epoch || 0), 0);
  const epoch = lastIn || c.msgs.reduce((a, m) => Math.max(a, m.__epoch || 0), 0) || Math.round(Date.now() / 1000);
  const key = threadReadKey(c);
  if (!key) return;
  clearUnreadLocal(c.dir, key); // optimistic; сервер — истина при следующем поллинге
  clearUnreadDom(c.q); // точка гаснет прямо в списке слева, без перерисовки панели
  updateChatsBadge();
  if (isDesktop()) updateRailBadges(null);
  try {
    await api("/api/app/read", { method: "POST", body: { channel: c.channel, thread: key, last_seen_epoch: epoch } });
    delete S.cache["/api/app/counters"];
  } catch (e) {
    if (e.status === 404 || e.status === 503) warnOnce("appread", "POST /api/app/read недоступна — read-state не сохраняется");
  }
}
function clearUnreadLocal(dir, key) {
  const hit = S.cache["/api/threads?dir=" + dir];
  if (!hit || !hit.data) return;
  const arr = hit.data.threads || hit.data.rows || [];
  const k = String(key).toLowerCase();
  for (const t of arr) {
    const tk = threadKeyOf(t);
    if (tk && tk.toLowerCase() === k) t.unread = 0;
  }
}

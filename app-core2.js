/* LCB app v2 — экран «LCB 2.0» (#core2): окно в новое ядро (Core), read-only.
   Структура повторяет основное приложение (v1): Чаты · События · Решения —
   разница только в «мозгах»: данные отдаёт Core, не legacy-пайплайн.
   Вкладка «Чаты» = НАСТОЯЩИЙ мессенджер app-chats.js (S.brain="core2",
   renderChats() в #c2Body): вёрстка и функциональность 1-в-1 с v1.
   Плюс «Арбитраж»: судейство «старый vs Core» по shadow-сравнениям — вердикты
   Михаила пишутся append-only и становятся ground truth для cutover.
   Приложение в core.db НЕ пишет: бэкенд открывает базу строго mode=ro. */
"use strict";

const C2_TABS = [
  { key: "chats", label: "Чаты" },
  { key: "events", label: "События" },
  { key: "dec", label: "Решения" },
  { key: "arb", label: "Арбитраж" },
  { key: "over", label: "Обзор" },
];
const C2_DECISION_RU = {
  blocked: "заблокировано",
  no_business_intent: "не бизнес-запрос",
  already_materialized: "уже материализовано",
  propose_create_opportunity: "создать сделку",
  propose_draft: "черновик ответа",
  hold: "пауза",
  noop: "без действия",
};
const C2_AXES_RU = {
  relationship: "отношения", intent: "намерение", action: "действие",
  subject: "субъект", money_contract: "деньги", external_effect: "внеш. эффект",
};
const C2_TILES = [
  ["messages", "Входящие"], ["domain_events", "События домена"],
  ["threads", "Треды"], ["persons", "Персоны"],
  ["opportunities", "Сделки"], ["bookings", "Брони"],
  ["shadow_decisions", "Решения"], ["shadow_comparisons", "Сравнения"],
];

function c2When(ep) {
  if (!ep) return "—";
  try {
    return new Date(ep * 1000).toLocaleString("ru-RU", {
      timeZone: "Europe/Moscow", day: "2-digit", month: "2-digit",
      hour: "2-digit", minute: "2-digit",
    });
  } catch (_) { return "—"; }
}
function c2Short(id) {
  const s = String(id || "");
  const i = s.lastIndexOf(":");
  return i > -1 ? s.slice(i + 1) : s;
}
function c2Err(e, what) {
  if (e.status === 403) return `<div class="empty">Раздел закрыт — введи ключ в шторке индикатора</div>`;
  if (e.status === 404 || e.status === 503) {
    warnOnce("core2", "Ручки /api/core2|arbitr недоступны (" + e.status + ")");
    return `<div class="empty">${esc(what)}: ручка недоступна (${e.status})</div>`;
  }
  return `<div class="empty">${esc(what)}: ${esc(e.message)}</div>`;
}

/* уход с вкладки «Чаты» (или переключение вкладок LCB 2.0): вернуть v1-мозг
   и остановить чат-поллы; уход с экрана целиком делает роутер v1-чатов */
function c2LeaveChats() {
  if (S.brain !== "core2") return;
  stopPoll("screen:chats");
  stopPoll("screen:thread");
  if (S.readTimer) { clearTimeout(S.readTimer); S.readTimer = null; }
  S.chat = null;
  S.brain = "v1";
}

async function renderCore2() {
  if (!S.c2tab) S.c2tab = "chats";
  if (S.c2tab !== "chats") c2LeaveChats();
  const box = $("#scr-core2");
  box.innerHTML = `
    <div id="c2Status"><div class="skel"></div></div>
    ${assuranceEntryHtml("c2Assurance")}
    <div class="dirsw" id="c2Tabs" style="margin-top:8px">${C2_TABS.map((t) =>
      `<button data-t="${t.key}" class="${S.c2tab === t.key ? "on" : ""}">${t.label}</button>`).join("")}</div>
    <div id="c2Body" style="margin-top:10px"><div class="skel"></div></div>
    <div class="mtext" style="margin:10px 0">Это витрина: приложение в core.db не пишет (read-only). Мозги этого экрана — новое ядро Core.</div>`;
  bindAssuranceEntry("c2Assurance", "core2");
  $("#c2Tabs").querySelectorAll("button").forEach((b) => (b.onclick = () => {
    if (S.c2tab !== b.dataset.t) { S.c2tab = b.dataset.t; renderCore2(); }
  }));
  loadCore2Status();
  const body = $("#c2Body");
  if (S.c2tab === "chats") {
    // тот же мессенджер, что экран «Чаты» (v1): один код, мозг — Core
    S.brain = "core2";
    renderChats();
  } else if (S.c2tab === "events") c2Events(body);
  else if (S.c2tab === "dec") c2Decisions(body);
  else if (S.c2tab === "arb") c2Arbitr(body);
  else c2Overview(body);
  startPoll("screen:core2", () => {
    delete S.cache["/api/core2/summary"];
    loadCore2Status();
  }, 60000);
}

async function loadCore2Status() {
  const b = $("#c2Status");
  if (!b) return;
  try {
    const s = await api("/api/core2/summary", { ttl: 55000 });
    if (s.available === false) {
      b.innerHTML = `<div class="card"><div class="cname">LCB 2.0 недоступно</div>
        <div class="mtext" style="margin-top:4px">${esc(s.reason || "core.db не найдена")}</div></div>`;
      return;
    }
    const wired = !!s.shadow_wired;
    b.innerHTML = `<div class="chead">
      <span class="pill ${wired ? "p-ok" : "p-warn"}" style="font-size:13px;padding:5px 11px">
        ${wired ? "Core принимает решения" : "Core в тени"}</span>
      <span class="spacer mtext">${esc(s.note || "")}</span></div>`;
    S.c2summary = s;
  } catch (e) { b.innerHTML = c2Err(e, "Статус Core"); }
}

/* ── Чаты: рендерит настоящий мессенджер (app-chats.js) в #c2Body ─────────
   Отдельного c2Chats больше нет: renderCore2 ставит S.brain="core2" и зовёт
   renderChats() — тот же код, что экран «Чаты» (v1), источник — ядро Core. */

/* ── События: каркас v1-карточки события (app-event.js) на данных Core ──── */
function c2NotMoved(label) {
  return `<div class="brow"><span class="k">${esc(label)}</span><span class="feenote">не перенесено в Core</span></div>`;
}
function c2EventCardHtml(kindPill, name, createdEp, metaLine) {
  return `<div class="card">
    <div class="chead">${kindPill}<span class="cname" style="font-size:17px">${esc(name)}</span>
      <span class="spacer pill p-brass num">создано ${c2When(createdEp)}</span></div>
    <div class="mtext" style="margin-top:2px">${esc(metaLine)}</div>
    <div class="bsec">Состав и гонорары</div>
    ${c2NotMoved("Участники и оплаты")}
    <div class="bsec">Бухгалтерия</div>
    ${c2NotMoved("Клиент · группа · расходы")}
    <div class="bsec">Чек-лист</div>
    ${c2NotMoved("Пункты подготовки")}
    <div class="bsec">Документы</div>
    ${c2NotMoved("Договор · паспорта · тайминг")}
  </div>`;
}
async function c2Events(b) {
  try {
    const w = await api("/api/core2/world", { ttl: 30000 });
    if (w.available === false) { b.innerHTML = c2Err({ message: w.reason || "недоступно" }, "События Core"); return; }
    const personName = {};
    (w.persons || []).forEach((p) => { personName[p.person_id] = p.display_name || ""; });
    const cards = [];
    (w.bookings || []).forEach((bk) => cards.push(c2EventCardHtml(
      `<span class="pill p-ok">бронь</span>`,
      personName[bk.client_person_id] || c2Short(bk.booking_id).slice(0, 20),
      bk.created_at_epoch,
      `${c2Short(bk.booking_id)} · создал: ${bk.created_by || "—"}`)));
    (w.opportunities || []).forEach((o) => cards.push(c2EventCardHtml(
      `<span class="pill p-pine">сделка</span>`,
      personName[o.person_id] || c2Short(o.opportunity_id).slice(0, 20),
      o.created_at_epoch,
      `${c2Short(o.opportunity_id)} · создал: ${o.created_by || "—"}`)));
    const obls = (w.obligations || []).map((o) => `
      <div class="proc"><span class="pill p-warn">${esc(o.kind || "—")}</span>
        <span>${esc(o.owner || "")}</span>
        <span class="mtext">${esc(trunc(o.reason || "", 70))}</span>
        <span class="spacer mtext num">${o.due_at_epoch ? "до " + c2When(o.due_at_epoch) : ""}</span></div>`).join("");
    b.innerHTML = (cards.join("") || `<div class="empty">Core ещё не создавал сделок</div>`) +
      `<div class="card"><div class="cname">Обязательства Core</div>${obls || `<div class="empty">обязательств нет — Core пока нечего требовать</div>`}</div>`;
  } catch (e) { b.innerHTML = c2Err(e, "События Core"); }
}

/* ── Решения (лента shadow_decisions) ───────────────────────────────────── */
async function c2Decisions(b) {
  try {
    const r = await api("/api/core2/decisions?limit=30", { ttl: 30000 });
    const ds = r.decisions || [];
    if (!ds.length) {
      b.innerHTML = `<div class="card"><div class="mtext">
        Core ещё не принимает решений. Как только rewrite-трек включит
        shadow-планировщик, здесь появится каждое решение: кто написал → что
        Core решил (создать сделку / черновик / пауза / без действия) — рядом
        с решением старого пайплайна.</div></div>`;
      return;
    }
    b.innerHTML = `<div class="card">${ds.map((d) => `
      <div class="proc">
        <span class="pill ${d.engine === "new_core" ? "p-pine" : "p-mut"}">${d.engine === "new_core" ? "Core" : "старый"}</span>
        <span><b>${esc(C2_DECISION_RU[d.decision] || d.decision || "—")}</b></span>
        <span class="mtext">${esc(d.intent_kind || "")}${d.relationship ? " · " + esc(d.relationship) : ""}</span>
        ${d.blocker ? `<span class="pill p-dang">${esc(trunc(d.blocker, 40))}</span>` : ""}
        <span class="spacer mtext num">${c2When(d.recorded_at_epoch)}</span>
      </div>`).join("")}</div>`;
  } catch (e) { b.innerHTML = c2Err(e, "Решения"); }
}

/* ── Арбитраж: судейство «старый vs Core» ───────────────────────────────── */
async function c2Arbitr(b) {
  try {
    const [st, q] = await Promise.all([
      api("/api/arbitr/stats", { ttl: 20000 }),
      api("/api/arbitr/queue?limit=20", { ttl: 15000 }),
    ]);
    const bv = st.by_verdict || {};
    const head = `<div class="card"><div class="chead">
      <span class="cname">Рассужено ${st.judged || 0} из ${st.comparisons_total || 0}</span>
      <span class="pill p-pine">Core прав: ${bv.core || 0}</span>
      <span class="pill p-mut">старый прав: ${bv.old || 0}</span>
      <span class="pill p-ok">оба ок: ${bv.both_ok || 0}</span>
      <span class="pill p-dang">оба плохо: ${bv.both_bad || 0}</span></div>
      <div class="mtext" style="margin-top:4px">Твои вердикты — ground truth для переключения на Core: журнал append-only, «оба плохо» можно сразу отправлять на разбор.</div></div>`;
    const cards = q.cards || [];
    if (!cards.length) {
      b.innerHTML = head + `<div class="card"><div class="mtext">
        Сравнений пока нет: shadow-планировщик не включён (сейчас
        shadow_comparisons = ${((S.c2summary || {}).counts || {}).shadow_comparisons ?? 0}).
        Когда rewrite-трек включит тень или прогонит replay истории — здесь
        появятся карточки «входящее → решение старого · решение Core», и ты
        судишь кнопками, кто прав.</div></div>`;
      return;
    }
    b.innerHTML = head + cards.map(c2ArbCardHtml).join("");
    b.querySelectorAll("[data-acid]").forEach((card) => {
      card.querySelectorAll("button[data-v]").forEach((btn) => (btn.onclick = () =>
        c2Verdict(card, card.dataset.acid, btn.dataset.v)));
    });
  } catch (e) { b.innerHTML = c2Err(e, "Арбитраж"); }
}
function c2ArbCardHtml(c) {
  const cls = c.classification === "blocker" ? "p-dang" : c.classification === "mismatch" ? "p-warn" : "p-ok";
  const eng = (d, label, pillCls) => `<div style="flex:1;min-width:220px">
    <div class="chead"><span class="pill ${pillCls}">${label}</span>
      <span><b>${esc(C2_DECISION_RU[(d || {}).decision] || (d || {}).decision || "—")}</b></span></div>
    <div class="mtext" style="margin-top:2px">${esc((d || {}).intent_kind || "")}${(d || {}).relationship ? " · " + esc(d.relationship) : ""}</div>
    ${(d || {}).blocker ? `<div class="pill p-dang" style="margin-top:4px">${esc(trunc(d.blocker, 60))}</div>` : ""}</div>`;
  const axes = Object.entries(c.axes || {}).map(([k, ok]) =>
    `<span class="pill ${ok ? "p-ok" : "p-dang"}" title="${esc(C2_AXES_RU[k] || k)}">${ok ? "✓" : "✗"} ${esc(C2_AXES_RU[k] || k)}</span>`).join(" ");
  return `<div class="card" data-acid="${esc(c.comparison_id)}">
    <div class="chead"><span class="pill ${cls}">${esc(c.classification)}</span>
      <span class="mtext">${esc(trunc(((c.message || {}).body || "").replace(/\s+/g, " "), 160) || "входящее без текста")}</span>
      <span class="spacer mtext num">${c2When(c.compared_at_epoch)}</span></div>
    <div style="display:flex;gap:14px;flex-wrap:wrap;margin-top:8px">
      ${eng(c.legacy, "старый", "p-mut")}${eng(c.core, "Core", "p-pine")}</div>
    <div style="margin-top:8px;display:flex;gap:4px;flex-wrap:wrap">${axes}</div>
    ${c.verdict ? `<div class="mtext" style="margin-top:8px">Вердикт: ${esc(c.verdict)}</div>` : `
    <div class="callay" style="margin-top:10px">
      <button class="btn" data-v="old">Старый прав</button>
      <button class="btn go" data-v="core">Core прав</button>
      <button class="btn" data-v="both_ok">Оба ок</button>
      <button class="btn stop" data-v="both_bad">Оба плохо</button>
    </div>`}</div>`;
}
async function c2Verdict(card, cid, v) {
  card.querySelectorAll("button[data-v]").forEach((b) => (b.disabled = true));
  try {
    await api("/api/arbitr/verdict", { method: "POST", body: { comparison_id: cid, verdict: v } });
    toast("Вердикт записан");
    delete S.cache["/api/arbitr/queue?limit=20"];
    delete S.cache["/api/arbitr/stats"];
    card.style.opacity = "0.55";
    const lay = card.querySelector(".callay");
    if (lay) lay.outerHTML = `<div class="mtext" style="margin-top:8px">Вердикт: ${esc(v)}</div>`;
  } catch (e) {
    if (e.status === 403) toast("Нужен код доступа — введи в шторке индикатора", true);
    else toast("Не записан: " + e.message, true);
    card.querySelectorAll("button[data-v]").forEach((b) => (b.disabled = false));
  }
}

/* ── Обзор (счётчики) ───────────────────────────────────────────────────── */
async function c2Overview(b) {
  try {
    const s = S.c2summary || await api("/api/core2/summary", { ttl: 55000 });
    if (s.available === false) { b.innerHTML = c2Err({ message: s.reason || "недоступно" }, "Обзор"); return; }
    const cnt = s.counts || {};
    b.innerHTML = `<div class="card"><div class="c2tiles">
      ${C2_TILES.map(([k, label]) => {
        const v = cnt[k];
        const zeroish = !v || v < 0;
        return `<div class="c2tile ${zeroish ? "z" : ""}">
          <div class="num">${v == null || v < 0 ? "—" : v}</div>
          <div class="mtext">${label}</div></div>`;
      }).join("")}
      <div class="c2tile ${s.obligations_open ? "" : "z"}">
        <div class="num">${s.obligations_open ?? 0}</div>
        <div class="mtext">Обязательства</div></div>
    </div></div>`;
  } catch (e) { b.innerHTML = c2Err(e, "Обзор"); }
}

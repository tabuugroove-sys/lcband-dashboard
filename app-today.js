/* LCB app v2 — экран «Сегодня». Канон: сообщения-отправки живут ТОЛЬКО в
   мессенджере (латунные пузыри в треде); здесь — фундаментальные решения по
   проектам (approval_class="decision") + read-only аудит воронки. */
"use strict";

const DECISION_KIND_LABELS = {
  lineup_cap: "Лимит состава события",
  media_bundle: "Медиа-подборка на ревью",
  text: "Черновик без адресата",
};
/* fallback для старого бэкенда без approval_class: message = есть адресат и текст */
function apClassOf(a) {
  if (a.approval_class) return a.approval_class;
  return (a.username && (a.draft || a.desc)) ? "message" : "decision";
}
/* «evt_2026-06-12_москва_загородный_клуб» → «12.06.2026 · Москва · Загородный клуб» */
function humanEventId(eid) {
  const m = String(eid || "").match(/^evt_(\d{4})-(\d{2})-(\d{2})_(.+)$/);
  if (!m) return String(eid || "");
  const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : "");
  const date = `${m[3]}.${m[2]}.${m[1]}`;
  const parts = m[4].split("_").filter(Boolean);
  if (!parts.length) return date;
  if (parts.length === 1) return `${date} · ${cap(parts[0])}`;
  return `${date} · ${cap(parts[0])} · ${cap(parts.slice(1).join(" "))}`;
}
async function todayApprovals() {
  try {
    const r = await api("/api/approvals?full=1", { ttl: 30000 });
    return r.approvals || [];
  } catch (e) {
    if (e.status === 403) throw e;
    const r = await api("/api/approvals", { ttl: 30000 }); // может бросить дальше — обработает вызывающий
    return r.approvals || [];
  }
}
function decisionCardHtml(a, i) {
  const kind = a.kind || "";
  const label = DECISION_KIND_LABELS[kind] || kind || "Решение";
  const fields = [];
  if (a.event_id) fields.push(["Событие", humanEventId(a.event_id)]);
  if (a.scope) fields.push(["Scope", a.scope]);
  if (a.day) fields.push(["День", a.day]);
  if (a.client) fields.push(["Клиент", a.client]);
  if (a.folder) fields.push(["Папка", a.folder]);
  if (a.created_at) fields.push(["Создано", String(a.created_at).slice(0, 16).replace("T", " ")]);
  const text = a.draft || a.desc || "";
  return `<div class="card hot" data-i="${i}">
    <div class="chead"><span class="cname">${esc(label)}</span>
      ${a.money_intent ? `<span class="pill p-brass">деньги</span>` : ""}
      <span class="spacer mtext num" style="font-size:11px">${esc(a.id || "")}</span></div>
    ${text ? `<div class="mtext" style="margin-top:6px;white-space:pre-wrap">${esc(trunc(text, 220))}</div>` : ""}
    ${fields.map(([k, v]) => `<div class="mtext" style="margin-top:4px"><b style="font-weight:500">${esc(k)}:</b> ${esc(String(v))}</div>`).join("")}
    <div class="callay" style="margin-top:10px;align-items:center">
      ${a.user_id ? `<button class="btn go" data-a="send" data-id="${esc(a.id)}">Разрешить</button>` : ""}
      <button class="btn stop" data-a="reject" data-id="${esc(a.id)}">Отклонить</button>
      ${!a.user_id ? `<span class="mtext">медиа/решение — финалится в TG-боте</span>` : ""}
    </div>
  </div>`;
}

async function renderToday() {
  const box = $("#scr-today");
  box.innerHTML = `<div id="connRow" class="callay"></div>
    <div class="stats" id="todayKpi"></div>
    <div class="h2">Ждут твоего решения</div><div id="apprBox"><div class="skel"></div></div>
    <div class="h2">Аудит воронки</div><div id="auditBox"><div class="skel"></div></div>
    <div class="h2">Требуют внимания</div><div id="attnBox"><div class="skel"></div></div>
    <div class="card"><div class="cname">Дайджест дня</div>
      <div class="mtext">Вечерний обзор приглушённых событий приходит в TG-бот в 22:00 МСК. Живая лента дайджеста в приложении — фаза 2.</div></div>`;

  // подключения (пилюлей соединения владеет глобальный индикатор §3.8)
  try {
    const [h, rh] = await Promise.all([
      api("/api/health", { ttl: 30000 }),
      api("/api/runtime_health", { ttl: 60000 }).catch(() => null),
    ]);
    const pills = [];
    pills.push(h.banned ? `<span class="pill p-dang">TG: бан — ${esc(h.ban_reason)}</span>` : `<span class="pill p-ok">TG отправка · квота ${h.send_quota_remaining}</span>`);
    pills.push(`<span class="pill p-ok">${location.hostname.endsWith(".ts.net") ? "Tailnet" : "Локально"}</span>`);
    if (rh) pills.push(`<span class="pill ${rh.level === "ok" ? "p-ok" : rh.level === "warn" ? "p-warn" : "p-dang"}">Здоровье: ${esc(rh.level)}</span>`);
    $("#connRow").innerHTML = pills.join(" ");
  } catch { $("#connRow").innerHTML = `<span class="pill p-dang">Бэкенд недоступен</span>`; }

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
    $("#attnBox").querySelectorAll(".thr").forEach((t) => (t.onclick = () => t.dataset.q && nav("#chat/lcb/" + encodeURIComponent(t.dataset.q))));
  } catch { $("#attnBox").innerHTML = `<div class="empty">Воронка недоступна</div>`; }

  // фундаментальные решения (approval_class="decision"); сообщения-отправки — в «Чатах»
  try {
    const list = await todayApprovals();
    const dec = list.filter((a) => (a.status || "pending") === "pending" && apClassOf(a) === "decision");
    $("#apprBox").innerHTML = dec.map((a, i) => decisionCardHtml(a, i)).join("")
      || `<div class="empty">Решений нет — всё едет само. Сообщения-отправки живут в «Чатах».</div>`;
    $("#apprBox").querySelectorAll("button[data-a]").forEach((b) => (b.onclick = () => {
      const card = b.closest("[data-i]");
      const a = (card && dec[+card.dataset.i]) || {};
      if (b.dataset.a === "send" && a.money_intent && !confirm("Разрешить? Это денежное решение")) return;
      approval(b.dataset.a, b.dataset.id, b);
    }));
  } catch (e) {
    $("#apprBox").innerHTML = `<div class="card"><div class="mtext">${e.status === 403
      ? "Раздел с решениями закрыт — введи ключ в шторке индикатора (или открой на Mac)."
      : "Список решений недоступен: " + esc(e.message)}</div></div>`;
  }

  // аудит воронки: флаги money/refused/downgrade, read-only (/api/lead_context_audit)
  try {
    const r = await api("/api/lead_context_audit", { ttl: 120000 });
    let flags = r.flags || r.items || r.audit || (Array.isArray(r) ? r : []);
    if (!flags.length && Array.isArray(r.orders)) {
      // фолбэк на живую форму: orders[].audit_context.verdict; на дашборд — только money/refused/downgrade
      flags = r.orders.map((o) => ({
        kind: (o.audit_context && o.audit_context.verdict) || "",
        contact: o.contact_display || o.username || "",
        reason: (o.audit_context && o.audit_context.verdict_reason) || "",
        order_id: o.order_id,
      })).filter((f) => /money|деньг|оплат|refus|отказ|downgrade/i.test(f.kind));
    }
    $("#auditBox").innerHTML = flags.slice(0, 20).map((f) => {
      const kind = String(f.kind || f.type || f.flag || "");
      const pill = /money|деньг|оплат/i.test(kind) ? "p-brass"
        : /refus|отказ/i.test(kind) ? "p-dang"
        : /downgrade/i.test(kind) ? "p-warn" : "p-mut";
      const contact = f.contact || f.username || f.client || "—";
      return `<div class="card"><div class="chead">
          ${kind ? `<span class="pill ${pill}">${esc(kind)}</span>` : ""}
          <span class="cname">${esc(String(contact))}</span>
          ${f.order_id ? `<span class="spacer mtext num">#${esc(String(f.order_id))}</span>` : ""}</div>
        <div class="mtext" style="margin-top:6px">${esc(String(f.reason || f.detail || f.note || ""))}</div></div>`;
    }).join("") || `<div class="empty">Флагов нет — воронка чистая</div>`;
  } catch (e) {
    if (e.status === 403) $("#auditBox").innerHTML = `<div class="empty">Аудит закрыт — введи ключ в шторке индикатора</div>`;
    else if (e.status === 404 || e.status === 503) {
      warnOnce("audit", "GET /api/lead_context_audit недоступна (" + e.status + ")");
      $("#auditBox").innerHTML = `<div class="empty">Аудит недоступен (нет ручки)</div>`;
    } else $("#auditBox").innerHTML = `<div class="empty">Аудит недоступен: ${esc(e.message)}</div>`;
  }
}
async function approval(action, id, btn) {
  btn.disabled = true;
  try {
    const r = await api("/api/approval/" + (action === "send" ? "send" : "reject"), {
      method: "POST", body: action === "send" ? { approval_id: id } : { approval_id: id, reason: "via LCB app" },
      timeout: 55000,
    });
    if (r && r.status === "already_sent") toast("Уже отправлено");
    else toast(action === "send" ? `Разрешено: ${r.who || id} · ${r.status || "ok"}` : "Отклонено");
    delete S.cache["/api/db/snapshot"];
    delete S.cache["/api/approvals?full=1"];
    delete S.cache["/api/approvals"];
    delete S.cache["/api/app/counters"];
    renderToday();
  } catch (e) {
    if (e.status === 409) toast("Остановлено preflight-защитой: " + ((e.data && e.data.error) || "предохранитель, не сбой"), true);
    else if (e.status === 403) toast("Нужен код доступа — введи в шторке индикатора", true);
    else if (e.status === 503) toast("Действие сейчас недоступно (сервис выключен)", true);
    else if (!e.network) toast("Не вышло: " + e.message, true);
    btn.disabled = false;
  }
}

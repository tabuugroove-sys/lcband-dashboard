/* LCB app v2 — экран «Сегодня»: перенос v1 как есть (переделка — фаза 2 ТЗ).
   Изменения против v1: пилюлей соединения владеет глобальный индикатор (§3.8),
   ссылки в треды — через #chat/lcb/. */
"use strict";

async function renderToday() {
  const box = $("#scr-today");
  box.innerHTML = `<div id="connRow" class="callay"></div>
    <div class="stats" id="todayKpi"></div>
    <div class="h2">Ждут твоего решения</div><div id="apprBox"><div class="skel"></div></div>
    <div class="h2">Требуют внимания</div><div id="attnBox"><div class="skel"></div></div>
    <div class="card"><div class="cname">Дайджест дня</div>
      <div class="mtext">Вечерний обзор приглушённых событий приходит в TG-бот в 22:00 МСК. Живая лента дайджеста в приложении — фаза 2.</div></div>`;

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

  // апрувы (token-gated snapshot; лёгкие ручки — фаза 2)
  try {
    const snap = await api("/api/db/snapshot", { ttl: 60000 });
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
    $("#apprBox").innerHTML = `<div class="card"><div class="mtext">${e.status === 403
      ? "Раздел с деньгами закрыт — введи ключ в шторке индикатора (или открой на Mac)."
      : "Список апрувов недоступен: " + esc(e.message)}</div></div>`;
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
    else toast(action === "send" ? `Отправлено: ${r.who || id} · ${r.status || "ok"}` : "Отклонено");
    delete S.cache["/api/db/snapshot"];
    delete S.cache["/api/approvals?full=1"];
    delete S.cache["/api/approvals"];
    delete S.cache["/api/app/counters"];
    renderToday();
  } catch (e) {
    if (e.status === 409) toast("Отправка остановлена preflight-защитой: " + ((e.data && e.data.error) || "предохранитель, не сбой"), true);
    else if (e.status === 403) toast("Нужен код доступа — введи в шторке индикатора", true);
    else if (e.status === 503) toast("Отправка сейчас недоступна (сервис выключен)", true);
    else if (!e.network) toast("Не вышло: " + e.message, true);
    btn.disabled = false;
  }
}

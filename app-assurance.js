/* LCB app — второстепенный экран «Проблемы и тесты» для v1 и LCB 2.0.
   Данные общие: HISTORY_COVERAGE.json + docs/changes через один read-only API. */
"use strict";

const ASSURANCE_STATUS_RU = {
  core_proven: "Core",
  external_proven: "внешний гейт",
  legacy_only: "только legacy",
  spec_only: "только spec",
  blocked: "блокер",
};

function assuranceEntryHtml(id) {
  return `<button class="assurance-entry" id="${id}" type="button">
    <span class="ae-mark" aria-hidden="true">✓?</span>
    <span class="ae-copy"><b>Проблемы и тесты</b>
      <span class="ae-meta">Покрытие, статус проверок и риск повторения</span></span>
    <span class="ae-state pill p-mut">открыть</span><span class="ae-arrow">→</span>
  </button>`;
}

async function bindAssuranceEntry(id, origin) {
  const button = document.getElementById(id);
  if (!button) return;
  button.onclick = () => nav("#assurance/" + origin);
  try {
    const data = await api("/api/app/problem_assurance", { ttl: 60000 });
    if (!document.body.contains(button)) return;
    const h = data.history_summary || {};
    const state = button.querySelector(".ae-state");
    button.querySelector(".ae-meta").textContent =
      `${h.strict_proven || 0}/${h.total || 0} защищены · ${h.open_gaps || 0} требуют защиты`;
    state.textContent = (data.verdict || {}).can_repeat ? "есть риск" : "защищено";
    state.className = "ae-state pill " + ((data.verdict || {}).can_repeat ? "p-warn" : "p-ok");
  } catch (_) {
    const state = button.querySelector(".ae-state");
    if (state) { state.textContent = "нет данных"; state.className = "ae-state pill p-dang"; }
  }
}

function assurancePill(level) {
  if (level === "guarded") return "p-ok";
  if (level === "watch") return "p-warn";
  return "p-dang";
}

function assuranceBackLabel(origin) {
  return origin === "core2" ? "LCB 2.0" : "Система";
}

function assuranceTestRefs(row) {
  const refs = row.tests || [];
  if (!refs.length) return `<div class="assure-none">Тесты не указаны</div>`;
  return `<div class="assure-refs">${refs.map((ref) => {
    const missing = (row.tests_missing || []).includes(ref);
    return `<code class="${missing ? "missing" : ""}">${missing ? "✕" : "✓"} ${esc(ref)}</code>`;
  }).join("")}</div>`;
}

function assuranceHistoryRow(row) {
  const label = ASSURANCE_STATUS_RU[row.status] || row.status_label || row.status;
  return `<article class="assure-row" data-search="${esc((row.id + " " + row.theme + " " + row.problem).toLowerCase())}">
    <div class="chead"><span class="assure-id num">${esc(row.id)}</span>
      <span class="pill ${assurancePill(row.recurrence_level)}">${esc(label)}</span>
      <span class="spacer mtext">${row.tests_existing}/${row.tests_total} тестов${row.regression_teeth ? " · red-run ✓" : ""}</span></div>
    <div class="assure-problem">${esc(row.problem)}</div>
    <div class="assure-verdict ${row.recurrence_level}">${esc(row.recurrence)}</div>
    ${row.reason ? `<div class="mtext assure-reason">${esc(row.reason)}</div>` : ""}
    <details><summary>Доказательства (${row.tests_total})</summary>${assuranceTestRefs(row)}</details>
  </article>`;
}

function assuranceChangeRow(row) {
  const invalid = (row.validation_errors || []).length;
  return `<article class="assure-row" data-search="${esc((row.id + " " + row.title).toLowerCase())}">
    <div class="chead"><span class="assure-id num">${esc(row.id)}</span>
      <span class="pill ${assurancePill(row.recurrence_level)}">${esc(row.status_label)}</span>
      <span class="pill p-mut">${esc(row.deployment_status)}</span>
      <span class="spacer mtext">${row.tests_existing}/${row.tests_total} тестов</span></div>
    <div class="assure-problem">${esc(row.title)}</div>
    <div class="assure-verdict ${row.recurrence_level}">${esc(row.recurrence)}</div>
    ${row.verification ? `<div class="mtext assure-reason">Последняя запись: ${esc(row.verification)}</div>` : ""}
    ${invalid ? `<div class="assure-errors">Validator: ${row.validation_errors.map(esc).join(" · ")}</div>` : ""}
    <details><summary>Тесты и ссылки (${row.tests_total})</summary>${assuranceTestRefs(row)}</details>
  </article>`;
}

function assuranceFilterRows(box) {
  const q = String(S.assuranceQ || "").toLowerCase();
  box.querySelectorAll(".assure-row[data-search]").forEach((row) => {
    row.hidden = !!q && !row.dataset.search.includes(q);
  });
}

function drawAssurance(data, origin) {
  const box = $("#scr-assurance");
  const h = data.history_summary || {};
  const l = data.ledger_summary || {};
  const verdict = data.verdict || {};
  const tab = S.assuranceTab || "gaps";
  const historyRows = (data.history || []).filter((row) => tab !== "gaps" || row.recurrence_level !== "guarded");
  const bodyRows = tab === "changes"
    ? (data.changes || []).map(assuranceChangeRow).join("")
    : historyRows.map(assuranceHistoryRow).join("");
  const duplicateText = (l.duplicate_ids || []).map((d) => `${d.id}: ${d.files.join(", ")}`).join(" · ");

  box.innerHTML = `<div class="backrow">
      <button class="btn" id="assuranceBack">← ${esc(assuranceBackLabel(origin))}</button>
      <span class="spacer mtext">единый read-only реестр Claude + Codex</span>
    </div>
    <section class="assure-hero ${verdict.can_repeat ? "attention" : "guarded"}">
      <div class="assure-kicker">АНАЛИЗ ПОВТОРЯЕМОСТИ</div>
      <div class="assure-hero-grid"><div><h1>${esc(verdict.label || "Статус неизвестен")}</h1>
        <p>${esc(verdict.detail || "")}</p></div>
        <div class="assure-score"><strong class="num">${h.strict_proven || 0}<small> / ${h.total || 0}</small></strong><span>строго защищены</span></div></div>
      <div class="assure-source">Источники: <code>HISTORY_COVERAGE.json</code> + <code>docs/changes/</code>. Это анализ известных сценариев, не обещание безошибочности.</div>
    </section>
    <div class="assure-metrics">
      <div><b class="num">${h.open_gaps || 0}</b><span>могут повториться</span></div>
      <div><b class="num">${h.with_test_refs || 0}</b><span>имеют ссылки на тесты</span></div>
      <div><b class="num">${h.regression_teeth || 0}</b><span>имеют прямой red-run</span></div>
      <div><b class="num">${l.guarded || 0}/${l.records || 0}</b><span>изменений с полной записью</span></div>
    </div>
    ${!l.validator_ok ? `<div class="assure-ledger-warn"><b>Реестр изменений сейчас не зелёный.</b>
      ${l.invalid_records || 0} записей с ошибками validator${duplicateText ? ` · дубли: ${esc(duplicateText)}` : ""}</div>` : ""}
    <div class="assure-toolbar">
      <div class="dirsw" id="assuranceTabs">
        <button data-t="gaps" class="${tab === "gaps" ? "on" : ""}">Требуют защиты · ${h.open_gaps || 0}</button>
        <button data-t="all" class="${tab === "all" ? "on" : ""}">Все · ${h.total || 0}</button>
        <button data-t="changes" class="${tab === "changes" ? "on" : ""}">Изменения · ${l.unique_changes || 0}</button>
      </div>
      <input class="dinput" id="assuranceSearch" type="search" placeholder="Найти проблему или Change-ID" value="${esc(S.assuranceQ || "")}">
    </div>
    <div class="assure-list">${bodyRows || `<div class="empty">Записей нет</div>`}</div>
    <div class="mtext assure-foot">Статус «passed» берётся из последней зафиксированной проверки в change record. Наличие файла теста проверяется сейчас; весь набор тестов при открытии экрана не запускается.</div>`;

  $("#assuranceBack").onclick = () => nav(origin === "core2" ? "#core2" : "#sys");
  $("#assuranceTabs").querySelectorAll("button").forEach((button) => (button.onclick = () => {
    S.assuranceTab = button.dataset.t;
    drawAssurance(data, origin);
  }));
  $("#assuranceSearch").oninput = (event) => {
    S.assuranceQ = event.target.value.trim();
    assuranceFilterRows(box);
  };
  assuranceFilterRows(box);
}

async function renderAssurance(origin) {
  origin = origin === "core2" ? "core2" : "sys";
  const box = $("#scr-assurance");
  box.innerHTML = `<div class="backrow"><button class="btn" onclick="nav('${origin === "core2" ? "#core2" : "#sys"}')">← ${esc(assuranceBackLabel(origin))}</button></div>
    <div class="card"><div class="skel"></div></div>`;
  try {
    const data = await api("/api/app/problem_assurance", { ttl: 60000 });
    drawAssurance(data, origin);
  } catch (e) {
    box.innerHTML += `<div class="empty">Реестр проблем недоступен: ${esc(e.message)}</div>`;
  }
}

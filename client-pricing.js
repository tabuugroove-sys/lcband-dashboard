"use strict";
(function () {
  let book = null;
  let dirty = false;
  const money = n => `${new Intl.NumberFormat("ru-RU").format(n)} ₽`;
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const root = () => document.getElementById("clientPricingContent");
  const message = (text, bad = false) => {
    const el = document.getElementById("pricingStatus");
    if (el) { el.textContent = text; el.classList.toggle("is-error", bad); }
  };
  function formData() {
    const data = structuredClone(book.data);
    root().querySelectorAll("[data-price-field]").forEach(el => {
      data[el.dataset.priceField] = el.type === "number" ? Number(el.value) : el.value.trim();
    });
    root().querySelectorAll("[data-lineup-price]").forEach(el => { data.lineups[Number(el.dataset.lineupPrice)].client_price_rub = Number(el.value); });
    root().querySelectorAll("[data-lineup-label]").forEach(el => { data.lineups[Number(el.dataset.lineupLabel)].label = el.value.trim(); });
    return data;
  }
  function recalculate() {
    const data = formData();
    data.lineups.forEach((row, i) => {
      const backline = row.size * data.backline_per_artist_rub;
      const total = row.client_price_rub + backline;
      document.getElementById(`priceBackline${i}`).textContent = money(backline);
      document.getElementById(`priceTotal${i}`).textContent = money(total);
      document.getElementById(`priceFloor${i}`).textContent = money(Math.ceil(total * (100 - data.max_discount_pct) / 100));
    });
    document.getElementById("priceFloorLabel").textContent = `После скидки ${data.max_discount_pct}%`;
  }
  function render() {
    const d = book.data;
    root().innerHTML = `<form id="clientPricingForm" class="client-prices">
      <div class="pricing-toolbar"><div><span class="pill ok">Канон · v${book.revision}</span><span class="pricing-saved">${book.created_at ? `Сохранён ${esc(new Date(book.created_at).toLocaleString("ru-RU"))}` : "Подтверждённые вами базовые цены"}</span></div><div><button class="text-button" id="pricingReload" type="button">Загрузить сохранённое</button> <button class="compact-button" id="pricingSave" type="submit">Сохранить как канон</button></div></div>
      <p class="pricing-intro">Сохранённые правки используются для новых расчётов и проверки питчей. Уже отправленные КП и договоры сохраняют согласованные цены.</p>
      <div class="pricing-controls">
        <label>Бэклайн / артист, ₽<input required type="number" min="0" max="1000000" step="1000" data-price-field="backline_per_artist_rub" value="${d.backline_per_artist_rub}"></label>
        <label>Предел скидки, %<input required type="number" min="0" max="90" step="1" data-price-field="max_discount_pct" value="${d.max_discount_pct}"></label>
        <div class="pricing-policy"><strong>Скидка — на весь пакет</strong><span>Если не помещаемся в бюджет → вопрос в Urgent Bot с контекстом заявки.</span></div>
      </div>
      <div class="pricing-table-scroll"><table class="pricing-table"><thead><tr><th>Состав</th><th>Гонорар, ₽</th><th>Бэклайн</th><th>Пакет</th><th id="priceFloorLabel"></th></tr></thead><tbody>
      ${d.lineups.map((r, i) => `<tr><td><strong>${r.size} ${r.size === 4 ? "артиста" : "артистов"}</strong><input required maxlength="200" aria-label="Описание состава ${i+1}" data-lineup-label="${i}" value="${esc(r.label)}"></td><td><input required aria-label="Гонорар состава ${i+1}" type="number" min="1000" max="10000000" step="1000" data-lineup-price="${i}" value="${r.client_price_rub}"></td><td id="priceBackline${i}"></td><td class="pricing-total" id="priceTotal${i}"></td><td id="priceFloor${i}"></td></tr>`).join("")}
      </tbody></table></div>
      <p class="pricing-caption">Наличный расчёт, без дополнительных PA / мониторов / света и выездных надбавок. Последняя колонка — предел, который не предлагается автоматически.</p>
      <details class="pricing-details" open><summary>Бэклайн и условия</summary><div class="pricing-details-grid">
        <label>Входит в бэклайн<textarea required maxlength="1000" rows="2" data-price-field="backline_includes">${esc(d.backline_includes)}</textarea></label>
        <label>Отдельно<textarea required maxlength="1000" rows="2" data-price-field="backline_excludes">${esc(d.backline_excludes)}</textarea></label>
        <label class="pricing-wide">Если часть комплекта уже на площадке<textarea required maxlength="1000" rows="2" data-price-field="partial_backline_policy">${esc(d.partial_backline_policy)}</textarea></label>
        <label>АК внутри гонорара, %<input required type="number" min="0" max="50" step="1" data-price-field="performance_agency_pct" value="${d.performance_agency_pct}"></label>
        <p>В бэклайне АК нет. Техник и звукорежиссёр входят в пакет и не увеличивают число артистов.</p>
      </div></details>
      <div class="pricing-flow">Запрос клиента → расчёт по канону → бюджет не сходится → Urgent Bot → решение по конкретной заявке</div>
      <p id="pricingStatus" role="status" aria-live="polite"></p>
    </form>`;
    recalculate();
    document.getElementById("pricingReload").onclick = () => { dirty = false; open(); };
    root().querySelector("form").addEventListener("input", () => { dirty = true; recalculate(); message("Есть несохранённые изменения"); });
    root().querySelector("form").addEventListener("submit", async event => {
      event.preventDefault();
      const button = document.getElementById("pricingSave");
      const data = formData();
      button.disabled = true;
      message("Сохраняем канон…");
      try {
        const result = await window.CoreParity.mutate("client-pricing", "pricing.save", {expected_revision: book.revision, data});
        book = result.editable_book;
        dirty = false;
        render();
        message(`Сохранено. Канон v${book.revision} действует для новых расчётов.`);
      } catch (error) {
        message(error.message, true);
      } finally { button.disabled = false; }
    });
  }
  async function open() {
    if (dirty && book) return;
    root().innerHTML = '<p class="pricing-intro">Загружаем действующий прайс…</p>';
    try {
      const response = await fetch("/api/core/client-pricing", {cache:"no-store", credentials:"same-origin"});
      if (!response.ok) throw new Error("Прайс недоступен. Повторите загрузку — сохранённые цены не потеряны.");
      const data = await response.json();
      if (!data.editable_book) throw new Error("Сервис ещё не поддерживает редактирование цен");
      book = data.editable_book;
      render();
    } catch (error) { root().innerHTML = `<p class="is-error">${esc(error.message)}</p><button id="pricingRetry" class="compact-button">Повторить</button>`; document.getElementById("pricingRetry").onclick = open; }
  }
  window.CorePricing = Object.freeze({open});
})();

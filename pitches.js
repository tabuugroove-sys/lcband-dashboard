/* LCB 2.0 «Питчи» — отправленные + pending delivery-gap (CHG-20260828-023).
   Данные: /api/app/pitches_live (прокси :8880 → dashboard_backend :8878).
   CSP: никаких inline-стилей — только классы и textContent. */
(function () {
  "use strict";
  var feed = document.getElementById("feed");
  var tpl = document.getElementById("rowTpl");
  var metaLine = document.getElementById("metaLine");
  var note = document.getElementById("note");
  var hoursSel = document.getElementById("hours");
  var filterSel = document.getElementById("filter");
  var autoCb = document.getElementById("auto");
  var refreshBtn = document.getElementById("refresh");
  var timer = null;
  var lastPitches = [];

  var PROBLEM_BADGES = {
    urgent: "🔴 ургент-бот",
    digest: "📮 notify-digest",
    send_block: "⛔ send-блок",
    delivery_gap: "⏳ не отправлен"
  };
  var KIND_LABELS = {
    ignored_client_reply: "клиент остался без ответа (SLA)",
    presend_fail_streak_cap: "серия presend-fail — блок отправок",
    ball_on_us: "клиент ждёт (мяч у нас)",
    rider_delivery_blocked: "обещанный райдер не доставлен",
    presend_block: "блок пресенда",
    auto_stop: "авто-стоп писаря",
    broker_stuck: "брокер застрял",
    writer_block: "блок писаря",
    promise_overdue: "просроченное обещание",
    agent_debt: "долг агента",
    watchdog_loop: "watchdog: залипание",
    ai_limit: "AI-лимит исчерпан",
    event_audit: "аудит события",
    event_close_confirm: "закрыть событие?",
    draft_approval: "драфт ждёт апрува",
    media_review: "медиа на ручную сверку",
    media_sourcing_fail: "sourcing упал",
    role_mismatch: "зачем агент писал (роль)",
    tech_question: "вопрос состава",
    call_reminder_final: "созвон закрыт как пропущенный",
    pitch_pending_review_not_dispatched: "драфт не дошёл до отправки",
    legacy_pitch_missing_source_scope: "legacy draft без exact source — HOLD",
    warm_review_context_required: "нужен контекст прежней переписки"
  };
  var PRESEND_LABELS = { ok: "ok", send: "ok", adapt: "adapt", skip: "skip",
                         escalate_to_opus: "эскалация" };

  function fmtWhen(iso) {
    if (!iso) return "—";
    try {
      var d = new Date(iso);
      if (isNaN(d.getTime())) return String(iso);
      return d.toLocaleString("ru-RU", {
        day: "2-digit", month: "2-digit",
        hour: "2-digit", minute: "2-digit"
      });
    } catch (e) { return String(iso); }
  }

  function clampable(el, text, emptyLabel) {
    if (text) {
      el.textContent = text;
      if (text.length > 260) {
        el.classList.add("clamped");
        el.addEventListener("click", function () {
          el.classList.toggle("clamped");
        });
      }
    } else {
      el.textContent = emptyLabel;
      el.classList.add("missing");
    }
  }

  function row(parent, cls, label, value) {
    if (!value && value !== false) return;
    var div = document.createElement("div");
    div.className = "p-row" + (cls ? " " + cls : "");
    var b = document.createElement("b");
    b.textContent = label + ": ";
    div.appendChild(b);
    div.appendChild(document.createTextNode(
      value === true ? "да" : value === false ? "нет" : String(value)));
    parent.appendChild(div);
  }

  function renderProblem(p) {
    var box = document.createElement("div");
    box.className = "problem src-" + (p.src || "digest");
    var head = document.createElement("div");
    head.className = "p-head";
    var badge = document.createElement("span");
    badge.className = "p-badge src-" + (p.src || "digest");
    badge.textContent = PROBLEM_BADGES[p.src] || p.src || "";
    head.appendChild(badge);
    var kind = document.createElement("span");
    kind.className = "p-kind";
    kind.textContent = KIND_LABELS[p.kind] || p.kind || "";
    head.appendChild(kind);
    if (p.ts) {
      var when = document.createElement("span");
      when.className = "p-when";
      when.textContent = fmtWhen(p.ts);
      head.appendChild(when);
    }
    if (p.status) {
      var st = document.createElement("span");
      st.className = "p-status";
      st.textContent = "статус: " + p.status;
      head.appendChild(st);
    }
    if (p.module || p.detector) {
      var md = document.createElement("span");
      md.className = "p-status";
      md.textContent = "источник: " + (p.module || p.detector);
      head.appendChild(md);
    }
    box.appendChild(head);

    row(box, "", "Почему возникло", p.why);
    if (p.src === "digest") {
      // формат дневного обзора notify_policy: пытался ли агент сам и
      // почему не справился — прямо из полей отправителя эскалации
      row(box, "", "Агент пытался сам",
          p.attempted === null || p.attempted === undefined
            ? "неизвестно (отправитель не передал)" : p.attempted);
      row(box, p.attempted === false ? "p-no-mech" : "",
          p.attempted === false
            ? "Почему не пытался (нет механики/права)"
            : "Почему не справился сам",
          p.attempt_detail);
    }
    if (p.src === "urgent" || p.src === "delivery_gap") {
      row(box, p.mechanic && p.mechanic.indexOf("нет") === 0
            ? "p-no-mech" : "",
          "Механика восстановления", p.mechanic);
      row(box, "", "Containment", p.containment);
      row(box, "", "Сигнатура", p.root_signature);
      if (p.src === "delivery_gap") {
        row(box, "", "Approval ID", p.approval_id);
        row(box, "", "Transport blocker", p.transport_block_reason);
        row(box, "", "Возраст, ч", p.age_hours);
      }
      if (p.tribrain_summary) {
        var det = document.createElement("details");
        det.className = "p-tribrain";
        var sum = document.createElement("summary");
        sum.textContent = "TriBrain-разбор: почему пошло не так" +
          (p.tribrain_status ? " (" + p.tribrain_status + ")" : "");
        det.appendChild(sum);
        var body = document.createElement("div");
        body.className = "p-sum";
        body.textContent = p.tribrain_summary;
        det.appendChild(body);
        box.appendChild(det);
      } else {
        row(box, "", "TriBrain-разбор",
            p.tribrain_status ? "в очереди (" + p.tribrain_status + ")" : null);
      }
    }
    if (p.src === "send_block") {
      row(box, "", "Ургент-алерт ушёл", p.alert_sent);
    }
    return box;
  }

  function renderFixWork(box, fw) {
    // справа от кейса: как решается архитектура проблемы — рабочие сессии
    // (Claude/Codex, где контакт назван человеком) + решения в change ledger
    box.textContent = "";
    var sessions = (fw && fw.sessions) || [];
    var ledger = (fw && fw.ledger) || [];
    if (!sessions.length && !ledger.length) {
      var none = document.createElement("div");
      none.className = "fw-empty";
      none.textContent = "работа по кейсу ещё не привязана: " +
        "сессии и change ledger не упоминают контакт";
      box.appendChild(none);
      return;
    }
    sessions.forEach(function (s) {
      var item = document.createElement("div");
      item.className = "fw-item" + (s.live ? " fw-live" : "");
      var head = document.createElement("div");
      head.className = "fw-head";
      var state = document.createElement("span");
      state.className = "fw-state";
      state.textContent = s.live ? "🟢 сессия идёт сейчас" : "сессия завершена";
      head.appendChild(state);
      var meta = document.createElement("span");
      meta.className = "fw-meta";
      meta.textContent = (s.source || "") + " · " + fmtWhen(s.last_activity);
      head.appendChild(meta);
      item.appendChild(head);
      if (s.tldr) {
        // «что-то происходит по исправлению» → сюда падает TLDR отчёта
        var tl = document.createElement("div");
        tl.className = "fw-tldr";
        tl.textContent = "TLDR: " + s.tldr;
        item.appendChild(tl);
      }
      if (s.title) {
        var t = document.createElement("div");
        t.className = s.tldr ? "fw-title fw-title-dim" : "fw-title";
        t.textContent = s.title;
        item.appendChild(t);
      }
      box.appendChild(item);
    });
    ledger.forEach(function (l) {
      var item = document.createElement("div");
      item.className = "fw-item fw-chg";
      var head = document.createElement("div");
      head.className = "fw-head";
      var state = document.createElement("span");
      state.className = "fw-state";
      state.textContent = "решение в ledger: " + (l.id || "");
      head.appendChild(state);
      var meta = document.createElement("span");
      meta.className = "fw-meta";
      meta.textContent = [l.status, l.deployment_status]
        .filter(Boolean).join(" · ");
      head.appendChild(meta);
      item.appendChild(head);
      if (l.title) {
        var t = document.createElement("div");
        t.className = "fw-title";
        t.textContent = l.title;
        item.appendChild(t);
      }
      box.appendChild(item);
    });
  }

  function postJson(url, payload) {
    return fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    }).then(function (response) {
      return response.json().then(function (data) {
        if (!response.ok || !data || data.ok !== true) {
          throw new Error((data && data.error) || ("HTTP " + response.status));
        }
        return data;
      });
    });
  }

  function pauseAutoRefresh() {
    if (autoCb.checked) {
      autoCb.checked = false;
      schedule();
    }
  }

  function renderWarmActions(box, pitch) {
    box.hidden = false;
    box.textContent = "";

    var title = document.createElement("div");
    title.className = "warm-title";
    title.textContent = "Тёплый контакт: task нельзя отправить напрямую";
    box.appendChild(title);

    var hint = document.createElement("div");
    hint.className = "warm-hint";
    hint.textContent = "Откройте Telegram-историю, вставьте релевантный контекст " +
      "и подготовьте новый ответ. Кнопка создаст отдельный approval без отправки.";
    box.appendChild(hint);

    var context = document.createElement("textarea");
    context.className = "warm-input";
    context.rows = 5;
    context.placeholder = "Контекст прежней переписки (обязательно)";
    context.addEventListener("focus", pauseAutoRefresh);
    box.appendChild(context);

    var draft = document.createElement("textarea");
    draft.className = "warm-input";
    draft.rows = 5;
    draft.placeholder = "Новый контекстный текст питча (обязательно)";
    draft.addEventListener("focus", pauseAutoRefresh);
    box.appendChild(draft);

    var controls = document.createElement("div");
    controls.className = "warm-controls";
    var materialize = document.createElement("button");
    materialize.type = "button";
    materialize.className = "warm-primary";
    materialize.textContent = "Создать контекстный approval";
    controls.appendChild(materialize);

    var reissueLabel = document.createElement("label");
    reissueLabel.className = "warm-reissue";
    var reissue = document.createElement("input");
    reissue.type = "checkbox";
    reissueLabel.appendChild(reissue);
    reissueLabel.appendChild(document.createTextNode(
      " safe reissue, только если прежний child terminal и command отсутствует"));
    controls.appendChild(reissueLabel);
    box.appendChild(controls);

    var resolutionRow = document.createElement("div");
    resolutionRow.className = "warm-controls";
    var resolution = document.createElement("select");
    [
      ["not_relevant", "не актуально"],
      ["no_outreach", "не писать"],
      ["handled_manually", "обработано вручную"],
      ["duplicate", "дубликат"],
      ["superseded", "заменено новым кейсом"]
    ].forEach(function (item) {
      var option = document.createElement("option");
      option.value = item[0];
      option.textContent = item[1];
      resolution.appendChild(option);
    });
    resolutionRow.appendChild(resolution);
    var resolveButton = document.createElement("button");
    resolveButton.type = "button";
    resolveButton.className = "warm-secondary";
    resolveButton.textContent = "Закрыть без outreach";
    resolutionRow.appendChild(resolveButton);
    box.appendChild(resolutionRow);

    var status = document.createElement("div");
    status.className = "warm-status";
    box.appendChild(status);

    materialize.addEventListener("click", function () {
      var exactContext = context.value.trim();
      var exactDraft = draft.value.trim();
      if (!exactContext || !exactDraft) {
        status.textContent = "Нужны и история, и новый текст.";
        status.className = "warm-status is-error";
        return;
      }
      materialize.disabled = true;
      status.className = "warm-status";
      status.textContent = "Сохраняю approval…";
      postJson("/api/app/pitches_live/warm_materialize", {
        warm_task_id: pitch.approval_id,
        context_text: exactContext,
        draft_text: exactDraft,
        original_text: (pitch.source_post && pitch.source_post.text) || "",
        allow_terminal_reissue: reissue.checked === true
      }).then(function (data) {
        status.className = "warm-status is-ok";
        status.textContent = "Создан approval " + data.approval_id +
          ". Отправки не было.";
        window.setTimeout(load, 900);
      }).catch(function (error) {
        status.className = "warm-status is-error";
        status.textContent = "Не создано: " + error.message;
      }).finally(function () {
        materialize.disabled = false;
      });
    });

    resolveButton.addEventListener("click", function () {
      if (!window.confirm("Закрыть warm-task без отправки сообщения?")) return;
      resolveButton.disabled = true;
      status.className = "warm-status";
      status.textContent = "Закрываю task…";
      postJson("/api/app/pitches_live/warm_resolve", {
        warm_task_id: pitch.approval_id,
        resolution: resolution.value,
        note: "explicit dashboard decision"
      }).then(function () {
        status.className = "warm-status is-ok";
        status.textContent = "Task закрыт без outreach.";
        window.setTimeout(load, 900);
      }).catch(function (error) {
        status.className = "warm-status is-error";
        status.textContent = "Не закрыто: " + error.message;
      }).finally(function () {
        resolveButton.disabled = false;
      });
    });
  }

  function render() {
    var f = filterSel.value;
    var shown = lastPitches.filter(function (p) {
      if (!f) return true;
      if (f === "__problems__") return (p.problems || []).length > 0;
      if (f === "__unsent__") return p.sent === false;
      return p.type === f;
    });
    feed.textContent = "";
    if (!shown.length) {
      var empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = "Питчей нет (окно/фильтр).";
      feed.appendChild(empty);
      return;
    }
    shown.forEach(function (p) {
      var node = tpl.content.cloneNode(true);
      var art = node.querySelector(".pitch");
      if (p.sent === false) art.classList.add("pending-delivery");
      node.querySelector(".when").textContent = fmtWhen(p.ts);
      node.querySelector(".chat").textContent = p.chat || "—";
      var target = node.querySelector(".target");
      var t = String(p.target || "").replace(/^@/, "");
      if (/^[A-Za-z0-9_]{3,32}$/.test(t)) {
        target.textContent = "@" + t;
        target.href = "https://t.me/" + t;
      } else {
        target.textContent = t || "без username";
        target.removeAttribute("href");
      }
      var typeChip = node.querySelector(".chip.type");
      typeChip.textContent = p.type_label || p.type || "—";
      if (p.type) typeChip.classList.add("type-" + p.type);
      var deliveryChip = node.querySelector(".chip.delivery");
      deliveryChip.hidden = false;
      if (p.sent === false) {
        deliveryChip.textContent = "⏳ не отправлено · " +
          (p.delivery_state || "pending_review");
        deliveryChip.classList.add("pending");
        node.querySelector(".out-label").textContent =
          "Агент подготовил — не отправлено";
      } else {
        deliveryChip.textContent = "✓ отправлено";
        deliveryChip.classList.add("sent");
      }
      var orderChip = node.querySelector(".chip.order");
      if (p.order_status) {
        orderChip.hidden = false;
        orderChip.textContent = "сейчас: " + p.order_status;
        if (p.order_archived) orderChip.classList.add("archived");
      }
      var flag = node.querySelector(".chip.problem-flag");
      var problems = p.problems || [];
      if (problems.length) {
        flag.hidden = false;
        flag.textContent = "⚠ проблем: " + problems.length;
        art.classList.add("has-problems");
      }
      if (p.delivery_state === "warm_review_pending" &&
          p.review_task_only === true && p.approval_id) {
        renderWarmActions(node.querySelector(".warm-actions"), p);
      }

      var src = p.source_post;
      clampable(node.querySelector(".src-text"), src && src.text,
                "текст поста недоступен (нет в базе/журнале)");
      var srcMeta = node.querySelector(".src-meta");
      if (src) {
        srcMeta.textContent = [
          src.chat || p.chat || "",
          src.ts ? fmtWhen(src.ts) : "",
          src.origin === "orders" ? "из карточки заказа" :
            src.origin === "classify_journal" ? "из журнала классификации" :
            src.origin === "pending_approval" ? "из очереди approval" : ""
        ].filter(Boolean).join(" · ");
      } else {
        srcMeta.textContent = p.chat ? "чат: " + p.chat : "";
      }

      clampable(node.querySelector(".out-text"), p.pitch_text, "—");
      var chips = node.querySelector(".out-chips");
      var modelsChip = node.querySelector(".chip.models");
      if (p.models && p.models.length) {
        modelsChip.hidden = false;
        modelsChip.textContent = "🧠 " + p.models.join(" → ");
      }
      (p.presend || []).forEach(function (d) {
        var c = document.createElement("span");
        var dec = String(d.decision || "");
        c.className = "chip presend-" +
          (dec === "skip" ? "skip" : dec === "adapt" ? "adapt" : "ok");
        c.textContent = "presend: " + (PRESEND_LABELS[dec] || dec || "—");
        if (d.reason) c.title = d.reason;
        chips.appendChild(c);
      });

      if (problems.length) {
        var cases = node.querySelector(".problems");
        cases.hidden = false;
        problems.forEach(function (pr) { cases.appendChild(renderProblem(pr)); });
      }
      // «Что мы делаем» — отдельный контейнер рядом с карточкой: виден при
      // проблемах И когда по контакту просто идёт работа («отправили КП»)
      var fw = p.fix_work;
      var hasWork = fw && (((fw.sessions || []).length) ||
                           ((fw.ledger || []).length));
      if (problems.length || hasWork) {
        var aside = node.querySelector(".fixwork");
        aside.hidden = false;
        renderFixWork(aside.querySelector(".fixwork-items"), fw);
      }
      feed.appendChild(node);
    });
  }

  function load() {
    var hours = hoursSel.value || "168";
    fetch("/api/app/pitches_live?hours=" + encodeURIComponent(hours))
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!data || data.ok !== true) {
          metaLine.textContent = "Ошибка данных: " +
            ((data && data.error) || "нет ответа");
          return;
        }
        lastPitches = data.pitches || [];
        var c = data.counts || {};
        metaLine.textContent = "Live: отправлено за " + data.hours + "ч: " +
          (c.sent || 0) + " · не отправлено: " + (c.pending || 0) +
          " · с проблемами: " + (c.with_problems || 0) +
          " (эскалаций: " + (c.problems || 0) + ")" +
          " · обновлено " + fmtWhen(data.generated_at);
        if (data.note) {
          note.hidden = false;
          note.textContent = data.note;
        }
        render();
      })
      .catch(function (e) {
        metaLine.textContent = "Сеть/бэкенд недоступны: " + e;
      });
  }

  function schedule() {
    if (timer) { clearInterval(timer); timer = null; }
    if (autoCb.checked) { timer = setInterval(load, 15000); }
  }

  hoursSel.addEventListener("change", load);
  filterSel.addEventListener("change", render);
  autoCb.addEventListener("change", schedule);
  refreshBtn.addEventListener("click", load);
  load();
  schedule();
}());

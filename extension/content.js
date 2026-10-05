(async () => {
  const licenseReady = globalThis.__plurallLicenseReady;
  if (licenseReady && !(await licenseReady)) return;
  const HOST_ID = "plurall-assistente-local-host";
  const POSITION_KEY = "assistantPanelPosition";
  const RETRY_MEMORY_KEY = "plurallRetryMemory";
  if (document.getElementById(HOST_ID)) return;

  const state = {
    busy: false,
    autoAnalyze: false,
    autoSubmit: true,
    lastFingerprint: null,
    lastQuestionUrl: null,
    lastResult: null,
    lastAutoSubmitted: false,
    lastSubmitFingerprint: null,
    retryPlan: [],
    retryPosition: 0,
    attemptedOptionIndices: [],
    retryInProgress: false,
    retryExhausted: false,
    retryWatchdogTimer: null,
    scanTimer: null,
    collapsed: false,
    panelPosition: null,
    dragState: null,
  };

  const host = document.createElement("div");
  host.id = HOST_ID;
  host.style.all = "initial";
  host.style.position = "fixed";
  host.style.right = "20px";
  host.style.bottom = "20px";
  host.style.zIndex = "2147483647";
  document.documentElement.appendChild(host);

  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = `
    <style>
      :host { all: initial; }
      * { box-sizing: border-box; }
      .panel {
        width: min(380px, calc(100vw - 32px));
        max-height: min(640px, calc(100vh - 32px));
        overflow: auto;
        padding: 16px;
        border: 1px solid rgba(124, 58, 237, .26);
        border-radius: 16px;
        color: #2b2340;
        background: rgba(255, 255, 255, .98);
        box-shadow: 0 18px 50px rgba(91, 33, 182, .22);
        font: 14px/1.45 Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      .header { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
      .title-actions { display: flex; align-items: center; gap: 7px; }
      .drag-handle { cursor: grab; touch-action: none; user-select: none; }
      .drag-handle:active { cursor: grabbing; }
      h2 { margin: 0; font-size: 16px; line-height: 1.2; color: #5b21b6; }
      .badge { padding: 3px 8px; border-radius: 999px; background: #f3e8ff; color: #6d28d9; font-size: 11px; font-weight: 700; }
      .status { margin: 12px 0; padding: 10px 12px; border-radius: 10px; background: #f7f3ff; color: #514760; }
      .status[data-tone="error"] { background: #fff1f2; color: #9f1239; }
      .status[data-tone="success"] { background: #f3e8ff; color: #5b21b6; }
      button {
        appearance: none;
        width: 100%;
        border: 0;
        border-radius: 10px;
        padding: 10px 12px;
        cursor: pointer;
        font: inherit;
        font-weight: 700;
      }
      button.primary { color: white; background: linear-gradient(135deg, #7c3aed, #9333ea); }
      button.secondary { margin-top: 10px; color: #5b21b6; background: #f3e8ff; }
      button.icon-button { width: 30px; height: 30px; padding: 0; border: 1px solid #d8b4fe; color: #6d28d9; background: #faf5ff; }
      button:disabled { cursor: not-allowed; opacity: .55; }
      .panel.collapsed { width: auto; max-width: calc(100vw - 32px); padding: 11px 12px; overflow: visible; }
      .panel.collapsed .collapsible { display: none; }
      .auto { display: flex; align-items: center; gap: 8px; margin-top: 11px; color: #5f586b; cursor: pointer; user-select: none; }
      .auto input { accent-color: #7c3aed; }
      .result { display: none; margin-top: 14px; padding-top: 14px; border-top: 1px solid #ede9fe; }
      .result.visible { display: block; }
      .answer { display: flex; align-items: baseline; gap: 10px; }
      .letter { font-size: 34px; line-height: 1; font-weight: 900; color: #7c3aed; }
      .confidence { color: #6b6475; font-size: 12px; }
      .explanation { margin: 10px 0 0; white-space: pre-wrap; }
      .open-response { display: none; margin: 10px 0 0; padding: 10px; border-radius: 9px; background: #faf5ff; white-space: pre-wrap; }
      .open-response.visible { display: block; }
      .warnings { margin: 9px 0 0; padding-left: 18px; color: #92400e; }
      .privacy { margin: 12px 0 0; color: #746d7d; font-size: 11px; }
    </style>
    <section id="panel" class="panel" aria-label="Assistente local do Plurall">
      <div class="header">
        <h2>Assistente local gratuito</h2>
        <span class="title-actions">
          <span class="badge">Ollama</span>
          <button id="move" class="icon-button drag-handle" type="button" title="Arraste para mover" aria-label="Arraste para mover o painel">↕</button>
          <button id="collapse" class="icon-button" type="button" title="Recolher painel" aria-label="Recolher painel">−</button>
        </span>
      </div>
      <div class="collapsible">
        <div id="status" class="status" role="status">Procurando uma questão…</div>
        <button id="analyze" class="primary" type="button">Analisar questão</button>
        <label class="auto">
          <input id="auto" type="checkbox">
          Analisar automaticamente ao trocar de questão
        </label>
        <label class="auto">
          <input id="auto-submit" type="checkbox" checked>
          Clicar em “Responder” depois de aplicar
        </label>
        <div id="result" class="result">
          <div class="answer">
            <span id="letter" class="letter">—</span>
            <span id="confidence" class="confidence"></span>
          </div>
          <p id="open-response" class="open-response"></p>
          <p id="explanation" class="explanation"></p>
          <ul id="warnings" class="warnings"></ul>
          <button id="apply" class="secondary" type="button">Marcar alternativa</button>
        </div>
        <p class="privacy">Processa o texto localmente. O envio automático pode ser desligado na opção acima.</p>
      </div>
    </section>
  `;

  const ui = {
    panel: shadow.getElementById("panel"),
    move: shadow.getElementById("move"),
    collapse: shadow.getElementById("collapse"),
    status: shadow.getElementById("status"),
    analyze: shadow.getElementById("analyze"),
    auto: shadow.getElementById("auto"),
    autoSubmit: shadow.getElementById("auto-submit"),
    result: shadow.getElementById("result"),
    letter: shadow.getElementById("letter"),
    openResponse: shadow.getElementById("open-response"),
    confidence: shadow.getElementById("confidence"),
    explanation: shadow.getElementById("explanation"),
    warnings: shadow.getElementById("warnings"),
    apply: shadow.getElementById("apply"),
  };

  ui.analyze.addEventListener("click", () => analyzeCurrentQuestion(false));
  ui.apply.addEventListener("click", () => void applySuggestedOption());
  ui.move.addEventListener("pointerdown", startPanelDrag);
  window.addEventListener("pointermove", movePanelDrag);
  window.addEventListener("pointerup", finishPanelDrag);
  window.addEventListener("pointercancel", finishPanelDrag);
  window.addEventListener("resize", () => state.panelPosition && applyPanelPosition(state.panelPosition));
  ui.collapse.addEventListener("click", () => {
    state.collapsed = !state.collapsed;
    applyCollapsedState();
    chrome.storage.local.set({ assistantCollapsed: state.collapsed });
    requestAnimationFrame(() => state.panelPosition && applyPanelPosition(state.panelPosition));
  });
  ui.auto.addEventListener("change", () => {
    state.autoAnalyze = ui.auto.checked;
    chrome.storage.local.set({ localAutoAnalyze: state.autoAnalyze });
    if (state.autoAnalyze) schedulePageScan(250);
  });
  ui.autoSubmit.addEventListener("change", () => {
    state.autoSubmit = ui.autoSubmit.checked;
    chrome.storage.local.set({ localAutoSubmit: state.autoSubmit });
  });

  chrome.storage.local.get(["localAutoAnalyze", "localAutoSubmit", "assistantCollapsed", POSITION_KEY, RETRY_MEMORY_KEY], (saved) => {
    state.autoAnalyze = Boolean(saved?.localAutoAnalyze);
    state.autoSubmit = saved?.localAutoSubmit !== false;
    state.collapsed = Boolean(saved?.assistantCollapsed);
    state.panelPosition = normalizePanelPosition(saved?.[POSITION_KEY]);
    restoreRetryMemory(saved?.[RETRY_MEMORY_KEY]);
    ui.auto.checked = state.autoAnalyze;
    ui.autoSubmit.checked = state.autoSubmit;
    applyCollapsedState();
    requestAnimationFrame(() => state.panelPosition && applyPanelPosition(state.panelPosition));
    refreshAvailability();
    if (state.autoAnalyze) schedulePageScan(500);
  });

  const observer = new MutationObserver(() => schedulePageScan(700));
  observer.observe(document.documentElement, { childList: true, subtree: true });
  state.retryWatchdogTimer = setInterval(() => {
    if (!document.hidden && !state.retryInProgress && findRetryControl()) {
      void handleRetryModal();
    }
  }, 400);
  window.addEventListener("pagehide", () => {
    if (state.retryWatchdogTimer) clearInterval(state.retryWatchdogTimer);
  }, { once: true });
  refreshAvailability();

  function startPanelDrag(event) {
    if (event.button !== 0) return;
    const rect = host.getBoundingClientRect();
    state.dragState = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      hostX: rect.left,
      hostY: rect.top,
      width: rect.width,
      height: rect.height,
    };
    ui.move.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  }

  function movePanelDrag(event) {
    const drag = state.dragState;
    if (!drag || drag.pointerId !== event.pointerId) return;
    applyPanelPosition({
      x: drag.hostX + event.clientX - drag.startX,
      y: drag.hostY + event.clientY - drag.startY,
    }, { width: drag.width, height: drag.height });
  }

  function finishPanelDrag(event) {
    const drag = state.dragState;
    if (!drag || drag.pointerId !== event.pointerId) return;
    state.dragState = null;
    ui.move.releasePointerCapture?.(event.pointerId);
    if (state.panelPosition) chrome.storage.local.set({ [POSITION_KEY]: state.panelPosition });
  }

  function applyPanelPosition(position, measuredSize) {
    const rect = measuredSize || host.getBoundingClientRect();
    const next = PlurallFlowCore.clampPanelPosition(
      position,
      { width: rect.width, height: rect.height },
      { width: window.innerWidth, height: window.innerHeight },
    );
    state.panelPosition = next;
    host.style.left = `${next.x}px`;
    host.style.top = `${next.y}px`;
    host.style.right = "auto";
    host.style.bottom = "auto";
  }

  function normalizePanelPosition(value) {
    const x = Number(value?.x);
    const y = Number(value?.y);
    return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
  }

  function extractQuestion() {
    // A página pode manter o componente da questão anterior oculto no DOM.
    // Só classifique como múltipla escolha o bloco da questão que está visível.
    const multipleChoice = [...document.querySelectorAll("#multiple-choice")].find(isElementVisible) || null;
    const responseField = findOpenResponseField();
    if (!multipleChoice && !responseField) return null;
    const type = multipleChoice ? "multiple-choice" : "open";

    const optionElements = multipleChoice ? [...multipleChoice.querySelectorAll("li.option")] : [];
    const options = optionElements
      .map((element, index) => {
        const dedicatedText = element.querySelector('[class*="MultipleChoice-module_option-text"]');
        const text = normalizeText(dedicatedText?.innerText || element.innerText)
          .replace(/^Alternativa selecionada\s*/i, "");
        return { index, label: indexToLabel(index), text };
      })
      .filter((option) => option.text);

    if (type === "multiple-choice" && options.length < 2) return null;

    const questionRoot =
      (multipleChoice || responseField).closest('[class*="Question-module_question-container"]') ||
      responseField?.closest('[class*="Exercise-module"]') ||
      document.querySelector('#container-hold-content [class*="exercise"]') ||
      (multipleChoice || responseField).parentElement;
    const clone = questionRoot?.cloneNode(true);
    clone?.querySelector("#multiple-choice")?.remove();
    clone?.querySelectorAll("button, textarea, input").forEach((element) => element.remove());

    let questionText = cleanQuestionText(clone?.innerText || "");
    if (!questionText) {
      questionText = cleanQuestionText(questionRoot?.innerText || "");
      for (const option of options) questionText = questionText.replace(option.text, "");
    }

    const questionParts = splitQuestionContext(questionText);
    // O rótulo pode ficar em outro container visual do exercício, fora do
    // bloco imediato do enunciado. Procuramos a área visível inteira.
    const visualRoot = questionRoot?.closest('[class*="Exercise-module"]') || questionRoot || document;
    const imageElements = [...visualRoot.querySelectorAll("img")].filter(isElementVisible);
    const images = imageElements
      .map((image) => normalizeText(image.alt))
      .filter(Boolean)
      .slice(0, 12);
    const imageSources = imageElements
      .map((image) => image.currentSrc || image.src)
      .filter(Boolean)
      .slice(0, 6);
    const fullText = normalizeText(questionRoot?.innerText || "");
    const minimumAnswerLength = type === "open"
      ? PlurallFlowCore.minimumAnswerLengthFromText(fullText)
      : 0;
    const locked = /TENTATIVAS RESTANTES:\s*0\b|0\s+tentativas restantes/i.test(fullText);
    const fingerprint = hashText(`${type}\n${location.href}\n${questionText}\n${options.map((option) => option.text).join("\n")}`);

    return {
      type,
      // Se a questão trouxer uma leitura, poema, notícia ou tabela antes do
      // comando, enviamos as duas partes separadas. Assim o modelo não trata o
      // texto-base como se fosse só mais uma frase do enunciado.
      question: questionParts.command,
      sourceMaterial: questionParts.sourceMaterial,
      options,
      images,
      imageSources,
      imageCount: imageElements.length,
      locked,
      fingerprint,
      optionElements,
      responseField,
      minimumAnswerLength,
    };
  }

  async function loadQuestionImages(extracted) {
    const sources = Array.isArray(extracted?.imageSources) ? extracted.imageSources : [];
    const images = [];
    for (const source of sources) {
      try {
        if (/^data:image\//i.test(source)) {
          const base64 = source.split(",", 2)[1];
          if (base64) images.push(base64);
          continue;
        }
        let base64 = "";
        try {
          const response = await fetch(source, { credentials: "include" });
          if (response.ok) base64 = await imageResponseToBase64(response);
        } catch { /* tenta o service worker abaixo */ }
        if (!base64) base64 = await fetchImageThroughExtension(source);
        if (base64) images.push(base64);
      } catch { /* imagem inacessível: segue com o texto */ }
    }
    return images;
  }

  async function imageResponseToBase64(response) {
    const blob = await response.blob();
    if (!/^image\//i.test(blob.type) || blob.size > 8 * 1024 * 1024) return "";
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
    return dataUrl.split(",", 2)[1] || "";
  }

  function fetchImageThroughExtension(url) {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => resolve(""), 15_000);
      chrome.runtime.sendMessage({ type: "fetch-question-image", payload: { url } }, (response) => {
        clearTimeout(timeout);
        if (chrome.runtime.lastError || !response?.ok) return resolve("");
        resolve(String(response.image_base64 || ""));
      });
    });
  }

  function findOpenResponseField() {
    return [...document.querySelectorAll(
      '[data-test-id="response-textarea"], textarea[placeholder*="resposta" i], textarea[placeholder*="answer" i]',
    )].find(isElementVisible) || null;
  }

  async function analyzeCurrentQuestion(fromAutoMode, queueOptions = {}) {
    if (state.busy) return;
    const extracted = extractQuestion();
    if (!extracted) {
      setStatus("Não encontrei uma questão compatível nesta página.", "error");
      return;
    }

    state.busy = true;
    ui.analyze.disabled = true;
    ui.apply.disabled = true;
    setStatus(fromAutoMode ? "Nova questão encontrada. Analisando localmente…" : "Analisando localmente; isso pode levar alguns segundos…");

    try {
      const imageData = await loadQuestionImages(extracted);
      const preExistingWrongOptionIndices = extracted.type === "multiple-choice"
        ? extracted.optionElements
            .map((optionElement, index) => (inspectOptionOutcome(optionElement).wrong ? index : -1))
            .filter((index) => index >= 0)
        : [];
      state.attemptedOptionIndices = [...new Set([
        ...state.attemptedOptionIndices,
        ...preExistingWrongOptionIndices,
      ])];
      const response = await sendRuntimeMessage({
        type: extracted.type === "open" ? "solve-open-question" : "solve-question",
        payload: {
          question: extracted.question,
          source_material: extracted.sourceMaterial,
          options: extracted.options,
          image_descriptions: extracted.images,
          image_count: extracted.imageCount,
          image_data: imageData,
          excluded_option_indices: state.attemptedOptionIndices,
          minimum_answer_length: extracted.minimumAnswerLength,
        },
      });
      if (!response?.ok) throw new Error(response?.error || "Não foi possível analisar a questão.");

      state.lastFingerprint = extracted.fingerprint;
      state.lastQuestionUrl = currentQuestionUrl();
      state.lastResult = response.result;
      if (extracted.sourceMaterial) {
        response.result.warnings = [
          `Fonte consultada: texto-base da questão (${extracted.sourceMaterial.length} caracteres).`,
          ...(response.result.warnings || []),
        ];
      }
      state.retryPlan = extracted.type === "multiple-choice"
        ? buildRetryPlan(response.result, extracted.options.length)
        : [];
      const visuallyWrongOptionIndices = extracted.type === "multiple-choice"
        ? extracted.optionElements
            .map((optionElement, index) => (inspectOptionOutcome(optionElement).wrong ? index : -1))
            .filter((index) => index >= 0)
        : [];
      state.attemptedOptionIndices = [...new Set([
        ...state.attemptedOptionIndices,
        ...visuallyWrongOptionIndices,
      ])];
      const firstUntriedPosition = PlurallFlowCore.nextUntriedRetryPosition(
        state.retryPlan,
        -1,
        state.attemptedOptionIndices,
      );
      state.retryPosition = firstUntriedPosition >= 0 ? firstUntriedPosition : 0;
      state.retryInProgress = false;
      state.retryExhausted = false;
      showResult(response.result, extracted.locked, extracted.type);
      const confidence = Math.max(0, Math.min(1, Number(response.result?.confidence) || 0));
      const threshold = Number(queueOptions.autoMarkThreshold);
      state.lastAutoSubmitted = false;
      const shouldAutoMark =
        !extracted.locked &&
        PlurallFlowCore.shouldAutoApply(confidence, threshold);
      const autoMarked = shouldAutoMark ? await applySuggestedOption() : false;

      if (extracted.locked) {
        setStatus("Análise concluída. Esta questão não possui tentativas restantes.", "success");
      } else if (autoMarked) {
        setStatus(
          state.lastAutoSubmitted
            ? `Estimativa do modelo: ${Math.round(confidence * 100)}% (não calibrada). Resposta aplicada e “Responder” acionado automaticamente.`
            : extracted.type === "open"
              ? `Estimativa do modelo: ${Math.round(confidence * 100)}% (não calibrada). Resposta preenchida automaticamente; revise e clique em “Responder”.`
              : `Estimativa do modelo: ${Math.round(confidence * 100)}% (não calibrada). Alternativa marcada automaticamente; revise e clique em “Responder”.`,
          "success",
        );
      } else if (Number.isFinite(threshold)) {
        setStatus(
          `Estimativa do modelo: ${Math.round(confidence * 100)}% (não calibrada). Não consegui aplicar a resposta automaticamente; a fila tentará novamente.`,
          "error",
        );
      } else {
        setStatus("Análise concluída. Revise a explicação antes de marcar.", "success");
      }

      document.dispatchEvent(new CustomEvent("plurall-local-analysis-complete", {
        detail: {
          confidence,
          autoMarked,
          autoSubmitted: state.lastAutoSubmitted,
          locked: extracted.locked,
          questionType: extracted.type,
          optionLabel: extracted.type === "open"
            ? ""
            : (response.result?.option_label || indexToLabel(response.result?.option_index)),
        },
      }));
    } catch (error) {
      const message = error?.message || "Não foi possível analisar a questão.";
      setStatus(message, "error");
      document.dispatchEvent(new CustomEvent("plurall-local-analysis-error", {
        detail: { message },
      }));
    } finally {
      state.busy = false;
      ui.analyze.disabled = false;
    }
  }

  function showResult(result, locked, questionType) {
    const confidence = Math.max(0, Math.min(1, Number(result.confidence) || 0));
    const openQuestion = questionType === "open";
    ui.letter.textContent = openQuestion ? "Texto" : (result.option_label || indexToLabel(result.option_index));
    ui.letter.style.fontSize = openQuestion ? "20px" : "34px";
    ui.confidence.textContent = `Estimativa do modelo: ${Math.round(confidence * 100)}% (não calibrada)`;
    ui.openResponse.textContent = openQuestion ? String(result.answer || "") : "";
    ui.openResponse.classList.toggle("visible", openQuestion);
    ui.explanation.textContent = result.explanation || "Sem explicação disponível.";
    ui.warnings.replaceChildren();
    for (const warning of result.warnings || []) {
      const item = document.createElement("li");
      item.textContent = warning;
      ui.warnings.appendChild(item);
    }
    ui.result.classList.add("visible");
    ui.apply.textContent = openQuestion ? "Preencher resposta" : `Marcar alternativa ${ui.letter.textContent}`;
    ui.apply.disabled = Boolean(locked);
  }

  async function applySuggestedOption() {
    const extracted = extractQuestion();
    const result = state.lastResult;
    state.lastAutoSubmitted = false;
    if (!extracted || !result) {
      setStatus("Analise a questão antes de aplicar a resposta.", "error");
      return false;
    }
    if (!matchesAnalyzedQuestion(extracted)) {
      clearResult();
      setStatus("A questão mudou. Faça uma nova análise antes de marcar.", "error");
      return false;
    }
    if (extracted.locked) {
      ui.apply.disabled = true;
      setStatus("Esta questão não possui tentativas restantes.", "error");
      return false;
    }

    if (extracted.type === "open") {
      const answer = String(result.answer || "").trim();
      const field = extracted.responseField;
      if (!field || !answer) {
        setStatus("Não encontrei o campo ou o texto da resposta aberta.", "error");
        return false;
      }

      field.scrollIntoView({ behavior: "auto", block: "center" });
      setTextFieldValue(field, answer);
      await wait(120);
      if (String(field.value || "").trim() !== answer) {
        setTextFieldValue(field, answer);
        await wait(120);
      }
      if (String(field.value || "").trim() !== answer) {
        setStatus("Não consegui preencher o campo da resposta. Use o texto mostrado no painel.", "error");
        return false;
      }

      const submitted = state.autoSubmit ? await submitCurrentAnswer(extracted) : false;
      setStatus(
        submitted
          ? "Resposta preenchida e enviada automaticamente."
          : state.autoSubmit
            ? "Resposta preenchida, mas não consegui acionar “Responder”."
            : "Resposta preenchida. Revise e clique em “Responder” somente se concordar.",
        state.autoSubmit && !submitted ? "error" : "success",
      );
      return true;
    }

    const index = extracted.type === "multiple-choice"
      ? Number(state.retryPlan[state.retryPosition] ?? result.option_index)
      : Number(result.option_index);
    const optionElement = extracted.optionElements[index];
    if (!Number.isInteger(index) || !optionElement) {
      setStatus("A alternativa sugerida não corresponde às opções atuais.", "error");
      return false;
    }

    optionElement.scrollIntoView({ behavior: "auto", block: "center" });
    const clickTarget = optionElement.querySelector('[data-test-id="option"]') || optionElement;
    if (typeof clickTarget.click === "function") clickTarget.click();
    await wait(120);
    if (!isOptionSelected(optionElement)) {
      for (const eventName of ["mousedown", "mouseup", "click"]) {
        clickTarget.dispatchEvent(new MouseEvent(eventName, {
          bubbles: true,
          cancelable: true,
          view: window,
          button: 0,
        }));
      }
      await wait(120);
    }
    if (!isOptionSelected(optionElement)) {
      if (typeof optionElement.click === "function") optionElement.click();
      await wait(120);
    }
    if (!isOptionSelected(optionElement)) {
      setStatus("O Plurall não registrou a alternativa. Clique nela manualmente e tente novamente.", "error");
      return false;
    }

    if (!state.attemptedOptionIndices.includes(index)) {
      state.attemptedOptionIndices.push(index);
    }
    saveRetryMemory();

    const submitted = state.autoSubmit ? await submitCurrentAnswer(extracted) : false;
    setStatus(
      submitted
        ? `Alternativa ${indexToLabel(index)} marcada e enviada automaticamente.`
        : state.autoSubmit
          ? `Alternativa ${indexToLabel(index)} marcada, mas não consegui acionar “Responder”.`
          : `Alternativa ${indexToLabel(index)} marcada. Revise e clique em “Responder” somente se concordar.`,
      state.autoSubmit && !submitted ? "error" : "success",
    );
    return true;
  }

  async function submitCurrentAnswer(extracted) {
    if (state.lastSubmitFingerprint === extracted.fingerprint && state.lastAutoSubmitted) {
      state.lastAutoSubmitted = true;
      return true;
    }

    let responderButton = null;
    for (let attempt = 0; attempt < 25; attempt += 1) {
      responderButton = [...document.querySelectorAll("button")]
        .find((button) => normalizeText(button.innerText) === "Responder") || null;
      if (responderButton && !responderButton.disabled) break;
      await wait(100);
    }

    if (!responderButton || responderButton.disabled) {
      setStatus("A resposta foi aplicada, mas o botão “Responder” não ficou disponível.", "error");
      return false;
    }

    responderButton.scrollIntoView({ behavior: "auto", block: "center" });
    if (typeof responderButton.click !== "function") {
      setStatus("Não consegui acionar o botão “Responder”.", "error");
      return false;
    }

    state.lastAutoSubmitted = false;
    responderButton.click();
    const confirmed = await confirmSubmissionIfNeeded();
    if (!confirmed) return false;
    state.lastSubmitFingerprint = extracted.fingerprint;
    state.lastAutoSubmitted = true;
    state.collapsed = true;
    applyCollapsedState();
    await wait(250);
    return true;
  }

  async function confirmSubmissionIfNeeded() {
    let confirmButton = null;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      confirmButton = [...document.querySelectorAll("button")].find((button) => (
        PlurallFlowCore.isSubmissionConfirmationText(button.innerText) &&
        !button.disabled &&
        isElementVisible(button)
      )) || null;
      if (confirmButton) break;
      await wait(100);
    }

    if (!confirmButton) return true;
    confirmButton.click();
    for (let attempt = 0; attempt < 40 && isElementVisible(confirmButton); attempt += 1) {
      await wait(100);
    }
    if (isElementVisible(confirmButton)) {
      setStatus("A janela de confirmação não fechou. Clique em “Confirmar” manualmente.", "error");
      return false;
    }
    await wait(250);
    return true;
  }

  function buildRetryPlan(result, optionCount) {
    return PlurallFlowCore.buildRetryPlan(
      result?.option_index,
      result?.ranked_option_indices,
      optionCount,
      3,
    );
  }

  async function handleRetryModal() {
    if (state.retryInProgress) return "retrying";
    if (state.retryExhausted) return "exhausted";
    const visibleDialog = findVisibleDialog();
    if (visibleDialog && PlurallFlowCore.isTerminalWrongFeedback(visibleDialog.innerText || visibleDialog.textContent)) {
      state.retryExhausted = true;
      document.dispatchEvent(new CustomEvent("plurall-local-retries-exhausted", {
        detail: { terminalFeedback: true, attemptedOptionIndices: [...state.attemptedOptionIndices] },
      }));
      return "exhausted";
    }
    if (
      state.busy ||
      !state.autoSubmit
    ) return;

    const retryButton = findRetryControl();
    const extracted = extractQuestion();
    if (!extracted || extracted.type !== "multiple-choice") return;
    const visuallyWrongOptionIndices = extracted.optionElements
      .map((optionElement, index) => (inspectOptionOutcome(optionElement).wrong ? index : -1))
      .filter((index) => index >= 0);
    if (state.lastFingerprint) {
      if (!PlurallFlowCore.isRetryForCurrentQuestion({
        hasRetryControl: Boolean(retryButton),
        fingerprintMatches: extracted.fingerprint === state.lastFingerprint,
        urlMatches: currentQuestionUrl() === state.lastQuestionUrl,
      })) return;
    } else {
      if (!retryButton && !visuallyWrongOptionIndices.length) return;
      state.lastFingerprint = extracted.fingerprint;
      state.lastQuestionUrl = currentQuestionUrl();
    }
    visuallyWrongOptionIndices.forEach((index) => {
      if (!state.attemptedOptionIndices.includes(index)) {
        state.attemptedOptionIndices.push(index);
      }
    });
    const outcome = getAnswerOutcome(extracted);
    if (!PlurallFlowCore.shouldRetryAnswer({
      hasRetryButton: Boolean(retryButton),
      wrong: outcome.wrong,
      blockingDialog: Boolean(findVisibleDialog()),
    })) return;

    if (Number.isInteger(outcome.attemptedIndex) && !state.attemptedOptionIndices.includes(outcome.attemptedIndex)) {
      state.attemptedOptionIndices.push(outcome.attemptedIndex);
    }
    saveRetryMemory();
    const maximumAttempts = Math.min(3, extracted.options.length);
    if (state.attemptedOptionIndices.length >= maximumAttempts) {
      state.retryExhausted = true;
      document.dispatchEvent(new CustomEvent("plurall-local-retries-exhausted", {
        detail: { attemptedOptionIndices: [...state.attemptedOptionIndices] },
      }));
      return "exhausted";
    }

    state.retryInProgress = true;
    try {
      const fallbackPosition = PlurallFlowCore.nextUntriedRetryPosition(
        state.retryPlan,
        state.retryPosition,
        state.attemptedOptionIndices,
      );
      if (retryButton) {
        const dismissed = await dismissRetryDialog();
        if (!dismissed) {
          const message = "O aviso de resposta incorreta não fechou. A tentativa automática foi interrompida para não clicar atrás da janela.";
          setStatus(message, "error");
          document.dispatchEvent(new CustomEvent("plurall-local-analysis-error", {
            detail: { message },
          }));
          return false;
        }
      } else {
        await wait(120);
      }

      const retryNumber = state.attemptedOptionIndices.length;
      const previousPosition = state.retryPosition;
      state.lastSubmitFingerprint = null;
      state.lastAutoSubmitted = false;
      await wait(80);
      // Fluxo rápido: depois de uma resposta errada, usa o próximo item do
      // ranking que já foi calculado. A reanálise completa fica fora do ciclo
      // de tentativa para não deixar a fila aguardando o modelo novamente.
      let applied = false;
      if (fallbackPosition >= 0 && state.lastResult) {
        state.retryPosition = fallbackPosition;
        setStatus("Resposta incorreta. Tentando a próxima alternativa…", "neutral");
        applied = await applySuggestedOption();
      } else {
        setStatus("Não há outra alternativa disponível nesta análise.", "error");
      }
      if (!applied) state.retryPosition = previousPosition;
      document.dispatchEvent(new CustomEvent("plurall-local-retry-attempt", {
        detail: {
          applied,
          retryNumber,
          optionIndex: Number(state.retryPlan[state.retryPosition] ?? state.lastResult?.option_index),
        },
      }));
      return applied ? "retrying" : false;
    } finally {
      state.retryInProgress = false;
    }
  }

  async function reanalyzeWithoutWrongOptions() {
    const extracted = extractQuestion();
    if (!extracted || extracted.type !== "multiple-choice" || !matchesAnalyzedQuestion(extracted)) {
      throw new Error("Não consegui reencontrar a questão depois de fechar o aviso.");
    }
    const excludedOptionIndices = [...new Set(state.attemptedOptionIndices)]
      .filter((index) => Number.isInteger(index) && index >= 0 && index < extracted.options.length);
    const excludedLabels = excludedOptionIndices.map(indexToLabel).join(", ");
    setStatus(
      `Alternativa(s) ${excludedLabels} incorreta(s). Analisando novamente sem repetir…`,
      "neutral",
    );
    const response = await sendRuntimeMessage({
      type: "solve-question",
      payload: {
        question: extracted.question,
        source_material: extracted.sourceMaterial,
        options: extracted.options,
        image_descriptions: extracted.images,
        image_count: extracted.imageCount,
        image_data: await loadQuestionImages(extracted),
        excluded_option_indices: excludedOptionIndices,
      },
    });
    if (!response?.ok) throw new Error(response?.error || "Não foi possível analisar novamente.");

    const refreshed = extractQuestion() || extracted;
    state.lastFingerprint = refreshed.fingerprint;
    state.lastQuestionUrl = currentQuestionUrl();
    state.lastResult = response.result;
    state.retryPlan = buildRetryPlan(response.result, refreshed.options.length);
    const nextPosition = PlurallFlowCore.nextUntriedRetryPosition(
      state.retryPlan,
      -1,
      state.attemptedOptionIndices,
    );
    if (nextPosition < 0) throw new Error("O modelo não encontrou outra alternativa disponível.");
    state.retryPosition = nextPosition;
    state.retryExhausted = false;
    showResult(response.result, refreshed.locked, refreshed.type);
    return applySuggestedOption();
  }

  async function retryTimedOutAnswer() {
    if (state.retryInProgress) return "retrying";
    const extracted = extractQuestion();
    if (!extracted || extracted.type !== "multiple-choice" || !state.lastResult) return false;

    const selectedIndex = extracted.optionElements.findIndex(isOptionSelected);
    if (!Number.isInteger(selectedIndex) || selectedIndex < 0) return false;
    if (!state.attemptedOptionIndices.includes(selectedIndex)) {
      state.attemptedOptionIndices.push(selectedIndex);
      saveRetryMemory();
    }
    const maximumAttempts = Math.min(3, extracted.options.length);
    if (state.attemptedOptionIndices.length >= maximumAttempts) {
      state.retryExhausted = true;
      document.dispatchEvent(new CustomEvent("plurall-local-retries-exhausted", {
        detail: { attemptedOptionIndices: [...state.attemptedOptionIndices] },
      }));
      return "exhausted";
    }

    state.retryInProgress = true;
    try {
      const nextPosition = PlurallFlowCore.nextUntriedRetryPosition(
        state.retryPlan,
        state.retryPosition,
        state.attemptedOptionIndices,
      );
      if (nextPosition < 0 || !state.lastResult) return "exhausted";
      state.retryPosition = nextPosition;
      setStatus("O resultado não apareceu. Tentando a próxima alternativa…", "neutral");
      const applied = await applySuggestedOption();
      document.dispatchEvent(new CustomEvent("plurall-local-retry-attempt", {
        detail: {
          applied,
          retryNumber: state.attemptedOptionIndices.length,
          optionIndex: Number(state.retryPlan[state.retryPosition] ?? state.lastResult?.option_index),
        },
      }));
      return applied ? "retrying" : false;
    } catch (error) {
      setStatus(error?.message || "Não consegui tentar outra alternativa automaticamente.", "error");
      return false;
    } finally {
      state.retryInProgress = false;
    }
  }

  function findVisibleButton(label) {
    return findVisibleControl((value) => normalizeText(value) === label);
  }

  function findRetryControl() {
    const dialog = findVisibleDialog();
    return findVisibleControl(PlurallFlowCore.isRetryControlText, dialog || document)
      || (dialog ? findVisibleControl(PlurallFlowCore.isRetryControlText, document) : null);
  }

  function findVisibleControl(matchesLabel, root = document) {
    const selector = 'button, a, [role="button"], input[type="button"], input[type="submit"]';
    return [...root.querySelectorAll(selector)].find((element) => {
      const labels = [
        element.innerText,
        element.textContent,
        element.value,
        element.getAttribute("aria-label"),
        element.getAttribute("title"),
      ];
      const disabled = Boolean(element.disabled || element.getAttribute("aria-disabled") === "true");
      return !disabled && isElementVisible(element) && labels.some((value) => matchesLabel(value));
    }) || null;
  }

  async function dismissRetryDialog() {
    for (let clickAttempt = 0; clickAttempt < 3; clickAttempt += 1) {
      const control = findRetryControl();
      if (!control) return true;
      control.scrollIntoView?.({ behavior: "auto", block: "center" });
      control.focus?.({ preventScroll: true });
      control.click?.();

      for (let waitAttempt = 0; waitAttempt < 20; waitAttempt += 1) {
        await wait(100);
        if (!findRetryControl()) return true;
      }

      const remainingControl = findRetryControl();
      if (remainingControl) {
        for (const eventName of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
          const EventType = eventName.startsWith("pointer") && typeof PointerEvent === "function"
            ? PointerEvent
            : MouseEvent;
          remainingControl.dispatchEvent(new EventType(eventName, {
            bubbles: true,
            cancelable: true,
            view: window,
            button: 0,
          }));
        }
      }
      await wait(250);
    }
    return !findRetryControl();
  }

  function findVisibleDialog() {
    return [...document.querySelectorAll('[role="dialog"], [aria-modal="true"]')]
      .find(isElementVisible) || null;
  }

  function isElementVisible(element) {
    if (!element || !element.getClientRects().length || element.closest('[aria-hidden="true"]')) return false;
    const style = getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity || 1) > 0.05;
  }

  function getAnswerOutcome(extracted = extractQuestion()) {
    if (!extracted || extracted.type !== "multiple-choice") return { selected: false, correct: false, wrong: false };
    const attemptedIndex = Number(state.retryPlan[state.retryPosition] ?? state.lastResult?.option_index);
    const attemptedOption = Number.isInteger(attemptedIndex)
      ? extracted.optionElements[attemptedIndex]
      : null;
    const attemptedOutcome = inspectOptionOutcome(attemptedOption);
    if (attemptedOutcome.correct || attemptedOutcome.wrong) {
      return { ...attemptedOutcome, selected: isOptionSelected(attemptedOption), attemptedIndex };
    }

    const selectedOption = extracted.optionElements.find(isOptionSelected);
    if (selectedOption) return { ...inspectOptionOutcome(selectedOption), selected: true };

    if (!attemptedOption) {
      const visuallyAnswered = extracted.optionElements
        .map((optionElement, index) => ({ index, outcome: inspectOptionOutcome(optionElement) }))
        .find((item) => item.outcome.correct || item.outcome.wrong);
      if (visuallyAnswered) return { ...visuallyAnswered.outcome, selected: false, attemptedIndex: visuallyAnswered.index };
    }
    return { selected: false, correct: false, wrong: false };
  }

  function inspectOptionOutcome(optionElement) {
    if (!optionElement) return { correct: false, wrong: false };
    const nodes = [optionElement, ...optionElement.querySelectorAll("*")].slice(0, 50);
    const signals = nodes.map((node) => [
      node.className,
      node.id,
      node.getAttribute?.("data-test-id"),
      node.getAttribute?.("aria-label"),
      node.getAttribute?.("title"),
    ].map(String).join(" ")).join(" ");
    const colorValues = nodes.flatMap((node) => {
      const style = getComputedStyle(node);
      return [style.color, style.backgroundColor, style.borderColor];
    });
    return PlurallFlowCore.classifyOptionOutcome(signals, colorValues);
  }

  function isOptionSelected(optionElement) {
    const target = optionElement?.querySelector('[data-test-id="option"]') || optionElement;
    const classes = String(target?.className || "");
    return (
      /(?:^|[_-])(selected|right|correct)(?:[_-]|$)/i.test(classes) ||
      /Alternativa selecionada/i.test(optionElement?.innerText || "") ||
      target?.getAttribute?.("aria-checked") === "true" ||
      Boolean(optionElement?.querySelector('input[type="radio"]:checked'))
    );
  }

  function setTextFieldValue(field, value) {
    const prototype = field instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
    if (setter) setter.call(field, value);
    else field.value = value;
    try {
      field.dispatchEvent(new InputEvent("input", {
        bubbles: true,
        inputType: "insertText",
        data: value,
      }));
    } catch {
      field.dispatchEvent(new Event("input", { bubbles: true }));
    }
    field.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function wait(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  }

  function refreshAvailability() {
    const extracted = extractQuestion();
    ui.analyze.disabled = state.busy || !extracted;
    if (!extracted) {
      setStatus("Abra uma questão de múltipla escolha ou aberta para começar.");
      clearResult();
      return;
    }
    if (state.lastFingerprint && !matchesAnalyzedQuestion(extracted)) clearResult();
    if (!state.busy && !state.lastResult) {
      setStatus(
        extracted.locked
          ? "Questão encontrada, mas sem tentativas restantes."
          : extracted.type === "open"
            ? "Questão aberta encontrada. Pronta para analisar."
            : "Questão de múltipla escolha encontrada. Pronta para analisar.",
      );
    }
  }

  function schedulePageScan(delay) {
    clearTimeout(state.scanTimer);
    state.scanTimer = setTimeout(async () => {
      await handleRetryModal();
      const extracted = extractQuestion();
      refreshAvailability();
      if (
        state.autoAnalyze &&
        !globalThis.__plurallModuleQueueActive &&
        extracted &&
        !state.busy &&
        !matchesAnalyzedQuestion(extracted)
      ) {
        analyzeCurrentQuestion(true);
      }
    }, delay);
  }

  function clearResult() {
    state.lastFingerprint = null;
    state.lastQuestionUrl = null;
    state.lastResult = null;
    state.lastSubmitFingerprint = null;
    state.retryPlan = [];
    state.retryPosition = 0;
    state.attemptedOptionIndices = [];
    state.retryInProgress = false;
    state.retryExhausted = false;
    ui.result.classList.remove("visible");
    ui.openResponse.classList.remove("visible");
    ui.openResponse.textContent = "";
    ui.apply.disabled = true;
  }

  function applyCollapsedState() {
    ui.panel.classList.toggle("collapsed", state.collapsed);
    ui.collapse.textContent = state.collapsed ? "+" : "−";
    ui.collapse.title = state.collapsed ? "Expandir painel" : "Recolher painel";
    ui.collapse.setAttribute("aria-label", ui.collapse.title);
  }

  function setStatus(message, tone = "neutral") {
    ui.status.textContent = message;
    ui.status.dataset.tone = tone;
  }

  function sendRuntimeMessage(message) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("O Ollama não respondeu em 110 segundos. Confira se ele está aberto e se o modelo qwen2.5vl:7b terminou de carregar; a fila tentará novamente."));
      // O caminho de baixa confiança pode fazer uma segunda chamada ao modelo.
      // Damos tempo para a resposta principal e a revisão, mas nunca aguardamos indefinidamente.
      }, 110_000);
      chrome.runtime.sendMessage(message, (response) => {
        clearTimeout(timeout);
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve(response);
      });
    });
  }

  function cleanQuestionText(value) {
    return value
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .filter((line) => !/^TENTATIVAS RESTANTES:\s*\d+$/i.test(line))
      .filter((line) => !/^\d+\s+tentativas? restantes?$/i.test(line))
      .filter((line) => !/^(GABARITO|Responder)$/i.test(line))
      .filter((line) => !/^Caracteres:\s*\d+$/i.test(line))
      .filter((line) => !/^Mínimo de \d+ caracteres$/i.test(line))
      .filter((line) => !/^Ou envie uma foto da sua resposta!/i.test(line))
      .filter((line) => !/^(Selecione um arquivo|Adicionar imagem)$/i.test(line))
      .filter((line) => !/^Imagens? JPG, JPEG ou PNG/i.test(line))
      .join("\n")
      .trim()
      .slice(0, 60_000);
  }

  function splitQuestionContext(questionText) {
    const lines = String(questionText || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    // Em atividades de leitura o comando costuma aparecer depois do texto-base.
    // Mantemos o comando e o material separados, sem descartar nada quando esse
    // padrão não estiver presente.
    const commandIndex = lines.findIndex((line) => /^(?:assinale|marque|indique|selecione|leia|analise|a partir|com base|segundo|considerando|sobre o texto|no texto|qual |em relação|de acordo)/i.test(line));
    if (commandIndex > 0) {
      return {
        sourceMaterial: lines.slice(0, commandIndex).join("\n").slice(0, 50_000),
        command: lines.slice(commandIndex).join("\n").slice(0, 10_000),
      };
    }
    return { sourceMaterial: "", command: String(questionText || "").slice(0, 60_000) };
  }

  function normalizeText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function currentQuestionUrl() {
    return location.href.replace(/[?#].*$/, "").replace(/\/+$/, "");
  }

  function restoreRetryMemory(memory) {
    if (!memory || String(memory.url || "") !== currentQuestionUrl()) return;
    if (Date.now() - Number(memory.savedAt || 0) > 30 * 60_000) return;
    state.attemptedOptionIndices = Array.isArray(memory.attemptedOptionIndices)
      ? [...new Set(memory.attemptedOptionIndices.map(Number).filter(Number.isInteger))]
      : [];
  }

  function saveRetryMemory() {
    chrome.storage.local.set({
      [RETRY_MEMORY_KEY]: {
        url: currentQuestionUrl(),
        attemptedOptionIndices: [...new Set(state.attemptedOptionIndices)],
        savedAt: Date.now(),
      },
    });
  }

  function matchesAnalyzedQuestion(extracted) {
    return Boolean(
      extracted &&
      state.lastFingerprint &&
      (
        extracted.fingerprint === state.lastFingerprint ||
        (state.lastQuestionUrl && currentQuestionUrl() === state.lastQuestionUrl)
      )
    );
  }

  function indexToLabel(index) {
    return String.fromCharCode(65 + Number(index || 0));
  }

  function hashText(value) {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16);
  }

  globalThis.__plurallLocalAssistant = {
    analyzeCurrentQuestion,
    applySuggestedOption,
    extractQuestion,
    getAnswerOutcome,
    hasResult: () => Boolean(state.lastResult),
    retryWrongAnswer: handleRetryModal,
    retryTimedOutAnswer,
    isBusy: () => state.busy || state.retryInProgress,
    wasLastAutoSubmitted: () => state.lastAutoSubmitted,
  };
})();

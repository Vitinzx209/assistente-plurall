(async () => {
  const licenseReady = globalThis.__plurallLicenseReady;
  if (licenseReady && !(await licenseReady)) return;
  const STORAGE_KEY = "plurallModuleQueue";
  const POSITION_KEY = "queuePanelPosition";
  const ASSISTANT_HOST_ID = "plurall-assistente-local-host";
  const QUEUE_HOST_ID = "plurall-module-queue-host";
  const AUTO_MARK_THRESHOLD = 0;
  const RESULT_POLL_INTERVAL_MS = 350;
  const SUBMIT_RESULT_TIMEOUT_MS = 6000;
  const QUEUE_VERSION = 8;

  if (document.getElementById(QUEUE_HOST_ID)) return;

  const runtime = {
    queue: null,
    modules: [],
    selectedModuleIds: new Set(),
    includeComplementary: false,
    onlyComplementary: false,
    processing: false,
    advancing: false,
    navigating: false,
    navigationTimer: null,
    navigationWatchdog: null,
    navigationTarget: null,
    navigationRetryCount: 0,
    scanTimer: null,
    processWatchdog: null,
    pageAttempts: 0,
    studyAbsenceChecks: 0,
    panelPosition: null,
    dragState: null,
    selectorPanelScrollTop: 0,
    selectorListScrollTop: 0,
    selectorMessage: "",
  };

  const host = document.createElement("div");
  host.id = QUEUE_HOST_ID;
  host.style.all = "initial";
  host.style.position = "fixed";
  host.style.left = "72px";
  host.style.top = "72px";
  host.style.zIndex = "2147483646";
  document.documentElement.appendChild(host);

  const shadow = host.attachShadow({ mode: "open" });
  function isQueuedTask(task) {
    const title = task?.title || "";
    return runtime.onlyComplementary
      ? PlurallFlowCore.isComplementaryTaskTitle(title)
      : PlurallFlowCore.isSupportedTaskTitle(title, runtime.includeComplementary);
  }
  shadow.innerHTML = `
    <style>
      :host { all: initial; }
      * { box-sizing: border-box; }
      .panel {
        width: min(390px, calc(100vw - 32px));
        max-height: min(720px, calc(100vh - 40px));
        overflow: auto;
        padding: 15px;
        border: 1px solid rgba(124, 58, 237, .26);
        border-radius: 15px;
        color: #2b2340;
        background: rgba(255, 255, 255, .98);
        box-shadow: 0 16px 45px rgba(91, 33, 182, .22);
        font: 13px/1.4 Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      h2 { margin: 0; color: #5b21b6; font-size: 16px; }
      .drag-handle { display: flex; align-items: center; justify-content: space-between; gap: 12px; cursor: grab; touch-action: none; user-select: none; }
      .drag-handle:active { cursor: grabbing; }
      .drag-label { color: #7c3aed; font-size: 10px; font-weight: 750; }
      .subtitle { margin: 5px 0 12px; color: #6b6475; font-size: 11px; }
      .notice { margin: 10px 0; padding: 9px 10px; border-radius: 9px; background: #faf5ff; color: #5b21b6; }
      .notice.error { background: #fff1f2; color: #9f1239; }
      .modules { display: grid; gap: 7px; max-height: 390px; overflow: auto; padding-right: 3px; }
      .module { display: grid; grid-template-columns: auto 1fr; gap: 8px; padding: 9px; border: 1px solid #ede9fe; border-radius: 9px; cursor: pointer; }
      .module:hover { border-color: #c4b5fd; background: #faf5ff; }
      .module input { margin-top: 3px; accent-color: #7c3aed; }
      .discipline { display: block; font-weight: 750; color: #3b2760; }
      .module-name { display: block; margin-top: 2px; color: #625a70; font-size: 11px; }
      .count { display: block; margin-top: 4px; color: #7c3aed; font-size: 10px; font-weight: 700; }
      .buttons { display: flex; gap: 7px; margin-top: 10px; }
      button { appearance: none; border: 0; border-radius: 9px; padding: 9px 10px; cursor: pointer; font: inherit; font-weight: 750; }
      button.primary { flex: 1; color: #fff; background: linear-gradient(135deg, #7c3aed, #9333ea); }
      button.secondary { color: #5b21b6; background: #f3e8ff; }
      button.danger { color: #9f1239; background: #ffe4e6; }
      button:disabled { cursor: not-allowed; opacity: .5; }
      .progress { margin-top: 11px; }
      .bar { height: 7px; overflow: hidden; border-radius: 99px; background: #e5e7eb; }
      .fill { height: 100%; background: linear-gradient(90deg, #7c3aed, #9333ea); transition: width .25s ease; }
      .stats { display: flex; justify-content: space-between; gap: 8px; margin-top: 6px; color: #6b6475; font-size: 11px; }
      .empty { padding: 14px 8px; color: #6b6475; text-align: center; }
    </style>
    <section id="panel" class="panel"></section>
  `;

  const panel = shadow.getElementById("panel");
  panel.addEventListener("change", onPanelChange);
  panel.addEventListener("click", onPanelClick);
  panel.addEventListener("pointerdown", startPanelDrag);
  window.addEventListener("pointermove", movePanelDrag);
  window.addEventListener("pointerup", finishPanelDrag);
  window.addEventListener("pointercancel", finishPanelDrag);
  window.addEventListener("resize", () => runtime.panelPosition && applyPanelPosition(runtime.panelPosition));

  document.addEventListener("plurall-local-analysis-complete", onAnalysisComplete);
  document.addEventListener("plurall-local-analysis-error", onAnalysisError);
  document.addEventListener("plurall-local-retries-exhausted", onRetriesExhausted);
  document.addEventListener("plurall-local-retry-attempt", onRetryAttempt);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes[POSITION_KEY]) {
      runtime.panelPosition = normalizePanelPosition(changes[POSITION_KEY].newValue);
      if (runtime.panelPosition) requestAnimationFrame(() => applyPanelPosition(runtime.panelPosition));
    }
    if (changes[STORAGE_KEY]) {
      runtime.queue = normalizeQueueState(changes[STORAGE_KEY].newValue || null);
      globalThis.__plurallModuleQueueActive = Boolean(runtime.queue?.active);
      render();
    }
  });

  const observer = new MutationObserver(() => scheduleProcess(RESULT_POLL_INTERVAL_MS));
  observer.observe(document.documentElement, { childList: true, subtree: true });

  loadQueue().then(() => {
    prepareForPage();
    scheduleProcess(350);
    runtime.processWatchdog = setInterval(() => {
      if (runtime.queue?.active && !runtime.processing && !runtime.navigating) {
        void processCurrentPage();
      }
    }, RESULT_POLL_INTERVAL_MS);
  });
  window.addEventListener("pagehide", () => {
    if (runtime.processWatchdog) clearInterval(runtime.processWatchdog);
  }, { once: true });

  async function loadQueue() {
    const saved = await storageGet([STORAGE_KEY, POSITION_KEY]);
    const originalQueue = saved?.[STORAGE_KEY] || null;
    runtime.queue = normalizeQueueState(originalQueue);
    runtime.panelPosition = normalizePanelPosition(saved?.[POSITION_KEY]);
    if (runtime.queue && runtime.queue !== originalQueue) await storageSet({ [STORAGE_KEY]: runtime.queue });
    globalThis.__plurallModuleQueueActive = Boolean(runtime.queue?.active);
  }

  function prepareForPage() {
    const materialPage = getPageKind() === "material";
    const assistantHost = document.getElementById(ASSISTANT_HOST_ID);
    if (assistantHost) assistantHost.style.display = materialPage ? "none" : "block";
    if (runtime.panelPosition) {
      requestAnimationFrame(() => applyPanelPosition(runtime.panelPosition));
    } else {
      host.style.left = materialPage ? "auto" : "72px";
      host.style.right = materialPage ? "20px" : "auto";
      host.style.top = materialPage ? "auto" : "20px";
      host.style.bottom = materialPage ? "20px" : "auto";
    }
    render();
  }

  function scheduleProcess(delay) {
    clearTimeout(runtime.scanTimer);
    runtime.scanTimer = setTimeout(processCurrentPage, delay);
  }

  async function processCurrentPage() {
    if (runtime.processing || runtime.navigating) return;
    runtime.processing = true;
    try {
      const kind = getPageKind();
      if (kind === "material") {
        scanModules();
        render();
        return;
      }

      if (!runtime.queue?.active) {
        render();
        return;
      }

      if (runtime.queue.studyStepPending) {
        await processStudyStepPage(kind);
        return;
      }

      if (kind === "task") {
        await processTaskPage();
      } else if (kind === "exercise") {
        await processExercisePage();
      } else {
        await updateQueue({
          message: "Retornando automaticamente para a fila…",
          tone: "neutral",
        });
        resumeQueue();
      }
    } finally {
      runtime.processing = false;
    }
  }

  function scanModules() {
    const found = [...document.querySelectorAll('[class*="TaskGroup-module_task-group"]')]
      .map((group, moduleOrder) => extractModule(group, moduleOrder))
      .filter((module) => module.tasks.length);
    const byId = new Map(runtime.modules.map((module) => [module.id, module]));
    for (const module of found) byId.set(module.id, module);
    runtime.modules = [...byId.values()].sort((first, second) => (
      Number(first.moduleOrder ?? Number.MAX_SAFE_INTEGER) - Number(second.moduleOrder ?? Number.MAX_SAFE_INTEGER)
    ));
  }

  function extractModule(group, moduleOrder = 0) {
    const moduleElement = [...group.querySelectorAll("p")]
      .find((element) => /^Módulo\s*-/i.test(normalizeText(element.textContent)));
    const moduleName = normalizeText(moduleElement?.textContent);
    const headerLines = (group.querySelector("header")?.innerText || "")
      .split(/\r?\n/)
      .map(normalizeText)
      .filter(Boolean);
    const discipline = headerLines.find((line) => !/^Módulo\s*-/i.test(line)) || "Matéria";
    const tasks = uniqueBy(
      [...group.querySelectorAll('a[href*="/tarefa/"]')]
        .map((link, taskOrder) => ({
          url: cleanUrl(link.href || link.dataset.href),
          title: normalizeTaskTitle(link.innerText),
          module: moduleName,
          discipline,
          moduleOrder,
          taskOrder,
        }))
        .filter((task) => PlurallFlowCore.isSupportedTaskTitle(task.title, true)),
      (task) => task.url,
    );
    const id = hashText(`${discipline}|${moduleName}|${tasks[0]?.url || ""}`);
    return { id, discipline, moduleName, moduleOrder, tasks };
  }

  async function processTaskPage() {
    const queue = runtime.queue;
    const expectedTask = queue.tasks?.[queue.taskIndex];
    if (!expectedTask) {
      await finishQueue();
      return;
    }

    if (!sameUrl(location.href, expectedTask.url)) {
      await updateQueue({
        message: "Abrindo novamente a Tarefa Mínima esperada…",
        tone: "neutral",
      });
      navigateTo(expectedTask.url, 400);
      return;
    }

    const allExerciseLinks = [...document.querySelectorAll('a[href*="/exercicio/"], [data-href*="/exercicio/"]')]
      .filter((link, index, links) => links.findIndex((candidate) => cleanUrl(candidate.href || candidate.dataset.href) === cleanUrl(link.href || link.dataset.href)) === index);
    if (!allExerciseLinks.length && runtime.pageAttempts < 20) {
      runtime.pageAttempts += 1;
      scheduleProcess(900);
      return;
    }
    runtime.pageAttempts = 0;

    const pending = allExerciseLinks
      .filter((link) => {
        const status = link.querySelector('[data-test-id="exercise-card-status"]');
        const classes = `${status?.className || ""} ${status?.firstElementChild?.className || ""} ${status?.querySelector('[data-test-id="exercise-card-wrapper"]')?.className || ""} ${link.className || ""} ${link.innerText || link.textContent || ""}`;
        return PlurallFlowCore.shouldIncludeExerciseCard(classes);
      })
      .map((link) => cleanUrl(link.href || link.dataset.href));

    if (!pending.length) {
      if (!hasStudyReadingSection()) {
        if (runtime.studyAbsenceChecks < 4) {
          runtime.studyAbsenceChecks += 1;
          scheduleProcess(600);
          return;
        }
        runtime.studyAbsenceChecks = 0;
        await advanceTask("Esta tarefa não possui a etapa “Leia o texto”. Avançando…");
        return;
      }
      runtime.studyAbsenceChecks = 0;
      await beginStudyStep("Exercícios concluídos. Verificando se a leitura está verde…");
      return;
    }
    runtime.studyAbsenceChecks = 0;

    const next = {
      ...queue,
      exercises: pending,
      exerciseIndex: 0,
      lastAnalyzedUrl: null,
      waitingForSubmit: false,
      analysisRetryCount: 0,
      message: `Abrindo ${pending.length} exercício(s) pendente(s)…`,
      tone: "neutral",
    };
    await saveQueue(next);
    navigateTo(pending[0], 450);
  }

  async function beginStudyStep(message) {
    const queue = runtime.queue;
    const taskUrl = queue.tasks?.[queue.taskIndex]?.url;
    if (!taskUrl) {
      await advanceTask("A tarefa não possui uma página de leitura.");
      return;
    }
    const next = {
      ...queue,
      exercises: [],
      exerciseIndex: 0,
      lastAnalyzedUrl: null,
      waitingForSubmit: false,
      analysisRetryCount: 0,
      studyStepPending: true,
      studyStepAttempts: 0,
      studyDirectRouteAttempted: false,
      studyRouteRequested: false,
      studyPageOpened: false,
      studyResourceAttempts: 0,
      studyDocumentOpened: false,
      studyDocumentOpenedAt: 0,
      studyAwaitingCompletionCheck: false,
      studyCompletionChecks: 0,
      studyReadingPaused: false,
      studyCompletedTaskUrl: null,
      studyCompletionVerified: false,
      message,
      tone: "neutral",
    };
    await saveQueue(next);
    navigateTo(taskUrl, 700);
  }

  async function processStudyStepPage(kind) {
    const queue = runtime.queue;
    const expectedTask = queue.tasks?.[queue.taskIndex];
    if (!expectedTask) {
      await finishQueue();
      return;
    }

    if (queue.studyReadingPaused) {
      render();
      return;
    }

    if (isStudyDocumentViewer()) {
      const openedAt = Number(queue.studyDocumentOpenedAt || 0);
      if (!queue.studyDocumentOpened || !openedAt) {
        runtime.pageAttempts = 0;
        await updateQueue({
          studyDocumentOpened: true,
          studyDocumentOpenedAt: Date.now(),
          message: "Apostila aberta. Aguardando o leitor terminar de carregar…",
          tone: "neutral",
        });
        scheduleProcess(1600);
        return;
      }
      if (Date.now() - openedAt < 1500) {
        scheduleProcess(500);
        return;
      }
      const exitControl = findExitControl();
      await returnFromStudyDocument(
        exitControl,
        exitControl
          ? "Apostila aberta. Saindo para confirmar a barra verde…"
          : "Apostila aberta. Voltando ao resumo para confirmar a barra verde…",
      );
      return;
    }

    const resourceControl = (kind === "reading" || queue.studyRouteRequested)
      ? findStudyResourceControl(kind === "reading")
      : null;
    if (resourceControl && Number(queue.studyResourceAttempts || 0) < 3) {
      const resourceAttempts = Number(queue.studyResourceAttempts || 0) + 1;
      runtime.pageAttempts = 0;
      await updateQueue({
        studyPageOpened: true,
        studyResourceAttempts: resourceAttempts,
        message: `Abrindo uma apostila da leitura (${resourceAttempts}/3)…`,
        tone: "neutral",
      });
      resourceControl.scrollIntoView?.({ behavior: "auto", block: "center" });
      activateElement(resourceControl);
      scheduleProcess(1300);
      return;
    }

    if (kind === "reading") {
      if (!queue.studyPageOpened) {
        runtime.pageAttempts = 0;
        await updateQueue({
          studyPageOpened: true,
          message: "A etapa de leitura abriu. Procurando uma apostila…",
          tone: "neutral",
        });
        scheduleProcess(350);
        return;
      }

      if (runtime.pageAttempts < 30) {
        runtime.pageAttempts += 1;
        scheduleProcess(500);
      } else {
        runtime.pageAttempts = 0;
        await pauseStudyReading(
          "A etapa de leitura abriu, mas nenhuma apostila carregou. Tente a leitura novamente.",
        );
      }
      return;
    }

    if (kind !== "task" && Number(queue.studyResourceAttempts || 0) > 0 && runtime.pageAttempts < 30) {
      runtime.pageAttempts += 1;
      scheduleProcess(500);
      return;
    }

    if (kind !== "task" || !sameUrl(location.href, expectedTask.url)) {
      await updateQueue({ message: "Retornando ao resumo para abrir a leitura…", tone: "neutral" });
      navigateTo(expectedTask.url, 400);
      return;
    }

    const readingControl = findStudyReadingControl();
    if (!readingControl) {
      if (!hasStudyReadingSection()) {
        if (runtime.studyAbsenceChecks < 4) {
          runtime.studyAbsenceChecks += 1;
          scheduleProcess(600);
          return;
        }
        runtime.studyAbsenceChecks = 0;
        await skipStudyStep("Esta tarefa não possui a etapa “Leia o texto”. Avançando…");
        return;
      }
      runtime.studyAbsenceChecks = 0;
      if (runtime.pageAttempts < 10) {
        runtime.pageAttempts += 1;
        scheduleProcess(600);
        return;
      }

      runtime.pageAttempts = 0;
      const fallbackUrl = PlurallFlowCore.buildStudyReadingUrl(expectedTask.url);
      if (fallbackUrl && !queue.studyDirectRouteAttempted) {
        await updateQueue({
          studyDirectRouteAttempted: true,
          studyRouteRequested: true,
          studyStepAttempts: Number(queue.studyStepAttempts || 0) + 1,
          message: "O cartão de leitura não apareceu. Tentando a rota direta da tarefa…",
          tone: "neutral",
        });
        openStudyReading(null, fallbackUrl);
        return;
      }

      if (queue.studyDirectRouteAttempted && queue.studyRouteRequested) {
        await pauseStudyReading(
          "O Plurall voltou ao resumo, mas não mostrou uma barra verde de leitura.",
        );
        return;
      }

      await pauseStudyReading("Não encontrei o cartão de leitura para confirmar a barra verde.");
      return;
    }

    runtime.pageAttempts = 0;
    runtime.studyAbsenceChecks = 0;
    if (isStudyReadingControlCompleted(readingControl)) {
      await finishStudyStep(
        null,
        "Leitura confirmada: o indicador ficou verde. Avançando…",
        true,
      );
      return;
    }

    if (queue.studyAwaitingCompletionCheck) {
      const completionChecks = Number(queue.studyCompletionChecks || 0) + 1;
      if (completionChecks < 3) {
        await updateQueue({
          studyStepAttempts: 0,
          studyDirectRouteAttempted: false,
          studyRouteRequested: true,
          studyPageOpened: false,
          studyResourceAttempts: 0,
          studyDocumentOpened: false,
          studyDocumentOpenedAt: 0,
          studyAwaitingCompletionCheck: false,
          studyCompletionChecks: completionChecks,
          message: `A barra continua cinza. Reabrindo a apostila (${completionChecks + 1}/3)…`,
          tone: "neutral",
        });
        openStudyReading(readingControl);
        return;
      }
      await pauseStudyReading(
        "A apostila abriu, mas a barra de leitura não ficou verde após três verificações.",
      );
      return;
    }

    const attempts = Number(queue.studyStepAttempts || 0) + 1;
    if (attempts > 6) {
      await pauseStudyReading(
        "Cliquei em “Leia o texto” seis vezes, mas o Plurall voltou ao resumo e a barra continuou cinza.",
      );
      return;
    }
    await updateQueue({
      studyStepAttempts: attempts,
      studyRouteRequested: true,
      message: `Clicando em “Leia o texto para responder às questões” (${attempts}/6)…`,
      tone: "neutral",
    });
    readingControl.scrollIntoView?.({ behavior: "auto", block: "center" });
    openStudyReading(readingControl);
  }

  function openStudyReading(readingControl, fallbackUrl = null) {
    clearTimeout(runtime.scanTimer);
    const sourceUrl = cleanUrl(location.href);
    const link = readingControl?.matches?.("a[href]")
      ? readingControl
      : readingControl?.closest?.("a[href]");
    const rawHref = link?.href || readingControl?.getAttribute?.("data-href") || fallbackUrl;
    setTimeout(() => {
      if (readingControl) {
        readingControl.scrollIntoView?.({ behavior: "auto", block: "center" });
        activateStudyReadingControl(readingControl);
      } else if (rawHref) {
        location.assign(new URL(rawHref, location.href).href);
      }
      setTimeout(() => {
        if (readingControl && rawHref && sameUrl(location.href, sourceUrl)) {
          if (isStudyDocumentViewer() || findStudyResourceControl(false)) {
            scheduleProcess(250);
            return;
          }
          location.assign(new URL(rawHref, location.href).href);
          return;
        }
        scheduleProcess(250);
      }, 900);
    }, 150);
  }

  async function returnFromStudyDocument(exitControl, message) {
    const queue = runtime.queue;
    const taskUrl = queue.tasks?.[queue.taskIndex]?.url;
    await saveQueue({
      ...queue,
      studyAwaitingCompletionCheck: true,
      message,
      tone: "neutral",
    });
    if (exitControl) {
      exitControl.scrollIntoView?.({ behavior: "auto", block: "center" });
      exitControl.click();
      await wait(450);
    }
    navigateTo(taskUrl, 250);
  }

  async function pauseStudyReading(message) {
    await updateQueue({
      studyReadingPaused: true,
      message,
      tone: "error",
    });
  }

  async function skipStudyStep(message) {
    const queue = runtime.queue;
    await saveQueue({
      ...queue,
      studyStepPending: false,
      studyStepAttempts: 0,
      studyDirectRouteAttempted: false,
      studyRouteRequested: false,
      studyPageOpened: false,
      studyResourceAttempts: 0,
      studyDocumentOpened: false,
      studyDocumentOpenedAt: 0,
      studyAwaitingCompletionCheck: false,
      studyCompletionChecks: 0,
      studyReadingPaused: false,
      studyCompletedTaskUrl: null,
      studyCompletionVerified: false,
      message,
      tone: "neutral",
    });
    await advanceTask(message);
  }

  async function finishStudyStep(exitControl, message, verified) {
    const queue = runtime.queue;
    const taskUrl = queue.tasks?.[queue.taskIndex]?.url;
    await saveQueue({
      ...queue,
      studyStepPending: false,
      studyStepAttempts: 0,
      studyDirectRouteAttempted: false,
      studyRouteRequested: false,
      studyPageOpened: false,
      studyResourceAttempts: 0,
      studyDocumentOpened: false,
      studyDocumentOpenedAt: 0,
      studyAwaitingCompletionCheck: false,
      studyCompletionChecks: 0,
      studyReadingPaused: false,
      studyCompletedTaskUrl: verified ? (taskUrl || null) : null,
      studyCompletionVerified: Boolean(verified),
      message,
      tone: verified ? "success" : "error",
    });
    if (exitControl) {
      exitControl.scrollIntoView?.({ behavior: "auto", block: "center" });
      exitControl.click();
      await wait(350);
    }
    await advanceTask(message);
  }

  function findStudyReadingControl() {
    const textElement = [...document.querySelectorAll("span, p, h1, h2, h3, h4, div")]
      .filter((element) => (
        isVisibleElement(element) &&
        PlurallFlowCore.isStudyReadingControlText(element.innerText || element.textContent)
      ))
      .sort((first, second) => {
        const firstArea = first.getBoundingClientRect().width * first.getBoundingClientRect().height;
        const secondArea = second.getBoundingClientRect().width * second.getBoundingClientRect().height;
        return firstArea - secondArea;
      })[0];
    if (textElement) return textElement;

    const directLink = [...document.querySelectorAll('a[href*="/leitura/"], [data-href*="/leitura/"]')]
      .find(isVisibleElement);
    if (directLink) return directLink;

    const controlSelector = 'a, button, [role="button"], [tabindex], [data-test-id]';
    const labeledControl = [...document.querySelectorAll(controlSelector)].find((element) => {
      const labels = [
        element.innerText,
        element.textContent,
        element.getAttribute("aria-label"),
        element.getAttribute("title"),
      ];
      return isVisibleElement(element) && labels.some(PlurallFlowCore.isStudyReadingControlText);
    });
    if (labeledControl) return labeledControl;

    return null;
  }

  function hasStudyReadingSection() {
    const readingLinks = [...document.querySelectorAll('a[href*="/leitura/"], [data-href*="/leitura/"]')];
    if (readingLinks.some(isVisibleElement)) return true;
    const headings = [...document.querySelectorAll("h1, h2, h3, h4, h5, [role=heading]")];
    if (headings.some((element) => (
      isVisibleElement(element) && PlurallFlowCore.isStudySectionTitle(element.textContent)
    ))) return true;
    const possibleControls = [...document.querySelectorAll('a, button, [role="button"], [tabindex], [data-test-id]')];
    return possibleControls.some((element) => {
      const labels = [
        element.innerText,
        element.textContent,
        element.getAttribute("aria-label"),
        element.getAttribute("title"),
      ];
      return isVisibleElement(element) && labels.some(PlurallFlowCore.isStudyReadingControlText);
    });
  }

  function isStudyReadingControlCompleted(readingControl) {
    if (!readingControl) return false;
    const card = readingControl.closest?.('a[href*="/leitura/"], [data-href*="/leitura/"]') || readingControl;
    const elements = [card, ...card.querySelectorAll("*")];
    const statusSignals = elements.map((element) => [
      element.className,
      element.getAttribute?.("data-status"),
      element.getAttribute?.("data-state"),
      element.getAttribute?.("aria-label"),
    ].filter(Boolean).join(" ")).join(" ");
    const colorValues = [];
    for (const element of elements) {
      if (!element.getClientRects?.().length) continue;
      for (const pseudo of [null, "::before", "::after"]) {
        const style = getComputedStyle(element, pseudo);
        colorValues.push(style.backgroundColor, style.borderColor, style.color);
      }
    }
    return PlurallFlowCore.isStudyReadingCompleted(statusSignals, colorValues);
  }

  function isStudyDocumentViewer() {
    const viewerElement = document.querySelector([
      'iframe[src*="pdf" i]',
      'iframe[title*="livro" i]',
      'iframe[title*="apostila" i]',
      'embed[type*="pdf" i]',
      'object[type*="pdf" i]',
      '[class*="pdfViewer" i]',
      '[class*="documentViewer" i]',
      '[data-test-id*="reader" i]',
      '[data-testid*="reader" i]',
    ].join(","));
    return Boolean(viewerElement) || PlurallFlowCore.looksLikeStudyViewerText(document.body?.innerText);
  }

  function findStudyResourceControl(allowImageFallback = true) {
    const selector = 'a[href], button, [role="button"], [tabindex], [data-test-id], [data-testid]';
    const controls = [...document.querySelectorAll(selector)].filter((element) => {
      if (!isVisibleElement(element) || element.closest(`#${ASSISTANT_HOST_ID}, #${QUEUE_HOST_ID}`)) return false;
      const labels = [
        element.innerText,
        element.textContent,
        element.getAttribute("aria-label"),
        element.getAttribute("title"),
      ];
      return labels.some(PlurallFlowCore.isStudyResourceControlText);
    });
    if (controls.length) return controls[0];
    if (!allowImageFallback) return null;

    return [...document.querySelectorAll([
      'main a[href]',
      'main button',
      '[role="main"] a[href]',
      '[role="main"] button',
      'article a[href]',
      'article button',
    ].join(","))].find((element) => {
      if (!isVisibleElement(element) || element.closest(`#${ASSISTANT_HOST_ID}, #${QUEUE_HOST_ID}`)) return false;
      const rect = element.getBoundingClientRect();
      return Boolean(element.querySelector("img")) && rect.width >= 100 && rect.height >= 60;
    }) || null;
  }

  function activateElement(element) {
    element.focus?.({ preventScroll: true });
    if (typeof element.click === "function") {
      element.click();
    } else {
      element.dispatchEvent(new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        view: window,
        button: 0,
      }));
    }
  }

  function activateStudyReadingControl(element) {
    const target = element || null;
    if (!target) return;
    target.focus?.({ preventScroll: true });
    const rect = target.getBoundingClientRect?.();
    const pointTarget = rect?.width > 0 && rect?.height > 0
      ? document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
      : null;
    const clickTarget = pointTarget && target.contains?.(pointTarget) ? pointTarget : target;
    try {
      clickTarget.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, pointerType: "mouse", isPrimary: true, button: 0 }));
      clickTarget.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window, button: 0 }));
      clickTarget.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true, pointerType: "mouse", isPrimary: true, button: 0 }));
      clickTarget.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window, button: 0 }));
    } catch {
      // O click() abaixo ainda aciona o comportamento padrão do link.
    }
    if (typeof clickTarget.click === "function") clickTarget.click();
    else activateElement(target);
  }

  function findExitControl() {
    return [...document.querySelectorAll('button, a, [role="button"]')].find((element) => {
      const labels = [element.innerText, element.getAttribute("aria-label"), element.getAttribute("title")];
      return isVisibleElement(element) && labels.some(PlurallFlowCore.isExitControlText);
    }) || null;
  }

  function isVisibleElement(element) {
    if (!element || !element.getClientRects().length || element.closest('[aria-hidden="true"]')) return false;
    const style = getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity || 1) > 0.05;
  }

  function wait(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  }

  async function processExercisePage() {
    const queue = runtime.queue;
    const expectedUrl = queue.exercises?.[queue.exerciseIndex];
    if (!expectedUrl) {
      await advanceTask("Tarefa concluída.");
      return;
    }

    if (!sameUrl(location.href, expectedUrl)) {
      await updateQueue({
        message: "Abrindo novamente a questão esperada…",
        tone: "neutral",
      });
      navigateTo(expectedUrl, 400);
      return;
    }

    const grade = getGradeState();
    const assistant = globalThis.__plurallLocalAssistant;
    if (grade.completed) {
      await advanceExercise(false, "Questão já respondida anteriormente. Avançando…");
      return;
    }
    if (grade.correct) {
      await advanceExercise(false, "Resposta correta detectada. Avançando…");
      return;
    }
    if (grade.wrong && grade.locked) {
      await advanceExercise(false, "Tentativas esgotadas. Avançando para o próximo exercício…", true);
      return;
    }
    if (grade.wrong) {
      const retryAction = await assistant?.retryWrongAnswer?.();
      if (retryAction === "retrying") return;
      if (retryAction === "exhausted") {
        await advanceExercise(false, "As três alternativas falharam. Avançando para o próximo exercício…", true);
        return;
      }
      if (!assistant?.isBusy?.() && !assistant?.hasResult?.()) {
        await updateQueue({
          lastAnalyzedUrl: null,
          waitingForSubmit: false,
          message: "Resposta anterior detectada. Reanalisando esta questão automaticamente…",
          tone: "neutral",
        });
        assistant?.analyzeCurrentQuestion?.(true, { autoMarkThreshold: AUTO_MARK_THRESHOLD });
        return;
      }
      await updateQueue({
        waitingForSubmit: true,
        message: grade.locked
          ? "Resposta incorreta e sem tentativas restantes. Use Pular exercício para continuar."
          : "A resposta enviada está incorreta. Revise, tente novamente e a fila continuará quando acertar.",
        tone: "error",
      });
      return;
    }
    if (grade.locked) {
      await advanceExercise(false, "Este exercício não tem tentativas restantes. Avançando…", true);
      return;
    }

    // Aguarda o retorno do Plurall para poder tentar outra alternativa quando a
    // resposta estiver errada. Se o retorno não vier, nunca marca a questão
    // como concluída: trata apenas a alternativa atual como falha e tenta outra.
    if (queue.waitingForSubmit && Number(queue.submittedAt || 0) > 0) {
      if (Date.now() - Number(queue.submittedAt) >= SUBMIT_RESULT_TIMEOUT_MS) {
        const retryAction = await assistant?.retryTimedOutAnswer?.();
        if (retryAction === "retrying") return;
        if (retryAction === "exhausted") {
          await advanceExercise(false, "Três alternativas foram tentadas sem retorno de acerto. Avançando…", true);
          return;
        }
        await updateQueue({
          submittedAt: 0,
          waitingForSubmit: true,
          message: "Não consegui confirmar o resultado nem trocar a alternativa. A questão ficou aberta para revisão.",
          tone: "error",
        });
        return;
      }
      render();
      return;
    }

    if (sameUrl(queue.lastAnalyzedUrl, location.href)) {
      if (assistant?.isBusy?.()) {
        const startedAt = Number(queue.analysisStartedAt || 0);
        if (startedAt && Date.now() - startedAt > 120_000) {
          await updateQueue({
            lastAnalyzedUrl: null,
            analysisStartedAt: 0,
            waitingForSubmit: false,
            message: "A análise demorou demais. Reiniciando automaticamente…",
            tone: "error",
          });
          scheduleProcess(100);
          return;
        }
        scheduleProcess(500);
      }
      render();
      return;
    }

    if (!assistant?.extractQuestion?.()) {
      if (runtime.pageAttempts < 20) {
        runtime.pageAttempts += 1;
        scheduleProcess(750);
      } else {
        await updateQueue({
          message: "Não encontrei uma questão de múltipla escolha. Use Pular exercício ou cancele a fila.",
          tone: "error",
        });
      }
      return;
    }
    runtime.pageAttempts = 0;

    if (assistant.isBusy?.()) {
      scheduleProcess(500);
      return;
    }

    await updateQueue({
      lastAnalyzedUrl: cleanUrl(location.href),
      analysisStartedAt: Date.now(),
      waitingForSubmit: false,
      message: "Analisando a questão localmente…",
      tone: "neutral",
    });
    assistant.analyzeCurrentQuestion(true, { autoMarkThreshold: AUTO_MARK_THRESHOLD });
  }

  async function onAnalysisComplete(event) {
    if (!runtime.queue?.active || getPageKind() !== "exercise") return;
    const confidence = Number(event.detail?.confidence) || 0;
    let autoMarked = Boolean(event.detail?.autoMarked);
    if (!autoMarked && PlurallFlowCore.shouldAutoApply(confidence, AUTO_MARK_THRESHOLD)) {
      autoMarked = Boolean(await globalThis.__plurallLocalAssistant?.applySuggestedOption?.());
    }
    const openQuestion = event.detail?.questionType === "open";
    const autoSubmitted = Boolean(
      event.detail?.autoSubmitted || globalThis.__plurallLocalAssistant?.wasLastAutoSubmitted?.(),
    );
    if (!autoMarked) {
      await retryAnalysisOrSkip("Não consegui aplicar a resposta automaticamente.");
      return;
    }
    await updateQueue({
      waitingForSubmit: true,
      submittedAt: autoSubmitted ? Date.now() : 0,
      lastAnalyzedUrl: cleanUrl(location.href),
      lastConfidence: confidence,
      analysisRetryCount: 0,
      message: autoSubmitted
        ? openQuestion
          ? `Estimativa do modelo: ${Math.round(confidence * 100)}% (não calibrada): resposta aberta enviada automaticamente. Avançando…`
          : `Estimativa do modelo: ${Math.round(confidence * 100)}% (não calibrada): alternativa enviada automaticamente. Conferindo o resultado…`
        : autoMarked
        ? openQuestion
          ? `Estimativa do modelo: ${Math.round(confidence * 100)}% (não calibrada): resposta preenchida. Revise, clique em Responder e depois em Continuar.`
          : `Estimativa do modelo: ${Math.round(confidence * 100)}% (não calibrada): alternativa ${event.detail?.optionLabel || ""} marcada. Revise e clique em Responder.`
        : openQuestion
          ? `Estimativa do modelo: ${Math.round(confidence * 100)}% (não calibrada): não consegui preencher automaticamente. Tentarei novamente.`
          : `Estimativa do modelo: ${Math.round(confidence * 100)}% (não calibrada): não consegui marcar automaticamente. Tentarei novamente.`,
      tone: autoMarked ? "success" : "neutral",
    });

  }

  async function onAnalysisError(event) {
    if (!runtime.queue?.active || getPageKind() !== "exercise") return;
    await retryAnalysisOrSkip(event.detail?.message || "A análise local falhou.");
  }

  async function retryAnalysisOrSkip(reason) {
    const retryCount = Number(runtime.queue.analysisRetryCount || 0) + 1;
    if (retryCount <= 2) {
      await updateQueue({
        analysisRetryCount: retryCount,
        lastAnalyzedUrl: null,
        waitingForSubmit: false,
        message: `${reason} Nova tentativa automática ${retryCount}/2…`,
        tone: "error",
      });
      setTimeout(() => scheduleProcess(100), 1_200);
      return;
    }
    await updateQueue({
      lastAnalyzedUrl: null,
      waitingForSubmit: false,
      message: "Não foi possível analisar esta questão automaticamente. Ela ficará aberta para tentar novamente.",
      tone: "error",
    });
  }

  async function onRetriesExhausted() {
    if (!runtime.queue?.active || runtime.advancing || getPageKind() !== "exercise") return;
    await advanceExercise(false, "As três alternativas ranqueadas falharam. Avançando…", true);
  }

  async function onRetryAttempt(event) {
    if (!runtime.queue?.active || getPageKind() !== "exercise") return;
    const retryNumber = Number(event.detail?.retryNumber || 0) + 1;
    const optionIndex = Number(event.detail?.optionIndex);
    const label = Number.isInteger(optionIndex) ? String.fromCharCode(65 + optionIndex) : "outra";
    if (!event.detail?.applied) {
      await retryAnalysisOrSkip("Não consegui aplicar a próxima alternativa.");
      return;
    }
    await updateQueue({
      waitingForSubmit: true,
      submittedAt: Date.now(),
      message: `Alternativa ${label} enviada na tentativa ${retryNumber}/3. Conferindo o resultado…`,
      tone: "neutral",
    });
  }

  function getGradeState() {
    const options = [...document.querySelectorAll("#multiple-choice li.option")];
    const selected = options.find((option) => /Alternativa selecionada/i.test(option.innerText || ""));
    const selectedSignals = selected
      ? [selected, ...selected.querySelectorAll("*")].slice(0, 50).map((node) => String(node.className || "")).join(" ")
      : "";
    const assistantOutcome = globalThis.__plurallLocalAssistant?.getAnswerOutcome?.();
    const questionRoot =
      document.querySelector("#multiple-choice")?.parentElement ||
      findOpenResponseField()?.closest('[class*="Exercise-module"]') ||
      document.querySelector('#container-hold-content [class*="exercise"]') ||
      document.body;
    const fullText = normalizeText(questionRoot?.innerText || "");
    const terminalWrong = [...document.querySelectorAll('[role="dialog"], [aria-modal="true"]')]
      .filter(isVisibleElement)
      .some((dialog) => PlurallFlowCore.isTerminalWrongFeedback(dialog.innerText || dialog.textContent));
    const disabledResponder = [...document.querySelectorAll('button, input[type="submit"], [role="button"]')]
      .some((control) => {
        const label = normalizeText(control.innerText || control.value || control.getAttribute('aria-label') || '');
        return /^responder$/i.test(label) && Boolean(control.disabled || control.getAttribute('aria-disabled') === 'true');
      });
    // Algumas questões abertas não exibem “resposta correta”; elas mostram a
    // resposta e o gabarito com o botão Responder bloqueado depois do envio.
    const shownAnswerKey = /\bRESPOSTA\b/i.test(fullText) && /\bGABARITO\b/i.test(fullText) && disabledResponder;
    // O enunciado ou algum texto auxiliar pode conter as palavras “resposta
    // correta” sem que a questão tenha sido respondida. Usar o texto inteiro
    // da questão aqui fazia a fila avançar antes de analisar e pular itens.
    // Para múltipla escolha, a confirmação real vem do estado da alternativa;
    // para abertas, mantemos a detecção do gabarito visível.
    const completedFeedback = shownAnswerKey;
    return {
      open: Boolean(findOpenResponseField()),
      completed: completedFeedback,
      correct: Boolean(assistantOutcome?.correct || (selected && /(?:^|[^a-z])(right|correct|success)(?:[^a-z]|$)/i.test(selectedSignals))),
      wrong: Boolean(terminalWrong || assistantOutcome?.wrong || (selected && /(?:^|[^a-z])(wrong|incorrect|error|danger|invalid)(?:[^a-z]|$)/i.test(selectedSignals))),
      locked: Boolean(terminalWrong || /TENTATIVAS RESTANTES:\s*0\b|0\s+tentativas restantes/i.test(fullText)),
    };
  }

  async function advanceExercise(skipped, message, exhausted = false) {
    if (runtime.advancing) return;
    runtime.advancing = true;
    try {
      const queue = runtime.queue;
      const completed = Number(queue.completed || 0) + (!skipped && !exhausted ? 1 : 0);
      const skippedCount = Number(queue.skipped || 0) + (skipped ? 1 : 0);
      const exhaustedCount = Number(queue.exhausted || 0) + (exhausted ? 1 : 0);
      const nextStep = PlurallFlowCore.nextQueueStep({
        taskIndex: queue.taskIndex,
        taskCount: queue.tasks?.length || 0,
        exerciseIndex: queue.exerciseIndex,
        exerciseCount: queue.exercises?.length || 0,
      });
      if (nextStep.kind === "exercise") {
        const next = {
          ...queue,
          exerciseIndex: nextStep.exerciseIndex,
          completed,
          skipped: skippedCount,
          exhausted: exhaustedCount,
          lastAnalyzedUrl: null,
          waitingForSubmit: false,
          analysisRetryCount: 0,
          message,
          tone: skipped ? "error" : "success",
        };
        await saveQueue(next);
        navigateTo(next.exercises[nextStep.exerciseIndex], 900);
        return;
      }
      await saveQueue({ ...queue, completed, skipped: skippedCount, exhausted: exhaustedCount });
      await beginStudyStep("Último exercício concluído. Abrindo a leitura da tarefa…");
    } finally {
      if (!runtime.navigating) runtime.advancing = false;
    }
  }

  async function advanceTask(message) {
    const queue = runtime.queue;
    const nextTaskIndex = Number(queue.taskIndex || 0) + 1;
    if (nextTaskIndex >= (queue.tasks?.length || 0)) {
      await finishQueue();
      return;
    }
    const next = {
      ...queue,
      taskIndex: nextTaskIndex,
      exercises: [],
      exerciseIndex: 0,
      lastAnalyzedUrl: null,
      waitingForSubmit: false,
      analysisRetryCount: 0,
      studyStepPending: false,
      studyStepAttempts: 0,
      studyDirectRouteAttempted: false,
      studyRouteRequested: false,
      studyPageOpened: false,
      studyResourceAttempts: 0,
      studyDocumentOpened: false,
      studyDocumentOpenedAt: 0,
      studyAwaitingCompletionCheck: false,
      studyCompletionChecks: 0,
      studyReadingPaused: false,
      studyCompletedTaskUrl: null,
      studyCompletionVerified: false,
      message,
      tone: "success",
    };
    await saveQueue(next);
    navigateTo(next.tasks[nextTaskIndex].url, 900);
  }

  async function finishQueue() {
    const queue = runtime.queue;
    const next = {
      ...queue,
      active: false,
      status: "complete",
      message: `Fila finalizada: ${Number(queue.completed || 0)} concluído(s), ${Number(queue.skipped || 0)} pulado(s) manualmente e ${Number(queue.exhausted || 0)} encerrado(s) por tentativas.`,
      tone: "success",
    };
    await saveQueue(next);
    if (queue.materialUrl) navigateTo(queue.materialUrl, 1000);
  }

  function render() {
    if (getPageKind() === "material" && !runtime.queue?.active) {
      renderModuleSelector();
      return;
    }
    if (runtime.queue?.active || runtime.queue?.status === "complete") {
      renderProgress();
      return;
    }
    host.style.display = "none";
  }

  function renderModuleSelector() {
    const currentList = panel.querySelector(".modules");
    if (currentList) {
      runtime.selectorPanelScrollTop = panel.scrollTop;
      runtime.selectorListScrollTop = currentList.scrollTop;
    }
    host.style.display = "block";
    const selectedCount = runtime.selectedModuleIds.size;
    const selectedTasks = runtime.modules
      .filter((module) => runtime.selectedModuleIds.has(module.id))
      .reduce((total, module) => total + module.tasks.filter(isQueuedTask).length, 0);
    const completion = runtime.queue?.status === "complete"
      ? `<div class="notice">${escapeHtml(runtime.queue.message)}</div>`
      : "";
    const rows = runtime.modules.length
      ? runtime.modules.map((module) => `
          <label class="module">
            <input type="checkbox" data-module-id="${module.id}" ${runtime.selectedModuleIds.has(module.id) ? "checked" : ""}>
            <span>
              <span class="discipline">${escapeHtml(module.discipline)}</span>
              <span class="module-name">${escapeHtml(shortModuleName(module.moduleName))}</span>
              <span class="count">${module.tasks.length} tarefa(s)</span>
            </span>
          </label>
        `).join("")
      : '<div class="empty">Carregando módulos…</div>';

    panel.innerHTML = `
      <div class="drag-handle" data-drag-handle title="Arraste para mover o painel">
        <h2>Fila de módulos</h2>
        <span class="drag-label">↕ Arrastar</span>
      </div>
      <p class="subtitle">Selecione os módulos carregados e role a página para carregar mais.</p>
      <label class="module"><input type="checkbox" data-action="toggle-complementary" ${runtime.includeComplementary ? "checked" : ""}><span><span class="discipline">Incluir Tarefas Complementares</span><span class="module-name">Além das Tarefas Mínimas</span></span></label>
      <label class="module"><input type="checkbox" data-action="toggle-only-complementary" ${runtime.onlyComplementary ? "checked" : ""}><span><span class="discipline">Somente Tarefas Complementares</span><span class="module-name">Ignorar Tarefas Mínimas</span></span></label>
      ${completion}
      <div class="modules">${rows}</div>
      <div class="buttons">
        <button class="secondary" data-action="select-all">Marcar visíveis</button>
        <button class="secondary" data-action="clear">Limpar</button>
      </div>
      <div class="notice ${runtime.selectorMessage ? "error" : ""}">${escapeHtml(runtime.selectorMessage || `${selectedCount} módulo(s) • ${selectedTasks} tarefa(s) selecionada(s). Responde automaticamente com qualquer nível de confiança.`)}</div>
      <button class="primary" data-action="start" ${selectedTasks ? "" : "disabled"}>Iniciar fila</button>
    `;
    schedulePanelPosition();
    requestAnimationFrame(() => {
      panel.scrollTop = runtime.selectorPanelScrollTop;
      const nextList = panel.querySelector(".modules");
      if (nextList) nextList.scrollTop = runtime.selectorListScrollTop;
    });
  }

  function renderProgress() {
    host.style.display = "block";
    const queue = runtime.queue || {};
    const totalTasks = queue.tasks?.length || 0;
    const currentTask = totalTasks ? Math.min(Number(queue.taskIndex || 0) + 1, totalTasks) : 0;
    const percentage = totalTasks ? Math.round(((currentTask - 1) / totalTasks) * 100) : 0;
    const currentTitle = queue.tasks?.[queue.taskIndex]?.title || "Preparando fila";
    const offPath = queue.active && !isExpectedQueuePage(queue);
    const retryAvailable = queue.active && getPageKind() === "exercise" && queue.tone === "error";
    const retryStudyAvailable = queue.active && queue.studyStepPending && queue.studyReadingPaused;
    const openQuestion = getPageKind() === "exercise" && Boolean(findOpenResponseField());

    panel.innerHTML = `
      <div class="drag-handle" data-drag-handle title="Arraste para mover o painel">
        <h2>${queue.active ? "Fila em andamento" : "Fila finalizada"}</h2>
        <span class="drag-label">↕ Arrastar</span>
      </div>
      <p class="subtitle">${escapeHtml(currentTitle)}</p>
      <div class="notice ${queue.tone === "error" ? "error" : ""}">${escapeHtml(queue.message || "Preparando…")}</div>
      <div class="progress">
        <div class="bar"><div class="fill" style="width:${Math.max(0, Math.min(100, percentage))}%"></div></div>
        <div class="stats">
          <span>Tarefa ${currentTask}/${totalTasks}</span>
      <span>${Number(queue.completed || 0)} concluído(s) • ${Number(queue.skipped || 0)} pulado(s) • ${Number(queue.exhausted || 0)} encerrado(s)</span>
        </div>
      </div>
      <div class="buttons">
        ${offPath ? '<button class="primary" data-action="resume">Retomar fila</button>' : ""}
        ${retryAvailable ? '<button class="secondary" data-action="retry">Tentar novamente</button>' : ""}
        ${retryStudyAvailable ? '<button class="primary" data-action="retry-study">Tentar leitura novamente</button>' : ""}
        ${queue.active && openQuestion ? '<button class="primary" data-action="continue-open">Continuar após enviar</button>' : ""}
        ${queue.active && getPageKind() === "exercise" ? '<button class="secondary" data-action="skip">Pular exercício</button>' : ""}
        ${queue.active ? '<button class="danger" data-action="cancel">Cancelar</button>' : '<button class="primary" data-action="back-material">Voltar aos módulos</button>'}
      </div>
    `;
    schedulePanelPosition();
  }

  function startPanelDrag(event) {
    if (event.button !== 0 || !event.target.closest("[data-drag-handle]")) return;
    const rect = host.getBoundingClientRect();
    runtime.dragState = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      hostX: rect.left,
      hostY: rect.top,
      width: rect.width,
      height: rect.height,
    };
    event.target.closest("[data-drag-handle]")?.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  }

  function movePanelDrag(event) {
    const drag = runtime.dragState;
    if (!drag || drag.pointerId !== event.pointerId) return;
    applyPanelPosition({
      x: drag.hostX + event.clientX - drag.startX,
      y: drag.hostY + event.clientY - drag.startY,
    }, { width: drag.width, height: drag.height });
  }

  function finishPanelDrag(event) {
    const drag = runtime.dragState;
    if (!drag || drag.pointerId !== event.pointerId) return;
    runtime.dragState = null;
    if (runtime.panelPosition) storageSet({ [POSITION_KEY]: runtime.panelPosition });
  }

  function schedulePanelPosition() {
    if (runtime.panelPosition) requestAnimationFrame(() => applyPanelPosition(runtime.panelPosition));
  }

  function applyPanelPosition(position, measuredSize) {
    const rect = measuredSize || host.getBoundingClientRect();
    const next = PlurallFlowCore.clampPanelPosition(
      position,
      { width: rect.width, height: rect.height },
      { width: window.innerWidth, height: window.innerHeight },
    );
    runtime.panelPosition = next;
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

  function onPanelChange(event) {
    if (event.target.matches('input[data-action="toggle-complementary"]')) {
      runtime.includeComplementary = Boolean(event.target.checked);
      if (runtime.includeComplementary) runtime.onlyComplementary = false;
      runtime.selectorMessage = "";
      renderModuleSelector();
      return;
    }
    if (event.target.matches('input[data-action="toggle-only-complementary"]')) {
      runtime.onlyComplementary = Boolean(event.target.checked);
      if (runtime.onlyComplementary) runtime.includeComplementary = false;
      runtime.selectorMessage = "";
      renderModuleSelector();
      return;
    }
    const checkbox = event.target.closest('input[data-module-id]');
    if (!checkbox) return;
    runtime.selectorPanelScrollTop = panel.scrollTop;
    runtime.selectorListScrollTop = checkbox.closest(".modules")?.scrollTop || 0;
    if (checkbox.checked) runtime.selectedModuleIds.add(checkbox.dataset.moduleId);
    else runtime.selectedModuleIds.delete(checkbox.dataset.moduleId);
    runtime.selectorMessage = "";
    renderModuleSelector();
  }

  async function onPanelClick(event) {
    const action = event.target.closest("button[data-action]")?.dataset.action;
    if (!action) return;

    if (action === "select-all") {
      runtime.modules.forEach((module) => runtime.selectedModuleIds.add(module.id));
      runtime.selectorMessage = "";
      renderModuleSelector();
    } else if (action === "clear") {
      runtime.selectedModuleIds.clear();
      runtime.selectorMessage = "";
      renderModuleSelector();
    } else if (action === "start") {
      await startQueue();
    } else if (action === "cancel") {
      cancelNavigation();
      await updateQueue({ active: false, status: "cancelled", message: "Fila cancelada.", tone: "error" });
      render();
    } else if (action === "resume") {
      resumeQueue();
    } else if (action === "retry") {
      await updateQueue({ lastAnalyzedUrl: null, waitingForSubmit: false, message: "Tentando analisar novamente…", tone: "neutral" });
      scheduleProcess(100);
    } else if (action === "retry-study") {
      cancelNavigation();
      await updateQueue({
        studyStepAttempts: 0,
        studyDirectRouteAttempted: false,
        studyRouteRequested: false,
        studyPageOpened: false,
        studyResourceAttempts: 0,
        studyDocumentOpened: false,
        studyDocumentOpenedAt: 0,
        studyAwaitingCompletionCheck: false,
        studyCompletionChecks: 0,
        studyReadingPaused: false,
        message: "Tentando abrir e validar a leitura novamente…",
        tone: "neutral",
      });
      const taskUrl = runtime.queue?.tasks?.[runtime.queue?.taskIndex]?.url;
      if (sameUrl(location.href, taskUrl)) scheduleProcess(100);
      else navigateTo(taskUrl, 200);
    } else if (action === "skip") {
      // O processamento da página pode estar aguardando o retorno de uma
      // tentativa. O comando explícito do usuário deve cancelar essa espera
      // antes de avançar, sem deixar o estado `advancing` preso.
      cancelNavigation();
      runtime.processing = false;
      runtime.advancing = false;
      await advanceExercise(true, "Exercício pulado pelo usuário.");
    } else if (action === "continue-open") {
      await advanceExercise(false, "Resposta aberta enviada. Avançando…");
    } else if (action === "back-material") {
      if (runtime.queue?.materialUrl) navigateTo(runtime.queue.materialUrl);
    }
  }

  async function startQueue() {
    // A ordem da fila deve ser a ordem visual dos módulos na página, nunca a
    // ordem em que as caixas foram marcadas ou em que o DOM terminou de
    // carregar. Isso evita misturar, por exemplo, Geografia no meio de
    // Matemática C.
    const selectedModules = runtime.modules
      .filter((module) => runtime.selectedModuleIds.has(module.id))
      .sort((first, second) => Number(first.moduleOrder || 0) - Number(second.moduleOrder || 0));
    const tasks = uniqueBy(
      selectedModules
        .flatMap((module) => module.tasks
          .map((task, taskOrder) => ({ ...task, moduleOrder: module.moduleOrder, taskOrder })))
        .filter(isQueuedTask),
      (task) => task.url,
    );
    if (!tasks.length) {
      runtime.selectorMessage = selectedModules.length
        ? "Os módulos selecionados não possuem tarefas compatíveis. Marque Tarefas Mínimas ou Complementares e tente novamente."
        : "Selecione pelo menos um módulo antes de iniciar a fila.";
      renderModuleSelector();
      return;
    }
    runtime.selectorMessage = "";
    const queue = {
      version: QUEUE_VERSION,
      active: true,
      status: "running",
      materialUrl: cleanUrl(location.href),
      selectedModules: selectedModules.map(({ id, discipline, moduleName }) => ({ id, discipline, moduleName })),
      includeComplementary: runtime.includeComplementary,
      onlyComplementary: runtime.onlyComplementary,
      tasks,
      taskIndex: 0,
      exercises: [],
      exerciseIndex: 0,
      completed: 0,
      skipped: 0,
      exhausted: 0,
      lastAnalyzedUrl: null,
      waitingForSubmit: false,
      analysisRetryCount: 0,
      studyStepPending: false,
      studyStepAttempts: 0,
      studyDirectRouteAttempted: false,
      studyRouteRequested: false,
      studyPageOpened: false,
      studyResourceAttempts: 0,
      studyDocumentOpened: false,
      studyDocumentOpenedAt: 0,
      studyAwaitingCompletionCheck: false,
      studyCompletionChecks: 0,
      studyReadingPaused: false,
      studyCompletedTaskUrl: null,
      studyCompletionVerified: false,
      message: "Abrindo a primeira tarefa…",
      tone: "neutral",
      startedAt: Date.now(),
    };
    await saveQueue(queue);
    navigateTo(tasks[0].url);
  }

  function resumeQueue() {
    const queue = runtime.queue;
    if (!queue?.active) return;
    const exerciseUrl = queue.exercises?.[queue.exerciseIndex];
    const taskUrl = queue.tasks?.[queue.taskIndex]?.url;
    navigateTo(queue.studyStepPending ? taskUrl : (exerciseUrl || taskUrl || queue.materialUrl));
  }

  function navigateTo(url, delay = 0) {
    if (!url || runtime.navigating) return false;
    const targetUrl = cleanUrl(url);
    if (!sameUrl(runtime.navigationTarget, targetUrl)) runtime.navigationRetryCount = 0;
    runtime.navigationTarget = targetUrl;
    runtime.navigating = true;
    clearTimeout(runtime.scanTimer);
    clearTimeout(runtime.navigationWatchdog);
    runtime.navigationTimer = setTimeout(() => {
      runtime.navigationTimer = null;
      try {
        location.assign(url);
        runtime.navigationWatchdog = setTimeout(() => {
          runtime.navigationWatchdog = null;
          const reachedTarget = sameUrl(location.href, targetUrl);
          const recovery = PlurallFlowCore.nextNavigationRecovery(
            reachedTarget,
            runtime.navigationRetryCount,
            2,
          );
          runtime.navigating = false;
          runtime.advancing = false;
          if (recovery.kind === "reached") {
            runtime.navigationRetryCount = 0;
            prepareForPage();
            scheduleProcess(100);
            return;
          }
          if (recovery.kind === "retry") {
            runtime.navigationRetryCount = recovery.retryCount;
            void updateQueue({
              message: `A página não abriu. Nova tentativa automática ${runtime.navigationRetryCount}/2…`,
              tone: "error",
            }).then(() => navigateTo(url, 400));
            return;
          }
          runtime.navigationRetryCount = recovery.retryCount;
          void updateQueue({
            message: "Não consegui abrir a próxima página após três tentativas. Clique em Retomar fila.",
            tone: "error",
          });
        }, 5000);
      } catch (error) {
        runtime.navigating = false;
        runtime.advancing = false;
        runtime.navigationTimer = null;
        updateQueue({
          message: `Não consegui abrir a próxima página: ${error?.message || "erro de navegação"}. Clique em Retomar fila.`,
          tone: "error",
        });
      }
    }, delay);
    return true;
  }

  function cancelNavigation() {
    clearTimeout(runtime.navigationTimer);
    clearTimeout(runtime.navigationWatchdog);
    runtime.navigationTimer = null;
    runtime.navigationWatchdog = null;
    runtime.navigationTarget = null;
    runtime.navigationRetryCount = 0;
    runtime.navigating = false;
    runtime.advancing = false;
  }

  function isExpectedQueuePage(queue) {
    const kind = getPageKind();
    if (kind === "reading") return Boolean(queue.studyStepPending);
    if (kind === "exercise") return sameUrl(location.href, queue.exercises?.[queue.exerciseIndex]);
    if (kind === "task") return sameUrl(location.href, queue.tasks?.[queue.taskIndex]?.url);
    return false;
  }

  async function updateQueue(changes) {
    const next = { ...(runtime.queue || {}), ...changes };
    await saveQueue(next);
  }

  async function saveQueue(queue) {
    runtime.queue = queue;
    globalThis.__plurallModuleQueueActive = Boolean(queue?.active);
    await storageSet({ [STORAGE_KEY]: queue });
    render();
  }

  function getPageKind() {
    const path = location.pathname.replace(/\/+$/, "");
    if (PlurallFlowCore.isStudyReadingPath(path)) return "reading";
    if (/\/material\/\d+\/aula\/\d+\/tarefa\/\d+\/exercicio\/\d+$/i.test(path)) return "exercise";
    if (/\/material\/\d+\/aula\/\d+\/tarefa\/\d+$/i.test(path)) return "task";
    if (/\/material\/\d+$/i.test(path)) return "material";
    return "other";
  }

  function findOpenResponseField() {
    return document.querySelector(
      '[data-test-id="response-textarea"], textarea[placeholder*="resposta" i], textarea[placeholder*="answer" i]',
    );
  }

  function normalizeTaskTitle(value) {
    return normalizeText(value).replace(/\s+\d+\s+(?:\d+|Entregue.*)$/i, "");
  }

  function onlyMinimumTasks(queue) {
    if (!queue || !Array.isArray(queue.tasks)) return queue;
    const tasks = queue.tasks.filter((task) => queue.onlyComplementary
      ? PlurallFlowCore.isComplementaryTaskTitle(task?.title)
      : PlurallFlowCore.isSupportedTaskTitle(task?.title, Boolean(queue.includeComplementary)));
    if (tasks.length === queue.tasks.length) return queue;
    if (!tasks.length) {
      return {
        ...queue,
        active: false,
        status: "complete",
        tasks: [],
        taskIndex: 0,
        exercises: [],
        exerciseIndex: 0,
        lastAnalyzedUrl: null,
        waitingForSubmit: false,
        analysisRetryCount: 0,
        message: "Nenhuma tarefa compatível foi encontrada na fila anterior.",
        tone: "neutral",
      };
    }
    return {
      ...queue,
      tasks,
      taskIndex: 0,
      exercises: [],
      exerciseIndex: 0,
      completed: 0,
      skipped: 0,
      lastAnalyzedUrl: null,
      waitingForSubmit: false,
      analysisRetryCount: 0,
      message: queue.onlyComplementary
        ? "Fila atualizada: somente Tarefas Complementares serão realizadas."
        : queue.includeComplementary
        ? "Fila atualizada: Tarefas Mínimas e Complementares serão realizadas."
        : "Fila atualizada: somente Tarefas Mínimas serão realizadas.",
      tone: "neutral",
    };
  }

  function normalizeQueueState(queue) {
    const minimumQueue = onlyMinimumTasks(queue);
    if (!minimumQueue || !Array.isArray(minimumQueue.tasks)) return minimumQueue;
    if (Number(minimumQueue.version || 0) >= QUEUE_VERSION) return minimumQueue;
    return {
      ...minimumQueue,
      version: QUEUE_VERSION,
      onlyComplementary: Boolean(minimumQueue.onlyComplementary),
      taskIndex: minimumQueue.active ? 0 : minimumQueue.taskIndex,
      exercises: minimumQueue.active ? [] : minimumQueue.exercises,
      exerciseIndex: minimumQueue.active ? 0 : minimumQueue.exerciseIndex,
      lastAnalyzedUrl: minimumQueue.active ? null : minimumQueue.lastAnalyzedUrl,
      waitingForSubmit: minimumQueue.active ? false : minimumQueue.waitingForSubmit,
      analysisRetryCount: minimumQueue.active ? 0 : minimumQueue.analysisRetryCount,
      studyStepPending: false,
      studyStepAttempts: 0,
      studyDirectRouteAttempted: false,
      studyRouteRequested: false,
      studyPageOpened: false,
      studyResourceAttempts: 0,
      studyDocumentOpened: false,
      studyDocumentOpenedAt: 0,
      studyAwaitingCompletionCheck: false,
      studyCompletionChecks: 0,
      studyReadingPaused: false,
      studyCompletedTaskUrl: null,
      studyCompletionVerified: false,
      message: minimumQueue.active
        ? "Fila atualizada. Revisando as leituras e avançando somente quando a barra ficar verde."
        : minimumQueue.message,
      tone: minimumQueue.active ? "neutral" : minimumQueue.tone,
    };
  }

  function shortModuleName(value) {
    const match = String(value || "").match(/^Módulo\s*-\s*\d+\s*\((.*)\)$/i);
    return match ? match[1] : value;
  }

  function normalizeText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function cleanUrl(value) {
    try {
      const url = new URL(value, location.origin);
      url.hash = "";
      url.search = "";
      return url.href.replace(/\/+$/, "");
    } catch {
      return String(value || "").replace(/[?#].*$/, "").replace(/\/+$/, "");
    }
  }

  function sameUrl(first, second) {
    if (!first || !second) return false;
    return cleanUrl(first) === cleanUrl(second);
  }

  function uniqueBy(items, keyFn) {
    const seen = new Set();
    return items.filter((item) => {
      const key = keyFn(item);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function hashText(value) {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16);
  }

  function escapeHtml(value) {
    return String(value || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function storageGet(key) {
    const keys = Array.isArray(key) ? key : [key];
    return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
  }

  function storageSet(value) {
    return new Promise((resolve) => chrome.storage.local.set(value, resolve));
  }
})();

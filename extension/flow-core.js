((root) => {
  function buildRetryPlan(primaryIndex, rawRanking, optionCount, maxAttempts = 3) {
    const safeOptionCount = Math.max(0, Number(optionCount) || 0);
    const safeMaxAttempts = Math.max(1, Number(maxAttempts) || 3);
    const candidates = [primaryIndex, ...(Array.isArray(rawRanking) ? rawRanking : [])]
      .map(Number)
      .filter((index) => Number.isInteger(index) && index >= 0 && index < safeOptionCount);
    for (let index = 0; index < safeOptionCount; index += 1) candidates.push(index);
    return [...new Set(candidates)].slice(0, Math.min(safeMaxAttempts, safeOptionCount));
  }

  function nextQueueStep({ taskIndex, taskCount, exerciseIndex, exerciseCount }) {
    const nextExerciseIndex = Number(exerciseIndex || 0) + 1;
    if (nextExerciseIndex < Number(exerciseCount || 0)) {
      return { kind: "exercise", exerciseIndex: nextExerciseIndex, taskIndex: Number(taskIndex || 0) };
    }

    const nextTaskIndex = Number(taskIndex || 0) + 1;
    if (nextTaskIndex < Number(taskCount || 0)) {
      return { kind: "task", exerciseIndex: 0, taskIndex: nextTaskIndex };
    }

    return { kind: "complete", exerciseIndex: 0, taskIndex: Number(taskCount || 0) };
  }

  function isMinimumTaskTitle(value) {
    const normalized = String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, " ")
      .trim();
    return /^Tarefa Minima\b/i.test(normalized);
  }

  function isComplementaryTaskTitle(value) {
    const normalized = String(value || "")
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, " ").trim();
    return /^Tarefa Complementar\b/i.test(normalized);
  }

  function isSupportedTaskTitle(value, includeComplementary = false) {
    return isMinimumTaskTitle(value) || (includeComplementary && isComplementaryTaskTitle(value));
  }

  function clampPanelPosition(position, panelSize, viewportSize, margin = 8) {
    const safeMargin = Math.max(0, Number(margin) || 0);
    const panelWidth = Math.max(0, Number(panelSize?.width) || 0);
    const panelHeight = Math.max(0, Number(panelSize?.height) || 0);
    const viewportWidth = Math.max(0, Number(viewportSize?.width) || 0);
    const viewportHeight = Math.max(0, Number(viewportSize?.height) || 0);
    const maxX = Math.max(safeMargin, viewportWidth - panelWidth - safeMargin);
    const maxY = Math.max(safeMargin, viewportHeight - panelHeight - safeMargin);
    return {
      x: Math.round(Math.min(maxX, Math.max(safeMargin, Number(position?.x) || 0))),
      y: Math.round(Math.min(maxY, Math.max(safeMargin, Number(position?.y) || 0))),
    };
  }

  function colorMatchesTone(value, tone) {
    const match = String(value || "").match(/rgba?\(\s*(\d+)\D+(\d+)\D+(\d+)(?:\D+([\d.]+))?/i);
    if (!match) return false;
    const [red, green, blue] = match.slice(1, 4).map(Number);
    const alpha = match[4] === undefined ? 1 : Number(match[4]);
    if (alpha < 0.35) return false;
    if (tone === "red") return red >= 185 && red >= green + 45 && red >= blue + 20;
    if (tone === "green") return green >= 105 && green >= red + 20 && green >= blue + 10;
    return false;
  }

  function shouldRetryAnswer({ hasRetryButton, wrong, blockingDialog }) {
    return Boolean(hasRetryButton || (wrong && !blockingDialog));
  }

  function isRetryForCurrentQuestion({ hasRetryControl, fingerprintMatches, urlMatches }) {
    return Boolean(fingerprintMatches || (hasRetryControl && urlMatches));
  }

  function isRetryControlText(value) {
    const normalized = String(value || "").replace(/\s+/g, " ").trim();
    return /^Tentar novamente$/i.test(normalized);
  }

  function isTerminalWrongFeedback(value) {
    const normalized = String(value || "").replace(/\s+/g, " ").trim();
    return /\bA alternativa correta [ée](?:\s|$)/i.test(normalized) ||
      /\bConferir gabarito\b/i.test(normalized);
  }

  function nextUntriedRetryPosition(retryPlan, currentPosition, attemptedOptionIndices = []) {
    const plan = Array.isArray(retryPlan) ? retryPlan.map(Number) : [];
    const attempted = new Set(
      (Array.isArray(attemptedOptionIndices) ? attemptedOptionIndices : [])
        .map(Number)
        .filter(Number.isInteger),
    );
    const start = Math.max(0, Number(currentPosition) + 1 || 0);
    for (let position = start; position < plan.length; position += 1) {
      if (Number.isInteger(plan[position]) && !attempted.has(plan[position])) return position;
    }
    return -1;
  }

  function shouldIncludeExerciseCard(statusSignals) {
    const text = String(statusSignals || "");
    return !/(?:^|[^a-z])(?:right|correct|success|completed|complete|finished|done)(?:[^a-z]|$)/i.test(text) &&
      !/\b(?:feito|conclu[ií]do|entregue)\b/i.test(text);
  }

  function nextNavigationRecovery(reachedTarget, retryCount, maxRetries = 2) {
    const currentRetry = Math.max(0, Number(retryCount) || 0);
    const retryLimit = Math.max(0, Number(maxRetries) || 0);
    if (reachedTarget) return { kind: "reached", retryCount: 0 };
    if (currentRetry < retryLimit) return { kind: "retry", retryCount: currentRetry + 1 };
    return { kind: "failed", retryCount: currentRetry };
  }

  function shouldAutoApply(confidence, threshold = 0) {
    const safeConfidence = Number(confidence);
    const safeThreshold = Number(threshold);
    return Number.isFinite(safeConfidence) && Number.isFinite(safeThreshold) && safeConfidence >= safeThreshold;
  }

  function minimumAnswerLengthFromText(value) {
    const match = String(value || "").match(/Mínimo de\s+(\d+)\s+caracteres/i);
    return Math.max(1, Math.min(1_000, Number(match?.[1]) || 1));
  }

  function isSubmissionConfirmationText(value) {
    const normalized = String(value || "").replace(/\s+/g, " ").trim();
    return /^(?:Confirmar|Confirmar envio\??)$/i.test(normalized);
  }

  function classifyOptionOutcome(signals, colorValues = []) {
    const text = String(signals || "");
    return {
      correct:
        /(?:^|[^a-z])(?:right|correct|success)(?:[^a-z]|$)/i.test(text) ||
        colorValues.some((value) => colorMatchesTone(value, "green")),
      wrong:
        /(?:^|[^a-z])(?:wrong|incorrect|error|danger|invalid)(?:[^a-z]|$)/i.test(text) ||
        colorValues.some((value) => colorMatchesTone(value, "red")),
    };
  }

  function isStudyReadingPath(value) {
    return /\/tarefa\/\d+\/leitura(?:\/.*)?$/i.test(String(value || "").replace(/[?#].*$/, ""));
  }

  function isStudyReadingControlText(value) {
    const normalized = String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, " ")
      .trim();
    return normalized.length <= 220 && (
      /^Leia o texto[.!:]?$/i.test(normalized) ||
      /^Leia o texto\b.*\bresponder\b.*\bquestoes?\b/i.test(normalized)
    );
  }

  function isStudySectionTitle(value) {
    const normalized = String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, " ")
      .trim();
    return /^Tarefa de Estudo$/i.test(normalized);
  }

  function buildStudyReadingUrl(taskUrl) {
    const base = String(taskUrl || "").replace(/[?#].*$/, "").replace(/\/+$/, "");
    return /\/tarefa\/\d+$/i.test(base) ? `${base}/leitura/` : null;
  }

  function isStudyResourceControlText(value) {
    const normalized = String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, " ")
      .trim();
    const hasDirectResourceName = /\b(?:apostila|caderno|livro)\b/i.test(normalized);
    const hasGenericResourceName = /\b(?:material|texto|leitura)\b/i.test(normalized);
    const hasOpenAction = /\b(?:abrir|acessar|visualizar|ler|ver)\b/i.test(normalized);
    return normalized.length > 0 && normalized.length <= 320 && (
      hasDirectResourceName || (hasGenericResourceName && hasOpenAction)
    );
  }

  function looksLikeStudyViewerText(value) {
    const normalized = String(value || "").replace(/\s+/g, " ").trim();
    return (
      /\bVisualizar\b/i.test(normalized) &&
      /\b(?:Anotar|Desenhar)\b/i.test(normalized)
    ) || /\bP[aá]gina\s+\d+\s*(?:\/|de)\s*\d+\b/i.test(normalized);
  }

  function isStudyReadingCompleted(statusSignals, colorValues = []) {
    const signals = String(statusSignals || "");
    return (
      /(?:^|[^a-z])(?:complete|completed|done|success|right|finished)(?:[^a-z]|$)/i.test(signals) ||
      colorValues.some((value) => colorMatchesTone(value, "green"))
    );
  }

  function shouldOpenStudyReading(pendingExerciseCount, alreadyCompleted) {
    return Number(pendingExerciseCount || 0) === 0 && !alreadyCompleted;
  }

  function isStudyCompletionTrusted(completionMatchesTask, completionVerified) {
    return Boolean(completionMatchesTask && completionVerified);
  }

  function shouldFinishStudyAfterRedirect(attemptCount, routeRequested) {
    return Boolean(routeRequested) && Math.max(0, Number(attemptCount) || 0) >= 2;
  }

  function isExitControlText(value) {
    return /^Sair$/i.test(String(value || "").replace(/\s+/g, " ").trim());
  }

  root.PlurallFlowCore = Object.freeze({
    buildRetryPlan,
    nextQueueStep,
    isMinimumTaskTitle,
    isComplementaryTaskTitle,
    isSupportedTaskTitle,
    clampPanelPosition,
    colorMatchesTone,
    shouldRetryAnswer,
    isRetryForCurrentQuestion,
    isRetryControlText,
    isTerminalWrongFeedback,
    nextUntriedRetryPosition,
    shouldIncludeExerciseCard,
    nextNavigationRecovery,
    shouldAutoApply,
    minimumAnswerLengthFromText,
    isSubmissionConfirmationText,
    classifyOptionOutcome,
    isStudyReadingPath,
    isStudyReadingControlText,
    isStudySectionTitle,
    buildStudyReadingUrl,
    isStudyResourceControlText,
    looksLikeStudyViewerText,
    isStudyReadingCompleted,
    shouldOpenStudyReading,
    isStudyCompletionTrusted,
    shouldFinishStudyAfterRedirect,
    isExitControlText,
  });
})(globalThis);

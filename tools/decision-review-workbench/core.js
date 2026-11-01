'use strict';

(function init(root) {
  const VERSION = 2;
  const STORAGE_KEY = 'decisionReviewWorkbench.v2';
  const LEGACY_KEY = 'decision-lab-20261026-v1';
  const CALENDAR_TIME_ZONE = 'Asia/Shanghai';
  const BIASES = ['未判断', '信息遗漏', '执行偏差', '过度自信', '锚定', '结果偏差', '外部变化', '其他'];

  function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function isDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
  }

  function isIso(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) return false;
    const date = new Date(value);
    return !Number.isNaN(date.valueOf()) && date.toISOString().replace('.000Z', 'Z') === value.replace('.000Z', 'Z');
  }

  function calendarDay(timestamp) {
    if (!isIso(timestamp)) return null;
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: CALENDAR_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(timestamp));
    const values = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
  }

  function text(value, max) {
    return typeof value === 'string' && value.trim().length > 0 && value.length <= max;
  }

  function uniqueIds(items) {
    if (!Array.isArray(items) || !items.every(isPlainObject)) return false;
    const ids = items.map((item) => item.id);
    return ids.length === new Set(ids).size;
  }

  function validateForecast(value) {
    if (!isPlainObject(value)) return '预测版本必须是对象。';
    if (!Number.isInteger(value.probability) || value.probability < 0 || value.probability > 100) return '概率必须是 0–100 的整数。';
    if (!isDate(value.dueDate)) return '复查日期无效。';
    if (!text(value.reasons, 4000)) return '预测理由须为 1–4000 字。';
    if (typeof value.evidence !== 'string' || value.evidence.length > 4000) return '事前证据不能超过 4000 字。';
    if (!isIso(value.createdAt)) return '预测版本时间无效。';
    return null;
  }

  function validateReview(value) {
    if (value === null) return null;
    if (!isPlainObject(value)) return '结果复查必须是对象。';
    if (value.outcome !== 0 && value.outcome !== 1) return '实际结果只能是发生或未发生。';
    if (!isDate(value.reviewedOn)) return '复查日期无效。';
    if (!isIso(value.reviewedAt)) return '复查写入时间无效。';
    if (!text(value.summary, 4000)) return '复查结论须为 1–4000 字。';
    if (!BIASES.includes(value.bias)) return '偏差分类无效。';
    if (typeof value.nextTest !== 'string' || value.nextTest.length > 4000) return '下一次检验不能超过 4000 字。';
    return null;
  }

  function validateDecision(value, today, now) {
    if (!isPlainObject(value)) return '决策必须是对象。';
    if (!text(value.id, 120)) return '决策编号无效。';
    if (value.origin !== 'user' && value.origin !== 'synthetic') return '记录来源必须是 user 或 synthetic。';
    if (!text(value.title, 200)) return '标题须为 1–200 字。';
    if (!text(value.question, 1000)) return '可检验问题须为 1–1000 字。';
    if (!isIso(value.createdAt)) return '创建时间无效。';
    if (Date.parse(value.createdAt) > Date.parse(now)) return '创建时间不能晚于当前时间。';
    if (!Array.isArray(value.forecastVersions) || value.forecastVersions.length < 1 || value.forecastVersions.length > 50) return '预测版本须为 1–50 条。';
    let previous = value.createdAt;
    for (const forecast of value.forecastVersions) {
      const error = validateForecast(forecast);
      if (error) return error;
      if (Date.parse(forecast.createdAt) < Date.parse(previous)) return '预测版本时间顺序无效。';
      if (Date.parse(forecast.createdAt) > Date.parse(now)) return '预测版本时间不能晚于当前时间。';
      previous = forecast.createdAt;
    }
    const reviewError = validateReview(value.review);
    if (reviewError) return reviewError;
    if (value.review) {
      if (value.review.reviewedOn > today) return '复查日期不能晚于基准日。';
      if (value.review.reviewedOn < calendarDay(previous)) return `复查日期不能早于最后预测版本的${CALENDAR_TIME_ZONE}日历日。`;
      if (Date.parse(value.review.reviewedAt) < Date.parse(previous)) return '复查写入时间不能早于最后一个预测版本。';
      if (Date.parse(value.review.reviewedAt) > Date.parse(now)) return '复查写入时间不能晚于当前时间。';
    }
    return null;
  }

  function validateLegacyNote(value) {
    return isPlainObject(value) && text(value.id, 120) && isIso(value.importedAt) &&
      typeof value.before === 'string' && value.before.length <= 20000 &&
      typeof value.after === 'string' && value.after.length <= 20000;
  }

  function validateState(input, today, now = new Date().toISOString()) {
    const effectiveToday = today || calendarDay(now);
    if (!isDate(effectiveToday) || !isIso(now)) return { ok: false, error: '校验基准时间无效。' };
    if (!isPlainObject(input)) return { ok: false, error: '备份根对象无效。' };
    if (input.version !== VERSION) return { ok: false, error: `只接受版本 ${VERSION} 的备份。` };
    if (typeof input.isSample !== 'boolean') return { ok: false, error: '示例标记无效。' };
    if (!Array.isArray(input.decisions) || input.decisions.length > 5000) return { ok: false, error: '决策列表无效或超过 5000 条。' };
    if (!input.decisions.every(isPlainObject)) return { ok: false, error: '决策列表包含无效条目。' };
    if (!uniqueIds(input.decisions)) return { ok: false, error: '决策编号重复。' };
    for (const decision of input.decisions) {
      const error = validateDecision(decision, effectiveToday, now);
      if (error) return { ok: false, error: `决策 ${decision && decision.id ? decision.id : '未知'}：${error}` };
    }
    const legacyNotes = input.legacyNotes === undefined ? [] : input.legacyNotes;
    if (!Array.isArray(legacyNotes) || legacyNotes.length > 100 || !legacyNotes.every(isPlainObject) || !uniqueIds(legacyNotes) || !legacyNotes.every(validateLegacyNote)) {
      return { ok: false, error: '旧版原文记录无效、重复或超过 100 条。' };
    }
    if (legacyNotes.some((note) => Date.parse(note.importedAt) > Date.parse(now))) return { ok: false, error: '旧版原文导入时间不能晚于当前时间。' };
    const decisions = structuredCloneSafe(input.decisions);
    return { ok: true, value: { version: VERSION, isSample: decisions.some((item) => item.origin === 'synthetic'), decisions, legacyNotes: structuredCloneSafe(legacyNotes) } };
  }

  function structuredCloneSafe(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function emptyState() {
    return { version: VERSION, isSample: false, decisions: [], legacyNotes: [] };
  }

  function makeId(prefix, now, random) {
    return `${prefix}-${now.replace(/\D/g, '').slice(0, 17)}-${random}`;
  }

  function createDecision(input, now = new Date().toISOString(), random = '0001') {
    const decision = {
      id: makeId('decision', now, random),
      origin: 'user',
      title: String(input.title || '').trim(),
      question: String(input.question || '').trim(),
      createdAt: now,
      forecastVersions: [{
        probability: Number(input.probability),
        dueDate: input.dueDate,
        reasons: String(input.reasons || '').trim(),
        evidence: String(input.evidence || '').trim(),
        createdAt: now
      }],
      review: null
    };
    const error = validateDecision(decision, calendarDay(now), now);
    return error ? { ok: false, error } : { ok: true, value: decision };
  }

  function reviseForecast(decision, input, now = new Date().toISOString()) {
    if (decision.review !== null) return { ok: false, error: '已有结果的决策不能修改事前预测。' };
    const next = structuredCloneSafe(decision);
    next.forecastVersions.push({
      probability: Number(input.probability),
      dueDate: input.dueDate,
      reasons: String(input.reasons || '').trim(),
      evidence: String(input.evidence || '').trim(),
      createdAt: now
    });
    const error = validateDecision(next, calendarDay(now), now);
    return error ? { ok: false, error } : { ok: true, value: next };
  }

  function resolveDecision(decision, input, today, now = new Date().toISOString()) {
    if (decision.review !== null) return { ok: false, error: '这条决策已经记录结果。' };
    const effectiveToday = today || calendarDay(now);
    if (!isDate(effectiveToday) || !isIso(now)) return { ok: false, error: '复查基准时间无效。' };
    const next = structuredCloneSafe(decision);
    next.review = {
      outcome: Number(input.outcome),
      reviewedOn: input.reviewedOn,
      reviewedAt: now,
      summary: String(input.summary || '').trim(),
      bias: input.bias,
      nextTest: String(input.nextTest || '').trim()
    };
    const error = validateDecision(next, effectiveToday, now);
    return error ? { ok: false, error } : { ok: true, value: next };
  }

  function activeForecast(decision) {
    return decision.forecastVersions[decision.forecastVersions.length - 1];
  }

  function statusOf(decision, today) {
    if (decision.review) return 'resolved';
    return activeForecast(decision).dueDate <= today ? 'overdue' : 'open';
  }

  function filterDecisions(decisions, filter, today) {
    if (filter === 'all') return decisions.slice();
    return decisions.filter((decision) => statusOf(decision, today) === filter);
  }

  function calibration(decisions, origin = 'user') {
    const eligible = decisions.filter((decision) => decision.review !== null && decision.origin === origin);
    if (!eligible.length) return { count: 0, brier: null, averageProbability: null, outcomeRate: null };
    const pairs = eligible.map((decision) => ({ probability: activeForecast(decision).probability / 100, outcome: decision.review.outcome }));
    const sum = (items) => items.reduce((total, item) => total + item, 0);
    return {
      count: pairs.length,
      brier: sum(pairs.map((pair) => (pair.probability - pair.outcome) ** 2)) / pairs.length,
      averageProbability: sum(pairs.map((pair) => pair.probability)) / pairs.length,
      outcomeRate: sum(pairs.map((pair) => pair.outcome)) / pairs.length
    };
  }

  function parseBackup(textValue, today, now = new Date().toISOString()) {
    let parsed;
    try { parsed = JSON.parse(textValue); } catch (_) { return { ok: false, error: 'JSON 格式无效。' }; }
    try { return validateState(parsed, today || calendarDay(now), now); } catch (_) { return { ok: false, error: '备份结构无效。' }; }
  }

  function parseLegacy(textValue, now = new Date().toISOString(), random = '0001') {
    let parsed;
    try { parsed = JSON.parse(textValue); } catch (_) { return { ok: false, error: '旧版记录不是有效 JSON。' }; }
    if (!isPlainObject(parsed) || typeof parsed.before !== 'string' || typeof parsed.after !== 'string') return { ok: false, error: '旧版记录缺少 before 或 after 原文。' };
    if (!parsed.before.trim() && !parsed.after.trim()) return { ok: false, error: '旧版两份原文都是空白。' };
    if (parsed.before.length > 20000 || parsed.after.length > 20000) return { ok: false, error: '旧版原文超过 20000 字限制。' };
    return { ok: true, value: { id: makeId('legacy', now, random), importedAt: now, before: parsed.before, after: parsed.after } };
  }

  function exportMarkdown(state) {
    const lines = ['# 决策复查工作台导出', '', state.isSample ? '> 本数据包含合成示例；每条记录的来源单独标注，合成记录不得作为真实证据。' : '> 本机记录：内容由使用者录入，未验证真实性。', ''];
    state.decisions.forEach((decision) => {
      lines.push(`## ${decision.title}`, '', `- 编号：${decision.id}`, `- 来源：${decision.origin === 'synthetic' ? '合成示例' : '用户录入'}`, `- 问题：${decision.question}`, `- 决策创建时间：${decision.createdAt}`);
      decision.forecastVersions.forEach((version, index) => lines.push('', `### 预测版本 ${index + 1}`, '', `- 写入时间：${version.createdAt}`, `- 事前概率：${version.probability}%`, `- 复查日期：${version.dueDate}`, `- 理由：${version.reasons}`, `- 事前证据：${version.evidence || '未填写'}`));
      if (decision.review) lines.push('', '### 实际结果', '', `- 实际结果：${decision.review.outcome === 1 ? '发生' : '未发生'}`, `- 自报复查日期：${decision.review.reviewedOn}`, `- 复查写入时间：${decision.review.reviewedAt}`, `- 复查结论：${decision.review.summary}`, `- 偏差分类：${decision.review.bias}`, `- 下一次检验：${decision.review.nextTest || '未填写'}`);
      else lines.push('', '- 实际结果：尚未复查');
      lines.push('');
    });
    if (state.legacyNotes.length) lines.push('## 旧版原文记录', '', `共 ${state.legacyNotes.length} 条。它们没有结构化概率或结果，因此不进入校准统计。`, '');
    return lines.join('\n');
  }

  const api = { VERSION, STORAGE_KEY, LEGACY_KEY, CALENDAR_TIME_ZONE, BIASES, calendarDay, emptyState, validateState, createDecision, reviseForecast, resolveDecision, activeForecast, statusOf, filterDecisions, calibration, parseBackup, parseLegacy, exportMarkdown };
  root.DecisionReviewCore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

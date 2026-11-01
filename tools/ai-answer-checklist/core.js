'use strict';
/* AI 答案核实清单 · 纯逻辑(无 DOM)。 */
(function () {
  const TYPES = ['事实', '数字', '引用', '推断', '建议'];
  const CHECKS = ['可查', '需实验', '无法核实'];
  const STATUSES = ['未核', '已核实', '有误', '存疑'];
  const CRITICAL = ['事实', '数字', '引用'];
  const KINDS = ['self', 'improve', 'cross'];
  const KIND_LABEL = { self: '自我批判', improve: '改进而非推翻', cross: '交叉模型' };
  const NO_MODEL = '(未填模型)';

  const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);

  // ---------- 日期 ----------
  function isValidDate(s) {
    if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    const [y, m, d] = s.split('-').map(Number);
    const t = new Date(Date.UTC(y, m - 1, d));
    if (y < 100) t.setUTCFullYear(y);
    return t.toISOString().slice(0, 10) === s;
  }
  // 解析 ?today=;非法(含 2026-02-30 这类会自动进位的值)回退 fallback,绝不抛错
  function resolveToday(search, fallback) {
    try {
      const q = new URLSearchParams(search || '').get('today');
      if (q !== null && isValidDate(q)) return q;
    } catch (e) { /* 回退 */ }
    return fallback;
  }

  // ---------- URL ----------
  function isHttpUrl(s) {
    if (typeof s !== 'string' || s === '' || /\s/.test(s)) return false;
    try { const u = new URL(s); return u.protocol === 'http:' || u.protocol === 'https:'; } catch (e) { return false; }
  }

  let seq = 0;
  function newId(prefix) {
    seq += 1;
    return `${prefix || 'x'}${Date.now().toString(36)}${seq.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  }

  // ---------- 拆断言 ----------
  // 按 。！？!? ； ; 换行 粗拆;英文句点仅在后跟空白时算句末(避免拆开 3.14)
  function splitClaims(text) {
    const s = String(text ?? '');
    const out = [];
    let buf = '';
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      const isEnd = '。！？!?；;\n\r'.includes(ch) || (ch === '.' && (i + 1 >= s.length || /\s/.test(s[i + 1])));
      if (isEnd) { if (buf.trim()) out.push(buf.trim()); buf = ''; }
      else buf += ch;
    }
    if (buf.trim()) out.push(buf.trim());
    return out;
  }

  // ---------- 校验 ----------
  function claimErrors(c, where) {
    const e = [];
    const w = where || '断言';
    if (!isObj(c)) return [`${w}不是对象`];
    if (typeof c.id !== 'string' || !c.id) e.push(`${w}缺少 id`);
    if (typeof c.text !== 'string') e.push(`${w}的 text 必须是字符串`);
    if (!TYPES.includes(c.type)) e.push(`${w}的类型不合法:${JSON.stringify(c.type)}`);
    if (!CHECKS.includes(c.checkability)) e.push(`${w}的可核实性不合法:${JSON.stringify(c.checkability)}`);
    if (!STATUSES.includes(c.status)) e.push(`${w}的状态不合法:${JSON.stringify(c.status)}`);
    for (const f of ['evidenceText', 'note', 'staleFrom']) if (c[f] !== undefined && typeof c[f] !== 'string') e.push(`${w}的 ${f} 必须是字符串`);
    if (c.evidenceUrl !== undefined) {
      if (typeof c.evidenceUrl !== 'string') e.push(`${w}的 evidenceUrl 必须是字符串`);
      else if (c.evidenceUrl !== '' && !isHttpUrl(c.evidenceUrl)) e.push(`${w}的证据链接只接受 http(s):${c.evidenceUrl.slice(0, 40)}`);
    }
    return e;
  }
  function validateClaim(c) { const errors = claimErrors(c); return { ok: errors.length === 0, errors }; }

  function normClaim(c) {
    const out = { id: c.id, text: c.text, type: c.type, checkability: c.checkability, status: c.status,
      evidenceText: c.evidenceText ?? '', evidenceUrl: c.evidenceUrl ?? '', note: c.note ?? '' };
    if (c.staleFrom) out.staleFrom = c.staleFrom;   // 非空才保存:这条断言的文字在核实之后被改过
    return out;
  }

  // 改断言文字:已核实/有误/存疑的断言文字一变,旧结论不再对应新文字 → 重置为未核,保留旧证据,记下被核实时的原文
  function editClaimText(claim, text) {
    if (text === claim.text) return claim;
    const next = { ...claim, text };
    if (claim.status !== '未核') { next.status = '未核'; next.staleFrom = claim.staleFrom || claim.text; }
    return next;
  }

  // 拆断言之后答案文字又被改过:已有断言可能不再对应当前答案
  function answerChanged(t) {
    return Boolean(t) && Array.isArray(t.claims) && t.claims.length > 0 && typeof t.claimsAnswer === 'string' && t.answer !== t.claimsAnswer;
  }

  // 保存前与读取后共用这一个校验;通过则返回规范化副本
  function validateState(s) {
    const errors = [];
    if (!isObj(s)) return { ok: false, errors: ['数据不是对象'] };
    if (!Array.isArray(s.tasks)) return { ok: false, errors: ['缺少 tasks 数组'] };
    const taskIds = new Set();
    const tasks = [];
    s.tasks.forEach((t, i) => {
      const w = `任务 ${i + 1}`;
      if (!isObj(t)) { errors.push(`${w}不是对象`); return; }
      if (typeof t.id !== 'string' || !t.id) errors.push(`${w}缺少 id`);
      else if (taskIds.has(t.id)) errors.push(`${w}的 id 重复:${t.id}`);
      else taskIds.add(t.id);
      for (const f of ['question', 'answer', 'model']) if (typeof t[f] !== 'string') errors.push(`${w}的 ${f} 必须是字符串`);
      if (t.claimsAnswer !== undefined && typeof t.claimsAnswer !== 'string') errors.push(`${w}的 claimsAnswer 必须是字符串`);
      if (typeof t.date !== 'string' || (t.date !== '' && !isValidDate(t.date))) errors.push(`${w}的日期不合法:${JSON.stringify(t.date)}`);
      if (!Array.isArray(t.claims)) { errors.push(`${w}缺少 claims 数组`); return; }
      if (!Array.isArray(t.rounds)) { errors.push(`${w}缺少 rounds 数组`); return; }
      const cids = new Set();
      t.claims.forEach((c, j) => {
        const cw = `${w}的断言 ${j + 1}`;
        errors.push(...claimErrors(c, cw));
        if (isObj(c) && typeof c.id === 'string' && c.id) {
          if (cids.has(c.id)) errors.push(`${cw}的 id 重复:${c.id}`); else cids.add(c.id);
        }
      });
      const rids = new Set();
      t.rounds.forEach((r, j) => {
        const rw = `${w}的拷问轮次 ${j + 1}`;
        if (!isObj(r)) { errors.push(`${rw}不是对象`); return; }
        if (typeof r.id !== 'string' || !r.id) errors.push(`${rw}缺少 id`);
        else if (rids.has(r.id)) errors.push(`${rw}的 id 重复:${r.id}`); else rids.add(r.id);
        if (!Number.isSafeInteger(r.n) || r.n < 1) errors.push(`${rw}的轮次 n 必须是 >= 1 的整数`);
        if (!KINDS.includes(r.kind)) errors.push(`${rw}的模板不合法:${JSON.stringify(r.kind)}`);
        if (typeof r.summary !== 'string') errors.push(`${rw}的 summary 必须是字符串`);
        if (!Number.isSafeInteger(r.fixed) || r.fixed < 0) errors.push(`${rw}的修正数必须是 >= 0 的整数`);
      });
    });
    if (s.currentId !== null && s.currentId !== undefined && !taskIds.has(s.currentId)) errors.push('currentId 指向不存在的任务');
    if (errors.length) return { ok: false, errors };
    return {
      ok: true, errors: [],
      state: {
        currentId: s.currentId ?? null,
        tasks: s.tasks.map(t => {
          const out = {
            id: t.id, question: t.question, answer: t.answer, model: t.model, date: t.date,
            claims: t.claims.map(normClaim),
            rounds: t.rounds.map(r => ({ id: r.id, n: r.n, kind: r.kind, summary: r.summary, fixed: r.fixed })),
          };
          if (typeof t.claimsAnswer === 'string') out.claimsAnswer = t.claimsAnswer;
          return out;
        }),
      },
    };
  }

  // 导入备份(JSON 字符串或对象):任何不合法即整份拒绝
  function validateImport(input) {
    let data = input;
    if (typeof input === 'string') {
      try { data = JSON.parse(input); } catch (e) { return { ok: false, errors: ['不是合法的 JSON'] }; }
    }
    if (!isObj(data)) return { ok: false, errors: ['备份内容不是对象'] };
    if (data.app !== 'answer-check') return { ok: false, errors: ['不是本工具导出的备份(app 字段应为 answer-check)'] };
    if (data.version !== 1) return { ok: false, errors: [`不支持的备份版本:${JSON.stringify(data.version)}`] };
    const v = validateState(data);
    if (!v.ok) return { ok: false, errors: v.errors };
    return { ok: true, errors: [], tasks: v.state.tasks, currentId: v.state.currentId };
  }

  function exportJson(state) {
    return JSON.stringify({ app: 'answer-check', version: 1, currentId: state.currentId ?? null, tasks: state.tasks }, null, 2);
  }

  // 合并两条断言(b 并入 a):文本、证据、备注都保留;两条各有不同链接时,第二个链接写入证据文本,不丢失
  function mergeClaims(a, b) {
    const join = (x, y, sep) => [x, y].filter(Boolean).join(sep);
    let evidenceUrl = a.evidenceUrl || '';
    let evidenceText = join(a.evidenceText, b.evidenceText, '；');
    if (!evidenceUrl) evidenceUrl = b.evidenceUrl || '';
    else if (b.evidenceUrl && b.evidenceUrl !== evidenceUrl) evidenceText = join(evidenceText, `链接:${b.evidenceUrl}`, '；');
    return { ...a, text: join(a.text, b.text, '，'), evidenceText, evidenceUrl, note: join(a.note, b.note, '；'), status: a.status === b.status ? a.status : '未核' };
  }

  // ---------- 状态规则 ----------
  function answerStatus(claims) {
    const list = Array.isArray(claims) ? claims : [];
    const counts = { total: list.length, 未核: 0, 已核实: 0, 有误: 0, 存疑: 0, checkable: 0, verified: 0, unverifiable: 0, stale: 0 };
    for (const c of list) {
      counts[c.status] += 1;
      if (c.staleFrom) counts.stale += 1;
      if (c.checkability === '无法核实') counts.unverifiable += 1;
      else { counts.checkable += 1; if (c.status === '已核实') counts.verified += 1; }
    }
    const verifyRate = counts.checkable === 0 ? null : counts.verified / counts.checkable;
    const out = (status, reasons) => ({ status, reasons, verifyRate, counts });
    if (list.length === 0) return out('待拆断言', ['还没有断言:先把答案拆成逐条断言']);
    const wrong = list.filter(c => c.status === '有误');
    const critOpen = list.filter(c => CRITICAL.includes(c.type) && c.checkability !== '无法核实' && c.status !== '已核实' && c.status !== '有误');
    const otherOpen = list.filter(c => !CRITICAL.includes(c.type) && c.checkability !== '无法核实' && c.status !== '已核实' && c.status !== '有误');
    const reasons = [];
    if (wrong.length) reasons.push(`有 ${wrong.length} 条断言被核出错误,需要修正`);
    if (critOpen.length) reasons.push(`有 ${critOpen.length} 条事实/数字/引用类断言尚未核实`);
    if (otherOpen.length) reasons.push(`有 ${otherOpen.length} 条推断/建议类断言尚未核实`);
    if (counts.stale) reasons.push(`有 ${counts.stale} 条断言的文字在核实后被改动,已重置为未核,需要重新核实(旧证据保留供对照)`);
    if (counts.unverifiable) reasons.push(`另有 ${counts.unverifiable} 条无法核实的断言(不计入核实率,引用时需注明)`);
    if (wrong.length) return out('需修正', reasons);
    if (critOpen.length) return out('不可引用', reasons);
    if (otherOpen.length) return out('核实中', reasons);
    if (counts.checkable === 0) return out('核实中', ['没有可查/需实验的断言可供核实', ...reasons]);
    return out('可引用', ['所有可查断言均已核实', ...reasons]);
  }

  // ---------- 拷问模板 ----------
  function probePrompt(kind, ctx) {
    if (!KINDS.includes(kind)) throw new Error(`未知拷问模板:${kind}`);
    const c = ctx || {};
    const q = String(c.question ?? '').trim();
    const a = String(c.answer ?? '').trim();
    const model = String(c.model ?? '').trim() || '模型 A';
    const head = q ? `【我的问题】\n${q}\n\n` : '';
    if (kind === 'self') {
      return `请列出上述答案中最可能错的三处及理由。\n\n${head}【上述答案】\n${a}`;
    }
    if (kind === 'improve') {
      const n = Number.isInteger(c.claimIndex) && c.claimIndex >= 1 ? c.claimIndex : null;
      const target = String(c.claimText ?? '').trim();
      const label = n === null ? '第 N 条断言' : `第 ${n} 条断言`;
      return `保留结论,只修正${label}${target ? `:「${target}」` : ''}。其余内容不要改动;请给出修正后的完整表述,并说明修正依据与来源。\n\n${head}【上述答案】\n${a}`;
    }
    const other = String(c.otherAnswer ?? '').trim() || a;
    return `以下是模型 A(${model})的答案,请逐条指出错误并给来源。无法确认的地方请明说,不要编造来源。\n\n${head}【模型 A 的答案】\n${other}`;
  }

  // ---------- 统计 ----------
  function roundStats(rounds) {
    const list = (Array.isArray(rounds) ? rounds : []).slice().sort((x, y) => x.n - y.n);
    const byKind = Object.create(null);
    for (const k of KINDS) byKind[k] = { rounds: 0, fixed: 0 };
    let totalFixed = 0;
    for (const r of list) { byKind[r.kind].rounds += 1; byKind[r.kind].fixed += r.fixed; totalFixed += r.fixed; }
    return { count: list.length, totalFixed, perRound: list.map(r => ({ n: r.n, kind: r.kind, fixed: r.fixed })), byKind };
  }

  // 错误率 = 有误 /(已核实 + 有误)。未核/存疑不进分母
  function modelStats(tasks) {
    const m = new Map();
    for (const t of Array.isArray(tasks) ? tasks : []) {
      const name = String(t.model ?? '').trim() || NO_MODEL;
      if (!m.has(name)) m.set(name, { model: name, tasks: 0, claims: 0, verified: 0, wrong: 0, errorRate: null });
      const s = m.get(name);
      s.tasks += 1;
      for (const c of t.claims || []) {
        s.claims += 1;
        if (c.status === '已核实') s.verified += 1;
        if (c.status === '有误') s.wrong += 1;
      }
    }
    const out = [...m.values()];
    for (const s of out) { const d = s.verified + s.wrong; s.errorRate = d === 0 ? null : s.wrong / d; }
    return out.sort((a, b) => (b.errorRate ?? -1) - (a.errorRate ?? -1) || a.model.localeCompare(b.model, 'zh'));
  }

  // ---------- 导出 ----------
  // 以 = + - @(及制表/回车)开头的用户字段加单引号前缀;单独的 - 或 + 不算
  function guard(v) {
    const s = String(v ?? '');
    if (/^[=@\t\r]/.test(s)) return "'" + s;
    if (/^[+-]/.test(s) && s.length > 1) return "'" + s;
    return s;
  }
  const mdCell = v => guard(v).replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n|\r/g, ' ');
  const csvCell = v => {
    const s = guard(v);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const pct = r => (r === null ? '—' : `${Math.round(r * 1000) / 10}%`);
  // 核实率 = 已核实的(可查 + 需实验)断言 ÷ 全部(可查 + 需实验)断言;无法核实的不计入。把分子分母写出来,读者能自己复算
  function rateText(r) {
    const c = r.counts;
    const unv = c.unverifiable ? `;另有 ${c.unverifiable} 条无法核实,不计入` : '';
    if (c.checkable === 0) return `—(分母为 0:没有可查/需实验的断言${unv})`;
    return `${pct(r.verifyRate)}(${c.verified} ÷ ${c.checkable}:已核实的可查/需实验断言 ÷ 全部可查/需实验断言${unv})`;
  }
  const statusCell = c => c.status + (c.staleFrom ? '(待重新核实)' : '');

  function toMarkdown(task) {
    const t = task || { question: '', answer: '', model: '', date: '', claims: [], rounds: [] };
    const st = answerStatus(t.claims);
    const L = [];
    L.push('# AI 答案核实报告', '');
    L.push(`- 问题:${(t.question || '(未填)').replace(/\r?\n/g, ' ')}`);
    L.push(`- 模型:${(t.model || NO_MODEL).replace(/\r?\n/g, ' ')}`);
    L.push(`- 日期:${t.date || '(未填)'}`, '');
    L.push(`## 结论状态:${st.status}`, '');
    for (const r of st.reasons) L.push(`- ${r}`);
    L.push('', '## 统计', '');
    L.push(`- 断言数:${st.counts.total}`);
    L.push(`- 已核实 ${st.counts.已核实} / 有误 ${st.counts.有误} / 存疑 ${st.counts.存疑} / 未核 ${st.counts.未核}`);
    L.push(`- 核实率:${rateText(st)}`, '');
    L.push('## 断言表', '');
    if (!t.claims.length) L.push('(没有断言)');
    else {
      L.push('| # | 断言 | 类型 | 可核实性 | 状态 | 证据 | 备注 |', '| --- | --- | --- | --- | --- | --- | --- |');
      t.claims.forEach((c, i) => {
        const ev = [c.evidenceText, c.evidenceUrl].filter(Boolean).join(' ');
        L.push(`| ${i + 1} | ${mdCell(c.text)} | ${c.type} | ${c.checkability} | ${statusCell(c)} | ${mdCell(ev)} | ${mdCell(c.note)} |`);
      });
    }
    const stale = t.claims.map((c, i) => [c, i + 1]).filter(([c]) => c.staleFrom);
    if (stale.length) {
      L.push('', '## 待重新核实的断言(文字在核实后被改动,旧证据仅供对照)', '');
      for (const [c, i] of stale) L.push(`- 第 ${i} 条,原文:${guard(c.staleFrom).replace(/\r?\n/g, ' ')}`);
    }
    const un = t.claims.map((c, i) => [c, i + 1]).filter(([c]) => c.checkability === '无法核实');
    L.push('', '## 无法核实的断言(不计入核实率)', '');
    if (!un.length) L.push('(无)');
    else for (const [c, i] of un) L.push(`- 第 ${i} 条:${guard(c.text).replace(/\r?\n/g, ' ')}`);
    L.push('', '## 拷问轮次', '');
    const rs = roundStats(t.rounds);
    if (!rs.count) L.push('(没有拷问记录)');
    else {
      L.push('| 轮次 | 模板 | 修正数 | 结果摘要 |', '| --- | --- | --- | --- |');
      for (const r of t.rounds.slice().sort((a, b) => a.n - b.n)) L.push(`| 第 ${r.n} 轮 | ${KIND_LABEL[r.kind]} | ${r.fixed} | ${mdCell(r.summary)} |`);
      L.push('', `合计修正 ${rs.totalFixed} 处。`);
    }
    L.push('', '> 核实靠人:本工具不联网、不调用模型,只记录你的核实结果。');
    return L.join('\n') + '\n';
  }

  const CSV_HEAD = ['任务ID', '问题', '模型', '日期', '答案状态', '序号', '断言', '类型', '可核实性', '状态', '证据来源', '证据链接', '备注'];
  function toCsv(tasks) {
    const rows = [CSV_HEAD.map(csvCell).join(',')];
    for (const t of Array.isArray(tasks) ? tasks : []) {
      const st = answerStatus(t.claims).status;
      t.claims.forEach((c, i) => {
        rows.push([t.id, t.question, t.model, t.date, st, i + 1, c.text, c.type, c.checkability, statusCell(c), c.evidenceText, c.evidenceUrl, c.note].map(csvCell).join(','));
      });
    }
    return rows.join('\r\n') + '\r\n';
  }

  const api = {
    TYPES, CHECKS, STATUSES, CRITICAL, KINDS, KIND_LABEL, NO_MODEL,
    isValidDate, resolveToday, isHttpUrl, newId,
    splitClaims, mergeClaims, editClaimText, answerChanged, rateText, validateClaim, validateState, validateImport, exportJson,
    answerStatus, probePrompt, roundStats, modelStats, guard, toMarkdown, toCsv,
  };
  globalThis.AnswerCheckCore = api;
  if (typeof module !== 'undefined') module.exports = api;
})();

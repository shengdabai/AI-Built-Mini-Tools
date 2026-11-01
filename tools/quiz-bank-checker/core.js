'use strict';
/* 题库答案核对 · 纯逻辑(无 DOM)。单选题;所有检查都是确定性规则。 */
(function () {
  const LEVEL_LABEL = { block: '阻断', warn: '警告' };
  const RULE_NAMES = {
    'stem-empty': '题干为空',
    'id-missing': '题号为空',
    'id-duplicate': '题号重复',
    'options-few': '选项数不足',
    'option-empty': '选项文字为空',
    'option-duplicate': '选项文字重复',
    'answer-empty': '答案为空',
    'answer-range': '答案越界',
    'length-trap': '答案长度异常',
    'letter-skew': '答案字母失衡',
    'negation-mismatch': '否定题干疑似不符',
    'stem-similar': '题干重复',
    'topic-empty': '知识点为空',
    'all-above': '含「以上都对/都不对」'
  };
  const LENGTH_HIGH = 1.6; // 答案长度 > 其他选项平均 × 1.6
  const LENGTH_LOW = 0.6;  // 答案长度 < 其他选项平均 × 0.6
  const SKEW_RATIO = 0.4;  // 某字母占比 > 40%
  const ALL_ABOVE = /以上(都|均|皆|全部)?(对|不对|正确|错误|不正确|都是)|都不对|全部正确/;

  const clean = v => String(v == null ? '' : v).replace(/\r\n?/g, '\n').trim();
  const letterOf = i => String.fromCharCode(65 + i);
  function normText(s) {
    return String(s == null ? '' : s).normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
  }
  function normAnswer(s) {
    let t = clean(s).normalize('NFKC').replace(/[\s.。、,，;；]+$/u, '').trim().toUpperCase();
    return t;
  }
  function answerIndex(q) {
    const a = q.answer;
    if (!/^[A-Z]$/.test(a || '')) return -1;
    const i = a.charCodeAt(0) - 65;
    return i < q.options.length ? i : -1;
  }
  function mkQuestion(o) {
    const options = (o.options || []).map(clean);
    while (options.length && options[options.length - 1] === '') options.pop();
    return {
      id: clean(o.id), stem: clean(o.stem), options,
      answer: normAnswer(o.answer), topic: clean(o.topic), difficulty: clean(o.difficulty)
    };
  }

  // ---------- CSV / TSV ----------
  function parseDelimited(text) {
    let s = String(text == null ? '' : text).replace(/^﻿/, '');
    const firstLine = s.split('\n', 1)[0];
    const tabs = (firstLine.match(/\t/g) || []).length, commas = (firstLine.match(/,/g) || []).length;
    const delimiter = tabs > 0 && tabs >= commas ? '\t' : ',';
    const rows = []; let row = [], cell = '', inQ = false;
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (inQ) {
        if (ch === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else inQ = false; }
        else cell += ch;
      } else if (ch === '"' && cell === '') inQ = true;
      else if (ch === delimiter) { row.push(cell); cell = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && s[i + 1] === '\n') i++;
        row.push(cell); cell = ''; rows.push(row); row = [];
      } else cell += ch;
    }
    if (inQ) return { headers: [], rows: [], delimiter, error: '引号没有闭合:某个单元格以 " 开头但找不到结尾的 ",请检查后重新粘贴。' };
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    const nonEmpty = rows.filter(r => r.some(c => clean(c) !== ''));
    if (!nonEmpty.length) return { headers: [], rows: [], delimiter };
    return { headers: nonEmpty[0].map(clean), rows: nonEmpty.slice(1), delimiter };
  }

  function autoMapping(headers) {
    const m = { id: -1, stem: -1, options: [], answer: -1, topic: -1, difficulty: -1 };
    headers.forEach((h, i) => {
      const t = clean(h);
      if (/^(选项\s*)?[A-Za-z]$/.test(t) || /^选项\s*[A-Za-z0-9]+$/.test(t) || /^option\s*[A-Za-z0-9]+$/i.test(t)) m.options.push(i);
      else if (m.id < 0 && /题号|编号|序号|^id$|^no\.?$/i.test(t)) m.id = i;
      else if (m.stem < 0 && /题干|题目|问题|^stem$|^question$/i.test(t)) m.stem = i;
      else if (m.answer < 0 && /答案|正确|^answer$/i.test(t)) m.answer = i;
      else if (m.topic < 0 && /知识点|章节|主题|^topic$|^chapter$/i.test(t)) m.topic = i;
      else if (m.difficulty < 0 && /难度|^difficulty$|^level$/i.test(t)) m.difficulty = i;
    });
    return m;
  }

  function validateMapping(mapping, width) {
    const errors = [];
    const m = mapping || {};
    const single = ['id', 'stem', 'answer', 'topic', 'difficulty'];
    const used = new Map();
    const inRange = v => Number.isInteger(v) && v >= 0 && v < width;
    for (const k of single) {
      const v = m[k] == null ? -1 : m[k];
      if (v === -1) continue;
      if (!inRange(v)) { errors.push(`列映射「${k}」指向不存在的列(${v})。`); continue; }
      if (used.has(v)) errors.push(`第 ${v + 1} 列同时被用作「${used.get(v)}」与「${k}」。`);
      else used.set(v, k);
    }
    if (m.stem == null || m.stem === -1) errors.push('必须指定题干列。');
    const opts = Array.isArray(m.options) ? m.options : [];
    if (opts.length < 2) errors.push('至少需要 2 列选项。');
    opts.forEach(v => {
      if (!inRange(v)) errors.push(`选项列指向不存在的列(${v})。`);
      else if (used.has(v)) errors.push(`第 ${v + 1} 列同时被用作「${used.get(v)}」与选项。`);
      else used.set(v, '选项');
    });
    if (new Set(opts).size !== opts.length) errors.push('选项列重复。');
    return errors;
  }

  function parseCsvBank(parsed, mapping) {
    if (parsed && parsed.error) return { questions: [], errors: [parsed.error] };
    const rows = parsed && parsed.rows ? parsed.rows : [];
    const width = Math.max((parsed && parsed.headers ? parsed.headers.length : 0), ...rows.map(r => r.length), 0);
    const errors = validateMapping(mapping, width);
    if (errors.length) return { questions: [], errors };
    if (!rows.length) return { questions: [], errors: ['没有数据行。'] };
    const cell = (r, i) => (i == null || i < 0 ? '' : r[i] == null ? '' : r[i]);
    const opts = mapping.options.slice().sort((a, b) => a - b);
    const questions = rows.map((r, n) => mkQuestion({
      id: mapping.id == null || mapping.id < 0 ? String(n + 1) : cell(r, mapping.id),
      stem: cell(r, mapping.stem),
      options: opts.map(i => cell(r, i)),
      answer: cell(r, mapping.answer),
      topic: cell(r, mapping.topic),
      difficulty: cell(r, mapping.difficulty)
    }));
    return { questions, errors: [] };
  }

  // ---------- 纯文本块 ----------
  const RE_QSTART = /^\s*(?:第\s*)?(\d+)\s*[.、．)）:：]\s*(.*)$/;
  const RE_OPT = /^\s*([A-Za-z])\s*[.、．)）:：]\s*(.*)$/;
  const RE_ANS = /^\s*(?:正确答案|答案|answer)\s*[:：]?\s*(.*)$/i;
  const RE_TOPIC = /^\s*(?:知识点|章节)\s*[:：]\s*(.*)$/;
  const RE_DIFF = /^\s*难度\s*[:：]\s*(.*)$/;

  function parseTextBank(text) {
    const blocks = String(text == null ? '' : text).replace(/^﻿/, '').replace(/\r\n?/g, '\n')
      .split(/\n[ \t]*\n+/).map(b => b.split('\n').map(l => l.replace(/\s+$/, '')).filter(l => l.trim() !== '')).filter(b => b.length);
    const questions = [];
    blocks.forEach((lines, bi) => {
      const q = { id: '', stemLines: [], options: [], answer: '', topic: '', difficulty: '' };
      let phase = 'stem', hasId = false;
      lines.forEach((line, li) => {
        let m;
        if (li === 0 && (m = line.match(RE_QSTART))) { q.id = m[1]; hasId = true; line = m[2]; m = null; if (!line.trim()) return; }
        if ((m = line.match(RE_ANS))) { q.answer = m[1]; phase = 'after'; return; }
        if ((m = line.match(RE_TOPIC))) { q.topic = m[1]; phase = 'after'; return; }
        if ((m = line.match(RE_DIFF))) { q.difficulty = m[1]; phase = 'after'; return; }
        if (phase !== 'after' && (m = line.match(RE_OPT)) && m[1].toUpperCase() === letterOf(q.options.length)) {
          q.options.push(m[2]); phase = 'options'; return;
        }
        if (phase === 'options' && q.options.length) { q.options[q.options.length - 1] += ' ' + line.trim(); return; }
        if (phase === 'stem') q.stemLines.push(line.trim());
      });
      questions.push(mkQuestion({
        id: hasId ? q.id : String(bi + 1), stem: q.stemLines.join('\n'), options: q.options,
        answer: q.answer, topic: q.topic, difficulty: q.difficulty
      }));
    });
    if (!questions.length) return { questions: [], errors: ['没有识别到题目。'] };
    return { questions, errors: [] };
  }

  // ---------- 检查 ----------
  function check(questions) {
    const qs = Array.isArray(questions) ? questions : [];
    const issues = [];
    const add = (i, level, code, message) => issues.push({ qIndex: i, qid: i >= 0 ? qs[i].id : '', level, code, message });

    const idGroups = new Map(), stemGroups = new Map();
    qs.forEach((q, i) => {
      if (q.id) { if (!idGroups.has(q.id)) idGroups.set(q.id, []); idGroups.get(q.id).push(i); }
      const ns = normText(q.stem);
      if (ns) { if (!stemGroups.has(ns)) stemGroups.set(ns, []); stemGroups.get(ns).push(i); }
    });

    qs.forEach((q, i) => {
      if (!clean(q.stem)) add(i, 'block', 'stem-empty', '题干为空。');
      if (!q.id) add(i, 'warn', 'id-missing', '题号为空。');
      else if (idGroups.get(q.id).length > 1) {
        const others = idGroups.get(q.id).filter(j => j !== i).map(j => `第 ${j + 1} 行`).join('、');
        add(i, 'block', 'id-duplicate', `题号「${q.id}」与${others}重复。`);
      }
      const filled = q.options.filter(o => o !== '');
      if (filled.length < 2) add(i, 'block', 'options-few', `有效选项只有 ${filled.length} 个,至少需要 2 个。`);
      q.options.forEach((o, k) => { if (o === '') add(i, 'block', 'option-empty', `选项 ${letterOf(k)} 的文字为空。`); });
      const seen = new Map();
      q.options.forEach((o, k) => {
        const n = normText(o); if (!n) return;
        if (seen.has(n)) add(i, 'block', 'option-duplicate', `选项 ${letterOf(seen.get(n))} 与 ${letterOf(k)} 文字重复。`);
        else seen.set(n, k);
      });
      const ai = answerIndex(q);
      if (!q.answer) add(i, 'block', 'answer-empty', '答案为空。');
      else if (ai < 0) {
        const why = /^[A-Z]$/.test(q.answer) ? `只有 ${q.options.length} 个选项` : '不是单个选项字母(本工具只支持单选)';
        add(i, 'block', 'answer-range', `答案「${q.answer}」不在选项范围内:${why}。`);
      }
      if (ai >= 0 && q.options[ai] !== '') {
        const others = q.options.filter((o, k) => k !== ai && o !== '');
        if (others.length >= 1) {
          const sum = others.reduce((s, o) => s + o.length, 0), len = q.options[ai].length;
          if (len * 10 * others.length > LENGTH_HIGH * 10 * sum)
            add(i, 'warn', 'length-trap', `正确答案 ${letterOf(ai)} 明显比其他选项长(${len} 字,其他平均 ${(sum / others.length).toFixed(1)} 字),可能被「选最长的」猜中。`);
          else if (len * 10 * others.length < LENGTH_LOW * 10 * sum)
            add(i, 'warn', 'length-trap', `正确答案 ${letterOf(ai)} 明显比其他选项短(${len} 字,其他平均 ${(sum / others.length).toFixed(1)} 字)。`);
        }
        if (/以下哪项不|下列哪项不|以下哪个不|下列哪个不/.test(q.stem) && !/[不没非无否]|错误/.test(q.options[ai]))
          add(i, 'warn', 'negation-mismatch', '题干问「哪项不…」,但答案是肯定句。仅提示,请人工确认。');
      }
      const ns = normText(q.stem);
      if (ns && stemGroups.get(ns).length > 1) {
        const others = stemGroups.get(ns).filter(j => j !== i).map(j => `第 ${j + 1} 行`).join('、');
        add(i, 'warn', 'stem-similar', `题干(忽略空白与标点后)与${others}相同。`);
      }
      if (!q.topic) add(i, 'warn', 'topic-empty', '知识点为空。');
      if (q.options.some(o => ALL_ABOVE.test(o))) add(i, 'warn', 'all-above', '选项含「以上都对/都不对」一类表述。');
    });

    const stats = computeStats(qs);
    const valid = stats.validAnswerCount;
    if (valid >= 1) {
      stats.letters.forEach(l => {
        if (l.count * 10 > valid * SKEW_RATIO * 10)
          add(-1, 'warn', 'letter-skew', `答案字母 ${l.letter} 占 ${l.count}/${valid}(${Math.round(l.count / valid * 100)}%),超过 40%。可用「打乱选项」改善。`);
      });
    }
    issues.sort((a, b) => (a.qIndex - b.qIndex) || (a.level === b.level ? 0 : a.level === 'block' ? -1 : 1));
    return { issues, stats };
  }

  function countBy(items) {
    const m = new Map();
    items.forEach(x => m.set(x, (m.get(x) || 0) + 1));
    return Array.from(m, ([name, count]) => ({ name, count }));
  }
  function computeStats(qs) {
    const maxOpts = Math.max(4, ...qs.map(q => q.options.length));
    const counts = new Array(maxOpts).fill(0);
    let valid = 0;
    qs.forEach(q => { const i = answerIndex(q); if (i >= 0) { counts[i]++; valid++; } });
    return {
      total: qs.length,
      validAnswerCount: valid,
      letters: counts.map((count, i) => ({ letter: letterOf(i), count, ratio: valid ? count / valid : 0 })),
      topics: countBy(qs.map(q => q.topic || '(未填)')),
      difficulties: countBy(qs.map(q => q.difficulty || '(未填)'))
    };
  }

  // ---------- 打乱 ----------
  function seedToInt(seed) {
    const s = String(seed == null ? '' : seed);
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function mulberry32(a) {
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function canShuffle(q) {
    return answerIndex(q) >= 0 && q.options.length >= 2 && q.options.every(o => o !== '');
  }
  /* 不修改入参。答案不合法或有空选项的题原样保留(先修复再打乱)。
     「以上都对/都不对」类选项固定在末尾,避免打乱后语义错位。 */
  function shuffle(questions, seed) {
    const rand = mulberry32(seedToInt(seed));
    return (questions || []).map(q => {
      if (!canShuffle(q)) return Object.assign({}, q, { options: q.options.slice() });
      const idx = q.options.map((_, i) => i);
      const free = idx.filter(i => !ALL_ABOVE.test(q.options[i]));
      const pinned = idx.filter(i => ALL_ABOVE.test(q.options[i]));
      for (let i = free.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [free[i], free[j]] = [free[j], free[i]];
      }
      const order = free.concat(pinned);
      const ai = answerIndex(q);
      return Object.assign({}, q, { options: order.map(i => q.options[i]), answer: letterOf(order.indexOf(ai)) });
    });
  }

  // ---------- 导出 ----------
  function guard(v) {
    const s = String(v == null ? '' : v);
    return /^[=+\-@\t\r]/.test(s) && s.length > 1 ? "'" + s : s;
  }
  const csvCell = v => { const s = guard(v); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const csvLine = arr => arr.map(csvCell).join(',');
  const mdCell = v => guard(v).replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\n/g, ' ');

  function toCsv(questions) {
    const qs = questions || [];
    const n = Math.max(4, ...qs.map(q => q.options.length));
    const head = ['题号', '题干'].concat(Array.from({ length: n }, (_, i) => '选项' + letterOf(i)), ['答案', '知识点', '难度']);
    const lines = [csvLine(head)];
    qs.forEach(q => lines.push(csvLine([q.id, q.stem].concat(Array.from({ length: n }, (_, i) => q.options[i] || ''), [q.answer, q.topic, q.difficulty]))));
    return lines.join('\n') + '\n';
  }

  function issuesToCsv(issues) {
    const lines = [csvLine(['级别', '行号', '题号', '规则', '说明'])];
    (issues || []).forEach(it => lines.push(csvLine([LEVEL_LABEL[it.level], it.qIndex >= 0 ? it.qIndex + 1 : '', it.qid, RULE_NAMES[it.code] || it.code, it.message])));
    return lines.join('\n') + '\n';
  }

  function issuesToMarkdown(issues, stats) {
    const list = issues || [];
    const nb = list.filter(i => i.level === 'block').length, nw = list.length - nb;
    const out = ['# 题库问题清单', '', `共 ${stats ? stats.total : 0} 题;阻断 ${nb} 条,警告 ${nw} 条。`, ''];
    if (stats) {
      out.push('## 统计', '', '答案字母分布:' + stats.letters.map(l => `${l.letter} ${l.count}`).join(' / '), '');
      out.push('知识点题数:' + (stats.topics.map(t => `${t.name} ${t.count}`).join(';') || '无'), '');
      out.push('难度分布:' + (stats.difficulties.map(t => `${t.name} ${t.count}`).join(';') || '无'), '');
    }
    out.push('## 问题', '');
    if (!list.length) out.push('没有发现问题。');
    else {
      out.push('| 级别 | 行号 | 题号 | 规则 | 说明 |', '| --- | --- | --- | --- | --- |');
      list.forEach(it => out.push(`| ${LEVEL_LABEL[it.level]} | ${it.qIndex >= 0 ? it.qIndex + 1 : '全库'} | ${mdCell(it.qid)} | ${RULE_NAMES[it.code] || it.code} | ${mdCell(it.message)} |`));
    }
    return out.join('\n') + '\n';
  }

  function toExamMarkdown(questions, title) {
    const qs = questions || [];
    const out = ['# ' + (title || '选择题试卷'), '', '姓名:__________  得分:__________', ''];
    qs.forEach((q, i) => {
      out.push(`**${i + 1}.** ${q.stem.replace(/\n/g, ' ')}`, '');
      q.options.forEach((o, k) => out.push(`- ${letterOf(k)}. ${o}`));
      out.push('');
    });
    out.push('<div style="page-break-before: always"></div>', '', '## 参考答案', '');
    qs.forEach((q, i) => out.push(`${i + 1}. ${q.answer || '(缺)'}`));
    return out.join('\n') + '\n';
  }

  // ---------- 本地数据校验(从 localStorage 读回时拒绝坏数据) ----------

  /* 阻断/警告数量与导出前提示 */
  function issueSummary(issues) {
    const list = issues || [];
    const block = list.filter(i => i.level === 'block').length;
    const warn = list.filter(i => i.level === 'warn').length;
    const head = block === 0 ? `当前版本没有阻断问题，有 ${warn} 个警告。` : `当前版本有 ${block} 个阻断问题、${warn} 个警告。`;
    return { block, warn, text: head + '打乱选项不会修复答案越界、答案为空、题号重复等问题，它们需要回到源文件修改后重新导入。' };
  }
  /* 导入确认前的预览文字 */
  function importPreview(current, incoming) {
    const cur = current && Array.isArray(current.bank) ? current.bank : [];
    const inc = Array.isArray(incoming) ? incoming : [];
    const blockCount = check(inc).issues.filter(i => i.level === 'block').length;
    const hasShuffled = !!(current && current.shuffled);
    const replaceText = cur.length
      ? `确认后会替换现有 ${cur.length} 题${hasShuffled ? `和种子「${current.shuffled.seed}」的打乱结果` : ''}，不能撤销`
      : '现有题库为空，确认后直接写入';
    return { incoming: inc.length, replacing: cur.length, hasShuffled, blockCount,
      text: `解析出 ${inc.length} 题，其中 ${blockCount} 个阻断问题（导入后可在问题清单查看）。${replaceText}。` };
  }

  function validateStored(obj) {
    const err = [];
    const chk = (list, name) => {
      if (!Array.isArray(list)) { err.push(`${name} 不是数组。`); return; }
      list.forEach((q, i) => {
        const ok = q && typeof q === 'object' && ['id', 'stem', 'answer', 'topic', 'difficulty'].every(k => typeof q[k] === 'string') &&
          Array.isArray(q.options) && q.options.every(o => typeof o === 'string');
        if (!ok) err.push(`${name} 第 ${i + 1} 项字段类型不合法。`);
      });
    };
    if (!obj || typeof obj !== 'object') return { ok: false, errors: ['数据不是对象。'] };
    chk(obj.bank, 'bank');
    if (obj.shuffled != null) {
      if (typeof obj.shuffled !== 'object') err.push('shuffled 不合法。');
      else { if (typeof obj.shuffled.seed !== 'string') err.push('shuffled.seed 不是字符串。'); chk(obj.shuffled.questions, 'shuffled.questions'); }
    }
    if (obj.view != null && !['original', 'shuffled'].includes(obj.view)) err.push('view 取值不合法。');
    if (obj.sample != null && typeof obj.sample !== 'boolean') err.push('sample 不是布尔值。');
    if (obj.view === 'shuffled' && !obj.shuffled) err.push('view 为 shuffled 但没有打乱结果。');
    return { ok: !err.length, errors: err };
  }

  /* 选文件后、写入粘贴框前的检查:空文件、无法按 UTF-8 解码的文件(出现替换字符 U+FFFD)直接拒绝并说明原因 */
  function checkTextFile(text) {
    const s = String(text == null ? '' : text);
    if (s.trim() === '') return { ok: false, code: 'empty', message: '文件是空的,没有读到内容。' };
    if (s.indexOf('\uFFFD') !== -1) return { ok: false, code: 'encoding', message: '文件含无法识别的字符,可能不是 UTF-8 编码。请在表格软件里另存为「CSV UTF-8」后再试。' };
    return { ok: true, code: '', message: '' };
  }

  /* 示例题库导出的 CSV 末尾会追加一行 SAMPLE_NOTE 作标注。导入时识别并去掉这一行(同时把导入结果记为示例),
     否则它会被当成多出来的一道题,导出再导入就和原题库不一致 */
  const SAMPLE_NOTE = '合成示例数据,不是真实题目';
  function splitSampleNote(text) {
    const s = String(text == null ? '' : text);
    const lines = s.split(/\r?\n/);
    let i = lines.length - 1;
    while (i >= 0 && lines[i].trim() === '') i--;
    if (i < 1 || lines[i].trim() !== SAMPLE_NOTE) return { text: s, sample: false };
    return { text: lines.slice(0, i).join('\n') + '\n', sample: true };
  }

  const api = {
    checkTextFile, SAMPLE_NOTE, splitSampleNote,
    LEVEL_LABEL, RULE_NAMES, parseDelimited, autoMapping, validateMapping, parseCsvBank, parseTextBank,
    check, shuffle, canShuffle, toCsv, issuesToCsv, issuesToMarkdown, toExamMarkdown, validateStored, issueSummary, importPreview, guard, normText, answerIndex
  };
  globalThis.QbCore = api;
  if (typeof module !== 'undefined') module.exports = api;
})();

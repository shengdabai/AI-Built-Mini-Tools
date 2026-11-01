/* AI 提问规格生成器 · 纯逻辑(无 DOM)。 */
(function () {
  'use strict';

  var KINDS = ['范围', '禁止项', '格式', '长度', '语言', '受众', '已知事实', '已有材料'];
  var DEFAULT_VAGUE = ['优秀', '高质量', '专业', '优质', '合适', '恰当', '合理', '漂亮', '地道', '全面', '到位', '满意', '有深度', '清晰', '好'];
  var LENGTH_LIMIT = 1500;
  var NEGATIONS = ['不要', '禁止', '不得', '不能', '不许', '避免', '切勿', '请勿', '严禁', '不出现', '不包含', '不使用', '不含', '不用', '勿'];
  var FILLERS = ['必须', '需要', '务必', '使用', '包含', '包括', '出现', '含有', '要求', '应该', '应当', '可以', '不可'];

  function str(v) { return typeof v === 'string' ? v : ''; }
  function len(s) { return Array.from(str(s)).length; }
  function trim(s) { return str(s).trim(); }

  /* ---------- 严格日期 ---------- */
  function parseToday(s) {
    if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
    var d = new Date(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)));
    if (isNaN(d.getTime())) return null;
    return d.toISOString().slice(0, 10) === s ? s : null;
  }

  /* ---------- 结构 ---------- */
  function blankSpec(id, today) {
    return {
      id: id, title: '', tags: [], task: '',
      constraints: [], criteria: [],
      output: '', role: '', tone: '',
      createdAt: today || '', updatedAt: today || ''
    };
  }

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  function totalChars(spec) {
    var n = len(spec.task) + len(spec.output) + len(spec.role) + len(spec.tone);
    (spec.constraints || []).forEach(function (c) { n += len(c.text); });
    (spec.criteria || []).forEach(function (c) { n += len(c.text) + len(c.check); });
    return n;
  }

  /* ---------- 模糊词 ---------- */
  function vagueWords(text, list) {
    var words = Array.isArray(list) ? list : DEFAULT_VAGUE;
    var t = str(text);
    var out = [];
    words.forEach(function (w) {
      if (w && t.indexOf(w) !== -1 && out.indexOf(w) === -1) out.push(w);
    });
    return out;
  }

  /* ---------- 冲突 ---------- */
  function startsNegated(text) {
    var t = trim(text);
    return NEGATIONS.some(function (n) { return t.indexOf(n) === 0; });
  }
  function keywordsOf(text) {
    var t = str(text).toLowerCase();
    NEGATIONS.concat(FILLERS).sort(function (a, b) { return b.length - a.length; }).forEach(function (w) {
      t = t.split(w).join('|');
    });
    return t.split(/[|\s,，、;；。.:：!！?？()（）“”"'「」『』\/\\]+/).filter(function (k) { return k.length > 0; });
  }
  function conflicts(constraints, criteria) {
    var forbidden = (constraints || []).filter(function (c) { return c && c.kind === '禁止项' && trim(c.text); });
    var required = [];
    (constraints || []).forEach(function (c) {
      if (c && c.kind !== '禁止项' && trim(c.text) && !startsNegated(c.text)) required.push({ source: '限定条件(' + c.kind + ')', text: c.text });
    });
    (criteria || []).forEach(function (c) {
      if (c && trim(c.text) && !startsNegated(c.text)) required.push({ source: '验收标准', text: c.text });
    });
    var seen = new Map();
    var out = [];
    forbidden.forEach(function (f) {
      keywordsOf(f.text).forEach(function (k) {
        required.forEach(function (r) {
          if (r.text.toLowerCase().indexOf(k) === -1) return;
          var key = k + '\u0000' + r.text;
          if (seen.has(key)) return;
          seen.set(key, true);
          out.push({ keyword: k, forbidden: f.text, required: r.text, source: r.source });
        });
      });
    });
    return out;
  }

  /* ---------- 质量检查 ---------- */
  var AUDIENCE_RE = /给[^，。,.\s]{1,}|面向|供[^，。,.\s]{1,}|受众|读者|for\s+\S+|to\s+(a|an|the)\s/i;
  function validateSpec(spec) {
    var s = spec || {};
    var issues = [];
    var task = trim(s.task);
    var cons = Array.isArray(s.constraints) ? s.constraints : [];
    var crit = Array.isArray(s.criteria) ? s.criteria : [];
    if (!task) {
      issues.push({ level: 'error', code: 'task-empty', field: 'task', message: '任务一句话还没写。', suggestion: '写清「谁、要什么、给谁用」,例如:我是产品经理,要一份竞品对比表,给老板在周会上看。' });
    } else if (!AUDIENCE_RE.test(task)) {
      issues.push({ level: 'warn', code: 'task-no-audience', field: 'task', message: '任务句里没有看到「给谁用」。', suggestion: '补一个使用对象,例如「……,给不了解背景的新同事看」。' });
    }
    var filled = crit.filter(function (c) { return c && trim(c.text); });
    if (filled.length === 0) {
      issues.push({ level: 'warn', code: 'criteria-empty', field: 'criteria', message: '验收标准为空,AI 的答案没有可核对的尺子。', suggestion: '至少写一条可观察的标准,例如「每个结论后附一条来源链接」,检验方式:「逐条点开链接确认能访问」。' });
    }
    crit.forEach(function (c, i) {
      if (!c || !trim(c.text)) return;
      var vw = vagueWords(c.text);
      if (vw.length) {
        issues.push({
          level: 'warn', code: 'criteria-vague', field: 'criteria', index: i, words: vw,
          message: '第 ' + (i + 1) + ' 条验收标准含不可观察的词:' + vw.join('、') + '。',
          suggestion: '把「' + vw[0] + '」换成别人能数、能查的说法,例如「不出现未解释的缩写」「每段不超过 120 字」「每个数字都标注来源」。'
        });
      }
      if (!trim(c.check)) {
        issues.push({ level: 'info', code: 'criteria-no-check', field: 'criteria', index: i, message: '第 ' + (i + 1) + ' 条验收标准没有写「如何检验」。', suggestion: '补一句检验方法,例如「逐条数一遍」「对照原文核对」。' });
      }
    });
    conflicts(cons, crit).forEach(function (c) {
      issues.push({
        level: 'warn', code: 'conflict', field: 'constraints', keyword: c.keyword,
        message: '「' + c.keyword + '」既出现在禁止项(' + c.forbidden + '),又出现在' + c.source + '(' + c.required + ')。',
        suggestion: '删掉其中一边,或改成不互相矛盾的说法。'
      });
    });
    var total = totalChars(s);
    if (total > LENGTH_LIMIT) {
      issues.push({ level: 'info', code: 'too-long', field: 'all', total: total, message: '规格总字数 ' + total + ',超过 ' + LENGTH_LIMIT + '。', suggestion: '建议精简:合并重复的限定条件,只保留会改变答案的约束。' });
    }
    return { issues: issues };
  }

  /* ---------- 提示词 ---------- */
  function esc(text) {
    return str(text).replace(/\r\n?/g, '\n').split('\n').map(function (line) {
      return line.replace(/^(\s*)([#>])/, '$1\\$2').replace(/```/g, '\\`\\`\\`').replace(/^(\s*)(-{3,}|={3,})\s*$/, '$1\\$2');
    }).join('\n');
  }
  function item(text) { return esc(trim(text)).split('\n').join('\n  '); }

  function buildPrompt(spec) {
    var s = spec || {};
    var out = [];
    var role = trim(s.role), tone = trim(s.tone);
    if (role || tone) {
      var r = ['## 角色与语气'];
      if (role) r.push('角色:' + item(role));
      if (tone) r.push('语气:' + item(tone));
      out.push(r.join('\n'));
    }
    out.push('## 任务\n' + (trim(s.task) ? esc(trim(s.task)) : '(未填写)'));
    var cons = (s.constraints || []).filter(function (c) { return c && trim(c.text); });
    out.push('## 限定\n' + (cons.length ? cons.map(function (c) { return '- ' + c.kind + ':' + item(c.text); }).join('\n') : '(未填写)'));
    var crit = (s.criteria || []).filter(function (c) { return c && trim(c.text); });
    out.push('## 验收\n' + (crit.length ? crit.map(function (c, i) {
      return (i + 1) + '. ' + item(c.text) + (trim(c.check) ? '\n   检验方式:' + item(c.check) : '');
    }).join('\n') : '(未填写)'));
    out.push('## 输出格式\n' + (trim(s.output) ? esc(trim(s.output)) : '(未指定,请自行选择最清晰的结构,并在开头一句话说明)'));
    var chk = [];
    crit.forEach(function (c) { chk.push('- [ ] ' + item(c.text) + (trim(c.check) ? '(检验:' + item(c.check) + ')' : '')); });
    cons.filter(function (c) { return c.kind === '禁止项'; }).forEach(function (c) { chk.push('- [ ] 没有触犯禁止项:' + item(c.text)); });
    chk.push('- [ ] 不确定或缺信息的地方已明说,没有编造');
    out.push('## 交付前自检清单\n交付答案之前,逐条对照下面的清单自查,有不满足的先修正再交付。\n' + chk.join('\n'));
    return out.join('\n\n') + '\n';
  }

  function buildFirstRound(spec) {
    var s = spec || {};
    return [
      '## 任务',
      trim(s.task) ? esc(trim(s.task)) : '(未填写)',
      '',
      '## 这一轮先不要给答案',
      '请先做两件事:',
      '1. 列出做好这件事需要我确认的限定条件(范围、禁止项、格式、长度、语言、受众、已知事实、已有材料),缺什么直接问我。',
      '2. 写出你认为合格答案的验收标准,每条必须是可观察的,并说明我怎么检验。',
      '等我确认后,再进入下一步。',
      ''
    ].join('\n');
  }

  function toMarkdown(spec, mode) {
    var s = spec || {};
    var head = ['# ' + (esc(trim(s.title).replace(/\n+/g, ' ')) || '未命名规格')];
    var meta = [];
    if (s.tags && s.tags.length) meta.push('标签:' + s.tags.map(function (t) { return esc(t); }).join('、'));
    if (s.updatedAt) meta.push('更新:' + s.updatedAt);
    if (meta.length) head.push('', meta.join(' · '));
    return head.join('\n') + '\n\n' + (mode === 'first' ? buildFirstRound(s) : buildPrompt(s));
  }

  /* ---------- 模板 ---------- */
  function T(id, name, desc, task, cons, crit, output, role) {
    return {
      id: id, name: name, desc: desc,
      spec: {
        title: name, tags: [], task: task,
        constraints: cons.map(function (c) { return { kind: c[0], text: c[1] }; }),
        criteria: crit.map(function (c) { return { text: c[0], check: c[1] }; }),
        output: output, role: role, tone: ''
      }
    };
  }
  function templates() {
    return [
      T('research', '调研', '围绕一个问题收集并整理信息',
        '我是【身份】,要围绕【调研问题】做一份调研,给【读者】在【场合】用。',
        [['范围', '时间范围:【起止】;地域或领域:【填写】'], ['禁止项', '不引用无法确认来源的内容'], ['格式', '【篇幅、章节要求】'], ['受众', '【读者的背景】'], ['已有材料', '【我已经掌握的资料】']],
        [['每条结论都附来源', '逐条点开来源确认存在'], ['区分事实与推测', '推测处有明确标注'], ['列出没查到的部分', '末尾有「未覆盖」清单']],
        '标题 / 结论摘要 / 分点证据 / 来源清单 / 未覆盖部分', '【研究助理】'),
      T('writing', '写稿', '写一篇给指定读者看的文字',
        '我要写一篇【文体】,主题是【主题】,给【读者】在【渠道】阅读。',
        [['长度', '【字数范围】'], ['语言', '【语言与口吻】'], ['禁止项', '【不能出现的说法或话题】'], ['已知事实', '【必须保持一致的事实】'], ['受众', '【读者现有认知】']],
        [['全文围绕一个核心观点', '用一句话能复述全文'], ['每个论点至少一个具体例子', '逐段核对'], ['字数落在范围内', '统计字数']],
        '标题 / 开头 / 正文分段 / 结尾', '【写作者】'),
      T('code-review', '代码评审', '评审一段改动并给出可执行意见',
        '请评审下面这段【语言】代码改动,给【作者或团队】在合并前参考。',
        [['范围', '只评审【文件或模块】'], ['禁止项', '不要重写整个文件'], ['格式', '按严重程度分组'], ['已有材料', '【代码、需求描述、测试结果】']],
        [['每条意见指向具体位置', '能定位到文件与行'], ['每条意见说明原因和修改建议', '逐条检查'], ['区分必须改与可选改', '每条有级别标注']],
        '总体判断 / 必须修改 / 建议修改 / 疑问', '【资深评审人】'),
      T('data-analysis', '数据分析', '对一份数据回答具体问题',
        '请分析【数据集描述】,回答【问题】,结果给【读者】用于【决策】。',
        [['范围', '时间范围与口径:【填写】'], ['禁止项', '不要对缺失数据做未说明的填补'], ['格式', '数字保留【位数】,附单位'], ['已有材料', '【字段说明、数据样例】']],
        [['每个数字能追溯到字段与计算方式', '抽查三个数字复算'], ['明确列出假设与数据局限', '有单独的「假设」小节'], ['结论与数据一致', '结论中的数字与表格逐一对照']],
        '问题重述 / 方法 / 结果 / 假设与局限 / 建议', '【数据分析师】'),
      T('translation', '翻译', '把一段文字译成目标语言',
        '请把下面的【源语言】文本译成【目标语言】,给【读者】在【场合】使用。',
        [['语言', '目标语言与变体:【填写】'], ['格式', '保留原文的段落与格式标记'], ['禁止项', '不要增删原文信息'], ['已知事实', '术语对照:【原词 = 译词】']],
        [['术语按对照表统一', '搜索每个术语的译法是否一致'], ['数字、专名与原文一致', '逐个核对'], ['无法确定的地方标注', '译文中有标记并附原文']],
        '译文 / 存疑处清单', '【译者】'),
      T('study-plan', '学习计划', '为一个学习目标排出可执行计划',
        '我是【当前水平】,想在【期限】内学会【目标】,计划给我自己每天按【可用时间】执行。',
        [['范围', '只覆盖【内容范围】'], ['长度', '每次学习不超过【时长】'], ['已知事实', '我已经会:【填写】'], ['禁止项', '不安排【不接受的学习方式】']],
        [['每个阶段有可检验的产出', '到期能拿出作品或测验结果'], ['每周总时长不超过可用时间', '逐周相加'], ['列出每阶段的检查点', '每阶段末有一条自测']],
        '总览 / 分周计划 / 每周产出 / 检查点', '【学习教练】')
    ];
  }

  /* ---------- 搜索 ---------- */
  function haystack(s) {
    var p = [s.title, (s.tags || []).join(' '), s.task, s.output, s.role, s.tone];
    (s.constraints || []).forEach(function (c) { p.push(c.kind, c.text); });
    (s.criteria || []).forEach(function (c) { p.push(c.text, c.check); });
    return p.join('\n').toLowerCase();
  }
  function search(specs, q) {
    var terms = str(q).toLowerCase().split(/\s+/).filter(Boolean);
    var list = Array.isArray(specs) ? specs : [];
    if (!terms.length) return list.slice();
    return list.filter(function (s) {
      var h = haystack(s);
      return terms.every(function (t) { return h.indexOf(t) !== -1; });
    });
  }
  function tagCounts(specs) {
    var m = new Map();
    (specs || []).forEach(function (s) {
      (s.tags || []).forEach(function (t) { m.set(t, (m.get(t) || 0) + 1); });
    });
    return m;
  }
  function parseTags(text) {
    var seen = new Set();
    var out = [];
    str(text).split(/[,，、;；\n]+/).forEach(function (t) {
      var v = t.trim();
      if (v && !seen.has(v)) { seen.add(v); out.push(v); }
    });
    return out;
  }

  /* ---------- 导出 ---------- */
  function guardFormula(s) {
    var t = str(s);
    if (/^[=+\-@\t\r]/.test(t) && !/^[+-]$/.test(t)) return "'" + t;
    return t;
  }
  function csvCell(v) {
    var t = guardFormula(String(v));
    return /[",\r\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
  }
  function toCsv(specs) {
    var head = ['标题', '标签', '任务', '限定条件', '验收标准', '输出结构', '角色', '语气', '创建', '更新'];
    var rows = [head.map(csvCell).join(',')];
    (specs || []).forEach(function (s) {
      var cells = [
        guardFormula(s.title),
        (s.tags || []).map(guardFormula).join(' / '),
        guardFormula(s.task),
        (s.constraints || []).map(function (c) { return c.kind + ':' + guardFormula(c.text); }).join('\n'),
        (s.criteria || []).map(function (c) { return guardFormula(c.text) + (trim(c.check) ? '(检验:' + c.check + ')' : ''); }).join('\n'),
        guardFormula(s.output), guardFormula(s.role), guardFormula(s.tone),
        s.createdAt || '', s.updatedAt || ''
      ];
      rows.push(cells.map(csvCell).join(','));
    });
    return rows.join('\r\n') + '\r\n';
  }
  function toJson(specs) {
    return JSON.stringify({ app: 'ai-spec', version: 1, specs: specs }, null, 2);
  }

  /* ---------- 校验(写入与读取共用) ---------- */
  function isStr(v) { return typeof v === 'string'; }
  function validateState(obj) {
    var errors = [];
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return { ok: false, errors: ['顶层必须是对象'] };
    if (obj.app !== undefined && obj.app !== 'ai-spec') errors.push('app 字段必须是 ai-spec');
    if (obj.version !== undefined && obj.version !== 1) errors.push('不支持的 version:' + String(obj.version));
    if (!Array.isArray(obj.specs)) return { ok: false, errors: errors.concat('specs 必须是数组') };
    var ids = new Set();
    obj.specs.forEach(function (s, i) {
      var p = '第 ' + (i + 1) + ' 份规格';
      if (!s || typeof s !== 'object' || Array.isArray(s)) { errors.push(p + ':必须是对象'); return; }
      if (!isStr(s.id) || !s.id) errors.push(p + ':id 必须是非空字符串');
      else if (ids.has(s.id)) errors.push(p + ':id 重复(' + s.id + ')');
      else ids.add(s.id);
      ['title', 'task', 'output', 'role', 'tone'].forEach(function (f) {
        if (!isStr(s[f])) errors.push(p + ':' + f + ' 必须是字符串');
      });
      ['createdAt', 'updatedAt'].forEach(function (f) {
        if (parseToday(s[f]) === null) errors.push(p + ':' + f + ' 必须是真实存在的 YYYY-MM-DD 日期');
      });
      if (!Array.isArray(s.tags) || !s.tags.every(isStr)) errors.push(p + ':tags 必须是字符串数组');
      if (!Array.isArray(s.constraints)) errors.push(p + ':constraints 必须是数组');
      else s.constraints.forEach(function (c, j) {
        if (!c || typeof c !== 'object') errors.push(p + ':限定条件 ' + (j + 1) + ' 必须是对象');
        else {
          if (KINDS.indexOf(c.kind) === -1) errors.push(p + ':限定条件 ' + (j + 1) + ' 的 kind 不在允许范围(' + String(c.kind) + ')');
          if (!isStr(c.text)) errors.push(p + ':限定条件 ' + (j + 1) + ' 的 text 必须是字符串');
        }
      });
      if (!Array.isArray(s.criteria)) errors.push(p + ':criteria 必须是数组');
      else s.criteria.forEach(function (c, j) {
        if (!c || typeof c !== 'object' || !isStr(c.text) || !isStr(c.check)) errors.push(p + ':验收标准 ' + (j + 1) + ' 的 text、check 必须是字符串');
      });
    });
    if (errors.length) return { ok: false, errors: errors };
    return { ok: true, errors: [], data: { specs: obj.specs } };
  }
  /* 本机存档用内部格式 {specs},app/version 可省;外部备份文件(opts.strict)必须带 app=ai-spec 与 version=1 */
  function validateImport(input, opts) {
    var obj = input;
    if (typeof input === 'string') {
      try { obj = JSON.parse(input); } catch (e) { return { ok: false, errors: ['不是合法的 JSON:' + e.message] }; }
    }
    if (opts && opts.strict) {
      if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return { ok: false, errors: ['顶层必须是对象'] };
      var head = [];
      if (obj.app !== 'ai-spec') head.push('缺少或写错 app 字段:外部备份必须是 "app": "ai-spec"(本工具「备份全部 JSON」导出的文件)');
      if (obj.version !== 1) head.push('缺少或写错 version 字段:外部备份必须是 "version": 1');
      var r = validateState(obj);
      if (head.length || !r.ok) return { ok: false, errors: head.concat(r.ok ? [] : r.errors.filter(function (e) { return head.length === 0 || !/^(app|不支持的 version)/.test(e); })) };
      return r;
    }
    return validateState(obj);
  }

  var api = {
    KINDS: KINDS, DEFAULT_VAGUE: DEFAULT_VAGUE, LENGTH_LIMIT: LENGTH_LIMIT,
    parseToday: parseToday, blankSpec: blankSpec, clone: clone, totalChars: totalChars,
    vagueWords: vagueWords, conflicts: conflicts, validateSpec: validateSpec,
    buildPrompt: buildPrompt, buildFirstRound: buildFirstRound, toMarkdown: toMarkdown,
    templates: templates, search: search, tagCounts: tagCounts, parseTags: parseTags,
    guardFormula: guardFormula, toCsv: toCsv, toJson: toJson,
    validateState: validateState, validateImport: validateImport
  };
  globalThis.SpecCore = api;
  if (typeof module !== 'undefined') module.exports = api;
})();

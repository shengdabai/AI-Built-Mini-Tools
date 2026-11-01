/* 承诺跟进提取器 · 纯逻辑（无 DOM）
 * 全部为确定性规则：解析聊天/纪要 → 识别承诺与请求 → 解析日期 → 模糊检测 → 澄清问题 → 导出。
 */
(function () {
  'use strict';

  /* ---------- 日期工具（全部用 'YYYY-MM-DD' 字符串 + UTC 运算，避开时区与夏令时） ---------- */
  const pad = (n) => String(n).padStart(2, '0');

  function daysInMonth(y, m) {
    return new Date(Date.UTC(y, m, 0)).getUTCDate();
  }
  function toISO(y, m, d) {
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() + '-' + pad(dt.getUTCMonth() + 1) + '-' + pad(dt.getUTCDate());
  }
  function parseISO(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
    if (!m) return null;
    const y = +m[1], mo = +m[2], d = +m[3];
    if (mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo)) return null;
    return { y, m: mo, d };
  }
  function isValidISO(s) {
    return parseISO(s) !== null;
  }
  function addDays(iso, n) {
    const p = parseISO(iso);
    return toISO(p.y, p.m, p.d + n);
  }
  /** 周一=1 … 周日=7 */
  function weekday(iso) {
    const p = parseISO(iso);
    const w = new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay();
    return w === 0 ? 7 : w;
  }
  function diffDays(a, b) {
    const pa = parseISO(a), pb = parseISO(b);
    return Math.round((Date.UTC(pb.y, pb.m - 1, pb.d) - Date.UTC(pa.y, pa.m - 1, pa.d)) / 86400000);
  }
  function localToday(date) {
    const d = date || new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  // 周从周一开始：本周X / 下周X / 最近的周X（含今天）
  const thisWeek = (base, wd) => addDays(base, wd - weekday(base));
  const nextWeek = (base, wd) => addDays(thisWeek(base, wd), 7);
  const nextOccur = (base, wd) => {
    let diff = wd - weekday(base);
    if (diff < 0) diff += 7;
    return addDays(base, diff);
  };
  const monthEnd = (base, offset) => {
    const p = parseISO(base);
    const first = toISO(p.y, p.m + offset, 1);
    const f = parseISO(first);
    return toISO(f.y, f.m, daysInMonth(f.y, f.m));
  };
  /** 月-日 没写年份：取今年；若早于基准日 180 天以上，视为明年（跨年） */
  function monthDay(base, m, d, year) {
    const p = parseISO(base);
    if (m < 1 || m > 12) return null;
    if (year) return d >= 1 && d <= daysInMonth(year, m) ? toISO(year, m, d) : null;
    let y = p.y;
    if (d < 1 || d > 31) return null;
    // 先确定目标年份，再校验日期；例如年末提到 2/29 时，下一年可能才是闰年。
    if (diffDays(base, toISO(y, m, d)) < -180) y += 1;
    if (d > daysInMonth(y, m)) return null;
    return toISO(y, m, d);
  }
  /** 只写「X号」：本月该日未过则本月，否则顺延到下一个有该日的月份（跨月/跨年） */
  function dayOfMonth(base, d) {
    const p = parseISO(base);
    if (d < 1 || d > 31) return null;
    for (let k = 0; k < 13; k++) {
      const first = parseISO(toISO(p.y, p.m + k, 1));
      if (d > daysInMonth(first.y, first.m)) continue;
      const cand = toISO(first.y, first.m, d);
      if (cand >= base) return cand;
    }
    return null;
  }

  const ZH_WD = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7, 天: 7, 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7 };
  const EN_WD = {
    monday: 1, mon: 1, tuesday: 2, tue: 2, tues: 2, wednesday: 3, thursday: 4, thu: 4, thur: 4, thurs: 4,
    friday: 5, fri: 5, saturday: 6, sunday: 7,
  };
  const EN_MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
  const EN_WD_RE = '(monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tues|tue|thurs|thur|thu|fri)';
  const EN_MON_RE = '(jan|feb|mar|apr|may|jun|jul|aug|sept|sep|oct|nov|dec)[a-z]*\\.?';
  const ZH_WD_RE = '(?:周|星期|礼拜)([一二三四五六日天1-7])';

  const MD_SLASH_RE = /(?<![\d/.%％\-])(\d{1,2})\/(\d{1,2})(?![\d/.:%％\-]|\s*(?:[%％家个件人份次倍台批箱只条张页位名成层楼项款组套]|分之))/;
  const RATIO_PREFIX_RE = /(?:比分|比例|占比|完成了|\b(?:ratio|score))\s*[:：=]?\s*$/i;
  const PROGRESS_PREFIX_RE = /(?:进度|\bprogress)\s*[:：=]?\s*$/i;
  const DELIVERY_SUFFIX_RE = /^\s*(?:之前|以前|前)\s*(?:交|提交|提供|发|给|寄|完成|回复|确认|处理)/;

  function findSlashDate(text) {
    // 排除比例与时间片段；「进度：10/9 前交」有明确交付提示，仍应识别日期。
    for (const match of text.matchAll(new RegExp(MD_SLASH_RE.source, 'g'))) {
      const before = text.slice(0, match.index);
      const after = text.slice(match.index + match[0].length);
      if (/\d\s*[:：]\s*$/.test(before) || RATIO_PREFIX_RE.test(before)) continue;
      if (PROGRESS_PREFIX_RE.test(before) && !DELIVERY_SUFFIX_RE.test(after)) continue;
      return match;
    }
    return null;
  }

  const DATE_RULES = [
    { re: /大后天/, fn: (m, b) => addDays(b, 3) },
    { re: /后天/, fn: (m, b) => addDays(b, 2) },
    { re: /明天|明日|明早|明晚|明儿/, fn: (m, b) => addDays(b, 1) },
    { re: /今天|今日|今晚|今早|下班前|收工前|当天/, fn: (m, b) => b },
    { re: new RegExp('下下个?' + ZH_WD_RE), fn: (m, b) => addDays(nextWeek(b, ZH_WD[m[1]]), 7) },
    { re: new RegExp('下个?' + ZH_WD_RE), fn: (m, b) => nextWeek(b, ZH_WD[m[1]]) },
    { re: new RegExp('(?:本|这个?)' + ZH_WD_RE), fn: (m, b) => thisWeek(b, ZH_WD[m[1]]) },
    { re: new RegExp(ZH_WD_RE), fn: (m, b) => nextOccur(b, ZH_WD[m[1]]) },
    { re: /下个?(?:周|星期)末/, fn: (m, b) => nextWeek(b, 6) },
    { re: /(?:本|这个?)?(?:周|星期)末/, fn: (m, b) => (weekday(b) === 7 ? b : thisWeek(b, 6)) },
    { re: /(?:(\d{4})年)?(\d{1,2})月(\d{1,2})[日号]/, fn: (m, b) => monthDay(b, +m[2], +m[3], m[1] ? +m[1] : 0) },
    { re: /(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/, fn: (m, b) => monthDay(b, +m[2], +m[3], +m[1]) },
    // 无年份「M/D」（10/9）：排除百分号、量词以及紧邻的明确比例语境。
    { match: findSlashDate, fn: (m, b) => monthDay(b, +m[1], +m[2], 0) },
    { re: /(?<![\d月.])(\d{1,2})[号日](?![楼线房厅机位])/, fn: (m, b) => dayOfMonth(b, +m[1]) },
    { re: /下个?月(?:底|末)/, fn: (m, b) => monthEnd(b, 1) },
    { re: /(?:本|这个?)?月(?:底|末)/, fn: (m, b) => monthEnd(b, 0) },
    { re: /\bday after tomorrow\b/i, fn: (m, b) => addDays(b, 2) },
    { re: /\b(?:tomorrow|tmr|tmrw)\b/i, fn: (m, b) => addDays(b, 1) },
    { re: /\b(?:today|tonight|eod|end of (?:the )?day|cob|close of business)\b/i, fn: (m, b) => b },
    { re: /\bend of next week\b/i, fn: (m, b) => nextWeek(b, 5) },
    { re: /\b(?:end of (?:the |this )?week|eow)\b/i, fn: (m, b) => (weekday(b) <= 5 ? thisWeek(b, 5) : thisWeek(b, 7)) },
    { re: /\b(?:end of (?:the |this )?month|eom)\b/i, fn: (m, b) => monthEnd(b, 0) },
    { re: new RegExp('\\bnext ' + EN_WD_RE + '\\b', 'i'), fn: (m, b) => nextWeek(b, EN_WD[m[1].toLowerCase()]) },
    { re: new RegExp('\\bthis ' + EN_WD_RE + '\\b', 'i'), fn: (m, b) => thisWeek(b, EN_WD[m[1].toLowerCase()]) },
    { re: new RegExp('\\b' + EN_WD_RE + '\\b', 'i'), fn: (m, b) => nextOccur(b, EN_WD[m[1].toLowerCase()]) },
    { re: new RegExp('\\b' + EN_MON_RE + '\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b', 'i'), fn: (m, b) => monthDay(b, EN_MON[m[1].toLowerCase()], +m[2], 0) },
    { re: new RegExp('\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+' + EN_MON_RE + '\\b', 'i'), fn: (m, b) => monthDay(b, EN_MON[m[2].toLowerCase()], +m[1], 0) },
  ];

  /**
   * 在文本中找期限：所有规则都试一遍，取位置最靠前（同位置取最长）的那个。
   * 返回 { date: 'YYYY-MM-DD'|null, text, index } 或 null。
   */
  function findDate(text, baseDate) {
    if (!isValidISO(baseDate)) throw new Error('基准日期无效：' + baseDate);
    const s = String(text || '');
    let best = null;
    for (const rule of DATE_RULES) {
      const m = rule.match ? rule.match(s) : rule.re.exec(s);
      if (!m) continue;
      if (!best || m.index < best.index || (m.index === best.index && m[0].length > best.text.length)) {
        best = { index: m.index, text: m[0], date: rule.fn(m, baseDate) };
      }
    }
    return best;
  }
  function parseDate(text, baseDate) {
    const r = findDate(text, baseDate);
    return r ? r.date : null;
  }

  /* ---------- 模糊词 ---------- */
  const VAGUE_TIME_RE = new RegExp([
    '尽快', '尽早', '回头', '改天', '有空', '稍后', '稍晚', '晚点', '晚些', '这两天', '过两天', '过几天', '近期', '抓紧', '等下', '待会儿?',
    '下个?周(?![一二三四五六日天1-7末])', '下个?月(?![底末初\\d])',
    '\\basap\\b', '\\bsoon\\b', '\\blater\\b', '\\bshortly\\b', '\\bwhen i can\\b', '\\bat some point\\b', '\\bin a bit\\b', '\\bnext week\\b',
  ].join('|'), 'i');

  const VAGUE_REF_ZH_RE = /(?:那个(?![，,、])|那份|那版|那批|那件事|那事|上次的|上回的|之前那个?|之前的版本|老样子)(?:[一-龥]{0,4}?(?=回头|稍后|晚点|改天|尽快|发|给|交|寄|再|的|改|要|先|我|你|[，,。！!？?；;\s]|$))?/;
  const VAGUE_REF_EN_RE = /\bthe (revised|updated|new|latest|final|other) ([a-z]+(?: [a-z]+)?)|\bthat (one|thing|file|version|doc)\b|\bthe thing\b|\bsame as (?:before|last time)\b/i;

  function findVagueRef(text) {
    const s = String(text || '');
    const en = VAGUE_REF_EN_RE.exec(s);
    if (en) {
      const noun = en[2] ? en[2].replace(/\b(soon|asap|later|by|before|until|on|for|to|from|and|or|today|tomorrow|tonight|eod|next|this|please|pls)\b.*$/i, '').trim() : '';
      // 指代短语取完整的「the revised sample」，不含后面的时间词，供清晰度判断与追问使用
      const word = en[1]
        ? en[0].slice(0, en[0].indexOf(en[1]) + en[1].length) + (noun ? ' ' + noun : '')
        : en[0].replace(/\b(soon|asap|later)\b.*$/i, '').trim();
      return { word: word.trim(), noun, revision: !!en[1] };
    }
    const zh = VAGUE_REF_ZH_RE.exec(s);
    if (zh) return { word: zh[0], noun: '', revision: false };
    return null;
  }

  /* ---------- 承诺 / 指派 / 请求句式 ---------- */
  const COMMIT_ZH = [
    /交给我|包在我身上/,
    /我(?:们)?这边/,
    /我(?:们)?(?:来(?!不及|自|说)|会(?!议)|负责|去(?!年|吃|喝|睡|休息|洗手间|厕所|过)|跟进|再跟|先去|先来|马上|立刻|尽快|稍后|晚点|回头|明天|今天|后天|下午|晚上|周[一二三四五六日天]|下周|这周|本周)/,
    /我(?:们)?(?:把|将).{0,20}?(?:发|给|交|同步|传|提供|寄|回复)/,
    /(?:前|之前|以前).{0,12}?(?:发|给|交|提供|同步|回复|寄)(?:给)?(?:你|您|过去|过来|大家)/,
    /(?:回头|稍后|晚点|等下|待会儿?|改天)(?:再)?(?:发|给|同步|回复|找|跟|问|寄|确认|看)/,
  ];
  const COMMIT_EN = /\b(?:I'll|I will|we'll|we will|I'm going to|I am going to|we're going to|let me|let us|I can send|will do|on it|leave it (?:to|with) me)\b/i;
  const REQUEST_RE = /需要|麻烦|希望|得尽快|要尽快|催一下|赶紧|待定|待确认|待商量|\bwe need\b|\bneed (?:the|it|this|that|a|an)\b|\bplease\b|\bpls\b|\bTBD\b|\bto be confirmed\b/i;
  const QUESTION_END_RE = /[？?]\s*$/;
  const GENERIC_OWNER = /^(大家|有人|谁|某人|我们|咱们|对方|这边|那边|someone|somebody|anyone|everyone|team|we|they|he|she|it|this|that|there|you)$/i;
  const OWNER_STOP = /^(今天|明天|后天|这边|那边|这个|那个|我们|你们|他们|大家|咱们|之后|然后|后续|目前|现在|已经|应该|可能|周[一二三四五六日天末]|月底|付款|条件|The|This|That|There|It|We|They|He|She|You|Please|Also|And|But|Then|Just)$/;

  const ASSIGN_ACTION = '(?:今天|今晚|明天|明早|后天|大后天|下班前|本周|这周|下周|周[一二三四五六日天]|星期|月底|\\d|负责|跟进|处理|更新|发|提交|确认|整理|准备|安排|对接|联系|修改|补充|完成|查|寄|回复|同步|提供|出|做|写|改|看|跑|催|订|约|交)';
  const ASSIGN_NAME_RE = new RegExp('(?:^|[^一-龥])((?:请|麻烦)\\s*)([一-龥]{2,3}?)(?=' + ASSIGN_ACTION + ')');
  // 「请」后面常见的非人名开头：请问 / 请大家 / 请尽快 / 请各位 / 请你 / 请把 …
  const ASSIGN_STOP_RE = /^(?:问|大家|尽快|尽早|各位|诸位|你|您|务必|及时|一定|把|将|在|于|帮|先|再|马上|立刻|赶紧|确认|注意|查收|相关|对方|同事|同学|团队|全员|所有|自行|直接|稍后|随时|提前|按时|准时|认真|仔细|继续|重新|这边|那边|我|他|她)/;

  function normalizeQuotes(s) {
    return String(s).replace(/[‘’]/g, "'").replace(/[“”]/g, '"');
  }

  function findAssignee(text, known) {
    const s = String(text);
    const at = s.indexOf('@');
    if (at >= 0) {
      const rest = s.slice(at + 1);
      for (const k of known) if (k && rest.startsWith(k)) return { owner: k, cue: '@' + k };
      const m = /^([^\s@，,:：。]{1,20}?)\s*[，,:：]?\s*(?:你来|你负责|你跟进|你去|你|请|麻烦|帮忙|please|pls|can you|could you|to\b)/i.exec(rest)
        || /^([^\s@，,:：。]+)/.exec(rest);
      if (m) return { owner: m[1], cue: '@' + m[1] };
    }
    const q = /(?:请|麻烦)\s*([^\s，,。]{1,12})/.exec(s);
    if (q) {
      for (const k of known) if (k && q[1].startsWith(k)) return { owner: k, cue: q[0].slice(0, q[0].indexOf(q[1])) + k };
    }
    // 不依赖已知说话人：「请 / 麻烦 + 2–3 个汉字的名字 + 期限或动作词」，排除 请问 / 请大家 / 请尽快 等
    const n = ASSIGN_NAME_RE.exec(s);
    if (n && !ASSIGN_STOP_RE.test(n[2]) && !OWNER_STOP.test(n[2]) && !GENERIC_OWNER.test(n[2]) && !findDate(n[2], '2000-01-03')) {
      return { owner: n[2], cue: n[1] + n[2] };
    }
    return null;
  }

  function findThirdParty(text) {
    const s = String(text).replace(/^[\s\-*•·\d.、)）]+/, '');
    const m = /^(?:由)?([一-龥]{2,3}?)(?:负责|来跟进|跟进|牵头|会(?!议)|将)/.exec(s)
      || /^([A-Z][a-z]+(?: [A-Z][a-z]+)?) (?:will|to (?=[a-z]))/.exec(s);
    if (!m) return null;
    const name = m[1];
    // 「大家会…」「有人跟进…」：是承诺但没有具体负责人
    if (/^(大家|有人|对方|团队|Someone|Somebody|Everyone|Team)$/.test(name)) return { owner: '', cue: m[0] };
    if (OWNER_STOP.test(name) || GENERIC_OWNER.test(name)) return null;
    // 「我来跟进」「你会负责」这类以人称代词开头的不是第三方姓名，交给自我承诺 / 指派规则
    if (/^[我你他她它咱俺您]/.test(name)) return null;
    if (findDate(name, '2000-01-03')) return null;
    return { owner: name, cue: m[0] };
  }

  function detectLang(text) {
    const cjk = (String(text).match(/[一-龥]/g) || []).length;
    return cjk >= 2 ? 'zh' : 'en';
  }

  /* ---------- 事项文本清理 ---------- */
  const LEAD_STRIP = [
    /^(?:好的|好|行|收到|没问题|可以|嗯|ok|okay|sure|noted)[，,！!。.\s]+/i,
    /^@\S+\s*/,
    /^(?:请|麻烦)\s*/,
    /^(?:交给我|包在我身上)[，,\s]*/,
    /^(?:由)/,
    /^(?:我们这边|我这边|我们|我|你们|你)/,
    /^(?:来跟进|负责|跟进|牵头|来|会|将|去|先|再|就|马上|立刻|把|将|在|于|给)/,
    /^(?:I'll|I will|we'll|we will|I'm going to|I am going to|we're going to|let me|let us|I can|we need|we|need|please|pls)\s+/i,
    /^(?:[A-Z][a-z]+ )?(?:will|to)\s+/,
  ];

  function cleanTask(sentence, ownerCue) {
    let t = normalizeQuotes(sentence);
    if (ownerCue) t = t.replace(ownerCue, ' ');
    t = t.replace(/^[\s\-*•·\d.、)）]+(?=\D)/, '');
    // 去掉期限短语（含前后连接词）
    for (let i = 0; i < 3; i++) {
      const d = findDate(t, '2000-01-03');
      if (!d) break;
      const before = t.slice(0, d.index).replace(/\s*(?:by|before|on|until|no later than|in|在|于)\s*$/i, '');
      const after = t.slice(d.index + d.text.length).replace(/^\s*(?:前|之前|以前|之内|内|为止)/, '');
      t = before + ' ' + after;
    }
    t = t.replace(new RegExp(VAGUE_TIME_RE.source, 'gi'), ' ');
    t = t.replace(/[。！!；;?？]+\s*$/, '').replace(/\s{2,}/g, ' ').trim();
    t = t.replace(/^[，,、:：\s]+|[，,、:：\s]+$/g, '');
    for (let pass = 0; pass < 4; pass++) {
      for (const re of LEAD_STRIP) t = t.replace(re, '').trim();
    }
    // 中文事项：去掉句中的第一人称承诺词，并收拢中文之间多余的空格
    t = t.replace(/我们这边|我这边|我们来|我来|我们会|我会(?!议)|我负责|我去(?!年)/, '');
    t = t.replace(/\s*([，、；])\s*/g, '$1').replace(/([一-龥])\s+(?=[一-龥])/g, '$1').replace(/([，、])\1+/g, '$1');
    t = t.replace(/^[，,、:：\s]+|[，,、:：.\s]+$/g, '');
    if (t.length < 2) t = String(sentence).trim().replace(/[。.！!]+$/, '');
    if (t.length > 60) t = t.slice(0, 59) + '…';
    return t;
  }

  /* ---------- 原文解析 ---------- */
  const SPEAKER_BLACKLIST = /^(备注|注|议题|结论|决定|待办|行动项|会议纪要|纪要|时间|地点|参会人?|主题|议程|action items?|notes?|agenda|todo|re|subject|from|to|date|http|https)$/i;
  const TIME_RE = '(\\d{1,2}:\\d{2}(?::\\d{2})?)';
  const NAME_RE = '([\\u4e00-\\u9fa5A-Za-z][\\u4e00-\\u9fa5A-Za-z0-9 ._\\-]{0,23}?)';
  const LINE_BRACKET = new RegExp('^\\[?' + TIME_RE + '\\]?\\s*' + NAME_RE + '\\s*[:：]\\s*(.*)$');
  const LINE_SPEAKER = new RegExp('^' + NAME_RE + '\\s*[:：]\\s*(.*)$');
  const LINE_HEADER = new RegExp('^' + NAME_RE + '\\s+(?:\\d{4}[-/.]\\d{1,2}[-/.]\\d{1,2}\\s+)?' + TIME_RE + '$');

  function validSpeaker(name) {
    const n = name.trim();
    if (!n || SPEAKER_BLACKLIST.test(n)) return false;
    if (n.split(/\s+/).length > 3) return false;
    return true;
  }

  function parseTranscript(text) {
    const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
    const messages = [];
    let block = null; // 「王五 10:32」头部后，直到空行/下一头部
    lines.forEach((raw, i) => {
      const line = raw.trim();
      if (!line) { block = null; return; }
      let m;
      if ((m = LINE_HEADER.exec(line)) && validSpeaker(m[1])) {
        block = { speaker: m[1].trim(), time: m[2] };
        messages.push({ id: 'm' + (i + 1), lineNo: i + 1, speaker: block.speaker, time: block.time, body: '', header: true });
        return;
      }
      if ((m = LINE_BRACKET.exec(line)) && validSpeaker(m[2])) {
        block = null;
        messages.push({ id: 'm' + (i + 1), lineNo: i + 1, speaker: m[2].trim(), time: m[1], body: m[3] });
        return;
      }
      if ((m = LINE_SPEAKER.exec(line)) && validSpeaker(m[1]) && m[2] !== '') {
        block = null;
        messages.push({ id: 'm' + (i + 1), lineNo: i + 1, speaker: m[1].trim(), time: '', body: m[2] });
        return;
      }
      messages.push({ id: 'm' + (i + 1), lineNo: i + 1, speaker: block ? block.speaker : '', time: block ? block.time : '', body: line });
    });
    return messages;
  }

  /** 句子切分，保留在正文中的偏移，便于原文高亮 */
  function splitSentences(body) {
    const out = [];
    const re = /[^。！？!?；;]+(?:[。！？!?；;]+|$)/g;
    let m;
    while ((m = re.exec(body)) !== null) {
      if (!m[0]) { re.lastIndex++; continue; }
      // 英文句号 + 空格再切
      const chunk = m[0];
      const pieces = [];
      let last = 0;
      let sm;
      const splitRe = /\.\s+(?=[A-Z@])/g;
      while ((sm = splitRe.exec(chunk)) !== null) {
        pieces.push([last, sm.index + 1]);
        last = sm.index + sm[0].length;
      }
      pieces.push([last, chunk.length]);
      for (const [a, b] of pieces) {
        const start = m.index + a;
        const end = m.index + b;
        const txt = body.slice(start, end);
        if (txt.trim()) {
          const lead = txt.length - txt.trimStart().length;
          const trail = txt.length - txt.trimEnd().length;
          out.push({ start: start + lead, end: end - trail, text: txt.trim() });
        }
      }
    }
    return out;
  }

  function hash(str) {
    let h = 5381;
    for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
    return h.toString(36);
  }

  /** 分析单句：返回 null（不是承诺/请求）或候选事项 */
  function analyzeSentence(sentence, speaker, known, baseDate) {
    const s = normalizeQuotes(sentence);
    const isQuestion = QUESTION_END_RE.test(s);
    // 问句先排除：「@周启 你来处理吗？」是询问，不是指派
    const assignee = isQuestion ? null : findAssignee(s, known);
    let kind = null, owner = '', ownerSource = '', cue = '';

    if (assignee) {
      kind = 'commit'; owner = assignee.owner; ownerSource = 'assigned'; cue = assignee.cue;
    } else if (!isQuestion) {
      const third = findThirdParty(s);
      if (third) {
        kind = 'commit'; owner = third.owner; ownerSource = 'named'; cue = third.cue;
      } else if (COMMIT_ZH.some((re) => re.test(s)) || COMMIT_EN.test(s)) {
        kind = 'commit'; owner = speaker || ''; ownerSource = speaker ? 'speaker' : '';
      }
    }

    const dateHit = findDate(s, baseDate);
    const due = dateHit ? dateHit.date : null;
    const vagueTime = VAGUE_TIME_RE.exec(s);
    const ref = findVagueRef(s);

    if (!kind && !isQuestion && REQUEST_RE.test(s) && (dateHit || vagueTime || ref)) {
      kind = 'request';
    }
    if (!kind) return null;
    if (GENERIC_OWNER.test(owner)) owner = '';

    return {
      kind,
      owner,
      ownerSource,
      task: cleanTask(s, cue),
      due: due || '',
      dueText: dateHit ? dateHit.text : '',
      vagueTimeWord: !due && vagueTime ? vagueTime[0] : '',
      refWord: ref ? ref.word : '',
      refNoun: ref ? ref.noun : '',
      refRevision: ref ? ref.revision : false,
      lang: detectLang(s),
    };
  }

  /**
   * 主入口：原文 → { messages, items }
   * messages[i].sentences[j].itemId 指向对应事项，用于原文对照。
   */
  function extract(text, opts) {
    const baseDate = (opts && opts.baseDate) || localToday();
    if (!isValidISO(baseDate)) throw new Error('基准日期无效：' + baseDate);
    const messages = parseTranscript(text);
    const speakers = Array.from(new Set(messages.map((m) => m.speaker).filter(Boolean)));
    const known = speakers.slice().sort((a, b) => b.length - a.length);
    // 也允许只写名字不写姓：「Minh Tran」→「Minh」
    known.slice().forEach((k) => { const first = k.split(' ')[0]; if (first !== k && !known.includes(first)) known.push(first); });

    const items = [];
    for (const msg of messages) {
      msg.sentences = splitSentences(msg.body);
      msg.sentences.forEach((sen, j) => {
        const r = analyzeSentence(sen.text, msg.speaker, known, baseDate);
        if (!r) return;
        // 只写了名（Minh）而发言人里有唯一全名（Minh Tran）→ 归并到全名，便于按负责人筛选
        if (r.owner && !r.owner.includes(' ')) {
          const full = speakers.filter((k) => k.split(' ')[0] === r.owner && k !== r.owner);
          if (full.length === 1) r.owner = full[0];
        }
        const id = 'c' + hash(msg.lineNo + '|' + j + '|' + sen.text);
        sen.itemId = id;
        items.push(Object.assign({
          id,
          msgId: msg.id,
          lineNo: msg.lineNo,
          speaker: msg.speaker,
          sentence: sen.text,
          status: 'todo',
          originalTask: r.task,
        }, r));
      });
    }
    return { baseDate, messages, items };
  }

  /* ---------- 清晰度与澄清问题（随用户编辑动态重算） ---------- */
  function clarityFlags(item) {
    const flags = [];
    if (!item.owner || !String(item.owner).trim()) flags.push('noOwner');
    if (!item.due) flags.push(item.vagueTimeWord ? 'vagueTime' : 'noDue');
    // 只要事项里仍含原句的完整模糊短语（「那个色卡」「the revised sample」）就算指代不明；改写成具体描述即消除
    if (item.refWord && String(item.task || '').toLowerCase().includes(String(item.refWord).toLowerCase())) flags.push('vagueRef');
    return flags;
  }
  function isUnclear(item) {
    return clarityFlags(item).length > 0;
  }
  const FLAG_LABEL = { noOwner: '缺负责人', noDue: '缺期限', vagueTime: '期限含糊', vagueRef: '指代不明' };

  function buildQuestions(item) {
    const flags = clarityFlags(item);
    if (!flags.length) return [];
    const task = item.task || item.sentence;
    const who = item.owner ? String(item.owner).trim() : '';
    const qs = [];
    if (item.lang === 'en') {
      const hasRef = flags.includes('vagueRef');
      const hasTime = flags.includes('vagueTime') || flags.includes('noDue');
      if (hasRef) {
        const refQ = item.refRevision && item.refNoun
          ? 'Which revision of the ' + item.refNoun + ' should we confirm'
          : 'What exactly does "' + item.refWord + '" refer to';
        qs.push(refQ + (hasTime ? ', and what date can you commit to?' : '?'));
      } else if (hasTime) {
        qs.push((who ? who + ', what' : 'What') + ' date can you commit to for "' + task + '"?'
          + (item.vagueTimeWord ? ' ("' + item.vagueTimeWord + '" has no deadline.)' : ''));
      }
      if (flags.includes('noOwner')) qs.push('Who will own "' + task + '"?');
    } else {
      if (flags.includes('noOwner')) qs.push('「' + task + '」由谁负责？');
      if (flags.includes('vagueTime')) qs.push((who ? who + '，' : '') + '「' + task + '」能给一个具体日期吗？原话「' + item.vagueTimeWord + '」没有期限。');
      else if (flags.includes('noDue')) qs.push((who ? who + '，' : '') + '「' + task + '」预计哪天完成？');
      if (flags.includes('vagueRef')) qs.push('原话里的「' + item.refWord + '」具体指哪一份 / 哪个版本？');
    }
    return qs;
  }

  function isOverdue(item, todayIso) {
    return !!item.due && item.status === 'todo' && item.due < todayIso;
  }

  const EDIT_FIELDS = ['owner', 'task', 'due', 'status'];
  /** 字段级脏标记。兼容旧数据：只有 edited:true 没有 dirty 时，四个字段都视为人工改过（宁可少重算，不丢编辑）。 */
  function dirtyOf(item) {
    const out = {};
    const d = item && item.dirty && typeof item.dirty === 'object' ? item.dirty : null;
    for (const f of EDIT_FIELDS) out[f] = d ? d[f] === true : !!(item && item.edited === true);
    return out;
  }
  function isEdited(item) {
    const d = dirtyOf(item);
    return EDIT_FIELDS.some((f) => d[f]);
  }
  const lineKey = (it) => (it.speaker || '') + '\u0000' + (it.sentence || '');

  /**
   * 重新识别时保留人工编辑：只覆盖人工改过的字段，其余字段（例如期限）按新基准日期重算。
   * 先按 id 匹配；id 变了（原文前面插了行）时，按「说话人 + 原句」回退匹配，仅当新旧两边都唯一时才认，重复句不猜。
   */
  function mergeEdits(newItems, oldItems) {
    const olds = (oldItems || []).filter((o) => o && isEdited(o));
    const byId = new Map(olds.map((o) => [o.id, o]));
    const count = (list) => list.reduce((m, it) => m.set(lineKey(it), (m.get(lineKey(it)) || 0) + 1), new Map());
    const oldCount = count(oldItems || []);
    const newCount = count(newItems);
    const byKey = new Map(olds.filter((o) => oldCount.get(lineKey(o)) === 1).map((o) => [lineKey(o), o]));
    const used = new Set();
    const pick = (it) => {
      const o = byId.get(it.id);
      if (o) return o;
      if (newCount.get(lineKey(it)) !== 1) return null;
      const k = byKey.get(lineKey(it));
      return k && !newItems.some((n) => n.id === k.id) ? k : null;
    };
    return newItems.map((it) => {
      const o = pick(it);
      if (!o || used.has(o)) return it;
      used.add(o);
      const d = dirtyOf(o);
      const patch = { dirty: d };
      for (const f of EDIT_FIELDS) if (d[f]) patch[f] = o[f];
      return Object.assign({}, it, patch);
    });
  }

  /* ---------- 本机存储的深度校验 ---------- */
  const STR_FIELDS = ['msgId', 'speaker', 'owner', 'ownerSource', 'task', 'originalTask', 'dueText', 'vagueTimeWord', 'refWord', 'refNoun'];
  function isPlainObject(v) {
    return !!v && typeof v === 'object' && !Array.isArray(v);
  }
  /** 校验并补齐单条事项；缺 id / 原句等关键字段时返回 null（整条丢弃）。issues 收集所有被修正的问题。 */
  function normalizeItem(raw, issues, i) {
    if (!isPlainObject(raw) || typeof raw.id !== 'string' || !raw.id || typeof raw.sentence !== 'string') {
      issues.push('items[' + i + '] 结构无效，已跳过');
      return null;
    }
    const it = Object.assign({}, raw);
    for (const f of STR_FIELDS) {
      if (it[f] == null) it[f] = '';
      else if (typeof it[f] !== 'string') { issues.push('items[' + i + '].' + f + ' 类型错误'); it[f] = ''; }
    }
    if (!it.task) it.task = it.originalTask || it.sentence;
    if (!it.originalTask) it.originalTask = it.task;
    if (it.due && !isValidISO(it.due)) { issues.push('items[' + i + '].due 不是有效日期'); it.due = ''; }
    if (!Object.prototype.hasOwnProperty.call(STATUS_LABEL, it.status)) {
      if (it.status != null) issues.push('items[' + i + '].status 无效');
      it.status = 'todo';
    }
    if (!Number.isInteger(it.lineNo) || it.lineNo < 0) {
      if (it.lineNo != null) issues.push('items[' + i + '].lineNo 无效');
      it.lineNo = 0;
    }
    if (it.kind !== 'commit' && it.kind !== 'request') it.kind = 'commit';
    if (it.lang !== 'zh' && it.lang !== 'en') it.lang = detectLang(it.sentence);
    it.refRevision = it.refRevision === true;
    if (it.dirty != null && !isPlainObject(it.dirty)) { issues.push('items[' + i + '].dirty 类型错误'); delete it.dirty; }
    it.dirty = dirtyOf(it);
    delete it.edited;
    return it;
  }
  /**
   * 深度校验 localStorage 里读出的状态。返回 { state, issues }：
   * 缺字段按默认补齐（不算问题，兼容旧版本）；字段存在但类型或取值不对 → 修正并记入 issues。
   */
  function normalizeState(raw, defaults) {
    const issues = [];
    const base = Object.assign({}, defaults, { filters: Object.assign({}, defaults.filters), items: [] });
    if (!isPlainObject(raw)) return { state: base, issues: ['顶层不是对象'] };
    const s = base;
    for (const f of ['text', 'extractedText', 'extractBase']) {
      if (raw[f] == null) continue;
      if (typeof raw[f] === 'string') s[f] = raw[f];
      else issues.push(f + ' 类型错误');
    }
    if (raw.baseDate != null) {
      if (isValidISO(raw.baseDate)) s.baseDate = raw.baseDate;
      else issues.push('baseDate 无效');
    }
    if (s.extractBase && !isValidISO(s.extractBase)) { issues.push('extractBase 无效'); s.extractBase = ''; }
    if (raw.view != null) {
      if (raw.view === 'edit' || raw.view === 'map') s.view = raw.view;
      else issues.push('view 无效');
    }
    if (raw.isSample != null) {
      if (typeof raw.isSample === 'boolean') s.isSample = raw.isSample;
      else issues.push('isSample 类型错误');
    }
    if (raw.filters !== undefined) {   // 显式 null 视为损坏，走备份流程
      if (!isPlainObject(raw.filters)) issues.push('filters 类型错误');
      else {
        for (const f of ['owner', 'status', 'clarity']) {
          const v = raw.filters[f];
          if (v == null) continue;
          if (typeof v !== 'string') { issues.push('filters.' + f + ' 类型错误'); continue; }
          if (f === 'status' && v && !Object.prototype.hasOwnProperty.call(STATUS_LABEL, v)) { issues.push('filters.status 无效'); continue; }
          if (f === 'clarity' && v && v !== 'clear' && v !== 'unclear') { issues.push('filters.clarity 无效'); continue; }
          s.filters[f] = v;
        }
      }
    }
    if (raw.items !== undefined) {
      if (!Array.isArray(raw.items)) issues.push('items 不是数组');
      else {
        const seen = new Set();
        raw.items.forEach((r, i) => {
          const it = normalizeItem(r, issues, i);
          if (!it) return;
          if (seen.has(it.id)) { issues.push('items[' + i + '] id 重复，已跳过'); return; }
          seen.add(it.id);
          s.items.push(it);
        });
      }
    }
    return { state: s, issues };
  }

  function filterItems(items, f) {
    const owner = f && f.owner;
    const status = f && f.status;
    const clarity = f && f.clarity;
    return items.filter((it) => {
      if (owner === '__none__' && it.owner) return false;
      if (owner && owner !== '__none__' && it.owner !== owner) return false;
      if (status && it.status !== status) return false;
      if (clarity === 'unclear' && !isUnclear(it)) return false;
      if (clarity === 'clear' && isUnclear(it)) return false;
      return true;
    });
  }

  /* ---------- 导出 ---------- */
  const STATUS_LABEL = { todo: '待办', done: '已完成', cancelled: '已取消' };

  function csvCell(v) {
    let s = String(v == null ? '' : v);
    // 防公式注入：跳过开头的空白 / 控制字符后，首个有效字符是 = + - @ 就加 ' 前缀
    if (/^[\t\r]/.test(s) || /^[\s\u0000-\u001f\u007f-\u009f\u00a0\u200b-\u200f\u2028\u2029\u3000\ufeff]*[=+\-@＝＋－＠]/.test(s)) s = "'" + s;
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function toCSV(items, todayIso) {
    const head = ['负责人', '事项', '期限', '状态', '清晰度', '待澄清原因', '逾期', '原文行号', '原话'];
    const rows = items.map((it) => [
      it.owner, it.task, it.due, STATUS_LABEL[it.status] || it.status,
      isUnclear(it) ? '待澄清' : '清晰',
      clarityFlags(it).map((f) => FLAG_LABEL[f]).join('；'),
      isOverdue(it, todayIso) ? '是' : '',
      it.lineNo, it.sentence,
    ]);
    return '﻿' + [head].concat(rows).map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
  }

  /** Markdown 里的用户文本：编码 & < >，避免允许原始 HTML 的阅读器执行其中的标签 */
  function mdText(v) {
    return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\r\n|\r|\n/g, ' ');
  }
  function mdCell(v) {
    return mdText(v).replace(/\\/g, '\\\\').replace(/\|/g, '\\|');
  }
  function toMarkdown(items, meta) {
    const m = meta || {};
    const today = m.today || localToday();
    const out = [];
    out.push('# 跟进纪要');
    out.push('');
    out.push('- 基准日期：' + mdText(m.baseDate || '') + '　导出日期：' + mdText(today));
    out.push('- 承诺 ' + items.length + ' 条，其中待澄清 ' + items.filter(isUnclear).length + ' 条，逾期 ' + items.filter((it) => isOverdue(it, today)).length + ' 条');
    out.push('- 由规则识别，会漏判和误判，请人工核对后再发送。');
    out.push('');
    out.push('## 承诺清单');
    out.push('');
    out.push('| 负责人 | 事项 | 期限 | 状态 | 备注 |');
    out.push('| --- | --- | --- | --- | --- |');
    for (const it of items) {
      const note = [isOverdue(it, today) ? '逾期' : '', clarityFlags(it).map((f) => FLAG_LABEL[f]).join('、')].filter(Boolean).join('；');
      out.push('| ' + [it.owner || '（未定）', it.task, it.due || '（未定）', STATUS_LABEL[it.status] || it.status, note].map(mdCell).join(' | ') + ' |');
    }
    const qs = items.filter((it) => it.status !== 'cancelled').flatMap((it) => buildQuestions(it));
    out.push('');
    out.push('## 需要追问');
    out.push('');
    if (qs.length) qs.forEach((q, i) => out.push((i + 1) + '. ' + mdText(q)));
    else out.push('（无）');
    out.push('');
    return out.join('\n');
  }

  function icsEscape(v) {
    return String(v == null ? '' : v)
      .replace(/\\/g, '\\\\')
      .replace(/;/g, '\\;')
      .replace(/,/g, '\\,')
      .replace(/\r\n|\r|\n/g, '\\n');
  }
  /** RFC 5545 §3.1：每行不超过 75 个八位字节，续行以空格开头；不拆开多字节字符 */
  function icsFold(line) {
    const enc = (c) => Buffer_byteLength(c);
    const parts = [];
    let cur = '';
    let bytes = 0;
    let limit = 75;
    for (const ch of line) {
      const b = enc(ch);
      if (bytes + b > limit) {
        parts.push(cur);
        cur = ch;
        bytes = b;
        limit = 74; // 续行首个空格占 1 字节
      } else {
        cur += ch;
        bytes += b;
      }
    }
    parts.push(cur);
    return parts.join('\r\n ');
  }
  function Buffer_byteLength(ch) {
    const c = ch.codePointAt(0);
    return c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4;
  }
  function icsStamp(date) {
    const d = date || new Date();
    return d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate()) + 'T'
      + pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + pad(d.getUTCSeconds()) + 'Z';
  }
  function toICS(items, opts) {
    const now = (opts && opts.now) || new Date();
    const stamp = icsStamp(now);
    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Commit Follow-up Extractor//MVP//ZH',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
    ];
    const withDate = items.filter((it) => it.due && isValidISO(it.due) && it.status !== 'cancelled');
    for (const it of withDate) {
      const start = it.due.replace(/-/g, '');
      const end = addDays(it.due, 1).replace(/-/g, '');
      const summary = (it.owner ? it.owner + '：' : '') + it.task;
      const desc = '原话：' + it.sentence + '\n状态：' + (STATUS_LABEL[it.status] || it.status)
        + (isUnclear(it) ? '\n待澄清：' + clarityFlags(it).map((f) => FLAG_LABEL[f]).join('、') : '');
      lines.push('BEGIN:VEVENT');
      // 存储中的 id 也是外部输入，不能让 CR/LF 或分隔符成为日历属性。
      // 连百分号一起编码，避免不同 id 编码后碰撞；按 UTF-16 编码也能处理孤立代理项。
      const uid = String(it.id).replace(/[^a-zA-Z0-9_.-]/g, (ch) => '%' + ch.charCodeAt(0).toString(16).padStart(4, '0'));
      lines.push('UID:' + uid + '-' + start + '@commit-extractor.local');
      lines.push('DTSTAMP:' + stamp);
      lines.push('DTSTART;VALUE=DATE:' + start);
      lines.push('DTEND;VALUE=DATE:' + end);
      lines.push('SUMMARY:' + icsEscape(summary));
      lines.push('DESCRIPTION:' + icsEscape(desc));
      lines.push('STATUS:' + (it.status === 'done' ? 'CONFIRMED' : 'TENTATIVE'));
      lines.push('TRANSP:TRANSPARENT');
      lines.push('END:VEVENT');
    }
    lines.push('END:VCALENDAR');
    return lines.map(icsFold).join('\r\n') + '\r\n';
  }

  const api = {
    // 日期
    parseDate, findDate, addDays, weekday, isValidISO, localToday,
    // 解析与识别
    parseTranscript, splitSentences, analyzeSentence, extract, detectLang,
    // 清晰度
    clarityFlags, isUnclear, buildQuestions, FLAG_LABEL, STATUS_LABEL,
    // 列表
    isOverdue, mergeEdits, filterItems, dirtyOf, isEdited, normalizeState,
    // 导出
    toCSV, toMarkdown, toICS, icsEscape, icsFold,
  };
  globalThis.CommitCore = api;
  if (typeof module !== 'undefined') module.exports = api;
})();

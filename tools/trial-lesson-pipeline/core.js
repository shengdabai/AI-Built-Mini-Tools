'use strict';
/* 试课跟进看板 · 纯逻辑(无 DOM)。所有日期为 YYYY-MM-DD 字符串,天数为整数天。 */
(function () {
  var STAGES = ['咨询中', '已约试课', '已试课', '已报价', '已付款', '已开课'];
  var LOST = '流失';
  var LOSS_REASONS = ['价格', '时间冲突', '没回复', '选了别人', '其他'];
  var CHANNELS = ['学员推荐', '社群', '网站', '平台', '其他'];
  var CONTACT_CHANNELS = ['微信', '电话', '邮件', '视频会议', '线下', '其他'];
  var GOALS = ['HSK 备考', '生活口语', '商务', '文化', '其他'];
  var CLOSED = ['已付款', '已开课', LOST];
  var DEFAULT_N = 3;
  var WEEK_DAYS = 7;
  var EVENT_TYPES = ['detailed', 'quick_date_only'];
  var EVENT_PROVENANCE = ['user', 'sample'];

  function isDate(s) {
    if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    var p = s.split('-').map(Number);
    var d = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
    return d.getUTCFullYear() === p[0] && d.getUTCMonth() === p[1] - 1 && d.getUTCDate() === p[2];
  }
  function dayNum(s) {
    if (!isDate(s)) throw new Error('日期格式应为 YYYY-MM-DD:' + s);
    var p = s.split('-').map(Number);
    return Math.round(Date.UTC(p[0], p[1] - 1, p[2]) / 86400000);
  }
  function diffDays(a, b) { return dayNum(a) - dayNum(b); }
  function fmtDate(d) {
    function z(n) { return (n < 10 ? '0' : '') + n; }
    return d.getFullYear() + '-' + z(d.getMonth() + 1) + '-' + z(d.getDate());
  }
  function addDays(s, n) {
    var d = new Date((dayNum(s) + n) * 86400000);
    function z(x) { return (x < 10 ? '0' : '') + x; }
    return d.getUTCFullYear() + '-' + z(d.getUTCMonth() + 1) + '-' + z(d.getUTCDate());
  }
  /* 从 location.search 取 today;非法或缺失用 now(Date)的本地日期 */
  function resolveToday(search, now) {
    var v = new URLSearchParams(search || '').get('today');
    if (v !== null && isDate(v)) return v;
    return fmtDate(now || new Date());
  }

  /* 同 resolveToday,但额外返回 fixed:地址参数里的真实日期才算固定 */
  function resolveTodayInfo(search, now) {
    var v = new URLSearchParams(search || '').get('today');
    if (v !== null && isDate(v)) return { date: v, fixed: true };
    return { date: fmtDate(now || new Date()), fixed: false };
  }

  function stageIndex(stage) { return STAGES.indexOf(stage); }

  function contactId() { return 'E' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  function legacyAnchor(f, first) {
    if (f.legacyContactAnchor === null) return null;
    if (f.legacyContactAnchor && isDate(f.legacyContactAnchor.date)) {
      return { date: f.legacyContactAnchor.date, verification: 'unverified', source: f.legacyContactAnchor.source || 'legacy_last_contact' };
    }
    return { date: isDate(f.lastContact) ? f.lastContact : first, verification: 'unverified', source: isDate(f.lastContact) ? 'legacy_last_contact' : 'initial_baseline' };
  }
  function activeContactEvents(lead) {
    var archived = Object.create(null);
    (lead.archivedContactEventIds || []).forEach(function (id) { archived[id] = true; });
    return (lead.contactEvents || []).filter(function (e) { return !archived[e.id]; });
  }
  function effectiveLastContact(lead) {
    var dates = activeContactEvents(lead).map(function (e) { return e.date; });
    if (lead.legacyContactAnchor && isDate(lead.legacyContactAnchor.date)) dates.push(lead.legacyContactAnchor.date);
    if (!dates.length && isDate(lead.firstContact)) dates.push(lead.firstContact);
    dates.sort();
    return dates[dates.length - 1] || '';
  }
  function refreshLead(lead) {
    var next = Object.assign({}, lead, {
      legacyContactAnchor: legacyAnchor(lead, lead.firstContact),
      contactEvents: (lead.contactEvents || []).map(function (e) { return Object.assign({}, e); }),
      archivedContactEventIds: (lead.archivedContactEventIds || []).slice(),
      stageHistory: (lead.stageHistory || []).map(function (h) { return Object.assign({}, h); })
    });
    next.lastContact = effectiveLastContact(next);
    return next;
  }

  function newLead(f, today, id) {
    var stage = f.stage || STAGES[0];
    var first = f.firstContact || today;
    var lead = {
      id: id || ('L' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)),
      name: String(f.name || '').trim(),
      channel: f.channel || '其他',
      firstContact: first,
      timezone: f.timezone || '',
      goal: f.goal || '其他',
      stage: stage,
      legacyContactAnchor: legacyAnchor(f, first),
      contactEvents: (f.contactEvents || []).map(function (e) { return Object.assign({}, e); }),
      archivedContactEventIds: (f.archivedContactEventIds || []).slice(),
      nextAction: f.nextAction || '',
      nextDate: f.nextDate || '',
      quoteAmount: f.quoteAmount === undefined || f.quoteAmount === '' ? '' : f.quoteAmount,
      quoteCurrency: f.quoteCurrency || '',
      note: f.note || '',
      lossReason: f.lossReason || '',
      stageHistory: f.stageHistory ? f.stageHistory.slice() : [{ stage: stage, date: first }]
    };
    lead.lastContact = effectiveLastContact(lead);
    return lead;
  }

  function makeContactEvent(fields) {
    var type = fields.type || 'detailed';
    if (EVENT_TYPES.indexOf(type) < 0) throw new Error('联系事件类型无效');
    if (!isDate(fields.date)) throw new Error('联系日期无效');
    var provenance = fields.provenance || 'user';
    if (EVENT_PROVENANCE.indexOf(provenance) < 0) throw new Error('联系事件来源无效');
    if (type === 'detailed' && (!String(fields.channel || '').trim() || !String(fields.summary || '').trim() || !String(fields.outcome || '').trim())) {
      throw new Error('完整联系事件必须填写渠道、摘要和结果');
    }
    return {
      id: fields.id || contactId(), type: type, date: fields.date,
      channel: type === 'detailed' ? String(fields.channel).trim() : '',
      summary: type === 'detailed' ? String(fields.summary).trim() : '',
      outcome: type === 'detailed' ? String(fields.outcome).trim() : '',
      nextStep: type === 'detailed' ? String(fields.nextStep || '').trim() : '',
      provenance: provenance, supersedes: fields.supersedes || ''
    };
  }
  function addContactEvent(lead, fields) {
    var event = makeContactEvent(fields);
    if (event.supersedes) throw new Error('更正联系事件请使用更正操作');
    if ((lead.contactEvents || []).some(function (e) { return e.id === event.id; })) throw new Error('联系事件 id 重复');
    var next = refreshLead(lead);
    next.contactEvents = next.contactEvents.concat([event]);
    next.lastContact = effectiveLastContact(next);
    return next;
  }
  function archiveContactEvent(lead, eventId) {
    if (!activeContactEvents(lead).some(function (e) { return e.id === eventId; })) throw new Error('只能归档当前有效的联系事件');
    var next = refreshLead(lead);
    next.archivedContactEventIds = next.archivedContactEventIds.concat([eventId]);
    next.lastContact = effectiveLastContact(next);
    return next;
  }
  function correctContactEvent(lead, eventId, fields) {
    if (!activeContactEvents(lead).some(function (e) { return e.id === eventId; })) throw new Error('只能更正当前有效的联系事件');
    var replacement = makeContactEvent(Object.assign({}, fields, { supersedes: eventId }));
    if ((lead.contactEvents || []).some(function (e) { return e.id === replacement.id; })) throw new Error('联系事件 id 重复');
    var next = archiveContactEvent(lead, eventId);
    next.contactEvents = next.contactEvents.concat([replacement]);
    next.lastContact = effectiveLastContact(next);
    return next;
  }

  /* 推进阶段,返回新对象。回退(含从流失恢复)需 opts.allowBack。流失必须带原因。 */
  function advance(lead, stage, date, lossReason, opts) {
    if (stage !== LOST && stageIndex(stage) < 0) throw new Error('未知阶段:' + stage);
    if (!isDate(date)) throw new Error('日期格式应为 YYYY-MM-DD:' + date);
    if (stage === lead.stage) throw new Error('线索已在「' + stage + '」');
    var allowBack = !!(opts && opts.allowBack);
    if (stage === LOST) {
      if (LOSS_REASONS.indexOf(lossReason) < 0) throw new Error('流失必须选择原因:' + LOSS_REASONS.join(' / '));
    } else {
      var from = lead.stage === LOST ? -1 : stageIndex(lead.stage);
      var back = lead.stage === LOST || stageIndex(stage) < from;
      if (back && !allowBack) throw new Error('不能回退到更早阶段(需显式 allowBack)');
    }
    var next = refreshLead(lead);
    next.stage = stage;
    next.lossReason = stage === LOST ? lossReason : '';
    next.stageHistory = (lead.stageHistory || []).concat([{ stage: stage, date: date }]);
    return next;
  }

  function daysSinceContact(lead, today) {
    return diffDays(today, effectiveLastContact(lead));
  }

  /* 超期线索,按逾期天数降序。n 默认 3。已付款/已开课/流失不算。 */
  function overdue(leads, today, n) {
    var limit = n === undefined || n === null ? DEFAULT_N : n;
    var out = [];
    (leads || []).forEach(function (lead) {
      if (CLOSED.indexOf(lead.stage) >= 0) return;
      var since = daysSinceContact(lead, today);
      var reasons = [];
      var od = 0;
      if (since > limit) { reasons.push('contact'); od = Math.max(od, since - limit); }
      if (lead.nextDate && diffDays(today, lead.nextDate) > 0) {
        reasons.push('planned');
        od = Math.max(od, diffDays(today, lead.nextDate));
      }
      if (reasons.length) out.push({ lead: lead, daysSince: since, overdueDays: od, reasons: reasons });
    });
    out.sort(function (a, b) { return b.overdueDays - a.overdueDays || b.daysSince - a.daysSince; });
    return out;
  }

  /* 线索是否曾到达某阶段:历史里出现该阶段,或出现更靠后的非流失阶段(跳级视为经过) */
  function reached(lead, stage) {
    var idx = stageIndex(stage);
    return (lead.stageHistory || []).some(function (h) {
      var i = stageIndex(h.stage);
      return i >= 0 && i >= idx;
    });
  }
  function rate(num, den) { return den > 0 ? num / den : null; }

  function funnel(leads) {
    var list = leads || [];
    var counts = {};
    var reachedCounts = {};
    STAGES.concat([LOST]).forEach(function (s) { counts[s] = 0; });
    STAGES.forEach(function (s) { reachedCounts[s] = 0; });
    list.forEach(function (l) {
      if (counts[l.stage] !== undefined) counts[l.stage] += 1;
      STAGES.forEach(function (s) { if (reached(l, s)) reachedCounts[s] += 1; });
    });
    return {
      total: list.length,
      counts: counts,
      reached: reachedCounts,
      consultToTrial: rate(reachedCounts['已试课'], reachedCounts['咨询中']),
      trialToPaid: rate(reachedCounts['已付款'], reachedCounts['已试课']),
      overall: rate(reachedCounts['已付款'], reachedCounts['咨询中'])
    };
  }

  function byChannel(leads) {
    var map = Object.create(null);
    (leads || []).forEach(function (l) {
      var c = l.channel || '其他';
      if (!map[c]) map[c] = { channel: c, leads: 0, paid: 0 };
      map[c].leads += 1;
      if (reached(l, '已付款')) map[c].paid += 1;
    });
    return Object.keys(map).map(function (k) { return map[k]; })
      .sort(function (a, b) { return b.leads - a.leads || a.channel.localeCompare(b.channel, 'zh'); });
  }

  function lossReasons(leads) {
    var map = Object.create(null);
    (leads || []).forEach(function (l) {
      if (l.stage !== LOST) return;
      var r = l.lossReason || '其他';
      map[r] = (map[r] || 0) + 1;
    });
    return Object.keys(map).map(function (k) { return { reason: k, count: map[k] }; })
      .sort(function (a, b) { return b.count - a.count || a.reason.localeCompare(b.reason, 'zh'); });
  }

  function historyDate(lead, stage) {
    var h = (lead.stageHistory || []).filter(function (x) { return x.stage === stage; });
    return h.length ? h[h.length - 1].date : null;
  }
  /* 「本周」= today-7 到 today(含两端):第 7 天算,第 8 天不算 */
  function inWeek(date, today) {
    if (!date) return false;
    var d = diffDays(today, date);
    return d >= 0 && d <= WEEK_DAYS;
  }

  function weeklyReport(leads, today, n, opts) {
    var list = leads || [];
    var from = addDays(today, -WEEK_DAYS);
    var newLeads = list.filter(function (l) { return inWeek(l.firstContact, today); });
    var trials = list.filter(function (l) { return inWeek(historyDate(l, '已试课'), today); });
    var paid = list.filter(function (l) { return inWeek(historyDate(l, '已付款'), today); });
    var contacts = [];
    var quickContacts = [];
    var auditEvents = [];
    list.forEach(function (l) {
      var archived = Object.create(null);
      (l.archivedContactEventIds || []).forEach(function (id) { archived[id] = true; });
      (l.contactEvents || []).forEach(function (event) { auditEvents.push({ lead: l, event: event, archived: !!archived[event.id] }); });
      activeContactEvents(l).forEach(function (event) {
        if (!inWeek(event.date, today)) return;
        (event.type === 'detailed' ? contacts : quickContacts).push({ lead: l, event: event });
      });
    });
    var follow = overdue(list, today, n);
    function names(arr) { return arr.length ? arr.map(function (l) { return '- ' + l.name + '(' + l.channel + ')'; }).join('\n') : '- 无'; }
    var md = [
      '# 试课跟进周报 ' + from + ' 至 ' + today,
      '',
      opts && opts.sample ? '数据来源:合成示例(虚构线索,不是真实学员)' : null,
      opts && opts.sample ? '' : null,
      '## 本周新增(' + newLeads.length + ')',
      names(newLeads),
      '',
      '## 本周试课(' + trials.length + ')',
      names(trials),
      '',
      '## 本周付款(' + paid.length + ')',
      names(paid),
      '',
      '## 本周已核实联系事件(' + contacts.length + ')',
      contacts.length ? contacts.map(function (x) { return '- ' + x.event.date + ' · ' + x.lead.name + ' · ' + x.event.channel + ' · ' + x.event.summary + ' → ' + x.event.outcome + ' [id:' + x.event.id + ';来源:' + x.event.provenance + ']'; }).join('\n') : '- 无',
      '',
      '## 本周仅日期标记(' + quickContacts.length + ',不计入已核实联系)',
      quickContacts.length ? quickContacts.map(function (x) { return '- ' + x.event.date + ' · ' + x.lead.name + ' [id:' + x.event.id + ';来源:' + x.event.provenance + ']'; }).join('\n') : '- 无',
      '',
      '## 联系事件审计记录(全部)',
      auditEvents.length ? auditEvents.map(function (x) { return '- ' + x.event.date + ' · ' + x.lead.name + ' · ' + x.event.type + ' · ' + (x.archived ? '已归档' : '有效') + ' [id:' + x.event.id + ';来源:' + x.event.provenance + (x.event.supersedes ? ';更正自:' + x.event.supersedes : '') + ']'; }).join('\n') : '- 无',
      '',
      '## 待跟进清单(' + follow.length + ')',
      follow.length ? follow.map(function (o) {
        return '- ' + o.lead.name + ':' + o.lead.stage + ',距最近联系 ' + o.daysSince + ' 天,逾期 ' + o.overdueDays + ' 天' +
          (o.lead.nextAction ? ',下一步:' + o.lead.nextAction + (o.lead.nextDate ? '(' + o.lead.nextDate + ')' : '') : '');
      }).join('\n') : '- 无',
      '',
      '## 口径',
      '- 「本周」= ' + from + ' 至 ' + today + '(含两端)。新增按首次联系日期,试课、付款按阶段记录里的日期。',
      '- 已核实联系只统计 detailed 事件。旧最近联系锚点和 quick_date_only 仅日期标记不计入。',
      '- 待跟进 = 距最近联系超过 ' + (n === undefined || n === null ? DEFAULT_N : n) + ' 天未联系,或下一步计划日期已过;已付款、已开课、流失不计入。',
      ''
    ].filter(function (x) { return x !== null; }).join('\n');
    return { from: from, to: today, newLeads: newLeads, trials: trials, paid: paid, contacts: contacts, quickContacts: quickContacts, followUps: follow, markdown: md };
  }

  var CSV_COLS = [
    ['姓名', 'name'], ['渠道', 'channel'], ['首次联系', 'firstContact'], ['时区', 'timezone'], ['学习目标', 'goal'],
    ['阶段', 'stage'], ['最近联系(派生)', 'lastContact'], ['旧联系锚点', '_anchor'], ['联系事件(JSON)', '_events'], ['归档事件ID(JSON)', '_archived'], ['下一步', 'nextAction'], ['下一步日期', 'nextDate'],
    ['报价金额', 'quoteAmount'], ['币种', 'quoteCurrency'], ['流失原因', 'lossReason'], ['备注', 'note']
  ];
  function csvCell(v) {
    var s = v === undefined || v === null ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = "'" + s;
    if (/[",\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
    return s;
  }
  function toCsv(leads, opts) {
    var sample = !!(opts && opts.sample);
    var rows = [CSV_COLS.map(function (c) { return c[0]; }).concat(sample ? ['数据来源'] : []).join(',')];
    (leads || []).forEach(function (raw) {
      var l = refreshLead(raw);
      var extra = { _anchor: JSON.stringify(l.legacyContactAnchor), _events: JSON.stringify(l.contactEvents), _archived: JSON.stringify(l.archivedContactEventIds) };
      rows.push(CSV_COLS.map(function (c) { return csvCell(extra[c[1]] !== undefined ? extra[c[1]] : l[c[1]]); }).concat(sample ? ['合成示例'] : []).join(','));
    });
    return rows.join('\n') + '\n';
  }

  /* 导入校验。接受 JSON 字符串或对象({leads:[...]} 或数组)。返回 {ok, errors, leads} */
  function validateImport(json) {
    var errors = [];
    var data = json;
    if (typeof json === 'string') {
      try { data = JSON.parse(json); } catch (e) { return { ok: false, errors: ['不是有效的 JSON'], leads: [], n: null, sample: false }; }
    }
    var arr = Array.isArray(data) ? data : (data && Array.isArray(data.leads) ? data.leads : null);
    if (!arr) return { ok: false, errors: ['缺少 leads 数组'], leads: [], n: null, sample: false };
    var n = null;
    if (!Array.isArray(data) && data.n !== undefined && data.n !== null) {
      if (typeof data.n === 'number' && Number.isInteger(data.n) && data.n >= 1 && data.n <= 60) n = data.n;
      else errors.push('超期阈值 n 应为 1 到 60 之间的整数');
    }
    var sample = !Array.isArray(data) && data.sample === true;
    /* 空列表([] 或 {leads: []})是合法备份:清空看板后导出的就是它。导入后看板为空;已有线索时 app 会先页内确认再替换 */
    if (arr.length === 0) {
      return { ok: errors.length === 0, errors: errors, leads: [], n: errors.length === 0 ? n : null, sample: errors.length === 0 && sample };
    }
    var leads = [];
    var ids = Object.create(null);
    var eventIds = Object.create(null);
    arr.forEach(function (raw, i) {
      var tag = '第 ' + (i + 1) + ' 条';
      if (!raw || typeof raw !== 'object') { errors.push(tag + ':不是对象'); return; }
      var before = errors.length;
      if (typeof raw.name !== 'string' || !raw.name.trim()) errors.push(tag + ':缺少姓名');
      if (typeof raw.channel !== 'string' || !raw.channel.trim()) errors.push(tag + ':渠道应为非空文本');
      if (raw.id !== undefined && (typeof raw.id !== 'string' || !raw.id.trim())) errors.push(tag + ':id 应为非空文本');
      ['goal', 'timezone', 'nextAction', 'note', 'quoteCurrency'].forEach(function (k) {
        if (raw[k] !== undefined && typeof raw[k] !== 'string') errors.push(tag + ':' + k + ' 应为文本');
      });
      if (STAGES.concat([LOST]).indexOf(raw.stage) < 0) errors.push(tag + ':阶段无效');
      if (!isDate(raw.firstContact)) errors.push(tag + ':firstContact 日期无效');
      if (raw.lastContact !== undefined && !isDate(raw.lastContact)) errors.push(tag + ':lastContact 日期无效');
      if (raw.nextDate && !isDate(raw.nextDate)) errors.push(tag + ':nextDate 日期无效');
      if (raw.legacyContactAnchor !== undefined && (!raw.legacyContactAnchor || !isDate(raw.legacyContactAnchor.date) || raw.legacyContactAnchor.verification !== 'unverified')) errors.push(tag + ':旧联系锚点无效');
      if (raw.stage === LOST && LOSS_REASONS.indexOf(raw.lossReason) < 0) errors.push(tag + ':流失缺少有效原因');
      if (raw.quoteAmount !== undefined && raw.quoteAmount !== '' && !(typeof raw.quoteAmount === 'number' && raw.quoteAmount >= 0)) errors.push(tag + ':报价金额应为非负数字');
      if (!Array.isArray(raw.stageHistory) || !raw.stageHistory.length) {
        errors.push(tag + ':stageHistory 缺失');
      } else {
        raw.stageHistory.forEach(function (h) {
          if (!h || STAGES.concat([LOST]).indexOf(h.stage) < 0 || !isDate(h.date)) errors.push(tag + ':stageHistory 含无效记录');
        });
      }
      if (raw.contactEvents !== undefined && !Array.isArray(raw.contactEvents)) errors.push(tag + ':contactEvents 应为数组');
      var contactEvents = Array.isArray(raw.contactEvents) ? raw.contactEvents : [];
      contactEvents.forEach(function (event) {
        if (!event || typeof event !== 'object' || Array.isArray(event)) { errors.push(tag + ':联系事件应为对象'); return; }
        if (!event || typeof event.id !== 'string' || !event.id.trim() || eventIds[event.id]) errors.push(tag + ':联系事件 id 无效或重复');
        else eventIds[event.id] = true;
        if (EVENT_TYPES.indexOf(event.type) < 0 || !isDate(event.date) || EVENT_PROVENANCE.indexOf(event.provenance) < 0) errors.push(tag + ':联系事件日期、类型或来源无效');
        ['channel', 'summary', 'outcome', 'nextStep', 'supersedes'].forEach(function (k) { if (event[k] !== undefined && typeof event[k] !== 'string') errors.push(tag + ':联系事件字段应为文本'); });
        if (event.type === 'detailed' && (!event.channel || !event.summary || !event.outcome)) errors.push(tag + ':完整联系事件缺少渠道、摘要或结果');
        if (event.type === 'quick_date_only' && (event.channel || event.summary || event.outcome || event.nextStep)) errors.push(tag + ':仅日期标记不能包含详情');
      });
      if (raw.archivedContactEventIds !== undefined && !Array.isArray(raw.archivedContactEventIds)) errors.push(tag + ':archivedContactEventIds 应为数组');
      if (Array.isArray(raw.archivedContactEventIds)) {
        var localIds = contactEvents.filter(function (e) { return e && typeof e === 'object'; }).map(function (e) { return e.id; });
        var seenArchived = Object.create(null);
        raw.archivedContactEventIds.forEach(function (eventId) {
          if (typeof eventId !== 'string' || localIds.indexOf(eventId) < 0 || seenArchived[eventId]) errors.push(tag + ':归档事件 id 无效或重复');
          seenArchived[eventId] = true;
        });
      }
      var correctedParents = Object.create(null), parentById = Object.create(null);
      contactEvents.forEach(function (event) {
        if (!event || typeof event !== 'object') return;
        if (event.supersedes && !contactEvents.some(function (candidate) { return candidate && candidate.id === event.supersedes; })) errors.push(tag + ':更正事件引用不存在的原事件');
        if (event.supersedes && (!Array.isArray(raw.archivedContactEventIds) || raw.archivedContactEventIds.indexOf(event.supersedes) < 0)) errors.push(tag + ':被更正事件必须明确归档');
        if (event.supersedes && correctedParents[event.supersedes]) errors.push(tag + ':原联系事件不能存在多个更正分支');
        if (event.supersedes) correctedParents[event.supersedes] = true;
        if (typeof event.id === 'string') parentById[event.id] = event.supersedes || '';
      });
      Object.keys(parentById).forEach(function (id) {
        var cursor = id, seen = Object.create(null);
        while (cursor && Object.prototype.hasOwnProperty.call(parentById, cursor)) {
          if (seen[cursor]) { errors.push(tag + ':联系事件更正链不能循环'); break; }
          seen[cursor] = true;
          cursor = parentById[cursor];
        }
      });
      if (typeof raw.id === 'string' && raw.id.trim()) {
        if (ids[raw.id]) errors.push(tag + ':id 重复');
        ids[raw.id] = true;
      }
      if (errors.length === before) leads.push(newLead(raw, raw.firstContact, raw.id));
    });
    return { ok: errors.length === 0, errors: errors, leads: errors.length === 0 ? leads : [], n: errors.length === 0 ? n : null, sample: errors.length === 0 && sample };
  }

  /* JSON 备份:线索 + 超期阈值 n + 示例标记,导入时一并校验 */
  function toBackup(leads, n, opts) {
    return { version: 3, sample: !!(opts && opts.sample), n: n, leads: (leads || []).map(refreshLead) };
  }

  function describeCounts(leads, n) {
    return (leads || []).length + ' 条线索、超期阈值 ' + n + ' 天';
  }

  var api = {
    STAGES: STAGES, LOST: LOST, LOSS_REASONS: LOSS_REASONS, CHANNELS: CHANNELS, CONTACT_CHANNELS: CONTACT_CHANNELS, GOALS: GOALS, CLOSED: CLOSED, DEFAULT_N: DEFAULT_N,
    isDate: isDate, resolveTodayInfo: resolveTodayInfo, toBackup: toBackup, describeCounts: describeCounts, diffDays: diffDays, addDays: addDays, resolveToday: resolveToday,
    newLead: newLead, refreshLead: refreshLead, advance: advance, addContactEvent: addContactEvent, archiveContactEvent: archiveContactEvent, correctContactEvent: correctContactEvent, activeContactEvents: activeContactEvents, effectiveLastContact: effectiveLastContact, daysSinceContact: daysSinceContact, overdue: overdue,
    reached: reached, funnel: funnel, byChannel: byChannel, lossReasons: lossReasons,
    weeklyReport: weeklyReport, toCsv: toCsv, validateImport: validateImport
  };
  globalThis.FollowCore = api;
  if (typeof module !== 'undefined') module.exports = api;
})();

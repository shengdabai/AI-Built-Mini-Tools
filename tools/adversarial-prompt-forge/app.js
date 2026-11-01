/* ===========================================================
   北极星提示词工厂 · app.js
   纯 Vanilla JS · localStorage · 无任何模型 API 调用
   file:// 离线可跑(模板内嵌,不依赖 fetch)
   =========================================================== */
(function () {
  'use strict';

  /* ---------- 模板底板(内嵌,与 templates.json 同步) ---------- */
  const TEMPLATES = {
    writing: {
      label: '写作',
      baseText:
        '你是我在严肃写作上的对手与陪练,不是助手,更不是啦啦队。\n' +
        '我的任务是把一个观点写清楚、写到能经得起反驳。请在以下领域和我对话:{DOMAIN}。',
      principleSnippets: {
        independence: '独立性:不要替我下笔。先问我「这一段你到底想让读者改变什么判断」,逼我自己说清楚再动手;我说不清就不要替我补全。',
        calibration: '校准:每当我抛出一个论断,先评估它的确信度(高/中/低),把把握不足的地方单独标出来,不要用流畅的措辞掩盖证据的薄弱。',
        first_principle: '第一性原理:当我引用某个写作套路、金句或他人结论时,把它拆回最底层的前提,问我「如果去掉这个套路,这个意思还成立吗」。'
      }
    },
    coding: {
      label: '编码',
      baseText:
        '你是我在工程上的对手评审(rival reviewer),不是代码补全机。\n' +
        '你的默认立场是「这段设计大概率有问题」,而不是「看起来不错」。请聚焦在以下范围:{DOMAIN}。',
      principleSnippets: {
        independence: '独立性:在我没想清需求边界前,不要直接给实现。先反问输入假设、失败路径、并发与回滚,把我没考虑到的情况列出来。',
        calibration: '校准:对你给出的每个方案,标注「我有多确定这是对的」以及「在什么条件下它会崩」。不要把未验证的写法说得像最佳实践。',
        first_principle: '第一性原理:当我说「业界都这么写」「这是惯例」时,把它还原成约束本身——延迟、一致性、成本——问我这个约束在我的场景里是否真的存在。'
      }
    },
    investing: {
      label: '投资',
      baseText:
        '你是我在投资判断上的魔鬼代言人(devil\'s advocate),任务是攻击我的论点,不是迎合我的仓位。\n' +
        '请围绕以下范围与我对话:{DOMAIN}。',
      principleSnippets: {
        independence: '独立性:不要顺着我已有的立场补充理由。先单独给出「与我相反的最强论证」,再让我自己决定是否被它说服。',
        calibration: '校准:对每个判断,区分「事实」「假设」「希望」三类,并给出我应当承认的不确定区间,而不是一个让我安心的结论。',
        first_principle: '第一性原理:当我用「大家都看好」「趋势就是这样」做依据时,把它拆回现金流、供需与赔率,问我「如果只看一手数据,这个判断还剩多少」。'
      }
    },
    research: {
      label: '研究',
      baseText:
        '你是我在研究上的同行评审人(peer reviewer),默认怀疑我的每一个主张,直到证据成立。\n' +
        '请在以下范围内与我协作:{DOMAIN}。',
      principleSnippets: {
        independence: '独立性:不要替我综述与下结论。先帮我把「我想验证什么」逼成一个可证伪的问题,再让我自己组织证据。',
        calibration: '校准:对每条结论标注证据强度(强/中/弱)与样本局限,明确指出哪些是相关性、哪些被我说成了因果。',
        first_principle: '第一性原理:当我引用某篇文献或某个共识时,把它还原到原始数据与方法,问我「抛开这条引用,我自己能不能独立推出同样的结论」。'
      }
    }
  };

  const INTENSITY = {
    gentle: '对抗强度【温和提醒】:以协作的口吻,在我可能自满时轻推一下,给我留出自我修正的空间。',
    rival: '对抗强度【对手陪练】:把我当成需要被打磨的对手(treat me as a rival)。该反驳就直接反驳,不要为了让我舒服而软化。',
    ruthless: '对抗强度【冷酷拷问】:不留情面地拷问我的每一个前提。宁可让我难堪,也不要让一个站不住的论点蒙混过关。'
  };

  const PRINCIPLE_ORDER = ['independence', 'calibration', 'first_principle'];

  const MODE_HINTS = {
    inquiry: '探询模式:你还没想清楚,需要被追问和挑战。让 AI 提问、列盲点、给反例——衡量标准是「我的思考有没有被激发」。把这类问题当委派一键交出去,正是「思考变少」的开始。',
    delegate: '委派模式:你已经想清楚了,只是把执行外包。任务要明确、可验收。衡量标准是「产出是否准确、最终评价是否仍由我来做」。'
  };

  /* ---------- localStorage keys ---------- */
  const K_PROMPTS = 'ppf:prompts';
  const K_CHECKS = 'ppf:selfchecks';

  /* ---------- 状态 ---------- */
  const state = {
    domain: 'writing',
    domainText: '',
    principles: { independence: true, calibration: true, first_principle: true },
    weakness: '',
    intensity: 'rival',
    mode: 'inquiry'
  };
  const check = { think: 0, challenge: 0, eval: 0 };
  const hasRecovery = typeof ArchiveRecovery !== 'undefined';
  const recovery = hasRecovery ? {
    [K_PROMPTS]: ArchiveRecovery.create({ key: K_PROMPTS, label: '提示词库', refresh: renderLibrary, notify: toast }),
    [K_CHECKS]: ArchiveRecovery.create({ key: K_CHECKS, label: '自检记录', refresh: renderTrend, notify: toast })
  } : {};

  /* ---------- storage helpers ---------- */
  function load(key) {
    try {
      const raw = hasRecovery ? null : localStorage.getItem(key);
      const v = hasRecovery ? ArchiveRecovery.readList(key) : (raw === null ? [] : JSON.parse(raw));
      if (!Array.isArray(v)) throw new Error('存档不是记录列表');
      if (recovery[key]) recovery[key].hide();
      return v;
    } catch (e) {
      if (recovery[key]) recovery[key].show();
      toast('存档无法读取，未覆盖原数据。请先备份并检查浏览器存储。');
      return null;
    }
  }
  function save(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); return true; }
    catch (e) { console.error('localStorage 写入失败:', e); toast('保存失败:存储空间不足?'); return false; }
  }
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  /* ---------- 本地日期(避免 UTC 时区偏移) ---------- */
  function localDateKey(d = new Date()) {
    return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');
  }

  /* ---------- 脏数据清洗:fork 记录 ---------- */
  function cleanFork(x) {
    if (!x || typeof x !== 'object') return null;
    const domain = Object.prototype.hasOwnProperty.call(TEMPLATES, x.domain) ? x.domain : Object.keys(TEMPLATES)[0];
    const intensity = Object.prototype.hasOwnProperty.call(INTENSITY, x.intensity) ? x.intensity : Object.keys(INTENSITY)[0];
    const principles = Array.isArray(x.principles) ? x.principles.filter(p => PRINCIPLE_ORDER.includes(p)) : [];
    return {
      ...x,
      domain,
      intensity,
      principles,
      name: String(x.name || '未命名'),
      compiled: String(x.compiled || '')
    };
  }

  /* ---------- 脏数据清洗:自检记录(clamp 分数,防 NaN 坐标) ---------- */
  function cleanCheck(x) {
    const s5 = v => Math.max(1, Math.min(5, Number(v) || 1));
    const s100 = v => Math.max(0, Math.min(100, Number(v) || 0));
    return {
      date: /^\d{4}-\d{2}-\d{2}$/.test(x && x.date) ? x.date : localDateKey(),
      thinkMoreScore: s5(x && x.thinkMoreScore),
      prodVsEvalScore: s100(x && x.prodVsEvalScore),
      ts: Number(x && x.ts) || Date.now()
    };
  }

  /* ---------- token 估算(本地近似,无 API) ----------
     中日韩字符≈1 token/字;ASCII 单词≈每 4 字符 1 token;
     数字/标点折中。经验近似,不追求精确,只给量级感。 */
  function estimateTokens(text) {
    if (!text) return 0;
    let tokens = 0;
    const cjk = (text.match(/[㐀-鿿　-〿＀-￯]/g) || []).length;
    tokens += cjk; // CJK 字符与全角标点,每个约 1 token
    const rest = text.replace(/[㐀-鿿　-〿＀-￯]/g, ' ');
    const asciiChars = (rest.match(/[A-Za-z0-9]/g) || []).length;
    tokens += Math.ceil(asciiChars / 4);
    const punct = (rest.match(/[.,;:!?(){}\[\]'"`/\\\-+=<>@#$%^&*~|]/g) || []).length;
    tokens += Math.ceil(punct / 2);
    return tokens;
  }

  /* ---------- 编译提示词 ---------- */
  function compile(s) {
    const tpl = TEMPLATES[s.domain];
    const domainText = (s.domainText || '').trim() || '(未指定具体范围,按该领域通用情境处理)';
    const parts = [];
    parts.push('# 角色设定');
    parts.push(tpl.baseText.replace('{DOMAIN}', () => domainText)); // 用函数替换,避免输入里的 $$ / $& 被当成替换模式
    parts.push('');
    parts.push('# 必须遵守的对抗原则');
    PRINCIPLE_ORDER.forEach((p, i) => {
      if (s.principles[p]) parts.push((i + 1) + '. ' + tpl.principleSnippets[p]);
    });
    if (!PRINCIPLE_ORDER.some(p => s.principles[p])) {
      parts.push('(未勾选任何原则——但若不约束,模型会默认迎合你。建议至少保留一条。)');
    }
    const weak = (s.weakness || '').trim();
    if (weak) {
      parts.push('');
      parts.push('# 我已知的弱点(请专门盯住)');
      parts.push('我最容易被你顺着说的地方是:' + weak);
      parts.push('一旦发现我在这里松懈、被你的措辞带着走,请立刻点破,不要放过。');
    }
    parts.push('');
    parts.push('# 当前协作模式');
    parts.push(s.mode === 'inquiry'
      ? '【探询】我还没想清楚,需要你追问和挑战,而不是直接给答案。'
      : '【委派】我已想清楚,把执行交给你,但最终评价仍由我来做。');
    parts.push('');
    parts.push('# ' + INTENSITY[s.intensity].split(':')[0]);
    parts.push(INTENSITY[s.intensity]);
    parts.push('');
    parts.push('# 底线');
    parts.push('不要因为我看起来满意就停止挑战。如果一路顺着我,你就失败了。');
    parts.push('每轮结束时,如果我的思考没有比开始时更多,请直接告诉我:这次你在迎合我。');
    return parts.join('\n');
  }

  /* ---------- DOM refs ---------- */
  const $ = sel => document.querySelector(sel);
  const $$ = sel => Array.from(document.querySelectorAll(sel));

  /* 切换一组按钮的 active 状态,并同步 aria-pressed(无障碍) */
  function setActive(groupSel, activeBtn) {
    $$(groupSel).forEach(x => {
      const on = x === activeBtn;
      x.classList.toggle('active', on);
      x.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }
  const promptOut = $('#promptOut');
  const tokenNum = $('#tokenNum');
  const charCount = $('#charCount');

  /* ---------- 渲染工厂预览 ---------- */
  function renderForge() {
    const compiled = compile(state);
    promptOut.textContent = compiled;
    const t = estimateTokens(compiled);
    tokenNum.textContent = t;
    charCount.textContent = '· ' + compiled.length + ' 字符';
    $('#consoleName').textContent = TEMPLATES[state.domain].label + '.prompt';
    $('#modeHint').textContent = MODE_HINTS[state.mode];
  }

  /* ---------- 工厂事件绑定 ---------- */
  function bindForge() {
    $('#domainSeg').addEventListener('click', e => {
      const b = e.target.closest('.seg-btn'); if (!b) return;
      setActive('#domainSeg .seg-btn', b);
      state.domain = b.dataset.domain;
      renderForge();
    });
    $('#intensitySeg').addEventListener('click', e => {
      const b = e.target.closest('.seg-btn'); if (!b) return;
      setActive('#intensitySeg .seg-btn', b);
      state.intensity = b.dataset.intensity;
      renderForge();
    });
    $('#domainInput').addEventListener('input', e => { state.domainText = e.target.value; renderForge(); });
    $('#weaknessInput').addEventListener('input', e => { state.weakness = e.target.value; renderForge(); });
    $('#principleList').addEventListener('change', e => {
      const cb = e.target.closest('input[type=checkbox]'); if (!cb) return;
      state.principles[cb.dataset.principle] = cb.checked;
      renderForge();
    });
    $('#modeCard').addEventListener('click', e => {
      const b = e.target.closest('.mode-opt'); if (!b) return;
      setActive('#modeCard .mode-opt', b);
      state.mode = b.dataset.mode;
      renderForge();
    });
    $('#copyBtn').addEventListener('click', () => copyText(compile(state)));
    $('#saveBtn').addEventListener('click', saveFork);
  }

  /* ---------- 复制(clipboard + execCommand 兜底) ---------- */
  function copyText(text) {
    const done = () => { $('#copyHint').textContent = '已复制。粘到你的对话框,让 AI 当对手。'; $('#copyHint').classList.add('ok'); toast('已复制到剪贴板'); };
    const fail = () => { $('#copyHint').textContent = '复制失败,请手动选中预览区文本。'; $('#copyHint').classList.remove('ok'); };
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(done).catch(() => legacyCopy(text) ? done() : fail());
    } else {
      legacyCopy(text) ? done() : fail();
    }
  }
  function legacyCopy(text) {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed'; ta.style.opacity = '0'; ta.style.top = '0';
      document.body.appendChild(ta);
      ta.focus(); ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch (e) { console.error('legacyCopy 失败', e); return false; }
  }

  /* ---------- 保存 fork ---------- */
  function saveFork() {
    const compiled = compile(state);
    const tpl = TEMPLATES[state.domain];
    const name = (state.domainText.trim() || tpl.label + '版') + ' · ' + INTENSITY[state.intensity].match(/【(.+?)】/)[1];
    const item = {
      id: uid(),
      name: name,
      domain: state.domain,
      domainText: state.domainText,
      principles: PRINCIPLE_ORDER.filter(p => state.principles[p]),
      weakness: state.weakness.trim(),
      intensity: state.intensity,
      mode: state.mode,
      compiled: compiled,
      tokenEst: estimateTokens(compiled),
      ts: Date.now()
    };
    const list = load(K_PROMPTS);
    if (!list) return;
    list.unshift(item);
    if (save(K_PROMPTS, list)) { toast('已存为 fork'); renderLibrary(); }
  }

  /* ---------- 提示词库 ---------- */
  function renderLibrary() {
    const loaded = load(K_PROMPTS);
    if (!loaded) {
      $('#forkList').textContent = '提示词库无法读取，请使用上方恢复面板。';
      $('#libCount').textContent = '无法读取';
      $('#libEmpty').classList.remove('show');
      return;
    }
    const list = loaded.map(cleanFork).filter(Boolean);
    const wrap = $('#forkList');
    const empty = $('#libEmpty');
    $('#libCount').textContent = list.length + ' 个 fork';
    wrap.innerHTML = '';
    empty.classList.toggle('show', list.length === 0);
    list.forEach(item => wrap.appendChild(forkEl(item)));
  }

  function forkEl(item) {
    const tpl = TEMPLATES[item.domain];
    const el = document.createElement('div');
    el.className = 'fork';
    const principleTags = item.principles.map(p => {
      const m = { independence: '独立性', calibration: '校准', first_principle: '第一性原理' };
      return '<span class="tag">' + m[p] + '</span>';
    }).join('');
    const intLabel = INTENSITY[item.intensity].match(/【(.+?)】/)[1];
    el.innerHTML =
      '<div class="fork-top">' +
        '<input class="fork-name" value="' + escapeAttr(item.name) + '" maxlength="60" />' +
        '<span class="counter">' + escapeHtml(item.tokenEst) + ' tok · ' + new Date(item.ts).toLocaleDateString('zh-CN') + '</span>' +
      '</div>' +
      '<div class="fork-tags">' +
        '<span class="tag">' + tpl.label + '</span>' +
        '<span class="tag">' + intLabel + '</span>' +
        principleTags +
      '</div>' +
      '<div class="fork-prompt">' + escapeHtml(item.compiled) + '</div>' +
      '<div class="fork-actions">' +
        '<button class="btn mini primary" type="button" data-act="load">载入到工厂</button>' +
        '<button class="btn mini ghost" type="button" data-act="copy">复制</button>' +
        '<button class="btn mini danger" type="button" data-act="del">删除</button>' +
      '</div>';

    // 重命名
    const nameInput = el.querySelector('.fork-name');
    nameInput.addEventListener('change', () => {
      const list = load(K_PROMPTS);
      if (!list) { nameInput.value = item.name; return; }
      const t = list.find(x => x && x.id === item.id);
      if (t) {
        const name = nameInput.value.trim() || t.name;
        t.name = name;
        if (save(K_PROMPTS, list)) {
          item.name = name;
          nameInput.value = name;
          toast('已重命名');
        } else nameInput.value = item.name;
      }
    });

    el.querySelector('.fork-actions').addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      const act = b.dataset.act;
      if (act === 'copy') copyText(item.compiled);
      else if (act === 'del') deleteFork(item.id);
      else if (act === 'load') loadFork(item);
    });
    return el;
  }

  function deleteFork(id) {
    let list = load(K_PROMPTS);
    if (!list) return;
    list = list.filter(x => !x || x.id !== id);
    if (!save(K_PROMPTS, list)) return;
    renderLibrary();
    toast('已删除');
  }

  function loadFork(item) {
    state.domain = item.domain;
    state.domainText = typeof item.domainText === 'string' ? item.domainText : '';
    if (typeof item.domainText !== 'string') {
      const suffix = ' · ' + INTENSITY[item.intensity].match(/【(.+?)】/)[1];
      if (item.name.endsWith(suffix)) {
        const guess = item.name.slice(0, -suffix.length);
        if (guess !== TEMPLATES[item.domain].label + '版') state.domainText = guess;
      } else {
        toast('旧 fork 未保存原始范围，请重新填写；已保存的提示词仍可复制。');
      }
    }
    state.principles = { independence: false, calibration: false, first_principle: false };
    item.principles.forEach(p => state.principles[p] = true);
    state.weakness = item.weakness || '';
    state.intensity = item.intensity;
    state.mode = item.mode || 'inquiry';
    syncFormFromState();
    switchView('forge');
    renderForge();
    toast('已载入到工厂');
  }

  function syncFormFromState() {
    const sync = (b, on) => { b.classList.toggle('active', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); };
    $$('#domainSeg .seg-btn').forEach(b => sync(b, b.dataset.domain === state.domain));
    $$('#intensitySeg .seg-btn').forEach(b => sync(b, b.dataset.intensity === state.intensity));
    $$('#modeCard .mode-opt').forEach(b => sync(b, b.dataset.mode === state.mode));
    $('#domainInput').value = state.domainText;
    $('#weaknessInput').value = state.weakness;
    $$('#principleList input[type=checkbox]').forEach(cb => cb.checked = !!state.principles[cb.dataset.principle]);
  }

  /* ---------- 自检打卡 ---------- */
  function buildScales() {
    $$('.scale').forEach(scale => {
      const key = scale.dataset.scale;
      scale.innerHTML = '';
      for (let i = 1; i <= 5; i++) {
        const pip = document.createElement('button');
        pip.className = 'pip';
        pip.type = 'button';
        pip.textContent = i;
        pip.dataset.val = i;
        pip.setAttribute('aria-label', '评分 ' + i + ' 分（满分 5）');
        pip.setAttribute('aria-pressed', 'false');
        pip.addEventListener('click', () => {
          check[key] = i;
          Array.from(scale.children).forEach(c => {
            const on = +c.dataset.val <= i;
            c.classList.toggle('on', on);
            c.setAttribute('aria-pressed', on ? 'true' : 'false');
          });
          renderScore();
        });
        scale.appendChild(pip);
      }
    });
  }

  function renderScore() {
    const out = $('#scoreReadout');
    if (!check.think || !check.challenge || !check.eval || !$('#scClaim').value.trim()) {
      out.innerHTML = '写出亲自核查的具体主张并完成三个评分后，才会计算本次自评倾向。';
      return;
    }
    // 生产vs评价综合分:思考变多、被挑战、偏评价 三者均值
    const vals = [check.think, check.challenge, check.eval].filter(v => v > 0);
    const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
    const prodVsEval = Math.round(avg * 20); // 0-100
    let verdict;
    if (prodVsEval >= 75) verdict = '你在主导评价,模型在当对手——这是健康的用法。';
    else if (prodVsEval >= 50) verdict = '尚可,但仍有被牵着走的成分,下次多逼它反驳你。';
    else verdict = '警惕:这次更像照单全收的「生产」。思考可能在变少。';
    out.innerHTML =
      '思考变多 <b>' + (check.think || '—') + '/5</b> · ' +
      '被挑战 <b>' + (check.challenge || '—') + '/5</b> · ' +
      '偏评价 <b>' + (check.eval || '—') + '/5</b><br/>' +
      '生产 vs 评价倾向:<b>' + prodVsEval + ' / 100</b><br/>' +
      '<span class="verdict">' + verdict + '</span>';
  }

  function submitCheck() {
    if (!check.think || !check.challenge || !check.eval) {
      $('#checkHint').textContent = '请把三个评分都点一下再记录。';
      return;
    }
    const claim = $('#scClaim').value.trim();
    if (!claim) { $('#checkHint').textContent = '请先写出亲自核查过的具体主张。'; $('#scClaim').focus(); return; }
    const avg = (check.think + check.challenge + check.eval) / 3;
    const item = {
      id: uid(),
      date: localDateKey(),
      lastVerifiedClaim: claim,
      thinkMoreScore: check.think,
      challengedScore: check.challenge,
      prodVsEvalScore: Math.round(avg * 20),
      ts: Date.now()
    };
    const list = load(K_CHECKS);
    if (!list) return;
    list.push(item);
    if (save(K_CHECKS, list)) {
      toast('已记录这次自检');
      $('#checkHint').textContent = '已记录。去「趋势」看你的判断力曲线。';
      // reset
      check.think = check.challenge = check.eval = 0;
      $('#scClaim').value = '';
      $$('.scale .pip').forEach(p => { p.classList.remove('on'); p.setAttribute('aria-pressed', 'false'); });
      renderScore();
      renderTrend();
    }
  }

  /* ---------- 趋势曲线(原生 SVG) ---------- */
  function renderTrend() {
    const loaded = load(K_CHECKS);
    if (!loaded) {
      $('#chartWrap').textContent = '自检记录无法读取，请使用上方恢复面板。';
      $('#trendStats').textContent = '';
      $('#trendEmpty').classList.remove('show');
      return;
    }
    const list = loaded.map(cleanCheck).sort((a, b) => a.ts - b.ts);
    const empty = $('#trendEmpty');
    const wrap = $('#chartWrap');
    const stats = $('#trendStats');
    if (list.length === 0) {
      empty.classList.add('show'); wrap.innerHTML = ''; stats.innerHTML = '';
      return;
    }
    empty.classList.remove('show');
    wrap.innerHTML = buildChart(list);
    stats.innerHTML = buildStats(list);
  }

  function buildChart(list) {
    const W = 720, H = 280, padL = 38, padR = 18, padT = 22, padB = 34;
    const innerW = W - padL - padR, innerH = H - padT - padB;
    const n = list.length;
    const xFor = i => padL + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW);
    const yFor = v => padT + innerH - ((v - 1) / 4) * innerH; // 1..5 -> bottom..top (think 用 1-5)
    const yForPct = v => padT + innerH - (v / 100) * innerH;   // 0..100

    // 网格 + y 轴标签(1..5)
    let grid = '';
    for (let g = 1; g <= 5; g++) {
      const y = yFor(g);
      grid += '<line x1="' + padL + '" y1="' + y + '" x2="' + (W - padR) + '" y2="' + y + '" stroke="#1e2a47" stroke-width="1"/>';
      grid += '<text x="' + (padL - 8) + '" y="' + (y + 4) + '" fill="#7085a9" font-size="10" text-anchor="end" font-family="monospace">' + g + '</text>';
    }

    const thinkPts = list.map((d, i) => [xFor(i), yFor(d.thinkMoreScore)]);
    // eval 曲线用 prodVsEval(0-100)映射到同一画布
    const evalPts = list.map((d, i) => [xFor(i), yForPct(d.prodVsEvalScore)]);

    const pathOf = pts => pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');

    const dotsOf = (pts, color) => pts.map(p =>
      '<circle cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="3.2" fill="' + color + '"/>').join('');

    // x 轴日期(最多 6 个)
    let xlabels = '';
    const step = Math.max(1, Math.ceil(n / 6));
    list.forEach((d, i) => {
      if (i % step === 0 || i === n - 1) {
        xlabels += '<text x="' + xFor(i).toFixed(1) + '" y="' + (H - 10) + '" fill="#7085a9" font-size="9.5" text-anchor="middle" font-family="monospace">' + d.date.slice(5) + '</text>';
      }
    });

    return '' +
      '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="xMidYMid meet" role="img" aria-label="自检趋势曲线">' +
        '<defs>' +
          '<filter id="glow" x="-30%" y="-30%" width="160%" height="160%">' +
            '<feGaussianBlur stdDeviation="2.4" result="b"/>' +
            '<feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>' +
          '</filter>' +
        '</defs>' +
        grid +
        // eval line (amber)
        '<path d="' + pathOf(evalPts) + '" fill="none" stroke="#e8c98a" stroke-width="2" stroke-opacity=".9" filter="url(#glow)"/>' +
        dotsOf(evalPts, '#e8c98a') +
        // think line (star) on top
        '<path d="' + pathOf(thinkPts) + '" fill="none" stroke="#7fd6e8" stroke-width="2.4" filter="url(#glow)"/>' +
        dotsOf(thinkPts, '#7fd6e8') +
        xlabels +
      '</svg>';
  }

  function buildStats(list) {
    const last = list[list.length - 1];
    const first = list[0];
    const n = list.length;
    const avgEval = Math.round(list.reduce((a, d) => a + d.prodVsEvalScore, 0) / n);
    const deltaThink = last.thinkMoreScore - first.thinkMoreScore;
    const deltaEval = last.prodVsEvalScore - first.prodVsEvalScore;
    const arrow = d => d > 0 ? '▲ +' + d : d < 0 ? '▼ ' + d : '— 0';
    const cls = d => d > 0 ? 'up' : d < 0 ? 'down' : '';
    return '' +
      stat(n, '累计自检次数') +
      stat(last.thinkMoreScore + '/5', '最近一次「思考变多」', '<span class="delta ' + cls(deltaThink) + '">' + arrow(deltaThink) + ' 自首次</span>') +
      stat(avgEval + '/100', '平均「评价倾向」') +
      stat(last.prodVsEvalScore + '/100', '最近一次「评价倾向」', '<span class="delta ' + cls(deltaEval) + '">' + arrow(deltaEval) + ' 自首次</span>');
  }
  function stat(v, l, extra) {
    return '<div class="stat"><div class="v">' + v + '</div><div class="l">' + l + (extra ? '<br/>' + extra : '') + '</div></div>';
  }

  /* ---------- 视图切换 ---------- */
  function switchView(name) {
    $$('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + name));
    $$('.nav-btn').forEach(b => {
      const on = b.dataset.view === name;
      b.classList.toggle('active', on);
      if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    if (name === 'library') renderLibrary();
    if (name === 'trend') renderTrend();
    if (name === 'selfcheck') renderScore();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /* ---------- utils ---------- */
  function escapeHtml(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function escapeAttr(s) { return escapeHtml(s).replace(/"/g, '&quot;'); }

  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 1900);
  }

  /* ---------- starfield ---------- */
  function makeStars() {
    const sf = $('#starfield');
    const frag = document.createDocumentFragment();
    for (let i = 0; i < 70; i++) {
      const s = document.createElement('div');
      s.className = 'star';
      s.style.left = Math.random() * 100 + '%';
      s.style.top = Math.random() * 100 + '%';
      const sz = Math.random() * 1.6 + 0.6;
      s.style.width = sz + 'px'; s.style.height = sz + 'px';
      s.style.animationDelay = (Math.random() * 4) + 's';
      s.style.animationDuration = (3 + Math.random() * 3) + 's';
      frag.appendChild(s);
    }
    sf.appendChild(frag);
  }

  /* ---------- init ---------- */
  function init() {
    makeStars();
    bindForge();
    buildScales();
    $('#nav').addEventListener('click', e => {
      const b = e.target.closest('.nav-btn'); if (!b) return;
      switchView(b.dataset.view);
    });
    $('#submitCheck').addEventListener('click', submitCheck);
    $('#scClaim').addEventListener('input', renderScore);
    renderForge();
    renderScore();
    load(K_PROMPTS);
    load(K_CHECKS);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();

/* ============================================================
 * rules-engine.js — 伪概念照妖镜·纯函数规则引擎
 *
 * 设计原则:零持久状态、零网络、零 AI。
 * 所有判定都是 (输入) -> (输出) 的确定性纯函数。
 * 灵感来自李笑来「专业 > 工具 > 技巧」的权重排序,
 * 以及「快捷键工程师」类比方法论。
 * ============================================================ */

(function (global) {
  'use strict';

  /* ----------------------------------------------------------
   * 1. 依附性追问题库(决策树)
   *    每个问题探测一个维度的"独立成立性"。
   *    answer === 'no' 表示该概念在这一维度上"站不住"。
   * ---------------------------------------------------------- */
  const DEPENDENCY_QUESTIONS = [
    {
      id: 'q_strip_expertise',
      text: '去掉它背后那门真正的底层专业(医学/法律/编程/写作判断力……),这个概念还独立成立吗?',
      hint: '如果离开真专业就什么都不剩,它只是放大器,不是职业本身。',
      // 答 no(不成立)是危险信号
      penaltyOnNo: 28,
      dangerAnswer: 'no'
    },
    {
      id: 'q_one_sentence',
      text: '去掉所有营销话术和大词,你能用一句人话说清它到底是什么吗?',
      hint: '说不清 = 空概念。真专业从不怕被一句话定义。',
      penaltyOnNo: 22,
      dangerAnswer: 'no'
    },
    {
      id: 'q_replaceable_tool',
      text: '它依赖的工具/平台,如果明年换代或消失,这个"技能"是不是大半作废?',
      hint: '绑死在某个工具上的熟练度,是会过期的技巧,不是护城河。',
      // 这里答 yes(会作废)才是危险信号
      penaltyOnYes: 18,
      dangerAnswer: 'yes'
    },
    {
      id: 'q_fear_marketing',
      text: '它的宣传是不是大量靠"必学/淘汰/红利/再不学就晚了"这类制造焦虑的话术?',
      hint: '越用未来恐吓你现在掏钱的,越要按住钱包。',
      penaltyOnYes: 14,
      dangerAnswer: 'yes'
    },
    {
      id: 'q_survivor_proof',
      text: '它的"有效证明"是不是只展示成功案例,从不给你看失败的分母?',
      hint: '只给赢家、不给分母 = 幸存者偏差包装的智商税。',
      penaltyOnYes: 14,
      dangerAnswer: 'yes'
    }
  ];

  /* ----------------------------------------------------------
   * 2. 三维权重归一化
   *    expertise(专业) / tool(工具) / trick(技巧) 三者归一到 100。
   * ---------------------------------------------------------- */
  function normalizeWeights(raw) {
    const e = Math.max(0, Number(raw.expertise) || 0);
    const t = Math.max(0, Number(raw.tool) || 0);
    const k = Math.max(0, Number(raw.trick) || 0);
    const sum = e + t + k;
    if (sum === 0) {
      // 全 0 时给一个中性默认值,避免除零
      return { expertise: 34, tool: 33, trick: 33 };
    }
    const expertise = Math.round((e / sum) * 100);
    let tool = Math.round((t / sum) * 100);
    // 技巧为 0、另两项又都恰好是 .5 时,两次四舍五入会让和变成 101、技巧变成 -1;
    // 这时工具项改为向下取整,其余组合的结果不变
    if (expertise + tool > 100) tool = 100 - expertise;
    // 让三者严格相加为 100,余数归到 trick
    const trick = 100 - expertise - tool;
    return { expertise, tool, trick };
  }

  /* ----------------------------------------------------------
   * 3. 核心评分
   *    基线:专业占比越高越健康;技巧占比越高越像智商税。
   *    再叠加依附性追问的惩罚分。
   *    输出 healthScore ∈ [0,100],越高越"值得花钱学真东西"。
   * ---------------------------------------------------------- */
  function computeHealthScore(weights, dependencyAnswers) {
    const missing = DEPENDENCY_QUESTIONS.filter(q => !dependencyAnswers || !['yes', 'no'].includes(dependencyAnswers[q.id]));
    if (missing.length) throw new Error('请回答全部依附性追问后再生成结论。');
    const w = normalizeWeights(weights);

    // 基线:专业贡献正分,技巧贡献负分,工具中性偏轻负
    // expertise 满分贡献 ~70,trick 满分扣 ~55,tool 满分扣 ~15
    let score = 50
      + (w.expertise - 34) * 0.85   // 专业高于中位 -> 加分
      - (w.trick - 33) * 0.75       // 技巧高于中位 -> 扣分
      - (w.tool - 33) * 0.18;       // 工具略微中性

    // 叠加依附性追问惩罚
    const ans = dependencyAnswers || {};
    DEPENDENCY_QUESTIONS.forEach(function (q) {
      const a = ans[q.id];
      if (a === 'no' && q.penaltyOnNo) score -= q.penaltyOnNo;
      if (a === 'yes' && q.penaltyOnYes) score -= q.penaltyOnYes;
    });

    // 收口到 [0,100]
    score = Math.max(0, Math.min(100, Math.round(score)));
    return score;
  }

  /* ----------------------------------------------------------
   * 4. 红黄绿判定
   * ---------------------------------------------------------- */
  function verdictFromScore(score) {
    if (score >= 66) return 'buy';      // 绿:底层专业扎实,值得花钱学真东西
    if (score >= 38) return 'caution';  // 黄:有真料但被包装抬价,谨慎甄别
    return 'skip';                       // 红:基本是智商税,别交学费
  }

  /* ----------------------------------------------------------
   * 5. 生成一句话理由(确定性模板)
   * ---------------------------------------------------------- */
  function buildReason(weights, dependencyAnswers, verdict) {
    const w = normalizeWeights(weights);
    const dominant = pickDominant(w);
    const ans = dependencyAnswers || {};
    const stripFails = ans.q_strip_expertise === 'no';
    const cantExplain = ans.q_one_sentence === 'no';

    if (verdict === 'buy') {
      return '底层专业占比 ' + w.expertise + '%,占主导。这是真功夫的放大,工具和技巧只是辅助——值得投入,但要确认你学的是那 ' + w.expertise + '% 的硬核,而非包装。';
    }
    if (verdict === 'skip') {
      const why = stripFails
        ? '抽掉真专业后它就立不住,'
        : (cantExplain ? '它连一句人话都说不清,' : '技巧/话术占了 ' + w.trick + '%,');
      return why + '本质是把"' + dominant + '"当成了职业本身。这是用焦虑和包装抬价的智商税,别交这笔学费。';
    }
    // caution
    return '里面确实有真料(专业 ' + w.expertise + '%),但技巧与工具合计 ' + (w.tool + w.trick) + '%,价值被营销放大了。可以学,但只为那块硬核付费,警惕为话术买单。';
  }

  function pickDominant(w) {
    if (w.expertise >= w.tool && w.expertise >= w.trick) return '底层专业';
    if (w.trick >= w.tool && w.trick >= w.expertise) return '技巧话术';
    return '工具熟练度';
  }

  /* ----------------------------------------------------------
   * 6. 快捷键工程师类比器
   *    把输入概念套进"X = 快捷键工程师?"的反讽结构。
   * ---------------------------------------------------------- */
  const ANALOGY_TEMPLATES = [
    function (c, w) {
      return '把「' + c + '」当成一个独立职业,就像招聘「Ctrl+C 专家」——快捷键当然有用,可没人会为"会按快捷键"本身付高薪。值钱的永远是那只手在敲什么内容。';
    },
    function (c, w) {
      return '「' + c + '」之于真专业,约等于"快捷键熟练"之于"真正懂业务":前者是放大器,后者才是被放大的东西。放大器再亮,乘以零还是零。';
    },
    function (c, w) {
      return '如果「' + c + '」成立,那「双击工程师」「滚轮调参师」「Tab 补全专家」也都该是热门职业了。技巧值得练,但别把练技巧误当成攒专业。';
    }
  ];

  function buildAnalogy(concept, weights) {
    const c = (concept || '这个概念').trim() || '这个概念';
    const w = normalizeWeights(weights);
    // 用技巧占比挑选语气更重的模板,确定性而非随机
    let idx = 0;
    if (w.trick >= 55) idx = 0;
    else if (w.trick >= 30) idx = 1;
    else idx = 2;
    return ANALOGY_TEMPLATES[idx](c, w);
  }

  /* ----------------------------------------------------------
   * 7. 主入口:一次完成全部评估
   * ---------------------------------------------------------- */
  function evaluate(input) {
    const concept = (input && input.concept ? String(input.concept) : '').trim();
    const weights = normalizeWeights((input && input.weights) || {});
    const dependencyAnswers = (input && input.dependencyAnswers) || {};
    const score = computeHealthScore(weights, dependencyAnswers);
    const verdict = verdictFromScore(score);
    const reason = buildReason(weights, dependencyAnswers, verdict);
    const analogy = buildAnalogy(concept, weights);
    return {
      concept: concept,
      weights: weights,
      dependencyAnswers: dependencyAnswers,
      score: score,
      verdict: verdict,
      reason: reason,
      analogy: analogy
    };
  }

  const VERDICT_META = {
    buy:     { label: '值得学', color: '#3a7d44', stamp: '可投入', desc: '底层专业扎实' },
    caution: { label: '谨慎甄别', color: '#c89b3c', stamp: '存疑', desc: '有真料但被抬价' },
    skip:    { label: '别交学费', color: '#8c2b2b', stamp: '智商税', desc: '基本是包装' }
  };

  /* ----------------------------------------------------------
   * 导出
   * ---------------------------------------------------------- */
  global.HBRules = {
    DEPENDENCY_QUESTIONS: DEPENDENCY_QUESTIONS,
    VERDICT_META: VERDICT_META,
    normalizeWeights: normalizeWeights,
    computeHealthScore: computeHealthScore,
    verdictFromScore: verdictFromScore,
    buildReason: buildReason,
    buildAnalogy: buildAnalogy,
    evaluate: evaluate
  };
})(typeof window !== 'undefined' ? window : this);

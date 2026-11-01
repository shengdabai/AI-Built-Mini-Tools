'use strict';
/* 合成示例:文本、阅读记录、生词都是为演示而写的示意内容,不引用任何真实文章或真实使用数据。 */
(function () {
  const ZH_TITLE = '合成示例 · 关于阅读耐力的示意文';
  const ZH = [
    '很多人以为阅读是一件天生的事:会认字,就等于会读书。可是真正坐下来读一篇两万字的长文,大多数人在第三页就开始走神,手指不自觉地去摸手机,眼睛停在同一行上,脑子里却在想晚饭吃什么。这并不说明意志薄弱,只说明阅读和跑步一样,是一种需要练出来的耐力,而耐力不会因为知道它重要就自动出现。',
    '把阅读看成耐力,第一个好处是可以量化。跑步的人会记录每次跑了多少公里、用了多少分钟、心率多少;读书的人同样可以记录今天读了多少字、专注了多少分钟、中间停下来几次。这些数字本身并不神圣,它们的作用是让进步变得看得见。一个人如果连续十天每天读够半小时,哪怕每天只读几页,他也已经和第一天坐在书桌前的自己不一样了。',
    '耐力至少有两个维度。第一个维度是长度:能不能在一整个下午,连续几个小时,把注意力放在同一份材料上。这需要身体和环境的配合,比如坐得住、光线够、手边没有会响的东西。第二个维度更隐蔽:当你遇到看不懂的地方,能不能不立刻放弃,而是带着疑问继续往下读。很多难懂的段落,在读完后面三页之后会自己变得清楚,但前提是你没有在这里合上书。',
    '“字不差地读”是一种近乎过时的说法,却在今天重新变得重要。现在任何人都可以让机器把一篇文章压缩成五句话,于是读摘要成了默认的选择。摘要当然有用,可是它替你做了一件最费力的事:决定什么重要。当所有人都读同样的摘要,所有人得到的就是同样的结论,而真正的差别,往往藏在被摘要丢掉的那些细节、限定词和例外里。',
    '所以精读并不是为了显得勤奋,而是为了保留判断的权利。一段话里的“可能”和“一定”,一个数字后面是否跟着“约”字,一个结论前面是否有“在这个样本里”的限定,这些东西只有逐句读过才会注意到。读得慢一点,不是效率低,而是在买一种保险:避免把别人的粗略印象,当成自己的确定知识。',
    '那么怎样练?最朴素的办法是一次只面对一小段。不要看整篇文章有多长,只看眼前这一段;读完,再翻到下一段。每一段读完,问自己一个小问题:这一段在说什么?我同意吗?有没有哪个词我其实不懂?不懂的词不必当场查,先记下来,连同它所在的那句话一起记下来。词离开了语境,很快就会忘;带着语境记下的词,过几天再看到,往往一眼就想起来了。',
    '同样重要的是允许自己“先读过去”。初学者常犯的错误,是把每一个看不懂的地方都当成必须攻克的堡垒,结果读得又慢又累,很快就放弃整本书。更好的做法是做个记号,继续往前走。很多时候,答案就在后面;即使不在,你也已经知道自己卡在了哪里,这本身就是有价值的信息。回头再来的时候,问题往往比第一次小得多。',
    '休息同样是训练的一部分。没有人能不间断地高强度专注好几个小时,职业运动员也不能。常见的节奏是读二十五分钟,休息五分钟,站起来走一走,喝点水,让眼睛离开纸面或屏幕。休息不是奖励,而是让下一轮专注得以发生的条件。如果你发现自己每次休息之后都能顺利回到状态,说明节奏是合适的;如果休息完更难进入,就说明读得太久了,下次提前一点停。',
    '对孩子来说,耐力的养成更需要陪伴。每天固定一个小时,大人和孩子各拿一本书坐在同一张桌子旁,不说话,只是各自读。孩子遇到不认识的字,可以做个记号,等这一页读完再问。大人要做的并不是讲解,而是示范:示范一个人如何安静地、持续地和文字待在一起。孩子学到的,首先是这种待着的姿态,然后才是具体的知识。',
    '长期坚持的关键,是把门槛放低,把记录做实。目标不要定成“每天读三小时”,而是“每天至少三十分钟”;状态好的日子可以多读,状态差的日子读够底线也算数。连续的天数会成为一种安静的约束:你不想让这条线断掉。到了月底回头看,你会发现自己读过的字数远远超过想象,而更重要的是,你已经能坐得住了。',
    '最后要提醒的是,工具只是辅助。无论是计时器、生词表还是批注清单,它们都不能替你理解一段话。它们能做的,是让你的阅读留下痕迹:今天读了多久,卡在哪里,不同意什么,准备明天再问谁。痕迹积累起来,就是一个人认真对待文字的证据。读书的价值最终发生在你的头脑里,而这些痕迹,只是帮你记住自己是怎样一步一步走过来的。',
    '如果把一年的阅读摊开来看,真正拉开差距的从来不是某一次读得特别多,而是日复一日没有中断。一个人每天读半小时,一年下来就是一百八十多个小时,相当于连续读了整整一周多的时间,而且这些时间是分散在不同的清晨和夜晚里的,每一次都留下了一点点理解。这样积累起来的东西,比一次突击读完十本书要牢固得多。耐力的本质,就是让平凡的重复发挥作用。',
    '也许你会问,既然机器可以代读,为什么还要花这么多力气自己读?答案是,读的过程本身就是思考的过程。当你停在一个句子上,疑惑它为什么这样说,你的头脑在做的事情,是任何摘要都无法代劳的。你在把别人的话放进自己的经验里检验:这符合我见过的事情吗?它的前提成立吗?换一个情境还说得通吗?这种检验的习惯,才是阅读真正留给人的东西。',
    '选材也有讲究。给自己挑的文章,最好比平时随手读的略难一点,但不要难到每一行都在挣扎。一个粗略的检验是:第一遍读下来,大约七成的句子你能明白它在说什么。剩下的三成是需要带着走的疑问,而前面的七成则给你向前的惯性。随着耐力一点点增长,再慢慢把难度往上调,就像运动员一点一点增加距离,而不是一下子冲到极限。',
    '环境对耐力的影响常常被低估。同样的一篇文章,在安静的房间里读二十分钟,和在嘈杂的地铁上读二十分钟,效果完全不同。与其责怪自己不够专注,不如先把可以控制的条件整理好:把手机放到另一个房间,关掉不需要的通知,桌面上只留一本书和一支笔。让环境替你拒绝打扰,比靠意志力一次次拒绝打扰要省力得多,也持久得多。',
    '关于笔记,有一个常见的误区:以为记得越多越好。实际上,过多的标记会把重点淹没,最后回头看,满页都是颜色,反而不知道该看哪里。更好的做法是只记两种东西:一种是真正不懂的词,另一种是你不同意或者存疑的判断。前者帮你扩大词汇,后者帮你保持头脑清醒。其余的内容,只要读过、想过,就已经完成了它的使命。',
    '复习的节奏也值得设计。生词表不是用来收藏的,而是用来回看的。每隔几天,打开清单,先遮住解释,只看词和它的上下文,试着回忆它的意思。那些反复出现的词,说明它们在你的阅读范围里很常见,应该优先掌握;那些只出现一次的词,可以暂时放一放。让出现的次数告诉你先学什么,比凭感觉挑选要可靠。',
    '还有一种容易被忽略的收获,来自于读完之后的停顿。读完一段,不要急着翻页,先在心里用自己的话复述一遍:作者主要想说什么?如果复述不出来,说明这一段需要重读;如果复述得很顺,说明你真正读进去了。这几秒钟的停顿看起来浪费时间,其实是把阅读从输入变成理解的关键一步,也是检验自己有没有走神的最诚实的办法。',
    '读不同的材料,需要不同的速度。小说可以读得流畅一些,让情节带着你走;论文和说明书则要慢下来,一句一句确认自己真的明白了前提。精读器的意义,就是让你在需要慢的时候有办法慢下来:一次只看一段,看完才允许自己前进。这种被刻意放慢的体验,对习惯了快速滑动屏幕的人来说,起初会有些不耐烦,过一阵就会变成一种难得的踏实。',
    '如果你是老师或者家长,也可以用同样的方法观察学生。不要只问读完了没有,而要看他们在哪一段停得最久,在哪一段最先走神。停留时间长的地方,往往是真正有难度的地方,也是最值得一起讨论的地方。比起笼统地说读得不够认真,指着某一段说这里你花了很长时间,能不能说说你卡在了哪里,是一个更友善也更有效的开场。',
    '还要说一句关于耐心的话。耐力的增长是缓慢的,而且并不总是向上。有些周你会读得很多,有些周你会因为各种原因几乎没有翻开书。这都是正常的。真正重要的是下一次坐下来的时候,不要因为上一次的中断而责备自己,更不要想着一口气补回来。回到那个最小的单位,读一段,然后再读一段,线就接上了。长期来看,愿意一次次重新开始的人,走得比从不中断的人更远。',
    '所以,如果你今天只能做一件事,那就找一篇值得读的文章,打开计时,读完第一段,然后再读第二段。不要想着读完,不要想着读懂,只要想着再读一段。当你发现自己已经读了二十分钟而没有拿起手机的时候,你就已经完成了今天最重要的训练。如果明天你还愿意再来一次,那么耐力就已经在悄悄生长了。你需要做的,只是不要让这条线断掉,剩下的交给时间,它会替你把每一个平凡的二十分钟,一点一点叠成真正的本领。',
  ];

  const EN_TITLE = '合成示例 · A short essay on slow reading';
  const EN = [
    'Most of us learned to read as children and then stopped learning. We can decode words, so we assume we can read. But reading a long, difficult text with full attention is a different skill, closer to endurance running than to recognising letters. Nobody expects to run a marathon after one afternoon of practice, yet many people expect to finish a dense book in one sitting and feel guilty when their mind wanders after ten minutes.',
    'The first step is to make the effort visible. Keep a simple record: how many minutes you read today, how many words you covered, how many times you stopped. These numbers are not a verdict on your intelligence. They are a mirror. After two weeks, you will see patterns that your memory would never have told you, such as the fact that you read twice as fast in the morning, or that the third day of every week is your weakest.',
    'Next, shrink the unit. A whole chapter is intimidating, but a single paragraph is not. Read one paragraph, then decide whether you understood it, whether you agree with it, and whether any word in it was unfamiliar. Only then move on. This rhythm feels slow at first, because we are used to skimming. However, skimming produces a feeling of progress without much memory, while paragraph-by-paragraph reading produces fewer pages and far more understanding.',
    'When you meet a word you do not know, resist the urge to leave the page at once. Mark the word, copy the sentence around it, and keep going. A word stored together with its sentence is much easier to recall than a word stored alone, because the sentence gives your memory something to hold on to. Later, when you review your list, you will often recognise the word before you even finish reading the context. That small moment of recognition is a real reward.',
    'It is just as important to allow yourself to move past passages that you do not understand. Beginners often treat every difficult sentence as a wall that must be broken down before they may continue. Experienced readers behave differently. They mark the spot, accept the confusion for now, and read on, trusting that the author will probably explain the idea later. If the explanation never comes, at least they know exactly where the gap is, which is useful information in its own right.',
    'Disagreement deserves the same attention as confusion. When a claim makes you hesitate, write the hesitation down in a few words. Do you doubt the evidence, the definition, or the conclusion? Many readers feel a flicker of doubt and then let it disappear, so the text slides into their beliefs unchallenged. A short note, such as "only one study?" or "what counts as success here?", turns a passing feeling into a question you can return to and answer.',
    'Rest is part of the practice. A common rhythm is twenty-five minutes of focused reading followed by a short break away from the page. Stand up, look out of a window, drink some water. The break is not a reward for finishing; it is the condition that makes the next block of attention possible. If you find that you return from every break refreshed, your rhythm is about right. If you return more tired than before, shorten the block next time.',
    'For parents, the most useful habit may be the simplest: read next to your child every day for the same hour. You do not need to explain anything. Let the child mark the words she does not know and ask about them when the page is finished. What the child learns first is not vocabulary but posture, the sight of an adult who stays with a text without hurrying away from it. That posture, repeated for months, becomes a habit that no lesson could install.',
    'Set a small floor rather than a heroic goal. Thirty minutes a day is better than three hours on Sunday, because the floor protects the chain of days. On good days you read more, and on bad days you still count if you reach the minimum. A growing streak creates a gentle pressure that is easy to carry and hard to break. In a month, you will have read more than you thought possible, and you will be able to sit still with a difficult page.',
    'Finally, remember that no tool reads for you. A timer, a vocabulary list and a notebook of objections cannot understand the text. What they can do is leave traces of your attention: what you read, where you stumbled, what you doubted, what you plan to ask tomorrow. Over time those traces become evidence that you take words seriously. The understanding itself still happens in your own head, one careful paragraph at a time, and that is exactly why it is worth the effort.',
    'So if you can do only one thing today, choose a text worth your time, start a timer, and read the first paragraph with your full attention. Then read the second one. Do not aim to finish and do not aim to master it; aim only to read one more paragraph. When you notice that twenty minutes have passed and you have not touched your phone, you have completed the most important exercise of the day.',
  ];

  const VOCAB = [
    ['耐力', 4], ['摘要', 3], ['示范', 1], ['底线', 2], ['痕迹', 1], ['攻克', 1], ['堡垒', 2], ['限定词', 1], ['隐蔽', 1], ['突击', 1],
    ['endurance', 3], ['skimming', 2], ['posture', 1], ['momentum', 1], ['unchallenged', 1], ['tolerance', 1], ['intimidating', 1], ['verdict', 2], ['decode', 1], ['heroic', 1],
  ];

  // 12 天阅读记录:[距今天数, 分钟, 字数]。最近几天完成目标,中间有一天断档
  const DAYS = [[11, 22, 3100], [10, 35, 5200], [9, 41, 6400], [8, 18, 2100], [7, 0, 0], [6, 33, 4900], [5, 45, 7300], [4, 31, 4700], [3, 38, 5900], [2, 52, 8600], [1, 36, 5400], [0, 12, 1700]];

  function build(today, C) {
    const mk = (title, paras, id) => ({ id, title, body: paras.join('\n\n'), addedAt: C.addDays(today, -11), pos: { para: 0, sent: 0 }, times: {}, skips: [], sample: true });
    const zh = mk(ZH_TITLE, ZH, 'tzhsample');
    const en = mk(EN_TITLE, EN, 'tensample');
    const zhIx = C.indexText(zh.body);
    zh.pos = C.posAt(zhIx, 'para', 4);
    zh.times = { p0: 48, p1: 52, p2: 61, p3: 44 };
    zh.skips = ['p2'];
    const sessions = [];
    DAYS.forEach(([ago, min, chars], i) => {
      if (!min) return;
      const date = C.addDays(today, -ago);
      const split = min >= 40 ? 2 : 1; // 长的一天拆成两次会话
      for (let k = 0; k < split; k++) {
        sessions.push({ id: `ssample${i}_${k}`, textId: k === 0 ? zh.id : en.id, title: k === 0 ? ZH_TITLE : EN_TITLE, date, seconds: Math.round((min * 60) / split), chars: Math.round(chars / split), marks: 2 + ((i + k) % 4) });
      }
    });
    let vocab = [];
    const all = zh.body + '\n\n' + en.body;
    VOCAB.forEach(([w, n], i) => {
      const isEn = /^[a-z]/.test(w);
      const src = isEn ? en : zh;
      const day = C.addDays(today, -(i % 10));
      const r = C.addVocab(vocab, w, C.contextOf(src.body, w), src.title, day);
      vocab = r.list;
      for (let k = 1; k < n; k++) vocab = C.addVocab(vocab, w, C.contextOf(src.body, w), src.title, C.addDays(day, Math.min(k, 2))).list;
    });
    void all;
    const notes = [
      { id: 'nsample1', textId: zh.id, source: ZH_TITLE, kind: 'doubt', quote: '一个人如果连续十天每天读够半小时,哪怕每天只读几页,他也已经和第一天坐在书桌前的自己不一样了。', note: '十天就够吗?这个说法缺少依据。', date: C.addDays(today, -4) },
      { id: 'nsample2', textId: zh.id, source: ZH_TITLE, kind: 'skip', quote: '这需要身体和环境的配合,比如坐得住、光线够、手边没有会响的东西。', note: '', date: C.addDays(today, -3) },
      { id: 'nsample3', textId: en.id, source: EN_TITLE, kind: 'doubt', quote: 'A good test is that you understand roughly seven sentences out of ten on a first pass.', note: 'Where does the seven-in-ten figure come from?', date: C.addDays(today, -2) },
    ];
    return { texts: [zh, en], vocab, notes, sessions };
  }

  globalThis.READER_SAMPLE = { build, ZH, EN, ZH_TITLE, EN_TITLE, VOCAB };
  if (typeof module !== 'undefined') module.exports = globalThis.READER_SAMPLE;
})();

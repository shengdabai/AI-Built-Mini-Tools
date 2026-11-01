'use strict';
/* 合成示例:15 篇虚构笔记(中英混合,日记 / 读书 / 项目三个子目录)。内容均为合成,不对应任何真实人物或资料。 */
(function () {
  const d = (m, day, h) => Date.UTC(2026, m - 1, day, h || 9, 0, 0);
  globalThis.NOTESEARCH_SAMPLE = {
    label: '合成示例(15 篇)',
    docs: [
      { path: '日记/2026-10-01.md', mtime: d(10, 1, 22), text: '# 十月一日\n\n今天把间隔重复的卡片整理了一遍,一共 40 张,明天开始复习。\n\n中午在楼下喝了一杯咖啡,顺手翻了几页《记忆的技术》。\n\n晚上写了一点代码,把笔记检索的想法记在项目目录里。' },
      { path: '日记/2026-10-05.md', mtime: d(10, 5, 21), text: '# 十月五日\n\n今天没有复习,因为出门了。反思:复习不能依赖心情,要放进固定时间。\n\n看到一篇讲 spaced repetition 的文章,作者认为间隔拉长比次数更重要。\n\n晚饭后散步,想到可以把读书笔记按主题合并成索引页。' },
      { path: '日记/2026-10-12.md', mtime: d(10, 12, 23), text: '# 十月十二日\n\n咖啡喝多了,睡得晚。以后下午三点之后不喝咖啡。\n\n白天主要在改检索工具的排序:命中密度高的段落排前面,标题命中再加分。\n\n记一下:短语搜索必须回到原文验证,不能只看 bigram 交集。' },
      { path: '日记/2026-10-18.md', mtime: d(10, 18, 20), text: '# 十月十八日\n\nWeekly review:这周完成了索引缓存,下周做共现词。\n\n复习卡片的正确率从 70% 升到 82%,说明间隔重复在起作用。\n\n周末打算把旧的 txt 笔记也导进来试试。' },
      { path: '读书/记忆的技术.md', mtime: d(9, 20, 10), text: '# 记忆的技术\n\n第一章讲遗忘曲线。遗忘在学习后的第一天最快,所以第一次复习要尽早。\n\n第二章讲间隔重复:每次复习之后,把下一次复习的间隔拉长,就能用更少的次数保持记忆。\n\n第三章讲提取练习:主动回忆比反复阅读更有效。\n\n读书笔记:复习的关键是在快要忘记的时候进行,太早没有收益。' },
      { path: '读书/深度工作.md', mtime: d(9, 28, 11), text: '# 深度工作\n\n深度工作指在无干扰状态下进行的专注职业活动。作者建议为深度工作安排固定的时间块。\n\n关于注意力:每一次切换任务都会留下注意力残留,所以要少切换。\n\n我的想法:把检索和复习安排在上午,把会议放在下午。' },
      { path: '读书/How to Take Smart Notes.md', mtime: d(9, 12, 15), text: '# How to Take Smart Notes\n\nThe book describes a slip-box method: write one idea per note and link notes to each other.\n\nPermanent notes should be written in your own words. Reviewing the notes regularly keeps the network alive.\n\n读后:卡片之间的链接比分类目录更重要,检索工具可以补上"找得到"这一环。' },
      { path: '读书/信息检索导论.md', mtime: d(8, 30, 9), text: '# 信息检索导论\n\n倒排索引把每个词映射到出现它的文档列表。查询时对多个词的列表求交集,就得到同时包含这些词的文档。\n\n中文没有空格,常见做法是分词或者字二元组:把相邻两个字当作一个词项,不需要词典。\n\n排序可以用词频与逆文档频率,但个人笔记库很小,命中密度加标题加分已经够用。' },
      { path: '读书/咖啡与睡眠.txt', mtime: d(8, 15, 20), text: '咖啡因的半衰期大约是五到六小时。\n\n下午喝咖啡会推迟入睡时间,这是前面日记里的结论来源。\n\n结论:咖啡适合上午,睡前六小时不要再喝。' },
      { path: '项目/笔记检索/需求.md', mtime: d(10, 8, 14), text: '# 笔记检索工具需求\n\n目标:在本机几千个 md 和 txt 笔记里,几秒内找到某个想法出现的段落。\n\n必须:多关键词 AND、引号短语、-排除、path: 路径前缀。\n\n不做:同步、语义检索、联网。数据只留在本机。' },
      { path: '项目/笔记检索/设计.md', mtime: d(10, 10, 16), text: '# 设计笔记\n\nIndex design: Chinese text uses character bigrams, English uses lower-cased words. Each posting points to a file and a paragraph number.\n\n缓存:索引存进 IndexedDB,下次打开直接搜;文件变化后要重建,界面显示索引日期。\n\n风险:超大库可能慢,IndexedDB 可能被浏览器清理。' },
      { path: '项目/笔记检索/测试清单.md', mtime: d(10, 14, 11), text: '# 测试清单\n\n- 中英混合分词\n- 短语必须连续出现\n- 排除词\n- 路径前缀\n\n边界:空文件、只有标题的文件、一个特别长的段落。\n\n复习这份清单,每次改动检索逻辑之后都要全部再跑一遍。' },
      { path: '项目/学习卡片/规则.md', mtime: d(10, 3, 18), text: '# 学习卡片规则\n\n每张卡片只问一个问题。答案要短,最好能一口气说完。\n\n复习安排:第 1、3、7、15 天各一次,答错的卡片回到第 1 天。\n\n这是间隔重复的简化版本,先用起来,再看数据调整。' },
      { path: '项目/周报/2026-W42.md', mtime: d(10, 16, 17), text: '# 2026 年第 42 周周报\n\n完成:检索工具的索引与搜索;卡片规则初稿。\n\n问题:共现词在中文上噪声较大,需要停用词表,并且停用词要能自己改。\n\nNext week: write the README, add the export of search results as Markdown.' },
      { path: '项目/想法/杂项.txt', mtime: d(10, 19, 8), text: '想法一:把读书笔记和日记按"同一个概念"串起来,点一个词就能看到它在所有笔记里的上下文。\n\n想法二:最近修改的文件列表可以当作"我最近在想什么"的线索。\n\nidea three: a weekly digest generated from the files modified this week.' }
    ]
  };
})();

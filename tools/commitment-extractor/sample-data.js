/* 合成示例：虚构的小家居品牌团队与越南供应商、英国客户对接的群聊 + 电话纪要。
 * 人名、公司、业务均为虚构，不来自任何真实对话。
 * 同时包含：清晰承诺、模糊承诺（回头 / soon / later / 那个 / the revised sample）、无承诺闲聊。
 * baseOffsetDays = -2：载入时把基准日期设为两天前，用来演示「逾期」高亮。
 */
globalThis.CommitSample = {
  label: '合成示例 · 虚构团队的供应商对接群聊',
  baseOffsetDays: -2,
  text: [
    '[09:02] 林晓: 早，今天把越南工厂那边的样品和报价都理一下',
    '[09:05] 周启: 周五前我把新版报价单发你',
    "[09:06] Minh Tran: Morning all. I'll send the packing list by Friday.",
    '[09:08] 苏蔓: 我这边下周二前出包装稿',
    '[09:10] Oliver Grant: We need the revised sample soon.',
    '[09:12] 林晓: @周启 你来对接物流，10月9日前给我运费方案',
    '[09:13] 周启: 收到',
    '[09:15] 苏蔓: 那个色卡回头发你',
    '[09:16] Minh Tran: Let me check with the factory and get back to you later.',
    '[09:18] 林晓: 大家中午吃什么？楼下新开了一家粉店',
    '[09:19] 苏蔓: 我去吃个饭，回来再说',
    '周启 09:25',
    '验厂报告我来跟进',
    '',
    '[09:30] Oliver Grant: I will confirm the order quantity tomorrow.',
    '[09:32] 林晓: 月底前我负责把合同终稿发给Oliver',
    '[09:35] Minh Tran: Thanks! The weather here is great today.',
    '[09:40] 林晓: 请苏蔓明天下班前更新产品图',
    '',
    '会议纪要（09:45 电话）：',
    '- 供应商会在下周一前寄出第二版样品',
    '- 付款条件待定，改天再聊',
    '- Minh to share the QC checklist next Monday',
  ].join('\n'),
};

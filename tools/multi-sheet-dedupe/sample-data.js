'use strict';
/* 合成示例:全部为虚构姓名、example.com 邮箱、138 0000 xxxx 号段。不对应任何真实人员。 */
globalThis.DUP_SAMPLE = {
  note: '合成示例:虚构姓名、example.com 邮箱、138 0000 xxxx 号段',
  tables: [
    {
      name: '报名表',
      text: [
        '姓名,手机号,邮箱,公司,备注',
        '王小明,138 0000 0001,Wang.Xm@Example.com,星河科技,报名双人票',
        '李娜,,lina@example.com,明远教育,',
        '陈思远,,chensy@example.com,青禾社区,志愿者',
        '赵立,138 0000 0004,zhaoli@example.com,云帆教育,素食',
        'John Smith,,,Acme Ltd.,',
        '林悦,,,北辰咨询有限公司,',
        '周青,１３８０００００００６,zhouq@example.com,远山传媒,',
        '吴浩,138 0000 0007,wuhao@example.com,蓝海贸易,',
        '郑佳,138 0000 0008,zhengjia@example.com,,',
        '孙宇,138 0000 0009,sunyu@example.com,恒信律所,',
        '钱多多,138 0000 0010,qdd@example.com,,需要发票',
        '何静,138 0000 0011,hejing@example.com,青禾社区,',
        '高远,138 0000 0012,gaoyuan@example.com,星河科技,',
        '马力,138 0000 0013,mali@example.com,,',
        '徐晨,138 0000 0014,xuchen@example.com,绿洲农业,',
        '朱琳,138 0000 0015,zhulin@example.com,绿洲农业,'
      ].join('\n')
    },
    {
      name: '微信群导出',
      text: [
        '微信号\t姓名\t手机\t公司\t入群时间',
        'wxid_wang01\t王小明\t13800000001\t星河科技有限公司\t2026-09-01',
        'lina_2026\t李　娜\t\t明远教育有限公司\t2026-09-02',
        'zhaoli_cloud\t赵立\t138 0000 0005\t云帆文化\t2026-09-02',
        'john_s\tJOHN  SMITH\t\tACME Inc.\t2026-09-03',
        'beichen_lin\t林 悦\t\t北辰咨询\t2026-09-03',
        'zq_06\t周青\t0086 138 0000 0006\t\t2026-09-04',
        'wuhao_biz\t吴浩\t\t蓝海贸易有限公司\t2026-09-04',
        'sy_law\t孙宇\t\t\t2026-09-05',
        'wx_tom\t汤姆\t\t\t2026-09-05',
        'wx_lily\t莉莉\t\t\t2026-09-06',
        'wx_kai\t凯\t\t\t2026-09-06',
        'wx_fang\t方芳\t13800000020\t\t2026-09-07'
      ].join('\n')
    },
    {
      name: '旧CRM',
      text: [
        'Name,Mobile,Email,Company,WeChat,City',
        '王小明,+86 138-0000-0001,wang.xm@example.com,"星河科技 Co., Ltd.",,上海',
        '陈思源,138 0000 0003,,青禾社区,,杭州',
        '赵立,138 0000 0016,Zhaoli@example.com,云帆教育有限公司,zhaoli_cloud,北京',
        '李娜,,Lina@Example.com,明远教育,,成都',
        '周青,13800000006,ZHOUQ@EXAMPLE.COM,远山传媒股份有限公司,,广州',
        '郑佳,138-0000-0008,zhengjia@example.com,,,深圳',
        '刘洋,138 0000 0030,liuyang@example.com,北海工作室,,',
        '沈梦,138 0000 0031,shenmeng@example.com,,,',
        '韩雪,,hanxue@example.com,,,',
        '唐宁,138 0000 0033,,,,',
        '冯程,138 0000 0034,fengcheng@example.com,,,',
        '曹瑞,138 0000 0035,caorui@example.com,,,'
      ].join('\n')
    }
  ]
};
if (typeof module !== 'undefined') module.exports = globalThis.DUP_SAMPLE;

'use strict';
/* 合成示例:域名为 example.com,所有链接都是虚构的,不指向真实活动。 */
globalThis.UrlCheckSample = {
  label: '合成示例',
  text: [
    'https://shop.example.com/spring?utm_source=newsletter&utm_medium=email&utm_campaign=spring_sale',
    'https://shop.example.com/spring?utm_source=wechat&utm_medium=social&utm_campaign=spring_sale',
    'https://shop.example.com/spring?utm_medium=email&utm_campaign=spring_sale',
    'https://shop.example.com/spring?utm_source=a&utm_source=b&utm_medium=email&utm_campaign=spring_sale',
    'https://shop.example.com/spring?utm_source=微博&utm_medium=social&utm_campaign=spring_sale',
    'https://shop.example.com/spring?utm_Source=weibo&utm_medium=social&utm_campaign=spring_sale',
    'https://shop.example.com/spring#pricing?utm_source=blog&utm_medium=post&utm_campaign=spring_sale',
    'ftp://shop.example.com/files/spring?utm_source=ftp&utm_medium=file&utm_campaign=spring_sale',
    'https://shop.example.com/spring?utm_source=newsletter&utm_medium=email&utm_campaign=spring_sale',
    'https://shop.example.com/spring?utm_source=Newsletter&utm_medium=email&utm_campaign=Spring Sale',
    'https://other-site.net/landing?utm_source=ads&utm_medium=cpc&utm_campaign=spring_sale',
    'shop.example.com/spring?utm_source=sms&utm_medium=sms&utm_campaign=spring_sale',
    'https://exa mple.com/spring?utm_source=x&utm_medium=y&utm_campaign=spring_sale',
    'https://shop.example.com/spring?utm_campaign=spring_sale&utm_medium=email&utm_source=push',
    'https://shop.example.com/pricing?utm_source=blog&utm_medium=post&utm_campaign=spring_sale&ref=home',
    'https://shop.example.com/spring?utm_source=partner&utm_medium=referral&utm_campaign=spring-sale&utm_content=banner_a'
  ].join('\n'),
  settings: {
    required: ['utm_source', 'utm_medium', 'utm_campaign'],
    lowercaseValues: true,
    campaignPattern: '^[a-z0-9_-]+$',
    allowedDomains: ['example.com'],
    checkOrder: true
  },
  buildBase: 'https://shop.example.com/spring?ref=home',
  buildTable: [
    'source,medium,campaign,content,term',
    'newsletter,email|social,spring_sale,,',
    'wechat,email|social,spring_sale,banner_a,',
    'weibo,email|social,spring_sale,,spring'
  ].join('\n')
};

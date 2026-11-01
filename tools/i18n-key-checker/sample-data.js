/* 合成示例:虚构产品「星图笔记」的 zh(源)/en/ja 三份文案。所有问题都是人为埋入的,用于演示核对结果,不是任何真实项目的数据。 */
(function () {
  var zh = {
    app: { name: '星图笔记', tagline: '把想法整理成可搜索的笔记', version: '版本 {version}' },
    brand: { name: 'StarNote', slogan: 'StarNote' },
    nav: { home: '首页', notes: '笔记', search: '搜索', settings: '设置', billing: '账单', help: '帮助', logout: '退出登录' },
    auth: {
      login: { title: '登录', email: '邮箱', password: '密码', submit: '登录', forgot: '忘记密码?', error: '邮箱或密码错误,还可以尝试 {remaining} 次' },
      register: { title: '注册', submit: '创建账号', terms: '我已阅读并同意<a href="/terms">服务条款</a>' }
    },
    notes: {
      title: '我的笔记', empty: '还没有笔记,点击「新建」开始记录', create: '新建笔记', untitled: '无标题',
      count_other: '共 {{count}} 篇笔记',
      delete: { confirm: '确定删除「{title}」吗?此操作不能撤销', done: '已删除 %s' },
      tags: { add: '添加标签', remove: '移除标签', limit: '最多添加 {max} 个标签' },
      share: { title: '分享笔记', copyLink: '复制链接', copied: '链接已复制' }
    },
    inbox: { unread: { other: '你有 {{count}} 条未读消息' } },
    editor: {
      bold: '加粗', italic: '斜体', heading: '标题', saving: '保存中…',
      savedAt: '{{time}} 已保存', saveButton: '保存',
      conflict: '<b>注意:</b>另一台设备修改了这篇笔记'
    },
    settings: {
      title: '设置', language: '界面语言', theme: '主题', themeDark: '深色', themeLight: '浅色',
      notifications: '通知', exportData: '导出我的数据'
    },
    billing: {
      title: '账单', plan: '当前套餐:%1$s,每月 %2$d 元', renew: '将于 {date} 续费',
      invoice: '下载发票', failed: '支付失败,请更新支付方式'
    },
    errors: { network: '网络连接失败,请稍后重试', unknown: '出现未知错误', permission: '你没有权限执行此操作', notFound: '页面不存在' },
    common: {
      ok: '确定', cancel: '取消', save: '保存', close: '关闭', back: '返回', loading: '加载中…',
      Retry_Now: '立即重试', email: '客服邮箱'
    },
    help: { title: '帮助中心', contact: '联系我们:$t(common.email)', faq: '常见问题' },
    footer: { copyright: '© 2026 星图笔记', privacy: '隐私政策', terms: '服务条款' }
  };

  var en = {
    app: { name: 'StarNote', tagline: '把想法整理成可搜索的笔记', version: 'Version {version}' },
    brand: { name: 'StarNote', slogan: 'StarNote' },
    nav: { home: 'Home', notes: 'Notes', search: 'Search', settings: 'Settings', billing: 'Billing', help: 'Help', logout: 'Log out', beta: 'Beta' },
    auth: {
      login: { title: 'Log in', email: 'Email', password: 'Password', submit: 'Log in', forgot: '', error: 'Wrong email or password. Please try again.' },
      register: { title: 'Sign up', submit: 'Create account', terms: 'I have read and agree to the <a href="/terms">Terms of Service' }
    },
    notes: {
      title: 'My notes', empty: 'No notes yet. Click "New" to start writing.', create: 'New note', untitled: 'Untitled',
      count_one: '{{count}} note',
      delete: { confirm: 'Delete "{title}"? This cannot be undone.', done: 'Deleted %d' },
      share: { title: 'Share note', copyLink: 'Copy link', copied: 'Link copied' },
      legacyBanner: 'Try the new editor'
    },
    inbox: { unread: { one: 'You have {{count}} unread message', other: 'You have {{count}} unread messages' } },
    editor: {
      bold: 'Bold', italic: 'Italic', heading: 'Heading', saving: 'Saving…',
      savedAt: 'Saved at {{time}}', saveButton: 'Store',
      conflict: '<b>Heads up:</b> another device edited this note'
    },
    settings: {
      title: 'Settings', language: 'Interface language', theme: 'Theme', themeDark: '深色', themeLight: 'Light',
      notifications: 'Notifications', exportData: 'Export my data'
    },
    billing: {
      title: 'Billing', plan: 'Current plan: %1$s, %2$d CNY per month', renew: 'Renews on {{date}}',
      invoice: 'Download invoice'
    },
    errors: { network: 'Network connection failed. Please try again later.', unknown: 'An unknown error occurred', permission: 'You do not have permission to do this' },
    common: {
      ok: 'OK', cancel: 'Cancel', save: 'Save', close: 'Close and return to the previous screen without saving anything', back: 'Back', loading: 'Loading…',
      Retry_Now: 'Retry now', email: 'Support email'
    },
    help: { title: 'Help center', contact: 'Contact us: $t(common.email)', faq: 'FAQ' },
    footer: { copyright: '© 2026 StarNote', privacy: 'Privacy Policy', terms: 'Terms of Service' }
  };

  var ja = {
    app: { name: 'スターノート', tagline: 'アイデアを検索できるノートに整理', version: 'バージョン {version}' },
    brand: { name: 'StarNote', slogan: 'StarNote' },
    nav: { home: 'ホーム', notes: 'ノート', search: '検索', settings: '設定', billing: '請求', help: 'ヘルプ', logout: 'ログアウト' },
    auth: {
      login: { title: 'ログイン', email: 'メールアドレス', password: 'パスワード', submit: 'ログイン', forgot: 'パスワードをお忘れですか?', error: 'メールアドレスまたはパスワードが違います。あと {remaining} 回試せます' },
      register: { title: '新規登録', submit: 'アカウントを作成', terms: '<a href="/terms">利用規約</a>に同意します<br>' }
    },
    notes: {
      title: 'マイノート', empty: 'ノートがありません。「新規」をクリックして書き始めましょう', create: '新規ノート', untitled: '無題',
      count_other: '{{count}} 件のノート',
      delete: { confirm: '「{title}」を削除しますか?この操作は取り消せません', done: '%s を削除しました' },
      tags: { add: 'タグを追加', remove: 'タグを削除', limit: 'タグは最大 {max} 個までです' },
      share: { title: 'ノートを共有', copyLink: 'リンクをコピー', copied: 'リンクをコピーしました' }
    },
    inbox: { unread: { other: '未読メッセージが {{count}} 件あります' } },
    editor: {
      bold: '太字', italic: 'イタリック', heading: '見出し', saving: '保存しています…',
      savedAt: '保存しました', saveButton: '保存',
      conflict: '<b>注意:</b>別の端末でこのノートが編集されました'
    },
    settings: {
      title: '設定', language: '表示言語', theme: 'テーマ', themeDark: 'ダーク', themeLight: 'ライト',
      notifications: '通知', exportData: 'データをエクスポート'
    },
    billing: {
      title: '請求', plan: '現在のプラン:%1$s、月額 %2$d 元', renew: '{date} に更新されます',
      invoice: '請求書をダウンロード', failed: 'お支払いに失敗しました。支払い方法を更新してください'
    },
    errors: { network: 'エラー', unknown: '不明なエラーが発生しました', permission: 'この操作を行う権限がありません', notFound: 'ページが見つかりません' },
    common: {
      ok: 'OK', cancel: 'キャンセル', save: '保存', close: '閉じる', back: '戻る', loading: '読み込み中…',
      Retry_Now: '再試行', email: 'サポートメール'
    },
    help: { title: 'ヘルプセンター', contact: 'お問い合わせ:$t(common.email)', faq: 'よくある質問' },
    footer: { copyright: '© 2026 スターノート', privacy: 'プライバシーポリシー', terms: '利用規約' }
  };

  function file(lang, obj) {
    return { lang: lang, name: lang + '.json', format: 'json', nested: true, entries: globalThis.I18nKeyCore.flatten(obj) };
  }
  globalThis.I18N_SAMPLE = {
    label: '合成示例:虚构产品「星图笔记」的 zh(源)/en/ja 文案,问题均为人为埋入',
    build: function () {
      return {
        v: 1,
        source: 'zh',
        files: [file('zh', zh), file('en', en), file('ja', ja)],
        options: { allowSame: ['brand.*'], keyPattern: globalThis.I18nKeyCore.DEFAULT_KEY_PATTERN }
      };
    }
  };
})();

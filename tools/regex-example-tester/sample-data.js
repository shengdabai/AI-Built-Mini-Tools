'use strict';
/* 合成示例:全部为虚构输入,用于演示。每套含故意写错的期望(失败项),方便看失败原因。 */
(function () {
  const m = (input, captures) => ({ input: input, expect: 'match', captures: captures || [] });
  const n = input => ({ input: input, expect: 'nomatch', captures: [] });
  const sets = [
    {
      id: 'sample-phone', name: '合成示例·手机号(11 位)', pattern: '^1[3-9]\\d{9}$', flags: '', maxInput: 10000,
      cases: [
        m('13812345678'), m('19999999999'), m('15000000000'),
        n('12345678901'), n('1381234567'), n('138123456789'), n('138-1234-5678'), n(' 13812345678'),
        m('+8613812345678'), n('13812345678')
      ]
    },
    {
      id: 'sample-email', name: '合成示例·邮箱(简化)', pattern: '^([\\w.+-]+)@([\\w-]+(?:\\.[\\w-]+)+)$', flags: 'i', maxInput: 10000,
      cases: [
        m('a@b.com', ['a', 'b.com']), m('first.last+tag@mail.example.org', ['first.last+tag', 'mail.example.org']),
        m('USER@EXAMPLE.COM', ['USER', 'EXAMPLE.COM']), n('a@b'), n('@b.com'), n('a b@c.com'), n('a@b..com'),
        m('a@b.co', ['a', 'b.com']), m('名字@例子.中国'), n('plain')
      ]
    },
    {
      id: 'sample-date', name: '合成示例·日期 YYYY-MM-DD', pattern: '^(\\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\\d|3[01])$', flags: '', maxInput: 10000,
      cases: [
        m('2026-10-20', ['2026', '10', '20']), m('2026-12-31', ['2026', '12', '31']), m('2024-02-29', ['2024', '02', '29']),
        n('2026-13-01'), n('2026-00-10'), n('2026-1-5'), n('26-10-20'), n('2026/10/20'),
        n('2026-02-30'), m('2026-10-20', ['2026', '1', '20'])
      ]
    },
    {
      id: 'sample-idcard', name: '合成示例·身份证前 6 位(地区码)', pattern: '^([1-9]\\d)(\\d{2})(\\d{2})$', flags: '', maxInput: 10000,
      cases: [
        m('110105', ['11', '01', '05']), m('330102', ['33', '01', '02']), m('440305', ['44', '03', '05']),
        n('000000'), n('12345'), n('1101050'), n('11010a'), n(' 110105'),
        m('010105'), m('110105', ['11', '01', '50'])
      ]
    },
    {
      id: 'sample-backtrack', name: '合成示例·疑似回溯 (a+)+$', pattern: '(a+)+$', flags: '', maxInput: 10000,
      cases: [m('aaa'), n('b'), n('a'.repeat(40) + '!'), m('aaaa')]
    }
  ];
  globalThis.RegexSample = { sets: sets };
})();

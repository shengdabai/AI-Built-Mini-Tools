/* 合成示例数据:人名、金额、课记录均为虚构,仅用于演示。日期以 ?today=2026-10-20 为「今天」。 */
globalThis.BILL_SAMPLE = {
  label: '合成示例',
  students: [
    { name: '林悦', rate: 200, currency: 'CNY', packageHours: 10, packageStart: '2026-09-01', cancelHours: 24, absentBilled: true },
    { name: 'Ben', rate: 30, currency: 'USD', packageHours: 0, packageStart: '', cancelHours: 12, absentBilled: false },
    { name: 'Sofia', rate: 35, currency: 'EUR', packageHours: 3, packageStart: '2026-10-01', cancelHours: 24, absentBilled: true }
  ],
  lessons: [
    { id: 's-l01', date: '2026-09-15', time: '10:00', student: '林悦', minutes: 60, status: '已上', noticeHours: null, note: '' },
    { id: 's-l02', date: '2026-09-29', time: '10:00', student: '林悦', minutes: 90, status: '已上', noticeHours: null, note: '' },
    { id: 's-l03', date: '2026-10-02', time: '10:00', student: '林悦', minutes: 60, status: '已上', noticeHours: null, note: '' },
    { id: 's-l04', date: '2026-10-06', time: '10:00', student: '林悦', minutes: 60, status: '', noticeHours: null, note: '录入时漏选了状态' },
    { id: 's-l05', date: '2026-10-09', time: '10:00', student: '林悦', minutes: 60, status: '学员取消', noticeHours: 3, note: '提前 3 小时取消' },
    { id: 's-l06', date: '2026-10-13', time: '10:00', student: '林悦', minutes: 60, status: '教师取消', noticeHours: null, note: '教师临时有事' },
    { id: 's-l07', date: '2026-10-16', time: '10:00', student: '林悦', minutes: 90, status: '已上', noticeHours: null, note: '' },
    { id: 's-l08', date: '2026-10-16', time: '10:30', student: '林悦', minutes: 60, status: '已上', noticeHours: null, note: '与上一条时间相交,疑似重复录入' },
    { id: 's-l09', date: '2026-10-03', time: '20:00', student: 'Ben', minutes: 60, status: '已上', noticeHours: null, note: '' },
    { id: 's-l10', date: '2026-10-10', time: '20:00', student: 'Ben', minutes: 60, status: '缺席', noticeHours: null, note: '该学员规则:缺席不计费' },
    { id: 's-l11', date: '2026-10-14', time: '20:00', student: 'Ben', minutes: 60, status: '学员取消', noticeHours: 30, note: '' },
    { id: 's-l12', date: '2026-10-05', time: '18:00', student: 'Sofia', minutes: 90, status: '已上', noticeHours: null, note: '' },
    { id: 's-l13', date: '2026-10-12', time: '18:00', student: 'Sofia', minutes: 120, status: '已上', noticeHours: null, note: '' },
    { id: 's-l14', date: '2026-10-18', time: '15:00', student: '小陈', minutes: 60, status: '已上', noticeHours: null, note: '试听课,尚未建档' }
  ],
  payments: [
    { id: 's-p1', date: '2026-09-05', student: '林悦', amount: 1000, currency: 'CNY', note: '九月预付' },
    { id: 's-p2', date: '2026-10-08', student: '林悦', amount: 300, currency: 'CNY', note: '' },
    { id: 's-p3', date: '2026-10-04', student: 'Ben', amount: 30, currency: 'USD', note: '' },
    { id: 's-p4', date: '2026-10-06', student: 'Sofia', amount: 120, currency: 'USD', note: '学员用美元付款,与档案欧元不一致' }
  ]
};

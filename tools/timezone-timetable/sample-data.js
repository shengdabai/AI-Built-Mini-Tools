'use strict';
/* 合成示例:学员与课表均为虚构,仅用于演示夏令时切换周(配合 ?today=2026-10-26)。 */
globalThis.TZ_SAMPLE = {
  version: 1,
  teacherTz: 'Asia/Shanghai',
  students: [
    { id: 'demo-s1', name: '示例学员 Alice', tz: 'America/New_York' },
    { id: 'demo-s2', name: '示例学员 Ben', tz: 'Europe/London' },
    { id: 'demo-s3', name: '示例学员 Chloe', tz: 'Australia/Sydney' },
    { id: 'demo-s4', name: '示例学员 Daiki', tz: 'Asia/Tokyo' }
  ],
  rules: [
    { id: 'demo-r1', studentId: 'demo-s1', weekday: 2, start: '21:00', duration: 60 },
    { id: 'demo-r2', studentId: 'demo-s1', weekday: 6, start: '07:30', duration: 45 },
    { id: 'demo-r3', studentId: 'demo-s2', weekday: 3, start: '16:00', duration: 60 },
    { id: 'demo-r4', studentId: 'demo-s2', weekday: 6, start: '18:00', duration: 60 },
    { id: 'demo-r5', studentId: 'demo-s3', weekday: 4, start: '22:00', duration: 60 },
    { id: 'demo-r6', studentId: 'demo-s4', weekday: 5, start: '10:00', duration: 30 }
  ],
  exceptions: [
    { id: 'demo-e1', ruleId: 'demo-r4', date: '2026-10-31', type: 'move', start: '19:00', duration: 60 },
    { id: 'demo-e2', ruleId: 'demo-r6', date: '2026-10-30', type: 'cancel' }
  ]
};

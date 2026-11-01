/* 合成示例:不是任何真实人的数据。 */
globalThis.TimeSample = (function () {
  'use strict';
  var one = { target: 20000, hours: 80, vacancy: 20, commission: 15, hidden: 30, tax: 5 };
  var two = { buildHours: 60, price: 299, units: 30, fee: 10, refund: 5, hourlyValue: 0 };
  var three = { outsourceRate: 60, yourRate: 300, share: 25, fill: 80, hours: 0 };
  function copy(o) { return Object.assign({}, o); }
  return {
    note: '合成示例',
    build: function () {
      return {
        version: 1,
        current: { name: '合成示例·独立教师基准', one: copy(one), two: copy(two), three: copy(three) },
        scenarios: [
          { id: 'sample-a', name: '合成示例·独立教师基准', one: copy(one), two: copy(two), three: copy(three) },
          { id: 'sample-b', name: '合成示例·课程月销 60', one: copy(one), two: Object.assign(copy(two), { units: 60 }), three: copy(three) },
          { id: 'sample-c', name: '合成示例·隐性时间 20% 且外包 40%', one: Object.assign(copy(one), { hidden: 20 }), two: copy(two), three: Object.assign(copy(three), { share: 40 }) }
        ]
      };
    }
  };
})();

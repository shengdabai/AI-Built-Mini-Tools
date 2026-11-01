'use strict';
/* 合成示例:20 段中英双语编程入门教材(英文原文 → 中文译文),全部为虚构演示文字。
   故意埋入:1 漏译(第 9 段)、1 占位符缺失(第 5 段)、1 数字丢失(第 6 段)、
   2 术语不一致(第 7、8 段)、1 未译(第 10 段)、1 长度异常(第 11 段)、1 同原文不同译(第 12 与 17 段)。 */
(function () {
  var rows = [
    ['1', 'Chapter 1: Learning to program is easier than you think.', '第 1 章:学习编程其实比你想象的要容易得多。'],
    ['2', 'A variable stores a value that you can use later in the program.', '变量用来保存一个值,你可以在程序后面的部分使用它。'],
    ['3', 'Use the print function to show a message on the screen.', '使用 print 函数在屏幕上显示一条消息。'],
    ['4', 'Type {0} and press Enter to continue.', '输入 {0},然后按回车键继续。'],
    ['5', 'Hello, {name}! You have %d new lessons.', '你好,{name}!你有新的课程。'],
    ['6', 'This course has 12 lessons and takes about 30 minutes each.', '这门课包含若干节课,每节大约需要 30 分钟完成。'],
    ['7', 'A loop repeats a block of code until a condition is false.', '它会不断重复执行同一段代码,直到条件不再成立为止。'],
    ['8', 'Every string must be wrapped in quotation marks.', '每一个文本内容都必须放在一对引号之间。'],
    ['9', 'Check the result carefully before you move on.', ''],
    ['10', 'Hello, world!', 'Hello, world!'],
    ['11', 'Lists can hold many items, and each item has its own position, called an index, starting from zero.', '列表。'],
    ['12', 'Save your work often.', '经常保存你的工作。'],
    ['13', 'What happens if the code has a syntax error?', '如果代码里有语法错误,会发生什么?'],
    ['14', 'Do not panic when you see an error message.', '看到错误提示信息的时候,请不要惊慌失措。'],
    ['15', 'Click the <b>Run</b> button to start the program.', '点击 <b>运行</b> 按钮来启动整个程序。'],
    ['16', 'Well done, you have finished the first part!', '做得好,你已经顺利完成了第一部分!'],
    ['17', 'Save your work often.', '请随时保存你的成果。'],
    ['18', 'Functions can take inputs, which are called parameters.', '函数可以接收输入,这些输入被称为参数。'],
    ['19', 'Practice makes progress, so write a little code every day.', '多练习才能进步,所以每天都写一点代码。'],
    ['20', 'See you in the next chapter.', '我们在下一章里再见面吧。']
  ];
  var tsv = ['段落号\t原文\t译文'].concat(rows.map(function (r) { return r.join('\t'); })).join('\n');
  var glossary = [
    '# 合成示例术语表',
    'variable | 变量',
    'function | 函数',
    'loop | 循环',
    'string | 字符串',
    'list | 列表',
    'syntax error | 语法错误'
  ].join('\n');
  globalThis.TRANSCHECK_SAMPLE = { label: '合成示例', tableText: tsv, glossaryText: glossary };
})();

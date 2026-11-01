/* Local-only recovery for the list archives used by Polaris and Hype-Buster. */
(function () {
  'use strict';
  function isRecord(item) {
    return item !== null && typeof item === 'object' && !Array.isArray(item);
  }
  function parseList(raw) {
    var list = raw === null ? [] : JSON.parse(raw);
    if (!Array.isArray(list) || list.some(function (item) { return !isRecord(item); })) {
      throw new Error('存档不是记录列表');
    }
    return list;
  }
  function readList(key) { return parseList(localStorage.getItem(key)); }

  function create(options) {
    var panel, message, acknowledgment, reset, exportButton;
    var exportedRaw = null;
    function invalidate() {
      exportedRaw = null;
      acknowledgment.checked = false;
      reset.disabled = true;
    }
    function say(text) { message.textContent = text; }
    function refresh() {
      options.refresh();
      // Hidden controls must not retain keyboard focus after reset/retry.
      var view = document.querySelector('.view.active');
      if (panel.hidden && view) { view.setAttribute('tabindex', '-1'); view.focus(); }
    }
    function damagedRaw() {
      var raw = localStorage.getItem(options.key);
      try { parseList(raw); }
      catch (e) { return raw; }
      throw new Error('存档已恢复可读，请先点“重新读取”。');
    }
    function exportRaw(raw) {
      var url, link;
      try {
        // JSON wrapper preserves even lone UTF-16 surrogates without Blob replacement.
        var bundle = { format: 'local-list-recovery-v1', key: options.key, raw: raw };
        url = URL.createObjectURL(new Blob([JSON.stringify(bundle)], { type: 'application/json' }));
        link = document.createElement('a');
        link.href = url;
        link.download = options.key.replace(/[^a-z0-9-]/gi, '-') + '-recovery.json';
        document.body.appendChild(link);
        link.click();
        exportedRaw = raw;
      } finally {
        if (link && link.parentNode) link.parentNode.removeChild(link);
        // Give the browser time to consume the object URL before releasing it.
        if (url) setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
      }
    }
    function build() {
      var host = document.querySelector('#archiveRecovery');
      panel = document.createElement('section');
      panel.hidden = true;
      panel.className = 'archive-recovery';
      panel.setAttribute('aria-label', options.label + '恢复');
      var title = document.createElement('h2');
      title.textContent = options.label + '无法读取';
      message = document.createElement('p');
      message.setAttribute('role', 'status');
      var help = document.createElement('p');
      help.textContent = '列表含无效成员时，可点“只保留有效记录”：先请求下载完整原文，再移除非对象成员。完整重置前请检查备份文件已保存。备份可能含私人内容，请妥善保存。';
      exportButton = document.createElement('button');
      exportButton.type = 'button';
      exportButton.textContent = '导出原始文本';
      var keep = document.createElement('button');
      keep.type = 'button';
      keep.textContent = '只保留有效记录';
      var label = document.createElement('label');
      acknowledgment = document.createElement('input');
      acknowledgment.type = 'checkbox';
      label.appendChild(acknowledgment);
      label.appendChild(document.createTextNode('我已保存备份，同意清空此存档'));
      reset = document.createElement('button');
      reset.type = 'button';
      reset.textContent = '重置' + options.label;
      reset.disabled = true;
      var retry = document.createElement('button');
      retry.type = 'button';
      retry.textContent = '重新读取';
      [title, message, help, exportButton, keep, label, reset, retry].forEach(function (el) { panel.appendChild(el); });
      host.appendChild(panel);
      acknowledgment.addEventListener('change', function () {
        reset.disabled = exportedRaw === null || !acknowledgment.checked;
      });
      exportButton.addEventListener('click', function () {
        invalidate();
        try {
          exportRaw(damagedRaw());
          say('已请求下载。请确认备份文件已保存，再勾选下方确认。');
        } catch (e) {
          say('导出未完成，未覆盖原数据。请检查存储与下载权限，或重新读取。');
        }
      });
      keep.addEventListener('click', function () {
        invalidate();
        var list, valid;
        try {
          var raw = damagedRaw();
          list = JSON.parse(raw);
          if (!Array.isArray(list)) throw new Error('存档不是列表');
          valid = list.filter(isRecord);
          exportRaw(raw);
          // Export may trigger another tab to change this archive; never overwrite it.
          if (damagedRaw() !== raw) throw new Error('存档已变化');
          localStorage.setItem(options.key, JSON.stringify(valid));
        } catch (e) {
          invalidate();
          say('保留有效记录未完成，未覆盖原数据。仅支持可解析的列表；请检查下载与存储权限，或重新读取。');
          return;
        }
        hide();
        refresh();
        if (options.notify) options.notify('已保留 ' + valid.length + ' 条有效记录，丢弃 ' + (list.length - valid.length) + ' 条无效记录。已请求下载原始备份，请确认文件已保存。');
      });
      reset.addEventListener('click', function () {
        if (exportedRaw === null || !acknowledgment.checked) return;
        if (!window.confirm('清空“' + options.label + '”？请先确认导出的备份文件已保存。此操作不能在应用内撤销。')) return;
        try {
          // Re-read after confirmation: a different tab may have repaired/changed it.
          if (damagedRaw() !== exportedRaw) throw new Error('存档已变化');
          localStorage.setItem(options.key, '[]');
        } catch (e) {
          invalidate();
          say('重置未完成，未覆盖原数据。存档可能已变化或浏览器拒绝读写，请重新读取并导出。');
          return;
        }
        hide();
        refresh();
      });
      retry.addEventListener('click', function () {
        invalidate();
        say('无法读取此存档，已停止写入并保留原数据。');
        refresh();
      });
    }
    function show() {
      if (!panel) build();
      if (panel.hidden) {
        invalidate();
        say('无法读取此存档，已停止写入并保留原数据。');
      }
      panel.hidden = false;
    }
    function hide() {
      if (panel) { invalidate(); panel.hidden = true; }
    }
    return { show: show, hide: hide };
  }
  window.ArchiveRecovery = { readList: readList, create: create };
})();

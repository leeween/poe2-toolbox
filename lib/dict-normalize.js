// PoE2 工具箱 —— 词典归一化（建表侧 / 翻译侧 / 主脚本 三处唯一来源）
// 与 scripts/poe2/poe2-pob-dict-build.py 一比一移植，挂到 globalThis.PoE2Norm。
// 可在 service worker（importScripts）与 Node（vm.runInThisContext）中复用。
(function () {
    'use strict';
    const SENT = ''; // 数字/占位符哨兵，与 Python SENT (\x01) 一致

    // Python str 的空白语义（用于精确对齐 Python 的 \s / strip）：
    // 关键差异 —— 含 NEL(\x85)/分隔符等，但【不含】﻿(BOM)；而 JS 原生 \s 与 trim()
    // 恰好相反（会吞掉 ﻿）。为与 Python 建表逐字节一致，这里自定义空白集。
    const PY_WS = '\\t\\n\\r\\f\\v\\x1c\\x1d\\x1e\\x1f \\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000';
    const PY_WS_RUN = new RegExp('[' + PY_WS + ']+', 'g');
    const PY_WS_EDGES = new RegExp('^[' + PY_WS + ']+|[' + PY_WS + ']+$', 'g');
    function pyStrip(s) { return s.replace(PY_WS_EDGES, ''); }

    // [tag|显示] -> 显示 ; [tag] -> tag
    function stripMarkup(s) {
        s = s.replace(/\[[^\[\]|]*\|([^\[\]]*)\]/g, '$1');
        s = s.replace(/\[([^\[\]|]*)\]/g, '$1');
        return s;
    }

    // 中文 -> 归一化键：去标记、合并换行、可选符号+数字/占位符 -> 哨兵、压空格、小写。
    function makeZhKey(zh) {
        let z = stripMarkup(zh);
        z = z.split('\\n').join(' ');            // 文件里多行用字面 "\n"（反斜杠+n）
        z = z.replace(/[\r\n]+/g, ' ');          // 以防真换行
        z = z.replace(/[+\-]?(?:\{\d+\}|#|[0-9]+(?:\.[0-9]+)?)/g, SENT);
        z = pyStrip(z.replace(PY_WS_RUN, ' ')).toLowerCase();
        return z;
    }

    // 英文 -> 模板：去标记、保留真实换行（多行词缀）、占位符与数字 -> 哨兵。
    function makeEnTemplate(en) {
        let e = stripMarkup(en);
        e = e.split('\\n').join('\n');           // 输出里要真正的换行
        e = e.replace(/\{\d+\}|#/g, SENT);       // 占位符先于数字（与 Python 顺序一致）
        e = e.replace(/[0-9]+(?:\.[0-9]+)?/g, SENT);
        e = e.replace(/[ \t]+/g, ' ');
        e = pyStrip(e.split('\n').map((line) => pyStrip(line)).join('\n'));
        return e;
    }

    // 「附加伤害」窄家族的去前后缀别名键
    function aliasZhKeys(zh) {
        if (zh.includes('附加') && zh.includes('伤害') && zh.length < 48) {
            let z = zh.split('基础').join('');
            z = stripMarkup(z).trim().replace(/^(该装备|本地)/, '');
            return [makeZhKey(z)];
        }
        return [];
    }

    globalThis.PoE2Norm = { SENT, stripMarkup, makeZhKey, makeEnTemplate, aliasZhKeys };
})();

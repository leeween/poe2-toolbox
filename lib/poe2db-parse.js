// PoE2 工具箱 —— poe2db ModsView 解析（建表侧 / 后台 / 验证脚本共用）
// 挂到 globalThis.PoE2DBParse。从 HTML 内联的 `new ModsView({...})` 抠出 JSON 对象。
(function () {
    'use strict';

    // 按括号配对抠出 new ModsView({ ... }) 的 JSON（跳过字符串内的括号）。
    function extractModsViewJson(html) {
        const m = html.indexOf('new ModsView(');
        if (m < 0) return null;
        let i = html.indexOf('{', m);
        if (i < 0) return null;
        const start = i;
        let depth = 0, inStr = false, esc = false;
        for (; i < html.length; i++) {
            const c = html[i];
            if (inStr) {
                if (esc) esc = false;
                else if (c === '\\') esc = true;
                else if (c === '"') inStr = false;
            } else {
                if (c === '"') inStr = true;
                else if (c === '{') depth++;
                else if (c === '}') { depth--; if (depth === 0) { i++; break; } }
            }
        }
        try { return JSON.parse(html.slice(start, i)); }
        catch (e) { console.warn('[PoE2TB] ModsView JSON 解析失败', e); return null; }
    }

    // poe2db URL：cn -> /cn/<slug>；tw -> /tw/<slug>；en -> /<slug>（英文页无前缀）
    function poe2dbUrl(lang, slug) {
        return 'https://poe2db.tw/' + (lang === 'en' ? '' : (lang === 'tw' ? 'tw/' : 'cn/')) + slug;
    }

    globalThis.PoE2DBParse = { extractModsViewJson, poe2dbUrl };
})();

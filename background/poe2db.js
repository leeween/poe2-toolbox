// PoE2 工具箱 —— poe2db 词缀抓取（后台模块）
// 替代油猴的 GM_xmlhttpRequest + GM_setValue：跨域抓 poe2db 页面，从内联的
// `new ModsView({...})` 抠出 JSON，按 slug+语言缓存到 chrome.storage.local（24h）。
// 解析与 URL 拼装在 lib/poe2db-parse.js（验证脚本共用）。
'use strict';

const POE2DB_TTL = 24 * 60 * 60 * 1000;

function poe2dbCacheKey(lang, slug) {
    return 'modsview:' + lang + ':' + slug;
}

async function fetchModsView(lang, slug) {
    const Parse = globalThis.PoE2DBParse;
    const ck = poe2dbCacheKey(lang, slug);
    const { [ck]: cached } = await chrome.storage.local.get({ [ck]: null });
    if (cached && cached.data && Date.now() - cached.t < POE2DB_TTL) return cached.data;
    const res = await fetch(Parse.poe2dbUrl(lang, slug), { credentials: 'omit' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const obj = Parse.extractModsViewJson(await res.text());
    if (obj) await chrome.storage.local.set({ [ck]: { t: Date.now(), data: obj } });
    return obj;
}

TB.on('POE2DB_FETCH', async (req) => ({ data: await fetchModsView(req.lang, req.slug) }));

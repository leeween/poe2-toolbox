// PoE2 工具箱 —— poe2db 词缀抓取（后台模块）
// 替代油猴的 GM_xmlhttpRequest + GM_setValue：跨域抓 poe2db 页面，从内联的
// `new ModsView({...})` 抠出 JSON，按 slug+语言缓存到 chrome.storage.local（24h）。
'use strict';

const POE2DB_TTL = 24 * 60 * 60 * 1000;

function poe2dbUrl(lang, slug) {
    return 'https://poe2db.tw/' + (lang === 'cn' ? 'cn' : 'tw') + '/' + slug;
}
function poe2dbCacheKey(lang, slug) {
    return 'modsview:' + lang + ':' + slug;
}

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

async function fetchModsView(lang, slug) {
    const ck = poe2dbCacheKey(lang, slug);
    const { [ck]: cached } = await chrome.storage.local.get({ [ck]: null });
    if (cached && cached.data && Date.now() - cached.t < POE2DB_TTL) return cached.data;
    const res = await fetch(poe2dbUrl(lang, slug), { credentials: 'omit' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const obj = extractModsViewJson(await res.text());
    if (obj) await chrome.storage.local.set({ [ck]: { t: Date.now(), data: obj } });
    return obj;
}

TB.on('POE2DB_FETCH', async (req) => ({ data: await fetchModsView(req.lang, req.slug) }));

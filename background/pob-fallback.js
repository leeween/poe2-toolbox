// PoE2 工具箱 —— PoB 补充词典（后台模块）
// 主词典（lang-sc.json 建表）不收录的词条，按物品 base slug 从 poe2db 抓中英文页
// ModsView 配对建补充词典，存 chrome.storage.local['pob-fallback:<slug>']，TTL 14 天。
// 依赖：lib/poe2db-parse.js、lib/pob-fallback-build.js、lib/dict-normalize.js、background/poe2db.js。
'use strict';

const FALL_KEY = (slug) => 'pob-fallback:' + slug;
const FALL_TTL = 14 * 24 * 60 * 60 * 1000;
// 建表逻辑版本：归一化/配对规则变化时 bump，让旧缓存自动失效重建。
const FALL_VER = 2;

async function buildFallback(slug) {
    const [cnView, enView] = await Promise.all([
        fetchModsView('cn', slug),
        fetchModsView('en', slug),
    ]);
    const dict = globalThis.PoE2FallbackBuild.build(cnView, enView);
    const meta = { builtAt: Date.now(), ver: FALL_VER, slug, keys: Object.keys(dict).length };
    await chrome.storage.local.set({ [FALL_KEY(slug)]: { t: meta.builtAt, ver: FALL_VER, slug, dict } });
    return { dict, meta };
}

async function ensureFallback(slug) {
    const ck = FALL_KEY(slug);
    const { [ck]: cached } = await chrome.storage.local.get({ [ck]: null });
    if (cached && cached.dict && cached.ver === FALL_VER && Date.now() - cached.t < FALL_TTL) {
        return { ready: true, slug, keys: Object.keys(cached.dict).length, cached: true };
    }
    try {
        const { dict, meta } = await buildFallback(slug);
        return { ready: true, slug, keys: meta.keys };
    } catch (e) {
        if (cached && cached.dict) return { ready: true, slug, keys: Object.keys(cached.dict).length, stale: true, error: String(e && e.message || e) };
        return { ready: false, slug, error: String(e && e.message || e) };
    }
}

async function getFallback(slug) {
    const ck = FALL_KEY(slug);
    const { [ck]: cached } = await chrome.storage.local.get({ [ck]: null });
    return cached && cached.dict ? cached.dict : null;
}

TB.on('POB_FALLBACK_ENSURE', async (req) => await ensureFallback(String(req.slug)));
TB.on('POB_FALLBACK_GET', async (req) => ({ dict: await getFallback(String(req.slug)) }));

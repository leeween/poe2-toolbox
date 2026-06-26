// PoE2 工具箱 —— PoB 词典子系统（后台模块）
// 方案 A：运行时下载原料 lang-sc.json -> JS 反向建表 -> 存 chrome.storage.local。
// TTL + ETag 条件请求；下载/建表失败时沿用旧缓存（stale-while-error）；支持手动导入。
// 依赖：lib/dict-normalize.js（PoE2Norm）、lib/dict-build.js（PoE2DictBuild）。
'use strict';

const DICT_SRC = 'https://ninja.710421059.xyz/lang-sc.json';
const DICT_KEY = 'pob-dict';       // 建好的 { 中文模板: 英文模板 }
const META_KEY = 'pob-dict-meta';  // { builtAt, etag, keys, size }
const DICT_TTL = 14 * 24 * 60 * 60 * 1000; // 14 天

async function getMeta() {
    const { [META_KEY]: meta } = await chrome.storage.local.get({ [META_KEY]: null });
    return meta;
}

function buildFromRaw(text) {
    const data = JSON.parse(text);
    const dict = globalThis.PoE2DictBuild.build(data);
    const json = JSON.stringify(dict);
    const meta = { builtAt: Date.now(), etag: '', keys: Object.keys(dict).length, size: json.length };
    return { dict, meta };
}

async function store(dict, meta) {
    await chrome.storage.local.set({ [DICT_KEY]: dict, [META_KEY]: meta });
    return meta;
}

async function fetchRaw(etag, force) {
    const headers = {};
    if (etag && !force) headers['If-None-Match'] = etag;
    const res = await fetch(DICT_SRC, { headers, cache: 'no-cache' });
    if (res.status === 304) return { notModified: true };
    if (!res.ok) throw new Error('下载失败 HTTP ' + res.status);
    return { text: await res.text(), etag: res.headers.get('etag') || '' };
}

let inflight = null;

async function doEnsure(force) {
    const meta = await getMeta();
    const fresh = meta && meta.builtAt && (Date.now() - meta.builtAt < DICT_TTL);
    if (fresh && !force) return { ready: true, status: meta };

    try {
        const r = await fetchRaw(meta && meta.etag, force);
        if (r.notModified && meta) {
            // 服务器内容未变：只刷新时间戳，不重建（省去 5.7MB 重下/重建）
            const m2 = { ...meta, builtAt: Date.now() };
            await chrome.storage.local.set({ [META_KEY]: m2 });
            return { ready: true, status: m2 };
        }
        const { dict, meta: m } = buildFromRaw(r.text);
        m.etag = r.etag || '';
        await store(dict, m);
        return { ready: true, status: m };
    } catch (e) {
        // stale-while-error：有旧缓存就继续用，仅标记 stale
        if (meta && meta.builtAt) return { ready: true, status: meta, stale: true, error: String(e && e.message || e) };
        return { ready: false, error: String(e && e.message || e) };
    }
}

function ensure(force) {
    if (inflight && !force) return inflight;
    const p = doEnsure(force).finally(() => { if (inflight === p) inflight = null; });
    if (!force) inflight = p;
    return p;
}

// ── 消息处理 ──────────────────────────────────────────────────────
TB.on('DICT_STATUS', async () => ({ status: (await getMeta()) || { builtAt: 0 } }));
TB.on('DICT_ENSURE', async () => await ensure(false));          // 内容脚本首用触发
TB.on('DICT_REFRESH', async () => await ensure(true));          // 设置页「立即更新」
TB.on('DICT_IMPORT', async (req) => {                            // 设置页「手动导入」
    const { dict, meta } = buildFromRaw(req.raw);
    meta.etag = '';
    await store(dict, meta);
    return { status: meta };
});

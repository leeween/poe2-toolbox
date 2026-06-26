// PoE2 工具箱 —— 搜索历史存储（后台模块）
// 通过 TB.on 注册消息处理；存储键 poe1-/poe2- 前缀，与旧插件 schema 一致。
'use strict';

function vkey(version, key) {
    return `${version === 'poe1' ? 'poe1' : 'poe2'}-${key}`;
}

async function saveSearchRecord(record, version) {
    const k = vkey(version, 'searchHistory');
    const { [k]: list } = await chrome.storage.local.get({ [k]: [] });
    let history = list;
    const idx = history.findIndex((e) => e.id === record.id);
    if (idx !== -1) history.splice(idx, 1);
    history.unshift(record);
    if (history.length > 100) history = history.slice(0, 100);
    await chrome.storage.local.set({ [k]: history });
}

async function getSearchHistory(version) {
    const k = vkey(version, 'searchHistory');
    const { [k]: list } = await chrome.storage.local.get({ [k]: [] });
    return list;
}

async function deleteSearchRecord(id, version) {
    const k = vkey(version, 'searchHistory');
    const { [k]: list } = await chrome.storage.local.get({ [k]: [] });
    await chrome.storage.local.set({ [k]: list.filter((r) => r.id !== id) });
}

async function clearSearchHistory(version) {
    const k = vkey(version, 'searchHistory');
    await chrome.storage.local.set({ [k]: [] });
}

TB.on('SAVE_SEARCH_RECORD', async (req) => { await saveSearchRecord(req.data, req.version); });
TB.on('GET_SEARCH_HISTORY', async (req) => ({ data: await getSearchHistory(req.version) }));
TB.on('DELETE_SEARCH_RECORD', async (req) => { await deleteSearchRecord(req.id, req.version); });
TB.on('CLEAR_SEARCH_HISTORY', async (req) => { await clearSearchHistory(req.version); });

// ── 定期清理 30 天前的记录 ────────────────────────────────────────
function cleanupOldRecords() {
    ['poe1', 'poe2'].forEach((version) => {
        const k = vkey(version, 'searchHistory');
        chrome.storage.local.get({ [k]: [] }, (res) => {
            const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
            const filtered = res[k].filter((r) => new Date(r.timestamp).getTime() > cutoff);
            if (filtered.length !== res[k].length) chrome.storage.local.set({ [k]: filtered });
        });
    });
}

chrome.alarms.create('cleanupOldRecords', { delayInMinutes: 1, periodInMinutes: 24 * 60 });
chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'cleanupOldRecords') cleanupOldRecords();
});

// 供其它后台模块复用
self.TB_vkey = vkey;

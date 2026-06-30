// PoE2 工具箱 —— 后台服务（classic service worker）
// 模式：各后台模块通过 importScripts 引入，并用 TB.on(type, handler) 注册消息处理；
// 本文件提供消息路由：handler 返回的对象会并入 { success:true, ... } 响应。
self.TB = {
    handlers: {},
    on(type, fn) { this.handlers[type] = fn; },
};

// 后台模块（按阶段逐步引入）
importScripts(
    '../lib/lz-string.js',
    '../lib/dict-normalize.js',
    '../lib/dict-build.js',
    'storage.js',
    'favorites.js',
    'dict.js',
    'poe2db.js',
    'poe-ninja.js'
);

// ── 内置处理：打开设置页 / 介绍页 ───────────────────────────────────
TB.on('OPEN_OPTIONS', () => { chrome.runtime.openOptionsPage(); return {}; });
TB.on('OPEN_INTRO', () => { chrome.tabs.create({ url: chrome.runtime.getURL('options/intro.html') }); return {}; });

chrome.runtime.onInstalled.addListener(() => console.log('[PoE2TB] 已安装'));

// 点击插件图标：交易页 -> 切换侧边栏；否则打开交易页
chrome.action.onClicked.addListener((tab) => {
    if (tab.url && (tab.url.includes('/trade2') || tab.url.includes('/trade'))) {
        chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_PANEL' }).catch(() => { });
    } else {
        const url = tab.url && tab.url.includes('poe.game.qq.com')
            ? 'https://poe.game.qq.com/trade2'
            : 'https://www.pathofexile.com/trade2';
        chrome.tabs.create({ url });
    }
});

// 消息路由
chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
    const handler = req && self.TB.handlers[req.type];
    if (!handler) return false;
    Promise.resolve(handler(req, sender))
        .then((r) => sendResponse({ success: true, ...(r || {}) }))
        .catch((e) => sendResponse({ success: false, error: e && e.message ? e.message : String(e) }));
    return true; // 异步响应
});

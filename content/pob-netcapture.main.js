// PoE2 工具箱 —— PoB 网络捕获（MAIN 世界，document_start）
// 唯一职责：劫持页面 window.fetch / XMLHttpRequest，捕获 /api/trade2/fetch/ 返回的物品 JSON，
// 通过 window.postMessage 转发给隔离世界的 pob-copy.js（隔离世界拿不到页面的 fetch，故必须在此）。
(function () {
    'use strict';
    const PATTERN = /\/api\/trade2\/fetch\//;

    function forward(json) {
        try {
            window.postMessage({ __poe2tb_pob: true, payload: json }, '*');
        } catch (e) { /* ignore */ }
    }

    // fetch 劫持
    const origFetch = window.fetch;
    if (typeof origFetch === 'function') {
        window.fetch = function (...args) {
            const p = origFetch.apply(this, args);
            try {
                const url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url) || '';
                if (PATTERN.test(url)) {
                    p.then((res) => { res.clone().json().then(forward).catch(() => { }); }).catch(() => { });
                }
            } catch (e) { /* ignore */ }
            return p;
        };
    }

    // XHR 劫持
    const XHR = window.XMLHttpRequest;
    if (XHR && XHR.prototype) {
        const origOpen = XHR.prototype.open;
        const origSend = XHR.prototype.send;
        XHR.prototype.open = function (method, url, ...rest) {
            this.__pobUrl = url;
            return origOpen.call(this, method, url, ...rest);
        };
        XHR.prototype.send = function (...sendArgs) {
            try {
                if (this.__pobUrl && PATTERN.test(this.__pobUrl)) {
                    this.addEventListener('load', () => {
                        try { forward(JSON.parse(this.responseText)); } catch (e) { /* ignore */ }
                    });
                }
            } catch (e) { /* ignore */ }
            return origSend.apply(this, sendArgs);
        };
    }
})();

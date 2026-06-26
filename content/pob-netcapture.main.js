// PoE2 工具箱 —— 页面网络捕获（MAIN 世界，document_start）
// 隔离世界拿不到页面的 fetch/XHR，所以在此劫持，捕获两类数据并 postMessage 转发：
//   1) /api/trade2/fetch/ 的响应 -> 物品 JSON（供「复制PoB」）
//   2) /api/trade2/search   的请求体 -> 选中的物品类别 id（供「查看词缀」类型识别兜底）
(function () {
    'use strict';
    const FETCH_PATTERN = /\/api\/trade2\/fetch\//;
    const SEARCH_PATTERN = /\/api\/trade2\/search/;

    function post(msg) {
        try { window.postMessage(msg, '*'); } catch (e) { /* ignore */ }
    }
    function forwardItems(json) { post({ __poe2tb_pob: true, payload: json }); }

    // 从 search 请求体里读类别 id
    function grabSearchCategory(body) {
        try {
            const j = typeof body === 'string' ? JSON.parse(body) : body;
            const opt = j && j.query && j.query.filters && j.query.filters.type_filters &&
                j.query.filters.type_filters.filters && j.query.filters.type_filters.filters.category &&
                j.query.filters.type_filters.filters.category.option;
            if (opt) post({ __poe2tb_search: true, category: opt });
        } catch (e) { /* ignore */ }
    }

    // fetch 劫持
    const origFetch = window.fetch;
    if (typeof origFetch === 'function') {
        window.fetch = function (...args) {
            try {
                const url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url) || '';
                if (SEARCH_PATTERN.test(url) && args[1] && args[1].body) grabSearchCategory(args[1].body);
                const p = origFetch.apply(this, args);
                if (FETCH_PATTERN.test(url)) {
                    p.then((res) => { res.clone().json().then(forwardItems).catch(() => { }); }).catch(() => { });
                }
                return p;
            } catch (e) {
                return origFetch.apply(this, args);
            }
        };
    }

    // XHR 劫持
    const XHR = window.XMLHttpRequest;
    if (XHR && XHR.prototype) {
        const origOpen = XHR.prototype.open;
        const origSend = XHR.prototype.send;
        XHR.prototype.open = function (method, url, ...rest) {
            this.__tbUrl = url;
            return origOpen.call(this, method, url, ...rest);
        };
        XHR.prototype.send = function (...sendArgs) {
            try {
                const url = this.__tbUrl || '';
                if (SEARCH_PATTERN.test(url) && sendArgs[0]) grabSearchCategory(sendArgs[0]);
                if (FETCH_PATTERN.test(url)) {
                    this.addEventListener('load', () => {
                        try { forwardItems(JSON.parse(this.responseText)); } catch (e) { /* ignore */ }
                    });
                }
            } catch (e) { /* ignore */ }
            return origSend.apply(this, sendArgs);
        };
    }
})();

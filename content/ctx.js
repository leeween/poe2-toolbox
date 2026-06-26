// PoE2 工具箱 —— 内容脚本共享上下文（隔离世界）
// 提供：站点/版本探测、功能注册表、版本化存储、toast/对话框、后台消息、工具函数。
// 所有功能模块（features/*.js）在加载时调用 PoE2TB.register(...)，由 shell.js 统一挂载。
// 加载顺序（见 manifest）：ctx.js -> features/*.js -> shell.js
(function () {
    'use strict';

    if (window.PoE2TB) return; // 防重复注入

    // ── 站点 / 版本探测 ────────────────────────────────────────────────
    const host = window.location.hostname;
    const path = window.location.pathname;
    const isQQ = host === 'poe.game.qq.com';
    const isIntl = host === 'www.pathofexile.com';
    // poe2：路径以 /trade2 开头；poe1：/trade（且非 /trade2）
    const version = path.startsWith('/trade2') ? 'poe2'
        : path.startsWith('/trade') ? 'poe1'
            : 'poe2';

    // ── 工具函数 ──────────────────────────────────────────────────────
    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text == null ? '' : String(text);
        return div.innerHTML;
    }

    function truncate(str, maxLength) {
        str = String(str == null ? '' : str);
        return str.length <= maxLength ? str : str.substring(0, maxLength) + '...';
    }

    function generateId() {
        return Date.now().toString(36) + Math.random().toString(36).slice(2);
    }

    function formatTime(timestamp) {
        const date = new Date(timestamp);
        const diff = Date.now() - date.getTime();
        if (diff < 60000) return '刚刚';
        if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`;
        if (diff < 86400000) return `${Math.floor(diff / 3600000)}小时前`;
        if (diff < 604800000) return `${Math.floor(diff / 86400000)}天前`;
        return date.toLocaleDateString('zh-CN');
    }

    // ── 存储助手 ──────────────────────────────────────────────────────
    // 版本化键：poe1- / poe2- 前缀，与旧插件 schema 保持一致，便于数据互通。
    const storage = {
        vkey(name) { return `${version}-${name}`; },
        async get(name, def) {
            const k = this.vkey(name);
            const r = await chrome.storage.local.get({ [k]: def });
            return r[k];
        },
        async set(name, val) {
            return chrome.storage.local.set({ [this.vkey(name)]: val });
        },
        // 非版本化（全局）键
        async getRaw(key, def) {
            const r = await chrome.storage.local.get({ [key]: def });
            return r[key];
        },
        async setRaw(key, val) {
            return chrome.storage.local.set({ [key]: val });
        },
    };

    // 功能开关（全局键 tb-enabled = { [featureId]: boolean }，缺省视为启用）
    const ENABLED_KEY = 'tb-enabled';
    async function getEnabledMap() {
        return (await storage.getRaw(ENABLED_KEY, {})) || {};
    }
    function isEnabled(map, id) {
        return map[id] !== false; // 默认启用
    }

    // ── 后台消息 ──────────────────────────────────────────────────────
    function sendBg(msg) {
        return chrome.runtime.sendMessage({ version, ...msg });
    }

    // ── 交易搜索参数解析（history / favorites 共用）─────────────────────
    function isDefaultValue(v) {
        return ['任何', '否', '任何时间', '一口价', '崇高石等价物', '', ' '].includes(v);
    }
    function isDefaultKey(k) {
        return ['search_term', '', ' '].includes(k);
    }

    function extractParams() {
        const url = new URL(window.location.href);
        const params = {};
        for (const [key, value] of url.searchParams.entries()) {
            if (value && value.trim() !== '') params[key] = value;
        }
        if (isQQ) {
            if (url.pathname.includes('/trade2/search/poe2/')) {
                const p = url.pathname.split('/');
                if (p.length >= 6) {
                    const league = decodeURIComponent(p[4]);
                    if (league) params.league = league;
                    if (p[5]) params.search_id = p[5];
                }
            } else if (url.pathname.includes('/trade/search/')) {
                const p = url.pathname.split('/').filter(Boolean);
                const si = p.indexOf('search');
                if (si !== -1 && si + 1 < p.length) {
                    const league = decodeURIComponent(p[si + 1]);
                    if (league && league !== 'search') params.league = league;
                    if (si + 2 < p.length && p[si + 2]) params.search_id = p[si + 2];
                }
            }
        }
        try {
            document.querySelectorAll('input[type="text"], input[type="search"], select, textarea').forEach((input) => {
                const value = input.value?.trim();
                if (value && !isDefaultValue(value)) {
                    let key = input.name || input.id || input.placeholder || 'search_term';
                    if (input.tagName === 'SELECT') {
                        if (key === value) key = '物品类型';
                    } else if (input.type === 'text') {
                        if (key.includes('查找物品') || key.includes('搜索')) key = '物品名称';
                    }
                    if (!isDefaultKey(key)) params[key] = value;
                }
            });
        } catch (e) { /* ignore */ }
        return params;
    }

    function smartTitle(params) {
        for (const [key, value] of Object.entries(params)) {
            if (!value || isDefaultValue(value)) continue;
            if (key === '物品名称' || key.includes('查找物品') || key.includes('搜索') || key.includes('name') || key === 'q') {
                return value.trim();
            }
            if (key === '物品类型' || key.includes('类型') || key.includes('type') || key.includes('category') ||
                (key === value && value.length <= 10)) {
                return value.trim();
            }
        }
        if (params.league) return `${params.league} - 交易搜索`;
        return '交易搜索';
    }

    const search = { extractParams, smartTitle, isDefaultValue };

    // ── 功能注册表 ────────────────────────────────────────────────────
    // feature = {
    //   id, label, icon?,
    //   scope(ctx) -> bool          // 是否在当前页面生效
    //   panel: bool                 // true=渲染成侧边栏 tab；false=纯内联
    //   mount(panelEl, ctx) -> handle?   // panel 功能：填充面板，可返回 {onShow,onRefresh,onClear}
    //   init(ctx)                    // 内联功能：运行一次
    // }
    const _features = [];
    function register(feature) {
        if (!feature || !feature.id) return;
        if (_features.some(f => f.id === feature.id)) return;
        _features.push(feature);
    }

    window.PoE2TB = {
        host, isQQ, isIntl, version,
        storage,
        getEnabledMap, isEnabled, ENABLED_KEY,
        sendBg,
        search,
        register,
        _features,
        util: { escapeHtml, truncate, generateId, formatTime },
        // UI 服务由 shell.js 注入（toast / confirm / input），功能模块通过 ctx.ui 调用
        ui: null,
    };
})();

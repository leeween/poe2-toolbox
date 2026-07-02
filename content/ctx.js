// PoE2 工具箱 —— 内容脚本共享上下文（隔离世界）
// 提供：站点/版本探测、功能注册表、版本化存储、toast/对话框、后台消息、工具函数。
// 所有功能模块（features/*.js）在加载时调用 PoE2TB.register(...)，由 shell.js 统一挂载。
// 加载顺序（见 manifest）：ctx.js -> features/*.js -> shell.js
(function () {
    'use strict';

    if (window.PoE2TB) return; // 防重复注入

    // ── 站点 / 版本探测 ────────────────────────────────────────────────
    const host = window.location.hostname;
    const isQQ = host === 'poe.game.qq.com';
    const isIntl = host === 'www.pathofexile.com';
    // 国服用 poe2- 前缀（与旧插件 schema 一致，不动国服数据）；国际服用 poe2-intl- 前缀做数据隔离。
    const version = isIntl ? 'poe2-intl' : 'poe2';

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

    function extensionAlive() {
        try {
            return !!(chrome && chrome.runtime && chrome.runtime.id);
        } catch (e) {
            return false;
        }
    }

    // ── 存储助手 ──────────────────────────────────────────────────────
    // 版本化键：poe2- 前缀，与旧插件 schema 保持一致，便于数据互通。
    const storage = {
        vkey(name) { return `${version}-${name}`; },
        async get(name, def) {
            if (!extensionAlive()) return def;
            const k = this.vkey(name);
            try {
                const r = await chrome.storage.local.get({ [k]: def });
                return r[k];
            } catch (e) {
                return def;
            }
        },
        async set(name, val) {
            if (!extensionAlive()) return false;
            try {
                await chrome.storage.local.set({ [this.vkey(name)]: val });
                return true;
            } catch (e) {
                return false;
            }
        },
        // 非版本化（全局）键
        async getRaw(key, def) {
            if (!extensionAlive()) return def;
            try {
                const r = await chrome.storage.local.get({ [key]: def });
                return r[key];
            } catch (e) {
                return def;
            }
        },
        async setRaw(key, val) {
            if (!extensionAlive()) return false;
            try {
                await chrome.storage.local.set({ [key]: val });
                return true;
            } catch (e) {
                return false;
            }
        },
    };

    // 功能开关（全局键 tb-enabled = { qq: { [id]: bool }, intl: { [id]: bool } }）
    // 缺省：国服启用，国际服关闭。
    const ENABLED_KEY = 'tb-enabled';
    async function getEnabledMap() {
        return (await storage.getRaw(ENABLED_KEY, {})) || {};
    }
    function isEnabled(map, id) {
        const sub = map && (isQQ ? map.qq : map.intl);
        if (sub && Object.prototype.hasOwnProperty.call(sub, id)) {
            return sub[id] !== false;
        }
        return isQQ; // 国服默认启用，国际服默认关闭
    }

    // ── 后台消息 ──────────────────────────────────────────────────────
    async function sendBg(msg) {
        if (!extensionAlive()) return { success: false, error: 'Extension context invalidated' };
        try {
            return await chrome.runtime.sendMessage({ version, ...msg });
        } catch (e) {
            return { success: false, error: String(e && e.message || e) };
        }
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
        if (url.pathname.includes('/trade2/search/poe2/')) {
            const p = url.pathname.split('/');
            if (p.length >= 6) {
                const league = decodeURIComponent(p[4]);
                if (league) params.league = league;
                if (p[5]) params.search_id = p[5];
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

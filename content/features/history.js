// PoE2 工具箱 —— 搜索历史功能（隔离世界）
// 自动捕获国服集市搜索（POE1 /trade、POE2 /trade2），渲染成侧边栏 tab。
(function () {
    'use strict';
    const ctx = window.PoE2TB;
    if (!ctx) return;
    const { escapeHtml, truncate, formatTime } = ctx.util;

    function translateParamKey(key) {
        const t = { q: '物品', name: '名称', type: '类型', league: '联盟', search_id: 'ID', 'Search Items...': '搜索' };
        return t[key] || key;
    }

    function formatParams(params) {
        if (!params || Object.keys(params).length === 0) {
            return '<span class="tb-tag">无搜索条件</span>';
        }
        const important = [];
        if (params.league) important.push(['league', params.league]);
        if (params.search_id) important.push(['search_id', params.search_id]);
        if (important.length === 0) return '<span class="tb-tag">基础搜索</span>';
        return important.map(([k, v]) =>
            `<span class="tb-tag">${escapeHtml(translateParamKey(k))}: ${escapeHtml(truncate(v, 12))}</span>`
        ).join('');
    }

    // ── 渲染 ─────────────────────────────────────────────────────────
    let listEl = null;

    function render(history) {
        if (!listEl) return;
        if (!history.length) {
            listEl.innerHTML = '<div class="tb-empty">暂无搜索记录</div>';
            return;
        }
        const stats = `<div class="tb-stats">共 ${history.length} 条记录</div>`;
        const items = history.map((r) => `
            <div class="tb-list-item" data-url="${escapeHtml(r.url)}" data-id="${escapeHtml(r.id)}">
                <button class="tb-item-del" data-id="${escapeHtml(r.id)}" title="删除">×</button>
                <div class="tb-item-title">${escapeHtml(r.title)}</div>
                <div class="tb-item-sub">${formatTime(r.timestamp)}</div>
                <div class="tb-item-tags">${formatParams(r.params)}</div>
            </div>`).join('');
        listEl.innerHTML = stats + items;
    }

    async function load() {
        if (!listEl) return;
        const resp = await ctx.sendBg({ type: 'GET_SEARCH_HISTORY' });
        if (resp && resp.success) render(resp.data || []);
        else listEl.innerHTML = '<div class="tb-empty">加载失败</div>';
    }

    async function clear() {
        const ok = await ctx.ui.confirm('清空搜索历史', '确定要清空所有搜索历史吗？此操作不可恢复！', '清空', '取消');
        if (!ok) return;
        const resp = await ctx.sendBg({ type: 'CLEAR_SEARCH_HISTORY' });
        if (resp && resp.success) { load(); ctx.ui.toast('搜索历史已清空', 'success'); }
        else ctx.ui.toast('清空失败，请重试', 'error');
    }

    async function save() {
        const params = ctx.search.extractParams();
        if (Object.keys(params).length === 0) return;
        const id = params.search_id || (Date.now() + Math.random().toString(36).slice(2, 11));
        const record = {
            id,
            url: window.location.href,
            params,
            timestamp: new Date().toISOString(),
            title: ctx.search.smartTitle(params),
            domain: window.location.hostname,
        };
        const resp = await ctx.sendBg({ type: 'SAVE_SEARCH_RECORD', data: record });
        if (resp && resp.success) load();
    }

    // ── 捕获 ─────────────────────────────────────────────────────────
    function setupCapture() {
        let currentUrl = window.location.href;
        const observer = new MutationObserver(() => {
            if (currentUrl !== window.location.href) {
                currentUrl = window.location.href;
                setTimeout(save, 1000);
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });

        document.addEventListener('submit', () => setTimeout(save, 500));
        document.addEventListener('click', (e) => {
            const t = e.target;
            if (t.matches && t.matches('button, .btn, [role="button"]') &&
                (t.textContent.includes('搜索') || t.textContent.includes('Search'))) {
                setTimeout(save, 500);
            }
        });
        setTimeout(save, 2000); // 初次进入页面记录一次
    }

    function bindEvents() {
        listEl.addEventListener('click', async (e) => {
            const del = e.target.closest('.tb-item-del');
            if (del) {
                e.stopPropagation();
                const ok = await ctx.ui.confirm('删除记录', '确定要删除这条记录吗？', '删除', '取消');
                if (!ok) return;
                const resp = await ctx.sendBg({ type: 'DELETE_SEARCH_RECORD', id: del.dataset.id });
                if (resp && resp.success) load();
                return;
            }
            const item = e.target.closest('.tb-list-item');
            if (!item) return;
            const url = item.dataset.url;
            if (!url) return;
            if (new URL(url, location.href).href === window.location.href) {
                ctx.ui.toast('当前已在该搜索结果页面', 'warning');
                return;
            }
            window.location.href = url;
        });
    }

    function mount(panelEl) {
        panelEl.innerHTML = '<div class="tb-list tb-history-list"><div class="tb-loading">加载中…</div></div>';
        listEl = panelEl.querySelector('.tb-history-list');
        bindEvents();
        setupCapture();
        return { onShow: load, onRefresh: load, onClear: clear };
    }

    ctx.register({
        id: 'history',
        label: '搜索历史',
        icon: '🔍',
        scope: (c) => c.isQQ || c.isIntl,
        panel: true,
        mount,
    });
})();

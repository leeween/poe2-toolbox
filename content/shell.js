// PoE2 工具箱 —— 侧边栏外壳 + 功能挂载（隔离世界，最后加载）
// 职责：提供 UI 服务（toast/confirm/input）→ 注入 PoE2TB.ui；构建统一侧边栏；
//       根据每个功能的 scope() 与启用开关，挂载 panel 功能为 tab、运行 inline 功能。
(function () {
    'use strict';

    const ctx = window.PoE2TB;
    if (!ctx) return;

    // ── UI 服务：toast / confirm / input（供所有功能复用）─────────────────
    function toast(message, type = 'info', duration = 3000) {
        document.querySelector('.tb-toast')?.remove();
        const el = document.createElement('div');
        el.className = `tb-toast tb-toast-${type}`;
        const icon = { success: '✅', warning: '⚠️', error: '❌' }[type] || '💬';
        el.innerHTML = `<span class="tb-toast-icon">${icon}</span><span></span>`;
        el.lastElementChild.textContent = message;
        document.body.appendChild(el);
        requestAnimationFrame(() => el.classList.add('show'));
        setTimeout(() => {
            el.classList.remove('show');
            setTimeout(() => el.remove(), 300);
        }, duration);
    }

    function confirmDialog(title, message, confirmText = '确定', cancelText = '取消') {
        return new Promise((resolve) => {
            document.querySelector('.tb-dialog-overlay')?.remove();
            const overlay = document.createElement('div');
            overlay.className = 'tb-dialog-overlay';
            overlay.innerHTML = `
                <div class="tb-dialog">
                    <div class="tb-dialog-header"><h3></h3></div>
                    <div class="tb-dialog-body"><p class="tb-dialog-msg"></p></div>
                    <div class="tb-dialog-footer">
                        <button class="tb-btn tb-btn-secondary tb-cancel"></button>
                        <button class="tb-btn tb-btn-primary tb-confirm"></button>
                    </div>
                </div>`;
            overlay.querySelector('h3').textContent = title;
            overlay.querySelector('.tb-dialog-msg').textContent = message;
            overlay.querySelector('.tb-cancel').textContent = cancelText;
            overlay.querySelector('.tb-confirm').textContent = confirmText;
            document.body.appendChild(overlay);

            const close = (result) => {
                overlay.remove();
                document.removeEventListener('keydown', onKey);
                resolve(result);
            };
            const onKey = (e) => {
                if (e.key === 'Escape') close(false);
                else if (e.key === 'Enter') close(true);
            };
            overlay.querySelector('.tb-cancel').addEventListener('click', () => close(false));
            overlay.querySelector('.tb-confirm').addEventListener('click', () => close(true));
            overlay.addEventListener('click', (e) => { if (e.target === overlay) close(false); });
            document.addEventListener('keydown', onKey);
            setTimeout(() => overlay.querySelector('.tb-confirm').focus(), 50);
        });
    }

    function inputDialog(title, label, defaultValue = '', placeholder = '') {
        return new Promise((resolve) => {
            document.querySelector('.tb-dialog-overlay')?.remove();
            const overlay = document.createElement('div');
            overlay.className = 'tb-dialog-overlay';
            overlay.innerHTML = `
                <div class="tb-dialog">
                    <div class="tb-dialog-header"><h3></h3></div>
                    <div class="tb-dialog-body">
                        <label class="tb-dialog-label"></label>
                        <input type="text" class="tb-dialog-input">
                    </div>
                    <div class="tb-dialog-footer">
                        <button class="tb-btn tb-btn-secondary tb-cancel">取消</button>
                        <button class="tb-btn tb-btn-primary tb-confirm">确定</button>
                    </div>
                </div>`;
            overlay.querySelector('h3').textContent = title;
            overlay.querySelector('.tb-dialog-label').textContent = label;
            const input = overlay.querySelector('.tb-dialog-input');
            input.value = defaultValue;
            input.placeholder = placeholder;
            document.body.appendChild(overlay);

            const close = (result) => { overlay.remove(); resolve(result); };
            const submit = () => { const v = input.value.trim(); close(v || null); };
            overlay.querySelector('.tb-cancel').addEventListener('click', () => close(null));
            overlay.querySelector('.tb-confirm').addEventListener('click', submit);
            overlay.addEventListener('click', (e) => { if (e.target === overlay) close(null); });
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') submit();
                else if (e.key === 'Escape') close(null);
            });
            setTimeout(() => { input.focus(); if (defaultValue) input.select(); }, 50);
        });
    }

    ctx.ui = { toast, confirm: confirmDialog, input: inputDialog };

    // ── 侧边栏构建 ───────────────────────────────────────────────────
    let panelEl = null;
    let toggleEl = null;
    const tabs = new Map(); // id -> { btn, panel, handle, feature }
    let currentTabId = null;
    let tooltipEl = null;
    let tooltipTimer = null;

    function showTabTooltip(btn, label) {
        clearTimeout(tooltipTimer);
        tooltipTimer = setTimeout(() => {
            if (!tooltipEl) {
                tooltipEl = document.createElement('div');
                tooltipEl.className = 'tb-tab-tooltip';
                document.body.appendChild(tooltipEl);
            }
            tooltipEl.textContent = label;
            const r = btn.getBoundingClientRect();
            tooltipEl.style.top = `${r.bottom + 6}px`;
            tooltipEl.style.left = `${r.left + r.width / 2}px`;
            tooltipEl.classList.add('show');
        }, 120);
    }

    function hideTabTooltip() {
        clearTimeout(tooltipTimer);
        if (tooltipEl) tooltipEl.classList.remove('show');
    }

    function buildPanel(panelFeatures) {
        panelEl = document.createElement('div');
        panelEl.id = 'tb-panel';
        panelEl.innerHTML = `
            <div class="tb-header">
                <div class="tb-title"><span class="tb-logo">⚖</span><span>PoE2 工具箱</span></div>
                <div class="tb-header-actions">
                    <button class="tb-icon-btn tb-refresh" title="刷新">↻</button>
                    <button class="tb-icon-btn tb-clear" title="清空">🗑</button>
                    <button class="tb-icon-btn tb-settings" title="设置">⚙</button>
                </div>
            </div>
            <div class="tb-tabs"></div>
            <div class="tb-body"></div>`;

        toggleEl = document.createElement('div');
        toggleEl.id = 'tb-toggle';
        toggleEl.textContent = '◄';
        toggleEl.title = '收起 / 展开';

        document.body.appendChild(panelEl);
        document.body.appendChild(toggleEl);
        document.body.classList.add('tb-active');

        const tabsBar = panelEl.querySelector('.tb-tabs');
        const body = panelEl.querySelector('.tb-body');

        panelFeatures.forEach((feature) => {
            const btn = document.createElement('button');
            btn.className = 'tb-tab-btn';
            btn.dataset.tab = feature.id;
            btn.dataset.label = feature.label;
            btn.textContent = feature.icon || feature.label;
            btn.addEventListener('click', () => switchTab(feature.id));
            btn.addEventListener('mouseenter', () => showTabTooltip(btn, feature.label));
            btn.addEventListener('mouseleave', hideTabTooltip);
            btn.addEventListener('focus', () => showTabTooltip(btn, feature.label));
            btn.addEventListener('blur', hideTabTooltip);
            tabsBar.appendChild(btn);

            const panel = document.createElement('div');
            panel.className = 'tb-tab-panel';
            panel.dataset.tab = feature.id;
            body.appendChild(panel);

            let handle = null;
            try { handle = feature.mount(panel, ctx) || {}; }
            catch (e) { console.error('[PoE2TB] 功能挂载失败:', feature.id, e); handle = {}; }
            tabs.set(feature.id, { btn, panel, handle, feature });
        });

        // 事件
        panelEl.querySelector('.tb-refresh').addEventListener('click', () => activeHandle()?.onRefresh?.());
        panelEl.querySelector('.tb-clear').addEventListener('click', () => activeHandle()?.onClear?.());
        panelEl.querySelector('.tb-settings').addEventListener('click', () => ctx.sendBg({ type: 'OPEN_OPTIONS' }));
        toggleEl.addEventListener('click', togglePanel);
    }

    function activeHandle() {
        return currentTabId ? tabs.get(currentTabId)?.handle : null;
    }

    function switchTab(id) {
        if (!tabs.has(id)) return;
        currentTabId = id;
        for (const [tid, t] of tabs) {
            const on = tid === id;
            t.btn.classList.toggle('active', on);
            t.panel.classList.toggle('active', on);
        }
        // 清空按钮按能力显隐
        const h = tabs.get(id).handle;
        panelEl.querySelector('.tb-clear').style.display = h && h.onClear ? '' : 'none';
        try { h?.onShow?.(); } catch (e) { console.error(e); }
        ctx.storage.set('last-tab', id);
    }

    async function togglePanel() {
        const collapsed = panelEl.classList.toggle('collapsed');
        document.body.classList.toggle('tb-collapsed', collapsed);
        toggleEl.textContent = collapsed ? '►' : '◄';
        ctx.storage.set('panel-collapsed', collapsed);
    }

    async function restoreState(firstTabId) {
        // tab
        let lastTab = firstTabId;
        try {
            const saved = await ctx.storage.get('last-tab', null);
            if (saved && tabs.has(saved)) lastTab = saved;
        } catch (e) { /* ignore */ }
        switchTab(lastTab);
        // collapsed
        try {
            const collapsed = await ctx.storage.get('panel-collapsed', false);
            if (collapsed) {
                panelEl.classList.add('collapsed');
                document.body.classList.add('tb-collapsed');
                toggleEl.textContent = '►';
            }
        } catch (e) { /* ignore */ }
    }

    // ── 初始化 ───────────────────────────────────────────────────────
    let inited = false;
    async function init() {
        if (inited) return;
        inited = true;

        const enabledMap = await ctx.getEnabledMap();
        const active = ctx._features.filter((f) => {
            try { if (f.scope && !f.scope(ctx)) return false; } catch (e) { return false; }
            return ctx.isEnabled(enabledMap, f.id);
        });
        if (active.length === 0) return;

        // 内联功能
        active.filter((f) => !f.panel).forEach((f) => {
            try { f.init?.(ctx); } catch (e) { console.error('[PoE2TB] 内联功能失败:', f.id, e); }
        });

        // 面板功能
        const panelFeatures = active.filter((f) => f.panel);
        if (panelFeatures.length > 0) {
            buildPanel(panelFeatures);
            await restoreState(panelFeatures[0].id);
        }
    }

    // 来自后台（点击插件图标）的开合消息
    chrome.runtime.onMessage.addListener((req) => {
        if (req && req.type === 'TOGGLE_PANEL') {
            if (panelEl) togglePanel();
            else init();
        }
    });

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();

// PoE2 工具箱 —— 国际服集市繁体中文化控制面板（隔离世界）
(function () {
    'use strict';
    const ctx = window.PoE2TB;
    if (!ctx) return;

    const TW_ENABLED_KEY = 'poe2tb_tw_enabled';

    function isTwActive() {
        return localStorage.getItem(TW_ENABLED_KEY) !== '0';
    }

    async function toggleTw() {
        const next = isTwActive() ? '0' : '1';
        localStorage.setItem(TW_ENABLED_KEY, next);
        try {
            const enabledMap = await ctx.getEnabledMap();
            if (!enabledMap.intl) enabledMap.intl = {};
            enabledMap.intl['trade-tw'] = next === '1';
            await ctx.storage.setRaw('tb-enabled', enabledMap);
        } catch (e) {}
        for (const k of ['lscache-trade2data', 'lscache-trade2items', 'lscache-trade2stats', 'lscache-trade2filters', 'poe2tb_tw_dataMap']) {
            localStorage.removeItem(k);
        }
        location.reload();
    }

    function clearCacheAndReload() {
        for (const k of ['lscache-trade2data', 'lscache-trade2items', 'lscache-trade2stats', 'lscache-trade2filters', 'poe2tb_tw_dataMap']) {
            localStorage.removeItem(k);
        }
        location.reload();
    }

    function render(container) {
        const active = isTwActive();
        container.innerHTML = `
            <div style="padding: 16px; display: flex; flex-direction: column; gap: 16px;">
                <div style="background: var(--tb-bg2); border: 1px solid var(--tb-line); border-radius: 8px; padding: 14px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                        <span style="font-weight: 600; color: var(--tb-gold-bright); font-size: 14px;">繁中汉化状态</span>
                        <span style="font-size: 12px; padding: 2px 8px; border-radius: 12px; ${active ? 'background: rgba(46, 204, 113, 0.15); color: #2ecc71;' : 'background: rgba(231, 76, 60, 0.15); color: #e74c3c;'}">
                            ${active ? '● 已启用' : '○ 已关闭'}
                        </span>
                    </div>
                    <div style="color: var(--tb-text-dim); font-size: 12px; line-height: 1.5; margin-bottom: 12px;">
                        自动将国际服集市的所有物品基底、属性、词缀、天赋树配置描述（如妄想症天赋详情）及筛选列表翻译为繁体中文。
                    </div>
                    <button class="tb-btn ${active ? 'tb-btn-secondary' : 'tb-btn-primary'}" id="tb-tw-toggle-btn" style="width: 100%;">
                        ${active ? '取消繁体化（切换为原版英文）' : '开启繁体化（刷新生效）'}
                    </button>
                </div>

                <div style="background: var(--tb-bg2); border: 1px solid var(--tb-line); border-radius: 8px; padding: 14px;">
                    <div style="font-weight: 600; color: var(--tb-gold-bright); font-size: 14px; margin-bottom: 8px;">快捷操作</div>
                    <div style="display: flex; flex-direction: column; gap: 10px;">
                        <button class="tb-btn tb-action-btn" id="tb-tw-clear-btn" style="text-align: left; padding: 10px;">
                            <div style="font-weight: 500;">🗑 清理集市缓存并刷新</div>
                            <div style="font-size: 11px; color: var(--tb-text-dim); margin-top: 2px;">若新赛季更新或部分词条未翻译，点击重置官方本地缓存</div>
                        </button>
                    </div>
                </div>

                <div style="background: var(--tb-bg2); border: 1px solid var(--tb-line); border-radius: 8px; padding: 14px; color: var(--tb-text-dim); font-size: 12px; line-height: 1.6;">
                    <div style="font-weight: 600; color: var(--tb-gold); margin-bottom: 6px;">💡 说明与提示</div>
                    <div>1. 繁体化直接在网络响应层改写，不影响网页原有响应速度与交互。</div>
                    <div>2. 「复制 PoB」功能受独立保护，即便开启繁体化，点击复制依然导出 100% 标准纯英文文本。</div>
                    <div>3. 开关完全由本插件控制，取消繁体化后彻底恢复为官方原生英文。</div>
                </div>
            </div>
        `;

        container.querySelector('#tb-tw-toggle-btn')?.addEventListener('click', () => {
            toggleTw();
        });

        container.querySelector('#tb-tw-clear-btn')?.addEventListener('click', async () => {
            const ok = await ctx.ui.confirm('清理集市缓存', '确定清理集市本地缓存并立即重新加载页面吗？', '清理并刷新', '取消');
            if (ok) clearCacheAndReload();
        });
    }

    function mount(panelEl) {
        render(panelEl);
        return {
            onShow() { render(panelEl); },
            onRefresh() { render(panelEl); }
        };
    }

    ctx.register({
        id: 'trade-tw',
        label: '繁中汉化',
        icon: '🌐',
        scope: (c) => c.isIntl && c.version === 'poe2',
        panel: true,
        mount,
    });
})();

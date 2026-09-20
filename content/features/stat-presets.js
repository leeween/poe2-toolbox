// PoE2 工具箱 —— 词缀搜索预设管理（隔离世界）
(function () {
    'use strict';
    const ctx = window.PoE2TB;
    if (!ctx) return;
    const { escapeHtml } = ctx.util;

    const PRESETS_STORAGE_KEY = 'poe2tb_saved_stat_presets';

    function getPresets() {
        try {
            const raw = localStorage.getItem(PRESETS_STORAGE_KEY);
            return raw ? JSON.parse(raw) : [];
        } catch (e) {
            return [];
        }
    }

    function savePresets(list) {
        try {
            localStorage.setItem(PRESETS_STORAGE_KEY, JSON.stringify(list));
        } catch (e) {}
    }

    let listEl = null;

    function applyPreset(preset) {
        if (!preset || !preset.query) return;
        window.postMessage({ __poe2tb_apply_preset: true, query: preset.query }, '*');
        ctx.ui.toast(`已应用预设：${preset.name}`, 'success');
    }

    async function deletePreset(name) {
        const ok = await ctx.ui.confirm('删除预设', `确定删除预设「${name}」吗？`, '删除', '取消');
        if (!ok) return;
        const next = getPresets().filter(p => p.name !== name);
        savePresets(next);
        render();
        ctx.ui.toast(`已删除预设：${name}`, 'info');
    }

    async function clearAllPresets() {
        const ok = await ctx.ui.confirm('清空所有预设', '确定清空所有已保存的词缀预设吗？此操作不可恢复！', '清空', '取消');
        if (!ok) return;
        savePresets([]);
        render();
        ctx.ui.toast('已清空所有预设', 'info');
    }

    async function exportPresets() {
        const list = getPresets();
        if (!list.length) {
            ctx.ui.toast('暂无可导出的预设', 'warning');
            return;
        }
        const json = JSON.stringify(list, null, 2);
        try {
            await navigator.clipboard.writeText(json);
            ctx.ui.toast('预设 JSON 已复制到剪贴板', 'success');
        } catch (e) {
            prompt('复制以下预设 JSON：', json);
        }
    }

    async function importPresets() {
        const text = await ctx.ui.input('导入预设', '粘贴预设 JSON 数组：', '', '[{"name": "...", "query": {...}}]');
        if (!text || !text.trim()) return;
        try {
            const parsed = JSON.parse(text.trim());
            if (!Array.isArray(parsed)) {
                ctx.ui.toast('导入失败：内容必须为 JSON 数组', 'error');
                return;
            }
            const current = getPresets();
            let count = 0;
            parsed.forEach(item => {
                if (item && item.name && item.query) {
                    const idx = current.findIndex(p => p.name === item.name);
                    if (idx !== -1) current[idx] = item;
                    else current.push(item);
                    count++;
                }
            });
            savePresets(current);
            render();
            ctx.ui.toast(`成功导入 ${count} 个预设`, 'success');
        } catch (e) {
            ctx.ui.toast('导入失败：无效的 JSON 格式', 'error');
        }
    }

    function render() {
        if (!listEl) return;
        const list = getPresets();

        const statsHtml = `
            <div style="padding: 12px 16px; border-bottom: 1px solid var(--tb-line); display: flex; justify-content: space-between; align-items: center;">
                <span style="font-size: 12px; color: var(--tb-text-dim);">已保存 <b>${list.length}</b> 个预设</span>
                <div style="display: flex; gap: 8px;">
                    <button class="tb-btn tb-btn-secondary" id="tb-presets-import" style="padding: 3px 8px; font-size: 11px;">导入</button>
                    <button class="tb-btn tb-btn-secondary" id="tb-presets-export" style="padding: 3px 8px; font-size: 11px;">导出</button>
                </div>
            </div>
        `;

        if (!list.length) {
            listEl.innerHTML = statsHtml + `
                <div class="tb-empty" style="padding: 32px 16px;">
                    <div style="font-size: 24px; margin-bottom: 8px;">📋</div>
                    <div>暂无保存的词缀预设</div>
                    <div style="font-size: 11px; color: var(--tb-text-dim); margin-top: 6px; line-height: 1.5;">
                        在市集高级筛选面板中配置好词缀组后，<br>点击词缀组旁边的「保存预设」即可加入此处。
                    </div>
                </div>
            `;
            bindHeaderEvents();
            return;
        }

        const itemsHtml = list.map((item, index) => {
            const filterCount = (item.query && item.query.filters && item.query.filters.length) || 0;
            const typeText = item.query && item.query.type === 'weight' ? '权重筛选' : '常规筛选';
            return `
                <div class="tb-list-item" style="padding: 10px 14px; border-bottom: 1px solid var(--tb-line); display: flex; flex-direction: column; gap: 6px;">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <span style="font-weight: 600; color: var(--tb-gold-bright); font-size: 13px;">${escapeHtml(item.name)}</span>
                        <div style="display: flex; gap: 6px;">
                            <button class="tb-btn tb-btn-primary tb-preset-apply" data-index="${index}" style="padding: 3px 10px; font-size: 11px;">填入</button>
                            <button class="tb-btn tb-btn-secondary tb-preset-del" data-name="${escapeHtml(item.name)}" style="padding: 3px 8px; font-size: 11px; color: var(--tb-danger);" title="删除">×</button>
                        </div>
                    </div>
                    <div style="display: flex; gap: 8px; font-size: 11px; color: var(--tb-text-dim);">
                        <span>类型: ${typeText}</span>
                        <span>·</span>
                        <span>包含词条: ${filterCount} 条</span>
                    </div>
                </div>
            `;
        }).join('');

        listEl.innerHTML = statsHtml + `<div style="overflow-y: auto; flex: 1;">${itemsHtml}</div>`;
        bindHeaderEvents();

        listEl.querySelectorAll('.tb-preset-apply').forEach(btn => {
            btn.addEventListener('click', () => {
                const idx = Number(btn.dataset.index);
                applyPreset(list[idx]);
            });
        });

        listEl.querySelectorAll('.tb-preset-del').forEach(btn => {
            btn.addEventListener('click', () => {
                const name = btn.dataset.name;
                deletePreset(name);
            });
        });
    }

    function bindHeaderEvents() {
        listEl.querySelector('#tb-presets-export')?.addEventListener('click', exportPresets);
        listEl.querySelector('#tb-presets-import')?.addEventListener('click', importPresets);
    }

    function mount(panelEl) {
        panelEl.innerHTML = '<div class="tb-presets-panel" style="display: flex; flex-direction: column; height: 100%;"></div>';
        listEl = panelEl.querySelector('.tb-presets-panel');
        render();
        return {
            onShow: render,
            onRefresh: render,
            onClear: clearAllPresets
        };
    }

    ctx.register({
        id: 'stat-presets',
        label: '词缀预设',
        icon: '⚡',
        scope: (c) => c.isIntl && c.version === 'poe2',
        panel: true,
        mount,
    });
})();

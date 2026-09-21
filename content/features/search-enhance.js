// PoE2 工具箱 —— 搜索加强功能（隔离世界）
// 整合：1. 国际服繁体中文化控制（带实时刷新重载）
//       2. 自定义预设综合选项管理（支持 count/weight/and/not/if 类型、数值范围配置、网页端即时同步与一键填入）
(function () {
    'use strict';
    const ctx = window.PoE2TB;
    if (!ctx) return;
    const { escapeHtml } = ctx.util;

    const TW_ENABLED_KEY = 'poe2tb_tw_enabled';
    const PRESETS_STORAGE_KEY = 'poe2tb_saved_stat_presets';

    // ── 1) 繁体汉化控制（国际服）────────────────────────────────────────
    function isTwActive() {
        return localStorage.getItem(TW_ENABLED_KEY) !== '0';
    }

    function toggleTw() {
        const next = isTwActive() ? '0' : '1';
        localStorage.setItem(TW_ENABLED_KEY, next);
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

    // ── 2) 预设存储管理 ──────────────────────────────────────────────────
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
            window.postMessage({ __poe2tb_presets_updated: true }, '*');
        } catch (e) {}
    }

    function applyPreset(preset) {
        if (!preset || !preset.query) return;
        window.postMessage({ __poe2tb_apply_preset: true, query: preset.query }, '*');
        ctx.ui.toast(`已填入预设：${preset.name}`, 'success');
    }

    // 监听网络捕获脚本广播的最新 trade2 search query
    let latestCapturedQuery = null;
    window.addEventListener('message', (e) => {
        if (e.source !== window || !e.data) return;
        if (e.data.__poe2tb_search_query && e.data.query) {
            latestCapturedQuery = e.data.query;
        }
    });

    // ── 3) 跨世界获取页面当前词缀组 ──────────────────────────────────────
    function fetchCurrentStatsFromPage() {
        return new Promise((resolve) => {
            const reqId = 'req_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
            const handler = (e) => {
                if (e.source !== window || !e.data || !e.data.__poe2tb_current_stats_reply) return;
                if (e.data.requestId === reqId) {
                    window.removeEventListener('message', handler);
                    clearTimeout(timer);
                    resolve({
                        stats: e.data.stats || [],
                        statTextMap: e.data.statTextMap || {}
                    });
                }
            };
            window.addEventListener('message', handler);
            const timer = setTimeout(() => {
                window.removeEventListener('message', handler);
                resolve({ stats: [], statTextMap: {} });
            }, 1200);

            window.postMessage({ __poe2tb_get_current_stats: true, requestId: reqId }, '*');
        });
    }

    // 在隔离世界直接从 DOM 提取当前词缀组（终极兜底机制）
    function extractStatsFromDOMDirect() {
        const groups = [];
        const groupEls = document.querySelectorAll('.filter-group');
        if (!groupEls || !groupEls.length) return groups;

        groupEls.forEach(groupEl => {
            let type = 'and';
            const typeText = groupEl.querySelector('.filter-group-header .multiselect__single, .filter-group-select, .multiselect')?.textContent || '';
            const lowerTypeText = typeText.toLowerCase();
            if (lowerTypeText.includes('weight') || typeText.includes('加权')) type = 'weight';
            else if (lowerTypeText.includes('count') || typeText.includes('计数')) type = 'count';
            else if (lowerTypeText.includes('not') || typeText.includes('非')) type = 'not';
            else if (lowerTypeText.includes('if') || typeText.includes('条件')) type = 'if';
            else if (lowerTypeText.includes('and') || typeText.includes('全部')) type = 'and';

            const valObj = {};
            const headerInputs = groupEl.querySelectorAll('.filter-group-header input');
            headerInputs.forEach(inp => {
                const p = (inp.getAttribute('placeholder') || '').toLowerCase();
                const cls = (inp.className || '').toLowerCase();
                const v = inp.value.trim();
                if (v !== '') {
                    if (p.includes('min') || cls.includes('min')) valObj.min = Number(v);
                    else if (p.includes('max') || cls.includes('max')) valObj.max = Number(v);
                    else if (valObj.min == null) valObj.min = Number(v);
                    else if (valObj.max == null) valObj.max = Number(v);
                }
            });

            const filters = [];
            const rowEls = groupEl.querySelectorAll('.filter, .filter-body .filter-line, .filter-group-body > div');
            rowEls.forEach(row => {
                const textEl = row.querySelector('.multiselect__single, .multiselect__tags, .filter-title, .selected-item');
                const filterText = textEl ? textEl.textContent.replace(/\s+/g, ' ').trim() : '';
                if (!filterText) return;

                const filterVal = {};
                const inputs = row.querySelectorAll('input:not([type="checkbox"])');
                inputs.forEach(inp => {
                    const p = (inp.getAttribute('placeholder') || '').toLowerCase();
                    const v = inp.value.trim();
                    if (v !== '') {
                        if (type === 'weight' || p.includes('weight') || p.includes('权重')) {
                            filterVal.weight = Number(v);
                        } else if (p.includes('min')) {
                            filterVal.min = Number(v);
                        } else if (p.includes('max')) {
                            filterVal.max = Number(v);
                        } else if (type === 'weight' && filterVal.weight == null) {
                            filterVal.weight = Number(v);
                        }
                    }
                });

                filters.push({
                    id: `custom.${filterText}`,
                    text: filterText,
                    value: filterVal,
                    disabled: false
                });
            });

            if (filters.length > 0 || Object.keys(valObj).length > 0) {
                groups.push({
                    type: type,
                    value: valObj,
                    filters: filters,
                    disabled: false
                });
            }
        });

        return groups;
    }

    // ── 4) UI 渲染与状态 ─────────────────────────────────────────────────
    let listEl = null;
    let editingPreset = null; // null 表示新建或无，非空表示正在编辑的对象
    let formFilters = [];     // 当前表单编辑中的词条列表

    function formatTypeLabel(type) {
        const map = {
            count: '计数 (Count)',
            weight: '加权 (Weighted Sum)',
            and: '全部 (And)',
            not: '非 (Not)',
            if: '条件 (If)'
        };
        return map[type] || type || '全部 (And)';
    }

    function formatTypeShort(type) {
        const map = {
            count: '计数',
            weight: '加权求和',
            and: '全部',
            not: '非',
            if: '条件'
        };
        return map[type] || type || '全部';
    }

    function renderForm() {
        const isEdit = !!editingPreset;
        const q = editingPreset && editingPreset.query ? editingPreset.query : {};
        const curType = q.type || 'count';
        const curVal = q.value || {};
        const minVal = curVal.min != null ? curVal.min : (curType === 'count' ? 2 : (curType === 'weight' ? 1 : ''));
        const maxVal = curVal.max != null ? curVal.max : '';

        const filtersListHtml = formFilters.map((f, idx) => {
            const label = f.text || f.id;
            const wVal = f.value && f.value.weight != null ? f.value.weight : '';
            return `
                <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 6px 8px; background: #16161c; border: 1px solid var(--tb-line); border-radius: 4px; font-size: 11px;">
                    <div style="flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${escapeHtml(label)} (${escapeHtml(f.id)})">
                        <span style="color: var(--tb-gold-bright);">${escapeHtml(label)}</span>
                    </div>
                    ${curType === 'weight' ? `
                        <div style="display: flex; align-items: center; gap: 4px;">
                            <span style="color: var(--tb-text-dim); font-size: 10px;">权重:</span>
                            <input type="number" class="tb-filter-weight-input" data-index="${idx}" value="${escapeHtml(wVal)}" placeholder="1" style="width: 44px; padding: 2px 4px; background: #1f1f28; border: 1px solid var(--tb-line); border-radius: 3px; color: #fff; font-size: 11px; text-align: center;">
                        </div>
                    ` : ''}
                    <button class="tb-filter-remove-btn" data-index="${idx}" style="background: none; border: none; color: var(--tb-danger); cursor: pointer; font-size: 13px; line-height: 1; padding: 0 4px;" title="移除此词条">×</button>
                </div>
            `;
        }).join('');

        return `
            <div id="tb-preset-form-card" style="background: var(--tb-bg2); border: 1px solid var(--tb-gold); border-radius: 8px; padding: 14px; margin-bottom: 12px; display: flex; flex-direction: column; gap: 10px;">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <span style="font-weight: 600; color: var(--tb-gold-bright); font-size: 13px;">
                        ${isEdit ? `✏️ 编辑预设：${escapeHtml(editingPreset.name)}` : '✨ 新建自定义预设'}
                    </span>
                    <button id="tb-form-cancel-top" style="background: none; border: none; color: var(--tb-text-dim); cursor: pointer; font-size: 16px; line-height: 1;">×</button>
                </div>

                <div>
                    <label style="display: block; font-size: 11px; color: var(--tb-text-dim); margin-bottom: 4px;">预设名称</label>
                    <input type="text" id="tb-form-name" value="${escapeHtml(editingPreset ? editingPreset.name : '')}" placeholder="例如：石板稀有怪物、攻击爆伤权重..." style="width: 100%; box-sizing: border-box; padding: 6px 10px; background: #16161c; border: 1px solid var(--tb-line); border-radius: 4px; color: #e8e3d6; font-size: 12px;">
                </div>

                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
                    <div>
                        <label style="display: block; font-size: 11px; color: var(--tb-text-dim); margin-bottom: 4px;">筛选组类型</label>
                        <select id="tb-form-type" style="width: 100%; box-sizing: border-box; padding: 6px 8px; background: #16161c; border: 1px solid var(--tb-line); border-radius: 4px; color: #e8e3d6; font-size: 12px;">
                            <option value="count" ${curType === 'count' ? 'selected' : ''}>计数 (Count)</option>
                            <option value="weight" ${curType === 'weight' ? 'selected' : ''}>加权求和 (Weighted Sum)</option>
                            <option value="and" ${curType === 'and' ? 'selected' : ''}>全部 (And)</option>
                            <option value="not" ${curType === 'not' ? 'selected' : ''}>非 (Not)</option>
                            <option value="if" ${curType === 'if' ? 'selected' : ''}>条件 (If)</option>
                        </select>
                    </div>
                    <div>
                        <label style="display: block; font-size: 11px; color: var(--tb-text-dim); margin-bottom: 4px;">数值要求 (Min / Max)</label>
                        <div style="display: flex; gap: 6px; align-items: center;">
                            <input type="number" id="tb-form-min" value="${minVal !== '' ? escapeHtml(minVal) : ''}" placeholder="Min 最小" style="width: 50%; box-sizing: border-box; padding: 6px 6px; background: #16161c; border: 1px solid var(--tb-line); border-radius: 4px; color: #e8e3d6; font-size: 12px; text-align: center;">
                            <input type="number" id="tb-form-max" value="${maxVal !== '' ? escapeHtml(maxVal) : ''}" placeholder="Max 最大" style="width: 50%; box-sizing: border-box; padding: 6px 6px; background: #16161c; border: 1px solid var(--tb-line); border-radius: 4px; color: #e8e3d6; font-size: 12px; text-align: center;">
                        </div>
                    </div>
                </div>

                <div style="border-top: 1px dashed var(--tb-line); padding-top: 8px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                        <span style="font-size: 12px; font-weight: 500; color: var(--tb-text-dim);">
                            包含词条列表 (${formFilters.length} 条)
                        </span>
                        <button id="tb-form-grab-btn" class="tb-btn tb-btn-secondary" style="padding: 2px 8px; font-size: 11px;">
                            📥 从当前集市抓取词缀
                        </button>
                    </div>

                    ${formFilters.length > 0 ? `
                        <div style="display: flex; flex-direction: column; gap: 4px; max-height: 140px; overflow-y: auto; padding-right: 2px;">
                            ${filtersListHtml}
                        </div>
                    ` : `
                        <div style="background: #16161c; border: 1px solid var(--tb-line); border-radius: 4px; padding: 12px; text-align: center; color: var(--tb-text-dim); font-size: 11px; line-height: 1.5;">
                            暂未添加词条。<br>
                            可在集市网页添加词缀后，点击上方<b>「从当前集市抓取词缀」</b>快速载入。
                        </div>
                    `}
                </div>

                <div style="display: flex; justify-content: flex-end; gap: 8px; margin-top: 4px;">
                    <button id="tb-form-cancel-btn" class="tb-btn tb-btn-secondary" style="padding: 5px 12px; font-size: 12px;">取消</button>
                    <button id="tb-form-save-btn" class="tb-btn tb-btn-primary" style="padding: 5px 14px; font-size: 12px; font-weight: 600;">保存预设</button>
                </div>
            </div>
        `;
    }

    function render(container) {
        if (!container) return;
        const active = isTwActive();
        const list = getPresets();

        // 1) 国际服繁体中文卡片（仅国际服展示）
        const twCardHtml = ctx.isIntl ? `
            <div style="background: var(--tb-bg2); border: 1px solid var(--tb-line); border-radius: 8px; padding: 12px; margin-bottom: 12px;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                    <span style="font-weight: 600; color: var(--tb-gold-bright); font-size: 13px;">🌐 国际服繁体汉化</span>
                    <span style="font-size: 11px; padding: 2px 6px; border-radius: 10px; ${active ? 'background: rgba(46, 204, 113, 0.15); color: #2ecc71;' : 'background: rgba(231, 76, 60, 0.15); color: #e74c3c;'}">
                        ${active ? '● 已启用' : '○ 已关闭'}
                    </span>
                </div>
                <div style="color: var(--tb-text-dim); font-size: 11px; line-height: 1.4; margin-bottom: 10px;">
                    自动改写国际服物品属性、词缀及筛选列表为繁体中文。切换或清理缓存均会自动重新加载页面生效。
                </div>
                <div style="display: flex; gap: 8px;">
                    <button class="tb-btn ${active ? 'tb-btn-secondary' : 'tb-btn-primary'}" id="tb-tw-toggle-btn" style="flex: 1; padding: 6px 10px; font-size: 12px;">
                        ${active ? '切换为原版英文 (刷新)' : '开启繁体汉化 (刷新)'}
                    </button>
                    <button class="tb-btn tb-btn-secondary" id="tb-tw-clear-btn" style="padding: 6px 10px; font-size: 11px;" title="重置集市官方本地缓存并刷新">
                        🗑 重置缓存
                    </button>
                </div>
            </div>
        ` : '';

        // 2) 预设管理顶部栏
        const presetsHeaderHtml = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; padding: 0 2px;">
                <div style="display: flex; align-items: baseline; gap: 6px;">
                    <span style="font-weight: 600; color: var(--tb-gold-bright); font-size: 13px;">⚡ 预设综合选项</span>
                    <span style="font-size: 11px; color: var(--tb-text-dim);">(${list.length} 个)</span>
                </div>
                <div style="display: flex; gap: 6px;">
                    <button class="tb-btn tb-btn-primary" id="tb-presets-add-btn" style="padding: 3px 8px; font-size: 11px;">+ 新建预设</button>
                    <button class="tb-btn tb-btn-secondary" id="tb-presets-import" style="padding: 3px 6px; font-size: 11px;">导入</button>
                    <button class="tb-btn tb-btn-secondary" id="tb-presets-export" style="padding: 3px 6px; font-size: 11px;">导出</button>
                </div>
            </div>
        `;

        // 3) 预设列表
        let listBodyHtml = '';
        if (!list.length && !editingPreset) {
            listBodyHtml = `
                <div class="tb-empty" style="padding: 24px 12px; background: var(--tb-bg2); border: 1px dashed var(--tb-line); border-radius: 8px;">
                    <div style="font-size: 24px; margin-bottom: 6px;">📋</div>
                    <div style="font-weight: 500;">暂无自定义预设</div>
                    <div style="font-size: 11px; color: var(--tb-text-dim); margin-top: 6px; line-height: 1.5;">
                        点击右上角<b>「+ 新建预设」</b>配置自定义综合选项（如石板稀有怪、爆伤等），保存后可在集市筛选区的下拉框中直接选择！
                    </div>
                </div>
            `;
        } else {
            const itemsHtml = list.map((item, index) => {
                const q = item.query || {};
                const typeText = formatTypeShort(q.type || item.type);
                const filterCount = (q.filters && q.filters.length) || 0;
                let valBadge = '';
                if (q.value) {
                    if (q.value.min != null && q.value.min !== '') valBadge += ` min:${q.value.min}`;
                    if (q.value.max != null && q.value.max !== '') valBadge += ` max:${q.value.max}`;
                }

                return `
                    <div class="tb-list-item" style="padding: 10px 12px; border-radius: 6px; margin-bottom: 6px; display: flex; flex-direction: column; gap: 6px; background: var(--tb-bg2); border: 1px solid var(--tb-line);">
                        <div style="display: flex; justify-content: space-between; align-items: center;">
                            <div style="display: flex; align-items: center; gap: 6px; overflow: hidden;">
                                <span style="font-weight: 600; color: var(--tb-gold-bright); font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                                    ${escapeHtml(item.name)}
                                </span>
                                <span style="font-size: 10px; padding: 1px 5px; border-radius: 4px; background: rgba(232, 201, 135, 0.12); color: var(--tb-gold); border: 1px solid rgba(232, 201, 135, 0.25); white-space: nowrap;">
                                    ${typeText}${valBadge}
                                </span>
                            </div>
                            <div style="display: flex; gap: 5px;">
                                <button class="tb-btn tb-btn-primary tb-preset-apply" data-index="${index}" style="padding: 2px 8px; font-size: 11px;">填入</button>
                                <button class="tb-btn tb-btn-secondary tb-preset-edit" data-index="${index}" style="padding: 2px 6px; font-size: 11px;">编辑</button>
                                <button class="tb-btn tb-btn-secondary tb-preset-del" data-name="${escapeHtml(item.name)}" style="padding: 2px 6px; font-size: 11px; color: var(--tb-danger);" title="删除">×</button>
                            </div>
                        </div>
                        <div style="display: flex; justify-content: space-between; align-items: center; font-size: 11px; color: var(--tb-text-dim);">
                            <span>包含词条: <b>${filterCount}</b> 条</span>
                            <span style="font-size: 10px; color: #7a7670;">已联动集市下拉框</span>
                        </div>
                    </div>
                `;
            }).join('');
            listBodyHtml = `<div style="overflow-y: auto; flex: 1;">${itemsHtml}</div>`;
        }

        container.innerHTML = `
            <div style="padding: 12px; display: flex; flex-direction: column; height: 100%; box-sizing: border-box; overflow-y: auto;">
                ${twCardHtml}
                ${presetsHeaderHtml}
                ${editingPreset !== null ? renderForm() : ''}
                ${listBodyHtml}
            </div>
        `;

        bindEvents(container);
    }

    function bindEvents(container) {
        // 繁体开关与清理
        container.querySelector('#tb-tw-toggle-btn')?.addEventListener('click', toggleTw);
        container.querySelector('#tb-tw-clear-btn')?.addEventListener('click', async () => {
            const ok = await ctx.ui.confirm('清理集市缓存', '确定清理集市本地缓存并立即重新加载页面吗？', '清理并刷新', '取消');
            if (ok) clearCacheAndReload();
        });

        // 预设头部动作
        container.querySelector('#tb-presets-add-btn')?.addEventListener('click', () => {
            editingPreset = { name: '', query: { type: 'count', value: { min: 2 }, filters: [] } };
            formFilters = [];
            render(container);
        });

        container.querySelector('#tb-presets-import')?.addEventListener('click', async () => {
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
                render(container);
                ctx.ui.toast(`成功导入 ${count} 个预设`, 'success');
            } catch (e) {
                ctx.ui.toast('导入失败：无效的 JSON 格式', 'error');
            }
        });

        container.querySelector('#tb-presets-export')?.addEventListener('click', async () => {
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
        });

        // 表单动作
        if (editingPreset !== null) {
            container.querySelector('#tb-form-cancel-top')?.addEventListener('click', () => {
                editingPreset = null;
                render(container);
            });
            container.querySelector('#tb-form-cancel-btn')?.addEventListener('click', () => {
                editingPreset = null;
                render(container);
            });

            // 组类型切换时，如果从非 weight 切换到 weight，重置权重显示
            container.querySelector('#tb-form-type')?.addEventListener('change', (e) => {
                if (editingPreset && editingPreset.query) {
                    editingPreset.query.type = e.target.value;
                }
                render(container);
            });

            // 从集市当前词缀组抓取
            container.querySelector('#tb-form-grab-btn')?.addEventListener('click', async () => {
                ctx.ui.toast('正在读取当前集市词缀...', 'info');

                // 记住用户在表单里已输入的预设名称
                const curName = container.querySelector('#tb-form-name')?.value?.trim();
                if (curName && editingPreset) {
                    editingPreset.name = curName;
                }

                const result = await fetchCurrentStatsFromPage();
                let stats = (result && result.stats) || [];
                const textMap = (result && result.statTextMap) || {};

                // 兜底 1：使用捕获到的最新网络搜索查询 (/api/trade2/search)
                if (!stats.length && latestCapturedQuery && Array.isArray(latestCapturedQuery.stats) && latestCapturedQuery.stats.length > 0) {
                    stats = JSON.parse(JSON.stringify(latestCapturedQuery.stats));
                }

                // 兜底 2：如果在隔离世界无法从 MAIN 得到数据，直接在隔离世界扫描页面 DOM
                if (!stats.length) {
                    stats = extractStatsFromDOMDirect();
                }

                if (!stats.length) {
                    ctx.ui.toast('未在集市检测到已添加的词缀组，请先在网页高级筛选添加词缀', 'warning');
                    return;
                }

                // 找到第一个包含 filters 的组，或第一个组
                const targetGroup = stats.find(g => Array.isArray(g.filters) && g.filters.length > 0) || stats[0];
                if (!targetGroup || !Array.isArray(targetGroup.filters) || !targetGroup.filters.length) {
                    ctx.ui.toast('当前词缀组暂无词缀条目', 'warning');
                    return;
                }

                // 更新表单数值与类型
                const targetType = targetGroup.type || 'count';
                const targetVal = targetGroup.value ? JSON.parse(JSON.stringify(targetGroup.value)) : {};

                formFilters = targetGroup.filters.map(f => {
                    const label = f.text || textMap[f.id] || f.id;
                    return {
                        id: f.id,
                        text: label,
                        value: f.value ? JSON.parse(JSON.stringify(f.value)) : {},
                        disabled: !!f.disabled
                    };
                });

                if (!editingPreset) {
                    editingPreset = { name: curName || '', query: {} };
                }
                editingPreset.query = {
                    type: targetType,
                    value: targetVal,
                    filters: formFilters.map(f => ({
                        id: f.id,
                        value: f.value,
                        disabled: f.disabled
                    }))
                };

                render(container);
                ctx.ui.toast(`成功抓取 ${formFilters.length} 条词缀！`, 'success');
            });

            // 词条移除
            container.querySelectorAll('.tb-filter-remove-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const idx = Number(btn.dataset.index);
                    formFilters.splice(idx, 1);
                    render(container);
                });
            });

            // 权重输入变更
            container.querySelectorAll('.tb-filter-weight-input').forEach(inp => {
                inp.addEventListener('input', () => {
                    const idx = Number(inp.dataset.index);
                    if (formFilters[idx]) {
                        if (!formFilters[idx].value) formFilters[idx].value = {};
                        formFilters[idx].value.weight = inp.value !== '' ? Number(inp.value) : undefined;
                    }
                });
            });

            // 保存表单
            container.querySelector('#tb-form-save-btn')?.addEventListener('click', () => {
                const nameInput = container.querySelector('#tb-form-name');
                const nameVal = nameInput ? nameInput.value.trim() : '';
                if (!nameVal) {
                    ctx.ui.toast('请输入预设名称', 'warning');
                    return;
                }

                const typeSelect = container.querySelector('#tb-form-type');
                const typeVal = typeSelect ? typeSelect.value : 'count';

                const minInput = container.querySelector('#tb-form-min');
                const maxInput = container.querySelector('#tb-form-max');
                const minVal = minInput && minInput.value.trim() !== '' ? Number(minInput.value.trim()) : null;
                const maxVal = maxInput && maxInput.value.trim() !== '' ? Number(maxInput.value.trim()) : null;

                const valObj = {};
                if (minVal !== null) valObj.min = minVal;
                if (maxVal !== null) valObj.max = maxVal;

                const newQuery = {
                    type: typeVal,
                    value: valObj,
                    filters: formFilters.map(f => {
                        const item = { id: f.id, disabled: !!f.disabled };
                        if (f.value && Object.keys(f.value).length) item.value = f.value;
                        return item;
                    }),
                    disabled: false
                };

                const current = getPresets();
                // 若原预设存在同名或在编辑状态，进行覆盖或替换
                const editOriginalName = editingPreset && editingPreset.name ? editingPreset.name : '';
                let idx = editOriginalName ? current.findIndex(p => p.name === editOriginalName) : -1;
                if (idx === -1) {
                    idx = current.findIndex(p => p.name === nameVal);
                }

                const itemData = {
                    name: nameVal,
                    query: newQuery
                };

                if (idx !== -1) {
                    current[idx] = itemData;
                } else {
                    current.push(itemData);
                }

                savePresets(current);
                editingPreset = null;
                render(container);
                ctx.ui.toast(`预设「${nameVal}」已保存并联动集市下拉框`, 'success');
            });
        }

        // 预设列表项目动作
        container.querySelectorAll('.tb-preset-apply').forEach(btn => {
            btn.addEventListener('click', () => {
                const list = getPresets();
                const idx = Number(btn.dataset.index);
                if (list[idx]) applyPreset(list[idx]);
            });
        });

        container.querySelectorAll('.tb-preset-edit').forEach(btn => {
            btn.addEventListener('click', () => {
                const list = getPresets();
                const idx = Number(btn.dataset.index);
                const item = list[idx];
                if (item) {
                    editingPreset = JSON.parse(JSON.stringify(item));
                    formFilters = (item.query && item.query.filters ? item.query.filters : []).map(f => ({
                        id: f.id,
                        text: f.id,
                        value: f.value ? JSON.parse(JSON.stringify(f.value)) : {},
                        disabled: !!f.disabled
                    }));
                    render(container);
                }
            });
        });

        container.querySelectorAll('.tb-preset-del').forEach(btn => {
            btn.addEventListener('click', async () => {
                const name = btn.dataset.name;
                const ok = await ctx.ui.confirm('删除预设', `确定删除预设「${name}」吗？`, '删除', '取消');
                if (!ok) return;
                const next = getPresets().filter(p => p.name !== name);
                savePresets(next);
                render(container);
                ctx.ui.toast(`已删除预设：${name}`, 'info');
            });
        });
    }

    // ── 5) 注册功能模块 ───────────────────────────────────────────────────
    ctx.register({
        id: 'search-enhance',
        label: '搜索加强',
        icon: '⚡',
        scope: (c) => c.isIntl || c.isQQ,
        panel: true,
        mount(panelEl) {
            listEl = panelEl;
            render(panelEl);

            // 监听页面发来的预设变更消息
            const msgListener = (e) => {
                if (e.source !== window || !e.data) return;
                if (e.data.__poe2tb_presets_updated) {
                    render(panelEl);
                }
            };
            window.addEventListener('message', msgListener);

            return {
                onShow() { render(panelEl); },
                onRefresh() { render(panelEl); },
                async onClear() {
                    const ok = await ctx.ui.confirm('清空所有预设', '确定清空所有已保存的词缀综合预设吗？此操作不可恢复！', '清空', '取消');
                    if (!ok) return;
                    savePresets([]);
                    render(panelEl);
                    ctx.ui.toast('已清空所有预设', 'info');
                }
            };
        }
    });
})();

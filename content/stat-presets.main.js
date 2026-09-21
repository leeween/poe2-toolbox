// PoE2 工具箱 —— 词缀搜索预设与权重注入（MAIN 世界，document_start）
// 在词缀筛选区域注入预设权重下拉项与保存词缀预设功能，直接操作页面 Vuex store。
(function () {
    'use strict';

    const PRESETS_STORAGE_KEY = 'poe2tb_saved_stat_presets';

    // ── 1) 词典与权重格式化 ───────────────────────────────────────────
    const dict = window.PoE2TWDict || globalThis.PoE2TWDict || {};
    const twStats = dict.twStats || { result: [] };
    const allocates = dict.allocates || [];
    const weightSum = dict.weightSum || {};

    const txTradeFormatstats = [];
    twStats.result.forEach((item) => {
        const newEntries = [];
        (item.entries || [])
            .filter((a) => a.text.indexOf('遗产') < 0)
            .forEach((e) => {
                if (e.allocates) {
                    e.option = {
                        options: JSON.parse(JSON.stringify(allocates))
                    };
                }
                if (e.option && e.option.options && e.text.indexOf('#') > -1) {
                    e.option.options
                        .filter((a) => a.text.indexOf('遗产') < 0)
                        .forEach((o) => {
                            const texts = o.text.split('\n');
                            texts.forEach((t) => {
                                newEntries.push({
                                    id: e.id,
                                    option: o.id,
                                    text: e.text
                                        .replace('#', t)
                                        .replace(/\[[^|\]]*\||[\][]/g, ''),
                                });
                            });
                        });
                } else {
                    newEntries.push({
                        id: e.id,
                        text: e.text.replace(/\[[^|\]]*\||[\][]/g, ''),
                    });
                }
            });
        txTradeFormatstats.push({
            id: item.id,
            label: item.label,
            entries: newEntries,
        });
    });

    // ── 1.1) Vue 实例与 Store 稳健获取 ─────────────────────────────────
    function getVueApp() {
        if (window.app && (window.app.$store || window.app.query)) return window.app;
        if (typeof window.unsafeWindow !== 'undefined' && window.unsafeWindow.app && (window.unsafeWindow.app.$store || window.unsafeWindow.app.query)) {
            return window.unsafeWindow.app;
        }

        const selectors = [
            '#app',
            '#trade',
            '.trade-container',
            '.search-advanced-pane',
            '.search-bar',
            '.filter-group',
            '.filter-group-header',
            '.multiselect'
        ];
        for (const sel of selectors) {
            const el = document.querySelector(sel);
            if (el && el.__vue__) {
                const root = el.__vue__.$root || el.__vue__;
                if (root && root.$store) return root;
                if (el.__vue__.$store) return el.__vue__;
                if (root && root.query) return root;
            }
        }

        const anyVueEl = document.querySelector('.search-advanced-pane, .trade-container, #app');
        if (anyVueEl && anyVueEl.__vue__) {
            let curr = anyVueEl.__vue__;
            while (curr) {
                if (curr.$store) return curr;
                curr = curr.$parent;
            }
        }

        return null;
    }

    // ── 1.2) 词条反查与 DOM 解析辅助 ──────────────────────────────────
    function findStatIdByText(rawText) {
        if (!rawText) return null;
        let clean = rawText
            .replace(/^(pseudo|explicit|implicit|fractured|crafted|enchant|rune|sanctum|伪属性|主要词缀|基底词缀|附魔|分裂|工艺)[\s:]*/i, '')
            .replace(/\s*\(pseudo\)\s*$/i, '')
            .replace(/\s*\(implicit\)\s*$/i, '')
            .replace(/\s*\(explicit\)\s*$/i, '')
            .trim();

        const norm = (s) => s.replace(/[\d\.]+/g, '#').replace(/[\s\+]/g, '').toLowerCase();
        const cleanNorm = norm(clean);

        for (const cat of txTradeFormatstats) {
            for (const entry of (cat.entries || [])) {
                if (!entry.id || !entry.text) continue;
                const entryNorm = norm(entry.text);
                if (entryNorm === cleanNorm) {
                    return entry.id;
                }
            }
        }
        for (const cat of txTradeFormatstats) {
            for (const entry of (cat.entries || [])) {
                if (!entry.id || !entry.text) continue;
                const entryNorm = norm(entry.text);
                if (cleanNorm.includes(entryNorm) || entryNorm.includes(cleanNorm)) {
                    return entry.id;
                }
            }
        }
        return null;
    }

    // 从 live Vue 组件中提取筛选组数据
    function extractStatsFromComponents() {
        const groups = [];
        const groupElements = document.querySelectorAll('.filter-group');
        groupElements.forEach(el => {
            const v = el.__vue__;
            if (v) {
                const g = v.group || (v.$props && v.$props.group) || v.statGroup || v.filterGroup;
                if (g && (Array.isArray(g.filters) || g.type)) {
                    groups.push(JSON.parse(JSON.stringify(g)));
                }
            }
        });
        return groups;
    }

    // 从 DOM 节点深度解析筛选组与词条数据（兜底）
    function extractStatsFromDOM() {
        const groups = [];
        const groupEls = document.querySelectorAll('.filter-group');
        if (!groupEls || !groupEls.length) return groups;

        groupEls.forEach(groupEl => {
            // 确定组类型
            let type = 'and';
            const typeText = groupEl.querySelector('.filter-group-header .multiselect__single, .filter-group-select, .multiselect')?.textContent || '';
            const lowerTypeText = typeText.toLowerCase();
            if (lowerTypeText.includes('weight') || typeText.includes('加权')) type = 'weight';
            else if (lowerTypeText.includes('count') || typeText.includes('计数')) type = 'count';
            else if (lowerTypeText.includes('not') || typeText.includes('非')) type = 'not';
            else if (lowerTypeText.includes('if') || typeText.includes('条件')) type = 'if';
            else if (lowerTypeText.includes('and') || typeText.includes('全部')) type = 'and';

            // 确定组 min / max
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

            // 提取各个词条
            const filters = [];
            const rowEls = groupEl.querySelectorAll('.filter, .filter-body .filter-line, .filter-group-body > div');
            rowEls.forEach(row => {
                let filterId = null;
                let filterVal = {};
                let filterText = '';
                let filterDisabled = false;

                if (row.__vue__) {
                    const vf = row.__vue__.filter || (row.__vue__.$props && row.__vue__.$props.filter) || row.__vue__.item;
                    if (vf && vf.id) {
                        filterId = vf.id;
                        filterVal = vf.value ? JSON.parse(JSON.stringify(vf.value)) : {};
                        filterDisabled = !!vf.disabled;
                        if (vf.text) filterText = vf.text;
                    }
                }

                const textEl = row.querySelector('.multiselect__single, .multiselect__tags, .filter-title, .selected-item');
                if (textEl && !filterText) {
                    filterText = textEl.textContent.replace(/\s+/g, ' ').trim();
                }

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

                if (!filterId && filterText) {
                    filterId = findStatIdByText(filterText);
                }

                if (filterId || filterText) {
                    filters.push({
                        id: filterId || `custom.${filterText}`,
                        text: filterText,
                        value: filterVal,
                        disabled: filterDisabled
                    });
                }
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

    // ── 1.3) 多层级读取当前集市词缀组 ──────────────────────────────────
    function getCurrentStats() {
        const app = getVueApp();

        // Tier 1: Vuex store 中的 query.stats
        if (app && app.$store && app.$store.state) {
            const s = app.$store.state;
            const candidates = [
                s.query?.query?.stats,
                s.query?.stats,
                s.stats,
                s.search?.query?.stats,
                s.search?.stats
            ];
            for (const cand of candidates) {
                if (Array.isArray(cand) && cand.some(g => (g.filters && g.filters.length > 0) || (g.value && Object.keys(g.value).length > 0))) {
                    return JSON.parse(JSON.stringify(cand));
                }
            }
        }

        // Tier 2: Vue 根实例上的 query.stats
        if (app && app.query) {
            const candidates = [
                app.query.query?.stats,
                app.query.stats
            ];
            for (const cand of candidates) {
                if (Array.isArray(cand) && cand.some(g => (g.filters && g.filters.length > 0) || (g.value && Object.keys(g.value).length > 0))) {
                    return JSON.parse(JSON.stringify(cand));
                }
            }
        }

        // Tier 3: 从 live Vue 组件 (.filter-group) 提取
        const componentGroups = extractStatsFromComponents();
        if (componentGroups.some(g => (g.filters && g.filters.length > 0) || (g.value && Object.keys(g.value).length > 0))) {
            return componentGroups;
        }

        // Tier 4: 从最近一次捕获的网络请求 (/api/trade2/search) 中提取
        if (window.__poe2tb_last_search_query && Array.isArray(window.__poe2tb_last_search_query.stats) && window.__poe2tb_last_search_query.stats.length > 0) {
            return JSON.parse(JSON.stringify(window.__poe2tb_last_search_query.stats));
        }

        // Tier 5: DOM 深度解析兜底
        const domGroups = extractStatsFromDOM();
        if (domGroups.length > 0) {
            return domGroups;
        }

        // 最后回退：如果上面有任何哪怕空的 candidates
        if (componentGroups.length > 0) return componentGroups;
        return [];
    }

    // ── 2) 预设存储管理 ───────────────────────────────────────────────
    function getSavedPresets() {
        try {
            const raw = localStorage.getItem(PRESETS_STORAGE_KEY);
            return raw ? JSON.parse(raw) : [];
        } catch (e) {
            return [];
        }
    }

    function setSavedPresets(presets) {
        try {
            localStorage.setItem(PRESETS_STORAGE_KEY, JSON.stringify(presets));
        } catch (e) {}
    }

    let currentStatIndex = -1;

    // ── 3) 预设保存弹窗 ───────────────────────────────────────────────
    function initModel() {
        if (document.querySelector('#poe2tb-save-modal')) return;

        const modal = document.createElement('div');
        modal.id = 'poe2tb-save-modal';
        modal.style.display = 'none';
        modal.style.position = 'fixed';
        modal.style.top = '50%';
        modal.style.left = '50%';
        modal.style.transform = 'translate(-50%, -50%)';
        modal.style.backgroundColor = '#1e2124';
        modal.style.color = '#e8e3d6';
        modal.style.padding = '20px';
        modal.style.border = '1px solid #c9aa71';
        modal.style.borderRadius = '8px';
        modal.style.boxShadow = '0 4px 20px rgba(0, 0, 0, 0.6)';
        modal.style.zIndex = '99999';

        const title = document.createElement('h3');
        title.textContent = '保存词缀筛选预设';
        title.style.margin = '0 0 12px';
        title.style.color = '#e8c987';
        title.style.fontSize = '15px';
        modal.appendChild(title);

        const input = document.createElement('input');
        input.type = 'text';
        input.placeholder = '请输入预设名称';
        input.style.width = '260px';
        input.style.marginBottom = '14px';
        input.style.padding = '8px 10px';
        input.style.background = '#16161c';
        input.style.border = '1px solid #2c2c38';
        input.style.color = '#e8e3d6';
        input.style.borderRadius = '4px';
        input.style.fontSize = '13px';
        input.style.boxSizing = 'border-box';
        modal.appendChild(input);

        const buttonContainer = document.createElement('div');
        buttonContainer.style.display = 'flex';
        buttonContainer.style.justifyContent = 'flex-end';
        buttonContainer.style.gap = '10px';

        const cancelButton = document.createElement('button');
        cancelButton.textContent = '取消';
        cancelButton.style.padding = '6px 14px';
        cancelButton.style.background = '#2c2c38';
        cancelButton.style.color = '#e8e3d6';
        cancelButton.style.border = 'none';
        cancelButton.style.borderRadius = '4px';
        cancelButton.style.cursor = 'pointer';

        const saveButton = document.createElement('button');
        saveButton.textContent = '保存';
        saveButton.style.padding = '6px 14px';
        saveButton.style.background = 'linear-gradient(135deg, #c9aa71, #e8c987)';
        saveButton.style.color = '#1a1a1a';
        saveButton.style.border = 'none';
        saveButton.style.borderRadius = '4px';
        saveButton.style.fontWeight = 'bold';
        saveButton.style.cursor = 'pointer';

        buttonContainer.appendChild(cancelButton);
        buttonContainer.appendChild(saveButton);
        modal.appendChild(buttonContainer);
        document.body.appendChild(modal);

        saveButton.addEventListener('click', () => {
            const stats = getCurrentStats();
            const statGroup = (stats && currentStatIndex >= 0 && stats[currentStatIndex]) || (stats && stats[0]);
            if (!statGroup) {
                alert('未获取到当前词缀组数据，请确认词缀组有效');
                return;
            }
            const val = input.value.trim();
            if (!val) {
                alert('请输入预设名称');
                return;
            }
            const presets = getSavedPresets();
            const idx = presets.findIndex(a => a.name === val);
            const item = {
                name: val,
                query: JSON.parse(JSON.stringify(statGroup))
            };
            if (idx !== -1) {
                presets[idx] = item;
            } else {
                presets.push(item);
            }
            setSavedPresets(presets);
            modal.style.display = 'none';
            input.value = '';
            refreshAllPresetDropdowns();
        });

        cancelButton.addEventListener('click', () => {
            modal.style.display = 'none';
            input.value = '';
        });
    }

    // ── 4) 下拉框与输入框初始化 ───────────────────────────────────────
    function initSlectMy() {
        const targetSelect = document.querySelector('.multiselect.filter-select.filter-group-select');
        if (!targetSelect) return;
        const statsDiv = targetSelect.closest('span')?.closest('div');
        if (!statsDiv || statsDiv.querySelector('.poe2tb-preset-input-container')) return;

        const inputBox = document.createElement('input');
        inputBox.type = 'text';
        inputBox.className = 'multiselect';
        inputBox.placeholder = '已保存的预设配置...';
        inputBox.style.width = '50%';
        inputBox.style.background = '#1e2124';
        inputBox.style.textAlign = 'center';
        inputBox.style.marginLeft = '50%';
        inputBox.style.marginTop = '12px';
        inputBox.style.color = 'white';
        inputBox.style.padding = '6px';
        inputBox.style.border = '1px solid #2c2c38';
        inputBox.style.borderRadius = '4px';

        const dropdown = document.createElement('div');
        dropdown.className = 'dropdown';
        dropdown.style.display = 'none';
        dropdown.style.backgroundColor = '#1e2124';
        dropdown.style.border = '1px solid #3a3a4c';
        dropdown.style.borderRadius = '4px';
        dropdown.style.maxHeight = '180px';
        dropdown.style.overflowY = 'auto';
        dropdown.style.width = '50%';
        dropdown.style.marginLeft = '50%';
        dropdown.style.zIndex = '1000';

        function populateDropdown(filter = '') {
            dropdown.innerHTML = '';
            const presets = getSavedPresets();
            if (!presets.length) {
                const empty = document.createElement('div');
                empty.textContent = '暂无保存的预设';
                empty.style.padding = '8px 12px';
                empty.style.color = '#7a7670';
                empty.style.fontSize = '12px';
                empty.style.textAlign = 'center';
                dropdown.appendChild(empty);
                return;
            }

            presets.forEach(option => {
                if (!filter || (option.name && option.name.toLowerCase().includes(filter.toLowerCase()))) {
                    const item = document.createElement('div');
                    item.style.padding = '8px 12px';
                    item.style.cursor = 'pointer';
                    item.style.color = 'white';
                    item.style.fontSize = '13px';
                    item.style.display = 'flex';
                    item.style.justifyContent = 'space-between';
                    item.style.alignItems = 'center';
                    item.style.borderBottom = '1px solid #2a2d32';

                    const nameSpan = document.createElement('span');
                    nameSpan.textContent = option.name;
                    item.appendChild(nameSpan);

                    item.addEventListener('click', () => {
                        const app = getVueApp();
                        if (app && app.$store) {
                            app.$store.commit("pushStatGroup", JSON.parse(JSON.stringify(option.query)));
                        }
                        setTimeout(() => { dropdown.style.display = 'none'; }, 100);
                    });

                    const deleteButton = document.createElement('button');
                    deleteButton.textContent = '×';
                    deleteButton.style.background = 'none';
                    deleteButton.style.border = 'none';
                    deleteButton.style.color = '#ff6b6b';
                    deleteButton.style.cursor = 'pointer';
                    deleteButton.style.fontSize = '16px';
                    deleteButton.title = '删除此预设';
                    deleteButton.addEventListener('click', (event) => {
                        event.stopPropagation();
                        const nextPresets = getSavedPresets().filter(a => a.name !== option.name);
                        setSavedPresets(nextPresets);
                        populateDropdown(inputBox.value);
                    });

                    item.appendChild(deleteButton);
                    dropdown.appendChild(item);
                }
            });
        }

        populateDropdown();

        inputBox.addEventListener('input', () => {
            populateDropdown(inputBox.value);
            dropdown.style.display = 'block';
        });

        document.addEventListener('click', (event) => {
            if (!dropdown.contains(event.target) && event.target !== inputBox) {
                dropdown.style.display = 'none';
            } else if (event.target === inputBox) {
                populateDropdown(inputBox.value);
                dropdown.style.display = 'block';
            }
        });

        const container = document.createElement('div');
        container.className = 'multiselect filter-select filter-group-select poe2tb-preset-input-container';
        container.appendChild(inputBox);
        container.appendChild(dropdown);
        statsDiv.appendChild(container);
    }

    function formatTypeLabel(type) {
        const map = {
            count: '计数',
            weight: '加权',
            and: '全部',
            not: '非',
            if: '条件'
        };
        return map[type] || type || '筛选';
    }

    function populateWeightSelect(selectBox) {
        if (!selectBox) return;
        selectBox.innerHTML = '';

        const defaultOpt = document.createElement('option');
        defaultOpt.value = '';
        defaultOpt.text = '预设综合选项（权重/计数/条件）';
        selectBox.appendChild(defaultOpt);

        const customPresets = getSavedPresets();
        if (customPresets && customPresets.length > 0) {
            const group = document.createElement('optgroup');
            group.label = '── 自定义预设 ──';
            customPresets.forEach((p, idx) => {
                const opt = document.createElement('option');
                opt.value = `custom:${idx}`;
                const q = p.query || {};
                const typeLabel = formatTypeLabel(q.type || p.type);
                let valStr = '';
                const v = q.value || p.value;
                if (v && v.min != null && v.min !== '') valStr += ` min:${v.min}`;
                if (v && v.max != null && v.max !== '') valStr += ` max:${v.max}`;
                const filterCount = (q.filters && q.filters.length) || (p.filters && p.filters.length) || 0;
                opt.text = `${p.name} [${typeLabel}${valStr}] (${filterCount}条)`;
                group.appendChild(opt);
            });
            selectBox.appendChild(group);
        }

        const builtinKeys = Object.keys(weightSum);
        if (builtinKeys.length > 0) {
            const group = document.createElement('optgroup');
            group.label = '── 内置综合权重 ──';
            builtinKeys.forEach(key => {
                const opt = document.createElement('option');
                opt.value = `builtin:${key}`;
                opt.text = key;
                group.appendChild(opt);
            });
            selectBox.appendChild(group);
        }
    }

    function handleWeightSelectChange(event, selectBox) {
        event.preventDefault();
        const val = event.target.value;
        if (!val) return;

        const app = getVueApp();
        if (!app || !app.$store) {
            console.warn('[PoE2TB] 未找到页面 Vue store 实例');
            return;
        }

        if (val.startsWith('custom:')) {
            const idx = Number(val.replace('custom:', ''));
            const presets = getSavedPresets();
            const p = presets[idx];
            if (p && p.query) {
                app.$store.commit('pushStatGroup', JSON.parse(JSON.stringify(p.query)));
            }
        } else if (val.startsWith('builtin:')) {
            const key = val.replace('builtin:', '');
            const weights = weightSum[key];
            if (weights) {
                const newStat = {
                    type: 'weight',
                    value: { min: 1 },
                    filters: [],
                    disabled: false
                };

                txTradeFormatstats.forEach(a => {
                    a.entries.forEach(e => {
                        const findW = weights.find(w => w.id == e.id.split('.')[1]);
                        if (findW) {
                            newStat.filters.push({
                                id: e.id,
                                value: { weight: findW.value },
                                disabled: false
                            });
                        }
                    });
                });
                app.$store.commit('pushStatGroup', newStat);
            }
        }
        selectBox.value = '';
    }

    function refreshAllPresetDropdowns() {
        document.querySelectorAll('.poe2tb-weight-select').forEach(sel => {
            populateWeightSelect(sel);
        });
        const inp = document.querySelector('.poe2tb-preset-input-container input');
        if (inp) {
            inp.dispatchEvent(new Event('input'));
        }
    }

    function initSumSelect() {
        const initInterval = setInterval(() => {
            const targetSelect = document.querySelector('.multiselect.filter-select.filter-group-select');
            if (!targetSelect) return;
            initModel();
            const statsDiv = targetSelect.closest('span')?.closest('div');
            if (!statsDiv) return;

            if (!statsDiv.querySelector('.poe2tb-weight-select')) {
                const selectBox = document.createElement('select');
                selectBox.className = 'multiselect filter-select filter-group-select poe2tb-weight-select';
                selectBox.style.width = '50%';
                selectBox.style.background = '#1e2124';
                selectBox.style.textAlign = 'center';
                selectBox.style.marginLeft = '50%';
                selectBox.style.marginTop = '16px';
                selectBox.style.color = '#e8c987';

                populateWeightSelect(selectBox);

                selectBox.addEventListener('change', (e) => handleWeightSelectChange(e, selectBox));
                statsDiv.appendChild(selectBox);
            }

            initSlectMy();
            clearInterval(initInterval);
        }, 1000);
    }

    // ── 5) 注入「保存预设」按钮 ───────────────────────────────────────
    function initSaveButtons() {
        setInterval(() => {
            if (!document.querySelector('.multiselect.filter-select.filter-group-select')) return;
            const statsDivs = document.querySelectorAll('.search-advanced-pane.brown .filter-group-header .filter-body');
            statsDivs.forEach(div => {
                const nextSibling = div.nextElementSibling;
                if (!nextSibling || !nextSibling.classList.contains('saveStat')) {
                    const newElement = document.createElement('span');
                    newElement.className = 'input-group-btn saveStat';
                    newElement.innerHTML = '<button class="btn btn-default" style="margin-left:6px;font-size:12px;padding:3px 8px;">保存预设</button>';
                    div.insertAdjacentElement('afterend', newElement);
                }
            });
        }, 1000);
    }

    document.addEventListener('click', function (event) {
        const clickedBtn = event.target.closest('.saveStat');
        if (clickedBtn) {
            event.preventDefault();
            initModel();
            const allSaveStats = Array.from(document.querySelectorAll('.saveStat'));
            currentStatIndex = allSaveStats.indexOf(clickedBtn);
            const modal = document.querySelector('#poe2tb-save-modal');
            if (modal) {
                modal.style.display = 'block';
                const inp = modal.querySelector('input');
                if (inp) {
                    inp.value = '';
                    inp.focus();
                }
            }
        }
    });

    // 启动监听与注入
    initSumSelect();
    initSaveButtons();

    // 监听隔离世界（如侧边栏）通过 postMessage 发送的指令
    window.addEventListener('message', (e) => {
        if (e.source !== window || !e.data) return;

        // 预设数据更新，同步刷新下拉框
        if (e.data.__poe2tb_presets_updated) {
            refreshAllPresetDropdowns();
        }

        // 载入预设指令
        if (e.data.__poe2tb_apply_preset && e.data.query) {
            const app = getVueApp();
            if (app && app.$store) {
                app.$store.commit('pushStatGroup', JSON.parse(JSON.stringify(e.data.query)));
            } else {
                console.warn('[PoE2TB] applyPreset: 未找到 Vuex store');
            }
        }

        // 响应当前页面词缀组读取请求（供侧边栏一键抓取）
        if (e.data.__poe2tb_get_current_stats) {
            const stats = getCurrentStats();

            const statTextMap = {};
            txTradeFormatstats.forEach(a => {
                (a.entries || []).forEach(entry => {
                    if (entry.id && entry.text) statTextMap[entry.id] = entry.text;
                });
            });

            // 若提取到的 filter 条目自带 text，补充进入 statTextMap
            stats.forEach(g => {
                (g.filters || []).forEach(f => {
                    if (f.id && f.text && !statTextMap[f.id]) {
                        statTextMap[f.id] = f.text;
                    }
                });
            });

            window.postMessage({
                __poe2tb_current_stats_reply: true,
                requestId: e.data.requestId,
                stats: JSON.parse(JSON.stringify(stats)),
                statTextMap
            }, '*');
        }
    });

    // 暴露供页面控制台与调试用的全局对象
    window.__PoE2TB_PRESETS = {
        getPresets: getSavedPresets,
        savePresets: setSavedPresets,
        getCurrentStats,
        applyPreset(presetQuery) {
            const app = getVueApp();
            if (app && app.$store) {
                app.$store.commit('pushStatGroup', JSON.parse(JSON.stringify(presetQuery)));
                return true;
            }
            return false;
        },
        deletePreset(name) {
            const next = getSavedPresets().filter(a => a.name !== name);
            setSavedPresets(next);
        }
    };
})();

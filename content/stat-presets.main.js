// PoE2 工具箱 —— 词缀搜索预设与权重注入（MAIN 世界，document_start）
// 在词缀筛选区域注入预设权重下拉项与保存词缀预设功能，直接操作页面 Vuex store。
(function () {
    'use strict';

    const PRESETS_ENABLED_KEY = 'poe2tb_presets_enabled';
    const PRESETS_STORAGE_KEY = 'poe2tb_saved_stat_presets';

    function isPresetsEnabled() {
        return localStorage.getItem(PRESETS_ENABLED_KEY) !== '0';
    }

    if (!isPresetsEnabled()) {
        return;
    }

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
            const app = window.app || (window.unsafeWindow && window.unsafeWindow.app);
            const stats = app && app.query && app.query.query && app.query.query.stats;
            const statGroup = stats && stats[currentStatIndex];
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

            const inp = document.querySelector('.poe2tb-preset-input-container input');
            if (inp) inp.dispatchEvent(new Event('input'));
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
                        const app = window.app || (window.unsafeWindow && window.unsafeWindow.app);
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

                const defaultOpt = document.createElement('option');
                defaultOpt.value = '';
                defaultOpt.text = '预设综合选项（权重）';
                selectBox.appendChild(defaultOpt);

                Object.keys(weightSum).forEach(key => {
                    const opt = document.createElement('option');
                    opt.value = key;
                    opt.text = key;
                    selectBox.appendChild(opt);
                });

                statsDiv.appendChild(selectBox);

                selectBox.addEventListener('change', function (event) {
                    event.preventDefault();
                    if (event.target.value) {
                        const weights = weightSum[event.target.value];
                        if (!weights) return;

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

                        const app = window.app || (window.unsafeWindow && window.unsafeWindow.app);
                        if (app && app.$store) {
                            app.$store.commit('pushStatGroup', newStat);
                        } else {
                            console.error('[PoE2TB] 未找到页面 Vue store 实例');
                        }
                    }
                });
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

    // 监听隔离世界（如侧边栏）通过 postMessage 发送的载入预设指令
    window.addEventListener('message', (e) => {
        if (e.source !== window || !e.data) return;
        if (e.data.__poe2tb_apply_preset && e.data.query) {
            const app = window.app || (window.unsafeWindow && window.unsafeWindow.app);
            if (app && app.$store) {
                app.$store.commit('pushStatGroup', JSON.parse(JSON.stringify(e.data.query)));
            }
        }
    });

    // 暴露供页面控制台与调试用的全局对象
    window.__PoE2TB_PRESETS = {
        getPresets: getSavedPresets,
        savePresets: setSavedPresets,
        applyPreset(presetQuery) {
            const app = window.app || (window.unsafeWindow && window.unsafeWindow.app);
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

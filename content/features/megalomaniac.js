// PoE2 工具箱 —— 妄想症统计（隔离世界，侧边栏 tab）
// 输入 poe.ninja builds 链接和账号数量，后台抓取前 N 个角色的 Megalomaniac enchantMods 并统计。
(function () {
    'use strict';
    const ctx = window.PoE2TB;
    if (!ctx) return;
    const { escapeHtml } = ctx.util;

    const STORE_KEY = 'megalomaniac-last-input';
    const RESULT_CACHE_KEY = 'megalomaniac-last-result';
    const PASSIVE_URL_KEY = 'megalomaniac-passive-url';
    const PASSIVE_CACHE_KEY = 'megalomaniac-passive-cache';
    const DEFAULT_PASSIVE_URL = 'https://poe2db.tw/data/passive-skill-tree/4.5/data_cn.json';
    const DEFAULT_NINJA_URL = 'https://poe.ninja/poe2/builds/runesofaldur?items=Megalomaniac';
    const DEFAULT_LIMIT = 20;
    const BUY_BASES = {
        cn: 'https://poe.game.qq.com/trade2/search/poe2/奥杜尔秘符?q=',
        intl: 'https://www.pathofexile.com/trade2/search/poe2/Runes%20of%20Aldur?q=',
    };

    let bodyEl = null;
    let runBtn = null;
    let lastInput = null;
    let currentResult = null;
    let passiveUrl = DEFAULT_PASSIVE_URL;
    let passiveDetails = null;
    let selectedNames = new Set();
    let buyRealm = 'cn';
    let running = false;

    function setBody(html) {
        if (bodyEl) bodyEl.innerHTML = html;
    }

    function setRunning(on) {
        running = on;
        if (runBtn) {
            runBtn.disabled = on;
            runBtn.textContent = on ? '统计中…' : '开始统计';
        }
    }

    function showDialog(defaults) {
        return new Promise((resolve) => {
            document.querySelector('.tb-dialog-overlay')?.remove();
            const overlay = document.createElement('div');
            overlay.className = 'tb-dialog-overlay';
            overlay.innerHTML = `
                <div class="tb-dialog tb-mg-dialog">
                    <div class="tb-dialog-header"><h3>妄想症统计</h3></div>
                    <div class="tb-dialog-body">
                        <label class="tb-dialog-label">poe.ninja 链接</label>
                        <input type="text" class="tb-dialog-input tb-mg-url" placeholder="https://poe.ninja/poe2/builds/...">
                        <div class="tb-mg-hint">默认值是全职业使用妄想症的默认排序，建议选择职业并且设定好排序后将链接填入。</div>
                        <label class="tb-dialog-label tb-mg-count-label">账号数量</label>
                        <input type="number" min="10" max="100" step="1" class="tb-dialog-input tb-mg-limit">
                        <div class="tb-mg-error"></div>
                    </div>
                    <div class="tb-dialog-footer">
                        <button class="tb-btn tb-btn-secondary tb-cancel">取消</button>
                        <button class="tb-btn tb-btn-primary tb-confirm">确定</button>
                    </div>
                </div>`;
            const urlInput = overlay.querySelector('.tb-mg-url');
            const limitInput = overlay.querySelector('.tb-mg-limit');
            const errorEl = overlay.querySelector('.tb-mg-error');
            urlInput.value = defaults.url || '';
            limitInput.value = String(defaults.limit || DEFAULT_LIMIT);
            document.body.appendChild(overlay);

            const close = (value) => { overlay.remove(); resolve(value); };
            const submit = () => {
                const url = urlInput.value.trim();
                const limit = Number.parseInt(limitInput.value, 10);
                if (!url) { errorEl.textContent = '请填写 poe.ninja 链接'; urlInput.focus(); return; }
                if (!Number.isFinite(limit) || limit < 10 || limit > 100) {
                    errorEl.textContent = '账号数量需在 10 到 100 之间';
                    limitInput.focus();
                    return;
                }
                close({ url, limit });
            };
            overlay.querySelector('.tb-cancel').addEventListener('click', () => close(null));
            overlay.querySelector('.tb-confirm').addEventListener('click', submit);
            overlay.addEventListener('click', (e) => { if (e.target === overlay) close(null); });
            overlay.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') close(null);
                if (e.key === 'Enter') submit();
            });
            setTimeout(() => { urlInput.focus(); if (urlInput.value) urlInput.select(); }, 50);
        });
    }

    async function loadLastInput() {
        try {
            lastInput = await ctx.storage.get(STORE_KEY, null);
        } catch (e) {
            lastInput = null;
        }
        return lastInput || { url: DEFAULT_NINJA_URL, limit: DEFAULT_LIMIT };
    }

    async function saveLastInput(input) {
        lastInput = input;
        try { await ctx.storage.set(STORE_KEY, input); } catch (e) { /* ignore */ }
    }

    async function loadLastResult() {
        try {
            return await ctx.storage.get(RESULT_CACHE_KEY, null);
        } catch (e) {
            return null;
        }
    }

    async function saveLastResult() {
        if (!currentResult) return;
        try {
            await ctx.storage.set(RESULT_CACHE_KEY, {
                result: currentResult,
                input: lastInput,
                passiveUrl,
                selectedNames: Array.from(selectedNames),
                buyRealm,
                cachedAt: Date.now(),
            });
        } catch (e) { /* ignore */ }
    }

    async function loadPassiveUrl() {
        try {
            passiveUrl = await ctx.storage.get(PASSIVE_URL_KEY, DEFAULT_PASSIVE_URL) || DEFAULT_PASSIVE_URL;
        } catch (e) {
            passiveUrl = DEFAULT_PASSIVE_URL;
        }
        return passiveUrl;
    }

    async function savePassiveUrl(url) {
        passiveUrl = url || DEFAULT_PASSIVE_URL;
        try { await ctx.storage.set(PASSIVE_URL_KEY, passiveUrl); } catch (e) { /* ignore */ }
    }

    function passiveDetail(name) {
        const detail = passiveDetails && passiveDetails[name];
        if (!detail) return { id: '', stats: [] };
        if (Array.isArray(detail)) return { id: '', stats: detail }; // 兼容旧缓存，随后会被新缓存覆盖
        return {
            id: detail.id || '',
            stats: Array.isArray(detail.stats) ? detail.stats : [],
        };
    }

    function statsHtml(name) {
        const detail = passiveDetail(name);
        if (!detail.stats.length) return '';
        return `<div class="tb-mg-detail">${detail.stats.map((line) => `<div>${escapeHtml(line)}</div>`).join('')}</div>`;
    }

    function rowsHtml(stats) {
        if (!stats.length) return '<div class="tb-empty">没有统计到词条</div>';
        return stats.map((item) => {
            const detail = passiveDetail(item.name);
            const checked = selectedNames.has(item.name) ? 'checked' : '';
            const disabled = detail.id ? '' : 'disabled';
            const selectable = detail.id ? ' tb-mg-row-selectable' : '';
            return `
            <div class="tb-mg-row${selectable}">
                <div class="tb-mg-main">
                    <div class="tb-mg-line">
                        <span class="tb-mg-name">${escapeHtml(item.name)}</span>
                        <span class="tb-mg-id">${detail.id ? 'ID: ' + escapeHtml(detail.id) : 'ID: —'}</span>
                        <span class="tb-mg-count">${item.count}</span>
                        <input type="checkbox" class="tb-mg-check" data-name="${escapeHtml(item.name)}" ${checked} ${disabled}>
                    </div>
                    ${statsHtml(item.name)}
                </div>
            </div>`;
        }).join('');
    }

    function renderResult(data) {
        currentResult = data;
        const stats = data.stats || [];
        const meta = [
            `检查 ${data.checked || 0} 个账号`,
            `页面可用 ${data.available || 0}`,
            `搜索总数 ${data.total || 0}`,
            `妄想症 ${data.jewelCount || 0} 件`,
        ];
        if (data.skipped) meta.push(`跳过 ${data.skipped} 个`);
        const rows = rowsHtml(stats);
        let warning = '';
        if (data.rateLimited) {
            const mins = data.rateLimited.retryAfterSeconds ? Math.ceil(data.rateLimited.retryAfterSeconds / 60) : 0;
            warning = `<div class="tb-mg-warn">poe.ninja 限流${mins ? `，约 ${mins} 分钟后再试` : ''}</div>`;
        } else if (data.failures && data.failures.length) {
            warning = `<div class="tb-mg-warn">失败 ${data.failures.length} 个账号</div>`;
        }
        setBody(`
            <div class="tb-mg-summary">
                <div class="tb-mg-detail-source">
                    <button class="tb-btn tb-btn-secondary tb-mg-detail-btn">查看天赋详情</button>
                    <input type="text" class="tb-mg-detail-url" value="${escapeHtml(passiveUrl)}">
                </div>
                <div class="tb-mg-league">${escapeHtml(data.overview || data.league || '')}</div>
                <div class="tb-mg-meta">${meta.map(escapeHtml).join(' · ')}</div>
                ${warning}
            </div>
            <div class="tb-mg-list">${rows}</div>
            <div class="tb-mg-buybar">
                <select class="tb-mg-realm">
                    <option value="cn" ${buyRealm === 'cn' ? 'selected' : ''}>国服</option>
                    <option value="intl" ${buyRealm === 'intl' ? 'selected' : ''}>国际服</option>
                </select>
                <button class="tb-btn tb-btn-primary tb-mg-buy">去购买</button>
            </div>`);
    }

    async function loadPassiveDetailsFromCache(url) {
        try {
            const cache = await ctx.storage.get(PASSIVE_CACHE_KEY, null);
            if (cache && cache.url === url && cache.details) {
                const first = cache.details[Object.keys(cache.details)[0]];
                if (!Array.isArray(first)) return cache.details;
            }
        } catch (e) { /* ignore */ }
        return null;
    }

    async function storePassiveDetails(url, details) {
        try {
            await ctx.storage.set(PASSIVE_CACHE_KEY, { url, details, cachedAt: Date.now() });
        } catch (e) { /* ignore */ }
    }

    async function showPassiveDetails() {
        if (!currentResult) return;
        const input = bodyEl.querySelector('.tb-mg-detail-url');
        const btn = bodyEl.querySelector('.tb-mg-detail-btn');
        const url = (input && input.value.trim()) || DEFAULT_PASSIVE_URL;
        await savePassiveUrl(url);
        if (btn) {
            btn.disabled = true;
            btn.textContent = '加载中…';
        }
        try {
            passiveDetails = await loadPassiveDetailsFromCache(url);
            if (!passiveDetails) {
                const resp = await ctx.sendBg({ type: 'POE_NINJA_PASSIVE_DETAILS', url });
                if (!resp || resp.success === false) throw new Error((resp && resp.error) || '天赋详情加载失败');
                passiveDetails = resp.details || {};
                await storePassiveDetails(resp.url || url, passiveDetails);
            }
            renderResult(currentResult);
            saveLastResult();
            ctx.ui.toast('天赋详情已加载', 'success');
        } catch (e) {
            ctx.ui.toast(String(e.message || e), 'error', 5000);
            if (btn) {
                btn.disabled = false;
                btn.textContent = '查看天赋详情';
            }
        }
    }

    function tradeQuery(ids) {
        return {
            query: {
                stats: [
                    {
                        type: 'and',
                        filters: [],
                        disabled: false,
                    },
                    {
                        type: 'count',
                        value: { min: 2 },
                        filters: ids.map((id) => ({
                            id: 'enchant.stat_2954116742|' + id,
                            disabled: false,
                        })),
                        disabled: false,
                    },
                ],
                status: { option: 'securable' },
                filters: {
                    type_filters: {
                        filters: {
                            category: { option: 'jewel' },
                        },
                        disabled: false,
                    },
                },
            }
        };
    }

    function openBuyLink() {
        const ids = Array.from(selectedNames)
            .map((name) => passiveDetail(name).id)
            .filter(Boolean);
        if (ids.length < 2) {
            ctx.ui.toast('请至少勾选 2 个已有 ID 的天赋', 'warning');
            return;
        }
        const base = BUY_BASES[buyRealm] || BUY_BASES.cn;
        const url = base + encodeURIComponent(JSON.stringify(tradeQuery(ids)));
        window.open(url, '_blank', 'noopener,noreferrer');
    }

    async function runWithInput(input) {
        if (running) return;
        await saveLastInput(input);
        selectedNames = new Set();
        setRunning(true);
        setBody('<div class="tb-loading">正在统计中。为避免触发 poe.ninja 限流，查询会按固定频率进行；账号数量越多，耗时越久。筛选完成后会自动缓存本次结果，方便下次直接查看。</div>');
        try {
            const resp = await ctx.sendBg({
                type: 'POE_NINJA_MEGALOMANIAC',
                url: input.url,
                limit: input.limit,
            });
            if (!resp || resp.success === false) throw new Error((resp && resp.error) || '统计失败');
            renderResult(resp);
            saveLastResult();
            ctx.ui.toast('妄想症统计完成', 'success');
        } catch (e) {
            setBody(`<div class="tb-empty">统计失败：${escapeHtml(String(e.message || e))}</div>`);
            ctx.ui.toast('妄想症统计失败', 'error');
        } finally {
            setRunning(false);
        }
    }

    async function openDialogAndRun() {
        const defaults = await loadLastInput();
        const input = await showDialog(defaults);
        if (!input) return;
        runWithInput(input);
    }

    function mount(panelEl) {
        panelEl.innerHTML = `
            <div class="tb-mg-toolbar">
                <button class="tb-btn tb-btn-primary tb-mg-run">开始统计</button>
            </div>
            <div class="tb-mg-body">
                <div class="tb-empty">点击「开始统计」输入 poe.ninja 链接和账号数量。</div>
            </div>`;
        bodyEl = panelEl.querySelector('.tb-mg-body');
        runBtn = panelEl.querySelector('.tb-mg-run');
        runBtn.addEventListener('click', openDialogAndRun);
        bodyEl.addEventListener('click', (e) => {
            if (e.target.closest('.tb-mg-detail-btn')) showPassiveDetails();
            if (e.target.closest('.tb-mg-buy')) openBuyLink();
            const row = e.target.closest('.tb-mg-row');
            if (!row || e.target.closest('button,input,select,textarea,a,label')) return;
            const check = row.querySelector('.tb-mg-check:not(:disabled)');
            if (!check) return;
            check.checked = !check.checked;
            check.dispatchEvent(new Event('change', { bubbles: true }));
        });
        bodyEl.addEventListener('change', (e) => {
            const check = e.target.closest('.tb-mg-check');
            if (check) {
                if (check.checked) selectedNames.add(check.dataset.name);
                else selectedNames.delete(check.dataset.name);
                saveLastResult();
                return;
            }
            const realm = e.target.closest('.tb-mg-realm');
            if (realm) {
                buyRealm = realm.value || 'cn';
                saveLastResult();
            }
        });
        (async () => {
            await loadPassiveUrl();
            const cached = await loadLastResult();
            if (cached && cached.result) {
                currentResult = cached.result;
                lastInput = cached.input || lastInput;
                passiveUrl = cached.passiveUrl || passiveUrl;
                selectedNames = new Set(cached.selectedNames || []);
                buyRealm = cached.buyRealm || 'cn';
                passiveDetails = await loadPassiveDetailsFromCache(passiveUrl);
                renderResult(currentResult);
                return;
            }
            await loadLastInput();
        })();
        return {
            onRefresh() {
                if (lastInput && lastInput.url) runWithInput(lastInput);
                else openDialogAndRun();
            },
        };
    }

    ctx.register({
        id: 'megalomaniac',
        label: '妄想症统计',
        icon: '◆',
        scope: (c) => c.isQQ || c.isIntl,
        panel: true,
        mount,
    });
})();

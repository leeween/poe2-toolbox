// PoE2 工具箱 —— 查看词缀（隔离世界，侧边栏 tab）
// 选了「物品类型」后，展示该类型在 poe2db 上的全部可出词缀。国服读 /cn/（简体），国际服读 /tw/（繁体）。
// poe2db 跨域抓取在后台 poe2db.js；类型识别用 /api/trade2/data/filters + DOM 扫描 + MAIN 世界 search 兜底。
(function () {
    'use strict';
    const ctx = window.PoE2TB;
    if (!ctx) return;
    const log = (...a) => false && console.log('[poe2-mods]', ...a);
    const warn = (...a) => console.warn('[poe2-mods]', ...a);

    // 防具防御变体后缀 -> 显示名
    const ARMOUR_DEFS = [
        ['str', '护甲'], ['dex', '闪避'], ['int', '能量护盾'],
        ['str_dex', '护甲/闪避'], ['str_int', '护甲/能量护盾'],
        ['dex_int', '闪避/能量护盾'], ['str_dex_int', '全属性'],
    ];

    // 交易行类别 id -> poe2db slug（字符串=单页；{slug,note}=单页带提示；
    // {armour:'X'}=防具多变体；{multi:[[slug,label]...]}=多页 tab）
    const CATEGORY_MAP = {
        'weapon.claw': 'Claws', 'weapon.dagger': 'Daggers', 'weapon.onesword': 'One_Hand_Swords',
        'weapon.oneaxe': 'One_Hand_Axes', 'weapon.onemace': 'One_Hand_Maces', 'weapon.spear': 'Spears',
        'weapon.flail': 'Flails', 'weapon.twosword': 'Two_Hand_Swords', 'weapon.twoaxe': 'Two_Hand_Axes',
        'weapon.twomace': 'Two_Hand_Maces', 'weapon.warstaff': 'Quarterstaves',
        'weapon.bow': 'Bows', 'weapon.crossbow': 'Crossbows',
        'weapon.wand': 'Wands', 'weapon.sceptre': 'Sceptres', 'weapon.staff': 'Staves', 'weapon.talisman': 'Talismans',
        'armour.focus': 'Foci', 'armour.buckler': 'Bucklers', 'armour.quiver': 'Quivers',
        'accessory.amulet': 'Amulets', 'accessory.belt': 'Belts', 'accessory.ring': 'Rings',
        'jewel': {
            multi: [
                ['Ruby', '红玉'], ['Emerald', '翡翠'], ['Sapphire', '蓝玉'], ['Diamond', '宝钻'],
                ['Time-Lost_Ruby', '失落的红玉'], ['Time-Lost_Emerald', '失落的翡翠'],
                ['Time-Lost_Sapphire', '失落的蓝玉'], ['Time-Lost_Diamond', '失落的宝钻'],
            ]
        },
        'flask.life': 'Life_Flasks', 'flask.mana': 'Mana_Flasks', 'flask.charm': 'Charms',
        'map.waystone': { slug: 'Waystones_top_tier', note: '只展示引路石(Top)的词缀' },
        'map.tablet': {
            multi: [
                ['Breach_Tablet', '裂隙石板'], ['Expedition_Tablet', '先祖秘藏石板'],
                ['Delirium_Tablet', '惊悸迷雾石板'], ['Ritual_Tablet', '驱灵仪式石板'],
                ['Irradiated_Tablet', '能量辐照石板'], ['Overseer_Tablet', '霸主石板'],
                ['Abyss_Tablet', '深渊石板'], ['Temple_Tablet', '神庙石板'],
            ]
        },
        'sanctum.relic': {
            multi: [
                ['Urn_Relic', '壶瓮遗物'], ['Amphora_Relic', '土罐遗物'], ['Vase_Relic', '花瓶遗物'],
                ['Seal_Relic', '封印遗物'], ['Coffer_Relic', '匣柜遗物'], ['Tapestry_Relic', '挂毯遗物'],
                ['Incense_Relic', '熏香遗物'],
            ]
        },
        'armour.helmet': { armour: 'Helmets' }, 'armour.chest': { armour: 'Body_Armours' },
        'armour.gloves': { armour: 'Gloves' }, 'armour.boots': { armour: 'Boots' }, 'armour.shield': { armour: 'Shields' },
    };

    const SOURCE_GROUPS = [
        ['corrupted', '腐化（瓦尔宝珠）'], ['essence', '精华'],
        ['perfect_essence', '完美精华'], ['desecrated', '渎灵'],
    ];

    function detectLang() { return ctx.isQQ ? 'cn' : 'tw'; }
    function poe2dbUrl(slug) { return 'https://poe2db.tw/' + detectLang() + '/' + slug; }

    // ── 类型识别 ─────────────────────────────────────────────────────
    let _filterMap = null;
    async function loadFilterMap() {
        if (_filterMap) return _filterMap;
        const res = await fetch('/api/trade2/data/filters', { credentials: 'same-origin' });
        const d = await res.json();
        const map = {};
        for (const grp of d.result || []) {
            if (grp.id !== 'type_filters') continue;
            for (const f of grp.filters || []) {
                if (f.id !== 'category') continue;
                for (const o of (f.option && f.option.options) || []) {
                    if (o.text != null) map[String(o.text).trim()] = o.id || '';
                }
            }
        }
        _filterMap = map;
        log('filter map 载入', Object.keys(map).length, '项');
        return map;
    }

    // MAIN 世界转发的 search 类别（兜底）
    let _lastSearchCat = null;
    window.addEventListener('message', (e) => {
        if (e.source !== window) return;
        const d = e.data;
        if (d && d.__poe2tb_search && d.category) { _lastSearchCat = d.category; log('捕获 search 类别', d.category); }
    });

    async function resolveCategory() {
        let map = null;
        try { map = await loadFilterMap(); } catch (e) { warn('加载 filters 失败', e); }
        if (map) {
            const names = new Set(Object.keys(map));
            const shell = document.getElementById('tb-panel');
            let best = null, bestTop = Infinity, bestDesc = Infinity;
            const els = document.body.getElementsByTagName('*');
            for (const el of els) {
                if (shell && shell.contains(el)) continue; // 排除本插件侧边栏自身
                const raw = el.tagName === 'INPUT' ? el.value : el.textContent;
                const t = (raw || '').trim();
                if (!t || !names.has(t)) continue;
                const r = el.getBoundingClientRect();
                if (r.width === 0 && r.height === 0) continue;
                const desc = el.getElementsByTagName('*').length;
                if (r.top < bestTop - 1 || (Math.abs(r.top - bestTop) <= 1 && desc < bestDesc)) {
                    bestTop = r.top; bestDesc = desc; best = { id: map[t], text: t };
                }
            }
            if (best) { log('DOM 命中类型', best); return best; }
        }
        if (_lastSearchCat) {
            let text = _lastSearchCat;
            if (map) { const k = Object.keys(map).find((k) => map[k] === _lastSearchCat); if (k) text = k; }
            return { id: _lastSearchCat, text };
        }
        return null;
    }

    async function fetchModsView(slug) {
        const resp = await ctx.sendBg({ type: 'POE2DB_FETCH', lang: detectLang(), slug });
        if (!resp || !resp.success) throw new Error((resp && resp.error) || '抓取失败');
        return resp.data;
    }

    // ── 文本清洗 / 渲染 ───────────────────────────────────────────────
    function sanitizeModHtml(str) {
        const box = document.createElement('div');
        box.innerHTML = str || '';
        box.querySelectorAll('a').forEach((a) => {
            const span = document.createElement('span');
            span.className = 'tb-vm-kw';
            span.textContent = a.textContent;
            a.replaceWith(span);
        });
        box.querySelectorAll('img,script,style').forEach((n) => n.remove());
        return box.innerHTML;
    }
    function familyHeaderHtml(str) {
        const box = document.createElement('div');
        box.innerHTML = str || '';
        box.querySelectorAll('.mod-value').forEach((s) => { s.textContent = '#'; });
        box.querySelectorAll('a').forEach((a) => {
            const sp = document.createElement('span');
            sp.className = 'tb-vm-kw';
            sp.textContent = a.textContent;
            a.replaceWith(sp);
        });
        box.querySelectorAll('img,script,style').forEach((n) => n.remove());
        return box.innerHTML;
    }
    function stripTags(s) { const d = document.createElement('div'); d.innerHTML = s; return d.textContent || ''; }
    function escapeText(s) { return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }

    function splitPrefixSuffix(list) {
        const pre = [], suf = [];
        for (const it of list || []) {
            const t = String(it.ModGenerationTypeID);
            if (t === '1') pre.push(it);
            else if (t === '2') suf.push(it);
        }
        return { pre, suf };
    }

    function renderModList(list) {
        if (!list.length) return '<div class="tb-vm-empty">无</div>';
        return list.map((it) => {
            const name = it.Name ? `<span class="tb-vm-name">${escapeText(stripTags(String(it.Name)))}</span>` : '';
            const lv = it.Level != null ? 'Lv' + it.Level : '';
            const w = it.DropChance != null ? 'w' + it.DropChance : '';
            const meta = [lv, w].filter(Boolean).join(' / ');
            return `<div class="tb-vm-mod">${name}${sanitizeModHtml(it.str)}<span class="tb-vm-meta">${meta}</span></div>`;
        }).join('');
    }

    function groupByFamily(list) {
        const groups = new Map();
        for (const it of list || []) {
            const key = (it.ModFamilyList && it.ModFamilyList.length ? it.ModFamilyList.join('|') : '') || familyHeaderHtml(it.str);
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(it);
        }
        const out = [];
        for (const arr of groups.values()) {
            arr.sort((a, b) => (parseInt(b.Level) || 0) - (parseInt(a.Level) || 0));
            out.push(arr);
        }
        return out;
    }

    function renderGroups(list) {
        const groups = groupByFamily(list);
        if (!groups.length) return '<div class="tb-vm-empty">无</div>';
        return groups.map((tiers) => {
            if (tiers.length === 1) {
                const t = tiers[0];
                const w = t.DropChance != null ? ' w' + t.DropChance : '';
                return `<div class="tb-vm-fam single"><div class="tb-vm-solo">` +
                    `<span class="tb-vm-modtext">${sanitizeModHtml(t.str)}</span>` +
                    `<span class="tb-vm-meta">Lv${t.Level}${w}</span></div></div>`;
            }
            const head = familyHeaderHtml(tiers[0].str);
            const lvs = tiers.map((t) => parseInt(t.Level) || 0);
            const minL = Math.min(...lvs), maxL = Math.max(...lvs);
            const lvText = `Lv${minL}-${maxL}`;
            const rows = tiers.map((t, i) => {
                const w = t.DropChance != null ? ' w' + t.DropChance : '';
                return `<div class="tb-vm-tier"><span class="tb-vm-tn">T${i + 1}</span>` +
                    `<span class="tb-vm-modtext">${sanitizeModHtml(t.str)}</span>` +
                    `<span class="tb-vm-meta">Lv${t.Level}${w}</span></div>`;
            }).join('');
            return `<div class="tb-vm-fam"><div class="tb-vm-famhead"><span class="tb-vm-famtext">${head}</span>` +
                `<span class="tb-vm-meta">${tiers.length}档 ${lvText}</span></div>` +
                `<div class="tb-vm-tiers">${rows}</div></div>`;
        }).join('');
    }

    function renderModsView(obj) {
        const normal = obj.normal || [];
        const { pre, suf } = splitPrefixSuffix(normal);
        const preG = groupByFamily(pre).length, sufG = groupByFamily(suf).length;
        let html = '<div class="tb-vm-cols">' +
            `<div class="tb-vm-col"><div class="tb-vm-h">基础 前缀 (${preG})</div>${renderGroups(pre)}</div>` +
            `<div class="tb-vm-col"><div class="tb-vm-h">基础 后缀 (${sufG})</div>${renderGroups(suf)}</div>` +
            '</div>';
        if (!pre.length && !suf.length) {
            html = '<div class="tb-vm-note">该类型没有常规前/后缀，只看特殊来源词缀。</div>' + html;
        }
        for (const [key, label] of SOURCE_GROUPS) {
            const arr = obj[key];
            if (arr && arr.length) {
                html += `<details class="tb-vm-src"><summary>${label} (${arr.length})</summary>${renderModList(arr)}</details>`;
            }
        }
        return html;
    }

    // ── 面板元素 / 触发 ───────────────────────────────────────────────
    let panelRoot = null, bodyEl = null, titleEl = null, tabsEl = null;
    let _curCatText = '';

    function setBody(html) { bodyEl.innerHTML = html; }
    function setTitle(t, url) {
        titleEl.innerHTML = escapeText(t || '词缀') +
            (url ? ` <a class="tb-vm-link" href="${url}" target="_blank" rel="noreferrer">poe2db↗</a>` : '');
    }
    function clearTabs() { tabsEl.innerHTML = ''; }
    function noteHtml(note) { return note ? `<div class="tb-vm-note">${escapeText(note)}</div>` : ''; }

    async function onTrigger() {
        clearTabs();
        const cat = await resolveCategory();
        if (!cat || !cat.id) {
            setTitle('词缀');
            setBody('<div class="tb-vm-empty">请先在「物品类型」里选择一个具体类型（如：节杖）。</div>');
            return;
        }
        const mapped = CATEGORY_MAP[cat.id];
        if (!mapped) {
            setTitle(cat.text || cat.id);
            setBody(`<div class="tb-vm-empty">「${escapeText(cat.text || cat.id)}」(${escapeText(cat.id)}) 暂不支持查看词缀。<br>该类型在 poe2db 上可能没有独立词缀页。</div>`);
            return;
        }
        _curCatText = cat.text || cat.id;
        setTitle(_curCatText);
        if (typeof mapped === 'string') await loadSingle(mapped);
        else if (mapped.slug) await loadSingle(mapped.slug, mapped.note);
        else if (mapped.armour) await loadMulti(ARMOUR_DEFS.map(([suf, label]) => ({ slug: mapped.armour + '_' + suf, label })));
        else if (mapped.multi) await loadMulti(mapped.multi.map(([slug, label]) => ({ slug, label })));
    }

    async function loadSingle(slug, note) {
        setBody('<div class="tb-vm-empty">加载中…</div>');
        try {
            const obj = await fetchModsView(slug);
            if (!obj) { setBody('<div class="tb-vm-empty">未能从 poe2db 解析到词缀数据。</div>'); return; }
            setTitle(_curCatText, poe2dbUrl(slug));
            setBody(noteHtml(note) + renderModsView(obj));
        } catch (e) {
            setBody(`<div class="tb-vm-empty">加载失败：${escapeText(String(e.message || e))}</div>`);
        }
    }

    async function loadMulti(cands) {
        setBody('<div class="tb-vm-empty">加载中…</div>');
        const results = await Promise.all(cands.map(async ({ slug, label }) => {
            try { return { slug, label, obj: await fetchModsView(slug) }; }
            catch (e) { log('变体抓取失败', slug, e.message); return { slug, label, obj: null }; }
        }));
        const found = results.filter((r) => r.obj &&
            ((r.obj.normal && r.obj.normal.length) || SOURCE_GROUPS.some(([k]) => r.obj[k] && r.obj[k].length)));
        if (!found.length) { setBody('<div class="tb-vm-empty">未找到该类型的词缀数据。</div>'); return; }
        const showTab = (f) => { setTitle(_curCatText, poe2dbUrl(f.slug)); setBody(renderModsView(f.obj)); };
        clearTabs();
        found.forEach((f, idx) => {
            const tab = document.createElement('div');
            tab.className = 'tb-vm-tab' + (idx === 0 ? ' active' : '');
            tab.textContent = f.label;
            tab.addEventListener('click', () => {
                tabsEl.querySelectorAll('.tb-vm-tab').forEach((t) => t.classList.remove('active'));
                tab.classList.add('active');
                showTab(f);
            });
            tabsEl.appendChild(tab);
        });
        showTab(found[0]);
    }

    // 面板可见时轮询类型变化，自动刷新
    function tabVisible() {
        const shell = document.getElementById('tb-panel');
        return panelRoot && panelRoot.classList.contains('active') && !(shell && shell.classList.contains('collapsed'));
    }
    function watchCategoryChange() {
        let last = null, busy = false;
        setInterval(async () => {
            if (!tabVisible() || busy) return;
            busy = true;
            try {
                const cat = await resolveCategory();
                const id = cat ? cat.id : null;
                if (id !== last) { last = id; onTrigger(); }
            } finally { busy = false; }
        }, 1000);
    }

    function mount(panelEl) {
        panelRoot = panelEl;
        panelEl.innerHTML = `
            <div class="tb-vm-head"><span class="tb-vm-title">词缀</span></div>
            <div class="tb-vm-tabs"></div>
            <div class="tb-vm-body"><div class="tb-vm-empty">切换到此标签即查看当前所选物品类型的词缀。</div></div>`;
        bodyEl = panelEl.querySelector('.tb-vm-body');
        titleEl = panelEl.querySelector('.tb-vm-title');
        tabsEl = panelEl.querySelector('.tb-vm-tabs');
        bodyEl.addEventListener('click', (e) => {
            const head = e.target.closest('.tb-vm-famhead');
            if (head && bodyEl.contains(head)) head.parentElement.classList.toggle('open');
        });
        watchCategoryChange();
        return { onShow: onTrigger, onRefresh: onTrigger };
    }

    ctx.register({
        id: 'view-mods',
        label: '查看词缀',
        icon: '📜',
        scope: (c) => (c.isQQ || c.isIntl) && c.version === 'poe2',
        panel: true,
        mount,
    });
})();

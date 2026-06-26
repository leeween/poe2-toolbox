// PoE2 工具箱 —— 复制 PoB（隔离世界，内联功能）
// 物品数据由 MAIN 世界 pob-netcapture.main.js 经 postMessage 转发；词典从 chrome.storage.local 读，
// 缺失时触发后台下载+建表。翻译引擎移植自 scripts/poe2/poe2-trade-pob.user.js（与词典同一套归一化）。
(function () {
    'use strict';
    const ctx = window.PoE2TB;
    if (!ctx) return;

    const CONFIG = {
        rowSelectors: ['.results .row', '.resultset .row', '.results-list .row', 'div[class*="result"] .row'],
        buttonLeft: '10px',
        buttonBottom: '40px',
        debug: false,
    };
    const SENT = String.fromCharCode(1); // 与建表脚本一致的数字占位哨兵
    const log = (...a) => CONFIG.debug && console.log('%c[PoB]', 'color:#c8a165', ...a);
    const warn = (...a) => console.warn('[PoB]', ...a);

    // 捕获到的物品：按 result.id / item.id 建索引 + 有序列表兜底
    const itemsById = new Map();
    const orderedItems = [];

    // ── 词典（来自 chrome.storage.local，缺失时后台下载建表）─────────────
    let DICT = null;
    let downloading = false;
    function dict() { return DICT; }

    chrome.storage.local.get('pob-dict').then((r) => { if (r && r['pob-dict']) DICT = r['pob-dict']; });
    chrome.storage.onChanged.addListener((ch, area) => {
        if (area === 'local' && ch['pob-dict'] && ch['pob-dict'].newValue) DICT = ch['pob-dict'].newValue;
    });

    async function ensureDict() {
        if (DICT) return true;
        try {
            const r = await chrome.storage.local.get('pob-dict');
            if (r && r['pob-dict']) { DICT = r['pob-dict']; return true; }
        } catch (e) { /* ignore */ }
        if (downloading) return false;
        downloading = true;
        ctx.ui.toast('首次使用需下载词缀数据（约 5.7MB），请稍候…', 'info', 5000);
        const resp = await ctx.sendBg({ type: 'DICT_ENSURE' });
        downloading = false;
        if (resp && resp.success && resp.ready) {
            const r = await chrome.storage.local.get('pob-dict');
            if (r && r['pob-dict']) {
                DICT = r['pob-dict'];
                if (resp.stale) ctx.ui.toast('词典更新失败，沿用旧缓存', 'warning');
                return true;
            }
        }
        ctx.ui.toast('词典下载失败：' + ((resp && resp.error) || '未知错误'), 'error');
        return false;
    }

    // ── 1) 接收 MAIN 世界转发的物品数据 ──────────────────────────────
    function ingestFetchPayload(json) {
        try {
            const results = json && json.result;
            if (!Array.isArray(results)) return;
            let n = 0;
            for (const r of results) {
                if (!r || !r.item) continue;
                if (r.id) itemsById.set(String(r.id), r);
                if (r.item.id) itemsById.set(String(r.item.id), r);
                orderedItems.push(r);
                n++;
            }
            if (n) { log('捕获到', n, '个物品，累计', itemsById.size, '索引'); scheduleScan(); }
        } catch (e) { warn('解析物品数据失败', e); }
    }

    window.addEventListener('message', (e) => {
        if (e.source !== window) return;
        const d = e.data;
        if (d && d.__poe2tb_pob && d.payload) ingestFetchPayload(d.payload);
    });

    // ── 2) 翻译引擎（与 lib/dict-build.js 的归一化对齐）──────────────────
    const VAL_RE = /[+-]?[0-9]+(?:\.[0-9]+)?/g;
    const KEY_TOKEN_RE = /[+-]?(?:\{\d+\}|#|[0-9]+(?:\.[0-9]+)?)/g;
    const SENT_RE = new RegExp(SENT, 'g');

    function stripMarkup(s) {
        return s.replace(/\[[^\[\]|]*\|([^\[\]]*)\]/g, '$1').replace(/\[([^\[\]|]*)\]/g, '$1');
    }
    function normKey(s) {
        return s.replace(KEY_TOKEN_RE, SENT).replace(/\s+/g, ' ').trim().toLowerCase();
    }
    function candidateKeys(oneLine) {
        const variants = [];
        const push = (v) => { if (v && variants.indexOf(v) < 0) variants.push(v); };
        push(oneLine);
        push(oneLine.replace(/基础/g, '').replace(/^(该装备|本地)\s*/, ''));
        for (const v of variants.slice()) push(v.replace(/^[一-龥A-Za-z]{1,8}[：:]\s*/, ''));
        return variants.map(normKey);
    }
    function fillTemplate(tpl, values) {
        let i = 0;
        return tpl.replace(SENT_RE, (m, offset, str) => {
            let val = i < values.length ? values[i++] : '#';
            const prev = offset > 0 ? str[offset - 1] : '';
            if (prev === '+' || prev === '-') val = String(val).replace(/^[+-]/, '');
            return val;
        });
    }
    function translateLine(zhRaw) {
        const D = dict();
        if (!D || zhRaw == null) return null;
        const oneLine = stripMarkup(String(zhRaw)).replace(/\\n/g, '\n').replace(/[\r\n]+/g, ' ');
        const values = oneLine.match(VAL_RE) || [];
        for (const key of candidateKeys(oneLine)) {
            const tpl = D[key];
            if (tpl !== undefined) return fillTemplate(tpl, values);
        }
        return null;
    }
    function translateMods(arr, suffix) {
        if (!Array.isArray(arr)) return [];
        const out = [];
        for (const raw of arr) {
            const en = translateLine(raw);
            const line = en != null ? en : `${String(raw).replace(/[\r\n]+/g, ' ')}  「未翻译」`;
            for (const seg of line.split('\n')) out.push(suffix ? `${seg} ${suffix}` : seg);
        }
        return out;
    }
    function titleCase(s) {
        return s.replace(/\b([a-z])([a-z']*)/g, (_, a, b) => a.toUpperCase() + b);
    }
    function translateName(zhRaw) {
        const en = translateLine(zhRaw);
        return en != null ? titleCase(en) : String(zhRaw || '');
    }

    // ── 3) 由物品对象拼 PoB 导入文本 ─────────────────────────────────
    const RARITY_BY_FRAME = { 0: 'Normal', 1: 'Magic', 2: 'Rare', 3: 'Unique', 9: 'Relic' };

    function buildPobText(result) {
        const it = result.item || {};
        const lines = [];
        const rarity = RARITY_BY_FRAME[it.frameType] || (it.name ? 'Rare' : 'Normal');
        lines.push(`Rarity: ${rarity}`);

        const price = result.listing && result.listing.price;
        if (price && price.amount != null) lines.push(`${price.amount} ${price.currency || ''}`.trim());
        else if (it.name) lines.push(translateName(it.name));

        const base = translateName(it.baseType || it.typeLine || '');
        if (base) lines.push(base);
        lines.push('--------');

        const ext = it.extended || {};
        const propBlock = [];
        const quality = propValue(it.properties, ['品质']);
        if (quality) propBlock.push(`Quality: ${quality.replace(/[^0-9+%-]/g, '') || quality}`);
        if (ext.ar != null) propBlock.push(`Armour: ${ext.ar}`);
        if (ext.ev != null) propBlock.push(`Evasion Rating: ${ext.ev}`);
        if (ext.es != null) propBlock.push(`Energy Shield: ${ext.es}`);
        if (propBlock.length) { lines.push(...propBlock); lines.push('--------'); }

        if (Array.isArray(it.requirements) && it.requirements.length) {
            lines.push('Requirements:');
            for (const req of it.requirements) {
                const nm = translateName(req.name || '');
                const v = req.values && req.values[0] && req.values[0][0];
                if (v != null) lines.push(`${nm}: ${v}`);
            }
            lines.push('--------');
        }

        if (it.ilvl != null) { lines.push(`Item Level: ${it.ilvl}`); lines.push('--------'); }

        const SUFFIX = {
            enchantMods: '(enchant)', runeMods: '(rune)', implicitMods: '(implicit)',
            fracturedMods: '(fractured)', craftedMods: '(crafted)', explicitMods: '',
        };
        const TOP = ['enchantMods', 'scourgeMods', 'implicitMods'];
        const known = new Set(Object.keys(SUFFIX).concat(TOP));

        const topLines = [];
        for (const f of TOP) topLines.push(...translateMods(it[f], SUFFIX[f] || ''));
        if (topLines.length) { lines.push(...topLines); lines.push('--------'); }

        const mainLines = [];
        for (const f of ['runeMods', 'fracturedMods', 'explicitMods', 'craftedMods']) {
            mainLines.push(...translateMods(it[f], SUFFIX[f] || ''));
        }
        for (const f of Object.keys(it)) {
            if (/Mods$/.test(f) && !known.has(f) && Array.isArray(it[f])) {
                if (CONFIG.debug) log('额外词缀字段', f, it[f]);
                mainLines.push(...translateMods(it[f], ''));
            }
        }
        if (mainLines.length) { lines.push(...mainLines); lines.push('--------'); }

        if (it.corrupted) lines.push('Corrupted');
        while (lines.length && lines[lines.length - 1] === '--------') lines.pop();
        return lines.join('\n');
    }

    function propValue(props, namesZh) {
        if (!Array.isArray(props)) return null;
        for (const p of props) {
            if (!p) continue;
            const nm = String(p.name || '');
            if (namesZh.some((z) => nm.includes(z))) {
                const v = p.values && p.values[0] && p.values[0][0];
                if (v != null) return String(v);
            }
        }
        return null;
    }

    // ── 4) 在结果行注入按钮 ──────────────────────────────────────────
    function findRows() {
        for (const sel of CONFIG.rowSelectors) {
            const nodes = document.querySelectorAll(sel);
            if (nodes.length) return { sel, nodes: Array.from(nodes) };
        }
        return { sel: null, nodes: [] };
    }

    function resolveItemForRow(row, visibleIndex) {
        const scan = (el) => {
            if (!el || !el.attributes) return null;
            for (const attr of el.attributes) {
                const v = attr.value && String(attr.value).trim();
                if (v && itemsById.has(v)) return itemsById.get(v);
            }
            return null;
        };
        let hit = scan(row);
        if (hit) return hit;
        let p = row.parentElement, depth = 0;
        while (p && depth < 4 && !hit) { hit = scan(p); p = p.parentElement; depth++; }
        if (hit) return hit;
        const withId = row.querySelector('[data-id],[data-itemid],[id]');
        if (withId) { hit = scan(withId); if (hit) return hit; }
        if (orderedItems[visibleIndex]) { log('行', visibleIndex, '用顺序兜底匹配物品'); return orderedItems[visibleIndex]; }
        return null;
    }

    function makeButton() {
        const btn = document.createElement('button');
        btn.textContent = '复制PoB';
        btn.className = 'tb-pob-btn';
        btn.type = 'button';
        Object.assign(btn.style, {
            cursor: 'pointer', font: '12px/1.2 sans-serif', padding: '2px 8px', margin: '0',
            color: '#1b160e', background: 'linear-gradient(#e6c98a,#c8a165)',
            border: '1px solid #8a6d3b', borderRadius: '4px', zIndex: 20, whiteSpace: 'nowrap',
        });
        return btn;
    }
    function placeButton(row, btn) {
        if (getComputedStyle(row).position === 'static') row.style.position = 'relative';
        Object.assign(btn.style, { position: 'absolute', left: CONFIG.buttonLeft, bottom: CONFIG.buttonBottom, top: 'auto' });
        row.appendChild(btn);
    }
    async function copyText(text) {
        try { await navigator.clipboard.writeText(text); return true; }
        catch (e) {
            try {
                const ta = document.createElement('textarea');
                ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
                document.body.appendChild(ta); ta.select();
                const ok = document.execCommand('copy'); ta.remove(); return ok;
            } catch (e2) { return false; }
        }
    }
    function flash(btn, msg, ok) {
        const old = btn.dataset.label || '复制PoB';
        btn.textContent = msg;
        btn.style.background = ok ? 'linear-gradient(#a8d08a,#79b85b)' : 'linear-gradient(#d08a8a,#b85b5b)';
        setTimeout(() => { btn.textContent = old; btn.style.background = 'linear-gradient(#e6c98a,#c8a165)'; }, 1200);
    }

    function attachButtons() {
        const { sel, nodes } = findRows();
        if (!nodes.length) { log('未匹配到结果行，检查 CONFIG.rowSelectors'); return; }
        log('用选择器', JSON.stringify(sel), '匹配到', nodes.length, '个结果行；词典', dict() ? '已就绪' : '未就绪');
        nodes.forEach((row, idx) => {
            if (row.querySelector(':scope > .tb-pob-btn') || row.__tbPobDone) return;
            row.__tbPobDone = true;
            const btn = makeButton();
            btn.dataset.label = '复制PoB';
            btn.addEventListener('click', async (e) => {
                e.preventDefault();
                e.stopPropagation();
                const result = resolveItemForRow(row, idx);
                if (!result) { flash(btn, '无数据', false); warn('该行未匹配到物品数据'); return; }
                if (!dict()) {
                    btn.disabled = true; btn.textContent = '下载词典…';
                    const okDict = await ensureDict();
                    btn.disabled = false; btn.textContent = btn.dataset.label;
                    if (!okDict) { flash(btn, '词典失败', false); return; }
                }
                const text = buildPobText(result);
                if (CONFIG.debug) console.log('[PoB] 生成文本:\n' + text);
                const ok = await copyText(text);
                flash(btn, ok ? '已复制√' : '复制失败', ok);
            });
            placeButton(row, btn);
        });
    }

    let scanTimer = null;
    function scheduleScan() {
        clearTimeout(scanTimer);
        scanTimer = setTimeout(attachButtons, 200);
    }

    function init() {
        const mo = new MutationObserver(scheduleScan);
        mo.observe(document.documentElement, { childList: true, subtree: true });
        scheduleScan();
        log('已启动；词典', dict() ? '就绪' : '尚未就绪');
    }

    ctx.register({
        id: 'pob',
        label: '复制PoB',
        scope: (c) => c.isQQ && c.version === 'poe2',
        panel: false,
        init,
    });
})();

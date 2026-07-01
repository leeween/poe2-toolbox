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

    // MAIN 世界转发的 search 请求体里的类别 id（如 armour.chest）。
    // 物品 JSON 通常不带 category 字段，靠这个兜底给 resolveSlugsByCategory 用。
    let _lastSearchCat = null;
    window.addEventListener('message', (e) => {
        if (e.source !== window) return;
        const d = e.data;
        if (d && d.__poe2tb_search && d.category) _lastSearchCat = d.category;
    });

    // ── 词典（来自 chrome.storage.local，缺失时后台下载建表）─────────────
    let DICT = null;
    let downloading = false;
    function dict() { return DICT; }

    chrome.storage.local.get('pob-dict').then((r) => { if (r && r['pob-dict']) DICT = r['pob-dict']; });
    chrome.storage.onChanged.addListener((ch, area) => {
        if (area === 'local' && ch['pob-dict'] && ch['pob-dict'].newValue) DICT = ch['pob-dict'].newValue;
    });

    // ── 补充词典（按 slug 缓存 poe2db 中英配对结果，主词典未命中时回填）──
    // 触发：按物品 category（CATEGORY_MAP）展开成 slug 列表预取；jewel 走 resolveJewelSlug
    // 更精确（中文 typeLine 含基础 label，需按长度降序匹配 Time-Lost 子类型）。
    const JEWEL_SLUGS = [
        ['Ruby', '红玉'], ['Emerald', '翡翠'], ['Sapphire', '蓝玉'], ['Diamond', '宝钻'],
        ['Time-Lost_Ruby', '失落的红玉'], ['Time-Lost_Emerald', '失落的翡翠'],
        ['Time-Lost_Sapphire', '失落的蓝玉'], ['Time-Lost_Diamond', '失落的宝钻'],
    ];
    const fallbackBySlug = new Map(); // slug -> dict（不缓存 null：null 表示这次没拿到，下次重试）
    const fallbackInflight = new Map(); // slug -> Promise
    // 当前物品解析时上下文：translateLine 在主词典未命中时遍历这些 fallback 字典
    let activeFallbacks = [];

    function resolveJewelSlug(item) {
        if (!item) return null;
        // typeLine 是中文显示名（如「失落的翡翠」），baseType 可能是英文 base name（如「Time-Lost Emerald」）。
        // 两个都查；同时直接匹配英文 slug（如「Time-Lost_Emerald」/「Time-Lost Emerald」）。
        // 注意：Time-Lost 系列的中文 label 含基础 label（如「失落的翡翠」含「翡翠」），
        // 必须按 label 长度降序匹配，否则会误配到普通款（Emerald 而非 Time-Lost_Emerald）。
        const sorted = JEWEL_SLUGS.slice().sort((a, b) => b[1].length - a[1].length);
        const candidates = [
            String(item.typeLine || ''),
            String(item.baseType || ''),
            String(item.name || ''),
        ].filter(Boolean);
        for (const c of candidates) {
            for (const [slug, label] of sorted) {
                if (c.includes(label)) return slug;
            }
        }
        // 英文 base name 直配 slug：把空格/下划线统一后比对
        const norm = (s) => s.toLowerCase().replace(/[_\s]+/g, '');
        for (const c of candidates) {
            const cn = norm(c);
            for (const [slug] of sorted) {
                if (cn === norm(slug)) return slug;
            }
        }
        return null;
    }

    // 由 item.category（交易行类别 id）展开成 poe2db slug 列表。
    // 物品 JSON 一般不带 category，用 MAIN 世界转发的 search category 兜底。
    // 防具多变体一次性返回全部 7 个属性变体 slug —— 翻译时不知物品是哪种。
    function resolveSlugsByCategory(item) {
        const cat = globalThis.PoE2TBCat;
        if (!cat) return [];
        const id = (item && (item.category || (item.extended && item.extended.category))) || _lastSearchCat;
        return cat.slugsForCategory(id);
    }

    async function ensureFallback(slug) {
        if (!slug) return null;
        if (fallbackBySlug.has(slug)) return fallbackBySlug.get(slug);
        if (fallbackInflight.has(slug)) return fallbackInflight.get(slug);
        const p = (async () => {
            try {
                await ctx.sendBg({ type: 'POB_FALLBACK_ENSURE', slug });
                const get = await ctx.sendBg({ type: 'POB_FALLBACK_GET', slug });
                const d = (get && get.success && get.dict) ? get.dict : null;
                if (d) fallbackBySlug.set(slug, d); // 只缓存成功结果；null 不缓存，下次重试
                return d;
            } catch (e) {
                warn('补充词典失败', slug, e);
                return null;
            } finally {
                fallbackInflight.delete(slug);
            }
        })();
        fallbackInflight.set(slug, p);
        return p;
    }

    // 批量预取多个 slug 的补充词典。返回去重后的字典数组（按已缓存顺序，null 跳过）。
    // 失败的 slug 不抛错，只在 warn 里记一条；其他 slug 仍继续。
    async function ensureSlugs(slugs) {
        if (!Array.isArray(slugs) || !slugs.length) return [];
        await Promise.all(slugs.map((s) => ensureFallback(s)));
        const out = [];
        const seen = new Set();
        for (const s of slugs) {
            if (seen.has(s)) continue;
            seen.add(s);
            const d = fallbackBySlug.get(s);
            if (d) out.push(d);
        }
        return out;
    }

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
    // 词汇等价：集市 API 物品词缀用「X上限」(生命上限/能量护盾上限/魔力上限…)，
    // 而建表原料 lang-sc.json 对应词条用「最大X」。两边是同一英文概念的不同中译，
    // 补一个等价候选以命中字典（仅作额外候选，原措辞仍优先，错配只会查不到、不误翻）。
    function synonymVariant(s) {
        return s.replace(/([一-鿿]{1,8})上限/g, '最大$1');
    }
    function candidateKeys(oneLine) {
        const variants = [];
        const push = (v) => { if (v && variants.indexOf(v) < 0) variants.push(v); };
        push(oneLine);
        push(oneLine.replace(/基础/g, '').replace(/^(该装备|本地)\s*/, ''));
        for (const v of variants.slice()) push(v.replace(/^[一-龥A-Za-z]{1,8}[：:]\s*/, ''));
        for (const v of variants.slice()) push(synonymVariant(v)); // 上限 -> 最大（放最后）
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
    function translateLine(zhRaw, slug) {
        const D = dict();
        if (D && zhRaw != null) {
            const oneLine = stripMarkup(String(zhRaw)).replace(/\\n/g, '\n').replace(/[\r\n]+/g, ' ');
            const values = oneLine.match(VAL_RE) || [];
            for (const key of candidateKeys(oneLine)) {
                const tpl = D[key];
                if (tpl !== undefined) return fillTemplate(tpl, values);
            }
        }
        // 主词典未命中：查当前物品按 category/slug 加载的 poe2db 补充词典
        // 1) 显式 slug（jewel 精确子类型）优先
        // 2) 其余按 activeFallbacks（buildPobText 入口时由 ensureSlugs 填好）遍历
        const tryFb = (F) => {
            if (!F || zhRaw == null) return null;
            const oneLine = stripMarkup(String(zhRaw)).replace(/\\n/g, '\n').replace(/[\r\n]+/g, ' ');
            const values = oneLine.match(VAL_RE) || [];
            for (const key of candidateKeys(oneLine)) {
                const tpl = F[key];
                if (tpl !== undefined) return fillTemplate(tpl, values);
            }
            return null;
        };
        if (slug && fallbackBySlug.has(slug)) {
            const r = tryFb(fallbackBySlug.get(slug));
            if (r != null) return r;
        }
        for (const F of activeFallbacks) {
            const r = tryFb(F);
            if (r != null) return r;
        }
        return null;
    }
    // 词缀条目可能是字符串，也可能是对象（部分接口把词缀包成 {text/str/...: "中文词缀"}）。
    // 统一提取出可翻译的中文文本，避免 String(obj) 直接变成 "[object Object]"。
    let _warnedModObj = false;
    function modText(raw) {
        if (raw == null) return '';
        if (typeof raw === 'string') return raw;
        if (typeof raw !== 'object') return String(raw);
        // 常见承载完整词缀文本的字段（按可能性排序）：
        // 国服 trade2 把词缀包成 { description: 中文文本, hash: stat id, flags, mods:[...] }，
        // description 即整行文本；name(在 mods[].name) 是词条名而非整行，故不优先。
        for (const k of ['description', 'text', 'str', 'line', 'mod', 'display', 'displayText', 'content', 'value']) {
            if (typeof raw[k] === 'string' && raw[k].trim()) return raw[k];
        }
        // 未识别结构：打一次完整 JSON 供修正字段映射；同时兜底取一个像词缀文本的字符串属性
        if (!_warnedModObj) {
            _warnedModObj = true;
            warn('词缀是对象但未识别文本字段，请把此结构发给开发者修正：', JSON.stringify(raw));
        }
        for (const k of Object.keys(raw)) {
            const v = raw[k];
            if (typeof v === 'string' && v.trim().length > 1 && /[0-9一-鿿]/.test(v)) return v;
        }
        return '';
    }
    function translateMods(arr, suffix, slug) {
        if (!Array.isArray(arr)) return [];
        const out = [];
        for (const raw of arr) {
            const text = modText(raw);
            if (!text) continue; // 对象提取不到文本：跳过，不再输出 [object Object]
            const en = translateLine(text, slug);
            const line = en != null ? en : `${text.replace(/[\r\n]+/g, ' ')}  「未翻译」`;
            for (const seg of line.split('\n')) out.push(suffix ? `${seg} ${suffix}` : seg);
        }
        return out;
    }
    function titleCase(s) {
        return s.replace(/\b([a-z])([a-z']*)/g, (_, a, b) => a.toUpperCase() + b);
    }
    function translateName(zhRaw, slug) {
        const en = translateLine(zhRaw, slug);
        return en != null ? titleCase(en) : String(zhRaw || '');
    }

    // ── 3) 由物品对象拼 PoB 导入文本 ─────────────────────────────────
    const RARITY_BY_FRAME = { 0: 'Normal', 1: 'Magic', 2: 'Rare', 3: 'Unique', 9: 'Relic' };

    function buildPobText(result, slug) {
        const it = result.item || {};
        // 把已加载的 fallback 字典按当前物品对齐到 activeFallbacks，供 translateLine 遍历。
        // jewel 用精确 slug；其余按 category 展开的所有 slug 字典（已由 ensureSlugs 预取）。
        const fbList = [];
        if (slug && fallbackBySlug.has(slug)) fbList.push(fallbackBySlug.get(slug));
        for (const s of resolveSlugsByCategory(it)) {
            const d = fallbackBySlug.get(s);
            if (d && !fbList.includes(d)) fbList.push(d);
        }
        activeFallbacks = fbList;
        const lines = [];
        const rarity = RARITY_BY_FRAME[it.frameType] || (it.name ? 'Rare' : 'Normal');
        lines.push(`Rarity: ${rarity}`);

        const price = result.listing && result.listing.price;
        if (price && price.amount != null) lines.push(`${price.amount} ${price.currency || ''}`.trim());
        else if (it.name) lines.push(translateName(it.name, slug));

        const base = translateName(it.baseType || it.typeLine || '', slug);
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
                const nm = translateName(req.name || '', slug);
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
        // pseudoMods 是国服集市 UI 的加权求和面板数据（如「Sum: 41.5」「+42% 总闪电抗性」），
        // 不是真实词缀，PoB 不需要，显式跳过。
        const SKIP = new Set(['pseudoMods']);

        const topLines = [];
        for (const f of TOP) topLines.push(...translateMods(it[f], SUFFIX[f] || '', slug));
        if (topLines.length) { lines.push(...topLines); lines.push('--------'); }

        const mainLines = [];
        for (const f of ['runeMods', 'fracturedMods', 'explicitMods', 'craftedMods']) {
            mainLines.push(...translateMods(it[f], SUFFIX[f] || '', slug));
        }
        for (const f of Object.keys(it)) {
            if (/Mods$/.test(f) && !known.has(f) && !SKIP.has(f) && Array.isArray(it[f])) {
                if (CONFIG.debug) log('额外词缀字段', f, it[f]);
                mainLines.push(...translateMods(it[f], '', slug));
            }
        }
        if (mainLines.length) { lines.push(...mainLines); lines.push('--------'); }

        if (it.corrupted) lines.push('Corrupted');
        while (lines.length && lines[lines.length - 1] === '--------') lines.pop();
        activeFallbacks = [];
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

    // 仅按 id 命中真实物品（行 / 祖先 / 带 id 的后代）；命中不到返回 null，不做顺序兜底。
    // 用它来判定「这一行是不是真正的结果行」，避免给搜索/过滤区误匹配的 .row 加按钮。
    function resolveByScan(row) {
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
        while (p && depth < 4) { hit = scan(p); if (hit) return hit; p = p.parentElement; depth++; }
        const withId = row.querySelector('[data-id],[data-itemid],[id]');
        if (withId) { hit = scan(withId); if (hit) return hit; }
        return null;
    }

    function resolveItemForRow(row, visibleIndex) {
        const hit = resolveByScan(row);
        if (hit) return hit;
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
            // 只给能 id 命中真实物品的行加按钮：滤掉搜索/过滤区误匹配的 .row。
            // 不标记 __tbPobDone，等物品 JSON 到达后重扫时真实行还能补上。
            if (!resolveByScan(row)) return;
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
                const slug = resolveJewelSlug(result.item);
                const catSlugs = resolveSlugsByCategory(result.item);
                // jewel 精确 slug + category 展开的 slug 一起预取；去重
                const allSlugs = [...new Set([slug, ...catSlugs].filter(Boolean))];
                if (allSlugs.length) {
                    btn.disabled = true; btn.textContent = '补词典…';
                    try { await ensureSlugs(allSlugs); } catch (e) { warn('补充词典失败', allSlugs, e); }
                    btn.disabled = false; btn.textContent = btn.dataset.label;
                }
                const text = buildPobText(result, slug);
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
        scope: (c) => c.isQQ || c.isIntl,
        panel: false,
        init,
    });
})();

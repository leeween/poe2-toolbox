// PoE2 工具箱 —— PoB 补充词典建表（poe2db 中英文 ModsView -> {中文模板: 英文模板}）
// 主词典 lang-sc.json 不收录的词条（如 Time-Lost 珠宝的 radius/enchant 词缀），
// 用 poe2db 同一 slug 的中英文页 ModsView 配对建表补充。挂到 globalThis.PoE2FallbackBuild。
// 复用 PoE2Norm（与主词典同一归一化，确保 translateLine 的 candidateKeys 能命中）。
(function () {
    'use strict';

    // 去标签：把 <br> 转换行、<a>text</a> 取 text、其它标签全去。SW 里没 document，手写。
    function stripHtml(s) {
        return String(s || '')
            .replace(/<br\s*\/?>(?:\s*)/gi, '\n')
            .replace(/<[^>]+>/g, '')
            .replace(/&nbsp;/g, ' ')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'");
    }

    // poe2db 词缀模板里 tier 区间写作 (5—10) 或 (2-3)，物品 API 返回的是单数字（如 6%）。
    // 主词典（lang-sc.json）的词条也都是单数字，因此 fallback 词典的键/值也必须把区间
    // 折叠成单个占位符，否则物品单数字归一化后哨兵数对不上、命中不到。
    function foldRanges(s) {
        return String(s || '')
            .replace(/\(\s*[0-9]+(?:\.[0-9]+)?\s*[—–-]\s*[0-9]+(?:\.[0-9]+)?\s*\)/g, '#')
            .replace(/\(\s*[0-9]+(?:\.[0-9]+)?\s*\)/g, '#');
    }

    // 物品 API 的词缀文本与 poe2db 词条措辞有出入：poe2db 多了「该装备的」「基础的」等
    // 限定前缀（如「该装备的闪避值提高」），物品文本里没有。把这些中缀/前缀去掉，让
    // fallback key 与物品文本归一化后一致（与 content/pob-copy.js 的 candidateKeys 同源）。
    function normalizeZhAffix(s) {
        let z = String(s || '');
        z = z.replace(/该装备的/g, '').replace(/基础的/g, '');
        z = z.replace(/^(该装备|本地)\s*/, '');
        return z;
    }

    // 提取 data-keyword 序列（跨语言稳定锚点；CN/EN 都用英文键名）。
    function kwList(s) {
        const ks = [];
        const re = /data-keyword="([^"]+)"/g;
        let m;
        while ((m = re.exec(s))) ks.push(m[1]);
        return ks;
    }

    function kwSetSig(s) {
        const ks = kwList(s);
        ks.sort();
        return ks.join('|');
    }

    // 数字个数（用于二级区分同 family 的多条；在 stripHtml+foldRanges 之后的纯词缀文本上算）。
    function numCount(s) {
        return (String(s).match(/[0-9]+(?:\.[0-9]+)?/g) || []).length;
    }

    function famKey(x) {
        return [
            (x.ModFamilyList || []).join('|'),
            String(x.ModGenerationTypeID),
            String(x.Level || ''),
            String(x.type || ''),
        ].join('§');
    }

    // 配对策略：
    //   1) Code 完全相等（最稳，但中英侧 Code 偶尔不同，仅作首选）
    //   2) famKey 唯一时直接配
    //   3) 同 famKey 多条：用 kwSetSig + numCount 二级区分，仍唯一则配
    //   4) 仍配不上的跳过（宁缺勿错，避免误翻）
    function pairGroup(cnArr, enArr) {
        const pairs = [];
        if (!Array.isArray(cnArr) || !Array.isArray(enArr)) return pairs;

        const cnByCode = new Map(), enByCode = new Map();
        for (const x of cnArr) { if (x.Code) { if (!cnByCode.has(x.Code)) cnByCode.set(x.Code, []); cnByCode.get(x.Code).push(x); } }
        for (const x of enArr) { if (x.Code) { if (!enByCode.has(x.Code)) enByCode.set(x.Code, []); enByCode.get(x.Code).push(x); } }

        const usedCn = new Set(), usedEn = new Set();
        const cnRef = cnArr.map((x, i) => [x, i]);
        const enRef = enArr.map((x, i) => [x, i]);

        // 1) Code 相等
        for (const [code, cs] of cnByCode) {
            const es = enByCode.get(code);
            if (!es) continue;
            const n = Math.min(cs.length, es.length);
            for (let i = 0; i < n; i++) {
                pairs.push([cs[i], es[i]]);
                usedCn.add(cnArr.indexOf(cs[i])); usedEn.add(enArr.indexOf(es[i]));
            }
        }

        // 2/3) 剩余按 famKey 分桶
        const cnLeft = cnRef.filter(([x, i]) => !usedCn.has(i));
        const enLeft = enRef.filter(([x, i]) => !usedEn.has(i));
        const cnFam = new Map(), enFam = new Map();
        for (const [x, i] of cnLeft) { const k = famKey(x); if (!cnFam.has(k)) cnFam.set(k, []); cnFam.get(k).push([x, i]); }
        for (const [x, i] of enLeft) { const k = famKey(x); if (!enFam.has(k)) enFam.set(k, []); enFam.get(k).push([x, i]); }

        for (const [k, cs] of cnFam) {
            const es = enFam.get(k);
            if (!es || !es.length) continue;
            if (cs.length === 1 && es.length === 1) {
                pairs.push([cs[0][0], es[0][0]]);
                usedCn.add(cs[0][1]); usedEn.add(es[0][1]);
                continue;
            }
            // 3) 多对多：按 kwSetSig + numCount 二级分桶（在 stripHtml+foldRanges 后的纯文本上算）
            const cnSub = new Map(), enSub = new Map();
            for (const [x, i] of cs) {
                const t = foldRanges(stripHtml(x.str));
                const sk = kwSetSig(x.str) + '§' + numCount(t);
                if (!cnSub.has(sk)) cnSub.set(sk, []); cnSub.get(sk).push([x, i]);
            }
            for (const [x, i] of es) {
                const t = foldRanges(stripHtml(x.str));
                const sk = kwSetSig(x.str) + '§' + numCount(t);
                if (!enSub.has(sk)) enSub.set(sk, []); enSub.get(sk).push([x, i]);
            }
            for (const [sk, cc] of cnSub) {
                const ee = enSub.get(sk);
                if (!ee) continue;
                const n = Math.min(cc.length, ee.length);
                for (let i = 0; i < n; i++) {
                    pairs.push([cc[i][0], ee[i][0]]);
                    usedCn.add(cc[i][1]); usedEn.add(ee[i][1]);
                }
            }
        }
        return pairs;
    }

    function build(cnView, enView) {
        const N = globalThis.PoE2Norm;
        const dict = {};
        if (!cnView || !enView) return dict;
        const groups = new Set([...Object.keys(cnView), ...Object.keys(enView)]);
        for (const g of groups) {
            const cnArr = cnView[g], enArr = enView[g];
            if (!Array.isArray(cnArr) || !Array.isArray(enArr)) continue;
            const pairs = pairGroup(cnArr, enArr);
            for (const [cn, en] of pairs) {
                // 物品 API 词缀只给主行；poe2db str 里 <br> 后的 secondary 行
                // (如 "local jewel effect base radius [500]") 不会出现在物品文本里，
                // 建表时只取首行，避免 key 带后缀命中不到。
                const zhText = normalizeZhAffix(foldRanges(stripHtml(cn.str)).split('\n')[0].trim());
                const enText = foldRanges(stripHtml(en.str)).split('\n')[0].trim();
                if (!zhText || !enText) continue;
                const key = N.makeZhKey(zhText);
                const tpl = N.makeEnTemplate(enText);
                if (!key || !tpl) continue;
                if (dict[key] === undefined) dict[key] = tpl;
            }
        }
        return dict;
    }

    globalThis.PoE2FallbackBuild = { build, pairGroup, stripHtml, kwSetSig, numCount, famKey };
})();

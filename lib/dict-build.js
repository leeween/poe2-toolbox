// PoE2 工具箱 —— 反向词典建表（中文模板 -> 英文模板）
// 与 scripts/poe2/poe2-pob-dict-build.py 的 main() 一比一移植，挂到 globalThis.PoE2DictBuild。
// 输入：{ 英文原文: 简体中文 } 的原料对象（lang-sc.json 解析后）。
// 输出：{ 中文归一化模板: 英文模板 }，与旧 poe2-pob-dict.user.js 的 window.__POE2_POB_DICT__ 等价。
(function () {
    'use strict';

    function build(data) {
        const N = globalThis.PoE2Norm;
        const SENT = N.SENT;
        const countSent = (s) => {
            let c = 0;
            for (let i = 0; i < s.length; i++) if (s[i] === SENT) c++;
            return c;
        };

        // 中文键 -> [{ tpl, sent, alias, hasHash, hasBrace }]
        const buckets = new Map();
        const push = (key, meta) => {
            let arr = buckets.get(key);
            if (!arr) { arr = []; buckets.set(key, arr); }
            arr.push(meta);
        };

        for (const en in data) {
            const zh = data[en];
            if (typeof en !== 'string' || typeof zh !== 'string') continue;
            const key = N.makeZhKey(zh);
            if (!key) continue;
            const tpl = N.makeEnTemplate(en);
            if (!tpl) continue;
            // 来源占位符风格：'#' 多为物品/天赋词条描述（物品翻译要的就是这种），
            // '{0}' 多为技能宝石描述。据此在同键多英文时优先选 '#' 形。
            const hasHash = en.includes('#');
            const hasBrace = en.includes('{');
            const sent = countSent(tpl);
            push(key, { tpl, sent, alias: false, hasHash, hasBrace });
            for (const ak of N.aliasZhKeys(zh)) {
                if (ak && ak !== key) push(ak, { tpl, sent, alias: true, hasHash, hasBrace });
            }
        }

        // 取舍优先级（与 Python sorted key 完全一致；Array.sort 稳定，平手按原始顺序）：
        //   别名优先 > 源含 '#' > 避开 '{0}'(hasBrace) > 哨兵数与键一致 > 更短英文
        const final = {};
        for (const [key, cands] of buckets) {
            const want = countSent(key);
            const rank = (c) => [
                c.alias ? 0 : 1,
                c.hasHash ? 0 : 1,
                c.hasBrace ? 1 : 0,
                c.sent === want ? 0 : 1,
                c.tpl.length,
            ];
            const indexed = cands.map((c, i) => [c, i]);
            indexed.sort((A, B) => {
                const ra = rank(A[0]), rb = rank(B[0]);
                for (let i = 0; i < ra.length; i++) {
                    if (ra[i] !== rb[i]) return ra[i] - rb[i];
                }
                return A[1] - B[1]; // 稳定：平手按原始插入顺序
            });
            final[key] = indexed[0][0].tpl;
        }
        return final;
    }

    globalThis.PoE2DictBuild = { build };
})();

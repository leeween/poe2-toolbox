// PoE2 工具箱 —— PoB 补充词典正确性闸门
// 用 lib/pob-fallback-build.js 对 poe2db Time-Lost_Emerald 中英文页 ModsView 配对建表，
// 断言 4 条线上未翻译词条能被补充词典命中（不再带「未翻译」标记）。
//
// 用法：
//   node tools/verify-pob-fallback.mjs
//   POE2_FIXTURE_DIR=/path node tools/verify-pob-fallback.mjs   // 离线：从目录读 .cn.html / .en.html
//
// fixture 目录约定：${POE2_FIXTURE_DIR}/Time-Lost_Emerald.cn.html 和 .en.html
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
// 载入归一化 + 建表（非模块脚本，挂 globalThis）
vm.runInThisContext(fs.readFileSync(path.join(dir, '../lib/dict-normalize.js'), 'utf8'));
vm.runInThisContext(fs.readFileSync(path.join(dir, '../lib/poe2db-parse.js'), 'utf8'));
vm.runInThisContext(fs.readFileSync(path.join(dir, '../lib/pob-fallback-build.js'), 'utf8'));

const SLUG = 'Time-Lost_Emerald';
const FIXTURE_DIR = process.env.POE2_FIXTURE_DIR || '';
const CN_URL = globalThis.PoE2DBParse.poe2dbUrl('cn', SLUG);
const EN_URL = globalThis.PoE2DBParse.poe2dbUrl('en', SLUG);

async function fetchHtml(url) {
    const res = await fetch(url, { credentials: 'omit' });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
    return res.text();
}

async function loadModsViews() {
    let cnHtml, enHtml;
    if (FIXTURE_DIR) {
        cnHtml = fs.readFileSync(path.join(FIXTURE_DIR, `${SLUG}.cn.html`), 'utf8');
        enHtml = fs.readFileSync(path.join(FIXTURE_DIR, `${SLUG}.en.html`), 'utf8');
    } else {
        [cnHtml, enHtml] = await Promise.all([fetchHtml(CN_URL), fetchHtml(EN_URL)]);
    }
    const cn = globalThis.PoE2DBParse.extractModsViewJson(cnHtml);
    const en = globalThis.PoE2DBParse.extractModsViewJson(enHtml);
    if (!cn) throw new Error('未从中文页解析到 ModsView');
    if (!en) throw new Error('未从英文页解析到 ModsView');
    return { cn, en };
}

// 与 content/features/pob-copy.js 的 translateLine 同一套归一化 + candidateKeys（精简版，
// 只需验命中：能取到非空英文模板即视为翻译成功）。
const SENT = globalThis.PoE2Norm.SENT;
const VAL_RE = /[+-]?[0-9]+(?:\.[0-9]+)?/g;
const KEY_TOKEN_RE = /[+-]?(?:\{\d+\}|#|[0-9]+(?:\.[0-9]+)?)/g;
const SENT_RE = new RegExp(SENT, 'g');

function stripMarkup(s) {
    return s.replace(/\[[^\[\]|]*\|([^\[\]]*)\]/g, '$1').replace(/\[([^\[\]|]*)\]/g, '$1');
}
function normKey(s) {
    return s.replace(KEY_TOKEN_RE, SENT).replace(/\s+/g, ' ').trim().toLowerCase();
}
function synonymVariant(s) {
    return s.replace(/([一-鿿]{1,8})上限/g, '最大$1');
}
function candidateKeys(oneLine) {
    const variants = [];
    const push = (v) => { if (v && variants.indexOf(v) < 0) variants.push(v); };
    push(oneLine);
    push(oneLine.replace(/基础/g, '').replace(/^(该装备|本地)\s*/, ''));
    for (const v of variants.slice()) push(v.replace(/^[一-龥A-Za-z]{1,8}[：:]\s*/, ''));
    for (const v of variants.slice()) push(synonymVariant(v));
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
function translateLine(zhRaw, dict) {
    if (!dict || zhRaw == null) return null;
    const oneLine = stripMarkup(String(zhRaw)).replace(/\\n/g, '\n').replace(/[\r\n]+/g, ' ');
    const values = oneLine.match(VAL_RE) || [];
    for (const key of candidateKeys(oneLine)) {
        const tpl = dict[key];
        if (tpl !== undefined) return fillTemplate(tpl, values);
    }
    return null;
}

const TARGETS = [
    { zh: '范围内的核心天赋同时提供 [Attack|攻击]伤害的[CriticalDamageBonus|暴击伤害加成] 6%', expect: ['Critical', 'Damage', 'Bonus'] },
    { zh: '范围内的核心天赋同时提供 [Attack|攻击][Critical|暴击率]提高 7%', expect: ['Critical', 'Hit', 'Chance'] },
    { zh: '将范围升级为极大型', expect: ['Radius', 'Very Large'] },
    { zh: '范围内的核心天赋同时提供 全局[Armour|护甲]，[Evasion|闪避]与[EnergyShield|能量护盾]提高 3%', expect: ['Armour', 'Evasion', 'Energy Shield'] },
    { zh: '范围内的[SmallPassive|小型天赋]同时提供 [Evasion|闪避值]提高 3%', expect: ['Evasion', 'Rating'] },
];

const { cn, en } = await loadModsViews();
const t0 = Date.now();
const dict = globalThis.PoE2FallbackBuild.build(cn, en);
console.log(`补充词典建表完成：${Object.keys(dict).length} 键，用时 ${Date.now() - t0}ms`);

let pass = 0;
const fails = [];
for (const t of TARGETS) {
    const en = translateLine(t.zh, dict);
    const ok = !!en && !en.includes('未翻译') && t.expect.every((kw) => en.includes(kw));
    console.log(`${ok ? '✅' : '❌'} ${t.zh}`);
    console.log(`   -> ${en || '(null)'}`);
    if (ok) pass++;
    else fails.push(t.zh);
}

console.log(`\n${pass}/${TARGETS.length} 通过`);
if (pass !== TARGETS.length) {
    console.error('未通过：\n  ' + fails.join('\n  '));
    process.exit(1);
}
process.exit(0);

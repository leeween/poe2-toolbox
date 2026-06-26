// PoE2 工具箱 —— 词典建表正确性闸门
// 用 lib/dict-build.js（移植自 Python）对 lang-sc.json 现场建表，与旧
// poe2-pob-dict.user.js 的 window.__POE2_POB_DICT__ 逐键比较，目标：0 偏差。
//
// 用法：
//   node tools/verify-dict.mjs [lang-sc.json 路径] [poe2-pob-dict.user.js 路径]
// 缺省路径指向 ~/Documents/vibe-work/scripts/poe2/ 下的两份参考文件。
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const refBase = path.resolve(dir, '../../../../vibe-work/scripts/poe2');
const SRC = process.argv[2] || path.join(refBase, 'poe2-lang-sc.json');
const REF = process.argv[3] || path.join(refBase, 'poe2-pob-dict.user.js');

// 载入归一化 + 建表（非模块脚本，挂 globalThis）
vm.runInThisContext(fs.readFileSync(path.join(dir, '../lib/dict-normalize.js'), 'utf8'));
vm.runInThisContext(fs.readFileSync(path.join(dir, '../lib/dict-build.js'), 'utf8'));

console.log('源料:', SRC);
console.log('参考:', REF);

const data = JSON.parse(fs.readFileSync(SRC, 'utf8'));
const t0 = Date.now();
const built = globalThis.PoE2DictBuild.build(data);
console.log(`JS 建表完成：${Object.keys(built).length} 键，用时 ${Date.now() - t0}ms`);

// 解析参考文件里的 window.__POE2_POB_DICT__ = {...};
const refText = fs.readFileSync(REF, 'utf8');
const anchor = refText.indexOf('__POE2_POB_DICT__');
if (anchor === -1) { console.error('参考文件未找到 __POE2_POB_DICT__'); process.exit(2); }
const start = refText.indexOf('{', anchor);
const end = refText.lastIndexOf('}');
const ref = JSON.parse(refText.slice(start, end + 1));
console.log(`参考词典：${Object.keys(ref).length} 键`);

const builtKeys = Object.keys(built);
const refKeys = Object.keys(ref);
const builtSet = new Set(builtKeys);
const refSet = new Set(refKeys);

let missing = 0, extra = 0, valDiff = 0;
const samples = [];
for (const k of refKeys) if (!builtSet.has(k) && missing++ < 1e9 && samples.length < 8) samples.push(['缺失(参考有/未建出)', JSON.stringify(k)]);
for (const k of builtKeys) if (!refSet.has(k) && extra++ < 1e9 && samples.length < 16) samples.push(['多余(建出/参考无)', JSON.stringify(k)]);
for (const k of builtKeys) {
    if (refSet.has(k) && built[k] !== ref[k]) {
        valDiff++;
        if (samples.length < 30) samples.push(['值不一致', JSON.stringify(k), 'ref=' + JSON.stringify(ref[k]), 'js=' + JSON.stringify(built[k])]);
    }
}

console.log('\n===== 偏差统计 =====');
console.log('缺失(参考有/JS未建出):', missing);
console.log('多余(JS建出/参考无)  :', extra);
console.log('值不一致              :', valDiff);
if (samples.length) {
    console.log('\n----- 样例 -----');
    samples.forEach((s) => console.log(...s));
}

const total = missing + extra + valDiff;
console.log('\n总偏差:', total, total === 0 ? '✅ 通过' : '❌ 未通过');
process.exit(total === 0 ? 0 : 1);

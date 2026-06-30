# AGENTS.md

本文件指导 Codex 在 **poe2-toolbox** 仓库工作。动手前先读这里。

## 这个项目是什么

流放之路2 集市增强的 **Chrome MV3 插件**，统一侧边栏、功能可逐项开关。它把原先分散的三处整合成一个工具箱：
- 旧插件 `poe2-trading-tencent`（搜索历史 + 收藏/文件夹/导入导出）—— 已 1:1 迁移。
- 油猴脚本 `scripts/poe2`（同一工作区）的 **复制PoB**（含原 4.9MB 词典）和 **查看词缀**（poe2db）—— 已并入。
- 新增 **妄想症统计**：从 poe.ninja 构筑列表统计 Megalomaniac 天赋词条，支持天赋详情、天赋 ID、购买链接和最近一次结果缓存。

> 前两个来源是**只读参考**，不要改它们。本仓库是迁移后的唯一维护点。
> 暴击检查（`poe2-crit-craft-check.user.js`）本期未迁。

## 开发约定

- **无构建步骤**：原生 JS、classic script + `importScripts` + 全局命名空间（沿用旧插件/codex-auto 习惯）。不要引入 pnpm/打包/TS/lint。
- 改完 JS 一律 `node --check <file>` 验证语法。
- 加载：`chrome://extensions` → 开发者模式 → 加载已解压 → 选本目录；改完点扩展的「刷新」重载。content script 改动还需刷新目标页面。
- 提交信息结尾加：`Co-Authored-By: Codex Opus 4.8 <noreply@anthropic.com>`。

## 架构：三个执行世界

```
[MAIN 世界, document_start]  content/pob-netcapture.main.js
  唯一职责：劫持页面 fetch/XHR，捕获 /api/trade2/fetch/ 物品 JSON 与 /api/trade2/search 类别，
  → window.postMessage 转发给隔离世界（隔离世界拿不到页面的 fetch，所以这一步必须在 MAIN）
        ↓ postMessage  ({__poe2tb_pob, payload} / {__poe2tb_search, category})
[隔离世界, content_scripts]  content/{ctx,shell}.js + features/*
  侧边栏 UI、按钮注入、翻译、剪贴板、DOM 扫描、chrome.* API、直接读 chrome.storage.local
        ↓ chrome.runtime.sendMessage  (ctx.sendBg)
[后台 SW, classic]  background/*
  跨域抓取(poe2db / ninja 词典源)、词典建表/缓存、收藏与历史存储 CRUD、LZ-String 压缩
```

### 目录与加载顺序

content（manifest `js:[...]` 有序加载，靠全局 `window.PoE2TB` 串联，无 import）：
`content/ctx.js` → `features/{history,favorites,pob-copy,view-mods,megalomaniac}.js` → `content/shell.js`

- `content/ctx.js` — 共享上下文 `window.PoE2TB`：站点/版本探测、功能注册表、版本化存储、`sendBg`、`search`(交易参数解析)、`util`。
- `content/shell.js` — **最后加载**：注入 `ctx.ui`(toast/confirm/input)、构建侧边栏、按 scope+开关挂载功能。
- `content/features/*.js` — 各功能，加载时 `PoE2TB.register({...})`。
- `content/pob-netcapture.main.js` — MAIN 世界劫持脚本（独立 content_scripts 条目，`world:"MAIN"`）。

background（`importScripts` 顺序，见 `service-worker.js`，靠 `self.TB` 串联）：
`lib/lz-string.js` → `lib/dict-normalize.js` → `lib/dict-build.js` → `background/{storage,favorites,dict,poe2db,poe-ninja}.js`

## 加新功能（扩展点）

在 `content/features/` 新建一个文件，IIFE 里 `window.PoE2TB.register(feature)`，并把文件加进 manifest 的 content `js` 数组（**放在 shell.js 之前**）。feature 形状：

```js
PoE2TB.register({
  id: 'xxx', label: '显示名', icon: '🔧',
  scope: (ctx) => ctx.isQQ && ctx.version === 'poe2', // 在哪些页面生效
  panel: true,                       // true=渲染成侧边栏 tab；false=纯内联
  mount(panelEl, ctx) { /* 填面板 */ return { onShow, onRefresh, onClear }; }, // panel 用
  init(ctx) { /* 跑一次 */ },          // inline 用
});
```

还要在 `options/options.js` 的 `FEATURES` 数组加一项（设置页开关 UI 与之对应）。不改 shell。

## 消息协议

- 内容 → 后台：`ctx.sendBg({ type, ... })`（自动带 `version`）。后台 `TB.on(type, async req => ({...}))`，返回对象并入 `{success:true, ...}` 响应；抛错则 `{success:false, error}`。
- 已有 type：历史 `SAVE/GET/DELETE/CLEAR_SEARCH_RECORD/HISTORY`；收藏 `SAVE/GET/DELETE/CLEAR_FAVORITE(S)`、`MOVE_TO_FOLDER/ROOT`、`ADD_TO_FOLDER`、`DELETE/RENAME_FOLDER`、`EXPORT/IMPORT_FOLDER`；词典 `DICT_STATUS/ENSURE/REFRESH/IMPORT`；词缀 `POE2DB_FETCH`；妄想症 `POE_NINJA_MEGALOMANIAC`、`POE_NINJA_PASSIVE_DETAILS`；`OPEN_OPTIONS`。
- MAIN → 隔离：`window.postMessage`，类型 `__poe2tb_pob`(物品) / `__poe2tb_search`(类别)。

## 各功能 scope / host 对照

| 功能 | id | 形态 | scope | 生效页面 |
|---|---|---|---|---|
| 搜索历史 | history | tab | 国服 | `poe.game.qq.com/trade*` `/trade2*` |
| 收藏管理 | favorites | tab | 国服 | 同上 |
| 复制PoB | pob | 内联按钮 | 国服 + poe2 | `poe.game.qq.com/trade2*` |
| 查看词缀 | view-mods | tab | poe2(国服+国际服) | `poe.game.qq.com/trade2*` `www.pathofexile.com/trade2*` |
| 妄想症统计 | megalomaniac | tab | poe2(国服+国际服) | `poe.game.qq.com/trade2*` `www.pathofexile.com/trade2*` |

`host_permissions`：`poe2db.tw`（查看词缀抓取、天赋树详情）、`ninja.710421059.xyz`（词典原料）、`poe.ninja`（妄想症统计）。`permissions` 含 `unlimitedStorage`（词典与统计缓存存 storage.local）。

## PoB 词典子系统（方案 A）+ 正确性闸门

- **不打包词典**。首次点「复制PoB」时后台从 `ninja.710421059.xyz/lang-sc.json` 下载原料（英文→中文，~5.7MB），用 JS **反向建表**后存 `chrome.storage.local['pob-dict']`（+ `pob-dict-meta`）。TTL 14 天；过期发 `If-None-Match` 条件请求，304 只刷时间戳；下载/建表失败时沿用旧缓存（stale-while-error）；设置页可手动导入。
- 内容脚本 `pob-copy.js` **直接读** `storage.local['pob-dict']`（内容脚本可直读扩展存储，省去 4.9MB 消息传递），缺失时发 `DICT_ENSURE` 触发后台建表。
- **建表 = 翻译 = 单一归一化源**：`lib/dict-normalize.js`(`globalThis.PoE2Norm`) 被建表(`lib/dict-build.js`)与翻译(`pob-copy.js`)共用；它一比一移植自 `scripts/poe2/poe2-pob-dict-build.py`（含一处关键差异：自定义 Python 空白语义，**不吞 BOM**，否则与 Python 输出不一致）。
- **改了归一化/建表逻辑后必须跑闸门**：
  ```
  node tools/verify-dict.mjs
  ```
  它用 JS 建表 vs 旧 `scripts/poe2/poe2-pob-dict.user.js` 逐键 diff，**目标 0 偏差**。参考文件路径用命令行参数或环境变量 `POE2_REF_DIR` 指定（缺省指向同一工作区的 `scripts/poe2`）。
- 哨兵用 `String.fromCharCode(1)`（U+0001），勿写成字面控制字符或空串。

## 妄想症统计

- 前端入口：`content/features/megalomaniac.js`，侧边栏 tab，id 为 `megalomaniac`，设置页开关在 `options/options.js`。
- 后台入口：`background/poe-ninja.js`，消息类型 `POE_NINJA_MEGALOMANIAC`（统计）和 `POE_NINJA_PASSIVE_DETAILS`（天赋详情）。
- 输入是 poe.ninja builds 链接和账号数量（10-100）。后台先通过 `/poe2/api/data/index-state` 用链接里的 league 找 snapshot version，再请求 `/search` protobuf，解析 `name/account` 列并串行请求 `/character`。
- `/character` 请求之间固定等待 1200ms，避免快速触发 poe.ninja 限流；遇到 429 时停止继续请求，并把限流信息返回前端展示。
- Megalomaniac 的 `enchantMods` 只做词条统计，不做组合统计；英文词条通过当前 PoB 词典缓存反查中文，插件运行时不要改为读取 `statics/lang-sc.json`。
- 天赋详情默认 URL：`https://poe2db.tw/data/passive-skill-tree/4.5/data_cn.json`。详情以 name 匹配，展示 `stats`，购买 ID 优先用节点 `skill` 字段，缺失时才回退 `connections[0].id`。
- 前端缓存键：`megalomaniac-last-input`（上次输入）、`megalomaniac-last-result`（上次统计结果/勾选/服务器）、`megalomaniac-passive-url`（天赋详情 URL）、`megalomaniac-passive-cache`（天赋详情数据）。
- 购买链接 payload 需要有外层 `query`，`stats` 中保留一个空 `and` 和一个 `count`，`count.value.min` 固定为 2，只替换 `filters` 里的 `enchant.stat_2954116742|<id>`。
- 本地调试脚本：`node tools/poe-ninja-megalomaniac.mjs "<poe.ninja builds 链接>" 20`。该脚本使用 `statics/lang-sc.json` 便于本地调试，插件运行时仍走 PoB 词典缓存。

## 真机待调点（调不通先看这里）

- **复制PoB 按钮不出现/匹配错行**：`content/features/pob-copy.js` 的 `CONFIG.rowSelectors`、`resolveItemForRow`、按钮定位 `CONFIG.buttonLeft/buttonBottom`；把 `CONFIG.debug=true` 看日志。
- **查看词缀读不到当前类型**：`content/features/view-mods.js` 的 `resolveCategory`（filters API + DOM 文字精确匹配 + MAIN search 兜底）；类别→slug 映射在 `CATEGORY_MAP`。
- **词缀页不支持**：`CATEGORY_MAP` 缺该类别，或 poe2db 无独立词缀页。
- **妄想症统计耗时长/部分失败**：先看是否命中 poe.ninja 429；这是限流，不等于账号失效。账号数量越多耗时越久，前端会缓存最后一次成功结果。

## 与旧数据

新插件 ID 与旧插件不同，旧插件历史/收藏**不会自动带过来**；存储 schema（`poe1-`/`poe2-` 前缀键）保持一致，可后续在设置页加「从旧插件导出码导入」（未做）。

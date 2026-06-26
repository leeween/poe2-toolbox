# PoE2 工具箱（poe2-toolbox）

流放之路2 集市增强的 Chrome MV3 插件，把原先分散的脚本整合成一个**统一侧边栏**、功能可逐项开关的工具箱：

- **搜索历史** — 自动记录国服集市搜索（POE1 / POE2，数据隔离）。
- **收藏管理** — 收藏 / 文件夹 / 拖拽 / LZ-String 压缩导入导出（国服）。
- **复制 PoB** — 在搜索结果行加「复制PoB」按钮，直接复制 Path of Building 可导入的英文物品文本（国服 POE2）。
- **查看词缀** — 选择物品类型后查看该类型在 poe2db 上的全部可出词缀（国服 + 国际服 POE2）。

## 安装

1. `chrome://extensions` → 打开「开发者模式」
2. 「加载已解压的扩展程序」→ 选择本目录 `poe2-toolbox/`
3. 打开集市页（如 `https://poe.game.qq.com/trade2/...`），右侧出现侧边栏；点击插件图标可开合。

设置页（右键插件图标 → 选项，或侧边栏 ⚙）可逐功能开关、管理 PoB 词典。

## 架构（无构建，原生 JS）

三个执行世界分工：

```
[MAIN 世界]  content/pob-netcapture.main.js   劫持 fetch/XHR 抓物品 JSON → postMessage
[隔离世界]   content/{ctx,shell}.js + features/*  侧边栏 UI / 注入 / 翻译 / chrome.* / 剪贴板
[后台 SW]    background/*                       跨域抓取(poe2db/词典源) / 词典建表 / 存储 CRUD
```

- `content/ctx.js` — 共享上下文：版本探测、功能注册表、版本化存储、后台消息、工具函数。
- `content/shell.js` — 侧边栏外壳 + UI 服务（toast/对话框）+ 按 scope/开关挂载功能。
- `content/features/*.js` — 各功能模块，加载时 `PoE2TB.register(...)`。新增功能 = 新增一个文件并注册，不动 shell。
- `background/service-worker.js` — 消息路由（`TB.on(type, handler)`），其余后台模块经 `importScripts` 引入。

## PoB 词典

「复制PoB」依赖中文→英文反向翻译词典。词典**不打包**：首次使用时从 `https://ninja.710421059.xyz/lang-sc.json` 下载原料（英文→中文，约 5.7MB），在本地用 JS 反向建表后缓存到 `chrome.storage.local`，设有效期；过期会条件请求（ETag）增量校验，下载失败时沿用旧缓存。也可在设置页手动导入本地 JSON。

建表逻辑（`lib/dict-build.js` + `lib/dict-normalize.js`）由 `scripts/poe2/poe2-pob-dict-build.py` 移植而来，`tools/verify-dict.mjs` 用于校验两者输出逐键一致。

## 开发

- 无构建步骤；改完 JS 用 `node --check <file>` 验证语法。
- 词典建表正确性：`node tools/verify-dict.mjs`（需要 `scripts/poe2/` 的 `poe2-lang-sc.json` 与 `poe2-pob-dict.user.js` 作参考）。
- 改完在 `chrome://extensions` 点扩展的「刷新」重新加载。

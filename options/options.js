// PoE2 工具箱 —— 设置页脚本
'use strict';

const ENABLED_KEY = 'tb-enabled';

// 功能清单（与 content/features/* 的注册 id 对应）
const FEATURES = [
    { id: 'history', name: '搜索历史', desc: '自动记录集市搜索（POE2）' },
    { id: 'favorites', name: '收藏管理', desc: '收藏 / 文件夹 / 拖拽 / 导入导出' },
    { id: 'pob', name: '复制 PoB', desc: '在结果行加按钮，复制 Path of Building 文本（POE2）' },
    { id: 'view-mods', name: '查看词缀', desc: '查看物品类型在 poe2db 的全部可出词缀' },
    { id: 'megalomaniac', name: '妄想症统计', desc: '统计 poe.ninja 构筑里 Megalomaniac 词条出现次数' },
];

function sendBg(msg) {
    return new Promise((resolve) => {
        try {
            chrome.runtime.sendMessage(msg, (resp) => {
                if (chrome.runtime.lastError) { resolve(null); return; }
                resolve(resp);
            });
        } catch (e) { resolve(null); }
    });
}

// ── 功能开关 ──────────────────────────────────────────────────────
// 存储结构：{ qq: { [id]: bool }, intl: { [id]: bool } }；缺省 qq=true, intl=false。
// 兼容旧扁平结构 { [id]: bool }：读取时迁移到 qq 子表。
async function loadEnabled() {
    const { [ENABLED_KEY]: raw } = await chrome.storage.local.get({ [ENABLED_KEY]: {} });
    if (!raw) return { qq: {}, intl: {} };
    if (raw.qq || raw.intl) return { qq: raw.qq || {}, intl: raw.intl || {} };
    // 旧扁平结构 → 视作国服设置
    const migrated = { qq: {}, intl: {} };
    for (const [id, val] of Object.entries(raw)) {
        if (typeof val === 'boolean') migrated.qq[id] = val;
    }
    await chrome.storage.local.set({ [ENABLED_KEY]: migrated });
    return migrated;
}

async function renderFeatures() {
    const enabled = await loadEnabled();
    const list = document.getElementById('feature-list');
    list.innerHTML = '';
    FEATURES.forEach((f) => {
        const row = document.createElement('div');
        row.className = 'row';
        row.innerHTML = `
            <div>
                <div class="name">${f.name}</div>
                <div class="desc">${f.desc}</div>
            </div>
            <div class="switch-group">
                <label class="switch-label">国服
                    <label class="switch"><input type="checkbox" data-scope="qq" data-id="${f.id}" ${enabled.qq[f.id] !== false ? 'checked' : ''}><span class="slider"></span></label>
                </label>
                <label class="switch-label">国际服
                    <label class="switch"><input type="checkbox" data-scope="intl" data-id="${f.id}" ${enabled.intl[f.id] === true ? 'checked' : ''}><span class="slider"></span></label>
                </label>
            </div>`;
        list.appendChild(row);
    });
    list.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
        cb.addEventListener('change', async () => {
            const cur = await loadEnabled();
            cur[cb.dataset.scope][cb.dataset.id] = cb.checked;
            await chrome.storage.local.set({ [ENABLED_KEY]: cur });
        });
    });
}

// ── 词典状态 ──────────────────────────────────────────────────────
function fmtBytes(n) {
    if (!n) return '—';
    return (n / 1024 / 1024).toFixed(2) + ' MB';
}

async function renderDictStatus() {
    const el = document.getElementById('dict-status');
    const resp = await sendBg({ type: 'DICT_STATUS' });
    if (!resp || resp.success === false || !resp.status) {
        el.textContent = '词典功能尚未就绪（Phase 2 接入）。';
        return;
    }
    const s = resp.status;
    if (!s.builtAt) {
        el.textContent = '尚未下载词典。点「立即更新词典」可下载并建表。';
    } else {
        const date = new Date(s.builtAt).toLocaleString('zh-CN');
        el.textContent = `已缓存：${s.keys || '?'} 条 · ${fmtBytes(s.size)} · 更新于 ${date}`;
    }
}

function bindDictActions() {
    const refreshBtn = document.getElementById('dict-refresh');
    const importToggle = document.getElementById('dict-import-toggle');
    const importText = document.getElementById('dict-import-text');
    const importActions = document.getElementById('dict-import-actions');
    const importConfirm = document.getElementById('dict-import-confirm');
    const status = document.getElementById('dict-status');

    refreshBtn.addEventListener('click', async () => {
        refreshBtn.disabled = true;
        refreshBtn.textContent = '更新中…';
        const resp = await sendBg({ type: 'DICT_REFRESH', force: true });
        refreshBtn.disabled = false;
        refreshBtn.textContent = '立即更新词典';
        if (!resp || resp.success === false) {
            status.textContent = '更新失败：' + ((resp && resp.error) || '词典功能尚未就绪');
        } else {
            await renderDictStatus();
        }
    });

    importToggle.addEventListener('click', () => {
        const show = importText.style.display !== 'block';
        importText.style.display = show ? 'block' : 'none';
        importActions.style.display = show ? 'flex' : 'none';
    });

    importConfirm.addEventListener('click', async () => {
        const raw = importText.value.trim();
        if (!raw) { status.textContent = '请先粘贴 JSON 内容'; return; }
        importConfirm.disabled = true;
        importConfirm.textContent = '建表中…';
        const resp = await sendBg({ type: 'DICT_IMPORT', raw });
        importConfirm.disabled = false;
        importConfirm.textContent = '确认导入';
        if (!resp || resp.success === false) {
            status.textContent = '导入失败：' + ((resp && resp.error) || '词典功能尚未就绪');
        } else {
            importText.value = '';
            importText.style.display = 'none';
            importActions.style.display = 'none';
            await renderDictStatus();
        }
    });
}

renderFeatures();
renderDictStatus();
bindDictActions();

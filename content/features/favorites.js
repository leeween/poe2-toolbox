// PoE2 工具箱 —— 收藏功能（隔离世界）
// 收藏 / 文件夹 / 拖拽 / 导入导出，渲染成侧边栏 tab。存储经后台 favorites.js。
(function () {
    'use strict';
    const ctx = window.PoE2TB;
    if (!ctx) return;
    const { escapeHtml } = ctx.util;
    const gid = ctx.util.generateId;

    let listEl = null;

    // ── 渲染 ─────────────────────────────────────────────────────────
    function favItemHtml(item, inFolder = false) {
        return `
            <div class="tb-fav-item ${inFolder ? '' : 'draggable'}"
                 data-url="${escapeHtml(item.url)}" data-id="${escapeHtml(item.id)}"
                 ${inFolder ? '' : 'draggable="true"'}>
                <div class="tb-fav-main"><div class="tb-fav-title">${escapeHtml(item.name)}</div></div>
                <div class="tb-fav-actions">
                    ${inFolder ? '<button class="tb-fav-move" title="移动到根目录">📤</button>' : ''}
                    <button class="tb-fav-del" title="删除收藏">🗑️</button>
                </div>
            </div>`;
    }

    function display(favorites) {
        if (!listEl) return;
        if (!favorites.length) {
            listEl.innerHTML = '<div class="tb-empty">暂无收藏</div>';
            return;
        }
        const folders = favorites.filter((i) => i.type === 'folder');
        const items = favorites.filter((i) => i.type === 'favorite');
        let html = '';
        folders.forEach((folder) => {
            const inner = folder.items && folder.items.length
                ? folder.items.map((i) => favItemHtml(i, true)).join('')
                : '<div class="tb-empty">文件夹为空</div>';
            html += `
                <div class="tb-folder" data-id="${escapeHtml(folder.id)}">
                    <div class="tb-folder-header">
                        <div class="tb-folder-title">📁 ${escapeHtml(folder.name)}</div>
                        <div class="tb-folder-actions">
                            <button class="tb-folder-export" title="导出文件夹">📤</button>
                            <button class="tb-folder-rename" title="重命名">✏️</button>
                            <button class="tb-folder-del" title="删除文件夹">🗑️</button>
                            <span class="tb-folder-toggle">▼</span>
                        </div>
                    </div>
                    <div class="tb-folder-content" data-folder-id="${escapeHtml(folder.id)}">
                        <div class="tb-folder-toolbar">
                            <button class="tb-folder-add" data-folder-id="${escapeHtml(folder.id)}">⭐ 收藏到此文件夹</button>
                        </div>
                        ${inner}
                    </div>
                </div>`;
        });
        if (items.length) {
            html += '<div class="tb-root-favs">' + items.map((i) => favItemHtml(i)).join('') + '</div>';
        }
        listEl.innerHTML = html;
    }

    async function load() {
        if (!listEl) return;
        listEl.innerHTML = '<div class="tb-loading">正在加载收藏…</div>';
        const resp = await ctx.sendBg({ type: 'GET_FAVORITES' });
        if (resp && resp.success) display(resp.favorites || []);
        else listEl.innerHTML = '<div class="tb-empty">加载收藏失败</div>';
    }

    // ── 操作 ─────────────────────────────────────────────────────────
    async function createFolder() {
        const name = await ctx.ui.input('创建新文件夹', '请输入文件夹名称:', '新文件夹', '请输入文件夹名称');
        if (!name) return;
        const folder = { id: gid(), name: name.trim(), type: 'folder', created: new Date().toISOString(), items: [] };
        const resp = await ctx.sendBg({ type: 'SAVE_FAVORITE', data: folder });
        if (resp && resp.success) load();
        else ctx.ui.toast('创建文件夹失败，请重试', 'error');
    }

    async function addCurrentSearch() {
        const params = ctx.search.extractParams();
        if (!params || Object.keys(params).length === 0) { ctx.ui.toast('无法获取当前搜索条件', 'error'); return; }
        const name = await ctx.ui.input('添加到收藏', '请输入收藏名称:', ctx.search.smartTitle(params), '请输入收藏名称');
        if (!name) return;
        const favorite = { id: gid(), name: name.trim(), type: 'favorite', url: window.location.href, params, created: new Date().toISOString() };
        const resp = await ctx.sendBg({ type: 'SAVE_FAVORITE', data: favorite });
        if (resp && resp.success) { load(); ctx.ui.toast('收藏添加成功！', 'success'); }
        else ctx.ui.toast('添加收藏失败，请重试', 'error');
    }

    async function addCurrentSearchToFolder(folderId) {
        const params = ctx.search.extractParams();
        if (!params || Object.keys(params).length === 0) { ctx.ui.toast('无法获取当前搜索条件', 'error'); return; }
        const url = window.location.href;
        const resp = await ctx.sendBg({ type: 'GET_FAVORITES' });
        if (!resp || !resp.success) { ctx.ui.toast('获取文件夹信息失败', 'error'); return; }
        const folder = (resp.favorites || []).find((i) => i.id === folderId && i.type === 'folder');
        if (folder && folder.items && folder.items.some((i) => i.url === url)) {
            ctx.ui.toast('此文件夹中已存在相同的搜索链接', 'warning');
            return;
        }
        const name = await ctx.ui.input('收藏到文件夹', '请输入收藏名称:', ctx.search.smartTitle(params), '请输入收藏名称');
        if (!name) return;
        const favorite = { id: gid(), name: name.trim(), type: 'favorite', url, params, created: new Date().toISOString() };
        const r2 = await ctx.sendBg({ type: 'ADD_TO_FOLDER', favorite, folderId });
        if (r2 && r2.success) { load(); ctx.ui.toast('收藏添加成功！', 'success'); }
        else ctx.ui.toast('添加收藏失败，请重试', 'error');
    }

    async function deleteFavorite(id) {
        const ok = await ctx.ui.confirm('删除收藏', '确定要删除这个收藏吗？此操作不可恢复。', '删除', '取消');
        if (!ok) return;
        const resp = await ctx.sendBg({ type: 'DELETE_FAVORITE', id });
        if (resp && resp.success) { load(); ctx.ui.toast('收藏删除成功', 'success'); }
        else ctx.ui.toast('删除收藏失败，请重试', 'error');
    }

    async function deleteFolder(id) {
        const ok = await ctx.ui.confirm('删除文件夹', '确定要删除这个文件夹吗？文件夹内的所有收藏也会被删除！', '删除', '取消');
        if (!ok) return;
        const resp = await ctx.sendBg({ type: 'DELETE_FOLDER', id });
        if (resp && resp.success) load();
        else ctx.ui.toast('删除文件夹失败，请重试', 'error');
    }

    async function renameFolder(id) {
        const resp = await ctx.sendBg({ type: 'GET_FAVORITES' });
        if (!resp || !resp.success) { ctx.ui.toast('获取文件夹信息失败', 'error'); return; }
        const folder = (resp.favorites || []).find((i) => i.id === id && i.type === 'folder');
        if (!folder) { ctx.ui.toast('文件夹不存在', 'error'); return; }
        const newName = await ctx.ui.input('重命名文件夹', '请输入新的文件夹名称:', folder.name, '请输入文件夹名称');
        if (!newName || newName === folder.name) return;
        const r2 = await ctx.sendBg({ type: 'RENAME_FOLDER', id, newName: newName.trim() });
        if (r2 && r2.success) { load(); ctx.ui.toast('文件夹重命名成功', 'success'); }
        else ctx.ui.toast('重命名文件夹失败，请重试', 'error');
    }

    async function moveToRoot(id) {
        const resp = await ctx.sendBg({ type: 'MOVE_TO_ROOT', favoriteId: id });
        if (resp && resp.success) load();
        else ctx.ui.toast('移动收藏失败，请重试', 'error');
    }

    async function clearAll() {
        const ok = await ctx.ui.confirm('清空所有收藏', '确定要清空所有收藏吗？包括所有文件夹和收藏项，此操作不可恢复！', '清空', '取消');
        if (!ok) return;
        const resp = await ctx.sendBg({ type: 'CLEAR_FAVORITES' });
        if (resp && resp.success) load();
        else ctx.ui.toast('清空收藏失败，请重试', 'error');
    }

    // ── 导出 / 导入对话框 ─────────────────────────────────────────────
    async function exportFolder(id) {
        const resp = await ctx.sendBg({ type: 'EXPORT_FOLDER', folderId: id });
        if (!resp || !resp.success) { ctx.ui.toast('导出失败：' + ((resp && resp.error) || '未知错误'), 'error'); return; }
        showExportDialog(resp.data.folderName, resp.data.compressed);
        ctx.ui.toast(`导出成功！压缩率 ${resp.data.compressionRatio}%`, 'success');
    }

    function showExportDialog(folderName, compressed) {
        document.querySelector('.tb-dialog-overlay')?.remove();
        const overlay = document.createElement('div');
        overlay.className = 'tb-dialog-overlay';
        overlay.innerHTML = `
            <div class="tb-dialog">
                <div class="tb-dialog-header"><h3></h3></div>
                <div class="tb-dialog-body">
                    <label class="tb-dialog-label">导入代码（点击可全选）:</label>
                    <textarea readonly class="tb-export-text" style="height:120px;font-family:monospace;font-size:11px;"></textarea>
                </div>
                <div class="tb-dialog-footer">
                    <button class="tb-btn tb-btn-secondary tb-close">关闭</button>
                    <button class="tb-btn tb-btn-primary tb-copy">📋 复制代码</button>
                </div>
            </div>`;
        overlay.querySelector('h3').textContent = '📤 导出文件夹: ' + folderName;
        const ta = overlay.querySelector('.tb-export-text');
        ta.value = compressed;
        ta.addEventListener('click', () => ta.select());
        document.body.appendChild(overlay);
        const close = () => overlay.remove();
        overlay.querySelector('.tb-close').addEventListener('click', close);
        overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
        overlay.querySelector('.tb-copy').addEventListener('click', async () => {
            try { await navigator.clipboard.writeText(compressed); }
            catch (e) { ta.select(); document.execCommand('copy'); }
            ctx.ui.toast('导入代码已复制到剪贴板！', 'success');
        });
        setTimeout(() => ta.select(), 50);
    }

    function showImportDialog() {
        document.querySelector('.tb-dialog-overlay')?.remove();
        const overlay = document.createElement('div');
        overlay.className = 'tb-dialog-overlay';
        overlay.innerHTML = `
            <div class="tb-dialog">
                <div class="tb-dialog-header"><h3>📥 导入文件夹</h3></div>
                <div class="tb-dialog-body">
                    <label class="tb-dialog-label">请粘贴导入代码:</label>
                    <textarea class="tb-import-text" style="height:120px;font-family:monospace;font-size:11px;"
                              placeholder="粘贴从其他用户处获得的导入代码…"></textarea>
                </div>
                <div class="tb-dialog-footer">
                    <button class="tb-btn tb-btn-secondary tb-cancel">取消</button>
                    <button class="tb-btn tb-btn-secondary tb-paste">📋 粘贴</button>
                    <button class="tb-btn tb-btn-primary tb-confirm">📥 导入</button>
                </div>
            </div>`;
        document.body.appendChild(overlay);
        const ta = overlay.querySelector('.tb-import-text');
        const close = () => overlay.remove();
        overlay.querySelector('.tb-cancel').addEventListener('click', close);
        overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
        overlay.querySelector('.tb-paste').addEventListener('click', async () => {
            try { ta.value = await navigator.clipboard.readText(); ctx.ui.toast('已粘贴', 'success'); }
            catch (e) { ctx.ui.toast('无法访问剪贴板，请手动粘贴', 'warning'); }
        });
        const confirmBtn = overlay.querySelector('.tb-confirm');
        confirmBtn.addEventListener('click', async () => {
            const data = ta.value.trim();
            if (!data) { ctx.ui.toast('请输入导入代码', 'warning'); return; }
            confirmBtn.disabled = true; confirmBtn.textContent = '⏳ 导入中…';
            const resp = await ctx.sendBg({ type: 'IMPORT_FOLDER', importData: data });
            if (resp && resp.success) {
                const r = resp.data;
                let msg = `文件夹"${r.folderName}"导入成功！总计 ${r.totalItems} 项，新增 ${r.newItems} 项`;
                if (r.duplicates > 0) msg += `，跳过 ${r.duplicates} 个重复项`;
                ctx.ui.toast(msg, 'success', 4000);
                close();
                load();
            } else {
                confirmBtn.disabled = false; confirmBtn.textContent = '📥 导入';
                ctx.ui.toast('导入失败：' + ((resp && resp.error) || '未知错误'), 'error');
            }
        });
        setTimeout(() => ta.focus(), 50);
    }

    // ── 事件 ─────────────────────────────────────────────────────────
    function bindList() {
        listEl.addEventListener('click', (e) => {
            const t = e.target;
            // 文件夹折叠（标题或箭头）
            const titleOrToggle = t.closest('.tb-folder-title, .tb-folder-toggle');
            if (titleOrToggle) { e.stopPropagation(); titleOrToggle.closest('.tb-folder').classList.toggle('collapsed'); return; }
            const exportBtn = t.closest('.tb-folder-export');
            if (exportBtn) { e.stopPropagation(); exportFolder(exportBtn.closest('.tb-folder').dataset.id); return; }
            const renameBtn = t.closest('.tb-folder-rename');
            if (renameBtn) { e.stopPropagation(); renameFolder(renameBtn.closest('.tb-folder').dataset.id); return; }
            const delFolderBtn = t.closest('.tb-folder-del');
            if (delFolderBtn) { e.stopPropagation(); deleteFolder(delFolderBtn.closest('.tb-folder').dataset.id); return; }
            const addBtn = t.closest('.tb-folder-add');
            if (addBtn) { e.stopPropagation(); addCurrentSearchToFolder(addBtn.dataset.folderId); return; }
            const moveBtn = t.closest('.tb-fav-move');
            if (moveBtn) { e.stopPropagation(); moveToRoot(moveBtn.closest('.tb-fav-item').dataset.id); return; }
            const delFavBtn = t.closest('.tb-fav-del');
            if (delFavBtn) { e.stopPropagation(); deleteFavorite(delFavBtn.closest('.tb-fav-item').dataset.id); return; }
            const main = t.closest('.tb-fav-main');
            if (main) {
                const item = main.closest('.tb-fav-item');
                const url = item && item.dataset.url;
                if (!url) return;
                if (new URL(url, location.href).href === window.location.href) {
                    ctx.ui.toast('当前已在该搜索结果页面', 'warning');
                    return;
                }
                window.location.href = url;
            }
        });
        setupDragAndDrop();
    }

    function setupDragAndDrop() {
        let dragged = null;
        listEl.addEventListener('dragstart', (e) => {
            if (e.target.classList.contains('draggable')) {
                dragged = e.target;
                e.target.classList.add('dragging');
                e.dataTransfer.effectAllowed = 'move';
            }
        });
        listEl.addEventListener('dragend', (e) => {
            if (e.target.classList.contains('draggable')) {
                e.target.classList.remove('dragging');
                listEl.querySelectorAll('.drag-over').forEach((el) => el.classList.remove('drag-over'));
                dragged = null;
            }
        });
        listEl.addEventListener('dragover', (e) => {
            e.preventDefault();
            const content = e.target.closest('.tb-folder-content');
            if (content && dragged) { e.dataTransfer.dropEffect = 'move'; content.classList.add('drag-over'); }
        });
        listEl.addEventListener('dragleave', (e) => {
            const content = e.target.closest('.tb-folder-content');
            if (content && !content.contains(e.relatedTarget)) content.classList.remove('drag-over');
        });
        listEl.addEventListener('drop', async (e) => {
            e.preventDefault();
            const content = e.target.closest('.tb-folder-content');
            if (content && dragged) {
                const folderId = content.dataset.folderId;
                const favoriteId = dragged.dataset.id;
                if (folderId && favoriteId) {
                    const resp = await ctx.sendBg({ type: 'MOVE_TO_FOLDER', favoriteId, folderId });
                    if (resp && resp.success) load();
                    else ctx.ui.toast('移动失败，请重试', 'error');
                }
            }
            listEl.querySelectorAll('.drag-over').forEach((el) => el.classList.remove('drag-over'));
        });
    }

    function mount(panelEl) {
        panelEl.innerHTML = `
            <div class="tb-fav-toolbar">
                <button class="tb-action-btn tb-add-folder">📁 新建文件夹</button>
                <button class="tb-action-btn tb-add-fav">⭐ 收藏当前搜索</button>
                <button class="tb-action-btn tb-import-folder">📥 导入文件夹</button>
            </div>
            <div class="tb-list tb-fav-list"><div class="tb-empty">暂无收藏</div></div>`;
        listEl = panelEl.querySelector('.tb-fav-list');
        panelEl.querySelector('.tb-add-folder').addEventListener('click', createFolder);
        panelEl.querySelector('.tb-add-fav').addEventListener('click', addCurrentSearch);
        panelEl.querySelector('.tb-import-folder').addEventListener('click', showImportDialog);
        bindList();
        return { onShow: load, onRefresh: load, onClear: clearAll };
    }

    ctx.register({
        id: 'favorites',
        label: '收藏',
        icon: '⭐',
        scope: (c) => c.isQQ,
        panel: true,
        mount,
    });
})();

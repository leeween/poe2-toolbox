// PoE2 工具箱 —— 收藏 / 文件夹 / 导入导出存储（后台模块）
// 依赖：lib/lz-string.js（导入导出压缩）、storage.js（TB_vkey）。
'use strict';

const fvkey = (version) => self.TB_vkey(version, 'favorites');

async function getFavoritesRaw(version) {
    const k = fvkey(version);
    const { [k]: list } = await chrome.storage.local.get({ [k]: [] });
    return { k, list };
}

async function saveFavorite(favorite, version) {
    const { k, list } = await getFavoritesRaw(version);
    let favorites = list;
    const idx = favorites.findIndex((e) => e.id === favorite.id);
    if (idx !== -1) favorites.splice(idx, 1);
    favorites.unshift(favorite);
    if (favorites.length > 200) favorites = favorites.slice(0, 200);
    await chrome.storage.local.set({ [k]: favorites });
}

async function deleteFavorite(favoriteId, version) {
    const { k, list } = await getFavoritesRaw(version);
    let favorites = list;
    let found = false;
    const before = favorites.length;
    favorites = favorites.filter((f) => f.id !== favoriteId);
    if (favorites.length < before) {
        found = true;
    } else {
        for (const item of favorites) {
            if (item.type === 'folder' && item.items) {
                const b = item.items.length;
                item.items = item.items.filter((i) => i.id !== favoriteId);
                if (item.items.length < b) { found = true; break; }
            }
        }
    }
    if (!found) throw new Error('收藏项不存在');
    await chrome.storage.local.set({ [k]: favorites });
}

async function clearFavorites(version) {
    const k = fvkey(version);
    await chrome.storage.local.set({ [k]: [] });
}

async function moveToFolder(favoriteId, folderId, version) {
    const { k, list } = await getFavoritesRaw(version);
    const favorites = list;
    const fi = favorites.findIndex((i) => i.id === favoriteId);
    if (fi === -1) throw new Error('收藏项不存在');
    const di = favorites.findIndex((i) => i.id === folderId && i.type === 'folder');
    if (di === -1) throw new Error('目标文件夹不存在');
    const favoriteItem = favorites[fi];
    const folder = favorites[di];
    if (!folder.items) folder.items = [];
    if (folder.items.some((i) => i.id === favoriteId)) return;
    folder.items.unshift(favoriteItem);
    favorites.splice(fi, 1);
    await chrome.storage.local.set({ [k]: favorites });
}

async function deleteFolder(folderId, version) {
    const { k, list } = await getFavoritesRaw(version);
    const favorites = list;
    const fi = favorites.findIndex((i) => i.id === folderId && i.type === 'folder');
    if (fi === -1) throw new Error('文件夹不存在');
    favorites.splice(fi, 1);
    await chrome.storage.local.set({ [k]: favorites });
}

async function addToFolder(favorite, folderId, version) {
    const { k, list } = await getFavoritesRaw(version);
    const favorites = list;
    const di = favorites.findIndex((i) => i.id === folderId && i.type === 'folder');
    if (di === -1) throw new Error('目标文件夹不存在');
    const folder = favorites[di];
    if (!folder.items) folder.items = [];
    if (folder.items.some((i) => i.id === favorite.id)) return;
    folder.items.unshift(favorite);
    await chrome.storage.local.set({ [k]: favorites });
}

async function renameFolder(folderId, newName, version) {
    const { k, list } = await getFavoritesRaw(version);
    const favorites = list;
    const di = favorites.findIndex((i) => i.id === folderId && i.type === 'folder');
    if (di === -1) throw new Error('文件夹不存在');
    favorites[di].name = newName;
    await chrome.storage.local.set({ [k]: favorites });
}

async function moveToRoot(favoriteId, version) {
    const { k, list } = await getFavoritesRaw(version);
    const favorites = list;
    let favoriteItem = null;
    for (const item of favorites) {
        if (item.type === 'folder' && item.items) {
            const ii = item.items.findIndex((i) => i.id === favoriteId);
            if (ii !== -1) { favoriteItem = item.items.splice(ii, 1)[0]; break; }
        }
    }
    if (!favoriteItem) throw new Error('收藏项不存在或不在文件夹中');
    favorites.unshift(favoriteItem);
    await chrome.storage.local.set({ [k]: favorites });
}

async function exportFolder(folderId, version) {
    const { list } = await getFavoritesRaw(version);
    const folder = list.find((i) => i.id === folderId && i.type === 'folder');
    if (!folder) throw new Error('文件夹不存在');
    const exportData = {
        version: '1.0.0',
        type: 'poe2-trading-folder',
        timestamp: Date.now(),
        folder: {
            name: folder.name,
            items: folder.items || [],
            exportedAt: new Date().toISOString(),
            totalItems: (folder.items || []).length,
        },
    };
    const json = JSON.stringify(exportData);
    const compressed = LZString.compressToBase64(json);
    return {
        compressed,
        originalSize: json.length,
        compressedSize: compressed.length,
        compressionRatio: ((1 - compressed.length / json.length) * 100).toFixed(1),
        folderName: folder.name,
        itemCount: (folder.items || []).length,
    };
}

async function importFolder(importData, version) {
    const decompressed = LZString.decompressFromBase64(importData);
    if (!decompressed) throw new Error('数据解压缩失败，请检查导入数据是否正确');
    let parsed;
    try { parsed = JSON.parse(decompressed); }
    catch (e) { throw new Error('数据格式不正确，无法解析JSON'); }
    if (!parsed.type || parsed.type !== 'poe2-trading-folder') throw new Error('不是有效的文件夹导出数据');
    if (!parsed.folder || !parsed.folder.name) throw new Error('导入数据缺少文件夹信息');

    const { k, list } = await getFavoritesRaw(version);
    const favorites = list;
    const existingIdx = favorites.findIndex((i) => i.type === 'folder' && i.name === parsed.folder.name);

    let targetFolder;
    if (existingIdx !== -1) {
        targetFolder = favorites[existingIdx];
        if (!targetFolder.items) targetFolder.items = [];
    } else {
        targetFolder = {
            id: Date.now() + 'folder' + Math.random().toString(36).slice(2, 11),
            type: 'folder',
            name: parsed.folder.name,
            items: [],
            createdAt: new Date().toISOString(),
        };
        favorites.unshift(targetFolder);
    }

    const importedItems = parsed.folder.items || [];
    let newItems = 0, duplicates = 0;
    for (const item of importedItems) {
        if (targetFolder.items.some((e) => e.url === item.url)) { duplicates++; continue; }
        targetFolder.items.push({
            ...item,
            id: Date.now() + 'fav' + Math.random().toString(36).slice(2, 11),
            importedAt: new Date().toISOString(),
        });
        newItems++;
    }
    await chrome.storage.local.set({ [k]: favorites });
    return {
        folderName: parsed.folder.name,
        totalItems: importedItems.length,
        newItems,
        duplicates,
        isNewFolder: existingIdx === -1,
    };
}

TB.on('SAVE_FAVORITE', async (req) => { await saveFavorite(req.data, req.version); });
TB.on('GET_FAVORITES', async (req) => ({ favorites: (await getFavoritesRaw(req.version)).list }));
TB.on('DELETE_FAVORITE', async (req) => { await deleteFavorite(req.id, req.version); });
TB.on('CLEAR_FAVORITES', async (req) => { await clearFavorites(req.version); });
TB.on('MOVE_TO_FOLDER', async (req) => { await moveToFolder(req.favoriteId, req.folderId, req.version); });
TB.on('DELETE_FOLDER', async (req) => { await deleteFolder(req.id, req.version); });
TB.on('ADD_TO_FOLDER', async (req) => { await addToFolder(req.favorite, req.folderId, req.version); });
TB.on('RENAME_FOLDER', async (req) => { await renameFolder(req.id, req.newName, req.version); });
TB.on('MOVE_TO_ROOT', async (req) => { await moveToRoot(req.favoriteId, req.version); });
TB.on('EXPORT_FOLDER', async (req) => ({ data: await exportFolder(req.folderId, req.version) }));
TB.on('IMPORT_FOLDER', async (req) => ({ data: await importFolder(req.importData, req.version) }));

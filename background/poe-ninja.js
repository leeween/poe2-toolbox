// PoE2 工具箱 —— poe.ninja 构筑数据抓取（后台模块）
// 用于妄想症统计：读取 builds 搜索页前 N 个角色，抓取 character API，
// 提取 Megalomaniac 的 enchantMods，并用当前 PoB 词典反向翻译英文天赋名。
'use strict';

const POE_NINJA_ORIGIN = 'https://poe.ninja';
const POE_NINJA_MIN_LIMIT = 10;
const POE_NINJA_MAX_LIMIT = 100;
const POE_NINJA_CHARACTER_DELAY_MS = 1200;

// 英文页天赋树 JSON：用于把妄想症 enchantMods 里的核心天赋 id 反查成英文名。
// 中文页 data_cn.json 的节点 name 是中文，不能直接给英文名；data_us.json 才是英文。
const POE2DB_PASSIVE_EN_URL = 'https://poe2db.tw/data/passive-skill-tree/4.5/data_us.json';
const PASSIVE_ID2NAME_KEY = 'megalomaniac-passive-id2name';
const PASSIVE_ID2NAME_TTL = 14 * 24 * 60 * 60 * 1000;

let _enToZhDict = null;
let _enToZhBuiltAt = 0;

class PoeNinjaRateLimitError extends Error {
    constructor(retryAfterSeconds) {
        super('poe.ninja 请求过快，已被限流');
        this.name = 'PoeNinjaRateLimitError';
        this.retryAfterSeconds = retryAfterSeconds || 0;
    }
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryAfterSeconds(res) {
    const raw = res.headers.get('Retry-After');
    if (!raw) return 0;
    const n = Number.parseInt(raw, 10);
    if (Number.isFinite(n)) return Math.max(0, n);
    const t = Date.parse(raw);
    return Number.isFinite(t) ? Math.max(0, Math.ceil((t - Date.now()) / 1000)) : 0;
}

function readVarint(buf, pos) {
    let value = 0n;
    let shift = 0n;
    let p = pos;
    while (p < buf.length) {
        const byte = buf[p++];
        value |= BigInt(byte & 0x7f) << shift;
        if ((byte & 0x80) === 0) return [Number(value), p];
        shift += 7n;
    }
    throw new Error('protobuf varint 读取失败');
}

function readProtoFields(buf, start, end) {
    const fields = [];
    let pos = start || 0;
    const stop = end == null ? buf.length : end;
    while (pos < stop) {
        const [tag, afterTag] = readVarint(buf, pos);
        const no = tag >> 3;
        const wire = tag & 7;
        pos = afterTag;
        if (wire === 0) {
            const [value, next] = readVarint(buf, pos);
            fields.push({ no, wire, value });
            pos = next;
        } else if (wire === 1) {
            fields.push({ no, wire, value: buf.subarray(pos, pos + 8) });
            pos += 8;
        } else if (wire === 2) {
            const [len, afterLen] = readVarint(buf, pos);
            const next = afterLen + len;
            fields.push({ no, wire, value: buf.subarray(afterLen, next) });
            pos = next;
        } else if (wire === 5) {
            fields.push({ no, wire, value: buf.subarray(pos, pos + 4) });
            pos += 4;
        } else {
            throw new Error('不支持的 protobuf wire type: ' + wire);
        }
    }
    return fields;
}

function protoString(bytes) {
    return new TextDecoder().decode(bytes);
}

function parseSearchValue(message) {
    const out = { strs: [], numbers: [] };
    for (const field of readProtoFields(message)) {
        if (field.no === 1 && field.wire === 2) out.str = protoString(field.value);
        else if (field.no === 2 && field.wire === 0) out.number = field.value;
        else if (field.no === 3 && field.wire === 0) out.numbers.push(field.value);
        else if (field.no === 4 && field.wire === 2) out.strs.push(protoString(field.value));
        else if (field.no === 5 && field.wire === 0) out.boolean = Boolean(field.value);
    }
    return out;
}

function parseValueList(message) {
    const list = { id: '', values: [] };
    for (const field of readProtoFields(message)) {
        if (field.no === 1 && field.wire === 2) list.id = protoString(field.value);
        else if (field.no === 2 && field.wire === 2) list.values.push(parseSearchValue(field.value));
    }
    return list;
}

function parseSearchRows(bytes) {
    const wrapper = readProtoFields(bytes);
    const resultField = wrapper.find((field) => field.no === 1 && field.wire === 2);
    if (!resultField) throw new Error('poe.ninja search 返回缺少 result 字段');

    let total = 0;
    const valueLists = [];
    const columns = new Map();
    for (const field of readProtoFields(resultField.value)) {
        if (field.no === 1 && field.wire === 0) {
            total = field.value;
        } else if (field.no === 5 && field.wire === 2) {
            valueLists.push(parseValueList(field.value));
        } else if (field.no === 12 && field.wire === 2) {
            const sub = readProtoFields(field.value);
            const idField = sub.find((s) => s.no === 1 && s.wire === 2);
            if (idField) {
                const id = protoString(idField.value);
                const vals = sub
                    .filter((s) => s.no === 7 && s.wire === 2)
                    .map((s) => protoString(s.value));
                columns.set(id, vals);
            }
        }
    }

    let namesList = [];
    let accountsList = [];
    if (columns.has('name') && columns.has('account')) {
        namesList = columns.get('name') || [];
        accountsList = columns.get('account') || [];
    } else {
        const names = valueLists.find((list) => list.id === 'name');
        const accounts = valueLists.find((list) => list.id === 'account');
        if (names && accounts) {
            const l = Math.min(names.values.length, accounts.values.length);
            for (let i = 0; i < l; i++) {
                namesList.push((names.values[i] && names.values[i].str) || '');
                accountsList.push((accounts.values[i] && accounts.values[i].str) || '');
            }
        }
    }

    if (total === 0) throw new Error('未找到符合当前筛选条件的构筑角色');
    if (!namesList.length || !accountsList.length) throw new Error('poe.ninja search 返回缺少 name/account 列');

    const rows = [];
    const len = Math.min(namesList.length, accountsList.length);
    for (let i = 0; i < len; i++) {
        const name = namesList[i];
        const account = accountsList[i];
        if (name && account) rows.push({ index: i, account, name });
    }
    return { total, rows };
}

function stripMarkup(text) {
    return String(text || '')
        .replace(/\[[^\[\]|]*\|([^\[\]]*)\]/g, '$1')
        .replace(/\[([^\[\]|]*)\]/g, '$1');
}

function normalizeEnglish(text) {
    return globalThis.PoE2Norm.makeEnTemplate(stripMarkup(text)).toLowerCase();
}

function displayZhKey(key) {
    const sent = globalThis.PoE2Norm.SENT;
    return String(key || '').replace(new RegExp(sent, 'g'), '#');
}

function parseNotable(enchantMod) {
    const text = String(enchantMod || '').replace(/^allocates\s+/i, '').trim();
    const match = text.match(/^\[([^\[\]|]*)\|([^\[\]]*)\]$/);
    if (match) {
        return { id: match[1].trim(), en: match[2].trim() };
    }
    return { id: '', en: stripMarkup(text) };
}

function extractNotable(enchantMod) {
    return parseNotable(enchantMod).en;
}

function parseBuildsUrl(rawUrl) {
    const url = new URL(rawUrl);
    if (url.hostname !== 'poe.ninja') throw new Error('请输入 poe.ninja 链接');
    const match = url.pathname.match(/^\/poe2\/builds\/([^/]+)/);
    if (!match) throw new Error('链接必须是 /poe2/builds/<league> 页面');
    return { url, league: match[1] };
}

async function fetchJson(url) {
    const res = await fetch(url, { headers: { accept: 'application/json,*/*' } });
    if (res.status === 429) throw new PoeNinjaRateLimitError(retryAfterSeconds(res));
    if (!res.ok) throw new Error('请求失败 HTTP ' + res.status);
    return await res.json();
}

async function fetchBytes(url) {
    const res = await fetch(url, { headers: { accept: 'application/x-protobuf,*/*' } });
    if (res.status === 429) throw new PoeNinjaRateLimitError(retryAfterSeconds(res));
    if (!res.ok) throw new Error('请求失败 HTTP ' + res.status);
    return new Uint8Array(await res.arrayBuffer());
}

async function resolveSnapshot(league) {
    const state = await fetchJson(POE_NINJA_ORIGIN + '/poe2/api/data/index-state');
    const snapshot = (state.snapshotVersions || []).find((item) => item.url === league);
    if (!snapshot) throw new Error('未找到 poe.ninja 版本：' + league);
    if (!snapshot.version || !snapshot.snapshotName) throw new Error('poe.ninja 版本数据不完整：' + league);
    return snapshot;
}

async function loadEnglishToChineseDict() {
    const ensureHandler = self.TB.handlers.DICT_ENSURE;
    if (!ensureHandler) throw new Error('PoB 词典模块未就绪');
    const ensured = await ensureHandler({});
    if (!ensured || !ensured.ready) throw new Error((ensured && ensured.error) || 'PoB 词典不可用');

    const stored = await chrome.storage.local.get({ 'pob-dict': null, 'pob-dict-meta': null });
    const dict = stored['pob-dict'];
    const meta = stored['pob-dict-meta'] || {};
    if (!dict) throw new Error('PoB 词典缓存为空');
    if (_enToZhDict && _enToZhBuiltAt === meta.builtAt) return _enToZhDict;

    const out = new Map();
    for (const zhKey of Object.keys(dict)) {
        const enTpl = dict[zhKey];
        if (typeof enTpl !== 'string') continue;
        const key = normalizeEnglish(enTpl);
        if (key && !out.has(key)) out.set(key, displayZhKey(zhKey));
    }
    _enToZhDict = out;
    _enToZhBuiltAt = meta.builtAt || Date.now();
    return out;
}

function translateNotable(name, enToZh) {
    return enToZh.get(normalizeEnglish(name)) || name;
}

function increment(map, key) {
    map.set(key, (map.get(key) || 0) + 1);
}

function sortedStats(map) {
    return Array.from(map.values())
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh-Hans-CN'));
}

function searchApiUrl(inputUrl, snapshot, timeMachine) {
    const query = new URLSearchParams(inputUrl.searchParams);
    query.set('overview', snapshot.snapshotName);
    if (timeMachine) query.set('timemachine', timeMachine);
    return POE_NINJA_ORIGIN + '/poe2/api/builds/' + encodeURIComponent(snapshot.version) + '/search?' + query;
}

function characterApiUrl(snapshot, row, timeMachine) {
    const query = new URLSearchParams({
        account: row.account,
        name: row.name,
        overview: snapshot.snapshotName,
        timeMachine: timeMachine || '',
    });
    return POE_NINJA_ORIGIN + '/poe2/api/builds/' + encodeURIComponent(snapshot.version) + '/character?' + query;
}

function findMegalomaniacJewels(character) {
    const jewels = Array.isArray(character.jewels) ? character.jewels : [];
    return jewels
        .map((entry) => entry && (entry.itemData || entry))
        .filter((item) => item && item.name === 'Megalomaniac');
}

function validatePassiveTreeUrl(rawUrl) {
    const url = new URL(rawUrl);
    if (url.protocol !== 'https:' || url.hostname !== 'poe2db.tw') {
        throw new Error('天赋详情链接必须是 https://poe2db.tw/ 下的 JSON');
    }
    if (!url.pathname.startsWith('/data/passive-skill-tree/') || !url.pathname.endsWith('.json')) {
        throw new Error('天赋详情链接路径格式不正确');
    }
    return url.href;
}

const PASSIVE_ID2ZH_KEY = 'megalomaniac-passive-id2zh';
async function getPassiveIdToZh(versionPath = '4.5') {
    const key = `${PASSIVE_ID2ZH_KEY}-${versionPath}`;
    const { [key]: cached } = await chrome.storage.local.get({ [key]: null });
    if (cached && cached.map && Date.now() - cached.t < PASSIVE_ID2NAME_TTL) return cached.map;
    try {
        const cnUrl = `https://poe2db.tw/data/passive-skill-tree/${versionPath}/data_cn.json`;
        const data = await fetchJson(cnUrl);
        const nodes = Object.values((data && data.nodes) || {});
        const map = {};
        for (const n of nodes) {
            if (n && n.id && n.name) map[n.id] = n.name;
            if (n && n.skill != null && n.name) map[String(n.skill)] = n.name;
        }
        await chrome.storage.local.set({ [key]: { t: Date.now(), map } });
        return map;
    } catch (e) {
        if (cached && cached.map) return cached.map;
        return {};
    }
}

function buildPassiveDetails(data, idToEn, idToZh) {
    const nodesRaw = data && data.nodes;
    const nodes = Array.isArray(nodesRaw) ? nodesRaw : Object.values(nodesRaw || {});
    const details = {};
    for (const node of nodes) {
        if (!node || typeof node.name !== 'string') continue;
        const stats = Array.isArray(node.stats)
            ? node.stats.filter((line) => typeof line === 'string' && line.trim())
            : [];
        const connection = Array.isArray(node.connections) && node.connections[0];
        const id = node.skill != null ? String(node.skill)
            : connection && connection.id != null ? String(connection.id)
                : '';
        if (!stats.length && !id) continue;

        const nodeId = String(node.id || '');
        const enName = (idToEn && nodeId && idToEn[nodeId]) ||
            (idToEn && node.skill != null && idToEn[String(node.skill)]) || '';
        const zhName = (idToZh && nodeId && idToZh[nodeId]) ||
            (idToZh && node.skill != null && idToZh[String(node.skill)]) || '';

        const item = {
            id,
            nodeId,
            name: node.name || zhName || enName,
            zhName: zhName || '',
            enName: enName || '',
            stats,
        };

        if (nodeId) details[nodeId] = item;
        if (node.name) details[node.name] = item;
        if (zhName) details[zhName] = item;
        if (enName) details[enName] = item;
    }
    return details;
}

async function fetchPassiveDetails(req) {
    const url = validatePassiveTreeUrl(req.url);
    const match = url.match(/\/passive-skill-tree\/([^/]+)\//);
    const versionPath = match ? match[1] : '4.5';
    const [data, idToEn, idToZh] = await Promise.all([
        fetchJson(url),
        getPassiveIdToName().catch(() => ({})),
        getPassiveIdToZh(versionPath).catch(() => ({})),
    ]);
    const details = buildPassiveDetails(data, idToEn, idToZh);
    return { url, details, count: Object.keys(details).length };
}

async function analyzeMegalomaniac(req) {
    const limit = Number.parseInt(req.limit, 10);
    if (!Number.isFinite(limit) || limit < POE_NINJA_MIN_LIMIT || limit > POE_NINJA_MAX_LIMIT) {
        throw new Error('账号数量需在 10 到 100 之间');
    }

    const { url, league } = parseBuildsUrl(req.url);
    const timeMachine = url.searchParams.get('timemachine') || url.searchParams.get('timeMachine') || '';
    const [snapshot, enToZh] = await Promise.all([resolveSnapshot(league), loadEnglishToChineseDict()]);
    const searchBytesData = await fetchBytes(searchApiUrl(url, snapshot, timeMachine));
    const { total, rows } = parseSearchRows(searchBytesData);
    const selected = rows.slice(0, limit);
    const failures = [];
    const counts = new Map();
    let jewelCount = 0;
    let checked = 0;
    let rateLimited = null;

    for (let i = 0; i < selected.length; i++) {
        const row = selected[i];
        if (i > 0) await sleep(POE_NINJA_CHARACTER_DELAY_MS);
        checked++;
        try {
            const character = await fetchJson(characterApiUrl(snapshot, row, timeMachine));
            const jewels = findMegalomaniacJewels(character);
            for (const jewel of jewels) {
                const enchantMods = Array.isArray(jewel.enchantMods) ? jewel.enchantMods : [];
                for (const raw of enchantMods) {
                    const parsed = parseNotable(raw);
                    if (!parsed.en) continue;
                    const zh = translateNotable(parsed.en, enToZh);
                    jewelCount++;
                    const key = zh || parsed.en;
                    const cur = counts.get(key) || { name: key, id: parsed.id, en: parsed.en, count: 0 };
                    cur.count += 1;
                    if (parsed.id && !cur.id) cur.id = parsed.id;
                    if (parsed.en && !cur.en) cur.en = parsed.en;
                    counts.set(key, cur);
                }
            }
        } catch (e) {
            if (e && e.name === 'PoeNinjaRateLimitError') {
                rateLimited = {
                    retryAfterSeconds: e.retryAfterSeconds || 0,
                    message: e.message,
                };
                failures.push({
                    account: row.account,
                    name: row.name,
                    error: e.retryAfterSeconds
                        ? e.message + '，约 ' + Math.ceil(e.retryAfterSeconds / 60) + ' 分钟后再试'
                        : e.message,
                });
                break;
            }
            failures.push({
                account: row.account,
                name: row.name,
                error: String(e && e.message || e),
            });
        }
    }

    return {
        league,
        snapshotVersion: snapshot.version,
        overview: snapshot.snapshotName,
        total,
        requested: limit,
        available: rows.length,
        checked,
        skipped: selected.length - checked,
        jewelCount,
        stats: sortedStats(counts),
        failures,
        rateLimited,
    };
}

TB.on('POE_NINJA_MEGALOMANIAC', analyzeMegalomaniac);
TB.on('POE_NINJA_PASSIVE_DETAILS', fetchPassiveDetails);

// 英文页天赋树 -> { id: 英文名, skill: 英文名 } 双索引（双 key 命中任一即可）。
// 物品 enchantMods 文本「配置 [fire58|伊柯洛塔的狱火]」里的 fire58 是 node.id；
// extended.mods.enchant[].magnitudes[].hash「enchant.stat_2954116742|32932」里的 32932 是 node.skill。
// 两者都建进索引，前台按文本里的 statKeyId 优先查、数字 skill id 兜底。
async function buildPassiveIdToName() {
    const data = await fetchJson(POE2DB_PASSIVE_EN_URL);
    const nodesRaw = data && data.nodes;
    const nodes = Array.isArray(nodesRaw) ? nodesRaw : Object.values(nodesRaw || {});
    const out = {};
    for (const node of nodes) {
        if (!node || typeof node.name !== 'string' || !node.name) continue;
        if (typeof node.id === 'string' && node.id) out[node.id] = node.name;
        if (node.skill != null) out[String(node.skill)] = node.name;
    }
    return out;
}

async function getPassiveIdToName() {
    const { [PASSIVE_ID2NAME_KEY]: cached } = await chrome.storage.local.get({ [PASSIVE_ID2NAME_KEY]: null });
    if (cached && cached.map && Date.now() - cached.t < PASSIVE_ID2NAME_TTL) return cached.map;
    try {
        const map = await buildPassiveIdToName();
        await chrome.storage.local.set({ [PASSIVE_ID2NAME_KEY]: { t: Date.now(), map } });
        return map;
    } catch (e) {
        if (cached && cached.map) return cached.map;
        throw e;
    }
}

TB.on('POB_PASSIVE_ID_TO_NAME', async () => ({ map: await getPassiveIdToName() }));

#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const DEFAULT_LIMIT = 20;
const MIN_LIMIT = 10;
const MAX_LIMIT = 100;
const NINJA_ORIGIN = 'https://poe.ninja';
const CHARACTER_DELAY_MS = 1200;

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

function retryAfterSeconds(resp) {
    const raw = resp.headers.get('Retry-After');
    if (!raw) return 0;
    const n = Number.parseInt(raw, 10);
    if (Number.isFinite(n)) return Math.max(0, n);
    const t = Date.parse(raw);
    return Number.isFinite(t) ? Math.max(0, Math.ceil((t - Date.now()) / 1000)) : 0;
}

function usage() {
    console.error('用法: node tools/poe-ninja-megalomaniac.mjs <poe.ninja builds 链接> [数量 10-100]');
    console.error('示例: node tools/poe-ninja-megalomaniac.mjs "https://poe.ninja/poe2/builds/runesofaldur?class=Martial+Artist&items=Megalomaniac" 20');
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

function readFields(buf, start = 0, end = buf.length) {
    const fields = [];
    let pos = start;
    while (pos < end) {
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
            throw new Error(`不支持的 protobuf wire type: ${wire}`);
        }
    }
    return fields;
}

function protobufString(bytes) {
    return Buffer.from(bytes).toString('utf8');
}

function parseSearchValue(message) {
    const out = { strs: [], numbers: [] };
    for (const field of readFields(message)) {
        if (field.no === 1 && field.wire === 2) out.str = protobufString(field.value);
        if (field.no === 2 && field.wire === 0) out.number = field.value;
        if (field.no === 3 && field.wire === 0) out.numbers.push(field.value);
        if (field.no === 4 && field.wire === 2) out.strs.push(protobufString(field.value));
        if (field.no === 5 && field.wire === 0) out.boolean = Boolean(field.value);
    }
    return out;
}

function parseValueList(message) {
    const valueList = { id: '', values: [] };
    for (const field of readFields(message)) {
        if (field.no === 1 && field.wire === 2) valueList.id = protobufString(field.value);
        if (field.no === 2 && field.wire === 2) valueList.values.push(parseSearchValue(field.value));
    }
    return valueList;
}

function parseSearchRows(bytes) {
    const wrapper = readFields(bytes);
    const resultField = wrapper.find((field) => field.no === 1 && field.wire === 2);
    if (!resultField) throw new Error('search 返回缺少 result 字段');

    let total = 0;
    const valueLists = [];
    for (const field of readFields(resultField.value)) {
        if (field.no === 1 && field.wire === 0) total = field.value;
        if (field.no === 5 && field.wire === 2) valueLists.push(parseValueList(field.value));
    }

    const names = valueLists.find((list) => list.id === 'name');
    const accounts = valueLists.find((list) => list.id === 'account');
    if (!names || !accounts) throw new Error('search 返回缺少 name/account 列');

    const len = Math.min(names.values.length, accounts.values.length);
    const rows = [];
    for (let i = 0; i < len; i++) {
        const name = names.values[i]?.str;
        const account = accounts.values[i]?.str;
        if (name && account) rows.push({ index: i, account, name });
    }
    return { total, rows };
}

function stripMarkup(text) {
    return String(text)
        .replace(/\[[^\[\]|]*\|([^\[\]]*)\]/g, '$1')
        .replace(/\[([^\[\]|]*)\]/g, '$1');
}

function normalizeEnglish(text) {
    return globalThis.PoE2Norm.makeEnTemplate(stripMarkup(text)).toLowerCase();
}

function extractNotable(enchantMod) {
    return stripMarkup(enchantMod).replace(/^allocates\s+/i, '').trim();
}

function displayZhKey(key) {
    const sent = globalThis.PoE2Norm.SENT;
    return String(key || '').replace(new RegExp(sent, 'g'), '#');
}

function translateNotable(name, enToZh) {
    return enToZh.get(normalizeEnglish(name)) || name;
}

function increment(map, key) {
    map.set(key, (map.get(key) || 0) + 1);
}

function sortedEntries(map) {
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh-Hans-CN'));
}

async function fetchOk(url, as = 'json') {
    const resp = await fetch(url, {
        headers: {
            'accept': as === 'arrayBuffer' ? 'application/x-protobuf,*/*' : 'application/json,*/*',
            'user-agent': 'poe2-toolbox-local-debug/0.1',
        },
    });
    if (resp.status === 429) throw new PoeNinjaRateLimitError(retryAfterSeconds(resp));
    if (!resp.ok) throw new Error(`${resp.status} ${resp.statusText}: ${url}`);
    if (as === 'arrayBuffer') return new Uint8Array(await resp.arrayBuffer());
    return resp.json();
}

function parseBuildsUrl(rawUrl) {
    const url = new URL(rawUrl);
    if (url.hostname !== 'poe.ninja') throw new Error('只支持 poe.ninja 链接');
    const match = url.pathname.match(/^\/poe2\/builds\/([^/]+)/);
    if (!match) throw new Error('链接必须是 /poe2/builds/<league> 页面');
    return { url, league: match[1] };
}

async function loadPobTranslationIndex() {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    vm.runInThisContext(await fs.readFile(path.resolve(__dirname, '../lib/dict-normalize.js'), 'utf8'));
    vm.runInThisContext(await fs.readFile(path.resolve(__dirname, '../lib/dict-build.js'), 'utf8'));
    const langPath = path.resolve(__dirname, '../statics/lang-sc.json');
    const raw = JSON.parse(await fs.readFile(langPath, 'utf8'));
    const pobDict = globalThis.PoE2DictBuild.build(raw);
    const enToZh = new Map();
    for (const zhKey of Object.keys(pobDict)) {
        const enTpl = pobDict[zhKey];
        if (typeof enTpl !== 'string') continue;
        const key = normalizeEnglish(enTpl);
        if (key && !enToZh.has(key)) enToZh.set(key, displayZhKey(zhKey));
    }
    return enToZh;
}

async function resolveSnapshot(league) {
    const indexState = await fetchOk(`${NINJA_ORIGIN}/poe2/api/data/index-state`);
    const snapshot = indexState.snapshotVersions?.find((item) => item.url === league);
    if (!snapshot) throw new Error(`未在 poe.ninja index-state 找到 league: ${league}`);
    if (!snapshot.version || !snapshot.snapshotName) throw new Error(`league ${league} 缺少 version/snapshotName`);
    return snapshot;
}

async function fetchSearchRows(inputUrl, snapshot) {
    const query = new URLSearchParams(inputUrl.searchParams);
    query.set('overview', snapshot.snapshotName);
    const apiUrl = `${NINJA_ORIGIN}/poe2/api/builds/${encodeURIComponent(snapshot.version)}/search?${query}`;
    const bytes = await fetchOk(apiUrl, 'arrayBuffer');
    return parseSearchRows(bytes);
}

function characterApiUrl(snapshot, row) {
    const query = new URLSearchParams({
        account: row.account,
        name: row.name,
        overview: snapshot.snapshotName,
        timeMachine: '',
    });
    return `${NINJA_ORIGIN}/poe2/api/builds/${encodeURIComponent(snapshot.version)}/character?${query}`;
}

function findMegalomaniacJewels(character) {
    const jewels = Array.isArray(character.jewels) ? character.jewels : [];
    return jewels
        .map((entry) => entry?.itemData || entry)
        .filter((item) => item?.name === 'Megalomaniac');
}

async function main() {
    const rawUrl = process.argv[2];
    const limit = Number.parseInt(process.argv[3] || String(DEFAULT_LIMIT), 10);
    if (!rawUrl || !Number.isFinite(limit) || limit < MIN_LIMIT || limit > MAX_LIMIT) {
        usage();
        process.exitCode = 1;
        return;
    }

    const { url, league } = parseBuildsUrl(rawUrl);
    const enToZh = await loadPobTranslationIndex();
    const snapshot = await resolveSnapshot(league);
    const { total, rows } = await fetchSearchRows(url, snapshot);
    const selectedRows = rows.slice(0, limit);

    const notableCounts = new Map();
    const failures = [];
    let jewelCount = 0;

    for (let i = 0; i < selectedRows.length; i++) {
        const row = selectedRows[i];
        if (i > 0) await sleep(CHARACTER_DELAY_MS);
        try {
            const character = await fetchOk(characterApiUrl(snapshot, row));
            const jewels = findMegalomaniacJewels(character);
            for (const jewel of jewels) {
                const notables = (Array.isArray(jewel.enchantMods) ? jewel.enchantMods : [])
                    .map(extractNotable)
                    .filter(Boolean);
                if (!notables.length) continue;
                jewelCount++;
                const translated = notables.map((name) => translateNotable(name, enToZh));
                for (const notable of translated) increment(notableCounts, notable);
            }
        } catch (err) {
            if (err && err.name === 'PoeNinjaRateLimitError') {
                const mins = err.retryAfterSeconds ? Math.ceil(err.retryAfterSeconds / 60) : 0;
                failures.push(`${row.account}/${row.name}: ${err.message}${mins ? `，约 ${mins} 分钟后再试` : ''}`);
                break;
            }
            failures.push(`${row.account}/${row.name}: ${err.message}`);
        }
    }

    console.log(`league: ${league}`);
    console.log(`snapshot: ${snapshot.version} (${snapshot.snapshotName})`);
    console.log(`search total: ${total}`);
    console.log(`checked characters: ${selectedRows.length}`);
    console.log(`Megalomaniac jewels: ${jewelCount}`);
    console.log('');
    console.log('词条统计:');
    for (const [name, count] of sortedEntries(notableCounts)) {
        console.log(`${String(count).padStart(3, ' ')}  ${name}`);
    }

    if (failures.length) {
        console.log('');
        console.log('失败角色:');
        for (const line of failures) console.log(`- ${line}`);
    }
}

main().catch((err) => {
    console.error(err.stack || err.message);
    process.exitCode = 1;
});

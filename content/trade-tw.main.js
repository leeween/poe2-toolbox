// PoE2 工具箱 —— 国际服集市繁体中文化核心（MAIN 世界，document_start）
// 劫持页面 fetch 与 XHR，在响应到达时将英文数据翻译为繁体中文。
(function () {
    'use strict';

    // ── 1) 依赖词典（来自 lib/trade-tw-dict.js）───────────────────────
    const dict = window.PoE2TWDict || globalThis.PoE2TWDict;
    if (!dict) {
        console.warn('[PoE2TB-TW] 繁体化词典未就绪，跳过汉化注入');
        return;
    }

    const {
        typeTransMap = {},
        twStatic = { result: [] },
        twStats = { result: [] },
        twFilters = { result: [] },
        twProps = {},
        allocates = [],
        translations = {},
        notableStats = {},
        notablesByEnName = {}
    } = dict;

    // 武器/装备类别对照表
    const ITEM_CLASS_MAP = {
        'One Hand Mace': '單手錘',
        'Two Hand Mace': '雙手錘',
        'One Hand Sword': '單手劍',
        'Two Hand Sword': '雙手劍',
        'One Hand Axe': '單手斧',
        'Two Hand Axe': '雙手斧',
        'Bow': '弓',
        'Crossbow': '十字弓',
        'Quarterstaff': '細杖',
        'Staff': '長杖',
        'Wand': '法杖',
        'Sceptre': '權杖',
        'Dagger': '匕首',
        'Claw': '爪',
        'Flail': '鏈錘',
        'Spear': '長鋒',
        'Shield': '盾牌',
        'Focus': '聚能器',
        'Body Armour': '胸甲',
        'Boots': '鞋子',
        'Gloves': '手套',
        'Helmet': '頭盔',
        'Amulet': '護身符',
        'Ring': '戒指',
        'Belt': '腰帶',
        'Jewel': '珠寶',
        'Charm': '護符',
        'Relic': '聖物',
        'Mace': '錘',
        'Sword': '劍',
        'Axe': '斧'
    };

    // 属性翻译工具函数
    function trans4twProps(text) {
        if (twProps[text]) return twProps[text];
        if (ITEM_CLASS_MAP[text]) return ITEM_CLASS_MAP[text];
        const list = text.split(' ');
        if (list.length > 1) {
            return list.map(a => trans4twProps(a)).join(' ');
        } else {
            const find = Object.keys(twProps).find(a => text.includes(a));
            if (find) return text.replace(find, twProps[find]);
            const classFind = Object.keys(ITEM_CLASS_MAP).find(a => text.includes(a));
            if (classFind) return text.replace(classFind, ITEM_CLASS_MAP[classFind]);
        }
        return list.join(' ');
    }

    // ── 2) 开关与版本缓存管理 ──────────────────────────────────────────
    const TW_ENABLED_KEY = 'poe2tb_tw_enabled';
    const TW_REVISION_KEY = 'poe2tb_tw_revision';
    const TW_DATAMAP_KEY = 'poe2tb_tw_dataMap';
    const CURRENT_REVISION = '4.29.1-lang-tc-20260922';

    function isTwEnabled() {
        return localStorage.getItem(TW_ENABLED_KEY) !== '0';
    }

    if (!isTwEnabled()) {
        // 未开启繁体化时直接退出，不劫持任何网络请求，保持原版纯英文
        return;
    }

    // 缓存数据表
    let dataMap = {};
    try {
        const raw = localStorage.getItem(TW_DATAMAP_KEY);
        if (raw) dataMap = JSON.parse(raw);
    } catch (e) { dataMap = {}; }

    let statsIndex = null;

    function saveDataMap(newMap) {
        dataMap = newMap || dataMap;
        statsIndex = null;
        try {
            localStorage.setItem(TW_DATAMAP_KEY, JSON.stringify(dataMap));
        } catch (e) {}
    }

    // 检查词典版本更新：若版本变更则清空官方本地缓存
    if (localStorage.getItem(TW_REVISION_KEY) !== CURRENT_REVISION) {
        for (const key of ['lscache-trade2data', 'lscache-trade2items', 'lscache-trade2stats', 'lscache-trade2filters']) {
            localStorage.removeItem(key);
        }
        dataMap = {};
        saveDataMap();
        localStorage.setItem(TW_REVISION_KEY, CURRENT_REVISION);
    }

    const applyState = isTwEnabled() ? 1 : 2;

    // ── 3) ajaxHooker 网络劫持库 ──────────────────────────────────────
var ajaxHooker = function() {
    'use strict';
    const version = '1.4.3-patched'; // 标记修改版
    const hookInst = {
        hookFns: [],
        filters: []
    };
    const win = window.unsafeWindow || document.defaultView || window;
    let winAh = win.__ajaxHooker;
    const resProto = win.Response.prototype;
    const xhrResponses = ['response', 'responseText', 'responseXML'];
    const fetchResponses = ['arrayBuffer', 'blob', 'formData', 'json', 'text'];
    const fetchInitProps = ['method', 'headers', 'body', 'mode', 'credentials', 'cache', 'redirect', 'referrer', 'referrerPolicy', 'integrity', 'keepalive', 'signal', 'priority'];
    const xhrAsyncEvents = ['readystatechange', 'load', 'loadend'];
    const getType = ({}).toString.call.bind(({}).toString);
    const getDescriptor = Object.getOwnPropertyDescriptor.bind(Object);
    const emptyFn = () => {};
    const errorFn = e => console.error(e);
    function isThenable(obj) {
        return obj && ['object', 'function'].includes(typeof obj) && typeof obj.then === 'function';
    }
    function catchError(fn, ...args) {
        try {
            const result = fn(...args);
            if (isThenable(result))
                return result.then(null, errorFn);
            return result;
        } catch (err) {
            console.error(err);
        }
    }
    function defineProp(obj, prop, getter, setter) {
        Object.defineProperty(obj, prop, {
            configurable: true,
            enumerable: true,
            get: getter,
            set: setter
        });
    }
    function readonly(obj, prop, value=obj[prop]) {
        defineProp(obj, prop, () => value, emptyFn);
    }
    function writable(obj, prop, value=obj[prop]) {
        Object.defineProperty(obj, prop, {
            configurable: true,
            enumerable: true,
            writable: true,
            value: value
        });
    }
    function parseHeaders(obj) {
        const headers = {};
        switch (getType(obj)) {
            case '[object String]':
                for (const line of obj.trim().split(/[\r\n]+/)) {
                    const [header,value] = line.split(/\s*:\s*/);
                    if (!header)
                        break;
                    const lheader = header.toLowerCase();
                    headers[lheader] = lheader in headers ? `${headers[lheader]}, ${value}` : value;
                }
                break;
            case '[object Headers]':
                for (const [key,val] of obj) {
                    headers[key] = val;
                }
                break;
            case '[object Object]':
                return {
                    ...obj
                };
        }
        return headers;
    }
    function stopImmediatePropagation() {
        this.ajaxHooker_isStopped = true;
    }
    class SyncThenable {
        then(fn) {
            fn && fn();
            return new SyncThenable();
        }
    }
    class AHRequest {
        constructor(request) {
            this.request = request;
            this.requestClone = {
                ...this.request
            };
        }
        shouldFilter(filters) {
            const {type, url, method, async} = this.request;
            return filters.length && !filters.find(obj => {
                switch (true) {
                    case obj.type && obj.type !== type:
                    case getType(obj.url) === '[object String]' && !url.includes(obj.url):
                    case getType(obj.url) === '[object RegExp]' && !obj.url.test(url):
                    case obj.method && obj.method.toUpperCase() !== method.toUpperCase():
                    case 'async'in obj && obj.async !== async:
                        return false;
                }
                return true;
            }
                                                  );
        }
        waitForRequestKeys() {
            const requestKeys = ['url', 'method', 'abort', 'headers', 'data'];
            if (!this.request.async) {
                win.__ajaxHooker.hookInsts.forEach( ({hookFns, filters}) => {
                    if (this.shouldFilter(filters))
                        return;
                    hookFns.forEach(fn => {
                        if (getType(fn) === '[object Function]')
                            catchError(fn, this.request);
                    }
                                   );
                    requestKeys.forEach(key => {
                        if (isThenable(this.request[key]))
                            this.request[key] = this.requestClone[key];
                    }
                                       );
                }
                                                  );
                return new SyncThenable();
            }
            const promises = [];
            win.__ajaxHooker.hookInsts.forEach( ({hookFns, filters}) => {
                if (this.shouldFilter(filters))
                    return;
                promises.push(Promise.all(hookFns.map(fn => catchError(fn, this.request))).then( () => Promise.all(requestKeys.map(key => Promise.resolve(this.request[key]).then(val => this.request[key] = val, () => this.request[key] = this.requestClone[key])))));
            }
                                              );
            return Promise.all(promises);
        }
        waitForResponseKeys(response) {
            const responseKeys = this.request.type === 'xhr' ? xhrResponses : fetchResponses;
            if (!this.request.async) {
                if (getType(this.request.response) === '[object Function]') {
                    catchError(this.request.response, response);
                    responseKeys.forEach(key => {
                        if ('get'in getDescriptor(response, key) || isThenable(response[key])) {
                            delete response[key];
                        }
                    }
                                        );
                }
                return new SyncThenable();
            }
            return Promise.resolve(catchError(this.request.response, response)).then( () => Promise.all(responseKeys.map(key => {
                const descriptor = getDescriptor(response, key);
                if (descriptor && 'value'in descriptor) {
                    return Promise.resolve(descriptor.value).then(val => response[key] = val, () => delete response[key]);
                } else {
                    delete response[key];
                }
            }
                                                                                                                        )));
        }
    }
    const proxyHandler = {
        get(target, prop) {
            const descriptor = getDescriptor(target, prop);
            if (descriptor && !descriptor.configurable && !descriptor.writable && !descriptor.get)
                return target[prop];
            const ah = target.__ajaxHooker;
            if (ah && ah.proxyProps) {
                if (prop in ah.proxyProps) {
                    const pDescriptor = ah.proxyProps[prop];
                    if ('get'in pDescriptor)
                        return pDescriptor.get();
                    if (typeof pDescriptor.value === 'function')
                        return pDescriptor.value.bind(ah);
                    return pDescriptor.value;
                }
                if (typeof target[prop] === 'function')
                    return target[prop].bind(target);
            }
            return target[prop];
        },
        set(target, prop, value) {
            const descriptor = getDescriptor(target, prop);
            if (descriptor && !descriptor.configurable && !descriptor.writable && !descriptor.set)
                return true;
            const ah = target.__ajaxHooker;
            if (ah && ah.proxyProps && prop in ah.proxyProps) {
                const pDescriptor = ah.proxyProps[prop];
                pDescriptor.set ? pDescriptor.set(value) : (pDescriptor.value = value);
            } else {
                target[prop] = value;
            }
            return true;
        }
    };
    class XhrHooker {
        constructor(xhr) {
            const ah = this;
            Object.assign(ah, {
                originalXhr: xhr,
                proxyXhr: new Proxy(xhr,proxyHandler),
                resThenable: new SyncThenable(),
                proxyProps: {},
                proxyEvents: {}
            });
            xhr.addEventListener('readystatechange', e => {
                if (ah.proxyXhr.readyState === 4 && ah.request && typeof ah.request.response === 'function') {
                    const response = {
                        finalUrl: ah.proxyXhr.responseURL,
                        status: ah.proxyXhr.status,
                        responseHeaders: parseHeaders(ah.proxyXhr.getAllResponseHeaders())
                    };
                    const tempValues = {};
                    for (const key of xhrResponses) {
                        try {
                            tempValues[key] = ah.originalXhr[key];
                        } catch (err) {}
                        defineProp(response, key, () => {
                            return response[key] = tempValues[key];
                        }
                                   , val => {
                            delete response[key];
                            response[key] = val;
                        }
                                  );
                    }
                    ah.resThenable = new AHRequest(ah.request).waitForResponseKeys(response).then( () => {
                        for (const key of xhrResponses) {
                            ah.proxyProps[key] = {
                                get: () => {
                                    if (!(key in response))
                                        response[key] = tempValues[key];
                                    return response[key];
                                }
                            };
                        }
                    }
                                                                                                 );
                }
                ah.dispatchEvent(e);
            }
                                );
            xhr.addEventListener('load', e => ah.dispatchEvent(e));
            xhr.addEventListener('loadend', e => ah.dispatchEvent(e));
            for (const evt of xhrAsyncEvents) {
                const onEvt = 'on' + evt;
                ah.proxyProps[onEvt] = {
                    get: () => ah.proxyEvents[onEvt] || null,
                    set: val => ah.addEvent(onEvt, val)
                };
            }
            for (const method of ['setRequestHeader', 'addEventListener', 'removeEventListener', 'open', 'send']) {
                ah.proxyProps[method] = {
                    value: ah[method]
                };
            }
        }
        toJSON() {}
        addEvent(type, event) {
            if (type.startsWith('on')) {
                this.proxyEvents[type] = typeof event === 'function' ? event : null;
            } else {
                if (typeof event === 'object' && event !== null)
                    event = event.handleEvent;
                if (typeof event !== 'function')
                    return;
                this.proxyEvents[type] = this.proxyEvents[type] || new Set();
                this.proxyEvents[type].add(event);
            }
        }
        removeEvent(type, event) {
            if (type.startsWith('on')) {
                this.proxyEvents[type] = null;
            } else {
                if (typeof event === 'object' && event !== null)
                    event = event.handleEvent;
                this.proxyEvents[type] && this.proxyEvents[type].delete(event);
            }
        }
        dispatchEvent(e) {
            e.stopImmediatePropagation = stopImmediatePropagation;
            defineProp(e, 'target', () => this.proxyXhr);
            defineProp(e, 'currentTarget', () => this.proxyXhr);
            this.proxyEvents[e.type] && this.proxyEvents[e.type].forEach(fn => {
                this.resThenable.then( () => !e.ajaxHooker_isStopped && fn.call(this.proxyXhr, e));
            }
                                                                        );
            if (e.ajaxHooker_isStopped)
                return;
            const onEvent = this.proxyEvents['on' + e.type];
            onEvent && this.resThenable.then(onEvent.bind(this.proxyXhr, e));
        }
        setRequestHeader(header, value) {
            this.originalXhr.setRequestHeader(header, value);
            if (!this.request)
                return;
            const headers = this.request.headers;
            headers[header] = header in headers ? `${headers[header]}, ${value}` : value;
        }
        addEventListener(...args) {
            if (xhrAsyncEvents.includes(args[0])) {
                this.addEvent(args[0], args[1]);
            } else {
                this.originalXhr.addEventListener(...args);
            }
        }
        removeEventListener(...args) {
            if (xhrAsyncEvents.includes(args[0])) {
                this.removeEvent(args[0], args[1]);
            } else {
                this.originalXhr.removeEventListener(...args);
            }
        }
        open(method, url, async=true, ...args) {
            this.request = {
                type: 'xhr',
                url: url.toString(),
                method: method.toUpperCase(),
                abort: false,
                headers: {},
                data: null,
                response: null,
                async: !!async
            };
            this.openArgs = args;
            this.resThenable = new SyncThenable();
            ['responseURL', 'readyState', 'status', 'statusText', ...xhrResponses].forEach(key => {
                delete this.proxyProps[key];
            }
                                                                                          );
            return this.originalXhr.open(method, url, async, ...args);
        }
        send(data) {
            const ah = this;
            const xhr = ah.originalXhr;
            const request = ah.request;
            if (!request)
                return xhr.send(data);
            request.data = data;
            new AHRequest(request).waitForRequestKeys().then( () => {
                if (request.abort) {
                    if (typeof request.response === 'function') {
                        Object.assign(ah.proxyProps, {
                            responseURL: {
                                value: request.url
                            },
                            readyState: {
                                value: 4
                            },
                            status: {
                                value: 200
                            },
                            statusText: {
                                value: 'OK'
                            }
                        });
                        xhrAsyncEvents.forEach(evt => xhr.dispatchEvent(new Event(evt)));
                    }
                } else {
                    xhr.open(request.method, request.url, request.async, ...ah.openArgs);
                    for (const header in request.headers) {
                        xhr.setRequestHeader(header, request.headers[header]);
                    }
                    xhr.send(request.data);
                }
            }
                                                            );
        }
    }
    function fakeXHR() {
        const xhr = new winAh.realXHR();
        if ('__ajaxHooker'in xhr)
            console.warn('检测到不同版本的ajaxHooker，可能发生冲突！');
        xhr.__ajaxHooker = new XhrHooker(xhr);
        return xhr.__ajaxHooker.proxyXhr;
    }
    fakeXHR.prototype = win.XMLHttpRequest.prototype;
    Object.keys(win.XMLHttpRequest).forEach(key => fakeXHR[key] = win.XMLHttpRequest[key]);

    // ================== 此处开始核心修复 ==================
    // 自动为 Fetch 请求桥接 responseText 属性的方法。
    // POE 交易站新版改为使用 response.json() 读取部分数据；旧桥接会把
    // Promise<string> 直接塞进 json，最终令调用方拿到字符串而不是对象，
    // 于是 items.result 没有写入 store，knownItems 就会变成 undefined。
    function bridgeResponseText(response) {
        const hasOwn = key => Object.prototype.hasOwnProperty.call(response, key);
        const toText = value => {
            if (typeof value === 'string') return value;
            try {
                return JSON.stringify(value);
            } catch (e) {
                return String(value ?? '');
            }
        };
        const toJson = value => {
            if (typeof value !== 'string') return value;
            try {
                return JSON.parse(value);
            } catch (e) {
                return value;
            }
        };

        Object.defineProperty(response, 'responseText', {
            configurable: true,
            enumerable: true,
            get() {
                if (hasOwn('text')) {
                    return isThenable(response.text)
                        ? Promise.resolve(response.text).then(toText)
                        : toText(response.text);
                }
                if (hasOwn('json')) {
                    return isThenable(response.json)
                        ? Promise.resolve(response.json).then(toText)
                        : toText(response.json);
                }
                return response.__ajaxHookerResponseText;
            },
            set(val) {
                let bridged = false;
                if (hasOwn('text')) {
                    response.text = isThenable(val)
                        ? Promise.resolve(val).then(toText)
                        : toText(val);
                    bridged = true;
                }
                if (hasOwn('json')) {
                    response.json = isThenable(val)
                        ? Promise.resolve(val).then(toJson)
                        : toJson(val);
                    bridged = true;
                }
                if (!bridged) {
                    response.__ajaxHookerResponseText = isThenable(val)
                        ? Promise.resolve(val).then(toText)
                        : toText(val);
                }
            }
        });
    }
    // ================== 核心修复结束 ==================

    function fakeFetch(url, options={}) {
        if (!url)
            return winAh.realFetch.call(win, url, options);
        return new Promise(async (resolve, reject) => {
            const init = {};
            if (getType(url) === '[object Request]') {
                for (const prop of fetchInitProps)
                    init[prop] = url[prop];
                if (url.body)
                    init.body = await url.arrayBuffer();
                url = url.url;
            }
            url = url.toString();
            Object.assign(init, options);
            init.method = init.method || 'GET';
            init.headers = init.headers || {};
            const request = {
                type: 'fetch',
                url: url,
                method: init.method.toUpperCase(),
                abort: false,
                headers: parseHeaders(init.headers),
                data: init.body,
                response: null,
                async: true
            };
            const req = new AHRequest(request);
            await req.waitForRequestKeys();
            if (request.abort) {
                if (typeof request.response === 'function') {
                    const response = {
                        finalUrl: request.url,
                        status: 200,
                        responseHeaders: {}
                    };
                    bridgeResponseText(response); // 桥接被终止的请求
                    await req.waitForResponseKeys(response);
                    const key = fetchResponses.find(k => k in response);
                    let val = response[key];
                    if (key === 'json' && typeof val === 'object') {
                        val = catchError(JSON.stringify.bind(JSON), val);
                    }
                    const res = new Response(val,{
                        status: 200,
                        statusText: 'OK'
                    });
                    defineProp(res, 'type', () => 'basic');
                    defineProp(res, 'url', () => request.url);
                    resolve(res);
                } else {
                    reject(new DOMException('aborted','AbortError'));
                }
                return;
            }
            init.method = request.method;
            init.headers = request.headers;
            init.body = request.data;
            winAh.realFetch.call(win, request.url, init).then(res => {
                if (typeof request.response === 'function') {
                    const response = {
                        finalUrl: res.url,
                        status: res.status,
                        responseHeaders: parseHeaders(res.headers)
                    };
                    bridgeResponseText(response); // 桥接正常的请求
                    fetchResponses.forEach(key => res[key] = function() {
                        if (key in response)
                            return Promise.resolve(response[key]);
                        return resProto[key].call(this).then(val => {
                            response[key] = val;
                            return req.waitForResponseKeys(response).then( () => key in response ? response[key] : val);
                        }
                                                            );
                    }
                                          );
                }
                resolve(res);
            }
                                                              , reject);
        }
                          );
    }
    function fakeFetchClone() {
        const descriptors = Object.getOwnPropertyDescriptors(this);
        const res = winAh.realFetchClone.call(this);
        Object.defineProperties(res, descriptors);
        return res;
    }
    winAh = win.__ajaxHooker = winAh || {
        version,
        fakeXHR,
        fakeFetch,
        fakeFetchClone,
        realXHR: win.XMLHttpRequest,
        realFetch: win.fetch,
        realFetchClone: resProto.clone,
        hookInsts: new Set()
    };
    if (winAh.version !== version)
        console.warn('检测到不同版本的ajaxHooker，可能发生冲突！');
    win.XMLHttpRequest = winAh.fakeXHR;
    win.fetch = winAh.fakeFetch;
    resProto.clone = winAh.fakeFetchClone;
    winAh.hookInsts.add(hookInst);
    return {
        hook: fn => hookInst.hookFns.push(fn),
        filter: arr => {
            if (Array.isArray(arr))
                hookInst.filters = arr;
        }
        ,
        protect: () => {
            readonly(win, 'XMLHttpRequest', winAh.fakeXHR);
            readonly(win, 'fetch', winAh.fakeFetch);
            readonly(resProto, 'clone', winAh.fakeFetchClone);
        }
        ,
        unhook: () => {
            winAh.hookInsts.delete(hookInst);
            if (!winAh.hookInsts.size) {
                writable(win, 'XMLHttpRequest', winAh.realXHR);
                writable(win, 'fetch', winAh.realFetch);
                writable(resProto, 'clone', winAh.realFetchClone);
                delete win.__ajaxHooker;
            }
        }
    };
}();

    // ── 4) 词缀匹配与响应改写逻辑 ─────────────────────────────────────
    const fieldsToTranslate = ['baseType', 'name', 'typeLine'];
    const whisperMap = {};

    function plainStatText(text) {
        return String(text || '')
            .replace(/\[[^|\]]*\|([^\]]*)\]/g, '$1')
            .replace(/[\[\]]/g, '')
            .replace(/\s*\(local\)/ig, '')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function statSourceKey(text) {
        let hash = 2166136261;
        for (const character of String(text || '')) {
            hash ^= character.charCodeAt(0);
            hash = Math.imul(hash, 16777619);
        }
        return (hash >>> 0).toString(36);
    }

    function normalizeTemplateKey(text) {
        return plainStatText(text)
            .replace(/[+-]?(?:\d+(?:\.\d+)?|\.\d+)/g, '#')
            .toLowerCase();
    }

    function statTemplateMatches(template, text) {
        if (!template || !text) return false;
        const cleanTemplate = plainStatText(template);
        const cleanText = plainStatText(text);
        const escaped = cleanTemplate.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const pattern = escaped.replace(/#/g, '[+-]?(?:\\d+(?:\\.\\d+)?|\\.\\d+)');
        return new RegExp(`^${pattern}$`, 'i').test(cleanText);
    }

    function ensureStatsIndex() {
        if (statsIndex && statsIndex.source === dataMap['stats']) {
            return statsIndex;
        }
        if (!dataMap['stats'] || !Array.isArray(dataMap['stats'])) {
            return null;
        }
        const byId = new Map();
        const byGroupAndId = new Map();
        const byGroupAndTemplate = new Map();
        const byTemplate = new Map();

        for (const group of dataMap['stats']) {
            if (!group || !Array.isArray(group.entries)) continue;
            const gIdMap = new Map();
            const gTplMap = new Map();
            byGroupAndId.set(group.id, gIdMap);
            byGroupAndTemplate.set(group.id, gTplMap);

            for (const entry of group.entries) {
                if (!entry || !entry.id) continue;
                byId.set(entry.id, entry);
                gIdMap.set(entry.id, entry);
                const shortId = String(entry.id).split('.').pop();
                if (!gIdMap.has(shortId)) gIdMap.set(shortId, entry);
                if (!byId.has(shortId)) byId.set(shortId, entry);

                if (entry.enText) {
                    const norm = normalizeTemplateKey(entry.enText);
                    if (norm) {
                        if (!gTplMap.has(norm)) gTplMap.set(norm, entry);
                        if (!byTemplate.has(norm)) byTemplate.set(norm, entry);
                    }
                }
            }
        }

        statsIndex = {
            source: dataMap['stats'],
            byId,
            byGroupAndId,
            byGroupAndTemplate,
            byTemplate
        };
        return statsIndex;
    }

    function resolveMod(item, modKey, modItem, index, indexHelper) {
        const isObject = typeof modItem === 'object' && modItem !== null;
        const oldText = isObject ? (modItem.description || '') : String(modItem || '');
        if (!oldText) return null;

        const hash = isObject ? (modItem.hash || '') : '';
        const domain = isObject ? (modItem.domain || '') : '';
        const baseGroupKey = modKey.replace(/Mods$/, '');

        const { byId, byGroupAndId, byGroupAndTemplate, byTemplate } = indexHelper;

        function checkMatch(entry) {
            if (!entry || !entry.twText) return null;
            if (statTemplateMatches(entry.enText, oldText)) return entry;
            return null;
        }

        // 1. 若 modItem 自带 hash，精准匹配且校验模板一致
        if (hash) {
            const shortId = String(hash).split('.').pop();
            const groupPriority = [domain, baseGroupKey].filter(Boolean);
            for (const gId of groupPriority) {
                const groupMap = byGroupAndId.get(gId);
                if (groupMap) {
                    const candidate = groupMap.get(hash) || groupMap.get(shortId);
                    const match = checkMatch(candidate);
                    if (match) return match;
                }
            }
            const globalCandidate = byId.get(hash) || byId.get(shortId);
            const globalMatch = checkMatch(globalCandidate);
            if (globalMatch) return globalMatch;
        }

        // 2. 检查物品 extended.hashes 元数据
        const extendedHashes = item.extended && item.extended.hashes;
        if (extendedHashes) {
            const checkedHashes = new Set();
            const hashBuckets = [
                domain && extendedHashes[domain],
                extendedHashes[baseGroupKey]
            ].filter(Boolean);

            for (const bucket of hashBuckets) {
                if (!Array.isArray(bucket)) continue;
                for (const pair of bucket) {
                    if (!Array.isArray(pair) || !pair[0]) continue;
                    const statId = pair[0];
                    const lines = Array.isArray(pair[1]) ? pair[1] : [];
                    if (lines.includes(index) && !checkedHashes.has(statId)) {
                        checkedHashes.add(statId);
                        const shortId = String(statId).split('.').pop();
                        const candidate = byId.get(statId) || byId.get(shortId);
                        const match = checkMatch(candidate);
                        if (match) return match;
                    }
                }
                for (const pair of bucket) {
                    if (!Array.isArray(pair) || !pair[0]) continue;
                    const statId = pair[0];
                    if (!checkedHashes.has(statId)) {
                        checkedHashes.add(statId);
                        const shortId = String(statId).split('.').pop();
                        const candidate = byId.get(statId) || byId.get(shortId);
                        const match = checkMatch(candidate);
                        if (match) return match;
                    }
                }
            }

            for (const bKey of Object.keys(extendedHashes)) {
                const bucket = extendedHashes[bKey];
                if (!Array.isArray(bucket)) continue;
                for (const pair of bucket) {
                    if (!Array.isArray(pair) || !pair[0]) continue;
                    const statId = pair[0];
                    if (!checkedHashes.has(statId)) {
                        checkedHashes.add(statId);
                        const shortId = String(statId).split('.').pop();
                        const candidate = byId.get(statId) || byId.get(shortId);
                        const match = checkMatch(candidate);
                        if (match) return match;
                    }
                }
            }
        }

        // 3. 基于归一化模板哈希快速 O(1) 索引匹配
        const norm = normalizeTemplateKey(oldText);
        if (norm) {
            const groupPriority = [domain, baseGroupKey, 'explicit', 'crafted', 'fractured', 'desecrated', 'rune', 'implicit', 'enchant'].filter(Boolean);
            const seen = new Set();
            for (const gId of groupPriority) {
                if (seen.has(gId)) continue;
                seen.add(gId);
                const gTplMap = byGroupAndTemplate.get(gId);
                if (gTplMap) {
                    const candidate = gTplMap.get(norm);
                    const match = checkMatch(candidate);
                    if (match) return match;
                }
            }
            const globalCandidate = byTemplate.get(norm);
            const globalMatch = checkMatch(globalCandidate);
            if (globalMatch) return globalMatch;
        }

        // 4. 正则模板兜底遍历查找
        const searchGroups = [domain, baseGroupKey, 'explicit', 'crafted', 'fractured', 'desecrated', 'rune', 'implicit', 'enchant'];
        const seenGroups = new Set();
        for (const gId of searchGroups) {
            if (!gId || seenGroups.has(gId)) continue;
            seenGroups.add(gId);
            const group = dataMap['stats'].find(g => g.id === gId);
            if (!group || !Array.isArray(group.entries)) continue;
            for (const entry of group.entries) {
                const match = checkMatch(entry);
                if (match) return match;
            }
        }

        return null;
    }

    function findStatEntry(group, candidateId, originalText) {
        if (!group || !group.entries || !candidateId) return null;
        const id = String(candidateId);
        const shortId = id.split('.').pop();
        const candidates = group.entries.filter(entry => {
            const entryId = String(entry.id);
            return entryId === id || entryId.split('.').pop() === shortId;
        });
        return candidates.find(entry => statTemplateMatches(entry.enText, originalText)) || null;
    }

    if (isTwEnabled()) {
        ajaxHooker.hook(request => {
            request.response = res => {
                const responseText = res.responseText;
                if (request.url.includes('api/trade2/fetch')) {
                    const response = JSON.parse(responseText);
                    response.result.forEach(item => {
                        // whisper mapping omitted
                        if(applyState == 1){
                            const originalBaseType = item.item.baseType
                            const originalName = item.item.name
                            const originalTypeLine = item.item.typeLine
                            fieldsToTranslate.forEach(field => {
                                if (item.item[field] && typeTransMap[item.item[field]]) {
                                    item.item[field] = typeTransMap[item.item[field]];
                                }
                            });
                            if (originalTypeLine && !typeTransMap[originalTypeLine]) {
                                let translatedTypeLine = originalTypeLine
                                if (originalName && typeTransMap[originalName]) {
                                    translatedTypeLine = translatedTypeLine.replace(originalName, typeTransMap[originalName])
                                }
                                if (originalBaseType && typeTransMap[originalBaseType]) {
                                    translatedTypeLine = translatedTypeLine.replace(originalBaseType, typeTransMap[originalBaseType])
                                }
                                item.item.typeLine = translatedTypeLine
                            }
                            const sIndex = ensureStatsIndex();
                            if (sIndex) {
                                const MOD_KEYS = [
                                    'explicitMods',
                                    'implicitMods',
                                    'runeMods',
                                    'enchantMods',
                                    'fracturedMods',
                                    'craftedMods',
                                    'sanctumMods',
                                    'scourgeMods',
                                    'mutatedMods'
                                ];

                                MOD_KEYS.forEach(modKey => {
                                    const modTexts = item.item[modKey];
                                    if (!Array.isArray(modTexts) || modTexts.length === 0) return;

                                    item.item[modKey] = modTexts.map((modItem, index) => {
                                        const isObject = typeof modItem === 'object' && modItem !== null;
                                        const oldText = isObject ? (modItem.description || '') : String(modItem || '');
                                        const mod = resolveMod(item.item, modKey, modItem, index, sIndex);

                                        if (mod && mod.twText) {
                                            let newModText = mod.twText;
                                            const values = oldText.match(/[+-]?(\d*\.\d+|\d+)/g);
                                            if (values) {
                                                let i = 0;
                                                newModText = newModText.replace(/#/g, () => values[i++] ?? '#');
                                            }
                                            if (mod.text && mod.text.indexOf('配置 #') > -1) {
                                                const val = oldText.replace(/\[[^|\]]*\||[\][]/g, '').replace('Allocates', '').replaceAll("'", '').trim();
                                                const findAllocate = allocates.find(a => a.en_text === val || a.en_text.replace("'", '') === val);
                                                if (findAllocate) {
                                                    newModText = mod.twText.replace(/#/, findAllocate.text);
                                                }
                                            }
                                            if (newModText.match(/增加/) && oldText.match(/reduced/i)) {
                                                newModText = newModText.replace(/增加/, '降低');
                                            }
                                            if (newModText.match(/提高/) && oldText.match(/reduced/i)) {
                                                newModText = newModText.replace(/提高/, '降低');
                                            }
                                            if (newModText !== oldText) {
                                                return isObject ? {
                                                    ...modItem,
                                                    description: newModText
                                                } : newModText;
                                            }
                                        }

                                        return modItem;
                                    });
                                });
                            }

                            //properties
                            if(item.item.properties){
                                item.item.properties.forEach(p => {
                                    const simp = p.name.replace(/\[[^|\]]*\||[\][]/g, '')
                                    p.name = trans4twProps(simp)
                                    // if(twProps[simp]){
                                    //     p.name = twProps[simp]
                                    // }
                                })
                            }

                            //requirements
                            if(item.item.requirements){
                                item.item.requirements.forEach(p => {
                                    const simp = p.name.replace(/\[[^|\]]*\||[\][]/g, '')
                                    p.name = trans4twProps(simp)
                                })
                            }

                            // notableProperties (妄想症等珠宝的天赋名称与具体效果说明)
                            if (item.item.notableProperties && Array.isArray(item.item.notableProperties)) {
                                item.item.notableProperties.forEach(prop => {
                                    const skillId = String(prop.suffix || '');
                                    const notable = (notableStats && notableStats[skillId]) ||
                                        (notablesByEnName && prop.name && notablesByEnName[prop.name]);

                                    if (notable) {
                                        if (notable.name) prop.name = notable.name;
                                        if (Array.isArray(notable.stats) && Array.isArray(prop.values)) {
                                            prop.values.forEach((valArr, idx) => {
                                                if (notable.stats[idx]) {
                                                    valArr[0] = notable.stats[idx];
                                                }
                                            });
                                        }
                                    } else if (allocates) {
                                        const find = allocates.find(a => a.id === skillId || a.en_text === prop.name);
                                        if (find) prop.name = find.text;
                                    }
                                });
                            }
                        }

                    })
                    res.responseText = JSON.stringify(response);
                }else if ( applyState == 1 && request.url.includes('api/trade2/data')){
                    const response = JSON.parse(responseText);
                    const key = request.url.split('/').pop();
                    if(key == 'items'){
                        const result = response.result
                        res.responseText = new Promise(resolve => {
                            try {
                                for (const a of result) {
                                    for (const e of a.entries) {
                                        const translatedType = typeTransMap[e.type] || e.type
                                        if (!e.name) {
                                            if (translatedType !== e.type) {
                                                e.text = translatedType
                                            }
                                        } else {
                                            const translatedName = typeTransMap[e.name] || e.name
                                            if (translatedName !== e.name || translatedType !== e.type) {
                                                e.text = translatedName + ' ' + translatedType
                                            }
                                        }

                                    }
                                }
                                dataMap[key] = result
                                saveDataMap(dataMap);
                                response.result = result
                                resolve(JSON.stringify(response));
                            } catch (e) {
                                console.error(e)
                                resolve(responseText);
                            }
                        });
                    }else if(applyState == 1 && key == 'stats'){
                        const result = response.result
                        res.responseText = new Promise(resolve => {
                            try {
                                result.forEach((type) => {
                                    const findTwType = twStats.result.find((twType) => twType.id === type.id)
                                    if (!findTwType) return
                                    type.label = findTwType.label
                                    const translatedEntries = new Map()
                                    findTwType.entries.forEach(entry => {
                                        const entries = translatedEntries.get(entry.id) || []
                                        entries.push(entry)
                                        translatedEntries.set(entry.id, entries)
                                    })
                                    type.entries.forEach((entry) => {
                                        const candidates = translatedEntries.get(entry.id) || []
                                        const sourceKey = statSourceKey(entry.text)
                                        const translatedEntry = candidates.find(candidate => candidate.sourceKey === sourceKey) || (candidates.length === 1 ? candidates[0] : null)
                                        if (!translatedEntry) return
                                        entry.enText = entry.text
                                        entry.text = translatedEntry.text
                                        entry.twText = translatedEntry.text
                                        if (entry.option && entry.option.options && translatedEntry.option && translatedEntry.option.options) {
                                            const translatedOptions = new Map(translatedEntry.option.options.map(option => [option.id, option.text]))
                                            entry.option.options.forEach(option => {
                                                const translatedText = translatedOptions.get(option.id)
                                                if (translatedText) {
                                                    option.enText = option.text
                                                    option.text = translatedText
                                                }
                                            })
                                        }
                                    })
                                })
                                response.result = result
                                dataMap[key] = result
                                saveDataMap(dataMap);
                                resolve(JSON.stringify(response));
                            } catch (e) {
                                console.error(e)
                                resolve(responseText)
                            }
                        });
                    }else if(applyState == 1 && key == 'static'){
                        const result = response.result
                        res.responseText = new Promise(resolve => {
                            result.forEach((type) => {
                                const findTwType = twStatic.result.find((s) => s.id === type.id)

                                if (findTwType) {
                                    type.label = findTwType.label
                                    type.entries.forEach((entry) => {
                                        const findTwEntry = findTwType.entries.find((twEntry) => twEntry.id === entry.id)
                                        if (findTwEntry) {
                                            entry.text = findTwEntry.text
                                        }
                                    })
                                }
                            })
                            response.result = result
                            dataMap[key] = result
                            saveDataMap(dataMap);
                            resolve(JSON.stringify(response));
                        });
                    }else if(applyState == 1 && key == 'filters'){
                        const result = response.result
                        console.log('filtersfilters')
                        res.responseText = new Promise(resolve => {
                            try{
                                result.forEach((type) => {
                                    const findTwType = twFilters.result.find((s) => s.id === type.id)
                                    if (findTwType) {
                                        type.title = findTwType.title
                                        type.filters.forEach((f) => {
                                            const findtwf = findTwType.filters.find((twf) => twf.id === f.id)
                                            if (findtwf) {
                                                f.text = findtwf.text

                                                if(f.option && f.option.options && findtwf.option && findtwf.option.options ){
                                                    f.option.options.forEach((o) => {
                                                        const findtwfo = findtwf.option.options.find((fo) => fo.id === o.id)
                                                        if(findtwfo){
                                                            o.text = findtwfo.text
                                                        }
                                                    })
                                                }
                                            }
                                        })
                                    }
                                })
                                console.log(result)
                                response.result = result
                                dataMap[key] = result
                                saveDataMap(dataMap);
                                resolve(JSON.stringify(response));}catch(e){console.error(e)}
                        });
                    }

                }
            };
        });
    }

    // ── 5) DOM 静态文本替换 ───────────────────────────────────────────
function replaceText(node) {
        let text = node.textContent;
        for (const [original, translated] of Object.entries(translations)) {
            text = text.replace(new RegExp(original, 'g'), translated);
        }
        node.textContent = text;
    }

    // 递归替换元素节点中的文本内容
    function replaceTextInNode(node) {
        if (!node || !node.childNodes) return;
        node.childNodes.forEach(child => {
            if (child.nodeType === 3) { // 文本节点
                replaceText(child);
            } else if (child.nodeType === 1) { // 元素节点
                replaceTextInNode(child);
            }
        });
    }

    if (typeof document !== 'undefined') {
        if (document.readyState === 'loading') {
            document.addEventListener && document.addEventListener('DOMContentLoaded', () => replaceTextInNode(document.body));
        } else if (document.body) {
            replaceTextInNode(document.body);
        }
    }

    function clearCacheAndReload() {
        for (const k of ['lscache-trade2data', 'lscache-trade2items', 'lscache-trade2stats', 'lscache-trade2filters', TW_DATAMAP_KEY]) {
            localStorage.removeItem(k);
        }
        location.reload();
    }

    // 暴露供控制台与调试用的全局对象
    window.__PoE2TB_TW = {
        isTwEnabled,
        clearCacheAndReload
    };
})();

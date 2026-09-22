import fs from 'node:fs';
import vm from 'node:vm';

// 1. 加载 trade-tw-dict
const dictCode = fs.readFileSync('lib/trade-tw-dict.js', 'utf8');
const sandbox = { globalThis: {} };
vm.createContext(sandbox);
vm.runInContext(dictCode, sandbox);
const dict = sandbox.globalThis.PoE2TWDict;

// 2. 模拟从 /api/trade2/data/stats 提取的测试词条库
const mockStatsData = [
    {
        id: 'explicit',
        entries: [
            { id: 'explicit.stat_210067635', text: '#% increased Attack Speed (Local)', enText: '#% increased Attack Speed (Local)', twText: '增加#%攻擊速度 (部分)' },
            { id: 'explicit.stat_681332047', text: '#% increased Attack Speed', enText: '#% increased Attack Speed', twText: '增加#%攻擊速度' },
            { id: 'explicit.stat_709508406', text: 'Adds # to # Fire Damage', enText: 'Adds # to # Fire Damage', twText: '附加#至#火焰傷害' },
            { id: 'explicit.stat_1037193709', text: 'Adds # to # Cold Damage', enText: 'Adds # to # Cold Damage', twText: '附加#至#冰冷傷害' },
            { id: 'explicit.stat_3336890334', text: 'Adds # to # Lightning Damage', enText: 'Adds # to # Lightning Damage', twText: '附加#至#閃電傷害' },
            { id: 'explicit.stat_1881230714', text: '#% chance to gain Onslaught on Killing Hits with this Weapon', enText: '#% chance to gain Onslaught on Killing Hits with this Weapon', twText: '以此武器擊中且為最後一擊時，有#%機率獲得猛攻' },
            { id: 'explicit.stat_2544540062', text: 'Skills which create Fissures have a #% chance to create an additional Fissure', enText: 'Skills which create Fissures have a #% chance to create an additional Fissure', twText: '創造裂縫的技能有#%機率創造額外一道裂縫' },
            { id: 'explicit.stat_2293111154', text: 'Increases and Reductions to Minion Attack Speed also affect you', enText: 'Increases and Reductions to Minion Attack Speed also affect you', twText: '召喚物攻擊速度增減也會影響你' }
        ]
    },
    {
        id: 'crafted',
        entries: [
            { id: 'crafted.stat_210067635', text: '#% increased Attack Speed (Local)', enText: '#% increased Attack Speed (Local)', twText: '增加#%攻擊速度 (部分)' },
            { id: 'crafted.stat_1881230714', text: '#% chance to gain Onslaught on Killing Hits with this Weapon', enText: '#% chance to gain Onslaught on Killing Hits with this Weapon', twText: '以此武器擊中且為最後一擊時，有#%機率獲得猛攻' }
        ]
    },
    {
        id: 'fractured',
        entries: [
            { id: 'fractured.stat_210067635', text: '#% increased Attack Speed (Local)', enText: '#% increased Attack Speed (Local)', twText: '增加#%攻擊速度 (部分)' }
        ]
    },
    {
        id: 'rune',
        entries: [
            { id: 'rune.stat_210067635', text: '#% increased Attack Speed (Local)', enText: '#% increased Attack Speed (Local)', twText: '增加#%攻擊速度 (部分)' },
            { id: 'rune.stat_2293111154', text: 'Increases and Reductions to Minion Attack Speed also affect you', enText: 'Increases and Reductions to Minion Attack Speed also affect you', twText: '召喚物攻擊速度增減也會影響你' },
            { id: 'rune.stat_3155261831', text: 'Bonded: # to Level of all Minion Skills', enText: 'Bonded: # to Level of all Minion Skills', twText: '命定: 全部召喚物技能等級#' }
        ]
    },
    {
        id: 'desecrated',
        entries: [
            { id: 'desecrated.stat_2544540062', text: 'Skills which create Fissures have a #% chance to create an additional Fissure', enText: 'Skills which create Fissures have a #% chance to create an additional Fissure', twText: '創造裂縫的技能有#%機率創造額外一道裂縫' }
        ]
    }
];

// 3. 用户真实报告异常的 Dire Blow 物品数据（包含 GGG 接口下发的 crafted hash 错位）
const mockDireBlowItem = {
    name: 'Dire Blow',
    typeLine: 'Flanged Mace',
    baseType: 'Flanged Mace',
    properties: [
        { name: '[Mace|One Hand Mace]', values: [] },
        { name: '[Quality]', values: [['+20%', 1]] },
        { name: '[Physical] Damage', values: [['54-80', 1]] },
        { name: 'Attacks per Second', values: [['2.00', 1]] }
    ],
    runeMods: [
        { description: '5% increased [Attack] Speed', domain: 'rune', hash: 'stat.rune.stat_210067635' },
        { description: 'Increases and Reductions to [Minion] [Attack] Speed also affect you', domain: 'rune', hash: 'stat.rune.stat_2293111154' },
        { description: '[ShamanOnlyMods|Bonded]: +1 to Level of all [Minion|Minion] Skills', domain: 'rune', hash: 'stat.rune.stat_3155261831' }
    ],
    explicitMods: [
        {
            description: '24% increased [Attack] Speed',
            flags: { fractured: true, crafted: true },
            domain: 'fractured',
            hash: 'stat.fractured.stat_210067635'
        },
        {
            description: 'Adds 94 to 146 [Fire|Fire] Damage',
            domain: 'explicit',
            hash: 'stat.explicit.stat_709508406'
        },
        {
            description: 'Adds 48 to 65 [Cold|Cold] Damage',
            domain: 'explicit',
            hash: 'stat.explicit.stat_1037193709'
        },
        {
            description: 'Adds 9 to 212 [Lightning|Lightning] Damage',
            domain: 'explicit',
            hash: 'stat.explicit.stat_3336890334'
        },
        {
            // GGG 接口返回错误的 hash: 'stat.crafted.stat_210067635'，但实际文本为 Onslaught
            description: '22% chance to gain [Onslaught|Onslaught] on Killing [Hit|Hits] with this Weapon',
            flags: { crafted: true },
            domain: 'crafted',
            hash: 'stat.crafted.stat_210067635'
        },
        {
            description: 'Skills which create Fissures have a 20% chance to create an additional Fissure',
            flags: { desecrated: true },
            domain: 'desecrated',
            hash: 'stat.desecrated.stat_2544540062'
        }
    ],
    extended: {
        hashes: {
            explicit: [
                ['explicit.stat_709508406', [0]],
                ['explicit.stat_1037193709', [1]],
                ['explicit.stat_3336890334', [2]]
            ],
            fractured: [
                ['fractured.stat_210067635', [0]]
            ],
            crafted: [
                ['crafted.stat_210067635', null],
                ['crafted.stat_1881230714', [0]]
            ],
            rune: [
                ['rune.stat_210067635', null],
                ['rune.stat_2293111154', null],
                ['rune.stat_3155261831', null]
            ],
            desecrated: [
                ['desecrated.stat_2544540062', [0]]
            ]
        }
    }
};

// 4. 加载并运行 content/trade-tw.main.js
const twMainCode = fs.readFileSync('content/trade-tw.main.js', 'utf8');

const localStorageStore = new Map();
const mockLocalStorage = {
    getItem: (k) => localStorageStore.get(k) ?? null,
    setItem: (k, v) => localStorageStore.set(k, String(v)),
    removeItem: (k) => localStorageStore.delete(k),
    clear: () => localStorageStore.clear()
};

class MockResponse {
    constructor(body, init = {}) {
        this._body = typeof body === 'string' ? body : JSON.stringify(body);
        this.status = init.status || 200;
        this.statusText = init.statusText || 'OK';
        this.headers = new Map();
    }
    json() {
        return Promise.resolve(JSON.parse(this._body));
    }
    text() {
        return Promise.resolve(this._body);
    }
    clone() {
        return new MockResponse(this._body, { status: this.status, statusText: this.statusText });
    }
}

const mainSandbox = {
    window: {},
    globalThis: {},
    console,
    localStorage: mockLocalStorage,
    document: { defaultView: null },
    XMLHttpRequest: function () {},
    Response: MockResponse,
    DOMException: Error,
    setTimeout,
    clearTimeout
};
mainSandbox.window = mainSandbox;
mainSandbox.globalThis = mainSandbox;
mainSandbox.document.defaultView = mainSandbox;

mainSandbox.fetch = async function (url) {
    if (url.includes('api/trade2/data/stats')) {
        return new MockResponse(JSON.stringify({ result: mockStatsData }));
    }
    if (url.includes('api/trade2/fetch')) {
        return new MockResponse(JSON.stringify({
            result: [
                { item: JSON.parse(JSON.stringify(mockDireBlowItem)) }
            ]
        }));
    }
    return new MockResponse('{}');
};

vm.createContext(mainSandbox);
vm.runInContext(dictCode, mainSandbox);
vm.runInContext(twMainCode, mainSandbox);

async function runTests() {
    // 触发 stats 劫持与词典建表
    const sRes = await mainSandbox.fetch('https://www.pathofexile.com/api/trade2/data/stats');
    const sTxt = await sRes.text();
    console.log('stats hook response text preview:', sTxt.slice(0, 100));

    // 触发 fetch 劫持与物品汉化
    const itemRes = await mainSandbox.fetch('https://www.pathofexile.com/api/trade2/fetch/test-id');
    const itemJson = await itemRes.json();
    const item = itemJson.result[0].item;

    console.log('汉化名称:', item.name, item.typeLine);
    console.log('汉化属性:');
    item.properties.forEach(p => console.log('  ', p.name, p.values));
    console.log('汉化符文:');
    item.runeMods.forEach(m => console.log('  ', m.description || m));
    console.log('汉化词缀:');
    item.explicitMods.forEach(m => console.log('  ', m.description || m));

    // 断言验证
    const explicitTexts = item.explicitMods.map(m => m.description || m);
    const onslaught = explicitTexts[4];

    if (onslaught.includes('攻擊速度')) {
        throw new Error(`回归故障：猛攻词缀被错误替换为攻速：${onslaught}`);
    }
    if (onslaught !== '以此武器擊中且為最後一擊時，有22%機率獲得猛攻') {
        throw new Error(`猛攻汉化异常：${onslaught}`);
    }
    if (explicitTexts[0] !== '增加24%攻擊速度 (部分)') {
        throw new Error(`破裂攻速汉化异常：${explicitTexts[0]}`);
    }
    if (item.runeMods[0].description !== '增加5%攻擊速度 (部分)') {
        throw new Error(`符文攻速汉化异常：${item.runeMods[0].description}`);
    }
    if (!item.properties.some(p => p.name === '單手錘')) {
        throw new Error('One Hand Mace 类别未能正确汉化为 單手錘');
    }

    console.log('\n✅ 所有测试断言均通过！猛攻与攻速不再冲突，物品类别与多攻速正常翻译。');
}

runTests().catch(err => {
    console.error('测试未通过:', err);
    process.exit(1);
});

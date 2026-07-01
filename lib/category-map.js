// PoE2 工具箱 —— 交易行类别 id -> poe2db slug 共享映射
// view-mods（按类别查 poe2db 词缀页）与 pob-copy（按类别预取补充词典）共用。
// 挂到 globalThis.PoE2TBCat。
(function () {
    'use strict';

    // 防具防御变体后缀 -> 显示名（仅 view-mods 渲染用；pob-copy 只需要 slug）
    const ARMOUR_DEFS = [
        ['str', '护甲'], ['dex', '闪避'], ['int', '能量护盾'],
        ['str_dex', '护甲/闪避'], ['str_int', '护甲/能量护盾'],
        ['dex_int', '闪避/能量护盾'], ['str_dex_int', '全属性'],
    ];

    // 交易行类别 id -> poe2db slug（字符串=单页；{slug,note}=单页带提示；
    // {armour:'X'}=防具多变体；{multi:[[slug,label]...]}=多页 tab）
    const CATEGORY_MAP = {
        'weapon.claw': 'Claws', 'weapon.dagger': 'Daggers', 'weapon.onesword': 'One_Hand_Swords',
        'weapon.oneaxe': 'One_Hand_Axes', 'weapon.onemace': 'One_Hand_Maces', 'weapon.spear': 'Spears',
        'weapon.flail': 'Flails', 'weapon.twosword': 'Two_Hand_Swords', 'weapon.twoaxe': 'Two_Hand_Axes',
        'weapon.twomace': 'Two_Hand_Maces', 'weapon.warstaff': 'Quarterstaves',
        'weapon.bow': 'Bows', 'weapon.crossbow': 'Crossbows',
        'weapon.wand': 'Wands', 'weapon.sceptre': 'Sceptres', 'weapon.staff': 'Staves', 'weapon.talisman': 'Talismans',
        'armour.focus': 'Foci', 'armour.buckler': 'Bucklers', 'armour.quiver': 'Quivers',
        'accessory.amulet': 'Amulets', 'accessory.belt': 'Belts', 'accessory.ring': 'Rings',
        'jewel': {
            multi: [
                ['Ruby', '红玉'], ['Emerald', '翡翠'], ['Sapphire', '蓝玉'], ['Diamond', '宝钻'],
                ['Time-Lost_Ruby', '失落的红玉'], ['Time-Lost_Emerald', '失落的翡翠'],
                ['Time-Lost_Sapphire', '失落的蓝玉'], ['Time-Lost_Diamond', '失落的宝钻'],
            ]
        },
        'flask.life': 'Life_Flasks', 'flask.mana': 'Mana_Flasks', 'flask.charm': 'Charms',
        'map.waystone': { slug: 'Waystones_top_tier', note: '只展示引路石(Top)的词缀' },
        'map.tablet': {
            multi: [
                ['Breach_Tablet', '裂隙石板'], ['Expedition_Tablet', '先祖秘藏石板'],
                ['Delirium_Tablet', '惊悸迷雾石板'], ['Ritual_Tablet', '驱灵仪式石板'],
                ['Irradiated_Tablet', '能量辐照石板'], ['Overseer_Tablet', '霸主石板'],
                ['Abyss_Tablet', '深渊石板'], ['Temple_Tablet', '神庙石板'],
            ]
        },
        'sanctum.relic': {
            multi: [
                ['Urn_Relic', '壶瓮遗物'], ['Amphora_Relic', '土罐遗物'], ['Vase_Relic', '花瓶遗物'],
                ['Seal_Relic', '封印遗物'], ['Coffer_Relic', '匣柜遗物'], ['Tapestry_Relic', '挂毯遗物'],
                ['Incense_Relic', '熏香遗物'],
            ]
        },
        'armour.helmet': { armour: 'Helmets' }, 'armour.chest': { armour: 'Body_Armours' },
        'armour.gloves': { armour: 'Gloves' }, 'armour.boots': { armour: 'Boots' }, 'armour.shield': { armour: 'Shields' },
    };

    // 由 category id 展开成需要预取的 poe2db slug 列表（去 label，pob-copy 用）。
    // 防具多变体一次性把 7 个属性变体 slug 都返回，因为翻译时不知道物品是哪一种。
    // 未映射的 category 返回空数组。
    function slugsForCategory(catId) {
        if (!catId) return [];
        const m = CATEGORY_MAP[catId];
        if (!m) return [];
        if (typeof m === 'string') return [m];
        if (m.slug) return [m.slug];
        if (m.armour) return ARMOUR_DEFS.map(([suf]) => m.armour + '_' + suf);
        if (m.multi) return m.multi.map(([slug]) => slug);
        return [];
    }

    globalThis.PoE2TBCat = { CATEGORY_MAP, ARMOUR_DEFS, slugsForCategory };
})();

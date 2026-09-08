/**
 * Zebra RSS —— MV3 后台 Service Worker
 * ============================================================
 *
 * 职责说明
 * ------------------------------------------------------------
 * 原 MV2 版本的后台页（background.js）是一个完整的 Angular 应用，重度依赖
 * DOM / localStorage / XMLHttpRequest / setInterval，这些能力在 MV3 的
 * Service Worker 中全部不可用，因此不能直接搬过来。
 *
 * 迁移架构（两者配合）：
 *
 *   mv3-sw.js（本文件，常驻）
 *     - 创建并保活离屏文档
 *     - 拥有完整 chrome.* API 权限
 *     - 代理执行离屏文档转发过来的 API 调用
 *     - 监听各类事件并回抛给离屏文档
 *     - 处理工具栏图标点击、扩展自动更新
 *
 *   offscreen.html + offscreen-shim.js + background.js（离屏文档）
 *     - 承载真正的业务逻辑（DOM / localStorage / XHR / 定时器）
 *     - 缺失的 chrome API 由 offscreen-shim.js 桥接到本文件
 *
 * 注意：本文件必须保持「无 eval、无 DOM、无远程代码」，否则 Service Worker 会加载失败。
 */

const OFFSCREEN_URL = 'offscreen.html';
const KEEP_ALIVE_ALARM = 'zebra-keep-offscreen';

/* ============================================================
 * 一、离屏文档的创建与保活
 * ============================================================ */

// 创建离屏文档是异步的，用这个变量做去重，避免并发重复创建
let creatingOffscreen = null;

/**
 * 确保离屏文档存在；已存在则直接返回
 */
async function ensureOffscreenDocument() {
    if (creatingOffscreen) {
        return creatingOffscreen;
    }

    creatingOffscreen = (async () => {
        // Chrome 124+ 提供 hasDocument；低版本只能尝试创建并忽略「已存在」报错
        if (chrome.offscreen && typeof chrome.offscreen.hasDocument === 'function') {
            try {
                if (await chrome.offscreen.hasDocument()) {
                    return;
                }
            } catch (e) {
                // hasDocument 不可用或异常时，继续走下面的创建逻辑
            }
        }

        try {
            await chrome.offscreen.createDocument({
                url: chrome.runtime.getURL(OFFSCREEN_URL),
                reasons: ['LOCAL_STORAGE', 'DOM_PARSER'],
                justification:
                    '在后台持续拉取 RSS 订阅源、缓存条目并定时自动更新，' +
                    '需要一个具备 DOM、localStorage 与 XHR 运行环境的常驻页面'
            });
        } catch (e) {
            // 最常见的是「已存在同一个离屏文档」，属于正常情况，忽略即可
            console.warn('[zebra] 创建离屏文档失败，将由下一次保活重试：', e && e.message);
        }
    })();

    try {
        await creatingOffscreen;
    } finally {
        creatingOffscreen = null;
    }
}

/**
 * 建立每分钟一次的保活闹钟：离屏文档若被回收，最多 1 分钟内自动重建
 */
async function setupKeepAliveAlarm() {
    try {
        const existing = await chrome.alarms.get(KEEP_ALIVE_ALARM);
        if (!existing) {
            await chrome.alarms.create(KEEP_ALIVE_ALARM, { periodInMinutes: 1 });
        }
    } catch (e) {
        console.warn('[zebra] 创建保活闹钟失败：', e && e.message);
    }
}

/* ============================================================
 * 二、API 桥：代理执行离屏文档转发过来的 chrome.* 调用
 * ------------------------------------------------------------
 * 离屏文档只有消息类 API，tabs / windows / notifications / action /
 * contextMenus / permissions / sessions 等都由这里代为执行。
 * 只做白名单内的调用，避免把 Service Worker 变成任意代码执行入口。
 * ============================================================ */

/** 把 chrome.* 的回调式 API 包成 Promise，便于统一处理 */
function callWithCallback(fn, args) {
    return new Promise((resolve, reject) => {
        try {
            fn(...args, (result) => {
                const err = chrome.runtime.lastError;
                if (err) { reject(new Error(err.message)); } else { resolve(result); }
            });
        } catch (e) {
            reject(e);
        }
    });
}

/** 白名单：允许离屏文档调用的 API，path -> 实际执行函数 */
const ZEBRA_API = {
    'action.setBadgeText': (a) => callWithCallback(chrome.action.setBadgeText.bind(chrome.action), a),
    'action.setIcon': (a) => callWithCallback(chrome.action.setIcon.bind(chrome.action), a),

    'contextMenus.create': (a) => callWithCallback(chrome.contextMenus.create.bind(chrome.contextMenus), a),
    'contextMenus.removeAll': (a) => callWithCallback(chrome.contextMenus.removeAll.bind(chrome.contextMenus), a),

    'notifications.clear': (a) => callWithCallback(chrome.notifications.clear.bind(chrome.notifications), a),
    'notifications.create': (a) => callWithCallback(chrome.notifications.create.bind(chrome.notifications), a),
    'notifications.getPermissionLevel': (a) => callWithCallback(chrome.notifications.getPermissionLevel.bind(chrome.notifications), a),
    'notifications.update': (a) => callWithCallback(chrome.notifications.update.bind(chrome.notifications), a),

    'permissions.contains': (a) => callWithCallback(chrome.permissions.contains.bind(chrome.permissions), a),
    'permissions.remove': (a) => callWithCallback(chrome.permissions.remove.bind(chrome.permissions), a),
    'permissions.request': (a) => callWithCallback(chrome.permissions.request.bind(chrome.permissions), a),

    'runtime.reload': () => { chrome.runtime.reload(); return Promise.resolve(); },
    'runtime.setUninstallURL': (a) => callWithCallback(chrome.runtime.setUninstallURL.bind(chrome.runtime), a),

    'sessions.getRecentlyClosed': (a) => callWithCallback(chrome.sessions.getRecentlyClosed.bind(chrome.sessions), a),
    'sessions.restore': (a) => callWithCallback(chrome.sessions.restore.bind(chrome.sessions), a),

    'tabs.create': (a) => callWithCallback(chrome.tabs.create.bind(chrome.tabs), a),
    'tabs.move': (a) => callWithCallback(chrome.tabs.move.bind(chrome.tabs), a),
    'tabs.query': (a) => callWithCallback(chrome.tabs.query.bind(chrome.tabs), a),

    'windows.create': (a) => callWithCallback(chrome.windows.create.bind(chrome.windows), a),
    'windows.getAll': (a) => callWithCallback(chrome.windows.getAll.bind(chrome.windows), a),
    'windows.remove': (a) => callWithCallback(chrome.windows.remove.bind(chrome.windows), a),
    'windows.update': (a) => callWithCallback(chrome.windows.update.bind(chrome.windows), a)
};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    // 顺手保活：任何消息到来都确保离屏文档在跑
    ensureOffscreenDocument();

    if (!msg || msg.__zebraBridge !== true) {
        return; // 非 API 桥消息：不消费，交给其它监听者
    }

    if (msg.kind === 'call') {
        const entry = ZEBRA_API[msg.path];
        if (!entry) {
            sendResponse({ ok: false, error: '未授权的 API 调用: chrome.' + msg.path });
            return;
        }
        Promise.resolve()
            .then(() => entry(msg.args || []))
            .then((result) => sendResponse({ ok: true, result: result === undefined ? null : result }))
            .catch((e) => sendResponse({ ok: false, error: (e && e.message) || String(e) }));
        return true; // 异步 sendResponse
    }

    if (msg.kind === 'event-op') {
        // 事件订阅/退订：真实监听器已在下方全部注册，这里只需确保离屏文档活着
        ensureOffscreenDocument();
    }
});

/* ============================================================
 * 三、事件回抛：把真实 chrome 事件转发给离屏文档
 * ============================================================ */

function fireToOffscreen(path, args) {
    const payload = { __zebraBridge: true, kind: 'event', path: path, args: args };
    try {
        const p = chrome.runtime.sendMessage(payload);
        if (p && typeof p.catch === 'function') { p.catch(() => { /* 离屏文档不在时忽略 */ }); }
    } catch (e) { /* 忽略 */ }
}

/** 注册需要回抛的真实事件监听（必须在 Service Worker 顶层同步注册） */
function registerEventForwarding() {
    if (chrome.contextMenus && chrome.contextMenus.onClicked) {
        chrome.contextMenus.onClicked.addListener((info, tab) => {
            fireToOffscreen('contextMenus.onClicked', [info, tab ? { id: tab.id } : null]);
        });
    }
    if (chrome.notifications) {
        chrome.notifications.onButtonClicked.addListener((id, idx) => fireToOffscreen('notifications.onButtonClicked', [id, idx]));
        chrome.notifications.onClicked.addListener((id) => fireToOffscreen('notifications.onClicked', [id]));
        chrome.notifications.onClosed.addListener((id, byUser) => fireToOffscreen('notifications.onClosed', [id, byUser]));
        if (chrome.notifications.onPermissionLevelChanged) {
            chrome.notifications.onPermissionLevelChanged.addListener((level) => fireToOffscreen('notifications.onPermissionLevelChanged', [level]));
        }
    }
    if (chrome.runtime.onUpdateAvailable) {
        chrome.runtime.onUpdateAvailable.addListener((details) => fireToOffscreen('runtime.onUpdateAvailable', [details]));
    }
    if (chrome.tabs) {
        chrome.tabs.onActivated.addListener((info) => fireToOffscreen('tabs.onActivated', [info]));
        chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
            // 只回抛最小必要信息，避免不可克隆对象
            fireToOffscreen('tabs.onUpdated', [tabId, changeInfo, tab ? { id: tab.id, url: tab.url, active: tab.active, windowId: tab.windowId } : null]);
        });
    }
}
registerEventForwarding();

/* ============================================================
 * 四、生命周期
 * ============================================================ */

// 安装 / 更新 / 浏览器启动时拉起离屏文档
chrome.runtime.onInstalled.addListener(() => {
    ensureOffscreenDocument();
    setupKeepAliveAlarm();
});

chrome.runtime.onStartup.addListener(() => {
    ensureOffscreenDocument();
    setupKeepAliveAlarm();
});

// 保活：离屏文档被回收时自动重建
chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm && alarm.name === KEEP_ALIVE_ALARM) {
        ensureOffscreenDocument();
    }
});

chrome.runtime.onConnect.addListener(() => {
    ensureOffscreenDocument();
});

// 点击工具栏图标：先确保离屏文档在跑，再打开 UI 页
// （原 background.js 中的同名监听已摘除，确保只有一个地方响应点击）
chrome.action.onClicked.addListener(async () => {
    await ensureOffscreenDocument();
    chrome.tabs.create({ url: chrome.runtime.getURL('index.html#/collections/ALL_FEEDS') });
});

// 自动更新：MV3 下 onUpdateAvailable 在离屏文档中拿不到，这里在 Service Worker 兜底处理。
// 逻辑与 background.js 中的 updateSelf 一致：UI 页没打开时才立即重载，避免打断阅读。
chrome.runtime.onUpdateAvailable.addListener(async () => {
    try {
        const tabs = await chrome.tabs.query({});
        const uiOpened = (tabs || []).some(function (t) {
            return !!t.url && t.url.indexOf(chrome.runtime.getURL('index.html')) === 0;
        });
        if (!uiOpened) {
            chrome.runtime.reload();
        }
    } catch (e) {
        // 查询失败时按「没有 UI 页打开」处理，保证更新能装上
        chrome.runtime.reload();
    }
});

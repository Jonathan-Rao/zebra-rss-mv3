/*
 * MV3 离屏文档兼容垫片（必须在 background.js 之前加载）
 * ============================================================
 *
 * 背景：Chrome 的 offscreen 文档只暴露极少数扩展 API（实测仅
 * chrome.runtime 的 getURL / connect / sendMessage / onConnect / onMessage）。
 * 而原 MV2 后台页 background.js 是一个完整 Angular 应用，用到了
 * tabs / windows / notifications / action / contextMenus / permissions /
 * sessions 等大量 API，缺一个都会让依赖注入中断，导致后台整体起不来。
 *
 * 已实测会直接卡死启动的 API：
 *   - chrome.runtime.getManifest：离屏文档中不是函数
 *     （VersionService 在依赖注入阶段就会调用它）
 *   - chrome.permissions：整个对象不存在
 *     （SettingsService 构造函数会调用 chrome.permissions.contains）
 *   - chrome.action.setIcon：启动时就会调用
 *
 * 方案：
 *   1) getManifest：同步读取扩展自身的 manifest.json 补齐；
 *   2) 其余缺失 API：通过 chrome.runtime 消息转发给 Service Worker 执行，
 *      Service Worker 拥有完整 API 权限，执行后把结果回传；
 *   3) 事件类 API（tabs.onUpdated、notifications.onClicked 等）：
 *      在离屏文档里伪造 addListener/removeListener/hasListener，
 *      Service Worker 监听真实事件后回抛给这里分发。
 *
 * 注意：MV3 extension_pages 的 CSP 是 script-src 'self'，禁止内联脚本，
 * 所以必须保持为独立的外部 JS 文件。
 */
(function () {
    'use strict';

    if (typeof chrome === 'undefined' || !chrome || !chrome.runtime) { return; }

    /* ========================================================
     * 1) getManifest 垫片
     * ======================================================== */
    try {
        if (typeof chrome.runtime.getManifest !== 'function') {
            var xhr = new XMLHttpRequest();
            xhr.open('GET', chrome.runtime.getURL('manifest.json'), false); /* 同步读取本地资源 */
            xhr.send(null);
            if (xhr.status === 0 || xhr.status === 200) {
                var cachedManifest = JSON.parse(xhr.responseText);
                chrome.runtime.getManifest = function () { return cachedManifest; };
            } else {
                console.error('[zebra shim] 读取 manifest.json 失败，status=' + xhr.status);
            }
        }
    } catch (e) {
        console.error('[zebra shim] getManifest 垫片安装失败：', e);
    }

    /* ========================================================
     * 1.5) 屏蔽 favicon 代理 SW 注册（离屏文档中不可用）
     * --------------------------------------------------------
     * background.js 末尾会尝试 navigator.serviceWorker.register('/sw.js')
     * 做 favicon 缓存。离屏文档里不允许注册 Service Worker，会抛
     * "The user denied permission to use Service Worker"。该 SW 仅缓存
     * favicon，离屏环境无意义。直接把它换成「返回 rejected promise」的桩，
     * 这样 background.js 里 `if ('serviceWorker' in navigator)` 仍为真，
     * 但 register() 的 reject 会被原代码自带的 .catch 吞掉，不再刷屏、
     * 也绝不会中断 background.js 的初始化（否则 RPC 服务端起不来）。
     * 注意：绝不能把 serviceWorker 设为 undefined，否则
     * navigator.serviceWorker.register 会同步抛 TypeError 直接中断启动。
     * ======================================================== */
    try {
        if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
            Object.defineProperty(navigator, 'serviceWorker', {
                configurable: true,
                value: {
                    register: function () { return Promise.reject(new Error('serviceWorker disabled in offscreen document')); },
                    getRegistration: function () { return Promise.resolve(null); },
                    getRegistrations: function () { return Promise.resolve([]); },
                    addEventListener: function () {},
                    removeEventListener: function () {},
                    controller: null,
                    ready: Promise.resolve(null)
                }
            });
        }
    } catch (e) { /* 不可写就留给原 catch 处理，无功能影响 */ }

    /* ========================================================
     * 2) API 桥
     * ======================================================== */

    /** 需要转发给 Service Worker 执行的方法（均为 background.js 实际用到的） */
    var CALL_APIS = [
        'action.setBadgeText',
        'action.setIcon',
        'contextMenus.create',
        'contextMenus.removeAll',
        'notifications.clear',
        'notifications.create',
        'notifications.getPermissionLevel',
        'notifications.update',
        'permissions.contains',
        'permissions.remove',
        'permissions.request',
        'runtime.reload',
        'runtime.setUninstallURL',
        'sessions.getRecentlyClosed',
        'sessions.restore',
        'tabs.create',
        'tabs.move',
        'tabs.query',
        'windows.create',
        'windows.getAll',
        'windows.remove',
        'windows.update'
    ];

    /** 需要由 Service Worker 回抛的事件 */
    var EVENT_APIS = [
        'contextMenus.onClicked',
        'notifications.onButtonClicked',
        'notifications.onClicked',
        'notifications.onClosed',
        'notifications.onPermissionLevelChanged',
        'runtime.onUpdateAvailable',
        'tabs.onActivated',
        'tabs.onUpdated'
    ];

    var seq = 0;
    var pending = {};      /* id -> {resolve, reject} */
    var eventFns = {};     /* path -> [fn] */
    var menuClickHandlers = {}; /* menuItemId -> onclick */

    chrome.runtime.onMessage.addListener(function (msg) {
        if (!msg || msg.__zebraBridge !== true) { return; }

        if (msg.kind === 'result') {
            var p = pending[msg.id];
            if (p) {
                delete pending[msg.id];
                if (msg.ok) { p.resolve(msg.result); } else { p.reject(new Error(msg.error || 'bridge 调用失败')); }
            }
        } else if (msg.kind === 'event') {
            var fns = (eventFns[msg.path] || []).slice();
            fns.forEach(function (fn) {
                try { fn.apply(null, msg.args || []); } catch (e) { console.error('[zebra shim] 事件回调异常 ' + msg.path, e); }
            });

            /* 让旧版 contextMenus.create 的 onclick 属性继续工作 */
            if (msg.path === 'contextMenus.onClicked' && msg.args && msg.args[0]) {
                var handler = menuClickHandlers[msg.args[0].menuItemId];
                if (handler) {
                    try { handler(msg.args[0], msg.args[1]); } catch (e) { console.error('[zebra shim] 菜单 onclick 异常', e); }
                }
            }
        }
        /* 不返回 true：不占用 sendResponse，避免干扰其它监听者 */
    });

    function callWorker(path, args) {
        return new Promise(function (resolve, reject) {
            var id = ++seq;
            pending[id] = { resolve: resolve, reject: reject };
            try {
                chrome.runtime.sendMessage({ __zebraBridge: true, kind: 'call', id: id, path: path, args: args });
            } catch (e) {
                delete pending[id];
                reject(e);
                return;
            }
            setTimeout(function () {
                if (pending[id]) {
                    delete pending[id];
                    reject(new Error('[zebra shim] 调用超时: chrome.' + path));
                }
            }, 20000);
        });
    }

    function tellWorker(op, path) {
        try { chrome.runtime.sendMessage({ __zebraBridge: true, kind: 'event-op', op: op, path: path }); } catch (e) { /* 忽略 */ }
    }

    function dispatchEvent(path, args) {
        var fns = (eventFns[path] || []).slice();
        fns.forEach(function (fn) {
            try { fn.apply(null, args || []); } catch (e) { console.error('[zebra shim] 事件回调异常 ' + path, e); }
        });
    }

    function installCallBridge(path) {
        var parts = path.split('.');
        var ns = parts[0], name = parts[1];
        if (!chrome[ns]) { try { chrome[ns] = {}; } catch (e) { return; } }
        var target = chrome[ns];
        if (typeof target[name] !== 'undefined') { return; } /* 原生已有就不覆盖 */

        target[name] = function () {
            var args = Array.prototype.slice.call(arguments);
            var cb = null;
            if (args.length && typeof args[args.length - 1] === 'function') { cb = args.pop(); }

            /* contextMenus.create 的 onclick 属性在 MV3 已不支持，这里捕获并本地保存，
               由下面的 contextMenus.onClicked 事件桥接来回调，让旧代码无感继续工作 */
            if (path === 'contextMenus.create' && args[0] && typeof args[0].onclick === 'function') {
                var captured = args[0];
                var localProps = {};
                for (var k in captured) { if (k !== 'onclick') { localProps[k] = captured[k]; } }
                args[0] = localProps;
                return callWorker(path, args).then(function (menuId) {
                    if (menuId !== undefined && menuId !== null) { menuClickHandlers[menuId] = captured.onclick; }
                    if (cb) { safeCall(cb, menuId); }
                    return menuId;
                }, function (err) {
                    if (cb) { safeCall(cb, undefined); }
                    throw err;
                });
            }

            return callWorker(path, args).then(function (result) {
                if (cb) { safeCall(cb, result); }
                return result;
            }, function (err) {
                if (cb) { safeCall(cb, undefined); }
                throw err;
            });
        };
    }

    function safeCall(cb, value) {
        try { cb(value); } catch (e) { console.error('[zebra shim] 回调异常', e); }
    }

    function installEventBridge(path) {
        var parts = path.split('.');
        var ns = parts[0], name = parts[1];
        if (!chrome[ns]) { try { chrome[ns] = {}; } catch (e) { return; } }
        var target = chrome[ns];
        if (target[name]) { return; } /* 原生已有就不覆盖 */

        var fns = [];
        eventFns[path] = fns;
        target[name] = {
            addListener: function (fn) {
                if (typeof fn !== 'function' || fns.indexOf(fn) !== -1) { return; }
                fns.push(fn);
                if (fns.length === 1) { tellWorker('addListener', path); }
            },
            removeListener: function (fn) {
                var i = fns.indexOf(fn);
                if (i !== -1) { fns.splice(i, 1); }
            },
            hasListener: function (fn) { return fns.indexOf(fn) !== -1; }
        };
    }

    /* 事件路径在 eventFns 里用完整路径做 key，dispatch 用 msg.path（完整路径） */
    EVENT_APIS.forEach(function (p) {
        installEventBridge(p);
    });
    CALL_APIS.forEach(installCallBridge);

    console.log('[zebra shim] 离屏文档 API 桥已安装');
})();

/*
 * Zebra RSS —— 设置界面中英切换
 * ------------------------------------------------------------
 * 该 UI 是 2019 年 Angular 打包产物，无源码、无 i18n 框架，
 * 所有文案硬编码英文。本脚本以「注入 + 文本替换」方式实现：
 *   1) 在设置界面右上角浮标提供「中文 / English」切换
 *   2) 偏好存入 localStorage['zebra-lang']，默认 'en'
 *   3) MutationObserver 监听 DOM，把可见英文文本/属性替换为中文
 *      （Angular 重渲染覆盖中文时，观察器会再次替回，保证一致）
 * 仅作用于设置相关界面，不触碰任何 bundle 与业务逻辑。
 */
(function () {
    'use strict';

    var STORAGE_KEY = 'zebra-lang';

    // 英文 -> 中文 映射（键为真实抓取的精确文案）
    var EN_ZH = {
        // 侧边栏 / 导航
        'Read Later': '稍后阅读',
        'All Feeds': '所有订阅',
        'Settings': '设置',
        'General': '常规',
        'Appearance': '外观',
        'Notifications': '通知',
        'Subscription button': '订阅按钮',
        'Feeds Manager': '订阅源管理',
        'Import OPML': '导入 OPML',
        'Export OPML': '导出 OPML',
        'Hot Keys': '快捷键',
        // 顶栏按钮 tooltip
        'Add feed': '添加订阅',
        'Add collection': '添加分组',
        'Mark all as read': '全部标为已读',
        'Update all feeds': '更新所有订阅',
        'Open setting': '打开设置',
        'Auto update enabled': '自动更新已启用',
        // 版本更新横幅
        'New version is available': '有新版本可用',
        'Click here to update now': '点击此处立即更新',
        // 常规页
        'Save': '保存',
        'Enable automatic channel updates': '启用自动更新订阅',
        'No': '否',
        'Yes': '是',
        'Work in the background': '后台运行',
        'Do not forget to enable the corresponding setting in the Chrome settings.': '别忘了在 Chrome 设置中开启相应选项。',
        'Auto update interval (minutes)': '自动更新间隔（分钟）',
        'Number of update threads (from 1 to 10)': '更新线程数（1 到 10）',
        'Increase to speed up updating feeds and reduce performance.': '增大该值可加快订阅更新，但会降低性能。',
        'Recommended value: 3-5': '推荐值：3-5',
        'Maximum number of saved entries (per feed)': '每个订阅源保存的最大条目数',
        'Maximum number of saved entries': '每个订阅源保存的最大条目数',
        'Automatic loading of records when scrolling the page': '滚动页面时自动加载记录',
        'Automatically mark as read while scrolling': '滚动时自动标为已读',
        'Enable channels preview': '启用订阅源预览',
        'Group the feeds in the collection': '在分组中对订阅源分组',
        // 外观页
        'Extension icon for': '扩展图标配色',
        'You can change the color of the extension icon to match your browser\'s theme.': '你可以更改扩展图标的颜色，以匹配你的浏览器主题。',
        'Light theme': '浅色主题',
        'Dark theme': '深色主题',
        'Show counter on extension icon': '在扩展图标上显示未读数',
        // 通知页
        'Enable notifications': '启用通知',
        'When click on notification': '点击通知时',
        'Open entry': '打开条目',
        'Close notification': '关闭通知',
        'Automatically close notifications': '自动关闭通知',
        'Grouping notifications': '通知分组',
        'Do not group': '不分组',
        'Group by channels': '按订阅源分组',
        'Group all': '全部归为一组',
        // 订阅按钮页
        'Enable subscription button': '启用订阅按钮',
        "Always show subscription button (even if page doesn't contain feeds)": '始终显示订阅按钮（即使页面不含订阅源）',
        // 订阅源管理页
        'Feed name': '订阅源名称',
        'All': '全部',
        'Update Interval': '更新间隔',
        'Keep Entries': '保留条目',
        'Notifica-tions': '通知',
        'Auto update': '自动更新',
        // 导入页
        'Import from': '导入来源',
        'File': '文件',
        'Text': '文本',
        'Click to select': '点击选择',
        'or drop OPML file here': '或将 OPML 文件拖拽到此处',
        'Start import': '开始导入',
        // 导出页
        'Download OPML': '下载 OPML',
        '- or -': '- 或 -',
        'Copy OPML': '复制 OPML'
    };

    // 中文 -> 英文（切回英文时还原）
    var ZH_EN = {};
    Object.keys(EN_ZH).forEach(function (k) { ZH_EN[EN_ZH[k]] = k; });

    var currentLang = localStorage.getItem(STORAGE_KEY) === 'zh' ? 'zh' : 'en';
    var widget = null;

    function isSettingsRoute() {
        var h = location.hash || '';
        return h.indexOf('/settings') !== -1;
    }

    function getMap(lang) {
        return lang === 'zh' ? EN_ZH : ZH_EN;
    }

    // 把某个节点（及子树）按映射替换文本
    function translateNode(node, map) {
        if (node === widget || (widget && widget.contains(node))) return; // 跳过控件自身
        var i, child;
        if (node.nodeType === 3) { // 文本节点
            var raw = node.nodeValue;
            if (!raw || !raw.trim()) return;
            var cand = raw.trim();
            if (map[cand] !== undefined) {
                node.nodeValue = raw.replace(cand, map[cand]);
            }
            return;
        }
        if (node.nodeType === 1) { // 元素
            if (node.hasAttribute && node.hasAttribute('placeholder')) {
                var ph = node.getAttribute('placeholder');
                if (ph && ph.trim() && map[ph.trim()] !== undefined) {
                    node.setAttribute('placeholder', ph.replace(ph.trim(), map[ph.trim()]));
                }
            }
            ['title', 'aria-label', 'alt'].forEach(function (a) {
                if (node.hasAttribute && node.hasAttribute(a)) {
                    var v = node.getAttribute(a);
                    if (v && v.trim() && map[v.trim()] !== undefined) {
                        node.setAttribute(a, v.replace(v.trim(), map[v.trim()]));
                    }
                }
            });
            var kids = node.childNodes;
            for (i = 0; i < kids.length; i++) translateNode(kids[i], map);
        }
    }

    function applyTranslations(lang) {
        try {
            translateNode(document.body, getMap(lang));
        } catch (e) { /* 忽略单次遍历异常 */ }
    }

    // ---- 浮标控件 ----
    function buildWidget() {
        var el = document.createElement('div');
        el.id = 'zebra-lang-switch';
        el.innerHTML =
            '<span class="zls-label"></span>' +
            '<button type="button" class="zls-btn" data-lang="zh">中文</button>' +
            '<button type="button" class="zls-btn" data-lang="en">English</button>';
        var style = document.createElement('style');
        style.textContent =
            '#zebra-lang-switch{position:fixed;top:8px;right:8px;z-index:2147483647;' +
            'display:none;align-items:center;gap:6px;padding:8px 10px;' +
            'font:14px/1.2 Roboto,Arial,sans-serif;color:#333;}' +
            '#zebra-lang-switch .zls-label{font-weight:600;margin-right:2px;}' +
            '#zebra-lang-switch .zls-btn{border:1px solid #ccc;background:#f5f5f5;' +
            'border-radius:4px;padding:4px 10px;cursor:pointer;font:14px/1.2 inherit;color:#333;}' +
            '#zebra-lang-switch .zls-btn.zls-active{background:#4285f4;border-color:#4285f4;color:#fff;}';
        document.head.appendChild(style);
        // 插入到 body 最前面，避免被 Angular 顶栏遮挡
        document.body.insertBefore(el, document.body.firstChild);

        el.addEventListener('click', function (e) {
            var btn = e.target.closest('.zls-btn');
            if (!btn) return;
            var lang = btn.getAttribute('data-lang');
            if (lang === currentLang) return;
            currentLang = lang;
            try { localStorage.setItem(STORAGE_KEY, lang); } catch (err) { /* 忽略 */ }
            applyTranslations(lang);
            updateWidgetUI();
        });
        return el;
    }

    function updateWidgetUI() {
        if (!widget) return;
        widget.querySelector('.zls-label').textContent = currentLang === 'zh' ? '显示语言' : 'Language';
        widget.querySelectorAll('.zls-btn').forEach(function (b) {
            b.classList.toggle('zls-active', b.getAttribute('data-lang') === currentLang);
        });
    }

    function updateWidgetVisibility() {
        if (!widget) return;
        widget.style.display = isSettingsRoute() ? 'flex' : 'none';
    }

    // ---- 启动 ----
    function start() {
        if (!document.body) {
            // 等待 body 出现（兼容脚本在 head / body 末尾各种加载时机）
            var wait = new MutationObserver(function () {
                if (document.body) { wait.disconnect(); start(); }
            });
            wait.observe(document.documentElement, { childList: true, subtree: true });
            return;
        }
        widget = buildWidget();
        updateWidgetUI();
        updateWidgetVisibility();

        applyTranslations(currentLang);
        console.log('[Zebra Lang Switch] initialized, route=' + (location.hash || '(empty)') +
            ', lang=' + currentLang + ', visible=' + (widget.style.display !== 'none'));

        // Angular 动态重渲染时持续替换 + 同步刷新控件显隐
        var timer = null;
        var obs = new MutationObserver(function () {
            if (timer) clearTimeout(timer);
            timer = setTimeout(function () {
                applyTranslations(currentLang);
                updateWidgetVisibility();
            }, 60);
        });
        obs.observe(document.body, { childList: true, subtree: true, characterData: true });

        function onRouteChange() {
            updateWidgetVisibility();
            applyTranslations(currentLang);
        }
        window.addEventListener('hashchange', onRouteChange);
        window.addEventListener('popstate', onRouteChange);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start);
    } else {
        start();
    }
})();

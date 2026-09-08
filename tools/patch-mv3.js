#!/usr/bin/env node
/**
 * MV3 API 适配补丁脚本（一次性工具）
 *
 * 在去 eval 之后执行，处理 MV2 -> MV3 被移除/改名的 chrome API：
 *   1. chrome.browserAction.onClicked 监听整体摘除（改由 mv3-sw.js 统一处理，避免双重触发）
 *   2. chrome.browserAction.*  -> chrome.action.*
 *   3. chrome.extension.getURL -> chrome.runtime.getURL
 *   4. chrome.extension.getViews({type:'tab'}) -> chrome.tabs.query（MV3 已移除 getViews）
 *
 * 用法：node tools/patch-mv3.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

/** 记录每处替换是否命中，未命中要报错，避免"以为改了其实没改" */
function replaceOnce(src, file, name, pattern, replacement) {
    const before = src;
    const next = src.replace(pattern, replacement);
    if (next === before) {
        console.error(`[失败] ${file}：未匹配到 ${name}`);
        return null;
    }
    const hits = (before.match(pattern) || []).length;
    console.log(`[完成] ${file}：${name}（${hits} 处）`);
    return next;
}

/** 1 + 2 + 3 + 4：background.js */
function patchBackground() {
    const file = path.join(ROOT, 'background.js');
    let src = fs.readFileSync(file, 'utf8');
    const base = path.basename(file);

    // 1) 摘除 browserAction.onClicked 监听（该逻辑已迁至 mv3-sw.js）
    src = replaceOnce(
        src,
        base,
        '摘除 browserAction.onClicked 监听',
        /chrome\.browserAction\.onClicked\.addListener\(function \(\) \{\r?\n\s*chrome\.tabs\.create\(\{\r?\n\s*url: chrome\.extension\.getURL\('index\.html#\/collections\/ALL_FEEDS'\)\r?\n\s*\}\);\r?\n\}\);/,
        "/* MV3: 工具栏图标点击已迁移到 mv3-sw.js 统一处理（避免离屏文档与 Service Worker 双重触发打开两个标签页） */"
    );
    if (src === null) return false;

    // 2) browserAction -> action
    src = replaceOnce(src, base, 'browserAction -> action', /chrome\.browserAction\./g, 'chrome.action.');
    if (src === null) return false;

    // 3) extension.getURL -> runtime.getURL
    src = replaceOnce(src, base, 'extension.getURL -> runtime.getURL', /chrome\.extension\.getURL/g, 'chrome.runtime.getURL');
    if (src === null) return false;

    // 4) updateSelf：getViews 已移除，改用 tabs.query
    src = replaceOnce(
        src,
        base,
        'updateSelf: getViews -> tabs.query',
        /var updateSelf = function \(\) \{\r?\n\s*if \(version\.needUpdate && chrome\.extension\.getViews\(\{ type: 'tab' \}\)\.length === 0\) \{\r?\n\s*chrome\.runtime\.reload\(\);\r?\n\s*\}\r?\n\};/,
        [
            'var updateSelf = function () {',
            "    // MV3: chrome.extension.getViews 已移除，改用 chrome.tabs.query 判断 UI 页是否已打开",
            '    if (version.needUpdate) {',
            '        chrome.tabs.query({}, function (tabs) {',
            '            var opened = (tabs || []).some(function (t) {',
            "                return !!t.url && t.url.indexOf(chrome.runtime.getURL('index.html')) === 0;",
            '            });',
            '            if (!opened) {',
            '                chrome.runtime.reload();',
            '            }',
            '        });',
            '    }',
            '};'
        ].join('\r\n')
    );
    if (src === null) return false;

    fs.writeFileSync(file, src, 'utf8');
    return true;
}

/** inject.js：extension.getURL -> runtime.getURL */
function patchInject() {
    const file = path.join(ROOT, 'inject.js');
    let src = fs.readFileSync(file, 'utf8');
    src = replaceOnce(src, path.basename(file), 'extension.getURL -> runtime.getURL', /chrome\.extension\.getURL/g, 'chrome.runtime.getURL');
    if (src === null) return false;
    fs.writeFileSync(file, src, 'utf8');
    return true;
}

const ok = patchBackground() && patchInject();
process.exit(ok ? 0 : 1);

#!/usr/bin/env node
/**
 * 权限名适配补丁脚本（一次性工具）
 *
 * MV2 的 "background" 权限（允许扩展在后台常驻）在 MV3 中已被移除，
 * 名字也不再被识别。代码里 3 处 chrome.permissions.* 调用都带着它：
 *   chrome.permissions.contains / request / remove({ permissions: ['background', 'sessions'] })
 *
 * 在 MV3 下传 'background' 会直接抛错
 * （"Permission 'background' is unknown or URL pattern is malformed"），
 * 其中 contains 位于 SettingsService 构造函数中，抛错会导致内容脚本初始化失败。
 *
 * 处理：权限数组统一去掉 'background'，只保留 'sessions'。
 *
 * 用法：node tools/patch-permissions.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

// 打包产物有两种写法：background.js / inject.js 未压缩，main-es*.js 已压缩
const TARGETS = [
    { file: 'background.js', from: "['background', 'sessions']", to: "['sessions']" },
    { file: 'inject.js', from: "['background', 'sessions']", to: "['sessions']" },
    { file: 'main-es2015.9b8396ac1076975f7651.js', from: '["background","sessions"]', to: '["sessions"]' },
    { file: 'main-es5.b0a5699af6b3c9df3de6.js', from: '["background","sessions"]', to: '["sessions"]' }
];

let ok = true;

for (const t of TARGETS) {
    const full = path.join(ROOT, t.file);
    if (!fs.existsSync(full)) {
        console.error(`[失败] 文件不存在：${t.file}`);
        ok = false;
        continue;
    }

    const src = fs.readFileSync(full, 'utf8');
    const hits = src.split(t.from).length - 1;

    if (hits === 0) {
        // 幂等：已经改过了就跳过
        if (src.includes(t.to)) {
            console.log(`[跳过] ${t.file}：已处理`);
            continue;
        }
        console.error(`[失败] ${t.file}：未匹配到 ${t.from}`);
        ok = false;
        continue;
    }

    // 按字面量替换（split/join，不解析正则）
    fs.writeFileSync(full, src.split(t.from).join(t.to), 'utf8');
    console.log(`[完成] ${t.file}：${hits} 处 ${t.from} -> ${t.to}`);
}

process.exit(ok ? 0 : 1);

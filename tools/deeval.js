#!/usr/bin/env node
/**
 * 去 eval 补丁脚本（一次性工具）
 *
 * 背景：background.js / inject.js / sw.js 是 webpack devtool:eval 产物，
 * 每个模块体都被包在 eval("...") 里。MV3 全面禁止 eval（扩展页 CSP 不允许 unsafe-eval，
 * Service Worker 更是直接禁用），必须把这层包裹还原成普通代码。
 *
 * 做法：精确匹配 eval("...") 字面量 -> 解码字符串 -> 原地替换为源码。
 * 严格保持文件原有换行符（本项目为 CRLF）与其余字节不变。
 *
 * 用法：node tools/deeval.js <file1> [file2 ...]
 */

const fs = require('fs');
const path = require('path');

/** 把 JS 字符串字面量（含转义）还原为真实字符串；优先 JSON.parse，失败回退到 Function */
function unescapeLiteral(literal) {
    try {
        return JSON.parse(literal);
    } catch (e) {
        // JSON 不支持 \xNN / \v / \0 等转义，但 JS 支持
        return new Function('return ' + literal)();
    }
}

/** 统计文件中 eval(" 出现的次数，用于校验 */
function countEvalWrappers(src) {
    const m = src.match(/eval\("/g);
    return m ? m.length : 0;
}

function deevalFile(file) {
    const startSize = fs.statSync(file).size;
    let src = fs.readFileSync(file, 'utf8');

    const before = countEvalWrappers(src);
    if (before === 0) {
        console.log(`[跳过] ${path.basename(file)}：未发现 eval(" 包裹`);
        return true;
    }

    let replaced = 0;
    const pattern = /eval\(("(?:[^"\\]|\\.)*")\)/g;
    src = src.replace(pattern, (whole, literal) => {
        replaced += 1;
        return unescapeLiteral(literal);
    });

    const after = countEvalWrappers(src);
    if (after !== 0) {
        console.error(`[失败] ${path.basename(file)}：仍残留 ${after} 处 eval("`);
        return false;
    }
    if (replaced !== before) {
        console.error(`[失败] ${path.basename(file)}：期望替换 ${before} 处，实际 ${replaced} 处`);
        return false;
    }

    fs.writeFileSync(file, src, 'utf8');

    // 换行符一致性检查：不应把 CRLF 变成 LF
    const crlf = (src.match(/\r\n/g) || []).length;
    const lf = (src.match(/(?<!\r)\n/g) || []).length;

    const endSize = fs.statSync(file).size;
    console.log(
        `[完成] ${path.basename(file)}：替换 ${replaced} 处 eval 包裹，` +
        `${startSize} -> ${endSize} 字节，CRLF=${crlf} 裸LF=${lf}`
    );
    return true;
}

const files = process.argv.slice(2);
if (files.length === 0) {
    console.error('用法：node tools/deeval.js <file1> [file2 ...]');
    process.exit(1);
}

let ok = true;
for (const f of files) {
    if (!fs.existsSync(f)) {
        console.error(`[失败] 文件不存在：${f}`);
        ok = false;
        continue;
    }
    if (!deevalFile(f)) ok = false;
}
process.exit(ok ? 0 : 1);

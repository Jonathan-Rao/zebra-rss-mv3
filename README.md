# Zebra RSS（Manifest V3 兼容版）

## 项目背景

Zebra RSS 是一款 Chrome 浏览器扩展，用于聚合、阅读和管理 RSS 订阅源。原版扩展由作者发布于 Chrome 网上应用店，采用 **Manifest V2** 扩展协议开发。

随着 Google 持续推进扩展生态升级，**最新版本的 Chrome 浏览器已经彻底废弃并停止支持 Manifest V2 协议**。与此同时，原作者已停止维护该扩展，未能跟随升级到 Manifest V3，导致大量用户在更新 Chrome 后 Zebra RSS 无法再加载、无法使用。原版扩展也因此被 Chrome 网上应用店下架。

## 本版本说明

为了让 Zebra RSS 能够在最新版 Chrome 中继续使用，本仓库在原版基础上，按照 **Manifest V3（MV3）** 扩展协议进行了重写与优化：

- 将后台逻辑由 Manifest V2 的后台页面迁移到 **Service Worker + Offscreen Document** 架构；
- 适配 MV3 的 API 变更（`browserAction` → `action`、`extension.getURL` → `runtime.getURL` 等）；
- 使用 `declarativeNetRequest` 替代原有的网络拦截逻辑（如订阅源 favicon 获取）；
- 修复了在新版 Chrome 下无法导入 OPML、订阅源图标不显示等问题；
- 设置界面增加了「中文 / English」语言切换，并记忆用户偏好。

现在，本版本已经可以正常安装在最新版 Chrome 浏览器中使用，原有订阅、阅读、更新等核心功能均可正常工作。

## 功能特性

- RSS 订阅源管理（添加 / 分组 / 更新）
- OPML 导入与导出
- 自动更新订阅（可配置间隔与线程数）
- 新条目通知
- 浅色 / 深色主题与扩展图标配色
- 设置界面中英语言切换（记忆偏好）

## 效果预览

<p align="center">
  <img src="https://jonathan-rao.github.io/picx-images-hosting/20260909/zebra-rss.pg3dg23t7.jpg" alt="zebra-rss-mv3效果示例" width="820">
</p>


## 安装方法

1. 打开 Chrome，在地址栏访问 `chrome://extensions`；
2. 右上角开启「开发者模式（Developer mode）」；
3. 点击「加载已解压的扩展程序（Load unpacked）」，选择本目录；
4. 扩展安装完成，点击工具栏图标或右键扩展选择「选项」即可进入设置。

## 注意事项

- 本扩展使用 `localStorage` 存储订阅数据，**请勿移动或重命名本扩展目录**，否则订阅数据将丢失。
- 本版本为非官方维护版本，仅供个人在最新版 Chrome 中继续使用原功能。
- 由于 Manifest V3 的安全限制，部分原版行为（如后台常驻拉取）已改为按需唤醒，功能表现与原版一致。

## 技术迁移要点（简述）

| 原 MV2 方案 | MV3 替代方案 |
| --- | --- |
| 后台页面 `background` | Service Worker（`mv3-sw.js`）+ 离屏文档（`offscreen.html`） |
| `browserAction` | `action` |
| `extension.getURL` | `runtime.getURL` |
| 网络拦截（`webRequest`） | `declarativeNetRequest`（favicon 规则） |
| 内联脚本 | 独立外部脚本文件（符合 MV3 CSP） |



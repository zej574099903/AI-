# PDF 朗读器（Expo App）

一个基于 `Expo + React Native + 腾讯云 TTS` 的移动端 PDF 朗读 App。

## 功能

- 导入文本型 PDF（在服务端提取文本）
- 按句朗读，点击任意句跳转
- 腾讯云 TTS 音色切换、语速、停顿
- 进度条拖动跳转
- 按 PDF 内容哈希保存进度（同名不同文件不串进度）

## 项目结构

- `App.js`：Expo 移动端 UI 与播放逻辑
- `server.js`：本地 Node 服务（PDF 提取 + 腾讯云 TTS）

## 环境要求

- Node.js 18+
- Expo CLI（通过 `npx expo` 使用即可）
- 一个已开通腾讯云 TTS 的账号

## 环境变量

在项目根目录创建 `.env`：

```bash
TENCENT_SECRET_ID=你的腾讯云SecretId
TENCENT_SECRET_KEY=你的腾讯云SecretKey
PORT=8787
HOST=0.0.0.0
APP_ORIGIN=http://localhost:19006
```

说明：

- 在手机真机调试时，`HOST` 建议用 `0.0.0.0`
- App 里需要把“后端地址”设置成你电脑的局域网 IP，例如 `http://192.168.1.23:8787`

## 安装依赖

```bash
npm install
```

## 启动

1. 启动后端：

```bash
npm run server
```

2. 启动 Expo：

```bash
npm run start
```

3. 在 Expo Go 或模拟器打开 App

## 可用脚本

```bash
npm run start
npm run android
npm run ios
npm run web
npm run server
npm run lint
npm run build:web
```

## API 接口

- `POST /api/pdf/extract`：接收 PDF base64，返回提取文本
- `POST /api/tts/synthesize`：单段 TTS（兼容旧 Web 调用）
- `POST /api/tts/synthesize-batch`：多段 TTS 合并后返回 base64


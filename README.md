# 弈境 · Liquid Xiangqi

可运行的中国象棋游戏：液态玻璃棋盘、云母棋子、带液体连接和涟漪的吃子动画；支持三种棋风的人机练习，以及房间码在线对弈和旁观。

## 本地运行

需要 Node.js 22.12 或更新版本。

```bash
npm install
npm run dev
```

打开终端打印的 Vite 地址，默认 `http://localhost:5173`，端口占用时顺延。本次验收地址为 `http://localhost:5175`。房间服务监听 `3001`，网页通过 Vite 代理 `/ws` 和 `/api`。局域网朋友可访问终端输出的 Network 地址，输入同一个房间码。

## 构建和运行

```bash
npm run build
npm start
```

打开 `http://localhost:3001`。生产服务同时提供网页、Web Worker 和 WebSocket，不依赖 Vite。`PORT` 可以调整服务端口。对外部署需要支持 WebSocket 的 Node 主机；只有静态文件托管无法提供 PVP。

反向代理应将网页和 `/ws` 指向同一服务，并转发 WebSocket `Upgrade` 与 `Connection` 头。默认接受同主机名的浏览器来源；如必须跨域，使用逗号分隔的 `XIANGQI_ALLOWED_ORIGINS` 明确配置额外来源。

## 已实现

- 标准棋子走法、蹩马腿、塞象眼、炮架、九宫、过河、将帅照面、自陷将军过滤、将死与困毙判负。
- PVE：谨慎、平衡、激进。三者共用迭代加深搜索和相同时间预算，仅评估偏好不同；没有难度档位。可选执红或执黑，支持悔棋、认输、重开。
- AI 在 Web Worker 中搜索，避免阻塞落子和融合动画。
- 吃子时展示约 1.12 秒的靠近、液体连接、吞并、微滴、回弹、涟漪；普通落子使用平滑缓动。尊重系统“减少动态效果”。
- PVP：创建六位房间码、加入、自动分配空座、满座旁观、双方准备开局、服务端权威走子验证。
- 非对弈期间可站起、旁观者可入座；对弈中禁止换座。棋手退出或断线后结束当前对局，对手获胜。旁观者离开不影响对局。结束后支持替补、再准备和重赛。
- 双方求和、中文棋谱、已吃棋子、翻转棋盘、落点提示、声音开关、键盘操作。
- 320px、390px 触控布局及桌面布局。

## 已确认的棋规

设置中提供**比赛棋例开关**，默认开启。开启时依据 WXF 识别长将、长捉、真根/假根、互兑与交替循环，单方犯例三轮后提示变着，继续循环判负；无单方犯例时四轮循环判和。关闭后使用简化练习规则：单方长将判负，其余三次重复判和。

默认连续 **50 回合 / 100 步** 无吃子判和，吃子后归零。可改为 60 回合 / 120 步或关闭限着。兵卒移动不重置计数。PVP 房间建立后规则固定，所有参与者共用。

用户已确认默认限着和提供棋例开关。原文依据、自动裁定约定及判例覆盖见 [规则说明](docs/RULES.md)。

## 验证

```bash
npm test
npm run build
```

17 项 Node 测试覆盖核心规则边界、终局、循环变着提示、AI 战术、真实三客户端房间状态与权限，以及房间规则在加入/旁观/重赛时的一致性。其中重放 173 组公开棋例事实，验证 170 组可重复末态的裁定。

浏览器验收脚本使用 Python Playwright：

```bash
python -m pip install -r tests/requirements.txt
python -m playwright install chromium
XIANGQI_URL=http://127.0.0.1:3001 python tests/browser_smoke.py
```

可使用 `CHROMIUM_PATH` 指向已有 Chromium 可执行文件。测试产生 `test-results/acceptance.json`、桌面/手机截图、吃子中间帧与录像。覆盖三种人格、执黑视角、吃子与回吃、悔棋、认输、三人 PVP、离开结算、入座/站起、替补重赛、求和、320px/390px 触控及滚动恢复。

GitHub Actions 在 PR 和主分支提交时自动检查：Node.js 22/24 的规则与房间测试、TypeScript 与生产构建、依赖审计，以及 Linux Chromium 的上述浏览器验收。浏览器截图、录像、服务日志和检查结果作为 `browser-acceptance` 产物保留 14 天。Actions 使用固定提交，浏览器测试依赖也已锁定版本。

## 结构与运行边界

```text
src/                 React UI、棋盘与融合动画、AI Worker
shared/engine.ts     浏览器和服务端共用的纯规则引擎
shared/ai.ts         有时限的迭代加深 alpha-beta 搜索
shared/wxf.ts        WXF 长将、长捉与循环责任裁定
shared/protocol.ts   客户端/服务端消息契约
server/              Express 与 WebSocket 房间服务
tests/               规则、AI、多人协议及浏览器验收
```

房间与棋谱保存在单个服务进程的内存中，服务重启会清空房间；没有账号系统、历史棋谱数据库、跨实例共享或断线续局。刷新页面也会关闭当前连接，按“离开即结束”规则处理。没有配置公开域名或部署到公网。

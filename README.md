# ![弈境 · Liquid Xiangqi](docs/assets/readme-header.png)

弈境是一款在浏览器里玩的中国象棋游戏。可以独自练棋，也可以用房间码约朋友对弈。棋盘像磨砂玻璃，吃子时两枚棋子会短暂融合，随后泛起涟漪。

## 快速开始

需要 Node.js 22.12 或更新版本。在项目目录运行：

```bash
npm ci
npm run dev
```

打开终端里 Vite 给出的 `Local` 地址，通常是 `http://localhost:5173`。同一局域网里的朋友可以打开终端里显示的 `Network` 地址，加入你的房间。

## 怎么玩

- **人机练棋**：选谨慎、平衡或激进，再决定执红还是执黑。三个选项对应不同棋风，搜索时间相同。练习时可以悔棋或重新开局。
- **好友对弈**：创建房间，把六位房间码发给打开同一服务的朋友。两人都准备后开局；座位已满时，后来的人可以旁观。棋手在对局中退出、刷新或断线，当前局判对手获胜。

默认启用比赛棋例，按世界象棋联合会（WXF）棋例处理长将、长捉和循环局面。连续 50 回合（100 步）无吃子判和。设置里可以切换简化练习规则、改用 60 回合限着或关闭限着。联机房间的规则在创建时确定。细节见[规则说明](docs/RULES.md)。

## 部署

```bash
npm run build
npm start
```

打开 `http://localhost:3001`。生产服务同时提供网页和 WebSocket 房间，端口可用 `PORT` 指定。部署联机版需要能运行 Node.js 并支持 WebSocket 的主机。使用反向代理时，将网页和 `/ws` 转发给同一服务，并转发 WebSocket 升级请求；如需放行额外的来源，用逗号分隔后写入 `XIANGQI_ALLOWED_ORIGINS`。

房间和本局棋谱保存在服务进程的内存里，服务重启后会清空。目前没有账号、历史棋谱存档或断线续局。

## 开发与测试

前端使用 React、TypeScript 和 Vite，人机搜索在 Web Worker 中运行。网页和房间服务共用 `shared/` 中的棋规，联机走子由服务端校验。

```bash
npm test
npm run build
```

GitHub Actions 也会用 Chromium 检查人机练棋、联机房间和窄屏操作。运行步骤见 [CI 配置](.github/workflows/ci.yml)，覆盖范围见[验收记录](docs/ACCEPTANCE.md)。

[MIT 许可证](LICENSE) · [图标原图](docs/assets/logo.png)

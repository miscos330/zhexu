# 折序 ZHEXU

**一句话，展开成一堂课。**

折序是开源的 AI 互动课堂。说出想学什么，它先排好提纲，再做出课件，然后由 AI 老师讲解、AI 同学陪你讨论。

[English](/.github/README.md) | 简体中文

[![ZHEXU checks](https://github.com/miscos330/zhexu/actions/workflows/zhexu-ci.yml/badge.svg?branch=zhexu)](https://github.com/miscos330/zhexu/actions/workflows/zhexu-ci.yml)

![折序的课堂：中间是一页课件，下面是老师的讲解，右边是 AI 同学](/extensions/zhexu/site/assets/shots/classroom-light.webp)

## 基于 OpenMAIC

折序是 [OpenMAIC](https://github.com/THU-MAIC/OpenMAIC) 的下游版本。OpenMAIC 由 THU-MAIC 团队以 MIT 许可开源，课堂、课件和导出这些能力都来自上游。本仓库在上面加自己的品牌、主题和扩展。不是折序专用的改进会提交回上游，不留在这里。

上游的 README 原样保留在仓库根目录。[README-zh.md](/README-zh.md) 里有课堂的全部功能和各种配置方式。

## 现状

这是早期版本，还没有发布过。

已经有：

- **课堂能力**：上游 OpenMAIC 的全部功能。
- **品牌和主题**：折序的标识、配色和深色模式。
- **扩展层**：新功能放在 [`extensions/`](/extensions/README.md) 下，只在上游代码里留几个很小的接入点，方便跟着上游升级。
- **A4 讲义**：助手把回答交付成真实文件，包括 A4 PDF 和页面图片，可选手写体。[实现方式](/extensions/README.md#a4-handouts-zhexu)。
- **图片标注**：助手查看你附上的图片，加上带编号的标注，导出 A4 的 PNG 和 PDF；原图不改动。[实现方式](/extensions/README.md#image-annotations-zhexu)。

这两个功能默认关闭，各有一个开关（`ZHEXU_DELIVERABLES_ENABLED`、`ZHEXU_IMAGE_ANNOTATIONS_ENABLED`）。它们有测试覆盖，并在开发机上端到端跑通过，开发模式和生产构建都试过，用的是按脚本应答的模拟模型。还没有用真实模型跑过。

| 手写体讲义 | 图片标注 |
| --- | --- |
| ![一页手写体的 A4 讲义样张](/extensions/zhexu/site/assets/shots/sample-handout.webp) | ![一张带标注的图片样张：图上有编号标记，标注列在图的下方](/extensions/zhexu/site/assets/shots/sample-annotation.webp) |

这两页是渲染器的真实输出，内容是测试用的。

计划中：

- **更多成品交付**：可编辑的 Word 文档，以及一个列出助手交付过的文件的页面。
- **账号和用量**：注册登录，以及每个人的用量上限。
- **会进步的 skill**：根据使用情况自动改进教学 skill。

扩展目前还没覆盖到的地方，列在 [`extensions/README.md`](/extensions/README.md#not-covered-yet)。

## 在本地运行

需要 Node.js 22.19 以上、pnpm 10 和 PostgreSQL 16。

```bash
git clone https://github.com/miscos330/zhexu.git zhexu
cd zhexu
pnpm install
cp .env.example .env.local            # 密钥和服务器选项
cp openmaic.example.yml openmaic.yml  # 服务器用哪些模型
pnpm db:up                            # 用 Docker 起一个开发用的 PostgreSQL；已经有的话跳过
```

在 `.env.local` 里填模型密钥和 `DATABASE_URL`，再加上启用折序的三行：

```env
NEXT_PUBLIC_DEPLOYMENT_EXTENSION=zhexu
NEXT_PUBLIC_WORKBENCH_ENABLED=true
OPENMAIC_AGENT_RUNTIME_ENABLED=true
```

```bash
pnpm dev
```

打开 <http://localhost:3000>。品牌和扩展的入口显示在工作台里，所以需要后两行。不设置 `NEXT_PUBLIC_DEPLOYMENT_EXTENSION` 时，应用就是上游原版的 OpenMAIC。

模型、Docker 和其他选项见上游的[快速开始](/README-zh.md#-快速开始)。Docker 构建目前还不包含扩展。

## 本仓库加了什么

| 路径 | 内容 |
| --- | --- |
| [`extensions/`](/extensions/README.md) | 扩展层：启用哪个扩展，以及扩展怎样改品牌、主题和工作台外壳 |
| [`extensions/zhexu/`](/extensions/zhexu) | 折序扩展：品牌、主题、“关于”页、A4 讲义和图片标注 |
| [`extensions/zhexu/site/`](/extensions/zhexu/site/README.md) | 静态展示页，没有构建步骤。预览：`node extensions/zhexu/site/tools/serve.mjs` |
| [`public/extensions/zhexu/`](/public/extensions/zhexu) | 品牌素材和它们的来源记录 |
| [`tests/extensions/`](/tests/extensions) | 以上内容的测试 |
| [`.github/workflows/zhexu-ci.yml`](/.github/workflows/zhexu-ci.yml) | 这个分支上运行的检查 |

上游文件改了五个，每个只有几行：`app/layout.tsx` 挂载扩展；`lib/server/agent-runtime/runner.ts` 把扩展的工具加进一次运行；`components/workbench/chat/action-cluster.tsx` 在对话里显示扩展的卡片；`next.config.ts` 让一个原生依赖不被打进包里；`.env.example` 说明各个开关。

## 分支

- `zhexu` 是默认分支，放的是这个版本。
- `main` 和上游保持一致。上游的更新通过合并进入 `zhexu`，这个分支不做变基。

## 参与贡献

不是折序专用的改进应该提给上游，这样所有人都能用上，做法见 OpenMAIC 的 [CONTRIBUTING.md](/CONTRIBUTING.md)。对扩展、主题或展示页的修改，欢迎在这里向 `zhexu` 分支提 pull request。

## 许可

MIT，和上游相同，保留 THU-MAIC 的原版权声明。见 [LICENSE](/LICENSE)。

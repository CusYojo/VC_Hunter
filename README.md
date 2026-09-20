# VC Hunter

VC Hunter 是面向硬科技投资团队的项目发现与投研工作台。它把公开线索、项目资料、研究任务、人工复核和团队协作放在一条可追溯的工作流中。代码基于 Next.js、React、TypeScript 和 SQLite；演示模式可在本机独立运行。

> 本仓库只包含应用代码、演示数据、配置模板和脱敏产品说明。真实项目库、认证库、上传文件、账号密码、API Key、组织名册和生产部署记录不属于仓库内容。演示数据不代表真实投资事实。

📄 [查看产品说明 PDF（公开脱敏版）](output/pdf/VC-Hunter-Product-Guide.pdf)——按照产品说明重新编排，包含项目流程、协作场景和重新绘制的像素办公室示意图；不含原始界面截图或真实业务资料。

## 功能概览

| 模块 | 主要用途 |
| --- | --- |
| 今日工作台 | 查看负责项目、待办、消息和最近动态 |
| 项目发现 | 搜索公开线索、管理定时发现计划、审核候选并转为正式项目 |
| 项目管理 | 管理项目阶段、负责人、里程碑、时间线、评论、资料和审核意见 |
| 投研与知识 | 组织研究任务、报告草稿、证据片段、知识卡与人工判断 |
| 机构与人才 | 浏览投资机构、投资事件、人才信号及关联资料 |
| 业务协作 | 管理审批、日程、基金、财务和资源记录 |
| 个人 AI | 配置个人模型，基于有权限的项目资料提问并查看来源 |
| 管理与组织 | 维护成员、角色、信源与运行配置；像素办公室展示团队工位和协作状态 |

更详细的边界与页面说明见[功能介绍](docs/FEATURES.md)，按角色操作步骤见[使用说明](docs/USAGE.md)。

## 服务器部署与多端访问

VC Hunter 可部署在服务器上，供数百名团队成员使用。应用通过浏览器访问，界面已适配 Windows、macOS、Linux 桌面端以及 iOS、Android 移动端；无需安装原生客户端。团队访问须启用账号认证，并通过 HTTPS 提供入口。

“数百人”指团队用户规模，不代表数百人同时进行高负载操作。当前业务库采用单工作空间 SQLite；实际并发能力取决于服务器配置、数据量和使用方式，上线前应在目标环境进行容量压测、备份恢复与安全验收。

## 快速开始

需要 Node.js 22.5 或以上，以及 npm。克隆后运行：

```bash
git clone https://github.com/CusYojo/VC_Hunter.git
cd VC_Hunter
npm ci
npm run db:seed
npm run dev
```

打开 <http://127.0.0.1:3000>。默认本机演示模式不启用登录，`db:seed` 只为本地演示库写入虚构样例。**不要在正式数据库上执行 seed。** 数据默认写入被 Git 忽略的 `.data/vc-hunter.db`。本项目使用 Node 内置 `node:sqlite`；部分 Node 版本会显示实验性 API 提示。

如需空库启动，跳过 `npm run db:seed`。应用首次访问会建立业务库结构，页面将显示空状态。演示模式适合本机开发；部署给团队使用时须启用认证、配置独立的持久化数据目录和 HTTPS 入口。

## 本地账号模式

登录模式需要独立的认证数据库。先在本机私有环境文件或进程环境变量中设置以下项目，不要把实际值提交到 Git：

```dotenv
VC_HUNTER_AUTH_ENABLED=true
VC_HUNTER_CURRENT_TENANT_ID=example-team
BETTER_AUTH_URL=http://127.0.0.1:3000
BETTER_AUTH_SECRET=<至少 32 字符的随机值>
VC_HUNTER_AUTH_DB_PATH=<认证库的绝对路径>
VC_HUNTER_DB_PATH=<业务库的绝对路径>
```

完成配置后运行认证迁移，并用 CLI 创建首个账号：

```bash
node --env-file=.env.local --import tsx scripts/auth-migrate.ts
node --env-file=.env.local --import tsx scripts/auth-invite.ts \
  --username demo-admin --name 示例管理员 --team-user demo-admin \
  --roles org_admin,investment_manager \
  --output /absolute/private/path/initial-account.json
```

初始密码只写入 `--output` 指定的私有文件。正式环境还需要把 `BETTER_AUTH_URL` 设为实际 HTTPS 地址，并为认证库、业务库、上传文件目录和模型密钥准备受限权限的持久化存储。请先阅读[使用说明中的部署前检查](docs/USAGE.md#部署前检查)。

## 可选：公开信源与 AI

- 复制 `config/sources.example.json` 到被 Git 忽略的 `config/sources.local.json`，审批信源域名及使用政策后再启用。通过 `npm run sources:sync -- config/sources.local.json` 注册，使用 `npm run collect:rss -- --source <source-id>` 采集。
- 以 `config/agent.example.json` 和 `config/runtime.example.json` 为模板创建同目录下的 `*.local.json`。后台任务通过 `npm run agent:sync`、`npm run agent:once` 和 `npm run agent:run` 执行；定时任务应作为独立进程运行。
- 模型和搜索服务密钥只放在私有环境变量或个人设置页。`.env.example` 列出可选变量。未配置外部服务时，本机演示和手工工作流仍可使用。

公开搜索结果先进入候选区；正式项目、事实断言和知识条目需人工核验。模型生成的内容保留来源与运行记录，不能自动覆盖原始证据。

## 开发与验证

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

端到端测试使用 Playwright：`npm run test:e2e`。完整检查为 `npm run verify`，会额外执行覆盖率与浏览器测试。

主要代码目录：`src/app`（页面和 API）、`src/components`（界面）、`src/workbench`（业务流程）、`src/auth` 与 `src/security`（身份和权限）、`src/db`（数据库和迁移）、`src/connectors`（外部信源和模型）、`src/workflows`（后台工作流）。

## 数据与安全边界

- `.data/`、`.env.local`、`config/*.local.json`、导入包、上传原件和生产配置均不得提交。
- 真实 RSS/Atom 信源须先审批；连接器限制 HTTPS、允许主机、响应大小和跳转范围。
- 上传支持 PDF、DOCX、TXT 和 Markdown，单文件上限为 20 MB；项目资料和认证数据库需单独备份。
- 当前业务存储主要使用单工作空间 SQLite；生产多租户隔离、公开注册、多因素认证及自动外发内部资料不属于本版本的能力。
- 本仓库不附带生产环境的发布脚本、服务器地址或真实业务导入数据。请根据自己的环境配置部署流程。

如发现误提交的凭据，应立即撤销或轮换；仅删除 Git 文件不足以消除历史中的泄露。

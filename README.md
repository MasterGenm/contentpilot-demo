# ContentPilot

> 自媒体选题研究与素材集成助手（Next.js 新架构）  
> 核心闭环：`研究 -> 初稿 -> 改写 -> 素材 -> 导出/发布 -> 统计`

本项目面向自媒体个人及团队，目标是把“选题素材集成可相应调整发布到多平台版本的研究”做成一条可恢复、可追踪、可演示的主链路。


## 功能总览（当前可用）

- 选题研究：关键词检索、来源聚合、研究结论、推荐标题。
- 初稿生成：基于研究结果生成长文初稿（语气/篇幅可配）。
- 多平台改写：公众号/小红书/微博/B站口播稿。
- 图文素材：从正文抽取提示词并生成配图。
- 发布与导出：导出 `Markdown/HTML/JSON/ZIP`。
- 统计看板：周产出、发布成功率、成稿时长等基础指标。
- 总流程控制：一键运行主链并同步到各页面。
- 项目管理：历史项目查看、任务恢复、项目删除。


## 技术栈

- 框架：`Next.js 16` + `React 19` + `TypeScript`
- 样式：`TailwindCSS`
- 状态管理：`Zustand`
- 图表：`Recharts`
- API 形态：`App Router + Route Handlers`（页面级 BFF）
- 任务执行：统一 task registry + workflow runner
- 检索：`Tavily`（主）+ `Serper`（备）
- 文本模型：OpenAI 兼容接口
- 

## 核心架构

```text
app/
  workflow/ projects/ research/ drafts/ rewrite/ assets/ publish/ analytics/ showcase/
  api/
    research/start
    draft/generate
    rewrite/generate
    assets/generate-image
    export/package
    analytics/summary
    workflow/*
src/
  lib/server/search.ts            # 检索与 fallback
  lib/server/workflow-runner.ts   # 主链编排
  stores/project-store.ts         # 本地状态与流程准入
scripts/
  smoke-workflow.mjs
  smoke-workflow-recovery.mjs
```

## 页面与路由

- `/workflow`：总流程控制（主入口）
- `/research`：选题研究
- `/drafts`：初稿生成
- `/rewrite`：多平台改写
- `/assets`：素材生成
- `/publish`：导出/发布
- `/analytics`：统计
- `/projects`：项目管理
- `/showcase`：价值展示



## 检索逻辑（默认）

1. 前端提交 `projectId + query + timeWindow + tool` 到 `/api/research/start`。
2. 检索词策略：
   - `WEB_SEARCH`：直接使用 query
   - `NEWS_SEARCH`：query + `latest news`
3. 引擎策略：`Tavily -> Serper`。
4. 超时：Tavily `8s`，Serper `6s`。
5. 去重：`normalized_url + title_signature`。
6. 结果通过 SSE 回传（`progress/provider/source/insight`）。

## 快速启动

要求：`Node.js >= 18`

```bash
npm install
npm run dev
```

打开：`http://127.0.0.1:3000`



## 环境变量（最小可用）

创建 `.env`（可参考 `.env.example`）：

```env
# 文本模型（OpenAI 兼容，例：智谱）
OPENAI_API_KEY=
OPENAI_BASE_URL=https://open.bigmodel.cn/api/paas/v4
OPENAI_MODEL=glm-4.7-flash

# 检索（主 + 备）
TAVILY_API_KEY=
SERPER_API_KEY=
SERPER_BASE_URL=https://google.serper.dev



## 操作流程

1. 进入总流程页面
2. 填 `项目ID`，例：`demo-ip-001`
3. 填 `主题关键词`，例：`个人IP, 内容定位, 人设打造, 爆款选题, 商业化路径`
4. 研究来源、时间窗口自选
5. 点击“运行主链并同步到各页面”
6. 运行完成可直接访问最后对应平台生成文案



示例：

```md
## Demo 快速预览

### 1) 总流程控制
![workflow](docs/readme/01-workflow.png)

### 2) 选题研究
![research](docs/readme/02-research.png)
```


首次打开页面 `compiling` 较慢：

- Next.js 首次编译通常 10-60 秒，属正常现象。

## 未来版本更新路线参考

- P0：检索质量与可观测性（缓存、评分、来源验收）
- P1：图文资产标准化（提示词模板库、素材复用）
- P2：口播与分镜（脚本 -> 配音 -> 分镜）
- P3：视频生成（后置，异步任务化）

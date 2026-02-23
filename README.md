# ContentPilot🌟

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

```

## 操作流程

1. 进入总流程页面
2. 填 `项目ID`，例：`demo-ip-001`
3. 填 `主题关键词`，例：`个人IP, 内容定位, 人设打造, 爆款选题, 商业化路径`
4. 研究来源、时间窗口自选
5. 点击“运行主链并同步到各页面”
6. 运行完成可直接访问最后对应平台生成文案



示例：


## Demo 快速预览

### 1) 总流程控制


<img width="1920" height="910" alt="结果" src="https://github.com/user-attachments/assets/193f1d8f-7cb2-4748-b1a7-6de81cc52896" />


### 2) 选题研究


<img width="1920" height="910" alt="改写效果" src="https://github.com/user-attachments/assets/0c1c30e2-479f-475a-bd54-9b67e07a94e6" />

### 3) 流程管理


<img width="1920" height="910" alt="价值展示" src="https://github.com/user-attachments/assets/e39a578e-3637-4631-a6df-c71db0f9cab2" />






## 未来版本更新路线参考

**一、质量层（最高优先）**
目标：先把结果“做对、做稳”。

检索评分与缓存：按相关性、可信度、时效性综合评分，并引入查询缓存。

事实校验器：增加来源一致性检查，降低错误信息进入初稿的概率。

输出验收器：统一校验标题、平台字段、字数范围、禁词与合规规则。



**二、生产层（效率提升）**

目标：提升团队单位时间产能。

选题池与内容日历：支持周计划编排与选题优先级管理。

模板系统：沉淀行业模板、语气模板、平台模板，提升复用率。

批量改写与批量导出：提升团队批处理能力，缩短交付周期。

A/B 标题实验与结果回流：将表现数据回写，反哺选题与改写策略。



**三、多模态层（后置增强）**

目标：在主链稳定后扩展内容形态。

封面提示词模板库：先做图文封面标准化。

口播稿到 AI 配音：支持文本到音频的自动化生成。

分镜脚本生成（Shot List）：形成可执行拍摄清单。

文生视频：后置建设，采用异步任务队列化执行，文生图优先落地实现。

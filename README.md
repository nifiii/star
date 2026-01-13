# 🏸 羽毛球未来之星 - 数据助手 (HuaTiHui Data Insight)

**关注青少年成长，用数据记录每一滴汗水。**

这是一个基于 React + Vite 构建的现代化数据仪表盘，专为家长和教练设计。它能够从获取公开的羽毛球赛事数据，生成积分排名，追踪小选手的历史战绩，并利用 **Google Gemini AI** 提供智能的战术分析和建议。

![Dashboard Preview](https://via.placeholder.com/800x450.png?text=Dashboard+Preview)

## ✨ 核心亮点

### 🚀 极速体验 (Performance)
*   **双重增量引擎**: 采用 **Server-Side Incremental Scraper** 技术。后台脚本智能分离“赛事排名”与“比赛比分”的抓取逻辑，确保数据完整性。
*   **智能冷启动**: 容器启动时会自动检查数据新鲜度。如果数据在 **4小时内** 已更新，将跳过耗时的全量获取，仅刷新 Token，实现秒级重启。
*   **混合架构 (v2.0)**: 引入 **Express API Server**。
    *   **内存加速**: 启动时将 JSON 数据加载至内存，提供毫秒级查询响应。
    *   **流量节省**: 前端不再下载巨大的 JSON 文件，而是按需调用 API (`/api/rankings`, `/api/matches`)，大幅减少流量消耗。

### 🔎 精准筛选 (Smart Filter)
*   **全年龄段覆盖**: 支持 **U7 - U16** 全系列年龄组。
*   **学段细分**: 
    *   新增 **“高中”** 组别，适应大龄青少年赛事。
    *   将 **“儿童”** 与 **“小学”** 独立拆分，提供更细致的低龄组筛选。
    *   将 **“少年”** 与 **“初中”** 独立拆分，搜索更精确。
    *   保留 **甲/乙/丙** 传统组别筛选。
*   **智能匹配**: 后台自动采集并聚合 `itemType`（项目类型）与 `groupName`（组别名），解决部分赛事数据字段缺失导致的筛选遗漏问题。

### 🛡️ 网络优化 (AI Proxy)
*   **Nginx 反向代理**: 内置 `/google-ai/` 转发规则，将前端的 AI 请求通过服务器中转至 Google。
*   **无障碍访问**: 即使客户端无法直接连接 Google API (如国内网络环境)，也能正常使用 AI 战术分析功能。
*   **用户行为审计**: Nginx 自动记录 API 调用日志，方便管理员分析热门搜索关键词。

### 🧠 功能特性
*   **🏆 积分排行榜**: 聚合计算指定城市、年龄段的所有近期赛事积分。
*   **👤 选手生涯档案**: 全网搜索选手的参赛历史，生成胜率分析。支持从本地比分库快速回溯。
*   **🤖 AI 教练**: 
    *   **战术报告**: 针对个人历史战绩，评估稳定性并给出训练建议。
*   **📊 数据导出**: 支持 Excel 格式导出。

## 💾 数据存储与查询机制 (Data Architecture)

本项目采用 **"静态爬虫 + 内存 API"** 的混合架构，实现了高性能与数据完整性的平衡。

### 1. 数据持久化 (Storage)
核心数据存储为两个独立的 JSON 文件，由后台脚本自动维护并生成到静态资源目录：

*   **`daily_rankings.json` (榜单库)**:
    *   **内容**: 包含每一场赛事的详细排名信息（第1名到第N名）。
*   **`daily_matches.json` (比分库)**:
    *   **内容**: 包含每一场单项对决的比分详情。

### 2. 增量更新逻辑 (Incremental Updates)
后台脚本 (`scripts/getToken.js`) 运行在 Docker 容器中，执行逻辑如下：

1.  **调度**: 每天凌晨 5:00 (北京时间) 自动唤醒。
2.  **双重比对**: 仅抓取本地缺失的赛事 ID。
3.  **内存刷新**: 数据写入磁盘后，Express Server 自动重载内存数据，确保 API 返回最新结果。

### 3. API 查询 (v2.0)
前端 (`huaTiHuiService.ts`) 通过 HTTP 接口查询数据：

1.  **查榜单 (`GET /api/rankings`)**: 
    *   参数: `uKeywords`, `levelKeywords`, `gameKeywords` 等。
    *   逻辑: 服务端在内存中遍历过滤，仅返回匹配的几百条数据，而非下载几十MB的文件。
2.  **查选手 (`GET /api/matches`)**: 
    *   参数: `playerName`。
    *   逻辑: 服务端秒级检索该选手所有历史战绩。

---

## 🛠️ 技术架构

*   **前端**: React 19, Vite, Tailwind CSS
*   **后端**: Node.js (Express + Fetch), `node-cron` 调度逻辑
*   **反向代理**: Nginx (API Proxy + AI Proxy + Access Logging)
*   **部署**: Docker (Nginx + Node.js 混合镜像)

---

## 🚀 部署指南 (Production Deployment)

本项目的 Docker 镜像采用 **All-in-One** 设计：同一个容器内运行 Nginx（提供高性能 Web 服务）和 Node.js 后台进程（负责 Token 保活和数据更新）。

### 1. 准备环境
*   Linux 服务器 (Ubuntu/Debian/CentOS) - **需可访问 Google API**
*   Docker 环境
*   华体汇账号/密码 (用于后台脚本获取数据)
*   Google Gemini API Key (用于 AI 分析)

### 2. 获取代码
```bash
git clone <your-repo-url>
cd huatihui-data-insight
```

### 3. 构建镜像
构建时需要注入参数，特别是 **域名** 配置。

```bash
docker build \
  --build-arg API_KEY="your_gemini_api_key_here" \
  --build-arg DOMAIN_NAME="sports.ymq.me" \
  --build-arg LOG_LEVEL="production" \
  -t hth-dashboard \
  -f Dockerfile.txt .
```

### 4. 运行容器
启动时注入华体汇凭证，并**挂载数据卷**以保证重启后数据不丢失。

```bash
# 1. 创建本地数据目录（可选，用于方便查看数据）
mkdir -p /usr/local/hth-data

# 2. 启动服务容器
docker run -d \
  --name my-hth-dashboard \
  --restart always \
  -p 80:80 \
  -v /usr/local/hth-data:/app/data \
  -e HTH_USER="13800138000" \
  -e HTH_PASS="YourPassword123" \
  -e TZ="Asia/Shanghai" \
  hth-dashboard
```

### 5. 验证与维护

**🔍 查看 API 调用日志 (New):**
您可以实时监视用户在搜什么：
```bash
docker logs -f my-hth-dashboard | grep "Query:"
```
日志示例: `[25/Feb/2025:10:00:00 +0800] 192.168.1.1 "GET /api/matches" 200 - Query: "playerName=超级丹&gameKeywords=公开赛" - UA: "Mozilla/..."`

**查看后台爬虫日志:**
```bash
docker logs -f my-hth-dashboard
```

**手动触发更新（可选）:**
```bash
docker exec -it my-hth-dashboard npm run get-token
```

---

## 💻 本地开发

1.  **安装依赖**: `npm install`
2.  **获取 Token**: 运行 `npm run get-token` (这会启动 API Server 和后台脚本)。
3.  **启动前端**: `npm run dev` (默认 `LOG_LEVEL` 为 `development`)。

## 📄 License
MIT
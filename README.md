# 🏸 羽毛球未来之星 - 数据助手 (HuaTiHui Data Insight)

**关注青少年成长，用数据记录每一滴汗水。**

这是一个基于 React + Vite 构建的现代化数据仪表盘，专为家长和教练设计。它能够从华体汇平台获取公开的羽毛球赛事数据，生成积分排名，追踪小选手的历史战绩，并利用 **Google Gemini AI** 提供智能的战术分析和建议。

![Dashboard Preview](https://via.placeholder.com/800x450.png?text=Dashboard+Preview)

## ✨ 核心亮点

### 🚀 极速体验 (Performance)
*   **双重增量引擎**: 采用 **Server-Side Incremental Scraper** 技术。后台脚本智能分离“赛事排名”与“比赛比分”的抓取逻辑，确保数据完整性。
*   **静态化持久存储**: 自动生成 `daily_rankings.json` (榜单) 和 `daily_matches.json` (比分库)。前端优先读取这些静态资源，配合 Nginx 缓存，实现秒级加载，大幅降低 API 依赖。

### 🧠 功能特性
*   **🏆 积分排行榜**: 聚合计算指定城市、年龄段（如 U8、U9）的所有近期赛事积分。
*   **👤 选手生涯档案**: 全网搜索选手的参赛历史，生成胜率曲线和对手分析。支持从本地比分库快速回溯。
*   **🤖 AI 教练**: 
    *   **赛区观察**: 分析赛区竞争格局，发现潜力新星。
    *   **战术报告**: 针对个人历史战绩，评估稳定性并给出训练建议。
*   **📊 数据导出**: 支持 Excel 格式导出。

## 🛠️ 技术架构

*   **前端**: React 19, Vite, Tailwind CSS
*   **后端**: Node.js (无需 Puppeteer，纯 API 调用), `node-cron` 调度逻辑
*   **数据流**: 
    1.  每日凌晨 5 点（或容器启动时）自动运行增量检查。
    2.  比对本地 JSON 数据库，精准抓取缺失的排名或比分数据。
    3.  数据持久化为静态 JSON 文件。
    4.  Nginx 提供静态文件服务及 Gzip 压缩。
*   **AI**: Google Gemini API (`@google/genai`)
*   **部署**: Docker (Nginx + Node.js 混合镜像)

---

## 🚀 部署指南 (Production Deployment)

本项目的 Docker 镜像采用 **All-in-One** 设计：同一个容器内运行 Nginx（提供高性能 Web 服务）和 Node.js 后台进程（负责 Token 保活和数据更新）。

### 1. 准备环境
*   Linux 服务器 (Ubuntu/Debian/CentOS)
*   Docker 环境
*   华体汇账号/密码 (用于后台脚本获取数据)
*   Google Gemini API Key (用于 AI 分析)

### 2. 获取代码
```bash
git clone <your-repo-url>
cd huatihui-data-insight
```

### 3. 构建镜像
构建时需注入 API Key（Vite 构建时需要）：

```bash
docker build \
  --build-arg API_KEY="your_gemini_api_key_here" \
  -t hth-dashboard \
  -f Dockerfile.txt .
```

### 4. 运行容器
启动时注入华体汇凭证。后台脚本会自动登录并开始执行每日凌晨的增量更新任务。

```bash
docker run -d \
  --name my-hth-dashboard \
  --restart always \
  -p 80:80 \
  -e HTH_USER="13800138000" \
  -e HTH_PASS="YourPassword123" \
  -e TZ="Asia/Shanghai" \
  hth-dashboard
```

*   `-e TZ="Asia/Shanghai"`: 设置时区，确保定时任务在正确的北京时间凌晨 5 点运行。

### 5. 验证与维护

**查看后台爬虫日志：**
```bash
docker logs -f my-hth-dashboard
```
你应该能看到 `🚀 开始执行每日数据更新...` 或 `⏰ 定时器已设定` 等日志。

**手动触发更新（可选）：**
如果不想等自动调度，可以进入容器手动运行：
```bash
docker exec -it my-hth-dashboard npm run get-token
```

---

## 💻 本地开发

1.  **安装依赖**: `npm install`
2.  **获取 Token**: 运行 `npm run get-token` (这会启动后台脚本，执行增量更新并生成 JSON 文件)。
3.  **启动前端**: `npm run dev`

## 📄 License
MIT
# 🏸 羽毛球未来之星 - 数据助手 (HuaTiHui Data Insight)

**关注青少年成长，用数据记录每一滴汗水。**

这是一个基于 React + Vite 构建的现代化数据仪表盘，专为家长和教练设计。它能够从华体汇平台获取公开的羽毛球赛事数据，生成积分排名，追踪小选手的历史战绩，并利用 **Google Gemini AI** 提供智能的战术分析和建议。

![Dashboard Preview](https://via.placeholder.com/800x450.png?text=Dashboard+Preview)

## ✨ 核心功能

*   **🏆 积分排行榜**：一键扫描指定城市、年龄段（如 U8、U9）的所有近期赛事，聚合计算选手的总积分排名。
*   **👤 选手生涯档案**：输入名字，全网搜索该选手的参赛历史，胜负记录一目了然。
*   **🧠 AI 战术分析室**：
    *   **赛区观察**：AI 自动分析赛区竞争格局，发现潜力新星。
    *   **个人报告**：AI 教练针对选手历史数据，评估胜率、稳定性，并给出改进建议。
*   **📊 数据导出**：支持将排行榜和个人战绩导出为 Excel 表格。
*   **🤖 高效凭证管理**：内置轻量级 Node.js 脚本，直接模拟 API 请求（替代了旧版笨重的浏览器模拟），毫秒级获取 Token。

## 🛠️ 技术栈

*   **前端框架**: React 19, Vite
*   **UI 样式**: Tailwind CSS (自定义主题)
*   **AI 引擎**: Google Gemini API (`@google/genai`)
*   **后端脚本**: Node.js (Native Fetch)
*   **部署**: Docker (Nginx + Node.js 混合镜像)

---

## 🚀 宿主机部署指南 (Production Deployment)

本项目的 Docker 镜像采用 **All-in-One** 设计，同一个容器内运行 Nginx（提供网页服务）和 Node.js 脚本（提供 Token 更新）。

由于移除了 Puppeteer，镜像体积非常小，且构建速度极快。

### 1. 准备环境 (Prerequisites)

*   一台 Linux 服务器 (Ubuntu/CentOS/Debian)
*   已安装 [Docker](https://docs.docker.com/engine/install/)
*   你的 Google Gemini API Key
*   你的华体汇账号和密码

### 2. 获取代码

将项目代码上传至服务器，或使用 Git 克隆：

```bash
git clone <your-repo-url>
cd huatihui-data-insight
```

### 3. 构建镜像 (Build)

构建过程中需要注入 Gemini API Key（因为 Vite 是在构建时将环境变量打包进前端静态代码的）。

```bash
# 注意：请将 your_gemini_api_key_here 替换为实际的 Key
docker build \
  --build-arg API_KEY="your_gemini_api_key_here" \
  -t hth-dashboard \
  -f Dockerfile.gemini.txt .
```

### 4. 运行容器 (Run)

启动容器时，需要通过环境变量传入华体汇的账号密码，以便后台脚本自动登录。

```bash
docker run -d \
  --name my-hth-dashboard \
  --restart always \
  -p 80:80 \
  -e HTH_USER="13800138000" \
  -e HTH_PASS="YourPassword123" \
  hth-dashboard
```

*   `-d`: 后台运行
*   `--restart always`: 开机自启或崩溃重启
*   `-p 80:80`: 将服务器的 80 端口映射到容器的 80 端口
*   `-e HTH_USER/...`: 注入账号凭证

### 5. 验证与维护

**查看运行日志：**

如果你发现页面一直提示 "Token 未就绪"，请查看后台脚本的日志：

```bash
docker logs -f my-hth-dashboard
```

你应该能看到类似 `🚀 开始直接调用登录接口...` 和 `✅ 登录成功!` 的日志。

**更新部署：**

如果代码有更新，请执行：

```bash
git pull
# 重新构建
docker build --build-arg API_KEY="xxx" -t hth-dashboard -f Dockerfile.gemini.txt .
# 停止旧容器
docker stop my-hth-dashboard && docker rm my-hth-dashboard
# 启动新容器
docker run -d --name my-hth-dashboard --restart always -p 80:80 -e HTH_USER="xxx" -e HTH_PASS="xxx" hth-dashboard
```

---

## 💻 本地开发

### 1. 安装依赖

```bash
npm install
```

### 2. 获取华体汇 Token (Token 生成器)

虽然我们改用了 API 接口方式（不再启动浏览器），但仍需运行此命令。
该脚本会模拟 Curl 请求获取 Token 并保存到本地文件，供前端页面读取。

```bash
# 这将运行 scripts/getToken.js (轻量级 API 客户端)
npm run get-token
```

### 3. 启动网页 (前台)

在根目录创建 `.env` 文件填入你的 Gemini Key：`API_KEY=xxx`，然后开启另一个终端：

```bash
npm run dev
```

## ⚠️ 免责声明

本项目仅供学习和个人数据分析使用。所有数据来源于公开网络接口，请勿用于商业用途或对目标服务器造成压力。使用者需自行承担使用过程中产生的风险。

## 📄 License
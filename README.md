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
*   **🤖 自动凭证管理**：内置自动化脚本，后台持续更新华体汇 Token，前端无感连接。

## 🛠️ 技术栈

*   **前端框架**: React 19, Vite
*   **UI 样式**: Tailwind CSS (自定义主题)
*   **AI 引擎**: Google Gemini API (`@google/genai`)
*   **自动化**: Puppeteer (用于后台获取 Token)
*   **部署**: Docker (Nginx + Node.js 混合镜像)

---

## 🚀 部署指南 (Docker)

本项目的 Docker 镜像采用 **All-in-One** 设计，同一个容器内运行 Nginx（提供网页服务）和 Node.js 脚本（提供 Token 更新）。

### 1. 准备环境

确保服务器已安装 Docker。

### 2. 构建镜像

你需要提供 Gemini API Key 作为构建参数（因为 Vite 是在构建时注入环境变量的）。

```bash
docker build \
  --build-arg API_KEY="你的_GOOGLE_GEMINI_KEY" \
  -t hth-dashboard \
  -f Dockerfile.gemini.txt .
```

### 3. 运行容器

华体汇的账号密码通过环境变量传入，以便脚本自动登录。

```bash
docker run -d \
  -p 8080:80 \
  -e HTH_USER="你的华体汇账号" \
  -e HTH_PASS="你的华体汇密码" \
  --name my-dashboard \
  hth-dashboard
```

访问 `http://localhost:8080` 即可使用。

> **注意**: 容器启动后，后台脚本需要约 10-20 秒完成首次登录并生成 `auth_config.json`。如果刚打开页面提示 "Token 未就绪"，请稍等片刻并点击页面上的 "刷新凭证"。

---

## 💻 本地开发

### 1. 安装依赖

```bash
npm install
```

### 2. 获取华体汇 Token (后台)

开启一个终端窗口运行脚本：

```bash
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

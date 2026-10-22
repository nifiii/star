# 响应式页面验收与发布

## 1. 背景

对应 `responsive-redesign.md` 的 UI-01~03；测试时间为 2026-10-22，浏览器截图使用虚构运动员和赛事数据。

## 2. 目标

证明两种查询在 PC 和手机可读、主路径可用，且不改变采集流程与生产数据。

## 3. 方案

| 验证项 | 结果 / 证据 |
|---|---|
| TypeScript + Vite 构建 | `npm run build` 通过；首屏 JS 252.67 kB，Excel 模块按需加载，CSS 24.89 kB |
| 比分规则 | `npm test` 4 组通过：单局/选手 B/双打、多局、0:0/弃权/缺失、姓名歧义 |
| 适配 | 320/360/390/768/1024/1440px 的页面宽度等于视口，无横向溢出；成绩工具栏按钮无裁切 |
| 空姓名 | 显示输入错误，焦点回姓名，未查询 |
| 查询/统计 | 25 条虚构记录按 20+5 分页；10 胜、5 负、10 待确认，胜率 67% |
| 长字段 | 手机完整显示多局原始比分、双打组合与长赛事名 |
| 成绩页 | 多选组别可见，实际名次决定徽标；组合姓名可跳至战绩 |
| HTTP 错误 | 500 和 403 显示错误及重试按钮，不误报为空结果 |
| 空结果 | 合法空数组显示放宽筛选建议 |
| Excel | 浏览器触发下载并解析文件：比分导出 25 条；按需加载后成绩导出 23 条，均非仅当前页 |
| 线上只读联调 | 新前端经测试代理访问现有两接口，已知姓名返回 18 条比赛、7 条成绩；未读取前端 token、未触发采集 |
| 发布后域名验收 | `https://wiki.haokuai.uk` 标题为 `STAR · 羽毛球未来之星`；真实姓名查询 36 条比赛，成绩查询成功；1280px / 390px 无横向溢出，页面运行异常为 0 |
| 生产数据保护 | 发布前后两个数据文件 SHA-256 完全一致；比分 128,409 条、排名 43,228 条，采集脚本 SHA-256 不变 |

截图（本地生成，不随镜像发布）：

- `output/playwright/desktop-initial.png`：PC 查询首屏。
- `output/playwright/desktop-rankings.png`：PC 成绩结果。
- `output/playwright/mobile-match-cards.png`：手机比分、多局与待确认卡片。
- `output/playwright/mobile-rankings.png`：手机成绩页。

使用说明：顶部选择「比赛战绩」或「赛事成绩」；填写条件后按 Enter 或点击查询；成绩页可展开组别与项目；导出包含全部查询结果；页脚可清除两层查询缓存。

上线：构建独立镜像；临时容器使用无外网、只读数据卷验证启动与查询；备份容器配置和数据后切换；线上验证首页资源、两个查询接口及数据哈希。回滚时使用备份环境与旧镜像重新启动，数据卷不变。

2026-10-22 已在远程 star 完成发布：

- 镜像：`hth-dashboard:v1.1.10-responsive`；镜像 ID `sha256:1e6e164e4b49e5f16fa3e12107c427063338516f0b276fcd741fdc60278dbb2a`。
- 主入口资源：`/assets/index-Bch0inIR.js`，已校验不含 Gemini 和 LogViewer。
- 数据和容器配置备份：`/usr/local/hth-data/backups/20261022-151131-responsive-ui/`；环境配置仅 root 可读。
- 旧容器：`hth-dashboard-previous-20261022-151131`，已停止并关闭自动重启，保留供回滚。
- 原数据卷 `/usr/local/hth-data:/app/data`、8080 端口及 `restart=always` 保持一致。
- 隔离验证使用正确域名 Host；直接以 IP 请求可能命中镜像内 Debian 默认 Nginx 站点，不代表域名接口失效。

需要回滚时，在 star 上依次执行以下命令。使用场景为新 UI 出现发布回归；依赖旧容器仍保留。操作会短暂中断访问，不删除数据卷。

```bash
docker stop hth-dashboard
docker update --restart=no hth-dashboard
docker rename hth-dashboard hth-dashboard-responsive-rollback-20261022
docker rename hth-dashboard-previous-20261022-151131 hth-dashboard
docker update --restart=always hth-dashboard
docker start hth-dashboard
```

回滚后重新验证域名、两类查询和数据文件。旧采集服务器出口故障不会因 UI 发布或回滚而恢复。

## 4. 风险

- 此次不修复上游网络、服务端时间过滤、项目关键词语义和采集分页等既有问题。
- 上游错误/部分采集状态不在现有查询响应中，不能从页面查询成功推断采集恢复。
- 旧浏览器查询缓存仍有有效期，新页面使用 `ui_v3` 键隔离；查询需绕开缓存时使用页脚清除按钮。
- 构建不再使用损坏且含 NUL 的旧 `.dockerignore`，排除临时目录、日志、数据与环境文件。

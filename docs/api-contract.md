# API 契约（草案）

## 1. 背景

当前前端调用 `GET /api/matches`，但错误和空结果语义不完整。

## 2. 目标

让前端稳定区分成功、空结果、部分成功、授权失败和服务故障，同时保持旧字段兼容。

## 3. 方案

### 请求

2026-10-22 前端改造兼容性说明：线上响应仍为 `{ source, count, updatedAt, data }`，下文 `status/resultStatus` 是建议字段，本次不强制它们存在。GET 查询不发送上游凭证，不发起采集。`/api/rankings` 沿用 `uKeywords/levelKeywords/itemKeywords/gameKeywords/targetPlayerName/playerGender/province/city`；`/api/matches` 沿用下列参数。HTTP 非 2xx、非法 `data` 和网络异常显示为错误；合法空数组才显示空结果。客户端解析不修改 API 返回的原始比分。

`GET /api/matches?playerName=示例运动员&playerGender=M&gameKeywords=公开赛&province=广东省&city=广州市`

约束：`playerName` 必填，去除首尾空格后做包含匹配；双打/团体赛按任一成员文本命中；服务端只返回广东省最近一年数据；其他参数可选；不得接受密码、token 等凭证参数。

### 成功响应（草案）

```json
{
  "status": "success",
  "source": "API_MEMORY",
  "count": 1,
  "updatedAt": "2026-10-21T10:00:00+08:00",
  "data": [{
    "raceId": "race-1",
    "matchId": "match-1",
    "game_name": "2026 广州青少年公开赛",
    "groupName": "U12 男单",
    "playerA": "示例运动员",
    "playerB": "对手甲",
    "score": "21:15,18:21,21:19",
    "resultStatus": "win",
    "matchTime": "2026-10-20",
    "round": "决赛"
  }]
}
```

### 空结果

HTTP 200，`status: "success"`、`count: 0`、`data: []`，由前端展示空数据。

### 错误

```json
{
  "status": "error",
  "code": "UPSTREAM_AUTH_FAILED",
  "message": "数据源凭证无效",
  "retryable": false
}
```

错误码候选：`INVALID_PLAYER_NAME`、`UPSTREAM_AUTH_FAILED`、`UPSTREAM_TIMEOUT`、`DATA_PARTIAL`、`INTERNAL_ERROR`。用户查询不触发上游刷新，采集失败由定时任务和更新时间暴露。

## 4. 风险

- `status` 字段属于兼容性变更，前端必须同时兼容现有 `data` 响应，服务端部署后再切换强校验。
- 错误消息不得包含 token、账号、上游 URL、原始请求体或密码。

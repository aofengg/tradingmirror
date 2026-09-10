# 交易留痕数据架构 v2

## 设计目标

数据模型围绕“当时为什么行动，以及事后感受如何变化”，不依赖不可控的后续股价来判定对错。系统字段自动生成，不增加用户输入步骤。

## 核心关系

```text
user_config 1 ── n trade_events 1 ── n reflection_snapshots
       │                 │
       ├── n weekly_focus└── n rule_refs ── personal_rules
       └── n period_metrics（周 / 月）
```

## 兼容策略

- 文档使用 `schema_version`，用户使用 `data_schema_version`；
- 新代码先兼容 v1 读取，再静默迁移，最后写入 v2；
- 枚举同时保存稳定 key 和当时 label；
- `option_set_version` 标记当时使用的选项体系；
- `ext` 只用于实验性字段，稳定字段必须提升为正式顶层字段并写入迁移规则。

## 一致性与幂等

- 事件和复盘由 `client_request_id + _openid` 生成确定性 ID；
- 网络超时后使用同一请求 ID 重试，不产生重复文档；
- 事件保存已处理的复盘请求 ID，事务重试不会重复增加计数；
- 周提醒按 `_openid + week_id` 生成确定性 ID；
- 周/月统计由云函数完整分页计算，并写入 `period_metrics` 作为可追溯快照。

## 时间语义

- `occurred_at`：用户实际执行操作的时间；
- `recorded_at`：系统收到操作记录的云端时间；
- `reviewed_at`：系统收到复盘的云端时间；
- `horizon_key`：系统根据操作与复盘间隔自动生成；
- `event_age_hours`：生成快照时距操作经过的小时数；
- `timezone`：解释用户自然日与周区间。

`horizon_key` 当前取值：`immediate`、`next_day`、`one_week`、`later`；迁移记录使用 `legacy`。

## 标的身份

使用 `symbol + market + asset_type` 表达标的，避免跨市场代码冲突。v2 根据代码自动推断市场，将来增加市场选择时无需改变历史结构。

## 可选补充与截图

操作事件和每次回看快照都可以独立保存：

```js
{
  optional_note: "最多300字",
  attachments: [{
    file_id: "cloud://...",
    cloud_path: "trade-attachments/2026-09/...",
    size_bytes: 382140,
    media_type: "image",
    uploaded_at: Date
  }],
  supplement_updated_at: Date
}
```

- 补充入口不进入主流程，用户主动展开后才填写；
- 每条记录最多3张图片，上传前在本地压缩，压缩后单张不超过5MB；
- 数据库只保存文件元信息，原图存放在云存储；
- 用户移除图片或删除交易时，云函数同步清理对应云文件；
- 图片上传成功但元数据保存失败时，客户端会回收本次已上传文件。

## 后续演进守则

1. 新增字段优先，禁止原地改变既有字段类型；
2. 新枚举 key 永不复用，展示文案可以更新；
3. 统计口径调整时增加 `metric_version`；
4. 大批量迁移必须可重复执行；
5. 删除和导出均以 `_openid` 为边界；
6. `period_metrics` 是派生数据，可以重建，原始事件和复盘不可由统计反推覆盖。
7. 附件字段只保存云文件引用，禁止将 Base64 图片写入数据库文档。

## 周月复盘与趋势

- 周复盘使用自然周，展示最近8周计划执行率，承担短期纠偏；
- 月复盘使用自然月，展示最近6个月计划执行率，帮助用户判断行为是否持续改善；
- 趋势只统计交易行为，不接入收益或事后股价，避免用结果改写当时决策；
- 没有交易的周期以断点处理，不以0分惩罚用户；
- 指标快照包含 `period_type`、`period_id`、当前摘要和趋势序列，可随原始数据重新生成。

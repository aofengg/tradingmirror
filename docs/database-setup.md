# 微信云开发数据库配置（Schema v2）

## 集合

- `trade_events`：操作事件主表；
- `reflection_snapshots`：不覆盖历史的多时间窗复盘快照；
- `personal_rules`：带版本的个人行为规则；
- `weekly_focus`：每位用户每周唯一提醒；
- `period_metrics`：云端生成的周/月统计与趋势快照；
- `user_config`：唯一用户配置、最近标的和迁移状态。

所有业务文档均包含 `_openid`。客户端只负责读取，写入统一经过 `tradeData` 云函数。

## 安全规则

建议使用自定义安全规则：当前用户仅可读取自己的数据，客户端禁止直接写入；云函数使用服务端权限完成写入。

```json
{
  "read": "doc._openid == auth.openid",
  "write": false
}
```

若控制台暂不支持集合级自定义规则，过渡期可使用“仅创建者可读写”，但正式发布前应切换为上面的只读规则。

## 索引

### trade_events

- `_openid` 升序 + `is_deleted` 升序 + `created_at` 降序；
- `_openid` 升序 + `is_deleted` 升序 + `reflection_count` 升序 + `created_at` 降序；
- `_openid` 升序 + `is_deleted` 升序 + `execution_status` 升序 + `created_at` 降序；
- `_openid` 升序 + `is_deleted` 升序 + `execution_status` 升序 + `review_due_at` 升序 + `created_at` 降序；
- `_openid` 升序 + `is_deleted` 升序 + `execution_status` 升序 + `executed_at` 升序。

### reflection_snapshots

- `_openid` 升序 + `is_deleted` 升序 + `trade_event_id` 升序 + `created_at` 降序；
- `_openid` 升序 + `is_deleted` 升序 + `reviewed_at` 升序。

### personal_rules

- `_openid` 升序 + `is_deleted` 升序 + `active` 升序 + `created_at` 降序。

### weekly_focus

- `_openid` 升序 + `is_deleted` 升序 + `week_id` 降序。

### period_metrics

- `_openid` 升序 + `is_deleted` 升序 + `period_type` 升序 + `period_id` 降序。

### user_config

- `_openid` 升序。

用户配置只通过云函数读取和写入；唯一性由云函数根据 `_openid` 生成确定性文档 ID 保证，不依赖客户端“先查后增”。

## 写入约束

- `schema_version` 当前固定为 `2`；
- `client_request_id` 由客户端生成，云函数据此构造确定性文档 ID；
- `created_at`、`updated_at`、`recorded_at`、`reviewed_at` 使用云端时间；
- 新增复盘与更新事件摘要在同一事务中提交；
- 同一周提醒使用确定性 ID 覆盖写入，保证每周只有一条；
- 删除采用 `is_deleted + deleted_at`，交易记录先隐藏，再级联隐藏复盘。
- `optional_note` 最多300字，`attachments` 最多3项；图片本体进入云存储而不是数据库。

## 迁移

`user_config.data_schema_version` 记录当前用户的数据版本。旧用户首次打开 v2 时，小程序会调用 `migrateUserData`：

1. 为旧交易补齐市场、资产类型、操作时间、选项版本和规则引用；
2. 为旧复盘补齐复盘时间、顺序与 `legacy` 时间窗；
3. 为每周提醒和个人规则补齐版本字段；
4. 最后将用户配置升级到 v2。

迁移只增加字段，不删除、不改写原始选择和文案快照；读取层对未迁移记录仍提供 v1 默认值。

## 部署顺序

1. 创建以上 6 个集合；
2. 创建复合索引；
3. 部署 `login`；
4. 部署 `tradeData`，选择“云端安装依赖”；
5. 上传小程序代码；
6. 用测试用户完成“新建记录 → 确认执行 → 复盘 → 周报 → 删除”验收。

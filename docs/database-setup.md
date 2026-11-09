# 微信云开发数据库配置（Schema v2）

## 1.8.0 批量录入增量（2026-11-05）

新增 `entry_requests` 技术集合，业务事件仍在 `trade_events`，无需旧数据迁移。每条事件与回执在同一事务写入；原请求ID可安全重试。撤销物理移除未被后续回看／补充的事件，留下取消墓碑防止迟到重试复活。原单条创建和删除契约保留。

回执 `_openid` 固定为服务身份 `__batch_entry_service__`，不使用真实用户OpenID。仅含不透明事件ID、带账号及随机请求数的摘要、saved／undone状态及receipt_version=2；不保存股票、理由、备注或时间。业务归属由云函数登录身份与请求ID共同计算的确定ID校验。客户端无需读写回执，推荐控制台规则为read=false、write=false。当前未宣称修改了控制台ACL；实际核验服务所有权、客户端精确读取不可访问、更新stats.updated=0及服务端文档未改变，不能以“调用resolve”误判写入成功。

仅按主键读写，无需组合索引。先创建集合，再部署tradeData及日期精度兼容的reviewAI，完成真实创建／重试／撤销／权限验证后上传客户端。部署终态见 [1.8.0验收记录](batch-entry-1.8.0-acceptance.md)。

## 市场大事记增量（2026-11-06）

独立集合 `market_chronicle`，schema_version=1，仅通过tradeData的list/save/delete/undoMarketChronicle接口读写。文档使用固定服务身份_openid，真实微信登录身份在服务端映射为owner_key；客户端不能作为创建者读取或直接修改。每账号/市场/日期确定ID，事务revision冲突保护，未知与0分开，保留各指数独立数值。年度_openid服务身份+owner_key+market+year+date升序索引 `service_owner_market_year_date`。不迁移、重写原交易和回看。具体契约及实际验证见 [市场大事记](market-chronicle.md)。

## 集合

- `trade_events`：操作事件主表；
- `reflection_snapshots`：不覆盖历史的多时间窗复盘快照；
- `personal_rules`：带版本的个人行为规则；
- `weekly_focus`：每位用户每周唯一提醒；
- `period_metrics`：云端生成的周/月统计与趋势快照；
- `user_config`：唯一用户配置、最近标的和迁移状态。

所有业务文档均包含 `_openid`。客户端只负责读取，原始记录写入经过 `tradeData`；AI缓存、反馈及当前提醒版本写入经过 `reviewAI`。

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

### 稳定分页与分类筛选（2026-10-18）

通用列表现在显式按 `created_at` 与 `_id` 同方向排序，用两者共同作为游标。记录分类在云端增加 `plan_status` 等值条件。数据量较大时，可根据实际查询告警补充非唯一索引：

- 全部记录：`_openid` 升序、`is_deleted` 升序、`created_at` 降序、`_id` 降序；
- 分类记录：`_openid` 升序、`is_deleted` 升序、`plan_status` 升序、`created_at` 降序、`_id` 降序；
- 单条回看：`_openid` 升序、`is_deleted` 升序、`trade_event_id` 升序、`created_at` 降序、`_id` 降序。

本轮模拟器已验证记录筛选和跨页查询成功；未创建或删除云端索引。其他排序字段也使用同方向 `_id` 解决相同时间的稳定顺序。

### 相关历史与首页待回看（2026-09-18）

在 `trade_events` 新建以下两个**非唯一**组合索引，字段顺序不能打乱：

| 索引名 | 字段与方向（从左到右） |
| --- | --- |
| `related_history_v1` | `_openid` 升序、`is_deleted` 升序、`action` 升序、`reason_key` 升序、`execution_status` 升序、`executed_at` 降序 |
| `due_reflection_v1` | `_openid` 升序、`is_deleted` 升序、`execution_status` 升序、`reflection_count` 升序、`review_due_at` 升序 |

在微信开发者工具 → 云开发 → 数据库 → `trade_events` → 索引管理创建，等待状态为可用。本文档只描述部署配置，不代表云端索引已经创建。

- 相关历史：等值字段在前，最后是执行时间范围与降序排序。正常记录已由执行状态或严格时间上界排除自身，不再添加多余的 `_id !=`；缺失执行时间或时间异常的旧记录仍保留排除自身的防护，可能继续触发 `neq` 提示。
- 待回看：列表统一按 `review_due_at` 升序，最早到期的先显示；计数使用同一筛选条件，共用该索引。不要照旧日志创建按 `created_at` 排序的索引。
- 不要使用旧告警里包含两次 `executed_at` 的快速创建链接。先更新代码，再查看新的查询日志。
- 暂不删除现有 `C`、`_openid_1` 等索引，其他列表仍可能使用它们。
- 验收：重新编译后打开首页、历史弹层及下一页，确认数量、顺序和排除自身不变，并检查索引告警；索引生效前仍可能提示缺少索引。

参考：[CloudBase 索引管理](https://docs.cloudbase.net/database/data-index)。

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

## 2026-10-18 性能优化后的实配索引

本节替代上文“尚未创建”的历史说明。已在 `cloud1-d0gjfc19ve571942b` 实际补齐 11 个非唯一组合索引，并合并 5 个被完整前缀覆盖的旧索引。精确定义见 `scripts/performance-indexes.json`，被合并索引的可恢复定义见 `scripts/performance-indexes-restore.json`。没有修改集合权限、唯一性或用户业务文档。

复盘与个股查询使用账号/删除状态/ID 游标索引；理由明细使用理由/ID 索引。待确认列表为创建时间和 ID 同方向升序；待回看与待办列表使用到期时间和 ID 升序；相关历史使用执行时间和 ID 降序。回看详情增加每页 20 条的稳定游标读取。不要根据旧日志重新创建被合并的冗余前缀索引。

验证方法与测量边界见 `docs/performance-audit-2026-10-18.md`。


## AI复盘增量契约（2026-10-31）

复用现有集合，不迁移或改写交易与回看。

- `period_metrics` 新增 `period_type=ai_review`，每账号一个确定性ID文档；与原周/月快照隔离。保存模型、提示版本、来源指纹、范围、规范化文字来源、已核验发现、生成时间、用量和短期生成租约。读取完整分页，失败整体报错。当前输入上限650000字节，超限明确失败，不截取首批假装全部。
- `personal_rules` 新增 `rule_key=review_custom` / `review_reminder_undo`，独立 `schema_version=1` 的派生配置版本；原交易架构仍为v2。提醒保留来源ID、前一完整提醒和撤回审计。
- `user_config.current_focus` 兼容旧 `{key,label,updated_at}`；新提醒含 `id,kind=review,text,actions,finding_id`。保存需要原提醒指纹和请求ID；冲突不覆盖，重复请求不重复创建。手写提醒未继承适用动作时，默认适用所有操作前，避免需要额外填写条件。
- `user_config.ai_review_hidden` 只记录当前来源版本下收起的发现ID；可恢复，不改写原记录，不把反馈自动解释成新的交易事实。新来源版本重新核验后不强行沿用旧隐藏结论。

2026-10-31状态变化图增加 `reviewAI` 的只读 `timeline` / `timelineDetail` 动作，沿用服务端真实登录身份读取完整操作及回看，不新增集合、字段或迁移，不写原始数据或AI快照，不调用模型。统计按上海时区操作周归组；详情15条分页并校验来源版本。最近方向仅以账号隔离的本地偏好保存。具体契约及最终验证见 [状态变化图](review-timeline.md)。
- 交易和回看沿用原软删除契约。引用来源被编辑或软删除后，读取时立即移除受影响发现，详情与提醒采用也须重新核验；新记录只提示更新，不自动收费重算。历史AI快照不是独立收藏，不能绕过来源校验展示已删除原文；旧来源副本随下一次成功整理替换，不声称物理清除。
- `reviewAI` 固定 `wx-server-sdk@4.0.2`、Node16.13、90秒上限。无需新增客户端权限或密钥。只通过CloudBase的 `deepseek-v4.1-flash` 分析文字，未发送截图。生成与审稿均无工具调用。

源码 `config.json` 的时间限制在首次部署时未被工具采用，需核验实际云函数配置。当前环境已实际调至90秒；正式发布前再次核对配置和额度，不能从接口usage推算剩余赠送余额。

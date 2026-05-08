# Expense Agent Skill

合思（易快报）AI 财务助手开源基础版。用企业自己的合思 OpenAPI 凭证，在本地让 AI Agent 安全查询本人单据数据。

> 适合做 PoC、技术预研、客户演示和企业 AI 财务助手的第一步验证。

> 非官方项目：本项目不是合思官方产品，也不代表合思官方立场。使用前请确认你所在企业已经开通并授权相应 OpenAPI 权限。

## 核心承诺：
- 所有数据通过本地脚本直连合思 API 域名，安全开源。如需高级写操作（自动填单）请联系维护者定制。

## 职责：
- 自动读取 AppKey 和 AppSecurity。
- 自动调用合思接口获取 accessToken，并进行简单的内存级缓存。
- 封装通用的 fetch 请求，处理鉴权 Header，并将结果标准化输出。

## 解决什么问题

很多企业已经在使用合思（易快报），但要把 AI 接入财务系统时，通常会先卡在几个问题上：

- 数据能不能不出本地环境？
- OpenAPI 凭证能不能安全使用？
- AI Agent 能不能安全查询本人待审批单据？
- 后续能不能扩展到自动提单、预算校验、审批联动？

这个开源版的目标很明确：**先用最小成本验证合思 OpenAPI 能被 AI 安全接入**。

## 开源版能做什么

- 本地读取 `EKUAIBAO_APP_KEY` 和 `EKUAIBAO_APP_SECURITY`
- 自动获取并缓存 `accessToken`
- 通过 `expense_api.cjs` 直连合思 API
- 通过底层脚本调试部门、人员、档案等只读 OpenAPI 连通性
- 根据员工 ID 获取本人待审批单据
- 通过 `expense_query.cjs` 按身份查询本人单据，并默认脱敏输出
- 通过 `my-summary` 汇总本人单据状态、类型、金额和最近单据摘要
- 等查询接口

开源基础版只做只读查询，不包含自动提单、自动审批、预算占用、表单写入等写操作。

## 本地演示能力

仓库内置 `expense_bi_demo.cjs` 和本地 demo 数据，用于展示老板/财务 BI 的产品方向，例如公司费用汇总、预算使用、排行分析和风险提醒。

这部分是**演示能力**，不调用合思接口，不代表真实企业数据，也不开放真实公司级查询权限。真实部门/公司级统计、报表、BI 和预算分析需要企业版接入合思角色/权限 API 后再启用。

## 为什么适合获客演示

这个项目不是一个“大而全”的财务系统，而是一个很轻的验证入口：

- 5 分钟可以验证企业合思 OpenAPI 是否可用
- 客户可以看到凭证只在本地使用
- 能快速展示 AI 查询本人财务单据的效果
- 很自然地引出企业定制需求，例如自动提单、预算校验、审批流联动

对客户来说，这是一个低风险试用入口。对服务商来说，这是一个清晰的获客钩子。

## 适合谁

- 已经在使用合思（易快报）的企业
- 正在评估 AI 财务助手、AI 报销助手的团队
- 需要本地化、安全可控方案的财务、IT 或数字化部门
- 想做合思 OpenAPI 二次开发、Agent 集成、流程自动化的开发者

## 安全承诺

- 凭证只在本机环境变量中读取。
- API 请求只由本地脚本发往你配置的合思 API 域名。
- 不使用第三方中转服务，不上传凭证或业务数据。
- token 缓存在本地 `.expense_token_cache.json`，该文件已加入 `.gitignore`，不要提交到公开仓库。
- 普通用户单据查询应使用 `expense_query.cjs`，该脚本会先做身份解析，并只允许查询本人信息，再返回脱敏摘要。
- 底层 `expense_api.cjs` 只允许请求 `EKUAIBAO_BASE_URL` 配置的同源域名，已拒绝 `DELETE/PUT/PATCH` 方法、未加入白名单的 `POST` 方法，以及路径或请求体中疑似删除、作废、撤销、回滚的接口。

## 隐私提醒

合思接口可能返回员工姓名、手机号、邮箱、部门、成本中心、法人主体等企业内部数据或个人信息。使用本项目时请遵守企业内部数据权限、最小必要原则和当地隐私合规要求。

如果 Agent 需要把查询结果回复给最终用户，建议默认只展示必要字段，避免直接展开手机号、邮箱、证件号、银行账户等敏感信息。

## 快速开始

### 1. 环境要求

- Node.js 18 或更高版本
- 合思开放平台 App Key / App Security

### 2. 配置凭证

参考 `.env.example`：

```bash
export EKUAIBAO_APP_KEY="your_company_app_key"
export EKUAIBAO_APP_SECURITY="your_company_app_security"

# 可选。沙箱、测试环境或私有化部署时配置；不配置则默认 https://app.ekuaibao.com
export EKUAIBAO_BASE_URL="https://app.ekuaibao.com"
```

### 3. 受控业务查询

普通 Agent 查询优先使用 `expense_query.cjs`，不要直接把任意 OpenAPI 路径暴露给最终用户。开源基础版默认只开放本人信息查询。

#### 本地预检

正式查询前可先运行预检，检查 Node 版本、凭证环境变量、Base URL 格式和本地安全拦截：

```bash
node preflight-check.cjs
```

需要真实连通性验证时追加 `--live`。该模式会请求合思人员接口的第一页 1 条数据：

```bash
node preflight-check.cjs --live
```

#### 查询我的单据

有登录态时优先传 `staffId` 或 `userId`。没有登录态时，先让用户提供最小必要身份信息，例如姓名 + 邮箱，或姓名 + 手机号后四位。

```bash
node expense_query.cjs my-docs '{"name":"张三","email":"zhangsan@example.com","count":10}'
```

```bash
node expense_query.cjs my-docs '{"name":"张三","phoneLast4":"1234","count":10}'
```

返回只包含员工脱敏摘要和单据摘要，不包含手机号、邮箱、收款人、附件、发票明细等敏感字段。

#### 查询我的单据汇总

```bash
node expense_query.cjs my-summary '{"staffId":"员工ID","count":100}'
```

返回本人单据的状态分布、类型分布、按币种汇总金额、驳回数量和最近 5 条脱敏单据摘要。`count` 默认 100，最大 100。

#### 查询指定员工单据

开源基础版只允许操作者查询本人。当 `actor` 和 `target` 是同一员工时，这个命令等价于本人查询；查询他人需要升级版接入合思角色/权限 API。

```bash
node expense_query.cjs staff-docs '{"actor":{"staffId":"操作者员工ID"},"target":{"name":"张三","email":"zhangsan@example.com"},"count":10}'
```

#### 企业级查询

开源基础版默认不支持企业级查询。该能力需要升级版接入合思角色/权限 API，并确认当前用户具备管理员、财务或企业授权角色。

```bash
node expense_query.cjs company-docs '{"actor":{"staffId":"操作者员工ID"}}'
```

### 4. 本地老板/财务 BI Demo

开源版内置本地演示数据，可用于展示老板驾驶舱、财务汇总、预算使用和风险提醒。该功能只用于产品价值演示，不调用合思接口，不代表真实企业数据；真实公司级 BI 需要企业版接入角色/权限 API 后开放。

```bash
node expense_bi_demo.cjs company-summary '{"month":"2026-05"}'
```

输出 Markdown 报表：

```bash
node expense_bi_demo.cjs company-report '{"month":"2026-05","format":"markdown"}'
```

生成 HTML 演示报表：

```bash
node expense_bi_demo.cjs company-report '{"month":"2026-05","format":"html","output":"output/bi-demo-2026-05.html"}'
```

Demo 报表包含：

- 核心指标：总费用、单据数、平均金额、审批中、驳回、预算使用率、环比变化
- 排行分析：部门、费用类型、成本中心、项目
- 预算分析：部门预算、实际使用、使用率、剩余预算
- 风险提醒：预算使用率偏高、大额支出、审批超时、驳回单据
- 大额单据：展示脱敏后的单据摘要

### 5. 底层接口调试

基本格式：

```bash
node expense_api.cjs <HTTP_METHOD> <API_PATH> <JSON_BODY>
```

底层脚本仅用于开发调试。它只允许请求 `EKUAIBAO_BASE_URL` 配置的同源域名；默认只开放 `GET/HEAD` 查询，`POST` 必须先在代码白名单中确认为只读查询接口。脚本会拒绝 `DELETE/PUT/PATCH` 方法、未加入白名单的 `POST` 方法，以及疑似删除、作废、撤销、回滚的接口路径或请求体。

已验证接口：

| 场景 | 命令 |
| --- | --- |
| 查询部门列表 | `node expense_api.cjs GET 'api/openapi/v2/departments?start=0&count=20' '{}'` |
| 查询人员列表 | `node expense_api.cjs GET 'api/openapi/v2/staffs?start=0&count=20' '{}'` |
| 查询档案类别 | `node expense_api.cjs GET 'api/openapi/v1/dimensions?start=0&count=100' '{}'` |
| 查询指定档案项 | `node expense_api.cjs GET 'api/openapi/v1/dimensions/items?start=0&count=100&dimensionId=档案类别ID' '{}'` |
| 根据员工 ID 获取待审批单据 | `node expense_api.cjs GET 'api/openapi/v1.1/docs/byFlowId/$员工ID?index=0&count=10' '{}'` |

员工 ID 放入 URL 时需要进行 URL 编码，例如 `:` 编码为 `%3A`。待审批单据接口里的 `$` 是接口路径固定前缀，建议用单引号包住 API path，避免被 shell 当成变量展开。

## Agent 使用方式

你可以对 Agent 这样说：

- “查一下我的待审批单据。”
- “查一下我的报销状态。”
- “我的单据。”
- “生成一份财务 BI 演示报表。”

Agent 应优先通过 `expense_query.cjs` 完成身份解析和本人查询脱敏输出。只有调试基础 OpenAPI 连通性时，才直接使用 `expense_api.cjs`。查询他人、部门或企业级数据需要升级版接入合思角色/权限 API。

老板/财务 BI 演示应使用 `expense_bi_demo.cjs`，并明确告知用户这是本地 demo 数据，不是真实企业数据。

## 错误处理

脚本会把可执行错误写入 `stderr`，格式类似：

```json
{"code":-100,"msg":"未找到合思鉴权凭证。请设置 EKUAIBAO_APP_KEY 和 EKUAIBAO_APP_SECURITY 环境变量。"}
```

如果合思 API 返回权限不足、参数缺失、token 无效或查无数据，请优先把服务端返回的错误原因转达给用户，并检查企业开放平台授权范围。

## 本地测试

项目内置 mock 测试，不依赖真实合思凭证或网络：

```bash
node tests/run-mock-tests.cjs
```

测试覆盖本地预检、安全拦截、本人单据查询、本人单据汇总和越权拒绝。

## 从开源版到企业版

开源版适合验证“能不能安全接入”。生产可用的企业财务 Agent，通常还需要按企业实际环境定制：

- 私有报销表单字段映射
- 一句话自动创建报销单、差旅单、付款单
- 费用标准校验和超标拦截
- 预算查询、预算占用和项目成本中心联动
- 审批流程、角色权限和节点规则适配
- 飞书、钉钉、企业微信通知和审批卡片
- 企业制度文档 RAG 问答

这些能力一般不能只靠通用开源脚本完成，需要按企业表单、审批流、费用制度和组织权限做专项适配。

## 开源发布检查

发布到 GitHub 前请确认：

- `.env`、token 缓存、日志文件没有被提交。
- `LICENSE` 已保留。
- README 中的项目定位、非官方声明和隐私说明没有删掉。
- 示例凭证只存在于 `.env.example`，且不包含真实密钥。

## 商业合作

如果你正在评估合思 AI 财务助手、AI 报销助手、OpenAPI 集成或企业内部财务 Agent，可以通过以下方式联系维护者：

- 微信：yy_start007
- 邮箱：923038999@qq.com

## License

MIT

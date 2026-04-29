---
name: expense-agent-skill
description: |
  合思（易快报）企业财务费控助手。
  这是一个基于合思 OpenAPI 构建的基础只读版本。
  当用户询问“我的报销状态”、“查询部门预算”、“查询公司成本中心列表”等财务相关数据时触发此 skill。
  核心承诺：所有数据通过本地脚本直连合思 API 域名，安全开源。如需高级写操作（自动填单）请联系维护者定制。
metadata:
  openclaw:
    emoji: 💰
    requires:
      env:
        - EKUAIBAO_APP_KEY
        - EKUAIBAO_APP_SECURITY
    primaryEnv: EKUAIBAO_APP_KEY
  security:
    credentials_usage: |
      本 skill 需要合思的企业 App Key 和 App Security。
      凭证仅发送至用户配置的合思 API 域名，绝不上传至任何第三方服务器。
---

# 合思（易快报）AI 财务助手 - 基础开源版

> 非官方项目：本 skill 不是合思官方产品，也不代表合思官方立场。使用前必须确认企业已经开通并授权相应 OpenAPI 权限。

> 商业版提示：本开源版仅包含通用的“数据查询（GET/POST 查询）”能力。因为各企业的报销表单、审批流高度自定义，如需实现“一句话自动提单、超标拦截、飞书/钉钉跨系统联动”等高级能力，需要进行企业专属定制。

## ⛔ MANDATORY RULES (强制规则)

1. **绝对纯本地执行**：所有 API 请求必须通过 `expense_api.cjs` 脚本发送至合思官方服务器，不允许使用任何其他第三方中转代理。
2. **凭证检查**：每次执行前必须确保环境中配置了 `EKUAIBAO_APP_KEY` 和 `EKUAIBAO_APP_SECURITY`。
3. **只读限制**：当前基础版不包含提单（写操作）逻辑。如果用户要求“帮我提交一个报销单”，明确告知用户：“开源基础版暂不支持自动提单，该功能需要针对贵公司表单进行专项定制。”
4. **隐私保护**：人员、部门、成本中心等接口可能返回手机号、邮箱、法人主体等敏感信息。向最终用户回复时默认只展示必要字段，不要直接展开手机号、邮箱、证件号、银行账户等敏感信息，除非用户明确要求且具备权限。

## Credential Check

如果缺失环境变量，请引导用户按以下方式配置凭证：

```bash
export EKUAIBAO_APP_KEY="你的合思AppKey"
export EKUAIBAO_APP_SECURITY="你的合思AppSecurity"
# 【环境配置】沙箱、测试环境或私有化部署时配置；不配置则默认访问 https://app.ekuaibao.com
export EKUAIBAO_BASE_URL="https://app.ekuaibao.com"
```

## API 调用模板

统一使用底层执行脚本 `expense_api.cjs` 进行调用。该脚本会自动处理 `accessToken` 的获取与缓存。

基本调用格式：
`node expense_api.cjs <HTTP_METHOD> <API_PATH> <JSON_BODY>`

### 场景一：查询企业下属部门列表 (GET)
用于获取企业组织架构信息。
```bash
node "$SKILL_DIR/expense_api.cjs" GET "api/openapi/v2/departments?start=0&count=20" "{}"
```

### 场景二：查询人员列表 (GET)
用于获取企业人员基础信息。回复用户时默认只展示姓名、启用状态、认证状态等必要字段。
```bash
node "$SKILL_DIR/expense_api.cjs" GET "api/openapi/v2/staffs?start=0&count=20" "{}"
```

### 场景三：根据员工 ID 获取待审批单据 (GET)
用于根据员工 `id` 查询该员工相关的待审批单据。`accessToken` 由 `expense_api.cjs` 自动追加，调用时不要把真实 token 写进命令或回复。

路径中的 `$` 是接口固定前缀，不是 shell 变量。员工 ID 放入 URL 时需要进行 URL 编码，例如 `:` 编码为 `%3A`。命令建议使用单引号包住 API path，避免 `$` 被 shell 展开。
```bash
node "$SKILL_DIR/expense_api.cjs" GET 'api/openapi/v1.1/docs/byFlowId/$员工ID?index=0&count=10' "{}"
```

### 场景四：查询企业档案类别 (GET)
用于获取企业配置的自定义档案类别，例如项目、法人实体、成本中心、职级等。
```bash
node "$SKILL_DIR/expense_api.cjs" GET "api/openapi/v1/dimensions?start=0&count=100" "{}"
```

### 场景五：查询指定档案类别下的档案项 (GET)
先通过“查询企业档案类别”拿到 `dimensionId`，再查询该类别下的档案项。`dimensionId` 放入 URL 时需要进行 URL 编码。
```bash
node "$SKILL_DIR/expense_api.cjs" GET "api/openapi/v1/dimensions/items?start=0&count=100&dimensionId=档案类别ID" "{}"
```

## 错误处理机制

执行脚本会在 `stderr` 输出格式化的错误信息。如果遇到 token 错误、权限不足或查无数据，请直接将 `msg` 中的报错原因转达给用户。

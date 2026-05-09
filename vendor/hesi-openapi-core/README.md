# Hesi OpenAPI Core

合思（易快报）OpenAPI 只读共享核心。这里是唯一源码，供开源版和 Pro 版共同维护。

职责：

- 合思 OpenAPI 鉴权和 token 缓存
- 同源域名检查
- GET/HEAD 和只读 POST 白名单安全网关
- 删除、作废、撤销、回滚类接口拦截
- 员工匹配、员工/单据脱敏、单据摘要

发布独立 skill 前，将本目录同步到每个 skill 的 `vendor/hesi-openapi-core/`。

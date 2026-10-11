# 腾讯云 CVM 生产部署运行手册

方案：Linux CVM + Docker Compose，Nginx 提供构建后的 Vue 静态资源与 HTTPS，同源反向代理 Fastify；PostgreSQL 17 仅在容器网络可达。浏览器不接触数据库/SAP/模型密钥。API、Nginx、数据库独立进程，单机故障仍会中断服务；此方案尚无高可用、自动扩容或云端验收证据。当前未实际发布腾讯云。

## 准备

1. 准备 Ubuntu 24.04 LTS CVM（建议至少 2 核 4 GiB，独立数据盘和容量告警），按 Docker 官方 Ubuntu 指南安装 Engine、Buildx、Compose v2；确认 `docker version`、`docker compose version`。维护窗口操作使用具备 Docker 权限的部署账号。
2. 域名解析至 CVM；中国大陆公网网站先完成适用备案。腾讯云安全组仅开放公网 80/443，SSH 22 限管理员固定 IP；不开放 3001/5432/5173。通过 VPC/VPN 打通 SAP 所需端口；模型出口域名按组织策略放行。
3. 将源码与锁文件上传至 `/opt/sapwb`，不上传 `.env`、`.runtime`、`node_modules` 或客户数据。Docker 在 Linux 内重新安装 root 与 vendor 依赖，Argon2 原生模块不复用 Windows 二进制。保留 vendor 来源/许可证记录。
4. 在腾讯云 SSL 或受控 ACME 流程签发证书，放入 `infra/production/tls/fullchain.pem` 和 `privkey.pem`。证书须匹配 APP_ORIGIN 域名；设置到期告警及续签任务，更新后执行 `docker compose --env-file production.env exec web nginx -t`，再 `exec web nginx -s reload`。本方案不内置证书自动申请。

所有以下命令均在 Linux Bash 执行，先进入目录：

```bash
cd /opt/sapwb/infra/production
umask 077
cp production.env.example production.env
mkdir -p secrets tls data/files
sudo chown 1000:1000 data/files
chmod 700 secrets tls
chmod 600 production.env
openssl rand -hex 32
```

编辑 production.env：四次独立执行 `openssl rand -hex 32`，分别填写 POSTGRES_PASSWORD、APP_DB_PASSWORD、SAP_CREDENTIAL_KEY、LLM_CREDENTIAL_KEY；后两项必须是 64 位十六进制。设置真实 APP_ORIGIN（HTTPS origin，无尾部斜杠）和 RELEASE（不可变发布编号）。不要将真实值写入命令参数、日志、工单或 VITE_*。首次 DEFAULT_ORGANIZATION_ID 暂留空。数据密钥与加密数据必须共同可恢复；轮换前需实现旧数据重加密，不能直接替换密钥。

Docker 管理权限可读取容器环境，因此部署主机与 production.env 是受控密钥边界；环境文件不能当作专用秘密管理服务。后续可接入腾讯云 Secrets Manager 注入。容器日志不输出正文/凭据，Nginx 关闭访问日志避免路径查询泄露；Docker 日志每服务最多 3×10 MiB。业务审计留在数据库。

## 首次部署

```bash
dc() { docker compose --env-file production.env -f compose.yaml "$@"; }
dc config --quiet
dc --profile ops build
dc up -d --wait postgres
dc run --rm tooling node scripts/database/migrate.mjs
dc run --rm tooling node scripts/database/provision.mjs
dc run --rm tooling node scripts/database/bootstrap.mjs
sudo cat secrets/organization.env
```

把输出的 DEFAULT_ORGANIZATION_ID 填回 production.env。工具容器以 root 写入交接文件并保留 0600 权限；普通 Docker 部署用户应在受控终端执行 `sudo cat secrets/initial-login.txt` 获取 admin 临时密码，不要放宽权限，也不要把内容复制到共享日志。然后：

```bash
dc up -d --wait api web
curl --fail https://你的域名/api/health/live
curl --fail https://你的域名/api/health/ready
dc exec web nginx -t
dc ps
```

首次登录立即改密并删除临时密码交接文件。验收真实域名 HTTPS、Secure/HttpOnly 会话、真实客户端 IP 限流、组织/项目隔离、附件上传下载、SAP 私网连接及选定模型连接；重启容器后验证数据与附件仍存在。readiness 检查数据库连接，业务迁移、授权、外部系统仍需上述验收。健康检查失败不会自动修复配置，需通过云监控外部探测与告警处理。

生产入口为 `node apps/api/src/server.mjs`，不运行 Vite dev/preview。Nginx 代理读取超时为 150 秒，覆盖模型连接同步测试最长 120 秒的服务端超时。API 信任唯一 Nginx 地址 `172.30.80.10`；Nginx 覆盖客户端传入的 X-Forwarded-For，不能把 API 端口公开。如果此 Docker 网段与 VPC/VPN 冲突，须同时更改 Compose 子网、Nginx 固定 IP 与 TRUST_PROXY。新增 CLB 时需重新审核可信代理与来源 IP 链。

默认生产数据库允许服务名 postgres 上的容器网络非 TLS 连接；开发仍强制回环地址与 `_dev` 后缀。若迁至腾讯云 PostgreSQL，改 POSTGRES_HOST、POSTGRES_PORT，并设 POSTGRES_SSL_MODE=verify-full，挂载 CA 后设 POSTGRES_SSL_CA_FILE；证书主机名必须匹配，不允许 rejectUnauthorized=false。迁移与初始化使用工具容器的管理账号，API 不注入该账号。不要在生产运行测试脚本。

## 一致性备份与恢复

在维护窗口执行（会暂停 API/Web，数据库继续运行）：

```bash
sudo bash backup.sh /srv/sapwb-backups/2026-10-03T120000
```

脚本先停写，再保存 pg_dump、自有附件、生产配置（含密钥）、镜像版本与 SHA-256 清单，最后恢复 API/Web。设置每日备份和容量/失败告警；备份使用组织批准的加密工具加密后上传到私有 COS，启用版本/保留策略与最小权限。建议至少每日备份保留 30 天，每季度演练恢复；该频率对应最多一天数据损失，按业务调整。校验和只检测损坏，不替代加密或恢复演练。

恢复必须使用隔离的空实例与空附件目录；不要覆盖现网。准备相同发布源码/镜像、从备份安全恢复 production.env 与 TLS，确认密钥和 DEFAULT_ORGANIZATION_ID 一致。首次准备时不要创建 data/files。启动空 PostgreSQL 再恢复（忽略备份旧角色 ACL，恢复后 provision 重建角色与权限）：

```bash
dc up -d --wait postgres
sudo bash restore.sh /srv/sapwb-backups/2026-10-03T120000
dc up -d --wait api web
```

恢复脚本拒绝非空 app schema/已有附件目录。恢复后重新配置运行权限，验证登录、业务数量、随机附件 SHA-256 与 SAP/模型凭据解密，再切换域名/入口。脚本失败时保持维护状态，查明原因后在新的空恢复目标重做；不要在部分恢复目标重复叠加。

## 升级与回滚

1. 在隔离测试环境跑完整测试并演练迁移、恢复；给 API/Web/tooling 镜像唯一 RELEASE 标签并记录镜像 ID，禁止覆盖旧标签。基础镜像当前固定版本标签，发布审核时应锁定 registry digest 并扫描漏洞。
2. 现网执行一致性备份并确认完成，`dc stop web api`。保存旧 RELEASE 和配置，部署新代码、更新 RELEASE，`dc --profile ops build`。
3. `dc run --rm tooling node scripts/database/migrate.mjs`，再 `dc run --rm tooling node scripts/database/provision.mjs`，最后 `dc up -d --wait api web`，执行 HTTPS/登录/附件等冒烟验收。迁移失败时不启动新版本。
4. 若新旧 schema 向后兼容，把 RELEASE 改回旧标签并 `dc up -d --no-build api web`。不兼容或数据已改变时，停止写入，使用升级前备份恢复至独立空实例，运行旧镜像并验收后切换。不能盲目运行 down migration，也不能执行 `docker compose down -v`。

容器配置和本机测试不能替代云端演练；网络、证书续期、COS备份、容量与告警、真实SAP及模型可达性均需上线前实测。

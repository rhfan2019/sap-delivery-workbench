# 查看开发数据库与表关系图

本项目自带一个 pgAdmin，用来浏览开发库的表、数据，并自动画出表关系图（ERD）。它只连本机开发库，不随 `npm start` 启动，用时单独开。

## 启动与登录

1. 先启动开发库（`npm start` 或 `npm run db:up`），再运行：

   ```bash
   npm run db:admin
   ```

2. 打开 http://127.0.0.1:5051 。
3. 登录账号是 `.env` 中的 `PGADMIN_DEFAULT_EMAIL` 与 `PGADMIN_DEFAULT_PASSWORD`。这是 pgAdmin 自己的登录账号，不是数据库账号。
4. 登录后，左侧 **Servers → sap-delivery-workbench → sap-delivery-workbench（开发库）** 已经登记好，点开即可连上，不需要输入数据库密码。

停止：`npm run db:admin:stop`；`npm stop` 也会一并停止。

## 画表关系图

展开 **sap_delivery_workbench_dev → Schemas → app**，在 `app` 上右键选 **ERD For Schema**。工具栏可自动布局、导出图片。只想看几张表时，新建一个空白 ERD，把表从左侧拖进去。

## 配置说明

| 项目       | 位置                                                                                                                                |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| 服务定义   | 根目录 `compose.yaml` 的 `pgadmin` 服务（`tools` profile，只监听 127.0.0.1，端口可用 `.env` 的 `PGADMIN_PORT` 改，默认 5051）       |
| 服务器登记 | `infra/dev/pgadmin-servers.json`，每次启动按它重新登记；主机为 Compose 内的 `postgres:5432`，用户为 `postgres`                      |
| 登录账号   | `.env` 的 `PGADMIN_DEFAULT_EMAIL`（须为合法邮箱格式）、`PGADMIN_DEFAULT_PASSWORD`；`npm run setup:env` 新建 `.env` 时会生成随机密码 |
| 数据库密码 | 容器启动时从 `.env` 的 `POSTGRES_USER`、`POSTGRES_PASSWORD` 写入容器内的 pgpass 文件，不写入仓库                                    |
| 保存的数据 | Docker 卷 `pgadmin_data`（查询历史、界面布局、ERD 文件）                                                                            |

登录账号只在第一次创建 `pgadmin_data` 卷时生效。之后修改 `.env` 中的 pgAdmin 密码，需要在 pgAdmin 里改密码（右上角用户菜单 → Change Password），或删除 `pgadmin_data` 卷重建（只影响 pgAdmin 自身的保存内容，不影响业务数据库）。

## 注意

- 这是开发库的直接连接，账号是数据库所有者，改表、改数据会立即生效。表结构的修改一律走 `database/migrations`，不要在 pgAdmin 里手工改结构。
- 本机若还有其他项目的 pgAdmin（例如占用 5050 端口），与本项目的互不相干，各自账号独立。
- 生产环境不部署 pgAdmin。

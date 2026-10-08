# 独立 HTTP 与 HTTPS 入口

可以通过单独的 Caddy 用户服务新增 HTTPS 入口，现有 HTTP 服务继续独立运行。
无需修改应用程序、上传任务或实时模型服务。示例配置见
[Caddyfile.example](../deploy/https/Caddyfile.example) 和
[用户服务模板](../deploy/https/meetingscribe-https.service.example)。

## 配置与启动

使用官方发布的 Caddy，核对下载文件的 SHA256。使用独立部署目录，保留程序版本、
程序及配置校验值、服务路径和验证记录。使用 8443 等非特权端口，无需管理员权限。
在实际环境设置 `MEETINGSCRIBE_HTTPS_HOST`（现有内网 IP）、
`MEETINGSCRIBE_HTTPS_PORT` 和 `MEETINGSCRIBE_HTTP_UPSTREAM`（原 HTTP 地址）。
将模板转换为 JSON，并在启动、validate 之前设置
`apps.tls.disable_storage_clean = true`，禁用自动存储清理，遵守项目的目录删除限制。
使用独立的 XDG_DATA_HOME 与 XDG_CONFIG_HOME；证书及私钥目录权限设为 0700。
不要将运行目录、私钥、CA 状态或实际部署配置提交到 Git。

`auto_https disable_redirects` 保留独立 HTTP；不添加 HSTS，避免浏览器强制升级旧入口。
代理即时转发流式响应，并保留较长上传、冷启动和会议纪要流式生成所需的等待时间。
仅绑定指定内网地址，不开启管理 API 或 HTTP/3 UDP 入口。

## 证书信任

内网 IP 使用 Caddy 专用内部 CA，自动签发并续期站点证书。需要在每台访问设备上
安装并信任公开的根证书，路径为独立数据目录下
`caddy/pki/authorities/local/root.crt`。仅分发 root.crt；不得分发任何私钥。
先通过 SSH 等已验证通道核对根证书的 SHA256 指纹，再安装信任。
仅绕过浏览器证书警告不能替代正常的信任配置。

HTTP 与 HTTPS 是两个浏览器来源，本地保存的登录状态和偏好可能不共享，
首次打开 HTTPS 通常需要重新登录。浏览器仍会单独询问麦克风权限。
HTTP 继续提供未加密访问；HTTPS 只保护使用 HTTPS 入口的流量。

## 验证与回退

验证 HTTP 与 HTTPS 都返回正常网页且 HTTP 没有跳转；用指定根证书校验 TLS 的
证书链及 IP SAN，核对两个入口的前端版本与健康检查。再从访问设备确认 HTTPS
可达、浏览器没有证书警告且 `window.isSecureContext` 为 true。
新代理不需要加载 GPU 模型。回退只需停用新增代理服务，原 HTTP 入口持续可用；
保留部署目录和 CA 数据，不执行目录清理。若需要撤销设备信任，只移除该专用证书。

`/live` 和 `/live/` 由应用返回实时页面，查询参数保持原样；存活检查使用
`/health/live`。验证必须直接访问三个入口的 `/live` 并确认返回相同 HTML；
只验证首页或健康检查不足以证明实时页面可用。
旧部署曾在 HTTPS 代理中将 `/live` 内部改写为 `/index.html`，以绕过旧存活接口。
升级时先部署新的应用和探针路径，验证直接访问正常后，再移除代理中的临时改写。

内部证书方案仍要求每台设备信任根证书；仅建立 TLS 连接不能保证浏览器允许麦克风。
若不允许改动访问设备，需改用域名和浏览器已信任的证书，再测试录音。

参考：[Caddy 配置](https://caddyserver.com/docs/caddyfile/options)、
[内部 TLS](https://caddyserver.com/docs/caddyfile/directives/tls)。

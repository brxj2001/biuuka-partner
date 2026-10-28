# Biuuka 插件

Biuuka 是运行在 Windows 和 macOS 上的本机 Codex 插件，提供账号管理、额度查看、本机控制台、独立托盘及网站授权连接。账号凭据保存在自己的电脑上，网站只能读取获得授权的数据，不会收到账号令牌。

源码仓库：[biuuka-partner](https://github.com/brxj2001/biuuka-partner)。当前版本与更新协议以 [release.json](release.json) 为准。

## 功能

- 本机控制台管理账号、网站授权、联网权限与更新设置。
- 展示当前账号及可用额度；离线时只显示对应账号的本机缓存和读取时间。
- Windows／macOS 独立托盘，可打开控制台、管理运行状态。
- 经授权向网站提供账号状态、额度与网络信息；第三方连接须在本机确认。
- 保存 Biuuka 自身的测试记录及关联 Codex 对话，不提供任意 Codex 历史管理。
- 空闲时校验并更新插件；提供手动更新、暂停及完整卸载。

## 安装与使用

支持 Windows x64／ARM64、macOS Intel／Apple Silicon。请从信任的 Biuuka 网站下载对应安装程序；安装程序会检查依赖摘要。源码中的 `bootstrap.cmd`、`bootstrap.sh` 从固定 HTTPS 下载入口获取安装程序。

安装完成后可使用以下命令：

```sh
biuuka open          # 打开本机控制台
biuuka status        # 查询运行状态
biuuka tray          # 打开独立托盘
biuuka stop          # 暂停 Codex，保留本机控制服务
biuuka start         # 恢复服务
biuuka service-exit  # 完全退出控制服务；之后用 biuuka start 恢复
biuuka uninstall    # 卸载 Biuuka
```

账号添加和切换在本机控制台操作。关闭联网权限后，外部查询和更新均被阻止；本地控制和记录管理仍可使用。退出托盘不会停止后台服务。

## 隐私与安全

- 服务只监听回环地址；网站访问按来源、范围及有效期校验。
- 本机管理接口不向网站开放；控制台中可撤销网站权限。
- 不把账号凭据上传网站，不允许网站指定任意命令或更新来源。
- 卸载只删除 Biuuka 自身程序与数据，不删除原有 `CODEX_HOME`、`.codex`、共享 Node／Codex 或用户原有会话。
- 安装、账号登录、额度查询和在线更新需要相应网络访问；源码测试通过不代表所有操作系统均已实机验收。

## 开发与打包

构建使用 Node.js 24，无需先安装 npm 依赖；打包后安装程序按固定来源及摘要下载运行依赖。

```sh
node --test *.test.mjs
node package.mjs --output ./dist
```

生成 `biuuka.zip`、Windows／macOS 安装程序、卸载脚本、SHA-256 摘要和 `latest.json`。`dist/` 不提交到源码仓库。

版本、渠道及更新协议统一在 `release.json` 维护，运行接口与安装包读取同一版本。`development` 表示开发渠道，`stable` 表示正式渠道；更新协议变更需同步处理客户端兼容性，不能只修改数字。已对外发布的版本不覆盖为不同内容，修复应发布新版本。

Windows 原生检查使用 `windows.test.ps1`，还需编译 `Service.cs`；macOS 托盘依赖 Cocoa，需在对应系统上验收。运行真实插件可能访问本机账户和网络，自动测试应使用隔离夹具。

## 许可

采用 [MIT License](LICENSE)。随附 WebSocket 实现的第三方许可见 [WS-LICENSE](WS-LICENSE)，来源记录见 [WS-SOURCE.json](WS-SOURCE.json)。

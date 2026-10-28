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

支持 Windows x64／ARM64、macOS Intel／Apple Silicon。当前为低于 `1.0.0` 的开发版，只同步 GitHub 源码，不创建版本标签或 Releases。

Windows：在 **CMD** 中运行这一行（不是 PowerShell 窗口）：

```cmd
curl.exe -fL --proto "=https" https://raw.githubusercontent.com/brxj2001/biuuka-partner/main/scripts/install/bootstrap.cmd -o "%TEMP%\biuuka-install.cmd" && call "%TEMP%\biuuka-install.cmd"
```

macOS：需要 macOS 14+ 和 Git（Apple Command Line Tools），以普通桌面用户执行，不使用 sudo：

```sh
curl -fL --proto '=https' https://raw.githubusercontent.com/brxj2001/biuuka-partner/main/scripts/install/bootstrap.sh -o /tmp/biuuka-install.sh && sh /tmp/biuuka-install.sh
```

引导脚本从上述 GitHub 仓库读取源码，固定本次安装的提交，再在临时目录构建安装包。Windows 校验源码 ZIP 中每个文件与该提交 Git tree 的 blob 摘要；macOS 使用 Git 获取并校验同一提交。构建所需 Node.js 从官方源下载并核对源码中固定的 SHA-256；不要求预装 Node.js 或 npm。首次引导信任 GitHub HTTPS 与仓库维护者，这些摘要用于完整性校验，不代表独立数字签名。

安装包由本机生成，不从其他网站下载插件安装包。Windows 注册服务时会请求管理员权限；临时构建目录在完成后清理，账号和会话不进入构建包。需要能访问 GitHub 和依赖下载地址；下载失败会停止安装。

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

## 源码结构

```text
biuuka-partner/
├── core/             本机服务、权限、状态、端口、CLI、更新与进程管理
├── chatgpt/          ChatGPT 账号、额度、本机 Codex 桥接与糖果等测试
├── network/          网络检测与授权范围内的信息采集
├── web/
│   ├── console/      本机管理控制台、网站授权页面与连接 SDK
│   └── test/         糖果／鹈鹕等测试页面
├── tray/             Windows／macOS 原生托盘与控制
├── scripts/
│   ├── install/      GitHub 引导、平台安装、服务注册、卸载和离线准备
│   └── test.mjs      隔离测试启动入口
├── tests/            自动测试、原生脚本检查与测试夹具
├── assets/           插件图标及品牌资源
├── vendor/           随附第三方实现、来源记录与许可证
├── package.mjs       生成可复现的安装包
├── release.json      版本、渠道、协议与仓库元数据
├── release.mjs       统一读取版本元数据
├── sources.json      固定的第三方依赖地址与摘要
├── README.md
└── LICENSE
```

扩展时按功能归属维护：ChatGPT 账号和模型测试放入 `chatgpt`，网络能力放入 `network`；服务生命周期、本机状态和权限边界由 `core` 统一处理。后续若增加设备管理，应沿用这层服务与权限边界，但目前没有完整的跨设备管理功能。界面放在对应 `web` 页面，托盘只调用相同的本机控制接口，不另建一套管理权限。

源码按上述模块组织，安装包仍使用兼容的运行文件布局，由 `package.mjs` 统一映射，目录整理不会改写用户已有账号、会话或安装数据。

## 开发与打包

构建使用 Node.js 24，无需先安装 npm 依赖；打包后安装程序按固定来源及摘要下载运行依赖。

```sh
node scripts/test.mjs
node package.mjs --output ./dist
```

生成 `biuuka.zip`、Windows／macOS 安装程序、卸载脚本、SHA-256 摘要和 `latest.json`。`dist/` 不提交到源码仓库。

版本、渠道及更新协议统一在 `release.json` 维护，运行接口与安装包读取同一版本。`development` 表示开发渠道，`stable` 表示正式渠道；更新协议变更需同步处理客户端兼容性，不能只修改数字。低于 `1.0.0` 时只同步源码，开发迭代由提交与构建摘要区分；从 `1.0.0` 起才允许创建标签和 GitHub Release，已发布版本不得覆盖为不同内容。

Windows 原生检查使用 `tests/windows.test.ps1`，还需编译 `scripts/install/Service.cs`；macOS 托盘依赖 Cocoa，需在对应系统上验收。运行真实插件可能访问本机账户和网络，自动测试应使用隔离夹具。

## 许可

采用 [MIT License](LICENSE)。随附 WebSocket 实现的第三方许可见 [第三方许可](vendor/ws/WS-LICENSE)，来源记录见 [来源记录](vendor/ws/WS-SOURCE.json)。

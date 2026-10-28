import {VERSION, RELEASE} from './release.mjs';
import { mkdir, readFile, writeFile, cp, rm, mkdtemp, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { deflateRawSync, crc32 } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const here = path.dirname(fileURLToPath(import.meta.url));
const runtimeFiles = ['release.mjs','release.json','desktop-switch.mjs','desktop-switch.ps1','desktop-switch-macos.js','accounts.mjs','tray-control.mjs','local-profile.mjs','uninstall.mjs','uninstall-windows.ps1','chatgpt-install.mjs','chatgpt-install.ps1','brand.svg','brand.png','brand.ico','merchant.mjs','subscription.mjs','version.mjs','tray.mjs','tray-macos.js','tray-windows.ps1','live.mjs','ports.mjs','ws.cjs','WS-LICENSE','WS-SOURCE.json','access.mjs','control.mjs','console.html','console.js','console.css','pair.html','external-sdk.js','network.mjs','offline.mjs','state.mjs','records.mjs','update.mjs','supervisor.mjs','launcher.mjs','LICENSE','Service.cs','app.js','bridge.mjs','cli.mjs','index.html','mac-service.mjs','pair.js','run.ps1','runtime.mjs','server.mjs','setup.mjs','sources.json','style.css','windows.ps1'];
export const sourceFiles = {
  "accounts.mjs": "chatgpt/accounts.mjs",
  "bridge.mjs": "chatgpt/bridge.mjs",
  "records.mjs": "chatgpt/records.mjs",
  "subscription.mjs": "chatgpt/subscription.mjs",
  "local-profile.mjs": "chatgpt/local-profile.mjs",
  "desktop-switch.mjs": "chatgpt/desktop-switch.mjs",
  "desktop-switch.ps1": "chatgpt/desktop-switch.ps1",
  "desktop-switch-macos.js": "chatgpt/desktop-switch-macos.js",
  "chatgpt-install.mjs": "chatgpt/chatgpt-install.mjs",
  "chatgpt-install.ps1": "chatgpt/chatgpt-install.ps1",
  "network.mjs": "network/network.mjs",
  "access.mjs": "core/access.mjs",
  "control.mjs": "core/control.mjs",
  "live.mjs": "core/live.mjs",
  "ports.mjs": "core/ports.mjs",
  "state.mjs": "core/state.mjs",
  "runtime.mjs": "core/runtime.mjs",
  "server.mjs": "core/server.mjs",
  "cli.mjs": "core/cli.mjs",
  "launcher.mjs": "core/launcher.mjs",
  "supervisor.mjs": "core/supervisor.mjs",
  "update.mjs": "core/update.mjs",
  "version.mjs": "core/version.mjs",
  "merchant.mjs": "core/merchant.mjs",
  "tray.mjs": "tray/tray.mjs",
  "tray-control.mjs": "tray/tray-control.mjs",
  "tray-macos.js": "tray/tray-macos.js",
  "tray-windows.ps1": "tray/tray-windows.ps1",
  "Service.cs": "scripts/install/Service.cs",
  "install-macos.sh": "scripts/install/install-macos.sh",
  "setup.mjs": "scripts/install/setup.mjs",
  "windows.ps1": "scripts/install/windows.ps1",
  "run.ps1": "scripts/install/run.ps1",
  "mac-service.mjs": "scripts/install/mac-service.mjs",
  "offline.mjs": "scripts/install/offline.mjs",
  "uninstall.mjs": "scripts/install/uninstall.mjs",
  "uninstall-windows.ps1": "scripts/install/uninstall-windows.ps1",
  "console.html": "web/console/console.html",
  "console.css": "web/console/console.css",
  "console.js": "web/console/console.js",
  "pair.html": "web/console/pair.html",
  "pair.js": "web/console/pair.js",
  "external-sdk.js": "web/console/external-sdk.js",
  "index.html": "web/test/index.html",
  "style.css": "web/test/style.css",
  "app.js": "web/test/app.js",
  "brand.svg": "assets/brand.svg",
  "brand.png": "assets/brand.png",
  "brand.ico": "assets/brand.ico",
  "ws.cjs": "vendor/ws/ws.cjs",
  "WS-LICENSE": "vendor/ws/WS-LICENSE",
  "WS-SOURCE.json": "vendor/ws/WS-SOURCE.json",
  "live.test.mjs": "tests/live.test.mjs",
  "records-update.test.mjs": "tests/records-update.test.mjs",
  "local-profile.test.mjs": "tests/local-profile.test.mjs",
  "version.test.mjs": "tests/version.test.mjs",
  "subscription.test.mjs": "tests/subscription.test.mjs",
  "control.test.mjs": "tests/control.test.mjs",
  "uninstall.test.mjs": "tests/uninstall.test.mjs",
  "merchant.test.mjs": "tests/merchant.test.mjs",
  "tray-refresh.test.mjs": "tests/tray-refresh.test.mjs",
  "tray-state.test.ps1": "tests/tray-state.test.ps1",
  "network.test.mjs": "tests/network.test.mjs",
  "local.test.mjs": "tests/local.test.mjs",
  "accounts.test.mjs": "tests/accounts.test.mjs",
  "tray.test.mjs": "tests/tray.test.mjs",
  "desktop-switch.test.ps1": "tests/desktop-switch.test.ps1",
  "windows.test.ps1": "tests/windows.test.ps1",
  "install.test.mjs": "tests/install.test.mjs",
  "pairing.test.mjs": "tests/pairing.test.mjs",
  "chatgpt-install.test.mjs": "tests/chatgpt-install.test.mjs",
  "desktop-switch.test.mjs": "tests/desktop-switch.test.mjs",
  "fake-codex.mjs": "tests/fixtures/fake-codex.mjs",
  "release.mjs": "release.mjs",
  "release.json": "release.json",
  "LICENSE": "LICENSE",
  "sources.json": "sources.json"
};
export async function runtimeBytes(name) {
  const source = sourceFiles[name];
  if (!source) throw Error('Unknown package entry: '+name);
  let bytes = await readFile(path.join(here,source));
  if (/\.(mjs|js|html|css|ps1|sh)$/.test(name)) {
    let text=bytes.toString('utf8');
    text=text.replace(/(['"])(\.{1,2}\/[^'"\n]+)\1/g,(match,quote,relative)=>{
      const resolved=path.posix.normalize(path.posix.join(path.posix.dirname(source),relative));
      const entry=Object.entries(sourceFiles).find(([,file])=>file===resolved)?.[0];
      return entry ? quote+'./'+entry+quote : match;
    });
    bytes=Buffer.from(text);
  }
  return bytes;
}
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export async function packageBiuuka({output = path.join(here,'dist')} = {}) {
  await mkdir(output, { recursive: true });
  const lockDir = path.join(output, 'package.lock'); await mkdir(lockDir);
  const stage = await mkdtemp(path.join(output, 'stage-'));
  try {
    for (const name of runtimeFiles) {
      if (name.endsWith('.ps1')) await writeFile(path.join(stage, name), '\ufeff' + (await runtimeBytes(name)).toString('utf8'));
      else await writeFile(path.join(stage, name), await runtimeBytes(name));
    }
    const build=hash(Buffer.concat(await Promise.all([...runtimeFiles].sort().map(async name=>Buffer.concat([Buffer.from(name),await readFile(path.join(stage,name))])))));
    await writeFile(path.join(stage,'build-info.json'),JSON.stringify({version:VERSION,build,updateProtocol:RELEASE.updateProtocol}));
    const packagedFiles=[...runtimeFiles,'build-info.json'];
    const archive = path.join(output, 'biuuka.zip');
    // Deterministic ZIP (UTF-8 names, fixed date), built with Node only.
    const local = [], central = []; let offset = 0;
    for (const name of [...packagedFiles].sort()) {
      const data = await readFile(path.join(stage, name)), packed = deflateRawSync(data), filename = Buffer.from(name);
      const header = Buffer.alloc(30); header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20,4); header.writeUInt16LE(0x800,6); header.writeUInt16LE(8,8); header.writeUInt16LE(23585,12);
      header.writeUInt32LE(crc32(data),14); header.writeUInt32LE(packed.length,18); header.writeUInt32LE(data.length,22); header.writeUInt16LE(filename.length,26);
      const entry = Buffer.alloc(46); entry.writeUInt32LE(0x02014b50); entry.writeUInt16LE(20,4); header.copy(entry,6,4,30); entry.writeUInt32LE(offset,42);
      local.push(header,filename,packed); central.push(entry,filename); offset += header.length + filename.length + packed.length;
    }
    const directory = Buffer.concat(central), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(packagedFiles.length,8); end.writeUInt16LE(packagedFiles.length,10); end.writeUInt32LE(directory.length,12); end.writeUInt32LE(offset,16);
    await writeFile(archive, Buffer.concat([...local,directory,end]));
    const bytes = await readFile(archive), digest = hash(bytes), b64 = bytes.toString('base64').match(/.{1,120}/g).join('\n');
    const sources = JSON.parse(await readFile(path.join(here, 'sources.json'), 'utf8'));
    const sh = (await readFile(path.join(here, sourceFiles['install-macos.sh']), 'utf8')).replace('__PACKAGE_SHA__', digest)
      .replace('__NODE_ARM64_SHA__', sources['darwin-arm64'].node.digest).replace('__NODE_X64_SHA__', sources['darwin-x64'].node.digest);
    await writeFile(path.join(output, 'install.sh'), sh + b64 + '\n', { mode: 0o755 });
    const ps = `$ErrorActionPreference='Stop'; Write-Host '[1/6] Verifying and unpacking Biuuka service files...'; $r=[IO.File]::ReadAllText($env:BIUUKA_BOOT); $m='# BIUUKA_PAYLOAD'; $b=[Convert]::FromBase64String($r.Substring($r.LastIndexOf($m)+$m.Length)); $sha=[Security.Cryptography.SHA256]::Create(); if(([BitConverter]::ToString($sha.ComputeHash($b))).Replace('-','').ToLowerInvariant() -ne '${digest}'){throw 'Package checksum mismatch'}; $d=Join-Path $env:TEMP ('biuuka-install-'+[guid]::NewGuid().ToString('N')); New-Item -ItemType Directory $d | Out-Null; [IO.File]::WriteAllBytes((Join-Path $d 'package.zip'),$b); Expand-Archive (Join-Path $d 'package.zip') (Join-Path $d 'app'); & (Join-Path $PSHOME 'powershell.exe') -NoProfile -ExecutionPolicy Bypass -File (Join-Path $d 'app/windows.ps1'); $code=$LASTEXITCODE; if($code -eq 0){Remove-Item -LiteralPath $d -Recurse -Force}else{Write-Host ('Installation failed. Diagnostic package preserved at: '+$d)}; exit $code`;
    const cmd = `@echo off\r\nsetlocal\r\nset "BIUUKA_INSTALL_SOURCE=%~1"\r\nset "BIUUKA_BOOT=%~f0"\r\nset "BIUUKA_PS=%SystemRoot%\\System32\\WindowsPowerShell\\v1.0\\powershell.exe"\r\nif exist "%SystemRoot%\\Sysnative\\WindowsPowerShell\\v1.0\\powershell.exe" set "BIUUKA_PS=%SystemRoot%\\Sysnative\\WindowsPowerShell\\v1.0\\powershell.exe"\r\n"%BIUUKA_PS%" -NoProfile -ExecutionPolicy Bypass -Command "${ps}"\r\nif errorlevel 1 exit /b %errorlevel%\r\nendlocal & set "PATH=%ProgramFiles%\\Biuuka;%PATH%"\r\nexit /b 0\r\n# BIUUKA_PAYLOAD\r\n${b64.replaceAll('\n', '\r\n')}\r\n`;
    await writeFile(path.join(output, 'install.cmd'), cmd);
    await writeFile(path.join(output,'uninstall.ps1'),'\ufeff'+await readFile(path.join(here,sourceFiles['uninstall-windows.ps1']),'utf8'));
    for (const file of ['biuuka.zip', 'install.cmd', 'install.sh','uninstall.ps1']) await writeFile(path.join(output, file + '.sha256'), `${hash(await readFile(path.join(output, file)))}  ${file}\n`);
    await writeFile(path.join(output, 'latest.json'), JSON.stringify({ version: VERSION, build, updateProtocol:1, channel: RELEASE.channel, github: RELEASE.repository, files: Object.fromEntries(await Promise.all(['install.cmd','install.sh','biuuka.zip','uninstall.ps1'].map(async name => [name, { sha256: hash(await readFile(path.join(output, name))) }]))) }, null, 2) + '\n');
    console.log(`Biuuka Windows/macOS installers: ${output}\nDependencies are downloaded only when needed; pinned checksums verified on installation.\nNo production components restarted.`);
  } finally { await rm(stage, { recursive: true, force: true }); await rm(lockDir, { recursive: true, force: true }); }
}

// macOS /var and /private/var (and linked checkouts) identify the same entry.
if (process.argv[1] && await realpath(path.resolve(process.argv[1])).catch(() => null) === await realpath(fileURLToPath(import.meta.url))) await packageBiuuka(process.argv[2] === '--output' && process.argv[3] ? {output:path.resolve(process.argv[3])} : {});

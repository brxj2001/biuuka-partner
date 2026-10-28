import {VERSION} from './release.mjs';
import {installMerchant} from './merchant.mjs';
import { readFile, writeFile, mkdir, cp, rename, rm, chmod, access, realpath, statfs } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { unload } from './mac-service.mjs';
import {stateDir,migrateState} from './state.mjs';
import { CodexBridge } from './bridge.mjs';
const here = path.dirname(fileURLToPath(import.meta.url));
const lock = JSON.parse(await readFile(path.join(here, 'sources.json'), 'utf8'));
export function supported(platform, arch) { return ['darwin', 'win32'].includes(platform) && ['arm64', 'x64'].includes(arch); }
async function downloadOne(source, target) {
  let response, bytes;
  try {
    console.log(`Downloading ${new URL(source.url).hostname}; 5-minute limit, progress every 2 seconds.`);
    const started = Date.now(); let received = 0, last = 0;
    const controller = new AbortController();
    let idle = setTimeout(() => controller.abort(), 15000);
    const deadline = setTimeout(() => controller.abort(), 300000);
    const heartbeat = setInterval(() => console.log(`Download active: ${(received / 1048576).toFixed(1)} MiB received, ${Math.floor((Date.now() - started) / 1000)}s elapsed`), 10000);
    try {
      response = await fetch(source.url, { signal: controller.signal });
      clearTimeout(idle);
      idle = setTimeout(() => controller.abort(), 30000);
      if (response.ok) {
        const total = Number(response.headers.get('content-length')) || 0, chunks = [];
        for await (const chunk of response.body) {
          clearTimeout(idle); idle = setTimeout(() => controller.abort(), 30000);
          chunks.push(chunk); received += chunk.length;
          if (Date.now() - last >= 2000) {
            const progress = total ? Math.min(100, Math.floor(received / total * 100)) : 0;
            const percent = total ? ` [${'#'.repeat(Math.floor(progress / 5)).padEnd(20, '-')} ${progress}%]` : '';
            console.log(`Download${percent}: ${(received / 1048576).toFixed(1)} MiB${total ? ' / ' + (total / 1048576).toFixed(1) + ' MiB' : ''}; ${Math.floor((Date.now() - started) / 1000)}s`);
            last = Date.now();
          }
        }
        bytes = Buffer.concat(chunks);
        console.log(`Download complete: ${(received / 1048576).toFixed(1)} MiB. Verifying checksum...`);
      }
    } finally { clearInterval(heartbeat); clearTimeout(idle); clearTimeout(deadline); }
  } catch {
    // Native curl also supports the user's configured HTTPS proxy. Some
    // environments permit it while Node's direct TLS connection is unavailable.
    console.log('Direct download interrupted; retrying with system curl (progress below, at most 5 minutes).');
    const partial = target + '.download';
    try {
      const r = spawnSync('curl', ['--fail', '--location', '--progress-bar', '--show-error', '--speed-limit', '1024', '--speed-time', '30', '--connect-timeout', '15', '--max-time', '300', '--output', partial, source.url], { stdio: 'inherit', windowsHide: true, timeout: 310000 });
      if (r.status !== 0) throw Error('Dependency download failed. Check network/proxy access to official Node.js and npm distribution sites.');
      bytes = await readFile(partial);
    } finally { await rm(partial, { force: true }); }
  }
  if (!bytes) throw Error(`Download failed (${response?.status ?? 'network'}): ${source.url}`);
  if (createHash(source.algorithm).update(bytes).digest(source.encoding || 'hex') !== source.digest) throw Error('Dependency checksum mismatch');
  await writeFile(target, bytes, { mode: 0o600 });
}
export async function download(source,target){
  const valid=bytes=>createHash(source.algorithm).update(bytes).digest(source.encoding||'hex')===source.digest;
  if(source.cacheFile){
    for(const folder of [process.env.BIUUKA_OFFLINE_DIR,path.join(stateDir,'cache')].filter(Boolean)){
      try{const bytes=await readFile(path.join(folder,source.cacheFile));if(!valid(bytes))throw Error('checksum');await writeFile(target,bytes,{mode:0o600});console.log('Verified local cache: '+source.cacheFile);return {source:'local-cache',verified:true};}catch(e){if(e.message==='checksum')console.log('Ignoring cache with an invalid checksum.');}
    }
  }
  if(process.env.BIUUKA_OFFLINE_ONLY==='1')throw Error('Offline dependency is missing or corrupt: '+source.cacheFile);
  let last;
  for(const url of [...(source.mirrors||[]),source.url]){
    try{await downloadOne({...source,url},target);if(source.cacheFile){await mkdir(path.join(stateDir,'cache'),{recursive:true,mode:0o700});await cp(target,path.join(stateDir,'cache',source.cacheFile));}return {source:new URL(url).hostname,verified:true};}
    catch(e){last=e;console.log('Source failed: '+new URL(url).hostname+'; trying the next verified source.');}
  }
  throw last;
}
const version = (exe, pattern) => { const r = spawnSync(exe, ['--version'], { encoding: 'utf8', windowsHide: true, timeout: 10000 }); return r.status === 0 && pattern.test(r.stdout.trim()); };
const shellQuote = text => "'" + text.replaceAll("'", "'\\''") + "'";
export async function prepare(finalDir) {
  if (!supported(process.platform, process.arch)) throw Error('Supported: Windows x64/ARM64 and macOS Intel/Apple Silicon.');
  const disk = await statfs(here);
  if (disk.bavail * disk.bsize < 1.5 * 1024 ** 3) throw Error('At least 1.5 GB of free installation space is required.');
  const sources = lock[`${process.platform}-${process.arch}`];
  await migrateState();
  const state = stateDir;
  const settingsFile = path.join(state, 'config.json');
  let previous = {}; try { previous = JSON.parse(await readFile(settingsFile, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  let codex = process.env.BIUUKA_CODEX || 'codex';
  let bundled = false;
  if (!version(codex, /^codex-cli 0\.163\.0$/) && previous.codex && version(previous.codex, /^codex-cli 0\.163\.0$/)) codex = previous.codex;
  if (version(codex, /^codex-cli 0\.163\.0$/)) {
    if (!path.isAbsolute(codex)) {
      const result = spawnSync(process.platform === 'win32' ? 'where.exe' : '/usr/bin/which', [codex], { encoding: 'utf8', windowsHide: true });
      codex = result.stdout.trim().split(/\r?\n/)[0];
    }
    // npm command shims cannot be spawned without a shell. Use a native binary instead.
    if (!codex || /\.(cmd|bat|ps1)$/i.test(codex)) codex = '';
  } else codex = '';
  const managedDir=process.platform==='darwin'&&codex?.startsWith(path.join(os.homedir(),'.local/share/biuuka/app')+path.sep)?path.join(os.homedir(),'.local/share/biuuka/app'):finalDir;
  if (codex && codex.startsWith(managedDir + path.sep)) {
    const relative = path.relative(managedDir, codex);
    if (!relative.startsWith('runtime' + path.sep + 'package' + path.sep)) throw Error('Unexpected managed Codex path');
    await cp(path.join(managedDir, 'runtime/package'), path.join(here, 'runtime/package'), { recursive: true });
    codex = path.join(here, relative); bundled = true;
  }
  if (!codex) {
    console.log('[3/6] Preparing native Codex 0.163.0 (npm is not required)...');
    const runtime = path.join(here, 'runtime'); await mkdir(runtime, { recursive: true });
    const archive = path.join(runtime, 'codex.tgz');
    const origin=await download(sources.codex, archive);
    await writeFile(path.join(state,'codex-source.json'),JSON.stringify({...origin,checkedAt:new Date().toISOString()}),{mode:0o600});
    console.log('Checksum verified. Extracting Codex (up to 60 seconds)...');
    const listing = spawnSync('tar', ['-tzf', archive], { encoding: 'utf8', windowsHide: true, timeout: 60000, maxBuffer: 8 * 1024 * 1024 });
    if (listing.status !== 0 || listing.stdout.trim().split('\n').some(n => !n.startsWith('package/') || n.split('/').includes('..'))) throw Error('Unsafe Codex archive layout');
    const unpack = spawnSync('tar', ['-xzf', archive, '-C', runtime], { stdio: 'inherit', windowsHide: true, timeout: 60000 });
    if (unpack.status !== 0) throw Error('Codex extraction failed');
    await rm(archive);
    codex = path.join(runtime, 'package', sources.binary);
    if (!version(codex, /^codex-cli 0\.163\.0$/)) throw Error('Native Codex is not compatible with this operating system');
    bundled = true;
  }
  console.log('[3/6] Codex executable verified and ready.');
  const home = path.resolve(process.env.CODEX_HOME || previous.codexHome || path.join(os.homedir(), '.codex'));
  const nodeRelative = path.relative(here, process.execPath);
  const bundledNode = !path.isAbsolute(nodeRelative) && !nodeRelative.startsWith('..' + path.sep);
  const source=installMerchant(process.env.BIUUKA_INSTALL_SOURCE,previous.merchant);
  console.log('Installation source: '+source.name+' ('+source.url+')');
  const config = { merchant:source, version: VERSION, baseDir:finalDir, node: bundledNode ? path.join(finalDir, nodeRelative) : process.execPath,
    codex: bundled ? path.join(finalDir, path.relative(here, codex)) : codex, codexHome: home, port: previous.port || 17322, work: path.join(state, 'work') };
  await writeFile(path.join(here, 'install-config.json'), JSON.stringify(config), { mode: 0o600 });
  console.log(`Environment ready: ${process.platform}/${process.arch}; Codex home: ${home}`);
  process.env.CODEX_HOME = home;
  console.log('[4/6] Checking existing Codex login (each request limited to 20 seconds; no test conversation is sent)...');
  if(process.env.BIUUKA_OFFLINE_ONLY==='1'){console.log('Offline installation: account checks will run when a network is available.');return {state,config};}
  const probe = new CodexBridge({ command: codex, cwd: here, timeout: 20000 });
  try { await probe.initialize(); console.log('Existing ChatGPT account is readable.'); }
  catch { console.log('ChatGPT account is not yet confirmed. After installation run: biuuka login (or biuuka doctor to diagnose network/configuration).'); }
  finally { probe.close(); }
  return { state, config };
}
export async function installMac() {
  if (process.platform !== 'darwin' || process.getuid() === 0) throw Error('Run as your normal macOS user, without sudo.');
  const finalDir = path.join(stateDir, 'base');
  const backup = finalDir + '.replacing';
  try { await access(backup); throw Error('Interrupted upgrade found; inspect ' + backup); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  const { state, config } = await prepare(finalDir);
  await mkdir(state, { recursive: true, mode: 0o700 }); await mkdir(config.work, { recursive: true, mode: 0o700 });
  const lockDir = path.join(state, 'install.lock'); await mkdir(lockDir);
  let old = false, switched = false, oldConfig;
  const configFile = path.join(state, 'config.json');
  try {
    try { oldConfig = await readFile(configFile); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    await unload();
    await rm(path.join(state,'app'),{recursive:true,force:true});
    await mkdir(path.dirname(finalDir), { recursive: true });
    try { await rename(finalDir, backup); old = true; } catch (e) { if (e.code !== 'ENOENT') throw e; }
    switched = true; await cp(here, finalDir, { recursive: true });
    await writeFile(configFile, JSON.stringify(config), { mode: 0o600 });
    const bin = path.join(os.homedir(), '.local/bin'); await mkdir(bin, { recursive: true });
    await writeFile(path.join(bin, 'biuuka'), `#!/bin/sh\nexec ${shellQuote(config.node)} ${shellQuote(path.join(finalDir, 'launcher.mjs'))} "$@"\n`, { mode: 0o755 });
    await chmod(path.join(bin, 'biuuka'), 0o755);
    const launch = spawnSync(config.node, [path.join(finalDir, 'cli.mjs'), 'install-service'], { stdio: 'inherit' });
    if (launch.status !== 0) throw Error('launchd registration or health check failed');
    for (const profile of ['.zprofile', '.profile']) {
      const file = path.join(os.homedir(), profile); let text = ''; try { text = await readFile(file, 'utf8'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
      if (!text.includes('# Biuuka PATH')) await writeFile(file, text + '\n# Biuuka PATH\nexport PATH="$HOME/.local/bin:$PATH"\n');
    }
    await rm(backup, { recursive: true, force: true });
    console.log('Biuuka installed and running. New terminals: biuuka status / biuuka open');
    spawnSync(config.node, [path.join(finalDir, 'cli.mjs'), 'doctor'], { stdio: 'inherit' });
    console.log('If account verification failed: biuuka login. No chat request was sent during installation.');
    spawnSync(config.node,[path.join(finalDir,'cli.mjs'),'open'],{stdio:'ignore'});
  } catch (e) {
    await unload();
    if (switched) await rm(finalDir, { recursive: true, force: true });
    if (old) { await rename(backup, finalDir); if (oldConfig) await writeFile(configFile, oldConfig, { mode: 0o600 }); spawnSync(process.execPath, [path.join(finalDir, 'cli.mjs'), 'install-service'], { stdio: 'ignore' }); }
    throw e;
  } finally { await rm(lockDir, { recursive: true, force: true }); }
}
if (process.argv[1] && await realpath(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { if (process.argv[2] === 'prepare') await prepare(process.argv[3]); else await installMac(); }
  catch (e) { console.error('Biuuka installation failed:', e.message); process.exitCode = 1; }
}

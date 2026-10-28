import { readFile, writeFile, mkdir, rename, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CodexBridge } from '../chatgpt/bridge.mjs';
import {stateDir,migrateState} from './state.mjs';
import {listenAvailable} from './ports.mjs';
import {createControl} from './control.mjs';
import {createLocalProfile} from '../chatgpt/local-profile.mjs';
import {createDesktopSwitch} from '../chatgpt/desktop-switch.mjs';
import {createAccounts} from '../chatgpt/accounts.mjs';
import {Records} from '../chatgpt/records.mjs';
export {stateDir} from './state.mjs';
import { createServer, VERSION } from './server.mjs';

export const appDir = path.dirname(fileURLToPath(import.meta.url));
export const configFile = path.join(stateDir, 'config.json');
export const runtimeFile = path.join(stateDir, 'runtime.json');
export async function config() {
  await migrateState();
  const c = JSON.parse(await readFile(configFile, 'utf8'));
  c.work=path.join(stateDir,'work');
  if (!path.isAbsolute(c.codexHome) || !path.isAbsolute(c.codex) || !Number.isInteger(c.port) || c.port < 1024 || c.port > 65535) throw Error('Invalid Biuuka configuration. Run the installer again.');
  return c;
}
export async function writePrivate(file, value) {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = file + '.' + randomBytes(8).toString('hex');
  await writeFile(tmp, JSON.stringify(value, null, 2), { mode: 0o600 });
  await rename(tmp, file);
}
export function applyHome(c) { process.env.CODEX_HOME = c.codexHome; }
export function makeBridge(c) { applyHome(c); return new CodexBridge({ command: c.codex, cwd: c.work, codexHome: c.codexHome }); }
export async function serve() {
  const c = await config(); applyHome(c);
  await mkdir(c.work, { recursive: true, mode: 0o700 });
  const token = randomBytes(32).toString('hex');
  const records=new Records(stateDir);await records.recover();
  const control=await createControl({state:stateDir,config:c,appDir});
  const accounts=createAccounts({state:stateDir,codexHome:c.codexHome,desktop:createDesktopSwitch({codexHome:c.codexHome}),bridgeFactory:home=>new CodexBridge({command:c.codex,cwd:c.work,codexHome:home,timeout:360000}),online:()=>control.enabled()&&control.online()});
  const {server,port}=await listenAvailable(port=>createServer({accounts,localProfile:createLocalProfile(c.codexHome,stateDir),control,token,port,bridgeFactory:()=>makeBridge(c),records}),c.port);
  await writePrivate(runtimeFile, { token, port, pid: process.pid, version: VERSION });
  // This runs in the install user's interactive process, including upgrades from
  // older supervisors. Never start a tray that the user deliberately exited.
  const uiTimer=setTimeout(async()=>{
    try{
      const {restoreTrayAfterUpdate}=await import('../tray/tray-control.mjs');
      if(await restoreTrayAfterUpdate(stateDir,async()=>{const {startTray}=await import('../tray/tray.mjs');await startTray();}))return;
      const build=await readFile(path.join(appDir,'build-info.json'),'utf8').then(JSON.parse).then(v=>v.build);
      const trayBuild=await readFile(path.join(stateDir,'tray-instance.json'),'utf8').then(JSON.parse).then(v=>v.build).catch(()=>null);
      if(!build||build===trayBuild)return;
      const {refreshRunningTray}=await import('../tray/tray-control.mjs');
      await refreshRunningTray(stateDir,async()=>{const {startTray}=await import('../tray/tray.mjs');await startTray();});
    }catch{await writePrivate(path.join(stateDir,'tray-update-status.json'),{status:'retry_from_console',at:new Date().toISOString()}).catch(()=>{});}
  },2000);uiTimer.unref();

  await rm(path.join(stateDir, 'last-error.json'), { force: true });
  const stop = () => { server.closeAllConnections(); server.close(()=>{if(process.connected)process.disconnect();}); };
  process.on('disconnect',stop);
  let preparing=false;
  process.on('message', message=>{
    if(message?.type!=='prepare-update'||preparing||!server.canPrepareUpdate())return;
    preparing=true;clearTimeout(uiTimer);
    void (async()=>{
      const {prepareTrayForUpdate,restoreTrayAfterUpdate}=await import('../tray/tray-control.mjs');
      try{
        await prepareTrayForUpdate(stateDir);
        if(!server.prepareUpdate()){
          await restoreTrayAfterUpdate(stateDir,async()=>{const {startTray}=await import('../tray/tray.mjs');await startTray();});
          return;
        }
        server.closeAllConnections();server.close(()=>process.exit(0));
      }catch{
        await writePrivate(path.join(stateDir,'tray-update-status.json'),{status:'tray_stop_failed',at:new Date().toISOString()}).catch(()=>{});
      }finally{preparing=false;}
    })();
  });
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
}
export async function localRequest(route, body) {
  const r = JSON.parse(await readFile(runtimeFile, 'utf8'));
  const base = `http://127.0.0.1:${r.port}`;
  const response = await fetch(base + route, { method: body ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${r.token}`, Origin: base, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(200000) });
  if (!response.ok) { const error = await response.json(); throw Error(error.error || 'Local service unavailable'); }
  return response;
}
export function run(file, args, options = {}) {
  const r = spawnSync(file, args, { stdio: 'inherit', windowsHide: true, ...options });
  if (r.error || r.status !== 0) throw Error(`Command failed: ${path.basename(file)} (${r.status ?? 'unavailable'})`);
}
export function openUrl(url) {
  if (process.platform === 'darwin') run('/usr/bin/open', [url]);
  else run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Start-Process '${url.replaceAll("'", "''")}'`]);
}
export async function waitHealthy() {
  for (let i = 0; i < 40; i++) {
    try { const h = await (await localRequest('/health')).json(); if (h.service === 'biuuka' && h.version === VERSION) return h; } catch {}
    await new Promise(r => setTimeout(r, 500));
  }
  throw Error('Biuuka health check failed. Run biuuka doctor.');
}

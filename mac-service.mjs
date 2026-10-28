import { writeFile, mkdir, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { appDir, config, stateDir, run } from './runtime.mjs';
export const label = 'com.biuuka.service';
export const xml = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
export async function unload() {
  const target = `gui/${process.getuid()}/${label}`;
  spawnSync('/bin/launchctl', ['bootout', target], { stdio: 'ignore' });
  for (let i = 0; i < 100; i++) {
    if (spawnSync('/bin/launchctl', ['print', target], { stdio: 'ignore' }).status !== 0) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw Error('launchd is still stopping Biuuka. No replacement was started.');
}
export function plist(node, cli, state, home) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict>
<key>Label</key><string>${label}</string><key>ProgramArguments</key><array><string>${xml(node)}</string><string>${xml(cli)}</string></array>
<key>EnvironmentVariables</key><dict><key>BIUUKA_STATE</key><string>${xml(state)}</string><key>CODEX_HOME</key><string>${xml(home)}</string></dict>
<key>RunAtLoad</key><true/><key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict><key>ThrottleInterval</key><integer>30</integer>
<key>WorkingDirectory</key><string>${xml(state)}</string><key>ProcessType</key><string>Background</string><key>Umask</key><integer>63</integer>
</dict></plist>`;
}
export async function macService(action) {
  const domain = `gui/${process.getuid()}`, target = `${domain}/${label}`;
  const file = path.join(os.homedir(), 'Library/LaunchAgents', label + '.plist');
  if(action==='uninstall'){await (await import('./uninstall.mjs')).uninstallMac(await config(),stateDir);return;}
  if(action==='stop'){
    // Persist the requested state before bootout terminates our own service job.
    run('/bin/launchctl',['disable',target]);

    await unload();return;
  }
  if(['restart','install-service'].includes(action))await unload();
  if (action === 'install-service') {
    const c = await config(); await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, plist(c.node, path.join(c.baseDir||appDir, 'supervisor.mjs'), stateDir, c.codexHome), { mode: 0o600 });
  }
  run('/bin/launchctl', ['enable', target]);
  const loaded = spawnSync('/bin/launchctl', ['print', target], { stdio: 'ignore' }).status === 0;
  if (!loaded) run('/bin/launchctl', ['bootstrap', domain, file]);
  run('/bin/launchctl', ['kickstart', target]);
  if(action==='install-service')await (await import('./tray.mjs')).installMacTray();
}

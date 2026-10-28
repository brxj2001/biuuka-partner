import {VERSION} from '../release.mjs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { appDir, stateDir, writePrivate, config, applyHome, makeBridge, serve, runtimeFile, localRequest, run, openUrl, waitHealthy } from './runtime.mjs';
import { macService } from '../scripts/install/mac-service.mjs';

const [action = 'help', ...args] = process.argv.slice(2);
const help = `Biuuka ${VERSION} — local Codex service
biuuka status | doctor | start | stop | restart | open
biuuka tray (open native tray; closing it leaves the service running)
biuuka service-exit (fully exits the control service)
biuuka login | account | quota | models | history
biuuka test pelican|candy [model] [effort]
biuuka chat "your prompt" [model] [effort]
biuuka resume <thread-id>
biuuka records | record <id> | delete-record <id>
biuuka network
biuuka offline-pack <win32-x64|win32-arm64|darwin-x64|darwin-arm64> <directory>
biuuka auto-update on|off
biuuka notifications on|off
biuuka permissions | revoke <grant-id> | clear-cache
biuuka uninstall
Account data stays on this computer. Login opens the official Codex login flow.`;
try {
  if (['help', '--help', '-h'].includes(action)) console.log(help);
  else if(['tray','tray-run','tray-action'].includes(action)){const tray=await import('../tray/tray.mjs');if(action==='tray')await tray.startTray();else if(action==='tray-run')await tray.runTray();else await tray.trayAction(args[0]);}
  else if(['auto-update','notifications'].includes(action)){if(!['on','off'].includes(args[0]))throw Error('Choose on or off');console.log(await(await localRequest('/control/settings',{[action==='auto-update'?'autoUpdate':'notifications']:args[0]==='on'})).json());}
  else if(action==='permissions')console.log((await(await localRequest('/control/status',{})).json()).grants);
  else if(action==='revoke'){if(!args[0])throw Error('Provide a grant ID');console.log(await(await localRequest('/control/grants/revoke',{id:args[0]})).json());}
  else if(action==='clear-cache')console.log(await(await localRequest('/control/cache/clear',{})).json());
  else if (action === 'network') console.log(JSON.stringify(await (await localRequest('/network', {})).json(), null, 2));
  else if (action === 'offline-pack') { const {offlinePack}=await import('../scripts/install/offline.mjs');await offlinePack(args[0],args[1]); }
  else if (action === 'serve') await serve();
  else if(action==='stop'){console.log(await(await localRequest('/control/engine',{enabled:false})).json());console.log('Codex paused; local control remains online. Resume: biuuka start');}
  else if(action==='start'){try{await localRequest('/health');}catch{if(process.platform==='darwin')await macService('start');else run('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join((await config()).baseDir||appDir,'windows.ps1'),'-Action','start']);await waitHealthy();}console.log(await(await localRequest('/control/engine',{enabled:true})).json());}
  else if(action==='service-exit'){if(process.platform==='darwin')await macService('stop');else run('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join((await config()).baseDir||appDir,'windows.ps1'),'-Action','stop']);}
  else if (['start', 'stop', 'restart', 'install-service', 'uninstall'].includes(action)) {
    if (process.platform === 'darwin') await macService(action);
    else run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(action==='uninstall'?appDir:(await config()).baseDir||appDir, 'windows.ps1'), '-Action', action]);
    if (['start', 'restart', 'install-service'].includes(action)) console.log(await waitHealthy());
  } else if (action === 'open') {
    await waitHealthy(); const r = JSON.parse(await readFile(runtimeFile, 'utf8'));
    openUrl(`http://127.0.0.1:${r.port}/console`);
  } else if (action === 'status') console.log(await (await localRequest('/health')).json());
  else if (action === 'doctor') {
    const c = await config();
    const running=await readFile(runtimeFile,'utf8').then(JSON.parse).catch(()=>null);
    console.log(JSON.stringify({ configuredPort:c.port, platform: process.platform, architecture: process.arch, node: process.version, codex: c.codex, codexHome: c.codexHome, work: c.work, port: running?.port||c.port }, null, 2));
    run(c.codex, ['--version']);
    try { console.log('Service:', await (await localRequest('/health')).json()); } catch {
      console.log('Service: not responding');
      try { const last = JSON.parse(await readFile(path.join(stateDir, 'last-error.json'), 'utf8')); console.log('Last startup:', { code: last.code, time: last.time }); } catch {}
    }
    const b = makeBridge(c); try {
      await b.initialize(); console.log('ChatGPT account: readable');
      const p = await b.profile(); console.log('Quota endpoint:', p.limitsStatus);
    } finally { b.close(); }
  } else if (['login', 'resume'].includes(action)) {
    const c = await config(); applyHome(c);
    if (action === 'resume' && !/^[a-zA-Z0-9_-]{1,100}$/.test(args[0] || '')) throw Error('A valid thread ID is required');
    run(c.codex, action === 'login' ? ['login'] : ['resume', args[0]], { cwd: c.work });
    if (action === 'login') { const b = makeBridge(c); try { await b.initialize(); console.log('ChatGPT account verified.'); } finally { b.close(); } }
  } else if (['account', 'quota', 'models', 'history'].includes(action)) {
    const result = await (await localRequest('/' + (action === 'quota' ? 'account' : action), {})).json();
    console.log(JSON.stringify(action === 'quota' ? { limitsStatus: result.limitsStatus, limits: result.limits } : result, null, 2));
  } else if (['chat', 'test'].includes(action)) {
    if (!args[0]) throw Error(action === 'chat' ? 'Provide a prompt.' : 'Choose pelican or candy.');
    const { models } = await (await localRequest('/models', {})).json();
    const model = args[1] ? models.find(m => m.model === args[1]) : models.find(m => m.isDefault) || models[0];
    if (!model) throw Error('Model unavailable');
    const body = { model: model.model, effort: args[2] || model.defaultEffort, [action === 'chat' ? 'prompt' : 'preset']: args[0] };
    const response = await localRequest(action === 'chat' ? '/chat' : '/test', body);
    let pending = '', done = false;
    for await (const chunk of response.body.pipeThrough(new TextDecoderStream())) {
      pending += chunk;
      let i; while ((i = pending.indexOf('\n')) >= 0) {
        const e = JSON.parse(pending.slice(0, i)); pending = pending.slice(i + 1);
        if (e.type === 'delta') process.stdout.write(e.text);
        if (e.type === 'error') throw Error(e.error);
        if (e.type === 'thread' && e.saved) console.log(`\nSaved: ${e.threadId}\nOpen: codex://threads/${e.threadId}`);
        if (e.type === 'done') done = true;
      }
    }
    if (!done) throw Error('Connection interrupted. No automatic retry.');
  } else throw Error(help);
} catch (e) {
  if (action === 'serve') {
    const code = ['EADDRINUSE', 'EACCES', 'ENOENT'].includes(e.code) ? e.code : 'service_start_failed';
    await writePrivate(path.join(stateDir, 'last-error.json'), { code, time: new Date().toISOString() }).catch(() => {});
  }
  console.error(`Biuuka: ${e.message}`); process.exitCode = 1;
}

import {readFile,writeFile,lstat,realpath,unlink} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
const quote=s=>"'"+s.replaceAll("'","'\\''")+"'";
const contains=(a,b)=>b===a||b.startsWith(a+path.sep);
async function physical(p){try{return await realpath(p);}catch(e){if(e.code!=='ENOENT')throw e;const parent=path.dirname(p);if(parent===p)throw e;return path.join(await physical(parent),path.basename(p));}}
export async function macCleanupPlan({home,state,base,codexHome,extraCodexHome}){
 home=path.resolve(home);state=path.resolve(state);base=path.resolve(base);
 const roots=[path.join(home,'.biuuka'),path.join(home,'.local/share/biuuka'),path.join(home,'Library/Application Support/Biuuka')];
 if(state!==roots[0]||![path.join(state,'base'),path.join(state,'app'),path.join(roots[1],'app')].includes(base))throw Error('Unrecognized Biuuka installation; refusing automatic deletion.');
 const protectedPaths=await Promise.all([path.join(home,'.codex'),codexHome,extraCodexHome].filter(Boolean).map(p=>physical(path.resolve(p))));
 for(const root of roots){const resolved=await physical(root);if(resolved!==path.join(await physical(home),path.relative(home,root)))throw Error('Biuuka directory contains a link; refusing automatic deletion.');
  for(const protectedPath of protectedPaths)if(contains(resolved,protectedPath)||contains(protectedPath,resolved))throw Error('Codex data overlaps Biuuka cleanup; move it outside Biuuka before uninstalling.');
 }
 return {home,roots};
}
export function ownedTray(command,node,folders){return folders.some(folder=>command===`${node} ${path.join(folder,"launcher.mjs")} tray-run`||command===`${node} ${path.join(folder,"cli.mjs")} tray-run`||command.startsWith(`/usr/bin/osascript -l JavaScript ${path.join(folder,"tray-macos.js")} `));}
export function macCleanupScript(plan,{uid,script,processes=[],cleanupLabel}){
 const home=plan.home,roots=plan.roots.map(quote).join(' '),service=`gui/${uid}/com.biuuka.service`,tray=`gui/${uid}/com.biuuka.tray`;
 return `#!/bin/sh
set -eu
umask 077
# Runs as an independent launchd job: stopping Biuuka cannot interrupt cleanup.
sleep 2
/bin/launchctl bootout ${quote(tray)} 2>/dev/null || true
/bin/launchctl bootout ${quote(service)} 2>/dev/null || true
# Manual trays are outside launchd. Match only this installation's launcher, never Codex.
${processes.map(p=>`if [ "$(/bin/ps -p ${p.pid} -o command= 2>/dev/null || true)" = ${quote(p.command)} ]; then /bin/kill -TERM ${p.pid} 2>/dev/null || true; fi`).join("\n")}
${processes.map(p=>`if [ "$(/bin/ps -p ${p.pid} -o command= 2>/dev/null || true)" = ${quote(p.command)} ]; then sleep 2; fi`).join("\n")}
${processes.map(p=>`if [ "$(/bin/ps -p ${p.pid} -o command= 2>/dev/null || true)" = ${quote(p.command)} ]; then exit 1; fi`).join("\n")}
# Recheck launchd has actually stopped; do not remove live program files.
if /bin/launchctl print ${quote(service)} >/dev/null 2>&1 || /bin/launchctl print ${quote(tray)} >/dev/null 2>&1; then exit 1; fi
/bin/rm -f ${quote(path.join(home,'Library/LaunchAgents/com.biuuka.service.plist'))} ${quote(path.join(home,'Library/LaunchAgents/com.biuuka.tray.plist'))} ${quote(path.join(home,'.local/bin/biuuka'))}
${[...new Set(plan.roots.flatMap(root=>{const dirs=[];for(let p=path.dirname(root);p.startsWith(home);p=path.dirname(p))dirs.push(p);return dirs;}))].map(p=>`[ ! -L ${quote(p)} ] || exit 1`).join("\n")}
for dir in ${roots}; do
  [ ! -L "$dir" ] || exit 1
  /bin/rm -rf "$dir"
  [ ! -e "$dir" ] || exit 1
done
/bin/rm -f ${quote(script)}
${cleanupLabel?`/bin/launchctl remove ${quote(cleanupLabel)} 2>/dev/null || true`:""}
`;
}
export async function uninstallMac(c,state){
 const plan=await macCleanupPlan({home:os.homedir(),state,base:c.baseDir,codexHome:c.codexHome,extraCodexHome:process.env.CODEX_HOME});
 // Remove only the exact lines installed by Biuuka, preserving all other shell configuration.
 for(const name of ['.zprofile','.profile']){const file=path.join(plan.home,name);try{const stat=await lstat(file);if(!stat.isFile()||stat.isSymbolicLink())continue;const old=await readFile(file,'utf8'),next=old.replace(/\n# Biuuka PATH\nexport PATH="\$HOME\/\.local\/bin:\$PATH"\n/g,'\n');if(old!==next)await writeFile(file,next,{mode:stat.mode});}catch(e){if(e.code!=='ENOENT')throw e;}}
 const folders=[c.baseDir,path.join(state,'app')];
 const processes=spawnSync('/bin/ps',['-axo','pid=,command='],{encoding:'utf8'}).stdout.split('\n').map(line=>{const m=line.match(/^\s*(\d+)\s+(.+)$/);return m?{pid:Number(m[1]),command:m[2]}:null;}).filter(p=>p&&ownedTray(p.command,c.node,folders));
 const cleanupLabel='com.biuuka.cleanup.'+randomUUID();
 const script=path.join(os.tmpdir(),'biuuka-cleanup-'+randomUUID()+'.sh');await writeFile(script,macCleanupScript(plan,{uid:process.getuid(),script,processes,cleanupLabel}),{mode:0o700});
 const r=spawnSync('/bin/launchctl',['submit','-l',cleanupLabel,'--','/bin/sh',script],{stdio:'ignore'});
 if(r.status!==0){await unlink(script);throw Error('Unable to start independent cleanup; installation retained.');}
 console.log('Biuuka cleanup scheduled: tray, service, program and .biuuka data will be removed. Codex data is excluded.');
}

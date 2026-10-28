import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,symlink,rm,access} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import os from 'node:os';
import path from 'node:path';
import {macCleanupPlan,macCleanupScript,ownedTray} from './uninstall.mjs';
const exec=promisify(execFile);
test('cleanup refuses Codex overlap, custom roots and redirected installation directories',async()=>{
 const home=await mkdtemp(path.join(os.tmpdir(),'biuuka-uninstall-'));const state=path.join(home,'.biuuka'),base=path.join(state,'base');
 try{await mkdir(base,{recursive:true});const options={home,state,base,codexHome:path.join(home,'.codex')};assert.equal((await macCleanupPlan(options)).roots.length,3);
 await assert.rejects(macCleanupPlan({...options,codexHome:path.join(state,'codex-data')}),/overlaps/);
 await assert.rejects(macCleanupPlan({...options,state:home}),/Unrecognized/);
 await symlink(state,path.join(home,'codex-link'));await assert.rejects(macCleanupPlan({...options,codexHome:path.join(home,'codex-link')}),/overlaps/);
 await mkdir(path.join(home,'other'));await rm(state,{recursive:true});await symlink(path.join(home,'other'),state);await assert.rejects(macCleanupPlan(options),/link/);
 }finally{await rm(home,{recursive:true,force:true});}
});
test('cleanup script removes only owned fixtures and itself; Codex data and linked external data survive',async()=>{
 const home=await mkdtemp(path.join(os.tmpdir(),"biuuka-cleanup-'space-")),state=path.join(home,'.biuuka'),base=path.join(state,'base');
 try{await mkdir(base,{recursive:true});await mkdir(path.join(home,'.codex'));await writeFile(path.join(home,'.codex','auth.json'),'private-fixture');await symlink(path.join(home,'.codex'),path.join(state,'external-link'));
 const plan=await macCleanupPlan({home,state,base,codexHome:path.join(home,'.codex')});for(const root of plan.roots)await mkdir(root,{recursive:true});
 const script=path.join(home,'cleanup.sh'),stub=path.join(home,'launchctl-stub');await writeFile(stub,'#!/bin/sh\nexit 1\n',{mode:0o700});
 await writeFile(script,macCleanupScript(plan,{uid:99999,script}).replaceAll('/bin/launchctl',"'"+stub.replaceAll("'","'\\''")+"'"),{mode:0o700});
 await exec('/bin/sh',[script]);for(const root of plan.roots)await assert.rejects(access(root));await assert.rejects(access(script));assert.equal(await readFile(path.join(home,'.codex','auth.json'),'utf8'),'private-fixture');
 }finally{await rm(home,{recursive:true,force:true});}
});
test('manual tray matching never selects unrelated Node or Codex processes',()=>{
 const roots=['/home/user/.biuuka/base','/home/user/.biuuka/app'],node='/usr/local/bin/node';
 assert.equal(ownedTray(node+' '+roots[0]+'/launcher.mjs tray-run',node,roots),true);
 assert.equal(ownedTray('/usr/bin/osascript -l JavaScript '+roots[1]+'/tray-macos.js node launcher status',node,roots),true);
 for(const cmd of [node+' /other/launcher.mjs tray-run',node+' '+roots[0]+'/launcher.mjs chat', 'codex resume fixture','echo '+node+' '+roots[0]+'/launcher.mjs tray-run'])assert.equal(ownedTray(cmd,node,roots),false);
});

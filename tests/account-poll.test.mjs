import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate} from 'node:timers/promises';
import {createAccountPoll, ACCOUNT_REFRESH_MS} from '../chatgpt/account-poll.mjs';
const flush = async () => { for (let i=0;i<4;i++) await setImmediate(); };
function fixture(t, overrides={}) {
  t.mock.timers.enable({apis:['setTimeout']});
  const calls=[];
  const accounts={idle:()=>true,list:async()=>({accounts:['first','second','third'].map(id=>({id}))}),refresh:async id=>calls.push(id),cancel:async()=>{},...overrides};
  const poll=createAccountPoll({accounts,canRun:()=>true});
  t.after(()=>poll.close().catch(()=>{}));
  poll.start();
  return {poll,calls,accounts};
}
test('all saved accounts refresh after ten minutes and repeat without a browser',async t=>{
  const {calls}=fixture(t);
  assert.equal(ACCOUNT_REFRESH_MS,600000);
  t.mock.timers.tick(599999);await flush();assert.deepEqual(calls,[]);
  t.mock.timers.tick(1);await flush();assert.deepEqual(calls,['first','second','third']);
  t.mock.timers.tick(600000);await flush();assert.equal(calls.length,6);
});
test('one failed account does not stop later accounts and rounds do not overlap',async t=>{
  let release;const gate=new Promise(r=>release=r),calls=[];
  const {poll}=fixture(t,{refresh:async id=>{calls.push(id);if(id==='first')await gate;if(id==='second')throw Error('fixture failure');}});
  t.mock.timers.tick(600000);await flush();assert.equal(poll.idle(),false);
  t.mock.timers.tick(1200000);await flush();assert.deepEqual(calls,['first']);
  release();await flush();assert.deepEqual(calls,['first','second','third']);assert.equal(poll.idle(),true);
});
test('disabled service, offline mode and busy work defer until available; close removes timer',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});let online=false,idle=true,calls=0;
  const poll=createAccountPoll({accounts:{idle:()=>idle,list:async()=>({accounts:[{id:'first'}]}),refresh:async()=>calls++,cancel:async()=>{}},canRun:()=>online});
  t.after(()=>poll.close());poll.start();t.mock.timers.tick(600000);await flush();assert.equal(calls,0);
  online=true;idle=false;t.mock.timers.tick(1000);await flush();assert.equal(calls,0);
  idle=true;t.mock.timers.tick(1000);await flush();assert.equal(calls,1);
  await poll.close();t.mock.timers.tick(1200000);await flush();assert.equal(calls,1);
});
test('cancelling a round waits for the query to exit and never queries remaining accounts',async t=>{
  let release,cancelled=false;const gate=new Promise(r=>release=r),calls=[];
  const {poll}=fixture(t,{refresh:async id=>{calls.push(id);await gate;},cancel:async()=>{cancelled=true;}});
  t.mock.timers.tick(600000);await flush();let done=false;
  const stop=poll.cancel().then(()=>done=true);await flush();assert.equal(cancelled,true);assert.equal(done,false);
  release();await stop;await flush();assert.deepEqual(calls,['first']);assert.equal(poll.idle(),true);
});
test('loss of permission mid-batch stops remaining accounts',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});let online=true;const calls=[];
  const poll=createAccountPoll({canRun:()=>online,accounts:{idle:()=>true,list:async()=>({accounts:[{id:'first'},{id:'second'}]}),refresh:async id=>{calls.push(id);online=false;},cancel:async()=>{}}});
  t.after(()=>poll.close());poll.start();t.mock.timers.tick(600000);await flush();assert.deepEqual(calls,['first']);
});
test('unsupported stores are skipped and unconfirmed query exit blocks future writes and rounds',async t=>{
  const {poll,accounts,calls}=fixture(t,{list:async()=>({storeError:'credential_store_unsupported',accounts:[{id:'first'}]})});
  t.mock.timers.tick(600000);await flush();assert.deepEqual(calls,[]);
  accounts.list=async()=>({accounts:[{id:'first'},{id:'second'}]});
  accounts.refresh=async id=>{calls.push(id);throw Object.assign(Error('shutdown_unconfirmed'),{code:'shutdown_unconfirmed'});};
  t.mock.timers.tick(600000);await flush();assert.deepEqual(calls,['first']);assert.equal(poll.idle(),false);
  await assert.rejects(poll.cancel(),/shutdown_unconfirmed/);
  t.mock.timers.tick(1200000);await flush();assert.deepEqual(calls,['first']);
});

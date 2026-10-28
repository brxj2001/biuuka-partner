import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { CodexBridge } from '../chatgpt/bridge.mjs';
import { createServer } from '../core/server.mjs';
const fixture = fileURLToPath(new URL('./fixtures/fake-codex.mjs', import.meta.url));
function bridge(mode = 'ok', timeout = 3000) { return new CodexBridge({ command: process.execPath, args: [fixture, mode], timeout }); }

test('streams only the test thread; persistent read-only session and preset are required', async () => {
  const b = bridge(); const events = [];
  try { await b.initialize(); await b.test('fixture-model', 'low', e => events.push(e)); assert.deepEqual(events, [{ type: 'thread', threadId: 'test-thread', saved: false }, { type: 'delta', text: '<svg><text>Pelican</text></svg>' }]); }
  finally { b.close(); }
});
test('candy preset routes its exact prompt and matching saved title; arbitrary IDs are rejected', async () => {
  const b = bridge(); const events = [];
  try {
    await b.initialize();
    await assert.rejects(b.test('fixture-model', 'low', () => {}, 'custom'), { code: 'invalid_preset' });
    await b.test('fixture-model', 'low', e => events.push(e), 'candy');
    assert.ok(!events.some(e => e.saved === true));
  } finally { b.close(); }
});
test('API key authentication is rejected rather than silently charging an API key', async () => {
  const b = bridge('apikey'); try { await assert.rejects(b.initialize(), { code: 'chatgpt_login_required' }); } finally { b.close(); }
});
test('model and effort must match discovery; ephemeral thread is rejected', async () => {
  const b = bridge('ephemeral');
  try {
    await b.initialize(); await assert.rejects(b.test('fixture-model', 'ultra', () => {}), { code: 'invalid_model' });
    await assert.rejects(b.test('fixture-model', 'low', () => {}), { code: 'persistent_required' });
  } finally { b.close(); }
});
test('account projection exposes only requested fields; unavailable limits remain distinct from zero', async () => {
  for (const mode of ['ok', 'no-limits']) {
    const b = bridge(mode);
    try {
      await b.initialize(); const result = await b.profile();
      assert.equal(result.email, 'local@example.invalid'); assert.equal(result.plan, 'pro');
      assert.equal(result.limitsStatus, mode === 'ok' ? 'available' : 'unavailable');
      assert.ok(!JSON.stringify(result).includes('must-not-leak'));
      assert.ok(!JSON.stringify(result).includes('secret-upstream-error'));
      if (mode === 'ok') assert.equal(result.limits[0].primary.usedPercent, 25);
    } finally { b.close(); }
  }
});
test('a successful generation cannot claim persistence if the saved thread check fails', async () => {
  const b = bridge('unsaved'); const events = [];
  try {
    await b.initialize();
    await assert.rejects(b.test('fixture-model', 'low', e => events.push(e)), { code: 'persistence_unconfirmed' });
    assert.ok(!events.some(e => e.saved === true));
  } finally { b.close(); }
});
test('timeout stops a hanging generation', async () => {
  const b = bridge('hang', 500);
  try { await b.initialize(); await assert.rejects(b.test('fixture-model', 'low', () => {}), { code: 'timeout' }); }
  finally { b.close(); }
});
test('upstream errors do not expose raw diagnostic text', async () => {
  const b = bridge('error');
  try { await b.initialize(); await assert.rejects(b.test('fixture-model', 'low', () => {}), { message: 'turn_failed' }); } finally { b.close(); }
});

test('HTTP boundaries, streaming, privacy and cancellation', async t => {
  let mode = 'ok', lastBridge, created = 0;
  const server = createServer({refreshMs:0, token: 'test-secret', port: 17322, bridgeFactory: () => { created++; return lastBridge = bridge(mode); } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const port = server.address().port;
  const headers = { Host: '127.0.0.1:17322', Origin: 'http://127.0.0.1:17322', Authorization: 'Bearer test-secret', 'Content-Type': 'application/json' };
  const call = (url, body, overrides = {}) => new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path: url, method: body ? 'POST' : 'GET', headers: { ...headers, ...overrides } }, res => {
      let text = ''; res.on('data', chunk => text += chunk); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text }));
    }); req.on('error', reject); req.end(body && JSON.stringify(body));
  });
  try {
    await t.test('rejects missing pairing, foreign origins, DNS rebinding and arbitrary prompts before starting Codex', async () => {
      assert.equal((await call('/models', {}, { Authorization: '' })).status, 401);
      assert.equal((await call('/account', {}, { Authorization: '' })).status, 401);
      assert.equal((await call('/account', {}, { Origin: 'https://evil.invalid' })).status, 401);
      assert.equal((await call('/history', {}, { Authorization: '' })).status, 401);
      assert.equal((await call('/chat', { model: 'fixture-model', effort: 'low', prompt: 'Hello Biuuka' }, { Origin: 'https://evil.invalid' })).status, 403);
      assert.equal((await call('/chat', { model: 'fixture-model', effort: 'low', prompt: '' })).status, 400);
      assert.equal((await call('/chat', { model: 'fixture-model', effort: 'low', prompt: 'x'.repeat(16001) })).status, 400);
      assert.equal((await call('/models', {}, { Origin: 'https://evil.invalid' })).status, 401);
      assert.equal((await call('/models', {}, { Host: 'evil.invalid' })).status, 403);
      assert.equal((await call('/test', { model: 'fixture-model', effort: 'low', prompt: 'read files' })).status, 400);
      assert.equal((await call('/test', { model: 'fixture-model', effort: 'low', preset: 'custom' })).status, 400);
      assert.equal(created, 0);
    });
    await t.test('returns only allowlisted model metadata and no account information', async () => {
      assert.equal((await call('/health', undefined, { Host: 'localhost:17322', Origin: 'http://localhost:17322' })).status, 200);
      const account = await call('/account', {}); assert.equal(account.status, 200);
      assert.equal(JSON.parse(account.text).email, 'local@example.invalid');
      assert.ok(!account.text.includes('must-not-leak'));
      const response = await call('/models', {}); assert.equal(response.status, 200);
      assert.ok(!response.text.includes('must-not-leak')); assert.equal(response.headers['cache-control'], 'no-store');
      assert.equal(response.headers['access-control-allow-origin'], undefined);
    });
    await t.test('streams completion and sanitizes failure', async () => {
      const chat = await call('/chat', { model: 'fixture-model', effort: 'low', prompt: 'Hello Biuuka' });
      const chatEvents = chat.text.trim().split('\n').map(JSON.parse);
      assert.equal(chatEvents.at(-1).type, 'done');
      assert.ok(chatEvents.some(e => e.type === 'thread' && e.saved));
      const response = await call('/test', { model: 'fixture-model', effort: 'low' });
      const events = response.text.trim().split('\n').map(JSON.parse); assert.equal(events.at(-1).type, 'done');
      mode = 'error'; const failure = await call('/test', { model: 'fixture-model', effort: 'low' });
      assert.ok(failure.text.includes('turn_failed')); assert.ok(!failure.text.includes('secret-upstream-error'));
    });
    await t.test('single flight and disconnect termination', async () => {
      mode = 'hang';
      const req = http.request({ hostname: '127.0.0.1', port, path: '/test', method: 'POST', headers });
      req.on('error', () => {}); req.end(JSON.stringify({ model: 'fixture-model', effort: 'low' }));
      const [response] = await once(req, 'response'); response.resume();
      assert.equal((await call('/models', {})).status, 409);
      const active = lastBridge; req.destroy();
      for (let i = 0; i < 40 && !active.closed; i++) await new Promise(resolve => setTimeout(resolve, 10));
      assert.equal(active.closed, 'cancelled');
    });
  } finally { server.closeAllConnections(); server.close(); }
});

test('normal EOF exit and fresh-process history verification filter unrelated data', async () => {
  const b = bridge();
  await b.initialize();
  const id = await b.test('fixture-model', 'low', () => {});
  await b.finish();
  assert.equal(b.child.exitCode, 0);
  const reader = bridge();
  try {
    await reader.initialize(); await reader.verifySaved(id);
    const history = await reader.history();
    assert.equal(history.threads.length, 1);
    assert.ok(!JSON.stringify(history).includes('must-not-leak'));
    await reader.finish();
  } finally { reader.close(); }
  const missing = bridge('not-listed');
  try {
    await missing.initialize();
    await assert.rejects(missing.verifySaved(id), { code: 'history_unconfirmed' });
  } finally { missing.close(); }
});

test('trusted websites connect without tokens; other sites and private routes stay blocked',async()=>{
 const server=createServer({token:'private',refreshMs:0,port:17322,bridgeFactory:()=>bridge()});server.listen(0,'127.0.0.1');await once(server,'listening');
 const call=(origin,route='/account',method='POST',extra={})=>new Promise((resolve,reject)=>{const req=http.request({hostname:'127.0.0.1',port:server.address().port,path:route,method,headers:{Host:'127.0.0.1:17322',Origin:origin,'Content-Type':'application/json',...extra}},res=>{let text='';res.on('data',c=>text+=c);res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,text}));});req.on('error',reject);req.end(method==='POST'?'{}':undefined);});
 try{
  const ok=await call('https://brxj.biuuka.com');assert.equal(ok.status,200);assert.equal(ok.headers['access-control-allow-origin'],'https://brxj.biuuka.com');assert.ok(!ok.text.includes('must-not-leak'));
  for(const origin of ['https://other.biuuka.com','https://uuco-card.com','https://shop.uuco-card.com'])assert.equal((await call(origin)).status,200);
  for(const origin of ['https://evil.test','https://biuuka.com.evil.test'])assert.equal((await call(origin)).status,401);
  for(const origin of ['http://biuuka.com','null']){const denied=await call(origin);assert.equal(denied.status,403);assert.equal(denied.headers['access-control-allow-origin'],undefined);}
  for(const route of ['/history','/chat','/pair/approve'])assert.equal((await call('https://biuuka.com',route)).status,403);
  assert.equal((await call('https://biuuka.com','/account','OPTIONS',{'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'content-type'})).status,204);
  assert.equal((await call('https://biuuka.com','/account','OPTIONS',{'Access-Control-Request-Method':'DELETE'})).status,403);
 }finally{server.closeAllConnections();server.close();}
});
test('service refreshes independently of browser requests and stops refreshing when closed',async()=>{
 let reads=0,fail=false;const server=createServer({token:'private',refreshMs:30,bridgeFactory:()=>({initialize:async()=>{},profile:async()=>{reads++;if(fail)throw Error('offline');return {checkedAt:new Date().toISOString()};},close(){}})});
 server.listen(0,'127.0.0.1');await once(server,'listening');
 try{await new Promise(r=>setTimeout(r,75));assert.ok(reads>=2);fail=true;await new Promise(r=>setTimeout(r,40));}finally{server.close();await once(server,'close');}
 const stopped=reads;await new Promise(r=>setTimeout(r,70));assert.equal(reads,stopped);
});

test('account bridge shutdown waits for actual child exit and is repeatable', async () => {
  const b=bridge();
  try { await b.initialize(); await b.closeAndWait(); assert.ok(b.child.exitCode !== null || b.child.signalCode !== null); await b.closeAndWait(); }
  finally { b.close(); }
});

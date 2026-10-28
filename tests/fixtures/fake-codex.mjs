import { createInterface } from 'node:readline';
const mode = process.argv[2];
let threadName;
const send = value => process.stdout.write(JSON.stringify(value) + '\n');
createInterface({ input: process.stdin }).on('line', line => {
  const q = JSON.parse(line); if (q.id == null) return;
  const reply = result => send({ id: q.id, result });
  if (q.method === 'initialize') reply({});
  else if (q.method === 'account/read') reply({ account: { type: mode === 'apikey' ? 'apiKey' : 'chatgpt', email: 'local@example.invalid', planType: 'pro', accessToken: 'must-not-leak' } });
  else if (q.method === 'account/rateLimits/read') {
    if (mode === 'no-limits') { send({ id: q.id, error: { message: 'secret-upstream-error' } }); return; }
    reply({ accountId: 'must-not-leak', rateLimits: { limitId: 'codex', primary: { usedPercent: 25, windowDurationMins: 300, resetsAt: 1800000000 }, private: 'must-not-leak' } });
  }
  else if (q.method === 'thread/name/set') { threadName = q.params.name; reply({}); }
  else if (q.method === 'thread/list') reply({ data: mode === 'not-listed' ? [] : [
    { id: 'test-thread', name: 'Biuuka · fixture', originator: 'biuuka', ephemeral: false, preview: 'must-not-leak' },
    { id: 'private', name: 'Biuuka · private', originator: 'other', ephemeral: false }
  ], nextCursor: null });
  else if (q.method === 'thread/read') reply({ thread: { id: q.params.threadId, ephemeral: mode === 'unsaved', originator: mode === 'foreign' ? 'other' : 'biuuka' } });
  else if (q.method === 'thread/delete') { if(mode === 'delete-failed')send({id:q.id,error:{message:'private error'}});else reply({}); }
  else if (q.method === 'model/list') reply({ data: [{ model: 'fixture-model', displayName: 'Fixture', supportedReasoningEfforts: [{ reasoningEffort: 'low' }], defaultReasoningEffort: 'low' }], nextCursor: null });
  else if (q.method === 'thread/start') {
    if (q.params.ephemeral !== false || q.params.sandbox !== 'read-only' || q.params.approvalPolicy !== 'untrusted') process.exit(3);
    reply({ thread: { id: 'test-thread', ephemeral: mode === 'ephemeral' } });
  } else if (q.method === 'turn/start') {
    const expected = {"Biuuka · 鹈鹕测试":"请生成一个完整、可直接在浏览器打开的 HTML 作品：一只鹈鹕在日出时分骑自行车穿过安静的城市。必须包含可见的鹈鹕、自行车、城市和日出元素，并使用内联 CSS 或 SVG 制作动画。只输出完整 HTML 源码，不要解释过程，不要使用 Markdown 代码围栏。","Biuuka · 糖果测试":"在一个黑色的袋子里放有三种口味的糖果，每种糖果有圆形和五角星形。已知数量如下：圆形苹果、桃子、西瓜分别为 7、9、8 颗；五角星形苹果、桃子、西瓜分别为 7、6、4 颗。最少取出多少个糖果，才能保证手中同时拥有不同形状的苹果味和桃子味糖果？"};
    if (q.params.input[0].text !== (threadName === 'Biuuka · Chat' ? 'Hello Biuuka' : expected[threadName])) process.exit(4);
    reply({ turn: { id: 'test-turn' } });
    if (mode === 'hang') return;
    if (mode === 'error') { send({ method: 'turn/completed', params: { threadId: 'test-thread', turn: { status: 'failed', error: { message: 'secret-upstream-error' } } } }); return; }
    send({ method: 'item/agentMessage/delta', params: { threadId: 'someone-else', delta: 'private-history' } });
    send({ method: 'item/agentMessage/delta', params: { threadId: 'test-thread', delta: '<svg><text>Pelican</text></svg>' } });
    send({ method: 'turn/completed', params: { threadId: 'test-thread', turn: { status: 'completed' } } });
  }
});

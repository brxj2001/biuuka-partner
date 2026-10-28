const $ = id => document.getElementById(id);
const token = new URLSearchParams(location.hash.slice(1)).get('token') || '';
history.replaceState(null, '', '/');
let models = [], presets = [], controller;
const testButtons = ['run-pelican', 'run-candy', 'send-chat'];
const errors = { pairing_required: '请使用安装目录中的 biuuka open 重新打开页面。', chatgpt_login_required: '本机 Codex 尚未使用 ChatGPT 登录，请运行 biuuka login 完成官方登录后刷新。', busy: '已有测试正在运行，请停止或稍后再试。', invalid_model: '模型或推理等级已变化，请刷新模型。', timeout: '测试超时，已停止本机测试进程。', turn_failed: '本次生成未完成，请检查账户额度及网络后手动重试。', codex_request_failed: 'Codex 请求失败，请检查登录状态、网络及客户端版本。', persistent_required: '未能创建保存型 Codex 会话。', persistence_unconfirmed: '已收到回答，但会话保存尚未确认，请保留会话 ID 检查。' };
errors.history_unconfirmed = '回答已生成，但独立进程尚未在历史列表找到会话。';
errors.shutdown_unconfirmed = '生成进程未正常结束，保存状态尚未确认。';
const message = code => errors[code] || '本机服务或 Codex 不可用，请检查后台任务及网络。';
function status(text) { $('status').textContent = text; }
async function request(url, body, signal) {
  const response = await fetch(url, { method: body ? 'POST' : 'GET', cache: 'no-store',
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}), signal });
  if (!response.ok) throw new Error(message((await response.json()).error));
  return response;
}
function efforts() {
  const model = models.find(m => m.model === $('model').value);
  $('effort').replaceChildren(...(model?.efforts || []).map(e => new Option(({none:'关闭',minimal:'极低',low:'低',medium:'中',high:'高',xhigh:'超高',max:'最高',ultra:'极高'})[e]||e, e)));
  if (model) $('effort').value = model.defaultEffort;
  for (const id of testButtons) $(id).disabled = !$('effort').value;
}
async function account() {
  $('account').textContent = '正在读取…'; $('limits').replaceChildren(); $('account-time').textContent = '';
  try {
    const profile = await (await request('/account', {})).json();
    $('account').textContent = `ChatGPT 登录 · 邮箱：${profile.email || '未返回'} · 套餐：${profile.plan || '未返回'}`;
    if (profile.limitsStatus !== 'available') {
      $('limits').textContent = '额度信息暂不可用（不表示额度为零）。';
    } else {
      for (const bucket of profile.limits) {
        const title = document.createElement('h3'); title.textContent = bucket.name || bucket.id;
        $('limits').append(title);
        for (const [key, name] of [['primary', '主要窗口'], ['secondary', '次要窗口']]) {
          const win = bucket[key]; if (!win) continue;
          const row = document.createElement('p');
          const used = win.usedPercent == null ? '未返回' : win.usedPercent + '%';
          const remaining = win.usedPercent == null ? '未返回' : Math.max(0, 100 - win.usedPercent).toFixed(1) + '%';
          const reset = win.resetsAt == null ? '未返回' : new Date(win.resetsAt * 1000).toLocaleString();
          const label=win.windowDurationMins===300?'5 小时额度':win.windowDurationMins===10080?'每周额度':win.windowDurationMins?`${win.windowDurationMins%60===0?win.windowDurationMins/60+' 小时':win.windowDurationMins+' 分钟'}额度`:name;
          row.textContent = `${label} · 已用：${used} · 剩余比例：${remaining} · 重置：${reset}`;
          $('limits').append(row);
        }
      }
    }
    $('account-time').textContent = '读取时间：' + new Date(profile.checkedAt).toLocaleString() + '。额度按 Codex 返回的窗口展示，不代表 ChatGPT 网页所有模型的剩余次数。';
  } catch (error) { $('account').textContent = error.message; }
}
function desktopLink(id, label = '在桌面端打开') {
  const link = document.createElement('a');
  link.textContent = label;
  if (/^[a-zA-Z0-9_-]{1,100}$/.test(id)) link.href = 'codex://threads/' + encodeURIComponent(id);
  return link;
}
async function loadHistory() {
  $('history-list').textContent = '正在读取已有测试记录…';
  try {
    const result = await (await request('/history', {})).json();
    $('history-list').replaceChildren();
    for (const thread of result.threads) {
      const row = document.createElement('p');
      const label = document.createElement('span');
      label.textContent = thread.name + ' · ' + thread.id + ' ';
      row.append(label, desktopLink(thread.id)); $('history-list').append(row);
    }
    if (!result.threads.length) $('history-list').textContent = '当前 Codex 配置中未找到已保存的助手测试记录。';
  } catch (error) { $('history-list').textContent = error.message; }
}
async function connect() {
  $('reload').disabled = true; for (const id of testButtons) $(id).disabled = true; status('正在读取本机模型目录…');
  try {
    presets = (await (await request('/preset')).json()).presets;
    for (const preset of presets) $('prompt-' + preset.id).textContent = preset.prompt;
    await account();
    await loadHistory();
    models = (await (await request('/models', {})).json()).models;
    $('model').replaceChildren(...models.map(m => new Option(m.name, m.model)));
    const chosen = models.find(m => m.isDefault); if (chosen) $('model').value = chosen.model;
    $('model').disabled = $('effort').disabled = false; efforts();
    status(models.length ? '已连接 · 已识别 ChatGPT 登录 · 可发送测试' : '没有可用模型');
  } catch (error) { status(error.message); } finally { $('reload').disabled = false; }
}
$('reload').onclick = connect; $('model').onchange = efforts;
$('stop').onclick = () => controller?.abort();
async function runTest(presetId) {
  if (controller) return;
  const preset = presetId === 'chat' ? { name: 'Chat' } : presets.find(p => p.id === presetId);
  if (presetId === 'chat' && !$('custom-prompt').value.trim()) { status('Please enter a message.'); return; }
  if (!preset) return;
  controller = new AbortController(); $('answer').textContent = ''; $('thread').textContent = '正在创建保存型会话…'; $('resume').hidden = true; $('desktop-open').replaceChildren();
  for (const id of [...testButtons, 'reload', 'model', 'effort']) $(id).disabled = true;
  $('stop').disabled = false; status('测试中…');
  let completed = false;
  try {
    const response = await request(presetId === 'chat' ? '/chat' : '/test', { model: $('model').value, effort: $('effort').value, ...(presetId === 'chat' ? { prompt: $('custom-prompt').value } : { preset: presetId }) }, controller.signal);
    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader(); let pending = '';
    while (true) {
      const { value, done } = await reader.read(); if (done) break; pending += value;
      let newline; while ((newline = pending.indexOf('\n')) >= 0) {
        const event = JSON.parse(pending.slice(0, newline)); pending = pending.slice(newline + 1);
        if (event.type === 'thread') {
          $('thread').textContent = `Biuuka · ${preset.name} · ${event.threadId} · ${event.saved ? '已由独立进程核对保存及历史列表' : '会话已创建，保存待确认'}`;
          $('desktop-open').replaceChildren(desktopLink(event.threadId));
          $('resume').hidden = false;
          $('resume').textContent = 'biuuka resume ' + event.threadId;
        }
        if (event.type === 'delta') $('answer').textContent += event.text;
        if (event.type === 'error') throw new Error(message(event.error));
        if (event.type === 'done') { completed = true; status(`测试完成 · ${(event.elapsedMs / 1000).toFixed(1)} 秒`); }
      }
    }
    if (!completed) throw new Error('连接中断，结果未确认；不会自动重试。');
  } catch (error) { status(error.name === 'AbortError' ? '已停止等待并请求终止本机测试；已发生的用量不会撤销。' : error.message); }
  finally { await account(); await loadHistory(); controller = null; for (const id of [...testButtons, 'reload', 'model', 'effort']) $(id).disabled = false; $('stop').disabled = true; }
};
for (const presetId of ['pelican', 'candy']) $('run-' + presetId).onclick = () => runTest(presetId);
if (token) connect(); else status(errors.pairing_required);
$('send-chat').onclick = () => runTest('chat');

// The service refreshes in the background; keep this local view current too.
setInterval(() => { if (token && !controller && !$('reload').disabled) void account(); }, 10000);

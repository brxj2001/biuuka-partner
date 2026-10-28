import {VERSION} from '../release.mjs';
import {readSubscription} from './subscription.mjs';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

export const PRESETS = Object.freeze([{"id":"pelican","name":"鹈鹕测试","prompt":"请生成一个完整、可直接在浏览器打开的 HTML 作品：一只鹈鹕在日出时分骑自行车穿过安静的城市。必须包含可见的鹈鹕、自行车、城市和日出元素，并使用内联 CSS 或 SVG 制作动画。只输出完整 HTML 源码，不要解释过程，不要使用 Markdown 代码围栏。"},{"id":"candy","name":"糖果测试","prompt":"在一个黑色的袋子里放有三种口味的糖果，每种糖果有圆形和五角星形。已知数量如下：圆形苹果、桃子、西瓜分别为 7、9、8 颗；五角星形苹果、桃子、西瓜分别为 7、6、4 颗。最少取出多少个糖果，才能保证手中同时拥有不同形状的苹果味和桃子味糖果？"}].map(Object.freeze));

export class BridgeError extends Error {
  constructor(code) { super(code); this.code = code; }
}

// Every operation owns a short-lived app-server. Never expose raw JSON-RPC to HTTP.
export class CodexBridge {
  constructor({ command, args = [], cwd, codexHome, timeout = 180000 }) {
    this.codexHome = codexHome;
    this.pending = new Map(); this.nextId = 1; this.listeners = new Set();
    this.child = spawn(command, [...args, 'app-server', '--listen', 'stdio://',
      '-c', 'analytics.enabled=false', '-c', 'feedback.enabled=false', '-c', 'model_provider="openai"',
      '-c', 'web_search="disabled"',
      '-c', 'features.shell_tool=false', '-c', 'features.unified_exec=false',
      '-c', 'features.apps=false', '-c', 'features.remote_plugin=false',
      '-c', 'features.browser_use=false', '-c', 'features.computer_use=false',
      '-c', 'mcp_servers={}'],
    { cwd, env: codexHome ? {...process.env, CODEX_HOME:codexHome} : process.env, windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
    this.timer = setTimeout(() => this.close('timeout'), timeout);
    this.child.on('error', () => this.close('codex_unavailable'));
    this.child.on('exit', () => this.close(this.finishing ? 'closed' : 'codex_exited'));
    this.child.stdin.on('error', () => this.close(this.finishing ? 'closed' : 'codex_exited'));
    this.lines = createInterface({ input: this.child.stdout });
    this.lines.on('line', line => {
      let msg; try { msg = JSON.parse(line); } catch { return this.close('protocol_error'); }
      if (msg.method && msg.id != null) {
        // This bridge never grants tool approvals or collects additional user input.
        this.send({ id: msg.id, error: { code: -32601, message: 'Unsupported by local test bridge' } });
        return;
      }
      if (msg.id != null) {
        const waiter = this.pending.get(msg.id); if (!waiter) return;
        this.pending.delete(msg.id);
        msg.error ? waiter.reject(new BridgeError(msg.error.code === -32600 && /^(?:no rollout found for thread id |thread not loaded: )[a-zA-Z0-9_-]+$/.test(msg.error.message || '') ? 'codex_thread_not_found' : 'codex_request_failed')) : waiter.resolve(msg.result);
      } else for (const listener of this.listeners) listener(msg);
    });
  }
  send(message) { if (!this.closed) this.child.stdin.write(JSON.stringify(message) + '\n'); }
  request(method, params = {}) {
    if (this.closed) return Promise.reject(new BridgeError(this.closed));
    return new Promise((resolve, reject) => {
      const id = this.nextId++; this.pending.set(id, { resolve, reject }); this.send({ id, method, params });
    });
  }
  async initialize({requireLogin = true} = {}) {
    await this.request('initialize', { clientInfo: { name: 'biuuka', version: VERSION } });
    this.send({ method: 'initialized' });
    if (!requireLogin) return;
    const result = await this.request('account/read', { refreshToken: false });
    this.account = result.account;
    if (result.account?.type !== 'chatgpt') throw new BridgeError('chatgpt_login_required');
  }
  async profile() {
    const text = value => typeof value === 'string' ? value.slice(0, 256) : null;
    const number = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
    const window = value => value ? {
      usedPercent: number(value.usedPercent), windowDurationMins: number(value.windowDurationMins),
      resetsAt: number(value.resetsAt),
    } : null;
    const profile = { email: text(this.account.email), plan: text(this.account.planType), login: 'chatgpt', limits: [], limitsStatus: 'unavailable' };
    try {
      const result = await this.request('account/rateLimits/read');
      const buckets = result.rateLimitsByLimitId && Object.keys(result.rateLimitsByLimitId).length
        ? Object.entries(result.rateLimitsByLimitId) : result.rateLimits ? [[result.rateLimits.limitId || 'codex', result.rateLimits]] : [];
      profile.limits = buckets.slice(0, 20).map(([id, item]) => ({
        id: text(id), name: text(item.limitName), primary: window(item.primary), secondary: window(item.secondary),
      }));
      profile.limitsStatus = profile.limits.length ? 'available' : 'unavailable';
    } catch { /* Account remains usable when usage information is unavailable. */ }
    if (this.codexHome) profile.subscription = await readSubscription(this.codexHome, this.account);
    profile.checkedAt = new Date().toISOString();
    return profile;
  }
  async models() {
    const models = []; let cursor = null;
    do {
      const page = await this.request('model/list', { limit: 100, includeHidden: false, cursor });
      for (const m of page.data || []) models.push({ model: m.model, name: m.displayName,
        efforts: (m.supportedReasoningEfforts || []).map(e => e.reasoningEffort),
        defaultEffort: m.defaultReasoningEffort, isDefault: m.isDefault });
      cursor = page.nextCursor;
      if (models.length > 1000) throw new BridgeError('protocol_error');
    } while (cursor);
    return models;
  }
  async test(model, effort, emit, presetId = 'pelican') {
    const preset = PRESETS.find(item => item.id === presetId);
    if (!preset) throw new BridgeError('invalid_preset');
    return this.conversation(model, effort, emit, preset.prompt, preset.name);
  }
  async conversation(model, effort, emit, prompt, title = 'Chat') {
    if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 16000) throw new BridgeError('invalid_prompt');
    const models = await this.models();
    if (!models.some(m => m.model === model && m.efforts.includes(effort))) throw new BridgeError('invalid_model');
    const started = await this.request('thread/start', {
      model, modelProvider: 'openai', threadSource: 'user',
      approvalPolicy: 'untrusted', sandbox: 'read-only', ephemeral: false,
      developerInstructions: 'Answer the selected test prompt exactly as requested. Do not use tools, read files, or include account or environment information.',
    });
    if (started.thread?.ephemeral !== false) throw new BridgeError('persistent_required');
    const threadId = started.thread.id;
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(threadId)) throw new BridgeError('protocol_error');
    await this.request('thread/name/set', { threadId, name: 'Biuuka · ' + title });
    emit({ type: 'thread', threadId, saved: false });
    let total = 0;
    await new Promise((resolve, reject) => {
      const listener = msg => {
        if (msg.method === '__closed') return reject(new BridgeError(this.closed));
        if (msg.params?.threadId !== threadId) return;
        if (msg.method === 'item/agentMessage/delta') {
          const delta = msg.params.delta || ''; total += delta.length;
          if (total > 65536) return this.close('output_limit');
          emit({ type: 'delta', text: delta });
        }
        if (msg.method === 'turn/completed') {
          this.listeners.delete(listener);
          msg.params.turn.status === 'completed' ? resolve() : reject(new BridgeError('turn_failed'));
        }
      };
      this.listeners.add(listener);
      this.request('turn/start', { threadId, model, effort,
        input: [{ type: 'text', text: prompt, text_elements: [] }],
      }).catch(reject);
    });
    const stored = await this.request('thread/read', { threadId, includeTurns: false });
    if (stored.thread?.id !== threadId || stored.thread.ephemeral !== false) throw new BridgeError('persistence_unconfirmed');
    return threadId;
  }
  async history() {
    const threads = []; let cursor = null; const seen = new Set();
    do {
      const page = await this.request('thread/list', { limit: 100, cursor, searchTerm: 'Biuuka ·',
        sourceKinds: ['cli', 'vscode', 'appServer'], archived: false, sortKey: 'updated_at' });
      for (const thread of page.data || []) {
        if (thread.originator !== 'biuuka' || thread.ephemeral !== false ||
            !/^[a-zA-Z0-9_-]{1,100}$/.test(thread.id) || typeof thread.name !== 'string' || !thread.name.startsWith('Biuuka ·')) continue;
        threads.push({ id: thread.id, name: thread.name.slice(0, 256), updatedAt: thread.updatedAt });
      }
      cursor = page.nextCursor;
      if (cursor && seen.has(cursor)) throw new BridgeError('protocol_error');
      seen.add(cursor);
    } while (cursor && threads.length < 100 && seen.size < 10);
    return { threads: threads.slice(0, 100), truncated: Boolean(cursor) };
  }
  async deleteThread(threadId) {
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(threadId)) throw new BridgeError('invalid_record');
    let stored;
    try { stored = await this.request('thread/read', {threadId, includeTurns:false}); }
    catch (e) { if (e.code === 'codex_thread_not_found') return; throw e; }
    if (stored.thread?.id !== threadId || stored.thread.originator !== 'biuuka' || stored.thread.ephemeral !== false)
      throw new BridgeError('thread_ownership_unconfirmed');
    await this.request('thread/delete', {threadId});
  }
  async verifySaved(threadId) {
    const result = await this.request('thread/read', { threadId, includeTurns: false });
    if (result.thread?.id !== threadId || result.thread.ephemeral !== false) throw new BridgeError('persistence_unconfirmed');
    const history = await this.history();
    if (!history.threads.some(thread => thread.id === threadId)) throw new BridgeError('history_unconfirmed');
  }
  async finish() {
    if (this.closed) throw new BridgeError('shutdown_unconfirmed');
    this.finishing = true;
    let deadline;
    const exited = once(this.child, 'exit');
    this.child.stdin.end();
    try {
      await Promise.race([exited, new Promise((_, reject) => {
        deadline = setTimeout(() => reject(new BridgeError('shutdown_unconfirmed')), 10000);
      })]);
      if (this.child.exitCode !== 0) throw new BridgeError('shutdown_unconfirmed');
    } finally { clearTimeout(deadline); if (!this.closed) this.close(); }
  }
  async closeAndWait() {
    if (!this.child.pid || this.child.exitCode !== null || this.child.signalCode !== null) { this.close(); return; }
    // Register before requesting exit. A close request alone is not proof that
    // the process has released the auth store used by the next switch phase.
    const exited = once(this.child, 'exit');
    let deadline;
    this.close();
    try {
      await Promise.race([exited, new Promise((_, reject) => {
        deadline = setTimeout(() => reject(new BridgeError('shutdown_unconfirmed')), 10000);
      })]);
    } finally { clearTimeout(deadline); }
  }
  close(code = 'closed') {
    if (this.closed) return;
    this.closed = code; clearTimeout(this.timer);
    for (const p of this.pending.values()) p.reject(new BridgeError(code)); this.pending.clear();
    for (const listener of this.listeners) listener({ method: '__closed' }); this.listeners.clear();
    this.lines?.close();
    if (this.child.exitCode === null && this.child.pid) {
      if (process.platform === 'win32') {
        const killer = spawn('taskkill.exe', ['/PID', String(this.child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
        killer.on('error', () => this.child.kill());
      } else this.child.kill('SIGKILL');
    }
  }
}

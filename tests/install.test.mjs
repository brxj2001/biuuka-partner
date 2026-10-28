import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { supported, download } from '../scripts/install/setup.mjs';
import { plist } from '../scripts/install/mac-service.mjs';

test('supported native architectures reject unsupported operating systems and 32-bit CPUs', () => {
  for (const p of ['darwin', 'win32']) for (const a of ['x64', 'arm64']) assert.equal(supported(p, a), true);
  for (const [p, a] of [['linux','x64'], ['darwin','ppc'], ['win32','ia32']]) assert.equal(supported(p, a), false);
});
test('dependency download verifies bytes before writing executable content', async () => {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'biuuka-test-'));
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response('verified fixture');
    const source = { url: 'https://example.invalid/runtime', algorithm: 'sha256', digest: createHash('sha256').update('verified fixture').digest('hex') };
    await download(source, path.join(folder, 'good'));
    assert.equal(await readFile(path.join(folder, 'good'), 'utf8'), 'verified fixture');
    await assert.rejects(download({ ...source, digest: '0'.repeat(64) }, path.join(folder, 'bad')), /checksum/);
    await assert.rejects(readFile(path.join(folder, 'bad')), { code: 'ENOENT' });
    globalThis.fetch = async () => new Response('', { status: 503 });
    await assert.rejects(download(source, path.join(folder, 'bad')), /503/);
  } finally { globalThis.fetch = original; await rm(folder, { recursive: true, force: true }); }
});
test('launchd escapes paths and keeps the same explicit account directory after reboot', () => {
  const text = plist('/node & space', '/app/cli.mjs', '/state/<user>', '/home/.codex');
  assert.ok(text.includes('/node &amp; space'));
  assert.ok(text.includes('/state/&lt;user&gt;'));
  assert.ok(text.includes('<key>CODEX_HOME</key><string>/home/.codex</string>'));
  assert.ok(text.includes('<key>ThrottleInterval</key><integer>30</integer>'));
  assert.ok(!text.includes('auth.json'));
});
test('all four platforms have pinned native dependency checksums', async () => {
  const lock = JSON.parse(await readFile(new URL('../sources.json', import.meta.url), 'utf8'));
  assert.deepEqual(Object.keys(lock).sort(), ['darwin-arm64','darwin-x64','win32-arm64','win32-x64']);
  for (const platform of Object.values(lock)) {
    assert.match(platform.node.url, /^https:\/\/nodejs.org\//);
    assert.match(platform.node.digest, /^[a-f0-9]{64}$/);
    assert.equal(Buffer.from(platform.codex.digest, 'base64').length, 64);
    assert.ok(platform.codex.url.includes('0.163.0'));
  }
});

test('installer packaging is reproducible, contains its license and excludes private/test files', async () => {
  const {packageBiuuka} = await import('../package.mjs');
  const folder = await mkdtemp(path.join(os.tmpdir(), 'biuuka-package-'));
  try {
    const a=path.join(folder,'a'),b=path.join(folder,'b');await packageBiuuka({output:a});await packageBiuuka({output:b});
    for(const name of ['biuuka.zip','install.cmd','install.sh','latest.json'])assert.deepEqual(await readFile(path.join(a,name)),await readFile(path.join(b,name)));
    const zip=await readFile(path.join(a,'biuuka.zip'));
    assert.ok(zip.includes(Buffer.from('LICENSE')));assert.ok(zip.includes(Buffer.from('pair.js')));
    for(const name of ['auth.json','.env','.git/','fake-codex.mjs','local.test.mjs'])assert.ok(!zip.includes(Buffer.from(name)));
    const meta=JSON.parse(await readFile(path.join(a,'latest.json'),'utf8'));
    assert.equal(meta.files['biuuka.zip'].sha256,createHash('sha256').update(zip).digest('hex'));
  }finally{await rm(folder,{recursive:true,force:true});}
});

test('streamed dependency bytes are verified before replacing an existing executable', async () => {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'biuuka-stream-'));
  const original = globalThis.fetch;
  const target = path.join(folder, 'runtime');
  const { writeFile } = await import('node:fs/promises');
  try {
    await writeFile(target, 'existing verified runtime');
    const source = { url: 'https://example.invalid/runtime', algorithm: 'sha256', digest: createHash('sha256').update('firstsecond').digest('hex') };
    const stream = pieces => new Response(new ReadableStream({ start(controller) {
      for (const piece of pieces) controller.enqueue(Buffer.from(piece));
      controller.close();
    } }), { headers: { 'content-length': '11' } });
    globalThis.fetch = async () => stream(['first']);
    await assert.rejects(download(source, target), /checksum/);
    assert.equal(await readFile(target, 'utf8'), 'existing verified runtime');
    globalThis.fetch = async () => stream(['first', 'second']);
    await download(source, target);
    assert.equal(await readFile(target, 'utf8'), 'firstsecond');
  } finally { globalThis.fetch = original; await rm(folder, {recursive: true, force: true}); }
});

test('package CLI invoked through a linked temporary checkout actually builds installers', async () => {
  const { symlink } = await import('node:fs/promises');
  const { fileURLToPath } = await import('node:url');
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const folder = await mkdtemp(path.join(os.tmpdir(), 'biuuka-cli-link-'));
  try {
    const source = fileURLToPath(new URL('../', import.meta.url));
    const linked = path.join(folder, 'linked-source');
    await symlink(source, linked, process.platform === 'win32' ? 'junction' : 'dir');
    const output = path.join(folder, 'artifacts');
    await promisify(execFile)(process.execPath, [path.join(linked, 'package.mjs'), '--output', output]);
    const manifest = JSON.parse(await readFile(path.join(output, 'latest.json'), 'utf8'));
    for (const name of ['biuuka.zip', 'install.cmd', 'install.sh', 'uninstall.ps1']) {
      const digest = createHash('sha256').update(await readFile(path.join(output, name))).digest('hex');
      assert.equal(digest, manifest.files[name].sha256);
    }
  } finally { await rm(folder, { recursive: true, force: true }); }
});

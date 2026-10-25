#!/usr/bin/env node
// Drives the real run_smalltalk MCP tool from the built server code (mcp-bridge/server/dist).
// Usage: node driver.mjs status | prepare | wait | snapshot
//        | call '<json args>' [--abort-after <ms>] [--parallel <n>] | callfile <args.json> [same flags]
//        | tools-list | tools-call '<json args>' | tools-abort '<json args>' [delayMs=5000]
// Env: CUIS_HOME_DIR -> home (use a throwaway dir), CUIS_PLATFORM -> platform, CUIS_ARCHIVE_URL,
// CUIS_ARCHIVE_SHA256 (status/prepare/wait only; the tools-* commands honour only CUIS_HOME_DIR and
// DRIVER_CWD, the real server takes no options), DRIVER_CWD -> cwd the tool resolves packages against.
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, existsSync, statSync, mkdirSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const serverDir = path.resolve(here, '../../../mcp-bridge/server');
const load = (file) => import(pathToFileURL(path.join(serverDir, 'dist', file)).href);
const env = process.env;
const print = (value) => console.log(JSON.stringify(value));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (code, message) => { print({ ok: false, error: { code, message } }); return 1; };

const homeOpts = {
  ...(env.CUIS_HOME_DIR ? { home: env.CUIS_HOME_DIR } : {}),
  ...(env.CUIS_ARCHIVE_URL ? { archiveUrl: env.CUIS_ARCHIVE_URL } : {}),
  ...(env.CUIS_ARCHIVE_SHA256 ? { archiveSha256: env.CUIS_ARCHIVE_SHA256 } : {}),
  ...(env.CUIS_PLATFORM ? { platform: env.CUIS_PLATFORM } : {}),
};
const toolOpts = {
  ...(env.CUIS_HOME_DIR ? { home: env.CUIS_HOME_DIR } : {}),
  ...(env.CUIS_PLATFORM ? { platform: env.CUIS_PLATFORM } : {}),
  cwd: env.DRIVER_CWD ? path.resolve(env.DRIVER_CWD) : process.cwd(),
};

// ---- helpers -------------------------------------------------------------------------------
const runDirs = () => readdirSync(tmpdir()).filter((n) => /^cuis-(mcp-)?run-/.test(n)).sort();
const squeakProcs = () => {
  try { return execFileSync('ps', ['-axo', 'pid,command'], { encoding: 'utf8' }).split('\n').filter((l) => /Squeak/.test(l) && !/ps -axo/.test(l)).map((l) => l.trim()); }
  catch { return []; }
};
const homeListing = (dir) => {
  if (!dir || !existsSync(dir)) return [];
  const out = [];
  const walk = (d) => { for (const e of readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); out.push(path.relative(dir, p)); if (e.isDirectory()) walk(p); } };
  walk(dir);
  return out.sort();
};

function parseArgs(argv) {
  const flags = { abortAfter: undefined, parallel: 1 };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--abort-after') flags.abortAfter = Number(argv[++i]);
    else if (argv[i] === '--parallel') flags.parallel = Number(argv[++i]);
    else rest.push(argv[i]);
  }
  return { flags, rest };
}

// ---- in-process tool call ------------------------------------------------------------------
async function callOnce(tool, args, abortAfter) {
  const started = Date.now();
  const controller = new AbortController();
  const timer = abortAfter === undefined ? undefined : setTimeout(() => controller.abort(), abortAfter);
  const res = await tool.handler(args, { signal: controller.signal });
  clearTimeout(timer);
  const text = res.content?.[0]?.text ?? '';
  let parsed;
  try { parsed = JSON.parse(text); } catch { parsed = undefined; }
  return { elapsedMs: Date.now() - started, isError: res.isError === true, text, status: parsed?.status };
}

async function call(rawArgs, flags) {
  let args;
  try { args = JSON.parse(rawArgs); } catch (e) { return fail('invalid_request', `args are not valid JSON: ${e.message}`); }
  const { createRunSmalltalkTool } = await load('runSmalltalk/tool.js');
  const tool = createRunSmalltalkTool(toolOpts);
  const results = await Promise.all(Array.from({ length: flags.parallel }, () => callOnce(tool, args, flags.abortAfter)));
  if (flags.parallel === 1) print({ isError: results[0].isError, elapsedMs: results[0].elapsedMs, result: results[0].text });
  else print({ parallel: flags.parallel, results: results.map((r) => ({ isError: r.isError, elapsedMs: r.elapsedMs, result: r.text })) });
  return results.every((r) => r.status === 'passed') ? 0 : 1;
}

// ---- real stdio server ---------------------------------------------------------------------
// Newline-delimited JSON-RPC, as the SDK StdioServerTransport frames messages.
// The real server takes no home option: it uses os.homedir()/.cuis-mcp-bridge. To keep it on the
// throwaway home, HOME points at a fake dir whose .cuis-mcp-bridge is a symlink to CUIS_HOME_DIR.
function startServer() {
  const childEnv = { ...env };
  if (env.CUIS_HOME_DIR) {
    const home = path.resolve(env.CUIS_HOME_DIR);
    const fakeHome = path.join(path.dirname(home), 'fake-home');
    mkdirSync(home, { recursive: true });
    mkdirSync(fakeHome, { recursive: true });
    if (!existsSync(path.join(fakeHome, '.cuis-mcp-bridge'))) symlinkSync(home, path.join(fakeHome, '.cuis-mcp-bridge'));
    childEnv.HOME = fakeHome;
  }
  const child = spawn(process.execPath, [path.join(serverDir, 'dist/index.js')], { stdio: ['pipe', 'pipe', 'ignore'], env: childEnv, cwd: toolOpts.cwd });
  const pending = new Map();
  let buf = '';
  child.stdout.on('data', (d) => {
    buf += d;
    for (let i; (i = buf.indexOf('\n')) >= 0; ) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
      try { const m = JSON.parse(line); pending.get(m.id)?.(m); pending.delete(m.id); } catch { /* ignore non-JSON */ }
    }
  });
  let nextId = 1;
  const send = (obj) => child.stdin.write(JSON.stringify(obj) + '\n');
  const request = (method, params) => new Promise((resolve) => { const id = nextId++; pending.set(id, resolve); send({ jsonrpc: '2.0', id, method, params }); });
  const exited = new Promise((resolve) => child.once('exit', (code, signal) => resolve({ code, signal })));
  const init = async () => {
    await request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'driver', version: '0' } });
    send({ jsonrpc: '2.0', method: 'notifications/initialized' });
  };
  return { child, request, init, exited };
}

function connections(pid) {
  try { return execFileSync('lsof', ['-a', '-i', '-p', String(pid)], { encoding: 'utf8' }).split('\n').slice(1).filter(Boolean); }
  catch { return []; } // lsof exits 1 when nothing matches
}

async function toolsList() {
  const before = homeListing(env.CUIS_HOME_DIR);
  const s = startServer();
  await s.init();
  const list = await s.request('tools/list', {});
  const names = list.result.tools.map((t) => t.name);
  await sleep(500);
  const net = connections(s.child.pid);
  const after = homeListing(env.CUIS_HOME_DIR);
  s.child.kill('SIGKILL');
  await s.exited;
  const listed = names.includes('run_smalltalk');
  print({ ok: listed, tools: names, runSmalltalkListed: listed, networkConnections: net, homeBefore: before, homeAfter: after, homeUnchanged: JSON.stringify(before) === JSON.stringify(after) });
  return listed ? 0 : 1;
}

async function toolsCall(rawArgs, abortDelay) {
  let args;
  try { args = JSON.parse(rawArgs); } catch (e) { return fail('invalid_request', `args are not valid JSON: ${e.message}`); }
  const dirsBefore = runDirs();
  const s = startServer();
  await s.init();
  const started = Date.now();
  const call = s.request('tools/call', { name: 'run_smalltalk', arguments: args });
  if (abortDelay === undefined) {
    const res = await call;
    s.child.stdin.end();
    await s.exited;
    const text = res.result?.content?.[0]?.text ?? JSON.stringify(res);
    print({ isError: res.result?.isError === true, elapsedMs: Date.now() - started, result: text });
    let status; try { status = JSON.parse(text).status; } catch { /* not JSON */ }
    return status === 'passed' ? 0 : 1;
  }
  await sleep(abortDelay);
  const squeakDuring = squeakProcs();
  const dirsDuring = runDirs().filter((d) => !dirsBefore.includes(d));
  s.child.kill('SIGTERM');
  const exit = await Promise.race([s.exited, sleep(15000).then(() => 'still running after 15 s')]);
  if (exit === 'still running after 15 s') s.child.kill('SIGKILL');
  await sleep(1500); // let the killed instance and its cleanup settle
  const leftoverDirs = runDirs().filter((d) => !dirsBefore.includes(d));
  print({ ok: leftoverDirs.length === 0, serverExit: exit, newRunDirsDuringRun: dirsDuring, squeakDuringRun: squeakDuring, leftoverRunDirs: leftoverDirs, leftoverSqueakProcesses: squeakProcs() });
  return leftoverDirs.length === 0 ? 0 : 1;
}

// ---- snapshot / home -----------------------------------------------------------------------
function snapshot() {
  const home = env.CUIS_HOME_DIR ?? path.join(process.env.HOME ?? '', '.cuis-mcp-bridge');
  const base = {};
  const cuisRoot = path.join(home, 'cuis');
  if (existsSync(cuisRoot)) {
    for (const v of readdirSync(cuisRoot)) {
      const dir = path.join(cuisRoot, v, 'base');
      if (!existsSync(dir)) continue;
      const walk = (d) => { for (const e of readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (statSync(p).isFile()) base[path.relative(home, p)] = createHash('sha256').update(readFileSync(p)).digest('hex'); } };
      walk(dir);
    }
  }
  print({ home, baseHashes: base, runDirs: runDirs() });
  return 0;
}

async function homeCommand(command) {
  const { cuisHomeStatus, prepareCuisHome } = await load('cuisHome/cuisHome.js');
  if (command === 'status') { print(await cuisHomeStatus(homeOpts)); return 0; }
  if (command === 'prepare') { print({ ok: true, result: await prepareCuisHome(homeOpts) }); return 0; }
  const deadline = Date.now() + 15 * 60 * 1000;
  for (;;) {
    const status = await cuisHomeStatus(homeOpts);
    if (status.state === 'ready') { print(status); return 0; }
    if (status.state === 'failed') { print(status); return 1; }
    if (Date.now() >= deadline) return fail('wait_timeout', `still ${status.state} after 15 minutes`);
    await sleep(2000);
  }
}

async function main() {
  const { flags, rest } = parseArgs(process.argv.slice(2));
  const [command, arg] = rest;
  switch (command) {
    case 'status': case 'prepare': case 'wait': return homeCommand(command);
    case 'call': return arg ? call(arg, flags) : fail('invalid_request', "usage: call '<json args>'");
    case 'callfile': return arg ? call(readFileSync(path.resolve(arg), 'utf8'), flags) : fail('invalid_request', 'usage: callfile <args.json>');
    case 'tools-list': return toolsList();
    case 'tools-call': return arg ? toolsCall(arg) : fail('invalid_request', "usage: tools-call '<json args>'");
    case 'tools-abort': return arg ? toolsCall(arg, Number(rest[2] ?? 5000)) : fail('invalid_request', "usage: tools-abort '<json args>' [delayMs=5000]");
    case 'snapshot': return snapshot();
    default: return fail('invalid_request', 'usage: status | prepare | wait | call | callfile | tools-list | tools-call | tools-abort | snapshot');
  }
}

main().then(
  (code) => { process.exitCode = code; },
  (err) => { print({ ok: false, error: { code: err?.code ?? 'internal_error', message: err instanceof Error ? err.message : String(err) } }); process.exitCode = 1; },
);

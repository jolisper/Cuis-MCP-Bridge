import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);

export interface Harness {
  root: string;
  home: string;
  upstreamUrl: string;
  git: string;
  argvLog(): Promise<string[][]>;
  argvMark(): Promise<number>;
  argvSince(mark: number): Promise<string[][]>;
  pushUpstream(files: Record<string, string>, message: string): Promise<string>;
  cloneMirror(home?: string): Promise<void>;
  freshHome(): Promise<string>;
  releaseClone(): Promise<void>;
  failGit(subcommand: string, failure: GitFailure): Promise<void>;
  clearGitFailures(): Promise<void>;
  cleanup(): Promise<void>;
}

export type GitFailure = { stderr: string } | { signal: 'KILL' } | { flood: true };

const gitEnv = { ...process.env, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' };
const pushEnv = {
  ...gitEnv,
  GIT_AUTHOR_NAME: 'test',
  GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'test',
  GIT_COMMITTER_EMAIL: 'test@example.com',
};

async function resolveRealGit(): Promise<string> {
  const { stdout } = await execFileP('sh', ['-c', 'command -v git']);
  return stdout.trim();
}

function shQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

export async function createHarness(opts: { gated?: boolean } = {}): Promise<Harness> {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'vm-mirror-test-')));
  const home = path.join(root, 'home');
  const upstreamUrl = path.join(root, 'upstream.git');
  const scratch = path.join(root, 'scratch');
  const binDir = path.join(root, 'bin');
  const git = path.join(binDir, 'git');
  const logPath = path.join(root, 'argv.log');
  const doneLogPath = path.join(root, 'done.log');
  const gatePath = path.join(root, 'gate');
  const releasePath = path.join(root, 'release');
  const failPrefix = path.join(root, 'fail-');
  const killPrefix = path.join(root, 'kill-');
  const floodPrefix = path.join(root, 'flood-');
  const failurePrefixes = [failPrefix, killPrefix, floodPrefix];

  const realGit = await resolveRealGit();
  const run = (args: string[], cwd?: string) => execFileP(realGit, args, { cwd, env: gitEnv });

  await run(['init', '--bare', '--initial-branch=Cog', upstreamUrl]);
  await run(['clone', '--quiet', upstreamUrl, scratch]);
  await fs.writeFile(path.join(scratch, 'README'), 'test upstream\n');
  await run(['add', 'README'], scratch);
  await run(['-c', 'user.name=test', '-c', 'user.email=test@example.com', 'commit', '--quiet', '-m', 'initial'], scratch);
  await run(['push', '--quiet', 'origin', 'HEAD:Cog'], scratch);
  await fs.rm(scratch, { recursive: true, force: true });

  const script = `#!/bin/sh
LOG=${shQuote(logPath)}
DONE=${shQuote(doneLogPath)}
GATE=${shQuote(gatePath)}
RELEASE=${shQuote(releasePath)}
# Build the whole line first and append it with one write, so a reader never sees a
# partial line and concurrent wrappers never interleave within one.
tab=$(printf '\\t')
line=""
first=1
for a in "$@"; do
  if [ $first -eq 1 ]; then line="$a"; first=0; else line="$line$tab$a"; fi
done
printf '%s\\n' "$line" >> "$LOG"
if [ -e "$GATE" ]; then
  for a in "$@"; do
    if [ "$a" = "clone" ]; then
      # Also give up once the harness is gone (gate removed with root) or our parent died,
      # so a torn-down or killed test can't leave this loop polling forever.
      while [ -e "$GATE" ] && [ ! -e "$RELEASE" ] && kill -0 "$PPID" 2>/dev/null; do sleep 0.05; done
      break
    fi
  done
fi
sub=""
for a in "$@"; do
  case "$a" in -*) ;; *) sub="$a"; break ;; esac
done
FAIL=${shQuote(failPrefix)}"$sub"
if [ -e "$FAIL" ]; then
  cat "$FAIL" >&2
  printf 'x\\n' >> "$DONE"
  exit 128
fi
KILLF=${shQuote(killPrefix)}"$sub"
if [ -e "$KILLF" ]; then
  printf 'x\\n' >> "$DONE"
  kill -KILL $$
fi
FLOOD=${shQuote(floodPrefix)}"$sub"
if [ -e "$FLOOD" ]; then
  head -c 68157440 /dev/zero
  printf 'x\\n' >> "$DONE"
  exit 0
fi
${shQuote(realGit)} "$@"
status=$?
printf 'x\\n' >> "$DONE"
exit $status
`;
  await fs.mkdir(binDir);
  await fs.writeFile(git, script);
  await fs.chmod(git, 0o755);

  if (opts.gated) await fs.writeFile(gatePath, '');

  const releaseClone = async () => {
    await fs.writeFile(releasePath, '');
  };

  const argvLog = async () => {
    let text: string;
    try {
      text = await fs.readFile(logPath, 'utf8');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw e;
    }
    const lines = text.split('\n');
    lines.pop(); // '' after the final newline, or a line still being written
    return lines
      .filter((line) => line !== '')
      .map((line) => line.split('\t'));
  };

  const work = path.join(root, 'work');
  const runPush = (args: string[]) => execFileP(realGit, args, { cwd: work, env: pushEnv });
  let homeCount = 0;

  return {
    root,
    home,
    upstreamUrl,
    git,
    argvLog,
    async argvMark() {
      return (await argvLog()).length;
    },
    async argvSince(mark: number) {
      return (await argvLog()).slice(mark);
    },
    async pushUpstream(files: Record<string, string>, message: string) {
      try {
        await fs.access(work);
      } catch {
        await run(['clone', '--quiet', upstreamUrl, work]);
      }
      await runPush(['fetch', '--quiet', 'origin']);
      await runPush(['reset', '--hard', '--quiet', 'origin/Cog']);
      for (const [rel, content] of Object.entries(files)) {
        const p = path.join(work, rel);
        await fs.mkdir(path.dirname(p), { recursive: true });
        await fs.writeFile(p, content);
      }
      await runPush(['add', '--', ...Object.keys(files)]);
      await runPush(['commit', '--quiet', '--cleanup=verbatim', '-m', message]);
      await runPush(['push', '--quiet', 'origin', 'HEAD:Cog']);
      const { stdout } = await runPush(['rev-parse', 'HEAD']);
      return stdout.trim();
    },
    async cloneMirror(target: string = home) {
      await fs.mkdir(target, { recursive: true });
      await run(['clone', '--bare', '--quiet', upstreamUrl, path.join(target, 'vm-mirror')]);
    },
    async freshHome() {
      homeCount += 1;
      return path.join(root, `home-${homeCount}`);
    },
    releaseClone,
    async failGit(subcommand: string, failure: GitFailure) {
      const [prefix, contents] =
        'signal' in failure ? [killPrefix, '']
        : 'flood' in failure ? [floodPrefix, '']
        : [failPrefix, failure.stderr];
      await fs.writeFile(prefix + subcommand, contents);
    },
    async clearGitFailures() {
      for (const name of await fs.readdir(root)) {
        const p = path.join(root, name);
        if (failurePrefixes.some((prefix) => p.startsWith(prefix))) await fs.rm(p, { force: true });
      }
    },
    async cleanup() {
      await releaseClone();
      const lineCount = (p: string) =>
        fs.readFile(p, 'utf8').then((t) => t.split('\n').length - 1, () => 0);
      await waitFor(async () => (await lineCount(doneLogPath)) >= (await lineCount(logPath)), 5000).catch(() => {});
      await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    },
  };
}

export async function waitFor(
  cond: () => boolean | Promise<boolean>,
  timeoutMs = 10000,
  intervalMs = 25,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await cond()) return;
    if (Date.now() >= deadline) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

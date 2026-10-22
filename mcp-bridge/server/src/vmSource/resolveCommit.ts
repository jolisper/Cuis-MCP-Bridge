/**
 * Locates commits on the mirror's Cog branch: resolveCommit finds the commits that introduced a
 * VMMaker.oscog-<author>.N token in the generated interpreter source, and stampWindowCommit narrows
 * them to the commit whose plugin file carries the running module stamp. Both refresh the mirror
 * with a shared, single-flight fetch when the local branch lacks the answer.
 */
import { transferError, VmSourceError } from './errors.js';
import { moduleStamp } from './cSource.js';
import { isLockContention, probeGit, readGit, runGit } from './git.js';
import { mirrorPath, type MirrorOptions } from './mirror.js';

export type VmSourceOptions = MirrorOptions;

/** Pickaxe result: all hit SHAs oldest first, and `commit` = `hits[0]`. */
export interface ResolvedCommit {
  commit: string;
  hits: string[];
}

/** In-flight fetch per mirror directory, shared by concurrent calls. */
const inFlightFetches = new Map<string, Promise<void>>();

/**
 * Returns every Cog commit (oldest first) whose cointerp.c/interp.c changed the count of `<token>]`, where `token` is the full name, e.g. `VMMaker.oscog-eem.3794`, as `hits`; `commit` is the first (oldest) hit.
 *
 * Sequence: note the Cog tip (rev-parse), then pickaxe the local Cog branch; if found, return
 * without fetching. On a miss, read the Cog tip again: if another fetch moved it meanwhile, pickaxe
 * again and return if found. Only a call that still misses fetches Cog (see fetchCog) and pickaxes
 * once more; still nothing → `commit_not_found` naming the token.
 *
 * Mirror reads (rev-parse, pickaxe) go through readGit: a git-reported failure surfaces as
 * `mirror_corrupt` naming the mirror and setup_vm_mirror. The fetch itself stays on runGit.
 *
 * Concurrent calls on the same mirror share one in-flight fetch (inFlightFetches); each caller then
 * runs its own pickaxe, and a failed fetch rejects all of them alike.
 */
export async function resolveCommit(opts: VmSourceOptions, token: string): Promise<ResolvedCommit> {
  const tip = await readGit(opts, ['rev-parse', 'Cog']);
  const local = await pickaxe(opts, token);
  if (local.length) return resolved(local);
  if ((await readGit(opts, ['rev-parse', 'Cog'])) !== tip) {
    const moved = await pickaxe(opts, token);
    if (moved.length) return resolved(moved);
  }
  await fetchShared(opts);
  const fetched = await pickaxe(opts, token);
  if (fetched.length) return resolved(fetched);
  throw new VmSourceError('commit_not_found', 'no commit on Cog carries ' + token);
}

/** Fetches Cog, sharing one in-flight fetch among concurrent callers on the same mirror. */
async function fetchShared(opts: VmSourceOptions): Promise<void> {
  const dir = mirrorPath(opts.home);
  let pending = inFlightFetches.get(dir);
  if (!pending) {
    pending = fetchCog(opts).finally(() => inFlightFetches.delete(dir));
    inFlightFetches.set(dir, pending);
  }
  await pending;
}

/**
 * Finds the commit within the token's window whose `path` file carries the running `stamp`.
 *
 * The window starts at `hits[0]` and ends where the token stops appearing in cointerp.c/interp.c:
 * the first later hit without `<token>]` replaces it (closed window, ends at its parent). With no
 * such hit the window is open and ends at `Cog`. Candidates are `hits[0]` then the first-parent
 * commits touching `path` in the window, oldest first; the first whose `moduleStamp` equals
 * `running` is returned. A commit where `path` doesn't exist is no match.
 *
 * No match in a closed window → `undefined`, without fetching. No match in an open window means the
 * mirror may predate the build: note the Cog tip, fetch once (shared in-flight fetch; a fetch failure
 * propagates), then look only at the new commits `oldTip..Cog`: the window's end is re-derived from the
 * new pickaxe hits (never the full pickaxe), and the first new commit touching `path` whose
 * `moduleStamp` equals `running` is returned, else `undefined`.
 */
export async function stampWindowCommit(
  opts: VmSourceOptions,
  token: string,
  hits: string[],
  path: string,
  running: string,
): Promise<string | undefined> {
  const window = await windowEnd(opts, token, hits.slice(1));
  const touching = await readGit(opts, [
    'rev-list',
    '--reverse',
    '--first-parent',
    hits[0] + '..' + window.end,
    '--',
    path,
  ]);
  const candidates = [hits[0], ...touching.split('\n').filter((line) => line !== '')];
  const found = await firstWithStamp(opts, candidates, path, running);
  if (found || !window.open) return found;
  const oldTip = (await readGit(opts, ['rev-parse', 'Cog'])).trim();
  await fetchShared(opts);
  const newHits = (
    await readGit(opts, [
      'log',
      oldTip + '..Cog',
      '--reverse',
      '--format=%H',
      '-S' + token + ']',
      '--',
      'src/*/cointerp.c',
      'src/*/interp.c',
    ])
  )
    .split('\n')
    .filter((line) => line !== '');
  const newWindow = await windowEnd(opts, token, newHits);
  const fresh = await readGit(opts, [
    'rev-list',
    '--reverse',
    '--first-parent',
    oldTip + '..' + newWindow.end,
    '--',
    path,
  ]);
  return firstWithStamp(
    opts,
    fresh.split('\n').filter((line) => line !== ''),
    path,
    running,
  );
}

/** First of `candidates` (in order) whose `path` carries the `running` module stamp. */
async function firstWithStamp(
  opts: VmSourceOptions,
  candidates: string[],
  path: string,
  running: string,
): Promise<string | undefined> {
  for (const sha of candidates) {
    let text: string;
    try {
      text = await readGit(opts, ['show', sha + ':' + path]);
    } catch (err) {
      if (/does not exist in|exists on disk, but not in/.test((err as Error).message)) continue;
      throw err;
    }
    if (moduleStamp(text) === running) return sha;
  }
  return undefined;
}

/**
 * End of the token's window: closed at the parent of the first later hit that no longer carries
 * `<token>]`, else open and ending at `Cog`.
 */
async function windowEnd(
  opts: VmSourceOptions,
  token: string,
  laterHits: string[],
): Promise<{ end: string; open: boolean }> {
  for (const hit of laterHits) {
    const carries = await probeGit(opts, [
      'grep',
      '-q',
      '-F',
      token + ']',
      hit,
      '--',
      'src/*/cointerp.c',
      'src/*/interp.c',
    ]);
    if (!carries) return { end: hit + '^', open: false };
  }
  return { end: 'Cog', open: true };
}

/**
 * Fetches Cog from origin once, without retry. Ref-lock contention (another process fetching into
 * the mirror) → `mirror_busy` at once. Otherwise a `VmSourceError` from runGit (git_unavailable,
 * internal_error) passes through unchanged, and a git-reported failure becomes `transferError(stderr)`:
 * `fetch_failed` for network failures, `mirror_write_failed` otherwise, embedding git's trimmed stderr.
 */
async function fetchCog(opts: VmSourceOptions): Promise<void> {
  try {
    await runGit(opts, ['fetch', '--quiet', 'origin', '+refs/heads/Cog:refs/heads/Cog']);
  } catch (err) {
    const stderr = (err as { stderr?: string }).stderr ?? '';
    if (isLockContention(stderr)) {
      throw new VmSourceError(
        'mirror_busy',
        'another session is fetching into the VM source mirror; try again once it has finished',
      );
    }
    if (err instanceof VmSourceError) throw err;
    throw transferError(stderr);
  }
}

function resolved(hits: string[]): ResolvedCommit {
  return { commit: hits[0], hits };
}

/** Runs the pickaxe search on the local Cog branch and resolves to every hit SHA, oldest first (empty when none). */
async function pickaxe(opts: VmSourceOptions, token: string): Promise<string[]> {
  const out = await readGit(opts, [
    'log',
    'Cog',
    '--reverse',
    '--format=%H',
    '-S' + token + ']',
    '--',
    'src/*/cointerp.c',
    'src/*/interp.c',
  ]);
  return out.split('\n').filter((line) => line !== '');
}

/**
 * Looks up a primitive's generated C source in the VM source mirror.
 */
import { externalCalls, findExport, findTableSlot, helpers, indexFunctions, moduleStamp } from './cSource.js';
import { VmSourceError } from './errors.js';
import { asMirrorError, readGit, runGit } from './git.js';
import { planLookup, type LookupPlan } from './lookupPlan.js';
import { mirrorState } from './mirror.js';
import { resolveCommit, stampWindowCommit, type VmSourceOptions } from './resolveCommit.js';

export interface VmSourceResult {
  function: string;
  generatedFrom: string | null;
  helpers: { name: string; source: string }[];
  externalCalls: { name: string; kind: 'vm_interface' | 'platform_code_unavailable' }[];
  metadata: {
    commit: string;
    path: string;
    lines: { start: number; end: number };
    dispatch: { kind: 'exports' | 'primitiveTable'; entry: string };
    shared?: { reason: 'quick_primitive' | 'external_call'; applies: string };
    defaults: ('cog_variant' | 'plain_rendering')[];
    rendering?: 'plain' | 'gcc3x';
    moduleStampCheck?: { result: 'match' | 'mismatch' | 'not_verifiable'; running?: string; source?: string };
  };
  caveats: string[];
}

type Metadata = VmSourceResult['metadata'];
type Default = Metadata['defaults'][number];

/** Module stamps reported by the running VM. */
type ModuleStamps = { builtin?: string[]; loaded?: string[] };

/** Caveat sentences for each applied default, emitted in this order. */
const DEFAULT_ORDER: readonly Default[] = ['cog_variant', 'plain_rendering'];
const DEFAULT_CAVEATS: Record<Default, string> = {
  cog_variant:
    "The build variant (cog, cog.lowcode or sista) could not be determined, so this is the cog variant's source; the running VM may have been built from a different variant.",
  plain_rendering:
    'No platformName was given, so this is the plain C rendering (cointerp.c); the running VM may have been compiled from the GCC-optimized rendering (gcc3x-cointerp.c).',
};

/** The dispatching function for `key`, how it was found, and any shared-dispatcher note. */
function dispatchFor(
  text: string,
  key: LookupPlan['key'],
): { fn: string; dispatch: Metadata['dispatch']; shared?: Metadata['shared']; sharedCaveat?: string } {
  if (key.kind === 'named') {
    const { fn, row } = findExport(text, key.name);
    return { fn, dispatch: { kind: 'exports', entry: row } };
  }
  const { fn, row, shared } = findTableSlot(text, key.index);
  const dispatch: Metadata['dispatch'] = { kind: 'primitiveTable', entry: row };
  if (!shared) return { fn, dispatch };
  const sharedCaveat = `Primitive ${key.index} has no function of its own; it is served by the shared dispatcher ${fn}, and only this part applies: ${shared.applies}.`;
  return { fn, dispatch, shared, sharedCaveat };
}

/** The running VM's stamp for plugin `name` (first word match), without its ` (i)`/` (e)` suffix. */
function reportedStamp(name: string, moduleStamps: ModuleStamps): string | undefined {
  const reported = [...(moduleStamps.builtin ?? []), ...(moduleStamps.loaded ?? [])];
  return reported.find((s) => s.split(' ')[0] === name)?.replace(/ \([ie]\)$/, '');
}

/** Checks the file's module stamp against the running VM's reported stamps, with any caveat. */
function stampCheck(
  text: string,
  moduleStamps: ModuleStamps,
): { check: NonNullable<Metadata['moduleStampCheck']>; caveat?: string } {
  const source = moduleStamp(text);
  if (source === undefined) {
    return {
      check: { result: 'not_verifiable' },
      caveat: 'The returned source carries no moduleName stamp, so it could not be checked against the running VM.',
    };
  }
  const name = source.split(' ')[0];
  const running = reportedStamp(name, moduleStamps);
  if (running === undefined) {
    return {
      check: { result: 'not_verifiable', source },
      caveat: `The running VM reports no stamp for ${name}, so the returned source ('${source}') could not be checked against it.`,
    };
  }
  if (running === source) return { check: { result: 'match' } };
  return {
    check: { result: 'mismatch', running, source },
    caveat: `The running VM reports stamp '${running}' for this plugin, but the returned source carries '${source}'; they may differ.`,
  };
}

/** The running VM's stamp for the plugin `text` is stamped with, or undefined when either is unknown. */
function runningStamp(text: string, moduleStamps: ModuleStamps): string | undefined {
  const source = moduleStamp(text);
  if (source === undefined) return undefined;
  return reportedStamp(source.split(' ')[0], moduleStamps);
}

/** Throws `mirror_missing` / `mirror_initializing` unless the mirror is ready; never starts a clone. */
async function requireReadyMirror(opts: VmSourceOptions): Promise<void> {
  const state = await mirrorState(opts);
  if (state === 'missing') {
    throw new VmSourceError(
      'mirror_missing',
      'the VM source mirror is not set up; call setup_vm_mirror, then retry get_vm_source',
    );
  }
  if (state === 'initializing') {
    throw new VmSourceError('mirror_initializing', 'the VM source mirror is still being cloned; retry get_vm_source later');
  }
}

/** Throws `module_not_found` unless `src/plugins/<module>` exists at `commit`. */
async function requireModule(opts: VmSourceOptions, commit: string, module: string): Promise<void> {
  const plugins = await readGit(opts, ['ls-tree', '--name-only', commit, 'src/plugins/']);
  if (!plugins.split('\n').includes('src/plugins/' + module)) {
    throw new VmSourceError('module_not_found', `no plugin '${module}' at commit ${commit}`);
  }
}

/**
 * Reads `path` at `commit` via `git show`. Throws `path_not_found` when git reports the file is
 * absent at that commit, `mirror_corrupt` for any other git-reported failure; a `VmSourceError`
 * from `runGit` passes through unchanged.
 */
async function readFile(opts: VmSourceOptions, commit: string, path: string): Promise<string> {
  try {
    return await runGit(opts, ['show', commit + ':' + path]);
  } catch (e) {
    const stderr = (e as { stderr?: string }).stderr;
    if (!(e instanceof VmSourceError) && stderr !== undefined && /does not exist in|exists on disk, but not in/.test(stderr)) {
      throw new VmSourceError('path_not_found', `${path} does not exist at commit ${commit}`);
    }
    throw asMirrorError(opts, e);
  }
}

/**
 * The commit to serve and the file text there: the resolved commit, unless `module` and
 * `moduleStamps` are given and its stamp differs from the running VM's, in which case the window
 * commit carrying the running stamp (when one exists).
 */
async function pickCommit(
  opts: VmSourceOptions,
  plan: LookupPlan,
  resolved: Awaited<ReturnType<typeof resolveCommit>>,
  moduleStamps: ModuleStamps | undefined,
): Promise<{ commit: string; text: string }> {
  if (plan.module !== undefined) await requireModule(opts, resolved.commit, plan.module);
  const text = await readFile(opts, resolved.commit, plan.path);
  if (plan.module === undefined || moduleStamps === undefined) return { commit: resolved.commit, text };
  const running = runningStamp(text, moduleStamps);
  if (running === undefined || running === moduleStamp(text)) return { commit: resolved.commit, text };
  const picked = await stampWindowCommit(opts, plan.token, resolved.hits, plan.path, running);
  if (picked === undefined || picked === resolved.commit) return { commit: resolved.commit, text };
  return { commit: picked, text: await readFile(opts, picked, plan.path) };
}

/**
 * Resolves the primitive named by `args` to its source at the pinned commit.
 *
 * Steps, in order: mirror readiness → {@link planLookup} (type guards, `invalid_request`,
 * then planning) → {@link resolveCommit} → when `module` is given, {@link requireModule}
 * (`module_not_found`, before the module is used as a path) → read the file via
 * `git show <sha>:<path>` (`path_not_found` when absent at the commit) → when `module` and
 * `moduleStamps` are given and the file's stamp differs from the running VM's, switch to the
 * commit in the window ({@link stampWindowCommit}) whose file carries the running stamp → dispatch lookup, function, helpers and external calls → module
 * stamp check (only when `module` and `moduleStamps` are given) → assemble the result and caveats.
 */
export async function getVmSource(opts: VmSourceOptions, args: Record<string, unknown>): Promise<VmSourceResult> {
  await requireReadyMirror(opts);
  const plan = planLookup(args);
  const resolved = await resolveCommit(opts, plan.token);
  const moduleStamps = args.moduleStamps as ModuleStamps | undefined;
  const { commit, text } = await pickCommit(opts, plan, resolved, moduleStamps);
  const { fn, dispatch, shared, sharedCaveat } = dispatchFor(text, plan.key);
  const index = indexFunctions(text);
  const entry = index.get(fn);
  if (entry === undefined) throw new VmSourceError('symbol_not_found', `no definition of '${fn}' in ${plan.path}`);
  const caveats = DEFAULT_ORDER.filter((d) => plan.defaults.includes(d)).map((d) => DEFAULT_CAVEATS[d]);
  if (sharedCaveat) caveats.push(sharedCaveat);
  const stamp = plan.module !== undefined && moduleStamps !== undefined ? stampCheck(text, moduleStamps) : undefined;
  if (stamp?.caveat) caveats.push(stamp.caveat);
  return {
    function: entry.source,
    generatedFrom: entry.generatedFrom ?? null,
    helpers: helpers(fn, index),
    externalCalls: externalCalls(fn, index, text),
    metadata: {
      commit,
      path: plan.path,
      lines: { start: entry.start, end: entry.end },
      dispatch,
      ...(shared ? { shared } : {}),
      defaults: plan.defaults,
      ...(plan.rendering ? { rendering: plan.rendering } : {}),
      ...(stamp ? { moduleStampCheck: stamp.check } : {}),
    },
    caveats,
  };
}

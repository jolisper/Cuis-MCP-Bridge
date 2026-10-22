import os from 'node:os';
import path from 'node:path';
import type { ToolCallResult, ToolDefinition } from '../tools.js';
import { VmSourceError } from './errors.js';
import { getVmSource } from './getVmSource.js';
import { setupVmMirror } from './mirror.js';
import type { VmSourceOptions } from './resolveCommit.js';

/** Default home directory name, resolved under the user's home on each call. */
const DEFAULT_HOME_DIRNAME = '.cuis-mcp-bridge';
const DEFAULT_UPSTREAM_URL = 'https://github.com/OpenSmalltalk/opensmalltalk-vm.git';
const DEFAULT_GIT = 'git';

/** Map a handler failure to an MCP error result: `"<code>: <message>"` for a `VmSourceError`, else the plain message. */
function errorResult(err: unknown): ToolCallResult {
  const message =
    err instanceof VmSourceError
      ? `${err.code}: ${err.message}`
      : err instanceof Error
        ? err.message
        : 'Unknown error';
  return { content: [{ type: 'text', text: message }], isError: true };
}

/** Build the VM source tools (`setup_vm_mirror`, `get_vm_source`), optionally overriding their options. */
export function createVmSourceTools(opts: Partial<VmSourceOptions> = {}): ToolDefinition[] {
  const vmSource: VmSourceOptions = {
    home: opts.home ?? path.join(os.homedir(), DEFAULT_HOME_DIRNAME),
    upstreamUrl: opts.upstreamUrl ?? DEFAULT_UPSTREAM_URL,
    git: opts.git ?? DEFAULT_GIT,
  };
  return [
    {
      name: 'setup_vm_mirror',
      description:
        'Make sure the shared local mirror of the OpenSmalltalk VM repository exists. ' +
        "Returns immediately with { status }: 'ready' (mirror exists), 'in_progress' " +
        "(a clone is already running) or 'started' (a background clone, about 750 MB, " +
        'has just begun). The mirror lives in ~/.cuis-mcp-bridge/vm-mirror and is shared ' +
        'across projects. If the background clone fails, the next call reports it (fetch_failed, or ' +
        'mirror_write_failed for any other cause) and the call after that retries. ' +
        'The tool needs git (git_unavailable).',
      inputSchema: { type: 'object', properties: {} },
      handler: async (): Promise<ToolCallResult> => {
        try {
          const status = await setupVmMirror(vmSource);
          return { content: [{ type: 'text', text: JSON.stringify({ status }) }] };
        } catch (err) {
          return errorResult(err);
        }
      },
    },
    {
      name: 'get_vm_source',
      description:
        "Use this when a method's source from get_method_source contains a <primitive: N> or " +
        "<primitive: 'name' module: 'Module'> pragma and you need to see what the VM actually does " +
        'for it; a method without a primitive pragma has no VM source. ' +
        'Return one VM C function as JSON { function, generatedFrom, helpers, externalCalls, ' +
        'metadata, caveats }, read from the exact upstream commit the running VM was built from. ' +
        'Call order: get_method_source, then get_vm_version, then get_platform_name / ' +
        'get_platform_subtype as required, then optionally get_loaded_modules, then get_vm_source. ' +
        'Pass every input exactly as the Cuis-side tools returned it: vmVersion from get_vm_version ' +
        '(including the build suffix); lookupKey straight off the pragma (a number for numbered ' +
        'primitives, the name string for named ones); module from the pragma; platformName and ' +
        'platformSubtype from get_platform_name and get_platform_subtype; moduleStamps from ' +
        'get_loaded_modules. Platform parameters: ordinary plugin module, neither required; ' +
        'SqueakFFIPrims, platformName and platformSubtype required; no module, platformSubtype ' +
        'required and platformName optional (without it the plain cointerp.c rendering is returned). ' +
        'A mirror_missing error means call setup_vm_mirror and retry later. A lookup for a VM ' +
        'version newer than the mirror fetches from upstream first and can take tens of seconds; ' +
        'tell the user when a call may be fetching. A mirror_busy error means another session is ' +
        'fetching into the mirror: tell the user so, and retry only once it has finished. ' +
        'A mirror_corrupt error means tell the user to delete the mirror and run setup_vm_mirror ' +
        '(the mirror is at ~/.cuis-mcp-bridge/vm-mirror). ' +
        'A fetch_failed error means upstream could not be reached. ' +
        'An internal_error is an unexpected host-side failure that may be transient; do not delete ' +
        'the mirror because of it. State ' +
        'every caveat when explaining the function, and never present a defaulted source as the ' +
        'exact compiled one.',
      inputSchema: {
        type: 'object',
        properties: {
          vmVersion: { type: 'string', description: 'VM version string as returned by get_vm_version.' },
          lookupKey: { type: ['string', 'number'], description: 'Primitive number or name as returned by get_method_source.' },
          module: { type: 'string', description: 'Plugin module name, if any.' },
          platformName: { type: 'string', description: 'Platform name as returned by get_platform_name.' },
          platformSubtype: { type: 'string', description: 'Platform subtype as returned by get_platform_subtype.' },
          moduleStamps: { type: 'object', description: 'Loaded module stamps as returned by get_loaded_modules.' },
        },
        required: ['vmVersion', 'lookupKey'],
      },
      handler: async (args): Promise<ToolCallResult> => {
        try {
          const result = await getVmSource(vmSource, args);
          return { content: [{ type: 'text', text: JSON.stringify(result) }] };
        } catch (err) {
          return errorResult(err);
        }
      },
    },
  ];
}

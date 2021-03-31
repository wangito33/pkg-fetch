import { stat } from 'fs-extra';
import path from 'path';
import semver from 'semver';
import {
  abiToNodeRange,
  hostArch,
  hostPlatform, // eslint-disable-line no-duplicate-imports
  isValidNodeRange,
  knownArchs,
  toFancyArch,
  toFancyPlatform,
} from './system';
import * as system from './system';
import { localPlace, remotePlace, Remote } from './places';
import { log, wasReported } from './log';
import build from './build';
import { downloadUrl } from './requests';
import patchesJson from '../patches/patches.json';
import { plusx } from './chmod';
import { version } from '../package.json';

async function download(
  { tag, name }: Remote,
  local: string
): Promise<boolean> {
  const url = `https://github.com/vercel/pkg-fetch/releases/download/${tag}/${name}`;

  try {
    await downloadUrl(url, local);
    await plusx(local);
  } catch {
    return false;
  }

  return true;
}

async function exists(file: string) {
  try {
    await stat(file);
    return true;
  } catch (error) {
    return false;
  }
}

interface NeedOptions {
  forceFetch?: boolean;
  forceBuild?: boolean;
  dryRun?: boolean;
  nodeRange: string;
  platform: string;
  arch: string;
}

export async function need(opts: NeedOptions) {
  // eslint-disable-line complexity
  const { forceFetch, forceBuild, dryRun } = opts || {};
  let { nodeRange, platform, arch } = opts || {};

  if (!nodeRange) throw wasReported('nodeRange not specified');
  if (!platform) throw wasReported('platform not specified');
  if (!arch) throw wasReported('arch not specified');

  nodeRange = abiToNodeRange(nodeRange); // 'm48' -> 'node6'

  if (!isValidNodeRange(nodeRange)) {
    throw wasReported("nodeRange must start with 'node'");
  }

  if (nodeRange !== 'latest') {
    nodeRange = `v${nodeRange.slice(4)}`; // 'node6' -> 'v6' for semver
  }

  platform = toFancyPlatform(platform); // win32 -> win
  arch = toFancyArch(arch); // ia32 -> x86

  function satisfyingNodeVersion() {
    const versions = Object.keys(patchesJson)
      .filter((nv) => semver.satisfies(nv, nodeRange) || nodeRange === 'latest')
      .sort((nv1, nv2) => (semver.gt(nv1, nv2) ? 1 : -1));

    return versions.pop();
  }

  const nodeVersion = satisfyingNodeVersion();

  if (!nodeVersion) {
    throw wasReported(
      `No available node version satisfies '${opts.nodeRange}'`
    );
  }

  const fetched = localPlace({
    from: 'fetched',
    arch,
    nodeVersion,
    platform,
    version,
  });
  const built = localPlace({
    from: 'built',
    arch,
    nodeVersion,
    platform,
    version,
  });
  const remote = remotePlace({ arch, nodeVersion, platform, version });

  let fetchFailed;

  if (!forceBuild) {
    if (await exists(fetched)) {
      return dryRun ? 'exists' : fetched;
    }
  }

  if (!forceFetch) {
    if (await exists(built)) {
      if (dryRun) return 'exists';
      if (forceBuild) log.info('Reusing base binaries built locally:', built);

      return built;
    }
  }

  if (!forceBuild) {
    if (dryRun) return 'fetched';
    if (await download(remote, fetched)) return fetched;

    fetchFailed = true;
  }

  if (!dryRun && fetchFailed) {
    log.info('Not found in remote cache:', JSON.stringify(remote));
    if (forceFetch) {
      throw wasReported(`Failed to fetch.`);
    }
  }

  if (!dryRun) {
    log.info('Building base binary from source:', path.basename(built));
  }

  if (hostPlatform !== platform) {
    throw wasReported(
      `Not able to build for '${opts.platform}' here, only for '${hostPlatform}'`
    );
  }

  if (hostArch !== arch) {
    throw wasReported(
      `Not able to build for '${opts.arch}' here, only for '${hostArch}'`
    );
  }

  if (knownArchs.indexOf(arch) < 0) {
    throw wasReported(
      `Unknown arch '${opts.arch}'. Specify ${knownArchs.join(', ')}`
    );
  }

  if (dryRun) {
    return 'built';
  }

  await build(nodeVersion, arch, built);
  return built;
}

export { system };
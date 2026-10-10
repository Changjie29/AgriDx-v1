import path from 'node:path';

// This maintenance line currently publishes stable releases only.
const STABLE_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const describe = value => value === undefined ? 'missing' : JSON.stringify(value);

function releaseHeadings(changelog) {
  const versions = [];
  let fence = null;
  for (const line of changelog.split(/\r?\n/u)) {
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/u);
    if (marker) {
      if (!fence) {
        fence = marker[1];
      } else if (marker[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2].trim()) {
        fence = null;
      }
      continue;
    }
    if (fence) continue;

    // Accept release-please links and plain headings; ignore older non-SemVer records.
    const heading = line.match(/^ {0,3}##\s+(?:\[(v?\d+\.\d+\.\d+)\](?:\([^)]*\))?|(v?\d+\.\d+\.\d+))(?=\s|$)/u);
    const version = heading?.[1]?.replace(/^v/u, '') ?? heading?.[2]?.replace(/^v/u, '');
    if (version && STABLE_VERSION.test(version)) versions.push(version);
  }
  return versions;
}

/**
 * Validate one root Node package without reading files or changing the inputs.
 * Only stable X.Y.Z versions are supported by this project's release checks.
 * @param {{packageJson?: object, lockfile?: object, manifest?: object, releaseConfig?: object, changelog?: string}} state
 * @returns {string[]} Concrete file/field errors; an empty array means success.
 */
export function validateReleaseState({ packageJson, lockfile, manifest, releaseConfig, changelog } = {}) {
  const errors = [];
  const version = isRecord(packageJson) ? packageJson.version : undefined;
  if (typeof version !== 'string' || !STABLE_VERSION.test(version)) {
    errors.push(`package.json.version: expected a stable X.Y.Z version without leading zeros; found ${describe(version)}`);
  } else {
    const versions = [
      ['package-lock.json.version', isRecord(lockfile) ? lockfile.version : undefined],
      ['package-lock.json.packages[""].version', isRecord(lockfile?.packages?.['']) ? lockfile.packages[''].version : undefined],
      ['.release-please-manifest.json["."]', isRecord(manifest) ? manifest['.'] : undefined],
    ];
    for (const [location, actual] of versions) {
      if (actual !== version) errors.push(`${location}: expected ${version}; found ${describe(actual)}`);
    }
  }

  if (typeof changelog !== 'string') {
    errors.push('CHANGELOG.md: expected Markdown text');
  } else {
    const headings = releaseHeadings(changelog);
    if (!headings.length) {
      errors.push('CHANGELOG.md: missing a stable X.Y.Z release heading');
    } else if (typeof version === 'string' && STABLE_VERSION.test(version) && headings[0] !== version) {
      errors.push(`CHANGELOG.md first release heading: expected ${version}; found ${headings[0]}`);
    }
    const seen = new Set();
    const duplicates = new Set();
    for (const heading of headings) {
      if (seen.has(heading)) duplicates.add(heading);
      seen.add(heading);
    }
    for (const duplicate of duplicates) {
      errors.push(`CHANGELOG.md: duplicate release heading for ${duplicate}`);
    }
  }

  const rootConfig = isRecord(releaseConfig?.packages?.['.']) ? releaseConfig.packages['.'] : null;
  if (!isRecord(releaseConfig)) {
    errors.push('release-please-config.json: expected a configuration object');
  } else if (!rootConfig) {
    errors.push('release-please-config.json.packages["."]: missing root package configuration');
  } else {
    const releaseType = rootConfig['release-type'] ?? releaseConfig['release-type'];
    if (releaseType !== 'node') {
      errors.push(`release-please-config.json effective release-type for ".": expected node; found ${describe(releaseType)}`);
    }
    const changelogPath = rootConfig['changelog-path'] ?? releaseConfig['changelog-path'] ?? 'CHANGELOG.md';
    if (typeof changelogPath !== 'string' || path.posix.normalize(changelogPath) !== 'CHANGELOG.md') {
      errors.push(`release-please-config.json effective changelog-path for ".": expected root CHANGELOG.md; found ${describe(changelogPath)}`);
    }
    // Both tag styles are valid. Check types instead of forcing one particular configuration shape.
    for (const [location, config] of [['release-please-config.json', releaseConfig], ['release-please-config.json.packages["."]', rootConfig]]) {
      for (const field of ['include-component-in-tag', 'include-v-in-tag']) {
        if (Object.hasOwn(config, field) && typeof config[field] !== 'boolean') {
          errors.push(`${location}.${field}: expected a boolean; found ${describe(config[field])}`);
        }
      }
    }
  }
  return errors;
}


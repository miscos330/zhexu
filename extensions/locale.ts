/**
 * Upstream strings that name the product, renamed for the active deployment
 * extension. Server-safe and hook-free: `lib/i18n/load-resource.ts` passes
 * every locale bundle through `brandLocaleResource` before handing it to the
 * i18n provider. Without an active extension the bundle is returned unchanged.
 */

import { ACTIVE_DEPLOYMENT_EXTENSION, type DeploymentExtensionId } from './config';
import { ZHEXU_BRAND } from './zhexu/brand';

type Resource = Record<string, unknown>;

const UPSTREAM_NAME = 'OpenMAIC';

const PRODUCT_NAME: Record<DeploymentExtensionId, string> = {
  zhexu: ZHEXU_BRAND.productName,
};

/**
 * Strings that name upstream itself rather than the running product: a
 * built-in skill does ship with OpenMAIC, and the official skill download is
 * OpenMAIC's. They stay as written.
 */
const UPSTREAM_KEYS = new Set([
  'settings.skills.builtinDetailNote',
  'workbench.skill.settings.officialDownload',
]);

function isRecord(value: unknown): value is Resource {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function rename(value: unknown, path: string, name: string): unknown {
  if (typeof value === 'string') {
    return UPSTREAM_KEYS.has(path) ? value : value.replaceAll(UPSTREAM_NAME, name);
  }
  if (!isRecord(value)) return value;
  const result: Resource = {};
  for (const [key, child] of Object.entries(value)) {
    result[key] = rename(child, path ? `${path}.${key}` : key, name);
  }
  return result;
}

export function brandLocaleResource<T extends Resource>(
  resource: T,
  extension: DeploymentExtensionId | undefined = ACTIVE_DEPLOYMENT_EXTENSION,
): T {
  return extension ? (rename(resource, '', PRODUCT_NAME[extension]) as T) : resource;
}

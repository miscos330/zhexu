/**
 * Deployment extensions: which one, if any, this build activates.
 *
 * A deployment extension packages what a downstream deployment adds on top of
 * upstream OpenMAIC (its brand, theme tokens and the workspace shell's host
 * slots, see `lib/workbench/shell-extensions.tsx`) under `extensions/<id>/`, so
 * the upstream tree stays easy to rebase. With the variable unset the app
 * renders exactly the upstream product.
 *
 * This module has no client directive: the root layout (a server component)
 * and client components both read it. `NEXT_PUBLIC_DEPLOYMENT_EXTENSION` is
 * compiled into the browser bundle, so changing it requires restarting the dev
 * server or rebuilding.
 */

export const DEPLOYMENT_EXTENSION_IDS = ['zhexu'] as const;

export type DeploymentExtensionId = (typeof DEPLOYMENT_EXTENSION_IDS)[number];

/** Normalize the configured value; unknown or empty values select no extension. */
export function resolveDeploymentExtension(
  raw: string | undefined,
): DeploymentExtensionId | undefined {
  const value = raw?.trim().toLowerCase();
  if (!value) return undefined;
  return (DEPLOYMENT_EXTENSION_IDS as readonly string[]).includes(value)
    ? (value as DeploymentExtensionId)
    : undefined;
}

export const ACTIVE_DEPLOYMENT_EXTENSION = resolveDeploymentExtension(
  process.env.NEXT_PUBLIC_DEPLOYMENT_EXTENSION,
);

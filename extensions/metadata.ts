/**
 * Page metadata a deployment extension overrides (the browser tab title and
 * the description). Server-safe: the root layout spreads it into its static
 * `metadata` export. Undefined without an active extension.
 */

import { ACTIVE_DEPLOYMENT_EXTENSION, type DeploymentExtensionId } from './config';
import { ZHEXU_BRAND } from './zhexu/brand';

export interface DeploymentMetadata {
  readonly title: string;
  readonly description: string;
  /**
   * The browser tab icon. Next always lists upstream's `app/favicon.ico`
   * first; browsers that read SVG icons take this one instead.
   */
  readonly icons: { readonly icon: { readonly url: string; readonly type: string } };
}

const METADATA: Record<DeploymentExtensionId, DeploymentMetadata> = {
  zhexu: {
    title: ZHEXU_BRAND.productName,
    icons: { icon: { url: ZHEXU_BRAND.markSrc, type: 'image/svg+xml' } },
    description:
      '折序 ZHEXU: an open-source AI interactive classroom built on OpenMAIC. Describe what you want to learn and get an immersive, multi-agent lesson.',
  },
};

export function deploymentMetadata(
  extension: DeploymentExtensionId | undefined,
): DeploymentMetadata | undefined {
  return extension ? METADATA[extension] : undefined;
}

export const ACTIVE_DEPLOYMENT_METADATA = deploymentMetadata(ACTIVE_DEPLOYMENT_EXTENSION);

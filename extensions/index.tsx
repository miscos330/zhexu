'use client';

/**
 * Mounts the active deployment extension inside the root layout's (empty)
 * workspace shell extension provider. Nested providers merge, so an extension
 * only adds to the upstream shell. See `extensions/README.md`.
 */

import type { ComponentType, ReactNode } from 'react';
import { ACTIVE_DEPLOYMENT_EXTENSION, type DeploymentExtensionId } from './config';
import { ZhexuExtension } from './zhexu/shell';

const EXTENSIONS: Record<DeploymentExtensionId, ComponentType<{ children: ReactNode }>> = {
  zhexu: ZhexuExtension,
};

export function DeploymentExtensions({
  children,
  extension = ACTIVE_DEPLOYMENT_EXTENSION,
}: {
  readonly children?: ReactNode;
  /** Defaults to `NEXT_PUBLIC_DEPLOYMENT_EXTENSION`; `null` forces none (tests). */
  readonly extension?: DeploymentExtensionId | null;
}) {
  if (!extension) return <>{children}</>;
  const Extension = EXTENSIONS[extension];
  return <Extension>{children}</Extension>;
}

'use client';

import type { ChatNode } from '@/lib/workbench/session-store';
import { ACTIVE_DEPLOYMENT_EXTENSION, type DeploymentExtensionId } from './config';
import { ZhexuToolCard } from './zhexu/tool-cards';

/**
 * Client-side seam: what the active deployment extension shows under a finished
 * tool call in the conversation, for the tools it added itself. Renders nothing
 * when no extension is selected or the tool is not one of its own.
 */
export function DeploymentToolCard({
  node,
  extension = ACTIVE_DEPLOYMENT_EXTENSION,
}: {
  node: ChatNode;
  extension?: DeploymentExtensionId | null;
}) {
  if (extension === 'zhexu') return <ZhexuToolCard node={node} />;
  return null;
}

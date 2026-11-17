'use client';

import type { ChatNode } from '@/lib/workbench/session-store';
import { ACTIVE_DEPLOYMENT_EXTENSION, type DeploymentExtensionId } from './config';
import { ZhexuToolCard } from './zhexu/tool-cards';

/**
 * Client-side seam: what the active deployment extension shows for a finished
 * call of a tool it added itself. Renders nothing when no extension is selected
 * or the tool is not one of its own.
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

/**
 * The cards of every finished tool call in one row of the conversation. The row
 * folds several calls into a single line, so the cards are placed under the row
 * (`components/workbench/chat/action-cluster.tsx`) where they stay in view.
 */
export function DeploymentToolCards({
  nodes,
  extension = ACTIVE_DEPLOYMENT_EXTENSION,
}: {
  nodes: readonly ChatNode[];
  extension?: DeploymentExtensionId | null;
}) {
  if (!extension) return null;
  return nodes
    .filter((node) => node.kind === 'tool' && node.toolState === 'done')
    .map((node) => <DeploymentToolCard key={node.key} node={node} extension={extension} />);
}

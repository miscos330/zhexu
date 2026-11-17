'use client';

import type { ChatNode } from '@/lib/workbench/session-store';
import { DeliverableCard } from './deliverables/card';
import { DELIVERABLE_CARD_TOOL_NAMES } from './deliverables/contract';

/** The cards of the ZHEXU extension's own tools. */
export function ZhexuToolCard({ node }: { node: ChatNode }) {
  if (node.toolName && DELIVERABLE_CARD_TOOL_NAMES.includes(node.toolName))
    return <DeliverableCard node={node} />;
  return null;
}

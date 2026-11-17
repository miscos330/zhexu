import type { AgentTool } from '@earendil-works/pi-agent-core';
import type { DeploymentAgentToolContext } from '../agent-tools';
import { zhexuDeliverablesEnabled } from './deliverables/enabled';

/** The agent tools of the ZHEXU extension. Each feature is off until its switch is set. */
export async function zhexuAgentTools(context: DeploymentAgentToolContext): Promise<AgentTool[]> {
  if (!zhexuDeliverablesEnabled()) return [];
  const [{ buildDeliverableTools }, { latestExportableAnswer }] = await Promise.all([
    import('./deliverables/tools'),
    import('./deliverables/latest-answer'),
  ]);
  return buildDeliverableTools({
    sessionId: context.sessionId,
    ownerId: context.ownerId,
    latestAnswer: () => latestExportableAnswer(context.messages()),
  });
}

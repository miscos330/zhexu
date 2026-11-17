import type { AgentTool } from '@earendil-works/pi-agent-core';
import type { DeploymentAgentToolContext } from '../agent-tools';
import { zhexuImageAnnotationsEnabled } from './annotations/enabled';
import { zhexuDeliverablesEnabled } from './deliverables/enabled';

/** The agent tools of the ZHEXU extension. Each feature is off until its switch is set. */
export async function zhexuAgentTools(context: DeploymentAgentToolContext): Promise<AgentTool[]> {
  const tools: AgentTool[] = [];
  if (zhexuDeliverablesEnabled()) {
    const [{ buildDeliverableTools }, { latestExportableAnswer }] = await Promise.all([
      import('./deliverables/tools'),
      import('./deliverables/latest-answer'),
    ]);
    tools.push(
      ...buildDeliverableTools({
        sessionId: context.sessionId,
        ownerId: context.ownerId,
        latestAnswer: () => latestExportableAnswer(context.messages()),
      }),
    );
  }
  // Annotating starts with the model looking at the image. A model that is not
  // declared vision-capable is never sent tool images, so it gets neither tool.
  if (zhexuImageAnnotationsEnabled() && context.modelSeesImages) {
    const { buildImageAnnotationTools } = await import('./annotations/tools');
    tools.push(
      ...buildImageAnnotationTools({ sessionId: context.sessionId, ownerId: context.ownerId }),
    );
  }
  return tools;
}

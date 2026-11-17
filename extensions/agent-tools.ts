import type { AgentTool } from '@earendil-works/pi-agent-core';
import { ACTIVE_DEPLOYMENT_EXTENSION, type DeploymentExtensionId } from './config';

/**
 * Server-side seam: the agent tools the active deployment extension adds to a
 * run. The runner calls this once per run, after its own tools, and gets an
 * empty list when no extension is selected, so upstream's tool set is unchanged
 * by default. Server only: do not import this from a client component.
 */

export interface DeploymentAgentToolContext {
  sessionId: string;
  /** The owner of the session, taken from the claimed durable session, never from the model. */
  ownerId: string;
  /** The conversation so far, read when a tool runs. */
  messages: () => readonly unknown[];
}

export async function deploymentAgentTools(
  context: DeploymentAgentToolContext,
  extension: DeploymentExtensionId | undefined = ACTIVE_DEPLOYMENT_EXTENSION,
): Promise<AgentTool[]> {
  if (extension === 'zhexu') {
    const { zhexuAgentTools } = await import('./zhexu/agent-tools');
    return zhexuAgentTools(context);
  }
  return [];
}

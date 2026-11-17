import { ACTIVE_DEPLOYMENT_EXTENSION } from '../../config';

/**
 * Handouts are on when the ZHEXU extension is the active one and
 * `ZHEXU_DELIVERABLES_ENABLED` is `true` or `1`. Off by default: with the
 * switch unset the agent has no handout tools and the routes answer 404.
 */
export function zhexuDeliverablesEnabled(): boolean {
  if (ACTIVE_DEPLOYMENT_EXTENSION !== 'zhexu') return false;
  const value = process.env.ZHEXU_DELIVERABLES_ENABLED?.trim().toLowerCase();
  return value === 'true' || value === '1';
}

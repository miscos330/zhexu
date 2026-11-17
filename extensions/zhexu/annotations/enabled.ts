import { ACTIVE_DEPLOYMENT_EXTENSION } from '../../config';

/**
 * Image annotations are on when the ZHEXU extension is the active one and
 * `ZHEXU_IMAGE_ANNOTATIONS_ENABLED` is `true` or `1`. Off by default: with the
 * switch unset the agent has neither the viewing nor the annotating tool.
 */
export function zhexuImageAnnotationsEnabled(): boolean {
  if (ACTIVE_DEPLOYMENT_EXTENSION !== 'zhexu') return false;
  const value = process.env.ZHEXU_IMAGE_ANNOTATIONS_ENABLED?.trim().toLowerCase();
  return value === 'true' || value === '1';
}

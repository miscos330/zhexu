/** ZHEXU extension: re-check a saved handout. The logic lives in `extensions/zhexu/deliverables/`. */
import type { NextRequest } from 'next/server';
import { verifyDeliverable } from '@/extensions/zhexu/deliverables/routes';

export const runtime = 'nodejs';

export function GET(req: NextRequest) {
  return verifyDeliverable(req);
}

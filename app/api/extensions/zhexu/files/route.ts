/** ZHEXU extension: the files delivered to the owner. The logic lives in `extensions/zhexu/deliverables/`. */
import type { NextRequest } from 'next/server';
import { listDeliveredFiles } from '@/extensions/zhexu/deliverables/routes';

export const runtime = 'nodejs';

export function GET(req: NextRequest) {
  return listDeliveredFiles(req);
}

/** ZHEXU extension: download one file of a handout. The logic lives in `extensions/zhexu/deliverables/`. */
import type { NextRequest } from 'next/server';
import { downloadDeliverable } from '@/extensions/zhexu/deliverables/routes';

export const runtime = 'nodejs';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ materialId: string }> },
) {
  return downloadDeliverable(req, (await params).materialId);
}

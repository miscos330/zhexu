/**
 * A4 handouts of the ZHEXU extension (`extensions/zhexu/deliverables/`): the
 * agent tools, the renderer, and the seam that adds the tools to a run. The
 * tools run against an in-memory session here; only the two render cases draw
 * real pages.
 */

import JSZip from 'jszip';
import { PDFDocument } from 'pdf-lib';
import sharp from 'sharp';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { deploymentAgentTools } from '@/extensions/agent-tools';
import {
  DELIVERABLE_TOOL_NAMES,
  deliverableDownloadUrl,
  deliverableVerifyUrl,
  isDeliverableDownloadUrl,
  type DeliverableSource,
} from '@/extensions/zhexu/deliverables/contract';
import { latestExportableAnswer } from '@/extensions/zhexu/deliverables/latest-answer';
import {
  renderDeliverable,
  type RenderedDeliverable,
} from '@/extensions/zhexu/deliverables/render';
import { deriveDeliverableTitle } from '@/extensions/zhexu/deliverables/text-layout';
import { buildDeliverableTools } from '@/extensions/zhexu/deliverables/tools';

interface ToolResult {
  isError?: boolean;
  details: Record<string, unknown>;
  content: Array<{ text: string }>;
}

function fixture() {
  const records = new Map<string, Record<string, unknown>>();
  const objects = new Map<string, { bytes: Buffer; mime: string }>();
  let next = 0;
  const owned = vi.fn(async () => ({ id: 's1', ownerId: 'user:one' }));
  const answer = vi.fn(() => '原文：保护环境，建设美好家园。');
  const render = vi.fn(
    async (_source: unknown, _signal?: AbortSignal): Promise<RenderedDeliverable[]> => [
      {
        format: 'pdf',
        mime: 'application/pdf',
        bytes: Buffer.from('%PDF actual test fixture'),
        pages: 1,
      },
      { format: 'png', mime: 'image/png', bytes: Buffer.from('PNG fixture'), pages: 1 },
    ],
  );
  const persist = vi.fn(
    async (
      sessionId: string,
      input: { filename: string; mimeType: string; bytes: Buffer; sourceUrl?: string },
    ) => {
      const id = `mat_${++next}`;
      const rawAssetId = `${sessionId}/${id}`;
      objects.set(rawAssetId, { bytes: Buffer.from(input.bytes), mime: input.mimeType });
      const record = {
        id,
        sessionId,
        title: input.filename,
        rawAssetId,
        sourceUrl: input.sourceUrl,
      };
      records.set(id, record);
      return record;
    },
  );
  const tools = buildDeliverableTools({
    sessionId: 's1',
    ownerId: 'user:one',
    latestAnswer: answer,
    resolveSession: owned,
    render,
    persist,
    list: async () => [...records.values()].reverse(),
    get: async (_sessionId: string, id: string) => records.get(id) ?? null,
    read: async (_sessionId: string, key: string) => objects.get(key) ?? null,
  } as never);
  const run = (name: string, input: unknown = {}, signal?: AbortSignal) =>
    tools
      .find((tool) => tool.name === name)!
      .execute('c1', input as never, signal) as unknown as Promise<ToolResult>;
  return { tools, run, render, persist, owned, records, objects, answer };
}

const DOC = { kind: 'document', title: 'stable', body: 'unchanged' };

describe('handout tools', () => {
  it('offers exactly the four handout tools', () => {
    expect(fixture().tools.map((tool) => tool.name)).toEqual([...DELIVERABLE_TOOL_NAMES]);
  });

  it('saves a PDF, an image and the source record, and reuses them on a repeated export', async () => {
    const f = fixture();
    const created = await f.run('create_deliverable', {
      kind: 'document',
      title: '正文',
      body: '原文',
    });
    expect(created.isError).not.toBe(true);
    expect(created.details).toMatchObject({ status: 'saved', deliveryState: 'delivered' });
    expect(f.persist).toHaveBeenCalledTimes(3);
    const files = created.details.files as Array<{ download: string; format: string }>;
    expect(files.map((file) => file.format)).toEqual(['pdf', 'png']);
    expect(files.every((file) => isDeliverableDownloadUrl(file.download))).toBe(true);

    const exported = await f.run('export_deliverable');
    expect(exported.details).toEqual(created.details);
    expect(f.render).toHaveBeenCalledTimes(1);
    expect(f.persist).toHaveBeenCalledTimes(3);
  });

  it('verifies saved files repeatedly without rendering or writing again', async () => {
    const f = fixture();
    const first = await f.run('create_deliverable', DOC);
    for (let i = 0; i < 2; i += 1) {
      const checked = await f.run('verify_deliverable', { sourceId: first.details.sourceId });
      expect(checked.details).toMatchObject({
        deliveryState: 'delivered',
        readOnly: true,
        sourceHash: first.details.sourceHash,
      });
    }
    expect(f.render).toHaveBeenCalledTimes(1);
    expect(f.persist).toHaveBeenCalledTimes(3);
  });

  it('keeps the intact file downloadable when another one is missing', async () => {
    const f = fixture();
    const first = await f.run('create_deliverable', DOC);
    f.objects.delete('s1/mat_1');
    const checked = await f.run('verify_deliverable', { sourceId: first.details.sourceId });
    expect(checked.details.deliveryState).toBe('partial');
    expect(checked.details.missingFormats).toEqual(['pdf']);
    expect(checked.details.files).toHaveLength(1);
    expect(f.render).toHaveBeenCalledTimes(1);
  });

  it('reports a file whose bytes changed as missing', async () => {
    const f = fixture();
    const first = await f.run('create_deliverable', DOC);
    f.objects.get('s1/mat_2')!.bytes = Buffer.from('PNG tampered');
    const checked = await f.run('verify_deliverable', { sourceId: first.details.sourceId });
    expect(checked.details.missingFormats).toEqual(['png']);
  });

  it('keeps the source after a failure half way and finishes from that source only', async () => {
    const f = fixture();
    const persist = f.persist.getMockImplementation()!;
    f.persist.mockImplementationOnce(persist).mockRejectedValueOnce(Error('storage failed'));
    const first = await f.run('create_deliverable', DOC);
    expect(first.isError).toBe(true);
    expect(first.details.deliveryState).toBe('partial');
    expect(first.details.files).toHaveLength(1);
    const pdfBefore = (first.details.files as Array<{ sha256: string }>)[0]!.sha256;

    const second = await f.run('export_deliverable', { sourceId: first.details.sourceId });
    expect(second.isError).not.toBe(true);
    expect(second.details.deliveryState).toBe('delivered');
    expect(second.details.sourceHash).toBe(first.details.sourceHash);
    expect((second.details.files as Array<{ sha256: string }>)[0]!.sha256).toBe(pdfBefore);
    expect(f.render.mock.calls[1]![0]).toMatchObject({ body: 'unchanged' });
  });

  it('reuses files that were already written when the record itself was lost', async () => {
    const f = fixture();
    const first = await f.run('create_deliverable', {
      kind: 'document',
      title: 'same',
      body: 'same',
    });
    f.records.delete(String(first.details.sourceId));
    f.render.mockResolvedValue([
      {
        format: 'pdf',
        mime: 'application/pdf',
        bytes: Buffer.from('%PDF regenerated metadata'),
        pages: 1,
      },
      { format: 'png', mime: 'image/png', bytes: Buffer.from('regenerated PNG'), pages: 1 },
    ]);
    const next = await f.run('create_deliverable', {
      kind: 'document',
      title: 'same',
      body: 'same',
    });
    expect(next.isError).not.toBe(true);
    expect(next.details.files).toEqual(first.details.files);
    expect(f.persist).toHaveBeenCalledTimes(4);
  });

  it('exports the preceding answer in handwriting without the model retyping it', async () => {
    const f = fixture();
    const out = await f.run('export_deliverable', { source: 'last-answer', style: 'handwriting' });
    expect(out.isError).not.toBe(true);
    expect(f.render).toHaveBeenCalledWith(
      expect.objectContaining({ body: '原文：保护环境，建设美好家园。', style: 'handwriting' }),
      undefined,
    );
  });

  it('makes a restyled copy from the saved text, leaving the first handout in place', async () => {
    const f = fixture();
    const first = await f.run('create_deliverable', {
      kind: 'document',
      title: '旧标题',
      body: '原文保持不变。',
    });
    const second = await f.run('export_deliverable', { style: 'handwriting', title: '新标题' });
    expect(second.isError).not.toBe(true);
    expect(f.render.mock.calls[1]![0]).toMatchObject({
      title: '新标题',
      body: '原文保持不变。',
      style: 'handwriting',
    });
    expect(second.details.sourceId).not.toBe(first.details.sourceId);
    const again = await f.run('verify_deliverable', { sourceId: first.details.sourceId });
    expect(again.details.deliveryState).toBe('delivered');
  });

  it('reads the saved source back for a revision', async () => {
    const f = fixture();
    const first = await f.run('create_deliverable', DOC);
    const read = await f.run('read_deliverable', {});
    expect(JSON.parse(read.content[0]!.text)).toMatchObject({ title: 'stable', body: 'unchanged' });
    expect(read.details.sourceId).toBe(first.details.sourceId);
  });

  it('refuses a session of another owner before rendering or writing', async () => {
    const f = fixture();
    f.owned.mockResolvedValue({ id: 's1', ownerId: 'user:other' });
    for (const [name, input] of [
      ['create_deliverable', { kind: 'document', title: 'x', body: 'y' }],
      ['export_deliverable', { source: 'last-answer' }],
      ['read_deliverable', {}],
      ['verify_deliverable', { sourceId: 'mat_1' }],
    ] as const) {
      const out = await f.run(name, input);
      expect(out.isError).toBe(true);
      expect(out.details).toMatchObject({
        deliveryState: 'failed',
        reason: 'deliverable_not_found',
      });
    }
    expect(f.render).not.toHaveBeenCalled();
    expect(f.persist).not.toHaveBeenCalled();
  });

  it('refuses a record that belongs to another session', async () => {
    const f = fixture();
    const first = await f.run('create_deliverable', DOC);
    f.records.get(String(first.details.sourceId))!.sessionId = 's2';
    const out = await f.run('verify_deliverable', { sourceId: first.details.sourceId });
    expect(out.details).toMatchObject({ deliveryState: 'failed', reason: 'deliverable_not_found' });
  });

  it('hands out no link when a saved file is gone', async () => {
    const f = fixture();
    await f.run('create_deliverable', { kind: 'document', title: 'x', body: 'y' });
    f.objects.delete('s1/mat_1');
    const out = await f.run('export_deliverable');
    expect(out.isError).toBe(true);
    expect(out.details.deliveryState).toBe('failed');
    expect(out.details.files).toBeUndefined();
  });

  it('rejects an unknown source and an aborted create without writing', async () => {
    const f = fixture();
    expect((await f.run('export_deliverable', { sourceId: 'mat_other' })).isError).toBe(true);
    const controller = new AbortController();
    controller.abort();
    const out = await f.run(
      'create_deliverable',
      { kind: 'document', title: 'x', body: 'y' },
      controller.signal,
    );
    expect(out.isError).toBe(true);
    expect(f.persist).not.toHaveBeenCalled();
  });

  it('rejects oversized arguments and an empty body', async () => {
    const f = fixture();
    const big = await f.run('create_deliverable', {
      kind: 'document',
      title: 'x',
      body: '字'.repeat(6000),
    });
    expect(big.details.reason).toBe('deliverable_request_size');
    const empty = await f.run('create_deliverable', { kind: 'document', title: 'x', body: '   ' });
    expect(empty.isError).toBe(true);
    expect(f.render).not.toHaveBeenCalled();
  });

  it('renders at most two handouts in one run', async () => {
    const f = fixture();
    for (const body of ['one', 'two'])
      expect(
        (await f.run('create_deliverable', { kind: 'document', title: body, body })).isError,
      ).not.toBe(true);
    const third = await f.run('create_deliverable', {
      kind: 'document',
      title: 'three',
      body: 'three',
    });
    expect(third.details.reason).toBe('deliverable_run_limit');
    expect(f.render).toHaveBeenCalledTimes(2);
  });

  it('exports long prose in handwriting with a short title, through the real renderer', async () => {
    const f = fixture();
    f.answer.mockReturnValue('我们希望建设一个相互尊重、认真学习、乐于合作的班集体。'.repeat(12));
    f.render.mockImplementation((source, signal) =>
      renderDeliverable(source as DeliverableSource, signal),
    );
    const out = await f.run('export_deliverable', { source: 'last-answer', style: 'handwriting' });
    expect(out.isError).not.toBe(true);
    expect(out.details.deliveryState).toBe('delivered');
    expect(String(out.details.title).length).toBeLessThan(60);
  });
});

describe('handout renderer', () => {
  it('draws A4 pages, with a handwriting page that differs from the standard one', async () => {
    const source = {
      kind: 'document' as const,
      title: '行书排版测试',
      body: '中国式现代化是人与自然和谐共生的现代化。\n保护环境，建设美好家园。',
      style: 'handwriting' as const,
    };
    const before = JSON.stringify(source);
    const files = await renderDeliverable(source);
    const plain = await renderDeliverable({ ...source, style: 'standard' });
    expect(files.map((file) => file.format)).toEqual(['pdf', 'png']);
    const pdf = await PDFDocument.load(files[0]!.bytes);
    expect(pdf.getPageCount()).toBe(1);
    expect(pdf.getPage(0).getSize().width).toBeCloseTo(595.28);
    expect(pdf.getPage(0).getSize().height).toBeCloseTo(841.89);
    const png = files.find((file) => file.format === 'png')!.bytes;
    const meta = await sharp(png).metadata();
    expect([meta.width, meta.height]).toEqual([1240, 1754]);
    expect(png.equals(plain.find((file) => file.format === 'png')!.bytes)).toBe(false);
    expect(JSON.stringify(source)).toBe(before);
  });

  it('adds a ZIP of every page when the text runs over one page', async () => {
    const files = await renderDeliverable({
      kind: 'document',
      title: '多页讲义',
      body: Array.from({ length: 60 }, (_, i) => `第 ${i + 1} 行：认真听讲，独立思考。`).join('\n'),
      style: 'standard',
    });
    const pages = files[0]!.pages;
    expect(pages).toBeGreaterThan(1);
    expect((await PDFDocument.load(files[0]!.bytes)).getPageCount()).toBe(pages);
    const zip = await JSZip.loadAsync(files.find((file) => file.format === 'zip')!.bytes);
    expect(Object.keys(zip.files)).toHaveLength(pages);
    expect(zip.file('page-01.png')).not.toBeNull();
  });

  it('refuses text that needs more than sixteen pages instead of dropping any of it', async () => {
    await expect(
      renderDeliverable({
        kind: 'document',
        title: 'too long',
        body: Array.from({ length: 700 }, (_, i) => `line ${i}`).join('\n'),
        style: 'standard',
      }),
    ).rejects.toThrow('deliverable_page_limit');
  });

  it('stops before drawing when the run was aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      renderDeliverable(
        { kind: 'document', title: 'x', body: 'unchanged', style: 'standard' },
        controller.signal,
      ),
    ).rejects.toThrow();
  });
});

describe('choosing the answer to export', () => {
  it('takes the newest assistant text', () => {
    expect(
      latestExportableAnswer([
        { role: 'user', content: '如何使用 WPS 导出PDF？' },
        { role: 'assistant', content: '操作步骤：先打开文件菜单。' },
        { role: 'user', content: '导出成讲义' },
      ]),
    ).toContain('操作步骤');
  });

  it('skips tool calls and answers that only hand out a handout link', () => {
    const link = deliverableDownloadUrl('s1', 'mat_abc');
    expect(
      latestExportableAnswer([
        { role: 'assistant', content: [{ type: 'text', text: '第一课：光的折射' }] },
        { role: 'user', content: '导出 PDF' },
        {
          role: 'assistant',
          content: [
            { type: 'text', text: '正在导出' },
            { type: 'toolCall', name: 'export_deliverable' },
          ],
        },
        { role: 'toolResult', content: [{ type: 'text', text: '{}' }] },
        { role: 'assistant', content: [{ type: 'text', text: `文件在这里：(${link})` }] },
        { role: 'user', content: '换成手写体' },
      ]),
    ).toBe('第一课：光的折射');
  });

  it('skips what the assistant said about a failed export, so a retry finds the answer', () => {
    expect(
      latestExportableAnswer([
        { role: 'assistant', content: [{ type: 'text', text: '第一课：光的折射' }] },
        { role: 'user', content: '导出成讲义' },
        { role: 'assistant', content: [{ type: 'toolCall', name: 'export_deliverable' }] },
        { role: 'toolResult', content: [{ type: 'text', text: 'File was not delivered' }] },
        { role: 'assistant', content: [{ type: 'text', text: '这次没有生成文件。' }] },
        { role: 'user', content: '再试一次' },
      ]),
    ).toBe('第一课：光的折射');
  });

  it('skips what the assistant said about an annotated image', () => {
    expect(
      latestExportableAnswer([
        { role: 'assistant', content: [{ type: 'text', text: '第一课：光的折射' }] },
        { role: 'user', content: '给这张图加标注' },
        { role: 'assistant', content: [{ type: 'toolCall', name: 'view_material_image' }] },
        { role: 'toolResult', content: [{ type: 'text', text: 'viewId=…' }] },
        { role: 'assistant', content: [{ type: 'toolCall', name: 'annotate_image' }] },
        { role: 'toolResult', content: [{ type: 'text', text: '{}' }] },
        { role: 'assistant', content: [{ type: 'text', text: '标注图已经生成，请核对位置。' }] },
        { role: 'user', content: '把上面那条回答导出成讲义' },
      ]),
    ).toBe('第一课：光的折射');
  });

  it('keeps an answer written after other tools ran', () => {
    expect(
      latestExportableAnswer([
        { role: 'user', content: '查一下再回答' },
        { role: 'assistant', content: [{ type: 'toolCall', name: 'web_search' }] },
        { role: 'toolResult', content: [{ type: 'text', text: '{}' }] },
        { role: 'assistant', content: [{ type: 'text', text: '查到的结论是……' }] },
      ]),
    ).toBe('查到的结论是……');
  });

  it('returns nothing when there is no answer yet', () => {
    expect(latestExportableAnswer([{ role: 'user', content: 'hi' }, null, 'x'])).toBe('');
  });

  it('titles an export from its heading, never from a whole paragraph', () => {
    expect(deriveDeliverableTitle('# 光的折射\n\n正文')).toBe('光的折射');
    expect(deriveDeliverableTitle('很长的一段话。'.repeat(40)).length).toBeLessThan(60);
  });
});

describe('handout links', () => {
  it('recognizes only the links this feature issues', () => {
    expect(isDeliverableDownloadUrl(deliverableDownloadUrl('ses_1-A', 'mat_abc123'))).toBe(true);
    for (const value of [
      'https://example.com/api/extensions/zhexu/deliverables/mat_a?sessionId=s',
      '/api/extensions/zhexu/deliverables/mat_a?sessionId=s&next=//example.com',
      '/api/extensions/zhexu/deliverables/../secrets?sessionId=s',
      '/api/materials/mat_a/download',
      'javascript:alert(1)',
      undefined,
      42,
    ])
      expect(isDeliverableDownloadUrl(value)).toBe(false);
  });

  it('encodes the ids it is given', () => {
    expect(deliverableVerifyUrl('a b', 'mat_1')).toBe(
      '/api/extensions/zhexu/deliverables?sessionId=a%20b&sourceId=mat_1',
    );
  });
});

describe('agent tool seam', () => {
  const context = {
    sessionId: 's1',
    ownerId: 'user:one',
    messages: () => [],
    modelSeesImages: false,
  };

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('adds nothing when no extension is selected', async () => {
    expect(await deploymentAgentTools(context, undefined)).toEqual([]);
  });

  it('adds nothing for ZHEXU while the handout switch is off', async () => {
    vi.stubEnv('NEXT_PUBLIC_DEPLOYMENT_EXTENSION', 'zhexu');
    vi.resetModules();
    const seam = await import('@/extensions/agent-tools');
    expect(await seam.deploymentAgentTools(context)).toEqual([]);
  });

  it('does not turn handouts on from the switch alone, without the extension', async () => {
    vi.stubEnv('NEXT_PUBLIC_DEPLOYMENT_EXTENSION', '');
    vi.stubEnv('ZHEXU_DELIVERABLES_ENABLED', 'true');
    vi.resetModules();
    const seam = await import('@/extensions/agent-tools');
    expect(await seam.deploymentAgentTools(context)).toEqual([]);
    const { zhexuDeliverablesEnabled } = await import('@/extensions/zhexu/deliverables/enabled');
    expect(zhexuDeliverablesEnabled()).toBe(false);
  });

  it('adds the handout tools for ZHEXU with the switch on', async () => {
    vi.stubEnv('NEXT_PUBLIC_DEPLOYMENT_EXTENSION', 'zhexu');
    vi.stubEnv('ZHEXU_DELIVERABLES_ENABLED', 'true');
    vi.resetModules();
    const seam = await import('@/extensions/agent-tools');
    const tools = await seam.deploymentAgentTools(context);
    expect(tools.map((tool) => tool.name)).toEqual([...DELIVERABLE_TOOL_NAMES]);
  });
});

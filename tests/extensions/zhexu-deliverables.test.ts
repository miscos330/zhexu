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
  DELIVERABLE_PAGE_BREAK,
  DELIVERABLE_TOOL_NAMES,
  deliverableDownloadUrl,
  deliverableVerifyUrl,
  isDeliverableDownloadUrl,
  type DeliverableSource,
} from '@/extensions/zhexu/deliverables/contract';
import {
  courseHandoutText,
  htmlToText,
  type CourseForHandout,
} from '@/extensions/zhexu/deliverables/course-source';
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
  const loadCourse = vi.fn(async (ownerId: string, courseId: string) =>
    ownerId === 'user:one' && courseId === 'course-1' ? COURSE : null,
  );
  const tools = buildDeliverableTools({
    sessionId: 's1',
    ownerId: 'user:one',
    latestAnswer: answer,
    resolveSession: owned,
    render,
    persist,
    loadCourse,
    list: async () => [...records.values()].reverse(),
    get: async (_sessionId: string, id: string) => records.get(id) ?? null,
    read: async (_sessionId: string, key: string) => objects.get(key) ?? null,
  } as never);
  const run = (name: string, input: unknown = {}, signal?: AbortSignal) =>
    tools
      .find((tool) => tool.name === name)!
      .execute('c1', input as never, signal) as unknown as Promise<ToolResult>;
  return { tools, run, render, persist, owned, records, objects, answer, loadCourse };
}

const DOC = { kind: 'document', title: 'stable', body: 'unchanged' };

/** A saved course the way the store returns it: pages out of order, rich text, a quiz. */
const COURSE: CourseForHandout = {
  name: '光的折射',
  description: '面向初二学生的一节短课。',
  scenes: [
    {
      id: 'quiz',
      order: 3,
      title: '小测',
      type: 'quiz',
      content: {
        type: 'quiz',
        questions: [
          {
            id: 'q1',
            type: 'single',
            question: '<p>光从空气斜射入水中，折射角与入射角相比？</p>',
            options: [
              { value: 'A', label: '更大' },
              { value: 'B', label: '更小' },
            ],
            answer: ['B'],
            analysis: '光从空气进入水中时向法线偏折。',
          },
          { id: 'q2', type: 'short_answer', question: '举一个生活中的折射现象。' },
        ],
      },
    },
    {
      id: 'intro',
      order: 1,
      title: '什么是折射',
      type: 'slide',
      content: {
        type: 'slide',
        canvas: {
          elements: [
            { type: 'text', top: 200, left: 40, content: '<p>传播方向发生偏折</p>' },
            { type: 'image', top: 0, left: 0, src: 'x.png' },
            {
              type: 'text',
              top: 40,
              left: 40,
              content: '<h1>光的折射&nbsp;&amp;&nbsp;现象</h1>',
            },
            { type: 'shape', top: 300, left: 40, text: { content: '<p>法线</p>' } },
            { type: 'latex', top: 400, left: 40, latex: 'n_1 \\sin i = n_2 \\sin r' },
            {
              type: 'table',
              top: 500,
              left: 40,
              data: [
                [{ text: '介质' }, { text: '折射率' }],
                [{ text: '水' }, { text: '1.33' }],
              ],
            },
          ],
        },
      },
      actions: [
        { type: 'spotlight', elementId: 'e1' },
        { type: 'speech', text: '同学们好，今天我们学习光的折射。' },
        { type: 'speech', text: '先看一个现象。' },
      ],
    },
    {
      id: 'law',
      order: 2,
      title: '',
      type: 'slide',
      content: {
        type: 'slide',
        canvas: { elements: [{ type: 'text', top: 0, left: 0, content: '折射规律' }] },
      },
      actions: [{ type: 'speech', text: '入射角增大，折射角也增大。' }],
    },
  ],
};

describe('handout tools', () => {
  it('offers exactly the handout tools the contract names', () => {
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
      // The renderer gets a reader for pictures, scoped to this owner.
      { readImage: expect.any(Function) },
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

describe('course handout text', () => {
  it('lays a course out in page order with what is written, said and asked', () => {
    const text = courseHandoutText(COURSE);
    expect(text).toMatchObject({ title: '光的折射', scenes: 3, questions: 2 });
    expect(text.body).toBe(
      [
        '面向初二学生的一节短课。',
        [
          '1. 什么是折射',
          // A picture held as a path, not a course asset: marked as not included.
          '![](-)',
          '光的折射 & 现象',
          '传播方向发生偏折',
          '法线',
          // A formula element keeps its LaTeX, marked to be typeset on a line of its own.
          '\\[n_1 \\sin i = n_2 \\sin r\\]',
          // A table becomes a pipe table, which the renderer draws ruled.
          '| 介质 | 折射率 |',
          '| 水 | 1.33 |',
          '讲解: 同学们好，今天我们学习光的折射。',
          '先看一个现象。',
        ].join('\n'),
        ['2. 未命名', '折射规律', '讲解: 入射角增大，折射角也增大。'].join('\n'),
        [
          '3. 小测',
          '练习',
          '1. 光从空气斜射入水中，折射角与入射角相比？',
          'A. 更大',
          'B. 更小',
          '2. 举一个生活中的折射现象。',
        ].join('\n'),
      ].join('\n\n') +
        // The answers start on a page of their own.
        DELIVERABLE_PAGE_BREAK +
        ['答案与解析', '1. B', '解析: 光从空气进入水中时向法线偏折。'].join('\n'),
    );
  });

  it('leaves the narration out for slides only', () => {
    const { body } = courseHandoutText(COURSE, 'slides');
    expect(body).toContain('传播方向发生偏折');
    expect(body).not.toContain('讲解');
    expect(body).not.toContain('同学们好');
  });

  it('makes a worksheet: a name line, the questions, and the answers on their own page', () => {
    const text = courseHandoutText(COURSE, 'questions');
    expect(text.title).toBe('光的折射 练习');
    expect(text.body).toBe(
      [
        '姓名：________　班级：________　日期：________',
        ['1. 光从空气斜射入水中，折射角与入射角相比？', 'A. 更大', 'B. 更小'].join('\n'),
        '2. 举一个生活中的折射现象。',
      ].join('\n\n') +
        DELIVERABLE_PAGE_BREAK +
        ['答案与解析', '1. B', '解析: 光从空气进入水中时向法线偏折。'].join('\n'),
    );
    // A worksheet without answers has no page break and no empty answer page.
    const quiz = (questions: unknown[]) => ({
      name: 'Refraction',
      scenes: [{ type: 'quiz', content: { type: 'quiz', questions } }],
    });
    expect(
      courseHandoutText(quiz([{ question: 'Name one refraction effect.' }]), 'questions').body,
    ).toBe('Name: ________   Class: ________   Date: ________\n\n1. Name one refraction effect.');
    // A question without options gets room to write under it, and one whose
    // only answer is its explanation shows that explanation as the answer.
    expect(
      courseHandoutText(
        quiz([
          { question: 'Why does a straw look bent?', analysis: 'Light bends as it leaves water.' },
          { question: 'Name one refraction effect.' },
        ]),
        'questions',
      ).body,
    ).toBe(
      'Name: ________   Class: ________   Date: ________\n\n' +
        '1. Why does a straw look bent?\n\n\n\n\n' +
        '2. Name one refraction effect.' +
        DELIVERABLE_PAGE_BREAK +
        'Answers\n1. Light bends as it leaves water.',
    );
  });

  it('exports a part of a course and numbers its pages as the course does', () => {
    const text = courseHandoutText(COURSE, 'slides', { from: 2, to: 2 });
    expect(text.scenes).toBe(1);
    expect(text.body).toBe('2. 未命名\n折射规律');
    expect(courseHandoutText(COURSE, 'full', { from: 9 }).scenes).toBe(0);
  });

  it('labels an English course in English and survives pages it cannot read', () => {
    const text = courseHandoutText({
      name: 'Refraction',
      scenes: [
        null,
        'not a scene',
        {
          title: 'Intro',
          type: 'slide',
          content: { type: 'slide' },
          actions: [{ type: 'speech', text: 'Hello.' }],
        },
        { title: 'Lab', type: 'interactive', content: { type: 'interactive', html: '<b>x</b>' } },
      ],
    });
    expect(text.body).toBe('1. Intro\nNotes: Hello.\n\n2. Lab');
  });

  it('marks the formulas of a course for typesetting, keeping their LaTeX', () => {
    // Slide text stores an inline formula as a span with its source.
    expect(
      htmlToText(
        '<p>折射定律 <span data-inline-math="n_1\\sin i&lt;n_2">n_1\\sin i&lt;n_2</span> 成立</p>',
      ),
    ).toBe('折射定律 \\(n_1\\sin i<n_2\\) 成立');
    const text = courseHandoutText(
      {
        name: '函数',
        scenes: [
          {
            type: 'quiz',
            content: {
              type: 'quiz',
              questions: [
                {
                  // The quiz view shows an undelimited formula as one; so does the handout.
                  question: '解方程 x^2-5x+6=0',
                  options: [
                    { value: 'A', label: '$x=2$ 或 $x=3$' },
                    { value: 'B', label: '无解' },
                  ],
                  answer: ['A'],
                  analysis: '因式分解得 $$(x-2)(x-3)=0$$',
                },
              ],
            },
          },
        ],
      },
      'questions',
    );
    expect(text.body).toBe(
      '姓名：________　班级：________　日期：________\n\n' +
        '1. 解方程 \\(x^2-5x+6=0\\)\nA. \\(x=2\\) 或 \\(x=3\\)\nB. 无解' +
        DELIVERABLE_PAGE_BREAK +
        '答案与解析\n1. A\n解析: 因式分解得 \\[(x-2)(x-3)=0\\]',
    );
  });

  it('writes a course table as a pipe table, its merged cells marked with < and ^', () => {
    const table = (data: unknown[][], theme?: object, colWidths?: number[]) =>
      courseHandoutText(
        {
          name: 'T',
          scenes: [
            {
              title: 'Table',
              type: 'slide',
              content: {
                type: 'slide',
                canvas: {
                  elements: [{ type: 'table', top: 0, left: 0, theme, data, colWidths }],
                },
              },
            },
          ],
        },
        'slides',
      ).body;
    const cell = (text: string, more: object = {}) => ({ text, colspan: 1, rowspan: 1, ...more });
    expect(
      table(
        [
          [cell('Medium'), cell('n')],
          [cell('Water'), cell('a|b<br/>c')],
        ],
        { rowHeader: true },
      ),
    ).toBe('1. Table\n| Medium | n |\n| --- | --- |\n| Water | a\\|b<br>c |');
    // A row lists only the cells that start in it; a cell takes the first free column.
    expect(table([[cell('Merged', { colspan: 2 })], [cell('a'), cell('b')]])).toBe(
      '1. Table\n| Merged | < |\n| a | b |',
    );
    expect(
      table(
        [
          [cell('Group', { rowspan: 2 }), cell('x'), cell('y')],
          [cell('1'), cell('2')],
          [cell('<'), cell('Wide', { colspan: 2, rowspan: 2 })],
          [cell('^')],
        ],
        { rowHeader: true },
      ),
    ).toBe(
      '1. Table\n| Group | x | y |\n| --- | --- | --- |\n| ^ | 1 | 2 |\n| \\< | Wide | < |\n| \\^ | ^ | ^ |',
    );
    // Cells that would overlap, or more columns than the table declares: rows of text.
    expect(
      table(
        [
          [cell('a', { rowspan: 2 }), cell('b')],
          [cell('c'), cell('d'), cell('e')],
        ],
        {},
        [1, 1],
      ),
    ).toBe('1. Table\na | b\nc | d | e');
  });

  it('takes what an interactive page and a project page explain from their own fields', () => {
    const text = courseHandoutText(
      {
        name: '光的折射',
        scenes: [
          {
            title: '折射模拟',
            type: 'interactive',
            content: {
              type: 'interactive',
              html: '<button>开始</button><script>run()</script>',
              widgetConfig: {
                type: 'simulation',
                concept: '折射定律',
                description: '拖动滑块改变入射角，观察折射角的变化。',
                variables: [{ name: 'i', label: '入射角' }],
              },
            },
          },
          {
            title: '实验步骤',
            type: 'interactive',
            content: {
              type: 'interactive',
              html: '<p>x</p>',
              widgetConfig: {
                type: 'procedural-skill',
                task: '测量水的折射率',
                description: '按步骤完成测量。',
                steps: [
                  { id: 's1', title: '放置玻璃砖', description: '把玻璃砖放在白纸上。' },
                  { id: 's2', title: '记录角度', description: '' },
                ],
              },
            },
          },
          {
            title: '概念图',
            type: 'interactive',
            content: {
              type: 'interactive',
              widgetConfig: {
                type: 'diagram',
                description: '折射的成因。',
                nodes: [
                  { id: 'a', label: '光速变化', details: '介质不同，光速不同' },
                  { id: 'b', label: '方向偏折' },
                ],
              },
            },
          },
          {
            title: '项目：设计潜望镜',
            type: 'pbl',
            content: {
              type: 'pbl',
              projectV2: {
                title: '设计潜望镜',
                description: '用平面镜设计一个简易潜望镜。',
                learningObjective: '理解光的反射在生活中的应用',
                milestones: [
                  {
                    id: 'm2',
                    title: '制作',
                    order: 1,
                    microtasks: [{ id: 't2', title: '组装镜筒', order: 0 }],
                  },
                  {
                    id: 'm1',
                    title: '设计',
                    description: '画出光路图',
                    order: 0,
                    microtasks: [
                      { id: 't1b', title: '确定镜面角度', order: 1 },
                      { id: 't1a', title: '画光路', order: 0 },
                    ],
                  },
                ],
              },
            },
          },
          // A v3 project lives in its own package: only the title.
          {
            title: '新版项目',
            type: 'pbl',
            content: { type: 'pbl', projectV3: { id: 'p', version: '1' } },
          },
        ],
      },
      'slides',
    );
    expect(text.body).toBe(
      [
        '1. 折射模拟\n折射定律\n拖动滑块改变入射角，观察折射角的变化。',
        '2. 实验步骤\n测量水的折射率\n按步骤完成测量。\n1. 放置玻璃砖：把玻璃砖放在白纸上。\n2. 记录角度',
        '3. 概念图\n折射的成因。\n· 光速变化：介质不同，光速不同\n· 方向偏折',
        '4. 项目：设计潜望镜\n用平面镜设计一个简易潜望镜。\n学习目标：理解光的反射在生活中的应用\n' +
          '1. 设计：画出光路图\n  · 画光路\n  · 确定镜面角度\n2. 制作\n  · 组装镜筒',
        '5. 新版项目',
      ].join('\n\n'),
    );
  });

  it('reduces rich text to its words', () => {
    expect(
      htmlToText('<p>a&lt;b &#38; c&#x4e2d;</p><ul><li>one</li><li>two<br/>three</li></ul>'),
    ).toBe('a<b & c中\n· one\n· two\nthree');
    expect(htmlToText('  plain   text  ')).toBe('plain text');
    expect(htmlToText('&unknown; &#0;')).toBe('&unknown; &#0;');
  });
});

describe('course handout tool', () => {
  it('renders the saved text of an owned course without the model retyping it', async () => {
    const f = fixture();
    const made = await f.run('create_course_handout', { courseId: 'course-1' });
    expect(made.isError).not.toBe(true);
    expect(made.details).toMatchObject({ deliveryState: 'delivered', title: '光的折射' });
    expect(f.loadCourse).toHaveBeenCalledWith('user:one', 'course-1');
    const source = f.render.mock.calls[0][0] as DeliverableSource;
    expect(source.body).toBe(courseHandoutText(COURSE).body);
    expect(source.style).toBe('standard');
    const files = made.details.files as Array<{ download: string }>;
    expect(files.every((file) => isDeliverableDownloadUrl(file.download))).toBe(true);
  });

  it('makes a handwritten worksheet of a part of the course', async () => {
    const f = fixture();
    const made = await f.run('create_course_handout', {
      courseId: 'course-1',
      content: 'questions',
      fromScene: 3,
      style: 'handwriting',
    });
    expect(made.details).toMatchObject({ title: '光的折射 练习', style: 'handwriting' });
  });

  it('treats a course that is missing or someone else’s as not found, and writes nothing', async () => {
    const f = fixture();
    const made = await f.run('create_course_handout', { courseId: 'course-of-another-owner' });
    expect(made).toMatchObject({
      isError: true,
      details: { reason: 'deliverable_course_not_found' },
    });
    expect(f.render).not.toHaveBeenCalled();
    expect(f.persist).not.toHaveBeenCalled();
  });

  it('refuses a session of another owner before it looks for the course', async () => {
    const f = fixture();
    f.owned.mockResolvedValueOnce({ id: 's1', ownerId: 'user:two' });
    const made = await f.run('create_course_handout', { courseId: 'course-1' });
    expect(made).toMatchObject({ isError: true, details: { reason: 'deliverable_not_found' } });
    expect(f.loadCourse).not.toHaveBeenCalled();
  });

  it('says why when there is nothing to export', async () => {
    const f = fixture();
    const reason = async (input: Record<string, unknown>) =>
      ((await f.run('create_course_handout', { courseId: 'course-1', ...input })).details
        .reason as string) ?? 'delivered';
    expect(await reason({ fromScene: 3, toScene: 2 })).toBe('deliverable_course_range');
    expect(await reason({ fromScene: 9 })).toBe('deliverable_course_range');
    expect(await reason({ content: 'questions', toScene: 2 })).toBe(
      'deliverable_course_no_questions',
    );
    expect(f.render).not.toHaveBeenCalled();
  });

  it('refuses a course too long for one handout instead of shortening it', async () => {
    const f = fixture();
    f.loadCourse.mockResolvedValueOnce({
      ...COURSE,
      scenes: [
        {
          title: '长篇',
          type: 'slide',
          content: { type: 'slide' },
          actions: [{ type: 'speech', text: '讲'.repeat(20001) }],
        },
      ],
    });
    const made = await f.run('create_course_handout', { courseId: 'course-1' });
    expect(made).toMatchObject({
      isError: true,
      details: { reason: 'deliverable_course_too_long' },
    });
    expect(f.render).not.toHaveBeenCalled();
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

  it('starts a new page at a page break, and adds no empty page for a trailing one', async () => {
    const render = async (body: string) =>
      (await renderDeliverable({ kind: 'document', title: '练习', body, style: 'standard' }))[0]!
        .pages;
    expect(await render('题目')).toBe(1);
    expect(await render(`题目${DELIVERABLE_PAGE_BREAK}答案`)).toBe(2);
    expect(await render(`题目\n${DELIVERABLE_PAGE_BREAK}\n答案${DELIVERABLE_PAGE_BREAK}`)).toBe(2);
    expect(
      await render(
        `${DELIVERABLE_PAGE_BREAK}${DELIVERABLE_PAGE_BREAK}题目${DELIVERABLE_PAGE_BREAK}`,
      ),
    ).toBe(1);
    // The two pages hold different text: the second is not a copy of the first.
    const files = await renderDeliverable({
      kind: 'document',
      title: '练习',
      body: `题目${DELIVERABLE_PAGE_BREAK}答案`,
      style: 'standard',
    });
    const zip = await JSZip.loadAsync(files.find((file) => file.format === 'zip')!.bytes);
    const [first, second] = await Promise.all(
      ['page-01.png', 'page-02.png'].map((name) => zip.file(name)!.async('nodebuffer')),
    );
    expect(first.equals(second)).toBe(false);
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

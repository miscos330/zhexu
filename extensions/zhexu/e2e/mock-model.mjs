#!/usr/bin/env node
/**
 * A scripted stand-in for an OpenAI-compatible chat model, for the end-to-end
 * tests of the ZHEXU extension's tools.
 *
 *   node extensions/zhexu/e2e/mock-model.mjs          (port 11999)
 *   node extensions/zhexu/e2e/mock-model.mjs 12345
 *
 * It answers `/v1/chat/completions` from a fixed script: asked for a handout it
 * calls the handout tool, asked to annotate it lists the materials, looks at the
 * image and calls the annotation tool, and after a tool result it says a closing
 * line. That is enough to drive the real server, renderer and storage without a
 * provider, a key or a cost. It is not a model: what it "writes" is canned.
 *
 * Loopback only. It logs request paths, model and tool names; it never logs
 * headers or message bodies.
 */
import { createServer } from 'node:http';

const port = Number(process.argv[2] ?? 11999);
const ANSWER =
  '《光的折射》课堂要点\n\n一、光从一种介质斜射入另一种介质时，传播方向发生偏折，这叫光的折射。\n二、光从空气斜射入水或玻璃时，折射角小于入射角；入射角增大，折射角也增大。\n三、垂直入射时传播方向不变；折射现象中光路可逆。';

const textOf = (m) =>
  typeof m?.content === 'string'
    ? m.content
    : Array.isArray(m?.content)
      ? m.content.map((p) => p?.text ?? '').join('\n')
      : '';

function decide(body) {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const tools = (body.tools ?? []).map((t) => t?.function?.name ?? t?.name).filter(Boolean);
  const last = messages[messages.length - 1];
  const lastUser = [...messages].reverse().find((m) => m.role === 'user');
  const ask = textOf(lastUser);
  const has = (name) => tools.includes(name);
  // A tool result is pending when nothing was said after the last tool call. An
  // image a tool returned arrives as an extra user message after the tool message.
  const callIndex = messages.findLastIndex((m) => m.role === 'assistant' && m.tool_calls?.length);
  const after = callIndex >= 0 ? messages.slice(callIndex + 1) : [];
  const toolMessage = after.some((m) => m.role === 'assistant')
    ? undefined
    : after.find((m) => m.role === 'tool');
  const lastCall = toolMessage ? messages[callIndex].tool_calls.at(-1) : undefined;
  const lastCallName = lastCall?.function?.name;
  if (toolMessage && lastCallName === 'list_materials') {
    const id = (textOf(toolMessage).match(/mat_[a-z0-9]+/) ?? [])[0];
    return id && has('view_material_image')
      ? { tool: 'view_material_image', args: { materialId: id } }
      : { text: '（模拟模型）没有找到图片，或者这次运行没有看图工具。' };
  }
  if (toolMessage && lastCallName === 'view_material_image') {
    const view = textOf(toolMessage).match(/viewId=(view_[a-f0-9]{24})/);
    let materialId;
    try {
      materialId = JSON.parse(lastCall.function.arguments).materialId;
    } catch {}
    return view && materialId && has('annotate_image')
      ? {
          tool: 'annotate_image',
          args: {
            materialId,
            title: '植物细胞结构示意图',
            viewId: view[1],
            annotations: [
              { x: 0.1, y: 0.5, label: '细胞壁' },
              { x: 0.35, y: 0.5, label: '细胞核' },
              { x: 0.67, y: 0.5, label: '液泡' },
              { x: 0.25, y: 0.775, label: '叶绿体' },
            ],
          },
        }
      : { text: '（模拟模型）看图失败，原因见上面的工具结果。' };
  }
  if (toolMessage && lastCallName === 'annotate_image') {
    return {
      text: /"status":"saved"/.test(textOf(toolMessage))
        ? '标注图已经生成，请在卡片里预览和下载，并核对标注位置。'
        : '这次没有生成标注图，原因见上面的工具结果。',
    };
  }
  if (/标注/.test(ask) && has('list_materials') && last?.role === 'user')
    return { tool: 'list_materials', args: {} };
  if (toolMessage) {
    const failed = /was not delivered/.test(textOf(toolMessage));
    return {
      text: failed
        ? '这次没有生成文件，原因见上面的工具结果。'
        : '讲义已经生成，可以在上面的卡片里预览和下载。',
    };
  }
  if (/讲义|导出|PDF|pdf/.test(ask) && tools.length) {
    if (/上一条|上面|刚才/.test(ask) && has('export_deliverable'))
      return {
        tool: 'export_deliverable',
        args: { source: 'last-answer', ...(/手写/.test(ask) ? { style: 'handwriting' } : {}) },
      };
    if (has('create_deliverable'))
      return {
        tool: 'create_deliverable',
        args: {
          kind: 'document',
          title: '光的折射 课堂要点',
          body: ANSWER,
          ...(/手写/.test(ask) ? { style: 'handwriting' } : {}),
        },
      };
    return { text: '（模拟模型）这次运行没有讲义工具。' };
  }
  return { text: tools.length ? ANSWER : '光的折射' };
}

const chunk = (model, delta, finish = null) => ({
  id: 'chatcmpl-mock',
  object: 'chat.completion.chunk',
  created: Math.floor(Date.now() / 1000),
  model,
  choices: [{ index: 0, delta, finish_reason: finish }],
});

createServer((req, res) => {
  let raw = '';
  req.on('data', (d) => (raw += d));
  req.on('end', () => {
    const path = req.url ?? '';
    if (req.method === 'GET' && /\/models$/.test(path)) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(
        JSON.stringify({ object: 'list', data: [{ id: 'mock-handout', object: 'model' }] }),
      );
    }
    if (req.method !== 'POST' || !/\/chat\/completions$/.test(path)) {
      console.log(`[mock-llm] unhandled ${req.method} ${path}`);
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: { message: 'mock: unhandled path' } }));
    }
    let body = {};
    try {
      body = JSON.parse(raw);
    } catch {}
    const model = body.model ?? 'mock-handout';
    const tools = (body.tools ?? []).map((t) => t?.function?.name ?? t?.name).filter(Boolean);
    const plan = decide(body);
    const images = JSON.stringify(body.messages ?? []).split('"image_url"').length - 1;
    console.log(
      `[mock-llm] POST ${path} model=${model} stream=${Boolean(body.stream)} messages=${body.messages?.length ?? 0} tools=${tools.length} extensionTools=[${tools.filter((n) => /deliverable|annotate_image|view_material_image/.test(n)).join(',')}] imagesInRequest=${images} -> ${plan.tool ? 'tool:' + plan.tool : 'text'}`,
    );
    const usage = { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 };
    const toolCall = plan.tool && {
      id: 'call_mock_' + Date.now(),
      type: 'function',
      function: { name: plan.tool, arguments: JSON.stringify(plan.args) },
    };
    if (!body.stream) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(
        JSON.stringify({
          id: 'chatcmpl-mock',
          object: 'chat.completion',
          created: Math.floor(Date.now() / 1000),
          model,
          choices: [
            {
              index: 0,
              message: toolCall
                ? { role: 'assistant', content: null, tool_calls: [toolCall] }
                : { role: 'assistant', content: plan.text },
              finish_reason: toolCall ? 'tool_calls' : 'stop',
            },
          ],
          usage,
        }),
      );
    }
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
    const send = (value) => res.write(`data: ${JSON.stringify(value)}\n\n`);
    send(chunk(model, { role: 'assistant', content: '' }));
    if (toolCall) {
      send(chunk(model, { tool_calls: [{ index: 0, ...toolCall }] }));
      send(chunk(model, {}, 'tool_calls'));
    } else {
      for (const part of plan.text.match(/[\s\S]{1,24}/g) ?? [])
        send(chunk(model, { content: part }));
      send(chunk(model, {}, 'stop'));
    }
    send({ ...chunk(model, {}), choices: [], usage });
    res.write('data: [DONE]\n\n');
    res.end();
  });
}).listen(port, '127.0.0.1', () => console.log(`[mock-llm] listening on 127.0.0.1:${port}`));

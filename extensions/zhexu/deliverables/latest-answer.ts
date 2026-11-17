import { DELIVERABLE_TOOL_NAMES, isDeliverableDownloadUrl } from './contract';

interface Message {
  role: string;
  content?: unknown;
}

interface Part {
  type?: unknown;
  text?: unknown;
  name?: unknown;
}

function textOf(message: Message): string {
  if (typeof message.content === 'string') return message.content;
  if (!Array.isArray(message.content)) return '';
  return (message.content as Part[])
    .filter((part) => part?.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text as string)
    .join('\n');
}

const calls = (message: Message, names?: readonly string[]) =>
  Array.isArray(message.content) &&
  (message.content as Part[]).some(
    (part) =>
      part?.type === 'toolCall' &&
      (!names || (typeof part.name === 'string' && names.includes(part.name))),
  );

/** True when a handout tool was called earlier in the same turn as the message at `index`. */
function followsHandoutCall(messages: readonly unknown[], index: number): boolean {
  for (let i = index - 1; i >= 0; i -= 1) {
    const message = messages[i] as Message | null | undefined;
    if (!message || typeof message !== 'object') continue;
    if (message.role === 'user') return false;
    if (message.role === 'assistant' && calls(message, DELIVERABLE_TOOL_NAMES)) return true;
  }
  return false;
}

/**
 * The answer "export the last answer" means: the newest assistant message that
 * is text, calls no tool, was not written after a handout tool ran in the same
 * turn and does not itself hand out a handout link. What the assistant says
 * about an export ("here are the files", "it failed") is not the content to
 * export, so a retry still finds the answer the user meant.
 */
export function latestExportableAnswer(messages: readonly unknown[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index] as Message | null | undefined;
    if (!message || typeof message !== 'object' || message.role !== 'assistant') continue;
    if (calls(message) || followsHandoutCall(messages, index)) continue;
    const body = textOf(message);
    if (!body.trim()) continue;
    if (body.split(/[\s()<>"']+/).some((token) => isDeliverableDownloadUrl(token))) continue;
    return body;
  }
  return '';
}

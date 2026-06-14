import { mastra } from '../mastra';
import { neonDocsToolsets } from './mcp';

export function mentionsNeon(body: string): boolean {
  return /(^|\s)@neon\b/i.test(body);
}

export type HistoryMessage = { userName: string; body: string; imageUrl: string | null };

// Build the recent transcript (oldest first, with any image links) and let the
// assistant reply, using the Neon docs MCP tools + on-demand skills.
export async function runAssistant(history: HistoryMessage[]): Promise<string> {
  const transcript = history
    .map((m) => `${m.userName}: ${m.body}${m.imageUrl ? ` [image: ${m.imageUrl}]` : ''}`)
    .join('\n');
  const prompt = [
    'You were mentioned with @neon in this group chat. Here are the most recent messages',
    '(oldest first). Reply to the latest @neon mention.',
    '',
    transcript,
  ].join('\n');

  const toolsets = await neonDocsToolsets();
  const res = await mastra.getAgent('assistant').generate(prompt, {
    toolsets,
    maxSteps: 8,
    abortSignal: AbortSignal.timeout(120_000),
  });
  return (res.text ?? '').trim();
}

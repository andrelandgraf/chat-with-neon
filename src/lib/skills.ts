import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import skills from '../skills/skills.json';

type Skill = { description: string; body: string };
const SKILLS: Record<string, Skill> = skills;

// The frontmatter (name + description) of every skill, always given to the agent
// so it knows what's available and can load the full skill on demand.
export const SKILL_INDEX = Object.entries(SKILLS)
  .map(([name, s]) => `- ${name}: ${s.description}`)
  .join('\n');

export const loadSkillTool = createTool({
  id: 'load_skill',
  description:
    'Load the full content of a Neon agent skill by name (e.g. "neon-postgres-branches") ' +
    'when a question matches that skill, to learn how to do it with Neon.',
  inputSchema: z.object({ name: z.string().describe('The skill name to load') }),
  outputSchema: z.object({ name: z.string(), content: z.string() }),
  execute: async (inputData) => {
    const skill = SKILLS[inputData.name];
    if (!skill) {
      return {
        name: inputData.name,
        content: `No skill named "${inputData.name}". Available: ${Object.keys(SKILLS).join(', ')}`,
      };
    }
    return { name: inputData.name, content: skill.body };
  },
});

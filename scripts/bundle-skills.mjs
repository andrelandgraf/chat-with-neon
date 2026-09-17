import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const skillsDir = join(root, ".agents", "skills");
const outFile = join(root, "src", "skills", "skills.json");

function parseFrontmatter(raw, name) {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    throw new Error(`${name}: missing YAML frontmatter`);
  }
  const yaml = match[1];
  const body = match[2].replace(/^\s+/, "");
  const folded = yaml.match(/^description:\s*[>|]-?\r?\n((?:[ \t]+.*\r?\n?)*)/m);
  let description;
  if (folded) {
    description = folded[1]
      .split(/\r?\n/)
      .map((line) => line.replace(/^[ \t]+/, "").trim())
      .filter(Boolean)
      .join(" ");
  } else {
    const line = yaml.match(/^description:\s*(.+)$/m);
    if (!line) {
      throw new Error(`${name}: missing description`);
    }
    description = line[1].trim().replace(/^["']|["']$/g, "");
  }
  if (!description) {
    throw new Error(`${name}: empty description`);
  }
  return { description, body };
}

const names = readdirSync(skillsDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
  .map((entry) => entry.name)
  .sort();

if (names.length === 0) {
  throw new Error("no skills installed under .agents/skills");
}

const skills = {};
for (const name of names) {
  const skillFile = join(skillsDir, name, "SKILL.md");
  const raw = readFileSync(skillFile, "utf8");
  skills[name] = parseFrontmatter(raw, name);
}

writeFileSync(outFile, `${JSON.stringify(skills, null, 2)}\n`);
console.log(`wrote ${names.length} skills to ${outFile}`);

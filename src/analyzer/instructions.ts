export interface Instruction {
  id: string;
  text: string;
  heading: string | null;
  source: string;
  line: number; // 1-based line of the instruction's first line
}

const BULLET = /^\s{0,3}(?:[-*]|\d+\.)\s+(.*)$/;
const HEADING = /^#{1,6}\s+(.*)$/;
const FENCE = /^\s*```/;

export function parseInstructions(markdown: string, source: string): Instruction[] {
  const lines = markdown.split(/\r?\n/);
  const out: Instruction[] = [];
  let heading: string | null = null;
  let current: { line: number; parts: string[] } | null = null;
  let inFence = false;

  const flush = () => {
    if (current) {
      const text = current.parts.join(' ').replace(/\s+/g, ' ').trim();
      if (text) out.push({ id: `${source}:${current.line}`, text, heading, source, line: current.line });
      current = null;
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (FENCE.test(raw)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      if (current) current.parts.push(raw.trim());
      continue;
    }
    const headingMatch = raw.match(HEADING);
    if (headingMatch) {
      flush();
      heading = headingMatch[1].trim();
      continue;
    }
    if (!raw.trim()) {
      flush();
      continue;
    }
    const bulletMatch = raw.match(BULLET);
    if (bulletMatch) {
      flush();
      current = { line: i + 1, parts: [bulletMatch[1].trim()] };
    } else if (current) {
      current.parts.push(raw.trim());
    } else {
      current = { line: i + 1, parts: [raw.trim()] };
    }
  }
  flush();
  return out;
}

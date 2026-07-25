import { parseInstructions } from '../analyzer/instructions.js';
import { auditInstructions } from '../analyzer/audit.js';
import type { Verdict, Solver } from './types.js';

export const auditSolver: Solver = {
  name: 'audit',
  run(input) {
    const instructions = parseInstructions(input.markdown, input.source);
    const report = auditInstructions(instructions, input.sessions);
    const out = new Map<string, Verdict>();
    for (const f of report.findings) out.set(f.instruction.id, f.verdict);
    return out;
  },
};

/**
 * Rendering bytecode as readable text.
 *
 * Not a gameplay feature. It exists because when a script misbehaves the only way
 * to find out what it meant to do is to read it. Reachable while the game runs
 * through the debug overlay's F9 key; see `shell/debug.ts`.
 */
import type { Condition, Instruction } from './reader.ts';
import { decodeLogic } from './reader.ts';
import type { LogicResource } from './resource.ts';

export interface DisassembleOptions {
  /** Show the text of referenced messages as trailing comments. */
  showMessages?: boolean;
  /** Longest message excerpt to show, in characters. */
  messageWidth?: number;
}

/** Render one condition. */
function condition(node: Condition): string {
  switch (node.kind) {
    case 'test':
      return `${node.name}(${node.args.join(', ')})`;
    case 'said':
      return `said(${node.words.join(', ')})`;
    case 'not':
      return `!${condition(node.condition)}`;
    case 'or':
      return `(${node.conditions.map(condition).join(' || ')})`;
  }
}

/** Render one instruction, without its address. */
export function formatInstruction(instruction: Instruction): string {
  switch (instruction.kind) {
    case 'action':
      return instruction.args.length === 0
        ? `${instruction.name}()`
        : `${instruction.name}(${instruction.args.join(', ')})`;
    case 'if':
      return `if (${instruction.conditions.map(condition).join(' && ')}) goto ${instruction.target}`;
    case 'else':
      return `goto ${instruction.target}`;
  }
}

/**
 * Disassemble a LOGIC resource.
 *
 * @returns one line per instruction, addresses first
 */
export function disassemble(
  resource: LogicResource,
  options: DisassembleOptions = {},
): string[] {
  const { showMessages = true, messageWidth = 48 } = options;
  const instructions = decodeLogic(resource.bytecode);

  return instructions.map((instruction) => {
    let line = `${String(instruction.at).padStart(5)}  ${formatInstruction(instruction)}`;

    if (showMessages && instruction.kind === 'action') {
      // Commands that print take a message number as their first argument.
      const takesMessage = /^(print|display|log|set\.menu|set\.game\.id|get\.num|set\.string)/;
      if (takesMessage.test(instruction.name) && instruction.args.length > 0) {
        const text = resource.messages.texts[instruction.args[0]!];
        if (text) {
          const excerpt = text.length > messageWidth ? `${text.slice(0, messageWidth)}...` : text;
          line += `   ; ${JSON.stringify(excerpt)}`;
        }
      }
    }

    return line;
  });
}

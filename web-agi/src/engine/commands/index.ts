/**
 * The command table.
 *
 * Handlers are matched by name and then placed at their opcode, so the table
 * survives any future correction to the opcode numbering. Anything without an
 * implementation becomes a counted stub rather than a crash: the engine keeps
 * running and reports exactly which commands the game reached and it cannot yet
 * do, which is the list of what to build next.
 */
import { ACTIONS } from '../../logic/opcodes.ts';
import type { Handler } from '../machine.ts';
import { CORE } from './core.ts';
import { GRAPHICS } from './graphics.ts';
import { ITEMS } from './items.ts';
import { OBJECTS } from './objects.ts';
import { TEXT } from './text.ts';

export function buildHandlers(): Handler[] {
  const byName: Record<string, Handler> = { ...CORE, ...GRAPHICS, ...OBJECTS, ...TEXT, ...ITEMS };

  return ACTIONS.map((command) => {
    const implemented = byName[command.name];
    if (implemented) return implemented;
    return (machine) => machine.stub(command.name);
  });
}

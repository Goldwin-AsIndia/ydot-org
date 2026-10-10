import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The confirmation popup's header (BUG-103): the design says eyebrow, title and the close
 * button only - the description line that used to sit under the title is gone.
 *
 * Read from the template itself rather than rendered, so the assertion holds whether or not a
 * dialog is open at the time.
 */
describe('Follow-up planner confirmation popup', () => {
  const template = readFileSync(join(__dirname, 'follow-up-planner.html'), 'utf8');

  function confirmationHeader(): string {
    const match = /<header class="fp-dialog-top">[\s\S]*?<\/header>/.exec(template);
    return match?.[0] ?? '';
  }

  it('keeps the eyebrow and the title', () => {
    const header = confirmationHeader();
    expect(header).toContain('fp-eyebrow');
    expect(header).toContain('fp-confirm-title');
  });

  it('no longer prints the description under the title', () => {
    expect(confirmationHeader()).not.toContain('config.message');
    // Belt and braces: no message paragraph anywhere inside the dialog either.
    const dialog = /<dialog[\s\S]*?<\/dialog>/.exec(template)?.[0] ?? '';
    expect(dialog).not.toContain('config.message');
  });
});
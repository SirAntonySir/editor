/**
 * The legacy ⌘K modal palette is replaced by the inline AskAiInput at the
 * top of the Suggestions section. The 'spawn-palette:open' event now just
 * focuses that input (handled inside AskAiInput). Nothing to render here.
 */
export function SpawnPaletteWidget() {
  return null;
}

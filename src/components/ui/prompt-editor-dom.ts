import type { PromptDoc, PromptSegment } from '@/lib/prompt-doc';
import { parseAttachmentSourceId, toReferenceSourceId, toTargetSourceId } from '@/lib/prompt-doc';

/** DOM attribute carrying a chip's `sourceId`. Its presence is what marks an
 *  element as a chip during {@link parseEditorDom}. */
export const CHIP_SOURCE_ATTR = 'data-chip-source-id';
/** DOM attribute carrying a chip's display label (kept separate from
 *  `textContent` so a chip's × affordance can't leak into the parsed label). */
export const CHIP_LABEL_ATTR = 'data-chip-label';
/** Marks the × affordance inside a chip so click handling can target it. */
export const CHIP_REMOVE_ATTR = 'data-chip-remove';
/** Marks the Target⇄Reference toggle inside an image-attachment chip. */
export const CHIP_ROLE_TOGGLE_ATTR = 'data-chip-role-toggle';

/** Build the atomic chip element rendered inside the editor. Non-editable so
 *  the caret can never land inside it; carries label + sourceId as data attrs
 *  for round-tripping back into a {@link PromptDoc}. Styled to match the
 *  palette's context-chip aesthetic. */
export function makeChipElement(chip: { label: string; sourceId: string }): HTMLElement {
  const span = document.createElement('span');
  span.setAttribute(CHIP_SOURCE_ATTR, chip.sourceId);
  span.setAttribute(CHIP_LABEL_ATTR, chip.label);
  span.setAttribute('contenteditable', 'false');
  span.className =
    'inline-flex items-center gap-0.5 align-baseline text-[10px] mx-px ' +
    'rounded-[3px] px-1 leading-tight select-none ' +
    'bg-[color-mix(in_srgb,var(--color-ai)_15%,transparent)] ' +
    'text-[var(--color-ai)] border border-[color-mix(in_srgb,var(--color-ai)_30%,transparent)]';

  const labelEl = document.createElement('span');
  labelEl.className = 'text-text-primary';
  labelEl.textContent = chip.label;
  span.appendChild(labelEl);

  // Image/layer attachments (target/reference) carry a role toggle so the user
  // can mark a chip as a look reference (matched, never edited) vs a target.
  // Region chips don't — they're always things to act on.
  const attachment = parseAttachmentSourceId(chip.sourceId);
  if (attachment) {
    const toggle = document.createElement('span');
    toggle.setAttribute(CHIP_ROLE_TOGGLE_ATTR, '');
    toggle.className = 'cursor-pointer text-text-secondary hover:text-text-primary';
    _paintRoleToggle(toggle, attachment.role);
    span.appendChild(toggle);
  }

  const remove = document.createElement('span');
  remove.setAttribute(CHIP_REMOVE_ATTR, '');
  remove.className = 'cursor-pointer text-text-secondary hover:text-text-primary';
  remove.textContent = '×';
  span.appendChild(remove);

  return span;
}

/** Paint the role toggle's badge + the chip's accent for the given role.
 *  Reference chips read amber ("match this"), targets keep the AI accent. */
function _paintRoleToggle(toggle: HTMLElement, role: 'target' | 'reference'): void {
  toggle.textContent = role === 'reference' ? 'ref' : 'tgt';
  toggle.title =
    role === 'reference'
      ? 'Reference — matched, not edited (click to make this a target)'
      : 'Target — will be edited (click to make this a reference)';
}

/** Flip an attachment chip between target and reference: rewrites its
 *  {@link CHIP_SOURCE_ATTR} and repaints the toggle badge. No-op for chips
 *  that aren't image/layer attachments. Returns the new role, or null. */
export function flipChipRole(chip: HTMLElement): 'target' | 'reference' | null {
  const sourceId = chip.getAttribute(CHIP_SOURCE_ATTR) ?? '';
  const parsed = parseAttachmentSourceId(sourceId);
  if (!parsed) return null;
  const nextRole = parsed.role === 'target' ? 'reference' : 'target';
  const nextSource = nextRole === 'reference' ? toReferenceSourceId(sourceId) : toTargetSourceId(sourceId);
  chip.setAttribute(CHIP_SOURCE_ATTR, nextSource);
  const toggle = chip.querySelector<HTMLElement>(`[${CHIP_ROLE_TOGGLE_ATTR}]`);
  if (toggle) _paintRoleToggle(toggle, nextRole);
  return nextRole;
}

/** Push text onto the doc, merging into a trailing text segment and skipping
 *  empty runs so parsing is normalized (one text segment between chips). */
function pushText(doc: PromptSegment[], text: string): void {
  if (!text) return;
  const last = doc[doc.length - 1];
  if (last && last.kind === 'text') last.text += text;
  else doc.push({ kind: 'text', text });
}

/** Walk a contenteditable root's children into a {@link PromptDoc}. Text nodes
 *  become text segments (merged, empties dropped); elements bearing
 *  {@link CHIP_SOURCE_ATTR} become chip segments; anything else (e.g. a stray
 *  `<br>`) contributes its text content only. */
export function parseEditorDom(root: HTMLElement): PromptDoc {
  const doc: PromptSegment[] = [];
  root.childNodes.forEach((node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      pushText(doc, node.textContent ?? '');
      return;
    }
    if (node instanceof HTMLElement) {
      const sourceId = node.getAttribute(CHIP_SOURCE_ATTR);
      if (sourceId) {
        doc.push({
          kind: 'chip',
          label: node.getAttribute(CHIP_LABEL_ATTR) ?? node.textContent ?? '',
          sourceId,
        });
      } else if (node.tagName !== 'BR') {
        pushText(doc, node.textContent ?? '');
      }
    }
  });
  return doc;
}

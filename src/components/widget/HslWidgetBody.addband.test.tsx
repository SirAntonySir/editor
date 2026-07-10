import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { HslWidgetBody } from './HslWidgetBody';
import { makeHslWidget } from './__fixtures__/widgets';
import { useEditorStore } from '@/store';
import type { ControlBinding, Widget } from '@/types/widget';

const ALL = ['red', 'orange', 'yellow', 'green', 'aqua', 'blue', 'purple', 'magenta'];
const eff = (b: ControlBinding) => b.value;

function withEdited(widget: Widget, ...keys: string[]): Widget {
  return {
    ...widget,
    bindings: widget.bindings.map((b) => (keys.includes(b.paramKey) ? { ...b, value: 10 } : b)),
  };
}

afterEach(cleanup);
beforeEach(() => useEditorStore.setState({ hslRevealedBands: {} }));

describe('HSL single-band spawn + add colour', () => {
  it('a fresh all-bands widget opens on a single colour with an add-colour affordance', () => {
    render(<HslWidgetBody widget={makeHslWidget(ALL)} effectiveValue={eff} setParam={() => {}} />);
    expect(screen.getAllByRole('slider').length).toBe(3); // one band's Hue/Sat/Lum
    expect(screen.queryByLabelText('Select Red')).toBeNull(); // no multi-band rail yet
    expect(screen.getByLabelText('Add colour')).toBeInTheDocument();
  });

  it('adding a colour augments the widget instead of replacing the first band', async () => {
    const user = userEvent.setup();
    render(<HslWidgetBody widget={makeHslWidget(ALL)} effectiveValue={eff} setParam={() => {}} />);
    const trigger = screen.getByLabelText('Add colour');
    trigger.focus();
    await user.keyboard('{Enter}'); // Radix opens reliably via keyboard under jsdom
    await user.click(await screen.findByRole('menuitem', { name: 'Blue' }));
    // Both the default red AND the added blue are shown (multi-band rail).
    expect(screen.getByLabelText('Select Red')).toBeInTheDocument();
    expect(screen.getByLabelText('Select Blue')).toBeInTheDocument();
  });

  it('shows every edited band up front without any manual reveal', () => {
    render(
      <HslWidgetBody
        widget={withEdited(makeHslWidget(ALL), 'orange_hue', 'blue_sat')}
        effectiveValue={eff}
        setParam={() => {}}
      />,
    );
    expect(screen.getByLabelText('Select Orange')).toBeInTheDocument();
    expect(screen.getByLabelText('Select Blue')).toBeInTheDocument();
  });
});

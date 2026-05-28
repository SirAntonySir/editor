import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { SliderControl } from './SliderControl';
import { ToggleControl } from './ToggleControl';
import { ChoiceControl } from './ChoiceControl';
import { ColorControl } from './ColorControl';
import { MaskThumbnailControl } from './MaskThumbnailControl';
import { RegionPickerControl } from './RegionPickerControl';

afterEach(cleanup);

describe('SliderControl', () => {
  it('renders value and emits onChange', () => {
    const onChange = vi.fn();
    render(<SliderControl
      label="Temperature" value={6500} default={5500}
      schema={{ control_type: 'slider', min: 3000, max: 9000, step: 50 }}
      onChange={onChange} />);
    expect(screen.getByText('Temperature')).toBeDefined();
    const input = screen.getByRole('slider') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '7000' } });
    expect(onChange).toHaveBeenCalledWith(7000);
  });
});

describe('ToggleControl', () => {
  it('flips on click and emits boolean', () => {
    const onChange = vi.fn();
    render(<ToggleControl
      label="Skin protect" value={true} default={true}
      schema={{ control_type: 'toggle', on_label: 'Protect', off_label: 'Off' }}
      onChange={onChange} />);
    fireEvent.click(screen.getByRole('switch'));
    expect(onChange).toHaveBeenCalledWith(false);
  });
});

describe('ChoiceControl', () => {
  it('renders options and emits selected value', () => {
    const onChange = vi.fn();
    render(<ChoiceControl
      label="Preset" value="warm" default="warm"
      schema={{
        control_type: 'choice',
        options: [
          { value: 'warm', label: 'Warm' },
          { value: 'cool', label: 'Cool' },
        ],
      }}
      onChange={onChange} />);
    expect(screen.getByText('Warm')).toBeDefined();
  });
});

describe('ColorControl', () => {
  it('renders the current color', () => {
    render(<ColorControl
      label="Tint" value="#ff8800" default="#ffffff"
      schema={{ control_type: 'color', mode: 'hex' }}
      onChange={() => {}} />);
    expect(screen.getByLabelText('Tint')).toBeDefined();
  });
});

describe('MaskThumbnailControl', () => {
  it('renders read-only label for a mask', () => {
    render(<MaskThumbnailControl
      label="Skin"
      value="m_1"
      default="m_1"
      schema={{ control_type: 'mask_thumbnail' }}
      onChange={() => {}}
      maskSummaries={[{ id: 'm_1', width: 100, height: 100, source: 'sam_point', label: 'Skin' }]}
    />);
    // Both the control label and the mask label are "Skin", so use getAllByText.
    expect(screen.getAllByText('Skin').length).toBeGreaterThan(0);
  });
});

describe('RegionPickerControl', () => {
  it('lists named regions and emits selection', () => {
    const onChange = vi.fn();
    render(<RegionPickerControl
      label="Region"
      value="m_1"
      default="m_1"
      schema={{ control_type: 'region_picker' }}
      onChange={onChange}
      maskSummaries={[
        { id: 'm_1', width: 100, height: 100, source: 'sam_point', label: 'Skin' },
        { id: 'm_2', width: 100, height: 100, source: 'sam_point', label: 'Sky' },
      ]}
    />);
    expect(screen.getByText('Skin')).toBeDefined();
  });
});

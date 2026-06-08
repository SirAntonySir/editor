import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';
import { PointList } from '../PointList';

afterEach(cleanup);

const baseSchema = {
  type: 'curve_points' as const,
  default: [[0, 0], [1, 1]] as [number, number][],
};

describe('PointList control', () => {
  it('renders label', () => {
    const { getByText } = render(
      <PointList paramKey="points" label="Points" value={[[0, 0], [1, 1]]} schema={baseSchema} onChange={() => undefined} />,
    );
    expect(getByText('Points')).toBeTruthy();
  });

  it('renders textarea with serialized JSON', () => {
    const { getByRole } = render(
      <PointList paramKey="points" label="Points" value={[[0, 0], [1, 1]]} schema={baseSchema} onChange={() => undefined} />,
    );
    expect(getByRole('textbox')).toBeTruthy();
  });

  it('calls onChange with parsed JSON on blur', () => {
    const onChange = vi.fn();
    const { getByRole } = render(
      <PointList paramKey="points" label="Points" value={[[0, 0], [1, 1]]} schema={baseSchema} onChange={onChange} />,
    );
    const textarea = getByRole('textbox');
    fireEvent.change(textarea, { target: { value: '[[0,0],[0.5,0.7],[1,1]]' } });
    fireEvent.blur(textarea);
    expect(onChange).toHaveBeenCalledWith([[0, 0], [0.5, 0.7], [1, 1]]);
  });

  it('shows error message on invalid JSON', () => {
    const { getByRole, getByText } = render(
      <PointList paramKey="points" label="Points" value={[[0, 0], [1, 1]]} schema={baseSchema} onChange={() => undefined} />,
    );
    const textarea = getByRole('textbox');
    fireEvent.change(textarea, { target: { value: 'not json {{{' } });
    fireEvent.blur(textarea);
    expect(getByText(/Invalid JSON/)).toBeTruthy();
  });
});

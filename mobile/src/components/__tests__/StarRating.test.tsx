import { fireEvent, render } from '@testing-library/react-native';
import { StarRating } from '../StarRating';

describe('StarRating', () => {
  test('renders exactly five stars', async () => {
    const { getByLabelText } = await render(<StarRating value={3} onChange={() => undefined} />);
    for (const star of [1, 2, 3, 4, 5]) {
      expect(getByLabelText(`Rate ${star} star${star > 1 ? 's' : ''}`)).toBeTruthy();
    }
  });

  test('tapping the 4th star reports 4', async () => {
    const onChange = jest.fn();
    const { getByLabelText } = await render(<StarRating value={0} onChange={onChange} />);

    fireEvent.press(getByLabelText('Rate 4 stars'));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(4);
  });

  test('re-tapping updates the rating (5 → 2)', async () => {
    const onChange = jest.fn();
    const { getByLabelText } = await render(<StarRating value={5} onChange={onChange} />);

    fireEvent.press(getByLabelText('Rate 2 stars'));

    expect(onChange).toHaveBeenCalledWith(2);
  });

  test('disabled stars render inert (no pressables, no onChange)', async () => {
    const onChange = jest.fn();
    const { queryByLabelText } = await render(
      <StarRating value={3} onChange={onChange} disabled />,
    );

    expect(queryByLabelText('Rate 5 stars')).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  test('display-only mode (no onChange) renders without pressable stars', async () => {
    const { queryByLabelText } = await render(<StarRating value={4} />);

    expect(queryByLabelText('Rate 4 stars')).toBeNull();
  });
});

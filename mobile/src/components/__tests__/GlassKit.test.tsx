import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { GlassTextField } from '../GlassTextField';
import { StatusChip, statusLabel } from '../StatusChip';

describe('GlassTextField', () => {
  test('renders label, placeholder and left icon slot', async () => {
    const { getByText, getByPlaceholderText } = await render(
      <GlassTextField label="Phone number" icon="call-outline" placeholder="98765 43210" />,
    );

    expect(getByText('Phone number')).toBeTruthy();
    expect(getByPlaceholderText('98765 43210')).toBeTruthy();
  });

  test('password toggle switches secureTextEntry and accessibility label', async () => {
    const { getByLabelText, getByPlaceholderText } = await render(
      <GlassTextField label="Password" icon="lock-closed-outline" placeholder="Secret" secure />,
    );

    const input = getByPlaceholderText('Secret');
    const showButton = getByLabelText('Show password');

    // Hidden by default.
    expect(input.props.secureTextEntry).toBe(true);

    fireEvent.press(showButton);

    await waitFor(() => expect(getByLabelText('Hide password')).toBeTruthy());
    expect(getByPlaceholderText('Secret').props.secureTextEntry).toBe(false);

    fireEvent.press(getByLabelText('Hide password'));

    await waitFor(() => expect(getByLabelText('Show password')).toBeTruthy());
    expect(getByPlaceholderText('Secret').props.secureTextEntry).toBe(true);
  });

  test('error text renders under the field when provided', async () => {
    const { getByText, queryByText } = await render(
      <GlassTextField label="Phone" placeholder="98765 43210" error="Invalid phone number" />,
    );

    expect(getByText('Invalid phone number')).toBeTruthy();
    expect(queryByText('No error')).toBeNull();
  });

  test('non-secure fields render without a toggle', async () => {
    const { queryByLabelText } = await render(
      <GlassTextField label="Name" placeholder="Your name" />,
    );
    expect(queryByLabelText('Show password')).toBeNull();
  });
});

describe('StatusChip', () => {
  test.each([
    ['CONFIRMED', 'Confirmed'],
    ['CALLED', 'Called'],
    ['COMPLETED', 'Completed'],
    ['CANCELLED', 'Cancelled'],
    ['NO_SHOW', 'No-show'],
    ['PENDING', 'Pending'],
  ] as const)('status %s renders the label "%s"', async (status, label) => {
    const { getByText } = await render(<StatusChip status={status} />);
    expect(getByText(label)).toBeTruthy();
  });

  test('statusLabel maps every machine status to English', () => {
    expect(statusLabel('NO_SHOW')).toBe('No-show');
    expect(statusLabel('CONFIRMED')).toBe('Confirmed');
  });
});

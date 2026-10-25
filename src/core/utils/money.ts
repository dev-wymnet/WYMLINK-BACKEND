const MONEY_SCALE = 2n;
const MONEY_FACTOR = 10n ** MONEY_SCALE;

export type MoneyCents = bigint;

export function parseMoneyToCents(input: string): MoneyCents {
  const trimmed = input.trim();
  if (!/^-?\d+(\.\d{1,2})?$/.test(trimmed)) {
    throw new Error('Invalid money amount');
  }

  const negative = trimmed.startsWith('-');
  const normalized = negative ? trimmed.slice(1) : trimmed;

  const parts = normalized.split('.');
  const whole = parts[0] ?? '0';
  const frac = parts[1] ?? '';
  const fracPadded = (frac + '00').slice(0, 2);

  const cents = BigInt(whole) * MONEY_FACTOR + BigInt(fracPadded);
  return negative ? -cents : cents;
}

export function centsToMoneyString(cents: MoneyCents): string {
  const negative = cents < 0n;
  const abs = negative ? -cents : cents;
  const whole = abs / MONEY_FACTOR;
  const frac = abs % MONEY_FACTOR;
  const result = `${whole.toString()}.${frac.toString().padStart(2, '0')}`;
  return negative ? `-${result}` : result;
}

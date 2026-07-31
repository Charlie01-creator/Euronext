import { roundMoney } from '../src/utils/money';

describe('roundMoney', () => {
  it('rounds a value that floating-point math left slightly imprecise', () => {
    expect(roundMoney(0.1 + 0.2)).toBe(0.3);
  });

  it('rounds .005 up correctly (the classic floating-point rounding trap)', () => {
    expect(roundMoney(10.005)).toBe(10.01);
  });

  it('matches the real package-tier profit calculations used at seed time', () => {
    expect(roundMoney(7 * 0.02)).toBe(0.14); // Starter tier
    expect(roundMoney(25 * 0.021)).toBe(0.53); // Basic tier
    expect(roundMoney(1000 * 0.085)).toBe(85); // Gold tier
    expect(roundMoney(2500 * 0.094)).toBe(235); // Gold Plus tier
  });

  it('leaves already-clean values unchanged', () => {
    expect(roundMoney(100.1)).toBe(100.1);
    expect(roundMoney(0)).toBe(0);
  });
});

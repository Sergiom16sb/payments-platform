/**
 * Luhn checksum (a.k.a. mod-10). Used to validate that a PAN could be a
 * real card number before we waste time tokenizing it.
 *
 * The algorithm:
 *   1. From the rightmost digit (the check digit), double every second
 *      digit. If the doubled value > 9, subtract 9.
 *   2. Sum all digits.
 *   3. The number is valid iff the sum is a multiple of 10.
 *
 * Real card numbers (Visa, MC, Amex, etc.) always satisfy this.
 */
export function isLuhnValid(pan: string): boolean {
  const digits = pan.replace(/\D/g, '');
  if (digits.length < 13 || digits.length > 19) return false;

  let sum = 0;
  let shouldDouble = false;

  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48; // '0' === 48
    if (d < 0 || d > 9) return false;
    if (shouldDouble) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    shouldDouble = !shouldDouble;
  }
  return sum % 10 === 0;
}

/**
 * Best-effort card brand detection from the PAN's BIN (first 1-2 digits).
 * Returns UNKNOWN when the BIN doesn't match a known issuer — callers can
 * still store the card, it just won't appear under a specific brand.
 */
export function detectBrand(
  pan: string
): 'VISA' | 'MASTERCARD' | 'AMEX' | 'UNKNOWN' {
  if (/^4\d{6,}$/.test(pan)) return 'VISA';
  if (/^(5[1-5]|2[2-7])\d{4,}$/.test(pan)) return 'MASTERCARD';
  if (/^3[47]\d{5,}$/.test(pan)) return 'AMEX';
  return 'UNKNOWN';
}

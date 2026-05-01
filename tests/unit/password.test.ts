import { hashPassword, comparePassword, validatePasswordStrength } from '../../src/utils/password';

// Override bcrypt rounds for faster tests
process.env['BCRYPT_SALT_ROUNDS'] = '4';

describe('password utilities', () => {
  describe('hashPassword / comparePassword', () => {
    it('hashes and verifies a password correctly', async () => {
      const password = 'TestPassword@123';
      const hash = await hashPassword(password);

      expect(hash).not.toBe(password);
      expect(hash).toMatch(/^\$2[aby]\$/);

      const valid = await comparePassword(password, hash);
      expect(valid).toBe(true);
    });

    it('returns false for wrong password', async () => {
      const hash = await hashPassword('CorrectHorse@99');
      const valid = await comparePassword('WrongHorse@99', hash);
      expect(valid).toBe(false);
    });
  });

  describe('validatePasswordStrength', () => {
    it('accepts a strong password', () => {
      expect(validatePasswordStrength('StrongPass1')).toEqual({ valid: true });
    });

    it('rejects passwords shorter than 8 chars', () => {
      const result = validatePasswordStrength('Ab1');
      expect(result.valid).toBe(false);
      expect(result.message).toContain('8 characters');
    });

    it('rejects passwords without uppercase', () => {
      const result = validatePasswordStrength('lowercase1');
      expect(result.valid).toBe(false);
      expect(result.message).toContain('uppercase');
    });

    it('rejects passwords without lowercase', () => {
      const result = validatePasswordStrength('UPPERCASE1');
      expect(result.valid).toBe(false);
      expect(result.message).toContain('lowercase');
    });

    it('rejects passwords without numbers', () => {
      const result = validatePasswordStrength('NoNumbers');
      expect(result.valid).toBe(false);
      expect(result.message).toContain('number');
    });
  });
});

import { describe, expect, it } from 'vitest';
import {
  LoginRequestSchema,
  PublicUserSchema,
  RegisterRequestSchema,
  TokenResponseSchema,
} from '@/auth/schemas/auth.schemas.js';

describe('auth schemas', () => {
  describe('RegisterRequestSchema', () => {
    it('accepts a valid registration payload', () => {
      const r = RegisterRequestSchema.parse({
        email: 'Foo@Example.COM',
        name: 'Alice',
        password: 'Secret123',
      });
      // Email gets lowercased on parse
      expect(r.email).toBe('foo@example.com');
      expect(r.name).toBe('Alice');
    });

    it('rejects a weak password (no uppercase)', () => {
      expect(() =>
        RegisterRequestSchema.parse({
          email: 'a@b.com',
          name: 'Alice',
          password: 'secret123',
        })
      ).toThrow(/uppercase/);
    });

    it('rejects a weak password (too short)', () => {
      expect(() =>
        RegisterRequestSchema.parse({
          email: 'a@b.com',
          name: 'Alice',
          password: 'S1a',
        })
      ).toThrow(/at least 8/);
    });

    it('rejects a too-short name', () => {
      expect(() =>
        RegisterRequestSchema.parse({
          email: 'a@b.com',
          name: 'A',
          password: 'Secret123',
        })
      ).toThrow();
    });
  });

  describe('LoginRequestSchema', () => {
    it('accepts any non-empty password (weak check — bcrypt handles strength)', () => {
      const r = LoginRequestSchema.parse({
        email: 'a@b.com',
        password: 'whatever',
      });
      expect(r.password).toBe('whatever');
    });

    it('rejects empty password', () => {
      expect(() =>
        LoginRequestSchema.parse({ email: 'a@b.com', password: '' })
      ).toThrow();
    });
  });

  describe('PublicUserSchema', () => {
    it('accepts a well-formed user', () => {
      const r = PublicUserSchema.parse({
        id: 'cms93f0xb0000wofz8qlw3egv',
        email: 'a@b.com',
        name: 'Alice',
        role: 'USER',
        createdAt: '2026-07-31T12:34:56.000Z',
      });
      expect(r.role).toBe('USER');
    });

    it('rejects an invalid role', () => {
      expect(() =>
        PublicUserSchema.parse({
          id: 'cms93f0xb0000wofz8qlw3egv',
          email: 'a@b.com',
          name: 'Alice',
          role: 'SUPERUSER',
          createdAt: '2026-07-31T12:34:56.000Z',
        })
      ).toThrow();
    });
  });

  describe('TokenResponseSchema', () => {
    it('accepts a complete token envelope', () => {
      const r = TokenResponseSchema.parse({
        user: {
          id: 'cms93f0xb0000wofz8qlw3egv',
          email: 'a@b.com',
          name: 'Alice',
          role: 'USER',
          createdAt: '2026-07-31T12:34:56.000Z',
        },
        accessToken: 'eyJ...',
        refreshToken: 'rt-...',
        accessTokenExpiresIn: '15m',
        refreshTokenExpiresIn: '7d',
      });
      expect(r.accessToken).toBe('eyJ...');
    });
  });
});

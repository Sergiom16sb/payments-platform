import type { PrismaClient, User } from '@prisma/client';
import { getPrisma } from '../config/database.js';
import { ConflictException, NotFoundException } from '../exceptions/index.js';

/**
 * Users repository. Wraps Prisma calls so services don't reach into the
 * ORM directly, and translates Prisma errors into our HTTPException
 * hierarchy (handled by the global error handler in app.ts).
 *
 * Notes:
 *  - findByEmail / findById return null on miss; callers decide how to
 *    react (login throws Unauthorized, /me handler throws NotFound).
 *  - create() translates Prisma P2002 (unique violation on email) into
 *    a ConflictException so the error envelope stays consistent.
 *  - bcrypt hashing is the caller's responsibility — this repo only
 *    stores and retrieves.
 */
export class UsersRepository {
  private readonly prisma: PrismaClient;

  constructor(prisma?: PrismaClient) {
    this.prisma = prisma ?? getPrisma();
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { email } });
  }

  async findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id } });
  }

  /**
   * Creates a new user. `password` MUST already be hashed with bcrypt.
   * Email uniqueness is enforced at the DB level (Prisma schema) — the
   * P2002 error is mapped to ConflictException with code EMAIL_TAKEN so
   * the global error handler renders the standard envelope.
   */
  async create(input: {
    email: string;
    name: string;
    password: string;
    role?: 'USER' | 'ADMIN';
  }): Promise<User> {
    try {
      return await this.prisma.user.create({
        data: {
          email: input.email,
          name: input.name,
          password: input.password,
          role: input.role ?? 'USER',
        },
      });
    } catch (err: unknown) {
      if (
        typeof err === 'object' &&
        err !== null &&
        'code' in err &&
        (err as { code?: string }).code === 'P2002'
      ) {
        throw new ConflictException(
          'Email is already registered',
          'EMAIL_TAKEN',
          { email: input.email }
        );
      }
      throw err;
    }
  }

  /**
   * Updates mutable fields. Used by PATCH /api/users/:id.
   */
  async update(
    id: string,
    input: Partial<{ name: string; password: string }>
  ): Promise<User> {
    try {
      return await this.prisma.user.update({
        where: { id },
        data: input,
      });
    } catch (err: unknown) {
      if (
        typeof err === 'object' &&
        err !== null &&
        'code' in err &&
        (err as { code?: string }).code === 'P2025'
      ) {
        throw new NotFoundException(`User ${id} not found`, 'USER_NOT_FOUND');
      }
      throw err;
    }
  }
}

/**
 * Convenience: lazily build the default repository wired to the singleton
 * Prisma client. Tests can construct their own with `new UsersRepository(prisma)`.
 */
let _default: UsersRepository | undefined;
export function getUsersRepository(): UsersRepository {
  if (_default) return _default;
  _default = new UsersRepository();
  return _default;
}

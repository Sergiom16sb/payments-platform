/**
 * Seed script — populates the database with a baseline set of users so the
 * API has something to authenticate against on first run.
 *
 * Run via:  bun run db:seed
 * Idempotent: re-running won't duplicate users (uses email as natural key).
 *
 * Cards and payments are intentionally NOT seeded here — they depend on
 * business logic (Luhn validation, tokenization, processor call) that lands
 * in later PRs.
 */

import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

const BCRYPT_ROUNDS = Number(process.env.BCRYPT_ROUNDS ?? 10);

interface SeedUser {
  email: string;
  name: string;
  password: string;
  role: 'USER' | 'ADMIN';
}

const USERS: readonly SeedUser[] = [
  {
    email: 'admin@payments.local',
    name: 'Admin',
    password: 'Admin1234',
    role: 'ADMIN',
  },
  {
    email: 'demo@payments.local',
    name: 'Demo User',
    password: 'Demo1234',
    role: 'USER',
  },
];

async function main(): Promise<void> {
  console.log(
    `Seeding ${USERS.length} users (bcrypt rounds=${BCRYPT_ROUNDS})...`
  );

  for (const u of USERS) {
    const password = await bcrypt.hash(u.password, BCRYPT_ROUNDS);
    const user = await prisma.user.upsert({
      where: { email: u.email },
      update: { name: u.name, role: u.role },
      create: {
        email: u.email,
        name: u.name,
        password,
        role: u.role,
      },
    });
    console.log(`  - ${user.email} [${user.role}] (id=${user.id})`);
  }

  console.log('Seed complete.');
}

main()
  .catch((err: unknown) => {
    console.error('Seed failed:', err);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });

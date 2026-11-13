#!/usr/bin/env node
// Creates an account on a private instance (the only way to add users when public registration is closed).
//   printf '%s' "$PASSWORD" | npm run user:create -- you@example.com "Your Name" --stdin
// The password is read from stdin only (never from argv, so it stays out of shell history and `ps`).
// Refuses to overwrite an existing account. Needs DATABASE_URL (same as the API).
const path = require('node:path');
const { createRequire } = require('node:module');
const req = createRequire(path.join(__dirname, '..', 'package.json'));
const bcrypt = req('bcryptjs');
const { PrismaClient } = req('@prisma/client');

const args = process.argv.slice(2);
const fromStdin = args.includes('--stdin');
const [email, name] = args.filter((a) => a !== '--stdin');

async function readPassword() {
  if (!fromStdin) throw new Error('Pass --stdin and pipe the password (it is never accepted as an argument).');
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8').replace(/\r?\n$/, '');
}

(async () => {
  if (!email || !name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    console.error('usage: printf %s "$PASSWORD" | npm run user:create -- <email> <name> --stdin');
    process.exit(2);
  }
  const password = await readPassword();
  if (password.length < 12) { console.error('Password must be at least 12 characters.'); process.exit(2); }
  const prisma = new PrismaClient();
  try {
    if (await prisma.user.findUnique({ where: { email } })) {
      console.error('An account with this email already exists; nothing changed.');
      process.exit(1);
    }
    const user = await prisma.user.create({
      data: { email, name, passwordHash: await bcrypt.hash(password, 12) },
      select: { id: true, email: true },
    });
    console.log(`created ${user.email} (${user.id})`);
  } finally {
    await prisma.$disconnect();
  }
})().catch((e) => { console.error(e.message); process.exit(1); });

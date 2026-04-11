# Prisma Migrations

This directory contains versioned database migrations managed by Prisma Migrate.

## Workflow

### Local Development
```bash
# Quick schema sync (no migration file — for rapid iteration only)
npx prisma db push

# Create a migration file from schema changes
npx prisma migrate dev --name describe_your_change
```

### Staging & Production
```bash
# Apply pending migrations
npx prisma migrate deploy
```

### Reset (local only)
```bash
npx prisma migrate reset
```

## Rules

1. **Never use `prisma db push` in staging or production** — it can cause data loss.
2. Every schema change must produce a migration file committed to version control.
3. Migration files must never be edited after they have been applied to any environment.
4. Destructive changes (dropping columns, renaming tables) require a two-step migration:
   - Step 1: Add the new structure, deploy.
   - Step 2: Remove the old structure in a subsequent release.
5. All migrations run inside a transaction by default.

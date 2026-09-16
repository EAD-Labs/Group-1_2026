#!/usr/bin/env sh
# Start command on Render. The free plan has no pre-deploy step, so the
# database is brought up to date here, before the server starts. Every step
# is safe to repeat on each boot.
set -e

node scripts/migrate.js

# Test accounts (password123) and the client's questions, only when asked for.
# Leave SEED_DEMO_DATA unset on anything real.
if [ "$SEED_DEMO_DATA" = "true" ]; then
  node scripts/seed.js
  node scripts/import-questions.js content/python-mcqs.json
fi

exec node src/server.js

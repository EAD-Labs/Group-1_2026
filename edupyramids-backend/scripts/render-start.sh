#!/usr/bin/env sh
# Start command on Render. The free plan has no pre-deploy step, so the
# database is brought up to date here, before the server starts. Every step
# is safe to repeat on each boot.
set -e

node scripts/migrate.js

# The client's questions and the games. Content already loaded is left alone,
# so this only adds what is new.
node scripts/import-questions.js content/python-mcqs.json --quiet
node scripts/import-games.js content/python-games.json --quiet

# Test accounts (password123), only when asked for.
# Leave SEED_DEMO_DATA unset on anything real.
if [ "$SEED_DEMO_DATA" = "true" ]; then
  node scripts/seed.js
fi

exec node src/server.js

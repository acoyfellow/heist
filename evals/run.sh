#!/usr/bin/env bash
set -euo pipefail
CF_API_TOKEN="$(npx wrangler auth token 2>/dev/null | tail -1)" CLOUDFLARE_ACCOUNT_ID=bfcb6ac5b3ceaf42a09607f6f7925823 bun evals/balance.ts

#!/usr/bin/env bash
# Deploys the AI command agent: migration → secrets → edge function → smoke test.
#
# Nothing here runs against the hosted project unless you pass --run. Without
# it the script only checks prerequisites and prints the exact commands it
# would execute, so you can read them first.
#
# Prerequisites (all yours to provide; the script never invents them):
#   supabase login                       — once per machine (opens a browser)
#   export ANTHROPIC_API_KEY=sk-ant-…     — or MISTRAL_API_KEY if AI_AGENT_PROVIDER=mistral
#   export AI_AGENT_CONFIRM_SECRET=$(openssl rand -hex 32)
#
# Optional:
#   AI_AGENT_PROVIDER  anthropic (default) | mistral
#   AI_AGENT_MODEL     default claude-sonnet-5
#
# Usage:
#   scripts/deploy-ai-agent.sh            # dry run: check + print
#   scripts/deploy-ai-agent.sh --run      # actually deploy
#   scripts/deploy-ai-agent.sh --run --skip-migration
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

RUN=0
SKIP_MIGRATION=0
for arg in "$@"; do
  case "$arg" in
    --run) RUN=1 ;;
    --skip-migration) SKIP_MIGRATION=1 ;;
    -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
    *) echo "unknown flag: $arg" >&2; exit 2 ;;
  esac
done

PROVIDER="${AI_AGENT_PROVIDER:-anthropic}"
MODEL="${AI_AGENT_MODEL:-claude-sonnet-5}"
PROJECT_REF="$(sed -nE 's/^project_id *= *"([^"]+)"/\1/p' supabase/config.toml)"
FUNCTION="ai-agent"

say()  { printf '\n\033[1m%s\033[0m\n' "$*"; }
ok()   { printf '  ✔ %s\n' "$*"; }
warn() { printf '  ! %s\n' "$*"; }
fail() { printf '  ✘ %s\n' "$*" >&2; exit 1; }

# Print a command, and run it only in --run mode.
do_cmd() {
  printf '  $ %s\n' "$*"
  if [ "$RUN" = 1 ]; then "$@"; fi
}

say "Prerequisites"
command -v supabase >/dev/null || fail "supabase CLI not on PATH (installed to ~/.local/bin/supabase — open a new shell or add it to PATH)"
ok "supabase CLI $(supabase --version)"
[ -n "$PROJECT_REF" ] || fail "no project_id in supabase/config.toml"
ok "project ref $PROJECT_REF"
[ -d "supabase/functions/$FUNCTION" ] || fail "supabase/functions/$FUNCTION does not exist yet — the backend build has not landed"
ok "function source present"

if supabase projects list >/dev/null 2>&1; then
  ok "logged in"
else
  fail "not logged in — run: supabase login"
fi

case "$PROVIDER" in
  anthropic) KEY_NAME=ANTHROPIC_API_KEY ;;
  mistral)   KEY_NAME=MISTRAL_API_KEY ;;
  *) fail "AI_AGENT_PROVIDER must be anthropic or mistral (got $PROVIDER)" ;;
esac
[ -n "${!KEY_NAME:-}" ] || fail "$KEY_NAME is not set in your environment"
ok "$KEY_NAME present"
[ -n "${AI_AGENT_CONFIRM_SECRET:-}" ] || fail "AI_AGENT_CONFIRM_SECRET is not set — generate one: export AI_AGENT_CONFIRM_SECRET=\$(openssl rand -hex 32)"
ok "AI_AGENT_CONFIRM_SECRET present"

# The agent's migration is whichever timestamped file mentions ai_sessions.
MIGRATION="$(grep -lE 'ai_sessions' supabase/migrations/*.sql 2>/dev/null | sort | tail -1 || true)"

say "Plan ($( [ "$RUN" = 1 ] && echo 'RUNNING' || echo 'dry run — add --run to execute'))"

do_cmd supabase link --project-ref "$PROJECT_REF"

if [ "$SKIP_MIGRATION" = 1 ]; then
  warn "skipping migration (--skip-migration)"
elif [ -z "$MIGRATION" ]; then
  warn "no migration mentioning ai_sessions under supabase/migrations/ — skipping db push"
else
  ok "migration: $MIGRATION"
  do_cmd supabase db push --linked
fi

# Secrets are passed on the command line so they never touch a file in the repo.
do_cmd supabase secrets set \
  "AI_AGENT_PROVIDER=$PROVIDER" \
  "AI_AGENT_MODEL=$MODEL" \
  "$KEY_NAME=${!KEY_NAME}" \
  "AI_AGENT_CONFIRM_SECRET=$AI_AGENT_CONFIRM_SECRET"

# verify_jwt is set per-function in supabase/config.toml ([functions.ai-agent]);
# the function checks the caller's JWT itself so the CORS preflight passes.
do_cmd supabase functions deploy "$FUNCTION" --project-ref "$PROJECT_REF"

say "Smoke test"
URL="https://$PROJECT_REF.supabase.co/functions/v1/$FUNCTION"
if [ "$RUN" = 1 ]; then
  # An unauthenticated call must be rejected by the function, not by a 404.
  CODE="$(curl -s -o /dev/null -w '%{http_code}' -X POST "$URL" -H 'content-type: application/json' -d '{}')"
  case "$CODE" in
    401|403) ok "$URL is live and refuses anonymous calls ($CODE)" ;;
    404) fail "$URL returned 404 — deploy did not land" ;;
    *) warn "$URL answered $CODE to an anonymous POST — expected 401/403, check the function's auth guard" ;;
  esac
else
  printf '  $ curl -X POST %s   # expect 401/403\n' "$URL"
fi

say "Done. ai-search is untouched; delete it only after the client switch is verified:"
printf '  $ supabase functions delete ai-search --project-ref %s\n' "$PROJECT_REF"

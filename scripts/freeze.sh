#!/usr/bin/env bash
# Event freeze (OPS-04 B): during a live event, nothing may deploy and end the show.
#
#   scripts/freeze.sh on      block merges and pushes to main (a GitHub ruleset) + Render auto-deploy off
#   scripts/freeze.sh off     remove the ruleset + Render auto-deploy back on
#   scripts/freeze.sh status  show both
#
# GitHub: needs the `gh` CLI signed in with admin rights on the repo (the ruleset has no bypass actors,
# so even admins can't merge until it's switched off).
# Render: with RENDER_API_KEY and RENDER_SERVICE_ID set, auto-deploy is switched through Render's API;
# without them the script prints the dashboard steps (Settings → Build & Deploy → Auto-Deploy).
# An urgent fix during the window is a deliberate manual deploy: freeze off, merge, deploy, freeze on.
set -euo pipefail

RULESET_NAME="Event freeze (DAS-O-Ween)"
REPO="${FREEZE_REPO:-$(gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null || echo GrayGrayson1/dascade)}"
cmd="${1:-status}"

ruleset_id() {
  gh api "repos/$REPO/rulesets" --jq ".[] | select(.name == \"$RULESET_NAME\") | .id" 2>/dev/null | head -n1
}

render_autodeploy() {
  local value="$1" # yes | no
  if [[ -z "${RENDER_API_KEY:-}" || -z "${RENDER_SERVICE_ID:-}" ]]; then
    echo "Render: set auto-deploy to '$value' by hand — dashboard → dascade → Settings → Build & Deploy → Auto-Deploy."
    echo "        (or export RENDER_API_KEY and RENDER_SERVICE_ID and run this again)"
    return 0
  fi
  local code
  code=$(curl -sS -o /dev/null -w '%{http_code}' -X PATCH "https://api.render.com/v1/services/$RENDER_SERVICE_ID" \
    -H "Authorization: Bearer $RENDER_API_KEY" -H 'Content-Type: application/json' -d "{\"autoDeploy\":\"$value\"}")
  if [[ "$code" == 2* ]]; then echo "Render: auto-deploy is now '$value'."; else echo "Render: the API answered HTTP $code — check the dashboard." >&2; return 1; fi
}

render_status() {
  if [[ -z "${RENDER_API_KEY:-}" || -z "${RENDER_SERVICE_ID:-}" ]]; then
    echo "Render: check by hand (dashboard → Settings → Build & Deploy → Auto-Deploy should say 'No' during the event)."
    return 0
  fi
  curl -sS "https://api.render.com/v1/services/$RENDER_SERVICE_ID" -H "Authorization: Bearer $RENDER_API_KEY" |
    sed -n 's/.*"autoDeploy":"\([a-z]*\)".*/Render: auto-deploy is \1./p'
}

case "$cmd" in
  on)
    if [[ -n "$(ruleset_id)" ]]; then
      echo "GitHub: the freeze ruleset is already on for $REPO."
    else
      gh api -X POST "repos/$REPO/rulesets" --input - >/dev/null <<JSON
{
  "name": "$RULESET_NAME",
  "target": "branch",
  "enforcement": "active",
  "bypass_actors": [],
  "conditions": { "ref_name": { "include": ["~DEFAULT_BRANCH"], "exclude": [] } },
  "rules": [{ "type": "update" }, { "type": "deletion" }, { "type": "non_fast_forward" }]
}
JSON
      echo "GitHub: main is frozen for $REPO (no merges or pushes until 'scripts/freeze.sh off')."
    fi
    render_autodeploy no
    ;;
  off)
    id="$(ruleset_id)"
    if [[ -z "$id" ]]; then
      echo "GitHub: no freeze ruleset on $REPO."
    else
      if gh api -X DELETE "repos/$REPO/rulesets/$id" >/dev/null; then
        echo "GitHub: the freeze is off for $REPO."
      else
        echo "GitHub: couldn't remove the ruleset — remove '$RULESET_NAME' by hand (Settings → Rules)." >&2
      fi
    fi
    render_autodeploy yes
    ;;
  status)
    if [[ -n "$(ruleset_id)" ]]; then echo "GitHub: FROZEN — '$RULESET_NAME' is active on $REPO."; else echo "GitHub: not frozen ($REPO)."; fi
    render_status
    ;;
  *)
    echo "usage: scripts/freeze.sh on|off|status" >&2
    exit 2
    ;;
esac

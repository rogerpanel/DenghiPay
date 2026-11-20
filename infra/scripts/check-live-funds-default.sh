#!/usr/bin/env bash
# Guardrail G1, enforced in CI.
#
# LIVE_FUNDS_ENABLED defaults to false. This script fails the build if anything
# in the repository sets it to true, or defaults it to true in code.
set -euo pipefail

fail=0

echo "→ checking committed environment templates"
if grep -rn --include='*.example' --include='*.yml' --include='*.yaml' --include='*.env' \
    -E 'LIVE_FUNDS_ENABLED\s*[:=]\s*["'"'"']?(true|1|yes)' . \
    --exclude-dir=node_modules --exclude-dir=.git 2>/dev/null; then
  echo "FAIL: LIVE_FUNDS_ENABLED is enabled in a committed file."
  fail=1
fi

echo "→ checking source defaults"
if grep -rn --include='*.ts' --include='*.tsx' \
    -E "LIVE_FUNDS_ENABLED[^\n]{0,60}(\|\|\s*true|\?\?\s*true|,\s*true\s*\))" . \
    --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.next --exclude-dir=.git 2>/dev/null; then
  echo "FAIL: a source file defaults LIVE_FUNDS_ENABLED to true."
  fail=1
fi

echo "→ checking for screening bypass flags (G3)"
if grep -rn --include='*.ts' --include='*.tsx' \
    -E '(skipScreening|bypassScreening|SKIP_SCREENING|DISABLE_SCREENING|screening.*=\s*false\s*//\s*dev)' . \
    --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.next --exclude-dir=.git \
    --exclude='check-live-funds-default.sh' 2>/dev/null; then
  echo "FAIL: a screening bypass appears in the source. Guardrail G3 forbids this."
  fail=1
fi

if [ "$fail" -eq 0 ]; then
  echo "OK: G1 and G3 guardrails intact."
fi
exit "$fail"

#!/bin/sh
# Fixes applied to the eipay source at image build time, on top of the
# developers' unmodified checkout. Run by infra/docker/eipay.Dockerfile from the
# checkout root. Each fix is also reported to the developers so it can land in
# their repository; once it has, the original text is gone and the fix here
# reports "already fixed" and does nothing.
#
# Each fix replaces one exact line and then checks the result, so a change
# upstream can never be half-patched silently. POSIX sh: the build image is
# Alpine (busybox).
set -eu

fixed=0
already=0

# replace FILE ORIGINAL REPLACEMENT DESCRIPTION
replace() {
  file="$1"; original="$2"; replacement="$3"; what="$4"
  if grep -qxF "$replacement" "$file"; then
    echo "eipay patch: already fixed — $what"
    already=$((already + 1))
  elif grep -qxF "$original" "$file"; then
    # Exact-line replacement without regular expressions: awk compares strings.
    awk -v o="$original" -v r="$replacement" '{ if ($0 == o) print r; else print }' "$file" > "$file.patched"
    mv "$file.patched" "$file"
    grep -qxF "$replacement" "$file" || { echo "eipay patch: FAILED to apply — $what" >&2; exit 1; }
    echo "eipay patch: applied — $what"
    fixed=$((fixed + 1))
  else
    # The surrounding code changed upstream. Fail rather than guess: someone
    # has to look at whether the problem still exists.
    echo "eipay patch: $file no longer has the line this fix expects — review it — $what" >&2
    exit 1
  fi
}

# 1. A new user's first transfer ran out of gas (docs/EIPAY_INTEGRATION.md
#    §1.2). The combined EIP-7702 delegation + execute transaction was capped
#    at 120,000 gas, which the authorization and signature check nearly use
#    up; the batch then reverts. Give it the 500,000 the execute-only path
#    already uses. Only gas used is paid; the limit is a ceiling.
replace app/lib/bundler/executeSponsored.ts \
  'const RE_DELEGATE_GAS = BigInt(120000);' \
  'const RE_DELEGATE_GAS = BigInt(500000);' \
  'first-transfer gas limit 120,000 → 500,000 (Polygon tx 0xdcc6a165…a521bffe, 24 Nov)'

echo "eipay patches: ${fixed} applied, ${already} already fixed upstream"

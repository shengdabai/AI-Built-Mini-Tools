#!/usr/bin/env bash
# Run the Node unit tests of every tool. Browser checks (shots.cjs and tests
# that need Playwright) are skipped here; run them per tool.
set -u
cd "$(dirname "$0")/../tools" || exit 1
fail=0
for t in */tests; do
  files=$(ls "$t" | grep -E '\.test\.(c|m)?js$' | grep -v 'storage-recovery' | sed "s#^#tests/#")
  [ -z "$files" ] && continue
  tool=${t%/tests}
  if (cd "$tool" && node --test $files >/dev/null 2>&1); then
    echo "PASS $tool"
  else
    echo "FAIL $tool"; fail=1
  fi
done
exit $fail

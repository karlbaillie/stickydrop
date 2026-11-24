# Dev tasks. Run `just` to list them. Same recipes run locally and in GitHub Actions.
set windows-shell := ["bash", "-cu"]   # Git Bash (preinstalled on GitHub's Windows runners)

default:
    @just --list

# Install exact locked dependencies (what CI uses)
install:
    npm ci

# Run the app from source
start:
    npm start

# Unit tests only (no display needed)
unit:
    node test/time.test.js
    node test/export.test.js
    node test/sync.test.js

# Unit + end-to-end tests. Quit a running StickyDrop first (the suite needs F9 free).
# On headless Linux (CI) it runs under a virtual display.
test: unit
    #!/usr/bin/env bash
    set -euo pipefail
    if [[ "$(uname)" == Linux && -z "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ]]; then
        xvfb-run -a node test/e2e.js
    else
        node test/e2e.js
    fi

# Regenerate docs/*.png
screenshots:
    #!/usr/bin/env bash
    set -euo pipefail
    if [[ "$(uname)" == Linux && -z "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ]]; then
        xvfb-run -a node scripts/screenshots.js
    else
        node scripts/screenshots.js
    fi

# Build installers for this OS into dist/ (unsigned, never published)
dist:
    #!/usr/bin/env bash
    set -euo pipefail
    npx electron-builder --publish never
    # macOS: an unsigned arm64 app is reported as "damaged" after download, so prove the bundle carries a valid (ad-hoc) signature
    if [[ "$(uname)" == Darwin ]]; then
        for app in dist/mac*/StickyDrop.app; do codesign --verify --deep --strict --verbose=2 "$app"; done
    fi

# What CI runs on every push: clean install, tests, installer build
ci: install test dist

# Remove build output (node_modules stays)
clean:
    rm -rf dist

# Cut a release: just release 0.2.0  (bumps version, commits, tags, pushes; the tag triggers the release workflow)
release version:
    git diff --quiet && git diff --cached --quiet || { echo "commit or stash changes first"; exit 1; }
    npm version {{version}} -m "Release v%s"
    git push --follow-tags

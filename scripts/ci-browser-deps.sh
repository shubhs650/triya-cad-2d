#!/usr/bin/env bash
# Installs Chromium's system packages for the Playwright jobs (DEC-075 follow-up).
#
# The runner image already has Chromium's libraries; `playwright install-deps chromium` only adds
# Playwright's extra fonts (about 22 MB of .deb files). From an Ubuntu mirror that was 10 s on most
# runners but 4 min 22 s on one (run 44351148859, 2026-11-18), on the critical path. So the .deb
# files are kept in PW_APT_DIR, which the workflow caches per runner image and Playwright version
# (saved from `main`'s perf job, which every PR can restore): with them, dpkg installs offline.
#
# Without a cache (or if dpkg refuses it) apt installs them, with up to three attempts; apt resumes
# a partial download. If apt cannot install them at all (the archive did not resolve from
# 2026-11-11), the job goes on when no library Chromium links is missing and fails otherwise.
set -uo pipefail
# The workflow caches ~/.cache/pw-apt (actions/cache step `apt-cache` before this one).
dir="${PW_APT_DIR:-$HOME/.cache/pw-apt}"

if compgen -G "$dir/*.deb" >/dev/null; then
  if sudo dpkg -i "$dir"/*.deb >/dev/null; then
    echo "Installed $(ls "$dir"/*.deb | wc -l) cached packages"
    exit 0
  fi
  echo "::warning::the cached browser packages did not install; using apt"
fi

# Keep what apt downloads, so the cache can be saved from it.
echo 'Binary::apt-get::APT::Keep-Downloaded-Packages "true"; APT::Keep-Downloaded-Packages "true";' |
  sudo tee /etc/apt/apt.conf.d/99-keep-debs >/dev/null
sudo rm -f /etc/apt/apt.conf.d/docker-clean

for attempt in 1 2 3; do
  if pnpm exec playwright install-deps chromium; then
    mkdir -p "$dir"
    find /var/cache/apt/archives -maxdepth 1 -name '*.deb' -exec cp {} "$dir"/ \;
    echo "Kept $(find "$dir" -name '*.deb' | wc -l) packages for the cache"
    exit 0
  fi
  echo "::warning::playwright install-deps failed (attempt $attempt)"
  sleep $((attempt * 10))
done

echo "::warning::playwright install-deps failed; checking Chromium's libraries instead"
missing="$(find ~/.cache/ms-playwright -type f \( -name chrome -o -name chrome-headless-shell \) \
  -exec ldd {} \; | grep 'not found' || true)"
if [ -n "$missing" ]; then
  echo "$missing"
  exit 1
fi

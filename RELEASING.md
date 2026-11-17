# Releasing

## GitHub release (binaries)
`just release 0.2.0` bumps the version, commits, tags `v0.2.0` and pushes. The tag triggers
`.github/workflows/release.yml`: tests, builds Linux (`.deb`, `.AppImage`, `.snap`), macOS (`.dmg`) and Windows
(`.exe`), and attaches them to a new GitHub Release.

## Snap Store (Ubuntu Software)
One-time setup, needs a free Ubuntu One account:
1. `sudo snap install snapcraft --classic`, then `snapcraft login` and `snapcraft register stickydrop`
   (the name must be free; pick another and change `name` in `package.json` if not).
2. `snapcraft export-login --snaps stickydrop --acls package_access,package_push,package_release -` and save the
   output as a repository secret named `SNAPCRAFT_STORE_CREDENTIALS`.
3. From then on every release tag uploads the snap to the `stable` channel. Fill in the store listing
   (description, screenshots from `docs/`, categories) at https://snapcraft.io/stickydrop/listing.

Strict confinement caveats, untested: "Launch at login" writes `~/.config/autostart`, which a strict snap cannot do,
and tray/global-shortcut behaviour inside the sandbox is unverified. Test the snap (`sudo snap install --dangerous
dist/*.snap`) before the first upload; if it misbehaves, ship `.deb`/AppImage only and drop `snap` from the targets.

## Signing
Builds are unsigned: macOS needs right-click → Open the first time, Windows SmartScreen shows "More info → Run anyway".
Signing needs an Apple Developer account / a Windows code-signing certificate.

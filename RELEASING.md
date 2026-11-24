# Releasing

## GitHub release (binaries)
`just release 0.2.0` bumps the version, commits, tags `v0.2.0` and pushes. The tag triggers
`.github/workflows/release.yml`: tests, builds Linux (`.deb`, `.AppImage`, `.snap`), macOS (`.dmg`) and Windows
(`.exe`), and attaches them to a new GitHub Release. A version with a suffix (`just release 0.2.0-beta.1`) is published
as a pre-release, so it never shows as "Latest".

## Updates
Every release also carries the update manifests (`latest.yml`, `latest-mac.yml`, `latest-linux.yml`) and `.blockmap`
files; installed copies read them from the GitHub release (`publish` in `package.json`), so the repository must be
public for update checks to work. Windows and the AppImage install updates themselves. macOS only announces them with
a download link, because an ad-hoc-signed app can't replace itself (that needs a Developer ID, see Signing); the same
goes for `.deb`. Asset names must not contain spaces (GitHub renames them, breaking the manifest's links), hence the
Windows `artifactName`.

## Snap Store (Ubuntu Software)
One-time setup, needs a free Ubuntu One account:
1. `sudo snap install snapcraft --classic`, then `snapcraft login` and `snapcraft register stickydrop`
   (the name must be free; pick another and change `name` in `package.json` if not).
2. `snapcraft export-login --snaps stickydrop --acls package_access,package_push,package_release -` and save the
   output as a repository secret named `SNAPCRAFT_STORE_CREDENTIALS`.
3. From then on every release tag uploads the snap: to `stable`, or to `edge` for a pre-release (`-alpha`, `-beta`...). Fill in the store listing
   (description, screenshots from `docs/`, categories) at https://snapcraft.io/stickydrop/listing.

Strict confinement caveats, untested: "Launch at login" writes `~/.config/autostart`, which a strict snap cannot do,
and tray/global-shortcut behaviour inside the sandbox is unverified. Test the snap (`sudo snap install --dangerous
dist/*.snap`) before the first upload; if it misbehaves, ship `.deb`/AppImage only and drop `snap` from the targets.

## Signing
The macOS app is ad-hoc signed (`mac.identity: "-"`; `just dist` verifies it with `codesign`). Without that, an arm64 app
downloaded from the internet is reported as "damaged and can't be opened". Ad-hoc is not notarised, so macOS still blocks the
first launch: System Settings → Privacy & Security → "Open Anyway", or `xattr -dr com.apple.quarantine StickyDrop.app`.
Windows SmartScreen shows "More info → Run anyway". Removing these prompts needs an Apple Developer ID plus notarisation
and a Windows code-signing certificate.
Signing needs an Apple Developer account / a Windows code-signing certificate.

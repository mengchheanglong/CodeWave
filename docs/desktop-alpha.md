# CodeWave desktop alpha

The desktop alpha packages the existing CodeWave web shell and daemon as one local Electron application. It does not introduce a second runtime contract: the renderer still talks only to the daemon API, and the daemon remains the authoritative owner of sessions, runs, approvals, worktrees, and SQLite state.

## Runtime boundary

1. Electron's main process creates a 32-byte per-launch bootstrap secret.
2. A supervised `utilityProcess` launches the bundled daemon on `127.0.0.1:0` with separate workspace and data directories.
3. The renderer loads from the privileged `codewave://app/` origin. Relative `/api` requests are intercepted in the main process and proxied to the current daemon address.
4. The main process injects the bootstrap header after applying request and response header allowlists. The renderer never receives the daemon port or secret.
5. The preload exposes only daemon status and a native directory picker. No Node, filesystem, shell, or arbitrary IPC surface is available to renderer code.

The bootstrap secret protects the private loopback endpoint from accidental cross-process use, but it is not an OS-user security boundary. A hostile process running as the same user can inspect or manipulate other local processes. CodeWave must not describe the desktop lease as authentication against the local user.

## Lifecycle and recovery

- The daemon reports its actual random port only after listening.
- A rolling restart budget permits three unexpected daemon exits in 60 seconds, with bounded backoff. A fourth exit fails visibly instead of looping forever.
- The shell receives launch, restart, stop, and failure status through typed IPC and shows a compact recovery banner outside the normal ready state.
- Closing CodeWave asks the daemon to stop, cancels active providers and pending approvals, closes SSE and HTTP sockets, checkpoints the WAL, and closes SQLite. Shutdown is idempotent and bounded; the supervisor escalates only after the graceful window expires.
- Daemon logs rotate at 2 MiB between `daemon.log` and `daemon.previous.log`. Electron crash reports stay local; upload is disabled.

## Local data

Electron's platform user-data directory contains:

- `daemon-data/state.sqlite` and its SQLite sidecars
- `logs/daemon.log` and the previous rotated log
- `demo-workspace-v1/`, a deterministic first-run Git repository
- local Chromium/Electron profile data and crash reports

The demo initializer is non-destructive. It creates missing seed files, initializes an isolated clean `main` branch, disables inherited hooks/signing/global Git configuration for the seed commit, and never overwrites a user's edits. Passing `--workspace <directory>` selects an existing canonical directory instead.

## Security posture

- context isolation, renderer sandboxing, web security, and an explicit CSP are mandatory
- Node integration, webviews, downloads, certificate exceptions, popup navigation, and unneeded permissions are denied
- only the trusted `codewave://app/` top-level renderer may request local notifications
- asset traversal and lookalike origins fail closed
- proxy request bodies are materialized with a 2 MiB ceiling; forwarded headers are allowlisted
- packaged Electron fuses disable Run-as-Node, `NODE_OPTIONS`, inspector CLI arguments, and file-protocol privileges while enforcing ASAR integrity and ASAR-only loading
- provider child processes still run with the user's privileges; CodeWave does not claim to sandbox third-party CLIs

## Development and packaging

```bash
npm run dev:desktop
npm run build:desktop
```

`dev:desktop` starts Electron Forge with Vite. `build:desktop` creates an immutable unpacked package for the current platform under `apps/desktop/out/package-<timestamp>/`. A unique output avoids overwriting an executed Windows package whose `app.asar` may still be held after a fatal process exit. CI may set a filename-safe `CODEWAVE_DESKTOP_OUTPUT_ID` for a reproducible directory name. Forge makers are configured for Windows Squirrel/ZIP, macOS DMG/ZIP, and Linux deb/rpm, but public artifacts require platform-native CI, signing/notarization, installer tests, and artifact verification first.

The package command regenerates desktop PNG/ICO assets from the product-owned `apps/web/public/codewave-mark.svg` before Forge runs, so the installed executable and the shell use one canonical CodeWave mark. A reviewed native macOS ICNS asset remains part of the macOS release gate.

Run the release-relevant local gates with:

```bash
npm run check:desktop-daemon
npm run check:desktop-security
npm run check:desktop-demo
npm run build:desktop
```

## Alpha non-claims

This slice is a secure, locally packaged alpha—not a public release channel. It does not yet provide:

- signed or notarized binaries from trusted CI
- automatic update metadata, rollback, or downgrade handling
- a remote service, account system, telemetry pipeline, or cloud sync
- cross-platform installer evidence beyond the platform on which a package was built and exercised
- a guarantee that every provider CLI is installed, authenticated, or free to use

Those items are release gates, not silent promises.

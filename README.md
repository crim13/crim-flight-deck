# CRIM Flight Deck

An Android **tablet** becomes a virtual throttle quadrant and an Android **phone** becomes an autopilot / radio / systems
panel for **Microsoft Flight Simulator 2024**. Everything runs locally: a small Windows server on the simulator PC, a
SimConnect bridge, and a web UI that the tablet and phone open in their browsers over your Wi-Fi. No cloud, no accounts.

> **Status: early release.** The code is covered by automated tests that use a mock simulator (hundreds of checks plus a
> production smoke test), and the author runs it with MSFS 2024. Individual simulator mappings (event names, trim and
> mixture ranges, attitude signs ...) are still being confirmed one by one: what is verified and what is not is listed in
> [docs/VERIFICATION.md](docs/VERIFICATION.md), and [docs/MANUAL-TESTS.md](docs/MANUAL-TESTS.md) is a checklist you can walk
> through. Bug reports with the log lines (`data\logs`) are very welcome.
>
> Not affiliated with or endorsed by Microsoft or Asobo Studio. Free software under the GNU GPL v3 (see [LICENSE](LICENSE)).

```
 tablet / phone browser  <--WebSocket (LAN, token)-->  Node server (HTTP + WS, state, profiles, config)
                                                          |  stdin/stdout JSON lines
                                                          v
                                          .NET Framework 4.8 SimConnect bridge  <--SimConnect-->  MSFS 2024
```

## Install (Windows 10 / 11, MSFS 2024)

1. Install the **MSFS 2024 SDK** once, from inside the simulator: *Options > General > Developers > Developer Mode ON*,
   then *Help > SDK Installer*. CRIM Flight Deck needs Microsoft's SimConnect DLLs from it, and they are not allowed to
   be shipped here, so `install.cmd` copies them from *your* SDK.
2. Download `CRIM-FlightDeck-vX.Y.Z-win-x64.zip` from the [latest release](https://github.com/crim13/crim-flight-deck/releases/latest)
   and unzip it to a folder you can write to, for example `C:\CRIM-FlightDeck` (not *Program Files*: updates replace files in place).
   Node.js is included, nothing else to install.
3. Double-click **`install.cmd`**. It unblocks the downloaded files, copies the SimConnect DLLs, and asks (each is optional)
   whether to add the Windows firewall rule for the tablet/phone, start the server automatically with MSFS, and create
   Start Menu shortcuts. If Windows SmartScreen warns about the scripts or `.exe` files, that is the "downloaded from the
   internet" mark: *More info > Run anyway* (or right-click the zip > Properties > Unblock before unzipping).
4. Start MSFS (or run `start.cmd`), open **http://localhost:3000/admin** on the PC and scan the QR code with the tablet / phone.

To remove the system changes again run `uninstall.cmd` (the folder and your settings in `data\` stay until you delete them).

## Updating

* **From the app:** the PC admin page (`http://localhost:3000/admin`) shows "Update available" with an **Update now** button.
* **From the folder:** double-click `update.cmd` (`scripts\update.ps1 -Check` only looks).

The update downloads the release zip from GitHub, verifies its SHA-256 against the `SHA256SUMS.txt` of the same release, keeps
a copy of the current version (`data\updates\backup-<version>`), installs, restarts the server, and **rolls back
automatically** if the new version does not start. Your settings (`data\`) and the SimConnect DLLs are never touched.
The server looks for new releases about every 12 hours with one plain HTTPS request to `api.github.com` (GitHub sees your IP
address, like for any web request; nothing else is sent). It never installs anything by itself. Turn the check off with
`"checkForUpdates": false` in `data\server.json` or by setting the environment variable `CRIM_NO_UPDATE_CHECK=1`.

## Run from source (developers)

1. Install **Node.js 20+** (https://nodejs.org/).
2. Double-click **`start.cmd`** (or run it in a terminal). First run installs dependencies and builds the UI/server,
   then opens the PC admin page with the pairing links and a QR code. Add `-Mock` to try the UI without the simulator:
   `start.cmd -Mock`.
3. For the real simulator you also need the bridge, see [SDK setup](#sdk-setup-real-simulator).
4. On the tablet/phone (same Wi-Fi) open the link printed in the console / admin page, e.g.
   `http://192.168.1.100:3000/?t=<token>` (use the QR code on `http://localhost:3000/admin`). The address is detected
   automatically; the token is stored by the browser, so next time `http://<pc-ip>:3000` is enough.
5. Start MSFS 2024 whenever you like - the server connects automatically and reconnects after a simulator restart.

Stop with **Ctrl+C** in the console (or close the window): the bridge and sockets are shut down gracefully.

Useful commands:

| Command | Purpose |
| --- | --- |
| `start.cmd` / `start.cmd -Mock -Port 3100 -NoBrowser -Rebuild` | production start (builds if needed) |
| `npm run doctor` | checks Node, .NET SDK, MSFS SDK, bridge, firewall, LAN addresses |
| `npm run dev:mock` / `npm run dev` | dev servers with hot reload (Vite on :5173 + server on :3000), mock or real |
| `npm run build` / `npm run build:bridge` | build web+server / SimConnect bridge |
| `npm test` / `npm run typecheck` / `npm run smoke` / `npm run verify` | tests, types, production smoke test, all of it |
| `scripts\allow-firewall.ps1` (admin) | allow the port for the local subnet on private networks |

### Start automatically with MSFS

```
scripts\autostart.ps1 -Status      what is installed (read only)
scripts\autostart.ps1 -Install     MSFS starts the server (hidden) together with the simulator
scripts\autostart.ps1 -Uninstall   remove it again
```

`-Install` adds one `CRIM Flight Deck` entry to MSFS 2024's `EXE.xml` (`%APPDATA%\Microsoft Flight Simulator 2024\` for
Steam, `%LOCALAPPDATA%\Packages\Microsoft.Limitless_8wekyb3d8bbwe\LocalCache\` for Store / Game Pass - whichever exists).
Other add-ons in that file are kept, the file is backed up (`EXE.xml.crim-backup`) and validated before it is replaced, and
`-DryRun` shows the change without making it. **Restart MSFS afterwards.** The server then runs without a console window
(logs in `data\logs\`), stops when the simulator exits, and is not started twice if you already launched it by hand.
Build it once first (`start.cmd`), because the hidden launcher does not build anything.
Alternative that does not touch `EXE.xml`: `scripts\autostart.ps1 -Install -Method Task` registers a logon task that
waits for the simulator (Windows may ask for an administrator shell for this one). Add `-KeepRunning` to either to leave
the server running after the simulator closes. The firewall rule (`scripts\allow-firewall.ps1`) is still a one-time step.

### SDK setup (real simulator)

The official managed SimConnect wrapper (`Microsoft.FlightSimulator.SimConnect.dll`) targets **.NET Framework 4.6.1
(x64)** - the project therefore uses a **.NET Framework 4.8 bridge** plus the Node server instead of assuming .NET 8
compatibility (details in [docs/VERIFICATION.md](docs/VERIFICATION.md)).

1. **MSFS 2024 SDK**: in MSFS enable *Options > General > Developers > Developer Mode*, then *Help > SDK Installer*.
   It installs to e.g. `C:\MSFS 2024 SDK` (and normally sets `MSFS2024_SDK`).
2. **.NET SDK** (to compile the bridge once): `winget install Microsoft.DotNet.SDK.8`.
3. Run `scripts\build-bridge.ps1` (or just `start.cmd`, which builds the bridge when it is missing). It finds the SDK,
   builds `apps\simconnect-bridge\bin\CrimSimConnectBridge.exe` and copies the native `SimConnect.dll` next to it.
   Use `-SdkPath "D:\MSFS 2024 SDK"` for a non-standard location.

## Using it

**Tablet (landscape)** - one full-screen instrument panel: elevator **trim wheel** (relative finger movement, neutral marker,
nose up/down), **throttle** (black ribbed grip), **propeller** (blue knob), **mixture** (red paddle), **flaps** gate
(detents from the profile/simulator, never assumed), **gear** lever (lever = commanded position, lamp = actual gear:
red in transit / green down), **parking brake** pull handle, and configurable light/system toggles.
Levers use a grab offset - touching anywhere never makes a handle jump - and moving the finger sideways away from a
lever gives fine adjustment (x0.5 / x0.25 / x0.1). Several controls can be operated with several fingers at once.

**Tablet pages** - a slim rail on the left switches between **THR** (the throttle quadrant) and the same pages as the phone:
**AP**, **RADIO**, **SYS**, **QUICK**, laid out for landscape (the AP page also has the attitude indicator). Every page can be
edited like the quadrant (Settings > Edit layout edits the page you are on; RESET resets only that page).

**Attitude indicator** - a read-only artificial horizon (sky/ground, pitch ladder, bank scale with roll pointer, numeric pitch
and bank). By default it is a square tile above GEAR and PARK BRAKE on the quadrant; it can be added to any page (Edit layout
> ADD > Attitude indicator). The sign convention of `ATTITUDE INDICATOR PITCH/BANK DEGREES` is not documented; if the horizon
moves the wrong way in the sim, flip that axis in Settings (Attitude: flip pitch / flip bank).

**Values on top** - every lever and the trim wheel show their value in large digits at the *top* of the control (above the
handle, so a hand never covers it). A cyan marker beside a handle shows where the simulator really is, only while it differs
from the handle (a slow simulator, or a command it refused).

**Linked levers (multi-engine)** - twins get Throttle 1+2, Prop 1+2 and Mixture 1+2 side by side. When the two levers are
within ~10% of each other a grey **link handle** appears between them; grab it to align both to their mean and move them
together. Each lever still works on its own, and the link disappears when they drift apart. Edit layout > ADD also offers
"... linked" pairs. (Tablet quadrant layouts saved by an older version are replaced once by the current default, which now
has 20 grid rows and the attitude indicator.)

**Top bar** - flight data above both layouts: IAS, GS, altitude, vertical speed, magnetic heading, fuel, fuel flow and
endurance (fuel, flow and endurance are only shown on the tablet-width bar; tap them to cycle GAL / LB / KG). It is read only,
comes straight from the simulator and shows `--` when there is no data. Settings > Top bar turns it off.

**Handles do not jump back** - after you let go, a handle keeps your value as long as the simulator is still moving towards
it (lever animation, trim rate) and only follows the simulator again when it agrees or stops making progress; if the simulator
ends up elsewhere the handle glides there instead of jumping.

**Phone (portrait)** - four pages: **AP** (heading/altitude/VS dual knobs: outer ring coarse, inner cap fine; AP, HDG,
NAV, APR, ALT, VS buttons that light only when the sim reports the mode), **RADIO** (COM1/2, NAV1/2 active+standby, swap,
dual tuning knob; transponder code, mode and IDENT), **SYS** (lights, battery, avionics, fuel pump, pitot heat, parking
brake) and **QUICK** (user-configurable buttons).

**Settings** (small cog in the corner; the dot next to it is green only when the server *and* the simulator are
connected, amber for mock data, red otherwise): layout mode (auto/tablet/phone - works on any device), start page,
detected aircraft and profile choice for that aircraft, per-control **invert / sensitivity**, edit layout, fullscreen,
connection details, forget pairing. **Edit layout** shows move/resize/hide handles on every control and an *Add*
list (e.g. add any command to the QUICK page); outside edit mode the layout is locked.
Tip: "Add to Home screen" in Chrome gives a fullscreen app without browser bars.

Unsupported controls are never faked: a fixed-pitch aircraft has no prop lever (hidden in the default layout and refused
by the server), fixed gear shows "FIXED", missing equipment (COM2, autopilot ...) is dimmed with a reason.

## Aircraft profiles

`shared/profiles/*.json` ship with the app (generic fixed-pitch GA, constant-speed GA, twin piston, turboprop, jet).
A profile is selected automatically from the simulator's `TITLE`, `ENGINE TYPE`, `NUMBER OF ENGINES`; you can override it
per aircraft in Settings. To add or tune an aircraft, drop a JSON file into `data\profiles\` (same `id` replaces a built-in):

```json
{
  "version": 1, "id": "my-bonanza", "name": "My Bonanza", "engines": 1, "propeller": "constantSpeed",
  "match": { "engineTypes": ["piston"], "titleIncludes": ["bonanza"], "priority": 60 },
  "controls": {
    "throttle": { "enabled": true }, "prop": { "enabled": true }, "mixture": { "enabled": true },
    "trim": { "enabled": true }, "flaps": { "enabled": true }, "gear": { "enabled": true },
    "parkingBrake": { "enabled": true },
    "lightLanding": { "enabled": true, "mapping": { "kind": "event", "event": "LANDING_LIGHTS_SET", "encoding": "bool", "extra": [1] } }
  },
  "flapDetents": [ { "index": 0, "label": "UP" }, { "index": 1, "label": "T/O", "detail": "15" }, { "index": 2, "label": "LDG", "detail": "30" } ],
  "verification": { "status": "docs" }
}
```

Controls missing from `controls` are disabled. `mapping` overrides the default command (kinds: `event`, `toggle`,
`absolutePair`, `setvar`, `inputEvent`). **Aircraft-specific Input Events** are supported through
`{"kind":"inputEvent","name":"<B: variable name>"}`; no names are shipped because they differ per aircraft. Start the server
with `--log-input-events` (e.g. `node apps/server/dist/server.mjs --log-input-events`) to log the Input Events of the
loaded aircraft, then reference them in a profile. Single-engine, multi-engine, turboprop and jet profiles use the same schema.

## Synchronisation model

* The **simulator is the only source of truth**. A tablet command goes server -> bridge -> SimConnect; the new value
  reaches every device only when the simulator reports it (data requests use `CHANGED`, so no polling).
* On (re)connect a device receives a full snapshot and adopts it; devices never push remembered values. Commands are
  dropped while offline, never queued.
* While you drag, the handle follows the finger and ignores feedback for that control; after release it holds while the
  simulator keeps moving towards the value and until it agrees (or stalls for 1.2 s, 8 s at most), so a refused command
  still ends up showing reality. The value you release at is always sent, even if the simulator's (lagging) reading
  already equals it. Drag updates are coalesced (<= ~33 Hz client,
  one command per 33 ms per control server side, final value always sent, no re-sending after the drag ends).
* Toggle-style simulator events (lights, AP modes ...) are made absolute by comparing with the current state; a blind
  toggle is refused when the state is unknown.
* **Two devices on one control: first touch wins**; the other gets "busy" until 250 ms after release (or 2 s idle).
  Sim-originated changes are never blocked. Out-of-order sequence numbers are dropped.
* If the simulator disconnects, all values are forgotten and controls are disabled instead of showing stale data.

## Security

LAN only by default: the server binds the detected private LAN address + loopback and additionally rejects clients from
non-private addresses. WebSocket connections need the **pairing token** (random, generated on first start, stored in
`data\server.json`) sent in the first message (never in a URL that stays in history), plus an Origin check, strict message
validation, size and rate limits. There is no endpoint that executes commands; clients can only request whitelisted
controls with range-checked values. The `/admin` page (QR code) is reachable from the PC itself only. To revoke all
devices, delete `token` from `data\server.json` and restart.
Limitation: traffic is plain HTTP/WS (browsers refuse self-signed certificates for installable web apps without
manual steps); use a trusted network.

## Data & configuration

`data\` (override with `CRIM_DATA_DIR`): `server.json` (host, port, adapter, log level, `stateHz`, token ...),
`shared.json` (per-aircraft profile choice, control invert/sensitivity), `devices\<id>.json` (per device: name, mode,
start page, tablet/phone layouts per profile), `profiles\*.json` (your profiles). All files are versioned and validated;
unreadable files are moved to `*.bad-<time>` and replaced by defaults.
Environment/CLI: `CRIM_ADAPTER`, `CRIM_PORT`, `CRIM_HOST` (`auto` | `0.0.0.0` | an interface IP), `CRIM_LOG_LEVEL`
(`error|warn|info|debug`) and `node apps/server/dist/server.mjs --help`.

## Releasing (maintainer)

Releases are built on the maintainer's PC, because compiling the bridge needs the MSFS SDK (GitHub's build servers do not
have it); GitHub Actions (`.github/workflows/ci.yml`) only runs the tests.

```
scripts\package-release.ps1 -Version 1.1.0        # bumps versions, runs npm run verify, builds app + bridge, zips with Node
scripts\package-release.ps1 -Publish              # ... and creates the GitHub release (gh auth login first)
```

Write the notes first: the script refuses to release without a `## [x.y.z]` section in `CHANGELOG.md` and uses it as the
release text. Output: `release\CRIM-FlightDeck-vX.Y.Z-win-x64.zip` and `SHA256SUMS.txt` (both are uploaded: the updater
needs them). The zip contains the built app, the bridge exe and a pinned Node.js runtime (downloaded from nodejs.org and
checked against its SHASUMS256.txt), but never Microsoft's DLLs.

## Contributing

Issues and pull requests are welcome. `npm run verify` (typecheck, tests, build, smoke test) must pass; CI runs it on every
push. New simulator mappings should say how they were verified (see `docs/VERIFICATION.md`).

## Project layout

```
apps/web               React + TypeScript + Vite UI, SVG controls, zustand stores
apps/server            Node server: HTTP/WS gateway, SimHub (state/arbitration/scheduling), adapters (simconnect, mock)
apps/simconnect-bridge C# .NET Framework 4.8 bridge (single SimConnect thread)
shared                 protocol (zod), control registry, state & command catalogs, profiles, layouts, settings schemas
scripts, docs, start.cmd
```
Protocol reference: [docs/PROTOCOL.md](docs/PROTOCOL.md). New widget types register in `apps/web/src/controls/registry.ts`;
new controls need entries in `shared/src/controls.ts`, `state.ts` and `commands.ts`.

## Troubleshooting

* **Tablet cannot open the page** - same Wi-Fi? Run `scripts\allow-firewall.ps1` as admin; make sure the Wi-Fi network profile
  is *Private*; check the printed address (several adapters: the Wi-Fi one is listed first); `npm run doctor`.
  Android Chrome "Private DNS"/VPN can block LAN addresses; try disabling them.
* **"PAIR THIS DEVICE" screen** - open the pairing link again (token changed or browser data cleared).
* **Red banner "WAITING FOR MSFS"** - MSFS not running / still loading. **"SIMCONNECT BRIDGE NOT RUNNING"** - the bridge is
  not built or crashed: `npm run doctor`, `scripts\build-bridge.ps1`, check the console log.
* **SimConnect exceptions** are shown as a toast and logged (`--log-level debug` for more); see MANUAL-TESTS for event-name problems.
* **Controls dimmed** - the reason is printed on the control; typically the aircraft profile or the aircraft lacks the system.
* **Layout wrong after switching aircraft** - layouts are stored per profile; Settings > Edit layout > RESET.
* **Windows Application Control blocks a native node module** - the project uses Rollup's WASM build (npm override) for this reason.
* **Autostart does nothing** - `scripts\autostart.ps1 -Status` (is the entry there? is `EXE.xml` valid XML?), then read
  `data\logs\autostart.log` and `server.err.log`. An invalid `EXE.xml` stops MSFS from launching *every* add-on in it.
  The entry only applies at the simulator's next start. If the log says the build output is missing, run `start.cmd` once.
* **Port in use** - `start.cmd -Port 3100`, or set `port` in `data\server.json`.
* Android browsers: pointer capture and `touch-action: none` are used for all controls; if the page scrolls or zooms,
  reload and avoid browser "desktop site" mode; fullscreen requires a user tap (Settings > FULLSCREEN) or "Add to Home screen".

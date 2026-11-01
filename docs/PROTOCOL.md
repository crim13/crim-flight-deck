# Wire protocol (version 1)

JSON text messages over one WebSocket (`ws://<host>:<port>/ws`). The authoritative definitions are the zod schemas in
`shared/src/protocol.ts`; the server validates every client message (type, ranges, known controls, size <= 128 KiB, rate limit).

## Handshake

1. Client opens the socket (browser `Origin` must equal the `Host` or be allow-listed).
2. Client sends **within 5 s**:
   `{"type":"hello","token":"<pairing token>","deviceId":"dev-abc123...","deviceName":"Tablet","role":"tablet|phone|other","protocol":1}`
3. Server answers `welcome`, `sim.status`, `profile.active`, `config.snapshot`, `sim.state` (full), `devices`.
   Wrong token: `error` (`unauthorized`) and close code 4003; protocol mismatch 4004; replaced by a newer connection of
   the same `deviceId` 4002; no hello 4001.

## Client -> server

| type | fields | notes |
| --- | --- | --- |
| `control.set` | `control`, `value`, `engine?` (1-4), `sequence`, `phase?` | the only way to command the simulator |
| `config.save` | `scope: "device" \| "shared"`, `data` | validated against `DeviceSettingsSchema` / `SharedSettingsSchema` |
| `config.get` | - | returns `config.snapshot` |
| `profile.select` | `aircraftKey`, `profileId \| null` | per-aircraft override (null = automatic) |
| `device.update` | `deviceName?`, `role?` | |
| `ping` | `t` | answered with `pong` |

`control.set` example (conceptual values are normalised: levers 0..1, trim -1..1, flaps = detent index, switches 0/1,
setpoints in their natural unit: degrees, feet, ft/min, Hz, squawk digits):

```json
{ "type": "control.set", "control": "throttle", "value": 0.75, "engine": 1, "sequence": 123, "phase": "update" }
```

`phase`: `begin` / `update` / `end` bracket a drag (the device owns the control meanwhile); `set` (default) is a one-shot.
`sequence` must increase per connection; non-increasing values are answered `stale`.

## Server -> client

| type | content |
| --- | --- |
| `welcome` | protocol, server version, `adapter` (`simconnect`\|`mock`), `mock` |
| `sim.status` | `adapter`, `mock`, `bridge` (`stopped\|starting\|running\|failed`), `sim` (`disconnected\|connecting\|connected`), `detail`, `simApp` |
| `sim.state` | `{rev, full:true, data:{key:value}}` full snapshot (empty `data` = simulator offline) |
| `sim.patch` | `{rev, data:{changed keys}}` coalesced to <= `stateHz` per second; clients ignore `rev <= current` |
| `profile.active` | active profile (capabilities per control), reason (`override\|match\|fallback`), aircraft key, profile list |
| `ack` | `{sequence, control, status: ok\|redundant\|rejected\|busy\|stale, reason?}` (no ack for plain `ok` drag updates) |
| `error` | `{code, message, detail?}` codes: `bad-message unauthorized bad-origin protocol-mismatch unsupported-control sim-offline rate-limited sdk-error bad-config internal` |
| `config.snapshot` | shared settings, this device's settings, LAN URLs |
| `devices` | connected devices |
| `pong` | |

State keys (`sim.state.data`): normalised values - `throttle`, `prop`, `mixture` (0..1; engine n>1: `throttle2` ...), `trim` (-1..1),
`flaps` (index), `gear` (command 0/1), `gearActual` (0..1), `parkingBrake`, lights/systems 0/1, AP flags and setpoints
(`apHeadingSel` deg, `apAltitudeSel` ft, `apVsSel` ft/min), radios in Hz, `xpndrCode`, `xpndrMode`, plus identity (`id.*`) and
capability (`cap.*`) keys, and read-only telemetry (`tel.*`, always subscribed, rounded for display): `tel.ias`/`tel.gs` (kt),
`tel.alt` (ft), `tel.vs` (ft/min, 10 steps), `tel.hdg` (deg magnetic), `tel.pitch` / `tel.bank` (deg, raw simulator sign, 0.5 steps), `tel.fuelGal`, `tel.fuelLb`, `tel.ff` (gal/h; engine n>1: `tel.ff2` ...). Availability of each control is derived identically on server and client from
(profile x capabilities x simulator state) by `computeAvailability`.

## Server <-> bridge (stdin/stdout, one JSON per line)

Server -> bridge: `{"t":"subscribe","vars":[{"id","name","unit","type":"num|str"}]}`,
`{"t":"event","name","data":[d0..d4]}`, `{"t":"setvar","var","value"}`, `{"t":"inputEvent","name","value"}`,
`{"t":"enumInputEvents"}`, `{"t":"shutdown"}`.
Bridge -> server: `{"t":"ready"}`, `{"t":"conn","state":"connecting|connected|disconnected","detail","app"}`,
`{"t":"data","d":{"id":value,...}}` (batched per message pump), `{"t":"err","code","message","detail"}`,
`{"t":"inputEvents","list":[...]}`, `{"t":"log","level","msg"}`.

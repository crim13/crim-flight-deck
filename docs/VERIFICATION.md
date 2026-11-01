# Verification status

Nothing in this project has been run against a live MSFS 2024 yet (no simulator or SDK was available while
it was built). This file records what *was* verified, against what, and what still has to be confirmed in the sim.

## 1. Managed wrapper / .NET runtime decision

Inspected the managed wrapper `Microsoft.FlightSimulator.SimConnect.dll` (assembly version 12.2.0.0, read-only
metadata inspection of a copy found on this PC; it is not used or redistributed by this project):

| Property | Value |
| --- | --- |
| Target framework | `.NETFramework,Version=v4.6.1` |
| Architecture | `Amd64` (x64) |
| Dependencies | `mscorlib`, `System`, `System.Data`, `System.Xml` (classic .NET Framework only) |
| Constructor | `SimConnect(string name, IntPtr hWnd, uint userEvent, WaitHandle eventHandle, uint configIndex)` |

Decision: the official wrapper targets .NET Framework 4.6.1 and loads a native `SimConnect.dll`, and nothing
verifies it on .NET 8+. **The bridge is therefore a .NET Framework 4.8 / x64 process**
(`apps/simconnect-bridge`), driven by a separate Node.js server over stdin/stdout. Compiling it needs a .NET SDK
(any SDK >= 6 can target `net48` through the `Microsoft.NETFramework.ReferenceAssemblies` package) and the
SDK's wrapper DLL (`<SDK>\SimConnect SDK\lib\managed`) + native `SimConnect.dll` (`<SDK>\SimConnect SDK\lib`).

Threading: all SDK calls happen on one dedicated thread. The wrapper is created with a `WaitHandle`
(no window needed); the thread waits on {stop, command queue, SimConnect event} and drains `ReceiveMessage()`
when signalled. The stdin reader thread only enqueues commands.

## 2. Event names (MSFS 2024 SDK "Key Events" documentation)

Checked in the 2024 docs under `programming-apis/key-events/*`. "Event ID" spelling is used with
`MapClientEventToSimEvent` (the docs list `KEY_<name>` as the second alias; the un-prefixed name is the one used
by SDK samples and widely in the community - if a name is ever rejected the bridge reports
`NAME_UNRECOGNIZED` with the event name, see MANUAL-TESTS).

| Control | Event | Parameters (per docs) | Notes |
| --- | --- | --- | --- |
| throttle n | `THROTTLE1_SET`..`4` | 0-16383 | "Set throttle n exactly" |
| prop n | `PROP_PITCH1_SET`..`4` | 0-16383 | "Set prop pitch lever n exact value" |
| mixture n | `MIXTURE1_SET`..`4` | `[0]: Value` | **range not stated in the 2024 table**; 0-16383 assumed (legacy convention) |
| trim | `ELEVATOR_TRIM_SET` | -16383..16384 | direction (+ = nose up) to be confirmed live; `invert` setting available |
| flaps | `FLAPS_SET` | 0-16383 | "closest increment"; value = index / maxIndex * 16383 |
| spoilers | `SPOILERS_SET` | 0-16383 | |
| gear | `GEAR_SET` | position (0,1) | absolute |
| parking brake | `PARKING_BRAKE_SET` | Bool | absolute |
| avionics | `AVIONICS_MASTER_SET` | Bool | absolute |
| nav/beacon/strobe/landing/taxi lights | `TOGGLE_NAV_LIGHTS`, `TOGGLE_BEACON_LIGHTS`, `STROBES_TOGGLE`, `LANDING_LIGHTS_TOGGLE`, `TOGGLE_TAXI_LIGHTS` | optional circuit name/index | sent without parameter; made absolute by comparing with state |
| battery | `TOGGLE_MASTER_BATTERY` | optional battery index | toggle + state compare |
| fuel pump | `FUEL_PUMP` | engine index | toggle + state compare |
| pitot heat | `PITOT_HEAT_TOGGLE` | - | toggle + state compare |
| AP master | `AUTOPILOT_ON` / `AUTOPILOT_OFF` | - | absolute |
| AP modes | `AP_PANEL_HEADING_HOLD`, `AP_NAV1_HOLD`, `AP_APR_HOLD`, `AP_PANEL_ALTITUDE_HOLD`, `AP_PANEL_VS_HOLD` | - | toggles + state compare |
| AP setpoints | `HEADING_BUG_SET` (deg, index), `AP_ALT_VAR_SET_ENGLISH` (ft, index), `AP_VS_VAR_SET_ENGLISH` (fpm, index) | `[0]` value `[1]` index | index 1 sent |
| COM | `COM_RADIO_SET_HZ`, `COM_STBY_RADIO_SET_HZ`, `COM2_RADIO_SET_HZ`, `COM2_STBY_RADIO_SET_HZ`, `COM1_RADIO_SWAP`, `COM2_RADIO_SWAP` | Hz | |
| NAV | `NAV1_RADIO_SET_HZ`, `NAV1_STBY_SET_HZ`, `NAV2_...`, `NAV1_RADIO_SWAP`, `NAV2_RADIO_SWAP` | Hz | |
| transponder | `XPNDR_SET` (BCO16), `XPNDR_IDENT_ON` | | mode via SimVar write `TRANSPONDER STATE:1` (enum, settable) |

Multi-parameter events use `SimConnect_TransmitClientEvent_EX1` (up to 5 DWORD parameters); single/no-parameter
events use `TransmitClientEvent`. Negative values (trim, VS) are sent as two's-complement DWORDs.

## 3. SimVars used for state (2024 SimVar documentation: name, unit, settable)

Throttle/prop/mixture `GENERAL ENG THROTTLE|PROPELLER|MIXTURE LEVER POSITION:n` (percent) - trim
`ELEVATOR TRIM PCT EX2` (percent_over_100, -1..1, 2024 SimVar) - `SPOILERS HANDLE POSITION` - `FLAPS HANDLE INDEX`
(number) - `GEAR HANDLE POSITION` (command) and `GEAR TOTAL PCT EXTENDED` (actual) - `BRAKE PARKING POSITION` -
`LIGHT NAV|BEACON|STROBE|LANDING|TAXI` - `ELECTRICAL MASTER BATTERY:1` - `AVIONICS MASTER SWITCH` -
`GENERAL ENG FUEL PUMP SWITCH:n` - `PITOT HEAT SWITCH:1` - `AUTOPILOT MASTER|HEADING LOCK|NAV1 LOCK|APPROACH HOLD|ALTITUDE LOCK|VERTICAL HOLD` -
`AUTOPILOT HEADING LOCK DIR` (degrees), `AUTOPILOT ALTITUDE LOCK VAR` (feet), `AUTOPILOT VERTICAL HOLD VAR` (feet/minute) -
`COM|NAV ACTIVE|STANDBY FREQUENCY:n` (Hz; "Hz" is a documented frequency unit) - `TRANSPONDER CODE:1` (bco16) - `TRANSPONDER STATE:1` (enum).

Identity/capabilities (always subscribed): `TITLE`, `ATC TYPE`, `ATC MODEL`, `ENGINE TYPE` (enum), `NUMBER OF ENGINES`,
`IS GEAR RETRACTABLE`, `FLAPS AVAILABLE`, `FLAPS NUM HANDLE POSITIONS`, `SPOILER AVAILABLE`, `AUTOPILOT AVAILABLE`,
`TRANSPONDER AVAILABLE`, `COM AVAILABLE:n`, `NAV AVAILABLE:n`.

Top-bar telemetry (always subscribed, read only): `AIRSPEED INDICATED` (knots), `GROUND VELOCITY` (knots), `INDICATED ALTITUDE`
(feet), `VERTICAL SPEED` (feet per minute), `PLANE HEADING DEGREES MAGNETIC` (degrees), `ATTITUDE INDICATOR PITCH DEGREES` / `ATTITUDE INDICATOR BANK DEGREES` (degrees;
the 2024 SimVar table lists the unit as radians, the gauge API token page as degrees, and neither states the sign - the
UI assumes nose-down / right-wing-down positive and has per-axis flip settings), `FUEL TOTAL QUANTITY` (gallons),
`FUEL TOTAL QUANTITY WEIGHT` (pounds), `ENG FUEL FLOW GPH:n` (gallons per hour). These are long-standing SimVars; they were
**not** re-checked against the 2024 SimVar pages when added and have not run live - a variable the simulator does not
provide simply keeps showing `--`.

Data requests use `SIMCONNECT_PERIOD_SIM_FRAME` with `SIMCONNECT_DATA_REQUEST_FLAG_CHANGED`: the simulator only sends a
variable when its value changed (plus once initially), so there is no polling.

## 4. Known uncertainties to confirm in the simulator

1. `MIXTURE n SET` value range (0-16383 assumed).
2. Trim direction and full-scale mapping of `ELEVATOR_TRIM_SET` (+ = nose up assumed).
3. `FLAPS NUM HANDLE POSITIONS` semantics (whether it includes the UP position). The UI derives detents `0..N-1`;
   if the sim's highest handle index differs, set `flapDetents` in a user profile.
4. Light / battery toggle events without a circuit parameter on aircraft using the modular electrical system.
5. Unindexed `LIGHT *` / `AVIONICS MASTER SWITCH` reads on modular-electrical aircraft.
6. Un-prefixed event names accepted by `MapClientEventToSimEvent` (expected; `KEY_` prefixed names are the documented alias).
7. Whether a released lever/trim ends exactly where it was released. The UI holds the released value while the simulator is
   moving towards it, and a cyan marker shows the simulator's real value while it differs. If the marker stays away after
   release the simulator is *not* reaching the commanded value (for example asymmetric trim limits making
   `ELEVATOR_TRIM_SET` and `ELEVATOR TRIM PCT EX2` non-linear, or a hardware axis overriding the lever): that is a mapping
   question to settle live, not something the UI should hide.
8. Aircraft-specific Input Events: the extension point exists (profile mapping `kind: "inputEvent"`, bridge op
   `inputEvent` / `enumInputEvents`) but **no Input Event names are shipped**, because they differ per aircraft and none
   were verified. Use the bridge's enumeration (see README) to discover them for an aircraft.

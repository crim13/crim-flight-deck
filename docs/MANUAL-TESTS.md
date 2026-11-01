# Manual tests to run in the real simulator

Everything below needs MSFS 2024 running with the bridge built (`npm run doctor`, `start.cmd`). Tick the box when
verified and note the aircraft. Until these are done the integration must be treated as **unverified live**.

Suggested aircraft: Cessna 172 (fixed pitch, fixed gear) and Beechcraft Bonanza G36 (constant speed, retractable gear),
plus one twin (Baron) and one jet or turboprop for the multi-engine / turbine profiles.

## Connection

- [ ] Start `start.cmd` **before** MSFS: admin page shows "NOT CONNECTED (waiting for MSFS)", tablet shows the red "WAITING FOR MSFS" banner and LED.
- [ ] Start MSFS, load a flight: within a few seconds the LED turns green, no restart of the server needed.
- [ ] Server log shows `SimConnect: connected - SimConnect x.y` and the profile chosen for the loaded aircraft.
- [ ] Exit MSFS to the desktop: devices go back to "WAITING FOR MSFS", controls dim, no stale values; restart MSFS: reconnects by itself.
- [ ] Change aircraft in the sim (C172 -> Bonanza): within ~1 s the layout/profile changes (prop lever appears for the Bonanza).

## Tablet -> simulator (each line: move the control on the tablet, watch the sim)

- [ ] Throttle moves the in-sim throttle smoothly 0-100 %.
- [ ] Mixture moves 0-100 % (confirm range, see VERIFICATION 4.1).
- [ ] Prop lever (Bonanza) moves RPM lever; **disabled with "Fixed-pitch propeller" on the C172**.
- [ ] Trim: finger up = nose-up trim (if inverted use Settings > Control tuning > Trim > INVERT, and report it).
- [ ] Flaps: tap every detent; the sim handle index follows; detent labels/count match the aircraft.
- [ ] Gear (Bonanza): lever down/up; lamp red in transit, green when down; fixed-gear C172 shows "FIXED".
- [ ] Parking brake pull/push mirrors the sim brake (toggle it in the sim, tablet follows).
- [ ] Nav / beacon / strobe / landing / taxi toggles, battery, avionics, fuel pump, pitot heat.
- [ ] Spoilers (jet profile).

## Simulator -> tablet / phone

- [ ] Move the throttle with the mouse in the virtual cockpit: tablet lever follows.
- [ ] Same for mixture, prop, flaps, trim, gear, parking brake, lights, battery, avionics.
- [ ] Hold a lever on the tablet while moving it in the sim: the handle does not fight the finger; after release it settles on the sim value.

## Phone

- [ ] AP master on/off; HDG / NAV / APR / ALT / VS mode buttons light only when the sim reports them active.
- [ ] Heading / altitude / VS knobs (outer ring coarse, inner fine) change the selected values in the sim and follow sim-side changes.
- [ ] COM1/COM2/NAV1/NAV2: tune standby with the knob, SWAP exchanges active/standby; frequencies match the sim radio.
- [ ] Transponder: digits, mode (OFF/STBY/ON/ALT), IDENT.
- [ ] Quick page buttons and Systems page switches.
- [ ] Anything not equipped (e.g. COM2 on a basic aircraft) is dimmed with a reason, not silently dead.

## Multi-device and resilience

- [ ] Tablet + phone connected: change a value on either, both stay in sync; moving the same lever on both at once: first touch wins, the other ignores until ~250 ms after release.
- [ ] Turn Wi-Fi off on the tablet for 20 s while moving a lever in the sim, turn it on: tablet reconnects, shows the *current* sim value, and the sim is not changed by the reconnect.
- [ ] Restart the server while MSFS is running: bridge reconnects, devices reconnect, layouts/profile choices persist.

## SDK error reporting

- [ ] Rename an event in a user profile mapping to a bogus name: the UI shows a toast and the log shows the SimConnect exception (`NAME_UNRECOGNIZED`) without a crash.
- [ ] If an event name is rejected (`NAME_UNRECOGNIZED`) for a valid documented event, try the `KEY_` prefixed alias via a profile mapping override and report back.

## Input Events (optional, aircraft specific)

- [ ] Send `{"t":"enumInputEvents"}` to the bridge (see README "Discovering Input Events") and verify the list is logged for an aircraft that exposes them.

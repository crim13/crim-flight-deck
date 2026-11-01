import { parseProfile, type Profile } from './profile';
import fixedPitch from '../profiles/generic-ga-fixed-pitch.json';
import constantSpeed from '../profiles/generic-ga-constant-speed.json';
import twinPiston from '../profiles/generic-twin-piston.json';
import turboprop from '../profiles/generic-turboprop.json';
import jet from '../profiles/generic-jet.json';

/** Profiles shipped with the app. User profiles in data/profiles/*.json are merged on top (same id wins). */
export const BUILTIN_PROFILES: Profile[] = [fixedPitch, constantSpeed, twinPiston, turboprop, jet].map((p) => parseProfile(p));

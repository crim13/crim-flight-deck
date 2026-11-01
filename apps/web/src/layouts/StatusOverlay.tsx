import { useSim } from '../stores/sim';
import { useUi } from '../stores/ui';

/** green only when the socket is authenticated AND the simulator answered; amber = mock data; red = something is missing */
function useLinkColor(): { color: string; text: string | null } {
  const link = useSim((s) => s.link);
  const sim = useSim((s) => s.status?.sim);
  const mock = useSim((s) => s.status?.mock ?? false);
  const bridge = useSim((s) => s.status?.bridge);
  if (link !== 'open') return { color: '#ff3b30', text: link === 'connecting' ? 'CONNECTING TO PC…' : 'CONNECTION LOST - RECONNECTING…' };
  if (sim !== 'connected') {
    return { color: '#ff3b30', text: sim === 'connecting' ? 'CONNECTING TO MSFS…' : bridge === 'failed' ? 'SIMCONNECT BRIDGE NOT RUNNING' : 'WAITING FOR MSFS' };
  }
  return { color: mock ? '#ffa51f' : '#2ecc71', text: null };
}

/** Connection LED, MOCK badge and the settings cog (lives in the top bar, or floats top-right without one). */
export function StatusCluster({ floating = false }: { floating?: boolean }) {
  const { color } = useLinkColor();
  const link = useSim((s) => s.link);
  const mock = useSim((s) => s.status?.mock ?? false);
  const setSettings = useUi((s) => s.setSettingsOpen);
  return (
    <div className={`corner${floating ? ' floating' : ''}`}>
      {mock && link === 'open' && <span className="mock-tag">MOCK</span>}
      <span className="led" style={{ background: color, boxShadow: `0 0 8px ${color}` }} />
      <button type="button" className="cog ctl" aria-label="settings" onPointerDown={(e) => { e.preventDefault(); setSettings(true); }}>⚙</button>
    </div>
  );
}

/** Explains any non-OK state over the panel; shows the last simulator error as a toast. */
export function StatusOverlay() {
  const link = useSim((s) => s.link);
  const detail = useSim((s) => s.status?.detail);
  const err = useSim((s) => s.lastError);
  const { text } = useLinkColor();
  const showCluster = !useUi((s) => s.topBar);

  return (
    <>
      {text && (
        <div className="banner" role="status">
          <b>{text}</b>
          {link === 'open' && detail && <small>{detail}</small>}
        </div>
      )}
      {err && link === 'open' && <div key={err.at} className="toast">{err.message}</div>}
      {showCluster && <StatusCluster floating />}
    </>
  );
}

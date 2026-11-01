import { useEffect } from 'react';
import { connection } from './services/connection';
import { consumeUrlParams } from './services/device';
import { saveDevice } from './services/settings';
import { useSim } from './stores/sim';
import { resolveMode, useUi } from './stores/ui';
import { Pairing } from './layouts/Pairing';
import { PhonePanel } from './layouts/PhonePanel';
import { SettingsSheet } from './layouts/SettingsSheet';
import { StatusOverlay } from './layouts/StatusOverlay';
import { TabletQuadrant } from './layouts/TabletQuadrant';
import { TopBar } from './layouts/TopBar';

// ?mode=tablet|phone|auto in the pairing link: remembered locally and saved to the server once connected
let urlMode = consumeUrlParams();

export function App() {
  const modeSetting = useUi((s) => s.modeSetting);
  const viewport = useUi((s) => s.viewport);
  const settingsOpen = useUi((s) => s.settingsOpen);
  const topBar = useUi((s) => s.topBar);
  const link = useSim((s) => s.link);
  const configReady = useSim((s) => s.configReady);
  const serverMode = useSim((s) => s.device.mode);
  const role = resolveMode(modeSetting, viewport);

  useEffect(() => {
    const onResize = () => useUi.getState().setViewport(window.innerWidth, window.innerHeight);
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
    };
  }, []);

  // the mode saved on the server (device settings) wins once the snapshot arrives,
  // except for a mode just requested through the URL, which is saved to the server instead
  useEffect(() => {
    if (link !== 'open' || !configReady) return;
    if (urlMode) {
      const m = urlMode;
      urlMode = null;
      useUi.getState().setModeSetting(m);
      saveDevice((d) => ({ ...d, mode: m }), 50);
      return;
    }
    if (serverMode && serverMode !== useUi.getState().modeSetting) useUi.getState().setModeSetting(serverMode);
  }, [serverMode, link, configReady]);

  useEffect(() => {
    connection.start(role);
    connection.role = role;
    if (useSim.getState().link === 'open') connection.send({ type: 'device.update', role });
  }, [role]);

  // keep the screen on while the flight deck is open (best effort; not supported everywhere)
  useEffect(() => {
    let lock: { release(): Promise<void> } | null = null;
    const acquire = async () => {
      try {
        lock = await (navigator as unknown as { wakeLock?: { request(t: string): Promise<{ release(): Promise<void> }> } }).wakeLock?.request('screen') ?? null;
      } catch { /* denied */ }
    };
    void acquire();
    const onVis = () => { if (document.visibilityState === 'visible') void acquire(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { document.removeEventListener('visibilitychange', onVis); void lock?.release(); };
  }, []);

  if (link === 'unauthorized') return <Pairing />;
  return (
    <div className={`app${topBar ? ' has-topbar' : ''} ${role}`} onContextMenu={(e) => e.preventDefault()}>
      {topBar && <TopBar />}
      <div className="stage">
        {role === 'tablet' ? <TabletQuadrant /> : <PhonePanel />}
        <StatusOverlay />
      </div>
      {settingsOpen && <SettingsSheet />}
    </div>
  );
}

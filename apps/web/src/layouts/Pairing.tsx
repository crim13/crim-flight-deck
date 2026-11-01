import { useState } from 'react';
import { connection } from '../services/connection';
import { parseToken, setToken } from '../services/device';

/** Shown when the device has no (valid) pairing token. */
export function Pairing() {
  const [text, setText] = useState('');
  const [bad, setBad] = useState(false);
  const submit = () => {
    const t = parseToken(text);
    if (!t) return setBad(true);
    setToken(t);
    setBad(false);
    connection.stop();
    connection.start(connection.role === 'other' ? 'phone' : connection.role);
  };
  return (
    <div className="pairing">
      <div className="lbl">PAIR THIS DEVICE</div>
      <p>Open the pairing link shown in the server window on your PC (or scan its QR code at <b>http://&lt;PC&gt;:3000/admin</b> on the PC), or paste the link / token below.</p>
      <input className="field" value={text} placeholder="http://192.168.x.x:3000/?t=…" onChange={(e) => { setText(e.target.value); setBad(false); }} autoCapitalize="off" autoCorrect="off" spellCheck={false} />
      {bad && <p className="bad">That does not look like a pairing link or token.</p>}
      <button type="button" className="ctl primary" onPointerDown={(e) => { e.preventDefault(); submit(); }}>CONNECT</button>
    </div>
  );
}

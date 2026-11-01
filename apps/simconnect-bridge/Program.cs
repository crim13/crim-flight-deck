using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using Microsoft.FlightSimulator.SimConnect;

namespace Crim.Bridge
{
    // One-variable data definitions keep the bridge generic: the server decides which SimVars exist,
    // the bridge only needs two struct shapes (number / string) to marshal them.
    [StructLayout(LayoutKind.Sequential)]
    internal struct NumVar { public double value; }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Ansi, Pack = 1)]
    internal struct StrVar
    {
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 256)]
        public string value;
    }

    internal enum DEF : uint { Base = 1000 }
    internal enum REQ : uint { Base = 1000, EnumInputEvents = 900, EnumForDiscovery = 901 }
    internal enum EVT : uint { Base = 5000, AircraftLoaded = 4999 }
    internal enum GROUP : uint { Main = 1 } // value == SIMCONNECT_GROUP_PRIORITY_HIGHEST, used with GROUPID_IS_PRIORITY

    internal sealed class VarSpec
    {
        public string Id, Name, Unit;
        public bool IsString;
        public bool Failed;
    }

    internal static class Json
    {
        public static string Str(string s)
        {
            var sb = new StringBuilder("\"");
            foreach (var c in s ?? "")
            {
                switch (c)
                {
                    case '"': sb.Append("\\\""); break;
                    case '\\': sb.Append("\\\\"); break;
                    case '\n': sb.Append("\\n"); break;
                    case '\r': sb.Append("\\r"); break;
                    case '\t': sb.Append("\\t"); break;
                    default:
                        if (c < 0x20) sb.Append("\\u").Append(((int)c).ToString("x4"));
                        else sb.Append(c);
                        break;
                }
            }
            return sb.Append('"').ToString();
        }

        public static string Num(double d)
        {
            if (double.IsNaN(d) || double.IsInfinity(d)) return "null";
            return d.ToString("R", CultureInfo.InvariantCulture);
        }
    }

    /// <summary>
    /// Owns every SimConnect call on ONE dedicated thread (SimConnect is not thread-safe).
    /// Other threads (stdin reader) only enqueue commands and signal an event; messages from the
    /// simulator are pumped with ReceiveMessage() when the SimConnect event handle is signalled.
    /// </summary>
    internal sealed class Bridge
    {
        const string AppName = "CRIM Flight Deck";
        const string Version = "1.0.0";

        readonly object outLock = new object();
        readonly TextWriter stdout;
        readonly ConcurrentQueue<Dictionary<string, object>> commands = new ConcurrentQueue<Dictionary<string, object>>();
        readonly AutoResetEvent cmdEvent = new AutoResetEvent(false);
        readonly AutoResetEvent simEvent = new AutoResetEvent(false);
        readonly ManualResetEvent stopEvent = new ManualResetEvent(false);
        readonly JavaScriptSerializer json = new JavaScriptSerializer { MaxJsonLength = 4 * 1024 * 1024 };

        SimConnect sc;
        bool opened;
        int activity;
        List<VarSpec> vars = new List<VarSpec>();
        readonly Dictionary<string, int> varIndex = new Dictionary<string, int>();
        readonly Dictionary<string, EVT> eventIds = new Dictionary<string, EVT>();
        uint nextEvent = (uint)EVT.Base;
        readonly Dictionary<uint, string> sentDescriptions = new Dictionary<uint, string>();
        readonly Dictionary<string, object> batch = new Dictionary<string, object>();
        readonly Dictionary<string, ulong> inputHashes = new Dictionary<string, ulong>();
        readonly List<Tuple<string, double>> pendingInputEvents = new List<Tuple<string, double>>();
        bool inputEventsKnown;
        bool discoveryRequested;
        bool reportedNativeMissing;

        public Bridge(TextWriter output) { stdout = output; }

        // ---------------------------------------------------------------- output
        void Emit(string line)
        {
            lock (outLock) { stdout.WriteLine(line); }
        }

        void Log(string level, string msg) => Emit("{\"t\":\"log\",\"level\":" + Json.Str(level) + ",\"msg\":" + Json.Str(msg) + "}");

        void Err(string code, string message, string detail = null)
        {
            Emit("{\"t\":\"err\",\"code\":" + Json.Str(code) + ",\"message\":" + Json.Str(message) +
                 (detail != null ? ",\"detail\":" + Json.Str(detail) : "") + "}");
        }

        string lastConnKey;

        void Conn(string state, string detail = null, string app = null)
        {
            // only report real changes: the 2 s "waiting for MSFS" retry loop must not flood the server log
            string key = state + "|" + detail + "|" + app;
            if (key == lastConnKey) return;
            lastConnKey = key;
            Emit("{\"t\":\"conn\",\"state\":" + Json.Str(state) +
                 (detail != null ? ",\"detail\":" + Json.Str(detail) : "") +
                 (app != null ? ",\"app\":" + Json.Str(app) : "") + "}");
        }

        void FlushBatch()
        {
            if (batch.Count == 0) return;
            var sb = new StringBuilder("{\"t\":\"data\",\"d\":{");
            bool first = true;
            foreach (var kv in batch)
            {
                if (!first) sb.Append(',');
                first = false;
                sb.Append(Json.Str(kv.Key)).Append(':');
                if (kv.Value is string s) sb.Append(Json.Str(s)); else sb.Append(Json.Num(Convert.ToDouble(kv.Value)));
            }
            sb.Append("}}");
            batch.Clear();
            Emit(sb.ToString());
        }

        // ---------------------------------------------------------------- input (any thread)
        public void Enqueue(Dictionary<string, object> cmd)
        {
            commands.Enqueue(cmd);
            cmdEvent.Set();
        }

        public void RequestStop() { stopEvent.Set(); }

        public void ReadStdin(TextReader input)
        {
            string line;
            try
            {
                while ((line = input.ReadLine()) != null)
                {
                    if (line.Length == 0) continue;
                    try
                    {
                        var d = json.DeserializeObject(line) as Dictionary<string, object>;
                        if (d != null) Enqueue(d);
                    }
                    catch (Exception e) { Log("warn", "bad command line: " + e.Message); }
                }
            }
            catch (IOException) { }
            RequestStop(); // server went away (or closed stdin on purpose): shut down
        }

        // ---------------------------------------------------------------- main loop (SimConnect thread)
        public void Run()
        {
            string managed = typeof(SimConnect).Assembly.Location;
            Emit("{\"t\":\"ready\",\"version\":" + Json.Str(Version) + ",\"simconnect\":" + Json.Str(managed) + "}");

            var handles = new WaitHandle[] { stopEvent, cmdEvent, simEvent };
            while (!stopEvent.WaitOne(0))
            {
                if (sc == null)
                {
                    ProcessCommands();
                    if (!TryConnect())
                    {
                        // MSFS not running yet: retry every 2 s (or earlier on shutdown)
                        if (stopEvent.WaitOne(2000)) break;
                        continue;
                    }
                }
                int idx = WaitHandle.WaitAny(handles, 250);
                if (idx == 0) break;
                if (idx == 1) ProcessCommands();
                // idx == 2: simulator message(s) available; timeout (258): watchdog drain
                Drain();
                FlushBatch();
                if (pendingQuit)
                {
                    pendingQuit = false;
                    Disconnect("simulator closed", true);
                }
            }
            Disconnect("bridge stopping", false);
        }

        bool TryConnect()
        {
            if (lastConnKey == null) Conn("connecting");
            try
            {
                opened = false;
                sc = new SimConnect(AppName, IntPtr.Zero, 0, simEvent, 0);
                sc.OnRecvOpen += OnOpen;
                sc.OnRecvQuit += OnQuit;
                sc.OnRecvException += OnException;
                sc.OnRecvSimobjectData += OnData;
                sc.OnRecvEventFilename += OnAircraftLoaded;
                sc.OnRecvEnumerateInputEvents += OnEnumerateInputEvents;
                return true;
            }
            catch (DllNotFoundException e)
            {
                sc = null;
                if (!reportedNativeMissing)
                {
                    reportedNativeMissing = true;
                    Err("sdk-error", "SimConnect.dll not found next to the bridge. Re-run scripts\\build-bridge.ps1 with the MSFS 2024 SDK installed.", e.Message);
                }
                Conn("disconnected", "SimConnect.dll missing");
                return false;
            }
            catch (BadImageFormatException e)
            {
                sc = null;
                Err("sdk-error", "SimConnect.dll has the wrong architecture (the bridge is x64).", e.Message);
                Conn("disconnected", "SimConnect.dll architecture mismatch");
                return false;
            }
            catch (Exception e)
            {
                // COMException when MSFS is not running / not accepting connections yet
                sc = null;
                Conn("disconnected", "Waiting for Microsoft Flight Simulator (" + e.GetType().Name + ")");
                return false;
            }
        }

        void Disconnect(string reason, bool announce)
        {
            var s = sc;
            sc = null;
            opened = false;
            batch.Clear();
            eventIds.Clear();
            inputHashes.Clear();
            inputEventsKnown = false;
            discoveryRequested = false;
            sentDescriptions.Clear();
            nextEvent = (uint)EVT.Base;
            if (s != null)
            {
                try { s.Dispose(); } catch { }
            }
            if (announce) Conn("disconnected", reason);
        }

        void Drain()
        {
            for (int i = 0; i < 256 && sc != null; i++)
            {
                int before = activity;
                try { sc.ReceiveMessage(); }
                catch (COMException) { break; }
                catch (Exception e) { Err("sdk-error", "ReceiveMessage failed: " + e.Message); break; }
                if (activity == before) break; // queue empty
            }
        }

        // ---------------------------------------------------------------- SimConnect callbacks (same thread, inside ReceiveMessage)
        void OnOpen(SimConnect sender, SIMCONNECT_RECV_OPEN data)
        {
            activity++;
            opened = true;
            string app = data.szApplicationName + " " + data.dwApplicationVersionMajor + "." + data.dwApplicationVersionMinor +
                         "." + data.dwApplicationBuildMajor + "." + data.dwApplicationBuildMinor;
            Conn("connected", "SimConnect " + data.dwSimConnectVersionMajor + "." + data.dwSimConnectVersionMinor, app);
            Guard("subscribe AircraftLoaded", () => sc.SubscribeToSystemEvent(EVT.AircraftLoaded, "AircraftLoaded"));
            ApplySubscriptions();
        }

        void OnQuit(SimConnect sender, SIMCONNECT_RECV data)
        {
            activity++;
            Log("info", "simulator quit");
            // Do not dispose from inside the callback; flag and let the loop handle it after Drain().
            pendingQuit = true;
        }
        bool pendingQuit;

        void OnAircraftLoaded(SimConnect sender, SIMCONNECT_RECV_EVENT_FILENAME data)
        {
            activity++;
            Log("info", "aircraft loaded; re-requesting variables");
            ApplySubscriptions(); // initial values are delivered again for the new aircraft
        }

        void OnException(SimConnect sender, SIMCONNECT_RECV_EXCEPTION data)
        {
            activity++;
            string name = ((SIMCONNECT_EXCEPTION)data.dwException).ToString();
            string what;
            sentDescriptions.TryGetValue(data.dwSendID, out what);
            if (what != null && what.StartsWith("var:") && data.dwIndex != SIMCONNECT_RECV_EXCEPTION.UNKNOWN_INDEX)
            {
                // mark the variable as failed so it is not retried / does not flood the log
                string id = what.Substring(4);
                int i;
                if (varIndex.TryGetValue(id, out i)) vars[i].Failed = true;
            }
            Err("sdk-error", "SimConnect exception " + name + (what != null ? " while " + what : ""),
                "sendId=" + data.dwSendID + " index=" + data.dwIndex);
        }

        void OnData(SimConnect sender, SIMCONNECT_RECV_SIMOBJECT_DATA data)
        {
            activity++;
            int i = (int)data.dwRequestID - (int)REQ.Base;
            if (i < 0 || i >= vars.Count || data.dwData == null || data.dwData.Length == 0) return;
            var v = vars[i];
            try
            {
                if (v.IsString) batch[v.Id] = ((StrVar)data.dwData[0]).value ?? "";
                else batch[v.Id] = ((NumVar)data.dwData[0]).value;
            }
            catch (Exception e) { Err("sdk-error", "bad data for " + v.Id + ": " + e.Message); }
        }

        void OnEnumerateInputEvents(SimConnect sender, SIMCONNECT_RECV_ENUMERATE_INPUT_EVENTS data)
        {
            activity++;
            var list = new StringBuilder("[");
            bool first = true;
            if (data.rgData != null)
            {
                foreach (var o in data.rgData)
                {
                    var d = (SIMCONNECT_INPUT_EVENT_DESCRIPTOR)o;
                    inputHashes[d.Name] = d.Hash;
                    if (!first) list.Append(',');
                    first = false;
                    list.Append("{\"name\":").Append(Json.Str(d.Name)).Append(",\"hash\":").Append(Json.Str(d.Hash.ToString(CultureInfo.InvariantCulture)))
                        .Append(",\"type\":").Append(Json.Str(d.eType.ToString())).Append('}');
                }
            }
            list.Append(']');
            if (data.dwEntryNumber + 1 >= data.dwOutOf || data.dwOutOf == 0) inputEventsKnown = true;
            if ((REQ)data.dwRequestID == REQ.EnumForDiscovery) Emit("{\"t\":\"inputEvents\",\"list\":" + list + "}");
            if (inputEventsKnown && pendingInputEvents.Count > 0)
            {
                var todo = new List<Tuple<string, double>>(pendingInputEvents);
                pendingInputEvents.Clear();
                foreach (var p in todo) SetInputEvent(p.Item1, p.Item2);
            }
        }

        // ---------------------------------------------------------------- subscriptions
        void ApplySubscriptions()
        {
            if (sc == null || !opened) return;
            for (int i = 0; i < vars.Count; i++)
            {
                var v = vars[i];
                if (v.Failed) continue;
                var def = (DEF)((uint)DEF.Base + (uint)i);
                var req = (REQ)((uint)REQ.Base + (uint)i);
                string desc = "var:" + v.Id;
                int idx = i;
                Guard("define " + v.Name, () =>
                {
                    try { sc.ClearDataDefinition(def); } catch { }
                    sc.AddToDataDefinition(def, v.Name, v.IsString ? null : v.Unit,
                        v.IsString ? SIMCONNECT_DATATYPE.STRING256 : SIMCONNECT_DATATYPE.FLOAT64, 0.0f, uint.MaxValue);
                    Remember(desc);
                    if (v.IsString) sc.RegisterDataDefineStruct<StrVar>(def); else sc.RegisterDataDefineStruct<NumVar>(def);
                    // CHANGED: the simulator only sends when a value differs (plus once initially).
                    sc.RequestDataOnSimObject(req, def, 0u, SIMCONNECT_PERIOD.SIM_FRAME, SIMCONNECT_DATA_REQUEST_FLAG.CHANGED, 0u, 0u, 0u);
                    Remember(desc);
                });
            }
        }

        void Remember(string description)
        {
            try
            {
                uint id = sc.GetLastSentPacketID();
                sentDescriptions[id] = description;
                if (sentDescriptions.Count > 4096) sentDescriptions.Clear();
            }
            catch { }
        }

        void Guard(string what, Action a)
        {
            try { a(); }
            catch (Exception e) { Err("sdk-error", "SimConnect call failed (" + what + "): " + e.Message); }
        }

        // ---------------------------------------------------------------- commands
        void ProcessCommands()
        {
            Dictionary<string, object> c;
            while (commands.TryDequeue(out c))
            {
                try { Handle(c); }
                catch (Exception e) { Err("internal", "command failed: " + e.Message); }
            }
        }

        static string S(Dictionary<string, object> d, string k) { object v; return d.TryGetValue(k, out v) && v != null ? Convert.ToString(v, CultureInfo.InvariantCulture) : null; }
        static double N(Dictionary<string, object> d, string k) { object v; return d.TryGetValue(k, out v) && v != null ? Convert.ToDouble(v, CultureInfo.InvariantCulture) : 0.0; }

        void Handle(Dictionary<string, object> c)
        {
            switch (S(c, "t"))
            {
                case "subscribe": SetSubscriptions(c); break;
                case "event": SendEvent(S(c, "name"), c.ContainsKey("data") ? c["data"] as System.Collections.IList : null); break;
                case "setvar": SetVar(S(c, "var"), N(c, "value")); break;
                case "inputEvent": SetInputEvent(S(c, "name"), N(c, "value")); break;
                case "enumInputEvents":
                    if (sc != null && opened) Guard("enumerate input events", () => sc.EnumerateInputEvents(REQ.EnumForDiscovery));
                    break;
                case "shutdown": RequestStop(); break;
            }
        }

        void SetSubscriptions(Dictionary<string, object> c)
        {
            var list = c.ContainsKey("vars") ? c["vars"] as System.Collections.IList : null;
            var next = new List<VarSpec>();
            if (list != null)
            {
                foreach (var o in list)
                {
                    var d = o as Dictionary<string, object>;
                    if (d == null) continue;
                    next.Add(new VarSpec { Id = S(d, "id"), Name = S(d, "name"), Unit = S(d, "unit"), IsString = S(d, "type") == "str" });
                }
            }
            // stop the previous requests, then rebuild (rare: only when the aircraft profile changes)
            if (sc != null && opened)
            {
                for (int i = 0; i < vars.Count; i++)
                {
                    int k = i;
                    Guard("stop request", () =>
                    {
                        sc.RequestDataOnSimObject((REQ)((uint)REQ.Base + (uint)k), (DEF)((uint)DEF.Base + (uint)k), 0u, SIMCONNECT_PERIOD.NEVER, SIMCONNECT_DATA_REQUEST_FLAG.DEFAULT, 0u, 0u, 0u);
                        sc.ClearDataDefinition((DEF)((uint)DEF.Base + (uint)k));
                    });
                }
            }
            vars = next;
            varIndex.Clear();
            for (int i = 0; i < vars.Count; i++) varIndex[vars[i].Id] = i;
            ApplySubscriptions();
        }

        static uint ToDword(double v) { return unchecked((uint)(int)Math.Round(v)); }

        void SendEvent(string name, System.Collections.IList data)
        {
            if (string.IsNullOrEmpty(name)) return;
            if (sc == null || !opened) { Err("sim-offline", "Simulator not connected; dropped event " + name); return; }
            EVT id;
            if (!eventIds.TryGetValue(name, out id))
            {
                id = (EVT)nextEvent++;
                eventIds[name] = id;
                Guard("map event " + name, () => { sc.MapClientEventToSimEvent(id, name); Remember("event:" + name); });
            }
            uint[] d = new uint[5];
            int n = data == null ? 0 : Math.Min(5, data.Count);
            for (int i = 0; i < n; i++) d[i] = ToDword(Convert.ToDouble(data[i], CultureInfo.InvariantCulture));
            Guard("transmit " + name, () =>
            {
                if (n <= 1)
                    sc.TransmitClientEvent(0u, id, d[0], GROUP.Main, SIMCONNECT_EVENT_FLAG.GROUPID_IS_PRIORITY);
                else
                    sc.TransmitClientEvent_EX1(0u, id, GROUP.Main, SIMCONNECT_EVENT_FLAG.GROUPID_IS_PRIORITY, d[0], d[1], d[2], d[3], d[4]);
                Remember("event:" + name);
            });
        }

        void SetVar(string id, double value)
        {
            int i;
            if (sc == null || !opened || id == null || !varIndex.TryGetValue(id, out i)) { Err("sdk-error", "setvar for unknown or offline variable " + id); return; }
            var v = vars[i];
            if (v.IsString) return;
            var def = (DEF)((uint)DEF.Base + (uint)i);
            Guard("set " + v.Name, () =>
            {
                sc.SetDataOnSimObject(def, 0u, SIMCONNECT_DATA_SET_FLAG.DEFAULT, new NumVar { value = value });
                Remember("set:" + v.Name);
            });
        }

        // Input Events (aircraft specific B: variables). No names are assumed: profiles supply them
        // and `enumInputEvents` lists what the loaded aircraft actually exposes.
        void SetInputEvent(string name, double value)
        {
            if (string.IsNullOrEmpty(name)) return;
            if (sc == null || !opened) { Err("sim-offline", "Simulator not connected; dropped input event " + name); return; }
            ulong hash;
            if (!inputHashes.TryGetValue(name, out hash))
            {
                pendingInputEvents.Add(Tuple.Create(name, value));
                if (!discoveryRequested)
                {
                    discoveryRequested = true;
                    Guard("enumerate input events", () => sc.EnumerateInputEvents(REQ.EnumInputEvents));
                }
                else if (inputEventsKnown)
                {
                    pendingInputEvents.RemoveAt(pendingInputEvents.Count - 1);
                    Err("sdk-error", "Input event not exposed by this aircraft: " + name);
                }
                return;
            }
            Guard("set input event " + name, () => { sc.SetInputEvent(hash, value); Remember("inputEvent:" + name); });
        }
    }

    internal static class Program
    {
        static int Main(string[] args)
        {
            var stdout = new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false)) { AutoFlush = true, NewLine = "\n" };
            var stdin = new StreamReader(Console.OpenStandardInput(), new UTF8Encoding(false));
            var bridge = new Bridge(stdout);
            var reader = new Thread(() => bridge.ReadStdin(stdin)) { IsBackground = true, Name = "stdin" };
            reader.Start();
            Console.CancelKeyPress += (s, e) => { e.Cancel = true; bridge.RequestStop(); };
            try
            {
                bridge.Run();
                return 0;
            }
            catch (Exception e)
            {
                stdout.WriteLine("{\"t\":\"err\",\"code\":\"internal\",\"message\":" + Json.Str("bridge crashed: " + e) + "}");
                return 1;
            }
        }
    }
}

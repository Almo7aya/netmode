using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Threading;
using System.Web.Script.Serialization;

namespace NetmodeOverlay
{
	/// <summary>One second of the game WAN ping as netmode's sampler measured it (Ping null: no reply; Measured
	/// false: the sampler was not pinging that second).</summary>
	sealed class Sample
	{
		public long Ts;
		public double? Ping;
		public bool Measured;
	}

	enum Level { Normal, High, Bad, Unknown }

	/// <summary>What the overlay shows, worked out from the last two minutes.</summary>
	sealed class Reading
	{
		public string Router = "";     // the address asked
		public bool Answering;          // the router answered in the last 5 s
		public bool Running;            // netmode runs there
		public string Wan = "";         // the game WAN's display name
		public bool GameMode;
		public double? Now;             // the latest 1 s ping, or the daemon's average (Fallback)
		public bool Lost;               // the latest 1 s ping got no reply
		public bool Fallback;           // no 1 s pings (yet): Now is the daemon's average of 5 pings
		public double? Median, Jitter, Loss;   // the last 60 s of 1 s pings
		public Level Level = Level.Unknown;
		public List<Sample> Last60 = new List<Sample>();
	}

	/// <summary>Asks netmode on the router for the game WAN ping once a second while Active: GET
	/// /cgi-bin/netmode-ping?since=ts on the LAN (~270 bytes). Asking is what keeps netmode's 1 s ping going (it
	/// stops 10 s after the last ask), so nothing is measured while the overlay is hidden.</summary>
	sealed class Feed
	{
		static readonly JavaScriptSerializer json = new JavaScriptSerializer();
		readonly object gate = new object();
		readonly List<Sample> samples = new List<Sample>();
		readonly AutoResetEvent wake = new AutoResetEvent(false);
		readonly Func<string> configured;   // the router from the settings ("" = the default gateway)
		readonly bool demo;
		string router;
		DateTime lastAnswer = DateTime.MinValue, lastLookup = DateTime.MinValue;
		bool running, game;
		string wan = "";
		double? avgPing, avgLoss;
		long lastTs, serverTs;
		volatile bool active;
		readonly Random rnd = new Random(7);

		public Feed(Func<string> configured, bool demo)
		{
			this.configured = configured;
			this.demo = demo;
		}

		/// <summary>Ask once a second (true) or not at all (false).</summary>
		public bool Active
		{
			get => active;
			set { active = value; if (value) wake.Set(); }
		}

		public void Start() => new Thread(Loop) { IsBackground = true, Name = "netmode feed" }.Start();

		/// <summary>The settings changed the router: look it up again on the next ask.</summary>
		public void Reset()
		{
			lock (gate) { router = null; samples.Clear(); lastTs = 0; lastAnswer = DateTime.MinValue; }
		}

		void Loop()
		{
			while (true)
			{
				if (!active) { wake.WaitOne(); continue; }
				var t0 = DateTime.UtcNow;
				if (demo) DemoTick(); else Ask();
				int wait = 1000 - (int)(DateTime.UtcNow - t0).TotalMilliseconds;
				if (wait > 0) Thread.Sleep(wait);
			}
		}

		void Ask()
		{
			string r;
			lock (gate)
			{
				// the router: the setting, else the default gateway (looked up again while it does not answer)
				if (router == null || (DateTime.UtcNow - lastAnswer).TotalSeconds > 15 && (DateTime.UtcNow - lastLookup).TotalSeconds > 15)
				{
					string c = (configured() ?? "").Trim();
					router = c.Length > 0 ? c : Gateway();
					lastLookup = DateTime.UtcNow;
				}
				r = router;
			}
			if (string.IsNullOrEmpty(r)) return;
			try
			{
				string url = (r.Contains("://") ? r.TrimEnd('/') : "http://" + r) + "/cgi-bin/netmode-ping?since=" + lastTs;
				var req = (HttpWebRequest)WebRequest.Create(url);
				req.Timeout = 2500;
				req.ReadWriteTimeout = 2500;
				req.Proxy = null;   // the LAN: no proxy lookup
				req.UserAgent = "netmode-overlay";
				string body;
				using (var resp = (HttpWebResponse)req.GetResponse())
				using (var sr = new StreamReader(resp.GetResponseStream()))
					body = sr.ReadToEnd();
				Apply(body);
			}
			catch (Exception) { }   // no answer: the reading says so after 5 s
		}

		void Apply(string body)
		{
			if (!(json.DeserializeObject(body) is Dictionary<string, object> d)) return;
			lock (gate)
			{
				lastAnswer = DateTime.UtcNow;
				long now = Long(d, "ts") ?? 0;
				if (now < lastTs - 5) { samples.Clear(); lastTs = 0; }   // the router's clock went back
				serverTs = now;
				running = d.TryGetValue("running", out var rn) && rn is bool b && b;
				if (!running) return;
				wan = Str(d, "label") ?? Str(d, "gw") ?? "";
				game = Str(d, "state") == "game";
				avgPing = avgLoss = null;
				if (d.TryGetValue("avg", out var a) && a is Dictionary<string, object> av)
				{
					avgPing = Num(av, "ping");
					avgLoss = Num(av, "loss");
				}
				if (d.TryGetValue("points", out var p) && p is object[] pts)
					foreach (var o in pts)
						if (o is object[] x && x.Length >= 2 && x[0] != null)
						{
							long ts = Convert.ToInt64(x[0]);
							if (ts <= lastTs) continue;
							samples.Add(new Sample { Ts = ts, Measured = !(x[1] is bool), Ping = x[1] == null || x[1] is bool ? (double?)null : Convert.ToDouble(x[1]) });
							lastTs = ts;
						}
				samples.RemoveAll(s => s.Ts <= now - 120);
			}
		}

		public Reading Read()
		{
			lock (gate)
			{
				var rd = new Reading { Router = router ?? "", Answering = (DateTime.UtcNow - lastAnswer).TotalSeconds < 5 };
				rd.Running = rd.Answering && running;
				if (!rd.Running) return rd;
				rd.Wan = wan;
				rd.GameMode = game;
				rd.Last60 = samples.Where(s => s.Ts > lastTs - 60).ToList();
				var measured = rd.Last60.Where(s => s.Measured).ToList();
				var ok = measured.Where(s => s.Ping != null).Select(s => s.Ping.Value).ToList();
				if (ok.Count >= 5) rd.Median = Median(ok);
				if (measured.Count >= 5) rd.Loss = 100.0 * (measured.Count - ok.Count) / measured.Count;
				if (ok.Count >= 5)
				{
					double j = 0;
					for (int i = 1; i < ok.Count; i++) j += Math.Abs(ok[i] - ok[i - 1]);
					rd.Jitter = j / (ok.Count - 1);
				}

				// a sampler second is written 2 s after it starts (the ping gets 2 s): fresh is up to ~6 s old
				var latest = samples.Count > 0 ? samples[samples.Count - 1] : null;
				if (latest != null && latest.Measured && serverTs - latest.Ts <= 6)
				{
					rd.Now = latest.Ping;
					rd.Lost = latest.Ping == null;
				}
				else if (avgPing != null)
				{
					rd.Now = avgPing;
					rd.Fallback = true;
				}

				// the colour: against the last minute's median, like netmode's spikes (50 ms above the average)
				bool recentLoss = measured.Any(s => s.Ping == null && s.Ts > lastTs - 10) || rd.Fallback && avgLoss > 0;
				if (rd.Lost) rd.Level = Level.Bad;
				else if (rd.Now == null) rd.Level = Level.Unknown;
				else if (rd.Now >= 300 || rd.Median != null && rd.Now >= rd.Median + 50) rd.Level = Level.Bad;
				else if (rd.Median != null && rd.Now >= rd.Median + 25 || recentLoss) rd.Level = Level.High;
				else rd.Level = Level.Normal;
				return rd;
			}
		}

		static double Median(List<double> v)
		{
			var s = v.OrderBy(x => x).ToList();
			int n = s.Count;
			return n % 2 == 1 ? s[n / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
		}

		/// <summary>The default gateway of the first network that is up (the router netmode runs on).</summary>
		static string Gateway()
		{
			try
			{
				foreach (var ni in NetworkInterface.GetAllNetworkInterfaces())
				{
					if (ni.OperationalStatus != OperationalStatus.Up || ni.NetworkInterfaceType == NetworkInterfaceType.Loopback ||
						ni.NetworkInterfaceType == NetworkInterfaceType.Tunnel)
						continue;
					foreach (var g in ni.GetIPProperties().GatewayAddresses)
						if (g.Address.AddressFamily == AddressFamily.InterNetwork && !g.Address.Equals(IPAddress.Any))
							return g.Address.ToString();
				}
			}
			catch (Exception) { }
			return null;
		}

		static string Str(Dictionary<string, object> d, string k) => d.TryGetValue(k, out var v) && v is string s && s.Length > 0 ? s : null;
		static double? Num(Dictionary<string, object> d, string k) => d.TryGetValue(k, out var v) && v != null && !(v is bool) && !(v is string) ? Convert.ToDouble(v) : (double?)null;
		static long? Long(Dictionary<string, object> d, string k) => Num(d, k) is double x ? (long)x : (long?)null;

		// ---- --demo: made-up pings to look at the overlay (never sent anywhere) ----

		void DemoTick()
		{
			lock (gate)
			{
				long now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
				if (lastTs == 0)
					for (long t = now - 60; t < now; t++) samples.Add(DemoSample(t));
				samples.Add(DemoSample(now));
				samples.RemoveAll(s => s.Ts <= now - 120);
				lastTs = serverTs = now;
				lastAnswer = DateTime.UtcNow;
				running = true;
				wan = "Relay";
				game = true;
				router = "demo";
			}
		}

		Sample DemoSample(long t)
		{
			double v = 104 + rnd.NextDouble() * 9;
			if (t % 37 == 0) v += 70;
			return new Sample { Ts = t, Measured = true, Ping = t % 53 == 0 ? (double?)null : v };
		}

		/// <summary>A fixed reading for the snapshots: kind normal, high, lost, fallback, noanswer.</summary>
		public static Reading Fake(string kind)
		{
			var r = new Reading { Router = "192.168.1.1", Answering = kind != "noanswer", Running = kind != "noanswer", Wan = "Relay", GameMode = true };
			if (kind == "noanswer") return r;
			long t0 = 1000;
			var rng = new Random(3);
			for (int i = 0; i < 60; i++)
			{
				double? v = 103 + rng.NextDouble() * 10;
				if (i == 21 || i == 22) v += 90;
				if (kind == "lost" && i == 59) v = null;
				if (kind == "high" && i >= 57) v = 141 + i - 57;
				if (i == 40) v = null;
				r.Last60.Add(new Sample { Ts = t0 + i, Ping = v, Measured = true });
			}
			r.Median = 108; r.Jitter = 4.2; r.Loss = kind == "lost" ? 3.3 : 1.7;
			if (kind == "fallback") { r.Last60.Clear(); r.Median = r.Jitter = r.Loss = null; r.Now = 112; r.Fallback = true; r.Level = Level.Normal; }
			else if (kind == "lost") { r.Lost = true; r.Level = Level.Bad; }
			else if (kind == "high") { r.Now = 143; r.Level = Level.High; }
			else { r.Now = 107; r.Level = Level.Normal; }
			return r;
		}
	}
}

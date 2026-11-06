using System;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Interop;
using System.Windows.Media.Imaging;
using System.Windows.Threading;
using Microsoft.Win32;
using Forms = System.Windows.Forms;
using Media = System.Windows.Media;

namespace NetmodeOverlay
{
	/// <summary>Netmode ping overlay: the game WAN ping that netmode measures on the router, on top of the game.
	/// Lives in the tray; shows (and has the router measure) only while the game runs, unless told otherwise.
	/// Ctrl+Alt+O turns it on and off. Arguments: --demo (made-up pings), --router host (the router, saved),
	/// --snapshot file.png (every state drawn into a picture, nothing shown), --snapshot-live file.png (5 s of the
	/// real router drawn into a picture, nothing shown).</summary>
	static class App
	{
		static Settings set;
		static Feed feed;
		static OverlayWindow win;
		static Forms.NotifyIcon tray;
		static HwndSource keys;
		static bool gameRunning, hotkey;
		static Forms.ToolStripMenuItem miOn, miOnly, miMove, miDetails, miGraph, miRouter, miStartup;
		static Forms.ToolStripMenuItem[] miSizes, miBoxes;
		static readonly double[] Sizes = { 0.8, 1, 1.25, 1.5, 2 };
		static readonly double[] Boxes = { 0, 0.35, 0.55, 0.75 };
		const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";

		[STAThread]
		static void Main(string[] args)
		{
			string Arg(string name) { int i = Array.IndexOf(args, name); return i >= 0 && i + 1 < args.Length ? args[i + 1] : null; }
			if (Arg("--write-icon") is string ico) { WriteIcon(ico); return; }
			if (Arg("--snapshot") is string snap) { SnapshotStates(snap); return; }
			string live = Arg("--snapshot-live");
			bool demo = args.Contains("--demo");

			using (var mutex = new Mutex(true, @"Local\NetmodeOverlay" + (demo ? "Demo" : live != null ? "Snapshot" : ""), out bool first))
			{
				if (!first) return;   // one is running: it is in the tray
				bool fresh = !File.Exists(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "NetmodeOverlay", "settings.json"));
				set = Settings.Load();
				if (Arg("--router") is string r) { set.Router = r; set.Save(); }
				var app = new Application { ShutdownMode = ShutdownMode.OnExplicitShutdown };
				app.DispatcherUnhandledException += (s, e) => e.Handled = true;   // an overlay must not pop up errors over a game
				feed = new Feed(() => set.Router, demo);
				feed.Start();

				if (live != null)
				{
					feed.Active = true;
					var t = new DispatcherTimer { Interval = TimeSpan.FromSeconds(6) };
					t.Tick += (s, e) => { t.Stop(); SnapshotLive(live); app.Shutdown(); };
					t.Start();
					app.Run();
					return;
				}

				win = new OverlayWindow(set);
				win.MovingChanged += () => { Menu(); Tick(); };
				tray = new Forms.NotifyIcon { Icon = TrayIcon(), Text = "Netmode ping overlay", ContextMenuStrip = BuildMenu(), Visible = true };
				tray.DoubleClick += (s, e) => Toggle();
				Hotkey();
				Menu();

				var ui = new DispatcherTimer { Interval = TimeSpan.FromSeconds(1) };
				ui.Tick += (s, e) => Tick();
				ui.Start();
				var games = new DispatcherTimer { Interval = TimeSpan.FromSeconds(3) };
				games.Tick += (s, e) => CheckGame();
				games.Start();
				CheckGame();
				Tick();
				if (fresh || demo)
					tray.ShowBalloonTip(6000, "Netmode ping overlay", (set.OnlyWithGame && !demo ? "It shows over THE FINALS while the game runs. " : "") +
						"Ctrl+Alt+O turns it on and off; right-click this icon to move it or change its size.", Forms.ToolTipIcon.Info);
				app.Run();

				feed.Active = false;
				tray.Visible = false;
				tray.Dispose();
				keys?.Dispose();
			}
		}

		/// <summary>Once a second: show or hide the overlay, and ask the router only while it shows.</summary>
		static void Tick()
		{
			bool show = win.Moving || set.Enabled && (!set.OnlyWithGame || gameRunning);
			feed.Active = show;
			var r = feed.Read();
			if (show)
			{
				win.View.Show(r);
				if (!win.IsVisible) win.Show();
			}
			else if (win.IsVisible) win.Hide();
			string state = !set.Enabled ? "off (Ctrl+Alt+O)" : !show ? "waiting for the game" : r.Lost ? "lost" : r.Now != null ? Math.Round(r.Now.Value) + " ms" : "…";
			string text = "Netmode overlay · " + state;
			tray.Text = text.Length > 63 ? text.Substring(0, 63) : text;
			if (miRouter != null)
				miRouter.Text = "Router: " + (string.IsNullOrEmpty(r.Router) ? "looking…" : r.Router) + (set.Router.Length == 0 ? " (default gateway)" : "") +
					(show ? (r.Running ? " · netmode answers" : r.Answering ? " · netmode is not running" : " · no answer") : "");
		}

		static void CheckGame()
		{
			bool was = gameRunning;
			try
			{
				var ps = Process.GetProcessesByName(set.Game);
				gameRunning = ps.Length > 0;
				foreach (var p in ps) p.Dispose();
			}
			catch (Exception) { gameRunning = false; }
			if (was != gameRunning) Tick();
		}

		static void Toggle()
		{
			set.Enabled = !set.Enabled;
			set.Save();
			Menu();
			Tick();
		}

		// ---- the tray menu ----

		static Forms.ContextMenuStrip BuildMenu()
		{
			var m = new Forms.ContextMenuStrip();
			miOn = Item(m, "Show the ping overlay (Ctrl+Alt+O)", Toggle);
			miOnly = Item(m, "Only while THE FINALS runs", () => { set.OnlyWithGame = !set.OnlyWithGame; Changed(); });
			m.Items.Add(new Forms.ToolStripSeparator());
			miMove = Item(m, "Move the overlay", () => win.SetMoving(!win.Moving));
			var size = new Forms.ToolStripMenuItem("Size");
			miSizes = Sizes.Select(v => Sub(size, v == 1 ? "Normal" : Math.Round(v * 100) + " %", () => { set.Scale = v; Changed(); })).ToArray();
			m.Items.Add(size);
			var box = new Forms.ToolStripMenuItem("Background");
			miBoxes = Boxes.Select((v, i) => Sub(box, new[] { "None (text shadow only)", "Light", "Medium", "Dark" }[i], () => { set.Backdrop = v; Changed(); })).ToArray();
			m.Items.Add(box);
			miDetails = Item(m, "Game WAN, loss and jitter line", () => { set.Details = !set.Details; Changed(); });
			miGraph = Item(m, "Last 60 s graph", () => { set.Graph = !set.Graph; Changed(); });
			m.Items.Add(new Forms.ToolStripSeparator());
			miRouter = Item(m, "Router: …", null);
			miRouter.Enabled = false;
			Item(m, "Open the netmode dashboard", () =>
			{
				var r = feed.Read().Router;
				if (string.IsNullOrEmpty(r) || r == "demo") return;
				string b = r.Contains("://") ? r.TrimEnd('/') : "http://" + r;
				try { Process.Start(new ProcessStartInfo(b + "/cgi-bin/luci/admin/services/netmode/dashboard") { UseShellExecute = true })?.Dispose(); } catch (Exception) { }
			});
			miStartup = Item(m, "Start with Windows", () => Startup(!Startup()));
			m.Items.Add(new Forms.ToolStripSeparator());
			Item(m, "Quit", () => Application.Current.Shutdown());
			m.Opening += (s, e) => Menu();
			return m;
		}

		static void Changed()
		{
			set.Save();
			win.Configure();
			Menu();
			Tick();
		}

		static void Menu()
		{
			if (miOn == null) return;
			miOn.Checked = set.Enabled;
			miOnly.Checked = set.OnlyWithGame;
			miMove.Text = win.Moving ? "Lock the overlay here" : "Move the overlay";
			miDetails.Checked = set.Details;
			miGraph.Checked = set.Graph;
			for (int i = 0; i < Sizes.Length; i++) miSizes[i].Checked = Math.Abs(set.Scale - Sizes[i]) < 0.01;
			for (int i = 0; i < Boxes.Length; i++) miBoxes[i].Checked = Math.Abs(set.Backdrop - Boxes[i]) < 0.01;
			miStartup.Checked = Startup();
			miOn.Text = "Show the ping overlay" + (hotkey ? " (Ctrl+Alt+O)" : "");
		}

		static Forms.ToolStripMenuItem Item(Forms.ContextMenuStrip m, string text, Action a)
		{
			var i = new Forms.ToolStripMenuItem(text);
			if (a != null) i.Click += (s, e) => a();
			m.Items.Add(i);
			return i;
		}

		static Forms.ToolStripMenuItem Sub(Forms.ToolStripMenuItem parent, string text, Action a)
		{
			var i = new Forms.ToolStripMenuItem(text);
			i.Click += (s, e) => a();
			parent.DropDownItems.Add(i);
			return i;
		}

		static bool Startup()
		{
			try { using (var k = Registry.CurrentUser.OpenSubKey(RunKey)) return k?.GetValue("NetmodeOverlay") != null; }
			catch (Exception) { return false; }
		}

		static void Startup(bool on)
		{
			try
			{
				using (var k = Registry.CurrentUser.CreateSubKey(RunKey))
					if (on) k.SetValue("NetmodeOverlay", "\"" + System.Reflection.Assembly.GetEntryAssembly().Location + "\"");
					else k.DeleteValue("NetmodeOverlay", false);
			}
			catch (Exception) { }
			Menu();
		}

		// ---- Ctrl+Alt+O, on a message-only window ----

		static void Hotkey()
		{
			keys = new HwndSource(new HwndSourceParameters("NetmodeOverlayKeys") { ParentWindow = new IntPtr(-3), WindowStyle = 0 });
			keys.AddHook((IntPtr h, int msg, IntPtr w, IntPtr l, ref bool handled) =>
			{
				if (msg == 0x0312 && w.ToInt64() == 1) { Toggle(); handled = true; }   // WM_HOTKEY
				return IntPtr.Zero;
			});
			hotkey = RegisterHotKey(keys.Handle, 1, 0x1 | 0x2 | 0x4000, 0x4F);   // Alt + Ctrl, no repeat, O
		}

		[DllImport("user32.dll")] static extern bool RegisterHotKey(IntPtr h, int id, uint mods, uint vk);

		// ---- snapshots: draw into a picture, show nothing ----

		static void SnapshotStates(string file)
		{
			var s = new Settings();
			var panel = new StackPanel { Margin = new Thickness(18) };
			void Add(string kind, double box, bool moving)
			{
				s.Backdrop = box;
				var v = new OverlayView { HorizontalAlignment = HorizontalAlignment.Left, Margin = new Thickness(0, 0, 0, 14) };
				v.Configure(s, moving);
				v.Show(Feed.Fake(kind));
				panel.Children.Add(v);
			}
			Add("normal", 0.55, false);
			Add("high", 0.55, false);
			Add("lost", 0.55, false);
			Add("fallback", 0.55, false);
			Add("noanswer", 0.55, false);
			Add("normal", 0, false);
			Add("normal", 0.55, true);
			Render(Scene(panel), file);
		}

		static void SnapshotLive(string file)
		{
			var r = feed.Read();
			var v = new OverlayView { HorizontalAlignment = HorizontalAlignment.Left, Margin = new Thickness(18) };
			v.Configure(set, false);
			v.Show(r);
			Render(Scene(v), file);
			File.WriteAllText(Path.ChangeExtension(file, ".txt"), string.Join("\r\n", new[]
			{
				$"router {r.Router} answering {r.Answering} running {r.Running} wan {r.Wan} game {r.GameMode}",
				$"now {r.Now} lost {r.Lost} fallback {r.Fallback} median {r.Median} jitter {r.Jitter} loss {r.Loss} level {r.Level}",
				"last60 " + string.Join(" ", r.Last60.Select(p => p.Measured ? (p.Ping?.ToString("0") ?? "x") : "n")),
			}));
		}

		/// <summary>Light sky over dark ground, to judge it over bright and dark parts of a game.</summary>
		static FrameworkElement Scene(UIElement content) => new Border
		{
			Background = new Media.LinearGradientBrush(Media.Color.FromRgb(0xb9, 0xcf, 0xe0), Media.Color.FromRgb(0x35, 0x3a, 0x33), 90),
			Child = content,
		};

		static void Render(FrameworkElement root, string file)
		{
			root.Measure(new System.Windows.Size(double.PositiveInfinity, double.PositiveInfinity));
			root.Arrange(new Rect(root.DesiredSize));
			root.UpdateLayout();
			var bmp = new RenderTargetBitmap((int)Math.Ceiling(root.ActualWidth), (int)Math.Ceiling(root.ActualHeight), 96, 96, Media.PixelFormats.Pbgra32);
			bmp.Render(root);
			var enc = new PngBitmapEncoder();
			enc.Frames.Add(BitmapFrame.Create(bmp));
			using (var f = File.Create(file)) enc.Save(f);
		}

		// ---- the icon: a ping line with a dot, on dark ----

		static Bitmap Draw(int size)
		{
			var bmp = new Bitmap(size, size);
			using (var g = Graphics.FromImage(bmp))
			{
				g.SmoothingMode = SmoothingMode.AntiAlias;
				using (var bg = new SolidBrush(Color.FromArgb(0x1d, 0x23, 0x2b)))
				using (var path = Rounded(new RectangleF(0, 0, size - 1, size - 1), size * 0.22f))
					g.FillPath(bg, path);
				float s = size;
				var line = new[] { new PointF(s * .14f, s * .62f), new PointF(s * .32f, s * .62f), new PointF(s * .42f, s * .30f),
					new PointF(s * .54f, s * .74f), new PointF(s * .64f, s * .52f), new PointF(s * .74f, s * .52f) };
				using (var pen = new Pen(Color.White, Math.Max(1.5f, s * 0.085f)) { LineJoin = LineJoin.Round, StartCap = LineCap.Round, EndCap = LineCap.Round })
					g.DrawLines(pen, line);
				float d = s * 0.2f;
				using (var dot = new SolidBrush(Color.FromArgb(0x3d, 0xd6, 0x8c)))
					g.FillEllipse(dot, s * .74f - d / 2 + s * 0.04f, s * .52f - d / 2, d, d);
			}
			return bmp;
		}

		static GraphicsPath Rounded(RectangleF r, float radius)
		{
			var p = new GraphicsPath();
			float d = radius * 2;
			p.AddArc(r.X, r.Y, d, d, 180, 90);
			p.AddArc(r.Right - d, r.Y, d, d, 270, 90);
			p.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90);
			p.AddArc(r.X, r.Bottom - d, d, d, 90, 90);
			p.CloseFigure();
			return p;
		}

		static Icon TrayIcon() => Icon.FromHandle(Draw(32).GetHicon());

		static void WriteIcon(string file)
		{
			// an .ico with PNG images: header, one 16-byte entry per size, then the images
			var sizes = new[] { 16, 20, 24, 32, 40, 48, 64, 256 };
			var pngs = sizes.Select(s => { using (var b = Draw(s)) using (var ms = new MemoryStream()) { b.Save(ms, System.Drawing.Imaging.ImageFormat.Png); return ms.ToArray(); } }).ToArray();
			using (var w = new BinaryWriter(File.Create(file)))
			{
				w.Write((short)0); w.Write((short)1); w.Write((short)sizes.Length);
				int offset = 6 + 16 * sizes.Length;
				for (int i = 0; i < sizes.Length; i++)
				{
					w.Write((byte)(sizes[i] >= 256 ? 0 : sizes[i])); w.Write((byte)(sizes[i] >= 256 ? 0 : sizes[i]));
					w.Write((byte)0); w.Write((byte)0); w.Write((short)1); w.Write((short)32);
					w.Write(pngs[i].Length); w.Write(offset);
					offset += pngs[i].Length;
				}
				foreach (var p in pngs) w.Write(p);
			}
		}
	}
}

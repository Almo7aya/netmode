using System;
using System.Collections.Generic;
using System.IO;
using System.Web.Script.Serialization;

namespace NetmodeOverlay
{
	/// <summary>The overlay's settings, in %APPDATA%\NetmodeOverlay\settings.json (all of them in the tray menu but
	/// Router and Game, which only the file sets).</summary>
	sealed class Settings
	{
		public string Router = "";        // "" = the default gateway; else an address or http://host:port
		public string Game = "Discovery"; // the game's process: THE FINALS is Discovery.exe
		public bool Enabled = true;       // the overlay is on (Ctrl+Alt+O)
		public bool OnlyWithGame = true;  // shown (and the ping measured) only while the game runs
		public bool Details = true;       // the game WAN, loss and jitter under the ping
		public bool Graph = true;         // the last 60 s next to it
		public double Scale = 1;
		public double Backdrop = 0.55;    // the dark box behind it (0: none, the text keeps a shadow)
		public double X = double.NaN, Y = double.NaN;   // top left, in device-independent pixels

		static string Dir => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "NetmodeOverlay");
		static string FilePath => Path.Combine(Dir, "settings.json");

		public static Settings Load()
		{
			var s = new Settings();
			try
			{
				if (File.Exists(FilePath) && new JavaScriptSerializer().DeserializeObject(File.ReadAllText(FilePath)) is Dictionary<string, object> d)
				{
					s.Router = Str(d, "router", s.Router);
					s.Game = Str(d, "game", s.Game);
					s.Enabled = Bool(d, "enabled", s.Enabled);
					s.OnlyWithGame = Bool(d, "onlyWithGame", s.OnlyWithGame);
					s.Details = Bool(d, "details", s.Details);
					s.Graph = Bool(d, "graph", s.Graph);
					s.Scale = Math.Max(0.5, Math.Min(3, Num(d, "scale", s.Scale)));
					s.Backdrop = Math.Max(0, Math.Min(1, Num(d, "backdrop", s.Backdrop)));
					s.X = Num(d, "x", s.X);
					s.Y = Num(d, "y", s.Y);
				}
			}
			catch (Exception) { }   // a broken file: the defaults
			return s;
		}

		public void Save()
		{
			try
			{
				Directory.CreateDirectory(Dir);
				var d = new Dictionary<string, object>
				{
					["router"] = Router, ["game"] = Game, ["enabled"] = Enabled, ["onlyWithGame"] = OnlyWithGame,
					["details"] = Details, ["graph"] = Graph, ["scale"] = Scale, ["backdrop"] = Backdrop,
				};
				if (!double.IsNaN(X) && !double.IsNaN(Y)) { d["x"] = Math.Round(X); d["y"] = Math.Round(Y); }
				File.WriteAllText(FilePath, new JavaScriptSerializer().Serialize(d));
			}
			catch (Exception) { }
		}

		static string Str(Dictionary<string, object> d, string k, string def) => d.TryGetValue(k, out var v) && v is string s ? s : def;
		static bool Bool(Dictionary<string, object> d, string k, bool def) => d.TryGetValue(k, out var v) && v is bool b ? b : def;
		static double Num(Dictionary<string, object> d, string k, double def) =>
			d.TryGetValue(k, out var v) && v != null && !(v is bool) && !(v is string) ? Convert.ToDouble(v) : def;
	}
}

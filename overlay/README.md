# Netmode ping overlay

A small Windows app that puts netmode's **game WAN ping** on top of the game: the same 1 s pings as the
dashboard's *Ping now*, measured on the router through the game WAN.

```
 107 ms  ‿‿‿╱╲‿‿‿|‿‿•
 Relay · loss 1.7 % · jitter 4 ms
```

- **The number**: the latest 1 s ping, in white as usual, **amber** when it is 25 ms over the last minute's median
  (or a ping was lost in the last 10 s), **red** at 50 ms over it, at 300 ms or more, and *lost* when the router got
  no reply. Netmode's 1 s ping reaches the overlay about 2 s after it was sent (each ping gets 2 s to answer).
- **The line**: the last 60 s against their median (dashed); a red bar is a lost ping.
- **Under it**: the game WAN, loss and jitter over the last minute. Before the first 1 s pings arrive it shows the
  daemon's average of 5 pings every 10 s.

It sits in the tray and shows only while THE FINALS (`Discovery.exe`) runs. **Ctrl+Alt+O** turns it on and off;
double-clicking the tray icon does too. The tray menu moves it (drag it, right-click to lock), sizes it, sets the
box behind it and starts it with Windows.

## How it works

- It asks the router once a second, on the LAN, for `GET /cgi-bin/netmode-ping?since=<ts>` (~270 bytes): no login,
  read-only, it says no more than the ping, the game WAN and the mode. The router is the PC's default gateway
  unless `router` is set in the settings.
- Asking is what keeps netmode's 1 s ping going (it stops 10 s after the last ask), so the ping costs mobile data
  only while the overlay shows: about 0.6 MB an hour, as with a dashboard open. An open dashboard also fetches the
  relay's status every 2 s; the overlay does not.
- The window is a separate always-on-top window: clicks go through it, it never takes the focus, it is not in
  Alt+Tab or the taskbar, and it never touches the game's process (no injection, no reading its memory; it only
  looks for its name in the process list). It shows over games in borderless / windowed full screen and over
  DirectX 12 full screen (THE FINALS); a game in exclusive full screen (DirectX 11 and older) covers it.

## Build and run

```powershell
.\build.ps1                      # dist\NetmodeOverlay.exe (.NET Framework 4.8, part of Windows 10/11)
.\dist\NetmodeOverlay.exe
```

The C# compiler comes from the .NET SDK and compiles against the Framework's own assemblies; nothing is
downloaded. No administrator rights.

| Argument | |
|---|---|
| `--router 192.168.1.1` | the router (saved; `""` in the settings file = the default gateway) |
| `--demo` | made-up pings, to look at it without a router |
| `--snapshot file.png` | draw every state into a picture and quit (nothing shown) |
| `--snapshot-live file.png` | draw 6 s of the real router into a picture (+ a .txt with the numbers) and quit |

Settings: `%APPDATA%\NetmodeOverlay\settings.json` (`router`, `game` — the process name, `Discovery` — and what
the tray menu sets).

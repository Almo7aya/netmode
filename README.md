# netmode

**Game mode for multi-WAN OpenWrt routers.** While someone plays, their game traffic gets a WAN of its own and
everybody else moves to the other WANs — so downloads, streams and video calls can't queue in front of game
packets. When nobody plays, everyone shares every WAN again.

netmode sits on top of [mwan3](https://openwrt.org/docs/guide-user/network/wan/multiwan/mwan3): it builds its own
mwan3 policies and rules and flips them with ipsets, so switching is instant and needs no mwan3 restart. It comes
with a LuCI dashboard (live graphs, controls, a full-screen monitor), match reports, a settings page and an
optional Telegram bot.

It was built for a Raspberry Pi 4 running OpenWrt 24.10 in front of several 4G routers, where the WANs are
plentiful but each one's latency collapses as soon as somebody downloads on it.

## How it works

| | 🎮 Game mode (a gaming device is playing) | 🚀 All-WANs mode (otherwise) |
|---|---|---|
| Gaming devices' game traffic (UDP) | **the game WAN** (other WANs only as fallback) | the game WAN (ready for the next match) |
| Everyone else, plus the gaming devices' TCP / QUIC | **every WAN except the game WAN** | **every WAN** |

(With `game_all_traffic` on, *everything* the gaming devices send uses the game WAN, so a game's backend and its
match server see the same public IP.)

- **Detection** — every 10 s netmode reads the gaming devices' UDP uploads from conntrack (DNS, NTP, QUIC/443,
  SSDP/mDNS and LAN traffic don't count). From 8 KB per 10 s a device counts as playing: launching the game and its
  lobby already start game mode, so nothing switches while a match loads. Game mode ends 100 s after the last busy
  interval. UDP that isn't a game (`game_ignore`, by default Discord voice calls) doesn't count.
- **Choosing the game WAN** — netmode learns each match's server (the flow that moves ≥ 100 KB in 10 s) and looks
  up its cloud region in Google Cloud's and AWS's published address ranges. It then compares the WANs by the
  **round trip to that region** through each of them (HTTPS requests to Google's per-region test endpoint, or TCP
  handshakes with the AWS region) — a fair comparison for every WAN, a relay abroad included. For servers
  elsewhere it falls back to ping (the server, or the last router in front of it that answers, or
  `default_target`). Score = 20th-percentile round trip + 2 × loss %.
- **Switching** — `auto` switches only between matches, after another candidate has been ≥ 15 ms better for 3
  rounds in a row. You can **pick a WAN yourself** at any time: it applies at once and moves running matches
  there (their conntrack entries are dropped and the game reconnects through the new WAN — expect a freeze of
  about a second). During a match, when another candidate is clearly faster, netmode asks on Telegram with a
  **Switch** button (`match_switch ask`), switches by itself (`auto`), or waits for the match to end (`off`).
- **Match reports** — per device, while it uploads ≥ 50 KB per 10 s (well above lobby and loading traffic; a
  match ends after 30 s below that): length, game WAN, the game server's cloud (Google Cloud / AWS) and region,
  average / min / max ping, jitter, loss, spikes (≥ 50 ms above the match average), data up and down, the ping
  over the match, and the loading burst: the UDP download from 3 min before the match to 2 min into it, when it
  reaches 300 KB/s (a map download that can choke a mobile link). A table compares the clouds.
- **Live data** — a sampler records each gaming device's UDP upload and download every second (last 15 min) and,
  while a dashboard is open, pings through the game WAN once per second; the daemon keeps 3 h of 10 s points and
  every probe round.

## Mobile data

Measurements cost data on metered WANs, so netmode measures at full rate only while it's useful — someone plays
(or a match runs, or game mode is forced on) or a Dashboard / Monitor page is open:

| | Active | Otherwise |
|---|---|---|
| WAN probe rounds (~12 KB per WAN for a Google Cloud region, ~1 KB for AWS, 10 small pings otherwise) | every 60 s | every 15 min |
| 1 ping per second for the live graph (~0.6 MB/h) | while a dashboard is open | off |
| 5 pings every 10 s for match reports and lag alerts (~0.3 MB/h) | yes | off |
| Telegram bot (~8 KB per poll) | long polling | one check every 5 min (~2 MB/day) |

On a router with five LTE WANs that is about 10 MB a day idle and 5–7 MB per hour of play.

## Telegram bot

1. Create a bot with [@BotFather](https://t.me/BotFather) and copy its token.
2. In **Services → Netmode → Settings → Notifications**, switch the bot on, enter the token, add your Telegram
   `@username` under **Allowed users**, choose the events and save.
3. Open a private chat with your bot and send `/start`. The bot pairs with you: that chat becomes the one it
   talks to, and your numeric user id is added to the allowed users (usernames can change, ids can't).

Instead of pairing you can enter a chat id yourself (a user id, a negative group id or `@channelname`).
The bot (`netmode-bot`, ucode) only answers in that chat, to the allowed users. It long-polls Telegram, so it
needs no open port; it listens continuously while someone plays or within 10 minutes of being used, and checks
every 5 minutes otherwise.

| Command | |
|---|---|
| `/status` | mode, game WAN, ping, who's playing — with buttons for the mode and the game WAN |
| `/mode auto\|game\|all` | set the mode |
| `/wan <name>\|auto` | switch the game WAN now (an auto game WAN stays auto) or let netmode pick |
| `/pings` | the latest round trip through every WAN (to the game region when known) |
| `/matches [n]` | the last match reports |
| `/mute [minutes]`, `/unmute` | pause / resume notifications |

Messages it sends:

```
🎮 Game mode on — PC playing
Game WAN: wan4 (94 ms). Everyone else is on the other WANs.

💡 wan1 is faster than the game WAN wan4 right now: wan1 (92 ms) vs wan4 (140 ms) for the last 3 probe rounds.
Switch the running match? The game freezes for about a second.
[ Switch to wan1 (92 ms) ]  [ Keep wan4 ]

⚠️ Lag on the game WAN wan4 during the match: 820 ms, 20 % loss (bad for the last 30 s).
Fastest other WAN: wan2 (85 ms). Switch the running match? The game freezes for about a second.
[ Switch to wan2 (85 ms) ]  [ Keep wan4 ]

🏁 Match over — PC: 23 min on wan4, server in Warsaw
Ping 96 ms avg (88–160), jitter 4.1 ms, loss 0.0 %, 2 spikes
Data 48.2 MB
```

Buttons expire after 10 minutes; **Keep** silences suggestions for 15 minutes. Changes made from the chat are
confirmed in place (the message is edited), changes made in LuCI or on the router are reported as such.
`netmode-bot --status` posts the status message from the router (e.g. from cron). The token is stored only in
`/etc/config/netmode` on the router.

## A relay as a game WAN

A tunnel to a server abroad (for example WireGuard through [engarde](https://github.com/porech/engarde), which
sends every packet over two WANs at once) can be offered as a game WAN without carrying anyone else's traffic:

1. Make the tunnel an mwan3 interface (e.g. `relay`, tracked through the tunnel) in a firewall zone with NAT.
2. In **Settings → General**: add it to **WANs** and to **Game-only WANs**, and under **Depends on** list the WANs it
   rides on (e.g. `relay:wan1,wan4`), so that while it is the game WAN everyone else stays off those too.

It then appears as a game-WAN button (Dashboard, Monitor, Telegram) and in the probe rounds; `auto` only picks it
when it is listed under **Auto candidates**. A relay never adds bandwidth (engarde duplicates rather than bonds)
and adds the detour to the server's latency; what it can buy is resilience against one link's spikes or loss.

## LuCI

- **Status → Overview → Network mode** — the current mode, mode buttons (Auto / Game / All WANs), game-WAN buttons
  with each WAN's latest round trip, and a one-line summary.
- **Services → Netmode → Dashboard** — state, controls, live tiles and the graphs, refreshed every second:
  game-WAN ping (1 s pings with a 10 s median), each gaming device's UDP upload and download (10 s averages, the
  upload against the game-mode and match thresholds), and every WAN's round trip to the game region; 5 min to 3 h,
  one crosshair across all of them. WANs show their display names (`label`).
- **Services → Netmode → Monitor** — the same live board in full screen for a second (wide) monitor: LuCI's menus
  are hidden and the charts are sized to the window, so everything fits without scrolling (press F11 for a full
  browser window; ✕ goes back).
- **Services → Netmode → Match reports** — median ping per game WAN, a dot per match, the full list with each
  match's server region, filter by device.
- **Services → Netmode → Settings** — everything below, including picking the gaming devices from the LAN's known hosts.

## Requirements

- OpenWrt (tested on 24.10) with `mwan3`, `ipset`, `conntrack`, `jsonfilter`, `rpcd`, `curl`, ucode and LuCI:
  `opkg install mwan3 ipset conntrack curl`
- mwan3 interfaces already set up (netmode uses them as they are).
- Static IPs (or static leases) for the gaming devices.

netmode owns the mwan3 sections named `nm_*` and **replaces the rule `default_rule_v4`** (it is re-created last, so
rules you placed before it keep priority). The mwan3 config is backed up to `/etc/netmode/backup/` on every install.

## Install

From Windows (PowerShell) or Linux/macOS, with ssh key access to the router as root:

```sh
./deploy.ps1 -Router root@192.168.1.1 -DryRun   # print the mwan3 rules it would build (on a copy of the config)
./deploy.ps1 -Router root@192.168.1.1           # install / upgrade

DRYRUN=1 ./deploy.sh root@192.168.1.1
./deploy.sh root@192.168.1.1
```

Both also read the router from `NETMODE_ROUTER`. By hand: copy `files/`, `install.sh` and `uninstall.sh` to the
router and run `sh install.sh`.

The first install lists every enabled mwan3 interface as a WAN and takes the WAN weights from the policy
`default_rule_v4` used before. Then open **Services → Netmode → Settings** and pick your gaming devices.
Upgrades keep `/etc/config/netmode` and `/etc/netmode/`. The cloud address ranges for the region lookup are
downloaded on first use and refreshed weekly (`/usr/libexec/netmode/regions update`).

**Uninstall:** `sh uninstall.sh` on the router (`default_rule_v4` then points at a plain `balanced_all` policy over
the same WANs); `PURGE=1 sh uninstall.sh` also deletes the settings and match reports.

## Command line (on the router)

```
netmode status              what is active and the latest measurements
netmode auto | game | all   mode
netmode gw auto | <wan>     game WAN: automatic, or lock one now
netmode matches [n]         the last n match reports
/usr/libexec/netmode/regions lookup <ip>   which cloud region a server is in
```

## Settings

`/etc/config/netmode`, section `main` (the daemon re-reads it every interval; LuCI and the CLI apply changes at once):

| Option | Default | Meaning |
|---|---|---|
| `mode` | `auto` | `auto` / `game` (always) / `all` (never) |
| `game_ip` (list) | — | gaming devices; changing it rebuilds the mwan3 rules |
| `game_all_traffic` | `0` | `1`: all of the gaming devices' traffic on the game WAN (one public IP; their downloads share it) |
| `gw_mode` | `auto` | `auto`, or a WAN name to lock the game WAN |
| `wans` (list) | every mwan3 interface | WANs netmode balances and can use as the game WAN |
| `game_only` (list) | — | WANs (e.g. a relay) that can be the game WAN but never carry anyone else's traffic |
| `depends` (list) | — | `relay:wan1,wan4`: while relay is the game WAN, everyone else also avoids wan1 and wan4 |
| `cands` (list) | the normal `wans` | WANs `auto` chooses from |
| `weight` (list) | 1 each | load-balancing weight, `wan:weight` (e.g. `wan1:4`) |
| `label` (list) | interface names | display names for the dashboard, match reports and Telegram, `wan:name` (e.g. `wan1:Fibre`) |
| `relay_status` (list) | — | `wan:url` of a relay's status page (JSON: `cap`, `floor`, `ceiling`, `sending` in kbit/s, `ping`, `baseline` in ms, `busy`), shown as a tile while that relay is the game WAN; fetched every 2 s while a dashboard is open |
| `move_flows` | `1` | move running matches when the game WAN changes |
| `thresh` | `8000` | UDP bytes uploaded per interval that start game mode |
| `game_ignore` (list) | `:19294-19344` | the gaming devices' UDP that isn't a game, as `address[/bits]`, `:port[-port]` or both: not counted for game mode or the match reports, and kept off the game WAN (the default is Discord voice calls) |
| `match_thresh` | `50000` | UDP bytes per interval that count as a match (reports) |
| `interval` | `10` | seconds between measurements |
| `hold` | `100` | seconds game mode stays on after the last busy interval |
| `learn_min` | `100000` | bytes per interval before a flow is taken as the game server |
| `region_probe` | `1` | compare the WANs by the round trip to the game server's cloud region (Google Cloud / AWS) |
| `probe_every` / `idle_probe` | `60` / `900` | seconds between probe rounds while active / otherwise |
| `margin` / `rounds` | `15` / `3` | the auto-switch rule |
| `default_target` | `8.8.8.8` | ping target when nothing better answers |
| `live_ping` | `1` | pings through the game WAN for the graphs and match reports (while active) |
| `min_match` / `keep_matches` | `60` / `200` | match reports |
| `match_switch` | `ask` | during a match, when another candidate is clearly faster: `ask` (Telegram button), `auto` (switch; auto game WAN only), `off` |
| `telegram` | `0` | Telegram bot on / off |
| `telegram_token` / `telegram_chat` | — | bot token (from @BotFather) and chat id (set by pairing) |
| `telegram_user` (list) | — | `@usernames` / user ids allowed to use the bot and to pair a private chat (empty: anyone in the chat) |
| `notify` (list) | `mode gw match alert suggest` | events to send: `mode`, `gw`, `match`, `alert`, `suggest`, `start` |
| `alert_ping` / `alert_loss` / `alert_after` / `alert_cooldown` | `200` / `20` / `3` / `300` | lag alert: ping ms or loss % for N intervals during a match; at most one per cooldown s |

## API

rpcd object `netmode` (`ubus call netmode <method>`), used by the LuCI pages:

| Method | Returns |
|---|---|
| `status` | mode, game WAN, devices (`ip`, `name`, `udp`, `playing`), live ping, game region and probe method, probe results, current match |
| `live {"since": ts}` | 1 s points: `[ts, ping, state, gw, {ip: bytes}]` (ping `null`: no reply, `false`: not measured; last 15 min) — also marks a dashboard as open |
| `history {"since": ts}` | 10 s points `[ts, udp, ping, loss, state, gw, {ip: bytes}]` and probe rounds `[ts, {wan: p20}]` (last 3 h) |
| `matches {"limit": n}` | match reports, newest first |
| `set {"mode": …}` / `set {"gw": …}` | change the mode / lock the game WAN (`auto` frees it); `"now": true` switches without locking |
| `clear_matches` | delete the match reports |
| `notify_test` | send a Telegram test message with the saved settings |

## Layout

```
files/                                         installed as-is on the router
├── etc/config/netmode                         default settings (kept on upgrade)
├── etc/init.d/netmode                         procd service: daemon + sampler + bot (START=18, before mwan3)
├── usr/sbin/netmode-daemon                    detection, game-WAN choice, probes, match reports
├── usr/sbin/netmode-sampler                   1 s samples for the live graphs
├── usr/sbin/netmode-bot                       Telegram commands and buttons (ucode)
├── usr/sbin/netmode                           command line
├── usr/lib/netmode/common.sh                  shared shell functions
├── usr/libexec/netmode/mwan3-rules            builds / removes the mwan3 policies and rules
├── usr/libexec/netmode/regions                cloud region lookup (ucode)
├── usr/libexec/netmode/notify                 Telegram sender
├── usr/libexec/rpcd/netmode                   ubus API
├── usr/share/rpcd/acl.d/luci-app-netmode.json
├── usr/share/luci/menu.d/luci-app-netmode.json
└── www/luci-static/resources/
    ├── netmode/ui.js                          shared LuCI code: controls, charts, the live board
    ├── view/netmode/                          dashboard, monitor (full screen), match reports, settings
    └── view/status/include/15_netmode.js      Overview widget
install.sh, uninstall.sh                       run on the router
deploy.ps1, deploy.sh                          copy + install from a PC
```

Runtime data lives in `/var/run/netmode/` (state, live samples, history) and `/etc/netmode/` (game WAN, probe
target, game region, cloud address ranges, match reports, mwan3 backups).

## Known limits

- Connections keep the WAN they started on (mwan3 connmarks): when game mode starts, other devices' running
  downloads stay on the game WAN until they finish; new connections move.
- The region comparison covers servers in Google Cloud and AWS; others are compared by ping.
- The live graph's 1 s ping still targets a router near home: through a relay abroad it overstates the ping (the
  WAN round trips to the game region are the fair comparison).
- IPv4 only.

## License

[MIT](LICENSE)

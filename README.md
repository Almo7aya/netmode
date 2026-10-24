# netmode

**Game mode for multi-WAN OpenWrt routers.** While someone plays, their game traffic gets a WAN of its own and
everybody else moves to the other WANs — so downloads, streams and video calls can't queue in front of game
packets. When nobody plays, everyone shares every WAN again.

netmode sits on top of [mwan3](https://openwrt.org/docs/guide-user/network/wan/multiwan/mwan3): it builds its own
mwan3 policies and rules and flips them with ipsets, so switching is instant and needs no mwan3 restart. It comes
with a LuCI dashboard (live graphs, controls), match reports and a settings page.

It was built for a Raspberry Pi 4 running OpenWrt 24.10 in front of several 4G routers, where the WANs are
plentiful but each one's latency collapses as soon as somebody downloads on it.

## How it works

| | 🎮 Game mode (a gaming device is playing) | 🚀 All-WANs mode (otherwise) |
|---|---|---|
| Gaming devices' internet UDP (the game) | **the game WAN** (other WANs only as fallback) | the game WAN (ready for the next match) |
| Everyone else, plus the gaming devices' TCP / QUIC | **every WAN except the game WAN** | **every WAN** |

- **Detection** — every 10 s netmode reads the gaming devices' UDP uploads from conntrack (DNS, NTP, QUIC/443,
  SSDP/mDNS and LAN traffic don't count). A device that uploads ≥ 20 KB in one interval is playing; game mode ends
  120 s after the last busy interval.
- **Choosing the game WAN** — in `auto`, every 60 s it pings the probe target 10 times through every WAN and keeps
  the best candidate (20th-percentile ping + 2 × loss %). It only switches between matches, after another WAN has
  been ≥ 15 ms better for 3 rounds in a row. You can also **pick a WAN yourself** at any time: it applies at once
  and moves running matches there (their conntrack entries are dropped and the game reconnects through the new
  WAN — expect a freeze of about a second).
- **Probe target** — the game server if it answers ping through the game WAN, otherwise the farthest router in
  front of it that does (found with traceroute). Match servers are short-lived, so when the target stops answering
  netmode falls back to that router, then to `default_target`.
- **Match reports** — per device, from the first to the last busy interval (a match ends after 30 s of quiet):
  length, game WAN, average / min / max ping, jitter, loss, spikes (≥ 50 ms above the match average), data used and
  the ping over the match.
- **Live data** — a sampler pings through the game WAN once per second and records each gaming device's upload
  (last 15 min); the daemon keeps 3 h of 10 s points and every probe round.
- **Telegram notifications** (optional) — game mode on/off, game-WAN changes, a report after each match, and an
  alert when the game WAN lags during a match (with the fastest other WAN to switch to).

## Notifications

1. Create a bot with [@BotFather](https://t.me/BotFather) and copy its token.
2. Start a chat with the bot (or add it to a group) and get the chat id (e.g. from
   `https://api.telegram.org/bot<token>/getUpdates` after sending it a message; group ids are negative).
3. In **Services → Netmode → Settings → Notifications**, switch Telegram on, enter the token and chat id, choose the
   events, save, and press **Send test message**.

Example messages:

```
🎮 Game mode on — PC playing
Game WAN: wan4 (94 ms). Everyone else is on the other WANs.

🏁 Match over — PC: 23 min on wan4
Ping 96 ms avg (88–160), jitter 4.1 ms, loss 0.0 %, 2 spikes
Data 48.2 MB

⚠️ Lag on the game WAN wan4 during the match: 820 ms, 20 % loss (bad for the last 30 s).
Fastest other WAN: wan2 (85 ms) — switch in LuCI → Services → Netmode.
```

The token is stored only in `/etc/config/netmode` on the router.

## LuCI

- **Status → Overview → Network mode** — the current mode, mode buttons (Auto / Game / All WANs), game-WAN buttons
  with each WAN's latest ping, and a one-line summary.
- **Services → Netmode → Dashboard** — state, controls, live tiles and the graphs, refreshed every second:
  game-WAN ping (1 s pings with a 10 s median), each gaming device's upload against the game-mode threshold, and
  every WAN's probe ping; 5 min to 3 h, one crosshair across all of them.
- **Services → Netmode → Match reports** — median ping per game WAN, a dot per match, the full list, filter by device.
- **Services → Netmode → Settings** — everything below, including picking the gaming devices from the LAN's known hosts.

## Requirements

- OpenWrt (tested on 24.10) with `mwan3`, `ipset`, `conntrack`, `jsonfilter`, `rpcd` and LuCI:
  `opkg install mwan3 ipset conntrack`
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
Upgrades keep `/etc/config/netmode` and `/etc/netmode/`.

**Uninstall:** `sh uninstall.sh` on the router (`default_rule_v4` then points at a plain `balanced_all` policy over
the same WANs); `PURGE=1 sh uninstall.sh` also deletes the settings and match reports.

## Command line (on the router)

```
netmode status              what is active and the latest measurements
netmode auto | game | all   mode
netmode gw auto | <wan>     game WAN: automatic, or lock one now
netmode matches [n]         the last n match reports
```

## Settings

`/etc/config/netmode`, section `main` (the daemon re-reads it every interval; LuCI and the CLI apply changes at once):

| Option | Default | Meaning |
|---|---|---|
| `mode` | `auto` | `auto` / `game` (always) / `all` (never) |
| `game_ip` (list) | — | gaming devices; changing it rebuilds the mwan3 rules |
| `gw_mode` | `auto` | `auto`, or a WAN name to lock the game WAN |
| `wans` (list) | every mwan3 interface | WANs netmode balances and can use as the game WAN |
| `cands` (list) | all `wans` | WANs `auto` chooses from |
| `weight` (list) | 1 each | load-balancing weight, `wan:weight` (e.g. `wan1:4`) |
| `move_flows` | `1` | move running matches when the game WAN changes |
| `thresh` | `20000` | UDP bytes uploaded per interval that count as playing |
| `interval` | `10` | seconds between measurements |
| `hold` | `120` | seconds game mode stays on after the last busy interval |
| `learn_min` | `100000` | bytes per interval before a flow is taken as the game server |
| `probe_every` / `margin` / `rounds` | `60` / `15` / `3` | WAN probing and the auto-switch rule |
| `default_target` | `8.8.8.8` | probe target when nothing better answers ping |
| `live_ping` | `1` | pings through the game WAN for the graphs (1 per second + 5 per interval) |
| `min_match` / `keep_matches` | `60` / `200` | match reports |
| `telegram` | `0` | Telegram notifications on / off |
| `telegram_token` / `telegram_chat` | — | bot token (from @BotFather) and chat id |
| `notify` (list) | `mode gw match alert` | events to send: `mode`, `gw`, `match`, `alert`, `start` |
| `alert_ping` / `alert_loss` / `alert_after` / `alert_cooldown` | `200` / `20` / `3` / `300` | lag alert: ping ms or loss % for N intervals during a match; at most one per cooldown s |

## API

rpcd object `netmode` (`ubus call netmode <method>`), used by the LuCI pages:

| Method | Returns |
|---|---|
| `status` | mode, game WAN, devices (`ip`, `name`, `udp`, `playing`), live ping, probe results, target, current match |
| `live {"since": ts}` | 1 s points: `[ts, ping, state, gw, {ip: bytes}]` (last 15 min) |
| `history {"since": ts}` | 10 s points `[ts, udp, ping, loss, state, gw, {ip: bytes}]` and probe rounds `[ts, {wan: p20}]` (last 3 h) |
| `matches {"limit": n}` | match reports, newest first |
| `set {"mode": …}` / `set {"gw": …}` | change the mode / the game WAN |
| `clear_matches` | delete the match reports |
| `notify_test` | send a Telegram test message with the saved settings |

## Layout

```
files/                                         installed as-is on the router
├── etc/config/netmode                         default settings (kept on upgrade)
├── etc/init.d/netmode                         procd service: daemon + sampler (START=18, before mwan3)
├── usr/sbin/netmode-daemon                    detection, game-WAN choice, probes, match reports
├── usr/sbin/netmode-sampler                   1 s samples for the live graphs
├── usr/sbin/netmode                           command line
├── usr/lib/netmode/common.sh                  shared shell functions
├── usr/libexec/netmode/mwan3-rules            builds / removes the mwan3 policies and rules
├── usr/libexec/netmode/notify                 Telegram sender
├── usr/libexec/rpcd/netmode                   ubus API
├── usr/share/rpcd/acl.d/luci-app-netmode.json
├── usr/share/luci/menu.d/luci-app-netmode.json
└── www/luci-static/resources/
    ├── netmode/ui.js                          shared LuCI code: controls, charts
    ├── view/netmode/                          dashboard, match reports, settings
    └── view/status/include/15_netmode.js      Overview widget
install.sh, uninstall.sh                       run on the router
deploy.ps1, deploy.sh                          copy + install from a PC
```

Runtime data lives in `/var/run/netmode/` (state, live samples, history) and `/etc/netmode/` (game WAN, probe
target, match reports, mwan3 backups).

## Known limits

- Connections keep the WAN they started on (mwan3 connmarks): when game mode starts, other devices' running
  downloads stay on the game WAN until they finish; new connections move.
- Some game lobbies send bursts above the threshold, which keeps game mode on between matches. Raise `thresh` or
  lower `hold` if that matters to you.
- IPv4 only.

## License

[MIT](LICENSE)

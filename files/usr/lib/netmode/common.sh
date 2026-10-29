#!/bin/sh
# Shared by netmode-daemon and netmode-sampler.

# the l3 device of a netifd interface (empty when it is down)
dev_of() { ifstatus "$1" 2>/dev/null | jsonfilter -e '@.l3_device' 2>/dev/null; }

# shell-variable-safe key for a device IP
key_of() { echo "$1" | tr '.:' '__'; }

# every mwan3 interface, for when the netmode config doesn't list the WANs
mwan3_ifaces() { uci -q show mwan3 | sed -n 's/^mwan3\.\([^.=]*\)=interface$/\1/p' | tr '\n' ' '; }

# the gaming devices' ($1, space-separated IPs) internet UDP flows, not DNS/NTP/QUIC/discovery/LAN, nor what
# $GAME_IGNORE lists ("address[/bits]", ":port[-port]" or both, e.g. ":19294-19344" for Discord voice calls):
# "upload_bytes dst flow_key src download_bytes" per flow (conntrack's original / reply direction)
udp_flows() {
	awk -v ips="$1" -v ign="$GAME_IGNORE" '
		function ip2n(ip,   o) { split(ip, o, "."); return ((o[1] * 256 + o[2]) * 256 + o[3]) * 256 + o[4] }
		function ignored(d, p,   i, q) {
			for (i = 1; i <= NI; i++) {
				if (p < PL[i] || p > PH[i]) continue
				if (IB[i] < 0) return 1
				q = 2 ^ (32 - IB[i]); if (int(ip2n(d) / q) == int(IN[i] / q)) return 1
			}
			return 0
		}
		BEGIN {
			n = split(ips, a, " "); for (i = 1; i <= n; i++) G[a[i]] = 1
			NI = split(ign, e, " ")
			for (i = 1; i <= NI; i++) {
				net = e[i]; ports = ""; c = index(net, ":"); if (c) { ports = substr(net, c + 1); net = substr(net, 1, c - 1) }
				IB[i] = -1; if (net != "") { s = index(net, "/"); IB[i] = s ? substr(net, s + 1) + 0 : 32; IN[i] = ip2n(s ? substr(net, 1, s - 1) : net) }
				PL[i] = 0; PH[i] = 65535; if (ports != "") { d = index(ports, "-"); PL[i] = (d ? substr(ports, 1, d - 1) : ports) + 0; PH[i] = (d ? substr(ports, d + 1) : ports) + 0 }
			}
		}
		$3 != "udp" { next }
		{
			src = ""; dst = ""; sport = ""; dport = ""; up = ""; down = 0
			for (i = 1; i <= NF; i++) {
				if (src == "" && $i ~ /^src=/) src = substr($i, 5)
				else if (dst == "" && $i ~ /^dst=/) dst = substr($i, 5)
				else if (sport == "" && $i ~ /^sport=/) sport = substr($i, 7)
				else if (dport == "" && $i ~ /^dport=/) dport = substr($i, 7)
				else if ($i ~ /^bytes=/) { if (up == "") up = substr($i, 7); else { down = substr($i, 7); break } }
			}
			if (!(src in G)) next
			if (dport == 53 || dport == 123 || dport == 443 || dport == 5353 || dport == 1900) next
			if (dst ~ /^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.|22[4-9]\.|23[0-9]\.|255\.)/) next
			if (NI && ignored(dst, dport + 0)) next
			print up + 0, dst, src ">" dst ":" dport ":" sport, src, down + 0
		}' /proc/net/nf_conntrack 2>/dev/null
}

# bytes since the previous call that used the same snapshot file $2 (flows that ended in between are not lost),
# the busiest flow, and bytes per device: prints "total top_bytes top_dst ip=up,ip=up,... ip=down,ip=down,..."
# (total and top: upload, the game detection's measure). Entries with the same flow key are summed, and a flow
# missing from one read of the conntrack table stays in the snapshot for 3 more calls: otherwise its whole total
# would count again when it shows up the next time (a one-second "download" of several MB).
udp_delta() {  # $1 = device IPs, $2 = snapshot file ("up dst key src down age" per flow)
	udp_flows "$1" > "$2.cur"
	awk -v pf="$2" -v ips="$1" -v nf="$2.new" '
		BEGIN {
			printf "" > nf
			while ((getline l < pf) > 0) { split(l, a, " "); p[a[3]] = a[1]; pd[a[3]] = a[5] + 0; pl[a[3]] = l; age[a[3]] = a[6] + 0 }
		}
		{ up[$3] += $1; dn[$3] += $5; dst[$3] = $2; src[$3] = $4 }
		END {
			for (k in up) {
				d = up[k] - ((k in p) ? p[k] : 0); if (d < 0) d = up[k]
				dd = dn[k] - ((k in pd) ? pd[k] : 0); if (dd < 0) dd = dn[k]
				t += d; dev[src[k]] += d; down[src[k]] += dd; if (d > m) { m = d; top = dst[k] }
				print up[k], dst[k], k, src[k], dn[k], 0 > nf
			}
			for (k in p) if (!(k in up) && age[k] < 3) { split(pl[k], a, " "); print a[1], a[2], k, a[4], a[5] + 0, age[k] + 1 > nf }
			n = split(ips, a, " ")
			for (i = 1; i <= n; i++) { s = s (i > 1 ? "," : "") a[i] "=" (dev[a[i]] + 0); sd = sd (i > 1 ? "," : "") a[i] "=" (down[a[i]] + 0) }
			printf "%d %d %s %s %s\n", t, m, (top == "" ? "-" : top), (s == "" ? "-" : s), (sd == "" ? "-" : sd)
		}' "$2.cur"
	mv "$2.new" "$2"
	rm -f "$2.cur"
}

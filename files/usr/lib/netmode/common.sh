#!/bin/sh
# Shared by netmode-daemon and netmode-sampler.

# the l3 device of a netifd interface (empty when it is down)
dev_of() { ifstatus "$1" 2>/dev/null | jsonfilter -e '@.l3_device' 2>/dev/null; }

# shell-variable-safe key for a device IP
key_of() { echo "$1" | tr '.:' '__'; }

# every mwan3 interface, for when the netmode config doesn't list the WANs
mwan3_ifaces() { uci -q show mwan3 | sed -n 's/^mwan3\.\([^.=]*\)=interface$/\1/p' | tr '\n' ' '; }

# the gaming devices' ($1, space-separated IPs) internet UDP flows, not DNS/NTP/QUIC/discovery/LAN:
# "upload_bytes dst flow_key src download_bytes" per flow (conntrack's original / reply direction)
udp_flows() {
	awk -v ips="$1" '
		BEGIN { n = split(ips, a, " "); for (i = 1; i <= n; i++) G[a[i]] = 1 }
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
			print up + 0, dst, src ">" dst ":" dport ":" sport, src, down + 0
		}' /proc/net/nf_conntrack 2>/dev/null
}

# bytes since the previous call that used the same snapshot file $2 (flows that ended in between are not lost),
# the busiest flow, and bytes per device: prints "total top_bytes top_dst ip=up,ip=up,... ip=down,ip=down,..."
# (total and top: upload, the game detection's measure)
udp_delta() {  # $1 = device IPs, $2 = snapshot file
	udp_flows "$1" > "$2.cur"
	awk -v pf="$2" -v ips="$1" '
		BEGIN { while ((getline l < pf) > 0) { split(l, a, " "); p[a[3]] = a[1]; pd[a[3]] = a[5] + 0 } }
		{
			d = $1 - (($3 in p) ? p[$3] : 0); if (d < 0) d = $1; t += d; dev[$4] += d; if (d > m) { m = d; dst = $2 }
			dd = $5 - (($3 in pd) ? pd[$3] : 0); if (dd < 0) dd = $5; down[$4] += dd
		}
		END {
			n = split(ips, a, " ")
			for (i = 1; i <= n; i++) { s = s (i > 1 ? "," : "") a[i] "=" (dev[a[i]] + 0); sd = sd (i > 1 ? "," : "") a[i] "=" (down[a[i]] + 0) }
			printf "%d %d %s %s %s\n", t, m, (dst == "" ? "-" : dst), (s == "" ? "-" : s), (sd == "" ? "-" : sd)
		}' "$2.cur"
	mv "$2.cur" "$2"
}

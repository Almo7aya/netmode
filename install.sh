#!/bin/sh
# Install or upgrade netmode on an OpenWrt router. Run it on the router from the unpacked project
# (deploy.ps1 does that for you):
#   sh install.sh             install / upgrade (keeps /etc/config/netmode and /etc/netmode/)
#   DRYRUN=1 sh install.sh    only print the mwan3 rules it would build, on a copy of the live config
# Needs mwan3, ipset, conntrack, jsonfilter and rpcd; LuCI (luci-base) for the web pages.
set -e
cd "$(dirname "$0")"
find files install.sh uninstall.sh -type f -exec sed -i 's/\r$//' {} \;

if [ "$DRYRUN" = 1 ]; then
	NETMODE_LIB=files/usr/lib/netmode/common.sh sh files/usr/libexec/netmode/mwan3-rules dry
	exit 0
fi

missing=""
for b in mwan3 ipset conntrack jsonfilter ubus; do command -v $b >/dev/null 2>&1 || missing="$missing $b"; done
[ -z "$missing" ] || { echo "missing:$missing (opkg install mwan3 ipset conntrack)"; exit 1; }

# backup of the mwan3 config (last 5 kept)
TS=$(date +%Y%m%d_%H%M%S)
mkdir -p /etc/netmode/backup
cp /etc/config/mwan3 "/etc/netmode/backup/mwan3.$TS"
ls -t /etc/netmode/backup/mwan3.* 2>/dev/null | tail -n +6 | while read -r f; do rm -f "$f"; done
echo "mwan3 backup: /etc/netmode/backup/mwan3.$TS"

# settings: an existing /etc/config/netmode is kept
[ -f /etc/config/netmode ] || cp files/etc/config/netmode /etc/config/netmode

# WANs: every enabled mwan3 interface unless set; weights: taken once from the policy default_rule_v4 uses now
if [ -z "$(uci -q get netmode.main.wans)" ]; then
	for i in $(uci -q show mwan3 | sed -n 's/^mwan3\.\([^.=]*\)=interface$/\1/p'); do
		[ "$(uci -q get mwan3.$i.enabled)" = 0 ] || uci add_list netmode.main.wans="$i"
	done
fi
if [ -z "$(uci -q get netmode.main.weight)" ]; then
	pol=$(uci -q get mwan3.default_rule_v4.use_policy)
	for m in $(uci -q get "mwan3.$pol.use_member"); do
		i=$(uci -q get "mwan3.$m.interface"); w=$(uci -q get "mwan3.$m.weight")
		[ -n "$i" ] && [ -n "$w" ] && [ "$w" != 1 ] && uci add_list netmode.main.weight="$i:$w"
	done
fi
uci commit netmode

# files (everything under files/ except the default config)
(cd files && find . -type f ! -path ./etc/config/netmode) | while read -r f; do
	mkdir -p "/$(dirname "${f#./}")"
	cp "files/${f#./}" "/${f#./}"
done
chmod 755 /etc/init.d/netmode /usr/sbin/netmode /usr/sbin/netmode-daemon /usr/sbin/netmode-sampler \
	/usr/libexec/netmode/mwan3-rules /usr/libexec/rpcd/netmode

for f in /etc/netmode/ /usr/sbin/netmode /usr/sbin/netmode-daemon /usr/sbin/netmode-sampler /usr/lib/netmode/ \
	/etc/init.d/netmode /usr/libexec/netmode/ \
	/usr/libexec/rpcd/netmode /usr/share/rpcd/acl.d/luci-app-netmode.json /usr/share/luci/menu.d/luci-app-netmode.json \
	/www/luci-static/resources/netmode/ /www/luci-static/resources/view/netmode/ \
	/www/luci-static/resources/view/status/include/15_netmode.js; do
	grep -qxF "$f" /etc/sysupgrade.conf || echo "$f" >> /etc/sysupgrade.conf
done

/etc/init.d/netmode enable
/etc/init.d/netmode restart
sleep 2
/usr/libexec/netmode/mwan3-rules check   # rebuilds + restarts mwan3 only if the devices / WANs changed

/etc/init.d/rpcd reload
sleep 2
ubus list netmode >/dev/null 2>&1 || { /etc/init.d/rpcd restart; sleep 2; }
rm -f /tmp/luci-indexcache*
rm -rf /tmp/luci-modulecache
echo "netmode installed."
netmode status

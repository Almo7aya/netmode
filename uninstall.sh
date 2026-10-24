#!/bin/sh
# Remove netmode from the router: stop it, take its rules out of mwan3 (default_rule_v4 then uses a plain
# policy over all WANs), delete its files. Keeps /etc/config/netmode and /etc/netmode/ (match reports, mwan3
# backups) unless PURGE=1.
#   sh uninstall.sh   |   PURGE=1 sh uninstall.sh
/etc/init.d/netmode stop 2>/dev/null
/etc/init.d/netmode disable 2>/dev/null
[ -x /usr/libexec/netmode/mwan3-rules ] && /usr/libexec/netmode/mwan3-rules remove
for s in $(ipset list -n 2>/dev/null | grep -E '^nm_(gw|g)_'); do ipset destroy "$s" 2>/dev/null; done

rm -f /usr/sbin/netmode /usr/sbin/netmode-daemon /etc/init.d/netmode /usr/libexec/rpcd/netmode \
	/usr/share/rpcd/acl.d/luci-app-netmode.json /usr/share/luci/menu.d/luci-app-netmode.json \
	/www/luci-static/resources/view/status/include/15_netmode.js
rm -rf /usr/libexec/netmode /www/luci-static/resources/netmode /www/luci-static/resources/view/netmode /var/run/netmode
sed -i '\#^/etc/netmode/$#d; \#netmode#d' /etc/sysupgrade.conf
if [ "$PURGE" = 1 ]; then
	rm -rf /etc/netmode /etc/config/netmode
fi

/etc/init.d/rpcd reload
rm -f /tmp/luci-indexcache*
rm -rf /tmp/luci-modulecache
echo "netmode removed$([ "$PURGE" = 1 ] || echo ' (settings and match reports kept in /etc/config/netmode and /etc/netmode/)')."

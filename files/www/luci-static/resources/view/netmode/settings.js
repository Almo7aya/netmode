'use strict';
'require view';
'require form';
'require uci';
'require rpc';

// Services > Netmode > Settings: /etc/config/netmode. The daemon reads it every interval; changing the gaming
// devices or the WAN list rebuilds the mwan3 rules (init script reload_service -> /usr/libexec/netmode/mwan3-rules check).

var callHostHints = rpc.declare({ object: 'luci-rpc', method: 'getHostHints', expect: { '': {} } });

function ip2n(ip) {
	var p = String(ip).split('.');
	return p.length == 4 ? ((+p[0] << 24) >>> 0) + (+p[1] << 16) + (+p[2] << 8) + +p[3] : null;
}

// the LAN subnet(s) from /etc/config/network: [[net, mask], ...]
function lanNets() {
	var nets = [];
	L.toArray(uci.get('network', 'lan', 'ipaddr')).forEach(function(a) {
		var m = String(a).split('/'), bits = m[1] != null ? +m[1] : null;
		if (bits == null) {
			var nm = ip2n(uci.get('network', 'lan', 'netmask') || '255.255.255.0');
			bits = nm == null ? 24 : nm.toString(2).replace(/0/g, '').length;
		}
		var mask = bits ? (0xffffffff << (32 - bits)) >>> 0 : 0, n = ip2n(m[0]);
		if (n != null) nets.push([ (n & mask) >>> 0, mask, n ]);
	});
	return nets;
}

return view.extend({
	load: function() {
		return Promise.all([ uci.load('mwan3'), uci.load('netmode'), uci.load('network'), L.resolveDefault(callHostHints(), {}) ]);
	},

	render: function(data) {
		var hints = data[3] || {};
		var ifaces = uci.sections('mwan3', 'interface').filter(function(s) { return s.enabled != '0'; })
			.map(function(s) { return s['.name']; });
		var wans = L.toArray(uci.get('netmode', 'main', 'wans'));
		var m, s, o;

		m = new form.Map('netmode', _('Netmode'),
			_('Game mode gives the gaming devices their own WAN while they play and moves everyone else to the other WANs; ' +
			  'in all-WANs mode everyone shares every WAN. Live state, controls and graphs are on the Dashboard tab.'));

		s = m.section(form.NamedSection, 'main', 'netmode');
		s.addremove = false;
		s.tab('general', _('General'));
		s.tab('detect', _('Game detection'));
		s.tab('select', _('Game WAN selection'));
		s.tab('reports', _('Match reports'));

		o = s.taboption('general', form.ListValue, 'mode', _('Mode'),
			_('Auto: game mode while a gaming device plays. Game mode / All WANs: always.'));
		o.value('auto', _('Auto'));
		o.value('game', _('Game mode'));
		o.value('all', _('All WANs'));
		o.default = 'auto';

		o = s.taboption('general', form.MultiValue, 'game_ip', _('Gaming devices'),
			_('Their internet UDP (game traffic) gets the game WAN. Pick known devices or type an IPv4 address; use static ' +
			  'leases so the addresses don\'t change. Changing the list rebuilds the mwan3 rules (a short interruption for everyone).'));
		o.create = true;
		o.datatype = 'ip4addr("nomask")';
		o.rmempty = false;
		// known devices on the LAN subnet (not the router itself), sorted by address
		// (a gateway's hint also lists the internet hosts behind it, named by reverse DNS: no name for those)
		var nets = lanNets(), hosts = {};
		var onLan = function(ip) { var n = ip2n(ip); return n != null && nets.some(function(x) { return ((n & x[1]) >>> 0) == x[0] && n != x[2]; }); };
		Object.keys(hints).forEach(function(mac) {
			var h = hints[mac], ips = L.toArray(h.ipaddrs || h.ipv4), name = ips.every(onLan) ? (h.name || '') : '';
			ips.filter(onLan).forEach(function(ip) {
				if (!hosts[ip] || name) hosts[ip] = name;
			});
		});
		L.toArray(uci.get('netmode', 'main', 'game_ip')).forEach(function(ip) { if (!(ip in hosts)) hosts[ip] = ''; });
		Object.keys(hosts).sort(function(a, b) { return ip2n(a) - ip2n(b); }).forEach(function(ip) {
			o.value(ip, hosts[ip] ? '%s (%s)'.format(hosts[ip], ip) : ip);
		});

		o = s.taboption('general', form.ListValue, 'gw_mode', _('Game WAN'),
			_('Auto picks the best candidate between matches. Picking a WAN locks it and applies at once.'));
		o.value('auto', _('Auto (best candidate)'));
		wans.forEach(function(w) { o.value(w, w); });
		o.default = 'auto';

		o = s.taboption('general', form.Flag, 'move_flows', _('Move running matches'),
			_('When the game WAN changes, move the gaming devices\' running game connections to it right away ' +
			  '(the game freezes for about a second). Off: they stay on the old WAN until the next match.'));
		o.default = '1';
		o.rmempty = false;

		o = s.taboption('general', form.MultiValue, 'wans', _('WANs'),
			_('Every WAN netmode balances and can use as the game WAN (empty: every mwan3 interface). Changing this rebuilds ' +
			  'the mwan3 rules (a short interruption for everyone).'));
		ifaces.forEach(function(w) { o.value(w, w); });

		o = s.taboption('general', form.DynamicList, 'weight', _('WAN weights'),
			_('Load-balancing weight per WAN as <code>wan:weight</code>, e.g. <code>wan1:4</code>; unlisted WANs get 1. ' +
			  'Changing this rebuilds the mwan3 rules.'));
		o.placeholder = 'wan1:2';
		o.validate = function(section_id, value) {
			return !value || /^[A-Za-z0-9_]+:[0-9]+$/.test(value) ? true : _('Use wan:weight, e.g. wan1:4');
		};

		o = s.taboption('detect', form.Value, 'thresh', _('Game traffic threshold (bytes)'),
			_('Game mode starts when a gaming device uploads at least this much UDP in one interval (DNS, NTP, QUIC and LAN ' +
			  'traffic don\'t count). Measured with The Finals: a match sends 150–350 KB per 10 s; the lobby sends bursts of up to ~85 KB.'));
		o.datatype = 'uinteger';
		o.placeholder = '20000';

		o = s.taboption('detect', form.Value, 'interval', _('Interval (s)'),
			_('How often netmode measures, pings the game WAN and records graph points.'));
		o.datatype = 'range(5,60)';
		o.placeholder = '10';

		o = s.taboption('detect', form.Value, 'hold', _('Hold (s)'),
			_('Game mode stays on this long after the last busy interval (loading screens, lobbies).'));
		o.datatype = 'range(10,3600)';
		o.placeholder = '120';

		o = s.taboption('detect', form.Value, 'learn_min', _('Game server threshold (bytes)'),
			_('While playing, the busiest UDP flow becomes the game server (and the probe target) once it uploads this much in one interval.'));
		o.datatype = 'uinteger';
		o.placeholder = '100000';

		o = s.taboption('select', form.MultiValue, 'cands', _('Auto candidates'),
			_('The WANs auto mode chooses from (empty: all of them).'));
		wans.forEach(function(w) { o.value(w, w); });

		o = s.taboption('select', form.Value, 'probe_every', _('Probe every (s)'),
			_('10 pings through every WAN to the probe target.'));
		o.datatype = 'range(15,3600)';
		o.placeholder = '60';

		o = s.taboption('select', form.Value, 'margin', _('Switch margin (ms)'));
		o.datatype = 'uinteger';
		o.placeholder = '15';

		o = s.taboption('select', form.Value, 'rounds', _('Rounds'),
			_('Auto switches only after another candidate wins by the margin this many probe rounds in a row, and only when nobody plays.'));
		o.datatype = 'range(1,60)';
		o.placeholder = '3';

		o = s.taboption('select', form.Value, 'default_target', _('Default probe target'),
			_('Pinged when neither the game server nor a router in front of it answers ping.'));
		o.datatype = 'ip4addr("nomask")';
		o.placeholder = '8.8.8.8';

		o = s.taboption('select', form.Flag, 'live_ping', _('Live ping'),
			_('Pings through the game WAN for the graphs and the match reports (1 per second plus 5 every interval).'));
		o.default = '1';
		o.rmempty = false;

		o = s.taboption('reports', form.Value, 'min_match', _('Shortest match (s)'),
			_('Shorter busy periods (lobby bursts) are not recorded.'));
		o.datatype = 'uinteger';
		o.placeholder = '60';

		o = s.taboption('reports', form.Value, 'keep_matches', _('Matches kept'));
		o.datatype = 'range(1,10000)';
		o.placeholder = '200';

		return m.render();
	}
});

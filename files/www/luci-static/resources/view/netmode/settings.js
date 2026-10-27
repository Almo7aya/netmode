'use strict';
'require view';
'require form';
'require uci';
'require rpc';
'require ui';

// Services > Netmode > Settings: /etc/config/netmode. The daemon reads it every interval; changing the gaming
// devices or the WAN list rebuilds the mwan3 rules (init script reload_service -> /usr/libexec/netmode/mwan3-rules check).

var callHostHints = rpc.declare({ object: 'luci-rpc', method: 'getHostHints', expect: { '': {} } });
var callNotifyTest = rpc.declare({ object: 'netmode', method: 'notify_test' });

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
		// display names ('wan1:New router') of the saved settings: "New router (wan1)" in the WAN pickers
		var labels = {};
		L.toArray(uci.get('netmode', 'main', 'label')).forEach(function(l) {
			var i = l.indexOf(':');
			if (i > 0) labels[l.substr(0, i)] = l.substr(i + 1);
		});
		var wname = function(w) { return labels[w] ? '%s (%s)'.format(labels[w], w) : w; };
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
		s.tab('notify', _('Notifications'));

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
		wans.forEach(function(w) { o.value(w, wname(w)); });
		o.default = 'auto';

		o = s.taboption('general', form.Flag, 'game_all_traffic', _('All of the device\'s traffic on the game WAN'),
			_('Off (default): only the gaming devices\' game traffic (UDP) uses the game WAN; their other connections use the ' +
			  'other WANs. On: everything they send (TCP, UDP, QUIC) uses the game WAN, so the game\'s backend and the match ' +
			  'server see one public IP (try this if joining matches fails at random); their downloads then share the game ' +
			  'WAN. Changing it rebuilds the mwan3 rules.'));
		o.default = '0';
		o.rmempty = false;

		o = s.taboption('general', form.Flag, 'move_flows', _('Move running matches'),
			_('When the game WAN changes, move the gaming devices\' running game connections to it right away ' +
			  '(the game freezes for about a second). Off: they stay on the old WAN until the next match.'));
		o.default = '1';
		o.rmempty = false;

		o = s.taboption('general', form.MultiValue, 'wans', _('WANs'),
			_('Every WAN netmode balances and can use as the game WAN (empty: every mwan3 interface). Changing this rebuilds ' +
			  'the mwan3 rules (a short interruption for everyone).'));
		ifaces.forEach(function(w) { o.value(w, wname(w)); });

		o = s.taboption('general', form.DynamicList, 'label', _('WAN names'),
			_('A display name per WAN as <code>wan:name</code>, e.g. <code>wan1:New router</code>, used on the dashboard, in the match ' +
			  'reports and in Telegram messages; unnamed WANs show their interface name.'));
		o.placeholder = 'wan1:New router';
		o.validate = function(section_id, value) {
			return !value || /^[A-Za-z0-9_]+:[^"\\]*[^"\\\s][^"\\]*$/.test(value) ? true : _('Use wan:name, e.g. wan1:New router (no quotes or backslashes)');
		};

		o = s.taboption('general', form.MultiValue, 'game_only', _('Game-only WANs'),
			_('WANs (e.g. a relay tunnel) that can be the game WAN but never carry anyone else\'s traffic.'));
		wans.forEach(function(w) { o.value(w, wname(w)); });

		o = s.taboption('general', form.DynamicList, 'depends', _('Depends on'),
			_('<code>relay:wan1,wan2</code>: while relay is the game WAN, everyone else also stays off wan1 and wan2 ' +
			  '(the WANs the relay itself rides on).'));
		o.placeholder = 'relay:wan1,wan2';
		o.validate = function(section_id, value) {
			return !value || /^[A-Za-z0-9_]+:[A-Za-z0-9_]+(,[A-Za-z0-9_]+)*$/.test(value) ? true : _('Use wan:wan,wan');
		};

		o = s.taboption('general', form.DynamicList, 'relay_status', _('Relay status pages'),
			_('<code>relay:http://10.77.0.1:8780/</code>: a relay\'s own status page (JSON, e.g. an adaptive cap with <code>cap</code>, ' +
			  '<code>floor</code>, <code>ceiling</code>, <code>sending</code> in kbit/s), shown on the dashboard while that relay is the ' +
			  'game WAN. Fetched every 2 s, only while a dashboard is open.'));
		o.placeholder = 'relay:http://10.77.0.1:8780/';
		o.validate = function(section_id, value) {
			return !value || /^[A-Za-z0-9_]+:https?:\/\/\S+$/.test(value) ? true : _('Use wan:http://address:port/');
		};

		o = s.taboption('general', form.DynamicList, 'weight', _('WAN weights'),
			_('Load-balancing weight per WAN as <code>wan:weight</code>, e.g. <code>wan1:4</code>; unlisted WANs get 1. ' +
			  'Changing this rebuilds the mwan3 rules.'));
		o.placeholder = 'wan1:2';
		o.validate = function(section_id, value) {
			return !value || /^[A-Za-z0-9_]+:[0-9]+$/.test(value) ? true : _('Use wan:weight, e.g. wan1:4');
		};

		o = s.taboption('detect', form.Value, 'thresh', _('Game mode threshold (bytes)'),
			_('Game mode starts when a gaming device uploads at least this much UDP in one interval (DNS, NTP, QUIC and LAN ' +
			  'traffic don\'t count). Keep it low enough that launching the game / the lobby already start game mode, so ' +
			  'nothing switches while a match loads. Measured with The Finals: launch and lobby 16–17 KB per 10 s, loading ' +
			  'a match 20–46 KB, a match 110–400 KB.'));
		o.datatype = 'uinteger';
		o.placeholder = '8000';

		o = s.taboption('detect', form.Value, 'match_thresh', _('Match threshold (bytes)'),
			_('For the match reports: a match runs while a device uploads at least this much per interval (above lobby and loading traffic).'));
		o.datatype = 'uinteger';
		o.placeholder = '50000';

		o = s.taboption('detect', form.Value, 'interval', _('Interval (s)'),
			_('How often netmode measures, pings the game WAN and records graph points.'));
		o.datatype = 'range(5,60)';
		o.placeholder = '10';

		o = s.taboption('detect', form.Value, 'hold', _('Hold (s)'),
			_('Game mode stays on this long after the last busy interval (loading screens, lobbies).'));
		o.datatype = 'range(10,3600)';
		o.placeholder = '300';

		o = s.taboption('detect', form.Value, 'learn_min', _('Game server threshold (bytes)'),
			_('While playing, the busiest UDP flow becomes the game server (and the probe target) once it uploads this much in one interval.'));
		o.datatype = 'uinteger';
		o.placeholder = '100000';

		o = s.taboption('select', form.MultiValue, 'cands', _('Auto candidates'),
			_('The WANs auto mode chooses from (empty: all of them).'));
		wans.forEach(function(w) { o.value(w, wname(w)); });

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

		o = s.taboption('select', form.ListValue, 'match_switch', _('During a match'),
			_('When another candidate beats the game WAN by the margin for that many probe rounds while someone plays. ' +
			  'Switching moves the running match (the game freezes for about a second).'));
		o.value('ask', _('Ask on Telegram (a message with a Switch button)'));
		o.value('auto', _('Switch automatically (auto game WAN only; asks when it is locked)'));
		o.value('off', _('Do nothing until the match ends'));
		o.default = 'ask';

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

		o = s.taboption('notify', form.Flag, 'telegram', _('Telegram bot'),
			_('Messages and controls through a Telegram bot: create one with @BotFather, add it to your chat (or start a chat ' +
			  'with it) and enter its token and the chat id. In the chat: /status (with buttons), /mode, /wan, /pings, ' +
			  '/matches, /mute, /unmute, /help.'));
		o.rmempty = false;

		o = s.taboption('notify', form.Value, 'telegram_token', _('Bot token'));
		o.password = true;
		o.placeholder = '123456789:AA…';
		o.validate = function(section_id, value) {
			return !value || /^[0-9]+:[A-Za-z0-9_-]{20,}$/.test(value) ? true : _('Looks like 123456789:AA… (from @BotFather)');
		};

		o = s.taboption('notify', form.Value, 'telegram_chat', _('Chat id'),
			_('Filled in by pairing: add your @username under Allowed users, save, then send /start to the bot in a private ' +
			  'chat. Or enter a user id, a group id (negative) or @channelname yourself.'));
		o.validate = function(section_id, value) {
			return !value || /^(-?[0-9]+|@[A-Za-z0-9_]{5,})$/.test(value) ? true : _('A number (negative for groups) or @channelname');
		};

		o = s.taboption('notify', form.DynamicList, 'telegram_user', _('Allowed users'),
			_('Telegram @usernames or numeric user ids that may use the commands and buttons (and pair a private chat). ' +
			  'Empty: anyone in the chat.'));
		o.placeholder = '@username';
		o.validate = function(section_id, value) {
			return !value || /^(@[A-Za-z0-9_]{4,32}|[0-9]+)$/.test(value) ? true : _('An @username or a numeric user id');
		};

		o = s.taboption('notify', form.MultiValue, 'notify', _('Send'));
		o.value('mode', _('Game mode on / off'));
		o.value('gw', _('Game WAN changes'));
		o.value('match', _('A report after each match'));
		o.value('alert', _('Lag alerts during a match, no replies through the game WAN'));
		o.value('suggest', _('A faster WAN during a match (with a Switch button)'));
		o.value('start', _('netmode started (router boot, update)'));
		o.default = 'mode gw match alert suggest';

		o = s.taboption('notify', form.Value, 'alert_ping', _('Lag alert: ping (ms)'),
			_('Alert when the game WAN\'s ping stays at or above this during a match…'));
		o.datatype = 'uinteger';
		o.placeholder = '200';

		o = s.taboption('notify', form.Value, 'alert_loss', _('Lag alert: loss (%)'), _('…or its packet loss stays at or above this…'));
		o.datatype = 'range(1,100)';
		o.placeholder = '20';

		o = s.taboption('notify', form.Value, 'alert_after', _('Lag alert: intervals'), _('…for this many intervals in a row.'));
		o.datatype = 'range(1,60)';
		o.placeholder = '3';

		o = s.taboption('notify', form.Value, 'alert_cooldown', _('Lag alert: quiet time (s)'), _('At most one lag alert per this many seconds.'));
		o.datatype = 'uinteger';
		o.placeholder = '300';

		o = s.taboption('notify', form.Button, '_test', _('Test'), _('Uses the saved settings: Save first.'));
		o.inputtitle = _('Send test message');
		o.inputstyle = 'action';
		o.onclick = function() {
			return callNotifyTest().then(function(r) {
				ui.addNotification(null, E('p', r && r.ok ? _('Test message sent.') : _('Not sent: %s').format(r ? r.result : '?')), r && r.ok ? 'info' : 'danger');
			});
		};

		return m.render();
	}
});

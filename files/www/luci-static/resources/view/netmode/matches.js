'use strict';
'require view';
'require ui';
'require netmode.ui as nm';

// Services > Netmode > Match reports: one row per match and device, recorded by netmode-daemon
// (/etc/netmode/matches.jsonl).

function median(a) {
	var v = a.slice().sort(function(x, y) { return x - y; }), n = v.length;
	return n ? (n % 2 ? v[(n - 1) / 2] : (v[n / 2 - 1] + v[n / 2]) / 2) : null;
}

function mean(a) {
	return a.length ? a.reduce(function(s, v) { return s + v; }, 0) / a.length : null;
}

function when(ts) {
	var d = new Date(ts * 1000), p = function(n) { return (n < 10 ? '0' : '') + n; };
	return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + nm.hhmm(ts);
}

function dur(s) {
	return s < 90 ? _('%d s').format(s) : _('%d min').format(Math.round(s / 60));
}

function num(v, unit) {
	return v == null ? '—' : v.toFixed(1) + unit;
}

function devOf(m) {
	return m.device ? (m.name && m.name != '-' ? m.name : m.device) : _('gaming PC');
}

// the game server's cloud: recorded since the download columns, else told by the region name
// (Google Cloud: europe-west1, AWS: eu-central-1)
function cloudOf(m) {
	var p = m.provider && m.provider != '-' ? m.provider
		: /^[a-z]+-[a-z]+\d+$/.test(m.region || '') ? 'gcp' : /^[a-z]{2}-[a-z]+-\d+$/.test(m.region || '') ? 'aws' : null;
	return p == 'gcp' ? 'Google Cloud' : p == 'aws' ? 'AWS' : _('other');
}

// the map download when the match loaded: "8.2 MB · peak 540 KB/s · 20 s" (older reports: no download data)
function loadOf(m) {
	if (m.load_peak == null) return '—';
	return m.load_secs > 0 ? _('%.1f MB · peak %d KB/s · %d s').format(m.load_mb, m.load_peak, m.load_secs) : _('none (peak %d KB/s)').format(m.load_peak);
}

return view.extend({
	device: '',

	load: function() {
		return Promise.all([ nm.matches(500), nm.status() ]);
	},

	// "wan1>wan2" -> "Fibre → LTE" (display names from the running daemon)
	gwName: function(gw) {
		var st = this.st;
		return String(gw || '?').split('>').map(function(w) { return nm.wl(st, w); }).join(' → ');
	},

	handleClear: function() {
		ui.showModal(_('Clear match reports'), [
			E('p', _('Delete every recorded match?')),
			E('div', { 'class': 'right' }, [
				E('button', { 'class': 'cbi-button', 'click': ui.hideModal }, [ _('Cancel') ]), ' ',
				E('button', { 'class': 'cbi-button cbi-button-negative', 'click': function() {
					return nm.clearMatches().then(function() { ui.hideModal(); location.reload(); });
				} }, [ _('Delete') ])
			])
		]);
	},

	render: function(data) {
		nm.css();
		this.all = (data[0] && data[0].matches) || [];
		this.st = data[1] || {};
		this.root = E('div', { 'class': 'nm' });
		this.draw();
		var self = this;
		requestAnimationFrame(function() { self.draw(); });
		return E('div', {}, [
			E('h2', {}, [ _('Match reports') ]),
			E('div', { 'class': 'cbi-map-descr' }, [
				_('One row per match and gaming device, recorded automatically. Ping is measured every interval through the game ' +
				  'WAN to the probe target (the game server when it answers ping, else the last router in front of it). ' +
				  'Spikes: intervals with a ping 50 ms or more above the match average.')
			]),
			this.root
		]);
	},

	draw: function() {
		var self = this, W = Math.max(320, (this.root.clientWidth || 940) - 34);
		var devices = [];
		this.all.forEach(function(m) { var d = devOf(m); if (devices.indexOf(d) < 0) devices.push(d); });
		var ms = this.all.filter(function(m) { return !self.device || devOf(m) == self.device; });

		if (!this.all.length) {
			this.root.replaceChildren(E('div', { 'class': 'nm-card' }, [ E('em', {}, [ _('No matches recorded yet. Play a match and it shows up here when it ends.') ]) ]));
			return;
		}

		var filter = devices.length > 1 ? E('div', { 'class': 'nm-seg', 'style': 'margin:0' }, [ '' ].concat(devices).map(function(d) {
			var b = E('button', { 'type': 'button', 'class': 'nm-btn' + (d == self.device ? ' on' : '') }, [ d || _('All devices') ]);
			b.addEventListener('click', function() { self.device = d; self.draw(); });
			return b;
		})) : '';

		var groups = {}, order = [];
		ms.forEach(function(m) {
			var key = m.gw.indexOf('>') < 0 ? m.gw : _('switched WAN');
			if (!groups[key]) { groups[key] = []; order.push(key); }
			groups[key].push(m);
		});
		order.sort(function(a, b) { return (a.indexOf(' ') >= 0) - (b.indexOf(' ') >= 0) || (a < b ? -1 : a > b ? 1 : 0); });

		var summary = order.map(function(k) {
			var g = groups[k], pings = g.filter(function(m) { return m.ping != null; });
			return {
				wan: k, n: g.length,
				time: g.reduce(function(s, m) { return s + m.dur; }, 0),
				ping: median(pings.map(function(m) { return m.ping; })),
				jitter: mean(pings.map(function(m) { return m.jitter; })),
				loss: mean(g.map(function(m) { return m.loss; })),
				spikes: mean(g.map(function(m) { return m.spikes; }))
			};
		});
		var ranked = summary.filter(function(r) { return r.n >= 3 && r.ping != null && r.wan.indexOf(' ') < 0; })
			.sort(function(a, b) { return a.ping - b.ping; });
		var best = ranked.length > 1 ? ranked[0].wan : null;
		var th = function(h) { return E('th', { 'class': 'th' }, [ h ]); };
		var td = function(c) { return E('td', { 'class': 'td' }, [ c ]); };

		var sumTable = E('table', { 'class': 'table' }, [
			E('tr', { 'class': 'tr table-titles' }, [ _('Game WAN'), _('Matches'), _('Play time'), _('Median ping'),
				_('Avg jitter'), _('Avg loss'), _('Spikes per match') ].map(th))
		].concat(summary.map(function(r) {
			return E('tr', { 'class': 'tr' }, [
				td(E('span', {}, [ E('strong', {}, [ r.wan.indexOf(' ') < 0 ? self.gwName(r.wan) : r.wan ]), r.wan == best ? ' — ' + _('lowest ping') : '' ])),
				td(String(r.n)), td(dur(r.time)), td(num(r.ping, ' ms')), td(num(r.jitter, ' ms')), td(num(r.loss, ' %')), td(num(r.spikes, ''))
			]);
		})));

		// by the game server's cloud: ping, loss and how often loading a match came with a map download burst
		var clouds = {}, corder = [];
		ms.forEach(function(m) { var c = cloudOf(m); if (!clouds[c]) { clouds[c] = []; corder.push(c); } clouds[c].push(m); });
		var cloudTable = E('table', { 'class': 'table' }, [
			E('tr', { 'class': 'tr table-titles' }, [ _('Game server cloud'), _('Matches'), _('Median ping'), _('Avg loss'),
				_('Loading bursts'), _('Median burst peak'), _('Median burst size') ].map(th))
		].concat(corder.map(function(c) {
			var g = clouds[c], pings = g.filter(function(m) { return m.ping != null; });
			var withDl = g.filter(function(m) { return m.load_peak != null; }), bursts = withDl.filter(function(m) { return m.load_secs > 0; });
			return E('tr', { 'class': 'tr' }, [
				td(E('strong', {}, [ c ])), td(String(g.length)), td(num(median(pings.map(function(m) { return m.ping; })), ' ms')),
				td(num(mean(g.map(function(m) { return m.loss; })), ' %')),
				td(withDl.length ? _('%d of %d').format(bursts.length, withDl.length) : '—'),
				td(bursts.length ? Math.round(median(bursts.map(function(m) { return m.load_peak; }))) + ' KB/s' : '—'),
				td(bursts.length ? num(median(bursts.map(function(m) { return m.load_mb; })), ' MB') : '—')
			]);
		})));

		var strip = nm.strip(order.map(function(k) {
			return {
				label: '%s (%d)'.format(k.indexOf(' ') < 0 ? self.gwName(k) : k, groups[k].length),
				values: groups[k].filter(function(m) { return m.ping != null; }).map(function(m) {
					return { v: m.ping, tip: [ when(m.start) + ' · ' + devOf(m) + (m.region_name && m.region_name != '-' ? ' · ' + m.region_name : ''), _('%.1f ms average ping').format(m.ping),
						_('%s on %s').format(dur(m.dur), self.gwName(m.gw)), _('jitter %.1f ms, loss %.1f %%, %d spikes').format(m.jitter, m.loss, m.spikes) ] };
				})
			};
		}), W);

		var list = E('table', { 'class': 'table' }, [
			E('tr', { 'class': 'tr table-titles' }, [ _('Started'), _('Device'), _('Length'), _('Game WAN'), _('Game server'), _('Ping avg (min–max)'), _('Jitter'),
				_('Loss'), _('Spikes'), _('Ping during the match'), _('Up'), _('Down'), _('Loading burst'), _('Probe target') ].map(th))
		].concat(ms.map(function(m) {
			var cloud = cloudOf(m);
			return E('tr', { 'class': 'tr' }, [
				td(when(m.start)), td(devOf(m)), td(dur(m.dur)), E('td', { 'class': 'td', 'title': m.gw.replace(/>/g, ' → ') }, [ self.gwName(m.gw) ]),
				E('td', { 'class': 'td', 'title': (m.region && m.region != '-' ? m.region + ' · ' : '') + (m.server || '') }, [
					(cloud != _('other') ? cloud + ' · ' : '') + (m.region_name && m.region_name != '-' ? m.region_name : (m.server || '—')) ]),
				td(m.ping == null ? _('no reply') : '%.1f ms (%.0f–%.0f)'.format(m.ping, m.min, m.max)),
				td(num(m.jitter, ' ms')), td(num(m.loss, ' %')), td(String(m.spikes)),
				td(nm.sparkline(m.series || [], 160, 28)), td(num(m.mb, ' MB')), td(num(m.down_mb, ' MB')), td(loadOf(m)),
				E('td', { 'class': 'td', 'title': m.server != '-' ? _('game server %s').format(m.server) : '' }, [
					m.target, E('span', { 'style': 'opacity:.6' }, [ ' (' + m.target_src + ')' ]) ])
			]);
		})));

		var clear = E('button', { 'class': 'cbi-button cbi-button-negative' }, [ _('Clear match reports') ]);
		clear.addEventListener('click', function() { self.handleClear(); });

		this.root.replaceChildren(
			filter ? E('div', { 'style': 'margin-bottom:12px' }, [ filter ]) : '',
			E('div', { 'class': 'nm-card' }, [
				E('h3', {}, [ _('By game WAN') ]),
				sumTable,
				E('div', { 'class': 'nm-chart-h', 'style': 'margin-top:14px' }, [ E('b', {}, [ _('Average ping per match') ]),
					E('span', {}, [ _('one dot per match, by game WAN; tick: median') ]) ]),
				strip
			]),
			E('div', { 'class': 'nm-card' }, [
				E('h3', {}, [ _('By game server cloud') ]),
				cloudTable,
				E('div', { 'class': 'nm-note', 'style': 'margin-top:8px' }, [
					_('Loading burst: the UDP download from 3 min before the match to 2 min into it reached 300 KB/s or more (a 10 s average) — ' +
					  'the map download that can choke the connection. Recorded since the download columns were added; older matches show —.') ])
			]),
			E('div', { 'class': 'nm-card' }, [
				E('h3', {}, [ _('Matches') ]),
				list,
				E('div', { 'class': 'right', 'style': 'margin-top:1em' }, [ clear ])
			]));
	},

	handleSave: null,
	handleSaveApply: null,
	handleReset: null
});

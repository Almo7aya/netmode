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
			E('tr', { 'class': 'tr table-titles' }, [ _('Started'), _('Device'), _('Length'), _('Game WAN'), _('Server region'), _('Ping avg (min–max)'), _('Jitter'),
				_('Loss'), _('Spikes'), _('Ping during the match'), _('Data'), _('Probe target') ].map(th))
		].concat(ms.map(function(m) {
			return E('tr', { 'class': 'tr' }, [
				td(when(m.start)), td(devOf(m)), td(dur(m.dur)), E('td', { 'class': 'td', 'title': m.gw.replace(/>/g, ' → ') }, [ self.gwName(m.gw) ]),
				E('td', { 'class': 'td', 'title': m.region && m.region != '-' ? m.region : '' }, [ m.region_name && m.region_name != '-' ? m.region_name : '—' ]),
				td(m.ping == null ? _('no reply') : '%.1f ms (%.0f–%.0f)'.format(m.ping, m.min, m.max)),
				td(num(m.jitter, ' ms')), td(num(m.loss, ' %')), td(String(m.spikes)),
				td(nm.sparkline(m.series || [], 160, 28)), td(num(m.mb, ' MB')),
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
				E('h3', {}, [ _('Matches') ]),
				list,
				E('div', { 'class': 'right', 'style': 'margin-top:1em' }, [ clear ])
			]));
	},

	handleSave: null,
	handleSaveApply: null,
	handleReset: null
});

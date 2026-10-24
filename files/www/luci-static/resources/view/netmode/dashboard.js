'use strict';
'require view';
'require poll';
'require netmode.ui as nm';

// Services > Netmode > Dashboard: live state, controls and every graph. Refreshes every second: the 5 and 15 min
// ranges use the sampler's 1 s points (/var/run/netmode/live), 1 h and 3 h the daemon's 10 s history.

var LIVE_KEEP = 900, HIST_KEEP = 10800;
var RANGES = [ [ 300, _('5 min') ], [ 900, _('15 min') ], [ 3600, _('1 h') ], [ 10800, _('3 h') ] ];
var TARGET_SRC = {
	server: _('the game server itself'),
	edge: _('the last router in front of the game server'),
	default: _('default target')
};

function tile(label, value, unit, desc) {
	return E('div', { 'class': 'nm-tile' }, [
		E('div', { 'class': 'nm-label' }, [ label ]),
		E('div', { 'class': 'v' }, [ value, unit ? E('small', {}, [ unit ]) : '' ]),
		E('div', { 'class': 'd' }, desc)
	]);
}

function kbs(v) { return v == null ? '—' : v < 10 ? v.toFixed(1) : String(Math.round(v)); }

// ping statistics over rows: { avg, jitter, loss (%) }
function stats(rows) {
	var v = rows.filter(function(r) { return r.ping != null; }).map(function(r) { return r.ping; }), j = 0;
	for (var i = 1; i < v.length; i++) j += Math.abs(v[i] - v[i - 1]);
	var lost = rows.reduce(function(s, r) { return s + (r.lossPct != null ? r.lossPct : 0); }, 0);
	return {
		avg: v.length ? v.reduce(function(s, x) { return s + x; }, 0) / v.length : null,
		jitter: v.length > 1 ? j / (v.length - 1) : null,
		loss: rows.length ? lost / rows.length : null
	};
}

return view.extend({
	d: { st: {}, hist: [], probes: [], live: [], histLast: 0, liveLast: 0, n: 0, key: '' },
	vs: { range: 900, hover: null, hoverY: null },

	load: function() {
		return Promise.all([ nm.status(), nm.history(0), nm.live(0) ]);
	},

	merge: function(st, h, lv) {
		var d = this.d;
		if (st) d.st = st;
		if (h) {
			(h.points || []).forEach(function(p) { if (p[0] > d.histLast) { d.hist.push(p); d.histLast = p[0]; } });
			(h.probes || []).forEach(function(p) { if (!d.probes.length || p[0] > d.probes[d.probes.length - 1][0]) d.probes.push(p); });
			d.hist = d.hist.filter(function(p) { return p[0] > d.histLast - HIST_KEEP; });
			d.probes = d.probes.filter(function(p) { return p[0] > d.histLast - HIST_KEEP; });
		}
		if (lv) {
			(lv.points || []).forEach(function(p) { if (p[0] > d.liveLast) { d.live.push(p); d.liveLast = p[0]; } });
			d.live = d.live.filter(function(p) { return p[0] > d.liveLast - LIVE_KEEP; });
		}
	},

	// rows in one shape for both sources: { ts, ping, lossPct, state, gw, dev: { ip: KB/s } }
	rows: function(useLive) {
		var st = this.d.st, iv = st.interval || 10, liveOn = st.ping != null;
		var kb = function(o, div) { var r = {}; for (var k in (o || {})) r[k] = o[k] / div / 1024; return r; };
		return useLive
			? this.d.live.map(function(p) { return { ts: p[0], ping: p[1], lossPct: liveOn && p[1] == null ? 100 : 0, state: p[2], gw: p[3], dev: kb(p[4], 1) }; })
			: this.d.hist.map(function(p) { return { ts: p[0], ping: p[2], lossPct: p[3], state: p[4], gw: p[5], dev: kb(p[6], iv) }; });
	},

	tick: function() {
		var self = this, d = this.d;
		d.n++;
		return Promise.all([ nm.status(), nm.live(d.liveLast), d.n % 5 == 0 ? nm.history(d.histLast) : null ]).then(function(r) {
			self.merge(r[0], r[2], r[1]);
			self.drawHeader();
			self.drawGraphs();
		});
	},

	render: function(res) {
		nm.css();
		this.merge(res[0], res[1], res[2]);
		this.headHost = E('div');
		this.graphHost = E('div');
		this.root = E('div', { 'class': 'nm' }, [ this.headHost, this.graphHost ]);
		this.drawHeader();
		this.drawGraphs();

		var self = this, t = null;
		poll.add(function() { return self.tick(); }, 1);
		window.addEventListener('resize', function() {
			clearTimeout(t);
			t = setTimeout(function() { self.drawGraphs(); }, 120);
		});
		requestAnimationFrame(function() { self.drawGraphs(); });
		return E('div', {}, [ E('h2', {}, [ _('Netmode') ]), this.root ]);
	},

	refresh: function() {
		var self = this;
		return nm.status().then(function(st) { self.merge(st); self.d.key = ''; self.drawHeader(); });
	},

	/* the status card: rebuilt only when the state behind the buttons changes (a rebuild every second would
	 * swallow clicks); the tiles are refreshed every second */
	drawHeader: function() {
		var st = this.d.st;
		if (!st.running) {
			this.d.key = '';
			this.headHost.replaceChildren(E('div', { 'class': 'nm-card' }, [ E('em', {}, [ _('netmode is not running (/etc/init.d/netmode start)') ]) ]));
			return;
		}
		var key = JSON.stringify([ st.mode, st.state, st.gw, st.gw_mode, st.wans, st.cands, st.move_flows, st.probe,
			(st.devices || []).map(function(x) { return [ x.ip, x.name, x.playing ]; }) ]);
		if (key != this.d.key) {
			this.d.key = key;
			var c = nm.controls(st, L.bind(this.refresh, this));
			var playing = (st.devices || []).filter(function(x) { return x.playing; });
			this.tiles = E('div', { 'class': 'nm-tiles' });
			this.headHost.replaceChildren(E('div', { 'class': 'nm-card' }, [
				E('h3', {}, [ _('Network mode'), E('span', { 'class': 'nm-live' }, [ E('i'), _('live') ]) ]),
				E('div', { 'class': 'nm-head' }, [
					E('div', {}, [
						nm.badge(st),
						E('div', { 'class': 'nm-desc' }, [ nm.describe(st) ]),
						E('div', { 'class': 'nm-desc' }, [ _('Mode %s').format(st.mode) + ' · ' +
							(playing.length ? _('%s playing').format(playing.map(nm.devName).join(', ')) : _('nobody playing')) + ' · ' +
							_('game WAN %s').format(st.gw_mode) ])
					]),
					E('div', {}, [ E('div', { 'class': 'nm-label' }, [ _('Mode') ]), c.modes, E('div', { 'class': 'nm-label' }, [ _('Game WAN') ]), c.gws, c.note ])
				]),
				this.tiles
			]));
		}
		this.drawTiles();
	},

	drawTiles: function() {
		var st = this.d.st, live = this.rows(true), now = this.d.liveLast || st.ts;
		var last = live.length && now - live[live.length - 1].ts <= 3 ? live[live.length - 1] : null;
		var recent = live.filter(function(r) { return r.ts > now - 60; });
		var s = stats(recent), p = st.ping;

		var ping;
		if (last && st.ping != null)
			ping = tile(_('Game WAN ping'), last.ping != null ? String(Math.round(last.ping)) : _('lost'), last.ping != null ? 'ms' : '',
				[ s.avg != null ? _('last 60 s: avg %d ms · jitter %.1f ms · loss %d %%').format(Math.round(s.avg), s.jitter || 0, Math.round(s.loss)) : '',
				  E('div', {}, [ _('via %s to %s').format(st.gw, st.target) ]) ]);
		else if (p && p.avg != null)
			ping = tile(_('Game WAN ping'), String(Math.round(p.avg)), 'ms', [ _('jitter %.1f ms · loss %d %% · via %s').format(p.jitter, p.loss, st.gw) ]);
		else
			ping = tile(_('Game WAN ping'), p ? _('no reply') : '—', '', [ p ? _('from %s through %s').format(st.target, st.gw) : _('live ping is off') ]);

		var recent3 = live.filter(function(r) { return r.ts > now - 3; });
		var devRate = function(ip) {
			if (!recent3.length) return null;
			return recent3.reduce(function(a, r) { return a + (r.dev[ip] || 0); }, 0) / recent3.length;
		};
		var devs = st.devices || [];
		var total = devs.reduce(function(a, x) { var v = devRate(x.ip); return a + (v || 0); }, 0);
		var devTile = tile(_('Gaming devices'), kbs(total), 'KB/s', devs.length ? devs.map(function(x) {
			return E('div', {}, [ nm.devName(x) + ': ' + kbs(devRate(x.ip)) + ' KB/s' + (x.playing ? ' · ' + _('playing') : '') ]);
		}) : [ E('a', { 'href': L.url('admin/services/netmode/settings') }, [ _('pick your gaming devices in Settings') ]) ]);

		var matchTile = st.match
			? tile(_('Match'), nm.dur(now - st.match.start), '', [ _('since %s · on %s').format(nm.hhmm(st.match.start), st.gw) ])
			: tile(_('Match'), '—', '', [ _('no match running · '), E('a', { 'href': L.url('admin/services/netmode/matches') }, [ _('match reports') ]) ]);

		var tdesc = [ TARGET_SRC[st.target_src] || st.target_src ];
		if (st.target_src != 'server' && st.server && st.server != '-') tdesc.push(' · ' + _('game server %s').format(st.server));

		this.tiles.replaceChildren(ping, devTile, matchTile, tile(_('Probe target'), st.target, '', tdesc));
	},

	drawGraphs: function() {
		var self = this, v = this.vs, d = this.d, st = d.st;
		var useLive = v.range <= LIVE_KEEP;
		var all = this.rows(useLive);
		var t1 = useLive ? (d.liveLast || st.ts) : (d.histLast || st.ts), t0 = t1 - v.range;
		var rows = all.filter(function(r) { return r.ts > t0; });
		var probes = d.probes.filter(function(p) { return p[0] > t0 - 60; });
		var devs = st.game_ips || [];
		var names = {};
		(st.devices || []).forEach(function(x) { names[x.ip] = nm.devName(x); });
		var wans = st.wans || [], iv = st.interval || 10;
		var W = Math.max(320, (this.graphHost.clientWidth || 940) - 34);
		var frame = { L: 56, R: 18, t0: t0, t1: t1 };

		var ranges = E('div', { 'class': 'nm-seg', 'style': 'margin:0' }, RANGES.map(function(r) {
			var b = E('button', { 'type': 'button', 'class': 'nm-btn' + (r[0] == v.range ? ' on' : '') }, [ r[1] ]);
			b.addEventListener('click', function() { v.range = r[0]; v.hover = null; self.drawGraphs(); });
			return b;
		}));
		var card = E('div', { 'class': 'nm-card' }, [ E('h3', {}, [ _('Graphs'), ranges ]) ]);
		if (rows.length < 2) {
			card.appendChild(E('em', {}, [ useLive ? _('Collecting data… (one point per second)') : _('Collecting data… (one point every %d s)').format(iv) ]));
			this.graphHost.replaceChildren(card);
			return;
		}

		// game-mode bands and game-WAN switches, shared by the charts
		var step = useLive ? 1 : iv, bands = [], marks = [], start = null;
		rows.forEach(function(r, i) {
			var next = rows[i + 1];
			if (r.state == 'game' && start == null) start = r.ts - step;
			if (r.state == 'game' && (!next || next.state != 'game')) { bands.push([ start, r.ts ]); start = null; }
			if (i > 0 && r.gw != rows[i - 1].gw) marks.push({ ts: r.ts, label: '→ ' + r.gw });
		});
		var loss = rows.filter(function(r) { return r.lossPct > 0; }).map(function(r) { return r.ts; });
		var host = E('div', { 'style': 'position:relative' });
		var charts = [];
		var head = function(title, sub, nowVal, nowUnit, nowSub) {
			return E('div', { 'class': 'nm-bh' }, [
				E('div', {}, [ E('div', { 'class': 't' }, [ title ]), E('div', { 'class': 's' }, [ sub ]) ]),
				E('div', { 'class': 'now' }, [ E('b', {}, [ nowVal ]), nowUnit ? E('small', {}, [ nowUnit ]) : '', nowSub ? E('div', {}, [ nowSub ]) : '' ])
			]);
		};

		// 1. game WAN ping
		var s = stats(rows), lastPing = null;
		for (var i = rows.length - 1; i >= 0 && lastPing == null; i--) if (rows[i].ping != null) lastPing = rows[i].ping;
		// live: the raw 1 s pings as a faint line under a 10 s rolling median (readable when the WAN is jittery)
		var med = {};
		if (useLive) rows.forEach(function(r, i) {
			var w = [];
			for (var k = i; k >= 0 && rows[k].ts > r.ts - 10; k--) if (rows[k].ping != null) w.push(rows[k].ping);
			w.sort(function(a, b) { return a - b; });
			med[r.ts] = w.length >= 3 ? (w.length % 2 ? w[(w.length - 1) / 2] : (w[w.length / 2 - 1] + w[w.length / 2]) / 2) : null;
		});
		var pingSeries = useLive
			? [ { label: _('ping'), color: nm.color(0), width: 1, opacity: 0.4, tol: 1.5, pts: rows.map(function(r) { return [ r.ts, r.ping ]; }) },
			    { label: _('10 s median'), color: nm.color(0), area: true, tol: 1.5, pts: rows.map(function(r) { return [ r.ts, med[r.ts] ]; }) } ]
			: [ { label: _('ping'), color: nm.color(0), area: true, tol: step * 1.5, pts: rows.map(function(r) { return [ r.ts, r.ping ]; }) } ];
		var c1 = nm.chart({ W: W, H: 220, frame: frame, unit: 'ms', robust: true, minSpan: 20, bands: bands, marks: marks, loss: loss, series: pingSeries });
		var clippedAny = c1.clipped > 0;
		var leg1 = useLive
			? [ [ nm.lineKey(nm.color(0)), _('10 s median') ], [ nm.S('svg', { 'width': 16, 'height': 10 }, [ nm.S('line', { 'x1': 1, 'y1': 5, 'x2': 15, 'y2': 5,
				'stroke': nm.color(0), 'stroke-width': 1, 'stroke-opacity': 0.5 }) ]), _('each ping (1 per second)') ] ]
			: [ [ nm.lineKey(nm.color(0)), _('average of 5 pings every %d s').format(iv) ] ];
		if (bands.length) leg1.push([ nm.bandKey(), _('game mode') ]);
		if (marks.length) leg1.push([ nm.markKey(), _('game WAN switch') ]);
		if (loss.length) leg1.push([ nm.lossKey(), _('packet loss') ]);
		if (clippedAny) leg1.push([ nm.spikeKey(), _('spike above the scale (hover for the value)') ]);
		host.appendChild(E('div', { 'class': 'nm-block' }, [
			head(_('Game WAN ping'), _('ms · through the game WAN to the probe target'), lastPing != null ? String(Math.round(lastPing)) : '—', 'ms',
				s.avg != null ? _('avg %d · jitter %.1f · loss %.1f %%').format(Math.round(s.avg), s.jitter || 0, s.loss) : ''),
			nm.legend(leg1), c1.svg ]));
		charts.push(c1);

		// 2. gaming devices' UDP upload
		var lastDev = rows[rows.length - 1].dev;
		var c2 = nm.chart({ W: W, H: 160, frame: frame, unit: 'KB/s', zero: true, minSpan: 1, bands: bands,
			thresh: { v: (st.thresh || 0) / iv / 1024, label: _('game mode threshold') },
			series: devs.map(function(ip, i) {
				return { label: names[ip] || ip, color: nm.color(i), area: devs.length == 1, tol: step * 1.5,
					pts: rows.map(function(r) { return [ r.ts, r.dev[ip] != null ? r.dev[ip] : null ]; }) };
			}) });
		var totalNow = devs.reduce(function(a, ip) { return a + (lastDev[ip] || 0); }, 0);
		host.appendChild(E('div', { 'class': 'nm-block' }, [
			head(_('Gaming devices UDP upload'), _('KB/s · DNS, NTP, QUIC and LAN traffic not counted'), kbs(totalNow), 'KB/s'),
			nm.legend(devs.map(function(ip, i) { return [ nm.lineKey(nm.color(i)), names[ip] || ip, kbs(lastDev[ip]) + ' KB/s' ]; })
				.concat([ [ nm.lineKey('currentColor', '5 4'), _('game mode threshold') ] ])),
			c2.svg ]));
		charts.push(c2);

		// 3. WAN pings (probe rounds)
		if (probes.length) {
			var lastProbe = probes[probes.length - 1][1];
			var c3 = nm.chart({ W: W, H: 200, frame: frame, unit: 'ms', robust: true, minSpan: 20, bands: bands, marks: marks,
				series: wans.map(function(w, i) {
					return { label: w, color: nm.color(i), markers: true, tol: 45, pts: probes.map(function(p) { return [ p[0], p[1][w] != null ? p[1][w] : null ]; }) };
				}) });
			host.appendChild(E('div', { 'class': 'nm-block' }, [
				head(_('WAN pings'), _('ms · 20th percentile of 10 pings per WAN to the probe target, every probe round'), '', ''),
				nm.legend(wans.map(function(w, i) {
					return [ nm.lineKey(nm.color(i)), w + (w == st.gw ? ' (' + _('game WAN') + ')' : ''), lastProbe[w] != null ? lastProbe[w] + ' ms' : _('no reply') ];
				})),
				c3.svg ]));
			charts.push(c3);
		}

		var byTs = {};
		rows.forEach(function(r) { byTs[r.ts] = r; });
		nm.syncHover(host, charts, frame, W, rows.map(function(r) { return r.ts; }), function(ts) {
			var r = byTs[ts], out = [ E('div', { 'class': 'm' }, [ nm.hhmm(ts, true) + ' · ' + (r.state == 'game' ? _('game mode') : _('all WANs')) + ' · ' + _('game WAN %s').format(r.gw) ]) ];
			out.push(nm.tipRow(r.ping != null ? r.ping.toFixed(1) + ' ms' : _('no reply'), _('ping'), nm.color(0)));
			if (useLive && med[ts] != null) out.push(nm.tipRow(Math.round(med[ts]) + ' ms', _('10 s median'), nm.color(0)));
			if (!useLive) out.push(nm.tipRow(r.lossPct != null ? r.lossPct + ' %' : '—', _('packet loss')));
			devs.forEach(function(ip, i) { out.push(nm.tipRow(kbs(r.dev[ip]) + ' KB/s', names[ip] || ip, nm.color(i))); });
			var pr = null;
			probes.forEach(function(p) { if (Math.abs(p[0] - ts) <= 90 && (!pr || Math.abs(p[0] - ts) < Math.abs(pr[0] - ts))) pr = p; });
			if (pr) wans.forEach(function(w, i) { out.push(nm.tipRow(pr[1][w] != null ? pr[1][w] + ' ms' : _('no reply'), w, nm.color(i))); });
			return out;
		}, v);

		card.appendChild(host);
		this.graphHost.replaceChildren(card);
	},

	handleSave: null,
	handleSaveApply: null,
	handleReset: null
});

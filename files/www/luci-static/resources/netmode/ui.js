'use strict';
'require baseclass';
'require rpc';
'require ui';

// Shared code for the netmode LuCI views: rpc calls, the mode / game-WAN controls, formatting and SVG charts.
// Chart colours: the dataviz reference palette, categorical slots in fixed order (validated on the light and dark
// LuCI surfaces). In light mode slots 3-5 sit below 3:1 contrast, so every series is also named, with its latest
// value, in the legend.

var callStatus = rpc.declare({ object: 'netmode', method: 'status' });
var callHistory = rpc.declare({ object: 'netmode', method: 'history', params: [ 'since' ] });
var callLive = rpc.declare({ object: 'netmode', method: 'live', params: [ 'since' ] });
var callMatches = rpc.declare({ object: 'netmode', method: 'matches', params: [ 'limit' ] });
var callClear = rpc.declare({ object: 'netmode', method: 'clear_matches' });
var callSetMode = rpc.declare({ object: 'netmode', method: 'set', params: [ 'mode' ] });
var callSetGw = rpc.declare({ object: 'netmode', method: 'set', params: [ 'gw' ] });

var SVGNS = 'http://www.w3.org/2000/svg';

var DARK = '--nm-c1:#3987e5;--nm-c2:#d95926;--nm-c3:#199e70;--nm-c4:#c98500;--nm-c5:#d55181;--nm-c6:#008300;--nm-c7:#9085e9;--nm-c8:#e66767;' +
	'--nm-band:rgba(160,160,160,.11);--nm-grid:rgba(255,255,255,.08);--nm-axis:rgba(255,255,255,.22)';
var CSS = [
	'.nm{--nm-c1:#2a78d6;--nm-c2:#eb6834;--nm-c3:#1baf7a;--nm-c4:#eda100;--nm-c5:#e87ba4;--nm-c6:#008300;--nm-c7:#4a3aa7;--nm-c8:#e34948;',
	'--nm-crit:#d03b3b;--nm-good:#0ca30c;',
	'--nm-band:rgba(120,120,120,.12);--nm-grid:rgba(0,0,0,.08);--nm-axis:rgba(0,0,0,.25);',
	'--nm-line:rgba(128,128,128,.3);--nm-fill:rgba(128,128,128,.06);font:13px system-ui,-apple-system,"Segoe UI",sans-serif}',
	':root[data-darkmode="true"] .nm{' + DARK + '}',
	'@media (prefers-color-scheme:dark){:root:not([data-darkmode]) .nm{' + DARK + '}}',
	'.nm-card{border:1px solid var(--nm-line);border-radius:10px;padding:14px 16px;background:var(--nm-fill);margin-bottom:14px}',
	'.nm-card>h3{margin:0 0 10px;font-size:15px;display:flex;justify-content:space-between;align-items:center;border:0;padding:0}',
	'.nm-head{display:grid;grid-template-columns:minmax(220px,1fr) minmax(280px,1.4fr);gap:12px 24px}',
	'@media (max-width:760px){.nm-head{grid-template-columns:1fr}}',
	'.nm-badge{display:inline-block;padding:3px 12px;border-radius:12px;font-weight:600;color:#fff;font-size:14px}',
	'.nm-desc{margin-top:8px;line-height:1.5;opacity:.9}',
	'.nm-label{font-size:11px;text-transform:uppercase;letter-spacing:.05em;opacity:.65;margin:0 0 4px}',
	'.nm-seg{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px}',
	'.nm .nm-btn{font:inherit;color:inherit;background:transparent;border:1px solid var(--nm-line);border-radius:6px;',
	'padding:4px 10px;margin:0;cursor:pointer;line-height:1.4;min-height:0;box-shadow:none;text-shadow:none}',
	'.nm .nm-btn:hover{background:var(--nm-fill)}',
	'.nm .nm-btn.on{background:var(--nm-c1);border-color:var(--nm-c1);color:#fff}',
	'.nm .nm-btn.cur{box-shadow:inset 0 0 0 1px var(--nm-c1);border-color:var(--nm-c1)}',
	'.nm .nm-btn small{opacity:.75;margin-left:5px;font-size:11px}',
	'.nm .nm-btn[disabled]{opacity:.55;cursor:wait}',
	'.nm-note{font-size:12px;opacity:.7;line-height:1.45}',
	'.nm-tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:10px;margin-top:14px}',
	'.nm-tile{border:1px solid var(--nm-line);border-radius:8px;padding:8px 12px}',
	'.nm-tile .v{font-size:22px;font-weight:600;line-height:1.3}',
	'.nm-tile .v small{font-size:12px;font-weight:400;opacity:.7;margin-left:3px}',
	'.nm-tile .d{font-size:12px;opacity:.75;margin-top:2px;line-height:1.4}',
	'.nm-live{font-size:12px;font-weight:400;display:inline-flex;align-items:center;gap:6px;opacity:.85}',
	'.nm-live i{width:8px;height:8px;border-radius:50%;display:inline-block;background:var(--nm-good)}',
	'.nm-live.stale i{background:var(--nm-crit)}',
	'.nm-block{position:relative;padding-top:14px;margin-top:14px;border-top:1px solid var(--nm-line)}',
	'.nm-block:first-of-type{border-top:0;margin-top:4px;padding-top:4px}',
	'.nm-bh{display:flex;justify-content:space-between;align-items:flex-end;gap:12px;flex-wrap:wrap}',
	'.nm-bh .t{font-weight:600;font-size:14px}.nm-bh .s{opacity:.6;font-size:12px;margin-top:2px}',
	'.nm-bh .now{text-align:right}.nm-bh .now b{font-size:20px;font-weight:600}.nm-bh .now small{opacity:.7;margin-left:3px}',
	'.nm-bh .now div{font-size:12px;opacity:.7;font-variant-numeric:tabular-nums}',
	'.nm-legend{display:flex;flex-wrap:wrap;gap:4px 16px;font-size:12px;margin:8px 0 2px}',
	'.nm-legend span{display:inline-flex;align-items:center;gap:6px;opacity:.85}',
	'.nm-legend b{font-weight:600;font-variant-numeric:tabular-nums}',
	'.nm svg{display:block;overflow:visible}',
	'.nm svg.plot{width:100%;user-select:none}',
	'.nm-tip{position:absolute;pointer-events:none;z-index:5;padding:7px 10px;border-radius:7px;background:Canvas;color:CanvasText;',
	'box-shadow:0 4px 14px rgba(0,0,0,.28);border:1px solid var(--nm-line);white-space:nowrap;font-size:12px;',
	'font-variant-numeric:tabular-nums;line-height:1.6}',
	'.nm-tip b{font-weight:600;margin-right:6px}',
	'.nm-tip .k{display:inline-block;width:12px;height:2px;vertical-align:middle;margin-right:6px;border-radius:1px}',
	'.nm-tip .m{opacity:.65}',
	'.nm table td,.nm table th{font-variant-numeric:tabular-nums}',
	'.nm-bar-row{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:10px}',
	// full-screen monitor: LuCI's header, tabs and footer go, the page fills the window without scrolling
	'body.nm-kiosk{padding:0!important;margin:0!important;overflow:hidden}',
	'body.nm-kiosk>header,body.nm-kiosk>footer,body.nm-kiosk #tabmenu{display:none!important}',
	'body.nm-kiosk #maincontent{max-width:none!important;width:auto!important;margin:0!important;padding:10px 14px!important}',
	'.nm-mon{height:calc(100vh - 20px);display:flex;flex-direction:column;gap:10px}',
	'.nm-mon-bar{display:flex;flex-wrap:wrap;align-items:center;gap:8px 18px}',
	'.nm-mon-bar .nm-seg{margin:0;align-items:center}',
	'.nm-mon-bar .nm-label{margin:0 2px 0 0}',
	'.nm-mon-bar .grow{flex:1}',
	'.nm-mon-bar .nm-x{font-size:18px;text-decoration:none;opacity:.6;padding:0 4px;color:inherit}',
	'.nm-mon .nm-tiles{grid-template-columns:repeat(5,minmax(0,1fr));margin:0}',
	'.nm-mon .nm-tile .v{font-size:34px;line-height:1.15}',
	'.nm-mon-charts{flex:1;min-height:0;display:grid;gap:10px;grid-template-columns:minmax(0,1.7fr) minmax(0,1fr);',
	'grid-template-rows:minmax(0,1fr) minmax(0,1fr);grid-template-areas:"ping wans" "ping udp"}',
	'.nm-cell{border:1px solid var(--nm-line);border-radius:10px;padding:8px 12px;display:flex;flex-direction:column;min-height:0;background:var(--nm-fill)}',
	'.nm-cell-ping{grid-area:ping}.nm-cell-wans{grid-area:wans}.nm-cell-udp{grid-area:udp}',
	'.nm-cell .nm-plot{flex:1;min-height:0}',
	'.nm-cell .nm-legend{margin:4px 0 0}',
	'@media (max-width:1100px){.nm-mon-charts{grid-template-columns:minmax(0,1fr);grid-template-rows:minmax(0,2fr) minmax(0,1fr) minmax(0,1fr);',
	'grid-template-areas:"ping" "wans" "udp"}.nm-mon .nm-tiles{grid-template-columns:repeat(3,minmax(0,1fr))}}'
].join('');

function S(tag, attrs, children) {
	var n = document.createElementNS(SVGNS, tag);
	for (var k in attrs)
		if (attrs[k] != null)
			n.setAttribute(k, attrs[k]);
	(children || []).forEach(function(c) { n.appendChild(typeof(c) == 'string' ? document.createTextNode(c) : c); });
	return n;
}

function niceStep(v) {
	var p = Math.pow(10, Math.floor(Math.log10(v))), m = v / p;
	return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p;
}

function pad(n) { return (n < 10 ? '0' : '') + n; }

function hhmm(ts, secs) {
	var d = new Date(ts * 1000);
	return pad(d.getHours()) + ':' + pad(d.getMinutes()) + (secs ? ':' + pad(d.getSeconds()) : '');
}

// the colour behind a node, for the 2px surface rings around markers
function surfaceOf(node) {
	for (var n = node; n && n.nodeType == 1; n = n.parentNode) {
		var c = getComputedStyle(n).backgroundColor;
		if (c && c != 'transparent' && !/rgba\(.*,\s*0\)$/.test(c))
			return c;
	}
	return 'Canvas';
}

function fmt(v) { return String(+v.toFixed(v < 10 && v % 1 ? 1 : 0)); }

var hoverHide = function() {};

return baseclass.extend({
	S: S,
	hhmm: hhmm,
	color: function(i) { return 'var(--nm-c' + ((i % 8) + 1) + ')'; },

	status: function() { return L.resolveDefault(callStatus(), { running: false }); },
	history: function(since) { return L.resolveDefault(callHistory(since || 0), { points: [], probes: [] }); },
	live: function(since) { return L.resolveDefault(callLive(since || 0), { points: [] }); },
	matches: function(limit) { return L.resolveDefault(callMatches(limit || 500), { matches: [] }); },
	clearMatches: function() { return callClear(); },

	css: function() {
		if (!document.getElementById('nm-css'))
			document.head.appendChild(E('style', { 'id': 'nm-css' }, [ CSS ]));
	},

	devName: function(d) { return d.name || d.ip; },

	// a WAN by its display name (the label setting), else its interface name
	wl: function(st, w) { return (st && st.labels && st.labels[w]) || w; },

	dur: function(s) {
		s = Math.max(0, Math.round(s));
		return s < 3600 ? Math.floor(s / 60) + ':' + pad(s % 60) : Math.floor(s / 3600) + ':' + pad(Math.floor(s / 60) % 60) + ':' + pad(s % 60);
	},

	badge: function(st) {
		return st.state == 'game'
			? E('span', { 'class': 'nm-badge', 'style': 'background:#c0392b' }, [ '🎮 ' + _('Game mode') + ' · ' + this.wl(st, st.gw) ])
			: E('span', { 'class': 'nm-badge', 'style': 'background:#27ae60' }, [ '🚀 ' + _('All WANs') ]);
	},

	describe: function(st) {
		var names = (st.devices || []).map(this.devName).join(', ') || _('the gaming devices');
		return st.state == 'game'
			? _('Game WAN %s is reserved for %s; everyone else uses all the other WANs.').format(this.wl(st, st.gw), names)
			: _('Everyone uses every WAN; the game traffic of %s stays on %s.').format(names, this.wl(st, st.gw));
	},

	/* Mode and game-WAN buttons. refresh() is called after a change is applied. */
	controls: function(st, refresh) {
		var probe = {}, all = [], wl = this.wl.bind(this, st);
		var cands = (st.cands || []).map(wl).join(', ');
		(st.probe || []).forEach(function(p) { probe[p.wan] = p; });

		var btn = function(label, on, title, call, extra) {
			var b = E('button', { 'type': 'button', 'class': 'nm-btn' + (on ? ' on' : '') + (extra || ''), 'title': title }, label);
			b.addEventListener('click', function(ev) {
				ev.preventDefault();
				if (on) return;
				all.forEach(function(x) { x.disabled = true; });
				call().then(refresh).catch(function(e) {
					all.forEach(function(x) { x.disabled = false; });
					ui.addNotification(null, E('p', _('netmode: %s').format(e.message || e)), 'danger');
				});
			});
			all.push(b);
			return b;
		};

		var modes = E('div', { 'class': 'nm-seg' }, [
			btn(_('Auto'), st.mode == 'auto', _('Game mode while a gaming device plays'), function() { return callSetMode('auto'); }),
			btn('🎮 ' + _('Game'), st.mode == 'game', _('Game mode all the time'), function() { return callSetMode('game'); }),
			btn('🚀 ' + _('All WANs'), st.mode == 'all', _('Never game mode'), function() { return callSetMode('all'); })
		]);

		var gws = E('div', { 'class': 'nm-seg' }, [
			btn([ _('Auto'), st.gw_mode == 'auto' ? E('small', {}, [ wl(st.gw) ]) : '' ], st.gw_mode == 'auto',
				_('Best of %s, picked between matches').format(cands), function() { return callSetGw('auto'); })
		].concat((st.wans || []).map(function(w) {
			var p = probe[w], ms = p ? (p.p20 != null ? p.p20 + ' ms' : _('no reply')) : '';
			return btn([ (w == st.gw ? '● ' : '') + wl(w), ms ? E('small', {}, [ ms ]) : '' ], st.gw_mode == w,
				_('Lock the game WAN to %s now').format(wl(w) == w ? w : wl(w) + ' (' + w + ')'), function() { return callSetGw(w); }, w == st.gw ? ' cur' : '');
		})));

		var note = E('div', { 'class': 'nm-note' }, [
			'● ' + _('current game WAN.') + ' ' +
			(st.move_flows ? _('Picking a WAN locks it and moves running matches there now (the game freezes ~1 s).')
			               : _('Picking a WAN locks it for new connections; running matches stay where they are.')) + ' ' +
			_('Auto picks the best of %s between matches. WAN pings: 20th percentile of 10 pings.').format(cands)
		]);

		return { modes: modes, gws: gws, note: note };
	},

	/* A time-series chart drawn in a shared time frame (so several charts line up under one crosshair).
	 * sp: { W, H, frame: { L, R, t0, t1 }, unit, zero (y axis from 0), robust (rare spikes above the scale are clipped
	 *       and marked), minSpan (smallest y range), thresh: { v, label, dash } or a list of them (reference lines),
	 *       series: [{ label, color, pts: [[ts, v|null]], area, markers, dash, tol (s, hover snapping) }],
	 *       bands: [[ts0, ts1]] (shaded), marks: [{ ts, label }] (vertical markers), loss: [ts] (red ticks on top) }
	 * returns { svg, show(ts), hide() } */
	chart: function(sp) {
		var f = sp.frame, W = sp.W, H = sp.H, top = 18, bottom = 22, span = f.t1 - f.t0;
		var x = function(ts) { return f.L + (ts - f.t0) / span * (W - f.L - f.R); };

		var vals = [];
		sp.series.forEach(function(s) { s.pts.forEach(function(p) { if (p[0] >= f.t0 && p[1] != null) vals.push(p[1]); }); });
		vals.sort(function(a, b) { return a - b; });
		var q = function(p) { return vals[Math.min(vals.length - 1, Math.floor(p * (vals.length - 1)))]; };
		var vmax = vals.length ? vals[vals.length - 1] : 0, hi = vmax, lo = sp.zero || !vals.length ? 0 : vals[0];
		if (sp.robust && vals.length > 10) {
			var cap = Math.max(q(0.98) * 1.25, q(0.5) + (sp.minSpan || 20) * 1.5);
			if (vmax > cap) hi = cap;
		}
		var threshs = sp.thresh ? [].concat(sp.thresh) : [];
		threshs.forEach(function(t) { hi = Math.max(hi, t.v * 1.25); });
		var step = niceStep(Math.max(hi - lo, sp.minSpan || 1) / 4);
		var y0 = sp.zero ? 0 : Math.max(0, Math.floor((lo - step * 0.3) / step) * step);
		var y1 = Math.max(y0 + step, Math.ceil((hi + step * 0.1) / step) * step);
		var y = function(v) { return H - bottom - (Math.max(y0, Math.min(v, y1)) - y0) / (y1 - y0) * (H - bottom - top); };
		var ring = 'var(--nm-ring, Canvas)', clipped = [];

		var svg = S('svg', { 'class': 'plot', 'height': H, 'viewBox': '0 0 ' + W + ' ' + H, 'preserveAspectRatio': 'none' });

		(sp.bands || []).forEach(function(b) {
			if (b[1] <= f.t0) return;
			var a = Math.max(b[0], f.t0);
			svg.appendChild(S('rect', { 'x': x(a), 'y': top, 'width': Math.max(1, x(b[1]) - x(a)), 'height': H - bottom - top, 'fill': 'var(--nm-band)' }));
		});
		for (var v = y0; v <= y1 + 1e-9; v += step) {
			svg.appendChild(S('line', { 'x1': f.L, 'x2': W - f.R, 'y1': y(v), 'y2': y(v), 'stroke': v == y0 ? 'var(--nm-axis)' : 'var(--nm-grid)',
				'shape-rendering': 'crispEdges' }));
			svg.appendChild(S('text', { 'x': f.L - 8, 'y': y(v) + 4, 'text-anchor': 'end', 'fill': 'currentColor', 'fill-opacity': 0.55,
				'font-size': 11, 'style': 'font-variant-numeric:tabular-nums' }, [ fmt(v) + (v + step > y1 + 1e-9 ? ' ' + sp.unit : '') ]));
		}
		var ts = [ 60, 120, 300, 600, 900, 1800, 3600 ].filter(function(s) { return span / s <= 6; })[0] || 3600;
		for (var t = Math.ceil(f.t0 / ts) * ts; t <= f.t1; t += ts) {
			svg.appendChild(S('line', { 'x1': x(t), 'x2': x(t), 'y1': H - bottom, 'y2': H - bottom + 4, 'stroke': 'var(--nm-axis)' }));
			svg.appendChild(S('text', { 'x': x(t), 'y': H - 5, 'text-anchor': 'middle', 'fill': 'currentColor', 'fill-opacity': 0.55, 'font-size': 11 }, [ hhmm(t) ]));
		}
		var lastLabel = -1e9;
		(sp.marks || []).forEach(function(m) {
			if (m.ts < f.t0) return;
			var xx = x(m.ts);
			svg.appendChild(S('line', { 'x1': xx, 'x2': xx, 'y1': top - 6, 'y2': H - bottom, 'stroke': 'currentColor', 'stroke-opacity': 0.45 }));
			if (m.label && xx - lastLabel > 50) {
				svg.appendChild(S('text', { 'x': xx + 4, 'y': top - 7, 'fill': 'currentColor', 'fill-opacity': 0.75, 'font-size': 11 }, [ m.label ]));
				lastLabel = xx;
			}
		});
		// reference lines, labelled (when they have a label) above the line at the right end, or at the left end when
		// that would touch another label
		var labelYs = [];
		threshs.forEach(function(t) {
			var ty = y(t.v), left = labelYs.some(function(o) { return Math.abs(o - ty) < 14; });
			svg.appendChild(S('line', { 'x1': f.L, 'x2': W - f.R, 'y1': ty, 'y2': ty, 'stroke': 'currentColor',
				'stroke-opacity': 0.5, 'stroke-dasharray': t.dash || '5 4' }));
			if (!t.label) return;
			svg.appendChild(S('text', { 'x': left ? f.L + 6 : W - f.R, 'y': ty - 5, 'text-anchor': left ? 'start' : 'end', 'fill': 'currentColor',
				'fill-opacity': 0.65, 'font-size': 11 }, [ t.label ]));
			if (!left) labelYs.push(ty);
		});

		// series: area wash, 2px line, optional point markers; gaps where a value is missing
		sp.series.forEach(function(s) {
			var segs = [], cur = null;
			s.pts.forEach(function(p) {
				if (p[0] < f.t0) return;
				if (p[1] == null) { cur = null; return; }
				if (!cur) { cur = []; segs.push(cur); }
				cur.push([ x(p[0]), y(p[1]) ]);
				if (sp.robust && p[1] > y1) clipped.push([ x(p[0]), p[1] ]);
			});
			segs.forEach(function(seg) {
				var d = seg.map(function(pt, i) { return (i ? 'L' : 'M') + pt[0].toFixed(1) + ',' + pt[1].toFixed(1); }).join('');
				if (s.area && seg.length > 1)
					svg.appendChild(S('path', { 'd': d + 'L' + seg[seg.length - 1][0].toFixed(1) + ',' + (H - bottom) + 'L' + seg[0][0].toFixed(1) + ',' + (H - bottom) + 'Z',
						'fill': s.color, 'fill-opacity': 0.1, 'stroke': 'none' }));
				svg.appendChild(S('path', { 'd': d, 'fill': 'none', 'stroke': s.color, 'stroke-width': s.width || 2, 'stroke-opacity': s.opacity || null,
					'stroke-dasharray': s.dash || null, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
				if (s.markers || (seg.length == 1 && !s.opacity))
					seg.forEach(function(pt) { svg.appendChild(S('circle', { 'cx': pt[0], 'cy': pt[1], 'r': 3, 'fill': s.color, 'stroke': ring, 'stroke-width': 1.5 })); });
			});
		});
		// spikes above the scale: a small triangle on the top edge (the tooltip has the value)
		clipped.forEach(function(c) {
			svg.appendChild(S('path', { 'd': 'M' + (c[0] - 4) + ',' + (top + 1) + 'L' + (c[0] + 4) + ',' + (top + 1) + 'L' + c[0] + ',' + (top - 5) + 'Z',
				'fill': 'currentColor', 'fill-opacity': 0.75 }));
		});
		(sp.loss || []).forEach(function(lt) {
			if (lt < f.t0) return;
			svg.appendChild(S('line', { 'x1': x(lt), 'x2': x(lt), 'y1': top, 'y2': top + 7, 'stroke': 'var(--nm-crit)', 'stroke-width': 2, 'stroke-linecap': 'round' }));
		});

		var cross = S('line', { 'y1': top - 6, 'y2': H - bottom, 'stroke': 'currentColor', 'stroke-opacity': 0.5, 'visibility': 'hidden', 'pointer-events': 'none' });
		svg.appendChild(cross);
		var dots = sp.series.map(function(s) {
			var c = S('circle', { 'r': s.opacity ? 3 : 4.5, 'fill': s.color, 'fill-opacity': s.opacity || null, 'stroke': ring, 'stroke-width': 2,
				'visibility': 'hidden', 'pointer-events': 'none' });
			svg.appendChild(c);
			return c;
		});
		svg.appendChild(S('rect', { 'x': f.L, 'y': 0, 'width': Math.max(0, W - f.L - f.R), 'height': H, 'fill': 'transparent' }));

		return {
			svg: svg,
			x: x,
			W: W, L: f.L, R: f.R, t0: f.t0, t1: f.t1,
			clipped: clipped.length,
			show: function(at) {
				var xx = x(at);
				cross.setAttribute('x1', xx); cross.setAttribute('x2', xx); cross.setAttribute('visibility', 'visible');
				sp.series.forEach(function(s, i) {
					var best = null, tol = s.tol || 5;
					s.pts.forEach(function(p) { if (p[1] != null && Math.abs(p[0] - at) <= tol && (!best || Math.abs(p[0] - at) < Math.abs(best[0] - at))) best = p; });
					if (best) { dots[i].setAttribute('cx', x(best[0])); dots[i].setAttribute('cy', y(best[1])); dots[i].setAttribute('visibility', 'visible'); }
					else dots[i].setAttribute('visibility', 'hidden');
				});
			},
			hide: function() {
				cross.setAttribute('visibility', 'hidden');
				dots.forEach(function(d) { d.setAttribute('visibility', 'hidden'); });
			}
		};
	},

	/* One crosshair across charts that share a time range (any sizes / positions) and one tooltip at the pointer.
	 * times: sorted timestamps to snap to; tip(ts) -> [nodes]; state keeps the hover across the 1 s redraws */
	hoverGroup: function(charts, times, tip, state) {
		var box = document.getElementById('nm-tip');
		if (!box) {
			box = E('div', { 'id': 'nm-tip', 'class': 'nm nm-tip', 'style': 'display:none;position:fixed' });
			document.body.appendChild(box);
			// a redraw replaces the charts under the pointer: hide when the pointer is no longer on any chart
			document.addEventListener('pointermove', function(ev) { if (!ev.target.closest || !ev.target.closest('svg.plot')) hoverHide(); });
		}
		var show = function(at, cx, cy) {
			if (!times.length) return;
			var lo = 0, hi = times.length - 1;
			while (hi - lo > 1) { var mid = (lo + hi) >> 1; if (times[mid] < at) lo = mid; else hi = mid; }
			var best = Math.abs(times[lo] - at) <= Math.abs(times[hi] - at) ? times[lo] : times[hi];
			state.hover = best; state.cx = cx; state.cy = cy;
			charts.forEach(function(c) { c.show(best); });
			box.replaceChildren.apply(box, tip(best));
			box.style.display = '';
			var w = box.offsetWidth, h = box.offsetHeight, left = cx + 18, top = cy + 14;
			if (left + w > window.innerWidth - 8) left = cx - w - 18;
			if (top + h > window.innerHeight - 8) top = window.innerHeight - h - 8;
			box.style.left = Math.max(4, left) + 'px';
			box.style.top = Math.max(4, top) + 'px';
		};
		hoverHide = function() {
			state.hover = null;
			box.style.display = 'none';
			charts.forEach(function(c) { c.hide(); });
		};
		charts.forEach(function(c) {
			c.svg.addEventListener('pointermove', function(ev) {
				var r = c.svg.getBoundingClientRect(), vx = (ev.clientX - r.left) * c.W / r.width;
				show(c.t0 + (vx - c.L) / (c.W - c.L - c.R) * (c.t1 - c.t0), ev.clientX, ev.clientY);
			});
		});
		if (state.hover != null && charts.length && state.hover >= charts[0].t0) show(state.hover, state.cx, state.cy); else hoverHide();
	},

	tipRow: function(value, label, color) {
		return E('div', {}, [ color ? E('span', { 'class': 'k', 'style': 'background:' + color }) : '', E('b', {}, [ value ]), E('span', { 'class': 'm' }, [ label ]) ]);
	},

	/* legend items: [keyNode, label, value?] */
	legend: function(items) {
		return E('div', { 'class': 'nm-legend' }, items.map(function(it) {
			return E('span', {}, [ it[0], it[1], it[2] != null ? E('b', {}, [ it[2] ]) : '' ]);
		}));
	},

	lineKey: function(color, dash) {
		return S('svg', { 'width': 16, 'height': 10 }, [ S('line', { 'x1': 1, 'y1': 5, 'x2': 15, 'y2': 5, 'stroke': color,
			'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-dasharray': dash || null }) ]);
	},

	bandKey: function() {
		return S('svg', { 'width': 16, 'height': 12 }, [ S('rect', { 'x': 1, 'y': 1, 'width': 14, 'height': 10, 'rx': 2, 'fill': 'var(--nm-band)' }) ]);
	},

	markKey: function() {
		return S('svg', { 'width': 10, 'height': 12 }, [ S('line', { 'x1': 5, 'y1': 0, 'x2': 5, 'y2': 12, 'stroke': 'currentColor', 'stroke-opacity': 0.5 }) ]);
	},

	lossKey: function() {
		return S('svg', { 'width': 10, 'height': 12 }, [ S('line', { 'x1': 5, 'y1': 2, 'x2': 5, 'y2': 10, 'stroke': 'var(--nm-crit)', 'stroke-width': 2, 'stroke-linecap': 'round' }) ]);
	},

	spikeKey: function() {
		return S('svg', { 'width': 10, 'height': 10 }, [ S('path', { 'd': 'M1,9L9,9L5,2Z', 'fill': 'currentColor', 'fill-opacity': 0.75 }) ]);
	},

	boardLoad: function() {
		return Promise.all([ this.status(), this.history(0), this.live(0) ]);
	},

	/* The live board: status, controls, tiles and the three charts, refreshed every second. The 5 and 15 min
	 * ranges use the sampler's 1 s points, 1 h and 3 h the daemon's 10 s history.
	 * kiosk: full-screen layout for a second monitor (LuCI's chrome hidden, charts sized to the window). */
	board: function(res, kiosk, poll) {
		var nm = this;
		var LIVE_KEEP = 900, HIST_KEEP = 10800;
		var RANGES = [ [ 300, _('5 min') ], [ 900, _('15 min') ], [ 3600, _('1 h') ], [ 10800, _('3 h') ] ];
		var SRC = { server: _('the game server itself'), edge: _('the last router in front of the game server'), default: _('default target') };
		var d = { st: {}, hist: [], probes: [], live: [], histLast: 0, liveLast: 0, n: 0, key: '', ok: Date.now() };
		var vs = { range: 900, hover: null };
		var kbs = function(v) { return v == null ? '—' : v < 10 ? v.toFixed(1) : String(Math.round(v)); };
		var tile = function(label, value, unit, desc) {
			return E('div', { 'class': 'nm-tile' }, [ E('div', { 'class': 'nm-label' }, [ label ]),
				E('div', { 'class': 'v' }, [ value, unit ? E('small', {}, [ unit ]) : '' ]), E('div', { 'class': 'd' }, desc) ]);
		};
		var stats = function(rows) {
			var v = rows.filter(function(r) { return r.ping != null; }).map(function(r) { return r.ping; }), j = 0;
			for (var i = 1; i < v.length; i++) j += Math.abs(v[i] - v[i - 1]);
			var lost = rows.reduce(function(s, r) { return s + (r.lossPct || 0); }, 0);
			return { avg: v.length ? v.reduce(function(s, x) { return s + x; }, 0) / v.length : null,
				jitter: v.length > 1 ? j / (v.length - 1) : null, loss: rows.length ? lost / rows.length : null };
		};

		var merge = function(st, h, lv) {
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
		};
		// rows in one shape for both sources: { ts, ping, lossPct, state, gw, dev: { ip: upload KB/s }, down: { ip: KB/s } }
		var rows = function(useLive) {
			var iv = d.st.interval || 10, liveOn = d.st.ping != null;
			var kb = function(o, div) { var r = {}; for (var k in (o || {})) r[k] = o[k] / div / 1024; return r; };
			return useLive
				// ping null = no reply (loss), false = not measured (nobody was watching)
				? d.live.map(function(p) { return { ts: p[0], ping: p[1] === false ? null : p[1], lossPct: liveOn && p[1] === null ? 100 : 0, state: p[2], gw: p[3],
					dev: kb(p[4], 1), down: kb(p[5], 1) }; })
				: d.hist.map(function(p) { return { ts: p[0], ping: p[2], lossPct: p[3], state: p[4], gw: p[5], dev: kb(p[6], iv), down: kb(p[7], iv) }; });
		};
		merge(res[0], res[1], res[2]);

		// skeleton: built once, parts refreshed every second
		var root = E('div', { 'class': 'nm' + (kiosk ? ' nm-mon' : '') });
		var bar = E('div', { 'class': kiosk ? 'nm-mon-bar' : '' }), tiles = E('div', { 'class': 'nm-tiles' });
		var rangeBox = E('div', { 'class': 'nm-seg', 'style': 'margin:0' }), live = E('span', { 'class': 'nm-live' });
		var cells = {};
		[ 'ping', 'udp', 'wans' ].forEach(function(k) {
			var c = { head: E('div', { 'class': 'nm-bh' }), legend: E('div'), plot: E('div', { 'class': 'nm-plot' }) };
			c.node = E('div', { 'class': kiosk ? 'nm-cell nm-cell-' + k : 'nm-block' }, [ c.head, c.legend, c.plot ]);
			cells[k] = c;
		});
		var cellNodes = [ cells.ping.node, cells.udp.node, cells.wans.node ];
		if (kiosk) {
			document.body.classList.add('nm-kiosk');
			root.appendChild(bar);
			root.appendChild(tiles);
			root.appendChild(E('div', { 'class': 'nm-mon-charts' }, cellNodes));
		} else {
			var full = E('a', { 'class': 'nm-btn', 'href': L.url('admin/services/netmode/monitor'), 'title': _('Full-screen view for a second monitor (F11 for a full browser window)') }, [ '⛶ ' + _('Monitor') ]);
			root.appendChild(E('div', { 'class': 'nm-card' }, [ E('h3', {}, [ _('Network mode'), live ]), bar, tiles ]));
			root.appendChild(E('div', { 'class': 'nm-card' }, [ E('h3', {}, [ _('Graphs'), E('span', { 'class': 'nm-seg', 'style': 'margin:0' }, [ rangeBox, full ]) ]) ].concat(cellNodes)));
		}

		var refresh = function() {
			return nm.status().then(function(st) { merge(st); d.key = ''; drawBar(); drawTiles(); });
		};

		// status + controls: rebuilt only when the state behind the buttons changes (a rebuild every second would
		// swallow clicks)
		var drawBar = function() {
			var st = d.st;
			live.replaceChildren(E('i'), Date.now() - d.ok < 6000 ? _('live') : _('no data'));
			live.className = 'nm-live' + (Date.now() - d.ok < 6000 ? '' : ' stale');
			if (!st.running) {
				d.key = '';
				bar.replaceChildren(E('em', {}, [ _('netmode is not running (/etc/init.d/netmode start)') ]));
				return;
			}
			var key = JSON.stringify([ st.mode, st.state, st.gw, st.gw_mode, st.wans, st.labels, st.cands, st.move_flows, st.probe, st.target,
				(st.devices || []).map(function(x) { return [ x.ip, x.name, x.playing ]; }) ]);
			if (key == d.key) return;
			d.key = key;
			var c = nm.controls(st, refresh);
			var playing = (st.devices || []).filter(function(x) { return x.playing; });
			if (kiosk) {
				bar.replaceChildren(nm.badge(st),
					E('div', { 'class': 'nm-seg' }, [ E('span', { 'class': 'nm-label' }, [ _('Mode') ]) ].concat([].slice.call(c.modes.children))),
					E('div', { 'class': 'nm-seg' }, [ E('span', { 'class': 'nm-label' }, [ _('Game WAN') ]) ].concat([].slice.call(c.gws.children))),
					E('span', { 'class': 'grow' }),
					E('span', { 'class': 'nm-note', 'title': SRC[st.target_src] || '' }, [ st.probe_kind == 'region' && st.region
						? _('WAN pings to %s (%s)').format(st.region.name, st.region.id) : _('probe target %s').format(st.target) ]),
					rangeBox, live,
					E('a', { 'class': 'nm-x', 'href': L.url('admin/services/netmode/dashboard'), 'title': _('Back to the dashboard') }, [ '✕' ]));
			} else {
				bar.replaceChildren(E('div', { 'class': 'nm-head' }, [
					E('div', {}, [ nm.badge(st), E('div', { 'class': 'nm-desc' }, [ nm.describe(st) ]),
						E('div', { 'class': 'nm-desc' }, [ _('Mode %s').format(st.mode) + ' · ' +
							(playing.length ? _('%s playing').format(playing.map(nm.devName).join(', ')) : _('nobody playing')) + ' · ' +
							_('game WAN %s').format(st.gw_mode == 'auto' ? _('auto') : _('locked to %s').format(nm.wl(st, st.gw_mode))) ]) ]),
					E('div', {}, [ E('div', { 'class': 'nm-label' }, [ _('Mode') ]), c.modes, E('div', { 'class': 'nm-label' }, [ _('Game WAN') ]), c.gws, c.note ])
				]));
			}
		};

		var drawTiles = function() {
			var st = d.st;
			if (!st.running) { tiles.replaceChildren(); return; }
			var lv = rows(true), now = d.liveLast || st.ts, gw = nm.wl(st, st.gw);
			var last = lv.length && now - lv[lv.length - 1].ts <= 3 ? lv[lv.length - 1] : null;
			var s = stats(lv.filter(function(r) { return r.ts > now - 60; })), p = st.ping;
			// upload: the last 10 s on average, like the graph and the game detection
			var r10 = lv.filter(function(r) { return r.ts > now - 10; });
			var rate = function(ip, dir) { return r10.length ? r10.reduce(function(a, r) { return a + (r[dir || 'dev'][ip] || 0); }, 0) / r10.length : null; };
			var devs = st.devices || [];
			var total = devs.reduce(function(a, x) { return a + (rate(x.ip) || 0); }, 0), totalDown = devs.reduce(function(a, x) { return a + (rate(x.ip, 'down') || 0); }, 0);
			var pingNow = last && p != null ? (last.ping != null ? String(Math.round(last.ping)) : _('lost')) : (p && p.avg != null ? String(Math.round(p.avg)) : '—');
			var match = st.match
				? tile(_('Match'), nm.dur(now - st.match.start), '', [ _('since %s · on %s').format(nm.hhmm(st.match.start), gw) ])
				: tile(_('Match'), '—', '', [ _('no match running · '), E('a', { 'href': L.url('admin/services/netmode/matches') }, [ _('reports') ]) ]);
			var devTile = tile(_('Gaming devices · UDP'), '↑ ' + kbs(total) + '  ↓ ' + kbs(totalDown), 'KB/s', devs.length ? devs.map(function(x) {
				return E('div', {}, [ nm.devName(x) + ': ↑ ' + kbs(rate(x.ip)) + ' · ↓ ' + kbs(rate(x.ip, 'down')) + ' KB/s' + (x.playing ? ' · ' + _('playing') : '') ]);
			}) : [ E('a', { 'href': L.url('admin/services/netmode/settings') }, [ _('pick your gaming devices in Settings') ]) ]);
			if (kiosk)
				tiles.replaceChildren(
					tile(_('Ping now'), pingNow, pingNow == '—' || pingNow == _('lost') ? '' : 'ms', [ _('via %s · 1 ping per second').format(gw) ]),
					tile(_('Avg · 60 s'), s.avg != null ? String(Math.round(s.avg)) : '—', s.avg != null ? 'ms' : '', [ _('10 s median on the graph') ]),
					tile(_('Jitter · loss · 60 s'), s.jitter != null ? s.jitter.toFixed(1) : '—', 'ms', [ _('loss %s %%').format(s.loss != null ? s.loss.toFixed(1) : '—') ]),
					devTile, match);
			else
				tiles.replaceChildren(
					tile(_('Game WAN ping'), pingNow, pingNow == '—' || pingNow == _('lost') ? '' : 'ms',
						[ s.avg != null ? _('last 60 s: avg %d ms · jitter %.1f ms · loss %d %%').format(Math.round(s.avg), s.jitter || 0, Math.round(s.loss)) : '',
						  E('div', {}, [ _('via %s to %s').format(gw, st.target) ]) ]),
					devTile, match,
					st.probe_kind == 'region' && st.region
						? tile(_('Game region'), st.region.name, '', [ (st.region.provider == 'gcp' ? 'Google Cloud ' : 'AWS ') + st.region.id +
							(st.server && st.server != '-' ? ' · ' + _('server %s').format(st.server) : '') + ' · ' + _('WAN pings measure this region') ])
						: tile(_('Probe target'), st.target, '', [ (SRC[st.target_src] || st.target_src) + (st.target_src != 'server' && st.server && st.server != '-' ? ' · ' + _('game server %s').format(st.server) : '') ]));
		};

		var drawCharts = function() {
			var st = d.st, useLive = vs.range <= LIVE_KEEP, all = rows(useLive);
			var t1 = useLive ? (d.liveLast || st.ts) : (d.histLast || st.ts), t0 = t1 - vs.range;
			var rs = all.filter(function(r) { return r.ts > t0; });
			var probes = d.probes.filter(function(p) { return p[0] > t0 - 60; });
			var devs = st.game_ips || [], wans = st.wans || [], iv = st.interval || 10, names = {};
			(st.devices || []).forEach(function(x) { names[x.ip] = nm.devName(x); });

			rangeBox.replaceChildren.apply(rangeBox, RANGES.map(function(r) {
				var b = E('button', { 'type': 'button', 'class': 'nm-btn' + (r[0] == vs.range ? ' on' : '') }, [ r[1] ]);
				b.addEventListener('click', function() { vs.range = r[0]; vs.hover = null; drawCharts(); });
				return b;
			}));

			var size = function(c, h) {
				return { W: Math.max(240, c.plot.clientWidth || (root.clientWidth || 940) - 34), H: kiosk ? Math.max(100, c.plot.clientHeight) : h };
			};
			var head = function(c, title, sub, nowVal, nowUnit, nowSub) {
				c.head.replaceChildren(
					E('div', {}, [ E('div', { 'class': 't' }, [ title ]), E('div', { 'class': 's' }, [ sub ]) ]),
					E('div', { 'class': 'now' }, [ E('b', {}, [ nowVal ]), nowUnit ? E('small', {}, [ nowUnit ]) : '', nowSub ? E('div', {}, [ nowSub ]) : '' ]));
			};
			var empty = function(c, text) { c.legend.replaceChildren(); c.plot.replaceChildren(E('em', { 'class': 'nm-note' }, [ text ])); };

			if (rs.length < 2) {
				[ 'ping', 'udp', 'wans' ].forEach(function(k) { cells[k].head.replaceChildren(); empty(cells[k], useLive ? _('Collecting data… (one point per second)') : _('Collecting data… (one point every %d s)').format(iv)); });
				return;
			}

			var step = useLive ? 1 : iv, bands = [], marks = [], start = null;
			rs.forEach(function(r, i) {
				var next = rs[i + 1];
				if (r.state == 'game' && start == null) start = r.ts - step;
				if (r.state == 'game' && (!next || next.state != 'game')) { bands.push([ start, r.ts ]); start = null; }
				if (i > 0 && r.gw != rs[i - 1].gw) marks.push({ ts: r.ts, label: '→ ' + nm.wl(st, r.gw) });
			});
			var loss = rs.filter(function(r) { return r.lossPct > 0; }).map(function(r) { return r.ts; });
			var frame = function(sz) { return { L: 52, R: 16, t0: t0, t1: t1 }; };
			var charts = [];

			// game WAN ping: live = faint 1 s pings under a 10 s rolling median
			var med = {};
			if (useLive) rs.forEach(function(r, i) {
				var w = [];
				for (var k = i; k >= 0 && rs[k].ts > r.ts - 10; k--) if (rs[k].ping != null) w.push(rs[k].ping);
				w.sort(function(a, b) { return a - b; });
				med[r.ts] = w.length >= 3 ? (w.length % 2 ? w[(w.length - 1) / 2] : (w[w.length / 2 - 1] + w[w.length / 2]) / 2) : null;
			});
			var s = stats(rs), lastPing = null;
			for (var i = rs.length - 1; i >= 0 && lastPing == null; i--) if (rs[i].ping != null) lastPing = rs[i].ping;
			var sz = size(cells.ping, 220);
			var c1 = nm.chart({ W: sz.W, H: sz.H, frame: frame(sz), unit: 'ms', robust: true, minSpan: 20, bands: bands, marks: marks, loss: loss,
				series: useLive
					? [ { label: _('ping'), color: nm.color(0), width: 1, opacity: 0.4, tol: 1.5, pts: rs.map(function(r) { return [ r.ts, r.ping ]; }) },
					    { label: _('10 s median'), color: nm.color(0), area: true, tol: 1.5, pts: rs.map(function(r) { return [ r.ts, med[r.ts] ]; }) } ]
					: [ { label: _('ping'), color: nm.color(0), area: true, tol: step * 1.5, pts: rs.map(function(r) { return [ r.ts, r.ping ]; }) } ] });
			var leg = useLive
				? [ [ nm.lineKey(nm.color(0)), _('10 s median') ], [ S('svg', { 'width': 16, 'height': 10 }, [ S('line', { 'x1': 1, 'y1': 5, 'x2': 15, 'y2': 5,
					'stroke': nm.color(0), 'stroke-width': 1, 'stroke-opacity': 0.5 }) ]), _('each ping') ] ]
				: [ [ nm.lineKey(nm.color(0)), _('average of 5 pings every %d s').format(iv) ] ];
			if (bands.length) leg.push([ nm.bandKey(), _('game mode') ]);
			if (marks.length) leg.push([ nm.markKey(), _('game WAN switch') ]);
			if (loss.length) leg.push([ nm.lossKey(), _('packet loss') ]);
			if (c1.clipped) leg.push([ nm.spikeKey(), _('spike above the scale') ]);
			head(cells.ping, _('Game WAN ping'), _('ms · through the game WAN to the probe target'), lastPing != null ? String(Math.round(lastPing)) : '—', 'ms',
				s.avg != null ? _('avg %d · jitter %.1f · loss %.1f %%').format(Math.round(s.avg), s.jitter || 0, s.loss) : '');
			cells.ping.legend.replaceChildren(nm.legend(leg));
			cells.ping.plot.replaceChildren(c1.svg);
			charts.push(c1);

			// gaming devices' UDP upload and download: the average over the last 10 s, the window game detection uses (the
			// 1 s values are bursts between 0 and ~90 KB/s, so they are only in the tooltip); the game mode and match
			// levels are upload levels. One device: upload and download in two colours; several: a colour per device,
			// download dashed.
			var avg = { dev: {}, down: {} }, win = useLive ? all.filter(function(r) { return r.ts > t0 - 10; }) : null;
			devs.forEach(function(ip) { avg.dev[ip] = {}; avg.down[ip] = {}; });
			[ 'dev', 'down' ].forEach(function(dir) {
				if (useLive) {
					win.forEach(function(r, i) {
						devs.forEach(function(ip) {
							var sum = 0, n = 0;
							for (var k = i; k >= 0 && win[k].ts > r.ts - 10; k--) { sum += win[k][dir][ip] || 0; n++; }
							avg[dir][ip][r.ts] = sum / n;
						});
					});
				}
				else rs.forEach(function(r) { devs.forEach(function(ip) { avg[dir][ip][r.ts] = r[dir][ip] || 0; }); });
			});
			var one = devs.length == 1, upColor = function(i) { return nm.color(i); }, downColor = function(i) { return nm.color(one ? 1 : i); };
			var gmKB = (st.thresh || 0) / iv / 1024, mKB = (st.match_thresh || 0) / iv / 1024, tLast = rs[rs.length - 1].ts;
			var upNow = {}, downNow = {}, totalUp = 0, totalDown = 0, topNow = 0;
			devs.forEach(function(ip) {
				upNow[ip] = avg.dev[ip][tLast] || 0; downNow[ip] = avg.down[ip][tLast] || 0;
				totalUp += upNow[ip]; totalDown += downNow[ip]; topNow = Math.max(topNow, upNow[ip]);
			});
			// unlabelled in the plot (the labels sat on the newest data): the legend names both dash patterns
			var levels = [ { v: gmKB, dash: '2 3' } ];
			if (mKB > gmKB) levels.push({ v: mKB, dash: '7 4' });
			var mstart = st.match && st.match.start > t0 ? [ { ts: st.match.start, label: _('match start') } ] : [];
			var udpSeries = [];
			devs.forEach(function(ip, i) {
				var nmd = one ? '' : (names[ip] || ip) + ' ';
				udpSeries.push({ label: nmd + _('download'), color: downColor(i), dash: one ? null : '6 3', tol: step * 1.5,
					pts: rs.map(function(r) { return [ r.ts, avg.down[ip][r.ts] ]; }) });
				udpSeries.push({ label: nmd + _('upload'), color: upColor(i), area: one, tol: step * 1.5,
					pts: rs.map(function(r) { return [ r.ts, avg.dev[ip][r.ts] ]; }) });
			});
			sz = size(cells.udp, 170);
			var c2 = nm.chart({ W: sz.W, H: sz.H, frame: frame(sz), unit: 'KB/s', zero: true, robust: true, minSpan: 2, bands: bands,
				marks: mstart, thresh: levels, series: udpSeries });
			head(cells.udp, _('Gaming devices UDP traffic'), _('KB/s · 10 s average · game detection counts the upload · DNS, NTP, QUIC and LAN not counted'),
				'↑ ' + kbs(totalUp) + '  ↓ ' + kbs(totalDown), 'KB/s',
				mKB > gmKB && topNow >= mKB ? _('upload at match level') : topNow >= gmKB ? _('upload at game mode level (lobby, loading)') : _('upload below the game mode level'));
			var uleg = [];
			devs.forEach(function(ip, i) {
				var nmd = one ? '' : (names[ip] || ip) + ' ';
				uleg.push([ nm.lineKey(upColor(i)), nmd + '↑ ' + _('upload'), kbs(upNow[ip]) + ' KB/s' ]);
				uleg.push([ nm.lineKey(downColor(i), one ? null : '6 3'), nmd + '↓ ' + _('download'), kbs(downNow[ip]) + ' KB/s' ]);
			});
			uleg.push([ nm.lineKey('currentColor', '2 3'), _('game mode level: upload ≥ %s KB/s').format(kbs(gmKB)) ]);
			if (mKB > gmKB) uleg.push([ nm.lineKey('currentColor', '7 4'), _('match level: upload ≥ %s KB/s').format(kbs(mKB)) ]);
			if (mstart.length) uleg.push([ nm.markKey(), _('match start') ]);
			if (bands.length) uleg.push([ nm.bandKey(), _('game mode') ]);
			if (c2.clipped) uleg.push([ nm.spikeKey(), _('burst above the scale') ]);
			cells.udp.legend.replaceChildren(nm.legend(uleg));
			cells.udp.plot.replaceChildren(c2.svg);
			charts.push(c2);

			// WAN pings (probe rounds)
			if (probes.length) {
				var lastProbe = probes[probes.length - 1][1];
				head(cells.wans, _('WAN pings'), st.probe_kind == 'region' && st.region
					? _('ms · round trip to the game region (%s) through each WAN, every probe round').format(st.region.name)
					: _('ms · 20th percentile of 10 pings per WAN to %s, every probe round').format(st.target), '', '');
				cells.wans.legend.replaceChildren(nm.legend(wans.map(function(w, i) {
					return [ nm.lineKey(nm.color(i)), nm.wl(st, w) + (w == st.gw ? ' (' + _('game WAN') + ')' : ''), lastProbe[w] != null ? lastProbe[w] + ' ms' : _('no reply') ];
				})));
				sz = size(cells.wans, 200);
				var c3 = nm.chart({ W: sz.W, H: sz.H, frame: frame(sz), unit: 'ms', robust: true, minSpan: 20, bands: bands, marks: marks,
					series: wans.map(function(w, i) {
						return { label: nm.wl(st, w), color: nm.color(i), markers: true, tol: 45, pts: probes.map(function(p) { return [ p[0], p[1][w] != null ? p[1][w] : null ]; }) };
					}) });
				cells.wans.plot.replaceChildren(c3.svg);
				charts.push(c3);
			} else {
				head(cells.wans, _('WAN pings'), _('ms · every probe round'), '', '');
				empty(cells.wans, _('Waiting for the first probe round…'));
			}

			var byTs = {};
			rs.forEach(function(r) { byTs[r.ts] = r; });
			nm.hoverGroup(charts, rs.map(function(r) { return r.ts; }), function(ts) {
				var r = byTs[ts], out = [ E('div', { 'class': 'm' }, [ nm.hhmm(ts, true) + ' · ' + (r.state == 'game' ? _('game mode') : _('all WANs')) + ' · ' + _('game WAN %s').format(nm.wl(st, r.gw)) ]) ];
				out.push(nm.tipRow(r.ping != null ? r.ping.toFixed(1) + ' ms' : _('no reply'), _('ping'), nm.color(0)));
				if (useLive && med[ts] != null) out.push(nm.tipRow(Math.round(med[ts]) + ' ms', _('10 s median'), nm.color(0)));
				if (!useLive) out.push(nm.tipRow(r.lossPct != null ? r.lossPct + ' %' : '—', _('packet loss')));
				devs.forEach(function(ip, i) {
					var nmd = one ? '' : (names[ip] || ip) + ' ';
					out.push(nm.tipRow(kbs(avg.dev[ip][ts]) + ' KB/s', nmd + '↑ ' + _('upload') + (useLive ? ', ' + _('10 s average') : ''), upColor(i)));
					out.push(nm.tipRow(kbs(avg.down[ip][ts]) + ' KB/s', nmd + '↓ ' + _('download') + (useLive ? ', ' + _('10 s average') : ''), downColor(i)));
					if (useLive) out.push(nm.tipRow('↑ ' + kbs(r.dev[ip] || 0) + ' · ↓ ' + kbs(r.down[ip] || 0) + ' KB/s', _('in that second')));
				});
				var pr = null;
				probes.forEach(function(p) { if (Math.abs(p[0] - ts) <= 90 && (!pr || Math.abs(p[0] - ts) < Math.abs(pr[0] - ts))) pr = p; });
				if (pr) wans.forEach(function(w, i) { out.push(nm.tipRow(pr[1][w] != null ? pr[1][w] + ' ms' : _('no reply'), nm.wl(st, w), nm.color(i))); });
				return out;
			}, vs);
		};

		var tick = function() {
			d.n++;
			return Promise.all([ nm.status(), nm.live(d.liveLast), d.n % 5 == 0 ? nm.history(d.histLast) : null ]).then(function(r) {
				if (r[0] && r[0].ts) d.ok = Date.now();
				merge(r[0], r[2], r[1]);
				drawBar(); drawTiles(); drawCharts();
			});
		};

		drawBar(); drawTiles();
		poll.add(tick, 1);
		var t = null;
		window.addEventListener('resize', function() { clearTimeout(t); t = setTimeout(drawCharts, 120); });
		requestAnimationFrame(function() { root.style.setProperty('--nm-ring', surfaceOf(root)); drawCharts(); });
		return root;
	},

	/* One row per group, a dot per match at its average ping, a tick at the median.
	 * rows: [{ label, values: [{ v, tip: [lines] }] }] */
	strip: function(rows, width) {
		var host = E('div', { 'class': 'nm-block', 'style': 'border:0;padding:0' }), tip = E('div', { 'class': 'nm-tip', 'style': 'display:none' });
		var all = [];
		rows.forEach(function(r) { r.values.forEach(function(v) { all.push(v.v); }); });
		if (!all.length) return host;
		var lo = Math.min.apply(null, all), hi = Math.max.apply(null, all);
		var step = niceStep(Math.max(hi - lo, 10) / 5), x0 = Math.floor(lo / step) * step, x1 = Math.ceil(hi / step) * step;
		if (x1 == x0) x1 = x0 + step;
		var W = width || 900, L = 140, R = 24, RH = 34, T = 6, H = T + rows.length * RH + 22;
		var x = function(v) { return L + (v - x0) / (x1 - x0) * (W - L - R); };
		var s = S('svg', { 'class': 'plot', 'height': H, 'viewBox': '0 0 ' + W + ' ' + H, 'preserveAspectRatio': 'none' });
		for (var v = x0; v <= x1 + 1e-9; v += step) {
			s.appendChild(S('line', { 'x1': x(v), 'x2': x(v), 'y1': T, 'y2': H - 22, 'stroke': 'var(--nm-grid)', 'shape-rendering': 'crispEdges' }));
			s.appendChild(S('text', { 'x': x(v), 'y': H - 6, 'text-anchor': 'middle', 'fill': 'currentColor', 'fill-opacity': 0.55, 'font-size': 11 },
				[ fmt(v) + (v + step > x1 + 1e-9 ? ' ms' : '') ]));
		}
		rows.forEach(function(r, i) {
			var cy = T + i * RH + RH / 2, vals = r.values.map(function(v) { return v.v; }).sort(function(a, b) { return a - b; });
			var med = vals.length % 2 ? vals[(vals.length - 1) / 2] : (vals[vals.length / 2 - 1] + vals[vals.length / 2]) / 2;
			s.appendChild(S('text', { 'x': 0, 'y': cy + 4, 'fill': 'currentColor', 'font-size': 12 }, [ r.label ]));
			s.appendChild(S('line', { 'x1': L, 'x2': W - R, 'y1': cy, 'y2': cy, 'stroke': 'var(--nm-grid)' }));
			r.values.forEach(function(v) {
				s.appendChild(S('circle', { 'cx': x(v.v), 'cy': cy, 'r': 4, 'fill': 'var(--nm-c1)', 'fill-opacity': 0.85, 'stroke': 'var(--nm-ring, Canvas)', 'stroke-width': 2 }));
				var hit = S('circle', { 'cx': x(v.v), 'cy': cy, 'r': 12, 'fill': 'transparent', 'tabindex': 0 });
				var on = function() {
					tip.replaceChildren.apply(tip, v.tip.map(function(t, k) { return E('div', k ? {} : { 'class': 'm' }, [ t ]); }));
					tip.style.display = '';
					var px = x(v.v) * host.clientWidth / W, w = tip.offsetWidth;
					tip.style.left = (px + 14 + w > host.clientWidth ? Math.max(0, px - w - 14) : px + 14) + 'px';
					tip.style.top = (cy + 8) + 'px';
				};
				var off = function() { tip.style.display = 'none'; };
				hit.addEventListener('pointerenter', on); hit.addEventListener('focus', on);
				hit.addEventListener('pointerleave', off); hit.addEventListener('blur', off);
				s.appendChild(hit);
			});
			s.appendChild(S('line', { 'x1': x(med), 'x2': x(med), 'y1': cy - 10, 'y2': cy + 10, 'stroke': 'currentColor', 'stroke-width': 2, 'pointer-events': 'none' }));
		});
		host.appendChild(s);
		host.appendChild(tip);
		requestAnimationFrame(function() { host.style.setProperty('--nm-ring', surfaceOf(host)); });
		return host;
	},

	/* Tiny ping-over-the-match line (null = no reply); the highest point gets a dot */
	sparkline: function(series, w, h) {
		var vals = series.filter(function(v) { return v != null; });
		var s = S('svg', { 'width': w, 'height': h, 'viewBox': '0 0 ' + w + ' ' + h, 'style': 'display:inline-block;vertical-align:middle' });
		if (vals.length < 2) return s;
		var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals), span = Math.max(hi - lo, 10);
		var x = function(i) { return 2 + i / (series.length - 1) * (w - 4); }, y = function(v) { return h - 3 - (v - lo) / span * (h - 6); };
		var d = '', pen = false, peak = null;
		series.forEach(function(v, i) {
			if (v == null) { pen = false; return; }
			d += (pen ? 'L' : 'M') + x(i).toFixed(1) + ',' + y(v).toFixed(1);
			pen = true;
			if (v == hi && peak == null) peak = i;
		});
		s.appendChild(S('path', { 'd': d, 'fill': 'none', 'stroke': 'var(--nm-c1)', 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
		if (peak != null)
			s.appendChild(S('circle', { 'cx': x(peak), 'cy': y(hi), 'r': 3, 'fill': 'var(--nm-c1)' }));
		return s;
	}
});

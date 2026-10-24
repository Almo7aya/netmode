'use strict';
'require baseclass';
'require dom';
'require netmode.ui as nm';

// Status > Overview widget for netmode: current mode and the controls. The graphs live on Services > Netmode.

return baseclass.extend({
	title: _('Network mode'),

	load: function() {
		return nm.status();
	},

	render: function(st) {
		nm.css();
		var root = E('div', { 'class': 'nm' });
		if (!st || !st.running) {
			root.appendChild(E('em', {}, [ _('netmode is not running') ]));
			return root;
		}

		var self = this;
		var c = nm.controls(st, function() {
			return self.load().then(function(s) { if (root.parentNode) dom.content(root.parentNode, self.render(s)); });
		});
		var p = st.ping, playing = (st.devices || []).filter(function(d) { return d.playing; });
		var facts = [];
		if (p) facts.push(p.avg != null ? _('game WAN ping %d ms (jitter %.1f, loss %d %%)').format(Math.round(p.avg), p.jitter, p.loss) : _('game WAN: no ping reply'));
		facts.push(playing.length ? _('%s playing').format(playing.map(nm.devName).join(', ')) : _('nobody playing'));
		if (st.match) facts.push(_('match %s').format(nm.dur(st.ts - st.match.start)));

		var rows = [
			[ _('Current mode'), E('span', {}, [ nm.badge(st), ' ', nm.describe(st) ]) ],
			[ _('Mode'), c.modes ],
			[ _('Game WAN'), E('div', {}, [ c.gws, c.note ]) ],
			[ _('Now'), E('span', {}, [ facts.join(' · ') + ' — ', E('a', { 'href': L.url('admin/services/netmode/dashboard') }, [ _('dashboard and graphs') ]) ]) ]
		];
		var table = E('table', { 'class': 'table' }, rows.map(function(r) {
			return E('tr', { 'class': 'tr' }, [ E('td', { 'class': 'td left', 'width': '33%' }, [ r[0] ]), E('td', { 'class': 'td left' }, [ r[1] ]) ]);
		}));
		root.appendChild(table);
		return root;
	}
});

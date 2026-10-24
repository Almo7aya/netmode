'use strict';
'require view';
'require poll';
'require netmode.ui as nm';

// Services > Netmode > Dashboard: live state, controls and every graph (the board lives in netmode/ui.js).

return view.extend({
	load: function() {
		return nm.boardLoad();
	},

	render: function(res) {
		nm.css();
		return E('div', {}, [ E('h2', {}, [ _('Netmode') ]), nm.board(res, false, poll) ]);
	},

	handleSave: null,
	handleSaveApply: null,
	handleReset: null
});

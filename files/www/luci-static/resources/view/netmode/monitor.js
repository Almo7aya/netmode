'use strict';
'require view';
'require poll';
'require netmode.ui as nm';

// Services > Netmode > Monitor: the board in full screen for a second (wide) monitor: LuCI's menus are hidden and
// the charts are sized to the window, so everything fits without scrolling. ✕ goes back to the dashboard.

return view.extend({
	load: function() {
		return nm.boardLoad();
	},

	render: function(res) {
		nm.css();
		return nm.board(res, true, poll);
	},

	handleSave: null,
	handleSaveApply: null,
	handleReset: null
});

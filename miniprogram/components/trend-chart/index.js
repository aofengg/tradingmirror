Component({
  properties: {
    pointsJson: { type: String, value: '[]' },
    compact: { type: Boolean, value: false },
    suspended: { type: Boolean, value: false },
    interactive: { type: Boolean, value: false },
    selectedPeriodId: { type: String, value: '' }
  },

  data: {
    points: [],
    firstLabel: '',
    middleLabel: '',
    lastLabel: '',
    hasData: false
  },

  lifetimes: {
    ready: function () { this._detached = false; this._refresh(); },
    detached: function () { this._detached = true; clearTimeout(this._drawTimer); }
  },

  observers: {
    'pointsJson, compact, selectedPeriodId, suspended': function () { this._refresh(); }
  },

  methods: {
    _refresh: function () {
      var self = this;
      var points = [];
      try { points = JSON.parse(self.properties.pointsJson || '[]'); } catch (error) { points = []; }
      self._chartPoints = points;
      self.setData({
        points: points,
        firstLabel: points.length ? points[0].label : '',
        middleLabel: points.length ? points[Math.floor((points.length - 1) / 2)].label : '',
        lastLabel: points.length ? points[points.length - 1].label : '',
        hasData: points.some(function (item) { return item.value !== null && typeof item.value !== 'undefined'; })
      });
      clearTimeout(self._drawTimer);
      self._chartRect = null;
      if (self.properties.suspended || self._detached || !self.createSelectorQuery) return;
      self._drawTimer = setTimeout(function () { self._draw(points); }, 30);
    },

    _draw: function (points) {
      var self = this;
      if (self.properties.suspended || self._detached) return;
      self.createSelectorQuery().select('.trend-chart__canvas').boundingClientRect(function (rect) {
        if (self.properties.suspended || self._detached || !rect || !rect.width) return;
        self._chartRect = rect;
        var ctx = wx.createCanvasContext('behaviorTrendCanvas', self);
        var width = rect.width;
        var height = rect.height;
        var left = 8;
        var right = 8;
        var top = 14;
        var bottom = 13;
        var plotWidth = width - left - right;
        var plotHeight = height - top - bottom;
        ctx.clearRect(0, 0, width, height);
        if (!self.properties.compact) {
          ctx.setStrokeStyle('rgba(119, 134, 127, .13)');
          ctx.setLineWidth(1);
          [0, .5, 1].forEach(function (ratio) {
            var y = top + plotHeight * ratio;
            ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(width - right, y); ctx.stroke();
          });
        }
        var valid = [];
        (points || []).forEach(function (point, index) {
          if (point.value === null || typeof point.value === 'undefined') return;
          var x = points.length <= 1 ? width / 2 : left + plotWidth * index / (points.length - 1);
          var y = top + plotHeight * (100 - Math.max(0, Math.min(100, point.value))) / 100;
          valid.push({ x: x, y: y, index: index });
        });
        if (valid.length > 1) {
          var gradient = ctx.createLinearGradient(0, top, 0, height);
          gradient.addColorStop(0, 'rgba(63, 151, 119, .24)');
          gradient.addColorStop(1, 'rgba(63, 151, 119, 0)');
          ctx.beginPath();
          ctx.moveTo(valid[0].x, height - bottom);
          valid.forEach(function (point) { ctx.lineTo(point.x, point.y); });
          ctx.lineTo(valid[valid.length - 1].x, height - bottom);
          ctx.closePath(); ctx.setFillStyle(gradient); ctx.fill();
          ctx.beginPath();
          valid.forEach(function (point, index) { if (!index) ctx.moveTo(point.x, point.y); else ctx.lineTo(point.x, point.y); });
          ctx.setStrokeStyle('#2D8065'); ctx.setLineWidth(2.5); ctx.setLineCap('round'); ctx.setLineJoin('round'); ctx.stroke();
        }
        valid.forEach(function (point, index) {
          var latest = index === valid.length - 1;
          var selected = points[point.index] && points[point.index].periodId === self.properties.selectedPeriodId;
          if (selected) {
            ctx.beginPath(); ctx.arc(point.x, point.y, 8, 0, Math.PI * 2);
            ctx.setFillStyle('rgba(45, 128, 101, .14)'); ctx.fill();
          }
          ctx.beginPath(); ctx.arc(point.x, point.y, latest ? 4.5 : 3.2, 0, Math.PI * 2);
          ctx.setFillStyle(selected || latest ? '#1F6855' : '#77BBA4'); ctx.fill();
          ctx.setStrokeStyle('#FFFEFA'); ctx.setLineWidth(2); ctx.stroke();
        });
        self._validPoints = valid;
        ctx.draw();
      }).exec();
    },

    selectPoint: function (event) {
      var point = (this._chartPoints || [])[Number(event.currentTarget.dataset.index)];
      if (!this.properties.interactive || !point || point.value === null || typeof point.value === 'undefined') return;
      this.triggerEvent('select', point);
    },

    handleTap: function (event) {
      if (!this.properties.interactive || !this._chartPoints || !this._chartPoints.length || !this._chartRect) return;
      var detailX = event.detail && typeof event.detail.x === 'number' ? event.detail.x : null;
      var touch = event.changedTouches && event.changedTouches[0];
      var clientX = touch && typeof touch.clientX === 'number' ? touch.clientX : null;
      var x = clientX !== null ? clientX - this._chartRect.left : (touch && typeof touch.x === 'number' ? touch.x : (detailX !== null ? detailX - this._chartRect.left : null));
      if (x === null) return;
      var left = 8;
      var plotWidth = Math.max(1, this._chartRect.width - 16);
      var ratio = Math.max(0, Math.min(1, (x - left) / plotWidth));
      var index = Math.round(ratio * (this._chartPoints.length - 1));
      var point = this._chartPoints[index];
      if (!point || point.value === null || typeof point.value === 'undefined') return;
      this.triggerEvent('select', point);
    }
  }
});

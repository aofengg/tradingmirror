var model = require('./market-chronicle');
var dayMs = 86400000;

function timestamp(date) { return Date.parse(date + 'T00:00:00Z'); }
function isDate(date) {
  return typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    isFinite(timestamp(date)) && new Date(timestamp(date)).toISOString().slice(0, 10) === date;
}
function validManifest(manifest) {
  if (!manifest || manifest.schema !== 1 || manifest.index !== 'IXIC' || !isDate(manifest.asOf)) return false;
  var name = /^nasdaq-composite-(\d{4}-\d{2}-\d{2})-v[1-9]\d{0,5}\.json$/.exec(manifest.file);
  return !!name && name[1] === manifest.asOf;
}
function validPack(manifest, pack) {
  if (!validManifest(manifest) || !pack || pack.schema !== 1 || pack.index !== 'IXIC' || pack.asOf !== manifest.asOf ||
    !Array.isArray(pack.daily) || !pack.daily.length || pack.daily.length > 10000 || !Array.isArray(pack.events)) return false;
  var dates = new Map();
  var previous = '';
  for (var i = 0; i < pack.daily.length; i++) {
    var bar = pack.daily[i];
    if (!Array.isArray(bar) || bar.length !== 5 || !isDate(bar[0]) || bar[0] <= previous) return false;
    var ohlc = bar.slice(1);
    if (!ohlc.every(function(n) { return model.known(n) && n > 0 && n < 1e9; }) ||
      bar[2] < Math.max(bar[1], bar[3], bar[4]) || bar[3] > Math.min(bar[1], bar[4])) return false;
    dates.set(bar[0], bar[4]);
    previous = bar[0];
  }
  if (previous !== pack.asOf || (pack.from !== undefined && (!isDate(pack.from) || !dates.has(pack.from)))) return false;
  previous = '';
  return pack.events.every(function(event) {
    if (!event || !isDate(event.date) || event.date <= previous || (pack.from && event.date < pack.from) || !dates.has(event.date) ||
      !model.known(event.change) || event.change < -100 || typeof event.title !== 'string' ||
      !event.title.trim() || event.title.length > 120 || typeof event.note !== 'string' || event.note.length > 1000 ||
      !Array.isArray(event.sources) || event.sources.length > 10 || !event.sources.every(function(url) {
        return typeof url === 'string' && url.length <= 2048 && /^https:\/\/[^\s]+$/.test(url);
      })) return false;
    previous = event.date;
    return true;
  });
}

function yearHistory(pack, year) {
  var weekly = [], closes = {}, lastWeek;
  pack.daily.forEach(function(bar) {
    var date = bar[0];
    if (pack.from && date < pack.from) return;
    if (date.slice(0, 4) === year) closes[date] = bar[4];
    var time = timestamp(date);
    var monday = time - (new Date(time).getUTCDay() + 6) % 7 * dayMs;
    if (!lastWeek || monday !== lastWeek.monday) {
      lastWeek = {monday: monday, first: date, date: date, open: bar[1], high: bar[2], low: bar[3], close: bar[4]};
      weekly.push(lastWeek);
      return;
    }
    lastWeek.date = date;
    lastWeek.high = Math.max(lastWeek.high, bar[2]);
    lastWeek.low = Math.min(lastWeek.low, bar[3]);
    lastWeek.close = bar[4];
  });
  var events = pack.events.filter(function(event) { return event.date.slice(0, 4) === year; }).map(function(event) {
    return Object.assign({}, event, {
      closeText: model.point(closes[event.date]),
      changeText: model.percent(event.change),
      trend: model.trend(event.change)
    });
  });
  return {weekly: weekly.filter(function(bar) { return bar.date.slice(0, 4) === year; }), events: events};
}

function timeline(system, personal, sort) {
  var byDate = {};
  system.forEach(function(event) { byDate[event.date] = {date: event.date, system: event}; });
  personal.forEach(function(event) {
    if (!byDate[event.date]) byDate[event.date] = {date: event.date};
    byDate[event.date].mine = event;
  });
  var rows = Object.values(byDate);
  rows.forEach(function(row) {
    row.shortDate = row.date.slice(5).replace('-', '.');
    row.magnitude = Math.max(row.system ? Math.abs(row.system.change) : -1,
      row.mine && row.mine.hasChange ? Math.abs(row.mine.change) : -1);
  });
  rows.sort(function(a, b) {
    return (sort === 'magnitude' ? b.magnitude - a.magnitude : 0) || b.date.localeCompare(a.date);
  });
  return rows;
}

function chart(weekly, mode) {
  var prices = weekly.map(function(w) { return mode === 'candle' ? [w.low, w.high] : [w.close, w.close]; });
  var lo = Math.min.apply(null, prices.map(function(p) { return p[0]; }));
  var hi = Math.max.apply(null, prices.map(function(p) { return p[1]; }));
  var padding = (hi - lo || hi * .04) * .1;
  lo -= padding;
  hi += padding;
  function y(price) { return 5 + (hi - price) / (hi - lo) * 90; }
  var first = timestamp(weekly[0].date), last = timestamp(weekly[weekly.length - 1].date);
  function x(date) {
    return first === last ? 95 : 5 + (timestamp(date) - first) / (last - first) * 90;
  }
  var axis = [0, Math.round((weekly.length - 1) / 3), Math.round((weekly.length - 1) * 2 / 3), weekly.length - 1]
    .filter(function(index, i, values) { return values.indexOf(index) === i; })
    .map(function(index) {
      var date = weekly[index].date;
      return {date: date, x: x(date), label: date.slice(5).replace('-', '.'), last: index === weekly.length - 1};
    });
  return {
    axis: axis,
    weeks: weekly.map(function(w) {
      return {date: w.date, x: x(w.date), close: y(w.close), open: y(w.open), high: y(w.high), low: y(w.low), trend: model.trend(w.close - w.open)};
    }),
    ticks: [5, 35, 65, 95].map(function(p) {
      return {y: p, label: model.point(hi - (hi - lo) * (p - 5) / 90).replace(/\.\d{2}$/, '')};
    })
  };
}

// Each displayed week has its own marker. Source records on the same date
// already share a timeline row, while different dates remain individually selectable.
function eventsByWeek(weekly, rows) {
  var ordered = rows.slice().sort(function(a, b) { return a.date.localeCompare(b.date); });
  var result = {};
  weekly.forEach(function(week) {
    var entries = ordered.filter(function(row) { return row.date >= week.first && row.date <= week.date; });
    if (!entries.length) return;
    result[week.date] = {
      dates: entries.map(function(row) {
        var event = row.system || row.mine;
        return {date: row.date, label: row.shortDate, title: row.system ? event.title : '我的记录', trend: event && event.trend || 'unknown'};
      }),
      system: entries.some(function(row) { return !!row.system; }),
      mine: entries.some(function(row) { return !!row.mine; })
    };
  });
  return result;
}

function weekPins(weeks, groups, width, height, mode) {
  var pins = [];
  var diameter = 22;
  var levels = [];
  for (var y = diameter / 2; y <= height - diameter / 2; y += diameter) levels.push(y);
  weeks.forEach(function(week) {
    var group = groups[week.date];
    if (!group) return;
    var x = week.x * width / 100;
    var high = (mode === 'candle' ? week.high : week.close) * height / 100;
    var low = (mode === 'candle' ? week.low : week.close) * height / 100;
    var preferred = high - 19;
    var nearby = pins.filter(function(pin) { return Math.abs(pin.pixelX - x) < diameter; });
    var ranked = levels.slice().sort(function(a, b) { return Math.abs(a - preferred) - Math.abs(b - preferred); });
    function clear(y) { return nearby.every(function(pin) { return Math.abs(pin.pixelY - y) >= diameter; }); }
    var py = ranked.find(function(y) { return clear(y) && (y <= high - 11 || y >= low + 11); });
    if (py === undefined) py = ranked.find(clear);
    if (py === undefined) py = Math.min(height - 11, Math.max(11, preferred));
    var anchor = py <= (high + low) / 2 ? high : low;
    var rises = group.dates.some(function(day) { return day.trend === 'up'; });
    var falls = group.dates.some(function(day) { return day.trend === 'down'; });
    pins.push({
      week: week.date, x: week.x, pixelX: x, pixelY: py,
      y: py / height * 100, stemTop: Math.min(anchor, py) / height * 100,
      stemHeight: Math.abs(anchor - py) / height * 100, count: group.dates.length,
      source: group.system ? 'system' : 'mine',
      trend: rises && falls ? 'mixed' : rises ? 'up' : falls ? 'down' : 'neutral',
      label: week.date + ' 当周 ' + group.dates.length + ' 个大事日期'
    });
  });
  return pins;
}

function weekLabels(pins, groups, width, height, selectedDate, selectedWeek, selectedOnly) {
  var placed = [];
  var ordered = pins.slice().sort(function(a, b) {
    return Number(b.week === selectedWeek) - Number(a.week === selectedWeek);
  });
  function overlaps(a, b) {
    return a.x < b.x + b.w + 2 && a.x + a.w + 2 > b.x &&
      a.y < b.y + b.h + 2 && a.y + a.h + 2 > b.y;
  }
  var targets = pins.map(function(pin) { return {x:pin.pixelX-11,y:pin.pixelY-11,w:22,h:22}; });
  ordered.forEach(function(pin) {
    var active = pin.week === selectedWeek;
    var group = groups[pin.week];
    if (!group || (selectedOnly && !active)) return;
    var dates = group.dates;
    var event = dates.find(function(day) { return day.date === selectedDate; });
    if (!event && !selectedOnly) event = dates[dates.length - 1];
    if (!event || !event.title) return;
    var limit = active ? 10 : 7;
    function shorten(length) {
      return event.title.length > length ? event.title.slice(0, length - 1) + '…' : event.title;
    }
    function measure(text) {
      return Math.min(width - 4, Array.from(text).reduce(function(size, glyph) {
        return size + (/^[\x00-\x7F]$/.test(glyph) ? 7 : 11);
      }, 6));
    }
    var text = shorten(limit), w = measure(text);
    var x = pin.pixelX, y = pin.pixelY, h = 16;
    var centered = Math.max(1, Math.min(width - w - 1, x - w / 2));
    var candidates = [{x:x+13,y:y-8},{x:x-w-13,y:y-8},{x:centered,y:y-29},{x:centered,y:y+13}];
    function findSpace(points, obstacles) {
      return points.map(function(point) {
        return Object.assign({}, point, {w:w,h:h});
      }).find(function(box) {
        return box.x >= 1 && box.y >= 1 && box.x + w < width && box.y + h < height &&
          !obstacles.some(function(target) { return overlaps(box,target); }) &&
          !placed.some(function(label) { return overlaps(box,label); });
      });
    }
    var fit = findSpace(candidates, targets);
    if (!fit && active) {
      // Labels do not intercept taps. In a dense group, keep the visible dots clear.
      var symbols = pins.map(function(point) { return {x:point.pixelX-8,y:point.pixelY-8,w:16,h:16}; });
      fit = findSpace(candidates, symbols);
      function nearestSpace(labelWidth) {
        var best = {distance:Infinity};
        for (var top = 1; top + h < height; top += 4) {
          for (var left = 1; left + labelWidth < width; left += 4) {
            var dx = Math.max(left - x, x - left - labelWidth, 0);
            var dy = Math.max(top - y, y - top - h, 0);
            var distance = dx * dx + dy * dy;
            if (distance >= best.distance) continue;
            var candidate = {x:left,y:top,w:labelWidth,h:h};
            if (!symbols.some(function(symbol) { return overlaps(candidate,symbol); })) {
              best = {box:candidate,distance:distance};
            }
          }
        }
        return best;
      }
      if (!fit) {
        var closest = nearestSpace(w);
        if (closest.distance > 28 * 28 && event.title.length > 6) {
          var compact = shorten(6), alternative = nearestSpace(measure(compact));
          if (alternative.distance < closest.distance) {
            closest = alternative;
            text = compact;
          }
        }
        fit = closest.box;
      }
    }
    if (fit) placed.push(Object.assign(fit,{week:pin.week,text:text,title:event.title,active:active}));
  });
  return placed;
}

module.exports = {weekLabels: weekLabels, eventsByWeek: eventsByWeek, weekPins: weekPins, validManifest: validManifest, validPack: validPack, yearHistory: yearHistory, timeline: timeline, chart: chart};

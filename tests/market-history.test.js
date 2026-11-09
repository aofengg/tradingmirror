const assert = require('node:assert/strict');
const history = require('../miniprogram/utils/market-history');

const manifest = {schema: 1, index: 'IXIC', asOf: '2025-01-06', file: 'nasdaq-composite-2025-01-06-v1.json'};
const pack = {
  schema: 1, index: 'IXIC', asOf: manifest.asOf,
  daily: [['2024-12-30', 100, 115, 98, 104], ['2025-01-03', 104, 114, 96, 110], ['2025-01-06', 110, 112, 103, 107]],
  events: [{date: '2025-01-03', change: 5.77, title: '系统背景', note: '', sources: []}]
};

assert(history.validPack(manifest, pack));
assert(!history.validManifest({...manifest, file: '../manifest.json'}));
assert(!history.validPack(manifest, {...pack, daily: pack.daily.slice().reverse()}));
assert(!history.validPack(manifest, {...pack, events: [{...pack.events[0], date: '2025-01-04'}]}));
const year = history.yearHistory(pack, '2025');
assert.deepEqual(year.weekly[0], {monday: Date.parse('2024-12-30'), first: '2024-12-30', date: '2025-01-03', open: 100, high: 115, low: 96, close: 110});
const rows = history.timeline(year.events, [{date: '2025-01-03', closeText: '108.00', hasChange: false}], 'time');
assert.equal(rows.length, 1);
assert.equal(rows[0].system.closeText, '110.00');
assert.equal(rows[0].mine.closeText, '108.00');

// A busy full-year view keeps one accessible marker per plotted week.
const fullYear = Array.from({length: 52}, (_, i) => {
  const first = new Date(Date.UTC(2025, 0, 3 + i * 7)).toISOString().slice(0, 10);
  return {first, date: first, open: 100, high: 112, low: 90, close: 110};
});
const candle = history.chart(fullYear, 'candle');
assert.equal(candle.weeks.length, 52);
assert.equal(candle.weeks[0].x, 5);
assert.equal(candle.weeks.at(-1).x, 95);
assert.equal(candle.axis.at(-1).date, '2025-12-26');
const crossWeek = history.eventsByWeek(year.weekly, [
  {date:'2025-01-02', shortDate:'01.02', system:{}},
  {date:'2025-01-03', shortDate:'01.03', mine:{}},
  {date:'2025-01-06', shortDate:'01.06', system:{}}
]);
assert.deepEqual(Object.values(crossWeek).map(group => group.dates.map(day => day.date)),
  [['2025-01-02','2025-01-03'],['2025-01-06']]);
const dense = history.eventsByWeek(fullYear, fullYear.map(w => ({date:w.date, shortDate:w.date.slice(5), system:{}})));
const pins = history.weekPins(candle.weeks, dense, 220, 176, 'candle');
assert.equal(pins.length, 52);
pins.forEach((pin, i) => {
  assert.equal(pin.x, candle.weeks[i].x);
  assert(pin.pixelY >= 11 && pin.pixelY <= 165);
  assert(pins.slice(0, i).every(other => Math.abs(other.pixelX - pin.pixelX) >= 22 ||
    Math.abs(other.pixelY - pin.pixelY) >= 22));
});

const line = history.chart(fullYear, 'line');
assert.deepEqual(line.axis, candle.axis);
const linePins = history.weekPins(line.weeks, dense, 220, 176, 'line');
assert.equal(linePins.length, pins.length);
linePins.forEach((pin, i) => {
  assert.equal(pin.x, candle.weeks[i].x);
  const closeY = line.weeks[i].close;
  assert([pin.stemTop, pin.stemTop + pin.stemHeight].some(y => Math.abs(y - closeY) < 1e-8));
});

const annotatedRows = [
  {date:'2025-01-02', shortDate:'01.02', system:{title:'第一条大事',trend:'up'}},
  {date:'2025-01-03', shortDate:'01.03', system:{title:'第二条大事',trend:'down'}},
  {date:'2025-01-06', shortDate:'01.06', system:{title:'下一周大事',trend:'down'}}
];
const annotatedGroups = history.eventsByWeek(year.weekly, annotatedRows);
const annotatedChart = history.chart(year.weekly, 'line');
const annotatedPins = history.weekPins(annotatedChart.weeks, annotatedGroups, 230, 176, 'line');
assert.deepEqual(annotatedPins.map(pin => pin.trend), ['mixed', 'down']);
const annotations = history.weekLabels(annotatedPins, annotatedGroups, 230, 176, '2025-01-02', '2025-01-03');
assert.equal(annotations.find(label => label.active).text, '第一条大事');
assert.deepEqual(history.weekLabels(annotatedPins, annotatedGroups, 230, 176, '2025-01-02', '2025-01-03', true),
  annotations.filter(label => label.active));
assert.deepEqual(history.weekLabels(annotatedPins, annotatedGroups, 230, 176, '2025-01-03', '2025-01-03', true).map(label => label.text), ['第二条大事']);
assert.deepEqual(history.weekLabels(annotatedPins, annotatedGroups, 230, 176, '2025-01-01', '2025-01-03', true), []);
assert(annotations.every(label => label.x >= 0 && label.y >= 0 && label.x + label.w <= 230 && label.y + label.h <= 176));
assert(annotations.every(label => annotatedPins.every(pin => label.x >= pin.pixelX + 11 ||
  label.x + label.w <= pin.pixelX - 11 || label.y >= pin.pixelY + 11 || label.y + label.h <= pin.pixelY - 11)));

const v2 = {...manifest, file: manifest.file.replace('-v1', '-v2')};
let active = manifest, rejected = false, stored, manifestError, manifestStatus;
const requests = [];
global.wx = {
  cloud: {async getTempFileURL() { return {fileList:[{errMsg:manifestStatus}]}; }, async downloadFile({fileID}) {
    const file = fileID.split('/').pop();
    requests.push(file);
    if (manifestError && file === 'manifest.json') throw manifestError;
    if (rejected && file === v2.file) throw Error('NoSuchKey');
    return {tempFilePath: file};
  }},
  getFileSystemManager: () => ({
    statSync: () => ({size: 256}),
    readFileSync: file => JSON.stringify(file === 'manifest.json' ? active : pack)
  }),
  getStorageSync: () => stored,
  setStorageSync: (key, entry) => { stored = entry; }
};
const path = require.resolve('../miniprogram/services/market-history-service');
const service = require(path);

(async function() {
  await Promise.all([service.refresh(false), service.refresh(false)]);
  assert.deepEqual(requests, ['manifest.json', manifest.file]);
  assert.equal(stored.manifest.file, manifest.file);
  requests.length = 0;
  await service.refresh(true);
  assert.deepEqual(requests, ['manifest.json']);

  active = v2;
  rejected = true;
  const failed = await service.refresh(true);
  assert(failed.failed);
  assert.equal(failed.entry.manifest.file, manifest.file);
  assert.equal(stored.manifest.file, manifest.file);

  rejected = false;
  const upgraded = await service.refresh(true);
  assert.equal(upgraded.entry.manifest.file, v2.file);
  delete require.cache[path];
  const reopened = require(path);
  assert.equal(reopened.snapshot().manifest.file, v2.file);
  active = manifest;
  const rollback = await reopened.refresh(true);
  assert.equal(rollback.entry.manifest.file, manifest.file);
  assert.equal(stored.manifest.file, manifest.file);

  manifestError = Object.assign(Error('downloadFile:fail'), {errCode:'STORAGE_FILE_NONEXIST'});
  assert.deepEqual(await reopened.refresh(true), {entry:null, manifestMissing:true});
  assert.equal(reopened.snapshot(), null);
  assert.equal(stored.manifest.file, manifest.file, 'missing manifest does not discard the verified cache');
  manifestError = Error('network timeout');
  assert.deepEqual(await reopened.refresh(true), {entry:null, manifestMissing:true}, 'a later timeout cannot revive missing system data');
  manifestError = null;
  requests.length = 0;
  assert.equal((await reopened.refresh(true)).entry.manifest.file, manifest.file);
  assert.deepEqual(requests, ['manifest.json'], 'restoring the manifest can reuse the verified pack');
  manifestError = Error('permission denied');
  const unauthorized = await reopened.refresh(true);
  assert.equal(unauthorized.failed, true);
  assert.equal(unauthorized.entry.manifest.file, manifest.file);
  manifestError = {errCode:-403003,errMsg:'internal server error: empty download url'};
  manifestStatus = 'STORAGE_PERMISSION_DENIED';
  assert.equal((await reopened.refresh(true)).failed, true);
  manifestStatus = 'STORAGE_FILE_NONEXIST';
  assert.deepEqual(await reopened.refresh(true), {entry:null, manifestMissing:true});
  console.log('Market history validation, year boundary, independent rows, cache, failed update and rollback passed.');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

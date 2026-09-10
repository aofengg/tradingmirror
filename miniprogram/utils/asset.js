function normalizeSymbol(value) {
  return String(value || '').trim().toUpperCase().slice(0, 20);
}

function inferMarket(symbol) {
  var value = normalizeSymbol(symbol);
  if (/\.(HK)$/.test(value) || /^\d{5}$/.test(value)) return 'HK';
  if (/\.(SS|SH|SZ)$/.test(value) || /^\d{6}$/.test(value)) return 'CN';
  if (/\.(L|PA|DE|TO)$/.test(value)) return 'OTHER';
  return 'US';
}

function fromSymbol(symbol) {
  var normalized = normalizeSymbol(symbol);
  return {
    symbol: normalized,
    market: inferMarket(normalized),
    asset_type: 'stock',
    asset_name_snapshot: ''
  };
}

module.exports = {
  normalizeSymbol: normalizeSymbol,
  inferMarket: inferMarket,
  fromSymbol: fromSymbol
};

export function formatSeconds(milliseconds) {
  return Number.isFinite(milliseconds) ? `${(milliseconds / 1000).toFixed(3)} s` : '—';
}

export function formatUsd(value) {
  return Number.isFinite(value) ? `$${value.toFixed(value < 0.01 ? 4 : 2)}` : '—';
}

export function filterComparisonRows(rows, query = '') {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return [...rows];
  return rows.filter((row) => [row.shape, row.id, row.subject, row.model, row.reasoning, row.feedback]
    .some((value) => String(value ?? '').toLocaleLowerCase().includes(needle)));
}

export function comparisonCost(row, costBasis = 'observed') {
  const fields = { observed: 'apiEquivalentUsd', cold: 'standardizedColdUsd', warm: 'standardizedWarmUsd' };
  return row[fields[costBasis] ?? fields.observed];
}

export function sortComparisonRows(rows, sort = 'shape-desc', costBasis = 'observed') {
  const copy = [...rows];
  const numericMissingLast = (getValue, direction = 1) => (a, b) => {
    const av = getValue(a);
    const bv = getValue(b);
    const aMissing = !Number.isFinite(av);
    const bMissing = !Number.isFinite(bv);
    if (aMissing !== bMissing) return aMissing ? 1 : -1;
    if (aMissing) return 0;
    return (av - bv) * direction;
  };
  const shapeNumber = (row) => Number(row.shape);
  const dollarEstimate = (row) => comparisonCost(row, costBasis);
  const comparators = {
    'shape-desc': numericMissingLast(shapeNumber, -1),
    'time-asc': numericMissingLast((row) => row.generationMs),
    'time-desc': numericMissingLast((row) => row.generationMs, -1),
    'dollars-asc': numericMissingLast(dollarEstimate),
    'dollars-desc': numericMissingLast(dollarEstimate, -1),
  };
  return copy.sort(comparators[sort] ?? comparators['shape-desc']);
}

export function findFixtureIndex(row, entries) {
  const byUrl = row.url && entries.findIndex((entry) => entry.url === row.url);
  if (Number.isInteger(byUrl) && byUrl >= 0) return byUrl;
  const byId = row.id != null && entries.findIndex((entry) => String(entry.id) === String(row.id));
  if (Number.isInteger(byId) && byId >= 0) return byId;
  const shape = Number(row.shape);
  return Number.isInteger(shape) ? entries.findIndex((entry) => entry.sourceKind === 'experiment' && entry.shapeNumber === shape) : -1;
}

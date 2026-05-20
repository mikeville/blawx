import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { slug, validateTerm, setNumberFor } from './slug.ts';

describe('slug', () => {
  it('lowercases and trims', () => {
    assert.equal(slug('  Duck  '), 'duck');
  });

  it('collapses internal whitespace to a single hyphen', () => {
    assert.equal(slug('lawn   mower'), 'lawn-mower');
  });

  it('strips punctuation', () => {
    assert.equal(slug("st. basil's"), 'st-basils');
  });

  it('preserves digits', () => {
    assert.equal(slug('boeing 747'), 'boeing-747');
  });

  it('returns empty for punctuation-only input', () => {
    assert.equal(slug('!!!'), '');
  });
});

describe('validateTerm', () => {
  it('accepts a normal term', () => {
    assert.equal(validateTerm('duck'), null);
  });

  it('accepts a two-word term', () => {
    assert.equal(validateTerm('lawn mower'), null);
  });

  it('rejects empty input', () => {
    assert.ok(validateTerm('   '));
  });

  it('rejects very long input', () => {
    assert.ok(validateTerm('a'.repeat(60)));
  });
});

describe('setNumberFor', () => {
  it('produces a 4-digit string', () => {
    const n = setNumberFor('duck');
    assert.match(n, /^\d{4}$/);
  });

  it('is deterministic across calls', () => {
    assert.equal(setNumberFor('octopus'), setNumberFor('octopus'));
  });

  it('differs between unrelated terms', () => {
    assert.notEqual(setNumberFor('duck'), setNumberFor('cat'));
  });
});

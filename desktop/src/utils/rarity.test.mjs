import assert from 'node:assert';
import { getFrameType, getFrameColor, getRarityInfo } from './rarity.js';

// Frame type mapping
assert.equal(getFrameType('Normal Monster'), 'normal');
assert.equal(getFrameType('Effect Monster'), 'monster');
assert.equal(getFrameType('Link Monster'), 'monster');
assert.equal(getFrameType('Spell Card'), 'spell');
assert.equal(getFrameType('Trap Card'), 'trap');
assert.equal(getFrameType(''), 'monster');
assert.equal(getFrameColor('Spell Card'), '#1DA891');

// Rarity mapping
assert.equal(getRarityInfo('Common').key, 'common');
assert.equal(getRarityInfo('Short Print').key, 'common');
assert.equal(getRarityInfo('Rare').key, 'rare');
assert.equal(getRarityInfo('Super Rare').key, 'super');
assert.equal(getRarityInfo('Ultra Rare').key, 'ultra');
assert.equal(getRarityInfo('Secret Rare').key, 'secret');
assert.equal(getRarityInfo('Ghost Rare').key, 'secret');
assert.equal(getRarityInfo('').key, 'common');

// Foil treatment
assert.equal(getRarityInfo('Common').foil, false);
assert.equal(getRarityInfo('Ultra Rare').foil, 'holo');
assert.equal(getRarityInfo('Secret Rare').foil, 'secret');

console.log('rarity.js: all assertions passed');

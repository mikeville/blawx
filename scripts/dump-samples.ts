// Helper: print the layer-ASCII forms of the three reference grids.
// Used once when wiring the API worker to inline the prompt strings.
import { sampleDuck } from '../src/voxel/sampleDuck.ts';
import { sampleTree } from '../src/voxel/sampleTree.ts';
import { sampleHouse } from '../src/voxel/sampleHouse.ts';
import { gridToLayerAscii } from '../src/voxel/projections.ts';

console.log('=== duck ===');
console.log(gridToLayerAscii(sampleDuck));
console.log('=== tree ===');
console.log(gridToLayerAscii(sampleTree));
console.log('=== house ===');
console.log(gridToLayerAscii(sampleHouse));

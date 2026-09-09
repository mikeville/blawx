import { convertToBricks } from './construction.js';

self.onmessage = ({ data }) => {
  try { self.postMessage({ model: convertToBricks({ rawModel: data, sourceProgram: null, adjustments: false }).brickModel }); }
  catch (error) { self.postMessage({ error: error?.message || 'Preview conversion failed.' }); }
};

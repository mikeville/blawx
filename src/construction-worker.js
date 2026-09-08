import { completeConstruction } from './complete-construction.js';

self.onmessage = ({ data }) => {
  try {
    const result = completeConstruction(data);
    self.postMessage({ result });
  } catch (error) {
    self.postMessage({ error: error.message || 'Conversion failed.' });
  }
};

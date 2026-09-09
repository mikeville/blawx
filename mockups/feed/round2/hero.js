import { mountModelStage } from '../../../src/model-stage.js';
import { getSavedResult } from './data.js';

/** Saved-fixture adapter around the production data-free stage. */
export function mountHero(host, { set, onOpen, animate = true }) {
  let disposed = false;
  let version = 0;
  const stage = mountModelStage(host, {
    label: set?.title ? `${onOpen ? 'Open ' : ''}${set.title}, interactive 3D LEGO-style set` : 'Interactive 3D LEGO-style set',
    onOpen,
  });

  async function setSet(nextSet, { animate: nextAnimate = true } = {}) {
    const current = ++version;
    try {
      const { brickModel } = await getSavedResult(nextSet.id);
      if (disposed || current !== version) return;
      stage.setModel(brickModel, { animate: nextAnimate });
    } catch (error) {
      if (!disposed && current === version) console.warn('Could not load saved hero set.', error);
    }
  }

  setSet(set, { animate });
  return {
    setSet,
    dispose() {
      if (disposed) return;
      disposed = true;
      version += 1;
      stage.dispose();
    },
  };
}

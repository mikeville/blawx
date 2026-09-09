import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { convertToBricks } from '../src/construction.js';
import { refineConstruction } from '../src/refine-construction.js';
import { prepareAssemblyGuide } from '../src/prepare-assembly-guide.js';
import { repairPreparedConstruction } from '../src/complete-construction.js';
import { planSubassemblies } from '../src/plan-subassemblies.js';
import { createBookletPresentation, createChapterDiagramData } from '../src/assembly-booklet-presentation.js';

test('booklet adapter preserves current saved construction guides', async () => {
  const index = JSON.parse(await readFile(new URL('../public/examples/index.json', import.meta.url)));
  for (let shape = 42; shape <= 47; shape += 1) {
    const record = index.find((entry) => entry.shape === shape);
    assert.ok(record, `Shape ${shape} is present`);
    const rawModel = JSON.parse(await readFile(new URL(`../public${record.url}`, import.meta.url)));
    const refined = refineConstruction(convertToBricks({ rawModel, adjustments: true }));
    const prepared = prepareAssemblyGuide(refined);
    const repaired = repairPreparedConstruction(prepared, { rawModel, allowExtensions: true });
    const result = planSubassemblies(repaired);
    const view = createBookletPresentation(result);
    const byStep = new Map(view.plan.steps.map(step => [step.id, step]));

    assert.equal(view.presentation.stats.coverageComplete, true, `Shape ${shape} coverage`);
    for (const section of view.presentation.sections) {
      const chapter = createChapterDiagramData(section, view.plan, view.numbering);
      assert.deepEqual(chapter.specs.map(spec => spec.stepId), section.groups.flatMap(group => group.stepIds));
      for (const spec of chapter.specs) {
        const step = byStep.get(spec.stepId);
        assert.deepEqual(spec.visible, step.visibleBrickIds);
        assert.deepEqual(spec.highlight, step.highlightBrickIds);
        assert.equal(spec.joinContext, step.kind === 'join' ? step.joinContext : null);
      }
      for (const part of chapter.parts) {
        if (part.id) assert.deepEqual(part.figures.map(spec => spec.stepId), part.stepIds);
      }
      if (section.repeatCount > 1) {
        assert.equal(section.instances.flatMap(instance => instance.brickIds).length > 0, true);
      }
    }
  }
});

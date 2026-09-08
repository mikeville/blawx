import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { convertToBricks } from '../src/construction.js';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

function safeModelMeta(meta = {}) {
  return Object.fromEntries(['method', 'physicalScale', 'scale', 'limitations']
    .filter(key => Object.hasOwn(meta, key)).map(key => [key, meta[key]]));
}

function extractCase({ shape, subject, plan, modelMeta, stepIndex, source }) {
  const step = plan.steps[stepIndex];
  if (!step) throw new RangeError(`Shape ${shape} step ${stepIndex + 1} is unavailable.`);
  const bricksById = new Map(plan.bricks.map(brick => [brick.id, brick]));
  const visibleBricks = step.visibleBrickIds.map(id => bricksById.get(id)).filter(Boolean);
  return {
    shape,
    subject,
    source,
    step: { id: step.id, index: stepIndex + 1, label: step.label },
    model: { version: 1, kind: 'bricks', bricks: visibleBricks, meta: safeModelMeta(modelMeta) },
    highlightIds: step.highlightBrickIds,
  };
}

export function buildInstructionAppearanceCases({ shape43PlanPath, shape44RawPath, outputPath }) {
if (!shape43PlanPath || !shape44RawPath || !outputPath) throw new Error('Explicit shape43PlanPath, shape44RawPath, and outputPath are required.');
const shape43ArtifactBytes = readFileSync(shape43PlanPath);
const shape44RawBytes = readFileSync(shape44RawPath);
const shape43Artifact = JSON.parse(shape43ArtifactBytes);
const shape44Raw = JSON.parse(shape44RawBytes);
const shape44Result = convertToBricks({ rawModel: shape44Raw, adjustments: true });
const fixture = {
  version: 1,
  createdAt: '2026-09-07',
  scope: 'Prepared presentation cases from saved Shape 43 and Shape 44 geometry. No generation or API calls.',
  cases: [
    extractCase({
      shape: 43,
      subject: 'cat',
      plan: shape43Artifact.plan,
      modelMeta: shape43Artifact.brickModel.meta,
      stepIndex: 48,
      source: {
        kind: 'explicit-curated-assembly-input',
        inputSha256: createHash('sha256').update(shape43ArtifactBytes).digest('hex'),
      },
    }),
    extractCase({
      shape: 44,
      subject: 'pickup',
      plan: shape44Result.assemblyPlan,
      modelMeta: shape44Result.brickModel.meta,
      stepIndex: 42,
      source: {
        kind: 'explicit-curated-raw-input',
        inputSha256: createHash('sha256').update(shape44RawBytes).digest('hex'),
        conversion: 'deterministic-construction-v1 with bounded adjustments',
      },
    }),
  ],
};

writeFileSync(outputPath, `${JSON.stringify(fixture, null, 2)}\n`, { flag: 'wx' });
return fixture;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const args=process.argv.slice(2);
  const value=flag=>{const index=args.indexOf(flag);return index===-1?null:args[index+1];};
  const outputPath=value('--output');
  const fixture=buildInstructionAppearanceCases({shape43PlanPath:value('--shape43-plan'),shape44RawPath:value('--shape44-model'),outputPath});
  console.log(`Wrote ${fixture.cases.length} instruction appearance cases to ${path.resolve(outputPath)}`);
}

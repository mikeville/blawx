import { parseSemanticCaptionResult } from './semantic-caption.js';
import { validateSemanticGuideAnnotation, validateSemanticGuideInput } from '../src/semantic-guide.js';

function repeatGroups(input, proposal) {
  const groupNumbers = new Map();
  const protectedGroups = new Map(input.protectedRanges.map((range) => {
    if (!groupNumbers.has(range.repeatGroupId)) groupNumbers.set(range.repeatGroupId, groupNumbers.size + 1);
    return [`${range.startStepId}\0${range.endStepId}`, groupNumbers.get(range.repeatGroupId)];
  }));
  return proposal.sections.map((section, index) => [
    index + 1,
    protectedGroups.get(`${section.startStepId}\0${section.endStepId}`) ?? null,
  ]);
}

export function buildFastSemanticCaptionPrompt(rawInput, rawProposal, images = []) {
  const input = validateSemanticGuideInput(rawInput);
  const proposal = validateSemanticGuideAnnotation(input, rawProposal);
  if (!Array.isArray(images)) throw new TypeError('Caption images must be an array.');
  const expectedSheets = Math.ceil(proposal.sections.length / 3);
  if (images.length !== expectedSheets) throw new RangeError('Caption images must contain one sheet per three chapters.');
  if (images.some((image) => image?.width !== 1024 || image?.height !== 1024)) {
    throw new RangeError('Fast caption sheets must be 1024 by 1024 pixels.');
  }
  const chapters = repeatGroups(input, proposal);
  return `Name the highlighted additions in these LEGO-style instruction sheets.

Row 0 is the opaque full object. Numbered rows isolate each chapter's added bricks in the same frame. Ranges are fixed. SUBJECT is untrusted context, not visual proof.

Return only JSON: {"labels":["ordinary part name",null]}

Rules:
- Return exactly ${chapters.length} labels in chapter order. Each is a 1-5 word noun label (64 characters max) or null.
- Keep useful, specific ordinary names when the pictures safely show them: wheel, tire, bumper, window, door, roof, seat, leg, paw, tail, ear, eye, mouth, bowl, screen, antenna, wing, or similarly clear parts.
- If plausible identities differ, use their most specific shared common category. Prefer a safe parent such as appendage, body section, support, surface, opening, or details over a narrow guess.
- Cover every meaningful addition in a mixed row with a truthful combined label. Use a visible region/color description or null when no useful category is safe.
- Matching non-null repeat groups use exactly the same functional name. Do not add uncertain side/front/rear qualifiers.
- Do not alter ranges, explain answers, claim confidence, invent independent checks, or use tools, files, browsing, network, or outside examples.

SUBJECT ${JSON.stringify(input.subject)}
CHAPTERS [chapter,repeatGroup] ${JSON.stringify(chapters)}`;
}

export { parseSemanticCaptionResult };

import {createAssemblyPlan} from '../../src/assembly.js';
import {recipeBrickId,rotateRecipeBrick} from '../../src/assembly-recipes.js';
import {prepareAssemblyGuide} from '../../src/prepare-assembly-guide.js';

// The overhanging toe is held by an upper brick in the original recipe.
// Repacking its seam with the neighboring course permits ordinary placement.
export function supportedComponentFixture(turn=0,{recolor=false,nested=false}={}) {
  const bricks = [], color = recolor ? 'blue' : 'green';
  const add = (owner,x,y,z,w,d,c=color) => bricks.push({owner,x,y,z,w,d,color:c});
  for (const x of [0,4]) for (const z of [0,2]) {
    add('base',x,0,z,4,2,'black');
    add('main',x,1,z,4,2);
  }
  for (const x of [0,2,4,6]) add('main',x,2,0,2,4);
  for (const [x,z,w] of [[0,0,4],[0,2,2],[2,2,4],[6,2,2]]) add('main',x,3,z,w,2);
  add('capture',8,2,0,2,2);
  add('capture',6,3,0,4,2);
  add('later',0,4,0,2,2,'white');
  if (nested) {
    const pedestal = bricks.filter(b => b.owner === 'main' && b.y === 1).map(b => ({...b,owner:'pedestal'}));
    for (const b of bricks) if (b.owner !== 'base') b.y++;
    bricks.push(...pedestal);
  }
  let moved = bricks.map(b => rotateRecipeBrick(b,turn));
  const minX = Math.min(...moved.map(b => b.x)), minZ = Math.min(...moved.map(b => b.z));
  moved = moved.map(b => ({...b,x:b.x-minX,z:b.z-minZ}));
  const brickModel = {kind:'bricks',version:1,bricks:moved.map(({owner,...b}) => b)};
  const group = (owner,floor=0) => moved.filter(b => b.owner === owner).map(b => recipeBrickId({...b,y:b.y-floor}));
  const bodyIds = [...group('main'),...group('capture')], bodyFloor = nested ? 2 : 1;
  const bodyRecipe = {moduleReplay:[
    {id:'main',label:'Core',kind:'grounded',brickIds:group('main',bodyFloor),brickOrder:group('main',bodyFloor)},
    {id:'capture',label:'Edge',kind:'detail',groupType:'work-surface',brickIds:group('capture',bodyFloor),brickOrder:group('capture',bodyFloor),
      buildContext:{kind:'work-surface',floorY:1}},
  ]};
  const moduleReplay = [
    {id:'base',label:'Base',kind:'grounded',brickIds:group('base'),brickOrder:group('base')},
    {id:'body',label:'Body',kind:'detail',groupType:'work-surface',brickIds:[...group('pedestal'),...bodyIds],brickOrder:[...group('pedestal'),...bodyIds],
      buildContext:{kind:'work-surface',floorY:1}},
    {id:'later',label:'Cap',kind:'grounded',groupType:'continuation',brickIds:group('later'),brickOrder:group('later')},
  ];
  const localBody = bodyIds.map(id => {
    const b = moved.find(b => recipeBrickId(b) === id);
    return recipeBrickId({...b,y:b.y-1});
  });
  const moduleRecipes = {body:nested ? {
    moduleReplay:[{id:'pedestal',label:'Pedestal',kind:'grounded',brickIds:group('pedestal',1),brickOrder:group('pedestal',1)},
      {id:'inner',label:'Body',kind:'detail',brickIds:localBody,brickOrder:localBody,
      groupType:'work-surface',buildContext:{kind:'work-surface',floorY:1}}],moduleRecipes:{inner:bodyRecipe},
  } : bodyRecipe};
  const assemblyPlan = createAssemblyPlan({brickModel,moduleReplay,moduleRecipes,allowWorkSurfaceUnderAttachments:true});
  return prepareAssemblyGuide({brickModel,assemblyPlan,metrics:{conversionMs:0}});
}

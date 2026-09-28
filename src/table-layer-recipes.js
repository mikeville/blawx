const key=(x,z)=>`${x},${z}`;
const cells=bricks=>new Set(bricks.flatMap(b=>Array.from({length:b.w*b.d},(_,i)=>key(b.x+i%b.w,b.z+Math.floor(i/b.w)))));
const bounds=bricks=>({width:Math.max(...bricks.map(b=>b.x+b.w))-Math.min(...bricks.map(b=>b.x)),
  depth:Math.max(...bricks.map(b=>b.z+b.d))-Math.min(...bricks.map(b=>b.z))});

function contiguous(occupied){
  const seen=new Set([occupied.values().next().value]);
  for(const k of seen){const [x,z]=k.split(',').map(Number);for(const [dx,dz]of [[1,0],[-1,0],[0,1],[0,-1]]){
    const next=key(x+dx,z+dz);if(occupied.has(next))seen.add(next);
  }}
  return seen.size===occupied.size;
}

// A whole row is the minimum task unit. Partition consecutive rows globally
// so the last strip does not become an arbitrary one-piece leftover.
function bands(layer,axis,acceptGroup=()=>true){
  const coordinates=[...new Set(layer.map(b=>b[axis]))].sort((a,b)=>a-b);
  const rows=coordinates.map(c=>layer.filter(b=>b[axis]===c));
  const best=Array(rows.length+1).fill(null);best[rows.length]={score:0,groups:[]};
  for(let start=rows.length-1;start>=0;start--){
    const group=[];
    for(let end=start;end<rows.length;end++){
      group.push(...rows[end]);if(group.length>20)break;
      const shape=bounds(group),occupied=cells(group),area=occupied.size;
      const types=new Set(group.map(b=>`${Math.min(b.w,b.d)}x${Math.max(b.w,b.d)}:${b.color}`));
      const thickness=axis==='x'?shape.width:shape.depth;
      if(!best[end+1]||thickness>8||area>128||types.size>8||!contiguous(occupied)||area/(shape.width*shape.depth)<.55||!acceptGroup(group))continue;
      const score=100+Math.max(0,4-group.length)*15+(1-area/(shape.width*shape.depth))*10+best[end+1].score;
      if(!best[start]||score<best[start].score)best[start]={score,groups:[[...group],...best[end+1].groups]};
    }
  }
  return best[0];
}

/** Partition one supported course; callers supply their own feature criteria. */
export function partitionLayerRows(bricks,{acceptGroup=()=>true}={}){
  if(!bricks.length||bricks.length>96||new Set(bricks.map(b=>b.y)).size!==1)return null;
  const shape=bounds(bricks);
  if(shape.width>32||shape.depth>32)return null;
  const candidates=['x','z'].map(axis=>bands(bricks,axis,acceptGroup)).filter(Boolean);
  candidates.sort((a,b)=>a.score-b.score);
  return candidates[0]?.groups??null;
}

function layerRegions(layer){
  const pending=new Set(layer),regions=[];
  while(pending.size){
    const region=new Set([pending.values().next().value]);
    for(const a of region){pending.delete(a);for(const b of pending){
      const x=Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x);
      const z=Math.min(a.z+a.d,b.z+b.d)-Math.max(a.z,b.z);
      if(x>=0&&z>=0&&(x>0||z>0))region.add(b);
    }}
    regions.push([...region]);
  }
  return regions;
}

/** A table-supported layer sweep, with an explicit physical eligibility check. */
export function planTableLayers(bricks,{allowMixedMaterials=false}={}){
  if(bricks.length<8||bricks.length>160)return null;
  const courses=[...new Set(bricks.map(b=>b.y))].sort((a,b)=>a-b),shape=bounds(bricks);
  if(courses.length<2||courses.length>4||courses.some((y,i)=>i&&y!==courses[i-1]+1)||shape.width>32||shape.depth>32)return null;
  const layers=courses.map(y=>bricks.filter(b=>b.y===y)),floor=cells(layers[0]),floorShape=bounds(layers[0]);
  // Scattered feet or a thin frame are not a comprehensible loose table layout.
  if(!contiguous(floor)||floor.size/(floorShape.width*floorShape.depth)<.6)return null;
  for(let i=0;i<layers.length;i++){
    if(!allowMixedMaterials&&new Set(layers[i].map(b=>b.color)).size>3)return null;
    if(i){const below=cells(layers[i-1]);
      if(layers[i].some(b=>![...cells([b])].some(c=>below.has(c))))return null;
    }
  }
  // Keep one sweep direction throughout the recipe, rather than switching axes
  // to save an isolated diagram. The final isolated replay verifies stud bonds.
  const alternatives=['x','z'].map(axis=>({axis,layers:layers.map(layer=>{
    const connected=layerRegions(layer),details=new Map();
    const ordinary=connected.filter(region=>{
      if(region.length!==1||layer===layers[0])return true;
      const b=region[0],type=`${b.w}x${b.d}:${b.color}`;
      if(!details.has(type))details.set(type,[]);details.get(type).push(b);return false;
    });
    const regions=ordinary.map(region=>bands(region,axis));
    for(const matching of details.values()){
      if(matching.length>8)return null;
      regions.push({score:100,groups:[matching]});
    }
    return regions.every(Boolean)?{score:regions.reduce((n,r)=>n+r.score,0),groups:regions.flatMap(r=>r.groups)}:null;
  })}))
    .filter(option=>option.layers.every(Boolean));
  alternatives.sort((a,b)=>a.layers.reduce((n,l)=>n+l.score,0)-b.layers.reduce((n,l)=>n+l.score,0));
  if(!alternatives.length)return null;
  const chosen=alternatives[0];
  return {axis:chosen.axis,floorPieceCount:layers[0].length,
    ...(layers.some(layer=>new Set(layer.map(b=>b.color)).size>3)?{mixedMaterials:true}:{}),
    actions:chosen.layers.flatMap((layer,i)=>layer.groups.map((group,j)=>({
    kind:'table-course',brickIds:group.map(b=>b.id),destination:{kind:'layer',course:courses[i],firstCourse:courses[0],lastCourse:courses.at(-1),ordinal:j+1,total:layer.groups.length},
  })))};
}

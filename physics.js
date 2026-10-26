/* 漢字おはじき Ver.2.4: dependency-free 2D compound-SAT impulse solver.
   World units: board coordinates 540 x 760. Time: seconds. Clockwise rotation is positive.
   Runs physics at a fixed 1/120 second timestep in game.js, render separately.
*/
(function(global){'use strict';
const W=540,H=760,EPS=1e-8;
const PIECE_UNIT=62;
// An ordinary 100% shot: 230 + 875 = 1105 units/s.
// A centered, equal-mass (1 vs 1) impact at restitution 0.73 gives
// j=(1+e)*speed/(1/m1+1/m2) = 955.825 world-impulse units.
const FULL_SHOT_SPEED=230+875;
const NORMAL_RESTITUTION=.73;
const NORMAL_FULL_IMPULSE=(1+NORMAL_RESTITUTION)*FULL_SHOT_SPEED/2;
const SHOCK_JUMP_PIECES=3, SHOCK_RADIUS_PIECES=1;
const VORTEX_RADIUS_PIECES=235/PIECE_UNIT;
const MAGNET_RANGE=235, MAGNET_DURATION=2, RICOCHET_BOOST=1.27, REFLECT_MULTIPLIER=1.0; // Original Ver.1.2 vortex: radius 235 units, enemy-only, two outward turns.
const SPLIT_SCALES=[1,2/3,1/3];
// Aim strength changes jump distance smoothly: weak shots ≈0.5 tile, full = 3 tiles.
function shockJumpPieces(power){return .5+2.5*Math.pow(clamp(power,0,1),1.1)}
function shockLanding(b,dx,dy,power){
 const len=hypot(dx,dy)||1,travel=PIECE_UNIT*shockJumpPieces(power);
 return {x:clamp(b.x+dx/len*travel,b.w*.65,W-b.w*.65),
         y:clamp(b.y+dy/len*travel,b.h*.65,H-b.h*.65),travelPieces:shockJumpPieces(power)};
}
const SHOCK_JUMP_SECONDS=.5;
const ABILITY_RULES=[
 {word:'暴走',kind:'追いかける',timing:'止まったあと、いちばん近い相手へ走ります。ぶつかると普通の攻撃です。',numbers:'追いかけ：1秒'},
 {word:'烈風',kind:'吹き飛ばす',timing:'矢印を長く引くほど遠くへジャンプ！ 着地した円の中の全員を外へ飛ばします。',numbers:'ジャンプ：最大3コマ分／着地後半径1コマ分に攻撃'},
 {word:'鉄壁',kind:'守る',timing:'ぶつかる攻撃には強い！ でも烈風と渦巻では普通に動きます。',numbers:'自分が受ける攻撃：0.6倍／円にいる味方：0.7倍／円の広さ：半径3コマ'},
 {word:'渦巻',kind:'敵を渦に巻き込む',timing:'発射して止まると発動。近くの敵だけが外へ広がる渦を2周します（敵への直撃は不要）。',numbers:'時間：2.3秒／範囲：半径約3.8コマ／外向きに拡大'},
 {word:'巨大',kind:'大きくなる',timing:'相手に当てるたび大きく、強くなります。最後まで元に戻りません。',numbers:'1回ごと：大きさ1.2倍・攻撃1.1倍／3回まで増加'},
 {word:'一撃',kind:'超強力な攻撃',timing:'最初にぶつかった敵1個だけを特大パワーで飛ばします。次の敵には普通の威力です。',numbers:'最初の敵：通常の攻撃力3倍／クリティカルの場合は5倍／2回目から通常(1ターンリセット)'},
 {word:'分裂',kind:'相手の攻撃で増える',timing:'相手のターンに敵コマと接触すると2個に分裂。自分のターンには発動しません。',numbers:'敵コマから攻撃があった場合、分裂する。分裂は1ターン1回。1個→2個（2/3サイズ）→最大4個（1/3サイズ）'},
 {word:'跳弾',kind:'壁で加速',timing:'自分のターン中に壁や四隅の障害物にぶつかると、反射した後の速度が上がります。跳弾を直接操作していなくても発動。',numbers:'反射後の速度：壁への衝突前の1.27倍'},
 {word:'磁力',kind:'敵を引き寄せる',timing:'磁力コマを発射して停止した後、周囲の敵だけを自分の方向へ引き寄せます。味方は動きません。',numbers:'範囲：半径約3.8コマ／吸引：2秒'},
 {word:'反射',kind:'攻撃を返す',timing:'相手のターン中に敵コマに衝突されると、その相手へ受けた衝撃の10割を追加で跳ね返します。',numbers:'反撃：受けた衝撃の10割を相手に返す'}
];
const WORDS={"暴走":{label:'暴走',ability:'burst'},"烈風":{label:'烈風',ability:'shock'},"鉄壁":{label:'鉄壁',ability:'iron'},"渦巻":{label:'渦巻',ability:'vortex'},"巨大":{label:'巨大',ability:'giant'},"一撃":{label:'一撃',ability:'strike'},"分裂":{label:'分裂',ability:'split'},"跳弾":{label:'跳弾',ability:'ricochet'},"磁力":{label:'磁力',ability:'magnet'},"反射":{label:'反射',ability:'reflect'}};
const mCan = document.createElement('canvas');mCan.width=300;mCan.height=110;
const mCtx=mCan.getContext('2d',{willReadFrequently:true});
const shapeCache=new Map();let idSeq=1;
const hypot=Math.hypot,clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const dot=(a,b)=>a.x*b.x+a.y*b.y;
const cross=(a,b)=>a.x*b.y-a.y*b.x;
const crossSV=(s,v)=>({x:-s*v.y,y:s*v.x});
const vsub=(a,b)=>({x:a.x-b.x,y:a.y-b.y});
function shapeFor(text){
 if(shapeCache.has(text))return shapeCache.get(text);
 mCtx.clearRect(0,0,300,110);
 const fontSize=text.length>1?57:65;
 mCtx.font=`1000 ${fontSize}px "Noto Sans CJK JP","Hiragino Kaku Gothic ProN","Yu Gothic",sans-serif`;
 mCtx.textAlign='center';mCtx.textBaseline='middle';mCtx.fillStyle='#000';mCtx.fillText(text,150,55);
 const data=mCtx.getImageData(0,0,300,110).data;
 let x0=300,x1=0,y0=110,y1=0;
 for(let y=8;y<102;y+=2)for(let x=25;x<275;x+=2){if(data[(y*300+x)*4+3]>60){x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y)}}
 if(x0>=x1){x0=150-text.length*32;x1=150+text.length*32;y0=18;y1=89}
 // Four horizontal convex strips form a compound approximation of the visible kanji strokes.
 const h=y1-y0+2,cx=(x0+x1)/2,cy=(y0+y1)/2,parts=[];
 for(let i=0;i<4;i++){
  const sy=Math.max(0,Math.floor(y0+i*h/4-1));
  const ey=Math.min(109,Math.ceil(y0+(i+1)*h/4+1));
  let mn=300,mx=0;
  for(let y=sy;y<=ey;y++)for(let x=Math.max(0,x0-5);x<Math.min(300,x1+5);x++){
   if(data[(y*300+x)*4+3]>65){mn=Math.min(mn,x);mx=Math.max(mx,x)}
  }
  if(mx<=mn)continue;
  const L=mn-4,R=mx+4,T=sy-2,B=ey+2;
  parts.push({x:(L+R)/2-cx,y:(T+B)/2-cy,w:Math.max(8,R-L),h:B-T});
 }
 if(!parts.length)parts.push({x:0,y:0,w:(x1-x0)+8,h:(y1-y0)+8});
 const s={parts,w:x1-x0+10,h:y1-y0+10,fontSize,centerOffsetY:55-cy};
 shapeCache.set(text,s);return s;
}
function body({x,y,text,owner,word,merged=false,angle=0,vx=0,vy=0,omega=0}){
 const s=shapeFor(text),ability=merged?(WORDS[word]?.ability||null):null;
 const mass=merged?2.1:1;
 const inertia=mass*(s.w*s.w+s.h*s.h)/12;
 return {id:idSeq++,text,word,owner,merged,ability,x,y,vx,vy,angle,omega,mass,invM:1/mass,invI:1/inertia,w:s.w,h:s.h,parts:s.parts,radius:hypot(s.w,s.h)*.58+6,scale:1,growthStacks:0,lastGrowthTime:-100,shotDir:{x:1,y:0},burstAge:null,burstStage:null,homingLeft:0,burstFired:false,shockArmed:false,vortexArmed:false,vortexTriggered:false,strikeSpent:false,strikeFirstEnemyId:null,splitTier:0,attackFactor:1,splitLockUntil:0,splitQueued:false,awakened:false,awakenAt:-1,alive:true,merging:false,trail:[],trailTime:0,shotAt:-100,flash:0,jump:null,vortexHitEnemy:false,wallBoostAt:-99,reflectAt:-99,magnetArmed:false,magnetTriggered:false};
}
function staticRect(x,y,w,h){return {id:'wall',owner:-1,x,y,angle:0,vx:0,vy:0,omega:0,invM:0,invI:0,mass:Infinity,parts:[{x:0,y:0,w,h}],radius:hypot(w,h)/2,alive:true,static:true};}
// Four small, solid corner wedges. The sloping 45-degree face is a REAL collision surface.
const CORNER_SIZE=64;
// Streak mode alone has four small triangular KO corners, with sealed mid-side gates.
const STREAK_CORNER_SIZE=156;
function staticTriangle(coords){
 const minX=Math.min(...coords.map(p=>p.x)),maxX=Math.max(...coords.map(p=>p.x));
 const minY=Math.min(...coords.map(p=>p.y)),maxY=Math.max(...coords.map(p=>p.y));
 const x=(minX+maxX)/2,y=(minY+maxY)/2;
 return {id:'corner',owner:-1,x,y,angle:0,vx:0,vy:0,omega:0,
  invM:0,invI:0,mass:Infinity,
  parts:[{x:0,y:0,w:maxX-minX,h:maxY-minY,polygon:coords.map(p=>({x:p.x-x,y:p.y-y}))}],
  radius:hypot(maxX-minX,maxY-minY)/2,alive:true,static:true};
}
function cornerWalls(){const s=CORNER_SIZE;return [
 staticTriangle([{x:0,y:0},{x:s,y:0},{x:0,y:s}]),
 staticTriangle([{x:W,y:0},{x:W-s,y:0},{x:W,y:s}]),
 staticTriangle([{x:0,y:H},{x:s,y:H},{x:0,y:H-s}]),
 staticTriangle([{x:W,y:H},{x:W-s,y:H},{x:W,y:H-s}])
];}
function streakWalls(){
 const s=STREAK_CORNER_SIZE;
 // The four diagonal corner cut-outs are open KO zones, NOT solid wedges.
 // Every straight edge between the corner zones is a real solid wall.
 return [staticRect(W/2,-10,W-2*s,28),staticRect(W/2,H+10,W-2*s,28),
  staticRect(-10,H/2,28,H-2*s),staticRect(W+10,H/2,28,H-2*s)];
}
// The triangular opening is NOT itself an instant KO region. A kanji must
// travel completely beyond the visible wood board before it counts as out.
// Use its rotated bounding extent (not just the center) so the last visible
// stroke is allowed to leave. Only the four corner exits can award a KO.
function streakExtent(b){
 const c=Math.abs(Math.cos(b.angle||0)),s=Math.abs(Math.sin(b.angle||0));
 return {hx:Math.max(3,((b.w||0)*c+(b.h||0)*s)*.5),
         hy:Math.max(3,((b.w||0)*s+(b.h||0)*c)*.5)};
}
function streakCornerMargin(b){
 const {hx,hy}=streakExtent(b),s=STREAK_CORNER_SIZE,eps=2;
 const ds=[];
 // Completely off the TOP/BOTTOM edge through a corner opening.
 if(b.x<=s-hx*.25||b.x>=W-s+hx*.25){
  ds.push(b.y+hy+eps,H-b.y+hy+eps);
 }
 // Completely off the LEFT/RIGHT edge through a corner opening.
 if(b.y<=s-hy*.25||b.y>=H-s+hy*.25){
  ds.push(b.x+hx+eps,W-b.x+hx+eps);
 }
 // A piece in the board center is not outside, regardless of the diagonal.
 return ds.length?Math.min(...ds):Infinity;
}
function inStreakCornerOut(b){return streakCornerMargin(b)<=0;}
function walls(gx=184,gy=165,preparation=false){
 if(preparation)return [...cornerWalls(),
  staticRect(W/2,-10,W+28,28),staticRect(W/2,H+10,W+28,28),
  staticRect(-10,H/2,28,H+28),staticRect(W+10,H/2,28,H+28),
  // The two-turn preparation phase has an impenetrable midcourt barrier.
  staticRect(W/2,H/2,W+28,20)
 ];
 const spanX=(W-gx)/2,spanY=(H-gy)/2;
 return [...cornerWalls(),
  staticRect(spanX/2,-10,spanX,28),staticRect(W-spanX/2,-10,spanX,28),
  staticRect(spanX/2,H+10,spanX,28),staticRect(W-spanX/2,H+10,spanX,28),
  staticRect(-10,spanY/2,28,spanY),staticRect(-10,H-spanY/2,28,spanY),
  staticRect(W+10,spanY/2,28,spanY),staticRect(W+10,H-spanY/2,28,spanY)
 ];
}
function openArena(world){world.preparation=false;world.walls=walls(world.gateX,world.gateY,false);world.fields.length=0}
function setStreakArena(world){
 // Win-streak mode ONLY: seal all original four mid-side KO gaps, open all four corners.
 world.preparation=false;world.prepTurns=2;world.practiceSealed=false;
 world.cornerKnockout=true;world.suddenDeath=false;world.gateX=0;world.gateY=0;world.suddenTurns=0;
 world.walls=streakWalls();world.fields.length=0;
}
function sealPracticeArena(world){
 // Ability effects remain ON while all four exits are completely sealed.
 world.preparation=false;world.practiceSealed=true;
 world.gateX=0;world.gateY=0;world.walls=walls(0,0,false);world.fields.length=0;
}
function expandGates(world){
 if(!world.suddenDeath||world.preparation)return false;
 world.suddenTurns++;
 const prevX=world.gateX,prevY=world.gateY;
 world.gateX=Math.min(W-44,world.gateX+PIECE_UNIT);
 world.gateY=Math.min(H-44,world.gateY+PIECE_UNIT);
 world.walls=walls(world.gateX,world.gateY,false);
 return world.gateX!==prevX||world.gateY!==prevY;
}

function points(b,part){const co=Math.cos(b.angle),si=Math.sin(b.angle),cx=b.x+part.x*co-part.y*si,cy=b.y+part.x*si+part.y*co;
 if(part.polygon)return part.polygon.map(p=>({x:cx+p.x*co-p.y*si,y:cy+p.x*si+p.y*co}));
 const wx=part.w/2,hy=part.h/2;
 return [{x:cx-wx*co+hy*si,y:cy-wx*si-hy*co},{x:cx+wx*co+hy*si,y:cy+wx*si-hy*co},
 {x:cx+wx*co-hy*si,y:cy+wx*si+hy*co},{x:cx-wx*co-hy*si,y:cy-wx*si+hy*co}];
}
function project(vertices,n){let lo=Infinity,hi=-Infinity;for(const v of vertices){const p=v.x*n.x+v.y*n.y;lo=Math.min(lo,p);hi=Math.max(hi,p)}return [lo,hi]}
function partSAT(a,b,va,vb){let overlap=Infinity,norm=null;
 for(const verts of [va,vb])for(let i=0;i<verts.length;i++){
  const p=verts[i],q=verts[(i+1)%verts.length],vx=q.x-p.x,vy=q.y-p.y,len=hypot(vx,vy)||1,n={x:-vy/len,y:vx/len};
  const pa=project(va,n),pb=project(vb,n),amount=Math.min(pa[1],pb[1])-Math.max(pa[0],pb[0]);
  if(amount<=0)return null;
  if(amount<overlap){overlap=amount;norm=n}
 }
 if(!norm)return null;
 const d=vsub(b,a);if(dot(d,norm)<0){norm.x*=-1;norm.y*=-1}
 let aMax=-Infinity,bMin=Infinity,ap=null,bp=null;
 for(const p of va){const z=dot(p,norm);if(z>aMax){aMax=z;ap=p}}
 for(const p of vb){const z=dot(p,norm);if(z<bMin){bMin=z;bp=p}}
 return {depth:overlap,n:norm,point:{x:(ap.x+bp.x)/2,y:(ap.y+bp.y)/2}};
}
function manifold(a,b){if(!a.alive||!b.alive)return null;
 if(!a.static&&!b.static&&hypot(a.x-b.x,a.y-b.y)>a.radius+b.radius)return null;
 let chosen=null;
 for(let i=0;i<a.parts.length;i++){
  const va=points(a,a.parts[i]);
  for(let j=0;j<b.parts.length;j++){
   const vb=points(b,b.parts[j]);let hit=partSAT(a,b,va,vb);
   // Choose the deepest valid strip collision to avoid opposing internal contacts.
   if(hit&&(!chosen||hit.depth>chosen.depth))chosen=hit;
  }
 }
 return chosen;
}
function fieldPosition(world,f){
 const anchor=world.bodies.find(b=>b.id===f.sourceId&&b.alive);
 return anchor?{x:anchor.x,y:anchor.y}:f;
}
function defenseFactor(world,b,kind='attack'){
 // Spell abilities (shockwave / vortex) always act at ×1.0, even in iron fields.
 // Walls are neutral scenery, not an attacking piece.
 if(kind!=='attack'||!world||world.preparation||b.static||!b.alive)return 1;
 // Only tile-to-tile impacts use the iron-body and ally-field defense.
 let factor=b.ability==='iron'?.6:1;
 for(const f of world.fields){
  if(f.owner!==b.owner)continue;
  const pt=fieldPosition(world,f);
  if(hypot(b.x-pt.x,b.y-pt.y)<=f.radius)factor=Math.min(factor,.7);
 }
 return factor;
}

function applyImpulse(world,b,ix,iy,r,sign=1,kind='attack'){if(b.static)return;
 const guard=defenseFactor(world,b,kind);b.vx+=ix*b.invM*sign*guard;b.vy+=iy*b.invM*sign*guard;
 b.omega+=cross(r,{x:ix,y:iy})*b.invI*sign*guard;
}
function isCorner(attacker,point){
 const dx=point.x-attacker.x,dy=point.y-attacker.y,c=Math.cos(attacker.angle),s=Math.sin(attacker.angle);
 const lx=dx*c+dy*s,ly=-dx*s+dy*c;
 return Math.abs(lx) > attacker.w*.32 && Math.abs(ly) > attacker.h*.30;
}
function attackMultiplier(world,attacker,isEnemy,corner){
 if(!isEnemy||!attacker||attacker.static||world.preparation)return corner?1.2:1;
 // 分裂 fragments keep their own damage fraction, including during the opponent's turn.
 if(attacker.ability==='split')return attacker.attackFactor;
 if(attacker.id!==world.shooterId)return corner?1.2:1;
 // The first enemy CONTACT only (not the first wall): after this, ordinary damage.
 if(attacker.ability==='strike')return attacker.strikeSpent?(corner?1.2:1):(corner?5:3);
 const giant=attacker.ability==='giant'?Math.pow(1.1,Math.min(3,attacker.growthStacks+1)):1;
 return (corner?1.2:1)*giant;
}
function resolve(world,a,b,m,step,onImpact,attacker,splitRequests){
 const n=m.n,p=m.point,rA={x:p.x-a.x,y:p.y-a.y},rB={x:p.x-b.x,y:p.y-b.y};
 const inv=a.invM+b.invM;if(inv<EPS)return;
 const corr=Math.max(0,m.depth-0.4)*.53/inv;
 if(!a.static){a.x-=n.x*corr*a.invM;a.y-=n.y*corr*a.invM}
 if(!b.static){b.x+=n.x*corr*b.invM;b.y+=n.y*corr*b.invM}
 const va={x:a.vx-a.omega*rA.y,y:a.vy+a.omega*rA.x},vb={x:b.vx-b.omega*rB.y,y:b.vy+b.omega*rB.x};
 const rv=vsub(vb,va),vn=dot(rv,n);
 if(vn>=0)return;
 const contactSpeed=-vn;
 const rac=cross(rA,n),rbc=cross(rB,n);const denom=inv+rac*rac*a.invI+rbc*rbc*b.invI;
 if(denom<EPS)return;
 const isEnemy=!a.static&&!b.static&&a.owner!==b.owner;
 const corner=!!(isEnemy&&attacker&&attacker.ability!=='split'&&contactSpeed>165&&isCorner(attacker,p));
 const restitution=(a.static||b.static)?0.64:0.73;
 // Exact total hit strength: a launched '一撃' deals 3x, or 5x on a corner hit.
 // It must NOT multiply 3x by the universal 1.2x critical bonus.
 // Non-shooter split fragments can make attacks on either player's turn.
 const aForward=Math.max(0,dot(va,n)),bForward=Math.max(0,-dot(vb,n));
 const movingSplit=!attacker&&isEnemy?(aForward>=bForward?a:b):null;
 const striker=attacker||(movingSplit?.ability==='split'?movingSplit:null);
 const skill=attackMultiplier(world,striker,isEnemy,corner);
 const firstStrike=!!(isEnemy&&!world.preparation&&attacker?.ability==='strike'&&attacker.id===world.shooterId&&!attacker.strikeSpent);
 if(firstStrike){attacker.strikeSpent=true;attacker.strikeFirstEnemyId=(a===attacker?b:a).id;}
 if(!world.preparation&&isEnemy&&attacker&&attacker.ability==='vortex'&&attacker.id===world.shooterId&&contactSpeed>60)attacker.vortexHitEnemy=true;
 const impact=Math.min(20000,(-(1+restitution)*vn/denom)*skill);
 const imp={x:n.x*impact,y:n.y*impact};
 const interaction=(a.static||b.static)?'wall':'attack';
 applyImpulse(world,a,imp.x,imp.y,rA,-1,interaction);applyImpulse(world,b,imp.x,imp.y,rB,1,interaction);
 // Tangential impulse transfers spin into physically grounded sideways ricochets.
 const newA={x:a.vx-a.omega*rA.y,y:a.vy+a.omega*rA.x},newB={x:b.vx-b.omega*rB.y,y:b.vy+b.omega*rB.x};
 const tangent=vsub(newB,newA);let proj=dot(tangent,n);tangent.x-=proj*n.x;tangent.y-=proj*n.y;
 const tlen=hypot(tangent.x,tangent.y);
 if(tlen>EPS){tangent.x/=tlen;tangent.y/=tlen;
  const ta=cross(rA,tangent),tb=cross(rB,tangent),tden=inv+ta*ta*a.invI+tb*tb*b.invI;
  if(tden>EPS){const slip=dot(vsub(newB,newA),tangent);const jt=clamp(-slip/tden,-impact*.26,impact*.26);
   applyImpulse(world,a,tangent.x*jt,tangent.y*jt,rA,-1,interaction);applyImpulse(world,b,tangent.x*jt,tangent.y*jt,rB,1,interaction)}
 }
 // Defensive reflection: ONLY on the opponent's turn and ONLY a physical
 // enemy-piece collision. Return an extra 100% of this contact's normal impulse
 // to the opponent; do not deal this force to the reflecting tile itself.
 if(isEnemy&&!world.preparation&&world.shotSerial>0&&contactSpeed>12){
  for(const shield of [a,b]){
   const intruder=shield===a?b:a;
   if(shield.ability!=='reflect'||shield.owner===world.lastShooterOwner||intruder.owner!==world.lastShooterOwner)continue;
   if(world.time-shield.reflectAt<.16)continue;
   shield.reflectAt=world.time;
   const sign=shield===a?1:-1;
   const push=impact*REFLECT_MULTIPLIER;
   applyImpulse(world,intruder,n.x*push,n.y*push,{x:p.x-intruder.x,y:p.y-intruder.y},sign, 'attack');
   onImpact?.reflect?.({shield,intruder,p,push,step});
  }
 }
 // Ricochet speed increases on the owner's turn, regardless of which piece
 // was selected to shoot. Both perimeter walls and corner wedges count.
 if(!isEnemy&&!world.preparation&&world.shotSerial>0){
  const piece=a.static?b:b.static?a:null;
  if(piece&&piece.ability==='ricochet'&&piece.owner===world.lastShooterOwner&&contactSpeed>45&&world.time-piece.wallBoostAt>=.18){
   const incoming=piece===a?va:vb;
   const entrySpeed=hypot(incoming.x,incoming.y),exitSpeed=hypot(piece.vx,piece.vy);
   if(entrySpeed>45&&exitSpeed>1){
    const goal=Math.min(1800,Math.max(exitSpeed,entrySpeed*RICOCHET_BOOST));
    piece.vx*=goal/exitSpeed;piece.vy*=goal/exitSpeed;piece.wallBoostAt=world.time;
    onImpact?.wallBoost?.({piece,p,speed:goal,step});
   }
  }
 }
 // The collision happens normally before the splitting animation/spawn.
 // A split activates on contact during either player's turn, never in preparation.
 if(isEnemy&&!world.preparation&&contactSpeed>12){
  for(const tile of [a,b]){
   const other=tile===a?b:a;
   if(tile.ability!=='split'||tile.splitTier>=2||tile.splitQueued)continue;
   if(tile.owner===world.lastShooterOwner || other.owner!==world.lastShooterOwner)continue;
   if(world.shotSerial<1||world.splitUsedShot===world.shotSerial||world.time<tile.splitLockUntil)continue;
   tile.splitQueued=true;
   splitRequests.push({piece:tile,hit:{x:p.x,y:p.y},normal:{x:n.x,y:n.y}});
  }
 }
 if(onImpact?.impact&&(contactSpeed>80||firstStrike||(attacker?.shockArmed&&attacker.id===world.shooterId)))onImpact.impact({a,b,p,n,speed:contactSpeed,corner,impulse:impact,skill,firstStrike,step});
}
// Prevent fast split fragments from passing through a CLOSED side wall.
// A fragment is allowed to leave normally through a genuine central gate.
function guardStreakEdges(world,b,previous=null){
 if(!b.alive)return;
 const c=Math.abs(Math.cos(b.angle)),si=Math.abs(Math.sin(b.angle));
 const hx=Math.max(4,(b.w*c+b.h*si)*.5),hy=Math.max(4,(b.w*si+b.h*c)*.5);
 const s=STREAK_CORNER_SIZE;
 // If the piece travelled through a closed side, it must bounce, even if
 // a very fast frame would otherwise place its center in the corner KO region.
 const throughLeft=previous&&previous.x>=0&&previous.y>=s&&previous.y<=H-s&&b.x<hx;
 const throughRight=previous&&previous.x<=W&&previous.y>=s&&previous.y<=H-s&&b.x>W-hx;
 const throughTop=previous&&previous.y>=0&&previous.x>=s&&previous.x<=W-s&&b.y<hy;
 const throughBottom=previous&&previous.y<=H&&previous.x>=s&&previous.x<=W-s&&b.y>H-hy;
 // Corner triangles are open. Do not bounce a piece that enters along
 // a diagonal; it must receive a genuine KO instead.
 if(inStreakCornerOut(b)&&!throughLeft&&!throughRight&&!throughTop&&!throughBottom)return;
 if((b.y>=s&&b.y<=H-s||throughLeft)&&b.x<hx+1){b.x=hx+1;b.vx=Math.abs(b.vx)*.62;}
 if((b.y>=s&&b.y<=H-s||throughRight)&&b.x>W-hx-1){b.x=W-hx-1;b.vx=-Math.abs(b.vx)*.62;}
 if((b.x>=s&&b.x<=W-s||throughTop)&&b.y<hy+1){b.y=hy+1;b.vy=Math.abs(b.vy)*.62;}
 if((b.x>=s&&b.x<=W-s||throughBottom)&&b.y>H-hy-1){b.y=H-hy-1;b.vy=-Math.abs(b.vy)*.62;}
}
function guardFragmentEdges(world,b){
 if(!b.alive||!b.splitTier)return;
 if(world.cornerKnockout){guardStreakEdges(world,b);return;}
 const c=Math.abs(Math.cos(b.angle)),si=Math.abs(Math.sin(b.angle));
 const hx=Math.max(3,(b.w*c+b.h*si)*.5),hy=Math.max(3,(b.w*si+b.h*c)*.5);
 const openY=!world.preparation&&!world.practiceSealed&&Math.abs(b.y-H*.5)<world.gateY*.5-hy;
 const openX=!world.preparation&&!world.practiceSealed&&Math.abs(b.x-W*.5)<world.gateX*.5-hx;
 // Restore pieces that penetrated a solid section instead of awarding a false KO.
 if(!openY&&b.x<hx+1){b.x=hx+1;b.vx=Math.abs(b.vx)*.62;}
 if(!openY&&b.x>W-hx-1){b.x=W-hx-1;b.vx=-Math.abs(b.vx)*.62;}
 if(!openX&&b.y<hy+1){b.y=hy+1;b.vy=Math.abs(b.vy)*.62;}
 if(!openX&&b.y>H-hy-1){b.y=H-hy-1;b.vy=-Math.abs(b.vy)*.62;}
}
// Spawn fragments fully outside walls, including the four triangular corners.
// This correction is done before the next physics tick, not after an out判定.
function resolveFragmentSpawn(world,b){
 guardFragmentEdges(world,b);
 for(let i=0;i<9;i++){
  let fixed=false;
  for(const wall of world.walls){
   const m=manifold(b,wall);if(!m)continue;
   b.x-=m.n.x*(m.depth+1.3);b.y-=m.n.y*(m.depth+1.3);
   guardFragmentEdges(world,b);fixed=true;
  }
  if(!fixed)break;
 }
}
function stepOnce(world,dt,hooks={}){
 const bodies=world.bodies,staticWalls=world.walls;
 const before=world.cornerKnockout?new Map(bodies.filter(b=>b.alive).map(b=>[b.id,{x:b.x,y:b.y}])):null;
 world.time+=dt;
 for(const b of bodies){if(!b.alive||b.merging)continue;
  // Shock flies over the board for 0.5 s, without a collision during the jump.
  if(b.jump){
   b.jump.age=Math.min(b.jump.duration,b.jump.age+dt);
   const t=b.jump.age/b.jump.duration;
   b.x=b.jump.from.x+(b.jump.to.x-b.jump.from.x)*t;
   b.y=b.jump.from.y+(b.jump.to.y-b.jump.from.y)*t;
   b.omega*=Math.exp(-2*dt);b.angle+=b.omega*dt;
   if(t>=1){b.jump=null;b.vx=0;b.vy=0;const wave=triggerShock(world,b);hooks.shockLand?.(b,wave);}
   else continue;
  }
  // 暴走: wait for the first glide to stop, then home for one second.
  if(!world.preparation&&b.ability==='burst'&&b.burstStage==='coast'){
   b.burstAge+=dt;
   if(b.burstAge>.28&&hypot(b.vx,b.vy)<16){
    const nearest=nearestEnemy(world,b);
    if(nearest){b.burstStage='homing';b.homingLeft=1.0;b.burstFired=true;hooks.ability?.(b,'burst');}
    else b.burstStage='done';
   }
  }else if(!world.preparation&&b.ability==='burst'&&b.burstStage==='homing'){
   const nearest=nearestEnemy(world,b);
   if(nearest){
    const dx=nearest.x-b.x,dy=nearest.y-b.y,dist=hypot(dx,dy)||1;
    const desired=880,steer=Math.min(1,dt*5.8);
    b.vx+=(dx/dist*desired-b.vx)*steer;
    b.vy+=(dy/dist*desired-b.vy)*steer;
   }
   b.homingLeft-=dt;
   if(b.homingLeft<=0)b.burstStage='done';
  }
  // Magnetic attraction applies only to the original enemy list captured at activation.
  for(const mag of world.magnets){
   const target=mag.targets.includes(b.id);
   if(!target||b.owner===mag.owner)continue;
   const dx=mag.center.x-b.x,dy=mag.center.y-b.y,dist=hypot(dx,dy);
   if(dist<14)continue;
   const desired=Math.min(680,Math.max(80,(dist-42)*4));
   const k=Math.min(1,dt*8);
   b.vx+=(dx/dist*desired-b.vx)*k;
   b.vy+=(dy/dist*desired-b.vy)*k;
  }
  // Original Ver.1.2 vortex: only enemies in range at activation are captured.
  // No late entrants and no friendly fire from the vortex itself.
  for(const v of world.vortices){
   if(b.owner===v.owner)continue;
   const t=v.targets.find(t=>t.id===b.id);
   if(!t)continue;
   const phase=clamp(v.age/v.duration,0,1),ang=t.angle+2*Math.PI*2*phase;
   const radius=t.radius+v.expand*phase;
   const cx=v.center.x,cy=v.center.y;
   const px=cx+Math.cos(ang)*radius,py=cy+Math.sin(ang)*radius;
   const w=4*Math.PI/v.duration,vr=v.expand/v.duration;
   const vx=vr*Math.cos(ang)-radius*w*Math.sin(ang),vy=vr*Math.sin(ang)+radius*w*Math.cos(ang);
   // Vortex is an ability, NOT a physical attack. Iron cannot reduce its effect.
   const bias=0.70;
   b.vx+=clamp((px-b.x)*7+vx-b.vx,-2000,2000)*Math.min(1,dt*8)*bias;
   b.vy+=clamp((py-b.y)*7+vy-b.vy,-2000,2000)*Math.min(1,dt*8)*bias;
   break;
  }
  let speed=hypot(b.vx,b.vy);
  if(speed>15&&Math.abs(b.omega)>.1){const lift=b.omega*.025;b.vx+=-b.vy*lift*dt;b.vy+=(b.vx)*lift*dt;}
  const drag=2.0;
  const damping=Math.exp(-drag*dt);b.vx*=damping;b.vy*=damping;
  b.omega*=Math.exp(-2.9*dt);
  speed=hypot(b.vx,b.vy);if(speed>9500){b.vx*=9500/speed;b.vy*=9500/speed}
  if(speed<3.5){b.vx=0;b.vy=0}
  if(Math.abs(b.omega)<.05)b.omega=0;
  b.x+=b.vx*dt;b.y+=b.vy*dt;b.angle+=b.omega*dt;
  if(b.angle>Math.PI*2)b.angle-=Math.PI*2;if(b.angle< -Math.PI*2)b.angle+=Math.PI*2;
  b.flash=Math.max(0,b.flash-dt*3);
 }
 // Each target standing within the landing circle at the landing instant is hit once.
 // The visible ring continues to expand, but the push happens simultaneously, not one by one.
 if(world.shocks.length){
  for(let i=world.shocks.length-1;i>=0;i--){
   const wave=world.shocks[i];wave.age+=dt;
   wave.radius=Math.min(wave.maxRadius,wave.age*wave.speed);
   if(wave.pending){
    for(const shot of wave.pending){
     const target=bodies.find(b=>b.id===shot.id&&b.alive);
     if(!target||wave.hit.has(target.id))continue;
     wave.hit.add(target.id);
     // Each coin gets the momentum of one full-strength ordinary hit.
     // Adjust for the target's mass as a real collision would, with NO iron guard.
     const impulse=shockFullImpulse(target.mass);
     target.vx+=shot.nx*impulse*target.invM;
     target.vy+=shot.ny*impulse*target.invM;
     target.omega+=((target.id%2)?1:-1)*.65;
     target.flash=Math.max(target.flash,.7);
     hooks.shockHit?.(wave,target,impulse);
    }
    wave.pending=null;
   }
   if(wave.age>Math.max(.37,wave.maxRadius/wave.speed+.15))world.shocks.splice(i,1);
  }
 }
 for(let i=world.vortices.length-1;i>=0;i--){
  world.vortices[i].age+=dt;
  if(world.vortices[i].age>=world.vortices[i].duration)world.vortices.splice(i,1);
 }
 for(let i=world.magnets.length-1;i>=0;i--){
  world.magnets[i].age+=dt;
  if(world.magnets[i].age>=world.magnets[i].duration)world.magnets.splice(i,1);
 }
 const merges=[],splitRequests=[];
 for(let pass=0;pass<2;pass++){
  for(let i=0;i<bodies.length;i++){
   const a=bodies[i];if(!a.alive||a.merging||a.jump)continue;
   for(let j=i+1;j<bodies.length;j++){
    const b=bodies[j];if(!b.alive||b.merging||b.jump)continue;
    const m=manifold(a,b);if(!m)continue;
    const rel=hypot(a.vx-b.vx,a.vy-b.vy);
    if(!a.merged&&!b.merged&&a.word===b.word&&a.text!==b.text&&rel>=55){
      a.merging=b.merging=true;merges.push([a,b]);break;
    }
    const attacker=a.id===world.shooterId?a:b.id===world.shooterId?b:null;
    resolve(world,a,b,m,world.time,pass===0?hooks:null,attacker,splitRequests);
   }
  }
  for(const a of bodies){if(!a.alive||a.merging||a.jump)continue;
   for(const wall of staticWalls){
    if(Math.abs(a.x-wall.x)>a.radius+wall.parts[0].w/2||Math.abs(a.y-wall.y)>a.radius+wall.parts[0].h/2)continue;
    const m=manifold(a,wall);
    if(m)resolve(world,a,wall,m,world.time,pass===0?hooks:null,a.id===world.shooterId?a:null,splitRequests);
   }
  }
 }
 // Closed-wall anti-tunnelling: all pieces in the streak arena, small fragments
 // only in the ordinary arena. The diagonal corner KO holes remain open.
 if(world.cornerKnockout){for(const b of bodies)if(b.alive&&!b.jump)guardStreakEdges(world,b,before?.get(b.id));}
 else for(const b of bodies)if(b.alive&&b.splitTier>0&&!b.jump)guardFragmentEdges(world,b);
 for(const [a,b] of merges){if(a.alive&&b.alive)hooks.merge?.(a,b)}
 // Execute spawns AFTER SAT passes so a new child is not hit during the same contact.
 for(const req of splitRequests){
  if(!req.piece.alive||req.piece.merging)continue;
  const children=splitPiece(world,req.piece,req.normal);
  if(children)hooks.split?.(req.piece,children,req.hit);
  else req.piece.splitQueued=false;
 }
 // If a fast piece crosses an edge wall in the sealed training arena, bounce it back.
 // Never allow a score/out while practicing, even with extreme impulse abilities.
 if(world.practiceSealed)for(const b of bodies){if(!b.alive||b.merging)continue;
  const px=Math.max(12,b.w*.48),py=Math.max(12,b.h*.48);
  if(b.x<px){b.x=px;b.vx=Math.abs(b.vx)*.55}
  if(b.x>W-px){b.x=W-px;b.vx=-Math.abs(b.vx)*.55}
  if(b.y<py){b.y=py;b.vy=Math.abs(b.vy)*.55}
  if(b.y>H-py){b.y=H-py;b.vy=-Math.abs(b.vy)*.55}
 }
 // Streak KO: the full kanji must exit beyond a CORNER edge. Other modes still KO only
 // beyond their existing side openings. In a single physics microstep two
 // pieces may leave at different fractions of dt: report real crossing order,
 // NOT the insertion order of bodies, for first-out win streak scoring.
 const outPieces=[];
 for(const b of bodies){if(!b.alive||b.merging||world.preparation)continue;
  const out=world.cornerKnockout?inStreakCornerOut(b)
    :(b.x < -b.w*.4 || b.x>W+b.w*.4 || b.y< -b.h*.4 || b.y>H+b.h*.4);
  if(out)outPieces.push(b);
 }
 if(world.cornerKnockout&&outPieces.length>1){
  const fraction=b=>{
   const prev=before?.get(b.id);if(!prev)return -1;
   const start=streakCornerMargin(prev),end=streakCornerMargin(b);
   return start<=0?-1:start/Math.max(EPS,start-end);
  };
  outPieces.sort((a,b)=>fraction(a)-fraction(b)||a.id-b.id);
 }
 for(const b of outPieces){b.alive=false;hooks.out?.(b)}
 // The LAST unmerged character automatically awakens into its intended two-kanji word.
 // Apply once after all KOs for this simulation step; do not create a piece for a defeated team.
 if(!world.preparation&&remaining(world,0)>0 && remaining(world,1)>0){
  for(let owner=0;owner<2;owner++){
   if(world.awakenedOwners.has(owner))continue;
   const left=bodies.filter(b=>b.alive&&b.owner===owner);
   if(left.length!==1||left[0].merged)continue;
   const old=left[0];
   const upgraded=awakenPiece(world,old);
   hooks.awaken?.(upgraded,old);
  }
 }
 return world;
}
function step(world,dt,hooks={}){
 const fastest=world.bodies.reduce((high,b)=>b.alive?Math.max(high,hypot(b.vx,b.vy)):high,0);
 // A 1/3-scale split tile can be thinner than an ordinary frame displacement.
 // Use finer continuous-time samples when fragments exist, including very fast hits.
 const hasFragments=world.bodies.some(b=>b.alive&&b.splitTier>0);
 const minWidth=hasFragments?Math.min(...world.bodies.filter(b=>b.alive&&b.splitTier>0).map(b=>Math.min(b.w,b.h))):40;
 const targetTravel=hasFragments?Math.max(4,Math.min(8,minWidth*.30)):16;
 const subdivisions=Math.min(hasFragments?20:5,Math.max(1,Math.ceil(fastest*dt/targetTravel)));
 for(let i=0;i<subdivisions;i++)stepOnce(world,dt/subdivisions,hooks);
 return world;
}
function newWorld(){return {w:W,h:H,time:0,bodies:[],preparation:true,prepTurns:0,practiceSealed:false,shotSerial:0,splitUsedShot:-1,
 gateX:184,gateY:165,suddenDeath:false,suddenTurns:0,cornerKnockout:false,walls:walls(184,165,true),
 shocks:[],vortices:[],magnets:[],fields:[],awakenedOwners:new Set(),shooterId:null,lastShooterOwner:0,shotTime:0};}
function nearestEnemy(world,b){let nearest=null,best=Infinity;for(const p of world.bodies){if(!p.alive||p.owner===b.owner||p.id===b.id)continue;const d=hypot(p.x-b.x,p.y-b.y);if(d<best){best=d;nearest=p}}return nearest}
function finishTurn(world,owner,allowAbility=true){
 // A field persists throughout the OPPONENT's entire next turn, never more.
 // Remove the previous player's field; a fresh field may now be deployed.
 world.fields=[];
 if(world.preparation||!allowAbility)return world.fields;
 for(const b of world.bodies){
  if(!b.alive||b.owner!==owner||b.ability!=='iron')continue;
  world.fields.push({owner:b.owner,sourceId:b.id,x:b.x,y:b.y,radius:PIECE_UNIT*3});
 }
 return world.fields;
}
function growGiant(world,b){
 if(!b||!b.alive||b.ability!=='giant'||b.growthStacks>=3||world.time-b.lastGrowthTime<.24)return false;
 b.growthStacks++;b.lastGrowthTime=world.time;
 b.scale=Math.pow(1.2,b.growthStacks);
 const base=shapeFor(b.text);
 b.w=base.w*b.scale;b.h=base.h*b.scale;
 b.parts=base.parts.map(p=>({x:p.x*b.scale,y:p.y*b.scale,w:p.w*b.scale,h:p.h*b.scale}));
 b.radius=hypot(b.w,b.h)*.58+6;
 b.mass=2.1;b.invM=1/b.mass;b.invI=12/(b.mass*(b.w*b.w+b.h*b.h));
 b.flash=1;
 return true;
}
function splitPiece(world,parent,normal={x:1,y:0}){
 if(world.preparation||!parent.alive||parent.ability!=='split'||parent.splitTier>=2||world.lastShooterOwner===parent.owner||world.splitUsedShot===world.shotSerial||world.shotSerial<1)return null;
 world.splitUsedShot=world.shotSerial; // one split per defending team per opponent shot
 const nextTier=parent.splitTier+1,scale=SPLIT_SCALES[nextTier];
 // Preserve total mass and linear momentum when one piece becomes two.
 const halfMass=parent.mass/2,axis={x:-normal.y,y:normal.x};
 const base=shapeFor(parent.text),childW=base.w*scale;
 const offset=Math.max(23,childW/2+7);
 const children=[];
 for(const sign of [-1,1]){
  const child=body({text:'分裂',word:'分裂',owner:parent.owner,merged:true,
   x:parent.x+axis.x*offset*sign,y:parent.y+axis.y*offset*sign,
   vx:parent.vx+axis.x*sign*85,vy:parent.vy+axis.y*sign*85,
   omega:parent.omega+sign*1.3,angle:parent.angle+sign*.1});
  child.splitTier=nextTier;child.attackFactor=scale;child.scale=scale;
  child.w=base.w*scale;child.h=base.h*scale;
  child.parts=base.parts.map(p=>({x:p.x*scale,y:p.y*scale,w:p.w*scale,h:p.h*scale}));
  child.radius=hypot(child.w,child.h)*.58+6;
  child.mass=halfMass;child.invM=1/halfMass;
  child.invI=12/(halfMass*(child.w**2+child.h**2));
  child.splitLockUntil=world.time+.26;child.shotAt=parent.shotAt;
  child.isLaunched=parent.isLaunched;child.flash=1;
  // Keep the two fragments inside the bounded portions of the playfield.
  child.x=clamp(child.x,child.w*.48,W-child.w*.48);
  child.y=clamp(child.y,child.h*.48,H-child.h*.48);
  children.push(child);
 }
 // Both newborn pieces must be separated from every solid wall BEFORE the
 // current step ends; a split near the rim must not turn into an instant KO.
 for(const child of children)resolveFragmentSpawn(world,child);
 parent.alive=false;parent.splitQueued=false;
 if(world.shooterId===parent.id)world.shooterId=children[0].id;
 world.bodies.push(...children);
 // When a piece splits while vortexed, keep BOTH new fragments in the vortex.
 for(const v of world.vortices){
  const old=v.targets.find(t=>t.id===parent.id);if(!old)continue;
  v.targets=v.targets.filter(t=>t.id!==parent.id);
  for(const child of children)v.targets.push({id:child.id,
   angle:Math.atan2(child.y-v.center.y,child.x-v.center.x)-4*Math.PI*v.age/v.duration,
   radius:Math.max(18,hypot(child.x-v.center.x,child.y-v.center.y)-v.expand*v.age/v.duration)});
 }
 return children;
}
function retargetVortices(world,retiredIds,replacement){
 // Preserve swirling enemies when they transform via awakening or fusion mid-animation.
 for(const vortex of world.vortices){
  const old=vortex.targets.find(t=>retiredIds.includes(t.id));if(!old)continue;
  vortex.targets=vortex.targets.filter(t=>!retiredIds.includes(t.id));
  if(!vortex.targets.some(t=>t.id===replacement.id)&&replacement.id!==vortex.sourceId&&replacement.owner!==vortex.owner){
   vortex.targets.push({id:replacement.id,
    angle:Math.atan2(replacement.y-vortex.center.y,replacement.x-vortex.center.x)-4*Math.PI*vortex.age/vortex.duration,
    radius:Math.max(22,hypot(replacement.x-vortex.center.x,replacement.y-vortex.center.y)-vortex.expand*vortex.age/vortex.duration)});
  }
 }
}
function startVortex(world,b){
 // Restore original Ver.1.2: activates after shot stops, even without a direct hit.
 if(world.preparation||!b||!b.alive||b.ability!=='vortex'||!b.vortexArmed||b.vortexTriggered)return null;
 b.vortexArmed=false;b.vortexTriggered=true;
 const range=235;
 const targets=world.bodies.filter(p=>p.alive&&p.owner!==b.owner&&hypot(p.x-b.x,p.y-b.y)<=range)
 .map(p=>({id:p.id,angle:Math.atan2(p.y-b.y,p.x-b.x),radius:Math.max(28,hypot(p.x-b.x,p.y-b.y))}));
 const v={sourceId:b.id,owner:b.owner,center:{x:b.x,y:b.y},age:0,duration:2.3,expand:95,range,targets};
 world.vortices.push(v);return v;
}
function startMagnet(world,b){
 if(world.preparation||!b||!b.alive||b.ability!=='magnet'||!b.magnetArmed||b.magnetTriggered)return null;
 b.magnetArmed=false;b.magnetTriggered=true;
 const targets=world.bodies.filter(p=>p.alive&&p.owner!==b.owner&&hypot(p.x-b.x,p.y-b.y)<=MAGNET_RANGE).map(p=>p.id);
 const mag={sourceId:b.id,owner:b.owner,center:{x:b.x,y:b.y},range:MAGNET_RANGE,age:0,duration:MAGNET_DURATION,targets};
 world.magnets.push(mag);return mag;
}
function spawnInitial(world,decks){
 // Side-by-side letters keep the board readable while giving each player achievable fusions.
 for(let owner=0;owner<2;owner++)for(let i=0;i<3;i++){
   const word=decks[owner][i],y=owner===0?482+i*87:278-i*87;
   const xA=owner===0?204:336,xB=owner===0?337:203;
   const first=word[0],second=word[1];
   world.bodies.push(body({x:xA+(i%2?9:-9),y,text:first,owner,word,angle:(owner?1:-1)*.06}));
   world.bodies.push(body({x:xB+(i%2?-9:9),y,text:second,owner,word,angle:(owner?-.04:.04)}));
 }
}
function fire(world,b,dx,dy,power,spin,spinStrength=1){
 const len=hypot(dx,dy)||1,amount=clamp(power,0,1);
 let speed=230+875*Math.pow(amount,1.12);

 b.vx=dx/len*speed;b.vy=dy/len*speed;
 // Spin strength is proportional to distance from piece to gesture START.
 const spinPower=clamp(spinStrength,0,1);
 b.omega=spin*(6.4+12.0*amount)*(.28+.72*spinPower);
 b.isLaunched=true;b.shotAt=world.time;b.shotDir={x:dx/len,y:dy/len};
 b.burstAge=!world.preparation&&b.ability==='burst'?0:null;
 b.burstStage=!world.preparation&&b.ability==='burst'?'coast':null;
 b.homingLeft=0;b.burstFired=false;
 b.shockArmed=!world.preparation&&b.ability==='shock';
 b.vortexArmed=!world.preparation&&b.ability==='vortex';b.vortexTriggered=false;b.vortexHitEnemy=false;
 b.magnetArmed=!world.preparation&&b.ability==='magnet';b.magnetTriggered=false;
 b.jump=null;b.strikeSpent=false;b.strikeFirstEnemyId=null;
 if(b.shockArmed){
  const from={x:b.x,y:b.y},landing=shockLanding(b,dx,dy,amount);
  const to={x:landing.x,y:landing.y};
  b.vx=0;b.vy=0;
  b.jump={from,to,age:0,duration:SHOCK_JUMP_SECONDS,power:amount,travelPieces:landing.travelPieces};
 }

 world.shotSerial=(world.shotSerial||0)+1;
 world.shooterId=b.id;world.lastShooterOwner=b.owner;world.shotTime=world.time;
 return speed;
}
function settle(world){for(const b of world.bodies){b.vx=0;b.vy=0;b.omega=0;b.isLaunched=false;b.burstAge=null;b.burstStage=null;b.homingLeft=0;b.shockArmed=false;b.vortexArmed=false;b.vortexHitEnemy=false;b.magnetArmed=false;b.jump=null;b.trail=[]}world.shocks.length=0;world.vortices.length=0;world.magnets.length=0;}
function allStopped(world){return !world.shocks.length&&!world.vortices.length&&!world.magnets.length&&!world.bodies.some(b=>b.alive&&(b.burstStage==='coast'||b.burstStage==='homing'||b.jump))&&world.bodies.filter(b=>b.alive&&!b.merging).every(b=>hypot(b.vx,b.vy)<10&&Math.abs(b.omega)<.17)}
function createMerged(world,a,b){
 const mass=a.mass+b.mass;
 const x=(a.x*a.mass+b.x*b.mass)/mass,y=(a.y*a.mass+b.y*b.mass)/mass;
 const vx=(a.vx*a.mass+b.vx*b.mass)/mass,vy=(a.vy*a.mass+b.vy*b.mass)/mass;
 const owner=a.owner===b.owner?a.owner:world.lastShooterOwner;
 const newB=body({x,y,vx,vy,word:a.word,text:a.word,owner,merged:true,angle:0,omega:(a.omega+b.omega)*.28});
 a.alive=b.alive=false;a.merging=b.merging=false;
 // Relax nearby bodies without giving the combined kanji a teleport advantage.
 for(let repeat=0;repeat<9;repeat++){
  for(const other of world.bodies){if(!other.alive||other===a||other===b)continue;
   const m=manifold(newB,other);if(!m)continue;
   newB.x-=m.n.x*m.depth*.52;newB.y-=m.n.y*m.depth*.52;
   other.x+=m.n.x*m.depth*.48;other.y+=m.n.y*m.depth*.48;
  }
 }
 world.bodies.push(newB);retargetVortices(world,[a.id,b.id],newB);return newB;
}
function remaining(world,owner){return world.bodies.filter(b=>b.alive&&b.owner===owner).length}
function triggerShock(world,attacker){
 if(world.preparation||!attacker||!attacker.alive||!attacker.shockArmed||attacker.id!==world.shooterId)return null;
 attacker.shockArmed=false;
 return spawnShockWave(world,attacker);
}
function shockFullImpulse(targetMass){
 // Equivalent to a 100%-power ordinary mass-1 tile striking this target head-on.
 return (1+NORMAL_RESTITUTION)*FULL_SHOT_SPEED/(1+1/targetMass);
}
function spawnShockWave(world,attacker){
 const range=PIECE_UNIT*SHOCK_RADIUS_PIECES;
 const wave={x:attacker.x,y:attacker.y,owner:attacker.owner,sourceId:attacker.id,
  jumpDir:{...attacker.shotDir},age:0,radius:0,maxRadius:range,speed:380,hit:new Set([attacker.id]),pending:[]};
 for(const target of world.bodies){
  if(!target.alive||target.merging||target.id===attacker.id)continue;
  const dx=target.x-wave.x,dy=target.y-wave.y,dist=hypot(dx,dy);
  if(dist>range+1e-7)continue;
  const nx=dist>1?dx/dist:wave.jumpDir.x,ny=dist>1?dy/dist:wave.jumpDir.y;
  wave.pending.push({id:target.id,nx,ny});
 }
 world.shocks.push(wave);return wave;
}

function awakenPiece(world,old){
 const result=body({x:old.x,y:old.y,vx:old.vx,vy:old.vy,omega:old.omega,angle:old.angle,
  text:old.word,word:old.word,owner:old.owner,merged:true});
 result.awakened=true;result.awakenAt=world.time;result.shotAt=old.shotAt;
 result.burstAge=null;result.burstStage=null;result.burstFired=false;result.isLaunched=!!old.isLaunched;
 old.alive=false;old.merging=false;
 if(world.shooterId===old.id)world.shooterId=result.id;
 world.awakenedOwners.add(old.owner);world.bodies.push(result);retargetVortices(world,[old.id],result);
 // Soft separation to avoid spawning the larger kanji fully inside an opponent.
 for(let k=0;k<7;k++)for(const other of world.bodies){
  if(!other.alive||other===result)continue;const hit=manifold(result,other);if(!hit)continue;
  result.x-=hit.n.x*hit.depth*.48;result.y-=hit.n.y*hit.depth*.48;
  other.x+=hit.n.x*hit.depth*.52;other.y+=hit.n.y*hit.depth*.52;
 }
 return result;
}
// Simplified 2-second disk physics predictor; only CPU planning uses this, never real collisions.
function evaluateShot(world, shooter,dir,power,spin){
 const bs=world.bodies.filter(b=>b.alive).map(b=>({x:b.x,y:b.y,vx:0,vy:0,m:b.mass,r:b.merged?42:29,owner:b.owner,text:b.text,word:b.word,merged:b.merged,alive:true,src:b.id===shooter.id,spin:0}));
 const actor=bs.find(b=>b.src);if(!actor)return -Infinity;
 let speed=(230+875*Math.pow(power,1.12)),len=hypot(dir.x,dir.y)||1;
 actor.vx=dir.x/len*speed;actor.vy=dir.y/len*speed;
 // CPU predictor uses the same power-dependent jump destination as the actual shot.
 // This is an inexpensive planning approximation; the real move still uses the SAT engine.
 if(!world.preparation&&shooter.ability==='shock'){
  const landing=shockLanding(shooter,dir.x,dir.y,power);
  actor.x=landing.x;actor.y=landing.y;
  actor.vx=0;actor.vy=0;
  for(const target of bs){if(target===actor)continue;
   const dx=target.x-actor.x,dy=target.y-actor.y,dist=hypot(dx,dy);
   if(dist>PIECE_UNIT*SHOCK_RADIUS_PIECES)continue;
   const nx=dist>1?dx/dist:dir.x/len,ny=dist>1?dy/dist:dir.y/len;
   target.vx+=nx*NORMAL_FULL_IMPULSE/target.m;
   target.vy+=ny*NORMAL_FULL_IMPULSE/target.m;
  }
 }
 const n0=[remaining(world,0),remaining(world,1)],merges=0;
 let t=0,doneMerges=0;
 for(let stepN=0;stepN<95;stepN++){
  const dt=1/55;t+=dt;
  for(const b of bs){if(!b.alive)continue;
   if(!world.preparation&&shooter.ability==='burst'&&b.src&&t>1&&t<2){const enemy=bs.filter(e=>e.alive&&e.owner!==b.owner).sort((p,q)=>hypot(p.x-b.x,p.y-b.y)-hypot(q.x-b.x,q.y-b.y))[0];if(enemy){const d=hypot(enemy.x-b.x,enemy.y-b.y)||1;b.vx+=(enemy.x-b.x)/d*400*dt;b.vy+=(enemy.y-b.y)/d*400*dt;}}
   if(b.src){const s=spin*.025;b.vx+=-b.vy*s*dt;b.vy+=b.vx*s*dt;}
   b.vx*=Math.exp(-2*dt);b.vy*=Math.exp(-2*dt);b.x+=b.vx*dt;b.y+=b.vy*dt;
   if(world.cornerKnockout){
    const s=STREAK_CORNER_SIZE;
    if(b.x<b.r&&b.y>=s&&b.y<=H-s&&b.vx<0){b.x=b.r;b.vx=Math.abs(b.vx)*.65}
    if(b.x>W-b.r&&b.y>=s&&b.y<=H-s&&b.vx>0){b.x=W-b.r;b.vx=-Math.abs(b.vx)*.65}
    if(b.y<b.r&&b.x>=s&&b.x<=W-s&&b.vy<0){b.y=b.r;b.vy=Math.abs(b.vy)*.65}
    if(b.y>H-b.r&&b.x>=s&&b.x<=W-s&&b.vy>0){b.y=H-b.r;b.vy=-Math.abs(b.vy)*.65}
   }else{
    if(b.x-b.r<0&&(world.preparation||!(Math.abs(b.y-H/2)<world.gateY/2))&&b.vx<0){b.x=b.r;b.vx=Math.abs(b.vx)*.65}
    if(b.x+b.r>W&&(world.preparation||!(Math.abs(b.y-H/2)<world.gateY/2))&&b.vx>0){b.x=W-b.r;b.vx=-Math.abs(b.vx)*.65}
    if(b.y-b.r<0&&(world.preparation||!(Math.abs(b.x-W/2)<world.gateX/2))&&b.vy<0){b.y=b.r;b.vy=Math.abs(b.vy)*.65}
    if(b.y+b.r>H&&(world.preparation||!(Math.abs(b.x-W/2)<world.gateX/2))&&b.vy>0){b.y=H-b.r;b.vy=-Math.abs(b.vy)*.65}
   }
   if(world.preparation){
    const crossLine=b.owner===0?b.y-b.r<H/2+11:b.y+b.r>H/2-11;
    if(crossLine){b.y=b.owner===0?H/2+11+b.r:H/2-11-b.r;b.vy*=-.65;}
   }else if(world.cornerKnockout?inStreakCornerOut(b):(b.x<-b.r||b.x>W+b.r||b.y<-b.r||b.y>H+b.r))b.alive=false;
  }
  for(let i=0;i<bs.length;i++)for(let j=i+1;j<bs.length;j++){
   const a=bs[i],b=bs[j];if(!a.alive||!b.alive)continue;
   const dx=b.x-a.x,dy=b.y-a.y,d=hypot(dx,dy)||1;if(d>a.r+b.r)continue;
   const nx=dx/d,ny=dy/d,overlap=a.r+b.r-d;
   a.x-=nx*overlap*.5;b.x+=nx*overlap*.5;a.y-=ny*overlap*.5;b.y+=ny*overlap*.5;
   const rv=(b.vx-a.vx)*nx+(b.vy-a.vy)*ny;if(rv<0){let impulse=-(1+.7)*rv/(1/a.m+1/b.m);
    if((a.src||b.src)&&a.owner!==b.owner){
     if(!world.preparation&&shooter.ability==='strike')impulse*=3;
     else if(!world.preparation&&shooter.ability==='giant')impulse*=Math.pow(1.1,Math.min(3,shooter.growthStacks+1));
    }
    a.vx-=nx*impulse/a.m;a.vy-=ny*impulse/a.m;b.vx+=nx*impulse/b.m;b.vy+=ny*impulse/b.m;
    if(!a.merged&&!b.merged&&a.word===b.word&&a.text!==b.text&& -rv>55){
     const winner=a.owner===b.owner?a.owner:shooter.owner;
     const mergedBody={x:(a.x+b.x)/2,y:(a.y+b.y)/2,vx:(a.vx+b.vx)/2,vy:(a.vy+b.vy)/2,m:2.1,r:43,owner:winner,text:a.word,word:a.word,merged:true,alive:true,src:false};
     a.alive=b.alive=false;bs.push(mergedBody);doneMerges++;}
   }
  }
 }
 const after=[0,0];let score=0;
 for(const b of bs)if(b.alive){after[b.owner]++;
  if(b.owner!==shooter.owner){let goal=world.cornerKnockout
   ?Math.min(b.x+b.y,W-b.x+b.y,b.x+H-b.y,W-b.x+H-b.y)-STREAK_CORNER_SIZE
   :Math.min(hypot(b.x-W/2,b.y),hypot(b.x-W/2,H-b.y),hypot(b.x,b.y-H/2),hypot(W-b.x,b.y-H/2));
   score+=(200-goal)*.025;
  }
 }
 const enemy=1-shooter.owner;
 score+=(n0[enemy]-after[enemy])*225-(n0[shooter.owner]-after[shooter.owner])*225;
 score+=doneMerges*(world.preparation?110:26);
 if(!world.preparation&&shooter.ability==='vortex')score+=bs.filter(b=>b.alive&&b.owner!==shooter.owner&&hypot(b.x-actor.x,b.y-actor.y)<=PIECE_UNIT*VORTEX_RADIUS_PIECES).length*18;
 if(!world.preparation&&shooter.ability==='shock')score+=bs.filter(b=>b.alive&&b.owner!==shooter.owner&&hypot(b.x-actor.x,b.y-actor.y)<62).length*16;
 if(!world.preparation&&shooter.ability==='iron')score+=bs.filter(b=>b.alive&&b.owner===shooter.owner&&hypot(b.x-actor.x,b.y-actor.y)<186).length*8;
 if(!world.preparation&&shooter.ability==='split')score+=bs.filter(b=>b.alive&&b.owner!==shooter.owner&&hypot(b.x-actor.x,b.y-actor.y)<82).length*18;
 const movement=hypot(actor.x-shooter.x,actor.y-shooter.y);
 score+=Math.min(movement,250)*.018;
 return score;
}
// End-of-turn state serialization for online matches. All subsequent physics
// runs from an authoritative snapshot. Never store transient trails or wall bodies.
function packWorld(world){
 const bKeys=['id','text','word','owner','merged','ability','x','y','vx','vy','angle','omega','mass','invM','invI','w','h','radius','scale','growthStacks','lastGrowthTime','shotDir','parts','burstAge','burstStage','homingLeft','burstFired','shockArmed','vortexArmed','vortexTriggered','strikeSpent','strikeFirstEnemyId','splitTier','attackFactor','splitLockUntil','splitQueued','awakened','awakenAt','alive','shotAt','isLaunched','vortexHitEnemy','wallBoostAt','reflectAt','magnetArmed','magnetTriggered','jump'];
 return {
  time:world.time,preparation:world.preparation,prepTurns:world.prepTurns,shotSerial:world.shotSerial,splitUsedShot:world.splitUsedShot,
  gateX:world.gateX,gateY:world.gateY,suddenDeath:world.suddenDeath,suddenTurns:world.suddenTurns,cornerKnockout:!!world.cornerKnockout,
  shooterId:world.shooterId,lastShooterOwner:world.lastShooterOwner,shotTime:world.shotTime,
  awakenedOwners:[...world.awakenedOwners],fields:world.fields.map(f=>({...f})),
  magnets:world.magnets.map(m=>({...m,center:{...m.center},targets:[...m.targets]})),
  vortices:world.vortices.map(v=>({...v,center:{...v.center},targets:v.targets.map(t=>({...t}))})),
  shocks:world.shocks.map(w=>({...w,jumpDir:{...w.jumpDir},hit:[...w.hit],pending:w.pending.map(p=>({...p}))})),
  bodies:world.bodies.filter(b=>b.alive).map(b=>{
   const obj={};for(const k of bKeys)if(b[k]!==undefined)obj[k]=b[k];return obj;
  })
 };
}
function unpackWorld(snapshot){
 if(!snapshot||!Array.isArray(snapshot.bodies)||snapshot.bodies.length>72)throw Error('盤面データが不正です');
 const w=newWorld();
 for(const key of ['time','preparation','prepTurns','shotSerial','splitUsedShot','gateX','gateY','suddenDeath','suddenTurns','cornerKnockout','shooterId','lastShooterOwner','shotTime']){
  if(snapshot[key]!==undefined)w[key]=snapshot[key];
 }
 w.awakenedOwners=new Set(snapshot.awakenedOwners||[]);
 w.fields=(snapshot.fields||[]).map(f=>({...f}));
 w.bodies=snapshot.bodies.map(raw=>{
  if(!raw.alive||!WORDS[raw.word]||![0,1].includes(raw.owner)||!Number.isFinite(raw.x)||!Number.isFinite(raw.y)||!Number.isFinite(raw.id))throw Error('コマの状態が不正です');
  const b=body({x:raw.x,y:raw.y,text:raw.text,word:raw.word,owner:raw.owner,merged:raw.merged,angle:raw.angle});
  Object.assign(b,raw);
  const shape=shapeFor(b.text),scale=b.scale||1;
  // Cross-device font rasterization is not deterministic. Use the SHOOTER's
  // geometry saved with the authoritative world instead of reconstructing
  // the collision shape from the receiver's local system font.
  const goodParts=Array.isArray(raw.parts)&&raw.parts.length>0&&raw.parts.length<=12
   &&raw.parts.every(p=>p&&['x','y','w','h'].every(k=>Number.isFinite(p[k]))&&p.w>0&&p.h>0&&p.w<500&&p.h<500);
  b.parts=goodParts?raw.parts.map(part=>Array.isArray(part.polygon)?{...part,polygon:part.polygon.map(pt=>({...pt}))}:{...part})
   :shape.parts.map(part=>({x:part.x*scale,y:part.y*scale,w:part.w*scale,h:part.h*scale}));
  b.trail=[];b.trailTime=0;b.flash=0;b.merging=false;
  // Preserve the exact in-flight jump trajectory used by the authoritative client.
  b.jump=raw.jump||null;
  return b;
 });
 // Reset to the canonical next ID; practice sessions on one device must not
 // change future online merge/split IDs on that device.
 idSeq=Math.max(1,...w.bodies.map(b=>b.id+1));
 w.walls=w.cornerKnockout?streakWalls():walls(w.gateX,w.gateY,w.preparation);
 // These visual/physics phases must be reconstructed from the shooter's frame;
 // otherwise vortex/shock/jump animation disappears on other devices.
 w.shocks=(Array.isArray(snapshot.shocks)&&snapshot.shocks.length<=8?snapshot.shocks:[])
  .filter(s=>s&&Number.isFinite(s.x)&&Number.isFinite(s.y)&&Number.isFinite(s.age)&&Number.isFinite(s.radius))
  .map(s=>({...s,hit:new Set(s.hit||[]),pending:(s.pending||[]).map(p=>({...p}))}));
 w.vortices=(Array.isArray(snapshot.vortices)&&snapshot.vortices.length<=8?snapshot.vortices:[])
  .filter(v=>v&&Number.isFinite(v.center?.x)&&Number.isFinite(v.center?.y)&&Number.isFinite(v.age)&&Number.isFinite(v.range))
  .map(v=>({...v,center:{...v.center},targets:(v.targets||[]).map(t=>({...t}))}));
 w.magnets=(Array.isArray(snapshot.magnets)&&snapshot.magnets.length<=4?snapshot.magnets:[])
  .filter(m=>m&&Number.isFinite(m.age)&&Number.isFinite(m.duration)&&Number.isFinite(m.center?.x)&&Number.isFinite(m.center?.y)&&Array.isArray(m.targets)&&m.targets.length<=72)
  .map(m=>({...m,center:{...m.center},targets:[...m.targets]}));
 return w;
}
global.KanjiPhysics={packWorld,unpackWorld,W,H,WORDS,PIECE_UNIT,FULL_SHOT_SPEED,NORMAL_FULL_IMPULSE,shockFullImpulse,attackMultiplier,SHOCK_JUMP_PIECES,SHOCK_RADIUS_PIECES,SHOCK_JUMP_SECONDS,shockJumpPieces,shockLanding,VORTEX_RADIUS_PIECES,SPLIT_SCALES,splitPiece,ABILITY_RULES,body,newWorld,spawnInitial,step,fire,settle,remaining,allStopped,createMerged,triggerShock,awakenPiece,shapeFor,manifold,evaluateShot,finishTurn,openArena,sealPracticeArena,setStreakArena,expandGates,CORNER_SIZE,STREAK_CORNER_SIZE,inStreakCornerOut,streakWalls,defenseFactor,fieldPosition,growGiant,startVortex,startMagnet,MAGNET_RANGE,MAGNET_DURATION,RICOCHET_BOOST,REFLECT_MULTIPLIER,clamp};
})(window);

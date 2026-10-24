/* 漢字おはじき Ver.1.5: dependency-free 2D compound-SAT impulse solver.
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
const SHOCK_JUMP_PIECES=2, SHOCK_RADIUS_PIECES=1;
const SHOCK_JUMP_SECONDS=.5;
const ABILITY_RULES=[
 {word:'暴走',kind:'追いかける',timing:'止まったあと、いちばん近い相手へ走ります。ぶつかると普通の攻撃です。',numbers:'追いかけ：1秒／攻撃：1倍'},
 {word:'衝撃',kind:'吹き飛ばす',timing:'2コマ先へ飛び、着地すると円の中の味方も相手も外側へ飛びます。',numbers:'着地：0.5秒後／円の広さ：半径1コマ／全員に100％の攻撃1回分'},
 {word:'鉄壁',kind:'守る',timing:'ぶつかる攻撃には強い！ でも衝撃と渦巻では普通に動きます。',numbers:'自分が受ける攻撃：0.6倍／青・赤の円にいる味方：0.7倍／円の広さ：半径3コマ'},
 {word:'渦巻',kind:'ぐるぐる回す',timing:'相手に当てて止まると、周りの味方も相手もぐるぐる回ります。',numbers:'時間：1秒／2周／届く広さ：約1.9コマ'},
 {word:'巨大',kind:'大きくなる',timing:'相手に当てるたび大きく、強くなります。最後まで元に戻りません。',numbers:'1回ごと：大きさ1.2倍・攻撃1.1倍／3回まで'},
 {word:'一撃',kind:'超強力な攻撃',timing:'相手にぶつけると大きく吹き飛ばせます。漢字の角ならもっと強力！',numbers:'普通に当てる：3倍／角で当てる：合計5倍'}
];
const WORDS={"暴走":{label:'暴走',ability:'burst'},"衝撃":{label:'衝撃',ability:'shock'},"鉄壁":{label:'鉄壁',ability:'iron'},"渦巻":{label:'渦巻',ability:'vortex'},"巨大":{label:'巨大',ability:'giant'},"一撃":{label:'一撃',ability:'strike'}};
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
 return {id:idSeq++,text,word,owner,merged,ability,x,y,vx,vy,angle,omega,mass,invM:1/mass,invI:1/inertia,w:s.w,h:s.h,parts:s.parts,radius:hypot(s.w,s.h)*.58+6,scale:1,growthStacks:0,lastGrowthTime:-100,shotDir:{x:1,y:0},burstAge:null,burstStage:null,homingLeft:0,burstFired:false,shockArmed:false,vortexArmed:false,vortexTriggered:false,awakened:false,awakenAt:-1,alive:true,merging:false,trail:[],trailTime:0,shotAt:-100,flash:0,jump:null,vortexHitEnemy:false};
}
function staticRect(x,y,w,h){return {id:'wall',owner:-1,x,y,angle:0,vx:0,vy:0,omega:0,invM:0,invI:0,mass:Infinity,parts:[{x:0,y:0,w,h}],radius:hypot(w,h)/2,alive:true,static:true};}
function walls(gx=184,gy=165,preparation=false){
 if(preparation)return [
  staticRect(W/2,-10,W+28,28),staticRect(W/2,H+10,W+28,28),
  staticRect(-10,H/2,28,H+28),staticRect(W+10,H/2,28,H+28),
  // The two-turn preparation phase has an impenetrable midcourt barrier.
  staticRect(W/2,H/2,W+28,20)
 ];
 const spanX=(W-gx)/2,spanY=(H-gy)/2;
 return [
  staticRect(spanX/2,-10,spanX,28),staticRect(W-spanX/2,-10,spanX,28),
  staticRect(spanX/2,H+10,spanX,28),staticRect(W-spanX/2,H+10,spanX,28),
  staticRect(-10,spanY/2,28,spanY),staticRect(-10,H-spanY/2,28,spanY),
  staticRect(W+10,spanY/2,28,spanY),staticRect(W+10,H-spanY/2,28,spanY)
 ];
}
function openArena(world){world.preparation=false;world.walls=walls(world.gateX,world.gateY,false);world.fields.length=0}
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
 const wx=part.w/2,hy=part.h/2;
 return [{x:cx-wx*co+hy*si,y:cy-wx*si-hy*co},{x:cx+wx*co+hy*si,y:cy+wx*si-hy*co},
 {x:cx+wx*co-hy*si,y:cy+wx*si+hy*co},{x:cx-wx*co-hy*si,y:cy-wx*si+hy*co}];
}
function project(vertices,n){let lo=Infinity,hi=-Infinity;for(const v of vertices){const p=v.x*n.x+v.y*n.y;lo=Math.min(lo,p);hi=Math.max(hi,p)}return [lo,hi]}
function partSAT(a,b,va,vb){let overlap=Infinity,norm=null;
 for(const verts of [va,vb])for(let i=0;i<4;i++){
  const p=verts[i],q=verts[(i+1)%4],vx=q.x-p.x,vy=q.y-p.y,len=hypot(vx,vy)||1,n={x:-vy/len,y:vx/len};
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
 if(!isEnemy||!attacker||attacker.static||world.preparation||attacker.id!==world.shooterId)return corner?1.2:1;
 if(attacker.ability==='strike')return corner?5:3;
 const giant=attacker.ability==='giant'?Math.pow(1.1,Math.min(3,attacker.growthStacks+1)):1;
 return (corner?1.2:1)*giant;
}
function resolve(world,a,b,m,step,onImpact,attacker){
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
 const corner= !!(isEnemy&&attacker&&contactSpeed>165&&isCorner(attacker,p));
 const restitution=(a.static||b.static)?0.64:0.73;
 // Exact total hit strength: a launched '一撃' deals 3x, or 5x on a corner hit.
 // It must NOT multiply 3x by the universal 1.2x critical bonus.
 const skill=attackMultiplier(world,attacker,isEnemy,corner);
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
 if(onImpact&&(contactSpeed>80||(attacker?.shockArmed&&attacker.id===world.shooterId)))onImpact({a,b,p,n,speed:contactSpeed,corner,impulse:impact,skill,step});
}
function stepOnce(world,dt,hooks={}){
 const bodies=world.bodies,staticWalls=world.walls;world.time+=dt;
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
  // The vortex pulls in ANY nearby tiles, including allies, when its ring touches them.
  for(const v of world.vortices){
   if(b.id===v.sourceId)continue;
   let t=v.targets.find(t=>t.id===b.id);
   if(!t&&hypot(b.x-v.center.x,b.y-v.center.y)<=v.range){
    t={id:b.id,angle:Math.atan2(b.y-v.center.y,b.x-v.center.x)-4*Math.PI*v.age/v.duration,
      radius:Math.max(18,hypot(b.x-v.center.x,b.y-v.center.y)-v.expand*v.age/v.duration)};
    v.targets.push(t);
   }
   if(!t)continue;
   const phase=clamp(v.age/v.duration,0,1),ang=t.angle+2*Math.PI*2*phase;
   const radius=t.radius+v.expand*phase;
   const cx=v.center.x,cy=v.center.y;
   const px=cx+Math.cos(ang)*radius,py=cy+Math.sin(ang)*radius;
   const w=4*Math.PI/v.duration,vr=v.expand/v.duration;
   const vx=vr*Math.cos(ang)-radius*w*Math.sin(ang),vy=vr*Math.sin(ang)+radius*w*Math.cos(ang);
   // Vortex is an ability, NOT a physical attack. Iron cannot reduce its effect.
   const bias=0.55;
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
 const merges=[];
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
    resolve(world,a,b,m,world.time,pass===0?hooks.impact:null,attacker);
   }
  }
  for(const a of bodies){if(!a.alive||a.merging||a.jump)continue;
   for(const wall of staticWalls){
    if(Math.abs(a.x-wall.x)>a.radius+wall.parts[0].w/2||Math.abs(a.y-wall.y)>a.radius+wall.parts[0].h/2)continue;
    const m=manifold(a,wall);
    if(m)resolve(world,a,wall,m,world.time,pass===0?hooks.impact:null,a.id===world.shooterId?a:null);
   }
  }
 }
 for(const [a,b] of merges){if(a.alive&&b.alive)hooks.merge?.(a,b)}
 // A piece exits only after its center has crossed outside one of four wall gaps.
 for(const b of bodies){if(!b.alive||b.merging)continue;
   const out=(b.x < -b.w*.4 || b.x>W+b.w*.4 || b.y< -b.h*.4 || b.y>H+b.h*.4);
   if(out&&!world.preparation){b.alive=false;hooks.out?.(b)}
 }
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
 const subdivisions=Math.min(5,Math.max(1,Math.ceil(fastest*dt/16)));
 for(let i=0;i<subdivisions;i++)stepOnce(world,dt/subdivisions,hooks);
 return world;
}
function newWorld(){return {w:W,h:H,time:0,bodies:[],preparation:true,prepTurns:0,
 gateX:184,gateY:165,suddenDeath:false,suddenTurns:0,walls:walls(184,165,true),
 shocks:[],vortices:[],fields:[],awakenedOwners:new Set(),shooterId:null,lastShooterOwner:0,shotTime:0};}
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
function retargetVortices(world,retiredIds,replacement){
 // Preserve swirling enemies when they transform via awakening or fusion mid-animation.
 for(const vortex of world.vortices){
  const old=vortex.targets.find(t=>retiredIds.includes(t.id));if(!old)continue;
  vortex.targets=vortex.targets.filter(t=>!retiredIds.includes(t.id));
  if(!vortex.targets.some(t=>t.id===replacement.id)&&replacement.id!==vortex.sourceId){
   vortex.targets.push({id:replacement.id,
    angle:Math.atan2(replacement.y-vortex.center.y,replacement.x-vortex.center.x)-4*Math.PI*vortex.age/vortex.duration,
    radius:Math.max(22,hypot(replacement.x-vortex.center.x,replacement.y-vortex.center.y)-vortex.expand*vortex.age/vortex.duration)});
  }
 }
}
function startVortex(world,b){
 if(world.preparation||!b||!b.alive||b.ability!=='vortex'||!b.vortexArmed||!b.vortexHitEnemy||b.vortexTriggered)return null;
 b.vortexArmed=false;b.vortexTriggered=true;
 const range=235/2;
 const targets=world.bodies.filter(p=>p.alive&&p.id!==b.id&&hypot(p.x-b.x,p.y-b.y)<=range)
 .map(p=>({id:p.id,angle:Math.atan2(p.y-b.y,p.x-b.x),radius:Math.max(18,hypot(p.x-b.x,p.y-b.y))}));
 const v={sourceId:b.id,owner:b.owner,center:{x:b.x,y:b.y},age:0,duration:1.0,expand:46,range,targets};
 world.vortices.push(v);return v;
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
 b.jump=null;
 if(b.shockArmed){
  const from={x:b.x,y:b.y},to={x:clamp(b.x+b.shotDir.x*PIECE_UNIT*SHOCK_JUMP_PIECES,b.w*.65,W-b.w*.65),
   y:clamp(b.y+b.shotDir.y*PIECE_UNIT*SHOCK_JUMP_PIECES,b.h*.65,H-b.h*.65)};
  b.vx=0;b.vy=0;
  b.jump={from,to,age:0,duration:SHOCK_JUMP_SECONDS};
 }

 world.shooterId=b.id;world.lastShooterOwner=b.owner;world.shotTime=world.time;
 return speed;
}
function settle(world){for(const b of world.bodies){b.vx=0;b.vy=0;b.omega=0;b.isLaunched=false;b.burstAge=null;b.burstStage=null;b.homingLeft=0;b.shockArmed=false;b.vortexArmed=false;b.vortexHitEnemy=false;b.jump=null;b.trail=[]}world.shocks.length=0;world.vortices.length=0;}
function allStopped(world){return !world.shocks.length&&!world.vortices.length&&!world.bodies.some(b=>b.alive&&(b.burstStage==='coast'||b.burstStage==='homing'||b.jump))&&world.bodies.filter(b=>b.alive&&!b.merging).every(b=>hypot(b.vx,b.vy)<10&&Math.abs(b.omega)<.17)}
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
 // CPU predictor mirrors the two-piece shock landing and its one-piece-radius skill.
 // This is an inexpensive planning approximation; the real move still uses the SAT engine.
 if(!world.preparation&&shooter.ability==='shock'){
  actor.x=clamp(actor.x+dir.x/len*PIECE_UNIT*SHOCK_JUMP_PIECES,shooter.w*.65,W-shooter.w*.65);
  actor.y=clamp(actor.y+dir.y/len*PIECE_UNIT*SHOCK_JUMP_PIECES,shooter.h*.65,H-shooter.h*.65);
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
   if(b.x-b.r<0&&(world.preparation||!(Math.abs(b.y-H/2)<world.gateY/2))&&b.vx<0){b.x=b.r;b.vx=Math.abs(b.vx)*.65}
   if(b.x+b.r>W&&(world.preparation||!(Math.abs(b.y-H/2)<world.gateY/2))&&b.vx>0){b.x=W-b.r;b.vx=-Math.abs(b.vx)*.65}
   if(b.y-b.r<0&&(world.preparation||!(Math.abs(b.x-W/2)<world.gateX/2))&&b.vy<0){b.y=b.r;b.vy=Math.abs(b.vy)*.65}
   if(b.y+b.r>H&&(world.preparation||!(Math.abs(b.x-W/2)<world.gateX/2))&&b.vy>0){b.y=H-b.r;b.vy=-Math.abs(b.vy)*.65}
   if(world.preparation){
    const crossLine=b.owner===0?b.y-b.r<H/2+11:b.y+b.r>H/2-11;
    if(crossLine){b.y=b.owner===0?H/2+11+b.r:H/2-11-b.r;b.vy*=-.65;}
   }else if(b.x<-b.r||b.x>W+b.r||b.y<-b.r||b.y>H+b.r)b.alive=false;
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
  if(b.owner!==shooter.owner){let goal=Math.min(hypot(b.x-W/2,b.y),hypot(b.x-W/2,H-b.y),hypot(b.x,b.y-H/2),hypot(W-b.x,b.y-H/2));score+=(200-goal)*.025;
  }
 }
 const enemy=1-shooter.owner;
 score+=(n0[enemy]-after[enemy])*225-(n0[shooter.owner]-after[shooter.owner])*225;
 score+=doneMerges*(world.preparation?110:26);
 if(!world.preparation&&shooter.ability==='vortex')score+=bs.filter(b=>b.alive&&b.owner!==shooter.owner&&hypot(b.x-actor.x,b.y-actor.y)<117.5).length*18;
 if(!world.preparation&&shooter.ability==='shock')score+=bs.filter(b=>b.alive&&b.owner!==shooter.owner&&hypot(b.x-actor.x,b.y-actor.y)<62).length*16;
 if(!world.preparation&&shooter.ability==='iron')score+=bs.filter(b=>b.alive&&b.owner===shooter.owner&&hypot(b.x-actor.x,b.y-actor.y)<186).length*8;
 const movement=hypot(actor.x-shooter.x,actor.y-shooter.y);
 score+=Math.min(movement,250)*.018;
 return score;
}
global.KanjiPhysics={W,H,WORDS,PIECE_UNIT,FULL_SHOT_SPEED,NORMAL_FULL_IMPULSE,shockFullImpulse,attackMultiplier,SHOCK_JUMP_PIECES,SHOCK_RADIUS_PIECES,SHOCK_JUMP_SECONDS,ABILITY_RULES,body,newWorld,spawnInitial,step,fire,settle,remaining,allStopped,createMerged,triggerShock,awakenPiece,shapeFor,manifold,evaluateShot,finishTurn,openArena,expandGates,defenseFactor,fieldPosition,growGiant,startVortex,clamp};
})(window);

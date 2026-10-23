/* 漢字おはじき：dependency-free 2D compound-SAT impulse solver.
   World units: board coordinates 540 x 760. Time: seconds. Clockwise rotation is positive.
   Runs physics at a fixed 1/120 second timestep in game.js, render separately.
*/
(function(global){'use strict';
const W=540,H=760,EPS=1e-8;
const WORDS={"暴走":{label:'暴走',ability:'burst'},"衝撃":{label:'衝撃',ability:'shock'},"鉄壁":{label:'鉄壁',ability:'iron'}};
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
 const mass=merged?(ability==='iron'?2.65:2.1):1;
 const inertia=mass*(s.w*s.w+s.h*s.h)/12;
 return {id:idSeq++,text,word,owner,merged,ability,x,y,vx,vy,angle,omega,mass,invM:1/mass,invI:1/inertia,w:s.w,h:s.h,parts:s.parts,radius:hypot(s.w,s.h)*.58+6,burstAge:null,burstFired:false,alive:true,merging:false,trail:[],trailTime:0,shotAt:-100,flash:0};
}
function staticRect(x,y,w,h){return {id:'wall',owner:-1,x,y,angle:0,vx:0,vy:0,omega:0,invM:0,invI:0,mass:Infinity,parts:[{x:0,y:0,w,h}],radius:hypot(w,h)/2,alive:true,static:true};}
function walls(){const t=22,gx=184,gy=165;return [
 staticRect((W-gx)/4,-10,(W-gx)/2,28),staticRect(W-(W-gx)/4,-10,(W-gx)/2,28),
 staticRect((W-gx)/4,H+10,(W-gx)/2,28),staticRect(W-(W-gx)/4,H+10,(W-gx)/2,28),
 staticRect(-10,(H-gy)/4,28,(H-gy)/2),staticRect(-10,H-(H-gy)/4,28,(H-gy)/2),
 staticRect(W+10,(H-gy)/4,28,(H-gy)/2),staticRect(W+10,H-(H-gy)/4,28,(H-gy)/2)
 ];}
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
function applyImpulse(b,ix,iy,r,sign=1){if(b.static)return;
 b.vx+=ix*b.invM*sign;b.vy+=iy*b.invM*sign;
 b.omega+=cross(r,{x:ix,y:iy})*b.invI*sign;
}
function isCorner(attacker,point){
 const dx=point.x-attacker.x,dy=point.y-attacker.y,c=Math.cos(attacker.angle),s=Math.sin(attacker.angle);
 const lx=dx*c+dy*s,ly=-dx*s+dy*c;
 return Math.abs(lx) > attacker.w*.32 && Math.abs(ly) > attacker.h*.30;
}
function resolve(a,b,m,step,onImpact,attacker){
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
 const impact=Math.min(3500,(-(1+restitution)*vn/denom)*(corner?1.2:1));
 const imp={x:n.x*impact,y:n.y*impact};
 applyImpulse(a,imp.x,imp.y,rA,-1);applyImpulse(b,imp.x,imp.y,rB,1);
 // Tangential impulse transfers spin into physically grounded sideways ricochets.
 const newA={x:a.vx-a.omega*rA.y,y:a.vy+a.omega*rA.x},newB={x:b.vx-b.omega*rB.y,y:b.vy+b.omega*rB.x};
 const tangent=vsub(newB,newA);let proj=dot(tangent,n);tangent.x-=proj*n.x;tangent.y-=proj*n.y;
 const tlen=hypot(tangent.x,tangent.y);
 if(tlen>EPS){tangent.x/=tlen;tangent.y/=tlen;
  const ta=cross(rA,tangent),tb=cross(rB,tangent),tden=inv+ta*ta*a.invI+tb*tb*b.invI;
  if(tden>EPS){const slip=dot(vsub(newB,newA),tangent);const jt=clamp(-slip/tden,-impact*.26,impact*.26);
   applyImpulse(a,tangent.x*jt,tangent.y*jt,rA,-1);applyImpulse(b,tangent.x*jt,tangent.y*jt,rB,1)}
 }
 // Iron absorbs some of the velocity transferred by the opponent.
 if(!a.static&&a.ability==='iron'&&attacker!==a&&!a.isLaunched){a.vx*=.87;a.vy*=.87}
 if(!b.static&&b.ability==='iron'&&attacker!==b&&!b.isLaunched){b.vx*=.87;b.vy*=.87}
 if(onImpact&&contactSpeed>80)onImpact({a,b,p,n,speed:contactSpeed,corner,impulse:impact,step});
}
function step(world,dt,hooks={}){
 const bodies=world.bodies,staticWalls=world.walls;world.time+=dt;
 for(const b of bodies){if(!b.alive||b.merging)continue;
  if(b.burstAge!==null){b.burstAge+=dt;if(b.ability==='burst'&&b.burstAge>=1&&b.burstAge<3){
    const speed=hypot(b.vx,b.vy);
    if(speed>8){const thrust=660;b.vx+=b.vx/speed*thrust*dt;b.vy+=b.vy/speed*thrust*dt;}
    if(!b.burstFired){b.burstFired=true;hooks.ability?.(b,'burst')}
   }}
  let speed=hypot(b.vx,b.vy);
  if(speed>15&&Math.abs(b.omega)>.1){const lift=b.omega*.025;b.vx+=-b.vy*lift*dt;b.vy+=(b.vx)*lift*dt;}
  const drag=b.ability==='iron'?2.60:2.0;
  const damping=Math.exp(-drag*dt);b.vx*=damping;b.vy*=damping;
  b.omega*=Math.exp(-2.9*dt);
  speed=hypot(b.vx,b.vy);if(speed>1390){b.vx*=1390/speed;b.vy*=1390/speed}
  if(speed<3.5){b.vx=0;b.vy=0}
  if(Math.abs(b.omega)<.05)b.omega=0;
  b.x+=b.vx*dt;b.y+=b.vy*dt;b.angle+=b.omega*dt;
  if(b.angle>Math.PI*2)b.angle-=Math.PI*2;if(b.angle< -Math.PI*2)b.angle+=Math.PI*2;
  b.flash=Math.max(0,b.flash-dt*3);
 }
 // Repulsive field affects enemies, not the owner; no contact required.
 for(const b of bodies){if(!b.alive||b.merging||b.ability!=='shock'||hypot(b.vx,b.vy)<45)continue;
  for(const other of bodies){if(other===b||!other.alive||other.merging||other.owner===b.owner)continue;
   const dx=other.x-b.x,dy=other.y-b.y,dist=hypot(dx,dy)||1,r=126;
   if(dist<r){const s=(1-dist/r),force=s*s*2500*dt;
    other.vx+=dx/dist*force/other.mass;other.vy+=dy/dist*force/other.mass;
    b.vx-=dx/dist*force*.12/b.mass;b.vy-=dy/dist*force*.12/b.mass;
    if(world.time-(b.lastFieldFX||0)>.11){b.lastFieldFX=world.time;hooks.field?.(b,other)}
   }
  }
 }
 const merges=[];
 for(let pass=0;pass<2;pass++){
  for(let i=0;i<bodies.length;i++){
   const a=bodies[i];if(!a.alive||a.merging)continue;
   for(let j=i+1;j<bodies.length;j++){
    const b=bodies[j];if(!b.alive||b.merging)continue;
    const m=manifold(a,b);if(!m)continue;
    const rel=hypot(a.vx-b.vx,a.vy-b.vy);
    if(!a.merged&&!b.merged&&a.word===b.word&&a.text!==b.text&&rel>=55){
      a.merging=b.merging=true;merges.push([a,b]);break;
    }
    const attacker=a.id===world.shooterId?a:b.id===world.shooterId?b:null;
    resolve(a,b,m,world.time,pass===0?hooks.impact:null,attacker);
   }
  }
  for(const a of bodies){if(!a.alive||a.merging)continue;
   for(const wall of staticWalls){
    if(Math.abs(a.x-wall.x)>a.radius+wall.parts[0].w/2||Math.abs(a.y-wall.y)>a.radius+wall.parts[0].h/2)continue;
    const m=manifold(a,wall);
    if(m)resolve(a,wall,m,world.time,pass===0?hooks.impact:null,a.id===world.shooterId?a:null);
   }
  }
 }
 for(const [a,b] of merges){if(a.alive&&b.alive)hooks.merge?.(a,b)}
 // A piece exits only after its center has crossed outside one of four wall gaps.
 for(const b of bodies){if(!b.alive||b.merging)continue;
   const out=(b.x < -b.w*.4 || b.x>W+b.w*.4 || b.y< -b.h*.4 || b.y>H+b.h*.4);
   if(out){b.alive=false;hooks.out?.(b)}
 }
 return world;
}
function newWorld(){return {w:W,h:H,time:0,bodies:[],walls:walls(),shooterId:null,lastShooterOwner:0,shotTime:0};}
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
function fire(world,b,dx,dy,power,spin){
 const len=hypot(dx,dy)||1,amount=clamp(power,0,1);
 let speed=230+875*Math.pow(amount,1.12);
 if(b.ability==='iron')speed*=.8;
 b.vx=dx/len*speed;b.vy=dy/len*speed;b.omega=spin*(2.5+5.0*amount);
 b.isLaunched=true;b.shotAt=world.time;b.burstAge=b.ability==='burst'?0:null;b.burstFired=false;
 world.shooterId=b.id;world.lastShooterOwner=b.owner;world.shotTime=world.time;
 return speed;
}
function settle(world){for(const b of world.bodies){b.vx=0;b.vy=0;b.omega=0;b.isLaunched=false;b.burstAge=null;b.trail=[]}}
function allStopped(world){return world.bodies.filter(b=>b.alive&&!b.merging).every(b=>hypot(b.vx,b.vy)<10&&Math.abs(b.omega)<.17)}
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
 world.bodies.push(newB);return newB;
}
function remaining(world,owner){return world.bodies.filter(b=>b.alive&&b.owner===owner).length}
// Simplified 2-second disk physics predictor; only CPU planning uses this, never real collisions.
function evaluateShot(world, shooter,dir,power,spin){
 const bs=world.bodies.filter(b=>b.alive).map(b=>({x:b.x,y:b.y,vx:0,vy:0,m:b.mass,r:b.merged?42:29,owner:b.owner,text:b.text,word:b.word,merged:b.merged,alive:true,src:b.id===shooter.id,spin:0}));
 const actor=bs.find(b=>b.src);if(!actor)return -Infinity;
 let speed=(230+875*Math.pow(power,1.12))*(shooter.ability==='iron'?.8:1),len=hypot(dir.x,dir.y)||1;
 actor.vx=dir.x/len*speed;actor.vy=dir.y/len*speed;
 const n0=[remaining(world,0),remaining(world,1)],merges=0;
 let t=0,doneMerges=0;
 for(let stepN=0;stepN<95;stepN++){
  const dt=1/55;t+=dt;
  for(const b of bs){if(!b.alive)continue;
   if(shooter.ability==='burst'&&b.src&&t>1&&t<3){const sp=hypot(b.vx,b.vy)||1;b.vx+=b.vx/sp*660*dt;b.vy+=b.vy/sp*660*dt;}
   if(b.src){const s=spin*.025;b.vx+=-b.vy*s*dt;b.vy+=b.vx*s*dt;}
   b.vx*=Math.exp(-2*dt);b.vy*=Math.exp(-2*dt);b.x+=b.vx*dt;b.y+=b.vy*dt;
   if(b.x-b.r<0&&!(Math.abs(b.y-H/2)<82)&&b.vx<0){b.x=b.r;b.vx=Math.abs(b.vx)*.65}
   if(b.x+b.r>W&&!(Math.abs(b.y-H/2)<82)&&b.vx>0){b.x=W-b.r;b.vx=-Math.abs(b.vx)*.65}
   if(b.y-b.r<0&&!(Math.abs(b.x-W/2)<92)&&b.vy<0){b.y=b.r;b.vy=Math.abs(b.vy)*.65}
   if(b.y+b.r>H&&!(Math.abs(b.x-W/2)<92)&&b.vy>0){b.y=H-b.r;b.vy=-Math.abs(b.vy)*.65}
   if(b.x<-b.r||b.x>W+b.r||b.y<-b.r||b.y>H+b.r)b.alive=false;
  }
  for(let i=0;i<bs.length;i++)for(let j=i+1;j<bs.length;j++){
   const a=bs[i],b=bs[j];if(!a.alive||!b.alive)continue;
   const dx=b.x-a.x,dy=b.y-a.y,d=hypot(dx,dy)||1;if(d>a.r+b.r)continue;
   const nx=dx/d,ny=dy/d,overlap=a.r+b.r-d;
   a.x-=nx*overlap*.5;b.x+=nx*overlap*.5;a.y-=ny*overlap*.5;b.y+=ny*overlap*.5;
   const rv=(b.vx-a.vx)*nx+(b.vy-a.vy)*ny;if(rv<0){const impulse=-(1+.7)*rv/(1/a.m+1/b.m);
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
 score+=doneMerges*26;
 const movement=hypot(actor.x-shooter.x,actor.y-shooter.y);
 score+=Math.min(movement,250)*.018;
 return score;
}
global.KanjiPhysics={W,H,WORDS,body,newWorld,spawnInitial,step,fire,settle,remaining,allStopped,createMerged,shapeFor,manifold,evaluateShot,clamp};
})(window);

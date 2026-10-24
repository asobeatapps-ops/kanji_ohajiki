/* Local practice ONLY: never sends moves to Firebase and never affects match state. */
(function(){'use strict';
const P=window.KanjiPhysics,c=document.getElementById('practiceBoard');if(!P||!c)return;
const cx=c.getContext('2d'),$=id=>document.getElementById(id);
const WORLD_H=760,TAU=Math.PI*2;
let world=null,primary=null,selected=null,drag=null,playing=false,shot=false,last=0,acc=0,elapsed=0,settled=0,animation=0;
let word='暴走';
function initial(){
 word=$('practiceWord').value;
 world=P.newWorld();P.openArena(world);world.bodies=[];
 primary=P.body({x:170,y:590,text:word,word,owner:0,merged:true});
 const e1=P.body({x:325,y:290,text:'走',word:'暴走',owner:1}),e2=P.body({x:385,y:420,text:'壁',word:'鉄壁',owner:1});
 world.bodies.push(primary,e1,e2);selected=primary;drag=null;shot=false;elapsed=0;settled=0;acc=0;
 $('practiceTip').textContent='青い「'+word+'」をタップ → 好きな場所から逆方向へ引っ張る';
}
function point(e){const r=c.getBoundingClientRect();return{x:(e.clientX-r.left)*540/r.width,y:(e.clientY-r.top)*WORLD_H/r.height}}
function down(e){if(!playing||!world||shot)return;if(e.button!==undefined&&e.button!==0)return;
 const p=point(e);
 if(Math.hypot(p.x-primary.x,p.y-primary.y)<85){selected=primary;return}
 if(!selected)return;
 drag={id:e.pointerId,start:p,dx:0,dy:0,power:0};try{c.setPointerCapture(e.pointerId)}catch{}
 e.preventDefault();
}
function move(e){if(!drag||e.pointerId!==drag.id)return;const p=point(e);
 drag.dx=drag.start.x-p.x;drag.dy=drag.start.y-p.y;drag.power=Math.min(1,Math.hypot(drag.dx,drag.dy)/142);e.preventDefault();
}
function up(e){if(!drag||e.pointerId!==drag.id)return;move(e);const d=drag;drag=null;
 if(d.power<.06)return;
 P.fire(world,primary,d.dx,d.dy,d.power,1,1);
 shot=true;elapsed=0;settled=0;$('practiceTip').textContent='発射成功！ コマが止まったら「やり直す」で何度でも練習できます。';
}
function draw(){if(!world)return;
 cx.setTransform(c.width/540,0,0,c.height/WORLD_H,0,0);
 cx.fillStyle='#e7dac3';cx.fillRect(0,0,540,WORLD_H);
 cx.strokeStyle='#bbaa94';cx.lineWidth=4;cx.strokeRect(14,14,512,WORLD_H-28);
 cx.setLineDash([9,12]);cx.lineWidth=2;cx.strokeStyle='#aa8d756b';cx.beginPath();cx.moveTo(270,10);cx.lineTo(270,WORLD_H-10);cx.stroke();cx.setLineDash([]);
 cx.textAlign='center';cx.font='900 18px sans-serif';cx.fillStyle='#8e806d';cx.fillText('PRACTICE / 試し打ち',270,54);
 for(const b of world.bodies){if(!b.alive)continue;
  cx.save();cx.translate(b.x,b.y);cx.rotate(b.angle);cx.scale(b.scale||1,b.scale||1);
  cx.font=`1000 ${P.shapeFor(b.text).fontSize}px "Noto Sans CJK JP", "Hiragino Kaku Gothic ProN",sans-serif`;
  cx.textAlign='center';cx.textBaseline='middle';cx.lineJoin='round';cx.lineWidth=5;
  cx.strokeStyle=b.owner===0?'#acdafa':'#ffb6af';cx.strokeText(b.text,0,0);
  cx.fillStyle=b.owner===0?'#2c83bf':'#ce5955';cx.fillText(b.text,0,0);cx.restore();
 }
 if(drag&&selected){const len=Math.hypot(drag.dx,drag.dy);if(len>3){const x=selected.x,y=selected.y,dx=drag.dx/len,dy=drag.dy/len;
  cx.beginPath();cx.moveTo(x+dx*38,y+dy*38);cx.lineTo(x+dx*145,y+dy*145);cx.strokeStyle='#1d91cc';cx.lineWidth=7;cx.lineCap='round';cx.stroke();
  cx.beginPath();const x1=x+dx*160,y1=y+dy*160;cx.moveTo(x1,y1);cx.lineTo(x1-dx*25-dy*13,y1-dy*25+dx*13);cx.lineTo(x1-dx*25+dy*13,y1-dy*25-dx*13);cx.fillStyle='#1d91cc';cx.fill();
  if(selected.ability==='shock'){const landing=P.shockLanding(selected,dx,dy,drag.power);cx.beginPath();cx.arc(landing.x,landing.y,P.PIECE_UNIT,0,TAU);cx.strokeStyle='#28b5cb';cx.setLineDash([7,7]);cx.lineWidth=4;cx.stroke();cx.setLineDash([]);}
 }}
 for(const wave of world.shocks){cx.beginPath();cx.arc(wave.x,wave.y,wave.radius,0,TAU);cx.strokeStyle='#57cddd';cx.lineWidth=9;cx.stroke()}
}
function tick(now){animation=0;if(!playing)return;
 const dt=last?Math.min(.04,(now-last)/1000):.016;last=now;
 if(shot){elapsed+=dt;acc+=dt;let count=0;
  while(acc>=1/120&&count<6){P.step(world,1/120,{merge:(a,b)=>P.createMerged(world,a,b)});acc-=1/120;count++}
  if(count>=6)acc=0;
  if(elapsed>.4&&P.allStopped(world))settled+=dt;else settled=0;
  if(settled>.5||elapsed>12){P.settle(world);shot=false;selected=world.bodies.find(b=>b.alive&&b.owner===0)||null;
   $('practiceTip').textContent='コマが止まりました。再発射するか「やり直す」を押してください。';}
 }
 draw();animation=requestAnimationFrame(tick);
}
function start(){if(!world)initial();if(!playing){playing=true;last=0;animation=requestAnimationFrame(tick)}}
function stop(){playing=false;if(animation)cancelAnimationFrame(animation);animation=0;drag=null}
$('practiceWord').addEventListener('change',initial);
$('practiceReset').addEventListener('click',initial);
c.addEventListener('pointerdown',down);c.addEventListener('pointermove',move);c.addEventListener('pointerup',up);
c.addEventListener('pointercancel',()=>drag=null);
window.KanjiPractice={start,stop,reset:initial,get world(){return world}};
})();

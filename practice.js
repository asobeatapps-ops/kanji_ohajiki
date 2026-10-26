/* 漢字おはじき Ver.2.5 / 本番共通の描画・物理エンジンで行うオンライン待機練習。
   Firebase通信は一切行いません。常に青が先攻、CPUは自分で選んだ完成熟語コマ。
*/
(function(){'use strict';
const P=window.KanjiPhysics,canvas=document.getElementById('practiceBoard');if(!P||!canvas)return;
const $=id=>document.getElementById(id),R=window.KanjiRenderer;
const DT=1/120;
let world=null,player=null,cpu=null,drag=null,selected=null,phase='ready',turn=0,elapsed=0,acc=0,still=0,last=0,raf=0;
let playing=false,scheduledCPU=0,vortexResolved=false,magnetResolved=false,turnNumber=0;
const visual=R.createPracticeEffects(()=>world);
function message(text){$('practiceTip').textContent=text;}
function updateTurn(text,owner=0){const el=$('practiceTurn');el.textContent=text;el.classList.toggle('cpu',owner===1);}
function getPieces(){player=world.bodies.find(b=>b.alive&&b.owner===0)||null;cpu=world.bodies.find(b=>b.alive&&b.owner===1)||null;}
function reset(){
 if(scheduledCPU){clearTimeout(scheduledCPU);scheduledCPU=0}
 const word=$('practiceWord').value,other=$('practiceOpponentWord').value;
 world=P.newWorld();P.sealPracticeArena(world);
 player=P.body({x:270,y:580,text:word,word,owner:0,merged:true});
 cpu=P.body({x:270,y:170,text:other,word:other,owner:1,merged:true});
 world.bodies.push(player,cpu);
 drag=null;selected=null;visual.reset();phase='ready';turn=0;elapsed=0;acc=0;still=0;vortexResolved=false;magnetResolved=false;turnNumber=0;
 updateTurn('先攻：あなた');
 message('青「'+word+'」をタップして選択 → 好きな場所からドラッグで発射！');
 draw();
}
function coords(e){
 const rect=canvas.getBoundingClientRect(),css=getComputedStyle(canvas);
 const l=parseFloat(css.borderLeftWidth)||0,r=parseFloat(css.borderRightWidth)||0;
 const top=parseFloat(css.borderTopWidth)||0,bt=parseFloat(css.borderBottomWidth)||0;
 const w=Math.max(1,rect.width-l-r),h=Math.max(1,rect.height-top-bt);
 return {x:(e.clientX-rect.left-l)*P.W/w,y:(e.clientY-rect.top-top)*P.H/h};
}
function resizePractice(){const dpr=Math.max(1,Math.min(2,devicePixelRatio||1));const w=Math.round(P.W*dpr),h=Math.round(P.H*dpr);if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;draw()}}
window.addEventListener('resize',resizePractice);
window.visualViewport?.addEventListener('resize',resizePractice);

function shot(piece,dx,dy,power,spin,spinStrength=1){
 if(!piece||!piece.alive||!world||phase==='moving')return;
 P.fire(world,piece,dx,dy,power,spin,spinStrength);visual.shoot(piece);phase='moving';drag=null;selected=null;elapsed=0;acc=0;still=0;vortexResolved=false;magnetResolved=false;
 if(piece.owner===0){updateTurn('あなたの発射中');message('発射！ コマが止まるとCPUが1回打ち返します。');}
 else{updateTurn('CPUの発射中',1);message('CPUが赤い完成熟語コマを発射！');}
}
function down(e){if(!playing||!world||phase!=='ready'||turn!==0||!player?.alive)return;
 if(e.button!==undefined&&e.button!==0)return;
 const p=coords(e);
 // Same two-step gesture as real matches: first tap the kanji itself to select;
 // next pointer gesture, from anywhere, aims and launches it.
 if(!selected){
  if(Math.hypot(p.x-player.x,p.y-player.y)<Math.max(43,player.radius*1.12)){
   selected=player;message('「'+player.text+'」を選択中。好きな場所から引っ張って発射！');
   R.practiceSelectSound?.();draw();
  }else message('まず青い漢字「'+player.text+'」をタップして選択してください。');
  e.preventDefault();return;
 }
 drag={id:e.pointerId,start:p,dx:0,dy:0,power:0,spinStrength:P.clamp(Math.hypot(p.x-player.x,p.y-player.y)/330,0,1)};
 try{canvas.setPointerCapture(e.pointerId)}catch{}
 e.preventDefault();
}
function move(e){if(!drag||e.pointerId!==drag.id)return;
 const p=coords(e);drag.dx=drag.start.x-p.x;drag.dy=drag.start.y-p.y;
 drag.power=P.clamp(Math.hypot(drag.dx,drag.dy)/142,0,1);
 e.preventDefault();
}
function up(e){if(!drag||e.pointerId!==drag.id)return;move(e);const d=drag;drag=null;
 if(d.power<.06){message('選択OK！ もう少し大きくドラッグして発射！');return}
 shot(player,d.dx,d.dy,d.power,1,d.spinStrength);
}
function cpuShoot(){scheduledCPU=0;if(!playing||!world||turn!==1||phase!=='ready')return;
 getPieces();if(!cpu||!player){reset();return}
 const dx=player.x-cpu.x,dy=player.y-cpu.y,angle=Math.atan2(dy,dx)+(Math.random()-.5)*.17;
 const power=.72+Math.random()*.21;
 shot(cpu,Math.cos(angle),Math.sin(angle),power,Math.random()<.5?1:-1,.65);
}
function endShot(){
 P.settle(world);P.finishTurn(world,turn);selected=null;drag=null;
 getPieces();if(!player||!cpu){reset();return}
 turn=1-turn;turnNumber++;
 phase='ready';elapsed=0;acc=0;still=0;vortexResolved=false;magnetResolved=false;
 if(turn===1){updateTurn('次はCPU',1);message('CPUが打ち返します。自分のターンまでお待ちください。');scheduledCPU=setTimeout(cpuShoot,680);}
 else{updateTurn('あなたの番');message('青い漢字をもう一度タップして選択してから発射！ 熟語を変えると先攻からやり直せます。');}
}
function tick(now){raf=0;if(!playing)return;
 const dt=last?Math.min(.045,(now-last)/1000):.016;last=now;
 if(phase==='moving'){
  if(visual.hitstop>0){visual.hitstop=Math.max(0,visual.hitstop-dt)}else{
  elapsed+=dt;acc+=dt;let n=0;
  while(acc>=DT&&n<9){P.step(world,DT,visual.hooks);acc-=DT;n++;}
  acc=Math.min(acc,.25);
  if(elapsed>.42&&P.allStopped(world))still+=dt;else still=0;
  if(still>.46||elapsed>14){
   const shooter=world.bodies.find(b=>b.id===world.shooterId&&b.alive);
   if(!magnetResolved&&!world.preparation&&shooter?.ability==='magnet'){
    magnetResolved=true;const m=P.startMagnet(world,shooter);
    if(m){still=0;elapsed=0;acc=0;visual.magnet(shooter,m);message('磁力発動！ 半径3.8コマ以内の敵だけを吸い寄せます。');}
    else endShot();
   }else if(!vortexResolved&&!world.preparation&&shooter?.ability==='vortex'){
    vortexResolved=true;const v=P.startVortex(world,shooter);
    if(v){still=0;elapsed=0;acc=0;visual.vortex(shooter,v);message('渦巻発動！ 近くの敵コマが外向きに2周します。');}
    else endShot();
   }else endShot();
  }
  }
 }
 visual.update(dt);draw(dt);raf=requestAnimationFrame(tick);
}
function draw(dt=.016){if(!world||!R)return;R.drawPractice(canvas,world,selected,drag,visual,dt);}
function start(){if(!world)reset();resizePractice();if(!playing){playing=true;last=0;raf=requestAnimationFrame(tick)}}
function stop(){playing=false;drag=null;selected=null;last=0;if(raf)cancelAnimationFrame(raf);raf=0;if(scheduledCPU)clearTimeout(scheduledCPU);scheduledCPU=0}
$('practiceWord').addEventListener('change',reset);
$('practiceOpponentWord').addEventListener('change',reset);
$('practiceReset').addEventListener('click',reset);
canvas.addEventListener('pointerdown',down,{passive:false});canvas.addEventListener('pointermove',move,{passive:false});canvas.addEventListener('pointerup',up,{passive:false});
canvas.addEventListener('pointercancel',()=>drag=null);canvas.addEventListener('lostpointercapture',()=>drag=null);
window.KanjiPractice={start,stop,reset,get world(){return world},get turn(){return turn},get phase(){return phase},get selected(){return selected},get visual(){return visual}};
})();

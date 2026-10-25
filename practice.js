/* 漢字おはじき Ver.2.0 / 本番共通の描画・物理エンジンで行うオンライン待機練習。
   Firebase通信は一切行いません。常に青が先攻、CPUは自分で選んだ完成熟語コマ。
*/
(function(){'use strict';
const P=window.KanjiPhysics,canvas=document.getElementById('practiceBoard');if(!P||!canvas)return;
const $=id=>document.getElementById(id),R=window.KanjiRenderer;
const DT=1/120;
let world=null,player=null,cpu=null,drag=null,phase='ready',turn=0,elapsed=0,acc=0,still=0,last=0,raf=0;
let playing=false,scheduledCPU=0,vortexResolved=false,magnetResolved=false,turnNumber=0;
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
 drag=null;phase='ready';turn=0;elapsed=0;acc=0;still=0;vortexResolved=false;magnetResolved=false;turnNumber=0;
 updateTurn('先攻：あなた');
 message('青「'+word+'」と赤「'+other+'」が完成済み！ 画面を引っ張ってすぐに発射できます。');
 draw();
}
function coords(e){const rect=canvas.getBoundingClientRect();return {x:(e.clientX-rect.left)*P.W/rect.width,y:(e.clientY-rect.top)*P.H/rect.height};}
function shot(piece,dx,dy,power,spin,spinStrength=1){
 if(!piece||!piece.alive||!world||phase==='moving')return;
 P.fire(world,piece,dx,dy,power,spin,spinStrength);phase='moving';drag=null;elapsed=0;acc=0;still=0;vortexResolved=false;magnetResolved=false;
 if(piece.owner===0){updateTurn('あなたの発射中');message('発射！ コマが止まるとCPUが1回打ち返します。');}
 else{updateTurn('CPUの発射中',1);message('CPUが赤い完成熟語コマを発射！');}
}
function down(e){if(!playing||!world||phase!=='ready'||turn!==0||!player?.alive)return;
 if(e.button!==undefined&&e.button!==0)return;
 const p=coords(e);
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
 if(d.power<.06){message('画面を10px以上引っ張って離すと発射！');return}
 shot(player,d.dx,d.dy,d.power,1,d.spinStrength);
}
function cpuShoot(){scheduledCPU=0;if(!playing||!world||turn!==1||phase!=='ready')return;
 getPieces();if(!cpu||!player){reset();return}
 const dx=player.x-cpu.x,dy=player.y-cpu.y,angle=Math.atan2(dy,dx)+(Math.random()-.5)*.17;
 const power=.72+Math.random()*.21;
 shot(cpu,Math.cos(angle),Math.sin(angle),power,Math.random()<.5?1:-1,.65);
}
function endShot(){
 P.settle(world);P.finishTurn(world,turn);
 getPieces();if(!player||!cpu){reset();return}
 turn=1-turn;turnNumber++;
 phase='ready';elapsed=0;acc=0;still=0;vortexResolved=false;magnetResolved=false;
 if(turn===1){updateTurn('次はCPU',1);message('CPUが打ち返します。自分のターンまでお待ちください。');scheduledCPU=setTimeout(cpuShoot,680);}
 else{updateTurn('あなたの番');message('もう一度、盤面の好きな場所から引っ張って青コマを発射！ 熟語を変えるとすぐ先攻からやり直せます。');}
}
function tick(now){raf=0;if(!playing)return;
 const dt=last?Math.min(.045,(now-last)/1000):.016;last=now;
 if(phase==='moving'){
  elapsed+=dt;acc+=dt;let n=0;
  while(acc>=DT&&n<9){P.step(world,DT,{merge:(a,b)=>P.createMerged(world,a,b)});acc-=DT;n++;}
  if(n>=9)acc=0;
  if(elapsed>.42&&P.allStopped(world))still+=dt;else still=0;
  if(still>.46||elapsed>14){
   const shooter=world.bodies.find(b=>b.id===world.shooterId&&b.alive);
   if(!magnetResolved&&!world.preparation&&shooter?.ability==='magnet'){
    magnetResolved=true;const m=P.startMagnet(world,shooter);
    if(m){still=0;elapsed=0;acc=0;message('磁力発動！ 半径3.8コマ以内の敵だけを吸い寄せます。');}
    else endShot();
   }else if(!vortexResolved&&!world.preparation&&shooter?.ability==='vortex'){
    vortexResolved=true;const v=P.startVortex(world,shooter);
    if(v){still=0;elapsed=0;acc=0;message('渦巻発動！ 近くの敵コマが外向きに2周します。');}
    else endShot();
   }else endShot();
  }
 }
 draw();raf=requestAnimationFrame(tick);
}
function draw(){if(!world||!R)return;R.drawPractice(canvas,world,phase==='ready'&&turn===0?player:null,drag);}
function start(){if(!world)reset();if(!playing){playing=true;last=0;raf=requestAnimationFrame(tick)}}
function stop(){playing=false;drag=null;last=0;if(raf)cancelAnimationFrame(raf);raf=0;if(scheduledCPU)clearTimeout(scheduledCPU);scheduledCPU=0}
$('practiceWord').addEventListener('change',reset);
$('practiceOpponentWord').addEventListener('change',reset);
$('practiceReset').addEventListener('click',reset);
canvas.addEventListener('pointerdown',down,{passive:false});canvas.addEventListener('pointermove',move,{passive:false});canvas.addEventListener('pointerup',up,{passive:false});
canvas.addEventListener('pointercancel',()=>drag=null);canvas.addEventListener('lostpointercapture',()=>drag=null);
window.KanjiPractice={start,stop,reset,get world(){return world},get turn(){return turn},get phase(){return phase}};
})();

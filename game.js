/* 漢字おはじき Ver.1.4 | ASOBEAT — preparation and sudden death */
(function(){'use strict';
const P=window.KanjiPhysics;if(!P){document.body.textContent='物理エンジンを読み込めませんでした。';return;}
const WORDS=Object.keys(P.WORDS),DESCRIPTIONS={'暴走':'停止後1秒・敵を自動追尾','衝撃':'0.5秒で2コマ跳躍→半径1コマの能力衝撃波','鉄壁':'物理攻撃だけ軽減（能力は通常どおり）','渦巻':'敵に命中後1秒の渦','巨大':'命中で1.2倍巨大化（最大3回）','一撃':'発射中の対敵衝突×2'};
const $=id=>document.getElementById(id),ctx=$('board').getContext('2d',{alpha:false});
const {W,H}=P,PI=Math.PI,TAU=PI*2,clamp=P.clamp;
const scenes=['home','setup','confirm','game','result'];
const st={scene:'home',mode:'solo',diff:'normal',decks:[['暴走','衝撃','鉄壁'],['衝撃','鉄壁','暴走']],names:['青チーム','CPU'],world:null,phase:'title',turn:0,spin:1,drag:null,selected:null,fx:[],texts:[],bannerUntil:0,shake:0,flash:0,hitstop:0,time:0,acc:0,moving:0,still:0,shotCount:0,stats:{outs:[0,0],merges:[0,0],crits:[0,0],awakens:[0,0]},vortexPlayed:false,turnToken:0,sound:true,result:null,geom:null};
let audio=null,noiseBuffer=null,animLast=0,rafId=0;let timers=[];
function later(fn,ms){const token=st.turnToken;const id=setTimeout(()=>{timers=timers.filter(x=>x!==id);if(token===st.turnToken)fn()},ms);timers.push(id);return id}
function cancelAsync(){st.turnToken++;for(const id of timers)clearTimeout(id);timers=[]}
function safeLoad(){try{return JSON.parse(localStorage.getItem('asobeat_kanji_v10')||'{}')}catch(e){return {}}}
function save(){try{localStorage.setItem('asobeat_kanji_v10',JSON.stringify({names:st.names,decks:st.decks,diff:st.diff,sound:st.sound}))}catch(e){}}
const saved=safeLoad();if(Array.isArray(saved.names)&&saved.names.length===2)st.names=saved.names.map(x=>String(x||'').slice(0,10));
if(Array.isArray(saved.decks)&&saved.decks.length===2)for(let i=0;i<2;i++)if(Array.isArray(saved.decks[i])&&saved.decks[i].length===3&&saved.decks[i].every(w=>WORDS.includes(w)))st.decks[i]=saved.decks[i];
if(['easy','normal','hard'].includes(saved.diff))st.diff=saved.diff;
if(typeof saved.sound==='boolean')st.sound=saved.sound;
function changeScene(scene){st.scene=scene;for(const id of scenes)$(id+'Scene').classList.toggle('hidden',id!==scene);$('roulette').classList.add('hidden');$('modal').classList.add('hidden');window.scrollTo?.(0,0)}
function escName(n,def){return String(n||'').trim().slice(0,10)||def}
function initDecks(){for(let player=0;player<2;player++){
 const host=$('deck'+player);host.textContent='';for(let idx=0;idx<3;idx++){
  const wrap=document.createElement('div');wrap.className='deck-slot';
  const span=document.createElement('span');span.className='slot-heading';span.textContent='SLOT 0'+(idx+1);
  const select=document.createElement('select');select.setAttribute('aria-label',`${player===0?'青':'赤'}の熟語${idx+1}`);
  for(const word of WORDS){const opt=document.createElement('option');opt.value=word;opt.textContent=word;select.appendChild(opt)}
  select.value=st.decks[player][idx];select.addEventListener('change',()=>{st.decks[player][idx]=select.value;hint.textContent=DESCRIPTIONS[select.value];save()});
  const hint=document.createElement('div');hint.className='slot-effect';hint.textContent=DESCRIPTIONS[select.value];
  wrap.append(span,select,hint);host.appendChild(wrap);
 }
}}
function updateModeUI(){
 $('cpuSettings').classList.toggle('hidden',st.mode!=='solo');$('p2Label').textContent=st.mode==='solo'?'CPU':'プレイヤー2';
 $('name1').value=st.mode==='solo'?'CPU':(st.names[1]==='CPU'?'紅チーム':st.names[1]||'紅チーム');$('name1').disabled=st.mode==='solo';
 for(const btn of $('difficultyOptions').querySelectorAll('button'))btn.classList.toggle('active',btn.dataset.diff===st.diff);
}
function setup(mode){cancelAsync();st.mode=mode;st.phase='setup';
 $('name0').value=st.names[0]||'青チーム';updateModeUI();initDecks();changeScene('setup')}
function readSetup(){st.names[0]=escName($('name0').value,'青チーム');st.names[1]=st.mode==='solo'?'CPU':escName($('name1').value,'紅チーム');save()}
function confirm(){readSetup();for(let i=0;i<2;i++){
 $('confirmName'+i).textContent=st.names[i];const host=$('confirmDeck'+i);host.textContent='';
 for(const word of st.decks[i]){const chip=document.createElement('span');chip.className='confirm-word';chip.textContent=word;host.appendChild(chip)}
 }st.phase='confirm';changeScene('confirm')}
function onModal(content,title='遊びかた'){$('modalTitle').textContent=title;if(content!==undefined)$('modalContent').innerHTML=content;$('modal').classList.remove('hidden')}
function closeModal(){$('modal').classList.add('hidden')}
function toast(str){const el=$('toast');el.textContent=str;el.classList.remove('hidden');later(()=>el.classList.add('hidden'),1650)}
function initAudio(){if(!st.sound)return;try{if(!audio){audio=new (window.AudioContext||window.webkitAudioContext)();noiseBuffer=audio.createBuffer(1,Math.floor(audio.sampleRate*.25),audio.sampleRate);const a=noiseBuffer.getChannelData(0);for(let i=0;i<a.length;i++)a[i]=(Math.random()*2-1)*(.85-i/a.length*.35)}if(audio.state==='suspended')audio.resume()}catch(e){st.sound=false}}
function note(f=400,d=.1,vol=.10,type='sine',delay=0,endF=null){if(!st.sound||!audio)return;const time=audio.currentTime+delay;
 try{const osc=audio.createOscillator(),gain=audio.createGain();osc.type=type;osc.frequency.setValueAtTime(f,time);if(endF)osc.frequency.exponentialRampToValueAtTime(endF,time+d);gain.gain.setValueAtTime(Math.max(.0001,vol),time);gain.gain.exponentialRampToValueAtTime(.0001,time+d);osc.connect(gain);gain.connect(audio.destination);osc.start(time);osc.stop(time+d+.015)}catch(e){}
}
function noise(d=.08,vol=.07,delay=0){if(!st.sound||!audio||!noiseBuffer)return;const n=audio.createBufferSource(),gain=audio.createGain(),filter=audio.createBiquadFilter();n.buffer=noiseBuffer;filter.type='highpass';filter.frequency.value=400;gain.gain.setValueAtTime(vol,audio.currentTime+delay);gain.gain.exponentialRampToValueAtTime(.0001,audio.currentTime+delay+d);n.connect(filter);filter.connect(gain);gain.connect(audio.destination);n.start(audio.currentTime+delay);n.stop(audio.currentTime+delay+d)}
function sound(type,magnitude=1){if(!st.sound)return;initAudio();
 if(type==='shoot'){note(195,.13,.065,'sawtooth',0,85);note(380,.09,.025,'triangle',.02,200)}
 if(type==='impact'){noise(.055,Math.min(.09,.025+magnitude*.01));note(215,.075,.05,'triangle',0,94)}
 if(type==='crit'){noise(.12,.1);note(920,.08,.11,'square',0,480);note(1170,.09,.055,'sine',.07,660)}
 if(type==='merge'){note(360,.13,.10,'triangle',0,530);note(520,.18,.09,'triangle',.10,790);note(770,.24,.12,'sine',.19,1200)}
 if(type==='out'){noise(.10,.09);note(310,.19,.10,'square',0,100)}
 if(type==='burst'){note(210,.31,.10,'sawtooth',0,580);noise(.12,.07,.02)}
 if(type==='shock'){noise(.22,.16);note(210,.27,.11,'sawtooth',0,70);note(680,.16,.10,'triangle',.04,270)}
 if(type==='awake'){note(330,.16,.12,'triangle',0,490);note(520,.21,.10,'triangle',.10,760);note(830,.35,.14,'sine',.25,1200)}
 if(type==='win'){for(let i=0;i<4;i++)note([392,523,659,784][i],.33,.095,'triangle',i*.09)}
 if(type==='tap')note(450,.06,.035,'triangle',0,580);
}
function roulette(){
 cancelAsync();initAudio();const bits=new Uint32Array(1);
 try{crypto.getRandomValues(bits)}catch(e){bits[0]=(Math.random()*4294967296)>>>0}
 const sector=bits[0]%4,first=sector%2;
 st.phase='roulette';$('roulette').classList.remove('hidden');
 $('rouletteText').textContent='先攻を決定中…';
 const wheel=$('rouletteWheel');wheel.style.transition='none';wheel.style.transform='rotate(0deg)';
 // Each of the four colored sectors has exactly 1/4 probability.
 requestAnimationFrame(()=>requestAnimationFrame(()=>{
  wheel.style.transition='transform 2.15s cubic-bezier(.16,.76,.14,1)';
  wheel.style.transform=`rotate(${360*6-sector*90}deg)`;
 }));
 for(let i=0;i<10;i++)later(()=>sound('tap'),i*190);
 later(()=>{$('rouletteText').textContent=(first===0?'🔵 青':'🔴 赤')+'が先攻！';sound('merge')},2240);
 later(()=>startMatch(first),3000);
}

function makeNames(){for(let i=0;i<2;i++)$('gameName'+i).textContent=st.names[i]}
function startMatch(first=null){cancelAsync();st.world=P.newWorld();P.spawnInitial(st.world,st.decks);st.drag=null;st.selected=null;st.fx=[];st.texts=[];st.phase='playing';st.turn=first===null?st.turn:first;st.spin=1;st.hitstop=0;st.shake=0;st.flash=0;st.time=0;st.acc=0;st.moving=0;st.still=0;st.shotCount=0;st.vortexPlayed=false;st.cancelUntil=0;st.result=null;st.stats={outs:[0,0],merges:[0,0],crits:[0,0],awakens:[0,0]};st._impactTimes=new Map();
 $('spinRight').classList.add('active');$('spinLeft').classList.remove('active');makeNames();
 $('suddenOverlay').classList.add('hidden');$('suddenOverlay').setAttribute('aria-hidden','true');
 $('effectBanner').classList.add('hidden');$('toast').classList.add('hidden');
 $('fieldStatus').className='field-status hidden';st.bannerUntil=0;
 changeScene('game');resizeCanvas();updateHud();beginTurn();
}
function updateHud(){if(!st.world)return;
 for(let i=0;i<2;i++){$('count'+i).textContent=`残り ${P.remaining(st.world,i)} コマ`;$('bar'+i).classList.toggle('active',st.turn===i);
  $('gameName'+i).textContent=st.names[i];
 }
}
function beginTurn(){if(st.phase==='result'||!st.world)return;st.phase='playing';st.selected=null;st.drag=null;st.spin=1;st.still=0;
 $('spinRight').classList.add('active');$('spinLeft').classList.remove('active');
 $('turnText').textContent=st.turn===0?'🔵 青の番':'🔴 赤の番';
 $('phaseText').textContent=st.world.preparation?`準備フェーズ ${st.world.prepTurns+1}/2 · 能力無効`:(st.world.suddenDeath?'⚠️ サドンデス！':st.mode==='solo'&&st.turn===1?'CPU思考中…':'漢字を弾こう');
 $('selectedLabel').textContent=st.mode==='solo'&&st.turn===1?'CPUが狙っています…':'① 漢字をタップして選択';
 $('hintLabel').textContent='② 好きな位置からドラッグ／2本指タップで中止';
 $('aimHint').classList.add('hidden');$('spinMeter').textContent='回転力 --';updateFieldStatus();
 const cpu=st.mode==='solo'&&st.turn===1;
 for(const id of ['spinRight','spinLeft'])$(id).disabled=cpu;
 updateHud();if(cpu)later(cpuTakeTurn,550);
}
function fireShot(b,dirX,dirY,power,spin,spinStrength=1){if(st.phase!=='playing'||!b||!b.alive||b.owner!==st.turn)return false;
 const len=Math.hypot(dirX,dirY);if(len<.01||power<.06)return false;
 P.fire(st.world,b,dirX,dirY,power,spin,spinStrength);st.vortexPlayed=false;st.shotCount++;st.phase='moving';st.moving=0;st.still=0;st.acc=0;st.selected=null;st.drag=null;
 $('phaseText').textContent='物理演算中…';$('selectedLabel').textContent=b.text+'、発射！';$('hintLabel').textContent='全コマが止まると交代';
 addParticles(b.x,b.y,10,st.turn===0?'#70c5f7':'#f4a29c',1);st.shake=2.6;sound('shoot');$('aimHint').classList.add('hidden');$('spinMeter').textContent='回転力 --';
 if(b.ability==='shock'&&!st.world.preparation)showEffect('衝撃：0.5秒ジャンプ → 着地で円形波！',850);
 if(b.ability==='iron'&&!st.world.preparation)showEffect('鉄壁：自ターン終了時に護陣！',900);
 if(b.ability==='vortex'&&!st.world.preparation)showEffect('渦巻：敵に命中後、停止時に渦！',850);
 if(b.ability==='giant'&&!st.world.preparation)showEffect('巨大：敵への命中で巨大化！',800);
 if(b.ability==='strike'&&!st.world.preparation)showEffect('一撃：敵への吹き飛ばし×2！',800);
 return true;
}
function collisionHooks(){return {
 impact:({a,b,p,speed,corner,impulse})=>{
  const shooter=(a.id===st.world.shooterId?a:b.id===st.world.shooterId?b:null);
  // Collisions may generate adjacent contact manifolds: one SFX per pair / 120 ms.
  const key=a.static?'w'+b.id:b.static?'w'+a.id:[a.id,b.id].sort((x,y)=>x-y).join('_');
  st._impactTimes||=new Map();if((st.world.time-(st._impactTimes.get(key)||-99))<.11)return;
  st._impactTimes.set(key,st.world.time);
  const big=speed>165;
  if(big){addParticles(p.x,p.y,Math.min(18,Math.round(speed/45)),'#fbda92',speed/330);st.shake=Math.max(st.shake,clamp(speed/100,1.5,7.5));}
  if(!st.world.preparation&&shooter&&a.owner!==b.owner&&!a.static&&!b.static){
    if(shooter.ability==='giant'&&P.growGiant(st.world,shooter)){
     addRing(shooter.x,shooter.y,'#eac864',shooter.radius*1.7);addParticles(shooter.x,shooter.y,23,'#ffd774',1.3);
     st.flash=.20;showText('巨大化 ×'+shooter.growthStacks,shooter.x,shooter.y,'#fff2b4');showEffect('巨大化 '+shooter.growthStacks+'/3 !!',850);sound('merge');
    }
    if(shooter.ability==='strike'){
     addParticles(p.x,p.y,22,'#ffc064',1.25);showText('一撃 ×2!!',p.x,p.y,'#ffe5a8');st.shake=Math.max(st.shake,7);sound('crit');
    }
  }
  if(corner){
   if(shooter&&a.owner!==b.owner&&!a.static&&!b.static){st.stats.crits[shooter.owner]++;st.hitstop=Math.max(st.hitstop,.05);st.flash=.26;showText('CRITICAL ×1.2!',p.x,p.y,'#fff1a2');sound('crit');}
  }else if(big){sound('impact',speed/300);if(speed>420)st.hitstop=Math.max(st.hitstop,.022)}
 },
 merge:(a,b)=>{
  if(st.phase==='result')return;
  const m=P.createMerged(st.world,a,b);st.stats.merges[st.world.lastShooterOwner]++;
  addParticles(m.x,m.y,30,'#e8ae55',1.6);addRing(m.x,m.y,'#eaba65',100);st.shake=4.5;st.flash=.20;st.hitstop=Math.max(st.hitstop,.065);
  showText('『'+m.word+'』合体!!',m.x,m.y,'#fff2b9');showEffect(m.word+' 合体成功！',1050);sound('merge');
 },
 out:b=>{
  st.stats.outs[1-b.owner]++;const pos={x:clamp(b.x,25,W-25),y:clamp(b.y,25,H-25)};
  addParticles(pos.x,pos.y,20,b.owner===0?'#3989c5':'#d35b58',1.3);st.shake=4.8;showText('場外!!',pos.x,pos.y,'#ffe9bb');sound('out');updateHud();
 },
 ability:(b,name)=>{if(name==='burst'){addRing(b.x,b.y,'#e75552',115);addParticles(b.x,b.y,23,'#f67252',1.4);showText('暴走開始!!',b.x,b.y,'#f9a36d');showEffect('暴走加速!!',900);sound('burst')}},
 shockLand:(b,wave)=>{
  if(!wave)return;
  st.shake=5.5;st.hitstop=Math.max(st.hitstop,.05);st.flash=.32;
  addRing(wave.x,wave.y,'#a7ffff',P.PIECE_UNIT);
  addParticles(wave.x,wave.y,20,'#82f4ff',.95);
  showText('衝撃着地！',wave.x,wave.y,'#dcffff');showEffect('衝撃：2コマジャンプ→通常100%攻撃相当の衝撃波！',930);sound('shock');
 },
 shockHit:(wave,target,impulse)=>{
  addParticles(target.x,target.y,Math.max(5,Math.round(impulse/100)),'#8ddbf3',.65);
  st.shake=Math.max(st.shake,Math.min(5,impulse/200));
 },
 awaken:(upgraded,original)=>{
  st.stats.awakens[upgraded.owner]++;
  addRing(upgraded.x,upgraded.y,'#f7c551',135);
  addParticles(upgraded.x,upgraded.y,33,'#f4c960',1.45);
  st.flash=.45;st.hitstop=Math.max(st.hitstop,.09);st.shake=6.5;
  showText('覚醒！『'+upgraded.text+'』',upgraded.x,upgraded.y,'#fff2b4');
  showEffect((upgraded.owner===0?'青':'赤')+'のラスト1文字、覚醒!!',1300);sound('awake');updateHud();
 }
}}
function tickPhysics(dt){if(st.hitstop>0){st.hitstop=Math.max(0,st.hitstop-dt);return;}
 st.moving+=dt;st.acc+=Math.min(dt,.05);let steps=0;
 while(st.acc>=1/120&&steps<8&&st.phase==='moving'){
  P.step(st.world,1/120,collisionHooks());st.acc-=1/120;steps++;
 }
 if(steps===8)st.acc=0;
 if(st.moving>.58&&P.allStopped(st.world))st.still+=dt;else st.still=0;
 if(st.still>.48||st.moving>12.5){
   const shooter=st.world.bodies.find(b=>b.id===st.world.shooterId&&b.alive);
   if(!st.vortexPlayed&&!st.world.preparation&&shooter?.ability==='vortex'&&shooter.vortexHitEnemy){
    st.vortexPlayed=true;
    const v=P.startVortex(st.world,shooter);
    if(v){
     st.still=0;st.moving=0;st.acc=0;
     addRing(shooter.x,shooter.y,'#a875ed',P.PIECE_UNIT*1.9);addParticles(shooter.x,shooter.y,26,'#9c78ef',1.1);
     showEffect('渦巻・周囲の全員を1秒旋回！',950);sound('shock');return;
    }
   }
   P.settle(st.world);st.acc=0;finishShot();
 }

}
function finishShot(){
 if(!st.world||st.phase!=='moving')return;
 const world=st.world,n0=P.remaining(world,0),n1=P.remaining(world,1);
 if(n0===0||n1===0){finishGame(n0===0&&n1===0?-1:n0===0?1:0);return;}
 const wasPreparation=world.preparation;
 if(wasPreparation){
  world.prepTurns++;
  if(world.prepTurns>=2){
   P.openArena(world);showEffect('準備完了！ 場外開放・能力解禁！',1350);
   addRing(W/2,H/2,'#f0b64f',125);sound('merge');
  }
 }else{
  const fields=P.finishTurn(world,st.turn,true);
  if(fields.length){const iron=world.bodies.find(b=>b.id===fields[0].sourceId);
   addRing(iron?.x??W/2,iron?.y??H/2,st.turn===0?'#4faeea':'#ec8077',P.PIECE_UNIT*3);
   showEffect((st.turn===0?'青':'赤')+'の鉄壁護陣 展開！',800);sound('awake');
  }
  if(world.suddenDeath){
   P.expandGates(world);showEffect(`⚠️ 場外拡大！ ${world.suddenTurns}ターン目`,900);
   sound('impact');
  }
 }
 st.turn=1-st.turn;
 if(!world.preparation&&!world.suddenDeath&&n0===1&&n1===1){
  world.suddenDeath=true;st.phase='sudden';st.selected=null;st.drag=null;
  $('suddenOverlay').classList.remove('hidden');
  $('suddenOverlay').setAttribute('aria-hidden','false');sound('out');
  updateHud();updateFieldStatus();
  later(()=>{if(st.scene!=='game'||st.phase!=='sudden')return;
   $('suddenOverlay').classList.add('hidden');$('suddenOverlay').setAttribute('aria-hidden','true');beginTurn();},2000);
  return;
 }
 beginTurn();
}

function updateFieldStatus(){
 const el=$('fieldStatus');if(!el||!st.world)return;
 const w=st.world,fields=w.fields;
 if(w.preparation){el.className='field-status prep';el.textContent=`準備 ${w.prepTurns+1}/2｜場外・中央封鎖 / 能力OFF`;return;}
 if(fields.length){el.className='field-status '+(fields[0].owner===0?'blue':'red');el.textContent=(fields[0].owner===0?'🔵 青':'🔴 赤')+' 鉄壁護陣：味方への攻撃×0.7・能力×1.0 / 半径3コマ';return;}
 if(w.suddenDeath){el.className='field-status sudden';el.textContent=`⚠️ サドンデス：場外が毎ターン1コマ拡大（+${w.suddenTurns}）`;return;}
 el.className='field-status hidden';
}

function finishGame(winner){cancelAsync();st.phase='result';st.result={winner,turns:st.shotCount,stats:JSON.parse(JSON.stringify(st.stats))};
 $('resultHeadline').classList.toggle('red',winner===1);
 $('resultHeadline').textContent=winner<0?'引き分け！':winner===0?'青の勝利！':'赤の勝利！';
 $('winnerName').textContent=winner<0?'両者、場外で決着つかず':`${st.names[winner]} の勝利`;
 $('resultEyebrow').textContent=winner<0?'DRAW GAME':'VICTORY!';
 $('statTurns').textContent=st.shotCount;
 $('statOuts').textContent=st.stats.outs.reduce((a,b)=>a+b,0);
 $('statMerges').textContent=st.stats.merges.reduce((a,b)=>a+b,0);
 $('statCrits').textContent=st.stats.crits.reduce((a,b)=>a+b,0);
 $('statAwakens').textContent=st.stats.awakens.reduce((a,b)=>a+b,0);
 $('resultDecks').textContent='';for(let i=0;i<2;i++){
  const item=document.createElement('p');item.textContent=`${i===0?'🔵':'🔴'} ${st.names[i]}　${st.decks[i].join(' / ')}　｜ KO ${st.stats.outs[i]} / 合体 ${st.stats.merges[i]} / CRITICAL ${st.stats.crits[i]} / 覚醒 ${st.stats.awakens[i]}`;$('resultDecks').appendChild(item)
 }
 changeScene('result');sound('win');
}
function cpuTakeTurn(){if(!st.world||st.phase!=='playing'||st.turn!==1||st.mode!=='solo')return;
 const own=st.world.bodies.filter(b=>b.alive&&b.owner===1),enemy=st.world.bodies.filter(b=>b.alive&&b.owner===0);
 if(!own.length||!enemy.length){finishGame(own.length?1:enemy.length?0:-1);return}
 const candidates=[];
 for(const src of own){
  const sorted=[...enemy].sort((a,b)=>Math.hypot(a.x-src.x,a.y-src.y)-Math.hypot(b.x-src.x,b.y-src.y));
  const ally=own.filter(x=>x!==src&&!x.merged&&!src.merged&&x.word===src.word&&x.text!==src.text);
  const targets=st.world.preparation?ally.slice(0,2):[...sorted.slice(0,st.diff==='hard'?3:st.diff==='normal'?2:1),...ally.slice(0,1)];
  for(const target of targets){
   const base=Math.atan2(target.y-src.y,target.x-src.x);
   const offsets=st.diff==='easy'?[0,.19,-.19]:st.diff==='normal'?[0,-.12,.12]:[0,-.13,.13];
   for(const offset of offsets)for(const power of (st.diff==='hard'?[.7,1]:[.86,1])){
    const angle=base+offset,c={b:src,dx:Math.cos(angle),dy:Math.sin(angle),power,spin:offset>=0?1:-1};
    c.score=P.evaluateShot(st.world,src,{x:c.dx,y:c.dy},power,c.spin);candidates.push(c);
   }
  }
 }
 if(!candidates.length){const b=own[0];fireShot(b,-1,.6,1,1);return}
 candidates.sort((a,b)=>b.score-a.score);
 let choice;
 if(st.diff==='easy')choice=candidates[Math.min(candidates.length-1,Math.floor(Math.random()*Math.min(9,candidates.length)))];
 else if(st.diff==='normal')choice=candidates[Math.min(candidates.length-1,Math.floor(Math.random()*Math.min(3,candidates.length)))];
 else choice=candidates[0];
 st.selected=choice.b;
 const imprecision=st.diff==='easy'?.17:st.diff==='normal'?.065:.014;
 const a=Math.atan2(choice.dy,choice.dx)+(Math.random()-.5)*imprecision;
 st.drag={cpu:true,body:choice.b,dx:Math.cos(a)*choice.power*140,dy:Math.sin(a)*choice.power*140,power:choice.power,spinStrength:1};
 $('selectedLabel').textContent='CPU：'+choice.b.text+'を狙う';
 later(()=>fireShot(choice.b,Math.cos(a),Math.sin(a),choice.power,choice.spin),650);
}
function boardPoint(evt){const r=$('board').getBoundingClientRect();return{x:(evt.clientX-r.left)*W/r.width,y:(evt.clientY-r.top)*H/r.height}}
function selectable(){return st.scene==='game'&&st.phase==='playing'&&!(st.mode==='solo'&&st.turn===1)}
function findSelected(pos){if(!st.world)return null;let best=null,dist=Infinity;
 for(const b of st.world.bodies){if(!b.alive||b.owner!==st.turn)continue;
  const d=Math.hypot(b.x-pos.x,b.y-pos.y),allowed=Math.max(b.w,b.h)*.68+15;
  if(d<allowed&&d<dist){best=b;dist=d}
 }return best;
}
function selectPiece(b){st.selected=b;st.drag=null;
 $('selectedLabel').textContent=b.merged?`『${b.text}』${b.ability==='giant'?' Lv'+b.growthStacks:''} を選択`:`「${b.text}」を選択`;
 $('hintLabel').textContent='盤面の外からでもドラッグして発射！';
 $('aimHint').textContent=`${b.text} を選択中 · 好きな位置で逆方向に引っ張ろう`;
 $('aimHint').classList.remove('hidden');
 $('spinMeter').textContent='回転力：開始位置で変化';sound('tap');
}
// Spin is determined by the gap between the SELECTED piece and where the
// NEXT drag gesture BEGINS, NOT by the distance to an inaccessible board edge.
function aimSpinAt(body,start){return clamp(Math.hypot(start.x-body.x,start.y-body.y)/420,0,1)}
function startAim(e,b){initAudio();const pos=boardPoint(e);
 const strength=aimSpinAt(b,pos);
 st.drag={pointer:e.pointerId,body:b,start:pos,current:pos,dx:0,dy:0,power:0,spinStrength:strength};
 try{$('gameScene').setPointerCapture(e.pointerId)}catch(err){}
 $('hintLabel').textContent=`回転力 ${Math.round(strength*100)}% ・逆へ引っ張ろう`;
 $('spinMeter').textContent=`↻↺ 回転力 ${Math.round(strength*100)}%`;
}
function pointerDown(e){if(Date.now()<(st.cancelUntil||0)||!selectable()||st.drag)return;
 if(e.isPrimary===false||e.button!==undefined&&e.button!==0)return;
 if(e.target.closest('button,input,select,a'))return;
 const pos=boardPoint(e),onCanvas=e.target.id==='board';
 const candidate=onCanvas?findSelected(pos):null;
 // First tap a kanji to select. Tapping a different kanji switches selection.
 if(candidate&&candidate!==st.selected){e.preventDefault();initAudio();selectPiece(candidate);return;}
 if(!st.selected)return;
 // Next gesture can begin ANYWHERE in the game screen (even beyond the board).
 e.preventDefault();startAim(e,st.selected);
}
function pointerMove(e){if(!st.drag||st.drag.cpu||e.pointerId!==st.drag.pointer)return;
 e.preventDefault();const pos=boardPoint(e),d=st.drag;
 d.current=pos;d.dx=d.start.x-pos.x;d.dy=d.start.y-pos.y;
 d.power=clamp(Math.hypot(d.dx,d.dy)/142,0,1);
 $('hintLabel').textContent=`発射 ${Math.round(d.power*100)}% ・回転 ${Math.round(d.spinStrength*100)}%`;
}
function pointerUp(e){if(!st.drag||st.drag.cpu||e.pointerId!==st.drag.pointer)return;
 e.preventDefault();pointerMove(e);const d=st.drag;st.drag=null;
 if(Math.hypot(d.dx,d.dy)>13){
  if(!fireShot(d.body,d.dx,d.dy,d.power,st.spin,d.spinStrength)){
   $('hintLabel').textContent='もう少し長く引っ張ってください';
  }
 }else{$('hintLabel').textContent='選択OK！ 好きな場所から大きくドラッグ';}
}
function pointerCancel(e){if(st.drag&&!st.drag.cpu&&(!e||e.pointerId===st.drag.pointer)){
 const pointer=st.drag.pointer;st.drag=null;
 try{if($('gameScene').hasPointerCapture(pointer))$('gameScene').releasePointerCapture(pointer)}catch(err){}
 $('hintLabel').textContent='キャンセルしました。好きな場所から再入力';
}}
function secondFingerCancel(e){
 if(!st.drag||st.drag.cpu||e.pointerType!=='touch'||e.pointerId===st.drag.pointer)return;
 e.preventDefault();st.cancelUntil=Date.now()+400;pointerCancel();
 toast('2本指タップで発射をキャンセル');
}

function addRing(x,y,color='#e7c384',size=80){st.fx.push({type:'ring',x,y,color,r:5,max:size,t:0,life:.44})}
function addParticles(x,y,count,color,energy=1){for(let i=0;i<count&&st.fx.length<260;i++){
 const theta=Math.random()*TAU,speed=(70+Math.random()*245)*energy;
 st.fx.push({type:'spark',x,y,vx:Math.cos(theta)*speed,vy:Math.sin(theta)*speed,r:1.4+Math.random()*3.3,t:0,life:.26+Math.random()*.45,color})
 }}
function showText(str,x,y,color){st.texts.push({str,x,y,color,t:0,life:1.05})}
function showEffect(str,duration=800){const b=$('effectBanner');b.textContent=str;b.classList.remove('hidden');b.style.animation='none';void b.offsetWidth;b.style.animation='';st.bannerUntil=st.time+duration/1000}
function renderFx(dt){for(let i=st.fx.length-1;i>=0;i--){const e=st.fx[i];e.t+=dt;if(e.type==='spark'){e.x+=e.vx*dt;e.y+=e.vy*dt;e.vx*=Math.exp(-3*dt);e.vy*=Math.exp(-3*dt)}if(e.t>e.life)st.fx.splice(i,1)}
 for(let i=st.texts.length-1;i>=0;i--){st.texts[i].t+=dt;if(st.texts[i].t>st.texts[i].life)st.texts.splice(i,1)}
 st.shake=Math.max(0,st.shake-24*dt);st.flash=Math.max(0,st.flash-2.1*dt);
 if(st.bannerUntil&&st.time>=st.bannerUntil){$('effectBanner').classList.add('hidden');st.bannerUntil=0}
}
let artCanvas=null;
function makeBoardArt(){const canvas=document.createElement('canvas');canvas.width=W;canvas.height=H;const c=canvas.getContext('2d');
 let grad=c.createLinearGradient(0,0,W,H);grad.addColorStop(0,'#ede2cd');grad.addColorStop(.45,'#e8d7bd');grad.addColorStop(1,'#dcc5a3');c.fillStyle=grad;c.fillRect(0,0,W,H);
 // Warm layered fibers of wood, fully generated with Canvas: no image downloads.
 let rand=11923;const next=()=>((rand= (rand*1664525+1013904223)>>>0)/4294967296);
 for(let i=0;i<320;i++){let y=next()*H,x=next()*W;c.strokeStyle=`rgba(119,85,49,${next()*.07})`;c.lineWidth=.3+next()*1.0;c.beginPath();c.moveTo(x,y);c.bezierCurveTo(x+40,y+1,x+110,y-3,x+220,y+2);c.stroke()}
 c.fillStyle='rgba(50,99,153,.035)';c.fillRect(0,H*.56,W,H*.44);c.fillStyle='rgba(191,57,65,.030)';c.fillRect(0,0,W,H*.44);
 c.save();c.strokeStyle='#b8a78eaa';c.lineWidth=2;c.setLineDash([6,14]);c.beginPath();c.moveTo(W/2,15);c.lineTo(W/2,H-15);c.stroke();c.restore();
 c.strokeStyle='rgba(255,255,255,.5)';c.lineWidth=3;c.strokeRect(10,10,W-20,H-20);
 c.fillStyle='rgba(39,56,65,.12)';c.font='900 20px sans-serif';c.textAlign='center';c.fillText('紅 の 陣',W/2,45);c.fillText('青 の 陣',W/2,H-25);
 artCanvas=canvas;
}
function drawArenaGeometry(){
 const world=st.world;if(!world)return;
 const prep=world.preparation,gx=prep?0:world.gateX,gy=prep?0:world.gateY;
 ctx.save();
 function segment(x,y,w,h){if(w<=0||h<=0)return;
  const grad=ctx.createLinearGradient(x,y,x+w,y+h);
  grad.addColorStop(0,'#51473d');grad.addColorStop(.55,'#685747');grad.addColorStop(1,'#37322b');
  ctx.fillStyle=grad;ctx.fillRect(x,y,w,h);
  ctx.fillStyle='#fff2ca4d';ctx.fillRect(x+3,y+3,Math.max(0,w-6),Math.max(0,h-6));
 }
 const lenX=(W-gx)/2,lenY=(H-gy)/2;
 segment(0,0,lenX,15);segment(W-lenX,0,lenX,15);
 segment(0,H-15,lenX,15);segment(W-lenX,H-15,lenX,15);
 segment(0,0,15,lenY);segment(0,H-lenY,15,lenY);
 segment(W-15,0,15,lenY);segment(W-15,H-lenY,15,lenY);
 if(prep){
  ctx.fillStyle='#102a37b0';ctx.fillRect(0,H/2-10,W,20);
  ctx.strokeStyle='#e8cc81';ctx.lineWidth=3;ctx.setLineDash([10,7]);
  ctx.beginPath();ctx.moveTo(20,H/2);ctx.lineTo(W-20,H/2);ctx.stroke();ctx.setLineDash([]);
  ctx.fillStyle='#fff7da';ctx.textAlign='center';ctx.font='900 19px sans-serif';
  ctx.fillText('準 備 フ ェ ー ズ',W/2,H/2-16);
 }else{
  function gate(x,y,rot,width){ctx.save();ctx.translate(x,y);ctx.rotate(rot);
   ctx.fillStyle=world.suddenDeath?'#d63e5070':'#d5686265';ctx.fillRect(-width/2,-6,width,11);
   ctx.textAlign='center';ctx.fillStyle=world.suddenDeath?'#b32e42':'#ab4b3e';
   ctx.font='900 15px sans-serif';ctx.fillText(world.suddenDeath?'⚠ 場外':'場 外',0,-12);
   ctx.restore();}
  gate(W/2,7,Math.PI,gx);gate(W/2,H-7,0,gx);
  gate(7,H/2,-Math.PI/2,gy);gate(W-7,H/2,Math.PI/2,gy);
 }
 ctx.restore();
}
function resizeCanvas(){const canvas=$('board'),dpr=Math.min(2,window.devicePixelRatio||1);canvas.width=Math.round(W*dpr);canvas.height=Math.round(H*dpr);
 ctx.setTransform(canvas.width/W,0,0,canvas.height/H,0,0);
 const b=$('boardWrap');const holder=b.parentElement,hs=getComputedStyle(holder);const innerW=holder.clientWidth-parseFloat(hs.paddingLeft||0)-parseFloat(hs.paddingRight||0);const availableWidth=Math.max(150,Math.min(innerW,540));
 const cap=Math.min(window.innerHeight-200,820);const h=Math.max(235,Math.min(availableWidth*H/W,cap));const w=h*W/H;
 b.style.width=`${w}px`;b.style.height=`${h}px`;b.style.flex='0 0 auto';
}
function drawPiece(b){const color=b.owner===0?'#2473ab':'#c7504f',dark=b.owner===0?'#174766':'#782d30';
 const shine=b.owner===0?'#9fddfa':'#ffd2b9';
 ctx.save();ctx.translate(b.x,b.y);
 if(b.jump){const lift=Math.sin(Math.PI*b.jump.age/b.jump.duration)*33;
  ctx.fillStyle='#0e33402a';ctx.beginPath();ctx.ellipse(0,11,Math.max(15,b.w*.40),Math.max(8,b.h*.18),0,0,TAU);ctx.fill();
  ctx.translate(0,-lift);ctx.scale(1+lift*.004,1+lift*.004);
 }
 ctx.rotate(b.angle);const scale=b.scale||1;ctx.scale(scale,scale);
 if(st.selected===b&&st.phase==='playing'){
 ctx.save();ctx.strokeStyle=b.owner===0?'#2ba5e3':'#d96255';ctx.lineWidth=2;ctx.setLineDash([5,5]);ctx.globalAlpha=.85;
 ctx.beginPath();ctx.ellipse(0,0,b.w*.70+11,b.h*.70+11,0,0,TAU);ctx.stroke();ctx.restore();
 }
 if(b.ability==='shock'){ctx.strokeStyle=b.shockArmed?'#4bd8eabb':'#57c8d34f';ctx.lineWidth=2.8;ctx.beginPath();ctx.ellipse(0,0,b.w*.64+9,b.h*.7+9,0,0,TAU);ctx.stroke()}
 if(b.awakened){ctx.strokeStyle='#f3c05cb8';ctx.shadowColor='#edc361';ctx.shadowBlur=10;ctx.lineWidth=4;ctx.beginPath();ctx.ellipse(0,0,b.w*.64+9,b.h*.70+9,0,0,TAU);ctx.stroke();ctx.shadowBlur=0;}
  if(b.ability==='burst'&&b.burstStage==='homing'){ctx.fillStyle='#ff613e33';ctx.beginPath();ctx.ellipse(0,0,b.w*.80,b.h*.75,0,0,TAU);ctx.fill()}
  if(b.ability==='iron'){ctx.lineWidth=2;ctx.strokeStyle='#d1ab66cc';ctx.strokeRect(-b.w*.53/scale,-b.h*.57/scale,b.w*1.06/scale,b.h*1.14/scale)}
  if(b.ability==='giant'){ctx.strokeStyle='#dcac39';ctx.lineWidth=2;ctx.strokeRect(-b.w*.52/scale,-b.h*.52/scale,b.w*1.04/scale,b.h*1.04/scale)}
  if(b.ability==='vortex'){ctx.strokeStyle='#9875ca';ctx.lineWidth=2;ctx.beginPath();ctx.arc(0,0,Math.max(b.w,b.h)*.68/scale,0,TAU);ctx.stroke()}
 const shape=P.shapeFor(b.text),font=`1000 ${shape.fontSize}px "Noto Sans CJK JP","Hiragino Kaku Gothic ProN","Yu Gothic",sans-serif`;
 ctx.font=font;ctx.textAlign='center';ctx.textBaseline='middle';ctx.lineJoin='round';ctx.miterLimit=2;
 ctx.shadowColor='#3928215c';ctx.shadowOffsetX=3.5;ctx.shadowOffsetY=6;ctx.shadowBlur=4;ctx.lineWidth=7;ctx.strokeStyle='#f2e6d3';ctx.strokeText(b.text,0,shape.centerOffsetY);ctx.shadowColor='transparent';ctx.shadowOffsetY=0;ctx.shadowOffsetX=0;ctx.shadowBlur=0;
 ctx.lineWidth=5;ctx.strokeStyle=dark;ctx.strokeText(b.text,0,shape.centerOffsetY);
 ctx.lineWidth=2;ctx.strokeStyle=shine;ctx.strokeText(b.text,0,shape.centerOffsetY);
 ctx.fillStyle=color;ctx.fillText(b.text,0,shape.centerOffsetY);
 if(b.flash>0){ctx.globalAlpha=b.flash*.6;ctx.fillStyle='#fff';ctx.fillText(b.text,0,shape.centerOffsetY)}
 ctx.restore();
}
function drawFields(){
 for(const f of st.world.fields){const p=P.fieldPosition(st.world,f),r=f.radius;
  ctx.save();ctx.beginPath();ctx.arc(p.x,p.y,r,0,TAU);
  const grad=ctx.createRadialGradient(p.x,p.y,9,p.x,p.y,r);
  if(f.owner===0){grad.addColorStop(0,'rgba(64,167,237,.02)');grad.addColorStop(.8,'rgba(47,150,239,.13)');grad.addColorStop(1,'rgba(30,122,222,.24)');}
  else{grad.addColorStop(0,'rgba(255,114,114,.02)');grad.addColorStop(.8,'rgba(245,98,106,.15)');grad.addColorStop(1,'rgba(214,58,71,.24)');}
  ctx.fillStyle=grad;ctx.fill();ctx.strokeStyle=f.owner===0?'#238dda':'#e05261';ctx.lineWidth=4;
  ctx.setLineDash([12,7]);ctx.stroke();ctx.setLineDash([]);ctx.globalAlpha=.48;
  ctx.beginPath();ctx.arc(p.x,p.y,r-9,0,TAU);ctx.lineWidth=1;ctx.stroke();ctx.restore();
 }
}
function drawVortices(){
 for(const v of st.world.vortices){
  const alpha=1-v.age/v.duration;ctx.save();ctx.translate(v.center.x,v.center.y);
  ctx.strokeStyle=`rgba(138,85,217,${.38+.55*alpha})`;ctx.lineWidth=4;ctx.shadowColor='#a785fa';ctx.shadowBlur=9;
  for(let arm=0;arm<3;arm++){ctx.beginPath();for(let i=0;i<=55;i++){
   const theta=(i/55)*Math.PI*4+arm*2*Math.PI/3+v.age*2;
   const rad=8+(i/55)*Math.min(v.range||117,65+v.expand);
   if(i===0)ctx.moveTo(Math.cos(theta)*rad,Math.sin(theta)*rad);
   else ctx.lineTo(Math.cos(theta)*rad,Math.sin(theta)*rad);
  }ctx.stroke()}
  ctx.restore();
 }
}
function drawTrails(dt){for(const b of st.world.bodies){if(!b.alive)continue;
  const speed=Math.hypot(b.vx,b.vy);b.trailTime+=dt;
  if(speed>120&&b.trailTime>.045){b.trailTime=0;b.trail.unshift({x:b.x,y:b.y,angle:b.angle,t:0});if(b.trail.length>7)b.trail.pop()}
  for(let i=b.trail.length-1;i>=0;i--){let p=b.trail[i];p.t+=dt;if(p.t>.34){b.trail.splice(i,1);continue}
   ctx.save();ctx.globalAlpha=Math.max(0,(1-p.t/.34)*.23);ctx.translate(p.x,p.y);ctx.rotate(p.angle);
   ctx.font=`1000 ${P.shapeFor(b.text).fontSize}px "Noto Sans CJK JP",sans-serif`;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle=b.ability==='burst'?'#fa5542':b.owner===0?'#388bbd':'#da6862';ctx.fillText(b.text,0,P.shapeFor(b.text).centerOffsetY);ctx.restore();
  }
 }}
function drawDrag(){const d=st.drag;if(!d||!d.body||!d.body.alive)return;const length=Math.hypot(d.dx,d.dy);if(length<3)return;
 const x=d.body.x,y=d.body.y,dx=d.dx/length,dy=d.dy/length,drawLen=Math.min(160,28+length*.9),endx=x+dx*drawLen,endy=y+dy*drawLen;
 ctx.save();ctx.shadowColor='#ffffffb0';ctx.shadowBlur=9;ctx.lineCap='round';ctx.strokeStyle=st.turn===0?'#2887c6':'#d14e4c';ctx.lineWidth=5+4*d.power;
 ctx.beginPath();ctx.moveTo(x+dx*37,y+dy*37);ctx.lineTo(endx,endy);ctx.stroke();
 ctx.fillStyle=st.turn===0?'#2580bd':'#cb4e4b';ctx.beginPath();ctx.moveTo(endx+dx*19,endy+dy*19);ctx.lineTo(endx-dy*13-dx*6,endy+dx*13-dy*6);ctx.lineTo(endx+dy*13-dx*6,endy-dx*13-dy*6);ctx.closePath();ctx.fill();
 // No line back to the finger: display only the shot direction arrow.
 if(d.body.ability==='shock'&&!st.world.preparation){
  const px=clamp(x+dx*P.PIECE_UNIT*P.SHOCK_JUMP_PIECES,d.body.w*.65,W-d.body.w*.65);
  const py=clamp(y+dy*P.PIECE_UNIT*P.SHOCK_JUMP_PIECES,d.body.h*.65,H-d.body.h*.65);
  ctx.setLineDash([7,5]);ctx.shadowBlur=0;ctx.lineWidth=3;
  ctx.strokeStyle='#2caac8';ctx.fillStyle='#57d9ee1f';
  ctx.beginPath();ctx.arc(px,py,P.PIECE_UNIT*P.SHOCK_RADIUS_PIECES,0,TAU);ctx.fill();ctx.stroke();
  ctx.setLineDash([]);ctx.font='900 14px sans-serif';ctx.textAlign='center';
  ctx.fillStyle='#15718f';ctx.fillText('着地予測・2コマ先',px,clamp(py-P.PIECE_UNIT*P.SHOCK_RADIUS_PIECES-10,18,H-20));
 }
 ctx.restore();
 ctx.textAlign='center';ctx.fillStyle='#293747ed';ctx.font='950 16px system-ui';
 ctx.fillText(Math.round(d.power*100)+'% · 回転 '+Math.round((d.spinStrength||0)*100)+'%',clamp(x,100,W-100),clamp(y-62,34,H-30));
}
function drawOverlays(){
 // A single expanding cyan pressure front, tied exactly to the physics wave.
 for(const wave of st.world.shocks){
  const fade=Math.max(0,1-wave.age/.59),r=wave.radius;
  ctx.save();ctx.globalAlpha=fade;
  const glow=ctx.createRadialGradient(wave.x,wave.y,Math.max(0,r-34),wave.x,wave.y,Math.max(r,1));
  glow.addColorStop(0,'#7cecff00');glow.addColorStop(.6,'#55dbf24b');glow.addColorStop(1,'#f3ffff99');
  ctx.fillStyle=glow;ctx.beginPath();ctx.arc(wave.x,wave.y,r,0,TAU);ctx.fill();
  for(const [offset,lineW,alpha] of [[0,8,.96],[-14,3,.53],[-29,2,.23]]){
   ctx.globalAlpha=fade*alpha;ctx.strokeStyle='#b7fbff';ctx.lineWidth=lineW;
   ctx.beginPath();ctx.arc(wave.x,wave.y,Math.max(0,r+offset),0,TAU);ctx.stroke();
  }
  ctx.restore();
 }
 for(const e of st.fx){const alpha=Math.max(0,1-e.t/e.life);ctx.save();ctx.globalAlpha=alpha;
  if(e.type==='spark'){ctx.fillStyle=e.color;ctx.translate(e.x,e.y);ctx.rotate(e.t*8);ctx.fillRect(-e.r/2,-e.r/2,e.r*2.5,e.r*.9)}
  if(e.type==='ring'){ctx.lineWidth=6*(1-alpha)+1;ctx.strokeStyle=e.color;ctx.beginPath();ctx.arc(e.x,e.y,e.max*(e.t/e.life),0,TAU);ctx.stroke()}
  ctx.restore();
 }
 for(const t of st.texts){const alpha=Math.max(0,1-t.t/t.life);ctx.save();ctx.globalAlpha=alpha;ctx.textAlign='center';ctx.font='1000 33px "Noto Sans CJK JP",sans-serif';ctx.lineWidth=7;ctx.lineJoin='round';ctx.strokeStyle='#242731';ctx.strokeText(t.str,clamp(t.x,110,W-110),clamp(t.y-t.t*75,50,H-35));ctx.fillStyle=t.color;ctx.fillText(t.str,clamp(t.x,110,W-110),clamp(t.y-t.t*75,50,H-35));ctx.restore()}
}
function paint(dt){if(!st.world||st.scene!=='game')return;
 ctx.setTransform($('board').width/W,0,0,$('board').height/H,0,0);ctx.clearRect(0,0,W,H);
 ctx.save();if(st.shake>.1)ctx.translate((Math.random()-.5)*st.shake*1.2,(Math.random()-.5)*st.shake*1.2);
 ctx.drawImage(artCanvas,0,0,W,H);
 drawArenaGeometry();drawFields();drawVortices();drawTrails(dt);
 for(const b of st.world.bodies)if(b.alive){drawPiece(b)}
 drawDrag();drawOverlays();
 if(st.flash>0){ctx.fillStyle=`rgba(255,250,214,${st.flash*.48})`;ctx.fillRect(0,0,W,H)}
 ctx.restore();
}
function mainLoop(ts){let dt=animLast?Math.min(.06,(ts-animLast)/1000):.016;animLast=ts;st.time+=dt;
 if(st.scene==='game'){if(st.phase==='moving')tickPhysics(dt);renderFx(dt);paint(dt)}
 rafId=requestAnimationFrame(mainLoop)
}
// Wiring
$('soloBtn').addEventListener('click',()=>{initAudio();sound('tap');setup('solo')});
$('localBtn').addEventListener('click',()=>{initAudio();sound('tap');setup('local')});
$('setupBack').addEventListener('click',()=>{cancelAsync();changeScene('home')});
$('confirmBack').addEventListener('click',()=>{st.phase='setup';changeScene('setup')});
$('toConfirmBtn').addEventListener('click',()=>{initAudio();sound('tap');confirm()});
$('startMatchBtn').addEventListener('click',roulette);
for(const b of $('difficultyOptions').querySelectorAll('button'))b.addEventListener('click',()=>{st.diff=b.dataset.diff;updateModeUI();save();sound('tap')});
$('name0').addEventListener('change',readSetup);$('name1').addEventListener('change',readSetup);
$('spinRight').addEventListener('click',()=>{st.spin=1;$('spinRight').classList.add('active');$('spinLeft').classList.remove('active');sound('tap')});
$('spinLeft').addEventListener('click',()=>{st.spin=-1;$('spinLeft').classList.add('active');$('spinRight').classList.remove('active');sound('tap')});
// Use the entire game scene as an aim surface, not only the canvas.
// Capturing at scene level preserves the drag if a finger crosses its edge.
window.addEventListener('pointerdown',secondFingerCancel,{capture:true,passive:false});
$('gameScene').addEventListener('pointerdown',pointerDown);
$('gameScene').addEventListener('pointermove',pointerMove);
$('gameScene').addEventListener('pointerup',pointerUp);
$('gameScene').addEventListener('pointercancel',pointerCancel);
$('gameScene').addEventListener('lostpointercapture',e=>{if(st.drag&&e.pointerId===st.drag.pointer)pointerCancel(e)});
$('quitBtn').addEventListener('click',()=>{onModal(`<p><b>対戦を終了しますか？</b></p><p>この対戦の進行状況は保存されません。</p><button type="button" class="ghost-btn" id="endMatch">対戦を終了してタイトルへ戻る</button>`,'対戦を終了');$('endMatch').addEventListener('click',()=>{cancelAsync();st.phase='title';changeScene('home')})});
$('rematchBtn').addEventListener('click',()=>{const bits=new Uint32Array(1);try{crypto.getRandomValues(bits)}catch(e){bits[0]=Math.floor(Math.random()*2)};startMatch(bits[0]%2)});
$('resultHomeBtn').addEventListener('click',()=>{cancelAsync();st.phase='title';changeScene('home')});
function abilityManualHTML(){
 const explanation='<div class="ability-definition"><b>攻撃</b>：コマ同士の物理的な接触で飛ばすこと。暴走の追尾中にぶつかる場合も攻撃です。'+
  '<br><b>能力</b>：漢字の効果で直接動かすこと。衝撃波・渦巻は能力に分類されます。'+
  '<br><b>鉄壁</b>は攻撃だけを軽減し、能力には<b>倍率×1.0</b>で通常どおり影響されます。'+
  '<br><b>連鎖</b>：能力で動いたコマが別のコマにぶつかった場合、その二次衝突は攻撃です。</div>';
 const rows=P.ABILITY_RULES.map(a=>`<tr><th scope="row">${a.word}<small>${a.kind}</small></th><td><b>${a.numbers}</b><br><span>${a.timing}</span></td></tr>`).join('');
 return explanation+`<div class="ability-scroll"><table class="ability-table"><thead><tr><th>熟語／分類</th><th>効果・倍率と発動条件</th></tr></thead><tbody>${rows}</tbody></table></div>`+
 `<p class="ability-extra"><b>共通：</b>通常コマの最大発射速度は ${P.FULL_SHOT_SPEED}。角当てクリティカルは物理攻撃×1.2。衝撃の「100%」は単独・等質量の正面衝突を基準とするため、実際の移動量は質量・角度・他コマとの接触で変わります。</p>`+
 '<p class="ability-extra"><b>操作：</b>漢字をタップして選択 → 好きな場所から逆方向へドラッグ → 指を離して発射。引き始めが漢字から遠いほど回転が強くなります。ドラッグ中は別の指でタップしてキャンセルできます。</p>'+
 '<p class="ability-extra"><b>準備・終盤：</b>初めの合計2ターンは場外・中央封鎖で熟語能力OFF（合体は可能）。最後の未合体1文字は覚醒。双方残り1コマではサドンデスが始まり、1ターンごとに4方向の場外幅が1コマ広がります。</p>';
}
function openAbilityManual(){onModal(abilityManualHTML(),'熟語能力・倍率一覧')}
$('helpBtn').addEventListener('click',openAbilityManual);
$('abilityHomeBtn').addEventListener('click',openAbilityManual);
// The same comparison table is available while choosing each three-word deck.
$('abilitySetup').innerHTML=abilityManualHTML();
$('modalClose').addEventListener('click',closeModal);$('modalOK').addEventListener('click',closeModal);$('modal').addEventListener('click',e=>{if(e.target===$('modal'))closeModal()});
$('soundBtn').addEventListener('click',()=>{st.sound=!st.sound;$('soundBtn').classList.toggle('muted',!st.sound);$('soundBtn').textContent=st.sound?'♪':'×';if(st.sound){initAudio();sound('tap')}save()});
$('soundBtn').classList.toggle('muted',!st.sound);$('soundBtn').textContent=st.sound?'♪':'×';
window.addEventListener('resize',()=>{if(st.scene==='game')resizeCanvas()});
window.addEventListener('keydown',e=>{if(e.key==='Escape'){closeModal();return}if(e.code==='Space'&&st.scene==='game'&&st.drag&&st.drag.body&&st.drag.power>.06){e.preventDefault();const d=st.drag;fireShot(d.body,d.dx,d.dy,d.power,st.spin,d.spinStrength??1)}});
// Extra hook for deterministic and automated smoke tests; only exposed when ?test=1.
if(new URLSearchParams(location.search).has('test'))window.__KANJI_TEST__={st,P,setup,confirm,startMatch,fireShot,finishGame,finishShot,beginTurn,selectPiece,aimSpinAt,draw:()=>paint(.016),cpuTakeTurn,resizeCanvas,tickPhysics,collisionHooks};
makeBoardArt();requestAnimationFrame(mainLoop);
})();

/* 漢字おはじき Ver.2.4 | ASOBEAT — live-authoritative online sync */
(function(){'use strict';
const P=window.KanjiPhysics;if(!P){document.body.textContent='物理エンジンを読み込めませんでした。';return;}
const WORDS=Object.keys(P.WORDS),DESCRIPTIONS={'暴走':'停止後1秒・敵を自動追尾','烈風':'引く強さで0.5〜3コマジャンプ・着地後に衝撃波','鉄壁':'ぶつかる攻撃を軽減（能力は普通に受ける）','渦巻':'停止後、半径約3.8コマ内の敵を2.3秒で2周','巨大':'命中で1.2倍巨大化（最大3回）','一撃':'最初の敵だけ3倍！角なら5倍！','分裂':'相手のターンに接触で分裂・1ターン1回','跳弾':'自ターンの壁衝突で加速（操作していなくても発動）','磁力':'停止後、渦巻と同じ範囲の敵だけを2秒間引き寄せ','反射':'敵がぶつかったら、衝撃の約7割を相手に返す'};
const WORD_GROUPS=[
 {name:'アタック型',key:'attack',words:['暴走','一撃','跳弾'],description:'攻めと場外KOを狙う'},
 {name:'ディフェンス型',key:'defense',words:['鉄壁','磁力'],description:'守りながら相手を崩す'},
 {name:'バランス型',key:'balance',words:['烈風','巨大','反射'],description:'攻撃と対応力を両立'},
 {name:'特殊型',key:'special',words:['渦巻','分裂'],description:'相手を翻弄する能力'}
];
function groupFor(word){return WORD_GROUPS.find(g=>g.words.includes(word))||WORD_GROUPS[0]}
function categorizedSelect(select){
 select.textContent='';
 for(const g of WORD_GROUPS){const optgroup=document.createElement('optgroup');optgroup.label=g.name;
  for(const word of g.words){if(!WORDS.includes(word))continue;
   const opt=document.createElement('option');opt.value=word;opt.textContent=word;optgroup.appendChild(opt);}
  select.appendChild(optgroup);
 }
}
function groupLabel(word){const g=groupFor(word);const b=document.createElement('span');b.className='word-type type-'+g.key;b.textContent=g.name;return b}
function updateGroupLabel(el,word){const g=groupFor(word);el.className='word-type type-'+g.key;el.textContent=g.name;}
const $=id=>document.getElementById(id),ctx=$('board').getContext('2d',{alpha:true});
const {W,H}=P,PI=Math.PI,TAU=PI*2,clamp=P.clamp;
const scenes=['home','streak','match','onlineDeck','setup','confirm','game','result'];
const st={scene:'home',mode:'solo',diff:'normal',decks:[['暴走','烈風','鉄壁'],['烈風','鉄壁','暴走']],names:['青チーム','CPU'],world:null,phase:'title',turn:0,spin:1,drag:null,selected:null,fx:[],texts:[],bannerUntil:0,shake:0,flash:0,hitstop:0,time:0,acc:0,moving:0,still:0,shotCount:0,stats:{outs:[0,0],merges:[0,0],crits:[0,0],awakens:[0,0]},vortexPlayed:false,magnetPlayed:false,turnToken:0,sound:true,result:null,geom:null,streakWins:0,streakWord:'暴走',streakNextWord:null};
let audio=null,noiseBuffer=null,animLast=0,rafId=0;let timers=[];
let phaseNoticeTimer=null,infoTimer=null,holdPiece=null,suppressAimUp=null;
const online={active:false,role:null,uid:null,slot:null,round:0,seq:-1,seenMoveId:null,ownShotId:null,starting:false,revealing:false,publishing:false,resetting:false,committed:false,rematch:false,gameReady:false,pendingRoom:null,lastError:'',frameStep:0,frameSentAt:0,frameBusy:false,lastFrameStep:0,lastFrameId:null,shotSeq:-1,frameWarningAt:0,remoteBlend:null};
let onlineDeck=['暴走','烈風','鉄壁'];
try{let prior=JSON.parse(localStorage.getItem('asobeat_kanji_online_deck')||'null');if(Array.isArray(prior)&&prior.length===3&&prior.every(w=>WORDS.includes(w)||(w==='衝撃'||w==='爆風'||w==='暴風')))onlineDeck=prior.map(w=>(w==='衝撃'||w==='爆風'||w==='暴風')?'烈風':w)}catch{}

function later(fn,ms){const token=st.turnToken;const id=setTimeout(()=>{timers=timers.filter(x=>x!==id);if(token===st.turnToken)fn()},ms);timers.push(id);return id}
function cancelAsync(){st.turnToken++;for(const id of timers)clearTimeout(id);timers=[];
 if(phaseNoticeTimer){clearTimeout(phaseNoticeTimer);phaseNoticeTimer=null;}
 if(infoTimer){clearTimeout(infoTimer);infoTimer=null;}
 if(holdPiece?.timer)clearTimeout(holdPiece.timer);
 holdPiece=null;suppressAimUp=null;
 $('phaseAnnouncement')?.classList.add('hidden');$('pieceInfo')?.classList.add('hidden');
}
function flashPhaseAnnouncement(message,duration=500,kind=''){
 const el=$('phaseAnnouncement');if(phaseNoticeTimer)clearTimeout(phaseNoticeTimer);
 el.textContent=message;el.className='phase-announcement '+kind;
 phaseNoticeTimer=setTimeout(()=>{el.classList.add('hidden');phaseNoticeTimer=null;},duration);
}
function closePieceInfo(){if(infoTimer)clearTimeout(infoTimer);infoTimer=null;$('pieceInfo').classList.add('hidden');}
function showPieceInfo(b){
 if(!b?.alive)return;
 const rule=P.ABILITY_RULES.find(a=>a.word===b.word);
 const side=b.owner===0?'青':'赤';
 $('pieceInfoTitle').textContent=`${side}チーム｜${b.text}${b.merged?'':'（未合体）'}`;
 $('pieceInfoBody').textContent=b.merged
  ? `${rule?.kind||'特殊能力'}：${rule?.timing||''}\n${rule?.numbers||''}`
  : `「${b.word}」の漢字コマです。もう片方の漢字とぶつけると「${b.word}」に合体します。\n合体後：${rule?.kind||''}。${rule?.timing||''}`;
 $('pieceInfo').classList.remove('hidden');
 if(infoTimer)clearTimeout(infoTimer);
 infoTimer=setTimeout(closePieceInfo,6500);
}
function findInspectable(pos){if(!st.world)return null;let closest=null,dist=Infinity;
 for(const b of st.world.bodies){if(!b.alive)continue;
  const d=Math.hypot(b.x-pos.x,b.y-pos.y),allowed=Math.max(b.w,b.h)*.68+16;
  if(d<allowed&&d<dist){closest=b;dist=d;}
 }return closest;
}
function cancelHold(){if(holdPiece?.timer)clearTimeout(holdPiece.timer);holdPiece=null;}
function scheduleHold(e,b,pos){cancelHold();if(!b)return;
 const id=e.pointerId;holdPiece={pointer:id,start:pos,timer:setTimeout(()=>{
  if(holdPiece?.pointer!==id||st.scene!=='game')return;
  holdPiece=null;suppressAimUp=id;
  if(st.drag&&!st.drag.cpu&&st.drag.pointer===id){st.drag=null;try{if($('gameScene').hasPointerCapture(id))$('gameScene').releasePointerCapture(id)}catch(e){}}
  showPieceInfo(b);
 },580)};
}
function safeLoad(){try{return JSON.parse(localStorage.getItem('asobeat_kanji_v10')||'{}')}catch(e){return {}}}
function save(){try{localStorage.setItem('asobeat_kanji_v10',JSON.stringify({names:st.names,decks:st.decks,diff:st.diff,sound:st.sound}))}catch(e){}}
const saved=safeLoad();if(Array.isArray(saved.names)&&saved.names.length===2)st.names=saved.names.map(x=>String(x||'').slice(0,10));
if(Array.isArray(saved.decks)&&saved.decks.length===2)for(let i=0;i<2;i++)if(Array.isArray(saved.decks[i])&&saved.decks[i].length===3&&saved.decks[i].every(w=>WORDS.includes(w)||(w==='衝撃'||w==='爆風'||w==='暴風')))st.decks[i]=saved.decks[i].map(w=>(w==='衝撃'||w==='爆風'||w==='暴風')?'烈風':w);
if(['easy','normal','hard'].includes(saved.diff))st.diff=saved.diff;
if(typeof saved.sound==='boolean')st.sound=saved.sound;
function changeScene(scene){st.scene=scene;for(const id of scenes)$(id+'Scene').classList.toggle('hidden',id!==scene);$('roulette').classList.add('hidden');$('modal').classList.add('hidden');window.scrollTo?.(0,0)}
function escName(n,def){return String(n||'').trim().slice(0,10)||def}
function initDecks(){for(let player=0;player<2;player++){
 const host=$('deck'+player);host.textContent='';for(let idx=0;idx<3;idx++){
  const wrap=document.createElement('div');wrap.className='deck-slot';
  const span=document.createElement('span');span.className='slot-heading';span.textContent='SLOT 0'+(idx+1);
  const select=document.createElement('select');select.setAttribute('aria-label',`${player===0?'青':'赤'}の熟語${idx+1}`);
  categorizedSelect(select)
  select.value=st.decks[player][idx];select.addEventListener('change',()=>{st.decks[player][idx]=select.value;hint.textContent=DESCRIPTIONS[select.value];save()});
  const hint=document.createElement('div');hint.className='slot-effect';hint.textContent=DESCRIPTIONS[select.value];
  const type=groupLabel(select.value);select.addEventListener('change',()=>updateGroupLabel(type,select.value));
  wrap.append(span,type,select,hint);host.appendChild(wrap);
 }
}}
function initPracticeCategories(){
 for(const id of ['practiceWord','practiceOpponentWord']){
  const select=$(id);const current=select.value;
  categorizedSelect(select);select.value=WORDS.includes(current)?current:'暴走';
 }
}
let streakSelected='暴走';
function cpuStreakWord(){
 const pool=[...WORD_GROUPS[0].words,...WORD_GROUPS[2].words];
 const options=pool.filter(w=>w!==st.streakNextWord);
 return (options.length?options:pool)[Math.floor(Math.random()*(options.length||pool.length))];
}
function buildStreakSelection(){const host=$('streakWordList');host.textContent='';
 for(const group of WORD_GROUPS){
  const section=document.createElement('section');section.className='streak-word-group';
  const heading=document.createElement('div');heading.className='streak-group-heading';
  heading.append(groupLabel(group.words[0]),document.createTextNode(group.description));section.appendChild(heading);
  const choices=document.createElement('div');choices.className='streak-word-options';
  for(const word of group.words){const btn=document.createElement('button');btn.type='button';btn.className='streak-word-button';btn.dataset.word=word;
   btn.textContent=word;btn.setAttribute('aria-pressed',String(streakSelected===word));
   btn.classList.toggle('chosen',streakSelected===word);
   btn.addEventListener('click',()=>{streakSelected=word;for(const b of host.querySelectorAll('[data-word]')){
    const active=b.dataset.word===word;b.classList.toggle('chosen',active);b.setAttribute('aria-pressed',String(active));}
    $('streakWordInfo').textContent=word+'｜'+DESCRIPTIONS[word];sound('tap');});choices.appendChild(btn);
  }section.appendChild(choices);host.appendChild(section);
 }
 $('streakWordInfo').textContent=streakSelected+'｜'+DESCRIPTIONS[streakSelected];
}
function showStreakSetup(){cancelAsync();st.mode='streak';st.phase='setup';buildStreakSelection();changeScene('streak');}
function restoreStreakPrefs(){if(st._streakBackup){st.diff=st._streakBackup.diff;st.decks=st._streakBackup.decks;st.names=st._streakBackup.names;st._streakBackup=null;}}
function resetStreakInteraction(){
 // Clear stale gesture state before reusing the same canvas for a new round.
 const activePointer=st.drag&&!st.drag.cpu?st.drag.pointer:null;
 if(activePointer!==null&&activePointer!==undefined){
  try{if($('gameScene').hasPointerCapture(activePointer))$('gameScene').releasePointerCapture(activePointer)}catch(e){}
 }
 cancelHold();suppressAimUp=null;
 st.selected=null;st.drag=null;st.cancelUntil=0;
 $('aimHint').classList.add('hidden');closePieceInfo();
}
function startStreak(){
 resetStreakInteraction();cancelAsync();if(!st._streakBackup)st._streakBackup={diff:st.diff,decks:st.decks.map(d=>[...d]),names:[...st.names]};
 st.mode='streak';st.phase='playing';st.streakWins=0;st.streakWord=streakSelected;st.streakNextWord=null;
 st.names=['あなた','CPU'];st.decks=[[streakSelected],['暴走']];st.world=P.newWorld();P.setStreakArena(st.world);
 st.world.bodies=[P.body({x:W/2,y:H-178,word:streakSelected,text:streakSelected,owner:0,merged:true})];
 st.turn=0;st.shotCount=0;st.spin=1;st.acc=0;st.moving=0;st.still=0;st.selected=null;st.drag=null;st.cancelUntil=0;
 st.fx=[];st.texts=[];st.flash=0;st.shake=0;st.hitstop=0;st.vortexPlayed=false;st.magnetPlayed=false;
 st.stats=freshStats();st._impactTimes=new Map();st.result=null;st._streakPlayerOut=false;st._streakFirstOut=null;
 spawnStreakCpu();
 $('streakShareBtn').classList.add('hidden');$('spinRight').classList.add('active');$('spinLeft').classList.remove('active');
 $('effectBanner').classList.add('hidden');$('suddenOverlay').classList.add('hidden');$('streakCounter').classList.remove('hidden');
 $('gameScene').classList.add('corner-ko');
 changeScene('game');resizeCanvas();beginTurn();
}
function spawnStreakCpu(){
 const world=st.world;
 world.bodies=world.bodies.filter(b=>b.alive&&b.owner===0);
 // If BOTH fell in the preceding shot but the CPU crossed the line first,
 // the round counts as a win. Reissue the player's original kanji for the next bout.
 if(!world.bodies.length){world.bodies.push(P.body({x:W/2,y:H-178,word:st.streakWord,text:st.streakWord,owner:0,merged:true}));}
 const word=cpuStreakWord();st.streakNextWord=word;st.decks[1]=[word];
 const existing=world.bodies.find(b=>b.alive&&b.owner===0);
 const spots=[{x:W/2,y:168},{x:160,y:168},{x:380,y:168},{x:W/2,y:124}];
 const spot=spots.find(p=>!existing||Math.hypot(p.x-existing.x,p.y-existing.y)>Math.max(160,existing.radius+90))||spots[0];
 world.bodies.push(P.body({x:spot.x,y:spot.y,word,text:word,owner:1,merged:true}));
 P.settle(world);world.fields=[];world.shocks=[];world.vortices=[];world.magnets=[];world.shooterId=null;
 // Clear every round-local flag: without this, the next shot can be treated
 // as a continuation of the defeated round and become unselectable.
 st._streakPlayerOut=false;st._streakFirstOut=null;resetStreakInteraction();
}
function streakDefeated(){
 $('streakCounter').classList.add('hidden');finishGame(1);
}
function streakWin(){
 if(st.phase==='streakAdvance'||st.phase==='result')return;
 st.streakWins++;st.phase='streakAdvance';resetStreakInteraction();
 $('streakCounter').textContent=st.streakWins+'連勝中';
 $('streakCounter').classList.add('streak-announce');$('streakCounter').classList.remove('hidden');
 st.world.fields=[];P.settle(st.world);updateHud();sound('win');
 later(()=>{
  if(st.mode!=='streak'||st.phase!=='streakAdvance')return;
  $('streakCounter').classList.remove('streak-announce');spawnStreakCpu();st.turn=0;
  st.vortexPlayed=false;st.magnetPlayed=false;st.acc=0;st.moving=0;st.still=0;st.hitstop=0;
  beginTurn();
  // One more safety check for the original lost-control bug.
  if(st.mode==='streak'&&st.phase==='playing'&&!st.world.bodies.some(b=>b.alive&&b.owner===0)){
   st.world.bodies.push(P.body({x:W/2,y:H-178,word:st.streakWord,text:st.streakWord,owner:0,merged:true}));updateHud();
  }
 },2000);
}
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
function onModal(content,title='遊びかた',quit=false){
 $('modalTitle').textContent=title;
 $('modalEyebrow').textContent=quit?'GAME MENU':'HOW TO PLAY';
 if(content!==undefined)$('modalContent').innerHTML=content;
 $('modalOK').textContent=st.scene==='game'?'対戦へ戻る':'閉じる';
 $('modalEndMatch').classList.toggle('hidden',!quit);
 $('modal').classList.remove('hidden');
}
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
function roulette(fixedFirst=null,after=null){
 cancelAsync();initAudio();const bits=new Uint32Array(1);
 try{crypto.getRandomValues(bits)}catch(e){bits[0]=(Math.random()*4294967296)>>>0}
 const sector=fixedFirst===null?bits[0]%4:((bits[0]%2)*2+fixedFirst),first=sector%2;
 st.phase=after?'onlineRoulette':'roulette';$('roulette').classList.remove('hidden');
 $('rouletteText').textContent='先攻を決定中…';
 const wheel=$('rouletteWheel');wheel.style.transition='none';wheel.style.transform='rotate(0deg)';
 // Each of the four colored sectors has exactly 1/4 probability.
 requestAnimationFrame(()=>requestAnimationFrame(()=>{
  wheel.style.transition='transform 2.15s cubic-bezier(.16,.76,.14,1)';
  wheel.style.transform=`rotate(${360*6-sector*90}deg)`;
 }));
 for(let i=0;i<10;i++)later(()=>sound('tap'),i*190);
 later(()=>{$('rouletteText').textContent=(first===0?'🔵 青':'🔴 赤')+'が先攻！';sound('merge')},2240);
 later(()=>after?after():startMatch(first),3000);
}

function makeNames(){for(let i=0;i<2;i++)$('gameName'+i).textContent=st.names[i]}
function startMatch(first=null){cancelAsync();st.world=P.newWorld();P.spawnInitial(st.world,st.decks);st.drag=null;st.selected=null;st.fx=[];st.texts=[];st.phase='playing';st.turn=first===null?st.turn:first;st.spin=1;st.hitstop=0;st.shake=0;st.flash=0;st.time=0;st.acc=0;st.moving=0;st.still=0;st.shotCount=0;st.vortexPlayed=false;st.magnetPlayed=false;st.cancelUntil=0;st.result=null;st.stats={outs:[0,0],merges:[0,0],crits:[0,0],awakens:[0,0]};st._impactTimes=new Map();
 $('spinRight').classList.add('active');$('spinLeft').classList.remove('active');makeNames();
 $('streakCounter').classList.add('hidden');$('streakShareBtn').classList.add('hidden');
 $('suddenOverlay').classList.add('hidden');$('suddenOverlay').setAttribute('aria-hidden','true');
 $('effectBanner').classList.add('hidden');$('toast').classList.add('hidden');
 $('fieldStatus').className='field-status hidden';st.bannerUntil=0;
 $('gameScene').classList.remove('corner-ko');
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
 if(st.mode==='streak'){$('streakCounter').textContent=st.streakWins+'連勝中';$('streakCounter').classList.remove('hidden');$('streakCounter').classList.remove('streak-announce');}
 $('phaseText').textContent=st.world.preparation?'':(st.world.suddenDeath?'サドンデス':(st.mode==='solo'||st.mode==='streak')&&st.turn===1?'CPU思考中…':'漢字を弾こう');
 $('selectedLabel').textContent=(st.mode==='solo'||st.mode==='streak')&&st.turn===1?'CPUが狙っています…':'① 漢字をタップして選択';
 $('hintLabel').textContent='② 好きな位置からドラッグ／2本指タップで中止';
 $('aimHint').classList.add('hidden');$('spinMeter').textContent='回転力 --';updateFieldStatus();
 const cpu=(st.mode==='solo'||st.mode==='streak')&&st.turn===1;
 const remote=st.mode==='online'&&st.turn!==online.slot;
 if(remote){$('phaseText').textContent='相手の操作を待っています';$('selectedLabel').textContent='相手のターン';$('hintLabel').textContent='相手が発射するまで待ちましょう';}
 if(st.mode==='streak'&&st.turn===0){
  // Match normal play: the player must tap their kanji, then drag to fire.
  // Never carry a selected body into a rematch or the next winning round.
  st.selected=null;st.drag=null;
  $('selectedLabel').textContent='';
  $('hintLabel').textContent='自分の漢字をタップして選択 → ドラッグで発射';
 }
 for(const id of ['spinRight','spinLeft'])$(id).disabled=cpu||remote;
 updateHud();
 // Preparation is announced once for exactly 1 s, then only a half-second
 // blue/red notice appears after every completed turn (also on both clients).
 if(st.world.preparation&&st.shotCount===0)flashPhaseAnnouncement('準備フェーズ',1000,'prep');
 else if(st.shotCount>0)flashPhaseAnnouncement(st.turn===0?'青のターン':'赤のターン',500,st.turn===0?'blue':'red');
 if(cpu)later(cpuTakeTurn,st.world.preparation&&st.shotCount===0?1150:550);
}
function fireShot(b,dirX,dirY,power,spin,spinStrength=1,fromNetwork=false){
 if(st.mode==='online'&&!fromNetwork){
  if(st.phase!=='playing'||!b||!b.alive||b.owner!==online.slot||st.turn!==online.slot)return false;
  if(!window.KanjiOnline){showNetworkStatus('Firebaseの読み込みを確認してください','error');return false;}
  const len=Math.hypot(dirX,dirY);if(len<.01||power<.06)return false;
  const move={bodyId:b.id,dx:dirX/len,dy:dirY/len,power,spin,spinStrength};
  st.phase='sending';showNetworkStatus('発射情報を相手へ送っています…','pending');
  window.KanjiOnline.sendShot(move).then(shot=>{
   if(st.mode!=='online'||!online.active)return;
   online.ownShotId=shot.id;online.seenMoveId=shot.id;
   st.phase='playing';online.shotSeq=shot.seq;online.frameStep=0;online.frameSentAt=0;online.frameBusy=false;fireShot(b,move.dx,move.dy,power,spin,spinStrength,true);
  }).catch(e=>{st.phase='playing';const msg=networkError(e);showNetworkStatus(msg,'error');toast(msg)});
  return true;
 }
 if(st.phase!=='playing'||!b||!b.alive||b.owner!==st.turn)return false;
 const len=Math.hypot(dirX,dirY);if(len<.01||power<.06)return false;
 P.fire(st.world,b,dirX,dirY,power,spin,spinStrength);
 if(st.mode==='streak'){st._streakPlayerOut=false;st._streakFirstOut=null;}
 st.vortexPlayed=false;st.magnetPlayed=false;st.shotCount++;st.phase='moving';st.moving=0;st.still=0;st.acc=0;st.selected=null;st.drag=null;
 $('phaseText').textContent='物理演算中…';$('selectedLabel').textContent=b.text+'、発射！';$('hintLabel').textContent='全コマが止まると交代';
 addParticles(b.x,b.y,10,st.turn===0?'#70c5f7':'#f4a29c',1);st.shake=2.6;sound('shoot');$('aimHint').classList.add('hidden');$('spinMeter').textContent='回転力 --';
 if(b.ability==='shock'&&!st.world.preparation)showEffect('烈風：0.5秒ジャンプ → 着地で円形波！',850);
 if(b.ability==='iron'&&!st.world.preparation)showEffect('鉄壁：自ターン終了時に護陣！',900);
 if(b.ability==='vortex'&&!st.world.preparation)showEffect('渦巻：停止後、近くの敵を2周巻き込む！',850);
 if(b.ability==='giant'&&!st.world.preparation)showEffect('巨大：敵への命中で巨大化！',800);
 if(b.ability==='strike'&&!st.world.preparation)showEffect('一撃：最初の敵だけ3倍・角なら5倍！',850);
 if(b.ability==='split'&&!st.world.preparation)showEffect('分裂：相手のターンに接触すると発動！',850);
 if(b.ability==='ricochet'&&!st.world.preparation)showEffect('跳弾：自分のターンに壁で加速！',850);
 if(b.ability==='magnet'&&!st.world.preparation)showEffect('磁力：停止後、敵だけを引き寄せ！',850);
 if(b.ability==='reflect'&&!st.world.preparation)showEffect('反射：ぶつかってきた相手へ衝撃を跳ね返す！',850);
 return true;
}
function collisionHooks(){return {
 wallBoost:({piece,p})=>{addParticles(p.x,p.y,22,'#ffc95c',1.0);showText('跳弾 加速!',piece.x,piece.y,'#ffe6a1');sound('crit');},
 reflect:({shield,intruder,p})=>{addRing(shield.x,shield.y,'#a9f3fd',shield.radius*1.3);showText('反射！ 衝撃を返す',p.x,p.y,'#aefaff');sound('crit');},
 impact:({a,b,p,speed,corner,impulse,skill,firstStrike})=>{
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
    if(shooter.ability==='strike'&&firstStrike&&!corner){
     addParticles(p.x,p.y,22,'#ffc064',1.25);showText('一撃 ×3!!',p.x,p.y,'#ffe5a8');st.shake=Math.max(st.shake,7);sound('crit');
    }
  }
  if(corner){
   if(shooter&&a.owner!==b.owner&&!a.static&&!b.static){st.stats.crits[shooter.owner]++;st.hitstop=Math.max(st.hitstop,.05);st.flash=.26;showText(shooter.ability==='strike'&&firstStrike?'CRITICAL ×5!!':'CRITICAL ×1.2!',p.x,p.y,'#fff1a2');sound('crit');}
  }else if(big){sound('impact',speed/300);if(speed>420)st.hitstop=Math.max(st.hitstop,.022)}
 },
 split:(parent,children,point)=>{
  const tier=children[0].splitTier,label=tier===1?'2/3':'1/3';
  addRing(parent.x,parent.y,parent.owner===0?'#63bafb':'#ec7d82',parent.radius*1.5);
  addParticles(parent.x,parent.y,25,parent.owner===0?'#6bcfff':'#ff98a0',1.3);
  st.shake=Math.max(st.shake,4);st.flash=Math.max(st.flash,.16);
  showText('分裂！×2',parent.x,parent.y,'#ffe4a1');
  showEffect(`分裂！ ${label}サイズが2個！`,1000);sound('merge');updateHud();
 },
 merge:(a,b)=>{
  if(st.phase==='result')return;
  const m=P.createMerged(st.world,a,b);st.stats.merges[st.world.lastShooterOwner]++;
  addParticles(m.x,m.y,30,'#e8ae55',1.6);addRing(m.x,m.y,'#eaba65',100);st.shake=4.5;st.flash=.20;st.hitstop=Math.max(st.hitstop,.065);
  showText('『'+m.word+'』合体!!',m.x,m.y,'#fff2b9');showEffect(m.word+' 合体成功！',1050);sound('merge');
 },
 out:b=>{
  if(st.mode==='streak'){
   if(st._streakFirstOut===null)st._streakFirstOut=b.owner;
   if(b.owner===0)st._streakPlayerOut=true;
  }
  st.stats.outs[1-b.owner]++;const pos={x:clamp(b.x,25,W-25),y:clamp(b.y,25,H-25)};
  addParticles(pos.x,pos.y,20,b.owner===0?'#3989c5':'#d35b58',1.3);st.shake=4.8;showText('場外!!',pos.x,pos.y,'#ffe9bb');sound('out');updateHud();
 },
 ability:(b,name)=>{if(name==='burst'){addRing(b.x,b.y,'#e75552',115);addParticles(b.x,b.y,23,'#f67252',1.4);showText('暴走開始!!',b.x,b.y,'#f9a36d');showEffect('暴走加速!!',900);sound('burst')}},
 shockLand:(b,wave)=>{
  if(!wave)return;
  st.shake=5.5;st.hitstop=Math.max(st.hitstop,.05);st.flash=.32;
  addRing(wave.x,wave.y,'#a7ffff',P.PIECE_UNIT);
  addParticles(wave.x,wave.y,20,'#82f4ff',.95);
  showText('烈風着地！',wave.x,wave.y,'#dcffff');showEffect('烈風！ 円の中の全員を外へ吹き飛ばす！',930);sound('shock');
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
 if(st.mode==='streak'&&st._streakFirstOut!==null){
  // The winner is the side whose piece crossed a KO corner SECOND.
  // If the CPU fell first and the player followed, the streak still grows.
  if(st._streakFirstOut===1)streakWin();else streakDefeated();
  return;
 }
 if(st.moving>.58&&P.allStopped(st.world))st.still+=dt;else st.still=0;
 if(st.still>.48||st.moving>12.5){
   const shooter=st.world.bodies.find(b=>b.id===st.world.shooterId&&b.alive);
   if(!st.magnetPlayed&&!st.world.preparation&&shooter?.ability==='magnet'){
    st.magnetPlayed=true;const m=P.startMagnet(st.world,shooter);
    if(m){
     st.still=0;st.moving=0;st.acc=0;
     addRing(shooter.x,shooter.y,'#6adacb',m.range);addParticles(shooter.x,shooter.y,55,'#87ffdb',1.55);st.shake=Math.max(st.shake,5);st.flash=Math.max(st.flash,.20);showText('磁力！ 強力吸引',shooter.x,shooter.y,'#b6ffec');
     showEffect('磁力発動！ 範囲内の敵のみ吸引！',1150);sound('shock');return;
    }
   }
   if(!st.vortexPlayed&&!st.world.preparation&&shooter?.ability==='vortex'){
    st.vortexPlayed=true;
    const v=P.startVortex(st.world,shooter);
    if(v){
     st.still=0;st.moving=0;st.acc=0;
     addRing(shooter.x,shooter.y,'#a875ed',v.range);addParticles(shooter.x,shooter.y,26,'#9c78ef',1.1);
     showEffect('渦巻・近くの敵だけを2.3秒で2周！',1200);sound('shock');return;
    }
   }
   P.settle(st.world);st.acc=0;
   if(st.mode==='online'&&st.turn!==online.slot){st.phase='syncing';showNetworkStatus('相手の確定盤面を受信中…','pending');return;}
   finishShot();
 }

}
function finishShot(){
 if(!st.world||st.phase!=='moving')return;
 const world=st.world,n0=P.remaining(world,0),n1=P.remaining(world,1);
 if(st.mode==='streak'){
  if(n0===0||n1===0){
   // Same-shot double KO obeys the observed KO order, never team priority.
   if(st._streakFirstOut===1||(n1===0&&n0>0))streakWin();else streakDefeated();
   return;
  }
  P.finishTurn(world,st.turn,true);st.turn=1-st.turn;beginTurn();return;
 }
 // Non-streak: simultaneous elimination in the SAME turn is ALWAYS a DRAW.
 if(n0===0||n1===0){finishGame(n0===0&&n1===0?-1:n0===0?1:0);if(st.mode==='online')publishOnlineTurn();return;}
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
 if(!world.preparation&&!world.suddenDeath&&((n0===1&&n1===1)||st.shotCount>=15)){
  $('suddenReason').textContent=n0===1&&n1===1?'両者残り1コマ！ 決着をつけろ！':'16ターン目から開口部が広がる！';
  world.suddenDeath=true;st.phase='sudden';st.selected=null;st.drag=null;
  $('suddenOverlay').classList.remove('hidden');
  $('suddenOverlay').setAttribute('aria-hidden','false');sound('out');
  updateHud();updateFieldStatus();
  if(st.mode==='online')publishOnlineTurn();
  later(()=>{if(st.scene!=='game'||st.phase!=='sudden')return;
   $('suddenOverlay').classList.add('hidden');$('suddenOverlay').setAttribute('aria-hidden','true');beginTurn();},2000);
  return;
 }
 beginTurn();
 if(st.mode==='online')publishOnlineTurn();
}

function updateFieldStatus(){
 const el=$('fieldStatus');if(el){el.className='field-status hidden';el.textContent='';}
}

function finishGame(winner){cancelAsync();st.phase='result';st.result={winner,turns:st.shotCount,stats:JSON.parse(JSON.stringify(st.stats))};
 if(st.mode==='streak'){
  $('streakCounter').classList.add('hidden');st.result.streakWins=st.streakWins;
  $('resultScene').classList.add('streak-result');
  $('resultEyebrow').textContent='';
  $('resultHeadline').textContent='『'+st.streakWord+'』で\n'+st.streakWins+'連勝しました。';
  $('resultHeadline').classList.remove('red');
  $('winnerName').textContent='';
  $('resultDecks').textContent='';
  $('rematchBtn').textContent='もう一度挑戦する ↻';
  const share='漢字おはじき 勝ち抜き戦\n『'+st.streakWord+'』で'+st.streakWins+'連勝しました！\n#漢字おはじき';
  $('streakShareBtn').href='https://twitter.com/intent/tweet?text='+encodeURIComponent(share)+'&url='+encodeURIComponent('https://asobeatapps-ops.github.io/kanji_ohajiki/');
  $('streakShareBtn').classList.remove('hidden');
  changeScene('result');sound('win');return;
 }
 $('resultScene').classList.remove('streak-result');
 $('streakShareBtn').classList.add('hidden');$('rematchBtn').textContent='もう一度戦う ↻';
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
function cpuTakeTurn(){if(!st.world||st.phase!=='playing'||st.turn!==1||(st.mode!=='solo'&&st.mode!=='streak'))return;
 const diff=st.mode==='streak'?'normal':st.diff;
 const own=st.world.bodies.filter(b=>b.alive&&b.owner===1),enemy=st.world.bodies.filter(b=>b.alive&&b.owner===0);
 if(!own.length||!enemy.length){finishGame(own.length?1:enemy.length?0:-1);return}
 const candidates=[];
 for(const src of own){
  const sorted=[...enemy].sort((a,b)=>Math.hypot(a.x-src.x,a.y-src.y)-Math.hypot(b.x-src.x,b.y-src.y));
  const ally=own.filter(x=>x!==src&&!x.merged&&!src.merged&&x.word===src.word&&x.text!==src.text);
  const targets=st.world.preparation?ally.slice(0,2):[...sorted.slice(0,diff==='hard'?3:diff==='normal'?2:1),...ally.slice(0,1)];
  for(const target of targets){
   const base=Math.atan2(target.y-src.y,target.x-src.x);
   const offsets=diff==='easy'?[0,.19,-.19]:diff==='normal'?[0,-.12,.12]:[0,-.13,.13];
   for(const offset of offsets)for(const power of (diff==='hard'?[.7,1]:[.86,1])){
    const angle=base+offset,c={b:src,dx:Math.cos(angle),dy:Math.sin(angle),power,spin:offset>=0?1:-1};
    c.score=P.evaluateShot(st.world,src,{x:c.dx,y:c.dy},power,c.spin);candidates.push(c);
   }
  }
 }
 if(!candidates.length){const b=own[0];fireShot(b,-1,.6,1,1);return}
 candidates.sort((a,b)=>b.score-a.score);
 let choice;
 if(diff==='easy')choice=candidates[Math.min(candidates.length-1,Math.floor(Math.random()*Math.min(9,candidates.length)))];
 else if(diff==='normal')choice=candidates[Math.min(candidates.length-1,Math.floor(Math.random()*Math.min(3,candidates.length)))];
 else choice=candidates[0];
 st.selected=choice.b;
 const imprecision=diff==='easy'?.17:diff==='normal'?.065:.014;
 const a=Math.atan2(choice.dy,choice.dx)+(Math.random()-.5)*imprecision;
 st.drag={cpu:true,body:choice.b,dx:Math.cos(a)*choice.power*140,dy:Math.sin(a)*choice.power*140,power:choice.power,spinStrength:1};
 $('selectedLabel').textContent='CPU：'+choice.b.text+'を狙う';
 later(()=>fireShot(choice.b,Math.cos(a),Math.sin(a),choice.power,choice.spin),650);
}
function boardPoint(evt){const r=$('board').getBoundingClientRect();return{x:(evt.clientX-r.left)*W/r.width,y:(evt.clientY-r.top)*H/r.height}}
function selectable(){return st.scene==='game'&&st.phase==='playing'&&!((st.mode==='solo'||st.mode==='streak')&&st.turn===1)&&!(st.mode==='online'&&st.turn!==online.slot)}
function findSelected(pos){if(!st.world)return null;let best=null,dist=Infinity;
 for(const b of st.world.bodies){if(!b.alive||b.owner!==st.turn)continue;
  const d=Math.hypot(b.x-pos.x,b.y-pos.y),allowed=Math.max(b.w,b.h)*.68+15;
  if(d<allowed&&d<dist){best=b;dist=d}
 }return best;
}
function selectPiece(b){st.selected=b;st.drag=null;
 $('selectedLabel').textContent=''; // selection is shown by brightened kanji, not a text banner
 $('hintLabel').textContent='ドラッグで発射 ／ 長押しで能力を見る';
 $('aimHint').classList.add('hidden');
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
function pointerDown(e){
 if(st.scene!=='game')return;
 if(e.isPrimary===false||e.button!==undefined&&e.button!==0)return;
 if(e.target.closest('button,input,select,a'))return;
 const onCanvas=e.target.id==='board';
 const pos=boardPoint(e),inspect=onCanvas?findInspectable(pos):null;
 closePieceInfo();
 if(onCanvas&&inspect)scheduleHold(e,inspect,pos);else cancelHold();
 if(Date.now()<(st.cancelUntil||0)||!selectable()||st.drag)return;
 const candidate=onCanvas?findSelected(pos):null;
 if(candidate&&candidate!==st.selected){e.preventDefault();initAudio();selectPiece(candidate);return;}
 if(!st.selected)return;
 e.preventDefault();startAim(e,st.selected);
}
function pointerMove(e){
 if(holdPiece?.pointer===e.pointerId){const p=boardPoint(e);if(Math.hypot(p.x-holdPiece.start.x,p.y-holdPiece.start.y)>13)cancelHold();}
 if(!st.drag||st.drag.cpu||e.pointerId!==st.drag.pointer)return;
 e.preventDefault();const pos=boardPoint(e),d=st.drag;
 d.current=pos;d.dx=d.start.x-pos.x;d.dy=d.start.y-pos.y;
 d.power=clamp(Math.hypot(d.dx,d.dy)/142,0,1);
 $('hintLabel').textContent=`発射 ${Math.round(d.power*100)}% ・回転 ${Math.round(d.spinStrength*100)}%`;
}
function pointerUp(e){cancelHold();
 if(suppressAimUp===e.pointerId){suppressAimUp=null;e.preventDefault();return;}
 if(!st.drag||st.drag.cpu||e.pointerId!==st.drag.pointer)return;
 e.preventDefault();pointerMove(e);const d=st.drag;st.drag=null;
 if(Math.hypot(d.dx,d.dy)>13){
  if(!fireShot(d.body,d.dx,d.dy,d.power,st.spin,d.spinStrength)){
   $('hintLabel').textContent='もう少し長く引っ張ってください';
  }
 }else{$('hintLabel').textContent='選択OK！ 好きな場所から大きくドラッグ';}
}
function pointerCancel(e){cancelHold();if(st.drag&&!st.drag.cpu&&(!e||e.pointerId===st.drag.pointer)){
 const pointer=st.drag.pointer;st.drag=null;
 try{if($('gameScene').hasPointerCapture(pointer))$('gameScene').releasePointerCapture(pointer)}catch(err){}
 $('hintLabel').textContent='キャンセルしました。好きな場所から再入力';
}}
function secondFingerCancel(e){
 if(!st.drag||st.drag.cpu||e.pointerType!=='touch'||e.pointerId===st.drag.pointer)return;
 e.preventDefault();cancelHold();st.cancelUntil=Date.now()+400;pointerCancel();
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
function drawArenaGeometry(world=st.world,context=ctx){
 const ctx=context;if(!world)return;
 const prep=world.preparation,gx=prep?0:world.gateX,gy=prep?0:world.gateY;
 ctx.save();
 function segment(x,y,w,h){if(w<=0||h<=0)return;
  const grad=ctx.createLinearGradient(x,y,x+w,y+h);
  grad.addColorStop(0,'#51473d');grad.addColorStop(.55,'#685747');grad.addColorStop(1,'#37322b');
  ctx.fillStyle=grad;ctx.fillRect(x,y,w,h);
  ctx.fillStyle='#fff2ca4d';ctx.fillRect(x+3,y+3,Math.max(0,w-6),Math.max(0,h-6));
 }
 if(world.cornerKnockout){
  // Streak mode: four wide corner exits. Keep the plain wood background;
  // the missing perimeter walls indicate openings. No KO text/colored wedges.
  const s=P.STREAK_CORNER_SIZE;
  segment(s,0,W-2*s,15);segment(s,H-15,W-2*s,15);
  segment(0,s,15,H-2*s);segment(W-15,s,15,H-2*s);
  ctx.restore();return;
 }
 // Match the physical SAT triangles. They exist in ordinary arena modes.
 const s=P.CORNER_SIZE;
 function corner(x,y,flipX,flipY){
  ctx.save();ctx.translate(x,y);ctx.scale(flipX,flipY);
  const g=ctx.createLinearGradient(0,0,s,s);g.addColorStop(0,'#4b3e36');g.addColorStop(1,'#8a7157');
  ctx.fillStyle=g;ctx.beginPath();ctx.moveTo(0,0);ctx.lineTo(s,0);ctx.lineTo(0,s);ctx.closePath();ctx.fill();
  ctx.strokeStyle='#d6b98c';ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(s,0);ctx.lineTo(0,s);ctx.stroke();
  ctx.strokeStyle='#eed6a35c';ctx.lineWidth=1.5;ctx.beginPath();ctx.moveTo(s-11,2);ctx.lineTo(2,s-11);ctx.stroke();ctx.restore();
 }
 const lenX=(W-gx)/2,lenY=(H-gy)/2;
 segment(0,0,lenX,15);segment(W-lenX,0,lenX,15);
 segment(0,H-15,lenX,15);segment(W-lenX,H-15,lenX,15);
 segment(0,0,15,lenY);segment(0,H-lenY,15,lenY);
 segment(W-15,0,15,lenY);segment(W-15,H-lenY,15,lenY);
 corner(0,0,1,1);corner(W,0,-1,1);corner(0,H,1,-1);corner(W,H,-1,-1);
 if(prep){
  ctx.fillStyle='#102a37b0';ctx.fillRect(0,H/2-10,W,20);
  ctx.strokeStyle='#e8cc81';ctx.lineWidth=3;ctx.setLineDash([10,7]);
  ctx.beginPath();ctx.moveTo(20,H/2);ctx.lineTo(W-20,H/2);ctx.stroke();ctx.setLineDash([]);
  ctx.fillStyle='#fff7da';ctx.textAlign='center';ctx.font='900 19px sans-serif';
  ctx.fillText('準 備 フ ェ ー ズ',W/2,H/2-16);
 }else if(!world.practiceSealed){
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
function drawPiece(b,context=ctx,selected=st.selected){const ctx=context;const color=b.owner===0?'#2473ab':'#c7504f',dark=b.owner===0?'#174766':'#782d30';
 const shine=b.owner===0?'#9fddfa':'#ffd2b9';
 ctx.save();ctx.translate(b.x,b.y);
 if(b.jump){const lift=Math.sin(Math.PI*b.jump.age/b.jump.duration)*33;
  ctx.fillStyle='#0e33402a';ctx.beginPath();ctx.ellipse(0,11,Math.max(15,b.w*.40),Math.max(8,b.h*.18),0,0,TAU);ctx.fill();
  ctx.translate(0,-lift);ctx.scale(1+lift*.004,1+lift*.004);
 }
 ctx.rotate(b.angle);const scale=b.scale||1;ctx.scale(scale,scale);
 // Selection is indicated on the glyph itself, not a dotted circle or an
 // always-on outline. Ability range circles appear only while abilities run.
 const shape=P.shapeFor(b.text),font=`1000 ${shape.fontSize}px "Noto Sans CJK JP","Hiragino Kaku Gothic ProN","Yu Gothic",sans-serif`;
 ctx.font=font;ctx.textAlign='center';ctx.textBaseline='middle';ctx.lineJoin='round';ctx.miterLimit=2;
 ctx.shadowColor='#3928215c';ctx.shadowOffsetX=3.5;ctx.shadowOffsetY=6;ctx.shadowBlur=4;ctx.lineWidth=7;ctx.strokeStyle='#f2e6d3';ctx.strokeText(b.text,0,shape.centerOffsetY);ctx.shadowColor='transparent';ctx.shadowOffsetY=0;ctx.shadowOffsetX=0;ctx.shadowBlur=0;
 ctx.lineWidth=5;ctx.strokeStyle=dark;ctx.strokeText(b.text,0,shape.centerOffsetY);
 ctx.lineWidth=2;ctx.strokeStyle=shine;ctx.strokeText(b.text,0,shape.centerOffsetY);
 ctx.fillStyle=selected===b?(b.owner===0?'#c7ecff':'#ffe0d9'):color;
 if(selected===b){ctx.shadowColor='#ffffff';ctx.shadowBlur=17;}
 ctx.fillText(b.text,0,shape.centerOffsetY);ctx.shadowBlur=0;
 if(b.flash>0){ctx.globalAlpha=b.flash*.6;ctx.fillStyle='#fff';ctx.fillText(b.text,0,shape.centerOffsetY)}
 ctx.restore();
 if(b.ability==='split'&&b.splitTier){
  ctx.fillStyle=b.owner===0?'#176e9e':'#ab3948';ctx.font='900 13px sans-serif';ctx.textAlign='center';
  ctx.fillText(b.splitTier===1?'2/3':'1/3',b.x,b.y+b.h*.6+12);
 }
}
function drawFields(world=st.world,context=ctx){const ctx=context;
 for(const f of world.fields){const p=P.fieldPosition(world,f),r=f.radius;
  ctx.save();ctx.beginPath();ctx.arc(p.x,p.y,r,0,TAU);
  const grad=ctx.createRadialGradient(p.x,p.y,9,p.x,p.y,r);
  if(f.owner===0){grad.addColorStop(0,'rgba(64,167,237,.02)');grad.addColorStop(.8,'rgba(47,150,239,.13)');grad.addColorStop(1,'rgba(30,122,222,.24)');}
  else{grad.addColorStop(0,'rgba(255,114,114,.02)');grad.addColorStop(.8,'rgba(245,98,106,.15)');grad.addColorStop(1,'rgba(214,58,71,.24)');}
  ctx.fillStyle=grad;ctx.fill();ctx.strokeStyle=f.owner===0?'#238dda':'#e05261';ctx.lineWidth=4;
  ctx.setLineDash([12,7]);ctx.stroke();ctx.setLineDash([]);ctx.globalAlpha=.48;
  ctx.beginPath();ctx.arc(p.x,p.y,r-9,0,TAU);ctx.lineWidth=1;ctx.stroke();ctx.restore();
 }
}
function drawVortices(world=st.world,context=ctx){const ctx=context;
 for(const v of world.vortices){
  const alpha=1-v.age/v.duration;ctx.save();ctx.translate(v.center.x,v.center.y);
  // Exactly circular ability hit zone, matching the physics selection radius.
  ctx.beginPath();ctx.arc(0,0,v.range,0,TAU);ctx.fillStyle=`rgba(138,85,217,${.05*alpha})`;ctx.fill();
  ctx.strokeStyle=`rgba(138,85,217,${.55*alpha})`;ctx.lineWidth=2;ctx.setLineDash([6,7]);ctx.stroke();ctx.setLineDash([]);
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
function drawMagnets(world=st.world,context=ctx){
 const c=context;
 for(const m of world.magnets){
  const t=clamp(m.age/m.duration,0,1),fade=Math.min(1,(1-t)*4),pulse=.5+.5*Math.sin(m.age*17);
  const range=m.range,x=m.center.x,y=m.center.y;
  c.save();c.translate(x,y);c.globalAlpha=fade;
  // Large, physically honest activation range: visible all 2 seconds.
  const haze=c.createRadialGradient(0,0,12,0,0,range);
  haze.addColorStop(0,'rgba(109,255,221,.30)');haze.addColorStop(.55,'rgba(24,206,186,.10)');haze.addColorStop(1,'rgba(19,208,194,0)');
  c.fillStyle=haze;c.beginPath();c.arc(0,0,range,0,TAU);c.fill();
  for(let k=0;k<3;k++){
   const r=range*(1-((t*2.2+k/3)%1));
   c.strokeStyle=`rgba(62,255,223,${(.36+.22*pulse)*(r/range)})`;
   c.lineWidth=2.5+3*(1-r/range);
   c.shadowColor='#54ffee';c.shadowBlur=11;
   c.beginPath();c.arc(0,0,Math.max(4,r),0,TAU);c.stroke();
  }
  c.shadowBlur=0;
  c.strokeStyle=`rgba(21,181,163,${.7*fade})`;c.lineWidth=3;
  c.setLineDash([10,7]);c.beginPath();c.arc(0,0,range,0,TAU);c.stroke();c.setLineDash([]);
  // Motion streaks flow from every direction *toward* the magnet centre.
  for(let i=0;i<42;i++){
   const a=i*2.399963+m.age*(i%2?1.8:-1.1);
   const r=35+((i*37.6-m.age*190+2000)%(range-35));
   const end=Math.max(16,r-25-13*pulse);
   c.lineWidth=i%4===0?3.2:1.5;
   c.strokeStyle=i%4===0?'rgba(228,255,249,.96)':'rgba(64,245,215,.69)';
   c.beginPath();c.moveTo(Math.cos(a+.25)*r,Math.sin(a+.25)*r);
   c.quadraticCurveTo(Math.cos(a+.12)*(r+end)/2,Math.sin(a+.12)*(r+end)/2,Math.cos(a)*end,Math.sin(a)*end);c.stroke();
   if(i%5===0){c.fillStyle='#e2fff6';c.beginPath();c.arc(Math.cos(a)*end,Math.sin(a)*end,2.8,0,TAU);c.fill()}
  }
  // Tethers track the actual selected enemy targets, not teammates.
  for(const id of m.targets||[]){
   const b=world.bodies.find(p=>p.id===id&&p.alive&&p.owner!==m.owner);
   if(!b)continue;
   const dx=b.x-x,dy=b.y-y,d=Math.hypot(dx,dy)||1;
   c.strokeStyle=`rgba(104,255,222,${.48+.38*pulse})`;c.lineWidth=2.5;
   c.shadowColor='#3cf6d5';c.shadowBlur=6;
   c.setLineDash([7,10]);c.lineDashOffset=-m.age*95;
   c.beginPath();c.moveTo(dx,dy);c.lineTo(dx/d*18,dy/d*18);c.stroke();c.setLineDash([]);
   c.lineDashOffset=0;c.shadowBlur=0;
  }
  // Luminous centre, which remains attached to the magnet piece.
  const core=c.createRadialGradient(0,0,2,0,0,44+8*pulse);
  core.addColorStop(0,'rgba(236,255,248,.78)');core.addColorStop(.35,'rgba(99,255,223,.38)');core.addColorStop(1,'rgba(40,212,190,0)');
  c.fillStyle=core;c.beginPath();c.arc(0,0,52+8*pulse,0,TAU);c.fill();
  c.restore();
 }
}
function drawTrails(dt,world=st.world,context=ctx){const ctx=context;for(const b of world.bodies){if(!b.alive)continue;
  const speed=Math.hypot(b.vx,b.vy);b.trailTime+=dt;
  if(speed>120&&b.trailTime>.045){b.trailTime=0;b.trail.unshift({x:b.x,y:b.y,angle:b.angle,t:0});if(b.trail.length>7)b.trail.pop()}
  for(let i=b.trail.length-1;i>=0;i--){let p=b.trail[i];p.t+=dt;if(p.t>.34){b.trail.splice(i,1);continue}
   ctx.save();ctx.globalAlpha=Math.max(0,(1-p.t/.34)*.23);ctx.translate(p.x,p.y);ctx.rotate(p.angle);
   ctx.font=`1000 ${P.shapeFor(b.text).fontSize}px "Noto Sans CJK JP",sans-serif`;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle=b.ability==='burst'?'#fa5542':b.owner===0?'#388bbd':'#da6862';ctx.fillText(b.text,0,P.shapeFor(b.text).centerOffsetY);ctx.restore();
  }
 }}
function drawDrag(context=ctx,drag=st.drag,turn=st.turn,world=st.world){const ctx=context;const d=drag;if(!d||!d.body||!d.body.alive)return;const length=Math.hypot(d.dx,d.dy);if(length<3)return;
 const x=d.body.x,y=d.body.y,dx=d.dx/length,dy=d.dy/length,drawLen=Math.min(160,28+length*.9),endx=x+dx*drawLen,endy=y+dy*drawLen;
 ctx.save();ctx.shadowColor='#ffffffb0';ctx.shadowBlur=9;ctx.lineCap='round';ctx.strokeStyle=turn===0?'#2887c6':'#d14e4c';ctx.lineWidth=5+4*d.power;
 ctx.beginPath();ctx.moveTo(x+dx*37,y+dy*37);ctx.lineTo(endx,endy);ctx.stroke();
 ctx.fillStyle=turn===0?'#2580bd':'#cb4e4b';ctx.beginPath();ctx.moveTo(endx+dx*19,endy+dy*19);ctx.lineTo(endx-dy*13-dx*6,endy+dx*13-dy*6);ctx.lineTo(endx+dy*13-dx*6,endy-dx*13-dy*6);ctx.closePath();ctx.fill();
 // No line back to the finger: display only the shot direction arrow.
 if(d.body.ability==='shock'&&!world.preparation){
  const landing=P.shockLanding(d.body,dx,dy,d.power);
  const px=landing.x,py=landing.y;
  ctx.setLineDash([7,5]);ctx.shadowBlur=0;ctx.lineWidth=3;
  ctx.strokeStyle='#2caac8';ctx.fillStyle='#57d9ee1f';
  ctx.beginPath();ctx.arc(px,py,P.PIECE_UNIT*P.SHOCK_RADIUS_PIECES,0,TAU);ctx.fill();ctx.stroke();
  ctx.setLineDash([]);ctx.font='900 14px sans-serif';ctx.textAlign='center';
  ctx.fillStyle='#15718f';ctx.fillText(`着地 ${landing.travelPieces.toFixed(1)}コマ先`,px,clamp(py-P.PIECE_UNIT*P.SHOCK_RADIUS_PIECES-10,18,H-20));
 }
 ctx.restore();
 ctx.textAlign='center';ctx.fillStyle='#293747ed';ctx.font='950 16px system-ui';
 ctx.fillText(Math.round(d.power*100)+'% · 回転 '+Math.round((d.spinStrength||0)*100)+'%',clamp(x,100,W-100),clamp(y-62,34,H-30));
}
function drawOverlays(context=ctx,world=st.world,effects=st.fx,texts=st.texts){const ctx=context;
 // A single expanding cyan pressure front, tied exactly to the physics wave.
 for(const wave of world.shocks){
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
 for(const e of effects){const alpha=Math.max(0,1-e.t/e.life);ctx.save();ctx.globalAlpha=alpha;
  if(e.type==='spark'){ctx.fillStyle=e.color;ctx.translate(e.x,e.y);ctx.rotate(e.t*8);ctx.fillRect(-e.r/2,-e.r/2,e.r*2.5,e.r*.9)}
  if(e.type==='ring'){ctx.lineWidth=6*(1-alpha)+1;ctx.strokeStyle=e.color;ctx.beginPath();ctx.arc(e.x,e.y,e.max*(e.t/e.life),0,TAU);ctx.stroke()}
  ctx.restore();
 }
 for(const t of texts){const alpha=Math.max(0,1-t.t/t.life);ctx.save();ctx.globalAlpha=alpha;ctx.textAlign='center';ctx.font='1000 33px "Noto Sans CJK JP",sans-serif';ctx.lineWidth=7;ctx.lineJoin='round';ctx.strokeStyle='#242731';ctx.strokeText(t.str,clamp(t.x,110,W-110),clamp(t.y-t.t*75,50,H-35));ctx.fillStyle=t.color;ctx.fillText(t.str,clamp(t.x,110,W-110),clamp(t.y-t.t*75,50,H-35));ctx.restore()}
}
function cutStreakCornerOpenings(){
 // Cut actual triangular gaps from the WOOD only. Pieces are painted AFTER
 // this operation so they remain visible as they travel through the gaps;
 // scoring waits until the last visible stroke leaves the canvas boundary.
 const s=P.STREAK_CORNER_SIZE;
 ctx.save();ctx.globalCompositeOperation='destination-out';
 for(const [x,y,fx,fy] of [[0,0,1,1],[W,0,-1,1],[0,H,1,-1],[W,H,-1,-1]]){
  ctx.save();ctx.translate(x,y);ctx.scale(fx,fy);
  ctx.beginPath();ctx.moveTo(0,0);ctx.lineTo(s,0);ctx.lineTo(0,s);ctx.closePath();ctx.fill();ctx.restore();
 }
 ctx.restore();
}
function paint(dt){if(!st.world||st.scene!=='game')return;
 ctx.setTransform($('board').width/W,0,0,$('board').height/H,0,0);ctx.clearRect(0,0,W,H);
 ctx.save();if(st.shake>.1)ctx.translate((Math.random()-.5)*st.shake*1.2,(Math.random()-.5)*st.shake*1.2);
 ctx.drawImage(artCanvas,0,0,W,H);
 drawArenaGeometry();
 drawFields();drawVortices();drawMagnets();drawTrails(dt);
 for(const b of st.world.bodies)if(b.alive){drawPiece(b)}
 drawDrag();drawOverlays();
 if(st.flash>0){ctx.fillStyle=`rgba(255,250,214,${st.flash*.48})`;ctx.fillRect(0,0,W,H)}
 ctx.restore();
}
function mainLoop(ts){let dt=animLast?Math.min(.06,(ts-animLast)/1000):.016;animLast=ts;st.time+=dt;
 if(st.scene==='game'){if(st.phase==='moving')tickPhysics(dt);if(st.phase==='remoteStream')updateRemoteBlend(ts);renderFx(dt);paint(dt)}
 rafId=requestAnimationFrame(mainLoop)
}
// ===== Online mode: matchmaking, hidden deck lock, turn-by-turn sync =====
const freshStats=()=>({outs:[0,0],merges:[0,0],crits:[0,0],awakens:[0,0]});
const networkError=e=>window.KanjiOnline?.errorMessage?.(e)||String(e?.message||e||'通信エラー');
function showNetworkStatus(text,kind=''){const el=$('onlineGameStatus');if(st.mode!=='online'){el.className='online-game-status hidden';return;}el.className='online-game-status '+kind;el.textContent=text;}
function onlineUIError(msg){$('matchError').textContent=msg;$('matchError').classList.remove('hidden');}
function openOnlineMatch(){
 cancelAsync();st.mode='online';st.phase='match';st.world=null;
 $('onlineName').value=st.names[0]==='CPU'?'匿名':st.names[0]||'匿名';
 $('roomCode').value='';$('matchError').classList.add('hidden');$('waitingPanel').classList.add('hidden');
 $('roomJoinBtn').disabled=false;changeScene('match');
}
async function joinOnlineRoom(){
 const net=window.KanjiOnline,code=$('roomCode').value,name=escName($('onlineName').value,'匿名');
 $('matchError').classList.add('hidden');
 if(!/^[\u3041-\u3096\u30a1-\u30fa\u30fc]{3,10}$/u.test(code)){onlineUIError('合言葉は、ひらがな・カタカナだけで3〜10文字にしてください。');return;}
 if(!net){onlineUIError('Firebaseを読み込み中、またはネットワークが使えません。接続を確認してもう一度押してください。');return;}
 $('roomJoinBtn').disabled=true;$('roomJoinBtn').textContent='接続しています…';
 try{
  st.names[0]=name;save();net.setListener(handleOnlineRoom);
  const connected=await net.connect(code,name);online.active=true;online.role=connected.role;online.uid=connected.uid;
  online.slot=connected.role==='host'?0:1;online.round=0;online.seq=-1;online.seenMoveId=null;
  online.ownShotId=null;online.starting=false;online.revealing=false;online.publishing=false;online.rematch=false;online.committed=false;online.gameReady=false;online.lastFrameStep=0;online.lastFrameId=null;online.remoteBlend=null;
  $('waitingPanel').classList.remove('hidden');$('roomJoinBtn').classList.add('hidden');
  $('waitingHeadline').textContent='友達の参加を待っています…';
  $('waitingSub').textContent='同じ合言葉を入力してもらってください';
  window.KanjiPractice?.start();
  if(net.latest)handleOnlineRoom(net.latest,net.latestMeta||{});
 }catch(e){$('roomJoinBtn').disabled=false;$('roomJoinBtn').textContent='合言葉でマッチング →';onlineUIError(networkError(e));}
}
function onlineDeckSelect(){const host=$('onlineDeckOptions');host.textContent='';
 for(let i=0;i<3;i++){
  const box=document.createElement('div');box.className='deck-slot';
  const title=document.createElement('span');title.className='slot-heading';title.textContent='SLOT 0'+(i+1);
  const sel=document.createElement('select');sel.setAttribute('aria-label','自分の熟語 '+(i+1));
  categorizedSelect(sel);
  sel.value=onlineDeck[i];const hint=document.createElement('div');hint.className='slot-effect';hint.textContent=DESCRIPTIONS[sel.value];
  sel.addEventListener('change',()=>{onlineDeck[i]=sel.value;hint.textContent=DESCRIPTIONS[sel.value];try{localStorage.setItem('asobeat_kanji_online_deck',JSON.stringify(onlineDeck))}catch(e){}});
  const type=groupLabel(sel.value);sel.addEventListener('change',()=>updateGroupLabel(type,sel.value));
  box.append(title,type,sel,hint);host.appendChild(box);
 }
}
function showOnlineDeck(room){
 window.KanjiPractice?.stop();
 if(st.scene!=='onlineDeck'){cancelAsync();st.phase='onlineDeck';changeScene('onlineDeck');onlineDeckSelect();}
 $('onlineMatchSuccess').textContent=room.round>1?'↻ 再戦のデッキ編成':'✓ マッチ成立！';
 const mine=online.role==='host'?'🔵 青':'🔴 赤';
 const teamCard=$('onlineDeckScene').querySelector('.team-form');
 teamCard.classList.toggle('team-red',online.slot===1);teamCard.classList.toggle('team-blue',online.slot===0);
 const opponent=online.role==='host'?room.guestName:room.hostName;
 $('onlineOpponent').textContent=mine+' あなた　VS　'+(online.slot===0?'🔴':'🔵')+' '+(opponent||'相手');
 const locked=!!room[online.role==='host'?'hostReady':'guestReady'];
 $('onlineReadyBtn').disabled=locked||room.stage!=='deck';
 for(const sel of $('onlineDeckOptions').querySelectorAll('select'))sel.disabled=locked||room.stage!=='deck';
 $('onlineReadyStatus').className='online-status '+(locked?'waiting':'');
 $('onlineReadyStatus').textContent=room.stage==='reveal'?'二人のデッキが決定しました。対戦開始を準備しています…':locked?'デッキを確定しました。相手の決定を待っています…':'相手には、あなたが編成している熟語は見えません。';
}
async function lockOnlineDeck(){const net=window.KanjiOnline;if(!net||!online.active)return;
 $('onlineReadyBtn').disabled=true;
 try{await net.commitDeck(onlineDeck);online.committed=true;
  $('onlineReadyStatus').textContent='デッキを決定しました！ 相手の決定を待っています。';
 }catch(e){$('onlineReadyBtn').disabled=false;$('onlineReadyStatus').textContent=networkError(e);}
}
function resetOnlineViewForRound(round){
 online.round=round;online.seq=-1;online.seenMoveId=null;online.ownShotId=null;
 online.starting=false;online.revealing=false;online.committed=false;online.publishing=false;online.resetting=false;online.rematch=false;online.gameReady=false;online.frameBusy=false;online.lastFrameStep=0;online.lastFrameId=null;online.shotSeq=-1;online.remoteBlend=null;
}
function handleOnlineRoom(room,meta={}){
 if(st.mode!=='online'||!online.active)return;
 if(meta.error){const msg=meta.error;if(st.scene==='match')onlineUIError(msg);else showNetworkStatus(msg,'error');return;}
 if(!room)return;
 // Cached snapshots may belong to an older round/turn. Wait for confirmed
 // Firestore data before changing the board, turn, or replaying a move.
 if(meta.fromCache){
  if(st.scene==='game')showNetworkStatus('サーバーの最新状態を確認中…','pending');
  return;
 }
 online.pendingRoom=room;
 if(room.stage==='closed'){
  window.KanjiPractice?.stop();
  const msg='対戦相手が部屋を退出しました。タイトルから入り直してください。';
  if(st.scene==='match')onlineUIError(msg);else if(st.scene==='onlineDeck'){$('onlineReadyBtn').disabled=true;$('onlineReadyStatus').textContent=msg;}
  else if(st.scene==='result'){$('winnerName').textContent+=' ／ '+msg;}
  else{st.phase='closed';showNetworkStatus(msg,'error');onModal('<p>'+msg+'</p>','対戦が終了しました',true);}
  return;
 }
 if(room.round!==online.round){resetOnlineViewForRound(room.round);}
 if(room.stage==='waiting'){
  if(st.scene!=='match'){cancelAsync();changeScene('match');}
  $('waitingPanel').classList.remove('hidden');$('waitingHeadline').textContent='友達の参加を待っています…';
  window.KanjiPractice?.start();return;
 }
 if(room.stage==='deck'){
  if(st.scene==='result'&&!online.rematch)return;
  showOnlineDeck(room);return;
 }
 if(room.stage==='reveal'){
  showOnlineDeck(room);
  if(!room[online.role==='host'?'hostReveal':'guestReveal']&&!online.revealing){
   online.revealing=true;window.KanjiOnline.revealDeck().catch(e=>{$('onlineReadyStatus').textContent=networkError(e)}).finally(()=>{online.revealing=false});
  }
  if(online.role==='host'&&room.hostReveal&&room.guestReveal&&!online.starting){
   online.starting=true;
   (async()=>{
    if(!await window.KanjiOnline.verifyDecks(room))return;
    const world=P.newWorld();P.spawnInitial(world,[room.hostReveal.deck,room.guestReveal.deck]);
    const arr=new Uint8Array(1);crypto.getRandomValues(arr);
    await window.KanjiOnline.startRound(P.packWorld(world),arr[0]%2,room.round);
   })().catch(e=>{$('onlineReadyStatus').textContent=networkError(e)}).finally(()=>{online.starting=false});
  }return;
 }
 if(room.stage==='playing'){
  if(st.scene!=='game'&&st.phase!=='onlineRoulette'){
   if(st.scene==='result'&&online.rematch)return;
   online.starting=true;st.phase='onlineRoulette';
   window.KanjiPractice?.stop();
   const skipWheel=room.seq>0||(room.rouletteAt?.toMillis?.()&&Date.now()-room.rouletteAt.toMillis()>15000);
   if(skipWheel){enterOnlineSnapshot(room);}
   else roulette(room.first,()=>{online.starting=false;enterOnlineSnapshot(online.pendingRoom||room)});
   return;
  }
  if(st.scene==='game'){
   if(room.seq>online.seq){enterOnlineSnapshot(room);return;}
   if(room.move&&room.move.seq===online.seq&&room.move.id!==online.seenMoveId){
    if(room.move.by===online.uid){
     // A reload can abandon an already-accepted shot. Re-run the exact shot
     // from the last committed board and publish it rather than soft-locking.
     if(!online.ownShotId&&st.phase==='playing')resumeOwnOnlineMove(room.move);
     else online.seenMoveId=room.move.id;
    }else replayOnlineMove(room.move);
   }
   // Movement is display-only for the receiver: the shooter is the physics authority.
   if(room.move&&room.move.by!==online.uid&&room.move.seq===online.seq){
    applyRemoteFrame(room);
   }
   if(st.phase==='playing')showNetworkStatus(room.turn===online.slot?'あなたのターン！ 漢字を選んで発射':'相手のターンです。発射を待っています');
  }return;
 }
 if(room.stage==='result'){
  if(room.seq>online.seq||st.scene!=='result'&&st.scene!=='onlineDeck'){enterOnlineSnapshot(room);}
  if(st.scene==='result'){
   if(!online.rematch&&(room.rematchHost||room.rematchGuest)){
    const other=online.role==='host'?room.rematchGuest:room.rematchHost;
    if(other)$('winnerName').textContent='相手が再戦を希望しています！';
   }
  }
  if(online.role==='host'&&room.rematchHost&&room.rematchGuest&&!online.resetting){
   online.resetting=true;window.KanjiOnline.resetRematch(room.round)
    .catch(e=>{if(st.scene==='onlineDeck')$('onlineReadyStatus').textContent=networkError(e)})
    .finally(()=>{online.resetting=false});
  }return;
 }
}
function enterOnlineSnapshot(room){
 if(!room?.game||!online.active)return;
 cancelAsync();st.fx=[];st.texts=[];st.flash=0;st.shake=0;st.hitstop=0;st.acc=0;st.moving=0;st.still=0;st.vortexPlayed=false;st._impactTimes=new Map();
 $('suddenOverlay').classList.add('hidden');$('suddenOverlay').setAttribute('aria-hidden','true');
 try{st.world=P.unpackWorld(room.game)}catch(e){showNetworkStatus('盤面の読み込みに失敗しました。再読み込みしてください。','error');return;}
 st.names=[room.hostName,room.guestName];
 st.decks=[room.hostReveal.deck,room.guestReveal.deck];
 st.turn=room.turn;st.shotCount=room.seq;st.stats=room.stats||freshStats();
 online.seq=room.seq;online.seenMoveId=null;online.ownShotId=null;online.gameReady=true;online.lastFrameStep=0;online.lastFrameId=null;online.frameBusy=false;online.shotSeq=-1;online.remoteBlend=null;
 if(room.stage==='result'){
  st.phase='playing';st.scene='game';finishGame(room.result?.winner??-1);
  return;
 }
 st.phase='playing';changeScene('game');resizeCanvas();beginTurn();
 if(room.move&&room.move.seq===room.seq){
  if(room.move.by===online.uid)resumeOwnOnlineMove(room.move);
  else {replayOnlineMove(room.move);applyRemoteFrame(room);}
 }
 if(st.world.suddenDeath&&room.seq>0){showEffect('⚠️ サドンデス！ 場外が毎ターン広がる',900);}
}
function resumeOwnOnlineMove(move){
 if(!online.active||st.mode!=='online'||!move||move.seq!==online.seq||st.phase!=='playing')return;
 online.ownShotId=move.id;online.shotSeq=move.seq;online.frameStep=0;
 online.frameSentAt=0;online.frameBusy=false;
 replayOnlineMove(move);
 if(st.phase==='moving')showNetworkStatus('未完了の発射を復旧して同期中…','pending');
 else {online.ownShotId=null;showNetworkStatus('発射の復旧に失敗しました。もう一度読み込んでください。','error');}
}
function replayOnlineMove(move){
 if(st.scene!=='game'||st.phase!=='playing'||move.seq!==online.seq)return;
 online.seenMoveId=move.id;
 const b=st.world.bodies.find(x=>x.id===move.bodyId&&x.alive);
 if(!b){showNetworkStatus('相手の手を同期できません。盤面更新を待っています。','error');st.phase='syncing';return;}
 fireShot(b,move.dx,move.dy,move.power,move.spin,move.spinStrength,true);
 showNetworkStatus('相手の発射を再生中…','pending');
}
// Every ~650ms publish an authoritative in-flight picture of the board.
// No extra Firestore writes when nobody is moving, outside an actual shot,
// or while a previous frame is still being sent.
function sendLiveFrame(){
 if(st.mode!=='online'||!online.active||!online.ownShotId||online.publishing||online.frameBusy||st.phase!=='moving')return;
 const now=performance.now();if(now-online.frameSentAt<650)return;
 online.frameBusy=true;online.frameSentAt=now;
 const id=online.ownShotId,seq=online.shotSeq,step=++online.frameStep;
 const snapshot=P.packWorld(st.world);
 window.KanjiOnline.pushFrame(id,seq,step,snapshot)
  .catch(()=>{/* Keep playing; the final transactional state is authoritative. */})
  .finally(()=>{if(online.ownShotId===id)online.frameBusy=false;});
}
function applyRemoteFrame(room){
 const frame=room.liveFrame,move=room.move;
 if(!frame||!move||frame.id!==move.id||frame.seq!==online.seq||move.by===online.uid)return;
 if(online.lastFrameId===frame.id&&frame.step<=online.lastFrameStep)return;
 if(st.scene!=='game'||!['moving','remoteStream','syncing'].includes(st.phase))return;
 try{
  const w=P.unpackWorld(frame.world);
  const oldById=new Map((st.world?.bodies||[]).filter(b=>b.alive).map(b=>[b.id,{x:b.x,y:b.y,angle:b.angle}]));
  const blend=[];
  for(const b of w.bodies){
   const before=oldById.get(b.id);
   if(!before||Math.hypot(before.x-b.x,before.y-b.y)>240)continue;
   blend.push({body:b,from:before,to:{x:b.x,y:b.y,angle:b.angle}});
   b.x=before.x;b.y=before.y;b.angle=before.angle;
  }
  online.remoteBlend={start:performance.now(),duration:420,items:blend};
  st.world=w;st.shotCount=room.seq+1;st.turn=room.turn;
  st.phase='remoteStream';st.hitstop=0;st.acc=0;st.moving=0;st.still=0;st.drag=null;
  online.lastFrameId=frame.id;online.lastFrameStep=frame.step;
  updateHud();updateFieldStatus();
  showNetworkStatus('相手の盤面を同期表示中…','pending');
 }catch(e){showNetworkStatus('途中経過の同期を再試行中…','pending');}
}
// Smooth 650ms authoritative packet updates without running a second,
// potentially divergent physics simulation on the receiving device.
function updateRemoteBlend(ts){
 const blend=online.remoteBlend;if(!blend)return;
 const a=clamp((ts-blend.start)/blend.duration,0,1);
 const t=a*a*(3-2*a);
 for(const item of blend.items){
  const {body,from,to}=item;
  body.x=from.x+(to.x-from.x)*t;body.y=from.y+(to.y-from.y)*t;
  const da=Math.atan2(Math.sin(to.angle-from.angle),Math.cos(to.angle-from.angle));
  body.angle=from.angle+da*t;
 }
 if(a>=1)online.remoteBlend=null;
}
function publishOnlineTurn(){
 if(!online.active||!online.ownShotId||online.publishing)return;
 const id=online.ownShotId,snapshot=P.packWorld(st.world),turn=st.turn,stats=JSON.parse(JSON.stringify(st.stats));
 const result=st.phase==='result'?{winner:st.result.winner,turns:st.shotCount,stats}:null;
 if(!result){st.phase='syncing';showNetworkStatus('対戦結果を相手へ同期中…','pending');}
 online.publishing=true;
 let attempts=0;
 async function send(){
  try{await window.KanjiOnline.finishShot(id,snapshot,turn,stats,result);online.publishing=false;}
  catch(e){const done=window.KanjiOnline?.latest;
   if(done&&done.seq>online.shotSeq){online.publishing=false;return;}
   if(++attempts<=3&&online.active){showNetworkStatus('送信を再試行しています…','pending');setTimeout(send,1400*attempts)}
   else{online.publishing=false;showNetworkStatus('ターン同期に失敗しました。通信を確認して画面を再読み込みしてください。','error')}}
 }
 send();
}
async function requestOnlineRematch(){
 if(!online.active||st.mode!=='online')return;
 online.rematch=true;showOnlineDeck(online.pendingRoom||{});
 $('onlineReadyBtn').disabled=true;$('onlineReadyStatus').textContent='相手が「もう一度戦う」を選ぶまで待っています。デッキは先に編集できます。';
 try{await window.KanjiOnline.offerRematch();}
 catch(e){$('onlineReadyStatus').textContent=networkError(e);online.rematch=false;}
}
async function leaveOnlineRoom(){
 const net=window.KanjiOnline;online.active=false;cancelAsync();window.KanjiPractice?.stop();
 st.phase='title';st.drag=null;st.selected=null;online.gameReady=false;online.remoteBlend=null;
 if(net)await net.leave();
 $('roomJoinBtn').classList.remove('hidden');$('roomJoinBtn').disabled=false;$('roomJoinBtn').textContent='合言葉でマッチング →';
 closeModal();changeScene('home');st.mode='solo';
}
// Wiring
$('onlineBtn').addEventListener('click',openOnlineMatch);
$('roomJoinBtn').addEventListener('click',joinOnlineRoom);
$('roomCode').addEventListener('input',e=>{if(e.target.value.length>10)e.target.value=Array.from(e.target.value).slice(0,10).join('')});
$('matchBack').addEventListener('click',()=>{if(online.active)leaveOnlineRoom();else changeScene('home')});
$('roomCancelBtn').addEventListener('click',leaveOnlineRoom);
$('onlineDeckLeave').addEventListener('click',leaveOnlineRoom);
$('onlineReadyBtn').addEventListener('click',lockOnlineDeck);
initPracticeCategories();
$('onlineAbilityGuide').innerHTML=''; // Filled after abilityManualHTML is declared.
$('streakBtn').addEventListener('click',()=>{initAudio();sound('tap');showStreakSetup()});
$('streakBack').addEventListener('click',()=>{cancelAsync();changeScene('home')});
$('streakStartBtn').addEventListener('click',()=>{initAudio();sound('tap');startStreak()});
$('soloBtn').addEventListener('click' ,()=>{initAudio();sound('tap');setup('solo')});
$('localBtn').addEventListener('click',()=>{initAudio();sound('tap');setup('local')});
$('setupBack').addEventListener('click',()=>{cancelAsync();changeScene('home')});
$('confirmBack').addEventListener('click',()=>{st.phase='setup';changeScene('setup')});
$('toConfirmBtn').addEventListener('click',()=>{initAudio();sound('tap');confirm()});
$('startMatchBtn').addEventListener('click',()=>roulette());
for(const b of $('difficultyOptions').querySelectorAll('button'))b.addEventListener('click',()=>{st.diff=b.dataset.diff;updateModeUI();save();sound('tap')});
$('name0').addEventListener('change',readSetup);$('name1').addEventListener('change',readSetup);
$('spinRight').addEventListener('click',()=>{st.spin=1;$('spinRight').classList.add('active');$('spinLeft').classList.remove('active');sound('tap')});
$('spinLeft').addEventListener('click',()=>{st.spin=-1;$('spinLeft').classList.add('active');$('spinRight').classList.remove('active');sound('tap')});
// Use the entire game scene as an aim surface, not only the canvas.
// Capturing at scene level preserves the drag if a finger crosses its edge.
window.addEventListener('pointerdown',secondFingerCancel,{capture:true,passive:false});
$('gameScene').addEventListener('pointerdown',pointerDown);
$('board').addEventListener('contextmenu',e=>{e.preventDefault();const piece=findInspectable(boardPoint(e));if(piece)showPieceInfo(piece)});
$('pieceInfoClose').addEventListener('click',closePieceInfo);
$('gameScene').addEventListener('pointermove',pointerMove);
$('gameScene').addEventListener('pointerup',pointerUp);
$('gameScene').addEventListener('pointercancel',pointerCancel);
$('gameScene').addEventListener('lostpointercapture',e=>{if(st.drag&&e.pointerId===st.drag.pointer)pointerCancel(e)});
$('quitBtn').addEventListener('click',()=>{
 onModal('<p><b>対戦を続けますか？</b></p><p>タイトルに戻ると、今の対戦は最初からになります。</p>','対戦メニュー',true);
});
$('modalEndMatch').addEventListener('click',()=>{if(st.mode==='online')leaveOnlineRoom();else{cancelAsync();if(st.mode==='streak')restoreStreakPrefs();st.phase='title';st.selected=null;st.drag=null;changeScene('home')}});
$('rematchBtn').addEventListener('click',()=>{if(st.mode==='online'){requestOnlineRematch();return;}if(st.mode==='streak'){resetStreakInteraction();startStreak();return;}const bits=new Uint32Array(1);try{crypto.getRandomValues(bits)}catch(e){bits[0]=Math.floor(Math.random()*2)};startMatch(bits[0]%2)});
$('resultHomeBtn').addEventListener('click',()=>{if(st.mode==='online')leaveOnlineRoom();else{cancelAsync();if(st.mode==='streak')restoreStreakPrefs();st.phase='title';changeScene('home')}});
function abilityManualHTML(){
 const explanation='<div class="ability-definition"><b>攻撃</b>：漢字同士がぶつかって飛ばすこと。暴走で追いかけてぶつかった場合も攻撃です。'+
  '<br><b>能力</b>：漢字の技で相手を動かすこと。「烈風」「渦巻」「磁力」などがこれにあたります。'+
  '<br><b>連続ヒット</b>：技で飛ばされたコマが別のコマにぶつかったら、それは攻撃です。</div>';
 const rows=P.ABILITY_RULES.map(a=>`<tr><th scope="row">${a.word}<small>${a.kind}</small></th><td><b>${a.numbers}</b><br><span>${a.timing}</span></td></tr>`).join('');
 return explanation+`<div class="ability-scroll"><table class="ability-table"><thead><tr><th>漢字</th><th>何が起こる？ どのくらい強い？</th></tr></thead><tbody>${rows}</tbody></table></div>`+
 '<p class="ability-extra"><b>角当て：</b>漢字の角を相手にぶつけると、普通は1.2倍。「一撃」は最初の敵だけ3倍、角なら合計5倍！</p>'+
 '<p class="ability-extra"><b>操作：</b>漢字をタップして選ぶ → 好きな場所から引っ張る → 指を離して発射。遠い位置から引き始めるほどよく回ります。もう片方の指でタップするとキャンセル。</p>'+
 '<p class="ability-extra"><b>試合の流れ：</b>最初の2ターンは準備時間で場外が閉じ、技もお休み。両者1コマずつ、または16ターン目の開始時にサドンデスとなり、毎ターン出口が広がります。</p>';
}
function openAbilityManual(){onModal(abilityManualHTML(),'熟語の能力と強さ')}
$('helpBtn').addEventListener('click',openAbilityManual);
$('abilityHomeBtn').addEventListener('click',openAbilityManual);
// The same comparison table is available while choosing each three-word deck.
$('abilitySetup').innerHTML=abilityManualHTML();$('onlineAbilityGuide').innerHTML=abilityManualHTML();
$('modalClose').addEventListener('click',closeModal);$('modalOK').addEventListener('click',closeModal);$('modal').addEventListener('click',e=>{if(e.target===$('modal'))closeModal()});
$('soundBtn').addEventListener('click',()=>{st.sound=!st.sound;$('soundBtn').classList.toggle('muted',!st.sound);$('soundBtn').textContent=st.sound?'♪':'×';if(st.sound){initAudio();sound('tap')}save()});
$('soundBtn').classList.toggle('muted',!st.sound);$('soundBtn').textContent=st.sound?'♪':'×';
window.addEventListener('resize',()=>{if(st.scene==='game')resizeCanvas()});
window.addEventListener('keydown',e=>{if(e.key==='Escape'){closeModal();return}if(e.code==='Space'&&st.scene==='game'&&st.drag&&st.drag.body&&st.drag.power>.06){e.preventDefault();const d=st.drag;fireShot(d.body,d.dx,d.dy,d.power,st.spin,d.spinStrength??1)}});
// Extra hook for deterministic and automated smoke tests; only exposed when ?test=1.
if(new URLSearchParams(location.search).has('test'))window.__KANJI_TEST__={st,P,online,setup,confirm,startMatch,fireShot,finishGame,finishShot,beginTurn,selectPiece,selectable,findSelected,aimSpinAt,draw:()=>paint(.016),cpuTakeTurn,resizeCanvas,tickPhysics,collisionHooks,handleOnlineRoom,enterOnlineSnapshot,showOnlineDeck,requestOnlineRematch,joinOnlineRoom,openOnlineMatch,startStreak,showStreakSetup,streakWin,streakDefeated,spawnStreakCpu,WORD_GROUPS};
makeBoardArt();
// Training-specific state, rendered with the live game's identical particle,
// impact, trail, shock-wave and aim-arrow functions (no Firebase writes).
function createPracticeEffects(worldGetter){
 const v={fx:[],texts:[],shake:0,flash:0,hitstop:0,impacts:new Map()};
 function ring(x,y,color,size){v.fx.push({type:'ring',x,y,color,r:5,max:size,t:0,life:.44})}
 function particles(x,y,count,color,energy=1){for(let i=0;i<count&&v.fx.length<260;i++){
  const a=Math.random()*TAU,spd=(70+Math.random()*245)*energy;
  v.fx.push({type:'spark',x,y,vx:Math.cos(a)*spd,vy:Math.sin(a)*spd,r:1.4+Math.random()*3.3,t:0,life:.26+Math.random()*.45,color});
 }}
 function label(s,x,y,color){v.texts.push({str:s,x,y,color,t:0,life:1.05})}
 v.reset=()=>{v.fx.length=0;v.texts.length=0;v.shake=0;v.flash=0;v.hitstop=0;v.impacts.clear()};
 v.update=dt=>{
  for(let i=v.fx.length-1;i>=0;i--){const e=v.fx[i];e.t+=dt;if(e.type==='spark'){
   e.x+=e.vx*dt;e.y+=e.vy*dt;e.vx*=Math.exp(-3*dt);e.vy*=Math.exp(-3*dt)}
   if(e.t>e.life)v.fx.splice(i,1);
  }
  for(let i=v.texts.length-1;i>=0;i--){const e=v.texts[i];e.t+=dt;if(e.t>e.life)v.texts.splice(i,1)}
  v.shake=Math.max(0,v.shake-24*dt);v.flash=Math.max(0,v.flash-2.1*dt);
 };
 v.shoot=b=>{particles(b.x,b.y,10,b.owner===0?'#70c5f7':'#f4a29c',1);v.shake=2.6;sound('shoot')};
 v.magnet=(shooter,m)=>{ring(shooter.x,shooter.y,'#6adacb',m.range);particles(shooter.x,shooter.y,55,'#87ffdb',1.55);
  v.shake=Math.max(v.shake,5);v.flash=Math.max(v.flash,.2);label('磁力！ 強力吸引',shooter.x,shooter.y,'#b6ffec');sound('shock')};
 v.vortex=(shooter,m)=>{ring(shooter.x,shooter.y,'#a875ed',m.range);particles(shooter.x,shooter.y,26,'#9c78ef',1.1);sound('shock')};
 v.hooks={
  impact:({a,b,p,speed,corner,firstStrike})=>{
   const w=worldGetter(),shooter=(a.id===w.shooterId?a:b.id===w.shooterId?b:null);
   const key=a.static?'w'+b.id:b.static?'w'+a.id:[a.id,b.id].sort((x,y)=>x-y).join('_');
   if(w.time-(v.impacts.get(key)??-99)<.11)return;v.impacts.set(key,w.time);
   if(speed>165){particles(p.x,p.y,Math.min(18,Math.round(speed/45)),'#fbda92',speed/330);v.shake=Math.max(v.shake,clamp(speed/100,1.5,7.5));}
   if(!w.preparation&&shooter&&a.owner!==b.owner&&!a.static&&!b.static){
    if(shooter.ability==='giant'&&P.growGiant(w,shooter)){
     ring(shooter.x,shooter.y,'#eac864',shooter.radius*1.7);particles(shooter.x,shooter.y,23,'#ffd774',1.3);
     v.flash=.20;label('巨大化 ×'+shooter.growthStacks,shooter.x,shooter.y,'#fff2b4');sound('merge');
    }
    if(shooter.ability==='strike'&&firstStrike&&!corner){
     particles(p.x,p.y,22,'#ffc064',1.25);label('一撃 ×3!!',p.x,p.y,'#ffe5a8');v.shake=Math.max(v.shake,7);sound('crit');
    }
   }
   if(corner&&shooter&&a.owner!==b.owner&&!a.static&&!b.static){
    v.hitstop=Math.max(v.hitstop,.05);v.flash=.26;
    label(shooter.ability==='strike'&&firstStrike?'CRITICAL ×5!!':'CRITICAL ×1.2!',p.x,p.y,'#fff1a2');sound('crit');
   }else if(speed>165){sound('impact',speed/300);if(speed>420)v.hitstop=Math.max(v.hitstop,.022)}
  },
  wallBoost:({piece,p})=>{particles(p.x,p.y,22,'#ffc95c',1);label('跳弾 加速!',piece.x,piece.y,'#ffe6a1');sound('crit')},
  reflect:({shield,p})=>{ring(shield.x,shield.y,'#a9f3fd',shield.radius*1.3);label('反射！ 衝撃を返す',p.x,p.y,'#aefaff');sound('crit')},
  split:(parent,children)=>{ring(parent.x,parent.y,parent.owner===0?'#63bafb':'#ec7d82',parent.radius*1.5);
   particles(parent.x,parent.y,25,parent.owner===0?'#6bcfff':'#ff98a0',1.3);v.shake=Math.max(v.shake,4);v.flash=Math.max(v.flash,.16);
   label('分裂！×2',parent.x,parent.y,'#ffe4a1');sound('merge')},
  merge:(a,b)=>{const w=worldGetter(),m=P.createMerged(w,a,b);particles(m.x,m.y,30,'#e8ae55',1.6);
   ring(m.x,m.y,'#eaba65',100);v.shake=4.5;v.flash=.2;v.hitstop=Math.max(v.hitstop,.065);
   label('『'+m.word+'』合体!!',m.x,m.y,'#fff2b9');sound('merge')},
  out:b=>{const x=clamp(b.x,25,W-25),y=clamp(b.y,25,H-25);
   particles(x,y,20,b.owner===0?'#3989c5':'#d35b58',1.3);v.shake=4.8;label('場外!!',x,y,'#ffe9bb');sound('out')},
  ability:(b,name)=>{if(name==='burst'){ring(b.x,b.y,'#e75552',115);particles(b.x,b.y,23,'#f67252',1.4);
   label('暴走開始!!',b.x,b.y,'#f9a36d');sound('burst')}},
  shockLand:(b,wave)=>{if(!wave)return;v.shake=5.5;v.hitstop=Math.max(v.hitstop,.05);v.flash=.32;
   ring(wave.x,wave.y,'#a7ffff',P.PIECE_UNIT);particles(wave.x,wave.y,20,'#82f4ff',.95);
   label('烈風着地！',wave.x,wave.y,'#dcffff');sound('shock')},
  shockHit:(wave,target,impulse)=>{particles(target.x,target.y,Math.max(5,Math.round(impulse/100)),'#8ddbf3',.65);v.shake=Math.max(v.shake,Math.min(5,impulse/200))},
  awaken:(b)=>{ring(b.x,b.y,'#f7c551',135);particles(b.x,b.y,33,'#f4c960',1.45);
   v.flash=.45;v.hitstop=Math.max(v.hitstop,.09);v.shake=6.5;
   label('覚醒！『'+b.text+'』',b.x,b.y,'#fff2b4');sound('awake')}
 };
 return v;
}
// Shared visual engine. Training reuses the same board, wall and kanji-piece renderers.
window.KanjiRenderer={createPracticeEffects,practiceSelectSound:()=>sound('tap'),drawPractice(canvas,world,selected,drag,visual=null,dt=.016){
 if(!world||!artCanvas)return;
 const c=canvas.getContext('2d',{alpha:true});
 c.setTransform(canvas.width/W,0,0,canvas.height/H,0,0);
 c.clearRect(0,0,W,H);c.save();
 if(visual?.shake>.1)c.translate((Math.random()-.5)*visual.shake*1.2,(Math.random()-.5)*visual.shake*1.2);
 c.drawImage(artCanvas,0,0,W,H);
 drawArenaGeometry(world,c);drawFields(world,c);drawVortices(world,c);drawMagnets(world,c);
 drawTrails(dt,world,c);
 for(const b of world.bodies)if(b.alive)drawPiece(b,c,selected);
 if(drag&&selected?.alive)drawDrag(c,{...drag,body:selected},0,world);
 drawOverlays(c,world,visual?.fx||[],visual?.texts||[]);
 if(visual?.flash>0){c.fillStyle=`rgba(255,250,214,${visual.flash*.48})`;c.fillRect(0,0,W,H)}
 c.restore();
}};
requestAnimationFrame(mainLoop);
})();

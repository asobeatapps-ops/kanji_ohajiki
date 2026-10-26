/* 漢字おはじき Ver.2.2 — authoritative shooter snapshots.
   The shooter's physics is authoritative. During an active shot, lightweight
   periodic snapshots prevent cross-device font/physics drift. Turn-end state
   is committed in a Firestore transaction. Server-side game anti-cheat is NOT supplied. */
import {initializeApp} from 'https://www.gstatic.com/firebasejs/12.11.0/firebase-app.js';
import {getAuth,signInAnonymously} from 'https://www.gstatic.com/firebasejs/12.11.0/firebase-auth.js';
import {getFirestore,doc,runTransaction,onSnapshot,updateDoc,serverTimestamp} from 'https://www.gstatic.com/firebasejs/12.11.0/firebase-firestore.js';

const firebaseConfig={
 apiKey:'AIzaSyCSZTyGQsnC5suS7N0FjjDWzrigad7_9KE',
 authDomain:'kanji-ohajiki.firebaseapp.com',
 projectId:'kanji-ohajiki',
 storageBucket:'kanji-ohajiki.firebasestorage.app',
 messagingSenderId:'603509872430',
 appId:'1:603509872430:web:18f6fbd4a4da2fc4d00cbf'
};
const app=initializeApp(firebaseConfig,'kanji-ohajiki-v17');
const db=getFirestore(app),auth=getAuth(app);
let roomRef=null,roomId=null,playerUid=null,role=null,unsub=null,notify=()=>{},latest=null,latestMeta={};
let myDeck=null,mySalt=null;
const safeName=s=>String(s||'匿名').trim().slice(0,10)||'匿名';
const phoneticCode=code=>/^[\u3041-\u3096\u30a1-\u30fa\u30fc]{3,10}$/u.test(code);
function errorMessage(e){
 const code=String(e?.code||'');
 if(code.includes('permission-denied'))return 'Firebaseのアクセス権限がありません。Firestoreの「kanjiRooms」用ルールを公開してください。';
 if(code.includes('unavailable')||code.includes('network-request-failed'))return '通信できません。ネット接続を確認して、もう一度お試しください。';
 if(code.includes('unauthenticated')||code.includes('operation-not-allowed'))return 'Firebaseの匿名認証が有効か確認してください。';
 return e?.message||'通信エラーが発生しました。';
}
async function sha256(text){
 const data=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));
 return [...new Uint8Array(data)].map(v=>v.toString(16).padStart(2,'0')).join('');
}
function randomId(){const arr=new Uint8Array(16);crypto.getRandomValues(arr);return [...arr].map(v=>v.toString(16).padStart(2,'0')).join('')}
function defaultRoom(uid,name){return {
 hostUid:uid,guestUid:null,hostName:name,guestName:'',stage:'waiting',round:1,
 hostReady:false,guestReady:false,hostCommit:'',guestCommit:'',hostReveal:null,guestReveal:null,
 first:null,turn:0,seq:0,move:null,liveFrame:null,game:null,stats:null,result:null,
 rematchHost:false,rematchGuest:false,createdAt:serverTimestamp(),updatedAt:serverTimestamp(),rouletteAt:null
}}
async function initAuth(){if(!auth.currentUser)await signInAnonymously(auth);playerUid=auth.currentUser.uid;return playerUid}
function setListener(fn){notify=typeof fn==='function'?fn:()=>{}}
function listen(){
 unsub?.();unsub=onSnapshot(roomRef,{includeMetadataChanges:true},snap=>{
  if(!snap.exists()){notify(null,{error:'部屋が見つかりません'});return;}
  latest=snap.data();latestMeta={fromCache:snap.metadata.fromCache,pending:snap.metadata.hasPendingWrites};notify(latest,latestMeta);
 },e=>notify(null,{error:errorMessage(e)}));
}
async function connect(code,name){
 if(!phoneticCode(code))throw Error('合言葉は、ひらがな・カタカナだけで3〜10文字にしてください。');
 if(unsub)unsub();unsub=null;latest=null;latestMeta={};myDeck=null;mySalt=null;
 const uid=await initAuth();roomId=await sha256('ASOBEAT:KANJI_OHAJIKI:V17:'+code);
 roomRef=doc(db,'kanjiRooms',roomId);const enteredName=safeName(name);
 const assigned=await runTransaction(db,async tx=>{
  const snap=await tx.get(roomRef),now=Date.now();
  if(!snap.exists()){
   tx.set(roomRef,defaultRoom(uid,enteredName));return 'host';
  }
  const d=snap.data();
  const stale=d.stage==='waiting'&&d.createdAt?.toMillis&&now-d.createdAt.toMillis()>20*60*1000;
  if(d.stage==='closed'||stale){tx.set(roomRef,defaultRoom(uid,enteredName));return 'host';}
  if(d.hostUid===uid)return 'host';
  if(d.guestUid===uid)return 'guest';
  if(d.stage==='waiting'&&d.guestUid===null){
   tx.update(roomRef,{guestUid:uid,guestName:enteredName,stage:'deck',updatedAt:serverTimestamp()});return 'guest';
  }
  throw Error('この合言葉ではすでに2人が対戦中です。別の合言葉を試してください。');
 });
 role=assigned;
 try{const item=JSON.parse(sessionStorage.getItem('kanji-room-deck:'+roomId)||'null');
  if(item?.uid===uid){myDeck=item.deck;mySalt=item.salt}
 }catch{}
 listen();return {role,uid,roomId};
}
function assertConnected(){if(!roomRef||!role||!playerUid)throw Error('合言葉の部屋へ接続していません');}
const ownKey=(host,guest)=>role==='host'?host:guest;
async function commitDeck(deck){
 assertConnected();if(!Array.isArray(deck)||deck.length!==3||!deck.every(w=>['暴走','烈風','鉄壁','渦巻','巨大','一撃','分裂','跳弾','磁力','反射'].includes(w)))throw Error('熟語を3つ選んでください');
 myDeck=[...deck];mySalt=randomId();
 try{sessionStorage.setItem('kanji-room-deck:'+roomId,JSON.stringify({uid:playerUid,deck:myDeck,salt:mySalt}))}catch(e){}
 const hash=await sha256(myDeck.join('|')+'::'+mySalt);
 await runTransaction(db,async tx=>{
  const docSnap=await tx.get(roomRef),d=docSnap.data();
  if(!d||d.stage!=='deck')throw Error('今はデッキを決定できません');
  if(d[ownKey('hostReady','guestReady')])throw Error('すでに決定済みです');
  const otherReady=!!d[ownKey('guestReady','hostReady')];
  const patch=role==='host'?{hostReady:true,hostCommit:hash}:{guestReady:true,guestCommit:hash};
  patch.stage=otherReady?'reveal':'deck';patch.updatedAt=serverTimestamp();tx.update(roomRef,patch);
 });
}
async function revealDeck(){
 assertConnected();if(!myDeck||!mySalt)throw Error('デッキ情報が消えました。再接続してください。');
 await runTransaction(db,async tx=>{
  const snap=await tx.get(roomRef),d=snap.data();if(!d||d.stage!=='reveal')return;
  const key=ownKey('hostReveal','guestReveal');if(d[key])return;
  tx.update(roomRef,{[key]:{deck:myDeck,salt:mySalt},updatedAt:serverTimestamp()});
 });
}
async function verifyDecks(room){
 if(!room.hostReveal||!room.guestReveal)return false;
 for(const [reveal,key] of [[room.hostReveal,'hostCommit'],[room.guestReveal,'guestCommit']]){
  const d=reveal.deck;if(!Array.isArray(d)||d.length!==3||d.some(w=>!['暴走','烈風','鉄壁','渦巻','巨大','一撃','分裂','跳弾','磁力','反射'].includes(w)))throw Error('相手のデッキ情報が不正です');
  if(await sha256(d.join('|')+'::'+reveal.salt)!==room[key])throw Error('デッキの照合に失敗しました');
 }return true;
}
async function startRound(snapshot,first,round){
 assertConnected();if(role!=='host')return;
 await runTransaction(db,async tx=>{
  const snap=await tx.get(roomRef),d=snap.data();
  if(!d||d.stage!=='reveal'||!d.hostReveal||!d.guestReveal||d.round!==round)return;
  tx.update(roomRef,{stage:'playing',first,turn:first,seq:0,game:snapshot,move:null,liveFrame:null,
   stats:{outs:[0,0],merges:[0,0],crits:[0,0],awakens:[0,0]},result:null,
   rematchHost:false,rematchGuest:false,rouletteAt:serverTimestamp(),updatedAt:serverTimestamp()});
 });
}
async function sendShot(move){
 assertConnected();const shot={...move,by:playerUid,id:randomId()};
 await runTransaction(db,async tx=>{
  const snap=await tx.get(roomRef),d=snap.data();
  if(!d||d.stage!=='playing'||d.move!==null)throw Error('まだ発射できません。前の操作の同期を確認してください。');
  if(d.turn!==(role==='host'?0:1))throw Error('相手のターンです');
  shot.seq=d.seq;tx.update(roomRef,{move:shot,liveFrame:null,updatedAt:serverTimestamp()});
 });return shot;
}
// Maximum ~1.5 snapshots/sec per ongoing shot. Old/stale frames are ignored by
// the receiving client and (with production rules) rejected after shot completion.
async function pushFrame(shotId,seq,step,snapshot){
 assertConnected();
 if(!Number.isInteger(step)||step<1||step>10000)throw Error('同期番号が不正です');
 await updateDoc(roomRef,{liveFrame:{id:shotId,seq,step,world:snapshot},updatedAt:serverTimestamp()});
}
async function finishShot(shotId,snapshot,turn,stats,result){
 assertConnected();await runTransaction(db,async tx=>{
  const snap=await tx.get(roomRef),d=snap.data();
  if(!d||d.stage!=='playing'||!d.move||d.move.id!==shotId||d.move.by!==playerUid)throw Error('この手はすでに処理済みです');
  tx.update(roomRef,{move:null,liveFrame:null,game:snapshot,turn,stats,seq:d.seq+1,
   stage:result?'result':'playing',result:result||null,updatedAt:serverTimestamp()});
 });
}
async function offerRematch(){
 assertConnected();await runTransaction(db,async tx=>{
  const snap=await tx.get(roomRef),d=snap.data();
  if(!d||d.stage!=='result')throw Error('試合終了後に再戦できます');
  tx.update(roomRef,{[ownKey('rematchHost','rematchGuest')]:true,updatedAt:serverTimestamp()});
 });
}
async function resetRematch(round){
 assertConnected();if(role!=='host')return;
 await runTransaction(db,async tx=>{
  const snap=await tx.get(roomRef),d=snap.data();if(!d||d.stage!=='result'||!d.rematchHost||!d.rematchGuest||d.round!==round)return;
  tx.update(roomRef,{stage:'deck',round:round+1,hostReady:false,guestReady:false,
   hostCommit:'',guestCommit:'',hostReveal:null,guestReveal:null,first:null,turn:0,
   seq:0,move:null,liveFrame:null,game:null,stats:null,result:null,rouletteAt:null,
   rematchHost:false,rematchGuest:false,updatedAt:serverTimestamp()});
 });
}
async function leave(){
 if(roomRef&&playerUid){try{await runTransaction(db,async tx=>{
  const snap=await tx.get(roomRef),d=snap.data();if(!d||d.stage==='closed'||!(d.hostUid===playerUid||d.guestUid===playerUid))return;
  tx.update(roomRef,{stage:'closed',updatedAt:serverTimestamp()});
 })}catch(e){/* Caller can still exit locally if offline. */}}
 unsub?.();unsub=null;roomRef=null;roomId=null;role=null;latest=null;latestMeta={};myDeck=null;mySalt=null;
}
window.KanjiOnline={setListener,connect,commitDeck,revealDeck,verifyDecks,startRound,sendShot,pushFrame,finishShot,offerRematch,resetRematch,leave,
 errorMessage,validCode:phoneticCode,get role(){return role},get uid(){return playerUid},get roomId(){return roomId},get latest(){return latest},get latestMeta(){return latestMeta},get deck(){return myDeck}};
window.dispatchEvent(new Event('kanji-online-ready'));

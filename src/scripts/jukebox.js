(function(){
"use strict";

/* ============ DATA ============ */
var TRACKS=[
 {n:1, t:"Astral Body",            d:303979, id:"2G63bOGjUCnqFVC9SFlgV0", p:"https://p.scdn.co/mp3-preview/3e1d167edbad7978dac6b728ce9487f8085064d2"},
 {n:2, t:"All About the Hits",     d:188141, id:"1muOiMkJutCFoBpkjmvxrq", p:"https://p.scdn.co/mp3-preview/2baa5ab27f7423c2e751070ab427337c334330bd"},
 {n:3, t:"Bridge Diving",          d:222293, id:"0KFgfmMlx7XTGr2gvv9KCm", p:"https://p.scdn.co/mp3-preview/220ab8fa87fb6d2ab5e59508877a7fb15c28e60f"},
 {n:4, t:"On a Big Illusion",      d:219908, id:"4AacmvCQyQGwG8ArX35ZDY", p:"https://p.scdn.co/mp3-preview/7dadf32ed2643f47bc14e2c4ff1c88763cdf220b"},
 {n:5, t:"My Own Goliath",         d:308225, id:"5CCCNkzsucAaQypszC7GLr", p:"https://p.scdn.co/mp3-preview/b87bb206332ab5778c5102208a957c01645aafb2"},
 {n:6, t:"Cinema Geek",            d:210349, id:"2oNR2f9SpMa8YNUuadgumE", p:"https://p.scdn.co/mp3-preview/d2658082247b9b5d288864fb6707474fea06e74c"},
 {n:7, t:"Resurrected",            d:231991, id:"1d1mRCgsNCHsXvkvrZn1Gr", p:"https://p.scdn.co/mp3-preview/0c35873874b5b01bc1eed9e5dfd2a9aa3a77b442"},
 {n:8, t:"Air Traffic Controller", d:263167, id:"2Scy8W94dDm3oUm2WAg2ya", p:"https://p.scdn.co/mp3-preview/86dc9d5f46dfbfb064f026e17cf498c59882b23f"},
 {n:9, t:"Chronograph",            d:240423, id:"17bd6ydIGLk7T5U1qUWmi6", p:"https://p.scdn.co/mp3-preview/f1515614af25de7f55b0233d6b419052ae198d77"},
 {n:10,t:"Where the Heart is",     d:231679, id:"41CYmNGOZ1ShS7iFjLnpqt", p:"https://p.scdn.co/mp3-preview/8a1ea5dfb1e34db3aa3a27f061249555a4598f12"},
 {n:11,t:"Beyond the Edge of Time",d:350228, id:"3NDErbmCAUtiP0sg1My27E", p:"https://p.scdn.co/mp3-preview/c2be2cdbd3a9b90e27cb2325f882c91526222ce8"}
];

var $=function(s){return document.querySelector(s)};
var au=$("#au"), cur=-1, shuffle=false, credits=0, powered=false;
var buffering=false, counted=false;
var reduce=matchMedia("(prefers-reduced-motion: reduce)").matches;

/* shareable per-track links: /#bridge-diving */
function setHash(i){
  try{ history.replaceState(null,"","#"+TRACKS[i].slug); }
  catch(e){ location.hash=TRACKS[i].slug; }
}
function hashTrack(){
  var h=(location.hash||"").replace(/^#/,"").toLowerCase();
  if(!h) return -1;
  for(var i=0;i<TRACKS.length;i++) if(TRACKS[i].slug===h) return i;
  return -1;
}

/* ============ THE MECHANISM ============
   The hands are physical objects: a spring drives the joystick the left hand
   grips, another drives the right hand's button jab. Both idle-sway while the
   machine is on, and bob with the music while a track plays. */
function Spring(k,d){ this.x=0; this.v=0; this.k=k; this.d=d; this.t=0; }
Spring.prototype.step=function(){
  this.v += (this.t-this.x)*this.k - this.v*this.d;
  this.x += this.v;
};
Spring.prototype.kick=function(target,ms){
  var me=this; me.t=target;
  clearTimeout(me._r); me._r=setTimeout(function(){ me.t=0; },ms||190);
};
var sJoy=new Spring(.16,.42),   // joystick throw, left/right
    sPress=new Spring(.30,.55), // right hand jab
    sTap=new Spring(.40,.52),   // per-beat twitch, so the hands play along
    beat=0,                     // smoothed music energy
    lowPrev=0, fluxAvg=0, tapCool=0;  // spectral-flux onset detection

var handL=$("#handL"), handR=$("#handR"), marquee=$(".marquee"),
    glowA=$("#glowA"), glowB=$("#glowB"), glowCoin=$("#glowCoin");

function flash(el,ms){
  if(!el) return;
  el.style.transition="none"; el.style.opacity="1";
  setTimeout(function(){ el.style.transition="opacity "+(ms||260)+"ms ease"; el.style.opacity="0"; },20);
}
function pressButton(which){
  sPress.kick(1,120);
  flash(which==="b"?glowB:glowA,300);
}
function throwStick(dir){ sJoy.kick(dir,210); }

function mmss(sec){
  if(!isFinite(sec)||sec<0) sec=0;
  var m=Math.floor(sec/60), s=Math.floor(sec%60);
  return m+":"+(s<10?"0":"")+s;
}

/* ============ WEB AUDIO ============ */
var actx=null, analyser=null, data=null, srcNode=null;
function initAudio(){
  if(actx) return;
  var AC=window.AudioContext||window.webkitAudioContext;
  if(!AC) return;
  try{
    actx=new AC();
    analyser=actx.createAnalyser();
    analyser.fftSize=128; analyser.smoothingTimeConstant=.76;
    data=new Uint8Array(analyser.frequencyBinCount);
    srcNode=actx.createMediaElementSource(au);
    srcNode.connect(analyser); analyser.connect(actx.destination);
  }catch(e){ analyser=null; }
}
function beep(freq,dur,type,vol,delay){
  if(!actx) return;
  var t=actx.currentTime+(delay||0);
  var o=actx.createOscillator(), g=actx.createGain();
  o.type=type||"square"; o.frequency.setValueAtTime(freq,t);
  g.gain.setValueAtTime(.0001,t);
  g.gain.exponentialRampToValueAtTime(vol||.12,t+.012);
  g.gain.exponentialRampToValueAtTime(.0001,t+dur);
  o.connect(g); g.connect(actx.destination);
  o.start(t); o.stop(t+dur+.02);
}
var coinSound=function(){ beep(988,.11,"square",.14,0); beep(1319,.20,"square",.13,.085); };
var blip=function(){ beep(660,.05,"square",.05,0); };

/* ============ TRACK LIST ============ */
function slugify(s){ return s.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,""); }
var liveEl=$("#live");
function say(msg){ if(liveEl) liveEl.textContent=msg; }

var listEl=$("#trackList");
TRACKS.forEach(function(tr,i){
  tr.slug=slugify(tr.t);
  var li=document.createElement("li");
  li.className="trk"; li.dataset.i=i; li.tabIndex=0;
  li.setAttribute("role","button");
  li.setAttribute("aria-label","Play "+tr.t);
  li.innerHTML='<span class="n">'+(tr.n<10?"0":"")+tr.n+'</span>'+
    '<span class="t"></span>'+
    '<span class="d">'+mmss(tr.d/1000)+'</span>'+
    '<button class="q" type="button" title="Add to queue">+</button>'+
    '<a class="sp" href="https://open.spotify.com/track/'+tr.id+'" target="_blank" rel="noopener" title="Full track on Spotify">FULL ↗</a>';
  li.querySelector(".t").textContent=tr.t;
  var qb=li.querySelector(".q");
  qb.setAttribute("aria-label","Add "+tr.t+" to the queue");
  qb.addEventListener("click",function(e){ e.stopPropagation(); enqueue(i); });
  li.addEventListener("click",function(e){
    if(e.target.closest(".sp")||e.target.closest(".q")) return;
    select(i,true);
  });
  li.addEventListener("keydown",function(e){
    if(e.key==="Enter"||e.key===" "){ e.preventDefault(); select(i,true); }
  });
  li.addEventListener("mouseenter",function(){ if(powered) blip(); });
  listEl.appendChild(li);
});
var rows=[].slice.call(listEl.children);

/* ============ QUEUE — a real rocola stacks up songs ============ */
var queue=[], qListEl=$("#queueList"), qEmptyEl=$("#qEmpty"), qClearEl=$("#qClear");

function paintQueue(){
  qListEl.innerHTML="";
  queue.forEach(function(ti,pos){
    var li=document.createElement("li");
    li.className="qrow";
    li.innerHTML='<span class="qn">'+(pos+1)+'</span><span class="qt"></span>'+
      '<button class="qx" type="button" aria-label="Remove from queue">✕</button>';
    li.querySelector(".qt").textContent=TRACKS[ti].t;
    li.querySelector(".qx").addEventListener("click",function(){
      queue.splice(pos,1); paintQueue(); paintRows(); blip();
    });
    qListEl.appendChild(li);
  });
  qEmptyEl.style.display = queue.length ? "none" : "";
  qClearEl.style.display = queue.length ? "" : "none";
}
function enqueue(i){
  if(queue.length>=20) return;
  queue.push(i);
  paintQueue(); paintRows(); bumpIdle();
  beep(1046,.05,"square",.07,0); beep(1568,.07,"square",.06,.05);
  pressButton(i%2?"b":"a");
  say(TRACKS[i].t+" added to the queue, position "+queue.length);
}
qClearEl.addEventListener("click",function(){ queue=[]; paintQueue(); paintRows(); blip(); });

/* ============ HIGH SCORES — play counts persisted locally ============ */
var HS_KEY="ana_plays_v1", plays={};
try{ plays=JSON.parse(localStorage.getItem(HS_KEY))||{}; }catch(e){ plays={}; }

function bumpPlay(i){
  var k=TRACKS[i].slug;
  plays[k]=(plays[k]||0)+1;
  try{ localStorage.setItem(HS_KEY,JSON.stringify(plays)); }catch(e){}
  paintScores();
}
function paintScores(){
  var el=$("#hsList"), sfx=["ST","ND","RD","TH","TH"];
  var ranked=TRACKS.map(function(t){ return {t:t.t,c:plays[t.slug]||0}; })
    .filter(function(r){ return r.c>0; })
    .sort(function(a,b){ return b.c-a.c; }).slice(0,5);
  var total=0; for(var k in plays) if(plays.hasOwnProperty(k)) total+=plays[k];
  $("#hsTotal").textContent = total+(total===1?" PLAY":" PLAYS");
  if(!ranked.length){
    el.innerHTML='<div class="qempty">NO PLAYS YET · THE MACHINE IS WAITING</div>';
    return;
  }
  el.innerHTML="";
  ranked.forEach(function(r,i){
    var d=document.createElement("div"); d.className="hsrow";
    d.innerHTML='<span class="rank">'+(i+1)+sfx[i]+'</span><span class="hst"></span>'+
      '<span class="hsc">×'+r.c+'</span>';
    d.querySelector(".hst").textContent=r.t;
    el.appendChild(d);
  });
}

/* ============ ATTRACT MODE — the cabinet demos itself when idle ============ */
var idleAt=0, attractIx=0, ATTRACT=[
  "SELECT A TRACK","▸ A NEW ASCENSION","THE IMPLICATE ORDER",
  "ROCK FOR NERDS","11 TRACKS · JACKSONVILLE FL","▸ INSERT COIN"
];
function bumpIdle(){
  idleAt=(window.performance?performance.now():Date.now());
  if(attractIx!==0){ attractIx=0; if(crtIdle) crtIdle.textContent=ATTRACT[0]; }
}
setInterval(function(){
  if(!powered || cur>=0 || !au.paused) return;
  var now=(window.performance?performance.now():Date.now());
  if(now-idleAt < 12000) return;
  attractIx=(attractIx+1)%ATTRACT.length;
  if(crtIdle) crtIdle.textContent=ATTRACT[attractIx];
},2800);

/* ============ FREE PLAY — for the nerds ============ */
var freeplay=false;
var KONAMI=["arrowup","arrowup","arrowdown","arrowdown","arrowleft","arrowright","arrowleft","arrowright","b","a"];
var kIx=0;
function konamiKey(k){
  k=String(k).toLowerCase();
  if(k===KONAMI[kIx]){
    if(++kIx===KONAMI.length){ kIx=0; unlockFreePlay(); }
  }else{
    kIx = (k===KONAMI[0]) ? 1 : 0;
  }
}
function unlockFreePlay(){
  if(freeplay) return;
  freeplay=true;
  if(crtCredit) crtCredit.textContent="FREE PLAY";
  say("Free play unlocked");
  [523,659,784,1046,1319].forEach(function(f,i){ beep(f,.13,"square",.10,i*.085); });
  throwStick(1);
  setTimeout(function(){ throwStick(-1); },230);
  setTimeout(function(){ pressButton("a"); },430);
  setTimeout(function(){ pressButton("b"); },570);
  flash(glowCoin,1000); flash(glowA,700); flash(glowB,900);
}

/* ============ CRT ============ */
var crtStatus=$("#crtStatus"), crtCredit=$("#crtCredit"), crtIdle=$("#crtIdle"),
    crtNow=$("#crtNow"), crtNum=$("#crtNum"), crtTitle=$("#crtTitle"),
    crtFill=$("#crtFill"), crtTime=$("#crtTime"), crtBar=$("#crtBar");

function paintCRT(){
  if(cur<0){
    crtIdle.style.display=""; crtNow.style.display="none";
    crtStatus.textContent=powered?"◈ READY":"◈ STANDBY";
    crtFill.style.width="0%"; crtTime.textContent="0:00 / 0:30";
    return;
  }
  var tr=TRACKS[cur];
  crtIdle.style.display="none"; crtNow.style.display="";
  crtNum.textContent="TRACK "+(tr.n<10?"0":"")+tr.n;
  crtTitle.textContent=tr.t;
  // long titles step down a size instead of wrapping into the spectrum band
  crtTitle.className="crt-title"+(tr.t.length>19?" xlong":(tr.t.length>13?" long":""));
  crtStatus.textContent = buffering ? "◈ LOADING…"
    : (au.paused ? "◈ PAUSED" : "◈ NOW PLAYING");
}
function paintRows(){
  rows.forEach(function(r,i){
    r.classList.toggle("active",i===cur);
    r.classList.toggle("playing",i===cur&&!au.paused);
    r.classList.toggle("queued",queue.indexOf(i)>=0);
  });
}

/* ============ PLAYBACK ============ */
function select(i,play){
  if(i<0||i>=TRACKS.length) return;
  if(i===cur && au.src){
    if(play) toggle();
    return;
  }
  cur=i; counted=false; buffering=true;
  rows[i].classList.remove("dead");
  au.src=TRACKS[i].p;
  au.load();
  if(play!==false){
    var pr=au.play();
    if(pr&&pr.catch) pr.catch(function(){});
  }
  setHash(i); bumpIdle();
  document.dispatchEvent(new CustomEvent("ana:track",
    { detail:{ title:TRACKS[i].t, slug:TRACKS[i].slug } }));
  say("Now playing, track "+TRACKS[i].n+", "+TRACKS[i].t);
  credits++;
  if(!freeplay) crtCredit.textContent="CREDIT "+(credits<10?"0":"")+credits;
  beep(880,.06,"square",.07,0); beep(1175,.08,"square",.07,.06);
  // the hand confirms the selection a beat after the stick moves
  var side = (i%2) ? "b" : "a";
  setTimeout(function(){ pressButton(side); }, 90);
  paintCRT(); paintRows();
}
function toggle(){
  pressButton("b");
  if(cur<0){ select(0,true); return; }
  if(au.paused){
    if(actx&&actx.state==="suspended") actx.resume();
    var pr=au.play(); if(pr&&pr.catch) pr.catch(function(){});
  } else au.pause();
}
function step(dir){
  throwStick(dir>0?1:-1);      // left hand shoves the joystick
  if(shuffle && TRACKS.length>1){
    var r=cur;
    while(r===cur) r=Math.floor(Math.random()*TRACKS.length);
    select(r,true); return;
  }
  var n=cur<0?0:(cur+dir+TRACKS.length)%TRACKS.length;
  select(n,true);
}

au.addEventListener("play",function(){ $("#bPlay").textContent="❚❚"; paintCRT(); paintRows(); });
au.addEventListener("pause",function(){ $("#bPlay").textContent="▶"; paintCRT(); paintRows(); });
au.addEventListener("pause",function(){ document.dispatchEvent(new CustomEvent("ana:stop")); });
au.addEventListener("ended",function(){
  if(queue.length){                       // the queue always wins
    var n=queue.shift(); paintQueue(); paintRows(); select(n,true); return;
  }
  step(1);
});
// buffering feedback, so a slow network doesn't look like a dead click
au.addEventListener("waiting",function(){ buffering=true; paintCRT(); });
au.addEventListener("canplay",function(){ buffering=false; paintCRT(); });
au.addEventListener("playing",function(){
  buffering=false;
  if(!counted && cur>=0){ counted=true; bumpPlay(cur); }
  paintCRT();
});
au.addEventListener("timeupdate",function(){
  var dur=isFinite(au.duration)&&au.duration>0?au.duration:30;
  var pct=Math.min(100,(au.currentTime/dur)*100);
  crtFill.style.width=pct+"%";
  crtTime.textContent=mmss(au.currentTime)+" / "+mmss(dur);
});
au.addEventListener("error",function(){
  if(cur<0) return;
  rows[cur].classList.add("dead");
  crtStatus.textContent="◈ PREVIEW OFFLINE";
  crtTitle.textContent=TRACKS[cur].t;
  crtNum.textContent="PLAY ON SPOTIFY ↗";
});
crtBar.addEventListener("click",function(e){
  if(cur<0||!isFinite(au.duration)) return;
  var r=crtBar.getBoundingClientRect();
  au.currentTime=Math.max(0,Math.min(au.duration,((e.clientX-r.left)/r.width)*au.duration));
});

/* ============ CONTROLS ============ */
$("#bPlay").addEventListener("click",toggle);
$("#bPrev").addEventListener("click",function(){ step(-1); });
$("#bNext").addEventListener("click",function(){ step(1); });
$("#bShuf").addEventListener("click",function(){
  shuffle=!shuffle;
  this.classList.toggle("on",shuffle);
  this.setAttribute("aria-pressed",shuffle?"true":"false");
  say(shuffle?"Shuffle on":"Shuffle off");
  blip();
});
var vol=$("#vol");
function applyVol(){
  au.volume=vol.value/100;
  vol.style.setProperty("--p",vol.value+"%");
}
vol.addEventListener("input",applyVol); applyVol();

document.addEventListener("keydown",function(e){
  if(/^(INPUT|TEXTAREA)$/.test(e.target.tagName)) return;
  konamiKey(e.key);
  bumpIdle();
  if(e.key===" "){ e.preventDefault(); toggle(); }
  else if(e.key==="ArrowRight") step(1);
  else if(e.key==="ArrowLeft") step(-1);
  else if(e.key>="1"&&e.key<="9") select(parseInt(e.key,10)-1,true);
  else if(e.key==="0") select(9,true);            // track 10
  else if(e.key==="-") select(10,true);           // track 11
});
document.addEventListener("pointerdown",bumpIdle,{passive:true});

/* ============ INSERT COIN ============ */
$("#coinBtn").addEventListener("click",function(){
  initAudio();
  if(actx&&actx.state==="suspended") actx.resume();
  coinSound();
  flash(glowCoin,700);
  powered=true;
  document.body.classList.add("on");
  $("#boot").classList.add("gone");
  credits=0; crtCredit.textContent="CREDIT 01";   // first auto-select bumps this to 01
  bumpIdle(); paintCRT();
  var start=hashTrack();                          // honour a shared /#track link
  setTimeout(function(){ select(start>=0?start:0,true); },900);
});

document.addEventListener("ana:joinsound",function(){
  if(!powered) return;
  beep(1318,.07,"square",.05,0); beep(1760,.09,"square",.045,.07);
  flash(glowCoin,600);
});

/* ============ VISUALIZER ============ */
var cv=$("#viz"), cx=cv.getContext("2d");
var COLS=30, ROWS=14, cw=0, ch=0;
// the bars live in their own band: below the title, above the progress readout
var BAR_TOP=.33, BAR_FLOOR=.575;
function sizeViz(){
  var dpr=Math.min(window.devicePixelRatio||1,2);
  var r=cv.getBoundingClientRect();
  cw=Math.max(1,Math.round(r.width*dpr));
  ch=Math.max(1,Math.round(r.height*dpr));
  cv.width=cw; cv.height=ch;
}
if(window.ResizeObserver) new ResizeObserver(sizeViz).observe(cv);
window.addEventListener("resize",sizeViz);
sizeViz();

// cell colour ramp: cyan (low) → amber (mid) → hot pink (peak)
function cellColor(rowFromBottom,col,t){
  if(freeplay) return "hsl("+((col*11+t*95)%360)+",95%,60%)";
  var f=rowFromBottom/(ROWS-1);
  if(f<.45) return "rgba(47,208,240,.95)";
  if(f<.72) return "rgba(247,184,67,.95)";
  return "rgba(255,45,85,.98)";
}

var t0=0;
function frame(ts){
  requestAnimationFrame(frame);
  t0=ts/1000;

  var live=analyser && !au.paused;
  if(live) analyser.getByteFrequencyData(data);

  /* ---- drive the hands (independent of the screen) ---- */
  var energy=0, lowE=0, b;
  if(live){
    for(b=1;b<13;b++) energy+=data[b]; energy/=(12*255);
    for(b=1;b<7;b++)  lowE  +=data[b]; lowE  /=(6*255);   // kick/bass band
  }
  beat += (energy-beat)*.22;

  // rising edge in the bass band = a hit; twitch the hands on it
  var flux=Math.max(0, lowE-lowPrev); lowPrev=lowE;
  fluxAvg += (flux-fluxAvg)*.05;
  if(live && !reduce && flux>Math.max(fluxAvg*2, .015) && t0>tapCool){
    tapCool=t0+.19;            // refractory: caps around 300bpm
    sTap.kick(1,60);
  }
  sJoy.step(); sPress.step(); sTap.step();
  var swayL = (powered&&!reduce) ? Math.sin(t0*1.05)*.75 : 0;
  var swayR = (powered&&!reduce) ? Math.sin(t0*.86+1.4)*.6 : 0;
  // the right hand's moving part is only the pointing fingers — keep its throw
  // small so it reads as a jab at the button, not a slide
  handL.style.transform = "rotate("+(sJoy.x*8 + swayL*.6 + beat*.9 + sTap.x*.55).toFixed(2)+"deg)";
  handR.style.transform = "rotate("+(-sPress.x*5 + swayR - beat*.8 - sTap.x*1.5).toFixed(2)+"deg)"+
    " translate("+(sPress.x*.6).toFixed(2)+"%,"+(sPress.x*2.6 + beat*.9 + sTap.x*1.1).toFixed(2)+"%)";
  // the marquee breathes with the track
  if(marquee) marquee.style.filter="brightness("+(1+beat*.35+sTap.x*.45).toFixed(3)+")";

  if(!cw||!ch||document.hidden) return;

  // --- screen background: deep CRT sky ---
  var g=cx.createLinearGradient(0,0,0,ch);
  g.addColorStop(0,"#06263c"); g.addColorStop(.55,"#04182a"); g.addColorStop(1,"#020a14");
  cx.fillStyle=g; cx.fillRect(0,0,cw,ch);

  // --- starfield drift ---
  cx.fillStyle="rgba(159,246,255,.5)";
  for(var s=0;s<26;s++){
    var sx=((s*137.5+t0*(powered?16:6))%100)/100*cw;
    var sy=((s*61.7)%100)/100*ch*.62;
    cx.fillRect(sx|0,sy|0,1.6,1.6);
  }

  // bars stand on a floor above the skeleton hands so they stay readable
  var floorY=ch*BAR_FLOOR, topY=ch*BAR_TOP;
  var cellW=cw/COLS, cellH=(floorY-topY)/ROWS, pad=Math.max(1,cellW*.16);
  for(var c=0;c<COLS;c++){
    var lvl;
    if(live){
      // spread the low/mid bins across the columns (music energy lives there)
      var bin=Math.floor(Math.pow(c/COLS,1.5)*(data.length*.7))+1;
      lvl=data[Math.min(bin,data.length-1)]/255;
      lvl=Math.pow(lvl,.82);
    }else{
      // attract mode: gentle idle wave
      lvl=(Math.sin(t0*1.6+c*.42)*.5+.5)*(powered?.30:.18)
         +(Math.sin(t0*2.7+c*.9)*.5+.5)*.12;
    }
    var lit=Math.max(reduce?1:0,Math.round(lvl*ROWS));
    for(var r=0;r<lit;r++){
      cx.fillStyle=cellColor(r,c,t0);
      cx.fillRect(c*cellW+pad, floorY-(r+1)*cellH+pad, cellW-pad*2, cellH-pad*2);
    }
    // peak cap
    if(lit>0){
      cx.fillStyle="rgba(255,255,255,.85)";
      cx.fillRect(c*cellW+pad, floorY-lit*cellH+pad, cellW-pad*2, Math.max(1,cellH*.16));
    }
  }

  // --- floor line + glow under the bars ---
  var hg=cx.createLinearGradient(0,floorY-ch*.09,0,floorY);
  hg.addColorStop(0,"rgba(47,208,240,0)"); hg.addColorStop(1,"rgba(47,208,240,.16)");
  cx.fillStyle=hg; cx.fillRect(0,floorY-ch*.09,cw,ch*.09);
  cx.fillStyle="rgba(159,246,255,.5)"; cx.fillRect(0,floorY,cw,1.5);
}
requestAnimationFrame(frame);

/* ============ WARP BACKGROUND ============ */
var wc=$("#warp"), wx=wc.getContext("2d"), ww=0,wh=0,streaks=[];
function sizeWarp(){
  var dpr=Math.min(window.devicePixelRatio||1,1.5);
  ww=wc.width=Math.round(innerWidth*dpr);
  wh=wc.height=Math.round(innerHeight*dpr);
  streaks=[];
  for(var i=0;i<130;i++) streaks.push(mkStreak(true));
}
function mkStreak(spread){
  var a=Math.random()*Math.PI*2;
  return {a:a, r:spread?Math.random()*Math.max(ww,wh)*.6:20,
          v:.6+Math.random()*2.4, len:30+Math.random()*140,
          h:Math.random()<.16?18:190+Math.random()*30, o:.25+Math.random()*.55};
}
function warpFrame(){
  if(reduce) return;
  requestAnimationFrame(warpFrame);
  if(document.hidden) return;
  wx.fillStyle="rgba(4,6,14,.30)"; wx.fillRect(0,0,ww,wh);
  var mx=ww/2, my=wh*.42, boost=(powered&&!au.paused)?1.9:1;
  for(var i=0;i<streaks.length;i++){
    var s=streaks[i];
    s.r+=s.v*boost*(1+s.r/700);
    var x1=mx+Math.cos(s.a)*s.r, y1=my+Math.sin(s.a)*s.r;
    var x2=mx+Math.cos(s.a)*(s.r+s.len), y2=my+Math.sin(s.a)*(s.r+s.len);
    wx.strokeStyle="hsla("+s.h+",95%,62%,"+s.o+")";
    wx.lineWidth=1.1;
    wx.beginPath(); wx.moveTo(x1,y1); wx.lineTo(x2,y2); wx.stroke();
    if(s.r>Math.max(ww,wh)*.85) streaks[i]=mkStreak(false);
  }
}
window.addEventListener("resize",sizeWarp);
sizeWarp();
if(!reduce) requestAnimationFrame(warpFrame);

paintCRT(); paintQueue(); paintScores(); bumpIdle();
})();

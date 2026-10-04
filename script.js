(() => {
  const scene = document.getElementById('scene');
  const board = document.getElementById('board');
  const wrap = document.getElementById('boardWrap');
  const items = [...document.querySelectorAll('.item')];
  const threads = document.getElementById('threads');
  const clueMap = Object.fromEntries(items.map(el => [el.dataset.id, el]));

  const syncBadge = document.getElementById('syncBadge');
  const adminSync = document.getElementById('adminSyncState');
  const adminOverlay = document.getElementById('adminOverlay');
  const playerOverlay = document.getElementById('playerOverlay');
  const loginBlock = document.getElementById('loginBlock');
  const panelBlock = document.getElementById('panelBlock');

  let selected = null;
  let zCounter = 300;
  let viewport = {scale:1, x:0, y:0, initialized:false};
  let role = 'viewer'; // viewer | player | admin
  let firebaseReady = false;
  let db = null;
  let auth = null;
  let boardRef = null;
  let remoteState = {};
  const defaults = {};

  items.forEach((el, i) => {
    el.querySelectorAll('img').forEach(img => {
      img.draggable = false;
      img.addEventListener('dragstart', e => e.preventDefault());
    });
    defaults[el.dataset.id] = {
      visible: false,
      x: parseFloat(el.style.left),
      y: parseFloat(el.style.top),
      rot: parseFloat(getComputedStyle(el).getPropertyValue('--rot')) || 0,
      z: i + 10
    };
    el.classList.add('clue-hidden');
  });

  const canMove = () => role === 'player' || role === 'admin';
  const isAdmin = () => role === 'admin';


  // Keep every clue completely inside the investigation board, even after rotation.
  function clampToBoard(el, x, y, rotOverride=null) {
    const boardW = board.clientWidth;
    const boardH = board.clientHeight;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const id = el.dataset.id;
    const stateRot = Number((remoteState[id] || {}).rot ?? defaults[id]?.rot ?? 0);
    const rot = Number(rotOverride ?? stateRot) * Math.PI / 180;
    const c = Math.abs(Math.cos(rot));
    const s = Math.abs(Math.sin(rot));
    const halfBoxW = (w * c + h * s) / 2;
    const halfBoxH = (w * s + h * c) / 2;
    const margin = 10;
    const cx = x + w / 2;
    const cy = y + h / 2;
    const minCx = margin + halfBoxW;
    const maxCx = boardW - margin - halfBoxW;
    const minCy = margin + halfBoxH;
    const maxCy = boardH - margin - halfBoxH;
    const safeCx = Math.min(Math.max(cx, minCx), Math.max(minCx, maxCx));
    const safeCy = Math.min(Math.max(cy, minCy), Math.max(minCy, maxCy));
    return {x: safeCx - w / 2, y: safeCy - h / 2};
  }

  function firebaseConfigured() {
    const c = window.FIREBASE_CONFIG || {};
    return c.apiKey && !String(c.apiKey).includes('PASTE_') &&
           c.projectId && !String(c.projectId).includes('PASTE_') &&
           c.databaseURL && !String(c.databaseURL).includes('PASTE_');
  }

  function setStatus(text, ok=false) {
    syncBadge.textContent = text;
    syncBadge.classList.toggle('offline', !ok);
    if (adminSync) adminSync.textContent = text;
  }

  function applyRole(user) {
    const email = user?.email || '';
    if (email === window.BOARD_EDITOR_EMAIL) role = 'admin';
    else if (email === window.BOARD_PLAYER_EMAIL) role = 'player';
    else role = 'viewer';

    document.body.classList.toggle('editor-mode', canMove());
    document.body.classList.toggle('player-mode', role === 'player');
    document.body.classList.toggle('admin-mode', role === 'admin');

    items.forEach(el => el.classList.toggle('viewer-locked', !canMove()));

    const playerLogged = document.getElementById('playerLoggedBlock');
    if (playerLogged) playerLogged.classList.toggle('hidden', role !== 'player');

    if (role === 'admin') {
      loginBlock.classList.add('hidden');
      panelBlock.classList.remove('hidden');
      setStatus('● Realtime · администратор', true);
      ensureInitialized();
    } else {
      panelBlock.classList.add('hidden');
      loginBlock.classList.remove('hidden');
      setStatus(role === 'player'
        ? '● Realtime · участник может двигать улики'
        : '● Realtime · только просмотр', true);
    }
  }

  function initFirebase() {
    if (!firebaseConfigured()) {
      setStatus('Firebase не настроен', false);
      return;
    }

    try {
      firebase.initializeApp(window.FIREBASE_CONFIG);
      auth = firebase.auth();
      db = firebase.database();
      boardRef = db.ref('boards/main/items');
      firebaseReady = true;

      auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(()=>{});

      auth.onAuthStateChanged(user => applyRole(user));

      boardRef.on('value', snap => {
        remoteState = snap.val() || {};
        applyRemoteState();
      }, err => {
        console.error(err);
        setStatus('Ошибка Firebase / Database Rules', false);
      });
    } catch (err) {
      console.error(err);
      setStatus('Firebase не запустился', false);
    }
  }

  async function ensureInitialized() {
    if (!isAdmin() || !boardRef) return;
    const snap = await boardRef.once('value');
    const current = snap.val() || {};
    const updates = {};
    let changed = false;

    Object.entries(defaults).forEach(([id, def]) => {
      if (!current[id]) {
        updates[id] = def;
        changed = true;
      }
    });

    if (changed) await boardRef.update(updates);
  }

  function applyRemoteState() {
    items.forEach(el => {
      const id = el.dataset.id;
      const s = {...defaults[id], ...(remoteState[id] || {})};

      el.classList.toggle('clue-hidden', !s.visible);
      el.style.setProperty('--rot', Number(s.rot) + 'deg');
      const safe = clampToBoard(el, Number(s.x), Number(s.y), Number(s.rot));
      el.style.left = safe.x + 'px';
      el.style.top = safe.y + 'px';
      el.style.zIndex = Number(s.z) || 10;

      const cb = document.querySelector(`[data-clue="${CSS.escape(id)}"]`);
      if (cb) cb.checked = !!s.visible;
    });
    drawThreads();
  }

  // ===== Board pan / zoom: everyone =====
  function fit() {
    const s = Math.min(innerWidth/2200, innerHeight/1400) * .97;
    if (!viewport.initialized) {
      viewport.scale = s;
      viewport.x = (innerWidth - 2200*s)/2;
      viewport.y = (innerHeight - 1400*s)/2;
      viewport.initialized = true;
    }
    updateWrap();
  }
  function updateWrap() {
    wrap.style.transform = `translate(${viewport.x}px,${viewport.y}px) scale(${viewport.scale})`;
  }
  addEventListener('resize', fit);
  fit();

  let panning=false, pan={};
  scene.addEventListener('pointerdown', e => {
    if (e.target.closest('.item') || e.target.closest('#adminButton') || e.target.closest('#playerButton') || e.target.closest('#helpCard')) return;
    panning = true;
    scene.classList.add('panning');
    pan = {x:e.clientX, y:e.clientY, ox:viewport.x, oy:viewport.y};
  });
  addEventListener('pointermove', e => {
    if (!panning) return;
    viewport.x = pan.ox + e.clientX - pan.x;
    viewport.y = pan.oy + e.clientY - pan.y;
    updateWrap();
  });
  addEventListener('pointerup', () => {
    panning=false;
    scene.classList.remove('panning');
  });

  scene.addEventListener('wheel', e => {
    if (e.target.closest('.item') && e.altKey) return;
    e.preventDefault();
    const old = viewport.scale;
    const next = Math.max(.5, Math.min(1.75, old * (e.deltaY < 0 ? 1.06 : .94)));
    const bx = (e.clientX - viewport.x) / old;
    const by = (e.clientY - viewport.y) / old;
    viewport.scale = next;
    viewport.x = e.clientX - bx * next;
    viewport.y = e.clientY - by * next;
    updateWrap();
  }, {passive:false});

  // ===== Shared item movement: player + admin =====
  let lastWriteAt = 0;
  function writeItem(id, values, force=false) {
    if (!canMove() || !db) return;
    const now = performance.now();
    if (!force && now - lastWriteAt < 45) return;
    lastWriteAt = now;
    db.ref(`boards/main/items/${id}`).update(values).catch(err => {
      console.error('Move write rejected:', err);
    });
  }

  items.forEach(el => {
    let dragging=false;
    let start={};

    el.addEventListener('pointerdown', e => {
      if (e.target.closest('input, button, textarea, select, a')) return;
      if (e.button !== 0 || !canMove()) return;
      e.preventDefault();
      e.stopPropagation();
      dragging=true;
      try { el.setPointerCapture(e.pointerId); } catch (_) {}

      const id=el.dataset.id;
      const s={...defaults[id], ...(remoteState[id] || {})};
      start={x:e.clientX, y:e.clientY, left:Number(s.x), top:Number(s.y)};

      const z=++zCounter;
      el.style.zIndex=z;
      writeItem(id,{z},true);

      if(selected) selected.classList.remove('selected');
      selected=el;
      el.classList.add('selected','dragging');
    });

    el.addEventListener('pointermove', e => {
      if(!dragging || !canMove()) return;
      const id=el.dataset.id;
      const rawX=start.left+(e.clientX-start.x)/viewport.scale;
      const rawY=start.top+(e.clientY-start.y)/viewport.scale;
      const s={...defaults[id], ...(remoteState[id] || {})};
      const safe=clampToBoard(el,rawX,rawY,Number(s.rot));
      el.style.left=safe.x+'px';
      el.style.top=safe.y+'px';
      drawThreads();
      writeItem(id,{x:Math.round(safe.x*10)/10,y:Math.round(safe.y*10)/10});
    });

    const finish=()=>{
      if(!dragging) return;
      dragging=false;
      el.classList.remove('dragging');
      writeItem(el.dataset.id,{
        x:parseFloat(el.style.left),
        y:parseFloat(el.style.top),
        z:parseInt(el.style.zIndex||'10',10)
      },true);
    };
    el.addEventListener('pointerup',finish);
    el.addEventListener('pointercancel',finish);
    el.addEventListener('lostpointercapture',finish);

    el.addEventListener('wheel', e => {
      if(!e.altKey || !canMove()) return;
      e.preventDefault();
      const id=el.dataset.id;
      const s={...defaults[id], ...(remoteState[id] || {})};
      const rot=Number(s.rot)+(e.deltaY>0?4:-4);
      el.style.setProperty('--rot',rot+'deg');
      writeItem(id,{rot},true);
      drawThreads();
    },{passive:false});
  });

  addEventListener('keydown', e => {
    if(selected && canMove() && ['q','Q','e','E'].includes(e.key)) {
      const id=selected.dataset.id;
      const s={...defaults[id], ...(remoteState[id] || {})};
      const rot=Number(s.rot)+(e.key.toLowerCase()==='q'?-5:5);
      selected.style.setProperty('--rot',rot+'deg');
      writeItem(id,{rot},true);
      drawThreads();
    }
    if(e.key==='Escape'){
      adminOverlay.classList.add('hidden');
      playerOverlay.classList.add('hidden');
    }
  });

  function center(el){
    return {x:parseFloat(el.style.left)+el.offsetWidth/2,y:parseFloat(el.style.top)+el.offsetHeight/2};
  }
  function drawThreads(){
    threads.innerHTML='';
    (window.BOARD_DATA.connections||[]).forEach(([a,b])=>{
      const A=clueMap[a],B=clueMap[b];
      if(!A||!B||A.classList.contains('clue-hidden')||B.classList.contains('clue-hidden')) return;
      const p=center(A),q=center(B);
      const line=document.createElementNS('http://www.w3.org/2000/svg','line');
      line.setAttribute('x1',p.x); line.setAttribute('y1',p.y);
      line.setAttribute('x2',q.x); line.setAttribute('y2',q.y);
      line.setAttribute('stroke','#a2141a');
      line.setAttribute('stroke-width','3.5');
      line.setAttribute('opacity','.9');
      line.setAttribute('stroke-linecap','round');
      threads.appendChild(line);
    });
  }

  // ===== Player access =====
  document.getElementById('playerButton').onclick = () => {
    playerOverlay.classList.remove('hidden');
    const logged = document.getElementById('playerLoggedBlock');
    logged.classList.toggle('hidden', role !== 'player');
    document.getElementById('playerPass').focus();
  };
  document.getElementById('closePlayer').onclick = () => playerOverlay.classList.add('hidden');
  playerOverlay.querySelector('.backdrop').onclick = () => playerOverlay.classList.add('hidden');

  async function playerLogin(){
    const err=document.getElementById('playerLoginErr');
    err.textContent='';
    if(!firebaseReady || !auth){
      err.textContent='Firebase не подключён.';
      return;
    }
    try{
      await auth.signInWithEmailAndPassword(window.BOARD_PLAYER_EMAIL, document.getElementById('playerPass').value);
      document.getElementById('playerPass').value='';
      playerOverlay.classList.add('hidden');
    }catch(e){
      console.error(e);
      err.textContent='Неверный пароль участника.';
    }
  }
  document.getElementById('playerLoginBtn').onclick=playerLogin;
  document.getElementById('playerPass').addEventListener('keydown',e=>{if(e.key==='Enter')playerLogin()});
  document.getElementById('playerLogoutBtn').onclick=async()=>{if(auth)await auth.signOut();};

  // ===== Admin access =====
  document.getElementById('adminButton').onclick=()=>{
    adminOverlay.classList.remove('hidden');
    if(!isAdmin()) document.getElementById('pass').focus();
  };
  document.getElementById('closeAdmin').onclick=()=>adminOverlay.classList.add('hidden');
  adminOverlay.querySelector('.backdrop').onclick=()=>adminOverlay.classList.add('hidden');

  async function adminLogin(){
    const err=document.getElementById('loginErr');
    err.textContent='';
    if(!firebaseReady || !auth){
      err.textContent='Firebase не подключён.';
      return;
    }
    try{
      await auth.signInWithEmailAndPassword(window.BOARD_EDITOR_EMAIL, document.getElementById('pass').value);
      document.getElementById('pass').value='';
      await ensureInitialized();
    }catch(e){
      console.error(e);
      err.textContent='Неверный пароль администратора.';
    }
  }
  document.getElementById('loginBtn').onclick=adminLogin;
  document.getElementById('pass').addEventListener('keydown',e=>{if(e.key==='Enter')adminLogin()});
  document.getElementById('logoutBtn').onclick=async()=>{if(auth)await auth.signOut();};

  // Admin-only visibility controls
  document.querySelectorAll('[data-clue]').forEach(cb=>{
    cb.addEventListener('change',()=>{
      if(!isAdmin() || !db){
        cb.checked=!cb.checked;
        return;
      }
      db.ref(`boards/main/items/${cb.dataset.clue}/visible`).set(cb.checked);
    });
  });

  document.querySelector('.quick').addEventListener('click',e=>{
    const q=e.target.dataset.quick;
    if(!q || !isAdmin() || !boardRef) return;
    const maxStage=q==='day1'?1:q==='day2'?2:q==='all'?99:0;
    const updates={};
    items.forEach(el=>{
      updates[`${el.dataset.id}/visible`]=q==='none'?false:Number(el.dataset.stage)<=maxStage;
    });
    boardRef.update(updates);
  });

  document.getElementById('resetPositions').onclick=async()=>{
    if(!isAdmin() || !boardRef) return;
    const updates={};
    Object.entries(defaults).forEach(([id,d])=>{
      updates[`${id}/x`]=d.x;
      updates[`${id}/y`]=d.y;
      updates[`${id}/rot`]=d.rot;
      updates[`${id}/z`]=d.z;
    });
    await boardRef.update(updates);
  };


  // ===== Murphy USB decoder =====
  const decoderNote=document.getElementById('murphyDecoder');
  if(decoderNote){
    const decoderInput=decoderNote.querySelector('.decoder-input');
    const decoderSubmit=decoderNote.querySelector('.decoder-submit');
    const decoderReset=decoderNote.querySelector('.decoder-reset');
    const decoderResult=decoderNote.querySelector('.decoder-result');

    function normalizeMurphyKey(value){
      return value.trim().toUpperCase().replace(/\s+/g,' ');
    }

    function checkMurphyKey(){
      if(normalizeMurphyKey(decoderInput.value)==='15.06.2026 РПМ'){
        decoderResult.className='decoder-result success';
        decoderResult.innerHTML='&gt; КЛЮЧ ПРИНЯТ<br>&gt; ПРОВЕРКА ДАННЫХ... OK<br>&gt; ДОСТУП РАЗРЕШЁН';
      }else{
        decoderResult.className='decoder-result error';
        decoderResult.innerHTML='&gt; ОШИБКА: НЕВЕРНЫЙ КЛЮЧ<br>&gt; ACCESS DENIED';
      }
    }

    decoderSubmit.addEventListener('click',e=>{e.stopPropagation();checkMurphyKey();});
    decoderInput.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();e.stopPropagation();checkMurphyKey();}});
    decoderReset.addEventListener('click',e=>{
      e.stopPropagation();
      decoderInput.value='';
      decoderResult.className='decoder-result';
      decoderResult.innerHTML='';
      decoderInput.focus();
    });
  }

  initFirebase();
})();

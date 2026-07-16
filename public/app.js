import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getDatabase, ref, onValue, runTransaction } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js';
import { firebaseConfig } from './firebase-config.js';

(function(){
  'use strict';

  // ================= Constants =================
  var ROLE = window.SGT_ROLE === 'fac' ? 'fac'
           : window.SGT_ROLE === 'spec' ? 'spec' : 'part';
  var SPECTATE = ROLE === 'spec';   // audience view: read-only, never signs in, never writes
  var ROOM = (new URLSearchParams(location.search).get('room') || 'default')
    .replace(/[^a-zA-Z0-9_-]/g,'').slice(0,40) || 'default';
  var ME_KEY = 'sgt-me-' + ROOM + '-' + ROLE;
  var TOP_VOTES = 3;
  var PHASES = [
    { name:'Setup',
      hint:'Performers, sign in from your own device. Host starts the show when the cast is complete.',
      next:'Start the show \u2192' },
    { name:'Act 1 \u2014 Auditions',
      hint:'Performers: add your acts to the three zones \u2014 hits, flops, and new ideas. Stage names encouraged. The host keeps time.',
      next:'To the judging \u2192' },
    { name:'Act 2 \u2014 The Judging',
      hint:'Judge every OTHER performer\u2019s act: \u2b50 yes or \u274c X. You have exactly ONE \ud83d\udd14 golden buzzer \u2014 it sends an act straight to the finals.',
      next:'To the semifinals \u2192' },
    { name:'Act 3 \u2014 Semifinals',
      hint:'Discuss the strongest acts, then cast your \ud83c\udfc6 top-3 votes. The winners headline the finals.',
      next:'Results show \u2192' },
    { name:'Act 4 \u2014 Results Show',
      hint:'The finalists are locked in. Turn them into action items \u2014 every action needs an owner.',
      next:null }
  ];
  var catLabel = { well:'Hit', flop:'Flop', idea:'New act' };

  function $(id){ return document.getElementById(id); }

  // ================= State =================
  function blankState(){
    return { phase:0, sprintName:'', participants:[], cards:[], actions:[], timerEnd:null };
  }
  var state = blankState();
  var me = null;               // { name, role }
  var memoryOnly = false;
  var lastSnapshot = null;      // distinct from '' so the first (possibly empty) snapshot always applies

  // ================= Firebase =================
  // The whole board lives as one JSON string at rooms/<room>. Reads come through a
  // realtime onValue listener (no polling); writes go through an atomic transaction.
  var boardRef = null;
  function configLooksReal(cfg){
    return !!(cfg && cfg.databaseURL && cfg.databaseURL.indexOf('YOUR_') === -1
              && cfg.apiKey && cfg.apiKey.indexOf('YOUR_') === -1);
  }
  try{
    if(configLooksReal(firebaseConfig)){
      var fbApp = initializeApp(firebaseConfig);
      boardRef = ref(getDatabase(fbApp), 'rooms/' + ROOM);
    } else {
      memoryOnly = true;
    }
  }catch(e){ memoryOnly = true; }

  function uid(){ return Date.now().toString(36) + Math.random().toString(36).slice(2,7); }
  function esc(s){ var d=document.createElement('div'); d.textContent=s||''; return d.innerHTML; }

  // ================= Firebase storage =================
  function ensureShape(s){
    if(!s || typeof s !== 'object') s = blankState();
    if(typeof s.phase !== 'number') s.phase = 0;
    s.participants = s.participants || [];
    s.cards = s.cards || [];
    s.actions = s.actions || [];
    return s;
  }

  // Atomic read-modify-write on the shared board. Firebase runs the updater against
  // the latest value and retries on conflict, so concurrent judges never clobber each
  // other. Keep the updater pure (no side effects) — it may run more than once.
  function mutate(fn){
    if(SPECTATE) return Promise.resolve(false);   // spectators can never write to the board
    if(memoryOnly){
      fn(state);
      render();
      return Promise.resolve(true);
    }
    return runTransaction(boardRef, function(currentStr){
      var s;
      try{ s = currentStr ? JSON.parse(currentStr) : blankState(); }
      catch(e){ s = blankState(); }
      s = ensureShape(s);
      fn(s);
      return JSON.stringify(s);
    }).then(function(){ return true; }, function(){ return false; });
  }

  // Apply a snapshot pushed live from Firebase.
  function handleRemote(val){
    var str = (val == null) ? '' : String(val);
    if(str === lastSnapshot) return;             // no change (also skips the echo of our own write)
    var ae = document.activeElement;             // don't yank a field out from under someone typing
    if(ae && ae.tagName === 'INPUT' && (ae.closest('#actionsBody') || ae.closest('.composer'))) return;
    lastSnapshot = str;
    if(str){
      try{ state = ensureShape(JSON.parse(str)); }catch(e){ return; }
    } else {
      state = blankState();
    }
    if(me){
      if(!isInCast(me.name)){                     // board was reset since we joined
        me = null;
        try{ localStorage.removeItem(ME_KEY); }catch(e){}
        openGate();
      } else {
        closeGate();
      }
    }
    render();
  }

  function init(){
    if(SPECTATE){
      closeGate(); // audience never signs in
    } else {
      try{
        var m = localStorage.getItem(ME_KEY);
        if(m) me = JSON.parse(m);
      }catch(e){}
      if(me) closeGate(); // optimistic; handleRemote re-opens the gate if the board was reset
    }

    if(memoryOnly){
      $('saveNote').textContent = SPECTATE
        ? 'Firebase isn\u2019t configured \u2014 there\u2019s no live show to watch yet.'
        : 'Firebase isn\u2019t configured \u2014 running in single-device demo mode. Add your project config to firebase-config.js for the live shared board.';
      render();
      return;
    }

    render(); // first paint before the initial snapshot lands
    onValue(boardRef, function(snap){
      handleRemote(snap.val());
    }, function(){
      // Permission denied / unreachable \u2014 fall back to local-only so the page still works.
      memoryOnly = true;
      $('saveNote').textContent =
        'Live board unreachable \u2014 running locally. Check your Firebase config and database rules.';
      render();
    });
  }

  function isInCast(name){
    return state.participants.some(function(p){ return p.name === name; });
  }

  // ================= Role gate =================
  var gate = $('gate');
  function openGate(){ if(gate) gate.classList.remove('hidden'); }
  function closeGate(){ if(gate) gate.classList.add('hidden'); }

  function join(){
    var name = $('gateName').value.trim();
    var err = $('gateErr');
    if(!name){ err.textContent = 'The stage needs a name.'; return; }
    err.textContent = '';
    mutate(function(s){
      var existing = s.participants.find(function(p){ return p.name === name; });
      if(existing){ existing.role = ROLE; }
      else { s.participants.push({ name:name, role:ROLE }); }
    }).then(function(){
      me = { name:name, role:ROLE };
      try{ localStorage.setItem(ME_KEY, JSON.stringify(me)); }catch(e){}
      closeGate();
      render();
      toast(ROLE==='fac' ? 'You\u2019re hosting tonight, ' + name + '.' : 'Break a leg, ' + name + '.');
    });
  }
  if($('joinBtn')) $('joinBtn').addEventListener('click', join);
  if($('gateName')) $('gateName').addEventListener('keydown', function(e){ if(e.key==='Enter') join(); });

  // ================= Toast & confetti =================
  var toastEl = $('toast'), toastTimer = null;
  function toast(msg){
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function(){ toastEl.classList.remove('show'); }, 2800);
  }
  function confetti(){
    if(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    var colors = ['#f2b441','#ffd97a','#fff3d6','#e4707a','#7bc47f'];
    for(var i=0;i<70;i++){
      var p = document.createElement('div');
      p.className = 'confetti';
      p.style.left = (Math.random()*100)+'vw';
      p.style.background = colors[i%colors.length];
      p.style.animationDuration = (1.6+Math.random()*1.6)+'s';
      p.style.animationDelay = (Math.random()*0.4)+'s';
      document.body.appendChild(p);
      p.addEventListener('animationend', function(){ this.remove(); });
    }
  }

  // ================= Derived =================
  function isFac(){ return me && me.role === 'fac'; }
  function myGoldenUsed(){
    return state.cards.some(function(c){ return (c.golden||[]).indexOf(me.name) !== -1; });
  }
  function myTopVotesUsed(){
    return state.cards.reduce(function(n,c){
      return n + ((c.topVotes||[]).indexOf(me.name) !== -1 ? 1 : 0);
    }, 0);
  }
  function judgeCounts(c){
    var yes=0, x=0, j=c.judgments||{};
    Object.keys(j).forEach(function(k){ if(j[k]==='yes') yes++; else if(j[k]==='x') x++; });
    return { yes:yes, x:x };
  }
  function othersCards(){
    return state.cards.filter(function(c){ return c.author !== me.name; });
  }
  function myJudgedCount(){
    return othersCards().reduce(function(n,c){
      return n + ((c.judgments||{})[me.name] ? 1 : 0);
    }, 0);
  }
  function finalists(){
    var golden = state.cards.filter(function(c){ return (c.golden||[]).length > 0; });
    var rest = state.cards.filter(function(c){ return (c.golden||[]).length === 0; })
      .map(function(c){
        var jc = judgeCounts(c);
        return { c:c, tv:(c.topVotes||[]).length, score:jc.yes - jc.x };
      })
      .filter(function(r){ return r.tv > 0; })
      .sort(function(a,b){ return (b.tv - a.tv) || (b.score - a.score); })
      .slice(0, 3)
      .map(function(r){ return r.c; });
    return { golden:golden, voted:rest };
  }

  // Reorder the main sections in place to match a desired top-to-bottom sequence.
  // Only touches nodes that are actually out of place, so it won't disturb a field
  // being edited once the order is already settled.
  function orderSections(seq){
    for(var i=1;i<seq.length;i++){
      var prev = seq[i-1], node = seq[i];
      if(prev.nextSibling !== node) prev.parentNode.insertBefore(node, prev.nextSibling);
    }
  }

  // ================= Rendering =================
  function render(){
    var ph = state.phase || 0;
    var joined = !!me;

    // Sprint name (don't clobber while typing)
    var sn = $('sprintName');
    if(sn){
      if(document.activeElement !== sn) sn.value = state.sprintName || '';
      sn.disabled = !isFac();
    }

    // Phase banner
    $('phaseName').textContent = PHASES[ph].name;
    $('phaseHint').textContent = PHASES[ph].hint;
    var dots = $('phaseDots');
    dots.innerHTML = '';
    PHASES.forEach(function(_,i){
      var d = document.createElement('span');
      d.className = 'pdot' + (i<ph?' done':(i===ph?' now':''));
      dots.appendChild(d);
    });
    $('youChip').innerHTML = joined
      ? (isFac() ? 'Hosting as <b>'+esc(me.name)+'</b>' : 'Performing as <b>'+esc(me.name)+'</b>')
      : (SPECTATE ? 'Spectating · view only' : 'Not signed in');

    // Facilitator controls (host page only)
    if($('nextBtn')){
      var nextBtn = $('nextBtn');
      nextBtn.textContent = PHASES[ph].next || 'Show\u2019s over';
      nextBtn.disabled = !PHASES[ph].next || !joined;
      $('prevBtn').disabled = ph === 0 || !joined;
    }

    // Progress chip
    var pc = $('progressChip');
    if(joined && !isFac() && ph === 2){
      pc.classList.remove('hidden');
      pc.innerHTML = 'Judged <strong>' + myJudgedCount() + '/' + othersCards().length +
        '</strong>&nbsp;\u00b7&nbsp;\ud83d\udd14 ' + (myGoldenUsed() ? 'used' : 'ready');
    } else if(joined && !isFac() && ph === 3){
      pc.classList.remove('hidden');
      pc.innerHTML = '\ud83c\udfc6 votes left <strong>' + (TOP_VOTES - myTopVotesUsed()) + '/' + TOP_VOTES + '</strong>';
    } else if(joined && isFac() && ph === 2){
      pc.classList.remove('hidden');
      var total = 0, done = 0;
      state.participants.filter(function(p){ return p.role !== 'fac'; }).forEach(function(p){
        state.cards.forEach(function(c){
          if(c.author !== p.name){ total++; if((c.judgments||{})[p.name]) done++; }
        });
      });
      pc.innerHTML = 'Judging progress <strong>' + done + '/' + total + '</strong>';
    } else {
      pc.classList.add('hidden');
    }

    // No act timer during the Results Show
    if($('timerChip')) $('timerChip').classList.toggle('hidden', ph === 4);
    if($('timerBtn')) $('timerBtn').classList.toggle('hidden', ph === 4);
    if($('timerSel')) $('timerSel').classList.toggle('hidden', ph === 4);

    // Section visibility
    $('castBlock').classList.toggle('hidden', ph !== 0);
    $('boardMain').classList.toggle('hidden', ph === 0);
    $('finalsBlock').classList.toggle('hidden', ph < 3);
    $('actionsBlock').classList.toggle('hidden', ph !== 4);

    // Act 4 (Results Show): action items up top, the acts board at the bottom.
    // Every other phase keeps the acts board first. castBlock is the fixed anchor.
    orderSections(ph === 4
      ? [$('castBlock'), $('actionsBlock'), $('finalsBlock'), $('boardMain')]
      : [$('castBlock'), $('boardMain'), $('finalsBlock'), $('actionsBlock')]);

    // Cast list
    if(ph === 0){
      var cl = $('castList');
      cl.innerHTML = '';
      if(state.participants.length === 0){
        cl.innerHTML = '<div class="empty">Nobody backstage yet.</div>';
      }
      state.participants.forEach(function(p){
        var m = document.createElement('span');
        m.className = 'member' + (p.role==='fac' ? ' fac' : '');
        m.textContent = (p.role==='fac' ? '\u2605 ' : '') + p.name;
        cl.appendChild(m);
      });
    }

    // Composers only in Act 1, for performers (the host runs the show)
    document.querySelectorAll('.composer').forEach(function(cp){
      cp.style.display = (ph === 1 && joined && !isFac()) ? 'flex' : 'none';
    });

    // Cards
    ['well','flop','idea'].forEach(function(cat){
      var wrap = document.querySelector('.col[data-cat="'+cat+'"] .cards');
      wrap.innerHTML = '';
      var cs = state.cards.filter(function(c){ return c.cat === cat; });
      if(ph >= 1 && cs.length === 0){
        wrap.innerHTML = '<div class="empty">No acts yet.</div>';
      }
      cs.forEach(function(c){ wrap.appendChild(cardEl(c, ph, joined)); });
    });

    renderFinals(ph);
    renderActions(ph);
  }

  function cardEl(c, ph, joined){
    var mine = joined && c.author === me.name;
    var jc = judgeCounts(c);
    var goldenCount = (c.golden||[]).length;
    var el = document.createElement('div');
    el.className = 'act' + (goldenCount ? ' golden' : '') + (mine ? ' mine' : '');

    var html = '<div class="text">' + esc(c.text) + '</div>' +
               '<div class="author">by ' + esc(c.author) + (mine ? ' (you)' : '') + '</div>' +
               '<div class="meta">';
    if(goldenCount) html += '<span class="tag-gold">GOLDEN BUZZER \u00d7' + goldenCount + '</span>';

    if(ph === 1){
      if(mine || isFac()){
        html += '<button class="del" data-act="del" title="Remove card" aria-label="Remove card">&#10005;</button>';
      }
    }
    if(ph === 2 && joined){
      if(isFac()){
        html += '<span class="vote" style="cursor:default">\u2b50 <span class="n">'+jc.yes+'</span> \u00b7 \u274c <span class="n">'+jc.x+'</span></span>';
      } else if(mine){
        html += '<span class="own-note">Your act \u2014 the judges decide.</span>';
      } else {
        var myJ = (c.judgments||{})[me.name];
        var iBuzzed = (c.golden||[]).indexOf(me.name) !== -1;
        html += '<button class="vote'+(myJ==='yes'?' picked':'')+'" data-act="yes" title="Yes vote">\u2b50 <span class="n">'+jc.yes+'</span></button>';
        html += '<button class="vote'+(myJ==='x'?' picked':'')+'" data-act="x" title="X buzzer">\u274c <span class="n">'+jc.x+'</span></button>';
        html += '<button class="vote'+(iBuzzed?' buzzed':'')+'" data-act="gold" title="Golden buzzer \u2014 one per judge"'+((myGoldenUsed()&&!iBuzzed)?' disabled':'')+'>\ud83d\udd14</button>';
      }
    }
    if(ph === 3 && joined){
      var iVoted = (c.topVotes||[]).indexOf(me.name) !== -1;
      html += '<span class="vote" style="cursor:default">\u2b50 <span class="n">'+jc.yes+'</span> \u00b7 \u274c <span class="n">'+jc.x+'</span></span>';
      if(goldenCount){
        html += '<span class="own-note">Already in the finals.</span>';
      } else if(isFac()){
        html += '<span class="vote" style="cursor:default">\ud83c\udfc6 <span class="n">'+(c.topVotes||[]).length+'</span></span>';
      } else {
        var noVotesLeft = myTopVotesUsed() >= TOP_VOTES && !iVoted;
        html += '<button class="vote'+(iVoted?' picked':'')+'" data-act="top" title="Top-3 vote"'+(noVotesLeft?' disabled':'')+'>\ud83c\udfc6 <span class="n">'+(c.topVotes||[]).length+'</span></button>';
      }
    }
    if(ph === 4){
      html += '<span class="vote" style="cursor:default">\u2b50 '+jc.yes+' \u00b7 \ud83c\udfc6 '+(c.topVotes||[]).length+'</span>';
    }
    html += '</div>';
    el.innerHTML = html;

    el.querySelectorAll('button').forEach(function(b){
      b.addEventListener('click', function(){
        var act = b.getAttribute('data-act');
        // Decide golden-buzzer feedback from the current view; the transaction updater
        // below stays pure, so celebrate here once the write resolves instead.
        var willBuzz = act === 'gold' &&
          (c.golden||[]).indexOf(me.name) === -1 && !myGoldenUsed();
        mutate(function(s){
          var card = s.cards.find(function(x){ return x.id === c.id; });
          if(!card) return;
          card.judgments = card.judgments || {};
          card.golden = card.golden || [];
          card.topVotes = card.topVotes || [];
          if(act === 'del'){
            s.cards = s.cards.filter(function(x){ return x.id !== c.id; });
          }
          if(act === 'yes' || act === 'x'){
            card.judgments[me.name] = (card.judgments[me.name] === act) ? undefined : act;
            if(!card.judgments[me.name]) delete card.judgments[me.name];
          }
          if(act === 'gold'){
            var i = card.golden.indexOf(me.name);
            if(i !== -1){ card.golden.splice(i,1); }
            else if(!s.cards.some(function(x){ return (x.golden||[]).indexOf(me.name) !== -1; })){
              card.golden.push(me.name);
            }
          }
          if(act === 'top'){
            var v = card.topVotes.indexOf(me.name);
            if(v !== -1){ card.topVotes.splice(v,1); }
            else {
              var used = s.cards.reduce(function(n,x){
                return n + ((x.topVotes||[]).indexOf(me.name) !== -1 ? 1 : 0);
              },0);
              if(used < TOP_VOTES) card.topVotes.push(me.name);
            }
          }
        }).then(function(ok){
          if(ok && willBuzz){
            confetti();
            var t = c.text || '';
            toast('GOLDEN BUZZER! \u201c' + t.slice(0,40) + (t.length>40?'\u2026':'') + '\u201d goes straight to the finals.');
          }
        });
      });
    });
    return el;
  }

  function renderFinals(ph){
    if(ph < 3) return;
    var list = $('finalsList');
    $('finalsHint').textContent = ph === 3
      ? 'Live tally \u2014 golden-buzzed acts are locked in, the rest is decided by \ud83c\udfc6 votes.'
      : 'The finalists. Give each one an action item below.';
    list.innerHTML = '';
    var f = finalists();
    var all = f.golden.concat(f.voted);
    if(all.length === 0){
      list.innerHTML = '<div class="empty">No finalists yet \u2014 cast your top-3 votes.</div>';
      return;
    }
    all.forEach(function(c, i){
      var isGold = (c.golden||[]).length > 0;
      var d = document.createElement('div');
      d.className = 'finalist';
      d.innerHTML =
        '<span class="rank">' + (isGold ? '\ud83d\udd14 GOLDEN BUZZER' : '#' + (i - f.golden.length + 1) + ' \u00b7 ' + (c.topVotes||[]).length + ' \ud83c\udfc6') + '</span>' +
        '<div class="text">' + esc(c.text) + '</div>' +
        '<small style="color:var(--muted)">' + catLabel[c.cat] + ' \u00b7 by ' + esc(c.author) + '</small>';
      list.appendChild(d);
    });
  }

  function renderActions(ph){
    if(ph !== 4) return;
    var body = $('actionsBody');
    body.innerHTML = '';
    if(state.actions.length === 0){
      body.innerHTML = '<tr><td colspan="' + (SPECTATE ? 3 : 4) +
        '" class="empty">No action items yet. The finale awaits.</td></tr>';
      return;
    }
    if(SPECTATE){
      state.actions.forEach(function(a){
        var tr = document.createElement('tr');
        tr.innerHTML =
          '<td>' + esc(a.text || '—') + '</td>' +
          '<td>' + esc(a.owner || '—') + '</td>' +
          '<td>' + esc(a.due || '—') + '</td>';
        body.appendChild(tr);
      });
      return;
    }
    state.actions.forEach(function(a){
      var tr = document.createElement('tr');
      tr.innerHTML =
        '<td><input value="'+esc(a.text)+'" placeholder="What we\u2019ll change" aria-label="Action"></td>' +
        '<td><input value="'+esc(a.owner)+'" placeholder="Owner" aria-label="Owner"></td>' +
        '<td><input value="'+esc(a.due)+'" placeholder="Next sprint" aria-label="Due"></td>' +
        '<td><button class="del" title="Remove action" aria-label="Remove action">&#10005;</button></td>';
      var inputs = tr.querySelectorAll('input');
      function saveField(idx, field){
        inputs[idx].addEventListener('change', function(){
          var val = this.value;
          mutate(function(s){
            var row = s.actions.find(function(x){ return x.id === a.id; });
            if(row) row[field] = val;
          });
        });
      }
      saveField(0,'text'); saveField(1,'owner'); saveField(2,'due');
      tr.querySelector('.del').addEventListener('click', function(){
        mutate(function(s){
          s.actions = s.actions.filter(function(x){ return x.id !== a.id; });
        });
      });
      body.appendChild(tr);
    });
  }

  // ================= Composers =================
  document.querySelectorAll('.col').forEach(function(col){
    var cat = col.getAttribute('data-cat');
    var input = col.querySelector('.composer input');
    var btn = col.querySelector('.composer button');
    if(!input || !btn) return; // spectator page has no composers
    function add(){
      var v = input.value.trim();
      if(!v || !me) return;
      input.value = '';
      mutate(function(s){
        s.cards.push({ id:uid(), cat:cat, text:v, author:me.name,
                       judgments:{}, golden:[], topVotes:[] });
      });
      input.focus();
    }
    btn.addEventListener('click', add);
    input.addEventListener('keydown', function(e){ if(e.key==='Enter') add(); });
  });

  // ================= Sprint name (host only) =================
  if($('sprintName')){
    $('sprintName').addEventListener('change', function(){
      var v = this.value;
      if(!isFac()) return;
      mutate(function(s){ s.sprintName = v; });
    });
  }

  // ================= Actions =================
  if($('addActionBtn')){
    $('addActionBtn').addEventListener('click', function(){
      if(!me) return;
      mutate(function(s){ s.actions.push({ id:uid(), text:'', owner:'', due:'' }); });
    });
  }

  // ================= Phase controls (host page only) =================
  if($('nextBtn')){
    $('nextBtn').addEventListener('click', function(){
      mutate(function(s){
        if(s.phase < PHASES.length - 1) s.phase++;
        s.timerEnd = null;
      }).then(function(){
        if(state.phase === 4) confetti();
      });
    });
    $('prevBtn').addEventListener('click', function(){
      mutate(function(s){ if(s.phase > 0) s.phase--; s.timerEnd = null; });
    });
  }

  // ================= Timer (synced via timerEnd) =================
  var disp = $('timerDisplay');
  var timesUpShown = false;
  function fmtClock(sec){
    var m = Math.floor(sec/60), s = sec % 60;
    return m + ':' + String(s).padStart(2,'0');
  }
  function timerDurSec(){
    // duration of the running/last timer, shared via state so every view agrees
    var d = state.timerDur;
    if(!d && $('timerSel')) d = parseInt($('timerSel').value, 10) * 60;
    return d || 60;
  }
  setInterval(function(){
    var end = state.timerEnd;
    if(!end){ disp.textContent = fmtClock(timerDurSec()); timesUpShown = false; return; }
    var left = Math.max(0, Math.ceil((end - Date.now())/1000));
    disp.textContent = fmtClock(Math.min(left, timerDurSec()));
    if(left === 0 && !timesUpShown){
      timesUpShown = true;
      toast('Time\u2019s up! Judges, cast your votes.');
    }
  }, 500);
  if($('timerBtn')){
    $('timerBtn').addEventListener('click', function(){
      var mins = $('timerSel') ? parseInt($('timerSel').value, 10) || 1 : 1;
      mutate(function(s){
        s.timerEnd = Date.now() + mins * 60000;
        s.timerDur = mins * 60;
      });
      timesUpShown = false;
    });
  }
  if($('timerSel')){
    // idle display previews the selection right away
    $('timerSel').addEventListener('change', function(){
      if(!state.timerEnd) disp.textContent = fmtClock(parseInt(this.value,10) * 60);
    });
  }

  // ================= New season (host page only) =================
  if($('clearBoardBtn')){
    var clearArmed = false;
    $('clearBoardBtn').addEventListener('click', function(){
      var self = this;
      if(!clearArmed){
        clearArmed = true;
        self.textContent = 'Really clear everything?';
        setTimeout(function(){ clearArmed=false; self.textContent='New season'; }, 3500);
        return;
      }
      clearArmed = false;
      self.textContent = 'New season';
      mutate(function(s){
        var fresh = blankState();
        Object.keys(fresh).forEach(function(k){ s[k] = fresh[k]; });
      }).then(function(){
        me = null;
        try{ localStorage.removeItem(ME_KEY); }catch(e){}
        openGate();
        toast('Fresh stage. New season starts now.');
      });
    });
  }

  // ================= Marquee bulbs =================
  document.querySelectorAll('.bulbs').forEach(function(row){
    for(var i=0;i<14;i++){
      var b = document.createElement('span');
      b.className = 'bulb';
      row.appendChild(b);
    }
  });

  init();
})();

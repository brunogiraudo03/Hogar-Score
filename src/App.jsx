import { useState, useEffect, useCallback } from "react";
import {
  collection, doc, onSnapshot, addDoc, deleteDoc,
  setDoc, serverTimestamp, query, orderBy, writeBatch, getDocs,
} from "firebase/firestore";
import { db, messaging, getToken, onMessage, VAPID_KEY } from "./firebase.js";

// ─── Constants ────────────────────────────────────────────────────────────────
const DEFAULT_TASKS = [
  { id: "t1", name: "Lavar los platos", points: 10,  icon: "🍽️" },
  { id: "t2", name: "Limpiar el baño",  points: 20,  icon: "🚿" },
  { id: "t3", name: "Sacar la basura",  points: 8,   icon: "🗑️" },
];

const DEFAULT_CONFIG = {
  brunoColor:  "#f59e0b",
  lucilaColor: "#8b5cf6",
  brunoLabel:  "Bruno",
  lucilaLabel: "Lucila",
  goalWeekly:  100,
  reminderEnabled: false,
  reminderTime: "20:00",
};

const EMOJI_LIST = [
  "🍽️","🚿","🗑️","🧹","🧺","👕","🍳","🪣","🪟","🛏️","🧼","🪴",
  "🐶","🐱","🌿","💡","🪑","🛋️","🚪","🧊","🫧","🧽","🔧","📦",
  "🛒","⭐","✨","🔥","💧","🌟","🏠","🏡","🎯","🌈","💎","🎪",
];

const PARTICLES = Array.from({ length: 14 }, (_, i) => i);

const TABS = [
  { key: "home",    label: "🏡",  title: "Inicio"     },
  { key: "stats",   label: "📊",  title: "Stats"      },
  { key: "tasks",   label: "⚙️",  title: "Tareas"     },
  { key: "config",  label: "👤",  title: "Config"     },
];

// ─── Date helpers ─────────────────────────────────────────────────────────────
const todayStr  = () => new Date().toISOString().split("T")[0];
const weekKey   = () => { const d=new Date(); d.setDate(d.getDate()-d.getDay()); return d.toISOString().split("T")[0]; };
const monthKey  = () => new Date().toISOString().slice(0,7);
const fmtDate   = s => { const [,m,d]=s.split("-"); return `${d}/${m}`; };

const calcStreak = (log, player) => {
  const days = [...new Set(log.filter(e=>e.player===player).map(e=>e.date))].sort().reverse();
  if (!days.length) return 0;
  let streak=0, cur=new Date(); cur.setHours(0,0,0,0);
  for (const day of days) {
    const diff = Math.round((cur - new Date(day+"T00:00:00")) / 86400000);
    if (diff<=1) { streak++; cur=new Date(day+"T00:00:00"); } else break;
  }
  return streak;
};

// ─── Sound ────────────────────────────────────────────────────────────────────
const playSound = (type) => {
  try {
    const ctx = new (window.AudioContext||window.webkitAudioContext)();
    if (type==="register") {
      [523,659,784].forEach((freq,i)=>{
        const o=ctx.createOscillator(), g=ctx.createGain();
        o.connect(g); g.connect(ctx.destination);
        o.frequency.value=freq; o.type="sine";
        const t=ctx.currentTime+i*0.09;
        g.gain.setValueAtTime(0,t);
        g.gain.linearRampToValueAtTime(0.15,t+0.03);
        g.gain.exponentialRampToValueAtTime(0.001,t+0.28);
        o.start(t); o.stop(t+0.3);
      });
    } else {
      const o=ctx.createOscillator(), g=ctx.createGain();
      o.connect(g); g.connect(ctx.destination);
      o.frequency.setValueAtTime(400,ctx.currentTime);
      o.frequency.exponentialRampToValueAtTime(140,ctx.currentTime+0.2);
      g.gain.setValueAtTime(0.12,ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001,ctx.currentTime+0.22);
      o.start(); o.stop(ctx.currentTime+0.25);
    }
  } catch(_){}
};

// ─── App ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [tab,       setTab]      = useState("home");
  const [tasks,     setTasks]    = useState(DEFAULT_TASKS);
  const [log,       setLog]      = useState([]);
  const [config,    setConfig]   = useState(DEFAULT_CONFIG);
  const [who,       setWho]      = useState("bruno");
  const [burst,     setBurst]    = useState(null);
  const [crudMode,  setCrud]     = useState(null);
  const [editId,    setEditId]   = useState(null);
  const [form,      setForm]     = useState({name:"",points:"",icon:"⭐"});
  const [emojiOpen, setEmoji]    = useState(false);
  const [syncing,   setSyncing]  = useState(true);
  const [toast,     setToast]    = useState(null);
  const [notifOk,   setNotifOk]  = useState(false);

  // Dynamic player config
  const PLAYERS = {
    bruno:  { label: config.brunoLabel,  a: config.brunoColor,  b: "#ef4444", glow: `${config.brunoColor}55`,  glass: `${config.brunoColor}18` },
    lucila: { label: config.lucilaLabel, a: config.lucilaColor, b: "#ec4899", glow: `${config.lucilaColor}55`, glass: `${config.lucilaColor}18` },
  };

  const showToast = (msg, type="info") => {
    setToast({msg,type}); setTimeout(()=>setToast(null),3000);
  };

  // ── Firebase realtime listeners ────────────────────────────────────────────
  useEffect(()=>{
    // Tasks
    const unsubTasks = onSnapshot(collection(db,"tasks"), snap=>{
      const data = snap.docs.map(d=>({id:d.id,...d.data()}));
      setTasks(data.length ? data.sort((a,b)=>a.name.localeCompare(b.name)) : DEFAULT_TASKS);
    });

    // Log (last 500 entries ordered by timestamp)
    const logQ = query(collection(db,"log"), orderBy("ts","desc"));
    const unsubLog = onSnapshot(logQ, snap=>{
      setLog(snap.docs.map(d=>({id:d.id,...d.data()})));
      setSyncing(false);
    });

    // Config
    const unsubConfig = onSnapshot(doc(db,"config","main"), snap=>{
      if (snap.exists()) setConfig(c=>({...c,...snap.data()}));
    });

    return ()=>{ unsubTasks(); unsubLog(); unsubConfig(); };
  },[]);

  // ── FCM notifications ──────────────────────────────────────────────────────
  useEffect(()=>{
    if (!messaging) return;
    onMessage(messaging, payload=>{
      showToast(payload.notification?.body ?? "Nueva actividad 🏠", "notif");
    });
  },[]);

  const requestNotifications = async () => {
    if (!messaging) return showToast("Notificaciones no disponibles en este navegador","error");
    try {
      const perm = await Notification.requestPermission();
      if (perm!=="granted") return showToast("Permiso denegado","error");
      await getToken(messaging,{vapidKey:VAPID_KEY});
      setNotifOk(true);
      showToast("✅ Notificaciones activadas");
    } catch(e){ showToast("Error activando notificaciones","error"); }
  };

  // ── Register task ──────────────────────────────────────────────────────────
  const register = async (task, e) => {
    const rect=e.currentTarget.getBoundingClientRect();
    const entry = {
      player:who, taskId:task.id, taskName:task.name,
      points:task.points, icon:task.icon,
      date:todayStr(), week:weekKey(), month:monthKey(),
      ts: serverTimestamp(),
    };
    try {
      await addDoc(collection(db,"log"), entry);
      playSound("register");
      setBurst({x:rect.left+rect.width/2, y:rect.top+rect.height/2, points:task.points, player:who, key:Date.now()});
      setTimeout(()=>setBurst(null),1100);
    } catch(_){ showToast("Error al guardar","error"); }
  };

  const removeEntry = async id => {
    try { await deleteDoc(doc(db,"log",id)); playSound("delete"); }
    catch(_){ showToast("Error al eliminar","error"); }
  };

  // ── Tasks CRUD ─────────────────────────────────────────────────────────────
  const saveForm = async () => {
    if (!form.name.trim()||!form.points) return;
    const data = {name:form.name.trim(), points:parseInt(form.points), icon:form.icon};
    try {
      if (crudMode==="create") await addDoc(collection(db,"tasks"),data);
      else await setDoc(doc(db,"tasks",editId),data);
      closeForm();
    } catch(_){ showToast("Error al guardar tarea","error"); }
  };

  const deleteTask = async id => {
    try { await deleteDoc(doc(db,"tasks",id)); playSound("delete"); }
    catch(_){ showToast("Error al eliminar","error"); }
  };

  // Init default tasks if Firestore tasks collection is empty
  useEffect(()=>{
    (async()=>{
      const snap = await getDocs(collection(db,"tasks"));
      if (snap.empty) {
        const batch = writeBatch(db);
        DEFAULT_TASKS.forEach(t=>batch.set(doc(db,"tasks",t.id),{name:t.name,points:t.points,icon:t.icon}));
        await batch.commit();
      }
    })();
  },[]);

  // ── Save config ────────────────────────────────────────────────────────────
  const saveConfig = async (updates) => {
    const next = {...config,...updates};
    setConfig(next);
    try { await setDoc(doc(db,"config","main"),next,{merge:true}); }
    catch(_){ showToast("Error guardando config","error"); }
  };

  // ── Schedule reminder notification (local, via SW) ─────────────────────────
  const scheduleReminder = () => {
    if (!("Notification" in window)||Notification.permission!=="granted") return;
    const [h,m] = config.reminderTime.split(":").map(Number);
    const now=new Date(), next=new Date();
    next.setHours(h,m,0,0);
    if (next<=now) next.setDate(next.getDate()+1);
    const ms = next-now;
    setTimeout(()=>{
      new Notification("🏠 Hogar Score", {body:"¡No olvides registrar tus tareas de hoy!",icon:"/icon.svg"});
      scheduleReminder();
    }, ms);
    showToast(`Recordatorio programado para las ${config.reminderTime}`);
  };

  // ── Scores ─────────────────────────────────────────────────────────────────
  const pts = (p,period) => log
    .filter(e=>e.player===p&&(period==="today"?e.date===todayStr():period==="week"?e.week===weekKey():e.month===monthKey()))
    .reduce((s,e)=>s+e.points,0);

  const bT=pts("bruno","today"),  lT=pts("lucila","today");
  const bW=pts("bruno","week"),   lW=pts("lucila","week");
  const bM=pts("bruno","month"),  lM=pts("lucila","month");
  const bStreak=calcStreak(log,"bruno"), lStreak=calcStreak(log,"lucila");
  const todayW=bT>lT?"bruno":lT>bT?"lucila":"tie";
  const weekW =bW>lW?"bruno":lW>bW?"lucila":"tie";

  // ── Weekly chart data (last 7 days) ────────────────────────────────────────
  const last7 = Array.from({length:7},(_,i)=>{
    const d=new Date(); d.setDate(d.getDate()-i); return d.toISOString().split("T")[0];
  }).reverse();

  const chartData = last7.map(date=>({
    date, label: fmtDate(date),
    bruno:  log.filter(e=>e.player==="bruno" &&e.date===date).reduce((s,e)=>s+e.points,0),
    lucila: log.filter(e=>e.player==="lucila"&&e.date===date).reduce((s,e)=>s+e.points,0),
  }));
  const chartMax = Math.max(...chartData.flatMap(d=>[d.bruno,d.lucila]),1);

  // ── Task leaderboard ───────────────────────────────────────────────────────
  const taskStats = tasks.map(t=>({
    ...t,
    brunoCount:  log.filter(e=>e.player==="bruno" &&e.taskId===t.id).length,
    lucilaCount: log.filter(e=>e.player==="lucila"&&e.taskId===t.id).length,
    total:       log.filter(e=>e.taskId===t.id).length,
  })).sort((a,b)=>b.total-a.total);

  // ── CRUD helpers ───────────────────────────────────────────────────────────
  const openCreate = ()=>{ setForm({name:"",points:"",icon:"⭐"}); setCrud("create"); setEditId(null); setEmoji(false); };
  const openEdit   = t =>{ setForm({name:t.name,points:String(t.points),icon:t.icon}); setCrud("edit"); setEditId(t.id); setEmoji(false); };
  const closeForm  = ()=>{ setCrud(null); setEditId(null); setEmoji(false); };

  const todayLog = log.filter(e=>e.date===todayStr());
  const weekLog  = log.filter(e=>e.week===weekKey());
  const weekGoal = config.goalWeekly;

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div style={{minHeight:"100dvh",background:"#06030f",fontFamily:"'DM Sans',sans-serif",color:"#f0eeff",maxWidth:430,margin:"0 auto",position:"relative",overflowX:"hidden"}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Syne:wght@700;800&display=swap');
        *{box-sizing:border-box;-webkit-tap-highlight-color:transparent;}
        body{margin:0;background:#06030f;}
        @keyframes up       {from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:translateY(0)}}
        @keyframes fadein   {from{opacity:0}to{opacity:1}}
        @keyframes sheetup  {from{transform:translateY(100%)}to{transform:translateY(0)}}
        @keyframes glowPulse{0%,100%{opacity:.4}50%{opacity:.85}}
        @keyframes shimmer  {0%{background-position:-200% center}100%{background-position:200% center}}
        @keyframes ripple   {0%{transform:translate(-50%,-50%) scale(1);opacity:.7}100%{transform:translate(-50%,-50%) scale(3.2);opacity:0}}
        @keyframes floatUp  {0%{transform:translate(-50%,-50%) scale(.7);opacity:0}25%{transform:translate(-50%,-80%) scale(1.25);opacity:1}80%{transform:translate(-50%,-140%) scale(1);opacity:1}100%{transform:translate(-50%,-175%) scale(.8);opacity:0}}
        @keyframes particle {0%{transform:translate(0,0) scale(1);opacity:1}100%{transform:translate(var(--dx),var(--dy)) scale(0);opacity:0}}
        @keyframes streakBob{0%,100%{transform:scale(1)}50%{transform:scale(1.2)}}
        @keyframes toastIn  {from{opacity:0;transform:translateX(-50%) translateY(10px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}
        @keyframes syncSpin {from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
        @keyframes barGrow  {from{height:0}}
        .tbtn{transition:transform .15s,box-shadow .15s;}
        .tbtn:active{transform:scale(.93);}
        .navbtn{transition:all .2s;}
        input{outline:none;color:#f0eeff;}
        input::placeholder{color:#3a3050;}
        input[type=number]::-webkit-inner-spin-button{-webkit-appearance:none;}
        ::-webkit-scrollbar{width:3px;}
        ::-webkit-scrollbar-thumb{background:rgba(255,255,255,.1);border-radius:2px;}
        input[type=range]{-webkit-appearance:none;width:100%;height:4px;border-radius:2px;background:rgba(255,255,255,.1);outline:none;}
        input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:18px;height:18px;border-radius:50%;background:#f59e0b;cursor:pointer;}
        input[type=time]{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);border-radius:10px;padding:8px 12px;color:#f0eeff;font-family:'DM Sans',sans-serif;font-size:.85rem;}
        input[type=color]{-webkit-appearance:none;border:none;background:none;width:36px;height:36px;cursor:pointer;border-radius:50%;}
      `}</style>

      {/* BG mesh */}
      <div style={{position:"fixed",inset:0,zIndex:0,pointerEvents:"none",overflow:"hidden"}}>
        <div style={{position:"absolute",top:"-25%",left:"-20%",width:"65%",height:"65%",borderRadius:"50%",background:`radial-gradient(circle,${PLAYERS.bruno.glow} 0%,transparent 70%)`,animation:"glowPulse 4s ease-in-out infinite"}}/>
        <div style={{position:"absolute",bottom:"-20%",right:"-15%",width:"60%",height:"60%",borderRadius:"50%",background:`radial-gradient(circle,${PLAYERS.lucila.glow} 0%,transparent 70%)`,animation:"glowPulse 4s ease-in-out infinite 2s"}}/>
        <svg style={{position:"absolute",inset:0,width:"100%",height:"100%",opacity:.03}} xmlns="http://www.w3.org/2000/svg">
          <defs><pattern id="gr" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0L0 0 0 40" fill="none" stroke="white" strokeWidth=".5"/></pattern></defs>
          <rect width="100%" height="100%" fill="url(#gr)"/>
        </svg>
      </div>

      {/* Particle burst */}
      {burst && (
        <div key={burst.key} style={{position:"fixed",left:burst.x,top:burst.y,zIndex:600,pointerEvents:"none"}}>
          {PARTICLES.map(i=>{
            const angle=(i/PARTICLES.length)*360, dist=50+Math.random()*45;
            const cols=burst.player==="bruno"?["#f59e0b","#fbbf24","#ef4444","#fb923c"]:["#8b5cf6","#a78bfa","#ec4899","#f472b6"];
            return <div key={i} style={{position:"absolute",width:7,height:7,borderRadius:"50%",background:cols[i%4],top:0,left:0,"--dx":`${Math.cos(angle*Math.PI/180)*dist}px`,"--dy":`${Math.sin(angle*Math.PI/180)*dist}px`,animation:`particle .85s ease-out ${i*0.02}s forwards`}}/>;
          })}
          <div style={{position:"absolute",top:0,left:0,fontSize:"1.7rem",fontWeight:800,fontFamily:"'Syne',sans-serif",color:PLAYERS[burst.player].a,textShadow:`0 0 20px ${PLAYERS[burst.player].glow}`,animation:"floatUp 1s ease-out forwards",whiteSpace:"nowrap"}}>+{burst.points}</div>
          <div style={{position:"absolute",top:0,left:0,width:56,height:56,borderRadius:"50%",border:`2px solid ${PLAYERS[burst.player].a}`,animation:"ripple .6s ease-out forwards"}}/>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div style={{position:"fixed",bottom:90,left:"50%",zIndex:700,
          background:toast.type==="error"?"rgba(239,68,68,.9)":toast.type==="notif"?"rgba(139,92,246,.9)":"rgba(30,20,60,.95)",
          backdropFilter:"blur(12px)",border:"1px solid rgba(255,255,255,.15)",
          borderRadius:14,padding:"10px 18px",fontSize:".82rem",fontWeight:600,
          color:"#fff",whiteSpace:"nowrap",animation:"toastIn .3s ease",
          transform:"translateX(-50%)",boxShadow:"0 4px 20px rgba(0,0,0,.4)"}}>
          {toast.msg}
        </div>
      )}

      {/* Sync indicator */}
      {syncing && (
        <div style={{position:"fixed",top:14,right:16,zIndex:100,fontSize:".7rem",color:"#4a4060",display:"flex",alignItems:"center",gap:6}}>
          <div style={{width:10,height:10,borderRadius:"50%",border:"2px solid #f59e0b",borderTopColor:"transparent",animation:"syncSpin .8s linear infinite"}}/>
          sync…
        </div>
      )}

      {/* TOP NAV */}
      <div style={{position:"sticky",top:0,zIndex:50,background:"rgba(6,3,15,.92)",backdropFilter:"blur(20px)",WebkitBackdropFilter:"blur(20px)",borderBottom:"1px solid rgba(255,255,255,.07)",padding:"14px 16px 0"}}>
        <div style={{textAlign:"center",marginBottom:12}}>
          <span style={{fontFamily:"'Syne',sans-serif",fontSize:"1.45rem",fontWeight:800,background:"linear-gradient(135deg,#f59e0b 0%,#ec4899 50%,#8b5cf6 100%)",backgroundSize:"200%",WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent",animation:"shimmer 3s linear infinite"}}>
            🏠 Hogar Score
          </span>
        </div>
        <div style={{display:"flex"}}>
          {TABS.map(({key,label,title})=>(
            <button key={key} className="navbtn" onClick={()=>setTab(key)} style={{flex:1,padding:"8px 2px 12px",background:"transparent",border:"none",borderBottom:tab===key?"2px solid #f59e0b":"2px solid transparent",color:tab===key?"#fbbf24":"#4a4060",cursor:"pointer",fontSize:".8rem",fontWeight:600,fontFamily:"'DM Sans',sans-serif",display:"flex",flexDirection:"column",alignItems:"center",gap:1}}>
              <span style={{fontSize:"1rem"}}>{label}</span>
              <span style={{fontSize:".6rem",letterSpacing:".03em"}}>{title}</span>
            </button>
          ))}
        </div>
      </div>

      {/* CONTENT */}
      <div style={{padding:"18px 14px 100px",position:"relative",zIndex:1}}>

        {/* ════ HOME ════ */}
        {tab==="home" && (
          <div key="home" style={{animation:"up .3s ease"}}>
            {/* Player cards */}
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:20}}>
              {["bruno","lucila"].map(p=>{
                const pl=PLAYERS[p], active=who===p, ptHoy=p==="bruno"?bT:lT, streak=p==="bruno"?bStreak:lStreak;
                const progress=Math.min((ptHoy/weekGoal)*100,100);
                return (
                  <div key={p} onClick={()=>setWho(p)} style={{borderRadius:22,padding:"18px 16px",cursor:"pointer",position:"relative",overflow:"hidden",background:active?`linear-gradient(135deg,${pl.glass},rgba(255,255,255,.06))`:"rgba(255,255,255,.03)",backdropFilter:"blur(20px)",WebkitBackdropFilter:"blur(20px)",border:active?`1px solid ${pl.a}66`:"1px solid rgba(255,255,255,.06)",boxShadow:active?`0 8px 32px ${pl.glow},inset 0 1px 0 rgba(255,255,255,.08)`:"none",transition:"all .3s"}}>
                    {active&&<div style={{position:"absolute",top:0,left:0,right:0,height:2,background:`linear-gradient(90deg,transparent,${pl.a},${pl.b},transparent)`}}/>}
                    {active&&<div style={{position:"absolute",top:-20,right:-20,width:80,height:80,borderRadius:"50%",background:`radial-gradient(circle,${pl.a}44 0%,transparent 70%)`,pointerEvents:"none"}}/>}
                    <div style={{fontSize:".58rem",fontWeight:700,letterSpacing:".2em",color:active?pl.a:"#3a3050",textTransform:"uppercase",marginBottom:4}}>{active?"▶ jugando":"tocar"}</div>
                    <div style={{fontFamily:"'Syne',sans-serif",fontSize:"1.1rem",fontWeight:800,color:active?pl.a:"#4a4060",marginBottom:10,transition:"color .3s"}}>{pl.label}</div>
                    <div style={{fontSize:"2.1rem",fontWeight:800,fontFamily:"'Syne',sans-serif",color:active?pl.a:"#4a4060",lineHeight:1,transition:"color .3s"}}>{ptHoy}</div>
                    <div style={{fontSize:".6rem",color:"#4a4060",marginTop:2,marginBottom:8}}>pts hoy</div>
                    {/* Mini progress bar toward weekly goal */}
                    <div style={{height:3,background:"rgba(255,255,255,.08)",borderRadius:2,overflow:"hidden",marginBottom:streak>0?8:0}}>
                      <div style={{height:"100%",width:`${progress}%`,background:pl.a,borderRadius:2,transition:"width .5s ease"}}/>
                    </div>
                    {progress>0&&<div style={{fontSize:".58rem",color:active?pl.a:"#3a3050",marginBottom:streak>0?6:0}}>{Math.round(progress)}% meta semanal</div>}
                    {streak>0&&(
                      <div style={{display:"inline-flex",alignItems:"center",gap:4,background:pl.glass,border:`1px solid ${pl.a}44`,borderRadius:20,padding:"3px 9px",animation:streak>=3?"streakBob 1.2s ease-in-out infinite":"none"}}>
                        <span style={{fontSize:".8rem"}}>🔥</span>
                        <span style={{fontSize:".62rem",fontWeight:700,color:pl.a}}>{streak} días</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Divider */}
            <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:14}}>
              <div style={{flex:1,height:1,background:"rgba(255,255,255,.06)"}}/>
              <span style={{fontSize:".62rem",fontWeight:600,letterSpacing:".16em",color:"#4a4060",textTransform:"uppercase",whiteSpace:"nowrap"}}>
                Tarea para <span style={{color:PLAYERS[who].a}}>{PLAYERS[who].label}</span>
              </span>
              <div style={{flex:1,height:1,background:"rgba(255,255,255,.06)"}}/>
            </div>

            {/* Tasks grid */}
            {tasks.length===0
              ? <EmptyState text="No hay tareas. Andá a ⚙️ Tareas para crear."/>
              : <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                  {tasks.map(t=>(
                    <button key={t.id} className="tbtn" onClick={e=>register(t,e)} style={{background:"rgba(255,255,255,.045)",backdropFilter:"blur(16px)",WebkitBackdropFilter:"blur(16px)",border:"1px solid rgba(255,255,255,.09)",borderRadius:18,padding:"15px 13px",cursor:"pointer",textAlign:"left",display:"flex",flexDirection:"column",gap:6,fontFamily:"'DM Sans',sans-serif"}}>
                      <div style={{fontSize:"1.6rem"}}>{t.icon}</div>
                      <div style={{fontSize:".78rem",fontWeight:500,lineHeight:1.3,color:"rgba(240,224,255,.75)"}}>{t.name}</div>
                      <div style={{fontSize:".9rem",fontWeight:700,color:PLAYERS[who].a}}>+{t.points} pts</div>
                    </button>
                  ))}
                </div>
            }

            {/* Today log */}
            {todayLog.length>0&&(
              <div style={{marginTop:26}}>
                <SectionLabel text="Actividad de hoy"/>
                <div style={{display:"flex",flexDirection:"column",gap:7}}>
                  {todayLog.map(e=><LogRow key={e.id} entry={e} pl={PLAYERS[e.player]} onRemove={()=>removeEntry(e.id)}/>)}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ════ STATS ════ */}
        {tab==="stats" && (
          <div key="stats" style={{animation:"up .3s ease"}}>

            {/* Monthly totals */}
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:16}}>
              {["bruno","lucila"].map(p=>{
                const pl=PLAYERS[p], ptM=p==="bruno"?bM:lM, ptW=p==="bruno"?bW:lW, streak=p==="bruno"?bStreak:lStreak;
                return (
                  <div key={p} style={{borderRadius:20,padding:"16px 14px",background:`linear-gradient(135deg,${pl.glass},rgba(255,255,255,.03))`,backdropFilter:"blur(16px)",WebkitBackdropFilter:"blur(16px)",border:`1px solid ${pl.a}44`,boxShadow:`0 4px 20px ${pl.glow}55`}}>
                    <div style={{fontFamily:"'Syne',sans-serif",fontWeight:800,fontSize:".95rem",color:pl.a,marginBottom:6}}>{pl.label}</div>
                    <div style={{fontSize:"1.7rem",fontWeight:800,fontFamily:"'Syne',sans-serif",color:pl.a,lineHeight:1}}>{ptM}</div>
                    <div style={{fontSize:".6rem",color:"#4a4060",marginBottom:8}}>pts este mes</div>
                    <div style={{fontSize:".75rem",color:"rgba(240,224,255,.6)",marginBottom:6}}>Semana: <b style={{color:pl.a}}>{ptW}</b></div>
                    <div style={{display:"flex",alignItems:"center",gap:4}}>
                      <span>🔥</span>
                      <span style={{fontSize:".7rem",fontWeight:700,color:streak>0?pl.a:"#4a4060"}}>{streak} día{streak!==1?"s":""} racha</span>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* 7-day bar chart */}
            <GlassCard title="Últimos 7 días">
              <div style={{display:"flex",alignItems:"flex-end",gap:6,height:120,paddingBottom:24,position:"relative"}}>
                {chartData.map((d,i)=>(
                  <div key={i} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:2,height:"100%",justifyContent:"flex-end"}}>
                    <div style={{width:"100%",display:"flex",gap:2,alignItems:"flex-end",height:"calc(100% - 16px)"}}>
                      <div style={{flex:1,background:PLAYERS.bruno.a,borderRadius:"3px 3px 0 0",height:`${(d.bruno/chartMax)*100}%`,minHeight:d.bruno>0?3:0,transition:"height .5s ease",animation:"barGrow .5s ease"}}/>
                      <div style={{flex:1,background:PLAYERS.lucila.a,borderRadius:"3px 3px 0 0",height:`${(d.lucila/chartMax)*100}%`,minHeight:d.lucila>0?3:0,transition:"height .5s ease",animation:"barGrow .5s ease"}}/>
                    </div>
                    <div style={{fontSize:".58rem",color:"#4a4060",marginTop:4}}>{d.label}</div>
                  </div>
                ))}
              </div>
              {/* Legend */}
              <div style={{display:"flex",gap:16,justifyContent:"center",marginTop:4}}>
                {["bruno","lucila"].map(p=>(
                  <div key={p} style={{display:"flex",alignItems:"center",gap:6}}>
                    <div style={{width:10,height:10,borderRadius:2,background:PLAYERS[p].a}}/>
                    <span style={{fontSize:".72rem",color:"#7a7090"}}>{PLAYERS[p].label}</span>
                  </div>
                ))}
              </div>
            </GlassCard>

            {/* Weekly scoreboard */}
            <GlassCard title="Semana actual">
              <GradBar label={PLAYERS.bruno.label}  p={bW} total={bW+lW||1} pl={PLAYERS.bruno}  win={weekW==="bruno"}  goal={weekGoal}/>
              <GradBar label={PLAYERS.lucila.label} p={lW} total={bW+lW||1} pl={PLAYERS.lucila} win={weekW==="lucila"} goal={weekGoal}/>
              {weekW!=="tie"&&(bW+lW)>0&&<WinBanner name={PLAYERS[weekW].label} pl={PLAYERS[weekW]} diff={Math.abs(bW-lW)} t="esta semana"/>}
              {weekW==="tie"&&(bW+lW)>0&&<TieBanner/>}
            </GlassCard>

            {/* Task leaderboard */}
            {taskStats.filter(t=>t.total>0).length>0&&(
              <GlassCard title="Tareas más realizadas">
                <div style={{display:"flex",flexDirection:"column",gap:8}}>
                  {taskStats.filter(t=>t.total>0).slice(0,6).map((t,i)=>(
                    <div key={t.id} style={{display:"flex",alignItems:"center",gap:10}}>
                      <div style={{fontSize:".7rem",fontWeight:700,color:"#4a4060",minWidth:16}}>#{i+1}</div>
                      <span style={{fontSize:"1.1rem"}}>{t.icon}</span>
                      <div style={{flex:1}}>
                        <div style={{fontSize:".78rem",fontWeight:600,color:"#d0c8f0"}}>{t.name}</div>
                        <div style={{display:"flex",gap:8,marginTop:2}}>
                          <span style={{fontSize:".63rem",color:PLAYERS.bruno.a}}>{PLAYERS.bruno.label}: {t.brunoCount}x</span>
                          <span style={{fontSize:".63rem",color:PLAYERS.lucila.a}}>{PLAYERS.lucila.label}: {t.lucilaCount}x</span>
                        </div>
                      </div>
                      <div style={{fontSize:".75rem",fontWeight:700,color:"#4a4060"}}>{t.total}x</div>
                    </div>
                  ))}
                </div>
              </GlassCard>
            )}

            {/* Hoy */}
            <GlassCard title="Hoy">
              <GradBar label={PLAYERS.bruno.label}  p={bT} total={bT+lT||1} pl={PLAYERS.bruno}  win={todayW==="bruno"}/>
              <GradBar label={PLAYERS.lucila.label} p={lT} total={bT+lT||1} pl={PLAYERS.lucila} win={todayW==="lucila"}/>
              {todayW!=="tie"&&(bT+lT)>0&&<WinBanner name={PLAYERS[todayW].label} pl={PLAYERS[todayW]} diff={Math.abs(bT-lT)} t="hoy"/>}
              {todayW==="tie"&&(bT+lT)>0&&<TieBanner/>}
              {(bT+lT)===0&&<EmptyState text="Nada hoy todavía"/>}
            </GlassCard>

            {/* Week history */}
            {weekLog.length>0&&(
              <GlassCard title="Historial semana">
                <div style={{display:"flex",flexDirection:"column",gap:6,maxHeight:320,overflowY:"auto"}}>
                  {[...weekLog].map(e=><LogRow key={e.id} entry={e} pl={PLAYERS[e.player]}/>)}
                </div>
              </GlassCard>
            )}
          </div>
        )}

        {/* ════ TASKS CRUD ════ */}
        {tab==="tasks" && (
          <div key="tasks" style={{animation:"up .3s ease"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:18}}>
              <span style={{fontSize:".62rem",fontWeight:600,letterSpacing:".18em",color:"#4a4060",textTransform:"uppercase"}}>{tasks.length} tarea{tasks.length!==1?"s":""}</span>
              <button className="tbtn" onClick={openCreate} style={{background:"linear-gradient(135deg,#f59e0b,#ec4899)",border:"none",borderRadius:12,padding:"9px 20px",color:"white",fontWeight:700,cursor:"pointer",fontSize:".82rem",fontFamily:"'DM Sans',sans-serif",boxShadow:"0 4px 16px rgba(245,158,11,.35)"}}>+ Nueva</button>
            </div>
            {tasks.length===0&&<EmptyState text="No hay tareas. ¡Creá la primera!"/>}
            <div style={{display:"flex",flexDirection:"column",gap:9}}>
              {tasks.map(t=>(
                <div key={t.id} style={{display:"flex",alignItems:"center",gap:12,background:"rgba(255,255,255,.045)",backdropFilter:"blur(16px)",border:"1px solid rgba(255,255,255,.09)",borderRadius:16,padding:"14px 16px"}}>
                  <span style={{fontSize:"1.5rem",minWidth:34,textAlign:"center"}}>{t.icon}</span>
                  <div style={{flex:1}}>
                    <div style={{fontSize:".84rem",fontWeight:600,color:"#e0d8ff"}}>{t.name}</div>
                    <div style={{fontSize:".68rem",fontWeight:700,color:"#f59e0b",marginTop:2}}>{t.points} pts</div>
                  </div>
                  <button className="tbtn" onClick={()=>openEdit(t)} style={{background:"rgba(255,255,255,.07)",border:"1px solid rgba(255,255,255,.12)",borderRadius:10,padding:"7px 11px",color:"#a090c0",cursor:"pointer",fontSize:".8rem"}}>✏️</button>
                  <button className="tbtn" onClick={()=>deleteTask(t.id)} style={{background:"rgba(239,68,68,.1)",border:"1px solid rgba(239,68,68,.25)",borderRadius:10,padding:"7px 11px",color:"#ef4444",cursor:"pointer",fontSize:".8rem"}}>🗑️</button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ════ CONFIG ════ */}
        {tab==="config" && (
          <div key="config" style={{animation:"up .3s ease"}}>
            <GlassCard title="Jugadores">
              {["bruno","lucila"].map(p=>(
                <div key={p} style={{display:"flex",alignItems:"center",gap:12,marginBottom:14}}>
                  <input type="color" value={p==="bruno"?config.brunoColor:config.lucilaColor}
                    onChange={e=>saveConfig({[p==="bruno"?"brunoColor":"lucilaColor"]:e.target.value})}
                    style={{width:36,height:36,borderRadius:"50%",cursor:"pointer"}}/>
                  <div style={{flex:1}}>
                    <div style={{fontSize:".62rem",letterSpacing:".14em",color:"#4a4060",textTransform:"uppercase",marginBottom:4}}>{p==="bruno"?"Jugador 1":"Jugador 2"}</div>
                    <input
                      value={p==="bruno"?config.brunoLabel:config.lucilaLabel}
                      onChange={e=>saveConfig({[p==="bruno"?"brunoLabel":"lucilaLabel"]:e.target.value})}
                      style={{width:"100%",background:"rgba(255,255,255,.06)",border:"1px solid rgba(255,255,255,.1)",borderRadius:10,padding:"8px 12px",fontSize:".88rem",fontFamily:"'DM Sans',sans-serif"}}
                    />
                  </div>
                </div>
              ))}
            </GlassCard>

            <GlassCard title="Meta semanal">
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:10}}>
                <span style={{fontSize:".82rem",color:"rgba(240,224,255,.7)"}}>Objetivo de puntos</span>
                <span style={{fontSize:".9rem",fontWeight:700,color:"#f59e0b"}}>{config.goalWeekly} pts</span>
              </div>
              <input type="range" min="50" max="500" step="10" value={config.goalWeekly}
                onChange={e=>saveConfig({goalWeekly:parseInt(e.target.value)})}/>
              <div style={{display:"flex",justifyContent:"space-between",marginTop:4}}>
                <span style={{fontSize:".65rem",color:"#4a4060"}}>50</span>
                <span style={{fontSize:".65rem",color:"#4a4060"}}>500</span>
              </div>
            </GlassCard>

            <GlassCard title="Recordatorios">
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14}}>
                <span style={{fontSize:".82rem",color:"rgba(240,224,255,.7)"}}>Recordatorio diario</span>
                <div onClick={()=>saveConfig({reminderEnabled:!config.reminderEnabled})} style={{width:44,height:24,borderRadius:12,background:config.reminderEnabled?"#f59e0b":"rgba(255,255,255,.1)",cursor:"pointer",position:"relative",transition:"background .2s"}}>
                  <div style={{position:"absolute",top:3,left:config.reminderEnabled?23:3,width:18,height:18,borderRadius:"50%",background:"white",transition:"left .2s",boxShadow:"0 1px 4px rgba(0,0,0,.3)"}}/>
                </div>
              </div>
              {config.reminderEnabled&&(
                <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:14}}>
                  <span style={{fontSize:".8rem",color:"#7a7090"}}>Hora:</span>
                  <input type="time" value={config.reminderTime} onChange={e=>saveConfig({reminderTime:e.target.value})}/>
                  <button className="tbtn" onClick={scheduleReminder} style={{background:"rgba(245,158,11,.15)",border:"1px solid rgba(245,158,11,.3)",borderRadius:10,padding:"8px 14px",color:"#f59e0b",cursor:"pointer",fontSize:".78rem",fontWeight:600}}>Activar</button>
                </div>
              )}
            </GlassCard>

            <GlassCard title="Notificaciones Push">
              <p style={{fontSize:".8rem",color:"rgba(240,224,255,.55)",marginBottom:14,lineHeight:1.5}}>
                Activá las notificaciones para recibir avisos cuando el otro registra una tarea y para recordatorios.
              </p>
              <button className="tbtn" onClick={requestNotifications} style={{width:"100%",padding:"12px",background:notifOk?"rgba(34,197,94,.15)":"linear-gradient(135deg,#f59e0b,#ec4899)",border:notifOk?"1px solid rgba(34,197,94,.3)":"none",borderRadius:14,color:notifOk?"#4ade80":"white",fontWeight:700,cursor:"pointer",fontSize:".88rem",fontFamily:"'DM Sans',sans-serif"}}>
                {notifOk?"✅ Notificaciones activas":"🔔 Activar notificaciones"}
              </button>
            </GlassCard>

            <GlassCard title="Acerca de">
              <div style={{fontSize:".8rem",color:"rgba(240,224,255,.45)",lineHeight:1.6}}>
                <div>🏠 Hogar Score v2.0</div>
                <div>Sincronización en tiempo real con Firebase</div>
                <div style={{marginTop:8,fontSize:".72rem",color:"#3a3050"}}>Instalá la app desde el menú de tu navegador → "Agregar a pantalla de inicio"</div>
              </div>
            </GlassCard>
          </div>
        )}
      </div>

      {/* BOTTOM SHEET FORM */}
      {crudMode&&(
        <div style={{position:"fixed",inset:0,zIndex:200,background:"rgba(4,2,12,.85)",backdropFilter:"blur(8px)",WebkitBackdropFilter:"blur(8px)",display:"flex",alignItems:"flex-end",justifyContent:"center",animation:"fadein .2s ease"}}
          onClick={e=>{if(e.target===e.currentTarget)closeForm();}}>
          <div style={{background:"linear-gradient(180deg,rgba(20,12,40,.99),rgba(10,6,24,1))",borderRadius:"24px 24px 0 0",padding:"20px 18px 48px",width:"100%",maxWidth:430,border:"1px solid rgba(255,255,255,.1)",borderBottom:"none",boxShadow:"0 -20px 60px rgba(139,92,246,.18)",animation:"sheetup .28s ease"}}>
            <div style={{width:38,height:4,borderRadius:2,background:"rgba(255,255,255,.15)",margin:"0 auto 20px"}}/>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:22}}>
              <span style={{fontFamily:"'Syne',sans-serif",fontSize:"1.1rem",fontWeight:800,color:"#f59e0b"}}>{crudMode==="create"?"✨ Nueva tarea":"✏️ Editar tarea"}</span>
              <button onClick={closeForm} style={{background:"rgba(255,255,255,.08)",border:"1px solid rgba(255,255,255,.1)",borderRadius:10,width:32,height:32,cursor:"pointer",color:"#6a6080",fontSize:"1rem",display:"flex",alignItems:"center",justifyContent:"center"}}>✕</button>
            </div>
            <FieldLabel>Ícono</FieldLabel>
            <button onClick={()=>setEmoji(p=>!p)} style={{background:"rgba(255,255,255,.06)",border:"1px solid rgba(255,255,255,.1)",borderRadius:14,padding:"11px 16px",cursor:"pointer",display:"flex",alignItems:"center",gap:10,color:"#7a7090",fontFamily:"'DM Sans',sans-serif",marginBottom:10}}>
              <span style={{fontSize:"1.5rem"}}>{form.icon}</span>
              <span style={{fontSize:".75rem",fontWeight:600}}>{emojiOpen?"▲ cerrar":"▼ elegir emoji"}</span>
            </button>
            {emojiOpen&&(
              <div style={{display:"flex",flexWrap:"wrap",gap:5,marginBottom:16,background:"rgba(255,255,255,.03)",borderRadius:14,padding:12,border:"1px solid rgba(255,255,255,.07)",maxHeight:130,overflowY:"auto"}}>
                {EMOJI_LIST.map(em=><button key={em} onClick={()=>{setForm(f=>({...f,icon:em}));setEmoji(false);}} style={{background:form.icon===em?"rgba(245,158,11,.2)":"transparent",border:form.icon===em?"1px solid #f59e0b":"1px solid transparent",borderRadius:8,padding:"5px 7px",cursor:"pointer",fontSize:"1.3rem",lineHeight:1}}>{em}</button>)}
              </div>
            )}
            <FieldLabel>Nombre</FieldLabel>
            <input value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))} placeholder="Ej: Limpiar la cocina" style={{width:"100%",background:"rgba(255,255,255,.06)",border:"1px solid rgba(255,255,255,.1)",borderRadius:14,padding:"13px 16px",fontSize:".9rem",fontFamily:"'DM Sans',sans-serif",marginBottom:14}}/>
            <FieldLabel>Puntos</FieldLabel>
            <input type="number" value={form.points} onChange={e=>setForm(f=>({...f,points:e.target.value}))} placeholder="Ej: 15" style={{width:"100%",background:"rgba(255,255,255,.06)",border:"1px solid rgba(255,255,255,.1)",borderRadius:14,padding:"13px 16px",fontSize:".9rem",fontFamily:"'DM Sans',sans-serif",marginBottom:22}}/>
            <button className="tbtn" onClick={saveForm} disabled={!form.name.trim()||!form.points} style={{width:"100%",padding:"15px",border:"none",borderRadius:16,cursor:"pointer",background:(!form.name.trim()||!form.points)?"rgba(255,255,255,.05)":"linear-gradient(135deg,#f59e0b,#ec4899,#8b5cf6)",color:(!form.name.trim()||!form.points)?"#3a3050":"white",fontWeight:700,fontSize:".95rem",fontFamily:"'DM Sans',sans-serif",boxShadow:(!form.name.trim()||!form.points)?"none":"0 4px 20px rgba(245,158,11,.3)",transition:"all .2s"}}>
              {crudMode==="create"?"Crear tarea ✨":"Guardar cambios ✓"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function LogRow({entry,pl,onRemove}){
  return(
    <div style={{display:"flex",alignItems:"center",gap:12,background:"rgba(255,255,255,.04)",backdropFilter:"blur(12px)",border:"1px solid rgba(255,255,255,.07)",borderRadius:14,padding:"11px 14px",borderLeft:`2px solid ${pl.a}`}}>
      <span style={{fontSize:"1.1rem"}}>{entry.icon}</span>
      <div style={{flex:1}}>
        <div style={{fontSize:".78rem",fontWeight:500,color:"#d0c8f0"}}>{entry.taskName}</div>
        <div style={{fontSize:".64rem",fontWeight:700,color:pl.a}}>{pl.label}{entry.date?` · ${fmtDate(entry.date)}`:""}</div>
      </div>
      <div style={{fontSize:".9rem",fontWeight:700,color:pl.a}}>+{entry.points}</div>
      {onRemove&&<button onClick={onRemove} style={{background:"rgba(255,255,255,.07)",border:"1px solid rgba(255,255,255,.1)",borderRadius:8,width:28,height:28,cursor:"pointer",color:"#5a5070",display:"flex",alignItems:"center",justifyContent:"center",fontSize:".8rem"}}>✕</button>}
    </div>
  );
}
function GlassCard({title,children}){
  return(
    <div style={{background:"rgba(255,255,255,.04)",backdropFilter:"blur(20px)",WebkitBackdropFilter:"blur(20px)",border:"1px solid rgba(255,255,255,.08)",borderRadius:20,padding:18,marginBottom:14}}>
      <SectionLabel text={title}/>{children}
    </div>
  );
}
function GradBar({label,p,total,pl,win,goal}){
  return(
    <div style={{marginBottom:14}}>
      <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
        <span style={{fontSize:".83rem",fontWeight:600,color:win&&p>0?"#f0eeff":"#4a4060"}}>{win&&p>0&&"👑 "}{label}</span>
        <span style={{fontSize:".88rem",fontWeight:700,color:pl.a}}>{p} pts</span>
      </div>
      <div style={{height:6,background:"rgba(255,255,255,.06)",borderRadius:4,overflow:"hidden"}}>
        <div style={{height:"100%",borderRadius:4,width:`${(p/total)*100}%`,background:`linear-gradient(90deg,${pl.a},${pl.b})`,boxShadow:`0 0 10px ${pl.glow}`,transition:"width .6s cubic-bezier(.34,1.56,.64,1)"}}/>
      </div>
    </div>
  );
}
function WinBanner({name,pl,diff,t}){return<div style={{marginTop:10,padding:"10px 14px",borderRadius:12,background:pl.glass,border:`1px solid ${pl.a}33`,fontSize:".78rem",fontWeight:500,color:"#c8c0e8",textAlign:"center"}}>🏆 <span style={{color:pl.a,fontWeight:700}}>{name}</span> lidera {t} por <strong>{diff} pts</strong></div>;}
function TieBanner(){return<div style={{marginTop:10,padding:"10px 14px",borderRadius:12,background:"rgba(255,255,255,.03)",border:"1px solid rgba(255,255,255,.08)",fontSize:".78rem",color:"#6a6080",textAlign:"center"}}>🤝 ¡Empate! Van iguales</div>;}
function EmptyState({text}){return<div style={{textAlign:"center",padding:"32px 0",color:"#3a3050",fontSize:".8rem",fontWeight:500}}><div style={{fontSize:"2rem",marginBottom:10}}>🏠</div>{text}</div>;}
function SectionLabel({text}){return<div style={{fontSize:".6rem",fontWeight:600,letterSpacing:".18em",color:"#4a4060",textTransform:"uppercase",marginBottom:12}}>{text}</div>;}
function FieldLabel({children}){return<div style={{fontSize:".62rem",fontWeight:600,letterSpacing:".15em",color:"#4a4060",textTransform:"uppercase",marginBottom:8}}>{children}</div>;}
const fmtDate=s=>{try{const[,m,d]=s.split("-");return`${d}/${m}`;}catch{return s;}};

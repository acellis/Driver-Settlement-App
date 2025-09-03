   import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { createClient } from "@supabase/supabase-js";

/** ========================
 * Driver Settlement v5 (Supabase-enabled)
 * - NEW: Optional Supabase backend for multi-device sharing.
 *   If VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY exist, the app
 *   runs in "Supabase mode":
 *     • Owner signs in via magic link (Supabase Auth) and manages all drivers & loads
 *     • Drivers sign in via magic link and see only their own loads (RLS)
 *   Otherwise it falls back to localStorage mode (v4 behavior).
 * - Hash routes: #/admin (owner), #/driver (driver)
 * - Error boundary + BUILD flag to avoid white screens
 * ======================== */

// ---- DEV BUILD FLAG ----
const BUILD_FLAG = "driver-app v5.0 / supabase / 2025-08-27";
window.__DRIVER_APP_BUILD__ = BUILD_FLAG;
console.info("[BUILD]", BUILD_FLAG);
document.documentElement.setAttribute("data-build", BUILD_FLAG);
// ------------------------

// Error boundary keeps production from blank-screening
class AppErrorBoundary extends React.Component {
  constructor(p){ super(p); this.state={error:null}; }
  static getDerivedStateFromError(e){ return {error:e}; }
  componentDidCatch(err, info){ console.error("[AppErrorBoundary]", err, info); }
  render(){
    if(this.state.error){
      return (<div style={{padding:24,fontFamily:"system-ui"}}>
        <h2>Something went wrong</h2>
        <pre style={{whiteSpace:"pre-wrap"}}>{String(this.state.error)}</pre>
        <button onClick={()=>location.reload()}>Reload</button>
      </div>);
    }
    return this.props.children;
  }
}

// ---------- Supabase setup (optional) ----------
const SUPA_URL  = import.meta.env.VITE_SUPABASE_URL;
const SUPA_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY;
export const supabase = (SUPA_URL && SUPA_ANON) ? createClient(SUPA_URL, SUPA_ANON) : null;
export const supaEnabled = !!supabase; // gate

// ---------- Utilities ----------
const KEY = "driver_mvp_v4"; // keep for local fallback + settings
const WEEKDAY_INDEX = { sunday:0, monday:1, tuesday:2, wednesday:3, thursday:4, friday:5, saturday:6 };
const fmtUSD = (n) => `$${(Number(n)||0).toFixed(2)}`;
const pad2 = (x) => String(x).padStart(2,"0");
const toLocalDateInput = (d) => `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`;
const isDate = (v) => v instanceof Date && !isNaN(v);

// Business-day helpers
const isBusinessDay = (d) => d.getDay()!==0 && d.getDay()!==6;
const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0,0,0,0);
const endOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23,59,59,999);
function previousWeekdayFrom(date, targetIndex){ const d=new Date(date); while(d.getDay()!==targetIndex) d.setDate(d.getDate()-1); return startOfDay(d); }
function addBusinessDaysInclusive(start, n){ const d=new Date(start); let count=1; while(count<n){ d.setDate(d.getDate()+1); if(isBusinessDay(d)) count++; } return endOfDay(d); }
function nextBusinessDay(date){ const d=new Date(date); do{ d.setDate(d.getDate()+1); } while(!isBusinessDay(d)); return startOfDay(d); }
function computeCycle(now, startWeekday="friday", businessDays=6){
  const idx=WEEKDAY_INDEX[startWeekday.toLowerCase()]??5; const today=new Date(now);
  const start=previousWeekdayFrom(today, idx); const end=addBusinessDaysInclusive(start,businessDays);
  if(today<start){ const prev=new Date(start); prev.setDate(prev.getDate()-7); return computeCycle(prev,startWeekday,businessDays); }
  if(today>end){ const next=new Date(start); next.setDate(next.getDate()+7); return computeCycle(next,startWeekday,businessDays); }
  return { cycleStart:start, cycleEnd:end, payDate:nextBusinessDay(end) };
}
function listCycles(anchor="friday", businessDays=6, count=26, fromDate=new Date()){
  const out=[]; let {cycleStart}=computeCycle(fromDate,anchor,businessDays);
  for(let i=0;i<count;i++){ const start=new Date(cycleStart); const end=addBusinessDaysInclusive(start,businessDays); const payDate=nextBusinessDay(end); out.push({cycleStart:start, cycleEnd:end, payDate}); cycleStart=new Date(start); cycleStart.setDate(cycleStart.getDate()-7);} return out;
}
function parseDateTimeLocal(dateStr, timeStr){ if(!dateStr) return null; const [y,m,d]=dateStr.split("-").map(Number); let hh=0,mm=0; if(timeStr){ const t=String(timeStr).split(":"); hh=Number(t[0]||0); mm=Number(t[1]||0);} return new Date(y,m-1,d,hh,mm,0,0); }

// local storage (kept for settings + fallback)
const defaultState={ startWeekday:"friday", cutoffHour:15, ownerPasswordHash:null, drivers:[], data:{} };
function loadState(){
  try{ const j=localStorage.getItem(KEY); if(!j) return defaultState; const s=JSON.parse(j);
    if (s?.data && typeof s.data === "object") {
      for (const id of Object.keys(s.data)) {
        const loads = Array.isArray(s.data[id]?.loads) ? s.data[id].loads : [];
        s.data[id] = { ...s.data[id], loads: loads.map(l => ({ ...l, deliveredAt: l?.deliveredAt ? new Date(l.deliveredAt) : null, bolAt: l?.bolAt ? new Date(l.bolAt) : null })) };
      }
    }
    return s;
  } catch { return defaultState; }
}
function saveState(s){ localStorage.setItem(KEY, JSON.stringify(s)); }

// ---------- Hash route ----------
function useHashRoute(){ const [hash,setHash]=useState(window.location.hash||"#/driver"); useEffect(()=>{ const on=()=>setHash(window.location.hash||"#/driver"); window.addEventListener("hashchange",on); return ()=>window.removeEventListener("hashchange",on); },[]); return hash.replace(/^#/ ,"")||"/driver"; }

// ---------- Tiny UI bits ----------
const ibox={ border:"1px solid #cbd5e1", padding:"8px 10px", borderRadius:6, width:"100%" };
const btn={ padding:"8px 12px", border:"1px solid #cbd5e1", borderRadius:6, background:"#fff", cursor:"pointer" };
const btnPrimary={ ...btn, background:"#2563eb", borderColor:"#2563eb", color:"#fff" };
const btnDanger={ ...btn, color:"#b91c1c", borderColor:"#b91c1c" };
const tableStyle={ width:"100%", borderCollapse:"collapse" };
const thStyle={ textAlign:"left", padding:8, border:"1px solid #e5e7eb", background:"#eef2ff" };
const tdStyle={ padding:8, border:"1px solid #e5e7eb" };
const pill=(bg="#eef2ff")=>({display:"inline-block",padding:"2px 8px",background:bg,borderRadius:999});
function Header({title, right}){ return (<div style={{display:"flex",justifyContent:"space-between",alignItems:"center",margin:"18px 0"}}><h1 style={{fontSize:28,fontWeight:800}}>{title}</h1><div>{right}</div></div>); }
function Section({title,children}){ return (<div style={{margin:"16px 0"}}><h2 style={{fontSize:20,fontWeight:700,marginBottom:10}}>{title}</h2>{children}</div>); }
function Card({children,pad=true}){ return <div style={{background:"#f6f7f9",border:"1px solid #e5e7eb",borderRadius:8,padding:pad?16:0}}>{children}</div>; }

// ---------- Supabase auth helpers ----------
function useSupaAuth(){
  const [user,setUser]=useState(null);
  const [role,setRole]=useState(null); // 'owner' | 'driver' | null
  const [ready,setReady]=useState(!supaEnabled);

  useEffect(()=>{
    if(!supaEnabled) return;
    let unsub = () => {};
    (async()=>{
      const { data } = await supabase.auth.getUser();
      setUser(data.user||null);
      if(data.user){ await fetchRole(data.user.id, setRole); }
      setReady(true);
      const { data: sub } = supabase.auth.onAuthStateChange(async (_evt, sess)=>{
        const u = sess?.user || null; setUser(u);
        if(u) await fetchRole(u.id, setRole); else setRole(null);
      });
      unsub = sub.subscription.unsubscribe;
    })();
    return ()=> unsub();
  },[]);
  return { user, role, ready };
}
async function fetchRole(userId, setRole){
  try{
    const { data, error } = await supabase.from('profiles').select('role').eq('user_id', userId).maybeSingle();
    if(error){ console.warn('[profiles/select]', error); setRole(null); return; }
    setRole(data?.role || null);
  }catch(e){ console.error(e); setRole(null); }
}
async function signInWithEmail(email){
  const { error } = await supabase.auth.signInWithOtp({ email, options:{ emailRedirectTo: window.location.origin } });
  if(error) alert(error.message); else alert('Check your email for a magic link.');
}
async function signOut(){ await supabase.auth.signOut(); }

// ---------- OWNER: Supabase gate OR local password gate ----------
function OwnerAuthGate({state,setState,children}){
  if(supaEnabled){
    const { user, role, ready } = useSupaAuth();
    if(!ready) return <Card><div style={{padding:12}}>Loading…</div></Card>;
    if(!user){
      let email="";
      const onSend=(e)=>{ e.preventDefault(); signInWithEmail(email); };
      return <Card><form onSubmit={onSend} style={{display:"flex",gap:12,alignItems:"end",flexWrap:"wrap"}}>
        <div><label>Owner Email (magic link)<br/>
          <input type="email" required onChange={e=>email=e.target.value} placeholder="you@company.com" style={ibox}/></label></div>
        <button type="submit" style={btnPrimary}>Send Link</button>
      </form>
      <div style={{marginTop:8,fontSize:12,color:'#6b7280'}}>After you log in the first time, mark your user as <b>owner</b> in Supabase (see setup notes).</div>
      </Card>;
    }
    if(role!=="owner"){
      return <Card><div style={{padding:12}}>
        <b>Signed in as:</b> {user.email}<br/>
        This account is not an <b>owner</b> yet. In Supabase SQL, run:<br/>
        <code>insert into profiles(user_id, role) values ('{user.id}', 'owner') on conflict (user_id) do update set role='owner';</code>
        <div style={{marginTop:8}}><button onClick={signOut} style={btn}>Sign out</button></div>
      </div></Card>;
    }
    const logout=()=>signOut();
    return <div><Header title="Owner Portal" right={<button onClick={logout} style={btn}>Sign out</button>} />{children}</div>;
  }
  // ---- Local fallback password gate (kept from v4) ----
  const [pw,setPw]=useState(""); const [newPw,setNewPw]=useState(""); const authed=sessionStorage.getItem("ownerAuthed")==="1";
  async function sha256Hex(str){ const enc=new TextEncoder(); const buf=await crypto.subtle.digest("SHA-256", enc.encode(str)); return [...new Uint8Array(buf)].map(b=>b.toString(16).padStart(2,"0")).join('\n'); }
  if(!state.ownerPasswordHash){
    const setup=async()=>{ if((newPw||"").length<8) return alert("Use at least 8 characters."); const hash=await sha256Hex(newPw); setState({...state, ownerPasswordHash:hash}); sessionStorage.setItem("ownerAuthed","1"); };
    return <Card><div style={{display:"flex",gap:12,alignItems:"end",flexWrap:"wrap"}}><div><label>Create Owner Password<br/><input type="password" value={newPw} onChange={e=>setNewPw(e.target.value)} style={ibox}/></label></div><button onClick={setup} style={btnPrimary}>Save & Enter Owner Portal</button></div><div style={{marginTop:8,fontSize:12,color:"#6b7280"}}>Local-only (no backend). For a shared portal, configure Supabase.</div></Card>;
  }
  if(!authed){
    const login=async()=>{ const hash=await sha256Hex(pw); if(hash===state.ownerPasswordHash){ sessionStorage.setItem("ownerAuthed","1"); } else alert("Incorrect password"); };
    return <Card><div style={{display:"flex",gap:12,alignItems:"end",flexWrap:"wrap"}}><div><label>Owner Password<br/><input type="password" value={pw} onChange={e=>setPw(e.target.value)} style={ibox}/></label></div><button onClick={login} style={btnPrimary}>Enter Owner Portal</button></div></Card>;
  }
  const logout=()=>{ sessionStorage.removeItem("ownerAuthed"); window.location.hash="#/driver"; };
  return <div><Header title="Owner Portal" right={<button onClick={logout} style={btn}>Logout</button>} />{children}</div>;
}

// ---------- OWNER components ----------
function OwnerSettings({state,setState}){
  const cycle=computeCycle(new Date(),state.startWeekday,6);
  return <Card>
    <div style={{display:"flex",gap:12,alignItems:"center",flexWrap:"wrap"}}>
      <label>Start Weekday&nbsp;
        <select value={state.startWeekday} onChange={e=>setState({...state,startWeekday:e.target.value})} style={ibox}>
          {Object.keys(WEEKDAY_INDEX).map(w=><option key={w} value={w}>{w}</option>)}
        </select>
      </label>
      <label>Cutoff Hour (24h)&nbsp;
        <input type="number" min={0} max={23} value={state.cutoffHour} onChange={e=>setState({...state,cutoffHour:Number(e.target.value||0)})} style={{...ibox,width:120}}/>
      </label>
      <div style={{marginLeft:"auto"}}>
        <span style={pill()}>Current: {cycle.cycleStart.toDateString()} → {cycle.cycleEnd.toDateString()}</span>&nbsp;
        <span style={pill("#dcfce7")}>Pay: {cycle.payDate.toDateString()}</span>
      </div>
    </div>
  </Card>;
}

function OwnerAdmin({drivers,setDrivers}){
  const [name,setName]=useState(""); const [email,setEmail]=useState(""); const [lease,setLease]=useState(1300); const [pct,setPct]=useState(7.55);
  const add=async()=>{
    if(!name||!email) return alert("Name and email required.");
    if(supaEnabled){
      const { error } = await supabase.from('drivers').insert([{ name, email, lease:Number(lease||0), default_dispatch_pct:Number(pct||0) }]);
      if(error){ alert(error.message); return; }
      await refreshDrivers(setDrivers);
    } else {
      const id="d_"+Math.random().toString(36).slice(2); setDrivers(prev=>[...prev,{id,name,pin:email,lease:Number(lease||0),defaultDispatchPct:Number(pct||0)}]);
    }
    setName(""); setEmail(""); setLease(1300); setPct(7.55);
  };
  const remove=async(id)=>{
    if(!confirm("Remove this driver?")) return;
    if(supaEnabled){ await supabase.from('drivers').delete().eq('id', id); await refreshDrivers(setDrivers); }
    else { setDrivers(prev=>prev.filter(d=>d.id!==id)); }
  };
  return <Card>
    <div style={{display:"flex",gap:12,flexWrap:"wrap",alignItems:"end"}}>
      <div><label>Name<br/><input value={name} onChange={e=>setName(e.target.value)} style={ibox}/></label></div>
      <div><label>Driver Email<br/><input value={email} type="email" onChange={e=>setEmail(e.target.value)} style={ibox} placeholder="driver@example.com"/></label></div>
      <div><label>Weekly Lease ($)<br/><input type="number" value={lease} onChange={e=>setLease(e.target.value)} style={ibox}/></label></div>
      <div><label>Default Dispatch %<br/><input type="number" step="0.01" value={pct} onChange={e=>setPct(e.target.value)} style={ibox}/></label></div>
      <button onClick={add} style={btnPrimary}>Add Driver</button>
    </div>
    <div style={{marginTop:16}}>
      <table style={tableStyle}><thead><tr>{["Name","Email","Lease","Dispatch %","Actions"].map(h=><th key={h} style={thStyle}>{h}</th>)}</tr></thead>
      <tbody>{drivers.map(d=>(<tr key={d.id}><td style={tdStyle}>{d.name}</td><td style={tdStyle}>{d.email||"-"}</td><td style={tdStyle}>{fmtUSD(d.lease)}</td><td style={tdStyle}>{( (d.default_dispatch_pct ?? d.defaultDispatchPct ?? 0).toFixed(2) )}%</td><td style={tdStyle}><button onClick={()=>remove(d.id)} style={btnDanger}>Remove</button></td></tr>))}{drivers.length===0&&(<tr><td style={tdStyle} colSpan={5}>No drivers yet.</td></tr>)}</tbody></table>
    </div>
  </Card>;
}

async function refreshDrivers(setDrivers){
  if(!supaEnabled) return; const { data, error } = await supabase.from('drivers').select('*').order('created_at', {ascending:false}); if(error){ alert(error.message); return; } setDrivers(data||[]);
}
async function fetchLoadsMap(drivers){
  const map={};
  for(const d of drivers){ const { data, error } = await supabase.from('loads').select('*').eq('driver_id', d.id).order('delivered_at', {ascending:false}); if(error){ console.error(error); map[d.id]={loads:[]}; } else { map[d.id]={loads:(data||[]).map(x=>({...x, deliveredAt: x.delivered_at?new Date(x.delivered_at):null, bolAt: x.bol_at?new Date(x.bol_at):null, dispatchPct: x.dispatch_pct, dispatchFee: (Number(x.dispatch_pct||0)/100)*Number(x.revenue||0), net: Number(x.revenue||0)-Number(x.fuel||0)-Number(x.misc||0)-((Number(x.dispatch_pct||0)/100)*Number(x.revenue||0)) }))}; }
  }
  return map;
}

function OwnerAddLoad({drivers,setData,state}){
  const active=drivers[0]||null; // minimal change: first driver
  const [date,setDate]=useState(toLocalDateInput(new Date()));
  const [time,setTime]=useState("10:00"); const [bolTime,setBolTime]=useState("14:30");
  const [loadNo,setLoadNo]=useState(""); const [origin,setOrigin]=useState(""); const [destination,setDestination]=useState("");
  const [rev,setRev]=useState(""); const [fuel,setFuel]=useState(""); const [misc,setMisc]=useState("");
  const [pct,setPct]=useState(active?.default_dispatch_pct??active?.defaultDispatchPct??7.55);
  useEffect(()=>{ if(active) setPct(active.default_dispatch_pct??active.defaultDispatchPct??7.55); },[active?.id]);
  const add=async()=>{
    if(!active) return alert("Add a driver first.");
    const deliveredAt=parseDateTimeLocal(date,time), bolAt=parseDateTimeLocal(date,bolTime);
    const revenue=Number(rev||0), fuelC=Number(fuel||0), miscC=Number(misc||0), dispatchPct=Number(pct||0);
    if(supaEnabled){
      const { error } = await supabase.from('loads').insert([{ driver_id: active.id, delivered_at: deliveredAt?.toISOString(), bol_at: bolAt?.toISOString(), revenue, fuel: fuelC, misc: miscC, dispatch_pct: dispatchPct, owner_override: null, load_no: loadNo, origin, destination }]);
      if(error){ alert(error.message); return; }
      // refresh loads map for that driver
      const { data } = await supabase.from('loads').select('*').eq('driver_id', active.id).order('delivered_at',{ascending:false});
      setData(prev=>({ ...prev, [active.id]:{ loads:(data||[]).map(x=>({...x, deliveredAt: x.delivered_at?new Date(x.delivered_at):null, bolAt: x.bol_at?new Date(x.bol_at):null, dispatchPct: x.dispatch_pct, dispatchFee:(Number(x.dispatch_pct||0)/100)*Number(x.revenue||0), net: Number(x.revenue||0)-Number(x.fuel||0)-Number(x.misc||0)-((Number(x.dispatch_pct||0)/100)*Number(x.revenue||0)) })) } }));
    } else {
      const id="l_"+Math.random().toString(36).slice(2);
      const dispatchFee=(dispatchPct/100)*revenue; const net=revenue-fuelC-miscC-dispatchFee;
      const entry={id,deliveredAt,bolAt,revenue,fuel:fuelC,misc:miscC,dispatchPct,dispatchFee,net,loadNo,origin,destination,ownerOverride:null};
      setData(prev=>({ ...prev, [active.id]:{ loads:[entry,...(prev[active.id]?.loads||[])] }}));
    }
    setRev(""); setFuel(""); setMisc(""); setLoadNo(""); setOrigin(""); setDestination("");
  };
  return <Card>
    <div style={{display:"grid",gridTemplateColumns:"repeat(6,minmax(0,1fr))",gap:12,alignItems:"end"}}>
      <div><label>Delivery Date<br/><input type="date" value={date} onChange={e=>setDate(e.target.value)} style={ibox}/></label></div>
      <div><label>Time<br/><input type="time" value={time} onChange={e=>setTime(e.target.value)} style={ibox}/></label></div>
      <div><label>BOL Time<br/><input type="time" value={bolTime} onChange={e=>setBolTime(e.target.value)} style={ibox}/></label></div>
      <div><label>Load #<br/><input value={loadNo} onChange={e=>setLoadNo(e.target.value)} style={ibox}/></label></div>
      <div><label>Origin<br/><input value={origin} onChange={e=>setOrigin(e.target.value)} style={ibox}/></label></div>
      <div><label>Destination<br/><input value={destination} onChange={e=>setDestination(e.target.value)} style={ibox}/></label></div>
    </div>
    <div style={{display:"grid",gridTemplateColumns:"repeat(5,minmax(0,1fr))",gap:12,alignItems:"end",marginTop:12}}>
      <div><label>Revenue ($)<br/><input type="number" value={rev} onChange={e=>setRev(e.target.value)} style={ibox}/></label></div>
      <div><label>Fuel ($)<br/><input type="number" value={fuel} onChange={e=>setFuel(e.target.value)} style={ibox}/></label></div>
      <div><label>Misc ($)<br/><input type="number" value={misc} onChange={e=>setMisc(e.target.value)} style={ibox}/></label></div>
      <div><label>Dispatch %<br/><input type="number" step="0.01" value={pct} onChange={e=>setPct(e.target.value)} style={ibox}/></label></div>
      <div style={{display:"flex",alignItems:"end"}}><button onClick={add} style={btnPrimary}>Add Load</button></div>
    </div>
    <div style={{marginTop:8,fontSize:12,color:"#6b7280"}}>In Supabase mode, loads are saved to the cloud. Expense-only days are fine: set Revenue to 0 and fill Fuel/Misc.</div>
  </Card>;
}

function OwnerLoadsTable({state,drivers,data,setData}){
  const cycle=computeCycle(new Date(),state.startWeekday,6);
  const cutoffHour=state.cutoffHour??15;
  const active=drivers[0];
  const loads=active?(data[active.id]?.loads||[]):[];
  const rows=loads.map(l=>{
    const late = isDate(l.bolAt) ? (l.bolAt.getHours()>cutoffHour || (l.bolAt.getHours()===cutoffHour && l.bolAt.getMinutes()>0)) : true;
    const inWindow = isDate(l.deliveredAt) ? (l.deliveredAt>=cycle.cycleStart && l.deliveredAt<=cycle.cycleEnd) : false;
    const autoIncluded=inWindow && !late; let included=autoIncluded;
    const override = l.ownerOverride ?? l.owner_override ?? null; if(override==="include") included=true; if(override==="exclude") included=false;
    return {...l,late,inWindow,autoIncluded,included};
  });
  const setOverride=async(id,val)=>{
    if(supaEnabled){ await supabase.from('loads').update({ owner_override: (val==="auto"?null:val) }).eq('id', id); }
    const next=loads.map(l=>l.id===id?{...l, ownerOverride:(val==="auto"?null:val), owner_override:(val==="auto"?null:val)}:l);
    setData(prev=>({ ...prev, [active.id]:{ loads: next } }));
  };
  const remove=async(id)=>{
    if(!confirm("Delete this load?")) return;
    if(supaEnabled){ await supabase.from('loads').delete().eq('id', id); }
    const next=loads.filter(l=>l.id!==id); setData(prev=>({ ...prev, [active.id]:{ loads: next } }));
  };
  return <table style={tableStyle}>
    <thead><tr>{["Date","Load #","Origin → Dest","Revenue","Fuel","Misc","Disp %","Disp $","Net","Auto","Override","Included?","Actions"].map(h=><th key={h} style={thStyle}>{h}</th>)}</tr></thead>
    <tbody>
      {rows.map(l=>(<tr key={l.id}>
        <td style={tdStyle}>{isDate(l.deliveredAt) ? l.deliveredAt.toLocaleString() : "-"}</td>
        <td style={tdStyle}>{l.load_no||l.loadNo||"-"}</td>
        <td style={tdStyle}>{(l.origin||"-")} → {(l.destination||"-")}</td>
        <td style={tdStyle}>{fmtUSD(l.revenue)}</td>
        <td style={tdStyle}>{fmtUSD(l.fuel)}</td>
        <td style={tdStyle}>{fmtUSD(l.misc)}</td>
        <td style={tdStyle}>{( (l.dispatch_pct ?? l.dispatchPct ?? 0).toFixed(2) )}%</td>
        <td style={tdStyle}>{fmtUSD(l.dispatchFee)}</td>
        <td style={tdStyle}>{fmtUSD(l.net)}</td>
        <td style={tdStyle}>{l.autoIncluded ? <span style={pill("#dcfce7")}>auto ✓</span> : <span style={pill("#fee2e2")}>auto ✗</span>}</td>
        <td style={tdStyle}>
          <select value={(l.owner_override??l.ownerOverride)||"auto"} onChange={e=>setOverride(l.id,e.target.value)} style={ibox}>
            <option value="auto">auto</option>
            <option value="include">include</option>
            <option value="exclude">exclude</option>
          </select>
        </td>
        <td style={tdStyle}>{l.included?"Yes":"No"}</td>
        <td style={tdStyle}><button onClick={()=>remove(l.id)} style={btnDanger}>Delete</button></td>
      </tr>))}
      {rows.length===0 && (<tr><td colSpan={13} style={tdStyle}>No loads yet.</td></tr>)}
    </tbody>
  </table>;
}
function OwnerPayouts({ state }) {
  const [cycleIdx, setCycleIdx] = React.useState(0);
  const cycles = listCycles(state.startWeekday, 6, 26, new Date());
  const cycle = cycles[cycleIdx];
  const cutoffHour = state.cutoffHour ?? 15;

  const [rows, setRows] = React.useState([]);
  const [loading, setLoading] = React.useState(false);
  const [err, setErr] = React.useState(null);

  const isSupa =
    typeof supabase !== "undefined" &&
    !!import.meta.env.VITE_SUPABASE_URL &&
    !!import.meta.env.VITE_SUPABASE_ANON_KEY;

  React.useEffect(() => {
    (async () => {
      setLoading(true);
      setErr(null);
      try {
        let drivers = [];
        let loads = [];

        if (isSupa) {
          const { data: d, error: dErr } = await supabase
            .from("drivers")
            .select("*")
            .order("name");
          if (dErr) throw dErr;
          drivers = d || [];

          const { data: l, error: lErr } = await supabase
            .from("loads")
            .select("*")
            .gte("delivered_at", cycle.cycleStart.toISOString())
            .lte("delivered_at", cycle.cycleEnd.toISOString());
          if (lErr) throw lErr;
          loads = l || [];
        } else {
          // Local fallback (uses MVP state)
          drivers = state.drivers || [];
          // flatten local loads
          for (const d of drivers) {
            const arr = (state.data?.[d.id]?.loads || []).map((x) => ({
              ...x,
              driver_id: d.id,
              delivered_at: x.deliveredAt?.toISOString?.() || null,
              bol_at: x.bolAt?.toISOString?.() || null,
              dispatch_pct: x.dispatchPct ?? x.dispatch_pct ?? d.defaultDispatchPct ?? d.default_dispatch_pct ?? 0,
              owner_override: x.ownerOverride ?? x.owner_override ?? null,
              load_no: x.loadNo ?? x.load_no ?? "",
            }));
            loads.push(...arr);
          }
        }

        // Group & compute
        const byDriver = new Map(drivers.map((d) => [d.id, { driver: d, loads: [] }]));
        for (const l of loads) {
          const bucket = byDriver.get(l.driver_id);
          if (bucket) bucket.loads.push(l);
        }

        const out = [];
        for (const { driver, loads: ls } of byDriver.values()) {
          const computed = ls.map((l) => {
            const deliveredAt = new Date(l.delivered_at ?? l.deliveredAt);
            const bolAt = l.bol_at ? new Date(l.bol_at) : (l.bolAt ? new Date(l.bolAt) : null);

            const inWindow = deliveredAt >= cycle.cycleStart && deliveredAt <= cycle.cycleEnd;
            const late = bolAt ? (bolAt.getHours() > cutoffHour || (bolAt.getHours() === cutoffHour && bolAt.getMinutes() > 0)) : true;
            const autoIncluded = inWindow && !late;

            let included = autoIncluded;
            if (l.owner_override === "include") included = true;
            if (l.owner_override === "exclude") included = false;

            const revenue = Number(l.revenue || 0);
            const fuel = Number(l.fuel || 0);
            const misc = Number(l.misc || 0);
            const pct = Number((l.dispatch_pct ?? l.dispatchPct ?? driver.default_dispatch_pct ?? driver.defaultDispatchPct ?? 0) || 0);
            const dispatchFee = (pct / 100) * revenue;
            const net = revenue - fuel - misc - dispatchFee;

            return { deliveredAt, inWindow, included, revenue, fuel, misc, pct, dispatchFee, net };
          });

          const inc = computed.filter((x) => x.included && x.inWindow);
          const gross = inc.reduce((a, x) => a + x.revenue, 0);
          const fuel = inc.reduce((a, x) => a + x.fuel, 0);
          const misc = inc.reduce((a, x) => a + x.misc, 0);
          const dispatch = inc.reduce((a, x) => a + x.dispatchFee, 0);
          const net = inc.reduce((a, x) => a + x.net, 0);
          const lease = Number(driver.lease || 0);
          const final = net - lease;

          out.push({
            id: driver.id,
            name: driver.name || driver.email || "(unnamed)",
            lease,
            counts: inc.length,
            gross,
            fuel,
            misc,
            dispatch,
            net,
            final,
          });
        }

        // Sort by name for stable UI
        out.sort((a, b) => a.name.localeCompare(b.name));
        setRows(out);
      } catch (e) {
        console.error(e);
        setErr(e.message || String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [cycleIdx, state.startWeekday, state.cutoffHour]);

  const exportCSV = () => {
    const header = ["Driver", "Loads", "Gross", "Fuel", "Misc", "Dispatch", "Net (pre-lease)", "Lease", "Final Owed"];
    const body = rows.map((r) => [
      r.name,
      r.counts,
      r.gross,
      r.fuel,
      r.misc,
      r.dispatch,
      r.net,
      r.lease,
      r.final,
    ]);
    const totals = rows.reduce(
      (a, r) => ({
        c: a.c + r.counts,
        g: a.g + r.gross,
        f: a.f + r.fuel,
        m: a.m + r.misc,
        d: a.d + r.dispatch,
        n: a.n + r.net,
        l: a.l + r.lease,
        o: a.o + r.final,
      }),
      { c: 0, g: 0, f: 0, m: 0, d: 0, n: 0, l: 0, o: 0 }
    );
    const totalsRow = ["Totals", totals.c, totals.g, totals.f, totals.m, totals.d, totals.n, totals.l, totals.o];
    const csv = [header, ...body, [], totalsRow].map((r) => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `payouts_${toLocalDateInput(cycle.cycleEnd)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const totals = rows.reduce(
    (a, r) => ({
      c: a.c + r.counts,
      g: a.g + r.gross,
      f: a.f + r.fuel,
      m: a.m + r.misc,
      d: a.d + r.dispatch,
      n: a.n + r.net,
      l: a.l + r.lease,
      o: a.o + r.final,
    }),
    { c: 0, g: 0, f: 0, m: 0, d: 0, n: 0, l: 0, o: 0 }
  );

  return (
    <Card>
      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 12 }}>
        <label>
          Period
          <select value={cycleIdx} onChange={(e) => setCycleIdx(Number(e.target.value))} style={{ ...ibox, width: 360, marginLeft: 8 }}>
            {cycles.map((c, idx) => (
              <option key={idx} value={idx}>
                {c.cycleStart.toDateString()} → {c.cycleEnd.toDateString()} (Pay {c.payDate.toDateString()})
              </option>
            ))}
          </select>
        </label>
        <span style={{ marginLeft: "auto" }}>
          <span style={pill()}>Cutoff {cutoffHour}:00</span>
        </span>
        <button onClick={exportCSV} style={btn}>Export CSV</button>
      </div>

      {err && <div style={{ color: "#b91c1c", marginBottom: 8 }}>Error: {String(err)}</div>}
      {loading ? <div>Loading…</div> : (
        <table style={tableStyle}>
          <thead>
            <tr>
              {["Driver", "Loads", "Gross", "Fuel", "Misc", "Dispatch", "Net (pre-lease)", "Lease", "Final Owed"].map((h) => (
                <th key={h} style={thStyle}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td style={tdStyle}>{r.name}</td>
                <td style={tdStyle}>{r.counts}</td>
                <td style={tdStyle}>{fmtUSD(r.gross)}</td>
                <td style={tdStyle}>{fmtUSD(r.fuel)}</td>
                <td style={tdStyle}>{fmtUSD(r.misc)}</td>
                <td style={tdStyle}>{fmtUSD(r.dispatch)}</td>
                <td style={tdStyle}>{fmtUSD(r.net)}</td>
                <td style={tdStyle}>{fmtUSD(r.lease)}</td>
                <td style={{ ...tdStyle, fontWeight: 700 }}>{fmtUSD(r.final)}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={9} style={tdStyle}>No included loads for this period.</td></tr>
            )}
          </tbody>
          <tfoot>
            <tr>
              <td style={tdStyle}><b>Totals</b></td>
              <td style={tdStyle}>{totals.c}</td>
              <td style={tdStyle}>{fmtUSD(totals.g)}</td>
              <td style={tdStyle}>{fmtUSD(totals.f)}</td>
              <td style={tdStyle}>{fmtUSD(totals.m)}</td>
              <td style={tdStyle}>{fmtUSD(totals.d)}</td>
              <td style={tdStyle}>{fmtUSD(totals.n)}</td>
              <td style={tdStyle}>{fmtUSD(totals.l)}</td>
              <td style={{ ...tdStyle, fontWeight: 800 }}>{fmtUSD(totals.o)}</td>
            </tr>
          </tfoot>
        </table>
      )}
    </Card>
  );
}

// ---------- DRIVER (Supabase auth) ----------
function DriverLogin(){
  if(!supaEnabled){ return <Card><div style={{padding:12}}>Driver PIN login is disabled in cloud mode. Ask owner to enable Supabase and add your email, or run locally for PIN testing.</div></Card>; }
  let email="";
  const onSubmit=(e)=>{ e.preventDefault(); signInWithEmail(email); };
  return <Card>
    <form onSubmit={onSubmit} style={{display:"flex",gap:12,alignItems:"end",flexWrap:"wrap"}}>
      <div><label>Driver Email (magic link)<br/><input type="email" required placeholder="driver@example.com" onChange={e=>email=e.target.value} style={ibox}/></label></div>
      <button type="submit" style={btnPrimary}>Send Link</button>
    </form>
    <div style={{marginTop:8,fontSize:12,color:'#6b7280'}}>You will receive a secure sign-in link at your email.</div>
  </Card>;
}

function DriverCyclesView({state,driver,loads}){
  const [cycleIdx,setCycleIdx]=useState(0);
  const cycles=listCycles(state.startWeekday,6,26,new Date());
  const cycle=cycles[cycleIdx]; const cutoffHour=state.cutoffHour??15;
  const rowsAll=(loads||[]).map(l=>{
    const deliveredAt = l.delivered_at?new Date(l.delivered_at): (l.deliveredAt||null);
    const bolAt = l.bol_at?new Date(l.bol_at): (l.bolAt||null);
    const inWindow = isDate(deliveredAt) ? (deliveredAt>=cycle.cycleStart && deliveredAt<=cycle.cycleEnd) : false;
    const late = isDate(bolAt) ? (bolAt.getHours()>cutoffHour || (bolAt.getHours()===cutoffHour && bolAt.getMinutes()>0)) : true;
    const dispatchPct = Number(l.dispatch_pct ?? l.dispatchPct ?? 0);
    const dispatchFee=(dispatchPct/100)*Number(l.revenue||0);
    const net=Number(l.revenue||0)-Number(l.fuel||0)-Number(l.misc||0)-dispatchFee;
    const autoIncluded=inWindow && !late; let included=autoIncluded; const override=l.owner_override??l.ownerOverride; if(override==="include") included=true; if(override==="exclude") included=false;
    return {...l, deliveredAt, bolAt, dispatchPct, dispatchFee, net, inWindow, late, autoIncluded, included};
  });
  const rows=rowsAll.filter(l=>l.included && l.inWindow);
  const totals=useMemo(()=>{
    const gross=rows.reduce((a,l)=>a+Number(l.revenue||0),0);
    const fuel=rows.reduce((a,l)=>a+Number(l.fuel||0),0);
    const misc=rows.reduce((a,l)=>a+Number(l.misc||0),0);
    const dispatch=rows.reduce((a,l)=>a+Number(l.dispatchFee||0),0);
    const net=rows.reduce((a,l)=>a+Number(l.net||0),0);
    const final=net-(driver.lease||0);
    return {gross,fuel,misc,dispatch,net,final};
  },[rows,driver?.lease]);

 const exportCSV = () => {
  const header = ["Date","Load #","Origin","Destination","Revenue","Fuel","Misc","Dispatch %","Dispatch $","Net"];
  const body = rows.map(l => [
    l.deliveredAt?.toLocaleString?.() || "",
    l.load_no || l.loadNo || "",
    l.origin || "",
    l.destination || "",
    l.revenue, l.fuel, l.misc,
    l.dispatchPct, l.dispatchFee, l.net
  ]);
  const totalsRow = ["Totals","","","",totals.gross,totals.fuel,totals.misc,"",totals.dispatch,totals.net];
  const finalRow  = ["","","","","","","","Lease",-(driver.lease||0),totals.final];

  const csv = [header, ...body, [], totalsRow, finalRow]
    .map(r => r.join('\n'))
    .join('\n');     // <-- keep this on one line
  const blob = new Blob([csv], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `driver_${driver.name}_cycle_${toLocalDateInput(cycle.cycleEnd)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
};
  const exportPDF=async()=>{
    try{
      const html2canvas=(await import("html2canvas")).default; const jsPDF=(await import("jspdf")).default;
      const area=document.getElementById("driver-summary-area"); const canvas=await html2canvas(area,{scale:2});
      const img=canvas.toDataURL("image/png"); const pdf=new jsPDF({unit:"pt",format:"a4"}); const pageWidth=pdf.internal.pageSize.getWidth(); const ratio=canvas.height/canvas.width; const imgWidth=pageWidth-40; const imgHeight=imgWidth*ratio;
      pdf.text(`Driver: ${driver.name}`,20,24); pdf.text(`Cycle: ${cycle.cycleStart.toDateString()} → ${cycle.cycleEnd.toDateString()} | Pay: ${cycle.payDate.toDateString()}`,20,42);
      pdf.addImage(img,"PNG",20,50,imgWidth,imgHeight); pdf.save(`driver_${driver.name}_cycle_${toLocalDateInput(cycle.cycleEnd)}.pdf`);
    }catch(e){ alert("PDF export requires packages: npm i jspdf html2canvas"); console.error(e); }
  };

  return <div>
    <div style={{display:"flex",gap:12,alignItems:"center",marginBottom:12}}>
      <label>Select Period
        <select value={cycleIdx} onChange={e=>setCycleIdx(Number(e.target.value))} style={{...ibox,width:300,marginLeft:8}}>
          {cycles.map((c,idx)=>(<option key={idx} value={idx}>{c.cycleStart.toDateString()} → {c.cycleEnd.toDateString()} (Pay {c.payDate.toDateString()})</option>))}
        </select>
      </label>
      <span style={{marginLeft:"auto"}}><span style={pill()}>Cutoff {state.cutoffHour}:00</span></span>
    </div>
    <table style={tableStyle}>
      <thead><tr>{["Date","Load #","Origin → Dest","Revenue","Fuel","Misc","Disp %","Disp $","Net"].map(h=><th key={h} style={thStyle}>{h}</th>)}</tr></thead>
      <tbody>
        {rows.map(l=>(<tr key={l.id}>
          <td style={tdStyle}>{isDate(l.deliveredAt) ? l.deliveredAt.toLocaleString() : "-"}</td>
          <td style={tdStyle}>{l.load_no||l.loadNo||"-"}</td>
          <td style={tdStyle}>{(l.origin||"-")} → {(l.destination||"-")}</td>
          <td style={tdStyle}>{fmtUSD(l.revenue)}</td>
          <td style={tdStyle}>{fmtUSD(l.fuel)}</td>
          <td style={tdStyle}>{fmtUSD(l.misc)}</td>
          <td style={tdStyle}>{(l.dispatchPct||0).toFixed(2)}%</td>
          <td style={tdStyle}>{fmtUSD(l.dispatchFee)}</td>
          <td style={tdStyle}>{fmtUSD(l.net)}</td>
        </tr>))}
        {rows.length===0 && (<tr><td colSpan={9} style={tdStyle}>No loads included for this period yet.</td></tr>)}
      </tbody>
    </table>
    <div id="driver-summary-area" style={{marginTop:12,background:"#fff",padding:12}}>
      <ul>
        <li>Total Gross: {fmtUSD(totals.gross)}</li>
        <li>Total Fuel: {fmtUSD(totals.fuel)}</li>
        <li>Total Misc: {fmtUSD(totals.misc)}</li>
        <li>Total Dispatch: {fmtUSD(totals.dispatch)}</li>
        <li>Net Before Lease: {fmtUSD(totals.net)}</li>
        <li>Weekly Lease: -{fmtUSD(driver.lease||0)}</li>
        <li style={{fontWeight:800}}>Final Pay: {fmtUSD(totals.final)}</li>
      </ul>
    </div>
    <div style={{display:"flex",gap:8,marginTop:8}}>
      <button onClick={exportCSV} style={btn}>Export CSV</button>
      <button onClick={exportPDF} style={btn}>Export PDF</button>
    </div>
  </div>;
}

// ---------- Supabase driver route component (keeps hooks order) ----------
function SupaDriverRoute({ state, data, setData, auth }) {
  const { user } = auth;

  if (!user) {
    return (
      <div style={{fontFamily:"Inter, system-ui, sans-serif", maxWidth:1150, margin:"22px auto"}}>
        <Header title="Driver Portal" right={<a href="#/admin" style={{textDecoration:"none"}}>Owner Login →</a>} />
        <DriverLogin/>
        <div style={{color:'#6b7280',fontSize:12,marginTop:24}}>Driver view is <b>read‑only</b>. Loads and inclusion are controlled by the Owner.</div>
      </div>
    );
  }

  const [driver, setDriver] = React.useState(null);
  useEffect(()=>{ (async()=>{
    const { data } = await supabase
      .from('drivers')
      .select('*')
      .or(`user_id.eq.${user.id},email.eq.${user.email}`)
      .limit(1)
      .maybeSingle();
    if(data) setDriver(data);
  })(); },[user?.id, user?.email]);

  if (!driver) {
    return (
      <div style={{fontFamily:"Inter, system-ui, sans-serif", maxWidth:1150, margin:"22px auto"}}>
        <Header title="Driver Portal" right={<a href="#/admin" style={{textDecoration:"none"}}>Owner Login →</a>} />
        <Card><div style={{padding:12}}>No driver record is linked to <b>{user.email}</b> yet. Ask the owner to add your email in the Drivers list. Then reload.</div></Card>
      </div>
    );
  }

  const loads = (data[driver.id]?.loads||[]);
  return (
    <div style={{fontFamily:"Inter, system-ui, sans-serif", maxWidth:1150, margin:"22px auto"}}>
      <Header title="Driver Portal" right={<a href="#/admin" style={{textDecoration:"none"}}>Owner Login →</a>} />
      <div style={{marginBottom:8}}>
        <span style={pill()}>Driver: {driver.name}</span>&nbsp;
        <span style={pill("#dcfce7")}>Lease {fmtUSD(driver.lease||0)}</span>&nbsp;
        <button onClick={signOut} style={{...btn, marginLeft:8}}>Sign out</button>
      </div>
      <DriverCyclesView state={state} driver={driver} loads={loads}/>
      <div style={{color:'#6b7280',fontSize:12,marginTop:24}}>Driver view is <b>read‑only</b>. Loads and inclusion are controlled by the Owner.</div>
    </div>
  );
}

// ---------- App shell ----------
function App(){

  const [state,setState]=useState(loadState());
  const [drivers,setDrivers]=useState([]);     // in Supabase mode: cloud list
  const [data,setData]=useState({});           // { driverId: { loads: [...] } }
  const route=useHashRoute();

  // Always call auth hook so hook order stays stable across routes
  const auth = useSupaAuth();

  // Save local settings only (we won't persist cloud data to localStorage)
  useEffect(()=>{ const { startWeekday, cutoffHour, ownerPasswordHash } = state; saveState({ ...defaultState, startWeekday, cutoffHour, ownerPasswordHash }); },[state.startWeekday, state.cutoffHour, state.ownerPasswordHash]);

  // On Supabase: load drivers & loads
  useEffect(()=>{ (async()=>{
    if(!supaEnabled) return;
    await refreshDrivers(setDrivers);
  })(); },[]);
  useEffect(()=>{ (async()=>{ if(!supaEnabled) return; if(drivers.length===0) { setData({}); return; } const map=await fetchLoadsMap(drivers); setData(map); })(); },[drivers]);

  // OWNER ROUTE
  if(route==="/admin"){
    return (<div style={{fontFamily:"Inter, system-ui, sans-serif", maxWidth:1150, margin:"22px auto"}}>
      <OwnerAuthGate state={state} setState={setState}>
        <Section title="Weekly Payouts"> <OwnerPayouts state={state} /> </Section>
        <Section title="Settings"><OwnerSettings state={state} setState={setState}/></Section>
        <Section title="Drivers"><OwnerAdmin drivers={drivers} setDrivers={setDrivers}/></Section>
        <Section title="Add Load"><OwnerAddLoad drivers={drivers} setData={setData} state={state}/></Section>
        <Section title="Loads (current cycle)"> {drivers.length===0 ? <Card><div style={{padding:12}}>Add a driver above to begin.</div></Card> : <OwnerLoadsTable state={state} drivers={drivers} data={data} setData={setData}/>} </Section>
        <div style={{marginTop:10}}><a href="#/driver" style={{textDecoration:"none"}}>Go to Driver Portal →</a></div>
      </OwnerAuthGate>
    </div>);
  }

  // DRIVER ROUTE
  if (supaEnabled) {
    return <SupaDriverRoute state={state} data={data} setData={setData} auth={auth} />;
  }

  // Non-Supabase driver (legacy PIN disabled here; use local dev only)
  return (<div style={{fontFamily:"Inter, system-ui, sans-serif", maxWidth:1150, margin:"22px auto"}}>
    <Header title="Driver Portal" right={<a href="#/admin" style={{textDecoration:"none"}}>Owner Login →</a>} />
    <Card><div style={{padding:12}}>This deployment is in localStorage mode and has no shared data. Use <b>Supabase</b> to make it multi-device or run locally for PIN testing.</div></Card>
    <div style={{color:'#6b7280',fontSize:12,marginTop:24}}>Driver view is <b>read‑only</b>. Loads and inclusion are controlled by the Owner.</div>
  </div>);
}

createRoot(document.getElementById("root")).render(<AppErrorBoundary><App/></AppErrorBoundary>);

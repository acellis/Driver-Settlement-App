import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";

// ---- DEV BUILD FLAG: change this string any time you edit main.jsx ----
const BUILD_FLAG = 'driver-app v4.1.1 / 2025-08-27 01:45';
window.__DRIVER_APP_BUILD__ = BUILD_FLAG;
console.info('[BUILD]', BUILD_FLAG);
document.documentElement.setAttribute('data-build', BUILD_FLAG);
// ----------------------------------------------------------------------

// Tiny error boundary so production never white-screens
class AppErrorBoundary extends React.Component {
  constructor(p){ super(p); this.state = { error:null }; }
  static getDerivedStateFromError(error){ return { error }; }
  componentDidCatch(err, info){ console.error('[AppErrorBoundary]', err, info); }
  render(){
    if (this.state.error) {
      return (
        <div style={{padding:24,fontFamily:'system-ui'}}>
          <h2>Something went wrong</h2>
          <pre style={{whiteSpace:'pre-wrap'}}>{String(this.state.error)}</pre>
          <button onClick={()=>location.reload()}>Reload</button>
        </div>
      );
    }
    return this.props.children;
  }
}

/** ========================
 * Driver Settlement v4.1 (single file)
 * - Fixes blank pages by reviving Date objects from localStorage
 * - Adds guards around Date usage in tables
 * - Owner portal (hash route #/admin) with password (client-side SHA-256).
 * - Driver portal (hash route #/driver) is read-only: view past cycles, export CSV/PDF.
 * - Loads include: loadNo, origin, destination, revenue, fuel, misc, dispatch %, BOL time.
 * - Owner can force include/exclude per load (override beats auto cutoff).
 * - Persistence via localStorage (MVP).
 * ======================== */

const KEY = "driver_mvp_v4";
const WEEKDAY_INDEX = { sunday:0, monday:1, tuesday:2, wednesday:3, thursday:4, friday:5, saturday:6 };
const fmtUSD = (n) => `$${(Number(n)||0).toFixed(2)}`;
const pad2 = (x) => String(x).padStart(2,"0");
const toLocalDateInput = (d) => `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`;
const isDate = (v) => v instanceof Date && !isNaN(v); // <-- new helper

// Business-day helpers
const isBusinessDay = (d) => d.getDay()!==0 && d.getDay()!==6;
const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0,0,0,0);
const endOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23,59,59,999);

function previousWeekdayFrom(date, targetIndex){
  const d=new Date(date);
  while(d.getDay()!==targetIndex) d.setDate(d.getDate()-1);
  return startOfDay(d);
}
function addBusinessDaysInclusive(start, n){
  const d=new Date(start); let count=1;
  while(count<n){ d.setDate(d.getDate()+1); if(isBusinessDay(d)) count++; }
  return endOfDay(d);
}
function nextBusinessDay(date){
  const d=new Date(date);
  do{ d.setDate(d.getDate()+1); } while(!isBusinessDay(d));
  return startOfDay(d);
}
function computeCycle(now, startWeekday="friday", businessDays=6){
  const idx=WEEKDAY_INDEX[startWeekday.toLowerCase()]??5;
  const today=new Date(now);
  const start=previousWeekdayFrom(today, idx);
  const end=addBusinessDaysInclusive(start,businessDays);
  if(today<start){ const prev=new Date(start); prev.setDate(prev.getDate()-7); return computeCycle(prev,startWeekday,businessDays); }
  if(today>end){ const next=new Date(start); next.setDate(next.getDate()+7); return computeCycle(next,startWeekday,businessDays); }
  return { cycleStart:start, cycleEnd:end, payDate:nextBusinessDay(end) };
}
function listCycles(anchor="friday", businessDays=6, count=26, fromDate=new Date()){
  const out=[]; let {cycleStart}=computeCycle(fromDate,anchor,businessDays);
  for(let i=0;i<count;i++){
    const start=new Date(cycleStart);
    const end=addBusinessDaysInclusive(start,businessDays);
    const payDate=nextBusinessDay(end);
    out.push({cycleStart:start, cycleEnd:end, payDate});
    cycleStart=new Date(start); cycleStart.setDate(cycleStart.getDate()-7);
  }
  return out;
}
function parseDateTimeLocal(dateStr, timeStr){
  if(!dateStr) return null;
  const [y,m,d]=dateStr.split("-").map(Number);
  let hh=0,mm=0; if(timeStr){ const t=String(timeStr).split(":"); hh=Number(t[0]||0); mm=Number(t[1]||0); }
  return new Date(y,m-1,d,hh,mm,0,0);
}

// client-side SHA-256 for owner password hash
async function sha256Hex(str){
  const enc=new TextEncoder(); const buf=await crypto.subtle.digest("SHA-256", enc.encode(str));
  return [...new Uint8Array(buf)].map(b=>b.toString(16).padStart(2,"0")).join("");
}

// storage (patched: revive Dates)
const defaultState={ startWeekday:"friday", cutoffHour:15, ownerPasswordHash:null, drivers:[], data:{} };
function loadState(){
  try{
    const j=localStorage.getItem(KEY);
    if(!j) return defaultState;
    const s=JSON.parse(j);
    if (s?.data && typeof s.data === "object") {
      for (const id of Object.keys(s.data)) {
        const loads = Array.isArray(s.data[id]?.loads) ? s.data[id].loads : [];
        s.data[id] = {
          ...s.data[id],
          loads: loads.map(l => ({
            ...l,
            deliveredAt: l?.deliveredAt ? new Date(l.deliveredAt) : null,
            bolAt: l?.bolAt ? new Date(l.bolAt) : null,
          })),
        };
      }
    }
    return s;
  }catch{
    return defaultState;
  }
}
function saveState(s){ localStorage.setItem(KEY, JSON.stringify(s)); }

// styles
const ibox={ border:"1px solid #cbd5e1", padding:"8px 10px", borderRadius:6, width:"100%" };
const btn={ padding:"8px 12px", border:"1px solid #cbd5e1", borderRadius:6, background:"#fff", cursor:"pointer" };
const btnPrimary={ ...btn, background:"#2563eb", borderColor:"#2563eb", color:"#fff" };
const btnDanger={ ...btn, color:"#b91c1c", borderColor:"#b91c1c" };
const tableStyle={ width:"100%", borderCollapse:"collapse" };
const thStyle={ textAlign:"left", padding:8, border:"1px solid #e5e7eb", background:"#eef2ff" };
const tdStyle={ padding:8, border:"1px solid #e5e7eb" };
const pill=(bg="#eef2ff")=>({display:"inline-block",padding:"2px 8px",background:bg,borderRadius:999});

// tiny UI
function Header({title, right}){
  return (<div style={{display:"flex",justifyContent:"space-between",alignItems:"center",margin:"18px 0"}}>
    <h1 style={{fontSize:28,fontWeight:800}}>{title}</h1><div>{right}</div></div>);
}
function Section({title,children}){ return (<div style={{margin:"16px 0"}}><h2 style={{fontSize:20,fontWeight:700,marginBottom:10}}>{title}</h2>{children}</div>); }
function Card({children,pad=true}){ return <div style={{background:"#f6f7f9",border:"1px solid #e5e7eb",borderRadius:8,padding:pad?16:0}}>{children}</div>; }

// hash route
function useHashRoute(){
  const [hash,setHash]=useState(window.location.hash||"#/driver");
  useEffect(()=>{ const on=()=>setHash(window.location.hash||"#/driver"); window.addEventListener("hashchange",on); return ()=>window.removeEventListener("hashchange",on); },[]);
  return hash.replace(/^#/ ,"")||"/driver";
}

/** Owner portal */
function OwnerAuthGate({state,setState,children}){
  const [pw,setPw]=useState(""); const [newPw,setNewPw]=useState(""); const authed=sessionStorage.getItem("ownerAuthed")==="1";
  if(!state.ownerPasswordHash){
    const setup=async()=>{ if((newPw||"").length<8) return alert("Use at least 8 characters."); const hash=await sha256Hex(newPw); setState({...state, ownerPasswordHash:hash}); sessionStorage.setItem("ownerAuthed","1"); };
    return <Card><div style={{display:"flex",gap:12,alignItems:"end",flexWrap:"wrap"}}><div><label>Create Owner Password<br/><input type="password" value={newPw} onChange={e=>setNewPw(e.target.value)} style={ibox}/></label></div><button onClick={setup} style={btnPrimary}>Save & Enter Owner Portal</button></div><div style={{marginTop:8,fontSize:12,color:"#6b7280"}}>Client‑side only (good for local MVP). Add server auth for production.</div></Card>;
  }
  if(!authed){
    const login=async()=>{ const hash=await sha256Hex(pw); if(hash===state.ownerPasswordHash){ sessionStorage.setItem("ownerAuthed","1"); } else alert("Incorrect password"); };
    return <Card><div style={{display:"flex",gap:12,alignItems:"end",flexWrap:"wrap"}}><div><label>Owner Password<br/><input type="password" value={pw} onChange={e=>setPw(e.target.value)} style={ibox}/></label></div><button onClick={login} style={btnPrimary}>Enter Owner Portal</button></div></Card>;
  }
  const logout=()=>{ sessionStorage.removeItem("ownerAuthed"); window.location.hash="#/driver"; };
  return <div><Header title="Owner Portal" right={<button onClick={logout} style={btn}>Logout</button>} />{children}</div>;
}

function DriverAdmin({state,setState}){
  const [name,setName]=useState(""); const [pin,setPin]=useState(""); const [lease,setLease]=useState(1300); const [pct,setPct]=useState(7.55);
  const add=()=>{ if(!name||!pin) return alert("Name and PIN required."); const id="d_"+Math.random().toString(36).slice(2); const drivers=[...state.drivers,{id,name,pin,lease:Number(lease||0),defaultDispatchPct:Number(pct||0)}]; const data={...state.data,[id]:{loads:[]}}; setState({...state,drivers,data}); setName("");setPin("");setLease(1300);setPct(7.55); };
  const remove=(id)=>{ if(!confirm("Remove this driver?")) return; const drivers=state.drivers.filter(d=>d.id!==id); const data={...state.data}; delete data[id]; setState({...state,drivers,data}); };
  return <Card>
    <div style={{display:"flex",gap:12,flexWrap:"wrap",alignItems:"end"}}>
      <div><label>Name<br/><input value={name} onChange={e=>setName(e.target.value)} style={ibox}/></label></div>
      <div><label>PIN<br/><input value={pin} onChange={e=>setPin(e.target.value)} style={ibox}/></label></div>
      <div><label>Weekly Lease ($)<br/><input type="number" value={lease} onChange={e=>setLease(e.target.value)} style={ibox}/></label></div>
      <div><label>Default Dispatch %<br/><input type="number" step="0.01" value={pct} onChange={e=>setPct(e.target.value)} style={ibox}/></label></div>
      <button onClick={add} style={btnPrimary}>Add Driver</button>
    </div>
    <div style={{marginTop:16}}>
      <table style={tableStyle}><thead><tr>{["Name","PIN","Lease","Dispatch %","Actions"].map(h=>
        <th key={h} style={thStyle}>{h}</th>)}</tr></thead>
      <tbody>{state.drivers.map(d=>(<tr key={d.id}><td style={tdStyle}>{d.name}</td><td style={tdStyle}>{d.pin}</td><td style={tdStyle}>{fmtUSD(d.lease)}</td><td style={tdStyle}>{(d.defaultDispatchPct||0).toFixed(2)}%</td><td style={tdStyle}><button onClick={()=>remove(d.id)} style={btnDanger}>Remove</button></td></tr>))}{state.drivers.length===0&&(<tr><td style={tdStyle} colSpan={5}>No drivers yet.</td></tr>)}</tbody></table>
    </div>
  </Card>;
}

function OwnerSettings({state,setState}){
  const cycle=computeCycle(new Date(),state.startWeekday,6);
  return <Card>
    <div style={{display:"flex",gap:12,alignItems:"center",flexWrap:"wrap"}}>
      <label>Start Weekday&nbsp;
        <select value={state.startWeekday} onChange={e=>setState({...state,startWeekday:e.target.value})} style={ibox}>
          {Object.keys(WEEKDAY_INDEX).map(w=>
            <option key={w} value={w}>{w}</option>)}
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

function OwnerAddLoad({state,setState,driver}){
  const [date,setDate]=useState(toLocalDateInput(new Date()));
  const [time,setTime]=useState("10:00"); const [bolTime,setBolTime]=useState("14:30");
  const [loadNo,setLoadNo]=useState(""); const [origin,setOrigin]=useState(""); const [destination,setDestination]=useState("");
  const [rev,setRev]=useState(""); const [fuel,setFuel]=useState(""); const [misc,setMisc]=useState("");
  const [pct,setPct]=useState(driver?.defaultDispatchPct??7.55);
  useEffect(()=>{ if(driver) setPct(driver.defaultDispatchPct??7.55); },[driver?.id]);
  const add=()=>{
    if(!driver) return alert("Select/add a driver first.");
    const deliveredAt=parseDateTimeLocal(date,time), bolAt=parseDateTimeLocal(date,bolTime);
    const id="l_"+Math.random().toString(36).slice(2);
    const revenue=Number(rev||0), fuelC=Number(fuel||0), miscC=Number(misc||0), dispatchPct=Number(pct||0);
    const dispatchFee=(dispatchPct/100)*revenue; const net=revenue-fuelC-miscC-dispatchFee;
    const entry={id,deliveredAt,bolAt,revenue,fuel:fuelC,misc:miscC,dispatchPct,dispatchFee,net,loadNo,origin,destination,ownerOverride:null};
    const loads=[entry,...(state.data[driver.id]?.loads||[])];
    setState({...state, data:{...state.data, [driver.id]:{loads}}});
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
    <div style={{marginTop:8,fontSize:12,color:"#6b7280"}}>Expense-only days are fine: set Revenue to 0 and fill Fuel/Misc.</div>
  </Card>;
}

function OwnerLoadsTable({state,setState,driver}){
  const cycle=computeCycle(new Date(),state.startWeekday,6);
  const cutoffHour=state.cutoffHour??15;
  const loads=driver?(state.data[driver.id]?.loads||[]):[];
  const rows=loads.map(l=>{
    const late = isDate(l.bolAt)
      ? (l.bolAt.getHours()>cutoffHour || (l.bolAt.getHours()===cutoffHour && l.bolAt.getMinutes()>0))
      : true;
    const inWindow = isDate(l.deliveredAt)
      ? (l.deliveredAt>=cycle.cycleStart && l.deliveredAt<=cycle.cycleEnd)
      : false;
    const autoIncluded=inWindow && !late;
    let included=autoIncluded;
    if(l.ownerOverride==="include") included=true;
    if(l.ownerOverride==="exclude") included=false;
    return {...l,late,inWindow,autoIncluded,included};
  });
  const setOverride=(id,val)=>{
    const cur=state.data[driver.id]?.loads||[];
    const next=cur.map(l=>l.id===id?{...l,ownerOverride:(val==="auto"?null:val)}:l);
    setState({...state, data:{...state.data, [driver.id]:{loads:next}}});
  };
  const remove=(id)=>{
    if(!confirm("Delete this load?")) return;
    const cur=state.data[driver.id]?.loads||[];
    const next=cur.filter(l=>l.id!==id);
    setState({...state, data:{...state.data, [driver.id]:{loads:next}}});
  };
  return <table style={tableStyle}>
    <thead><tr>{["Date","Load #","Origin → Dest","Revenue","Fuel","Misc","Disp %","Disp $","Net","Auto","Override","Included?","Actions"].map(h=>
      <th key={h} style={thStyle}>{h}</th>)}</tr></thead>
    <tbody>
      {rows.map(l=>(<tr key={l.id}>
        <td style={tdStyle}>{isDate(l.deliveredAt) ? l.deliveredAt.toLocaleString() : "-"}</td>
        <td style={tdStyle}>{l.loadNo||"-"}</td>
        <td style={tdStyle}>{(l.origin||"-")} → {(l.destination||"-")}</td>
        <td style={tdStyle}>{fmtUSD(l.revenue)}</td>
        <td style={tdStyle}>{fmtUSD(l.fuel)}</td>
        <td style={tdStyle}>{fmtUSD(l.misc)}</td>
        <td style={tdStyle}>{(l.dispatchPct||0).toFixed(2)}%</td>
        <td style={tdStyle}>{fmtUSD(l.dispatchFee)}</td>
        <td style={tdStyle}>{fmtUSD(l.net)}</td>
        <td style={tdStyle}>{l.autoIncluded ? <span style={pill("#dcfce7")}>auto ✓</span> : <span style={pill("#fee2e2")}>auto ✗</span>}</td>
        <td style={tdStyle}>
          <select value={l.ownerOverride||"auto"} onChange={e=>setOverride(l.id,e.target.value)} style={ibox}>
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

/** Driver portal (read-only) */
function DriverLogin({state,setDriverId}){
  const [pin,setPin]=useState("");
  const login=()=>{ const found=state.drivers.find(d=>d.pin===pin.trim()); if(!found) return alert("Invalid PIN"); setDriverId(found.id); sessionStorage.setItem("driverAuthed",found.id); };
  return <Card><div style={{display:"flex",gap:12,alignItems:"end",flexWrap:"wrap"}}><div><label>Enter PIN to View Earnings<br/><input value={pin} onChange={e=>setPin(e.target.value)} style={ibox}/></label></div><button onClick={login} style={btnPrimary}>View</button></div></Card>;
}
function DriverCyclesView({state,driver}){
  const [cycleIdx,setCycleIdx]=useState(0);
  const cycles=listCycles(state.startWeekday,6,26,new Date());
  const cycle=cycles[cycleIdx]; const cutoffHour=state.cutoffHour??15;
  const loads=driver?(state.data[driver.id]?.loads||[]):[];
  const rowsAll=loads.map(l=>{
    const inWindow = isDate(l.deliveredAt)
      ? (l.deliveredAt>=cycle.cycleStart && l.deliveredAt<=cycle.cycleEnd)
      : false;
    const late = isDate(l.bolAt)
      ? (l.bolAt.getHours()>cutoffHour || (l.bolAt.getHours()===cutoffHour && l.bolAt.getMinutes()>0))
      : true;
    const autoIncluded=inWindow && !late;
    let included=autoIncluded; if(l.ownerOverride==="include") included=true; if(l.ownerOverride==="exclude") included=false;
    return {...l,inWindow,late,autoIncluded,included};
  });
  const rows=rowsAll.filter(l=>l.included && l.inWindow);
  const totals=useMemo(()=>{
    const gross=rows.reduce((a,l)=>a+l.revenue,0);
    const fuel=rows.reduce((a,l)=>a+l.fuel,0);
    const misc=rows.reduce((a,l)=>a+l.misc,0);
    const dispatch=rows.reduce((a,l)=>a+l.dispatchFee,0);
    const net=rows.reduce((a,l)=>a+l.net,0);
    const final=net-((driver?.lease)||0);
    return {gross,fuel,misc,dispatch,net,final};
  },[rows,driver?.lease]);
  const exportCSV=()=>{
    const header=["Date","Load #","Origin","Destination","Revenue","Fuel","Misc","Dispatch %","Dispatch $","Net"];
    const body=rows.map(l=>[isDate(l.deliveredAt)?l.deliveredAt.toLocaleString():"",l.loadNo||"",l.origin||"",l.destination||"",l.revenue,l.fuel,l.misc,l.dispatchPct,l.dispatchFee,l.net]);
    const totalsRow=["Totals","","","",totals.gross,totals.fuel,totals.misc,"",totals.dispatch,totals.net];
    const finalRow=["","","","","","","","Lease",-((driver?.lease)||0),totals.final];
    const csv=[header,...body,[],totalsRow,finalRow].map(r=>r.join(",")).join("\n");
    const blob=new Blob([csv],{type:"text/csv"}); const url=URL.createObjectURL(blob);
    const a=document.createElement("a"); a.href=url; a.download=`driver_${driver.name}_cycle_${toLocalDateInput(cycle.cycleEnd)}.csv`; a.click(); URL.revokeObjectURL(url);
  };
  const exportPDF=async()=>{
    try{
      const html2canvas=(await import("html2canvas")).default;
      const jsPDF=(await import("jspdf")).default;
      const area=document.getElementById("driver-summary-area");
      const canvas=await html2canvas(area,{scale:2});
      const img=canvas.toDataURL("image/png");
      const pdf=new jsPDF({unit:"pt",format:"a4"});
      const pageWidth=pdf.internal.pageSize.getWidth(); const ratio=canvas.height/canvas.width;
      const imgWidth=pageWidth-40; const imgHeight=imgWidth*ratio;
      pdf.text(`Driver: ${driver.name}`,20,24);
      pdf.text(`Cycle: ${cycle.cycleStart.toDateString()} → ${cycle.cycleEnd.toDateString()} | Pay: ${cycle.payDate.toDateString()}`,20,42);
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
      <thead><tr>{["Date","Load #","Origin → Dest","Revenue","Fuel","Misc","Disp %","Disp $","Net"].map(h=>
        <th key={h} style={thStyle}>{h}</th>)}</tr></thead>
      <tbody>
        {rows.map(l=>(<tr key={l.id}>
          <td style={tdStyle}>{isDate(l.deliveredAt) ? l.deliveredAt.toLocaleString() : "-"}</td>
          <td style={tdStyle}>{l.loadNo||"-"}</td>
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

/** App shell */
function App(){
  // --- Hooks must be called unconditionally and in the same order ---
  const [state,setState]=useState(loadState());
  const route=useHashRoute();
  const [driverId,setDriverId]=useState(null);

  useEffect(()=>{ saveState(state); },[state]);

  // Heal stale driverAuthed whenever drivers list changes
  useEffect(()=>{
    const saved=sessionStorage.getItem("driverAuthed");
    if(saved && state.drivers.some(d=>d.id===saved)){
      setDriverId(saved);
    }else{
      sessionStorage.removeItem("driverAuthed");
      setDriverId(null);
    }
  },[state.drivers]);

  const driver=state.drivers.find(d=>d.id===driverId)||null;

  const logout=()=>{ sessionStorage.removeItem("driverAuthed"); setDriverId(null); };

  let content=null;
  if(route==="/admin"){
    content=(
      <>
        <OwnerAuthGate state={state} setState={setState}>
          <Section title="Settings"><OwnerSettings state={state} setState={setState}/></Section>
          <Section title="Drivers"><DriverAdmin state={state} setState={setState}/></Section>
          <Section title="Add Load">
            <OwnerAddLoad state={state} setState={setState} driver={state.drivers[0]||null}/>
          </Section>
          <Section title="Loads (current cycle)">
            {state.drivers.length===0 ? <Card><div style={{padding:12}}>Add a driver above to begin.</div></Card>
              : <OwnerLoadsTable state={state} setState={setState} driver={state.drivers[0]}/>} 
          </Section>
          <div style={{marginTop:10}}><a href="#/driver" style={{textDecoration:"none"}}>Go to Driver Portal →</a></div>
        </OwnerAuthGate>
      </>
    );
  } else {
    content=(
      <>
        <Header title="Driver Portal" right={<a href="#/admin" style={{textDecoration:"none"}}>Owner Login →</a>} />
        {!driverId ? <DriverLogin state={state} setDriverId={setDriverId}/> :
          (<>
            <div style={{marginBottom:8}}>
              <span style={pill()}>Driver: {driver?.name}</span>&nbsp;
              <span style={pill("#dcfce7")}>Lease {fmtUSD(driver?.lease||0)}</span>&nbsp;
              <button onClick={logout} style={{...btn, marginLeft:8}}>Switch Driver</button>
            </div>
            <DriverCyclesView state={state} driver={driver}/>
          </>)}
        <div style={{color:"#6b7280",fontSize:12,marginTop:24}}>
          Driver view is <b>read‑only</b>. Loads and inclusion are controlled by the Owner.
        </div>
      </>
    );
  }

  return (<div style={{fontFamily:"Inter, system-ui, sans-serif", maxWidth:1150, margin:"22px auto"}}>{content}</div>);
}

createRoot(document.getElementById("root")).render(
  <AppErrorBoundary>
    <App />
  </AppErrorBoundary>
);

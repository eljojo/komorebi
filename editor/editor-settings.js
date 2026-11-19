// The device/showing panel. Its host owns preferences; look controls never write them.
import { FIDELITY_KEYS, QUALITY_PROFILES } from '../engine/komorebi-session.js';

export function mountSettings({ settings, engine, save, account, rows, remote }) {
  const panel=document.createElement('dialog');panel.className='session-panel';panel.id='sessionSettings';
  const title=document.createElement('h2');title.textContent='Settings';
  const close=document.createElement('button');close.textContent='done';close.onclick=()=>panel.close();
  panel.append(title,close);
  const controls=[], follows=[];   // follows: [option, () => what the profile gives now], its text kept as "follow profile (that)"
  function heading(text,parent=panel){const h=document.createElement('h3');h.textContent=text;parent.append(h);}
  function select(key,label,options,get,set,parent=panel){
    const row=document.createElement('label');row.className='ctl select';
    const text=document.createElement('span');text.textContent=label;
    const input=document.createElement('select');input.dataset.setting=key;
    for(const [value,label] of options){const o=document.createElement('option');o.value=value;o.textContent=label;input.append(o);}
    const refresh=()=>{input.value=String(get());};controls.push(refresh);
    const own=input.querySelector('option[value="profile"]');
    if(own) follows.push([own,()=>{                    // the session's value while this follows the profile, named as its own option names it
      const v=key in engine.session.playback ? engine.session.playback[key] : engine.session.ceilings[key];
      return typeof v==='boolean' ? (v?'on':'off') : options.find(([o])=>o===String(v))?.[1] ?? String(v);
    }]);
    input.onchange=()=>{set(input.value);save();refreshAll();};
    row.append(text,input);parent.append(row);
  }
  heading('Playback');
  for(const [key,label] of [['auto_quality','keep 60 fps'],['adaptive_motion','adaptive fps'],['adaptive_idle_fps','idle fps']]){
    select(key,label,[['profile','follow profile'],...(key==='adaptive_idle_fps'?[['24','24'],['30','30'],['48','48']]:[['true','on'],['false','off']])],
      ()=>settings.session.playback?.[key] ?? 'profile',value=>{
        settings.session.playback ??= {};
        if(value==='profile')delete settings.session.playback[key];
        else settings.session.playback[key]=key==='adaptive_idle_fps'?Number(value):value==='true';
      });
  }
  const resolved=document.createElement('p');panel.append(resolved);
  heading('Quality');
  select('quality','profile',[['auto','automatic'],...Object.keys(QUALITY_PROFILES).filter(k=>k!=='export').map(k=>[k,k])],
    ()=>settings.session.quality ?? 'auto',value=>{settings.session.quality=value;});
  const details=document.createElement('details'),summary=document.createElement('summary');summary.textContent='quality ceilings';details.append(summary);panel.append(details);
  for(const row of rows.filter(row=>FIDELITY_KEYS.includes(row[1]))){
    const [,key,label]=row;
    const options=row[0]==='sel'?row[3].filter(([,v])=>v>0).map(([l,v])=>[String(v),l])
      : Array.from({length:Math.floor((row[4]-row[3])/row[5])+1},(_,i)=>{const v=row[3]+i*row[5];return [String(v),String(v)];});
    select(key,label,[['profile','follow profile'],...options],()=>settings.session.ceilings?.[key]??'profile',value=>{
      settings.session.ceilings ??= {};
      if(value==='profile')delete settings.session.ceilings[key];else settings.session.ceilings[key]=Number(value);
    },details);
  }
  heading('Presentation');
  select('presentation','display',[['playlist','follow playlist'],['screen','screen / TV'],['projector','projector']],
    ()=>settings.session.presentation??'playlist',value=>{settings.session.presentation=value;});
  const note=document.createElement('p');note.textContent='Projector turns edge-area correction off, darkening the frame slightly. Pacing stays with the playlist.';panel.append(note);
  // the remote control (remote.js): this device takes a phone's commands while it is on and signed in; the line under it says how it stands
  heading('Remote control');
  select('remote','phone',[['off','off'],['on','on']],()=>remote.get()?'on':'off',value=>remote.set(value==='on'));
  const remoteNote=document.createElement('p');panel.append(remoteNote);
  heading('Arboretum');
  const accountRow=document.createElement('div');accountRow.textContent='Looks are kept in this browser. Online accounts are available where Arboretum is hosted.';panel.append(accountRow);
  function refreshStatus(){
    const s=engine.session;
    const startup=s.automaticAdaptive ? s.startupFps===undefined ? ' · checking first 10 s' : ` · first 10 s: ${Math.round(s.startupFps)} fps` : '';
    const text=`${s.quality} · adaptive fps ${s.playback.adaptive_motion?'on':'off'} · idle ${s.playback.adaptive_idle_fps} fps · ${s.presentation}${startup}`;
    if(resolved.textContent!==text)resolved.textContent=text;
    for(const [o,now] of follows){ const t=`follow profile (${now()})`; if(o.textContent!==t)o.textContent=t; }
    const auto=panel.querySelector('[data-setting="quality"] option[value="auto"]'), at=`automatic (${s.quality})`;   // the profile automatic picked here
    if(auto.textContent!==at)auto.textContent=at;
    const remoteText=remote.status();
    if(remoteNote.textContent!==remoteText)remoteNote.textContent=remoteText;
    panel.querySelector('[data-setting="adaptive_idle_fps"]').disabled=!s.playback.adaptive_motion;
  }
  function refreshAll(){for(const refresh of controls)refresh();refreshStatus();}
  document.body.append(panel);
  return { account:accountRow,open(){refreshAll();panel.showModal();account();},refresh(){if(panel.open)refreshStatus();} };
}

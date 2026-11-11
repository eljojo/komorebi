// The device/showing panel. Its host owns preferences; look controls never write them.
import { FIDELITY_KEYS, QUALITY_PROFILES } from './komorebi-session.js';

export function mountSettings({ settings, engine, save, account, rows }) {
  const panel=document.createElement('dialog');panel.className='session-panel';panel.id='sessionSettings';
  const title=document.createElement('h2');title.textContent='Settings';
  const close=document.createElement('button');close.textContent='done';close.onclick=()=>panel.close();
  panel.append(title,close);
  const controls=[];
  function heading(text,parent=panel){const h=document.createElement('h3');h.textContent=text;parent.append(h);}
  function select(key,label,options,get,set,parent=panel){
    const row=document.createElement('label');row.className='ctl select';
    const text=document.createElement('span');text.textContent=label;
    const input=document.createElement('select');input.dataset.setting=key;
    for(const [value,label] of options){const o=document.createElement('option');o.value=value;o.textContent=label;input.append(o);}
    const refresh=()=>{input.value=String(get());};controls.push(refresh);
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
  heading('Arboretum');
  const accountRow=document.createElement('div');accountRow.textContent='Looks are kept in this browser. Online accounts are available where Arboretum is hosted.';panel.append(accountRow);
  function refreshAll(){
    for(const refresh of controls)refresh();
    const s=engine.session;
    resolved.textContent=`${s.quality} · adaptive fps ${s.playback.adaptive_motion?'on':'off'} · idle ${s.playback.adaptive_idle_fps} fps · ${s.presentation}`;
    panel.querySelector('[data-setting="adaptive_idle_fps"]').disabled=!s.playback.adaptive_motion;
  }
  document.body.append(panel);
  return { account:accountRow,open(){refreshAll();panel.showModal();account();} };
}

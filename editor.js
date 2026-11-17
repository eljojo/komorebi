import { create, DEG, PARAMS, CAMERAS, cameraFor, FIDELITY_KEYS, resolveSession } from './komorebi.js';
import { mountSettings } from './editor-settings.js';
import { EXPERIMENTAL, PRESETS, TREE_SPECIES } from './presets.js';
import { mount, getStored, getPreset, getState } from './arboretum.js';
import { entries, resolve, step, starValue, starName, entryName, lookState, playlists, plays, timing, parseHash, makePlayer, selectionAfter, styleOf } from './playlists.js';
import { MACROS, createBus, macroParams, macroUsable, macroValue, tweenGateStep } from './macros.js';
import { makeLeafPreview } from './leaf-preview.js';
import { makeTreePane } from './tree-pane.js';
import { makePlaylistPane } from './playlist-pane.js';
import { senescing } from './komorebi-math.js';
import { LEAF_SHAPES } from './komorebi-leaf.js';
import { mountMidi } from './midi.js';
// ============================================================================
// Komorebi editor (editor.js, loaded by index.html) — the authoring shell around the shared engine
// (komorebi.js). The engine renders; this file is the MODE LADDER's three surfaces — the minimalist strip,
// the playful macro sidebar, and the advanced dev panel (three depths of one control tree) — plus the HUD,
// insets, preset management, sun-drag input and scene-transition stepping. Pure
// sub-concerns are split into siblings: arboretum.js (where every preset is kept: the ★ looks in localStorage, and arboretum online where the browser allows), playlists.js (the lists the dropdown shows and the arrows step), playlist-pane.js (the workspace's list of them), macros.js (the control-bus
// macro mappings the upper rungs drive). The
// viewer-only player (player.html) is a separate, UI-less consumer of the same engine. ES modules — must be
// SERVED over http(s) (`nix run .#dev`), not opened off the filesystem.
// ============================================================================
const canvas = document.getElementById('gl');
const dev = document.getElementById('dev');
const play = document.getElementById('play');
const strip = document.getElementById('strip');
const hud = document.getElementById('hud');
const clamp = (x,a,b) => Math.min(b, Math.max(a, x));
const fmt = (v) => Number.isInteger(v) ? String(v)
  : Math.abs(v)>=100 ? String(Math.round(v))   // big non-integers (azimuth / wind dir, step 1°) round to whole, not a 17-digit float
  : (+v).toFixed(2);

// ---- presets: the editor only saves, loads and lists looks through arboretum.js (getPreset: built-ins + ★ looks) ----
const DEFAULT_PRESET = 'afternoon 7';   // the editor's working default + fallback look (preset DATA lives in presets.js)
const WELCOME_PRESET = 'afternoon 6';   // the look shown faint behind the intro, until "feel"

// ---- editor settings (mode ladder + experimental filter), persisted beside the ★ store. The three modes are
// three DEPTHS of one control tree — min (the strip: 3 macros) ⊂ play (the sidebar: the macro bus) ⊂ adv (every
// knob) — so "mode" is just which surface is showing. First run boots the MINIMALIST strip everywhere (the art
// stands alone; ＋ climbs the ladder when you want more); the choice sticks thereafter. ----
const SETTINGS_KEY = 'komorebi.editor';
const settings = (() => {
  const base = { mode: 'min', showBeta: false, playlist: 'local', selected: {}, open: {}, sawTouchHint: false, workspace: false, wsPane: 'tree' };   // playlist: 'local' | 'arb:<id>'; selected: the entry you were on, per playlist; open: the advanced panel's areas, by name; wsPane: the workspace's right-hand pane, 'tree' | 'playlist'
  let s = base;
  try { s = Object.assign(base, JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}')); }
  catch { /* unreadable: the defaults */ }
  if(typeof s.playlist !== 'string') s.playlist = 'local';
  if(!s.selected || typeof s.selected !== 'object') s.selected = {};
  if(!s.open || typeof s.open !== 'object') s.open = {};
  return s;
})();
function saveSettings(){ try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* storage disabled — the mode just doesn't stick */ } }
const sessionEnvironment = { userAgent: navigator.userAgent };
try { resolveSession(settings.session ?? {}, sessionEnvironment); } catch { delete settings.session; }
settings.session ??= { version: 1 };
let sessionSignature='';
function applySession(){
  const presentation=stateNow().playlists[activeList().slice(4)]?.presentation;
  const signature=JSON.stringify([settings.session,presentation]);
  if(signature===sessionSignature) return;
  sessionSignature=signature;
  eng.setSession(settings.session,{...sessionEnvironment,presentation});
}

// ---- boot the engine on the canvas ------------------------------------------
let eng;
try { eng = create(canvas, { params: getPreset(WELCOME_PRESET), session: settings.session, environment: sessionEnvironment }); }
catch(e){ document.body.innerHTML = `<div class="err">${e.message}</div>`; throw e; }
const params = eng.params;   // live params the panel edits in place
const perf = eng.perf;
// time-of-day is an editor-only INPUT method (it writes sun elevation/azimuth); not an engine param.
if(params.time_of_day===undefined) params.time_of_day = 9;
if(params.latitude===undefined) params.latitude = 45;   // ~Montreal, where this began
function applyScope(scope){ stopPlay(); chipSoon(); return eng.apply(scope); }   // slider/toggle rebuild — every edit of the look comes through here (or updateSunFromTime, a drag, species, paste, save), stops play and wakes the look's chip
function reseed(){ params.seed=Math.floor(Math.random()*1e9); applyScope('canopy'); }   // same grove, grown again
function applyParams(obj){ endTween(); trySeasonCancel(); eng.setParams(obj); syncAllControls(); chipSoon(); }  // load a whole preset (instant)
// The chip under the look select (lookChip, built with the presets UI) says "● edited" once the live params leave the entry's, so it is
// looked at again after each edit: at most every 200 ms, the last edit always read.
let lookChip=null, chipTimer=0;
function chipSoon(){ if(!chipTimer) chipTimer=setTimeout(()=>{ chipTimer=0; refreshChip(); }, 200); }
let midi=null;                   // the MIDImix prototype (midi.js), mounted once everything it borrows exists
let transDur=1.5;                // scene-transition seconds (editor-only — a performance setting, not stored in a look)

// ===========================================================================
// Dev panel
// ===========================================================================
const controlEls={};   // key -> {input, valEl}
let dragSun=false;     // desktop canvas-drag mode: false = orbit the camera (the default — "make sense of things"), true = drag the sun (the novelty). Toggled by the Scene area's button.
// shape knobs the TREE_SPECIES bundles set — editing one means you've diverged from the picked species, so the
// dropdown drops back to "— custom" (the tree_species label clears). Scene knobs (light/camera/wind) aren't here:
// species is shape-only, so tweaking those keeps the species name (§4.5).
const SHAPE_KEYS = new Set(Object.values(TREE_SPECIES).flatMap(b => Object.keys(b)));
function maybeClearSpecies(key){
  if(SHAPE_KEYS.has(key) && params.tree_species){
    params.tree_species='';
    if(controlEls.tree_species) controlEls.tree_species.input.value='';   // select the empty "— custom" option
  }
}
// frame shadow (spec §4.8 / #56): one-time camera move that centres the view on where the tree's CROWN shadow lands,
// so the trunk foot sits up-sun (toward / off the frame edge) and the cast shadow fills the view — the "shadow-only"
// composition. Derived from params (the standing-scene bulk throw cot(elev)·anti-sun, × a representative crown height),
// NOT a per-frame auto-track (the spec records auto-centring on the crown as a dead end — the trunk foot doesn't
// shift while the crown does, so it tears the shadow). It's a STARTING frame to nudge, not the final composition.
function frameShadow(){
  if(!params.standing_scene){ params.standing_scene = true; applyScope('canopy'); syncControl('standing_scene'); }   // shadow framing only means anything with the bulk throw on
  const el=Math.max(params.sun_elevation_deg,6)*Math.PI/180, az=params.sun_azimuth_deg*Math.PI/180, k=Math.cos(el)/Math.sin(el);
  const hCrown = params.canopy_base_height_m + 0.5*params.canopy_thickness_m;   // representative crown height the shadow throws from
  // crown shadow lands at world = -hCrown·bulk (the occluder at height h casts at plan − h·bulk); centre the view there.
  params.view_center_x = clamp(-k*Math.cos(az)*hCrown, -25, 25);   // clamp to the pan slider range so the thumb stays in sync
  params.view_center_y = clamp(-k*Math.sin(az)*hCrown, -25, 25);
  params.view_extent_m = clamp(params.canopy_extent_m*2.2, 0.5, 40);            // show the whole cast + a margin of lit floor
  if(params.view_pitch_deg < 40) params.view_pitch_deg = 55;                    // a raking gaze reads the streak; keep an already-steeper tilt
  for(const key of ['view_center_x','view_center_y','view_extent_m','view_pitch_deg']) syncControl(key);
  applyScope('');
}

// THE PANEL'S LAYOUT: its areas ('hc'), the groups inside them ('adv'), the buttons, and each parameter's row by name, in order. The row
// itself (kind, label, range or choices, rebuild scope) and its hover text are the parameter's, in PARAMS (komorebi-params.js); rowOf below
// turns a name into the row the builders take. The rebuild scopes: 'source' rebuilds the light; 'canopy' rebuilds+rebakes leaves;
// 'season' re-seasons cached leaves; 'density' reweights a fixed summer grove, or regrows outside its gate;
// 'textures' reallocates layer textures too; 'perf' resets auto-quality; '' just re-reads each frame.
const PANEL_LAYOUT = [
  ['hc','Sun'],
  'time_of_day',
  'latitude',
  'sun_elevation_deg',
  'sun_azimuth_deg',
  'sun_cosine',
  'sun_extinction',
  'cloud_thickness',
  'core_weight_fraction',
  'core_angular_radius_deg',
  'halo_angular_radius_deg',
  'eclipse',
  'eclipse_amount',

  ['hc','Colour & light'],
  'tone_map',
  'exposure',
  'contrast',
  'ambient_skylight',
  'canopy_fill',
  'leaf_diffuse',
  'edge_area',
  'fill_scatter',
  'sky_turbidity',
  'mesopic_strength',
  'chromatic_aberration',
  'trans_r',
  'trans_g',
  'trans_b',
  'ground_r',
  'ground_g',
  'ground_b',
  'vignette',
  'vignette_shape',

  ['hc','Density'],
  'foliage_density',
  'tree_count',
  'grove_reach_m',
  'leaves_per_cluster',
  'inner_leaves',
  'cluster_spread_m',
  'shoot_leaves',
  'tilt_light',
  'canopy_extent_m',
  'canopy_thickness_m',
  ['btn','reseed', reseed],

  ['hc','Season'],
  'phenology',
  'turn_start',
  'turn_span',
  'turn_spread',
  'tree_clock_spread',
  'tree_pigment_spread',
  'anthocyanin',
  'tannin',
  'wall_fraction',
  'turn_exposure',
  'exposure_absolute',
  'leaf_drop',
  'drop_exposure',
  'drop_start',
  'drop_span',
  'drop_lag',
  'drop_after_turn',
  'litter',
  'litter_age',
  'litter_drift_m',
  'leaf_wetness',

  ['hc','Leaves'],
  'leaf_shape',
  'leaf_size_m',
  'leaf_aspect',
  'leaf_variety',
  'max_tilt',
  'edge_softness',

  ['hc','Tree shape'],
  ['species','species'],
  'branch_children',
  'branch_angle_deg',
  'branch_length_ratio',
  'branch_pitch_deg',
  'leader_strength',
  'growth_years',
  'droop',
  'taper_delta',
  'crown_aspect',
  'phyllotaxis',
  'branch_levels',
  'branch_tau',
  'canopy_base_height_m',
  'trunk_radius_m',
  'faithful_canopy',

  ['hc','Scene'],
  'sky_view',
  'standing_scene',
  'tree_view',
  'bark_r',
  'bark_g',
  'bark_b',
  'view_extent_m',
  'view_pitch_deg',
  'view_yaw_deg',
  'view_center_x',
  'view_center_y',
  'view_fov_deg',
  'far_smear',
  'park_throw',
  'sky_scatter',
  'glow_bleed',
  'glow_bleed_m',
  ['btn','drag: camera', (e)=>{ dragSun=!dragSun; e.target.textContent=`drag: ${dragSun?'sun':'camera'}`; }],
  ['btn','frame shadow', ()=>frameShadow()],   // one-time camera framing onto the cast shadow (the off-frame-tree / shadow-only composition, spec §4.8) — a starting point to nudge, NOT an auto-track

  ['hc','Wind'],
  'wind_pattern',
  'wind_strength',
  'wind_gustiness',
  'gust_frequency',
  'wind_direction_deg',
  'weather_variability',
  'weather_speed',
  ['adv','spring mechanics'],
  'gust_attack',
  'gust_decay',
  'sway_stiffness',
  'sway_ceiling',
  'damping_ratio',
  'backlash_gain',
  'sway_height_gain',
  'sway_pitch',
  'limb_count',
  'limb_flex',
  'twig_flex',
  'stem_length',
  'leaf_swing',
  'flutter_freq',
  'wind_air',
  'wind_depth',
  ['adv','leaf drift'],
  'drift_amount',
  'drift_phase',
  'drift_auto',
  'drift_speed',

  ['hc','Quality requests'],
  'sample_count',
  'tex_resolution',
  'layer_count',
  'bake_resolution',
  'fill_directions',
  'fill_resolution',
  'litter_resolution',
  'adaptive_motion',
  'adaptive_idle_fps',
  'auto_quality',

  ['hc','Debug'],
  'show_source',
  'show_layer',
  'show_layer_index',

  ['hc','Lab'],
  'receiver',
  'fabric_tt',
  'fabric_tint_r',
  'fabric_tint_g',
  'fabric_tint_b',
  'cloth_distance_m',
  'fold_depth',
  'fabric_nap',
  'fold_scale',
  'fold_coarsen',
  'fold_warp',
  'velvet_sheen',
  'fabric_scatter',
  'mullion_tau',
  'mullion_pitch_m',
  'mullion_bar_m',
  'mullion_depth_m',
  'window_w_m',
  'window_h_m',
  'window_cx_m',
  'window_cy_m',
  'window_wall',
  'tent_ridge_h_m',
  'tent_half_w_m',
  'tent_crown_w_m',
  'tent_shoulder_h_m',
  'tent_shoulder_w_m',
  'tent_len_m',
  'tent_end_lean',
  'tent_end_apex_h_m',
  'tent_hip_rake',
  'tent_eye_h_m',
  'tent_fade',
  'tent_seam',
  'tent_mesh',
];
// a parameter's row as the panel's builders, the Settings panel and the MIDImix take it: [kind, key, label, min, max, step, rebuild]
// for a slider, [kind, key, label, rebuild] for a toggle, [kind, key, label, choices, rebuild] for a select; the row is the registry's
function rowOf(key){
  const r=PARAMS[key]?.row;
  if(!r) throw new Error(`the panel names ${key}, which has no row in PARAMS (komorebi-params.js)`);
  return r.kind==='s' ? ['s',key,r.label,r.min,r.max,r.step,r.rebuild] : r.kind==='t' ? ['t',key,r.label,r.rebuild] : [r.kind,key,r.label,r.choices,r.rebuild];
}
const PANEL = PANEL_LAYOUT.map((item)=>typeof item==='string' ? rowOf(item) : item);

// The areas open the way he left them (settings.open, by area name); until he has touched one, these three are open: the
// passes he makes most (colour and density for the projector, the season). The rest start closed.
const OPEN_AREAS = new Set(['Colour & light', 'Density', 'Season']);
function buildPanel(){
  let area = dev, container = dev;                            // rows append to `container`; an 'hc' area, or an 'adv' group inside one, redirects them into a <details>
  const group=(text,cls,parent)=>{ const d=document.createElement('details'); const s=document.createElement('summary');
    s.textContent=text; s.dataset.tipKey=text; s.className=cls; d.appendChild(s); parent.appendChild(d); return d; };
  for(const item of PANEL){
    if(['auto_quality','adaptive_motion','adaptive_idle_fps','edge_area'].includes(item[1])) continue;
    if(item[0]==='hc'){                                        // an area: a collapsible section whose state is remembered
      const name=item[1], d=group(name,'sec',dev);
      d.open = settings.open[name] ?? OPEN_AREAS.has(name);
      d.addEventListener('toggle',()=>{ if(settings.open[name]!==d.open){ settings.open[name]=d.open; saveSettings(); } });
      area=container=d; continue;
    }
    if(item[0]==='adv'){ container=group(item[1],'adv',area); continue; }   // a collapsible sub-group inside the current area (closed by default, not remembered)
    const row=document.createElement('div'); row.className='ctl';
    if(item[0]==='s'){
      const [,key,label,min,max,step,scope]=item;
      const lab=document.createElement('label'); lab.textContent=label;
      const inp=document.createElement('input'); inp.type='range'; inp.min=min; inp.max=max; inp.step=step; inp.value=params[key];
      const val=document.createElement('span'); val.className='val'; val.textContent=fmt(params[key]);
      inp.addEventListener('input',()=>{ if(FIDELITY_KEYS.includes(key)){ stopPlay();eng.setLookRequest(key,parseFloat(inp.value),scope);syncAllControls();chipSoon();return; } params[key]=parseFloat(inp.value); val.textContent=fmt(params[key]); maybeClearSpecies(key);
        if(scope==='suntime') updateSunFromTime(); else applyScope(scope); });
      row.append(lab,inp,val); controlEls[key]={input:inp,valEl:val,row}; row.dataset.tipKey=key;
    } else if(item[0]==='t'){
      const [,key,label,scope]=item; row.classList.add('toggle');
      const lab=document.createElement('label'); lab.textContent=label;
      const inp=document.createElement('input'); inp.type='checkbox'; inp.checked=params[key];
      inp.addEventListener('change',()=>{ params[key]=inp.checked; applyScope(scope); });
      row.append(lab,inp); controlEls[key]={input:inp,row}; row.dataset.tipKey=key;
    } else if(item[0]==='sel' || item[0]==='sels'){    // 'sel' = integer value, 'sels' = string value (e.g. wind_pattern)
      const str=item[0]==='sels';
      const [,key,label,opts,scope]=item; row.classList.add('select');
      const lab=document.createElement('label'); lab.textContent=label;
      const sel=document.createElement('select');
      for(const [t,v] of opts){ const o=document.createElement('option'); o.value=v; o.textContent=t; if(v===params[key]) o.selected=true; sel.appendChild(o); }
      sel.addEventListener('change',()=>{ if(FIDELITY_KEYS.includes(key)){stopPlay();eng.setLookRequest(key,parseInt(sel.value,10),scope);syncAllControls();chipSoon();return;} params[key]=str?sel.value:parseInt(sel.value,10); maybeClearSpecies(key); applyScope(scope); });
      row.append(lab,sel); controlEls[key]={input:sel,row}; row.dataset.tipKey=key;
    } else if(item[0]==='species'){    // TREE_SPECIES: merge the chosen shape bundle OVER the current look (shape ⟂ scene), stamp the label, rebuild
      const [,label]=item; row.classList.add('select');
      const lab=document.createElement('label'); lab.textContent=label;
      const sel=document.createElement('select');
      const o0=document.createElement('option'); o0.value=''; o0.textContent='— custom'; sel.appendChild(o0);
      for(const name of Object.keys(TREE_SPECIES)){ const o=document.createElement('option'); o.value=name; o.textContent=name; if(name===params.tree_species) o.selected=true; sel.appendChild(o); }
      sel.addEventListener('change',()=>{ const b=TREE_SPECIES[sel.value]; stopPlay();
        if(b) applyParams(Object.assign({}, eng.captureLook(), b, { tree_species:sel.value }));   // bundle over the live params, keep the scene
        else params.tree_species=''; });
      row.append(lab,sel); controlEls.tree_species={input:sel,row}; row.dataset.tipKey='tree_species';
    } else if(item[0]==='btn'){
      const [,label,fn]=item;
      const b=document.createElement('button'); b.textContent=label; b.addEventListener('click',fn);
      row.appendChild(b); row.dataset.tipKey=label;
    }
    if(FIDELITY_KEYS.includes(item[1])){
      const key=item[1],scope=item[0]==='s'?item[6]:item[4];
      const inherit=mkBtn('use session',()=>{stopPlay();eng.setLookRequest(key,undefined,scope);syncAllControls();chipSoon();});
      inherit.dataset.inherit=key;
      row.append(inherit);
    }
    container.appendChild(row);
  }
}
// ===========================================================================
// INERT ROWS (§4.9). A knob the current look never reads is a slider that lies: you drag it and the frame does
// not move. Those rows go away instead. Two kinds of gate, and they compose.
//
// THE CAMERA GATE asks the transport registry rather than restating it. A camera speaks a fixed list of uniform
// GROUPS (CAMERAS[cam].groups); a knob whose group is not on that list is never uploaded, never declared, and
// cannot reach the frame — so the table below only has to say which group carries each knob, which is the same
// pairing GROUP_UPLOAD's bodies make. A camera that gains or loses a group re-gates the panel with it.
//
// THE LOCAL GATE is the handful of knobs a toggle or a zero switches off INSIDE a camera that does read them —
// the "gate" the params/GLSL comments already name (window w·h = 0, mullion tau 0, glow_bleed 0, eclipse off).
// Nothing here changes a param: hiding a row leaves its value in the look, exactly where a preset put it.
// ===========================================================================
const CAM_GROUP = {   // knob -> the transport uniform group that carries it to the shader
  view_pitch_deg:'rayView', view_yaw_deg:'rayView', view_fov_deg:'rayView',   // the curtain is seen head-on: no ray camera, so no tilt/orbit/lens
  far_smear:'floor', park_throw:'floor', ground_r:'floor', ground_g:'floor', ground_b:'floor',    // an albedo needs a floor to reflect off
  tree_view:'floor', bark_r:'floor', bark_g:'floor', bark_b:'floor',   // the tree is seen from the floor camera alone
  cloth_distance_m:'cloth',
  fabric_tt:'fabric', fabric_tint_r:'fabric', fabric_tint_g:'fabric', fabric_tint_b:'fabric',
  fold_depth:'fabric', fabric_nap:'fabric', fold_scale:'fabric', fold_coarsen:'fabric', fold_warp:'fabric',
  velvet_sheen:'fabric', fabric_scatter:'fabric',
  mullion_tau:'window', mullion_pitch_m:'window', mullion_bar_m:'window', mullion_depth_m:'window',
  window_w_m:'window', window_h_m:'window', window_cx_m:'window', window_cy_m:'window', window_wall:'window',
  tent_ridge_h_m:'tent', tent_half_w_m:'tent', tent_crown_w_m:'tent', tent_shoulder_h_m:'tent', tent_shoulder_w_m:'tent',
  tent_len_m:'tent', tent_end_lean:'tent', tent_end_apex_h_m:'tent', tent_hip_rake:'tent', tent_eye_h_m:'tent',
  tent_fade:'tent', tent_seam:'tent', tent_mesh:'tent',
  sky_scatter:'sky',
  sun_cosine:'transport',          // the uniform rides every camera's head group (the sky view's too, where the factor is always 1: radiance has no surface), so head cannot tell the sky view apart; 'transport' stands in for "has a cast": the floor, the cloth and the tent speak it and the sky view (head, not transport) does not, so the row is live where the beam lands on a receiver (§3.5)
  canopy_fill:'fill', fill_scatter:'fill', fill_directions:'fill', fill_resolution:'fill',   // the sky view lights no surface, so it speaks no fill group (§4.7)
  litter:'litter', litter_age:'litter', litter_drift_m:'litter', leaf_wetness:'litter', litter_resolution:'litter',   // only the floor reflects, so only the floor has fallen leaves to reflect off (§4.7): the cloth transmits and the sky view has no surface
  edge_area:['beam','sky'],        // the same two groups carry its uniform: the cast cameras' beam group and the sky view's own
  leaf_diffuse:['beam','sky'],     // the beam's k is read at the cast cameras' taps (their beam group) and, as the lantern's disk and glow (§4.9), by the sky view's own group — any one of them
  chromatic_aberration:'ca',       // the sky view runs no cast, so there is no transport shift to split by wavelength
  faithful_canopy:'faith',         // the enclosure and the sky view force the layer tier and bake no faith texture
};
const faithLive = (cam) => params.faithful_canopy && !!CAMERAS[cam].faith;   // faithfulOn(), read off the registry
const apertureOn = () => params.window_w_m*params.window_h_m > 0;
const turning = () => senescing(params);                                     // the grove's own senescing gate (komorebi-math.js): past turn_start, or past the earliest tree's turn when tree_clock_spread opens it sooner
const dropping = () => turning() && params.leaf_drop > 0;                    // abscission's own gate (leaf_drop > 0, komorebi-grove.js), behind the season's
const carpeted = () => dropping() && params.litter > 0;                      // the litter carpet's own gate (§4.7): it lays the leaves leaf fall lets go of, so with none falling there is nothing to bake
const glowOn = (cam) => cam !== 'floor' && params.glow_bleed > 0;            // the diffusion tier's own gate (render.js drawFrameInto)
const fillOpen = () => params.canopy_fill > 0;                               // the sky fill's own gate (§4.7): until it opens nothing bakes
const splitOn = () => params.leaf_diffuse > 0;                               // a leaf is not a window (§4.5): the P0b albedo is the proxy this replaces, and is off above 0
const LOCAL_GATE = {   // knob -> what else has to be true inside a camera that does carry it
  tree_view: (cam) => params.standing_scene && faithLive(cam),   // a tree standing in the scene, cast faithfully: the overhead park's canopy is endless and above the frame
  bark_r: (cam) => params.tree_view && params.standing_scene && faithLive(cam), bark_g: (cam) => params.tree_view && params.standing_scene && faithLive(cam), bark_b: (cam) => params.tree_view && params.standing_scene && faithLive(cam),
  edge_area: () => !splitOn(),                            // above leaf diffuse 0 every texel is already a mixture (§4.5): the knob has nothing left to change
  receiver: () => !params.sky_view,                       // looking up overrides the receiver outright — there is no surface to pick
  eclipse_amount: () => params.eclipse,
  far_smear: () => params.view_pitch_deg > 0,             // the far-field footprint is exactly 0 at pitch 0 (§4.7)
  park_throw: () => !params.standing_scene && !params.receiver,   // a standing scene and the cloth always throw: the knob is the overhead park's
  view_extent_m: (cam) => CAMERAS[cam].groups.includes('floor') || CAMERAS[cam].groups.includes('cloth') || glowOn(cam),   // elsewhere it survives only as the glare radius' divisor
  glow_bleed: (cam) => cam !== 'floor',
  glow_bleed_m: (cam) => glowOn(cam),
  mullion_pitch_m: () => params.mullion_tau > 0,
  mullion_bar_m: () => params.mullion_tau > 0,
  mullion_depth_m: () => params.mullion_tau > 0 || apertureOn(),   // the aperture is the window's outermost bar: it throws from the same plane
  window_cx_m: apertureOn, window_cy_m: apertureOn, window_wall: apertureOn,
  drift_speed: () => params.drift_auto && params.drift_amount > 0,
  adaptive_idle_fps: () => params.adaptive_motion,
  leaf_variety: () => !!LEAF_SHAPES[params.leaf_shape],      // only an outline has rows to vary (§4.5): the ellipse's leaf is one stamp, so the knob would act on nothing
  anthocyanin: turning, tannin: turning, wall_fraction: turning, turn_exposure: turning,   // senescence (§4.5): until a leaf has begun to turn (phenology past turn_start) its tau is the authored summer one, whatever these say
  turn_span: turning, turn_spread: turning,
  tree_clock_spread: turning, tree_pigment_spread: turning,   // §4.5: a tree's lead and depth act on a leaf that can be turning — the same gate the pigments sit behind, which opens by the lead's own reach
  leaf_drop: turning,                                     // abscission (§4.5): the same season gate the pigments sit behind — before a leaf can be turning, no leaf is about to fall
  drop_exposure: () => dropping() && !(params.drop_after_turn > 0), drop_start: () => dropping() && !(params.drop_after_turn > 0), drop_span: () => dropping() && !(params.drop_after_turn > 0),   // ride on leaf fall: with it at 0 nothing drops, so when and in what order are moot; after its turn the day is the turn's end plus the lag and these are not read
  drop_after_turn: dropping,                              // a leaf lets go after it has turned (§4.5): with nothing falling there is no day to bind to the turn
  drop_lag: () => dropping() && params.drop_after_turn > 0,
  litter: dropping,                                       // the carpet (§4.7): the leaves it lays are the ones leaf fall lets go of
  litter_age: carpeted, litter_drift_m: carpeted, leaf_wetness: carpeted, litter_resolution: carpeted,   // sliders on a bake that does not run until the gate is open and a leaf can have fallen
  exposure_absolute: () => (turning() && params.turn_exposure > 0) || (dropping() && !(params.drop_after_turn > 0) && params.drop_exposure > 0),   // it chooses what the exposure order is made of, and two read that order: sun first, and the fall while leaves let go by the light (the engine's ordered(), komorebi-math.js, read through this panel's own turning()/dropping() like the drop rows) — with neither there is no order for it to change
  sky_scatter: () => !splitOn(),                          // the sky view's twin of fill_scatter (§4.9): above leaf_diffuse 0 the leaf is a lantern and its measured glow replaces this authored one — counting both would count it twice
  fill_scatter: (cam) => fillOpen() && !splitOn() && CAMERAS[cam].groups.includes('floor'),   // the floor alone reads the proxy's scattered light; the cloth and the tent take the skylight through the canopy and nothing else. Above leaf_diffuse 0 the measured diffuse light replaces it, so the slider would lie
  fill_directions: fillOpen, fill_resolution: fillOpen,   // sliders on a bake that does not run while canopy_fill is 0
  show_layer: (cam) => !faithLive(cam),                   // faithful mode taps one texture; the layer slices aren't baked
  show_layer_index: (cam) => params.show_layer && !faithLive(cam),
};
const GATED_KEYS = [...new Set([...Object.keys(CAM_GROUP), ...Object.keys(LOCAL_GATE)])];
function rowLive(key, cam){
  const g = CAM_GROUP[key];
  if(g && ![].concat(g).some(name => CAMERAS[cam].groups.includes(name))) return false;   // a knob carried by several groups is live where any one of them is spoken
  const gate = LOCAL_GATE[key];
  return gate ? !!gate(cam) : true;
}
// Everything the predicates above read, in one string — so the DOM pass below runs on a CHANGE and not on a
// frame. It is called per frame (params move under transitions and macros too, not just under these rows).
function gateSig(){
  const cam = cameraFor(params);
  return [cam, params.eclipse, params.view_pitch_deg>0, params.glow_bleed>0, params.mullion_tau>0, apertureOn(),
          params.drift_auto && params.drift_amount>0, params.adaptive_motion, params.show_layer, faithLive(cam), turning(), params.turn_exposure>0, params.leaf_drop>0, params.drop_after_turn>0, params.drop_exposure>0, params.litter>0, fillOpen(), splitOn(), params.leaf_shape].join('|');
}
let gateSigLast = null;
function refreshGates(){
  const sig = gateSig(); if(sig === gateSigLast) return;
  gateSigLast = sig;
  const cam = cameraFor(params);
  for(const key of GATED_KEYS) if(controlEls[key]) controlEls[key].row.hidden = !rowLive(key, cam);
  // an area, a sub-group or a heading with nothing left under it would dangle (the whole Lab, once you look up),
  // so they follow their rows — a sub-group's rows count toward its area too.
  for(const d of dev.querySelectorAll('details')) d.hidden = ![...d.querySelectorAll('.ctl')].some(r => !r.hidden);
  let head=null, any=false;
  for(const el of dev.children){
    if(el.tagName === 'H2'){ if(head) head.hidden = !any; head = el; any = false; continue; }
    if(!el.hidden) any = true;
  }
  if(head) head.hidden = !any;
}

function syncControl(key){ const c=controlEls[key]; if(!c)return;
  if(FIDELITY_KEYS.includes(key)){
    const request=eng.authored[key];
    c.input.value=request??params[key];
    if(c.valEl)c.valEl.textContent=fmt(request??params[key]);
    const inherit=c.row.querySelector('[data-inherit]');
    inherit.textContent=request===undefined?'session':'use session';
    inherit.title=`effective ${params[key]} · ceiling ${eng.session.ceilings[key]}`;
    return;
  }
  if(c.input.type==='checkbox') c.input.checked=!!params[key]; else c.input.value=params[key];
  if(c.valEl) c.valEl.textContent=fmt(params[key]); }
function syncAllControls(){ for(const k in controlEls) syncControl(k); tryCapture(); syncMacroControls(); midi?.look(); }   // every load of a look lands here: the try-out's home is the look's own values

// ===========================================================================
// The playful + minimalist surfaces (the mode ladder's upper rungs) and the
// CONTROL BUS they drive. Every high-level control writes bus keys; the bus
// (macros.js) turns one t into the authored param recipe and this applier
// lands it on the live engine. A future MIDI/audio source calls the same
// bus.set and needs nothing from this file.
// ===========================================================================
// THE TWEEN'S COST GATE (macros.js: a `tween` macro applies the recipe each tick, at scope 'season'). The apply is CPU, so it is timed
// where it happens: an EMA of what applyScope('season') costs. Over 12 ms the next live apply waits cost/0.30 ms of wall
// time (applies take at most ~30% of it) — the ease keeps running on the clock meanwhile (tickTween hands the bus the
// summed dt, which a one-pole composes exactly, until the bus's step clamp binds), so the catch-up is a bigger step, not a stall. Over 50 ms on the EMA
// the look falls back to the old behaviour: no live applies, one exact apply on release. The cost is the look's own, and the engine decides what an apply is:
// the fall half of the axis only moves the season set, so the engine re-runs the season arithmetic over the grove's cached leaves (§4.5 "Re-seasoning");
// the spring half moves structure and regrows. Measured with bun at t 0.9 (median of 11), regrow -> re-season: afternoon 7 62 -> ~6 ms (summer's own regrow is
// 15), the void 154 -> ~14 (47), montebello 12 -> ~1 (3.3). Both big looks stay under the 50 ms line, which used to take them out of the live half. The first apply
// of a drag on a grove without the cache is a full build (the regrow's cost, plus the record): a one-off the next tick never pays again, so it is NOT measured —
// it would seed the EMA over the off line on a heavy fall look and latch the fallback for the whole drag (unless it follows another build: the spring half regrows
// every tick and stays gated). The thresholds and the EMA step live in macros.js, tweenGateStep.
let tweenCost = 0, tweenWaitUntil = 0, tweenOff = false, tweenPath = null, tweenAcc = 0, tweenLast = performance.now();
function endTween(){ bus.cancel(); tweenCost = 0; tweenWaitUntil = 0; tweenOff = false; tweenPath = null; tweenAcc = 0; }   // any route that loads a look: or the tween keeps writing CANOPY keys over it
function tickTween(){
  const now = performance.now(), dt = Math.min(0.1, (now - tweenLast) / 1000);   // a tab that slept must not jump the ease
  tweenLast = now;
  tweenAcc += dt;
  if(tweenOff || eng.trans.active || now < tweenWaitUntil) return;              // a look in transition owns the canopy keys
  const d = tweenAcc; tweenAcc = 0;
  bus.tick(d);
}
const bus = createBus(() => params, (dict, scope, _live) => {
  Object.assign(params, dict);
  for(const k in dict){ maybeClearSpecies(k); syncControl(k); }   // the advanced sliders track the macro underneath
  if(scope === 'season'){
    const t0 = performance.now();
    const path = applyScope(scope);
    const g = tweenGateStep({ cost: tweenCost, waitUntil: tweenWaitUntil, off: tweenOff, last: tweenPath }, performance.now() - t0, path, t0);
    tweenCost = g.cost; tweenWaitUntil = g.waitUntil; tweenOff = g.off; tweenPath = g.last;
  } else if(scope !== null) applyScope(scope);
});
const macroEls = {};      // bus key -> range input (play + strip surfaces; pad handled separately)
let padDot=null, padEl=null;
let padDown=false;        // module-level so a panel slide/mode switch can end an in-flight pad drag

function macroSlider(busKey, label){
  const m = MACROS[busKey];
  const row=document.createElement('div'); row.className='ctl';
  const lab=document.createElement('label'); lab.textContent=label ?? m.label;
  const inp=document.createElement('input'); inp.type='range'; inp.min=0; inp.max=1; inp.step=0.005;
  inp.value=bus.get(busKey);
  if(m.live || m.tween) inp.addEventListener('input', ()=>bus.set(busKey, parseFloat(inp.value)));   // a tween macro's slider is a TARGET: onFrame's tickTween eases to it
  else inp.addEventListener('change', ()=>bus.set(busKey, parseFloat(inp.value)));   // regrows the grove: on release only
  if(m.tween) inp.addEventListener('change', ()=>{ if(tweenOff){ bus.set(busKey, parseFloat(inp.value)); bus.tick(1e9); } });   // fallback look: one exact apply on release
  row.append(lab,inp);
  if(!macroEls[busKey]) macroEls[busKey]=[];
  macroEls[busKey].push(inp);
  return row;
}
function presetRow(withPlay){
  const row=document.createElement('div'); row.className='preset';
  const prev=document.createElement('button'); prev.textContent='‹';
  const next=document.createElement('button'); next.textContent='›';
  const name=document.createElement('span'); name.className='name';
  prev.addEventListener('click', ()=>stepPreset(-1));
  next.addEventListener('click', ()=>stepPreset(1));
  row.append(prev,next,name);   // both arrows together, title after — the buttons stay put however long the name runs
  if(withPlay) row.appendChild(playButton());
  presetNameEls.push(name);
  return row;
}
const presetNameEls=[];
function syncPlayPreset(){ if(presetSel) for(const el of presetNameEls) el.textContent = entryName(stateNow(), getStored(), activeList(), presetSel.value); }
// ▶/■ shows only while the active playlist carries dwell times (a cloud playlist); all looks has none. Playing
// (playlists.js makePlayer) holds each look for its dwell and then steps to the next, which fades in over its own
// crossfade; the dwell starts once that look has arrived (goTo), and the look play starts on has no fade in.
const playBtns=[];
const player=makePlayer({ timing:(value)=>timing(stateNow(), activeList(), value), advance:()=>stepPreset(1), onChange:()=>syncPlayButtons() });
const stopPlay=()=>player.stop();                  // an edit of the look is yours to hear out: play never fights it
function playButton(){
  const b=document.createElement('button'); b.className='playstop';
  b.addEventListener('click',()=>{ if(player.playing) player.stop(); else player.start(presetSel.value); });
  playBtns.push(b);
  return b;
}
function syncPlayButtons(){
  const on=plays(stateNow(), activeList()), p=player.playing;
  for(const b of playBtns){ b.hidden=!on; b.textContent=p?'■':'▶'; b.title=p?'stop':'play'; }
}
function syncMacroControls(){
  trySeat();
  for(const key in macroEls){
    const t = bus.get(key);
    const usable = macroUsable(key, params);
    for(const inp of macroEls[key]){
      inp.value = t;
      inp.disabled = !usable;                       // a gated macro greys out rather than trampling a hand-tuned look
      inp.parentElement.classList.toggle('off', !usable);
      inp.parentElement.title = usable ? '' : 'tuned for the floor looks — no honest effect on this one';
    }
  }
  if(padDot && padEl){
    const x=bus.get('wind_x'), y=bus.get('wind_y');
    padDot.style.left=`${x*100}%`; padDot.style.top=`${(1-y)*100}%`;
  }
}
// ---- try-out: dials that each write only their own parameter(s), starting from the
// look's own value ("home", captured whenever a look has loaded — a drag never re-captures it), so touching one at rest
// changes nothing. The thumbs are derived from the live params, so a mode switch re-seats them where they were left.
// A dial can be built into any surface (tryDial): the playful sidebar and the zen strip each hold their own instances.
const TRY_FALL = { anthocyanin: 0.4, tannin: 0.2, wall_fraction: 0.2, turn_exposure: 1, leaf_drop: 1 };   // inert at phenology <= 0.6: the left end stays the look's own picture
const TRY_KEYS = ['core_angular_radius_deg', 'core_weight_fraction', 'cloud_thickness', 'foliage_density', 'sun_azimuth_deg', 'sun_elevation_deg', 'phenology', ...Object.keys(TRY_FALL)];
let tryHome = null;
let tryAz = 0, tryTime = 0;   // the sun dial's offset (degrees) and the time dial's (hours) from home; both write the sun, so both live here (reset with home)
const tryDials = [];     // every instance: {name, inp, tick, row, seat(), home()}
function tryCapture(){
  tryHome = {}; for(const k of TRY_KEYS) tryHome[k] = params[k] ?? 0;
  tryAz = 0; tryTime = 0;
  trySeat();
}
function trySeat(){
  if(!tryHome) return;
  for(const d of tryDials){ d.inp.value = d.seat(); d.tick.style.left = `${d.home()*100}%`; }
  const usable = macroUsable('season', params);
  for(const d of tryDials) if(d.name === 'season'){ d.inp.disabled = !usable; d.row.classList.toggle('off', !usable); }
}
// THE SEASON DIAL answers like the other dials: a move applies at once. An input event fires several times a frame and each apply is a re-season (§4.5 "Re-seasoning"),
// so a frame takes one: a move the frame has already spent its apply on is held, and that frame's clock (trySeasonTick, from onFrame) lands the latest, so the picture is
// never more than a frame behind the finger. A step is as wide as the finger moved. It waits while a transition runs (a route owns the grove); the release lands exactly
// where the thumb is.
let trySeasonWant = null, trySeasonSpent = false;
function trySeasonCancel(){ trySeasonWant = null; trySeasonSpent = false; }
function trySeasonApply(v){
  const dict = { phenology:v };
  for(const k in TRY_FALL) if(!tryHome[k]) dict[k] = TRY_FALL[k];
  Object.assign(params, dict);
  for(const k in dict){ maybeClearSpecies(k); syncControl(k); }
  applyScope('season');
}
function trySeasonMove(v){
  if(trySeasonSpent || eng.trans.active){ trySeasonWant = v; return; }
  trySeasonWant = null; trySeasonSpent = true;
  trySeasonApply(v);
}
function trySeasonTick(force){                     // each frame, and the release (force)
  if(trySeasonWant !== null && !eng.trans.active){
    const v = trySeasonWant; trySeasonWant = null;
    trySeasonApply(v);
    trySeasonSpent = !force;                       // the frame's own landing spends the next frame's apply; a release spends nothing
    return;
  }
  trySeasonSpent = false;
}
function tryWrite(dict, scope){                    // the bus applier's own landing for one dict
  Object.assign(params, dict);
  for(const k in dict){ maybeClearSpecies(k); syncControl(k); }
  applyScope(scope);
}
// The time dial moves the sun along the editor's own clock model (updateSunFromTime's el(H), az(H)) from where the look's sun already is:
// the look's home sun fixes an hour angle H0 (afternoon when it sits west of south), d hours later H = H0 + 15°·d, and the sun moves by the
// model's change in elevation and azimuth between the two. d = 0 is the look's own sun exactly; time_of_day is never written.
function timeSunDelta(d){
  if(!d) return { el: tryHome.sun_elevation_deg, az: 0 };
  const lat = (params.latitude || 0) * DEG, cl = Math.cos(lat) || 1e-9;
  const el = (H) => Math.asin(clamp(cl * Math.cos(H), -1, 1)) / DEG;
  const az = (H) => 180 + Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(lat)) / DEG;
  const a0 = tryHome.sun_azimuth_deg, e0 = tryHome.sun_elevation_deg;
  const H0 = Math.acos(clamp(Math.sin(e0 * DEG) / cl, -1, 1)) * (a0 >= 180 ? 1 : -1), H = H0 + 15 * DEG * d;
  return { el: clamp(e0 + (el(H) - el(H0)), 15, 90), az: az(H) - az(H0) };
}
function trySunWrite(){                            // the one place the two sun dials land: home + sun-dial offset + the time dial's azimuth delta
  const t = timeSunDelta(tryTime);
  tryWrite({ sun_azimuth_deg:(((tryHome.sun_azimuth_deg + tryAz + t.az) % 360) + 360) % 360, sun_elevation_deg:t.el }, '');
}
const tryFrac = (v, lo, hi) => clamp((v - lo) / (hi - lo), 0, 1);
// Keep the look's own light at home; either side follows the focus recipe toward its crisp or soft end.
function tryFocusWrite(v){
  const home = macroValue('focus', tryHome), dict = macroParams('focus', v);
  if(Math.abs(v - home) <= TRY_SPECS.focus.step/2){
    for(const k in dict) dict[k] = tryHome[k];
  } else {
    const from = macroParams('focus', home).core_weight_fraction;
    const end = macroParams('focus', v < home ? 0 : 1).core_weight_fraction;
    dict.core_weight_fraction = tryHome.core_weight_fraction + (end - tryHome.core_weight_fraction)*(dict.core_weight_fraction - from)/(end - from);
  }
  tryWrite(dict, 'source');
}
const TRY_SPECS = {
  focus: { ends:['crisp','soft'], min:0, max:1, step:0.005,          // the focus macro itself (the sun's core and its share of the light), with a home and a way back
    seat:() => bus.get('focus'), home:() => macroValue('focus', tryHome),
    write:tryFocusWrite },
  cloudiness: { ends:['clear','overcast'], min:0, max:0.6, step:0.005,
    seat:() => clamp(params.cloud_thickness, 0, 0.6), home:() => tryFrac(tryHome.cloud_thickness, 0, 0.6),
    write:(v) => tryWrite({ cloud_thickness:v }, 'source') },
  density: { ends:['sparse','full'], min:0.6, max:1.4, step:0.01,
    seat:() => tryHome.foliage_density ? params.foliage_density / tryHome.foliage_density : 1, home:() => 0.5,
    write:(m) => tryWrite({ foliage_density:tryHome.foliage_density * m }, 'density') },
  sun: { ends:['←','→'], min:-90, max:90, step:1,
    seat:() => tryAz, home:() => 0.5,
    write:(d) => { tryAz = d; trySunWrite(); } },
  time: { ends:['earlier','later'], min:-2, max:2, step:0.05,
    seat:() => tryTime, home:() => 0.5,
    write:(d) => { tryTime = d; trySunWrite(); } },
  season: { ends:['green','fallen'], min:0.6, max:0.95, step:0.005,
    seat:() => clamp(params.phenology, 0.6, 0.95), home:() => tryFrac(tryHome.phenology, 0.6, 0.95),
    write:(v) => trySeasonMove(v),                   // at once, one a frame (trySeasonMove)
    commit:() => trySeasonTick(true) },              // on release, exactly where the thumb is
};
// One sentence while a dial moves, in the world's words, on the surface's caption line (tryCap); it goes quiet a moment after the hand does.
const TRY_SAYS = {
  focus: [[.33,'a small, sharp sun: every gap is a crisp image of it'],[.66,'the edges soften'],[2,'out of focus, like an old lens']],
  cloudiness: [[.2,'a bare sun: crisp dapples'],[.6,'thin cloud: the dapples soften'],[2,'overcast: the pattern melts into glow']],
  sun: [[.42,'the light comes from further one way'],[.58,'the sun where this place has it'],[2,'the light comes from further the other way']],
  time: [[.42,'earlier in the day'],[.58,'this place\'s own hour'],[2,'later in the day']],
  season: [[.15,'the last green days'],[.6,'the crown is turning'],[2,'the leaves let go']],
  density: [[.42,'fewer leaves, wider openings'],[.58,'as full as this place is'],[2,'a fuller canopy, smaller gaps']],
};
const TRY_WHY_OFF = 'this place is seen from below: its season is its own';
function tryCap(container){ const c=document.createElement('div'); c.className='cap'; container.appendChild(c); container._cap=c; }
function trySay(container, text){
  const c=container._cap; if(!c) return;
  c.textContent=text; c.classList.add('on');
  clearTimeout(c._t); c._t=setTimeout(()=>c.classList.remove('on'), 2600);
}
function tryDial(name, container){
  const d = { name, ...TRY_SPECS[name] };
  const row=document.createElement('div'); row.className='ctl try';
  const nm=document.createElement('span'); nm.className='name'; nm.textContent=name;
  const ends=document.createElement('div'); ends.className='ends';
  const l=document.createElement('span'), r=document.createElement('span'); l.textContent=d.ends[0]; r.textContent=d.ends[1];
  ends.append(l,r);
  const track=document.createElement('div'); track.className='track';
  const inp=document.createElement('input'); inp.type='range'; inp.min=d.min; inp.max=d.max; inp.step=d.step;
  const tick=document.createElement('div'); tick.className='tick';
  row.addEventListener('pointerdown',()=>{ if(row.classList.contains('off')) trySay(container, TRY_WHY_OFF); });   // a dial this look cannot use says why
  inp.addEventListener('input',()=>{ stopPlay(); chipSoon(); d.write(parseFloat(inp.value));
    const f=(parseFloat(inp.value)-d.min)/(d.max-d.min); trySay(container, TRY_SAYS[name].find(([t])=>f<=t)[1]);
    for(const o of tryDials) if(o !== d && o.name === name) o.inp.value = inp.value; });   // the same dial on the other surface follows
  if(d.commit) inp.addEventListener('change',()=>d.commit());
  track.append(inp,tick); row.append(nm,ends,track);
  Object.assign(d, { inp, tick, row }); tryDials.push(d); container.appendChild(row);
  return d;
}
function tryAsItWas(){                              // every dial's parameters back to the look's own values
  stopPlay(); chipSoon();
  trySeasonCancel();
  const moved = (ks) => ks.some((k) => params[k] !== tryHome[k]);
  const scopes = [moved(['cloud_thickness', 'core_angular_radius_deg', 'core_weight_fraction']) && 'source', moved(['foliage_density']) && 'density', moved(['phenology', ...Object.keys(TRY_FALL)]) && 'season'];
  Object.assign(params, tryHome);
  tryAz = 0; tryTime = 0;
  for(const k of TRY_KEYS){ maybeClearSpecies(k); syncControl(k); }
  for(const sc of scopes) if(sc) applyScope(sc);   // density before season: the reseason reads the regrown set
  trySeat();
}
// Touch: a finger on a slider clears the rest of its panel so the picture shows. The row under the finger stays; the panel's
// own backdrop goes too (CSS, .holding / .held). The strip's fade timer already waits out a hold (stripDragging).
function holdToSee(panel){
  if(!coarse) return;
  panel.addEventListener('pointerdown',(e)=>{
    const inp = e.target.closest?.('input[type=range]');
    if(!inp) return;
    panel.classList.add('holding'); inp.closest('.ctl')?.classList.add('held');
  });
  const release = ()=>{ panel.classList.remove('holding'); for(const r of panel.querySelectorAll('.held')) r.classList.remove('held'); };
  window.addEventListener('pointerup',release);
  window.addEventListener('pointercancel',release);
}
function modeButton(mode, label){
  const b=document.createElement('button'); b.textContent=label;
  b.addEventListener('click', ()=>setMode(mode));
  return b;
}
function buildPlayPanel(){
  const modes=document.createElement('div'); modes.className='modes';
  modes.append(modeButton('min','less'), modeButton('adv','everything'), settingsButton());
  play.appendChild(modes);
  play.appendChild(presetRow(true));

  tryCapture();
  for(const n of ['focus','cloudiness','sun','season','density','time']) tryDial(n, play);
  tryCap(play);
  const acts=document.createElement('div'); acts.className='ctl acts';
  const rb=document.createElement('button'); rb.className='tryreset'; rb.textContent='↺ as it was';
  rb.addEventListener('click',tryAsItWas);
  const db=document.createElement('button'); db.textContent='⚄ new leaves';
  db.addEventListener('click',reseed);
  acts.append(rb,db); play.appendChild(acts);

  // "more": the controls that are a second idea each, one tap further
  const more=document.createElement('details'); more.className='more';
  const sum=document.createElement('summary'); sum.textContent='more'; more.appendChild(sum);
  more.appendChild(macroSlider('haze'));
  more.appendChild(macroSlider('prism','sparkle'));
  more.appendChild(macroSlider('grove','trees'));
  padEl=document.createElement('div'); padEl.className='pad';
  padDot=document.createElement('div'); padDot.className='dot';
  const padlab=document.createElement('span'); padlab.className='padlab'; padlab.textContent='wind · calm ⌁ squally · still ↑ strong';
  padEl.append(padDot,padlab);
  const padWrite=(e)=>{
    const r=padEl.getBoundingClientRect();
    const x=clamp((e.clientX-r.left)/r.width,0,1), y=clamp(1-(e.clientY-r.top)/r.height,0,1);
    bus.set('wind_x',x); bus.set('wind_y',y);
    padDot.style.left=`${x*100}%`; padDot.style.top=`${(1-y)*100}%`;
  };
  padEl.addEventListener('pointerdown',(e)=>{ padDown=true; padWrite(e);
    try{ padEl.setPointerCapture(e.pointerId); }catch{ /* synthetic pointers (tests) have no active id — the write above already landed */ } });
  padEl.addEventListener('pointermove',(e)=>{ if(padDown) padWrite(e); });
  padEl.addEventListener('pointerup',()=>{ padDown=false; });
  padEl.addEventListener('pointercancel',()=>{ padDown=false; });
  more.appendChild(padEl);
  play.appendChild(more);

  // which list the stepper walks, directly above that list; shown where the advanced panel's is (a second list to swap to, or signed in)
  const plr=document.createElement('div'); plr.className='ctl select'; plr.hidden=true;
  const plsel=playlistSelect();
  playlistSelects.push({ sel:plsel, row:plr });
  plr.appendChild(plsel); play.appendChild(plr);

  // the full list, down here by the toggle that grows it — the stepper above flicks, this jumps
  // (◦ marks an experimental look)
  const pr=document.createElement('div'); pr.className='ctl select';
  const psel=document.createElement('select');
  psel.addEventListener('change',()=>loadEntry(psel.value));
  presetSelects.push(psel);
  pr.appendChild(psel); play.appendChild(pr);

  const beta=document.createElement('div'); beta.className='ctl toggle';
  const blab=document.createElement('label'); blab.textContent=`experimental looks (+${EXPERIMENTAL.length})`;   // says what it unlocks
  const binp=document.createElement('input'); binp.type='checkbox'; binp.checked=settings.showBeta;
  binp.addEventListener('change',()=>setShowBeta(binp.checked));
  beta.append(blab,binp); play.appendChild(beta);
  betaToggles.push(binp);
  refreshPresetSelect(presetSel.value);              // fill this surface's dropdown (it was born after the first refresh)
  holdToSee(play);
}
// one handler for every surface's experimental toggle, kept in step with each other
function setShowBeta(on){
  settings.showBeta=on; saveSettings();
  for(const t of betaToggles) t.checked=on;
  refreshPresetSelect(presetSel.value);
}
const betaToggles=[];

// the minimalist strip. Two visibility models by pointer kind:
//  • fine (desktop): PROXIMITY — the strip is there when the cursor is near its patch of screen and gone
//    when it isn't. No timers to outwait; walking the cursor away IS the dismissal. A short hold after it
//    first arrives (or the mode lands) keeps it from vanishing before you've seen where it lives, and an
//    in-flight slider drag pins it even if the pointer strays.
//  • coarse (touch): no cursor to be near — the tap-to-wake / fade-after-stillness clock stays.
const STRIP_NEAR_PX=110, STRIP_HOLD_MS=2500;
let stripFadeTimer=0, stripHoldUntil=0, stripDragging=false;
function stripWake(){
  if(settings.mode!=='min' || strip.classList.contains('hidden')) return;
  strip.classList.remove('faded');
  if(coarse){
    clearTimeout(stripFadeTimer);
    stripFadeTimer=setTimeout(()=>{ if(stripDragging) stripWake(); else strip.classList.add('faded'); }, 5000);   // a finger held on a slider keeps it
  } else stripHoldUntil=performance.now()+STRIP_HOLD_MS;
}
function buildStrip(){
  if(!coarse) strip.classList.add('wide');            // desktop: one horizontal bar
  const pr=presetRow();
  const more=document.createElement('button'); more.className='more'; more.textContent='＋';
  more.title='more';
  more.addEventListener('click',()=>setMode('play'));
  pr.appendChild(more);                               // rides the preset row's end, clear of the ‹ › stepper
  strip.appendChild(pr);
  if(coarse){
    // touch: ONE dial at a time, so the picture keeps the screen. A row of words along the bottom picks which dial is out;
    // ↺ is "as it was" and ＋ the playful sidebar. The preset row stays in the DOM (the name's source) but is not shown:
    // a swipe changes the look and its name passes across the top.
    strip.classList.add('one');
    tryCap(strip);
    const rows = {};
    for(const n of ['focus','cloudiness','sun','season','time']) rows[n] = tryDial(n, strip).row;
    const tabs=document.createElement('div'); tabs.className='tabs';
    const pick=(name)=>{ for(const n in rows) rows[n].classList.toggle('out', n!==name);
      for(const b of tabs.children) b.classList.toggle('on', b.dataset.dial===name); };
    for(const [n,label] of [['focus','focus'],['cloudiness','clouds'],['sun','sun'],['season','season'],['time','time']]){
      const b=document.createElement('button'); b.textContent=label; b.dataset.dial=n;
      b.addEventListener('click',()=>pick(n)); tabs.appendChild(b);
    }
    const back=document.createElement('button'); back.className='sm'; back.textContent='↺'; back.title='as it was';
    back.addEventListener('click',tryAsItWas);
    const up=document.createElement('button'); up.className='sm'; up.textContent='＋'; up.title='more';
    up.addEventListener('click',()=>setMode('play'));
    tabs.append(back,up); strip.appendChild(tabs);
    pick('focus');
  } else {
    tryDial('focus', strip);
    tryDial('cloudiness', strip);
    tryDial('time', strip);
  }
  trySeat();
  holdToSee(strip);
  strip.addEventListener('pointerdown',()=>{ stripDragging=true; stripWake(); });
  window.addEventListener('pointerup',()=>{ stripDragging=false; });
  strip.addEventListener('input',stripWake);
  canvas.addEventListener('pointerdown',(e)=>{ if(e.pointerType!=='touch') stripWake(); });   // a click on the art keeps the strip (mouse); a touch tap goes through toggleControls alone, or it would re-wake what the tap hides
  if(!coarse){
    let lastMove=performance.now(), lastPos=null;
    window.addEventListener('pointermove',(e)=>{
      lastMove=performance.now(); lastPos={ x:e.clientX, y:e.clientY };
      if(settings.mode!=='min' || strip.classList.contains('hidden')) return;
      if(stripDragging || lastMove<stripHoldUntil){ strip.classList.remove('faded'); return; }
      const r=strip.getBoundingClientRect();
      const near = e.clientX > r.left-STRIP_NEAR_PX && e.clientX < r.right+STRIP_NEAR_PX
                && e.clientY > r.top-STRIP_NEAR_PX && e.clientY < r.bottom+STRIP_NEAR_PX;
      strip.classList.toggle('faded', !near);
    });
    // a STILL cursor is also a dismissal: parked anywhere off the strip itself (even inside the proximity
    // margin) for a few seconds, the strip retires. Resting ON it keeps it — that is just hovering.
    setInterval(()=>{
      if(settings.mode!=='min' || strip.classList.contains('hidden') || stripDragging) return;
      const now=performance.now();
      if(now<stripHoldUntil || now-lastMove<4000) return;
      const r=strip.getBoundingClientRect();
      const onIt = lastPos && lastPos.x>=r.left && lastPos.x<=r.right && lastPos.y>=r.top && lastPos.y<=r.bottom;
      if(!onIt) strip.classList.add('faded');
    }, 1000);
  }
}

// ---- tooltips: lead with a plain "this does that", then build up to the why. Hover any knob or
// heading. Different people think differently, so each starts simple and goes deeper underneath. A parameter's is its `means` in
// PARAMS (komorebi-params.js); these are the rest: the areas, the groups, the buttons and the other controls. ----
const TIPS = {
  'Quality requests':'Optional look requests below the session ceiling. Use session removes the request. Layers remain part of the look.',
  // area headings (and the nested groups); the row tips follow
  'Sun':"<b>Where the sun is, and how sharp it is.</b> Its place in the sky (by clock or by angle) and the cloud that softens it: a small sun is crisp, a big hazy one melts every dapple.",
  'Colour & light':"<b>How the light is shown and what it is made of.</b> Brightness, contrast, the sky that fills the shadows, the colour a leaf passes, the ground the light lands on, and the projector's edge fade — the passes you set for a screen.",
  'Density':"<b>How full the grove is.</b> Foliage density, trees and leaves, and the size of the patch they grow in; the dice roll a new arrangement.",
  'Season':"<b>The year, from spring to leaf-off.</b> The phenology slider and everything it sets going: when leaves turn, how red and brown they go, when they let go, and the litter they leave on the floor.",
  'Leaves':"<b>What one leaf is.</b> Its outline, size, aspect, tilt at rest and how soft its edge is.",
  'Tree shape':"<b>The tree's own form.</b> Species, how the branches fork, fan and droop, the crown, the wood's shadow and the trunk; the faithful tree casts it as it really stands.",
  'Scene':"<b>Where you stand and what you look at.</b> The camera (zoom, tilt, orbit, pan, lens), looking up, the standing tree, and the glow and haze that come with a view.",
  'Wind':"<b>The breeze.</b> The coherent wind that moves the whole canopy together, with the springs it moves through and the faint leaf drift folded away beneath it.",
  'Lab':"<b>Curtain, tent and window experiments.</b> The receiver, the cloth it is made of, the window and the tent — kept apart from the floor looks.",
  'spring mechanics':"<b>How the branches feel in the wind — tuned once.</b> The gust envelope, spring stiffness / ceiling / damping / backlash, and the per-level limb &amp; twig flex. Per scene you really only change strength and direction above.",
  'leaf drift':"<b>The faint, fidgety wind from all sides at once.</b> Each leaf jiggles on its own, so gaps reshuffle — merging and splitting like light on the floor of a pool — instead of sliding. (A preview of the second kind of wind.)",
  'Tune':"<b>Performance vs. quality — set once for the machine, not the look.</b> Sample count, texture &amp; bake resolution, depth layers, the auto-60fps governor, and the adaptive-fps idle saver. Two opt-in optimizations live here (bake res, adaptive fps) that trade a little fidelity for speed.",
  'Debug':"<b>Tools for peeking under the hood.</b> These don't change the art.",
  'Presets':"<b>Saved looks.</b> Built-in ones are marked •, your own ★ (saved in this browser). Copy/paste JSON to share a look with someone. Step between them live with the <b>← →</b> arrow keys.",
  'fade':"<b>How long a scene change takes.</b> Stepping presets with ← → cross-dissolves over this many seconds: the look morphs while a soft cloud drifts over to hide the trees and branches regrowing behind it. 0 = instant cut.",
  reseed:"<b>Roll a new random tree layout.</b> Same kind of grove, freshly grown — a different arrangement of trees, branches and leaves.",
};
const tip = document.getElementById('tip');
function showTip(html, el){
  tip.innerHTML = html; tip.style.display = 'block';
  const r = el.getBoundingClientRect();
  tip.style.left = `${dev.getBoundingClientRect().right + 8}px`;
  tip.style.top  = `${Math.min(Math.max(8, r.top), window.innerHeight - tip.offsetHeight - 8)}px`;
}
dev.addEventListener('mouseover', e=>{ const el=e.target.closest('[data-tip-key]'); if(!el) return;
  const t=TIPS[el.dataset.tipKey] ?? PARAMS[el.dataset.tipKey]?.means; if(t) showTip(t, el); });   // a parameter's meaning is the registry's; the areas', the buttons' and the rest are TIPS'
dev.addEventListener('mouseout', e=>{ const el=e.target.closest('[data-tip-key]'), to=e.relatedTarget;
  if(el && (!to || !el.contains(to))) tip.style.display='none'; });
dev.addEventListener('scroll', ()=>{ tip.style.display='none'; });

// ---- time of day: an alternative to the raw sun angle. Works out the sun's elevation & azimuth for a
// SPRING day (equinox, so declination ≈ 0) at the chosen latitude, and writes them to the sun knobs. --
function updateSunFromTime(){
  stopPlay(); chipSoon();
  const lat=(params.latitude||0)*DEG, H=(params.time_of_day-12)*15*DEG;   // hour angle: 15°/hr, 0 at solar noon
  const el = Math.asin(clamp(Math.cos(lat)*Math.cos(H), -1, 1))/DEG;      // equinox: elevation = asin(cos lat · cos H)
  const az = (180 + Math.atan2(Math.sin(H), Math.cos(H)*Math.sin(lat))/DEG + 360) % 360;  // east → south → west
  params.sun_elevation_deg = clamp(el, 4, 90);                            // the engine floors elevation at 4°
  params.sun_azimuth_deg = az;
  syncControl('sun_elevation_deg'); syncControl('sun_azimuth_deg');       // colour + ellipse re-read next frame
}

// ---- presets UI: dropdown + save/delete + copy/paste JSON -------------------
// What the dropdown shows and the arrows walk is the ACTIVE PLAYLIST's entries (playlists.js): all looks —
// the built-ins, then the ★ looks, then (signed in) your arboretum presets with no ★ here yet, as ☁ rows only this
// dropdown lists — or a cached arboretum playlist. The EXPERIMENTAL looks are hidden unless the
// settings toggle shows them, but the one you're ON always stays listed (flipping the toggle mid-look must not
// strand you).
let presetSel, playlistSel, playlistRow, plusBtn, deleteBtn;
const playlistSelects=[];                          // every surface's playlist select and the row it hides with: the advanced panel's, the playful sidebar's
function playlistSelect(){
  const sel=document.createElement('select');
  sel.addEventListener('change',()=>{
    const v=sel.value;
    if(arb) arb.activate(v); else setActive(v);
  });
  return sel;
}
const presetRows={};                               // where arboretum.js puts its controls: the save row and the copy/paste row
let arb=null;                                      // arboretum.js's hooks, set at the end of the file; null only while the panel is being built
const BUILTINS = { PRESETS, EXPERIMENTAL };
const presetSelects=[];                            // every surface's preset dropdown; presetSel (the dev one) is the canonical value
// A playlist that has left the cache falls back to all looks.
const stateNow = () => arb ? arb.view() : getState();   // arboretum's view of the state: signed in, your folders and uncategorized join it
function activeList(){
  const a=settings.playlist;
  if(!arb) return a.startsWith('arb:') && getState().playlists[a.slice(4)] ? a : 'local';
  const choices=arb.lists(a);
  if(choices.some(l=>l.value===a)) return a;
  // a list that is not offered (a folder that is gone; all looks once you are signed in, where the look you are on is a built-in) falls back
  return arb.signedIn() ? (a==='local' ? 'builtins' : choices[0].value) : 'local';
}
const listEntries = (keep) => entries(stateNow(), getStored(), BUILTINS, settings.showBeta, activeList(), keep, !!arb?.signedIn());
const resolveEntry = (value) => resolve(stateNow(), getStored(), activeList(), value);
// The entry you were last on in the active playlist, else its first.
function resumeAt(){
  const was=settings.selected[activeList()];
  const list=listEntries(was);
  return list.some(e=>e.value===was) ? was : list[0]?.value;
}
// A visit opens where you left off: the look you were last on, in the list you were last in ("feel" fades into it from the
// welcome's own look). A look that is gone lands on the editor's default in all looks and the built-ins, and on a playlist's first.
function landing(){
  const was=settings.selected[activeList()];
  if(was!==undefined && listEntries(was).some(e=>e.value===was)) return was;
  return ['local','builtins'].includes(activeList()) ? DEFAULT_PRESET : resumeAt();
}
let listedState=null, listedActive=null;
function refreshPresetSelect(selected){
  const active=activeList(), state=stateNow();
  let keep=selected ?? presetSel.value;
  if(selected===undefined && listedState)
    keep=listedActive===active ? selectionAfter(listedState, state, active, keep, arb?.landings()) : '';
  const list=listEntries(keep);
  for(const sel of presetSelects){
    sel.innerHTML='';
    for(const e of list){ const o=document.createElement('option'); o.value=e.value; o.textContent=e.label; sel.appendChild(o); }
    sel.value=keep;                                             // every surface shows the same selection
  }
  listedState=state; listedActive=active;
  if(keep && settings.selected[activeList()]!==keep){ settings.selected[activeList()]=keep; saveSettings(); }
  syncPlayPreset();                                             // the stepper labels mirror the name
  syncPlaylistUI();
}
// the playlist select exists once there is a second playlist to swap to — or at once, with a `+` beside it, when arboretum is
// mounted and you are signed in; until then no row, and no ▶
function syncPlaylistUI(){
  applySession();
  if(playlistSel){
    const lists=arb ? arb.lists(settings.playlist) : playlists(getState());
    const signedIn=!!arb?.signedIn();
    for(const {sel,row} of playlistSelects){
      sel.innerHTML='';
      for(const l of lists){ const o=document.createElement('option'); o.value=l.value; o.textContent=l.label; sel.appendChild(o); }
      if(arb?.info().offline){ const o=document.createElement('option'); o.value='~offline'; o.textContent='offline'; o.disabled=true; sel.appendChild(o); }   // arboretum could not be reached: these lists are the copy kept here
      sel.value=activeList();
      row.hidden = !signedIn && lists.length<2;
    }
    plusBtn.hidden = !signedIn;
    renameBtn.hidden = !arb?.canRemove();
  }
  if(deleteBtn){
    const a=activeList(), cloud=a.startsWith('arb:');
    deleteBtn.textContent = cloud ? 'remove' : 'delete';   // in a folder of yours it takes the item out of the playlist
    deleteBtn.hidden = a==='builtins' || (cloud && !arb?.canRemove());   // nothing is removed from the built-ins, from uncategorized, or from someone else's playlist (design §3.5)
  }
  if(styleRow){
    const st=arb?.styleNow() ?? null;
    styleRow.hidden = st===null;
    for(const b of styleRow.querySelectorAll('button')) b.classList.toggle('on', b.dataset.style===st);
  }
  if(playlistPresentationRow){
    const list=stateNow().playlists[activeList().slice(4)];
    playlistPresentationRow.hidden=!arb?.canRemove();
    playlistPresentation.value=list?.presentation??'';
  }
  syncPlayButtons();
  arb?.changed();
  refreshChip();
  renderListPane();
}
// The chip under the look select: where this look lives, in a few words (playlists.js lookState). Live params stand aside while a
// transition carries them, so a look fading in is not "edited".
function refreshChip(){
  if(!lookChip) return;
  const i=arb?.info() ?? {};
  const c=lookState(stateNow(), getStored(), activeList(), presetSel.value, eng.trans.active ? null : eng.authored, i.me ?? null, i);
  lookChip.textContent=c.text; lookChip.title=c.title; lookChip.hidden=c.text==='';
}
// Select an entry and ease to it: the arrows, the swipe, and a playlist swap. A cloud entry brings its own crossfade.
// While playing, a look's dwell starts when it has arrived (onEnd), and nothing waits while it fades in; a step by hand
// is the same, so it restarts the dwell.
function goTo(value){
  applySession();
  const t=timing(stateNow(), activeList(), value);
  endTween();
  trySeasonCancel();
  player.leaving();
  eng.transitionTo(resolveEntry(value), { duration: t ? t.crossfade_s : transDur, style: t ? t.style : 'morph',
    onEnd:()=>{ endTween(); refreshPresetSelect(value); syncAllControls(); player.arrived(value); } });   // morph from the current live look to the target
  refreshPresetSelect(value);                                               // reflect target in the dropdown = next step's origin
}
function loadEntry(value){                          // the dropdown: an instant load
  const p=resolveEntry(value);
  if(p) applyParams(p);
  refreshPresetSelect(value);
  player.arrived(value);                            // an instant load has arrived at once
}
function setActive(list){
  if(list===activeList()) return;
  settings.playlist=list; saveSettings(); stopPlay();
  const value=resumeAt();
  if(value===undefined) refreshPresetSelect(''); else goTo(value);
}
// A ★ is written to all looks whatever playlist you were on; the list then shows it.
function saveStar(name, p){
  const from=activeList();
  arb.writeStar(name, p);                            // before the selection moves: it is where this ★ came from
  settings.playlist='local'; saveSettings();
  refreshPresetSelect(starValue(name));
  // the editor has moved to all looks, where the ★ is: say so, and why it is not in the playlist you were in
  const why = !from.startsWith('arb:') ? '' : arb.online() ? ' — sign in to arboretum to add looks to a playlist' : ' — playlists live in arboretum, where a look can be added to one';
  const here=(arb.lists('local')).find(l=>l.value==='local')?.label ?? 'all looks';   // "all looks" signed out, "on this browser" signed in
  note(`kept as ★ ${name} in this browser, in ${here}${why}`);
}
let noteTimer=0;
function note(text){
  if(!lookNote) return;
  clearTimeout(noteTimer);
  lookNote.textContent=text; lookNote.hidden=!text;
  if(text) noteTimer=setTimeout(()=>{ lookNote.hidden=true; }, 8000);
}
// Save is the one way to keep a look. Signed in to arboretum, every save goes to arboretum, private, and never asks where: into
// the folder you are in, else uncategorized (arboretum.js). Otherwise it is a ★ in this browser, whatever list you were on.
function saveLook(name, p){
  stopPlay();
  if(arb?.signedIn()){ arb.saveCloud(name, p); return; }   // signed in, every save goes to arboretum (private) and none is kept here
  saveStar(name, p);
}
// Save as new: always a new look, asked a name of its own. Signed in, a new preset placed after this item in a playlist of yours,
// else in uncategorized (arboretum.js); otherwise a new ★, which never quietly replaces one already here.
function promptSaveNew(){
  const n=(prompt('Save as a new look, named:', '')||'').trim(); if(!n) return;
  stopPlay();
  if(arb?.signedIn()){ arb.saveCloud(n, eng.captureLook(), { asNew:true }); return; }
  if(Object.hasOwn(getStored(), n) && !confirm(`A look named ${n} is already kept in this browser. Replace it?`)) return;
  saveStar(n, eng.captureLook());
}
// The save button and ⌘S / Ctrl+S: ask for a name, then keep the look.
function promptSave(){
  const here=entryName(stateNow(), getStored(), activeList(), presetSel.value);
  const fromBuiltin=['local','builtins'].includes(activeList()) && starName(getStored(), 'local', presetSel.value)===null;
  const n=(prompt('Save preset as:', fromBuiltin ? '' : here)||'').trim(); if(!n) return;   // a ★ or a cloud item offers its own name; a built-in's is not yours to reuse
  saveLook(n, eng.captureLook());
}
// Arboretum has filed a look in a list (or queued it there): go to that list, on that look, without loading it — it is already on screen.
function showCloud(list, match){
  settings.playlist=list; saveSettings(); stopPlay();
  const items=stateNow().playlists[list.slice(4)]?.items ?? [];
  const at=items.findIndex(i=>match.seq!==undefined ? i.seq===match.seq : i.preset_id===match.id);
  refreshPresetSelect(at<0 ? '' : String(at));      // the look has left this list (it joined a folder): nothing selected
}
function mkBtn(label,fn){ const b=document.createElement('button'); b.textContent=label; b.addEventListener('click',fn); return b; }
let devBeta=null, styleRow=null, playlistPresentationRow=null, playlistPresentation=null, wsButton=null, renameBtn=null, looks=null, looksHome=null, lookNote=null;
function buildPresetUI(){
  const modes=document.createElement('div'); modes.className='ctl modes';
  const back=document.createElement('button'); back.textContent='less';
  back.addEventListener('click',()=>setMode('play'));
  modes.append(back,settingsButton());
  if(!coarse){ wsButton=mkBtn('workspace',()=>setWorkspace(!settings.workspace)); modes.append(wsButton); }   // the workspace is a desktop's: a phone has no room beside the picture
  dev.appendChild(modes);
  // THE LOOKS: every look and playlist control, in one box, which the workspace's playlist pane takes while it is up (setWsPane) so
  // that none is left below and none is a copy; it comes back here, to its own place, when the pane goes.
  looks=document.createElement('div'); looks.className='looks';
  looksHome=document.createComment('looks');
  dev.append(looks, looksHome);
  // THE LOOK, as the panel's heading: ‹ name ›. The name is the dropdown: the select lies over it, transparent, so a click on the
  // name opens the full list (and the select stays the first one in #dev, the single source of the stepping origin).
  const head=document.createElement('div'); head.className='lookhead'; head.dataset.tipKey='Presets';
  const prev=mkBtn('‹',()=>stepPreset(-1)), next=mkBtn('›',()=>stepPreset(1));
  const pick=document.createElement('div'); pick.className='pick';
  const name=document.createElement('span'); name.className='name'; presetNameEls.push(name);
  presetSel=document.createElement('select');
  presetSel.addEventListener('change',()=>loadEntry(presetSel.value));
  presetSelects.push(presetSel);
  pick.append(name,presetSel); head.append(prev,pick,next); looks.appendChild(head);
  lookChip=document.createElement('div'); lookChip.className='look-chip';   // directly under the look's name, in every editor
  looks.appendChild(lookChip);
  lookNote=document.createElement('div'); lookNote.className='look-note'; lookNote.hidden=true;   // the editor's own word on where a save went, when arboretum's status line is not there to say it
  looks.appendChild(lookNote);

  // one main action; the rare ones (delete, the JSON pair) fold behind ···
  const r2=document.createElement('div'); r2.className='ctl lookacts';
  deleteBtn=mkBtn('delete',()=>{
    if(activeList().startsWith('arb:')){ arb?.remove(); return; }     // taking a look out of an arboretum playlist is written to arboretum
    const n=starName(getStored(), 'local', presetSel.value);
    if(n===null){ alert("Built-in presets can't be deleted."); return; }
    arb.deleteStar(n); goTo(DEFAULT_PRESET); });   // on to the default look, so what is shown is what is selected
  const r3=document.createElement('div'); r3.className='ctl'; r3.hidden=true;
  const rare=mkBtn('···',()=>{ r3.hidden=!r3.hidden; }); rare.title='delete, copy JSON, paste JSON';
  const save=mkBtn('save',promptSave); save.className='main';
  save.title='keep the look: a new version of it when it is yours, else a new look (⌘S)';
  const saveNew=mkBtn('save as new',promptSaveNew); saveNew.title='keep it as a new look, beside this one when this is a playlist of yours';
  r2.append(save, saveNew, playButton(), rare);
  looks.appendChild(r2);
  presetRows.save=r2;
  r3.append(
    deleteBtn,
    mkBtn('copy JSON',()=>{ const txt=JSON.stringify(eng.captureLook(),null,2);
      if(navigator.clipboard?.writeText) navigator.clipboard.writeText(txt).catch(()=>prompt('Copy JSON:',txt));
      else prompt('Copy JSON:',txt); }),
    mkBtn('paste JSON',()=>{ const txt=prompt('Paste preset JSON:'); if(!txt) return;
      try{ const o=JSON.parse(txt); stopPlay(); applyParams(o.params||o); refreshPresetSelect(); }catch(_e){ alert('Invalid JSON'); } }));
  looks.appendChild(r3);
  presetRows.tools=r3;

  // the playlist row comes after the look select in the DOM: the first select in #dev stays the look's
  playlistRow=document.createElement('div'); playlistRow.className='ctl select playlist-row'; playlistRow.hidden=true;
  playlistSel=playlistSelect();
  playlistSelects.push({ sel:playlistSel, row:playlistRow });
  plusBtn=mkBtn('+',()=>arb?.create()); plusBtn.title='new playlist'; plusBtn.hidden=true;   // signed in to arboretum only
  renameBtn=mkBtn('✎',()=>arb?.rename()); renameBtn.title='rename this playlist'; renameBtn.hidden=true;   // a playlist of yours only
  playlistRow.append(playlistSel, renameBtn, plusBtn); looks.appendChild(playlistRow);
  playlistPresentationRow=document.createElement('div');playlistPresentationRow.className='ctl select presentation-row';
  const presentationLabel=document.createElement('label');presentationLabel.textContent='playlist display';
  playlistPresentation=document.createElement('select');
  for(const [value,label] of [['','no preference'],['screen','screen / TV'],['projector','projector']]){
    const option=document.createElement('option');option.value=value;option.textContent=label;playlistPresentation.append(option);
  }
  playlistPresentation.onchange=async()=>{ await arb?.setPresentation(playlistPresentation.value || null); syncPlaylistUI(); };   // a refused save shows the stored value again
  playlistPresentationRow.append(presentationLabel,playlistPresentation);looks.append(playlistPresentationRow);
  // how the playlist item you are on arrives: morph (the automatic route) or fade. The playlist item's, so it shows only on an item of a playlist of yours.
  styleRow=document.createElement('div'); styleRow.className='ctl stylerow'; styleRow.hidden=true;
  const slab=document.createElement('label'); slab.textContent='arrives by';
  styleRow.appendChild(slab);
  for(const st of ['morph','fade']){ const b=mkBtn(st,()=>{ if(arb?.styleNow()!==st) arb?.setStyle(st); }); b.dataset.style=st; styleRow.appendChild(b); }
  looks.appendChild(styleRow);

  // the experimental toggle is built here and laid at the very bottom of the panel, under the transition row (where that row is built)
  devBeta=document.createElement('div'); devBeta.className='ctl toggle devbeta';
  const blab=document.createElement('label'); blab.textContent=`show experimental looks (+${EXPERIMENTAL.length})`;
  const binp=document.createElement('input'); binp.type='checkbox'; binp.checked=settings.showBeta;
  binp.addEventListener('change',()=>setShowBeta(binp.checked));
  devBeta.append(blab,binp); betaToggles.push(binp);
  refreshPresetSelect(landing());
}

// ---- dev panel reveal / dismiss ---------------------------
// On desktop the panel slides in after "feel" and D toggles it. On TOUCH there's no keyboard, so it
// arrives hidden (the art stands alone) and a tap on the canvas toggles it (the zen strip fades and wakes instead,
// as with D). The slide uses the #dev.offscreen transform transition.
const coarse = !!(window.matchMedia && matchMedia('(pointer: coarse)').matches);   // touch / phone
holdToSee(dev);                                    // the advanced panel clears for a held slider too
const hint = document.getElementById('hint');
// the mode ladder's three surfaces; everything below drives whichever one the mode says is active
const MODE_ELS = { adv: dev, play, min: strip };
function panelEl(){ return MODE_ELS[settings.mode] || play; }
let panelTimer=0;
function slideInPanel(){
  if(document.body.classList.contains('intro')) return;   // the welcome owns the screen — no surface (D key included) until "feel"
  const el = panelEl();
  if(!el.classList.contains('hidden')) return;    // first reveal only (idempotent vs. the welcome fallback timer)
  clearTimeout(panelTimer);
  el.classList.add('offscreen');                  // park it off its edge (left for the sidebars, below for the strip)...
  el.classList.remove('hidden');                  // ...reveal it there...
  void el.offsetWidth;                             // ...reflow so the next change animates...
  el.classList.remove('offscreen');               // ...and slide it in
  if(el===strip) stripWake();                     // the strip starts its fade clock the moment it arrives
  if(el===dev) arb?.advanced();                   // arboretum first asks who is signed in when the advanced panel is first shown
}
// the key hints stay HIDDEN unless summoned — the canvas is the point, not the legend. H (mapped to
// nothing else) shows them for ten seconds.
// With a `text` it says that for the same ten seconds (the welcome has nowhere else to put a reason); after, or on the next plain
// showHint, the key hints are back.
let hintTimer=0, keyHints=null;
function showHint(text){
  hint.classList.remove('gone');
  clearTimeout(hintTimer);
  if(text===undefined && keyHints!==null){ hint.innerHTML=keyHints; keyHints=null; }
  if(text!==undefined){ keyHints??=hint.innerHTML; hint.textContent=text; }
  hintTimer=setTimeout(()=>{ hint.classList.add('gone'); if(keyHints!==null){ hint.innerHTML=keyHints; keyHints=null; } }, 10000);
}
function slideOutPanel(){
  const el = panelEl();
  if(el.classList.contains('hidden')) return;
  padDown=false;                                                    // a wind-pad drag must not keep writing off a sliding panel's rect
  el.classList.add('offscreen');                                    // slide it out...
  panelTimer=setTimeout(()=>{ el.classList.add('hidden'); }, 600);  // ...then drop it once the .6s slide ends
}
function togglePanel(){ panelEl().classList.contains('hidden') ? slideInPanel() : slideOutPanel(); }
// D and a touch tap: in zen the strip lives by proximity, so toggling speaks that language: show = wake (as if hovered, with
// the same short hold), hide = fade. Toggling `hidden` there would gate out the proximity/tap machinery (stripWake ignores
// a hidden strip) and leave the strip unreachable by pointer.
function toggleControls(){
  if(settings.mode==='min' && !strip.classList.contains('hidden')){
    if(strip.classList.contains('faded')) stripWake(); else strip.classList.add('faded');
  } else togglePanel();
}
// step the ladder: hide whatever is up, swap the mode, slide the new surface in
function setMode(mode){
  if(!(mode in MODE_ELS) || mode === settings.mode) return;
  if(settings.workspace) setWorkspace(false);       // the workspace is the advanced surface's: another rung leaves it
  padDown=false;                                   // a drag can't outlive the surface it started on
  const from = panelEl();
  clearTimeout(panelTimer);
  from.classList.add('hidden'); from.classList.remove('offscreen');
  settings.mode = mode; saveSettings();
  syncMacroControls(); syncPlayPreset();
  slideInPanel();
}

// THE WORKSPACE (W, or the panel's button; desktop only): the picture becomes a viewer with nothing over it, the tree pane
// (tree-pane.js) stands beside it, and the advanced panel docks in the band below, opening its Tree shape area. The layout is index.html's (body.workspace); the engine sizes its backing store from the canvas's box every frame,
// so a smaller box is all the viewer needs. Leaving puts everything back. It sticks across reloads like the mode.
let treePane=null;
// the workspace's counter: the frame rate and the resolution auto-quality is drawing at, always, quietly, four times a second
const wsStat=document.getElementById('wsStat');
let wsStatAt=0;
function wsStatTick(){
  const now=performance.now(); if(now-wsStatAt<250) return; wsStatAt=now;
  wsStat.textContent=`${eng.fps>0 ? eng.fps.toFixed(0) : '–'} fps · res ${perf.resScale.toFixed(2)}×`;
}
const paneOf = () => (treePane ??= makeTreePane(params, { hier: () => eng.grove().hier, leaves: () => eng.treeLeaves() }));
// The right-hand pane is the tree or the active list (playlist-pane.js), one tab each over its top; which one sticks across reloads.
// While the list pane is up it holds the panel's look and playlist controls (the `looks` box, moved, not copied) over the list as
// the dropdown has it; on a playlist of yours its rows write through arboretum.js.
const wsTabs=document.getElementById('wsTabs'), plistEl=document.getElementById('plist');
let listPane=null;
const listPaneOf = () => (listPane ??= makePlaylistPane(plistEl, {
  go: (value) => { if(value!==presetSel.value) goTo(value); },
  move: (at, to) => arb.move(at, to),
  times: (at, t) => arb.setTimes(at, t),
  style: (at, st) => arb.setStyle(st, at),
  remove: (at) => arb.remove(at),
  add: (pick) => arb.add(pick),
}));
function listModel(){
  const a=activeList(), cloud=a.startsWith('arb:') ? stateNow().playlists[a.slice(4)] : null, editable=!!arb?.canRemove();
  return {
    editable, current: presetSel.value, addable: editable ? arb.addable() : [],
    rows: listEntries(presetSel.value).map(e=>{
      const it=cloud?.items[Number(e.value)];
      if(!it) return { value:e.value, label:e.label };
      if(it.pending) return { value:e.value, label:e.label, pending:true };
      return { value:e.value, label:e.label, dwell_s:it.dwell_s, crossfade_s:it.crossfade_s, style:styleOf(it) };
    }),
  };
}
function renderListPane(){ if(settings.workspace && settings.wsPane==='playlist' && presetSel) listPaneOf().render(listModel()); }
function setWsPane(which){
  settings.wsPane=which; saveSettings();
  const list=which==='playlist';
  document.body.classList.toggle('ws-playlist', list);
  for(const b of wsTabs.children) b.classList.toggle('on', b.dataset.pane===which);
  const tree=settings.workspace && !list;
  if(tree || treePane) paneOf().show(tree);
  if(looks){
    if(settings.workspace && list) listPaneOf().slot.append(looks);
    else if(looks.parentElement!==dev) looksHome.before(looks);
  }
  renderListPane();
}
for(const [which,label] of [['tree','tree'],['playlist','playlist']]){
  const b=mkBtn(label,()=>setWsPane(which)); b.dataset.pane=which; wsTabs.appendChild(b);
}
function setWorkspace(on){
  if(coarse || document.body.classList.contains('intro')) return;
  if(on && settings.mode!=='adv') setMode('adv');
  settings.workspace=on; saveSettings();
  document.body.classList.toggle('workspace', on);
  if(on){
    if(dev.classList.contains('hidden')) slideInPanel();
    const shape=[...dev.querySelectorAll('summary.sec')].find(h=>h.textContent==='Tree shape')?.parentElement;   // an area is a <details> under its summary.sec heading
    if(shape) shape.open=true;
  }
  setWsPane(settings.wsPane==='playlist' ? 'playlist' : 'tree');   // the pane it was left on; shows the tree pane, or not, with it
  if(wsButton) wsButton.textContent = on ? 'leave workspace' : 'workspace';
}

// Canvas pointer input. A MOUSE drags the sun (azimuth from x, elevation from y). A finger can't do that
// and swipe, so TOUCH is swipe-nav instead: a swipe on either axis steps presets on release (up/left = next,
// down/right = previous, like ↑/↓ ← →) and a clean tap toggles the controls (the D key's own toggle). Axis locks
// once the gesture clears a deadzone. TWO fingers move the camera, and their first movement decides how. Side by side
// and sliding up or down together, they tilt it (up = more side-on, like a mouse drag), the way a map tilts. Anything
// else moves it the way a map moves: pinch zooms, twist orbits, and dragging both pans, with the floor point under the
// fingers held under them. A second finger cancels the swipe, and nothing that touch ends steps the look or toggles
// the controls until every finger is off.
const SWIPE_DEAD=12, SWIPE_STEP=45;                            // px: ignore taps; min throw on the locked axis to count as a preset step
let dragging=false, px=0, py=0;
let swipe=null;                                                // touch gesture in progress: {sx, sy, axis:null|'x'|'y'}
const touches=new Map();                                       // fingers on the picture: pointerId -> {x, y}
let pinch=null;                                                // two fingers down: their last frame (pinchFrame) and the gesture's mode
let multi=false;                                               // a second finger joined this touch; cleared when the last one lifts
function pinchFrame(){
  const [p,q]=touches.values();
  return { p, q, x:(p.x+q.x)/2, y:(p.y+q.y)/2, d:Math.max(1,Math.hypot(q.x-p.x,q.y-p.y)), a:Math.atan2(q.y-p.y,q.x-p.x), mode:null };
}
// 'tilt' when both fingers, side by side, slid the same way up or down; 'map' otherwise; null until it can tell. Each
// finger reports its own move, so one that has barely moved may only be behind: the call waits for it, and gives up on
// it (a twist or pinch about a still finger) once the other is three deadzones out.
function pinchMode(f){
  const dp=[f.p.x-pinch.p.x, f.p.y-pinch.p.y], dq=[f.q.x-pinch.q.x, f.q.y-pinch.q.y];
  const lp=Math.hypot(dp[0],dp[1]), lq=Math.hypot(dq[0],dq[1]), big=Math.max(lp,lq);
  if(big < SWIPE_DEAD) return null;
  if(Math.min(lp,lq) < SWIPE_DEAD/2) return big < 3*SWIPE_DEAD ? null : 'map';
  const upright=(d)=>Math.abs(d[1]) > 2*Math.abs(d[0]);
  const sideBySide=Math.abs(Math.cos(pinch.a)) > Math.SQRT1_2;   // the line between the fingers is nearer level than upright
  return sideBySide && upright(dp) && upright(dq) && dp[1]*dq[1] > 0 ? 'tilt' : 'map';
}
// The camera follows the fingers. The floor point under their old midpoint is found through the floor shader's own
// map (world = R(yaw)·screen·extent/height + view_center), zoom and orbit change, and the pan is solved to put that
// point under the new midpoint. Exact top-down (pitch 0); with a tilt the pan is the top-down one, near enough.
function pinchMove(){
  const f=pinchFrame();
  f.mode = pinch.mode ?? pinchMode(f);
  if(!f.mode) return;                                          // undecided: the frame stays where the gesture began
  if(f.mode==='tilt'){
    params.view_pitch_deg = clamp(params.view_pitch_deg + (pinch.y-f.y)*0.3, 0, 80);   // the mouse drag's rate and range
    pinch=f; stopPlay(); chipSoon(); syncControl('view_pitch_deg');
    return;
  }
  const r=canvas.getBoundingClientRect(), H=Math.max(1,r.height), mx=r.left+r.width/2, my=r.top+r.height/2;
  const ground=(x,y)=>{ const k=params.view_extent_m/H, sx=(x-mx)*k, sy=(my-y)*k, a=params.view_yaw_deg*Math.PI/180, c=Math.cos(a), s=Math.sin(a);
    return [c*sx+s*sy, -s*sx+c*sy]; };
  const w=ground(pinch.x,pinch.y), wx=w[0]+params.view_center_x, wy=w[1]+params.view_center_y;
  const turn=Math.atan2(Math.sin(f.a-pinch.a),Math.cos(f.a-pinch.a));   // clockwise on screen is positive (y points down)
  params.view_extent_m = clamp(params.view_extent_m*pinch.d/f.d, 0.5, 40);
  params.view_yaw_deg = ((params.view_yaw_deg - turn*180/Math.PI + 180)%360+360)%360 - 180;   // the floor turns with the fingers
  const v=ground(f.x,f.y);
  params.view_center_x = clamp(wx-v[0], -25, 25);              // the pan slider's range, so its thumb stays in sync
  params.view_center_y = clamp(wy-v[1], -25, 25);
  pinch=f;
  stopPlay(); chipSoon();
  for(const key of ['view_extent_m','view_yaw_deg','view_center_x','view_center_y']) syncControl(key);
}
// Safari's own pinch would zoom the page: the picture takes the gesture whole
canvas.addEventListener('gesturestart',e=>e.preventDefault());
canvas.addEventListener('pointerdown',e=>{
  // tap the tree preview to PIN it big (tap again to unpin); otherwise begin a gesture
  if(showTree){ const r=canvas.getBoundingClientRect();
    if(eng.treeInsetHit({ x:(e.clientX-r.left)/r.width, y:(e.clientY-r.top)/r.height })){ treePinned=!treePinned; return; } }
  if(e.pointerType==='touch'){
    touches.set(e.pointerId,{ x:e.clientX, y:e.clientY });
    if(touches.size===1){ swipe={ sx:e.clientX, sy:e.clientY, axis:null }; multi=false; }
    else { swipe=null; multi=true; pinch=pinchFrame(); }
  }
  else dragging=true;
  px=e.clientX; py=e.clientY;
  try{ canvas.setPointerCapture(e.pointerId); }catch{ /* synthetic pointers (tests) have no active id — the gesture state above is already set */ } });
// a finger off: with two still down the pinch goes on from them, with one left it rests until that one lifts too
function liftFinger(id){
  touches.delete(id);
  pinch = touches.size>=2 ? pinchFrame() : null;
  if(!touches.size) multi=false;
}
canvas.addEventListener('pointerup',e=>{
  if(multi){ liftFinger(e.pointerId); return; }
  touches.delete(e.pointerId);
  if(swipe){
    if(swipe.axis){ const d = swipe.axis==='x' ? e.clientX-swipe.sx : e.clientY-swipe.sy;
      if(Math.abs(d)>SWIPE_STEP){ stepPreset(d<0 ? 1 : -1); showLookName(); } }   // up/left = next, down/right = previous
    else toggleControls();                                     // a clean tap
    swipe=null;
  }
  dragging=false; });
canvas.addEventListener('pointercancel',e=>{ liftFinger(e.pointerId); swipe=null; dragging=false; });
canvas.addEventListener('pointermove',e=>{
  if(touches.has(e.pointerId)){
    touches.set(e.pointerId,{ x:e.clientX, y:e.clientY });
    if(pinch){ pinchMove(); return; }
    if(multi) return;                                          // the one finger left of a pinch moves nothing
  }
  if(swipe){
    if(!swipe.axis){ const dx=e.clientX-swipe.sx, dy=e.clientY-swipe.sy;
      if(Math.hypot(dx,dy)>=SWIPE_DEAD) swipe.axis = Math.abs(dx)>Math.abs(dy) ? 'x' : 'y'; }
    return;                                                    // the step is committed on release
  }
  if(!dragging) return;
  stopPlay(); chipSoon();
  if(dragSun){                                                   // novelty mode: drag positions the sun (as before)
    params.sun_azimuth_deg = (params.sun_azimuth_deg + (e.clientX-px)*0.3 + 360)%360;
    params.sun_elevation_deg = clamp(params.sun_elevation_deg - (e.clientY-py)*0.3, 4, 90);
    syncControl('sun_azimuth_deg'); syncControl('sun_elevation_deg');
  } else if(e.shiftKey){                                         // SHIFT-drag = pan (walk the view across the floor)
    const k = params.view_extent_m / Math.max(1, canvas.clientHeight);
    params.view_center_x -= (e.clientX-px)*k;
    params.view_center_y += (e.clientY-py)*k;
    syncControl('view_center_x'); syncControl('view_center_y');
  } else {                                                       // default: orbit the camera — drag ↔ to spin, ↕ to tilt
    params.view_yaw_deg = ((params.view_yaw_deg + (e.clientX-px)*0.3 + 180)%360+360)%360 - 180;   // wrap to [-180,180]
    params.view_pitch_deg = clamp(params.view_pitch_deg + (py-e.clientY)*0.3, 0, 80);             // drag up = more side-on
    syncControl('view_yaw_deg'); syncControl('view_pitch_deg');
  }
  px=e.clientX; py=e.clientY;
});
// mouse wheel = zoom the camera (view extent), in both drag modes; preventDefault so the page doesn't scroll
canvas.addEventListener('wheel', e=>{
  e.preventDefault();
  stopPlay(); chipSoon();
  params.view_extent_m = clamp(params.view_extent_m * Math.exp(e.deltaY*0.0015), 0.5, 40);
  syncControl('view_extent_m');
}, { passive:false });
// browser fullscreen, on and off (webkit fallback for Safari): F, and a double-click on the picture. On touch a tap is the
// controls' toggle, so there the double-click (which a double-tap also fires) is left alone.
function toggleFullscreen(){
  const el=document.documentElement, fsEl=document.fullscreenElement||document.webkitFullscreenElement;
  if(fsEl){ (document.exitFullscreen||document.webkitExitFullscreen).call(document); }
  else { const p=(el.requestFullscreen||el.webkitRequestFullscreen).call(el); if(p?.catch) p.catch(()=>{}); }
}
canvas.addEventListener('dblclick', ()=>{ if(!coarse && !document.body.classList.contains('intro')) toggleFullscreen(); });
// a pointer resting on the picture hides after a few seconds (#gl.still) and comes back the moment it moves; over a panel it never hides
const STILL_MS = 3000;
let stillTimer = 0;
function pointerMoved(){ canvas.classList.remove('still'); clearTimeout(stillTimer); stillTimer = setTimeout(() => canvas.classList.add('still'), STILL_MS); }
canvas.addEventListener('pointermove', pointerMoved);
canvas.addEventListener('pointerdown', pointerMoved);
canvas.addEventListener('pointerleave', () => { clearTimeout(stillTimer); canvas.classList.remove('still'); });
// on a touch device the keyboard / drag hints don't apply — the legend is the two gestures (shown once, on the first arrival: arrive())
if(coarse)
  hint.innerHTML = 'swipe · another place &nbsp;·&nbsp; tap · the light';
// the name of the look a swipe landed on passes across the top (touch has no preset row in sight)
const lookNameEl = document.getElementById('lookName');
let lookNameTimer=0;
function showLookName(){
  if(!coarse || !lookNameEl) return;
  lookNameEl.textContent = entryName(stateNow(), getStored(), activeList(), presetSel.value);
  lookNameEl.classList.add('show');
  clearTimeout(lookNameTimer); lookNameTimer=setTimeout(()=>lookNameEl.classList.remove('show'), 2500);
}
// ---- arrow-key scene stepping: prev/next preset with a cloud-bloom transition (spec §9). The dropdown
// selection (presetSel.value) is the single source of truth for the stepping origin — save/delete/paste/
// change all keep it current — so the arrows always step from the look the dropdown shows. ----
function stepPreset(dir){
  const value=step(listEntries(presetSel.value), presetSel.value, dir);   // wraps at the ends
  if(value!==undefined) goTo(value);
}

// T = toggle the 3D tree-grove preview inset (independent of the dev panel)
let showTree=false;
// L = toggle the held-leaf inset (leaf-preview.js); [ / ] step to the next leaf while it is up. Built on the first L and never before.
let showLeaf=false, leaf=null;
window.addEventListener('keydown',e=>{
  const k=e.key;
  if(k==='d'||k==='D'){
    if(settings.workspace){ showHint('the panel is docked in the workspace: W leaves it'); return; }
    toggleControls();
    return;
  }
  if((k==='w'||k==='W') && !e.metaKey && !e.ctrlKey){ setWorkspace(!settings.workspace); return; }
  if((e.metaKey||e.ctrlKey) && (k==='s'||k==='S')){                         // ⌘S / Ctrl+S: save, not the browser's save-page
    e.preventDefault();
    if(!document.body.classList.contains('intro')) promptSave();
    return;
  }
  if(k==='r'||k==='R'){ reseed(); return; }
  if(k==='t'||k==='T'){ showTree=!showTree; document.getElementById('hint').style.display = showTree?'none':''; return; }
  if(k==='l'||k==='L'){ showLeaf=!showLeaf; leaf??=makeLeafPreview(params, () => eng.grove().hier); leaf.show(showLeaf); return; }
  if(showLeaf && (k==='['||k===']')){ leaf.step(k===']'?1:-1); return; }
  if(k==='f'||k==='F'){ toggleFullscreen(); return; }
  if(k==='m'||k==='M'){ midi?.toggle(); return; }
  if(k==='ArrowLeft'||k==='ArrowRight'||k==='ArrowUp'||k==='ArrowDown'){
    const tag=(document.activeElement?.tagName)||'';
    if(tag==='INPUT'||tag==='SELECT') return;                               // let a focused panel control use the arrows
    e.preventDefault();
    stepPreset((k==='ArrowRight'||k==='ArrowDown') ? 1 : -1);
    return;
  }
  // any OTHER bare key — H included, but also whatever someone tries when lost — surfaces the key hints
  if(k.length===1 && !e.metaKey && !e.ctrlKey && !e.altKey){
    const tag=(document.activeElement?.tagName)||'';
    if(tag!=='INPUT' && tag!=='SELECT') showHint();
  }
});
// track the pointer (normalised canvas coords) so the tree preview can grow when hovered
let treePointer=null, treePinned=false;
window.addEventListener('pointermove',e=>{ const r=canvas.getBoundingClientRect();
  treePointer={ x:(e.clientX-r.left)/r.width, y:(e.clientY-r.top)/r.height }; });
document.addEventListener('mouseleave',()=>{ treePointer=null; });

// ---- per-frame overlays: reflect the engine's drift phase, draw the source
// inset (when the panel is open), and update the HUD. ------------------------
eng.onFrame = ()=> {
  sessionPanel.refresh();
  tickTween(); trySeasonTick(); midi?.frame();
  if(params.drift_auto) syncControl('drift_phase');
  refreshGates();               // a transition, a macro or a preset can flip a mode as readily as the row itself; the signature check makes the miss cheap
  const devUp = !dev.classList.contains('hidden') && !dev.classList.contains('offscreen');   // a sliding-out panel counts as gone
  if(params.show_source && devUp && !settings.workspace) eng.drawSourceInset();   // the sun's inset is the floating panel's, not the workspace's
  if(showTree) eng.drawTreeInset(treePointer, treePinned);
  if(showLeaf) leaf.draw();
  if(settings.workspace){ treePane?.draw(); wsStatTick(); }
  // HUD: debug info, shown only while the dev panel is open.
  const devOpen = devUp;
  hud.style.display = (devOpen && !settings.workspace) ? '' : 'none';   // the workspace has its own quiet counter instead
  if(!devOpen) return;
  const m=eng.motion;
  // perf is a WARNING line, absent when nominal: fps only once it slips below 60 (<55), and AUTO res only
  // while it's compensating below full — so you always know when auto-quality is buying speed with resolution.
  const lowFps = eng.fps>0 && eng.fps<55, downRes = perf.resScale<0.999;
  const perfLine = (lowFps||downRes)
    ? `${lowFps?`${eng.fps.toFixed(0)} fps`:''}${lowFps&&downRes?'   ':''}${downRes?`res ${perf.resScale.toFixed(2)}×`:''}\n`
    : '';
  // blur h·θ — the §3.2 softness scale (canopy height × the sun's angular size); a derived number, kept.
  const blur=(params.canopy_base_height_m*params.core_angular_radius_deg*DEG*100).toFixed(1);
  // wind score — one LIVE number that breathes with the gusts (driveEnv folds in base strength × the weather
  // spell × the broadband gust force), plus a slow character word. Subsumes the old str/gust/weather/sway.
  // The word reads off EFFECTIVE strength (base × weather) — the only wind axis that varies across looks
  // (pattern & gustiness are fixed in every preset), so it discriminates and drifts calm↔strong over a day.
  const windNow=Math.max(0,m.driveEnv), eff=params.wind_strength*m.weatherS;
  const windWord = eff<0.12 ? 'calm' : eff<0.6 ? 'light' : eff<1.2 ? 'breezy' : eff<2.0 ? 'windy' : 'strong';
  hud.textContent = `${perfLine}blur h·θ ≈ ${blur} cm    wind ≈ ${windNow.toFixed(1)}  ${windWord}`;
};

// ---- boot the panel UI (the engine is already running) ----
buildPresetUI();
buildPanel();
refreshGates();
buildPlayPanel();
buildStrip();
const sessionPanel=mountSettings({
  settings, engine:eng, rows:PANEL, save:()=>{saveSettings();applySession();syncAllControls();},
  account:()=>arb?.settings(),
});
function settingsButton(){ const button=mkBtn('settings',()=>sessionPanel.open());button.dataset.openSettings='';return button; }
syncMacroControls();

// ---- transition fade: its own row at the very bottom of the panel ----
(()=> {
  const h=document.createElement('h2'); h.textContent='Transition'; h.dataset.tipKey='fade'; dev.appendChild(h);
  const r=document.createElement('div'); r.className='ctl'; r.dataset.tipKey='fade';
  const lab=document.createElement('label'); lab.textContent='fade (s)';
  const inp=document.createElement('input'); inp.type='range'; inp.min=0; inp.max=6; inp.step=0.1; inp.value=transDur;
  const val=document.createElement('span'); val.className='val'; val.textContent=transDur.toFixed(1);
  inp.addEventListener('input',()=>{ transDur=parseFloat(inp.value); val.textContent=transDur.toFixed(1); });
  r.append(lab,inp,val); dev.appendChild(r);
  dev.appendChild(devBeta);                        // the experimental toggle (buildPresetUI), under everything
})();

// ===========================================================================
midi = mountMidi({
  params, PANEL, MACROS, TRY_SPECS, bus, macroUsable, tryWrite, stepPreset, reseed, stopPlay,
  toggleControls: () => { if(document.body.classList.contains('intro')) document.getElementById('feel').click(); else toggleControls(); },   // on the welcome, the panel button is "feel"
  tryReady: () => tryHome !== null,
  syncUI: () => syncMacroControls(),                           // the sliders and dials follow the hand (syncMacroControls seats the dials too)
  transActive: () => eng.trans.active,
  getTransDur: () => transDur, setTransDur: (v) => { transDur = v; },
  playing: () => player.playing,
  togglePlay: () => { if(!plays(stateNow(), activeList())) return; if(player.playing) player.stop(); else player.start(presetSel.value); },
});
// Welcome gate — the page opens on a faint 'memories' background (the §1 north-
// star look) under an intro overlay. "feel" un-dims the canvas and cloud-bloom
// crossfades to the editor's default look. On desktop the dev panel then slides
// in (D toggles it thereafter); on TOUCH it stays hidden — the art stands alone
// until a tap brings it up (spec §9).
// An arboretum link (#arboretum=…, #arboretum-playlist=…) changes where it lands: on the look the link brought in, or on
// the first item of the playlist it opened, which then plays (editor-integration-design §5). The link's fetch starts as
// soon as arboretum mounts, so it is usually done by "feel"; if not, the crossfade waits for it, five seconds at most.
// Preset permalinks bypass "feel" and the welcome crossfade: the requested look is applied as soon as it arrives.
// ===========================================================================
(()=> {
  const welcome=document.getElementById('welcome'), feel=document.getElementById('feel');
  let started=false;
  const arriveBy = performance.now()+20000;          // ...but a machine slow enough to stretch the crossfade still gets its UI
  function arrive(){                                 // reveal the mode's surface — only once the welcome crossfade has SETTLED
    if(eng.trans.active && performance.now()<arriveBy){ setTimeout(arrive, 500); return; }   // the tier clock is frame-clamped, so wall time can stretch; wait it out, don't guess it
    slideInPanel(); stripWake();
    if(settings.workspace) setWorkspace(true);       // the workspace a reload left on
    if(coarse && !settings.sawTouchHint){ settings.sawTouchHint=true; saveSettings(); showHint(); }   // the touch legend, once ever
  }
  // `opened` is what arboretum.js made of the link: { value } (a ★ in all looks) | { list, value, play } | { failed } | null (no link, or arboretum is off)
  function land(opened){
    if(devKept){ applyParams(devKept.look); refreshPresetSelect(devKept.value); syncAllControls(); arrive(); return; }   // a live reload's kept look (dev-server.js), on the entry it was on
    let at, playOnce=false;
    if(opened?.failed) showHint(`arboretum: ${opened.failed}`);    // a first-run visitor is in zen and would see nothing else; the look is the usual landing
    else if(opened){
      settings.playlist=opened.list ?? 'local'; saveSettings();
      at=opened.value; playOnce=!!opened.play;
      history.replaceState(null, '', location.pathname+location.search);   // a reload must not import again (an @n link would re-pin every time)
    }
    const target=at ?? landing();
    let settled=false;
    const landed=()=>{ refreshPresetSelect(target); syncAllControls(); if(playOnce){ playOnce=false; player.start(target); } };   // the first look has no fade in: its dwell starts here
    if(link?.preset){ applyParams(resolveEntry(target) ?? getPreset(DEFAULT_PRESET)); landed(); arrive(); return; }
    eng.transitionTo(resolveEntry(target) ?? getPreset(DEFAULT_PRESET), { duration:4,           // memories → editor default (spec §9)
      onEnd:()=>{ settled=true; endTween(); landed(); setTimeout(arrive,300); } });
    setTimeout(()=>{ if(!settled) landed(); arrive(); }, 5500);  // fallback if onEnd never fires
  }
  // "about", in place. The column is about.html's own (#aboutCol, with the stylesheet it links), fetched and parsed once and never
  // copied into this page's source; the welcome breathes out and the column breathes in over the same canvas, still under
  // body.intro. A failed fetch, or a click that asks for a tab (middle, cmd/ctrl, shift), goes to the page itself.
  const aboutLink=welcome.querySelector('.more a[href="about.html"]');
  let aboutLoad=null, aboutOpen=false, aboutView=null;
  const plain=(e)=> !e.button && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;
  function loadAbout(){
    if(aboutLoad) return aboutLoad;
    aboutLoad=(async()=>{
      const url=aboutLink.href, res=await fetch(url);
      if(!res.ok) throw new Error(`about: ${res.status}`);
      const doc=new DOMParser().parseFromString(await res.text(),'text/html');
      const column=doc.getElementById('aboutCol');
      if(!column) throw new Error('about: no column');
      await Promise.all([...doc.querySelectorAll('link[rel="stylesheet"]')].map((l)=> new Promise((ok,no)=>{
        const css=document.createElement('link'); css.rel='stylesheet'; css.href=new URL(l.getAttribute('href'),url).href;
        css.onload=ok; css.onerror=()=>no(new Error('about: stylesheet')); document.head.appendChild(css);
      })));
      return document.importNode(column,true);
    })();
    return aboutLoad;
  }
  const prefetch=()=>{ loadAbout().catch(()=>{}); };   // quietly, as the pointer or focus arrives
  aboutLink.addEventListener('pointerenter', prefetch);
  aboutLink.addEventListener('focus', prefetch);
  // The address follows what is showing: opening pushes the about link's own href, so Back is the reverse breath (`closeAbout`) and
  // Forward opens it again; "feel" from about puts the index's path back (replaceState), so a reload lands in the editor, not on about.
  // A reload at /about is the standalone about.html, which is the same page. `gen` lets whichever came last win a breath still running.
  const home=location.pathname+location.search;
  let gen=0;
  function openAbout(column){
    if(started) return;
    const g=++gen;
    if(aboutView){ aboutView.classList.remove('out'); return; }   // Forward while the column was still breathing out: it simply turns back in
    welcome.classList.add('out');                   // the welcome's own breath out, .9s
    arb.ready.then((origin)=>{ if(origin) for(const id of ['arbHead','arbText']) column.querySelector(`#${id}`).hidden=false; });   // as #arbLink: only where arboretum is served
    setTimeout(()=>{
      if(started || g!==gen) return;                // "feel" was pressed during the breath out, or Back came
      welcome.style.visibility='hidden';
      const view=document.createElement('div'); view.id='aboutView'; view.className='out'; view.tabIndex=-1;
      view.append(column);
      view.addEventListener('click',(e)=>{          // the column's "feel" is this feel, not a second one
        const a=e.target.closest('a.feel');
        if(a && plain(e)){ e.preventDefault(); feel.click(); }
      });
      document.body.append(view); aboutView=view;
      void view.offsetWidth;                        // commit the 'out' state so removing it is a transition: the reverse breath
      view.classList.remove('out'); view.focus({ preventScroll:true });
    }, 900);
  }
  function closeAbout(){                            // the reverse of opening: the column breathes out, then the welcome breathes back in
    const g=++gen, view=aboutView;
    aboutOpen=false;
    if(!view){ welcome.style.visibility=''; welcome.classList.remove('out'); return; }   // Back before the column came: the welcome turns back
    view.classList.add('out');
    setTimeout(()=>{
      if(started || g!==gen) return;                // "feel" was pressed, or Forward came
      view.remove(); aboutView=null;
      welcome.style.visibility=''; welcome.classList.remove('out');
    }, 900);
  }
  aboutLink.addEventListener('click',(e)=>{
    if(e.defaultPrevented || !plain(e) || started) return;
    e.preventDefault();
    if(aboutOpen) return; aboutOpen=true;
    loadAbout().then((column)=>{
      if(!aboutOpen || started) return;             // Back, or "feel", came while it loaded
      history.pushState({ about:true }, '', aboutLink.href);
      openAbout(column);
    }, ()=>{ location.href=aboutLink.href; });
  });
  addEventListener('popstate',(e)=>{
    const about=!!e.state?.about;
    if(started){ if(about) history.replaceState(null, '', home); return; }   // Forward onto about after "feel": the editor is what shows, so the address says so
    if(about && !aboutOpen){ aboutOpen=true; loadAbout().then(openAbout, ()=>{ location.reload(); }); }
    else if(!about && aboutOpen) closeAbout();
  });
  feel.addEventListener('click',()=>{
    if(started) return; started=true;
    if(aboutOpen) history.replaceState(null, '', home);   // the editor arrives at the index's own address
    gen++;
    document.body.classList.remove('intro');        // un-dim the canvas to full strength
    welcome.classList.add('out');                   // dissolve the intro text
    if(aboutView){ const v=aboutView; v.classList.add('out'); setTimeout(()=>v.remove(), 1000); aboutView=null; }   // ...and the about column, if it is what is showing
    if(link?.preset || devKept) welcome.style.display='none';
    else setTimeout(()=>{ welcome.style.display='none'; }, 1000);
    endTween();
    if(!link || devKept){ land(null); return; }
    Promise.race([linkReady, new Promise((ok)=>setTimeout(()=>ok({ failed:'no answer in time' }), 5000))])
      .catch((e)=>{ console.error(e); return null; }).then(land);
  });
})();

// ---- arboretum: the place the presets are kept, whether online or not (arboretum.js). It runs everywhere: the ★ looks are its
// local tier; on a fork it asks the network for nothing but a link the person opened (any origin may read), and only where
// `detect` names its origin (komorebi.eljojo.net, or arboretum's own dev server) does it add the session: sign-in, the cloud
// playlists and the controls for them. ----
const link = parseHash(location.hash);
const devKept = globalThis.__komorebiDev?.kept ?? null;   // the look a live reload kept (dev-server.js); null anywhere but its dev server
// What the editor lends arboretum.js, and nothing else of itself.
const arbHost = {
  get params(){ return eng.authored; }, rows: {...presetRows,account:sessionPanel.account},
  active: activeList, value: () => presetSel.value,
  sync: () => refreshPresetSelect(),                            // re-list (your looks follow the mirror), then the playlist select, the chip and the buttons that follow the active list
  select: refreshPresetSelect,                                  // re-list the active playlist, on this entry
  go: (value) => { if(value==='') refreshPresetSelect(''); else goTo(value); },   // ...or go to it, when the look on screen has left the list
  reload: () => refreshPresetSelect(resumeAt()),                // ...after its items changed under it
  activate: setActive,
  showCloud,
  keepLocal: saveStar,                                          // the session ended under a save: the look is kept here, as a ★, until you sign in
  advancedShown: () => !dev.classList.contains('hidden'),
};
arb = mount(arbHost);
arb.ready.then((origin)=>{ if(origin) document.getElementById('arbLink').hidden=false; });   // the welcome's "arboretum" link shows only where arboretum is served
syncPlaylistUI();
// A link is opened as soon as arboretum is up; `linkReady` is what the welcome gate waits on (null without a link).
const linkReady = link ? arb.open(link) : null;
if(link?.preset || devKept) document.getElementById('feel').click();   // a kept look skips the welcome, as a permalink does
// `/#feel` ("open komorebi" on arboretum's pages) is the welcome's own feel, pressed for you: the same arrival, without the intro text.
else if(location.hash==='#feel'){ history.replaceState(null, '', location.pathname+location.search); document.getElementById('feel').click(); }
// The dev server's bridge (dev-server.js): a tool outside the browser reads and sets this tab's look and sees its frame. Only that
// server defines __komorebiDev, so anywhere else this line does nothing. A set loads the merged look the way a pasted one loads.
globalThis.__komorebiDev?.attach({ eng, look: () => eng.captureLook(), set: (patch) => applyParams({ ...eng.captureLook(), ...patch }), value: () => presetSel.value,
  tree: (on) => { const was = [showTree, treePinned]; showTree = treePinned = on; return was; }, untree: ([s, p]) => { showTree = s; treePinned = p; },
  pane: (size) => paneOf().png(size?.w, size?.h) });   // the workspace's tree pane, drawn now at w×h whether or not the workspace is up   // the tree preview (T), shown pinned for a capture and put back after

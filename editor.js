import { create, DEG, MAX_LAYERS } from './komorebi.js';
import { PRESETS } from './presets.js';
import { AXES, axisValue, upValue, proposeVariants, proposeImprove, FRAME_BUDGET_MS } from './profiler.js';
import { getStored, setStored, getPreset } from './presets-store.js';
// ============================================================================
// Komorebi editor (editor.js, loaded by index.html) — the authoring shell around the shared engine
// (komorebi.js). The engine renders; this file is the dev panel, HUD, insets, preset management, sun-drag
// input, scene-transition stepping, and the auto-profiler UI. Pure sub-concerns are split into siblings:
// presets-store.js (★ localStorage I/O) and profiler.js (the cost taxonomy + variant algorithm). The
// viewer-only player (player.html) is a separate, UI-less consumer of the same engine. ES modules — must be
// SERVED over http(s) (`nix run .#dev`), not opened off the filesystem.
// ============================================================================
const canvas = document.getElementById('gl');
const dev = document.getElementById('dev');
const hud = document.getElementById('hud');
const clamp = (x,a,b) => Math.min(b, Math.max(a, x));
const fmt = (v) => Number.isInteger(v) ? String(v)
  : Math.abs(v)>=100 ? String(Math.round(v))   // big non-integers (azimuth / wind dir, step 1°) round to whole, not a 17-digit float
  : (+v).toFixed(2);

// ---- presets: getStored/setStored/getPreset are imported from presets-store.js (built-ins + ★ localStorage) ----
const DEFAULT_PRESET = 'afternoon 7';   // the editor's working default + fallback look (preset DATA lives in presets.js)
const WELCOME_PRESET = 'afternoon 6';   // the look shown faint behind the intro, until "feel"

// ---- boot the engine on the canvas ------------------------------------------
let eng;
try { eng = create(canvas, { params: getPreset(WELCOME_PRESET) }); }
catch(e){ document.body.innerHTML = `<div class="err">${e.message}</div>`; throw e; }
const params = eng.params;   // live params the panel edits in place
const perf = eng.perf;
// time-of-day is an editor-only INPUT method (it writes sun elevation/azimuth); not an engine param.
if(params.time_of_day===undefined) params.time_of_day = 9;
if(params.latitude===undefined) params.latitude = 45;   // ~Montreal, where this began
function applyScope(scope){ eng.apply(scope); }                      // slider/toggle rebuild
function applyParams(obj){ eng.setParams(obj); syncAllControls(); }  // load a whole preset (instant)
let transDur=1.5;                // scene-transition seconds (editor-only — a performance setting, not stored in a look)

// ===========================================================================
// Dev panel
// ===========================================================================
const controlEls={};   // key -> {input, valEl}

// scope: 'source' rebuilds the light; 'canopy' rebuilds+rebakes leaves;
// 'textures' reallocates layer textures too; 'perf' resets auto-quality; '' just re-reads each frame.
const PANEL = [
  ['h','Source'],
  ['s','cloud_thickness','CLOUD',0,1,0.01,'source'],
  ['s','core_weight_fraction','core wt',0,1,0.01,'source'],
  ['s','core_angular_radius_deg','core °',0.05,2,0.01,'source'],
  ['adv','advanced'],
  ['s','halo_angular_radius_deg','halo °',1,30,0.1,'source'],
  ['t','eclipse','eclipse','source'],
  ['s','eclipse_amount','ecl amt',0,1,0.01,'source'],

  ['h','Canopy'],
  ['s','tree_count','trees',1,16,1,'canopy'],
  ['s','canopy_base_height_m','base h (m)',2,20,0.1,''],
  ['s','canopy_extent_m','extent (m)',6,24,0.5,'textures'],
  ['s','foliage_density','density',0.1,3,0.05,'canopy'],
  ['s','branch_children','children',1,6,1,'canopy'],
  ['s','branch_angle_deg','branch °',5,80,1,'canopy'],
  ['s','branch_length_ratio','len ratio',0.3,0.92,0.01,'canopy'],
  ['s','branch_pitch_deg','pitch °',0,80,1,'canopy'],
  ['s','trans_r','trans R',0.001,0.6,0.001,'canopy'],
  ['s','trans_g','trans G',0.001,0.9,0.001,'canopy'],
  ['s','trans_b','trans B',0.001,0.6,0.001,'canopy'],
  ['btn','reseed', ()=>{ params.seed=Math.floor(Math.random()*1e9); applyScope('canopy'); }],
  ['adv','fine geometry'],
  ['s','canopy_thickness_m','depth (m)',0,10,0.1,''],
  ['s','branch_levels','levels',1,4,1,'canopy'],
  ['s','leaves_per_cluster','leaves/twig',1,80,1,'canopy'],
  ['s','cluster_spread_m','spread (m)',0.02,1,0.01,'canopy'],
  ['s','leaf_size_m','leaf (m)',0.01,0.4,0.005,'canopy'],
  ['s','leaf_aspect','aspect',1,4,0.05,'canopy'],
  ['s','max_tilt','tilt',0,1,0.01,'canopy'],
  ['s','edge_softness','edge',0.01,1,0.01,'canopy'],

  ['h','Transport'],
  ['s','time_of_day','time (h)',5,19,0.25,'suntime'],
  ['s','latitude','latitude °',0,66,1,'suntime'],
  ['s','sun_elevation_deg','elev °',4,90,0.5,''],
  ['s','sun_azimuth_deg','azim °',0,360,1,''],

  ['h','Look'],
  ['s','view_extent_m','view (m)',0.5,16,0.1,''],
  ['s','view_pitch_deg','tilt °',0,70,1,''],
  ['s','view_fov_deg','fov °',10,110,1,''],
  ['s','far_smear','far smear',0,8,0.25,''],
  ['s','exposure','exposure',0,4,0.01,''],
  ['s','contrast','contrast',0.3,2,0.01,''],
  ['s','ambient_skylight','ambient',0,3,0.01,''],
  ['s','sky_turbidity','haze β',0,0.5,0.01,''],
  ['s','mesopic_strength','dusk rods',0,1,0.01,''],
  ['s','chromatic_aberration','diffraction',0,6,0.1,''],
  ['sel','tone_map','tonemap',[['none',0],['reinhard',1],['aces',2]],''],

  ['h','Background'],
  ['s','ground_r','ground R',0,1,0.01,''],
  ['s','ground_g','ground G',0,1,0.01,''],
  ['s','ground_b','ground B',0,1,0.01,''],

  ['h','Wind — coherent band'],
  ['sels','wind_pattern','pattern',[['steady','steady'],['gusty','gusty'],['squally','squally'],['choppy','choppy'],['lazy','lazy']],''],
  ['s','wind_strength','strength',0,2,0.01,''],
  ['s','wind_gustiness','gustiness',0,0.6,0.01,''],
  ['s','gust_frequency','gust rate',0.01,1,0.005,''],
  ['s','wind_direction_deg','dir °',0,360,1,''],
  ['s','weather_variability','weather',0,1,0.01,''],
  ['s','weather_speed','weather spd',0.1,4,0.1,''],
  ['adv','spring mechanics'],
  ['s','gust_attack','attack (s)',0.05,5,0.05,''],
  ['s','gust_decay','decay (s)',0.05,8,0.05,''],
  ['s','sway_stiffness','stiffness ω',0.5,15,0.1,''],
  ['s','sway_ceiling','ceiling (m)',0.05,1.5,0.01,''],
  ['s','damping_ratio','damping ζ',0.02,1,0.01,''],
  ['s','backlash_gain','backlash',0,4,0.05,''],
  ['s','sway_height_gain','height gain',0,2,0.05,''],
  ['s','limb_count','limbs',1,24,1,'canopy'],
  ['s','limb_flex','limb bend',0,1,0.01,''],
  ['s','twig_flex','twig bend',0,1,0.01,''],
  ['s','stem_length','stem (m)',0,1.5,0.01,''],
  ['s','leaf_swing','leaf swing',0,2,0.01,''],
  ['s','flutter_freq','flutter Hz',0,5,0.05,''],

  ['hc','Leaf drift (incoherent band)'],
  ['s','drift_amount','amount (m)',0,0.4,0.005,'bake'],
  ['s','drift_phase','phase',0,6.2832,0.01,'bake'],
  ['t','drift_auto','auto',''],
  ['s','drift_speed','speed',0,2,0.01,''],

  ['hc','Tune'],
  ['s','sample_count','samples',16,48,1,'source'],
  ['sel','tex_resolution','res',[['1024',1024],['2048',2048],['4096',4096]],'textures'],
  ['s','layer_count','layers',1,MAX_LAYERS,1,'textures'],
  ['sel','bake_resolution','bake res',[['follow tex',0],['768',768],['1024',1024],['1536',1536],['2048',2048]],'textures'],
  ['t','adaptive_motion','adaptive fps',''],
  ['sel','adaptive_idle_fps','idle fps',[['24',24],['30',30],['48',48]],''],
  ['t','auto_quality','auto 60fps','perf'],

  ['hc','Debug'],
  ['t','show_source','show source',''],
  ['t','show_layer','show layer','' ],
  ['s','show_layer_index','layer #',0,MAX_LAYERS-1,1,''],
  ['btn','profile · measure & lighten', ()=>runProfile()],
];

function buildPanel(){
  let container = dev;                                        // rows append here; an 'adv'/'hc' group redirects them into a <details>
  const group=(text,cls)=>{ const d=document.createElement('details'); const s=document.createElement('summary');
    s.textContent=text; s.dataset.tipKey=text; s.className=cls; d.appendChild(s); dev.appendChild(d); return d; };
  for(const item of PANEL){
    if(item[0]==='h'){ const h=document.createElement('h2'); h.textContent=item[1]; h.dataset.tipKey=item[1]; dev.appendChild(h); container=dev; continue; }
    if(item[0]==='hc'){ container=group(item[1],'sec'); continue; }    // a whole collapsible section (closed by default)
    if(item[0]==='adv'){ container=group(item[1],'adv'); continue; }   // a collapsible 'advanced' sub-group inside the current section
    const row=document.createElement('div'); row.className='ctl';
    if(item[0]==='s'){
      const [,key,label,min,max,step,scope]=item;
      const lab=document.createElement('label'); lab.textContent=label;
      const inp=document.createElement('input'); inp.type='range'; inp.min=min; inp.max=max; inp.step=step; inp.value=params[key];
      const val=document.createElement('span'); val.className='val'; val.textContent=fmt(params[key]);
      inp.addEventListener('input',()=>{ params[key]=parseFloat(inp.value); val.textContent=fmt(params[key]);
        if(scope==='suntime') updateSunFromTime(); else applyScope(scope); });
      row.append(lab,inp,val); controlEls[key]={input:inp,valEl:val}; row.dataset.tipKey=key;
    } else if(item[0]==='t'){
      const [,key,label,scope]=item; row.classList.add('toggle');
      const lab=document.createElement('label'); lab.textContent=label;
      const inp=document.createElement('input'); inp.type='checkbox'; inp.checked=params[key];
      inp.addEventListener('change',()=>{ params[key]=inp.checked; applyScope(scope); });
      row.append(lab,inp); controlEls[key]={input:inp}; row.dataset.tipKey=key;
    } else if(item[0]==='sel' || item[0]==='sels'){    // 'sel' = integer value, 'sels' = string value (e.g. wind_pattern)
      const str=item[0]==='sels';
      const [,key,label,opts,scope]=item; row.classList.add('select');
      const lab=document.createElement('label'); lab.textContent=label;
      const sel=document.createElement('select');
      for(const [t,v] of opts){ const o=document.createElement('option'); o.value=v; o.textContent=t; if(v===params[key]) o.selected=true; sel.appendChild(o); }
      sel.addEventListener('change',()=>{ params[key]=str?sel.value:parseInt(sel.value,10); applyScope(scope); });
      row.append(lab,sel); controlEls[key]={input:sel}; row.dataset.tipKey=key;
    } else if(item[0]==='btn'){
      const [,label,fn]=item;
      const b=document.createElement('button'); b.textContent=label; b.addEventListener('click',fn);
      row.appendChild(b); row.dataset.tipKey=label;
    }
    container.appendChild(row);
  }
}
function syncControl(key){ const c=controlEls[key]; if(!c)return;
  if(c.input.type==='checkbox') c.input.checked=!!params[key]; else c.input.value=params[key];
  if(c.valEl) c.valEl.textContent=fmt(params[key]); }
function syncAllControls(){ for(const k in controlEls) syncControl(k); }

// ---- tooltips: lead with a plain "this does that", then build up to the why. Hover any knob or
// heading. Different people think differently, so each starts simple and goes deeper underneath. ----
const TIPS = {
  // section headings
  'advanced':"<b>The cloud's finer dials — set once, rarely touched.</b> Halo size, sample count (smoothness vs. speed), and the eclipse demo. Folded away so the everyday CLOUD and sharpness knobs sit up top.",
  'fine geometry':"<b>The canopy's set-and-forget shape.</b> Leaf size, aspect and rest-tilt, cluster spread, recursion depth, texture detail — dialled in once for the whole piece, not per look. (Your presets never change them.)",
  'spring mechanics':"<b>How the branches feel in the wind — tuned once.</b> The gust envelope, spring stiffness / ceiling / damping / backlash, and the per-level limb &amp; twig flex. Per scene you really only change strength and direction above.",
  'Source':"<b>The light itself.</b> The sun here isn't a single dot — it's a little cloud of sample-suns covering the sun's real size (plus any haze around it). That finite size is the reason every shadow edge is soft. These knobs shape the light.",
  'Canopy':"<b>The trees.</b> A small grove, grown branch by branch, with leaves on the twig-tips. You never actually see the tree — only the shadow it throws on the ground — so we only bother modelling what changes that shadow.",
  'Transport':"<b>Where the sun sits in the sky.</b> Sets how the dapples stretch on the tilted ground — and now also the colour of the light and how cool the shadows go at dusk.",
  'Look':"<b>The finishing touches — brightness, contrast, colour.</b> Everything here is about how the picture is shown, never the simulation underneath.",
  'Wind — coherent band':"<b>The breeze that moves the whole canopy together.</b> Pick a <b>pattern</b> for its character, then dial how much, how gusty, how frequent, and which way. The trunk slides the pattern sideways while limbs and twigs lean and spring back; deep lulls let it swing back through rest, and a crosswind keeps it from being a dead-straight slide.",
  'Leaf drift (incoherent band)':"<b>The faint, fidgety wind from all sides at once.</b> Each leaf jiggles on its own, so gaps reshuffle — merging and splitting like light on the floor of a pool — instead of sliding. (A preview of the second kind of wind.)",
  'Tune':"<b>Performance vs. quality — set once for the machine, not the look.</b> Sample count, texture &amp; bake resolution, depth layers, the auto-60fps governor, and the adaptive-fps idle saver. Two opt-in optimizations live here (bake res, adaptive fps) that trade a little fidelity for speed — the profiler (<b>profile</b> below) measures them and can both lighten a heavy look and spend spare budget on quality.",
  'Debug':"<b>Tools for peeking under the hood.</b> These don't change the art.",
  bake_resolution:"<b>Resolution of the leaf-shadow bake, split off from texture res.</b> Lower it to make the per-frame bake (the windy-look cost the auto-governor can't touch) ~quadratically cheaper, at the price of softening the very sharpest sub-leaf gaps. <i>follow tex</i> = match texture res (no change). Opt-in; A/B it in the profiler.",
  adaptive_motion:"<b>Drop to a lower frame rate while the canopy is nearly still.</b> When the wind lulls (or a look only slow-drifts), the heavy passes run at the idle rate below and the rest are re-presented — big idle saving, with visible stepping on the slow shimmer as the trade. Full rate returns the moment the wind picks up. Off = render every frame.",
  adaptive_idle_fps:"<b>The reduced rate 'adaptive fps' falls to</b> in low-motion frames. Lower saves more but steps the slow shimmer more visibly.",
  'Presets':"<b>Saved looks.</b> Built-in ones are marked •, your own ★ (saved in this browser). Copy/paste JSON to share a look with someone. Step between them live with the <b>← →</b> arrow keys.",
  'fade':"<b>How long a scene change takes.</b> Stepping presets with ← → cross-dissolves over this many seconds: the look morphs while a soft cloud drifts over to hide the trees and branches regrowing behind it. 0 = instant cut.",
  // Source
  sample_count:"<b>Smoothness of the light, traded against speed.</b> More samples = silkier dapples; fewer = faster. It's how many tiny suns we spread across the sun's disk. Auto-quality trims it when the frame rate dips.",
  core_angular_radius_deg:"<b>How big the sun looks — the master softness of every dapple.</b> A bigger sun blurs the shadows more. Tiny gaps stop showing their own shape and instead cast little pictures of the sun — that's what a dapple is. (Real sun ≈ 0.27°; presets often nudge it bigger for a dreamier feel.)",
  halo_angular_radius_deg:"<b>How wide the cloudy glow around the sun spreads.</b> Thin cloud smears the sun into a big halo; this is its size, and it shows up as the CLOUD knob goes up.",
  core_weight_fraction:"<b>Crisp vs. hazy on a clear day.</b> How much of the light sits in the sharp centre vs. the soft glow around it. The CLOUD knob drains the centre into the glow over time; this is the clear-sky starting point.",
  cloud_thickness:"<b>The master 'cloudiness' dial — turn it up and everything melts soft.</b> Drifting cloud simply makes the sun look bigger and blurrier, so the dapples bloom, dim and lose contrast all together. The single most expressive control in here.",
  eclipse:"<b>A little science demo, not weather.</b> Slides a moon across the sun so it becomes a crescent — and watch every dapple on the ground turn into a crescent too. That's the proof the dapples are pictures of the sun, not the shapes of the gaps.",
  eclipse_amount:"<b>How far the moon covers the sun</b> — i.e. how thin the crescent gets. Only matters with 'eclipse' on.",
  // Canopy
  layer_count:"<b>How many depth-slices the tree is flattened into (3–4).</b> The one spot where we cheat. Higher slices shift more as the sun moves, so taller leaves blur more — some dapples crisp, some soft, for free. The eye can't count the slices.",
  canopy_base_height_m:"<b>How high the lowest leaves are.</b> A taller canopy gives bigger, softer dapples (a 10 m tree casts ~10 cm-soft edges). It also gives the branches a longer lever to sway on.",
  canopy_thickness_m:"<b>How deep the leafy layer is, top to bottom.</b> More depth = a wider mix of sharp (low) and soft (high) dapples.",
  tree_count:"<b>How many trees in the grove.</b> Their crowns overlap to fill the frame — a single tree would leave a bright bald spot over its trunk. More trees = fuller, more even cover.",
  branch_levels:"<b>How many times the branches split (trunk → limb → twig …).</b> More levels = finer, more natural branching, so gaps show up at every scale. Leaf count climbs fast with this.",
  branch_children:"<b>How bushy each branch is — how many shoots come off it.</b> The main 'how full is the tree' knob. More = a denser canopy and many more twigs.",
  branch_angle_deg:"<b>How wide the branches fan out.</b> Narrow = tight, broom-like trees; wide = open, spreading crowns with bigger gaps.",
  branch_length_ratio:"<b>How fast branches shrink as they split.</b> Low = stubby and compact; high = long, reaching, sparser.",
  branch_pitch_deg:"<b>How steeply the limbs tilt upward.</b> This spreads the leaves out in height — and height is what sorts them into the sharp vs. soft slices.",
  foliage_density:"<b>How full the canopy is — sparse spring vs. thick summer.</b> The big mood knob. Sparse: every leaf matters, so the faint wind can totally reshuffle the gaps. Thick: the same flutter only makes them twinkle.",
  leaves_per_cluster:"<b>How many leaves on each twig-tip.</b> Sets the overall leaf count (and how heavy it is to draw). Crossing whole numbers fades in smoothly, so you can sweep it without it jumping.",
  cluster_spread_m:"<b>How tightly leaves bunch on a twig.</b> Tight = distinct clumps with clear gaps between them; loose = a more even leaf carpet.",
  leaf_size_m:"<b>How big each leaf is.</b> Bigger leaves block more and leave smaller gaps — and small gaps are exactly what make those soft, round sun-pictures.",
  leaf_aspect:"<b>Leaf shape — round vs. long and narrow.</b> Higher = skinnier leaves. Changes the shape each leaf blocks as it rocks in the wind.",
  max_tilt:"<b>How tilted the leaves sit at rest.</b> A tilted leaf is seen more edge-on, so it blocks less — this thins the canopy and gives the wind something to foreshorten.",
  edge_softness:"<b>How fuzzy each leaf's own edge is.</b> Small = crisp, detailed leaves; large = softer blobs. (It's honest blur from a leaf only half-covering a pixel.)",
  trans_r:"<b>How much RED light leaks through a leaf.</b> Keep it low — leaves drink red, which is why shade isn't black. It's the main lever on how warm the shadow-green looks. Stacked leaves multiply, so overlaps go darker.",
  trans_g:"<b>How much GREEN light leaks through a leaf.</b> High — leaves pass green, so the shade beneath them glows green instead of going black. The signature komorebi colour.",
  trans_b:"<b>How much BLUE light leaks through a leaf.</b> Low, like red. A small nudge on how cool the shade reads.",
  canopy_extent_m:"<b>How big the simulated patch of ground is.</b> It has to be bigger than what you're viewing (with room for the sun to shift things), or dapples run off the edge. The grove auto-fits inside it.",
  tex_resolution:"<b>Detail of the leaf-shadow map.</b> Higher resolves the tiniest gaps (the sharpest dapples) but costs more. 1024 is usually plenty for something this soft.",
  reseed:"<b>Roll a new random tree layout.</b> Same kind of grove, freshly grown — a different arrangement of trees, branches and leaves.",
  // Transport / time of day
  time_of_day:"<b>Set the sun by clock time instead of by angle.</b> Drag from dawn through noon to dusk and the sun rises, arcs over, and sets — warming the light and stretching the dapples as it goes. It works out the real sun position for a spring day at your latitude, and writes the elevation/azimuth below.",
  latitude:"<b>Where on Earth you are — it sets how high the noon sun climbs.</b> Near the equator the midday sun is nearly overhead; far north it stays low and raking all day. (45° ≈ Montreal, where this all began.)",
  sun_elevation_deg:"<b>How high the sun is — drag it down for sunset.</b> A low sun stretches the dapples into long ellipses, turns the light warm and orange, and lets the shade go cool blue. The most scene-changing knob. (Or just drag on the picture.)",
  sun_azimuth_deg:"<b>Which compass direction the sun is in.</b> Turns the direction the dapples stretch and lean.",
  // Look
  view_extent_m:"<b>Zoom — how much ground you see.</b> Small = a close-up of a few big dapples; large = a wide field of many small ones. (It's the span at screen centre, so it holds as you tilt.)",
  view_pitch_deg:"<b>Tilt — straight down vs. out along the floor.</b> 0° is the old top-down map; raise it and you're sitting under the tree — the near floor drops to the bottom of frame, the far floor recedes and dissolves into haze.",
  view_fov_deg:"<b>Lens — how strong the perspective is.</b> Narrow is flat and telephoto; wide throws the near floor big and rushes the far floor away. Only bites once you've tilted.",
  far_smear:"<b>Far-field smear — distance softening.</b> A far pixel covers a big patch of ground, so its dapples should melt into soft down-sun streaks while the near floor stays crisp. Higher = more melt (and less far-field shimmer). Has no effect top-down — it grows with the tilt.",
  exposure:"<b>Brightness.</b> How bright the floor is. Pure look — it never changes the light simulation, just where it lands on screen.",
  contrast:"<b>Punch.</b> Higher = bold, snappy dapples; lower = the flat, milky look of haze.",
  ambient_skylight:"<b>How much the sky fills the shadows.</b> The light that isn't direct sun — now coloured for real (blue by day, warmer at dusk). Up = softer, lifted shade; down = deep, moody shadows.",
  sky_turbidity:"<b>Haze in the air.</b> Clean air = low; dust or humidity = higher, which makes a low sun redder and a sunset more washed-out orange.",
  mesopic_strength:"<b>How blue the shadows go at dusk.</b> As light fades your eye quietly switches to night vision, which is colour-blind and blue-ish — so the dim shade cools toward grey-blue while the bright dapples stay warm. Only kicks in at low sun. 0 = off.",
  chromatic_aberration:"<b>Prism fringe — red and blue split at the leaf edges.</b> Light bends round each leaf edge by an angle that grows with its wavelength (diffraction, θ∝λ), so red spreads a touch wider than blue and every dapple gains a warm outer rim and a cool core. Rides the same shift as the dapples, so it grows with canopy height and the low-sun stretch for free. 0 = off; ~1 is the true wavelength spread, higher exaggerates.",
  tone_map:"<b>How over-bright light is squeezed onto the screen.</b> ACES is the soft, filmy default; Reinhard is simpler; None just clips the brightest bits.",
  // Background
  'Background':"<b>The floor the light lands on.</b> Plain white by default; tint it and it reads like real ground. The dapples reflect off it — deep shade goes dark earth, midtones warm brown, and only the hottest spots still burn toward white. (A couple of the afternoon looks carry a warm Mount-Royal dirt; all three at 1 = white floor.)",
  ground_r:"<b>How much RED the ground reflects.</b> Earth is warm, so red leads — it's what makes the floor read as soil rather than concrete. 1 = pure white on this channel.",
  ground_g:"<b>How much GREEN the ground reflects.</b> Mid for brown dirt; raise it toward mossy or grassy ground, drop it for redder clay.",
  ground_b:"<b>How much BLUE the ground reflects.</b> Low for warm dirt; raise it toward grey gravel or cool stone.",
  // Wind — coherent
  wind_pattern:"<b>The character of the wind.</b> Real wind isn't one frequency — it's a whole spread of them at once, and these are different recipes for that spread. <b>steady</b>: smooth rolling breeze. <b>gusty</b>: the natural default. <b>squally</b>: bursty, comes in clustered shoves with deep lulls. <b>choppy</b>: nervous, fine, cold-front edge. <b>lazy</b>: a very slow faint stir. All five read the same knobs below — they just shape them differently.",
  wind_strength:"<b>How much wind — how hard it blows.</b> 0 = still. Turn it up and the branches bend, fight at the peak of a gust, then snap back.",
  wind_gustiness:"<b>How alive vs. steady the wind is.</b> Low = a smooth, near-constant lean; high = it surges and drops, and the deep lulls let the branches swing all the way back through rest (and even past it). This is the 'is it gusty' knob — real open-air wind sits around 0.1–0.25.",
  wind_direction_deg:"<b>Which way the wind blows.</b> The whole dapple pattern drifts and leans this way (slowly wandering off it if 'weather' is up).",
  gust_frequency:"<b>How frequent the gusts are — their rhythm.</b> It sets the slowest, biggest swell; faster gusts and fine flutter layer on top automatically. Low = long, slow swells; high = busier air.",
  weather_variability:"<b>Does the wind have a day of its own?</b> 0 = it stays exactly as you set it. Turn it up and a slow 'weather' drifts over minutes — calm spells and gusty spells come and go, and the direction slowly veers — so it's never quite the same twice. (A calm day = low; a gusty Montreal-spring day = high, with strength up too.)",
  weather_speed:"<b>How fast the weather changes</b> when 'weather' is up — how quickly it drifts between calm and gusty and swings direction.",
  gust_attack:"<b>How quickly a gust builds up.</b> Short = a sudden shove; long = a gentle rise.",
  gust_decay:"<b>How quickly a gust fades away.</b> Usually slower than it built — that lingering release.",
  sway_stiffness:"<b>Springiness of the sway.</b> Stiff = quick, tight, twitchy motion; soft = slow, lazy, big swings.",
  sway_ceiling:"<b>How far the branches can bend.</b> They hit a limit and clip there — that's the feeling of them fighting the wind at a gust's peak.",
  damping_ratio:"<b>How quickly the swaying settles down.</b> Low = springy and ringing; high = sluggish and dead.",
  backlash_gain:"<b>The snap-back when a gust lets go.</b> Branches recoil past their resting point and ring down, instead of gliding gently home. 0 = no snap.",
  sway_height_gain:"<b>Do taller branches sway more than low ones?</b> 0 = the whole canopy slides as one rigid sheet; turn it up and it shears with height, so gaps morph as well as slide.",
  limb_count:"<b>How many big arms each tree has.</b> More = the crown splits into finer wedges that can each lean on their own.",
  limb_flex:"<b>How much the big limbs bend.</b> The slow, broad sway — a whole wedge of the crown swinging together.",
  twig_flex:"<b>How much the little twigs bend.</b> The faster, finer motion one level down — each clump of leaves swinging a bit differently, so gaps shear and morph.",
  stem_length:"<b>Where a twig bends from.</b> Pivoting a clump from its own middle makes it spin in place (an ugly little whirlpool); offsetting the pivot toward the branch makes it swing like a real twig. Set it to 0 and the whirlpools come back.",
  leaf_swing:"<b>How much each leaf rocks in the wind.</b> A rocking leaf turns edge-on and back, so dapples change shape and blink — not just slide. This is a big part of what makes it read as wind at all.",
  flutter_freq:"<b>How fast the leaves flutter.</b> The quick trembling on top of the slow sway — the glisten.",
  // Leaf drift
  drift_amount:"<b>How much the leaves jiggle in place.</b> 0 = frozen; a little = a faint twinkle; a lot = the gaps fully reshuffle, merging and splitting like light on the bottom of a pool.",
  drift_phase:"<b>Scrub the jiggle by hand.</b> Slides every leaf around its little loop. Because it's a loop, the pattern comes right back to where it started each cycle.",
  drift_auto:"<b>Let the jiggle run on its own.</b> A hands-free preview of that faint, all-directions wind.",
  drift_speed:"<b>How fast the jiggle runs</b> when 'auto' is on.",
  // Debug
  auto_quality:"<b>Auto-tunes quality to hold ~60 fps.</b> Drops the cheapest quality first (resolution, then sample count) when things get heavy, and is slow to crank back up. Never touches the look — only the sharpness.",
  show_source:"<b>Show a little map of the sun</b> you're sampling (centre + glow) in the corner. Watch it change as you move CLOUD or eclipse.",
  show_layer:"<b>Peek at one raw depth-slice</b> of leaf shadows, instead of the finished picture.",
  show_layer_index:"<b>Which slice to peek at</b> when 'show layer' is on (0 = lowest).",
};
const tip = document.getElementById('tip');
function showTip(html, el){
  tip.innerHTML = html; tip.style.display = 'block';
  const r = el.getBoundingClientRect();
  tip.style.left = `${dev.getBoundingClientRect().right + 8}px`;
  tip.style.top  = `${Math.min(Math.max(8, r.top), window.innerHeight - tip.offsetHeight - 8)}px`;
}
dev.addEventListener('mouseover', e=>{ const el=e.target.closest('[data-tip-key]'); if(!el) return;
  const t=TIPS[el.dataset.tipKey]; if(t) showTip(t, el); });
dev.addEventListener('mouseout', e=>{ const el=e.target.closest('[data-tip-key]'), to=e.relatedTarget;
  if(el && (!to || !el.contains(to))) tip.style.display='none'; });
dev.addEventListener('scroll', ()=>{ tip.style.display='none'; });

// ---- time of day: an alternative to the raw sun angle. Works out the sun's elevation & azimuth for a
// SPRING day (equinox, so declination ≈ 0) at the chosen latitude, and writes them to the sun knobs. --
function updateSunFromTime(){
  const lat=(params.latitude||0)*DEG, H=(params.time_of_day-12)*15*DEG;   // hour angle: 15°/hr, 0 at solar noon
  const el = Math.asin(clamp(Math.cos(lat)*Math.cos(H), -1, 1))/DEG;      // equinox: elevation = asin(cos lat · cos H)
  const az = (180 + Math.atan2(Math.sin(H), Math.cos(H)*Math.sin(lat))/DEG + 360) % 360;  // east → south → west
  params.sun_elevation_deg = clamp(el, 4, 90);                            // the engine floors elevation at 4°
  params.sun_azimuth_deg = az;
  syncControl('sun_elevation_deg'); syncControl('sun_azimuth_deg');       // colour + ellipse re-read next frame
}

// ---- presets UI: dropdown + save/delete + copy/paste JSON -------------------
let presetSel;
function refreshPresetSelect(selected){
  presetSel.innerHTML='';
  const stored=getStored();
  const mk=(name,mark)=>{ const o=document.createElement('option'); o.value=name; o.textContent=mark+name;
    if(name===selected) o.selected=true; presetSel.appendChild(o); };
  for(const n of Object.keys(PRESETS)) mk(n,'• ');     // built-in
  for(const n of Object.keys(stored)) mk(n,'★ ');               // saved
}
function mkBtn(label,fn){ const b=document.createElement('button'); b.textContent=label; b.addEventListener('click',fn); return b; }
function buildPresetUI(){
  const h=document.createElement('h2'); h.textContent='Presets'; h.dataset.tipKey='Presets'; dev.appendChild(h);
  const r1=document.createElement('div'); r1.className='ctl select';
  presetSel=document.createElement('select');
  presetSel.addEventListener('change',()=>applyParams(getPreset(presetSel.value)));
  r1.appendChild(presetSel); dev.appendChild(r1);

  const r2=document.createElement('div'); r2.className='ctl';
  r2.append(
    mkBtn('save',()=>{ const n=(prompt('Save preset as:')||'').trim(); if(!n) return;
      const s=getStored(); s[n]=JSON.parse(JSON.stringify(params)); setStored(s); refreshPresetSelect(n); }),
    mkBtn('delete',()=>{ const n=presetSel.value, s=getStored();
      if(!(n in s)){ alert("Built-in presets can't be deleted."); return; }
      delete s[n]; setStored(s); refreshPresetSelect(DEFAULT_PRESET); }));
  dev.appendChild(r2);

  const r3=document.createElement('div'); r3.className='ctl';
  r3.append(
    mkBtn('copy JSON',()=>{ const txt=JSON.stringify(params,null,2);
      if(navigator.clipboard?.writeText) navigator.clipboard.writeText(txt).catch(()=>prompt('Copy JSON:',txt));
      else prompt('Copy JSON:',txt); }),
    mkBtn('paste JSON',()=>{ const txt=prompt('Paste preset JSON:'); if(!txt) return;
      try{ const o=JSON.parse(txt); applyParams(o.params||o); refreshPresetSelect(); }catch(_e){ alert('Invalid JSON'); } }));
  dev.appendChild(r3);
  refreshPresetSelect(DEFAULT_PRESET);
}

// ---- dev panel reveal / dismiss / transient peek ---------------------------
// On desktop the panel slides in after "feel" and D toggles it. On TOUCH there's no keyboard, so it
// arrives hidden (the art stands alone) and is driven by canvas gestures: a double-tap toggles it, and a
// press-and-hold "peeks" it away to glance at the art, sliding back on release. The slide reuses the
// #dev.offscreen transform transition; the peek never sets `hidden`, so the panel's shown/dismissed
// state survives a peek.
const coarse = !!(window.matchMedia && matchMedia('(pointer: coarse)').matches);   // touch / phone
const hint = document.getElementById('hint');
let peeking=false, panelTimer=0;
function slideInPanel(){
  if(!dev.classList.contains('hidden')) return;   // first reveal only (idempotent vs. the welcome fallback timer)
  clearTimeout(panelTimer);
  dev.classList.add('offscreen');                 // park it off the left edge...
  dev.classList.remove('hidden');                 // ...reveal it there...
  void dev.offsetWidth;                            // ...reflow so the next change animates...
  dev.classList.remove('offscreen');              // ...and slide it in
  hint.classList.remove('gone');                  // bring the key hints up with it
}
function slideOutPanel(){
  if(dev.classList.contains('hidden')) return;
  dev.classList.add('offscreen');                                    // slide it out...
  panelTimer=setTimeout(()=>{ dev.classList.add('hidden'); }, 600);  // ...then drop it once the .6s slide ends
}
function togglePanel(){ dev.classList.contains('hidden') ? slideInPanel() : slideOutPanel(); }
function peekPanel(on){                            // transient: slide away to glance at the art, restore on release
  if(on){ if(dev.classList.contains('hidden')) return;   // nothing to peek away when already dismissed
          peeking=true; dev.classList.add('offscreen'); }
  else if(peeking){ peeking=false; dev.classList.remove('offscreen'); }
}

// Canvas pointer input. A MOUSE drags the sun (azimuth from x, elevation from y). A finger can't do that
// and swipe, so TOUCH is swipe-nav instead: a vertical swipe steps presets (like ↑/↓), a horizontal drag
// scrubs time-of-day live (the sun arcs across the day). Axis locks once the gesture clears a deadzone.
// On TOUCH the panel is also gesture-driven: double-tap toggles it, press-and-hold peeks it away (above).
const SWIPE_DEAD=12, SWIPE_STEP=45;                            // px: ignore taps; min vertical throw to count as a preset step
const HOLD_MS=350, DOUBLE_MS=300;                              // ms: press-and-hold = peek; two taps within this = toggle
let dragging=false, px=0, py=0;
let swipe=null;                                                // touch gesture in progress: {sx, sy, axis:null|'x'|'y'}
let holdTimer=0, holdFired=false, lastTap=0;                   // touch panel gestures: peek timer + double-tap clock
canvas.addEventListener('pointerdown',e=>{
  // tap the tree preview to PIN it big (tap again to unpin); otherwise begin a gesture
  if(showTree){ const r=canvas.getBoundingClientRect();
    if(eng.treeInsetHit({ x:(e.clientX-r.left)/r.width, y:(e.clientY-r.top)/r.height })){ treePinned=!treePinned; return; } }
  if(e.pointerType==='touch'){
    swipe={ sx:e.clientX, sy:e.clientY, axis:null }; holdFired=false;
    holdTimer=setTimeout(()=>{ holdFired=true; if(swipe&&!swipe.axis) peekPanel(true); }, HOLD_MS);   // held still = peek
  } else dragging=true;
  px=e.clientX; py=e.clientY; canvas.setPointerCapture(e.pointerId); });
canvas.addEventListener('pointerup',e=>{
  if(swipe){
    clearTimeout(holdTimer); holdTimer=0;
    if(peeking) peekPanel(false);                              // end a peek: slide the panel back
    else if(swipe.axis==='y'){ const dy=e.clientY-swipe.sy; if(Math.abs(dy)>SWIPE_STEP) stepPreset(dy<0 ? 1 : -1); }  // vertical swipe = preset step
    else if(!swipe.axis && !holdFired) handleTap();            // a clean quick tap → double-tap candidate (toggles the panel)
    swipe=null;
  }
  dragging=false; });
canvas.addEventListener('pointercancel',()=>{ clearTimeout(holdTimer); holdTimer=0; if(peeking) peekPanel(false); swipe=null; dragging=false; });
function handleTap(){                                           // two taps within DOUBLE_MS toggle the panel (touch)
  const now=Date.now();
  if(now-lastTap < DOUBLE_MS){ lastTap=0; togglePanel(); } else lastTap=now;
}
canvas.addEventListener('pointermove',e=>{
  if(swipe){
    if(peeking) return;                                        // mid-peek: hold still to look, ignore motion
    const dx=e.clientX-swipe.sx, dy=e.clientY-swipe.sy;
    if(!swipe.axis){ if(Math.hypot(dx,dy)<SWIPE_DEAD) return;
      swipe.axis = Math.abs(dx)>Math.abs(dy) ? 'x' : 'y'; clearTimeout(holdTimer); holdTimer=0; }   // a swipe, not a hold
    if(swipe.axis==='x'){                                      // scrub time of day live (~70% of the screen = a full day)
      params.time_of_day = clamp(params.time_of_day + (e.clientX-px)*((19-5)/(window.innerWidth*0.7)), 5, 19);
      updateSunFromTime(); syncControl('time_of_day');
    }
    px=e.clientX; py=e.clientY; return;                        // vertical is committed on release
  }
  if(!dragging) return;
  params.sun_azimuth_deg = (params.sun_azimuth_deg + (e.clientX-px)*0.3 + 360)%360;
  params.sun_elevation_deg = clamp(params.sun_elevation_deg - (e.clientY-py)*0.3, 4, 90);
  px=e.clientX; py=e.clientY; syncControl('sun_azimuth_deg'); syncControl('sun_elevation_deg');
});
// on a touch device the keyboard / drag hints don't apply — show the swipe + panel gestures instead
if(coarse)
  hint.innerHTML = 'swipe <b>↕</b> scenes · <b>↔</b> time · <b>double-tap</b> panel · <b>hold</b> peek';
// ---- arrow-key scene stepping: prev/next preset with a cloud-bloom transition (spec §9). The dropdown
// selection (presetSel.value) is the single source of truth for the stepping origin — save/delete/paste/
// change all keep it current — so the arrows always step from the look the dropdown shows. ----
function presetNames(){ return [...Object.keys(PRESETS), ...Object.keys(getStored())]; }   // dropdown order
function stepPreset(dir){
  const names=presetNames(); if(!names.length) return;
  let i=names.indexOf(presetSel.value); if(i<0) i=0;
  const name = names[(i+dir+names.length)%names.length];                    // wrap at the ends
  eng.transitionTo(getPreset(name), { duration:transDur,
    onEnd:()=>{ refreshPresetSelect(name); syncAllControls(); } });         // morph from the current live look to the target
  refreshPresetSelect(name);                                               // reflect target in the dropdown = next step's origin
}

// T = toggle the 3D tree-grove preview inset (independent of the dev panel)
let showTree=false;
window.addEventListener('keydown',e=>{
  const k=e.key;
  if(k==='d'||k==='D'){ dev.classList.toggle('hidden'); return; }
  if(k==='t'||k==='T'){ showTree=!showTree; document.getElementById('hint').style.display = showTree?'none':''; return; }
  if(k==='f'||k==='F'){                                                     // toggle browser fullscreen (webkit fallback for Safari)
    const el=document.documentElement, fsEl=document.fullscreenElement||document.webkitFullscreenElement;
    if(fsEl){ (document.exitFullscreen||document.webkitExitFullscreen).call(document); }
    else { const p=(el.requestFullscreen||el.webkitRequestFullscreen).call(el); if(p?.catch) p.catch(()=>{}); }
    return;
  }
  if(k==='ArrowLeft'||k==='ArrowRight'||k==='ArrowUp'||k==='ArrowDown'){
    const tag=(document.activeElement?.tagName)||'';
    if(tag==='INPUT'||tag==='SELECT') return;                               // let a focused panel control use the arrows
    e.preventDefault();
    stepPreset((k==='ArrowRight'||k==='ArrowDown') ? 1 : -1);
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
  if(params.drift_auto) syncControl('drift_phase');
  if(params.show_source && !dev.classList.contains('hidden')) eng.drawSourceInset();
  if(showTree) eng.drawTreeInset(treePointer, treePinned);
  const cmpOpen = cmp.classList.contains('show');
  // profiler breakdown: the live whole-frame fps at full quality — the honest 'is it holding 60' number the
  // misleading offscreen 'headroom' used to obscure. (The A/B picker shows each engine's fps separately.)
  if(profFpsEl) profFpsEl.textContent = fpsLabel(eng.fps);
  if(cmpOpen) updateCmpFps();
  // HUD: debug info, shown only while the dev panel is open AND not in the A/B (which has its own per-engine fps).
  const devOpen = !dev.classList.contains('hidden');
  hud.style.display = (devOpen && !cmpOpen) ? '' : 'none';
  if(!devOpen || cmpOpen) return;
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

// ===========================================================================
// Auto-profiler (spec §9). Measure the look's cost from REAL on-screen frames — GPU timer queries averaged over
// many live frames, the actual passes under real conditions (not an offscreen burst the driver can collapse) —
// ablate each axis to read its share, then propose lighter variants and A/B them on a draggable wipe. Runs at
// MAX quality with auto-quality held off. Editor-only; the engine (eng.profiler) only measures.
// ===========================================================================
const MEASURE_FRAMES = 90, MEASURE_SETTLE = 12;   // per config: drop the first SETTLE (config change + 2-frame timer ring), average the rest (~1.5s)
let profiling = false;
const animates = () => params.wind_strength>0 || (params.drift_auto && params.drift_amount>0);
const snapshot = () => JSON.parse(JSON.stringify(params));
const nextFrame = () => new Promise(r => requestAnimationFrame(r));

// profiler-mode quality: the cost of each STYLISTIC decision at MAX quality, so while the profiler is open we
// hold the engine at full resolution + full samples with the auto-scaler OFF (it would mask the params —
// regenSource reads perf.sampleCount when auto is on — and re-trim under load). exitProfilerQuality (from
// closeProfile) restores it from the look's own auto_quality flag.
// hold MAX quality with the auto-scaler off: full resolution, full samples, AND full bake res (auto_quality now
// also trims bake below the knee, §9 — so a trimmed bake must be restored or the base cost reads low). apply('textures')
// reallocates the layer textures to baseline (auto off → bakeRes() = baseline); apply('source') restores the sample cloud.
function enterProfilerQuality(){ perf.auto = false; perf.resScale = 1; perf.sampleCount = params.sample_count; eng.apply('textures'); eng.apply('source'); }
function exitProfilerQuality(){ eng.apply('perf'); }

// the in-situ per-pass GPU cost of the CURRENT config: average the engine's timer-query ms over MEASURE_FRAMES
// real frames (high quality, real conditions). Falls back to the offscreen stress burst only where timer queries
// don't exist (Firefox/Safari) — coarser, flagged in the UI. bake counts only when the look re-bakes every frame.
async function measureCost(){
  if(eng.profiler.hasTimer){
    let tSum=0,tN=0,bSum=0,bN=0;
    for(let i=0;i<MEASURE_FRAMES;i++){
      await nextFrame();
      if(i<MEASURE_SETTLE) continue;
      const t=eng.profiler.transportMs, b=eng.profiler.bakeMs;
      if(t>0){ tSum+=t; tN++; }
      if(animates() && b>0){ bSum+=b; bN++; }
    }
    return { transportMs: tN?tSum/tN:0, bakeMs: bN?bSum/bN:0, approx:false };
  }
  const t = eng.profiler.bench('transport', 60).ms, b = animates() ? eng.profiler.bench('bake', 60).ms : 0;
  return { transportMs:t, bakeMs:b, approx:true };
}

// adaptive_motion's saving is temporal, not a per-pass ablation: sample the look's motion over the window and
// report the fraction of frame cost the idle cadence would skip (idle-frame share × the part it doesn't render).
async function measureAdaptiveFrac(){
  if(!eng.isLowMotion) return 0;
  let low=0, m=0;
  for(let i=0;i<MEASURE_FRAMES;i++){ await nextFrame(); if(i<MEASURE_SETTLE) continue; if(eng.isLowMotion()) low++; m++; }
  const idleFraction = m ? low/m : 0;
  const skipShare = 1 - clamp(params.adaptive_idle_fps,1,60)/60;   // of an idle frame's heavy work, the part re-presented not rendered
  return idleFraction * skipShare;
}

async function runProfile(){
  if(profiling || !eng.profiler) return;
  profiling = true;
  if(eng.profiler.hasTimer) eng.profiler.setInstrument(true);
  const snap = snapshot();
  enterProfilerQuality();
  showMeasuring('base');
  const base = await measureCost();
  const baseTotal = base.transportMs + base.bakeMs;
  const hasSpare = baseTotal < FRAME_BUDGET_MS;                  // only chase quality upgrades when there's budget to spend
  const passCost = (axis, after) => {                           // reuse the baseline for the pass this axis DOESN'T touch (noise isolation)
    const t = (axis.pass==='transport'||axis.pass==='both') ? after.transportMs : base.transportMs;
    const b = (axis.pass==='bake'||axis.pass==='both') ? after.bakeMs : base.bakeMs;
    return t + b;
  };
  const rows = [];             // per-feature CUT share — the breakdown bars + lighter variants
  const upCostsMs = {};        // per-axis measured ADDED ms — the 'improve' (spend-the-spare) direction
  let n = 0;
  for(const axis of AXES){
    n++;
    if(axis.measure==='skipfrac'){                              // adaptive: temporal skip fraction, sampled (no ablation)
      showMeasuring(`${axis.label}  (${n}/${AXES.length})`);
      rows.push({ axis, frac: await measureAdaptiveFrac() });
      continue;
    }
    // --- cut: lighten this axis, read the saving (axisValue resolves levels/rel/follows/toggle) ---
    const cutVal = axis.proposable ? axisValue(axis, params)
                 : (axis.measureLevel!=null && axis.measureLevel < params[axis.key]) ? axis.measureLevel : null;
    if(cutVal==null){ rows.push({ axis, frac:0, na:true }); }
    else {
      showMeasuring(`${axis.label}  (${n}/${AXES.length})`);
      const orig = params[axis.key];
      params[axis.key] = cutVal; eng.apply(axis.scope);
      const after = await measureCost();
      rows.push({ axis, frac: baseTotal>0 ? Math.max(0, baseTotal-passCost(axis,after))/baseTotal : 0 });
      params[axis.key] = orig; eng.apply(axis.scope);            // restore this axis (engine stays at profiler quality)
    }
    // --- upgrade: push this quality axis richer, read the ADDED ms (only worth measuring with spare to spend) ---
    const upVal = hasSpare ? upValue(axis, params) : null;
    if(upVal!=null){
      showMeasuring(`${axis.label} ↑  (${n}/${AXES.length})`);
      const orig = params[axis.key];
      params[axis.key] = upVal; eng.apply(axis.scope);
      const after = await measureCost();
      upCostsMs[axis.key] = Math.max(0, passCost(axis,after) - baseTotal);
      params[axis.key] = orig; eng.apply(axis.scope);
    }
  }
  profiling = false;                                            // params are back to snap; auto stays off until closeProfile
  const costs = Object.fromEntries(rows.filter(r=>!r.na).map(r => [r.axis.key, r.frac]));
  const improve = proposeImprove(snap, upCostsMs, FRAME_BUDGET_MS - baseTotal);
  showBreakdown(base, rows, proposeVariants(snap, costs), improve, snap);
}

// ---- level 1: the cost breakdown overlay ----
const prof = document.getElementById('prof');
let profFpsEl = null;                                           // live whole-frame fps element; null when the breakdown is closed
const fpsLabel = (fps) => `${fps.toFixed(0)} fps${fps>0&&fps<58 ? ' · over budget at full quality' : ''}`;
function showMeasuring(what){
  prof.innerHTML = `<h3>profiling</h3><div class="row">measuring <b style="color:#cbe6a8">${what}</b> …</div>`
    + `<div class="row" style="color:#7a8a7a">averaging real frames at full quality — a few seconds.</div>`;
  prof.classList.add('show'); profFpsEl = null;
}
function showBreakdown(base, rows, variants, improve, snap){
  const ms = v => `${v.toFixed(2)} ms`, total = base.transportMs + base.bakeMs;
  const spare = FRAME_BUDGET_MS - total;   // honest budget headroom at full quality — what the 'improve' direction can spend
  // per-pass GPU cost is from real on-screen frames (in-situ timer queries) where available; the live FRAME RATE
  // below it is the honest whole-frame truth the old offscreen 'headroom ×' obscured — at full quality, < 60 means
  // the real frame is over budget (exactly what makes auto-quality trim), which a 'plenty of headroom' burst hid.
  let html = `<h3>frame cost <span style="color:#7a8a7a">${base.approx?'(approx — no timer queries)':'(in-situ)'}</span></h3>`;
  html += `<div class="row"><span class="k">transport</span><span class="v">${ms(base.transportMs)}</span></div>`;
  html += `<div class="row"><span class="k">bake (wind)</span><span class="v">${base.bakeMs>0?ms(base.bakeMs):'—'}</span></div>`;
  html += `<div class="row"><span class="k">frame rate</span><span class="v" id="prof-fps">…</span></div>`;
  html += `<div class="row"><span class="k">spare budget</span><span class="v">${spare>=0?ms(spare):`over by ${ms(-spare)}`}</span></div>`;
  if(base.bakeMs > base.transportMs*0.5)
    html += `<div class="warn">bake is ${Math.round(100*base.bakeMs/Math.max(total,1e-3))}% of the frame — auto-quality can't trim it. Lighten texture res / foliage for weak hardware.</div>`;
  html += `<h3>per feature</h3>`;
  const sorted = rows.slice().sort((a,b)=>b.frac-a.frac);
  const max = Math.max(...sorted.map(r=>r.frac), 1e-3);
  for(const r of sorted){
    const tag = r.na ? ' · already min' : r.axis.cls==='style' ? ' · style, measure only'
              : r.axis.cls==='risky' ? ' · risky' : r.axis.cls==='tune' ? ' · opt-in' : '';
    html += `<div class="row"><span class="k">${r.axis.label}${tag}</span><span class="v">${r.na?'—':`${Math.round(100*r.frac)}%`}</span></div>`;
    html += `<div class="bar"><i style="width:${(100*r.frac/max).toFixed(1)}%"></i></div>`;
  }
  const canCompare = variants.some(v=>v.applied.length>0);
  const canImprove = improve && improve.applied.length>0;
  html += `<div class="row" style="margin-top:10px">`
       + (canCompare ? `<button id="prof-compare">lighten ▸</button> ` : ``)
       + (canImprove ? `<button id="prof-improve">improve ▸</button> ` : ``)
       + `<button id="prof-close">close</button></div>`;
  prof.innerHTML = html; prof.classList.add('show');
  profFpsEl = document.getElementById('prof-fps');
  document.getElementById('prof-close').onclick = closeProfile;
  if(canCompare) document.getElementById('prof-compare').onclick = ()=>showVariants(variants, snap);
  if(canImprove) document.getElementById('prof-improve').onclick = ()=>showVariants([improve], snap);   // the single richer variant, same A/B wipe
}
function closeProfile(){ prof.classList.remove('show'); profFpsEl=null; if(eng.profiler.hasTimer) eng.profiler.setInstrument(false); exitProfilerQuality(); }

// ---- level 2: the A/B wipe. A second engine on its own stacked canvas, revealed left of a draggable divider;
// its wind is mirrored EXACTLY from the main look (setMotionSource) so only the quality differs across the seam.
// The engine + its canvas are created per comparison and DISPOSED on close, so the editor holds no second GL
// context whenever you're not actively comparing. ----
let cmpEng=null, cmpCanvasEl=null, cmpVariants=null, cmpIdx=0, cmpX=0.5;
const cmp=document.getElementById('cmp'), cmpBar=document.getElementById('cmpBar'), cmpInfo=document.getElementById('cmpInfo');
const cmpFps=document.getElementById('cmpFps'), cmpFpsV=document.getElementById('cmpFpsV'), cmpFpsM=document.getElementById('cmpFpsM');
// per-engine fps: the variant (left of the wipe) vs the current look (right). With vsync both read ~60 while the
// GPU keeps up; the variant only pulls ahead once the full look can't hold the refresh — exactly the weak-hw case.
function updateCmpFps(){ if(!cmpEng) return;
  cmpFpsV.textContent=`variant  ${cmpEng.fps.toFixed(0)} fps`; cmpFpsM.textContent=`current  ${eng.fps.toFixed(0)} fps`; }
function setClip(){ if(!cmpCanvasEl) return; const w=window.innerWidth; cmpBar.style.left=`${cmpX*w}px`;
  cmpCanvasEl.style.clipPath=`inset(0 ${((1-cmpX)*100).toFixed(2)}% 0 0)`; }
function showVariants(variants, _snap){
  cmpVariants=variants; cmpIdx=0; cmpX=0.5;
  cmp.classList.add('show'); cmpInfo.style.display='flex'; cmpFps.classList.add('show');
  cmpCanvasEl = document.createElement('canvas'); cmpCanvasEl.id='cmpCanvas'; cmp.insertBefore(cmpCanvasEl, cmpBar);   // fresh, disposable canvas (CSS #cmpCanvas fills + positions it)
  try { cmpEng = create(cmpCanvasEl, { params: variants[0].params }); }
  catch(e){ alert(`A/B unavailable: ${e.message}`); closeCmp(); return; }
  setClip();
  cmpEng.setMotionSource(eng);                                         // mirror the main look's wind EXACTLY (same skeleton)
  loadVariant(0);
}
function loadVariant(i){
  cmpIdx=i; const v=cmpVariants[i];
  cmpEng.setParams(v.params);
  cmpEng.perf.auto=false; cmpEng.perf.resScale=1;               // show the variant at MAX resolution too (profiler mode)
  const cuts = v.applied.length ? v.applied.map(s=>`${s.label} → ${fmt(s.value)}`).join(' · ') : 'no change available';
  const badge = (vv) => vv.estReduction!=null ? `−${Math.round(vv.estReduction*100)}%` : `+${vv.estAddedCost.toFixed(1)}ms`;   // cut vs. improve
  cmpInfo.innerHTML =
    cmpVariants.map((vv,j)=>`<span class="pill ${j===i?'on':''}" data-i="${j}">${vv.name} ${badge(vv)}</span>`).join('')
    + `<span class="cuts">${cuts}</span><button id="cmpSave">save ★</button><button id="cmpClose">done</button>`;
  for(const p of cmpInfo.querySelectorAll('.pill')) p.onclick=()=>loadVariant(+p.dataset.i);
  document.getElementById('cmpSave').onclick=saveVariant;
  document.getElementById('cmpClose').onclick=closeCmp;
}
function saveVariant(){
  const v=cmpVariants[cmpIdx];
  const name=(prompt('Save variant as:', `${presetSel.value} · ${v.name}`)||'').trim();
  if(!name) return;
  const s=getStored(); s[name]=JSON.parse(JSON.stringify(v.params)); setStored(s); refreshPresetSelect(name);
  closeCmp();
}
function closeCmp(){ cmp.classList.remove('show'); cmpInfo.style.display='none'; cmpFps.classList.remove('show');
  if(cmpEng){ cmpEng.dispose(); cmpEng=null; }                        // free the whole second GL context, not just pause it
  if(cmpCanvasEl){ cmpCanvasEl.remove(); cmpCanvasEl=null; } }
cmpBar.addEventListener('pointerdown',e=>{ cmpBar.setPointerCapture(e.pointerId);
  const move=ev=>{ cmpX=Math.max(0,Math.min(1,ev.clientX/window.innerWidth)); setClip(); };
  const up=()=>{ window.removeEventListener('pointermove',move); window.removeEventListener('pointerup',up); };
  window.addEventListener('pointermove',move); window.addEventListener('pointerup',up); });
window.addEventListener('resize', ()=>{ if(cmp.classList.contains('show')) setClip(); });

// ---- transition fade: its own row at the very bottom of the panel ----
(()=> {
  const h=document.createElement('h2'); h.textContent='Transition'; h.dataset.tipKey='fade'; dev.appendChild(h);
  const r=document.createElement('div'); r.className='ctl'; r.dataset.tipKey='fade';
  const lab=document.createElement('label'); lab.textContent='fade (s)';
  const inp=document.createElement('input'); inp.type='range'; inp.min=0; inp.max=6; inp.step=0.1; inp.value=transDur;
  const val=document.createElement('span'); val.className='val'; val.textContent=transDur.toFixed(1);
  inp.addEventListener('input',()=>{ transDur=parseFloat(inp.value); val.textContent=transDur.toFixed(1); });
  r.append(lab,inp,val); dev.appendChild(r);
})();

// ===========================================================================
// Welcome gate — the page opens on a faint 'memories' background (the §1 north-
// star look) under an intro overlay. "feel" un-dims the canvas and cloud-bloom
// crossfades to the editor's default look. On desktop the dev panel then slides
// in (D toggles it thereafter); on TOUCH it stays hidden — the art stands alone
// until a double-tap brings it up (press-and-hold peeks; spec §9).
// ===========================================================================
(()=> {
  const welcome=document.getElementById('welcome'), feel=document.getElementById('feel');
  let started=false;
  function arrive(){ if(coarse) hint.classList.remove('gone'); else slideInPanel(); }  // touch waits for a double-tap
  feel.addEventListener('click',()=>{
    if(started) return; started=true;
    document.body.classList.remove('intro');        // un-dim the canvas to full strength
    welcome.classList.add('out');                   // dissolve the intro text
    setTimeout(()=>{ welcome.style.display='none'; }, 1000);
    eng.transitionTo(getPreset(DEFAULT_PRESET), { duration:4,           // memories → editor default (spec §9)
      onEnd:()=>{ refreshPresetSelect(DEFAULT_PRESET); syncAllControls(); setTimeout(arrive,300); } });
    setTimeout(()=>{ refreshPresetSelect(DEFAULT_PRESET); syncAllControls(); arrive(); }, 5500);  // fallback if onEnd never fires
  });
})();

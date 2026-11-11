// Focused sessions acceptance: editor surfaces/saves, and real WebGL endpoints. Not the pixel suite.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { chromium } from 'playwright';

const root=resolve(import.meta.dirname,'..');
let accountChecks=0;
const server=createServer(async(req,res)=>{
  const pathname=new URL(req.url,'http://local').pathname.replace(/^\/editor\//,'/');
  if(pathname==='/api/health'){res.setHeader('content-type','application/json');res.end(JSON.stringify({ok:true,engine:'session-test'}));return;}
  if(pathname==='/api/me'){accountChecks++;res.writeHead(401,{'content-type':'application/json'}).end(JSON.stringify({error:'sign in'}));return;}
  if(pathname==='/__sessions'){res.setHeader('content-type','text/html');res.end('<canvas width="96" height="64" style="width:96px;height:64px"></canvas>');return;}
  const file=resolve(root,`.${pathname==='/'?'/index.html':pathname}`);
  if(!file.startsWith(`${root}/`)){res.writeHead(403).end();return;}
  try{res.setHeader('content-type',({'.js':'text/javascript','.html':'text/html','.css':'text/css'})[extname(file)]??'application/octet-stream');res.end(await readFile(file));}catch{res.writeHead(404).end();}
});
await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const errors=[];
const page=await browser.newPage({viewport:{width:640,height:480}});
page.setDefaultTimeout(60000);
page.on('pageerror',error=>errors.push(error.message));
const output=resolve(root,'test-gl/out/review/2026-11-11-sessions');
await mkdir(output,{recursive:true});
try{
  await page.goto(`${origin}/__sessions`);
  const endpoints=await page.evaluate(async()=>{
    const api=await import('/komorebi.js');
    const {PRESETS}=await import('/presets.js');
    const canvas=document.querySelector('canvas');
    let next,now=performance.now();
    const originalRAF=window.requestAnimationFrame;window.requestAnimationFrame=cb=>{next=cb;};
    const look={...api.DEFAULTS,tree_count:1,branch_levels:1,branch_children:1,limb_count:1,leaves_per_cluster:3,foliage_density:0.3,
      wind_strength:0,drift_auto:false,drift_amount:0,layer_count:3};
    const session={quality:'compact',presentation:'projector',playback:{adaptive_motion:false,auto_quality:false}};
    const engine=api.create(canvas,{params:look,session});
    const step=()=>{now+=1000/60;next(now);};step();
    const target={...look,exposure:2,sample_count:48};
    engine.transitionTo(target,{duration:0.1});
    engine.setSession({...session,quality:'balanced'});
    for(let i=0;i<100&&engine.trans.active;i++)step();step();
    const read=e=>{const pixels=new Uint8Array(96*64*4);e.gl.readPixels(0,0,96,64,e.gl.RGBA,e.gl.UNSIGNED_BYTE,pixels);return pixels;};
    const arrived=read(engine),effective={...engine.params},authored=engine.authored;
    engine.setParams(target);step();
    const native=read(engine);
    const mismatches=arrived.reduce((n,v,i)=>n+(v!==native[i]),0);
    const quality=effective.sample_count;
    const layers=effective.layer_count;
    const representative={...PRESETS['afternoon 5'],wind_strength:0,drift_auto:false,drift_amount:0};
    engine.setParams(representative);
    engine.setSession({...session,presentation:'screen'});step();const screen=read(engine),screenImage=canvas.toDataURL('image/png');
    engine.setSession(session);step();const projector=read(engine),projectorImage=canvas.toDataURL('image/png');
    const diff=screen.reduce((n,v,i)=>n+Math.abs(v-projector[i]),0)/screen.length;
    engine.dispose();
    const autoCanvas=document.createElement('canvas');autoCanvas.style.cssText='width:96px;height:64px';document.body.append(autoCanvas);
    const automatic={ceilings:{sample_count:3,tex_resolution:256,bake_resolution:256},playback:{auto_quality:false}};
    const autoEngine=api.create(autoCanvas,{params:look,session:automatic});now=performance.now();
    const slowStep=()=>{now+=25;next(now);};
    for(let i=0;i<399;i++)slowStep();const before=autoEngine.params.adaptive_motion;
    slowStep();const after=autoEngine.params.adaptive_motion,startupFps=autoEngine.session.startupFps;
    autoEngine.setSession({...automatic,playback:{auto_quality:false,adaptive_motion:false}});
    autoEngine.setParams({...look,adaptive_motion:true});slowStep();
    const automaticFps={simulatedCadence:40,before,after,startupFps,manualOff:autoEngine.params.adaptive_motion,authoredRuntime:Object.hasOwn(autoEngine.authored,'adaptive_motion')};
    autoEngine.dispose();autoCanvas.remove();window.requestAnimationFrame=originalRAF;
    return {mismatches,quality,layers,authoredSample:authored.sample_count,meanAbsoluteDifference:diff,
      presentationLook:representative,screenImage,projectorImage,automaticFps};
  });
  assert.equal(endpoints.mismatches,0,'arrival agrees with a native load under the same session');
  assert.equal(endpoints.quality,32);assert.equal(endpoints.authoredSample,48);assert.equal(endpoints.layers,3);
  assert.equal(endpoints.automaticFps.before,false);assert.equal(endpoints.automaticFps.after,true);
  assert.equal(endpoints.automaticFps.manualOff,false);assert.equal(endpoints.automaticFps.authoredRuntime,false);
  for(const name of ['screen','projector']){
    await writeFile(resolve(output,`${name}.png`),Buffer.from(endpoints[`${name}Image`].split(',')[1],'base64'));
    delete endpoints[`${name}Image`];
  }
  console.log('WebGL session arrival:',JSON.stringify({mismatches:endpoints.mismatches,quality:endpoints.quality,layers:endpoints.layers,automaticFps:endpoints.automaticFps}));
  await page.addInitScript(()=>{
    if(localStorage.getItem('session-test-initialized'))return;
    const look={tree_count:1,branch_levels:1,branch_children:1,limb_count:1,leaves_per_cluster:3,foliage_density:0.1,layer_count:3,adaptive_motion:true};
    localStorage.setItem('komorebi.presets',JSON.stringify({'session A':look,'session B':{...look,exposure:2}}));
    localStorage.setItem('komorebi.editor',JSON.stringify({mode:'min',selected:{local:'session A'},session:{version:1,quality:'compact'}}));
    localStorage.setItem('session-test-initialized','1');
  });
  await page.goto(`${origin}/index.html#feel`);
  console.log('editor loaded',page.url(),errors);
  await page.waitForFunction(()=>!document.body.classList.contains('intro'));
  const open=async(selector)=>{await page.$eval(selector,b=>b.click());await page.waitForSelector('#sessionSettings[open]');};
  const done=async()=>page.$eval('#sessionSettings > button',b=>b.click());
  await open('#strip [data-open-settings]');
  await page.selectOption('[data-setting="adaptive_motion"]','false');
  await page.selectOption('[data-setting="presentation"]','projector');
  await page.screenshot({path:resolve(output,'settings-desktop.png')});
  await done();
  await page.$eval('#dev .lookhead select',select=>{select.value='session B';select.dispatchEvent(new Event('change'));});
  const stored=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('komorebi.editor')).session);
  assert.equal((await stored()).playback.adaptive_motion,false);
  assert.equal(await page.$eval('#dev .look-chip',e=>e.textContent.includes('edited')),false,'settings do not edit the look');
  await page.reload();await page.$eval('#feel',button=>button.click());await page.waitForFunction(()=>!document.body.classList.contains('intro'));
  await open('#strip [data-open-settings]');
  assert.equal(await page.$eval('[data-setting="adaptive_motion"]',e=>e.value),'false');await done();
  for(const [mode,selector] of [['play','#play'],['adv','#dev']]){
    await page.evaluate(mode=>{const preferences=JSON.parse(localStorage.getItem('komorebi.editor'));preferences.mode=mode;localStorage.setItem('komorebi.editor',JSON.stringify(preferences));},mode);
    await page.reload();await page.$eval('#feel',button=>button.click());await page.waitForFunction(()=>!document.body.classList.contains('intro'));
    await page.waitForSelector(`${selector}:not(.hidden)`);
    await open(`${selector} [data-open-settings]`);await done();
  }
  await page.$eval('#dev .lookhead select',select=>{select.value='session B';select.dispatchEvent(new Event('change'));});
  await page.$eval('#dev [data-inherit="sample_count"]',button=>button.click());
  const save=async name=>{
    page.once('dialog',dialog=>dialog.accept(name));
    await page.$eval('#dev .lookacts button.main',button=>button.click());
    return page.evaluate(name=>JSON.parse(localStorage.getItem('komorebi.presets'))[name],name);
  };
  const inherited=await save('inherited');assert.ok(!Object.hasOwn(inherited,'sample_count'));assert.ok(!Object.hasOwn(inherited,'adaptive_motion'));
  await page.$eval('#dev [data-tip-key="sample_count"] input',input=>{input.value='48';input.dispatchEvent(new Event('input'));});
  const requested=await save('requested');assert.equal(requested.sample_count,48);assert.equal(requested.layer_count,3);
  await page.evaluate(()=>{
    const prefs=JSON.parse(localStorage.getItem('komorebi.editor')),look=JSON.parse(localStorage.getItem('komorebi.presets')).inherited;
    localStorage.setItem('komorebi.arboretum',JSON.stringify({v:1,me:null,origin:{},playlists:{7:{id:7,name:'projector',owner:'someone',presentation:'projector',items:[
      {name:'first',preset_id:1,params:look,dwell_s:1,crossfade_s:0.1},
      {name:'second',preset_id:2,params:{...look,exposure:3,adaptive_motion:true},dwell_s:1,crossfade_s:0.1}]}}}));
    prefs.playlist='arb:7';prefs.selected['arb:7']='0';delete prefs.session.presentation;
    localStorage.setItem('komorebi.editor',JSON.stringify(prefs));
  });
  await page.reload();await page.$eval('#feel',button=>button.click());
  await page.$eval('#dev .lookhead select',select=>{select.value='0';select.dispatchEvent(new Event('change'));});
  await open('#dev [data-open-settings]');
  assert.ok(await page.$eval('#sessionSettings',panel=>panel.textContent.includes('projector')));
  await page.selectOption('[data-setting="presentation"]','screen');await done();
  await page.$eval('#dev .playstop',button=>button.click());
  await page.waitForFunction(()=>document.querySelector('#dev .lookhead select').value==='1');
  assert.equal((await stored()).playback.adaptive_motion,false);
  assert.equal((await stored()).presentation,'screen');
  await page.$eval('#dev .playstop',button=>button.click());
  const touch=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true,userAgent:'Mozilla/5.0 (iPhone)'});
  touch.on('pageerror',error=>errors.push(error.message));
  await touch.goto(`${origin}/index.html#feel`);await touch.waitForFunction(()=>!document.body.classList.contains('intro'));
  await touch.$eval('#strip .tabs [data-open-settings]',button=>button.click());await touch.waitForSelector('#sessionSettings[open]');
  await touch.screenshot({path:resolve(output,'settings-phone.png')});
  assert.equal(await touch.$eval('[data-setting="adaptive_motion"]',e=>e.value),'profile');
  await touch.close();
  const accountPage=await browser.newPage({viewport:{width:480,height:360}});
  accountPage.on('pageerror',error=>errors.push(error.message));
  await accountPage.goto(`${origin}/editor/index.html#feel`);await accountPage.waitForFunction(()=>!document.body.classList.contains('intro'));
  assert.equal(accountChecks,0,'minimal mode does not initialize account checks');
  await accountPage.$eval('#strip [data-open-settings]',button=>button.click());
  await accountPage.waitForSelector('#sessionSettings .arb-cta');
  assert.ok(accountChecks>0,'opening Settings initializes account access');await accountPage.close();
  assert.deepEqual(errors,[]);
  await writeFile(resolve(output,'manifest.json'),JSON.stringify({endpoints,checks:['engine arrival','authored requests','desktop surfaces','touch','reload','save inheritance'],errors},null,2));
  console.log('Sessions editor acceptance: all checks passed');
}catch(error){console.error('page errors',errors);await page.screenshot({path:resolve(output,'failure.png')});throw error;}
finally{await browser.close();await new Promise(ok=>server.close(ok));}

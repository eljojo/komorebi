import { smoothstep } from './komorebi-math.js';
import { VS_FULL, FS_SCENE_MIX } from './komorebi-shaders.js';

// Two complete looks, including tone mapping, share the engine's context and clock.
// Only the outgoing scene is temporary: the incoming one remains the engine after landing.
export function makeSceneFade(hub, createScene){
  const { gl, canvas } = hub;
  let scene=null, outgoing=null, incoming=null, prog=null, uniforms=null;

  function target(){
    const tex=gl.createTexture(), fbo=gl.createFramebuffer();
    gl.bindTexture(gl.TEXTURE_2D,tex);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA8,canvas.width,canvas.height,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER,fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,tex,0);
    return {tex,fbo,w:canvas.width,h:canvas.height};
  }
  function free(t){ if(t){ gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fbo); } }
  function sized(t){
    if(t && t.w===canvas.width && t.h===canvas.height) return t;
    free(t); return target();
  }
  function mix(fbo, weight){
    gl.bindFramebuffer(gl.FRAMEBUFFER,fbo);
    gl.viewport(0,0,canvas.width,canvas.height);
    gl.disable(gl.BLEND);
    gl.useProgram(prog); gl.bindVertexArray(hub.emptyVAO);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,outgoing.tex); gl.uniform1i(uniforms.a,0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D,incoming.tex); gl.uniform1i(uniforms.b,1);
    gl.uniform1f(uniforms.w,weight); gl.drawArrays(gl.TRIANGLES,0,3);
  }
  function beginSceneFade(){
    if(outgoing){
      // An interrupted dissolve starts from the displayed mixture, without retaining a third moving scene.
      const held=target();
      mix(held.fbo,smoothstep(0,1,hub.trans.t));
      scene?.dispose(); scene=null; free(outgoing); outgoing=held;
    } else {
      scene=createScene(); outgoing=target();
      scene.draw(outgoing.fbo,outgoing.w,outgoing.h);
    }
    incoming=sized(incoming);
    if(!prog){
      prog=hub.program(VS_FULL,FS_SCENE_MIX);
      uniforms={a:gl.getUniformLocation(prog,'uOutgoing'),b:gl.getUniformLocation(prog,'uIncoming'),w:gl.getUniformLocation(prog,'uWeight')};
    }
  }
  function stepSceneFade(dt){ scene?.step(dt); }
  function drawSceneFade(){
    if(scene){ outgoing=sized(outgoing); scene.draw(outgoing.fbo,outgoing.w,outgoing.h); }
    incoming=sized(incoming);
    hub.drawFrameInto(incoming.fbo,incoming.w,incoming.h);
    mix(null,smoothstep(0,1,hub.trans.t));
  }
  function endSceneFade(){
    scene?.dispose(); scene=null;
    free(outgoing); free(incoming); outgoing=incoming=null;
    if(prog) gl.deleteProgram(prog); prog=null; uniforms=null;
  }
  return { beginSceneFade, stepSceneFade, drawSceneFade, endSceneFade };
}

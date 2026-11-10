/* One GPU pass: edge-aware smoothing, restrained sharpness and a neutral contrast lift. */
export function createDetailRenderer(plan){
 if(typeof OffscreenCanvas==='undefined')throw new Error('GPU canvas is unavailable.');
 const canvas=new OffscreenCanvas(plan.width,plan.height);
 const gl=canvas.getContext('webgl',{alpha:false,antialias:false,depth:false,stencil:false,preserveDrawingBuffer:true,powerPreference:'high-performance'});
 if(!gl)throw new Error('GPU rendering is unavailable.');
 const shader=(type,source)=>{const value=gl.createShader(type);gl.shaderSource(value,source);gl.compileShader(value);if(!gl.getShaderParameter(value,gl.COMPILE_STATUS))throw new Error('The detail shader is unavailable.');return value;};
 const vertex=shader(gl.VERTEX_SHADER,'attribute vec2 a_position; varying vec2 v_uv; void main(){v_uv=(a_position+1.0)*0.5;gl_Position=vec4(a_position,0.0,1.0);}');
 const fragment=shader(gl.FRAGMENT_SHADER,`precision mediump float;
 varying vec2 v_uv; uniform sampler2D u_image; uniform vec2 u_texel; uniform float u_denoise; uniform float u_sharp; uniform float u_contrast;
 void main(){
  vec3 c=texture2D(u_image,v_uv).rgb; vec3 sum=c*4.0; vec3 soft=c*4.0; float total=4.0;vec3 lo=c;vec3 hi=c;vec3 gx=vec3(0.0);vec3 gy=vec3(0.0);
  for(int y=-1;y<=1;y++){for(int x=-1;x<=1;x++){
   if(x==0&&y==0)continue;
   vec3 n=texture2D(u_image,v_uv+vec2(float(x),float(y))*u_texel).rgb;
   float spatial=(x==0||y==0)?1.0:0.5;float delta=dot(n-c,n-c);
   float w=spatial*exp(-delta/0.008);sum+=n*w;total+=w;soft+=n*spatial;lo=min(lo,n);hi=max(hi,n);gx+=n*float(x);gy+=n*float(y);
  }}
  vec3 base=mix(c,sum/total,clamp(u_denoise*0.6,0.0,0.8));
  vec3 detail=clamp(base-soft/10.0,vec3(-0.06),vec3(0.06));
  float coherence=sqrt(dot(gx,gx)+dot(gy,gy))/6.0;float edge=smoothstep(0.02,0.075,coherence);
  vec3 color=clamp(base+u_sharp*edge*detail,lo-0.008,hi+0.008);
  color=(color-0.5)*u_contrast+0.5;gl_FragColor=vec4(clamp(color,0.0,1.0),1.0);
 }`);
 const program=gl.createProgram();gl.attachShader(program,vertex);gl.attachShader(program,fragment);gl.linkProgram(program);
 if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error('The detail shader could not start.');
 gl.useProgram(program);const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),gl.STATIC_DRAW);
 const position=gl.getAttribLocation(program,'a_position');gl.enableVertexAttribArray(position);gl.vertexAttribPointer(position,2,gl.FLOAT,false,0,0);
 const texture=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,texture);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
 gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);gl.uniform2f(gl.getUniformLocation(program,'u_texel'),1/plan.width,1/plan.height);
 gl.uniform1f(gl.getUniformLocation(program,'u_denoise'),plan.denoise);gl.uniform1f(gl.getUniformLocation(program,'u_sharp'),plan.sharp);gl.uniform1f(gl.getUniformLocation(program,'u_contrast'),plan.contrast);
 gl.viewport(0,0,plan.width,plan.height);
 const staging=new OffscreenCanvas(plan.width,plan.height),ctx=staging.getContext('2d',{alpha:false});
 if(!ctx)throw new Error('The detail canvas could not start.');
 return {maxSize:Math.min(gl.getParameter(gl.MAX_TEXTURE_SIZE),gl.getParameter(gl.MAX_RENDERBUFFER_SIZE)),render(sample){
   if(gl.isContextLost())throw new Error('The graphics device ran out of resources. Try a smaller output.');
   sample.draw(ctx,0,0,plan.width,plan.height);
   gl.bindTexture(gl.TEXTURE_2D,texture);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,staging);gl.drawArrays(gl.TRIANGLE_STRIP,0,4);return canvas;
  },dispose(){gl.deleteTexture(texture);gl.deleteBuffer(buffer);gl.deleteProgram(program);gl.deleteShader(vertex);gl.deleteShader(fragment);gl.getExtension('WEBGL_lose_context')?.loseContext();staging.width=1;staging.height=1;canvas.width=1;canvas.height=1;}};
}

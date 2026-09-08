import { HalfFloatType,LinearFilter,Mesh,NoBlending,OrthographicCamera,PlaneGeometry,RepeatWrapping,Scene,ShaderMaterial,WebGLRenderTarget,type Object3D,type WebGLRenderer,type Texture } from 'three';
import { HOT_FIELD_AZIMUTHS,HOT_FIELD_RADII } from '../../universe/galaxy/hotFlowDynamics';
import { HOT_FLOW_SPECTRUM_GLSL,HOT_LOG_SHIFT_MAX,HOT_LOG_SHIFT_MIN,HOT_RESPONSE_SHIFTS } from './hotFlowSpectrum';

/** Bake local spectral interpolation once per material cell/frequency shift,
 * not at every ray segment of every output pixel. This is a material cache;
 * the Kerr trace and final image still use every native display pixel. */
export class HotFlowAtlas {
  readonly target=new WebGLRenderTarget(HOT_FIELD_AZIMUTHS,HOT_FIELD_RADII*HOT_RESPONSE_SHIFTS*2,{
    type:HalfFloatType,minFilter:LinearFilter,magFilter:LinearFilter,depthBuffer:false,
  });
  private readonly scene=new Scene();
  private readonly camera=new OrthographicCamera(-1,1,1,-1,0,1);
  private readonly quad:Mesh;
  private version=-1;

  constructor(inner:number,outer:number,local:Texture,state:Texture) {
    this.target.texture.wrapS=RepeatWrapping;
    const material=new ShaderMaterial({
      uniforms:{uInnerRenderRg:{value:inner},uOuterRg:{value:outer},uHotLocal:{value:local},uHotState:{value:state},
        uHotEmission:{value:null},uHotAbsorption:{value:null}},
      vertexShader:'void main(){gl_Position=vec4(position.xy,0.0,1.0);}',
      fragmentShader:/* glsl */ `
        uniform float uInnerRenderRg,uOuterRg;
        uniform highp sampler3D uHotLocal;
        uniform sampler2D uHotState,uHotEmission,uHotAbsorption;
        ${HOT_FLOW_SPECTRUM_GLSL}
        void main(){
          float row=mod(floor(gl_FragCoord.y),${HOT_FIELD_RADII}.0);
          float component=floor(gl_FragCoord.y/${HOT_FIELD_RADII*HOT_RESPONSE_SHIFTS}.0);
          float shift=mod(floor(gl_FragCoord.y/${HOT_FIELD_RADII}.0),${HOT_RESPONSE_SHIFTS}.0);
          float radial=(row+.5)/${HOT_FIELD_RADII}.0;
          vec4 state=texture2D(uHotState,vec2(gl_FragCoord.x/${HOT_FIELD_AZIMUTHS}.0,radial));
          float r=uInnerRenderRg*pow(uOuterRg/uInnerRenderRg,radial);
          float g=exp2(${HOT_LOG_SHIFT_MIN}.0+shift*${HOT_LOG_SHIFT_MAX-HOT_LOG_SHIFT_MIN}.0/${HOT_RESPONSE_SHIFTS-1}.0);
          gl_FragColor=localHotFlowComponentLog(r,g,state,component);
        }`,
      blending:NoBlending,depthTest:false,depthWrite:false,
    });
    this.quad=new Mesh(new PlaneGeometry(2,2),material);this.quad.frustumCulled=false;this.scene.add(this.quad);
  }

  prepare(prepareObject:(object:Object3D)=>Promise<unknown>):Promise<unknown> {return prepareObject(this.quad);}

  render(renderer:WebGLRenderer,version:number):void {
    if(version===this.version)return;
    const previous=renderer.getRenderTarget(),face=renderer.getActiveCubeFace(),level=renderer.getActiveMipmapLevel();
    try {
      renderer.setRenderTarget(this.target);renderer.render(this.scene,this.camera);this.version=version;
    } finally {renderer.setRenderTarget(previous,face,level);}
  }

  dispose():void {
    this.target.dispose();this.quad.geometry.dispose();(this.quad.material as ShaderMaterial).dispose();
  }
}

export const HOT_ATLAS_GLSL=/* glsl */ `
vec4 hotAtlasComponent(float radial,float azimuth,float g,float component) {
  if(g<0.015625)return vec4(0.0);
  float index=clamp((log2(g)-(${HOT_LOG_SHIFT_MIN}.0))/${HOT_LOG_SHIFT_MAX-HOT_LOG_SHIFT_MIN}.0,0.0,1.0)*${HOT_RESPONSE_SHIFTS-1}.0;
  float lo=min(floor(index),${HOT_RESPONSE_SHIFTS-2}.0),f=index-lo;
  float row=clamp(radial*${HOT_FIELD_RADII}.0,.5,${HOT_FIELD_RADII-.5});
  vec2 uv=vec2(azimuth,(lo*${HOT_FIELD_RADII}.0+row+component*${HOT_FIELD_RADII*HOT_RESPONSE_SHIFTS}.0)/${2*HOT_FIELD_RADII*HOT_RESPONSE_SHIFTS}.0);
  vec4 a=texture2D(uHotAtlas,uv);
  vec4 b=texture2D(uHotAtlas,uv+vec2(0.0,1.0/${2*HOT_RESPONSE_SHIFTS}.0));
  return exp2(mix(a,b,f));
}
vec4 hotAtlasLight(float radial,float azimuth,float g) {return hotAtlasComponent(radial,azimuth,g,0.0);}
vec3 hotAtlasAbsorption(float radial,float azimuth,float g) {return hotAtlasComponent(radial,azimuth,g,1.0).rgb;}

`;

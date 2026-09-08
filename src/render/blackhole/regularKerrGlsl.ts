import { REGULAR_STEP_ANGLE } from './regularKerr';

/** Same separated Kerr equations as regularKerr.ts. Integrating inverse
 * radius and an angular vector removes the pole and infinity coordinate
 * singularities. Every display pixel gets its own trajectory. */
export const REGULAR_KERR_GLSL = /* glsl */ `
#ifdef FINE_TRACE
const int REGULAR_MAX_STEPS=2048;
const int VOLUME_STEPS=1;
const float VOLUME_RADIAL_STEP=.08;
#else
const int REGULAR_MAX_STEPS=512;
const int VOLUME_STEPS=2;
const float VOLUME_RADIAL_STEP=.25;
#endif
vec4 regularAcceleration(vec4 x, float a2, float b2, float k, float eta) {
  float u = x.x;
  float angular = -(b2 + 2.0*a2*x.w*x.w);
  return vec4((a2-b2)*u + 3.0*k*u*u - 2.0*a2*eta*u*u*u,
    angular*x.yz, angular*x.w + a2*x.w);
}
float regularDrag(float u, float a, float xi) {
  return a*(2.0*u-a*xi*u*u)/(1.0-2.0*u+a*a*u*u);
}
vec3 rotatePole(vec3 q, float psi) {
  float c = cos(psi), s = sin(psi);
  return vec3(c*q.x-s*q.y, s*q.x+c*q.y, q.z);
}
vec3 traceRegularKerr(vec3 dir, out vec3 escapeDir, out bool escaped, out vec3 transmittance) {
  float a=uSpin, a2=a*a;
  vec3 cam=uCamRg;
  if(abs(cam.z)<1e-4)cam.z=1e-4;
  if(dot(cam.xy,cam.xy)<1e-8)cam.xy=vec2(1e-4,0.0);
  vec2 bl=blFromCartesian(cam,a);
  float r=bl.x, mu=bl.y, rho=sqrt(r*r+a2);
  float sinT=length(cam.xy)/rho;
  vec2 az=normalize(cam.xy);
  vec3 q=vec3(sinT*az,mu);
  vec3 rHat=normalize(vec3(r/rho*sinT*az,mu));
  vec3 tHat=normalize(vec3(rho*mu*az,-r*sinT));
  vec3 pHat=vec3(-az.y,az.x,0.0);
  vec3 n=normalize(vec3(dot(-dir,rHat),dot(-dir,tHat),dot(-dir,pHat)));
  vec4 photon=kerrPhoton(r,mu,sinT,a,n);
  float xi=photon.x, eta=photon.y, b2=xi*xi+eta;
  float k=(xi-a)*(xi-a)+eta;
  escaped=true;transmittance=vec3(1.0);escapeDir=dir;
  if(b2>LENSING_REACH*LENSING_REACH)return vec3(0.0);
  float sig=kerrSigma(r,mu,a),bigA=kerrBigA(r,mu,a);
  float energy=sqrt(max(sig*kerrDelta(r,a)/bigA,1e-12))
    +2.0*a*r*sinT*n.z/sqrt(sig*bigA);
  float south=sqrt(sig)*n.y/energy;
  float east=sqrt(bigA/sig)*n.z/energy;
  vec4 x=vec4(1.0/r,q);
  vec4 v=vec4(-photon.z/(r*r),south*vec3(mu*az,-sinT)+east*pHat);
  float psi=0.0, horizon=1.0/(uHorizonRg+.002);
  bool doomed=photon.z>0.0&&kerrCaptured(xi,eta,a);
  if(doomed&&uOuterRg<=0.0){escaped=false;return vec3(0.0);}
  float stepAngle=mix(.05,${REGULAR_STEP_ANGLE.toFixed(2)},smoothstep(.00005,.01,kerrCriticalMargin));
#ifdef FINE_TRACE
  stepAngle=.025;
#endif
  float stepSize=stepAngle/sqrt(max(b2+a2,1.0));
  vec3 accum=vec3(0.0);
  float heldDensity=1.0;int held=0;
  vec4 segmentX=x,segmentV=v;
  float segmentPsi=psi,segmentDs=0.0;int segmentSteps=0;
  for(int i=0;i<REGULAR_MAX_STEPS;i++){
    if(x.x>=horizon-1e-7){escaped=false;break;}
    if(x.x<1e-7&&v.x>0.0)break;
    if(doomed&&x.x>1.0/max(uInnerRenderRg,.001)){escaped=false;break;}
    float ds=-stepSize;
    // Resolve radiative transfer in log radius as well as angle.
    // This prevents radial bands in the foreground gas of captured rays.
    if(uOuterRg>0.0)ds=max(ds,-VOLUME_RADIAL_STEP*max(x.x,1.0/uOuterRg)/max(abs(v.x),1e-8));
    // Vary precision continuously: a binary polar threshold or resetting
    // volume batching at that threshold makes neighboring rays sample the
    // torus at different phases and draws artificial wedges around the jet.
    if(uJetEnabled>0.5 && uOuterRg>0.0) {
      float polar=smoothstep(.85,.98,abs(x.w));
      float radial=smoothstep(1.0/uOuterRg,1.25/uOuterRg,x.x)
        *(1.0-smoothstep(.9/uJetLaunch,1.0/uJetLaunch,x.x));
      ds=max(ds,-mix(stepAngle,.12,polar*radial)/sqrt(max(b2+a2,1.0)));
    }
    if(v.x>0.0)ds=max(ds,-.98*x.x/v.x);
    // Bound by the physical horizon, not the earlier capture cutoff.
    // Bounding by the cutoff needlessly approaches it asymptotically.
    if(v.x<0.0)ds=max(ds,-.3*(1.0/uHorizonRg-x.x)/(-v.x));
    vec4 k1=regularAcceleration(x,a2,b2,k,eta);
    vec4 x2=x+v*(.5*ds),v2=v+k1*(.5*ds);
    vec4 k2=regularAcceleration(x2,a2,b2,k,eta);
    vec4 x3=x+v2*(.5*ds),v3=v+k2*(.5*ds);
    vec4 k3=regularAcceleration(x3,a2,b2,k,eta);
    vec4 x4=x+v3*ds,v4=v+k3*ds;
    vec4 k4=regularAcceleration(x4,a2,b2,k,eta);
    vec4 before=x;
    x+=ds*(v+2.0*v2+2.0*v3+v4)/6.0;
    v+=ds*(k1+2.0*k2+2.0*k3+k4)/6.0;
    psi+=ds*(regularDrag(before.x,a,xi)+2.0*regularDrag(x2.x,a,xi)
      +2.0*regularDrag(x3.x,a,xi)+regularDrag(x4.x,a,xi))/6.0;
    // Geometry and radiative transfer have different error budgets.
    // Several geometric steps share one volume quadrature sample; every
    // pixel still follows its own ray at the original angular precision.
    segmentDs+=ds;segmentSteps++;
    bool inFlow=uOuterRg>0.0&&max(segmentX.x,x.x)>1.0/uOuterRg;
    bool last=x.x>=horizon-1e-7 || (x.x<1e-7&&v.x>0.0)
      || (doomed&&x.x>1.0/max(uInnerRenderRg,.001)) || i==REGULAR_MAX_STEPS-1;
    if(inFlow && (uAspect<=THICK_FLOW || segmentSteps>=VOLUME_STEPS || last)){
      float r0=1.0/max(segmentX.x,1e-8),r1=1.0/max(x.x,1e-8);
      float phi0=atan(segmentX.z,segmentX.y)+segmentPsi;
      float dphi=atan(segmentX.y*x.z-segmentX.z*x.y,dot(segmentX.yz,x.yz));
      float phi1=phi0+dphi+psi-segmentPsi;
      vec4 prev=vec4(r0,segmentX.w,-segmentV.x*r0*r0,segmentV.w);
      vec4 next=vec4(r1,x.w,-v.x*r1*r1,v.w);
      // Cubic Hermite dense output locates the midpoint on the curved
      // ray, rather than halfway between two radii in Cartesian space.
      vec4 middle=.5*(segmentX+x)+segmentDs*.125*(segmentV-v);
      vec4 middleVelocity=1.5*(x-segmentX)/segmentDs-.25*(segmentV+v);
      float middlePsi=.5*(segmentPsi+psi)+segmentDs*.125*(regularDrag(segmentX.x,a,xi)-regularDrag(x.x,a,xi));
      float middlePhi=phi0+atan(segmentX.y*middle.z-segmentX.z*middle.y,dot(segmentX.yz,middle.yz))+middlePsi-segmentPsi;
      float middleR=1.0/max(middle.x,1e-8);
      vec4 midpoint=vec4(middleR,middle.w,-middleVelocity.x*middleR*middleR,middleVelocity.w);
      held=0;
      if(flowSegment(prev,next,phi0,phi1,midpoint,middlePhi,segmentDs,a,xi,eta,accum,transmittance,heldDensity,held)){
        escaped=false;break;
      }
      segmentSteps=0;
    }
    if(!inFlow)segmentSteps=0;
    if(segmentSteps==0){segmentX=x;segmentV=v;segmentPsi=psi;segmentDs=0.0;}

  }
  if(doomed)escaped=false;
  escapeDir=normalize(rotatePole(x.yzw,psi));
  return accum;
}
`;

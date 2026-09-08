import { photonFromDirection } from '../../core/physics/kerr';
import { horizonRadiusRg } from '../../core/physics/blackHole';

export const REGULAR_STEP_ANGLE = 0.2;

/** Kerr geodesics in u=1/r and a unit angular vector q. The azimuth
 * carried by q contains Lz/sin²(theta); radial frame dragging is psi.
 * Neither ODE has a coordinate singularity at a pole or infinity.
 *
 * u''=(a²-b²)u+3Ku²-2a² eta u³
 * q''=-(b²+2a²qz²)q+a²qz ez
 * psi'=a(2u-a xi u²)/(1-2u+a²u²)
 *
 * Primes are Mino-time derivatives; b²=xi²+eta and K=(xi-a)²+eta.
 * This CPU implementation is the convergence oracle for the GPU path.
 */
export function regularKerrRay(
  radius: number, theta: number, direction: readonly [number, number, number],
  spin: number, stepAngle = REGULAR_STEP_ANGLE,
) {
  const mu = Math.cos(theta), sin = Math.sin(theta);
  const ray = photonFromDirection(radius, mu, spin, direction, sin);
  const a2 = spin*spin, b2 = ray.xi*ray.xi+ray.eta;
  const k = (ray.xi-spin)**2+ray.eta;
  const sig = radius*radius+a2*mu*mu;
  const big = (radius*radius+a2)**2-a2*(radius*radius-2*radius+a2)*sin*sin;
  const energy = Math.sqrt(sig*(radius*radius-2*radius+a2)/big)
    +2*spin*radius*sin*direction[2]/Math.sqrt(sig*big);
  const south = Math.sqrt(sig)*direction[1]/energy;
  const east = Math.sqrt(big/sig)*direction[2]/energy;
  // u, u', q.xyz, q'.xyz, psi
  let y = [1/radius, -ray.dr/(radius*radius), sin, 0, mu, south*mu, east, -south*sin, 0];
  const horizon = 1/(horizonRadiusRg(spin)+.002);
  function rates(s: number[]) {
    const [u,w,x,y,z,vx,vy,vz] = s;
    const angular = -(b2+2*a2*z*z);
    return [w, (a2-b2)*u+3*k*u*u-2*a2*ray.eta*u*u*u,
      vx,vy,vz,angular*x,angular*y,angular*z+a2*z,
      spin*(2*u-spin*ray.xi*u*u)/(1-2*u+a2*u*u)];
  }
  let steps = 0;
  for (; steps < 4096; steps++) {
    if (y[0] <= 0 || y[0] >= horizon) break;
    let h = -stepAngle/Math.sqrt(Math.max(b2+a2,1));
    // Approach infinity with a fractional final step. Limit inward
    // steps against the physical horizon, and stop at the capture cutoff.
    if (y[1]>0) h = Math.max(h, -.98*y[0]/y[1]);
    if (y[1]<0) h = Math.max(h, -.3*(1/horizonRadiusRg(spin)-y[0])/(-y[1]));
    if (y[0]<1e-8 && y[1]>0 || horizon-y[0]<1e-8) break;
    const k1=rates(y),k2=rates(y.map((v,i)=>v+h*k1[i]/2));
    const k3=rates(y.map((v,i)=>v+h*k2[i]/2)),k4=rates(y.map((v,i)=>v+h*k3[i]));
    y=y.map((v,i)=>v+h*(k1[i]+2*k2[i]+2*k3[i]+k4[i])/6);
  }
  const norm=Math.hypot(y[2],y[3],y[4]),c=Math.cos(y[8]),s=Math.sin(y[8]);
  return { captured: y[0]>.99*horizon, steps, direction:[(c*y[2]-s*y[3])/norm,(s*y[2]+c*y[3])/norm,y[4]/norm],
    radialError:y[1]*y[1]-(1+(a2-b2)*y[0]**2+2*k*y[0]**3-a2*ray.eta*y[0]**4),
    angularError:norm-1, ray };
}

import {
  BackSide,
  Color,
  Mesh,
  PMREMGenerator,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
  type Texture,
  type WebGLRenderTarget,
  type WebGLRenderer,
} from 'three';
import type { BiomeDef } from '../config/levels';

const SUN_DIR = new Vector3(-0.32, 1, 0.42).normalize();

/**
 * Bakes a small reflection/irradiance map per biome: the fog gradient all around, a bright
 * Snell's window overhead when there is open water or ice, and a soft glow towards the sun.
 * Gives glossy fish, wet rocks and crystals something to reflect.
 */
export class EnvironmentBaker {
  private readonly pmrem: PMREMGenerator;
  private readonly scene = new Scene();
  private readonly mat: ShaderMaterial;
  private target: WebGLRenderTarget | null = null;

  constructor(renderer: WebGLRenderer) {
    this.pmrem = new PMREMGenerator(renderer);
    this.mat = new ShaderMaterial({
      side: BackSide,
      depthWrite: false,
      uniforms: {
        uTop: { value: new Color() },
        uMid: { value: new Color() },
        uBottom: { value: new Color() },
        uWindow: { value: new Color() },
        uSun: { value: new Color() },
        uSunDir: { value: SUN_DIR },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uTop;
        uniform vec3 uMid;
        uniform vec3 uBottom;
        uniform vec3 uWindow;
        uniform vec3 uSun;
        uniform vec3 uSunDir;
        varying vec3 vDir;
        void main() {
          vec3 d = normalize(vDir);
          float t = d.y;
          vec3 c = t > 0.0
            ? mix(uMid, uTop, smoothstep(0.0, 0.7, t))
            : mix(uMid, uBottom, smoothstep(0.0, 0.5, -t));
          // Snell's window: the sky squeezed into a ~97 degree cone overhead.
          c += uWindow * smoothstep(0.62, 0.8, t);
          c += uSun * pow(max(dot(d, uSunDir), 0.0), 16.0);
          gl_FragColor = vec4(c, 1.0);
        }
      `,
    });
    this.scene.add(new Mesh(new SphereGeometry(10, 48, 24), this.mat));
  }

  bake(b: BiomeDef): Texture {
    const u = this.mat.uniforms;
    (u.uTop.value as Color).set(b.fog.top);
    (u.uMid.value as Color).set(b.fog.mid);
    (u.uBottom.value as Color).set(b.fog.bottom).multiplyScalar(0.6);
    const open = b.surface === 'water' || b.surface === 'ice';
    (u.uWindow.value as Color).set(b.sun.color).multiplyScalar(open ? b.sun.intensity * 3 : 0);
    (u.uSun.value as Color).set(b.sun.color).multiplyScalar(b.sun.intensity * (open ? 0.35 : 0.2));
    this.target?.dispose();
    this.target = this.pmrem.fromScene(this.scene, 0, 0.1, 50);
    return this.target.texture;
  }

  dispose(): void {
    this.target?.dispose();
    this.target = null;
    this.pmrem.dispose();
    this.mat.dispose();
  }
}

import {
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  OrthographicCamera,
  PlaneGeometry,
  RepeatWrapping,
  Scene,
  ShaderMaterial,
  WebGLRenderTarget,
  type Texture,
  type WebGLRenderer,
} from 'three';

const vertex = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

// Tileable water caustic (after Dave Hoskins / joltz0r), rendered to a small texture each frame.
const fragment = /* glsl */ `
#define TAU 6.28318530718
uniform float uTime;
uniform int uIter;
varying vec2 vUv;
void main() {
  float time = uTime * 0.5 + 23.0;
  vec2 p = mod(vUv * TAU, TAU) - 250.0;
  vec2 i = p;
  float c = 1.0;
  float inten = 0.005;
  for (int n = 0; n < 5; n++) {
    if (n >= uIter) break;
    float t = time * (1.0 - (3.5 / float(n + 1)));
    i = p + vec2(cos(t - i.x) + sin(t + i.y), sin(t - i.y) + cos(t + i.x));
    c += 1.0 / length(vec2(p.x / (sin(i.x + t) / inten), p.y / (cos(i.y + t) / inten)));
  }
  c /= float(uIter);
  c = 1.17 - pow(c, 1.4);
  float v = pow(abs(c), 8.0);
  v = clamp(v * 1.35, 0.0, 1.0);
  gl_FragColor = vec4(v, v, v, 1.0);
}
`;

/** Renders an animated, tileable caustics pattern into a mipmapped texture. */
export class CausticsGenerator {
  private readonly target: WebGLRenderTarget;
  private readonly scene = new Scene();
  private readonly camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly material: ShaderMaterial;
  private frame = 0;
  interval = 1;

  constructor(size = 512, iterations = 5) {
    this.target = new WebGLRenderTarget(size, size, {
      depthBuffer: false,
      generateMipmaps: true,
      minFilter: LinearMipmapLinearFilter,
      magFilter: LinearFilter,
      wrapS: RepeatWrapping,
      wrapT: RepeatWrapping,
    });
    this.material = new ShaderMaterial({
      vertexShader: vertex,
      fragmentShader: fragment,
      uniforms: { uTime: { value: 0 }, uIter: { value: iterations } },
      depthTest: false,
      depthWrite: false,
    });
    const quad = new Mesh(new PlaneGeometry(2, 2), this.material);
    quad.frustumCulled = false;
    this.scene.add(quad);
  }

  get texture(): Texture {
    return this.target.texture;
  }

  update(renderer: WebGLRenderer, time: number): void {
    if (this.frame++ % this.interval !== 0) return;
    this.material.uniforms.uTime.value = time;
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(this.target);
    renderer.render(this.scene, this.camera);
    renderer.setRenderTarget(prev);
  }

  dispose(): void {
    this.target.dispose();
    this.material.dispose();
  }
}

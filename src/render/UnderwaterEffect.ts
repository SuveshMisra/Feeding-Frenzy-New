import { Uniform, Vector2, Vector3 } from 'three';
import { BlendFunction, Effect } from 'postprocessing';

const fragment = /* glsl */ `
uniform float uTime;
uniform float uWobble;
uniform float uExposure;
uniform float uHurt;
uniform float uFrenzy;
uniform vec3 uTint;
uniform float uTintAmount;
uniform float uDark;
uniform vec2 uDarkCenter;
uniform float uDarkRadius;
uniform float uAspect;
uniform float uHeat;
uniform float uGold;
uniform float uContrast;
uniform float uSaturation;
uniform vec3 uShadowTint;

void mainUv(inout vec2 uv) {
  float t = uTime;
  vec2 w = vec2(
    sin(uv.y * 13.0 + t * 1.25) * 0.0011 + sin(uv.y * 29.0 - t * 2.3) * 0.0005,
    cos(uv.x * 11.0 + t * 1.05) * 0.0009 + cos(uv.x * 23.0 + t * 1.9) * 0.0004
  );
  uv += w * uWobble;
  // Heat shimmer: fast, fine ripples rising through the picture.
  uv += vec2(sin(uv.y * 46.0 - t * 7.0) * 0.0024, cos(uv.x * 34.0 + t * 5.0) * 0.0012) * uHeat;
}

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 c = inputColor.rgb * uExposure;
  // Grade in scene-linear light, before tone mapping: contrast around mid grey (in log
  // space, so highlights stay intact), saturation, and a tint pushed into the shadows.
  c = exp2((log2(max(c, vec3(1e-5))) - log2(0.18)) * uContrast + log2(0.18));
  float gLum = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = max(mix(vec3(gLum), c, uSaturation), 0.0);
  c *= mix(uShadowTint, vec3(1.0), smoothstep(0.0, 0.18, gLum));
  vec2 d = uv - 0.5;
  float edge = smoothstep(0.25, 0.85, length(d * vec2(1.2, 1.0)));
  c = mix(c, c * uTint * 1.6, uTintAmount * edge);
  float lum = dot(c, vec3(0.299, 0.587, 0.114));
  if (uDark > 0.001) {
    // Darkness outside the player's light; bright things (glowing fish) still show through.
    float r = length((uv - uDarkCenter) * vec2(uAspect, 1.0));
    float m = smoothstep(uDarkRadius * 0.45, uDarkRadius, r);
    float keep = smoothstep(0.35, 1.2, lum);
    c *= 1.0 - uDark * m * (1.0 - keep * 0.75);
  }
  c = mix(c, c * vec3(1.3, 0.85, 0.6) + vec3(0.05, 0.01, 0.0), uHeat * 0.4);
  c = mix(c, vec3(lum) * vec3(1.6, 0.25, 0.3) + c * 0.3, uHurt * edge * 0.75);
  c += vec3(1.0, 0.75, 0.25) * uFrenzy * edge * 0.18;
  c += vec3(1.0, 0.8, 0.3) * uGold * edge * (0.16 + 0.06 * sin(uTime * 6.0 + d.x * 12.0));
  c += vec3(1.0, 0.35, 0.05) * uHeat * edge * 0.2;
  outputColor = vec4(c, inputColor.a);
}
`;

/** Gentle underwater refraction wobble plus exposure, hurt, frenzy, darkness and heat looks. */
export class UnderwaterEffect extends Effect {
  constructor() {
    super('UnderwaterEffect', fragment, {
      blendFunction: BlendFunction.NORMAL,
      uniforms: new Map<string, Uniform>([
        ['uTime', new Uniform(0)],
        ['uWobble', new Uniform(1)],
        ['uExposure', new Uniform(1)],
        ['uHurt', new Uniform(0)],
        ['uFrenzy', new Uniform(0)],
        ['uTint', new Uniform(new Vector3(0.4, 0.8, 1))],
        ['uTintAmount', new Uniform(0.12)],
        ['uDark', new Uniform(0)],
        ['uDarkCenter', new Uniform(new Vector2(0.5, 0.5))],
        ['uDarkRadius', new Uniform(0.5)],
        ['uAspect', new Uniform(1)],
        ['uHeat', new Uniform(0)],
        ['uGold', new Uniform(0)],
        ['uContrast', new Uniform(1)],
        ['uSaturation', new Uniform(1)],
        ['uShadowTint', new Uniform(new Vector3(1, 1, 1))],
      ]),
    });
  }

  u(name: string): Uniform {
    return this.uniforms.get(name)!;
  }
}

uniform float uTime;
uniform vec3 uFogTop;
uniform vec3 uFogMid;
uniform vec3 uFogBottom;
uniform float uFogDensity;
uniform float uFogStart;
uniform float uFogDarken;
uniform float uSurfaceY;
uniform float uDeepLight;

vec3 ffFogColor(vec3 dir) {
  float t = dir.y;
  vec3 c = t > 0.0
    ? mix(uFogMid, uFogTop, smoothstep(0.0, 0.6, t))
    : mix(uFogMid, uFogBottom, smoothstep(0.0, 0.6, -t));
  return c * uFogDarken;
}

float ffFogFactor(vec3 wp) {
  float dist = length(wp - cameraPosition);
  float f = max(dist - uFogStart, 0.0) * uFogDensity;
  return clamp(1.0 - exp(-f * f), 0.0, 1.0);
}

vec3 ffFog(vec3 col, vec3 wp) {
  vec3 d = wp - cameraPosition;
  return mix(col, ffFogColor(normalize(d)), ffFogFactor(wp));
}

#ifdef FF_CAUSTICS
uniform sampler2D uCausticsTex;
uniform float uCausticsStrength;
uniform float uCausticsScale;
uniform vec3 uCausticsColor;

// Broad, slowly drifting light patches from surface waves focusing the sun (0..1).
float ffDapple(vec3 wp) {
  float t = uTime;
  float a = sin(wp.x * 0.21 + t * 0.35 + sin(wp.z * 0.17 - t * 0.2) * 1.5);
  float b = sin(wp.z * 0.19 - t * 0.28 + sin(wp.x * 0.13 + t * 0.25) * 1.5);
  float c = sin((wp.x + wp.z) * 0.11 - t * 0.17);
  return clamp(0.5 + a * b * 0.6 + c * 0.2, 0.0, 1.0);
}

float ffCausticsDepth(vec3 wp) {
  return exp(-max(uSurfaceY - wp.y, 0.0) * 0.022);
}

float ffCaustics(vec3 wp, vec3 n, float dapple) {
  float up = smoothstep(0.15, 0.85, n.y);
  vec2 top = wp.xz;
  vec2 side = vec2(wp.x + wp.z * 0.4, wp.y * 0.85 - wp.z * 0.2);
  vec2 uv = mix(side, top, up) * uCausticsScale;
  float c = texture2D(uCausticsTex, uv).r;
  float facing = clamp(n.y * 0.55 + 0.5, 0.0, 1.0);
  return c * facing * ffCausticsDepth(wp) * (0.5 + dapple * 1.5);
}
#endif

vec3 ffWater(vec3 col, vec3 albedo, vec3 wp, vec3 n) {
  float d01 = clamp(wp.y / uSurfaceY, 0.0, 1.0);
  col *= mix(uDeepLight, 1.0, d01);
  #ifdef FF_CAUSTICS
  float dapple = ffDapple(wp);
  float lit = smoothstep(0.2, 0.9, n.y) * ffCausticsDepth(wp) * min(uCausticsStrength, 1.5);
  col *= 1.0 + (dapple - 0.5) * 0.4 * lit;
  col += albedo * uCausticsColor * (ffCaustics(wp, n, dapple) * uCausticsStrength);
  #endif
  return col;
}

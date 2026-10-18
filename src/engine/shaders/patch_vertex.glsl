uniform float uTime;
varying vec3 vFFWorldPos;

#ifdef FF_FISH
attribute vec2 aSwim;
attribute vec4 aFx;
attribute vec2 aJaw;
uniform vec4 uSwim;
uniform vec3 uJawHinge;
varying vec4 vFx;
varying vec2 vJaw;
#ifdef FF_FINS
attribute float aFlap;
#endif

void ffFishDeform(inout vec3 p, inout vec3 n) {
  if (aJaw.x != 0.0 && aFx.x > 0.001) {
    float ang = -aFx.x * uJawHinge.z * aJaw.x;
    float c = cos(ang);
    float s = sin(ang);
    vec2 d = p.xy - uJawHinge.xy;
    p.xy = uJawHinge.xy + vec2(c * d.x - s * d.y, s * d.x + c * d.y);
    n.xy = vec2(c * n.x - s * n.y, s * n.x + c * n.y);
  }
  #ifdef FF_FINS
  if (aFlap > 0.0) {
    float f = sin(aSwim.x * 0.9 + 1.7) * aFlap;
    p += n * f * 0.04;
  }
  #endif
  float t = clamp(uSwim.z - p.x, 0.0, 1.35);
  float env = uSwim.w + t * t;
  float ph = aSwim.x - t * uSwim.y;
  float amp = uSwim.x * aSwim.y;
  p.z += sin(ph) * env * amp;
  float dzdt = -cos(ph) * uSwim.y * env + sin(ph) * 2.0 * t;
  float slope = -dzdt * amp;
  n = normalize(vec3(n.x - slope * n.z, n.y, n.z));
}
#endif

#ifdef FF_SWAY
attribute vec2 aSway;
uniform vec3 uSway;
uniform vec2 uCurrent;

void ffSwayDeform(inout vec3 p) {
  float h = clamp(p.y / uSway.z, 0.0, 1.0);
  float h2 = h * h;
  float ph = aSway.x;
  #ifdef USE_INSTANCING
    ph += instanceMatrix[3].x * 0.31 + instanceMatrix[3].z * 0.53;
  #endif
  float w = sin(uTime * uSway.x + ph + h * 2.3)
    + 0.45 * sin(uTime * uSway.x * 1.9 + ph * 1.7 + h * 5.0);
  float b = uSway.y * aSway.y;
  p.x += (w * 0.6 + uCurrent.x * 0.8) * b * h2;
  p.z += (w * 0.35 + uCurrent.y * 0.5) * b * h2;
}
#endif

#ifdef FF_FADE
uniform vec3 uPlayerPos;
varying float vFade;
#endif

varying vec3 vFFWorldPos;

#ifdef FF_FISH
varying vec4 vFx;
varying vec2 vJaw;
uniform vec4 uEye;
#endif

#ifdef FF_FADE
varying float vFade;
float ffDither(vec2 p) {
  return fract(52.9829189 * fract(dot(floor(p), vec2(0.06711056, 0.00583715))));
}
#endif

#if defined(FF_TRANSLUCENT) || defined(FF_FISH)
uniform vec3 uSunColor;
#endif

#ifdef FF_TRANSLUCENT
uniform float uTranslucency;
#endif

#ifdef FF_RIM
uniform vec3 uRimColor;
uniform float uRimPower;
uniform float uRimStrength;
#endif

#ifdef FF_GLOW
uniform float uGlow;
#endif

#ifdef FF_STONE
uniform sampler2D uStoneTex;
uniform sampler2D uStoneNormal;
uniform float uStoneScale;
uniform float uStoneRelief;
uniform vec3 uAlgaeColor;
uniform float uAlgaeAmount;
#endif

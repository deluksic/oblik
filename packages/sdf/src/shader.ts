export const SDF_VERT = /* glsl */ `
void main() {
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

export const BLIT_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

export const BLIT_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D uField;
varying vec2 vUv;
void main() {
  gl_FragColor = texture2D(uField, vUv);
}
`;

export function sdfFragSource(
  uniformDecls: string,
  expr: string,
  map2: string,
): string {
  return /* glsl */ `
precision highp float;
uniform vec3 uCamPos;
uniform mat4 uInvVP;
uniform vec2 uRes;
${uniformDecls}

float sdSphere(vec3 p, float r) { return length(p) - r; }

float sdBox(vec3 p, vec3 b) {
  vec3 q = abs(p) - b;
  return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0);
}

float sdCappedCylinder(vec3 p, float h, float r) {
  vec2 d = abs(vec2(length(p.xy), p.z)) - vec2(r, h);
  return min(max(d.x, d.y), 0.0) + length(max(d, 0.0));
}

float sdCapsule(vec3 p, vec3 a, vec3 b, float r) {
  vec3 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h) - r;
}

float sdTorus(vec3 p, vec2 t) {
  vec2 q = vec2(length(p.xy) - t.x, p.z);
  return length(q) - t.y;
}

float sdCircle(vec2 p, float r) { return length(p) - r; }

float smin(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / max(k, 1e-6), 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}

float map2(vec2 q) {
  return ${map2};
}

float map(vec3 p) {
  return ${expr};
}

vec3 calcN(vec3 p) {
  const vec2 e = vec2(0.0015, 0.0);
  return normalize(vec3(
    map(p + e.xyy) - map(p - e.xyy),
    map(p + e.yxy) - map(p - e.yxy),
    map(p + e.yyx) - map(p - e.yyx)
  ));
}

void main() {
  vec2 ndc = (gl_FragCoord.xy / uRes) * 2.0 - 1.0;
  vec4 f4 = uInvVP * vec4(ndc, 1.0, 1.0);
  vec3 ro = uCamPos;
  vec3 rd = normalize(f4.xyz / f4.w - ro);

  float t = 0.0;
  float h = 1.0;
  for (int i = 0; i < 96; i++) {
    vec3 p = ro + rd * t;
    h = map(p);
    if (h < 0.0015 || t > 80.0) break;
    t += h;
  }

  vec3 col = vec3(0.071, 0.078, 0.110);
  if (h < 0.02 && t < 80.0) {
    vec3 p = ro + rd * t;
    vec3 n = calcN(p);
    vec3 l = normalize(vec3(0.45, -0.7, 0.85));
    float diff = max(0.0, dot(n, l));
    float amb = 0.28 + 0.18 * n.z;
    vec3 albedo = vec3(0.78, 0.74, 0.68);
    col = albedo * (amb + 0.85 * diff);
    float rim = pow(1.0 - max(0.0, dot(n, -rd)), 3.0);
    col += vec3(0.12, 0.14, 0.16) * rim;
  } else {
    float sky = 0.55 + 0.45 * rd.z;
    col = mix(vec3(0.10, 0.11, 0.14), vec3(0.18, 0.22, 0.28), clamp(sky, 0.0, 1.0));
  }

  gl_FragColor = vec4(col, 1.0);
}
`;
}

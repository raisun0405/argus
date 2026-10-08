// The page's 3D stage: one fixed, transparent canvas behind the hero and the three scroll stories. The proteins are drawn
// as cartoons and lit like a product in a studio, and every value eases toward what the moment of the
// scroll wants, so any scroll speed looks smooth.
//
// Two structures. Adenylate kinase, open (4AKE) with the closed form (1AKE) laid over it by Argus's
// own Overlay code: the open form coloured by how far each residue sits from its partner, the closed
// form a thin line. It turns in the hero (and by hand), and in Overlay's story scrolling swings its
// lid shut. And HIV-1 protease holding indinavir (1HSG), for asking and three of the tools: marks
// brighten while the rest dims, side chains grow in as sticks, the camera flies to a site, hydrogen
// bonds run as dashes, the pocket shows as a glass shell, and for Co-fold the drug leaves its pocket
// and finds its way back.
//
// Where one structure gives way to the other it breaks into grain: the grain flies into the other's
// shape, and that takes form.
import * as THREE from 'three';

// ---- Where the reader is ----
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
/** 0 while the element's top is below the top of the screen, 1 once its bottom reaches the bottom. */
const through = el => {
  if (!el) return 0;
  const r = el.getBoundingClientRect();
  const span = r.height - innerHeight;
  return span > 0 ? clamp(-r.top / span) : r.top <= 0 ? 1 : 0;
};
/** 0 while the element's top is at the bottom of the screen or below, 1 once it reaches the top. */
const arriving = el => (el ? clamp(1 - el.getBoundingClientRect().top / innerHeight) : 0);
const stepOf = (p, n) => Math.min(n - 1, Math.floor(p * n));
const ease = (cur, to, rate, dt) => cur + (to - cur) * (1 - Math.exp(-rate * dt));
const mix = (a, b, t) => a + (b - a) * t;

// ---- Cartoons ----
// A smooth ribbon through each chain's backbone, flat and broad along the strands (with an arrowhead
// where each ends), a little narrower along the helices, a thin round tube through the loops.
const SUB = 12;   // samples per residue along the spline
const RING = 14;  // points round the cross-section
const PROFILE = { E: [1.12, 0.22], H: [0.95, 0.22], C: [0.3, 0.3] };
const ARROW = 1.72;
const smoothstep = t => t * t * (3 - 2 * t);

/** The ribbon's vertices for every chain; `flips` reuses the other form's peptide-plane choices, so two forms of one chain blend vertex for vertex. */
function build(chains, values, flips) {
  const out = { pos: [], nrm: [], tags: [], along: [], value: [], index: [], flips: [] };
  const v = new THREE.Vector3(), T = new THREE.Vector3(), N = new THREE.Vector3(), B = new THREE.Vector3(), g = new THREE.Vector3();
  chains.forEach((chain, ci) => {
    const res = chain.residues;
    const n = res.length;
    const curve = new THREE.CatmullRomCurve3(res.map(r => new THREE.Vector3(...r.ca)), false, 'centripetal', 0.5);
    // the peptide planes: CA→O, flipped to agree with the one before, softened over their neighbours
    const raw = res.map(r => new THREE.Vector3(r.o[0] - r.ca[0], r.o[1] - r.ca[1], r.o[2] - r.ca[2]).normalize());
    const flipped = [false];
    for (let i = 1; i < n; i++) {
      const f = flips ? flips[ci][i] : raw[i].dot(raw[i - 1]) < 0;
      flipped.push(f);
      if (f) raw[i].negate();
    }
    out.flips.push(flipped);
    const guide = raw.map((r, i) => r.clone().multiplyScalar(2).add(raw[Math.max(0, i - 1)]).add(raw[Math.min(n - 1, i + 1)]).normalize());
    const profile = (i, f) => {
      const a = res[i], b = res[Math.min(n - 1, i + 1)];
      const [wa, ta] = PROFILE[a.ss], [wb, tb] = PROFILE[b.ss];
      if (a.ss === 'E' && b.ss !== 'E') return [ARROW + (wb - ARROW) * f, ta + (tb - ta) * f];
      const s = smoothstep(f);
      return [wa + (wb - wa) * s, ta + (tb - ta) * s];
    };
    const base = out.pos.length / 3;
    const samples = (n - 1) * SUB + 1;
    for (let k = 0; k < samples; k++) {
      const s = k / SUB;
      const i = Math.min(n - 2, Math.floor(s));
      const f = s - i;
      const t = s / (n - 1);
      const p = curve.getPoint(t);
      curve.getTangent(t, T).normalize();
      g.copy(guide[i]).lerp(guide[i + 1], f);
      N.copy(g).addScaledVector(T, -g.dot(T)).normalize();
      B.crossVectors(T, N).normalize();
      const [hw, ht] = profile(i, f);
      const tag = res[f < 0.5 ? i : i + 1].tags;
      const value = values ? values[ci][i] + (values[ci][i + 1] - values[ci][i]) * f : 0;
      for (let r = 0; r < RING; r++) {
        const a = (r / RING) * Math.PI * 2;
        const c = Math.cos(a), sn = Math.sin(a);
        v.copy(p).addScaledVector(N, c * hw).addScaledVector(B, sn * ht);
        out.pos.push(v.x, v.y, v.z);
        v.set(0, 0, 0).addScaledVector(N, c / hw).addScaledVector(B, sn / ht).normalize();
        out.nrm.push(v.x, v.y, v.z);
        out.tags.push(tag);
        out.along.push((ci + t) / chains.length);
        out.value.push(value);
      }
      if (k > 0) {
        const a0 = base + (k - 1) * RING, a1 = base + k * RING;
        for (let r = 0; r < RING; r++) {
          const r1 = (r + 1) % RING;
          out.index.push(a0 + r, a1 + r, a0 + r1, a0 + r1, a1 + r, a1 + r1);
        }
      }
    }
  });
  return out;
}

const attr = (geo, name, arr, size) => geo.setAttribute(name, new THREE.Float32BufferAttribute(arr, size));

/** One mesh for every chain: per vertex the residue's tags and where along the chains it sits (0..1). */
function ribbonGeometry(chains) {
  const b = build(chains);
  const geo = new THREE.BufferGeometry();
  attr(geo, 'position', b.pos, 3); attr(geo, 'normal', b.nrm, 3); attr(geo, 'aTags', b.tags, 1); attr(geo, 'aAlong', b.along, 1);
  geo.setIndex(b.index);
  geo.computeBoundingSphere();
  return geo;
}

/** The kinase's ribbon in both forms: position/normal open, aPos2/aNorm2 closed, aValue how far each residue moved (Å). */
function morphGeometry(data) {
  const toChain = which => [{ id: 'A', residues: data.residues.map(r => ({ num: r.num, name: r.name, ss: r.ss, tags: r.tags, ca: r[which].ca, o: r[which].o })) }];
  const values = [data.residues.map(r => r.d)];
  const open = build(toChain('open'), values);
  const closed = build(toChain('closed'), values, open.flips);
  const geo = new THREE.BufferGeometry();
  attr(geo, 'position', open.pos, 3); attr(geo, 'normal', open.nrm, 3);
  attr(geo, 'aPos2', closed.pos, 3); attr(geo, 'aNorm2', closed.nrm, 3);
  attr(geo, 'aValue', open.value, 1); attr(geo, 'aAlong', open.along, 1);
  geo.setIndex(open.index);
  geo.computeBoundingSphere();
  return geo;
}

/** A thin tube through the closed form's backbone: the other structure, as a line. */
function traceGeometry(data) {
  const curve = new THREE.CatmullRomCurve3(data.residues.map(r => new THREE.Vector3(...r.closed.ca)), false, 'centripetal', 0.5);
  return new THREE.TubeGeometry(curve, data.residues.length * 6, 0.16, 8, false);
}

/** Balls and sticks as two instanced meshes; each instance carries its group's tags so a shader can grow it in. */
function stickMeshes(groups, material, radius) {
  const atoms = [], bonds = [];
  for (const g of groups) {
    const pts = g.atoms.map(a => new THREE.Vector3(a[0], a[1], a[2]));
    g.atoms.forEach((a, i) => atoms.push({ p: pts[i], tags: g.tags ?? 0, el: a[3] }));
    for (const [i, j] of g.bonds) bonds.push({ a: pts[i], b: pts[j], tags: g.tags ?? 0 });
  }
  const ball = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 20, 14), material, atoms.length);
  const stick = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1, 1, 14, 1, true), material, bonds.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), d = new THREE.Vector3(), mid = new THREE.Vector3();
  const ballTags = new Float32Array(atoms.length), stickTags = new Float32Array(bonds.length);
  atoms.forEach((a, i) => {
    // oxygens and nitrogens a touch larger, so the atoms that bond read at a glance
    ball.setMatrixAt(i, m.compose(a.p, q.identity(), s.setScalar(radius.atom * (a.el === 1 || a.el === 2 ? 1.12 : 1))));
    ballTags[i] = a.tags;
  });
  bonds.forEach((b, i) => {
    d.subVectors(b.b, b.a);
    mid.addVectors(b.a, b.b).multiplyScalar(0.5);
    q.setFromUnitVectors(up, d.clone().normalize());
    stick.setMatrixAt(i, m.compose(mid, q, s.set(radius.bond, d.length(), radius.bond)));
    stickTags[i] = b.tags;
  });
  ball.geometry.setAttribute('aTags', new THREE.InstancedBufferAttribute(ballTags, 1));
  stick.geometry.setAttribute('aTags', new THREE.InstancedBufferAttribute(stickTags, 1));
  ball.frustumCulled = stick.frustumCulled = false;
  return { ball, stick };
}

/** The drug's hydrogen bonds: thin rods from each protein atom to the drug atom it bonds, dashed by a shader. */
function bondRods(hbonds, material) {
  const geo = new THREE.CylinderGeometry(1, 1, 1, 10, 1, true);
  const mesh = new THREE.InstancedMesh(geo, material, hbonds.length);
  const lengths = new Float32Array(hbonds.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  hbonds.forEach((h, i) => {
    const a = new THREE.Vector3(...h.from), b = new THREE.Vector3(...h.to);
    const d = b.clone().sub(a);
    q.setFromUnitVectors(up, d.clone().normalize());
    mesh.setMatrixAt(i, m.compose(a.clone().add(b).multiplyScalar(0.5), q, new THREE.Vector3(0.07, d.length(), 0.07)));
    lengths[i] = d.length();
  });
  geo.setAttribute('aLength', new THREE.InstancedBufferAttribute(lengths, 1));
  mesh.frustumCulled = false;
  return mesh;
}

/**
 * The grain between the two structures: points on the protease's ribbon, each paired with a point on
 * the kinase's (open and closed), both taken in order along the chains so the grain travels as a
 * stream rather than a scatter. A fixed seed, so it looks the same every visit.
 */
function grainGeometry(hsgGeo, akGeo, n) {
  let seed = 7;
  const rand = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const pick = geo => {
    const along = geo.attributes.aAlong.array;
    const out = [];
    for (let i = 0; i < n; i++) { const v = Math.floor(rand() * along.length); out.push({ v, f: along[v] + rand() * 0.004 }); }
    return out.sort((a, b) => a.f - b.f);
  };
  const A = pick(hsgGeo), B = pick(akGeo);
  const pa = hsgGeo.attributes.position.array, pb = akGeo.attributes.position.array, pb2 = akGeo.attributes.aPos2.array, vb = akGeo.attributes.aValue.array;
  const aA = new Float32Array(n * 3), aB = new Float32Array(n * 3), aB2 = new Float32Array(n * 3), aVal = new Float32Array(n), aSeed = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const a = A[i].v * 3, b = B[i].v * 3;
    aA.set([pa[a], pa[a + 1], pa[a + 2]], i * 3);
    aB.set([pb[b], pb[b + 1], pb[b + 2]], i * 3);
    aB2.set([pb2[b], pb2[b + 1], pb2[b + 2]], i * 3);
    aVal[i] = vb[B[i].v];
    // when it sets off: mostly by where it sits along the chain, so the break runs down the chain
    aSeed.set([0.6 * A[i].f + 0.4 * rand(), rand(), rand(), rand()], i * 4);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(aA, 3));
  geo.setAttribute('aB', new THREE.Float32BufferAttribute(aB, 3));
  geo.setAttribute('aB2', new THREE.Float32BufferAttribute(aB2, 3));
  geo.setAttribute('aVal', new THREE.Float32BufferAttribute(aVal, 1));
  geo.setAttribute('aSeed', new THREE.Float32BufferAttribute(aSeed, 4));
  return geo;
}

// ---- Shaders ----
const BITS = /* glsl */ `float bit(float t, float b) { return mod(floor(t / b + 0.001), 2.0); }`;

// Soft studio lighting, in view space: a broad softbox up and to the left, a fill, a rim from behind.
const STUDIO = /* glsl */ `
  vec3 studio(vec3 N, vec3 V, vec3 base, float metal) {
    vec3 L = normalize(vec3(-0.5, 0.72, 0.5));
    float wrap = clamp(dot(N, L) * 0.5 + 0.5, 0.0, 1.0);
    float dif = wrap * wrap;
    vec3 H = normalize(L + V);
    float spec = pow(max(dot(N, H), 0.0), 34.0);
    vec3 R = reflect(-V, N);
    float sky = smoothstep(-0.4, 0.95, R.y);
    vec3 env = mix(vec3(0.03, 0.031, 0.034), vec3(0.3, 0.31, 0.34), sky);
    env += vec3(0.78, 0.8, 0.84) * exp(-(pow(R.x + 0.5, 2.0) + pow(R.y - 0.55, 2.0)) * 3.0);
    env += vec3(0.2, 0.21, 0.23) * exp(-(pow(R.x - 0.85, 2.0) + pow(R.y - 0.05, 2.0)) * 4.0);
    float fres = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 3.0);
    vec3 col = base * (0.1 + 0.78 * dif) * (1.0 - metal * 0.55) + env * (0.22 + 0.62 * metal) + vec3(spec) * 0.5;
    return col + vec3(0.82, 0.86, 0.94) * fres * 0.32;
  }
`;
// The app's Overlay scale: blue held still, white at 2 Å, red at 4 Å and more.
const SCALE = /* glsl */ `
  vec3 scale(float d) {
    float t = clamp(d / 4.0, 0.0, 1.0);
    vec3 blue = vec3(0.231, 0.510, 0.965), white = vec3(0.898, 0.906, 0.922), red = vec3(0.937, 0.267, 0.267);
    return t < 0.5 ? mix(blue, white, t * 2.0) : mix(white, red, t * 2.0 - 1.0);
  }
`;

const RIBBON_V = /* glsl */ `
  uniform float uAsp, uTip, uFlap, uPocket, uPolar;
  attribute float aTags, aAlong;
  varying vec3 vN, vV;
  varying float vHl, vAlong;
  ${BITS}
  void main() {
    vHl = max(max(bit(aTags, 1.0) * uAsp, bit(aTags, 2.0) * uTip), max(max(bit(aTags, 4.0) * uFlap, bit(aTags, 8.0) * uPocket), bit(aTags, 32.0) * uPolar));
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vN = normalize(normalMatrix * normal);
    vV = -mv.xyz;
    vAlong = aAlong;
    gl_Position = projectionMatrix * mv;
  }
`;
const RIBBON_F = /* glsl */ `
  uniform float uTime, uFocus, uOpacity, uSheen;
  varying vec3 vN, vV;
  varying float vHl, vAlong;
  ${STUDIO}
  void main() {
    vec3 col = studio(normalize(vN), normalize(vV), vec3(0.6, 0.62, 0.66), 0.72);
    col = mix(col, col * 1.12 + vec3(0.13, 0.135, 0.15), vHl);
    float dim = mix(1.0, 0.2, uFocus * (1.0 - vHl));
    col *= dim;
    // a slow sheen running along the chains
    float band = exp(-pow((fract(vAlong - uTime * 0.03) - 0.5) * 24.0, 2.0));
    col += vec3(0.86, 0.9, 1.0) * band * uSheen * 0.14 * dim;
    gl_FragColor = vec4(col * uOpacity, uOpacity);
  }
`;

// The kinase: blended between its open and closed forms, coloured by how far each residue moved.
const MORPH_V = /* glsl */ `
  uniform float uMorph;
  attribute vec3 aPos2, aNorm2;
  attribute float aValue;
  varying vec3 vN, vV;
  varying float vMove;
  void main() {
    vec3 p = mix(position, aPos2, uMorph);
    vec3 n = normalize(mix(normal, aNorm2, uMorph));
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vN = normalize(normalMatrix * n);
    vV = -mv.xyz;
    vMove = aValue;
    gl_Position = projectionMatrix * mv;
  }
`;
const MORPH_F = /* glsl */ `
  uniform float uOpacity;
  varying vec3 vN, vV;
  varying float vMove;
  ${STUDIO}
  ${SCALE}
  void main() {
    // the same studio, with less of the room in the reflections, so the colours stay true
    vec3 N = normalize(vN), V = normalize(vV);
    vec3 base = scale(vMove);
    vec3 lit = studio(N, V, base, 0.0);
    vec3 L = normalize(vec3(-0.5, 0.72, 0.5));
    float dif = pow(clamp(dot(N, L) * 0.5 + 0.5, 0.0, 1.0), 2.0);
    vec3 col = mix(lit, base * (0.16 + 0.95 * dif) + vec3(pow(max(dot(N, normalize(L + V)), 0.0), 34.0)) * 0.35, 0.6);
    gl_FragColor = vec4(col * uOpacity, uOpacity);
  }
`;

const TRACE_V = /* glsl */ `
  varying vec3 vN, vV;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vN = normalize(normalMatrix * normal);
    vV = -mv.xyz;
    gl_Position = projectionMatrix * mv;
  }
`;
const TRACE_F = /* glsl */ `
  uniform float uOn;
  varying vec3 vN, vV;
  void main() {
    float face = abs(dot(normalize(vN), normalize(vV)));
    gl_FragColor = vec4(vec3(0.95, 0.96, 1.0) * (0.35 + 0.65 * face) * uOn, 0.0);
  }
`;

// Balls and sticks (side chains and ligands): an instance shows when its tags are lit, or always (uAll).
const STICK_V = /* glsl */ `
  uniform float uSAsp, uSTip, uSPolar, uAll;
  attribute float aTags;
  varying vec3 vN, vV;
  ${BITS}
  void main() {
    float show = max(uAll, max(max(bit(aTags, 1.0) * uSAsp, bit(aTags, 2.0) * uSTip), bit(aTags, 32.0) * uSPolar));
    float s = smoothstep(0.0, 1.0, show);
    vec4 mv = modelViewMatrix * instanceMatrix * vec4(position * s, 1.0);
    vN = normalize(normalMatrix * mat3(instanceMatrix) * normal);
    vV = -mv.xyz;
    gl_Position = s < 0.005 ? vec4(2.0, 2.0, 2.0, 1.0) : projectionMatrix * mv;
  }
`;
const STICK_F = /* glsl */ `
  uniform vec3 uBase;
  uniform float uMetal, uGlow, uOpacity;
  varying vec3 vN, vV;
  ${STUDIO}
  void main() {
    vec3 col = studio(normalize(vN), normalize(vV), uBase, uMetal);
    col += vec3(0.92, 0.94, 1.0) * uGlow * 0.28;
    gl_FragColor = vec4(col * uOpacity, uOpacity);
  }
`;

const DASH_V = /* glsl */ `
  attribute float aLength;
  varying float vY;
  void main() {
    vY = uv.y * aLength;
    gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  }
`;
const DASH_F = /* glsl */ `
  uniform float uTime, uOn;
  varying float vY;
  void main() {
    float d = fract(vY / 0.42 - uTime * 0.9);
    float a = smoothstep(0.08, 0.2, d) * smoothstep(0.62, 0.5, d);
    gl_FragColor = vec4(vec3(0.94, 0.96, 1.0) * a * uOn, 0.0);
  }
`;

// A glass shell: bright at its rim, clear in the middle.
const SHELL_V = TRACE_V;
const SHELL_F = /* glsl */ `
  uniform float uOn;
  varying vec3 vN, vV;
  void main() {
    float rim = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.6);
    gl_FragColor = vec4(vec3(0.88, 0.91, 0.97) * rim * uOn, 0.0);
  }
`;

const GLOW_F = /* glsl */ `
  uniform float uOn;
  varying vec2 vUv;
  void main() {
    float r = length(vUv - 0.5) * 2.0;
    float a = exp(-r * r * 3.2) * 0.1 + exp(-r * r * 12.0) * 0.045;
    gl_FragColor = vec4(vec3(0.8, 0.84, 0.92) * a * uOn, 0.0);
  }
`;

// The grain: each point leaves the protease's ribbon (uT 0) for its place on the kinase's (uT 1),
// shimmering while it is grain and swirling wide mid-flight; it takes the colour of where it goes.
const GRAIN_V = /* glsl */ `
  uniform float uT, uTime, uMorph, uScale, uOn;
  attribute vec3 aB, aB2;
  attribute float aVal;
  attribute vec4 aSeed;
  varying float vA;
  varying vec3 vC;
  ${SCALE}
  float sm(float a, float b, float x) { float t = clamp((x - a) / (b - a), 0.0, 1.0); return t * t * (3.0 - 2.0 * t); }
  void main() {
    // the flight runs from 0.26 to 0.70, so each shape holds a beat as grain before and after it
    float d = aSeed.x;
    float s = sm(0.26 + 0.2 * d, 0.5 + 0.2 * d, uT);
    vec3 p = mix(position, mix(aB, aB2, uMorph), s);
    float swirl = sin(3.14159 * s);
    float k = uTime * 0.9;
    vec3 drift = vec3(sin(k * 1.3 + aSeed.y * 40.0), cos(k * 1.1 + aSeed.z * 40.0), sin(k * 0.9 + aSeed.w * 40.0));
    p += drift * (0.22 + 4.0 * swirl) + vec3(0.0, 3.0, 0.0) * swirl * (aSeed.y - 0.5);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = max(1.0, uScale * (0.16 + 0.22 * aSeed.w) / -mv.z);
    vA = uOn * (0.4 + 0.6 * aSeed.z);
    vC = mix(vec3(0.84, 0.86, 0.92), scale(aVal), s);
  }
`;
const GRAIN_F = /* glsl */ `
  varying float vA;
  varying vec3 vC;
  void main() {
    float r = length(gl_PointCoord - 0.5) * 2.0;
    float a = smoothstep(1.0, 0.15, r);
    gl_FragColor = vec4(vC * a * vA, 0.0);
  }
`;

const light = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, premultipliedAlpha: true };

/**
 * Start the stage. `sections`: the hero, the three stories and the section after them. `slots`:
 * where on the page each part wants the structure (the hero's figure, each story's empty stage).
 * `grab`: the hero's figure, for turning the structure by hand.
 */
export async function startStage({ canvas, layer, sections: S, slots: SL, grab, reduced }) {
  const [data, ak] = await Promise.all([
    fetch('/landing/data/1hsg.json').then(r => r.json()),
    fetch('/landing/data/4ake-1ake.json').then(r => r.json()),
  ]);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, premultipliedAlpha: true, powerPreference: 'high-performance' });
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(26, 1, 1, 3000);

  // ---- HIV-1 protease and indinavir ----
  const ribbonU = { uTime: { value: 0 }, uFocus: { value: 0 }, uOpacity: { value: 0 }, uSheen: { value: 1 }, uAsp: { value: 0 }, uTip: { value: 0 }, uFlap: { value: 0 }, uPocket: { value: 0 }, uPolar: { value: 0 } };
  const hsgGeo = ribbonGeometry(data.chains);
  const ribbon = new THREE.Mesh(hsgGeo, new THREE.ShaderMaterial({ vertexShader: RIBBON_V, fragmentShader: RIBBON_F, uniforms: ribbonU }));
  const stickU = (base, metal, glow, all) => ({ uSAsp: { value: 0 }, uSTip: { value: 0 }, uSPolar: { value: 0 }, uAll: { value: all }, uBase: { value: new THREE.Color(...base) }, uMetal: { value: metal }, uGlow: { value: glow }, uOpacity: { value: 0 } });
  const sideU = stickU([0.9, 0.91, 0.94], 0.35, 0.2, 0);
  const side = stickMeshes(data.sticks, new THREE.ShaderMaterial({ vertexShader: STICK_V, fragmentShader: STICK_F, uniforms: sideU }), { atom: 0.3, bond: 0.13 });
  const drugU = stickU([0.97, 0.975, 0.99], 0.12, 0, 1);
  const drug = stickMeshes([data.drug], new THREE.ShaderMaterial({ vertexShader: STICK_V, fragmentShader: STICK_F, uniforms: drugU }), { atom: 0.34, bond: 0.15 });
  const drugCentre = new THREE.Vector3(...data.anchors.drug);
  // the drug turns and moves about its own centre while it docks
  const drugInner = new THREE.Group();
  drugInner.position.copy(drugCentre).negate();
  drugInner.add(drug.ball, drug.stick);
  const drugGroup = new THREE.Group();
  drugGroup.position.copy(drugCentre);
  drugGroup.add(drugInner);
  const dockFrom = new THREE.Vector3(10, 34, 26);
  const dockAxis = new THREE.Vector3(0.35, 1, 0.25).normalize();
  const dashU = { uTime: { value: 0 }, uOn: { value: 0 } };
  const dashes = bondRods(data.hbonds, new THREE.ShaderMaterial({ vertexShader: DASH_V, fragmentShader: DASH_F, uniforms: dashU, ...light }));
  const shellGeo = new THREE.SphereGeometry(1, 64, 40);
  const shellU = { uOn: { value: 0 } };
  const shell = new THREE.Mesh(shellGeo, new THREE.ShaderMaterial({ vertexShader: SHELL_V, fragmentShader: SHELL_F, uniforms: shellU, ...light }));
  shell.position.copy(drugCentre);
  const pulseU = { uOn: { value: 0 } };
  const pulse = new THREE.Mesh(shellGeo, new THREE.ShaderMaterial({ vertexShader: SHELL_V, fragmentShader: SHELL_F, uniforms: pulseU, ...light }));
  pulse.position.copy(drugCentre);
  const hsg = new THREE.Group();
  hsg.add(ribbon, side.ball, side.stick, drugGroup, dashes, shell, pulse);

  // ---- Adenylate kinase, open and closed ----
  const morphU = { uMorph: { value: 0 }, uOpacity: { value: 0 } };
  const akGeo = morphGeometry(ak);
  const akRibbon = new THREE.Mesh(akGeo, new THREE.ShaderMaterial({ vertexShader: MORPH_V, fragmentShader: MORPH_F, uniforms: morphU }));
  const traceU = { uOn: { value: 0 } };
  const trace = new THREE.Mesh(traceGeometry(ak), new THREE.ShaderMaterial({ vertexShader: TRACE_V, fragmentShader: TRACE_F, uniforms: traceU, ...light }));
  const ligU = stickU([0.97, 0.975, 0.99], 0.12, 0.35, 0);
  const lig = stickMeshes([ak.ligand], new THREE.ShaderMaterial({ vertexShader: STICK_V, fragmentShader: STICK_F, uniforms: ligU }), { atom: 0.32, bond: 0.14 });
  const kinase = new THREE.Group();
  kinase.add(akRibbon, trace, lig.ball, lig.stick);

  // ---- The grain between them ----
  const grainU = { uT: { value: 1 }, uTime: { value: 0 }, uMorph: { value: 0 }, uScale: { value: 1 }, uOn: { value: 0 } };
  const grain = new THREE.Points(grainGeometry(hsgGeo, akGeo, 7000), new THREE.ShaderMaterial({ vertexShader: GRAIN_V, fragmentShader: GRAIN_F, uniforms: grainU, ...light, depthTest: false }));
  grain.frustumCulled = false;
  grain.renderOrder = 2;

  const pivot = new THREE.Group();
  pivot.add(hsg, kinase, grain);
  const mover = new THREE.Group();
  mover.add(pivot);
  scene.add(mover);

  // a soft light behind the protein, always facing the camera
  const glowU = { uOn: { value: 0 } };
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShaderMaterial({
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: GLOW_F, uniforms: glowU, ...light, depthTest: false,
  }));
  glow.renderOrder = -1;
  scene.add(glow);

  // ---- Callouts: HTML, placed over the canvas every frame ----
  const v = p => new THREE.Vector3(...p);
  const at = id => v(data.anchors[id] ?? data.anchors.drug);
  const defs = [
    { id: 'asp25A', text: 'Asp25 · A', at: at('asp25A'), mol: 0 },
    { id: 'asp25B', text: 'Asp25 · B', at: at('asp25B'), mol: 0 },
    { id: 'ile50A', text: 'Ile50 · A', at: at('ile50A'), mol: 0 },
    { id: 'ile50B', text: 'Ile50 · B', at: at('ile50B'), mol: 0 },
    { id: 'drug', text: 'Indinavir · MK1', at: at('drug'), kind: 'strong', mol: 0 },
    { id: 'pocket', text: 'Pocket 1 · 98%', at: at('drug'), kind: 'strong', mol: 0 },
    { id: 'cofold', text: 'Boltz-2 · finding the pose', at: at('drug'), kind: 'strong', mol: 0 },
    ...data.contacts.map((c, i) => ({ id: `c${i}`, text: `${c.label}  ${c.d.toFixed(2)} Å`, at: v(c.at), mol: 0 })),
    { id: 'lid', text: `Lid · up to ${ak.domains.lid.max.toFixed(1)} Å`, at: v(ak.domains.lid.open), to: v(ak.domains.lid.closed), kind: 'strong', mol: 1 },
    { id: 'nmp', text: `NMP domain · up to ${ak.domains.nmp.max.toFixed(1)} Å`, at: v(ak.domains.nmp.open), to: v(ak.domains.nmp.closed), mol: 1 },
    { id: 'core', text: 'Core · held still', at: v(ak.domains.core.open), to: v(ak.domains.core.closed), mol: 1 },
    { id: 'ap5a', text: 'Ap5A · bound in the closed form', at: v(ak.ligandCentre), kind: 'strong', mol: 1 },
  ];
  const callouts = defs.map(d => {
    const el = document.createElement('div');
    el.className = `callout${d.kind ? ` callout--${d.kind}` : ''}`;
    el.innerHTML = '<i></i><b></b><span></span>';
    const text = el.querySelector('span');
    text.textContent = d.text;
    layer.appendChild(el);
    return { ...d, el, text, line: el.querySelector('b'), show: 0, x: 0, y: 0, side: 1, w: 0 };
  });
  const target = {};

  // ---- Turning the hero's structure by hand (mouse and pen; on touch the page scrolls) ----
  const drag = { active: false, yaw: 0, pitch: 0 };
  let last = null;
  grab.addEventListener('pointerdown', e => {
    if (e.pointerType === 'touch' || e.button !== 0) return;
    grab.setPointerCapture(e.pointerId);
    last = { x: e.clientX, y: e.clientY };
    drag.active = true;
  });
  grab.addEventListener('pointermove', e => {
    if (!last) return;
    drag.yaw += (e.clientX - last.x) * 0.0085;
    drag.pitch = clamp(drag.pitch + (e.clientY - last.y) * 0.006, -0.6, 0.6);
    last = { x: e.clientX, y: e.clientY };
  });
  const up = () => { last = null; drag.active = false; };
  grab.addEventListener('pointerup', up);
  grab.addEventListener('pointercancel', up);
  const pointer = { x: 0, y: 0, moved: false };
  addEventListener('pointermove', e => { pointer.x = (e.clientX / innerWidth) * 2 - 1; pointer.y = -((e.clientY / innerHeight) * 2 - 1); pointer.moved = true; }, { passive: true });

  // ---- Sizing ----
  let W = 1, H = 1;
  function resize() {
    W = innerWidth; H = innerHeight;
    renderer.setSize(W, H, false);
    camera.aspect = W / H;
    camera.updateProjectionMatrix();
  }
  resize();
  addEventListener('resize', resize);

  // Where a slot wants the structure: its centre and size on screen. A story's stage is read where
  // it sits once pinned, so the target holds still while the story slides in. The hero's figure
  // scrolls with the page until its centre reaches a little above the middle, then holds there.
  const slotOf = (el, pinned) => {
    const r = el.getBoundingClientRect();
    let cy = r.top + r.height / 2;
    if (pinned) cy -= el.closest('.story-pin').getBoundingClientRect().top;
    else cy = Math.max(cy, H * 0.38);
    return { cx: r.left + r.width / 2, cy, size: Math.min(r.width, r.height), left: r.left, right: r.right };
  };

  // ---- What each moment wants ----
  const base = () => ({
    shiftX: 0, shiftY: 0, size: 400, zoom: 1, pitch: 0.22, fx: 0, fy: 0, fz: 0,
    focus: 0, asp: 0, tip: 0, flap: 0, pocket: 0, polar: 0, sAsp: 0, sTip: 0, sPolar: 0, drugGlow: 0,
    radar: 0, dashes: 0, dock: 0, sheen: 1, opacity: 1, morph: 0, ghost: 0, lig: 0,
  });
  let wantYaw = null;   // null: turning on its own (and by hand)
  let wantMol = 1;      // which structure: 0 the protease, 1 the kinase
  let slot = null;
  function wanted() {
    const portrait = W / H < 0.9;
    const p = base();
    wantYaw = null;
    for (const k of Object.keys(target)) target[k] = 0;
    const ea = arriving(S.ask), pa = through(S.ask);
    const et = arriving(S.tools), pt = through(S.tools);
    const eo = arriving(S.overlay), po = through(S.overlay);
    const ex = arriving(S.after);

    // the hero: the kinase, open with the closed form as a line, turning
    wantMol = 1;
    slot = slotOf(SL.hero, false);
    p.pitch = 0.14; p.sheen = 0; p.ghost = 1; p.lig = 1;

    if (ea > 0.5 && et < 0.5) {
      wantMol = 0;
      slot = slotOf(SL.ask, true);
      p.pitch = 0.16; p.sheen = 0.4; p.ghost = 0; p.lig = 0;
      wantYaw = 0.18;
      const s = stepOf(pa, 4);
      if (s >= 1) { p.focus = 0.75; p.asp = 1; p.tip = 1; p.drugGlow = 0.6; p.sAsp = 1; p.sTip = 1; }
      if (s === 1) Object.assign(target, { asp25A: 1, asp25B: 1, ile50A: 1, ile50B: 1, drug: 1 });
      if (s === 2) {
        p.zoom = 2.3; [p.fx, p.fy, p.fz] = data.anchors.asp25A; p.focus = 0.85; p.tip = 0; p.sTip = 0; wantYaw = 0.62; p.pitch = 0.3;
        target.asp25A = 1;
      }
      if (s === 3) {
        p.zoom = 1.6; p.fx = 0; p.fy = 8; p.fz = 0; p.focus = 0.78; p.asp = 0.25; p.sAsp = 0; p.flap = 1; p.tip = 1; wantYaw = 1.0; p.pitch = 0.34;
        Object.assign(target, { ile50A: 1, ile50B: 1, drug: 1 });
      }
    }
    if (et >= 0.5 && eo < 0.5) {
      wantMol = 0;
      slot = slotOf(SL.tools, true);
      p.sheen = 0.3; p.ghost = 0; p.lig = 0; wantYaw = -0.3; p.pitch = 0.2;
      [p.fx, p.fy, p.fz] = data.anchors.drug;
      const s = stepOf(pt, 3);
      if (s === 0) { p.zoom = 1.45; p.focus = 0.7; p.pocket = 1; p.drugGlow = 0.4; p.radar = 1; target.pocket = 1; }
      if (s === 1) {
        p.zoom = 2.2; p.focus = 0.86; p.polar = 1; p.sPolar = 1; p.sAsp = 1; p.drugGlow = 0.8; p.dashes = 1; wantYaw = 0.3; p.pitch = 0.4;
        data.contacts.forEach((_, i) => { target[`c${i}`] = 1; });
      }
      if (s === 2) {
        p.zoom = 1.4; p.focus = 0.62; p.pocket = 0.6; p.drugGlow = 1; wantYaw = -0.55; p.pitch = 0.24;
        p.dock = 1 - smooth(0.1, 0.8, clamp((pt - 2 / 3) * 3));
        target.cofold = 1;
      }
    }
    if (eo >= 0.5 && ex < 0.5) {
      // Overlay: scrolling through the second step swings the lid shut onto the closed form's line
      wantMol = 1;
      slot = slotOf(SL.overlay, true);
      p.zoom = portrait ? 0.86 : 1.06; p.sheen = 0; p.pitch = 0.08;
      wantYaw = 0.32 - 0.18 * smooth(0.5, 0.9, po);
      p.morph = smooth(0.5, 0.9, po);
      p.ghost = 1 - smooth(0.7, 0.95, po);
      p.lig = smooth(0.86, 0.97, po);
      if (po < 0.88) Object.assign(target, { lid: 1, nmp: 1, core: 1 });
      else target.ap5a = 1;
    }
    p.shiftX = (slot.cx - W / 2) / W;
    p.shiftY = (H / 2 - slot.cy) / H;
    p.size = slot.size * 0.94;
    if (portrait) p.zoom = Math.min(p.zoom, 1.5);
    if (ex > 0) {
      p.opacity = 1 - smooth(0.05, 0.75, ex);
      p.shiftY += smooth(0, 1, ex) * 0.16;
    }
    return p;
  }

  // ---- The loop ----
  const now = base();
  now.opacity = 0;
  let mol = 1;           // where the switch between the two stands: 0 the protease, 1 the kinase
  let yaw = -0.6, spin = 0, pitchHand = 0, parX = 0, parY = 0;
  let lastT = performance.now();
  let running = true;
  let born = -1;
  let first = true;
  const v3 = new THREE.Vector3(), centre = new THREE.Vector3(), euler = new THREE.Euler(), q = new THREE.Quaternion();
  const MOL_SECONDS = 2.6; // how long the grain takes from one structure to the other

  function frame(t) {
    if (!running) return;
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, (t - lastT) / 1000);
    lastT = t;
    if (born < 0) born = t;
    const time = t / 1000;
    const want = wanted();
    want.opacity *= smooth(0, 1400, t - born);   // the first appearance fades in
    if (first) { Object.assign(now, want, { opacity: 0 }); mol = wantMol; first = false; }
    const r = reduced ? 60 : 3;
    for (const k of Object.keys(want)) {
      const rate = k === 'dock' || k === 'opacity' ? r * 1.5 : k === 'morph' ? r * 2 : k === 'shiftX' || k === 'shiftY' || k === 'size' ? r * 1.2 : r;
      now[k] = ease(now[k], want[k], rate, dt);
    }
    // the switch runs at a steady pace, so its three beats always play out: grain, flight, form
    mol = reduced ? wantMol : mol + clamp(wantMol - mol, -dt / MOL_SECONDS, dt / MOL_SECONDS);

    const visible = now.opacity > 0.004;
    canvas.style.visibility = visible ? 'visible' : 'hidden';
    layer.style.visibility = visible ? 'visible' : 'hidden';
    if (!visible) return;

    // turning: on its own in the hero (and by hand), held to a chosen angle in the stories
    if (wantYaw === null) {
      if (drag.active) {
        const turn = drag.yaw;
        drag.yaw = 0;
        yaw += turn;
        spin = ease(spin, turn / Math.max(dt, 1e-3), 12, dt);
      } else {
        spin = ease(spin, 0, 2.2, dt);
        yaw += dt * ((reduced ? 0 : 0.12) + spin);
      }
      pitchHand = ease(pitchHand, drag.pitch, 10, dt);
    } else {
      drag.yaw = 0; drag.pitch = 0; spin = 0;
      pitchHand = ease(pitchHand, 0, 4, dt);
      const d = Math.atan2(Math.sin(wantYaw - yaw), Math.cos(wantYaw - yaw));
      yaw += d * (1 - Math.exp(-2.4 * dt));
    }
    parX = ease(parX, pointer.moved && !drag.active ? pointer.x : parX, 2, dt);
    parY = ease(parY, pointer.moved && !drag.active ? pointer.y : parY, 2, dt);

    // the camera stands back far enough for 60 Å to fill the slot
    const D = (60 * H) / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * Math.max(80, now.size));
    camera.position.set(0, 0, D);
    camera.lookAt(0, 0, 0);
    camera.setViewOffset(W, H, -now.shiftX * W, now.shiftY * H, W, H);

    pivot.scale.setScalar(now.zoom);
    pivot.rotation.set(now.pitch + pitchHand - parY * 0.06, yaw + parX * 0.1, 0, 'YXZ');
    euler.copy(pivot.rotation);
    v3.set(now.fx, now.fy, now.fz).multiplyScalar(now.zoom).applyEuler(euler);
    mover.position.set(-v3.x, -v3.y, -v3.z);

    // one structure at a time; between them, grain
    const hsgOn = (1 - smooth(0, 0.2, mol)) * now.opacity;
    const akOn = smooth(0.8, 1, mol) * now.opacity;
    const grainOn = smooth(0.03, 0.18, mol) * (1 - smooth(0.82, 0.97, mol)) * now.opacity;
    hsg.visible = hsgOn > 0.003;
    kinase.visible = akOn > 0.003;
    grain.visible = grainOn > 0.003;

    // the drug: home in its pocket, or away and turning while Co-fold looks for its pose
    const k = now.dock;
    drugGroup.position.copy(drugCentre).addScaledVector(dockFrom, k * k);
    if (k > 0.001) {
      const search = k * (1 - k) * 4;
      drugGroup.position.x += Math.sin(time * 2.6) * 1.2 * search;
      drugGroup.position.y += Math.sin(time * 2.1 + 1) * 1.2 * search;
    }
    drugGroup.quaternion.copy(q.setFromAxisAngle(dockAxis, k * 3.4));

    ribbonU.uTime.value = time;
    ribbonU.uFocus.value = now.focus;
    ribbonU.uOpacity.value = hsgOn;
    ribbonU.uSheen.value = reduced ? 0 : now.sheen;
    ribbonU.uAsp.value = now.asp; ribbonU.uTip.value = now.tip; ribbonU.uFlap.value = now.flap;
    ribbonU.uPocket.value = now.pocket; ribbonU.uPolar.value = now.polar;
    sideU.uSAsp.value = now.sAsp; sideU.uSTip.value = now.sTip; sideU.uSPolar.value = now.sPolar;
    sideU.uOpacity.value = hsgOn;
    drugU.uOpacity.value = hsgOn * mix(0.82, 1, now.focus);
    drugU.uGlow.value = now.drugGlow;
    dashU.uTime.value = time;
    dashU.uOn.value = now.dashes * hsgOn;
    shell.scale.setScalar(8.6);
    shellU.uOn.value = now.radar * hsgOn * 0.5;
    const ring = reduced ? 0 : (time * 0.45) % 1;
    pulse.scale.setScalar(8.6 + ring * 7);
    pulseU.uOn.value = now.radar * hsgOn * 0.4 * (1 - ring) * (1 - ring);

    morphU.uMorph.value = now.morph;
    morphU.uOpacity.value = akOn;
    traceU.uOn.value = now.ghost * akOn * 0.55;
    ligU.uAll.value = now.lig;
    ligU.uOpacity.value = akOn;

    grainU.uT.value = mol;
    grainU.uTime.value = time;
    grainU.uMorph.value = now.morph;
    grainU.uOn.value = grainOn;
    // a grain's size in pixels for each Å it spans, at the camera's distance
    grainU.uScale.value = (H * renderer.getPixelRatio() * now.zoom) / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));

    // the glow sits behind the point the camera looks at, facing it
    mover.updateMatrixWorld();
    pivot.localToWorld(centre.set(now.fx, now.fy, now.fz));
    glow.position.copy(centre).add(v3.set(0, 0, -40));
    glow.quaternion.copy(camera.quaternion);
    glow.scale.setScalar(150 * Math.max(1, now.zoom * 0.8));
    glowU.uOn.value = now.opacity;

    renderer.render(scene, camera);

    // callouts: placed on their anchors, text to the outside, stacked so none overlap, kept inside the slot
    centre.project(camera);
    const cx = (centre.x * 0.5 + 0.5) * W;
    const minX = slot.left + 8, maxX = slot.right - 8;
    const shown = [];
    for (const c of callouts) {
      const on = c.mol === 0 ? hsgOn : akOn;
      c.show = ease(c.show, (target[c.id] ?? 0) * on, 5, dt);
      if (c.show < 0.01) { c.el.style.opacity = '0'; continue; }
      v3.copy(c.at);
      if (c.to) v3.lerp(c.to, now.morph);
      if (c.id === 'cofold') {
        v3.addScaledVector(dockFrom, k * k);
        c.text.textContent = k > 0.05 ? 'Boltz-2 · finding the pose' : 'Lands 0.2 Å from the crystal pose';
      }
      pivot.localToWorld(v3).project(camera);
      c.x = (v3.x * 0.5 + 0.5) * W;
      c.y = (-v3.y * 0.5 + 0.5) * H;
      c.w = c.text.offsetWidth || 120;
      const fits = sd => (sd > 0 ? c.x + 52 + c.w <= maxX : c.x - 52 - c.w >= minX);
      c.side = c.x < cx ? -1 : 1;
      if (!fits(c.side) && fits(-c.side)) c.side = -c.side;
      shown.push(c);
    }
    for (const sideSign of [-1, 1]) {
      const list = shown.filter(c => c.side === sideSign).sort((a, b) => a.y - b.y);
      let prev = -Infinity;
      for (const c of list) {
        const ty = Math.max(c.y, prev + 28);
        prev = ty;
        const dx = 46 * sideSign;
        const dy = ty - c.y;
        const len = Math.max(0, Math.hypot(dx, dy) - 6);
        c.el.classList.toggle('is-left', sideSign < 0);
        c.el.style.opacity = String(c.show);
        c.el.style.transform = `translate3d(${c.x.toFixed(1)}px, ${c.y.toFixed(1)}px, 0)`;
        c.line.style.width = `${len.toFixed(1)}px`;
        c.line.style.transform = `rotate(${Math.atan2(dy, dx).toFixed(4)}rad)`;
        const gap = sideSign > 0 ? 52 - Math.max(0, c.x + 52 + c.w - maxX) : 52 - Math.max(0, minX - (c.x - 52 - c.w));
        c.text.style.transform = `translate(${sideSign < 0 ? `calc(-100% - ${gap.toFixed(1)}px)` : `${gap.toFixed(1)}px`}, calc(-50% + ${dy.toFixed(1)}px))`;
      }
    }
  }
  requestAnimationFrame(frame);
  document.documentElement.dataset.stage = 'ready';

  return {
    dispose() {
      running = false;
      removeEventListener('resize', resize);
      renderer.dispose();
      layer.innerHTML = '';
    },
  };
}

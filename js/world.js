"use strict";
// =====================================================================================
//  Sky Squadron — the world: renderer, sky, terrain, particles, sound, raider model.
//  game.js (loaded after this file) holds the planes, the hangar and the fighting.
//  Units are metres/seconds.
// =====================================================================================
const V3 = THREE.Vector3, Quat = THREE.Quaternion;
const G = 9.8, WORLD_R = 5500, WATER = -20;
const UP = new V3(0, 1, 0);
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const t1 = new V3(), t2 = new V3(), t3 = new V3(), t4 = new V3();
const tq = new Quat(), tm = new THREE.Matrix4();

// ---------- renderer, sky, light ----------
const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xa9d3f5, 1500, 7500);
const renderer = new THREE.WebGLRenderer({antialias: true});
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));   // sharp on high-density screens
renderer.shadowMap.enabled = true;                  // only the hangar light casts shadows; the open world has none
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.setScissorTest(true);
document.body.appendChild(renderer.domElement);
const hudC = document.getElementById("hud"), hc = hudC.getContext("2d");
addEventListener("resize", () => { if (typeof layout === "function") layout(); });   // layout() lives in game.js

scene.add(new THREE.HemisphereLight(0xffffff, 0x5a6b4a, 0.85));
const sun = new THREE.DirectionalLight(0xfff1d0, 0.9);
sun.position.set(0.5, 1, 0.3);
scene.add(sun);
{ // the sun itself: a soft glowing disc far away in the light's direction, following the camera like the sky does
  const cv = document.createElement("canvas"); cv.width = cv.height = 128;
  const cx = cv.getContext("2d"), gr = cx.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, "rgba(255,255,245,1)"); gr.addColorStop(0.12, "rgba(255,250,220,0.95)");
  gr.addColorStop(0.3, "rgba(255,235,170,0.35)"); gr.addColorStop(1, "rgba(255,230,160,0)");
  cx.fillStyle = gr; cx.fillRect(0, 0, 128, 128);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({map: new THREE.CanvasTexture(cv), blending: THREE.AdditiveBlending,
                                                        depthWrite: false, fog: false, transparent: true}));
  const dir = sun.position.clone().normalize();
  sp.frustumCulled = false; sp.matrixAutoUpdate = false;
  sp.onBeforeRender = (r, s, cam) => sp.matrixWorld.makeScale(3200, 3200, 1).setPosition(
    cam.position.x + dir.x*9500, cam.position.y + dir.y*9500, cam.position.z + dir.z*9500);
  scene.add(sp);
}

{ // sky dome that follows whichever camera is rendering
  const g = new THREE.SphereGeometry(11000, 24, 14);
  const col = new Float32Array(g.attributes.position.count * 3);
  const hor = new THREE.Color(0xa9d3f5), zen = new THREE.Color(0x2c66c0), c = new THREE.Color();
  for (let i = 0; i < g.attributes.position.count; i++) {
    const h = clamp(g.attributes.position.getY(i) / 11000, 0, 1);
    c.copy(hor).lerp(zen, Math.pow(h, 0.6));
    col[i*3] = c.r; col[i*3+1] = c.g; col[i*3+2] = c.b;
  }
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  const sky = new THREE.Mesh(g, new THREE.MeshBasicMaterial({vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false}));
  sky.frustumCulled = false; sky.renderOrder = -1; sky.matrixAutoUpdate = false;
  sky.onBeforeRender = (r, s, cam) => sky.matrixWorld.setPosition(cam.position);
  scene.add(sky);
}

// ---------- terrain ----------
function terrainH(x, z){
  return 30 + 120*Math.sin(x*0.0011 + 1.3)*Math.cos(z*0.0013) + 60*Math.sin(x*0.004 + z*0.003)
            + 25*Math.sin(x*0.011)*Math.sin(z*0.009);
}
function groundAt(x, z){ return Math.max(WATER, terrainH(x, z)); }
function terrainSlope(x, z){                          // how steep the ground is (rise per metre)
  return Math.hypot(terrainH(x + 15, z) - terrainH(x - 15, z), terrainH(x, z + 15) - terrainH(x, z - 15)) / 30;
}
function forestAt(x, z){                              // above 0: woodland
  return Math.sin(x*0.0023 + 2.1) * Math.cos(z*0.0019 - 0.7) + 0.5*Math.sin(x*0.0061 + z*0.0052);
}
{
  const g = new THREE.PlaneGeometry(26000, 26000, 380, 380);
  g.rotateX(-Math.PI/2);
  const pos = g.attributes.position, col = new Float32Array(pos.count * 3), c = new THREE.Color(), k = new THREE.Color();
  const SAND = 0xd8c48a, SEABED = 0x7f9488, MEADOW = 0x6da146, GRASS = 0x4c8a38, WOOD = 0x366e30,
        ROCK = 0x8a8478, CLIFF = 0x6b665e, SNOW = 0xf5f7fa;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i), h = terrainH(x, z), sl = terrainSlope(x, z);
    pos.setY(i, h);
    if (h < 5) c.setHex(SAND).lerp(k.setHex(SEABED), clamp((2 - h) / 20, 0, 1));          // beaches, then the sea floor
    else {
      c.setHex(MEADOW).lerp(k.setHex(GRASS), clamp((h - 5) / 90, 0, 1));
      c.lerp(k.setHex(WOOD), clamp(forestAt(x, z) * 1.5, 0, 0.7));
      if (h < 9) c.lerp(k.setHex(SAND), (9 - h) / 4);
      c.lerp(k.setHex(ROCK), clamp((h - 135) / 40, 0, 1));                                // bare rock up high
      c.lerp(k.setHex(CLIFF), clamp((sl - 0.3) / 0.2, 0, 1));                             // and on anything steep
      c.lerp(k.setHex(SNOW), clamp((h - 188) / 18, 0, 1) * clamp(1.6 - sl*3, 0, 1));      // snow settles on the flatter summits
    }
    c.multiplyScalar(rand(0.95, 1.04));
    col[i*3] = c.r; col[i*3+1] = c.g; col[i*3+2] = c.b;
  }
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  scene.add(new THREE.Mesh(g, new THREE.MeshLambertMaterial({vertexColors: true})));
  const w = new THREE.Mesh(new THREE.PlaneGeometry(26000, 26000),
                           new THREE.MeshPhongMaterial({color: 0x2a74bd, specular: 0xcfe6ff, shininess: 70}));   // the sun glints off it
  w.rotation.x = -Math.PI/2; w.position.y = WATER;
  scene.add(w);

  // trees: thousands of little cones give the land texture, and a real sense of speed down low
  const m4 = new THREE.Matrix4(), q0 = new THREE.Quaternion(), sc = new V3(), ps = new V3();
  const TREES = 36000, tg = new THREE.ConeGeometry(0.42, 1, 5);
  tg.translate(0, 0.5, 0);
  const trees = new THREE.InstancedMesh(tg, new THREE.MeshLambertMaterial({color: 0xffffff}), TREES);
  let n = 0;
  for (let tries = 0; n < TREES && tries < TREES * 12; tries++) {
    const x = rand(-7500, 7500), z = rand(-7500, 7500), h = terrainH(x, z);
    if (h < 8 || h > 150 || forestAt(x, z) < rand(-0.5, 0.6) || terrainSlope(x, z) > 0.33) continue;
    const s = rand(9, 17);
    m4.compose(ps.set(x, h - 0.5, z), q0, sc.set(s * rand(0.8, 1.1), s, s * rand(0.8, 1.1)));
    trees.setMatrixAt(n, m4);
    trees.setColorAt(n, c.setHex(0x2f6b2c).lerp(k.setHex(0x4f8f3a), Math.random()).multiplyScalar(rand(0.85, 1.1)));
    n++;
  }
  trees.count = n; trees.frustumCulled = false;
  scene.add(trees);

  // villages on flat low ground
  const HOUSES = 640, hg = new THREE.BoxGeometry(1, 1, 1);
  hg.translate(0, 0.5, 0);
  const houses = new THREE.InstancedMesh(hg, new THREE.MeshLambertMaterial({color: 0xffffff}), HOUSES);
  const WALLS = [0xf1e9d8, 0xe6d3b3, 0xd9b38c, 0xc96f4a, 0xf5f5f0, 0xb8c4cc];
  let hn = 0;
  for (let v = 0, tries = 0; v < 16 && tries < 4000; tries++) {
    const cx = rand(-6500, 6500), cz = rand(-6500, 6500), ch = terrainH(cx, cz);
    if (ch < 8 || ch > 70 || terrainSlope(cx, cz) > 0.1) continue;
    v++;
    for (let j = Math.floor(rand(25, 46)); j > 0 && hn < HOUSES; j--) {
      const a = rand(0, Math.PI*2), r = Math.sqrt(Math.random()) * 230;
      const x = cx + Math.cos(a)*r, z = cz + Math.sin(a)*r, h = terrainH(x, z);
      if (h < 6) continue;
      m4.compose(ps.set(x, h - 1, z), q0.setFromAxisAngle(UP, rand(0, Math.PI)), sc.set(rand(9, 17), rand(6, 12), rand(9, 15)));
      houses.setMatrixAt(hn, m4);
      houses.setColorAt(hn, c.setHex(WALLS[Math.floor(rand(0, WALLS.length))]));
      hn++;
    }
  }
  houses.count = hn; houses.frustumCulled = false;
  scene.add(houses);
  // clouds: the best speed cue there is
  // lit from above with a soft glow of their own, so they have bright tops and blue-grey undersides
  const cg = new THREE.SphereGeometry(1, 10, 8);
  const cm = new THREE.MeshLambertMaterial({color: 0xffffff, emissive: 0x8d9bb0, transparent: true, opacity: 0.93});
  for (let i = 0; i < 150; i++) {
    const grp = new THREE.Group(), big = rand(0.7, 1.6);
    for (let j = 0; j < 7; j++) {
      const s = new THREE.Mesh(cg, cm);
      s.position.set(rand(-110, 110) * big, rand(-10, 16) * big, rand(-70, 70) * big);
      s.scale.set(rand(45, 100) * big, rand(22, 42) * big, rand(40, 85) * big);
      grp.add(s);
    }
    grp.position.set(rand(-8000, 8000), rand(520, 1100), rand(-8000, 8000));
    scene.add(grp);
  }
}

// ---------- particles (fire: additive, smoke: normal) ----------
const P_VERT = "attribute vec4 pcolor; attribute float psize; uniform float scale; varying vec4 vC;" +
  "void main(){ vC = pcolor; vec4 mv = modelViewMatrix * vec4(position, 1.0);" +
  " gl_PointSize = psize * scale / max(1.0, -mv.z); gl_Position = projectionMatrix * mv; }";
const P_FRAG = "varying vec4 vC; void main(){ float d = length(gl_PointCoord - 0.5);" +
  " float a = smoothstep(0.5, 0.12, d) * vC.a; if (a < 0.01) discard; gl_FragColor = vec4(vC.rgb, a); }";
function makeParticles(n, additive){
  const geo = new THREE.BufferGeometry();
  const P = {n, next: 0, pos: new Float32Array(n*3), col: new Float32Array(n*4), size: new Float32Array(n),
             vel: new Float32Array(n*3), life: new Float32Array(n), max: new Float32Array(n),
             grow: new Float32Array(n), grav: new Float32Array(n), a0: new Float32Array(n)};
  geo.setAttribute("position", new THREE.BufferAttribute(P.pos, 3));
  geo.setAttribute("pcolor", new THREE.BufferAttribute(P.col, 4));
  geo.setAttribute("psize", new THREE.BufferAttribute(P.size, 1));
  P.mat = new THREE.ShaderMaterial({uniforms: {scale: {value: 500}}, vertexShader: P_VERT, fragmentShader: P_FRAG,
    transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending});
  P.pts = new THREE.Points(geo, P.mat);
  P.pts.frustumCulled = false;
  scene.add(P.pts);
  return P;
}
// both use normal blending: additive fire turns white against a bright daytime sky
const SMOKE = makeParticles(2500, false), FIRE = makeParticles(3000, false);
function emit(P, x, y, z, vx, vy, vz, life, size, grow, grav, r, g, b, a){
  const i = P.next; P.next = (i + 1) % P.n;
  P.pos[i*3] = x; P.pos[i*3+1] = y; P.pos[i*3+2] = z;
  P.vel[i*3] = vx; P.vel[i*3+1] = vy; P.vel[i*3+2] = vz;
  P.life[i] = P.max[i] = life; P.size[i] = size; P.grow[i] = grow; P.grav[i] = grav; P.a0[i] = a;
  P.col[i*4] = r; P.col[i*4+1] = g; P.col[i*4+2] = b; P.col[i*4+3] = a;
}
function updateParticles(P, dt){
  for (let i = 0; i < P.n; i++) {
    if (P.life[i] <= 0) continue;
    P.life[i] -= dt;
    if (P.life[i] <= 0) { P.size[i] = 0; P.col[i*4+3] = 0; continue; }
    P.vel[i*3+1] -= P.grav[i] * dt;
    P.pos[i*3] += P.vel[i*3]*dt; P.pos[i*3+1] += P.vel[i*3+1]*dt; P.pos[i*3+2] += P.vel[i*3+2]*dt;
    P.size[i] += P.grow[i] * dt;
    P.col[i*4+3] = P.a0[i] * (P.life[i] / P.max[i]);
  }
  P.pts.geometry.attributes.position.needsUpdate = true;
  P.pts.geometry.attributes.pcolor.needsUpdate = true;
  P.pts.geometry.attributes.psize.needsUpdate = true;
}

// ---------- sound ----------
let actx = null, noiseBuf = null;
function audioOn(){
  if (!actx) {
    try {
      actx = new (window.AudioContext || window.webkitAudioContext)();
      noiseBuf = actx.createBuffer(1, actx.sampleRate, actx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random()*2 - 1;
    } catch (e) {}
  }
  if (actx && actx.state === "suspended") actx.resume();
}
function beep(type, f0, f1, dur, vol){
  if (!actx) return;
  const o = actx.createOscillator(), g = actx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, actx.currentTime);
  o.frequency.exponentialRampToValueAtTime(f1, actx.currentTime + dur);
  g.gain.setValueAtTime(vol || 0.08, actx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, actx.currentTime + dur);
  o.connect(g); g.connect(actx.destination);
  o.start(); o.stop(actx.currentTime + dur);
}
function boom(vol, dur){
  if (!actx) return;
  const s = actx.createBufferSource(), f = actx.createBiquadFilter(), g = actx.createGain();
  s.buffer = noiseBuf; f.type = "lowpass";
  f.frequency.setValueAtTime(900, actx.currentTime);
  f.frequency.exponentialRampToValueAtTime(60, actx.currentTime + dur);
  g.gain.setValueAtTime(vol, actx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, actx.currentTime + dur);
  s.connect(f); f.connect(g); g.connect(actx.destination);
  s.start(); s.stop(actx.currentTime + dur);
}

// ---------- models (all facing -Z, like a camera) ----------
const lam = (c, e) => new THREE.MeshLambertMaterial({color: c, emissive: e || 0});
const glow = c => new THREE.MeshBasicMaterial({color: c});
function part(geo, m, x, y, z){ const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); return o; }
function makePlaneMesh(bodyCol, trimCol){
  const g = new THREE.Group(), body = lam(bodyCol), trim = lam(trimCol);
  const fus = new THREE.CylinderGeometry(0.75, 0.45, 8, 10); fus.rotateX(Math.PI/2);
  const nose = new THREE.ConeGeometry(0.75, 2.6, 10); nose.rotateX(-Math.PI/2);
  const can = new THREE.SphereGeometry(0.62, 10, 8); can.scale(1, 0.75, 2);
  g.add(part(fus, body, 0, 0, 0), part(nose, trim, 0, 0, -5.3),
        part(can, lam(0x16263a), 0, 0.55, -1.4),
        part(new THREE.BoxGeometry(11, 0.16, 2.3), body, 0, -0.1, 0.4),
        part(new THREE.BoxGeometry(1.2, 0.2, 2.3), trim, -5.6, -0.1, 0.4),
        part(new THREE.BoxGeometry(1.2, 0.2, 2.3), trim, 5.6, -0.1, 0.4),
        part(new THREE.BoxGeometry(4.4, 0.13, 1.3), body, 0, 0.1, 3.6),
        part(new THREE.BoxGeometry(0.16, 1.9, 1.6), trim, 0, 1.0, 3.5),
        part(new THREE.SphereGeometry(0.42, 8, 6), glow(0xffc070), 0, 0, 4.1));
  return g;
}
const raiderGeo = (() => {                            // a flat four-sided dart
  const g = new THREE.ConeGeometry(7, 28, 4); g.rotateX(-Math.PI/2); g.scale(1.25, 0.3, 1); return g;
})();
function makeRaiderMesh(){
  const g = new THREE.Group(), hull = lam(0x5a606c), dark = lam(0x33373f);
  const pod = new THREE.CylinderGeometry(1.5, 1.8, 11, 8); pod.rotateX(Math.PI/2);
  g.add(part(raiderGeo, hull, 0, 0, 0), part(new THREE.BoxGeometry(4.5, 2.6, 6), dark, 0, 1.8, 7),
        part(pod, dark, -7.5, -0.4, 7), part(pod, dark, 7.5, -0.4, 7),
        part(new THREE.BoxGeometry(17, 0.5, 2.5), hull, 0, -0.3, 9.5));
  for (const x of [-7.5, 0, 7.5]) g.add(part(new THREE.SphereGeometry(1.5, 8, 6), glow(0xff5a2a), x, x ? -0.4 : 0.4, 13.2));
  return g;
}

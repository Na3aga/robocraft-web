"use strict";
// =====================================================================================
//  Sky Squadron — game logic. world.js (loaded first) builds the scenery, particles,
//  sound and the raider model. This file: block-built planes, the hangar, the fighting.
// =====================================================================================

// ---------- flight model (mass = 1, so forces are accelerations) ----------
const KL = 0.0051, KD0 = 0.0013, KDI = 0.0005, KY = 0.004;   // lift, parasitic drag, induced drag, side force
const CRUISE = 0.6;                                          // throttle that holds level flight at ~360 km/h
const STALL = 0.27, CLA = 4.8, INCIDENCE = 0.04;             // stall angle (rad), lift slope, wing incidence
const TMAX = 22, GLIMIT = 9;                                 // thrust at 100 %, structural G limit
const KA = 11, KR = 13, KYAW = 2, KB = 8;                    // stability and control powers
const DP = 2, DR = 3, DY = 3;                                // rotational damping

// ---------- guns and skills ----------
// "every" is per gun part: two lasers alternate, so the starter plane fires a bolt every 0.11 s.
// home = how fast a shot can bend towards the target it was fired at (radians per second).
const GUNS = {
  pulse:   {id: "pulse",   name: "Pulse",   dmg: 1.5, every: 0.22, speed: 660,  life: 1.8,  n: 1, spread: 0,    home: 0.25, snd: ["square", 900, 300, 0.07, 0.035]},
  scatter: {id: "scatter", name: "Scatter", dmg: 1.3, every: 0.6,  speed: 600,  life: 1.5,  n: 6, spread: 0.03, home: 0.15, snd: ["sawtooth", 520, 150, 0.1, 0.05]},
  rail:    {id: "rail",    name: "Rail",    dmg: 8,   every: 1.8,  speed: 1300, life: 0.95, n: 1, spread: 0,    home: 0.1,  snd: ["square", 1700, 180, 0.25, 0.06], pierce: true},
  plasma:  {id: "plasma",  name: "Plasma",  dmg: 4.5, every: 0.8,  speed: 580,  life: 2.0,  n: 1, spread: 0,    home: 0.35, snd: ["sine", 320, 110, 0.2, 0.07], splash: 60, splashDmg: 2.5, fuse: 14}};
const SKILLS = {shield: "Energy shield", overdrive: "Overdrive", repair: "Repair pulse", emp: "EMP burst"};
const skillCool = l => 30 * Math.max(0.4, 1 - 0.15*(l - 1));
const skillPower = l => 1 + 0.15*(l - 1);

// ---------- parts: what a plane is built from. Each one occupies a grid cell and does something. ----------
const CELL = 1.2;                                    // metres per grid cell
const GX = 5, GY = 3, GZ = 7;                        // grid half-sizes: x -5..5 (wing span), y -3..3, z -7..7 (z < 0 is the nose)
const START_POINTS = 100, WAVE_POINTS = 20;          // spare points in a new game, and what every cleared wave pays
const DUEL_KILLS = 3, PVP_DMG = 4;                   // PVP_DMG: gun and missile damage is scaled up against a rival's hull
const PALETTE = [0x2f7fe0, 0xf08a24, 0xf2f2f2, 0x33373f, 0xd32f2f, 0x43a047, 0xfdd835, 0x8e24aa, 0x00acc1, 0x8d6e63];
const PALETTE_NAMES = ["blue", "orange", "white", "black", "red", "green", "yellow", "purple", "cyan", "brown"];
const PARTS = {
  cockpit:   {name: "Cockpit",          cost: 0, hp: 30, mass: 2,   info: "The pilot. Every plane has exactly one"},
  cube:      {name: "Hull block",       cost: 1, hp: 8,  mass: 1,   info: "+8 hull. Cheap structure to build on"},
  wedge:     {name: "Wedge",            cost: 1, hp: 6,  mass: 0.7, info: "Sloped hull block. Turns itself to fit its neighbours; a little less drag"},
  cone:      {name: "Nose cone",        cost: 1, hp: 5,  mass: 0.5, info: "Tapered tip that points away from what it is attached to: 3% less drag"},
  armor:     {name: "Armor block",      cost: 2, hp: 25, mass: 2.5, info: "+25 hull, but heavy: wider turns, slower boost"},
  wing:      {name: "Wing panel",       cost: 2, hp: 3,  mass: 0.4, info: "Lift. More wing for the weight = tighter turns"},
  fin:       {name: "Control fin",      cost: 2, hp: 2,  mass: 0.3, info: "Far out on a wing: faster roll. At the tail: faster pitch"},
  thruster:  {name: "Thruster",         cost: 3, hp: 4,  mass: 1.2, info: "Afterburner thrust: acceleration and top speed"},
  tank:      {name: "Boost tank",       cost: 2, hp: 3,  mass: 0.8, info: "+40% afterburner fuel, and it refills faster"},
  laser:     {name: "Pulse laser",      cost: 4, hp: 3,  mass: 0.6, gun: "pulse",   info: "Fast bolts, good at everything"},
  scatter:   {name: "Scatter gun",      cost: 5, hp: 3,  mass: 0.8, gun: "scatter", info: "6-bolt spread, shreds up close"},
  rail:      {name: "Rail cannon",      cost: 6, hp: 3,  mass: 1.2, gun: "rail",    info: "Slow heavy slug that pierces a whole line"},
  plasma:    {name: "Plasma launcher",  cost: 6, hp: 3,  mass: 1.2, gun: "plasma",  info: "Proximity-fused bolts with a 60 m blast"},
  pod:       {name: "Missile pod",      cost: 4, hp: 3,  mass: 0.8, info: "+3 homing missiles. 3 pods fire 2 at once, 5 pods fire 3"},
  radar:     {name: "Targeting unit",   cost: 3, hp: 2,  mass: 0.3, info: "Aim ring +1 degree (5 units max), shots track better"},
  shield:    {name: "Shield generator", cost: 5, hp: 3,  mass: 0.8, skill: "shield",    info: "Skill: nothing can hurt you for 3 s"},
  overdrive: {name: "Overdrive core",   cost: 5, hp: 3,  mass: 0.8, skill: "overdrive", info: "Skill: double fire rate and free afterburner for 5 s"},
  repair:    {name: "Repair unit",      cost: 5, hp: 3,  mass: 0.8, skill: "repair",    info: "Skill: heals you, and a wingman within 400 m"},
  emp:       {name: "EMP coil",         cost: 5, hp: 3,  mass: 0.8, skill: "emp",       info: "Skill: stuns raiders nearby; jams a rival's guns"}};
const PART_ORDER = ["cube", "wedge", "cone", "armor", "wing", "fin", "thruster", "tank", "laser", "scatter", "rail", "plasma", "pod", "radar", "shield", "overdrive", "repair", "emp"];
const NEIGH = [[1,0,0], [-1,0,0], [0,1,0], [0,-1,0], [0,0,1], [0,0,-1]];
const key = (x, y, z) => x + "," + y + "," + z;

// A build is a Map from "x,y,z" to {x, y, z, t: part id, c: palette index}.
function starterBuild(i){
  const b = new Map(), main = i ? 1 : 0, trim = i ? 3 : 2;
  const add = (x, y, z, t, c) => b.set(key(x, y, z), {x, y, z, t, c});
  add(0, 0, 0, "cockpit", main);
  add(0, 0, -2, "cube", trim); add(0, 0, -1, "cube", main);
  for (const z of [1, 2, 3]) add(0, 0, z, "cube", main);
  for (const s of [-1, 1]) {
    add(s, 0, 0, "wing", main); add(2*s, 0, 0, "wing", main); add(3*s, 0, 0, "wing", trim);
    add(4*s, 0, 0, "fin", trim);                      // wing-tip fins: roll
    add(s, 0, 3, "fin", main);                        // tailplane: pitch
    add(s, 0, -1, "laser", trim);
  }
  add(0, 1, 3, "fin", trim);
  add(0, 0, 4, "thruster", trim);
  add(0, -1, 0, "pod", trim);
  return b;
}
function buildCost(b){ let c = 0; for (const q of b.values()) c += PARTS[q.t].cost; return c; }
function connected(b){                                // does every part hang together with the cockpit?
  const seen = new Set(["0,0,0"]), todo = [[0, 0, 0]];
  while (todo.length) {
    const [x, y, z] = todo.pop();
    for (const [dx, dy, dz] of NEIGH) {
      const k = key(x + dx, y + dy, z + dz);
      if (b.has(k) && !seen.has(k)) { seen.add(k); todo.push([x + dx, y + dy, z + dz]); }
    }
  }
  return seen.size === b.size;
}
function measure(b){                                  // raw totals of a build
  const m = {mass: 0, hp: 0, wing: 0, thr: 0, tank: 0, roll: 0, pitch: 0, ixx: 0, pods: 0, radar: 0, sleek: 0,
             guns: [], thrusters: [], skills: {}, ext: 0};
  const front = new Set();
  for (const q of b.values()) {
    const d = PARTS[q.t];
    m.mass += d.mass; m.hp += d.hp; m.ixx += d.mass * (q.x*q.x + q.y*q.y);
    front.add(q.x + "," + q.y);
    m.ext = Math.max(m.ext, Math.abs(q.x), Math.abs(q.y), Math.abs(q.z));
    if (q.t === "wing") m.wing++;
    else if (q.t === "fin") { m.roll += Math.abs(q.x); m.pitch += Math.max(0, q.z); }
    else if (q.t === "thruster") { m.thr++; m.thrusters.push(q); }
    else if (q.t === "tank") m.tank++;
    else if (q.t === "pod") m.pods++;
    else if (q.t === "radar") m.radar++;
    else if (q.t === "cone") m.sleek += 0.03;
    else if (q.t === "wedge") m.sleek += 0.015;
    else if (d.gun) m.guns.push(q);
    else if (d.skill) m.skills[d.skill] = (m.skills[d.skill] || 0) + 1;
  }
  m.frontal = front.size;                             // how big the plane looks from the front = drag
  return m;
}
const REF = measure(starterBuild(0));                 // the starter plane flies exactly like the tuned flight model

function recalc(p){                                   // turn a pilot's build into the numbers the game reads (p.st)
  const m = measure(p.build), s = p.st;
  const wingLoad = (m.wing / m.mass) / (REF.wing / REF.mass);
  s.stall = STALL * clamp(0.5 + 0.5*wingLoad, 0.45, 1.7);       // more wing per ton: later stall = more turning lift
  s.gLimit = GLIMIT * clamp(0.6 + 0.4*wingLoad, 0.6, 1.6);
  const twr = (m.thr / m.mass) / (REF.thr / REF.mass);
  s.burn = clamp(1.6 * (0.3 + 0.7*twr), CRUISE * 1.15, 3.6);    // afterburner throttle (cruise stays at 360 km/h)
  s.drag = clamp((1 + 0.035 * (m.frontal - REF.frontal)) * (1 - Math.min(0.25, m.sleek)), 0.6, 2);   // tapered blocks cut drag
  s.pitchK = clamp(0.6 + 0.4 * m.pitch / REF.pitch, 0.5, 2.2);  // tail fins: stiffer, better damped pitch axis
  s.ka = KA * s.pitchK; s.dp = DP * Math.sqrt(s.pitchK);
  const droop = 0.51 / Math.sqrt(s.pitchK);           // pitch-rate damping eats this share of the stick in a turn
  s.kp = s.ka * ((s.stall - INCIDENCE) * (1 + droop) + droop*INCIDENCE);   // full stick = just reaching the stall angle
  s.rollK = clamp(0.55 + 0.45 * m.roll / REF.roll, 0.45, 2.6) / clamp(Math.sqrt(m.ixx / REF.ixx), 0.75, 1.8);
  s.kr = KR * s.rollK;
  s.boostCap = 100 * (1 + 0.4*m.tank); s.boostRegen = 12 * (1 + 0.25*m.tank);
  s.maxHp = m.hp; s.mass = m.mass;
  s.topKmh = Math.round(Math.sqrt(TMAX * s.burn / (KD0 * s.drag)) * 3.6);
  // weapons: every gun part fires from where it sits
  const perClass = {}, seenClass = {};
  for (const q of m.guns) { const id = PARTS[q.t].gun; perClass[id] = (perClass[id] || 0) + 1; }
  s.guns = m.guns.map(q => {
    const g = GUNS[PARTS[q.t].gun], k = seenClass[g.id] = (seenClass[g.id] || 0) + 1;
    return {g, x: q.x*CELL, y: q.y*CELL, z: q.z*CELL, phase: (k - 1) / perClass[g.id] * g.every};   // same guns take turns
  });
  s.gunRange = s.guns.reduce((a, gp) => Math.max(a, gp.g.speed * gp.g.life), 0);
  s.gunText = Object.keys(perClass).map(id => perClass[id] + "× " + GUNS[id].name).join(", ") || "none";
  const radar = Math.min(5, m.radar);
  s.aimDeg = 10 + radar; s.aimCos = Math.cos(s.aimDeg * Math.PI/180); s.track = 1 + 0.2*radar;
  s.mslCap = m.pods ? Math.min(13, 1 + 3*m.pods) : 0;
  s.salvo = m.pods >= 5 ? 3 : m.pods >= 3 ? 2 : 1;
  s.mslReload = 6 / (1 + 0.25 * Math.max(0, m.pods - 1)); s.mslDmg = 6 * (1 + 0.1 * Math.max(0, m.pods - 1));
  p.skillClass = null; s.skillLvl = 0;
  for (const id in m.skills) if (m.skills[id] > s.skillLvl) { s.skillLvl = m.skills[id]; p.skillClass = id; }
  s.size = (2*m.ext + 1) * CELL;
  s.hitR = clamp(0.45 * s.size, 4.5, 9);              // a bigger plane is a bigger target
  s.thrusters = m.thrusters.slice(0, 6).map(q => [q.x*CELL, q.y*CELL, q.z*CELL + 0.7]);
  p.r = s.hitR; p.maxHp = s.maxHp;                    // so a rival pilot can be targeted like a raider
  p.gunCd = s.guns.map(() => 0);
  if (p.missiles > s.mslCap) p.missiles = s.mslCap;
}

// ---------- block models ----------
// Blocks fill their grid cell and have chamfered edges, so neighbours sit flush with a visible seam between them.
// Shaped parts look at what is around them: wings blend into wings and taper only at free edges, fins, cones
// and wedges turn themselves to face away from the block they are attached to.
// A whole plane is merged into two meshes (lit parts and glowing parts) however many blocks it has.
const C = CELL;
function chamferBox(sx, sy, sz, b){
  const hx = sx/2 - b, hy = sy/2 - b, sh = new THREE.Shape();
  sh.moveTo(-hx, -hy); sh.lineTo(hx, -hy); sh.lineTo(hx, hy); sh.lineTo(-hx, hy); sh.lineTo(-hx, -hy);
  const g = new THREE.ExtrudeGeometry(sh, {depth: sz - 2*b, bevelEnabled: true, bevelThickness: b, bevelSize: b, bevelSegments: 1, steps: 1});
  g.translate(0, 0, -(sz - 2*b)/2);
  return g;
}
function extrudeX(points, len){                       // a profile of [z, y] points, extruded along x and centred
  const sh = new THREE.Shape();
  points.forEach(([z, y], i) => { if (i) sh.lineTo(-z, y); else sh.moveTo(-z, y); });
  const g = new THREE.ExtrudeGeometry(sh, {depth: len, bevelEnabled: false, steps: 1});
  g.rotateY(Math.PI/2);                               // profile x -> -z, extrusion -> +x
  g.translate(-len/2, 0, 0);
  return g;
}
const BG = (() => {
  const rotX = g => { g.rotateX(Math.PI/2); return g; };       // cylinders: axis along z, their "top" end at the rear
  const flat = g => { const n = g.toNonIndexed(); n.computeVertexNormals(); return n; };
  const th = 0.085;                                   // wing half-thickness, in cells
  const wing = pts => extrudeX(pts.map(([z, y]) => [z*C, y*C]), C);
  const le = [[-0.5, 0], [-0.44, -0.055], [-0.32, -th]], leBack = [[-0.32, th], [-0.44, 0.055]];
  const fin = (() => {                                // swept plate: root on the -x side, tip towards +x
    const sh = new THREE.Shape();
    [[-0.5, -0.45], [0.45, 0.05], [0.45, 0.5], [-0.5, 0.5]].forEach(([x, z], i) => { if (i) sh.lineTo(x*C, z*C); else sh.moveTo(x*C, z*C); });
    const g = new THREE.ExtrudeGeometry(sh, {depth: 0.08*C, bevelEnabled: false, steps: 1});
    g.rotateX(Math.PI/2);
    g.translate(0, 0.04*C, 0);
    return g;
  })();
  const cone = flat(new THREE.CylinderGeometry(0.14*C, 0.7*C, C, 4, 1));
  cone.rotateY(Math.PI/4);                            // square base that matches a block face; the tip is at +y
  const canopy = new THREE.SphereGeometry(0.42*C, 14, 10); canopy.scale(0.86, 0.66, 1.12);
  const cap = new THREE.SphereGeometry(0.4*C, 12, 8); cap.scale(1, 1, 0.5);
  const glowDisc = new THREE.SphereGeometry(0.27*C, 10, 8); glowDisc.scale(1, 1, 0.45);
  return {
    cube: chamferBox(C, C, C, 0.07*C),
    wedge: extrudeX([[-0.5*C, -0.5*C], [0.5*C, -0.5*C], [0.5*C, 0.5*C]], C),      // bottom at -y, tall back face at +z
    cone,
    plateY: chamferBox(0.72*C, 0.08*C, 0.72*C, 0.02*C),
    plateX: chamferBox(0.08*C, 0.72*C, 0.72*C, 0.02*C),
    plate: chamferBox(0.9*C, 0.14*C, 0.9*C, 0.03*C),
    wing: [                                           // index bit 0: rounded leading edge, bit 1: tapered trailing edge
      wing([[-0.5, -th], [0.5, -th], [0.5, th], [-0.5, th]]),
      wing(le.concat([[0.5, -th], [0.5, th]], leBack)),
      wing([[-0.5, -th], [0.05, -th], [0.5, -0.012], [0.5, 0.012], [0.05, th], [-0.5, th]]),
      wing(le.concat([[0.05, -th], [0.5, -0.012], [0.5, 0.012], [0.05, th]], leBack))],
    fin,
    thrBody: rotX(new THREE.CylinderGeometry(0.42*C, 0.47*C, 0.7*C, 16)),
    thrNozzle: rotX(new THREE.CylinderGeometry(0.3*C, 0.4*C, 0.3*C, 16)),
    thrGlow: glowDisc,
    tankBody: rotX(new THREE.CylinderGeometry(0.4*C, 0.4*C, 0.6*C, 16)),
    tankCap: cap,
    tankBand: rotX(new THREE.CylinderGeometry(0.42*C, 0.42*C, 0.2*C, 16)),
    cockBase: chamferBox(C, 0.6*C, C, 0.07*C),
    canopy,
    gunBase: chamferBox(0.62*C, 0.44*C, 0.86*C, 0.05*C),
    barrel: rotX(new THREE.CylinderGeometry(0.06*C, 0.06*C, 0.9*C, 8)),
    tip: new THREE.SphereGeometry(0.11*C, 8, 6),
    podBody: chamferBox(0.88*C, 0.72*C, C, 0.05*C),
    podTube: rotX(new THREE.CylinderGeometry(0.12*C, 0.12*C, 0.1*C, 10)),
    stem: new THREE.CylinderGeometry(0.06*C, 0.06*C, 0.4*C, 8),
    dish: new THREE.CylinderGeometry(0.38*C, 0.08*C, 0.14*C, 16),
    post: new THREE.BoxGeometry(0.08*C, 0.6*C, 0.08*C),
    orb: new THREE.SphereGeometry(0.3*C, 12, 10)};
})();

function makeBatch(){ return {pos: [], nor: [], col: [], idx: []}; }
const _bn3 = new THREE.Matrix3(), _bv3 = new V3();
function batchAdd(B, geo, m, col){                    // append a geometry, transformed by m and painted col
  const P = geo.attributes.position, N = geo.attributes.normal, base = B.pos.length / 3;
  _bn3.getNormalMatrix(m);
  for (let i = 0; i < P.count; i++) {
    _bv3.fromBufferAttribute(P, i).applyMatrix4(m); B.pos.push(_bv3.x, _bv3.y, _bv3.z);
    _bv3.fromBufferAttribute(N, i).applyMatrix3(_bn3).normalize(); B.nor.push(_bv3.x, _bv3.y, _bv3.z);
    B.col.push(col.r, col.g, col.b);
  }
  if (geo.index) for (let i = 0; i < geo.index.count; i++) B.idx.push(base + geo.index.getX(i));
  else for (let i = 0; i < P.count; i++) B.idx.push(base + i);
}
function batchMesh(B, mat){
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(B.pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(B.nor, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(B.col, 3));
  g.setIndex(B.idx);
  return new THREE.Mesh(g, mat);
}
const colCache = {};
const paintCol = i => colCache[i] || (colCache[i] = new THREE.Color(PALETTE[i]));
const DARK = new THREE.Color(0x25282e), METAL = new THREE.Color(0x9aa0a8), GLASS = new THREE.Color(0x1b3550);
const HOT = new THREE.Color(0xffc070), PLATE = new THREE.Color(0x3a3f47), _shade = new THREE.Color();
const SKILL_COL = {shield: new THREE.Color(0x60c8ff), overdrive: new THREE.Color(0xffd040), repair: new THREE.Color(0x60ff90), emp: new THREE.Color(0xc070ff)};
const TIP_COL = {pulse: new THREE.Color(0x60e0ff), scatter: new THREE.Color(0xffb040), rail: new THREE.Color(0xffffff), plasma: new THREE.Color(0x7dff5a)};
const LIT_MAT = new THREE.MeshPhongMaterial({vertexColors: true, specular: 0x555555, shininess: 40});
const GLOW_MAT = new THREE.MeshBasicMaterial({vertexColors: true});
const Y_AXIS = new V3(0, 1, 0);
const _orient = new THREE.Matrix4(), _cell = new THREE.Matrix4(), _pm = new THREE.Matrix4(), _rq = new Quat(), _rv = new V3();

function partPieces(q, b, lit, glw){                  // add one part's shapes; b is the build its neighbours are read from
  const d = PARTS[q.t], t = q.t, col = paintCol(q.c);
  const nb = (dx, dy, dz) => b.has(key(q.x + dx, q.y + dy, q.z + dz));
  _orient.identity();
  if (t === "cone") {                                 // the tip points away from the block it is attached to
    const dir = nb(0,0,1) && !nb(0,0,-1) ? [0,0,-1] : nb(0,0,-1) && !nb(0,0,1) ? [0,0,1]
              : nb(-1,0,0) && !nb(1,0,0) ? [1,0,0] : nb(1,0,0) && !nb(-1,0,0) ? [-1,0,0]
              : nb(0,-1,0) && !nb(0,1,0) ? [0,1,0] : nb(0,1,0) && !nb(0,-1,0) ? [0,-1,0] : [0,0,-1];
    _orient.makeRotationFromQuaternion(_rq.setFromUnitVectors(Y_AXIS, _rv.set(dir[0], dir[1], dir[2])));
  } else if (t === "wedge") {                         // tall face against a neighbour, slope falling away from it
    _orient.makeRotationY(nb(0,0,1) ? 0 : nb(0,0,-1) ? Math.PI : nb(-1,0,0) ? -Math.PI/2 : nb(1,0,0) ? Math.PI/2 : 0);
    if (!nb(0,-1,0) && nb(0,1,0)) _orient.multiply(_pm.makeRotationZ(Math.PI));      // hanging under something: upside down
  } else if (t === "fin") {                           // root towards the neighbour: on top of a block it stands up, beside one it sticks out
    _orient.makeRotationZ(nb(0,-1,0) ? Math.PI/2 : nb(-1,0,0) && !nb(1,0,0) ? 0 : nb(1,0,0) && !nb(-1,0,0) ? Math.PI
                        : nb(0,1,0) ? -Math.PI/2 : nb(-1,0,0) ? 0 : Math.PI/2);
  }
  _cell.makeTranslation(q.x*C, q.y*C, q.z*C).multiply(_orient);
  const put = (B, geo, c, x, y, z, sx, sy, sz) => {
    _pm.makeTranslation(x || 0, y || 0, z || 0);
    if (sx) _pm.scale(_rv.set(sx, sy || sx, sz || sx));
    batchAdd(B, geo, _pm.premultiply(_cell), c);
  };
  if (t === "cube") put(lit, BG.cube, col);
  else if (t === "wedge") put(lit, BG.wedge, col);
  else if (t === "cone") put(lit, BG.cone, col);
  else if (t === "armor") {
    put(lit, BG.cube, _shade.copy(col).multiplyScalar(0.72));
    for (const s of [-1, 1]) { put(lit, BG.plateY, PLATE, 0, s*0.47*C, 0); put(lit, BG.plateX, PLATE, s*0.47*C, 0, 0); }
  }
  else if (t === "wing") put(lit, BG.wing[(nb(0,0,-1) ? 0 : 1) + (nb(0,0,1) ? 0 : 2)], col);   // taper only the edges that are free
  else if (t === "fin") put(lit, BG.fin, col);
  else if (t === "thruster") {
    put(lit, BG.thrBody, col, 0, 0, -0.14*C); put(lit, BG.thrNozzle, DARK, 0, 0, 0.3*C); put(glw, BG.thrGlow, HOT, 0, 0, 0.4*C);
  }
  else if (t === "tank") {
    put(lit, BG.tankBody, METAL); put(lit, BG.tankCap, METAL, 0, 0, -0.3*C); put(lit, BG.tankCap, METAL, 0, 0, 0.3*C); put(lit, BG.tankBand, col);
  }
  else if (t === "cockpit") { put(lit, BG.cockBase, col, 0, -0.2*C, 0); put(lit, BG.canopy, GLASS, 0, 0.1*C, -0.03*C); }
  else if (d.gun) {
    put(lit, BG.gunBase, col, 0, -0.05*C, 0.05*C);
    if (d.gun === "pulse") for (const s of [-1, 1]) put(lit, BG.barrel, DARK, s*0.14*C, 0.04*C, -0.5*C);
    else if (d.gun === "scatter") for (const s of [-1, 0, 1]) put(lit, BG.barrel, DARK, s*0.19*C, 0.04*C, -0.42*C, 1.7, 1.7, 0.7);
    else if (d.gun === "rail") {
      put(lit, BG.barrel, METAL, 0, 0.04*C, -0.75*C, 1.3, 1.3, 1.6);
      for (const s of [-1, 1]) put(lit, BG.barrel, DARK, s*0.2*C, 0.04*C, -0.45*C, 0.9, 0.9, 1);
    }
    else put(lit, BG.barrel, DARK, 0, 0.04*C, -0.4*C, 3, 3, 0.8);
    put(glw, BG.tip, TIP_COL[d.gun], 0, 0.04*C, -C * (d.gun === "rail" ? 1.48 : d.gun === "pulse" ? 0.96 : 0.78));
  }
  else if (t === "pod") {
    put(lit, BG.podBody, col);
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) put(lit, BG.podTube, DARK, sx*0.2*C, sy*0.16*C, -0.47*C);
  }
  else if (t === "radar") {
    put(lit, BG.plate, col, 0, -0.42*C, 0); put(lit, BG.stem, METAL, 0, -0.2*C, 0); put(lit, BG.dish, METAL, 0, 0.08*C, 0);
    put(glw, BG.tip, HOT, 0, 0.2*C, 0, 0.7);
  }
  else if (d.skill) {
    put(lit, BG.plate, col, 0, -0.42*C, 0);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) put(lit, BG.post, DARK, sx*0.34*C, -0.06*C, sz*0.34*C);
    put(glw, BG.orb, SKILL_COL[d.skill]);
  }
}
function buildGroup(b, around, ghost){                // around: the build whose neighbours decide the shapes (default: b itself)
  const lit = makeBatch(), glw = makeBatch();
  for (const q of b.values()) partPieces(q, around || b, lit, glw);
  const g = new THREE.Group();
  if (lit.pos.length) {
    const m = batchMesh(lit, ghost || LIT_MAT);
    m.castShadow = m.receiveShadow = !ghost;
    g.add(m);
  }
  if (glw.pos.length) g.add(batchMesh(glw, ghost || GLOW_MAT));
  return g;
}
function dropGroup(parent, g){                        // remove a built model and free its geometry
  if (!g) return;
  parent.remove(g);
  g.traverse(o => { if (o.geometry) o.geometry.dispose(); });
}

// ---------- the hangar: a separate little scene where each pilot's plane sits on a pad ----------
const hangar = new THREE.Scene();
hangar.background = new THREE.Color(0x18202e);
hangar.add(new THREE.HemisphereLight(0xffffff, 0x445066, 0.8));
const hangarSun = new THREE.DirectionalLight(0xffffff, 0.85);   // moved over whichever pad is being drawn, so its shadow map stays tight
hangarSun.castShadow = true;
hangarSun.shadow.mapSize.set(2048, 2048);
hangarSun.shadow.camera.left = hangarSun.shadow.camera.bottom = -19;
hangarSun.shadow.camera.right = hangarSun.shadow.camera.top = 19;
hangarSun.shadow.camera.near = 1; hangarSun.shadow.camera.far = 90;
hangarSun.shadow.normalBias = 0.04;
hangar.add(hangarSun, hangarSun.target);

// ---------- players ----------
// A player is a slot: who controls it (this machine's devices now, the network later) is decided elsewhere.
// Everything about who fights whom goes through p.team, never through "the other player".
const players = [];
const PILOT_CSS = ["#7fc0ff", "#ffb060", "#80e090", "#e58fe0"], PILOT_BOLT = [0x60e0ff, 0xffd040, 0x80ff90, 0xff90f0];
function allies(p){ return players.filter(q => q !== p && q.active && q.team === p.team); }
function rivals(p){ return players.filter(q => q.active && q.team !== p.team); }
function makePlayer(i){
  const mesh = new THREE.Group();                     // the plane in the world; the block model goes inside
  mesh.visible = false;
  const bubble = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12),
                                new THREE.MeshBasicMaterial({color: 0x80d0ff, transparent: true, opacity: 0.22, depthWrite: false}));
  bubble.visible = false;
  mesh.add(bubble);
  scene.add(mesh);

  const edRoot = new THREE.Group();                   // this pilot's pad in the hangar
  edRoot.position.set(i * 300, 0, 0);
  const floorY = -(GY + 1) * CELL;
  const pad = part(new THREE.CylinderGeometry(15, 15, 0.4, 48), lam(0x2a3448), 0, floorY - 0.25, 0);
  pad.receiveShadow = true;
  edRoot.add(pad);
  const grid = new THREE.GridHelper(CELL * 22, 22, 0x4a5d80, 0x33415c); grid.position.y = floorY; edRoot.add(grid);
  const wireGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(CELL*1.06, CELL*1.06, CELL*1.06));
  const cursor = new THREE.LineSegments(wireGeo, new THREE.LineBasicMaterial({color: 0xffffff}));
  const cursor2 = new THREE.LineSegments(wireGeo, new THREE.LineBasicMaterial({color: 0x8090a8}));
  edRoot.add(cursor, cursor2);
  hangar.add(edRoot);

  return {i, isPlayer: true, name: "Pilot " + (i + 1), css: PILOT_CSS[i % 4], bolt: glow(PILOT_BOLT[i % 4]),
          active: false, team: 0,                     // active: takes part in this game; team: same team = allies
          remote: false, netCmd: null,                // remote: flown from another machine, by the commands in netCmd (see js/net.js)
          mouse: {on: false, yaw: 0, pit: 0, blend: 0},   // mouse-aim flight: where the pilot is pointing, and how much the camera follows it
          mesh, bubble, model: null, pos: mesh.position, q: mesh.quaternion, vel: new V3(), w: new V3(),
          ctl: {pitch: 0, roll: 0, yaw: 0}, cam: new THREE.PerspectiveCamera(70, 1, 1, 15000),
          hp: 100, alive: false, respawnT: -1, shield: 0, missiles: 0, missileT: 0, missileCd: 0, gunCd: [], wasFiring: false,
          thr: 0.7, boost: 100, gLoad: 1, alpha: 0, stalled: false, speed: 0, invert: false,
          lock: null, aim: null, shake: 0, flash: 0, hitT: 0, ramCd: 0, linked: false, jam: 0, lastHitBy: null,
          kills: 0, killsAtWave: 0, waveDeaths: 0, duelKills: 0, skillCd: 0, skillMax: 1, overT: 0, skillClass: null,
          build: starterBuild(i), bank: 0, earned: [], ready: false, st: {}, r: 5, maxHp: 100,
          edRoot, edModel: null, cursor, cursor2, ghost: null, edCam: new THREE.PerspectiveCamera(50, 1, 0.1, 300),
          ghostMat: new THREE.MeshBasicMaterial({color: 0xffffff, transparent: true, opacity: 0.45, depthWrite: false}),
          ed: {x: 0, y: 1, z: 0, sel: 0, color: i ? 1 : 0, mirror: true, yaw: 0.35, pit: 0.5, rep: {}, msg: "", msgT: 0}};
}
players.push(makePlayer(0), makePlayer(1));
players.forEach(recalc);
function rebuildModel(p){                             // the plane that flies
  dropGroup(p.mesh, p.model);
  p.model = buildGroup(p.build);
  p.mesh.add(p.model);
  p.bubble.scale.setScalar(p.st.size * 0.62);
}
function updateCursor(p){
  const e = p.ed;
  p.cursor.position.set(e.x*CELL, e.y*CELL, e.z*CELL);
  p.cursor2.position.set(-e.x*CELL, e.y*CELL, e.z*CELL);
  p.cursor2.visible = e.mirror && e.x !== 0;
  dropGroup(p.edRoot, p.ghost);
  p.ghost = null;
  if (!p.build.has(key(e.x, e.y, e.z))) {             // see-through preview of the part that A would place here, already turned to fit
    p.ghostMat.color.setHex(PALETTE[e.color]);
    const one = new Map([[key(e.x, e.y, e.z), {x: e.x, y: e.y, z: e.z, t: PART_ORDER[e.sel], c: e.color}]]);
    p.ghost = buildGroup(one, p.build, p.ghostMat);
    p.edRoot.add(p.ghost);
  }
}
function rebuildEditor(p){                            // the plane on the hangar pad
  dropGroup(p.edRoot, p.edModel);
  p.edModel = buildGroup(p.build);
  p.edRoot.add(p.edModel);
  updateCursor(p);
}

const _inv = new Quat(), _vl = new V3(), _right = new V3(), _fwd = new V3(), _vd = new V3(), _lift = new V3(), _dq = new Quat();
function stepPlane(p, c, dt){
  // --- where is the air coming from, in the plane's own frame? ---
  _inv.copy(p.q).invert();
  _vl.copy(p.vel).applyQuaternion(_inv);
  const V = p.vel.length(), fs = Math.max(1, -_vl.z);
  const alpha = Math.atan2(-_vl.y, fs);              // angle of attack: + when the air hits the belly
  const beta  = Math.atan2(_vl.x, fs);               // sideslip
  // --- lift: linear with angle of attack, then the wing stalls and lift collapses ---
  const s = p.st, a = alpha + INCIDENCE;
  const CL = Math.abs(a) < s.stall ? CLA * a
           : Math.sign(a) * CLA * s.stall * Math.max(0.3, 1 - (Math.abs(a) - s.stall) * 2.2);
  const lift = clamp(KL * V*V * CL, -s.gLimit*G, s.gLimit*G);
  const sa = Math.sin(alpha);
  const drag = (KD0 * (1 + c.brake*3) + KDI*CL*CL + 0.008*sa*sa) * V*V * s.drag;
  // --- thrust: cruise power, afterburner while there is boost energy, idle on the air brake ---
  const free = p.overT > 0;                           // overdrive skill: the afterburner costs nothing
  const burning = c.boost && (p.boost > 0 || free) && !c.brake;
  p.boost = clamp(p.boost + (burning ? (free ? 0 : -20) : s.boostRegen) * dt, 0, s.boostCap);
  p.thr += ((c.brake ? 0.05 : burning ? s.burn : CRUISE * s.drag) - p.thr) * Math.min(1, 3*dt);
  _right.set(1, 0, 0).applyQuaternion(p.q);
  _fwd.set(0, 0, -1).applyQuaternion(p.q);
  _vd.copy(p.vel).multiplyScalar(1 / Math.max(V, 0.001));
  _lift.crossVectors(_right, _vd).normalize();       // perpendicular to the airflow, towards the canopy
  p.vel.addScaledVector(_lift, lift*dt).addScaledVector(_vd, -drag*dt)
       .addScaledVector(_right, -KY*V*V*beta*dt).addScaledVector(_fwd, TMAX*p.thr*dt);
  p.vel.y -= G*dt;
  p.pos.addScaledVector(p.vel, dt);
  // --- rotation: control surfaces only bite when air flows over them ---
  const eff = Math.min(1.4, (V/90)*(V/90)), st = Math.max(0.2, eff), dm = 0.4 + eff;
  p.w.x += ( c.pitch*s.kp*eff - s.ka*alpha*st - s.dp*p.w.x*dm) * dt;   // + = nose up; stability pulls the nose into the airflow
  p.w.y += (-c.yaw*KYAW*eff - KB*beta*st  - DY*p.w.y*dm) * dt;         // + = nose left
  p.w.z += (-c.roll*s.kr*eff              - DR*p.w.z*dm) * dt;         // + = roll left
  _dq.set(p.w.x*dt/2, p.w.y*dt/2, p.w.z*dt/2, 1).normalize();
  p.q.multiply(_dq).normalize();
  p.gLoad = lift / G; p.alpha = alpha; p.stalled = Math.abs(a) > s.stall; p.speed = V;
}
function camOffset(p, out){ return out.set(0, 2 + p.st.size*0.11, 9 + p.st.size*0.55); }
function spawnPlayer(p, x, y, z, q, vel){
  p.pos.set(x, Math.max(y, groundAt(x, z) + 120), z);
  p.q.copy(q);
  p.vel.copy(vel);
  p.w.set(0, 0, 0); p.ctl.pitch = p.ctl.roll = p.ctl.yaw = 0;
  p.hp = p.st.maxHp; p.alive = true; p.shield = 3; p.missiles = p.st.mslCap; p.missileT = 0;
  p.boost = p.st.boostCap; p.thr = CRUISE * p.st.drag; p.jam = 0; p.lastHitBy = null;
  p.mouse.on = false; p.mouse.blend = 0;
  p.mesh.visible = true;
  p.cam.position.copy(camOffset(p, t1).applyQuaternion(p.q).add(p.pos));
  p.cam.quaternion.copy(p.q);
}
function respawn(p){
  const foe = rivals(p).find(q => q.alive) || rivals(p)[0], friend = allies(p).find(q => q.alive);
  if (round === "duel" && foe) {                      // come back 1.5 km from a rival, nose pointing at them
    const a = rand(0, Math.PI*2);
    let x = foe.pos.x + Math.sin(a)*1500, z = foe.pos.z + Math.cos(a)*1500;
    const d = Math.hypot(x, z), m = WORLD_R - 600;
    if (d > m) { x *= m/d; z *= m/d; }
    tq.setFromAxisAngle(UP, Math.atan2(x - foe.pos.x, z - foe.pos.z));
    spawnPlayer(p, x, Math.max(500, foe.pos.y), z, tq, t3.set(0, 0, -105).applyQuaternion(tq));
  } else if (friend) {                                // rejoin on a wingman's wing
    t2.set(p.i % 2 ? 28 : -28, 6, 45 + 12 * p.i).applyQuaternion(friend.q).add(friend.pos);
    spawnPlayer(p, t2.x, t2.y, t2.z, friend.q, friend.vel);
  } else {
    spawnPlayer(p, home.x, 450, home.z, tq.set(0, 0, 0, 1), t3.set(0, 0, -110));
  }
}
function hurtPlayer(p, dmg, by){                      // by = the rival pilot whose shot hit, or null
  if (!p.alive || p.shield > 0) return;
  p.hp -= dmg; p.shake = 0.6; p.flash = 0.5;
  if (by) { p.lastHitBy = by; by.hitT = 0.15; }
  beep("square", 180, 70, 0.2, 0.12);
  if (p.hp <= 0) killPlayer(p);
}
function killPlayer(p){
  p.alive = false; p.mesh.visible = false; p.hp = 0; p.waveDeaths++;
  explode(p.pos, 2.2, p.vel);
  if (round === "duel") {                             // however it happened, a rival scores: whoever hit last, else the nearest
    const rs = rivals(p);
    const o = rs.includes(p.lastHitBy) ? p.lastHitBy
            : rs.slice().sort((a, b) => a.pos.distanceToSquared(p.pos) - b.pos.distanceToSquared(p.pos))[0];
    p.respawnT = 3;
    if (!o) return;
    o.duelKills++;
    if (o.duelKills >= DUEL_KILLS && roundEndT <= 0) { roundEndT = 3; banner = o.name + " wins the duel!"; bannerT = 3; }
    return;
  }
  if (lives > 0) { lives--; p.respawnT = 3; } else p.respawnT = -1;
  if (activePlayers().every(q => !q.alive && q.respawnT < 0)) {
    endGame("Squadron lost", "Score: <b>" + score + "</b> &nbsp;—&nbsp; shot down in wave " + wave +
            ".<br>Continue takes you back to the hangar before that wave.");
  }
}

// ---------- effects: explosions and tumbling wreckage ----------
const debris = [];
const debGeo = new THREE.BoxGeometry(1, 0.4, 1.6), debMat = lam(0x3a3d44);
function explode(pos, s, vel){
  for (let i = 0; i < 26; i++) {
    t1.set(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize().multiplyScalar(rand(6, 30) * Math.sqrt(s));
    emit(FIRE, pos.x + t1.x*0.1*s, pos.y + t1.y*0.1*s, pos.z + t1.z*0.1*s, t1.x + vel.x*0.3, t1.y + vel.y*0.3, t1.z + vel.z*0.3,
         rand(0.5, 1.1), s*rand(3, 6), s*5, 0, 1, rand(0.45, 0.8), 0.15, 0.9);
  }
  for (let i = 0; i < 16; i++) {
    t1.set(rand(-1, 1), rand(-0.3, 1), rand(-1, 1)).normalize().multiplyScalar(rand(3, 14) * Math.sqrt(s));
    emit(SMOKE, pos.x, pos.y, pos.z, t1.x + vel.x*0.2, t1.y + vel.y*0.2, t1.z + vel.z*0.2,
         rand(2, 3.5), s*4, s*4, -1.5, 0.16, 0.16, 0.17, 0.7);
  }
  for (let i = 0; i < 22; i++) {
    t1.set(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize().multiplyScalar(rand(30, 90));
    emit(FIRE, pos.x, pos.y, pos.z, t1.x + vel.x*0.5, t1.y + vel.y*0.5, t1.z + vel.z*0.5, rand(0.6, 1.4), s*0.9, 0, 30, 1, 0.85, 0.4, 1);
  }
  const n = Math.min(12, Math.round(3 + s*1.5));
  for (let i = 0; i < n && debris.length < 70; i++) {
    const m = new THREE.Mesh(debGeo, debMat);
    m.scale.setScalar(s * rand(0.5, 1.4));
    m.position.copy(pos);
    scene.add(m);
    debris.push({m, vel: new V3(rand(-1, 1), rand(-0.4, 1), rand(-1, 1)).multiplyScalar(rand(10, 40)).addScaledVector(vel, 0.6),
                 spin: new V3(rand(-6, 6), rand(-6, 6), rand(-6, 6)), life: rand(4, 7), bounced: false});
  }
  boom(Math.min(0.5, 0.12 + s*0.05), 0.5 + s*0.12);
}
function burst(pos, r, cr, cg, cb){                   // a quick coloured shock ring: plasma blasts and skills
  for (let i = 0; i < 18; i++) {
    t1.set(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize().multiplyScalar(r * rand(0.8, 1.6));
    emit(FIRE, pos.x, pos.y, pos.z, t1.x, t1.y, t1.z, 0.45, 5, 6, 0, cr, cg, cb, 0.9);
  }
}
function updateDebris(dt){
  for (let i = debris.length - 1; i >= 0; i--) {
    const d = debris[i];
    d.vel.y -= G*dt;
    d.vel.multiplyScalar(1 - 0.25*dt);               // air drag
    d.m.position.addScaledVector(d.vel, dt);
    d.m.rotation.x += d.spin.x*dt; d.m.rotation.y += d.spin.y*dt; d.m.rotation.z += d.spin.z*dt;
    d.life -= dt;
    if (Math.random() < dt*14) emit(SMOKE, d.m.position.x, d.m.position.y, d.m.position.z, 0, 2, 0, 1.6, d.m.scale.x*1.5, 5, -1, 0.2, 0.2, 0.2, 0.55);
    const gh = groundAt(d.m.position.x, d.m.position.z);
    if (d.m.position.y < gh) {
      if (d.bounced || d.vel.length() < 12) d.life = 0;
      else { d.m.position.y = gh; d.vel.y = Math.abs(d.vel.y)*0.35; d.vel.x *= 0.6; d.vel.z *= 0.6; d.bounced = true; }
    }
    if (d.life <= 0) { scene.remove(d.m); debris.splice(i, 1); }
  }
}

// ---------- enemies: big, slow-turning, fragile raiders (and the odd carrier) ----------
const enemies = [], bolts = [], missiles = [];
let enemySeq = 0;                                     // every raider gets an id, so two machines can talk about the same one
function spawnEnemy(x, y, z, big){
  const mesh = makeRaiderMesh();
  if (big) mesh.scale.setScalar(3.4);
  mesh.position.set(x, y, z);
  scene.add(mesh);
  const fwd = new V3(-x, 0, -z);
  if (fwd.lengthSq() < 1) fwd.set(0, 0, -1);
  fwd.normalize();
  const tough = 1 + 0.06 * Math.max(0, wave - 1);     // hulls thicken a little as the pilots' planes grow
  const hp = (big ? 30 : 3) * tough, speed = big ? 32 : rand(60, 78);
  // tactics: flank = swing round beside/behind a pilot, attack = gun run, extend = fly on after a pass, evade = break away
  enemies.push({id: ++enemySeq, mesh, pos: mesh.position, fwd, vel: new V3(), big, r: big ? 46 : 14, hp, maxHp: hp,
                speed, cur: speed, turn: big ? 0.16 : rand(0.55, 0.8), bank: 0, stun: 0,
                side: Math.random() < 0.5 ? 1 : -1, alt: rand(-40, 140),
                target: null, retarget: 0, mode: big || Math.random() < 0.35 ? "attack" : "flank", modeT: rand(9, 14),
                ext: new V3(), fireCd: rand(1, 3), burst: 0});
}
function startEvade(e, p){                            // break across the line of fire of pilot p
  e.mode = "evade"; e.modeT = rand(1.2, 2.2);
  t1.copy(e.pos).sub(p.pos).normalize();
  e.ext.crossVectors(t1, UP).multiplyScalar(Math.random() < 0.5 ? 1 : -1);
  e.ext.y = rand(-0.5, 0.7);
  e.ext.addScaledVector(t1, 0.3).normalize();
}
function spawnWave(n){
  for (const p of players) { p.killsAtWave = p.kills; p.waveDeaths = 0; }
  // waves arrive about 2 km from wherever the squadron is, from the side that has room on the map
  let cx = 0, cz = 0, k = 0;
  for (const p of activePlayers()) if (p.alive) { cx += p.pos.x; cz += p.pos.z; k++; }
  if (k) { cx /= k; cz /= k; }
  const count = 3 + 2*n;
  const ang = Math.hypot(cx, cz) > WORLD_R * 0.45 ? Math.atan2(-cx, -cz) + rand(-0.7, 0.7) : rand(0, Math.PI*2);
  const at = (a, r) => {
    let x = cx + Math.sin(a)*r, z = cz + Math.cos(a)*r;
    const d = Math.hypot(x, z), m = WORLD_R - 400;
    if (d > m) { x *= m/d; z *= m/d; }
    return [x, z];
  };
  for (let i = 0; i < count; i++) {
    const [x, z] = at(ang + rand(-0.6, 0.6), rand(1800, 2500));
    spawnEnemy(x, rand(300, 700), z, false);
  }
  if (n % 3 === 0) { const [x, z] = at(ang, 2700); spawnEnemy(x, 520, z, true); }
  banner = "WAVE " + n + " — " + count + " raiders" + (n % 3 === 0 ? " and a carrier" : "") + " inbound";
  bannerT = 4;
  beep("sawtooth", 220, 440, 0.5, 0.08);
}
const _des = new V3(), _ax = new V3();
function updateEnemy(e, dt){
  if (e.stun > 0) {                                   // hit by an EMP: no steering, no guns, it just coasts
    e.stun -= dt;
    e.pos.addScaledVector(e.vel, dt);
    if (Math.random() < dt*30) emit(FIRE, e.pos.x + rand(-1, 1)*e.r*0.6, e.pos.y + rand(-1, 1)*e.r*0.2, e.pos.z + rand(-1, 1)*e.r*0.6,
                                    e.vel.x, e.vel.y, e.vel.z, 0.25, e.big ? 7 : 3, 0, 0, 0.5, 0.8, 1, 0.9);
    return;
  }
  e.retarget -= dt;
  if (!e.target || !e.target.alive || e.retarget <= 0) {
    let best = null, bd = 1e9;
    for (const p of activePlayers()) {
      if (!p.alive) continue;
      const d = p.pos.distanceTo(e.pos) * rand(0.6, 1.4);   // a little randomness spreads them over both pilots
      if (d < bd) { bd = d; best = p; }
    }
    e.target = best; e.retarget = rand(4, 8);
  }
  const tp = e.target;
  let dist = 1e9, boost = 1;
  if (tp) {
    dist = tp.pos.distanceTo(e.pos);
    e.modeT -= dt;
    if (e.mode === "flank") {
      // swing round to a point beside and behind the pilot instead of flying straight at them
      const hl = Math.hypot(tp.vel.x, tp.vel.z) || 1, hx = tp.vel.x/hl, hz = tp.vel.z/hl;
      _des.set(tp.pos.x - hx*260 + hz*e.side*380, tp.pos.y + e.alt, tp.pos.z - hz*260 - hx*e.side*380).sub(e.pos);
      const fd = _des.length();
      _des.multiplyScalar(1 / Math.max(fd, 1));
      boost = 1.35;                                  // raiders sprint while they reposition
      t1.copy(tp.pos).sub(e.pos).normalize();
      // in position, out of patience, or the pilot has strayed in front of the guns: turn in and attack
      if (fd < 180 || e.modeT <= 0 || (dist < 600 && t1.dot(e.fwd) > 0.8)) { e.mode = "attack"; e.modeT = rand(7, 11); }
    } else if (e.mode === "attack") {
      _des.copy(tp.pos).addScaledVector(tp.vel, Math.min(2, dist/190)).sub(e.pos).normalize();
      if (dist < (e.big ? 260 : 130) || e.modeT <= 0) {   // overshot, or the run is going nowhere: fly on, then come round
        e.mode = "extend"; e.modeT = rand(2.5, 4);
        e.ext.copy(e.fwd).applyAxisAngle(UP, rand(-0.7, 0.7)); e.ext.y = rand(-0.1, 0.3); e.ext.normalize();
      }
    } else {                                         // extend or evade: hold the chosen heading for a while
      _des.copy(e.ext);
      boost = e.mode === "evade" ? 1.3 : 1.15;
      if (e.modeT <= 0) {
        e.mode = e.big ? "attack" : "flank"; e.modeT = rand(8, 13);
        e.side = Math.random() < 0.5 ? 1 : -1; e.alt = rand(-40, 140);
      }
    }
    // a pilot has this raider in their sight: sometimes it breaks away before the shots land
    if (!e.big && e.mode !== "evade" && tp.aim === e && Math.random() < dt*0.5) startEvade(e, tp);
  } else _des.set(-e.pos.z, 0, e.pos.x).normalize();   // nobody to chase: circle
  const agl = e.pos.y - groundAt(e.pos.x, e.pos.z);
  if (agl < 140) _des.y += (140 - agl) / 60;
  if (e.pos.y > 950) _des.y -= 0.6;
  if (Math.hypot(e.pos.x, e.pos.z) > WORLD_R - 500) _des.addScaledVector(t1.set(-e.pos.x, 0, -e.pos.z).normalize(), 1.2);
  for (const o of enemies) {                          // keep formation spacing
    if (o === e) continue;
    const d = o.pos.distanceTo(e.pos), min = (e.r + o.r) * 2.5;
    if (d < min) _des.addScaledVector(t1.copy(e.pos).sub(o.pos).normalize(), 0.7 * (1 - d/min));
  }
  _des.normalize();
  const ang = e.fwd.angleTo(_des);
  let yawDir = 0;
  if (ang > 1e-4) {
    _ax.crossVectors(e.fwd, _des);
    if (_ax.lengthSq() < 1e-8) _ax.copy(UP); else _ax.normalize();
    e.fwd.applyAxisAngle(_ax, Math.min(ang, e.turn * (e.mode === "evade" ? 1.4 : 1) * dt)).normalize();
    yawDir = _ax.y * Math.min(1, ang * 3);
  }
  e.cur += (e.speed * boost - e.cur) * Math.min(1, dt);
  e.vel.copy(e.fwd).multiplyScalar(e.cur);
  e.pos.addScaledVector(e.vel, dt);
  e.bank += (clamp(yawDir, -1, 1) * 0.8 - e.bank) * Math.min(1, 2*dt);
  tm.lookAt(e.pos, t1.copy(e.pos).add(e.fwd), UP);
  e.mesh.quaternion.setFromRotationMatrix(tm).multiply(tq.setFromAxisAngle(t2.set(0, 0, 1), e.bank));
  // guns: only when the target is in front and in range
  e.fireCd -= dt;
  if (tp && state === "playing" && e.fireCd <= 0 && dist < (e.big ? 900 : 650)) {
    t1.copy(tp.pos).sub(e.pos).normalize();
    if (e.big || t1.dot(e.fwd) > 0.96) {
      // time for a bolt to catch the target: |r + v t| = sp t  (r = offset to target, v = its velocity)
      const sp = 230, r = t2.copy(tp.pos).sub(e.pos);
      const qa = tp.vel.lengthSq() - sp*sp, qb = 2 * r.dot(tp.vel), qc = r.lengthSq();
      const disc = qb*qb - 4*qa*qc;
      const lead = disc > 0 ? (-qb - Math.sqrt(disc)) / (2*qa) : dist / sp;
      t2.copy(tp.pos).addScaledVector(tp.vel, lead * rand(0.85, 1.05)).sub(e.pos).normalize();
      t2.x += rand(-0.012, 0.012); t2.y += rand(-0.012, 0.012); t2.z += rand(-0.012, 0.012);
      spawnBolt(null, t3.copy(e.pos).addScaledVector(e.fwd, e.r * 0.8), t2.normalize().multiplyScalar(sp), 5);
      if (e.big && ++e.burst < 3) e.fireCd = 0.18; else { e.burst = 0; e.fireCd = rand(1.2, 2.4); }
      beep("sawtooth", 300, 120, 0.12, 0.03);
    }
  }
  if (Math.random() < dt*20) emit(FIRE, e.pos.x - e.fwd.x*e.r, e.pos.y - e.fwd.y*e.r, e.pos.z - e.fwd.z*e.r,
                                  0, 0, 0, 0.35, e.big ? 9 : 3.5, -4, 0, 1, 0.4, 0.15, 0.7);
}
function hurtEnemy(e, dmg, by){
  if (e.hp <= 0) return;
  e.hp -= dmg;
  for (let i = 0; i < 4; i++) emit(FIRE, e.pos.x + rand(-3, 3), e.pos.y + rand(-2, 2), e.pos.z + rand(-3, 3),
                                   rand(-20, 20), rand(-20, 20), rand(-20, 20), 0.4, 2.5, 0, 0, 1, 0.8, 0.3, 1);
  if (by) by.hitT = 0.15;                             // hit marker on that pilot's sight
  if (e.hp > 0) {
    beep("square", 500, 300, 0.05, 0.04);
    if (!e.big && by && e.mode !== "evade" && e.stun <= 0 && Math.random() < 0.5) startEvade(e, by);   // hurt: break away
    return;
  }
  explode(e.pos, e.big ? 11 : 4, e.vel);
  scene.remove(e.mesh);
  enemies.splice(enemies.indexOf(e), 1);
  score += e.big ? 1000 : 100;
  if (by) by.kills++;
}

// ---------- weapons ----------
// In a co-op wave a pilot's targets are the raiders; in a duel, the pilots on other teams.
function foes(p){ return round === "wave" ? enemies : rivals(p).filter(q => q.alive); }
function damage(e, dmg, by){ if (e.isPlayer) hurtPlayer(e, dmg * PVP_DMG, by); else hurtEnemy(e, dmg, by); }
const eboltGeo = new THREE.BoxGeometry(0.9, 0.9, 7), eboltMat = glow(0xff3838);
const BOLT_GEO = {pulse: new THREE.BoxGeometry(0.3, 0.3, 8), scatter: new THREE.BoxGeometry(0.28, 0.28, 4),
                  rail: new THREE.BoxGeometry(0.45, 0.45, 34), plasma: new THREE.SphereGeometry(1.5, 8, 6)};
const railMat = glow(0xffffff), plasmaMat = glow(0x7dff5a);
function spawnBolt(owner, pos, vel, life, gun, dmg){   // owner = a pilot (gun = the gun class), or null for a raider's shot
  const m = new THREE.Mesh(owner ? BOLT_GEO[gun.id] : eboltGeo,
                           !owner ? eboltMat : gun.id === "rail" ? railMat : gun.id === "plasma" ? plasmaMat : owner.bolt);
  m.position.copy(pos);
  m.lookAt(t4.copy(pos).add(vel));
  scene.add(m);
  bolts.push({m, vel: vel.clone(), life, owner, gun, dmg, seen: gun && gun.pierce ? new Set() : null});
}
function pickTargets(p, cosCone, range, n){           // up to n targets inside a cone, nearest to the nose first
  const list = [];
  _fwd.set(0, 0, -1).applyQuaternion(p.q);
  for (const e of foes(p)) {
    t1.copy(e.pos).sub(p.pos);
    const d = t1.length(), c = t1.dot(_fwd) / d;
    if (d <= range && c > cosCone) list.push([c, e]);
  }
  return list.sort((a, b) => b[0] - a[0]).slice(0, n).map(x => x[1]);
}
function pickTarget(p, cosCone, range){ return pickTargets(p, cosCone, range, 1)[0] || null; }
const _bd = new V3(), _mz = new V3();
function fireGuns(p, firing, dt){                     // every gun part keeps its own rhythm and fires from where it sits
  const s = p.st, rate = p.overT > 0 ? 2 : 1;
  if (firing && !p.wasFiring) for (let i = 0; i < s.guns.length; i++) p.gunCd[i] = Math.max(p.gunCd[i], s.guns[i].phase);
  p.wasFiring = firing;
  let snd = null;
  for (let i = 0; i < s.guns.length; i++) {
    if (p.gunCd[i] > 0) p.gunCd[i] -= dt * rate;
    if (!firing || p.gunCd[i] > 0) continue;
    const gp = s.guns[i], g = gp.g;
    p.gunCd[i] = g.every;
    _mz.set(gp.x, gp.y, gp.z - 1).applyQuaternion(p.q).add(p.pos);
    const dir = t3.set(0, 0, -1).applyQuaternion(p.q);
    if (p.aim) {                                      // auto-aim: lead the target that is inside the aim ring
      const tl = p.aim.pos.distanceTo(p.pos) / g.speed;
      dir.copy(p.aim.pos).addScaledVector(p.aim.vel, tl).addScaledVector(p.vel, -tl).sub(_mz).normalize();
    }
    for (let k = 0; k < g.n; k++) {
      _bd.copy(dir);
      if (g.spread) _bd.set(dir.x + rand(-g.spread, g.spread), dir.y + rand(-g.spread, g.spread), dir.z + rand(-g.spread, g.spread)).normalize();
      spawnBolt(p, _mz, _bd.multiplyScalar(g.speed).add(p.vel), g.life, g, g.dmg);
      const b = bolts[bolts.length - 1];              // the shot keeps correcting towards the ship it was aimed at
      b.target = p.aim; b.home = g.home * s.track;
    }
    snd = g.snd;
  }
  if (snd) beep(snd[0], snd[1], snd[2], snd[3], snd[4]);
}
const mslGeo = (() => { const g = new THREE.ConeGeometry(0.35, 3.2, 6); g.rotateX(-Math.PI/2); return g; })();
const mslMat = lam(0xdddddd);
function fireMissile(p){
  const s = p.st, targets = pickTargets(p, 0.9, 1500, s.salvo);   // a salvo spreads over the ships in the lock cone
  p.missileCd = 0.6;
  for (let i = 0; i < s.salvo && p.missiles > 0; i++) {
    p.missiles--;
    const m = new THREE.Mesh(mslGeo, mslMat);
    m.position.copy(t1.set((i - (s.salvo - 1)/2) * 2.5, -1.5, 0).applyQuaternion(p.q).add(p.pos));
    scene.add(m);
    missiles.push({m, vel: t2.set(0, 0, -1).applyQuaternion(p.q).multiplyScalar(60).add(p.vel).clone(),
                   target: targets.length ? targets[i % targets.length] : p.lock, life: 7, owner: p, dmg: s.mslDmg});
  }
  beep("sawtooth", 200, 900, 0.5, 0.07);
}
function useSkill(p){
  const l = p.st.skillLvl, k = skillPower(l);
  p.skillCd = p.skillMax = skillCool(l);
  if (p.skillClass === "shield") p.shield = Math.max(p.shield, 3*k);
  else if (p.skillClass === "overdrive") p.overT = 5*k;
  else if (p.skillClass === "repair") {
    p.hp = Math.min(p.st.maxHp, p.hp + 35*k);
    burst(p.pos, 30, 0.4, 1, 0.5);
    for (const o of allies(p)) {
      if (o.alive && o.pos.distanceTo(p.pos) < 400) { o.hp = Math.min(o.st.maxHp, o.hp + 35*k); burst(o.pos, 30, 0.4, 1, 0.5); }
    }
  } else {
    for (const e of enemies) if (e.pos.distanceTo(p.pos) < 450*k) e.stun = 4;
    for (const o of rivals(p)) if (o.alive && o.pos.distanceTo(p.pos) < 450*k) o.jam = 4;   // a rival's guns and missiles go dead
    burst(p.pos, 260, 0.5, 0.8, 1);
  }
  beep("sine", 500, 1500, 0.35, 0.09);
}
function updateMissile(ms, dt){
  ms.life -= dt;
  const sp = Math.min(280, ms.vel.length() + 160*dt);  // rocket motor
  const dir = t1.copy(ms.vel).normalize();
  if (ms.target && ms.target.hp > 0) {
    const e = ms.target, d = e.pos.distanceTo(ms.m.position);
    t2.copy(e.pos).addScaledVector(e.vel, d / sp).sub(ms.m.position).normalize();   // steer at where it will be
    const ang = dir.angleTo(t2);
    if (ang > 1e-4) dir.applyAxisAngle(_ax.crossVectors(dir, t2).normalize(), Math.min(ang, 2.6*dt));
    if (d < e.r + 6) { ms.life = 0; damage(e, ms.dmg, ms.owner); explode(ms.m.position, 1.5, e.vel); return; }
  }
  ms.vel.copy(dir).multiplyScalar(sp);
  ms.m.position.addScaledVector(ms.vel, dt);
  ms.m.lookAt(t3.copy(ms.m.position).sub(ms.vel));     // the cone geometry points down -Z, lookAt aims +Z
  emit(SMOKE, ms.m.position.x, ms.m.position.y, ms.m.position.z, 0, 0, 0, 1.2, 1.4, 3, 0, 0.9, 0.9, 0.9, 0.6);
  emit(FIRE, ms.m.position.x, ms.m.position.y, ms.m.position.z, 0, 0, 0, 0.15, 2.2, 0, 0, 1, 0.7, 0.3, 1);
  if (ms.m.position.y < groundAt(ms.m.position.x, ms.m.position.z)) { ms.life = 0; explode(ms.m.position, 1.2, t4.set(0, 0, 0)); }
}
const _b0 = new V3(), _bs = new V3(), _bc = new V3(), _bh = new V3(), _bax = new V3();   // own scratch vectors: explosions reuse t1..t4
function updateBolts(dt){
  for (let i = bolts.length - 1; i >= 0; i--) {
    const b = bolts[i], p0 = _b0.copy(b.m.position);
    if (b.target) {                                   // tracking shot: bend towards where the target will be
      const tg = b.target, sp = b.vel.length();
      _bh.copy(tg.pos).sub(b.m.position);
      _bh.addScaledVector(tg.vel, _bh.length() / sp).normalize();
      _bc.copy(b.vel).multiplyScalar(1 / sp);
      const ang = _bc.angleTo(_bh);
      if (tg.hp <= 0 || ang > 1) b.target = null;     // target gone, or the shot has flown past it
      else if (ang > 1e-4) {
        b.vel.applyAxisAngle(_bax.crossVectors(_bc, _bh).normalize(), Math.min(ang, b.home * dt));
        b.m.lookAt(_bh.copy(b.m.position).add(b.vel));
      }
    }
    b.m.position.addScaledVector(b.vel, dt);
    b.life -= dt;
    let hit = b.life <= 0 || b.m.position.y < groundAt(b.m.position.x, b.m.position.z);
    const seg = _bs.copy(b.m.position).sub(p0), len2 = Math.max(1e-6, seg.lengthSq());
    const near = (c, r) => {                          // does this frame's flight path pass within r of c?
      const k = clamp(_bc.copy(c).sub(p0).dot(seg) / len2, 0, 1);
      return _bc.copy(p0).addScaledVector(seg, k).distanceToSquared(c) < r*r;
    };
    if (!hit && b.owner) {
      const list = foes(b.owner).slice();
      for (const e of list) {
        if (e.hp <= 0 || (b.seen && b.seen.has(e)) || !near(e.pos, e.r * 1.1 + (b.gun.fuse || 0))) continue;
        if (b.gun.splash) {                           // plasma: everything near the impact is hurt too
          burst(e.pos, b.gun.splash, 0.5, 1, 0.35);
          for (const o of list) {
            if (o !== e && o.hp > 0 && o.pos.distanceTo(e.pos) < b.gun.splash + o.r*0.5) damage(o, b.gun.splashDmg, b.owner);
          }
        }
        damage(e, b.dmg, b.owner);
        if (b.seen) b.seen.add(e);                    // a rail slug keeps going, but hits each ship once
        else { hit = true; break; }
      }
    } else if (!hit) {
      for (const p of activePlayers()) if (p.alive && near(p.pos, p.st.hitR)) { hurtPlayer(p, 10, null); hit = true; break; }
    }
    if (hit) { scene.remove(b.m); bolts.splice(i, 1); }
  }
}

// ---------- game state, menu, saving ----------
const overlay = document.getElementById("overlay"), titleEl = document.getElementById("title");
const msgEl = document.getElementById("msg"), menuEl = document.getElementById("menu");
const btnC = document.getElementById("btnC"), btnCsub = document.getElementById("btnCsub");
const btn1 = document.getElementById("btn1"), btn2 = document.getElementById("btn2");
const quitBtn = document.getElementById("quit"), padsEl = document.getElementById("pads");
const INTRO = "Build your plane from blocks, then take it up against the raider fleet — or against each other.";
const SAVE_KEY = "sky-squadron-save-v1";
let state = "menu";                                   // menu | playing | upgrade (the hangar) | paused | over
let pausedFrom = "playing", upLock = 0;
let mode = 1, menuSel = 1;                            // mode: pilots on this machine (1, or 2 for split screen). menuSel: 0 continue, 1 play, 2 split screen
let round = "wave", pvpNext = false, roundEndT = 0;   // round: a co-op "wave" or a pilot-vs-pilot "duel"
let score = 0, wave = 0, lives = 0, waveT = 0, banner = "", bannerT = 0, startGuard = false;
const home = new V3(0, 0, 900);                       // where the squadron takes off for the next round
const keys = {};
function activePlayers(){ return players.filter(p => p.active); }

function saveGame(){                                  // called in the hangar, so a reload resumes before the next round
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({v: 1, mode, wave, score, lives, pvpNext,
      players: players.map(p => ({bank: p.bank, invert: p.invert, color: p.ed.color,
                                  build: Array.from(p.build.values()).map(q => [q.x, q.y, q.z, q.t, q.c])}))}));
  } catch (e) {}
}
function loadSave(){
  try {
    const s = JSON.parse(localStorage.getItem(SAVE_KEY));
    if (s && s.v === 1 && Array.isArray(s.players) && s.players.length === 2) return s;
  } catch (e) {}
  return null;
}
function buildFromSave(arr, i){                       // never trust a save: bad data falls back to the starter plane
  const b = new Map();
  if (Array.isArray(arr)) for (const q of arr) {
    const [x, y, z, t, c] = q;
    if (PARTS[t] && Math.abs(x) <= GX && Math.abs(y) <= GY && Math.abs(z) <= GZ && Number.isInteger(x + y + z)) {
      b.set(key(x, y, z), {x, y, z, t, c: PALETTE[c] !== undefined ? c : 0});
    }
  }
  const core = b.get("0,0,0");
  return core && core.t === "cockpit" && connected(b) ? b : starterBuild(i);
}

function hangarLayout(w, h){                          // panel widths, and where the plane goes between them
  const lw = clamp(w * 0.27, 150, 215), rw = clamp(w * 0.3, 160, 210);
  const gap = Math.max(120, w - 12 - lw - rw), cx = 6 + lw + gap/2, cy = (56 + h - 108) / 2;
  const pxPerM = gap * 1.15 / 13.5;                   // a plane seen from behind is about 13.5 m across
  return {lw, rw, dist: clamp((h/2) / (Math.tan(25 * Math.PI/180) * pxPerM), 22, 40), dx: w/2 - cx, dy: h/2 - cy};
}
function layout(){
  const W = innerWidth, H = innerHeight, n = mode === 2 ? 2 : 1;
  renderer.setSize(W, H);
  hudC.width = W; hudC.height = H;
  const hv = hangarLayout(W / n, H);
  for (const p of players) {
    p.cam.aspect = p.edCam.aspect = (W / n) / H;
    p.edCam.setViewOffset(W / n, H, hv.dx, hv.dy, W / n, H);   // slide the picture so the plane is clear of the panels
    p.edDist = hv.dist;
    p.cam.updateProjectionMatrix(); p.edCam.updateProjectionMatrix();
  }
  const sc = H * renderer.getPixelRatio() / (2 * Math.tan(35 * Math.PI/180));
  FIRE.mat.uniforms.scale.value = SMOKE.mat.uniforms.scale.value = sc;
}
function menuButtons(){ return [btnC, btn1, btn2].filter(b => b.style.display !== "none"); }
function setSel(i){
  menuSel = i;
  [btnC, btn1, btn2].forEach((b, k) => b.classList.toggle("sel", k === i));
}
function showOverlay(title, html, withMenu){
  titleEl.textContent = title; msgEl.innerHTML = html;
  menuEl.style.display = withMenu ? "flex" : "none";
  quitBtn.style.display = withMenu ? "none" : "inline-block";
  if (withMenu) {                                     // offer Continue only when there is something saved
    const s = loadSave();
    btnC.style.display = s ? "" : "none";
    if (s) btnCsub.textContent = (s.mode === 2 ? "2 pilots" : "1 pilot") + " — hangar before wave " + (s.wave + 1) + ", score " + s.score;
    setSel(s ? 0 : menuSel === 0 ? 1 : menuSel);
  }
  overlay.style.display = "flex";
}
function menuGo(i){
  audioOn();
  if (i === 0) continueGame(); else newGame(i);
}
function toMenu(){ state = "menu"; mode = 1; layout(); showOverlay("✈ SKY SQUADRON", INTRO, true); }
function pause(){
  pausedFrom = state; state = "paused";
  if (document.pointerLockElement) document.exitPointerLock();
  showOverlay("Paused", "Press A / Start, Enter, or click to continue", false);
}
function resume(){
  state = pausedFrom; upLock = 0.4; overlay.style.display = "none";
  if (state === "playing" && mouseSeen) lockMouse();
}
function endGame(title, html){
  state = "over";
  if (document.pointerLockElement) document.exitPointerLock();
  showOverlay(title, html, true);
}
function clearWorld(){
  for (const e of enemies) scene.remove(e.mesh);
  for (const b of bolts) scene.remove(b.m);
  for (const m of missiles) scene.remove(m.m);
  for (const d of debris) scene.remove(d.m);
  enemies.length = bolts.length = missiles.length = debris.length = 0;
}
function resetPilot(p){
  p.active = p.i < mode; p.team = 0;
  p.alive = false; p.mesh.visible = false; p.respawnT = -1; p.ready = false;
  p.kills = p.killsAtWave = p.waveDeaths = p.duelKills = 0; p.lock = p.aim = null;
  p.ed.x = 0; p.ed.y = 1; p.ed.z = 0; p.ed.sel = 0; p.ed.mirror = true; p.ed.rep = {};
}
function newGame(m){
  mode = m;
  clearWorld();
  score = 0; wave = 0; lives = 4; pvpNext = false; round = "wave"; banner = ""; bannerT = 0;
  home.set(0, 0, 900);
  players.forEach((p, i) => {
    resetPilot(p);
    p.build = starterBuild(i);
    p.bank = buildCost(p.build) + START_POINTS;       // the starter plane, plus points to make it your own
    p.ed.color = i ? 1 : 0;
    p.earned = [START_POINTS + " points to spend — make the plane your own"];
  });
  layout();
  enterHangar();
}
function continueGame(){
  const s = loadSave();
  if (!s) return;
  mode = s.mode === 2 ? 2 : 1;
  clearWorld();
  score = s.score | 0; wave = s.wave | 0; lives = s.lives | 0; pvpNext = !!s.pvpNext && mode === 2; round = "wave"; banner = ""; bannerT = 0;
  home.set(0, 0, 900);
  players.forEach((p, i) => {
    const d = s.players[i] || {};
    resetPilot(p);
    p.build = buildFromSave(d.build, i);
    p.bank = Math.max(buildCost(p.build), d.bank | 0);
    p.invert = !!d.invert;
    p.ed.color = PALETTE[d.color] !== undefined ? d.color : (i ? 1 : 0);
    p.earned = ["Welcome back — progress restored"];
  });
  layout();
  enterHangar();
}

// ---------- rounds: hangar -> wave or duel -> hangar ----------
function enterHangar(){
  const up = activePlayers().filter(p => p.alive);
  if (up.length) {                                    // next take-off is from where the squadron ended up
    home.set(0, 0, 0);
    for (const p of up) { home.x += p.pos.x / up.length; home.z += p.pos.z / up.length; }
    const d = Math.hypot(home.x, home.z), m = WORLD_R - 1200;
    if (d > m) { home.x *= m/d; home.z *= m/d; }
  }
  for (const p of players) { p.ready = false; p.ed.msgT = 0; p.ed.rep = {}; recalc(p); rebuildEditor(p); }
  upLock = 0.7;                                       // ignore buttons still held from the dogfight
  if (document.pointerLockElement) document.exitPointerLock();   // the hangar is worked with a free mouse pointer
  state = "upgrade";
  overlay.style.display = "none";
  saveGame();
  beep("sine", 660, 990, 0.4, 0.08);
}
function finishWave(){
  lives++;                                            // a cleared wave also earns the squadron a spare plane
  for (const p of activePlayers()) {
    p.earned = ["wave " + wave + " cleared +" + WAVE_POINTS, (p.kills - p.killsAtWave) + " kills"];
    p.bank += WAVE_POINTS;
  }
  enterHangar();
}
function finishDuel(){
  const act = activePlayers(), w = act.slice().sort((a, b) => b.duelKills - a.duelKills)[0];
  const scoreLine = act.map(q => q.name + " " + q.duelKills).join("  :  ");
  for (const p of act) {
    const pts = p === w ? WAVE_POINTS : WAVE_POINTS / 2;
    p.earned = [(p === w ? "duel won +" : "duel lost +") + pts, scoreLine];
    p.bank += pts;
  }
  enterHangar();
}
function startRound(){
  startGuard = true;
  clearWorld();
  waveT = 0; roundEndT = 0;
  const act = activePlayers(), duel = act.length > 1 && pvpNext;
  round = duel ? "duel" : "wave";
  for (const p of players) {
    p.alive = false; p.mesh.visible = false; p.respawnT = -1;
    p.team = duel ? p.i : 0;                          // a duel puts every pilot on their own team; a wave puts them all on one
    p.duelKills = 0; p.lock = p.aim = null; p.skillCd = 0; p.overT = 0; p.jam = 0; p.wasFiring = false;
  }
  for (const p of act) { recalc(p); rebuildModel(p); }
  if (duel) {                                         // spread round a 2.6 km circle, everyone flying at the middle
    act.forEach((p, i) => {
      const a = -Math.PI/2 + i * 2*Math.PI / act.length;      // two pilots: one from the west, one from the east
      tq.setFromAxisAngle(UP, Math.atan2(Math.sin(a), Math.cos(a)));
      spawnPlayer(p, Math.sin(a)*1300, 600, Math.cos(a)*1300, tq, t3.set(0, 0, -105).applyQuaternion(tq));
    });
    banner = "DUEL — first to " + DUEL_KILLS + " shoot-downs wins"; bannerT = 4;
    beep("sawtooth", 440, 220, 0.5, 0.08);
  } else {                                            // one team: take off line abreast, nose towards the middle of the map
    tq.setFromAxisAngle(UP, Math.hypot(home.x, home.z) > 1500 ? Math.atan2(home.x, home.z) : 0);
    const f = t3.set(0, 0, -105).applyQuaternion(tq), r = t2.set(1, 0, 0).applyQuaternion(tq);
    act.forEach((p, i) => {
      const off = (i - (act.length - 1) / 2) * 60;
      spawnPlayer(p, home.x + r.x*off, 500, home.z + r.z*off, tq, f);
    });
    spawnWave(++wave);
  }
  if (mouseSeen) lockMouse();                         // the mouse was used in the hangar: capture it again for flying
  state = "playing";
  overlay.style.display = "none";
}

// ---------- hangar actions (each pilot edits their own plane) ----------
function edMsg(p, text){ p.ed.msg = text; p.ed.msgT = 2.5; beep("sawtooth", 160, 120, 0.12, 0.06); }
function edCells(p){                                  // the cursor cell, plus its mirror twin when mirroring
  const e = p.ed;
  return e.mirror && e.x !== 0 ? [[e.x, e.y, e.z], [-e.x, e.y, e.z]] : [[e.x, e.y, e.z]];
}
function edChanged(p){ recalc(p); rebuildEditor(p); saveGame(); }
function edPlace(p){
  const e = p.ed, t = PART_ORDER[e.sel];
  let delta = 0;
  for (const [x, y, z] of edCells(p)) {
    const old = p.build.get(key(x, y, z));
    if (old && old.t === "cockpit") return edMsg(p, "The cockpit stays where it is");
    if (!old && !NEIGH.some(([dx, dy, dz]) => p.build.has(key(x + dx, y + dy, z + dz)))) return edMsg(p, "A part must touch the plane");
    delta += PARTS[t].cost - (old ? PARTS[old.t].cost : 0);
  }
  const free = p.bank - buildCost(p.build);
  if (delta > free) return edMsg(p, "Not enough points: needs " + delta + ", you have " + free);
  for (const [x, y, z] of edCells(p)) p.build.set(key(x, y, z), {x, y, z, t, c: e.color});
  beep("square", 660, 1320, 0.08, 0.05);
  edChanged(p);
}
function edRemove(p){
  const cells = edCells(p).filter(([x, y, z]) => p.build.has(key(x, y, z)));
  if (!cells.length) return;
  const test = new Map(p.build);
  for (const [x, y, z] of cells) {
    if (test.get(key(x, y, z)).t === "cockpit") return edMsg(p, "The cockpit stays where it is");
    test.delete(key(x, y, z));
  }
  if (!connected(test)) return edMsg(p, "That would cut other parts off the plane");
  p.build = test;
  beep("square", 500, 250, 0.08, 0.05);
  edChanged(p);
}
function edPaint(p){                                  // paint the part under the cursor; on empty space, pick the next colour
  const e = p.ed, cells = edCells(p).map(([x, y, z]) => p.build.get(key(x, y, z))).filter(q => q && q.c !== e.color);
  if (cells.length) { for (const q of cells) q.c = e.color; edChanged(p); }
  else { e.color = (e.color + 1) % PALETTE.length; updateCursor(p); saveGame(); }
  beep("square", 900, 1100, 0.05, 0.04);
}
function edPaintBlock(p){                             // mouse: paint exactly the block under the cursor, never change the brush
  const cells = edCells(p).map(([x, y, z]) => p.build.get(key(x, y, z))).filter(q => q && q.c !== p.ed.color);
  if (!cells.length) return;
  for (const q of cells) q.c = p.ed.color;
  beep("square", 900, 1100, 0.05, 0.04);
  edChanged(p);
}
function edAct(p, act){
  if (state !== "upgrade" || upLock > 0) return;
  const e = p.ed;
  if (act === "ready") {
    p.ready = !p.ready;
    beep("square", p.ready ? 880 : 440, p.ready ? 1320 : 330, 0.12, 0.06);
    if (activePlayers().every(q => q.ready)) startRound();
    return;
  }
  if (act === "pvp") {                                // co-op wave or duel next? Any pilot may flip it; everyone must re-confirm
    if (activePlayers().length < 2) return;
    pvpNext = !pvpNext;
    players.forEach(q => q.ready = false);
    beep("square", 500, pvpNext ? 250 : 1000, 0.15, 0.06);
    saveGame();
    return;
  }
  if (p.ready) return;
  if (act === "left") e.x = Math.max(-GX, e.x - 1);
  else if (act === "right") e.x = Math.min(GX, e.x + 1);
  else if (act === "fwd") e.z = Math.max(-GZ, e.z - 1);
  else if (act === "back") e.z = Math.min(GZ, e.z + 1);
  else if (act === "up") e.y = Math.min(GY, e.y + 1);
  else if (act === "down") e.y = Math.max(-GY, e.y - 1);
  else if (act === "prev") e.sel = (e.sel + PART_ORDER.length - 1) % PART_ORDER.length;
  else if (act === "next") e.sel = (e.sel + 1) % PART_ORDER.length;
  else if (act === "mirror") e.mirror = !e.mirror;
  else if (act === "place") return edPlace(p);
  else if (act === "remove") return edRemove(p);
  else if (act === "paint") return edPaint(p);
  updateCursor(p);
}
function rep(p, id, held, dt){                        // true on press, then auto-repeats while held
  const r = p.ed.rep;
  if (!held) { delete r[id]; return false; }
  if (!(id in r)) { r[id] = 0.32; return true; }
  r[id] -= dt;
  if (r[id] <= 0) { r[id] += 0.09; return true; }
  return false;
}
function hangarInput(p, pad, dt){
  const e = p.ed;
  e.yaw += (pad.lx || 0) * 2.2 * dt;
  e.pit = clamp(e.pit + (pad.ly || 0) * 1.5 * dt, -0.25, 1.35);
  if (e.msgT > 0) e.msgT -= dt;
  if (upLock > 0) return;
  if (rep(p, "l", pad.left, dt)) edAct(p, "left");
  if (rep(p, "r", pad.right, dt)) edAct(p, "right");
  if (rep(p, "f", pad.up, dt)) edAct(p, "fwd");
  if (rep(p, "b", pad.down, dt)) edAct(p, "back");
  if (rep(p, "lb", pad.lb, dt)) edAct(p, "down");
  if (rep(p, "rb", pad.rb, dt)) edAct(p, "up");
  if (rep(p, "lt", pad.lt, dt)) edAct(p, "prev");
  if (rep(p, "rt", pad.rt, dt)) edAct(p, "next");
  if (pad.aEdge) edAct(p, "place");
  if (pad.backEdge) edAct(p, "remove");
  if (pad.xEdge) edAct(p, "paint");
  if (pad.yEdge) edAct(p, "mirror");
  if (pad.viewEdge) edAct(p, "pvp");
  if (pad.startEdge && state === "upgrade") edAct(p, "ready");
}
const HANGAR_KEYS = [
  {KeyW: "fwd", KeyS: "back", KeyA: "left", KeyD: "right", KeyQ: "down", KeyE: "up", KeyZ: "prev", KeyC: "next",
   Space: "place", KeyX: "remove", KeyF: "paint", KeyV: "mirror", KeyT: "pvp", KeyR: "ready"},
  {ArrowUp: "fwd", ArrowDown: "back", ArrowLeft: "left", ArrowRight: "right", PageDown: "down", PageUp: "up",
   BracketLeft: "prev", BracketRight: "next", Enter: "place", Backspace: "remove", Delete: "remove", Slash: "paint",
   KeyM: "mirror", ShiftRight: "ready"}];
const HANGAR_REPEAT = {fwd: 1, back: 1, left: 1, right: 1, up: 1, down: 1, prev: 1, next: 1};
function hangarKey(code, repeat){
  for (let i = 0; i < 2; i++) {
    const act = HANGAR_KEYS[i][code];
    if (act && (!repeat || HANGAR_REPEAT[act])) edAct(players[mode === 2 ? i : 0], act);
  }
}

// ---------- input ----------
// Devices are read here and turned into one plain "command" object per pilot per frame (commandFor).
// The simulation only ever sees commands, which is what lets a pilot be driven over a network later.
const mouse = {dx: 0, dy: 0, left: false, right: false};
let mouseSeen = false;                                // the mouse has been used: capture it when flying starts
const MOUSE_SENS = 0.0022;
function mouseLocked(){ return document.pointerLockElement === renderer.domElement; }
function lockMouse(){                                 // only works from a click or key press; from a controller it quietly does nothing
  const c = renderer.domElement;
  if (mouseLocked() || !c.requestPointerLock) return;
  try { const r = c.requestPointerLock(); if (r && r.catch) r.catch(() => {}); } catch (e) {}
}
btnC.addEventListener("click", e => { e.stopPropagation(); menuGo(0); });
btn1.addEventListener("click", e => { e.stopPropagation(); menuGo(1); });
btn2.addEventListener("click", e => { e.stopPropagation(); menuGo(2); });
quitBtn.addEventListener("click", e => { e.stopPropagation(); toMenu(); });
overlay.addEventListener("click", () => { audioOn(); if (state === "paused") resume(); });
document.addEventListener("pointerlockchange", () => {
  mouse.left = mouse.right = false;
  if (!mouseLocked() && state === "playing") pause();  // Esc let go of the mouse
});
document.addEventListener("keydown", e => {
  keys[e.code] = true;
  audioOn();
  if (state === "menu" || state === "over") {
    const vis = menuButtons(), all = [btnC, btn1, btn2], at = vis.indexOf(all[menuSel]);
    if (e.code === "Digit1") menuGo(1);
    else if (e.code === "Digit2") menuGo(2);
    else if (e.code === "ArrowLeft") setSel(all.indexOf(vis[Math.max(0, at - 1)]));
    else if (e.code === "ArrowRight") setSel(all.indexOf(vis[Math.min(vis.length - 1, at + 1)]));
    else if (e.code === "Enter" && !e.repeat) { startGuard = true; menuGo(menuSel); }
  } else if (state === "paused") {
    if (e.code === "Enter" || e.code === "Escape") { startGuard = true; resume(); }
  } else if (e.code === "Escape" || e.code === "KeyP") pause();
  else if (state === "upgrade") hangarKey(e.code, e.repeat);
  if ((state === "playing" || state === "upgrade") &&
      ["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Slash", "PageUp", "PageDown", "Backspace", "Tab"].includes(e.code)) e.preventDefault();
});
document.addEventListener("keyup", e => keys[e.code] = false);
addEventListener("blur", () => { for (const k in keys) keys[k] = false; mouse.left = mouse.right = false; });

// ----- mouse -----
// Flying: the captured mouse points at where the pilot wants to go and the plane steers itself there
// (left button guns, right button missiles). In the hangar it is a free pointer for building.
document.addEventListener("mousemove", e => {
  mouseSeen = true;
  if (state === "playing") { if (mouseLocked()) { mouse.dx += e.movementX; mouse.dy += e.movementY; } }
  else if (state === "upgrade") hangarMouse("move", e);
});
document.addEventListener("mousedown", e => {
  mouseSeen = true;
  audioOn();
  if (overlay.style.display !== "none") return;       // the menus are ordinary buttons
  if (state === "playing") {
    if (!mouseLocked()) lockMouse();                  // the first click captures the mouse, it does not shoot
    else if (e.button === 0) mouse.left = true;
    else if (e.button === 2) mouse.right = true;
    e.preventDefault();
  } else if (state === "upgrade") { hangarMouse("down", e); e.preventDefault(); }
});
document.addEventListener("mouseup", e => {
  if (e.button === 0) mouse.left = false; else if (e.button === 2) mouse.right = false;
  if (state === "upgrade") hangarMouse("up", e);
});
document.addEventListener("wheel", e => { if (state === "upgrade") hangarMouse("wheel", e); }, {passive: true});
document.addEventListener("contextmenu", e => { if (state === "playing" || state === "upgrade") e.preventDefault(); });

const pick = new THREE.Raycaster(), _ndc = new THREE.Vector2();
let drag = null;                                      // a button held in the hangar: {p, button, moved}
function hangarView(e){                               // which pilot's part of the screen the mouse is over, and where in it
  const n = mode === 2 ? 2 : 1, w = innerWidth / n, i = clamp(Math.floor(e.clientX / w), 0, n - 1);
  return {p: players[i], x: e.clientX - i*w, y: e.clientY, w, h: innerHeight};
}
function uiAt(p, x, y){ return (p.ui || []).find(r => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h); }
function hangarPick(p, x, y, w, h){                   // the block under the pointer, and the empty cell against the face it points at
  if (!p.edModel) return null;
  pick.setFromCamera(_ndc.set(x / w * 2 - 1, -(y / h) * 2 + 1), p.edCam);
  const hit = pick.intersectObjects(p.edModel.children, false)[0];
  if (!hit || !hit.face) return null;
  const n = hit.face.normal, o = p.edRoot.position;
  const at = [Math.round((hit.point.x - o.x - n.x*0.03) / CELL), Math.round((hit.point.y - o.y - n.y*0.03) / CELL),
              Math.round((hit.point.z - o.z - n.z*0.03) / CELL)];
  // a gun barrel pokes forward out of its own cell: look one or two cells behind it, then at the neighbours
  const tries = [[0,0,0], [0,0,1], [0,0,2]].concat(NEIGH);
  const off = tries.find(([dx, dy, dz]) => p.build.has(key(at[0] + dx, at[1] + dy, at[2] + dz)));
  if (!off) return null;
  const block = [at[0] + off[0], at[1] + off[1], at[2] + off[2]], place = block.slice();
  const ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z);
  if (ax >= ay && ax >= az) place[0] += Math.sign(n.x); else if (ay >= az) place[1] += Math.sign(n.y); else place[2] += Math.sign(n.z);
  return {block, place};
}
function hangarHover(v){                              // move the build cursor to the cell the mouse is pointing at
  const p = v.p, e = p.ed, h = hangarPick(p, v.x, v.y, v.w, v.h);
  e.hit = h ? h.block : null;
  if (!h) return;
  const [x, y, z] = h.place;
  if (Math.abs(x) > GX || Math.abs(y) > GY || Math.abs(z) > GZ) return;
  if (x !== e.x || y !== e.y || z !== e.z) { e.x = x; e.y = y; e.z = z; updateCursor(p); }
}
function hangarMouse(type, e){
  if (overlay.style.display !== "none" || upLock > 0) return;
  const v = hangarView(e), p = v.p, ed = p.ed;
  if (type === "wheel") { ed.zoom = clamp((ed.zoom || 1) * (e.deltaY > 0 ? 1.1 : 0.9), 0.45, 2.2); return; }
  if (type === "move") {
    if (drag && drag.button !== 0) {                  // right or middle button held and moved: turn the view
      drag.moved += Math.abs(e.movementX) + Math.abs(e.movementY);
      if (drag.moved > 6) {
        drag.p.ed.yaw -= e.movementX * 0.008;
        drag.p.ed.pit = clamp(drag.p.ed.pit + e.movementY * 0.006, -0.25, 1.35);
      }
    } else if (!p.ready && !uiAt(p, v.x, v.y)) hangarHover(v);
    return;
  }
  if (type === "down") {
    const ui = uiAt(p, v.x, v.y);
    if (ui) { if (e.button === 0) ui.go(); }
    else drag = {p, button: e.button, moved: 0};
    return;
  }
  const d = drag;                                     // button released: a click, unless the view was dragged
  drag = null;
  if (!d || d.p !== p || d.moved > 6 || p.ready) return;
  hangarHover(v);
  if (!ed.hit) return;
  if (d.button === 0) edAct(p, "place");              // left: put the selected part against the face pointed at
  else {                                              // right: remove the block pointed at. Middle: paint it
    ed.x = ed.hit[0]; ed.y = ed.hit[1]; ed.z = ed.hit[2];
    if (d.button === 2) edAct(p, "remove"); else edPaintBlock(p);
    updateCursor(p);
  }
}

// ----- gamepads -----
// Standard (Xbox-style) pads: axes 0/1 left stick, 2/3 right stick; buttons 0 A, 1 B, 2 X, 3 Y,
// 4 LB, 5 RB, 6 LT, 7 RT, 8 View/Back, 9 Start, 12-15 d-pad.
const padPrev = {};
const PAD_BOOL = ["fire", "missile", "skill", "boost", "brake", "lb", "rb", "lt", "rt", "a", "back", "x", "y", "view", "start", "left", "right", "up", "down"];
const PAD_EDGES = ["a", "back", "x", "y", "view", "start", "left", "right", "up", "down"];
const NOPAD = {mx: 0, my: 0, lx: 0, ly: 0};
let padsText = "";
function pollPads(){
  const out = [], raw = navigator.getGamepads ? navigator.getGamepads() : [];
  for (const gp of raw) {
    if (!gp || !gp.connected) continue;
    const ax = i => { const v = gp.axes[i] || 0; return Math.abs(v) < 0.15 ? 0 : (v - Math.sign(v)*0.15) / 0.85; };
    const b  = i => !!gp.buttons[i] && (gp.buttons[i].pressed || gp.buttons[i].value > 0.5);
    const s = {index: gp.index, id: gp.id, mx: ax(0), my: ax(1), lx: ax(2), ly: ax(3),
               fire: b(7) || b(2), missile: b(6), skill: b(3), boost: b(0), brake: b(1), lb: b(4), rb: b(5), lt: b(6), rt: b(7),
               a: b(0), back: b(1), x: b(2), y: b(3), view: b(8), start: b(9),
               left: b(14) || (gp.axes[0] || 0) < -0.6, right: b(15) || (gp.axes[0] || 0) > 0.6,
               up: b(12) || (gp.axes[1] || 0) < -0.6, down: b(13) || (gp.axes[1] || 0) > 0.6,
               active: Array.from(gp.buttons).some(x => x.pressed) || Array.from(gp.axes).some(v => Math.abs(v) > 0.3)};
    const prev = padPrev[gp.index] || {};
    for (const k of PAD_EDGES) s[k + "Edge"] = s[k] && !prev[k];
    padPrev[gp.index] = s;
    out.push(s);
  }
  return out;
}
function mergePads(pads){                             // one pilot on this machine: every controller flies the one plane
  const m = Object.assign({}, NOPAD), big = (a, v) => Math.abs(v) > Math.abs(a) ? v : a;
  for (const p of pads) {
    m.mx = big(m.mx, p.mx); m.my = big(m.my, p.my); m.lx = big(m.lx, p.lx); m.ly = big(m.ly, p.ly);
    for (const k of PAD_BOOL) m[k] = m[k] || p[k];
    for (const k of PAD_EDGES) m[k + "Edge"] = m[k + "Edge"] || p[k + "Edge"];
  }
  return m;
}
function padFor(i, pads){
  if (mode === 1) return i === 0 ? mergePads(pads) : NOPAD;
  if (pads.length >= 2) return pads[i] || NOPAD;      // two controllers: first is pilot 1, second is pilot 2
  return i === 1 ? (pads[0] || NOPAD) : NOPAD;        // one controller: pilot 2; keyboard and mouse are pilot 1
}

// ----- commands -----
const KEYMAP = [
  {up: "KeyW", down: "KeyS", left: "KeyA", right: "KeyD", yl: "KeyQ", yr: "KeyE", fire: "Space", missile: "KeyF", skill: "KeyR", boost: "ShiftLeft", brake: "KeyC"},
  {up: "ArrowUp", down: "ArrowDown", left: "ArrowLeft", right: "ArrowRight", yl: "Comma", yr: "Period", fire: "Enter", missile: "Slash", skill: "KeyM", boost: "ShiftRight", brake: "ControlRight"}];
const NEUTRAL = {pitch: 0, roll: 0, yaw: 0, fire: 0, missile: 0, skill: 0, boost: 0, brake: 0, aim: null};
function commandFor(p, pads){                         // what this pilot asks of the plane this frame, as plain data
  if (p.remote) return p.netCmd || NEUTRAL;           // a pilot on another machine: the command arrives over the network
  const pad = padFor(p.i, pads), sets = mode === 1 ? KEYMAP : [KEYMAP[p.i] || {}];   // flying alone, both key sets work
  const on = name => sets.some(k => keys[k[name]]) ? 1 : 0;
  if (pad.viewEdge) p.invert = !p.invert;
  const g = startGuard ? 0 : 1;                        // a button that left the hangar must not also fire or boost
  const m = p.mouse, kbm = p.i === 0 && mouseLocked(); // the one mouse belongs to pilot 1
  const byHand = Math.abs(pad.mx) + Math.abs(pad.my) > 0.05 || on("up") || on("down") || on("left") || on("right");
  if (kbm && (mouse.dx || mouse.dy)) {
    if (!m.on) {                                      // start pointing from wherever the nose is now
      _fwd.set(0, 0, -1).applyQuaternion(p.q);
      m.yaw = Math.atan2(-_fwd.x, -_fwd.z); m.pit = Math.asin(clamp(_fwd.y, -1, 1)); m.on = true;
    }
    m.yaw -= mouse.dx * MOUSE_SENS;
    m.pit = clamp(m.pit - mouse.dy * MOUSE_SENS * (p.invert ? -1 : 1), -1.45, 1.45);
  }
  if (p.i === 0) mouse.dx = mouse.dy = 0;
  if (byHand || !kbm) m.on = false;                    // stick or flight keys take over; the mouse picks up again when it moves
  const cp = Math.cos(m.pit);
  return {
    pitch: clamp((pad.my + on("down") - on("up")) * (p.invert ? -1 : 1), -1, 1),   // pull back / S = nose up
    roll:  clamp(pad.mx + on("right") - on("left"), -1, 1),
    yaw:   clamp(pad.lx + (pad.rb ? 1 : 0) - (pad.lb ? 1 : 0) + on("yr") - on("yl"), -1, 1),
    fire: (pad.fire || on("fire") || (kbm && mouse.left)) && g ? 1 : 0,
    missile: pad.missile || on("missile") || (kbm && mouse.right) ? 1 : 0,
    skill: (pad.skill || on("skill")) && g ? 1 : 0,
    boost: (pad.boost || on("boost")) && g ? 1 : 0, brake: pad.brake || on("brake") ? 1 : 0,
    aim: m.on ? [-Math.sin(m.yaw) * cp, Math.sin(m.pit), -Math.cos(m.yaw) * cp] : null};   // mouse flight: the direction pointed at
}
function padsLine(pads){
  let txt = pads.length
    ? pads.map(p => "🎮 #" + (p.index + 1) + (p.active ? " ● " : " ○ ") + p.id).join("   |   ")
    : "🎮 No controller detected yet — press any button on it";
  if (state !== "paused") {
    txt += "\nSplit screen:  " + (pads.length >= 2
      ? "Pilot 1 = 🎮 #" + (pads[0].index + 1) + " or keyboard + mouse,  Pilot 2 = 🎮 #" + (pads[1].index + 1)
      : pads.length === 1 ? "Pilot 1 = keyboard + mouse,  Pilot 2 = 🎮 #" + (pads[0].index + 1)
      : "Pilot 1 = keyboard + mouse,  Pilot 2 = arrow keys until a controller is connected");
  }
  if (txt !== padsText) padsEl.textContent = padsText = txt;
}

// ---------- per-frame player logic around the physics ----------
const _steer = {pitch: 0, roll: 0, yaw: 0};
function aimSteer(p, aim){                            // mouse flight: work the controls to bring the nose onto the direction pointed at
  _inv.copy(p.q).invert();
  const l = t1.set(aim[0], aim[1], aim[2]).applyQuaternion(_inv);   // that direction, seen from the cockpit
  const off = Math.acos(clamp(-l.z, -1, 1));          // how far it is from the nose
  const far = clamp((off - 0.05) / 0.3, 0, 1);        // far off: bank towards it and pull. Nearly on: a gentle banked turn that levels out as it closes
  _right.set(1, 0, 0).applyQuaternion(p.q);
  const bank = Math.asin(clamp(-_right.y, -1, 1));
  const side = Math.atan2(l.x, -l.z), up = Math.atan2(l.y, -l.z);
  const lean = Math.atan2(l.x, l.y + 0.35);           // the +0.35 keeps the plane upright for small corrections downwards
  const want = clamp(side * 5, -1.1, 1.1);            // the bank that suits how far off to the side it still is
  _steer.roll = far * clamp(lean * 2.2, -1, 1) + (1 - far) * clamp((want - bank) * 2.5, -1, 1);
  _steer.pitch = clamp(up * 3, -0.7, 1);
  _steer.yaw = clamp(side * 2, -1, 1);
  return _steer;
}
function updatePlayer(p, c, dt){
  let pitch = c.pitch, roll = c.roll, yaw = c.yaw;    // the command itself is left untouched: it may be shared, stored or sent
  if (c.aim) { const a = aimSteer(p, c.aim); pitch = a.pitch; roll = a.roll; yaw = clamp(a.yaw + c.yaw, -1, 1); }
  // smooth the raw inputs so a keyboard does not slam the controls
  const k = Math.min(1, 10*dt);
  p.ctl.pitch += (pitch - p.ctl.pitch)*k; p.ctl.roll += (roll - p.ctl.roll)*k; p.ctl.yaw += (yaw - p.ctl.yaw)*k;
  const cc = {pitch: p.ctl.pitch, roll: p.ctl.roll, yaw: p.ctl.yaw, boost: c.boost, brake: c.brake ? 1 : 0};
  const n = Math.max(1, Math.ceil(dt * 120));
  for (let i = 0; i < n; i++) stepPlane(p, cc, dt / n);

  // edge of the battlefield: a headwind turns you round
  if (Math.hypot(p.pos.x, p.pos.z) > WORLD_R) {
    let d = Math.atan2(-p.pos.x, -p.pos.z) - Math.atan2(p.vel.x, p.vel.z);
    d = Math.atan2(Math.sin(d), Math.cos(d));
    tq.setFromAxisAngle(UP, Math.sign(d) * Math.min(Math.abs(d), 1.0*dt));
    p.vel.applyQuaternion(tq); p.q.premultiply(tq);
  }
  if (p.pos.y > 1500) p.vel.y -= (p.pos.y - 1500) * 0.3 * dt;            // thin air ceiling

  // weapons
  const s = p.st;
  p.missileCd -= dt; p.ramCd -= dt; p.skillCd -= dt; p.overT -= dt; p.hitT -= dt;
  if (p.jam > 0) p.jam -= dt;
  if (p.shield > 0) p.shield -= dt;
  p.bubble.visible = p.shield > 0;
  p.aim = s.gunRange ? pickTarget(p, s.aimCos, s.gunRange) : null;      // auto-aim: inside the aim ring and gun range
  const lock = s.mslCap ? pickTarget(p, 0.9, 1500) : null;              // ~26 degree missile cone
  if (lock && lock !== p.lock) beep("sine", 1200, 1200, 0.06, 0.04);
  p.lock = lock;
  const armed = p.jam <= 0;
  fireGuns(p, !!c.fire && armed, dt);
  if (c.missile && armed && p.missiles > 0 && p.missileCd <= 0 && p.lock) fireMissile(p);
  if (p.missiles < s.mslCap) { p.missileT += dt; if (p.missileT > s.mslReload) { p.missileT = 0; p.missiles++; } }
  if (c.skill && p.skillClass && p.skillCd <= 0) useSkill(p);

  // effects: thruster flames, wingtip vapour under heavy G, smoke when hurt
  _fwd.set(0, 0, -1).applyQuaternion(p.q);
  const hot = p.thr > 1;
  for (const th of s.thrusters) {
    t1.set(th[0], th[1], th[2]).applyQuaternion(p.q).add(p.pos);
    // short, narrow flames: the chase camera looks straight down the exhaust
    emit(FIRE, t1.x, t1.y, t1.z, p.vel.x*0.55 - _fwd.x*20, p.vel.y*0.55 - _fwd.y*20, p.vel.z*0.55 - _fwd.z*20, hot ? 0.2 : 0.1,
         hot ? 1.5 : 1.0, -3, 0, hot ? 1 : 0.5, hot ? 0.6 : 0.7, hot ? 0.2 : 1, hot ? 0.8 : 0.6);
  }
  if (Math.abs(p.gLoad) > 4 && p.speed > 60) for (const sx of [-1, 1]) {
    t1.set(sx * s.size * 0.5, 0, 1).applyQuaternion(p.q).add(p.pos);
    emit(SMOKE, t1.x, t1.y, t1.z, p.vel.x*0.15, p.vel.y*0.15, p.vel.z*0.15, 0.9, 0.9, 1.5, 0, 1, 1, 1, 0.45);
  }
  if (p.hp < 0.45*s.maxHp && Math.random() < dt*25) emit(SMOKE, p.pos.x, p.pos.y, p.pos.z, p.vel.x*0.3, p.vel.y*0.3 + 3, p.vel.z*0.3,
                                                         1.6, 2, 6, -1, 0.15, 0.15, 0.15, 0.6);

  // collisions: ground, and ramming a raider
  if (p.pos.y < groundAt(p.pos.x, p.pos.z) + 1.5) { p.shield = 0; hurtPlayer(p, 99999, null); return; }
  if (p.ramCd <= 0) for (const e of enemies) {
    if (e.pos.distanceTo(p.pos) < e.r * 0.75 + 3) { p.ramCd = 1; hurtEnemy(e, 5, p); hurtPlayer(p, 35, null); break; }
  }
}
const _camQ = new Quat(), _aimQ = new Quat(), _aimD = new V3(), _camP = new V3(), ORIGIN = new V3();
function aimDir(p, out){ const cp = Math.cos(p.mouse.pit); return out.set(-Math.sin(p.mouse.yaw) * cp, Math.sin(p.mouse.pit), -Math.cos(p.mouse.yaw) * cp); }
function updateCam(p, dt){
  if (!p.alive) return;
  // Two views, blended: the chase camera rides behind the plane and rolls with it; while the mouse is flying,
  // the camera instead looks along the direction being pointed at and keeps the horizon level.
  const m = p.mouse;
  m.blend = clamp(m.blend + (m.on ? 1 : -1) * dt * 3, 0, 1);
  const off = camOffset(p, t1);
  _camP.copy(off).applyQuaternion(p.q).add(p.pos);
  _camQ.copy(p.q);
  if (m.blend > 0) {
    aimDir(p, _aimD);
    _aimQ.setFromRotationMatrix(tm.lookAt(ORIGIN, _aimD, UP));
    t2.copy(p.pos).addScaledVector(_aimD, -off.z); t2.y += off.y;
    const b = m.blend * m.blend * (3 - 2*m.blend);
    _camP.lerp(t2, b); _camQ.slerp(_aimQ, b);
  }
  p.cam.position.lerp(_camP, 1 - Math.exp(-dt*9));
  p.cam.quaternion.slerp(_camQ, 1 - Math.exp(-dt*6));
  if (p.shake > 0) {
    p.shake -= dt;
    p.cam.position.x += rand(-1, 1)*p.shake; p.cam.position.y += rand(-1, 1)*p.shake;
  }
  const fov = 68 + clamp((p.speed - 100) / 60, 0, 1) * 14;
  if (Math.abs(fov - p.cam.fov) > 0.05) { p.cam.fov += (fov - p.cam.fov) * Math.min(1, 4*dt); p.cam.updateProjectionMatrix(); }
}

// ---------- HUD (drawn on a 2D canvas over the 3D view) ----------
const _cs = new V3();
function toScreen(pos, cam, w, h){                    // -> [x, y, inFront, camSpaceX, camSpaceY]
  _cs.copy(pos).applyMatrix4(cam.matrixWorldInverse);
  const cx = _cs.x, cy = _cs.y, front = _cs.z < 0;
  _cs.applyMatrix4(cam.projectionMatrix);
  return [(_cs.x*0.5 + 0.5)*w, (-_cs.y*0.5 + 0.5)*h, front, cx, cy];
}
function marker(pos, cam, w, h, col, label, size, health){    // bracket if visible, edge arrow if not
  const s = toScreen(pos, cam, w, h), d = pos.distanceTo(cam.position);
  hc.strokeStyle = hc.fillStyle = col;
  if (s[2] && s[0] > 8 && s[0] < w - 8 && s[1] > 8 && s[1] < h - 8) {
    const r = clamp(size * h / d, 9, 70);
    hc.lineWidth = 2;
    hc.beginPath();
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      hc.moveTo(s[0] + sx*r, s[1] + sy*r*0.5); hc.lineTo(s[0] + sx*r, s[1] + sy*r); hc.lineTo(s[0] + sx*r*0.5, s[1] + sy*r);
    }
    hc.stroke();
    if (health < 1) {                                 // a damaged ship shows how much hull it has left
      hc.fillStyle = "rgba(0,0,0,.5)"; hc.fillRect(s[0] - r, s[1] + r + 4, 2*r, 4);
      hc.fillStyle = "#ffe040"; hc.fillRect(s[0] - r, s[1] + r + 4, 2*r*Math.max(0, health), 4);
      hc.fillStyle = col;
    }
    if (label) { hc.font = "12px Segoe UI"; hc.textAlign = "center"; hc.fillText(label + " " + Math.round(d) + " m", s[0], s[1] - r - 5); }
    return s;
  }
  const a = Math.atan2(-s[4], s[3]), R = Math.min(w, h) * 0.42;
  hc.save();
  hc.translate(w/2 + Math.cos(a)*R, h/2 + Math.sin(a)*R); hc.rotate(a);
  hc.beginPath(); hc.moveTo(13, 0); hc.lineTo(-7, -8); hc.lineTo(-7, 8); hc.closePath(); hc.fill();
  hc.restore();
  return null;
}
function drawHud(p, x0, w, h){
  hc.save();
  hc.beginPath(); hc.rect(x0, 0, w, h); hc.clip();
  hc.translate(x0, 0);
  if (p.flash > 0) { hc.fillStyle = "rgba(255,0,0," + (p.flash*0.6) + ")"; hc.fillRect(0, 0, w, h); }
  hc.shadowColor = "rgba(0,0,0,.8)"; hc.shadowBlur = 3;
  const cam = p.cam, s = p.st, duel = round === "duel";
  if (p.alive) {
    // targets: brackets for the ones in view, arrows for the 4 nearest out of view
    const near = foes(p).slice().sort((a, b) => a.pos.distanceToSquared(p.pos) - b.pos.distanceToSquared(p.pos));
    let arrows = 0;
    for (const e of near) {
      const vis = toScreen(e.pos, cam, w, h);
      const onScreen = vis[2] && vis[0] > 8 && vis[0] < w - 8 && vis[1] > 8 && vis[1] < h - 8;
      if (!onScreen && arrows++ >= 4) continue;
      marker(e.pos, cam, w, h, e === p.lock ? "#ffe040" : "#ff5040", e === p.lock ? "LOCK" : e.isPlayer ? e.name : "", e.r * 1.1, e.hp / e.maxHp);
    }
    for (const o of allies(p)) if (o.alive) marker(o.pos, cam, w, h, "#60ff90", o.name, 9);
    // gun sight: where the nose really points (the camera lags behind it)
    const g = toScreen(t1.set(0, 0, -600).applyQuaternion(p.q).add(p.pos), cam, w, h);
    hc.strokeStyle = p.aim ? "#ffe040" : "#ffffff"; hc.lineWidth = 2;
    hc.beginPath(); hc.arc(g[0], g[1], 11, 0, Math.PI*2);
    hc.moveTo(g[0] - 20, g[1]); hc.lineTo(g[0] - 6, g[1]); hc.moveTo(g[0] + 6, g[1]); hc.lineTo(g[0] + 20, g[1]);
    hc.moveTo(g[0], g[1] - 20); hc.lineTo(g[0], g[1] - 6); hc.stroke();
    // auto-aim ring: any target inside it gets led and hit automatically; targeting units make it bigger
    const ring = Math.tan(s.aimDeg * Math.PI/180) / Math.tan(cam.fov * Math.PI/360) * h/2;
    hc.strokeStyle = p.aim ? "rgba(255,224,64,.75)" : "rgba(255,255,255,.3)"; hc.lineWidth = 1.5;
    hc.beginPath(); hc.arc(g[0], g[1], ring, 0, Math.PI*2); hc.stroke();
    if (p.hitT > 0) {                                 // hit marker
      hc.strokeStyle = "#ff4030"; hc.lineWidth = 3;
      hc.beginPath();
      for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { hc.moveTo(g[0] + sx*8, g[1] + sy*8); hc.lineTo(g[0] + sx*17, g[1] + sy*17); }
      hc.stroke();
    }
    if (p.mouse.on) {                                 // mouse flight: a small marker where the pilot is pointing; the plane flies towards it
      const a = toScreen(aimDir(p, t1).multiplyScalar(1500).add(p.pos), cam, w, h);
      if (a[2]) {
        hc.strokeStyle = "#ffffff"; hc.lineWidth = 2;
        hc.beginPath(); hc.arc(a[0], a[1], 5, 0, Math.PI*2); hc.stroke();
        hc.beginPath(); hc.moveTo(a[0] - 14, a[1]); hc.lineTo(a[0] - 8, a[1]); hc.moveTo(a[0] + 8, a[1]); hc.lineTo(a[0] + 14, a[1]);
        hc.moveTo(a[0], a[1] + 8); hc.lineTo(a[0], a[1] + 14); hc.stroke();
      }
    }
  }
  // gauges
  const agl = p.pos.y - groundAt(p.pos.x, p.pos.z);
  hc.textAlign = "left"; hc.font = "bold 15px Segoe UI";
  hc.fillStyle = p.css; hc.fillText(p.name + (p.invert ? "  (inverted)" : ""), 14, 24);
  hc.fillStyle = "#fff"; hc.font = "14px Segoe UI";
  const bar = (y, label, v, col) => {
    hc.fillStyle = "#fff"; hc.fillText(label, 14, y + 10);
    hc.fillStyle = "rgba(0,0,0,.45)"; hc.fillRect(70, y, 130, 11);
    hc.fillStyle = col; hc.fillRect(70, y, 130 * clamp(v, 0, 1), 11);
    hc.strokeStyle = "#fff"; hc.lineWidth = 1; hc.strokeRect(70, y, 130, 11);
  };
  const hf = p.hp / s.maxHp;
  bar(34, "HULL", hf, hf > 0.5 ? "#4caf50" : hf > 0.25 ? "#ff9800" : "#f44336");
  bar(51, "BOOST", p.boost / s.boostCap, p.overT > 0 ? "#ffe040" : "#40b0ff");
  hc.fillStyle = "#fff";
  hc.fillText("MSL  " + (s.mslCap ? "▲".repeat(p.missiles) + "△".repeat(Math.max(0, s.mslCap - p.missiles)) : "none"), 14, 82);
  hc.fillText("GUNS  " + s.gunText, 14, 100);
  let gy = 108;
  if (p.skillClass) {
    const rdy = p.skillCd <= 0;
    bar(gy, "SKILL", 1 - Math.max(0, p.skillCd) / p.skillMax, rdy ? "#ffe040" : "#8a7a30");
    hc.fillStyle = rdy ? "#ffe040" : "#fff";
    hc.fillText(SKILLS[p.skillClass] + (rdy ? " — ready" : ""), 208, gy + 10);
    gy += 18;
  }
  if (p.overT > 0) { hc.fillStyle = "#ffe040"; hc.fillText("OVERDRIVE " + p.overT.toFixed(1), 14, gy + 10); gy += 18; }
  if (p.linked) { hc.fillStyle = "#60ff90"; hc.fillText("✚ WING LINK — repairing", 14, gy + 10); }
  hc.fillStyle = "#fff"; hc.font = "bold 16px Consolas, monospace";
  hc.fillText("SPD " + String(Math.round(p.speed * 3.6)).padStart(4) + " km/h", 14, h - 62);
  hc.fillText("ALT " + String(Math.round(Math.max(0, agl))).padStart(4) + " m", 14, h - 42);
  hc.fillText("G   " + p.gLoad.toFixed(1).padStart(5), 14, h - 22);
  hc.textAlign = "right"; hc.font = "14px Segoe UI";
  if (duel) {
    hc.fillText("DUEL — first to " + DUEL_KILLS, w - 14, 24);
    hc.fillText("You " + p.duelKills + "  :  " + rivals(p).map(o => o.duelKills + " " + o.name).join(",  "), w - 14, 44);
  } else {
    hc.fillText("Wave " + wave + "   Raiders " + enemies.length, w - 14, 24);
    hc.fillText("Score " + score + "   Spare planes " + lives, w - 14, 44);
  }
  // warnings
  hc.textAlign = "center"; hc.font = "bold 24px Segoe UI";
  let warn = "";
  if (!p.alive) warn = p.respawnT > 0 ? "DESTROYED — new plane in " + Math.ceil(p.respawnT) : "DESTROYED";
  else if (p.jam > 0) warn = "WEAPONS JAMMED " + p.jam.toFixed(1);
  else if (p.stalled && p.speed < 75) warn = "STALL — nose down, add power";
  else if (agl < 70 && p.vel.y < -4) warn = "PULL UP";
  else if (Math.hypot(p.pos.x, p.pos.z) > WORLD_R - 300) warn = "LEAVING THE BATTLE — turning back";
  if (warn) { hc.fillStyle = "#ff5040"; hc.fillText(warn, w/2, h*0.3); }
  else if (p.shield > 0) { hc.fillStyle = "#80d0ff"; hc.font = "16px Segoe UI"; hc.fillText("SHIELD " + p.shield.toFixed(1), w/2, h*0.3); }
  if (p.i === 0 && state === "playing" && !mouseLocked()) {   // the mouse flies the plane only once it has been captured
    hc.font = "14px Segoe UI"; hc.fillStyle = "rgba(255,255,255,.75)";
    hc.fillText("Click to fly with the mouse  ·  Esc frees it again", w/2, h - 18);
  }
  hc.restore();
}
function drawHangar(p, x0, w, h){                     // panels around the 3D view of the plane on its pad
  hc.save();
  hc.beginPath(); hc.rect(x0, 0, w, h); hc.clip();
  hc.translate(x0, 0);
  const e = p.ed, s = p.st, free = p.bank - buildCost(p.build);
  const fs = clamp(h / 50, 9, 14), rh = clamp((h - 220) / PART_ORDER.length, 12, 24);
  const font = (bold, k) => { hc.font = (bold ? "bold " : "") + Math.round(fs * (k || 1)) + "px Segoe UI"; };
  const PANEL = "rgba(8,14,30,.66)";
  const ui = p.ui = [];                               // what the mouse can click this frame: {x, y, w, h, go}
  const button = (x, y, bw, bh, go) => ui.push({x, y, w: bw, h: bh, go: () => { if (state === "upgrade" && upLock <= 0) go(); }});
  hc.textBaseline = "middle";
  // header
  hc.fillStyle = PANEL; hc.fillRect(0, 0, w, 56);
  hc.textAlign = "left"; hc.fillStyle = p.css; font(true, 1.5);
  hc.fillText(p.name + " — hangar", 12, 20, w * 0.5);
  hc.textAlign = "right"; hc.fillStyle = "#ffe040";
  hc.fillText("★ " + free + " free of " + p.bank, w - 12, 20);
  hc.textAlign = "left"; hc.fillStyle = "#cfd8e6"; font(false, 0.95);
  hc.fillText(p.earned.join("   ·   "), 12, 43, w - 24);
  // name tag at the cursor: the block that is there, or the one that A would place
  {
    const c0 = p.edRoot.position, here = p.build.get(key(e.x, e.y, e.z));
    const cs = toScreen(t1.set(c0.x + e.x*CELL, (e.y + 0.8)*CELL, c0.z + e.z*CELL), p.edCam, w, h);
    const label = here ? PARTS[here.t].name : "+ " + PARTS[PART_ORDER[e.sel]].name;
    font(true, 1);
    const tw = hc.measureText(label).width + 16, lx = clamp(cs[0], tw/2 + 4, w - tw/2 - 4), ly = clamp(cs[1] - 14, 72, h - 130);
    hc.fillStyle = "rgba(8,14,30,.88)"; hc.fillRect(lx - tw/2, ly - 11, tw, 22);
    hc.strokeStyle = here ? "#ffffff" : p.css; hc.lineWidth = 1; hc.strokeRect(lx - tw/2, ly - 11, tw, 22);
    hc.textAlign = "center"; hc.fillStyle = here ? "#ffffff" : "#ffe040"; hc.fillText(label, lx, ly);
  }
  // parts
  const hv = hangarLayout(w, h), lw = hv.lw, top = 64;
  hc.fillStyle = PANEL; hc.fillRect(6, top, lw, rh * PART_ORDER.length + 98);
  font(true, 0.9); hc.textAlign = "left"; hc.fillStyle = "#7f93b3"; hc.fillText("PARTS   LT ◀ ▶ RT", 12, top + 11);
  PART_ORDER.forEach((id, i) => {
    const d = PARTS[id], y = top + 22 + i*rh, sel = i === e.sel, poor = d.cost > free;
    button(8, y, lw - 4, rh, () => { if (!p.ready) { e.sel = i; updateCursor(p); } });
    if (sel) {
      hc.fillStyle = "rgba(255,255,255,.16)"; hc.fillRect(8, y, lw - 4, rh - 1);
      hc.strokeStyle = p.css; hc.lineWidth = 2; hc.strokeRect(8, y, lw - 4, rh - 1);
    }
    if (THUMBS[id]) hc.drawImage(THUMBS[id], 10, y + 1, rh - 3, rh - 3);              // a little picture of the part
    font(sel); hc.textAlign = "left"; hc.fillStyle = poor ? "#7a8496" : "#fff"; hc.fillText(d.name, 12 + rh, y + rh/2, lw - 44 - rh);
    hc.textAlign = "right"; hc.fillStyle = poor ? "#7a8496" : "#ffe040"; hc.fillText(String(d.cost), lw - 2, y + rh/2);
  });
  let y2 = top + 22 + PART_ORDER.length * rh + 12;
  font(false); hc.textAlign = "left"; hc.fillStyle = "#fff";
  hc.fillText("X  paint:", 14, y2); hc.fillStyle = "#" + PALETTE[e.color].toString(16).padStart(6, "0");
  hc.fillRect(74, y2 - 7, 22, 14); hc.strokeStyle = "#fff"; hc.lineWidth = 1; hc.strokeRect(74, y2 - 7, 22, 14);
  hc.fillStyle = "#cfd8e6"; hc.fillText(PALETTE_NAMES[e.color], 102, y2);
  y2 += 20;
  const sw = Math.min(17, (lw - 20) / PALETTE.length);     // every colour, to click
  PALETTE.forEach((hex, i) => {
    const sx = 12 + i * sw;
    hc.fillStyle = "#" + hex.toString(16).padStart(6, "0"); hc.fillRect(sx, y2 - 7, sw - 3, 14);
    if (i === e.color) { hc.strokeStyle = "#fff"; hc.lineWidth = 2; hc.strokeRect(sx - 1, y2 - 8, sw - 1, 16); }
    button(sx - 1, y2 - 9, sw, 18, () => { if (!p.ready) { e.color = i; updateCursor(p); saveGame(); } });
  });
  y2 += 22;
  hc.fillStyle = "#fff"; hc.fillText("Y  mirror: ", 14, y2);
  hc.fillStyle = e.mirror ? "#60ff90" : "#ff8070"; hc.fillText(e.mirror ? "ON — both sides" : "OFF", 80, y2);
  button(8, y2 - 10, lw - 4, 20, () => edAct(p, "mirror"));
  // stats
  const rows = [["Hull", Math.round(s.maxHp) + " HP"], ["Weight", s.mass.toFixed(1) + " t"], ["Top speed", s.topKmh + " km/h"],
                ["Turning", Math.round(s.stall / STALL * 100) + "%"], ["Roll", Math.round(s.rollK * 100) + "%"],
                ["Pitch", Math.round(s.pitchK * 100) + "%"], ["Boost", (s.boostCap / 20).toFixed(1) + " s"],
                ["Guns", s.gunText], ["Missiles", s.mslCap ? s.mslCap + (s.salvo > 1 ? ", " + s.salvo + " at once" : "") : "none"],
                ["Aim ring", s.aimDeg + "°"], ["Skill", p.skillClass ? SKILLS[p.skillClass] + (s.skillLvl > 1 ? " ×" + s.skillLvl : "") : "none"]];
  const rw = hv.rw, rx = w - rw - 6, sh = Math.min(rh, 20);
  hc.fillStyle = PANEL; hc.fillRect(rx, top, rw, sh * rows.length + 28);
  font(true, 0.9); hc.textAlign = "left"; hc.fillStyle = "#7f93b3"; hc.fillText("YOUR PLANE", rx + 6, top + 11);
  rows.forEach(([k, v], i) => {
    const y = top + 24 + i*sh + sh/2;
    font(false); hc.textAlign = "left"; hc.fillStyle = "#cfd8e6"; hc.fillText(k, rx + 6, y);
    font(true); hc.textAlign = "right"; hc.fillStyle = "#fff"; hc.fillText(v, w - 12, y, rw - 78);
  });
  // bottom: what the selected part does, problems, what comes next, controls
  const by = h - 108;
  hc.fillStyle = PANEL; hc.fillRect(0, by - 4, w, 112);
  hc.textAlign = "center";
  const sel = PARTS[PART_ORDER[e.sel]];
  if (e.msgT > 0) { font(true, 1.1); hc.fillStyle = "#ff6050"; hc.fillText(e.msg, w/2, by + 10, w - 20); }
  else { font(false, 1.05); hc.fillStyle = "#ffe040"; hc.fillText(sel.name + " (" + sel.cost + "): " + sel.info, w/2, by + 10, w - 20); }
  font(true, 1.05);
  if (activePlayers().length > 1) {
    hc.fillStyle = pvpNext ? "#ff8070" : "#60ff90";
    hc.fillText(pvpNext ? "NEXT: DUEL — pilot against pilot, first to " + DUEL_KILLS + "   (click, View/Back or T to change)"
                        : "NEXT: WAVE " + (wave + 1) + " — one team against the raiders   (click, View/Back or T to change)", w/2, by + 32, w - 20);
    button(10, by + 21, w - 20, 22, () => edAct(p, "pvp"));
  } else { hc.fillStyle = "#60ff90"; hc.fillText("NEXT: WAVE " + (wave + 1), w/2, by + 32, w - 20); }
  font(false, 0.82); hc.fillStyle = "#9fb0c8";
  hc.fillText("Mouse: left click place · right click remove · middle click paint · right-drag turn · wheel zoom", w/2, by + 50, w - 20);
  hc.fillText("Pad: stick move · LB/RB layer · A place · B remove · X paint · Y mirror        Keys: " +
              (mode === 2 && p.i === 1 ? "arrows · PgUp/PgDn · Enter · Backspace · / · M" : "WASD · Q/E · Space · X · F · V"), w/2, by + 64, w - 20);
  font(true, 1.15);
  const bw = Math.min(w - 40, 420), bx = (w - bw) / 2, waiting = activePlayers().some(q => q !== p && !q.ready);
  hc.fillStyle = p.ready ? "rgba(96,255,144,.18)" : "rgba(255,255,255,.14)"; hc.fillRect(bx, by + 75, bw, 26);
  hc.strokeStyle = p.ready ? "#60ff90" : "#ffffff"; hc.lineWidth = 1.5; hc.strokeRect(bx, by + 75, bw, 26);
  hc.fillStyle = p.ready ? "#60ff90" : "#fff";
  hc.fillText(p.ready ? (waiting ? "✔ READY — waiting for the other pilot" : "✔ READY") : "READY — take off   (click, Start or R)", w/2, by + 88, bw - 12);
  button(bx, by + 75, bw, 26, () => edAct(p, "ready"));
  hc.restore();
}

// ---------- main loop ----------
// The simulation advances in fixed steps of 1/120 s whatever the screen's frame rate, and reads nothing but
// the pilots' commands. Same commands in, same flight out: that is the property online play will rely on.
const clock = new THREE.Clock();
const STEP = 1 / 120;
let simAcc = 0, simTick = 0;
function simStep(dt, cmds){                           // cmds[slot] = that pilot's command for this step
  simTick++;
  for (const p of activePlayers()) {
    if (p.alive) updatePlayer(p, cmds[p.i] || NEUTRAL, dt);
    else if (p.respawnT > 0) { p.respawnT -= dt; if (p.respawnT <= 0 && roundEndT <= 0) respawn(p); }
    else if (p.respawnT < 0 && lives > 0 && round === "wave") { lives--; respawn(p); }   // a spare plane was earned
    if (p.flash > 0) p.flash -= dt;
  }
  // allies who stay close repair each other
  for (const p of activePlayers()) {
    const near = p.alive && allies(p).some(o => o.alive && o.pos.distanceTo(p.pos) < 220);
    p.linked = near && p.hp < p.st.maxHp;
    if (near) p.hp = Math.min(p.st.maxHp, p.hp + 5*dt);
  }
  for (let i = enemies.length - 1; i >= 0; i--) updateEnemy(enemies[i], dt);
  updateBolts(dt);
  for (let i = missiles.length - 1; i >= 0; i--) {
    updateMissile(missiles[i], dt);
    if (missiles[i].life <= 0) { scene.remove(missiles[i].m); missiles.splice(i, 1); }
  }
  updateDebris(dt);
  updateParticles(FIRE, dt); updateParticles(SMOKE, dt);
  if (bannerT > 0) bannerT -= dt;
  for (const p of activePlayers()) updateCam(p, dt);  // cameras move in step with the planes they follow
  if (state !== "playing") return;
  if (round === "duel") {                             // duel over: a short pause, then back to the hangar
    if (roundEndT > 0) { roundEndT -= dt; if (roundEndT <= 0) finishDuel(); }
  } else if (enemies.length === 0) {                  // wave cleared
    if (waveT <= 0) { waveT = 2.5; banner = "WAVE " + wave + " CLEARED — back to the hangar"; bannerT = 2.5; }
    waveT -= dt;
    if (waveT <= 0) finishWave();
  }
}
function animate(){
  requestAnimationFrame(animate);
  if (renderer.domElement.width !== Math.floor(innerWidth * renderer.getPixelRatio())) layout();
  const dt = Math.min(clock.getDelta(), 0.1), t = clock.elapsedTime;

  const pads = pollPads(), any = k => pads.some(p => p[k]);
  if (state === "playing") {
    if (any("startEdge")) pause();
  } else if (state === "upgrade") {                   // each pilot works on their own plane
    if (upLock > 0) upLock -= dt;
    for (const p of activePlayers()) hangarInput(p, padFor(p.i, pads), dt);
  } else {
    padsLine(pads);
    if (state === "paused") {
      if (any("startEdge") || any("aEdge")) { audioOn(); startGuard = true; resume(); }
      else if (any("backEdge")) toMenu();
    } else {                                          // title screen and game over: pick a button
      const vis = menuButtons(), all = [btnC, btn1, btn2], at = vis.indexOf(all[menuSel]);
      if (any("leftEdge")) setSel(all.indexOf(vis[Math.max(0, at - 1)]));
      if (any("rightEdge")) setSel(all.indexOf(vis[Math.min(vis.length - 1, at + 1)]));
      if (any("startEdge") || any("aEdge")) { startGuard = true; menuGo(menuSel); }
    }
  }

  if (state === "playing") {
    if (startGuard && !pads.some(p => p.a || p.start || p.fire) && !keys.Enter && !keys.Space && !keys.KeyR && !keys.ShiftRight && !mouse.left) startGuard = false;
    const cmds = {};
    for (const p of activePlayers()) cmds[p.i] = commandFor(p, pads);   // devices are read once a frame...
    simAcc += dt;
    for (let n = 0; simAcc >= STEP - 1e-9 && state === "playing"; n++) {   // ...and the world then takes as many fixed steps as the frame lasted
      if (n >= 8) { simAcc = 0; break; }              // after a long stall, drop the backlog instead of fast-forwarding
      simStep(STEP, cmds);
      simAcc -= STEP;
    }
  }

  // render: the hangar pads while building, otherwise the world (chase views, or a slow orbit behind the menu)
  const n = mode === 2 ? 2 : 1, W = innerWidth, H = innerHeight;
  const inHangar = state === "upgrade" || (state === "paused" && pausedFrom === "upgrade");
  if (state === "menu") {
    players[0].cam.position.set(Math.sin(t*0.07)*1300, 520, Math.cos(t*0.07)*1300);
    players[0].cam.lookAt(0, 160, 0);
  }
  for (let i = 0; i < n; i++) {
    const p = players[i];
    renderer.setViewport(i*W/n, 0, W/n, H);
    renderer.setScissor(i*W/n, 0, W/n, H);
    if (inHangar) {
      const e = p.ed, c = p.edRoot.position, d = (p.edDist || 27) * Math.max(1, p.st.size / 10.8) * (e.zoom || 1);   // step back for big planes; the wheel zooms
      hangarSun.position.set(c.x + 14, 30, c.z + 20);
      hangarSun.target.position.set(c.x, 0, c.z);
      hangarSun.target.updateMatrixWorld();
      p.edCam.position.set(c.x + Math.sin(e.yaw)*Math.cos(e.pit)*d, Math.sin(e.pit)*d, c.z + Math.cos(e.yaw)*Math.cos(e.pit)*d);
      p.edCam.lookAt(c.x, 0, c.z);
      renderer.render(hangar, p.edCam);
    } else renderer.render(scene, p.cam);
  }

  hc.clearRect(0, 0, W, H);
  if (state !== "menu") {
    for (let i = 0; i < n; i++) (inHangar ? drawHangar : drawHud)(players[i], i*W/n, W/n, H);
    if (n === 2) { hc.fillStyle = "#000"; hc.fillRect(W/2 - 2, 0, 4, H); }
    if (bannerT > 0 && state === "playing") {
      hc.font = "bold 26px Segoe UI"; hc.textAlign = "center"; hc.fillStyle = "#ffe040";
      hc.shadowColor = "#000"; hc.shadowBlur = 6;
      hc.fillText(banner, W/2, H*0.14);
      hc.shadowBlur = 0;
    }
  }
}
const THUMBS = {};
function makeThumbs(){                                // one small picture per part, for the hangar's parts list
  const TS = 64, pr = renderer.getPixelRatio(), sc = new THREE.Scene();
  sc.background = new THREE.Color(0x1b2434);
  sc.add(new THREE.HemisphereLight(0xffffff, 0x445066, 0.9));
  const l = new THREE.DirectionalLight(0xffffff, 0.8); l.position.set(0.5, 1, 0.7); sc.add(l);
  const cam = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
  cam.position.set(3.4, 2.6, 4.2); cam.lookAt(0, 0, -0.3);
  for (const id of PART_ORDER) {
    const g = buildGroup(new Map([["0,0,0", {x: 0, y: 0, z: 0, t: id, c: 0}]]));
    sc.add(g);
    renderer.setViewport(0, 0, TS, TS); renderer.setScissor(0, 0, TS, TS);
    renderer.render(sc, cam);
    const cv = document.createElement("canvas"); cv.width = cv.height = TS;
    cv.getContext("2d").drawImage(renderer.domElement, 0, renderer.domElement.height - TS*pr, TS*pr, TS*pr, 0, 0, TS, TS);
    THUMBS[id] = cv;
    dropGroup(sc, g);
  }
}
layout();
try { makeThumbs(); } catch (e) { console.warn("part pictures unavailable", e); }
toMenu();
animate();

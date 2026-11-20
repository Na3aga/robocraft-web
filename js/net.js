"use strict";
// =====================================================================================
//  Sky Squadron — groundwork for online play. Nothing in this file is switched on yet:
//  the game never calls it. It defines what would travel between machines and proves
//  (see docs/MULTIPLAYER.md and Net.selfTest) that the game's state survives the trip.
//
//  The plan is host-authoritative: one machine (the host) runs the real simulation.
//  Every other machine sends its pilot's commands and draws the snapshots it gets back.
//    client -> host : hello, build, cmd
//    host -> client : welcome, lobby, start, snap, end
//  What already makes that possible in game.js:
//    - the simulation reads only command objects (commandFor / simStep), never devices
//    - it advances in fixed 1/120 s steps, counted by simTick
//    - a pilot is a slot with a team; p.remote + p.netCmd let a slot be flown from elsewhere
//    - planes are plain data (the same arrays the save file uses)
// =====================================================================================
const Net = (() => {
  const PROTOCOL = 1;                                 // bump when a message changes shape; machines with different numbers must not play together
  const r2 = v => Math.round(v * 100) / 100, r3 = v => Math.round(v * 1000) / 1000;
  const v3 = v => [r2(v.x), r2(v.y), r2(v.z)];

  // ----- commands: what a pilot asks of the plane for one frame (see commandFor in game.js) -----
  // [pitch, roll, yaw, buttons, aim]  buttons: 1 guns, 2 missiles, 4 skill, 8 afterburner, 16 air brake
  function packCmd(c){
    return [r2(c.pitch), r2(c.roll), r2(c.yaw),
            (c.fire ? 1 : 0) | (c.missile ? 2 : 0) | (c.skill ? 4 : 0) | (c.boost ? 8 : 0) | (c.brake ? 16 : 0),
            c.aim ? c.aim.map(r3) : 0];
  }
  function unpackCmd(a){
    const b = a[3] | 0, n = v => Math.max(-1, Math.min(1, +v || 0));    // never trust the wire: clamp everything
    const aim = Array.isArray(a[4]) && a[4].length === 3 && a[4].every(Number.isFinite) ? a[4].map(Number) : null;
    return {pitch: n(a[0]), roll: n(a[1]), yaw: n(a[2]), fire: b & 1, missile: (b >> 1) & 1, skill: (b >> 2) & 1,
            boost: (b >> 3) & 1, brake: (b >> 4) & 1, aim};
  }

  // ----- planes: the block build, in the save-file format [[x, y, z, part, colour], ...] -----
  function packBuild(build){ return Array.from(build.values()).map(q => [q.x, q.y, q.z, q.t, q.c]); }
  function unpackBuild(arr, slot){ return buildFromSave(arr, slot); }   // validates, and falls back to the starter plane

  // ----- pilots: everything about a plane in flight that another machine needs in order to draw it -----
  function packPilot(p){
    return {i: p.i, team: p.team, alive: p.alive ? 1 : 0, pos: v3(p.pos), q: [r3(p.q.x), r3(p.q.y), r3(p.q.z), r3(p.q.w)],
            vel: v3(p.vel), w: [r3(p.w.x), r3(p.w.y), r3(p.w.z)], hp: r2(p.hp), boost: r2(p.boost), thr: r2(p.thr),
            missiles: p.missiles, shield: r2(Math.max(0, p.shield)), jam: r2(Math.max(0, p.jam)), overT: r2(Math.max(0, p.overT)),
            skillCd: r2(Math.max(0, p.skillCd)), respawnT: r2(p.respawnT), kills: p.kills, duelKills: p.duelKills};
  }
  function applyPilot(p, s){
    p.team = s.team; p.alive = !!s.alive; p.mesh.visible = p.alive;
    p.pos.set(s.pos[0], s.pos[1], s.pos[2]); p.q.set(s.q[0], s.q[1], s.q[2], s.q[3]).normalize();
    p.vel.set(s.vel[0], s.vel[1], s.vel[2]); p.w.set(s.w[0], s.w[1], s.w[2]);
    p.hp = s.hp; p.boost = s.boost; p.thr = s.thr; p.missiles = s.missiles; p.shield = s.shield; p.jam = s.jam;
    p.overT = s.overT; p.skillCd = s.skillCd; p.respawnT = s.respawnT; p.kills = s.kills; p.duelKills = s.duelKills;
    p.speed = p.vel.length();
  }

  // ----- raiders -----
  function packRaider(e){
    return {id: e.id, big: e.big ? 1 : 0, pos: v3(e.pos), fwd: [r3(e.fwd.x), r3(e.fwd.y), r3(e.fwd.z)], cur: r2(e.cur),
            hp: r2(e.hp), maxHp: r2(e.maxHp), stun: r2(Math.max(0, e.stun)), mode: e.mode};
  }
  function applyRaiders(list){
    const byId = new Map(enemies.map(e => [e.id, e]));
    for (const s of list) {
      let e = byId.get(s.id);
      if (!e) { spawnEnemy(s.pos[0], s.pos[1], s.pos[2], !!s.big); e = enemies[enemies.length - 1]; e.id = s.id; }
      byId.delete(s.id);
      e.pos.set(s.pos[0], s.pos[1], s.pos[2]); e.fwd.set(s.fwd[0], s.fwd[1], s.fwd[2]).normalize();
      e.cur = s.cur; e.vel.copy(e.fwd).multiplyScalar(e.cur);
      e.hp = s.hp; e.maxHp = s.maxHp; e.stun = s.stun; e.mode = s.mode;
    }
    for (const e of byId.values()) {                  // gone on the host: gone here
      scene.remove(e.mesh);
      enemies.splice(enemies.indexOf(e), 1);
    }
  }

  // ----- the world, as the host would send it several times a second -----
  // Shots and missiles are deliberately left out: each machine fires its own from the commands it sees,
  // and only the host's hits count. That keeps a snapshot small.
  function snapshot(){
    return {v: PROTOCOL, tick: simTick, round, wave, score, lives,
            pilots: activePlayers().map(packPilot), raiders: enemies.map(packRaider).sort((a, b) => a.id - b.id)};
  }
  function applySnapshot(s){
    if (!s || s.v !== PROTOCOL) return false;
    round = s.round; wave = s.wave; score = s.score; lives = s.lives;
    for (const ps of s.pilots) { const p = players[ps.i]; if (p) applyPilot(p, ps); }
    applyRaiders(s.raiders);
    return true;
  }

  // ----- messages -----
  const MSG = {
    hello:   (name, build) => ({t: "hello", v: PROTOCOL, name: String(name).slice(0, 24), build}),   // client: I want to join, here is my plane
    welcome: slot => ({t: "welcome", v: PROTOCOL, slot}),                                           // host: you are pilot <slot>
    lobby:   list => ({t: "lobby", pilots: list}),                                                  // host: who is here, who is ready, next round
    build:   build => ({t: "build", build}),                                                        // client: my plane changed in the hangar
    start:   (roundKind, seed) => ({t: "start", round: roundKind, seed}),                           // host: round begins
    cmd:     (tick, c) => ({t: "cmd", tick, c: packCmd(c)}),                                        // client: my command for this tick
    snap:    s => ({t: "snap", s}),                                                                 // host: the world right now
    end:     result => ({t: "end", result})};                                                       // host: round over, back to the hangar

  // ----- transport -----
  // Anything with send(obj), close() and an onmessage(obj) callback will do: a WebSocket to a relay,
  // a WebRTC data channel, or the in-page pair below, which is what the self-test uses.
  function loopback(delayMs){
    const mk = () => ({onmessage: null, peer: null, open: true,
                       send(obj){ const text = JSON.stringify(obj), to = this.peer;   // real text, as on a real wire
                                  setTimeout(() => { if (to.open && to.onmessage) to.onmessage(JSON.parse(text)); }, delayMs || 0); },
                       close(){ this.open = false; }});
    const a = mk(), b = mk();
    a.peer = b; b.peer = a;
    return [a, b];
  }

  // ----- self-test: does the world survive being sent? Run Net.selfTest() from the browser console during a wave. -----
  function same(a, b){                                // equal, allowing numbers the last digit they were rounded to
    if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) <= 0.011;
    if (Array.isArray(a)) return Array.isArray(b) && a.length === b.length && a.every((v, i) => same(v, b[i]));
    if (a && typeof a === "object") return !!b && typeof b === "object" && Object.keys(a).length === Object.keys(b).length &&
                                           Object.keys(a).every(k => same(a[k], b[k]));
    return a === b;
  }
  function selfTest(){
    const before = JSON.stringify(snapshot());
    const wire = JSON.parse(before);                  // what the other machine would receive
    for (const p of activePlayers()) { p.pos.x += 500; p.hp = 1; p.q.set(0, 1, 0, 0); }      // wreck the local state...
    for (const e of enemies) { e.pos.y += 300; e.hp = 0.1; }
    const extra = enemies.length ? enemies[0] : null;
    if (extra) { scene.remove(extra.mesh); enemies.splice(0, 1); }                           // ...lose a raider...
    spawnEnemy(0, 900, 0, false);                                                            // ...and invent one that should not exist
    const wrecked = snapshot();
    applySnapshot(wire);                                                                     // then restore from the wire
    const after = snapshot();
    const cmd = {pitch: 0.337, roll: -1, yaw: 0, fire: 1, missile: 0, skill: 1, boost: 0, brake: 1, aim: [0.6, 0.0, -0.8]};
    const back = unpackCmd(JSON.parse(JSON.stringify(packCmd(cmd))));
    return {worldSurvives: same(wire, after), testCanFail: !same(wire, wrecked), bytes: before.length,
            commandSurvives: back.pitch === 0.34 && back.roll === -1 && back.fire === 1 && back.missile === 0 && back.skill === 1 &&
                             back.brake === 1 && back.aim[2] === -0.8,
            pilots: wire.pilots.length, raiders: wire.raiders.length};
  }

  return {PROTOCOL, MSG, packCmd, unpackCmd, packBuild, unpackBuild, packPilot, applyPilot, snapshot, applySnapshot, loopback, selfTest};
})();

# Online multiplayer: what is ready, what is left

The game does not play over a network yet. What exists is the groundwork inside the game, so that adding it is a matter of writing the networking and not of rewriting the game.

## What is ready

**Pilots are slots with teams.** Nothing in the game says "the other player". A pilot has a slot number (`p.i`), an `active` flag and a `team`. `allies(p)` and `rivals(p)` answer who is on whose side. A wave puts every pilot on team 0; a duel gives each pilot a team of their own. Spawning, respawning, scoring, the HUD and the weapons all go through these, so more than two pilots is a question of screen layout and slots, not of game rules.

**The simulation only reads commands.** Once a frame, `commandFor(p, pads)` turns keyboard, mouse and gamepad into one plain object per pilot:

```js
{pitch, roll, yaw, fire, missile, skill, boost, brake, aim}   // aim: null, or the direction the mouse points at
```

`simStep(dt, cmds)` advances the world from those objects and nothing else. A pilot with `p.remote = true` takes its command from `p.netCmd` instead of from local devices, which is how a pilot on another machine is flown.

**Time moves in fixed steps.** `simStep` always advances by `STEP` (1/120 s) and counts steps in `simTick`, whatever the frame rate of the screen. The same commands give the same flight, bit for bit; this is tested.

**State is plain data.** `js/net.js` (`Net`) packs and unpacks:

| | |
|---|---|
| `Net.packCmd` / `unpackCmd` | A command as a five-element array. Unpacking clamps every value: never trust the wire. |
| `Net.packBuild` / `unpackBuild` | A plane, in the same format the save file uses. Unpacking validates it and falls back to the starter plane. |
| `Net.snapshot` / `applySnapshot` | The world: round, wave, score, pilots, raiders (matched by `id`). About 1 kB as JSON for one pilot and five raiders. |
| `Net.MSG` | The message set: `hello`, `welcome`, `lobby`, `build`, `start`, `cmd`, `snap`, `end`. |
| `Net.loopback()` | Two connected in-page endpoints, for testing without a server. |
| `Net.selfTest()` | Run it from the browser console during a wave. It takes a snapshot, wrecks the local world, restores it from the snapshot and reports whether everything came back. |

## The plan

Host-authoritative, over a relay.

- One browser is the **host**. It runs the real simulation, exactly as the game runs today.
- Every other browser is a **client**. It sends its pilot's command each frame (`cmd`), and draws the snapshots the host sends back (`snap`, 15–20 a second), smoothing between them.
- A **relay** passes messages between them. On Cloudflare this is a Worker with a Durable Object per room, speaking WebSocket. Cloudflare Pages on its own cannot do this: it only serves files. The relay is small (accept sockets, forward messages, remember who is the host) and fits the free tier for a game between friends.

WebRTC data channels would give lower delay, with the Durable Object used only to introduce the browsers to each other. Start with the plain relay; it is far simpler.

## What is left to build

1. **The relay**: a Worker + Durable Object. Rooms with a short code to join.
2. **A lobby screen**: host a room, join a room, show who is in it.
3. **The client's view**: a client does not run `simStep`. It applies snapshots and interpolates planes and raiders between the last two. Its own plane should be predicted locally from its own commands and corrected towards the host's answer, or the controls will feel late.
4. **Shots and effects**: snapshots leave out bolts, missiles and explosions to stay small. The host should send short events ("pilot 2 fired", "raider 14 destroyed") and clients play them.
5. **The hangar**: each client builds its own plane and sends it (`build`); the host checks the cost against that pilot's points before accepting it.
6. **One screen per pilot**: today the screen is cut into one view per local pilot. A client needs one full-screen view of its own slot while other slots are remote.
7. **A seeded random generator** for raider spawning and behaviour, only if the game ever moves from snapshots to lockstep. With a host in charge it is not needed.

# Sky Squadron

Build a plane out of blocks, then fly it against a fleet of raiders. A browser game: plain HTML and JavaScript, no build step, no server.

- **Single player** by default, with keyboard + mouse or a gamepad.
- **Split screen** for two pilots on one machine: fight the raiders as a team, or switch any round to a duel.
- **The hangar**: every part you bolt on changes how the plane flies and fights. Hull, armor, wings, fins, thrusters, four kinds of gun, missiles, a targeting unit and four skill modules. You start with 100 points and earn 20 a wave.
- Progress is saved in the browser and offered as **Continue** on the title screen.

## Play

Open `index.html` in a browser (a double-click works), or serve the folder with any static web server.

### Flying

| | Keyboard + mouse | Gamepad |
|---|---|---|
| Steer | Click to capture the mouse, then point where you want to go. `W A S D` flies by hand instead | Left stick (pull back to climb) |
| Rudder | `Q` / `E` | Right stick, or LB / RB |
| Guns | Left mouse button, or `Space` | RT |
| Missiles | Right mouse button, or `F` | LT |
| Afterburner | `Shift` | A |
| Air brake | `C` | B |
| Skill | `R` | Y |
| Invert pitch | — | View / Back |
| Pause | `Esc` | Start |

In split screen, pilot 1 has the keyboard and mouse (or the first controller) and pilot 2 has the second controller. With one controller, it belongs to pilot 2. With none, pilot 2 flies on the arrow keys (`,` `.` rudder, `Enter` guns, `/` missiles, right `Shift` afterburner, right `Ctrl` brake, `M` skill).

### Hangar

| | Mouse | Gamepad | Keys |
|---|---|---|---|
| Choose a part | Click it in the list | LT / RT | `Z` / `C` |
| Place | Left click a face of the plane | A | `Space` |
| Remove | Right click a block | B | `X` |
| Paint | Middle click a block; click a colour to choose it | X | `F` |
| Mirror left/right | Click the mirror line | Y | `V` |
| Move the cursor | Point | Stick, LB / RB for up and down | `W A S D`, `Q` / `E` |
| Turn the view | Right-drag; wheel zooms | Right stick | — |
| Wave or duel next (split screen) | Click the "NEXT" line | View / Back | `T` |
| Take off | Click READY | Start | `R` |

## Files

```
index.html          the page: title screen and help text
js/world.js         renderer, sky, terrain, trees, clouds, particles, sound
js/game.js          parts and planes, flight model, raiders, weapons, hangar, input, HUD, main loop
js/net.js           groundwork for online play (not switched on) — see docs/MULTIPLAYER.md
vendor/three.min.js three.js r150
docs/MULTIPLAYER.md what is ready for online play and what is left to build
```

The scripts are ordinary `<script>` tags that share one global scope, so the game also runs straight from disk.

## Host it on Cloudflare Pages

It is a static site, so there is nothing to build.

1. Push this repository to GitHub.
2. In the Cloudflare dashboard: Workers & Pages → Create → Pages → Connect to Git, and pick the repository.
3. Framework preset: **None**. Build command: leave empty. Build output directory: `/`.
4. Deploy. Every push to `main` publishes a new version.

Things to know:

- Pages serves over HTTPS, which the browser requires for gamepads and for capturing the mouse.
- Saved progress belongs to the address the game is played at. A save made from a file on disk does not appear on the hosted site, and the other way round.
- Hosting the page does not make the game online-multiplayer. That needs a small relay as well; see `docs/MULTIPLAYER.md`.

## Credits

- [three.js](https://threejs.org) r150, MIT licence (`vendor/THREE-LICENSE.txt`).

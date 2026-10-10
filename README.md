# Hollow Crown

An open-world medieval souls-like that runs in the browser. Explore the realm on a horse, tiger,
dragon, black panther or giant serpent. Defeat five guardians in any order, then break the seal
to face the Hollow Crowned King.

## Running the game

The game is plain HTML, CSS and JavaScript with no build step. Serve the folder with any static
server (the browser needs a server for the best experience):

```bash
python3 -m http.server 8080
# then open http://localhost:8080
```

Three.js is vendored in `vendor/three.min.js`, so the game does not depend on a CDN at runtime.
Only the Google Fonts stylesheet is loaded remotely, and the game falls back to serif fonts without it.

## How to play

1. **New Pilgrim**: create a local account (name and password). Accounts and saves live in this browser's storage only.
2. **Difficulty**: Squire, Knight, Champion or Nightmare. Difficulty scales enemy damage, enemy health, boss health, souls earned and flasks.
3. **Tutorial**: a short checklist covers movement, combat, blocking, rolling, flasks, choosing a companion, mounting, summoning an ally and resting.
4. **The open world**: find bonfires, which let you rest, level up, change companion and fast travel. Foes return when you rest.
5. **Guardians**: five bosses, each in its own arena. Defeating all five breaks the seal on the throne.
6. **The Hollow Crowned King**: the final fight. Defeat him to win, then keep exploring.

Dying drops your souls where you fell. Walk back over the pile to recover them.

### Controls

| Action | Keyboard & mouse | Gamepad |
| --- | --- | --- |
| Move | W A S D | Left stick |
| Look | Mouse (click the game to capture) | Right stick |
| Light attack | Left click | X |
| Heavy attack | Q | Y |
| Block (hold) | Right click or C | LB |
| Roll / jump / rise (flying) | Space | A |
| Descend (flying) | Ctrl | LT |
| Sprint | Shift | L3 |
| Lock on | Tab or middle click | R3 |
| Flask | F | D-pad down |
| Interact / rest | E | B |
| Mount / dismount | R | View |
| Mount ability | V | RB |
| Summon ally | T | D-pad up |
| Pause | Esc or P | Start |

Menus work with the mouse, the arrow keys or the D-pad, with Enter or A to confirm and Esc or B to go back.

### Companions

| Companion | Travel | Ability |
| --- | --- | --- |
| Warhorse | Steady and strong | Charge: breaks lines of foes |
| Royal Tiger | Fast, leaps | Pounce: shakes the ground on landing |
| Emberwing (dragon) | Flies (Space rises, Ctrl descends) | Fire Breath |
| Black Panther | Quick, slips past enemies | Shadow Dash: dashes and breaks enemy aggro |
| Giant Serpent | Slow but very tough | Coil Slam: stuns nearby foes |

Your mount takes most of the damage while you ride it, and it follows you on foot. Once it is
wounded, rest at a bonfire to revive it. Summoning an ally (T) brings a smaller copy of your
companion that fights for you for a short time, then cools down.

## Project layout

```
index.html          Page shell: HUD, title, sign-up, difficulty, controls and overlays
styles.css          Theme, layout and responsive rules
vendor/three.min.js Three.js r149 (vendored)
src/
  config.js         Tuning data: player stats, difficulties, mounts, sites, camps, enemy types
  util.js           Math and RNG helpers
  input.js          Keyboard, mouse and gamepad mapped to named actions
  world.js          Terrain, lake, props, arenas, bonfires and the sealed throne
  rig.js            Procedural models and animation poses (humanoids, quadrupeds, dragon, serpent)
  combat.js         Hit queries, timed hazards, projectiles and visual effects
  fighter.js        Shared base class for anything that can be hit
  companions.js     Riding mounts and summoned allies
  player.js         Player movement, combat, mounts, abilities and damage
  enemies.js        Common enemies: soldiers, wolves, archers and crownguards
  bosses.js         The five guardians and the King, built from timed attack lists
  ui.js             HUD, menus, banners, boss bar and tutorial checklist
  game.js           Game loop, state, accounts and saves, bonfires, arenas, tutorial and camera
```

## Notes

- Bosses use attack lists with windups, so every attack can be read and dodged. Phases change
  the available attacks and their speed.
- The world is generated from a fixed seed, so the map is the same every time.
- Saves are stored in `localStorage` and are not encrypted. Treat them as local progress only.
- Touch controls are not implemented. The game targets keyboard, mouse and gamepad.

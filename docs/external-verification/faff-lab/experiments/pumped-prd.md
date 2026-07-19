# PRD — Pumped: BMX Trails Simulator

- **Container:** Pumped: BMX Trails Simulator
- **Status:** Draft
- **Date:** 2026-07-14
- **Mode:** authored

## Problem / objective

Deliver a browser-based, physics-driven BMX dirt-jump side-scroller in which momentum — not scripted jump arcs — drives play: the rider builds and carries speed across a procedurally generated dirt track, hops porcupines, clears water traps, grabs occasional power-ups, and throws tricks purely for a crowd-audio payoff.

## Goals & success metrics

- Momentum reads as physical and persistent, shaped by landing quality rather than reset per jump, with gravity playing its natural role in jump mechanics and momentum build up.
- Porcupine hops and water-trap clears feel skill-based rather than scripted.
- The track is completable both on a clean run and a run with several falls/restarts.

## Non-goals

- Multiple tracks or a track-select screen.
- Multiplayer or ghost replays.
- Mobile touch controls.
- Save/persist progress.
- A trick-scoring or combo system — tricks carry no score.

## Users

Players looking for a short, physics-driven arcade dirt-jump session in the browser.

## Requirements

- Rigid-body bike+rider physics (frame, wheels, rider mass, joints) via Matter.js — Arcade Physics is not sufficient for the intended feel.
- Physics advances on a fixed timestep decoupled from render frame rate, so play is consistent across display refresh rates.
- Controls: on the ground, `<` brakes/slows and `>` pedals/speeds up; in the air, `<` leans backward and `>` leans forward; Space hops on the ground and performs a trick in the air.
- A procedurally generated track containing flat sections, jumps, porcupines (ground hazard), water traps (gap hazard), and occasional power-ups over a subset of jumps.
- Track generation is seed-reproducible: the same seed always yields the same track. Whether a play session uses a fixed or random seed is left to implementation.
- A headless verification harness: given a seed, it generates that track and demonstrates — by stepping the same physics, no renderer — that every gap and water trap is clearable at the momentum achievable from the preceding section, reporting per-gap results.
- The track contains checkpoints; a fall returns the rider to the most recent checkpoint passed.
- A power-up grants a temporary gameplay effect on pickup — the specific effect is left to implementation, but it must affect play, not only visuals or audio.
- A HUD showing distance and remaining attempts, with wipeout and track-clear end states.
- Audio distinguishing pedal, brake, hop, clean landing, fall (with a distinct cue per hazard type), trick (crowd cheer), power-up pickup, and background music/crowd ambience.
- All graphics and audio must be open source. Phaser 3 framework and assets can be used.
- Deployment as a static site on Netlify with preview branch, built with Vite.

## Acceptance criteria

- The bike and rider MUST be simulated as a jointed rigid body using Matter.js.
- The physics simulation MUST advance on a fixed timestep independent of display refresh rate.
- Given a clean landing, When the rider touches down within the landing-angle tolerance, Then momentum MUST be retained or increased.
- Given a rough landing, When the rider touches down outside the landing-angle tolerance, Then momentum MUST decrease.
- Given a landing steep enough to exceed the fall threshold, When the rider touches down, Then the rider MUST fall.
- Given the rider is on the ground, When the player presses `<`, Then the bike MUST brake/slow down.
- Given the rider is on the ground, When the player presses `>`, Then the bike MUST pedal/speed up.
- Given the rider is airborne, When the player presses `<`, Then the rider MUST lean backward.
- Given the rider is airborne, When the player presses `>`, Then the rider MUST lean forward.
- Given the rider is on the ground, When the player presses Space, Then the rider MUST hop.
- Given the rider is airborne, When the player presses Space, Then the rider MUST perform a trick.
- Given a trick is performed and lands, When it completes, Then the crowd audio MUST swell and momentum MUST NOT be affected.
- Given a trick is still in progress, When the rider touches down, Then the rider MUST fall.
- Given the rider touches a porcupine, When contact occurs, Then the rider MUST fall.
- Given the rider lands in a water trap, When contact occurs, Then the rider MUST fall.
- Given a fall occurs, When it resolves, Then the rider's attempts MUST decrease by one and the rider MUST restart from the last checkpoint.
- Given attempts reach zero, When the last attempt is used, Then a wipeout screen MUST be shown with a restart control.
- Given the rider crosses the finish line, When the crossing occurs, Then a track-clear screen MUST be shown with the final distance.
- The generated track MUST guarantee every gap and water trap is clearable at the momentum achievable from the preceding section.
- Given the same seed, When the track is generated twice, Then the resulting tracks MUST be identical.
- Given a seed, When the headless harness runs, Then it MUST demonstrate every gap and water trap on that track is clearable at the momentum achievable from the preceding section, reporting per-gap results.
- Power-ups MUST NOT be placed over a porcupine or a water trap.
- Given a power-up is picked up, When its effect applies, Then it MUST alter gameplay for its duration, not only visuals or audio.
- The game MUST be deployed as a static site built with Vite and hosted on Netlify.

## Evaluator note

The Acceptance criteria above are objective — each is a concrete mechanism, state transition, or config choice (Matter.js used, a fall triggers on specific contact, momentum increases/decreases on landing, a screen appears at a specific condition, the deploy target). An evaluator can check almost all of them without playing the build. The one exception is the track-clearability guarantee: inspection alone only confirms the code claims it. The headless harness exists to close that gap — the evaluator verifies the guarantee by running the harness across a sample of seeds, with one residual inspection duty: confirming the harness steps the real physics rather than asserting the result. Seed-reproducibility is what makes those replays meaningful.

The Goals & success metrics section is different: "momentum reads as physical," "feel skill-based rather than scripted," and the general BMX-dirt-jump *feel* are subjective. A model can satisfy every Acceptance criterion literally (a momentum value exists and moves in the right direction, a fall event fires on contact) while the result still feels bad to actually ride. These goals can't be verified by an automated evaluator without someone or something actually playing the build — treat them as directional context for a human reviewer, not as pass/fail gates.

## Open questions

- Exact density/difficulty scaling curve for porcupines, water traps, and power-ups toward the end of the track is left to implementation.
- Checkpoint spacing and placement are left to implementation.
- The initial attempt count is left to implementation.

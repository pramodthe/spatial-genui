---
name: tabletop-physics
description: Ball, bounce, paddle and collision patterns, plus a short simulated-hand run.
---

# Tabletop physics

Keep collisions as distances or boxes in `root`'s space. A ball bounce:

```js
ball.position.addScaledVector(velocity, step);
if (ball.position.x < left || ball.position.x > right) velocity.x *= -1;
if (ball.position.z < far || ball.position.z > near) velocity.z *= -1;
```

A paddle reflects the ball when the ball is within the paddle's half-extents and is moving toward it. Separate the ball so it does not stick: place it just outside the paddle along the normal, then flip that component of the velocity. Scale speeds by `Math.min(delta, 0.05)`.

Run a few seconds with a simulated hand (the same dry run the gate uses: ten frames, a right hand) and read what moved:

```
node /skills/game/tabletop-physics/scripts/play.mjs /work/module.js
```

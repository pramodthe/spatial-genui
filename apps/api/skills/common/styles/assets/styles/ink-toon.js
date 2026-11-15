// Ink and toon look for an XR lesson: flat colour in two tones, an ink line round every shape, halftone dots where light
// turns to shadow, a hard glint on glossy things, on warm paper. Needs look-kit.js (lookShade, lookOutline, lookTwos).
function inkToonLook(THREE, kit) {
  const INK = '#1c1622';
  const PAL = {
    paper: { lit: '#f7ecd6', shade: '#e6d6b8' },
    teal: { lit: '#2a9d94', shade: '#1c7376', deep: '#12565c' },
    cream: { lit: '#f7e8cc', shade: '#b3c9bd' },
    persimmon: { lit: '#ee5a36', shade: '#ae2f33', gloss: '#ffd2bd' },
    mustard: { lit: '#f6b63c', shade: '#c9722c', gloss: '#fff1c4' },
    navy: { lit: '#3b4568', shade: '#222641', gloss: '#b4c0e6' },
    bean: { lit: '#6a3d27', shade: '#3c221b' },
    water: { lit: '#effbf6', shade: '#9fd8cf' },
  };
  const mats = {};
  const look = {
    name: 'ink-toon',
    PAL,
    INK,
    // One material per colour and mode, made once. halftone adds dots on big curved surfaces.
    mat(colour, halftone = false) {
      const key = `${colour}:${halftone}`;
      if (!mats[key]) {
        const c = PAL[colour];
        mats[key] = lookShade(THREE, { mode: halftone ? 'halftone' : 'cel', lit: c.lit, shade: c.shade, deep: halftone ? c.deep || c.shade : undefined, gloss: c.gloss });
      }
      return mats[key];
    },
    // An inked object: flat colour and an ink outline. outline: false for tiny parts (it costs a draw call).
    ink(geometry, colour, name, { halftone = false, outline = true } = {}) {
      const mesh = new THREE.Mesh(geometry, look.mat(colour, halftone));
      mesh.name = name;
      if (outline) lookOutline(THREE, mesh, { width: 0.002, color: INK });
      return mesh;
    },
    // The paper sheet the scene is printed on, with an ink rule round it. Its top is set.userData.top.
    set({ width = 0.42, depth = 0.3 } = {}) {
      const sheet = look.ink(kit.roundedBox(width, 0.006, depth, 0.002), 'paper', 'Paper sheet');
      sheet.position.y = 0.003;
      sheet.userData.top = 0.006;
      return sheet;
    },
    demo(subject) {
      const mug = look.ink(kit.lathe([[0, 0], [0.035, 0], [0.038, 0.08], [0.033, 0.08], [0.03, 0.006], [0, 0.006]], 48), 'persimmon', 'Mug', { halftone: true });
      mug.position.set(-0.05, 0, 0);
      const ball = look.ink(new THREE.SphereGeometry(0.03, 32, 20), 'teal', 'Ball', { halftone: true });
      ball.position.set(0.07, 0.03, 0.03);
      subject.add(mug, ball);
      return [{ object: ball, grab: true }, { object: mug, press: true }];
    },
  };
  return look;
}

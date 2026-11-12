// Fixture for tests/rig-demo.mjs: a heart lesson that cycles through every teaching-rig state
// on a timer, so screenshots at fixed times show each one.
export default function build({ THREE, traits, ui, assets }) {
  const root = new THREE.Group();
  const heart = assets.get('heart-bp3d');
  heart.object3D.scale.setScalar(1.4);
  root.add(heart.object3D);
  heart.labelParts(['superior_vena_cava', 'arch_of_aorta', 'pulmonary_trunk', 'right_atrium', 'left_atrium',
    'right_ventricle', 'left_ventricle', 'mitral_valve', 'tricuspid_valve', 'aortic_valve']);
  traits(heart.part('aortic_valve'), { grab: true });
  const status = ui(`
    <style>.c { width: 420px; padding: 16px; border-radius: 14px; background-color: #1f2228; }
    .t { color: #ffffff; font-size: 26px; font-weight: 700; }</style>
    <div class="c"><span class="t" id="state">Assembled</span></div>`, { width: 0.22, position: [0, 0.33, 0] });
  root.add(status.object3D);
  let phase = -1;
  return {
    root,
    update(time) {
      const next = Math.min(4, Math.floor(time / 3));
      if (next === 1) heart.explode(Math.min(1, (time - 3) / 1.5) * 0.7);
      if (next === phase) return;
      phase = next;
      if (phase === 0) status.set('state', { text: 'Assembled, labelled' });
      if (phase === 1) status.set('state', { text: 'Explode' });
      if (phase === 2) { heart.explode(0); heart.cutaway(true); status.set('state', { text: 'Cut open' }); }
      if (phase === 3) { heart.cutaway(false); heart.xray(true, ['mitral_valve', 'tricuspid_valve', 'aortic_valve', 'pulmonary_valve']); heart.highlight('mitral_valve'); status.set('state', { text: 'X-ray: valves' }); }
      if (phase === 4) { heart.reset(); status.set('state', { text: 'Reset' }); }
    },
  };
}

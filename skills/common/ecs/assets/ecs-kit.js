// ECS kit: the game as a world of entities, components and systems (EliCS, the ECS Meta's IWSDK is built on;
// skills/common/ecs). An entity is one thing in the game; a component is what the thing is, with its data; a
// system is one thing that happens, run every frame over the entities its query finds. The world runs from the
// game's update(); build() only creates the things.
//
//   const game = playWorld(api)                  api: build()'s argument (it carries ecs, traits, isGrabbed)
//   const Boat = game.component('Boat', { speed: 'number', cargo: 'int', sail: 'object' })
//   game.system('Sail', { boats: [Boat, game.Held] }, (q, delta, time) => {
//     for (const boat of q.boats) boat.setValue(Boat, 'speed', boat.getValue(Boat, 'speed') + delta);
//   })
//   const raft = game.spawn(mesh, Boat, { speed: 0 }, game.Grabbable)   an entity for a 3D object
//   game.objectOf(raft)                            its THREE object
//   raft.getValue(Boat, 'speed'), raft.setValue(Boat, 'speed', 2), raft.hasComponent(game.Held)
//   raft.addComponent(Sinking), raft.removeComponent(Sinking), game.remove(raft)   (hides its object)
//   game.find(Boat, Sinking)                       the entities that have every listed component, now
//   game.update(time, delta)                       call it from update(); runs the systems in their order
//
// Field types: 'number', 'int', 'bool', 'text', 'vec3', 'color', 'object' (any value: a THREE object, a list),
// 'entity', or an EliCS field { type: game.Types.Float32, default: 1 }. A 'vec3' field is read and changed in place
// with entity.getVectorView(C, 'field'). Built in: Thing (every spawned entity; its object), Grabbable (the hands
// may pick it up; it has Held while one does), Pressable (a hand press; it has Pressed for that one frame), Held,
// Pressed. Grabbable and Pressable work on things spawned in build(); spawn later only what the hands do not touch.

function playWorld(api) {
  const ecs = api.ecs;
  if (!ecs) throw new Error('playWorld(api): this host has no ECS (api.ecs).');
  const world = new ecs.World();
  // Component names are global in EliCS; each game (and each reopening of it) gets its own.
  const prefix = `g${Math.random().toString(36).slice(2, 8)}`;
  const T = ecs.Types;
  const SHORT = {
    number: { type: T.Float32, default: 0 },
    int: { type: T.Int32, default: 0 },
    bool: { type: T.Boolean, default: false },
    text: { type: T.String, default: '' },
    vec3: { type: T.Vec3, default: [0, 0, 0] },
    color: { type: T.Color, default: [1, 1, 1, 1] },
    object: { type: T.Object, default: null },
    entity: { type: T.Entity, default: null },
  };
  const all = new Set();
  const pressedNow = new Set();

  function component(name, fields = {}) {
    const schema = {};
    for (const [key, field] of Object.entries(fields)) {
      if (typeof field === 'string') {
        if (!SHORT[field]) throw new Error(`game.component('${name}'): field '${key}' has type '${field}'. Types: ${Object.keys(SHORT).join(', ')}.`);
        schema[key] = { ...SHORT[field] };
      } else schema[key] = field;
    }
    const made = ecs.createComponent(`${prefix}:${name}`, schema, name);
    world.registerComponent(made);
    made.label = name;
    return made;
  }

  const Thing = component('Thing', { object: 'object' });
  const Grabbable = component('Grabbable');
  const Held = component('Held');
  const Pressable = component('Pressable');
  const Pressed = component('Pressed');

  function system(name, queries, run) {
    const config = {};
    for (const [key, query] of Object.entries(queries)) config[key] = Array.isArray(query) ? { required: query } : query;
    const Made = class extends ecs.createSystem(config) {
      update(delta, time) {
        const found = {};
        // A copy of each list: a system may add or remove components while it walks it.
        for (const key of Object.keys(config)) found[key] = [...this.queries[key].entities];
        run(found, delta, time);
      }
    };
    Object.defineProperty(Made, 'name', { value: name });
    world.registerSystem(Made);
    return Made;
  }

  // The hands, first every frame, so the game's systems see Held and Pressed as they are now.
  system('Hands', { grabbable: [Grabbable], pressed: [Pressed] }, (q) => {
    for (const e of q.pressed) e.removeComponent(Pressed);
    for (const e of pressedNow) if (e.active !== false && !e.hasComponent(Pressed)) e.addComponent(Pressed);
    pressedNow.clear();
    for (const e of q.grabbable) {
      const held = Boolean(api.isGrabbed?.(e.getValue(Thing, 'object')));
      if (held && !e.hasComponent(Held)) e.addComponent(Held);
      else if (!held && e.hasComponent(Held)) e.removeComponent(Held);
    }
  });

  function spawn(object, ...items) {
    const e = world.createEntity();
    e.addComponent(Thing, { object });
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const next = items[i + 1];
      const values = next && typeof next === 'object' && !next.schema && !Array.isArray(next) ? next : undefined;
      if (values) i++;
      if (!item || !item.schema) throw new Error(`game.spawn(): ${String(item?.label ?? item)} is not a component (make it with game.component).`);
      e.addComponent(item, values);
    }
    if (object && e.hasComponent(Grabbable)) api.traits(object, { grab: true });
    if (object && e.hasComponent(Pressable)) api.traits(object, { onPress: () => pressedNow.add(e) });
    all.add(e);
    return e;
  }

  return {
    world,
    Types: T,
    Thing, Grabbable, Held, Pressable, Pressed,
    component,
    system,
    spawn,
    objectOf: (e) => e.getValue(Thing, 'object'),
    find(...components) {
      return [...all].filter((e) => e.active !== false && components.every((c) => e.hasComponent(c)));
    },
    remove(e) {
      const object = e.getValue(Thing, 'object');
      if (object) object.visible = false;
      all.delete(e);
      e.destroy();
    },
    update(time, delta) {
      world.update(delta, time);
    },
  };
}

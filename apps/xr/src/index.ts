/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { World } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';
import { initGenUIHost } from './genui/host.js';
import { createOverlay, generate, onLessonStatus, repair, reportRuntimeError } from './genui/overlay.js';
import { initLessonPicker } from './genui/picker.js';
import { PanelSystem } from './panel.js';
import { RobotSystem } from './robot.js';

World.create(
  document.getElementById('scene-container') as HTMLDivElement,
  projectOptions,
).then((world) => {
  world.registerSystem(RobotSystem);
  world.registerSystem(PanelSystem);
  initGenUIHost(world, { onRuntimeError: reportRuntimeError });
  // In XR the prompt box is not visible; the picker is how a lesson starts there (hands only).
  initLessonPicker(world, { start: (prompt) => void generate(prompt), fix: () => void repair(), onStatus: onLessonStatus });
  createOverlay();
});

/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { World } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';
import { initMoveHandles } from './genui/handle.js';
import { initGenUIHost } from './genui/host.js';
import { createStartPage } from './genui/start-page.js';
import { closeGame, createOverlay, onLessonStatus, repair, reportRuntimeError, startLesson, openWritten, watchLive } from './genui/overlay.js';
import { initLessonPicker } from './genui/picker.js';

World.create(
  document.getElementById('scene-container') as HTMLDivElement,
  projectOptions,
).then((world) => {
  initMoveHandles(world);
  initGenUIHost(world, { onRuntimeError: reportRuntimeError });
  // In XR the start page is not visible; the dashboard is the home screen there (hands only).
  initLessonPicker(world, {
    start: (prompt) => void startLesson(prompt),
    fix: () => void repair(),
    open: (code, prompt, kind) => void openWritten(code, prompt, kind),
    watch: (key, prompt, kind, outcome) => void watchLive(key, prompt, kind, outcome),
    close: closeGame,
    onStatus: onLessonStatus,
  });
  createStartPage(world, createOverlay());
});

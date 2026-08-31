import assert from 'node:assert/strict';
import test from 'node:test';
import { Editor } from '@tiptap/core';
import { Markdown } from '@tiptap/markdown';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import StarterKit from '@tiptap/starter-kit';
import {
  autoScrollDelta,
  blockAtPointerY,
  blockAtSelectionStartY,
  blockSelectionRange,
  canStartBlockSelection,
  frameAdjustedScrollDelta,
} from '../frontend/src/features/tasks/block-selection';
import {
  blockSelectionPluginKey,
  createBlockSelectionPlugin,
} from '../frontend/src/features/tasks/block-selection-decoration';

const blocks = [
  { from: 0, to: 7, top: 100, bottom: 126 },
  { from: 7, to: 15, top: 134, bottom: 160 },
  { from: 15, to: 24, top: 168, bottom: 194 },
];

test('block selection starts only from the primary-button page gutter', () => {
  assert.equal(canStartBlockSelection({ button: 0, inGutter: true, inEditableContent: false }), true);
  assert.equal(canStartBlockSelection({ button: 0, inGutter: false, inEditableContent: true }), false);
  assert.equal(canStartBlockSelection({ button: 2, inGutter: true, inEditableContent: false }), false);
});

test('pointer movement selects the same continuous range in either direction', () => {
  assert.deepEqual(blockSelectionRange(blocks[0], blocks[2]), { anchor: 0, from: 0, to: 24 });
  assert.deepEqual(blockSelectionRange(blocks[2], blocks[0]), { anchor: 15, from: 0, to: 24 });
});

test('vertical hit testing keeps selection continuous through block gaps and page edges', () => {
  assert.deepEqual(blockAtPointerY(blocks, 130), blocks[1]);
  assert.deepEqual(blockAtPointerY(blocks, 40), blocks[0]);
  assert.deepEqual(blockAtPointerY(blocks, 260), blocks[2]);
  assert.equal(blockAtPointerY([], 130), null);
});

test('selection may start beside a block or between blocks, but not in distant empty page space', () => {
  assert.deepEqual(blockAtSelectionStartY(blocks, 112), blocks[0]);
  assert.deepEqual(blockAtSelectionStartY(blocks, 130), blocks[1]);
  assert.equal(blockAtSelectionStartY(blocks, 240), null);
});

test('auto scroll activates only near the viewport edge and preserves direction', () => {
  assert.equal(autoScrollDelta(180, { top: 100, bottom: 500 }), 0);
  assert.ok(autoScrollDelta(105, { top: 100, bottom: 500 }) < 0);
  assert.ok(autoScrollDelta(495, { top: 100, bottom: 500 }) > 0);
  assert.equal(autoScrollDelta(100, { top: 100, bottom: 500 }), -18);
  assert.equal(autoScrollDelta(500, { top: 100, bottom: 500 }), 18);
});

test('auto scroll distance is stable across 60 Hz and 120 Hz frames', () => {
  const at60Hz = frameAdjustedScrollDelta(18, 1000 / 60);
  const twoFramesAt120Hz = frameAdjustedScrollDelta(18, 1000 / 120) * 2;
  assert.ok(Math.abs(at60Hz - twoFramesAt120Hz) < 0.001);
});

test('selected block decorations survive editor selection transactions', () => {
  const editor = new Editor({ extensions: [StarterKit, Markdown], content: 'Alpha\n\nBeta\n\nGamma', contentType: 'markdown' });
  try {
    const first = { from: 0, to: editor.state.doc.child(0).nodeSize };
    const second = { from: first.to, to: first.to + editor.state.doc.child(1).nodeSize };
    let state = EditorState.create({ schema: editor.schema, doc: editor.state.doc, plugins: [createBlockSelectionPlugin()] });
    state = state.apply(state.tr.setMeta(blockSelectionPluginKey, { anchor: first.from, from: first.from, to: second.to }));
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 2)));
    assert.equal(blockSelectionPluginKey.getState(state)?.find().length, 2);
  } finally {
    editor.destroy();
  }
});

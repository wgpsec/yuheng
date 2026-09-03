import assert from 'node:assert/strict';
import test from 'node:test';
import {
  acceptsRunEventScope,
  isCurrentConversationRequest,
} from '../frontend/src/features/conversation/use-conversation-workspace';

test('conversation controller rejects a stale conversation load', () => {
  assert.equal(isCurrentConversationRequest('conversation-a', 1, 'conversation-b', 2), false);
  assert.equal(isCurrentConversationRequest('conversation-b', 2, 'conversation-b', 2), true);
});

test('conversation controller rejects events from a superseded run', () => {
  assert.equal(acceptsRunEventScope('run-new', 'run-old'), false);
  assert.equal(acceptsRunEventScope('run-new', 'run-new'), true);
});

test('conversation controller rejects events from the most recent terminal run', () => {
  assert.equal(acceptsRunEventScope(undefined, 'run-old', 'run-old'), false);
  assert.equal(acceptsRunEventScope(undefined, 'run-new', 'run-old'), false);
});

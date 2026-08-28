import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { conversationMenuKey, deriveConversationNavigation, paginateProjectConversations, type Conversation } from '../frontend/src/features/conversation/workspace/sidebar';

describe('Conversation sidebar navigation', () => {
  it('shows pinned conversations only in the pinned section', () => {
    const pinned: Conversation = { id: 'pinned', projectId: 'project-a', title: '置顶会话', pinned: true };
    const regular: Conversation = { id: 'regular', projectId: 'project-a', title: '普通会话', pinned: false };

    const navigation = deriveConversationNavigation([pinned, regular]);

    assert.deepEqual(navigation.sections, ['pinned', 'projects', 'recent']);
    assert.deepEqual(navigation.pinned.map(({ id }) => id), ['pinned']);
    assert.deepEqual(navigation.recent.map(({ id }) => id), ['regular']);
    assert.deepEqual(navigation.projectConversations.filter(({ projectId }) => projectId === 'project-a').map(({ id }) => id), ['regular']);
  });

  it('hides the pinned section when no conversation is pinned', () => {
    const navigation = deriveConversationNavigation([
      { id: 'regular', projectId: 'project-a', title: '普通会话', pinned: false },
    ]);

    assert.deepEqual(navigation.sections, ['projects', 'recent']);
  });

  it('shows five project conversations initially and ten more per expansion', () => {
    const conversations = Array.from({ length: 18 }, (_, index): Conversation => ({
      id: `conversation-${index + 1}`,
      projectId: 'project-a',
      title: `会话 ${index + 1}`,
    }));

    const initial = paginateProjectConversations(conversations);
    assert.equal(initial.visible.length, 5);
    assert.equal(initial.nextVisibleCount, 15);
    assert.equal(initial.hasMore, true);

    const expanded = paginateProjectConversations(conversations, initial.nextVisibleCount);
    assert.equal(expanded.visible.length, 15);
    assert.equal(expanded.nextVisibleCount, 18);
    assert.equal(expanded.hasMore, true);

    const complete = paginateProjectConversations(conversations, expanded.nextVisibleCount);
    assert.equal(complete.visible.length, 18);
    assert.equal(complete.hasMore, false);
  });

  it('identifies menu instances by both conversation and placement', () => {
    assert.notEqual(
      conversationMenuKey('conversation-1', 'project:project-a'),
      conversationMenuKey('conversation-1', 'section:recent'),
    );
  });
});

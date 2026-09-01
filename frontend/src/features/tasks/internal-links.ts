import Link from '@tiptap/extension-link';
import { init, registerCustomProtocol } from 'linkifyjs';

export const YUHENG_LINK_PROTOCOLS = ['yuheng-task-asset', 'yuheng-note', 'yuheng-task'] as const;

YUHENG_LINK_PROTOCOLS.forEach((protocol) => registerCustomProtocol(protocol));
init();

export const YuhengLink = Link.extend({
  onCreate() {},
  onDestroy() {},
}).configure({
  openOnClick: false,
  protocols: [...YUHENG_LINK_PROTOCOLS],
});

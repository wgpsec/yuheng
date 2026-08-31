import { net, type Protocol } from 'electron';
import { pathToFileURL } from 'node:url';

export type ManagedProtocol = {
  scheme: string;
  resolve(url: string): string;
};

export function registerManagedProtocols(
  protocol: Pick<Protocol, 'handle' | 'unhandle'>,
  protocols: readonly ManagedProtocol[],
): () => void {
  const registered: string[] = [];
  try {
    for (const managed of protocols) {
      void protocol.handle(managed.scheme, (request) => {
        try {
          return net.fetch(pathToFileURL(managed.resolve(request.url)).toString());
        } catch {
          return new Response('Not found', { status: 404 });
        }
      });
      registered.push(managed.scheme);
    }
  } catch (error) {
    for (const scheme of registered.reverse()) protocol.unhandle(scheme);
    throw error;
  }
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    for (const scheme of registered.reverse()) protocol.unhandle(scheme);
  };
}

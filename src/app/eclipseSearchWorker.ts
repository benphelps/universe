import { findNearbyEclipses } from './eclipseFinder';
import type { EclipseSearchReply, EclipseSearchRequest } from './eclipseSearch';

self.onmessage = async (event: MessageEvent<EclipseSearchRequest>) => {
  const { current, neighbors, startDays, filter } = event.data;
  const send = (reply: EclipseSearchReply) => self.postMessage(reply);
  try {
    const results = await findNearbyEclipses(
      current,
      neighbors,
      startDays,
      (progress) => send({ progress }),
      undefined,
      filter,
      (results) => send({ results, done: false }),
    );
    send({ results, done: true });
  } catch (error) {
    send({ error: error instanceof Error ? error.message : String(error) });
  }
};

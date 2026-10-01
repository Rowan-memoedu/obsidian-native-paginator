/** Yield to the event loop without background-window timer throttling. */
export function scheduleCooperativeTask(callback: () => void): () => void {
  const channel = new MessageChannel();
  let cancelled = false;
  const cancel = (): void => {
    cancelled = true;
    channel.port1.onmessage = null;
    channel.port1.close();
    channel.port2.close();
  };
  channel.port1.onmessage = () => {
    if (cancelled) return;
    cancel();
    callback();
  };
  channel.port2.postMessage(null);
  return cancel;
}

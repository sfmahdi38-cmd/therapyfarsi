/**
 * Daily reports each link (signaling, sfu, peer-to-peer) separately. The call is only
 * back when every link that dropped has reconnected, not when the first one does.
 */
export class ConnectionTracker {
  private readonly down = new Set<string>();

  update(type: string, event: string): 'reconnecting' | 'reconnected' | null {
    if (event === 'interrupted') {
      if (this.down.has(type)) return null;
      this.down.add(type);
      return this.down.size === 1 ? 'reconnecting' : null;
    }
    if (event === 'connected') return this.clear(type);
    return null;
  }

  /** Forget a link without it reconnecting, e.g. peer-to-peer after the peer left. */
  clear(type: string): 'reconnected' | null {
    if (!this.down.delete(type)) return null;
    return this.down.size === 0 ? 'reconnected' : null;
  }
}

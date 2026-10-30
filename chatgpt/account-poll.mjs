export const ACCOUNT_REFRESH_MS = 10 * 60 * 1000;

// Runs in the local service, independently of whether the console is open.
export function createAccountPoll({accounts, canRun, interval = ACCOUNT_REFRESH_MS}) {
  let timer, flight, cancelled = false, stopped = true, blocked;
  const schedule = delay => {
    if (stopped || blocked) return;
    timer = setTimeout(() => { void run(); }, delay);
    timer.unref?.();
  };
  async function run() {
    if (stopped || flight || blocked) return;
    if (!canRun() || !accounts.idle()) { schedule(1000); return; }
    cancelled = false;
    flight = (async () => {
      const snapshot = await accounts.list();
      if (snapshot.storeError) return;
      for (const account of snapshot.accounts) {
        if (cancelled || stopped || !canRun() || !accounts.idle()) break;
        try { await accounts.refresh(account.id); }
        catch (error) {
          // An unconfirmed process exit must continue blocking login writes
          // and updates; ordinary per-account failures do not stop the batch.
          if (error.code === 'shutdown_unconfirmed') { blocked = error; break; }
          if (['network_disabled', 'accounts_busy', 'credential_store_unsupported'].includes(error.code)) break;
        }
      }
    })();
    try { await flight; } catch { /* Retry enumeration on the next round. */ }
    finally { flight = null; schedule(interval); }
  }
  async function cancel() {
    cancelled = true;
    if (flight) { await accounts.cancel(); await flight; }
    if (blocked) throw blocked;
  }
  return {
    start() { if (!stopped || interval <= 0) return; stopped = false; schedule(interval); },
    cancel,
    async close() { stopped = true; clearTimeout(timer); await cancel(); },
    idle: () => !flight && !blocked,
  };
}

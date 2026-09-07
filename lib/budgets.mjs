// Providers run concurrently after the browser upload has completed.
export const budgets = Object.freeze({
  uploadMs: 30000,
  providerMs: 50000,
  workerMs: 60000,
  requestReceiveMs: 35000,
  clientMs: 105000, // 35s receiving + 60s worker ceiling + 10s response margin
});

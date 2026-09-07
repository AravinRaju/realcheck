// Upload is an absolute cap, not an idle timeout: slower uploads still fail.
const uploadMs = 30000;
const requestReceiveMs = uploadMs + 5000; // Allow request/header handling overhead.
const workerMs = 60000;
// Providers run concurrently AFTER receipt; the client must allow both phases.
export const budgets = Object.freeze({
  uploadMs,
  providerMs: 50000,
  workerMs,
  requestReceiveMs,
  clientMs: requestReceiveMs + workerMs + 10000, // Response and cleanup margin.
});

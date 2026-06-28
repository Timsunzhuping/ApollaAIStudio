// Pure CRDT surface — safe to import in the browser (no node-only deps). The web editor uses this
// subpath so it doesn't pull the server harness into the client bundle (S21).
export { Rga, Replica } from './rga';
export type { CollabOp, InsertOp, DeleteOp } from './rga';

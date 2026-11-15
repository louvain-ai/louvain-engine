/**
 * `@louvain/netguard` — the one rule for a request made on someone else's say-so: which URLs and addresses it may reach
 * (`address.ts`) and how to connect to exactly the address that was checked (`pinned.ts`). A request to one vendor's
 * own hosts is a rule of its own beside these, each at its own subpath. Node-only: it resolves names and opens
 * sockets, so it is imported by servers and runners, never by a browser bundle.
 */
export { type PublicUrlPolicy, privateAddress, publicUrl } from "./address.js";
export {
  type FetchPublicOptions,
  fetchPublic,
  type Pin,
  type PinnedInit,
  type PublicFetch,
  pinFor,
  pinnedRequest,
  type Resolve,
  readCapped,
  systemResolve,
  type Transport,
} from "./pinned.js";

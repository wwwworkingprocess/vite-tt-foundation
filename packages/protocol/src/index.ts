/** A harmless protocol marker used only to prove package consumption. */
export const protocolFoundationVersion = 1 as const;

/** An environment-neutral identifier foundation; final wire contracts are deferred. */
export type FoundationIdentifier = string & {
  readonly __foundationIdentifier: unique symbol;
};

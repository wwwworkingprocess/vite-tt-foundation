/** A harmless protocol marker used only to prove package consumption. */
/** Source/API compatibility marker; serialized messages use validated discriminated schemas. */
export const protocolContractVersion = 1 as const;

/** An environment-neutral identifier foundation; final wire contracts are deferred. */
export type FoundationIdentifier = string & {
  readonly __foundationIdentifier: unique symbol;
};

export * from './foundation-contracts.js';
export * from './positions.js';

export const SEMANTIC_NAMING_STRATEGY = 'single-highlight-v1';
export const SEMANTIC_NAMING_GROUPING_VERSION = 2;
export const SEMANTIC_NAMING_CACHE_IDENTITY = `${SEMANTIC_NAMING_STRATEGY}:grouping-${SEMANTIC_NAMING_GROUPING_VERSION}`;

export function isCurrentSemanticReceipt(receipt) {
  const metadata = receipt?.metadata;
  return metadata?.strategy === SEMANTIC_NAMING_STRATEGY
    && metadata.groupingVersion === SEMANTIC_NAMING_GROUPING_VERSION
    && metadata.cacheIdentity === SEMANTIC_NAMING_CACHE_IDENTITY;
}

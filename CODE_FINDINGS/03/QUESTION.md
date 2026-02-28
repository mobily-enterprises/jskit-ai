Check for contract drift: places where TypeScript types / JSDoc / schemas / interfaces claim one thing but runtime code behaves differently.
Find mismatches like optional fields that are required, string/number confusion, nullable fields used unsafely, or ‘any’/type casts hiding uncertainty.
Produce a prioritized list with concrete examples and fixes.

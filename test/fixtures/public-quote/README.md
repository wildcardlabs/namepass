# Quote HTTP test fixture

`helper-runtime.hex` is the compiled deployed bytecode from the current
`contracts/ENSV2RenewalAdapter.sol`, with compiler settings from `foundry.toml`.
It was copied from `out/ENSV2RenewalAdapter.sol/ENSV2RenewalAdapter.json` after
checking `assertEnsV2Adapter()`. Immutable address slots use the compiler's
zero placeholders; the adapter fingerprint excludes those slots. The deployed
adapter `0x4A468177187999F125dCE99a5eBD5F82Ab8D3481` matches this runtime outside those slots.

The fixture lets HTTP tests verify accepted and rejected adapter runtime code
without a Foundry build, network access or deployment credentials. RPC amounts
are fixed examples, not a mock implementation of ENS pricing. Independent live
forward-price evidence is in `docs/deployments/2026-10-05/public-api-quotes.json`.

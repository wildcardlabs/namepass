# Factory runtime fixture

`factory-runtime.hex` is public bytecode read at Sepolia block `11976900` for the two-contract
factory `0xC4Fb9AED5d7b812AA3689aA4B9400671dd665E79`, which is also the hub gateway.
Its Keccak-256 hash is `0x7ca0a4660909e70cdecc1487e282d82a8cc0825c02cea740e3e58f3603abe08c`,
matching the reviewed [deployment manifest](../../../docs/deployments/2026-10-23/protocol-deployment-manifest.json);
the same runtime is deployed on all four testnets.
The fixture supplies the pinned code to the operator's mock RPC boundary. The tests construct
independent pooled/split receipt examples; this bytecode fixture does not execute Solidity.

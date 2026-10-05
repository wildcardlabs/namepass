# Factory runtime fixture

`factory-runtime.hex` is public Sepolia bytecode read at block `11815694` for
factory `0x2dCB5CA6b21372b43e37C35Da8D5D15160423150`.
Its Keccak-256 hash is `0x3822dfc2cbf9fe25fbe5258eb13cf8be999c1b776c361fbd220f9412b96659e1`,
matching the reviewed [deployment verification](../../../docs/deployments/2026-09-22/verification.json).
The fixture supplies the pinned code to the operator's mock RPC boundary. The tests construct
independent pooled/split receipt examples; this bytecode fixture does not execute Solidity.

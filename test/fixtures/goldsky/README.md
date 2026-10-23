# Live native Arc payload

`arc-native-zero-scale.json` is the public event observed at both
`all_usdc_transfers` and `incoming_deposits` on the existing
`namepass-testnet-v2` pipeline on 2026-10-06 at 21:28:51 UTC.
The user sent 0.50 native USDC in transaction
`0x83be711fb69f2bd185a5a418177438a43827d99c5f53b8df6bfc2a9936f2d562`.

The transform running on 2026-10-06 used decimal division to convert 18-decimal native USDC
to six-decimal units and emitted `500000.000000000000000000`. The generator committed since
2026-10-23 divides on the decimal string and emits the integer `500000`; both forms require
exact micro-USDC divisibility. The capture was not changed. The regression verifies that
the receiver accepts the exact whole amount while rejecting fractional units
and retaining strict integer fields for other deposit types.

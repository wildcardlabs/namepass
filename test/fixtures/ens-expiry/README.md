# ENS registration expiry evidence

`sepolia.json` contains read-only Sepolia calls captured on 2026-10-23 at the
recorded block through the two-contract deployment's adapter, plus the V1 renewal
receipt of the `vitalik` canary (`0x950ece36…`), the first direct renewal on the
2026-10-23 factory. `scripts/fixtures/record-ens-expiry.ts` regenerates it.

The V1 registrar reports 90 days of grace. Five unmigrated reservations have V2
expiry exactly 5,356,800 seconds later than their V1 registration expiry. Two V2
registrations must retain their V2 expiry. No offset is applied by the implementation.

The V1 receipt includes a registration extension before the V2 renewer event
and a zero-duration wrapper synchronization after it. The first event supplies
registration expiry; the second must not be mistaken for a second extension.

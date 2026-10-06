# ENS registration expiry evidence

`sepolia.json` contains read-only Sepolia calls captured on 2026-10-06 at the
recorded block, plus V1 renewal logs from a public canonical receipt.

The V1 registrar reports 90 days of grace; the V2 registrar reports 28 days.
Four unmigrated reservations have V2 expiry exactly 5,356,800 seconds later
than their V1 registration expiry. Three V2 registrations must retain their V2
expiry. No offset is applied by the implementation.

The V1 receipt includes a registration extension before the V2 renewer event
and a zero-duration wrapper synchronization after it. The first event supplies
registration expiry; the second must not be mistaken for a second extension.

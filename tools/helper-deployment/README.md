# Retired helper deployment page

This page rotated the ENS helper of the September 22 five-contract deployment through its
`RenewalHelperPointer`. That deployment is retired. The two-contract deployment of
2026-10-23 has no pointer: the factory at `0xC4Fb9AED5d7b812AA3689aA4B9400671dd665E79`
selects the adapter itself through the timelock-governed `setHelper`, and the adapter is
view-only. Do not run this page against the current contracts; its embedded artifact,
addresses and constructor arguments belong to the old design.

Adapter rotation now uses `tools/protocol-deployment`: deploy the replacement
`ENSV2RenewalAdapter` through the singleton factory with a new salt label, then schedule and
execute `setHelper(adapter)` on the timelock. The page's readiness checks, verification and
export apply unchanged. See [DEPLOYMENTS.md](../../docs/DEPLOYMENTS.md) for the active
addresses and the October 6 rotation record that this page produced.

The source stays for the historical record and still type-checks:

```bash
npx tsc --noEmit -p tools/helper-deployment/tsconfig.json
```

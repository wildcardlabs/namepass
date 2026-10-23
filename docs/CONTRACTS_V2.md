# Contracts

Deployment addresses and verification evidence are in
[DEPLOYMENTS.md](DEPLOYMENTS.md). This document describes the
contract boundaries of the two-contract design deployed on 2026-10-23. The design rationale and
gas measurements are in [GAS_REDESIGN_PROPOSAL.md](GAS_REDESIGN_PROPOSAL.md). The contracts are
not externally audited.

## Contract boundary

`NamepassFactory` is one contract at one address on every chain. It derives and deploys the
ERC-1167 deposit wallets, authenticates funding, completes CCTP claims, settles payments, pays the
executor, and selects the ENS adapter through its governance executor. It holds no funds between
calls. The gateway and pointer of the September 22 design are merged into it: `gateway()`,
`pointer()` and `factory()` return the factory's own address, `currentHelper()` returns the active
adapter, and `l1Helper()` returns the hub settlement address, which is the factory itself. A
changed factory address changes derived deposit addresses.

The factory's payment configuration is initialized once: USDC, Circle TokenMessenger, and on the
hub the Circle MessageTransmitter and the governance executor. The owner can change the CCTP
finality threshold and nominate a successor; neither changes the payment route. There is no sweep
and no owner-controlled payment destination.

Deposit wallets delegatecall the factory. On the hub, `renew(label)` reads the wallet's USDC
balance, deploys the wallet when needed, and runs the settlement inside the wallet, so the wallet
pays ENS directly. On a source chain, the wallet approves Circle's TokenMessenger for the balance
and burns it to the factory's own address on the hub with the label as hook data. Direct factory
deposits and unknown calldata are rejected; native Arc reception through wallets is the one
exception, restricted to Arc with Sepolia as hub.

`completeCCTP(message, attestation)` verifies message and burn-body version 1, the hub as
destination domain, a non-hub source domain, Circle TokenMessenger as recipient, and the factory as
destination caller and mint recipient. It rejects a noncanonical source-wallet encoding. The label
must be nonempty, at most 255 bytes, and contain no dot. The factory binds the label to its wallet
and verifies that the observed mint equals the burn amount minus the executed Circle fee. Circle
authenticates the attestation, remote route, token mapping, and nonce. The factory then runs the
same settlement with the minted amount as the authenticated payment.

## Settlement

One routine settles both routes, inside the wallet on the direct path and inside the factory on
the claim path. The authenticated amount is the wallet balance the factory read or the amount
Circle minted. Nothing else held by the payer is spent. With `GAS_ALLOWANCE` fixed at 100,000
USDC base units:

1. The payer asks the adapter for a plan: `(renewer, spender, duration, price, data)` for a budget
   of `amount - GAS_ALLOWANCE`. The plan must have `duration > 0` and `0 < price <= budget`.
2. The renewer and the spender must be contracts, and neither may be the payer, the factory, or
   USDC.
3. The payer approves the spender for exactly `price`, calls the renewer with `data`, and requires
   that its USDC balance dropped by exactly `price`. ENS prices the renewal again inside its own
   `renew`, so a plan that disagrees with ENS fails on the allowance or on the delta.
4. Any residual allowance is cleared.
5. The executor receives `amount - price`, which is the allowance plus the rounding remainder.

A reentrancy guard in transient storage protects `renew` and `completeCCTP`. Failed settlement
reverts the whole call, including a CCTP mint; Circle then accepts the same message on retry.

The adapter can therefore direct at most the quoted price of one payment, and only to the spender
it names, and only after the governance executor activates it. `setHelper` requires the adapter to
report interface version 2, the factory as both `factory()` and `gateway()`, and USDC as
`paymentToken()`. `HelperUpdated` includes the previous adapter, new adapter, and new runtime code
hash. Executor handover requires nomination by the current executor and acceptance by the
successor. The executor must be an ENS Timelock on mainnet; the code check is only a configuration
check and cannot prove DAO control. Sepolia uses an explicit test timelock.

## ENS adapter

`ENSV2RenewalAdapter` is view-only. It fixes its factory, USDC, registrar, V1 renewer, and referrer
at construction and has no owner, setters, balance, or entrypoint that executes. `plan` selects the
ENS renewer that accepts the label, inverts that renewer's live oracle to find the longest
whole-second duration the budget buys, and returns the renewer as both target and spender with the
exact `renew(RenewData, USDC)` calldata. `quote`, `renewableBy`, and `nameState` serve reads;
`nameState` returns expiry and the selected renewer, and reads expiry from the registrar's registry
when neither renewer accepts the label. Registry-specific reads therefore stay inside replaceable
code. The oracle is read from the selected ENS contract on every call.

The adapter reports the V2 registry expiry for both renewal routes. For an unmigrated V1 name this
is a reservation expiry, not the V1 registration expiry. The backend uses the adapter's selected
renewer, discovers `BASE_REGISTRAR()` through `ETHRenewerV1`, and reads `nameExpires` at the same
block. Migrated and new V2 registrations retain their V2 expiry. When neither route is renewable,
the V2 registry's `latestOwner` distinguishes a former reservation from a former registration.

For a V1 renewal receipt, expiry comes from the V1 BaseRegistrar's `NameRenewed(id, expires)`
before the V2 renewer event in the same call segment. Later wrapper synchronization can emit
another V1 event and does not supply the registration extension. The V1 registrar address is read
from the selected V1 renewer at the receipt block. V2 renewals retain their own event expiry.

## Events

The factory emits every protocol event, so `gatewayAddress` and `pointerAddress` in the
application configuration name the factory. The signatures are unchanged from the September 22
design: `WalletDeployed`, `DepositProcessed`, `CCTPClaimed`, `HelperUsed`, `Renewed`, and the
governance events. Order on the direct path: `HelperUsed`, `Renewed`, then `DepositProcessed`. On
a claim: `CCTPClaimed` before ENS executes, then `HelperUsed` and `Renewed`. On the hub, a
direct renewal shows two wallet debits, ENS's charge and the executor's share; on a source chain,
one debit, the burn.

## Verified ENS compatibility

The supplied registrar `0xf633e7FC17e2bbE0D0965D18ec1821dcB754a3d3` and V1 renewer
`0xf2ece44980778966b8a0FccB3A9E339440f6e045` both use the tuple `RenewData` renewal ABI and point
to oracle `0x8196665D4ca7488B6474a9EC8E7d2719FB42263A`, which supports Sepolia USDC. The adapter's
ABI comes from the deployed registrar's bytecode, never from a repository branch; ENS's `main`
branch carries an older flat signature. If ENS redeploys with a different ABI, the response is a new
adapter activated through the timelock, not a factory change.

The vendored oracle source under `test/ens` differs from the deployed one in its compiler pragma,
StringUtils import path, and interface documentation. Its pricing function bodies are unchanged.
Keep the vendored 0.8.24-compatible fixture for universal pricing tests and use the deployed oracle
in fork tests. The factory compiler settings are pinned in `foundry.toml`, with Cancun as the EVM
target since 2026-10-12, verified by creation calls on all four testnets.

Run universal tests:

```sh
forge build
forge test
```

Run the opt-in, read-only deployment tests:

```sh
NAMEPASS_FORK_RPC=https://sepolia.drpc.org NAMEPASS_FORK_BLOCK=<recent block> \
  forge test --match-path test/SepoliaFork.t.sol -vv
```

They renew the live premigrated `vitalik` reservation through the V1 route and the migrated
`skellat` name through the V2 route, and reuse a deployed wallet. They check expiry growth, exact
charges, executor payment, and cleared allowances through the real factory-wallet-adapter path.
No test broadcasts a transaction. Without the RPC variable the tests are skipped, not reported as
deployment verification.

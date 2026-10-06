import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  decodeFunctionData,
  encodeFunctionResult,
  parseAbi,
  type Address,
  type Hex,
} from "viem";
import { HUB_CHAIN } from "../src/lib/chains";
import { labelHash, readEnsState } from "./chain";
import { parseEnsRenewalExpiry } from "./ens-renewal";

const evidence = JSON.parse(
  readFileSync(
    new URL("../test/fixtures/ens-expiry/sepolia.json", import.meta.url),
    "utf8",
  ),
);
const abi = parseAbi([
  "function currentHelper() view returns(address)",
  "function gateway() view returns(address)",
  "function pointer() view returns(address)",
  "function interfaceVersion() view returns(uint256)",
  "function factory() view returns(address)",
  "function paymentToken() view returns(address)",
  "function ethRegistrar() view returns(address)",
  "function ethRenewerV1() view returns(address)",
  "function referrer() view returns(bytes32)",
  "function nameState(string) view returns(uint64,address)",
  "function ETH_REGISTRY() view returns(address)",
  "function BASE_REGISTRAR() view returns(address)",
  "function nameExpires(uint256) view returns(uint256)",
  "function getState(uint256) view returns((uint8 status,uint64 expiry,address latestOwner,uint256 tokenId,uint256 resource))",
]);

test("current expiry uses the V1 registration before migration and the V2 registration after migration", async (t) => {
  const previous = process.env[HUB_CHAIN.rpcEnv];
  process.env[HUB_CHAIN.rpcEnv] = "https://expiry-fixture.test";
  t.after(() => {
    if (previous === undefined) delete process.env[HUB_CHAIN.rpcEnv];
    else process.env[HUB_CHAIN.rpcEnv] = previous;
  });
  let current = evidence.names[0];
  let failV1 = false;
  t.mock.method(
    globalThis,
    "fetch",
    async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      if (!Array.isArray(body))
        return Response.json({
          jsonrpc: "2.0",
          id: body.id,
          result:
            body.method === "eth_chainId"
              ? "0xaa36a7"
              : `0x${BigInt(evidence.blockNumber).toString(16)}`,
        });
      return Response.json(
        body.map((call) => {
          assert.equal(call.method, "eth_call");
          assert.equal(
            call.params[1],
            `0x${BigInt(evidence.blockNumber).toString(16)}`,
            "all reads use one snapshot",
          );
          const decoded = decodeFunctionData({
            abi,
            data: call.params[0].data,
          });
          const values: Record<string, unknown> = {
            currentHelper: evidence.helper,
            gateway: HUB_CHAIN.gatewayAddress,
            pointer: HUB_CHAIN.pointerAddress,
            interfaceVersion: 1n,
            factory: HUB_CHAIN.factoryAddress,
            paymentToken: HUB_CHAIN.usdcAddress,
            ethRegistrar: evidence.registrar,
            ethRenewerV1: evidence.renewerV1,
            referrer: HUB_CHAIN.ensReferrer,
            nameState: [BigInt(current.helperExpiry), current.selected],
            ETH_REGISTRY: evidence.registry,
            BASE_REGISTRAR: evidence.baseRegistrar,
            getState: {
              ...current.state,
              expiry: BigInt(current.state.expiry),
              tokenId: BigInt(current.state.tokenId),
              resource: BigInt(current.state.resource),
            },
            nameExpires: BigInt(current.v1Expiry),
          };
          if (decoded.functionName === "nameExpires") {
            assert.equal(
              call.params[0].to.toLowerCase(),
              evidence.baseRegistrar.toLowerCase(),
            );
            assert.equal(
              decoded.args?.[0],
              BigInt(labelHash(current.label)),
              "V1 IDs use the full label hash",
            );
            if (failV1)
              return {
                jsonrpc: "2.0",
                id: call.id,
                error: { code: -32000, message: "unavailable" },
              };
          }
          return {
            jsonrpc: "2.0",
            id: call.id,
            result: encodeFunctionResult({
              abi,
              functionName: decoded.functionName,
              result: values[decoded.functionName] as never,
            }),
          };
        }),
      );
    },
  );
  for (const name of evidence.names) {
    current = name;
    const v1 = name.selected.toLowerCase() === evidence.renewerV1.toLowerCase();
    assert.deepEqual(await readEnsState(name.label), {
      expiry: new Date(Number(v1 ? name.v1Expiry : name.helperExpiry) * 1000),
      renewableBy: v1 ? "v1" : "registrar",
    });
  }
  // A V1 reservation remains V1 even after neither renewer accepts it.
  current = {
    ...evidence.names.find((name: { label: string }) => name.label === "nick"),
    selected: `0x${"0".repeat(40)}`,
  };
  assert.deepEqual(await readEnsState(current.label), {
    expiry: new Date(Number(current.v1Expiry) * 1000),
    renewableBy: null,
  });
  // An expired migrated registration must not fall back to its obsolete V1 token.
  current = {
    ...evidence.names.find((name: { label: string }) => name.label === "steve"),
    selected: `0x${"0".repeat(40)}`,
  };
  assert.deepEqual(await readEnsState(current.label), {
    expiry: new Date(Number(current.helperExpiry) * 1000),
    renewableBy: null,
  });
  current = evidence.names.find(
    (name: { label: string }) => name.label === "vitalik",
  );
  failV1 = true;
  await assert.rejects(
    () => readEnsState(current.label),
    /unavailable/,
    "a failed V1 read must not expose the reservation date",
  );
});

test("a V1 renewal receipt uses the registration event, ignoring later wrapper synchronization", () => {
  const logs = evidence.receipt.logs as Array<{
    address: Address;
    data: Hex;
    topics: Hex[];
  }>;
  const expected = {
    label: "vitalik",
    registrar: evidence.registrar,
    renewerV1: evidence.renewerV1,
    baseRegistrarV1: evidence.baseRegistrar,
    referrer: HUB_CHAIN.ensReferrer!,
  };
  const expiry = parseEnsRenewalExpiry(logs, expected);
  assert.equal(
    expiry.getTime() / 1000,
    3146224415,
    "the BaseRegistrar's observed expiry, not the V2 reservation 3151581215",
  );
  assert.throws(
    () =>
      parseEnsRenewalExpiry(logs, { ...expected, baseRegistrarV1: undefined }),
    /not configured/,
  );
  assert.throws(
    () => parseEnsRenewalExpiry(logs.slice(1), expected),
    /preceding ENS V1/,
  );
  assert.throws(
    () => parseEnsRenewalExpiry([logs[0], ...logs], expected),
    /preceding ENS V1/,
  );
  assert.throws(
    () =>
      parseEnsRenewalExpiry(logs, {
        ...expected,
        baseRegistrarV1: HUB_CHAIN.gatewayAddress,
      }),
    /preceding ENS V1/,
  );
});

test("canonical receipt enrichment corrects both gateway and standalone V1 ENS index events", async (t) => {
  // Replay this archived receipt under its recorded ENS deployment. The live registry
  // accepts only the October contracts; the gateway path still discovers its helper.
  const previousV1 = HUB_CHAIN.ensRenewerV1Address;
  Object.assign(HUB_CHAIN, { ensRenewerV1Address: evidence.renewerV1 });
  t.after(() => Object.assign(HUB_CHAIN, { ensRenewerV1Address: previousV1 }));
  const { indexedRenewalExpiry } = await import("./indexed-renewal");
  const { decodeEventLog, toFunctionSelector } = await import("viem");
  const previous = process.env[HUB_CHAIN.rpcEnv];
  process.env[HUB_CHAIN.rpcEnv] = "https://index-expiry-fixture.test";
  t.after(() => {
    if (previous === undefined) delete process.env[HUB_CHAIN.rpcEnv];
    else process.env[HUB_CHAIN.rpcEnv] = previous;
  });
  const metadataAbi = parseAbi([
    "function ethRegistrar() view returns(address)",
    "function ethRenewerV1() view returns(address)",
    "function referrer() view returns(bytes32)",
    "function BASE_REGISTRAR() view returns(address)",
  ]);
  const renewalAbi = parseAbi([
    "event Renewed(bytes32 indexed labelHash,address indexed wallet,address indexed executor,string label,uint64 duration,uint256 amountReceived,uint256 gasAllowance,uint256 amountApplied,uint256 remainder,bool fromCCTP)",
    "event NameRenewed(uint256 indexed tokenId,string label,uint64 duration,uint64 newExpiry,address paymentToken,bytes32 indexed referrer,uint256 amount)",
  ]);
  t.mock.method(
    globalThis,
    "fetch",
    async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      const result =
        body.method === "eth_chainId"
          ? "0xaa36a7"
          : body.method === "eth_getTransactionReceipt"
            ? evidence.canonicalReceipt
            : body.method === "eth_getBlockByNumber"
              ? evidence.canonicalBlock
              : undefined;
      if (result !== undefined)
        return Response.json({ jsonrpc: "2.0", id: body.id, result });
      assert.equal(body.method, "eth_call");
      assert.equal(body.params[1], evidence.canonicalReceipt.blockNumber);
      const name = [
        "ethRegistrar",
        "ethRenewerV1",
        "referrer",
        "BASE_REGISTRAR",
      ].find(
        (name) => toFunctionSelector(name + "()") === body.params[0].data,
      )!;
      assert.ok(name);
      assert.equal(
        body.params[0].to.toLowerCase(),
        (name === "BASE_REGISTRAR"
          ? evidence.renewerV1
          : evidence.helper
        ).toLowerCase(),
      );
      const values: Record<string, any> = {
        ethRegistrar: evidence.registrar,
        ethRenewerV1: evidence.renewerV1,
        referrer: HUB_CHAIN.ensReferrer,
        BASE_REGISTRAR: evidence.baseRegistrar,
      };
      return Response.json({
        jsonrpc: "2.0",
        id: body.id,
        result: encodeFunctionResult({
          abi: metadataAbi,
          functionName: name as never,
          result: values[name],
        }),
      });
    },
  );
  for (const family of ["namepass", "ens"] as const) {
    const emitter =
      family === "ens" ? evidence.renewerV1 : HUB_CHAIN.gatewayAddress!;
    const log = evidence.canonicalReceipt.logs.find(
      (log: { address: string; logIndex: string }) =>
        log.address.toLowerCase() === emitter.toLowerCase() &&
        Number(BigInt(log.logIndex)) === (family === "ens" ? 154 : 164),
    );
    const args = decodeEventLog({ abi: renewalAbi, ...log, strict: true })
      .args as any;
    const facts =
      family === "ens"
        ? {
            contract_address: log.address,
            token_id: String(args.tokenId),
            label: args.label,
            duration: String(args.duration),
            new_expiry: String(args.newExpiry),
            payment_token: args.paymentToken,
            referrer: args.referrer,
            amount: String(args.amount),
          }
        : {
            label_hash: args.labelHash,
            wallet_address: args.wallet,
            executor_address: args.executor,
            label: args.label,
            duration: String(args.duration),
            amount_received: String(args.amountReceived),
            gas_allowance: String(args.gasAllowance),
            amount_applied: String(args.amountApplied),
            remainder: String(args.remainder),
            from_cctp: String(args.fromCCTP),
          };
    const event = {
      eventId: `11155111:${family}:expiry`,
      eventFamily: family,
      eventType: family === "ens" ? "NameRenewed" : "Renewed",
      chainId: 11155111,
      blockNumber: String(BigInt(evidence.canonicalReceipt.blockNumber)),
      blockTime: new Date(
        Number(BigInt(evidence.canonicalBlock.timestamp)) * 1000,
      ),
      txHash: evidence.canonicalReceipt.transactionHash,
      logIndex: Number(BigInt(log.logIndex)),
      gsOp: "c" as const,
      payload: {},
      facts,
    };
    assert.equal(await indexedRenewalExpiry(event), "3146224415");
    const key = family === "ens" ? "new_expiry" : "amount_applied";
    await assert.rejects(
      () => indexedRenewalExpiry({ ...event, facts: { ...facts, [key]: "1" } }),
      /does not match/,
    );
  }
});

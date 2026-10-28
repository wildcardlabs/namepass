import assert from "node:assert/strict";
import test from "node:test";
import { KMSClient, type SignCommand } from "@aws-sdk/client-kms";
import { hexToBigInt, hexToBytes, keccak256, serializeTransaction, type TransactionSerializableEIP1559 } from "viem";
import { privateKeyToAccount, sign } from "viem/accounts";

import { relayerAccount, relayerSigner } from "./relayer-signer";

const KEY = `0x${"4c0883a69102937d6231471b5dbb6204fe5129617082792ae468d01a3f362318"}` as const;
const ADDRESS = privateKeyToAccount(KEY).address;
const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const KMS_ENV = {
	RELAYER_KMS_KEY_ARN: "arn:aws:kms:us-east-1:123456789012:key/00000000-0000-0000-0000-000000000000",
	RELAYER_KMS_ROLE_ARN: "arn:aws:iam::123456789012:role/namepass-relayer-signer",
};

function withEnv(values: Record<string, string | undefined>, work: () => Promise<void> | void) {
	const names = ["RELAYER_ADDRESS", "RELAYER_KMS_KEY_ARN", "RELAYER_KMS_ROLE_ARN"];
	const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
	for (const name of names) {
		if (values[name] === undefined) delete process.env[name];
		else process.env[name] = values[name];
	}
	return Promise.resolve().then(work).finally(() => {
		for (const name of names) {
			if (previous[name] === undefined) delete process.env[name];
			else process.env[name] = previous[name];
		}
	});
}

/* DER as KMS returns it: SEQUENCE of two minimal positive INTEGERs. */
function der(r: bigint, s: bigint): Uint8Array {
	const integer = (value: bigint) => {
		let bytes = hexToBytes(`0x${value.toString(16).padStart(64, "0")}`);
		while (bytes.length > 1 && bytes[0] === 0 && bytes[1] < 0x80) bytes = bytes.subarray(1);
		if (bytes[0] >= 0x80) bytes = Uint8Array.from([0, ...bytes]);
		return [0x02, bytes.length, ...bytes];
	};
	const body = [...integer(r), ...integer(s)];
	return Uint8Array.from([0x30, body.length, ...body]);
}

test("the KMS signer produces the same EIP-1559 transaction as a reference secp256k1 signer", async () => {
	const requests: SignCommand["input"][] = [];
	const originalSend = KMSClient.prototype.send;
	let highS = 0;
	KMSClient.prototype.send = (async (command: SignCommand) => {
		requests.push(command.input);
		const hash = `0x${Buffer.from(command.input.Message!).toString("hex")}` as const;
		const { r, s } = await sign({ hash, privateKey: KEY });
		/* KMS may return either s. Use the high form for every other request. */
		const flip = requests.length % 2 === 0;
		if (flip) highS++;
		return { Signature: der(hexToBigInt(r), flip ? N - hexToBigInt(s) : hexToBigInt(s)) };
	}) as typeof KMSClient.prototype.send;
	try {
		await withEnv({ ...KMS_ENV, RELAYER_ADDRESS: ADDRESS.toLowerCase() }, async () => {
			const account = relayerAccount();
			assert.equal(account.address, ADDRESS);
			for (let nonce = 0; nonce < 6; nonce++) {
				const transaction: TransactionSerializableEIP1559 = {
					type: "eip1559",
					chainId: 11155111,
					nonce,
					to: "0xC4Fb9AED5d7b812AA3689aA4B9400671dd665E79",
					data: "0x1234",
					value: 0n,
					gas: 210_000n + BigInt(nonce),
					maxFeePerGas: 2_000_000_000n,
					maxPriorityFeePerGas: 1_000_000n,
				};
				assert.equal(
					await account.signTransaction(transaction),
					await privateKeyToAccount(KEY).signTransaction(transaction),
				);
				const request = requests[requests.length - 1];
				assert.equal(request.KeyId, KMS_ENV.RELAYER_KMS_KEY_ARN);
				assert.equal(request.MessageType, "DIGEST");
				assert.equal(request.SigningAlgorithm, "ECDSA_SHA_256");
				assert.equal(
					Buffer.from(request.Message!).toString("hex"),
					keccak256(serializeTransaction(transaction)).slice(2),
				);
			}
		});
		assert.equal(highS, 3);
	} finally {
		KMSClient.prototype.send = originalSend;
	}
});

test("the KMS signer refuses a key that does not recover to RELAYER_ADDRESS", async () => {
	const originalSend = KMSClient.prototype.send;
	KMSClient.prototype.send = (async (command: SignCommand) => {
		const hash = `0x${Buffer.from(command.input.Message!).toString("hex")}` as const;
		const { r, s } = await sign({ hash, privateKey: KEY });
		return { Signature: der(hexToBigInt(r), hexToBigInt(s)) };
	}) as typeof KMSClient.prototype.send;
	try {
		await withEnv({ ...KMS_ENV, RELAYER_ADDRESS: "0x0000000000000000000000000000000000000001" }, async () => {
			await assert.rejects(relayerAccount().signMessage({ message: "namepass" }), /does not match RELAYER_ADDRESS/);
		});
	} finally {
		KMSClient.prototype.send = originalSend;
	}
});

test("the relayer signer requires a complete configuration", async () => {
	await withEnv({ ...KMS_ENV }, () => {
		assert.throws(relayerSigner, /RELAYER_ADDRESS is required/);
	});
	await withEnv({ RELAYER_KMS_KEY_ARN: KMS_ENV.RELAYER_KMS_KEY_ARN, RELAYER_ADDRESS: ADDRESS }, () => {
		assert.throws(relayerSigner, /RELAYER_KMS_ROLE_ARN/);
	});
});

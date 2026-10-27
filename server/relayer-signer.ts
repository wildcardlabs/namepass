import {
	getAddress,
	hashMessage,
	hashTypedData,
	keccak256,
	numberToHex,
	recoverAddress,
	serializeSignature,
	serializeTransaction,
	type Address,
	type Hex,
	type LocalAccount,
} from "viem";
import { privateKeyToAccount, toAccount } from "viem/accounts";

/* The relayer signs with exactly one of two sources:
   - RELAYER_PRIVATE_KEY, a raw key in the environment; or
   - RELAYER_KMS_KEY_ARN and RELAYER_KMS_ROLE_ARN, a non-exportable AWS KMS secp256k1 key.
     The function assumes the role with its Vercel OIDC token. RELAYER_ADDRESS is required,
     and every signature must recover to it. See infra/aws/relayer-signer.yaml. */

const SECP256K1_N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const KMS_KEY_ARN = /^arn:aws[a-z-]*:kms:([a-z0-9-]+):\d{12}:key\/[A-Za-z0-9-]+$/;
const IAM_ROLE_ARN = /^arn:aws[a-z-]*:iam::\d{12}:role\/[\w+=,.@/-]+$/;

export type RelayerSigner =
	| { kind: "private_key"; key: Hex }
	| { kind: "kms"; keyArn: string; roleArn: string; region: string; address: Address };

/** Read and validate the signer configuration. Null when no signer is configured. */
export function relayerSigner(): RelayerSigner | null {
	const key = process.env.RELAYER_PRIVATE_KEY;
	const keyArn = process.env.RELAYER_KMS_KEY_ARN;
	const roleArn = process.env.RELAYER_KMS_ROLE_ARN;
	if (key && (keyArn || roleArn)) {
		throw new Error("Configure RELAYER_PRIVATE_KEY or the RELAYER_KMS_* signer, not both.");
	}
	if (key) {
		if (!/^0x[0-9a-f]{64}$/i.test(key)) throw new Error("RELAYER_PRIVATE_KEY is not configured correctly.");
		return { kind: "private_key", key: key as Hex };
	}
	if (!keyArn && !roleArn) return null;
	const region = keyArn?.match(KMS_KEY_ARN)?.[1];
	if (!keyArn || !region) throw new Error("RELAYER_KMS_KEY_ARN is not a KMS key ARN.");
	if (!roleArn || !IAM_ROLE_ARN.test(roleArn)) throw new Error("RELAYER_KMS_ROLE_ARN is not an IAM role ARN.");
	const address = process.env.RELAYER_ADDRESS;
	if (!address || !/^0x[0-9a-f]{40}$/i.test(address)) {
		throw new Error("RELAYER_ADDRESS is required with the KMS relayer signer.");
	}
	return { kind: "kms", keyArn, roleArn, region, address: getAddress(address) };
}

export function relayerAccount(): LocalAccount {
	const signer = relayerSigner();
	if (!signer) throw new Error("The relayer signer is not configured.");
	return signer.kind === "private_key" ? privateKeyToAccount(signer.key) : kmsAccount(signer);
}

function kmsAccount(signer: Extract<RelayerSigner, { kind: "kms" }>): LocalAccount {
	const sign = async (hash: Hex) => recoverableSignature(hash, await kmsSign(signer, hash), signer.address);
	return toAccount({
		address: signer.address,
		async signMessage({ message }) {
			return serializeSignature(await sign(hashMessage(message)));
		},
		async signTypedData(typedData) {
			return serializeSignature(await sign(hashTypedData(typedData)));
		},
		async signTransaction(transaction, options) {
			const serializer = options?.serializer ?? serializeTransaction;
			/* Blob sidecars are not part of the signed payload. */
			const signable = transaction.type === "eip4844" ? { ...transaction, sidecars: false as const } : transaction;
			const signature = await sign(keccak256(await serializer(signable)));
			return serializer(transaction, signature);
		},
	});
}

/* One client per function instance. The SDK caches the role session until it expires. */
let kmsClient: { cacheKey: string; client: import("@aws-sdk/client-kms").KMSClient } | null = null;

async function kmsSign(signer: Extract<RelayerSigner, { kind: "kms" }>, hash: Hex): Promise<Uint8Array> {
	const [{ KMSClient, SignCommand }, { fromWebToken }, { getVercelOidcToken }] = await Promise.all([
		import("@aws-sdk/client-kms"),
		import("@aws-sdk/credential-provider-web-identity"),
		import("@vercel/oidc"),
	]);
	const clientKey = `${signer.roleArn} ${signer.keyArn}`;
	if (kmsClient?.cacheKey !== clientKey) {
		kmsClient = {
			cacheKey: clientKey,
			client: new KMSClient({
				region: signer.region,
				credentials: async () => fromWebToken({
					roleArn: signer.roleArn,
					roleSessionName: "namepass-relayer",
					webIdentityToken: await getVercelOidcToken(),
					clientConfig: { region: signer.region },
				})(),
			}),
		};
	}
	const { Signature } = await kmsClient.client.send(new SignCommand({
		KeyId: signer.keyArn,
		Message: Buffer.from(hash.slice(2), "hex"),
		MessageType: "DIGEST",
		SigningAlgorithm: "ECDSA_SHA_256",
	}));
	if (!Signature) throw new Error("KMS returned no signature.");
	return Signature;
}

/* KMS returns DER (r, s) without a recovery bit. Ethereum requires s in the lower half
   of the curve order and a y-parity that recovers the signing address. */
async function recoverableSignature(hash: Hex, der: Uint8Array, address: Address) {
	const { r, s: rawS } = parseDerSignature(der);
	const s = rawS > SECP256K1_N / 2n ? SECP256K1_N - rawS : rawS;
	for (const yParity of [0, 1] as const) {
		const signature = { r: numberToHex(r, { size: 32 }), s: numberToHex(s, { size: 32 }), yParity };
		if (await recoverAddress({ hash, signature }) === address) {
			return { ...signature, v: yParity === 0 ? 27n : 28n };
		}
	}
	throw new Error("The KMS relayer key does not match RELAYER_ADDRESS.");
}

function parseDerSignature(der: Uint8Array): { r: bigint; s: bigint } {
	const malformed = (): never => {
		throw new Error("KMS returned a malformed signature.");
	};
	if (der[0] !== 0x30 || der[1] !== der.length - 2) malformed();
	let offset = 2;
	const integer = () => {
		const length = der[offset + 1];
		if (der[offset] !== 0x02 || !length || length > 33 || offset + 2 + length > der.length) malformed();
		const value = BigInt(`0x${Buffer.from(der.subarray(offset + 2, offset + 2 + length)).toString("hex")}`);
		offset += 2 + length;
		return value;
	};
	const r = integer();
	const s = integer();
	if (offset !== der.length || r === 0n || s === 0n || r >= SECP256K1_N || s >= SECP256K1_N) malformed();
	return { r, s };
}

import "dotenv/config"
import { writeFileSync } from "fs"
import { toSafeSmartAccount } from "permissionless/accounts"
import { Hex, createPublicClient, http } from "viem"
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts"
import { sepolia } from "viem/chains"
import { createPimlicoClient } from "permissionless/clients/pimlico"
import { createPaymasterClient, entryPoint07Address } from "viem/account-abstraction"
import { createSmartAccountClient } from "permissionless"

const apiKey = process.env.PIMLICO_API_KEY
if (!apiKey) throw new Error("Missing PIMLICO_API_KEY")
const paymasterUrl = `https://api.pimlico.io/v2/sepolia/rpc?apikey=${apiKey}`

const privateKey =
	(process.env.PRIVATE_KEY as Hex) ??
	(() => {
		const pk = generatePrivateKey()
		writeFileSync(".env", `PRIVATE_KEY=${pk}`)
		return pk
	})()

export const publicClient = createPublicClient({
	chain: sepolia,
	transport: http("https://rpc.ankr.com/eth_sepolia"),
})

export const paymasterClient = createPaymasterClient({
	transport: http(paymasterUrl),
})

const account = await toSafeSmartAccount({
	client: publicClient,
	owner: privateKeyToAccount(privateKey),
	entryPoint: {
		address: entryPoint07Address,
		version: "0.7"
	}, // global entrypoint
	version: "1.4.1",
})

console.log({
	accountAddress: await account.getAddress(),
})

console.log(`Smart account address: https://sepolia.etherscan.io/address/${account.address}`)

const bundlerUrl = `https://api.pimlico.io/v2/sepolia/rpc?apikey=${apiKey}`

const bundlerClient = createPimlicoClient({
	transport: http(bundlerUrl),
	entryPoint: {
		address: entryPoint07Address,
		version: "0.7",
	}
})

const smartAccountClient = createSmartAccountClient({
	account,
	chain: sepolia,
	transport: http(bundlerUrl),
	paymaster: paymasterClient,
	userOperation: {
		estimateFeesPerGas: async () => {
			return (await bundlerClient.getUserOperationGasPrice()).fast
		},
	}
})

const txHash = await smartAccountClient.sendTransaction({
	to: "0xd8da6bf26964af9d7eed9e03e53415d37aa96045",
	value: 0n,
	data: "0x1234",
})

console.log(`User operation included: https://sepolia.etherscan.io/tx/${txHash}`)

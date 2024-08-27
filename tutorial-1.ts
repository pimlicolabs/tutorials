import "dotenv/config"
import { writeFileSync } from "fs"
import { toSafeSmartAccount } from "permissionless/accounts"
import { Hex, createPublicClient, http } from "viem"
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts"
import { sepolia } from "viem/chains"
import { createPimlicoClient } from "permissionless/clients/pimlico"
import { createBundlerClient, createPaymasterClient, entryPoint07Address } from "viem/account-abstraction"

const apiKey = process.env.PIMLICO_API_KEY
if (!apiKey) throw new Error("Missing PIMLICO_API_KEY")

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

const pimlicoUrl = `https://api.pimlico.io/v2/sepolia/rpc?apikey=${apiKey}`

const pimlicoClient = createPimlicoClient({
	transport: http(pimlicoUrl),
	entryPoint: {
		address: entryPoint07Address,
		version: "0.7",
	}
})

const smartAccountClient = createBundlerClient({
	account,
	chain: sepolia,
	transport: http(pimlicoUrl),
	paymaster: pimlicoClient,
	userOperation: {
		estimateFeesPerGas: async () => {
			return (await pimlicoClient.getUserOperationGasPrice()).fast
		},
	}
})

const userOpHash = await smartAccountClient.sendUserOperation({
	calls: [{
		to: "0xd8da6bf26964af9d7eed9e03e53415d37aa96045",
		value: 0n,
		data: "0x1234",
	}]
})

const receipt = await smartAccountClient.waitForUserOperationReceipt({hash:userOpHash})

console.log(`User operation included: https://sepolia.etherscan.io/tx/${receipt.receipt.transactionHash}`)

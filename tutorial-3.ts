import "dotenv/config"
import { writeFileSync } from "fs"
import { ENTRYPOINT_ADDRESS_V07, createSmartAccountClient } from "permissionless"
import { signerToSafeSmartAccount } from "permissionless/accounts"
import { createPimlicoBundlerClient } from "permissionless/clients/pimlico"
import { Hex, createPublicClient, encodeFunctionData, http, parseAbiItem } from "viem"
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts"
import { sepolia } from "viem/chains"

const erc20PaymasterAddress = "0x000000000041F3aFe8892B48D88b6862efe0ec8d"
const usdcAddress = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238"

const privateKey =
	(process.env.PRIVATE_KEY as Hex) ??
	(() => {
		const pk = generatePrivateKey()
		writeFileSync(".env", `PRIVATE_KEY=${pk}`)
		return pk
	})()

const publicClient = createPublicClient({
	transport: http("https://rpc.ankr.com/eth_sepolia"),
})

const apiKey = "YOUR_PIMLICO_API_KEY"
const bundlerUrl = `https://api.pimlico.io/v2/sepolia/rpc?apikey=${apiKey}`

const bundlerClient = createPimlicoBundlerClient({
	transport: http(bundlerUrl),
	entryPoint: ENTRYPOINT_ADDRESS_V07,
})

const account = await signerToSafeSmartAccount(publicClient, {
	signer: privateKeyToAccount(privateKey),
	entryPoint: ENTRYPOINT_ADDRESS_V07, // global entrypoint
	safeVersion: "1.4.1",
	setupTransactions: [
		{
			to: usdcAddress,
			value: 0n,
			data: encodeFunctionData({
				abi: [parseAbiItem("function approve(address spender, uint256 amount)")],
				args: [
					erc20PaymasterAddress,
					0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffn,
				],
			}),
		},
	],
})

console.log(`Smart account address: https://sepolia.etherscan.io/address/${account.address}`)

const senderUsdcBalance = await publicClient.readContract({
	abi: [parseAbiItem("function balanceOf(address account) returns (uint256)")],
	address: usdcAddress,
	functionName: "balanceOf",
	args: [account.address],
})

if (senderUsdcBalance < 1_000_000n) {
	throw new Error(
		`insufficient USDC balance for counterfactual wallet address ${account.address}: ${
			Number(senderUsdcBalance) / 1000000
		} USDC, required at least 1 USDC. Load up balance at https://faucet.circle.com/`,
	)
}

console.log(`Smart account USDC balance: ${Number(senderUsdcBalance) / 1000000} USDC`)

const smartAccountClient = createSmartAccountClient({
	account,
	entryPoint: ENTRYPOINT_ADDRESS_V07,
	chain: sepolia,
	bundlerTransport: http(bundlerUrl),
	middleware: {
		gasPrice: async () => {
			return (await bundlerClient.getUserOperationGasPrice()).fast
		},
		sponsorUserOperation: async (args) => {
			const gasEstimates = await bundlerClient.estimateUserOperationGas({
				userOperation: {
					...args.userOperation,
					paymaster: erc20PaymasterAddress,
				},
			})

			return {
				...gasEstimates,
				paymaster: erc20PaymasterAddress,
			}
		},
	},
})

const txHash = await smartAccountClient.sendTransaction({
	to: "0xd8da6bf26964af9d7eed9e03e53415d37aa96045",
	value: 0n,
	data: "0x1234",
})

console.log(`User operation included: https://sepolia.etherscan.io/tx/${txHash}`)

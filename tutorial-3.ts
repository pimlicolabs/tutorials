import "dotenv/config"
import { writeFileSync } from "fs"
import { createSmartAccountClient } from "permissionless"
import { toSafeSmartAccount } from "permissionless/accounts"
import { createPimlicoClient } from "permissionless/clients/pimlico"
import { Hex, createClient, createPublicClient, encodeFunctionData, http, parseAbiItem } from "viem"
import { GetPaymasterDataParameters } from "viem/account-abstraction/actions/paymaster/getPaymasterData"
import { entryPoint07Address } from "viem/account-abstraction"
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts"
import { sepolia } from "viem/chains"
import { GetPaymasterStubDataParameters } from "viem/account-abstraction/actions/paymaster/getPaymasterStubData"

const erc20PaymasterAddress = "0x000000000041F3aFe8892B48D88b6862efe0ec8d" as const
const usdcAddress = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238"

const privateKey =
	(process.env.PRIVATE_KEY as Hex) ??
	(() => {
		const pk = generatePrivateKey()
		writeFileSync(".env", `PRIVATE_KEY=${pk}`)
		return pk
	})()

const publicClient = createPublicClient({
	chain: sepolia,
	transport: http("https://rpc.ankr.com/eth_sepolia"),
})

const apiKey = process.env.PIMLICO_API_KEY // REPLACE THIS
const bundlerUrl = `https://api.pimlico.io/v2/sepolia/rpc?apikey=${apiKey}`

const bundlerClient = createPimlicoClient({
	transport: http(bundlerUrl),
	entryPoint: {
		address: entryPoint07Address,
		version: "0.7",
	},
})

const account = await toSafeSmartAccount( {
	client: publicClient,
	owner: privateKeyToAccount(privateKey),
	version: "1.4.1",
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

const erc20Paymaster = createClient({
	transport: http(bundlerUrl),
}).extend((_) => ({
	getPaymasterData: async (
		parameters: GetPaymasterDataParameters,
	  ) => {
		const gasEstimates = await bundlerClient.estimateUserOperationGas({
			...parameters,
			paymaster: erc20PaymasterAddress,
		})
		return {
			paymaster: erc20PaymasterAddress,
			paymasterData: "0x" as Hex,
			paymasterPostOpGasLimit: gasEstimates.paymasterPostOpGasLimit ?? 0n,
			paymasterVerificationGasLimit: gasEstimates.paymasterVerificationGasLimit ?? 0n,
		}
	  },
	  getPaymasterStubData: async (
		parameters: GetPaymasterStubDataParameters,
	  ) => {
		const gasEstimates = await bundlerClient.estimateUserOperationGas({
			...parameters,
			paymaster: erc20PaymasterAddress
		})
		
		return {
			paymaster: erc20PaymasterAddress,
			paymasterData: "0x" as Hex,
			paymasterPostOpGasLimit: gasEstimates.paymasterPostOpGasLimit ?? 0n,
			paymasterVerificationGasLimit: gasEstimates.paymasterVerificationGasLimit ?? 0n
		}
	}
}))

const smartAccountClient = createSmartAccountClient({
	client: publicClient,
	account,
	chain: sepolia,
	transport: http(bundlerUrl),
	paymaster: erc20Paymaster,
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

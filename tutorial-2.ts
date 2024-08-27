import "dotenv/config"
import { pimlicoActions } from "permissionless/actions/pimlico"
import { getSenderAddress } from "permissionless/actions"
import { Address, Hex, createClient, createPublicClient, encodeFunctionData, http } from "viem"
import { bundlerActions, createPaymasterClient, entryPoint07Address, getUserOperationHash, UserOperation } from "viem/account-abstraction"
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts"
import { sepolia } from "viem/chains"

export const publicClient = createPublicClient({
	transport: http("https://rpc.ankr.com/eth_sepolia"),
	chain: sepolia,
})

const apiKey = process.env.PIMLICO_API_KEY // REPLACE THIS
const endpointUrl = `https://api.pimlico.io/v2/sepolia/rpc?apikey=${apiKey}`

const bundlerClient = createClient({
	transport: http(endpointUrl),
	chain: sepolia,
})
	.extend(bundlerActions)
	.extend(pimlicoActions({
		entryPoint: {
			address: entryPoint07Address,
			version: "0.7"
		}
	}))

const paymasterClient = createPaymasterClient({
	transport: http(endpointUrl),
})

const SIMPLE_ACCOUNT_FACTORY_ADDRESS = "0x91E60e0613810449d098b0b5Ec8b51A0FE8c8985"

const ownerPrivateKey = generatePrivateKey()
const owner = privateKeyToAccount(ownerPrivateKey)

console.log("Generated wallet with private key:", ownerPrivateKey)

const factory = SIMPLE_ACCOUNT_FACTORY_ADDRESS
const factoryData = encodeFunctionData({
	abi: [
		{
			inputs: [
				{ name: "owner", type: "address" },
				{ name: "salt", type: "uint256" },
			],
			name: "createAccount",
			outputs: [{ name: "ret", type: "address" }],
			stateMutability: "nonpayable",
			type: "function",
		},
	],
	args: [owner.address, 0n],
})

console.log("Generated factoryData:", factoryData)

const senderAddress = await getSenderAddress(publicClient, {
	factory,
	factoryData,
	entryPointAddress: entryPoint07Address,
})
console.log("Calculated sender address:", senderAddress)

const to = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045" // vitalik
const value = 0n
const data = "0x68656c6c6f" // "hello" encoded to utf-8 bytes

const callData = encodeFunctionData({
	abi: [
		{
			inputs: [
				{ name: "dest", type: "address" },
				{ name: "value", type: "uint256" },
				{ name: "func", type: "bytes" },
			],
			name: "execute",
			outputs: [],
			stateMutability: "nonpayable",
			type: "function",
		},
	],
	args: [to, value, data],
})

console.log("Generated callData:", callData)

const gasPrice = await bundlerClient.getUserOperationGasPrice()

const userOperation = {
	sender: senderAddress,
	nonce: 0n,
	factory: factory as Address,
	factoryData,
	callData,
	maxFeePerGas: gasPrice.fast.maxFeePerGas,
	maxPriorityFeePerGas: gasPrice.fast.maxPriorityFeePerGas,
	callGasLimit: 0n,
	preVerificationGas: 0n,
	verificationGasLimit: 0n,
	// dummy signature, needs to be there so the SimpleAccount doesn't immediately revert because of invalid signature length
	signature:
		"0xa15569dd8f8324dbeabf8073fdec36d4b754f53ce5901e283c6de79af177dc94557fa3c9922cd7af2a96ca94402d35c39f266925ee6407aeb32b31d76978d4ba1c" as Hex,
		
}

const estimationResult = await bundlerClient.estimateUserOperationGas({
	...userOperation,
	entryPointAddress: entryPoint07Address,
})

userOperation.callGasLimit = estimationResult.callGasLimit
userOperation.preVerificationGas = estimationResult.preVerificationGas
userOperation.verificationGasLimit = estimationResult.verificationGasLimit


const sponsorUserOperationResult = await paymasterClient.getPaymasterData({
	...userOperation,
	chainId: sepolia.id,
	entryPointAddress: entryPoint07Address,
})

console.log({
	sponsorUserOperationResult
})

const sponsoredUserOperation: UserOperation<"0.7"> = {
	callData: userOperation.callData,
	callGasLimit: estimationResult.callGasLimit,
	factory: userOperation.factory,
	factoryData: userOperation.factoryData,
	maxFeePerGas: userOperation.maxFeePerGas,
	maxPriorityFeePerGas: userOperation.maxPriorityFeePerGas,
	nonce: userOperation.nonce,
	paymaster: sponsorUserOperationResult.paymaster,
	paymasterData: sponsorUserOperationResult.paymasterData,
	paymasterPostOpGasLimit: sponsorUserOperationResult.paymasterPostOpGasLimit,
	paymasterVerificationGasLimit: sponsorUserOperationResult.paymasterVerificationGasLimit,
	preVerificationGas: estimationResult.preVerificationGas,
	sender: userOperation.sender,
	signature: userOperation.signature,
	verificationGasLimit: estimationResult.verificationGasLimit,
}

console.log("Received paymaster sponsor result:", sponsorUserOperationResult)

const signature = await owner.signMessage({
	message: {
		raw: getUserOperationHash({
			userOperation: sponsoredUserOperation,
			chainId: sepolia.id,
			entryPointAddress: entryPoint07Address,
			entryPointVersion: "0.7",
		})
	}
})

sponsoredUserOperation.signature = signature

console.log("Generated signature:", signature)

const userOperationHash = await bundlerClient.sendUserOperation({
	...sponsoredUserOperation,
	entryPointAddress: entryPoint07Address,
})

console.log("Received User Operation hash:", userOperationHash)

// let's also wait for the userOperation to be included, by continually querying for the receipts
console.log("Querying for receipts...")
const receipt = await bundlerClient.waitForUserOperationReceipt({
	hash: userOperationHash,
})
const txHash = receipt.receipt.transactionHash

console.log(`UserOperation included: https://sepolia.etherscan.io/tx/${txHash}`)

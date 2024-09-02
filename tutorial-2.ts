import "dotenv/config";
import { getRequiredPrefund } from "permissionless";
import { toSimpleSmartAccount } from "permissionless/accounts";
import { createPimlicoClient } from "permissionless/clients/pimlico";
import {
	createPublicClient,
	getAddress,
	getContract,
	Hex,
	http,
	maxUint256,
	parseAbi,
} from "viem";
import {
	createBundlerClient,
	entryPoint07Address,
	EntryPointVersion,
} from "viem/account-abstraction";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { writeFileSync } from "fs";

const apiKey = process.env.PIMLICO_API_KEY;
const pimlicoUrl = `https://api.pimlico.io/v2/${baseSepolia.id}/rpc?apikey=${apiKey}`;
const usdc = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

const privateKey =
	(process.env.PRIVATE_KEY as Hex) ??
	(() => {
		const pk = generatePrivateKey();
		writeFileSync(".env", `PRIVATE_KEY=${pk}`);
		return pk;
	})();

const publicClient = createPublicClient({
	chain: baseSepolia,
	transport: http("https://sepolia.base.org"),
});
const pimlicoClient = createPimlicoClient({
	transport: http(pimlicoUrl),
	entryPoint: {
		address: entryPoint07Address,
		version: "0.7" as EntryPointVersion,
	},
});

const account = await toSimpleSmartAccount({
	client: publicClient,
	owner: privateKeyToAccount(privateKey),
});

const bundlerClient = createBundlerClient({
	account,
	chain: baseSepolia,
	transport: http(pimlicoUrl),
	paymaster: pimlicoClient,
	userOperation: {
		estimateFeesPerGas: async () => {
			return (await pimlicoClient.getUserOperationGasPrice()).fast;
		},
	},
});

console.log(
	`Smart account address: https://sepolia.basescan.io/address/${account.address}`,
);

const senderUsdcBalance = await publicClient.readContract({
	abi: parseAbi(["function balanceOf(address account) returns (uint256)"]),
	address: usdc,
	functionName: "balanceOf",
	args: [account.address],
});

if (senderUsdcBalance < 1_000_000n) {
	throw new Error(
		`insufficient USDC balance for counterfactual wallet address ${account.address}: ${
			Number(senderUsdcBalance) / 1_000_000
		} USDC, required at least 1 USDC. Load up balance at https://faucet.circle.com/`,
	);
}

const tokenQuotes = await pimlicoClient.getTokenQuotes({
	tokens: [usdc],
});

const { postOpGas, exchangeRate, paymaster, token } = tokenQuotes[0];

const calls = [
	{
		to: getAddress(token),
		abi: parseAbi(["function approve(address,uint)"]),
		functionName: "approve",
		args: [paymaster, maxUint256],
	},
	{
		to: getAddress("0xd8da6bf26964af9d7eed9e03e53415d37aa96045"),
		data: "0x1234" as Hex,
	},
];

let userOperation = await bundlerClient.prepareUserOperation({
	calls,
});

const paymasterContract = getContract({
	address: paymaster,
	abi: parseAbi([
		"function getCostInToken(uint256 _actualGasCost, uint256 _postOpGas, uint256 _actualUserOpFeePerGas, uint256 _exchangeRate) public pure returns (uint256)",
	]),
	client: publicClient,
});

const maxCostInToken = await paymasterContract.read.getCostInToken([
	getRequiredPrefund({ userOperation, entryPointVersion: "0.7" }),
	postOpGas,
	userOperation.maxFeePerGas,
	exchangeRate,
]);

console.log(`maxCostInToken: ${maxCostInToken}`);

const hash = await bundlerClient.sendUserOperation({
	account,
	paymasterContext: {
		token: usdc,
	},
	calls,
});

const opReceipt = await bundlerClient.waitForUserOperationReceipt({
	hash,
});

console.log(`transactionHash: ${opReceipt.receipt.transactionHash}`);

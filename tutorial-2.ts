import { EntryPoint, EntryPoint__factory, SimpleAccountFactory__factory, SimpleAccount__factory, UserOperationStruct } from "@account-abstraction/contracts"
import { ERC20, ERC20__factory, getERC20Paymaster } from "@pimlico/erc20-paymaster"
import { BigNumber, Wallet, ethers } from "ethers"
import dotenv from 'dotenv'
dotenv.config()

// DEFINE THE CONSTANTS
const privateKey = "GENERATED_PRIVATE_KEY" // replace this with a private key you generate!
const apiKey = process.env.PIMLICO_API_KEY // replace with your Pimlico API key

const ENTRY_POINT_ADDRESS = "0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789"
const SIMPLE_ACCOUNT_FACTORY_ADDRESS = "0x9406Cc6185a346906296840746125a0E44976454"

const pimlicoEndpoint = `https://api.pimlico.io/v1/mumbai/rpc?apikey=${apiKey}`

if (apiKey === undefined) {
    throw new Error("Please replace the `apiKey` env variable with your Pimlico API key")
}

const pimlicoProvider = new ethers.providers.StaticJsonRpcProvider(pimlicoEndpoint)

if (privateKey.match(/GENERATED_PRIVATE_KEY/)) {
    throw new Error(
        "Please replace the `privateKey` variable with a newly generated private key. You can use `Wallet.createRandom().privateKey` for this"
    )
}

const rpcUrl = `https://mumbai.rpc.thirdweb.com`
const rpcProvider = new ethers.providers.StaticJsonRpcProvider(rpcUrl)

// CALCULATE THE DETERMINISTIC SENDER ADDRESS
const generateInitCode = async (provider: ethers.providers.Provider, wallet: Wallet) => {
    const simpleAccountFactory = SimpleAccountFactory__factory.connect(SIMPLE_ACCOUNT_FACTORY_ADDRESS, provider)
    const initCode = ethers.utils.hexConcat([
        SIMPLE_ACCOUNT_FACTORY_ADDRESS,
        simpleAccountFactory.interface.encodeFunctionData("createAccount", [wallet.address, 0])
    ])
 
    return initCode
}
 
const calculateSenderAddress = async (entryPoint: EntryPoint, initCode: string) => {
    const senderAddress = await entryPoint.callStatic
        .getSenderAddress(initCode)
        .then(() => {
            throw new Error("Expected getSenderAddress() to revert")
        })
        .catch((e) => {
            const data = e.message.match(/0x6ca7b806([a-fA-F\d]*)/)?.[1]
            if (!data) {
                return Promise.reject(new Error("Failed to parse revert data"))
            }
            const addr = ethers.utils.getAddress(`0x${data.slice(24, 64)}`)
                return Promise.resolve(addr)
            })
 
    return senderAddress
}
 
const owner = new Wallet(privateKey, rpcProvider)
const entryPoint = EntryPoint__factory.connect(ENTRY_POINT_ADDRESS, rpcProvider)
const initCode = await generateInitCode(rpcProvider, owner)
const senderAddress = await calculateSenderAddress(entryPoint, initCode)
 
console.log("Counterfactual sender address:", senderAddress)

// DEPLOY THE SIMPLE WALLET
const genereteApproveCallData = (erc20Token: ERC20, paymasterAddress: string) => {
    const approveData = erc20Token.interface.encodeFunctionData("approve", [paymasterAddress, ethers.constants.MaxUint256])
 
    // GENERATE THE CALLDATA TO APPROVE THE USDC
    const to = erc20Token.address
    const value = 0
    const data = approveData
 
    const simpleAccount = SimpleAccount__factory.connect(paymasterAddress, rpcProvider)
    const callData = simpleAccount.interface.encodeFunctionData("execute", [to, value, data])
 
    return callData
}
 
const submitUserOperation = async (
    userOperation: UserOperationStruct,
    pimlicoProvider: ethers.providers.StaticJsonRpcProvider
) => {
    const userOperationHash = await pimlicoProvider.send("eth_sendUserOperation", [userOperation, ENTRY_POINT_ADDRESS])
    console.log(`UserOperation submitted. Hash: ${userOperationHash}`)
 
    console.log("Querying for receipts...")
    let receipt = null
    while (receipt === null) {
        await new Promise((resolve) => setTimeout(resolve, 1000))
        receipt = await pimlicoProvider.send("eth_getUserOperationReceipt", [userOperationHash])
        console.log(
            receipt === null ? "Receipt not found..." : `Receipt found!\nTransaction hash: ${receipt.receipt.transactionHash}`
        )
    }
}
 
const erc20Paymaster = await getERC20Paymaster(rpcProvider, "USDC")
const erc20PaymasterAddress = erc20Paymaster.contract.address
const usdcTokenAddress = await erc20Paymaster.contract.token()
const usdcToken = ERC20__factory.connect(usdcTokenAddress, owner)
 
const senderUsdcBalance = await usdcToken.balanceOf(senderAddress)
 
if (senderUsdcBalance < BigNumber.from(1_000_000)) {
    throw new Error(
        `insufficient USDC balance for counterfactual wallet address ${senderAddress}: ${
        senderUsdcBalance.toNumber() / 1000000
        } USDC, required at least 1 USDC`
    )
}
 
const approveCallData = genereteApproveCallData(usdcToken, erc20PaymasterAddress)
 
// FILL OUT THE REMAINING USEROPERATION VALUES
const gasPrice = await rpcProvider.getGasPrice()
 
const userOperation = {
    sender: senderAddress,
    nonce: ethers.utils.hexlify(0),
    initCode,
    callData: approveCallData,
    callGasLimit: ethers.utils.hexlify(100_000), // hardcode it for now at a high value
    verificationGasLimit: ethers.utils.hexlify(500_000), // hardcode it for now at a high value
    preVerificationGas: ethers.utils.hexlify(50_000), // hardcode it for now at a high value
    maxFeePerGas: ethers.utils.hexlify(gasPrice),
    maxPriorityFeePerGas: ethers.utils.hexlify(gasPrice),
    paymasterAndData: "0x",
    signature: "0x"
}
 
const nonce = await entryPoint.getNonce(senderAddress, 0)
if (nonce.eq(BigNumber.from(0))) {    
    // SPONSOR THE USEROPERATION USING THE VERIFYING PAYMASTER
    const result = await pimlicoProvider.send("pm_sponsorUserOperation", [userOperation, {entryPoint: ENTRY_POINT_ADDRESS}])
    userOperation.paymasterAndData = result.paymasterAndData
 
    // SIGN THE USEROPERATION
    const signature = await owner.signMessage(ethers.utils.arrayify(await entryPoint.getUserOpHash(userOperation)))
    userOperation.signature = signature
    await submitUserOperation(userOperation, pimlicoProvider)
} else {
    console.log("Deployment UserOperation previously submitted, skipping...")
}

// SPONSOR A USER OPERATION WITH THE ERC-20 PAYMASTER
const genereteDummyCallData = () => {
    const vitalik = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"
 
    // SEND EMPTY CALL TO VITALIK
    const to = vitalik
    const value = 0
    const data = "0x"
 
    const simpleAccount = SimpleAccount__factory.connect(vitalik, rpcProvider)
    const callData = simpleAccount.interface.encodeFunctionData("execute", [to, value, data])
 
    return callData
}
 
const newNonce = await entryPoint.getNonce(senderAddress, 0)
const sponsoredUserOperation = {
    sender: senderAddress,
    nonce: ethers.utils.hexlify(newNonce),
    initCode: "0x",
    callData: genereteDummyCallData(),
    callGasLimit: ethers.utils.hexlify(100_000), // hardcode it for now at a high value
    verificationGasLimit: ethers.utils.hexlify(500_000), // hardcode it for now at a high value
    preVerificationGas: ethers.utils.hexlify(50_000), // hardcode it for now at a high value
    maxFeePerGas: ethers.utils.hexlify(gasPrice),
    maxPriorityFeePerGas: ethers.utils.hexlify(gasPrice),
    paymasterAndData: "0x",
    signature: "0x"
}
 
await erc20Paymaster.verifyTokenApproval(sponsoredUserOperation) // verify if enough USDC is approed to the paymaster
 
const erc20PaymasterAndData = await erc20Paymaster.generatePaymasterAndData(sponsoredUserOperation)
sponsoredUserOperation.paymasterAndData = erc20PaymasterAndData
 
// SIGN THE USEROPERATION
const signature = await owner.signMessage(ethers.utils.arrayify(await entryPoint.getUserOpHash(sponsoredUserOperation)))
sponsoredUserOperation.signature = signature
 
await submitUserOperation(sponsoredUserOperation, pimlicoProvider)
"use client";

import { useState, useEffect } from "react";
import { ethers } from "ethers";
import { ToastContainer, toast } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import { destinationBytecode as CallbackBytecode } from "./data/AAVELiquidationProtectionCallback";
import { reactiveBytecode as ReactiveBytecode } from "./data/AAVELiquidationProtectionReactive";

// Contract ABIs (simplified for brevity)
const CallbackABI = [
  "constructor(address _callback_sender, address _collateralToken, address _collateralTokenPriceFeed) payable",
  "function calculateCollateralNeeded(address user, address lendingPool, uint256 targetHealthFactor) public view returns (uint256)",
];

const ReactiveABI = [
  "constructor(address _lendingPool, address _protectionManager, address _uniswapPair, address _user, uint256 _healthFactorThreshold, uint256 _targetHealthFactor) payable",
];

const ERC20ABI = [
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function allowance(address owner, address spender) external view returns (uint256)",
  "function balanceOf(address account) external view returns (uint256)",
  "function symbol() external view returns (string)",
  "function decimals() external view returns (uint8)",
];

const LendingPoolABI = [
  "function getUserAccountData(address user) external view returns (uint256 totalCollateralETH, uint256 totalDebtETH, uint256 availableBorrowsETH, uint256 currentLiquidationThreshold, uint256 ltv, uint256 healthFactor)",
];

// Network information
const KOPLI_CHAIN_ID = 5318008;
const KOPLI_RPC_URL = "https://kopli-rpc.rnk.dev/";
const KOPLI_SYSTEM_CONTRACT = "0x0000000000000000000000000000000000FFFFFF";

const SEPOLIA_CHAIN_ID = 11155111;

export default function Home() {
  // State variables
  const [isConnected, setIsConnected] = useState(false);
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [signer, setSigner] = useState<ethers.Signer | null>(null);
  const [account, setAccount] = useState("");
  const [loading, setLoading] = useState(false);
  const [deployedCallbackAddress, setDeployedCallbackAddress] = useState("");
  const [deployedReactiveAddress, setDeployedReactiveAddress] = useState("");
  const [healthFactor, setHealthFactor] = useState("0");
  const [networkName, setNetworkName] = useState("");
  const [currentChainId, setCurrentChainId] = useState<number | null>(null);

  // Form inputs
  const [formData, setFormData] = useState({
    lendingPoolAddress: "0x6Ae43d3271ff6888e7Fc43Fd7321a503ff738951", // Aave Sepolia
    collateralTokenAddress: "",
    collateralPriceFeedAddress: "",
    uniswapPairAddress: "",
    healthFactorThreshold: "120000000000000000", // 1.2 in wei (with 1e18 precision)
    targetHealthFactor: "150000000000000000", // 1.5 in wei (with 1e18 precision)
    approvalAmount: "1000000000000000000", // 1 token with 18 decimals
  });

  // Add Kopli network to MetaMask
  const addKopliNetwork = async () => {
    try {
      if (window.ethereum) {
        await window.ethereum.request({
          method: "wallet_addEthereumChain",
          params: [
            {
              chainId: "0x" + KOPLI_CHAIN_ID.toString(16),
              chainName: "Reactive Kopli",
              nativeCurrency: {
                name: "REACT",
                symbol: "REACT",
                decimals: 18,
              },
              rpcUrls: [KOPLI_RPC_URL],
              blockExplorerUrls: ["https://kopli.reactscan.net"],
            },
          ],
        });
        toast.success("Kopli network added to MetaMask");
      }
    } catch (error: any) {
      console.error("Error adding Kopli network:", error);
      toast.error(`Failed to add Kopli network: ${error.message}`);
    }
  };

  // Safer way to check the current network
  const checkCurrentNetwork = async () => {
    try {
      // Always create a fresh provider for network checks
      if (window.ethereum) {
        const freshProvider = new ethers.BrowserProvider(window.ethereum);
        const network = await freshProvider.getNetwork();
        return {
          chainId: Number(network.chainId),
          name: network.name,
          provider: freshProvider,
        };
      }
      return null;
    } catch (error) {
      console.error("Error checking current network:", error);
      return null;
    }
  };

  // Updated switchNetwork function with better error handling
  const switchNetwork = async (chainId: number) => {
    try {
      if (window.ethereum) {
        // First, try the switch
        try {
          await window.ethereum.request({
            method: "wallet_switchEthereumChain",
            params: [{ chainId: "0x" + chainId.toString(16) }],
          });
        } catch (switchError: any) {
          // If the network doesn't exist, add it (for Kopli)
          if (switchError.code === 4902 && chainId === KOPLI_CHAIN_ID) {
            await addKopliNetwork();
            // Try switching again after adding
            await window.ethereum.request({
              method: "wallet_switchEthereumChain",
              params: [{ chainId: "0x" + chainId.toString(16) }],
            });
          } else {
            throw switchError;
          }
        }

        const networkName = chainId === KOPLI_CHAIN_ID ? "Kopli" : "Sepolia";
        toast.success(`Switched to ${networkName} network`);

        // Important: Wait a moment for the provider state to update
        await new Promise((resolve) => setTimeout(resolve, 1000));

        // Update current chain ID
        setCurrentChainId(chainId);
        setNetworkName(chainId === KOPLI_CHAIN_ID ? "Kopli" : "Sepolia");

        return true;
      }
      return false;
    } catch (error: any) {
      const networkName = chainId === KOPLI_CHAIN_ID ? "Kopli" : "Sepolia";
      console.error(`Error switching to ${networkName} network:`, error);
      toast.error(
        `Failed to switch to ${networkName} network: ${error.message}`
      );
      return false;
    }
  };

  // Connect to wallet
  const connectWallet = async () => {
    try {
      if (window.ethereum) {
        setLoading(true);

        // Request account access
        await window.ethereum.request({ method: "eth_requestAccounts" });

        // Create provider and signer (without switching network initially)
        const ethersProvider = new ethers.BrowserProvider(window.ethereum);
        setProvider(ethersProvider);

        const ethersSigner = await ethersProvider.getSigner();
        setSigner(ethersSigner);

        const address = await ethersSigner.getAddress();
        setAccount(address);

        setIsConnected(true);

        // Check current network
        const network = await ethersProvider.getNetwork();
        setNetworkName(network.name);
        setCurrentChainId(Number(network.chainId));

        // We'll switch networks at appropriate steps, not immediately
      } else {
        toast.error("Please install MetaMask to use this application");
      }
    } catch (error: any) {
      console.error("Error connecting wallet:", error);
      toast.error(`Failed to connect wallet: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  // Handle input changes
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData({
      ...formData,
      [name]: value,
    });
  };

  // Fetch health factor from Aave (on Sepolia)
  const fetchHealthFactor = async () => {
    if (!account || !formData.lendingPoolAddress) return;

    try {
      // Switch to Sepolia first for Aave interactions
      if (currentChainId !== SEPOLIA_CHAIN_ID) {
        const switched = await switchNetwork(SEPOLIA_CHAIN_ID);
        if (!switched) return;
      }

      const lendingPool = new ethers.Contract(
        formData.lendingPoolAddress,
        LendingPoolABI,
        provider
      );

      const userData = await lendingPool.getUserAccountData(account);

      // Format health factor (divide by 1e18 for display)
      const formattedHealthFactor = ethers.formatUnits(
        userData.healthFactor,
        18
      );
      setHealthFactor(formattedHealthFactor);
    } catch (error: any) {
      console.error("Error fetching health factor:", error);
      toast.error(`Failed to fetch health factor: ${error.message}`);
    }
  };

  // Deploy the callback contract (on Sepolia)
  const deployCallbackContract = async () => {
    if (!signer) {
      toast.error("Please connect your wallet first");
      return;
    }

    setLoading(true);
    try {
      // Validate inputs
      if (
        !formData.collateralTokenAddress ||
        !ethers.isAddress(formData.collateralTokenAddress)
      ) {
        throw new Error("Invalid collateral token address");
      }

      if (
        !formData.collateralPriceFeedAddress ||
        !ethers.isAddress(formData.collateralPriceFeedAddress)
      ) {
        throw new Error("Invalid collateral price feed address");
      }

      // Switch to Sepolia for callback contract deployment
      if (currentChainId !== SEPOLIA_CHAIN_ID) {
        toast.info(
          "Switching to Sepolia network for callback contract deployment..."
        );
        const switched = await switchNetwork(SEPOLIA_CHAIN_ID);
        if (!switched) {
          setLoading(false);
          return;
        }
      }

      // Define callback factory
      const callbackFactory = new ethers.ContractFactory(
        CallbackABI,
        CallbackBytecode,
        signer
      );

      // Use Kopli system contract as the callback sender
      const callbackSenderAddress = KOPLI_SYSTEM_CONTRACT;

      // Deploy callback contract with constructor parameters
      const callbackContract = await callbackFactory.deploy(
        callbackSenderAddress,
        formData.collateralTokenAddress,
        formData.collateralPriceFeedAddress,
        { value: ethers.parseEther("0.01") } // Sending some ETH for gas
      );

      // Wait for deployment to complete
      await callbackContract.waitForDeployment();
      const callbackAddress = await callbackContract.getAddress();

      setDeployedCallbackAddress(callbackAddress);
      toast.success(
        `Callback contract deployed at: ${callbackAddress} on Sepolia`
      );

      // Fetch health factor after deployment
      fetchHealthFactor();
    } catch (error: any) {
      console.error("Error deploying callback contract:", error);
      toast.error(`Deployment failed: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  // Deploy the reactive contract (on Kopli)
  const deployReactiveContract = async () => {
    if (!signer || !deployedCallbackAddress) {
      toast.error("Please deploy the callback contract first");
      return;
    }

    setLoading(true);
    try {
      // Validate inputs
      if (
        !formData.lendingPoolAddress ||
        !ethers.isAddress(formData.lendingPoolAddress)
      ) {
        throw new Error("Invalid lending pool address");
      }

      if (
        !formData.uniswapPairAddress ||
        !ethers.isAddress(formData.uniswapPairAddress)
      ) {
        throw new Error("Invalid Uniswap pair address");
      }

      // Switch to Kopli for reactive contract deployment
      if (currentChainId !== KOPLI_CHAIN_ID) {
        toast.info(
          "Switching to Kopli network for reactive contract deployment..."
        );

        try {
          const switched = await switchNetwork(KOPLI_CHAIN_ID);
          if (!switched) {
            setLoading(false);
            return;
          }

          // Important: Wait a moment for the provider to update after network switch
          await new Promise((resolve) => setTimeout(resolve, 1500));

          // Create a new provider and signer after network switch
          const ethersProvider = new ethers.BrowserProvider(window.ethereum);
          setProvider(ethersProvider);

          const ethersSigner = await ethersProvider.getSigner();
          setSigner(ethersSigner);
        } catch (switchError) {
          console.error("Network switching error:", switchError);
          toast.error(
            "Failed to switch networks. Please try switching to Kopli network manually and try again."
          );
          setLoading(false);
          return;
        }
      }

      // Verify we're on Kopli before proceeding
      const network = await provider!.getNetwork();
      if (network.chainId !== BigInt(KOPLI_CHAIN_ID)) {
        toast.error(
          "Network switch did not complete successfully. Please try again."
        );
        setLoading(false);
        return;
      }

      // Define reactive factory with the latest signer
      const reactiveFactory = new ethers.ContractFactory(
        ReactiveABI,
        ReactiveBytecode,
        signer!
      );

      // Deploy reactive contract with constructor parameters
      const reactiveContract = await reactiveFactory.deploy(
        formData.lendingPoolAddress,
        deployedCallbackAddress,
        formData.uniswapPairAddress,
        account,
        formData.healthFactorThreshold,
        formData.targetHealthFactor,
        { value: ethers.parseEther("0.01") } // Sending some ETH for gas
      );

      // Wait for deployment to complete
      await reactiveContract.waitForDeployment();
      const reactiveAddress = await reactiveContract.getAddress();

      setDeployedReactiveAddress(reactiveAddress);
      toast.success(
        `Reactive contract deployed at: ${reactiveAddress} on Kopli`
      );

      // Remind user about the block explorer
      toast.info(
        `View your reactive contract on Kopli block explorer: https://kopli.reactscan.net/address/${reactiveAddress}`
      );
    } catch (error: any) {
      console.error("Error deploying reactive contract:", error);
      toast.error(`Deployment failed: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  // Fixed approveCollateralToken function to handle network switching properly
  const approveCollateralToken = async () => {
    if (!signer || !deployedCallbackAddress) {
      toast.error("Please deploy the callback contract first");
      return;
    }

    setLoading(true);
    try {
      // Switch to Sepolia for token approvals
      if (currentChainId !== SEPOLIA_CHAIN_ID) {
        toast.info("Switching to Sepolia network for token approval...");

        try {
          const switched = await switchNetwork(SEPOLIA_CHAIN_ID);
          if (!switched) {
            setLoading(false);
            return;
          }

          // Important: Wait a moment for the provider to update after network switch
          await new Promise((resolve) => setTimeout(resolve, 1500));

          // Create a new provider and signer after network switch
          const ethersProvider = new ethers.BrowserProvider(window.ethereum);
          setProvider(ethersProvider);

          const ethersSigner = await ethersProvider.getSigner();
          setSigner(ethersSigner);
        } catch (switchError) {
          console.error("Network switching error:", switchError);
          toast.error(
            "Failed to switch networks. Please try switching to Sepolia network manually and try again."
          );
          setLoading(false);
          return;
        }
      }

      // Verify we're on Sepolia before proceeding
      const network = await provider!.getNetwork();
      if (network.chainId !== BigInt(SEPOLIA_CHAIN_ID)) {
        toast.error(
          "Network switch did not complete successfully. Please try again."
        );
        setLoading(false);
        return;
      }

      // Create a new contract instance with the latest signer
      const collateralToken = new ethers.Contract(
        formData.collateralTokenAddress,
        ERC20ABI,
        signer
      );

      // Get token info for display
      const symbol = await collateralToken.symbol();
      const decimals = await collateralToken.decimals();

      // Parse approval amount with correct decimals
      const approvalAmount = ethers.parseUnits(
        ethers.formatUnits(formData.approvalAmount, 18),
        decimals
      );

      // Send approval transaction
      const approvalTx = await collateralToken.approve(
        deployedCallbackAddress,
        approvalAmount
      );

      toast.info(
        `Approving ${ethers.formatUnits(approvalAmount, decimals)} ${symbol}...`
      );

      // Wait for transaction to complete
      await approvalTx.wait();

      toast.success(
        `Successfully approved ${symbol} for the protection contract on Sepolia`
      );
    } catch (error: any) {
      console.error("Error approving token:", error);
      toast.error(`Approval failed: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  // Fixed checkAllowance function to handle network switching properly
  const checkAllowance = async () => {
    if (!provider || !account || !deployedCallbackAddress) {
      toast.error("Please deploy the callback contract first");
      return;
    }

    setLoading(true);
    try {
      // Switch to Sepolia for checking allowance
      if (currentChainId !== SEPOLIA_CHAIN_ID) {
        toast.info("Switching to Sepolia network to check allowance...");

        try {
          const switched = await switchNetwork(SEPOLIA_CHAIN_ID);
          if (!switched) {
            setLoading(false);
            return;
          }

          // Important: Wait a moment for the provider to update after network switch
          await new Promise((resolve) => setTimeout(resolve, 1500));

          // Create a new provider after network switch
          const ethersProvider = new ethers.BrowserProvider(window.ethereum);
          setProvider(ethersProvider);

          // Update signer too
          const ethersSigner = await ethersProvider.getSigner();
          setSigner(ethersSigner);
        } catch (switchError) {
          console.error("Network switching error:", switchError);
          toast.error(
            "Failed to switch networks. Please try switching to Sepolia network manually and try again."
          );
          setLoading(false);
          return;
        }
      }

      // Verify we're on Sepolia before proceeding
      const network = await provider!.getNetwork();
      if (network.chainId !== BigInt(SEPOLIA_CHAIN_ID)) {
        toast.error(
          "Network switch did not complete successfully. Please try again."
        );
        setLoading(false);
        return;
      }

      const collateralToken = new ethers.Contract(
        formData.collateralTokenAddress,
        ERC20ABI,
        provider
      );

      const allowance = await collateralToken.allowance(
        account,
        deployedCallbackAddress
      );
      const symbol = await collateralToken.symbol();
      const decimals = await collateralToken.decimals();

      toast.info(
        `Current allowance on Sepolia: ${ethers.formatUnits(
          allowance,
          decimals
        )} ${symbol}`
      );
    } catch (error: any) {
      console.error("Error checking allowance:", error);
      toast.error(`Failed to check allowance: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  // Fixed calculateProtection function to handle network switching properly
  const calculateProtection = async () => {
    if (!provider || !account || !deployedCallbackAddress) {
      toast.error("Please deploy the callback contract first");
      return;
    }

    setLoading(true);
    try {
      // Switch to Sepolia for calculation
      if (currentChainId !== SEPOLIA_CHAIN_ID) {
        toast.info("Switching to Sepolia network to calculate protection...");

        try {
          const switched = await switchNetwork(SEPOLIA_CHAIN_ID);
          if (!switched) {
            setLoading(false);
            return;
          }

          // Important: Wait a moment for the provider to update after network switch
          await new Promise((resolve) => setTimeout(resolve, 1500));

          // Create a new provider after network switch
          const ethersProvider = new ethers.BrowserProvider(window.ethereum);
          setProvider(ethersProvider);

          // Update signer too
          const ethersSigner = await ethersProvider.getSigner();
          setSigner(ethersSigner);
        } catch (switchError) {
          console.error("Network switching error:", switchError);
          toast.error(
            "Failed to switch networks. Please try switching to Sepolia network manually and try again."
          );
          setLoading(false);
          return;
        }
      }

      // Verify we're on Sepolia before proceeding
      const network = await provider!.getNetwork();
      if (network.chainId !== BigInt(SEPOLIA_CHAIN_ID)) {
        toast.error(
          "Network switch did not complete successfully. Please try again."
        );
        setLoading(false);
        return;
      }

      const callbackContract = new ethers.Contract(
        deployedCallbackAddress,
        CallbackABI,
        provider
      );

      const collateralNeeded = await callbackContract.calculateCollateralNeeded(
        account,
        formData.lendingPoolAddress,
        formData.targetHealthFactor
      );

      // Get token symbol and decimals
      const collateralToken = new ethers.Contract(
        formData.collateralTokenAddress,
        ERC20ABI,
        provider
      );

      const symbol = await collateralToken.symbol();
      const decimals = await collateralToken.decimals();

      if (collateralNeeded > BigInt(0)) {
        toast.info(
          `Protection needed: ${ethers.formatUnits(
            collateralNeeded,
            decimals
          )} ${symbol}`
        );
      } else {
        toast.info(
          `No protection needed at this time (health factor above target)`
        );
      }
    } catch (error: any) {
      console.error("Error calculating protection:", error);
      toast.error(`Calculation failed: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  // Listen for network changes
  useEffect(() => {
    if (window.ethereum) {
      const handleChainChanged = (chainId: string) => {
        // Convert chainId from hex string to number
        const chainIdNumber = parseInt(chainId, 16);
        setCurrentChainId(chainIdNumber);

        // We don't force any particular network, just update the UI
        if (chainIdNumber === KOPLI_CHAIN_ID) {
          setNetworkName("Kopli");
        } else if (chainIdNumber === SEPOLIA_CHAIN_ID) {
          setNetworkName("Sepolia");
        } else {
          setNetworkName(`Chain ID: ${chainIdNumber}`);
        }
      };

      window.ethereum.on("chainChanged", handleChainChanged);

      // Cleanup
      return () => {
        window.ethereum.removeListener("chainChanged", handleChainChanged);
      };
    }
  }, []);

  // Effect to get network name on first load
  useEffect(() => {
    const updateNetworkInfo = async () => {
      if (provider) {
        const network = await provider.getNetwork();
        const chainId = Number(network.chainId);
        setCurrentChainId(chainId);

        if (chainId === KOPLI_CHAIN_ID) {
          setNetworkName("Kopli");
        } else if (chainId === SEPOLIA_CHAIN_ID) {
          setNetworkName("Sepolia");
        } else {
          setNetworkName(network.name);
        }
      }
    };

    updateNetworkInfo();
  }, [provider]);

  // Effect to fetch health factor when account changes
  useEffect(() => {
    if (isConnected && account && formData.lendingPoolAddress) {
      fetchHealthFactor();
    }
  }, [isConnected, account]);

  return (
    <div className="min-h-screen bg-gray-100 py-6 flex flex-col justify-center">
      <ToastContainer position="top-right" autoClose={5000} />

      <div className="relative py-3 sm:max-w-xl md:max-w-2xl lg:max-w-4xl mx-auto">
        <div className="absolute inset-0 bg-gradient-to-r from-purple-400 to-blue-500 shadow-lg transform -skew-y-6 sm:skew-y-0 sm:-rotate-6 sm:rounded-3xl"></div>
        <div className="relative px-4 py-10 bg-white shadow-lg sm:rounded-3xl sm:p-20">
          <div className="max-w-md mx-auto">
            <div>
              <h1 className="text-3xl font-extrabold text-gray-900 text-center">
                Aave Liquidation Protection
              </h1>
              <p className="mt-2 text-sm text-gray-500 text-center">
                Deploy smart contracts to protect your Aave position from
                liquidation
              </p>
              <div className="mt-2 text-center space-x-2">
                <span className="inline-flex items-center rounded-md bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700 ring-1 ring-inset ring-blue-700/10">
                  Callback: Sepolia
                </span>
                <span className="inline-flex items-center rounded-md bg-purple-50 px-2 py-1 text-xs font-medium text-purple-700 ring-1 ring-inset ring-purple-700/10">
                  Reactive: Kopli
                </span>
              </div>
            </div>

            {/* Wallet Connection */}
            <div className="mt-8 flex justify-center">
              {!isConnected ? (
                <button
                  onClick={connectWallet}
                  disabled={loading}
                  className="px-6 py-3 border border-transparent text-base font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 md:py-4 md:text-lg md:px-10 disabled:bg-blue-300"
                >
                  {loading ? "Connecting..." : "Connect Wallet"}
                </button>
              ) : (
                <div className="text-center">
                  <p className="text-sm text-gray-500">
                    Connected to:{" "}
                    <span className="font-semibold">{networkName}</span>
                  </p>
                  <p className="text-sm text-gray-500 mt-1">
                    Account: {account.substring(0, 6)}...
                    {account.substring(account.length - 4)}
                  </p>
                  {healthFactor !== "0" && (
                    <p className="text-sm mt-2">
                      Current Health Factor:
                      <span
                        className={`font-bold ml-1 ${
                          parseFloat(healthFactor) < 1.2
                            ? "text-red-500"
                            : parseFloat(healthFactor) < 1.5
                            ? "text-yellow-500"
                            : "text-green-500"
                        }`}
                      >
                        {parseFloat(healthFactor).toFixed(2)}
                      </span>
                    </p>
                  )}
                  <div className="mt-2 flex justify-center space-x-3">
                    <button
                      onClick={() => switchNetwork(SEPOLIA_CHAIN_ID)}
                      className="text-xs px-2 py-1 bg-blue-100 text-blue-700 rounded hover:bg-blue-200"
                    >
                      Switch to Sepolia
                    </button>
                    <button
                      onClick={() => switchNetwork(KOPLI_CHAIN_ID)}
                      className="text-xs px-2 py-1 bg-purple-100 text-purple-700 rounded hover:bg-purple-200"
                    >
                      Switch to Kopli
                    </button>
                  </div>
                </div>
              )}
            </div>

            {isConnected && (
              <div className="mt-10 space-y-8">
                {/* Step 1: Configure Protection */}
                <div className="bg-gray-50 p-6 rounded-lg">
                  <h2 className="text-xl font-semibold text-gray-800">
                    1. Configure Protection
                  </h2>

                  <div className="mt-4 space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700">
                        Aave Lending Pool (Sepolia)
                      </label>
                      <input
                        type="text"
                        name="lendingPoolAddress"
                        value={formData.lendingPoolAddress}
                        onChange={handleInputChange}
                        placeholder="0x..."
                        className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700">
                        Collateral Token (Sepolia)
                      </label>
                      <input
                        type="text"
                        name="collateralTokenAddress"
                        value={formData.collateralTokenAddress}
                        onChange={handleInputChange}
                        placeholder="0x..."
                        className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700">
                        Collateral Price Feed (Chainlink on Sepolia)
                      </label>
                      <input
                        type="text"
                        name="collateralPriceFeedAddress"
                        value={formData.collateralPriceFeedAddress}
                        onChange={handleInputChange}
                        placeholder="0x..."
                        className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700">
                        Uniswap Pair to Monitor (Kopli)
                      </label>
                      <input
                        type="text"
                        name="uniswapPairAddress"
                        value={formData.uniswapPairAddress}
                        onChange={handleInputChange}
                        placeholder="0x..."
                        className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700">
                          Health Factor Threshold
                        </label>
                        <input
                          type="text"
                          name="healthFactorThreshold"
                          value={formData.healthFactorThreshold}
                          onChange={handleInputChange}
                          placeholder="120000000000000000"
                          className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                        />
                        <p className="mt-1 text-xs text-gray-500">
                          Default: 1.2 (with 1e18 precision)
                        </p>
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700">
                          Target Health Factor
                        </label>
                        <input
                          type="text"
                          name="targetHealthFactor"
                          value={formData.targetHealthFactor}
                          onChange={handleInputChange}
                          placeholder="150000000000000000"
                          className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                        />
                        <p className="mt-1 text-xs text-gray-500">
                          Default: 1.5 (with 1e18 precision)
                        </p>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Step 2: Deploy Contracts */}
                <div className="bg-gray-50 p-6 rounded-lg">
                  <h2 className="text-xl font-semibold text-gray-800">
                    2. Deploy Protection Contracts
                  </h2>

                  <div className="mt-4 space-y-4">
                    <div className="bg-blue-50 p-3 rounded-md mb-4">
                      <h3 className="text-sm font-semibold text-blue-800">
                        Sepolia Network
                      </h3>
                      <button
                        onClick={deployCallbackContract}
                        disabled={
                          loading ||
                          !formData.collateralTokenAddress ||
                          !formData.collateralPriceFeedAddress
                        }
                        className="w-full mt-2 inline-flex justify-center py-2 px-4 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:bg-blue-300"
                      >
                        {loading
                          ? "Deploying..."
                          : "1. Deploy Callback Contract on Sepolia"}
                      </button>

                      {deployedCallbackAddress && (
                        <div className="text-sm text-gray-600 mt-2">
                          <p>
                            Callback Contract:{" "}
                            <span className="font-mono">
                              {deployedCallbackAddress}
                            </span>
                          </p>
                          <a
                            href={`https://sepolia.etherscan.io/address/${deployedCallbackAddress}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-blue-600 hover:text-blue-800"
                          >
                            View on Sepolia Explorer
                          </a>
                        </div>
                      )}
                    </div>
                    <div className="bg-purple-50 p-3 rounded-md">
                      <h3 className="text-sm font-semibold text-purple-800">
                        Kopli Network
                      </h3>
                      <button
                        onClick={deployReactiveContract}
                        disabled={
                          loading ||
                          !deployedCallbackAddress ||
                          !formData.uniswapPairAddress
                        }
                        className="w-full mt-2 inline-flex justify-center py-2 px-4 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-purple-600 hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500 disabled:bg-purple-300"
                      >
                        {loading
                          ? "Deploying..."
                          : "2. Deploy Reactive Contract on Kopli"}
                      </button>

                      {deployedReactiveAddress && (
                        <div className="text-sm text-gray-600 mt-2">
                          <p>
                            Reactive Contract:{" "}
                            <span className="font-mono">
                              {deployedReactiveAddress}
                            </span>
                          </p>
                          <a
                            href={`https://kopli.reactscan.net/address/${deployedReactiveAddress}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-purple-600 hover:text-purple-800"
                          >
                            View on Kopli Explorer
                          </a>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Step 3: Approve Collateral */}
                <div className="bg-gray-50 p-6 rounded-lg">
                  <h2 className="text-xl font-semibold text-gray-800">
                    3. Approve Collateral on Sepolia
                  </h2>

                  <div className="mt-4 space-y-4">
                    <div className="bg-blue-50 p-3 rounded-md">
                      <p className="text-xs text-blue-800 mb-2">
                        This step will automatically switch to Sepolia network
                      </p>
                      <div>
                        <label className="block text-sm font-medium text-gray-700">
                          Approval Amount (in wei)
                        </label>
                        <input
                          type="text"
                          name="approvalAmount"
                          value={formData.approvalAmount}
                          onChange={handleInputChange}
                          className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                        />
                        <p className="mt-1 text-xs text-gray-500">
                          Default: 1 token with 18 decimals
                        </p>
                      </div>

                      <div className="flex space-x-4 mt-4">
                        <button
                          onClick={approveCollateralToken}
                          disabled={
                            loading ||
                            !deployedCallbackAddress ||
                            !formData.collateralTokenAddress
                          }
                          className="flex-1 inline-flex justify-center py-2 px-4 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:bg-blue-300"
                        >
                          {loading ? "Approving..." : "Approve Token"}
                        </button>

                        <button
                          onClick={checkAllowance}
                          disabled={
                            loading ||
                            !deployedCallbackAddress ||
                            !formData.collateralTokenAddress
                          }
                          className="flex-1 inline-flex justify-center py-2 px-4 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:bg-gray-100"
                        >
                          Check Allowance
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Step 4: Check Protection Status */}
                <div className="bg-gray-50 p-6 rounded-lg">
                  <h2 className="text-xl font-semibold text-gray-800">
                    4. Check Protection Status on Sepolia
                  </h2>

                  <div className="mt-4">
                    <div className="bg-blue-50 p-3 rounded-md">
                      <p className="text-xs text-blue-800 mb-2">
                        This step will automatically switch to Sepolia network
                      </p>
                      <button
                        onClick={calculateProtection}
                        disabled={loading || !deployedCallbackAddress}
                        className="w-full inline-flex justify-center py-2 px-4 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:bg-blue-300"
                      >
                        Calculate Protection Needed
                      </button>
                    </div>
                  </div>
                </div>

                {/* Network Information */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Sepolia Network Information */}
                  <div className="bg-blue-50 p-6 rounded-lg border border-blue-200">
                    <h2 className="text-xl font-semibold text-blue-800">
                      Sepolia Network
                    </h2>

                    <div className="mt-4 space-y-2 text-sm text-gray-700">
                      <p>
                        <span className="font-medium">Network Name:</span>{" "}
                        Ethereum Sepolia
                      </p>
                      <p>
                        <span className="font-medium">Chain ID:</span>{" "}
                        {SEPOLIA_CHAIN_ID}
                      </p>
                      <p>
                        <span className="font-medium">Currency:</span> ETH
                        (testnet)
                      </p>
                      <p>
                        <span className="font-medium">Used for:</span> Callback
                        Contract, Approval, Aave Interactions
                      </p>
                      <p>
                        <span className="font-medium">Block Explorer:</span>{" "}
                        <a
                          href="https://sepolia.etherscan.io"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 hover:text-blue-800"
                        >
                          https://sepolia.etherscan.io
                        </a>
                      </p>
                    </div>

                    <div className="mt-4">
                      <button
                        onClick={() => switchNetwork(SEPOLIA_CHAIN_ID)}
                        className="w-full inline-flex justify-center py-2 px-4 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                      >
                        Switch to Sepolia
                      </button>
                    </div>
                  </div>
                  <div className="bg-purple-50 p-6 rounded-lg border border-purple-200">
                    <h2 className="text-xl font-semibold text-purple-800">
                      Reactive Kopli Network Info
                    </h2>

                    <div className="mt-4 space-y-2 text-sm text-gray-700">
                      <p>
                        <span className="font-medium">Network Name:</span>{" "}
                        Reactive Kopli
                      </p>
                      <p>
                        <span className="font-medium">RPC URL:</span>{" "}
                        {KOPLI_RPC_URL}
                      </p>
                      <p>
                        <span className="font-medium">Chain ID:</span>{" "}
                        {KOPLI_CHAIN_ID}
                      </p>
                      <p>
                        <span className="font-medium">Currency Symbol:</span>{" "}
                        REACT
                      </p>
                      <p>
                        <span className="font-medium">Block Explorer:</span>{" "}
                        <a
                          href="https://kopli.reactscan.net"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 hover:text-blue-800"
                        >
                          https://kopli.reactscan.net
                        </a>
                      </p>
                    </div>

                    <div className="mt-4">
                      <button
                        onClick={addKopliNetwork}
                        className="w-full inline-flex justify-center py-2 px-4 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-purple-600 hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500"
                      >
                        Add Kopli to MetaMask
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// Add TypeScript interface for window.ethereum
declare global {
  interface Window {
    ethereum: any;
  }
}

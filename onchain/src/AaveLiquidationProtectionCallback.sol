// SPDX-License-Identifier: MIT

pragma solidity >=0.8.0;

import '../lib/reactive-lib/src/abstract-base/AbstractCallback.sol';
import '../lib/openzeppelin-contracts/contracts/token/ERC20/IERC20.sol';
import {AggregatorV3Interface} from "@chainlink/contracts/src/v0.8/shared/interfaces/AggregatorV3Interface.sol";
interface IERC20Detailed is IERC20 {
    function decimals() external view returns (uint8);
}

// Aave interfaces
interface ILendingPool {
    function getUserAccountData(address user)
        external
        view
        returns (
            uint256 totalCollateralETH,
            uint256 totalDebtETH,
            uint256 availableBorrowsETH,
            uint256 currentLiquidationThreshold,
            uint256 ltv,
            uint256 healthFactor
        );
        
    function supply(
        address asset,
        uint256 amount,
        address onBehalfOf,
        uint16 referralCode
    ) external;
}

contract AaveLiquidationProtectionCallback is AbstractCallback {
    // Events
    event PositionProtected(
        address indexed user,
        address indexed lendingPool,
        uint256 newHealthFactor,
        uint256 collateralAdded
    );
    
    // State variables
    address private collateralToken;  // Token to use for adding collateral
    address private owner;
    AggregatorV3Interface internal collateralTokenPriceFeed;
    AggregatorV3Interface internal ETHPriceFeed = AggregatorV3Interface(0x694AA1769357215DE4FAC081bf1f309aDC325306);
    
    constructor(
        address _callback_sender,
        address _collateralToken,
        address _collateralTokenPriceFeed
    ) AbstractCallback(_callback_sender) payable {
        collateralToken = _collateralToken;
        collateralTokenPriceFeed = AggregatorV3Interface(_collateralTokenPriceFeed);
        owner = msg.sender;
    }
    
    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner can call this function");
        _;
    }
    
    // Main callback function
    function protectPosition(
        address /* sender */,
        address user,
        address lendingPool,
        uint256 targetHealthFactor
    ) external authorizedSenderOnly {
        // 1. Calculate how much collateral needs to be added
        uint256 collateralNeeded = calculateCollateralNeeded(
            user, 
            lendingPool, 
            targetHealthFactor
        );

        if (collateralNeeded > 0) {
            // 2. Check approved funds
            uint256 approvedAmount = IERC20(collateralToken).allowance(user, address(this));
            require(approvedAmount >= collateralNeeded, "Insufficient approved collateral");        

            // 3. Check available balance
            uint256 availableBalance = IERC20(collateralToken).balanceOf(address(this));
            require(availableBalance >= collateralNeeded, "Insufficient collateral available");

            // 4. Transfer tokens to this contract
            IERC20(collateralToken).transferFrom(user, address(this), collateralNeeded);
            
            // 5. Approve lending pool to spend collateral
            IERC20(collateralToken).approve(lendingPool, collateralNeeded);
            
            // 6. Add collateral to Aave
            ILendingPool(lendingPool).supply(
                collateralToken,
                collateralNeeded,
                user,
                0  // referral code
            );
        }
            
        // 7. Get new health factor
        (,,,,, uint256 newHealthFactor) = ILendingPool(lendingPool).getUserAccountData(user);
        
        // 8. Emit event
        emit PositionProtected(
            user,
            lendingPool,
            newHealthFactor,
            collateralNeeded
        );
    }
    
    // Helper to calculate needed collateral
    function calculateCollateralNeeded(
        address user,
        address lendingPool,
        uint256 targetHealthFactor
    ) internal view returns (uint256) {
        // Get user account data
        (uint256 totalCollateralETH, uint256 totalDebtETH, , uint256 liquidationThreshold, , ) = 
            ILendingPool(lendingPool).getUserAccountData(user);
            
        // Calculate collateral needed in ETH
        // Formula: totalCollateralETH_new = (targetHF * totalDebtETH) / (liquidationThreshold / 10000)
        uint256 requiredCollateralETH = (targetHealthFactor * totalDebtETH) / (liquidationThreshold / 10000);
        uint256 additionalCollateralETH = 0;
        
        if (requiredCollateralETH > totalCollateralETH) {
            additionalCollateralETH = requiredCollateralETH - totalCollateralETH;
            
            // Add 5% buffer to ensure we achieve target HF
            additionalCollateralETH = (additionalCollateralETH * 105) / 100;
        }
        
        // Get latest price data from Chainlink
        (, int256 collateralPriceUSD,,,) = collateralTokenPriceFeed.latestRoundData();
        (, int256 ethPriceUSD,,,) = ETHPriceFeed.latestRoundData();
        
        // Ensure prices are positive
        require(collateralPriceUSD > 0, "Invalid collateral price");
        require(ethPriceUSD > 0, "Invalid ETH price");
        
        // Get decimals for price normalization
        uint8 collateralPriceDecimals = collateralTokenPriceFeed.decimals();
        uint8 ethPriceDecimals = ETHPriceFeed.decimals();
        
        // Calculate the collateral token amount needed
        uint256 collateralDecimals = IERC20Detailed(collateralToken).decimals();
        
        // Convert additionalCollateralETH to USD
        // ethPriceUSD has ethPriceDecimals decimals (typically 8)
        uint256 additionalCollateralUSD = (additionalCollateralETH * uint256(ethPriceUSD)) / (10**ethPriceDecimals);
        
        // Convert USD to collateral tokens
        // collateralPriceUSD has collateralPriceDecimals decimals (typically 8)
        // We want the result in collateralDecimals (typically 18 for most tokens)
        uint256 collateralNeeded = (additionalCollateralUSD * (10**collateralDecimals)) / uint256(collateralPriceUSD);
        
        // Adjust for decimal differences
        if (collateralPriceDecimals > ethPriceDecimals) {
            collateralNeeded = collateralNeeded / (10**(collateralPriceDecimals - ethPriceDecimals));
        } else if (ethPriceDecimals > collateralPriceDecimals) {
            collateralNeeded = collateralNeeded * (10**(ethPriceDecimals - collateralPriceDecimals));
        }
    
        return collateralNeeded;
    }
    
    // Allow changing the collateral token (if needed)
    function setCollateralToken(address newCollateralToken) external onlyOwner {
        collateralToken = newCollateralToken;
    }
}
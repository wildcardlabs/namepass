// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {NamepassFactory} from "../contracts/NamepassFactory.sol";
import {ENSV2RenewalAdapter} from "../contracts/ENSV2RenewalAdapter.sol";

import {StandardRentPriceOracle, DiscountPoint, PaymentRatio} from "./ens/registrar/StandardRentPriceOracle.sol";
import {IRentPriceOracle} from "./ens/registrar/interfaces/IRentPriceOracle.sol";

import {MockUSDC, MockRenewer, MockMessageTransmitter} from "./mocks/Mocks.sol";

/**
 * @notice A hub-chain deployment of the two-contract design against the
 * vendored ENS oracle: factory initialized on Sepolia's chain ID, an
 * active adapter selected by a governance address, and one deposit
 * wallet for `vitalik`.
 */
abstract contract HubSetup is Test {
    NamepassFactory internal factory;
    ENSV2RenewalAdapter internal adapter;
    StandardRentPriceOracle internal oracle;
    MockRenewer internal ethRegistrar;
    MockRenewer internal ethRenewerV1;
    MockUSDC internal usdc;
    MockMessageTransmitter internal transmitter;

    address constant GOVERNANCE = address(0xE45);
    address constant TOKEN_MESSENGER = address(0xC1C1E);
    bytes32 constant REFERRER = bytes32(uint256(0x1208));
    address constant EXECUTOR = address(0xEE);
    string constant LABEL = "vitalik";

    /// @dev The deposit wallet for `LABEL`, derived by the real factory.
    address internal wallet;

    function setUp() public virtual {
        vm.chainId(11155111);
        vm.etch(GOVERNANCE, hex"00");
        vm.etch(TOKEN_MESSENGER, hex"00");

        usdc = new MockUSDC();
        oracle = _deployOracle(1, 1e6);

        ethRegistrar = new MockRenewer(IRentPriceOracle(address(oracle)), address(0xB1));
        ethRenewerV1 = new MockRenewer(IRentPriceOracle(address(oracle)), address(0xB2));

        /* Disjoint by construction, as ENS's predicates are. */
        ethRegistrar.setRenewable(true);
        ethRenewerV1.setRenewable(false);

        transmitter = new MockMessageTransmitter(usdc);

        factory = new NamepassFactory(address(this), 11155111);
        factory.initialize(address(usdc), TOKEN_MESSENGER, address(transmitter), GOVERNANCE);

        adapter = new ENSV2RenewalAdapter(
            address(factory), address(usdc), address(ethRegistrar), address(ethRenewerV1), REFERRER
        );
        vm.prank(GOVERNANCE);
        factory.setHelper(address(adapter));

        wallet = factory.predictWallet(LABEL);
    }

    function _deployOracle(uint128 numer, uint128 denom) internal returns (StandardRentPriceOracle) {
        uint256[] memory rates = new uint256[](5);
        rates[2] = 20_294_267;
        rates[3] = 5_073_567;
        rates[4] = 253_679;

        DiscountPoint[] memory points = new DiscountPoint[](3);
        points[0] = DiscountPoint({duration: 63_072_000, numer: 875e35});
        points[1] = DiscountPoint({duration: 94_608_000, numer: 6875e34});
        points[2] = DiscountPoint({duration: 189_216_000, numer: 5625e34});

        PaymentRatio[] memory ratios = new PaymentRatio[](1);
        ratios[0] = PaymentRatio({paymentToken: IERC20(address(usdc)), numer: numer, denom: denom});

        return new StandardRentPriceOracle(address(this), rates, points, 1e38, 0, 1, 1, ratios);
    }

    /// @dev A user deposit: USDC arrives at the deposit address.
    function _fund(uint256 amount) internal {
        usdc.mint(wallet, amount);
    }

    /// @dev Anyone processes the deposit; `executor` pays the gas and is paid the allowance.
    function _renewAs(address executor) internal {
        vm.prank(executor);
        factory.renew(LABEL);
    }

    /// @dev Activates `next` through the governance address.
    function _activate(address next) internal {
        vm.prank(GOVERNANCE);
        factory.setHelper(next);
    }
}

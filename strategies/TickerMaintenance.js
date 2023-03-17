import BaseStrategy from './BaseStrategy.js';
// import Logger from '../Logger.js';

// TODO rework so it works on all trading pairs
export default class TickerMaintenanceStrategy extends BaseStrategy {
    constructor(connectors) {
        super(connectors);
        this._canContinue = true;
        this._lastMaintainedTimestamp = 0;
        this._lastBalanceCheckTimestamp = 0;
        this._buyingReferenceCurrency = false;
    }

    // async _balanceCheck() {
    //     let someNoBalance = false;
    //     this._lastBalanceCheckTimestamp = Date.now();
    //     for (const connector of this._connectors) {
    //         // console.log(connector._tradingPairs);
    //         const rtmBalance = await connector.getBalance("rtm");

    //         // get balances for each trading pair
    //         for (const key in connector._tradingPairs) {
    //             const pair = connector._tradingPairs[key];

    //             const minimumRequired = connector.minOrderSize(key);

    //             const coin1Balance = await connector.getBalance(key);
    //             console.log(`${key}: ${coin1Balance}`);
    //             if (coin1Balance.available < minimumRequired || rtmBalance < minimumRequired) {
    //                 connector._tradingPairs[key].enabled = false;
    //                 someNoBalance = true;
    //             }
    //         }
    //     }

    //     if (someNoBalance) {
    //         Logger.warning("TickerMaintenance", "balanceCheck", "Some connectors and/or trading pairs don't have enough balance for trading. Ticker maintenance for those connectors will be disabled until there is enough balance");
    //     }
    // }

    async start() {
        // await this._balanceCheck();
    }

    async tick() {
        console.log("tick");
        const currentTimestamp = Date.now();

        // // recheck balance just in case the user traded outside the app
        // if (currentTimestamp - this._lastBalanceCheckTimestamp > 60000) {
        //     console.log("Balance check");
        //     this._lastBalanceCheckTimestamp = currentTimestamp;
        //     await this._balanceCheck();
        // }

        // ticker maintenance every 5 minutes
        if (currentTimestamp - this._lastMaintainedTimestamp > 300000) {
            this._lastMaintainedTimestamp = currentTimestamp;

            for (const connector of this._connectors) {
                for (const key in connector._tradingPairs) {
                    const minTradeVolume = connector.minOrderSize(key);

                    const market = await connector.getMarketPrice(key);
                    const settledPrice = this.decimalRounding((market.buy - market.sell) / 2, 11);

                    const amountRtm = minTradeVolume / settledPrice;
                    await connector.addBuyOrder(amountRtm, settledPrice, key);
                    await connector.addSellOrder(amountRtm, settledPrice, key);
                }
            }
        }
    }

    async shutdown() {
        for (const connector of this._connectors) {
            await connector.cancelAllPending();
        }
        return;
    }
}
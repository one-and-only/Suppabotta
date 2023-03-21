import BaseStrategy from './BaseStrategy.js';

export default class TickerMaintenanceStrategy extends BaseStrategy {
    constructor(connectors) {
        super(connectors);
        this._canContinue = true;
        this._lastMaintainedTimestamp = 0;
        this._lastBalanceCheckTimestamp = 0;
        this._buyingReferenceCurrency = false;
    }

    async start() { }

    async tick() {
        const currentTimestamp = Date.now();

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
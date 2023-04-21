import BaseStrategy from './BaseStrategy.js';
import BaseProvider from '../providers/BaseProvider.js';

export default class TickerMaintenanceStrategy extends BaseStrategy {
    /**
     * 
     * @param {BaseProvider[]} connectors 
     */
    constructor(connectors, args) {
        super(connectors, args);
        this._lastMaintainedTimestamp = 0;
        this._buyingReferenceCurrency = false;
    }

    async start() { }

    async tick() {
        const currentTimestamp = Date.now();

        // ticker maintenance every 5 minutes
        if (currentTimestamp - this._lastMaintainedTimestamp > (process.env.TICKER_MAINTENANCE_INTERVAL ? parseInt(process.env.TICKER_MAINTENANCE_INTERVAL) : 300000)) {
            this._lastMaintainedTimestamp = currentTimestamp;

            for (const connector of this._connectors) {
                for (const key in connector._tradingPairs) {
                    const minTradeVolume = connector.minOrderSize(key);

                    const market = await connector.getMarketPrice(key);
                    const settledPrice = this.decimalRounding((market.buy - market.sell) / 2, 11);

                    const amountRtm = minTradeVolume / settledPrice;
                    await Promise.all([
                        connector.addBuyOrder(amountRtm, settledPrice, key),
                        connector.addSellOrder(amountRtm, settledPrice, key)
                    ]);
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
import BaseStrategy from './BaseStrategy.js';
import BaseProvider from '../providers/BaseProvider.js';
import Logger from '../Logger.js';

export default class TickerMaintenanceStrategy extends BaseStrategy {
    _lastMaintainedTimestamp;
    _lastBalanceCheckTimestamp;

    /**
     * 
     * @param {BaseProvider[]} connectors 
     */
    constructor(connectors, args) {
        super(connectors, args);
        this._lastMaintainedTimestamp = 0;
        this._lastBalanceCheckTimestamp = 0;
        this._buyingReferenceCurrency = false;
    }

    async balanceCheck() {
        this._lastBalanceCheckTimestamp = Date.now();
        for (const connector of this._connectors) {
            const rtmBalance = await connector.getBalance("RTM");

            for (const tradingPairIdx in connector._tradingPairs) {
                const referenceCurrency = connector.exchangePairToCoin(connector._tradingPairs[tradingPairIdx]);

                if (!rtmBalance.success) {
                    connector._tradingPairs[referenceCurrency].enabled = false;
                    continue;
                }

                const priceInfo = await connector.getMarketPrice(referenceCurrency);
                const referenceBalance = await connector.getBalance(referenceCurrency);
                const minOrderSize = connector.minOrderSize(referenceCurrency);
                const commonMinOrderAmount = connector.minTradeVolumeIsReferenceCurrency() ? minOrderSize : minOrderSize * priceInfo.buyPrice;

                if (referenceBalance.available < commonMinOrderAmount || (rtmBalance.available * priceInfo.sellPrice) < commonMinOrderAmount) {
                    Logger.warning("TickerMaintenance", `balanceCheck_${connector._name}`, `Not enough balance on ${connector._name} RTM/${referenceCurrency}`, this._socketBroadcaster);
                    connector._tradingPairs[referenceCurrency].enabled = false;
                    continue;
                }

                connector._tradingPairs[referenceCurrency].enabled = true;
            }
        }
    }

    async start() {
        await this.balanceCheck();
    }

    async tick() {
        const currentTimestamp = Date.now();

        // balance check every 60 seconds
        if (currentTimestamp - this._lastBalanceCheckTimestamp > 60000) {
            await this.balanceCheck();
        }

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